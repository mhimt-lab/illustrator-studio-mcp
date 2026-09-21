import { z } from 'zod';
import { canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { POINT_TEXT_APPLY_BLOCKERS, POINT_TEXT_BLOCKERS_SCRIPT, POINT_TEXT_PROFILE_NAME, pointTextApplyBlockers, POINT_TEXT_SNAPSHOT_SCRIPT, pointTextSingleLineSchema, pointTextSnapshotSchema, } from './point-text-host-script.js';
import { textLookupFailureError } from './text-lookup-error.js';
export const REPLACE_POINT_TEXT_BATCH_OPERATION = 'replace_point_text_batch';
export const REPLACE_POINT_TEXT_BATCH_VALIDATOR = { kind: REPLACE_POINT_TEXT_BATCH_OPERATION, version: 1 };
export const REPLACE_POINT_TEXT_BATCH_PROFILE = POINT_TEXT_PROFILE_NAME;
export const BATCH_MAX_TARGETS = 32;
export const BATCH_MIN_TARGETS = 2;
export const BATCH_MAX_TOTAL_CODE_UNITS = 4_000;
export const replacePointTextBatchSnapshotSchema = pointTextSnapshotSchema;
const CANONICAL_VERSION = 1;
const RESULT_SCHEMA_VERSION = 2;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 2;
const uuidSchema = z.string().min(1).max(255);
const documentKeySchema = z.string().min(1).max(16_384);
function sameCanonical(left, right) {
    return canonicalSha256(left) === canonicalSha256(right);
}
function deriveAfter(before, replacement) {
    return { ...before, contents: replacement };
}
function refineTargets(targets, uuidOf, context) {
    const uuids = targets.map((target) => uuidOf(target));
    if (new Set(uuids).size !== uuids.length) {
        context.addIssue({ code: 'custom', message: 'Batch target UUIDs must be unique.' });
    }
    const total = targets.reduce((sum, target) => sum + target.replacement.length, 0);
    if (total > BATCH_MAX_TOTAL_CODE_UNITS) {
        context.addIssue({ code: 'custom',
            message: `Batch replacement contents must total at most ${BATCH_MAX_TOTAL_CODE_UNITS} UTF-16 code units.` });
    }
}
const internalPlanTargetSchema = z.strictObject({ targetUuid: uuidSchema, replacement: pointTextSingleLineSchema });
const internalApplyTargetSchema = z.strictObject({
    targetUuid: uuidSchema,
    replacement: pointTextSingleLineSchema,
    expectedBefore: replacePointTextBatchSnapshotSchema,
    confirmedAfter: replacePointTextBatchSnapshotSchema,
});
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({
        expectedDocumentKey: documentKeySchema,
        targets: z.array(internalPlanTargetSchema).min(BATCH_MIN_TARGETS).max(BATCH_MAX_TARGETS)
            .superRefine((targets, context) => refineTargets(targets, (target) => target.targetUuid, context)),
        apply: z.literal(false),
    }),
    z.strictObject({
        expectedDocumentKey: documentKeySchema,
        targets: z.array(internalApplyTargetSchema).min(BATCH_MIN_TARGETS).max(BATCH_MAX_TARGETS)
            .superRefine((targets, context) => refineTargets(targets, (target) => target.targetUuid, context)),
        apply: z.literal(true),
        commandId: canonicalCommandIdSchema,
    }),
]);
const publicPlanTargetSchema = z.strictObject({ target_uuid: uuidSchema, replacement: pointTextSingleLineSchema });
const publicApplyTargetSchema = z.strictObject({
    target_uuid: uuidSchema,
    replacement: pointTextSingleLineSchema,
    expected_before: replacePointTextBatchSnapshotSchema,
    confirmed_after: replacePointTextBatchSnapshotSchema,
});
export const replacePointTextBatchPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({
        expected_document_key: documentKeySchema,
        targets: z.array(publicPlanTargetSchema).min(BATCH_MIN_TARGETS).max(BATCH_MAX_TARGETS)
            .superRefine((targets, context) => refineTargets(targets, (target) => target.target_uuid, context)),
        apply: z.literal(false).default(false),
    }),
    z.strictObject({
        expected_document_key: documentKeySchema,
        targets: z.array(publicApplyTargetSchema).min(BATCH_MIN_TARGETS).max(BATCH_MAX_TARGETS)
            .superRefine((targets, context) => refineTargets(targets, (target) => target.target_uuid, context)),
        apply: z.literal(true),
        command_id: canonicalCommandIdSchema,
    }),
]);
const inputSchema = z.strictObject({
    expected_document_key: documentKeySchema,
    targets: z.array(z.strictObject({
        target_uuid: uuidSchema,
        replacement: pointTextSingleLineSchema,
        expected_before: replacePointTextBatchSnapshotSchema.optional(),
        confirmed_after: replacePointTextBatchSnapshotSchema.optional(),
    })).min(BATCH_MIN_TARGETS).max(BATCH_MAX_TARGETS),
    apply: z.boolean().default(false),
    command_id: canonicalCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(replacePointTextBatchPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = replacePointTextBatchPublicInputSchema.parse(input);
    if (value.apply) {
        return {
            expectedDocumentKey: value.expected_document_key,
            targets: value.targets.map((target) => ({
                targetUuid: target.target_uuid,
                replacement: target.replacement,
                expectedBefore: target.expected_before,
                confirmedAfter: target.confirmed_after,
            })),
            apply: true,
            commandId: value.command_id,
        };
    }
    return {
        expectedDocumentKey: value.expected_document_key,
        targets: value.targets.map((target) => ({ targetUuid: target.target_uuid, replacement: target.replacement })),
        apply: false,
    };
}
const blockerSchema = z.enum(POINT_TEXT_APPLY_BLOCKERS);
function unionBlockers(perTarget) {
    const present = new Set();
    for (const blockers of perTarget)
        for (const blocker of blockers)
            present.add(blocker);
    return POINT_TEXT_APPLY_BLOCKERS.filter((blocker) => present.has(blocker));
}
const planTargetSchema = z.strictObject({
    targetUuid: uuidSchema,
    replacement: pointTextSingleLineSchema,
    before: replacePointTextBatchSnapshotSchema,
    after: replacePointTextBatchSnapshotSchema,
    applyBlockedReasonCodes: z.array(blockerSchema),
}).superRefine((target, context) => {
    if (target.targetUuid !== target.before.uuid ||
        !sameCanonical(target.after, deriveAfter(target.before, target.replacement))) {
        context.addIssue({ code: 'custom', message: 'Batch plan target must bind its UUID and derive only replacement contents.' });
    }
});
const planTargetsSchema = z.array(planTargetSchema).min(BATCH_MIN_TARGETS).max(BATCH_MAX_TARGETS);
const planSchema = z.strictObject({
    operation: z.literal(REPLACE_POINT_TEXT_BATCH_OPERATION),
    documentKey: documentKeySchema,
    targets: planTargetsSchema,
    applyBlockedReasonCodes: z.array(blockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    const uuids = plan.targets.map((target) => target.targetUuid);
    if (new Set(uuids).size !== uuids.length) {
        context.addIssue({ code: 'custom', message: 'Batch plan target UUIDs must be unique.' });
    }
    const beforeTotal = plan.targets.reduce((sum, target) => sum + target.before.contents.length, 0);
    const afterTotal = plan.targets.reduce((sum, target) => sum + target.replacement.length, 0);
    if (beforeTotal > BATCH_MAX_TOTAL_CODE_UNITS || afterTotal > BATCH_MAX_TOTAL_CODE_UNITS) {
        context.addIssue({ code: 'custom', message: 'Batch plan contents exceed the measured total budget.' });
    }
    if (!sameCanonical(plan.applyBlockedReasonCodes, unionBlockers(plan.targets.map((target) => target.applyBlockedReasonCodes)))) {
        context.addIssue({ code: 'custom', message: 'Batch blockers must be the ordered union of every target blocker.' });
    }
    const allowed = plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0;
    if (plan.applyAllowed !== allowed) {
        context.addIssue({ code: 'custom', message: 'Batch applyAllowed must require confirmation and no blockers.' });
    }
});
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']),
    reasonCode: z.enum(['apply_failed', 'verify_mismatch']),
    message: z.string().min(1).max(500),
}).superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed')) {
        context.addIssue({ code: 'custom', message: 'Batch failure phase and reason code must match.' });
    }
});
const indeterminateFailureSchema = z.strictObject({
    phase: z.literal('apply'),
    reasonCode: z.literal('apply_indeterminate'),
    message: z.string().min(1).max(500),
});
const rollbackTargetSchema = z.strictObject({
    targetUuid: uuidSchema,
    outcome: z.enum(['not_written', 'restored', 'outstanding', 'indeterminate']),
    restoredSnapshot: replacePointTextBatchSnapshotSchema.nullable(),
    observedSnapshot: replacePointTextBatchSnapshotSchema.nullable(),
});
const rollbackTargetsSchema = z.array(rollbackTargetSchema).min(BATCH_MIN_TARGETS).max(BATCH_MAX_TARGETS);
const rollbackEvidence = { targets: rollbackTargetsSchema };
const transactionSchema = z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('planned'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('verified'), audit: mutationAuditSchema }),
    z.strictObject({
        state: z.literal('apply_failed'), failure: failureSchema,
        rollback: z.strictObject({ status: z.literal('not_required') }), audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rolled_back'), failure: failureSchema,
        rollback: z.strictObject({ status: z.literal('verified'), ...rollbackEvidence }), audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rollback_failed'), failure: failureSchema,
        rollback: z.strictObject({ status: z.literal('failed'), reasonCode: z.literal('rollback_failed'),
            message: z.string().min(1).max(500), ...rollbackEvidence }), audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('apply_indeterminate'), failure: indeterminateFailureSchema,
        rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('text_state_unknown'),
            message: z.string().min(1).max(500), ...rollbackEvidence }), audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rollback_indeterminate'), failure: failureSchema,
        rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('rollback_indeterminate'),
            message: z.string().min(1).max(500), ...rollbackEvidence }), audit: mutationAuditSchema,
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
        context.addIssue({ code: 'custom', message: 'Batch audit sequence does not match transaction state.' });
    }
    transaction.audit.forEach((event, index) => {
        if (event.sequence !== index)
            context.addIssue({ code: 'custom', message: 'Batch audit sequence must be contiguous.' });
    });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' &&
            event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode &&
            event.message === transaction.failure.message);
        if (matches.length !== 1)
            context.addIssue({ code: 'custom', message: 'Batch failure must match one audit event.' });
    }
    if (transaction.state === 'rolled_back' &&
        transaction.rollback.targets.some((target) => target.outcome !== 'not_written' && target.outcome !== 'restored')) {
        context.addIssue({ code: 'custom', message: 'A rolled-back batch must prove every written target restored.' });
    }
    if (transaction.state === 'rollback_failed' &&
        (transaction.rollback.targets.some((target) => target.outcome === 'indeterminate') ||
            !transaction.rollback.targets.some((target) => target.outcome === 'outstanding'))) {
        context.addIssue({ code: 'custom', message: 'A failed batch rollback must name an outstanding target and prove the rest.' });
    }
    if ('rollback' in transaction && 'targets' in transaction.rollback) {
        for (const target of transaction.rollback.targets) {
            if ((target.outcome === 'restored') !== (target.restoredSnapshot !== null) ||
                (target.outcome === 'outstanding') !== (target.observedSnapshot !== null)) {
                context.addIssue({ code: 'custom', message: 'Batch rollback target snapshots must match their outcome.' });
            }
        }
    }
});
export const replacePointTextBatchResultSchema = z.union([
    z.strictObject({ operation: z.literal(REPLACE_POINT_TEXT_BATCH_OPERATION), applied: z.literal(false),
        document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ operation: z.literal(REPLACE_POINT_TEXT_BATCH_OPERATION), applied: z.literal(true),
        document: documentContextSchema, plan: planSchema,
        postcondition: z.array(replacePointTextBatchSnapshotSchema).min(BATCH_MIN_TARGETS).max(BATCH_MAX_TARGETS),
        transaction: transactionSchema }),
]).superRefine((result, context) => {
    if (result.transaction.state === 'planned') {
        const exact = result.plan.targets.every((target) => sameCanonical(target.applyBlockedReasonCodes, pointTextApplyBlockers(result.document.mutationAllowed, target.before)));
        if (result.plan.confirmationStatus !== 'required' || !exact) {
            context.addIssue({ code: 'custom', message: 'Planned batch must expose exact blockers for every target.' });
        }
    }
    else if (result.plan.confirmationStatus !== 'confirmed' ||
        result.plan.applyBlockedReasonCodes.length !== 0 || !result.plan.applyAllowed ||
        result.plan.targets.some((target) => target.applyBlockedReasonCodes.length !== 0)) {
        context.addIssue({ code: 'custom', message: 'Applied batch attempt must derive from an allowed confirmed plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified' ||
            !sameCanonical(result.postcondition, result.plan.targets.map((target) => target.after))) {
            context.addIssue({ code: 'custom', message: 'Verified batch must match every exact after snapshot in order.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified batch transaction must be applied.' });
    }
    if ('rollback' in result.transaction && 'targets' in result.transaction.rollback) {
        const rollbackTargets = result.transaction.rollback.targets;
        if (rollbackTargets.length !== result.plan.targets.length ||
            rollbackTargets.some((target, index) => target.targetUuid !== result.plan.targets[index].targetUuid)) {
            context.addIssue({ code: 'custom', message: 'Batch rollback evidence must cover every plan target in order.' });
        }
        else if (result.transaction.state === 'rolled_back' && rollbackTargets.some((target, index) => target.outcome === 'restored' && !sameCanonical(target.restoredSnapshot, result.plan.targets[index].before))) {
            context.addIssue({ code: 'custom', message: 'Rolled-back batch targets must prove exact before restoration.' });
        }
    }
});
export const replacePointTextBatchResponseSchema = z.strictObject({
    outcome: replacePointTextBatchResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
export const REPLACE_POINT_TEXT_BATCH_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: REPLACE_POINT_TEXT_BATCH_OPERATION,
    policy: {
        version: 1, class: 'update_existing', destructive: false,
        evidence: { identity: 'target_native_uuid_set', beforeState: 'before_state_hash',
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
export const REPLACE_POINT_TEXT_BATCH_SAFETY_IDENTITY = canonicalDigest(REPLACE_POINT_TEXT_BATCH_SAFETY);
function batchTargetEvidence(result) {
    const targetUuids = result.plan.targets.map((target) => target.targetUuid);
    return { targetUuids, targetSetHash: canonicalDigest(targetUuids) };
}
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    const beforeStateHash = canonicalDigest(result.plan.targets.map((target) => target.before));
    const afterStateHash = canonicalDigest(result.plan.targets.map((target) => target.after));
    const changeSetHash = canonicalDigest({
        targets: result.plan.targets.map((target) => ({ targetUuid: target.targetUuid, replacement: target.replacement,
            beforeStateHash: canonicalDigest(target.before), afterStateHash: canonicalDigest(target.after) })),
        beforeStateHash, afterStateHash,
    });
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'update_existing', operationId: REPLACE_POINT_TEXT_BATCH_OPERATION,
        canonicalRequestDigest: requestDigest,
        evidence: { documentKey: admissionDocumentKey, ...batchTargetEvidence(result),
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
        throw new Error('Indeterminate or failed batch recovery cannot be terminal.');
    }
    const common = { policyVersion: 1, operationClass: 'update_existing',
        operationId: REPLACE_POINT_TEXT_BATCH_OPERATION, canonicalRequestDigest: requestDigest,
        planDigest: plan.planDigest, attestation };
    const boundPlan = plan;
    const beforeStateHash = boundPlan.evidence.beforeStateHash;
    const targetEvidence = batchTargetEvidence(result);
    if (transaction.state === 'verified' && result.applied) {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { ...targetEvidence, beforeStateHash, afterStateHash: boundPlan.evidence.plannedAfterStateHash,
                restoredStateHash: null, restoredBeforeStateVerified: false },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'succeeded', terminal: true, recovery: 'not_required',
                proof: { kind: 'verified_postcondition' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    if (transaction.state === 'rolled_back') {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { ...targetEvidence, beforeStateHash, afterStateHash: null,
                restoredStateHash: beforeStateHash, restoredBeforeStateVerified: true },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'recovered', terminal: true, recovery: 'verified',
                proof: { kind: 'verified_recovery' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    return operationSafetyResultSchema.parse({ ...common,
        evidence: { ...targetEvidence, beforeStateHash, afterStateHash: null,
            restoredStateHash: null, restoredBeforeStateVerified: false },
        executionEvidence: { outcome: 'proven_pre_apply' },
        resolution: { status: 'failed', terminal: true, recovery: 'not_required',
            proof: { kind: 'proven_pre_apply', mutationAttempted: false },
            replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
}
async function assertSafety(value, requestDigest, attestation, resolver) {
    const result = replacePointTextBatchResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null)
        throw new Error('Batch terminal result requires attestation.');
    await assertOperationSafetyAdapterConformance({ registration: REPLACE_POINT_TEXT_BATCH_SAFETY, plan,
        result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
export const REPLACE_POINT_TEXT_BATCH_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${POINT_TEXT_SNAPSHOT_SCRIPT}
${POINT_TEXT_BLOCKERS_SCRIPT}
var BATCH_MIN_TARGETS = ${BATCH_MIN_TARGETS};
var BATCH_MAX_TARGETS = ${BATCH_MAX_TARGETS};
var BATCH_MAX_TOTAL_CODE_UNITS = ${BATCH_MAX_TOTAL_CODE_UNITS};

/** Re-raises a profile or CAS failure with the offending target named; other errors pass through. */
function batchTargetError(index, uuid, error) {
  if (error && typeof error.mutationPublicMessage === "string" && error.mutationPublicMessage.length > 0) {
    return mutationError(error.mutationReasonCode || "preflight_failed",
      "Target " + (index + 1) + " (" + uuid + "): " + error.mutationPublicMessage);
  }
  return error;
}

function batchAfter(before, replacement, index, uuid) {
  try { pointTextValidateContents(replacement, "replacement"); }
  catch (error) { throw batchTargetError(index, uuid, error); }
  var after = {};
  for (var key in before) if (before.hasOwnProperty(key)) after[key] = before[key];
  after.contents = replacement;
  return after;
}

var BATCH_BLOCKER_ORDER = ${JSON.stringify(POINT_TEXT_APPLY_BLOCKERS)};
function batchUnionBlockers(perTarget) {
  var present = {};
  for (var targetIndex = 0; targetIndex < perTarget.length; targetIndex++) {
    for (var blockerIndex = 0; blockerIndex < perTarget[targetIndex].length; blockerIndex++) {
      present[perTarget[targetIndex][blockerIndex]] = true;
    }
  }
  var union = [];
  for (var orderIndex = 0; orderIndex < BATCH_BLOCKER_ORDER.length; orderIndex++) {
    if (present[BATCH_BLOCKER_ORDER[orderIndex]]) union.push(BATCH_BLOCKER_ORDER[orderIndex]);
  }
  return union;
}

/**
 * Resolves the document exactly once and every target against it. Called from preflight and again
 * from revalidate — both before the first write, while the document key is still the saved one.
 */
function batchResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  var requested = params.targets;
  if (!requested || typeof requested.length !== "number" ||
      requested.length < BATCH_MIN_TARGETS || requested.length > BATCH_MAX_TARGETS) {
    throw mutationError("preflight_failed", "Batch requires " + BATCH_MIN_TARGETS + " to " + BATCH_MAX_TARGETS + " targets.");
  }
  var seen = {};
  var targets = [];
  var entries = [];
  var beforeTotal = 0;
  var afterTotal = 0;
  for (var index = 0; index < requested.length; index++) {
    var uuid = requested[index].targetUuid;
    if (typeof uuid !== "string" || uuid.length === 0 || seen[uuid]) {
      throw mutationError("preflight_failed", "Batch target UUIDs must be unique non-empty strings.");
    }
    seen[uuid] = true;
    var target = pointTextFind(document, uuid);
    if (target === null) throw new Error("MCP_ERROR:" + stringifyJson({ code: "OBJECT_NOT_FOUND", uuid: uuid }));
    var before;
    try { before = pointTextSnapshot(document, target, uuid); }
    catch (snapshotError) { throw batchTargetError(index, uuid, snapshotError); }
    var after = batchAfter(before, requested[index].replacement, index, uuid);
    beforeTotal += before.contents.length;
    afterTotal += after.contents.length;
    var blockers = pointTextBlockers(context, before);
    targets.push(target);
    entries.push({ targetUuid: uuid, replacement: requested[index].replacement, before: before, after: after,
      applyBlockedReasonCodes: blockers });
  }
  if (beforeTotal > BATCH_MAX_TOTAL_CODE_UNITS || afterTotal > BATCH_MAX_TOTAL_CODE_UNITS) {
    throw mutationError("preflight_failed", "Batch contents exceed " + BATCH_MAX_TOTAL_CODE_UNITS +
      " UTF-16 code units in total.");
  }
  var perTargetBlockers = [];
  for (var entryIndex = 0; entryIndex < entries.length; entryIndex++) {
    perTargetBlockers.push(entries[entryIndex].applyBlockedReasonCodes);
  }
  var union = batchUnionBlockers(perTargetBlockers);
  if (forApply && union.length > 0) {
    var blockedUuids = [];
    for (var blockedIndex = 0; blockedIndex < entries.length; blockedIndex++) {
      if (entries[blockedIndex].applyBlockedReasonCodes.length > 0) blockedUuids.push(entries[blockedIndex].targetUuid);
    }
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "POINT_TEXT_BATCH_APPLY_BLOCKED",
      reasonCodes: union, uuids: blockedUuids }));
  }
  return { context: context, document: document, targets: targets, entries: entries, blockers: union };
}

function batchPreflight(forApply) {
  var resolved = batchResolve(forApply);
  if (forApply) {
    for (var index = 0; index < resolved.entries.length; index++) {
      var entry = resolved.entries[index];
      var requested = params.targets[index];
      if (!pointTextSame(entry.before, requested.expectedBefore)) {
        throw mutationError("preflight_failed", "Target " + (index + 1) + " (" + entry.targetUuid +
          "): state does not match expected_before.");
      }
      if (!pointTextSame(entry.after, requested.confirmedAfter)) {
        throw mutationError("preflight_failed", "Target " + (index + 1) + " (" + entry.targetUuid +
          "): confirmed_after does not match the derived replacement state.");
      }
    }
  }
  return resolved;
}

function batchPlan(preflight) {
  return {
    operation: "replace_point_text_batch", documentKey: preflight.context.key, targets: preflight.entries,
    applyBlockedReasonCodes: preflight.blockers,
    confirmationStatus: params.apply === true ? "confirmed" : "required",
    applyAllowed: params.apply === true && preflight.blockers.length === 0
  };
}

function batchRevalidate(preflight, plan) {
  var current;
  try { current = batchResolve(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error,
    "Batch preconditions changed before apply.")); }
  if (current.document !== preflight.document || current.targets.length !== preflight.targets.length) {
    throw mutationBeforeSideEffectError("Batch document or target count changed before apply.");
  }
  for (var index = 0; index < current.targets.length; index++) {
    if (current.targets[index] !== preflight.targets[index] ||
        !pointTextSame(current.entries[index].before, plan.targets[index].before) ||
        !pointTextSame(current.entries[index].after, plan.targets[index].after)) {
      throw mutationBeforeSideEffectError("Target " + (index + 1) + " (" + plan.targets[index].targetUuid +
        "): target or contents changed before apply.");
    }
  }
}

function batchApply(preflight, plan, state) {
  state.operationState.mutationStarted = true;
  for (var index = 0; index < preflight.targets.length; index++) {
    // Recorded before the write so a throw mid-write still counts this target as touched.
    state.operationState.writtenCount = index + 1;
    preflight.targets[index].contents = plan.targets[index].after.contents;
  }
  return preflight.targets;
}

function batchVerify(preflight, plan) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) {
    throw mutationError("verify_mismatch", "Active document changed during batch verification.");
  }
  var actual = [];
  for (var index = 0; index < preflight.targets.length; index++) {
    var uuid = plan.targets[index].targetUuid;
    var target = pointTextFind(preflight.document, uuid);
    if (target === null || target !== preflight.targets[index]) {
      throw mutationError("verify_mismatch", "Target " + (index + 1) + " (" + uuid +
        "): native UUID no longer resolves to the same TextFrame.");
    }
    var snapshot;
    try { snapshot = pointTextSnapshot(preflight.document, target, uuid); }
    catch (snapshotError) { throw batchTargetError(index, uuid, snapshotError); }
    if (!pointTextSame(snapshot, plan.targets[index].after)) {
      throw mutationError("verify_mismatch", "Target " + (index + 1) + " (" + uuid +
        "): postcondition does not match the plan.");
    }
    actual.push(snapshot);
  }
  return actual;
}

/** Restores one written target only from its exact planned after state; proves its exact before state. */
function batchRollbackTarget(preflight, index) {
  var entry = preflight.entries[index];
  var target;
  var current;
  try {
    target = pointTextFind(preflight.document, entry.targetUuid);
    if (target === null || target !== preflight.targets[index]) {
      return { outcome: "indeterminate", snapshot: null, message: "target identity is indeterminate" };
    }
    current = pointTextSnapshot(preflight.document, target, entry.targetUuid);
  } catch (error) { return { outcome: "indeterminate", snapshot: null, message: "target state is indeterminate" }; }
  if (pointTextSame(current, entry.before)) return { outcome: "restored", snapshot: current, message: null };
  if (!pointTextSame(current, entry.after)) {
    return { outcome: "indeterminate", snapshot: null, message: "state is neither before nor planned after" };
  }
  try { target.contents = entry.before.contents; }
  catch (error) { return { outcome: "indeterminate", snapshot: null, message: "restore write is indeterminate" }; }
  var restored;
  try { restored = pointTextSnapshot(preflight.document, target, entry.targetUuid); }
  catch (error) { return { outcome: "indeterminate", snapshot: null, message: "restore verification is indeterminate" }; }
  if (pointTextSame(restored, entry.before)) return { outcome: "restored", snapshot: restored, message: null };
  return { outcome: "outstanding", snapshot: null, observed: restored,
    message: "restore did not produce the exact before state" };
}

/** Walks the written targets in reverse request order. Unwritten targets are left untouched. */
function batchRollback(state) {
  var preflight = state.preflight;
  var evidence = state.operationState.rollbackEvidence.targets;
  var writtenCount = state.operationState.writtenCount;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) {
    // Every target that was reached by apply is unproven, and must not read as untouched.
    for (var unprovenIndex = 0; unprovenIndex < writtenCount; unprovenIndex++) {
      evidence[unprovenIndex].outcome = "indeterminate";
      evidence[unprovenIndex].restoredSnapshot = null;
      evidence[unprovenIndex].observedSnapshot = null;
    }
    return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
  }
  var firstIndeterminate = null;
  var firstOutstanding = null;
  for (var index = writtenCount - 1; index >= 0; index--) {
    var outcome = batchRollbackTarget(preflight, index);
    evidence[index].outcome = outcome.outcome;
    evidence[index].restoredSnapshot = outcome.snapshot;
    evidence[index].observedSnapshot = outcome.observed || null;
    var label = "Target " + (index + 1) + " (" + preflight.entries[index].targetUuid + "): " + outcome.message;
    if (outcome.outcome === "indeterminate" && firstIndeterminate === null) firstIndeterminate = label;
    if (outcome.outcome === "outstanding" && firstOutstanding === null) firstOutstanding = label;
  }
  if (firstIndeterminate !== null) return { status: "indeterminate", message: "Rollback is indeterminate. " + firstIndeterminate + "." };
  if (firstOutstanding !== null) return { status: "failed", message: "Rollback did not restore every written target. " + firstOutstanding + "." };
  return { status: "verified" };
}

function batchInitialRollbackEvidence() {
  var targets = [];
  for (var index = 0; index < params.targets.length; index++) {
    targets.push({ targetUuid: params.targets[index].targetUuid, outcome: "not_written",
      restoredSnapshot: null, observedSnapshot: null });
  }
  return { targets: targets };
}

var batchExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionAffected: function () { var uuids = []; for (var i = 0; i < params.targets.length; i++) uuids.push(params.targets[i].targetUuid); return uuids; },
  initialOperationState: function () { return { mutationStarted: false, writtenCount: 0,
    rollbackEvidence: batchInitialRollbackEvidence() }; },
  preflight: batchPreflight,
  plan: batchPlan,
  revalidate: batchRevalidate,
  applyMutation: batchApply,
  verify: batchVerify,
  rollback: batchRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function (state) {
    var targets = state.operationState.rollbackEvidence.targets;
    for (var index = 0; index < targets.length; index++) {
      targets[index].outcome = "indeterminate";
      targets[index].restoredSnapshot = null;
      targets[index].observedSnapshot = null;
    }
    return { reasonCode: "text_state_unknown", message: "Batch apply outcome is indeterminate.",
      evidence: { targets: targets } };
  },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var batchDocument = batchExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === batchExecution.preflight.document) {
  batchDocument = getDocumentContext();
}
var result = { operation: "replace_point_text_batch", applied: batchExecution.transaction.state === "verified",
  document: batchDocument, plan: batchExecution.plan, transaction: batchExecution.transaction };
if (batchExecution.transaction.state === "verified") result.postcondition = batchExecution.value;
`;
export const REPLACE_POINT_TEXT_BATCH_HOST_SCRIPT_DIGEST = canonicalSha256(REPLACE_POINT_TEXT_BATCH_SCRIPT);
export const REPLACE_POINT_TEXT_BATCH_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: REPLACE_POINT_TEXT_BATCH_OPERATION,
    validator: REPLACE_POINT_TEXT_BATCH_VALIDATOR, canonicalContractVersion: CANONICAL_VERSION,
    resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: REPLACE_POINT_TEXT_BATCH_SAFETY_IDENTITY, hostScriptDigest: REPLACE_POINT_TEXT_BATCH_HOST_SCRIPT_DIGEST,
    mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    const digestRequest = 'commandId' in request
        ? (({ commandId: _commandId, ...rest }) => rest)(request)
        : request;
    const digest = canonicalSha256({ operation: REPLACE_POINT_TEXT_BATCH_OPERATION,
        validator: REPLACE_POINT_TEXT_BATCH_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request,
        commandId: 'commandId' in request ? request.commandId : null,
        documentKey: request.expectedDocumentKey, digest };
}
export const replacePointTextBatchToolContract = {
    name: 'illustrator_replace_point_text_batch',
    title: 'Plan or Replace Point Text in Batch',
    description: `Plan or replace the contents of ${BATCH_MIN_TARGETS} to ${BATCH_MAX_TARGETS} distinct non-empty single-line layer-direct POINTTEXT frames in one document as one command, bound by explicit document key and native UUIDs (contents total at most ${BATCH_MAX_TOTAL_CODE_UNITS} UTF-16 code units before and after). Planning evaluates every target and writes nothing; any unsupported, stale, or blocked target rejects the whole batch before a single write. Apply performs exact per-target compare-and-set in one host call, native read-back verification of every target, and verified inverse rollback of written targets in reverse order.`,
    inputSchema,
    publicInputSchema: replacePointTextBatchPublicInputSchema,
    outputSchema: replacePointTextBatchResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(REPLACE_POINT_TEXT_BATCH_SAFETY.policy),
    normalizePublicInput,
};
export function createReplacePointTextBatchAdapter() {
    return {
        version: 1, operation: REPLACE_POINT_TEXT_BATCH_OPERATION, validator: REPLACE_POINT_TEXT_BATCH_VALIDATOR,
        safety: REPLACE_POINT_TEXT_BATCH_SAFETY, safetyRegistrationIdentity: REPLACE_POINT_TEXT_BATCH_SAFETY_IDENTITY,
        adapterIdentity: REPLACE_POINT_TEXT_BATCH_ADAPTER_IDENTITY, tool: replacePointTextBatchToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest,
            safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: replacePointTextBatchResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: CLASSIFIER_VERSION, safetyConformanceVersion: CONFORMANCE_VERSION,
        errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: REPLACE_POINT_TEXT_BATCH_HOST_SCRIPT_DIGEST,
        mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: REPLACE_POINT_TEXT_BATCH_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: REPLACE_POINT_TEXT_BATCH_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: REPLACE_POINT_TEXT_BATCH_OPERATION,
                    documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: REPLACE_POINT_TEXT_BATCH_ADAPTER_IDENTITY,
                mutationHostApplicationMode: 'foreground', script: REPLACE_POINT_TEXT_BATCH_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = replacePointTextBatchResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back')
                return { state };
            if (state === 'planned')
                throw new Error('Batch plan is not a terminal mutation result.');
            throw new Error('Unverified batch recovery must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error, detail) {
            const lookupFailure = textLookupFailureError(error, detail);
            if (lookupFailure !== null)
                return lookupFailure;
            if (detail?.code === 'OBJECT_NOT_FOUND') {
                return new Error(`No PageItem with UUID ${JSON.stringify(detail.uuid ?? '')} exists in the bound document.`);
            }
            if (detail?.code === 'POINT_TEXT_BATCH_APPLY_BLOCKED') {
                const uuids = detail.uuids ?? [];
                return new Error(`Batch point-text replacement is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}` +
                    `${uuids.length > 0 ? ` (targets ${uuids.map((uuid) => JSON.stringify(uuid)).join(', ')})` : ''}.`);
            }
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
