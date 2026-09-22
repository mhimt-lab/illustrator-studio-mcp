import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { POINT_TEXT_CHARACTER_SCRIPT, POINT_TEXT_MAX_CODE_UNITS, POINT_TEXT_SNAPSHOT_SCRIPT, pointTextRangeSnapshotSchema, } from './point-text-host-script.js';
import { validateClusterRange } from './point-text-cluster.js';
import { textLookupFailureError } from './text-lookup-error.js';
export const REPLACE_TEXT_RANGE_OPERATION = 'replace_text_range';
export const REPLACE_TEXT_RANGE_VALIDATOR = { kind: REPLACE_TEXT_RANGE_OPERATION, version: 1 };
const CANONICAL_VERSION = 2;
const RESULT_SCHEMA_VERSION = 3;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 2;
const replacementSchema = z.string().max(POINT_TEXT_MAX_CODE_UNITS)
    .regex(/^[^\r\n]*$/u, 'A point-text range replacement must not contain a line break.');
const rangeRejectionSchema = z.enum([
    'offset_out_of_range',
    'range_splits_character',
    'unmeasured_script',
    'joiner_not_transportable',
    'result_too_long',
    'result_empty',
    'range_style_not_uniform',
]);
const blockerSchema = z.enum([
    'document_mutation_not_allowed',
    'target_locked',
    'target_hidden',
    'target_not_editable',
    'layer_hidden',
    'layer_locked',
]);
const planSchema = z.strictObject({
    operation: z.literal(REPLACE_TEXT_RANGE_OPERATION),
    documentKey: z.string().min(1).max(16_384),
    targetUuid: z.string().min(1).max(255),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    replacement: replacementSchema,
    removed: z.string().min(1).max(POINT_TEXT_MAX_CODE_UNITS),
    before: pointTextRangeSnapshotSchema,
    after: pointTextRangeSnapshotSchema,
    applyBlockedReasonCodes: z.array(blockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    if (plan.start >= plan.end || plan.end > plan.before.characters.length) {
        context.addIssue({ code: 'custom', message: 'A point-text range must be a non-empty span inside the target.' });
    }
    if (plan.targetUuid !== plan.before.uuid || plan.before.uuid !== plan.after.uuid) {
        context.addIssue({ code: 'custom', message: 'A point-text range plan must bind one target UUID.' });
    }
    if (plan.removed !== plan.before.contents.slice(plan.start, plan.end)) {
        context.addIssue({ code: 'custom', message: 'A point-text range plan must record the exact removed text.' });
    }
    const expected = plan.before.contents.slice(0, plan.start) + plan.replacement +
        plan.before.contents.slice(plan.end);
    if (plan.after.contents !== expected) {
        context.addIssue({ code: 'custom', message: 'A point-text range plan must derive the exact after contents.' });
    }
    const allowed = plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0;
    if (plan.applyAllowed !== allowed) {
        context.addIssue({ code: 'custom', message: 'Point-text range applyAllowed must require confirmation and no blockers.' });
    }
    const tail = plan.start + plan.replacement.length;
    const outsideBefore = [
        ...plan.before.characters.slice(0, plan.start),
        ...plan.before.characters.slice(plan.end),
    ];
    const outsideAfter = [
        ...plan.after.characters.slice(0, plan.start),
        ...plan.after.characters.slice(tail),
    ];
    if (canonicalSha256(outsideBefore) !==
        canonicalSha256(outsideAfter)) {
        context.addIssue({ code: 'custom', message: 'A point-text range plan must leave every character outside the range unchanged.' });
    }
    const inherited = plan.before.characters[plan.start];
    const insertedStyles = plan.after.characters.slice(plan.start, tail);
    if (inherited !== undefined && insertedStyles.some((character) => canonicalSha256({ ...character, contents: '' }) !==
        canonicalSha256({ ...inherited, contents: '' }))) {
        context.addIssue({ code: 'custom', message: 'Inserted point-text characters must carry the first replaced character style.' });
    }
});
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']),
    reasonCode: z.enum(['apply_failed', 'verify_mismatch']),
    message: z.string().min(1).max(500),
}).superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed')) {
        context.addIssue({ code: 'custom', message: 'Point-text range failure phase and reason code must match.' });
    }
});
const indeterminateFailureSchema = z.strictObject({
    phase: z.literal('apply'),
    reasonCode: z.literal('apply_indeterminate'),
    message: z.string().min(1).max(500),
});
const rollbackEvidence = {
    targetUuid: z.string().min(1).max(255),
    restoredSnapshot: pointTextRangeSnapshotSchema.nullable(),
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
            status: z.literal('indeterminate'), reasonCode: z.literal('text_state_unknown'),
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
        context.addIssue({ code: 'custom', message: 'Point-text range audit sequence does not match transaction state.' });
    }
    transaction.audit.forEach((event, index) => {
        if (event.sequence !== index) {
            context.addIssue({ code: 'custom', message: 'Point-text range audit sequence must be contiguous.' });
        }
    });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' &&
            event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode &&
            event.message === transaction.failure.message);
        if (matches.length !== 1) {
            context.addIssue({ code: 'custom', message: 'Point-text range failure must match one audit event.' });
        }
    }
});
export const replaceTextRangeResultSchema = z.union([
    z.strictObject({
        operation: z.literal(REPLACE_TEXT_RANGE_OPERATION), applied: z.literal(false),
        document: documentContextSchema, plan: planSchema, transaction: transactionSchema,
    }),
    z.strictObject({
        operation: z.literal(REPLACE_TEXT_RANGE_OPERATION), applied: z.literal(true),
        document: documentContextSchema, plan: planSchema,
        postcondition: pointTextRangeSnapshotSchema, transaction: transactionSchema,
    }),
]).superRefine((result, context) => {
    if (result.transaction.state === 'planned') {
        const before = result.plan.before;
        const blockers = [];
        if (!result.document.mutationAllowed)
            blockers.push('document_mutation_not_allowed');
        if (before.locked)
            blockers.push('target_locked');
        if (before.hidden)
            blockers.push('target_hidden');
        if (!before.editable)
            blockers.push('target_not_editable');
        if (before.layerAncestry.some((ancestor) => !ancestor.visible))
            blockers.push('layer_hidden');
        if (before.layerAncestry.some((ancestor) => ancestor.locked))
            blockers.push('layer_locked');
        if (result.plan.confirmationStatus !== 'required' ||
            canonicalSha256(result.plan.applyBlockedReasonCodes) !==
                canonicalSha256(blockers)) {
            context.addIssue({ code: 'custom', message: 'Planned point-text range edit must expose exact blockers.' });
        }
    }
    else if (result.plan.confirmationStatus !== 'confirmed' ||
        result.plan.applyBlockedReasonCodes.length !== 0 || !result.plan.applyAllowed) {
        context.addIssue({ code: 'custom', message: 'Applied point-text range edit must derive from an allowed confirmed plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified' ||
            canonicalSha256(result.postcondition) !==
                canonicalSha256(result.plan.after)) {
            context.addIssue({ code: 'custom', message: 'A verified point-text range edit must match the exact after snapshot.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified point-text range transaction must be applied.' });
    }
    if (result.transaction.state === 'rolled_back' &&
        canonicalSha256(result.transaction.rollback.restoredSnapshot) !==
            canonicalSha256(result.plan.before)) {
        context.addIssue({ code: 'custom', message: 'A rolled-back point-text range edit must prove exact before restoration.' });
    }
});
export const replaceTextRangeResponseSchema = z.strictObject({
    outcome: replaceTextRangeResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
const commonInternal = {
    expectedDocumentKey: z.string().min(1).max(16_384),
    targetUuid: z.string().min(1).max(255),
    start: z.number().int().safe().nonnegative(),
    end: z.number().int().safe().nonnegative(),
    replacement: replacementSchema,
};
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({
        ...commonInternal,
        expectedBefore: pointTextRangeSnapshotSchema,
        confirmedAfter: pointTextRangeSnapshotSchema,
        apply: z.literal(true),
        commandId: canonicalCommandIdSchema,
    }),
]);
const commonPublic = {
    expected_document_key: z.string().min(1).max(16_384),
    target_uuid: z.string().min(1).max(255),
    start: z.number().int().safe().nonnegative(),
    end: z.number().int().safe().nonnegative(),
    replacement: replacementSchema,
};
export const replaceTextRangePublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({
        ...commonPublic,
        expected_before: pointTextRangeSnapshotSchema,
        confirmed_after: pointTextRangeSnapshotSchema,
        apply: z.literal(true),
        command_id: applyCommandIdSchema,
    }),
]);
const inputSchema = z.strictObject({
    ...commonPublic,
    expected_before: pointTextRangeSnapshotSchema.optional(),
    confirmed_after: pointTextRangeSnapshotSchema.optional(),
    apply: z.boolean().default(false),
    command_id: applyCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(replaceTextRangePublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = replaceTextRangePublicInputSchema.parse(input);
    const common = {
        expectedDocumentKey: value.expected_document_key,
        targetUuid: value.target_uuid,
        start: value.start,
        end: value.end,
        replacement: value.replacement,
    };
    return value.apply
        ? { ...common, expectedBefore: value.expected_before, confirmedAfter: value.confirmed_after,
            apply: true, commandId: value.command_id }
        : { ...common, apply: false };
}
export function checkTextRangeRequest(before, start, end, replacement) {
    const rejection = validateClusterRange(before.contents, start, end);
    if (rejection !== null)
        return rejection;
    const result = before.contents.slice(0, start) + replacement + before.contents.slice(end);
    if (result.length === 0)
        return { reason: 'result_empty' };
    if (result.length > POINT_TEXT_MAX_CODE_UNITS)
        return { reason: 'result_too_long' };
    const replacementRejection = validateClusterRange(`x${replacement}x`, 1, replacement.length + 1);
    if (replacement.length > 0 && replacementRejection !== null)
        return replacementRejection;
    const first = before.characters[start];
    if (first === undefined)
        return { reason: 'offset_out_of_range' };
    const firstStyle = canonicalSha256({ ...first, contents: '' });
    for (let index = start + 1; index < end; index += 1) {
        const entry = before.characters[index];
        if (entry === undefined)
            return { reason: 'offset_out_of_range' };
        if (canonicalSha256({ ...entry, contents: '' }) !== firstStyle) {
            return { reason: 'range_style_not_uniform' };
        }
    }
    return null;
}
export const REPLACE_TEXT_RANGE_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: REPLACE_TEXT_RANGE_OPERATION,
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
export const REPLACE_TEXT_RANGE_SAFETY_IDENTITY = canonicalDigest(REPLACE_TEXT_RANGE_SAFETY);
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    const beforeStateHash = canonicalDigest(result.plan.before);
    const afterStateHash = canonicalDigest(result.plan.after);
    const changeSetHash = canonicalDigest({ targetUuid: result.plan.targetUuid, start: result.plan.start,
        end: result.plan.end, replacement: result.plan.replacement, beforeStateHash, afterStateHash });
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'update_existing', operationId: REPLACE_TEXT_RANGE_OPERATION,
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
        throw new Error('Indeterminate or failed point-text range recovery cannot be terminal.');
    }
    const common = { policyVersion: 1, operationClass: 'update_existing',
        operationId: REPLACE_TEXT_RANGE_OPERATION, canonicalRequestDigest: requestDigest,
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
    const result = replaceTextRangeResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null) {
        throw new Error('Point-text range terminal result requires attestation.');
    }
    await assertOperationSafetyAdapterConformance({ registration: REPLACE_TEXT_RANGE_SAFETY, plan,
        result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
export const REPLACE_TEXT_RANGE_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${POINT_TEXT_SNAPSHOT_SCRIPT}
${POINT_TEXT_CHARACTER_SCRIPT}

/**
 * The range snapshot. It reuses every frame-level check the shared profile script performs, but
 * replaces the single-run style block with a per-character fingerprint, because a whole-range read on a
 * mixed-run frame reports only the first character.
 */
function rangeSnapshot(document, target, expectedUuid) {
  if (!target || target.typename !== "TextFrame") {
    throw mutationError("preflight_failed", "Point-text operations support TextFrame targets only.");
  }
  if (target.kind !== TextType.POINTTEXT) {
    throw mutationError("preflight_failed", "Point-text operations support TextType.POINTTEXT only.");
  }
  if (typeof target.uuid !== "string" || target.uuid !== expectedUuid) {
    throw mutationError("preflight_failed", "Target native UUID is unavailable or changed.");
  }
  if (!target.layer || target.parent !== target.layer) {
    throw mutationError("preflight_failed", "Point-text target must be directly contained by its layer.");
  }
  if (!target.story || !target.story.textFrames ||
      target.story.textFrames.length !== 1 || target.story.textFrames[0] !== target) {
    throw mutationError("preflight_failed", "Point-text operations support unthreaded text only.");
  }
  if (typeof target.locked !== "boolean" || typeof target.hidden !== "boolean" ||
      typeof target.editable !== "boolean" || typeof target.layer.visible !== "boolean" ||
      typeof target.layer.locked !== "boolean") {
    throw mutationError("preflight_failed", "Target safety state is unavailable.");
  }
  var layerPath = pointTextLayerPath(document, target.layer);
  if (layerPath === null) throw mutationError("preflight_failed", "Target layer path is unavailable.");
  var textRange = target.textRange;
  if (!textRange || typeof textRange.length !== "number" || textRange.length < 1) {
    throw mutationError("preflight_failed", "Target native text-run state is unavailable.");
  }
  var justificationName = pointTextSupportedJustification(textRange.paragraphAttributes.justification);
  return {
    uuid: target.uuid,
    type: target.typename,
    kind: "TextType.POINTTEXT",
    profile: POINT_TEXT_PROFILE,
    frameShape: pointTextFrameShape(target),
    storyFrameCount: 1,
    manualKerning: "none",
    tabStopCount: pointTextParagraphState(textRange),
    justification: justificationName,
    characters: pointTextCharacterFingerprints(target),
    frame: pointTextFrameState(target),
    layerPath: layerPath,
    layerAncestry: pointTextAncestry(target),
    contents: pointTextValidateContents(target.contents, "Target contents"),
    locked: target.locked,
    hidden: target.hidden,
    editable: target.editable,
    layerVisible: target.layer.visible,
    layerLocked: target.layer.locked
  };
}

/** A character's style without its contents, so two characters can be compared for style equality. */
function rangeStyleKey(character) {
  var copy = {};
  for (var key in character) if (character.hasOwnProperty(key) && key !== "contents") copy[key] = character[key];
  return stringifyJson(copy);
}

function rangeSame(left, right) {
  return left && right && stringifyJson(left) === stringifyJson(right);
}

function rangeWrite(target, start, end, text) {
  var range = target.textRange;
  range.start = start;
  range.end = end;
  range.contents = text;
}

function rangeResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  var target = pointTextFind(document, params.targetUuid);
  if (target === null) {
    throw mutationError("preflight_failed", stringifyJson({ code: "OBJECT_NOT_FOUND", uuid: params.targetUuid }));
  }
  var before = rangeSnapshot(document, target, params.targetUuid);
  if (params.end > before.characters.length || params.start >= params.end) {
    throw mutationError("preflight_failed", "The requested point-text range is outside the target contents.");
  }
  // The inverse re-inherits the range-start style, so a range spanning several styles could not be
  // undone exactly. Outside the range, mixed styles remain supported.
  var firstStyle = rangeStyleKey(before.characters[params.start]);
  for (var styleIndex = params.start + 1; styleIndex < params.end; styleIndex++) {
    if (rangeStyleKey(before.characters[styleIndex]) !== firstStyle) {
      throw mutationError("preflight_failed",
        "Point-text range operations require one uniform character style inside the range.");
    }
  }
  var blockers = [];
  if (!context.mutationAllowed) blockers.push("document_mutation_not_allowed");
  if (before.locked) blockers.push("target_locked");
  if (before.hidden) blockers.push("target_hidden");
  if (!before.editable) blockers.push("target_not_editable");
  var ancestorHidden = false;
  var ancestorLocked = false;
  for (var index = 0; index < before.layerAncestry.length; index++) {
    if (!before.layerAncestry[index].visible) ancestorHidden = true;
    if (before.layerAncestry[index].locked) ancestorLocked = true;
  }
  if (ancestorHidden) blockers.push("layer_hidden");
  if (ancestorLocked) blockers.push("layer_locked");
  if (forApply && blockers.length > 0) {
    throw mutationBeforeSideEffectError(stringifyJson({ code: "TEXT_RANGE_APPLY_BLOCKED",
      reasonCodes: blockers, uuid: params.targetUuid }));
  }
  return { context: context, document: document, target: target, before: before, blockers: blockers };
}

function rangePreflight(forApply) {
  var resolved = rangeResolve(forApply);
  if (forApply) {
    if (!rangeSame(resolved.before, params.expectedBefore)) {
      throw mutationError("preflight_failed", "Target state does not match expected_before.");
    }
    if (!rangeSame(rangePredictAfter(resolved.before), params.confirmedAfter)) {
      throw mutationError("preflight_failed", "confirmed_after does not match the derived range replacement state.");
    }
  }
  return resolved;
}

/**
 * The predicted after state, derived from the before snapshot alone so that planning never writes.
 * Measured: characters outside the range are untouched and the inserted characters take the style of
 * the character that was at the range start.
 */
function rangePredictAfter(before) {
  var inherited = before.characters[params.start];
  var characters = [];
  for (var head = 0; head < params.start; head++) characters.push(before.characters[head]);
  for (var unit = 0; unit < params.replacement.length; unit++) {
    characters.push({
      contents: params.replacement.charAt(unit),
      font: { postScriptName: inherited.font.postScriptName, family: inherited.font.family,
        style: inherited.font.style },
      size: inherited.size, tracking: inherited.tracking,
      horizontalScale: inherited.horizontalScale, verticalScale: inherited.verticalScale,
      leading: inherited.leading,
      // Whatever explicit fill model the inherited character carries is inherited unchanged.
      fillColor: pointTextCopyFillColor(inherited.fillColor),
      strokeColor: { model: "none" }
    });
  }
  for (var tail = params.end; tail < before.characters.length; tail++) characters.push(before.characters[tail]);
  var contents = before.contents.substring(0, params.start) + params.replacement +
    before.contents.substring(params.end);
  var after = {};
  for (var key in before) if (before.hasOwnProperty(key)) after[key] = before[key];
  after.characters = characters;
  after.contents = contents;
  return after;
}

function rangePlan(preflight) {
  var removed = preflight.before.contents.substring(params.start, params.end);
  return {
    operation: "replace_text_range", documentKey: preflight.context.key, targetUuid: params.targetUuid,
    start: params.start, end: params.end, replacement: params.replacement, removed: removed,
    before: preflight.before,
    after: rangePredictAfter(preflight.before),
    applyBlockedReasonCodes: preflight.blockers,
    confirmationStatus: params.apply === true ? "confirmed" : "required",
    applyAllowed: params.apply === true && preflight.blockers.length === 0
  };
}

function rangeRevalidate(preflight, plan) {
  var current;
  try { current = rangeResolve(true); }
  catch (error) {
    throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Point-text range preconditions changed before apply."));
  }
  if (current.document !== preflight.document || current.target !== preflight.target ||
      !rangeSame(current.before, plan.before)) {
    throw mutationBeforeSideEffectError("Point-text target or contents changed before apply.");
  }
}

function rangeApply(preflight, plan, state) {
  state.operationState.mutationStarted = true;
  rangeWrite(preflight.target, params.start, params.end, params.replacement);
  return preflight.target;
}

function rangeVerify(preflight, plan) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) {
    throw mutationError("verify_mismatch", "Active document changed during point-text range verification.");
  }
  var target = pointTextFind(preflight.document, plan.before.uuid);
  if (target === null || target !== preflight.target) {
    throw mutationError("verify_mismatch", "Target native UUID no longer resolves to the same TextFrame.");
  }
  var actual = rangeSnapshot(preflight.document, target, params.targetUuid);
  if (!rangeSame(actual, plan.after)) {
    throw mutationError("verify_mismatch", "Point-text range postcondition does not match the confirmed after state.");
  }
  return actual;
}

function rangeRollback(state) {
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
    current = rangeSnapshot(preflight.document, target, params.targetUuid);
  } catch (error) { return { status: "indeterminate", message: "Rollback target state is indeterminate." }; }
  if (rangeSame(current, preflight.before)) {
    state.operationState.rollbackEvidence.restoredSnapshot = current;
    return { status: "verified" };
  }
  if (!rangeSame(current, rangePredictAfter(preflight.before))) {
    return { status: "indeterminate", message: "Rollback refused because target state is neither before nor confirmed after." };
  }
  // The inverse: put the removed substring back over the span the replacement now occupies. Measured,
  // the inserted text takes the first replaced character's style, which is the style the original text
  // there had, so the inverse restores the style along with the contents.
  var removedText = preflight.before.contents.substring(params.start, params.end);
  try { rangeWrite(target, params.start, params.start + params.replacement.length, removedText); }
  catch (writeError) { return { status: "indeterminate", message: "Rollback range write is indeterminate." }; }
  var restored;
  try { restored = rangeSnapshot(preflight.document, target, params.targetUuid); }
  catch (verifyError) { return { status: "indeterminate", message: "Rollback verification is indeterminate." }; }
  state.operationState.rollbackEvidence.restoredSnapshot = restored;
  return rangeSame(restored, preflight.before)
    ? { status: "verified" }
    : { status: "failed", message: "Rollback did not restore the exact before point-text state." };
}

var rangeExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionAffected: function () { return [params.targetUuid]; },
  initialOperationState: function () {
    return { mutationStarted: false, rollbackEvidence: { targetUuid: params.targetUuid, restoredSnapshot: null } };
  },
  preflight: rangePreflight,
  plan: rangePlan,
  revalidate: rangeRevalidate,
  applyMutation: rangeApply,
  verify: rangeVerify,
  rollback: rangeRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () {
    return { reasonCode: "text_state_unknown",
      message: "Point-text range apply outcome is indeterminate.",
      evidence: { targetUuid: params.targetUuid, restoredSnapshot: null } };
  },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var rangeDocument = rangeExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === rangeExecution.preflight.document) {
  rangeDocument = getDocumentContext();
}
var result = { operation: "replace_text_range",
  applied: rangeExecution.transaction.state === "verified",
  document: rangeDocument, plan: rangeExecution.plan, transaction: rangeExecution.transaction };
if (rangeExecution.transaction.state === "verified") result.postcondition = rangeExecution.value;
`;
export const REPLACE_TEXT_RANGE_HOST_SCRIPT_DIGEST = canonicalSha256(REPLACE_TEXT_RANGE_SCRIPT);
export const REPLACE_TEXT_RANGE_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: REPLACE_TEXT_RANGE_OPERATION,
    validator: REPLACE_TEXT_RANGE_VALIDATOR, canonicalContractVersion: CANONICAL_VERSION,
    resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: REPLACE_TEXT_RANGE_SAFETY_IDENTITY,
    hostScriptDigest: REPLACE_TEXT_RANGE_HOST_SCRIPT_DIGEST,
    mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    if (request.apply) {
        const rejection = checkTextRangeRequest(request.expectedBefore, request.start, request.end, request.replacement);
        if (rejection !== null) {
            throw new Error(`Point-text range request is unsupported: ${rangeRejectionSchema.parse(rejection.reason)}.`);
        }
    }
    const digestRequest = 'commandId' in request
        ? (({ commandId: _commandId, ...rest }) => rest)(request)
        : request;
    const digest = canonicalSha256({ operation: REPLACE_TEXT_RANGE_OPERATION,
        validator: REPLACE_TEXT_RANGE_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request,
        commandId: 'commandId' in request ? request.commandId : null,
        documentKey: request.expectedDocumentKey, digest };
}
export const replaceTextRangeToolContract = {
    name: 'illustrator_replace_text_range',
    title: 'Plan or Replace a Point-Text Range',
    description: 'Plan or replace one bounded UTF-16 range of a single-line layer-direct POINTTEXT frame, bound by '
        + 'explicit document key and native UUID. Mixed character styles are supported and every character outside the '
        + 'range keeps its exact contents and style. Ranges that would split a surrogate pair, a combining mark, a '
        + 'variation selector or an emoji sequence are refused, as are frames carrying manual pair kerning, contents '
        + 'containing U+200D, and scripts whose cluster rules are unmeasured. Apply performs exact compare-and-set over '
        + 'a per-character fingerprint, native read-back verification, and verified inverse rollback.',
    inputSchema,
    publicInputSchema: replaceTextRangePublicInputSchema,
    outputSchema: replaceTextRangeResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(REPLACE_TEXT_RANGE_SAFETY.policy),
    normalizePublicInput,
};
export function createReplaceTextRangeAdapter() {
    return {
        version: 1, operation: REPLACE_TEXT_RANGE_OPERATION, validator: REPLACE_TEXT_RANGE_VALIDATOR,
        safety: REPLACE_TEXT_RANGE_SAFETY, safetyRegistrationIdentity: REPLACE_TEXT_RANGE_SAFETY_IDENTITY,
        adapterIdentity: REPLACE_TEXT_RANGE_ADAPTER_IDENTITY, tool: replaceTextRangeToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest,
            safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: replaceTextRangeResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: CLASSIFIER_VERSION, safetyConformanceVersion: CONFORMANCE_VERSION,
        errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: REPLACE_TEXT_RANGE_HOST_SCRIPT_DIGEST,
        mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: REPLACE_TEXT_RANGE_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: REPLACE_TEXT_RANGE_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: REPLACE_TEXT_RANGE_OPERATION,
                    documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: REPLACE_TEXT_RANGE_ADAPTER_IDENTITY,
                mutationHostApplicationMode: 'foreground', script: REPLACE_TEXT_RANGE_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = replaceTextRangeResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back')
                return { state };
            if (state === 'planned')
                throw new Error('Point-text range plan is not a terminal mutation result.');
            throw new Error('Unverified point-text range recovery must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error, detail) {
            const lookupFailure = textLookupFailureError(error, detail);
            if (lookupFailure !== null)
                return lookupFailure;
            if (detail?.code === 'OBJECT_NOT_FOUND') {
                return new Error(`No PageItem with UUID ${JSON.stringify(detail.uuid ?? '')} exists in the bound document.`);
            }
            if (detail?.code === 'TEXT_RANGE_APPLY_BLOCKED') {
                return new Error(`Point-text range replacement is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}.`);
            }
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
