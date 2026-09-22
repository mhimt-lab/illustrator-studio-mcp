import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, layerPathSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { admitSource, placeImageAdmissionSchema } from './place-image-adapter.js';
export const RELINK_IMAGE_OPERATION = 'relink_image';
export const RELINK_IMAGE_VALIDATOR = { kind: RELINK_IMAGE_OPERATION, version: 1 };
export const RELINK_IMAGE_MAX_DIRECT_ITEMS = 128;
export const RELINK_IMAGE_TOLERANCE_PT = 0.01;
export const RELINK_IMAGE_PRECISION_DIGITS = 6;
export const RELINK_IMAGE_MEASURED_FORMATS = ['tiff', 'jpeg', 'png'];
const CANONICAL_VERSION = 1;
const RESULT_SCHEMA_VERSION = 1;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const absolutePathSchema = z.string().min(2).max(4_096)
    .regex(/^\/(?!(?:.*\/)?\.\.(?:\/|$))[^\0]*$/u, 'Source path must be an absolute path without NUL or parent-directory segments.');
const sourceSchema = z.strictObject({ path: absolutePathSchema, sha256: sha256Schema });
const boundsSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
const positionSchema = z.tuple([z.number().finite(), z.number().finite()]);
const matrixSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
export const relinkImageSnapshotSchema = z.strictObject({
    uuid: z.string().min(1).max(255).nullable(),
    type: z.literal('PlacedItem'),
    layerPath: layerPathSchema,
    layerIndex: z.number().int().nonnegative().max(RELINK_IMAGE_MAX_DIRECT_ITEMS),
    siblingUuids: z.array(z.string().min(1).max(255)).max(RELINK_IMAGE_MAX_DIRECT_ITEMS),
    name: z.string().max(255),
    linkPath: absolutePathSchema,
    position: positionSchema,
    geometricBounds: boundsSchema,
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
    matrix: matrixSchema,
    locked: z.boolean(),
    hidden: z.boolean(),
    layerVisible: z.boolean(),
    layerLocked: z.boolean(),
});
export function relinkStateOf(snapshot) {
    const { uuid: _uuid, ...state } = snapshot;
    return state;
}
export function relinkSnapshotsWithinTolerance(left, right) {
    const near = (a, b) => Math.abs(a - b) <= RELINK_IMAGE_TOLERANCE_PT;
    return left.type === right.type && canonicalDigest(left.layerPath) === canonicalDigest(right.layerPath) &&
        left.layerIndex === right.layerIndex && canonicalDigest(left.siblingUuids) === canonicalDigest(right.siblingUuids) &&
        left.name === right.name && left.linkPath === right.linkPath &&
        left.locked === right.locked && left.hidden === right.hidden && left.layerVisible === right.layerVisible && left.layerLocked === right.layerLocked &&
        left.position.every((value, index) => near(value, right.position[index])) &&
        left.geometricBounds.every((value, index) => near(value, right.geometricBounds[index])) &&
        near(left.width, right.width) && near(left.height, right.height) &&
        left.matrix.every((value, index) => near(value, right.matrix[index]));
}
export const currentLinkAdmissionSchema = z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('admitted'), resolvedPath: absolutePathSchema, bytes: z.number().int().positive(), modifiedAtMs: z.number().int().nonnegative(), sha256: sha256Schema,
        format: z.enum(['tiff', 'jpeg', 'png', 'psd']), pixels: z.strictObject({ width: z.number().int().positive(), height: z.number().int().positive() }).nullable() }),
    z.strictObject({ status: z.literal('blocked'), resolvedPath: absolutePathSchema.nullable(),
        reason: z.enum(['current_link_missing', 'current_link_unavailable', 'current_link_format_unmeasured']), message: z.string().min(1).max(500) }),
]);
const commonRequest = {
    expectedDocumentKey: z.string().min(1).max(16_384),
    targetUuid: z.string().min(1).max(255),
    source: sourceSchema,
};
const admissionFields = {
    sourceAdmission: placeImageAdmissionSchema.optional(),
    sourceModifiedAtMs: z.number().int().nonnegative().optional(),
    currentAdmission: currentLinkAdmissionSchema.optional(),
    pixelDimensionsEqual: z.boolean().optional(),
};
function pixelEqualityConsistent(value) {
    if (value.pixelDimensionsEqual !== true)
        return true;
    const source = value.sourceAdmission;
    const current = value.currentAdmission;
    return source?.status === 'admitted' && current?.status === 'admitted' && source.pixels !== null && current.pixels !== null &&
        source.pixels.width === current.pixels.width && source.pixels.height === current.pixels.height;
}
const unadmittedInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonRequest, apply: z.literal(false) }),
    z.strictObject({ ...commonRequest, expectedBefore: relinkImageSnapshotSchema, confirmedAfter: relinkImageSnapshotSchema, apply: z.literal(true), commandId: canonicalCommandIdSchema }),
]);
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonRequest, ...admissionFields, apply: z.literal(false) }),
    z.strictObject({ ...commonRequest, ...admissionFields, expectedBefore: relinkImageSnapshotSchema, confirmedAfter: relinkImageSnapshotSchema, apply: z.literal(true), commandId: canonicalCommandIdSchema }),
]).superRefine((request, context) => {
    if (request.sourceAdmission?.status === 'admitted' && request.sourceAdmission.sha256 !== request.source.sha256) {
        context.addIssue({ code: 'custom', message: 'An admitted source must carry the requested SHA-256.' });
    }
    if (!pixelEqualityConsistent(request))
        context.addIssue({ code: 'custom', message: 'pixelDimensionsEqual must follow from equal admitted pixel dimensions.' });
    if (request.apply && request.confirmedAfter.uuid !== null)
        context.addIssue({ code: 'custom', message: 'confirmed_after must leave the UUID unknown (null).' });
});
const commonPublic = {
    expected_document_key: z.string().min(1).max(16_384),
    target_uuid: z.string().min(1).max(255),
    source: sourceSchema,
};
export const relinkImagePublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({ ...commonPublic, expected_before: relinkImageSnapshotSchema, confirmed_after: relinkImageSnapshotSchema, apply: z.literal(true), command_id: applyCommandIdSchema }),
]);
const inputSchema = z.strictObject({
    ...commonPublic, expected_before: relinkImageSnapshotSchema.optional(), confirmed_after: relinkImageSnapshotSchema.optional(),
    apply: z.boolean().default(false), command_id: applyCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(relinkImagePublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = relinkImagePublicInputSchema.parse(input);
    const common = { expectedDocumentKey: value.expected_document_key, targetUuid: value.target_uuid, source: value.source };
    return value.apply
        ? { ...common, expectedBefore: value.expected_before, confirmedAfter: value.confirmed_after, apply: true, commandId: value.command_id }
        : { ...common, apply: false };
}
export async function admitRelinkImageRequest(input, services) {
    const request = unadmittedInputSchema.parse(input);
    let sourceAdmission = await admitSource(request.source, services.imageFileInspector);
    if (sourceAdmission.status === 'admitted' && !RELINK_IMAGE_MEASURED_FORMATS.includes(sourceAdmission.format)) {
        sourceAdmission = { status: 'blocked', resolvedPath: sourceAdmission.resolvedPath, reason: 'source_format_unmeasured',
            message: `Relink is measured for TIFF, JPEG, and PNG sources only; ${sourceAdmission.format} is excluded.` };
    }
    const sourceModifiedAtMs = sourceAdmission.status === 'admitted' ? Date.parse(sourceAdmission.modifiedAt) : undefined;
    if (!request.apply)
        return { ...request, sourceAdmission, ...(sourceModifiedAtMs === undefined ? {} : { sourceModifiedAtMs }) };
    const currentAdmission = await admitCurrentLink(request.expectedBefore.linkPath, services);
    const pixelDimensionsEqual = sourceAdmission.status === 'admitted' && currentAdmission.status === 'admitted' &&
        sourceAdmission.pixels !== null && currentAdmission.pixels !== null &&
        sourceAdmission.pixels.width === currentAdmission.pixels.width && sourceAdmission.pixels.height === currentAdmission.pixels.height;
    return { ...request, sourceAdmission, ...(sourceModifiedAtMs === undefined ? {} : { sourceModifiedAtMs }), currentAdmission, pixelDimensionsEqual };
}
async function admitCurrentLink(path, services) {
    const inspection = await services.imageFileInspector.inspect(path);
    if (inspection.status === 'missing')
        return { status: 'blocked', resolvedPath: null, reason: 'current_link_missing', message: `Current link ${path} does not exist; relinking a missing link has no verified inverse.` };
    if (inspection.status === 'unavailable')
        return { status: 'blocked', resolvedPath: path, reason: 'current_link_unavailable', message: `${inspection.reason}: ${inspection.message}` };
    const format = inspection.metadata.format;
    if (format.status !== 'available' || !RELINK_IMAGE_MEASURED_FORMATS.includes(format.value)) {
        return { status: 'blocked', resolvedPath: path, reason: 'current_link_format_unmeasured', message: format.status === 'available' ? `Current link format ${format.value} is not measured for relink.` : format.message };
    }
    const pixels = inspection.metadata.pixels;
    return { status: 'admitted', resolvedPath: path, bytes: inspection.file.bytes, modifiedAtMs: Date.parse(inspection.file.modifiedAt), sha256: inspection.file.sha256, format: format.value,
        pixels: pixels.status === 'available' ? { width: pixels.value.width, height: pixels.value.height } : null };
}
const blockerSchema = z.enum([
    'document_mutation_not_allowed', 'target_locked', 'target_hidden', 'layer_hidden', 'layer_locked',
    'current_link_missing', 'current_link_unavailable', 'current_link_format_unmeasured',
    'source_file_missing', 'source_file_unavailable', 'source_hash_mismatch', 'source_format_unmeasured', 'source_file_changed',
    'source_pixel_dimensions_differ',
]);
const planSchema = z.strictObject({
    operation: z.literal(RELINK_IMAGE_OPERATION),
    documentKey: z.string().min(1).max(16_384),
    source: sourceSchema,
    sourceAdmission: placeImageAdmissionSchema,
    currentAdmission: currentLinkAdmissionSchema.nullable(),
    pixelDimensionsEqual: z.boolean().nullable(),
    before: relinkImageSnapshotSchema,
    after: relinkImageSnapshotSchema,
    applyBlockedReasonCodes: z.array(blockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    const confirmedAndClear = plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0;
    if (plan.applyAllowed !== confirmedAndClear)
        context.addIssue({ code: 'custom', message: 'Relink applyAllowed must require confirmation and no blockers.' });
    if (plan.before.uuid === null || plan.after.uuid !== null)
        context.addIssue({ code: 'custom', message: 'Relink before must carry the target UUID and after must leave it unknown.' });
    const expectedAfter = plan.sourceAdmission.status === 'admitted' ? { ...relinkStateOf(plan.before), linkPath: plan.sourceAdmission.resolvedPath } : relinkStateOf(plan.before);
    if (canonicalDigest(relinkStateOf(plan.after)) !== canonicalDigest(expectedAfter)) {
        context.addIssue({ code: 'custom', message: 'Relink after state must equal the before state with only the link path replaced.' });
    }
    if (plan.sourceAdmission.status === 'admitted' && plan.sourceAdmission.sha256 !== plan.source.sha256) {
        context.addIssue({ code: 'custom', message: 'Relink source admission must carry the requested SHA-256.' });
    }
    if (!pixelEqualityConsistent(plan))
        context.addIssue({ code: 'custom', message: 'Relink pixelDimensionsEqual must follow from equal admitted pixel dimensions.' });
});
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']), reasonCode: z.enum(['apply_failed', 'verify_mismatch']), message: z.string().min(1).max(500),
}).superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed'))
        context.addIssue({ code: 'custom', message: 'Relink failure phase and reason code must match.' });
});
const indeterminateFailureSchema = z.strictObject({ phase: z.literal('apply'), reasonCode: z.literal('apply_indeterminate'), message: z.string().min(1).max(500) });
const rollbackEvidence = {
    targetUuid: z.string().min(1).max(255),
    afterUuid: z.string().min(1).max(255).nullable(),
    restoredSnapshot: relinkImageSnapshotSchema.nullable(),
};
const transactionSchema = z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('planned'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('verified'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('apply_failed'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('not_required') }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('rolled_back'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('verified'), ...rollbackEvidence }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('rollback_failed'), failure: failureSchema,
        rollback: z.strictObject({ status: z.literal('failed'), reasonCode: z.literal('rollback_failed'), message: z.string().min(1).max(500), ...rollbackEvidence }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('apply_indeterminate'), failure: indeterminateFailureSchema,
        rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('relink_state_unknown'), message: z.string().min(1).max(500),
            targetUuid: z.string().min(1).max(255), afterUuid: z.null(), restoredSnapshot: z.null() }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('rollback_indeterminate'), failure: failureSchema,
        rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('rollback_indeterminate'), message: z.string().min(1).max(500), ...rollbackEvidence }), audit: mutationAuditSchema }),
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
        expected = [...prefix, ...failure, 'rollback:started:', transaction.state === 'rolled_back' ? 'rollback:succeeded:'
                : `rollback:failed:${transaction.state === 'rollback_failed' ? 'rollback_failed' : 'rollback_indeterminate'}`];
    }
    const actual = transaction.audit.map((event) => `${event.phase}:${event.event}:${'reasonCode' in event ? event.reasonCode : ''}`);
    if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index]))
        context.addIssue({ code: 'custom', message: 'Relink audit sequence does not match transaction state.' });
    transaction.audit.forEach((event, index) => { if (event.sequence !== index)
        context.addIssue({ code: 'custom', message: 'Relink audit sequence must be contiguous.' }); });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' && event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode && event.message === transaction.failure.message);
        if (matches.length !== 1)
            context.addIssue({ code: 'custom', message: 'Relink failure must match one audit event.' });
    }
});
export const relinkImageResultSchema = z.union([
    z.strictObject({ operation: z.literal(RELINK_IMAGE_OPERATION), applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ operation: z.literal(RELINK_IMAGE_OPERATION), applied: z.literal(true), document: documentContextSchema, plan: planSchema, postcondition: relinkImageSnapshotSchema, transaction: transactionSchema }),
]).superRefine((result, context) => {
    const derived = new Set();
    if (result.transaction.state === 'planned' && !result.document.mutationAllowed)
        derived.add('document_mutation_not_allowed');
    if (result.plan.before.locked)
        derived.add('target_locked');
    if (result.plan.before.hidden)
        derived.add('target_hidden');
    if (!result.plan.before.layerVisible)
        derived.add('layer_hidden');
    if (result.plan.before.layerLocked)
        derived.add('layer_locked');
    if (result.plan.sourceAdmission.status === 'blocked')
        derived.add(result.plan.sourceAdmission.reason);
    if (result.plan.currentAdmission?.status === 'blocked')
        derived.add(result.plan.currentAdmission.reason);
    if (result.plan.confirmationStatus === 'confirmed' && result.plan.pixelDimensionsEqual !== true)
        derived.add('source_pixel_dimensions_differ');
    const reported = new Set(result.plan.applyBlockedReasonCodes);
    for (const blocker of derived)
        if (!reported.has(blocker))
            context.addIssue({ code: 'custom', message: `Relink plan must expose blocker ${blocker}.` });
    for (const blocker of reported)
        if (!derived.has(blocker) && blocker !== 'source_file_changed' && blocker !== 'source_file_missing' && blocker !== 'current_link_missing')
            context.addIssue({ code: 'custom', message: `Relink plan reports an underivable blocker ${blocker}.` });
    if (result.transaction.state !== 'planned' && (reported.size !== 0 || !result.plan.applyAllowed || result.plan.sourceAdmission.status !== 'admitted' || result.plan.currentAdmission?.status !== 'admitted')) {
        context.addIssue({ code: 'custom', message: 'A relink mutation must derive from an allowed, admitted plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified')
            context.addIssue({ code: 'custom', message: 'An applied relink requires a verified transaction.' });
        if (result.postcondition.uuid === null || result.postcondition.uuid === result.plan.before.uuid || !relinkSnapshotsWithinTolerance(result.postcondition, result.plan.after)) {
            context.addIssue({ code: 'custom', message: 'Relink postcondition must carry a new UUID and match the planned after state.' });
        }
    }
    else if (result.transaction.state === 'verified')
        context.addIssue({ code: 'custom', message: 'A verified relink must be applied.' });
    if (result.transaction.state === 'rolled_back') {
        const rollback = result.transaction.rollback;
        if (rollback.targetUuid !== result.plan.before.uuid || rollback.restoredSnapshot === null || rollback.restoredSnapshot.uuid === null ||
            !relinkSnapshotsWithinTolerance(rollback.restoredSnapshot, result.plan.before)) {
            context.addIssue({ code: 'custom', message: 'A rolled-back relink must prove the before state (with a new UUID) was restored.' });
        }
    }
});
export const relinkImageResponseSchema = z.strictObject({
    outcome: relinkImageResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
export const RELINK_IMAGE_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: RELINK_IMAGE_OPERATION,
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
        verifyUpdatedState: true, recoveryMode: 'verified_inverse', verifyRestoredBeforeState: true, reconcileIndeterminate: true,
        durableTerminalReplay: true, trustedTerminalAttestationResolver: true,
    },
});
export const RELINK_IMAGE_SAFETY_IDENTITY = canonicalDigest(RELINK_IMAGE_SAFETY);
function stateDigest(snapshot) { return canonicalDigest(relinkStateOf(snapshot)); }
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    const beforeStateHash = stateDigest(result.plan.before);
    const afterStateHash = stateDigest(result.plan.after);
    const changeSetHash = canonicalDigest({ targetUuid: result.plan.before.uuid, source: result.plan.source, before: relinkStateOf(result.plan.before), after: relinkStateOf(result.plan.after) });
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'update_existing', operationId: RELINK_IMAGE_OPERATION, canonicalRequestDigest: requestDigest,
        evidence: { documentKey: admissionDocumentKey, targetUuid: result.plan.before.uuid, beforeStateHash, plannedAfterStateHash: afterStateHash, plannedChangeSetDigest: changeSetHash },
        preconditions: { status: result.plan.applyBlockedReasonCodes.length === 0 ? 'satisfied' : 'blocked', compareAndSetMatched: result.plan.applyBlockedReasonCodes.length === 0 },
        confirmation: { kind: 'exact_change_set', canonicalRequestDigest: requestDigest, changeSetHash, status: result.plan.confirmationStatus },
        applyAllowed: result.plan.applyAllowed,
    });
}
function safetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' || transaction.state === 'rollback_indeterminate' || transaction.state === 'rollback_failed') {
        throw new Error('Indeterminate or failed relink recovery cannot be terminal.');
    }
    const common = { policyVersion: 1, operationClass: 'update_existing', operationId: RELINK_IMAGE_OPERATION, canonicalRequestDigest: requestDigest, planDigest: plan.planDigest, attestation };
    const beforeStateHash = stateDigest(result.plan.before);
    if (transaction.state === 'verified' && result.applied) {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { targetUuid: result.plan.before.uuid, beforeStateHash, afterStateHash: stateDigest(result.plan.after), restoredStateHash: null, restoredBeforeStateVerified: false },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'succeeded', terminal: true, recovery: 'not_required', proof: { kind: 'verified_postcondition' }, replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    if (transaction.state === 'rolled_back') {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { targetUuid: result.plan.before.uuid, beforeStateHash, afterStateHash: null, restoredStateHash: beforeStateHash, restoredBeforeStateVerified: true },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'recovered', terminal: true, recovery: 'verified', proof: { kind: 'verified_recovery' }, replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    return operationSafetyResultSchema.parse({ ...common,
        evidence: { targetUuid: result.plan.before.uuid, beforeStateHash, afterStateHash: null, restoredStateHash: null, restoredBeforeStateVerified: false },
        executionEvidence: { outcome: 'proven_pre_apply' },
        resolution: { status: 'failed', terminal: true, recovery: 'not_required', proof: { kind: 'proven_pre_apply', mutationAttempted: false }, replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
}
async function assertSafety(value, requestDigest, attestation, resolver) {
    const result = relinkImageResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null)
        throw new Error('Relink terminal result requires attestation.');
    await assertOperationSafetyAdapterConformance({ registration: RELINK_IMAGE_SAFETY, plan, result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
export const RELINK_IMAGE_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
var RELINK_IMAGE_MAX_DIRECT_ITEMS = ${RELINK_IMAGE_MAX_DIRECT_ITEMS};
var RELINK_IMAGE_TOLERANCE_PT = ${RELINK_IMAGE_TOLERANCE_PT};
var RELINK_IMAGE_PRECISION_DIGITS = ${RELINK_IMAGE_PRECISION_DIGITS};

function relinkRound(value) {
  var rounded = Number(mutationFiniteNumber(value, "geometry").toFixed(RELINK_IMAGE_PRECISION_DIGITS));
  return rounded === 0 ? 0 : rounded;
}
function relinkNear(a, b) { return Math.abs(a - b) <= RELINK_IMAGE_TOLERANCE_PT; }

/** Measured: PlacedItem UUIDs resolve through the native placedItems collection, not getPageItemFromUuid. */
function relinkFind(document, uuid) {
  var collection = document.placedItems;
  if (!collection || typeof collection.length !== "number") throw mutationError("preflight_failed", "The document placed-item collection is unavailable.");
  for (var index = 0; index < collection.length; index++) if (String(collection[index].uuid) === uuid) return collection[index];
  return null;
}

function relinkLayerPath(document, targetLayer) {
  function visit(layers, prefix) {
    for (var index = 0; index < layers.length; index++) {
      var layer = layers[index];
      var path = prefix.concat([index]);
      if (layer === targetLayer) return path;
      if (path.length < 64 && layer.layers && layer.layers.length > 0) { var nested = visit(layer.layers, path); if (nested !== null) return nested; }
    }
    return null;
  }
  return visit(document.layers, []);
}

function relinkValidateRequest() {
  var source = params.source;
  if (!source || typeof source.path !== "string" || source.path.length < 2 || source.path.charAt(0) !== "/") throw mutationError("preflight_failed", "Source path must be an absolute path.");
  if (typeof source.sha256 !== "string" || source.sha256.length !== 64) throw mutationError("preflight_failed", "Source SHA-256 is required.");
  var admission = params.sourceAdmission;
  if (!admission || (admission.status !== "admitted" && admission.status !== "blocked")) throw mutationError("preflight_failed", "Source admission is missing; the request did not pass Node-side file admission.");
  if (admission.status === "admitted" && (typeof admission.resolvedPath !== "string" || admission.resolvedPath.charAt(0) !== "/" || admission.sha256 !== source.sha256)) {
    throw mutationError("preflight_failed", "Source admission facts are inconsistent with the request.");
  }
  if (typeof params.targetUuid !== "string" || params.targetUuid.length === 0) throw mutationError("preflight_failed", "A target UUID is required.");
}

/** The complete bound state of the target; uuid is read but excluded from state comparison. */
function relinkSnapshot(document, target) {
  if (String(target.typename) !== "PlacedItem") throw mutationError("preflight_failed", "Relink supports linked PlacedItem targets only.");
  if (typeof target.locked !== "boolean" || typeof target.hidden !== "boolean" || !target.layer || typeof target.layer.visible !== "boolean" || typeof target.layer.locked !== "boolean") {
    throw mutationError("preflight_failed", "Target safety state is unavailable.");
  }
  var layerPath = relinkLayerPath(document, target.layer);
  if (layerPath === null) throw mutationError("preflight_failed", "Target layer path is unavailable.");
  var layerIndex = -1; var siblings = [];
  var pageItems = target.layer.pageItems;
  if (!pageItems || typeof pageItems.length !== "number" || pageItems.length > RELINK_IMAGE_MAX_DIRECT_ITEMS) throw mutationError("preflight_failed", "Target layer item count is unavailable or over the supported bound.");
  for (var index = 0; index < pageItems.length; index++) {
    if (pageItems[index] === target) layerIndex = index;
    else { var siblingUuid = pageItems[index].uuid; if (typeof siblingUuid !== "string" || siblingUuid.length === 0) throw mutationError("preflight_failed", "A sibling native UUID is unavailable."); siblings.push(siblingUuid); }
  }
  if (layerIndex < 0) throw mutationError("preflight_failed", "Target is not a direct child of its layer.");
  var linkPath;
  try { linkPath = String(target.file.fsName); } catch (fileError) { linkPath = null; }
  var position = target.position, bounds = target.geometricBounds, matrix = target.matrix;
  if (!position || position.length !== 2 || !bounds || bounds.length !== 4 || !matrix) throw mutationError("preflight_failed", "Target geometry is unavailable.");
  return {
    uuid: String(target.uuid), type: "PlacedItem", layerPath: layerPath, layerIndex: layerIndex, siblingUuids: siblings,
    name: String(target.name || ""), linkPath: linkPath,
    position: [relinkRound(position[0]), relinkRound(position[1])],
    geometricBounds: [relinkRound(bounds[0]), relinkRound(bounds[1]), relinkRound(bounds[2]), relinkRound(bounds[3])],
    width: relinkRound(target.width), height: relinkRound(target.height),
    matrix: [relinkRound(matrix.mValueA), relinkRound(matrix.mValueB), relinkRound(matrix.mValueC), relinkRound(matrix.mValueD), relinkRound(matrix.mValueTX), relinkRound(matrix.mValueTY)],
    locked: target.locked, hidden: target.hidden, layerVisible: target.layer.visible, layerLocked: target.layer.locked
  };
}

/** State equality without the replaceable UUID. */
function relinkStateMatches(left, right) {
  if (!left || !right || left.type !== right.type || !mutationSameSequence(left.layerPath, right.layerPath) || left.layerIndex !== right.layerIndex ||
      !mutationSameSequence(left.siblingUuids, right.siblingUuids) || left.name !== right.name || left.linkPath !== right.linkPath ||
      left.locked !== right.locked || left.hidden !== right.hidden || left.layerVisible !== right.layerVisible || left.layerLocked !== right.layerLocked) return false;
  for (var p = 0; p < 2; p++) if (!relinkNear(left.position[p], right.position[p])) return false;
  for (var b = 0; b < 4; b++) if (!relinkNear(left.geometricBounds[b], right.geometricBounds[b])) return false;
  if (!relinkNear(left.width, right.width) || !relinkNear(left.height, right.height)) return false;
  for (var m = 0; m < 6; m++) if (!relinkNear(left.matrix[m], right.matrix[m])) return false;
  return true;
}

function relinkAfter(before) {
  var admission = params.sourceAdmission;
  var after = {};
  for (var key in before) if (before.hasOwnProperty(key)) after[key] = before[key];
  after.uuid = null;
  after.linkPath = admission.status === "admitted" ? admission.resolvedPath : before.linkPath;
  return after;
}

/** Host-side identity re-check of an admitted file: existence, byte length, and mtime (second precision). */
function relinkFileChanged(path, bytes, modifiedAtMs) {
  var file = new File(path);
  if (!file.exists) return "missing";
  var length = -1;
  try { length = Number(file.length); } catch (lengthError) { length = -1; }
  if (length !== bytes) return "changed";
  if (typeof modifiedAtMs === "number") {
    var modified = null;
    try { modified = file.modified ? file.modified.getTime() : null; } catch (modifiedError) { modified = null; }
    if (modified === null || Math.abs(modified - modifiedAtMs) > 1000) return "changed";
  }
  return null;
}

function relinkSourceBlockers(admission) {
  var blockers = [];
  if (admission.status === "blocked") { blockers.push(admission.reason); return blockers; }
  var changed = relinkFileChanged(admission.resolvedPath, admission.bytes, params.sourceModifiedAtMs);
  if (changed === "missing") blockers.push("source_file_missing");
  else if (changed === "changed") blockers.push("source_file_changed");
  return blockers;
}

function relinkResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  relinkValidateRequest();
  var target = relinkFind(document, params.targetUuid);
  if (target === null) throw new Error("MCP_ERROR:" + stringifyJson({ code: "OBJECT_NOT_FOUND", uuid: params.targetUuid }));
  var before = relinkSnapshot(document, target);
  var blockers = [];
  if (!context.mutationAllowed) blockers.push("document_mutation_not_allowed");
  if (before.locked) blockers.push("target_locked");
  if (before.hidden) blockers.push("target_hidden");
  if (!before.layerVisible) blockers.push("layer_hidden");
  if (before.layerLocked) blockers.push("layer_locked");
  if (before.linkPath === null) blockers.push("current_link_missing");
  else if (!(new File(before.linkPath)).exists) blockers.push("current_link_missing");
  var sourceBlockers = relinkSourceBlockers(params.sourceAdmission);
  for (var s = 0; s < sourceBlockers.length; s++) blockers.push(sourceBlockers[s]);
  if (forApply) {
    if (!params.currentAdmission || params.currentAdmission.status !== "admitted") blockers.push(params.currentAdmission && params.currentAdmission.reason ? params.currentAdmission.reason : "current_link_unavailable");
    else if (before.linkPath !== null && params.currentAdmission.resolvedPath !== before.linkPath) blockers.push("current_link_unavailable");
    else if (before.linkPath !== null && relinkFileChanged(before.linkPath, params.currentAdmission.bytes, params.currentAdmission.modifiedAtMs) !== null) blockers.push("current_link_unavailable");
    if (params.pixelDimensionsEqual !== true) blockers.push("source_pixel_dimensions_differ");
  }
  if (before.linkPath === null) before.linkPath = "/unavailable";
  if (forApply && blockers.length > 0) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "RELINK_IMAGE_APPLY_BLOCKED", reasonCodes: blockers, uuid: params.targetUuid }));
  }
  return { context: context, document: document, target: target, before: before, after: relinkAfter(before), blockers: blockers };
}

function relinkPreflight(forApply) {
  var resolved = relinkResolve(forApply);
  if (forApply) {
    if (!relinkStateMatches(resolved.before, params.expectedBefore) || String(params.expectedBefore.uuid) !== resolved.before.uuid) throw mutationError("preflight_failed", "Target state does not match expected_before.");
    if (params.confirmedAfter.uuid !== null || !relinkStateMatches(resolved.after, params.confirmedAfter)) throw mutationError("preflight_failed", "confirmed_after does not match the planned relink state.");
  }
  return resolved;
}

function relinkPlan(preflight) {
  return {
    operation: "relink_image", documentKey: preflight.context.key,
    source: { path: params.source.path, sha256: params.source.sha256 }, sourceAdmission: params.sourceAdmission,
    currentAdmission: params.currentAdmission === undefined ? null : params.currentAdmission,
    pixelDimensionsEqual: params.pixelDimensionsEqual === undefined ? null : params.pixelDimensionsEqual,
    before: preflight.before, after: preflight.after,
    applyBlockedReasonCodes: preflight.blockers, confirmationStatus: params.apply === true ? "confirmed" : "required",
    applyAllowed: params.apply === true && preflight.blockers.length === 0
  };
}

function relinkRevalidate(preflight, plan) {
  var current;
  try { current = relinkResolve(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Relink preconditions changed before apply.")); }
  if (current.document !== preflight.document || current.target !== preflight.target || current.before.uuid !== plan.before.uuid ||
      !relinkStateMatches(current.before, plan.before) || !relinkStateMatches(current.after, plan.after)) {
    throw mutationBeforeSideEffectError("Relink target or link state changed before apply.");
  }
}

function relinkAssign(target, path) {
  // Measured (30.8.1): a refused file (9080) leaves the link, UUID, and frame unchanged.
  target.file = new File(path);
  if (typeof target.uuid !== "string" || target.uuid.length === 0) throw mutationError("apply_failed", "Illustrator did not return a valid native UUID after relinking.");
  return String(target.uuid);
}

function relinkApply(preflight, plan, state) {
  var previousInteractionLevel = app.userInteractionLevel;
  try {
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    state.operationState.mutationStarted = true;
    var target = preflight.target;
    try { state.operationState.afterUuid = relinkAssign(target, params.sourceAdmission.resolvedPath); }
    catch (fileError) { throw mutationError("apply_failed", "Illustrator refused the source file: " + mutationPublicMessage(fileError, String(fileError && fileError.message))); }
    state.operationState.rollbackEvidence.afterUuid = state.operationState.afterUuid;
    // Measured: relinking to some formats renames the item after the file; the bound state keeps the before name.
    if (String(target.name || "") !== plan.before.name) target.name = plan.before.name;
    return target;
  } finally {
    app.userInteractionLevel = previousInteractionLevel;
  }
}

function relinkVerify(preflight, plan, state) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) throw mutationError("verify_mismatch", "Active document changed during relink verification.");
  var afterUuid = state.operationState.afterUuid;
  if (typeof afterUuid !== "string" || afterUuid.length === 0 || afterUuid === plan.before.uuid) throw mutationError("verify_mismatch", "Relink did not produce a new native UUID.");
  var target = relinkFind(preflight.document, afterUuid);
  if (target === null || target !== preflight.target) throw mutationError("verify_mismatch", "The new native UUID does not resolve to the relinked item.");
  if (relinkFind(preflight.document, plan.before.uuid) !== null) throw mutationError("verify_mismatch", "The previous native UUID still resolves after relink.");
  var actual = relinkSnapshot(preflight.document, target);
  if (!relinkStateMatches(actual, plan.after)) throw mutationError("verify_mismatch", "Relink postcondition does not match the planned after state.");
  return actual;
}

function relinkRollback(state) {
  var preflight = state.preflight;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
  var target = preflight.target;
  var current;
  try { current = relinkSnapshot(preflight.document, target); } catch (error) { return { status: "indeterminate", message: "Rollback target state is indeterminate." }; }
  if (relinkFind(preflight.document, current.uuid) !== target) return { status: "indeterminate", message: "Rollback target identity is indeterminate." };
  if (relinkStateMatches(current, preflight.before)) {
    // The refused-file case: nothing changed, so the before state already holds (its UUID may or may not have changed).
    state.operationState.rollbackEvidence.restoredSnapshot = current;
    return { status: "verified" };
  }
  if (!relinkStateMatches(current, preflight.after)) return { status: "indeterminate", message: "Rollback refused because the target is neither the before nor the planned after state." };
  var previousInteractionLevel = app.userInteractionLevel;
  try {
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    try { relinkAssign(target, preflight.before.linkPath); }
    catch (assignError) { return { status: "failed", message: "Rollback could not reassign the original link: " + mutationPublicMessage(assignError, String(assignError && assignError.message)) }; }
    if (String(target.name || "") !== preflight.before.name) target.name = preflight.before.name;
  } finally {
    app.userInteractionLevel = previousInteractionLevel;
  }
  var restored;
  try { restored = relinkSnapshot(preflight.document, target); } catch (error) { return { status: "indeterminate", message: "Rollback verification is indeterminate." }; }
  state.operationState.rollbackEvidence.restoredSnapshot = restored;
  return relinkStateMatches(restored, preflight.before) ? { status: "verified" } : { status: "failed", message: "Rollback did not restore the before link state." };
}

var relinkExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionAffected: function (phase, preflight, plan, state) { return (phase === "after") ? [state.operationState.afterUuid] : [params.targetUuid]; },
  editSessionLayers: function (phase, preflight) { return (String(preflight.target.parent.typename) === "Layer") ? [preflight.target.parent] : []; },
  initialOperationState: function () { return { mutationStarted: false, afterUuid: null, rollbackEvidence: { targetUuid: params.targetUuid, afterUuid: null, restoredSnapshot: null } }; },
  preflight: relinkPreflight,
  plan: relinkPlan,
  revalidate: relinkRevalidate,
  applyMutation: relinkApply,
  verify: relinkVerify,
  rollback: relinkRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () { return { reasonCode: "relink_state_unknown", message: "Relink apply outcome is indeterminate.", evidence: { targetUuid: params.targetUuid, afterUuid: null, restoredSnapshot: null } }; },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var relinkDocument = relinkExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === relinkExecution.preflight.document) relinkDocument = getDocumentContext();
var result = { operation: "relink_image", applied: relinkExecution.transaction.state === "verified", document: relinkDocument, plan: relinkExecution.plan, transaction: relinkExecution.transaction };
if (relinkExecution.transaction.state === "verified") result.postcondition = relinkExecution.value;
`;
export const RELINK_IMAGE_HOST_SCRIPT_DIGEST = canonicalSha256(RELINK_IMAGE_SCRIPT);
export const RELINK_IMAGE_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: RELINK_IMAGE_OPERATION, validator: RELINK_IMAGE_VALIDATOR,
    canonicalContractVersion: CANONICAL_VERSION, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: RELINK_IMAGE_SAFETY_IDENTITY, hostScriptDigest: RELINK_IMAGE_HOST_SCRIPT_DIGEST,
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    const { commandId: _commandId, sourceAdmission: _s, sourceModifiedAtMs: _m, currentAdmission: _c, pixelDimensionsEqual: _p, ...digestRequest } = request;
    const digest = canonicalSha256({ operation: RELINK_IMAGE_OPERATION, validator: RELINK_IMAGE_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: 'commandId' in request ? request.commandId : null, documentKey: request.expectedDocumentKey, digest };
}
export const relinkImageToolContract = {
    name: 'illustrator_relink_image',
    title: 'Plan or Relink Linked Image',
    description: 'Plan or relink one existing linked PlacedItem (bound by document key and native UUID) to another TIFF, JPEG, or PNG file given by absolute path and SHA-256 whose pixel dimensions equal the current link. The frame, layer, sibling position, and name are kept; Illustrator replaces the native UUID, which the result reports. Apply requires the echoed expected_before and confirmed_after snapshots, verifies the read-back, and recovers by reassigning the original link. Missing current links, PSD, and different pixel dimensions are blocked.',
    inputSchema,
    publicInputSchema: relinkImagePublicInputSchema,
    outputSchema: relinkImageResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(RELINK_IMAGE_SAFETY.policy),
    normalizePublicInput,
};
export function createRelinkImageAdapter() {
    return {
        version: 1, operation: RELINK_IMAGE_OPERATION, validator: RELINK_IMAGE_VALIDATOR,
        safety: RELINK_IMAGE_SAFETY, safetyRegistrationIdentity: RELINK_IMAGE_SAFETY_IDENTITY,
        adapterIdentity: RELINK_IMAGE_ADAPTER_IDENTITY, tool: relinkImageToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: relinkImageResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: CLASSIFIER_VERSION, safetyConformanceVersion: CONFORMANCE_VERSION,
        errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: RELINK_IMAGE_HOST_SCRIPT_DIGEST,
        admit: admitRelinkImageRequest,
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: RELINK_IMAGE_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: RELINK_IMAGE_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: RELINK_IMAGE_OPERATION, documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: RELINK_IMAGE_ADAPTER_IDENTITY, script: RELINK_IMAGE_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = relinkImageResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back')
                return { state };
            if (state === 'planned')
                throw new Error('Relink plan is not a terminal mutation result.');
            throw new Error('Unverified relink recovery must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error, detail) {
            if (detail?.code === 'OBJECT_NOT_FOUND')
                return new Error(`No PlacedItem with UUID ${JSON.stringify(detail.uuid ?? '')} exists in the bound document.`);
            if (detail?.code === 'RELINK_IMAGE_APPLY_BLOCKED')
                return new Error(`Relink is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}.`);
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
