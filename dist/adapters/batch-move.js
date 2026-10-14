import { z } from 'zod';
import { canonicalSha256 } from '../mutation-canonical.js';
import { PUBLISHED_AS_KEY, PUBLISHED_DEPTH_KEY } from '../published-tool-schema.js';
import { duplicateObjectSnapshotSchema } from './duplicate-object-adapter.js';
import { MOVE_OBJECT_TO_LAYER_MODULE_SCRIPT, MOVE_OBJECT_TO_LAYER_OPERATION, destinationOrderBeforeSchema, moveObjectToLayerPlanSchema, observedLayerOrderSchema, placementSchema, sourceOrderBeforeSchema, } from './move-object-to-layer-adapter.js';
import { SUPPORTED_PATH_ITEM_HOST_SCRIPT, SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS } from './supported-path-item-host-script.js';
import { defineBatchStep } from './batch-step-contract.js';
import { MOVE_OBJECT_TO_LAYER_BATCH_NEXT_CALL } from './batch-step-next-call.js';
export const BATCH_MOVE_OPERATION = MOVE_OBJECT_TO_LAYER_OPERATION;
export const BATCH_MOVE_STEP_COUNT = 2;
export const BATCH_MOVE_VERSION = '30.8.2';
export const BATCH_MOVE_RESULT_BUDGET_BYTES = 150_000;
export const BATCH_MOVE_BLOCKERS = [
    'source_layer_hidden', 'source_ancestor_hidden', 'source_layer_locked', 'source_ancestor_locked',
    'destination_layer_hidden', 'destination_ancestor_hidden', 'destination_layer_locked', 'destination_ancestor_locked',
    'destination_capacity_exceeded', 'result_size_limit_exceeded',
];
const rootLayerPathSchema = z.array(z.number().int().nonnegative()).length(1);
const moveStepShape = { operation: z.literal(BATCH_MOVE_OPERATION), placement: placementSchema };
export const internalMoveStepShape = { ...moveStepShape, destinationLayerPath: rootLayerPathSchema };
export const publicMoveStepShape = { ...moveStepShape, destination_layer_path: rootLayerPathSchema };
const echoedSnapshotSchema = z.union([duplicateObjectSnapshotSchema]).meta({ [PUBLISHED_DEPTH_KEY]: 0 });
export const internalMoveApplyShape = {
    expectedBefore: echoedSnapshotSchema, confirmedAfter: echoedSnapshotSchema,
    expectedSourceOrder: sourceOrderBeforeSchema, expectedDestinationOrder: destinationOrderBeforeSchema,
};
export const publicMoveApplyShape = {
    expected_before: echoedSnapshotSchema, confirmed_after: echoedSnapshotSchema,
    expected_source_order: sourceOrderBeforeSchema, expected_destination_order: destinationOrderBeforeSchema,
};
export { echoedSnapshotSchema as batchMoveSnapshotSchema, sourceOrderBeforeSchema as batchMoveSourceOrderSchema, destinationOrderBeforeSchema as batchMoveDestinationOrderSchema, rootLayerPathSchema as batchMoveDestinationPathSchema, placementSchema as batchMovePlacementSchema };
const PUBLISHED_OBJECT = { type: 'object' };
export const batchMovePlanSchema = z.union([moveObjectToLayerPlanSchema]).meta({ [PUBLISHED_AS_KEY]: PUBLISHED_OBJECT });
export const batchMoveEvidenceSchema = z.union([z.strictObject({
        target: duplicateObjectSnapshotSchema, sourceOrder: observedLayerOrderSchema, destinationOrder: observedLayerOrderSchema,
    })]).meta({ [PUBLISHED_AS_KEY]: PUBLISHED_OBJECT });
export function withoutUuid(order, uuid) {
    return order.filter((value) => value !== uuid);
}
export function destinationAfterMove(order, uuid, placement) {
    return placement === 'front' ? [uuid, ...order] : [...order, uuid];
}
export function simulateBatchMove(steps, sourceOrder, destinationOrder) {
    let source = [...sourceOrder];
    let destination = [...destinationOrder];
    const prefixes = [];
    for (const step of steps) {
        const sourceAfter = withoutUuid(source, step.targetUuid);
        const destinationAfter = destinationAfterMove(destination, step.targetUuid, step.placement);
        prefixes.push({ sourceBefore: source, destinationBefore: destination, sourceAfter, destinationAfter });
        source = sourceAfter;
        destination = destinationAfter;
    }
    return { prefixes, finalSource: source, finalDestination: destination };
}
export function simulateMovePlans(plans) {
    return simulateBatchMove(plans.map((plan) => ({ targetUuid: plan.targetUuid, placement: plan.placement })), plans[0].sourceOrderBefore, plans[0].destinationOrderBefore);
}
export function batchMoveAnchorKind(order, uuid) {
    const index = order.indexOf(uuid);
    if (index + 1 < order.length)
        return 'before_next';
    return index > 0 ? 'after_previous' : 'source_beginning';
}
export function batchMoveBlockers(mutationAllowed, plan, stepCount) {
    const blockers = [];
    if (!mutationAllowed)
        blockers.push('document_mutation_not_allowed');
    if (plan.before.locked)
        blockers.push('target_locked');
    if (plan.before.hidden)
        blockers.push('target_hidden');
    if (!plan.before.editable)
        blockers.push('target_not_editable');
    if (!plan.before.layerVisible)
        blockers.push('source_layer_hidden');
    if (!plan.before.effectiveLayerVisible && plan.before.layerVisible)
        blockers.push('source_ancestor_hidden');
    if (plan.before.layerLocked)
        blockers.push('source_layer_locked');
    if (plan.before.effectiveLayerLocked && !plan.before.layerLocked)
        blockers.push('source_ancestor_locked');
    if (!plan.destinationLayer.visible)
        blockers.push('destination_layer_hidden');
    if (!plan.destinationLayer.effectiveVisible && plan.destinationLayer.visible)
        blockers.push('destination_ancestor_hidden');
    if (plan.destinationLayer.locked)
        blockers.push('destination_layer_locked');
    if (plan.destinationLayer.effectiveLocked && !plan.destinationLayer.locked)
        blockers.push('destination_ancestor_locked');
    if (plan.destinationOrderBefore.length + stepCount > SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS) {
        blockers.push('destination_capacity_exceeded');
    }
    if (!plan.resultSizeWithinLimit)
        blockers.push('result_size_limit_exceeded');
    return blockers;
}
const jsonBytes = (value) => Buffer.byteLength(JSON.stringify(value));
export function batchMoveResultBytes(plans) {
    const { finalSource, finalDestination } = simulateMovePlans(plans);
    const base = plans[0];
    const sourceBaseline = jsonBytes(base.sourceOrderBefore);
    const destinationBaseline = jsonBytes(base.destinationOrderBefore);
    const sourceFinal = jsonBytes(finalSource);
    const destinationFinal = jsonBytes(finalDestination);
    let planBytes = 0;
    let postBytes = 0;
    let rollbackBytes = 0;
    for (const plan of plans) {
        const before = jsonBytes(plan.before);
        const after = jsonBytes(plan.after);
        planBytes += before + after + sourceBaseline + destinationBaseline;
        postBytes += after + sourceFinal + destinationFinal;
        rollbackBytes += Math.max(before, after) + sourceBaseline + destinationFinal;
    }
    return planBytes + Math.max(postBytes, rollbackBytes);
}
export function batchMovePlanIssue(plans) {
    if (plans.length !== BATCH_MOVE_STEP_COUNT)
        return `A layer-move batch has exactly ${BATCH_MOVE_STEP_COUNT} steps.`;
    const first = plans[0];
    const canonical = (value) => JSON.stringify(value);
    for (const plan of plans) {
        if (plan.before.layerPath.length !== 1 || plan.destinationLayer.path.length !== 1)
            return 'Layer-move batch steps use root layers only.';
        if (canonical(plan.before.layerPath) !== canonical(first.before.layerPath) ||
            canonical(plan.destinationLayer) !== canonical(first.destinationLayer) ||
            canonical(plan.sourceOrderBefore) !== canonical(first.sourceOrderBefore) ||
            canonical(plan.destinationOrderBefore) !== canonical(first.destinationOrderBefore)) {
            return 'Layer-move batch steps must share one baseline: source layer, destination layer and both complete orders.';
        }
        if (plan.destinationOrderBefore.includes(plan.targetUuid))
            return 'A layer-move target is already in the destination order.';
    }
    const targets = plans.map((plan) => plan.targetUuid);
    if (new Set(targets).size !== targets.length)
        return 'Layer-move batch targets must be distinct.';
    const { prefixes } = simulateMovePlans(plans);
    if (plans.some((plan, index) => !prefixes[index].sourceBefore.includes(plan.targetUuid) ||
        batchMoveAnchorKind(prefixes[index].sourceBefore, plan.targetUuid) === 'source_beginning')) {
        return 'A layer-move batch step whose prefix rollback anchor would be source_beginning is unmeasured.';
    }
    return null;
}
export const BATCH_MOVE_SCRIPT = `
var BATCH_MOVE_STEP_COUNT = ${BATCH_MOVE_STEP_COUNT};
var BATCH_MOVE_VERSION = ${JSON.stringify(BATCH_MOVE_VERSION)};
var BATCH_MOVE_RESULT_BUDGET_BYTES = ${BATCH_MOVE_RESULT_BUDGET_BYTES};

function batchMoveProfile(document, context) {
  if (context.appVersion !== BATCH_MOVE_VERSION) throw mutationError("preflight_failed", "Layer-move batch requires measured Illustrator " + BATCH_MOVE_VERSION + ".");
  if (context.colorSpace !== "RGB" || document.documentColorSpace !== DocumentColorSpace.RGB) {
    throw mutationError("preflight_failed", "Layer-move batch supports RGB documents only.");
  }
  batchMoveDocumentStructure(document);
}
/** The F0 fixture structure: exactly two root layers without sub-layers and one artboard. */
function batchMoveDocumentStructure(document) {
  if (document.layers.length !== 2 || document.artboards.length !== 1) {
    throw mutationError("preflight_failed", "Layer-move batch supports exactly two root layers and one artboard only.");
  }
  for (var layerIndex = 0; layerIndex < document.layers.length; layerIndex++) {
    if (document.layers[layerIndex].layers.length !== 0) throw mutationError("preflight_failed", "Layer-move batch supports root layers without sub-layers only.");
  }
}
/** A target is a plain closed four-point straight axis-aligned rectangle with RGB paint, as measured by the F0. */
function batchMoveTargetStructure(target) {
  if (String(target.typename) !== "PathItem" || target.closed !== true || target.guides !== false || target.clipping !== false ||
      target.pathPoints.length !== 4) {
    throw mutationError("preflight_failed", "Layer-move batch supports closed four-point plain PathItems only.");
  }
  if ((target.filled && String(target.fillColor.typename) !== "RGBColor") || (target.stroked && String(target.strokeColor.typename) !== "RGBColor")) {
    throw mutationError("preflight_failed", "Layer-move batch supports RGB paint only.");
  }
  var points = target.pathPoints;
  for (var pointIndex = 0; pointIndex < 4; pointIndex++) {
    var point = points[pointIndex];
    var next = points[(pointIndex + 1) % 4];
    if (!mutationSameSequence(point.anchor, point.leftDirection) || !mutationSameSequence(point.anchor, point.rightDirection) ||
        (point.anchor[0] !== next.anchor[0] && point.anchor[1] !== next.anchor[1])) {
      throw mutationError("preflight_failed", "Layer-move batch supports straight axis-aligned rectangles only.");
    }
  }
}
function batchMoveResolve() {
  var resolved = moveResolve(false);
  batchMoveTargetStructure(resolved.target);
  if (resolved.before.layerPath.length !== 1 || params.destinationLayerPath.length !== 1) {
    throw mutationError("preflight_failed", "Layer-move batch supports root layers only.");
  }
  return resolved;
}
function batchMoveCheckExpected(plan, request) {
  if (!mutationSameSequence(plan.sourceOrderBefore, request.expectedSourceOrder)) {
    throw mutationError("preflight_failed", "Source order does not match expected_source_order.");
  }
  if (!mutationSameSequence(plan.destinationOrderBefore, request.expectedDestinationOrder)) {
    throw mutationError("preflight_failed", "Destination order does not match expected_destination_order.");
  }
}
function batchMoveSimulate(entries) {
  var source = entries[0].plan.sourceOrderBefore;
  var destination = entries[0].plan.destinationOrderBefore;
  var prefixes = [];
  for (var index = 0; index < entries.length; index++) {
    var uuid = entries[index].step.request.targetUuid;
    var sourceAfter = moveWithout(source, uuid);
    var destinationAfter = moveDestinationAfter(destination, uuid, entries[index].step.request.placement);
    prefixes.push({ sourceBefore: source, destinationBefore: destination, sourceAfter: sourceAfter, destinationAfter: destinationAfter });
    source = sourceAfter;
    destination = destinationAfter;
  }
  return { prefixes: prefixes, finalSource: source, finalDestination: destination };
}
function batchMoveBytes(value) { return supportedPathUtf8ByteLength(stringifyJson(value)); }
function batchMoveResultBytes(entries, simulated) {
  var sourceBaseline = batchMoveBytes(entries[0].plan.sourceOrderBefore);
  var destinationBaseline = batchMoveBytes(entries[0].plan.destinationOrderBefore);
  var sourceFinal = batchMoveBytes(simulated.finalSource);
  var destinationFinal = batchMoveBytes(simulated.finalDestination);
  var planBytes = 0, postBytes = 0, rollbackBytes = 0;
  for (var index = 0; index < entries.length; index++) {
    var before = batchMoveBytes(entries[index].plan.before);
    var after = batchMoveBytes(entries[index].plan.after);
    planBytes += before + after + sourceBaseline + destinationBaseline;
    postBytes += after + sourceFinal + destinationFinal;
    rollbackBytes += Math.max(before, after) + sourceBaseline + destinationFinal;
  }
  return planBytes + Math.max(postBytes, rollbackBytes);
}
/** Called once with every resolved move step, before any write: shared baseline, capacity and aggregate result size. */
function batchMoveCommon(entries) {
  if (entries.length !== BATCH_MOVE_STEP_COUNT) throw mutationError("preflight_failed", "Layer-move batch requires exactly " + BATCH_MOVE_STEP_COUNT + " steps.");
  var first = entries[0];
  for (var index = 1; index < entries.length; index++) {
    var entry = entries[index];
    if (entry.resolved.sourceInfo.layer !== first.resolved.sourceInfo.layer) {
      throw mutationError("preflight_failed", "Layer-move batch steps must share one source layer.");
    }
    if (entry.resolved.destinationInfo.layer !== first.resolved.destinationInfo.layer) {
      throw mutationError("preflight_failed", "Layer-move batch steps must share one destination layer.");
    }
    if (!mutationSameSequence(entry.plan.sourceOrderBefore, first.plan.sourceOrderBefore) ||
        !mutationSameSequence(entry.plan.destinationOrderBefore, first.plan.destinationOrderBefore)) {
      throw mutationError("preflight_failed", "Layer-move batch steps must read one complete shared baseline order.");
    }
  }
  var simulated = batchMoveSimulate(entries);
  for (var anchorIndex = 0; anchorIndex < entries.length; anchorIndex++) {
    var anchorOrder = simulated.prefixes[anchorIndex].sourceBefore;
    var anchorPosition = movePosition(anchorOrder, entries[anchorIndex].step.request.targetUuid);
    if (anchorPosition < 0 || moveAnchor(anchorOrder, anchorPosition).kind === "source_beginning") {
      throw mutationError("preflight_failed", "Layer-move batch does not support a step whose prefix rollback anchor is the source beginning.");
    }
  }
  var capacity = first.plan.destinationOrderBefore.length + entries.length > MOVE_MAX_PARENT_ITEMS;
  var withinBudget = batchMoveResultBytes(entries, simulated) <= BATCH_MOVE_RESULT_BUDGET_BYTES;
  for (var blockIndex = 0; blockIndex < entries.length; blockIndex++) {
    var plan = entries[blockIndex].plan;
    var blockers = [];
    for (var codeIndex = 0; codeIndex < plan.applyBlockedReasonCodes.length; codeIndex++) {
      var code = plan.applyBlockedReasonCodes[codeIndex];
      if (code !== "destination_capacity_exceeded" && code !== "result_size_limit_exceeded") blockers.push(code);
    }
    if (capacity) blockers.push("destination_capacity_exceeded");
    if (!plan.resultSizeWithinLimit || !withinBudget) { plan.resultSizeWithinLimit = false; blockers.push("result_size_limit_exceeded"); }
    plan.applyBlockedReasonCodes = blockers;
  }
  return simulated;
}
function batchMoveRevalidate(current, original, plan) {
  if (current.resolved.sourceInfo.layer !== original.resolved.sourceInfo.layer ||
      current.resolved.destinationInfo.layer !== original.resolved.destinationInfo.layer ||
      !mutationSameSequence(current.plan.sourceOrderBefore, plan.sourceOrderBefore) ||
      !mutationSameSequence(current.plan.destinationOrderBefore, plan.destinationOrderBefore)) {
    throw mutationBeforeSideEffectError("Layer-move layers or complete baseline orders changed before apply.");
  }
}
/** The step's own view of the world: the prefix orders, and an anchor recomputed from the prefix source order. */
function batchMoveStepPreflight(entry, simulated, index) {
  var prefix = simulated.prefixes[index];
  var resolved = {};
  for (var key in entry.resolved) if (entry.resolved.hasOwnProperty(key)) resolved[key] = entry.resolved[key];
  resolved.sourceOrderBefore = prefix.sourceBefore;
  resolved.destinationOrderBefore = prefix.destinationBefore;
  resolved.sourceIndex = movePosition(prefix.sourceBefore, entry.step.request.targetUuid);
  if (resolved.sourceIndex < 0) throw mutationError("preflight_failed", "Layer-move target is absent from its prefix source order.");
  resolved.rollbackAnchor = moveAnchor(prefix.sourceBefore, resolved.sourceIndex);
  return resolved;
}
function batchMoveApply(resolved, plan, state) {
  var preflight = state.preflight;
  var prefix = state.operationState.prefix;
  if (preflight.target.parent !== preflight.sourceInfo.layer ||
      !mutationSameSequence(moveOrder(preflight.sourceInfo.layer, MOVE_MAX_PARENT_ITEMS), prefix.sourceBefore) ||
      !mutationSameSequence(moveOrder(preflight.destinationInfo.layer, MOVE_MAX_PARENT_ITEMS), prefix.destinationBefore)) {
    throw mutationError("verify_mismatch", "Layer-move step prefix changed before its write.");
  }
  moveApply(preflight, plan, state);
  if (preflight.target.parent !== preflight.destinationInfo.layer ||
      !mutationSameSequence(moveOrder(preflight.sourceInfo.layer, MOVE_MAX_PARENT_ITEMS), prefix.sourceAfter) ||
      !mutationSameSequence(moveOrder(preflight.destinationInfo.layer, MOVE_MAX_PARENT_ITEMS), prefix.destinationAfter)) {
    throw mutationError("verify_mismatch", "Layer-move step orders differ from its predicted prefix.");
  }
  return preflight.target;
}
function batchMoveVerify(resolved, plan, state) {
  if (app.documents.length === 0 || app.activeDocument !== resolved.document) {
    throw mutationError("verify_mismatch", "Active document changed during layer-move batch verification.");
  }
  var target = supportedPathFind(resolved.document, params.targetUuid);
  if (target === null || target !== resolved.target || target.parent !== resolved.destinationInfo.layer) {
    throw mutationError("verify_mismatch", "Moved target identity or destination parent does not match the plan.");
  }
  var after = supportedPathSnapshot(resolved.document, target, params.targetUuid, "Layer", movePaintScope(resolved.document));
  var sourceOrder = moveOrder(resolved.sourceInfo.layer, MOVE_MAX_PARENT_ITEMS);
  var destinationOrder = moveOrder(resolved.destinationInfo.layer, MOVE_MAX_PARENT_ITEMS);
  var finalOrders = state.operationState.finalOrders;
  if (!supportedPathSame(after, plan.after) || !mutationSameSequence(sourceOrder, finalOrders.source) ||
      !mutationSameSequence(destinationOrder, finalOrders.destination)) {
    throw mutationError("verify_mismatch", "Moved target or the final complete layer orders do not match the plan.");
  }
  return { target: after, sourceOrder: sourceOrder, destinationOrder: destinationOrder };
}
function batchMoveRollbackStep(state) {
  var outcome = moveRollback(state);
  var evidence = state.operationState.rollbackEvidence;
  evidence.restoredSnapshot = evidence.restoredTarget === null ? null : { target: evidence.restoredTarget,
    sourceOrder: evidence.restoredSourceOrder, destinationOrder: evidence.restoredDestinationOrder };
  return outcome;
}
/** After every attempted inverse: both complete layer orders and both targets are read again and must equal the baseline. */
function batchMoveBaselineRestored(entries) {
  try {
    var first = entries[0];
    if (!mutationSameSequence(moveOrder(first.resolved.sourceInfo.layer, MOVE_MAX_PARENT_ITEMS), first.plan.sourceOrderBefore) ||
        !mutationSameSequence(moveOrder(first.resolved.destinationInfo.layer, MOVE_MAX_PARENT_ITEMS), first.plan.destinationOrderBefore)) return false;
    for (var index = 0; index < entries.length; index++) {
      var entry = entries[index];
      var snapshot = supportedPathSnapshot(entry.resolved.document, entry.resolved.target, entry.step.request.targetUuid, "Layer", movePaintScope(entry.resolved.document));
      if (!supportedPathSame(snapshot, entry.plan.before)) return false;
    }
    return true;
  } catch (error) { return false; }
}
function batchMoveLayers(entries) {
  var layers = [];
  for (var index = 0; index < entries.length; index++) {
    if (entries[index].step.request.operation !== "move_object_to_layer") continue;
    var wanted = [entries[index].resolved.sourceInfo.layer, entries[index].resolved.destinationInfo.layer];
    for (var wantedIndex = 0; wantedIndex < wanted.length; wantedIndex++) {
      var known = false;
      for (var layerIndex = 0; layerIndex < layers.length; layerIndex++) if (layers[layerIndex] === wanted[wantedIndex]) known = true;
      if (!known) layers.push(wanted[wantedIndex]);
    }
  }
  return layers;
}
`;
const batchMoveUuidSchema = z.string().min(1).max(255);
const batchPublicMovePlan = z.strictObject({ target_uuid: batchMoveUuidSchema, ...publicMoveStepShape });
const batchInternalMovePlan = z.strictObject({ targetUuid: batchMoveUuidSchema, ...internalMoveStepShape });
export const moveObjectToLayerBatchStep = defineBatchStep({
    operation: BATCH_MOVE_OPERATION,
    admittedProfile: 'mixed_batch_layer_move_two_root_layers_30_8_2',
    recipeAllowed: false,
    publicPlan: batchPublicMovePlan,
    publicApply: z.strictObject({ ...batchPublicMovePlan.shape, ...publicMoveApplyShape }),
    internalPlan: batchInternalMovePlan,
    internalApply: z.strictObject({ ...batchInternalMovePlan.shape, ...internalMoveApplyShape }),
    planSchema: batchMovePlanSchema,
    snapshotSchema: batchMoveEvidenceSchema,
    normalize: (step) => ({ operation: BATCH_MOVE_OPERATION, targetUuid: step.target_uuid,
        destinationLayerPath: step.destination_layer_path, placement: step.placement,
        ...('expected_before' in step ? { expectedBefore: step.expected_before, confirmedAfter: step.confirmed_after,
            expectedSourceOrder: step.expected_source_order, expectedDestinationOrder: step.expected_destination_order } : {}) }),
    request: (plan) => ({ destinationLayer: plan.destinationLayer, placement: plan.placement }),
    same: (left, right) => canonicalSha256(left) === canonicalSha256(right),
    planBlockers: (mutationAllowed, plan, stepCount) => batchMoveBlockers(mutationAllowed, plan, stepCount),
    nextCall: MOVE_OBJECT_TO_LAYER_BATCH_NEXT_CALL,
    host: {
        fragments: [
            { id: 'supported-path-item', source: SUPPORTED_PATH_ITEM_HOST_SCRIPT },
            { id: 'move-object-to-layer.module', source: MOVE_OBJECT_TO_LAYER_MODULE_SCRIPT },
            { id: 'batch-move', source: BATCH_MOVE_SCRIPT },
        ],
        hooks: { resolve: 'batchMoveResolve', plan: 'movePlan', same: 'supportedPathSame', apply: 'batchMoveApply', verify: 'batchMoveVerify',
            rollback: 'batchMoveRollbackStep', checkExpected: 'batchMoveCheckExpected', revalidate: 'batchMoveRevalidate' },
        paramFields: ['destinationLayerPath', 'placement'],
        dispatchLayout: `  move_object_to_layer: { resolve: batchMoveResolve, plan: movePlan, same: supportedPathSame, apply: batchMoveApply, verify: batchMoveVerify,
    rollback: batchMoveRollbackStep, checkExpected: batchMoveCheckExpected, revalidate: batchMoveRevalidate }`,
    },
});
