import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, layerPathSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { normalizePointTextPublicFillColor, POINT_TEXT_JUSTIFICATIONS, POINT_TEXT_MAX_LAYER_DEPTH_LIMIT, POINT_TEXT_PROFILE_NAME, POINT_TEXT_SNAPSHOT_SCRIPT, pointTextFillColorRequestSchema, pointTextFillColorSchema, pointTextPublicFillColorSchema, pointTextSingleLineSchema, pointTextSnapshotSchema, } from './point-text-host-script.js';
import { CREATE_POINT_TEXT_MAX_DIRECT_ITEMS, CREATE_POINT_TEXT_MODULE_SCRIPT, CREATE_POINT_TEXT_OPERATION, } from './create-point-text-adapter.js';
import { CREATE_RECTANGLE_MODULE_SCRIPT } from './create-rectangle/jsx.js';
import { CREATION_APPEARANCE_MODULE_SCRIPT, creationAppearanceMatches, creationAppearanceSchema, creationAppearanceStateSchema, } from './create-appearance.js';
import { CREATE_SHAPE_MODULE_SCRIPT, CREATE_SHAPE_OPERATION, createShapeShapeSchema, geometrySchema as shapeGeometrySchema, deriveShapeGeometry, geometryWithinTolerance, normalizePublicShape, publicShapeSchema, } from './create-shape-adapter.js';
import { RECTANGLE_BOUNDS_PRECISION_DIGITS } from './create-rectangle/domain.js';
export const CREATE_BATCH_OPERATION = 'create_batch';
export const CREATE_BATCH_VALIDATOR = { kind: CREATE_BATCH_OPERATION, version: 1 };
export const CREATE_BATCH_MIN_STEPS = 2;
export const CREATE_BATCH_MAX_STEPS = 16;
export const CREATE_BATCH_MAX_TEXT_CODE_UNITS = 4_000;
export const CREATE_BATCH_MAX_SHAPE_ANCHORS = 256;
export const CREATE_BATCH_MAX_LAYER_ITEMS = CREATE_POINT_TEXT_MAX_DIRECT_ITEMS;
export const CREATE_RECTANGLE_OPERATION = 'create_rectangle';
const CANONICAL_VERSION = 2;
const RESULT_SCHEMA_VERSION = 2;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 2;
const ERROR_MAPPING_VERSION = 1;
const uuidSchema = z.string().min(1).max(255);
const documentKeySchema = z.string().min(1).max(16_384);
const CREATE_OPERATIONS = [CREATE_POINT_TEXT_OPERATION, CREATE_RECTANGLE_OPERATION, CREATE_SHAPE_OPERATION];
export const CREATE_BATCH_BLOCKERS = [
    'document_mutation_not_allowed',
    'layer_hidden',
    'ancestor_hidden',
    'layer_locked',
    'ancestor_locked',
    'layer_item_capacity_exceeded',
];
const blockerSchema = z.enum(CREATE_BATCH_BLOCKERS);
function sameCanonical(left, right) {
    return canonicalSha256(left) === canonicalSha256(right);
}
const canonicalNumberSchema = z.number().finite().transform((value) => Object.is(value, -0) ? 0 : value);
const styleSchema = z.strictObject({
    fontPostScriptName: z.string().min(1).max(255),
    size: z.number().finite().positive(),
    tracking: z.number().finite(),
    justification: z.enum(POINT_TEXT_JUSTIFICATIONS),
    fillColor: pointTextFillColorSchema,
});
const styleRequestSchema = z.strictObject({
    fontPostScriptName: z.string().min(1).max(255),
    size: canonicalNumberSchema.pipe(z.number().positive()),
    tracking: canonicalNumberSchema,
    justification: z.enum(POINT_TEXT_JUSTIFICATIONS),
    fillColor: pointTextFillColorRequestSchema,
});
const publicStyleSchema = z.strictObject({
    font_post_script_name: z.string().min(1).max(255),
    size: z.number().finite().positive(),
    tracking: z.number().finite(),
    justification: z.enum(POINT_TEXT_JUSTIFICATIONS).optional(),
    fill_color: pointTextPublicFillColorSchema,
});
const anchorSchema = z.tuple([z.number().finite(), z.number().finite()]);
const anchorRequestSchema = z.tuple([canonicalNumberSchema, canonicalNumberSchema]);
const rectangleNameSchema = z.string().max(255);
const stepCommon = {
    expectedLayerPath: layerPathSchema,
    artboardIndex: z.number().int().safe().nonnegative(),
};
const internalStepSchema = z.discriminatedUnion('operation', [
    z.strictObject({
        ...stepCommon,
        operation: z.literal(CREATE_POINT_TEXT_OPERATION),
        anchor: anchorRequestSchema,
        contents: pointTextSingleLineSchema,
        style: styleRequestSchema,
    }),
    z.strictObject({
        ...stepCommon,
        operation: z.literal(CREATE_RECTANGLE_OPERATION),
        x: canonicalNumberSchema,
        y: canonicalNumberSchema,
        width: canonicalNumberSchema.pipe(z.number().positive()),
        height: canonicalNumberSchema.pipe(z.number().positive()),
        name: rectangleNameSchema.optional(),
        appearance: creationAppearanceSchema.optional(),
    }),
    z.strictObject({
        ...stepCommon,
        operation: z.literal(CREATE_SHAPE_OPERATION),
        shape: createShapeShapeSchema,
        name: rectangleNameSchema.optional(),
        appearance: creationAppearanceSchema.optional(),
    }),
]);
function refineSteps(steps, context) {
    let textUnits = 0;
    let shapeAnchors = 0;
    const perLayer = new Map();
    for (const step of steps) {
        if (step.operation === CREATE_POINT_TEXT_OPERATION)
            textUnits += step.contents.length;
        if (step.operation === CREATE_SHAPE_OPERATION)
            shapeAnchors += deriveShapeGeometry([0, 0, 0, 0], step.shape).anchors.length;
        const key = step.expectedLayerPath.join('.');
        perLayer.set(key, (perLayer.get(key) ?? 0) + 1);
    }
    if (textUnits > CREATE_BATCH_MAX_TEXT_CODE_UNITS) {
        context.addIssue({ code: 'custom',
            message: `Create batch contents must total at most ${CREATE_BATCH_MAX_TEXT_CODE_UNITS} UTF-16 code units.` });
    }
    if (shapeAnchors > CREATE_BATCH_MAX_SHAPE_ANCHORS) {
        context.addIssue({ code: 'custom',
            message: `Create batch shapes must total at most ${CREATE_BATCH_MAX_SHAPE_ANCHORS} anchors (got ${shapeAnchors}); split the batch.` });
    }
    for (const count of perLayer.values()) {
        if (count > CREATE_BATCH_MAX_LAYER_ITEMS) {
            context.addIssue({ code: 'custom',
                message: `Create batch may add at most ${CREATE_BATCH_MAX_LAYER_ITEMS} items to one layer.` });
        }
    }
}
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({
        expectedDocumentKey: documentKeySchema,
        steps: z.array(internalStepSchema).min(CREATE_BATCH_MIN_STEPS).max(CREATE_BATCH_MAX_STEPS).superRefine(refineSteps),
        apply: z.literal(false),
    }),
    z.strictObject({
        expectedDocumentKey: documentKeySchema,
        steps: z.array(internalStepSchema).min(CREATE_BATCH_MIN_STEPS).max(CREATE_BATCH_MAX_STEPS).superRefine(refineSteps),
        apply: z.literal(true),
        commandId: canonicalCommandIdSchema,
    }),
]);
const publicStepCommon = { expected_layer_path: layerPathSchema, artboard_index: z.number().int().safe().nonnegative() };
const publicStepSchema = z.discriminatedUnion('operation', [
    z.strictObject({
        ...publicStepCommon,
        operation: z.literal(CREATE_POINT_TEXT_OPERATION),
        anchor: anchorSchema,
        contents: pointTextSingleLineSchema,
        style: publicStyleSchema,
    }),
    z.strictObject({
        ...publicStepCommon,
        operation: z.literal(CREATE_RECTANGLE_OPERATION),
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().finite().positive(),
        height: z.number().finite().positive(),
        name: rectangleNameSchema.optional(),
        appearance: creationAppearanceSchema.optional(),
    }),
    z.strictObject({
        ...publicStepCommon,
        operation: z.literal(CREATE_SHAPE_OPERATION),
        shape: publicShapeSchema,
        name: rectangleNameSchema.optional(),
        appearance: creationAppearanceSchema.optional(),
    }),
]);
function normalizeStep(step) {
    if (step.operation === CREATE_POINT_TEXT_OPERATION) {
        return {
            operation: step.operation,
            expectedLayerPath: step.expected_layer_path,
            artboardIndex: step.artboard_index,
            anchor: step.anchor,
            contents: step.contents,
            style: {
                fontPostScriptName: step.style.font_post_script_name,
                size: step.style.size,
                tracking: step.style.tracking,
                justification: step.style.justification ?? 'Justification.LEFT',
                fillColor: normalizePointTextPublicFillColor(step.style.fill_color),
            },
        };
    }
    if (step.operation === CREATE_SHAPE_OPERATION) {
        return {
            operation: step.operation,
            expectedLayerPath: step.expected_layer_path,
            artboardIndex: step.artboard_index,
            shape: normalizePublicShape(step.shape),
            ...(step.name === undefined ? {} : { name: step.name }),
            ...(step.appearance === undefined ? {} : { appearance: step.appearance }),
        };
    }
    return {
        operation: step.operation,
        expectedLayerPath: step.expected_layer_path,
        artboardIndex: step.artboard_index,
        x: step.x, y: step.y, width: step.width, height: step.height,
        ...(step.name === undefined ? {} : { name: step.name }),
        ...(step.appearance === undefined ? {} : { appearance: step.appearance }),
    };
}
export const createBatchPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({
        expected_document_key: documentKeySchema,
        steps: z.array(publicStepSchema).min(CREATE_BATCH_MIN_STEPS).max(CREATE_BATCH_MAX_STEPS)
            .superRefine((steps, context) => refineSteps(steps.map(normalizeStep), context)),
        apply: z.literal(false).default(false),
    }),
    z.strictObject({
        expected_document_key: documentKeySchema,
        steps: z.array(publicStepSchema).min(CREATE_BATCH_MIN_STEPS).max(CREATE_BATCH_MAX_STEPS)
            .superRefine((steps, context) => refineSteps(steps.map(normalizeStep), context)),
        apply: z.literal(true),
        command_id: applyCommandIdSchema,
    }),
]);
const inputSchema = z.strictObject({
    expected_document_key: documentKeySchema,
    steps: z.array(z.strictObject({
        operation: z.enum(CREATE_OPERATIONS),
        expected_layer_path: layerPathSchema,
        artboard_index: z.number().int().safe().nonnegative(),
        anchor: anchorSchema.optional(),
        contents: pointTextSingleLineSchema.optional(),
        style: publicStyleSchema.optional(),
        x: z.number().finite().optional(),
        y: z.number().finite().optional(),
        width: z.number().finite().positive().optional(),
        height: z.number().finite().positive().optional(),
        name: rectangleNameSchema.optional(),
        shape: publicShapeSchema.optional(),
        appearance: creationAppearanceSchema.optional(),
    })).min(CREATE_BATCH_MIN_STEPS).max(CREATE_BATCH_MAX_STEPS),
    apply: z.boolean().default(false),
    command_id: applyCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(createBatchPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = createBatchPublicInputSchema.parse(input);
    const steps = value.steps.map(normalizeStep);
    return value.apply
        ? { expectedDocumentKey: value.expected_document_key, steps, apply: true, commandId: value.command_id }
        : { expectedDocumentKey: value.expected_document_key, steps, apply: false };
}
const layerStateSchema = z.strictObject({
    path: layerPathSchema,
    name: z.string().max(255),
    visible: z.boolean(),
    locked: z.boolean(),
    itemUuids: z.array(uuidSchema).max(CREATE_BATCH_MAX_LAYER_ITEMS),
    ancestry: z.array(z.strictObject({
        name: z.string().max(255), visible: z.boolean(), locked: z.boolean(),
    })).min(1).max(POINT_TEXT_MAX_LAYER_DEPTH_LIMIT),
    createdCount: z.number().int().min(1).max(CREATE_BATCH_MAX_STEPS),
});
const boundsSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
const planStepSchema = z.discriminatedUnion('operation', [
    z.strictObject({
        operation: z.literal(CREATE_POINT_TEXT_OPERATION),
        layerIndex: z.number().int().nonnegative().max(CREATE_BATCH_MAX_STEPS - 1),
        artboardIndex: z.number().int().nonnegative(),
        anchor: anchorSchema,
        contents: pointTextSingleLineSchema,
        requestedStyle: styleSchema,
        profile: z.literal(POINT_TEXT_PROFILE_NAME),
    }),
    z.strictObject({
        operation: z.literal(CREATE_RECTANGLE_OPERATION),
        layerIndex: z.number().int().nonnegative().max(CREATE_BATCH_MAX_STEPS - 1),
        artboardIndex: z.number().int().nonnegative(),
        artboardBounds: boundsSchema,
        targetBounds: boundsSchema,
        withinArtboard: z.boolean(),
        name: rectangleNameSchema.nullable(),
        appearance: creationAppearanceSchema.optional(),
    }),
    z.strictObject({
        operation: z.literal(CREATE_SHAPE_OPERATION),
        layerIndex: z.number().int().nonnegative().max(CREATE_BATCH_MAX_STEPS - 1),
        artboardIndex: z.number().int().nonnegative(),
        artboardBounds: boundsSchema,
        shape: createShapeShapeSchema,
        geometry: shapeGeometrySchema,
        withinArtboard: z.boolean(),
        name: rectangleNameSchema.nullable(),
        appearance: creationAppearanceSchema.optional(),
    }),
]);
const planSchema = z.strictObject({
    operation: z.literal(CREATE_BATCH_OPERATION),
    documentKey: documentKeySchema,
    layers: z.array(layerStateSchema).min(1).max(CREATE_BATCH_MAX_STEPS),
    steps: z.array(planStepSchema).min(CREATE_BATCH_MIN_STEPS).max(CREATE_BATCH_MAX_STEPS),
    applyBlockedReasonCodes: z.array(blockerSchema),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    const paths = plan.layers.map((layer) => layer.path.join('.'));
    if (new Set(paths).size !== paths.length) {
        context.addIssue({ code: 'custom', message: 'Create batch layers must be distinct layer paths.' });
    }
    const counted = new Map();
    for (const step of plan.steps) {
        if (step.layerIndex >= plan.layers.length) {
            context.addIssue({ code: 'custom', message: 'Every create batch step must reference a captured layer.' });
            continue;
        }
        counted.set(step.layerIndex, (counted.get(step.layerIndex) ?? 0) + 1);
    }
    plan.layers.forEach((layer, index) => {
        if (layer.createdCount !== (counted.get(index) ?? 0)) {
            context.addIssue({ code: 'custom', message: 'Each create batch layer must count exactly its own steps.' });
        }
        if (layer.itemUuids.length + layer.createdCount > CREATE_BATCH_MAX_LAYER_ITEMS &&
            !plan.applyBlockedReasonCodes.includes('layer_item_capacity_exceeded')) {
            context.addIssue({ code: 'custom', message: 'A create batch layer must stay inside the measured item budget.' });
        }
    });
    const textUnits = plan.steps.reduce((sum, step) => sum + (step.operation === CREATE_POINT_TEXT_OPERATION ? step.contents.length : 0), 0);
    if (textUnits > CREATE_BATCH_MAX_TEXT_CODE_UNITS) {
        context.addIssue({ code: 'custom', message: 'Create batch plan exceeds the measured text budget.' });
    }
    const shapeAnchors = plan.steps.reduce((sum, step) => sum + (step.operation === CREATE_SHAPE_OPERATION ? step.geometry.anchors.length : 0), 0);
    if (shapeAnchors > CREATE_BATCH_MAX_SHAPE_ANCHORS) {
        context.addIssue({ code: 'custom', message: 'Create batch plan exceeds the shape anchor budget.' });
    }
    if (plan.applyAllowed !== (plan.applyBlockedReasonCodes.length === 0)) {
        context.addIssue({ code: 'custom', message: 'Create batch applyAllowed must require no blockers.' });
    }
});
const createdStepSchema = z.discriminatedUnion('operation', [
    z.strictObject({
        operation: z.literal(CREATE_POINT_TEXT_OPERATION),
        uuid: uuidSchema,
        layerIndex: z.number().int().nonnegative().max(CREATE_BATCH_MAX_STEPS - 1),
        snapshot: pointTextSnapshotSchema,
    }),
    z.strictObject({
        operation: z.literal(CREATE_RECTANGLE_OPERATION),
        uuid: uuidSchema,
        layerIndex: z.number().int().nonnegative().max(CREATE_BATCH_MAX_STEPS - 1),
        type: z.literal('PathItem'),
        name: z.string().max(255),
        bounds: boundsSchema,
        appearance: creationAppearanceStateSchema.optional(),
    }),
    z.strictObject({
        operation: z.literal(CREATE_SHAPE_OPERATION),
        uuid: uuidSchema,
        layerIndex: z.number().int().nonnegative().max(CREATE_BATCH_MAX_STEPS - 1),
        type: z.literal('PathItem'),
        name: z.string().max(255),
        geometry: shapeGeometrySchema,
        appearance: creationAppearanceStateSchema.optional(),
    }),
]);
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']),
    reasonCode: z.enum(['apply_failed', 'verify_mismatch']),
    message: z.string().min(1).max(500),
}).superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed')) {
        context.addIssue({ code: 'custom', message: 'Create batch failure phase and reason code must match.' });
    }
});
const indeterminateFailureSchema = z.strictObject({
    phase: z.literal('apply'), reasonCode: z.literal('apply_indeterminate'), message: z.string().min(1).max(500),
});
const rollbackOutcomeSchema = z.enum(['not_written', 'removed', 'absent', 'outstanding', 'indeterminate']);
const rollbackStepSchema = z.strictObject({
    operation: z.enum(CREATE_OPERATIONS),
    createdUuid: uuidSchema.nullable(),
    outcome: rollbackOutcomeSchema,
});
const rollbackLayerSchema = z.strictObject({
    path: layerPathSchema,
    restoredItemUuids: z.array(uuidSchema).max(CREATE_BATCH_MAX_LAYER_ITEMS).nullable(),
});
const rollbackEvidence = {
    attemptedCount: z.number().int().min(0).max(CREATE_BATCH_MAX_STEPS),
    steps: z.array(rollbackStepSchema).min(CREATE_BATCH_MIN_STEPS).max(CREATE_BATCH_MAX_STEPS),
    layers: z.array(rollbackLayerSchema).max(CREATE_BATCH_MAX_STEPS),
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
        rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('created_state_unknown'),
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
        expected = [...prefix, 'apply:started:', 'apply:attempted:', 'apply:succeeded:', 'verify:started:', 'verify:succeeded:',
            'rollback:skipped:not_required'];
    }
    else if (transaction.state === 'apply_failed') {
        expected = [...prefix, 'apply:started:', 'apply:failed:apply_failed', 'verify:skipped:not_required',
            'rollback:skipped:not_required'];
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
        context.addIssue({ code: 'custom', message: 'Create batch audit sequence does not match transaction state.' });
    }
    transaction.audit.forEach((event, index) => {
        if (event.sequence !== index)
            context.addIssue({ code: 'custom', message: 'Create batch audit sequence must be contiguous.' });
    });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' && event.phase === transaction.failure.phase &&
            event.reasonCode === transaction.failure.reasonCode && event.message === transaction.failure.message);
        if (matches.length !== 1)
            context.addIssue({ code: 'custom', message: 'Create batch failure must match one audit event.' });
    }
    if ('rollback' in transaction && 'steps' in transaction.rollback) {
        const steps = transaction.rollback.steps;
        const attempted = transaction.rollback.attemptedCount;
        if (attempted > steps.length || steps.some((step, index) => (step.outcome === 'not_written') !== (index >= attempted))) {
            context.addIssue({ code: 'custom', message: 'Create batch rollback evidence must mark exactly the unattempted steps as not written.' });
        }
        if (steps.some((step) => (step.createdUuid !== null) !== (step.outcome === 'removed' || step.outcome === 'outstanding'))) {
            context.addIssue({ code: 'custom', message: 'Create batch rollback evidence must carry a UUID exactly for an identified item.' });
        }
        if (transaction.state !== 'apply_indeterminate' && transaction.failure.phase === 'verify' && attempted !== steps.length) {
            context.addIssue({ code: 'custom', message: 'A verify failure implies every create batch step was attempted.' });
        }
        if (transaction.state === 'rolled_back' &&
            (attempted === 0 || steps.some((step, index) => index < attempted && step.outcome !== 'removed' && step.outcome !== 'absent') ||
                transaction.rollback.layers.some((layer) => layer.restoredItemUuids === null))) {
            context.addIssue({ code: 'custom', message: 'A rolled-back create batch must prove every attempted item removed and every layer restored.' });
        }
        if (transaction.state === 'rollback_failed' &&
            (steps.some((step) => step.outcome === 'indeterminate') || !steps.some((step) => step.outcome === 'outstanding'))) {
            context.addIssue({ code: 'custom', message: 'A failed create batch rollback must name an outstanding item and prove the rest.' });
        }
        if (transaction.state === 'apply_indeterminate' &&
            (steps.some((step) => step.outcome !== 'indeterminate') ||
                transaction.rollback.layers.some((layer) => layer.restoredItemUuids !== null))) {
            context.addIssue({ code: 'custom', message: 'An indeterminate create batch apply must not claim any proven step or layer.' });
        }
    }
});
export const createBatchResultSchema = z.union([
    z.strictObject({ operation: z.literal(CREATE_BATCH_OPERATION), applied: z.literal(false),
        document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ operation: z.literal(CREATE_BATCH_OPERATION), applied: z.literal(true),
        document: documentContextSchema, plan: planSchema,
        created: z.array(createdStepSchema).min(CREATE_BATCH_MIN_STEPS).max(CREATE_BATCH_MAX_STEPS),
        layerItemUuids: z.array(z.array(uuidSchema).max(CREATE_BATCH_MAX_LAYER_ITEMS)).min(1).max(CREATE_BATCH_MAX_STEPS),
        transaction: transactionSchema }),
]).superRefine((result, context) => {
    if (result.transaction.state === 'planned') {
        if (result.plan.applyAllowed !== (result.plan.applyBlockedReasonCodes.length === 0)) {
            context.addIssue({ code: 'custom', message: 'Planned create batch must expose its exact blockers.' });
        }
        const documentBlocked = result.plan.applyBlockedReasonCodes.includes('document_mutation_not_allowed');
        if (documentBlocked === result.document.mutationAllowed) {
            context.addIssue({ code: 'custom', message: 'Planned create batch must reflect the document mutation state.' });
        }
    }
    else if (result.plan.applyBlockedReasonCodes.length !== 0 || !result.plan.applyAllowed) {
        context.addIssue({ code: 'custom', message: 'Applied create batch must derive from an allowed plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified') {
            context.addIssue({ code: 'custom', message: 'A created batch must come from a verified transaction.' });
        }
        if (result.created.length !== result.plan.steps.length ||
            result.created.some((created, index) => created.operation !== result.plan.steps[index].operation ||
                created.layerIndex !== result.plan.steps[index].layerIndex)) {
            context.addIssue({ code: 'custom', message: 'A created batch must report one created item per plan step, in order.' });
        }
        const uuids = result.created.map((created) => created.uuid);
        if (new Set(uuids).size !== uuids.length) {
            context.addIssue({ code: 'custom', message: 'A created batch must report distinct native UUIDs.' });
        }
        if (result.layerItemUuids.length !== result.plan.layers.length) {
            context.addIssue({ code: 'custom', message: 'A created batch must report the final order of every touched layer.' });
        }
        else {
            result.plan.layers.forEach((layer, layerIndex) => {
                const own = new Set(result.created.filter((created) => created.layerIndex === layerIndex)
                    .map((created) => created.uuid));
                const final = result.layerItemUuids[layerIndex];
                const remaining = final.filter((uuid) => !own.has(uuid));
                if (final.length !== layer.itemUuids.length + layer.createdCount || own.size !== layer.createdCount ||
                    !sameCanonical(remaining, layer.itemUuids)) {
                    context.addIssue({ code: 'custom',
                        message: 'A created batch layer must be exactly its baseline plus the items this batch created.' });
                }
            });
        }
        for (const created of result.created) {
            const step = result.plan.steps[result.created.indexOf(created)];
            if (created.operation === CREATE_POINT_TEXT_OPERATION && step?.operation === CREATE_POINT_TEXT_OPERATION) {
                if (created.snapshot.uuid !== created.uuid || created.snapshot.contents !== step.contents ||
                    created.snapshot.profile !== POINT_TEXT_PROFILE_NAME ||
                    !sameCanonical(created.snapshot.layerPath, result.plan.layers[step.layerIndex]?.path)) {
                    context.addIssue({ code: 'custom', message: 'A created point text must match its planned contents, profile and layer.' });
                }
            }
            if (created.operation === CREATE_RECTANGLE_OPERATION && step?.operation === CREATE_RECTANGLE_OPERATION) {
                const tolerance = 10 ** -RECTANGLE_BOUNDS_PRECISION_DIGITS;
                if (created.bounds.some((bound, index) => Math.abs(bound - step.targetBounds[index]) > tolerance) ||
                    (step.name !== null && created.name !== step.name)) {
                    context.addIssue({ code: 'custom', message: 'A created rectangle must match its planned bounds and name.' });
                }
            }
            if (created.operation === CREATE_SHAPE_OPERATION && step?.operation === CREATE_SHAPE_OPERATION) {
                if (!geometryWithinTolerance(created.geometry, step.geometry) || (step.name !== null && created.name !== step.name)) {
                    context.addIssue({ code: 'custom', message: 'A created shape must match its planned geometry and name.' });
                }
            }
            if ((created.operation === CREATE_RECTANGLE_OPERATION || created.operation === CREATE_SHAPE_OPERATION) &&
                step !== undefined && step.operation === created.operation) {
                const planned = step.appearance;
                const actual = created.appearance;
                if ((planned === undefined) !== (actual === undefined) ||
                    (planned !== undefined && actual !== undefined && !creationAppearanceMatches(planned, actual))) {
                    context.addIssue({ code: 'custom',
                        message: 'A created path carries a read-back appearance exactly when its step requested one, and it must match.' });
                }
            }
            if (step === undefined || step.operation !== created.operation) {
                context.addIssue({ code: 'custom', message: 'Every created item must match its plan step operation.' });
            }
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified create batch must report the created items.' });
    }
    if ('rollback' in result.transaction && 'steps' in result.transaction.rollback) {
        const rollback = result.transaction.rollback;
        if (rollback.steps.length !== result.plan.steps.length ||
            rollback.steps.some((step, index) => step.operation !== result.plan.steps[index].operation)) {
            context.addIssue({ code: 'custom', message: 'Create batch rollback evidence must cover every plan step in order.' });
        }
        if (rollback.layers.length !== result.plan.layers.length ||
            rollback.layers.some((layer, index) => !sameCanonical(layer.path, result.plan.layers[index].path))) {
            context.addIssue({ code: 'custom', message: 'Create batch rollback evidence must cover every touched layer in order.' });
        }
        else if (result.transaction.state === 'rolled_back' &&
            rollback.layers.some((layer, index) => !sameCanonical(layer.restoredItemUuids, result.plan.layers[index].itemUuids))) {
            context.addIssue({ code: 'custom', message: 'A rolled-back create batch must restore every layer to its exact baseline.' });
        }
    }
});
export const createBatchResponseSchema = z.strictObject({
    outcome: createBatchResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
export const CREATE_BATCH_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: CREATE_BATCH_OPERATION,
    policy: {
        version: 1, class: 'create', destructive: false,
        evidence: { identity: 'native_uuid', ownership: 'self_created_only', postcondition: 'created_state_matches_plan' },
        preconditions: { documentBinding: 'explicit_document_key', targetValidation: 'same_execution_before_apply' },
        confirmation: 'risk_scoped',
        recovery: { mode: 'remove_self_created_uuid', verification: 'native_uuid_absent', unknownIdentity: 'indeterminate' },
        terminal: { success: 'verified', failure: 'proven_pre_apply_or_verified_recovery', partialSuccess: 'nonterminal_until_reconciled' },
        replay: { requestBinding: 'canonical_request_digest', retry: 'return_attested_terminal_result',
            beforeTerminal: 'reconcile_required', reapplyOnRetry: false },
    },
    capabilities: {
        class: 'create', explicitDocumentBinding: true, validateTargetsBeforeApply: true, captureNativeUuid: true,
        verifyCreatedState: true, rollbackSelfCreatedUuidOnly: true, verifyRollbackAbsence: true,
        reconcileIndeterminate: true, durableTerminalReplay: true, trustedTerminalAttestationResolver: true,
    },
});
export const CREATE_BATCH_SAFETY_IDENTITY = canonicalDigest(CREATE_BATCH_SAFETY);
function createdSetIdentity(uuids) {
    return `set:${canonicalDigest(uuids)}`;
}
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    const locators = result.plan.steps.map((step) => `${step.operation}@layer:${result.plan.layers[step.layerIndex]?.path.join('.') ?? ''};artboard:${step.artboardIndex}`);
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'create', operationId: CREATE_BATCH_OPERATION,
        canonicalRequestDigest: requestDigest,
        evidence: { documentKey: admissionDocumentKey,
            targetLocator: `batch:${canonicalDigest(locators)}` },
        preconditions: {
            status: result.plan.applyBlockedReasonCodes.length === 0 ? 'satisfied' : 'blocked',
            targetsValidated: result.plan.applyBlockedReasonCodes.length === 0,
        },
        confirmation: { kind: 'risk_scoped', status: 'not_required' },
        applyAllowed: result.plan.applyAllowed,
    });
}
function safetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' ||
        transaction.state === 'rollback_indeterminate') {
        throw new Error('Indeterminate create batch cannot be terminal.');
    }
    const common = { policyVersion: 1, operationClass: 'create', operationId: CREATE_BATCH_OPERATION,
        canonicalRequestDigest: requestDigest, planDigest: plan.planDigest, attestation };
    if (result.applied && transaction.state === 'verified') {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { nativeUuid: createdSetIdentity(result.created.map((created) => created.uuid)),
                ownership: 'self_created_only', postconditionVerified: true, outstandingEffect: null },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'succeeded', terminal: true, recovery: 'not_required',
                proof: { kind: 'verified_postcondition' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    if (transaction.state === 'rolled_back') {
        const removed = transaction.rollback.steps.flatMap((step) => step.createdUuid === null ? [] : [step.createdUuid]);
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { nativeUuid: createdSetIdentity(removed), ownership: 'self_created_only',
                postconditionVerified: false, outstandingEffect: null },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'recovered', terminal: true, recovery: 'verified', proof: { kind: 'verified_recovery' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    if (transaction.state === 'rollback_failed') {
        const outstanding = transaction.rollback.steps
            .flatMap((step) => step.outcome === 'outstanding' && step.createdUuid !== null ? [step.createdUuid] : []);
        const nativeUuid = createdSetIdentity(outstanding);
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { nativeUuid, ownership: 'self_created_only', postconditionVerified: false,
                outstandingEffect: { kind: 'native_uuid_still_present', nativeUuid } },
            executionEvidence: { outcome: 'recovery_failed' },
            resolution: { status: 'recovery_failed', terminal: true, recovery: 'failed',
                outstandingEffect: 'known_effect_present', proof: { kind: 'verified_outstanding_effect' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    return operationSafetyResultSchema.parse({ ...common,
        evidence: { nativeUuid: null, ownership: 'self_created_only', postconditionVerified: false, outstandingEffect: null },
        executionEvidence: { outcome: 'proven_pre_apply' },
        resolution: { status: 'failed', terminal: true, recovery: 'not_required',
            proof: { kind: 'proven_pre_apply', mutationAttempted: false },
            replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
}
async function assertSafety(value, requestDigest, attestation, resolver) {
    const result = createBatchResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null)
        throw new Error('Create batch terminal result requires attestation.');
    await assertOperationSafetyAdapterConformance({ registration: CREATE_BATCH_SAFETY, plan,
        result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
export const CREATE_BATCH_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${POINT_TEXT_SNAPSHOT_SCRIPT}
${CREATE_POINT_TEXT_MODULE_SCRIPT}
${CREATION_APPEARANCE_MODULE_SCRIPT}
${CREATE_RECTANGLE_MODULE_SCRIPT}
${CREATE_SHAPE_MODULE_SCRIPT}
var CREATE_BATCH_MIN_STEPS = ${CREATE_BATCH_MIN_STEPS};
var CREATE_BATCH_MAX_STEPS = ${CREATE_BATCH_MAX_STEPS};
var CREATE_BATCH_MAX_TEXT_CODE_UNITS = ${CREATE_BATCH_MAX_TEXT_CODE_UNITS};
var CREATE_BATCH_MAX_LAYER_ITEMS = ${CREATE_BATCH_MAX_LAYER_ITEMS};
var CREATE_BATCH_BLOCKER_ORDER = ${JSON.stringify(CREATE_BATCH_BLOCKERS)};

/**
 * The creation modules read the implicit \`params\`. Each step gets a complete synthetic \`params\` in the
 * exact shape that operation's own runner would have read, and every module call runs through
 * withCreateStepParams, which restores the batch params in finally even when the module throws.
 */
var CREATE_BATCH_OPERATIONS = {
  create_point_text: {
    resolve: function () { return createPointTextResolve(false); },
    layerOf: function (resolved) { return resolved.layer; },
    plan: createPointTextPlanState,
    apply: createPointTextApply
  },
  create_rectangle: {
    resolve: function () {
      var resolved = rectanglePreflight(false);
      resolved.document = resolved.doc;
      resolved.blockers = resolved.applyBlockedReasonCodes;
      return resolved;
    },
    layerOf: function (resolved) { return resolved.targetLayer; },
    plan: rectanglePlan,
    apply: rectangleApply
  },
  create_shape: {
    resolve: function () { return shapeResolve(false); },
    layerOf: function (resolved) { return resolved.layer; },
    plan: shapePlan,
    apply: shapeApply
  }
};

function createBatchStepParams(batchParams, request, index) {
  var step = { expectedDocumentKey: batchParams.expectedDocumentKey, apply: false,
    expectedLayerPath: request.expectedLayerPath, artboardIndex: request.artboardIndex };
  if (request.operation === "create_point_text") {
    step.anchor = request.anchor;
    step.contents = request.contents;
    step.style = request.style;
  } else if (request.operation === "create_rectangle") {
    step.x = request.x; step.y = request.y; step.width = request.width; step.height = request.height;
    if (request.name !== undefined) step.name = request.name;
    if (request.appearance !== undefined) step.appearance = request.appearance;
  } else if (request.operation === "create_shape") {
    step.shape = request.shape;
    if (request.name !== undefined) step.name = request.name;
    if (request.appearance !== undefined) step.appearance = request.appearance;
  } else {
    throw mutationError("preflight_failed", "Step " + (index + 1) + ": unsupported operation " + String(request.operation) + ".");
  }
  return step;
}

function withCreateStepParams(step, fn) {
  var saved = params;
  params = step.params;
  try { return fn(); }
  finally { params = saved; }
}

function createBatchStepLabel(step) {
  return "Step " + (step.index + 1) + " (" + step.request.operation + ", layer " +
    step.request.expectedLayerPath.join(".") + ")";
}

/** Re-raises a mutation error with the step named; other errors (MCP_ERROR payloads) pass through. */
function createBatchStepError(step, error) {
  if (error && typeof error.mutationPublicMessage === "string" && error.mutationPublicMessage.length > 0) {
    var named = mutationError(error.mutationReasonCode || "preflight_failed",
      createBatchStepLabel(step) + ": " + error.mutationPublicMessage);
    if (error.mutationBeforeSideEffect === true) named.mutationBeforeSideEffect = true;
    return named;
  }
  return error;
}

function createBatchUnionBlockers(perStep) {
  var present = {};
  for (var stepIndex = 0; stepIndex < perStep.length; stepIndex++) {
    for (var blockerIndex = 0; blockerIndex < perStep[stepIndex].length; blockerIndex++) {
      present[perStep[stepIndex][blockerIndex]] = true;
    }
  }
  var union = [];
  for (var orderIndex = 0; orderIndex < CREATE_BATCH_BLOCKER_ORDER.length; orderIndex++) {
    if (present[CREATE_BATCH_BLOCKER_ORDER[orderIndex]]) union.push(CREATE_BATCH_BLOCKER_ORDER[orderIndex]);
  }
  return union;
}

/** The exact direct-item order of a layer, reused for baseline, verification and rollback proof. */
function createBatchLayerOrder(layer) { return createPointTextLayerOrder(layer); }

/**
 * Resolves the document exactly once, then every step through its module, before any write. Called from
 * preflight and again from revalidate. Each distinct layer is captured once, so several creations on one
 * layer share one baseline order.
 */
function createBatchResolve(forApply) {
  var batchParams = params;
  var context = forApply ? requireDocument(batchParams.expectedDocumentKey) : requireDocumentForRead(batchParams.expectedDocumentKey);
  var document = app.activeDocument;
  var requested = batchParams.steps;
  if (!requested || typeof requested.length !== "number" ||
      requested.length < CREATE_BATCH_MIN_STEPS || requested.length > CREATE_BATCH_MAX_STEPS) {
    throw mutationError("preflight_failed", "Create batch requires " + CREATE_BATCH_MIN_STEPS + " to " + CREATE_BATCH_MAX_STEPS + " steps.");
  }
  var entries = [];
  var perStepBlockers = [];
  var layers = [];
  var layerIndexByPath = {};
  var textUnits = 0;
  for (var index = 0; index < requested.length; index++) {
    var request = requested[index];
    var operation = CREATE_BATCH_OPERATIONS[request.operation];
    var step = { index: index, request: request, params: createBatchStepParams(batchParams, request, index) };
    if (!operation) throw mutationError("preflight_failed", createBatchStepLabel(step) + ": unsupported operation.");
    var resolved;
    var stepPlan;
    try {
      resolved = withCreateStepParams(step, function () { return operation.resolve(); });
      if (resolved.document !== document) {
        throw mutationError("preflight_failed", "resolved a different document than the batch holds.");
      }
      stepPlan = withCreateStepParams(step, function () { return operation.plan(resolved); });
    } catch (stepError) { throw createBatchStepError(step, stepError); }
    if (request.operation === "create_point_text") textUnits += String(request.contents).length;
    var layer = operation.layerOf(resolved);
    var pathKey = "p:" + request.expectedLayerPath.join(".");
    var layerIndex = layerIndexByPath[pathKey];
    if (layerIndex === undefined) {
      var ancestry;
      try { ancestry = createPointTextLayerAncestry(layer); }
      catch (ancestryError) { throw createBatchStepError(step, ancestryError); }
      layerIndex = layers.length;
      layerIndexByPath[pathKey] = layerIndex;
      layers.push({ path: request.expectedLayerPath, layer: layer, name: String(layer.name || ""),
        visible: layer.visible === true, locked: layer.locked === true,
        itemUuids: createBatchLayerOrder(layer), ancestry: ancestry, createdCount: 0 });
    } else if (layers[layerIndex].layer !== layer) {
      throw mutationError("preflight_failed", createBatchStepLabel(step) + ": the same layer path resolved to a different layer.");
    }
    layers[layerIndex].createdCount += 1;
    perStepBlockers.push(resolved.blockers || []);
    entries.push({ step: step, resolved: resolved, plan: stepPlan, layerIndex: layerIndex });
  }
  if (textUnits > CREATE_BATCH_MAX_TEXT_CODE_UNITS) {
    throw mutationError("preflight_failed", "Create batch contents exceed " + CREATE_BATCH_MAX_TEXT_CODE_UNITS + " UTF-16 code units in total.");
  }
  var capacityExceeded = false;
  for (var layerCheck = 0; layerCheck < layers.length; layerCheck++) {
    if (layers[layerCheck].itemUuids.length + layers[layerCheck].createdCount > CREATE_BATCH_MAX_LAYER_ITEMS) {
      capacityExceeded = true;
    }
  }
  if (capacityExceeded) perStepBlockers.push(["layer_item_capacity_exceeded"]);
  var union = createBatchUnionBlockers(perStepBlockers);
  if (forApply && union.length > 0) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "CREATE_BATCH_APPLY_BLOCKED", reasonCodes: union }));
  }
  return { context: context, document: document, entries: entries, layers: layers, blockers: union };
}

function createBatchPreflight(forApply) { return createBatchResolve(forApply); }

function createBatchPlan(preflight) {
  var layers = [];
  for (var layerIndex = 0; layerIndex < preflight.layers.length; layerIndex++) {
    var layer = preflight.layers[layerIndex];
    layers.push({ path: layer.path, name: layer.name, visible: layer.visible, locked: layer.locked,
      itemUuids: layer.itemUuids, ancestry: layer.ancestry, createdCount: layer.createdCount });
  }
  var steps = [];
  for (var index = 0; index < preflight.entries.length; index++) {
    var entry = preflight.entries[index];
    if (entry.step.request.operation === "create_point_text") {
      steps.push({ operation: "create_point_text", layerIndex: entry.layerIndex,
        artboardIndex: entry.plan.artboardIndex, anchor: entry.plan.anchor, contents: entry.plan.contents,
        requestedStyle: entry.plan.requestedStyle, profile: entry.plan.profile });
    } else if (entry.step.request.operation === "create_rectangle") {
      var rectangleStep = { operation: "create_rectangle", layerIndex: entry.layerIndex,
        artboardIndex: entry.plan.artboardIndex, artboardBounds: entry.plan.artboardBounds,
        targetBounds: entry.plan.targetBounds, withinArtboard: entry.plan.withinArtboard,
        name: entry.step.request.name === undefined ? null : entry.step.request.name };
      if (entry.step.request.appearance !== undefined) rectangleStep.appearance = entry.step.request.appearance;
      steps.push(rectangleStep);
    } else {
      var shapeStep = { operation: "create_shape", layerIndex: entry.layerIndex,
        artboardIndex: entry.plan.artboardIndex, artboardBounds: entry.plan.artboardBounds,
        shape: entry.plan.shape, geometry: entry.plan.geometry, withinArtboard: entry.plan.withinArtboard,
        name: entry.step.request.name === undefined ? null : entry.step.request.name };
      if (entry.step.request.appearance !== undefined) shapeStep.appearance = entry.step.request.appearance;
      steps.push(shapeStep);
    }
  }
  return { operation: "create_batch", documentKey: preflight.context.key, layers: layers, steps: steps,
    applyBlockedReasonCodes: preflight.blockers, applyAllowed: preflight.blockers.length === 0 };
}

function createBatchRevalidate(preflight, plan) {
  var current;
  try { current = createBatchResolve(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Create batch preconditions changed before apply.")); }
  if (current.document !== preflight.document || current.entries.length !== preflight.entries.length ||
      current.layers.length !== preflight.layers.length) {
    throw mutationBeforeSideEffectError("Create batch document, step count or layer set changed before apply.");
  }
  for (var layerIndex = 0; layerIndex < current.layers.length; layerIndex++) {
    if (current.layers[layerIndex].layer !== preflight.layers[layerIndex].layer ||
        !mutationSameSequence(current.layers[layerIndex].itemUuids, plan.layers[layerIndex].itemUuids) ||
        stringifyJson(current.layers[layerIndex].ancestry) !== stringifyJson(plan.layers[layerIndex].ancestry)) {
      throw mutationBeforeSideEffectError("Create batch layer " + plan.layers[layerIndex].path.join(".") + " changed before apply.");
    }
  }
  var currentPlan = createBatchPlan(current);
  if (stringifyJson(currentPlan.steps) !== stringifyJson(plan.steps)) {
    throw mutationBeforeSideEffectError("Create batch step plan changed before apply.");
  }
}

function createBatchStepState(entry) {
  return { preflight: entry.resolved, plan: entry.plan,
    operationState: { mutationStarted: false, createdUuid: null, createdObject: null,
      rollbackEvidence: { createdUuid: null, restoredItemUuids: null } } };
}

function createBatchApply(preflight, plan, state) {
  state.operationState.mutationStarted = true;
  state.operationState.stepStates = [];
  for (var index = 0; index < preflight.entries.length; index++) {
    state.operationState.stepStates.push(createBatchStepState(preflight.entries[index]));
  }
  for (var applyIndex = 0; applyIndex < preflight.entries.length; applyIndex++) {
    var entry = preflight.entries[applyIndex];
    var operation = CREATE_BATCH_OPERATIONS[entry.step.request.operation];
    var stepState = state.operationState.stepStates[applyIndex];
    // Recorded before the write: a throw mid-write still counts this step as attempted.
    state.operationState.attemptedCount = applyIndex + 1;
    state.operationState.rollbackEvidence.attemptedCount = applyIndex + 1;
    var created = withCreateStepParams(entry.step, function () {
      return operation.apply(entry.resolved, entry.plan, stepState);
    });
    var createdUuid = stepState.operationState.createdUuid;
    if (typeof createdUuid !== "string" || createdUuid.length === 0) {
      throw mutationError("apply_failed", createBatchStepLabel(entry.step) + ": Illustrator did not return a native UUID.");
    }
    stepState.operationState.createdObject = created;
  }
  return preflight.entries.length;
}

/** The point-text postcondition, minus the single-creation order rule the batch owns itself. */
function createBatchVerifyPointText(entry, stepState) {
  var createdUuid = stepState.operationState.createdUuid;
  var target = pointTextFind(entry.resolved.document, createdUuid);
  if (target === null) {
    throw mutationError("verify_mismatch", "The created native UUID no longer resolves in the bound document.");
  }
  var snapshot = pointTextSnapshot(entry.resolved.document, target, createdUuid);
  if (snapshot.contents !== entry.step.params.contents || snapshot.profile !== POINT_TEXT_PROFILE ||
      !mutationSameSequence(snapshot.layerPath, entry.step.request.expectedLayerPath)) {
    throw mutationError("verify_mismatch", "The created point text does not match the planned state.");
  }
  return { operation: "create_point_text", uuid: createdUuid, layerIndex: entry.layerIndex, snapshot: snapshot };
}

function createBatchVerifyRectangle(entry, stepState) {
  var verified = rectangleVerify(entry.resolved, entry.plan, stepState);
  var created = { operation: "create_rectangle", uuid: verified.uuid, layerIndex: entry.layerIndex,
    type: verified.type, name: verified.name, bounds: verified.bounds };
  if (verified.appearance !== undefined) created.appearance = verified.appearance;
  return created;
}

/**
 * ExtendScript mis-associates nested conditional expressions (a ? b : c ? d : e evaluates as (a ? b : c) ? d : e,
 * measured again in #306: a point-text step was verified as a rectangle), so the verifier is chosen with if/else.
 */
function createBatchVerifierFor(operation) {
  if (operation === "create_point_text") return createBatchVerifyPointText;
  if (operation === "create_rectangle") return createBatchVerifyRectangle;
  if (operation === "create_shape") return createBatchVerifyShape;
  throw mutationError("verify_mismatch", "Unsupported create batch operation " + String(operation) + ".");
}

/** The shape postcondition, minus the single-creation order rule the batch owns itself. */
function createBatchVerifyShape(entry, stepState) {
  var verified = shapeVerifyCreated(entry.resolved, entry.plan, stepState, null);
  var created = { operation: "create_shape", uuid: verified.uuid, layerIndex: entry.layerIndex,
    type: verified.type, name: verified.name, geometry: verified.geometry };
  if (verified.appearance !== undefined) created.appearance = verified.appearance;
  return created;
}

/**
 * Every created item is verified through its own operation, then every touched layer must be exactly its
 * baseline plus this batch's own items. The batch never assumes where the host inserts a new item: it
 * proves that removing its own UUIDs leaves the baseline order untouched.
 */
function createBatchVerify(preflight, plan, state) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) {
    throw mutationError("verify_mismatch", "Active document changed during create batch verification.");
  }
  var created = [];
  for (var index = 0; index < preflight.entries.length; index++) {
    var entry = preflight.entries[index];
    var stepState = state.operationState.stepStates[index];
    try {
      var verifyStep = createBatchVerifierFor(entry.step.request.operation);
      created.push(withCreateStepParams(entry.step, function () { return verifyStep(entry, stepState); }));
    } catch (verifyError) { throw createBatchStepError(entry.step, verifyError); }
  }
  var layerItemUuids = [];
  for (var layerIndex = 0; layerIndex < preflight.layers.length; layerIndex++) {
    var layer = preflight.layers[layerIndex];
    var own = {};
    var ownCount = 0;
    for (var ownIndex = 0; ownIndex < created.length; ownIndex++) {
      if (created[ownIndex].layerIndex === layerIndex) { own["u:" + created[ownIndex].uuid] = true; ownCount += 1; }
    }
    var order;
    try { order = createBatchLayerOrder(layer.layer); }
    catch (orderError) { throw mutationError("verify_mismatch", "The created layer order is unavailable."); }
    var remaining = [];
    var seenOwn = 0;
    for (var orderIndex = 0; orderIndex < order.length; orderIndex++) {
      if (own["u:" + order[orderIndex]] === true) seenOwn += 1;
      else remaining.push(order[orderIndex]);
    }
    if (ownCount !== layer.createdCount || seenOwn !== ownCount ||
        !mutationSameSequence(remaining, plan.layers[layerIndex].itemUuids)) {
      throw mutationError("verify_mismatch", "Layer " + layer.path.join(".") +
        " is not exactly its baseline plus the items this batch created.");
    }
    layerItemUuids.push(order);
  }
  return { created: created, layerItemUuids: layerItemUuids };
}

function createBatchInitialRollbackEvidence() {
  var steps = [];
  for (var index = 0; index < params.steps.length; index++) {
    steps.push({ operation: params.steps[index].operation, createdUuid: null, outcome: "not_written" });
  }
  return { attemptedCount: 0, steps: steps, layers: [] };
}

function createBatchMarkIndeterminate(evidence, count) {
  for (var index = 0; index < count; index++) {
    evidence[index].outcome = "indeterminate";
    evidence[index].createdUuid = null;
  }
}

/**
 * Removes the attempted items in reverse creation order through each operation's own removal proof, then
 * requires every touched layer to be exactly its baseline again. A layer that does not return to its
 * baseline is never reported as restored.
 */
function createBatchRollback(state) {
  var preflight = state.preflight;
  var evidence = state.operationState.rollbackEvidence;
  var steps = evidence.steps;
  var attempted = state.operationState.attemptedCount || 0;
  evidence.layers = [];
  if (preflight) {
    for (var layerInit = 0; layerInit < preflight.layers.length; layerInit++) {
      evidence.layers.push({ path: preflight.layers[layerInit].path, restoredItemUuids: null });
    }
  }
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) {
    createBatchMarkIndeterminate(steps, attempted);
    return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
  }
  var firstIndeterminate = null;
  var firstOutstanding = null;
  var unidentified = [];
  for (var index = attempted - 1; index >= 0; index--) {
    var entry = preflight.entries[index];
    var stepState = state.operationState.stepStates[index];
    var createdUuid = stepState.operationState.createdUuid;
    if (typeof createdUuid !== "string" || createdUuid.length === 0) {
      // The creation call never returned an identity. Nothing can be removed by UUID, so this step is
      // decided by the layer proof below: baseline means nothing of it survived, anything else is unknown.
      unidentified.push(index);
      continue;
    }
    var outcome = createBatchRemoveCreated(preflight, entry, stepState, createdUuid);
    if (outcome.status === "verified") {
      steps[index].outcome = "removed";
      steps[index].createdUuid = createdUuid;
    } else if (outcome.status === "failed") {
      steps[index].outcome = "outstanding";
      steps[index].createdUuid = createdUuid;
      if (firstOutstanding === null) firstOutstanding = createBatchStepLabel(entry.step) + ": " + outcome.message;
    } else {
      steps[index].outcome = "indeterminate";
      steps[index].createdUuid = null;
      if (firstIndeterminate === null) firstIndeterminate = createBatchStepLabel(entry.step) + ": " + outcome.message;
    }
  }
  var restoredLayers = [];
  var baselineRestored = true;
  for (var layerIndex = 0; layerIndex < preflight.layers.length; layerIndex++) {
    var layer = preflight.layers[layerIndex];
    var order;
    try { order = createBatchLayerOrder(layer.layer); }
    catch (orderError) {
      createBatchMarkIndeterminate(steps, attempted);
      return { status: "indeterminate", message: "Rollback layer order is indeterminate." };
    }
    restoredLayers.push(order);
    if (!mutationSameSequence(order, layer.itemUuids)) {
      baselineRestored = false;
      // An outstanding item of ours explains the layer. Without one, every item this batch created is
      // provably gone and the difference is not ours to name: that is indeterminate, not a failed
      // recovery, and it keeps the lock until the caller reconciles.
      if (firstOutstanding === null && firstIndeterminate === null) {
        firstIndeterminate = "Layer " + layer.path.join(".") +
          " is not at its baseline although every created item was removed.";
      }
    }
  }
  for (var unknownIndex = 0; unknownIndex < unidentified.length; unknownIndex++) {
    var unknownStep = unidentified[unknownIndex];
    if (baselineRestored) {
      steps[unknownStep].outcome = "absent";
      steps[unknownStep].createdUuid = null;
    } else {
      steps[unknownStep].outcome = "indeterminate";
      steps[unknownStep].createdUuid = null;
      if (firstIndeterminate === null) {
        firstIndeterminate = createBatchStepLabel(preflight.entries[unknownStep].step) +
          ": no created native UUID was captured and the layer is not at its baseline.";
      }
    }
  }
  if (firstIndeterminate !== null) return { status: "indeterminate", message: "Rollback is indeterminate. " + firstIndeterminate };
  if (firstOutstanding !== null) {
    return { status: "failed", message: "Rollback did not restore every attempted step. " + firstOutstanding };
  }
  for (var restoredIndex = 0; restoredIndex < restoredLayers.length; restoredIndex++) {
    evidence.layers[restoredIndex].restoredItemUuids = restoredLayers[restoredIndex];
  }
  return { status: "verified" };
}

/**
 * Removes one created item and proves its absence by native UUID. Ownership is checked against the
 * object this batch itself created, so a UUID that now resolves to something else is indeterminate
 * rather than removed.
 */
function createBatchRemoveCreated(preflight, entry, stepState, createdUuid) {
  var target;
  try { target = mutationFindPageItemByUuid(preflight.document, createdUuid); }
  catch (lookupError) { return { status: "indeterminate", message: "target lookup is indeterminate" }; }
  var createdObject = stepState.operationState.createdObject;
  if (target === null) {
    var referenceState;
    try { referenceState = mutationCreatedObjectReferenceState(createdObject, createdUuid); }
    catch (identityError) { return { status: "indeterminate", message: "object-identity lookup is indeterminate" }; }
    if (referenceState === "invalid") return mutationCreatedObjectAbsence(preflight.document, createdUuid);
    return { status: "indeterminate", message: "the created native UUID is absent while its object reference is still live" };
  }
  if (target !== createdObject) return { status: "indeterminate", message: "the created native UUID resolves to another object" };
  if (typeof target.locked !== "boolean" || typeof target.hidden !== "boolean" || typeof target.editable !== "boolean") {
    return { status: "indeterminate", message: "the created object state is unavailable" };
  }
  if (target.locked || target.hidden || !target.editable) {
    return { status: "failed", message: "the created object is not safely removable" };
  }
  var removeThrew = false;
  try { target.remove(); }
  catch (removeError) { removeThrew = true; }
  var remaining;
  try { remaining = mutationFindPageItemByUuid(preflight.document, createdUuid); }
  catch (postLookupError) { return { status: "indeterminate", message: "result lookup is indeterminate" }; }
  if (remaining === null) {
    var remainingState;
    try { remainingState = mutationCreatedObjectReferenceState(createdObject, createdUuid); }
    catch (remainingError) { return { status: "indeterminate", message: "post-remove identity lookup is indeterminate" }; }
    if (remainingState === "invalid") return mutationCreatedObjectAbsence(preflight.document, createdUuid);
    return { status: "indeterminate", message: "the created native UUID is absent while its object reference is still live" };
  }
  return { status: "failed", message: removeThrew
    ? "removal threw before removing the created object"
    : "removal did not remove the created object" };
}

var createBatchExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionLayers: function (phase, preflight) { var layers = []; for (var i = 0; i < preflight.layers.length; i++) layers.push(preflight.layers[i].layer); return layers; },
  editSessionAffected: function (phase, preflight, plan, state) { var uuids = []; if (phase !== "after") return uuids; for (var i = 0; i < state.operationState.stepStates.length; i++) { var created = state.operationState.stepStates[i].operationState.createdUuid; if (typeof created === "string" && created.length > 0) uuids.push(created); } return uuids; },
  initialOperationState: function () {
    return { mutationStarted: false, attemptedCount: 0, stepStates: [],
      rollbackEvidence: createBatchInitialRollbackEvidence() };
  },
  preflight: createBatchPreflight,
  plan: createBatchPlan,
  revalidate: createBatchRevalidate,
  applyMutation: createBatchApply,
  verify: createBatchVerify,
  rollback: createBatchRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function (state) {
    var evidence = state.operationState.rollbackEvidence;
    createBatchMarkIndeterminate(evidence.steps, evidence.steps.length);
    var layers = [];
    if (state.preflight) {
      for (var index = 0; index < state.preflight.layers.length; index++) {
        layers.push({ path: state.preflight.layers[index].path, restoredItemUuids: null });
      }
    }
    evidence.layers = layers;
    return { reasonCode: "created_state_unknown", message: "Create batch apply outcome is indeterminate.",
      evidence: { attemptedCount: evidence.steps.length, steps: evidence.steps, layers: layers } };
  },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var createBatchDocument = createBatchExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === createBatchExecution.preflight.document) {
  createBatchDocument = getDocumentContext();
}
var result = { operation: "create_batch", applied: createBatchExecution.transaction.state === "verified",
  document: createBatchDocument, plan: createBatchExecution.plan, transaction: createBatchExecution.transaction };
if (createBatchExecution.transaction.state === "verified") {
  result.created = createBatchExecution.value.created;
  result.layerItemUuids = createBatchExecution.value.layerItemUuids;
}
`;
export const CREATE_BATCH_HOST_SCRIPT_DIGEST = canonicalSha256(CREATE_BATCH_SCRIPT);
export const CREATE_BATCH_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: CREATE_BATCH_OPERATION, validator: CREATE_BATCH_VALIDATOR,
    canonicalContractVersion: CANONICAL_VERSION, resultSchemaVersion: RESULT_SCHEMA_VERSION,
    terminalClassifierVersion: CLASSIFIER_VERSION, safetyConformanceVersion: CONFORMANCE_VERSION,
    errorMappingVersion: ERROR_MAPPING_VERSION, safetyIdentity: CREATE_BATCH_SAFETY_IDENTITY,
    hostScriptDigest: CREATE_BATCH_HOST_SCRIPT_DIGEST, mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    const digestRequest = 'commandId' in request ? (({ commandId: _commandId, ...rest }) => rest)(request) : request;
    const digest = canonicalSha256({ operation: CREATE_BATCH_OPERATION, validator: CREATE_BATCH_VALIDATOR,
        request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: 'commandId' in request ? request.commandId : null,
        documentKey: request.expectedDocumentKey, digest };
}
export const createBatchToolContract = {
    name: 'illustrator_create_batch',
    title: 'Plan or Apply a Batch of Creations',
    description: `Plan or apply ${CREATE_BATCH_MIN_STEPS} to ${CREATE_BATCH_MAX_STEPS} ordered creations of point text `
        + '(create_point_text), rectangles (create_rectangle) and shapes (create_shape) on explicit layer paths in one document, as one command in '
        + 'one host call, bound by explicit document key. Planning evaluates every step and writes nothing; any unsupported, '
        + 'stale or blocked step rejects the whole batch before a single write. Apply revalidates every step and every touched '
        + 'layer in the same host call, verifies each created item by native UUID, proves every touched layer is exactly its '
        + "baseline plus this batch's own items, and on any failure removes every item it created and proves each layer back "
        + `at its baseline. Several steps may target one layer. Point-text contents total at most ${CREATE_BATCH_MAX_TEXT_CODE_UNITS} `
        + `UTF-16 code units, shapes total at most ${CREATE_BATCH_MAX_SHAPE_ANCHORS} anchors, and a touched layer holds at most ${CREATE_BATCH_MAX_LAYER_ITEMS} direct items after the batch. `
        + 'A rectangle or shape step may carry an initial appearance (opacity, fill, stroke), set and read back in the same call. '
        + 'The returned native UUIDs identify the items until the document is next saved; Illustrator renumbers UUIDs across '
        + 'that save.',
    inputSchema,
    publicInputSchema: createBatchPublicInputSchema,
    outputSchema: createBatchResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(CREATE_BATCH_SAFETY.policy),
    normalizePublicInput,
};
export function createCreateBatchAdapter() {
    return {
        version: 1, operation: CREATE_BATCH_OPERATION, validator: CREATE_BATCH_VALIDATOR,
        safety: CREATE_BATCH_SAFETY, safetyRegistrationIdentity: CREATE_BATCH_SAFETY_IDENTITY,
        adapterIdentity: CREATE_BATCH_ADAPTER_IDENTITY, tool: createBatchToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest,
            safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: createBatchResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: CLASSIFIER_VERSION, safetyConformanceVersion: CONFORMANCE_VERSION,
        errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: CREATE_BATCH_HOST_SCRIPT_DIGEST,
        mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: CREATE_BATCH_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: CREATE_BATCH_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: CREATE_BATCH_OPERATION,
                    documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: CREATE_BATCH_ADAPTER_IDENTITY, mutationHostApplicationMode: 'foreground',
                script: CREATE_BATCH_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = createBatchResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back' ||
                state === 'rollback_failed')
                return { state };
            if (state === 'planned')
                throw new Error('Create batch plan is not a terminal mutation result.');
            throw new Error('Unverified create batch recovery must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error, detail) {
            if (detail?.code === 'CREATE_BATCH_APPLY_BLOCKED') {
                return new Error(`Create batch is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}.`);
            }
            if (detail?.code === 'POINT_TEXT_COLOR_SPACE_MISMATCH') {
                return new Error(`A ${detail.requestedModel ?? 'unknown'} fill cannot be written to a `
                    + `${detail.documentColorSpace ?? 'unknown'} document; implicit color-space conversion is refused.`);
            }
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
