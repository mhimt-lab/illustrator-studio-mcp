import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema } from '../mutation-result-schema-core.js';
import { canonicalDigest, operationSafetyPolicyToMcpAnnotations } from '../operation-safety-policy-core.js';
import { LAYER_OPS_HOST_SCRIPT } from './layer-ops-host-script.js';
import { classifyLayerTerminal, entryOf, layerBlockers, layerBlockerSchema, layerDocumentKeySchema, layerIdentityToken, layerNameSchema, layerPathSchema, layerSafetyAsserter, layerSafetyRegistration, layerTargetSchema, layerTransactionSchema, replaceSibling, sameCanonical, siblingOrderSchema, } from './layer-ops-shared.js';
import { mapLayerExecutionError } from './reorder-layer-adapter.js';
export const SET_LAYER_STATE_OPERATION = 'set_layer_state';
export const SET_LAYER_STATE_VALIDATOR = { kind: SET_LAYER_STATE_OPERATION, version: 1 };
export const LAYER_STATE_KEYS = ['name', 'visible', 'locked', 'printable'];
const CANONICAL_VERSION = 1;
const RESULT_SCHEMA_VERSION = 1;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
export const layerStateAfterSchema = z.strictObject({ name: layerNameSchema.optional(), visible: z.boolean().optional(), locked: z.boolean().optional(), printable: z.boolean().optional() })
    .superRefine((after, context) => {
    if (LAYER_STATE_KEYS.every((key) => after[key] === undefined))
        context.addIssue({ code: 'custom', message: 'after must set at least one of name, visible, locked, printable.' });
});
export function deriveLayerStateAfter(before, after) {
    const target = { ...before };
    const changes = [];
    for (const key of LAYER_STATE_KEYS) {
        const value = after[key];
        if (value === undefined || value === before[key])
            continue;
        target[key] = value;
        changes.push(key);
    }
    return { target, changes };
}
const commonInternal = { expectedDocumentKey: layerDocumentKeySchema, layerPath: layerPathSchema, after: layerStateAfterSchema };
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({ ...commonInternal, expectedBefore: layerTargetSchema, expectedSiblingOrder: siblingOrderSchema, apply: z.literal(true), commandId: canonicalCommandIdSchema }),
]);
const commonPublic = { expected_document_key: layerDocumentKeySchema, layer_path: layerPathSchema, after: layerStateAfterSchema };
export const setLayerStatePublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({ ...commonPublic, expected_before: layerTargetSchema, expected_sibling_order: siblingOrderSchema, apply: z.literal(true), command_id: applyCommandIdSchema }),
]);
const inputSchema = z.strictObject({ ...commonPublic, expected_before: layerTargetSchema.optional(), expected_sibling_order: siblingOrderSchema.optional(), apply: z.boolean().default(false), command_id: applyCommandIdSchema.optional() });
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(setLayerStatePublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = setLayerStatePublicInputSchema.parse(input);
    const common = { expectedDocumentKey: value.expected_document_key, layerPath: value.layer_path, after: value.after };
    return value.apply ? { ...common, expectedBefore: value.expected_before, expectedSiblingOrder: value.expected_sibling_order, apply: true, commandId: value.command_id } : { ...common, apply: false };
}
const planSchema = z.strictObject({
    operation: z.literal(SET_LAYER_STATE_OPERATION),
    documentKey: layerDocumentKeySchema,
    layerPath: layerPathSchema,
    after: layerStateAfterSchema,
    targetBefore: layerTargetSchema,
    targetAfter: layerTargetSchema,
    siblingOrderBefore: siblingOrderSchema,
    siblingOrderAfter: siblingOrderSchema,
    changes: z.array(z.enum(LAYER_STATE_KEYS)).max(LAYER_STATE_KEYS.length),
    changesState: z.boolean(),
    applyBlockedReasonCodes: z.array(layerBlockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    const index = plan.layerPath[plan.layerPath.length - 1];
    if (!sameCanonical(plan.targetBefore.path, plan.layerPath) || index >= plan.siblingOrderBefore.length || !sameCanonical(plan.siblingOrderBefore[index], entryOf(plan.targetBefore))) {
        context.addIssue({ code: 'custom', message: 'Layer-state plan must bind the target at its path index with its sibling entry.' });
    }
    const derived = deriveLayerStateAfter(plan.targetBefore, plan.after);
    if (!sameCanonical(derived.target, plan.targetAfter) || !sameCanonical(derived.changes, plan.changes) || plan.changesState !== (plan.changes.length > 0)) {
        context.addIssue({ code: 'custom', message: 'Layer-state plan after target and changes must be derived from before and after.' });
    }
    try {
        if (!sameCanonical(replaceSibling(plan.siblingOrderBefore, index, entryOf(plan.targetAfter)), plan.siblingOrderAfter))
            context.addIssue({ code: 'custom', message: 'Layer-state plan after order must replace only the target entry.' });
    }
    catch {
        context.addIssue({ code: 'custom', message: 'Layer-state plan after order cannot be derived.' });
    }
    if (plan.applyAllowed !== (plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0))
        context.addIssue({ code: 'custom', message: 'Layer-state applyAllowed must require confirmation and no blockers.' });
});
const rollbackEvidence = { restoredSiblingOrder: siblingOrderSchema.nullable(), restoredTarget: layerTargetSchema.nullable() };
const transactionSchema = layerTransactionSchema('set_layer_state', rollbackEvidence, { restoredSiblingOrder: null, restoredTarget: null }, (evidence) => evidence.restoredSiblingOrder !== null && evidence.restoredTarget !== null);
export const setLayerStateResultSchema = z.union([
    z.strictObject({ operation: z.literal(SET_LAYER_STATE_OPERATION), applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ operation: z.literal(SET_LAYER_STATE_OPERATION), applied: z.literal(true), document: documentContextSchema, plan: planSchema,
        postcondition: z.strictObject({ siblingOrder: siblingOrderSchema, target: layerTargetSchema }), transaction: transactionSchema }),
]).superRefine((result, context) => {
    const expectedBlockers = layerBlockers(result.transaction.state === 'planned' ? result.document.mutationAllowed : true, result.plan.targetBefore, { targetStateBlocks: false, targetIsAncestor: false });
    if (result.transaction.state === 'planned') {
        if (result.plan.confirmationStatus !== 'required' || !sameCanonical(result.plan.applyBlockedReasonCodes, expectedBlockers))
            context.addIssue({ code: 'custom', message: 'Planned layer-state change must expose exact blockers.' });
    }
    else if (result.plan.confirmationStatus !== 'confirmed' || result.plan.applyBlockedReasonCodes.length !== 0 || !result.plan.applyAllowed || expectedBlockers.length !== 0) {
        context.addIssue({ code: 'custom', message: 'Applied layer-state change must derive from an allowed confirmed plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified' || !sameCanonical(result.postcondition.siblingOrder, result.plan.siblingOrderAfter) || !sameCanonical(result.postcondition.target, result.plan.targetAfter)) {
            context.addIssue({ code: 'custom', message: 'Verified layer-state change must match the planned target and order.' });
        }
    }
    else if (result.transaction.state === 'verified')
        context.addIssue({ code: 'custom', message: 'A verified layer-state transaction must be applied.' });
    if (result.transaction.state === 'rolled_back' && (!sameCanonical(result.transaction.rollback.restoredSiblingOrder, result.plan.siblingOrderBefore) || !sameCanonical(result.transaction.rollback.restoredTarget, result.plan.targetBefore))) {
        context.addIssue({ code: 'custom', message: 'Rolled-back layer-state change must prove the exact baseline target and order.' });
    }
});
export const setLayerStateResponseSchema = z.strictObject({ outcome: setLayerStateResultSchema, delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }) });
export const SET_LAYER_STATE_SAFETY = layerSafetyRegistration(SET_LAYER_STATE_OPERATION);
export const SET_LAYER_STATE_SAFETY_IDENTITY = canonicalDigest(SET_LAYER_STATE_SAFETY);
const assertSafety = layerSafetyAsserter(SET_LAYER_STATE_SAFETY, (value) => {
    const result = setLayerStateResultSchema.parse(value);
    return {
        operationId: SET_LAYER_STATE_OPERATION, documentKey: result.document.key, identityToken: layerIdentityToken(result.plan.targetBefore, result.plan.siblingOrderBefore),
        beforeState: { target: result.plan.targetBefore, siblingOrder: result.plan.siblingOrderBefore }, afterState: { target: result.plan.targetAfter, siblingOrder: result.plan.siblingOrderAfter },
        changeSet: { operation: SET_LAYER_STATE_OPERATION, layerPath: result.plan.layerPath, after: result.plan.after, changes: result.plan.changes },
        blocked: result.plan.applyBlockedReasonCodes.length > 0, confirmationStatus: result.plan.confirmationStatus, applyAllowed: result.plan.applyAllowed,
        transactionState: result.transaction.state, applied: result.applied,
    };
});
export const SET_LAYER_STATE_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${LAYER_OPS_HOST_SCRIPT}
var LAYER_STATE_KEYS = ["name", "visible", "locked", "printable"];

function layerStateDerive(before, after) {
  var target = { path: before.path, name: before.name, visible: before.visible, locked: before.locked, printable: before.printable, childLayerCount: before.childLayerCount,
    pageItemCount: before.pageItemCount, ancestorVisible: before.ancestorVisible, ancestorLocked: before.ancestorLocked };
  var changes = [];
  for (var index = 0; index < LAYER_STATE_KEYS.length; index++) {
    var key = LAYER_STATE_KEYS[index];
    if (after[key] === undefined || after[key] === null || after[key] === before[key]) continue;
    target[key] = after[key];
    changes.push(key);
  }
  return { target: target, changes: changes };
}
function layerStateEntryOf(target) {
  return { name: target.name, visible: target.visible, locked: target.locked, printable: target.printable, childLayerCount: target.childLayerCount, pageItemCount: target.pageItemCount };
}
function layerStateResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  if (!params.after || typeof params.after !== "object") throw mutationError("preflight_failed", "after must be an object.");
  var requested = 0;
  for (var k = 0; k < LAYER_STATE_KEYS.length; k++) {
    var key = LAYER_STATE_KEYS[k];
    var value = params.after[key];
    if (value === undefined || value === null) continue;
    requested++;
    if (key === "name" && !layerOpsValidName(value)) throw mutationError("preflight_failed", "after.name must not be empty, padded with whitespace, or contain control characters.");
    if (key !== "name" && typeof value !== "boolean") throw mutationError("preflight_failed", "after." + key + " must be a boolean.");
  }
  if (requested === 0) throw mutationError("preflight_failed", "after must set at least one of name, visible, locked, printable.");
  var chain = layerOpsResolvePath(document, params.layerPath, false);
  var target = chain[chain.length - 1];
  var container = chain.length > 1 ? chain[chain.length - 2] : document;
  var index = params.layerPath[params.layerPath.length - 1];
  if (layerOpsIndexOfRef(container.layers, target) !== index) throw mutationError("preflight_failed", "The layer path does not resolve to a direct child at its index.");
  var snapshot = layerOpsTargetSnapshot(chain, params.layerPath);
  var orderBefore = layerOpsOrder(container);
  var derived = layerStateDerive(snapshot, params.after);
  var orderAfter = layerOpsReplace(orderBefore, index, layerStateEntryOf(derived.target));
  var blockers = layerOpsBlockers(context, snapshot, false, false);
  if (forApply) {
    if (!layerOpsSameTarget(snapshot, params.expectedBefore)) throw mutationError("preflight_failed", "Layer state does not match expected_before.");
    if (!layerOpsSameOrder(orderBefore, params.expectedSiblingOrder)) throw mutationError("preflight_failed", "Sibling order does not match expected_sibling_order.");
    if (blockers.length > 0) throw new Error("MCP_ERROR:" + stringifyJson({ code: "LAYER_APPLY_BLOCKED", reasonCodes: blockers, layerPath: params.layerPath }));
  }
  return { context: context, document: document, container: container, target: target, index: index, snapshot: snapshot, orderBefore: orderBefore, orderAfter: orderAfter,
    targetAfter: derived.target, changes: derived.changes, blockers: blockers };
}
function layerStatePlan(preflight) {
  return { operation: "set_layer_state", documentKey: preflight.context.key, layerPath: params.layerPath, after: params.after,
    targetBefore: preflight.snapshot, targetAfter: preflight.targetAfter, siblingOrderBefore: preflight.orderBefore, siblingOrderAfter: preflight.orderAfter,
    changes: preflight.changes, changesState: preflight.changes.length > 0, applyBlockedReasonCodes: preflight.blockers,
    confirmationStatus: params.apply === true ? "confirmed" : "required", applyAllowed: params.apply === true && preflight.blockers.length === 0 };
}
function layerStateRevalidate(preflight, plan) {
  var current;
  try { current = layerStateResolve(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Layer-state preconditions changed before apply.")); }
  if (current.document !== preflight.document || current.container !== preflight.container || current.target !== preflight.target ||
      !layerOpsSameTarget(current.snapshot, plan.targetBefore) || !layerOpsSameOrder(current.orderBefore, plan.siblingOrderBefore)) {
    throw mutationBeforeSideEffectError("Layer identity or sibling order changed before apply.");
  }
}
function layerStateWrite(target, key, value) {
  if (key === "name") target.name = value;
  else if (key === "visible") target.visible = value;
  else if (key === "locked") target.locked = value;
  else if (key === "printable") target.printable = value;
  else throw mutationError("apply_failed", "Unsupported layer state key.");
}
function layerStateApply(preflight, plan, state) {
  if (preflight.changes.length === 0) return { written: [] };
  state.operationState.mutationStarted = true;
  var written = [];
  for (var index = 0; index < preflight.changes.length; index++) {
    var key = preflight.changes[index];
    layerStateWrite(preflight.target, key, plan.targetAfter[key]);
    written.push(key);
    state.operationState.written = written;
  }
  return { written: written };
}
function layerStateVerify(preflight, plan) {
  layerOpsRequireSameDocument(preflight.document, "verify_mismatch");
  var chain = layerOpsResolvePath(preflight.document, params.layerPath, false);
  if (chain[chain.length - 1] !== preflight.target) throw mutationError("verify_mismatch", "The layer path no longer resolves to the same layer.");
  var target = layerOpsTargetSnapshot(chain, params.layerPath);
  if (!layerOpsSameTarget(target, plan.targetAfter)) throw mutationError("verify_mismatch", "Layer state read-back does not match the plan.");
  var order = layerOpsOrder(preflight.container);
  if (!layerOpsSameOrder(order, plan.siblingOrderAfter)) throw mutationError("verify_mismatch", "Sibling order does not match the planned order.");
  return { siblingOrder: order, target: target };
}
function layerStateRollback(state) {
  var preflight = state.preflight;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
  if (layerOpsIndexOfRef(preflight.container.layers, preflight.target) !== preflight.index) return { status: "indeterminate", message: "Rollback refused because the layer is no longer at its index." };
  var written = state.operationState.written || [];
  try {
    for (var index = written.length - 1; index >= 0; index--) layerStateWrite(preflight.target, written[index], preflight.snapshot[written[index]]);
  } catch (writeError) { return { status: "indeterminate", message: "Rollback write is indeterminate." }; }
  var restoredOrder, restoredTarget;
  try {
    var chain = layerOpsResolvePath(preflight.document, params.layerPath, false);
    restoredTarget = chain[chain.length - 1] === preflight.target ? layerOpsTargetSnapshot(chain, params.layerPath) : null;
    restoredOrder = layerOpsOrder(preflight.container);
  } catch (e) { return { status: "indeterminate", message: "Rollback verification is indeterminate." }; }
  state.operationState.rollbackEvidence.restoredSiblingOrder = restoredOrder;
  state.operationState.rollbackEvidence.restoredTarget = restoredTarget;
  if (restoredTarget === null || !layerOpsSameTarget(restoredTarget, preflight.snapshot)) return { status: "failed", message: "Rollback did not restore the exact baseline layer state." };
  if (!layerOpsSameOrder(restoredOrder, preflight.orderBefore)) return { status: "indeterminate", message: "Rollback restored the layer but the sibling order differs from the baseline." };
  return { status: "verified" };
}

var layerStateExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionAffected: function (phase, preflight) { var uuids = []; var items = preflight.target.pageItems; for (var i = 0; i < items.length; i++) uuids.push(String(items[i].uuid)); return uuids; },
  initialOperationState: function () { return { mutationStarted: false, written: [], rollbackEvidence: { restoredSiblingOrder: null, restoredTarget: null } }; },
  preflight: layerStateResolve,
  plan: layerStatePlan,
  revalidate: layerStateRevalidate,
  applyMutation: layerStateApply,
  verify: layerStateVerify,
  rollback: layerStateRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () { return { reasonCode: "layer_state_unknown", message: "Layer-state apply outcome is indeterminate.", evidence: { restoredSiblingOrder: null, restoredTarget: null } }; },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});
var layerStateDocument = layerStateExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === layerStateExecution.preflight.document) layerStateDocument = getDocumentContext();
var result = { operation: "set_layer_state", applied: layerStateExecution.transaction.state === "verified", document: layerStateDocument, plan: layerStateExecution.plan, transaction: layerStateExecution.transaction };
if (layerStateExecution.transaction.state === "verified") result.postcondition = layerStateExecution.value;
`;
export const SET_LAYER_STATE_HOST_SCRIPT_DIGEST = canonicalSha256(SET_LAYER_STATE_SCRIPT);
export const SET_LAYER_STATE_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: SET_LAYER_STATE_OPERATION, validator: SET_LAYER_STATE_VALIDATOR,
    canonicalContractVersion: CANONICAL_VERSION, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: SET_LAYER_STATE_SAFETY_IDENTITY, hostScriptDigest: SET_LAYER_STATE_HOST_SCRIPT_DIGEST,
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    const digestRequest = 'commandId' in request ? (({ commandId: _commandId, ...rest }) => rest)(request) : request;
    const digest = canonicalSha256({ operation: SET_LAYER_STATE_OPERATION, validator: SET_LAYER_STATE_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: 'commandId' in request ? request.commandId : null, documentKey: request.expectedDocumentKey, digest };
}
export const setLayerStateToolContract = {
    name: 'illustrator_set_layer_state',
    title: 'Plan or Set Layer Name and Flags',
    description: 'Plan or apply a rename and/or visible / locked / printable changes on one layer (root-relative layer_path from illustrator_list_layers). The plan binds the layer\'s structural snapshot and the complete sibling order, lists the keys that actually change, and derives the exact after state. Apply performs compare-and-set on both, writes one property per changed key, verifies the layer and its whole parent collection by native read-back (names must read back exactly), and on failure writes the before values back and proves the exact baseline. A locked or hidden ancestor is refused before any write; the layer\'s own lock or visibility does not block (unlocking or showing a layer is a supported change). Names must be 1-255 characters without leading/trailing whitespace or control characters.',
    inputSchema,
    publicInputSchema: setLayerStatePublicInputSchema,
    outputSchema: setLayerStateResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(SET_LAYER_STATE_SAFETY.policy),
    normalizePublicInput,
};
export function createSetLayerStateAdapter() {
    return {
        version: 1, operation: SET_LAYER_STATE_OPERATION, validator: SET_LAYER_STATE_VALIDATOR,
        safety: SET_LAYER_STATE_SAFETY, safetyRegistrationIdentity: SET_LAYER_STATE_SAFETY_IDENTITY,
        adapterIdentity: SET_LAYER_STATE_ADAPTER_IDENTITY, tool: setLayerStateToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: setLayerStateResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
        safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: SET_LAYER_STATE_HOST_SCRIPT_DIGEST,
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: SET_LAYER_STATE_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: SET_LAYER_STATE_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: SET_LAYER_STATE_OPERATION, documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: SET_LAYER_STATE_ADAPTER_IDENTITY, script: SET_LAYER_STATE_SCRIPT, params };
        },
        classifyTerminal(value) { return classifyLayerTerminal(setLayerStateResultSchema.parse(value).transaction.state, 'Set-layer-state'); },
        assertSafetyConformance: assertSafety,
        mapExecutionError: mapLayerExecutionError,
    };
}
