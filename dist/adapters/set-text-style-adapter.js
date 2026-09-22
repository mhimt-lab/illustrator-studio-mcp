import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { normalizePointTextPublicFillColor, POINT_TEXT_CHARACTER_SCRIPT, POINT_TEXT_SNAPSHOT_SCRIPT, pointTextFillColorRequestSchema, pointTextFillColorSchema, pointTextPublicFillColorSchema, pointTextRangeSnapshotSchema, } from './point-text-host-script.js';
import { validateClusterRange } from './point-text-cluster.js';
import { textLookupFailureError } from './text-lookup-error.js';
export const SET_TEXT_STYLE_OPERATION = 'set_text_style';
export const SET_TEXT_STYLE_VALIDATOR = { kind: SET_TEXT_STYLE_OPERATION, version: 1 };
const CANONICAL_VERSION = 3;
const RESULT_SCHEMA_VERSION = 3;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 2;
const requestedStyleSchema = z.strictObject({
    size: z.number().finite().positive().optional(),
    tracking: z.number().finite().optional(),
    horizontalScale: z.number().finite().positive().optional(),
    verticalScale: z.number().finite().positive().optional(),
    fillColor: pointTextFillColorSchema.optional(),
    fontPostScriptName: z.string().min(1).max(255).optional(),
});
const requestedStyleRequestSchema = z.strictObject({
    size: z.number().finite().positive().optional(),
    tracking: z.number().finite().optional(),
    horizontalScale: z.number().finite().positive().optional(),
    verticalScale: z.number().finite().positive().optional(),
    fillColor: pointTextFillColorRequestSchema.optional(),
    fontPostScriptName: z.string().min(1).max(255).optional(),
});
const publicStyleSchema = z.strictObject({
    size: z.number().finite().positive().optional(),
    tracking: z.number().finite().optional(),
    horizontal_scale: z.number().finite().positive().optional(),
    vertical_scale: z.number().finite().positive().optional(),
    fill_color: pointTextPublicFillColorSchema.optional(),
    font_post_script_name: z.string().min(1).max(255).optional(),
});
function assertRequestsAnAttribute(style) {
    if (!Object.values(style).some((value) => value !== undefined)) {
        throw new Error('A point-text style edit must request at least one attribute.');
    }
}
const blockerSchema = z.enum([
    'document_mutation_not_allowed',
    'target_locked',
    'target_hidden',
    'target_not_editable',
    'layer_hidden',
    'layer_locked',
]);
export const setTextStylePlanSchema = z.strictObject({
    operation: z.literal(SET_TEXT_STYLE_OPERATION),
    documentKey: z.string().min(1).max(16_384),
    targetUuid: z.string().min(1).max(255),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    style: requestedStyleSchema,
    before: pointTextRangeSnapshotSchema,
    after: pointTextRangeSnapshotSchema,
    applyBlockedReasonCodes: z.array(blockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    if (plan.start >= plan.end || plan.end > plan.before.characters.length) {
        context.addIssue({ code: 'custom', message: 'A point-text style range must be a non-empty span inside the target.' });
    }
    if (plan.targetUuid !== plan.before.uuid || plan.before.uuid !== plan.after.uuid) {
        context.addIssue({ code: 'custom', message: 'A point-text style plan must bind one target UUID.' });
    }
    if (plan.after.contents !== plan.before.contents) {
        context.addIssue({ code: 'custom', message: 'A point-text style edit must not change the contents.' });
    }
    if (plan.after.characters.length !== plan.before.characters.length) {
        context.addIssue({ code: 'custom', message: 'A point-text style edit must not change the character count.' });
    }
    for (let index = 0; index < plan.before.characters.length; index += 1) {
        if (index >= plan.start && index < plan.end)
            continue;
        if (canonicalSha256(plan.before.characters[index]) !==
            canonicalSha256(plan.after.characters[index])) {
            context.addIssue({ code: 'custom', message: 'A point-text style edit must leave every character outside the range unchanged.' });
            break;
        }
    }
    const mutableFields = new Set();
    if (plan.style.size !== undefined) {
        mutableFields.add('size');
        mutableFields.add('leading');
    }
    if (plan.style.tracking !== undefined)
        mutableFields.add('tracking');
    if (plan.style.horizontalScale !== undefined)
        mutableFields.add('horizontalScale');
    if (plan.style.verticalScale !== undefined)
        mutableFields.add('verticalScale');
    if (plan.style.fillColor !== undefined)
        mutableFields.add('fillColor');
    if (plan.style.fontPostScriptName !== undefined)
        mutableFields.add('font');
    for (let index = plan.start; index < plan.end; index += 1) {
        const beforeCharacter = plan.before.characters[index];
        const afterCharacter = plan.after.characters[index];
        for (const field of Object.keys(beforeCharacter)) {
            if (mutableFields.has(field))
                continue;
            if (canonicalSha256(beforeCharacter[field]) !==
                canonicalSha256(afterCharacter[field])) {
                context.addIssue({ code: 'custom', message: `A point-text style edit changed ${field}, which it did not request.` });
                break;
            }
        }
        if (plan.style.size !== undefined && afterCharacter.size !== plan.style.size) {
            context.addIssue({ code: 'custom', message: 'A point-text style plan must apply the requested size.' });
        }
        if (plan.style.fillColor !== undefined &&
            canonicalSha256(plan.style.fillColor) !==
                canonicalSha256(afterCharacter.fillColor)) {
            context.addIssue({ code: 'custom', message: 'A point-text style plan must apply the requested fill colour.' });
        }
        if (plan.style.fontPostScriptName !== undefined &&
            afterCharacter.font.postScriptName !== plan.style.fontPostScriptName) {
            context.addIssue({ code: 'custom', message: 'A point-text style plan must apply exactly the requested font.' });
        }
    }
    const allowed = plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0;
    if (plan.applyAllowed !== allowed) {
        context.addIssue({ code: 'custom', message: 'Point-text style applyAllowed must require confirmation and no blockers.' });
    }
});
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']),
    reasonCode: z.enum(['apply_failed', 'verify_mismatch']),
    message: z.string().min(1).max(500),
}).superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed')) {
        context.addIssue({ code: 'custom', message: 'Point-text style failure phase and reason code must match.' });
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
        context.addIssue({ code: 'custom', message: 'Point-text style audit sequence does not match transaction state.' });
    }
    transaction.audit.forEach((event, index) => {
        if (event.sequence !== index) {
            context.addIssue({ code: 'custom', message: 'Point-text style audit sequence must be contiguous.' });
        }
    });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' &&
            event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode &&
            event.message === transaction.failure.message);
        if (matches.length !== 1) {
            context.addIssue({ code: 'custom', message: 'Point-text style failure must match one audit event.' });
        }
    }
});
export const setTextStyleResultSchema = z.union([
    z.strictObject({
        operation: z.literal(SET_TEXT_STYLE_OPERATION), applied: z.literal(false),
        document: documentContextSchema, plan: setTextStylePlanSchema, transaction: transactionSchema,
    }),
    z.strictObject({
        operation: z.literal(SET_TEXT_STYLE_OPERATION), applied: z.literal(true),
        document: documentContextSchema, plan: setTextStylePlanSchema,
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
            context.addIssue({ code: 'custom', message: 'Planned point-text style edit must expose exact blockers.' });
        }
    }
    else if (result.plan.confirmationStatus !== 'confirmed' ||
        result.plan.applyBlockedReasonCodes.length !== 0 || !result.plan.applyAllowed) {
        context.addIssue({ code: 'custom', message: 'Applied point-text style edit must derive from an allowed confirmed plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified' ||
            canonicalSha256(result.postcondition) !==
                canonicalSha256(result.plan.after)) {
            context.addIssue({ code: 'custom', message: 'A verified point-text style edit must match the exact after snapshot.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified point-text style transaction must be applied.' });
    }
    if (result.transaction.state === 'rolled_back' &&
        canonicalSha256(result.transaction.rollback.restoredSnapshot) !==
            canonicalSha256(result.plan.before)) {
        context.addIssue({ code: 'custom', message: 'A rolled-back point-text style edit must prove exact before restoration.' });
    }
});
export const setTextStyleResponseSchema = z.strictObject({
    outcome: setTextStyleResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
const commonInternal = {
    expectedDocumentKey: z.string().min(1).max(16_384),
    targetUuid: z.string().min(1).max(255),
    start: z.number().int().safe().nonnegative(),
    end: z.number().int().safe().nonnegative(),
    style: requestedStyleRequestSchema,
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
    style: publicStyleSchema,
};
export const setTextStylePublicInputSchema = z.discriminatedUnion('apply', [
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
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(setTextStylePublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = setTextStylePublicInputSchema.parse(input);
    const style = {
        ...(value.style.size === undefined ? {} : { size: value.style.size }),
        ...(value.style.tracking === undefined ? {} : { tracking: value.style.tracking }),
        ...(value.style.horizontal_scale === undefined ? {} : { horizontalScale: value.style.horizontal_scale }),
        ...(value.style.vertical_scale === undefined ? {} : { verticalScale: value.style.vertical_scale }),
        ...(value.style.fill_color === undefined
            ? {} : { fillColor: normalizePointTextPublicFillColor(value.style.fill_color) }),
        ...(value.style.font_post_script_name === undefined
            ? {} : { fontPostScriptName: value.style.font_post_script_name }),
    };
    assertRequestsAnAttribute(style);
    const common = {
        expectedDocumentKey: value.expected_document_key,
        targetUuid: value.target_uuid,
        start: value.start,
        end: value.end,
        style,
    };
    return value.apply
        ? { ...common, expectedBefore: value.expected_before, confirmedAfter: value.confirmed_after,
            apply: true, commandId: value.command_id }
        : { ...common, apply: false };
}
export function checkTextStyleRequest(before, start, end) {
    return validateClusterRange(before.contents, start, end);
}
export const SET_TEXT_STYLE_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: SET_TEXT_STYLE_OPERATION,
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
export const SET_TEXT_STYLE_SAFETY_IDENTITY = canonicalDigest(SET_TEXT_STYLE_SAFETY);
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    const beforeStateHash = canonicalDigest(result.plan.before);
    const afterStateHash = canonicalDigest(result.plan.after);
    const changeSetHash = canonicalDigest({ targetUuid: result.plan.targetUuid, start: result.plan.start,
        end: result.plan.end, style: result.plan.style, beforeStateHash, afterStateHash });
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'update_existing', operationId: SET_TEXT_STYLE_OPERATION,
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
        throw new Error('Indeterminate or failed point-text style recovery cannot be terminal.');
    }
    const common = { policyVersion: 1, operationClass: 'update_existing',
        operationId: SET_TEXT_STYLE_OPERATION, canonicalRequestDigest: requestDigest,
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
    const result = setTextStyleResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null) {
        throw new Error('Point-text style terminal result requires attestation.');
    }
    await assertOperationSafetyAdapterConformance({ registration: SET_TEXT_STYLE_SAFETY, plan,
        result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
export const SET_TEXT_STYLE_MODULE_SCRIPT = `/** Same range snapshot the range-replacement operation binds: the complete per-character fingerprint. */
function styleSnapshot(document, target, expectedUuid) {
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

function styleSame(left, right) {
  return left && right && stringifyJson(left) === stringifyJson(right);
}

/** The auto-leading amount as a fraction, read from the paragraph the profile pins at 175%. */
function styleAutoLeadingFactor(target) {
  var amount = target.textRange.paragraphAttributes.autoLeadingAmount;
  return mutationFiniteNumber(amount, "paragraphAttributes.autoLeadingAmount") / 100;
}

/**
 * The predicted after state. Only the requested fields move, only inside the range, plus \`leading\`
 * when \`size\` was requested — measured, auto leading derives it from the size.
 */
function stylePredictAfter(target, before) {
  var factor = styleAutoLeadingFactor(target);
  var characters = [];
  for (var index = 0; index < before.characters.length; index++) {
    var source = before.characters[index];
    if (index < params.start || index >= params.end) { characters.push(source); continue; }
    var next = {};
    for (var key in source) if (source.hasOwnProperty(key)) next[key] = source[key];
    if (params.style.size !== undefined) {
      next.size = params.style.size;
      next.leading = params.style.size * factor;
    }
    if (params.style.tracking !== undefined) next.tracking = params.style.tracking;
    if (params.style.horizontalScale !== undefined) next.horizontalScale = params.style.horizontalScale;
    if (params.style.verticalScale !== undefined) next.verticalScale = params.style.verticalScale;
    if (params.style.fillColor !== undefined) next.fillColor = params.style.fillColor;
    if (params.style.fontPostScriptName !== undefined) {
      var font = styleFont();
      next.font = { postScriptName: font.name, family: font.family, style: font.style };
    }
    characters.push(next);
  }
  var after = {};
  for (var field in before) if (before.hasOwnProperty(field)) after[field] = before[field];
  after.characters = characters;
  return after;
}

function styleFont() {
  var font;
  try { font = app.textFonts.getByName(params.style.fontPostScriptName); }
  catch (fontError) { font = null; }
  if (font === null || font === undefined) {
    throw mutationError("preflight_failed", "The requested font is not installed.");
  }
  return font;
}

function styleResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  var target = pointTextFind(document, params.targetUuid);
  if (target === null) {
    throw mutationError("preflight_failed", stringifyJson({ code: "OBJECT_NOT_FOUND", uuid: params.targetUuid }));
  }
  var before = styleSnapshot(document, target, params.targetUuid);
  if (params.end > before.characters.length || params.start >= params.end) {
    throw mutationError("preflight_failed", "The requested point-text range is outside the target contents.");
  }
  if (params.style.fontPostScriptName !== undefined) styleFont();
  // A requested fill must belong to this document's color space; nothing is implicitly converted.
  if (params.style.fillColor !== undefined) {
    pointTextAssertFillCompatible(params.style.fillColor, pointTextDocumentColorSpace(document));
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
    throw mutationBeforeSideEffectError(stringifyJson({ code: "TEXT_STYLE_APPLY_BLOCKED",
      reasonCodes: blockers, uuid: params.targetUuid }));
  }
  return { context: context, document: document, target: target, before: before, blockers: blockers };
}

function stylePreflight(forApply) {
  var resolved = styleResolve(forApply);
  if (forApply) {
    if (!styleSame(resolved.before, params.expectedBefore)) {
      throw mutationError("preflight_failed", "Target state does not match expected_before.");
    }
    if (!styleSame(stylePredictAfter(resolved.target, resolved.before), params.confirmedAfter)) {
      throw mutationError("preflight_failed", "confirmed_after does not match the derived style state.");
    }
  }
  return resolved;
}

function stylePlan(preflight) {
  return {
    operation: "set_text_style", documentKey: preflight.context.key, targetUuid: params.targetUuid,
    start: params.start, end: params.end, style: params.style,
    before: preflight.before,
    after: stylePredictAfter(preflight.target, preflight.before),
    applyBlockedReasonCodes: preflight.blockers,
    confirmationStatus: params.apply === true ? "confirmed" : "required",
    applyAllowed: params.apply === true && preflight.blockers.length === 0
  };
}

function styleRevalidate(preflight, plan) {
  var current;
  try { current = styleResolve(true); }
  catch (error) {
    throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Point-text style preconditions changed before apply."));
  }
  if (current.document !== preflight.document || current.target !== preflight.target ||
      !styleSame(current.before, plan.before)) {
    throw mutationBeforeSideEffectError("Point-text target or contents changed before apply.");
  }
}

/** Writes the requested fields character by character, so a mixed range is handled uniformly. */
function styleWrite(target, start, end, values) {
  for (var index = start; index < end; index++) {
    // The character must be held: taking .characterAttributes off a temporary releases it and every
    // later read from that handle fails with error 9503.
    var character = target.characters[index];
    var attributes = character.characterAttributes;
    if (values.size !== undefined) attributes.size = values.size;
    if (values.tracking !== undefined) attributes.tracking = values.tracking;
    if (values.horizontalScale !== undefined) attributes.horizontalScale = values.horizontalScale;
    if (values.verticalScale !== undefined) attributes.verticalScale = values.verticalScale;
    if (values.fillColor !== undefined) attributes.fillColor = pointTextNativeFillColor(values.fillColor);
    if (values.fontPostScriptName !== undefined) {
      attributes.textFont = app.textFonts.getByName(values.fontPostScriptName);
    }
  }
}

function styleApply(preflight, plan, state) {
  state.operationState.mutationStarted = true;
  styleWrite(preflight.target, params.start, params.end, params.style);
  return preflight.target;
}

function styleVerify(preflight, plan) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) {
    throw mutationError("verify_mismatch", "Active document changed during point-text style verification.");
  }
  var target = pointTextFind(preflight.document, plan.before.uuid);
  if (target === null || target !== preflight.target) {
    throw mutationError("verify_mismatch", "Target native UUID no longer resolves to the same TextFrame.");
  }
  var actual = styleSnapshot(preflight.document, target, params.targetUuid);
  if (!styleSame(actual, plan.after)) {
    throw mutationError("verify_mismatch", "Point-text style postcondition does not match the plan.");
  }
  return actual;
}

/** The inverse writes each character's own original values back, so a mixed range is restored exactly. */
function styleRestore(target, before) {
  for (var index = params.start; index < params.end; index++) {
    var source = before.characters[index];
    var character = target.characters[index];
    var attributes = character.characterAttributes;
    attributes.size = source.size;
    attributes.tracking = source.tracking;
    attributes.horizontalScale = source.horizontalScale;
    attributes.verticalScale = source.verticalScale;
    // The inverse restores the character's own paint, whatever explicit model it carried.
    attributes.fillColor = pointTextNativeFillColor(source.fillColor);
    attributes.textFont = app.textFonts.getByName(source.font.postScriptName);
  }
}

function styleRollback(state) {
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
    current = styleSnapshot(preflight.document, target, params.targetUuid);
  } catch (error) { return { status: "indeterminate", message: "Rollback target state is indeterminate." }; }
  if (styleSame(current, preflight.before)) {
    state.operationState.rollbackEvidence.restoredSnapshot = current;
    return { status: "verified" };
  }
  if (!styleSame(current, stylePredictAfter(target, preflight.before))) {
    return { status: "indeterminate", message: "Rollback refused because target state is neither before nor planned after." };
  }
  try { styleRestore(target, preflight.before); }
  catch (writeError) { return { status: "indeterminate", message: "Rollback style write is indeterminate." }; }
  var restored;
  try { restored = styleSnapshot(preflight.document, target, params.targetUuid); }
  catch (verifyError) { return { status: "indeterminate", message: "Rollback verification is indeterminate." }; }
  state.operationState.rollbackEvidence.restoredSnapshot = restored;
  return styleSame(restored, preflight.before)
    ? { status: "verified" }
    : { status: "failed", message: "Rollback did not restore the exact before point-text state." };
}

`;
export const SET_TEXT_STYLE_RUNNER_SCRIPT = `var styleExecution = runMutationTransaction({
  apply: params.apply === true,
  // the items this change reads and writes, so an edit session can advance its item aggregate.
  editSessionAffected: function () { return [params.targetUuid]; },
  initialOperationState: function () {
    return { mutationStarted: false, rollbackEvidence: { targetUuid: params.targetUuid, restoredSnapshot: null } };
  },
  preflight: stylePreflight,
  plan: stylePlan,
  revalidate: styleRevalidate,
  applyMutation: styleApply,
  verify: styleVerify,
  rollback: styleRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () {
    return { reasonCode: "text_state_unknown",
      message: "Point-text style apply outcome is indeterminate.",
      evidence: { targetUuid: params.targetUuid, restoredSnapshot: null } };
  },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var styleDocument = styleExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === styleExecution.preflight.document) {
  styleDocument = getDocumentContext();
}
var result = { operation: "set_text_style",
  applied: styleExecution.transaction.state === "verified",
  document: styleDocument, plan: styleExecution.plan, transaction: styleExecution.transaction };
if (styleExecution.transaction.state === "verified") result.postcondition = styleExecution.value;
`;
export const SET_TEXT_STYLE_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${POINT_TEXT_SNAPSHOT_SCRIPT}
${POINT_TEXT_CHARACTER_SCRIPT}

${SET_TEXT_STYLE_MODULE_SCRIPT}${SET_TEXT_STYLE_RUNNER_SCRIPT}`;
export const SET_TEXT_STYLE_HOST_SCRIPT_DIGEST = canonicalSha256(SET_TEXT_STYLE_SCRIPT);
export const SET_TEXT_STYLE_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: SET_TEXT_STYLE_OPERATION,
    validator: SET_TEXT_STYLE_VALIDATOR, canonicalContractVersion: CANONICAL_VERSION,
    resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: SET_TEXT_STYLE_SAFETY_IDENTITY, hostScriptDigest: SET_TEXT_STYLE_HOST_SCRIPT_DIGEST,
    mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    assertRequestsAnAttribute(request.style);
    if (request.apply) {
        const rejection = checkTextStyleRequest(request.expectedBefore, request.start, request.end);
        if (rejection !== null) {
            throw new Error(`Point-text style request is unsupported: ${rejection.reason}.`);
        }
    }
    const digestRequest = 'commandId' in request
        ? (({ commandId: _commandId, ...rest }) => rest)(request)
        : request;
    const digest = canonicalSha256({ operation: SET_TEXT_STYLE_OPERATION,
        validator: SET_TEXT_STYLE_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request,
        commandId: 'commandId' in request ? request.commandId : null,
        documentKey: request.expectedDocumentKey, digest };
}
export const setTextStyleToolContract = {
    name: 'illustrator_set_text_style',
    title: 'Plan or Set Point-Text Character Style',
    description: 'Plan or apply measured character attributes — size, tracking, horizontal and vertical scale, '
        + 'explicit fill (RGB `{red, green, blue}`, CMYK `{model: "cmyk", cyan, magenta, yellow, black}` or Gray '
        + '`{model: "gray", gray}`; RGB only in an RGB document, CMYK only in a CMYK document, Gray in either, '
        + 'and a mismatch is refused rather than converted) and installed font — to a bounded UTF-16 range of a single-line '
        + 'layer-direct POINTTEXT frame, bound by explicit document key and native UUID. Everything outside the '
        + 'range and every attribute that was not requested stay unchanged; `leading` follows `size` because auto '
        + 'leading derives it. Ranges that would split a character are refused, as are frames carrying manual pair '
        + 'kerning. Apply performs exact compare-and-set over a per-character fingerprint, native read-back '
        + 'verification, and a per-character verified inverse.',
    inputSchema,
    publicInputSchema: setTextStylePublicInputSchema,
    outputSchema: setTextStyleResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(SET_TEXT_STYLE_SAFETY.policy),
    normalizePublicInput,
};
export function createSetTextStyleAdapter() {
    return {
        version: 1, operation: SET_TEXT_STYLE_OPERATION, validator: SET_TEXT_STYLE_VALIDATOR,
        safety: SET_TEXT_STYLE_SAFETY, safetyRegistrationIdentity: SET_TEXT_STYLE_SAFETY_IDENTITY,
        adapterIdentity: SET_TEXT_STYLE_ADAPTER_IDENTITY, tool: setTextStyleToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest,
            safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: setTextStyleResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: CLASSIFIER_VERSION, safetyConformanceVersion: CONFORMANCE_VERSION,
        errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: SET_TEXT_STYLE_HOST_SCRIPT_DIGEST,
        mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: SET_TEXT_STYLE_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: SET_TEXT_STYLE_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: SET_TEXT_STYLE_OPERATION,
                    documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: SET_TEXT_STYLE_ADAPTER_IDENTITY,
                mutationHostApplicationMode: 'foreground', script: SET_TEXT_STYLE_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = setTextStyleResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back')
                return { state };
            if (state === 'planned')
                throw new Error('Point-text style plan is not a terminal mutation result.');
            throw new Error('Unverified point-text style recovery must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error, detail) {
            const lookupFailure = textLookupFailureError(error, detail);
            if (lookupFailure !== null)
                return lookupFailure;
            if (detail?.code === 'OBJECT_NOT_FOUND') {
                return new Error(`No PageItem with UUID ${JSON.stringify(detail.uuid ?? '')} exists in the bound document.`);
            }
            if (detail?.code === 'TEXT_STYLE_APPLY_BLOCKED') {
                return new Error(`Point-text style edit is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}.`);
            }
            if (detail?.code === 'POINT_TEXT_COLOR_SPACE_MISMATCH') {
                return new Error(`A ${detail.requestedModel ?? 'unknown'} fill cannot be written to a `
                    + `${detail.documentColorSpace ?? 'unknown'} document; implicit color-space conversion is refused.`);
            }
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
