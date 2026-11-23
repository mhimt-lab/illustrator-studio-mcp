import { ANCESTOR_STATE_SCRIPT } from './ancestor-state-host-script.js';
import { TRANSFORM_NESTED_SCRIPT, nestedTranslateEvidenceSchema, nestedTranslateRows, nestedEvidenceMatches, translateNestedEvidence } from './transform-nested-snapshot.js';
import { TRANSFORM_GROUP_SCRIPT, transformGroupRowsSchema, translateGroupRows, groupRowsMatch } from './transform-group-snapshot.js';
import { TRANSFORM_IMAGE_SCRIPT, imageMatches, imageModelMatches, rotateImage, scaleImage, transformImageSchema, } from './transform-image-snapshot.js';
import { TRANSFORM_TEXT_SCRIPT, textFrameMatches, transformTextFrameSchema, translateTextFrame, } from './transform-text-snapshot.js';
import { z } from 'zod';
import { defineBatchStep } from './batch-step-contract.js';
import { TRANSFORM_OBJECT_BATCH_NEXT_CALL } from './batch-step-next-call.js';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { GuidedRefusalError } from '../blocked-guidance.js';
import { MISSING_ARGUMENT_MESSAGE, MISSING_COMMAND_ID_MESSAGE } from '../tool-arguments.js';
import { SNAPSHOT_RESULT_SIZE_SCRIPT } from './snapshot-result-size.js';
import { TRANSFORM_MULTI_MODULE_SCRIPT, TRANSFORM_MULTI_RUNNER_SCRIPT } from './transform-multi-host-script.js';
import { TRANSFORM_MULTI_ANCHORS, normalizeTransformMultiInput, transformMultiInternalInputSchema, transformMultiPublicTransformSchema, transformMultiExpectedBeforeSchema, transformMultiPublishedInputSchema, transformMultiResultSchema, transformMultiSnapshotSchema, } from './transform-multi.js';
import { TRANSFORM_MULTI_GRADIENT_MATRIX_TOLERANCE, TRANSFORM_MULTI_MAX_TARGETS, TRANSFORM_MULTI_MIN_TARGETS } from './transform-multi-host-script.js';
import { boundsSchema, documentContextSchema, layerPathSchema, mutationAuditSchema, } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
export const TRANSFORM_OBJECT_OPERATION = 'transform_object';
export const TRANSFORM_OBJECT_VALIDATOR = { kind: TRANSFORM_OBJECT_OPERATION, version: 1 };
const TRANSFORM_OBJECT_CANONICAL_VERSION = 11;
const TRANSFORM_OBJECT_RESULT_SCHEMA_VERSION = 10;
const TRANSFORM_OBJECT_CLASSIFIER_VERSION = 1;
const TRANSFORM_OBJECT_CONFORMANCE_VERSION = 3;
const TRANSFORM_OBJECT_ERROR_MAPPING_VERSION = 1;
export const TRANSFORM_BOUNDS_TOLERANCE_PT = 0.01;
export const TRANSFORM_SCALE_MIN_PERCENT = 10;
export const TRANSFORM_SCALE_MAX_PERCENT = 1_000;
export const TRANSFORM_MAX_PATH_POINTS = 256;
export const TRANSFORM_GRADIENT_MATRIX_TOLERANCE = TRANSFORM_MULTI_GRADIENT_MATRIX_TOLERANCE;
export const TRANSFORM_GRADIENT_LENGTH_TOLERANCE_PT = TRANSFORM_BOUNDS_TOLERANCE_PT;
export const TRANSFORM_ROTATE_MIN_DEGREES = -180;
export const TRANSFORM_ROTATE_MAX_DEGREES = 180;
const canonicalNumberSchema = z.number().finite().overwrite((value) => Object.is(value, -0) ? 0 : value);
export const translateTransformSchema = z.strictObject({
    type: z.literal('translate'),
    deltaX: canonicalNumberSchema,
    deltaY: canonicalNumberSchema,
}).superRefine((value, context) => {
    if (value.deltaX === 0 && value.deltaY === 0) {
        context.addIssue({ code: 'custom', message: 'Translation must move on at least one axis.' });
    }
});
export const scaleTransformSchema = z.strictObject({
    type: z.literal('scale'),
    scalePercent: z.number().int().min(TRANSFORM_SCALE_MIN_PERCENT).max(TRANSFORM_SCALE_MAX_PERCENT),
    anchor: z.literal('center'),
}).superRefine((value, context) => {
    if (value.scalePercent === 100) {
        context.addIssue({ code: 'custom', message: 'Scale must change the target size.' });
    }
});
export const rotateTransformSchema = z.strictObject({
    type: z.literal('rotate'),
    angleDegrees: z.number().int().min(TRANSFORM_ROTATE_MIN_DEGREES).max(TRANSFORM_ROTATE_MAX_DEGREES),
    anchor: z.literal('center'),
}).superRefine((value, context) => {
    if (value.angleDegrees === 0) {
        context.addIssue({ code: 'custom', message: 'Rotation must change the target orientation.' });
    }
});
export const transformObjectTransformSchema = z.discriminatedUnion('type', [
    translateTransformSchema,
    scaleTransformSchema,
    rotateTransformSchema,
]);
const pointSchema = z.tuple([z.number().finite(), z.number().finite()]);
const pathPointGeometrySchema = z.strictObject({
    anchor: pointSchema,
    leftDirection: pointSchema,
    rightDirection: pointSchema,
});
const pathGeometrySchema = z.strictObject({
    closed: z.boolean(),
    points: z.array(pathPointGeometrySchema).min(1).max(TRANSFORM_MAX_PATH_POINTS),
});
const strokeGeometrySchema = z.strictObject({
    enabled: z.boolean(),
    width: z.number().finite().nonnegative().nullable(),
}).superRefine((value, context) => {
    if (value.enabled !== (value.width !== null)) {
        context.addIssue({ code: 'custom', message: 'Stroke width must be present exactly when stroke is enabled.' });
    }
});
export const transformGradientEvidenceSchema = z.strictObject({
    name: z.string().min(1).max(255),
    type: z.enum(['linear', 'radial']),
    angle: z.number().finite().min(-180).max(180),
    length: z.number().finite(),
    lengthRange: z.tuple([z.number().finite(), z.number().finite()]).optional(),
    matrix: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]),
});
export const transformPathSnapshotSchema = z.strictObject({
    uuid: z.string().min(1).max(255),
    type: z.literal('PathItem'),
    layerPath: layerPathSchema,
    geometricBounds: boundsSchema,
    position: pointSchema,
    locked: z.boolean(),
    hidden: z.boolean(),
    editable: z.boolean(),
    layerVisible: z.boolean(),
    layerLocked: z.boolean(),
    ancestorLocked: z.boolean(),
    ancestorHidden: z.boolean(),
    pathGeometry: pathGeometrySchema.nullable(),
    stroke: strokeGeometrySchema.nullable(),
    fillGradient: transformGradientEvidenceSchema.optional(),
    strokeGradient: transformGradientEvidenceSchema.optional(),
    nestedGroup: nestedTranslateEvidenceSchema.optional(),
});
function refineTextFrameSnapshot(snapshot, context) {
    if ((snapshot.fillGradient !== undefined || snapshot.strokeGradient !== undefined) && (snapshot.type !== 'PathItem' || snapshot.pathGeometry === null)) {
        context.addIssue({ code: 'custom', message: 'Gradient evidence belongs to a PathItem snapshot of a scale or rotation, which carries its path geometry.' });
    }
    if (snapshot.type === 'TextFrame' ? snapshot.textFrame === undefined || snapshot.pathGeometry !== null ||
        snapshot.stroke !== null : snapshot.textFrame !== undefined) {
        context.addIssue({ code: 'custom', message: 'Only TextFrame snapshots carry text evidence, and they require it.' });
    }
    if (snapshot.nestedGroup !== undefined) {
        try {
            const row = nestedTranslateRows(snapshot.nestedGroup).slice(1).find(r => r.uuid === snapshot.uuid);
            if (!row || row.type !== snapshot.type || !['PathItem', 'TextFrame'].includes(snapshot.type))
                throw new Error('Identity mismatch');
        }
        catch {
            context.addIssue({ code: 'custom', message: 'Nested evidence must bind the target child identity and type.' });
        }
    }
}
export const transformPathOrTextSnapshotSchema = transformPathSnapshotSchema.extend({
    type: z.enum(['PathItem', 'TextFrame']),
    textFrame: transformTextFrameSchema.optional(),
}).superRefine(refineTextFrameSnapshot);
export const transformObjectSnapshotSchema = transformPathSnapshotSchema.extend({
    type: z.enum(['PathItem', 'GroupItem', 'TextFrame', 'PlacedItem', 'RasterItem']),
    groupRows: transformGroupRowsSchema.optional(),
    textFrame: transformTextFrameSchema.optional(),
    image: transformImageSchema.optional(),
}).superRefine((snapshot, context) => {
    const isImage = snapshot.type === 'PlacedItem' || snapshot.type === 'RasterItem';
    if (isImage ? snapshot.image === undefined || snapshot.pathGeometry !== null || snapshot.stroke !== null ||
        (snapshot.image.kind === 'linked') !== (snapshot.type === 'PlacedItem')
        : snapshot.image !== undefined) {
        context.addIssue({ code: 'custom', message: 'Only PlacedItem and RasterItem snapshots carry image evidence, and they require it.' });
    }
    if (snapshot.type === 'GroupItem' ? snapshot.groupRows === undefined || snapshot.pathGeometry !== null ||
        snapshot.stroke !== null || snapshot.groupRows[0]?.uuid !== snapshot.uuid
        : snapshot.groupRows !== undefined) {
        context.addIssue({ code: 'custom', message: 'Only GroupItem snapshots require complete descendant evidence.' });
    }
    refineTextFrameSnapshot(snapshot, context);
});
const commonInternalFields = {
    expectedDocumentKey: z.string().min(1).max(16_384),
    targetUuid: z.string().min(1).max(255),
    transform: transformObjectTransformSchema,
};
const transformObjectSingleInternalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternalFields, apply: z.literal(false) }),
    z.strictObject({
        ...commonInternalFields,
        expectedBefore: transformObjectSnapshotSchema,
        confirmedAfter: transformObjectSnapshotSchema,
        apply: z.literal(true),
        commandId: canonicalCommandIdSchema,
    }),
]);
const transformObjectInternalInputSchema = z.union([transformObjectSingleInternalInputSchema, transformMultiInternalInputSchema]);
const publicTransformSchema = z.strictObject({
    type: z.literal('translate'),
    delta_x: canonicalNumberSchema,
    delta_y: canonicalNumberSchema,
}).superRefine((value, context) => {
    if (value.delta_x === 0 && value.delta_y === 0) {
        context.addIssue({ code: 'custom', message: 'Translation must move on at least one axis.' });
    }
});
const publicScaleTransformSchema = z.strictObject({
    type: z.literal('scale'),
    scale_percent: z.number().int().min(TRANSFORM_SCALE_MIN_PERCENT).max(TRANSFORM_SCALE_MAX_PERCENT),
    anchor: z.literal('center'),
}).superRefine((value, context) => {
    if (value.scale_percent === 100) {
        context.addIssue({ code: 'custom', message: 'Scale must change the target size.' });
    }
});
const publicRotateTransformSchema = z.strictObject({
    type: z.literal('rotate'),
    angle_degrees: z.number().int().min(TRANSFORM_ROTATE_MIN_DEGREES).max(TRANSFORM_ROTATE_MAX_DEGREES),
    anchor: z.literal('center'),
}).superRefine((value, context) => {
    if (value.angle_degrees === 0) {
        context.addIssue({ code: 'custom', message: 'Rotation must change the target orientation.' });
    }
});
const publicTransformObjectTransformSchema = z.discriminatedUnion('type', [
    publicTransformSchema,
    publicScaleTransformSchema,
    publicRotateTransformSchema,
]);
const commonPublicFields = {
    expected_document_key: z.string().min(1).max(16_384),
    target_uuid: z.string().min(1).max(255),
    transform: publicTransformObjectTransformSchema,
};
export const transformObjectPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublicFields, apply: z.literal(false).default(false) }),
    z.strictObject({
        ...commonPublicFields,
        expected_before: transformObjectSnapshotSchema,
        confirmed_after: transformObjectSnapshotSchema,
        apply: z.literal(true),
        command_id: applyCommandIdSchema,
    }),
]);
const transformObjectInputSchema = z.strictObject({
    expected_document_key: commonPublicFields.expected_document_key,
    target_uuid: commonPublicFields.target_uuid.optional(),
    targets: z.array(z.strictObject({ target_uuid: commonPublicFields.target_uuid, expected_before: z.unknown().optional(), confirmed_after: z.unknown().optional() })).min(1).max(16).optional(),
    transform: z.union([publicTransformObjectTransformSchema, transformMultiPublicTransformSchema]),
    expected_before: transformObjectSnapshotSchema.optional(),
    confirmed_after: transformObjectSnapshotSchema.optional(),
    apply: z.boolean().default(false),
    command_id: applyCommandIdSchema.optional(),
});
const anchors = z.enum(['center', ...TRANSFORM_MULTI_ANCHORS]);
const anyTransformSchema = z.discriminatedUnion('type', [
    publicTransformSchema,
    z.strictObject({ type: z.literal('scale'), scale_percent: z.number().int().min(TRANSFORM_SCALE_MIN_PERCENT).max(TRANSFORM_SCALE_MAX_PERCENT), anchor: anchors }).superRefine((value, context) => {
        if (value.scale_percent === 100)
            context.addIssue({ code: 'custom', message: 'Scale must change the target size.' });
    }),
    z.strictObject({ type: z.literal('rotate'), angle_degrees: z.number().int().min(TRANSFORM_ROTATE_MIN_DEGREES).max(TRANSFORM_ROTATE_MAX_DEGREES), anchor: anchors }).superRefine((value, context) => {
        if (value.angle_degrees === 0)
            context.addIssue({ code: 'custom', message: 'Rotation must change the target orientation.' });
    }),
]);
const targetEntrySchema = z.strictObject({
    target_uuid: commonPublicFields.target_uuid, expected_before: transformMultiExpectedBeforeSchema.optional(), confirmed_after: transformMultiSnapshotSchema.optional(),
});
const anyCommonFields = {
    expected_document_key: commonPublicFields.expected_document_key,
    target_uuid: commonPublicFields.target_uuid.optional(),
    targets: z.array(targetEntrySchema).min(TRANSFORM_MULTI_MIN_TARGETS).max(TRANSFORM_MULTI_MAX_TARGETS).optional(),
    transform: anyTransformSchema,
};
function missing(context, path) {
    context.addIssue({ code: 'custom', path, message: path.at(-1) === 'command_id' ? MISSING_COMMAND_ID_MESSAGE : MISSING_ARGUMENT_MESSAGE });
}
function refineForm(value, context, apply) {
    const several = value.targets !== undefined;
    if (apply && value.command_id === undefined)
        missing(context, ['command_id']);
    if (several === (value.target_uuid !== undefined)) {
        context.addIssue({ code: 'custom', message: 'Give either target_uuid (one object) or targets (1-16 objects), not both and not neither.' });
        return;
    }
    const anchor = value.transform.anchor;
    if (value.transform.type !== 'translate' && ((anchor === 'center') === several)) {
        context.addIssue({ code: 'custom', path: ['transform', 'anchor'], message: several ? 'Several targets are scaled or rotated about selection_center or each_center.' : 'One target is scaled or rotated about its center.' });
    }
    if (several) {
        const uuids = value.targets.map((target) => target.target_uuid);
        if (new Set(uuids).size !== uuids.length)
            context.addIssue({ code: 'custom', path: ['targets'], message: 'Targets must be distinct native UUIDs.' });
        if (value.expected_before !== undefined || value.confirmed_after !== undefined)
            context.addIssue({ code: 'custom', message: 'With targets, give expected_before and confirmed_after on each target.' });
        value.targets.forEach((target, index) => {
            if (apply ? target.expected_before === undefined : false)
                missing(context, ['targets', index, 'expected_before']);
            if (apply ? target.confirmed_after === undefined : false)
                missing(context, ['targets', index, 'confirmed_after']);
            if (!apply && (target.expected_before !== undefined || target.confirmed_after !== undefined)) {
                context.addIssue({ code: 'custom', path: ['targets', index], message: 'A plan names its targets only.' });
            }
        });
    }
    else if (apply) {
        if (value.expected_before === undefined)
            missing(context, ['expected_before']);
        if (value.confirmed_after === undefined)
            missing(context, ['confirmed_after']);
    }
    else if (value.expected_before !== undefined || value.confirmed_after !== undefined) {
        context.addIssue({ code: 'custom', message: 'A plan carries no expected_before or confirmed_after.' });
    }
}
export const transformObjectAnyPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...anyCommonFields, apply: z.literal(false).default(false) }).superRefine((value, context) => refineForm(value, context, false)),
    z.strictObject({ ...anyCommonFields, expected_before: transformObjectSnapshotSchema.optional(), confirmed_after: transformObjectSnapshotSchema.optional(),
        apply: z.literal(true), command_id: applyCommandIdSchema.optional() }).superRefine((value, context) => refineForm(value, context, true)),
]);
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(z.union([...transformObjectPublicInputSchema.options, ...transformMultiPublishedInputSchema.options]), { io: 'input' });
transformObjectInputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
transformObjectAnyPublicInputSchema._zod.toJSONSchema = () => ({ ...publishedInputSchema });
function normalizePublicInput(input) {
    if (typeof input === 'object' && input !== null && 'targets' in input)
        return normalizeTransformMultiInput(input);
    const value = transformObjectPublicInputSchema.parse(input);
    let transform;
    if (value.transform.type === 'translate') {
        transform = {
            type: value.transform.type,
            deltaX: value.transform.delta_x,
            deltaY: value.transform.delta_y,
        };
    }
    else if (value.transform.type === 'scale') {
        transform = {
            type: value.transform.type,
            scalePercent: value.transform.scale_percent,
            anchor: value.transform.anchor,
        };
    }
    else {
        transform = {
            type: value.transform.type,
            angleDegrees: value.transform.angle_degrees,
            anchor: value.transform.anchor,
        };
    }
    const common = {
        expectedDocumentKey: value.expected_document_key,
        targetUuid: value.target_uuid,
        transform,
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
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']),
    reasonCode: z.enum(['apply_failed', 'verify_mismatch']),
    message: z.string().min(1).max(500),
}).superRefine((value, context) => {
    if ((value.phase === 'apply') !== (value.reasonCode === 'apply_failed')) {
        context.addIssue({ code: 'custom', message: 'Failure phase and reason code do not match.' });
    }
});
const indeterminateFailureSchema = z.strictObject({
    phase: z.literal('apply'),
    reasonCode: z.literal('apply_indeterminate'),
    message: z.string().min(1).max(500),
});
const rollbackEvidenceFields = {
    targetUuid: z.string().min(1).max(255),
    restoredSnapshot: transformObjectSnapshotSchema.nullable(),
};
const transformTransactionSchema = z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('planned'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('verified'), audit: mutationAuditSchema }),
    z.strictObject({
        state: z.literal('apply_failed'),
        failure: failureSchema,
        rollback: z.strictObject({ status: z.literal('not_required') }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rolled_back'),
        failure: failureSchema,
        rollback: z.strictObject({ status: z.literal('verified'), ...rollbackEvidenceFields }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rollback_failed'),
        failure: failureSchema,
        rollback: z.strictObject({
            status: z.literal('failed'),
            reasonCode: z.literal('rollback_failed'),
            message: z.string().min(1).max(500),
            ...rollbackEvidenceFields,
        }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('apply_indeterminate'),
        failure: indeterminateFailureSchema,
        rollback: z.strictObject({
            status: z.literal('indeterminate'),
            reasonCode: z.literal('transform_state_unknown'),
            message: z.string().min(1).max(500),
            targetUuid: z.string().min(1).max(255),
            restoredSnapshot: z.null(),
        }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rollback_indeterminate'),
        failure: failureSchema,
        rollback: z.strictObject({
            status: z.literal('indeterminate'),
            reasonCode: z.literal('rollback_indeterminate'),
            message: z.string().min(1).max(500),
            ...rollbackEvidenceFields,
        }),
        audit: mutationAuditSchema,
    }),
]).superRefine((transaction, context) => {
    const compact = transaction.audit.map((event) => [
        event.phase,
        event.event,
        'reasonCode' in event ? event.reasonCode : null,
    ]);
    const prefix = [
        ['preflight', 'started', null],
        ['preflight', 'succeeded', null],
        ['plan', 'started', null],
        ['plan', 'succeeded', null],
    ];
    let expected;
    if (transaction.state === 'planned') {
        expected = [...prefix,
            ['apply', 'skipped', 'not_requested'],
            ['verify', 'skipped', 'not_requested'],
            ['rollback', 'skipped', 'not_requested']];
    }
    else if (transaction.state === 'verified') {
        expected = [...prefix,
            ['apply', 'started', null], ['apply', 'attempted', null], ['apply', 'succeeded', null],
            ['verify', 'started', null], ['verify', 'succeeded', null],
            ['rollback', 'skipped', 'not_required']];
    }
    else if (transaction.state === 'apply_failed') {
        expected = [...prefix,
            ['apply', 'started', null], ['apply', 'failed', 'apply_failed'],
            ['verify', 'skipped', 'not_required'], ['rollback', 'skipped', 'not_required']];
    }
    else if (transaction.state === 'apply_indeterminate') {
        expected = [...prefix,
            ['apply', 'started', null], ['apply', 'attempted', null], ['apply', 'failed', 'apply_indeterminate']];
    }
    else {
        const failurePath = transaction.failure.phase === 'apply'
            ? [
                ['apply', 'started', null], ['apply', 'attempted', null], ['apply', 'failed', 'apply_failed'],
                ['verify', 'skipped', 'not_required'],
            ]
            : [
                ['apply', 'started', null], ['apply', 'attempted', null], ['apply', 'succeeded', null],
                ['verify', 'started', null], ['verify', 'failed', 'verify_mismatch'],
            ];
        expected = [...prefix, ...failurePath, ['rollback', 'started', null],
            transaction.state === 'rolled_back'
                ? ['rollback', 'succeeded', null]
                : ['rollback', 'failed', transaction.state === 'rollback_failed'
                        ? 'rollback_failed' : 'rollback_indeterminate']];
    }
    if (compact.length !== expected.length || compact.some((event, index) => event[0] !== expected[index]?.[0] || event[1] !== expected[index]?.[1] || event[2] !== expected[index]?.[2])) {
        context.addIssue({ code: 'custom', message: 'Transform transaction audit does not match its state.', path: ['audit'] });
    }
    for (let index = 0; index < transaction.audit.length; index++) {
        if (transaction.audit[index]?.sequence !== index) {
            context.addIssue({ code: 'custom', message: 'Transform audit sequence must be contiguous.', path: ['audit', index] });
        }
    }
    if ('failure' in transaction) {
        const failure = transaction.audit.filter((event) => event.event === 'failed' &&
            event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode);
        if (failure.length !== 1 || failure[0]?.event !== 'failed' || failure[0].message !== transaction.failure.message) {
            context.addIssue({ code: 'custom', message: 'Transform failure summary must match its audit event.', path: ['failure'] });
        }
    }
});
const blockerSchema = z.enum([
    'document_mutation_not_allowed',
    'target_locked',
    'target_hidden',
    'target_not_editable',
    'layer_hidden',
    'layer_locked',
    'ancestor_hidden',
    'ancestor_locked',
]);
function canonicalGeometryNumber(value) {
    const rounded = Number(value.toFixed(12));
    return Object.is(rounded, -0) ? 0 : rounded;
}
function mapGeometryPoint(point, transform) {
    const [x, y] = transform(point[0], point[1]);
    return [canonicalGeometryNumber(x), canonicalGeometryNumber(y)];
}
function geometryPointMatches(left, right) {
    return Math.abs(left[0] - right[0]) <= TRANSFORM_BOUNDS_TOLERANCE_PT &&
        Math.abs(left[1] - right[1]) <= TRANSFORM_BOUNDS_TOLERANCE_PT;
}
function straightPathBounds(pathGeometry) {
    if (!pathGeometry.closed || pathGeometry.points.length < 3) {
        throw new Error('Rotation requires a closed PathItem with at least 3 path points.');
    }
    for (const point of pathGeometry.points) {
        if (!geometryPointMatches(point.anchor, point.leftDirection) ||
            !geometryPointMatches(point.anchor, point.rightDirection)) {
            throw new Error('Rotation supports straight path segments only; curve handles are unsupported.');
        }
    }
    const anchors = pathGeometry.points.map((point) => point.anchor);
    return [
        canonicalGeometryNumber(Math.min(...anchors.map((point) => point[0]))),
        canonicalGeometryNumber(Math.max(...anchors.map((point) => point[1]))),
        canonicalGeometryNumber(Math.max(...anchors.map((point) => point[0]))),
        canonicalGeometryNumber(Math.min(...anchors.map((point) => point[1]))),
    ];
}
function rotateGradientEvidence(gradient, degrees) {
    if (gradient === undefined)
        return undefined;
    const radians = degrees * Math.PI / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const [a, b, c, d] = gradient.matrix;
    const matrix = [cosine * a - sine * b, sine * a + cosine * b, cosine * c - sine * d, sine * c + cosine * d];
    const angle = Math.atan2(matrix[1], matrix[0]) * 180 / Math.PI;
    return { ...gradient, matrix, angle: angle === -180 ? 180 : angle };
}
function scaleGradientEvidence(gradient, factor, stroke) {
    if (gradient === undefined)
        return undefined;
    if (!stroke)
        return { ...gradient, length: gradient.length * factor };
    const scaled = gradient.length * factor;
    return { ...gradient, lengthRange: [Math.min(gradient.length, scaled), Math.max(gradient.length, scaled)] };
}
function deriveExpectedSnapshot(before, transform) {
    if (transform.type === 'translate') {
        const translatePoint = (x, y) => [x + transform.deltaX, y + transform.deltaY];
        return {
            ...before,
            ...(before.groupRows === undefined ? {} : { groupRows: translateGroupRows(before.groupRows, transform.deltaX, transform.deltaY) }),
            ...(before.textFrame === undefined ? {} : { textFrame: translateTextFrame(before.textFrame, transform.deltaX, transform.deltaY) }),
            ...(before.nestedGroup === undefined ? {} : { nestedGroup: translateNestedEvidence(before.nestedGroup, before.uuid, transform.deltaX, transform.deltaY) }),
            geometricBounds: before.geometricBounds.map((value, index) => canonicalGeometryNumber(value + (index % 2 === 0 ? transform.deltaX : transform.deltaY))),
            position: mapGeometryPoint(before.position, translatePoint),
            pathGeometry: before.pathGeometry === null ? null : {
                closed: before.pathGeometry.closed,
                points: before.pathGeometry.points.map((point) => ({
                    anchor: mapGeometryPoint(point.anchor, translatePoint),
                    leftDirection: mapGeometryPoint(point.leftDirection, translatePoint),
                    rightDirection: mapGeometryPoint(point.rightDirection, translatePoint),
                })),
            },
        };
    }
    if (before.image !== undefined) {
        if (!imageModelMatches(before.image, before.geometricBounds, TRANSFORM_BOUNDS_TOLERANCE_PT)) {
            throw new Error('Image bounds do not match its matrix; scale and rotation are unsupported for this image.');
        }
        if (transform.type === 'rotate') {
            const rotated = rotateImage(before.image, before.geometricBounds, transform.angleDegrees);
            return { ...before, geometricBounds: rotated.bounds, position: [rotated.bounds[0], rotated.bounds[1]], image: rotated.image };
        }
        const factor = transform.scalePercent / 100;
        const [left, top, right, bottom] = before.geometricBounds;
        const cx = (left + right) / 2;
        const cy = (top + bottom) / 2;
        const geometricBounds = [cx + (left - cx) * factor, cy + (top - cy) * factor, cx + (right - cx) * factor, cy + (bottom - cy) * factor]
            .map(canonicalGeometryNumber);
        return { ...before, geometricBounds, position: [geometricBounds[0], geometricBounds[1]], image: scaleImage(before.image, factor) };
    }
    if (before.type !== 'PathItem' || before.pathGeometry === null || before.stroke === null) {
        throw new Error('Scale and rotation planning require bounded path geometry and stroke state.');
    }
    const [left, top, right, bottom] = before.geometricBounds;
    if (left === undefined || top === undefined || right === undefined || bottom === undefined) {
        throw new Error('Scale and rotation planning require four geometric bounds.');
    }
    const width = right - left;
    const height = top - bottom;
    if (width <= TRANSFORM_BOUNDS_TOLERANCE_PT || height <= TRANSFORM_BOUNDS_TOLERANCE_PT) {
        throw new Error('Scale planning requires non-degenerate bounds.');
    }
    const centerX = (left + right) / 2;
    const centerY = (top + bottom) / 2;
    if (transform.type === 'rotate') {
        const sourceAnchorBounds = straightPathBounds(before.pathGeometry);
        if (sourceAnchorBounds.some((value, index) => Math.abs(value - before.geometricBounds[index]) > TRANSFORM_BOUNDS_TOLERANCE_PT)) {
            throw new Error('Rotation requires geometric bounds derived from the complete straight path geometry.');
        }
        const radians = transform.angleDegrees * Math.PI / 180;
        const cosine = Math.cos(radians);
        const sine = Math.sin(radians);
        const rotatePoint = (x, y) => [
            centerX + (x - centerX) * cosine - (y - centerY) * sine,
            centerY + (x - centerX) * sine + (y - centerY) * cosine,
        ];
        const pathGeometry = {
            closed: true,
            points: before.pathGeometry.points.map((point) => ({
                anchor: mapGeometryPoint(point.anchor, rotatePoint),
                leftDirection: mapGeometryPoint(point.leftDirection, rotatePoint),
                rightDirection: mapGeometryPoint(point.rightDirection, rotatePoint),
            })),
        };
        const geometricBounds = straightPathBounds(pathGeometry);
        const rotatedFill = rotateGradientEvidence(before.fillGradient, transform.angleDegrees);
        const rotatedStroke = rotateGradientEvidence(before.strokeGradient, transform.angleDegrees);
        return {
            ...before,
            ...(rotatedFill === undefined ? {} : { fillGradient: rotatedFill }),
            ...(rotatedStroke === undefined ? {} : { strokeGradient: rotatedStroke }),
            geometricBounds,
            position: [geometricBounds[0], geometricBounds[1]],
            pathGeometry,
        };
    }
    const factor = transform.scalePercent / 100;
    const scalePoint = (x, y) => [
        centerX + (x - centerX) * factor,
        centerY + (y - centerY) * factor,
    ];
    const geometricBounds = [
        centerX + (left - centerX) * factor,
        centerY + (top - centerY) * factor,
        centerX + (right - centerX) * factor,
        centerY + (bottom - centerY) * factor,
    ].map(canonicalGeometryNumber);
    const [scaledLeft, scaledTop] = geometricBounds;
    if (scaledLeft === undefined || scaledTop === undefined) {
        throw new Error('Scale planning could not derive the target position.');
    }
    const scaledFill = scaleGradientEvidence(before.fillGradient, factor, false);
    const scaledStroke = scaleGradientEvidence(before.strokeGradient, factor, true);
    return {
        ...before,
        ...(scaledFill === undefined ? {} : { fillGradient: scaledFill }),
        ...(scaledStroke === undefined ? {} : { strokeGradient: scaledStroke }),
        geometricBounds,
        position: [scaledLeft, scaledTop],
        pathGeometry: {
            closed: before.pathGeometry.closed,
            points: before.pathGeometry.points.map((point) => ({
                anchor: mapGeometryPoint(point.anchor, scalePoint),
                leftDirection: mapGeometryPoint(point.leftDirection, scalePoint),
                rightDirection: mapGeometryPoint(point.rightDirection, scalePoint),
            })),
        },
    };
}
function gradientLengthMatches(left, right) {
    const tolerance = TRANSFORM_GRADIENT_LENGTH_TOLERANCE_PT;
    if (left.lengthRange !== undefined && right.lengthRange !== undefined) {
        return left.lengthRange.every((value, index) => Math.abs(value - right.lengthRange[index]) <= tolerance);
    }
    const ranged = left.lengthRange !== undefined ? left : right.lengthRange !== undefined ? right : undefined;
    if (ranged === undefined)
        return Math.abs(left.length - right.length) <= tolerance;
    const other = ranged === left ? right : left;
    const [low, high] = ranged.lengthRange;
    return other.length >= low - tolerance && other.length <= high + tolerance;
}
function gradientEvidenceMatches(left, right) {
    if (left === undefined || right === undefined)
        return left === right;
    return left.name === right.name && left.type === right.type &&
        left.matrix.every((value, index) => Math.abs(value - right.matrix[index]) <= TRANSFORM_GRADIENT_MATRIX_TOLERANCE) &&
        gradientLengthMatches(left, right);
}
export function snapshotsWithinTolerance(left, right) {
    if (!nestedEvidenceMatches(left.nestedGroup, right.nestedGroup) || !groupRowsMatch(left.groupRows, right.groupRows) || !textFrameMatches(left.textFrame, right.textFrame) ||
        !imageMatches(left.image, right.image))
        return false;
    if (left.uuid !== right.uuid || left.type !== right.type ||
        canonicalDigest(left.layerPath) !== canonicalDigest(right.layerPath) ||
        left.locked !== right.locked || left.hidden !== right.hidden || left.editable !== right.editable ||
        left.layerVisible !== right.layerVisible || left.layerLocked !== right.layerLocked ||
        left.ancestorLocked !== right.ancestorLocked || left.ancestorHidden !== right.ancestorHidden ||
        left.geometricBounds.some((value, index) => Math.abs(value - right.geometricBounds[index]) > TRANSFORM_BOUNDS_TOLERANCE_PT) ||
        left.position.some((value, index) => Math.abs(value - right.position[index]) > TRANSFORM_BOUNDS_TOLERANCE_PT) ||
        (left.stroke === null) !== (right.stroke === null) ||
        (left.pathGeometry === null) !== (right.pathGeometry === null) ||
        !gradientEvidenceMatches(left.fillGradient, right.fillGradient) || !gradientEvidenceMatches(left.strokeGradient, right.strokeGradient))
        return false;
    if (left.stroke !== null && right.stroke !== null &&
        (left.stroke.enabled !== right.stroke.enabled ||
            (left.stroke.width === null) !== (right.stroke.width === null) ||
            (left.stroke.width !== null && right.stroke.width !== null &&
                Math.abs(left.stroke.width - right.stroke.width) > TRANSFORM_BOUNDS_TOLERANCE_PT)))
        return false;
    if (left.pathGeometry !== null && right.pathGeometry !== null) {
        if (left.pathGeometry.closed !== right.pathGeometry.closed ||
            left.pathGeometry.points.length !== right.pathGeometry.points.length)
            return false;
        return left.pathGeometry.points.every((point, index) => {
            const other = right.pathGeometry.points[index];
            return geometryPointMatches(point.anchor, other.anchor) &&
                geometryPointMatches(point.leftDirection, other.leftDirection) &&
                geometryPointMatches(point.rightDirection, other.rightDirection);
        });
    }
    return true;
}
function snapshotsMatchTransformContract(left, right, transform) {
    return transform.type === 'rotate' || left.fillGradient !== undefined || left.strokeGradient !== undefined || left.type === 'GroupItem' || left.type === 'TextFrame' || left.image !== undefined || left.nestedGroup !== undefined
        ? snapshotsWithinTolerance(left, right)
        : canonicalDigest(left) === canonicalDigest(right);
}
export const transformObjectPlanSchema = z.strictObject({
    operation: z.literal(TRANSFORM_OBJECT_OPERATION),
    documentKey: z.string().min(1).max(16_384),
    transform: transformObjectTransformSchema,
    before: transformObjectSnapshotSchema,
    after: transformObjectSnapshotSchema,
    applyBlockedReasonCodes: z.array(blockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    const confirmedAndClear = plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0;
    if (plan.applyAllowed !== confirmedAndClear) {
        context.addIssue({ code: 'custom', message: 'Transform applyAllowed must require confirmation and no blockers.' });
    }
    if (plan.before.uuid !== plan.after.uuid || plan.before.type !== plan.after.type ||
        canonicalDigest(plan.before.layerPath) !== canonicalDigest(plan.after.layerPath) ||
        plan.before.locked !== plan.after.locked || plan.before.hidden !== plan.after.hidden ||
        plan.before.editable !== plan.after.editable || plan.before.layerVisible !== plan.after.layerVisible ||
        plan.before.layerLocked !== plan.after.layerLocked || plan.before.ancestorLocked !== plan.after.ancestorLocked ||
        plan.before.ancestorHidden !== plan.after.ancestorHidden) {
        context.addIssue({ code: 'custom', message: 'Translate plan must preserve target identity and safety state.' });
    }
    try {
        const expected = deriveExpectedSnapshot(plan.before, plan.transform);
        if (!snapshotsMatchTransformContract(expected, plan.after, plan.transform)) {
            context.addIssue({ code: 'custom', message: 'Transform after snapshot must equal the derived geometry.' });
        }
    }
    catch (error) {
        context.addIssue({
            code: 'custom',
            message: error instanceof Error ? error.message : 'Transform geometry cannot be derived.',
            path: ['before'],
        });
    }
});
export const transformObjectResultSchema = z.union([
    z.strictObject({
        operation: z.literal(TRANSFORM_OBJECT_OPERATION),
        applied: z.literal(false),
        document: documentContextSchema,
        plan: transformObjectPlanSchema,
        transaction: transformTransactionSchema,
    }),
    z.strictObject({
        operation: z.literal(TRANSFORM_OBJECT_OPERATION),
        applied: z.literal(true),
        document: documentContextSchema,
        plan: transformObjectPlanSchema,
        postcondition: transformObjectSnapshotSchema,
        transaction: transformTransactionSchema,
    }),
]).superRefine((result, context) => {
    if (result.applied) {
        if (result.transaction.state !== 'verified') {
            context.addIssue({ code: 'custom', message: 'Applied transform requires a verified transaction.' });
        }
        if (!snapshotsMatchTransformContract(result.postcondition, result.plan.after, result.plan.transform)) {
            context.addIssue({ code: 'custom', message: 'Transform postcondition must match the planned after snapshot.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified transform transaction must be applied.' });
    }
    if (result.transaction.state === 'rolled_back' &&
        (result.transaction.rollback.restoredSnapshot === null ||
            !snapshotsMatchTransformContract(result.transaction.rollback.restoredSnapshot, result.plan.before, result.plan.transform))) {
        context.addIssue({
            code: 'custom',
            message: 'A rolled-back transform must prove restoration of the planned before snapshot.',
            path: ['transaction', 'rollback', 'restoredSnapshot'],
        });
    }
});
export const transformObjectAnyResultSchema = z.union([transformObjectResultSchema, transformMultiResultSchema]);
function isMultiResult(result) { return 'targets' in result.plan; }
const finalizedAtSchema = z.string().datetime({ offset: true });
export const transformObjectResponseSchema = z.strictObject({
    outcome: transformObjectAnyResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: finalizedAtSchema }),
});
export const TRANSFORM_OBJECT_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: TRANSFORM_OBJECT_OPERATION,
    policy: {
        version: 1,
        class: 'update_existing',
        destructive: false,
        evidence: {
            identity: 'target_native_uuid',
            beforeState: 'before_state_hash',
            postcondition: 'updated_state_matches_plan',
        },
        preconditions: {
            documentBinding: 'explicit_document_key',
            compareAndSet: 'before_state_hash_match',
        },
        confirmation: 'exact_change_set',
        recovery: {
            mode: 'verified_inverse',
            verification: 'restored_state_matches_before_hash',
            partialRecovery: 'indeterminate',
        },
        terminal: {
            success: 'verified',
            failure: 'proven_pre_apply_or_verified_recovery',
            partialSuccess: 'nonterminal_until_reconciled',
        },
        replay: {
            requestBinding: 'canonical_request_digest',
            retry: 'return_attested_terminal_result',
            beforeTerminal: 'reconcile_required',
            reapplyOnRetry: false,
        },
    },
    capabilities: {
        class: 'update_existing',
        explicitDocumentBinding: true,
        bindTargetNativeUuid: true,
        captureBeforeStateHash: true,
        compareAndSetBeforeApply: true,
        verifyUpdatedState: true,
        recoveryMode: 'verified_inverse',
        verifyRestoredBeforeState: true,
        reconcileIndeterminate: true,
        durableTerminalReplay: true,
        trustedTerminalAttestationResolver: true,
    },
});
export const TRANSFORM_OBJECT_SAFETY_IDENTITY = canonicalDigest(TRANSFORM_OBJECT_SAFETY);
function transformSafetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    const beforeStateHash = canonicalDigest(result.plan.before);
    const afterStateHash = canonicalDigest(result.plan.after);
    const changeSetHash = canonicalDigest({
        targetUuid: result.plan.before.uuid,
        transform: result.plan.transform,
        before: result.plan.before,
        after: result.plan.after,
    });
    return bindOperationSafetyPlan({
        policyVersion: 1,
        operationClass: 'update_existing',
        operationId: TRANSFORM_OBJECT_OPERATION,
        canonicalRequestDigest: requestDigest,
        evidence: {
            documentKey: admissionDocumentKey,
            targetUuid: result.plan.before.uuid,
            beforeStateHash,
            plannedAfterStateHash: afterStateHash,
            plannedChangeSetDigest: changeSetHash,
        },
        preconditions: {
            status: result.plan.applyBlockedReasonCodes.length === 0 ? 'satisfied' : 'blocked',
            compareAndSetMatched: result.plan.applyBlockedReasonCodes.length === 0,
        },
        confirmation: {
            kind: 'exact_change_set',
            canonicalRequestDigest: requestDigest,
            changeSetHash,
            status: result.plan.confirmationStatus,
        },
        applyAllowed: result.plan.applyAllowed,
    });
}
function transformSafetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' ||
        transaction.state === 'rollback_indeterminate' || transaction.state === 'rollback_failed') {
        throw new Error('Indeterminate or failed recovery cannot be represented as a terminal transform result.');
    }
    const common = {
        policyVersion: 1,
        operationClass: 'update_existing',
        operationId: TRANSFORM_OBJECT_OPERATION,
        canonicalRequestDigest: requestDigest,
        planDigest: plan.planDigest,
        attestation,
    };
    const beforeStateHash = canonicalDigest(result.plan.before);
    if (transaction.state === 'verified' && result.applied) {
        return operationSafetyResultSchema.parse({
            ...common,
            evidence: {
                targetUuid: result.plan.before.uuid,
                beforeStateHash,
                afterStateHash: canonicalDigest(result.plan.after),
                restoredStateHash: null,
                restoredBeforeStateVerified: false,
            },
            executionEvidence: { outcome: 'completed' },
            resolution: {
                status: 'succeeded', terminal: true, recovery: 'not_required',
                proof: { kind: 'verified_postcondition' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false },
            },
        });
    }
    if (transaction.state === 'rolled_back') {
        return operationSafetyResultSchema.parse({
            ...common,
            evidence: {
                targetUuid: result.plan.before.uuid,
                beforeStateHash,
                afterStateHash: null,
                restoredStateHash: beforeStateHash,
                restoredBeforeStateVerified: true,
            },
            executionEvidence: { outcome: 'completed' },
            resolution: {
                status: 'recovered', terminal: true, recovery: 'verified',
                proof: { kind: 'verified_recovery' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false },
            },
        });
    }
    return operationSafetyResultSchema.parse({
        ...common,
        evidence: {
            targetUuid: result.plan.before.uuid,
            beforeStateHash,
            afterStateHash: null,
            restoredStateHash: null,
            restoredBeforeStateVerified: false,
        },
        executionEvidence: { outcome: 'proven_pre_apply' },
        resolution: {
            status: 'failed', terminal: true, recovery: 'not_required',
            proof: { kind: 'proven_pre_apply', mutationAttempted: false },
            replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false },
        },
    });
}
function firstTargetEvidence(uuids) {
    return { targetUuid: uuids[0] };
}
function transformMultiSafetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    const beforeStateHash = canonicalDigest(result.plan.targets.map((target) => target.before));
    const afterStateHash = canonicalDigest(result.plan.targets.map((target) => target.after));
    const changeSetHash = canonicalDigest({
        transform: result.plan.transform, pivot: result.plan.pivot,
        targets: result.plan.targets.map((target) => ({ targetUuid: target.targetUuid, beforeStateHash: canonicalDigest(target.before), afterStateHash: canonicalDigest(target.after) })),
        beforeStateHash, afterStateHash,
    });
    return bindOperationSafetyPlan({
        policyVersion: 1,
        operationClass: 'update_existing',
        operationId: TRANSFORM_OBJECT_OPERATION,
        canonicalRequestDigest: requestDigest,
        evidence: {
            documentKey: admissionDocumentKey,
            ...firstTargetEvidence(result.plan.targets.map((target) => target.targetUuid)),
            beforeStateHash,
            plannedAfterStateHash: afterStateHash,
            plannedChangeSetDigest: changeSetHash,
        },
        preconditions: {
            status: result.plan.applyBlockedReasonCodes.length === 0 ? 'satisfied' : 'blocked',
            compareAndSetMatched: result.plan.applyBlockedReasonCodes.length === 0,
        },
        confirmation: { kind: 'exact_change_set', canonicalRequestDigest: requestDigest, changeSetHash, status: result.plan.confirmationStatus },
        applyAllowed: result.plan.applyAllowed,
    });
}
function transformMultiSafetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' ||
        transaction.state === 'rollback_indeterminate' || transaction.state === 'rollback_failed') {
        throw new Error('Indeterminate or failed recovery cannot be represented as a terminal transform result.');
    }
    const common = {
        policyVersion: 1, operationClass: 'update_existing', operationId: TRANSFORM_OBJECT_OPERATION,
        canonicalRequestDigest: requestDigest, planDigest: plan.planDigest, attestation,
    };
    const boundPlan = plan;
    const evidence = firstTargetEvidence(result.plan.targets.map((target) => target.targetUuid));
    const beforeStateHash = boundPlan.evidence.beforeStateHash;
    const replay = { status: 'durable_terminal', action: 'return_attested_result', reapply: false };
    if (transaction.state === 'verified' && result.applied) {
        return operationSafetyResultSchema.parse({
            ...common,
            evidence: { ...evidence, beforeStateHash, afterStateHash: boundPlan.evidence.plannedAfterStateHash, restoredStateHash: null, restoredBeforeStateVerified: false },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'succeeded', terminal: true, recovery: 'not_required', proof: { kind: 'verified_postcondition' }, replay },
        });
    }
    if (transaction.state === 'rolled_back') {
        return operationSafetyResultSchema.parse({
            ...common,
            evidence: { ...evidence, beforeStateHash, afterStateHash: null, restoredStateHash: beforeStateHash, restoredBeforeStateVerified: true },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'recovered', terminal: true, recovery: 'verified', proof: { kind: 'verified_recovery' }, replay },
        });
    }
    return operationSafetyResultSchema.parse({
        ...common,
        evidence: { ...evidence, beforeStateHash, afterStateHash: null, restoredStateHash: null, restoredBeforeStateVerified: false },
        executionEvidence: { outcome: 'proven_pre_apply' },
        resolution: { status: 'failed', terminal: true, recovery: 'not_required', proof: { kind: 'proven_pre_apply', mutationAttempted: false }, replay },
    });
}
async function assertTransformSafetyConformance(value, requestDigest, attestation, resolver) {
    const parsed = transformObjectAnyResultSchema.parse(value);
    if (isMultiResult(parsed)) {
        const multiPlan = transformMultiSafetyPlan(parsed, requestDigest, attestation?.documentKey);
        if (parsed.transaction.state === 'planned')
            return;
        if (attestation === null || resolver === null)
            throw new Error('Transform terminal result requires a durable attestation resolver.');
        await assertOperationSafetyAdapterConformance({
            registration: TRANSFORM_OBJECT_SAFETY, plan: multiPlan, result: transformMultiSafetyResult(parsed, requestDigest, attestation, multiPlan),
        }, resolver);
        return;
    }
    const result = parsed;
    const plan = transformSafetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null) {
        throw new Error('Transform terminal result requires a durable attestation resolver.');
    }
    await assertOperationSafetyAdapterConformance({
        registration: TRANSFORM_OBJECT_SAFETY,
        plan,
        result: transformSafetyResult(result, requestDigest, attestation, plan),
    }, resolver);
}
export const TRANSFORM_OBJECT_MODULE_SCRIPT = `var TRANSFORM_TOLERANCE_PT = ${TRANSFORM_BOUNDS_TOLERANCE_PT};
var TRANSFORM_SCALE_MIN_PERCENT = ${TRANSFORM_SCALE_MIN_PERCENT};
var TRANSFORM_SCALE_MAX_PERCENT = ${TRANSFORM_SCALE_MAX_PERCENT};
var TRANSFORM_MAX_PATH_POINTS = ${TRANSFORM_MAX_PATH_POINTS};
var TRANSFORM_GRADIENT_MATRIX_TOLERANCE = ${TRANSFORM_GRADIENT_MATRIX_TOLERANCE};
var TRANSFORM_GRADIENT_LENGTH_TOLERANCE_PT = ${TRANSFORM_GRADIENT_LENGTH_TOLERANCE_PT};
var TRANSFORM_ROTATE_MIN_DEGREES = ${TRANSFORM_ROTATE_MIN_DEGREES};
var TRANSFORM_ROTATE_MAX_DEGREES = ${TRANSFORM_ROTATE_MAX_DEGREES};
${ANCESTOR_STATE_SCRIPT}
${TRANSFORM_NESTED_SCRIPT}
function transformFindTarget(document, uuid) {
  // Measured: native UUID lookup misreports images, so a runner with the image module scans their collections first.
  if (typeof transformImageFind === "function") {
    var image = transformImageFind(document, uuid);
    if (image !== null) return image;
  }
  if (typeof document.getPageItemFromUuid !== "function") {
    throw mutationError("preflight_failed", "Illustrator native UUID lookup is unavailable.");
  }
  try {
    var target = document.getPageItemFromUuid(uuid);
    if (target === null || target === undefined) return null;
    return target;
  } catch (lookupError) {
    var message = lookupError && lookupError.message ? String(lookupError.message) : "";
    if (lookupError && lookupError.name === "Error" && lookupError.number === 1200 &&
        message === "an Illustrator error occurred: 1346458189 ('MRAP')") return null;
    throw lookupError;
  }
}

function transformLayerPath(document, targetLayer) {
  function visit(layers, prefix) {
    for (var index = 0; index < layers.length; index++) {
      var layer = layers[index];
      var path = prefix.concat([index]);
      if (layer === targetLayer) return path;
      if (path.length < 64 && layer.layers && layer.layers.length > 0) {
        var nested = visit(layer.layers, path);
        if (nested !== null) return nested;
      }
    }
    return null;
  }
  return visit(document.layers, []);
}

function transformNumber(value, name) {
  var rounded = Number(mutationFiniteNumber(value, name).toFixed(12));
  return rounded === 0 ? 0 : rounded;
}

function transformPoint(value, name) {
  if (!value || value.length !== 2) throw mutationError("preflight_failed", name + " is unavailable.");
  return [transformNumber(value[0], name + "[0]"), transformNumber(value[1], name + "[1]")];
}

function transformPathGeometry(target) {
  if (!target.pathPoints || target.pathPoints.length < 1 ||
      target.pathPoints.length > TRANSFORM_MAX_PATH_POINTS || typeof target.closed !== "boolean") {
    throw mutationError("preflight_failed", "Transform supports PathItems with 1 to " +
      TRANSFORM_MAX_PATH_POINTS + " readable path points only.");
  }
  var points = [];
  for (var index = 0; index < target.pathPoints.length; index++) {
    var point = target.pathPoints[index];
    points.push({
      anchor: transformPoint(point.anchor, "pathPoints[" + index + "].anchor"),
      leftDirection: transformPoint(point.leftDirection, "pathPoints[" + index + "].leftDirection"),
      rightDirection: transformPoint(point.rightDirection, "pathPoints[" + index + "].rightDirection")
    });
  }
  return { closed: target.closed, points: points };
}

/** A gradient fill or stroke: its matrix is object-relative and its angle is the direction of the matrix (the angle getter reads 0). */
function transformGradientEvidence(color, name) {
  if (!color || color.typename !== "GradientColor") return null;
  var gradient = color.gradient;
  var kind = gradient ? String(gradient.type) : "";
  var type = null;
  if (kind === "GradientType.LINEAR") type = "linear";
  else if (kind === "GradientType.RADIAL") type = "radial";
  if (type === null || typeof gradient.name !== "string" || gradient.name.length === 0 || !color.matrix) {
    throw mutationError("preflight_failed", name + " gradient name, type or matrix is unavailable.");
  }
  var a = transformNumber(color.matrix.mValueA, name + ".matrix.a");
  var b = transformNumber(color.matrix.mValueB, name + ".matrix.b");
  var c = transformNumber(color.matrix.mValueC, name + ".matrix.c");
  var d = transformNumber(color.matrix.mValueD, name + ".matrix.d");
  if (a === 0 && b === 0) throw mutationError("preflight_failed", name + " gradient matrix angle is indeterminate.");
  var angle = transformNumber(Math.atan2(b, a) * 180 / Math.PI, name + ".angle");
  return {
    name: gradient.name, type: type, angle: angle === -180 ? 180 : angle,
    length: transformNumber(color.length, name + ".length"), matrix: [a, b, c, d]
  };
}

/** The first difference of two gradient evidences as text (read vs planned), or null. A planned lengthRange holds any read length inside it; ignoreLength skips the length. */
function transformGradientDiff(label, left, right, ignoreLength) {
  if (!left && !right) return null;
  if (!left || !right) return label + ": " + (left ? "present" : "absent") + " vs " + (right ? "present" : "absent");
  if (left.name !== right.name || left.type !== right.type) return label + ": " + left.name + "/" + left.type + " vs " + right.name + "/" + right.type;
  for (var index = 0; index < 4; index++) {
    if (Math.abs(left.matrix[index] - right.matrix[index]) > TRANSFORM_GRADIENT_MATRIX_TOLERANCE) {
      return label + ".matrix[" + index + "]: " + left.matrix[index] + " vs " + right.matrix[index];
    }
  }
  if (ignoreLength === true) return null;
  var ranged = left.lengthRange ? left : (right.lengthRange ? right : null);
  if (left.lengthRange && right.lengthRange) {
    if (Math.abs(left.lengthRange[0] - right.lengthRange[0]) > TRANSFORM_GRADIENT_LENGTH_TOLERANCE_PT ||
        Math.abs(left.lengthRange[1] - right.lengthRange[1]) > TRANSFORM_GRADIENT_LENGTH_TOLERANCE_PT) {
      return label + ".lengthRange: [" + left.lengthRange.join(",") + "] vs [" + right.lengthRange.join(",") + "]";
    }
    return null;
  }
  if (ranged === null) {
    return Math.abs(left.length - right.length) <= TRANSFORM_GRADIENT_LENGTH_TOLERANCE_PT ? null : label + ".length: " + left.length + " vs " + right.length;
  }
  var other = ranged === left ? right : left;
  if (other.length < ranged.lengthRange[0] - TRANSFORM_GRADIENT_LENGTH_TOLERANCE_PT || other.length > ranged.lengthRange[1] + TRANSFORM_GRADIENT_LENGTH_TOLERANCE_PT) {
    return label + ".length: " + other.length + " outside [" + ranged.lengthRange.join(",") + "]";
  }
  return null;
}

function transformStroke(target) {
  if (typeof target.stroked !== "boolean") {
    throw mutationError("preflight_failed", "Target stroke state is unavailable.");
  }
  return {
    enabled: target.stroked,
    width: target.stroked ? transformNumber(target.strokeWidth, "strokeWidth") : null
  };
}

function transformSnapshot(document, target) {
  var isGroup = target.typename === "GroupItem";
  var isText = target.typename === "TextFrame";
  var isImage = (target.typename === "PlacedItem" || target.typename === "RasterItem") && typeof transformImageEvidence === "function";
  if (target.typename !== "PathItem" && !isImage && !(isGroup && params.transform.type === "translate" && typeof transformGroupRows === "function") &&
      !(isText && params.transform.type === "translate" && typeof transformTextFrameEvidence === "function")) {
    throw mutationError("preflight_failed", "Transform supports PathItem targets, measured GroupItem translation and measured TextFrame translation only.");
  }
  if (isGroup && (!target.parent || target.parent.typename !== "Layer")) {
    throw mutationError("preflight_failed", "The translated group must be directly on a layer; its contents may be nested.");
  }
  if (typeof target.uuid !== "string" || target.uuid !== params.targetUuid) {
    throw mutationError("preflight_failed", "Target native UUID is unavailable or changed.");
  }
  if (typeof target.locked !== "boolean" || typeof target.hidden !== "boolean" ||
      typeof target.editable !== "boolean" || !target.layer ||
      typeof target.layer.visible !== "boolean" || typeof target.layer.locked !== "boolean") {
    throw mutationError("preflight_failed", "Target safety state is unavailable.");
  }
  var layerPath = transformLayerPath(document, target.layer);
  if (layerPath === null) throw mutationError("preflight_failed", "Target layer path is unavailable.");
  var ancestors = mutationAncestorState(target);
  var bounds = target.geometricBounds;
  var position = target.position;
  if (!bounds || bounds.length !== 4 || !position || position.length !== 2) {
    throw mutationError("preflight_failed", "Target geometry is unavailable.");
  }
  var snapshot = {
    uuid: target.uuid,
    type: target.typename,
    layerPath: layerPath,
    geometricBounds: [
      transformNumber(bounds[0], "geometricBounds[0]"), transformNumber(bounds[1], "geometricBounds[1]"),
      transformNumber(bounds[2], "geometricBounds[2]"), transformNumber(bounds[3], "geometricBounds[3]")
    ],
    position: [transformNumber(position[0], "position[0]"), transformNumber(position[1], "position[1]")],
    locked: target.locked,
    hidden: target.hidden,
    editable: target.editable,
    layerVisible: target.layer.visible,
    layerLocked: target.layer.locked,
    ancestorLocked: ancestors.ancestorLocked,
    ancestorHidden: ancestors.ancestorHidden,
    pathGeometry: params.transform.type !== "translate" && !isImage ? transformPathGeometry(target) : null,
    stroke: params.transform.type !== "translate" && !isImage ? transformStroke(target) : null
  };
  if (params.transform.type !== "translate" && target.typename === "PathItem") {
    var fillGradient = transformGradientEvidence(target.fillColor, "fill");
    var strokeGradient = transformGradientEvidence(target.strokeColor, "stroke");
    if (fillGradient !== null) snapshot.fillGradient = fillGradient;
    if (strokeGradient !== null) snapshot.strokeGradient = strokeGradient;
  }
  if ((isText || target.typename === "PathItem") && target.parent && target.parent.typename === "GroupItem" &&
      !(snapshot.locked || snapshot.hidden || !snapshot.editable || snapshot.layerLocked || !snapshot.layerVisible || snapshot.ancestorLocked || snapshot.ancestorHidden)) {
    snapshot.nestedGroup = transformNestedEvidence(document, target);
  }
  if (isImage) snapshot.image = transformImageEvidence(target);
  if (isGroup) {
    snapshot.groupRows = transformGroupRows(target, snapshot.locked || snapshot.hidden || !snapshot.layerVisible || snapshot.layerLocked ||
      snapshot.ancestorLocked || snapshot.ancestorHidden);
  }
  if (isText) snapshot.textFrame = transformTextFrameEvidence(target, !!snapshot.nestedGroup);
  return snapshot;
}

function transformPointMatches(left, right) {
  return left && right && left.length === 2 && right.length === 2 &&
    Math.abs(left[0] - right[0]) <= TRANSFORM_TOLERANCE_PT &&
    Math.abs(left[1] - right[1]) <= TRANSFORM_TOLERANCE_PT;
}

/** The first difference of two snapshots as short text ("field: read vs planned"), or null when they match. options.ignoreStrokeLength skips a stroke gradient length. */
function transformSnapshotDiff(left, right, options) {
  if (!left || !right) return "snapshot missing";
  if (!transformNestedMatches(left.nestedGroup, right.nestedGroup)) return "nested group evidence differs";
  if ((left && left.groupRows) || (right && right.groupRows)) {
    if (typeof transformGroupRowsMatch !== "function" || !transformGroupRowsMatch(left.groupRows,right.groupRows)) return "group rows differ";
  }
  if ((left && left.textFrame) || (right && right.textFrame)) {
    if (typeof transformTextFrameMatches !== "function" || !transformTextFrameMatches(left.textFrame,right.textFrame)) return "text frame evidence differs";
  }
  if ((left && left.image) || (right && right.image)) {
    if (typeof transformImageMatches !== "function" || !transformImageMatches(left.image,right.image)) return "image evidence differs";
  }
  if (left.uuid !== right.uuid || left.type !== right.type) return "identity: " + left.uuid + "/" + left.type + " vs " + right.uuid + "/" + right.type;
  if (!mutationSameSequence(left.layerPath, right.layerPath) || left.locked !== right.locked ||
      left.hidden !== right.hidden || left.editable !== right.editable ||
      left.layerVisible !== right.layerVisible || left.layerLocked !== right.layerLocked ||
      left.ancestorLocked !== right.ancestorLocked || left.ancestorHidden !== right.ancestorHidden) return "safety state differs";
  for (var boundIndex = 0; boundIndex < 4; boundIndex++) {
    if (Math.abs(left.geometricBounds[boundIndex] - right.geometricBounds[boundIndex]) > TRANSFORM_TOLERANCE_PT) {
      return "geometricBounds[" + boundIndex + "]: " + left.geometricBounds[boundIndex] + " vs " + right.geometricBounds[boundIndex];
    }
  }
  for (var positionIndex = 0; positionIndex < 2; positionIndex++) {
    if (Math.abs(left.position[positionIndex] - right.position[positionIndex]) > TRANSFORM_TOLERANCE_PT) {
      return "position[" + positionIndex + "]: " + left.position[positionIndex] + " vs " + right.position[positionIndex];
    }
  }
  if ((left.stroke === null) !== (right.stroke === null) ||
      (left.pathGeometry === null) !== (right.pathGeometry === null)) return "stroke or path geometry presence differs";
  var fillDiff = transformGradientDiff("fillGradient", left.fillGradient, right.fillGradient, false);
  if (fillDiff !== null) return fillDiff;
  var strokeDiff = transformGradientDiff("strokeGradient", left.strokeGradient, right.strokeGradient, !!(options && options.ignoreStrokeLength));
  if (strokeDiff !== null) return strokeDiff;
  if (left.stroke !== null && (left.stroke.enabled !== right.stroke.enabled ||
      (left.stroke.width === null) !== (right.stroke.width === null) ||
      (left.stroke.width !== null && Math.abs(left.stroke.width - right.stroke.width) > TRANSFORM_TOLERANCE_PT))) return "stroke: " + stringifyJson(left.stroke) + " vs " + stringifyJson(right.stroke);
  if (left.pathGeometry !== null) {
    if (left.pathGeometry.closed !== right.pathGeometry.closed ||
        left.pathGeometry.points.length !== right.pathGeometry.points.length) return "path point count or closed state differs";
    for (var pointIndex = 0; pointIndex < left.pathGeometry.points.length; pointIndex++) {
      var leftPoint = left.pathGeometry.points[pointIndex];
      var rightPoint = right.pathGeometry.points[pointIndex];
      if (!transformPointMatches(leftPoint.anchor, rightPoint.anchor) ||
          !transformPointMatches(leftPoint.leftDirection, rightPoint.leftDirection) ||
          !transformPointMatches(leftPoint.rightDirection, rightPoint.rightDirection)) {
        return "pathPoints[" + pointIndex + "]: " + stringifyJson(leftPoint.anchor) + " vs " + stringifyJson(rightPoint.anchor);
      }
    }
  }
  return null;
}

function transformSnapshotMatches(left, right, options) {
  return transformSnapshotDiff(left, right, options) === null;
}

function transformScalePoint(point, centerX, centerY, factor, name) {
  return [
    transformNumber(centerX + (point[0] - centerX) * factor, name + "[0]"),
    transformNumber(centerY + (point[1] - centerY) * factor, name + "[1]")
  ];
}

function transformRotateGradient(gradient, radians) {
  if (!gradient) return gradient;
  var cosine = Math.cos(radians);
  var sine = Math.sin(radians);
  var a = gradient.matrix[0], b = gradient.matrix[1], c = gradient.matrix[2], d = gradient.matrix[3];
  var matrix = [
    transformNumber(cosine * a - sine * b, "after.gradient.a"), transformNumber(sine * a + cosine * b, "after.gradient.b"),
    transformNumber(cosine * c - sine * d, "after.gradient.c"), transformNumber(sine * c + cosine * d, "after.gradient.d")
  ];
  var angle = Math.atan2(matrix[1], matrix[0]) * 180 / Math.PI;
  return { name: gradient.name, type: gradient.type, angle: angle === -180 ? 180 : angle, length: gradient.length, matrix: matrix };
}

/** A fill gradient's length multiplies by the factor; a stroke gradient's length is only known as the range between the old length and old length * factor. */
function transformScaleGradient(gradient, factor, stroke) {
  if (!gradient) return gradient;
  var scaled = transformNumber(gradient.length * factor, "after.gradient.length");
  var out = { name: gradient.name, type: gradient.type, angle: gradient.angle, length: stroke ? gradient.length : scaled, matrix: gradient.matrix };
  if (stroke) out.lengthRange = [Math.min(gradient.length, scaled), Math.max(gradient.length, scaled)];
  return out;
}

function transformScaleSnapshot(before, factor) {
  if (before.image && typeof transformImageScale === "function") return transformImageScale(before, factor);
  if (before.pathGeometry === null || before.stroke === null) {
    throw mutationError("preflight_failed", "Scale geometry or stroke state is unavailable.");
  }
  var width = before.geometricBounds[2] - before.geometricBounds[0];
  var height = before.geometricBounds[1] - before.geometricBounds[3];
  if (width <= TRANSFORM_TOLERANCE_PT || height <= TRANSFORM_TOLERANCE_PT) {
    throw mutationError("preflight_failed", "Scale requires non-degenerate PathItem bounds.");
  }
  var centerX = (before.geometricBounds[0] + before.geometricBounds[2]) / 2;
  var centerY = (before.geometricBounds[1] + before.geometricBounds[3]) / 2;
  var points = [];
  for (var index = 0; index < before.pathGeometry.points.length; index++) {
    var point = before.pathGeometry.points[index];
    points.push({
      anchor: transformScalePoint(point.anchor, centerX, centerY, factor, "after.anchor"),
      leftDirection: transformScalePoint(point.leftDirection, centerX, centerY, factor, "after.leftDirection"),
      rightDirection: transformScalePoint(point.rightDirection, centerX, centerY, factor, "after.rightDirection")
    });
  }
  var scaledBounds = [
    transformNumber(centerX + (before.geometricBounds[0] - centerX) * factor, "after.left"),
    transformNumber(centerY + (before.geometricBounds[1] - centerY) * factor, "after.top"),
    transformNumber(centerX + (before.geometricBounds[2] - centerX) * factor, "after.right"),
    transformNumber(centerY + (before.geometricBounds[3] - centerY) * factor, "after.bottom")
  ];
  var scaled = {
    uuid: before.uuid,
    type: before.type,
    layerPath: before.layerPath,
    geometricBounds: scaledBounds,
    position: [scaledBounds[0], scaledBounds[1]],
    locked: before.locked,
    hidden: before.hidden,
    editable: before.editable,
    layerVisible: before.layerVisible,
    layerLocked: before.layerLocked,
    ancestorLocked: before.ancestorLocked,
    ancestorHidden: before.ancestorHidden,
    pathGeometry: { closed: before.pathGeometry.closed, points: points },
    stroke: before.stroke
  };
  if (before.fillGradient) scaled.fillGradient = transformScaleGradient(before.fillGradient, factor, false);
  if (before.strokeGradient) scaled.strokeGradient = transformScaleGradient(before.strokeGradient, factor, true);
  return scaled;
}

function transformStraightPathBounds(pathGeometry) {
  if (pathGeometry === null || !pathGeometry.closed || pathGeometry.points.length < 3) {
    throw mutationError("preflight_failed", "Rotation requires a closed PathItem with at least 3 path points.");
  }
  var first = pathGeometry.points[0].anchor;
  var left = first[0], top = first[1], right = first[0], bottom = first[1];
  for (var index = 0; index < pathGeometry.points.length; index++) {
    var point = pathGeometry.points[index];
    if (!transformPointMatches(point.anchor, point.leftDirection) ||
        !transformPointMatches(point.anchor, point.rightDirection)) {
      throw mutationError("preflight_failed", "Rotation supports straight path segments only; curve handles are unsupported.");
    }
    left = Math.min(left, point.anchor[0]);
    top = Math.max(top, point.anchor[1]);
    right = Math.max(right, point.anchor[0]);
    bottom = Math.min(bottom, point.anchor[1]);
  }
  return [transformNumber(left, "rotation.left"), transformNumber(top, "rotation.top"),
    transformNumber(right, "rotation.right"), transformNumber(bottom, "rotation.bottom")];
}

function transformRotateSnapshot(before, angleDegrees) {
  if (before.image && typeof transformImageRotate === "function") return transformImageRotate(before, angleDegrees);
  if (before.pathGeometry === null || before.stroke === null) {
    throw mutationError("preflight_failed", "Rotation geometry or stroke state is unavailable.");
  }
  var sourceBounds = transformStraightPathBounds(before.pathGeometry);
  for (var boundIndex = 0; boundIndex < 4; boundIndex++) {
    if (Math.abs(sourceBounds[boundIndex] - before.geometricBounds[boundIndex]) > TRANSFORM_TOLERANCE_PT) {
      throw mutationError("preflight_failed", "Rotation requires bounds derived from the complete straight path geometry.");
    }
  }
  var centerX = (before.geometricBounds[0] + before.geometricBounds[2]) / 2;
  var centerY = (before.geometricBounds[1] + before.geometricBounds[3]) / 2;
  var radians = angleDegrees * Math.PI / 180;
  var cosine = Math.cos(radians);
  var sine = Math.sin(radians);
  function rotatePoint(point, name) {
    var dx = point[0] - centerX;
    var dy = point[1] - centerY;
    return [transformNumber(centerX + dx * cosine - dy * sine, name + "[0]"),
      transformNumber(centerY + dx * sine + dy * cosine, name + "[1]")];
  }
  var points = [];
  for (var index = 0; index < before.pathGeometry.points.length; index++) {
    var point = before.pathGeometry.points[index];
    points.push({
      anchor: rotatePoint(point.anchor, "rotation.anchor"),
      leftDirection: rotatePoint(point.leftDirection, "rotation.leftDirection"),
      rightDirection: rotatePoint(point.rightDirection, "rotation.rightDirection")
    });
  }
  var pathGeometry = { closed: true, points: points };
  var geometricBounds = transformStraightPathBounds(pathGeometry);
  var rotated = {
    uuid: before.uuid,
    type: before.type,
    layerPath: before.layerPath,
    geometricBounds: geometricBounds,
    position: [geometricBounds[0], geometricBounds[1]],
    locked: before.locked,
    hidden: before.hidden,
    editable: before.editable,
    layerVisible: before.layerVisible,
    layerLocked: before.layerLocked,
    ancestorLocked: before.ancestorLocked,
    ancestorHidden: before.ancestorHidden,
    pathGeometry: pathGeometry,
    stroke: before.stroke
  };
  if (before.fillGradient) rotated.fillGradient = transformRotateGradient(before.fillGradient, radians);
  if (before.strokeGradient) rotated.strokeGradient = transformRotateGradient(before.strokeGradient, radians);
  return rotated;
}

function transformTranslateSnapshot(before, deltaX, deltaY) {
  var pathGeometry = before.pathGeometry;
  function translatePoint(value, name) {
    return [transformNumber(value[0] + deltaX, name + "[0]"),
      transformNumber(value[1] + deltaY, name + "[1]")];
  }
  if (pathGeometry !== null) {
    var points = [];
    for (var index = 0; index < pathGeometry.points.length; index++) {
      var point = pathGeometry.points[index];
      points.push({
        anchor: translatePoint(point.anchor, "translation.anchor"),
        leftDirection: translatePoint(point.leftDirection, "translation.leftDirection"),
        rightDirection: translatePoint(point.rightDirection, "translation.rightDirection")
      });
    }
    pathGeometry = { closed: pathGeometry.closed, points: points };
  }
  var snapshot = {
    uuid: before.uuid,
    type: before.type,
    layerPath: before.layerPath,
    geometricBounds: [
      transformNumber(before.geometricBounds[0] + deltaX, "translation.left"),
      transformNumber(before.geometricBounds[1] + deltaY, "translation.top"),
      transformNumber(before.geometricBounds[2] + deltaX, "translation.right"),
      transformNumber(before.geometricBounds[3] + deltaY, "translation.bottom")
    ],
    position: [transformNumber(before.position[0] + deltaX, "translation.position[0]"),
      transformNumber(before.position[1] + deltaY, "translation.position[1]")],
    locked: before.locked,
    hidden: before.hidden,
    editable: before.editable,
    layerVisible: before.layerVisible,
    layerLocked: before.layerLocked,
    ancestorLocked: before.ancestorLocked,
    ancestorHidden: before.ancestorHidden,
    pathGeometry: pathGeometry,
    stroke: before.stroke
  };
  if (before.groupRows) snapshot.groupRows = transformTranslateGroupRows(before.groupRows,deltaX,deltaY);
  if (before.textFrame) snapshot.textFrame = transformTranslateTextFrame(before.textFrame,deltaX,deltaY);
  if (before.nestedGroup) snapshot.nestedGroup = transformNestedTranslate(before.nestedGroup,before.uuid,deltaX,deltaY);
  if (before.image) snapshot.image = before.image;
  if (before.fillGradient) snapshot.fillGradient = before.fillGradient;
  if (before.strokeGradient) snapshot.strokeGradient = before.strokeGradient;
  return snapshot;
}

function transformAfter(before) {
  if (params.transform.type === "scale") {
    var scalePercent = params.transform.scalePercent;
    if (typeof scalePercent !== "number" || !isFinite(scalePercent) || Math.floor(scalePercent) !== scalePercent ||
        scalePercent < TRANSFORM_SCALE_MIN_PERCENT || scalePercent > TRANSFORM_SCALE_MAX_PERCENT ||
        scalePercent === 100 || params.transform.anchor !== "center") {
      throw mutationError("preflight_failed", "Scale requires an integer 10-1000 percent, excluding 100, about center.");
    }
    return transformScaleSnapshot(before, scalePercent / 100);
  }
  if (params.transform.type === "rotate") {
    var angleDegrees = params.transform.angleDegrees;
    if (typeof angleDegrees !== "number" || !isFinite(angleDegrees) || Math.floor(angleDegrees) !== angleDegrees ||
        angleDegrees < TRANSFORM_ROTATE_MIN_DEGREES || angleDegrees > TRANSFORM_ROTATE_MAX_DEGREES ||
        angleDegrees === 0 || params.transform.anchor !== "center") {
      throw mutationError("preflight_failed", "Rotation requires an integer -180 to 180 degrees, excluding 0, about center.");
    }
    return transformRotateSnapshot(before, angleDegrees);
  }
  var deltaX = transformNumber(params.transform.deltaX, "transform.deltaX");
  var deltaY = transformNumber(params.transform.deltaY, "transform.deltaY");
  if (params.transform.type !== "translate" || (deltaX === 0 && deltaY === 0)) {
    throw mutationError("preflight_failed", "Only a non-zero translate transform is supported.");
  }
  return transformTranslateSnapshot(before, deltaX, deltaY);
}

function transformResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  var target = transformFindTarget(document, params.targetUuid);
  if (target === null) throw new Error("MCP_ERROR:" + stringifyJson({ code: "OBJECT_NOT_FOUND", uuid: params.targetUuid }));
  var before = transformSnapshot(document, target);
  var blockers = [];
  if (!context.mutationAllowed) blockers.push("document_mutation_not_allowed");
  if (before.locked) blockers.push("target_locked");
  if (before.hidden) blockers.push("target_hidden");
  if (!before.editable) blockers.push("target_not_editable");
  if (!before.layerVisible) blockers.push("layer_hidden");
  if (before.layerLocked) blockers.push("layer_locked");
  if (before.ancestorHidden) blockers.push("ancestor_hidden");
  if (before.ancestorLocked) blockers.push("ancestor_locked");
  if (forApply && blockers.length > 0) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "TRANSFORM_APPLY_BLOCKED", reasonCodes: blockers, uuid: params.targetUuid }));
  }
  return { context: context, document: document, target: target, before: before, after: transformAfter(before), blockers: blockers };
}

function transformPreflight(forApply) {
  var resolved = transformResolve(forApply);
  if (forApply) {
    if (!transformSnapshotMatches(resolved.before, params.expectedBefore)) {
      throw mutationError("preflight_failed", "Target state does not match expected_before.");
    }
    if (!transformSnapshotMatches(resolved.after, params.confirmedAfter)) {
      throw mutationError("preflight_failed", "confirmed_after does not match the planned transform state.");
    }
  }
  return resolved;
}

function transformPlan(preflight) {
  return {
    operation: "transform_object",
    documentKey: preflight.context.key,
    transform: params.transform,
    before: preflight.before,
    after: preflight.after,
    applyBlockedReasonCodes: preflight.blockers,
    confirmationStatus: params.apply === true ? "confirmed" : "required",
    applyAllowed: params.apply === true && preflight.blockers.length === 0
  };
}

function transformRevalidate(preflight, plan) {
  var current;
  try { current = transformResolve(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Transform preconditions changed before apply.")); }
  if (current.document !== preflight.document || !transformSameTarget(current.target, preflight.target, preflight.before) ||
      !transformSnapshotMatches(current.before, plan.before) || !transformSnapshotMatches(current.after, plan.after)) {
    throw mutationBeforeSideEffectError("Transform target or geometry changed before apply.");
  }
}

function transformApply(preflight, plan, state) {
  state.operationState.mutationStarted = true;
  if (plan.transform.type === "scale") {
    preflight.target.resize(
      plan.transform.scalePercent, plan.transform.scalePercent,
      true, false, true, false, 100, Transformation.CENTER
    );
  } else if (plan.transform.type === "rotate") {
    preflight.target.rotate(
      plan.transform.angleDegrees,
      true, false, true, false, Transformation.CENTER
    );
  } else {
    preflight.target.translate(
      plan.transform.deltaX, plan.transform.deltaY,
      true, false, false, false
    );
  }
  return preflight.target;
}

function transformVerify(preflight, plan) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) {
    throw mutationError("verify_mismatch", "Active document changed during transform verification.");
  }
  var target = transformFindTarget(preflight.document, plan.before.uuid);
  if (target === null || !transformSameTarget(target, preflight.target, preflight.before)) {
    throw mutationError("verify_mismatch", "Target native UUID no longer resolves to the same PageItem.");
  }
  var actual = transformSnapshot(preflight.document, target);
  var difference = transformSnapshotDiff(actual, plan.after);
  if (difference !== null) {
    throw mutationError("verify_mismatch", "Transform postcondition does not match the plan (read vs planned): " + difference.substring(0, 300));
  }
  return actual;
}

function transformRollback(state) {
  var preflight = state.preflight;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) {
    return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
  }
  var target;
  var current;
  try {
    target = transformFindTarget(preflight.document, params.targetUuid);
    if (target === null || !transformSameTarget(target, preflight.target, preflight.before)) {
      return { status: "indeterminate", message: "Rollback target identity is indeterminate." };
    }
    current = transformSnapshot(preflight.document, target);
  } catch (error) {
    return { status: "indeterminate", message: "Rollback target state is indeterminate." };
  }
  var beforeWidth = preflight.before.geometricBounds[2] - preflight.before.geometricBounds[0];
  var beforeHeight = preflight.before.geometricBounds[1] - preflight.before.geometricBounds[3];
  var currentWidth = current.geometricBounds[2] - current.geometricBounds[0];
  var currentHeight = current.geometricBounds[1] - current.geometricBounds[3];
  if (!mutationSameSequence(current.layerPath, preflight.before.layerPath) ||
      current.type !== preflight.before.type || current.locked || current.hidden || !current.editable ||
      !current.layerVisible || current.layerLocked || current.ancestorLocked || current.ancestorHidden ||
      (current.stroke === null) !== (preflight.before.stroke === null) ||
      (current.stroke !== null && (current.stroke.enabled !== preflight.before.stroke.enabled ||
        (current.stroke.width === null) !== (preflight.before.stroke.width === null) ||
        (current.stroke.width !== null && Math.abs(current.stroke.width - preflight.before.stroke.width) > TRANSFORM_TOLERANCE_PT)))) {
    return { status: "indeterminate", message: "Rollback refused because target geometry or safety state changed." };
  }
  try {
    if (params.transform.type === "scale") {
      if (beforeWidth <= TRANSFORM_TOLERANCE_PT || beforeHeight <= TRANSFORM_TOLERANCE_PT ||
          currentWidth <= TRANSFORM_TOLERANCE_PT || currentHeight <= TRANSFORM_TOLERANCE_PT) {
        return { status: "indeterminate", message: "Rollback scale bounds are degenerate." };
      }
      var beforeCenterX = (preflight.before.geometricBounds[0] + preflight.before.geometricBounds[2]) / 2;
      var beforeCenterY = (preflight.before.geometricBounds[1] + preflight.before.geometricBounds[3]) / 2;
      var currentCenterX = (current.geometricBounds[0] + current.geometricBounds[2]) / 2;
      var currentCenterY = (current.geometricBounds[1] + current.geometricBounds[3]) / 2;
      var observedFactor = currentWidth / beforeWidth;
      if (Math.abs(beforeCenterX - currentCenterX) > TRANSFORM_TOLERANCE_PT ||
          Math.abs(beforeCenterY - currentCenterY) > TRANSFORM_TOLERANCE_PT ||
          Math.abs(beforeHeight * observedFactor - currentHeight) > TRANSFORM_TOLERANCE_PT ||
          !transformSnapshotMatches(current, transformScaleSnapshot(preflight.before, observedFactor), { ignoreStrokeLength: true })) {
        return { status: "indeterminate", message: "Rollback refused because scale is not a uniform center transform." };
      }
      var inversePercent = 100 / observedFactor;
      target.resize(inversePercent, inversePercent, true, false, true, false, 100, Transformation.CENTER);
    } else if (params.transform.type === "rotate") {
      if (!transformSnapshotMatches(current, preflight.after)) {
        return { status: "indeterminate", message: "Rollback refused because rotation does not match the complete planned transform." };
      }
      target.rotate(-params.transform.angleDegrees, true, false, true, false, Transformation.CENTER);
      var inverseOnly = transformSnapshot(preflight.document, target);
      var observedDeltaX = inverseOnly.position[0] - preflight.before.position[0];
      var observedDeltaY = inverseOnly.position[1] - preflight.before.position[1];
      if (!transformSnapshotMatches(inverseOnly,
          transformTranslateSnapshot(preflight.before, observedDeltaX, observedDeltaY))) {
        return { status: "indeterminate", message: "Rollback inverse rotation is not a uniform translation of the before state." };
      }
      target.translate(-observedDeltaX, -observedDeltaY, true, false, false, false);
    } else {
      if (Math.abs(beforeWidth - currentWidth) > TRANSFORM_TOLERANCE_PT ||
          Math.abs(beforeHeight - currentHeight) > TRANSFORM_TOLERANCE_PT) {
        return { status: "indeterminate", message: "Rollback refused because translated target size changed." };
      }
      if ((current.groupRows || current.textFrame || current.nestedGroup) && !transformSnapshotMatches(current, transformTranslateSnapshot(preflight.before,
          current.position[0] - preflight.before.position[0], current.position[1] - preflight.before.position[1]))) {
        return { status: "indeterminate", message: "Rollback refused because the target is not a uniform translation of the before state." };
      }
      target.translate(
        preflight.before.position[0] - current.position[0],
        preflight.before.position[1] - current.position[1],
        true, false, false, false
      );
    }
  } catch (error) {
    return { status: "indeterminate", message: "Rollback transform outcome is indeterminate." };
  }
  var restored;
  try { restored = transformSnapshot(preflight.document, target); }
  catch (error) { return { status: "indeterminate", message: "Rollback verification is indeterminate." }; }
  state.operationState.rollbackEvidence.restoredSnapshot = restored;
  return transformSnapshotMatches(restored, preflight.before)
    ? { status: "verified" }
    : { status: "failed", message: "Rollback did not restore the exact before transform state." };
}

`;
const batchTransformUuidSchema = z.string().min(1).max(255);
const batchPublicTransformPlan = z.strictObject({
    operation: z.literal(TRANSFORM_OBJECT_OPERATION), target_uuid: batchTransformUuidSchema,
    transform: z.strictObject({ type: z.literal('translate'), delta_x: z.number().finite(), delta_y: z.number().finite() }),
});
const batchInternalTransformPlan = z.strictObject({
    targetUuid: batchTransformUuidSchema, operation: z.literal(TRANSFORM_OBJECT_OPERATION), transform: translateTransformSchema,
});
export function transformBatchBlockers(mutationAllowed, before) {
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
    if (before.ancestorHidden)
        blockers.push('ancestor_hidden');
    if (before.ancestorLocked)
        blockers.push('ancestor_locked');
    return blockers;
}
export const transformObjectBatchStep = defineBatchStep({
    operation: TRANSFORM_OBJECT_OPERATION,
    admittedProfile: 'mixed_batch_translate_path_or_text',
    recipeAllowed: true,
    publicPlan: batchPublicTransformPlan,
    publicApply: z.strictObject({ ...batchPublicTransformPlan.shape,
        expected_before: transformPathOrTextSnapshotSchema, confirmed_after: transformPathOrTextSnapshotSchema }),
    internalPlan: batchInternalTransformPlan,
    internalApply: z.strictObject({ ...batchInternalTransformPlan.shape,
        expectedBefore: transformPathOrTextSnapshotSchema, confirmedAfter: transformPathOrTextSnapshotSchema }),
    planSchema: transformObjectPlanSchema,
    snapshotSchema: transformPathOrTextSnapshotSchema,
    normalize: (step) => ({ operation: TRANSFORM_OBJECT_OPERATION, targetUuid: step.target_uuid,
        transform: { type: 'translate', deltaX: step.transform.delta_x, deltaY: step.transform.delta_y },
        ...('expected_before' in step ? { expectedBefore: step.expected_before, confirmedAfter: step.confirmed_after } : {}) }),
    request: (plan) => ({ transform: plan.transform }),
    same: (left, right) => {
        const parsedLeft = transformPathOrTextSnapshotSchema.safeParse(left);
        const parsedRight = transformPathOrTextSnapshotSchema.safeParse(right);
        return parsedLeft.success && parsedRight.success && snapshotsWithinTolerance(parsedLeft.data, parsedRight.data);
    },
    planBlockers: (mutationAllowed, plan) => transformBatchBlockers(mutationAllowed, plan.before),
    nextCall: TRANSFORM_OBJECT_BATCH_NEXT_CALL,
    host: {
        fragments: [
            { id: 'transform-object.module', source: TRANSFORM_OBJECT_MODULE_SCRIPT },
            { id: 'transform.text', source: TRANSFORM_TEXT_SCRIPT },
            { id: 'transform.group', source: TRANSFORM_GROUP_SCRIPT },
        ],
        hooks: {
            resolve: 'function () { return transformResolve(false); }',
            plan: 'transformPlan', same: 'transformSnapshotMatches', apply: 'transformApply', verify: 'transformVerify', rollback: 'transformRollback',
        },
        paramFields: ['transform'],
    },
});
export const TRANSFORM_OBJECT_RUNNER_SCRIPT = `function transformSingleDefinition() {
  return {
  apply: params.apply === true,
  // the items this change reads and writes, so an edit session can advance its item aggregate.
  editSessionAffected: function (phase, preflight) {
    var ids=[params.targetUuid];if(preflight && preflight.before.nestedGroup)ids.push(transformNestedRows(preflight.before.nestedGroup)[0].uuid);return ids;
  },
  initialOperationState: function () {
    return { mutationStarted: false, rollbackEvidence: { targetUuid: params.targetUuid, restoredSnapshot: null } };
  },
  preflight: transformPreflight,
  plan: transformPlan,
  revalidate: transformRevalidate,
  applyMutation: transformApply,
  verify: transformVerify,
  rollback: transformRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () {
    return {
      reasonCode: "transform_state_unknown",
      message: "Transform apply outcome is indeterminate.",
      evidence: { targetUuid: params.targetUuid, restoredSnapshot: null }
    };
  },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
};
}
`;
export const TRANSFORM_OBJECT_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${TRANSFORM_OBJECT_MODULE_SCRIPT}${TRANSFORM_GROUP_SCRIPT}${TRANSFORM_TEXT_SCRIPT}${TRANSFORM_IMAGE_SCRIPT}${SNAPSHOT_RESULT_SIZE_SCRIPT}
${TRANSFORM_MULTI_MODULE_SCRIPT}${TRANSFORM_OBJECT_RUNNER_SCRIPT}${TRANSFORM_MULTI_RUNNER_SCRIPT}
var transformExecution = runMutationTransaction(params.targets === undefined ? transformSingleDefinition() : tmDefinition());

var transformDocument = transformExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === transformExecution.preflight.document) {
  transformDocument = getDocumentContext();
}
var result = {
  operation: "transform_object",
  applied: transformExecution.transaction.state === "verified",
  document: transformDocument,
  plan: transformExecution.plan,
  transaction: transformExecution.transaction
};
if (transformExecution.transaction.state === "verified") result.postcondition = transformExecution.value;
`;
export const TRANSFORM_OBJECT_HOST_SCRIPT_DIGEST = canonicalSha256(TRANSFORM_OBJECT_SCRIPT);
export const TRANSFORM_OBJECT_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2,
    contractVersion: 1,
    operation: TRANSFORM_OBJECT_OPERATION,
    validator: TRANSFORM_OBJECT_VALIDATOR,
    canonicalContractVersion: TRANSFORM_OBJECT_CANONICAL_VERSION + 1,
    resultSchemaVersion: TRANSFORM_OBJECT_RESULT_SCHEMA_VERSION + 1,
    terminalClassifierVersion: TRANSFORM_OBJECT_CLASSIFIER_VERSION,
    safetyConformanceVersion: TRANSFORM_OBJECT_CONFORMANCE_VERSION + 1,
    errorMappingVersion: TRANSFORM_OBJECT_ERROR_MAPPING_VERSION,
    safetyIdentity: TRANSFORM_OBJECT_SAFETY_IDENTITY,
    hostScriptDigest: TRANSFORM_OBJECT_HOST_SCRIPT_DIGEST,
});
function normalizedRequest(input) {
    const request = transformObjectInternalInputSchema.parse(input);
    const digestRequest = 'commandId' in request
        ? (({ commandId: _commandId, ...rest }) => rest)(request)
        : request;
    const digest = canonicalSha256({
        operation: TRANSFORM_OBJECT_OPERATION,
        validator: TRANSFORM_OBJECT_VALIDATOR,
        request: digestRequest,
    });
    return {
        intent: request.apply ? 'apply' : 'plan',
        request,
        commandId: 'commandId' in request ? request.commandId : null,
        documentKey: request.expectedDocumentKey,
        digest,
    };
}
export const transformObjectToolContract = {
    name: 'illustrator_transform_object',
    title: 'Plan or Transform Object',
    description: 'Plan or apply a translation, scale or rotation of one object (target_uuid) or of 1-16 objects together (targets: paths, nested or clipped groups, linked or embedded images, horizontal point text) about the selection centre or each object\'s own centre, bound by document key and native UUIDs. Scale and rotation also transform a path\'s gradient fill and stroke (patterns stay). Apply checks the planned geometry and gradient on native read-back and restores a failed apply; a refusal names its reason and next steps.',
    inputSchema: transformObjectInputSchema,
    publicInputSchema: transformObjectAnyPublicInputSchema,
    outputSchema: transformObjectResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(TRANSFORM_OBJECT_SAFETY.policy),
    normalizePublicInput,
};
export function createTransformObjectAdapter() {
    return {
        version: 1,
        operation: TRANSFORM_OBJECT_OPERATION,
        validator: TRANSFORM_OBJECT_VALIDATOR,
        safety: TRANSFORM_OBJECT_SAFETY,
        safetyRegistrationIdentity: TRANSFORM_OBJECT_SAFETY_IDENTITY,
        adapterIdentity: TRANSFORM_OBJECT_ADAPTER_IDENTITY,
        tool: transformObjectToolContract,
        canonical: {
            version: TRANSFORM_OBJECT_CANONICAL_VERSION + 1,
            normalize: normalizedRequest,
            safetyDigest: (input) => normalizedRequest(input).digest,
        },
        resultSchema: transformObjectAnyResultSchema,
        resultSchemaVersion: TRANSFORM_OBJECT_RESULT_SCHEMA_VERSION + 1,
        terminalClassifierVersion: TRANSFORM_OBJECT_CLASSIFIER_VERSION,
        safetyConformanceVersion: TRANSFORM_OBJECT_CONFORMANCE_VERSION + 1,
        errorMappingVersion: TRANSFORM_OBJECT_ERROR_MAPPING_VERSION,
        hostScriptDigest: TRANSFORM_OBJECT_HOST_SCRIPT_DIGEST,
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan') {
                return { kind: 'read', script: TRANSFORM_OBJECT_SCRIPT, params };
            }
            return {
                kind: 'mutation',
                mutationValidator: TRANSFORM_OBJECT_VALIDATOR,
                idempotency: {
                    commandId: normalized.commandId,
                    operation: TRANSFORM_OBJECT_OPERATION,
                    documentKey: normalized.documentKey,
                    requestDigest: normalized.digest,
                },
                adapterIdentity: TRANSFORM_OBJECT_ADAPTER_IDENTITY,
                script: TRANSFORM_OBJECT_SCRIPT,
                params,
            };
        },
        classifyTerminal(value) {
            const state = transformObjectAnyResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back')
                return { state };
            if (state === 'planned')
                throw new Error('Transform plan is not a terminal mutation result.');
            throw new Error('Unverified transform recovery must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertTransformSafetyConformance,
        mapExecutionError(error, detail) {
            if (detail?.code === 'OBJECT_NOT_FOUND') {
                return new Error(`No PageItem with UUID ${JSON.stringify(detail.uuid ?? '')} exists in the bound document.`);
            }
            if (detail?.code === 'TRANSFORM_TARGET_REFUSED')
                return new GuidedRefusalError(detail.reason ?? 'unsupported_target_type', detail.message ?? 'A target cannot be transformed.');
            if (detail?.code === 'TRANSFORM_APPLY_BLOCKED') {
                const uuids = detail.uuids ?? [];
                return new Error(`Transform apply is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}${uuids.length > 0 ? ` (targets ${uuids.map((uuid) => JSON.stringify(uuid)).join(', ')})` : ''}.`);
            }
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
