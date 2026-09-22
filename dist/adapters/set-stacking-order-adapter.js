import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { duplicateObjectSnapshotShape, refineDuplicateObjectSnapshot } from './duplicate-object-adapter.js';
import { SUPPORTED_PATH_ITEM_HOST_SCRIPT, SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS, supportedPathCmykPaintSchema, } from './supported-path-item-host-script.js';
export const SET_STACKING_ORDER_OPERATION = 'set_stacking_order';
export const SET_STACKING_ORDER_VALIDATOR = { kind: SET_STACKING_ORDER_OPERATION, version: 1 };
export const STACKING_MIN_TARGETS = 1;
export const STACKING_MAX_TARGETS = 16;
export const STACKING_METHODS = ['front', 'back', 'forward', 'backward'];
const CANONICAL_VERSION = 2;
const RESULT_SCHEMA_VERSION = 2;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
const uuidSchema = z.string().min(1).max(255);
const documentKeySchema = z.string().min(1).max(16_384);
const orderSchema = z.array(uuidSchema).min(1).max(SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS).superRefine((uuids, context) => {
    if (new Set(uuids).size !== uuids.length)
        context.addIssue({ code: 'custom', message: 'A layer order must contain unique native UUIDs.' });
});
const stackingPaintSchema = z.union([duplicateObjectSnapshotShape.fillColor.unwrap(), supportedPathCmykPaintSchema]);
export const stackingTargetSnapshotSchema = z.strictObject({
    ...duplicateObjectSnapshotShape,
    fillColor: stackingPaintSchema.nullable(),
    strokeColor: stackingPaintSchema.nullable(),
}).superRefine(refineDuplicateObjectSnapshot);
function hasCmykPaint(snapshot) {
    return snapshot.fillColor?.type === 'CMYKColor' || snapshot.strokeColor?.type === 'CMYKColor';
}
const targetsSchema = z.array(uuidSchema).min(STACKING_MIN_TARGETS).max(STACKING_MAX_TARGETS).superRefine((uuids, context) => {
    if (new Set(uuids).size !== uuids.length)
        context.addIssue({ code: 'custom', message: 'Stacking targets must be distinct native UUIDs.' });
});
function sameCanonical(left, right) {
    return canonicalSha256(left) === canonicalSha256(right);
}
export function deriveStackingOrder(before, targets, method) {
    const order = [...before];
    for (const uuid of targets) {
        const index = order.indexOf(uuid);
        if (index < 0)
            throw new Error(`Stacking target ${uuid} is absent from the layer order.`);
        if (method === 'front') {
            order.splice(index, 1);
            order.unshift(uuid);
        }
        else if (method === 'back') {
            order.splice(index, 1);
            order.push(uuid);
        }
        else if (method === 'forward') {
            if (index > 0) {
                order[index] = order[index - 1];
                order[index - 1] = uuid;
            }
        }
        else if (index < order.length - 1) {
            order[index] = order[index + 1];
            order[index + 1] = uuid;
        }
    }
    return order;
}
const commonInternal = { expectedDocumentKey: documentKeySchema, targetUuids: targetsSchema, method: z.enum(STACKING_METHODS) };
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({ ...commonInternal, expectedTargetsBefore: z.array(stackingTargetSnapshotSchema).min(STACKING_MIN_TARGETS).max(STACKING_MAX_TARGETS),
        expectedParentOrder: orderSchema, apply: z.literal(true), commandId: canonicalCommandIdSchema }),
]);
const commonPublic = { expected_document_key: documentKeySchema, target_uuids: targetsSchema, method: z.enum(STACKING_METHODS) };
export const setStackingOrderPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({ ...commonPublic, expected_targets_before: z.array(stackingTargetSnapshotSchema).min(STACKING_MIN_TARGETS).max(STACKING_MAX_TARGETS),
        expected_parent_order: orderSchema, apply: z.literal(true), command_id: applyCommandIdSchema }),
]);
const inputSchema = z.strictObject({ ...commonPublic,
    expected_targets_before: z.array(stackingTargetSnapshotSchema).min(STACKING_MIN_TARGETS).max(STACKING_MAX_TARGETS).optional(),
    expected_parent_order: orderSchema.optional(), apply: z.boolean().default(false), command_id: applyCommandIdSchema.optional() });
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(setStackingOrderPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = setStackingOrderPublicInputSchema.parse(input);
    const common = { expectedDocumentKey: value.expected_document_key, targetUuids: value.target_uuids, method: value.method };
    return value.apply
        ? { ...common, expectedTargetsBefore: value.expected_targets_before, expectedParentOrder: value.expected_parent_order, apply: true, commandId: value.command_id }
        : { ...common, apply: false };
}
const blockerSchema = z.enum(['document_mutation_not_allowed', 'target_locked', 'target_hidden', 'target_not_editable',
    'layer_hidden', 'ancestor_hidden', 'layer_locked', 'ancestor_locked']);
function targetBlockers(mutationAllowed, snapshots) {
    const blockers = [];
    const add = (blocker) => { if (!blockers.includes(blocker))
        blockers.push(blocker); };
    if (!mutationAllowed)
        add('document_mutation_not_allowed');
    for (const snapshot of snapshots) {
        if (snapshot.locked)
            add('target_locked');
        if (snapshot.hidden)
            add('target_hidden');
        if (!snapshot.editable)
            add('target_not_editable');
        if (!snapshot.layerVisible)
            add('layer_hidden');
        if (!snapshot.effectiveLayerVisible && snapshot.layerVisible)
            add('ancestor_hidden');
        if (snapshot.layerLocked)
            add('layer_locked');
        if (snapshot.effectiveLayerLocked && !snapshot.layerLocked)
            add('ancestor_locked');
    }
    return blockers;
}
const planSchema = z.strictObject({
    operation: z.literal(SET_STACKING_ORDER_OPERATION),
    documentKey: documentKeySchema,
    targetUuids: targetsSchema,
    method: z.enum(STACKING_METHODS),
    targetsBefore: z.array(stackingTargetSnapshotSchema).min(STACKING_MIN_TARGETS).max(STACKING_MAX_TARGETS),
    parentOrderBefore: orderSchema,
    parentOrderAfter: orderSchema,
    changesOrder: z.boolean(),
    applyBlockedReasonCodes: z.array(blockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    if (plan.targetsBefore.length !== plan.targetUuids.length || plan.targetsBefore.some((snapshot, index) => snapshot.uuid !== plan.targetUuids[index])) {
        context.addIssue({ code: 'custom', message: 'Stacking plan must bind one snapshot per target in request order.' });
    }
    if (plan.targetUuids.some((uuid) => !plan.parentOrderBefore.includes(uuid))) {
        context.addIssue({ code: 'custom', message: 'Every stacking target must be in the bound layer order.' });
    }
    const layer = plan.targetsBefore[0]?.layerPath;
    if (!layer || plan.targetsBefore.some((snapshot) => !sameCanonical(snapshot.layerPath, layer))) {
        context.addIssue({ code: 'custom', message: 'Stacking targets must share one layer.' });
    }
    try {
        const derived = deriveStackingOrder(plan.parentOrderBefore, plan.targetUuids, plan.method);
        if (!sameCanonical(derived, plan.parentOrderAfter) || plan.changesOrder !== !sameCanonical(plan.parentOrderBefore, plan.parentOrderAfter)) {
            context.addIssue({ code: 'custom', message: 'Stacking plan after order must be derived from the before order and method.' });
        }
    }
    catch {
        context.addIssue({ code: 'custom', message: 'Stacking plan after order cannot be derived.' });
    }
    if (plan.applyAllowed !== (plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0)) {
        context.addIssue({ code: 'custom', message: 'Stacking applyAllowed must require confirmation and no blockers.' });
    }
    if (plan.method !== 'front' && plan.targetsBefore.some(hasCmykPaint)) {
        context.addIssue({ code: 'custom', message: 'CMYK paint is measured for the front method only.' });
    }
});
const failureSchema = z.strictObject({ phase: z.enum(['apply', 'verify']), reasonCode: z.enum(['apply_failed', 'verify_mismatch']), message: z.string().min(1).max(500) })
    .superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed'))
        context.addIssue({ code: 'custom', message: 'Stacking failure phase and reason code must match.' });
});
const indeterminateFailureSchema = z.strictObject({ phase: z.literal('apply'), reasonCode: z.literal('apply_indeterminate'), message: z.string().min(1).max(500) });
const rollbackEvidence = { restoredParentOrder: orderSchema.nullable(), restoredTargets: z.array(stackingTargetSnapshotSchema).min(STACKING_MIN_TARGETS).max(STACKING_MAX_TARGETS).nullable() };
const transactionSchema = z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('planned'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('verified'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('apply_failed'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('not_required') }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('rolled_back'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('verified'), ...rollbackEvidence }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('rollback_failed'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('failed'), reasonCode: z.literal('rollback_failed'), message: z.string().min(1).max(500), ...rollbackEvidence }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('apply_indeterminate'), failure: indeterminateFailureSchema, rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('order_state_unknown'), message: z.string().min(1).max(500), restoredParentOrder: z.null(), restoredTargets: z.null() }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('rollback_indeterminate'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('rollback_indeterminate'), message: z.string().min(1).max(500), ...rollbackEvidence }), audit: mutationAuditSchema }),
]).superRefine((transaction, context) => {
    const prefix = ['preflight:started:', 'preflight:succeeded:', 'plan:started:', 'plan:succeeded:'];
    let expected;
    if (transaction.state === 'planned')
        expected = [...prefix, 'apply:skipped:not_requested', 'verify:skipped:not_requested', 'rollback:skipped:not_requested'];
    else if (transaction.state === 'verified')
        expected = [...prefix, 'apply:started:', 'apply:attempted:', 'apply:succeeded:', 'verify:started:', 'verify:succeeded:', 'rollback:skipped:not_required'];
    else if (transaction.state === 'apply_failed')
        expected = [...prefix, 'apply:started:', 'apply:failed:apply_failed', 'verify:skipped:not_required', 'rollback:skipped:not_required'];
    else if (transaction.state === 'apply_indeterminate')
        expected = [...prefix, 'apply:started:', 'apply:attempted:', 'apply:failed:apply_indeterminate'];
    else {
        const failure = transaction.failure.phase === 'apply'
            ? ['apply:started:', 'apply:attempted:', 'apply:failed:apply_failed', 'verify:skipped:not_required']
            : ['apply:started:', 'apply:attempted:', 'apply:succeeded:', 'verify:started:', 'verify:failed:verify_mismatch'];
        expected = [...prefix, ...failure, 'rollback:started:', transaction.state === 'rolled_back' ? 'rollback:succeeded:' : `rollback:failed:${transaction.state === 'rollback_failed' ? 'rollback_failed' : 'rollback_indeterminate'}`];
    }
    const actual = transaction.audit.map((event) => `${event.phase}:${event.event}:${'reasonCode' in event ? event.reasonCode : ''}`);
    if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index]))
        context.addIssue({ code: 'custom', message: 'Stacking audit sequence does not match transaction state.' });
    transaction.audit.forEach((event, index) => { if (event.sequence !== index)
        context.addIssue({ code: 'custom', message: 'Stacking audit sequence must be contiguous.' }); });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' && event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode && event.message === transaction.failure.message);
        if (matches.length !== 1)
            context.addIssue({ code: 'custom', message: 'Stacking failure must match one audit event.' });
    }
    if (transaction.state === 'rolled_back' && (transaction.rollback.restoredParentOrder === null || transaction.rollback.restoredTargets === null)) {
        context.addIssue({ code: 'custom', message: 'A rolled-back stacking change must carry the restored order and target snapshots.' });
    }
    if (transaction.state === 'rollback_failed' || transaction.state === 'rollback_indeterminate' || transaction.state === 'apply_indeterminate') {
        const rollbackEvent = transaction.audit.find((event) => event.event === 'failed' && event.phase === (transaction.state === 'apply_indeterminate' ? 'apply' : 'rollback'));
        if (rollbackEvent === undefined || !('message' in rollbackEvent) || rollbackEvent.message !== transaction.rollback.message) {
            context.addIssue({ code: 'custom', message: 'Stacking rollback summary must match its audit event.' });
        }
    }
    if (transaction.state === 'rollback_failed' && transaction.rollback.restoredParentOrder === null) {
        context.addIssue({ code: 'custom', message: 'A failed stacking rollback must report the order it observed.' });
    }
});
export const setStackingOrderResultSchema = z.union([
    z.strictObject({ operation: z.literal(SET_STACKING_ORDER_OPERATION), applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ operation: z.literal(SET_STACKING_ORDER_OPERATION), applied: z.literal(true), document: documentContextSchema, plan: planSchema,
        postcondition: z.strictObject({ parentOrder: orderSchema, targets: z.array(stackingTargetSnapshotSchema).min(STACKING_MIN_TARGETS).max(STACKING_MAX_TARGETS) }), transaction: transactionSchema }),
]).superRefine((result, context) => {
    if (result.plan.targetsBefore.some(hasCmykPaint) && result.document.colorSpace !== 'CMYK') {
        context.addIssue({ code: 'custom', message: 'CMYK paint is measured in a CMYK document only.' });
    }
    if (result.transaction.state === 'planned') {
        if (result.plan.confirmationStatus !== 'required' || !sameCanonical(result.plan.applyBlockedReasonCodes, targetBlockers(result.document.mutationAllowed, result.plan.targetsBefore))) {
            context.addIssue({ code: 'custom', message: 'Planned stacking change must expose exact blockers.' });
        }
    }
    else if (result.plan.confirmationStatus !== 'confirmed' || result.plan.applyBlockedReasonCodes.length !== 0 || !result.plan.applyAllowed || targetBlockers(true, result.plan.targetsBefore).length !== 0) {
        context.addIssue({ code: 'custom', message: 'Applied stacking attempt must derive from an allowed confirmed plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified' || !sameCanonical(result.postcondition.parentOrder, result.plan.parentOrderAfter) || !sameCanonical(result.postcondition.targets, result.plan.targetsBefore)) {
            context.addIssue({ code: 'custom', message: 'Verified stacking change must match the planned order with unchanged target snapshots.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified stacking transaction must be applied.' });
    }
    if (result.transaction.state === 'rolled_back' && (!sameCanonical(result.transaction.rollback.restoredParentOrder, result.plan.parentOrderBefore) || !sameCanonical(result.transaction.rollback.restoredTargets, result.plan.targetsBefore))) {
        context.addIssue({ code: 'custom', message: 'Rolled-back stacking change must prove the exact baseline order and target snapshots.' });
    }
});
export const setStackingOrderResponseSchema = z.strictObject({
    outcome: setStackingOrderResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
export const SET_STACKING_ORDER_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: SET_STACKING_ORDER_OPERATION,
    policy: {
        version: 1, class: 'update_existing', destructive: false,
        evidence: { identity: 'target_native_uuid_set', beforeState: 'before_state_hash', postcondition: 'updated_state_matches_plan' },
        preconditions: { documentBinding: 'explicit_document_key', compareAndSet: 'before_state_hash_match' },
        confirmation: 'exact_change_set',
        recovery: { mode: 'verified_inverse', verification: 'restored_state_matches_before_hash', partialRecovery: 'indeterminate' },
        terminal: { success: 'verified', failure: 'proven_pre_apply_or_verified_recovery', partialSuccess: 'nonterminal_until_reconciled' },
        replay: { requestBinding: 'canonical_request_digest', retry: 'return_attested_terminal_result', beforeTerminal: 'reconcile_required', reapplyOnRetry: false },
    },
    capabilities: {
        class: 'update_existing', explicitDocumentBinding: true, bindTargetNativeUuid: true, captureBeforeStateHash: true, compareAndSetBeforeApply: true,
        verifyUpdatedState: true, recoveryMode: 'verified_inverse', verifyRestoredBeforeState: true, reconcileIndeterminate: true, durableTerminalReplay: true, trustedTerminalAttestationResolver: true,
    },
});
export const SET_STACKING_ORDER_SAFETY_IDENTITY = canonicalDigest(SET_STACKING_ORDER_SAFETY);
function targetEvidence(result) {
    return { targetUuids: [...result.plan.targetUuids], targetSetHash: canonicalDigest(result.plan.targetUuids) };
}
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    const beforeStateHash = canonicalDigest({ targetsBefore: result.plan.targetsBefore, parentOrderBefore: result.plan.parentOrderBefore });
    const afterStateHash = canonicalDigest({ targetsAfter: result.plan.targetsBefore, parentOrderAfter: result.plan.parentOrderAfter });
    const changeSetHash = canonicalDigest({ targetUuids: result.plan.targetUuids, method: result.plan.method, beforeStateHash, afterStateHash });
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'update_existing', operationId: SET_STACKING_ORDER_OPERATION, canonicalRequestDigest: requestDigest,
        evidence: { documentKey: admissionDocumentKey, ...targetEvidence(result), beforeStateHash, plannedAfterStateHash: afterStateHash, plannedChangeSetDigest: changeSetHash },
        preconditions: { status: result.plan.applyBlockedReasonCodes.length === 0 ? 'satisfied' : 'blocked', compareAndSetMatched: result.plan.applyBlockedReasonCodes.length === 0 },
        confirmation: { kind: 'exact_change_set', canonicalRequestDigest: requestDigest, changeSetHash, status: result.plan.confirmationStatus },
        applyAllowed: result.plan.applyAllowed,
    });
}
function safetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' || transaction.state === 'rollback_indeterminate' || transaction.state === 'rollback_failed') {
        throw new Error('Indeterminate or failed stacking recovery cannot be terminal.');
    }
    const common = { policyVersion: 1, operationClass: 'update_existing', operationId: SET_STACKING_ORDER_OPERATION, canonicalRequestDigest: requestDigest, planDigest: plan.planDigest, attestation };
    const boundPlan = plan;
    const beforeStateHash = boundPlan.evidence.beforeStateHash;
    const evidence = targetEvidence(result);
    if (transaction.state === 'verified' && result.applied) {
        return operationSafetyResultSchema.parse({ ...common, evidence: { ...evidence, beforeStateHash, afterStateHash: boundPlan.evidence.plannedAfterStateHash, restoredStateHash: null, restoredBeforeStateVerified: false },
            executionEvidence: { outcome: 'completed' }, resolution: { status: 'succeeded', terminal: true, recovery: 'not_required', proof: { kind: 'verified_postcondition' }, replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    if (transaction.state === 'rolled_back') {
        return operationSafetyResultSchema.parse({ ...common, evidence: { ...evidence, beforeStateHash, afterStateHash: null, restoredStateHash: beforeStateHash, restoredBeforeStateVerified: true },
            executionEvidence: { outcome: 'completed' }, resolution: { status: 'recovered', terminal: true, recovery: 'verified', proof: { kind: 'verified_recovery' }, replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    return operationSafetyResultSchema.parse({ ...common, evidence: { ...evidence, beforeStateHash, afterStateHash: null, restoredStateHash: null, restoredBeforeStateVerified: false },
        executionEvidence: { outcome: 'proven_pre_apply' }, resolution: { status: 'failed', terminal: true, recovery: 'not_required', proof: { kind: 'proven_pre_apply', mutationAttempted: false }, replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
}
async function assertSafety(value, requestDigest, attestation, resolver) {
    const result = setStackingOrderResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null)
        throw new Error('Stacking terminal result requires attestation.');
    await assertOperationSafetyAdapterConformance({ registration: SET_STACKING_ORDER_SAFETY, plan, result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
export const SET_STACKING_ORDER_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${SUPPORTED_PATH_ITEM_HOST_SCRIPT}
var STACKING_MIN_TARGETS = ${STACKING_MIN_TARGETS};
var STACKING_MAX_TARGETS = ${STACKING_MAX_TARGETS};

function stackingIndexOf(order, uuid) { for (var i = 0; i < order.length; i++) if (order[i] === uuid) return i; return -1; }
function stackingSameSequence(left, right) { return mutationSameSequence(left, right); }
/** Identical to the TypeScript derivation: front/back move to the ends, forward/backward swap with the neighbour. */
function stackingDerive(before, targets, method) {
  var order = before.slice(0);
  for (var t = 0; t < targets.length; t++) {
    var uuid = targets[t];
    var index = stackingIndexOf(order, uuid);
    if (index < 0) throw mutationError("preflight_failed", "Stacking target is absent from the layer order.");
    if (method === "front") { order.splice(index, 1); order.unshift(uuid); }
    else if (method === "back") { order.splice(index, 1); order.push(uuid); }
    else if (method === "forward") { if (index > 0) { order[index] = order[index - 1]; order[index - 1] = uuid; } }
    else if (method === "backward") { if (index < order.length - 1) { order[index] = order[index + 1]; order[index + 1] = uuid; } }
    else throw mutationError("preflight_failed", "Unsupported stacking method.");
  }
  return order;
}
function stackingBlockers(context, snapshots) {
  var blockers = [];
  function add(code) { if (stackingIndexOf(blockers, code) < 0) blockers.push(code); }
  if (!context.mutationAllowed) add("document_mutation_not_allowed");
  for (var i = 0; i < snapshots.length; i++) {
    var s = snapshots[i];
    if (s.locked) add("target_locked");
    if (s.hidden) add("target_hidden");
    if (!s.editable) add("target_not_editable");
    if (!s.layerVisible) add("layer_hidden");
    if (!s.effectiveLayerVisible && s.layerVisible) add("ancestor_hidden");
    if (s.layerLocked) add("layer_locked");
    if (s.effectiveLayerLocked && !s.layerLocked) add("ancestor_locked");
  }
  return blockers;
}

/** CMYK paint is measured only for BRINGTOFRONT in a CMYK document (CMYK-STACK-FRONT); every other scope refuses it. */
function stackingPaintScope(document) {
  return {
    cmykAdmitted: function () {
      if (params.method !== "front") return false;
      try { return document.documentColorSpace === DocumentColorSpace.CMYK; }
      catch (spaceError) { throw mutationError("preflight_failed", "The bound document color space is unavailable."); }
    },
    cmykRefusal: "is CMYKColor; stacking supports CMYK paint only for method front in a CMYK document."
  };
}

function stackingResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  var paint = stackingPaintScope(document);
  if (!params.targetUuids || params.targetUuids.length < STACKING_MIN_TARGETS || params.targetUuids.length > STACKING_MAX_TARGETS) {
    throw mutationError("preflight_failed", "Stacking requires " + STACKING_MIN_TARGETS + " to " + STACKING_MAX_TARGETS + " target UUIDs.");
  }
  var seen = {};
  var targets = [];
  var snapshots = [];
  var layer = null;
  for (var index = 0; index < params.targetUuids.length; index++) {
    var uuid = params.targetUuids[index];
    if (typeof uuid !== "string" || uuid.length === 0 || seen["u:" + uuid] === true) throw mutationError("preflight_failed", "Stacking target UUIDs must be unique non-empty strings.");
    seen["u:" + uuid] = true;
    var target = supportedPathFind(document, uuid);
    if (target === null) throw new Error("MCP_ERROR:" + stringifyJson({ code: "OBJECT_NOT_FOUND", uuid: uuid }));
    var snapshot = supportedPathSnapshot(document, target, uuid, "Layer", paint);
    if (layer === null) layer = target.layer;
    if (target.layer !== layer || target.parent !== layer || !stackingSameSequence(snapshot.layerPath, snapshots.length === 0 ? snapshot.layerPath : snapshots[0].layerPath)) {
      throw mutationError("preflight_failed", "All stacking targets must be direct children of one layer.");
    }
    targets.push(target);
    snapshots.push(snapshot);
  }
  var orderBefore = supportedPathOrder(layer);
  var orderAfter = stackingDerive(orderBefore, params.targetUuids, params.method);
  var blockers = stackingBlockers(context, snapshots);
  if (forApply) {
    if (!supportedPathSame(snapshots, params.expectedTargetsBefore)) throw mutationError("preflight_failed", "Target states do not match expected_targets_before.");
    if (!stackingSameSequence(orderBefore, params.expectedParentOrder)) throw mutationError("preflight_failed", "Layer order does not match expected_parent_order.");
    if (blockers.length > 0) throw new Error("MCP_ERROR:" + stringifyJson({ code: "STACKING_APPLY_BLOCKED", reasonCodes: blockers, uuids: params.targetUuids }));
  }
  return { context: context, document: document, paint: paint, layer: layer, targets: targets, targetsBefore: snapshots, orderBefore: orderBefore, orderAfter: orderAfter, blockers: blockers };
}

function stackingPlan(preflight) {
  return { operation: "set_stacking_order", documentKey: preflight.context.key, targetUuids: params.targetUuids, method: params.method,
    targetsBefore: preflight.targetsBefore, parentOrderBefore: preflight.orderBefore, parentOrderAfter: preflight.orderAfter,
    changesOrder: !stackingSameSequence(preflight.orderBefore, preflight.orderAfter),
    applyBlockedReasonCodes: preflight.blockers, confirmationStatus: params.apply === true ? "confirmed" : "required",
    applyAllowed: params.apply === true && preflight.blockers.length === 0 };
}

function stackingRevalidate(preflight, plan) {
  var current;
  try { current = stackingResolve(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Stacking preconditions changed before apply.")); }
  if (current.document !== preflight.document || current.layer !== preflight.layer || current.targets.length !== preflight.targets.length ||
      !supportedPathSame(current.targetsBefore, plan.targetsBefore) || !stackingSameSequence(current.orderBefore, plan.parentOrderBefore)) {
    throw mutationBeforeSideEffectError("Stacking targets or layer order changed before apply.");
  }
  for (var i = 0; i < current.targets.length; i++) if (current.targets[i] !== preflight.targets[i]) throw mutationBeforeSideEffectError("Stacking target native identity changed before apply.");
}

function stackingMethodEnum(method) {
  if (method === "front") return ZOrderMethod.BRINGTOFRONT;
  if (method === "back") return ZOrderMethod.SENDTOBACK;
  if (method === "forward") return ZOrderMethod.BRINGFORWARD;
  return ZOrderMethod.SENDBACKWARD;
}

function stackingApply(preflight, plan, state) {
  state.operationState.mutationStarted = true;
  var method = stackingMethodEnum(params.method);
  for (var i = 0; i < preflight.targets.length; i++) preflight.targets[i].zOrder(method);
  return preflight.targets.length;
}

function stackingVerify(preflight, plan) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) throw mutationError("verify_mismatch", "Active document changed during stacking verification.");
  var order = supportedPathOrder(preflight.layer);
  if (!stackingSameSequence(order, plan.parentOrderAfter)) throw mutationError("verify_mismatch", "Layer order does not match the planned stacking order.");
  var targets = [];
  for (var i = 0; i < preflight.targets.length; i++) {
    var target = supportedPathFind(preflight.document, params.targetUuids[i]);
    if (target === null || target !== preflight.targets[i] || target.parent !== preflight.layer) throw mutationError("verify_mismatch", "Stacking target native identity does not match the plan.");
    targets.push(supportedPathSnapshot(preflight.document, target, params.targetUuids[i], "Layer", preflight.paint));
  }
  if (!supportedPathSame(targets, plan.targetsBefore)) throw mutationError("verify_mismatch", "A stacking target changed beyond its order.");
  return { parentOrder: order, targets: targets };
}

/**
 * Restores the captured order by moving only the targets: each target, in baseline order, is placed
 * before the first non-target that follows it in the baseline (or at the end of the layer).
 */
function stackingRollback(state) {
  var preflight = state.preflight;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
  var isTarget = {};
  for (var t = 0; t < params.targetUuids.length; t++) isTarget["u:" + params.targetUuids[t]] = true;
  var currentOrder;
  try { currentOrder = supportedPathOrder(preflight.layer); } catch (e) { return { status: "indeterminate", message: "Rollback layer order is indeterminate." }; }
  // Only proceed while the layer holds exactly the baseline's items (any permutation) and every target still resolves.
  if (currentOrder.length !== preflight.orderBefore.length) return { status: "indeterminate", message: "Rollback refused because the layer item set changed." };
  for (var c = 0; c < currentOrder.length; c++) if (stackingIndexOf(preflight.orderBefore, currentOrder[c]) < 0) return { status: "indeterminate", message: "Rollback refused because the layer holds an unexpected item." };
  // Moving only the targets can restore the baseline only while the non-targets kept their relative order.
  var nonTargetsNow = [], nonTargetsBefore = [];
  for (var q = 0; q < currentOrder.length; q++) if (isTarget["u:" + currentOrder[q]] !== true) nonTargetsNow.push(currentOrder[q]);
  for (var w = 0; w < preflight.orderBefore.length; w++) if (isTarget["u:" + preflight.orderBefore[w]] !== true) nonTargetsBefore.push(preflight.orderBefore[w]);
  if (!stackingSameSequence(nonTargetsNow, nonTargetsBefore)) return { status: "indeterminate", message: "Rollback refused because non-target items changed order." };
  var resolved = [];
  for (var r = 0; r < preflight.targets.length; r++) {
    var target;
    try { target = supportedPathFind(preflight.document, params.targetUuids[r]); } catch (e) { return { status: "indeterminate", message: "Rollback target lookup is indeterminate." }; }
    if (target === null || target !== preflight.targets[r] || target.parent !== preflight.layer) return { status: "indeterminate", message: "Rollback target identity or parent changed." };
    resolved.push(target);
  }
  if (!stackingSameSequence(currentOrder, preflight.orderBefore)) {
    try {
      for (var b = 0; b < preflight.orderBefore.length; b++) {
        var uuid = preflight.orderBefore[b];
        if (isTarget["u:" + uuid] !== true) continue;
        var target = resolved[stackingIndexOf(params.targetUuids, uuid)];
        var anchor = null;
        for (var n = b + 1; n < preflight.orderBefore.length; n++) {
          if (isTarget["u:" + preflight.orderBefore[n]] !== true) { anchor = supportedPathFind(preflight.document, preflight.orderBefore[n]); break; }
        }
        if (anchor !== null) target.move(anchor, ElementPlacement.PLACEBEFORE);
        else target.move(preflight.layer, ElementPlacement.PLACEATEND);
      }
    } catch (moveError) { return { status: "indeterminate", message: "Rollback move is indeterminate." }; }
  }
  var restoredOrder;
  var restoredTargets = [];
  try {
    restoredOrder = supportedPathOrder(preflight.layer);
    for (var v = 0; v < resolved.length; v++) restoredTargets.push(supportedPathSnapshot(preflight.document, resolved[v], params.targetUuids[v], "Layer", preflight.paint));
  } catch (e) { return { status: "indeterminate", message: "Rollback verification is indeterminate." }; }
  state.operationState.rollbackEvidence.restoredParentOrder = restoredOrder;
  state.operationState.rollbackEvidence.restoredTargets = restoredTargets;
  if (!stackingSameSequence(restoredOrder, preflight.orderBefore)) return { status: "failed", message: "Rollback did not restore the exact baseline layer order." };
  if (!supportedPathSame(restoredTargets, preflight.targetsBefore)) return { status: "indeterminate", message: "Rollback restored the order but a target snapshot differs from its before state." };
  return { status: "verified" };
}

var stackingExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionLayers: function (phase, preflight) { return [preflight.layer]; },
  editSessionAffected: function () { return params.targetUuids.slice(0); },
  initialOperationState: function () { return { mutationStarted: false, rollbackEvidence: { restoredParentOrder: null, restoredTargets: null } }; },
  preflight: stackingResolve,
  plan: stackingPlan,
  revalidate: stackingRevalidate,
  applyMutation: stackingApply,
  verify: stackingVerify,
  rollback: stackingRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () { return { reasonCode: "order_state_unknown", message: "Stacking apply outcome is indeterminate.", evidence: { restoredParentOrder: null, restoredTargets: null } }; },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var stackingDocument = stackingExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === stackingExecution.preflight.document) stackingDocument = getDocumentContext();
var result = { operation: "set_stacking_order", applied: stackingExecution.transaction.state === "verified", document: stackingDocument, plan: stackingExecution.plan, transaction: stackingExecution.transaction };
if (stackingExecution.transaction.state === "verified") result.postcondition = stackingExecution.value;
`;
export const SET_STACKING_ORDER_HOST_SCRIPT_DIGEST = canonicalSha256(SET_STACKING_ORDER_SCRIPT);
export const SET_STACKING_ORDER_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: SET_STACKING_ORDER_OPERATION, validator: SET_STACKING_ORDER_VALIDATOR,
    canonicalContractVersion: CANONICAL_VERSION, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: SET_STACKING_ORDER_SAFETY_IDENTITY, hostScriptDigest: SET_STACKING_ORDER_HOST_SCRIPT_DIGEST,
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    const digestRequest = 'commandId' in request ? (({ commandId: _commandId, ...rest }) => rest)(request) : request;
    const digest = canonicalSha256({ operation: SET_STACKING_ORDER_OPERATION, validator: SET_STACKING_ORDER_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: 'commandId' in request ? request.commandId : null, documentKey: request.expectedDocumentKey, digest };
}
export const setStackingOrderToolContract = {
    name: 'illustrator_set_stacking_order',
    title: 'Plan or Change Stacking Order',
    description: `Plan or apply front / back / forward / backward to ${STACKING_MIN_TARGETS}-${STACKING_MAX_TARGETS} distinct layer-direct PathItems of one layer, in request order. The plan binds every target snapshot and the layer's complete direct-item order and derives the exact after order. Apply performs compare-and-set on both, changes the order in one host call, verifies the layer order by native read-back, and on failure moves only the targets back to their captured positions and proves the exact baseline order.`,
    inputSchema,
    publicInputSchema: setStackingOrderPublicInputSchema,
    outputSchema: setStackingOrderResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(SET_STACKING_ORDER_SAFETY.policy),
    normalizePublicInput,
};
export function createSetStackingOrderAdapter() {
    return {
        version: 1, operation: SET_STACKING_ORDER_OPERATION, validator: SET_STACKING_ORDER_VALIDATOR,
        safety: SET_STACKING_ORDER_SAFETY, safetyRegistrationIdentity: SET_STACKING_ORDER_SAFETY_IDENTITY,
        adapterIdentity: SET_STACKING_ORDER_ADAPTER_IDENTITY, tool: setStackingOrderToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: setStackingOrderResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
        safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: SET_STACKING_ORDER_HOST_SCRIPT_DIGEST,
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: SET_STACKING_ORDER_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: SET_STACKING_ORDER_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: SET_STACKING_ORDER_OPERATION, documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: SET_STACKING_ORDER_ADAPTER_IDENTITY, script: SET_STACKING_ORDER_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = setStackingOrderResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back')
                return { state };
            if (state === 'planned')
                throw new Error('Stacking plan is not a terminal mutation result.');
            throw new Error('Unverified stacking recovery must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error, detail) {
            if (detail?.code === 'OBJECT_NOT_FOUND')
                return new Error(`No PageItem with UUID ${JSON.stringify(detail.uuid ?? '')} exists in the bound document.`);
            if (detail?.code === 'STACKING_APPLY_BLOCKED')
                return new Error(`Stacking change is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}.`);
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
