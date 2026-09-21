import { z } from 'zod';
import { canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { POINT_TEXT_BLOCKERS_SCRIPT, POINT_TEXT_SNAPSHOT_SCRIPT, pointTextApplyBlockers } from './point-text-host-script.js';
import { AREA_TEXT_SNAPSHOT_SCRIPT } from './area-text-host-script.js';
import { AREA_COLUMNS_READ_SCRIPT, areaColumnsBlockerSchema, areaColumnsErrorMessage, areaColumnsSnapshotSchema, fitConsistent, } from '../area-text-options.js';
export const SET_AREA_TEXT_COLUMNS_OPERATION = 'set_area_text_columns';
export const SET_AREA_TEXT_COLUMNS_VALIDATOR = { kind: SET_AREA_TEXT_COLUMNS_OPERATION, version: 1 };
const CANONICAL_VERSION = 1;
const RESULT_SCHEMA_VERSION = 1;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
export const AREA_COLUMNS_MAX_COUNT = 20;
export const AREA_COLUMNS_MAX_GUTTER = 1_000;
const countSchema = z.number().int().min(1).max(AREA_COLUMNS_MAX_COUNT);
const gutterSchema = z.number().finite().min(0).max(AREA_COLUMNS_MAX_GUTTER);
const requestedOptionsSchema = z.strictObject({
    columnCount: countSchema.optional(),
    columnGutter: gutterSchema.optional(),
    rowCount: countSchema.optional(),
    rowGutter: gutterSchema.optional(),
    flowLinksHorizontally: z.boolean().optional(),
});
const publicOptionsSchema = z.strictObject({
    column_count: countSchema.optional(),
    column_gutter: gutterSchema.optional(),
    row_count: countSchema.optional(),
    row_gutter: gutterSchema.optional(),
    flow_links_horizontally: z.boolean().optional(),
});
function assertRequestsAnOption(options) {
    if (!Object.values(options).some((value) => value !== undefined)) {
        throw new Error('An area-text column edit must request at least one option.');
    }
}
export function predictAreaColumnsAfter(before, options) {
    return {
        ...before,
        options: {
            columnCount: options.columnCount ?? before.options.columnCount,
            columnGutter: options.columnGutter ?? before.options.columnGutter,
            rowCount: options.rowCount ?? before.options.rowCount,
            rowGutter: options.rowGutter ?? before.options.rowGutter,
            flowLinksHorizontally: options.flowLinksHorizontally ?? before.options.flowLinksHorizontally,
        },
        fit: { status: 'fits', visibleCharacterCount: before.fit.storyCharacterCount,
            storyCharacterCount: before.fit.storyCharacterCount },
    };
}
function same(left, right) {
    return canonicalSha256(left) === canonicalSha256(right);
}
export const setAreaTextColumnsPlanSchema = z.strictObject({
    operation: z.literal(SET_AREA_TEXT_COLUMNS_OPERATION),
    documentKey: z.string().min(1).max(16_384),
    targetUuid: z.string().min(1).max(255),
    options: requestedOptionsSchema,
    before: areaColumnsSnapshotSchema,
    after: areaColumnsSnapshotSchema,
    applyBlockedReasonCodes: z.array(areaColumnsBlockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    if (plan.targetUuid !== plan.before.uuid) {
        context.addIssue({ code: 'custom', message: 'An area-text column plan must bind one target UUID.' });
    }
    if (!fitConsistent(plan.before.fit)) {
        context.addIssue({ code: 'custom', message: 'Area-text fit status must match its character counts.' });
    }
    if (!same(plan.after, predictAreaColumnsAfter(plan.before, plan.options))) {
        context.addIssue({ code: 'custom',
            message: 'An area-text column plan must move only the requested options and leave the whole story visible.' });
    }
    const allowed = plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0;
    if (plan.applyAllowed !== allowed) {
        context.addIssue({ code: 'custom', message: 'Area-text column applyAllowed must require confirmation and no blockers.' });
    }
});
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']),
    reasonCode: z.enum(['apply_failed', 'verify_mismatch']),
    message: z.string().min(1).max(500),
}).superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed')) {
        context.addIssue({ code: 'custom', message: 'Area-text column failure phase and reason code must match.' });
    }
});
const indeterminateFailureSchema = z.strictObject({
    phase: z.literal('apply'),
    reasonCode: z.literal('apply_indeterminate'),
    message: z.string().min(1).max(500),
});
const rollbackEvidence = {
    targetUuid: z.string().min(1).max(255),
    restoredSnapshot: areaColumnsSnapshotSchema.nullable(),
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
        rollback: z.strictObject({
            status: z.literal('failed'), reasonCode: z.literal('rollback_failed'),
            message: z.string().min(1).max(500), ...rollbackEvidence,
        }), audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('apply_indeterminate'), failure: indeterminateFailureSchema,
        rollback: z.strictObject({
            status: z.literal('indeterminate'), reasonCode: z.literal('area_text_state_unknown'),
            message: z.string().min(1).max(500), targetUuid: z.string().min(1).max(255),
            restoredSnapshot: z.null(),
        }), audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rollback_indeterminate'), failure: failureSchema,
        rollback: z.strictObject({
            status: z.literal('indeterminate'), reasonCode: z.literal('rollback_indeterminate'),
            message: z.string().min(1).max(500), ...rollbackEvidence,
        }), audit: mutationAuditSchema,
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
        context.addIssue({ code: 'custom', message: 'Area-text column audit sequence does not match transaction state.' });
    }
    transaction.audit.forEach((event, index) => {
        if (event.sequence !== index) {
            context.addIssue({ code: 'custom', message: 'Area-text column audit sequence must be contiguous.' });
        }
    });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' &&
            event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode &&
            event.message === transaction.failure.message);
        if (matches.length !== 1) {
            context.addIssue({ code: 'custom', message: 'Area-text column failure must match one audit event.' });
        }
    }
});
export const setAreaTextColumnsResultSchema = z.union([
    z.strictObject({
        operation: z.literal(SET_AREA_TEXT_COLUMNS_OPERATION), applied: z.literal(false),
        document: documentContextSchema, plan: setAreaTextColumnsPlanSchema, transaction: transactionSchema,
    }),
    z.strictObject({
        operation: z.literal(SET_AREA_TEXT_COLUMNS_OPERATION), applied: z.literal(true),
        document: documentContextSchema, plan: setAreaTextColumnsPlanSchema,
        postcondition: areaColumnsSnapshotSchema, transaction: transactionSchema,
    }),
]).superRefine((result, context) => {
    if (result.transaction.state === 'planned') {
        const blockers = pointTextApplyBlockers(result.document.mutationAllowed, result.plan.before);
        if (result.plan.confirmationStatus !== 'required' || !same(result.plan.applyBlockedReasonCodes, blockers)) {
            context.addIssue({ code: 'custom', message: 'Planned area-text column edit must expose exact blockers.' });
        }
    }
    else if (result.plan.confirmationStatus !== 'confirmed' ||
        result.plan.applyBlockedReasonCodes.length !== 0 || !result.plan.applyAllowed) {
        context.addIssue({ code: 'custom', message: 'Applied area-text column edit must derive from an allowed confirmed plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified' || !same(result.postcondition, result.plan.after)) {
            context.addIssue({ code: 'custom', message: 'A verified area-text column edit must match the exact after snapshot.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified area-text column transaction must be applied.' });
    }
    if (result.transaction.state === 'rolled_back' &&
        !same(result.transaction.rollback.restoredSnapshot, result.plan.before)) {
        context.addIssue({ code: 'custom', message: 'A rolled-back area-text column edit must prove exact before restoration.' });
    }
});
export const setAreaTextColumnsResponseSchema = z.strictObject({
    outcome: setAreaTextColumnsResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
const commonInternal = {
    expectedDocumentKey: z.string().min(1).max(16_384),
    targetUuid: z.string().min(1).max(255),
    options: requestedOptionsSchema,
};
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({
        ...commonInternal,
        expectedBefore: areaColumnsSnapshotSchema,
        confirmedAfter: areaColumnsSnapshotSchema,
        apply: z.literal(true),
        commandId: canonicalCommandIdSchema,
    }),
]);
const commonPublic = {
    expected_document_key: z.string().min(1).max(16_384),
    target_uuid: z.string().min(1).max(255),
    options: publicOptionsSchema,
};
export const setAreaTextColumnsPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({
        ...commonPublic,
        expected_before: areaColumnsSnapshotSchema,
        confirmed_after: areaColumnsSnapshotSchema,
        apply: z.literal(true),
        command_id: canonicalCommandIdSchema,
    }),
]);
const inputSchema = z.strictObject({
    ...commonPublic,
    expected_before: areaColumnsSnapshotSchema.optional(),
    confirmed_after: areaColumnsSnapshotSchema.optional(),
    apply: z.boolean().default(false),
    command_id: canonicalCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(setAreaTextColumnsPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = setAreaTextColumnsPublicInputSchema.parse(input);
    const options = {
        ...(value.options.column_count === undefined ? {} : { columnCount: value.options.column_count }),
        ...(value.options.column_gutter === undefined ? {} : { columnGutter: value.options.column_gutter }),
        ...(value.options.row_count === undefined ? {} : { rowCount: value.options.row_count }),
        ...(value.options.row_gutter === undefined ? {} : { rowGutter: value.options.row_gutter }),
        ...(value.options.flow_links_horizontally === undefined
            ? {} : { flowLinksHorizontally: value.options.flow_links_horizontally }),
    };
    assertRequestsAnOption(options);
    const common = { expectedDocumentKey: value.expected_document_key, targetUuid: value.target_uuid, options };
    return value.apply
        ? { ...common, expectedBefore: value.expected_before, confirmedAfter: value.confirmed_after,
            apply: true, commandId: value.command_id }
        : { ...common, apply: false };
}
export const SET_AREA_TEXT_COLUMNS_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: SET_AREA_TEXT_COLUMNS_OPERATION,
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
export const SET_AREA_TEXT_COLUMNS_SAFETY_IDENTITY = canonicalDigest(SET_AREA_TEXT_COLUMNS_SAFETY);
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    const beforeStateHash = canonicalDigest(result.plan.before);
    const afterStateHash = canonicalDigest(result.plan.after);
    const changeSetHash = canonicalDigest({ targetUuid: result.plan.targetUuid, options: result.plan.options,
        beforeStateHash, afterStateHash });
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'update_existing', operationId: SET_AREA_TEXT_COLUMNS_OPERATION,
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
        throw new Error('Indeterminate or failed area-text column recovery cannot be terminal.');
    }
    const common = { policyVersion: 1, operationClass: 'update_existing',
        operationId: SET_AREA_TEXT_COLUMNS_OPERATION, canonicalRequestDigest: requestDigest,
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
    const result = setAreaTextColumnsResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null) {
        throw new Error('Area-text column terminal result requires attestation.');
    }
    await assertOperationSafetyAdapterConformance({ registration: SET_AREA_TEXT_COLUMNS_SAFETY, plan,
        result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
export const SET_AREA_TEXT_COLUMNS_MODULE_SCRIPT = `
/** The compare-and-set snapshot: fit without the unpredictable line count, and never "indeterminate". */
function columnsSnapshot(document, target) {
  var read = areaColumnsRead(document, target, params.targetUuid);
  if (read.fit.status !== "fits" && read.fit.status !== "overflows") {
    throw mutationError("verify_mismatch", stringifyJson({ code: "AREA_TEXT_FIT_INDETERMINATE",
      uuid: params.targetUuid, actual: String(read.fit.status) }));
  }
  read.fit = { status: read.fit.status, visibleCharacterCount: read.fit.visibleCharacterCount,
    storyCharacterCount: read.fit.storyCharacterCount };
  return read;
}

/**
 * Key-order-independent JSON: an echoed \`expected_before\` / \`confirmed_after\` arrives in the published
 * schema's key order, not the order this script built it in, so an order-sensitive comparison could refuse
 * every public apply (the apply_character_style defect).
 */
function columnsCanonicalJson(value) {
  if (value === null || typeof value !== "object") return stringifyJson(value);
  // Not \`instanceof Array\`: that fails for an array built in another realm.
  if (Object.prototype.toString.call(value) === "[object Array]") {
    var items = [];
    for (var index = 0; index < value.length; index++) items.push(columnsCanonicalJson(value[index]));
    return "[" + items.join(",") + "]";
  }
  var keys = [];
  for (var key in value) if (Object.prototype.hasOwnProperty.call(value, key)) keys.push(key);
  keys.sort();
  var fields = [];
  for (var keyIndex = 0; keyIndex < keys.length; keyIndex++) {
    fields.push(stringifyJson(keys[keyIndex]) + ":" + columnsCanonicalJson(value[keys[keyIndex]]));
  }
  return "{" + fields.join(",") + "}";
}

function columnsSame(left, right) {
  return left !== null && left !== undefined && right !== null && right !== undefined &&
    columnsCanonicalJson(left) === columnsCanonicalJson(right);
}

function columnsPredictAfter(before) {
  var after = {};
  for (var field in before) if (before.hasOwnProperty(field)) after[field] = before[field];
  var options = {};
  for (var index = 0; index < AREA_COLUMNS_OPTION_ORDER.length; index++) {
    var name = AREA_COLUMNS_OPTION_ORDER[index];
    options[name] = params.options[name] !== undefined ? params.options[name] : before.options[name];
  }
  after.options = options;
  after.fit = { status: "fits", visibleCharacterCount: before.fit.storyCharacterCount,
    storyCharacterCount: before.fit.storyCharacterCount };
  return after;
}

function columnsResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  var target = areaColumnsResolve(document, params.targetUuid);
  var before;
  try { before = columnsSnapshot(document, target); }
  catch (snapshotError) {
    // An indeterminate fit before any write is a refusal, not a verification failure.
    if (snapshotError && snapshotError.mutationReasonCode === "verify_mismatch") {
      throw mutationError("preflight_failed", snapshotError.mutationPublicMessage);
    }
    throw snapshotError;
  }
  var blockers = pointTextBlockers(context, before);
  if (forApply && blockers.length > 0) {
    throw mutationBeforeSideEffectError(stringifyJson({ code: "AREA_COLUMNS_APPLY_BLOCKED",
      reasonCodes: blockers, uuid: params.targetUuid }));
  }
  return { context: context, document: document, target: target, before: before, blockers: blockers };
}

function columnsPreflight(forApply) {
  var resolved = columnsResolve(forApply);
  if (forApply) {
    if (!columnsSame(resolved.before, params.expectedBefore)) {
      throw mutationError("preflight_failed", "Target state does not match expected_before.");
    }
    if (!columnsSame(columnsPredictAfter(resolved.before), params.confirmedAfter)) {
      throw mutationError("preflight_failed", "confirmed_after does not match the derived area-text layout.");
    }
  }
  return resolved;
}

function columnsPlan(preflight) {
  return {
    operation: "set_area_text_columns", documentKey: preflight.context.key, targetUuid: params.targetUuid,
    options: params.options, before: preflight.before, after: columnsPredictAfter(preflight.before),
    applyBlockedReasonCodes: preflight.blockers,
    confirmationStatus: params.apply === true ? "confirmed" : "required",
    applyAllowed: params.apply === true && preflight.blockers.length === 0
  };
}

function columnsRevalidate(preflight, plan) {
  var current;
  try { current = columnsResolve(true); }
  catch (error) {
    throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Area-text column preconditions changed before apply."));
  }
  if (current.document !== preflight.document || current.target !== preflight.target ||
      !columnsSame(current.before, plan.before)) {
    throw mutationBeforeSideEffectError("Area-text target changed before apply.");
  }
}

/** Writes in the measured profile order: columnCount, columnGutter, rowCount, rowGutter, flowLinksHorizontally. */
function columnsWrite(target, values) {
  for (var index = 0; index < AREA_COLUMNS_OPTION_ORDER.length; index++) {
    var name = AREA_COLUMNS_OPTION_ORDER[index];
    if (values[name] !== undefined) target[name] = values[name];
  }
}

function columnsApply(preflight, plan, state) {
  state.operationState.mutationStarted = true;
  columnsWrite(preflight.target, params.options);
  return preflight.target;
}

function columnsVerify(preflight, plan) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) {
    throw mutationError("verify_mismatch", "Active document changed during area-text column verification.");
  }
  var target = pointTextFind(preflight.document, plan.before.uuid);
  if (target === null || target !== preflight.target) {
    throw mutationError("verify_mismatch", "Target native UUID no longer resolves to the same TextFrame.");
  }
  var actual = columnsSnapshot(preflight.document, target);
  if (actual.fit.status !== "fits") {
    throw mutationError("verify_mismatch", "The new layout hides text: " + actual.fit.visibleCharacterCount +
      " of " + actual.fit.storyCharacterCount + " story characters are visible, so the edit is undone.");
  }
  if (!columnsSame(actual, plan.after)) {
    throw mutationError("verify_mismatch", "Area-text column postcondition does not match the plan.");
  }
  return actual;
}

function columnsRollback(state) {
  var preflight = state.preflight;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) {
    return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
  }
  var target;
  try {
    target = pointTextFind(preflight.document, params.targetUuid);
    if (target === null || target !== preflight.target) {
      return { status: "indeterminate", message: "Rollback target identity is indeterminate." };
    }
  } catch (error) { return { status: "indeterminate", message: "Rollback target identity is indeterminate." }; }
  var current = null;
  try { current = columnsSnapshot(preflight.document, target); } catch (currentError) { current = null; }
  if (current !== null && columnsSame(current, preflight.before)) {
    state.operationState.rollbackEvidence.restoredSnapshot = current;
    return { status: "verified" };
  }
  // The five options are the only thing the edit writes, so they are the only thing the inverse writes.
  try { columnsWrite(target, preflight.before.options); }
  catch (writeError) { return { status: "indeterminate", message: "Rollback option write is indeterminate." }; }
  var restored;
  try { restored = columnsSnapshot(preflight.document, target); }
  catch (verifyError) { return { status: "indeterminate", message: "Rollback verification is indeterminate." }; }
  state.operationState.rollbackEvidence.restoredSnapshot = restored;
  return columnsSame(restored, preflight.before)
    ? { status: "verified" }
    : { status: "failed", message: "Rollback did not restore the exact before area-text layout." };
}
`;
export const SET_AREA_TEXT_COLUMNS_RUNNER_SCRIPT = `var columnsExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionAffected: function () { return [params.targetUuid]; },
  initialOperationState: function () {
    return { mutationStarted: false, rollbackEvidence: { targetUuid: params.targetUuid, restoredSnapshot: null } };
  },
  preflight: columnsPreflight,
  plan: columnsPlan,
  revalidate: columnsRevalidate,
  applyMutation: columnsApply,
  verify: columnsVerify,
  rollback: columnsRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () {
    return { reasonCode: "area_text_state_unknown",
      message: "Area-text column apply outcome is indeterminate.",
      evidence: { targetUuid: params.targetUuid, restoredSnapshot: null } };
  },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var columnsDocument = columnsExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === columnsExecution.preflight.document) {
  columnsDocument = getDocumentContext();
}
var result = { operation: "set_area_text_columns",
  applied: columnsExecution.transaction.state === "verified",
  document: columnsDocument, plan: columnsExecution.plan, transaction: columnsExecution.transaction };
if (columnsExecution.transaction.state === "verified") result.postcondition = columnsExecution.value;
`;
export const SET_AREA_TEXT_COLUMNS_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${POINT_TEXT_SNAPSHOT_SCRIPT}
${POINT_TEXT_BLOCKERS_SCRIPT}
${AREA_TEXT_SNAPSHOT_SCRIPT}
${AREA_COLUMNS_READ_SCRIPT}
${SET_AREA_TEXT_COLUMNS_MODULE_SCRIPT}${SET_AREA_TEXT_COLUMNS_RUNNER_SCRIPT}`;
export const SET_AREA_TEXT_COLUMNS_HOST_SCRIPT_DIGEST = canonicalSha256(SET_AREA_TEXT_COLUMNS_SCRIPT);
export const SET_AREA_TEXT_COLUMNS_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: SET_AREA_TEXT_COLUMNS_OPERATION,
    validator: SET_AREA_TEXT_COLUMNS_VALIDATOR, canonicalContractVersion: CANONICAL_VERSION,
    resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: SET_AREA_TEXT_COLUMNS_SAFETY_IDENTITY, hostScriptDigest: SET_AREA_TEXT_COLUMNS_HOST_SCRIPT_DIGEST,
    mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    assertRequestsAnOption(request.options);
    const digestRequest = 'commandId' in request
        ? (({ commandId: _commandId, ...rest }) => rest)(request)
        : request;
    const digest = canonicalSha256({ operation: SET_AREA_TEXT_COLUMNS_OPERATION,
        validator: SET_AREA_TEXT_COLUMNS_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request,
        commandId: 'commandId' in request ? request.commandId : null,
        documentKey: request.expectedDocumentKey, digest };
}
export const setAreaTextColumnsToolContract = {
    name: 'illustrator_set_area_text_columns',
    title: 'Plan or Set Area-Text Columns',
    description: 'Plan or apply the column and row layout of one existing area-text frame: `column_count` and '
        + `\`row_count\` (1 to ${AREA_COLUMNS_MAX_COUNT}), \`column_gutter\` and \`row_gutter\` (0 to ${AREA_COLUMNS_MAX_GUTTER} pt), `
        + 'and `flow_links_horizontally` (text flows across rows before columns when true). Request at least one; the '
        + 'others stay as they are. The target is an unthreaded, horizontal AREATEXT frame directly on a layer, bound '
        + 'by explicit document key and native UUID; read it first with illustrator_get_area_text_options. The plan '
        + 'returns the exact before and after state; apply echoes them as expected_before and confirmed_after, runs '
        + 'in the foreground, verifies every option by native read-back, and requires the whole story to be visible '
        + 'afterwards: a layout that would hide text (overflow) is undone with the measured inverse and reported as '
        + 'rolled back. A frame that already overflows may be edited only into a layout that shows all of it. '
        + 'Area inset, threading and unthreading are not offered (unsupported on the measured host).',
    inputSchema,
    publicInputSchema: setAreaTextColumnsPublicInputSchema,
    outputSchema: setAreaTextColumnsResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(SET_AREA_TEXT_COLUMNS_SAFETY.policy),
    normalizePublicInput,
};
export function createSetAreaTextColumnsAdapter() {
    return {
        version: 1, operation: SET_AREA_TEXT_COLUMNS_OPERATION, validator: SET_AREA_TEXT_COLUMNS_VALIDATOR,
        safety: SET_AREA_TEXT_COLUMNS_SAFETY, safetyRegistrationIdentity: SET_AREA_TEXT_COLUMNS_SAFETY_IDENTITY,
        adapterIdentity: SET_AREA_TEXT_COLUMNS_ADAPTER_IDENTITY, tool: setAreaTextColumnsToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest,
            safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: setAreaTextColumnsResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: CLASSIFIER_VERSION, safetyConformanceVersion: CONFORMANCE_VERSION,
        errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: SET_AREA_TEXT_COLUMNS_HOST_SCRIPT_DIGEST,
        mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: SET_AREA_TEXT_COLUMNS_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: SET_AREA_TEXT_COLUMNS_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: SET_AREA_TEXT_COLUMNS_OPERATION,
                    documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: SET_AREA_TEXT_COLUMNS_ADAPTER_IDENTITY,
                mutationHostApplicationMode: 'foreground', script: SET_AREA_TEXT_COLUMNS_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = setAreaTextColumnsResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back')
                return { state };
            if (state === 'planned')
                throw new Error('Area-text column plan is not a terminal mutation result.');
            throw new Error('Unverified area-text column recovery must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error, detail) {
            const message = areaColumnsErrorMessage(detail);
            if (message !== null)
                return new Error(message);
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
