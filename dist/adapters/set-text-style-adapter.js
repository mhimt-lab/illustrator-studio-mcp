import { TEXT_STYLE_DELIMITER_SCRIPT, delimiterEffectSchema, delimiterPlanError, textDelimiterRefusal } from './text-style-delimiter-profile.js';
import { textResultSizeMessage, TEXT_RESULT_ADMISSION_BYTES } from './text-result-size.js';
import { TEXT_RECORDED_RUNS_SCRIPT, decodeRecordedRuns, recordedRunsTextResultBytes, recordedRunsWireSchema } from './text-recorded-runs.js';
import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { normalizePointTextPublicFillColor, pointTextApplyBlockers, POINT_TEXT_CHARACTER_SCRIPT, POINT_TEXT_GROUP_SCRIPT, POINT_TEXT_SNAPSHOT_SCRIPT, pointTextFillColorRequestSchema, pointTextFillColorSchema, pointTextPublicFillColorSchema, } from './point-text-host-script.js';
import { POINT_TEXT_MULTILINE_SCRIPT, } from './point-text-multiline.js';
import { TEXT_ALIGNMENT_MODULE_SCRIPT, assertAlignmentAlone, textAlignmentSchema, setTextStyleSnapshotSchema as recordedStyleSnapshotSchema, } from './text-alignment-profile.js';
import { TEXT_LEADING_TYPE_MODULE_SCRIPT, assertLeadingTypeAlone, checkLeadingTypeRequest, isLeadingSnapshot, leadingParagraphSpans, leadingParagraphUniform, paragraphStyleRequestSchema, publicParagraphStyleSchema, } from './text-leading-type-profile.js';
import { RECORDED_ADMITTED_STYLE_FIELDS, RECORDED_PROFILE_NAME, TEXT_RECORDED_MODULE_SCRIPT, assertSizeRepresentable, assertTsumeRepresentable, sameRecordedSnapshots, } from './text-recorded-profile.js';
import { RECORDED_MULTILINE_PROFILE, TEXT_RECORDED_MULTILINE_SCRIPT, multilineStyleSnapshotSchema as fullStyleSnapshotSchema, batchStylePlanSnapshotSchema as fullBatchStylePlanSnapshotSchema, checkRecordedMultilineStyle, emptyParagraphRefusal, hasBreakUnits, isBreakEntry as isParagraphBreak } from './text-recorded-multiline-profile.js';
import { isRecordedSnapshot as isLegacyRecordedSnapshot } from './text-recorded-profile.js';
import { validateClusterRange } from './point-text-cluster.js';
import { textLookupFailureError } from './text-lookup-error.js';
import { defineBatchStep } from './batch-step-contract.js';
import { SET_TEXT_STYLE_BATCH_NEXT_CALL, SET_TEXT_STYLE_BATCH_STYLE_FIELDS, batchTextStyleInternal } from './batch-step-next-call.js';
const isRecordedSnapshot = (snapshot) => isLegacyRecordedSnapshot(snapshot) || snapshot.profile === RECORDED_MULTILINE_PROFILE;
const setTextStyleSnapshotSchema = recordedRunsWireSchema(fullStyleSnapshotSchema, 'set_text_style');
const batchStylePlanSnapshotSchema = recordedRunsWireSchema(fullBatchStylePlanSnapshotSchema, 'set_text_style batch plan');
const batchStyleSnapshotSchema = recordedRunsWireSchema(recordedStyleSnapshotSchema, 'set_text_style batch');
export const SET_TEXT_STYLE_OPERATION = 'set_text_style';
export const SET_TEXT_STYLE_VALIDATOR = { kind: SET_TEXT_STYLE_OPERATION, version: 1 };
const CANONICAL_VERSION = 12;
const RESULT_SCHEMA_VERSION = 13;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 3;
const tsumeSchema = z.number().finite().min(0).max(100);
const requestedStyleSchema = z.strictObject({
    size: z.number().finite().positive().optional(),
    tracking: z.number().finite().optional(),
    horizontalScale: z.number().finite().positive().optional(),
    verticalScale: z.number().finite().positive().optional(),
    tsume: tsumeSchema.optional(),
    fillColor: pointTextFillColorSchema.optional(),
    fontPostScriptName: z.string().min(1).max(255).optional(),
    alignment: textAlignmentSchema.optional(),
});
const requestedStyleRequestSchema = z.strictObject({
    size: z.number().finite().positive().optional(),
    tracking: z.number().finite().optional(),
    horizontalScale: z.number().finite().positive().optional(),
    verticalScale: z.number().finite().positive().optional(),
    tsume: tsumeSchema.optional(),
    fillColor: pointTextFillColorRequestSchema.optional(),
    fontPostScriptName: z.string().min(1).max(255).optional(),
    alignment: textAlignmentSchema.optional(),
});
const publicStyleSchema = z.strictObject({
    size: z.number().finite().positive().optional(),
    tracking: z.number().finite().optional(),
    horizontal_scale: z.number().finite().positive().optional(),
    vertical_scale: z.number().finite().positive().optional(),
    tsume: tsumeSchema.optional(),
    fill_color: pointTextPublicFillColorSchema.optional(),
    font_post_script_name: z.string().min(1).max(255).optional(),
    alignment: textAlignmentSchema.optional(),
});
function assertRequestsAnAttribute(style, paragraphStyle) {
    if (paragraphStyle === undefined && !Object.values(style).some((value) => value !== undefined)) {
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
    'result_too_large',
]);
export const setTextStylePlanSchema = z.strictObject({
    operation: z.literal(SET_TEXT_STYLE_OPERATION),
    documentKey: z.string().min(1).max(16_384),
    targetUuid: z.string().min(1).max(255),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    style: requestedStyleSchema,
    paragraphStyle: paragraphStyleRequestSchema.optional(),
    before: setTextStyleSnapshotSchema,
    after: setTextStyleSnapshotSchema,
    delimiterEffect: delimiterEffectSchema.optional(),
    applyBlockedReasonCodes: z.array(blockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((wirePlan, context) => {
    const plan = { ...wirePlan, before: decodeRecordedRuns(wirePlan.before), after: decodeRecordedRuns(wirePlan.after) };
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
    const leadingPlan = plan.paragraphStyle !== undefined;
    if (isLeadingSnapshot(plan.before) !== leadingPlan || isLeadingSnapshot(plan.after) !== leadingPlan) {
        context.addIssue({ code: 'custom', message: 'A point-text style plan must record the leading-type snapshot exactly when paragraph_style is requested.' });
    }
    else if (leadingPlan) {
        const requested = plan.paragraphStyle.leadingType;
        if (Object.values(plan.style).some((value) => value !== undefined)) {
            context.addIssue({ code: 'custom', message: 'A paragraph_style plan must not request character style attributes.' });
        }
        const rejection = checkLeadingTypeRequest(plan.before, plan.start, plan.end, requested);
        if (rejection !== null) {
            context.addIssue({ code: 'custom', message: `A paragraph_style plan is unsupported: ${rejection.reason}.` });
        }
        else {
            const index = leadingParagraphSpans(plan.before.contents).findIndex((span) => span.start === plan.start && span.end === plan.end);
            const expectedLeading = plan.before.paragraphLeading.map((entry, position) => position === index ? { leadingType: requested } : entry);
            if (canonicalSha256(plan.after.paragraphLeading) !== canonicalSha256(expectedLeading)) {
                context.addIssue({ code: 'custom', message: 'A paragraph_style plan must change the leading type of the selected paragraph only.' });
            }
            if (!leadingParagraphUniform(plan.before.characters, plan.start, plan.end)) {
                context.addIssue({ code: 'custom', message: 'A paragraph_style plan needs a paragraph whose characters share every attribute.' });
            }
            if (plan.before.layoutBounds == null || plan.after.layoutBounds !== null) {
                context.addIssue({ code: 'custom', message: 'A paragraph_style plan binds the observed bounds before and predicts none after.' });
            }
        }
    }
    const recordedPlan = isRecordedSnapshot(plan.before);
    if (recordedPlan !== isRecordedSnapshot(plan.after)) {
        context.addIssue({ code: 'custom', message: 'A point-text style plan must bind one profile before and after.' });
    }
    else if (recordedPlan) {
        const admitted = new Set(RECORDED_ADMITTED_STYLE_FIELDS);
        if (plan.paragraphStyle !== undefined || Object.keys(plan.style).some((key) => plan.style[key] !== undefined && !admitted.has(key))) {
            context.addIssue({ code: 'custom', message: 'A recorded-profile plan admits size, tracking, scales, tsume, fill and font only.' });
        }
        if (canonicalSha256(plan.before.attributeRecord) !== canonicalSha256(plan.after.attributeRecord)) {
            context.addIssue({ code: 'custom', message: 'A recorded-profile plan must leave the attribute record unchanged.' });
        }
        if (plan.before.layoutBounds == null || plan.after.layoutBounds !== null) {
            context.addIssue({ code: 'custom', message: 'A recorded-profile plan binds the observed bounds before and predicts none after.' });
        }
    }
    const delimiterError = delimiterPlanError(plan);
    if (delimiterError !== null)
        context.addIssue({ code: 'custom', message: delimiterError });
    for (let index = 0; index < plan.before.characters.length; index += 1) {
        if (index >= plan.start && index < plan.end || delimiterError === null && plan.delimiterEffect?.offset === index)
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
    if (plan.style.tsume !== undefined)
        mutableFields.add('tsume');
    if (plan.style.fillColor !== undefined)
        mutableFields.add('fillColor');
    if (plan.style.fontPostScriptName !== undefined)
        mutableFields.add('font');
    if (plan.style.alignment !== undefined)
        mutableFields.add('alignment');
    for (const snapshot of [plan.before, plan.after]) {
        const recorded = snapshot.characters.filter((entry) => !isParagraphBreak(entry) &&
            entry.alignment !== undefined).length;
        const expected = plan.style.alignment === undefined ? 0 : snapshot.characters.filter((entry) => !isParagraphBreak(entry)).length;
        if (recorded !== expected) {
            context.addIssue({ code: 'custom', message: 'A point-text style plan must record alignment exactly when alignment is requested.' });
            break;
        }
    }
    for (const snapshot of [plan.before, plan.after]) {
        const units = snapshot.characters.filter((entry) => snapshot.profile === RECORDED_MULTILINE_PROFILE || !isParagraphBreak(entry));
        const recorded = units.filter((entry) => entry.tsume !== undefined).length;
        const expected = plan.style.tsume === undefined ? 0 : units.length;
        if (recorded !== expected) {
            context.addIssue({ code: 'custom', message: 'A point-text style plan must record tsume exactly when tsume is requested.' });
            break;
        }
    }
    for (let index = plan.start; index < plan.end; index += 1) {
        const beforeCharacter = plan.before.characters[index];
        const afterCharacter = plan.after.characters[index];
        if (isParagraphBreak(beforeCharacter) || isParagraphBreak(afterCharacter)) {
            context.addIssue({ code: 'custom', message: 'A point-text style range must not include a paragraph break.' });
            break;
        }
        for (const field of Object.keys(beforeCharacter)) {
            if (mutableFields.has(field))
                continue;
            if (canonicalSha256(beforeCharacter[field]) !==
                canonicalSha256(afterCharacter[field])) {
                context.addIssue({ code: 'custom', message: `A point-text style edit changed ${field}, which it did not request.` });
                break;
            }
        }
        if (plan.style.alignment !== undefined &&
            afterCharacter.alignment !== plan.style.alignment) {
            context.addIssue({ code: 'custom', message: 'A point-text style plan must apply the requested alignment.' });
        }
        if (plan.style.size !== undefined && afterCharacter.size !== plan.style.size) {
            context.addIssue({ code: 'custom', message: 'A point-text style plan must apply the requested size.' });
        }
        if (plan.style.tracking !== undefined && afterCharacter.tracking !== plan.style.tracking) {
            context.addIssue({ code: 'custom', message: 'A point-text style plan must apply the requested tracking.' });
        }
        if (plan.style.horizontalScale !== undefined && afterCharacter.horizontalScale !== plan.style.horizontalScale) {
            context.addIssue({ code: 'custom', message: 'A point-text style plan must apply the requested horizontal scale.' });
        }
        if (plan.style.verticalScale !== undefined && afterCharacter.verticalScale !== plan.style.verticalScale) {
            context.addIssue({ code: 'custom', message: 'A point-text style plan must apply the requested vertical scale.' });
        }
        if (plan.style.tsume !== undefined && afterCharacter.tsume !== plan.style.tsume) {
            context.addIssue({ code: 'custom', message: 'A point-text style plan must apply the requested tsume.' });
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
const { delimiterEffect: _delimiterEffect, ...batchStylePlanShape } = setTextStylePlanSchema.shape;
const batchStylePlanSchema = z.strictObject({ ...batchStylePlanShape,
    before: batchStylePlanSnapshotSchema, after: batchStylePlanSnapshotSchema,
}).superRefine((plan, context) => {
    const checked = setTextStylePlanSchema.safeParse(plan);
    if (!checked.success)
        for (const issue of checked.error.issues)
            context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
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
    restoredSnapshot: setTextStyleSnapshotSchema.nullable(),
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
        postcondition: setTextStyleSnapshotSchema, transaction: transactionSchema,
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
        if (recordedRunsTextResultBytes(result.plan) > TEXT_RESULT_ADMISSION_BYTES)
            blockers.push('result_too_large');
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
        const recordedResult = isRecordedSnapshot(result.plan.before);
        const comparable = (snapshot) => (result.plan.paragraphStyle === undefined
            ? snapshot : { ...snapshot, layoutBounds: null });
        if (result.transaction.state !== 'verified' ||
            !(recordedResult ? sameRecordedSnapshots(result.postcondition, result.plan.after)
                : canonicalSha256(comparable(result.postcondition)) === canonicalSha256(comparable(result.plan.after))) ||
            ((result.plan.paragraphStyle !== undefined || recordedResult) && result.postcondition.layoutBounds == null)) {
            context.addIssue({ code: 'custom', message: 'A verified point-text style edit must match the exact after snapshot.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified point-text style transaction must be applied.' });
    }
    if (result.transaction.state === 'rolled_back' &&
        !(isRecordedSnapshot(result.plan.before)
            ? (result.plan.before.profile !== RECORDED_MULTILINE_PROFILE || result.transaction.rollback.restoredSnapshot?.layoutBounds != null)
                && sameRecordedSnapshots(result.transaction.rollback.restoredSnapshot, result.plan.before)
            : canonicalSha256(result.transaction.rollback.restoredSnapshot) === canonicalSha256(result.plan.before))) {
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
    paragraphStyle: paragraphStyleRequestSchema.optional(),
    fontVerified: z.boolean().optional(),
};
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({
        ...commonInternal,
        expectedBefore: setTextStyleSnapshotSchema,
        confirmedAfter: setTextStyleSnapshotSchema,
        apply: z.literal(true),
        commandId: canonicalCommandIdSchema,
    }),
]);
const commonPublic = {
    expected_document_key: z.string().min(1).max(16_384),
    target_uuid: z.string().min(1).max(255),
    start: z.number().int().safe().nonnegative(),
    end: z.number().int().safe().nonnegative(),
    style: publicStyleSchema.optional(),
    paragraph_style: publicParagraphStyleSchema.optional(),
};
export const setTextStylePublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({
        ...commonPublic,
        expected_before: setTextStyleSnapshotSchema,
        confirmed_after: setTextStyleSnapshotSchema,
        apply: z.literal(true),
        command_id: applyCommandIdSchema,
    }),
]);
const inputSchema = z.strictObject({
    ...commonPublic,
    expected_before: setTextStyleSnapshotSchema.optional(),
    confirmed_after: setTextStyleSnapshotSchema.optional(),
    apply: z.boolean().default(false),
    command_id: applyCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(setTextStylePublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = setTextStylePublicInputSchema.parse(input);
    const requested = value.style ?? {};
    const style = {
        ...(requested.size === undefined ? {} : { size: requested.size }),
        ...(requested.tracking === undefined ? {} : { tracking: requested.tracking }),
        ...(requested.horizontal_scale === undefined ? {} : { horizontalScale: requested.horizontal_scale }),
        ...(requested.vertical_scale === undefined ? {} : { verticalScale: requested.vertical_scale }),
        ...(requested.tsume === undefined ? {} : { tsume: requested.tsume }),
        ...(requested.fill_color === undefined
            ? {} : { fillColor: normalizePointTextPublicFillColor(requested.fill_color) }),
        ...(requested.font_post_script_name === undefined
            ? {} : { fontPostScriptName: requested.font_post_script_name }),
        ...(requested.alignment === undefined ? {} : { alignment: requested.alignment }),
    };
    const paragraphStyle = value.paragraph_style === undefined ? undefined : { leadingType: value.paragraph_style.leading_type };
    assertSizeRepresentable(style.size);
    assertTsumeRepresentable(style.tsume);
    assertRequestsAnAttribute(style, paragraphStyle);
    assertAlignmentAlone(style);
    assertLeadingTypeAlone(style, paragraphStyle);
    const common = {
        expectedDocumentKey: value.expected_document_key,
        targetUuid: value.target_uuid,
        start: value.start,
        end: value.end,
        style,
        ...(paragraphStyle === undefined ? {} : { paragraphStyle }),
    };
    return value.apply
        ? { ...common, expectedBefore: value.expected_before, confirmedAfter: value.confirmed_after,
            apply: true, commandId: value.command_id }
        : { ...common, apply: false };
}
async function admit(input, services) {
    const { fontVerified: _ignored, ...request } = input;
    const style = request.style;
    if (typeof style?.fontPostScriptName !== 'string')
        return request;
    const name = style.fontPostScriptName;
    const verification = services.fontVerifier === undefined ? {}
        : await services.fontVerifier.verify([name], services.applicationBundleId ?? null);
    return { ...request, fontVerified: verification[name] != null };
}
export function checkTextStyleRequest(before, start, end, style) {
    return validateClusterRange(before.contents, start, end) ?? (hasBreakUnits(before.contents) ? checkRecordedMultilineStyle(before, start, end, style) : null);
}
export function checkParagraphStyleRequest(before, start, end, leadingType) {
    return checkLeadingTypeRequest(before, start, end, leadingType);
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
    const beforeStateHash = canonicalDigest(decodeRecordedRuns(result.plan.before));
    const afterStateHash = canonicalDigest(decodeRecordedRuns(result.plan.after));
    const changeSetHash = canonicalDigest({ targetUuid: result.plan.targetUuid, start: result.plan.start,
        end: result.plan.end, style: result.plan.style,
        ...(result.plan.paragraphStyle === undefined ? {} : { paragraphStyle: result.plan.paragraphStyle }),
        beforeStateHash, afterStateHash });
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
  var groups = pointTextGroupAncestry(target);
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
  return pointTextWithGroups({
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
    layerAncestry: pointTextAncestryWithGroups(target, groups),
    contents: pointTextValidateContents(target.contents, "Target contents"),
    locked: target.locked,
    hidden: target.hidden,
    editable: target.editable,
    layerVisible: target.layer.visible,
    layerLocked: target.layer.locked
  }, groups);
}

function styleSame(left, right) {
  return pointTextGroupSame(left, right);
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
  if (font === null || font === undefined || String(font.name) !== String(params.style.fontPostScriptName)) {
    throw mutationError("preflight_failed", "The requested font is not installed.");
  }
  // #440: Illustrator also resolves a font missing on this machine while a document using it is open.
  if (params.fontVerified !== true) {
    throw mutationError("preflight_failed", "The requested font resolves in Illustrator but neither the OS nor Illustrator's font lists nor a process-bound documents=0 inventory verify it; it is not written.");
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
    if (values.tsume !== undefined) attributes.Tsume = values.tsume;
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
function patchedModule(source, patches) {
    let result = source;
    for (const [from, to, expectedCount] of patches) {
        const parts = result.split(from);
        if (parts.length - 1 !== expectedCount)
            throw new Error(`Multi-paragraph patch anchor did not match ${expectedCount} time(s): ${from}`);
        result = parts.join(to);
    }
    return result;
}
export const STYLE_RECORDED_BASE_PATCHES = [
    [`function styleSnapshot(document, target, expectedUuid) {
  if (!target || target.typename !== "TextFrame") {`, `function styleSnapshot(document, target, expectedUuid) {
  if (styleV3Selected(target)) return styleV3Snapshot(document, target, expectedUuid);
  if (!target || target.typename !== "TextFrame") {`, 1],
    [`function stylePredictAfter(target, before) {
  var factor = styleAutoLeadingFactor(target);`, `function stylePredictAfter(target, before) {
  if (before.profile === STYLE_V3_PROFILE) return styleV3PredictAfter(target, before);
  var factor = styleAutoLeadingFactor(target);`, 1],
    [`function styleSame(left, right) {
  return pointTextGroupSame(left, right);
}`, `function styleSame(left, right) {
  left = styleRunsDecode(left); right = styleRunsDecode(right);
  if (left && right && left.profile === STYLE_V3_PROFILE && right.profile === STYLE_V3_PROFILE) return styleV3Same(left, right);
  return pointTextGroupSame(left, right);
}`, 1],
    [`"Point-text style postcondition does not match the plan."`, `"Point-text style postcondition does not match the plan." + styleV3DiffSuffix()`, 1],
    [`function styleRestore(target, before) {
`, `function styleRestore(target, before) {
  if (before.profile === STYLE_V3_PROFILE) { styleV3Restore(target, before); return; }
`, 1],
    [`"Rollback did not restore the exact before point-text state."`, `"Rollback did not restore the exact before point-text state." + styleV3DiffSuffix()`, 1],
    [`  try { current = styleResolve(true); }`, `  try { STYLE_V3_STATE.revalidating = true; try { current = styleResolve(true); } finally { STYLE_V3_STATE.revalidating = false; } }`, 1],
    [`rollbackEvidence.restoredSnapshot = current;`, `rollbackEvidence.restoredSnapshot = styleRunsEncode(current);`, 1],
    [`rollbackEvidence.restoredSnapshot = restored;`, `rollbackEvidence.restoredSnapshot = styleRunsEncode(restored);`, 1],
];
const STYLE_RECORDED_BATCH_PATCHES = [
    ...STYLE_RECORDED_BASE_PATCHES,
    [`  if (!styleSame(current, stylePredictAfter(target, preflight.before))) {`, `  if (!styleV3RollbackOk(current, target, preflight.before)) {`, 1],
];
export const SET_TEXT_STYLE_BATCH_MODULE_SCRIPT = TEXT_RECORDED_MODULE_SCRIPT + TEXT_RECORDED_RUNS_SCRIPT + patchedModule(SET_TEXT_STYLE_MODULE_SCRIPT, STYLE_RECORDED_BATCH_PATCHES);
const batchStyleUuidSchema = z.string().min(1).max(255);
const batchStyleRangeShape = {
    start: z.number().int().safe().nonnegative(),
    end: z.number().int().safe().nonnegative(),
};
const batchStylePositive = z.number().finite().positive();
const batchStyleTracking = z.number().int().safe();
const batchStyleRgbChannels = {
    red: z.number().finite().min(0).max(255),
    green: z.number().finite().min(0).max(255),
    blue: z.number().finite().min(0).max(255),
};
const batchStyleCmykChannels = {
    cyan: z.number().finite().min(0).max(100),
    magenta: z.number().finite().min(0).max(100),
    yellow: z.number().finite().min(0).max(100),
    black: z.number().finite().min(0).max(100),
};
const oneStyleAttribute = (key, schema) => z.strictObject({ [key]: schema });
const BATCH_STYLE = SET_TEXT_STYLE_BATCH_STYLE_FIELDS;
const batchPublicStyle = z.union([
    oneStyleAttribute('size', batchStylePositive),
    oneStyleAttribute('tracking', batchStyleTracking),
    oneStyleAttribute('horizontal_scale', batchStylePositive),
    oneStyleAttribute('vertical_scale', batchStylePositive),
    oneStyleAttribute('fill_color', z.union([
        z.strictObject(batchStyleRgbChannels),
        z.strictObject({ model: z.literal('cmyk'), ...batchStyleCmykChannels }),
    ])),
]);
const batchInternalStyle = z.union([
    oneStyleAttribute(BATCH_STYLE.size, batchStylePositive),
    oneStyleAttribute(BATCH_STYLE.tracking, batchStyleTracking),
    oneStyleAttribute(BATCH_STYLE.horizontal_scale, batchStylePositive),
    oneStyleAttribute(BATCH_STYLE.vertical_scale, batchStylePositive),
    oneStyleAttribute(BATCH_STYLE.fill_color, z.discriminatedUnion('model', [
        z.strictObject({ model: z.literal('rgb'), ...batchStyleRgbChannels }),
        z.strictObject({ model: z.literal('cmyk'), ...batchStyleCmykChannels }),
    ])),
]);
const batchPublicStylePlan = z.strictObject({
    operation: z.literal(SET_TEXT_STYLE_OPERATION), target_uuid: batchStyleUuidSchema, ...batchStyleRangeShape,
    style: batchPublicStyle,
});
const batchInternalStylePlan = z.strictObject({
    targetUuid: batchStyleUuidSchema, operation: z.literal(SET_TEXT_STYLE_OPERATION), ...batchStyleRangeShape,
    style: batchInternalStyle,
});
const sameBatchStyleSnapshots = (left, right) => left?.profile === RECORDED_PROFILE_NAME && right?.profile === RECORDED_PROFILE_NAME
    ? sameRecordedSnapshots(left, right)
    : canonicalSha256(left) === canonicalSha256(right);
export const setTextStyleBatchStep = defineBatchStep({
    operation: SET_TEXT_STYLE_OPERATION,
    admittedProfile: RECORDED_PROFILE_NAME,
    recipeAllowed: true,
    publicPlan: batchPublicStylePlan,
    publicApply: z.strictObject({ ...batchPublicStylePlan.shape,
        expected_before: batchStyleSnapshotSchema, confirmed_after: batchStyleSnapshotSchema }),
    internalPlan: batchInternalStylePlan,
    internalApply: z.strictObject({ ...batchInternalStylePlan.shape,
        expectedBefore: batchStyleSnapshotSchema, confirmedAfter: batchStyleSnapshotSchema }),
    planSchema: batchStylePlanSchema,
    snapshotSchema: batchStyleSnapshotSchema,
    normalize: (step) => {
        const style = (batchTextStyleInternal(step.style) ?? {});
        if ('size' in style)
            assertSizeRepresentable(style.size);
        return { operation: SET_TEXT_STYLE_OPERATION, targetUuid: step.target_uuid, start: step.start, end: step.end,
            style, ...('expected_before' in step ? { expectedBefore: step.expected_before, confirmedAfter: step.confirmed_after } : {}) };
    },
    checkInternal: (step) => {
        if ('size' in step.style)
            assertSizeRepresentable(step.style.size);
        if ('expectedBefore' in step && step.expectedBefore.profile === RECORDED_PROFILE_NAME
            && (step.expectedBefore.layoutBounds == null || step.confirmedAfter.layoutBounds !== null)) {
            throw new Error('A recorded-profile apply must echo the plan: expected_before with the observed bounds and confirmed_after without them.');
        }
    },
    request: (plan) => ({ start: plan.start, end: plan.end, style: plan.style }),
    same: sameBatchStyleSnapshots,
    planBlockers: (mutationAllowed, plan) => pointTextApplyBlockers(mutationAllowed, plan.before),
    nextCall: SET_TEXT_STYLE_BATCH_NEXT_CALL,
    host: {
        fragments: [
            { id: 'point-text.snapshot', source: POINT_TEXT_SNAPSHOT_SCRIPT },
            { id: 'point-text.group', source: POINT_TEXT_GROUP_SCRIPT },
            { id: 'point-text.character', source: POINT_TEXT_CHARACTER_SCRIPT },
            { id: 'set-text-style.batch-module', source: SET_TEXT_STYLE_BATCH_MODULE_SCRIPT },
        ],
        hooks: {
            resolve: 'function () { return styleResolve(false); }',
            plan: 'stylePlan', same: 'styleSame', apply: 'styleApply', verify: 'styleVerify', rollback: 'styleRollback',
        },
        paramFields: ['start', 'end', 'style'],
    },
});
const STYLE_RUNS_ADMIT_SCRIPT = `
function styleRunsAdmitPlan(plan) {
  if (plan.before.profile !== STYLE_V3_PROFILE) return textResultAdmitPlan(plan);
  var wire = styleRunsPlan(plan);
  var bytes = textResultBytes(wire) - Math.max(textResultJsonBytes(wire.before), textResultJsonBytes(wire.after))
    + Math.max(textResultJsonBytes(plan.before), textResultJsonBytes(plan.after));
  if (bytes > TEXT_RESULT_ADMISSION_BYTES) {
    plan.applyBlockedReasonCodes.push("result_too_large");
    plan.applyAllowed = false;
    if (params.apply === true) throw new Error("result_too_large: estimated " + bytes + " UTF-8 bytes; limit " + TEXT_RESULT_ADMISSION_BYTES + ". Split the range or frame.");
  }
  return plan;
}
`;
export const SET_TEXT_STYLE_PRODUCT_MODULE_SCRIPT = TEXT_RECORDED_MODULE_SCRIPT + TEXT_ALIGNMENT_MODULE_SCRIPT + TEXT_RECORDED_RUNS_SCRIPT + STYLE_RUNS_ADMIT_SCRIPT + TEXT_RECORDED_MULTILINE_SCRIPT + TEXT_STYLE_DELIMITER_SCRIPT
    + patchedModule(TEXT_LEADING_TYPE_MODULE_SCRIPT, [[`  if (params.paragraphStyle === undefined) return styleSame(current, stylePredictAfter(target, before));`,
            `  if (params.paragraphStyle === undefined) return styleV3RollbackOk(current, target, before);`, 1]])
    + patchedModule(SET_TEXT_STYLE_MODULE_SCRIPT, [
        ...STYLE_RECORDED_BASE_PATCHES,
        [`    throw mutationError("preflight_failed", "Target native UUID is unavailable or changed.");
  }
  var groups = pointTextGroupAncestry(target);`, `    throw mutationError("preflight_failed", "Target native UUID is unavailable or changed.");
  }
  if (pointTextMultilineIs(target)) return pointTextMultilineRangeSnapshot(document, target, expectedUuid);
  var groups = pointTextGroupAncestry(target);`, 1],
        [`function styleSnapshot(document, target, expectedUuid) {
`, `function styleSnapshot(document, target, expectedUuid) {
  var snapshot = styleSnapshotRaw(document, target, expectedUuid);
  return snapshot.profile === RECORDED_MULTILINE_PROFILE ? snapshot : pointTextRoundSnapshot(snapshot);
}

function styleSnapshotRaw(document, target, expectedUuid) {
`, 1],
        [`function styleAutoLeadingFactor(target) {
`, `function styleAutoLeadingFactor(target) {
  if (pointTextMultilineIs(target)) return Number(POINT_TEXT_PINNED.paragraph.autoLeadingAmount) / 100;
`, 1],
        [`  if (params.style.fontPostScriptName !== undefined) styleFont();
  // A requested fill`, `  pointTextMultilineAssertStyle(before, params.start, params.end, params.style);
  if (params.style.fontPostScriptName !== undefined) styleFont();
  // A requested fill`, 1],
        [`var character = target.characters[index];`, `var character = pointTextCharacters(target)[index];`, 2],
        [`    var character = pointTextCharacters(target)[index];
    var attributes = character.characterAttributes;
    attributes.size = source.size;`, `    var character = pointTextCharacters(target)[index];
    var attributes = character.characterAttributes;
    if (pointTextMultilineIs(target)) {
      attributes.tracking = source.tracking;
      attributes.horizontalScale = source.horizontalScale;
      continue;
    }
    attributes.size = source.size;`, 1],
        [`    characters: pointTextCharacterFingerprints(target),`, `    characters: styleCharacters(target),`, 1],
        [`    if (params.style.tracking !== undefined) next.tracking = params.style.tracking;`,
            `    if (params.style.alignment !== undefined) next.alignment = params.style.alignment;
    if (params.style.tracking !== undefined) next.tracking = params.style.tracking;`, 1],
        [`    if (values.tracking !== undefined) attributes.tracking = values.tracking;`,
            `    if (values.alignment !== undefined) attributes.alignment = styleAlignmentNative(values.alignment);
    if (values.tracking !== undefined) attributes.tracking = values.tracking;`, 1],
        [`    if (pointTextMultilineIs(target)) {
      attributes.tracking = source.tracking;`, `    if (params.style.alignment !== undefined) {
      attributes.alignment = styleAlignmentNative(source.alignment);
      continue;
    }
    if (pointTextMultilineIs(target)) {
      attributes.tracking = source.tracking;`, 1],
        [`  if (pointTextMultilineIs(target)) return pointTextMultilineRangeSnapshot(document, target, expectedUuid);`,
            `  if (params.paragraphStyle !== undefined) return styleLeadingSnapshot(document, target, expectedUuid);
  if (pointTextMultilineIs(target)) return pointTextMultilineRangeSnapshot(document, target, expectedUuid);`, 1],
        [`  pointTextMultilineAssertStyle(before, params.start, params.end, params.style);
`, `  pointTextMultilineAssertStyle(before, params.start, params.end, params.style);
  if (params.paragraphStyle !== undefined) styleLeadingAssert(target, before);
`, 1],
        [`function stylePredictAfter(target, before) {
`, `function stylePredictAfter(target, before) {
  if (params.paragraphStyle !== undefined) return styleLeadingPredictAfter(before);
`, 1],
        [`function stylePlan(preflight) {
  return {`, `function stylePlan(preflight) {
  var plan = stylePlanCore(preflight);
  if (params.paragraphStyle !== undefined) plan.paragraphStyle = params.paragraphStyle;
  styleDelimiterEffect(plan);
  return styleRunsAdmitPlan(plan);
}

function stylePlanCore(preflight) {
  return {`, 1],
        [`  styleWrite(preflight.target, params.start, params.end, params.style);
  return preflight.target;`, `  if (params.paragraphStyle !== undefined) styleLeadingForward(preflight.target, preflight.before);
  else styleWrite(preflight.target, params.start, params.end, params.style);
  return preflight.target;`, 1],
        [`  if (!styleSame(actual, plan.after)) {`, `  if (!styleSameAfter(actual, plan.after) || !styleDelimiterVerify(plan.before, actual)) {`, 1],
        [`function styleRestore(target, before) {
`, `function styleRestore(target, before) {
  if (params.paragraphStyle !== undefined) { styleLeadingRestore(target, before); return; }
`, 1],
        [`  if (!styleSame(current, stylePredictAfter(target, preflight.before))) {`, `  if (!styleRollbackAcceptable(current, target, preflight.before)) {`, 1],
        [`  return styleSame(restored, preflight.before)
    ? { status: "verified" }`, `  if (styleDelimiterBoundary(preflight.before) && (!styleSame(restored, preflight.before) || !styleDelimiterRestored(preflight.before)))
    return { status: "indeterminate", message: "The delimiter inverse did not restore every recorded attribute." };
  return styleSame(restored, preflight.before)
    ? { status: "verified" }`, 1],
        [`function styleSnapshotRaw(document, target, expectedUuid) {
`, `function styleSnapshotRaw(document, target, expectedUuid) {
  if (recordedMultilineStyleSelected(target)) return styleDelimiterSnapshot(document, target, expectedUuid);
  if (String(target.contents).indexOf("\\x03") >= 0) throw mutationError("preflight_failed", "multiline_style_unsupported: alignment and paragraph_style with U+0003 are outside slice 1.");
`, 1],
        [`function stylePredictAfter(target, before) {
`, `function stylePredictAfter(target, before) {
  if (before.profile === RECORDED_MULTILINE_PROFILE) return styleDelimiterPredict(before, recordedMultilinePredictStyle(target, before));
`, 1],
        [`function styleSame(left, right) {
`, `function styleSame(left, right) {
  if (left && right && left.profile === RECORDED_MULTILINE_PROFILE && right.profile === RECORDED_MULTILINE_PROFILE) return styleV3Same(left, right);
`, 1],
        [`function styleRestore(target, before) {
`, `function styleRestore(target, before) {
  if (before.profile === RECORDED_MULTILINE_PROFILE) { recordedMultilineRestoreStyle(target, before); return; }
`, 1],
        [`  pointTextMultilineAssertStyle(before, params.start, params.end, params.style);`,
            `  if (before.profile === RECORDED_MULTILINE_PROFILE) { recordedMultilineAssertStyle(before, params.start, params.end, params.style); styleDelimiterAssert(before); }
  else pointTextMultilineAssertStyle(before, params.start, params.end, params.style);`, 1],
        [`pointTextCharacters(target)[index]`, `(recordedMultilineHasBreak(String(target.contents)) ? target.textRange.characters : pointTextCharacters(target))[index]`, 2],
    ]);
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
  document: styleDocument, plan: styleRunsPlan(styleExecution.plan), transaction: styleExecution.transaction };
if (styleExecution.transaction.state === "verified") result.postcondition = styleRunsEncode(styleExecution.value);
`;
export const SET_TEXT_STYLE_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${POINT_TEXT_SNAPSHOT_SCRIPT}
${POINT_TEXT_GROUP_SCRIPT}
${POINT_TEXT_CHARACTER_SCRIPT}
${POINT_TEXT_MULTILINE_SCRIPT}

${SET_TEXT_STYLE_PRODUCT_MODULE_SCRIPT}${SET_TEXT_STYLE_RUNNER_SCRIPT}`;
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
    assertSizeRepresentable(request.style.size);
    assertTsumeRepresentable(request.style.tsume);
    assertRequestsAnAttribute(request.style, request.paragraphStyle);
    assertAlignmentAlone(request.style);
    assertLeadingTypeAlone(request.style, request.paragraphStyle);
    if (request.apply) {
        const rejection = checkTextStyleRequest(request.expectedBefore, request.start, request.end, request.style)
            ?? (request.paragraphStyle === undefined ? null
                : checkParagraphStyleRequest(decodeRecordedRuns(request.expectedBefore), request.start, request.end, request.paragraphStyle.leadingType));
        if (rejection !== null) {
            throw new Error(`Point-text style request is unsupported: ${rejection.reason}.`);
        }
        if (isRecordedSnapshot(request.expectedBefore)
            && (request.expectedBefore.layoutBounds == null || request.confirmedAfter.layoutBounds !== null)) {
            throw new Error('A recorded-profile apply must echo the plan: expected_before with the observed bounds and confirmed_after without them.');
        }
        const plan = { operation: SET_TEXT_STYLE_OPERATION, documentKey: request.expectedDocumentKey,
            targetUuid: request.targetUuid, start: request.start, end: request.end, style: request.style,
            ...(request.paragraphStyle === undefined ? {} : { paragraphStyle: request.paragraphStyle }),
            before: request.expectedBefore, after: request.confirmedAfter };
        if (recordedRunsTextResultBytes(plan) > TEXT_RESULT_ADMISSION_BYTES)
            throw new Error(textResultSizeMessage(plan, recordedRunsTextResultBytes(plan)));
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
    description: 'Plan or apply size, tracking, horizontal and vertical scale, tsume (0-100), explicit fill, or installed font on a bounded UTF-16 range of a point-text frame (one line, or up to 32 items separated by CR or U+0003; a range cannot split a character or include a delimiter) in a layer or unlocked, visible group, bound by document key and native UUID. Fill must match the document color space (RGB, CMYK or Gray); a mismatch is refused, not converted. When the range ends immediately before CR or U+0003, every range character and that delimiter must share all recorded attributes; the plan reports the delimiter change and its before/after attributes. A differing or unreadable delimiter is refused before writing. All other characters and unrequested attributes stay unchanged and are compared before and after. `alignment` (`center` or `roman_baseline`) and `paragraph_style.leading_type` (`top_to_top` or `bottom_to_bottom`) are separate requests, not combined with other attributes. A size with more than five decimals is refused. A result over the apply size limit is refused with result_too_large: split the range or frame.',
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
        admit,
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
            const delimiter = textDelimiterRefusal(detail);
            if (delimiter !== null)
                return delimiter;
            const emptyStructure = emptyParagraphRefusal(detail);
            if (emptyStructure !== null)
                return emptyStructure;
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
