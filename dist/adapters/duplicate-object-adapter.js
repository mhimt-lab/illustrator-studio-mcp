import { z } from 'zod';
import { hostVersionBackupPublicFields, hostVersionInternalFields } from '../host-version-consent.js';
import { DUPLICATE_TEXT_HOST_SCRIPT, duplicateTextWireSnapshotSchema } from './duplicate-text-host-script.js';
import { DUPLICATE_IMAGE_HOST_SCRIPT, duplicateImageWireSnapshotSchema, } from './duplicate-image-host-script.js';
import { POINT_TEXT_SNAPSHOT_SCRIPT } from './point-text-host-script.js';
import { supportedPathCmykPaintSchema } from './supported-path-item-host-script.js';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { OsascriptHostProfileProbe } from '../host-profile.js';
import { boundsSchema, documentContextSchema, layerPathSchema, mutationAuditSchema, } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
export const DUPLICATE_OBJECT_OPERATION = 'duplicate_object';
export const DUPLICATE_OBJECT_VALIDATOR = { kind: DUPLICATE_OBJECT_OPERATION, version: 1 };
export const DUPLICATE_MAX_PATH_POINTS = 256;
export const DUPLICATE_MAX_PARENT_ITEMS = 128;
export const DUPLICATE_NESTED_MAX_DEPTH = 3;
export const DUPLICATE_NESTED_MAX_PARENT_ITEMS = 8;
export const DUPLICATE_COLOUR_MAX_SPOTS = 8;
export const DUPLICATE_NESTED_CONTEXT_MAX_CHARS = 65_536;
const DUPLICATE_CANONICAL_VERSION = 1;
const DUPLICATE_RESULT_SCHEMA_VERSION = 1;
const DUPLICATE_CLASSIFIER_VERSION = 1;
const DUPLICATE_CONFORMANCE_VERSION = 1;
const DUPLICATE_ERROR_MAPPING_VERSION = 1;
const canonicalNumberSchema = z.number().finite().overwrite((value) => Object.is(value, -0) ? 0 : value);
const pointSchema = z.tuple([canonicalNumberSchema, canonicalNumberSchema]);
const rgbSchema = z.strictObject({
    type: z.literal('RGBColor'),
    red: canonicalNumberSchema,
    green: canonicalNumberSchema,
    blue: canonicalNumberSchema,
});
const colourWireSchema = z.string().superRefine((json, context) => {
    try {
        if (json.length < 2 || json.length > 32_768)
            throw new Error('size');
        const value = JSON.parse(json);
        if (value && typeof value === 'object' && !Array.isArray(value))
            return;
    }
    catch { }
    context.addIssue({ code: 'custom', message: 'Colour wire must be a JSON object.' });
});
const spotWireSchema = z.strictObject({ type: z.literal('SpotColor'), colourState: colourWireSchema });
const duplicatePaintSchema = z.union([rgbSchema, supportedPathCmykPaintSchema, spotWireSchema]);
const pathPointSchema = z.strictObject({
    anchor: pointSchema,
    leftDirection: pointSchema,
    rightDirection: pointSchema,
    pointType: z.enum(['PointType.CORNER', 'PointType.SMOOTH']),
});
const parentOrderSchema = z.array(z.string().min(1).max(255)).min(1).max(DUPLICATE_MAX_PARENT_ITEMS)
    .superRefine((order, context) => {
    if (new Set(order).size !== order.length) {
        context.addIssue({ code: 'custom', message: 'Parent order must contain unique native UUIDs.' });
    }
});
export const duplicateObjectSnapshotShape = {
    uuid: z.string().min(1).max(255),
    type: z.literal('PathItem'),
    name: z.string().max(255),
    layerPath: layerPathSchema,
    geometricBounds: boundsSchema,
    controlBounds: boundsSchema,
    visibleBounds: boundsSchema,
    position: pointSchema,
    width: canonicalNumberSchema.nonnegative(),
    height: canonicalNumberSchema.nonnegative(),
    closed: z.boolean(),
    pathPoints: z.array(pathPointSchema).min(1).max(DUPLICATE_MAX_PATH_POINTS),
    filled: z.boolean(),
    fillColor: rgbSchema.nullable(),
    fillOverprint: z.boolean(),
    stroked: z.boolean(),
    strokeColor: rgbSchema.nullable(),
    strokeWidth: canonicalNumberSchema.nonnegative().nullable(),
    strokeOverprint: z.boolean(),
    strokeDashes: z.array(canonicalNumberSchema.nonnegative()).max(32),
    strokeDashOffset: canonicalNumberSchema,
    strokeCap: z.enum(['StrokeCap.BUTTENDCAP', 'StrokeCap.ROUNDENDCAP', 'StrokeCap.PROJECTINGENDCAP']),
    strokeJoin: z.enum(['StrokeJoin.BEVELENDJOIN', 'StrokeJoin.ROUNDENDJOIN', 'StrokeJoin.MITERENDJOIN']),
    strokeMiterLimit: canonicalNumberSchema.nonnegative(),
    evenodd: z.boolean(),
    polarity: z.literal('PolarityValues.POSITIVE'),
    resolution: canonicalNumberSchema.positive(),
    artworkKnockout: z.literal('KnockoutState.DISABLED'),
    blendingMode: z.literal('BlendModes.NORMAL'),
    opacity: canonicalNumberSchema.min(0).max(100),
    pixelAligned: z.boolean(),
    noteEmpty: z.literal(true),
    tagsEmpty: z.literal(true),
    urlEmpty: z.literal(true),
    visibilityVariableAbsent: z.literal(true),
    wrapped: z.literal(false),
    clipping: z.literal(false),
    guides: z.literal(false),
    sliced: z.literal(false),
    isolated: z.literal(false),
    locked: z.boolean(),
    hidden: z.boolean(),
    editable: z.boolean(),
    layerVisible: z.boolean(),
    layerLocked: z.boolean(),
    effectiveLayerVisible: z.boolean(),
    effectiveLayerLocked: z.boolean(),
};
export function refineDuplicateObjectSnapshot(snapshot, context) {
    if (snapshot.filled !== (snapshot.fillColor !== null)) {
        context.addIssue({ code: 'custom', message: 'fillColor must be present exactly when filled is true.' });
    }
    if (snapshot.stroked !== (snapshot.strokeColor !== null && snapshot.strokeWidth !== null)) {
        context.addIssue({ code: 'custom', message: 'Stroke color and width must be present exactly when stroked is true.' });
    }
    if (snapshot.effectiveLayerVisible && !snapshot.layerVisible) {
        context.addIssue({ code: 'custom', message: 'An effectively visible layer must itself be visible.' });
    }
    if (snapshot.layerLocked && !snapshot.effectiveLayerLocked) {
        context.addIssue({ code: 'custom', message: 'A locked layer must be effectively locked.' });
    }
}
export const duplicateObjectSnapshotSchema = z.strictObject({
    ...duplicateObjectSnapshotShape,
    fillColor: z.union([rgbSchema, supportedPathCmykPaintSchema]).nullable(),
    strokeColor: z.union([rgbSchema, supportedPathCmykPaintSchema]).nullable(),
})
    .superRefine(refineDuplicateObjectSnapshot);
const nestedGroupSchema = z.strictObject({
    uuid: z.string().min(1).max(255),
    name: z.string().max(255),
    geometricBounds: boundsSchema,
    visibleBounds: boundsSchema,
    order: parentOrderSchema,
    locked: z.literal(false), hidden: z.literal(false), editable: z.literal(true),
    clipped: z.literal(false), opacity: z.literal(100), blendingMode: z.literal('BlendModes.NORMAL'),
});
const { controlBounds: _siblingDiagnostic, ...siblingSnapshotShape } = duplicateObjectSnapshotShape;
const nestedSiblingSchema = z.strictObject({
    ...siblingSnapshotShape,
    fillColor: z.union([rgbSchema, supportedPathCmykPaintSchema]).nullable(),
    strokeColor: z.union([rgbSchema, supportedPathCmykPaintSchema]).nullable(),
}).superRefine(refineDuplicateObjectSnapshot);
const nestedContextSchema = z.strictObject({
    ancestors: z.array(nestedGroupSchema).min(1).max(DUPLICATE_NESTED_MAX_DEPTH),
    siblings: z.array(nestedSiblingSchema).min(1).max(DUPLICATE_NESTED_MAX_PARENT_ITEMS - 1),
    layerOrder: parentOrderSchema,
});
const NESTED_CONTEXT_CACHE_LIMIT = 16;
const parsedNestedContexts = new Map();
function parseNestedContext(json) {
    const cached = parsedNestedContexts.get(json);
    if (cached !== undefined)
        return cached;
    const parsed = nestedContextSchema.parse(JSON.parse(json));
    if (parsedNestedContexts.size >= NESTED_CONTEXT_CACHE_LIMIT)
        parsedNestedContexts.delete(parsedNestedContexts.keys().next().value);
    parsedNestedContexts.set(json, parsed);
    return parsed;
}
const nestedContextJsonSchema = z.string().min(2).max(DUPLICATE_NESTED_CONTEXT_MAX_CHARS).superRefine((json, context) => {
    try {
        parseNestedContext(json);
        return;
    }
    catch (error) {
        if (error instanceof SyntaxError) {
            context.addIssue({ code: 'custom', message: 'Nested context JSON is invalid.', continue: false });
            return;
        }
    }
    context.addIssue({ code: 'custom', message: 'Nested context JSON must contain the complete bound snapshot.', continue: false });
});
const duplicatePathSourceSnapshotSchema = z.strictObject({
    ...duplicateObjectSnapshotShape,
    fillColor: duplicatePaintSchema.nullable(),
    strokeColor: duplicatePaintSchema.nullable(),
    colourContext: colourWireSchema.optional(),
    nestedContext: nestedContextJsonSchema.optional(),
}).superRefine(refineDuplicateObjectSnapshot);
const colourSceneSchema = z.strictObject({
    profile: z.enum(['NESTED_CMYK', 'LAYER_SPOT']),
    groups: z.array(nestedGroupSchema).max(2),
    paths: z.array(z.strictObject({ parent: z.string().min(1), snapshot: z.strictObject({ ...siblingSnapshotShape, fillColor: duplicatePaintSchema.nullable(), strokeColor: duplicatePaintSchema.nullable() }).superRefine(refineDuplicateObjectSnapshot), paint: colourWireSchema, raw: colourWireSchema })).min(1).max(DUPLICATE_NESTED_MAX_PARENT_ITEMS),
    layerOrder: parentOrderSchema,
    spots: z.array(z.strictObject({ name: z.string().min(1).max(255), kind: z.enum(['ColorModel.REGISTRATION', 'ColorModel.SPOT', 'ColorModel.PROCESS']), base: colourWireSchema })).min(1).max(DUPLICATE_COLOUR_MAX_SPOTS),
});
function colourContextIsValid(json, sourceUuid, parentOrder) {
    try {
        const scene = colourSceneSchema.parse(JSON.parse(json));
        const nested = scene.profile === 'NESTED_CMYK';
        const pathIds = scene.paths.map(path => path.snapshot.uuid);
        const groupIds = scene.groups.map(group => group.uuid);
        return scene.groups.length === (nested ? 2 : 0) && pathIds.includes(sourceUuid) && pathIds.length >= (nested ? 2 : 1) &&
            new Set([...pathIds, ...groupIds]).size === pathIds.length + groupIds.length &&
            canonicalDigest(pathIds) === canonicalDigest(parentOrder) &&
            scene.paths.every(path => path.parent === (nested ? groupIds[0] : 'layer:0') &&
                canonicalDigest(JSON.parse(path.raw)) === canonicalDigest(path.snapshot)) &&
            (nested ? scene.layerOrder.filter(id => id === groupIds[1]).length === 1 : canonicalDigest(scene.layerOrder) === canonicalDigest(pathIds)) &&
            (!nested || (canonicalDigest(scene.groups[0].order) === canonicalDigest(pathIds) &&
                canonicalDigest(scene.groups[1].order) === canonicalDigest([groupIds[0]]))) &&
            new Set(scene.spots.map(spot => spot.name)).size === scene.spots.length &&
            scene.spots.filter(spot => spot.kind === 'ColorModel.REGISTRATION').length === 1;
    }
    catch {
        return false;
    }
}
const duplicateTextSourceSnapshotSchema = z.strictObject({
    ...duplicateTextWireSnapshotSchema.shape,
    nestedContext: nestedContextJsonSchema,
}).superRefine((snapshot, context) => {
    const nested = parseNestedContext(snapshot.nestedContext);
    if (nested.ancestors.length !== 2 || nested.siblings.length !== 1) {
        context.addIssue({ code: 'custom', message: 'Text requires two plain groups and one Path sibling.' });
    }
});
const duplicateImageSourceSnapshotSchema = z.strictObject({
    ...duplicateImageWireSnapshotSchema.shape,
    nestedContext: nestedContextJsonSchema,
});
const duplicateSourceSnapshotSchema = z.union([
    duplicatePathSourceSnapshotSchema, duplicateTextSourceSnapshotSchema, duplicateImageSourceSnapshotSchema,
]);
const duplicatePathCopySnapshotSchema = duplicatePathSourceSnapshotSchema.superRefine((snapshot, context) => {
    if (snapshot.nestedContext !== undefined || snapshot.colourContext !== undefined) {
        context.addIssue({ code: 'custom', message: 'Copy context belongs in the postcondition.' });
    }
});
const duplicateCopySnapshotSchema = z.union([
    duplicatePathCopySnapshotSchema, duplicateTextWireSnapshotSchema, duplicateImageWireSnapshotSchema,
]);
function snapshotWithoutUuid(snapshot) {
    const { controlBounds: _diagnostic, nestedContext: _context, colourContext: _colour, ...state } = snapshot;
    return { ...state, uuid: 'duplicate-native-uuid' };
}
function semanticDigest(value) {
    function semantic(value) {
        if (Array.isArray(value))
            return value.map(semantic);
        if (value && typeof value === 'object')
            return Object.fromEntries(Object.entries(value)
                .filter(([key]) => key !== 'controlBounds').map(([key, entry]) => [key, semantic(entry)]));
        return value;
    }
    return canonicalDigest(semantic(value));
}
function expectedNestedContext(source, copyUuid) {
    const context = parseNestedContext(source.nestedContext);
    return { ...context, ancestors: context.ancestors.map((group, index) => ({ ...group,
            order: index === 0 ? insertedAfter(group.order, source.uuid, copyUuid) : group.order,
        })) };
}
function insertedAfter(order, sourceUuid, duplicateUuid) {
    const sourceIndex = order.indexOf(sourceUuid);
    if (sourceIndex < 0 || order.lastIndexOf(sourceUuid) !== sourceIndex) {
        throw new Error('Source UUID must occur exactly once in the complete parent order.');
    }
    return [...order.slice(0, sourceIndex + 1), duplicateUuid, ...order.slice(sourceIndex + 1)];
}
function nestedIdentitiesAreBound(sourceUuid, parentOrder, nested) {
    const { ancestors, siblings } = nested;
    const identities = [sourceUuid, ...siblings.map((sibling) => sibling.uuid), ...ancestors.map((group) => group.uuid)];
    const outermost = ancestors[ancestors.length - 1];
    return new Set(identities).size === identities.length &&
        parentOrder.length <= DUPLICATE_NESTED_MAX_PARENT_ITEMS &&
        canonicalDigest(parentOrder.filter((uuid) => uuid !== sourceUuid)) === canonicalDigest(siblings.map((sibling) => sibling.uuid)) &&
        parentOrder.includes(sourceUuid) &&
        canonicalDigest(ancestors[0].order) === canonicalDigest(parentOrder) &&
        ancestors.every((group, index) => index === 0 || canonicalDigest(group.order) === canonicalDigest([ancestors[index - 1].uuid])) &&
        nested.layerOrder.filter((uuid) => uuid === outermost.uuid).length === 1 &&
        nested.layerOrder.every((uuid) => uuid === outermost.uuid || !identities.includes(uuid));
}
const commonInternalFields = {
    ...hostVersionInternalFields,
    expectedDocumentKey: z.string().min(1).max(16_384),
    sourceUuid: z.string().min(1).max(255),
    placement: z.literal('after_source'),
    nestedHostReady: z.boolean().optional(),
};
const duplicateObjectInternalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternalFields, apply: z.literal(false) }),
    z.strictObject({
        ...commonInternalFields,
        expectedBefore: duplicateSourceSnapshotSchema,
        expectedParentOrder: parentOrderSchema,
        apply: z.literal(true),
        commandId: canonicalCommandIdSchema,
    }),
]);
const commonPublicFields = {
    ...hostVersionBackupPublicFields,
    expected_document_key: z.string().min(1).max(16_384),
    source_uuid: z.string().min(1).max(255),
    placement: z.literal('after_source'),
};
export const duplicateObjectPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublicFields, apply: z.literal(false).default(false) }),
    z.strictObject({
        ...commonPublicFields,
        expected_before: duplicateSourceSnapshotSchema,
        expected_parent_order: parentOrderSchema,
        apply: z.literal(true),
        command_id: applyCommandIdSchema,
    }),
]);
const duplicateObjectInputSchema = z.strictObject({
    ...commonPublicFields,
    expected_before: duplicateSourceSnapshotSchema.optional(),
    expected_parent_order: parentOrderSchema.optional(),
    apply: z.boolean().default(false),
    command_id: applyCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(duplicateObjectPublicInputSchema, { io: 'input' });
duplicateObjectInputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = duplicateObjectPublicInputSchema.parse(input);
    const common = {
        ...(value.backup_id === undefined ? {} : { backupId: value.backup_id }),
        expectedDocumentKey: value.expected_document_key,
        sourceUuid: value.source_uuid,
        placement: value.placement,
    };
    return value.apply
        ? {
            ...common,
            expectedBefore: value.expected_before,
            expectedParentOrder: value.expected_parent_order,
            apply: true,
            commandId: value.command_id,
        }
        : { ...common, apply: false };
}
const blockerSchema = z.enum([
    'document_mutation_not_allowed',
    'target_locked',
    'target_hidden',
    'target_not_editable',
    'layer_hidden',
    'ancestor_hidden',
    'layer_locked',
    'ancestor_locked',
    'result_size_limit_exceeded',
]);
const duplicatePlanSchema = z.strictObject({
    operation: z.literal(DUPLICATE_OBJECT_OPERATION),
    documentKey: z.string().min(1).max(16_384),
    sourceUuid: z.string().min(1).max(255),
    placement: z.literal('after_source'),
    sourceBefore: duplicateSourceSnapshotSchema,
    parentOrderBefore: parentOrderSchema,
    sourceIndex: z.number().int().nonnegative().max(DUPLICATE_MAX_PARENT_ITEMS - 1),
    resultSizeWithinLimit: z.boolean(),
    applyBlockedReasonCodes: z.array(blockerSchema),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    if ('colourContext' in plan.sourceBefore && plan.sourceBefore.colourContext && !colourContextIsValid(plan.sourceBefore.colourContext, plan.sourceUuid, plan.parentOrderBefore)) {
        context.addIssue({ code: 'custom', message: 'Colour plan must contain the complete bound scene.' });
    }
    const nested = plan.sourceBefore.nestedContext ? parseNestedContext(plan.sourceBefore.nestedContext) : undefined;
    if (nested && !nestedIdentitiesAreBound(plan.sourceUuid, plan.parentOrderBefore, nested)) {
        context.addIssue({ code: 'custom', message: 'Nested plan must bind all native identities and complete orders.' });
    }
    if (plan.sourceUuid !== plan.sourceBefore.uuid || plan.parentOrderBefore[plan.sourceIndex] !== plan.sourceUuid ||
        plan.parentOrderBefore.indexOf(plan.sourceUuid) !== plan.parentOrderBefore.lastIndexOf(plan.sourceUuid)) {
        context.addIssue({ code: 'custom', message: 'Duplicate plan source identity must bind the complete parent order.' });
    }
    if (plan.applyAllowed !== (plan.applyBlockedReasonCodes.length === 0)) {
        context.addIssue({ code: 'custom', message: 'Duplicate applyAllowed must exactly reflect blockers.' });
    }
    if (plan.resultSizeWithinLimit === plan.applyBlockedReasonCodes.includes('result_size_limit_exceeded')) {
        context.addIssue({ code: 'custom', message: 'Duplicate result-size admission must match its blocker.' });
    }
});
const applyFailureSchema = z.strictObject({
    phase: z.literal('apply'),
    reasonCode: z.literal('apply_failed'),
    message: z.string().min(1).max(500),
});
const verifyFailureSchema = z.strictObject({
    phase: z.literal('verify'),
    reasonCode: z.literal('verify_mismatch'),
    message: z.string().min(1).max(500),
});
const indeterminateFailureSchema = z.strictObject({
    phase: z.literal('apply'),
    reasonCode: z.literal('apply_indeterminate'),
    message: z.string().min(1).max(500),
});
const duplicateTransactionSchema = z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('planned'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('verified'), audit: mutationAuditSchema }),
    z.strictObject({
        state: z.literal('apply_failed'),
        failure: applyFailureSchema,
        rollback: z.strictObject({ status: z.literal('not_required') }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rolled_back'),
        failure: z.discriminatedUnion('phase', [applyFailureSchema, verifyFailureSchema]),
        rollback: z.strictObject({
            status: z.literal('verified'),
            duplicateUuid: z.string().min(1).max(255),
            restoredSource: duplicateSourceSnapshotSchema,
            restoredParentOrder: parentOrderSchema,
        }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rollback_failed'),
        failure: z.discriminatedUnion('phase', [applyFailureSchema, verifyFailureSchema]),
        rollback: z.strictObject({
            status: z.literal('failed'),
            reasonCode: z.literal('rollback_failed'),
            message: z.string().min(1).max(500),
            duplicateUuid: z.string().min(1).max(255),
            restoredSource: duplicateSourceSnapshotSchema.nullable(),
            restoredParentOrder: parentOrderSchema.nullable(),
        }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('apply_indeterminate'),
        failure: indeterminateFailureSchema,
        rollback: z.strictObject({
            status: z.literal('indeterminate'),
            reasonCode: z.literal('identity_unavailable'),
            message: z.string().min(1).max(500),
            duplicateUuid: z.null(),
            restoredSource: z.null(),
            restoredParentOrder: z.null(),
        }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rollback_indeterminate'),
        failure: z.discriminatedUnion('phase', [applyFailureSchema, verifyFailureSchema]),
        rollback: z.strictObject({
            status: z.literal('indeterminate'),
            reasonCode: z.literal('rollback_indeterminate'),
            message: z.string().min(1).max(500),
            duplicateUuid: z.string().min(1).max(255).nullable(),
            restoredSource: duplicateSourceSnapshotSchema.nullable(),
            restoredParentOrder: parentOrderSchema.nullable(),
        }),
        audit: mutationAuditSchema,
    }),
]).superRefine((transaction, context) => {
    const prefix = [
        'preflight:started:',
        'preflight:succeeded:',
        'plan:started:',
        'plan:succeeded:',
    ];
    let expected;
    if (transaction.state === 'planned') {
        expected = [...prefix, 'apply:skipped:not_requested', 'verify:skipped:not_requested',
            'rollback:skipped:not_requested'];
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
            : ['apply:started:', 'apply:attempted:', 'apply:succeeded:', 'verify:started:',
                'verify:failed:verify_mismatch'];
        expected = [...prefix, ...failure, 'rollback:started:', transaction.state === 'rolled_back'
                ? 'rollback:succeeded:'
                : `rollback:failed:${transaction.state === 'rollback_failed' ? 'rollback_failed' : 'rollback_indeterminate'}`];
    }
    const actual = transaction.audit.map((event) => `${event.phase}:${event.event}:${'reasonCode' in event ? event.reasonCode : ''}`);
    if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
        context.addIssue({ code: 'custom', message: 'Duplicate audit sequence does not match transaction state.' });
    }
    transaction.audit.forEach((event, index) => {
        if (event.sequence !== index) {
            context.addIssue({ code: 'custom', message: 'Duplicate audit sequence numbers must be contiguous.', path: ['audit', index] });
        }
    });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' &&
            event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode &&
            event.message === transaction.failure.message);
        if (matches.length !== 1) {
            context.addIssue({ code: 'custom', message: 'Duplicate failure summary must match one audit event.' });
        }
    }
    if (transaction.state === 'rollback_failed' || transaction.state === 'rollback_indeterminate') {
        const matches = transaction.audit.filter((event) => event.event === 'failed' && event.phase === 'rollback' &&
            event.reasonCode === transaction.rollback.reasonCode && event.message === transaction.rollback.message);
        if (matches.length !== 1) {
            context.addIssue({ code: 'custom', message: 'Duplicate rollback summary must match one audit event.' });
        }
    }
    if (transaction.state === 'apply_indeterminate' && transaction.rollback.message !== transaction.failure.message) {
        context.addIssue({ code: 'custom', message: 'Duplicate indeterminate summaries must match.' });
    }
});
const duplicatePostconditionSchema = z.strictObject({
    sourceUuid: z.string().min(1).max(255),
    duplicate: duplicateCopySnapshotSchema,
    parentOrderAfter: parentOrderSchema,
    nestedContextAfter: nestedContextJsonSchema.optional(),
    colourContextAfter: colourWireSchema.optional(),
});
export const duplicateObjectResultSchema = z.union([
    z.strictObject({
        operation: z.literal(DUPLICATE_OBJECT_OPERATION),
        applied: z.literal(false),
        document: documentContextSchema,
        plan: duplicatePlanSchema,
        transaction: duplicateTransactionSchema,
    }),
    z.strictObject({
        operation: z.literal(DUPLICATE_OBJECT_OPERATION),
        applied: z.literal(true),
        document: documentContextSchema,
        plan: duplicatePlanSchema,
        postcondition: duplicatePostconditionSchema,
        transaction: duplicateTransactionSchema,
    }),
]).superRefine((result, context) => {
    if (result.transaction.state !== 'planned' && !result.plan.applyAllowed) {
        context.addIssue({ code: 'custom', message: 'A duplicate apply outcome requires an executable plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified') {
            context.addIssue({ code: 'custom', message: 'Applied duplicate requires a verified transaction.' });
            return;
        }
        if (result.postcondition.sourceUuid !== result.plan.sourceUuid) {
            context.addIssue({ code: 'custom', message: 'Verified duplicate must bind the source native UUID.' });
        }
        if (result.postcondition.duplicate.uuid === result.plan.sourceUuid ||
            canonicalSha256(snapshotWithoutUuid(result.postcondition.duplicate)) !==
                canonicalSha256(snapshotWithoutUuid(result.plan.sourceBefore))) {
            context.addIssue({ code: 'custom', message: 'Verified duplicate must match the source except for native UUID.' });
        }
        if (result.plan.sourceBefore.nestedContext) {
            const priorContext = parseNestedContext(result.plan.sourceBefore.nestedContext);
            const duplicateUuid = result.postcondition.duplicate.uuid;
            if (priorContext.ancestors.some(group => group.uuid === duplicateUuid) ||
                priorContext.siblings.some(sibling => sibling.uuid === duplicateUuid) ||
                semanticDigest(result.postcondition.nestedContextAfter ? parseNestedContext(result.postcondition.nestedContextAfter) : null) !==
                    semanticDigest(expectedNestedContext(result.plan.sourceBefore, duplicateUuid))) {
                context.addIssue({ code: 'custom', message: 'Nested duplicate must verify ancestor unions and unaffected sibling state.' });
            }
        }
        if ('colourContext' in result.plan.sourceBefore && result.plan.sourceBefore.colourContext !== result.postcondition.colourContextAfter) {
            context.addIssue({ code: 'custom', message: 'Measured colour scene must remain exactly unchanged excluding the owned copy.' });
        }
        const expectedOrder = insertedAfter(result.plan.parentOrderBefore, result.plan.sourceUuid, result.postcondition.duplicate.uuid);
        if (canonicalSha256(expectedOrder) !==
            canonicalSha256(result.postcondition.parentOrderAfter)) {
            context.addIssue({ code: 'custom', message: 'Verified duplicate must be immediately after its source.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified duplicate transaction must be applied.' });
    }
    if (result.transaction.state === 'rolled_back') {
        const rollback = result.transaction.rollback;
        if (semanticDigest(rollback.restoredSource) !== semanticDigest(result.plan.sourceBefore) ||
            canonicalSha256(rollback.restoredParentOrder) !==
                canonicalSha256(result.plan.parentOrderBefore)) {
            context.addIssue({ code: 'custom', message: 'Rolled-back duplicate must prove exact source and order restoration.' });
        }
    }
});
const finalizedAtSchema = z.string().datetime({ offset: true });
export const duplicateObjectResponseSchema = z.strictObject({
    outcome: duplicateObjectResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: finalizedAtSchema }),
});
export const DUPLICATE_OBJECT_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: DUPLICATE_OBJECT_OPERATION,
    policy: {
        version: 1,
        class: 'create',
        destructive: false,
        evidence: { identity: 'native_uuid', ownership: 'self_created_only', postcondition: 'created_state_matches_plan' },
        preconditions: { documentBinding: 'explicit_document_key', targetValidation: 'same_execution_before_apply' },
        confirmation: 'risk_scoped',
        recovery: { mode: 'remove_self_created_uuid', verification: 'native_uuid_absent', unknownIdentity: 'indeterminate' },
        terminal: { success: 'verified', failure: 'proven_pre_apply_or_verified_recovery', partialSuccess: 'nonterminal_until_reconciled' },
        replay: { requestBinding: 'canonical_request_digest', retry: 'return_attested_terminal_result', beforeTerminal: 'reconcile_required', reapplyOnRetry: false },
    },
    capabilities: {
        class: 'create',
        explicitDocumentBinding: true,
        validateTargetsBeforeApply: true,
        captureNativeUuid: true,
        verifyCreatedState: true,
        rollbackSelfCreatedUuidOnly: true,
        verifyRollbackAbsence: true,
        reconcileIndeterminate: true,
        durableTerminalReplay: true,
        trustedTerminalAttestationResolver: true,
    },
});
export const DUPLICATE_OBJECT_SAFETY_IDENTITY = canonicalDigest(DUPLICATE_OBJECT_SAFETY);
function duplicateSafetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    return bindOperationSafetyPlan({
        policyVersion: 1,
        operationClass: 'create',
        operationId: DUPLICATE_OBJECT_OPERATION,
        canonicalRequestDigest: requestDigest,
        evidence: {
            documentKey: admissionDocumentKey,
            targetLocator: `source:${result.plan.sourceUuid};layer:${'layerPath' in result.plan.sourceBefore ? result.plan.sourceBefore.layerPath.join('.') : 'nested-image'};order:${canonicalDigest(result.plan.parentOrderBefore)}`,
        },
        preconditions: {
            status: result.plan.applyAllowed ? 'satisfied' : 'blocked',
            targetsValidated: result.plan.applyBlockedReasonCodes.length === 0,
        },
        confirmation: { kind: 'risk_scoped', status: 'not_required' },
        applyAllowed: result.plan.applyAllowed,
    });
}
function duplicateSafetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' ||
        transaction.state === 'rollback_indeterminate') {
        throw new Error('Indeterminate duplicate results cannot be represented as terminal safety results.');
    }
    const common = {
        policyVersion: 1,
        operationClass: 'create',
        operationId: DUPLICATE_OBJECT_OPERATION,
        canonicalRequestDigest: requestDigest,
        planDigest: plan.planDigest,
        attestation,
    };
    if (transaction.state === 'verified' && result.applied) {
        return operationSafetyResultSchema.parse({
            ...common,
            evidence: {
                nativeUuid: result.postcondition.duplicate.uuid,
                ownership: 'self_created_only',
                postconditionVerified: true,
                outstandingEffect: null,
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
                nativeUuid: transaction.rollback.duplicateUuid,
                ownership: 'self_created_only',
                postconditionVerified: false,
                outstandingEffect: null,
            },
            executionEvidence: { outcome: 'completed' },
            resolution: {
                status: 'recovered', terminal: true, recovery: 'verified',
                proof: { kind: 'verified_recovery' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false },
            },
        });
    }
    if (transaction.state === 'rollback_failed') {
        return operationSafetyResultSchema.parse({
            ...common,
            evidence: {
                nativeUuid: transaction.rollback.duplicateUuid,
                ownership: 'self_created_only',
                postconditionVerified: false,
                outstandingEffect: transaction.rollback.duplicateUuid === null ? null : {
                    kind: 'native_uuid_still_present', nativeUuid: transaction.rollback.duplicateUuid,
                },
            },
            executionEvidence: { outcome: 'recovery_failed' },
            resolution: {
                status: 'recovery_failed', terminal: true, recovery: 'failed',
                outstandingEffect: 'known_effect_present',
                proof: { kind: 'verified_outstanding_effect' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false },
            },
        });
    }
    return operationSafetyResultSchema.parse({
        ...common,
        evidence: {
            nativeUuid: null,
            ownership: 'self_created_only',
            postconditionVerified: false,
            outstandingEffect: null,
        },
        executionEvidence: { outcome: 'proven_pre_apply' },
        resolution: {
            status: 'failed', terminal: true, recovery: 'not_required',
            proof: { kind: 'proven_pre_apply', mutationAttempted: false },
            replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false },
        },
    });
}
async function assertDuplicateSafetyConformance(value, requestDigest, attestation, resolver) {
    const result = duplicateObjectResultSchema.parse(value);
    const plan = duplicateSafetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null) {
        throw new Error('Duplicate terminal result requires a durable attestation resolver.');
    }
    await assertOperationSafetyAdapterConformance({
        registration: DUPLICATE_OBJECT_SAFETY,
        plan,
        result: duplicateSafetyResult(result, requestDigest, attestation, plan),
    }, resolver);
}
export const DUPLICATE_OBJECT_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${POINT_TEXT_SNAPSHOT_SCRIPT}
${DUPLICATE_TEXT_HOST_SCRIPT}
${DUPLICATE_IMAGE_HOST_SCRIPT}
var DUPLICATE_MAX_PATH_POINTS = ${DUPLICATE_MAX_PATH_POINTS};
var DUPLICATE_MAX_PARENT_ITEMS = ${DUPLICATE_MAX_PARENT_ITEMS};
var DUPLICATE_NESTED_MAX_DEPTH = ${DUPLICATE_NESTED_MAX_DEPTH};
var DUPLICATE_NESTED_MAX_PARENT_ITEMS = ${DUPLICATE_NESTED_MAX_PARENT_ITEMS};
var DUPLICATE_COLOUR_MAX_SPOTS = ${DUPLICATE_COLOUR_MAX_SPOTS};
var DUPLICATE_NESTED_CONTEXT_MAX_CHARS = ${DUPLICATE_NESTED_CONTEXT_MAX_CHARS};
var DUPLICATE_SNAPSHOT_MAX_BYTES = 65536;
var DUPLICATE_ORDER_MAX_BYTES = 32768;
var DUPLICATE_CONTEXT_MAX_BYTES = 24576;

function duplicateUtf8ByteLength(value) {
  var bytes = 0;
  for (var index = 0; index < value.length; index++) {
    var code = value.charCodeAt(index);
    if (code <= 0x7F) bytes += 1;
    else if (code <= 0x7FF) bytes += 2;
    else if (code >= 0xD800 && code <= 0xDBFF && index + 1 < value.length) {
      var low = value.charCodeAt(index + 1);
      if (low >= 0xDC00 && low <= 0xDFFF) { bytes += 4; index++; }
      else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

function duplicateFindTarget(document, uuid, imageBinding) {
  if (typeof document.getPageItemFromUuid !== "function") {
    throw mutationError("preflight_failed", "Illustrator native UUID lookup is unavailable.");
  }
  try {
    var target = document.getPageItemFromUuid(uuid);
    if (target === null || target === undefined) return null;
    if (typeof target.uuid !== "string" || target.uuid !== uuid) {
      throw mutationError("preflight_failed", "Native lookup returned a different UUID.");
    }
    if (imageBinding || target.typename === "GroupItem") {
      return duplicateImageLookup(document, target, uuid, imageBinding);
    }
    return target;
  } catch (lookupError) {
    var message = lookupError && lookupError.message ? String(lookupError.message) : "";
    if (lookupError && lookupError.name === "Error" && lookupError.number === 1200 &&
        message === "an Illustrator error occurred: 1346458189 ('MRAP')") return null;
    throw lookupError;
  }
}

function duplicateLayerChain(document, targetLayer) {
  function visit(layers, prefix, ancestors) {
    for (var index = 0; index < layers.length; index++) {
      var layer = layers[index];
      var path = prefix.concat([index]);
      var chain = ancestors.concat([layer]);
      if (layer === targetLayer) return { path: path, chain: chain };
      if (path.length < 64 && layer.layers && layer.layers.length > 0) {
        var nested = visit(layer.layers, path, chain);
        if (nested !== null) return nested;
      }
    }
    return null;
  }
  return visit(document.layers, [], []);
}

function duplicateNumber(value, name) {
  var rounded = Number(mutationFiniteNumber(value, name).toFixed(12));
  return rounded === 0 ? 0 : rounded;
}

function duplicatePoint(value, name) {
  if (!value || value.length !== 2) throw mutationError("preflight_failed", name + " is unavailable.");
  return [duplicateNumber(value[0], name + "[0]"), duplicateNumber(value[1], name + "[1]")];
}

function duplicateBounds(value, name) {
  if (!value || value.length !== 4) throw mutationError("preflight_failed", name + " is unavailable.");
  return [duplicateNumber(value[0], name + "[0]"), duplicateNumber(value[1], name + "[1]"),
    duplicateNumber(value[2], name + "[2]"), duplicateNumber(value[3], name + "[3]")];
}

function duplicateProcessColor(value, name, document) {
  if (value && String(value.typename) === "SpotColor") {
    if (name !== "fillColor" || document.documentColorSpace !== DocumentColorSpace.CMYK) {
      throw mutationError("preflight_failed", "Spot supports only the measured CMYK fill profile.");
    }
    if (String(value.spot.colorType) !== "ColorModel.SPOT") {
      throw mutationError("preflight_failed", "Only ordinary Spot swatches are supported.");
    }
    return { type: "SpotColor", colourState: duplicateColourPaint(value) };
  }
  if (value && String(value.typename) === "CMYKColor") {
    if (document.documentColorSpace !== DocumentColorSpace.CMYK) {
      throw mutationError("preflight_failed", name + " supports CMYKColor only in a CMYK document.");
    }
    function channel(value, label) {
      var number = duplicateNumber(value, label);
      if (number < 0 || number > 100) throw mutationError("preflight_failed", label + " is outside 0..100.");
      return Math.round(number * 100000) / 100000;
    }
    return { type: "CMYKColor", cyan: channel(value.cyan, name + ".cyan"),
      magenta: channel(value.magenta, name + ".magenta"), yellow: channel(value.yellow, name + ".yellow"),
      black: channel(value.black, name + ".black") };
  }
  if (!value || String(value.typename) !== "RGBColor") {
    throw mutationError("preflight_failed", name + " supports RGBColor only.");
  }
  return { type: "RGBColor", red: duplicateNumber(value.red, name + ".red"),
    green: duplicateNumber(value.green, name + ".green"), blue: duplicateNumber(value.blue, name + ".blue") };
}

function duplicateSnapshot(document, target, expectedUuid) {
  if (target && target.typename === "TextFrame") {
    var text = duplicateTextSnapshot(document, target, expectedUuid);
    var textState = {}, wire = {};
    for (var key in text) if (text.hasOwnProperty(key)) {
      if (key === "uuid" || key === "type" || key === "layerPath" || key === "locked" || key === "hidden" ||
          key === "editable" || key === "layerVisible" || key === "layerLocked" ||
          key === "effectiveLayerVisible" || key === "effectiveLayerLocked") wire[key] = text[key];
      else if (key !== "controlBounds") textState[key] = text[key];
    }
    wire.textState = stringifyJson(textState);
    return wire;
  }
  if (target && (target.typename === "PlacedItem" || target.typename === "RasterItem")) {
    var image = duplicateImageFields(document, target);
    if (typeof target.uuid !== "string" || target.uuid.length === 0 ||
        (expectedUuid !== null && target.uuid !== expectedUuid)) {
      throw mutationError("preflight_failed", "Target native UUID is unavailable or changed.");
    }
    if (target.locked !== false || target.hidden !== false || target.editable !== true) {
      throw mutationError("preflight_failed", "Nested image must be unlocked, visible, and editable.");
    }
    var imageLayer = duplicateLayerChain(document, target.layer);
    if (imageLayer === null) throw mutationError("preflight_failed", "Target image layer identity is unavailable.");
    for (var imageLayerIndex = 0; imageLayerIndex < imageLayer.chain.length; imageLayerIndex++) {
      if (imageLayer.chain[imageLayerIndex].visible !== true || imageLayer.chain[imageLayerIndex].locked === true) {
        throw mutationError("preflight_failed", "Nested image requires visible and unlocked layers.");
      }
    }
    return {
      uuid: target.uuid, type: image.type,
      imageState: stringifyJson(image)
    };
  }
  if (!target || target.typename !== "PathItem" ||
      (target.parent.typename !== "Layer" && target.parent.typename !== "GroupItem")) {
    throw mutationError("preflight_failed", "Native UUID lookup returned an unsupported duplicate item type.");
  }
  if (typeof target.uuid !== "string" || target.uuid.length === 0 ||
      (expectedUuid !== null && target.uuid !== expectedUuid)) {
    throw mutationError("preflight_failed", "Target native UUID is unavailable or changed.");
  }
  var layerInfo = duplicateLayerChain(document, target.layer);
  if (layerInfo === null || (target.parent.typename === "Layer" && target.parent !== target.layer)) {
    throw mutationError("preflight_failed", "Target layer identity is unavailable.");
  }
  var effectiveVisible = true;
  var effectiveLocked = false;
  for (var layerIndex = 0; layerIndex < layerInfo.chain.length; layerIndex++) {
    var layer = layerInfo.chain[layerIndex];
    if (typeof layer.visible !== "boolean" || typeof layer.locked !== "boolean") {
      throw mutationError("preflight_failed", "Layer safety state is unavailable.");
    }
    if (!layer.visible) effectiveVisible = false;
    if (layer.locked) effectiveLocked = true;
  }
  if (!target.pathPoints || target.pathPoints.length < 1 || target.pathPoints.length > DUPLICATE_MAX_PATH_POINTS) {
    throw mutationError("preflight_failed", "Duplicate supports PathItems with 1 to " +
      DUPLICATE_MAX_PATH_POINTS + " readable path points only.");
  }
  var pathPoints = [];
  for (var pointIndex = 0; pointIndex < target.pathPoints.length; pointIndex++) {
    var point = target.pathPoints[pointIndex];
    var pointType = String(point.pointType);
    if (pointType !== "PointType.CORNER" && pointType !== "PointType.SMOOTH") {
      throw mutationError("preflight_failed", "Unsupported path-point type.");
    }
    pathPoints.push({
      anchor: duplicatePoint(point.anchor, "pathPoints[" + pointIndex + "].anchor"),
      leftDirection: duplicatePoint(point.leftDirection, "pathPoints[" + pointIndex + "].leftDirection"),
      rightDirection: duplicatePoint(point.rightDirection, "pathPoints[" + pointIndex + "].rightDirection"),
      pointType: pointType
    });
  }
  if (typeof target.filled !== "boolean" || typeof target.stroked !== "boolean" ||
      typeof target.locked !== "boolean" || typeof target.hidden !== "boolean" || typeof target.editable !== "boolean") {
    throw mutationError("preflight_failed", "Target appearance or safety state is unavailable.");
  }
  var strokeDashes = [];
  if (!target.strokeDashes || target.strokeDashes.length > 32) {
    throw mutationError("preflight_failed", "Target stroke dash state is unavailable or too large.");
  }
  for (var dashIndex = 0; dashIndex < target.strokeDashes.length; dashIndex++) {
    strokeDashes.push(duplicateNumber(target.strokeDashes[dashIndex], "strokeDashes[" + dashIndex + "]"));
  }
  var visibilityVariable;
  try { visibilityVariable = target.visibilityVariable; }
  catch (variableError) { throw mutationError("preflight_failed", "Target visibility variable state is unreadable."); }
  var stateRefusals = [];
  if (target.clipping) stateRefusals.push("clipping=true");
  if (target.guides) stateRefusals.push("guides=true");
  if (target.sliced) stateRefusals.push("sliced=true");
  if (target.isIsolated) stateRefusals.push("isIsolated=true");
  if (target.wrapped) stateRefusals.push("wrapped=true");
  if (String(target.artworkKnockout) !== "KnockoutState.DISABLED") stateRefusals.push("artworkKnockout=" + String(target.artworkKnockout));
  if (String(target.blendingMode) !== "BlendModes.NORMAL") stateRefusals.push("blendingMode=" + String(target.blendingMode));
  if (visibilityVariable !== null) stateRefusals.push("visibilityVariable=present");
  if (String(target.note) !== "") stateRefusals.push("note=non-empty");
  if (target.tags.length !== 0) stateRefusals.push("tags=non-empty");
  if (String(target.uRL) !== "") stateRefusals.push("uRL=non-empty");
  if (String(target.polarity) !== "PolarityValues.POSITIVE") stateRefusals.push("polarity=" + String(target.polarity));
  if (stateRefusals.length > 0) {
    throw mutationError("preflight_failed", "Target uses an unsupported structural or appearance state (" + stateRefusals.join(", ") + ").");
  }
  var strokeCap = String(target.strokeCap);
  var strokeJoin = String(target.strokeJoin);
  if ((strokeCap !== "StrokeCap.BUTTENDCAP" && strokeCap !== "StrokeCap.ROUNDENDCAP" &&
       strokeCap !== "StrokeCap.PROJECTINGENDCAP") ||
      (strokeJoin !== "StrokeJoin.BEVELENDJOIN" && strokeJoin !== "StrokeJoin.ROUNDENDJOIN" &&
       strokeJoin !== "StrokeJoin.MITERENDJOIN")) {
    throw mutationError("preflight_failed", "Target stroke cap or join is unsupported.");
  }
  return {
    uuid: target.uuid,
    type: target.typename,
    name: String(target.name || ""),
    layerPath: layerInfo.path,
    geometricBounds: duplicateBounds(target.geometricBounds, "geometricBounds"),
    controlBounds: duplicateBounds(target.controlBounds, "controlBounds"),
    visibleBounds: duplicateBounds(target.visibleBounds, "visibleBounds"),
    position: duplicatePoint(target.position, "position"),
    width: duplicateNumber(target.width, "width"),
    height: duplicateNumber(target.height, "height"),
    closed: Boolean(target.closed),
    pathPoints: pathPoints,
    filled: target.filled,
    fillColor: target.filled ? duplicateProcessColor(target.fillColor, "fillColor", document) : null,
    fillOverprint: Boolean(target.fillOverprint),
    stroked: target.stroked,
    strokeColor: target.stroked ? duplicateProcessColor(target.strokeColor, "strokeColor", document) : null,
    strokeWidth: target.stroked ? duplicateNumber(target.strokeWidth, "strokeWidth") : null,
    strokeOverprint: Boolean(target.strokeOverprint),
    strokeDashes: strokeDashes,
    strokeDashOffset: duplicateNumber(target.strokeDashOffset, "strokeDashOffset"),
    strokeCap: strokeCap,
    strokeJoin: strokeJoin,
    strokeMiterLimit: duplicateNumber(target.strokeMiterLimit, "strokeMiterLimit"),
    evenodd: Boolean(target.evenodd),
    polarity: String(target.polarity),
    resolution: duplicateNumber(target.resolution, "resolution"),
    artworkKnockout: String(target.artworkKnockout),
    blendingMode: String(target.blendingMode),
    opacity: duplicateNumber(target.opacity, "opacity"),
    pixelAligned: Boolean(target.pixelAligned),
    noteEmpty: true,
    tagsEmpty: true,
    urlEmpty: true,
    visibilityVariableAbsent: true,
    wrapped: false,
    clipping: false,
    guides: false,
    sliced: false,
    isolated: false,
    locked: target.locked,
    hidden: target.hidden,
    editable: target.editable,
    layerVisible: target.layer.visible,
    layerLocked: target.layer.locked,
    effectiveLayerVisible: effectiveVisible,
    effectiveLayerLocked: effectiveLocked
  };
}

function duplicateSameParent(left, right) {
  if (!left || !right || left.typename !== right.typename) return false;
  return left.typename === "GroupItem" ? typeof left.uuid === "string" && left.uuid === right.uuid : left === right;
}

function duplicateParentOrder(layer) {
  if (!layer.pageItems || layer.pageItems.length < 1 || layer.pageItems.length > DUPLICATE_MAX_PARENT_ITEMS) {
    throw mutationError("preflight_failed", "Duplicate parent must contain 1 to " +
      DUPLICATE_MAX_PARENT_ITEMS + " direct page items.");
  }
  var order = [];
  var seen = {};
  for (var index = 0; index < layer.pageItems.length; index++) {
    var item = layer.pageItems[index];
    if (!duplicateSameParent(item.parent, layer) || typeof item.uuid !== "string" || item.uuid.length === 0 || seen[item.uuid]) {
      throw mutationError("preflight_failed", "Duplicate requires a complete unique direct-parent UUID order.");
    }
    seen[item.uuid] = true;
    order.push(item.uuid);
  }
  return order;
}

// controlBounds are diagnostic only, including the sibling snapshot in nested CAS.
function duplicateSemantic(value) {
  if (value === null || typeof value !== "object") return value;
  if (Object.prototype.toString.call(value) === "[object Array]") {
    var list = []; for (var index = 0; index < value.length; index++) list.push(duplicateSemantic(value[index]));
    return list;
  }
  var out = {};
  for (var key in value) if (value.hasOwnProperty(key) && key !== "controlBounds") out[key] = duplicateSemantic(value[key]);
  return out;
}
function duplicateSnapshotMatches(left, right) {
  return stringifyJson(duplicateSemantic(left)) === stringifyJson(duplicateSemantic(right));
}

function duplicateSnapshotMatchesExceptUuid(left, right) {
  if (!left || !right) return false;
  var leftUuid = left.uuid;
  var rightUuid = right.uuid;
  left.uuid = right.uuid = "duplicate-native-uuid";
  var matches = duplicateSnapshotMatches(left, right);
  left.uuid = leftUuid;
  right.uuid = rightUuid;
  return matches;
}

function duplicateCopySnapshot(snapshot) {
  var out = duplicateSemantic(snapshot);
  delete out.nestedContext;
  delete out.colourContext;
  return out;
}

function duplicateNestedGroup(group) {
  if (!group || group.typename !== "GroupItem" || typeof group.uuid !== "string" || !group.uuid ||
      group.locked !== false || group.hidden !== false || group.editable !== true || group.clipped !== false ||
      group.opacity !== 100 || String(group.blendingMode) !== "BlendModes.NORMAL") {
    throw mutationError("preflight_failed", "Nested duplicate ancestor state is outside the measured profile.");
  }
  return { uuid: group.uuid, name: String(group.name || ""),
    geometricBounds: duplicateBounds(group.geometricBounds, "ancestor.geometricBounds"),
    visibleBounds: duplicateBounds(group.visibleBounds, "ancestor.visibleBounds"), order: duplicateParentOrder(group),
    locked: false, hidden: false, editable: true, clipped: false, opacity: 100, blendingMode: "BlendModes.NORMAL" };
}

// Ancestor groups from the source's parent up to its layer, innermost first. Depth is a Host-behavior
// condition: only the measured 1 to 3 levels are admitted.
function duplicateNestedChain(source) {
  var groups = [];
  var node = source.parent;
  while (node && node.typename === "GroupItem") {
    if (groups.length === DUPLICATE_NESTED_MAX_DEPTH) {
      throw mutationError("preflight_failed", "Nested duplicate supports 1 to " + DUPLICATE_NESTED_MAX_DEPTH + " ancestor groups only.");
    }
    groups.push(node);
    node = node.parent;
  }
  if (groups.length === 0 || !node || node !== source.layer) {
    throw mutationError("preflight_failed", "Nested duplicate ancestors must end at the source layer.");
  }
  return groups;
}

// Complete order of the parent group; with copyUuid the copy must sit immediately after the source and is
// removed again so before and after reads describe the same sibling set.
function duplicateNestedSiblingOrder(innerOrder, sourceUuid, copyUuid) {
  var sourceIndex = -1;
  for (var index = 0; index < innerOrder.length; index++) {
    if (innerOrder[index] === sourceUuid) {
      if (sourceIndex !== -1) throw mutationError("preflight_failed", "Source UUID is duplicated in parent order.");
      sourceIndex = index;
    }
  }
  if (sourceIndex < 0) throw mutationError("preflight_failed", "Source UUID is absent from parent order.");
  var order = innerOrder.slice(0);
  if (copyUuid) {
    if (order[sourceIndex + 1] !== copyUuid) throw mutationError("preflight_failed", "Nested duplicate must sit immediately after its source.");
    order.splice(sourceIndex + 1, 1);
  }
  if (order.length < 2 || order.length > DUPLICATE_NESTED_MAX_PARENT_ITEMS) {
    throw mutationError("preflight_failed", "Nested duplicate requires a parent group of 2 to " +
      DUPLICATE_NESTED_MAX_PARENT_ITEMS + " PathItems.");
  }
  return order;
}

function layerOrderForText(document, layer, outer) {
  return mutationSameSequence(duplicateParentOrder(layer), [outer.uuid]);
}
function duplicateNestedContext(document, source, copyUuid) {
  if (!duplicateVersionAdmitted() || (document.documentColorSpace !== DocumentColorSpace.RGB && document.documentColorSpace !== DocumentColorSpace.CMYK) || document.layers.length !== 1 ||
      source.layer.layers.length !== 0) {
    throw mutationError("preflight_failed", "Nested duplicate requires the measured single-layer RGB profile.");
  }
  var groups = duplicateNestedChain(source);
  if (document.documentColorSpace === DocumentColorSpace.CMYK && (source.typename !== "PathItem" || groups.length !== 2)) {
    throw mutationError("preflight_failed", "CMYK nested duplicate requires the measured two-group Path profile.");
  }
  var textSource = source.typename === "TextFrame";
  var imageSource = source.typename === "PlacedItem" || source.typename === "RasterItem";
  if (textSource && (groups.length !== 2 || layerOrderForText(document, source.layer, groups[1]) !== true)) {
    throw mutationError("preflight_failed", "Text requires the tiny two-group profile with no other layer artwork.");
  }
  if (imageSource && (groups.length !== 2 || layerOrderForText(document, source.layer, groups[1]) !== true)) {
    throw mutationError("preflight_failed", "Image requires the measured two-group profile with no other layer artwork.");
  }
  var states = [];
  var identities = {};
  identities[source.uuid] = true;
  if (copyUuid) identities[copyUuid] = true;
  for (var groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    var state = duplicateNestedGroup(groups[groupIndex]);
    if (identities[state.uuid]) throw mutationError("preflight_failed", "Nested duplicate identities are not distinct.");
    identities[state.uuid] = true;
    if (groupIndex > 0 && !mutationSameSequence(state.order, [states[groupIndex - 1].uuid])) {
      throw mutationError("preflight_failed", "Nested duplicate requires each outer group to hold only the next inner group.");
    }
    states.push(state);
  }
  var outermost = states[states.length - 1];
  var layerOrder = duplicateParentOrder(source.layer);
  var outermostCount = 0;
  for (var layerIndex = 0; layerIndex < layerOrder.length; layerIndex++) if (layerOrder[layerIndex] === outermost.uuid) outermostCount++;
  if (outermostCount !== 1) throw mutationError("preflight_failed", "Nested duplicate layer order must hold the outermost group once.");
  var siblingOrder = duplicateNestedSiblingOrder(states[0].order, source.uuid, copyUuid);
  if ((textSource || imageSource) && siblingOrder.length !== 2) {
    throw mutationError("preflight_failed", "Nested text and images require one Path sibling only.");
  }
  var siblings = [];
  for (var siblingIndex = 0; siblingIndex < siblingOrder.length; siblingIndex++) {
    var siblingUuid = siblingOrder[siblingIndex];
    if (siblingUuid === source.uuid) continue;
    if (identities[siblingUuid]) throw mutationError("preflight_failed", "Nested duplicate identities are not distinct.");
    identities[siblingUuid] = true;
    var sibling = duplicateFindTarget(document, siblingUuid);
    if (!sibling || !duplicateSameParent(sibling.parent, groups[0])) throw mutationError("preflight_failed", "Nested sibling parent changed.");
    if (sibling.typename !== "PathItem") throw mutationError("preflight_failed", "Nested siblings must remain supported PathItems.");
    var siblingState = duplicateSnapshot(document, sibling, siblingUuid);
    if (siblingState.locked || siblingState.hidden || !siblingState.editable) {
      throw mutationError("preflight_failed", "Nested sibling safety state is unsupported.");
    }
    siblings.push(duplicateSemantic(siblingState));
  }
  return { ancestors: states, siblings: siblings, layerOrder: layerOrder };
}

// #577 structural colour admission. Paint wires stay strings: no expected-number
// reserialization, tolerance or inference about Illustrator's internal numeric type.
function duplicateColourRequired(document, source) {
  return source.typename === "PathItem" && (String(source.fillColor.typename) === "SpotColor" ||
    (source.parent.typename === "GroupItem" && document.documentColorSpace === DocumentColorSpace.CMYK));
}
function duplicateColourPaint(paint) {
  function base(p) {
    if (!p || String(p.typename) !== "CMYKColor") throw mutationError("preflight_failed", "Measured colour requires CMYK base.");
    return { type: "CMYKColor", values: [mutationFiniteNumber(p.cyan,"cyan"), mutationFiniteNumber(p.magenta,"magenta"),
      mutationFiniteNumber(p.yellow,"yellow"), mutationFiniteNumber(p.black,"black")] };
  }
  if (String(paint.typename) !== "SpotColor") return stringifyJson(base(paint));
  return stringifyJson({type:"SpotColor",name:String(paint.spot.name),kind:String(paint.spot.colorType),
    base:base(paint.spot.color),tint:mutationFiniteNumber(paint.tint,"tint")});
}
function duplicateColourRawSnapshot(document, item) {
    function vector(value, length) { var out=[];if(!value || value.length!==length) throw mutationError("preflight_failed","Raw vector unavailable.");
      for(var r=0;r<length;r++)out.push(mutationFiniteNumber(value[r],"raw coordinate"));return out; }
    var state=duplicateSemantic(duplicateSnapshot(document,item,item.uuid));
    state.geometricBounds=vector(item.geometricBounds,4);state.visibleBounds=vector(item.visibleBounds,4);state.position=vector(item.position,2);
    state.width=mutationFiniteNumber(item.width,"width");state.height=mutationFiniteNumber(item.height,"height");
    state.opacity=mutationFiniteNumber(item.opacity,"opacity");state.resolution=mutationFiniteNumber(item.resolution,"resolution");
    state.strokeDashes=vector(item.strokeDashes,item.strokeDashes.length);
    state.strokeDashOffset=mutationFiniteNumber(item.strokeDashOffset,"dash offset");state.strokeMiterLimit=mutationFiniteNumber(item.strokeMiterLimit,"miter limit");
    for(var q=0;q<state.pathPoints.length;q++){var point=item.pathPoints[q];state.pathPoints[q].anchor=vector(point.anchor,2);
      state.pathPoints[q].leftDirection=vector(point.leftDirection,2);state.pathPoints[q].rightDirection=vector(point.rightDirection,2);}
    return state;
  }

// Definition of any document spot, recorded raw so a copy cannot silently alter a swatch.
function duplicateColourSpotBase(color) {
  var type = String(color.typename);
  if (type === "CMYKColor") return duplicateColourPaint(color);
  if (type === "RGBColor") return stringifyJson({ type: type, values: [mutationFiniteNumber(color.red,"red"), mutationFiniteNumber(color.green,"green"), mutationFiniteNumber(color.blue,"blue")] });
  if (type === "LabColor") return stringifyJson({ type: type, values: [mutationFiniteNumber(color.l,"l"), mutationFiniteNumber(color.a,"a"), mutationFiniteNumber(color.b,"b")] });
  if (type === "GrayColor") return stringifyJson({ type: type, values: [mutationFiniteNumber(color.gray,"gray")] });
  throw mutationError("preflight_failed", "Spot definition uses an unsupported colour type.");
}

function duplicateColourContext(document, source, copyUuid) {
  function need(value) { if (!value) throw mutationError("preflight_failed", "Outside the measured #577 colour profile."); }
  var nested = source.parent.typename === "GroupItem";
  need(params.nestedHostReady === true && duplicateVersionAdmitted() && document.documentColorSpace === DocumentColorSpace.CMYK &&
    document.layers.length === 1 && source.layer === document.layers[0] && source.layer.layers.length === 0);
  var order = duplicateParentOrder(source.parent), baselineOrder = [];
  for (var o=0;o<order.length;o++) if (order[o] !== copyUuid) baselineOrder.push(order[o]);
  need(baselineOrder.length >= (nested?2:1) && baselineOrder.length <= DUPLICATE_NESTED_MAX_PARENT_ITEMS);
  var sourceSeen = 0;
  for (var q=0;q<baselineOrder.length;q++) if (baselineOrder[q] === source.uuid) sourceSeen++;
  need(sourceSeen === 1);
  if (copyUuid) need(mutationSameSequence(order,duplicateExpectedOrder(baselineOrder,source.uuid,copyUuid)));
  var groups = [], layerOrder = duplicateParentOrder(source.layer);
  if (nested) {
    var chain = duplicateNestedChain(source); need(chain.length === 2);
    groups = [duplicateNestedGroup(chain[0]),duplicateNestedGroup(chain[1])]; groups[0].order = baselineOrder;
    for(var g=0;g<groups.length;g++){var geometric=chain[g].geometricBounds,visible=chain[g].visibleBounds;
      for(var c=0;c<4;c++){groups[g].geometricBounds[c]=mutationFiniteNumber(geometric[c],"group geometry");groups[g].visibleBounds[c]=mutationFiniteNumber(visible[c],"group visible");}}
    var outerCount = 0;
    for (var l=0;l<layerOrder.length;l++) if (layerOrder[l] === groups[1].uuid) outerCount++;
    need(mutationSameSequence(groups[1].order,[groups[0].uuid]) && outerCount === 1);
  } else need(mutationSameSequence(layerOrder,order));
  var spots = [], registrations = 0, spotBases = {}; need(document.spots.length >= 1 && document.spots.length <= DUPLICATE_COLOUR_MAX_SPOTS);
  for (var s=0;s<document.spots.length;s++) {
    var spot = document.spots[s], kind = String(spot.colorType), name = String(spot.name);
    need((kind === "ColorModel.REGISTRATION" || kind === "ColorModel.SPOT" || kind === "ColorModel.PROCESS") && name.length > 0 && !spotBases.hasOwnProperty(name));
    spotBases[name] = duplicateColourSpotBase(spot.color);
    if (kind === "ColorModel.REGISTRATION") registrations++;
    spots.push({name:name,kind:kind,base:spotBases[name]});
  }
  need(registrations === 1);
  var paths = [];
  for (var i=0;i<baselineOrder.length;i++) {
    var item = duplicateFindTarget(document,baselineOrder[i]); need(item && item.typename === "PathItem" && duplicateSameParent(item.parent,source.parent));
    var state = duplicateColourRawSnapshot(document, item);
    need(!state.locked && !state.hidden && state.editable);
    var paint = state.filled ? duplicateColourPaint(item.fillColor) : '{"type":"NoPaint"}';
    if (state.filled && String(item.fillColor.typename) === "SpotColor") {
      need(!nested && String(item.fillColor.spot.colorType) === "ColorModel.SPOT" && spotBases[String(item.fillColor.spot.name)] === duplicateColourPaint(item.fillColor.spot.color));
    }
    if (item.uuid === source.uuid) need(nested ? String(item.fillColor.typename) === "CMYKColor" && state.filled : String(item.fillColor.typename) === "SpotColor" && state.filled);
    paths.push({parent:nested?groups[0].uuid:"layer:0",snapshot:state,paint:paint,raw:stringifyJson(state)});
  }
  // Complete baseline scene excludes only the owned copy/order entry. All other facts bind CAS and restoration.
  var context = stringifyJson({profile:nested?"NESTED_CMYK":"LAYER_SPOT",
    groups:groups,paths:paths,layerOrder:nested?layerOrder:baselineOrder,spots:spots});
  need(context.length <= 32768); return context;
}

function duplicateExpectedNestedContext(before, prior, copyUuid) {
  var context = duplicateSemantic(prior);
  context.ancestors[0].order = duplicateExpectedOrder(context.ancestors[0].order, before.uuid, copyUuid);
  return context;
}

function duplicateExpectedOrder(before, sourceUuid, duplicateUuid) {
  var result = [];
  var inserted = false;
  for (var index = 0; index < before.length; index++) {
    result.push(before[index]);
    if (before[index] === sourceUuid) {
      if (inserted) throw mutationError("preflight_failed", "Source UUID occurs more than once in parent order.");
      result.push(duplicateUuid);
      inserted = true;
    }
  }
  if (!inserted) throw mutationError("preflight_failed", "Source UUID is absent from parent order.");
  return result;
}

function duplicateResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  if (params.placement !== "after_source") {
    throw mutationError("preflight_failed", "Duplicate v1 supports placement after_source only.");
  }
  var imageBinding = forApply && params.expectedBefore && duplicateImageType(params.expectedBefore.type)
    ? { type: params.expectedBefore.type, parent: null, order: null } : null;
  var source = duplicateFindTarget(document, params.sourceUuid, imageBinding);
  if (source === null) throw new Error("MCP_ERROR:" + stringifyJson({ code: "OBJECT_NOT_FOUND", uuid: params.sourceUuid }));
  var sourceBefore = duplicateSnapshot(document, source, params.sourceUuid);
  var nestedContext = null;
  // The paths whose measured profile used to pin the host version (nested, colour and image duplicates) are admitted by the
  // policy table (\`duplicate_object\`): the channel and, for a saved file, the verified backup are checked here with the real params.
  var colourRequired = duplicateColourRequired(document, source);
  if ((duplicateImageType(sourceBefore.type) || colourRequired || source.parent.typename === "GroupItem") &&
      !hostVersionAdmitted("duplicate_object", String(app.version))) {
    throw mutationError("preflight_failed", "The host version policy does not admit Illustrator " + String(app.version) + " for this duplicate.");
  }
  if (colourRequired) {
    sourceBefore.colourContext = duplicateColourContext(document, source, null);
  }
  if (source.parent.typename === "GroupItem") {
    if (params.nestedHostReady !== true) {
      throw mutationError("preflight_failed", "Measured duplicate requires foreground/unlocked Host state.");
    }
    nestedContext = duplicateNestedContext(document, source, null);
    sourceBefore.nestedContext = stringifyJson(nestedContext);
    if (sourceBefore.nestedContext.length > DUPLICATE_NESTED_CONTEXT_MAX_CHARS) {
      throw mutationError("preflight_failed", "Nested duplicate context exceeds " + DUPLICATE_NESTED_CONTEXT_MAX_CHARS + " characters.");
    }
  }
  var parentOrderBefore = duplicateParentOrder(source.parent);
  var sourceIndex = -1;
  for (var index = 0; index < parentOrderBefore.length; index++) {
    if (parentOrderBefore[index] === params.sourceUuid) {
      if (sourceIndex !== -1) throw mutationError("preflight_failed", "Source UUID is duplicated in parent order.");
      sourceIndex = index;
    }
  }
  if (sourceIndex < 0) throw mutationError("preflight_failed", "Source UUID is absent from parent order.");
  var resultSizeWithinLimit =
    duplicateUtf8ByteLength(stringifyJson(sourceBefore)) <= DUPLICATE_SNAPSHOT_MAX_BYTES &&
    duplicateUtf8ByteLength(stringifyJson(parentOrderBefore)) <= DUPLICATE_ORDER_MAX_BYTES &&
    duplicateUtf8ByteLength(stringifyJson(context)) <= DUPLICATE_CONTEXT_MAX_BYTES;
  var blockers = [];
  if (!context.mutationAllowed) blockers.push("document_mutation_not_allowed");
  if (!sourceBefore.imageState) {
    if (sourceBefore.locked) blockers.push("target_locked");
    if (sourceBefore.hidden) blockers.push("target_hidden");
    if (!sourceBefore.editable) blockers.push("target_not_editable");
    if (!sourceBefore.layerVisible) blockers.push("layer_hidden");
    if (!sourceBefore.effectiveLayerVisible && sourceBefore.layerVisible) blockers.push("ancestor_hidden");
    if (sourceBefore.layerLocked) blockers.push("layer_locked");
    if (sourceBefore.effectiveLayerLocked && !sourceBefore.layerLocked) blockers.push("ancestor_locked");
  }
  if (!resultSizeWithinLimit) blockers.push("result_size_limit_exceeded");
  if (forApply && blockers.length > 0) {
    throw new Error("MCP_ERROR:" + stringifyJson({
      code: "DUPLICATE_APPLY_BLOCKED", reasonCodes: blockers, uuid: params.sourceUuid
    }));
  }
  return { context: context, document: document, source: source, sourceBefore: sourceBefore, nestedContext: nestedContext,
    parentLayer: source.layer, parent: source.parent, parentOrderBefore: parentOrderBefore, sourceIndex: sourceIndex,
    resultSizeWithinLimit: resultSizeWithinLimit, blockers: blockers };
}

function duplicatePreflight(forApply) {
  var resolved = duplicateResolve(forApply);
  if (forApply) {
    if (!duplicateSnapshotMatches(resolved.sourceBefore, params.expectedBefore)) {
      throw mutationError("preflight_failed", "Source state does not match expected_before.");
    }
    if (!mutationSameSequence(resolved.parentOrderBefore, params.expectedParentOrder)) {
      throw mutationError("preflight_failed", "Parent order does not match expected_parent_order.");
    }
  }
  return resolved;
}

function duplicatePlan(preflight) {
  var plan = {
    operation: "duplicate_object",
    documentKey: preflight.context.key,
    sourceUuid: params.sourceUuid,
    placement: params.placement,
    sourceBefore: preflight.sourceBefore,
    parentOrderBefore: preflight.parentOrderBefore,
    sourceIndex: preflight.sourceIndex,
    resultSizeWithinLimit: preflight.resultSizeWithinLimit,
    applyBlockedReasonCodes: preflight.blockers,
    applyAllowed: preflight.blockers.length === 0
  };
  return plan;
}

function duplicateRevalidate(preflight, plan) {
  var current;
  try { current = duplicateResolve(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Duplicate preconditions changed before apply.")); }
  if (current.document !== preflight.document || current.source.uuid !== preflight.source.uuid ||
      !duplicateSameParent(current.parent, preflight.parent) ||
      current.parentLayer !== preflight.parentLayer ||
      !duplicateSnapshotMatches(current.sourceBefore, plan.sourceBefore) ||
      !mutationSameSequence(current.parentOrderBefore, plan.parentOrderBefore)) {
    throw mutationBeforeSideEffectError("Duplicate source or complete parent order changed before apply.");
  }
}

function duplicateApply(preflight, plan, state) {
  state.operationState.mutationStarted = true;
  var created = preflight.source.duplicate(preflight.source, ElementPlacement.PLACEAFTER);
  state.operationState.createdObject = created;
  if (!created || typeof created.uuid !== "string" || created.uuid.length === 0 || created.uuid === params.sourceUuid) {
    throw mutationError("apply_failed", "Illustrator did not return a distinct native UUID for the duplicate.");
  }
  state.operationState.createdUuid = created.uuid;
  state.operationState.rollbackEvidence.duplicateUuid = created.uuid;
  if (plan.sourceBefore.nestedContext) {
    var prior = preflight.nestedContext;
    var collides = false;
    for (var siblingIndex = 0; siblingIndex < prior.siblings.length; siblingIndex++) if (created.uuid === prior.siblings[siblingIndex].uuid) collides = true;
    for (var ancestorIndex = 0; ancestorIndex < prior.ancestors.length; ancestorIndex++) if (created.uuid === prior.ancestors[ancestorIndex].uuid) collides = true;
    if (collides) {
      state.operationState.createdUuid = null;
      throw mutationError("apply_failed", "Duplicate UUID collides with an existing nested item.");
    }
  }
  return created;
}

function duplicateVerify(preflight, plan, state) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) {
    throw mutationError("verify_mismatch", "Active document changed during duplicate verification.");
  }
  var imageBinding = duplicateImageBinding(preflight, state.operationState.createdUuid);
  var source = duplicateFindTarget(preflight.document, params.sourceUuid, imageBinding);
  var created = duplicateFindTarget(preflight.document, state.operationState.createdUuid, imageBinding);
  if (source === null || source.uuid !== preflight.source.uuid || created === null ||
      created.uuid !== state.operationState.createdObject.uuid || created.uuid === source.uuid ||
      !duplicateSameParent(created.parent, preflight.parent)) {
    throw mutationError("verify_mismatch", "Source or duplicate native identity does not match the plan.");
  }
  var sourceAfter = duplicateSnapshot(preflight.document, source, params.sourceUuid);
  var duplicateAfter = duplicateSnapshot(preflight.document, created, state.operationState.createdUuid);
  var parentOrderAfter = duplicateParentOrder(source.parent);
  var expectedOrder = duplicateExpectedOrder(plan.parentOrderBefore, params.sourceUuid, state.operationState.createdUuid);
  var expectedSource = duplicateCopySnapshot(plan.sourceBefore);
  if (!duplicateSnapshotMatches(sourceAfter, expectedSource) ||
      !duplicateSnapshotMatchesExceptUuid(duplicateAfter, duplicateCopySnapshot(plan.sourceBefore)) ||
      !mutationSameSequence(parentOrderAfter, expectedOrder)) {
    throw mutationError("verify_mismatch", "Duplicate state or complete parent order does not match the plan.");
  }
  var colourAfter = null;
  if (plan.sourceBefore.colourContext) {
    colourAfter = duplicateColourContext(preflight.document, source, state.operationState.createdUuid);
    if (colourAfter !== plan.sourceBefore.colourContext || duplicateColourPaint(created.fillColor) !== duplicateColourPaint(source.fillColor) ||
        !duplicateSnapshotMatchesExceptUuid(duplicateColourRawSnapshot(preflight.document,created),duplicateColourRawSnapshot(preflight.document,source))) {
      throw mutationError("verify_mismatch", "Raw paint, Spot definitions or measured colour scene changed.");
    }
  }
  var postcondition = { sourceUuid: sourceAfter.uuid, duplicate: duplicateAfter, parentOrderAfter: parentOrderAfter };
  if (colourAfter !== null) postcondition.colourContextAfter = colourAfter;
  if (plan.sourceBefore.nestedContext) {
    var after = duplicateNestedContext(preflight.document, source, state.operationState.createdUuid);
    if (!duplicateSnapshotMatches(after, duplicateExpectedNestedContext(plan.sourceBefore, preflight.nestedContext, state.operationState.createdUuid))) {
      throw mutationError("verify_mismatch", "Nested ancestors, sibling or complete orders changed unexpectedly.");
    }
    postcondition.nestedContextAfter = stringifyJson(after);
  }
  return postcondition;
}

function duplicateCreatedReferenceState(reference, expectedUuid) {
  try {
    if (typeof reference.uuid !== "string" || reference.uuid !== expectedUuid) return "mismatch";
    return "present";
  } catch (error) {
    if (error && error.name === "ReferenceError" && error.number === 45) return "invalid";
    throw error;
  }
}

function duplicateRollback(state) {
  var preflight = state.preflight;
  var createdUuid = state.operationState.createdUuid;
  var createdReference = state.operationState.createdObject;
  if (!preflight || typeof createdUuid !== "string" || !createdReference ||
      app.documents.length === 0 || app.activeDocument !== preflight.document) {
    return { status: "indeterminate", message: "Rollback duplicate identity or document is indeterminate." };
  }
  var created;
  try { created = duplicateFindTarget(preflight.document, createdUuid, duplicateImageBinding(preflight, createdUuid)); }
  catch (error) { return { status: "indeterminate", message: "Rollback duplicate lookup is indeterminate." }; }
  if (created === null) {
    try {
      return duplicateCreatedReferenceState(createdReference, createdUuid) === "invalid"
        ? { status: "indeterminate", message: "Duplicate was absent before rollback restoration could be verified." }
        : { status: "indeterminate", message: "Duplicate UUID absence conflicts with its captured reference." };
    } catch (error) { return { status: "indeterminate", message: "Rollback captured-reference state is indeterminate." }; }
  }
  if (duplicateCreatedReferenceState(createdReference, createdUuid) !== "present" ||
      !duplicateSameParent(created.parent, preflight.parent) ||
      typeof created.locked !== "boolean" || typeof created.hidden !== "boolean" ||
      typeof created.editable !== "boolean") {
    return { status: "indeterminate", message: "Rollback refused because duplicate identity changed." };
  }
  if (created.locked || created.hidden || !created.editable || preflight.parentLayer.locked || !preflight.parentLayer.visible) {
    return { status: "failed", message: "Rollback refused because the captured duplicate is not safely editable." };
  }
  if (preflight.sourceBefore.nestedContext) {
    try {
      var sourceNow = duplicateFindTarget(preflight.document, params.sourceUuid, duplicateImageBinding(preflight, createdUuid));
      if (!sourceNow || !duplicateSameParent(sourceNow.parent, preflight.parent)) throw new Error("Source parent changed.");
      var rollbackGroups = duplicateNestedChain(sourceNow);
      for (var rollbackIndex = 0; rollbackIndex < rollbackGroups.length; rollbackIndex++) duplicateNestedGroup(rollbackGroups[rollbackIndex]);
    } catch (error) { return { status: "indeterminate", message: "Rollback nested ancestry is no longer safely bound." }; }
  }
  var removeThrew = false;
  try { created.remove(); }
  catch (error) { removeThrew = true; }
  var remaining;
  try { remaining = duplicateFindTarget(preflight.document, createdUuid, duplicateImageBinding(preflight, null)); }
  catch (error) { return { status: "indeterminate", message: "Rollback absence verification is indeterminate." }; }
  if (remaining !== null) {
    if (remaining.uuid === createdUuid && duplicateCreatedReferenceState(createdReference, createdUuid) === "present") {
      return { status: "failed", message: removeThrew
        ? "Rollback removal threw before removing the captured duplicate."
        : "Rollback removal did not remove the captured duplicate." };
    }
    return { status: "indeterminate", message: "Rollback UUID resolved to an unexpected object identity." };
  }
  try {
    if (duplicateCreatedReferenceState(createdReference, createdUuid) !== "invalid") {
      return { status: "indeterminate", message: "Rollback UUID is absent but the captured reference remains valid." };
    }
    var source = duplicateFindTarget(preflight.document, params.sourceUuid, duplicateImageBinding(preflight, null));
    if (source === null || source.uuid !== preflight.source.uuid) {
      return { status: "indeterminate", message: "Rollback source identity is indeterminate." };
    }
    var restoredSource = duplicateSnapshot(preflight.document, source, params.sourceUuid);
    var restoredParentOrder = duplicateParentOrder(source.parent);
    if (preflight.sourceBefore.colourContext) restoredSource.colourContext = duplicateColourContext(preflight.document, source, null);
    if (preflight.sourceBefore.nestedContext) restoredSource.nestedContext = stringifyJson(duplicateNestedContext(preflight.document, source, null));
    state.operationState.rollbackEvidence.duplicateUuid = createdUuid;
    state.operationState.rollbackEvidence.restoredSource = restoredSource;
    state.operationState.rollbackEvidence.restoredParentOrder = restoredParentOrder;
    if (!duplicateSnapshotMatches(restoredSource, preflight.sourceBefore) ||
        !mutationSameSequence(restoredParentOrder, preflight.parentOrderBefore)) {
      return { status: "indeterminate", message: "Duplicate is absent but exact source or order restoration is unproved." };
    }
    return { status: "verified" };
  } catch (error) {
    return { status: "indeterminate", message: "Rollback restoration verification is indeterminate." };
  }
}

var duplicateExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionLayers: function (phase, preflight) { return (preflight.sourceBefore.nestedContext || preflight.sourceBefore.colourContext) ? [] : [preflight.parentLayer]; },
  editSessionAffected: function (phase, preflight, plan, state) {
    return (phase === "after") ? [state.operationState.createdUuid] : ((preflight.sourceBefore.nestedContext || preflight.sourceBefore.colourContext) ? [params.sourceUuid] : []);
  },
  initialOperationState: function () {
    return { mutationStarted: false, createdObject: null, createdUuid: null,
      rollbackEvidence: { duplicateUuid: null, restoredSource: null, restoredParentOrder: null } };
  },
  preflight: duplicatePreflight,
  plan: duplicatePlan,
  revalidate: duplicateRevalidate,
  applyMutation: duplicateApply,
  verify: duplicateVerify,
  rollback: duplicateRollback,
  hasMutationEvidence: function (state) {
    return state.operationState.createdObject !== null && state.operationState.createdObject !== undefined;
  },
  applyIndeterminate: function (state) {
    return {
      reasonCode: "identity_unavailable",
      message: "Duplicate apply outcome is indeterminate because created-object identity is unavailable.",
      evidence: state.operationState.rollbackEvidence
    };
  },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var duplicateDocument = duplicateExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === duplicateExecution.preflight.document) {
  duplicateDocument = getDocumentContext();
}
var result = {
  operation: "duplicate_object",
  applied: duplicateExecution.transaction.state === "verified",
  document: duplicateDocument,
  plan: duplicateExecution.plan,
  transaction: duplicateExecution.transaction
};
if (duplicateExecution.transaction.state === "verified") result.postcondition = duplicateExecution.value;
`;
export const DUPLICATE_OBJECT_HOST_SCRIPT_DIGEST = canonicalSha256(DUPLICATE_OBJECT_SCRIPT);
export const DUPLICATE_OBJECT_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2,
    contractVersion: 1,
    operation: DUPLICATE_OBJECT_OPERATION,
    validator: DUPLICATE_OBJECT_VALIDATOR,
    canonicalContractVersion: DUPLICATE_CANONICAL_VERSION,
    resultSchemaVersion: DUPLICATE_RESULT_SCHEMA_VERSION,
    terminalClassifierVersion: DUPLICATE_CLASSIFIER_VERSION,
    safetyConformanceVersion: DUPLICATE_CONFORMANCE_VERSION,
    errorMappingVersion: DUPLICATE_ERROR_MAPPING_VERSION,
    safetyIdentity: DUPLICATE_OBJECT_SAFETY_IDENTITY,
    hostScriptDigest: DUPLICATE_OBJECT_HOST_SCRIPT_DIGEST,
});
function normalizedRequest(input) {
    const request = duplicateObjectInternalInputSchema.parse(input);
    const { nestedHostReady: _profile, ...canonicalRequest } = request;
    const digestRequest = 'commandId' in canonicalRequest
        ? (({ commandId: _commandId, ...rest }) => rest)(canonicalRequest)
        : canonicalRequest;
    const digest = canonicalSha256({
        operation: DUPLICATE_OBJECT_OPERATION,
        validator: DUPLICATE_OBJECT_VALIDATOR,
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
export const duplicateObjectToolContract = {
    name: 'illustrator_duplicate_object',
    title: 'Plan or Duplicate Object',
    description: 'Plan/duplicate one PathItem after its UUID; apply verifies it and rolls back its owned copy. Layer-direct RGB/CMYK. Nested Path: 1-3 plain groups, single-layer RGB, parent 2-8 PathItems. Nested Text: ASCII 1-64 chars, MyriadPro-Regular 12pt RGB, 2 groups, 1 Path sibling. Nested image: 2 groups, unscaled 1-512px, linked .png or embedded RGB. CMYK single layer: Path in 2 groups with CMYK fill, or layer Path with ordinary CMYK-base Spot fill (<=8 PathItems and swatches). RGB/Lab/registration Spot, gradient, pattern, Spot stroke, scene over 32,768 chars (many-point paths) refused.',
    inputSchema: duplicateObjectInputSchema,
    publicInputSchema: duplicateObjectPublicInputSchema,
    outputSchema: duplicateObjectResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(DUPLICATE_OBJECT_SAFETY.policy),
    normalizePublicInput,
};
export function duplicateHostVersionOperation(outcome) {
    const holder = outcome;
    const source = (holder?.request?.expectedBefore ?? holder?.plan?.sourceBefore);
    if (source === undefined || source === null)
        return null;
    return source.type === 'PlacedItem' || source.type === 'RasterItem' || Boolean(source.nestedContext) || Boolean(source.colourContext) ? 'duplicate_object' : null;
}
export function createDuplicateObjectAdapter() {
    return {
        version: 1,
        operation: DUPLICATE_OBJECT_OPERATION,
        validator: DUPLICATE_OBJECT_VALIDATOR,
        safety: DUPLICATE_OBJECT_SAFETY,
        safetyRegistrationIdentity: DUPLICATE_OBJECT_SAFETY_IDENTITY,
        adapterIdentity: DUPLICATE_OBJECT_ADAPTER_IDENTITY,
        tool: duplicateObjectToolContract,
        canonical: {
            version: DUPLICATE_CANONICAL_VERSION,
            normalize: normalizedRequest,
            safetyDigest: (input) => normalizedRequest(input).digest,
        },
        resultSchema: duplicateObjectResultSchema,
        resultSchemaVersion: DUPLICATE_RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: DUPLICATE_CLASSIFIER_VERSION,
        safetyConformanceVersion: DUPLICATE_CONFORMANCE_VERSION,
        errorMappingVersion: DUPLICATE_ERROR_MAPPING_VERSION,
        hostScriptDigest: DUPLICATE_OBJECT_HOST_SCRIPT_DIGEST,
        hostVersionOperation: (outcome) => duplicateHostVersionOperation(outcome),
        async admit(input, services) {
            const request = duplicateObjectInternalInputSchema.parse(input);
            if (request.apply && !request.expectedBefore.nestedContext && !('colourContext' in request.expectedBefore && request.expectedBefore.colourContext))
                return { ...request, nestedHostReady: false };
            const profile = await new OsascriptHostProfileProbe(services.applicationBundleId ?? undefined).observeForEditSession();
            return { ...request, nestedHostReady: profile.profile === 'foreground' && profile.lockState === 'unlocked' };
        },
        async beforeHost(input, services) {
            const request = duplicateObjectInternalInputSchema.parse(input);
            if (!request.apply || (!request.expectedBefore.nestedContext && !('colourContext' in request.expectedBefore && request.expectedBefore.colourContext)))
                return;
            const profile = await new OsascriptHostProfileProbe(services.applicationBundleId ?? undefined).observeForEditSession();
            if (profile.profile !== 'foreground' || profile.lockState !== 'unlocked') {
                throw new Error('Measured duplicate requires foreground/unlocked Host state.');
            }
        },
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: DUPLICATE_OBJECT_SCRIPT, params };
            return {
                kind: 'mutation',
                mutationValidator: DUPLICATE_OBJECT_VALIDATOR,
                idempotency: {
                    commandId: normalized.commandId,
                    operation: DUPLICATE_OBJECT_OPERATION,
                    documentKey: normalized.documentKey,
                    requestDigest: normalized.digest,
                },
                adapterIdentity: DUPLICATE_OBJECT_ADAPTER_IDENTITY,
                script: DUPLICATE_OBJECT_SCRIPT,
                params,
            };
        },
        classifyTerminal(value) {
            const state = duplicateObjectResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back' || state === 'rollback_failed') {
                return { state };
            }
            if (state === 'planned')
                throw new Error('Duplicate plan is not a terminal mutation result.');
            throw new Error('Unverified duplicate identity or recovery must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertDuplicateSafetyConformance,
        mapExecutionError(error, detail) {
            if (detail?.code === 'OBJECT_NOT_FOUND') {
                return new Error(`No PageItem with UUID ${JSON.stringify(detail.uuid ?? '')} exists in the bound document.`);
            }
            if (detail?.code === 'DUPLICATE_APPLY_BLOCKED') {
                return new Error(`Duplicate apply is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}.`);
            }
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
