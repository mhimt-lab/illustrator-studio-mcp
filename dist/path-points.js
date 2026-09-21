import { z } from 'zod';
import { canonicalSha256 } from './mutation-canonical.js';
import { MUTATION_TRANSACTION_SCRIPT } from './mutation-transaction.js';
import { documentContextSchema, layerPathSchema } from './mutation-result-schema-core.js';
import { SUPPORTED_PATH_ITEM_HOST_SCRIPT, SUPPORTED_PATH_ITEM_MAX_PATH_POINTS } from './adapters/supported-path-item-host-script.js';
export const PATH_EDIT_MEASURED_APP_VERSIONS = ['30.8.1'];
export const PATH_EDIT_TOLERANCE_PT = 0.01;
export const PATH_EDIT_MAX_POINTS = SUPPORTED_PATH_ITEM_MAX_PATH_POINTS;
export const PATH_EDIT_COORDINATE_LIMIT = 32_768;
const canonicalSixDecimals = (value) => {
    const rounded = Math.round(value * 1_000_000) / 1_000_000;
    return Object.is(rounded, -0) ? 0 : rounded;
};
const uuidSchema = z.string().min(1).max(255);
const coordinateSchema = z.number().finite().min(-PATH_EDIT_COORDINATE_LIMIT).max(PATH_EDIT_COORDINATE_LIMIT).overwrite(canonicalSixDecimals);
export const pathXYSchema = z.tuple([coordinateSchema, coordinateSchema]);
export const pathPointTypeSchema = z.enum(['corner', 'smooth']);
export const pathPointSchema = z.strictObject({
    anchor: pathXYSchema,
    leftDirection: pathXYSchema,
    rightDirection: pathXYSchema,
    pointType: pathPointTypeSchema,
});
export const pathGeometrySchema = z.strictObject({
    closed: z.boolean(),
    points: z.array(pathPointSchema).min(1).max(PATH_EDIT_MAX_POINTS),
});
export const pathTargetSnapshotSchema = z.strictObject({
    uuid: uuidSchema,
    parentType: z.literal('Layer'),
    layerPath: layerPathSchema,
    locked: z.boolean(),
    hidden: z.boolean(),
    editable: z.boolean(),
    effectiveLayerVisible: z.boolean(),
    effectiveLayerLocked: z.boolean(),
    path: pathGeometrySchema,
});
export function samePathXY(left, right) {
    return Math.abs(left[0] - right[0]) <= PATH_EDIT_TOLERANCE_PT && Math.abs(left[1] - right[1]) <= PATH_EDIT_TOLERANCE_PT;
}
export function samePathGeometry(left, right) {
    if (left.closed !== right.closed || left.points.length !== right.points.length)
        return false;
    return left.points.every((point, index) => {
        const other = right.points[index];
        return point.pointType === other.pointType && samePathXY(point.anchor, other.anchor) &&
            samePathXY(point.leftDirection, other.leftDirection) && samePathXY(point.rightDirection, other.rightDirection);
    });
}
export function sameCanonical(left, right) {
    return canonicalSha256(left) === canonicalSha256(right);
}
export function samePathTarget(left, right) {
    const { path: leftPath, ...leftRest } = left;
    const { path: rightPath, ...rightRest } = right;
    return sameCanonical(leftRest, rightRest) && samePathGeometry(leftPath, rightPath);
}
export const pathEditBlockerSchema = z.enum(['document_mutation_not_allowed', 'host_version_unverified', 'target_locked', 'target_hidden',
    'target_not_editable', 'layer_hidden', 'layer_locked']);
export function pathEditBlockers(mutationAllowed, appVersion, before) {
    const blockers = [];
    if (!mutationAllowed)
        blockers.push('document_mutation_not_allowed');
    if (!PATH_EDIT_MEASURED_APP_VERSIONS.includes(appVersion))
        blockers.push('host_version_unverified');
    const initial = blockers.length;
    if (before.locked)
        blockers.push('target_locked');
    if (before.hidden)
        blockers.push('target_hidden');
    if (!before.effectiveLayerVisible)
        blockers.push('layer_hidden');
    if (before.effectiveLayerLocked)
        blockers.push('layer_locked');
    if (!before.editable && blockers.length === initial)
        blockers.push('target_not_editable');
    return blockers;
}
export const getPathPointsResultSchema = z.strictObject({
    document: documentContextSchema,
    target: pathTargetSnapshotSchema,
    editBlockedReasonCodes: z.array(pathEditBlockerSchema),
}).superRefine((value, context) => {
    if (!sameCanonical(value.editBlockedReasonCodes, pathEditBlockers(value.document.mutationAllowed, value.document.appVersion, value.target))) {
        context.addIssue({ code: 'custom', message: 'Path read must expose the exact edit blockers.' });
    }
});
export const PATH_POINTS_READ_MODULE_SCRIPT = `
var PATH_EDIT_MEASURED_APP_VERSIONS = ${JSON.stringify(PATH_EDIT_MEASURED_APP_VERSIONS)};
var PATH_EDIT_TOLERANCE_PT = ${PATH_EDIT_TOLERANCE_PT};
var PATH_EDIT_MAX_POINTS = ${PATH_EDIT_MAX_POINTS};
var PATH_EDIT_COORDINATE_LIMIT = ${PATH_EDIT_COORDINATE_LIMIT};

function pathEditFailTarget(code, uuid, actual) {
  var detail = { code: code, uuid: uuid };
  if (actual !== undefined) detail.actual = actual;
  throw new Error("MCP_ERROR:" + stringifyJson(detail));
}
function pathEditContains(list, value) { for (var i = 0; i < list.length; i++) if (list[i] === value) return true; return false; }
function pathEditCoordinate(value, label) {
  var number = mutationFiniteNumber(value, label);
  if (number < -PATH_EDIT_COORDINATE_LIMIT || number > PATH_EDIT_COORDINATE_LIMIT) throw mutationError("preflight_failed", label + " is outside the supported coordinate range.");
  var rounded = Math.round(number * 1000000) / 1000000;
  return rounded === 0 ? 0 : rounded;
}
function pathEditPoint(value, label) {
  if (!value || value.length !== 2) throw mutationError("preflight_failed", label + " must be an [x, y] pair.");
  return [pathEditCoordinate(value[0], label + "[0]"), pathEditCoordinate(value[1], label + "[1]")];
}
function pathEditReadPointType(value) {
  var text = String(value);
  if (text === "PointType.CORNER") return "corner";
  if (text === "PointType.SMOOTH") return "smooth";
  throw mutationError("preflight_failed", "Unsupported path-point type.");
}

/** supportedPathFind resolution, re-confirmed in the typed pathItems collection; CompoundPathItem members are refused. */
function pathEditResolveTarget(document, uuid) {
  if (typeof uuid !== "string" || uuid.length === 0) throw mutationError("preflight_failed", "target_uuid is required.");
  var target = supportedPathFind(document, uuid);
  if (target === null) pathEditFailTarget("OBJECT_NOT_FOUND", uuid);
  if (String(target.typename) !== "PathItem") pathEditFailTarget("PATH_TARGET_UNSUPPORTED", uuid, "not_path_item:" + String(target.typename));
  if (typeof target.uuid !== "string" || target.uuid !== uuid) throw mutationError("preflight_failed", "Target native UUID is unavailable or changed.");
  var matches = 0;
  for (var index = 0; index < document.pathItems.length; index++) {
    var candidate = document.pathItems[index];
    if (String(candidate.uuid) !== uuid) continue;
    if (String(candidate.typename) !== "PathItem") pathEditFailTarget("PATH_TARGET_UNSUPPORTED", uuid, "typed_collection_mismatch");
    matches++;
  }
  if (matches !== 1) pathEditFailTarget("PATH_TARGET_UNSUPPORTED", uuid, "typed_collection_mismatch");
  for (var compoundIndex = 0; compoundIndex < document.compoundPathItems.length; compoundIndex++) {
    var members = document.compoundPathItems[compoundIndex].pathItems;
    for (var memberIndex = 0; memberIndex < members.length; memberIndex++) {
      if (String(members[memberIndex].uuid) === uuid) pathEditFailTarget("PATH_TARGET_UNSUPPORTED", uuid, "compound_path_member");
    }
  }
  return target;
}
/** Layer-direct PathItems only (the measured fixture); group and CompoundPathItem members are refused. */
function pathEditParent(target, uuid) {
  var parent = target.parent;
  if (!parent) throw mutationError("preflight_failed", "Target parent is unavailable.");
  var typename = String(parent.typename);
  if (typename === "CompoundPathItem") pathEditFailTarget("PATH_TARGET_UNSUPPORTED", uuid, "compound_path_member");
  if (typename !== "Layer") pathEditFailTarget("PATH_TARGET_UNSUPPORTED", uuid, "unsupported_parent:" + typename);
  if (parent !== target.layer) throw mutationError("preflight_failed", "Target layer identity is inconsistent.");
  return parent;
}
function pathEditSnapshot(document, target, uuid) {
  if (!target || String(target.typename) !== "PathItem" || typeof target.uuid !== "string" || target.uuid !== uuid) {
    throw mutationError("preflight_failed", "Target native identity changed.");
  }
  pathEditParent(target, uuid);
  var layerInfo = supportedPathLayerChain(document, target.layer);
  if (layerInfo === null) throw mutationError("preflight_failed", "Target layer path is unavailable.");
  var effectiveVisible = true, effectiveLocked = false;
  for (var layerIndex = 0; layerIndex < layerInfo.chain.length; layerIndex++) {
    var layer = layerInfo.chain[layerIndex];
    if (typeof layer.visible !== "boolean" || typeof layer.locked !== "boolean") throw mutationError("preflight_failed", "Layer safety state is unavailable.");
    if (!layer.visible) effectiveVisible = false;
    if (layer.locked) effectiveLocked = true;
  }
  if (typeof target.locked !== "boolean" || typeof target.hidden !== "boolean" || typeof target.editable !== "boolean" ||
      typeof target.closed !== "boolean" || typeof target.clipping !== "boolean" || typeof target.guides !== "boolean") {
    throw mutationError("preflight_failed", "Target path state is unavailable.");
  }
  if (target.clipping || target.guides) pathEditFailTarget("PATH_TARGET_UNSUPPORTED", uuid, "clipping_or_guide");
  var count = target.pathPoints && typeof target.pathPoints.length === "number" ? target.pathPoints.length : -1;
  if (count < 1 || count > PATH_EDIT_MAX_POINTS) pathEditFailTarget("PATH_TARGET_UNSUPPORTED", uuid, "point_count");
  var points = [];
  for (var pointIndex = 0; pointIndex < count; pointIndex++) {
    var point = target.pathPoints[pointIndex];
    var label = "pathPoints[" + pointIndex + "]";
    points.push({
      anchor: pathEditPoint(point.anchor, label + ".anchor"),
      leftDirection: pathEditPoint(point.leftDirection, label + ".leftDirection"),
      rightDirection: pathEditPoint(point.rightDirection, label + ".rightDirection"),
      pointType: pathEditReadPointType(point.pointType)
    });
  }
  return {
    uuid: target.uuid, parentType: "Layer", layerPath: layerInfo.path,
    locked: target.locked, hidden: target.hidden, editable: target.editable,
    effectiveLayerVisible: effectiveVisible, effectiveLayerLocked: effectiveLocked,
    path: { closed: target.closed, points: points }
  };
}
function pathEditSamePoint(left, right) {
  return !!left && !!right && left.length === 2 && right.length === 2 &&
    Math.abs(left[0] - right[0]) <= PATH_EDIT_TOLERANCE_PT && Math.abs(left[1] - right[1]) <= PATH_EDIT_TOLERANCE_PT;
}
function pathEditSameGeometry(left, right) {
  if (!left || !right || typeof left.closed !== "boolean" || left.closed !== right.closed || !left.points || !right.points ||
      left.points.length !== right.points.length) return false;
  for (var index = 0; index < left.points.length; index++) {
    var a = left.points[index], b = right.points[index];
    if (!a || !b || a.pointType !== b.pointType || !pathEditSamePoint(a.anchor, b.anchor) ||
        !pathEditSamePoint(a.leftDirection, b.leftDirection) || !pathEditSamePoint(a.rightDirection, b.rightDirection)) return false;
  }
  return true;
}
function pathEditSameTarget(left, right) {
  return left.uuid === right.uuid && left.parentType === right.parentType && mutationSameSequence(left.layerPath, right.layerPath) &&
    left.locked === right.locked && left.hidden === right.hidden && left.editable === right.editable &&
    left.effectiveLayerVisible === right.effectiveLayerVisible && left.effectiveLayerLocked === right.effectiveLayerLocked &&
    pathEditSameGeometry(left.path, right.path);
}
function pathEditBlockers(context, before) {
  var blockers = [];
  if (!context.mutationAllowed) blockers.push("document_mutation_not_allowed");
  if (!pathEditContains(PATH_EDIT_MEASURED_APP_VERSIONS, String(context.appVersion))) blockers.push("host_version_unverified");
  var initial = blockers.length;
  if (before.locked) blockers.push("target_locked");
  if (before.hidden) blockers.push("target_hidden");
  if (!before.effectiveLayerVisible) blockers.push("layer_hidden");
  if (before.effectiveLayerLocked) blockers.push("layer_locked");
  if (!before.editable && blockers.length === initial) blockers.push("target_not_editable");
  return blockers;
}
`;
export const GET_PATH_POINTS_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${SUPPORTED_PATH_ITEM_HOST_SCRIPT}
${PATH_POINTS_READ_MODULE_SCRIPT}
var pathReadContext = requireDocumentForRead(params.expectedDocumentKey);
var pathReadDocument = app.activeDocument;
var pathReadTarget = pathEditResolveTarget(pathReadDocument, params.uuid);
var pathReadSnapshot = pathEditSnapshot(pathReadDocument, pathReadTarget, params.uuid);
var result = { document: pathReadContext, target: pathReadSnapshot, editBlockedReasonCodes: pathEditBlockers(pathReadContext, pathReadSnapshot) };
`;
export function pathEditErrorMessage(detail) {
    if (detail?.code === 'OBJECT_NOT_FOUND')
        return `No PageItem with UUID ${JSON.stringify(detail.uuid ?? '')} exists in the bound document.`;
    if (detail?.code === 'PATH_TARGET_UNSUPPORTED')
        return `The item with UUID ${JSON.stringify(detail.uuid ?? '')} is not a supported path target (${detail.actual ?? 'unsupported'}). Only a PathItem directly on a layer (not inside a group or CompoundPathItem, not a clipping path or guide) with 1 to ${PATH_EDIT_MAX_POINTS} points is supported.`;
    if (detail?.code === 'PATH_FINGERPRINT_MISMATCH')
        return `The path of ${JSON.stringify(detail.uuid ?? '')} does not match expected_path; read it again with illustrator_get_path_points.`;
    if (detail?.code === 'PATH_EDIT_APPLY_BLOCKED')
        return `Path edit is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}.`;
    return null;
}
