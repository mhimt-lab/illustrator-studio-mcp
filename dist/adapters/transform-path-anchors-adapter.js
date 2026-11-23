import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { duplicateObjectSnapshotShape } from './duplicate-object-adapter.js';
import { SUPPORTED_PATH_ITEM_HOST_SCRIPT, supportedPathCmykPaintSchema } from './supported-path-item-host-script.js';
import { PATH_EDIT_COORDINATE_LIMIT, PATH_EDIT_MAX_POINTS, PATH_POINTS_READ_MODULE_SCRIPT, pathEditErrorMessage, pathGeometrySchema, pathTargetSnapshotSchema, pathXYSchema, sameCanonical, samePathTarget, } from '../path-points.js';
export const TRANSFORM_PATH_ANCHORS_OPERATION = 'transform_path_anchors';
export const TRANSFORM_PATH_ANCHORS_VALIDATOR = { kind: TRANSFORM_PATH_ANCHORS_OPERATION, version: 1 };
export const ANCHOR_SCALE_MIN = 0.25;
export const ANCHOR_SCALE_MAX = 4;
export const TRANSFORM_ADMIT = Object.freeze({ cmykPaint: true, maxTags: 0 });
const CANONICAL_VERSION = 1;
const RESULT_SCHEMA_VERSION = 1;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
const uuidSchema = z.string().min(1).max(255);
const documentKeySchema = z.string().min(1).max(16_384);
const pointIndexSchema = z.number().int().min(0).max(PATH_EDIT_MAX_POINTS - 1);
const round6 = (value) => { const rounded = Math.round(value * 1_000_000) / 1_000_000; return Object.is(rounded, -0) ? 0 : rounded; };
const coordinateSchema = z.number().finite().min(-PATH_EDIT_COORDINATE_LIMIT).max(PATH_EDIT_COORDINATE_LIMIT).overwrite(round6);
const scaleSchema = z.number().finite().min(ANCHOR_SCALE_MIN).max(ANCHOR_SCALE_MAX);
const rangeSchema = z.tuple([coordinateSchema, coordinateSchema]).superRefine(([low, high], context) => {
    if (low > high)
        context.addIssue({ code: 'custom', message: 'A range must be [min, max] with min <= max.' });
});
const uniqueIndices = (indices, context) => {
    if (new Set(indices).size !== indices.length)
        context.addIssue({ code: 'custom', message: 'indices must be distinct.' });
};
const indicesSchema = z.array(pointIndexSchema).min(1).max(PATH_EDIT_MAX_POINTS).superRefine(uniqueIndices);
export const anchorSelectionSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('indices'), indices: indicesSchema }),
    z.strictObject({ kind: z.literal('y_range'), range: rangeSchema }),
    z.strictObject({ kind: z.literal('x_range'), range: rangeSchema }),
]);
export const anchorOriginSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('point'), point: pathXYSchema }),
    z.strictObject({ kind: z.literal('anchor'), pointIndex: pointIndexSchema }),
]);
export const anchorTransformSchema = z.strictObject({ selection: anchorSelectionSchema, scaleX: scaleSchema, scaleY: scaleSchema, origin: anchorOriginSchema });
export function resolveAnchorTransform(before, transform) {
    const count = before.points.length;
    let selected;
    if (transform.selection.kind === 'indices') {
        selected = [...transform.selection.indices].sort((a, b) => a - b);
        if (selected.some((index) => index >= count))
            throw new Error('A selected point index is outside the target path.');
    }
    else {
        const [low, high] = transform.selection.range;
        const axis = transform.selection.kind === 'y_range' ? 1 : 0;
        selected = [];
        before.points.forEach((point, index) => { if (point.anchor[axis] >= low && point.anchor[axis] <= high)
            selected.push(index); });
    }
    if (selected.length === 0)
        throw new Error('The selection matches no anchor of the target path.');
    let origin;
    if (transform.origin.kind === 'point')
        origin = [transform.origin.point[0], transform.origin.point[1]];
    else {
        const point = before.points[transform.origin.pointIndex];
        if (point === undefined)
            throw new Error('The origin anchor index is outside the target path.');
        origin = [point.anchor[0], point.anchor[1]];
    }
    return { selected, origin };
}
export function deriveAnchorTransform(before, transform) {
    const { selected, origin } = resolveAnchorTransform(before, transform);
    const chosen = new Set(selected);
    const map = (value) => {
        const result = [round6(origin[0] + transform.scaleX * (value[0] - origin[0])), round6(origin[1] + transform.scaleY * (value[1] - origin[1]))];
        if (Math.abs(result[0]) > PATH_EDIT_COORDINATE_LIMIT || Math.abs(result[1]) > PATH_EDIT_COORDINATE_LIMIT)
            throw new Error('A transformed coordinate is outside the supported coordinate range.');
        return result;
    };
    let changed = false;
    const points = before.points.map((point, index) => {
        const copy = { anchor: [point.anchor[0], point.anchor[1]], leftDirection: [point.leftDirection[0], point.leftDirection[1]],
            rightDirection: [point.rightDirection[0], point.rightDirection[1]], pointType: point.pointType };
        if (!chosen.has(index))
            return copy;
        const moved = { anchor: map(point.anchor), leftDirection: map(point.leftDirection), rightDirection: map(point.rightDirection), pointType: point.pointType };
        if (!sameCanonical(moved, copy))
            changed = true;
        return moved;
    });
    if (!changed)
        throw new Error('The requested transform does not change the path.');
    return { path: { closed: before.closed, points }, selected, origin };
}
const rgbPaintSchema = duplicateObjectSnapshotShape.fillColor.unwrap();
const strokePaintSchema = z.union([rgbPaintSchema, supportedPathCmykPaintSchema]);
const spotPaintSchema = z.strictObject({ type: z.literal('SpotColor'), tint: z.number().finite().min(0).max(100), spotIndex: z.number().int().min(0).max(100_000) });
const fillPaintSchema = z.union([strokePaintSchema, spotPaintSchema]);
const pathAnchorStateSchema = z.strictObject({
    filled: duplicateObjectSnapshotShape.filled,
    fillColor: fillPaintSchema.nullable(),
    fillOverprint: duplicateObjectSnapshotShape.fillOverprint,
    stroked: duplicateObjectSnapshotShape.stroked,
    strokeColor: strokePaintSchema.nullable(),
    strokeWidth: duplicateObjectSnapshotShape.strokeWidth,
    strokeOverprint: duplicateObjectSnapshotShape.strokeOverprint,
    strokeDashes: duplicateObjectSnapshotShape.strokeDashes,
    strokeDashOffset: duplicateObjectSnapshotShape.strokeDashOffset,
    strokeCap: duplicateObjectSnapshotShape.strokeCap,
    strokeJoin: duplicateObjectSnapshotShape.strokeJoin,
    strokeMiterLimit: duplicateObjectSnapshotShape.strokeMiterLimit,
    evenodd: duplicateObjectSnapshotShape.evenodd,
    polarity: z.enum(['PolarityValues.POSITIVE', 'PolarityValues.NEGATIVE']),
    resolution: duplicateObjectSnapshotShape.resolution,
    artworkKnockout: duplicateObjectSnapshotShape.artworkKnockout,
    blendingMode: duplicateObjectSnapshotShape.blendingMode,
    opacity: duplicateObjectSnapshotShape.opacity,
    pixelAligned: duplicateObjectSnapshotShape.pixelAligned,
    tagCount: z.number().int().min(0).max(1),
});
const anchorStateTextSchema = z.string().min(2).max(8192).superRefine((text, context) => {
    let value;
    try {
        value = JSON.parse(text);
    }
    catch {
        context.addIssue({ code: 'custom', message: 'state must be canonical JSON.' });
        return;
    }
    if (!pathAnchorStateSchema.safeParse(value).success)
        context.addIssue({ code: 'custom', message: 'state does not match the paint and structure schema.' });
}).describe('Canonical JSON of the paint and structure values the transform must not change (fill, stroke, overprint, dashes, caps, polarity, knockout, blend, opacity, tag count); identical before and after.');
export const anchorTransformSnapshotSchema = pathTargetSnapshotSchema.extend({ state: anchorStateTextSchema });
export function anchorTransformState(snapshot) {
    return pathAnchorStateSchema.parse(JSON.parse(snapshot.state));
}
const blockerSchema = z.enum(['document_mutation_not_allowed', 'target_locked', 'target_hidden', 'target_not_editable', 'layer_hidden', 'layer_locked']);
export function anchorTransformBlockers(mutationAllowed, before) {
    const blockers = [];
    if (!mutationAllowed)
        blockers.push('document_mutation_not_allowed');
    const initial = blockers.length;
    if (before.locked)
        blockers.push('target_locked');
    if (before.hidden)
        blockers.push('target_hidden');
    if (!before.effectiveLayerVisible)
        blockers.push('layer_hidden');
    if (before.effectiveLayerLocked)
        blockers.push('layer_locked');
    if (!before.editable && blockers.length === initial)
        blockers.push('target_not_editable');
    return blockers;
}
const commonInternal = { expectedDocumentKey: documentKeySchema, targetUuid: uuidSchema, expectedPath: pathGeometrySchema, transform: anchorTransformSchema };
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({ ...commonInternal, confirmedAfter: pathGeometrySchema, apply: z.literal(true), commandId: canonicalCommandIdSchema }),
]);
const publicPointSchema = pathXYSchema.describe('[x, y] in points, Illustrator document coordinates (as geometricBounds; y up).');
const publicIndexSchema = pointIndexSchema.describe('Zero-based index into expected_path.points.');
const publicAnchorsSchema = z.union([
    z.strictObject({ indices: indicesSchema.describe('Distinct point indices.') }),
    z.strictObject({ y_range: rangeSchema.describe('[min, max] inclusive on each anchor y.') }),
    z.strictObject({ x_range: rangeSchema.describe('[min, max] inclusive on each anchor x.') }),
]).describe('Which anchors to scale: exactly one of indices, y_range, x_range.');
const publicOriginSchema = z.union([
    z.strictObject({ point: publicPointSchema }),
    z.strictObject({ anchor_index: publicIndexSchema }),
]).describe('Fixed reference point: an explicit [x, y] or an anchor index.');
const commonPublic = {
    expected_document_key: documentKeySchema,
    target_uuid: uuidSchema.describe('Native PageItem.uuid of the target PathItem.'),
    expected_path: pathGeometrySchema.describe('The path exactly as illustrator_get_path_points returned it; any difference beyond 0.01 pt is refused.'),
    anchors: publicAnchorsSchema,
    scale_x: scaleSchema.describe(`Horizontal factor, ${ANCHOR_SCALE_MIN} to ${ANCHOR_SCALE_MAX}.`),
    scale_y: scaleSchema.describe(`Vertical factor, ${ANCHOR_SCALE_MIN} to ${ANCHOR_SCALE_MAX}.`),
    origin: publicOriginSchema,
};
export const transformPathAnchorsPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({ ...commonPublic, confirmed_after: pathGeometrySchema.describe('plan.after.path from the apply:false plan.'), apply: z.literal(true), command_id: applyCommandIdSchema }),
]);
const inputSchema = z.strictObject({ ...commonPublic, confirmed_after: pathGeometrySchema.optional(), apply: z.boolean().default(false), command_id: applyCommandIdSchema.optional() });
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(transformPathAnchorsPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizeTransform(value) {
    const anchors = value.anchors;
    const selection = 'indices' in anchors ? { kind: 'indices', indices: [...anchors.indices].sort((a, b) => a - b) }
        : 'y_range' in anchors ? { kind: 'y_range', range: anchors.y_range } : { kind: 'x_range', range: anchors.x_range };
    const origin = 'point' in value.origin ? { kind: 'point', point: value.origin.point } : { kind: 'anchor', pointIndex: value.origin.anchor_index };
    return { selection, scaleX: value.scale_x, scaleY: value.scale_y, origin };
}
function normalizePublicInput(input) {
    const value = transformPathAnchorsPublicInputSchema.parse(input);
    const common = { expectedDocumentKey: value.expected_document_key, targetUuid: value.target_uuid, expectedPath: value.expected_path, transform: normalizeTransform(value) };
    return value.apply ? { ...common, confirmedAfter: value.confirmed_after, apply: true, commandId: value.command_id } : { ...common, apply: false };
}
const resolvedSchema = z.strictObject({ selectedIndices: z.array(pointIndexSchema).min(1).max(PATH_EDIT_MAX_POINTS), origin: pathXYSchema });
const planSchema = z.strictObject({
    operation: z.literal(TRANSFORM_PATH_ANCHORS_OPERATION),
    documentKey: documentKeySchema,
    targetUuid: uuidSchema,
    transform: anchorTransformSchema,
    resolved: resolvedSchema,
    before: anchorTransformSnapshotSchema,
    after: anchorTransformSnapshotSchema,
    applyBlockedReasonCodes: z.array(blockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    if (plan.before.uuid !== plan.targetUuid)
        context.addIssue({ code: 'custom', message: 'Anchor transform plan must bind the target UUID.' });
    let derived = null;
    try {
        derived = deriveAnchorTransform(plan.before.path, plan.transform);
    }
    catch {
        derived = null;
    }
    if (derived === null || !sameCanonical({ ...plan.before, path: derived.path }, plan.after) ||
        !sameCanonical(plan.resolved, { selectedIndices: derived.selected, origin: derived.origin })) {
        context.addIssue({ code: 'custom', message: 'Anchor transform plan after state must be derived from the before path and the transform.' });
    }
    if (plan.applyAllowed !== (plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0)) {
        context.addIssue({ code: 'custom', message: 'Anchor transform applyAllowed must require confirmation and no blockers.' });
    }
});
const failureSchema = z.strictObject({ phase: z.enum(['apply', 'verify']), reasonCode: z.enum(['apply_failed', 'verify_mismatch']), message: z.string().min(1).max(500) })
    .superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed'))
        context.addIssue({ code: 'custom', message: 'Anchor transform failure phase and reason code must match.' });
});
const indeterminateFailureSchema = z.strictObject({ phase: z.literal('apply'), reasonCode: z.literal('apply_indeterminate'), message: z.string().min(1).max(500) });
const rollbackEvidence = { restoredState: anchorTransformSnapshotSchema.nullable() };
const transactionSchema = z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('planned'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('verified'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('apply_failed'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('not_required') }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('rolled_back'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('verified'), ...rollbackEvidence }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('rollback_failed'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('failed'), reasonCode: z.literal('rollback_failed'), message: z.string().min(1).max(500), ...rollbackEvidence }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('apply_indeterminate'), failure: indeterminateFailureSchema, rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('anchor_transform_unknown'), message: z.string().min(1).max(500), restoredState: z.null() }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('rollback_indeterminate'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('rollback_indeterminate'), message: z.string().min(1).max(500), ...rollbackEvidence }), audit: mutationAuditSchema }),
]).superRefine((transaction, context) => {
    const prefix = ['preflight:started:', 'preflight:succeeded:', 'plan:started:', 'plan:succeeded:'];
    let expected;
    if (transaction.state === 'planned')
        expected = [...prefix, 'apply:skipped:not_requested', 'verify:skipped:not_requested', 'rollback:skipped:not_requested'];
    else if (transaction.state === 'verified')
        expected = [...prefix, 'apply:started:', 'apply:attempted:', 'apply:succeeded:', 'verify:started:', 'verify:succeeded:', 'rollback:skipped:not_required'];
    else if (transaction.state === 'apply_failed')
        expected = [...prefix, 'apply:started:', 'apply:failed:apply_failed', 'verify:skipped:not_required', 'rollback:skipped:not_required'];
    else if (transaction.state === 'apply_indeterminate')
        expected = [...prefix, 'apply:started:', 'apply:attempted:', 'apply:failed:apply_indeterminate'];
    else {
        const failure = transaction.failure.phase === 'apply'
            ? ['apply:started:', 'apply:attempted:', 'apply:failed:apply_failed', 'verify:skipped:not_required']
            : ['apply:started:', 'apply:attempted:', 'apply:succeeded:', 'verify:started:', 'verify:failed:verify_mismatch'];
        expected = [...prefix, ...failure, 'rollback:started:', transaction.state === 'rolled_back' ? 'rollback:succeeded:' : `rollback:failed:${transaction.state === 'rollback_failed' ? 'rollback_failed' : 'rollback_indeterminate'}`];
    }
    const actual = transaction.audit.map((event) => `${event.phase}:${event.event}:${'reasonCode' in event ? event.reasonCode : ''}`);
    if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index]))
        context.addIssue({ code: 'custom', message: 'Anchor transform audit sequence does not match transaction state.' });
    transaction.audit.forEach((event, index) => { if (event.sequence !== index)
        context.addIssue({ code: 'custom', message: 'Anchor transform audit sequence must be contiguous.' }); });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' && event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode && event.message === transaction.failure.message);
        if (matches.length !== 1)
            context.addIssue({ code: 'custom', message: 'Anchor transform failure must match one audit event.' });
    }
    if (transaction.state === 'rolled_back' && transaction.rollback.restoredState === null)
        context.addIssue({ code: 'custom', message: 'A rolled-back anchor transform must carry the restored snapshot.' });
    if (transaction.state === 'rollback_failed' && transaction.rollback.restoredState === null)
        context.addIssue({ code: 'custom', message: 'A failed anchor transform rollback must report the snapshot it observed.' });
});
const postconditionSchema = z.strictObject({ state: anchorTransformSnapshotSchema, saved: z.boolean() });
export const transformPathAnchorsResultSchema = z.union([
    z.strictObject({ operation: z.literal(TRANSFORM_PATH_ANCHORS_OPERATION), applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ operation: z.literal(TRANSFORM_PATH_ANCHORS_OPERATION), applied: z.literal(true), document: documentContextSchema, plan: planSchema, postcondition: postconditionSchema, transaction: transactionSchema }),
]).superRefine((result, context) => {
    if (result.transaction.state === 'planned') {
        if (result.plan.confirmationStatus !== 'required' || !sameCanonical(result.plan.applyBlockedReasonCodes, anchorTransformBlockers(result.document.mutationAllowed, result.plan.before))) {
            context.addIssue({ code: 'custom', message: 'Planned anchor transform must expose exact blockers.' });
        }
    }
    else if (result.plan.confirmationStatus !== 'confirmed' || result.plan.applyBlockedReasonCodes.length !== 0 || !result.plan.applyAllowed ||
        anchorTransformBlockers(true, result.plan.before).length !== 0) {
        context.addIssue({ code: 'custom', message: 'Applied anchor transform attempt must derive from an allowed confirmed plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified' || !samePathTarget(result.postcondition.state, result.plan.after)) {
            context.addIssue({ code: 'custom', message: 'Verified anchor transform must match the planned after state.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified anchor transform transaction must be applied.' });
    }
    if (result.transaction.state === 'rolled_back' && !samePathTarget(result.transaction.rollback.restoredState, result.plan.before)) {
        context.addIssue({ code: 'custom', message: 'Rolled-back anchor transform must prove the exact before snapshot.' });
    }
});
export const transformPathAnchorsResponseSchema = z.strictObject({
    outcome: transformPathAnchorsResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
export const TRANSFORM_PATH_ANCHORS_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: TRANSFORM_PATH_ANCHORS_OPERATION,
    policy: {
        version: 1, class: 'update_existing', destructive: false,
        evidence: { identity: 'target_native_uuid', beforeState: 'before_state_hash', postcondition: 'updated_state_matches_plan' },
        preconditions: { documentBinding: 'explicit_document_key', compareAndSet: 'before_state_hash_match' },
        confirmation: 'exact_change_set',
        recovery: { mode: 'verified_inverse', verification: 'restored_state_matches_before_hash', partialRecovery: 'indeterminate' },
        terminal: { success: 'verified', failure: 'proven_pre_apply_or_verified_recovery', partialSuccess: 'nonterminal_until_reconciled' },
        replay: { requestBinding: 'canonical_request_digest', retry: 'return_attested_terminal_result', beforeTerminal: 'reconcile_required', reapplyOnRetry: false },
    },
    capabilities: {
        class: 'update_existing', explicitDocumentBinding: true, bindTargetNativeUuid: true, captureBeforeStateHash: true, compareAndSetBeforeApply: true,
        verifyUpdatedState: true, recoveryMode: 'verified_inverse', verifyRestoredBeforeState: true, reconcileIndeterminate: true, durableTerminalReplay: true, trustedTerminalAttestationResolver: true,
    },
});
export const TRANSFORM_PATH_ANCHORS_SAFETY_IDENTITY = canonicalDigest(TRANSFORM_PATH_ANCHORS_SAFETY);
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    const beforeStateHash = canonicalDigest(result.plan.before);
    const afterStateHash = canonicalDigest(result.plan.after);
    const changeSetHash = canonicalDigest({ targetUuid: result.plan.targetUuid, transform: result.plan.transform, beforeStateHash, afterStateHash });
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'update_existing', operationId: TRANSFORM_PATH_ANCHORS_OPERATION, canonicalRequestDigest: requestDigest,
        evidence: { documentKey: admissionDocumentKey, targetUuid: result.plan.targetUuid, beforeStateHash, plannedAfterStateHash: afterStateHash, plannedChangeSetDigest: changeSetHash },
        preconditions: { status: result.plan.applyBlockedReasonCodes.length === 0 ? 'satisfied' : 'blocked', compareAndSetMatched: result.plan.applyBlockedReasonCodes.length === 0 },
        confirmation: { kind: 'exact_change_set', canonicalRequestDigest: requestDigest, changeSetHash, status: result.plan.confirmationStatus },
        applyAllowed: result.plan.applyAllowed,
    });
}
function safetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' || transaction.state === 'rollback_indeterminate' || transaction.state === 'rollback_failed') {
        throw new Error('Indeterminate or failed anchor transform recovery cannot be terminal.');
    }
    const common = { policyVersion: 1, operationClass: 'update_existing', operationId: TRANSFORM_PATH_ANCHORS_OPERATION, canonicalRequestDigest: requestDigest, planDigest: plan.planDigest, attestation };
    const boundPlan = plan;
    const beforeStateHash = boundPlan.evidence.beforeStateHash;
    const evidence = { targetUuid: result.plan.targetUuid };
    if (transaction.state === 'verified' && result.applied) {
        return operationSafetyResultSchema.parse({ ...common, evidence: { ...evidence, beforeStateHash, afterStateHash: boundPlan.evidence.plannedAfterStateHash, restoredStateHash: null, restoredBeforeStateVerified: false },
            executionEvidence: { outcome: 'completed' }, resolution: { status: 'succeeded', terminal: true, recovery: 'not_required', proof: { kind: 'verified_postcondition' }, replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    if (transaction.state === 'rolled_back') {
        return operationSafetyResultSchema.parse({ ...common, evidence: { ...evidence, beforeStateHash, afterStateHash: null, restoredStateHash: beforeStateHash, restoredBeforeStateVerified: true },
            executionEvidence: { outcome: 'completed' }, resolution: { status: 'recovered', terminal: true, recovery: 'verified', proof: { kind: 'verified_recovery' }, replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    return operationSafetyResultSchema.parse({ ...common, evidence: { ...evidence, beforeStateHash, afterStateHash: null, restoredStateHash: null, restoredBeforeStateVerified: false },
        executionEvidence: { outcome: 'proven_pre_apply' }, resolution: { status: 'failed', terminal: true, recovery: 'not_required', proof: { kind: 'proven_pre_apply', mutationAttempted: false }, replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
}
async function assertSafety(value, requestDigest, attestation, resolver) {
    const result = transformPathAnchorsResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null)
        throw new Error('Anchor transform terminal result requires attestation.');
    await assertOperationSafetyAdapterConformance({ registration: TRANSFORM_PATH_ANCHORS_SAFETY, plan, result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
const ANCHOR_MODULE_SCRIPT = (admit) => `
var ANCHOR_SCALE_MIN = ${ANCHOR_SCALE_MIN};
var ANCHOR_SCALE_MAX = ${ANCHOR_SCALE_MAX};
var ANCHOR_ADMIT_CMYK_PAINT = ${admit.cmykPaint ? 'true' : 'false'};
var ANCHOR_ADMIT_MAX_TAGS = ${admit.maxTags};

function anchorRound(value) { var rounded = Math.round(value * 1000000) / 1000000; return rounded === 0 ? 0 : rounded; }
function anchorCopyPoint(point) {
  return { anchor: [point.anchor[0], point.anchor[1]], leftDirection: [point.leftDirection[0], point.leftDirection[1]],
    rightDirection: [point.rightDirection[0], point.rightDirection[1]], pointType: point.pointType };
}
function anchorIndex(value, count, label) {
  if (typeof value !== "number" || value % 1 !== 0 || value < 0 || value >= count) throw mutationError("preflight_failed", label + " is outside the target path.");
  return value;
}
function anchorResolve(before, transform) {
  var count = before.points.length;
  if (!transform || !transform.selection || !transform.origin) throw mutationError("preflight_failed", "transform is required.");
  var scaleX = transform.scaleX, scaleY = transform.scaleY;
  if (typeof scaleX !== "number" || typeof scaleY !== "number" || !(scaleX >= ANCHOR_SCALE_MIN && scaleX <= ANCHOR_SCALE_MAX) ||
      !(scaleY >= ANCHOR_SCALE_MIN && scaleY <= ANCHOR_SCALE_MAX)) throw mutationError("preflight_failed", "scale_x and scale_y must be within the measured range.");
  var selected = [], index, seen = {};
  var selection = transform.selection;
  if (selection.kind === "indices") {
    for (index = 0; index < selection.indices.length; index++) {
      var at = anchorIndex(selection.indices[index], count, "A selected point index");
      if (seen[at]) throw mutationError("preflight_failed", "indices must be distinct.");
      seen[at] = true; selected.push(at);
    }
    selected.sort(function (a, b) { return a - b; });
  } else if (selection.kind === "y_range" || selection.kind === "x_range") {
    var axis = selection.kind === "y_range" ? 1 : 0;
    for (index = 0; index < count; index++) {
      var value = before.points[index].anchor[axis];
      if (value >= selection.range[0] && value <= selection.range[1]) selected.push(index);
    }
  } else {
    throw mutationError("preflight_failed", "Unsupported anchor selection.");
  }
  if (selected.length === 0) throw mutationError("preflight_failed", "The selection matches no anchor of the target path.");
  var origin;
  if (transform.origin.kind === "point") origin = pathEditPoint(transform.origin.point, "origin");
  else if (transform.origin.kind === "anchor") { var base = before.points[anchorIndex(transform.origin.pointIndex, count, "The origin anchor index")].anchor; origin = [base[0], base[1]]; }
  else throw mutationError("preflight_failed", "Unsupported anchor origin.");
  return { selected: selected, origin: origin, scaleX: scaleX, scaleY: scaleY };
}
function anchorMap(value, resolved) {
  var x = anchorRound(resolved.origin[0] + resolved.scaleX * (value[0] - resolved.origin[0]));
  var y = anchorRound(resolved.origin[1] + resolved.scaleY * (value[1] - resolved.origin[1]));
  if (Math.abs(x) > PATH_EDIT_COORDINATE_LIMIT || Math.abs(y) > PATH_EDIT_COORDINATE_LIMIT) throw mutationError("preflight_failed", "A transformed coordinate is outside the supported coordinate range.");
  return [x, y];
}
function anchorDerive(before, transform) {
  var resolved = anchorResolve(before, transform);
  var chosen = {}, index;
  for (index = 0; index < resolved.selected.length; index++) chosen[resolved.selected[index]] = true;
  var points = [], changed = false;
  for (index = 0; index < before.points.length; index++) {
    var copy = anchorCopyPoint(before.points[index]);
    if (chosen[index]) {
      var moved = { anchor: anchorMap(copy.anchor, resolved), leftDirection: anchorMap(copy.leftDirection, resolved), rightDirection: anchorMap(copy.rightDirection, resolved), pointType: copy.pointType };
      if (moved.anchor[0] !== copy.anchor[0] || moved.anchor[1] !== copy.anchor[1] || moved.leftDirection[0] !== copy.leftDirection[0] || moved.leftDirection[1] !== copy.leftDirection[1] ||
          moved.rightDirection[0] !== copy.rightDirection[0] || moved.rightDirection[1] !== copy.rightDirection[1]) changed = true;
      copy = moved;
    }
    points.push(copy);
  }
  if (!changed) throw mutationError("preflight_failed", "The requested transform does not change the path.");
  return { path: { closed: before.closed, points: points }, selected: resolved.selected, origin: resolved.origin };
}

/** What the transform admits beyond RGB: a spot fill by tint and spot-list index, NEGATIVE polarity, and (once measured) CMYK paint and tags, in a CMYK document. */
function anchorPaintScope(document) {
  var cmykDocument = false;
  try { cmykDocument = document.documentColorSpace === DocumentColorSpace.CMYK; } catch (spaceError) { cmykDocument = false; }
  return {
    cmykAdmitted: function () { return ANCHOR_ADMIT_CMYK_PAINT && cmykDocument; },
    cmykRefusal: ANCHOR_ADMIT_CMYK_PAINT ? "is CMYKColor; the anchor transform supports CMYK paint only in a CMYK document." : "is CMYKColor; the anchor transform does not support CMYK paint.",
    spotFillIndex: function (value) {
      if (!cmykDocument) throw mutationError("preflight_failed", "fillColor is a spot color; the anchor transform supports a spot fill only in a CMYK document.");
      var spots = document.spots; var found = -1; var matches = 0; var wanted;
      try { wanted = String(value.spot.name); } catch (spotError) { throw mutationError("preflight_failed", "fillColor spot is unreadable."); }
      for (var i = 0; i < spots.length; i++) if (String(spots[i].name) === wanted) { found = i; matches++; }
      if (matches !== 1) throw mutationError("preflight_failed", "fillColor spot is not listed exactly once in the document.");
      return found;
    },
    stateAdmit: { maxTags: cmykDocument ? ANCHOR_ADMIT_MAX_TAGS : 0, negativePolarity: cmykDocument }
  };
}
/** The paint and structure values that a point write must not change (read through the shared paint and state helpers). */
function anchorState(document, target) {
  var paint = anchorPaintScope(document);
  if (typeof target.filled !== "boolean" || typeof target.stroked !== "boolean") throw mutationError("preflight_failed", "Target appearance state is unavailable.");
  var strokeDashes = [];
  if (!target.strokeDashes || target.strokeDashes.length > 32) throw mutationError("preflight_failed", "Target stroke dash state is unavailable or too large.");
  for (var dashIndex = 0; dashIndex < target.strokeDashes.length; dashIndex++) strokeDashes.push(supportedPathNumber(target.strokeDashes[dashIndex], "strokeDashes[" + dashIndex + "]"));
  var visibilityVariable;
  try { visibilityVariable = target.visibilityVariable; }
  catch (variableError) { throw mutationError("preflight_failed", "Target visibility variable state is unreadable."); }
  var refusals = supportedPathStateRefusals(target, visibilityVariable, true, paint.stateAdmit);
  if (refusals.length > 0) throw mutationError("preflight_failed", "Target uses an unsupported structural or appearance state (" + refusals.join(", ") + ").");
  var strokeCap = String(target.strokeCap), strokeJoin = String(target.strokeJoin);
  if ((strokeCap !== "StrokeCap.BUTTENDCAP" && strokeCap !== "StrokeCap.ROUNDENDCAP" && strokeCap !== "StrokeCap.PROJECTINGENDCAP") ||
      (strokeJoin !== "StrokeJoin.BEVELENDJOIN" && strokeJoin !== "StrokeJoin.ROUNDENDJOIN" && strokeJoin !== "StrokeJoin.MITERENDJOIN")) {
    throw mutationError("preflight_failed", "Target stroke cap or join is unsupported.");
  }
  return {
    filled: target.filled,
    fillColor: target.filled ? supportedPathPaint(target.fillColor, "fillColor", paint) : null,
    fillOverprint: Boolean(target.fillOverprint),
    stroked: target.stroked,
    strokeColor: target.stroked ? supportedPathPaint(target.strokeColor, "strokeColor", paint) : null,
    strokeWidth: target.stroked ? supportedPathNumber(target.strokeWidth, "strokeWidth") : null,
    strokeOverprint: Boolean(target.strokeOverprint),
    strokeDashes: strokeDashes,
    strokeDashOffset: supportedPathNumber(target.strokeDashOffset, "strokeDashOffset"),
    strokeCap: strokeCap,
    strokeJoin: strokeJoin,
    strokeMiterLimit: supportedPathNumber(target.strokeMiterLimit, "strokeMiterLimit"),
    evenodd: Boolean(target.evenodd),
    polarity: String(target.polarity),
    resolution: supportedPathNumber(target.resolution, "resolution"),
    artworkKnockout: String(target.artworkKnockout),
    blendingMode: String(target.blendingMode),
    opacity: supportedPathNumber(target.opacity, "opacity"),
    pixelAligned: Boolean(target.pixelAligned),
    tagCount: target.tags.length
  };
}
function anchorSnapshot(document, target, uuid) {
  var snapshot = pathEditSnapshot(document, target, uuid);
  snapshot.state = stringifyJson(supportedPathSorted(anchorState(document, target)));
  return snapshot;
}
function anchorSameTarget(left, right) { return pathEditSameTarget(left, right) && left.state === right.state; }
function anchorBlockers(context, before) {
  var blockers = [];
  if (!context.mutationAllowed) blockers.push("document_mutation_not_allowed");
  var initial = blockers.length;
  if (before.locked) blockers.push("target_locked");
  if (before.hidden) blockers.push("target_hidden");
  if (!before.effectiveLayerVisible) blockers.push("layer_hidden");
  if (before.effectiveLayerLocked) blockers.push("layer_locked");
  if (!before.editable && blockers.length === initial) blockers.push("target_not_editable");
  return blockers;
}
function anchorWithPath(snapshot, path) {
  var copy = {};
  for (var key in snapshot) if (snapshot.hasOwnProperty(key)) copy[key] = snapshot[key];
  copy.path = path;
  return copy;
}
/** The measured write order: anchor, leftDirection, rightDirection. The same order restores the written points (the verified inverse). */
function anchorWritePoints(target, path, indices) {
  for (var at = 0; at < indices.length; at++) {
    var index = indices[at], point = target.pathPoints[index], value = path.points[index];
    point.anchor = [value.anchor[0], value.anchor[1]];
    point.leftDirection = [value.leftDirection[0], value.leftDirection[1]];
    point.rightDirection = [value.rightDirection[0], value.rightDirection[1]];
  }
}
`;
const ANCHOR_TRANSACTION_SCRIPT = `
function anchorPreflight(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  var target = pathEditResolveTarget(document, params.targetUuid);
  var before = anchorSnapshot(document, target, params.targetUuid);
  if (!pathEditSameGeometry(before.path, params.expectedPath)) pathEditFailTarget("PATH_FINGERPRINT_MISMATCH", params.targetUuid);
  var derived = anchorDerive(before.path, params.transform);
  var blockers = anchorBlockers(context, before);
  if (forApply) {
    if (!pathEditSameGeometry(derived.path, params.confirmedAfter)) throw mutationError("preflight_failed", "confirmed_after does not match the planned path.");
    if (blockers.length > 0) throw new Error("MCP_ERROR:" + stringifyJson({ code: "PATH_EDIT_APPLY_BLOCKED", reasonCodes: blockers, uuid: params.targetUuid }));
  }
  return { context: context, document: document, target: target, before: before, after: anchorWithPath(before, derived.path), derived: derived, blockers: blockers };
}

function anchorPlan(preflight) {
  return { operation: "transform_path_anchors", documentKey: preflight.context.key, targetUuid: params.targetUuid, transform: params.transform,
    resolved: { selectedIndices: preflight.derived.selected, origin: preflight.derived.origin },
    before: preflight.before, after: preflight.after, applyBlockedReasonCodes: preflight.blockers,
    confirmationStatus: params.apply === true ? "confirmed" : "required", applyAllowed: params.apply === true && preflight.blockers.length === 0 };
}

function anchorRevalidate(preflight, plan) {
  var current;
  try { current = anchorPreflight(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Anchor transform preconditions changed before apply.")); }
  if (current.document !== preflight.document || current.target !== preflight.target) throw mutationBeforeSideEffectError("Anchor transform target native identity changed before apply.");
  if (!supportedPathSame(current.before, plan.before)) throw mutationBeforeSideEffectError("Anchor transform target changed before apply.");
}

function anchorApply(preflight, plan, state) {
  state.operationState.mutationStarted = true;
  anchorWritePoints(preflight.target, plan.after.path, plan.resolved.selectedIndices);
  return plan.resolved.selectedIndices.length;
}

function anchorVerify(preflight, plan) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) throw mutationError("verify_mismatch", "Active document changed during anchor transform verification.");
  var target = supportedPathFind(preflight.document, params.targetUuid);
  if (target === null || target !== preflight.target) throw mutationError("verify_mismatch", "Anchor transform target native identity does not match the plan.");
  var snapshot = anchorSnapshot(preflight.document, target, params.targetUuid);
  if (!anchorSameTarget(snapshot, plan.after)) throw mutationError("verify_mismatch", "Path read-back does not match the planned after state.");
  return { state: snapshot, saved: preflight.document.saved === true };
}

function anchorRollback(state) {
  var preflight = state.preflight;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
  var target;
  try { target = supportedPathFind(preflight.document, params.targetUuid); }
  catch (lookupError) { return { status: "indeterminate", message: "Rollback target lookup is indeterminate." }; }
  if (target === null || target !== preflight.target) return { status: "indeterminate", message: "Rollback target identity changed." };
  try { anchorWritePoints(target, preflight.before.path, preflight.derived.selected); }
  catch (writeError) { return { status: "indeterminate", message: "Rollback write is indeterminate." }; }
  var snapshot;
  try { snapshot = anchorSnapshot(preflight.document, target, params.targetUuid); }
  catch (readError) { return { status: "indeterminate", message: "Rollback verification is indeterminate." }; }
  state.operationState.rollbackEvidence.restoredState = snapshot;
  if (!anchorSameTarget(snapshot, preflight.before)) return { status: "failed", message: "Rollback did not restore the exact before path." };
  return { status: "verified" };
}

var anchorExecution = runMutationTransaction({
  apply: params.apply === true,
  // the item this change reads and writes, so an edit session can advance its item aggregate.
  editSessionAffected: function () { return [params.targetUuid]; },
  initialOperationState: function () { return { mutationStarted: false, rollbackEvidence: { restoredState: null } }; },
  preflight: anchorPreflight,
  plan: anchorPlan,
  revalidate: anchorRevalidate,
  applyMutation: anchorApply,
  verify: anchorVerify,
  rollback: anchorRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () { return { reasonCode: "anchor_transform_unknown", message: "Anchor transform apply outcome is indeterminate.", evidence: { restoredState: null } }; },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var anchorDocument = anchorExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === anchorExecution.preflight.document) anchorDocument = getDocumentContext();
var result = { operation: "transform_path_anchors", applied: anchorExecution.transaction.state === "verified", document: anchorDocument, plan: anchorExecution.plan, transaction: anchorExecution.transaction };
if (anchorExecution.transaction.state === "verified") result.postcondition = anchorExecution.value;
`;
export function transformPathAnchorsScript(admit) {
    return `${MUTATION_TRANSACTION_SCRIPT}
${SUPPORTED_PATH_ITEM_HOST_SCRIPT}
${PATH_POINTS_READ_MODULE_SCRIPT}
${ANCHOR_MODULE_SCRIPT(admit)}
${ANCHOR_TRANSACTION_SCRIPT}`;
}
export const TRANSFORM_PATH_ANCHORS_SCRIPT = transformPathAnchorsScript(TRANSFORM_ADMIT);
export const TRANSFORM_PATH_ANCHORS_HOST_SCRIPT_DIGEST = canonicalSha256(TRANSFORM_PATH_ANCHORS_SCRIPT);
export const TRANSFORM_PATH_ANCHORS_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: TRANSFORM_PATH_ANCHORS_OPERATION, validator: TRANSFORM_PATH_ANCHORS_VALIDATOR,
    canonicalContractVersion: CANONICAL_VERSION, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: TRANSFORM_PATH_ANCHORS_SAFETY_IDENTITY, hostScriptDigest: TRANSFORM_PATH_ANCHORS_HOST_SCRIPT_DIGEST,
    mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    const digestRequest = 'commandId' in request ? (({ commandId: _commandId, ...rest }) => rest)(request) : request;
    const digest = canonicalSha256({ operation: TRANSFORM_PATH_ANCHORS_OPERATION, validator: TRANSFORM_PATH_ANCHORS_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: 'commandId' in request ? request.commandId : null, documentKey: request.expectedDocumentKey, digest };
}
export const transformPathAnchorsToolContract = {
    name: 'illustrator_transform_path_anchors',
    title: 'Plan or Scale Path Anchors',
    description: 'Plan or apply one scale of chosen anchors of one PathItem, with their direction handles, about a fixed origin; separate scale_x and scale_y (0.25-4). Bound by expected_document_key, target_uuid and expected_path (0.01 pt tolerance). Select anchors by indices, y_range or x_range (inclusive); origin is a point or an anchor index. Point types, count and closed never change. The plan returns the full before and after path and the resolved indices; apply echoes plan.after.path as confirmed_after, requires Illustrator unlocked and in the foreground, verifies by native read-back, and restores every point on failure. Layer-direct PathItems only (not group or compound members, clipping paths or guides), at most 256 points. Paint: RGB, a spot fill, NEGATIVE polarity, and CMYK paint in a CMYK document; other paint and tags are refused with the observed value.',
    inputSchema,
    publicInputSchema: transformPathAnchorsPublicInputSchema,
    outputSchema: transformPathAnchorsResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(TRANSFORM_PATH_ANCHORS_SAFETY.policy),
    normalizePublicInput,
};
export function createTransformPathAnchorsAdapter() {
    return {
        version: 1, operation: TRANSFORM_PATH_ANCHORS_OPERATION, validator: TRANSFORM_PATH_ANCHORS_VALIDATOR,
        safety: TRANSFORM_PATH_ANCHORS_SAFETY, safetyRegistrationIdentity: TRANSFORM_PATH_ANCHORS_SAFETY_IDENTITY,
        adapterIdentity: TRANSFORM_PATH_ANCHORS_ADAPTER_IDENTITY, tool: transformPathAnchorsToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: transformPathAnchorsResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
        safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: TRANSFORM_PATH_ANCHORS_HOST_SCRIPT_DIGEST,
        mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: TRANSFORM_PATH_ANCHORS_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: TRANSFORM_PATH_ANCHORS_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: TRANSFORM_PATH_ANCHORS_OPERATION, documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: TRANSFORM_PATH_ANCHORS_ADAPTER_IDENTITY, mutationHostApplicationMode: 'foreground', script: TRANSFORM_PATH_ANCHORS_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = transformPathAnchorsResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back')
                return { state };
            if (state === 'planned')
                throw new Error('Anchor transform plan is not a terminal mutation result.');
            throw new Error('Unverified anchor transform recovery must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error, detail) {
            const message = pathEditErrorMessage(detail);
            if (message !== null)
                return new Error(message);
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
