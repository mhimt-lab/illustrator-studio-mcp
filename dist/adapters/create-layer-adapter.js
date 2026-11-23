import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema } from '../mutation-result-schema-core.js';
import { canonicalDigest, operationSafetyPolicyToMcpAnnotations } from '../operation-safety-policy-core.js';
import { LAYER_OPS_HOST_SCRIPT } from './layer-ops-host-script.js';
import { classifyLayerTerminal, containerPathSchema, containerTargetSchema, insertSiblings, createLayerBlockerSchema, layerBlockers, layerDocumentKeySchema, layerIdentityToken, layerNameSchema, layerPathSchema, layerSafetyAsserter, layerSafetyRegistration, layerTransactionSchema, LAYER_OPS_MAX_SIBLINGS, NEW_LAYER_DEFAULTS, sameCanonical, referenceSiblingBlockers, REFERENCE_SIBLING_BLOCKER, siblingEntrySchema, siblingOrderSchema, } from './layer-ops-shared.js';
import { mapLayerExecutionError } from './reorder-layer-adapter.js';
import { CREATE_LAYER_RESULT_ADMISSION, CREATE_LAYER_RESULT_SIZE_SCRIPT, createLayerResultSizeMessage, createLayerResultTooLarge } from './create-layer-result-size.js';
export const CREATE_LAYER_OPERATION = 'create_layer';
export const CREATE_LAYER_VALIDATOR = { kind: CREATE_LAYER_OPERATION, version: 1 };
const CANONICAL_VERSION = 1;
const RESULT_SCHEMA_VERSION = 1;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
const positionSchema = z.number().int().nonnegative().max(LAYER_OPS_MAX_SIBLINGS);
export const CREATE_LAYER_MAX_NAMES = 32;
export const createLayerPlanBlockerSchema = z.enum([...createLayerBlockerSchema.options, 'result_too_large']);
const namesSchema = z.array(layerNameSchema).min(2).max(CREATE_LAYER_MAX_NAMES);
const NAME_XOR_MESSAGE = 'Specify exactly one of name (one layer) or names (2 to 32 layers).';
export function newLayerEntry(name) {
    return { name, ...NEW_LAYER_DEFAULTS };
}
export function shiftPathForInsert(path, parentLayerPath, position, count = 1) {
    const depth = parentLayerPath.length;
    if (path.length <= depth || parentLayerPath.some((index, at) => path[at] !== index) || path[depth] < position)
        return [...path];
    return path.map((index, at) => (at === depth ? index + count : index));
}
const exactlyOneName = (value, context) => {
    if ((value.name === undefined) === (value.names === undefined))
        context.addIssue({ code: 'custom', message: NAME_XOR_MESSAGE });
};
const commonInternal = { expectedDocumentKey: layerDocumentKeySchema, name: layerNameSchema.optional(), names: namesSchema.optional(), parentLayerPath: containerPathSchema, position: positionSchema };
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }).superRefine(exactlyOneName),
    z.strictObject({ ...commonInternal, expectedContainerBefore: containerTargetSchema, expectedSiblingOrder: siblingOrderSchema, apply: z.literal(true), commandId: canonicalCommandIdSchema }).superRefine(exactlyOneName),
]);
const commonPublic = { expected_document_key: layerDocumentKeySchema, name: layerNameSchema.optional(), names: namesSchema.optional(), parent_layer_path: layerPathSchema.optional(), position: positionSchema.default(0) };
export const createLayerPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }).superRefine(exactlyOneName),
    z.strictObject({ ...commonPublic, expected_container_before: containerTargetSchema, expected_sibling_order: siblingOrderSchema, apply: z.literal(true), command_id: applyCommandIdSchema }).superRefine(exactlyOneName),
]);
const inputSchema = z.strictObject({ ...commonPublic, expected_container_before: containerTargetSchema.optional(), expected_sibling_order: siblingOrderSchema.optional(), apply: z.boolean().default(false), command_id: applyCommandIdSchema.optional() });
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(createLayerPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = createLayerPublicInputSchema.parse(input);
    const common = { expectedDocumentKey: value.expected_document_key, ...(value.name === undefined ? { names: value.names } : { name: value.name }), parentLayerPath: value.parent_layer_path ?? [], position: value.position };
    return value.apply ? { ...common, expectedContainerBefore: value.expected_container_before, expectedSiblingOrder: value.expected_sibling_order, apply: true, commandId: value.command_id } : { ...common, apply: false };
}
const planCommon = {
    operation: z.literal(CREATE_LAYER_OPERATION),
    documentKey: layerDocumentKeySchema,
    parentLayerPath: containerPathSchema,
    position: positionSchema,
    containerBefore: containerTargetSchema,
    siblingOrderBefore: siblingOrderSchema,
    siblingOrderAfter: siblingOrderSchema,
    activeLayerPathBefore: layerPathSchema,
    activeLayerPathAfter: layerPathSchema,
    applyBlockedReasonCodes: z.array(createLayerPlanBlockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
};
const flatPlanSchema = z.strictObject({
    ...planCommon,
    name: layerNameSchema.optional(), createdLayer: siblingEntrySchema.optional(), createdLayerPath: layerPathSchema.optional(),
    names: namesSchema.optional(), createdLayers: z.array(siblingEntrySchema).min(2).max(CREATE_LAYER_MAX_NAMES).optional(), createdLayerPaths: z.array(layerPathSchema).min(2).max(CREATE_LAYER_MAX_NAMES).optional(),
});
function planCreatedOrNull(plan) {
    const single = plan.name !== undefined && plan.createdLayer !== undefined && plan.createdLayerPath !== undefined;
    const plural = plan.names !== undefined && plan.createdLayers !== undefined && plan.createdLayerPaths !== undefined;
    const anySingle = plan.name !== undefined || plan.createdLayer !== undefined || plan.createdLayerPath !== undefined;
    const anyPlural = plan.names !== undefined || plan.createdLayers !== undefined || plan.createdLayerPaths !== undefined;
    if (single && !anyPlural)
        return { names: [plan.name], entries: [plan.createdLayer], paths: [plan.createdLayerPath] };
    if (plural && !anySingle)
        return { names: plan.names, entries: plan.createdLayers, paths: plan.createdLayerPaths };
    return null;
}
function planCreated(plan) {
    const created = planCreatedOrNull(plan);
    if (created === null)
        throw new Error('Create-layer plan must carry the single-layer fields or the plural ones, not both and not a part.');
    return created;
}
const planSchema = flatPlanSchema.superRefine((plan, context) => {
    const created = planCreatedOrNull(plan);
    if (created === null) {
        context.addIssue({ code: 'custom', message: 'Create-layer plan must carry the single-layer fields or the plural ones, not both and not a part.' });
        return;
    }
    if (!sameCanonical(plan.containerBefore.path, plan.parentLayerPath) || plan.containerBefore.childLayerCount !== plan.siblingOrderBefore.length) {
        context.addIssue({ code: 'custom', message: 'Create-layer plan must bind the container at the parent path with its complete sibling order.' });
    }
    if (!sameCanonical(created.entries, created.names.map(newLayerEntry)) || !sameCanonical(created.paths, created.names.map((_name, index) => [...plan.parentLayerPath, plan.position + index]))) {
        context.addIssue({ code: 'custom', message: 'Create-layer plan must derive the new entries from the names and measured defaults at the requested position.' });
    }
    try {
        if (!sameCanonical(insertSiblings(plan.siblingOrderBefore, plan.position, created.entries), plan.siblingOrderAfter))
            context.addIssue({ code: 'custom', message: 'Create-layer plan after order must insert exactly the new entries.' });
    }
    catch {
        context.addIssue({ code: 'custom', message: 'Create-layer plan after order cannot be derived.' });
    }
    if (!sameCanonical(shiftPathForInsert(plan.activeLayerPathBefore, plan.parentLayerPath, plan.position, created.names.length), plan.activeLayerPathAfter))
        context.addIssue({ code: 'custom', message: 'Create-layer plan must derive the active layer path after insertion.' });
    if (plan.applyAllowed !== (plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0))
        context.addIssue({ code: 'custom', message: 'Create-layer applyAllowed must require confirmation and no blockers.' });
});
const rollbackEvidence = { restoredSiblingOrder: siblingOrderSchema.nullable(), createdLayerRemoved: z.boolean() };
const transactionSchema = layerTransactionSchema('create_layer', rollbackEvidence, { restoredSiblingOrder: null, createdLayerRemoved: false }, (evidence) => evidence.restoredSiblingOrder !== null && evidence.createdLayerRemoved);
const singlePostconditionSchema = z.strictObject({ siblingOrder: siblingOrderSchema, createdLayerPath: layerPathSchema, createdLayer: siblingEntrySchema, activeLayerPath: layerPathSchema });
const namesPostconditionSchema = z.strictObject({
    siblingOrder: siblingOrderSchema, createdLayerPaths: z.array(layerPathSchema).min(2).max(CREATE_LAYER_MAX_NAMES), createdLayers: z.array(siblingEntrySchema).min(2).max(CREATE_LAYER_MAX_NAMES), activeLayerPath: layerPathSchema,
});
const postconditionSchema = z.union([singlePostconditionSchema, namesPostconditionSchema]);
export const createLayerResultSchema = z.union([
    z.strictObject({ operation: z.literal(CREATE_LAYER_OPERATION), applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ operation: z.literal(CREATE_LAYER_OPERATION), applied: z.literal(true), document: documentContextSchema, plan: planSchema, postcondition: postconditionSchema, transaction: transactionSchema }),
]).superRefine((result, context) => {
    const created = planCreated(result.plan);
    const expectedBlockers = [
        ...layerBlockers(result.transaction.state === 'planned' ? result.document.mutationAllowed : true, result.plan.containerBefore, { targetStateBlocks: false, targetIsAncestor: true }),
        ...referenceSiblingBlockers(result.plan.siblingOrderBefore, result.plan.position),
        ...(createLayerResultTooLarge(result.plan.documentKey, result.plan.siblingOrderBefore, created.names) ? ['result_too_large'] : []),
    ];
    if (result.transaction.state === 'planned') {
        if (result.plan.confirmationStatus !== 'required' || !sameCanonical(result.plan.applyBlockedReasonCodes, expectedBlockers))
            context.addIssue({ code: 'custom', message: 'Planned layer creation must expose exact blockers.' });
    }
    else if (result.plan.confirmationStatus !== 'confirmed' || result.plan.applyBlockedReasonCodes.length !== 0 || !result.plan.applyAllowed || expectedBlockers.length !== 0) {
        context.addIssue({ code: 'custom', message: 'Applied layer creation must derive from an allowed confirmed plan.' });
    }
    if (result.applied) {
        const post = 'createdLayers' in result.postcondition
            ? { entries: result.postcondition.createdLayers, paths: result.postcondition.createdLayerPaths }
            : { entries: [result.postcondition.createdLayer], paths: [result.postcondition.createdLayerPath] };
        if (('createdLayers' in result.postcondition) !== (result.plan.names !== undefined) || result.transaction.state !== 'verified' || !sameCanonical(result.postcondition.siblingOrder, result.plan.siblingOrderAfter) ||
            !sameCanonical(post.entries, created.entries) || !sameCanonical(post.paths, created.paths) || !sameCanonical(result.postcondition.activeLayerPath, result.plan.activeLayerPathAfter)) {
            context.addIssue({ code: 'custom', message: 'Verified layer creation must match the planned order, entries, paths, and restored active layer.' });
        }
    }
    else if (result.transaction.state === 'verified')
        context.addIssue({ code: 'custom', message: 'A verified layer creation must be applied.' });
    if (result.transaction.state === 'rolled_back' && !sameCanonical(result.transaction.rollback.restoredSiblingOrder, result.plan.siblingOrderBefore)) {
        context.addIssue({ code: 'custom', message: 'Rolled-back layer creation must prove the exact baseline order.' });
    }
});
export const createLayerResponseSchema = z.strictObject({ outcome: createLayerResultSchema, delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }) });
export const CREATE_LAYER_SAFETY = layerSafetyRegistration(CREATE_LAYER_OPERATION);
export const CREATE_LAYER_SAFETY_IDENTITY = canonicalDigest(CREATE_LAYER_SAFETY);
const assertSafety = layerSafetyAsserter(CREATE_LAYER_SAFETY, (value) => {
    const result = createLayerResultSchema.parse(value);
    const plan = result.plan;
    return {
        operationId: CREATE_LAYER_OPERATION, documentKey: result.document.key, identityToken: layerIdentityToken(plan.containerBefore, plan.siblingOrderBefore),
        beforeState: { container: plan.containerBefore, siblingOrder: plan.siblingOrderBefore, activeLayerPath: plan.activeLayerPathBefore },
        afterState: { container: { ...plan.containerBefore, childLayerCount: plan.containerBefore.childLayerCount + planCreated(plan).names.length }, siblingOrder: plan.siblingOrderAfter, activeLayerPath: plan.activeLayerPathAfter },
        changeSet: { operation: CREATE_LAYER_OPERATION, ...(plan.names !== undefined ? { names: plan.names } : { name: plan.name }), parentLayerPath: plan.parentLayerPath, position: plan.position },
        blocked: plan.applyBlockedReasonCodes.length > 0, confirmationStatus: plan.confirmationStatus, applyAllowed: plan.applyAllowed,
        transactionState: result.transaction.state, applied: result.applied,
    };
});
export const CREATE_LAYER_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${LAYER_OPS_HOST_SCRIPT}
${CREATE_LAYER_RESULT_SIZE_SCRIPT}

function createLayerEntry(name) { return { name: name, visible: true, locked: false, printable: true, childLayerCount: 0, pageItemCount: 0 }; }
// \`name\` is a list of one: the plan then carries the single-layer fields, the plural fields otherwise.
function createLayerNames() { return (params.names !== undefined) ? params.names : [params.name]; }
function createLayerShiftPath(path, parentPath, position, count) {
  var depth = parentPath.length;
  var shifted = path.slice(0);
  if (path.length <= depth) return shifted;
  for (var index = 0; index < depth; index++) if (path[index] !== parentPath[index]) return shifted;
  if (path[depth] >= position) shifted[depth] = path[depth] + count;
  return shifted;
}
function createLayerInsertMany(order, index, entries) {
  if (typeof index !== "number" || Math.floor(index) !== index || index < 0 || index > order.length) throw mutationError("preflight_failed", "Layer insertion index is out of range.");
  return order.slice(0, index).concat(entries).concat(order.slice(index));
}
/** The direct layers of a container, front first: their entries and their references from one pass (the references are the identity; the length is only read, never trusted). */
function createLayerOrderRefs(container) {
  var collection = container.layers;
  var count = layerOpsCount(collection, "Layer collection");
  if (count > LAYER_OPS_MAX_SIBLINGS) throw mutationError("preflight_failed", "A layer container must hold at most " + LAYER_OPS_MAX_SIBLINGS + " direct layers.");
  var order = [];
  var refs = [];
  for (var index = 0; index < count; index++) { var layer = collection[index]; refs.push(layer); order.push(layerOpsEntry(layer)); }
  return { order: order, refs: refs };
}
function createLayerRefs(container) {
  var collection = container.layers;
  var count = layerOpsCount(collection, "Layer collection");
  var refs = [];
  for (var index = 0; index < count; index++) refs.push(collection[index]);
  return refs;
}
function createLayerPlanPaths(plan) { return (params.names !== undefined) ? plan.createdLayerPaths : [plan.createdLayerPath]; }
function createLayerResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  var names = createLayerNames();
  if (!names || typeof names.length !== "number" || names.length < 1) throw mutationError("preflight_failed", "At least one layer name is required.");
  for (var nameIndex = 0; nameIndex < names.length; nameIndex++) {
    if (!layerOpsValidName(names[nameIndex])) throw mutationError("preflight_failed", "name must not be empty, padded with whitespace, or contain control characters.");
  }
  var chain = layerOpsResolvePath(document, params.parentLayerPath, true);
  var container = layerOpsContainerOf(document, chain);
  var snapshot = layerOpsContainerSnapshot(document, chain, params.parentLayerPath);
  var orderBefore = layerOpsOrder(container);
  if (orderBefore.length + names.length > LAYER_OPS_MAX_SIBLINGS) {
    throw mutationError("preflight_failed", names.length === 1 ? "The container already holds the maximum number of direct layers."
      : "The container would hold more than " + LAYER_OPS_MAX_SIBLINGS + " direct layers (" + orderBefore.length + " existing, " + names.length + " new).");
  }
  var entries = [];
  for (var entryIndex = 0; entryIndex < names.length; entryIndex++) entries.push(createLayerEntry(names[entryIndex]));
  var orderAfter = createLayerInsertMany(orderBefore, params.position, entries);
  var activeLayer = document.activeLayer;
  var activePath = layerOpsPathOfLayer(document, activeLayer);
  if (activePath === null) throw mutationError("preflight_failed", "The active layer could not be located in the document layer tree.");
  var blockers = layerOpsBlockers(context, snapshot, false, true);
  // #582: a locked or hidden reference sibling makes move(reference, PLACEBEFORE) throw 9024; refuse before any write.
  var reference = (params.position > 0 && params.position < orderBefore.length) ? orderBefore[params.position] : null;
  if (reference !== null && (reference.locked === true || reference.visible !== true)) blockers.push("${REFERENCE_SIBLING_BLOCKER}");
  // #956: the largest result this request can produce must fit the durable result record; the limit comes from Node (params), not from this script.
  if (!params.resultAdmission || typeof params.resultAdmission.limit !== "number" || typeof params.resultAdmission.fixed !== "number") throw mutationError("preflight_failed", "The result size admission is missing.");
  if (createLayerResultBytes(params.resultAdmission.fixed, context.key, orderBefore, names) > params.resultAdmission.limit) blockers.push("result_too_large");
  if (forApply) {
    if (!layerOpsSameTarget(snapshot, params.expectedContainerBefore)) throw mutationError("preflight_failed", "Container state does not match expected_container_before.");
    if (!layerOpsSameOrder(orderBefore, params.expectedSiblingOrder)) throw mutationError("preflight_failed", "Sibling order does not match expected_sibling_order.");
    if (blockers.length > 0) throw new Error("MCP_ERROR:" + stringifyJson({ code: "LAYER_APPLY_BLOCKED", reasonCodes: blockers, layerPath: params.parentLayerPath, name: reference === null ? null : reference.name }));
  }
  return { context: context, document: document, container: container, snapshot: snapshot, names: names, entries: entries, orderBefore: orderBefore, orderAfter: orderAfter,
    activeLayer: activeLayer, activePath: activePath, blockers: blockers };
}
function createLayerPlan(preflight) {
  var single = (params.names === undefined);
  var paths = [];
  for (var pathIndex = 0; pathIndex < preflight.names.length; pathIndex++) paths.push(params.parentLayerPath.concat([params.position + pathIndex]));
  var plan = { operation: "create_layer", documentKey: preflight.context.key };
  if (single) plan.name = params.name; else plan.names = params.names;
  plan.parentLayerPath = params.parentLayerPath;
  plan.position = params.position;
  plan.containerBefore = preflight.snapshot;
  plan.siblingOrderBefore = preflight.orderBefore;
  plan.siblingOrderAfter = preflight.orderAfter;
  if (single) { plan.createdLayer = preflight.entries[0]; plan.createdLayerPath = paths[0]; } else { plan.createdLayers = preflight.entries; plan.createdLayerPaths = paths; }
  plan.activeLayerPathBefore = preflight.activePath;
  plan.activeLayerPathAfter = createLayerShiftPath(preflight.activePath, params.parentLayerPath, params.position, preflight.names.length);
  plan.applyBlockedReasonCodes = preflight.blockers;
  plan.confirmationStatus = params.apply === true ? "confirmed" : "required";
  plan.applyAllowed = params.apply === true && preflight.blockers.length === 0;
  return plan;
}
function createLayerRevalidate(preflight, plan) {
  var current;
  try { current = createLayerResolve(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Create-layer preconditions changed before apply.")); }
  if (current.document !== preflight.document || current.container !== preflight.container || current.activeLayer !== preflight.activeLayer ||
      !layerOpsSameTarget(current.snapshot, plan.containerBefore) || !layerOpsSameOrder(current.orderBefore, plan.siblingOrderBefore) || !mutationSameSequence(current.activePath, plan.activeLayerPathBefore)) {
    throw mutationBeforeSideEffectError("Container identity, sibling order, or active layer changed before apply.");
  }
}
/** \`layers.add()\` puts a layer at index 0, so position 0 adds in reverse; every other position adds in order and moves each layer before the same baseline reference (or to the end). */
function createLayerAddOne(preflight, state, index) {
  var operationState = state.operationState;
  var baseline = operationState.baselineRefs;
  var created = preflight.container.layers.add();
  operationState.created.push(created);
  operationState.createdByIndex[index] = created;
  created.name = preflight.names[index];
  if (params.position > 0) {
    if (params.position >= baseline.length) created.move(preflight.container, ElementPlacement.PLACEATEND);
    else created.move(baseline[params.position], ElementPlacement.PLACEBEFORE);
  }
}
function createLayerApply(preflight, plan, state) {
  var operationState = state.operationState;
  operationState.baselineRefs = createLayerRefs(preflight.container);
  operationState.mutationStarted = true;
  if (params.position === 0) { for (var back = preflight.names.length - 1; back >= 0; back--) createLayerAddOne(preflight, state, back); }
  else { for (var forward = 0; forward < preflight.names.length; forward++) createLayerAddOne(preflight, state, forward); }
  preflight.document.activeLayer = preflight.activeLayer;
  operationState.activeRestored = true;
  return { created: true };
}
function createLayerVerify(preflight, plan, state) {
  layerOpsRequireSameDocument(preflight.document, "verify_mismatch");
  var operationState = state.operationState;
  var baseline = operationState.baselineRefs;
  var byIndex = operationState.createdByIndex;
  var expectedRefs = baseline.slice(0, params.position).concat(byIndex).concat(baseline.slice(params.position));
  var read = createLayerOrderRefs(preflight.container);
  if (!layerOpsSameOrder(read.order, plan.siblingOrderAfter)) throw mutationError("verify_mismatch", "Sibling order does not match the planned order after creation.");
  // The identity of every position, from the references this transaction holds: the entries above can match while a layer of the same look sits in another place.
  if (read.refs.length !== expectedRefs.length) throw mutationError("verify_mismatch", "The container does not hold the baseline plus the created layers.");
  for (var refIndex = 0; refIndex < expectedRefs.length; refIndex++) {
    if (read.refs[refIndex] !== expectedRefs[refIndex]) throw mutationError("verify_mismatch", "The created layer reference is not at the requested position.");
  }
  var paths = createLayerPlanPaths(plan);
  var createdEntries = [];
  for (var createdIndex = 0; createdIndex < paths.length; createdIndex++) {
    createdEntries.push(read.order[params.position + createdIndex]);
    var chain = layerOpsResolvePath(preflight.document, paths[createdIndex], false);
    if (chain[chain.length - 1] !== byIndex[createdIndex]) throw mutationError("verify_mismatch", "A created layer path does not resolve to the created layer.");
  }
  if (preflight.document.activeLayer !== preflight.activeLayer) throw mutationError("verify_mismatch", "The active layer was not restored.");
  var activePath = layerOpsPathOfLayer(preflight.document, preflight.document.activeLayer);
  if (activePath === null || !mutationSameSequence(activePath, plan.activeLayerPathAfter)) throw mutationError("verify_mismatch", "The restored active layer path does not match the plan.");
  if (params.names === undefined) return { siblingOrder: read.order, createdLayerPath: paths[0], createdLayer: createdEntries[0], activeLayerPath: activePath };
  return { siblingOrder: read.order, createdLayerPaths: paths, createdLayers: createdEntries, activeLayerPath: activePath };
}
/**
 * Removes only the captured, still-empty layers this command created (all of them empty before the first removal, newest first), then restores the active
 * layer and proves the baseline order by the references and entries recorded before the first write. Any doubt (a count that is not baseline + created, a layer
 * that is not empty or not found) leaves the document untouched and the outcome indeterminate.
 */
function createLayerRollback(state) {
  var preflight = state.preflight;
  var operationState = state.operationState;
  var created = operationState.created;
  var baseline = operationState.baselineRefs;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
  if (!created || created.length === 0 || !baseline) return { status: "indeterminate", message: "Rollback refused because the created layer reference was not captured." };
  var refs;
  try { refs = createLayerRefs(preflight.container); } catch (e) { return { status: "indeterminate", message: "Rollback layer lookup is indeterminate." }; }
  if (refs.length !== baseline.length + created.length) return { status: "indeterminate", message: "Rollback refused because the container does not hold exactly the baseline plus the created layer" + (created.length === 1 ? "." : "s.") };
  var index;
  for (index = 0; index < created.length; index++) {
    var found = false;
    for (var at = 0; at < refs.length; at++) if (refs[at] === created[index]) { found = true; break; }
    if (!found) return { status: "indeterminate", message: "Rollback refused because the created layer was not found in the container." };
  }
  for (index = 0; index < created.length; index++) {
    var empty;
    try { empty = created[index].layers.length === 0 && created[index].pageItems.length === 0; } catch (e) { return { status: "indeterminate", message: "Rollback refused because the created layer contents are unreadable." }; }
    if (!empty) return { status: "indeterminate", message: "Rollback refused because the created layer is not empty." };
  }
  for (index = created.length - 1; index >= 0; index--) {
    try { created[index].remove(); } catch (removeError) { return { status: "indeterminate", message: "Rollback removal is indeterminate after " + (created.length - 1 - index) + " of " + created.length + " layers." }; }
  }
  operationState.rollbackEvidence.createdLayerRemoved = true;
  try { preflight.document.activeLayer = preflight.activeLayer; } catch (activeError) { return { status: "indeterminate", message: "Rollback active-layer restore is indeterminate." }; }
  var restored;
  try { restored = createLayerOrderRefs(preflight.container); } catch (e) { return { status: "indeterminate", message: "Rollback verification is indeterminate." }; }
  operationState.rollbackEvidence.restoredSiblingOrder = restored.order;
  var sameRefs = restored.refs.length === baseline.length;
  for (index = 0; sameRefs && index < baseline.length; index++) if (restored.refs[index] !== baseline[index]) sameRefs = false;
  if (!sameRefs || !layerOpsSameOrder(restored.order, preflight.orderBefore)) return { status: "failed", message: "Rollback did not restore the exact baseline sibling order." };
  if (preflight.document.activeLayer !== preflight.activeLayer) return { status: "failed", message: "Rollback did not restore the active layer." };
  return { status: "verified" };
}

var createLayerExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionLayers: function (phase, preflight, plan, state) { return (phase === "after") ? state.operationState.created.slice(0) : []; },
  // the items this change reads and writes, so an edit session can advance its item aggregate.
  editSessionAffected: function () { if (params.parentLayerPath.length > 0) throw mutationError("plan_failed", "An edit session has not measured sublayers; create the layer at the document root."); return []; },
  initialOperationState: function () { return { mutationStarted: false, baselineRefs: null, created: [], createdByIndex: [], activeRestored: false, rollbackEvidence: { restoredSiblingOrder: null, createdLayerRemoved: false } }; },
  preflight: createLayerResolve,
  plan: createLayerPlan,
  revalidate: createLayerRevalidate,
  applyMutation: createLayerApply,
  verify: createLayerVerify,
  rollback: createLayerRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () { return { reasonCode: "layer_state_unknown", message: "Create-layer apply outcome is indeterminate.", evidence: { restoredSiblingOrder: null, createdLayerRemoved: false } }; },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});
var createLayerDocument = createLayerExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === createLayerExecution.preflight.document) createLayerDocument = getDocumentContext();
var result = { operation: "create_layer", applied: createLayerExecution.transaction.state === "verified", document: createLayerDocument, plan: createLayerExecution.plan, transaction: createLayerExecution.transaction };
if (createLayerExecution.transaction.state === "verified") result.postcondition = createLayerExecution.value;
`;
export const CREATE_LAYER_HOST_SCRIPT_DIGEST = canonicalSha256(CREATE_LAYER_SCRIPT);
export const CREATE_LAYER_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: CREATE_LAYER_OPERATION, validator: CREATE_LAYER_VALIDATOR,
    canonicalContractVersion: CANONICAL_VERSION, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: CREATE_LAYER_SAFETY_IDENTITY, hostScriptDigest: CREATE_LAYER_HOST_SCRIPT_DIGEST,
});
function normalizedRequest(input) {
    const parsed = internalInputSchema.parse(input);
    const digestRequest = 'commandId' in parsed ? (({ commandId: _commandId, ...rest }) => rest)(parsed) : parsed;
    const digest = canonicalSha256({ operation: CREATE_LAYER_OPERATION, validator: CREATE_LAYER_VALIDATOR, request: digestRequest });
    const request = { ...parsed, resultAdmission: CREATE_LAYER_RESULT_ADMISSION };
    return { intent: parsed.apply ? 'apply' : 'plan', request, commandId: 'commandId' in parsed ? parsed.commandId : null, documentKey: parsed.expectedDocumentKey, digest };
}
export const createLayerToolContract = {
    name: 'illustrator_create_layer',
    title: 'Plan or Create Layers',
    description: 'Plan or create empty layers among the direct layers of the document root or of parent_layer_path (root-relative, from illustrator_list_layers). Give name for one layer, or names (2 to 32) for several in one plan and one apply: they are created in the given order, the first at position (0 = front, the default), the next behind it. Each new layer is visible, unlocked, printable and empty. Apply uses compare-and-set on the container and its sibling order, adds the layers, restores the previous active layer, and verifies the whole order by read-back; on failure only the still-empty created layers are removed, and anything else stays indeterminate. A locked or hidden container or ancestor is refused before any write, and so is a position whose reference sibling is locked or hidden (reference_sibling_locked_or_hidden): unlock or show it, or choose another position such as the end; nothing is unlocked for you. A container holds at most 256 direct layers; a request whose result would not fit the result record is blocked (result_too_large). Names are 1-255 characters without leading or trailing whitespace or control characters; a duplicate name is allowed.',
    inputSchema,
    publicInputSchema: createLayerPublicInputSchema,
    outputSchema: createLayerResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(CREATE_LAYER_SAFETY.policy),
    normalizePublicInput,
};
async function admitCreateLayer(input) {
    const request = input;
    if (request.apply === true && request.expectedSiblingOrder !== undefined && request.expectedDocumentKey !== undefined) {
        const names = request.names ?? (request.name === undefined ? [] : [request.name]);
        if (createLayerResultTooLarge(request.expectedDocumentKey, request.expectedSiblingOrder, names))
            throw new Error(createLayerResultSizeMessage(request.expectedDocumentKey, request.expectedSiblingOrder, names));
    }
    return input;
}
export function mapCreateLayerExecutionError(error, detail) {
    if (detail?.code === 'LAYER_APPLY_BLOCKED' && detail.reasonCodes?.includes('result_too_large')) {
        return new Error(`Layer change is blocked: ${detail.reasonCodes.join(', ')}. The result of this change would not fit the result record: shorten the layer names, create fewer layers per call, or create them under a layer with fewer siblings, then plan again.`);
    }
    return mapLayerExecutionError(error, detail);
}
export function createCreateLayerAdapter() {
    return {
        version: 1, operation: CREATE_LAYER_OPERATION, validator: CREATE_LAYER_VALIDATOR,
        safety: CREATE_LAYER_SAFETY, safetyRegistrationIdentity: CREATE_LAYER_SAFETY_IDENTITY,
        adapterIdentity: CREATE_LAYER_ADAPTER_IDENTITY, tool: createLayerToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: createLayerResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
        safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: CREATE_LAYER_HOST_SCRIPT_DIGEST,
        admit: admitCreateLayer,
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: CREATE_LAYER_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: CREATE_LAYER_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: CREATE_LAYER_OPERATION, documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: CREATE_LAYER_ADAPTER_IDENTITY, script: CREATE_LAYER_SCRIPT, params };
        },
        classifyTerminal(value) { return classifyLayerTerminal(createLayerResultSchema.parse(value).transaction.state, 'Create-layer'); },
        assertSafetyConformance: assertSafety,
        mapExecutionError: mapCreateLayerExecutionError,
    };
}
