import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { boundsSchema, documentContextSchema, layerPathSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { duplicateObjectSnapshotSchema } from './duplicate-object-adapter.js';
import { SUPPORTED_PATH_ITEM_HOST_SCRIPT, SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS, } from './supported-path-item-host-script.js';
export const GROUP_OBJECTS_OPERATION = 'group_objects';
export const GROUP_OBJECTS_VALIDATOR = { kind: GROUP_OBJECTS_OPERATION, version: 1 };
export const GROUP_OBJECTS_MAX_TARGETS = 32;
const GROUP_CANONICAL_VERSION = 1;
const GROUP_RESULT_SCHEMA_VERSION = 2;
const GROUP_CLASSIFIER_VERSION = 1;
const GROUP_CONFORMANCE_VERSION = 1;
const GROUP_ERROR_MAPPING_VERSION = 1;
const targetUuidsSchema = z.array(z.string().min(1).max(255)).min(2).max(GROUP_OBJECTS_MAX_TARGETS)
    .superRefine((uuids, context) => {
    if (new Set(uuids).size !== uuids.length) {
        context.addIssue({ code: 'custom', message: 'Group target UUIDs must be unique.' });
    }
});
const parentOrderSchema = z.array(z.string().min(1).max(255)).min(2).max(SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS)
    .superRefine((uuids, context) => {
    if (new Set(uuids).size !== uuids.length) {
        context.addIssue({ code: 'custom', message: 'Group parent order must contain unique native UUIDs.' });
    }
});
const parentOrderAfterSchema = z.array(z.string().min(1).max(255)).min(1).max(SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS)
    .superRefine((uuids, context) => {
    if (new Set(uuids).size !== uuids.length) {
        context.addIssue({ code: 'custom', message: 'Group parent order must contain unique native UUIDs.' });
    }
});
const targetSnapshotsSchema = z.array(duplicateObjectSnapshotSchema).min(2).max(GROUP_OBJECTS_MAX_TARGETS);
const groupSnapshotSchema = z.strictObject({
    uuid: z.string().min(1).max(255),
    type: z.literal('GroupItem'),
    name: z.string().max(255),
    layerPath: layerPathSchema,
    childOrder: targetUuidsSchema,
    geometricBounds: boundsSchema,
    controlBounds: boundsSchema,
    visibleBounds: boundsSchema,
    position: z.tuple([z.number().finite(), z.number().finite()]),
    width: z.number().finite().nonnegative(),
    height: z.number().finite().nonnegative(),
    locked: z.literal(false),
    hidden: z.literal(false),
    editable: z.literal(true),
});
function sameCanonical(left, right) {
    return canonicalSha256(left) === canonicalSha256(right);
}
function expectedGroupedOrder(before, targets, groupUuid) {
    const first = before.indexOf(targets[0]);
    if (first < 0 || targets.some((uuid, index) => before[first + index] !== uuid)) {
        throw new Error('Group targets must be one contiguous run in the complete parent order.');
    }
    return [...before.slice(0, first), groupUuid, ...before.slice(first + targets.length)];
}
const commonInternal = {
    expectedDocumentKey: z.string().min(1).max(16_384),
    targetUuids: targetUuidsSchema,
    groupName: z.string().max(255),
};
const groupInternalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({
        ...commonInternal,
        expectedTargetsBefore: targetSnapshotsSchema,
        expectedParentOrder: parentOrderSchema,
        apply: z.literal(true),
        commandId: canonicalCommandIdSchema,
    }),
]);
const commonPublic = {
    expected_document_key: z.string().min(1).max(16_384),
    target_uuids: targetUuidsSchema,
    group_name: z.string().max(255),
};
export const groupObjectsPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({
        ...commonPublic,
        expected_targets_before: targetSnapshotsSchema,
        expected_parent_order: parentOrderSchema,
        apply: z.literal(true),
        command_id: applyCommandIdSchema,
    }),
]);
const groupObjectsInputSchema = z.strictObject({
    ...commonPublic,
    expected_targets_before: targetSnapshotsSchema.optional(),
    expected_parent_order: parentOrderSchema.optional(),
    apply: z.boolean().default(false),
    command_id: applyCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(groupObjectsPublicInputSchema, { io: 'input' });
groupObjectsInputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = groupObjectsPublicInputSchema.parse(input);
    const common = {
        expectedDocumentKey: value.expected_document_key,
        targetUuids: value.target_uuids,
        groupName: value.group_name,
    };
    return value.apply ? {
        ...common,
        expectedTargetsBefore: value.expected_targets_before,
        expectedParentOrder: value.expected_parent_order,
        apply: true,
        commandId: value.command_id,
    } : { ...common, apply: false };
}
const blockerSchema = z.enum([
    'document_mutation_not_allowed', 'target_locked', 'target_hidden', 'target_not_editable',
    'layer_hidden', 'ancestor_hidden', 'layer_locked', 'ancestor_locked', 'result_size_limit_exceeded',
]);
const groupPlanSchema = z.strictObject({
    operation: z.literal(GROUP_OBJECTS_OPERATION),
    documentKey: z.string().min(1).max(16_384),
    targetUuids: targetUuidsSchema,
    groupName: z.string().max(255),
    targetsBefore: targetSnapshotsSchema,
    parentOrderBefore: parentOrderSchema,
    firstTargetIndex: z.number().int().nonnegative().max(SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS - 1),
    resultSizeWithinLimit: z.boolean(),
    applyBlockedReasonCodes: z.array(blockerSchema),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    if (plan.targetsBefore.length !== plan.targetUuids.length ||
        plan.targetsBefore.some((snapshot, index) => snapshot.uuid !== plan.targetUuids[index]) ||
        plan.targetUuids.some((uuid, index) => plan.parentOrderBefore[plan.firstTargetIndex + index] !== uuid)) {
        context.addIssue({ code: 'custom', message: 'Group plan must bind one contiguous ordered target run.' });
    }
    const layer = plan.targetsBefore[0]?.layerPath;
    if (!layer || plan.targetsBefore.some((snapshot) => !sameCanonical(snapshot.layerPath, layer))) {
        context.addIssue({ code: 'custom', message: 'Group targets must share one exact layer path.' });
    }
    if (plan.applyAllowed !== (plan.applyBlockedReasonCodes.length === 0)) {
        context.addIssue({ code: 'custom', message: 'Group applyAllowed must exactly reflect blockers.' });
    }
    if (plan.resultSizeWithinLimit === plan.applyBlockedReasonCodes.includes('result_size_limit_exceeded')) {
        context.addIssue({ code: 'custom', message: 'Group result-size admission must match its blocker.' });
    }
});
const applyFailureSchema = z.strictObject({
    phase: z.literal('apply'), reasonCode: z.literal('apply_failed'), message: z.string().min(1).max(500),
});
const verifyFailureSchema = z.strictObject({
    phase: z.literal('verify'), reasonCode: z.literal('verify_mismatch'), message: z.string().min(1).max(500),
});
const indeterminateFailureSchema = z.strictObject({
    phase: z.literal('apply'), reasonCode: z.literal('apply_indeterminate'), message: z.string().min(1).max(500),
});
const restoredEvidence = {
    groupUuid: z.string().min(1).max(255),
    restoredTargets: targetSnapshotsSchema,
    restoredParentOrder: parentOrderSchema,
};
const groupTransactionSchema = z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('planned'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('verified'), audit: mutationAuditSchema }),
    z.strictObject({
        state: z.literal('apply_failed'), failure: applyFailureSchema,
        rollback: z.strictObject({ status: z.literal('not_required') }), audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rolled_back'), failure: z.discriminatedUnion('phase', [applyFailureSchema, verifyFailureSchema]),
        rollback: z.strictObject({ status: z.literal('verified'), ...restoredEvidence }), audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rollback_failed'), failure: z.discriminatedUnion('phase', [applyFailureSchema, verifyFailureSchema]),
        rollback: z.strictObject({
            status: z.literal('failed'), reasonCode: z.literal('rollback_failed'), message: z.string().min(1).max(500),
            groupUuid: z.string().min(1).max(255), restoredTargets: targetSnapshotsSchema.nullable(),
            restoredParentOrder: parentOrderSchema.nullable(),
        }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('apply_indeterminate'), failure: indeterminateFailureSchema,
        rollback: z.strictObject({
            status: z.literal('indeterminate'), reasonCode: z.literal('identity_unavailable'),
            message: z.string().min(1).max(500), groupUuid: z.null(), restoredTargets: z.null(), restoredParentOrder: z.null(),
        }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rollback_indeterminate'), failure: z.discriminatedUnion('phase', [applyFailureSchema, verifyFailureSchema]),
        rollback: z.strictObject({
            status: z.literal('indeterminate'), reasonCode: z.literal('rollback_indeterminate'),
            message: z.string().min(1).max(500), groupUuid: z.string().min(1).max(255).nullable(),
            restoredTargets: targetSnapshotsSchema.nullable(), restoredParentOrder: parentOrderSchema.nullable(),
        }),
        audit: mutationAuditSchema,
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
        context.addIssue({ code: 'custom', message: 'Group audit sequence does not match transaction state.' });
    }
    transaction.audit.forEach((event, index) => {
        if (event.sequence !== index)
            context.addIssue({ code: 'custom', message: 'Group audit sequence must be contiguous.' });
    });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' && event.phase === transaction.failure.phase &&
            event.reasonCode === transaction.failure.reasonCode && event.message === transaction.failure.message);
        if (matches.length !== 1)
            context.addIssue({ code: 'custom', message: 'Group failure summary must match one audit event.' });
    }
    if (transaction.state === 'rollback_failed' || transaction.state === 'rollback_indeterminate') {
        const matches = transaction.audit.filter((event) => event.event === 'failed' && event.phase === 'rollback' &&
            event.reasonCode === transaction.rollback.reasonCode && event.message === transaction.rollback.message);
        if (matches.length !== 1)
            context.addIssue({ code: 'custom', message: 'Group rollback summary must match one audit event.' });
    }
    if (transaction.state === 'apply_indeterminate' && transaction.rollback.message !== transaction.failure.message) {
        context.addIssue({ code: 'custom', message: 'Group indeterminate summaries must match.' });
    }
});
const groupPostconditionSchema = z.strictObject({
    group: groupSnapshotSchema,
    targets: targetSnapshotsSchema,
    parentOrderAfter: parentOrderAfterSchema,
});
export const groupObjectsResultSchema = z.union([
    z.strictObject({
        operation: z.literal(GROUP_OBJECTS_OPERATION), applied: z.literal(false), document: documentContextSchema,
        plan: groupPlanSchema, transaction: groupTransactionSchema,
    }),
    z.strictObject({
        operation: z.literal(GROUP_OBJECTS_OPERATION), applied: z.literal(true), document: documentContextSchema,
        plan: groupPlanSchema, postcondition: groupPostconditionSchema, transaction: groupTransactionSchema,
    }),
]).superRefine((result, context) => {
    if (result.transaction.state !== 'planned' && !result.plan.applyAllowed) {
        context.addIssue({ code: 'custom', message: 'A group apply outcome requires an executable plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified') {
            context.addIssue({ code: 'custom', message: 'Applied group requires a verified transaction.' });
            return;
        }
        if (!sameCanonical(result.postcondition.targets, result.plan.targetsBefore) ||
            !sameCanonical(result.postcondition.group.childOrder, result.plan.targetUuids) ||
            result.postcondition.group.name !== result.plan.groupName ||
            result.plan.targetUuids.includes(result.postcondition.group.uuid) ||
            !sameCanonical(result.postcondition.group.layerPath, result.plan.targetsBefore[0].layerPath)) {
            context.addIssue({ code: 'custom', message: 'Verified group must preserve targets and bind its declared identity.' });
        }
        const expected = expectedGroupedOrder(result.plan.parentOrderBefore, result.plan.targetUuids, result.postcondition.group.uuid);
        if (!sameCanonical(expected, result.postcondition.parentOrderAfter)) {
            context.addIssue({ code: 'custom', message: 'Verified group must replace exactly the target run.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified group transaction must be applied.' });
    }
    if (result.transaction.state === 'rolled_back' &&
        (!sameCanonical(result.transaction.rollback.restoredTargets, result.plan.targetsBefore) ||
            !sameCanonical(result.transaction.rollback.restoredParentOrder, result.plan.parentOrderBefore))) {
        context.addIssue({ code: 'custom', message: 'Rolled-back group must prove exact target and order restoration.' });
    }
});
export const groupObjectsResponseSchema = z.strictObject({
    outcome: groupObjectsResultSchema,
    delivery: z.strictObject({
        mode: z.enum(['original', 'replay']),
        finalizedAt: z.string().datetime({ offset: true }),
    }),
});
export const GROUP_OBJECTS_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: GROUP_OBJECTS_OPERATION,
    policy: {
        version: 1,
        class: 'create',
        destructive: false,
        evidence: { identity: 'native_uuid', ownership: 'self_created_only', postcondition: 'created_state_matches_plan' },
        preconditions: { documentBinding: 'explicit_document_key', targetValidation: 'same_execution_before_apply' },
        confirmation: 'risk_scoped',
        recovery: { mode: 'remove_self_created_uuid', verification: 'native_uuid_absent', unknownIdentity: 'indeterminate' },
        terminal: { success: 'verified', failure: 'proven_pre_apply_or_verified_recovery', partialSuccess: 'nonterminal_until_reconciled' },
        replay: { requestBinding: 'canonical_request_digest', retry: 'return_attested_terminal_result', beforeTerminal: 'reconcile_required', reapplyOnRetry: false },
    },
    capabilities: {
        class: 'create', explicitDocumentBinding: true, validateTargetsBeforeApply: true,
        captureNativeUuid: true, verifyCreatedState: true, rollbackSelfCreatedUuidOnly: true,
        verifyRollbackAbsence: true, reconcileIndeterminate: true, durableTerminalReplay: true,
        trustedTerminalAttestationResolver: true,
    },
});
export const GROUP_OBJECTS_SAFETY_IDENTITY = canonicalDigest(GROUP_OBJECTS_SAFETY);
function groupSafetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    return bindOperationSafetyPlan({
        policyVersion: 1,
        operationClass: 'create',
        operationId: GROUP_OBJECTS_OPERATION,
        canonicalRequestDigest: requestDigest,
        evidence: {
            documentKey: admissionDocumentKey,
            targetLocator: `targets:${canonicalDigest(result.plan.targetUuids)};layer:${result.plan.targetsBefore[0].layerPath.join('.')};order:${canonicalDigest(result.plan.parentOrderBefore)}`,
        },
        preconditions: {
            status: result.plan.applyAllowed ? 'satisfied' : 'blocked',
            targetsValidated: result.plan.applyBlockedReasonCodes.length === 0,
        },
        confirmation: { kind: 'risk_scoped', status: 'not_required' },
        applyAllowed: result.plan.applyAllowed,
    });
}
function groupSafetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' ||
        transaction.state === 'rollback_indeterminate') {
        throw new Error('Indeterminate group results cannot be represented as terminal safety results.');
    }
    const common = {
        policyVersion: 1, operationClass: 'create', operationId: GROUP_OBJECTS_OPERATION,
        canonicalRequestDigest: requestDigest, planDigest: plan.planDigest, attestation,
    };
    if (transaction.state === 'verified' && result.applied) {
        return operationSafetyResultSchema.parse({
            ...common,
            evidence: { nativeUuid: result.postcondition.group.uuid, ownership: 'self_created_only',
                postconditionVerified: true, outstandingEffect: null },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'succeeded', terminal: true, recovery: 'not_required',
                proof: { kind: 'verified_postcondition' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } },
        });
    }
    if (transaction.state === 'rolled_back') {
        return operationSafetyResultSchema.parse({
            ...common,
            evidence: { nativeUuid: transaction.rollback.groupUuid, ownership: 'self_created_only',
                postconditionVerified: false, outstandingEffect: null },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'recovered', terminal: true, recovery: 'verified',
                proof: { kind: 'verified_recovery' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } },
        });
    }
    if (transaction.state === 'rollback_failed') {
        return operationSafetyResultSchema.parse({
            ...common,
            evidence: { nativeUuid: transaction.rollback.groupUuid, ownership: 'self_created_only',
                postconditionVerified: false,
                outstandingEffect: { kind: 'native_uuid_still_present', nativeUuid: transaction.rollback.groupUuid } },
            executionEvidence: { outcome: 'recovery_failed' },
            resolution: { status: 'recovery_failed', terminal: true, recovery: 'failed',
                outstandingEffect: 'known_effect_present', proof: { kind: 'verified_outstanding_effect' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } },
        });
    }
    return operationSafetyResultSchema.parse({
        ...common,
        evidence: { nativeUuid: null, ownership: 'self_created_only', postconditionVerified: false, outstandingEffect: null },
        executionEvidence: { outcome: 'proven_pre_apply' },
        resolution: { status: 'failed', terminal: true, recovery: 'not_required',
            proof: { kind: 'proven_pre_apply', mutationAttempted: false },
            replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } },
    });
}
async function assertGroupSafetyConformance(value, requestDigest, attestation, resolver) {
    const result = groupObjectsResultSchema.parse(value);
    const plan = groupSafetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null) {
        throw new Error('Group terminal result requires a durable attestation resolver.');
    }
    await assertOperationSafetyAdapterConformance({
        registration: GROUP_OBJECTS_SAFETY,
        plan,
        result: groupSafetyResult(result, requestDigest, attestation, plan),
    }, resolver);
}
export const GROUP_OBJECTS_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}${SUPPORTED_PATH_ITEM_HOST_SCRIPT}
var GROUP_OBJECTS_MAX_TARGETS = ${GROUP_OBJECTS_MAX_TARGETS};
var GROUP_TARGETS_MAX_BYTES = 65536;
var GROUP_ORDER_MAX_BYTES = 32768;
var GROUP_CONTEXT_MAX_BYTES = 24576;

function groupPaintScope(document) {
  return {
    cmykAdmitted: function () { return document.documentColorSpace === DocumentColorSpace.CMYK; },
    cmykRefusal: "supports CMYKColor only in a CMYK document."
  };
}
function groupPosition(values, wanted) {
  for (var index = 0; index < values.length; index++) if (values[index] === wanted) return index;
  return -1;
}

function groupSameSequence(left, right) {
  return mutationSameSequence(left, right);
}

function groupExpectedParentOrder(before, targetUuids, groupUuid) {
  var first = groupPosition(before, targetUuids[0]);
  if (first < 0) throw mutationError("preflight_failed", "First group target is absent from parent order.");
  var result = [];
  for (var index = 0; index < before.length; index++) {
    if (index === first) result.push(groupUuid);
    var isTarget = false;
    for (var targetIndex = 0; targetIndex < targetUuids.length; targetIndex++) {
      if (before[index] === targetUuids[targetIndex]) { isTarget = true; break; }
    }
    if (!isTarget) result.push(before[index]);
  }
  return result;
}

function groupSnapshot(document, group, expectedUuid, expectedName, layer) {
  if (!group || group.typename !== "GroupItem" || group.parent !== layer ||
      typeof group.uuid !== "string" || group.uuid !== expectedUuid || String(group.name) !== expectedName ||
      typeof group.locked !== "boolean" || typeof group.hidden !== "boolean" || typeof group.editable !== "boolean" ||
      group.locked || group.hidden || !group.editable) {
    throw mutationError("verify_mismatch", "Created group identity or safety state is invalid.");
  }
  var layerInfo = supportedPathLayerChain(document, layer);
  if (layerInfo === null) throw mutationError("verify_mismatch", "Created group layer identity is unavailable.");
  return {
    uuid: group.uuid, type: group.typename, name: String(group.name), layerPath: layerInfo.path,
    childOrder: supportedPathOrder(group),
    geometricBounds: supportedPathBounds(group.geometricBounds, "group.geometricBounds"),
    controlBounds: supportedPathBounds(group.controlBounds, "group.controlBounds"),
    visibleBounds: supportedPathBounds(group.visibleBounds, "group.visibleBounds"),
    position: supportedPathPoint(group.position, "group.position"),
    width: supportedPathNumber(group.width, "group.width"), height: supportedPathNumber(group.height, "group.height"),
    locked: group.locked, hidden: group.hidden, editable: group.editable
  };
}

function groupResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  if (!params.targetUuids || params.targetUuids.length < 2 || params.targetUuids.length > GROUP_OBJECTS_MAX_TARGETS) {
    throw mutationError("preflight_failed", "Group requires 2 to " + GROUP_OBJECTS_MAX_TARGETS + " target UUIDs.");
  }
  var seen = {};
  var targets = [];
  var snapshots = [];
  var parentLayer = null;
  for (var targetIndex = 0; targetIndex < params.targetUuids.length; targetIndex++) {
    var uuid = params.targetUuids[targetIndex];
    if (typeof uuid !== "string" || uuid.length === 0 || seen[uuid]) {
      throw mutationError("preflight_failed", "Group target UUIDs must be unique non-empty strings.");
    }
    seen[uuid] = true;
    var target = supportedPathFind(document, uuid);
    if (target === null) throw new Error("MCP_ERROR:" + stringifyJson({ code: "OBJECT_NOT_FOUND", uuid: uuid }));
    var snapshot = supportedPathSnapshot(document, target, uuid, "Layer", groupPaintScope(document));
    if (parentLayer === null) parentLayer = target.layer;
    if (target.parent !== parentLayer || target.layer !== parentLayer ||
        !mutationSameSequence(snapshot.layerPath, snapshots.length === 0 ? snapshot.layerPath : snapshots[0].layerPath)) {
      throw mutationError("preflight_failed", "All group targets must be direct children of one layer.");
    }
    targets.push(target);
    snapshots.push(snapshot);
  }
  var parentOrder = supportedPathOrder(parentLayer);
  var firstIndex = groupPosition(parentOrder, params.targetUuids[0]);
  if (firstIndex < 0) throw mutationError("preflight_failed", "First group target is absent from parent order.");
  for (var contiguousIndex = 0; contiguousIndex < params.targetUuids.length; contiguousIndex++) {
    if (parentOrder[firstIndex + contiguousIndex] !== params.targetUuids[contiguousIndex]) {
      throw new Error("MCP_ERROR:" + stringifyJson({ code: "GROUP_TARGETS_NOT_CONTIGUOUS" }));
    }
  }
  var sizeWithinLimit = supportedPathUtf8ByteLength(stringifyJson(snapshots)) <= GROUP_TARGETS_MAX_BYTES &&
    supportedPathUtf8ByteLength(stringifyJson(parentOrder)) <= GROUP_ORDER_MAX_BYTES &&
    supportedPathUtf8ByteLength(stringifyJson(context)) <= GROUP_CONTEXT_MAX_BYTES;
  var blockers = [];
  if (!context.mutationAllowed) blockers.push("document_mutation_not_allowed");
  for (var blockerIndex = 0; blockerIndex < snapshots.length; blockerIndex++) {
    var current = snapshots[blockerIndex];
    if (current.locked && groupPosition(blockers, "target_locked") < 0) blockers.push("target_locked");
    if (current.hidden && groupPosition(blockers, "target_hidden") < 0) blockers.push("target_hidden");
    if (!current.editable && groupPosition(blockers, "target_not_editable") < 0) blockers.push("target_not_editable");
    if (!current.layerVisible && groupPosition(blockers, "layer_hidden") < 0) blockers.push("layer_hidden");
    if (!current.effectiveLayerVisible && current.layerVisible && groupPosition(blockers, "ancestor_hidden") < 0) blockers.push("ancestor_hidden");
    if (current.layerLocked && groupPosition(blockers, "layer_locked") < 0) blockers.push("layer_locked");
    if (current.effectiveLayerLocked && !current.layerLocked && groupPosition(blockers, "ancestor_locked") < 0) blockers.push("ancestor_locked");
  }
  if (!sizeWithinLimit) blockers.push("result_size_limit_exceeded");
  if (forApply && blockers.length > 0) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "GROUP_APPLY_BLOCKED", reasonCodes: blockers }));
  }
  return { context: context, document: document, targets: targets, targetsBefore: snapshots,
    parentLayer: parentLayer, parentOrderBefore: parentOrder, firstTargetIndex: firstIndex,
    resultSizeWithinLimit: sizeWithinLimit, blockers: blockers };
}

function groupPreflight(forApply) {
  var resolved = groupResolve(forApply);
  if (forApply) {
    if (!supportedPathSame(resolved.targetsBefore, params.expectedTargetsBefore)) {
      throw mutationError("preflight_failed", "Target states do not match expected_targets_before.");
    }
    if (!groupSameSequence(resolved.parentOrderBefore, params.expectedParentOrder)) {
      throw mutationError("preflight_failed", "Parent order does not match expected_parent_order.");
    }
  }
  return resolved;
}

function groupPlan(preflight) {
  return {
    operation: "group_objects", documentKey: preflight.context.key, targetUuids: params.targetUuids,
    groupName: params.groupName, targetsBefore: preflight.targetsBefore,
    parentOrderBefore: preflight.parentOrderBefore, firstTargetIndex: preflight.firstTargetIndex,
    resultSizeWithinLimit: preflight.resultSizeWithinLimit,
    applyBlockedReasonCodes: preflight.blockers, applyAllowed: preflight.blockers.length === 0
  };
}

function groupRevalidate(preflight, plan) {
  var current;
  try { current = groupResolve(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Group preconditions changed before apply.")); }
  if (current.document !== preflight.document || current.parentLayer !== preflight.parentLayer ||
      current.targets.length !== preflight.targets.length || !supportedPathSame(current.targetsBefore, plan.targetsBefore) ||
      !groupSameSequence(current.parentOrderBefore, plan.parentOrderBefore)) {
    throw mutationBeforeSideEffectError("Group targets or complete parent order changed before apply.");
  }
  for (var index = 0; index < current.targets.length; index++) {
    if (current.targets[index] !== preflight.targets[index]) {
      throw mutationBeforeSideEffectError("Group target native identity changed before apply.");
    }
  }
}

function groupApply(preflight, plan, state) {
  state.operationState.mutationStarted = true;
  var group = preflight.parentLayer.groupItems.add();
  state.operationState.createdGroup = group;
  if (!group || typeof group.uuid !== "string" || group.uuid.length === 0 ||
      groupPosition(params.targetUuids, group.uuid) >= 0) {
    throw mutationError("apply_failed", "Illustrator did not return a distinct native UUID for the group.");
  }
  state.operationState.groupUuid = group.uuid;
  state.operationState.rollbackEvidence.groupUuid = group.uuid;
  group.name = params.groupName;
  group.move(preflight.targets[0], ElementPlacement.PLACEBEFORE);
  for (var index = 0; index < preflight.targets.length; index++) {
    preflight.targets[index].move(group, ElementPlacement.PLACEATEND);
  }
  return group;
}

function groupVerify(preflight, plan, state) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) {
    throw mutationError("verify_mismatch", "Active document changed during group verification.");
  }
  var group = supportedPathFind(preflight.document, state.operationState.groupUuid);
  if (group === null || group !== state.operationState.createdGroup || group.parent !== preflight.parentLayer) {
    throw mutationError("verify_mismatch", "Created group native identity does not match the plan.");
  }
  var groupAfter = groupSnapshot(preflight.document, group, state.operationState.groupUuid, params.groupName,
    preflight.parentLayer);
  var targetsAfter = [];
  for (var index = 0; index < preflight.targets.length; index++) {
    var target = supportedPathFind(preflight.document, params.targetUuids[index]);
    if (target === null || target !== preflight.targets[index] || target.parent !== group) {
      throw mutationError("verify_mismatch", "Grouped target native identity does not match the plan.");
    }
    targetsAfter.push(supportedPathSnapshot(preflight.document, target, params.targetUuids[index], "GroupItem", groupPaintScope(preflight.document)));
  }
  var parentOrderAfter = supportedPathOrder(preflight.parentLayer);
  var expectedOrder = groupExpectedParentOrder(plan.parentOrderBefore, params.targetUuids, state.operationState.groupUuid);
  if (!supportedPathSame(targetsAfter, plan.targetsBefore) ||
      !groupSameSequence(groupAfter.childOrder, params.targetUuids) ||
      !groupSameSequence(parentOrderAfter, expectedOrder)) {
    throw mutationError("verify_mismatch", "Group targets, child order, or complete parent order does not match the plan.");
  }
  return { group: groupAfter, targets: targetsAfter, parentOrderAfter: parentOrderAfter };
}

function groupReferenceState(reference, expectedUuid) {
  try {
    if (typeof reference.uuid !== "string" || reference.uuid !== expectedUuid) return "mismatch";
    return "present";
  } catch (error) {
    if (error && error.name === "ReferenceError" && error.number === 45) return "invalid";
    throw error;
  }
}

function groupVerifyRestored(state, groupUuid) {
  var preflight = state.preflight;
  var restoredTargets = [];
  for (var index = 0; index < preflight.targets.length; index++) {
    var target = supportedPathFind(preflight.document, params.targetUuids[index]);
    if (target === null || target !== preflight.targets[index] || target.parent !== preflight.parentLayer) {
      return { status: "indeterminate", message: "Restored target identity or parent is indeterminate." };
    }
    restoredTargets.push(supportedPathSnapshot(preflight.document, target, params.targetUuids[index], "Layer", groupPaintScope(preflight.document)));
  }
  var restoredOrder = supportedPathOrder(preflight.parentLayer);
  state.operationState.rollbackEvidence.groupUuid = groupUuid;
  state.operationState.rollbackEvidence.restoredTargets = restoredTargets;
  state.operationState.rollbackEvidence.restoredParentOrder = restoredOrder;
  if (!supportedPathSame(restoredTargets, preflight.targetsBefore) ||
      !groupSameSequence(restoredOrder, preflight.parentOrderBefore)) {
    return { status: "indeterminate", message: "Exact target or parent-order restoration is unproved." };
  }
  return { status: "verified" };
}

function groupRollback(state) {
  var preflight = state.preflight;
  var groupUuid = state.operationState.groupUuid;
  var groupReference = state.operationState.createdGroup;
  if (!preflight || typeof groupUuid !== "string" || !groupReference ||
      app.documents.length === 0 || app.activeDocument !== preflight.document) {
    return { status: "indeterminate", message: "Rollback group identity or document is indeterminate." };
  }
  var group;
  try { group = supportedPathFind(preflight.document, groupUuid); }
  catch (error) { return { status: "indeterminate", message: "Rollback group lookup is indeterminate." }; }
  if (group === null) {
    try {
      if (groupReferenceState(groupReference, groupUuid) !== "invalid") {
        return { status: "indeterminate", message: "Group UUID is absent but its captured reference remains valid." };
      }
      return groupVerifyRestored(state, groupUuid);
    } catch (error) { return { status: "indeterminate", message: "Absent-group restoration is indeterminate." }; }
  }
  if (group !== groupReference || group.parent !== preflight.parentLayer ||
      typeof group.locked !== "boolean" || typeof group.hidden !== "boolean" || typeof group.editable !== "boolean") {
    return { status: "indeterminate", message: "Rollback refused because group identity changed." };
  }
  if (group.locked || group.hidden || !group.editable || preflight.parentLayer.locked || !preflight.parentLayer.visible) {
    return { status: "failed", message: "Rollback refused because the captured group is not safely editable." };
  }
  var childOrder;
  try { childOrder = group.pageItems.length === 0 ? [] : supportedPathOrder(group); }
  catch (error) { return { status: "indeterminate", message: "Rollback group child order is indeterminate." }; }
  for (var childIndex = 0; childIndex < childOrder.length; childIndex++) {
    if (groupPosition(params.targetUuids, childOrder[childIndex]) < 0) {
      return { status: "indeterminate", message: "Rollback refused because the group contains an unexpected child." };
    }
  }
  var resolvedTargets = [];
  for (var index = 0; index < preflight.targets.length; index++) {
    var target;
    try { target = supportedPathFind(preflight.document, params.targetUuids[index]); }
    catch (error) { return { status: "indeterminate", message: "Rollback target lookup is indeterminate." }; }
    if (target === null || target !== preflight.targets[index] ||
        (target.parent !== group && target.parent !== preflight.parentLayer)) {
      return { status: "indeterminate", message: "Rollback target identity or parent changed." };
    }
    resolvedTargets.push(target);
  }
  if (childOrder.length > 0) {
    var actualParentOrder;
    try { actualParentOrder = supportedPathOrder(preflight.parentLayer); }
    catch (error) { return { status: "indeterminate", message: "Rollback parent order is indeterminate." }; }
    var expectedPartial = groupExpectedParentOrder(preflight.parentOrderBefore, childOrder, groupUuid);
    if (!groupSameSequence(actualParentOrder, expectedPartial)) {
      return { status: "indeterminate", message: "Rollback parent order does not match a captured partial group effect." };
    }
    try {
      for (var restoreIndex = 0; restoreIndex < resolvedTargets.length; restoreIndex++) {
        resolvedTargets[restoreIndex].move(group, ElementPlacement.PLACEBEFORE);
      }
    } catch (error) { return { status: "indeterminate", message: "Rollback target restoration write is indeterminate." }; }
  }
  if (group.pageItems.length !== 0) {
    return { status: "indeterminate", message: "Rollback captured group is not empty after target restoration." };
  }
  var removeThrew = false;
  try { group.remove(); }
  catch (error) { removeThrew = true; }
  var remaining;
  try { remaining = supportedPathFind(preflight.document, groupUuid); }
  catch (error) { return { status: "indeterminate", message: "Rollback group absence verification is indeterminate." }; }
  if (remaining !== null) {
    if (remaining === groupReference && remaining.uuid === groupUuid) {
      return { status: "failed", message: removeThrew
        ? "Rollback group removal threw before removing the captured group."
        : "Rollback group removal did not remove the captured group." };
    }
    return { status: "indeterminate", message: "Rollback group UUID resolved to an unexpected identity." };
  }
  try {
    if (groupReferenceState(groupReference, groupUuid) !== "invalid") {
      return { status: "indeterminate", message: "Group UUID is absent but its captured reference remains valid." };
    }
    return groupVerifyRestored(state, groupUuid);
  } catch (error) { return { status: "indeterminate", message: "Rollback restoration verification is indeterminate." }; }
}

var groupExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionLayers: function (phase, preflight) { return [preflight.parentLayer]; },
  editSessionAffected: function (phase, preflight, plan, state) { var uuids = params.targetUuids.slice(0); if (phase === "after") uuids.push(state.operationState.groupUuid); return uuids; },
  initialOperationState: function () {
    return { mutationStarted: false, createdGroup: null, groupUuid: null,
      rollbackEvidence: { groupUuid: null, restoredTargets: null, restoredParentOrder: null } };
  },
  preflight: groupPreflight,
  plan: groupPlan,
  revalidate: groupRevalidate,
  applyMutation: groupApply,
  verify: groupVerify,
  rollback: groupRollback,
  hasMutationEvidence: function (state) {
    return state.operationState.createdGroup !== null && state.operationState.createdGroup !== undefined;
  },
  applyIndeterminate: function (state) {
    return { reasonCode: "identity_unavailable",
      message: "Group apply outcome is indeterminate because created-group identity is unavailable.",
      evidence: state.operationState.rollbackEvidence };
  },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var groupDocument = groupExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === groupExecution.preflight.document) groupDocument = getDocumentContext();
var result = {
  operation: "group_objects", applied: groupExecution.transaction.state === "verified",
  document: groupDocument, plan: groupExecution.plan, transaction: groupExecution.transaction
};
if (groupExecution.transaction.state === "verified") result.postcondition = groupExecution.value;
`;
export const GROUP_OBJECTS_HOST_SCRIPT_DIGEST = canonicalSha256(GROUP_OBJECTS_SCRIPT);
export const GROUP_OBJECTS_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2,
    contractVersion: 1,
    operation: GROUP_OBJECTS_OPERATION,
    validator: GROUP_OBJECTS_VALIDATOR,
    canonicalContractVersion: GROUP_CANONICAL_VERSION,
    resultSchemaVersion: GROUP_RESULT_SCHEMA_VERSION,
    terminalClassifierVersion: GROUP_CLASSIFIER_VERSION,
    safetyConformanceVersion: GROUP_CONFORMANCE_VERSION,
    errorMappingVersion: GROUP_ERROR_MAPPING_VERSION,
    safetyIdentity: GROUP_OBJECTS_SAFETY_IDENTITY,
    hostScriptDigest: GROUP_OBJECTS_HOST_SCRIPT_DIGEST,
});
function normalizedRequest(input) {
    const request = groupInternalInputSchema.parse(input);
    const digestRequest = 'commandId' in request
        ? (({ commandId: _commandId, ...rest }) => rest)(request)
        : request;
    const digest = canonicalSha256({
        operation: GROUP_OBJECTS_OPERATION,
        validator: GROUP_OBJECTS_VALIDATOR,
        request: digestRequest,
    });
    return {
        intent: request.apply ? 'apply' : 'plan', request,
        commandId: 'commandId' in request ? request.commandId : null,
        documentKey: request.expectedDocumentKey, digest,
    };
}
export const groupObjectsToolContract = {
    name: 'illustrator_group_objects',
    title: 'Plan or Group Objects',
    description: 'RGB paint and CMYK paint in CMYK documents are supported. Plan or group one contiguous native-order run of supported layer-direct PathItems. Apply preserves target UUIDs and state, verifies exact parent/child order, and recovers by restoring only captured targets before removing only the captured group.',
    inputSchema: groupObjectsInputSchema,
    publicInputSchema: groupObjectsPublicInputSchema,
    outputSchema: groupObjectsResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(GROUP_OBJECTS_SAFETY.policy),
    normalizePublicInput,
};
export function createGroupObjectsAdapter() {
    return {
        version: 1,
        operation: GROUP_OBJECTS_OPERATION,
        validator: GROUP_OBJECTS_VALIDATOR,
        safety: GROUP_OBJECTS_SAFETY,
        safetyRegistrationIdentity: GROUP_OBJECTS_SAFETY_IDENTITY,
        adapterIdentity: GROUP_OBJECTS_ADAPTER_IDENTITY,
        tool: groupObjectsToolContract,
        canonical: { version: GROUP_CANONICAL_VERSION, normalize: normalizedRequest,
            safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: groupObjectsResultSchema,
        resultSchemaVersion: GROUP_RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: GROUP_CLASSIFIER_VERSION,
        safetyConformanceVersion: GROUP_CONFORMANCE_VERSION,
        errorMappingVersion: GROUP_ERROR_MAPPING_VERSION,
        hostScriptDigest: GROUP_OBJECTS_HOST_SCRIPT_DIGEST,
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: GROUP_OBJECTS_SCRIPT, params };
            return {
                kind: 'mutation', mutationValidator: GROUP_OBJECTS_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: GROUP_OBJECTS_OPERATION,
                    documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: GROUP_OBJECTS_ADAPTER_IDENTITY,
                script: GROUP_OBJECTS_SCRIPT,
                params,
            };
        },
        classifyTerminal(value) {
            const state = groupObjectsResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back' || state === 'rollback_failed') {
                return { state };
            }
            if (state === 'planned')
                throw new Error('Group plan is not a terminal mutation result.');
            throw new Error('Unverified group identity or recovery must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertGroupSafetyConformance,
        mapExecutionError(error, detail) {
            if (detail?.code === 'OBJECT_NOT_FOUND') {
                return new Error(`No PageItem with UUID ${JSON.stringify(detail.uuid ?? '')} exists in the bound document.`);
            }
            if (detail?.code === 'GROUP_TARGETS_NOT_CONTIGUOUS') {
                return new Error('Group targets must be contiguous and supplied in exact native parent order.');
            }
            if (detail?.code === 'GROUP_APPLY_BLOCKED') {
                return new Error(`Group apply is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}.`);
            }
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
