import { z } from 'zod';
import { canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { POINT_TEXT_CHARACTER_SCRIPT, POINT_TEXT_MAX_CODE_UNITS, POINT_TEXT_SNAPSHOT_SCRIPT, pointTextFillColorSchema, pointTextRangeSnapshotSchema, } from './point-text-host-script.js';
import { validateClusterRange } from './point-text-cluster.js';
import { characterStyleEntrySchema, TEXT_STYLE_MAX_NAME_LENGTH, TEXT_STYLE_RESOURCE_SCRIPT, } from '../text-style-resources.js';
import { textLookupFailureError } from './text-lookup-error.js';
export const APPLY_CHARACTER_STYLE_OPERATION = 'apply_character_style';
export const APPLY_CHARACTER_STYLE_VALIDATOR = { kind: APPLY_CHARACTER_STYLE_OPERATION, version: 1 };
const CANONICAL_VERSION = 2;
const RESULT_SCHEMA_VERSION = 4;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 4;
const styleNameSchema = z.string().min(1).max(TEXT_STYLE_MAX_NAME_LENGTH);
export const characterStyleSnapshotSchema = pointTextRangeSnapshotSchema.extend({
    appliedCharacterStyles: z.array(styleNameSchema).min(1).max(POINT_TEXT_MAX_CODE_UNITS),
}).superRefine((snapshot, context) => {
    if (snapshot.appliedCharacterStyles.length !== snapshot.characters.length) {
        context.addIssue({ code: 'custom', message: 'Every character must report exactly one applied character style.' });
    }
});
const blockerSchema = z.enum([
    'document_mutation_not_allowed',
    'target_locked',
    'target_hidden',
    'target_not_editable',
    'layer_hidden',
    'layer_locked',
]);
const MOVABLE_BY_STYLE_ATTRIBUTE = {
    textFont: ['font'],
    size: ['size', 'leading'],
    tracking: ['tracking'],
    horizontalScale: ['horizontalScale'],
    verticalScale: ['verticalScale'],
};
function definedStyleValue(style, attribute) {
    const reading = style.attributes[attribute];
    return reading !== undefined && reading.status === 'defined' ? reading.value : null;
}
function isMeasuredBlack(character) {
    const fill = character.fillColor;
    return fill.model === 'rgb' && fill.red === 0 && fill.green === 0 && fill.blue === 0;
}
function fillUnchangedByUndefinedStyle(character, defaultStyleFill) {
    if (isMeasuredBlack(character))
        return true;
    return defaultStyleFill !== null && defaultStyleFill.model === 'cmyk' && character.fillColor.model === 'cmyk' &&
        canonicalSha256(character.fillColor) ===
            canonicalSha256(defaultStyleFill);
}
export function movableSnapshotFields(style) {
    const movable = new Set();
    for (const [attribute, snapshotFields] of Object.entries(MOVABLE_BY_STYLE_ATTRIBUTE)) {
        if (definedStyleValue(style, attribute) === null)
            continue;
        for (const field of snapshotFields)
            movable.add(field);
    }
    return movable;
}
export const applyCharacterStylePlanSchema = z.strictObject({
    operation: z.literal(APPLY_CHARACTER_STYLE_OPERATION),
    documentKey: z.string().min(1).max(16_384),
    targetUuid: z.string().min(1).max(255),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    styleName: styleNameSchema,
    style: characterStyleEntrySchema,
    before: characterStyleSnapshotSchema,
    after: characterStyleSnapshotSchema,
    defaultStyleFill: pointTextFillColorSchema.nullable(),
    applyBlockedReasonCodes: z.array(blockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    if (plan.start >= plan.end || plan.end > plan.before.characters.length) {
        context.addIssue({ code: 'custom', message: 'A character-style range must be a non-empty span inside the target.' });
    }
    if (plan.targetUuid !== plan.before.uuid || plan.before.uuid !== plan.after.uuid) {
        context.addIssue({ code: 'custom', message: 'A character-style plan must bind one target UUID.' });
    }
    if (plan.style.name !== plan.styleName || plan.style.duplicateName) {
        context.addIssue({ code: 'custom', message: 'A character-style plan must bind one uniquely named style.' });
    }
    if (plan.after.contents !== plan.before.contents ||
        plan.after.characters.length !== plan.before.characters.length) {
        context.addIssue({ code: 'custom', message: 'Applying a character style must not change the contents.' });
    }
    for (let index = 0; index < plan.before.appliedCharacterStyles.length; index += 1) {
        const expected = index >= plan.start && index < plan.end ? plan.styleName : plan.before.appliedCharacterStyles[index];
        if (plan.after.appliedCharacterStyles[index] !== expected) {
            context.addIssue({ code: 'custom', message: 'A character-style plan must assign the style to exactly the range.' });
            break;
        }
    }
    for (let index = 0; index < plan.before.characters.length; index += 1) {
        if (index >= plan.start && index < plan.end)
            continue;
        if (canonicalSha256(plan.before.characters[index]) !==
            canonicalSha256(plan.after.characters[index])) {
            context.addIssue({ code: 'custom', message: 'Applying a character style must leave every character outside the range unchanged.' });
            break;
        }
    }
    const movable = movableSnapshotFields(plan.style);
    const font = definedStyleValue(plan.style, 'textFont');
    const size = definedStyleValue(plan.style, 'size');
    const tracking = definedStyleValue(plan.style, 'tracking');
    const horizontalScale = definedStyleValue(plan.style, 'horizontalScale');
    const verticalScale = definedStyleValue(plan.style, 'verticalScale');
    const fill = definedStyleValue(plan.style, 'fillColor');
    if (fill !== null && fill !== 'none') {
        context.addIssue({ code: 'custom', message: 'A character style that defines a fill is unsupported.' });
    }
    const range = plan.before.characters.slice(plan.start, plan.end);
    if (fill === 'none' &&
        !range.every((character) => fillUnchangedByUndefinedStyle(character, plan.defaultStyleFill))) {
        context.addIssue({ code: 'custom', message: 'A fill-undefined character style is measured only on text filled '
                + 'rgb(0,0,0), or on CMYK text whose fill equals the default character style fill.' });
    }
    if (plan.defaultStyleFill !== null &&
        (fill !== 'none' || plan.defaultStyleFill.model !== 'cmyk' || !range.some((character) => character.fillColor.model === 'cmyk'))) {
        context.addIssue({ code: 'custom', message: 'A default character style fill is bound only for a fill-undefined style on CMYK text.' });
    }
    for (let index = plan.start; index < plan.end; index += 1) {
        const beforeCharacter = plan.before.characters[index];
        const afterCharacter = plan.after.characters[index];
        for (const field of Object.keys(beforeCharacter)) {
            if (movable.has(field))
                continue;
            if (canonicalSha256(beforeCharacter[field]) !==
                canonicalSha256(afterCharacter[field])) {
                context.addIssue({ code: 'custom', message: `Applying a character style changed ${field}, which the style does not define.` });
                break;
            }
        }
        if (font !== null && `font:${afterCharacter.font.postScriptName}` !== font) {
            context.addIssue({ code: 'custom', message: 'A character-style plan must apply the style font.' });
        }
        if (size !== null && String(afterCharacter.size) !== size) {
            context.addIssue({ code: 'custom', message: 'A character-style plan must apply the style size.' });
        }
        if (tracking !== null && String(afterCharacter.tracking) !== tracking) {
            context.addIssue({ code: 'custom', message: 'A character-style plan must apply the style tracking.' });
        }
        if (horizontalScale !== null && String(afterCharacter.horizontalScale) !== horizontalScale) {
            context.addIssue({ code: 'custom', message: 'A character-style plan must apply the style horizontal scale.' });
        }
        if (verticalScale !== null && String(afterCharacter.verticalScale) !== verticalScale) {
            context.addIssue({ code: 'custom', message: 'A character-style plan must apply the style vertical scale.' });
        }
    }
    const allowed = plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0;
    if (plan.applyAllowed !== allowed) {
        context.addIssue({ code: 'custom', message: 'Character-style applyAllowed must require confirmation and no blockers.' });
    }
});
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']),
    reasonCode: z.enum(['apply_failed', 'verify_mismatch']),
    message: z.string().min(1).max(500),
}).superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed')) {
        context.addIssue({ code: 'custom', message: 'Character-style failure phase and reason code must match.' });
    }
});
const indeterminateFailureSchema = z.strictObject({
    phase: z.literal('apply'),
    reasonCode: z.literal('apply_indeterminate'),
    message: z.string().min(1).max(500),
});
const rollbackEvidence = {
    targetUuid: z.string().min(1).max(255),
    restoredSnapshot: characterStyleSnapshotSchema.nullable(),
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
        context.addIssue({ code: 'custom', message: 'Character-style audit sequence does not match transaction state.' });
    }
    transaction.audit.forEach((event, index) => {
        if (event.sequence !== index) {
            context.addIssue({ code: 'custom', message: 'Character-style audit sequence must be contiguous.' });
        }
    });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' &&
            event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode &&
            event.message === transaction.failure.message);
        if (matches.length !== 1) {
            context.addIssue({ code: 'custom', message: 'Character-style failure must match one audit event.' });
        }
    }
});
export const applyCharacterStyleResultSchema = z.union([
    z.strictObject({
        operation: z.literal(APPLY_CHARACTER_STYLE_OPERATION), applied: z.literal(false),
        document: documentContextSchema, plan: applyCharacterStylePlanSchema, transaction: transactionSchema,
    }),
    z.strictObject({
        operation: z.literal(APPLY_CHARACTER_STYLE_OPERATION), applied: z.literal(true),
        document: documentContextSchema, plan: applyCharacterStylePlanSchema,
        postcondition: characterStyleSnapshotSchema, transaction: transactionSchema,
    }),
]).superRefine((result, context) => {
    if (result.plan.defaultStyleFill !== null && result.document.colorSpace !== 'CMYK') {
        context.addIssue({ code: 'custom', message: 'CMYK character-style application is measured in a CMYK document only.' });
    }
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
            context.addIssue({ code: 'custom', message: 'A planned character-style application must expose exact blockers.' });
        }
    }
    else if (result.plan.confirmationStatus !== 'confirmed' ||
        result.plan.applyBlockedReasonCodes.length !== 0 || !result.plan.applyAllowed) {
        context.addIssue({ code: 'custom', message: 'An applied character style must derive from an allowed confirmed plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified' ||
            canonicalSha256(result.postcondition) !==
                canonicalSha256(result.plan.after)) {
            context.addIssue({ code: 'custom', message: 'A verified character-style application must match the exact after snapshot.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified character-style transaction must be applied.' });
    }
    if (result.transaction.state === 'rolled_back' &&
        canonicalSha256(result.transaction.rollback.restoredSnapshot) !==
            canonicalSha256(result.plan.before)) {
        context.addIssue({ code: 'custom', message: 'A rolled-back character-style application must prove exact before restoration.' });
    }
});
export const applyCharacterStyleResponseSchema = z.strictObject({
    outcome: applyCharacterStyleResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
const commonInternal = {
    expectedDocumentKey: z.string().min(1).max(16_384),
    targetUuid: z.string().min(1).max(255),
    start: z.number().int().safe().nonnegative(),
    end: z.number().int().safe().nonnegative(),
    styleName: styleNameSchema,
};
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({
        ...commonInternal,
        expectedBefore: characterStyleSnapshotSchema,
        expectedStyle: characterStyleEntrySchema,
        confirmedAfter: characterStyleSnapshotSchema,
        apply: z.literal(true),
        commandId: canonicalCommandIdSchema,
    }),
]);
const commonPublic = {
    expected_document_key: z.string().min(1).max(16_384),
    target_uuid: z.string().min(1).max(255),
    start: z.number().int().safe().nonnegative(),
    end: z.number().int().safe().nonnegative(),
    style_name: styleNameSchema,
};
export const applyCharacterStylePublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({
        ...commonPublic,
        expected_before: characterStyleSnapshotSchema,
        expected_style: characterStyleEntrySchema,
        confirmed_after: characterStyleSnapshotSchema,
        apply: z.literal(true),
        command_id: canonicalCommandIdSchema,
    }),
]);
const inputSchema = z.strictObject({
    ...commonPublic,
    expected_before: characterStyleSnapshotSchema.optional(),
    expected_style: characterStyleEntrySchema.optional(),
    confirmed_after: characterStyleSnapshotSchema.optional(),
    apply: z.boolean().default(false),
    command_id: canonicalCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(applyCharacterStylePublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = applyCharacterStylePublicInputSchema.parse(input);
    const common = {
        expectedDocumentKey: value.expected_document_key,
        targetUuid: value.target_uuid,
        start: value.start,
        end: value.end,
        styleName: value.style_name,
    };
    return value.apply
        ? { ...common, expectedBefore: value.expected_before, expectedStyle: value.expected_style,
            confirmedAfter: value.confirmed_after, apply: true, commandId: value.command_id }
        : { ...common, apply: false };
}
export const APPLY_CHARACTER_STYLE_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: APPLY_CHARACTER_STYLE_OPERATION,
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
export const APPLY_CHARACTER_STYLE_SAFETY_IDENTITY = canonicalDigest(APPLY_CHARACTER_STYLE_SAFETY);
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    const beforeStateHash = canonicalDigest(result.plan.before);
    const afterStateHash = canonicalDigest(result.plan.after);
    const changeSetHash = canonicalDigest({ targetUuid: result.plan.targetUuid, start: result.plan.start,
        end: result.plan.end, styleName: result.plan.styleName, style: canonicalDigest(result.plan.style),
        beforeStateHash, afterStateHash });
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'update_existing', operationId: APPLY_CHARACTER_STYLE_OPERATION,
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
        throw new Error('Indeterminate or failed character-style recovery cannot be terminal.');
    }
    const common = { policyVersion: 1, operationClass: 'update_existing',
        operationId: APPLY_CHARACTER_STYLE_OPERATION, canonicalRequestDigest: requestDigest,
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
    const result = applyCharacterStyleResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null) {
        throw new Error('Character-style terminal result requires attestation.');
    }
    await assertOperationSafetyAdapterConformance({ registration: APPLY_CHARACTER_STYLE_SAFETY, plan,
        result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
export const APPLY_CHARACTER_STYLE_MODULE_SCRIPT = `/** The same complete per-character range snapshot the other bounded text operations bind. */
function charStyleSnapshot(document, target, expectedUuid) {
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
  return {
    uuid: target.uuid,
    type: target.typename,
    kind: "TextType.POINTTEXT",
    profile: POINT_TEXT_PROFILE,
    frameShape: pointTextFrameShape(target),
    storyFrameCount: 1,
    manualKerning: "none",
    tabStopCount: pointTextParagraphState(textRange),
    justification: pointTextSupportedJustification(textRange.paragraphAttributes.justification),
    characters: pointTextCharacterFingerprints(target),
    frame: pointTextFrameState(target),
    layerPath: layerPath,
    layerAncestry: pointTextAncestry(target),
    contents: pointTextValidateContents(target.contents, "Target contents"),
    locked: target.locked,
    hidden: target.hidden,
    editable: target.editable,
    layerVisible: target.layer.visible,
    layerLocked: target.layer.locked,
    appliedCharacterStyles: charStyleAppliedNames(target)
  };
}

/**
 * The one named character style each character reports as applied (\`applyTo\` moves it and writing the
 * values back does not). A character that reports none, several, or an unreadable style is outside the profile.
 */
function charStyleAppliedNames(target) {
  var characters = target.characters;
  var names = [];
  for (var index = 0; index < characters.length; index++) {
    var character = characters[index];
    var name = null;
    try {
      var applied = character.characterStyles;
      if (applied && applied.length === 1) { var style = applied[0]; name = String(style.name); }
    } catch (appliedError) { name = null; }
    if (name === null || name.length === 0) {
      throw mutationError("preflight_failed", stringifyJson({ code: "CHARACTER_STYLE_UNSUPPORTED",
        reason: "applied_style_unreadable", field: "characterStyles", name: params.styleName }));
    }
    names.push(name);
  }
  return names;
}

/** The first path where two canonical values differ, so a verification failure names what moved. */
function charStyleFirstMismatch(left, right, path) {
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return charStyleCanonicalJson(left) === charStyleCanonicalJson(right) ? null : path;
  }
  if ((left instanceof Array) !== (right instanceof Array)) return path;
  var keys = [];
  var key;
  for (key in left) if (left.hasOwnProperty(key)) keys.push(key);
  for (key in right) if (right.hasOwnProperty(key) && !left.hasOwnProperty(key)) keys.push(key);
  keys.sort();
  for (var index = 0; index < keys.length; index++) {
    var child = left instanceof Array ? path + "[" + keys[index] + "]" : path + "." + keys[index];
    var mismatch = charStyleFirstMismatch(left[keys[index]], right[keys[index]], child);
    if (mismatch !== null) return mismatch;
  }
  return null;
}

/**
 * Key-order-independent JSON: an echo comes back through the public schema, which orders keys its own
 * way (a style entry leads with \`index\`, the host builds it with \`kind\` first).
 */
function charStyleCanonicalJson(value) {
  if (value === null || typeof value !== "object") return stringifyJson(value);
  if (value instanceof Array) {
    var items = [];
    for (var index = 0; index < value.length; index++) items.push(charStyleCanonicalJson(value[index]));
    return "[" + items.join(",") + "]";
  }
  var keys = [];
  for (var key in value) if (value.hasOwnProperty(key)) keys.push(key);
  keys.sort();
  var fields = [];
  for (var keyIndex = 0; keyIndex < keys.length; keyIndex++) {
    fields.push(stringifyJson(keys[keyIndex]) + ":" + charStyleCanonicalJson(value[keys[keyIndex]]));
  }
  return "{" + fields.join(",") + "}";
}

function charStyleSame(left, right) {
  return left !== null && left !== undefined && right !== null && right !== undefined &&
    charStyleCanonicalJson(left) === charStyleCanonicalJson(right);
}

function charStyleAutoLeadingFactor(target) {
  var amount = target.textRange.paragraphAttributes.autoLeadingAmount;
  return mutationFiniteNumber(amount, "paragraphAttributes.autoLeadingAmount") / 100;
}

function charStyleUnsupported(reason, field) {
  return mutationError("preflight_failed", stringifyJson({ code: "CHARACTER_STYLE_UNSUPPORTED",
    reason: reason, field: field, name: params.styleName }));
}

function charStyleDefined(entry, attribute) {
  var reading = entry.attributes[attribute];
  return reading && reading.status === "defined" ? reading.value : null;
}

/**
 * A style may only be applied when everything it defines stays inside the supported profile. A pinned
 * attribute the style would change, an unreadable attribute, an unmeasured paint and a font that is not
 * installed are all refused before any write rather than discovered at verification.
 */
function charStyleAssertSupported(entry, style) {
  for (var pinned in POINT_TEXT_PINNED.character) {
    if (!POINT_TEXT_PINNED.character.hasOwnProperty(pinned)) continue;
    var pinnedReading = entry.attributes[pinned];
    if (!pinnedReading) throw charStyleUnsupported("attribute_missing", pinned);
    if (pinnedReading.status === "error") throw charStyleUnsupported("attribute_unreadable", pinned);
    if (pinnedReading.status === "defined" && pinnedReading.value !== POINT_TEXT_PINNED.character[pinned]) {
      throw charStyleUnsupported("style_leaves_profile", pinned);
    }
  }
  var freeFields = ["textFont", "size", "tracking", "horizontalScale", "verticalScale", "fillColor", "strokeColor"];
  for (var index = 0; index < freeFields.length; index++) {
    var reading = entry.attributes[freeFields[index]];
    if (!reading) throw charStyleUnsupported("attribute_missing", freeFields[index]);
    if (reading.status === "error") throw charStyleUnsupported("attribute_unreadable", freeFields[index]);
  }
  var font = charStyleDefined(entry, "textFont");
  if (font !== null) {
    if (font.substring(0, 5) !== "font:") throw charStyleUnsupported("font_unreadable", "textFont");
    var postScriptName = font.substring(5);
    var located = null;
    try { located = app.textFonts.getByName(postScriptName); } catch (fontError) { located = null; }
    if (located === null || located === undefined || located !== style.characterAttributes.textFont) {
      throw charStyleUnsupported("font_not_installed", "textFont");
    }
  }
  var numericFields = [["size", true], ["tracking", false], ["horizontalScale", true], ["verticalScale", true]];
  for (var numericIndex = 0; numericIndex < numericFields.length; numericIndex++) {
    var name = numericFields[numericIndex][0];
    var value = charStyleDefined(entry, name);
    if (value === null) continue;
    var parsed = Number(value);
    if (String(parsed) !== value || !isFinite(parsed) || (numericFields[numericIndex][1] && parsed <= 0)) {
      throw charStyleUnsupported("value_unsupported", name);
    }
  }
  // A style that defines a paint is refused: applying it would write a fill this operation never
  // measured, and the color-space contract forbids writing one that does not belong to the document's color space.
  // A fill the style leaves undefined reads as NoColor (measured operation); whether the range may take it is
  // decided against the characters in charStyleAssertFillMeasured.
  var fill = charStyleDefined(entry, "fillColor");
  if (fill !== null && fill !== "none") throw charStyleUnsupported("paint_unsupported", "fillColor");
  var stroke = charStyleDefined(entry, "strokeColor");
  if (stroke !== null && stroke !== "none") throw charStyleUnsupported("paint_unsupported", "strokeColor");
  return entry;
}

/**
 * The predicted after state: inside the range, every field the style defines takes the style's value,
 * plus \`leading\`, which auto leading derives from the size. Fields the style leaves undefined are
 * predicted unchanged; if the host disagrees, verification fails and the inverse restores the frame.
 */
function charStylePredictAfter(target, before, entry) {
  var factor = charStyleAutoLeadingFactor(target);
  var font = charStyleDefined(entry, "textFont");
  var size = charStyleDefined(entry, "size");
  var tracking = charStyleDefined(entry, "tracking");
  var horizontalScale = charStyleDefined(entry, "horizontalScale");
  var verticalScale = charStyleDefined(entry, "verticalScale");
  var characters = [];
  for (var index = 0; index < before.characters.length; index++) {
    var source = before.characters[index];
    if (index < params.start || index >= params.end) { characters.push(source); continue; }
    var next = {};
    for (var key in source) if (source.hasOwnProperty(key)) next[key] = source[key];
    if (font !== null) {
      var located = app.textFonts.getByName(font.substring(5));
      next.font = { postScriptName: located.name, family: located.family, style: located.style };
    }
    if (size !== null) { next.size = Number(size); next.leading = Number(size) * factor; }
    if (tracking !== null) next.tracking = Number(tracking);
    if (horizontalScale !== null) next.horizontalScale = Number(horizontalScale);
    if (verticalScale !== null) next.verticalScale = Number(verticalScale);
    characters.push(next);
  }
  var applied = [];
  for (var appliedIndex = 0; appliedIndex < before.appliedCharacterStyles.length; appliedIndex++) {
    applied.push(appliedIndex >= params.start && appliedIndex < params.end
      ? String(entry.name) : before.appliedCharacterStyles[appliedIndex]);
  }
  var after = {};
  for (var field in before) if (before.hasOwnProperty(field)) after[field] = before[field];
  after.characters = characters;
  after.appliedCharacterStyles = applied;
  return after;
}

/**
 * The default character style's fill (index 0). Only a CMYK default is a measured basis (CMYK-CHARSTYLE-APPLY
 * read K100 there); anything else, or an unreadable default, leaves the effect unmeasured.
 */
function charStyleDefaultFill(document) {
  var fill;
  try { fill = document.characterStyles[0].characterAttributes.fillColor; }
  catch (defaultError) { throw charStyleUnsupported("fill_effect_unmeasured", "fillColor"); }
  if (!fill || String(fill.typename) !== "CMYKColor") throw charStyleUnsupported("fill_effect_unmeasured", "fillColor");
  return pointTextReadFillColor(fill);
}

/**
 * A fill-undefined style resets the fill to the default character style's fill (CMYK-CHARSTYLE-APPLY; the
 * RGB measured operation reading, black before and after, is consistent with it). It is accepted only where that reset is
 * a no-op: text filled rgb(0,0,0), in the measured profile, or — in a CMYK document — CMYK text whose fill
 * already equals the default's at five decimals. Every other fill is refused. The plan predicts the fill
 * unchanged and verification checks it. Returns the default fill when it was the basis, otherwise null.
 */
function charStyleAssertFillMeasured(entry, before, document) {
  if (charStyleDefined(entry, "fillColor") !== "none") return null;
  var defaultFill = null;
  for (var index = params.start; index < params.end; index++) {
    var fill = before.characters[index].fillColor;
    if (fill && fill.model === "rgb" && fill.red === 0 && fill.green === 0 && fill.blue === 0) continue;
    if (fill && fill.model === "cmyk" && pointTextDocumentColorSpace(document) === "CMYK") {
      if (defaultFill === null) defaultFill = charStyleDefaultFill(document);
      if (stringifyJson(fill) === stringifyJson(defaultFill)) continue;
    }
    throw charStyleUnsupported("fill_effect_unmeasured", "fillColor");
  }
  return defaultFill;
}

/**
 * The inverse re-applies each character's prior style by name, so every prior style in the range must resolve to
 * exactly one character style before any write.
 */
function charStyleAssertPriorStylesResolve(document, before) {
  for (var index = params.start; index < params.end; index++) {
    var prior = textStyleResolveNamed(document, "character", before.appliedCharacterStyles[index]);
    if (prior.status !== "resolved") {
      throw mutationError("preflight_failed", stringifyJson({ code: "CHARACTER_STYLE_UNSUPPORTED",
        reason: "applied_style_unresolvable", field: "characterStyles", name: params.styleName }));
    }
  }
}

function charStyleResolveStyle(document) {
  var resolved = textStyleResolveNamed(document, "character", params.styleName);
  if (resolved.status !== "resolved") {
    throw mutationError("preflight_failed", stringifyJson({ code: resolved.code,
      name: resolved.name, total: resolved.count }));
  }
  charStyleAssertSupported(resolved.entry, resolved.style);
  return resolved;
}

function charStyleResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  var target = pointTextFind(document, params.targetUuid);
  if (target === null) {
    throw mutationError("preflight_failed", stringifyJson({ code: "OBJECT_NOT_FOUND", uuid: params.targetUuid }));
  }
  var before = charStyleSnapshot(document, target, params.targetUuid);
  if (params.end > before.characters.length || params.start >= params.end) {
    throw mutationError("preflight_failed", "The requested character-style range is outside the target contents.");
  }
  var resolved = charStyleResolveStyle(document);
  charStyleAssertPriorStylesResolve(document, before);
  var defaultStyleFill = charStyleAssertFillMeasured(resolved.entry, before, document);
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
    throw mutationBeforeSideEffectError(stringifyJson({ code: "CHARACTER_STYLE_APPLY_BLOCKED",
      reasonCodes: blockers, uuid: params.targetUuid }));
  }
  return { context: context, document: document, target: target, before: before,
    style: resolved.style, entry: resolved.entry, defaultStyleFill: defaultStyleFill, blockers: blockers };
}

function charStylePreflight(forApply) {
  var resolved = charStyleResolve(forApply);
  if (forApply) {
    if (!charStyleSame(resolved.before, params.expectedBefore)) {
      throw mutationError("preflight_failed", "Target state does not match expected_before.");
    }
    if (!charStyleSame(resolved.entry, params.expectedStyle)) {
      throw mutationError("preflight_failed", "The named character style does not match expected_style.");
    }
    if (!charStyleSame(charStylePredictAfter(resolved.target, resolved.before, resolved.entry), params.confirmedAfter)) {
      throw mutationError("preflight_failed", "confirmed_after does not match the derived character-style state.");
    }
  }
  return resolved;
}

function charStylePlan(preflight) {
  return {
    operation: "apply_character_style", documentKey: preflight.context.key, targetUuid: params.targetUuid,
    start: params.start, end: params.end, styleName: params.styleName, style: preflight.entry,
    before: preflight.before,
    after: charStylePredictAfter(preflight.target, preflight.before, preflight.entry),
    defaultStyleFill: preflight.defaultStyleFill,
    applyBlockedReasonCodes: preflight.blockers,
    confirmationStatus: params.apply === true ? "confirmed" : "required",
    applyAllowed: params.apply === true && preflight.blockers.length === 0
  };
}

function charStyleRevalidate(preflight, plan) {
  var current;
  try { current = charStyleResolve(true); }
  catch (error) {
    throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Character-style preconditions changed before apply."));
  }
  if (current.document !== preflight.document || current.target !== preflight.target ||
      !charStyleSame(current.before, plan.before) || !charStyleSame(current.entry, plan.style) ||
      stringifyJson(current.defaultStyleFill) !== stringifyJson(plan.defaultStyleFill)) {
    throw mutationBeforeSideEffectError("Character-style target, contents or style resource changed before apply.");
  }
}

/**
 * Measured primitive: applying the style to one held character with clearingOverrides = true. A range is
 * the same call repeated per character, so a mixed range is handled uniformly and the inverse stays per
 * character.
 */
function charStyleApply(preflight, plan, state) {
  state.operationState.mutationStarted = true;
  var preserveFont = charStyleDefined(plan.style, "textFont") === null;
  for (var index = params.start; index < params.end; index++) {
    var character = preflight.target.characters[index];
    var originalFont = null;
    if (preserveFont) {
      var beforeAttributes = character.characterAttributes;
      originalFont = beforeAttributes.textFont;
    }
    preflight.style.applyTo(character, true);
    // Clearing overrides resets an undefined font to the document default.
    // Preserve each character's measured font while applying the style's defined attributes.
    if (preserveFont) {
      var afterAttributes = character.characterAttributes;
      afterAttributes.textFont = originalFont;
    }
  }
  return preflight.target;
}

function charStyleVerify(preflight, plan) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) {
    throw mutationError("verify_mismatch", "Active document changed during character-style verification.");
  }
  var target = pointTextFind(preflight.document, plan.before.uuid);
  if (target === null || target !== preflight.target) {
    throw mutationError("verify_mismatch", "Target native UUID no longer resolves to the same TextFrame.");
  }
  var actual = charStyleSnapshot(preflight.document, target, params.targetUuid);
  if (!charStyleSame(actual, plan.after)) {
    throw mutationError("verify_mismatch", "Character-style postcondition does not match the plan at " +
      String(charStyleFirstMismatch(actual, plan.after, "after")).substring(0, 300) + ".");
  }
  // The style resource itself must be untouched: this operation only ever reads it.
  var current = textStyleResolveNamed(preflight.document, "character", params.styleName);
  if (current.status !== "resolved" || !charStyleSame(current.entry, plan.style)) {
    throw mutationError("verify_mismatch", "The named character style changed during the transaction.");
  }
  return actual;
}

/**
 * The measured inverse: for each character, re-apply the style it reported before with clearingOverrides = true,
 * then write back its own recorded values. Writing the values alone leaves the applied style in place with the
 * values as overrides; re-applying the prior style first restored both the assignment and the values
 * exactly (cells STYLE-CMYK / STYLE-RGB). The pinned fields are written too, in the order the capability probe
 * used, because applying a style can move them. The fill is written in the model it was read in (RGB, CMYK or
 * Gray), never converted; CMYK-CHARSTYLE-APPLY measured the CMYK write.
 */
function charStyleRestore(document, target, before) {
  for (var index = params.start; index < params.end; index++) {
    var source = before.characters[index];
    var character = target.characters[index];
    var prior = textStyleResolveNamed(document, "character", before.appliedCharacterStyles[index]);
    if (prior.status !== "resolved") throw new Error("Prior character style does not resolve uniquely.");
    prior.style.applyTo(character, true);
    var attributes = character.characterAttributes;
    attributes.textFont = app.textFonts.getByName(source.font.postScriptName);
    attributes.size = source.size;
    attributes.tracking = source.tracking;
    attributes.horizontalScale = source.horizontalScale;
    attributes.verticalScale = source.verticalScale;
    attributes.leading = source.leading;
    attributes.autoLeading = true;
    attributes.baselineShift = 0;
    attributes.noBreak = false;
    attributes.underline = false;
    attributes.fillColor = pointTextNativeFillColor(source.fillColor);
    attributes.strokeColor = new NoColor();
  }
}

/**
 * Rollback acts only when the frame is readable inside the profile and differs from the before state
 * only within the applied range. Anything else — including a frame the snapshot can no longer read —
 * stays indeterminate for reconciliation.
 */
function charStyleRestorable(current, before) {
  if (!current || !before) return false;
  if (current.characters.length !== before.characters.length) return false;
  var currentFrame = {};
  var beforeFrame = {};
  for (var key in current) {
    if (current.hasOwnProperty(key) && key !== "characters" && key !== "appliedCharacterStyles") currentFrame[key] = current[key];
  }
  for (var beforeKey in before) {
    if (before.hasOwnProperty(beforeKey) && beforeKey !== "characters" && beforeKey !== "appliedCharacterStyles") beforeFrame[beforeKey] = before[beforeKey];
  }
  if (stringifyJson(currentFrame) !== stringifyJson(beforeFrame)) return false;
  for (var index = 0; index < before.characters.length; index++) {
    if (current.characters[index].contents !== before.characters[index].contents) return false;
    if (index >= params.start && index < params.end) continue;
    if (stringifyJson(current.characters[index]) !== stringifyJson(before.characters[index])) return false;
    if (current.appliedCharacterStyles[index] !== before.appliedCharacterStyles[index]) return false;
  }
  return true;
}

function charStyleRollback(state) {
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
    current = charStyleSnapshot(preflight.document, target, params.targetUuid);
  } catch (error) { return { status: "indeterminate", message: "Rollback target state is indeterminate." }; }
  if (charStyleSame(current, preflight.before)) {
    state.operationState.rollbackEvidence.restoredSnapshot = current;
    return { status: "verified" };
  }
  if (!charStyleRestorable(current, preflight.before)) {
    return { status: "indeterminate", message: "Rollback refused because the target changed outside the applied range." };
  }
  try { charStyleRestore(preflight.document, target, preflight.before); }
  catch (writeError) { return { status: "indeterminate", message: "Rollback character write is indeterminate." }; }
  var restored;
  try { restored = charStyleSnapshot(preflight.document, target, params.targetUuid); }
  catch (verifyError) { return { status: "indeterminate", message: "Rollback verification is indeterminate." }; }
  state.operationState.rollbackEvidence.restoredSnapshot = restored;
  return charStyleSame(restored, preflight.before)
    ? { status: "verified" }
    : { status: "failed", message: "Rollback did not restore the exact before point-text state." };
}

`;
export const APPLY_CHARACTER_STYLE_RUNNER_SCRIPT = `var charStyleExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionAffected: function () { return [params.targetUuid]; },
  initialOperationState: function () {
    return { mutationStarted: false, rollbackEvidence: { targetUuid: params.targetUuid, restoredSnapshot: null } };
  },
  preflight: charStylePreflight,
  plan: charStylePlan,
  revalidate: charStyleRevalidate,
  applyMutation: charStyleApply,
  verify: charStyleVerify,
  rollback: charStyleRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () {
    return { reasonCode: "text_state_unknown",
      message: "Character-style apply outcome is indeterminate.",
      evidence: { targetUuid: params.targetUuid, restoredSnapshot: null } };
  },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var charStyleDocument = charStyleExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === charStyleExecution.preflight.document) {
  charStyleDocument = getDocumentContext();
}
var result = { operation: "apply_character_style",
  applied: charStyleExecution.transaction.state === "verified",
  document: charStyleDocument, plan: charStyleExecution.plan, transaction: charStyleExecution.transaction };
if (charStyleExecution.transaction.state === "verified") result.postcondition = charStyleExecution.value;
`;
export const APPLY_CHARACTER_STYLE_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${POINT_TEXT_SNAPSHOT_SCRIPT}
${POINT_TEXT_CHARACTER_SCRIPT}
${TEXT_STYLE_RESOURCE_SCRIPT}

${APPLY_CHARACTER_STYLE_MODULE_SCRIPT}${APPLY_CHARACTER_STYLE_RUNNER_SCRIPT}`;
export const APPLY_CHARACTER_STYLE_HOST_SCRIPT_DIGEST = canonicalSha256(APPLY_CHARACTER_STYLE_SCRIPT);
export const APPLY_CHARACTER_STYLE_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: APPLY_CHARACTER_STYLE_OPERATION,
    validator: APPLY_CHARACTER_STYLE_VALIDATOR, canonicalContractVersion: CANONICAL_VERSION,
    resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: APPLY_CHARACTER_STYLE_SAFETY_IDENTITY,
    hostScriptDigest: APPLY_CHARACTER_STYLE_HOST_SCRIPT_DIGEST,
    mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    if (request.apply) {
        const rejection = validateClusterRange(request.expectedBefore.contents, request.start, request.end);
        if (rejection !== null) {
            throw new Error(`Character-style request is unsupported: ${rejection.reason}.`);
        }
    }
    const digestRequest = 'commandId' in request
        ? (({ commandId: _commandId, ...rest }) => rest)(request)
        : request;
    const digest = canonicalSha256({ operation: APPLY_CHARACTER_STYLE_OPERATION,
        validator: APPLY_CHARACTER_STYLE_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request,
        commandId: 'commandId' in request ? request.commandId : null,
        documentKey: request.expectedDocumentKey, digest };
}
export const applyCharacterStyleToolContract = {
    name: 'illustrator_apply_character_style',
    title: 'Plan or Apply an Existing Named Character Style',
    description: 'Plan or apply one existing named character style to a bounded UTF-16 range of a single-line '
        + 'layer-direct POINTTEXT frame, bound by explicit document key, native UUID and the exact style resource '
        + 'as `illustrator_list_text_styles` reported it. The style is only read: this tool never creates or edits '
        + 'a style resource, and it refuses a name that does not resolve to exactly one character style, a style '
        + 'that defines an attribute outside the measured point-text profile, a missing font, and a style that '
        + 'defines any paint. A style whose fill is undefined (it reads as `none`; every style made by '
        + '`illustrator_create_character_style` is one) is accepted only when every character in the range is filled '
        + 'rgb(0,0,0), or, in a CMYK document, CMYK text whose fill already equals the default character style fill '
        + '(such a style resets the fill to that default, so only these cases leave it unchanged); any other fill is '
        + 'refused. Only the attributes the style actually defines may move, plus `leading`, '
        + 'which auto leading derives from the size; everything else, and every character outside the range, stays '
        + 'unchanged. The plan also binds the one named character style each character reports as applied '
        + '(`appliedCharacterStyles`): the range takes the style, every other character keeps its own, and a character '
        + 'that reports none, several, or a style name that does not resolve uniquely is refused. Apply performs exact '
        + 'compare-and-set over the per-character fingerprint, the applied styles and the style resource, native '
        + 'read-back verification (a mismatch names the first differing field), and a measured per-character verified '
        + 'inverse that re-applies each character\'s prior style and writes its values back; rollback is verified only '
        + 'when the values and the applied styles both match the before state. Paragraph styles are read-only here.',
    inputSchema,
    publicInputSchema: applyCharacterStylePublicInputSchema,
    outputSchema: applyCharacterStyleResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(APPLY_CHARACTER_STYLE_SAFETY.policy),
    normalizePublicInput,
};
export function createApplyCharacterStyleAdapter() {
    return {
        version: 1, operation: APPLY_CHARACTER_STYLE_OPERATION, validator: APPLY_CHARACTER_STYLE_VALIDATOR,
        safety: APPLY_CHARACTER_STYLE_SAFETY, safetyRegistrationIdentity: APPLY_CHARACTER_STYLE_SAFETY_IDENTITY,
        adapterIdentity: APPLY_CHARACTER_STYLE_ADAPTER_IDENTITY, tool: applyCharacterStyleToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest,
            safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: applyCharacterStyleResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: CLASSIFIER_VERSION, safetyConformanceVersion: CONFORMANCE_VERSION,
        errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: APPLY_CHARACTER_STYLE_HOST_SCRIPT_DIGEST,
        mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: APPLY_CHARACTER_STYLE_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: APPLY_CHARACTER_STYLE_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: APPLY_CHARACTER_STYLE_OPERATION,
                    documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: APPLY_CHARACTER_STYLE_ADAPTER_IDENTITY,
                mutationHostApplicationMode: 'foreground', script: APPLY_CHARACTER_STYLE_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = applyCharacterStyleResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back')
                return { state };
            if (state === 'planned')
                throw new Error('A character-style plan is not a terminal mutation result.');
            throw new Error('Unverified character-style recovery must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error, detail) {
            const lookupFailure = textLookupFailureError(error, detail);
            if (lookupFailure !== null)
                return lookupFailure;
            if (detail?.code === 'OBJECT_NOT_FOUND') {
                return new Error(`No PageItem with UUID ${JSON.stringify(detail.uuid ?? '')} exists in the bound document.`);
            }
            if (detail?.code === 'CHARACTER_STYLE_APPLY_BLOCKED') {
                return new Error(`Applying the character style is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}.`);
            }
            if (detail?.code === 'TEXT_STYLE_NOT_FOUND') {
                return new Error(`No character style named ${JSON.stringify(detail.name ?? '')} exists in the bound document.`);
            }
            if (detail?.code === 'TEXT_STYLE_NAME_CONFLICT') {
                return new Error(`The character style name ${JSON.stringify(detail.name ?? '')} resolves to ${detail.total ?? 'several'} styles; `
                    + 'rename them so the target is unambiguous.');
            }
            if (detail?.code === 'CHARACTER_STYLE_UNSUPPORTED' && detail.reason === 'fill_effect_unmeasured') {
                return new Error(`The character style ${JSON.stringify(detail.name ?? '')} is unsupported `
                    + '(fill_effect_unmeasured: fillColor): its fill is undefined (reads as none), and applying such a style '
                    + 'resets the fill to the default character style fill. It is accepted only on rgb(0,0,0) text, or on CMYK '
                    + 'text in a CMYK document whose fill already equals that default, so it is refused before any write.');
            }
            if (detail?.code === 'CHARACTER_STYLE_UNSUPPORTED') {
                return new Error(`The character style ${JSON.stringify(detail.name ?? '')} is unsupported `
                    + `(${detail.reason ?? 'unknown reason'}${detail.field === undefined ? '' : `: ${detail.field}`}).`);
            }
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
