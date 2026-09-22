import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { PLAIN_POINT_TEXT_V1, POINT_TEXT_APPLY_BLOCKERS, POINT_TEXT_BLOCKERS_SCRIPT, pointTextApplyBlockers, POINT_TEXT_MAX_CODE_UNITS, POINT_TEXT_MAX_LAYER_DEPTH_LIMIT, POINT_TEXT_PROFILE_NAME, POINT_TEXT_SNAPSHOT_SCRIPT, pointTextSingleLineSchema, pointTextSnapshotSchema, } from './point-text-host-script.js';
import { textLookupFailureError } from './text-lookup-error.js';
export const REPLACE_POINT_TEXT_OPERATION = 'replace_point_text';
export const REPLACE_POINT_TEXT_VALIDATOR = { kind: REPLACE_POINT_TEXT_OPERATION, version: 1 };
export const REPLACE_POINT_TEXT_MAX_CODE_UNITS = POINT_TEXT_MAX_CODE_UNITS;
export const REPLACE_POINT_TEXT_PROFILE = POINT_TEXT_PROFILE_NAME;
export const REPLACE_POINT_TEXT_MAX_LAYER_DEPTH = POINT_TEXT_MAX_LAYER_DEPTH_LIMIT;
export const replacePointTextSnapshotSchema = pointTextSnapshotSchema;
export { PLAIN_POINT_TEXT_V1 };
const singleLineTextSchema = pointTextSingleLineSchema;
const CANONICAL_VERSION = 3;
const RESULT_SCHEMA_VERSION = 4;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 2;
const commonInternal = {
    expectedDocumentKey: z.string().min(1).max(16_384),
    targetUuid: z.string().min(1).max(255),
    replacement: singleLineTextSchema,
};
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({
        ...commonInternal,
        expectedBefore: replacePointTextSnapshotSchema,
        confirmedAfter: replacePointTextSnapshotSchema,
        apply: z.literal(true),
        commandId: canonicalCommandIdSchema,
    }),
]);
const commonPublic = {
    expected_document_key: z.string().min(1).max(16_384),
    target_uuid: z.string().min(1).max(255),
    replacement: singleLineTextSchema,
};
export const replacePointTextPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({
        ...commonPublic,
        expected_before: replacePointTextSnapshotSchema,
        confirmed_after: replacePointTextSnapshotSchema,
        apply: z.literal(true),
        command_id: applyCommandIdSchema,
    }),
]);
const inputSchema = z.strictObject({
    ...commonPublic,
    expected_before: replacePointTextSnapshotSchema.optional(),
    confirmed_after: replacePointTextSnapshotSchema.optional(),
    apply: z.boolean().default(false),
    command_id: applyCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(replacePointTextPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = replacePointTextPublicInputSchema.parse(input);
    const common = {
        expectedDocumentKey: value.expected_document_key,
        targetUuid: value.target_uuid,
        replacement: value.replacement,
    };
    return value.apply
        ? {
            ...common,
            expectedBefore: value.expected_before,
            confirmedAfter: value.confirmed_after,
            apply: true,
            commandId: value.command_id,
        }
        : { ...common, apply: false };
}
function sameCanonical(left, right) {
    return canonicalSha256(left) === canonicalSha256(right);
}
function deriveAfter(before, replacement) {
    return { ...before, contents: replacement };
}
const blockerSchema = z.enum(POINT_TEXT_APPLY_BLOCKERS);
export const replacePointTextPlanSchema = z.strictObject({
    operation: z.literal(REPLACE_POINT_TEXT_OPERATION),
    documentKey: z.string().min(1).max(16_384),
    targetUuid: z.string().min(1).max(255),
    replacement: singleLineTextSchema,
    before: replacePointTextSnapshotSchema,
    after: replacePointTextSnapshotSchema,
    applyBlockedReasonCodes: z.array(blockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    if (plan.targetUuid !== plan.before.uuid || !sameCanonical(plan.after, deriveAfter(plan.before, plan.replacement))) {
        context.addIssue({ code: 'custom', message: 'Point-text plan must bind the target and derive only replacement contents.' });
    }
    const allowed = plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0;
    if (plan.applyAllowed !== allowed) {
        context.addIssue({ code: 'custom', message: 'Point-text applyAllowed must require confirmation and no blockers.' });
    }
});
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']),
    reasonCode: z.enum(['apply_failed', 'verify_mismatch']),
    message: z.string().min(1).max(500),
}).superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed')) {
        context.addIssue({ code: 'custom', message: 'Point-text failure phase and reason code must match.' });
    }
});
const indeterminateFailureSchema = z.strictObject({
    phase: z.literal('apply'),
    reasonCode: z.literal('apply_indeterminate'),
    message: z.string().min(1).max(500),
});
const rollbackEvidence = {
    targetUuid: z.string().min(1).max(255),
    restoredSnapshot: replacePointTextSnapshotSchema.nullable(),
};
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
            message: z.string().min(1).max(500), targetUuid: z.string().min(1).max(255),
            restoredSnapshot: z.null() }), audit: mutationAuditSchema,
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
        context.addIssue({ code: 'custom', message: 'Point-text audit sequence does not match transaction state.' });
    }
    transaction.audit.forEach((event, index) => {
        if (event.sequence !== index)
            context.addIssue({ code: 'custom', message: 'Point-text audit sequence must be contiguous.' });
    });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' &&
            event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode &&
            event.message === transaction.failure.message);
        if (matches.length !== 1)
            context.addIssue({ code: 'custom', message: 'Point-text failure must match one audit event.' });
    }
});
export const replacePointTextResultSchema = z.union([
    z.strictObject({ operation: z.literal(REPLACE_POINT_TEXT_OPERATION), applied: z.literal(false),
        document: documentContextSchema, plan: replacePointTextPlanSchema, transaction: transactionSchema }),
    z.strictObject({ operation: z.literal(REPLACE_POINT_TEXT_OPERATION), applied: z.literal(true),
        document: documentContextSchema, plan: replacePointTextPlanSchema, postcondition: replacePointTextSnapshotSchema,
        transaction: transactionSchema }),
]).superRefine((result, context) => {
    if (result.transaction.state === 'planned') {
        const blockers = pointTextApplyBlockers(result.document.mutationAllowed, result.plan.before);
        if (result.plan.confirmationStatus !== 'required' ||
            !sameCanonical(result.plan.applyBlockedReasonCodes, blockers)) {
            context.addIssue({ code: 'custom', message: 'Planned point-text replacement must expose exact blockers.' });
        }
    }
    else if (result.plan.confirmationStatus !== 'confirmed' ||
        result.plan.applyBlockedReasonCodes.length !== 0 || !result.plan.applyAllowed) {
        context.addIssue({ code: 'custom', message: 'Applied point-text attempt must derive from an allowed confirmed plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified' || !sameCanonical(result.postcondition, result.plan.after)) {
            context.addIssue({ code: 'custom', message: 'Verified point-text replacement must match the exact after snapshot.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified point-text transaction must be applied.' });
    }
    if (result.transaction.state === 'rolled_back' &&
        !sameCanonical(result.transaction.rollback.restoredSnapshot, result.plan.before)) {
        context.addIssue({ code: 'custom', message: 'Rolled-back point text must prove exact before restoration.' });
    }
});
export const replacePointTextResponseSchema = z.strictObject({
    outcome: replacePointTextResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
export const REPLACE_POINT_TEXT_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: REPLACE_POINT_TEXT_OPERATION,
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
export const REPLACE_POINT_TEXT_SAFETY_IDENTITY = canonicalDigest(REPLACE_POINT_TEXT_SAFETY);
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    const beforeStateHash = canonicalDigest(result.plan.before);
    const afterStateHash = canonicalDigest(result.plan.after);
    const changeSetHash = canonicalDigest({ targetUuid: result.plan.targetUuid, replacement: result.plan.replacement,
        beforeStateHash, afterStateHash });
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'update_existing', operationId: REPLACE_POINT_TEXT_OPERATION,
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
        throw new Error('Indeterminate or failed point-text recovery cannot be terminal.');
    }
    const common = { policyVersion: 1, operationClass: 'update_existing',
        operationId: REPLACE_POINT_TEXT_OPERATION, canonicalRequestDigest: requestDigest,
        planDigest: plan.planDigest, attestation };
    const boundPlan = plan;
    const beforeStateHash = boundPlan.evidence.beforeStateHash;
    if (transaction.state === 'verified' && result.applied) {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { targetUuid: result.plan.targetUuid, beforeStateHash,
                afterStateHash: boundPlan.evidence.plannedAfterStateHash,
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
    const result = replacePointTextResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null)
        throw new Error('Point-text terminal result requires attestation.');
    await assertOperationSafetyAdapterConformance({ registration: REPLACE_POINT_TEXT_SAFETY, plan,
        result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
export const REPLACE_POINT_TEXT_MODULE_SCRIPT = `function pointTextAfter(before) {
  pointTextValidateContents(params.replacement, "replacement");
  var after = {};
  for (var key in before) if (before.hasOwnProperty(key)) after[key] = before[key];
  after.contents = params.replacement;
  return after;
}

function pointTextResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  var target = pointTextFind(document, params.targetUuid);
  if (target === null) throw new Error("MCP_ERROR:" + stringifyJson({ code: "OBJECT_NOT_FOUND", uuid: params.targetUuid }));
  var before = pointTextSnapshot(document, target, params.targetUuid);
  var blockers = pointTextBlockers(context, before);
  if (forApply && blockers.length > 0) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "POINT_TEXT_APPLY_BLOCKED",
      reasonCodes: blockers, uuid: params.targetUuid }));
  }
  return { context: context, document: document, target: target, before: before,
    after: pointTextAfter(before), blockers: blockers };
}

function pointTextPreflight(forApply) {
  var resolved = pointTextResolve(forApply);
  if (forApply) {
    if (!pointTextSame(resolved.before, params.expectedBefore)) {
      throw mutationError("preflight_failed", "Target state does not match expected_before.");
    }
    if (!pointTextSame(resolved.after, params.confirmedAfter)) {
      throw mutationError("preflight_failed", "confirmed_after does not match the derived replacement state.");
    }
  }
  return resolved;
}

function pointTextPlan(preflight) {
  return {
    operation: "replace_point_text", documentKey: preflight.context.key, targetUuid: params.targetUuid,
    replacement: params.replacement, before: preflight.before, after: preflight.after,
    applyBlockedReasonCodes: preflight.blockers,
    confirmationStatus: params.apply === true ? "confirmed" : "required",
    applyAllowed: params.apply === true && preflight.blockers.length === 0
  };
}

function pointTextRevalidate(preflight, plan) {
  var current;
  try { current = pointTextResolve(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error,
    "Point-text preconditions changed before apply.")); }
  if (current.document !== preflight.document || current.target !== preflight.target ||
      !pointTextSame(current.before, plan.before) || !pointTextSame(current.after, plan.after)) {
    throw mutationBeforeSideEffectError("Point-text target or contents changed before apply.");
  }
}

function pointTextApply(preflight, plan, state) {
  state.operationState.mutationStarted = true;
  preflight.target.contents = plan.after.contents;
  return preflight.target;
}

function pointTextVerify(preflight, plan) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) {
    throw mutationError("verify_mismatch", "Active document changed during point-text verification.");
  }
  var target = pointTextFind(preflight.document, plan.before.uuid);
  if (target === null || target !== preflight.target) {
    throw mutationError("verify_mismatch", "Target native UUID no longer resolves to the same TextFrame.");
  }
  var actual = pointTextSnapshot(preflight.document, target, params.targetUuid);
  if (!pointTextSame(actual, plan.after)) {
    throw mutationError("verify_mismatch", "Point-text postcondition does not match the plan.");
  }
  return actual;
}

function pointTextRollback(state) {
  var preflight = state.preflight;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) {
    return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
  }
  var target;
  var current;
  try {
    target = pointTextFind(preflight.document, params.targetUuid);
    if (target === null || target !== preflight.target) {
      return { status: "indeterminate", message: "Rollback target identity is indeterminate." };
    }
    current = pointTextSnapshot(preflight.document, target, params.targetUuid);
  } catch (error) { return { status: "indeterminate", message: "Rollback target state is indeterminate." }; }
  if (pointTextSame(current, preflight.before)) {
    state.operationState.rollbackEvidence.restoredSnapshot = current;
    return { status: "verified" };
  }
  if (!pointTextSame(current, preflight.after)) {
    return { status: "indeterminate", message: "Rollback refused because target state is neither before nor planned after." };
  }
  try { target.contents = preflight.before.contents; }
  catch (error) { return { status: "indeterminate", message: "Rollback contents write is indeterminate." }; }
  var restored;
  try { restored = pointTextSnapshot(preflight.document, target, params.targetUuid); }
  catch (error) { return { status: "indeterminate", message: "Rollback verification is indeterminate." }; }
  state.operationState.rollbackEvidence.restoredSnapshot = restored;
  return pointTextSame(restored, preflight.before)
    ? { status: "verified" }
    : { status: "failed", message: "Rollback did not restore the exact before point-text state." };
}

`;
export const REPLACE_POINT_TEXT_RUNNER_SCRIPT = `var pointTextExecution = runMutationTransaction({
  apply: params.apply === true,
  // the items this change reads and writes, so an edit session can advance its item aggregate.
  editSessionAffected: function () { return [params.targetUuid]; },
  initialOperationState: function () { return { mutationStarted: false,
    rollbackEvidence: { targetUuid: params.targetUuid, restoredSnapshot: null } }; },
  preflight: pointTextPreflight,
  plan: pointTextPlan,
  revalidate: pointTextRevalidate,
  applyMutation: pointTextApply,
  verify: pointTextVerify,
  rollback: pointTextRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () { return { reasonCode: "text_state_unknown",
    message: "Point-text apply outcome is indeterminate.",
    evidence: { targetUuid: params.targetUuid, restoredSnapshot: null } }; },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var pointTextDocument = pointTextExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === pointTextExecution.preflight.document) {
  pointTextDocument = getDocumentContext();
}
var result = { operation: "replace_point_text", applied: pointTextExecution.transaction.state === "verified",
  document: pointTextDocument, plan: pointTextExecution.plan, transaction: pointTextExecution.transaction };
if (pointTextExecution.transaction.state === "verified") result.postcondition = pointTextExecution.value;
`;
export const REPLACE_POINT_TEXT_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${POINT_TEXT_SNAPSHOT_SCRIPT}
${POINT_TEXT_BLOCKERS_SCRIPT}
${REPLACE_POINT_TEXT_MODULE_SCRIPT}${REPLACE_POINT_TEXT_RUNNER_SCRIPT}`;
export const REPLACE_POINT_TEXT_HOST_SCRIPT_DIGEST = canonicalSha256(REPLACE_POINT_TEXT_SCRIPT);
export const REPLACE_POINT_TEXT_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: REPLACE_POINT_TEXT_OPERATION,
    validator: REPLACE_POINT_TEXT_VALIDATOR, canonicalContractVersion: CANONICAL_VERSION,
    resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: REPLACE_POINT_TEXT_SAFETY_IDENTITY, hostScriptDigest: REPLACE_POINT_TEXT_HOST_SCRIPT_DIGEST,
    mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    const digestRequest = 'commandId' in request
        ? (({ commandId: _commandId, ...rest }) => rest)(request)
        : request;
    const digest = canonicalSha256({ operation: REPLACE_POINT_TEXT_OPERATION,
        validator: REPLACE_POINT_TEXT_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request,
        commandId: 'commandId' in request ? request.commandId : null,
        documentKey: request.expectedDocumentKey, digest };
}
export const replacePointTextToolContract = {
    name: 'illustrator_replace_point_text',
    title: 'Plan or Replace Point Text',
    description: 'Plan or replace one non-empty single-line layer-direct POINTTEXT frame with no manual pair kerning, bound by explicit document key and native UUID. Apply performs exact compare-and-set, native read-back verification, and verified inverse rollback.',
    inputSchema,
    publicInputSchema: replacePointTextPublicInputSchema,
    outputSchema: replacePointTextResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(REPLACE_POINT_TEXT_SAFETY.policy),
    normalizePublicInput,
};
export function createReplacePointTextAdapter() {
    return {
        version: 1, operation: REPLACE_POINT_TEXT_OPERATION, validator: REPLACE_POINT_TEXT_VALIDATOR,
        safety: REPLACE_POINT_TEXT_SAFETY, safetyRegistrationIdentity: REPLACE_POINT_TEXT_SAFETY_IDENTITY,
        adapterIdentity: REPLACE_POINT_TEXT_ADAPTER_IDENTITY, tool: replacePointTextToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest,
            safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: replacePointTextResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: CLASSIFIER_VERSION, safetyConformanceVersion: CONFORMANCE_VERSION,
        errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: REPLACE_POINT_TEXT_HOST_SCRIPT_DIGEST,
        mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: REPLACE_POINT_TEXT_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: REPLACE_POINT_TEXT_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: REPLACE_POINT_TEXT_OPERATION,
                    documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: REPLACE_POINT_TEXT_ADAPTER_IDENTITY,
                mutationHostApplicationMode: 'foreground', script: REPLACE_POINT_TEXT_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = replacePointTextResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back')
                return { state };
            if (state === 'planned')
                throw new Error('Point-text plan is not a terminal mutation result.');
            throw new Error('Unverified point-text recovery must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error, detail) {
            const lookupFailure = textLookupFailureError(error, detail);
            if (lookupFailure !== null)
                return lookupFailure;
            if (detail?.code === 'OBJECT_NOT_FOUND') {
                return new Error(`No PageItem with UUID ${JSON.stringify(detail.uuid ?? '')} exists in the bound document.`);
            }
            if (detail?.code === 'POINT_TEXT_APPLY_BLOCKED') {
                return new Error(`Point-text replacement is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}.`);
            }
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
