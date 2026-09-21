import { z } from 'zod';
import { canonicalSha256 } from '../mutation-canonical.js';
import { layerPathSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { textLookupFailureError } from './text-lookup-error.js';
import { AREA_TEXT_MAX_CODE_UNITS } from './area-text-host-script.js';
import { PLAIN_POINT_TEXT_V1, POINT_TEXT_JUSTIFICATIONS, POINT_TEXT_MAX_LAYER_DEPTH_LIMIT, pointTextFillColorSchema, } from './point-text-host-script.js';
export const TEXT_LAYOUT_PROFILE_NAME = 'japanese_text_layout_v1';
export const TEXT_LAYOUT_MAX_CODE_UNITS = AREA_TEXT_MAX_CODE_UNITS;
export const TEXT_LAYOUT_MEASURED_APP_VERSION = '30.8.1';
export const TEXT_LAYOUT_RELEASED = Object.freeze({
    character: ['autoLeading', 'noBreak'],
    frame: ['orientation'],
});
function without(table, released) {
    return Object.fromEntries(Object.entries(table).filter(([name]) => !released.includes(name)));
}
export const TEXT_LAYOUT_PINNED = Object.freeze({
    character: without(PLAIN_POINT_TEXT_V1.character, TEXT_LAYOUT_RELEASED.character),
    paragraph: { ...PLAIN_POINT_TEXT_V1.paragraph },
    frame: without(PLAIN_POINT_TEXT_V1.frame, TEXT_LAYOUT_RELEASED.frame),
});
export const TEXT_LAYOUT_ORIENTATIONS = ['horizontal', 'vertical'];
export const textLayoutOrientationSchema = z.enum(TEXT_LAYOUT_ORIENTATIONS);
export const textLayoutCharacterSchema = z.strictObject({
    contents: z.string().min(1).max(2),
    font: z.strictObject({
        postScriptName: z.string().min(1).max(255),
        family: z.string().min(1).max(255),
        style: z.string().min(1).max(255),
    }),
    size: z.number().finite().positive(),
    tracking: z.number().finite(),
    horizontalScale: z.number().finite().positive(),
    verticalScale: z.number().finite().positive(),
    leading: z.number().finite().positive(),
    autoLeading: z.boolean(),
    noBreak: z.boolean(),
    fillColor: pointTextFillColorSchema,
    strokeColor: z.strictObject({ model: z.literal('none') }),
});
const coordinate = z.number().finite();
const textLayoutFrameSchema = z.strictObject({
    anchor: z.tuple([coordinate, coordinate]).nullable(),
    geometricBounds: z.tuple([coordinate, coordinate, coordinate, coordinate]).nullable(),
    matrix: z.strictObject({ a: coordinate, b: coordinate, c: coordinate, d: coordinate, tx: coordinate, ty: coordinate }),
    antialias: z.string().min(1).max(255),
    pixelAligned: z.boolean(),
    tagCount: z.literal(0),
});
const textLayoutFitSchema = z.strictObject({
    status: z.enum(['fits', 'overflows', 'indeterminate']),
    visibleCharacterCount: z.number().int().min(-1),
});
const textLayoutAncestorSchema = z.strictObject({
    name: z.string().max(255),
    visible: z.boolean(),
    locked: z.boolean(),
});
export const textLayoutSnapshotInputSchema = z.strictObject({
    uuid: z.string().min(1).max(255),
    type: z.literal('TextFrame'),
    kind: z.enum(['TextType.POINTTEXT', 'TextType.AREATEXT']),
    profile: z.literal(TEXT_LAYOUT_PROFILE_NAME),
    frameShape: z.enum(['point_text_unthreaded', 'area_text_unthreaded']),
    storyFrameCount: z.literal(1),
    manualKerning: z.literal('none'),
    tabStopCount: z.literal(0),
    orientation: textLayoutOrientationSchema,
    paragraphJustifications: z.array(z.enum(POINT_TEXT_JUSTIFICATIONS)).min(1).max(TEXT_LAYOUT_MAX_CODE_UNITS),
    fit: textLayoutFitSchema.nullable(),
    characters: z.array(textLayoutCharacterSchema).min(1).max(TEXT_LAYOUT_MAX_CODE_UNITS),
    frame: textLayoutFrameSchema,
    layerPath: layerPathSchema,
    layerAncestry: z.array(textLayoutAncestorSchema).min(1).max(POINT_TEXT_MAX_LAYER_DEPTH_LIMIT),
    contents: z.string().min(1).max(TEXT_LAYOUT_MAX_CODE_UNITS),
    locked: z.boolean(),
    hidden: z.boolean(),
    editable: z.boolean(),
    layerVisible: z.boolean(),
    layerLocked: z.boolean(),
});
export const textLayoutSnapshotSchema = textLayoutSnapshotInputSchema.superRefine((snapshot, context) => {
    const point = snapshot.kind === 'TextType.POINTTEXT';
    if (point !== (snapshot.frameShape === 'point_text_unthreaded') || point !== (snapshot.fit === null) ||
        point !== (snapshot.frame.anchor !== null) || point === (snapshot.frame.geometricBounds !== null)) {
        context.addIssue({ code: 'custom', message: 'A text-layout snapshot must be consistently point text or area text.' });
    }
    if (snapshot.characters.length !== snapshot.contents.length ||
        snapshot.characters.some((character, index) => character.contents !== snapshot.contents.charAt(index))) {
        context.addIssue({ code: 'custom', message: 'A text-layout snapshot must fingerprint every UTF-16 code unit of its contents.' });
    }
});
export function sameCanonical(left, right) {
    return canonicalSha256(left) === canonicalSha256(right);
}
export const textLayoutBlockerSchema = z.enum([
    'document_mutation_not_allowed',
    'target_locked',
    'target_hidden',
    'target_not_editable',
    'layer_hidden',
    'layer_locked',
]);
export const TEXT_LAYOUT_SNAPSHOT_SCRIPT = `
var TEXT_LAYOUT_PROFILE = ${JSON.stringify(TEXT_LAYOUT_PROFILE_NAME)};
var TEXT_LAYOUT_MAX_CODE_UNITS = ${TEXT_LAYOUT_MAX_CODE_UNITS};
var TEXT_LAYOUT_PINNED = ${JSON.stringify(TEXT_LAYOUT_PINNED)};

function textLayoutOrientation(target) {
  var value;
  try { value = target.orientation; }
  catch (orientationError) { throw mutationError("preflight_failed", "Target orientation is unreadable."); }
  var name = String(value);
  if (name === "TextOrientation.HORIZONTAL") return "horizontal";
  if (name === "TextOrientation.VERTICAL") return "vertical";
  throw mutationError("preflight_failed", "Text-layout operations support horizontal and vertical orientation only.");
}

function textLayoutNativeOrientation(name) {
  if (name === "vertical") return TextOrientation.VERTICAL;
  if (name === "horizontal") return TextOrientation.HORIZONTAL;
  throw mutationError("apply_failed", "Unsupported text orientation.");
}

function textLayoutCharacter(character) {
  var attributes;
  try { attributes = character.characterAttributes; }
  catch (attributesError) { throw mutationError("preflight_failed", "A character's attributes are unavailable."); }
  pointTextAssertPinned(attributes, TEXT_LAYOUT_PINNED.character, "character attribute");
  var font = attributes.textFont;
  if (!font || typeof font.name !== "string" || !font.name) {
    throw mutationError("preflight_failed", "A character's font identity is unavailable.");
  }
  var located = null;
  try { located = app.textFonts.getByName(font.name); }
  catch (fontError) { located = null; }
  if (located === null || located === undefined || located !== font) {
    throw mutationError("preflight_failed", "A character's font is not installed.");
  }
  var fillColor = pointTextReadFillColor(attributes.fillColor);
  var strokeColor = attributes.strokeColor;
  if (!strokeColor || String(strokeColor.typename) !== "NoColor") {
    throw mutationError("preflight_failed", "Text-layout operations support unstroked characters only.");
  }
  var autoLeading = attributes.autoLeading;
  var noBreak = attributes.noBreak;
  if (typeof autoLeading !== "boolean" || typeof noBreak !== "boolean") {
    throw mutationError("preflight_failed", "A character's leading or no-break state is unavailable.");
  }
  return {
    contents: String(character.contents),
    font: { postScriptName: font.name, family: font.family, style: font.style },
    size: pointTextNumber(attributes.size, "characterAttributes.size"),
    tracking: pointTextNumber(attributes.tracking, "characterAttributes.tracking"),
    horizontalScale: pointTextNumber(attributes.horizontalScale, "characterAttributes.horizontalScale"),
    verticalScale: pointTextNumber(attributes.verticalScale, "characterAttributes.verticalScale"),
    leading: pointTextNumber(attributes.leading, "characterAttributes.leading"),
    autoLeading: autoLeading,
    noBreak: noBreak,
    fillColor: fillColor,
    strokeColor: { model: "none" }
  };
}

/** Every character, in order; any manual pair kern fails closed exactly as for the range text tools. */
function textLayoutCharacters(target) {
  var characters = target.characters;
  if (!characters || typeof characters.length !== "number") {
    throw mutationError("preflight_failed", "Target characters are unavailable.");
  }
  if (characters.length < 1 || characters.length > TEXT_LAYOUT_MAX_CODE_UNITS) {
    throw mutationError("preflight_failed", "Text-layout operations support 1 to " + TEXT_LAYOUT_MAX_CODE_UNITS + " UTF-16 code units.");
  }
  var fingerprints = [];
  for (var index = 0; index < characters.length; index++) {
    // Held, not temporary: an attribute read off a released character fails with error 9503.
    var character = characters[index];
    var manualKerning;
    try { manualKerning = character.kerning; }
    catch (kerningError) {
      if (!kerningError || Number(kerningError.number) !== 9551) {
        throw mutationError("preflight_failed", "Manual kerning state is unavailable.");
      }
      fingerprints.push(textLayoutCharacter(character));
      continue;
    }
    throw mutationError("preflight_failed", "Text-layout operations do not support manual pair kerning.");
  }
  return fingerprints;
}

/** Every paragraph is checked against the pinned table; a whole-range read would report only the first. */
function textLayoutParagraphs(target) {
  var paragraphs;
  try { paragraphs = target.paragraphs; }
  catch (paragraphsError) { throw mutationError("preflight_failed", "Target paragraphs are unavailable."); }
  if (!paragraphs || typeof paragraphs.length !== "number" || paragraphs.length < 1) {
    throw mutationError("preflight_failed", "Target paragraphs are unavailable.");
  }
  var justifications = [];
  for (var index = 0; index < paragraphs.length; index++) {
    var paragraph = paragraphs[index];
    var attributes;
    try { attributes = paragraph.paragraphAttributes; }
    catch (attributesError) { throw mutationError("preflight_failed", "Target paragraph attributes are unavailable."); }
    pointTextAssertPinned(attributes, TEXT_LAYOUT_PINNED.paragraph, "paragraph attribute");
    var listStyle;
    try { listStyle = attributes.listStyle; }
    catch (listStyleError) { throw mutationError("preflight_failed", "Target paragraph list style is unavailable."); }
    if (!listStyle) throw mutationError("preflight_failed", "Target paragraph list style is unavailable.");
    pointTextAssertTypedError(listStyle, "name", POINT_TEXT_LIST_STYLE_UNBOUND_ERROR, "paragraph list style");
    var tabStops;
    try { tabStops = attributes.tabStops; }
    catch (tabStopError) { throw mutationError("preflight_failed", "Target tab stops are unavailable."); }
    if (!tabStops || typeof tabStops.length !== "number") {
      throw mutationError("preflight_failed", "Target tab stops are unavailable.");
    }
    if (tabStops.length !== 0) throw mutationError("preflight_failed", "Text-layout operations do not support tab stops.");
    justifications.push(pointTextSupportedJustification(attributes.justification));
  }
  return justifications;
}

function textLayoutFrameState(target, point) {
  pointTextAssertPinned(target, TEXT_LAYOUT_PINNED.frame, "frame property");
  var matrix;
  try { matrix = target.matrix; }
  catch (matrixError) { throw mutationError("preflight_failed", "Target frame matrix is unavailable."); }
  var anchor = null;
  var geometricBounds = null;
  if (point) {
    var rawAnchor;
    try { rawAnchor = target.anchor; }
    catch (anchorError) { throw mutationError("preflight_failed", "Target frame anchor is unavailable."); }
    if (!rawAnchor || typeof rawAnchor.length !== "number" || rawAnchor.length !== 2) {
      throw mutationError("preflight_failed", "Target frame anchor is unavailable.");
    }
    anchor = [pointTextNumber(rawAnchor[0], "frame.anchor[0]"), pointTextNumber(rawAnchor[1], "frame.anchor[1]")];
  } else {
    var rawBounds;
    try { rawBounds = target.geometricBounds; }
    catch (boundsError) { throw mutationError("preflight_failed", "Target frame bounds are unavailable."); }
    if (!rawBounds || typeof rawBounds.length !== "number" || rawBounds.length !== 4) {
      throw mutationError("preflight_failed", "Target frame bounds are unavailable.");
    }
    geometricBounds = [pointTextNumber(rawBounds[0], "frame.geometricBounds[0]"),
      pointTextNumber(rawBounds[1], "frame.geometricBounds[1]"), pointTextNumber(rawBounds[2], "frame.geometricBounds[2]"),
      pointTextNumber(rawBounds[3], "frame.geometricBounds[3]")];
  }
  var tagCount;
  try { tagCount = target.tags.length; }
  catch (tagError) { throw mutationError("preflight_failed", "Target frame tag state is unavailable."); }
  if (tagCount !== 0) throw mutationError("preflight_failed", "Text-layout operations do not support a target that carries tags.");
  if (typeof target.pixelAligned !== "boolean") throw mutationError("preflight_failed", "Target frame state is unavailable.");
  return {
    anchor: anchor,
    geometricBounds: geometricBounds,
    matrix: {
      a: pointTextNumber(matrix.mValueA, "frame.matrix.a"), b: pointTextNumber(matrix.mValueB, "frame.matrix.b"),
      c: pointTextNumber(matrix.mValueC, "frame.matrix.c"), d: pointTextNumber(matrix.mValueD, "frame.matrix.d"),
      tx: pointTextNumber(matrix.mValueTX, "frame.matrix.tx"), ty: pointTextNumber(matrix.mValueTY, "frame.matrix.ty")
    },
    antialias: String(target.antialias),
    pixelAligned: target.pixelAligned,
    tagCount: 0
  };
}

function textLayoutContents(target, point) {
  var value = target.contents;
  if (typeof value !== "string" || value.length < 1 || value.length > TEXT_LAYOUT_MAX_CODE_UNITS ||
      String(value).indexOf("\\x03") >= 0) {
    throw mutationError("preflight_failed", "Target contents must be 1 to " + TEXT_LAYOUT_MAX_CODE_UNITS +
      " UTF-16 code units without inline graphics.");
  }
  if (point && (String(value).indexOf("\\r") >= 0 || String(value).indexOf("\\n") >= 0)) {
    throw mutationError("preflight_failed", "Point-text layout operations support a single line only.");
  }
  return value;
}

/**
 * The complete snapshot. It throws only when the target is outside the profile; an area frame that
 * overflows is reported through \`fit\`, so verification and rollback can still read it.
 */
function textLayoutSnapshot(document, target, expectedUuid) {
  if (!target || target.typename !== "TextFrame") {
    throw mutationError("preflight_failed", "Text-layout operations support TextFrame targets only.");
  }
  var point;
  if (target.kind === TextType.POINTTEXT) point = true;
  else if (target.kind === TextType.AREATEXT) point = false;
  else throw mutationError("preflight_failed", "Text-layout operations support point text and area text only.");
  if (typeof target.uuid !== "string" || target.uuid !== expectedUuid) {
    throw mutationError("preflight_failed", "Target native UUID is unavailable or changed.");
  }
  if (!target.layer || target.parent !== target.layer) {
    throw mutationError("preflight_failed", "Text-layout target must be directly contained by its layer.");
  }
  if (!target.story || !target.story.textFrames ||
      target.story.textFrames.length !== 1 || target.story.textFrames[0] !== target) {
    throw mutationError("preflight_failed", "Text-layout operations support unthreaded text only.");
  }
  if (typeof target.locked !== "boolean" || typeof target.hidden !== "boolean" ||
      typeof target.editable !== "boolean" || typeof target.layer.visible !== "boolean" ||
      typeof target.layer.locked !== "boolean") {
    throw mutationError("preflight_failed", "Target safety state is unavailable.");
  }
  var layerPath = pointTextLayerPath(document, target.layer);
  if (layerPath === null) throw mutationError("preflight_failed", "Target layer path is unavailable.");
  var frameShape = point ? pointTextFrameShape(target) : "area_text_unthreaded";
  var contents = textLayoutContents(target, point);
  var characters = textLayoutCharacters(target);
  if (characters.length !== contents.length) {
    throw mutationError("preflight_failed", "Target characters do not match its contents.");
  }
  var fit = null;
  if (!point) {
    var proof = areaTextFit(target, contents);
    fit = { status: proof.status, visibleCharacterCount: proof.visibleCharacterCount };
  }
  return {
    uuid: target.uuid,
    type: target.typename,
    kind: point ? "TextType.POINTTEXT" : "TextType.AREATEXT",
    profile: TEXT_LAYOUT_PROFILE,
    frameShape: frameShape,
    storyFrameCount: 1,
    manualKerning: "none",
    tabStopCount: 0,
    orientation: textLayoutOrientation(target),
    paragraphJustifications: textLayoutParagraphs(target),
    fit: fit,
    characters: characters,
    frame: textLayoutFrameState(target, point),
    layerPath: layerPath,
    layerAncestry: pointTextAncestry(target),
    contents: contents,
    locked: target.locked,
    hidden: target.hidden,
    editable: target.editable,
    layerVisible: target.layer.visible,
    layerLocked: target.layer.locked
  };
}

/**
 * Key-order independent JSON. A caller's echoed expected_before / confirmed_after passes through the
 * public schema, which fixes its own key order, so an order-dependent comparison would refuse a correct
 * echo whenever that order and the host's differ (apply_character_style).
 */
function textLayoutCanonicalJson(value) {
  if (value === null || typeof value !== "object") return stringifyJson(value);
  if (value instanceof Array) {
    var items = [];
    for (var index = 0; index < value.length; index++) items.push(textLayoutCanonicalJson(value[index]));
    return "[" + items.join(",") + "]";
  }
  var keys = [];
  for (var key in value) if (value.hasOwnProperty(key)) keys.push(key);
  keys.sort();
  var fields = [];
  for (var keyIndex = 0; keyIndex < keys.length; keyIndex++) {
    fields.push(stringifyJson(keys[keyIndex]) + ":" + textLayoutCanonicalJson(value[keys[keyIndex]]));
  }
  return "{" + fields.join(",") + "}";
}

function textLayoutSame(left, right) {
  return left !== null && left !== undefined && right !== null && right !== undefined &&
    textLayoutCanonicalJson(left) === textLayoutCanonicalJson(right);
}

function textLayoutCopy(value) {
  if (value === null || typeof value !== "object") return value;
  var copy = value instanceof Array ? [] : {};
  for (var key in value) if (value.hasOwnProperty(key)) copy[key] = textLayoutCopy(value[key]);
  return copy;
}

/**
 * The snapshot with the fields an operation may write, and their layout consequences, blanked. Rollback
 * writes an inverse only when the current state differs from before in nothing else.
 */
function textLayoutMasked(snapshot, mask) {
  var copy = textLayoutCopy(snapshot);
  if (mask.orientation) {
    copy.orientation = null; copy.fit = null; copy.frame.anchor = null; copy.frame.matrix = null;
  }
  for (var index = mask.start; index < mask.end; index++) {
    for (var field = 0; field < mask.characterFields.length; field++) copy.characters[index][mask.characterFields[field]] = null;
  }
  return copy;
}

function textLayoutResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  var target = pointTextFind(document, params.targetUuid);
  if (target === null) {
    throw mutationError("preflight_failed", stringifyJson({ code: "OBJECT_NOT_FOUND", uuid: params.targetUuid }));
  }
  var before = textLayoutSnapshot(document, target, params.targetUuid);
  var blockers = pointTextBlockers(context, before);
  if (forApply && blockers.length > 0) {
    throw mutationBeforeSideEffectError(stringifyJson({ code: "TEXT_LAYOUT_APPLY_BLOCKED",
      reasonCodes: blockers, uuid: params.targetUuid }));
  }
  return { context: context, document: document, target: target, before: before, blockers: blockers };
}
`;
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']),
    reasonCode: z.enum(['apply_failed', 'verify_mismatch']),
    message: z.string().min(1).max(500),
}).superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed')) {
        context.addIssue({ code: 'custom', message: 'Text-layout failure phase and reason code must match.' });
    }
});
const indeterminateFailureSchema = z.strictObject({
    phase: z.literal('apply'),
    reasonCode: z.literal('apply_indeterminate'),
    message: z.string().min(1).max(500),
});
const rollbackEvidence = {
    targetUuid: z.string().min(1).max(255),
    restoredSnapshot: textLayoutSnapshotSchema.nullable(),
};
export function textLayoutTransactionSchema(label) {
    return z.discriminatedUnion('state', [
        z.strictObject({ state: z.literal('planned'), audit: mutationAuditSchema }),
        z.strictObject({ state: z.literal('verified'), audit: mutationAuditSchema }),
        z.strictObject({ state: z.literal('apply_failed'), failure: failureSchema,
            rollback: z.strictObject({ status: z.literal('not_required') }), audit: mutationAuditSchema }),
        z.strictObject({ state: z.literal('rolled_back'), failure: failureSchema,
            rollback: z.strictObject({ status: z.literal('verified'), ...rollbackEvidence }), audit: mutationAuditSchema }),
        z.strictObject({ state: z.literal('rollback_failed'), failure: failureSchema,
            rollback: z.strictObject({ status: z.literal('failed'), reasonCode: z.literal('rollback_failed'),
                message: z.string().min(1).max(500), ...rollbackEvidence }), audit: mutationAuditSchema }),
        z.strictObject({ state: z.literal('apply_indeterminate'), failure: indeterminateFailureSchema,
            rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('text_state_unknown'),
                message: z.string().min(1).max(500), targetUuid: z.string().min(1).max(255), restoredSnapshot: z.null() }),
            audit: mutationAuditSchema }),
        z.strictObject({ state: z.literal('rollback_indeterminate'), failure: failureSchema,
            rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('rollback_indeterminate'),
                message: z.string().min(1).max(500), ...rollbackEvidence }), audit: mutationAuditSchema }),
    ]).superRefine((transaction, context) => {
        const prefix = ['preflight:started:', 'preflight:succeeded:', 'plan:started:', 'plan:succeeded:'];
        let expected;
        if (transaction.state === 'planned') {
            expected = [...prefix, 'apply:skipped:not_requested', 'verify:skipped:not_requested', 'rollback:skipped:not_requested'];
        }
        else if (transaction.state === 'verified') {
            expected = [...prefix, 'apply:started:', 'apply:attempted:', 'apply:succeeded:',
                'verify:started:', 'verify:succeeded:', 'rollback:skipped:not_required'];
        }
        else if (transaction.state === 'apply_failed') {
            expected = [...prefix, 'apply:started:', 'apply:failed:apply_failed', 'verify:skipped:not_required', 'rollback:skipped:not_required'];
        }
        else if (transaction.state === 'apply_indeterminate') {
            expected = [...prefix, 'apply:started:', 'apply:attempted:', 'apply:failed:apply_indeterminate'];
        }
        else {
            const failure = transaction.failure.phase === 'apply'
                ? ['apply:started:', 'apply:attempted:', 'apply:failed:apply_failed', 'verify:skipped:not_required']
                : ['apply:started:', 'apply:attempted:', 'apply:succeeded:', 'verify:started:', 'verify:failed:verify_mismatch'];
            expected = [...prefix, ...failure, 'rollback:started:', transaction.state === 'rolled_back'
                    ? 'rollback:succeeded:'
                    : `rollback:failed:${transaction.state === 'rollback_failed' ? 'rollback_failed' : 'rollback_indeterminate'}`];
        }
        const actual = transaction.audit.map((event) => `${event.phase}:${event.event}:${'reasonCode' in event ? event.reasonCode : ''}`);
        if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
            context.addIssue({ code: 'custom', message: `${label}: audit sequence does not match the transaction state.` });
        }
        transaction.audit.forEach((event, index) => {
            if (event.sequence !== index)
                context.addIssue({ code: 'custom', message: `${label}: audit sequence must be contiguous.` });
        });
        if ('failure' in transaction) {
            const matches = transaction.audit.filter((event) => event.event === 'failed' &&
                event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode &&
                event.message === transaction.failure.message);
            if (matches.length !== 1)
                context.addIssue({ code: 'custom', message: `${label}: failure must match one audit event.` });
        }
    });
}
export function textLayoutSafetyRegistration(operationId) {
    return operationSafetyRegistrationSchema.parse({
        operationId,
        policy: {
            version: 1, class: 'update_existing', destructive: false,
            evidence: { identity: 'target_native_uuid', beforeState: 'before_state_hash', postcondition: 'updated_state_matches_plan' },
            preconditions: { documentBinding: 'explicit_document_key', compareAndSet: 'before_state_hash_match' },
            confirmation: 'exact_change_set',
            recovery: { mode: 'verified_inverse', verification: 'restored_state_matches_before_hash', partialRecovery: 'indeterminate' },
            terminal: { success: 'verified', failure: 'proven_pre_apply_or_verified_recovery', partialSuccess: 'nonterminal_until_reconciled' },
            replay: { requestBinding: 'canonical_request_digest', retry: 'return_attested_terminal_result', beforeTerminal: 'reconcile_required', reapplyOnRetry: false },
        },
        capabilities: {
            class: 'update_existing', explicitDocumentBinding: true, bindTargetNativeUuid: true, captureBeforeStateHash: true,
            compareAndSetBeforeApply: true, verifyUpdatedState: true, recoveryMode: 'verified_inverse', verifyRestoredBeforeState: true,
            reconcileIndeterminate: true, durableTerminalReplay: true, trustedTerminalAttestationResolver: true,
        },
    });
}
function textLayoutSafetyPlan(view, requestDigest, admissionDocumentKey = view.documentKey) {
    const beforeStateHash = canonicalDigest(view.before);
    const afterStateHash = canonicalDigest(view.after);
    const changeSetHash = canonicalDigest({ targetUuid: view.targetUuid, changeSet: view.changeSet, beforeStateHash, afterStateHash });
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'update_existing', operationId: view.operationId, canonicalRequestDigest: requestDigest,
        evidence: { documentKey: admissionDocumentKey, targetUuid: view.targetUuid, beforeStateHash,
            plannedAfterStateHash: afterStateHash, plannedChangeSetDigest: changeSetHash },
        preconditions: { status: view.blocked ? 'blocked' : 'satisfied', compareAndSetMatched: !view.blocked },
        confirmation: { kind: 'exact_change_set', canonicalRequestDigest: requestDigest, changeSetHash, status: view.confirmationStatus },
        applyAllowed: view.applyAllowed,
    });
}
function textLayoutSafetyResult(view, requestDigest, attestation, plan) {
    const state = view.transactionState;
    if (state === 'planned' || state === 'apply_indeterminate' || state === 'rollback_indeterminate' || state === 'rollback_failed') {
        throw new Error('Indeterminate or failed text-layout recovery cannot be terminal.');
    }
    const common = { policyVersion: 1, operationClass: 'update_existing', operationId: view.operationId,
        canonicalRequestDigest: requestDigest, planDigest: plan.planDigest, attestation };
    const boundPlan = plan;
    const beforeStateHash = boundPlan.evidence.beforeStateHash;
    const replay = { status: 'durable_terminal', action: 'return_attested_result', reapply: false };
    if (state === 'verified' && view.applied) {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { targetUuid: view.targetUuid, beforeStateHash, afterStateHash: boundPlan.evidence.plannedAfterStateHash,
                restoredStateHash: null, restoredBeforeStateVerified: false },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'succeeded', terminal: true, recovery: 'not_required', proof: { kind: 'verified_postcondition' }, replay } });
    }
    if (state === 'rolled_back') {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { targetUuid: view.targetUuid, beforeStateHash, afterStateHash: null, restoredStateHash: beforeStateHash,
                restoredBeforeStateVerified: true },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'recovered', terminal: true, recovery: 'verified', proof: { kind: 'verified_recovery' }, replay } });
    }
    return operationSafetyResultSchema.parse({ ...common,
        evidence: { targetUuid: view.targetUuid, beforeStateHash, afterStateHash: null, restoredStateHash: null,
            restoredBeforeStateVerified: false },
        executionEvidence: { outcome: 'proven_pre_apply' },
        resolution: { status: 'failed', terminal: true, recovery: 'not_required',
            proof: { kind: 'proven_pre_apply', mutationAttempted: false }, replay } });
}
export function textLayoutSafetyAsserter(registration, view) {
    return async (value, requestDigest, attestation, resolver) => {
        const current = view(value);
        const plan = textLayoutSafetyPlan(current, requestDigest, attestation?.documentKey);
        if (current.transactionState === 'planned')
            return;
        if (attestation === null || resolver === null)
            throw new Error('Text-layout terminal result requires attestation.');
        await assertOperationSafetyAdapterConformance({ registration, plan,
            result: textLayoutSafetyResult(current, requestDigest, attestation, plan) }, resolver);
    };
}
export function classifyTextLayoutTerminal(state, label) {
    if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back')
        return { state };
    if (state === 'planned')
        throw new Error(`${label} plan is not a terminal mutation result.`);
    throw new Error(`Unverified ${label} recovery must remain indeterminate and retain its lock.`);
}
export function mapTextLayoutError(label, error, detail) {
    const lookupFailure = textLookupFailureError(error, detail);
    if (lookupFailure !== null)
        return lookupFailure;
    if (detail?.code === 'OBJECT_NOT_FOUND') {
        return new Error(`No PageItem with UUID ${JSON.stringify(detail.uuid ?? '')} exists in the bound document.`);
    }
    if (detail?.code === 'TEXT_LAYOUT_APPLY_BLOCKED') {
        const reasons = (detail.reasonCodes ?? []).join(', ');
        return new Error(`${label} is blocked: ${reasons || 'unknown reason'}.`);
    }
    return error instanceof Error ? error : new Error(String(error));
}
