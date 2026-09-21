import { z } from 'zod';
import { canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema } from '../mutation-result-schema-core.js';
import { canonicalDigest, operationSafetyPolicyToMcpAnnotations } from '../operation-safety-policy-core.js';
import { LAYER_OPS_HOST_SCRIPT } from './layer-ops-host-script.js';
import { classifyLayerTerminal, containerPathSchema, containerTargetSchema, insertSibling, layerBlockers, layerBlockerSchema, layerDocumentKeySchema, layerIdentityToken, layerNameSchema, layerPathSchema, layerSafetyAsserter, layerSafetyRegistration, layerTransactionSchema, LAYER_OPS_MAX_SIBLINGS, NEW_LAYER_DEFAULTS, sameCanonical, siblingEntrySchema, siblingOrderSchema, } from './layer-ops-shared.js';
import { mapLayerExecutionError } from './reorder-layer-adapter.js';
export const CREATE_LAYER_OPERATION = 'create_layer';
export const CREATE_LAYER_VALIDATOR = { kind: CREATE_LAYER_OPERATION, version: 1 };
const CANONICAL_VERSION = 1;
const RESULT_SCHEMA_VERSION = 1;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
const positionSchema = z.number().int().nonnegative().max(LAYER_OPS_MAX_SIBLINGS);
export function newLayerEntry(name) {
    return { name, ...NEW_LAYER_DEFAULTS };
}
export function shiftPathForInsert(path, parentLayerPath, position) {
    const depth = parentLayerPath.length;
    if (path.length <= depth || parentLayerPath.some((index, at) => path[at] !== index) || path[depth] < position)
        return [...path];
    return path.map((index, at) => (at === depth ? index + 1 : index));
}
const commonInternal = { expectedDocumentKey: layerDocumentKeySchema, name: layerNameSchema, parentLayerPath: containerPathSchema, position: positionSchema };
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({ ...commonInternal, expectedContainerBefore: containerTargetSchema, expectedSiblingOrder: siblingOrderSchema, apply: z.literal(true), commandId: canonicalCommandIdSchema }),
]);
const commonPublic = { expected_document_key: layerDocumentKeySchema, name: layerNameSchema, parent_layer_path: layerPathSchema.optional(), position: positionSchema.default(0) };
export const createLayerPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({ ...commonPublic, expected_container_before: containerTargetSchema, expected_sibling_order: siblingOrderSchema, apply: z.literal(true), command_id: canonicalCommandIdSchema }),
]);
const inputSchema = z.strictObject({ ...commonPublic, expected_container_before: containerTargetSchema.optional(), expected_sibling_order: siblingOrderSchema.optional(), apply: z.boolean().default(false), command_id: canonicalCommandIdSchema.optional() });
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(createLayerPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = createLayerPublicInputSchema.parse(input);
    const common = { expectedDocumentKey: value.expected_document_key, name: value.name, parentLayerPath: value.parent_layer_path ?? [], position: value.position };
    return value.apply ? { ...common, expectedContainerBefore: value.expected_container_before, expectedSiblingOrder: value.expected_sibling_order, apply: true, commandId: value.command_id } : { ...common, apply: false };
}
const planSchema = z.strictObject({
    operation: z.literal(CREATE_LAYER_OPERATION),
    documentKey: layerDocumentKeySchema,
    name: layerNameSchema,
    parentLayerPath: containerPathSchema,
    position: positionSchema,
    containerBefore: containerTargetSchema,
    siblingOrderBefore: siblingOrderSchema,
    siblingOrderAfter: siblingOrderSchema,
    createdLayer: siblingEntrySchema,
    createdLayerPath: layerPathSchema,
    activeLayerPathBefore: layerPathSchema,
    activeLayerPathAfter: layerPathSchema,
    applyBlockedReasonCodes: z.array(layerBlockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    if (!sameCanonical(plan.containerBefore.path, plan.parentLayerPath) || plan.containerBefore.childLayerCount !== plan.siblingOrderBefore.length) {
        context.addIssue({ code: 'custom', message: 'Create-layer plan must bind the container at the parent path with its complete sibling order.' });
    }
    if (!sameCanonical(plan.createdLayer, newLayerEntry(plan.name)) || !sameCanonical(plan.createdLayerPath, [...plan.parentLayerPath, plan.position])) {
        context.addIssue({ code: 'custom', message: 'Create-layer plan must derive the new entry from the name and measured defaults at the requested position.' });
    }
    try {
        if (!sameCanonical(insertSibling(plan.siblingOrderBefore, plan.position, plan.createdLayer), plan.siblingOrderAfter))
            context.addIssue({ code: 'custom', message: 'Create-layer plan after order must insert exactly the new entry.' });
    }
    catch {
        context.addIssue({ code: 'custom', message: 'Create-layer plan after order cannot be derived.' });
    }
    if (!sameCanonical(shiftPathForInsert(plan.activeLayerPathBefore, plan.parentLayerPath, plan.position), plan.activeLayerPathAfter))
        context.addIssue({ code: 'custom', message: 'Create-layer plan must derive the active layer path after insertion.' });
    if (plan.applyAllowed !== (plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0))
        context.addIssue({ code: 'custom', message: 'Create-layer applyAllowed must require confirmation and no blockers.' });
});
const rollbackEvidence = { restoredSiblingOrder: siblingOrderSchema.nullable(), createdLayerRemoved: z.boolean() };
const transactionSchema = layerTransactionSchema('create_layer', rollbackEvidence, { restoredSiblingOrder: null, createdLayerRemoved: false }, (evidence) => evidence.restoredSiblingOrder !== null && evidence.createdLayerRemoved);
export const createLayerResultSchema = z.union([
    z.strictObject({ operation: z.literal(CREATE_LAYER_OPERATION), applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ operation: z.literal(CREATE_LAYER_OPERATION), applied: z.literal(true), document: documentContextSchema, plan: planSchema,
        postcondition: z.strictObject({ siblingOrder: siblingOrderSchema, createdLayerPath: layerPathSchema, createdLayer: siblingEntrySchema, activeLayerPath: layerPathSchema }), transaction: transactionSchema }),
]).superRefine((result, context) => {
    const expectedBlockers = layerBlockers(result.transaction.state === 'planned' ? result.document.mutationAllowed : true, result.plan.containerBefore, { targetStateBlocks: false, targetIsAncestor: true });
    if (result.transaction.state === 'planned') {
        if (result.plan.confirmationStatus !== 'required' || !sameCanonical(result.plan.applyBlockedReasonCodes, expectedBlockers))
            context.addIssue({ code: 'custom', message: 'Planned layer creation must expose exact blockers.' });
    }
    else if (result.plan.confirmationStatus !== 'confirmed' || result.plan.applyBlockedReasonCodes.length !== 0 || !result.plan.applyAllowed || expectedBlockers.length !== 0) {
        context.addIssue({ code: 'custom', message: 'Applied layer creation must derive from an allowed confirmed plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified' || !sameCanonical(result.postcondition.siblingOrder, result.plan.siblingOrderAfter) || !sameCanonical(result.postcondition.createdLayer, result.plan.createdLayer) ||
            !sameCanonical(result.postcondition.createdLayerPath, result.plan.createdLayerPath) || !sameCanonical(result.postcondition.activeLayerPath, result.plan.activeLayerPathAfter)) {
            context.addIssue({ code: 'custom', message: 'Verified layer creation must match the planned order, entry, path, and restored active layer.' });
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
    return {
        operationId: CREATE_LAYER_OPERATION, documentKey: result.document.key, identityToken: layerIdentityToken(result.plan.containerBefore, result.plan.siblingOrderBefore),
        beforeState: { container: result.plan.containerBefore, siblingOrder: result.plan.siblingOrderBefore, activeLayerPath: result.plan.activeLayerPathBefore },
        afterState: { container: { ...result.plan.containerBefore, childLayerCount: result.plan.containerBefore.childLayerCount + 1 }, siblingOrder: result.plan.siblingOrderAfter, activeLayerPath: result.plan.activeLayerPathAfter },
        changeSet: { operation: CREATE_LAYER_OPERATION, name: result.plan.name, parentLayerPath: result.plan.parentLayerPath, position: result.plan.position },
        blocked: result.plan.applyBlockedReasonCodes.length > 0, confirmationStatus: result.plan.confirmationStatus, applyAllowed: result.plan.applyAllowed,
        transactionState: result.transaction.state, applied: result.applied,
    };
});
export const CREATE_LAYER_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${LAYER_OPS_HOST_SCRIPT}

function createLayerEntry(name) { return { name: name, visible: true, locked: false, printable: true, childLayerCount: 0, pageItemCount: 0 }; }
function createLayerShiftPath(path, parentPath, position) {
  var depth = parentPath.length;
  var shifted = path.slice(0);
  if (path.length <= depth) return shifted;
  for (var index = 0; index < depth; index++) if (path[index] !== parentPath[index]) return shifted;
  if (path[depth] >= position) shifted[depth] = path[depth] + 1;
  return shifted;
}
function createLayerResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  if (!layerOpsValidName(params.name)) throw mutationError("preflight_failed", "name must not be empty, padded with whitespace, or contain control characters.");
  var chain = layerOpsResolvePath(document, params.parentLayerPath, true);
  var container = layerOpsContainerOf(document, chain);
  var snapshot = layerOpsContainerSnapshot(document, chain, params.parentLayerPath);
  var orderBefore = layerOpsOrder(container);
  if (orderBefore.length >= LAYER_OPS_MAX_SIBLINGS) throw mutationError("preflight_failed", "The container already holds the maximum number of direct layers.");
  var entry = createLayerEntry(params.name);
  var orderAfter = layerOpsInsert(orderBefore, params.position, entry);
  var activeLayer = document.activeLayer;
  var activePath = layerOpsPathOfLayer(document, activeLayer);
  if (activePath === null) throw mutationError("preflight_failed", "The active layer could not be located in the document layer tree.");
  var blockers = layerOpsBlockers(context, snapshot, false, true);
  if (forApply) {
    if (!layerOpsSameTarget(snapshot, params.expectedContainerBefore)) throw mutationError("preflight_failed", "Container state does not match expected_container_before.");
    if (!layerOpsSameOrder(orderBefore, params.expectedSiblingOrder)) throw mutationError("preflight_failed", "Sibling order does not match expected_sibling_order.");
    if (blockers.length > 0) throw new Error("MCP_ERROR:" + stringifyJson({ code: "LAYER_APPLY_BLOCKED", reasonCodes: blockers, layerPath: params.parentLayerPath }));
  }
  return { context: context, document: document, container: container, snapshot: snapshot, orderBefore: orderBefore, orderAfter: orderAfter, entry: entry,
    activeLayer: activeLayer, activePath: activePath, blockers: blockers };
}
function createLayerPlan(preflight) {
  return { operation: "create_layer", documentKey: preflight.context.key, name: params.name, parentLayerPath: params.parentLayerPath, position: params.position,
    containerBefore: preflight.snapshot, siblingOrderBefore: preflight.orderBefore, siblingOrderAfter: preflight.orderAfter, createdLayer: preflight.entry,
    createdLayerPath: params.parentLayerPath.concat([params.position]), activeLayerPathBefore: preflight.activePath,
    activeLayerPathAfter: createLayerShiftPath(preflight.activePath, params.parentLayerPath, params.position), applyBlockedReasonCodes: preflight.blockers,
    confirmationStatus: params.apply === true ? "confirmed" : "required", applyAllowed: params.apply === true && preflight.blockers.length === 0 };
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
function createLayerApply(preflight, plan, state) {
  var operationState = state.operationState;
  var originalSiblings = [];
  for (var index = 0; index < preflight.container.layers.length; index++) originalSiblings.push(preflight.container.layers[index]);
  operationState.mutationStarted = true;
  var created = preflight.container.layers.add();
  operationState.created = created;
  created.name = params.name;
  if (params.position > 0) {
    if (params.position >= originalSiblings.length) created.move(preflight.container, ElementPlacement.PLACEATEND);
    else created.move(originalSiblings[params.position], ElementPlacement.PLACEBEFORE);
  }
  preflight.document.activeLayer = preflight.activeLayer;
  operationState.activeRestored = true;
  return { created: true };
}
function createLayerVerify(preflight, plan, state) {
  layerOpsRequireSameDocument(preflight.document, "verify_mismatch");
  var created = state.operationState.created;
  var order = layerOpsOrder(preflight.container);
  if (!layerOpsSameOrder(order, plan.siblingOrderAfter)) throw mutationError("verify_mismatch", "Sibling order does not match the planned order after creation.");
  if (layerOpsIndexOfRef(preflight.container.layers, created) !== params.position) throw mutationError("verify_mismatch", "The created layer reference is not at the requested position.");
  var entry = layerOpsEntry(created);
  if (!layerOpsSameEntry(entry, plan.createdLayer)) throw mutationError("verify_mismatch", "The created layer read-back does not match the plan.");
  var chain = layerOpsResolvePath(preflight.document, plan.createdLayerPath, false);
  if (chain[chain.length - 1] !== created) throw mutationError("verify_mismatch", "The created layer path does not resolve to the created layer.");
  if (preflight.document.activeLayer !== preflight.activeLayer) throw mutationError("verify_mismatch", "The active layer was not restored.");
  var activePath = layerOpsPathOfLayer(preflight.document, preflight.document.activeLayer);
  if (activePath === null || !mutationSameSequence(activePath, plan.activeLayerPathAfter)) throw mutationError("verify_mismatch", "The restored active layer path does not match the plan.");
  return { siblingOrder: order, createdLayerPath: plan.createdLayerPath, createdLayer: entry, activeLayerPath: activePath };
}
/** Removes only the captured, still-empty layer this command created, then restores the active layer and proves the baseline order. */
function createLayerRollback(state) {
  var preflight = state.preflight;
  var created = state.operationState.created;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
  if (!created) return { status: "indeterminate", message: "Rollback refused because the created layer reference was not captured." };
  var collection = preflight.container.layers;
  var index;
  try { index = layerOpsIndexOfRef(collection, created); } catch (e) { return { status: "indeterminate", message: "Rollback layer lookup is indeterminate." }; }
  if (index < 0 || collection.length !== preflight.orderBefore.length + 1) return { status: "indeterminate", message: "Rollback refused because the container does not hold exactly the baseline plus the created layer." };
  var empty;
  try { empty = created.layers.length === 0 && created.pageItems.length === 0; } catch (e) { return { status: "indeterminate", message: "Rollback refused because the created layer contents are unreadable." }; }
  if (!empty) return { status: "indeterminate", message: "Rollback refused because the created layer is not empty." };
  try { created.remove(); } catch (removeError) { return { status: "indeterminate", message: "Rollback removal is indeterminate." }; }
  state.operationState.rollbackEvidence.createdLayerRemoved = true;
  try { preflight.document.activeLayer = preflight.activeLayer; } catch (activeError) { return { status: "indeterminate", message: "Rollback active-layer restore is indeterminate." }; }
  var restoredOrder;
  try { restoredOrder = layerOpsOrder(preflight.container); } catch (e) { return { status: "indeterminate", message: "Rollback verification is indeterminate." }; }
  state.operationState.rollbackEvidence.restoredSiblingOrder = restoredOrder;
  if (!layerOpsSameOrder(restoredOrder, preflight.orderBefore)) return { status: "failed", message: "Rollback did not restore the exact baseline sibling order." };
  if (preflight.document.activeLayer !== preflight.activeLayer) return { status: "failed", message: "Rollback did not restore the active layer." };
  return { status: "verified" };
}

var createLayerExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionLayers: function (phase, preflight, plan, state) { return (phase === "after") ? [state.operationState.created] : []; },
  // the items this change reads and writes, so an edit session can advance its item aggregate.
  editSessionAffected: function () { if (params.parentLayerPath.length > 0) throw mutationError("plan_failed", "An edit session has not measured sublayers; create the layer at the document root."); return []; },
  initialOperationState: function () { return { mutationStarted: false, created: null, activeRestored: false, rollbackEvidence: { restoredSiblingOrder: null, createdLayerRemoved: false } }; },
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
    const request = internalInputSchema.parse(input);
    const digestRequest = 'commandId' in request ? (({ commandId: _commandId, ...rest }) => rest)(request) : request;
    const digest = canonicalSha256({ operation: CREATE_LAYER_OPERATION, validator: CREATE_LAYER_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: 'commandId' in request ? request.commandId : null, documentKey: request.expectedDocumentKey, digest };
}
export const createLayerToolContract = {
    name: 'illustrator_create_layer',
    title: 'Plan or Create a Layer',
    description: 'Plan or apply creating one empty layer named name at position (0 = front, default) among the direct layers of the document root or of parent_layer_path (root-relative, from illustrator_list_layers). The plan binds the container\'s structural snapshot, its complete sibling order, and the active layer, and derives the exact after order (new layers are visible, unlocked, printable, empty). Apply performs compare-and-set on the container and order, adds the layer once, moves it once when position > 0, restores the previous active layer, and verifies the whole parent collection, the exact name, and the active layer by native read-back. On failure only the captured, still-empty created layer is removed and the baseline order is proved. A locked or hidden container or ancestor is refused before any write. Names must be 1-255 characters without leading/trailing whitespace or control characters.',
    inputSchema,
    publicInputSchema: createLayerPublicInputSchema,
    outputSchema: createLayerResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(CREATE_LAYER_SAFETY.policy),
    normalizePublicInput,
};
export function createCreateLayerAdapter() {
    return {
        version: 1, operation: CREATE_LAYER_OPERATION, validator: CREATE_LAYER_VALIDATOR,
        safety: CREATE_LAYER_SAFETY, safetyRegistrationIdentity: CREATE_LAYER_SAFETY_IDENTITY,
        adapterIdentity: CREATE_LAYER_ADAPTER_IDENTITY, tool: createLayerToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: createLayerResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
        safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: CREATE_LAYER_HOST_SCRIPT_DIGEST,
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
        mapExecutionError: mapLayerExecutionError,
    };
}
