import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, layerPathSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { normalizePointTextPublicFillColor, POINT_TEXT_SNAPSHOT_SCRIPT, pointTextFillCompatible, pointTextFillColorRequestSchema, pointTextFillColorSchema, pointTextPublicFillColorSchema, } from './point-text-host-script.js';
import { AREA_TEXT_JUSTIFICATIONS, AREA_TEXT_MAX_LAYER_DEPTH_LIMIT, AREA_TEXT_PROFILE_NAME, AREA_TEXT_SNAPSHOT_SCRIPT, areaTextContentsSchema, areaTextSnapshotSchema, areaTextStripBreaks, } from './area-text-host-script.js';
export const CREATE_AREA_TEXT_OPERATION = 'create_area_text';
export const CREATE_AREA_TEXT_VALIDATOR = { kind: CREATE_AREA_TEXT_OPERATION, version: 1 };
export const CREATE_AREA_TEXT_MAX_DIRECT_ITEMS = 128;
const CANONICAL_VERSION = 2;
const RESULT_SCHEMA_VERSION = 2;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 2;
const canonicalNumberSchema = z.number().finite().transform((value) => Object.is(value, -0) ? 0 : value);
const requestedStyleSchema = z.strictObject({
    fontPostScriptName: z.string().min(1).max(255),
    size: z.number().finite().positive(),
    tracking: z.number().finite(),
    justification: z.enum(AREA_TEXT_JUSTIFICATIONS),
    fillColor: pointTextFillColorSchema,
});
const requestedStyleRequestSchema = z.strictObject({
    fontPostScriptName: z.string().min(1).max(255),
    size: canonicalNumberSchema.pipe(z.number().positive()),
    tracking: canonicalNumberSchema,
    justification: z.enum(AREA_TEXT_JUSTIFICATIONS),
    fillColor: pointTextFillColorRequestSchema,
});
const publicStyleSchema = z.strictObject({
    font_post_script_name: z.string().min(1).max(255),
    size: z.number().finite().positive(),
    tracking: z.number().finite(),
    justification: z.enum(AREA_TEXT_JUSTIFICATIONS).optional(),
    fill_color: pointTextPublicFillColorSchema,
});
const rectSchema = z.strictObject({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
});
const rectRequestSchema = z.strictObject({
    x: canonicalNumberSchema,
    y: canonicalNumberSchema,
    width: canonicalNumberSchema.pipe(z.number().positive()),
    height: canonicalNumberSchema.pipe(z.number().positive()),
});
export const createAreaTextLayerStateSchema = z.strictObject({
    path: layerPathSchema,
    name: z.string().max(255),
    visible: z.boolean(),
    locked: z.boolean(),
    itemUuids: z.array(z.string().min(1).max(255)).max(CREATE_AREA_TEXT_MAX_DIRECT_ITEMS),
    ancestry: z.array(z.strictObject({
        name: z.string().max(255),
        visible: z.boolean(),
        locked: z.boolean(),
    })).min(1).max(AREA_TEXT_MAX_LAYER_DEPTH_LIMIT),
});
const blockerSchema = z.enum([
    'document_mutation_not_allowed',
    'layer_hidden',
    'layer_locked',
    'layer_item_capacity_exceeded',
]);
const planSchema = z.strictObject({
    operation: z.literal(CREATE_AREA_TEXT_OPERATION),
    documentKey: z.string().min(1).max(16_384),
    artboardIndex: z.number().int().nonnegative(),
    rect: rectSchema,
    contents: areaTextContentsSchema,
    requestedStyle: requestedStyleSchema,
    profile: z.literal(AREA_TEXT_PROFILE_NAME),
    layer: createAreaTextLayerStateSchema,
    applyBlockedReasonCodes: z.array(blockerSchema),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    if (plan.applyAllowed !== (plan.applyBlockedReasonCodes.length === 0)) {
        context.addIssue({ code: 'custom', message: 'Area-text creation applyAllowed must require no blockers.' });
    }
});
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']),
    reasonCode: z.enum(['apply_failed', 'verify_mismatch']),
    message: z.string().min(1).max(500),
}).superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed')) {
        context.addIssue({ code: 'custom', message: 'Area-text creation failure phase and reason code must match.' });
    }
});
const indeterminateFailureSchema = z.strictObject({
    phase: z.literal('apply'),
    reasonCode: z.literal('apply_indeterminate'),
    message: z.string().min(1).max(500),
});
const rollbackEvidence = {
    createdUuids: z.array(z.string().min(1).max(255)).max(2).nullable(),
    restoredItemUuids: z.array(z.string().min(1).max(255)).nullable(),
};
const transactionSchema = z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('planned'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('verified'), audit: mutationAuditSchema }),
    z.strictObject({
        state: z.literal('apply_failed'), failure: failureSchema,
        rollback: z.strictObject({ status: z.literal('not_required') }), audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rolled_back'), failure: failureSchema,
        rollback: z.strictObject({ status: z.literal('verified'), ...rollbackEvidence }), audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rollback_failed'), failure: failureSchema,
        rollback: z.strictObject({
            status: z.literal('failed'), reasonCode: z.literal('rollback_failed'),
            message: z.string().min(1).max(500), ...rollbackEvidence,
        }), audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('apply_indeterminate'), failure: indeterminateFailureSchema,
        rollback: z.strictObject({
            status: z.literal('indeterminate'), reasonCode: z.literal('created_state_unknown'),
            message: z.string().min(1).max(500), createdUuids: z.null(), restoredItemUuids: z.null(),
        }), audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rollback_indeterminate'), failure: failureSchema,
        rollback: z.strictObject({
            status: z.literal('indeterminate'), reasonCode: z.literal('rollback_indeterminate'),
            message: z.string().min(1).max(500), ...rollbackEvidence,
        }), audit: mutationAuditSchema,
    }),
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
        expected = [...prefix, 'apply:started:', 'apply:failed:apply_failed',
            'verify:skipped:not_required', 'rollback:skipped:not_required'];
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
        context.addIssue({ code: 'custom', message: 'Area-text creation audit sequence does not match transaction state.' });
    }
    transaction.audit.forEach((event, index) => {
        if (event.sequence !== index) {
            context.addIssue({ code: 'custom', message: 'Area-text creation audit sequence must be contiguous.' });
        }
    });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' &&
            event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode &&
            event.message === transaction.failure.message);
        if (matches.length !== 1) {
            context.addIssue({ code: 'custom', message: 'Area-text creation failure must match one audit event.' });
        }
    }
});
export const createAreaTextResultSchema = z.union([
    z.strictObject({
        operation: z.literal(CREATE_AREA_TEXT_OPERATION), applied: z.literal(false),
        document: documentContextSchema, plan: planSchema, transaction: transactionSchema,
    }),
    z.strictObject({
        operation: z.literal(CREATE_AREA_TEXT_OPERATION), applied: z.literal(true),
        document: documentContextSchema, plan: planSchema,
        created: z.strictObject({
            uuid: z.string().min(1).max(255),
            snapshot: areaTextSnapshotSchema,
            layerItemUuids: z.array(z.string().min(1).max(255)).min(1).max(CREATE_AREA_TEXT_MAX_DIRECT_ITEMS + 1),
        }),
        transaction: transactionSchema,
    }),
]).superRefine((result, context) => {
    if (result.document.colorSpace === 'unknown' ||
        !pointTextFillCompatible(result.plan.requestedStyle.fillColor.model, result.document.colorSpace)) {
        context.addIssue({ code: 'custom', message: 'An area-text plan must request a fill that belongs to the document color space.' });
    }
    if (result.transaction.state === 'planned') {
        const blockers = [];
        if (!result.document.mutationAllowed)
            blockers.push('document_mutation_not_allowed');
        if (result.plan.layer.ancestry.some((ancestor) => !ancestor.visible))
            blockers.push('layer_hidden');
        if (result.plan.layer.ancestry.some((ancestor) => ancestor.locked))
            blockers.push('layer_locked');
        if (result.plan.layer.itemUuids.length >= CREATE_AREA_TEXT_MAX_DIRECT_ITEMS) {
            blockers.push('layer_item_capacity_exceeded');
        }
        if (canonicalSha256(result.plan.applyBlockedReasonCodes) !==
            canonicalSha256(blockers)) {
            context.addIssue({ code: 'custom', message: 'Planned area-text creation must expose exact blockers.' });
        }
    }
    else if (result.plan.applyBlockedReasonCodes.length !== 0 || !result.plan.applyAllowed) {
        context.addIssue({ code: 'custom', message: 'Applied area-text creation must derive from an allowed plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified') {
            context.addIssue({ code: 'custom', message: 'A created area text must come from a verified transaction.' });
        }
        if (result.created.snapshot.uuid !== result.created.uuid ||
            result.created.layerItemUuids[0] !== result.created.uuid ||
            result.created.layerItemUuids.length !== result.plan.layer.itemUuids.length + 1 ||
            result.created.layerItemUuids.slice(1).some((uuid, index) => uuid !== result.plan.layer.itemUuids[index])) {
            context.addIssue({ code: 'custom', message: 'A created area text must be the only new item, at the front, with the prior order intact.' });
        }
        if (result.created.snapshot.contents !== result.plan.contents ||
            result.created.snapshot.profile !== AREA_TEXT_PROFILE_NAME ||
            canonicalSha256(result.created.snapshot.layerPath) !==
                canonicalSha256(result.plan.layer.path)) {
            context.addIssue({ code: 'custom', message: 'A created area text must match the planned contents, profile and layer.' });
        }
        if (canonicalSha256(result.created.snapshot.style.fillColor) !==
            canonicalSha256(result.plan.requestedStyle.fillColor)) {
            context.addIssue({ code: 'custom', message: 'A created area text must carry the requested fill.' });
        }
        const requested = areaTextStripBreaks(result.plan.contents);
        if (result.created.snapshot.fit.requestedCharacterCount !== requested.length ||
            result.created.snapshot.fit.visibleCharacterCount !== requested.length) {
            context.addIssue({ code: 'custom', message: 'A created area text must show every requested character.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified area-text creation must report the created item.' });
    }
});
export const createAreaTextResponseSchema = z.strictObject({
    outcome: createAreaTextResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
const commonInternal = {
    expectedDocumentKey: z.string().min(1).max(16_384),
    expectedLayerPath: layerPathSchema,
    artboardIndex: z.number().int().safe().nonnegative(),
    rect: rectRequestSchema,
    contents: areaTextContentsSchema,
    style: requestedStyleRequestSchema,
};
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({ ...commonInternal, apply: z.literal(true), commandId: canonicalCommandIdSchema }),
]);
const commonPublic = {
    expected_document_key: z.string().min(1).max(16_384),
    expected_layer_path: layerPathSchema,
    artboard_index: z.number().int().safe().nonnegative(),
    rect: rectSchema,
    contents: areaTextContentsSchema,
    style: publicStyleSchema,
};
export const createAreaTextPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({ ...commonPublic, apply: z.literal(true), command_id: applyCommandIdSchema }),
]);
const inputSchema = z.strictObject({
    ...commonPublic,
    apply: z.boolean().default(false),
    command_id: applyCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(createAreaTextPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = createAreaTextPublicInputSchema.parse(input);
    const common = {
        expectedDocumentKey: value.expected_document_key,
        expectedLayerPath: value.expected_layer_path,
        artboardIndex: value.artboard_index,
        rect: value.rect,
        contents: value.contents,
        style: {
            fontPostScriptName: value.style.font_post_script_name,
            size: value.style.size,
            tracking: value.style.tracking,
            justification: value.style.justification ?? 'Justification.LEFT',
            fillColor: normalizePointTextPublicFillColor(value.style.fill_color),
        },
    };
    return value.apply
        ? { ...common, apply: true, commandId: value.command_id }
        : { ...common, apply: false };
}
export const CREATE_AREA_TEXT_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: CREATE_AREA_TEXT_OPERATION,
    policy: {
        version: 1, class: 'create', destructive: false,
        evidence: { identity: 'native_uuid', ownership: 'self_created_only',
            postcondition: 'created_state_matches_plan' },
        preconditions: { documentBinding: 'explicit_document_key',
            targetValidation: 'same_execution_before_apply' },
        confirmation: 'risk_scoped',
        recovery: { mode: 'remove_self_created_uuid', verification: 'native_uuid_absent',
            unknownIdentity: 'indeterminate' },
        terminal: { success: 'verified', failure: 'proven_pre_apply_or_verified_recovery',
            partialSuccess: 'nonterminal_until_reconciled' },
        replay: { requestBinding: 'canonical_request_digest', retry: 'return_attested_terminal_result',
            beforeTerminal: 'reconcile_required', reapplyOnRetry: false },
    },
    capabilities: {
        class: 'create', explicitDocumentBinding: true, validateTargetsBeforeApply: true,
        captureNativeUuid: true, verifyCreatedState: true, rollbackSelfCreatedUuidOnly: true,
        verifyRollbackAbsence: true, reconcileIndeterminate: true, durableTerminalReplay: true,
        trustedTerminalAttestationResolver: true,
    },
});
export const CREATE_AREA_TEXT_SAFETY_IDENTITY = canonicalDigest(CREATE_AREA_TEXT_SAFETY);
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'create', operationId: CREATE_AREA_TEXT_OPERATION,
        canonicalRequestDigest: requestDigest,
        evidence: {
            documentKey: admissionDocumentKey,
            targetLocator: `layer:${result.plan.layer.path.join('.')};artboard:${result.plan.artboardIndex}`,
        },
        preconditions: {
            status: result.plan.applyBlockedReasonCodes.length === 0 ? 'satisfied' : 'blocked',
            targetsValidated: result.plan.applyBlockedReasonCodes.length === 0,
        },
        confirmation: { kind: 'risk_scoped', status: 'not_required' },
        applyAllowed: result.plan.applyAllowed,
    });
}
function safetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' ||
        transaction.state === 'rollback_indeterminate') {
        throw new Error('Indeterminate area-text creation cannot be terminal.');
    }
    const common = { policyVersion: 1, operationClass: 'create',
        operationId: CREATE_AREA_TEXT_OPERATION, canonicalRequestDigest: requestDigest,
        planDigest: plan.planDigest, attestation };
    if (result.applied && transaction.state === 'verified') {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { nativeUuid: result.created.uuid, ownership: 'self_created_only',
                postconditionVerified: true, outstandingEffect: null },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'succeeded', terminal: true, recovery: 'not_required',
                proof: { kind: 'verified_postcondition' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    if (transaction.state === 'rolled_back') {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { nativeUuid: transaction.rollback.createdUuids?.[0] ?? null, ownership: 'self_created_only',
                postconditionVerified: false, outstandingEffect: null },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'recovered', terminal: true, recovery: 'verified',
                proof: { kind: 'verified_recovery' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    if (transaction.state === 'rollback_failed') {
        const nativeUuid = transaction.rollback.createdUuids?.[0] ?? null;
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { nativeUuid, ownership: 'self_created_only', postconditionVerified: false,
                outstandingEffect: nativeUuid === null
                    ? null
                    : { kind: 'native_uuid_still_present', nativeUuid } },
            executionEvidence: { outcome: 'recovery_failed' },
            resolution: { status: 'recovery_failed', terminal: true, recovery: 'failed',
                outstandingEffect: 'known_effect_present',
                proof: { kind: 'verified_outstanding_effect' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    return operationSafetyResultSchema.parse({ ...common,
        evidence: { nativeUuid: null, ownership: 'self_created_only', postconditionVerified: false,
            outstandingEffect: null },
        executionEvidence: { outcome: 'proven_pre_apply' },
        resolution: { status: 'failed', terminal: true, recovery: 'not_required',
            proof: { kind: 'proven_pre_apply', mutationAttempted: false },
            replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
}
async function assertSafety(value, requestDigest, attestation, resolver) {
    const result = createAreaTextResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null) {
        throw new Error('Area-text creation terminal result requires attestation.');
    }
    await assertOperationSafetyAdapterConformance({ registration: CREATE_AREA_TEXT_SAFETY, plan,
        result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
export const CREATE_AREA_TEXT_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${POINT_TEXT_SNAPSHOT_SCRIPT}
${AREA_TEXT_SNAPSHOT_SCRIPT}
var CREATE_AREA_TEXT_MAX_DIRECT_ITEMS = ${CREATE_AREA_TEXT_MAX_DIRECT_ITEMS};

function createAreaTextResolveLayer(document, path) {
  var container = document;
  for (var index = 0; index < path.length; index++) {
    var layers = container.layers;
    if (!layers || typeof layers.length !== "number" || path[index] >= layers.length) {
      throw mutationError("preflight_failed", "The requested layer path does not exist in the bound document.");
    }
    container = layers[path[index]];
  }
  if (!container || String(container.typename) !== "Layer") {
    throw mutationError("preflight_failed", "The requested layer path does not resolve to a layer.");
  }
  return container;
}

function createAreaTextLayerOrder(layer) {
  var order = [];
  for (var index = 0; index < layer.pageItems.length; index++) {
    var uuid = layer.pageItems[index].uuid;
    if (typeof uuid !== "string" || uuid.length === 0) {
      throw mutationError("preflight_failed", "A layer item native UUID is unavailable.");
    }
    order.push(uuid);
  }
  return order;
}

/**
 * The ancestry of the layer itself, nearest first. Creation is blocked by a hidden or locked ancestor,
 * because the immediate layer never reports an ancestor's state.
 */
function createAreaTextLayerAncestry(layer) {
  var chain = [];
  var node = layer;
  while (chain.length <= AREA_TEXT_MAX_LAYER_DEPTH) {
    if (node === null || node === undefined) {
      throw mutationError("preflight_failed", "Target layer ancestry does not terminate at the document.");
    }
    var typename;
    try { typename = String(node.typename); }
    catch (typenameError) { throw mutationError("preflight_failed", "Target layer ancestry is unavailable."); }
    if (typename === "Document") return chain;
    if (typename !== "Layer") {
      throw mutationError("preflight_failed", "Area-text creation supports layer ancestry only.");
    }
    if (typeof node.name !== "string" || typeof node.visible !== "boolean" || typeof node.locked !== "boolean") {
      throw mutationError("preflight_failed", "Target layer ancestry state is unavailable.");
    }
    chain.push({ name: node.name, visible: node.visible, locked: node.locked });
    try { node = node.parent; }
    catch (nextError) { throw mutationError("preflight_failed", "Target layer ancestry is unavailable."); }
  }
  throw mutationError("preflight_failed", "Target layer ancestry exceeds the supported depth.");
}

function createAreaTextArtboardRect(document, artboardIndex) {
  if (!document.artboards || typeof document.artboards.length !== "number" ||
      artboardIndex >= document.artboards.length) {
    throw mutationError("preflight_failed", "The requested artboard does not exist in the bound document.");
  }
  var rect = document.artboards[artboardIndex].artboardRect;
  if (!rect || rect.length !== 4) {
    throw mutationError("preflight_failed", "The requested artboard rectangle is unavailable.");
  }
  return [mutationFiniteNumber(rect[0], "artboardRect[0]"), mutationFiniteNumber(rect[1], "artboardRect[1]"),
    mutationFiniteNumber(rect[2], "artboardRect[2]"), mutationFiniteNumber(rect[3], "artboardRect[3]")];
}

/**
 * Artboard-relative rectangle, converted to the document coordinates pathItems.rectangle() expects
 * (top, left, width, height). The whole rectangle must lie inside the artboard, so a frame can never
 * be created where the caller cannot see it.
 */
function createAreaTextRect(artboard) {
  var x = mutationFiniteNumber(params.rect.x, "rect.x");
  var y = mutationFiniteNumber(params.rect.y, "rect.y");
  var width = mutationFiniteNumber(params.rect.width, "rect.width");
  var height = mutationFiniteNumber(params.rect.height, "rect.height");
  if (width <= 0 || height <= 0) {
    throw mutationError("preflight_failed", "The requested rectangle must have a positive width and height.");
  }
  var artboardWidth = artboard[2] - artboard[0];
  var artboardHeight = artboard[1] - artboard[3];
  if (x < 0 || y < 0 || x + width > artboardWidth || y + height > artboardHeight) {
    throw mutationError("preflight_failed", "The requested rectangle is outside the bound artboard.");
  }
  return { top: artboard[1] - y, left: artboard[0] + x, width: width, height: height };
}

function createAreaTextFont() {
  var font;
  try { font = app.textFonts.getByName(params.style.fontPostScriptName); }
  catch (fontError) { font = null; }
  if (font === null || font === undefined) {
    throw mutationError("preflight_failed", "The requested font is not installed.");
  }
  return font;
}

function createAreaTextResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  var layer = createAreaTextResolveLayer(document, params.expectedLayerPath);
  var ancestry = createAreaTextLayerAncestry(layer);
  var order = createAreaTextLayerOrder(layer);
  var artboard = createAreaTextArtboardRect(document, params.artboardIndex);
  var rect = createAreaTextRect(artboard);
  var font = createAreaTextFont();
  areaTextValidateContents(params.contents, "contents");
  // Refused at plan, before any write: the requested fill must belong to this document's color space.
  pointTextAssertFillCompatible(params.style.fillColor, pointTextDocumentColorSpace(document));
  var blockers = [];
  if (!context.mutationAllowed) blockers.push("document_mutation_not_allowed");
  var ancestorHidden = false;
  var ancestorLocked = false;
  for (var index = 0; index < ancestry.length; index++) {
    if (!ancestry[index].visible) ancestorHidden = true;
    if (ancestry[index].locked) ancestorLocked = true;
  }
  if (ancestorHidden) blockers.push("layer_hidden");
  if (ancestorLocked) blockers.push("layer_locked");
  if (order.length >= CREATE_AREA_TEXT_MAX_DIRECT_ITEMS) blockers.push("layer_item_capacity_exceeded");
  if (forApply && blockers.length > 0) {
    throw mutationBeforeSideEffectError(stringifyJson({ code: "CREATE_AREA_TEXT_APPLY_BLOCKED",
      reasonCodes: blockers }));
  }
  return { context: context, document: document, layer: layer, ancestry: ancestry, order: order,
    rect: rect, font: font, blockers: blockers };
}

function createAreaTextPlanState(preflight) {
  return {
    operation: "create_area_text",
    documentKey: preflight.context.key,
    artboardIndex: params.artboardIndex,
    rect: { x: params.rect.x, y: params.rect.y, width: params.rect.width, height: params.rect.height },
    contents: params.contents,
    requestedStyle: params.style,
    profile: AREA_TEXT_PROFILE,
    layer: { path: params.expectedLayerPath, name: preflight.layer.name,
      visible: preflight.layer.visible, locked: preflight.layer.locked,
      itemUuids: preflight.order, ancestry: preflight.ancestry },
    applyBlockedReasonCodes: preflight.blockers,
    applyAllowed: preflight.blockers.length === 0
  };
}

function createAreaTextRevalidate(preflight, plan) {
  var current;
  try { current = createAreaTextResolve(true); }
  catch (error) {
    throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Area-text creation preconditions changed before apply."));
  }
  if (current.document !== preflight.document || current.layer !== preflight.layer ||
      !mutationSameSequence(current.order, plan.layer.itemUuids) ||
      stringifyJson(current.ancestry) !== stringifyJson(plan.layer.ancestry) ||
      stringifyJson(current.rect) !== stringifyJson(preflight.rect) || current.font !== preflight.font) {
    throw mutationBeforeSideEffectError("Area-text creation target or layer changed before apply.");
  }
}

/**
 * Writes every pinned profile field explicitly. Creation never relies on what a document happens to
 * inherit: a document whose composition defaults differ must produce a canonical frame or fail closed.
 */
function createAreaTextApplyProfile(frame) {
  var range = frame.textRange;
  var attributes = range.characterAttributes;
  var paragraph = range.paragraphAttributes;
  attributes.textFont = createAreaTextFont();
  attributes.size = params.style.size;
  attributes.tracking = params.style.tracking;
  attributes.horizontalScale = 100;
  attributes.verticalScale = 100;
  attributes.fillColor = pointTextNativeFillColor(params.style.fillColor);
  var requestedJustification = params.style.justification;
  var justificationDot = requestedJustification.indexOf(".");
  paragraph.justification = $.global[requestedJustification.substring(0, justificationDot)]
    [requestedJustification.substring(justificationDot + 1)];
  createAreaTextWritePinned(attributes, AREA_TEXT_PINNED.character);
  createAreaTextWritePinned(paragraph, AREA_TEXT_PINNED.paragraph);
  createAreaTextWritePinned(frame, AREA_TEXT_PINNED.frame);
  // The pinned stroke fields written after NoColor leave latent paint that a save and reopen make visible
  // (measured on point text). Area text pins the same character fields as point text, so it clears the stroke
  // last too.
  attributes.strokeColor = new NoColor();
}

function createAreaTextWritePinned(host, table) {
  for (var name in table) {
    if (!table.hasOwnProperty(name)) continue;
    var resolved = createAreaTextResolveCanonical(table[name]);
    if (resolved.status !== "value") {
      throw mutationError("apply_failed", "The canonical profile value for " + name + " cannot be resolved.");
    }
    try { host[name] = resolved.value; }
    catch (writeError) {
      throw mutationError("apply_failed", "The canonical profile value for " + name + " cannot be written.");
    }
  }
}

/** Inverse of pointTextCanonicalValue, so the written value is exactly what the profile pins. */
function createAreaTextResolveCanonical(encoded) {
  if (encoded === "undefined") return { status: "value", value: undefined };
  if (encoded === "null") return { status: "value", value: null };
  if (encoded === "true") return { status: "value", value: true };
  if (encoded === "false") return { status: "value", value: false };
  if (encoded.substring(0, 2) === "s:") return { status: "value", value: encoded.substring(2) };
  if (encoded.substring(0, 2) === "o:") {
    var text = encoded.substring(2);
    var dot = text.indexOf(".");
    if (dot < 0) return { status: "unresolved" };
    var holder = $.global[text.substring(0, dot)];
    if (holder === undefined || holder === null) return { status: "unresolved" };
    var member = holder[text.substring(dot + 1)];
    if (member === undefined) return { status: "unresolved" };
    return { status: "value", value: member };
  }
  return { status: "value", value: Number(encoded) };
}

/**
 * Draws the rectangle and converts it to an area frame. The areaText() call consumes the path, so both
 * native UUIDs are recorded: if the path survives as a separate item, rollback must be able to name it.
 */
function createAreaTextApply(preflight, plan, state) {
  state.operationState.mutationStarted = true;
  var path = preflight.layer.pathItems.rectangle(preflight.rect.top, preflight.rect.left,
    preflight.rect.width, preflight.rect.height);
  state.operationState.createdPathUuid = String(path.uuid);
  var frame = preflight.layer.textFrames.areaText(path);
  state.operationState.createdUuid = String(frame.uuid);
  frame.contents = areaTextHostContents(params.contents);
  createAreaTextApplyProfile(frame);
  return frame;
}

function createAreaTextVerify(preflight, plan, state) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) {
    throw mutationError("verify_mismatch", "Active document changed during area-text creation verification.");
  }
  var createdUuid = state.operationState.createdUuid;
  if (typeof createdUuid !== "string" || createdUuid.length === 0) {
    throw mutationError("verify_mismatch", "The created area text has no captured native UUID.");
  }
  var target = pointTextFind(preflight.document, createdUuid);
  if (target === null) {
    throw mutationError("verify_mismatch", "The created native UUID no longer resolves in the bound document.");
  }
  var order = createAreaTextLayerOrder(preflight.layer);
  if (order.length !== plan.layer.itemUuids.length + 1 || order[0] !== createdUuid ||
      !mutationSameSequence(order.slice(1), plan.layer.itemUuids)) {
    throw mutationError("verify_mismatch", "The created area text is not the only new front item of its layer.");
  }
  var snapshot = areaTextSnapshot(preflight.document, target, createdUuid, params.contents);
  if (snapshot.contents !== params.contents || snapshot.profile !== AREA_TEXT_PROFILE ||
      !mutationSameSequence(snapshot.layerPath, plan.layer.path) ||
      stringifyJson(snapshot.style.fillColor) !== stringifyJson(params.style.fillColor)) {
    throw mutationError("verify_mismatch", "The created area text does not match the planned state.");
  }
  return { uuid: createdUuid, snapshot: snapshot, layerItemUuids: order };
}

/** Every native UUID this call may have introduced, newest first, with duplicates and nulls dropped. */
function createAreaTextOwnUuids(state) {
  var own = [];
  var candidates = [state.operationState.createdUuid, state.operationState.createdPathUuid];
  for (var index = 0; index < candidates.length; index++) {
    var uuid = candidates[index];
    if (typeof uuid !== "string" || uuid.length === 0) continue;
    var seen = false;
    for (var known = 0; known < own.length; known++) if (own[known] === uuid) seen = true;
    if (!seen) own.push(uuid);
  }
  return own;
}

function createAreaTextRollback(state) {
  var preflight = state.preflight;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) {
    return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
  }
  var own = createAreaTextOwnUuids(state);
  if (own.length === 0) {
    // Neither call captured a UUID, so nothing of ours was ever named. The layer order is still
    // positive evidence: if it equals the baseline exactly, nothing was created.
    var uncreatedOrder;
    try { uncreatedOrder = createAreaTextLayerOrder(preflight.layer); }
    catch (uncreatedError) { return { status: "indeterminate", message: "Rollback layer order is indeterminate." }; }
    if (!mutationSameSequence(uncreatedOrder, preflight.order)) {
      return { status: "indeterminate", message: "Rollback cannot prove which item was created." };
    }
    state.operationState.rollbackEvidence.createdUuids = [];
    state.operationState.rollbackEvidence.restoredItemUuids = uncreatedOrder;
    return { status: "verified" };
  }
  state.operationState.rollbackEvidence.createdUuids = own;
  var currentOrder;
  try { currentOrder = createAreaTextLayerOrder(preflight.layer); }
  catch (orderError) { return { status: "indeterminate", message: "Rollback layer order is indeterminate." }; }
  // Only remove while the layer is exactly the baseline plus our own items, in front, in order.
  var remainder = [];
  var extras = [];
  for (var index = 0; index < currentOrder.length; index++) {
    var mine = false;
    for (var ownIndex = 0; ownIndex < own.length; ownIndex++) if (own[ownIndex] === currentOrder[index]) mine = true;
    if (mine) extras.push(currentOrder[index]);
    else remainder.push(currentOrder[index]);
  }
  if (!mutationSameSequence(remainder, preflight.order) || extras.length !== currentOrder.length - remainder.length) {
    return { status: "indeterminate", message: "Rollback refused because the layer is neither the baseline nor the created state." };
  }
  for (var removeIndex = 0; removeIndex < extras.length; removeIndex++) {
    var target;
    try { target = pointTextFind(preflight.document, extras[removeIndex]); }
    catch (findError) { return { status: "indeterminate", message: "Rollback target identity is indeterminate." }; }
    if (target === null) continue;
    try { target.remove(); }
    catch (removeError) { return { status: "indeterminate", message: "Rollback removal is indeterminate." }; }
  }
  var restored;
  try { restored = createAreaTextLayerOrder(preflight.layer); }
  catch (verifyError) { return { status: "indeterminate", message: "Rollback verification is indeterminate." }; }
  state.operationState.rollbackEvidence.restoredItemUuids = restored;
  for (var absentIndex = 0; absentIndex < own.length; absentIndex++) {
    if (pointTextFind(preflight.document, own[absentIndex]) !== null) {
      return { status: "failed", message: "Rollback did not remove every created native UUID." };
    }
  }
  return mutationSameSequence(restored, preflight.order)
    ? { status: "verified" }
    : { status: "failed", message: "Rollback did not restore the exact baseline layer order." };
}

var createAreaTextExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionLayers: function (phase, preflight) { return [preflight.layer]; },
  editSessionAffected: function (phase, preflight, plan, state) { return (phase === "after") ? [state.operationState.createdUuid] : []; },
  initialOperationState: function () {
    return { mutationStarted: false, createdUuid: null, createdPathUuid: null,
      rollbackEvidence: { createdUuids: null, restoredItemUuids: null } };
  },
  preflight: function (forApply) {
    var resolved = createAreaTextResolve(forApply);
    return resolved;
  },
  plan: createAreaTextPlanState,
  revalidate: createAreaTextRevalidate,
  applyMutation: createAreaTextApply,
  verify: createAreaTextVerify,
  rollback: createAreaTextRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () {
    return { reasonCode: "created_state_unknown",
      message: "Area-text creation outcome is indeterminate.",
      evidence: { createdUuids: null, restoredItemUuids: null } };
  },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var createAreaTextDocument = createAreaTextExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === createAreaTextExecution.preflight.document) {
  createAreaTextDocument = getDocumentContext();
}
var result = { operation: "create_area_text",
  applied: createAreaTextExecution.transaction.state === "verified",
  document: createAreaTextDocument, plan: createAreaTextExecution.plan,
  transaction: createAreaTextExecution.transaction };
if (createAreaTextExecution.transaction.state === "verified") {
  result.created = createAreaTextExecution.value;
}
`;
export const CREATE_AREA_TEXT_HOST_SCRIPT_DIGEST = canonicalSha256(CREATE_AREA_TEXT_SCRIPT);
export const CREATE_AREA_TEXT_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: CREATE_AREA_TEXT_OPERATION,
    validator: CREATE_AREA_TEXT_VALIDATOR, canonicalContractVersion: CANONICAL_VERSION,
    resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: CREATE_AREA_TEXT_SAFETY_IDENTITY, hostScriptDigest: CREATE_AREA_TEXT_HOST_SCRIPT_DIGEST,
    mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    const digestRequest = 'commandId' in request
        ? (({ commandId: _commandId, ...rest }) => rest)(request)
        : request;
    const digest = canonicalSha256({ operation: CREATE_AREA_TEXT_OPERATION,
        validator: CREATE_AREA_TEXT_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request,
        commandId: 'commandId' in request ? request.commandId : null,
        documentKey: request.expectedDocumentKey, digest };
}
export const createAreaTextToolContract = {
    name: 'illustrator_create_area_text',
    title: 'Plan or Create Area Text',
    description: 'Plan or create one AREATEXT frame from an artboard-relative rectangle on an explicit layer path, '
        + 'bound by explicit document key, and flow multi-paragraph body text into it with automatic wrapping. '
        + 'Paragraphs are separated by a newline. Every character, paragraph and frame property outside the requested '
        + 'font, size, tracking, alignment and fill is written from the plain_area_text_v1 profile rather than '
        + 'inherited, so line spacing follows that profile and is not caller-settable in this slice. Overset is never a '
        + 'success: apply verifies that the concatenated visible lines equal the whole requested text and otherwise rolls '
        + 'the frame back and reports how many characters were visible. Columns, rows, threading and inset spacing are '
        + 'unsupported. fill_color follows the document color space: RGB in RGB documents, {model: "cmyk", …} in CMYK '
        + 'documents, {model: "gray", gray} in either; any other combination is refused at plan, before any write. '
        + 'The returned native UUID identifies the item until the document is next saved; Illustrator '
        + 'renumbers UUIDs across that save.',
    inputSchema,
    publicInputSchema: createAreaTextPublicInputSchema,
    outputSchema: createAreaTextResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(CREATE_AREA_TEXT_SAFETY.policy),
    normalizePublicInput,
};
export function createAreaTextAdapter() {
    return {
        version: 1, operation: CREATE_AREA_TEXT_OPERATION, validator: CREATE_AREA_TEXT_VALIDATOR,
        safety: CREATE_AREA_TEXT_SAFETY, safetyRegistrationIdentity: CREATE_AREA_TEXT_SAFETY_IDENTITY,
        adapterIdentity: CREATE_AREA_TEXT_ADAPTER_IDENTITY, tool: createAreaTextToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest,
            safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: createAreaTextResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: CLASSIFIER_VERSION, safetyConformanceVersion: CONFORMANCE_VERSION,
        errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: CREATE_AREA_TEXT_HOST_SCRIPT_DIGEST,
        mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: CREATE_AREA_TEXT_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: CREATE_AREA_TEXT_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: CREATE_AREA_TEXT_OPERATION,
                    documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: CREATE_AREA_TEXT_ADAPTER_IDENTITY,
                mutationHostApplicationMode: 'foreground', script: CREATE_AREA_TEXT_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = createAreaTextResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back' ||
                state === 'rollback_failed')
                return { state };
            if (state === 'planned')
                throw new Error('Area-text creation plan is not a terminal mutation result.');
            throw new Error('Unverified area-text creation must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error, detail) {
            if (detail?.code === 'CREATE_AREA_TEXT_APPLY_BLOCKED') {
                return new Error(`Area-text creation is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}.`);
            }
            if (detail?.code === 'POINT_TEXT_COLOR_SPACE_MISMATCH') {
                return new Error(`A ${detail.requestedModel ?? 'unknown'} fill cannot be written to a `
                    + `${detail.documentColorSpace ?? 'unknown'} document; implicit color-space conversion is refused.`);
            }
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
