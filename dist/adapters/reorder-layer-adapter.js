import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema } from '../mutation-result-schema-core.js';
import { canonicalDigest, operationSafetyPolicyToMcpAnnotations } from '../operation-safety-policy-core.js';
import { LAYER_OPS_HOST_SCRIPT } from './layer-ops-host-script.js';
import { classifyLayerTerminal, entryOf, layerBlockers, layerBlockerSchema, layerDocumentKeySchema, layerIdentityToken, layerPathSchema, layerSafetyAsserter, layerSafetyRegistration, layerTargetSchema, layerTransactionSchema, LAYER_OPS_MAX_SIBLINGS, reorderSibling, sameCanonical, siblingOrderSchema, } from './layer-ops-shared.js';
export const REORDER_LAYER_OPERATION = 'reorder_layer';
export const REORDER_LAYER_VALIDATOR = { kind: REORDER_LAYER_OPERATION, version: 1 };
const CANONICAL_VERSION = 1;
const RESULT_SCHEMA_VERSION = 1;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
const toIndexSchema = z.number().int().nonnegative().max(LAYER_OPS_MAX_SIBLINGS - 1);
const commonInternal = { expectedDocumentKey: layerDocumentKeySchema, layerPath: layerPathSchema, toIndex: toIndexSchema };
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({ ...commonInternal, expectedBefore: layerTargetSchema, expectedSiblingOrder: siblingOrderSchema, apply: z.literal(true), commandId: canonicalCommandIdSchema }),
]);
const commonPublic = { expected_document_key: layerDocumentKeySchema, layer_path: layerPathSchema, to_index: toIndexSchema };
export const reorderLayerPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({ ...commonPublic, expected_before: layerTargetSchema, expected_sibling_order: siblingOrderSchema, apply: z.literal(true), command_id: applyCommandIdSchema }),
]);
const inputSchema = z.strictObject({ ...commonPublic, expected_before: layerTargetSchema.optional(), expected_sibling_order: siblingOrderSchema.optional(), apply: z.boolean().default(false), command_id: applyCommandIdSchema.optional() });
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(reorderLayerPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = reorderLayerPublicInputSchema.parse(input);
    const common = { expectedDocumentKey: value.expected_document_key, layerPath: value.layer_path, toIndex: value.to_index };
    return value.apply ? { ...common, expectedBefore: value.expected_before, expectedSiblingOrder: value.expected_sibling_order, apply: true, commandId: value.command_id } : { ...common, apply: false };
}
const planSchema = z.strictObject({
    operation: z.literal(REORDER_LAYER_OPERATION),
    documentKey: layerDocumentKeySchema,
    layerPath: layerPathSchema,
    fromIndex: toIndexSchema,
    toIndex: toIndexSchema,
    targetBefore: layerTargetSchema,
    targetAfter: layerTargetSchema,
    siblingOrderBefore: siblingOrderSchema,
    siblingOrderAfter: siblingOrderSchema,
    changesOrder: z.boolean(),
    applyBlockedReasonCodes: z.array(layerBlockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    const parentPath = plan.layerPath.slice(0, -1);
    if (plan.layerPath[plan.layerPath.length - 1] !== plan.fromIndex || !sameCanonical(plan.targetBefore.path, plan.layerPath))
        context.addIssue({ code: 'custom', message: 'Reorder plan must bind the target at its path index.' });
    if (plan.fromIndex >= plan.siblingOrderBefore.length || !sameCanonical(plan.siblingOrderBefore[plan.fromIndex], entryOf(plan.targetBefore)))
        context.addIssue({ code: 'custom', message: 'Reorder plan target must equal its sibling entry.' });
    try {
        if (!sameCanonical(reorderSibling(plan.siblingOrderBefore, plan.fromIndex, plan.toIndex), plan.siblingOrderAfter))
            context.addIssue({ code: 'custom', message: 'Reorder plan after order must be derived from the before order.' });
    }
    catch {
        context.addIssue({ code: 'custom', message: 'Reorder plan after order cannot be derived.' });
    }
    if (!sameCanonical({ ...plan.targetBefore, path: [...parentPath, plan.toIndex] }, plan.targetAfter))
        context.addIssue({ code: 'custom', message: 'Reorder plan after target must be the before target at the destination index.' });
    if (plan.changesOrder !== (plan.fromIndex !== plan.toIndex))
        context.addIssue({ code: 'custom', message: 'Reorder plan changesOrder must reflect the indices.' });
    if (plan.applyAllowed !== (plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0))
        context.addIssue({ code: 'custom', message: 'Reorder applyAllowed must require confirmation and no blockers.' });
});
const rollbackEvidence = { restoredSiblingOrder: siblingOrderSchema.nullable(), restoredTarget: layerTargetSchema.nullable() };
const transactionSchema = layerTransactionSchema('reorder_layer', rollbackEvidence, { restoredSiblingOrder: null, restoredTarget: null }, (evidence) => evidence.restoredSiblingOrder !== null && evidence.restoredTarget !== null);
export const reorderLayerResultSchema = z.union([
    z.strictObject({ operation: z.literal(REORDER_LAYER_OPERATION), applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ operation: z.literal(REORDER_LAYER_OPERATION), applied: z.literal(true), document: documentContextSchema, plan: planSchema,
        postcondition: z.strictObject({ siblingOrder: siblingOrderSchema, target: layerTargetSchema }), transaction: transactionSchema }),
]).superRefine((result, context) => {
    const expectedBlockers = layerBlockers(result.transaction.state === 'planned' ? result.document.mutationAllowed : true, result.plan.targetBefore, { targetStateBlocks: true, targetIsAncestor: false });
    if (result.transaction.state === 'planned') {
        if (result.plan.confirmationStatus !== 'required' || !sameCanonical(result.plan.applyBlockedReasonCodes, expectedBlockers))
            context.addIssue({ code: 'custom', message: 'Planned reorder must expose exact blockers.' });
    }
    else if (result.plan.confirmationStatus !== 'confirmed' || result.plan.applyBlockedReasonCodes.length !== 0 || !result.plan.applyAllowed || expectedBlockers.length !== 0) {
        context.addIssue({ code: 'custom', message: 'Applied reorder must derive from an allowed confirmed plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified' || !sameCanonical(result.postcondition.siblingOrder, result.plan.siblingOrderAfter) || !sameCanonical(result.postcondition.target, result.plan.targetAfter)) {
            context.addIssue({ code: 'custom', message: 'Verified reorder must match the planned order and target.' });
        }
    }
    else if (result.transaction.state === 'verified')
        context.addIssue({ code: 'custom', message: 'A verified reorder transaction must be applied.' });
    if (result.transaction.state === 'rolled_back' && (!sameCanonical(result.transaction.rollback.restoredSiblingOrder, result.plan.siblingOrderBefore) || !sameCanonical(result.transaction.rollback.restoredTarget, result.plan.targetBefore))) {
        context.addIssue({ code: 'custom', message: 'Rolled-back reorder must prove the exact baseline order and target.' });
    }
});
export const reorderLayerResponseSchema = z.strictObject({ outcome: reorderLayerResultSchema, delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }) });
export const REORDER_LAYER_SAFETY = layerSafetyRegistration(REORDER_LAYER_OPERATION);
export const REORDER_LAYER_SAFETY_IDENTITY = canonicalDigest(REORDER_LAYER_SAFETY);
const assertSafety = layerSafetyAsserter(REORDER_LAYER_SAFETY, (value) => {
    const result = reorderLayerResultSchema.parse(value);
    return {
        operationId: REORDER_LAYER_OPERATION, documentKey: result.document.key, identityToken: layerIdentityToken(result.plan.targetBefore, result.plan.siblingOrderBefore),
        beforeState: { target: result.plan.targetBefore, siblingOrder: result.plan.siblingOrderBefore }, afterState: { target: result.plan.targetAfter, siblingOrder: result.plan.siblingOrderAfter },
        changeSet: { operation: REORDER_LAYER_OPERATION, layerPath: result.plan.layerPath, toIndex: result.plan.toIndex },
        blocked: result.plan.applyBlockedReasonCodes.length > 0, confirmationStatus: result.plan.confirmationStatus, applyAllowed: result.plan.applyAllowed,
        transactionState: result.transaction.state, applied: result.applied,
    };
});
export const REORDER_LAYER_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${LAYER_OPS_HOST_SCRIPT}

function reorderResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  var chain = layerOpsResolvePath(document, params.layerPath, false);
  var target = chain[chain.length - 1];
  var container = chain.length > 1 ? chain[chain.length - 2] : document;
  var fromIndex = params.layerPath[params.layerPath.length - 1];
  if (layerOpsIndexOfRef(container.layers, target) !== fromIndex) throw mutationError("preflight_failed", "The layer path does not resolve to a direct child at its index.");
  var snapshot = layerOpsTargetSnapshot(chain, params.layerPath);
  var orderBefore = layerOpsOrder(container);
  var orderAfter = layerOpsReorder(orderBefore, fromIndex, params.toIndex);
  var blockers = layerOpsBlockers(context, snapshot, true, false);
  if (forApply) {
    if (!layerOpsSameTarget(snapshot, params.expectedBefore)) throw mutationError("preflight_failed", "Layer state does not match expected_before.");
    if (!layerOpsSameOrder(orderBefore, params.expectedSiblingOrder)) throw mutationError("preflight_failed", "Sibling order does not match expected_sibling_order.");
    if (blockers.length > 0) throw new Error("MCP_ERROR:" + stringifyJson({ code: "LAYER_APPLY_BLOCKED", reasonCodes: blockers, layerPath: params.layerPath }));
  }
  return { context: context, document: document, container: container, target: target, fromIndex: fromIndex, snapshot: snapshot, orderBefore: orderBefore, orderAfter: orderAfter, blockers: blockers };
}
function reorderTargetAfter(snapshot) {
  var parentPath = params.layerPath.slice(0, params.layerPath.length - 1);
  return { path: parentPath.concat([params.toIndex]), name: snapshot.name, visible: snapshot.visible, locked: snapshot.locked, printable: snapshot.printable,
    childLayerCount: snapshot.childLayerCount, pageItemCount: snapshot.pageItemCount, ancestorVisible: snapshot.ancestorVisible, ancestorLocked: snapshot.ancestorLocked };
}
function reorderPlan(preflight) {
  return { operation: "reorder_layer", documentKey: preflight.context.key, layerPath: params.layerPath, fromIndex: preflight.fromIndex, toIndex: params.toIndex,
    targetBefore: preflight.snapshot, targetAfter: reorderTargetAfter(preflight.snapshot), siblingOrderBefore: preflight.orderBefore, siblingOrderAfter: preflight.orderAfter,
    changesOrder: preflight.fromIndex !== params.toIndex, applyBlockedReasonCodes: preflight.blockers,
    confirmationStatus: params.apply === true ? "confirmed" : "required", applyAllowed: params.apply === true && preflight.blockers.length === 0 };
}
function reorderRevalidate(preflight, plan) {
  var current;
  try { current = reorderResolve(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Reorder preconditions changed before apply.")); }
  if (current.document !== preflight.document || current.container !== preflight.container || current.target !== preflight.target ||
      !layerOpsSameTarget(current.snapshot, plan.targetBefore) || !layerOpsSameOrder(current.orderBefore, plan.siblingOrderBefore)) {
    throw mutationBeforeSideEffectError("Layer identity or sibling order changed before apply.");
  }
}
/** One measured move: before the sibling that occupies toIndex once the target is removed, or to the container end. */
function reorderMoveTo(preflight, toIndex) {
  var collection = preflight.container.layers;
  var others = [];
  for (var index = 0; index < collection.length; index++) if (collection[index] !== preflight.target) others.push(collection[index]);
  if (toIndex >= others.length) preflight.target.move(preflight.container, ElementPlacement.PLACEATEND);
  else preflight.target.move(others[toIndex], ElementPlacement.PLACEBEFORE);
}
function reorderApply(preflight, plan, state) {
  if (preflight.fromIndex === params.toIndex) return { moved: false };
  state.operationState.mutationStarted = true;
  reorderMoveTo(preflight, params.toIndex);
  return { moved: true };
}
function reorderVerify(preflight, plan) {
  layerOpsRequireSameDocument(preflight.document, "verify_mismatch");
  var order = layerOpsOrder(preflight.container);
  if (!layerOpsSameOrder(order, plan.siblingOrderAfter)) throw mutationError("verify_mismatch", "Sibling order does not match the planned order.");
  if (layerOpsIndexOfRef(preflight.container.layers, preflight.target) !== params.toIndex) throw mutationError("verify_mismatch", "The layer reference is not at the destination index.");
  var chain = layerOpsResolvePath(preflight.document, plan.targetAfter.path, false);
  if (chain[chain.length - 1] !== preflight.target) throw mutationError("verify_mismatch", "The destination path does not resolve to the moved layer.");
  var target = layerOpsTargetSnapshot(chain, plan.targetAfter.path);
  if (!layerOpsSameTarget(target, plan.targetAfter)) throw mutationError("verify_mismatch", "The layer changed beyond its order.");
  return { siblingOrder: order, target: target };
}
function reorderRollback(state) {
  var preflight = state.preflight;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
  var collection = preflight.container.layers;
  var currentIndex;
  try { currentIndex = layerOpsIndexOfRef(collection, preflight.target); } catch (e) { return { status: "indeterminate", message: "Rollback layer lookup is indeterminate." }; }
  if (currentIndex < 0 || collection.length !== preflight.orderBefore.length) return { status: "indeterminate", message: "Rollback refused because the layer set of the container changed." };
  if (currentIndex !== preflight.fromIndex) {
    try { reorderMoveTo(preflight, preflight.fromIndex); }
    catch (moveError) { return { status: "indeterminate", message: "Rollback move is indeterminate." }; }
  }
  var restoredOrder, restoredTarget;
  try {
    restoredOrder = layerOpsOrder(preflight.container);
    var chain = layerOpsResolvePath(preflight.document, params.layerPath, false);
    restoredTarget = chain[chain.length - 1] === preflight.target ? layerOpsTargetSnapshot(chain, params.layerPath) : null;
  } catch (e) { return { status: "indeterminate", message: "Rollback verification is indeterminate." }; }
  state.operationState.rollbackEvidence.restoredSiblingOrder = restoredOrder;
  state.operationState.rollbackEvidence.restoredTarget = restoredTarget;
  if (!layerOpsSameOrder(restoredOrder, preflight.orderBefore)) return { status: "failed", message: "Rollback did not restore the exact baseline sibling order." };
  if (restoredTarget === null || !layerOpsSameTarget(restoredTarget, preflight.snapshot)) return { status: "indeterminate", message: "Rollback restored the order but the layer snapshot differs from its before state." };
  return { status: "verified" };
}

var reorderExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionAffected: function () { return []; },
  initialOperationState: function () { return { mutationStarted: false, rollbackEvidence: { restoredSiblingOrder: null, restoredTarget: null } }; },
  preflight: reorderResolve,
  plan: reorderPlan,
  revalidate: reorderRevalidate,
  applyMutation: reorderApply,
  verify: reorderVerify,
  rollback: reorderRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () { return { reasonCode: "layer_state_unknown", message: "Reorder apply outcome is indeterminate.", evidence: { restoredSiblingOrder: null, restoredTarget: null } }; },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});
var reorderDocument = reorderExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === reorderExecution.preflight.document) reorderDocument = getDocumentContext();
var result = { operation: "reorder_layer", applied: reorderExecution.transaction.state === "verified", document: reorderDocument, plan: reorderExecution.plan, transaction: reorderExecution.transaction };
if (reorderExecution.transaction.state === "verified") result.postcondition = reorderExecution.value;
`;
export const REORDER_LAYER_HOST_SCRIPT_DIGEST = canonicalSha256(REORDER_LAYER_SCRIPT);
export const REORDER_LAYER_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: REORDER_LAYER_OPERATION, validator: REORDER_LAYER_VALIDATOR,
    canonicalContractVersion: CANONICAL_VERSION, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: REORDER_LAYER_SAFETY_IDENTITY, hostScriptDigest: REORDER_LAYER_HOST_SCRIPT_DIGEST,
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    const digestRequest = 'commandId' in request ? (({ commandId: _commandId, ...rest }) => rest)(request) : request;
    const digest = canonicalSha256({ operation: REORDER_LAYER_OPERATION, validator: REORDER_LAYER_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: 'commandId' in request ? request.commandId : null, documentKey: request.expectedDocumentKey, digest };
}
export const reorderLayerToolContract = {
    name: 'illustrator_reorder_layer',
    title: 'Plan or Reorder a Layer',
    description: 'Plan or apply moving one layer (root-relative layer_path from illustrator_list_layers) to to_index (0 = front) among its siblings in the same parent. The plan binds the layer\'s structural snapshot (name, visible, locked, printable, sublayer and direct item counts, ancestor state) and the complete sibling order, and derives the exact after order. Apply performs compare-and-set on both, moves the layer once, verifies the whole parent collection by native read-back, and on failure moves it back and proves the exact baseline order. Locked or hidden layers and locked or hidden ancestors are refused before any write; cross-parent moves are not supported.',
    inputSchema,
    publicInputSchema: reorderLayerPublicInputSchema,
    outputSchema: reorderLayerResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(REORDER_LAYER_SAFETY.policy),
    normalizePublicInput,
};
export function createReorderLayerAdapter() {
    return {
        version: 1, operation: REORDER_LAYER_OPERATION, validator: REORDER_LAYER_VALIDATOR,
        safety: REORDER_LAYER_SAFETY, safetyRegistrationIdentity: REORDER_LAYER_SAFETY_IDENTITY,
        adapterIdentity: REORDER_LAYER_ADAPTER_IDENTITY, tool: reorderLayerToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: reorderLayerResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
        safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: REORDER_LAYER_HOST_SCRIPT_DIGEST,
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: REORDER_LAYER_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: REORDER_LAYER_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: REORDER_LAYER_OPERATION, documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: REORDER_LAYER_ADAPTER_IDENTITY, script: REORDER_LAYER_SCRIPT, params };
        },
        classifyTerminal(value) { return classifyLayerTerminal(reorderLayerResultSchema.parse(value).transaction.state, 'Reorder-layer'); },
        assertSafetyConformance: assertSafety,
        mapExecutionError: mapLayerExecutionError,
    };
}
export function mapLayerExecutionError(error, detail) {
    if (detail?.code === 'LAYER_PATH_INVALID')
        return new Error('layer_path must be a root-relative index path with 1 to 64 non-negative integers.');
    if (detail?.code === 'LAYER_PATH_NOT_FOUND')
        return new Error('layer_path does not resolve to a layer in the bound document.');
    if (detail?.code === 'LAYER_APPLY_BLOCKED')
        return new Error(`Layer change is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}.`);
    return error instanceof Error ? error : new Error(String(error));
}
