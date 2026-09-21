import { z } from 'zod';
import { canonicalSha256 } from '../mutation-canonical.js';
import { boundsSchema } from '../mutation-result-schema-core.js';
import { SUPPORTED_PATH_ITEM_HOST_SCRIPT, SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS, SUPPORTED_PATH_ITEM_MAX_PATH_POINTS, supportedPathCmykPaintSchema, } from './supported-path-item-host-script.js';
export const CLIPPING_MASK_MEASURED_APP_VERSION = '30.8.1';
const uuidSchema = z.string().min(1).max(255);
const numberSchema = z.number().finite();
const pointSchema = z.tuple([numberSchema, numberSchema]);
const rgbSchema = z.strictObject({
    type: z.literal('RGBColor'),
    red: numberSchema,
    green: numberSchema,
    blue: numberSchema,
});
const pathPointSchema = z.strictObject({
    anchor: pointSchema,
    leftDirection: pointSchema,
    rightDirection: pointSchema,
    pointType: z.enum(['PointType.CORNER', 'PointType.SMOOTH']),
});
const clipPaintSchema = z.union([rgbSchema, supportedPathCmykPaintSchema]);
export const clipPathSnapshotSchema = z.strictObject({
    uuid: uuidSchema,
    type: z.literal('PathItem'),
    name: z.string().max(1024),
    parentType: z.enum(['Layer', 'GroupItem']),
    geometricBounds: boundsSchema,
    visibleBounds: boundsSchema,
    closed: z.boolean(),
    pathPoints: z.array(pathPointSchema).min(1).max(SUPPORTED_PATH_ITEM_MAX_PATH_POINTS),
    filled: z.boolean(),
    fillColor: clipPaintSchema.nullable(),
    stroked: z.boolean(),
    strokeColor: clipPaintSchema.nullable(),
    strokeWidth: numberSchema.nonnegative().nullable(),
    opacity: numberSchema,
    clipping: z.boolean(),
    locked: z.boolean(),
    hidden: z.boolean(),
}).superRefine((snapshot, context) => {
    if ((snapshot.fillColor !== null) !== snapshot.filled ||
        (snapshot.strokeColor !== null) !== snapshot.stroked || (snapshot.strokeWidth !== null) !== snapshot.stroked) {
        context.addIssue({ code: 'custom', message: 'Path fill and stroke values must be present exactly when painted.' });
    }
});
const groupShape = {
    uuid: uuidSchema,
    type: z.literal('GroupItem'),
    name: z.string().max(1024),
    parentType: z.enum(['Layer', 'GroupItem']),
    geometricBounds: boundsSchema,
    visibleBounds: boundsSchema,
    clipped: z.boolean(),
    locked: z.boolean(),
    hidden: z.boolean(),
    childOrder: z.tuple([uuidSchema, uuidSchema]),
    mask: clipPathSnapshotSchema,
};
function refineGroup(snapshot, context) {
    if (snapshot.childOrder[0] !== snapshot.mask.uuid || snapshot.childOrder[1] !== snapshot.content.uuid) {
        context.addIssue({ code: 'custom', message: 'Clip group child order must be [mask, content].' });
    }
}
export const clipInnerGroupSnapshotSchema = z.strictObject({ ...groupShape, content: clipPathSnapshotSchema })
    .superRefine(refineGroup);
export const clipContentSnapshotSchema = z.union([clipPathSnapshotSchema, clipInnerGroupSnapshotSchema]);
export const clipGroupSnapshotSchema = z.strictObject({ ...groupShape, content: clipContentSnapshotSchema })
    .superRefine(refineGroup);
export const clipLayerStateSchema = z.strictObject({
    layerPath: z.array(z.number().int().nonnegative()).length(1),
    visible: z.boolean(),
    locked: z.boolean(),
});
export const clipParentOrderSchema = z.array(uuidSchema).min(1).max(SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS)
    .superRefine((uuids, context) => {
    if (new Set(uuids).size !== uuids.length) {
        context.addIssue({ code: 'custom', message: 'Parent order must contain unique native UUIDs.' });
    }
});
export const clipBlockerSchema = z.enum([
    'document_mutation_not_allowed', 'unsupported_host_version',
    'mask_locked', 'mask_hidden', 'content_locked', 'content_hidden', 'group_locked', 'group_hidden',
    'target_not_editable', 'layer_hidden', 'layer_locked',
]);
function pathHasCmyk(snapshot) {
    return snapshot.fillColor?.type === 'CMYKColor' || snapshot.strokeColor?.type === 'CMYKColor';
}
export function clipCmykWithinMeasuredScope(colorSpace, mask, content) {
    if (content.type === 'GroupItem') {
        return ![mask, content.mask, content.content].some(pathHasCmyk);
    }
    return colorSpace === 'CMYK' || ![mask, content].some(pathHasCmyk);
}
export const CLIP_MASK_APPEARANCE_AFTER = {
    filled: false, fillColor: null, stroked: false, strokeColor: null, strokeWidth: null,
};
export function sameCanonical(left, right) {
    return canonicalSha256(left) === canonicalSha256(right);
}
function withoutVisibleBounds(snapshot) {
    const { visibleBounds: _visibleBounds, ...rest } = snapshot;
    return rest;
}
export function expectedMaskAfterCreate(before) {
    return { ...before, parentType: 'GroupItem', clipping: true, ...CLIP_MASK_APPEARANCE_AFTER };
}
export function sameMaskAfterCreate(before, after) {
    return sameCanonical(withoutVisibleBounds(expectedMaskAfterCreate(before)), withoutVisibleBounds(after));
}
export function expectedContentAfterCreate(before) {
    return { ...before, parentType: 'GroupItem' };
}
export function sameGroupAfterRelease(before, after) {
    const strip = (group) => {
        const { geometricBounds: _geometric, visibleBounds: _visible, ...rest } = group;
        return rest;
    };
    return sameCanonical(strip({ ...before, clipped: false, mask: { ...before.mask, clipping: false } }), strip(after));
}
export function clipAuditMatches(transaction) {
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
        if (transaction.failure === undefined)
            return false;
        const failure = transaction.failure.phase === 'apply'
            ? ['apply:started:', 'apply:attempted:', 'apply:failed:apply_failed', 'verify:skipped:not_required']
            : ['apply:started:', 'apply:attempted:', 'apply:succeeded:', 'verify:started:', 'verify:failed:verify_mismatch'];
        expected = [...prefix, ...failure, 'rollback:started:', transaction.state === 'rolled_back'
                ? 'rollback:succeeded:'
                : `rollback:failed:${transaction.state === 'rollback_failed' ? 'rollback_failed' : 'rollback_indeterminate'}`];
    }
    const actual = transaction.audit.map((event) => `${event.phase}:${event.event}:${event.reasonCode ?? ''}`);
    if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index]))
        return false;
    if (transaction.audit.some((event, index) => event.sequence !== index))
        return false;
    if (transaction.failure !== undefined) {
        const failure = transaction.failure;
        const matches = transaction.audit.filter((event) => event.event === 'failed' && event.phase === failure.phase &&
            event.reasonCode === failure.reasonCode && event.message === failure.message);
        if (matches.length !== 1)
            return false;
    }
    return true;
}
export const CLIPPING_MASK_HOST_SCRIPT = `${SUPPORTED_PATH_ITEM_HOST_SCRIPT}
var CLIP_MEASURED_APP_VERSION = ${JSON.stringify(CLIPPING_MASK_MEASURED_APP_VERSION)};

function clipIndexOf(list, value) {
  for (var index = 0; index < list.length; index++) if (list[index] === value) return index;
  return -1;
}

function clipUnsupported(reason, uuid) {
  return new Error("MCP_ERROR:" + stringifyJson({ code: "CLIP_UNSUPPORTED_TARGET", reason: reason, uuid: uuid }));
}

function clipCollection(document, type) {
  var collection = null;
  if (type === "PathItem") collection = document.pathItems;
  else if (type === "GroupItem") collection = document.groupItems;
  else if (type === "PlacedItem") collection = document.placedItems;
  else if (type === "CompoundPathItem") collection = document.compoundPathItems;
  if (!collection || typeof collection.length !== "number") {
    throw mutationError("preflight_failed", "The document " + type + " collection is unavailable.");
  }
  return collection;
}

/** Typed-collection lookup (getPageItemFromUuid misreports PlacedItem / CompoundPathItem as GroupItem). */
function clipTyped(document, type, uuid) {
  var collection = clipCollection(document, type);
  var found = null;
  var matches = 0;
  for (var index = 0; index < collection.length; index++) {
    var candidate = collection[index];
    if (String(candidate.uuid) === uuid) { matches++; if (found === null) found = candidate; }
  }
  if (matches > 1) throw mutationError("preflight_failed", "More than one " + type + " reports the target UUID.");
  if (found !== null && String(found.typename) !== type) {
    throw mutationError("preflight_failed", "The resolved item does not report " + type + ".");
  }
  return found;
}

/** Resolves a UUID to one item of an allowed type; any other existing item is an unmeasured type. */
function clipResolve(document, uuid, allowedTypes) {
  if (typeof uuid !== "string" || uuid.length === 0) throw mutationError("preflight_failed", "Target UUID must be a non-empty string.");
  if (clipTyped(document, "PlacedItem", uuid) !== null || clipTyped(document, "CompoundPathItem", uuid) !== null) {
    throw clipUnsupported("type_unmeasured", uuid);
  }
  var found = null;
  for (var typeIndex = 0; typeIndex < allowedTypes.length; typeIndex++) {
    var item = clipTyped(document, allowedTypes[typeIndex], uuid);
    if (item === null) continue;
    if (found !== null) throw mutationError("preflight_failed", "The target UUID resolves in more than one typed collection.");
    found = item;
  }
  if (found !== null) return found;
  if (supportedPathFind(document, uuid) !== null) throw clipUnsupported("type_unmeasured", uuid);
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "OBJECT_NOT_FOUND", uuid: uuid }));
}

/** Top-level layer only (every measured operation fixture item sat on document.layers[i]). */
function clipLayerState(document, layer, uuid) {
  var layerInfo = supportedPathLayerChain(document, layer);
  if (layerInfo === null) throw mutationError("preflight_failed", "Target layer identity is unavailable.");
  if (layerInfo.path.length !== 1) throw clipUnsupported("sublayer_unmeasured", uuid);
  if (typeof layer.visible !== "boolean" || typeof layer.locked !== "boolean") {
    throw mutationError("preflight_failed", "Layer safety state is unavailable.");
  }
  return { layerPath: layerInfo.path, visible: layer.visible, locked: layer.locked };
}

/**
 * CMYK paint is measured only in a CMYK document, on a mask or content path of a non-nested clip. Returns the
 * scope check, which is asked only when CMYK paint is found, so an RGB clip reads nothing new.
 */
function clipCmykScope(document, pathContent) {
  return function () {
    if (!pathContent) return false;
    try { return document.documentColorSpace === DocumentColorSpace.CMYK; }
    catch (spaceError) { throw mutationError("preflight_failed", "The bound document color space is unavailable."); }
  };
}

function clipPaint(value, label, uuid, admitCmyk) {
  var typename = value ? String(value.typename) : "";
  if (typename === "CMYKColor" && admitCmyk && admitCmyk() === true) {
    return supportedPathPaint(value, label, { cmykAdmitted: admitCmyk, cmykRefusal: "" });
  }
  if (typename !== "RGBColor") throw clipUnsupported("color_model_unmeasured", uuid);
  return supportedPathRgb(value, label);
}

function clipPathSnapshot(document, target, expectedParent, admitCmyk) {
  if (!target || String(target.typename) !== "PathItem" || typeof target.uuid !== "string" || target.uuid.length === 0) {
    throw mutationError("preflight_failed", "Clip path identity is unavailable.");
  }
  var uuid = target.uuid;
  if (target.parent !== expectedParent) throw clipUnsupported("parent_unmeasured", uuid);
  if (!target.pathPoints || target.pathPoints.length < 1 || target.pathPoints.length > SUPPORTED_PATH_ITEM_MAX_PATH_POINTS) {
    throw clipUnsupported("path_points_unsupported", uuid);
  }
  var pathPoints = [];
  for (var pointIndex = 0; pointIndex < target.pathPoints.length; pointIndex++) {
    var point = target.pathPoints[pointIndex];
    var pointType = String(point.pointType);
    if (pointType !== "PointType.CORNER" && pointType !== "PointType.SMOOTH") throw clipUnsupported("path_points_unsupported", uuid);
    pathPoints.push({
      anchor: supportedPathPoint(point.anchor, "pathPoints[" + pointIndex + "].anchor"),
      leftDirection: supportedPathPoint(point.leftDirection, "pathPoints[" + pointIndex + "].leftDirection"),
      rightDirection: supportedPathPoint(point.rightDirection, "pathPoints[" + pointIndex + "].rightDirection"),
      pointType: pointType
    });
  }
  if (typeof target.filled !== "boolean" || typeof target.stroked !== "boolean" || typeof target.clipping !== "boolean" ||
      typeof target.locked !== "boolean" || typeof target.hidden !== "boolean") {
    throw mutationError("preflight_failed", "Clip path appearance or safety state is unavailable.");
  }
  var visibilityVariable;
  try { visibilityVariable = target.visibilityVariable; }
  catch (variableError) { throw mutationError("preflight_failed", "Clip path visibility variable state is unreadable."); }
  if (target.guides || target.sliced || target.isIsolated || target.wrapped ||
      String(target.artworkKnockout) !== "KnockoutState.DISABLED" ||
      String(target.blendingMode) !== "BlendModes.NORMAL" || visibilityVariable !== null ||
      String(target.note) !== "" || target.tags.length !== 0 || String(target.uRL) !== "" ||
      String(target.polarity) !== "PolarityValues.POSITIVE" ||
      !target.strokeDashes || target.strokeDashes.length !== 0) {
    throw clipUnsupported("path_state_unmeasured", uuid);
  }
  return {
    uuid: uuid,
    type: "PathItem",
    name: String(target.name || ""),
    parentType: String(expectedParent.typename),
    geometricBounds: supportedPathBounds(target.geometricBounds, "geometricBounds"),
    visibleBounds: supportedPathBounds(target.visibleBounds, "visibleBounds"),
    closed: Boolean(target.closed),
    pathPoints: pathPoints,
    filled: target.filled,
    fillColor: target.filled ? clipPaint(target.fillColor, "fillColor", uuid, admitCmyk) : null,
    stroked: target.stroked,
    strokeColor: target.stroked ? clipPaint(target.strokeColor, "strokeColor", uuid, admitCmyk) : null,
    strokeWidth: target.stroked ? supportedPathNumber(target.strokeWidth, "strokeWidth") : null,
    opacity: supportedPathNumber(target.opacity, "opacity"),
    clipping: target.clipping,
    locked: target.locked,
    hidden: target.hidden
  };
}

/**
 * Snapshot of a two-child group [PathItem, content]. The content is a PathItem, or, when allowNestedContent,
 * one more group of the same shape whose content is a PathItem. Every child is confirmed in its typed collection.
 * admitCmyk reaches this group's own paths only; a nested group is always read RGB-only (CMYK there is unmeasured).
 */
function clipGroupSnapshot(document, group, expectedParent, allowNestedContent, admitCmyk) {
  if (!group || String(group.typename) !== "GroupItem" || typeof group.uuid !== "string" || group.uuid.length === 0) {
    throw mutationError("preflight_failed", "Clip group identity is unavailable.");
  }
  var uuid = group.uuid;
  if (group.parent !== expectedParent) throw clipUnsupported("parent_unmeasured", uuid);
  if (typeof group.clipped !== "boolean" || typeof group.locked !== "boolean" || typeof group.hidden !== "boolean") {
    throw mutationError("preflight_failed", "Clip group flags are unavailable.");
  }
  if (String(group.blendingMode) !== "BlendModes.NORMAL" || String(group.note) !== "") {
    throw clipUnsupported("group_state_unmeasured", uuid);
  }
  var children = group.pageItems;
  if (!children || children.length !== 2) throw clipUnsupported("group_shape_unmeasured", uuid);
  var first = children[0];
  var second = children[1];
  var firstType = String(first.typename);
  var secondType = String(second.typename);
  if (firstType !== "PathItem" || clipTyped(document, "PathItem", String(first.uuid)) !== first) {
    throw clipUnsupported("group_shape_unmeasured", uuid);
  }
  var content;
  if (secondType === "PathItem" && clipTyped(document, "PathItem", String(second.uuid)) === second) {
    content = clipPathSnapshot(document, second, group, admitCmyk);
  } else if (secondType === "GroupItem" && allowNestedContent && clipTyped(document, "GroupItem", String(second.uuid)) === second) {
    content = clipGroupSnapshot(document, second, group, false, false);
  } else {
    throw clipUnsupported("group_shape_unmeasured", uuid);
  }
  var mask = clipPathSnapshot(document, first, group, admitCmyk);
  return {
    uuid: uuid,
    type: "GroupItem",
    name: String(group.name || ""),
    parentType: String(expectedParent.typename),
    geometricBounds: supportedPathBounds(group.geometricBounds, "group.geometricBounds"),
    visibleBounds: supportedPathBounds(group.visibleBounds, "group.visibleBounds"),
    clipped: group.clipped,
    locked: group.locked,
    hidden: group.hidden,
    childOrder: [mask.uuid, content.uuid],
    mask: mask,
    content: content
  };
}

/** The measured clip-group state: clipped group, clipping mask without appearance, unclipped content path. */
function clipIsMeasuredClipGroup(snapshot) {
  if (!snapshot.clipped || !snapshot.mask.clipping || snapshot.mask.filled || snapshot.mask.stroked) return false;
  if (snapshot.content.type === "PathItem") return snapshot.content.clipping === false;
  return clipIsMeasuredClipGroup(snapshot.content);
}

function clipCollectStates(snapshot, states) {
  states.push(snapshot);
  if (snapshot.type === "GroupItem") { clipCollectStates(snapshot.mask, states); clipCollectStates(snapshot.content, states); }
  return states;
}

function clipAddBlocker(blockers, code) {
  if (clipIndexOf(blockers, code) < 0) blockers.push(code);
}

function clipHostVersionMeasured() {
  return String(app.version) === CLIP_MEASURED_APP_VERSION;
}

function clipCommonBlockers(context, layerState, blockers) {
  if (!context.mutationAllowed) clipAddBlocker(blockers, "document_mutation_not_allowed");
  if (!clipHostVersionMeasured()) clipAddBlocker(blockers, "unsupported_host_version");
  if (!layerState.visible) clipAddBlocker(blockers, "layer_hidden");
  if (layerState.locked) clipAddBlocker(blockers, "layer_locked");
}

/** Lock and visibility of an item and everything inside it; Illustrator itself does not guard either (A35_*_LOCKED). */
function clipItemBlockers(snapshot, lockedCode, hiddenCode, blockers) {
  var states = clipCollectStates(snapshot, []);
  for (var index = 0; index < states.length; index++) {
    if (states[index].locked) clipAddBlocker(blockers, lockedCode);
    if (states[index].hidden) clipAddBlocker(blockers, hiddenCode);
  }
}

function clipEditableBlocker(items, blockers) {
  for (var index = 0; index < items.length; index++) {
    if (typeof items[index].editable !== "boolean") throw mutationError("preflight_failed", "Editable state is unavailable.");
    if (!items[index].editable) clipAddBlocker(blockers, "target_not_editable");
  }
}

function clipReferenceState(reference, expectedUuid) {
  try {
    if (typeof reference.uuid !== "string" || reference.uuid !== expectedUuid) return "mismatch";
    return "present";
  } catch (error) {
    if (error && error.name === "ReferenceError" && error.number === 45) return "invalid";
    throw error;
  }
}
`;
