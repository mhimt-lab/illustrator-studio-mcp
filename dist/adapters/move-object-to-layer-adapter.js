import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, layerPathSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { duplicateObjectSnapshotSchema } from './duplicate-object-adapter.js';
import { SUPPORTED_PATH_ITEM_HOST_SCRIPT, SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS, } from './supported-path-item-host-script.js';
export const MOVE_OBJECT_TO_LAYER_OPERATION = 'move_object_to_layer';
export const MOVE_OBJECT_TO_LAYER_VALIDATOR = { kind: MOVE_OBJECT_TO_LAYER_OPERATION, version: 1 };
const CANONICAL_VERSION = 1;
const RESULT_SCHEMA_VERSION = 1;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
const uuidSchema = z.string().min(1).max(255);
const placementSchema = z.enum(['front', 'back']);
function orderSchema(min, max) {
    return z.array(uuidSchema).min(min).max(max).superRefine((uuids, context) => {
        if (new Set(uuids).size !== uuids.length) {
            context.addIssue({ code: 'custom', message: 'Layer order must contain unique native UUIDs.' });
        }
    });
}
const sourceOrderBeforeSchema = orderSchema(1, SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS);
const destinationOrderBeforeSchema = orderSchema(0, SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS);
const sourceOrderAfterSchema = orderSchema(0, SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS - 1);
const destinationOrderAfterSchema = orderSchema(1, SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS);
const observedLayerOrderSchema = orderSchema(0, SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS);
const destinationLayerSchema = z.strictObject({
    path: layerPathSchema,
    name: z.string().max(255),
    visible: z.boolean(),
    locked: z.boolean(),
    effectiveVisible: z.boolean(),
    effectiveLocked: z.boolean(),
});
const rollbackAnchorSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('before_next'), uuid: uuidSchema }),
    z.strictObject({ kind: z.literal('after_previous'), uuid: uuidSchema }),
    z.strictObject({ kind: z.literal('source_beginning') }),
]);
function sameCanonical(left, right) {
    return canonicalSha256(left) === canonicalSha256(right);
}
function deriveAfter(before, destination) {
    return {
        ...before,
        layerPath: destination.path,
        layerVisible: destination.visible,
        layerLocked: destination.locked,
        effectiveLayerVisible: destination.effectiveVisible,
        effectiveLayerLocked: destination.effectiveLocked,
    };
}
function withoutTarget(order, targetUuid) {
    return order.filter((uuid) => uuid !== targetUuid);
}
function destinationAfter(order, targetUuid, placement) {
    return placement === 'front' ? [targetUuid, ...order] : [...order, targetUuid];
}
const commonInternal = {
    expectedDocumentKey: z.string().min(1).max(16_384),
    targetUuid: uuidSchema,
    destinationLayerPath: layerPathSchema,
    placement: placementSchema,
};
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({
        ...commonInternal,
        expectedBefore: duplicateObjectSnapshotSchema,
        expectedAfter: duplicateObjectSnapshotSchema,
        expectedSourceOrder: sourceOrderBeforeSchema,
        expectedDestinationOrder: destinationOrderBeforeSchema,
        apply: z.literal(true),
        commandId: canonicalCommandIdSchema,
    }),
]);
const commonPublic = {
    expected_document_key: z.string().min(1).max(16_384),
    target_uuid: uuidSchema,
    destination_layer_path: layerPathSchema,
    placement: placementSchema,
};
export const moveObjectToLayerPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({
        ...commonPublic,
        expected_before: duplicateObjectSnapshotSchema,
        expected_after: duplicateObjectSnapshotSchema,
        expected_source_order: sourceOrderBeforeSchema,
        expected_destination_order: destinationOrderBeforeSchema,
        apply: z.literal(true),
        command_id: applyCommandIdSchema,
    }),
]);
const inputSchema = z.strictObject({
    ...commonPublic,
    expected_before: duplicateObjectSnapshotSchema.optional(),
    expected_after: duplicateObjectSnapshotSchema.optional(),
    expected_source_order: sourceOrderBeforeSchema.optional(),
    expected_destination_order: destinationOrderBeforeSchema.optional(),
    apply: z.boolean().default(false),
    command_id: applyCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(moveObjectToLayerPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = moveObjectToLayerPublicInputSchema.parse(input);
    const common = {
        expectedDocumentKey: value.expected_document_key,
        targetUuid: value.target_uuid,
        destinationLayerPath: value.destination_layer_path,
        placement: value.placement,
    };
    return value.apply ? {
        ...common,
        expectedBefore: value.expected_before,
        expectedAfter: value.expected_after,
        expectedSourceOrder: value.expected_source_order,
        expectedDestinationOrder: value.expected_destination_order,
        apply: true,
        commandId: value.command_id,
    } : { ...common, apply: false };
}
const blockerSchema = z.enum([
    'document_mutation_not_allowed', 'target_locked', 'target_hidden', 'target_not_editable',
    'source_layer_hidden', 'source_ancestor_hidden', 'source_layer_locked', 'source_ancestor_locked',
    'destination_layer_hidden', 'destination_ancestor_hidden', 'destination_layer_locked',
    'destination_ancestor_locked', 'destination_capacity_exceeded', 'result_size_limit_exceeded',
]);
const planSchema = z.strictObject({
    operation: z.literal(MOVE_OBJECT_TO_LAYER_OPERATION),
    documentKey: z.string().min(1).max(16_384),
    targetUuid: uuidSchema,
    placement: placementSchema,
    before: duplicateObjectSnapshotSchema,
    after: duplicateObjectSnapshotSchema,
    destinationLayer: destinationLayerSchema,
    sourceOrderBefore: sourceOrderBeforeSchema,
    destinationOrderBefore: destinationOrderBeforeSchema,
    sourceIndex: z.number().int().nonnegative().max(SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS - 1),
    rollbackAnchor: rollbackAnchorSchema,
    resultSizeWithinLimit: z.boolean(),
    applyBlockedReasonCodes: z.array(blockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    if (plan.before.uuid !== plan.targetUuid || plan.sourceOrderBefore[plan.sourceIndex] !== plan.targetUuid ||
        !sameCanonical(plan.after, deriveAfter(plan.before, plan.destinationLayer)) ||
        sameCanonical(plan.before.layerPath, plan.destinationLayer.path)) {
        context.addIssue({ code: 'custom', message: 'Layer-move plan identity, source order, or derived after state is invalid.' });
    }
    const expectedAnchor = plan.sourceIndex + 1 < plan.sourceOrderBefore.length
        ? { kind: 'before_next', uuid: plan.sourceOrderBefore[plan.sourceIndex + 1] }
        : plan.sourceIndex > 0
            ? { kind: 'after_previous', uuid: plan.sourceOrderBefore[plan.sourceIndex - 1] }
            : { kind: 'source_beginning' };
    if (!sameCanonical(plan.rollbackAnchor, expectedAnchor)) {
        context.addIssue({ code: 'custom', message: 'Layer-move rollback anchor must bind the exact source order.' });
    }
    if (plan.resultSizeWithinLimit === plan.applyBlockedReasonCodes.includes('result_size_limit_exceeded')) {
        context.addIssue({ code: 'custom', message: 'Layer-move result-size admission must match its blocker.' });
    }
    const allowed = plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0;
    if (plan.applyAllowed !== allowed) {
        context.addIssue({ code: 'custom', message: 'Layer-move applyAllowed must require confirmation and no blockers.' });
    }
});
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']),
    reasonCode: z.enum(['apply_failed', 'verify_mismatch']),
    message: z.string().min(1).max(500),
}).superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed')) {
        context.addIssue({ code: 'custom', message: 'Layer-move failure phase and reason code must match.' });
    }
});
const indeterminateFailureSchema = z.strictObject({
    phase: z.literal('apply'), reasonCode: z.literal('apply_indeterminate'), message: z.string().min(1).max(500),
});
const rollbackEvidence = {
    targetUuid: uuidSchema,
    restoredTarget: duplicateObjectSnapshotSchema.nullable(),
    restoredSourceOrder: observedLayerOrderSchema.nullable(),
    restoredDestinationOrder: observedLayerOrderSchema.nullable(),
};
const transactionSchema = z.discriminatedUnion('state', [
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
        rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('move_state_unknown'),
            message: z.string().min(1).max(500), targetUuid: uuidSchema, restoredTarget: z.null(),
            restoredSourceOrder: z.null(), restoredDestinationOrder: z.null() }), audit: mutationAuditSchema }),
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
        context.addIssue({ code: 'custom', message: 'Layer-move audit sequence does not match transaction state.' });
    }
    transaction.audit.forEach((event, index) => {
        if (event.sequence !== index)
            context.addIssue({ code: 'custom', message: 'Layer-move audit sequence must be contiguous.' });
    });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' && event.phase === transaction.failure.phase &&
            event.reasonCode === transaction.failure.reasonCode && event.message === transaction.failure.message);
        if (matches.length !== 1)
            context.addIssue({ code: 'custom', message: 'Layer-move failure must match one audit event.' });
    }
});
const postconditionSchema = z.strictObject({
    target: duplicateObjectSnapshotSchema,
    sourceOrderAfter: sourceOrderAfterSchema,
    destinationOrderAfter: destinationOrderAfterSchema,
});
export const moveObjectToLayerResultSchema = z.union([
    z.strictObject({ operation: z.literal(MOVE_OBJECT_TO_LAYER_OPERATION), applied: z.literal(false),
        document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ operation: z.literal(MOVE_OBJECT_TO_LAYER_OPERATION), applied: z.literal(true),
        document: documentContextSchema, plan: planSchema, postcondition: postconditionSchema, transaction: transactionSchema }),
]).superRefine((result, context) => {
    if (result.transaction.state === 'planned') {
        const expectedBlockers = [];
        if (!result.document.mutationAllowed)
            expectedBlockers.push('document_mutation_not_allowed');
        if (result.plan.before.locked)
            expectedBlockers.push('target_locked');
        if (result.plan.before.hidden)
            expectedBlockers.push('target_hidden');
        if (!result.plan.before.editable)
            expectedBlockers.push('target_not_editable');
        if (!result.plan.before.layerVisible)
            expectedBlockers.push('source_layer_hidden');
        if (!result.plan.before.effectiveLayerVisible && result.plan.before.layerVisible) {
            expectedBlockers.push('source_ancestor_hidden');
        }
        if (result.plan.before.layerLocked)
            expectedBlockers.push('source_layer_locked');
        if (result.plan.before.effectiveLayerLocked && !result.plan.before.layerLocked) {
            expectedBlockers.push('source_ancestor_locked');
        }
        if (!result.plan.destinationLayer.visible)
            expectedBlockers.push('destination_layer_hidden');
        if (!result.plan.destinationLayer.effectiveVisible && result.plan.destinationLayer.visible) {
            expectedBlockers.push('destination_ancestor_hidden');
        }
        if (result.plan.destinationLayer.locked)
            expectedBlockers.push('destination_layer_locked');
        if (result.plan.destinationLayer.effectiveLocked && !result.plan.destinationLayer.locked) {
            expectedBlockers.push('destination_ancestor_locked');
        }
        if (result.plan.destinationOrderBefore.length >= SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS) {
            expectedBlockers.push('destination_capacity_exceeded');
        }
        if (!result.plan.resultSizeWithinLimit)
            expectedBlockers.push('result_size_limit_exceeded');
        if (result.plan.confirmationStatus !== 'required' ||
            !sameCanonical(result.plan.applyBlockedReasonCodes, expectedBlockers)) {
            context.addIssue({ code: 'custom', message: 'Planned layer move must expose the exact preflight blockers.' });
        }
    }
    else if (result.plan.confirmationStatus !== 'confirmed' ||
        result.plan.applyBlockedReasonCodes.length !== 0 || !result.plan.applyAllowed) {
        context.addIssue({ code: 'custom', message: 'Applied layer-move attempt must derive from an allowed confirmed plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified' || !sameCanonical(result.postcondition.target, result.plan.after) ||
            !sameCanonical(result.postcondition.sourceOrderAfter, withoutTarget(result.plan.sourceOrderBefore, result.plan.targetUuid)) ||
            !sameCanonical(result.postcondition.destinationOrderAfter, destinationAfter(result.plan.destinationOrderBefore, result.plan.targetUuid, result.plan.placement))) {
            context.addIssue({ code: 'custom', message: 'Verified layer move must match the exact target and both complete orders.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified layer move must be applied.' });
    }
    if (result.transaction.state === 'rolled_back' &&
        (!sameCanonical(result.transaction.rollback.restoredTarget, result.plan.before) ||
            !sameCanonical(result.transaction.rollback.restoredSourceOrder, result.plan.sourceOrderBefore) ||
            !sameCanonical(result.transaction.rollback.restoredDestinationOrder, result.plan.destinationOrderBefore))) {
        context.addIssue({ code: 'custom', message: 'Rolled-back layer move must prove exact target and order restoration.' });
    }
});
export const moveObjectToLayerResponseSchema = z.strictObject({
    outcome: moveObjectToLayerResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
export const MOVE_OBJECT_TO_LAYER_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: MOVE_OBJECT_TO_LAYER_OPERATION,
    policy: {
        version: 1, class: 'update_existing', destructive: false,
        evidence: { identity: 'target_native_uuid', beforeState: 'before_state_hash',
            postcondition: 'updated_state_matches_plan' },
        preconditions: { documentBinding: 'explicit_document_key', compareAndSet: 'before_state_hash_match' },
        confirmation: 'exact_change_set',
        recovery: { mode: 'verified_inverse', verification: 'restored_state_matches_before_hash',
            partialRecovery: 'indeterminate' },
        terminal: { success: 'verified', failure: 'proven_pre_apply_or_verified_recovery',
            partialSuccess: 'nonterminal_until_reconciled' },
        replay: { requestBinding: 'canonical_request_digest', retry: 'return_attested_terminal_result',
            beforeTerminal: 'reconcile_required', reapplyOnRetry: false },
    },
    capabilities: {
        class: 'update_existing', explicitDocumentBinding: true, bindTargetNativeUuid: true,
        captureBeforeStateHash: true, compareAndSetBeforeApply: true, verifyUpdatedState: true,
        recoveryMode: 'verified_inverse', verifyRestoredBeforeState: true, reconcileIndeterminate: true,
        durableTerminalReplay: true, trustedTerminalAttestationResolver: true,
    },
});
export const MOVE_OBJECT_TO_LAYER_SAFETY_IDENTITY = canonicalDigest(MOVE_OBJECT_TO_LAYER_SAFETY);
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    const beforeStateHash = canonicalDigest({ target: result.plan.before, source: result.plan.sourceOrderBefore,
        destination: result.plan.destinationOrderBefore });
    const afterStateHash = canonicalDigest({ target: result.plan.after,
        source: withoutTarget(result.plan.sourceOrderBefore, result.plan.targetUuid),
        destination: destinationAfter(result.plan.destinationOrderBefore, result.plan.targetUuid, result.plan.placement) });
    const changeSetHash = canonicalDigest({ targetUuid: result.plan.targetUuid, placement: result.plan.placement,
        destinationLayer: result.plan.destinationLayer, beforeStateHash, afterStateHash });
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'update_existing', operationId: MOVE_OBJECT_TO_LAYER_OPERATION,
        canonicalRequestDigest: requestDigest,
        evidence: { documentKey: admissionDocumentKey, targetUuid: result.plan.targetUuid,
            beforeStateHash, plannedAfterStateHash: afterStateHash, plannedChangeSetDigest: changeSetHash },
        preconditions: { status: result.plan.applyBlockedReasonCodes.length === 0 ? 'satisfied' : 'blocked',
            compareAndSetMatched: result.plan.applyBlockedReasonCodes.length === 0 },
        confirmation: { kind: 'exact_change_set', canonicalRequestDigest: requestDigest, changeSetHash,
            status: result.plan.confirmationStatus },
        applyAllowed: result.plan.applyAllowed,
    });
}
function safetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' ||
        transaction.state === 'rollback_indeterminate' || transaction.state === 'rollback_failed') {
        throw new Error('Indeterminate or failed layer-move recovery cannot be terminal.');
    }
    const common = { policyVersion: 1, operationClass: 'update_existing',
        operationId: MOVE_OBJECT_TO_LAYER_OPERATION, canonicalRequestDigest: requestDigest,
        planDigest: plan.planDigest, attestation };
    const beforeStateHash = plan.evidence.beforeStateHash;
    if (transaction.state === 'verified' && result.applied) {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { targetUuid: result.plan.targetUuid, beforeStateHash,
                afterStateHash: plan.evidence.plannedAfterStateHash,
                restoredStateHash: null, restoredBeforeStateVerified: false },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'succeeded', terminal: true, recovery: 'not_required',
                proof: { kind: 'verified_postcondition' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    if (transaction.state === 'rolled_back') {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { targetUuid: result.plan.targetUuid, beforeStateHash, afterStateHash: null,
                restoredStateHash: beforeStateHash, restoredBeforeStateVerified: true },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'recovered', terminal: true, recovery: 'verified',
                proof: { kind: 'verified_recovery' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    return operationSafetyResultSchema.parse({ ...common,
        evidence: { targetUuid: result.plan.targetUuid, beforeStateHash, afterStateHash: null,
            restoredStateHash: null, restoredBeforeStateVerified: false },
        executionEvidence: { outcome: 'proven_pre_apply' },
        resolution: { status: 'failed', terminal: true, recovery: 'not_required',
            proof: { kind: 'proven_pre_apply', mutationAttempted: false },
            replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
}
async function assertSafety(value, requestDigest, attestation, resolver) {
    const result = moveObjectToLayerResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null)
        throw new Error('Layer-move terminal result requires attestation.');
    await assertOperationSafetyAdapterConformance({ registration: MOVE_OBJECT_TO_LAYER_SAFETY, plan,
        result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
export const MOVE_OBJECT_TO_LAYER_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}${SUPPORTED_PATH_ITEM_HOST_SCRIPT}
var MOVE_MAX_PARENT_ITEMS = ${SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS};
var MOVE_TARGET_MAX_BYTES = 65536;
var MOVE_ORDER_MAX_BYTES = 32768;
var MOVE_CONTEXT_MAX_BYTES = 24576;

function movePaintScope(document) {
  return {
    cmykAdmitted: function () { return document.documentColorSpace === DocumentColorSpace.CMYK; },
    cmykRefusal: "supports CMYKColor only in a CMYK document."
  };
}
function movePosition(values, wanted) {
  for (var index = 0; index < values.length; index++) if (values[index] === wanted) return index;
  return -1;
}
function moveLayerChain(document, path) {
  if (!path || path.length < 1 || path.length > 64) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "LAYER_PATH_INVALID" }));
  }
  var layers = document.layers;
  var chain = [];
  for (var depth = 0; depth < path.length; depth++) {
    var index = path[depth];
    if (typeof index !== "number" || index < 0 || Math.floor(index) !== index || index >= layers.length) {
      throw new Error("MCP_ERROR:" + stringifyJson({ code: "LAYER_PATH_NOT_FOUND", layerPath: path }));
    }
    var layer = layers[index]; chain.push(layer); layers = layer.layers;
  }
  return chain;
}
function moveLayerInfo(document, path) {
  var chain = moveLayerChain(document, path);
  var layer = chain[chain.length - 1];
  var effectiveVisible = true;
  var effectiveLocked = false;
  for (var index = 0; index < chain.length; index++) {
    if (typeof chain[index].visible !== "boolean" || typeof chain[index].locked !== "boolean") {
      throw mutationError("preflight_failed", "Layer safety state is unavailable.");
    }
    if (!chain[index].visible) effectiveVisible = false;
    if (chain[index].locked) effectiveLocked = true;
  }
  var layerName = String(layer.name || "");
  if (layerName.length > 255) throw mutationError("preflight_failed", "Layer name exceeds the supported bound.");
  return { layer: layer, path: path, name: layerName, visible: layer.visible,
    locked: layer.locked, effectiveVisible: effectiveVisible, effectiveLocked: effectiveLocked };
}
function moveOrder(container, maximum) {
  if (!container.pageItems || container.pageItems.length > maximum) {
    throw mutationError("preflight_failed", "Layer parent order exceeds the supported bound.");
  }
  var result = [];
  var seen = {};
  for (var index = 0; index < container.pageItems.length; index++) {
    var item = container.pageItems[index];
    if (item.parent !== container || typeof item.uuid !== "string" || item.uuid.length === 0 || seen[item.uuid]) {
      throw mutationError("preflight_failed", "Layer order requires unique direct native UUIDs.");
    }
    seen[item.uuid] = true; result.push(item.uuid);
  }
  return result;
}
function moveWithout(order, targetUuid) {
  var result = [];
  for (var index = 0; index < order.length; index++) if (order[index] !== targetUuid) result.push(order[index]);
  return result;
}
function moveDestinationAfter(order, targetUuid, placement) {
  var result = [];
  if (placement === "front") result.push(targetUuid);
  for (var index = 0; index < order.length; index++) result.push(order[index]);
  if (placement === "back") result.push(targetUuid);
  return result;
}
function moveAfter(before, destination) {
  var after = {};
  for (var key in before) if (before.hasOwnProperty(key)) after[key] = before[key];
  after.layerPath = destination.path;
  after.layerVisible = destination.visible; after.layerLocked = destination.locked;
  after.effectiveLayerVisible = destination.effectiveVisible;
  after.effectiveLayerLocked = destination.effectiveLocked;
  return after;
}
function moveAnchor(sourceOrder, sourceIndex) {
  if (sourceIndex + 1 < sourceOrder.length) return { kind: "before_next", uuid: sourceOrder[sourceIndex + 1] };
  if (sourceIndex > 0) return { kind: "after_previous", uuid: sourceOrder[sourceIndex - 1] };
  return { kind: "source_beginning" };
}
function moveResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  var target = supportedPathFind(document, params.targetUuid);
  if (target === null) throw new Error("MCP_ERROR:" + stringifyJson({ code: "OBJECT_NOT_FOUND", uuid: params.targetUuid }));
  var before = supportedPathSnapshot(document, target, params.targetUuid, "Layer", movePaintScope(document));
  var sourceInfo = moveLayerInfo(document, before.layerPath);
  var destinationInfo = moveLayerInfo(document, params.destinationLayerPath);
  if (sourceInfo.layer !== target.layer || target.parent !== sourceInfo.layer) {
    throw mutationError("preflight_failed", "Source layer identity does not match the target.");
  }
  if (sourceInfo.layer === destinationInfo.layer) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "MOVE_SAME_LAYER" }));
  }
  if (params.placement !== "front" && params.placement !== "back") {
    throw mutationError("preflight_failed", "Placement must be front or back.");
  }
  var sourceOrder = moveOrder(sourceInfo.layer, MOVE_MAX_PARENT_ITEMS);
  var destinationOrder = moveOrder(destinationInfo.layer, MOVE_MAX_PARENT_ITEMS);
  var sourceIndex = movePosition(sourceOrder, params.targetUuid);
  if (sourceIndex < 0) throw mutationError("preflight_failed", "Target is absent from the complete source order.");
  var after = moveAfter(before, destinationInfo);
  var sizeWithinLimit = supportedPathUtf8ByteLength(stringifyJson(before)) <= MOVE_TARGET_MAX_BYTES &&
    supportedPathUtf8ByteLength(stringifyJson(sourceOrder)) <= MOVE_ORDER_MAX_BYTES &&
    supportedPathUtf8ByteLength(stringifyJson(destinationOrder)) <= MOVE_ORDER_MAX_BYTES &&
    supportedPathUtf8ByteLength(stringifyJson(context)) <= MOVE_CONTEXT_MAX_BYTES;
  var blockers = [];
  if (!context.mutationAllowed) blockers.push("document_mutation_not_allowed");
  if (before.locked) blockers.push("target_locked");
  if (before.hidden) blockers.push("target_hidden");
  if (!before.editable) blockers.push("target_not_editable");
  if (!before.layerVisible) blockers.push("source_layer_hidden");
  if (!before.effectiveLayerVisible && before.layerVisible) blockers.push("source_ancestor_hidden");
  if (before.layerLocked) blockers.push("source_layer_locked");
  if (before.effectiveLayerLocked && !before.layerLocked) blockers.push("source_ancestor_locked");
  if (!destinationInfo.visible) blockers.push("destination_layer_hidden");
  if (!destinationInfo.effectiveVisible && destinationInfo.visible) blockers.push("destination_ancestor_hidden");
  if (destinationInfo.locked) blockers.push("destination_layer_locked");
  if (destinationInfo.effectiveLocked && !destinationInfo.locked) blockers.push("destination_ancestor_locked");
  if (destinationOrder.length >= MOVE_MAX_PARENT_ITEMS) blockers.push("destination_capacity_exceeded");
  if (!sizeWithinLimit) blockers.push("result_size_limit_exceeded");
  if (forApply && blockers.length > 0) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "MOVE_APPLY_BLOCKED", reasonCodes: blockers }));
  }
  return { context: context, document: document, target: target, before: before, after: after,
    sourceInfo: sourceInfo, destinationInfo: destinationInfo, sourceOrderBefore: sourceOrder,
    destinationOrderBefore: destinationOrder, sourceIndex: sourceIndex,
    rollbackAnchor: moveAnchor(sourceOrder, sourceIndex), resultSizeWithinLimit: sizeWithinLimit, blockers: blockers };
}
function movePreflight(forApply) {
  var resolved = moveResolve(forApply);
  if (forApply) {
    if (!supportedPathSame(resolved.before, params.expectedBefore)) {
      throw mutationError("preflight_failed", "Target state does not match expected_before.");
    }
    if (!supportedPathSame(resolved.after, params.expectedAfter)) {
      throw mutationError("preflight_failed", "Target state does not match expected_after.");
    }
    if (!mutationSameSequence(resolved.sourceOrderBefore, params.expectedSourceOrder)) {
      throw mutationError("preflight_failed", "Source order does not match expected_source_order.");
    }
    if (!mutationSameSequence(resolved.destinationOrderBefore, params.expectedDestinationOrder)) {
      throw mutationError("preflight_failed", "Destination order does not match expected_destination_order.");
    }
  }
  return resolved;
}
function movePlan(preflight) {
  return { operation: "move_object_to_layer", documentKey: preflight.context.key,
    targetUuid: params.targetUuid, placement: params.placement, before: preflight.before, after: preflight.after,
    destinationLayer: { path: preflight.destinationInfo.path, name: preflight.destinationInfo.name,
      visible: preflight.destinationInfo.visible, locked: preflight.destinationInfo.locked,
      effectiveVisible: preflight.destinationInfo.effectiveVisible,
      effectiveLocked: preflight.destinationInfo.effectiveLocked },
    sourceOrderBefore: preflight.sourceOrderBefore, destinationOrderBefore: preflight.destinationOrderBefore,
    sourceIndex: preflight.sourceIndex, rollbackAnchor: preflight.rollbackAnchor,
    resultSizeWithinLimit: preflight.resultSizeWithinLimit, applyBlockedReasonCodes: preflight.blockers,
    confirmationStatus: params.apply === true ? "confirmed" : "required",
    applyAllowed: params.apply === true && preflight.blockers.length === 0 };
}
function moveRevalidate(preflight, plan) {
  var current;
  try { current = moveResolve(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Layer-move preconditions changed.")); }
  if (current.document !== preflight.document || current.target !== preflight.target ||
      current.sourceInfo.layer !== preflight.sourceInfo.layer ||
      current.destinationInfo.layer !== preflight.destinationInfo.layer ||
      !supportedPathSame(current.before, plan.before) || !supportedPathSame(current.after, plan.after) ||
      !mutationSameSequence(current.sourceOrderBefore, plan.sourceOrderBefore) ||
      !mutationSameSequence(current.destinationOrderBefore, plan.destinationOrderBefore)) {
    throw mutationBeforeSideEffectError("Layer-move target, layers, or complete orders changed before apply.");
  }
}
function moveApply(preflight, plan, state) {
  state.operationState.mutationStarted = true;
  preflight.target.move(preflight.destinationInfo.layer,
    params.placement === "front" ? ElementPlacement.PLACEATBEGINNING : ElementPlacement.PLACEATEND);
  return preflight.target;
}
function moveVerify(preflight, plan) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) {
    throw mutationError("verify_mismatch", "Active document changed during layer-move verification.");
  }
  var target = supportedPathFind(preflight.document, params.targetUuid);
  if (target === null || target !== preflight.target || target.parent !== preflight.destinationInfo.layer) {
    throw mutationError("verify_mismatch", "Moved target identity or destination parent does not match the plan.");
  }
  var after = supportedPathSnapshot(preflight.document, target, params.targetUuid, "Layer", movePaintScope(preflight.document));
  var sourceAfter = moveOrder(preflight.sourceInfo.layer, MOVE_MAX_PARENT_ITEMS - 1);
  var destinationAfter = moveOrder(preflight.destinationInfo.layer, MOVE_MAX_PARENT_ITEMS);
  if (!supportedPathSame(after, plan.after) ||
      !mutationSameSequence(sourceAfter, moveWithout(plan.sourceOrderBefore, params.targetUuid)) ||
      !mutationSameSequence(destinationAfter,
        moveDestinationAfter(plan.destinationOrderBefore, params.targetUuid, params.placement))) {
    throw mutationError("verify_mismatch", "Moved target or complete layer orders do not match the plan.");
  }
  return { target: after, sourceOrderAfter: sourceAfter, destinationOrderAfter: destinationAfter };
}
function moveRecordEvidence(state, target, sourceOrder, destinationOrder) {
  state.operationState.rollbackEvidence.restoredTarget = target;
  state.operationState.rollbackEvidence.restoredSourceOrder = sourceOrder;
  state.operationState.rollbackEvidence.restoredDestinationOrder = destinationOrder;
}
function moveRollback(state) {
  var preflight = state.preflight;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) {
    return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
  }
  var sourceInfo;
  var destinationInfo;
  var target;
  try {
    sourceInfo = moveLayerInfo(preflight.document, preflight.before.layerPath);
    destinationInfo = moveLayerInfo(preflight.document, params.destinationLayerPath);
    target = supportedPathFind(preflight.document, params.targetUuid);
  } catch (error) { return { status: "indeterminate", message: "Rollback layer or target lookup is indeterminate." }; }
  if (sourceInfo.layer !== preflight.sourceInfo.layer || destinationInfo.layer !== preflight.destinationInfo.layer ||
      target === null || target !== preflight.target || !sourceInfo.effectiveVisible || sourceInfo.effectiveLocked ||
      !destinationInfo.effectiveVisible || destinationInfo.effectiveLocked) {
    return { status: "indeterminate", message: "Rollback layer, target, or safety identity changed." };
  }
  var current;
  var sourceOrder;
  var destinationOrder;
  try {
    current = supportedPathSnapshot(preflight.document, target, params.targetUuid, "Layer", movePaintScope(preflight.document));
    sourceOrder = moveOrder(sourceInfo.layer, MOVE_MAX_PARENT_ITEMS);
    destinationOrder = moveOrder(destinationInfo.layer, MOVE_MAX_PARENT_ITEMS);
  } catch (error) { return { status: "indeterminate", message: "Rollback current state is indeterminate." }; }
  if (target.parent === sourceInfo.layer) {
    moveRecordEvidence(state, current, sourceOrder, destinationOrder);
    return supportedPathSame(current, preflight.before) &&
      mutationSameSequence(sourceOrder, preflight.sourceOrderBefore) &&
      mutationSameSequence(destinationOrder, preflight.destinationOrderBefore)
      ? { status: "verified" }
      : { status: "indeterminate", message: "Target is in source but exact before state is unproved." };
  }
  var expectedSource = moveWithout(preflight.sourceOrderBefore, params.targetUuid);
  var expectedDestination = moveDestinationAfter(preflight.destinationOrderBefore, params.targetUuid, params.placement);
  if (target.parent !== destinationInfo.layer || !supportedPathSame(current, preflight.after) ||
      !mutationSameSequence(sourceOrder, expectedSource) ||
      !mutationSameSequence(destinationOrder, expectedDestination)) {
    return { status: "indeterminate", message: "Rollback refused because the moved effect is not exact." };
  }
  var moveThrew = false;
  try {
    if (preflight.rollbackAnchor.kind === "before_next") {
      var next = supportedPathFind(preflight.document, preflight.rollbackAnchor.uuid);
      if (next === null || next.parent !== sourceInfo.layer) {
        return { status: "indeterminate", message: "Rollback next anchor identity changed." };
      }
      target.move(next, ElementPlacement.PLACEBEFORE);
    } else if (preflight.rollbackAnchor.kind === "after_previous") {
      var previous = supportedPathFind(preflight.document, preflight.rollbackAnchor.uuid);
      if (previous === null || previous.parent !== sourceInfo.layer) {
        return { status: "indeterminate", message: "Rollback previous anchor identity changed." };
      }
      target.move(previous, ElementPlacement.PLACEAFTER);
    } else {
      target.move(sourceInfo.layer, ElementPlacement.PLACEATBEGINNING);
    }
  } catch (error) { moveThrew = true; }
  try {
    var restoredTarget = supportedPathSnapshot(preflight.document, target, params.targetUuid, "Layer", movePaintScope(preflight.document));
    var restoredSource = moveOrder(sourceInfo.layer, MOVE_MAX_PARENT_ITEMS);
    var restoredDestination = moveOrder(destinationInfo.layer, MOVE_MAX_PARENT_ITEMS);
    moveRecordEvidence(state, restoredTarget, restoredSource, restoredDestination);
    if (target.parent === sourceInfo.layer && supportedPathSame(restoredTarget, preflight.before) &&
        mutationSameSequence(restoredSource, preflight.sourceOrderBefore) &&
        mutationSameSequence(restoredDestination, preflight.destinationOrderBefore)) return { status: "verified" };
    if (target.parent === destinationInfo.layer && supportedPathSame(restoredTarget, preflight.after) &&
        mutationSameSequence(restoredSource, expectedSource) &&
        mutationSameSequence(restoredDestination, expectedDestination)) {
      return { status: "failed", message: moveThrew
        ? "Rollback inverse move threw and the exact moved effect remains."
        : "Rollback inverse move did not restore the exact before state." };
    }
  } catch (error) { return { status: "indeterminate", message: "Rollback verification is indeterminate." }; }
  return { status: "indeterminate", message: "Rollback produced an unrecognized structural state." };
}

var moveExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionLayers: function (phase, preflight) { return [preflight.sourceInfo.layer, preflight.destinationInfo.layer]; },
  editSessionAffected: function () { return [params.targetUuid]; },
  initialOperationState: function () { return { mutationStarted: false,
    rollbackEvidence: { targetUuid: params.targetUuid, restoredTarget: null,
      restoredSourceOrder: null, restoredDestinationOrder: null } }; },
  preflight: movePreflight, plan: movePlan, revalidate: moveRevalidate, applyMutation: moveApply,
  verify: moveVerify, rollback: moveRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () { return { reasonCode: "move_state_unknown",
    message: "Layer-move apply outcome is indeterminate.",
    evidence: { targetUuid: params.targetUuid, restoredTarget: null,
      restoredSourceOrder: null, restoredDestinationOrder: null } }; },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});
var moveDocument = moveExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === moveExecution.preflight.document) moveDocument = getDocumentContext();
var result = { operation: "move_object_to_layer", applied: moveExecution.transaction.state === "verified",
  document: moveDocument, plan: moveExecution.plan, transaction: moveExecution.transaction };
if (moveExecution.transaction.state === "verified") result.postcondition = moveExecution.value;
`;
export const MOVE_OBJECT_TO_LAYER_HOST_SCRIPT_DIGEST = canonicalSha256(MOVE_OBJECT_TO_LAYER_SCRIPT);
export const MOVE_OBJECT_TO_LAYER_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: MOVE_OBJECT_TO_LAYER_OPERATION,
    validator: MOVE_OBJECT_TO_LAYER_VALIDATOR, canonicalContractVersion: CANONICAL_VERSION,
    resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: MOVE_OBJECT_TO_LAYER_SAFETY_IDENTITY, hostScriptDigest: MOVE_OBJECT_TO_LAYER_HOST_SCRIPT_DIGEST,
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    const digestRequest = 'commandId' in request ? (({ commandId: _commandId, ...rest }) => rest)(request) : request;
    const digest = canonicalSha256({ operation: MOVE_OBJECT_TO_LAYER_OPERATION,
        validator: MOVE_OBJECT_TO_LAYER_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request,
        commandId: 'commandId' in request ? request.commandId : null,
        documentKey: request.expectedDocumentKey, digest };
}
export const moveObjectToLayerToolContract = {
    name: 'illustrator_move_object_to_layer',
    title: 'Plan or Move Object to Layer',
    description: 'RGB paint and CMYK paint in CMYK documents are supported. Plan or move one supported layer-direct PathItem to the front or back of a different explicit layer. Apply verifies native UUID, complete source/destination orders, and exact visual state; recovery uses only captured native anchors.',
    inputSchema,
    publicInputSchema: moveObjectToLayerPublicInputSchema,
    outputSchema: moveObjectToLayerResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(MOVE_OBJECT_TO_LAYER_SAFETY.policy),
    normalizePublicInput,
};
export function createMoveObjectToLayerAdapter() {
    return {
        version: 1, operation: MOVE_OBJECT_TO_LAYER_OPERATION, validator: MOVE_OBJECT_TO_LAYER_VALIDATOR,
        safety: MOVE_OBJECT_TO_LAYER_SAFETY, safetyRegistrationIdentity: MOVE_OBJECT_TO_LAYER_SAFETY_IDENTITY,
        adapterIdentity: MOVE_OBJECT_TO_LAYER_ADAPTER_IDENTITY, tool: moveObjectToLayerToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest,
            safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: moveObjectToLayerResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: CLASSIFIER_VERSION, safetyConformanceVersion: CONFORMANCE_VERSION,
        errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: MOVE_OBJECT_TO_LAYER_HOST_SCRIPT_DIGEST,
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: MOVE_OBJECT_TO_LAYER_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: MOVE_OBJECT_TO_LAYER_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: MOVE_OBJECT_TO_LAYER_OPERATION,
                    documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: MOVE_OBJECT_TO_LAYER_ADAPTER_IDENTITY, script: MOVE_OBJECT_TO_LAYER_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = moveObjectToLayerResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back')
                return { state };
            if (state === 'planned')
                throw new Error('Layer-move plan is not a terminal mutation result.');
            throw new Error('Unverified layer-move recovery must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error, detail) {
            if (detail?.code === 'OBJECT_NOT_FOUND') {
                return new Error(`No PageItem with UUID ${JSON.stringify(detail.uuid ?? '')} exists in the bound document.`);
            }
            if (detail?.code === 'LAYER_PATH_INVALID')
                return new Error('Destination layer path is invalid.');
            if (detail?.code === 'LAYER_PATH_NOT_FOUND')
                return new Error('Destination layer path does not exist.');
            if (detail?.code === 'MOVE_SAME_LAYER')
                return new Error('Source and destination layers must be different.');
            if (detail?.code === 'MOVE_APPLY_BLOCKED') {
                return new Error(`Layer move is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}.`);
            }
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
