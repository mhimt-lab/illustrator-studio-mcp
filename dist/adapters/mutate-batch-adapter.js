import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { POINT_TEXT_APPLY_BLOCKERS, POINT_TEXT_BLOCKERS_SCRIPT, POINT_TEXT_CHARACTER_SCRIPT, POINT_TEXT_SNAPSHOT_SCRIPT, pointTextApplyBlockers, pointTextRangeSnapshotSchema, pointTextSingleLineSchema, pointTextSnapshotSchema, } from './point-text-host-script.js';
import { REPLACE_POINT_TEXT_MODULE_SCRIPT, REPLACE_POINT_TEXT_OPERATION, replacePointTextPlanSchema, } from './replace-point-text-adapter.js';
import { SET_TEXT_STYLE_MODULE_SCRIPT, SET_TEXT_STYLE_OPERATION, setTextStylePlanSchema, } from './set-text-style-adapter.js';
import { pathAppearanceMutationSchema, pathAppearanceStateSchema, SET_PATH_APPEARANCE_MODULE_SCRIPT, SET_PATH_APPEARANCE_OPERATION, } from './set-path-appearance-adapter.js';
import { snapshotsWithinTolerance, TRANSFORM_OBJECT_MODULE_SCRIPT, TRANSFORM_OBJECT_OPERATION, transformObjectPlanSchema, transformPathSnapshotSchema as transformObjectSnapshotSchema, translateTransformSchema, } from './transform-object-adapter.js';
export const MUTATE_BATCH_OPERATION = 'mutate_batch';
export const MUTATE_BATCH_VALIDATOR = { kind: MUTATE_BATCH_OPERATION, version: 1 };
export const MIXED_BATCH_MIN_STEPS = 2;
export const MIXED_BATCH_MAX_STEPS = 16;
export const MIXED_BATCH_MAX_TEXT_CODE_UNITS = 4_000;
export const MIXED_BATCH_MAX_STYLE_CHARACTERS = 200;
const CANONICAL_VERSION = 3;
const RESULT_SCHEMA_VERSION = 3;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
const uuidSchema = z.string().min(1).max(255);
const documentKeySchema = z.string().min(1).max(16_384);
const MIXED_OPERATIONS = [REPLACE_POINT_TEXT_OPERATION, SET_TEXT_STYLE_OPERATION, TRANSFORM_OBJECT_OPERATION,
    SET_PATH_APPEARANCE_OPERATION];
function sameCanonical(left, right) {
    return canonicalSha256(left) === canonicalSha256(right);
}
const styleSizeOnlySchema = z.strictObject({ size: z.number().finite().positive() });
const styleRgbFillOnlySchema = z.strictObject({ fillColor: z.strictObject({
        model: z.literal('rgb'),
        red: z.number().finite().min(0).max(255),
        green: z.number().finite().min(0).max(255),
        blue: z.number().finite().min(0).max(255),
    }) });
const batchStyleSchema = z.union([styleSizeOnlySchema, styleRgbFillOnlySchema]);
const internalStepCommon = { targetUuid: uuidSchema };
const internalReplaceStep = {
    ...internalStepCommon,
    operation: z.literal(REPLACE_POINT_TEXT_OPERATION),
    replacement: pointTextSingleLineSchema,
};
const internalStyleStep = {
    ...internalStepCommon,
    operation: z.literal(SET_TEXT_STYLE_OPERATION),
    start: z.number().int().safe().nonnegative(),
    end: z.number().int().safe().nonnegative(),
    style: batchStyleSchema,
};
const internalTransformStep = {
    ...internalStepCommon,
    operation: z.literal(TRANSFORM_OBJECT_OPERATION),
    transform: translateTransformSchema,
};
const internalAppearanceStep = {
    ...internalStepCommon,
    operation: z.literal(SET_PATH_APPEARANCE_OPERATION),
    appearance: pathAppearanceMutationSchema,
};
const internalPlanStepSchema = z.discriminatedUnion('operation', [
    z.strictObject(internalReplaceStep),
    z.strictObject(internalStyleStep),
    z.strictObject(internalTransformStep),
    z.strictObject(internalAppearanceStep),
]);
const internalApplyStepSchema = z.discriminatedUnion('operation', [
    z.strictObject({ ...internalReplaceStep, expectedBefore: pointTextSnapshotSchema, confirmedAfter: pointTextSnapshotSchema }),
    z.strictObject({ ...internalStyleStep, expectedBefore: pointTextRangeSnapshotSchema, confirmedAfter: pointTextRangeSnapshotSchema }),
    z.strictObject({ ...internalTransformStep, expectedBefore: transformObjectSnapshotSchema, confirmedAfter: transformObjectSnapshotSchema }),
    z.strictObject({ ...internalAppearanceStep, expectedBefore: pathAppearanceStateSchema, confirmedAfter: pathAppearanceStateSchema }),
]);
function refineSteps(steps, context) {
    const uuids = steps.map((step) => step.targetUuid);
    if (new Set(uuids).size !== uuids.length) {
        context.addIssue({ code: 'custom', message: 'Mixed batch steps must target distinct native UUIDs.' });
    }
    let textUnits = 0;
    let styleCharacters = 0;
    for (const step of steps) {
        if (step.operation === REPLACE_POINT_TEXT_OPERATION)
            textUnits += step.replacement.length;
        if (step.operation === SET_TEXT_STYLE_OPERATION) {
            if (step.start >= step.end) {
                context.addIssue({ code: 'custom', message: 'A set_text_style step needs a non-empty range.' });
            }
            if ('expectedBefore' in step)
                styleCharacters += step.expectedBefore.characters.length;
        }
    }
    if (textUnits > MIXED_BATCH_MAX_TEXT_CODE_UNITS) {
        context.addIssue({ code: 'custom', message: `Mixed batch replacement contents must total at most ${MIXED_BATCH_MAX_TEXT_CODE_UNITS} UTF-16 code units.` });
    }
    if (styleCharacters > MIXED_BATCH_MAX_STYLE_CHARACTERS) {
        context.addIssue({ code: 'custom', message: `Mixed batch set_text_style targets must total at most ${MIXED_BATCH_MAX_STYLE_CHARACTERS} characters.` });
    }
}
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({
        expectedDocumentKey: documentKeySchema,
        steps: z.array(internalPlanStepSchema).min(MIXED_BATCH_MIN_STEPS).max(MIXED_BATCH_MAX_STEPS).superRefine(refineSteps),
        apply: z.literal(false),
    }),
    z.strictObject({
        expectedDocumentKey: documentKeySchema,
        steps: z.array(internalApplyStepSchema).min(MIXED_BATCH_MIN_STEPS).max(MIXED_BATCH_MAX_STEPS).superRefine(refineSteps),
        apply: z.literal(true),
        commandId: canonicalCommandIdSchema,
    }),
]);
const publicTranslateSchema = z.strictObject({
    type: z.literal('translate'),
    delta_x: z.number().finite(),
    delta_y: z.number().finite(),
});
const publicReplaceStep = { operation: z.literal(REPLACE_POINT_TEXT_OPERATION), target_uuid: uuidSchema, replacement: pointTextSingleLineSchema };
const publicStyleStep = {
    operation: z.literal(SET_TEXT_STYLE_OPERATION), target_uuid: uuidSchema,
    start: z.number().int().safe().nonnegative(), end: z.number().int().safe().nonnegative(), style: z.union([
        styleSizeOnlySchema,
        z.strictObject({ fill_color: z.strictObject({
                red: z.number().finite().min(0).max(255), green: z.number().finite().min(0).max(255), blue: z.number().finite().min(0).max(255),
            }) }),
    ]),
};
const publicTransformStep = { operation: z.literal(TRANSFORM_OBJECT_OPERATION), target_uuid: uuidSchema, transform: publicTranslateSchema };
const publicAppearanceStep = { operation: z.literal(SET_PATH_APPEARANCE_OPERATION), target_uuid: uuidSchema,
    appearance: pathAppearanceMutationSchema };
const publicPlanStepSchema = z.discriminatedUnion('operation', [
    z.strictObject(publicReplaceStep), z.strictObject(publicStyleStep), z.strictObject(publicTransformStep), z.strictObject(publicAppearanceStep),
]);
const publicApplyStepSchema = z.discriminatedUnion('operation', [
    z.strictObject({ ...publicReplaceStep, expected_before: pointTextSnapshotSchema, confirmed_after: pointTextSnapshotSchema }),
    z.strictObject({ ...publicStyleStep, expected_before: pointTextRangeSnapshotSchema, confirmed_after: pointTextRangeSnapshotSchema }),
    z.strictObject({ ...publicTransformStep, expected_before: transformObjectSnapshotSchema, confirmed_after: transformObjectSnapshotSchema }),
    z.strictObject({ ...publicAppearanceStep, expected_before: pathAppearanceStateSchema, confirmed_after: pathAppearanceStateSchema }),
]);
function normalizeStep(step) {
    const cas = 'expected_before' in step
        ? { expectedBefore: step.expected_before, confirmedAfter: step.confirmed_after }
        : {};
    if (step.operation === REPLACE_POINT_TEXT_OPERATION) {
        return { operation: step.operation, targetUuid: step.target_uuid, replacement: step.replacement, ...cas };
    }
    if (step.operation === SET_TEXT_STYLE_OPERATION) {
        const style = 'fill_color' in step.style
            ? { fillColor: { model: 'rgb', ...step.style.fill_color } }
            : { size: step.style.size };
        return { operation: step.operation, targetUuid: step.target_uuid, start: step.start, end: step.end,
            style, ...cas };
    }
    if (step.operation === SET_PATH_APPEARANCE_OPERATION) {
        return { operation: step.operation, targetUuid: step.target_uuid, appearance: step.appearance, ...cas };
    }
    return { operation: step.operation, targetUuid: step.target_uuid,
        transform: { type: 'translate', deltaX: step.transform.delta_x, deltaY: step.transform.delta_y }, ...cas };
}
export const mutateBatchPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({
        expected_document_key: documentKeySchema,
        steps: z.array(publicPlanStepSchema).min(MIXED_BATCH_MIN_STEPS).max(MIXED_BATCH_MAX_STEPS)
            .superRefine((steps, context) => refineSteps(steps.map(normalizeStep), context)),
        apply: z.literal(false).default(false),
    }),
    z.strictObject({
        expected_document_key: documentKeySchema,
        steps: z.array(publicApplyStepSchema).min(MIXED_BATCH_MIN_STEPS).max(MIXED_BATCH_MAX_STEPS)
            .superRefine((steps, context) => refineSteps(steps.map(normalizeStep), context)),
        apply: z.literal(true),
        command_id: applyCommandIdSchema,
    }),
]);
const inputSchema = z.strictObject({
    expected_document_key: documentKeySchema,
    steps: z.array(z.strictObject({
        operation: z.enum(MIXED_OPERATIONS),
        target_uuid: uuidSchema,
        replacement: pointTextSingleLineSchema.optional(),
        start: z.number().int().safe().nonnegative().optional(),
        end: z.number().int().safe().nonnegative().optional(),
        style: z.union([styleSizeOnlySchema, z.strictObject({ fill_color: z.strictObject({
                    red: z.number().finite().min(0).max(255), green: z.number().finite().min(0).max(255), blue: z.number().finite().min(0).max(255),
                }) })]).optional(),
        transform: publicTranslateSchema.optional(),
        appearance: pathAppearanceMutationSchema.optional(),
        expected_before: z.union([pointTextSnapshotSchema, pointTextRangeSnapshotSchema, transformObjectSnapshotSchema, pathAppearanceStateSchema]).optional(),
        confirmed_after: z.union([pointTextSnapshotSchema, pointTextRangeSnapshotSchema, transformObjectSnapshotSchema, pathAppearanceStateSchema]).optional(),
    })).min(MIXED_BATCH_MIN_STEPS).max(MIXED_BATCH_MAX_STEPS),
    apply: z.boolean().default(false),
    command_id: applyCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(mutateBatchPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = mutateBatchPublicInputSchema.parse(input);
    const steps = value.steps.map(normalizeStep);
    return value.apply
        ? { expectedDocumentKey: value.expected_document_key, steps, apply: true, commandId: value.command_id }
        : { expectedDocumentKey: value.expected_document_key, steps, apply: false };
}
const blockerSchema = z.enum(POINT_TEXT_APPLY_BLOCKERS);
function unionBlockers(perStep) {
    const present = new Set();
    for (const blockers of perStep)
        for (const blocker of blockers)
            present.add(blocker);
    return POINT_TEXT_APPLY_BLOCKERS.filter((blocker) => present.has(blocker));
}
function transformBlockers(mutationAllowed, before) {
    const blockers = [];
    if (!mutationAllowed)
        blockers.push('document_mutation_not_allowed');
    if (before.locked)
        blockers.push('target_locked');
    if (before.hidden)
        blockers.push('target_hidden');
    if (!before.editable)
        blockers.push('target_not_editable');
    if (!before.layerVisible)
        blockers.push('layer_hidden');
    if (before.layerLocked)
        blockers.push('layer_locked');
    return blockers;
}
const planStepSchema = z.discriminatedUnion('operation', [
    z.strictObject({ operation: z.literal(REPLACE_POINT_TEXT_OPERATION), targetUuid: uuidSchema, plan: replacePointTextPlanSchema }),
    z.strictObject({ operation: z.literal(SET_TEXT_STYLE_OPERATION), targetUuid: uuidSchema, plan: setTextStylePlanSchema }),
    z.strictObject({ operation: z.literal(TRANSFORM_OBJECT_OPERATION), targetUuid: uuidSchema, plan: transformObjectPlanSchema }),
    z.strictObject({ operation: z.literal(SET_PATH_APPEARANCE_OPERATION), targetUuid: uuidSchema, plan: z.strictObject({
            targetUuid: uuidSchema,
            before: pathAppearanceStateSchema,
            after: pathAppearanceStateSchema,
            confirmationStatus: z.enum(['required', 'confirmed']),
            applyAllowed: z.boolean(),
        }) }),
]);
function planStepBlockers(step) {
    return step.operation === SET_PATH_APPEARANCE_OPERATION ? [] : step.plan.applyBlockedReasonCodes;
}
function stepRequest(step) {
    if (step.operation === REPLACE_POINT_TEXT_OPERATION)
        return { replacement: step.plan.replacement };
    if (step.operation === SET_TEXT_STYLE_OPERATION) {
        return { start: step.plan.start, end: step.plan.end, style: step.plan.style };
    }
    if (step.operation === SET_PATH_APPEARANCE_OPERATION)
        return { appearance: step.plan.after };
    return { transform: step.plan.transform };
}
function stepSame(step, left, right) {
    if (step.operation === TRANSFORM_OBJECT_OPERATION) {
        const parsedLeft = transformObjectSnapshotSchema.safeParse(left);
        const parsedRight = transformObjectSnapshotSchema.safeParse(right);
        return parsedLeft.success && parsedRight.success && snapshotsWithinTolerance(parsedLeft.data, parsedRight.data);
    }
    return sameCanonical(left, right);
}
const planSchema = z.strictObject({
    operation: z.literal(MUTATE_BATCH_OPERATION),
    documentKey: documentKeySchema,
    steps: z.array(planStepSchema).min(MIXED_BATCH_MIN_STEPS).max(MIXED_BATCH_MAX_STEPS),
    applyBlockedReasonCodes: z.array(blockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    const uuids = plan.steps.map((step) => step.targetUuid);
    if (new Set(uuids).size !== uuids.length) {
        context.addIssue({ code: 'custom', message: 'Mixed batch plan steps must target distinct UUIDs.' });
    }
    for (const step of plan.steps) {
        const identityMatches = step.operation === SET_PATH_APPEARANCE_OPERATION
            ? step.targetUuid === step.plan.targetUuid
            : step.targetUuid === step.plan.before.uuid && step.plan.documentKey === plan.documentKey;
        if (!identityMatches || step.plan.confirmationStatus !== plan.confirmationStatus) {
            context.addIssue({ code: 'custom', message: 'Mixed batch step plan must bind its own target and the batch document and confirmation.' });
        }
        if (step.operation === SET_TEXT_STYLE_OPERATION &&
            ((step.plan.style.size === undefined) === (step.plan.style.fillColor === undefined) ||
                Object.keys(step.plan.style).some((key) => key !== 'size' && key !== 'fillColor'))) {
            context.addIssue({ code: 'custom', message: 'Mixed batch set_text_style steps admit exactly size or RGB fillColor.' });
        }
        if (step.operation === TRANSFORM_OBJECT_OPERATION && step.plan.transform.type !== 'translate') {
            context.addIssue({ code: 'custom', message: 'Mixed batch transform_object steps admit translate only.' });
        }
    }
    const textBefore = plan.steps.reduce((sum, step) => sum + (step.operation === REPLACE_POINT_TEXT_OPERATION ? step.plan.before.contents.length : 0), 0);
    const textAfter = plan.steps.reduce((sum, step) => sum + (step.operation === REPLACE_POINT_TEXT_OPERATION ? step.plan.after.contents.length : 0), 0);
    const styleCharacters = plan.steps.reduce((sum, step) => sum + (step.operation === SET_TEXT_STYLE_OPERATION ? step.plan.before.characters.length : 0), 0);
    if (textBefore > MIXED_BATCH_MAX_TEXT_CODE_UNITS || textAfter > MIXED_BATCH_MAX_TEXT_CODE_UNITS ||
        styleCharacters > MIXED_BATCH_MAX_STYLE_CHARACTERS) {
        context.addIssue({ code: 'custom', message: 'Mixed batch plan exceeds a measured operation budget.' });
    }
    if (!sameCanonical(plan.applyBlockedReasonCodes, unionBlockers(plan.steps.map(planStepBlockers)))) {
        context.addIssue({ code: 'custom', message: 'Mixed batch blockers must be the ordered union of every step blocker.' });
    }
    const allowed = plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0;
    if (plan.applyAllowed !== allowed) {
        context.addIssue({ code: 'custom', message: 'Mixed batch applyAllowed must require confirmation and no blockers.' });
    }
});
const anySnapshotSchema = z.union([pointTextSnapshotSchema, pointTextRangeSnapshotSchema, transformObjectSnapshotSchema,
    pathAppearanceStateSchema]);
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']),
    reasonCode: z.enum(['apply_failed', 'verify_mismatch']),
    message: z.string().min(1).max(500),
}).superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed')) {
        context.addIssue({ code: 'custom', message: 'Mixed batch failure phase and reason code must match.' });
    }
});
const indeterminateFailureSchema = z.strictObject({
    phase: z.literal('apply'), reasonCode: z.literal('apply_indeterminate'), message: z.string().min(1).max(500),
});
const rollbackOutcomeSchema = z.enum(['not_written', 'restored', 'outstanding', 'indeterminate']);
const rollbackStepSchema = z.discriminatedUnion('operation', [
    z.strictObject({ operation: z.literal(REPLACE_POINT_TEXT_OPERATION), targetUuid: uuidSchema, outcome: rollbackOutcomeSchema,
        restoredSnapshot: pointTextSnapshotSchema.nullable(), observedSnapshot: pointTextSnapshotSchema.nullable() }),
    z.strictObject({ operation: z.literal(SET_TEXT_STYLE_OPERATION), targetUuid: uuidSchema, outcome: rollbackOutcomeSchema,
        restoredSnapshot: pointTextRangeSnapshotSchema.nullable(), observedSnapshot: pointTextRangeSnapshotSchema.nullable() }),
    z.strictObject({ operation: z.literal(TRANSFORM_OBJECT_OPERATION), targetUuid: uuidSchema, outcome: rollbackOutcomeSchema,
        restoredSnapshot: transformObjectSnapshotSchema.nullable(), observedSnapshot: transformObjectSnapshotSchema.nullable() }),
    z.strictObject({ operation: z.literal(SET_PATH_APPEARANCE_OPERATION), targetUuid: uuidSchema, outcome: rollbackOutcomeSchema,
        restoredSnapshot: pathAppearanceStateSchema.nullable(), observedSnapshot: pathAppearanceStateSchema.nullable() }),
]);
const rollbackEvidence = {
    attemptedCount: z.number().int().min(0).max(MIXED_BATCH_MAX_STEPS),
    steps: z.array(rollbackStepSchema).min(MIXED_BATCH_MIN_STEPS).max(MIXED_BATCH_MAX_STEPS),
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
        rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('mixed_state_unknown'),
            message: z.string().min(1).max(500), ...rollbackEvidence }), audit: mutationAuditSchema }),
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
        expected = [...prefix, 'apply:started:', 'apply:attempted:', 'apply:succeeded:', 'verify:started:', 'verify:succeeded:', 'rollback:skipped:not_required'];
    }
    else if (transaction.state === 'apply_failed') {
        expected = [...prefix, 'apply:started:', 'apply:failed:apply_failed', 'verify:skipped:not_required', 'rollback:skipped:not_required'];
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
        context.addIssue({ code: 'custom', message: 'Mixed batch audit sequence does not match transaction state.' });
    }
    transaction.audit.forEach((event, index) => {
        if (event.sequence !== index)
            context.addIssue({ code: 'custom', message: 'Mixed batch audit sequence must be contiguous.' });
    });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' && event.phase === transaction.failure.phase &&
            event.reasonCode === transaction.failure.reasonCode && event.message === transaction.failure.message);
        if (matches.length !== 1)
            context.addIssue({ code: 'custom', message: 'Mixed batch failure must match one audit event.' });
    }
    if ('rollback' in transaction && 'steps' in transaction.rollback) {
        const steps = transaction.rollback.steps;
        const attempted = transaction.rollback.attemptedCount;
        if (attempted > steps.length || steps.some((step, index) => (step.outcome === 'not_written') !== (index >= attempted))) {
            context.addIssue({ code: 'custom', message: 'Mixed batch rollback evidence must mark exactly the unattempted steps as not written.' });
        }
        if (transaction.state !== 'apply_indeterminate' && 'failure' in transaction && transaction.failure.phase === 'verify' &&
            attempted !== steps.length) {
            context.addIssue({ code: 'custom', message: 'A verify failure implies every mixed batch step was attempted.' });
        }
        if (transaction.state === 'rolled_back' &&
            (attempted === 0 || steps.some((step, index) => index < attempted && step.outcome !== 'restored'))) {
            context.addIssue({ code: 'custom', message: 'A rolled-back mixed batch must prove every attempted step restored.' });
        }
        if (transaction.state === 'rollback_failed' &&
            (steps.some((step) => step.outcome === 'indeterminate') || !steps.some((step) => step.outcome === 'outstanding'))) {
            context.addIssue({ code: 'custom', message: 'A failed mixed batch rollback must name an outstanding step and prove the rest.' });
        }
        for (const step of steps) {
            if ((step.outcome === 'restored') !== (step.restoredSnapshot !== null) ||
                (step.outcome === 'outstanding') !== (step.observedSnapshot !== null) ||
                (step.operation !== SET_PATH_APPEARANCE_OPERATION && step.restoredSnapshot !== null && step.restoredSnapshot.uuid !== step.targetUuid) ||
                (step.operation !== SET_PATH_APPEARANCE_OPERATION && step.observedSnapshot !== null && step.observedSnapshot.uuid !== step.targetUuid)) {
                context.addIssue({ code: 'custom', message: 'Mixed batch rollback step snapshots must match their outcome and target.' });
            }
        }
    }
});
export const mutateBatchResultSchema = z.union([
    z.strictObject({ operation: z.literal(MUTATE_BATCH_OPERATION), applied: z.literal(false),
        document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ operation: z.literal(MUTATE_BATCH_OPERATION), applied: z.literal(true),
        document: documentContextSchema, plan: planSchema,
        postcondition: z.array(anySnapshotSchema).min(MIXED_BATCH_MIN_STEPS).max(MIXED_BATCH_MAX_STEPS),
        transaction: transactionSchema }),
]).superRefine((result, context) => {
    if (result.transaction.state === 'planned') {
        const exact = result.plan.steps.every((step) => step.operation === SET_PATH_APPEARANCE_OPERATION || sameCanonical(step.plan.applyBlockedReasonCodes, step.operation === TRANSFORM_OBJECT_OPERATION
            ? transformBlockers(result.document.mutationAllowed, step.plan.before)
            : pointTextApplyBlockers(result.document.mutationAllowed, step.plan.before)));
        if (result.plan.confirmationStatus !== 'required' || !exact) {
            context.addIssue({ code: 'custom', message: 'Planned mixed batch must expose exact blockers for every step.' });
        }
    }
    else if (result.plan.confirmationStatus !== 'confirmed' || result.plan.applyBlockedReasonCodes.length !== 0 ||
        !result.plan.applyAllowed || result.plan.steps.some((step) => planStepBlockers(step).length !== 0) ||
        result.plan.steps.some((step) => step.operation !== SET_PATH_APPEARANCE_OPERATION && (step.operation === TRANSFORM_OBJECT_OPERATION
            ? transformBlockers(true, step.plan.before) : pointTextApplyBlockers(true, step.plan.before)).length !== 0)) {
        context.addIssue({ code: 'custom', message: 'Applied mixed batch attempt must derive from an allowed confirmed plan.' });
    }
    if (result.applied) {
        const matches = result.transaction.state === 'verified' && result.postcondition.length === result.plan.steps.length &&
            result.plan.steps.every((step, index) => stepSame(step, result.postcondition[index], step.plan.after));
        if (!matches)
            context.addIssue({ code: 'custom', message: 'Verified mixed batch must match every planned after snapshot in order.' });
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified mixed batch transaction must be applied.' });
    }
    if ('rollback' in result.transaction && 'steps' in result.transaction.rollback) {
        const rollbackSteps = result.transaction.rollback.steps;
        if (rollbackSteps.length !== result.plan.steps.length || rollbackSteps.some((step, index) => step.targetUuid !== result.plan.steps[index].targetUuid || step.operation !== result.plan.steps[index].operation)) {
            context.addIssue({ code: 'custom', message: 'Mixed batch rollback evidence must cover every plan step in order.' });
        }
        else if (rollbackSteps.some((step, index) => step.outcome === 'restored' && !stepSame(result.plan.steps[index], step.restoredSnapshot, result.plan.steps[index].plan.before))) {
            context.addIssue({ code: 'custom', message: 'Restored mixed batch steps must prove exact before restoration.' });
        }
    }
});
export const mutateBatchResponseSchema = z.strictObject({
    outcome: mutateBatchResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
export const MUTATE_BATCH_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: MUTATE_BATCH_OPERATION,
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
        class: 'update_existing', explicitDocumentBinding: true, bindTargetNativeUuid: true, captureBeforeStateHash: true,
        compareAndSetBeforeApply: true, verifyUpdatedState: true, recoveryMode: 'verified_inverse', verifyRestoredBeforeState: true,
        reconcileIndeterminate: true, durableTerminalReplay: true, trustedTerminalAttestationResolver: true,
    },
});
export const MUTATE_BATCH_SAFETY_IDENTITY = canonicalDigest(MUTATE_BATCH_SAFETY);
function targetEvidence(result) {
    const targetUuids = result.plan.steps.map((step) => step.targetUuid);
    return { targetUuids, targetSetHash: canonicalDigest(targetUuids) };
}
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    const beforeStateHash = canonicalDigest(result.plan.steps.map((step) => step.plan.before));
    const afterStateHash = canonicalDigest(result.plan.steps.map((step) => step.plan.after));
    const changeSetHash = canonicalDigest({
        steps: result.plan.steps.map((step) => ({ operation: step.operation, targetUuid: step.targetUuid, request: stepRequest(step),
            beforeStateHash: canonicalDigest(step.plan.before), afterStateHash: canonicalDigest(step.plan.after) })),
        beforeStateHash, afterStateHash,
    });
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'update_existing', operationId: MUTATE_BATCH_OPERATION, canonicalRequestDigest: requestDigest,
        evidence: { documentKey: admissionDocumentKey, ...targetEvidence(result), beforeStateHash,
            plannedAfterStateHash: afterStateHash, plannedChangeSetDigest: changeSetHash },
        preconditions: { status: result.plan.applyBlockedReasonCodes.length === 0 ? 'satisfied' : 'blocked',
            compareAndSetMatched: result.plan.applyBlockedReasonCodes.length === 0 },
        confirmation: { kind: 'exact_change_set', canonicalRequestDigest: requestDigest, changeSetHash, status: result.plan.confirmationStatus },
        applyAllowed: result.plan.applyAllowed,
    });
}
function safetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' ||
        transaction.state === 'rollback_indeterminate' || transaction.state === 'rollback_failed') {
        throw new Error('Indeterminate or failed mixed batch recovery cannot be terminal.');
    }
    const common = { policyVersion: 1, operationClass: 'update_existing', operationId: MUTATE_BATCH_OPERATION,
        canonicalRequestDigest: requestDigest, planDigest: plan.planDigest, attestation };
    const boundPlan = plan;
    const beforeStateHash = boundPlan.evidence.beforeStateHash;
    const evidence = targetEvidence(result);
    if (transaction.state === 'verified' && result.applied) {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { ...evidence, beforeStateHash, afterStateHash: boundPlan.evidence.plannedAfterStateHash, restoredStateHash: null, restoredBeforeStateVerified: false },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'succeeded', terminal: true, recovery: 'not_required', proof: { kind: 'verified_postcondition' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    if (transaction.state === 'rolled_back') {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { ...evidence, beforeStateHash, afterStateHash: null, restoredStateHash: beforeStateHash, restoredBeforeStateVerified: true },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'recovered', terminal: true, recovery: 'verified', proof: { kind: 'verified_recovery' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    return operationSafetyResultSchema.parse({ ...common,
        evidence: { ...evidence, beforeStateHash, afterStateHash: null, restoredStateHash: null, restoredBeforeStateVerified: false },
        executionEvidence: { outcome: 'proven_pre_apply' },
        resolution: { status: 'failed', terminal: true, recovery: 'not_required', proof: { kind: 'proven_pre_apply', mutationAttempted: false },
            replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
}
async function assertSafety(value, requestDigest, attestation, resolver) {
    const result = mutateBatchResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null)
        throw new Error('Mixed batch terminal result requires attestation.');
    await assertOperationSafetyAdapterConformance({ registration: MUTATE_BATCH_SAFETY, plan,
        result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
export const MUTATE_BATCH_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${POINT_TEXT_SNAPSHOT_SCRIPT}
${POINT_TEXT_BLOCKERS_SCRIPT}
${POINT_TEXT_CHARACTER_SCRIPT}
${REPLACE_POINT_TEXT_MODULE_SCRIPT}
${SET_TEXT_STYLE_MODULE_SCRIPT}
${TRANSFORM_OBJECT_MODULE_SCRIPT}
${SET_PATH_APPEARANCE_MODULE_SCRIPT}
var MIXED_BATCH_MIN_STEPS = ${MIXED_BATCH_MIN_STEPS};
var MIXED_BATCH_MAX_STEPS = ${MIXED_BATCH_MAX_STEPS};
var MIXED_BATCH_MAX_TEXT_CODE_UNITS = ${MIXED_BATCH_MAX_TEXT_CODE_UNITS};
var MIXED_BATCH_MAX_STYLE_CHARACTERS = ${MIXED_BATCH_MAX_STYLE_CHARACTERS};
var MIXED_BLOCKER_ORDER = ${JSON.stringify(POINT_TEXT_APPLY_BLOCKERS)};

/**
 * The operation modules read the implicit \`params\`. Each step gets a complete synthetic \`params\` in the
 * exact shape that operation's runner would have read, and every module call runs through
 * withStepParams, which restores the batch params in finally even when the module throws.
 */
var MIXED_OPERATIONS = {
  replace_point_text: {
    resolve: function () { return pointTextResolve(false); },
    plan: pointTextPlan, same: pointTextSame, apply: pointTextApply, verify: pointTextVerify, rollback: pointTextRollback
  },
  set_text_style: {
    resolve: function () { return styleResolve(false); },
    plan: stylePlan, same: styleSame, apply: styleApply, verify: styleVerify, rollback: styleRollback
  },
  transform_object: {
    resolve: function () { return transformResolve(false); },
    plan: transformPlan, same: transformSnapshotMatches, apply: transformApply, verify: transformVerify, rollback: transformRollback
  },
  set_path_appearance: {
    resolve: function () { var resolved = appearancePreflight(false); resolved.document = resolved.doc; return resolved; },
    plan: appearancePlan, same: appearanceEqual, apply: appearanceApply,
    verify: function (resolved, plan) { return appearanceVerify(resolved, plan).postcondition.appearance; },
    rollback: function (state) {
      var outcome = appearanceRollback(state);
      state.operationState.rollbackEvidence.restoredSnapshot = state.operationState.rollbackEvidence.restoredAppearance;
      return outcome;
    }
  }
};

function mixedStepParams(batchParams, request, index) {
  var step = { expectedDocumentKey: batchParams.expectedDocumentKey, apply: batchParams.apply === true,
    targetUuid: request.targetUuid };
  if (request.operation === "replace_point_text") step.replacement = request.replacement;
  else if (request.operation === "set_text_style") { step.start = request.start; step.end = request.end; step.style = request.style; }
  else if (request.operation === "transform_object") step.transform = request.transform;
  else if (request.operation === "set_path_appearance") step.appearance = request.appearance;
  else throw mutationError("preflight_failed", "Step " + (index + 1) + ": unsupported operation " + String(request.operation) + ".");
  if (request.expectedBefore !== undefined) step.expectedBefore = request.expectedBefore;
  if (request.confirmedAfter !== undefined) step.confirmedAfter = request.confirmedAfter;
  return step;
}

function withStepParams(step, fn) {
  var saved = params;
  params = step.params;
  try { return fn(); }
  finally { params = saved; }
}

function mixedStepLabel(step) {
  return "Step " + (step.index + 1) + " (" + step.request.operation + ", " + step.request.targetUuid + ")";
}

/** Re-raises a mutation error with the step named; other errors (MCP_ERROR payloads) pass through. */
function mixedStepError(step, error) {
  if (error && typeof error.mutationPublicMessage === "string" && error.mutationPublicMessage.length > 0) {
    var named = mutationError(error.mutationReasonCode || "preflight_failed", mixedStepLabel(step) + ": " + error.mutationPublicMessage);
    if (error.mutationBeforeSideEffect === true) named.mutationBeforeSideEffect = true;
    return named;
  }
  return error;
}

function mixedUnionBlockers(perStep) {
  var present = {};
  for (var stepIndex = 0; stepIndex < perStep.length; stepIndex++) {
    for (var blockerIndex = 0; blockerIndex < perStep[stepIndex].length; blockerIndex++) present[perStep[stepIndex][blockerIndex]] = true;
  }
  var union = [];
  for (var orderIndex = 0; orderIndex < MIXED_BLOCKER_ORDER.length; orderIndex++) {
    if (present[MIXED_BLOCKER_ORDER[orderIndex]]) union.push(MIXED_BLOCKER_ORDER[orderIndex]);
  }
  return union;
}

/**
 * Resolves the document exactly once, then every step through its module, before any write. Called from
 * preflight and again from revalidate.
 */
function mixedResolve(forApply) {
  var batchParams = params;
  var context = forApply ? requireDocument(batchParams.expectedDocumentKey) : requireDocumentForRead(batchParams.expectedDocumentKey);
  var document = app.activeDocument;
  var requested = batchParams.steps;
  if (!requested || typeof requested.length !== "number" ||
      requested.length < MIXED_BATCH_MIN_STEPS || requested.length > MIXED_BATCH_MAX_STEPS) {
    throw mutationError("preflight_failed", "Mixed batch requires " + MIXED_BATCH_MIN_STEPS + " to " + MIXED_BATCH_MAX_STEPS + " steps.");
  }
  var seen = {};
  var entries = [];
  var perStepBlockers = [];
  var textBefore = 0;
  var textAfter = 0;
  var styleCharacters = 0;
  for (var index = 0; index < requested.length; index++) {
    var request = requested[index];
    if (typeof request.targetUuid !== "string" || request.targetUuid.length === 0 || seen["u:" + request.targetUuid] === true) {
      throw mutationError("preflight_failed", "Mixed batch steps must target distinct non-empty native UUIDs.");
    }
    seen["u:" + request.targetUuid] = true;
    var operation = MIXED_OPERATIONS[request.operation];
    var step = { index: index, request: request, params: mixedStepParams(batchParams, request, index) };
    if (!operation) throw mutationError("preflight_failed", mixedStepLabel(step) + ": unsupported operation.");
    var resolved;
    var plan;
    try {
      resolved = withStepParams(step, function () { return operation.resolve(); });
      if (resolved.document !== document) {
        throw mutationError("preflight_failed", "resolved a different document than the batch holds.");
      }
      plan = withStepParams(step, function () { return operation.plan(resolved); });
    } catch (stepError) { throw mixedStepError(step, stepError); }
    if (request.operation === "replace_point_text") { textBefore += plan.before.contents.length; textAfter += plan.after.contents.length; }
    if (request.operation === "set_text_style") styleCharacters += plan.before.characters.length;
    if (forApply) {
      if (!operation.same(plan.before, request.expectedBefore)) {
        throw mutationError("preflight_failed", mixedStepLabel(step) + ": state does not match expected_before.");
      }
      if (!operation.same(plan.after, request.confirmedAfter)) {
        throw mutationError("preflight_failed", mixedStepLabel(step) + ": confirmed_after does not match the derived state.");
      }
    }
    perStepBlockers.push(plan.applyBlockedReasonCodes || []);
    entries.push({ step: step, resolved: resolved, plan: plan });
  }
  if (textBefore > MIXED_BATCH_MAX_TEXT_CODE_UNITS || textAfter > MIXED_BATCH_MAX_TEXT_CODE_UNITS) {
    throw mutationError("preflight_failed", "Mixed batch point-text contents exceed " + MIXED_BATCH_MAX_TEXT_CODE_UNITS + " UTF-16 code units in total.");
  }
  if (styleCharacters > MIXED_BATCH_MAX_STYLE_CHARACTERS) {
    throw mutationError("preflight_failed", "Mixed batch set_text_style targets exceed " + MIXED_BATCH_MAX_STYLE_CHARACTERS + " characters in total.");
  }
  var union = mixedUnionBlockers(perStepBlockers);
  if (forApply && union.length > 0) {
    var blockedUuids = [];
    for (var blockedIndex = 0; blockedIndex < entries.length; blockedIndex++) {
      if (perStepBlockers[blockedIndex].length > 0) blockedUuids.push(entries[blockedIndex].step.request.targetUuid);
    }
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "MUTATE_BATCH_APPLY_BLOCKED", reasonCodes: union, uuids: blockedUuids }));
  }
  return { context: context, document: document, entries: entries, blockers: union };
}

function mixedPreflight(forApply) { return mixedResolve(forApply); }

function mixedPlan(preflight) {
  var steps = [];
  for (var index = 0; index < preflight.entries.length; index++) {
    var entry = preflight.entries[index];
    steps.push({ operation: entry.step.request.operation, targetUuid: entry.step.request.targetUuid, plan: entry.plan });
  }
  return {
    operation: "mutate_batch", documentKey: preflight.context.key, steps: steps,
    applyBlockedReasonCodes: preflight.blockers,
    confirmationStatus: params.apply === true ? "confirmed" : "required",
    applyAllowed: params.apply === true && preflight.blockers.length === 0
  };
}

function mixedRevalidate(preflight, plan) {
  var current;
  try { current = mixedResolve(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Mixed batch preconditions changed before apply.")); }
  if (current.document !== preflight.document || current.entries.length !== preflight.entries.length) {
    throw mutationBeforeSideEffectError("Mixed batch document or step count changed before apply.");
  }
  for (var index = 0; index < current.entries.length; index++) {
    var operation = MIXED_OPERATIONS[preflight.entries[index].step.request.operation];
    if (current.entries[index].resolved.target !== preflight.entries[index].resolved.target ||
        !operation.same(current.entries[index].plan.before, plan.steps[index].plan.before) ||
        !operation.same(current.entries[index].plan.after, plan.steps[index].plan.after)) {
      throw mutationBeforeSideEffectError(mixedStepLabel(preflight.entries[index].step) + ": target or state changed before apply.");
    }
  }
}

function mixedStepState(entry) {
  var rollbackEvidence = entry.step.request.operation === "set_path_appearance"
    ? { targetUuid: entry.step.request.targetUuid, restoredAppearance: null, restoredSnapshot: null }
    : { targetUuid: entry.step.request.targetUuid, restoredSnapshot: null };
  return { preflight: entry.resolved, plan: entry.plan,
    operationState: { mutationStarted: false, rollbackEvidence: rollbackEvidence } };
}

function mixedApply(preflight, plan, state) {
  state.operationState.mutationStarted = true;
  state.operationState.stepStates = [];
  for (var index = 0; index < preflight.entries.length; index++) {
    state.operationState.stepStates.push(mixedStepState(preflight.entries[index]));
  }
  for (var applyIndex = 0; applyIndex < preflight.entries.length; applyIndex++) {
    var entry = preflight.entries[applyIndex];
    var operation = MIXED_OPERATIONS[entry.step.request.operation];
    var stepState = state.operationState.stepStates[applyIndex];
    // Recorded before the write: a throw mid-write still counts this step as attempted.
    state.operationState.attemptedCount = applyIndex + 1;
    state.operationState.rollbackEvidence.attemptedCount = applyIndex + 1;
    withStepParams(entry.step, function () { return operation.apply(entry.resolved, entry.plan, stepState); });
  }
  return preflight.entries.length;
}

function mixedVerify(preflight, plan) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) {
    throw mutationError("verify_mismatch", "Active document changed during mixed batch verification.");
  }
  var actual = [];
  for (var index = 0; index < preflight.entries.length; index++) {
    var entry = preflight.entries[index];
    var operation = MIXED_OPERATIONS[entry.step.request.operation];
    var snapshot;
    try { snapshot = withStepParams(entry.step, function () { return operation.verify(entry.resolved, entry.plan); }); }
    catch (verifyError) { throw mixedStepError(entry.step, verifyError); }
    actual.push(snapshot);
  }
  return actual;
}

function mixedInitialRollbackEvidence() {
  var steps = [];
  for (var index = 0; index < params.steps.length; index++) {
    steps.push({ operation: params.steps[index].operation, targetUuid: params.steps[index].targetUuid,
      outcome: "not_written", restoredSnapshot: null, observedSnapshot: null });
  }
  return { attemptedCount: 0, steps: steps };
}

function mixedMarkIndeterminate(evidence, count) {
  for (var index = 0; index < count; index++) {
    evidence[index].outcome = "indeterminate";
    evidence[index].restoredSnapshot = null;
    evidence[index].observedSnapshot = null;
  }
}

/** Walks the attempted steps in reverse request order through each operation's own rollback. */
function mixedRollback(state) {
  var preflight = state.preflight;
  var evidence = state.operationState.rollbackEvidence.steps;
  var attempted = state.operationState.attemptedCount || 0;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) {
    mixedMarkIndeterminate(evidence, attempted);
    return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
  }
  var firstIndeterminate = null;
  var firstOutstanding = null;
  for (var index = attempted - 1; index >= 0; index--) {
    var entry = preflight.entries[index];
    var operation = MIXED_OPERATIONS[entry.step.request.operation];
    var stepState = state.operationState.stepStates[index];
    var outcome;
    try { outcome = withStepParams(entry.step, function () { return operation.rollback(stepState); }); }
    catch (rollbackError) { outcome = { status: "indeterminate", message: mutationPublicMessage(rollbackError, "operation rollback threw") }; }
    if (!outcome || (outcome.status !== "verified" && outcome.status !== "failed" && outcome.status !== "indeterminate")) {
      outcome = { status: "indeterminate", message: "operation rollback returned an invalid outcome" };
    }
    var observed = stepState.operationState.rollbackEvidence.restoredSnapshot;
    if (outcome.status === "verified") {
      evidence[index].outcome = "restored"; evidence[index].restoredSnapshot = observed; evidence[index].observedSnapshot = null;
    } else if (outcome.status === "failed") {
      evidence[index].outcome = "outstanding"; evidence[index].restoredSnapshot = null; evidence[index].observedSnapshot = observed;
      if (firstOutstanding === null) firstOutstanding = mixedStepLabel(entry.step) + ": " + (outcome.message || "restore did not take effect");
    } else {
      evidence[index].outcome = "indeterminate"; evidence[index].restoredSnapshot = null; evidence[index].observedSnapshot = null;
      if (firstIndeterminate === null) firstIndeterminate = mixedStepLabel(entry.step) + ": " + (outcome.message || "state is indeterminate");
    }
  }
  if (firstIndeterminate !== null) return { status: "indeterminate", message: "Rollback is indeterminate. " + firstIndeterminate };
  if (firstOutstanding !== null) return { status: "failed", message: "Rollback did not restore every attempted step. " + firstOutstanding };
  return { status: "verified" };
}

var mixedExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionAffected: function () { var uuids = []; var seen = {}; for (var i = 0; i < params.steps.length; i++) { var uuid = params.steps[i].targetUuid; if (!seen.hasOwnProperty(uuid)) { seen[uuid] = true; uuids.push(uuid); } } return uuids; },
  initialOperationState: function () { return { mutationStarted: false, attemptedCount: 0, stepStates: [],
    rollbackEvidence: mixedInitialRollbackEvidence() }; },
  preflight: mixedPreflight,
  plan: mixedPlan,
  revalidate: mixedRevalidate,
  applyMutation: mixedApply,
  verify: mixedVerify,
  rollback: mixedRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function (state) {
    var steps = state.operationState.rollbackEvidence.steps;
    mixedMarkIndeterminate(steps, steps.length);
    return { reasonCode: "mixed_state_unknown", message: "Mixed batch apply outcome is indeterminate.",
      evidence: { attemptedCount: steps.length, steps: steps } };
  },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var mixedDocument = mixedExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === mixedExecution.preflight.document) mixedDocument = getDocumentContext();
var result = { operation: "mutate_batch", applied: mixedExecution.transaction.state === "verified",
  document: mixedDocument, plan: mixedExecution.plan, transaction: mixedExecution.transaction };
if (mixedExecution.transaction.state === "verified") result.postcondition = mixedExecution.value;
`;
export const MUTATE_BATCH_HOST_SCRIPT_DIGEST = canonicalSha256(MUTATE_BATCH_SCRIPT);
export const MUTATE_BATCH_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: MUTATE_BATCH_OPERATION, validator: MUTATE_BATCH_VALIDATOR,
    canonicalContractVersion: CANONICAL_VERSION, resultSchemaVersion: RESULT_SCHEMA_VERSION,
    terminalClassifierVersion: CLASSIFIER_VERSION, safetyConformanceVersion: CONFORMANCE_VERSION,
    errorMappingVersion: ERROR_MAPPING_VERSION, safetyIdentity: MUTATE_BATCH_SAFETY_IDENTITY,
    hostScriptDigest: MUTATE_BATCH_HOST_SCRIPT_DIGEST, mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    const digestRequest = 'commandId' in request ? (({ commandId: _commandId, ...rest }) => rest)(request) : request;
    const digest = canonicalSha256({ operation: MUTATE_BATCH_OPERATION, validator: MUTATE_BATCH_VALIDATOR,
        request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: 'commandId' in request ? request.commandId : null,
        documentKey: request.expectedDocumentKey, digest };
}
export const mutateBatchToolContract = {
    name: 'illustrator_mutate_batch',
    title: 'Plan or Apply a Mixed Mutation Batch',
    description: `Plan or apply ${MIXED_BATCH_MIN_STEPS} to ${MIXED_BATCH_MAX_STEPS} ordered steps of replace_point_text, set_text_style (size or RGB fill), transform_object (translate only), and set_path_appearance on distinct native UUIDs in one document as one command. Planning evaluates every step and writes nothing; any stale, unsupported, or blocked step rejects the whole batch before a single write. Apply performs exact per-step compare-and-set in one host call, native read-back verification of every step, and verified inverse rollback of attempted steps in reverse order. Point-text contents total at most ${MIXED_BATCH_MAX_TEXT_CODE_UNITS} UTF-16 code units and set_text_style targets at most ${MIXED_BATCH_MAX_STYLE_CHARACTERS} characters.`,
    inputSchema,
    publicInputSchema: mutateBatchPublicInputSchema,
    outputSchema: mutateBatchResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(MUTATE_BATCH_SAFETY.policy),
    normalizePublicInput,
};
export function createMutateBatchAdapter() {
    return {
        version: 1, operation: MUTATE_BATCH_OPERATION, validator: MUTATE_BATCH_VALIDATOR,
        safety: MUTATE_BATCH_SAFETY, safetyRegistrationIdentity: MUTATE_BATCH_SAFETY_IDENTITY,
        adapterIdentity: MUTATE_BATCH_ADAPTER_IDENTITY, tool: mutateBatchToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: mutateBatchResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: CLASSIFIER_VERSION, safetyConformanceVersion: CONFORMANCE_VERSION,
        errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: MUTATE_BATCH_HOST_SCRIPT_DIGEST,
        mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: MUTATE_BATCH_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: MUTATE_BATCH_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: MUTATE_BATCH_OPERATION,
                    documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: MUTATE_BATCH_ADAPTER_IDENTITY, mutationHostApplicationMode: 'foreground',
                script: MUTATE_BATCH_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = mutateBatchResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back')
                return { state };
            if (state === 'planned')
                throw new Error('Mixed batch plan is not a terminal mutation result.');
            throw new Error('Unverified mixed batch recovery must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error, detail) {
            if (detail?.code === 'OBJECT_NOT_FOUND') {
                return new Error(`No PageItem with UUID ${JSON.stringify(detail.uuid ?? '')} exists in the bound document.`);
            }
            if (detail?.code === 'MUTATE_BATCH_APPLY_BLOCKED') {
                const uuids = detail.uuids ?? [];
                return new Error(`Mixed batch is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}` +
                    `${uuids.length > 0 ? ` (targets ${uuids.map((uuid) => JSON.stringify(uuid)).join(', ')})` : ''}.`);
            }
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
