import { z } from 'zod';
import { canonicalCommandIdSchema } from '../command-id.js';
import { DeleteBackupError, deleteBackupFactsSchema, verifyDeleteBackup } from '../delete-shared.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, layerPathSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { admitSourceWithColorSpace, placeImageAdmissionSchema } from './place-image-adapter.js';
export const EMBED_IMAGE_OPERATION = 'embed_image';
export const EMBED_IMAGE_VALIDATOR = { kind: EMBED_IMAGE_OPERATION, version: 1 };
export const EMBED_IMAGE_MAX_DIRECT_ITEMS = 128;
export const EMBED_IMAGE_TOLERANCE_PT = 0.01;
export const EMBED_IMAGE_PRECISION_DIGITS = 6;
export const EMBED_IMAGE_MEASURED_APP_VERSION = '30.8.1';
export const EMBED_IMAGE_MEASURED_FORMATS = ['jpeg', 'png'];
export const EMBED_IMAGE_MEASURED_COLOR_SPACES = ['RGB'];
const CANONICAL_VERSION = 1;
const RESULT_SCHEMA_VERSION = 1;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
const uuidSchema = z.string().min(1).max(255);
const documentKeySchema = z.string().min(1).max(16_384);
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const absolutePathSchema = z.string().min(2).max(4_096)
    .regex(/^\/(?!(?:.*\/)?\.\.(?:\/|$))[^\0]*$/u, 'Source path must be an absolute path without NUL or parent-directory segments.');
const sourceSchema = z.strictObject({ path: absolutePathSchema, sha256: sha256Schema });
const boundsSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
const positionSchema = z.tuple([z.number().finite(), z.number().finite()]);
const matrixSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
const pixelsSchema = z.strictObject({ width: z.number().int().positive(), height: z.number().int().positive() });
const commonSnapshotFields = {
    layerPath: layerPathSchema,
    layerIndex: z.number().int().nonnegative().max(EMBED_IMAGE_MAX_DIRECT_ITEMS),
    siblingUuids: z.array(uuidSchema).max(EMBED_IMAGE_MAX_DIRECT_ITEMS),
    name: z.string().max(255),
    position: positionSchema,
    geometricBounds: boundsSchema,
    locked: z.boolean(),
    hidden: z.boolean(),
    layerVisible: z.boolean(),
    layerLocked: z.boolean(),
};
export const embedImageBeforeSchema = z.strictObject({
    uuid: uuidSchema,
    type: z.literal('PlacedItem'),
    ...commonSnapshotFields,
    linkPath: absolutePathSchema,
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
    matrix: matrixSchema,
});
export const embedImageAfterSchema = z.strictObject({
    uuid: uuidSchema.nullable(),
    type: z.literal('RasterItem'),
    ...commonSnapshotFields,
    embedded: z.literal(true),
    pixels: pixelsSchema,
});
const rasterEvidenceSchema = z.strictObject({
    matrix: matrixSchema,
    boundingBox: boundsSchema,
    imageColorSpace: z.string().min(1).max(64),
    bitsPerChannel: z.number().finite(),
    channels: z.number().finite(),
    nameRestored: z.boolean(),
    placedCountBefore: z.number().int().nonnegative(),
    placedCountAfter: z.number().int().nonnegative(),
    rasterCountBefore: z.number().int().nonnegative(),
    rasterCountAfter: z.number().int().nonnegative(),
    saved: z.boolean(),
});
export function embedStateOf(snapshot) {
    const { uuid: _uuid, ...state } = snapshot;
    return state;
}
export function embedBeforeStateOf(snapshot) {
    const { uuid: _uuid, ...state } = snapshot;
    return state;
}
export function plannedEmbedAfter(before, pixels) {
    return {
        uuid: null, type: 'RasterItem', layerPath: before.layerPath, layerIndex: before.layerIndex, siblingUuids: before.siblingUuids,
        name: before.name, position: before.position, geometricBounds: before.geometricBounds,
        locked: before.locked, hidden: before.hidden, layerVisible: before.layerVisible, layerLocked: before.layerLocked,
        embedded: true, pixels: { width: pixels.width, height: pixels.height },
    };
}
export function embedAfterWithinTolerance(left, right) {
    const near = (a, b) => Math.abs(a - b) <= EMBED_IMAGE_TOLERANCE_PT;
    return left.type === right.type && canonicalDigest(left.layerPath) === canonicalDigest(right.layerPath) &&
        left.layerIndex === right.layerIndex && canonicalDigest(left.siblingUuids) === canonicalDigest(right.siblingUuids) &&
        left.name === right.name && left.embedded === right.embedded &&
        left.pixels.width === right.pixels.width && left.pixels.height === right.pixels.height &&
        left.locked === right.locked && left.hidden === right.hidden && left.layerVisible === right.layerVisible && left.layerLocked === right.layerLocked &&
        left.position.every((value, index) => near(value, right.position[index])) &&
        left.geometricBounds.every((value, index) => near(value, right.geometricBounds[index]));
}
const colorSpaceAdmissionSchema = z.strictObject({
    status: z.enum(['available', 'unavailable']),
    value: z.enum(['RGB', 'CMYK', 'Gray', 'Lab', 'Indexed', 'unknown']).nullable(),
    message: z.string().max(500).nullable(),
});
const commonRequest = {
    expectedDocumentKey: documentKeySchema,
    targetUuid: uuidSchema,
    source: sourceSchema,
    backupId: z.uuid(),
};
const admissionFields = {
    sourceAdmission: placeImageAdmissionSchema.optional(),
    sourceColorSpace: colorSpaceAdmissionSchema.optional(),
    sourceModifiedAtMs: z.number().int().nonnegative().optional(),
    backup: deleteBackupFactsSchema.optional(),
};
const unadmittedInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonRequest, apply: z.literal(false) }),
    z.strictObject({ ...commonRequest, expectedBefore: embedImageBeforeSchema, confirmedAfter: embedImageAfterSchema, apply: z.literal(true), commandId: canonicalCommandIdSchema }),
]);
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonRequest, ...admissionFields, apply: z.literal(false) }),
    z.strictObject({ ...commonRequest, ...admissionFields, expectedBefore: embedImageBeforeSchema, confirmedAfter: embedImageAfterSchema, apply: z.literal(true), commandId: canonicalCommandIdSchema }),
]).superRefine((request, context) => {
    if (request.sourceAdmission?.status === 'admitted' && request.sourceAdmission.sha256 !== request.source.sha256) {
        context.addIssue({ code: 'custom', message: 'An admitted source must carry the requested SHA-256.' });
    }
    if (request.backup !== undefined && request.backup.backupId !== request.backupId) {
        context.addIssue({ code: 'custom', message: 'Admitted backup facts must name the requested backup_id.' });
    }
    if (request.apply && request.confirmedAfter.uuid !== null)
        context.addIssue({ code: 'custom', message: 'confirmed_after must leave the UUID unknown (null).' });
});
const commonPublic = {
    expected_document_key: documentKeySchema,
    target_uuid: uuidSchema.describe('Native PageItem.uuid of the linked PlacedItem to embed.'),
    source: sourceSchema.describe('The linked file: its absolute path (as illustrator_preflight_images reports it) and the SHA-256 of the bytes to embed.'),
    backup_id: z.uuid().describe('backup_id of a verified illustrator_create_backup record of this document\'s current file.'),
};
export const embedImagePublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({
        ...commonPublic,
        expected_before: embedImageBeforeSchema.describe('plan.before, echoed.'),
        confirmed_after: embedImageAfterSchema.describe('plan.after, echoed (uuid null).'),
        apply: z.literal(true),
        command_id: canonicalCommandIdSchema,
    }),
]);
const inputSchema = z.strictObject({
    ...commonPublic, expected_before: embedImageBeforeSchema.optional(), confirmed_after: embedImageAfterSchema.optional(),
    apply: z.boolean().default(false), command_id: canonicalCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(embedImagePublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = embedImagePublicInputSchema.parse(input);
    const common = { expectedDocumentKey: value.expected_document_key, targetUuid: value.target_uuid, source: value.source, backupId: value.backup_id };
    return value.apply
        ? { ...common, expectedBefore: value.expected_before, confirmedAfter: value.confirmed_after, apply: true, commandId: value.command_id }
        : { ...common, apply: false };
}
export async function admitEmbedImageRequest(input, services) {
    const request = unadmittedInputSchema.parse(input);
    if (services.backupStore === undefined)
        throw new Error('Embedding requires the backup store; call through the MCP server.');
    const backup = await verifyDeleteBackup(services.backupStore, request.backupId);
    const admitted = await admitSourceWithColorSpace(request.source, services.imageFileInspector);
    let sourceAdmission = admitted.admission;
    if (sourceAdmission.status === 'admitted' && !EMBED_IMAGE_MEASURED_FORMATS.includes(sourceAdmission.format)) {
        sourceAdmission = { status: 'blocked', resolvedPath: sourceAdmission.resolvedPath, reason: 'source_format_unmeasured',
            message: `Embedding is measured for ${EMBED_IMAGE_MEASURED_FORMATS.join(', ')} sources only; ${sourceAdmission.format} is excluded.` };
    }
    const sourceColorSpace = admitted.colorSpace === null ? { status: 'unavailable', value: null, message: 'The source was not admitted.' }
        : admitted.colorSpace.status === 'available' ? { status: 'available', value: admitted.colorSpace.value, message: null }
            : { status: 'unavailable', value: null, message: admitted.colorSpace.message.slice(0, 500) };
    const sourceModifiedAtMs = sourceAdmission.status === 'admitted' ? Date.parse(sourceAdmission.modifiedAt) : undefined;
    return { ...request, backup, sourceAdmission, sourceColorSpace, ...(sourceModifiedAtMs === undefined ? {} : { sourceModifiedAtMs }) };
}
async function beforeHost(input, services) {
    const request = internalInputSchema.parse(input);
    if (services.backupStore === undefined || request.backup === undefined)
        throw new Error('Embedding requires an admitted backup.');
    const current = await verifyDeleteBackup(services.backupStore, request.backupId);
    if (canonicalSha256(current) !== canonicalSha256(request.backup)) {
        throw new DeleteBackupError('backup_stale', `Backup ${request.backupId} changed after the request was admitted; plan again.`);
    }
}
export const EMBED_IMAGE_BLOCKERS = [
    'document_not_saved', 'backup_mismatch', 'backup_stale', 'host_version_unmeasured', 'document_color_space_unmeasured',
    'target_locked', 'target_hidden', 'layer_hidden', 'layer_locked',
    'link_missing', 'link_path_mismatch',
    'source_file_missing', 'source_file_unavailable', 'source_hash_mismatch', 'source_format_unmeasured', 'source_file_changed',
    'source_color_space_unmeasured', 'source_pixels_unknown',
];
const blockerSchema = z.enum(EMBED_IMAGE_BLOCKERS);
const planSchema = z.strictObject({
    operation: z.literal(EMBED_IMAGE_OPERATION),
    documentKey: documentKeySchema,
    backup: deleteBackupFactsSchema,
    source: sourceSchema,
    sourceAdmission: placeImageAdmissionSchema,
    sourceColorSpace: colorSpaceAdmissionSchema,
    before: embedImageBeforeSchema,
    after: embedImageAfterSchema.nullable(),
    applyBlockedReasonCodes: z.array(blockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    const confirmedAndClear = plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0;
    if (plan.applyAllowed !== confirmedAndClear)
        context.addIssue({ code: 'custom', message: 'Embed applyAllowed must require confirmation and no blockers.' });
    if (plan.sourceAdmission.status === 'admitted' && plan.sourceAdmission.sha256 !== plan.source.sha256) {
        context.addIssue({ code: 'custom', message: 'Embed source admission must carry the requested SHA-256.' });
    }
    const pixels = plan.sourceAdmission.status === 'admitted' ? plan.sourceAdmission.pixels : null;
    if (pixels === null) {
        if (plan.after !== null)
            context.addIssue({ code: 'custom', message: 'Embed after state requires known admitted pixels.' });
    }
    else if (plan.after === null || plan.after.uuid !== null ||
        canonicalDigest(embedStateOf(plan.after)) !== canonicalDigest(embedStateOf(plannedEmbedAfter(plan.before, pixels)))) {
        context.addIssue({ code: 'custom', message: 'Embed after state must be the before slot, name and frame as a RasterItem of the admitted pixels.' });
    }
});
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']), reasonCode: z.enum(['apply_failed', 'verify_mismatch']), message: z.string().min(1).max(500),
}).superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed'))
        context.addIssue({ code: 'custom', message: 'Embed failure phase and reason code must match.' });
});
const rollbackEvidence = {
    targetUuid: uuidSchema,
    afterUuid: uuidSchema.nullable(),
    unchangedSnapshot: embedImageBeforeSchema.nullable(),
};
const transactionSchema = z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('planned'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('verified'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('apply_failed'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('not_required') }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('rolled_back'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('verified'), ...rollbackEvidence }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('apply_indeterminate'),
        failure: z.strictObject({ phase: z.literal('apply'), reasonCode: z.literal('apply_indeterminate'), message: z.string().min(1).max(500) }),
        rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('embed_outcome_unknown'), message: z.string().min(1).max(500), ...rollbackEvidence }),
        audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('rollback_indeterminate'), failure: failureSchema,
        rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('rollback_indeterminate'), message: z.string().min(1).max(500), ...rollbackEvidence }),
        audit: mutationAuditSchema }),
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
        expected = [...prefix, ...failure, 'rollback:started:', transaction.state === 'rolled_back' ? 'rollback:succeeded:' : 'rollback:failed:rollback_indeterminate'];
        if (transaction.state === 'rolled_back' && transaction.failure.phase !== 'apply')
            context.addIssue({ code: 'custom', message: 'Only a refused embed can be rolled back.' });
    }
    const actual = transaction.audit.map((event) => `${event.phase}:${event.event}:${'reasonCode' in event ? event.reasonCode : ''}`);
    if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index]))
        context.addIssue({ code: 'custom', message: 'Embed audit sequence does not match transaction state.' });
    transaction.audit.forEach((event, index) => { if (event.sequence !== index)
        context.addIssue({ code: 'custom', message: 'Embed audit sequence must be contiguous.' }); });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' && event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode && event.message === transaction.failure.message);
        if (matches.length !== 1)
            context.addIssue({ code: 'custom', message: 'Embed failure must match one audit event.' });
    }
});
const postconditionSchema = z.strictObject({ raster: embedImageAfterSchema, evidence: rasterEvidenceSchema });
function sameBeforeState(left, right) {
    return canonicalDigest(embedBeforeStateOf(left)) === canonicalDigest(embedBeforeStateOf(right));
}
export const embedImageResultSchema = z.union([
    z.strictObject({ operation: z.literal(EMBED_IMAGE_OPERATION), applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ operation: z.literal(EMBED_IMAGE_OPERATION), applied: z.literal(true), document: documentContextSchema, plan: planSchema, postcondition: postconditionSchema, transaction: transactionSchema }),
]).superRefine((result, context) => {
    const derived = new Set();
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
    else {
        if (result.plan.sourceAdmission.resolvedPath !== result.plan.before.linkPath)
            derived.add('link_path_mismatch');
        if (result.plan.sourceAdmission.pixels === null)
            derived.add('source_pixels_unknown');
        if (result.plan.sourceColorSpace.status !== 'available' || !EMBED_IMAGE_MEASURED_COLOR_SPACES.includes(result.plan.sourceColorSpace.value ?? '')) {
            derived.add('source_color_space_unmeasured');
        }
    }
    const reported = new Set(result.plan.applyBlockedReasonCodes);
    for (const blocker of derived)
        if (!reported.has(blocker))
            context.addIssue({ code: 'custom', message: `Embed plan must expose blocker ${blocker}.` });
    const hostObserved = new Set(['document_not_saved', 'backup_mismatch', 'backup_stale', 'host_version_unmeasured', 'document_color_space_unmeasured',
        'link_missing', 'source_file_missing', 'source_file_changed']);
    for (const blocker of reported)
        if (!derived.has(blocker) && !hostObserved.has(blocker))
            context.addIssue({ code: 'custom', message: `Embed plan reports an underivable blocker ${blocker}.` });
    if (result.transaction.state !== 'planned' && (reported.size !== 0 || !result.plan.applyAllowed || result.plan.after === null)) {
        context.addIssue({ code: 'custom', message: 'An embed mutation must derive from an allowed, admitted plan.' });
    }
    if (result.transaction.state === 'planned' && result.plan.confirmationStatus !== 'required')
        context.addIssue({ code: 'custom', message: 'A planned embed must require confirmation.' });
    if (result.applied) {
        const raster = result.postcondition.raster;
        if (result.transaction.state !== 'verified' || result.plan.after === null || raster.uuid === null || raster.uuid === result.plan.before.uuid ||
            !embedAfterWithinTolerance(raster, result.plan.after)) {
            context.addIssue({ code: 'custom', message: 'An applied embed requires a verified raster with a new UUID matching the planned after state.' });
        }
    }
    else if (result.transaction.state === 'verified')
        context.addIssue({ code: 'custom', message: 'A verified embed must be applied.' });
    if (result.transaction.state === 'rolled_back') {
        const rollback = result.transaction.rollback;
        if (rollback.targetUuid !== result.plan.before.uuid || rollback.unchangedSnapshot === null || rollback.unchangedSnapshot.uuid !== result.plan.before.uuid ||
            !sameBeforeState(rollback.unchangedSnapshot, result.plan.before)) {
            context.addIssue({ code: 'custom', message: 'A rolled-back embed must prove the linked item unchanged under its UUID.' });
        }
    }
});
export const embedImageResponseSchema = z.strictObject({
    outcome: embedImageResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
export const EMBED_IMAGE_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: EMBED_IMAGE_OPERATION,
    policy: {
        version: 1, class: 'update_existing', destructive: false,
        evidence: { identity: 'target_native_uuid', beforeState: 'before_state_hash', postcondition: 'updated_state_matches_plan' },
        preconditions: { documentBinding: 'explicit_document_key', compareAndSet: 'before_state_hash_match' },
        confirmation: 'exact_change_set',
        recovery: { mode: 'verified_backup_restore', verification: 'restored_state_matches_before_hash', partialRecovery: 'indeterminate' },
        terminal: { success: 'verified', failure: 'proven_pre_apply_or_verified_recovery', partialSuccess: 'nonterminal_until_reconciled' },
        replay: { requestBinding: 'canonical_request_digest', retry: 'return_attested_terminal_result', beforeTerminal: 'reconcile_required', reapplyOnRetry: false },
    },
    capabilities: {
        class: 'update_existing', explicitDocumentBinding: true, bindTargetNativeUuid: true, captureBeforeStateHash: true, compareAndSetBeforeApply: true,
        verifyUpdatedState: true, recoveryMode: 'verified_backup_restore', verifyRestoredBeforeState: true, reconcileIndeterminate: true,
        durableTerminalReplay: true, trustedTerminalAttestationResolver: true,
    },
});
export const EMBED_IMAGE_SAFETY_IDENTITY = canonicalDigest(EMBED_IMAGE_SAFETY);
function beforeDigest(before) { return canonicalDigest(embedBeforeStateOf(before)); }
function afterDigest(after) { return canonicalDigest((after === null ? null : embedStateOf(after))); }
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    const beforeStateHash = beforeDigest(result.plan.before);
    const afterStateHash = afterDigest(result.plan.after);
    const changeSetHash = canonicalDigest({ targetUuid: result.plan.before.uuid, source: result.plan.source, backup: result.plan.backup,
        before: embedBeforeStateOf(result.plan.before), after: result.plan.after === null ? null : embedStateOf(result.plan.after) });
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'update_existing', operationId: EMBED_IMAGE_OPERATION, canonicalRequestDigest: requestDigest,
        evidence: { documentKey: admissionDocumentKey, targetUuid: result.plan.before.uuid, beforeStateHash, plannedAfterStateHash: afterStateHash, plannedChangeSetDigest: changeSetHash },
        preconditions: { status: result.plan.applyBlockedReasonCodes.length === 0 ? 'satisfied' : 'blocked', compareAndSetMatched: result.plan.applyBlockedReasonCodes.length === 0 },
        confirmation: { kind: 'exact_change_set', canonicalRequestDigest: requestDigest, changeSetHash, status: result.plan.confirmationStatus },
        applyAllowed: result.plan.applyAllowed,
    });
}
function safetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' || transaction.state === 'rollback_indeterminate') {
        throw new Error('An indeterminate embed cannot be terminal.');
    }
    const common = { policyVersion: 1, operationClass: 'update_existing', operationId: EMBED_IMAGE_OPERATION, canonicalRequestDigest: requestDigest, planDigest: plan.planDigest, attestation };
    const beforeStateHash = beforeDigest(result.plan.before);
    const replay = { status: 'durable_terminal', action: 'return_attested_result', reapply: false };
    if (transaction.state === 'verified' && result.applied) {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { targetUuid: result.plan.before.uuid, beforeStateHash, afterStateHash: afterDigest(result.plan.after), restoredStateHash: null, restoredBeforeStateVerified: false },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'succeeded', terminal: true, recovery: 'not_required', proof: { kind: 'verified_postcondition' }, replay } });
    }
    if (transaction.state === 'rolled_back') {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { targetUuid: result.plan.before.uuid, beforeStateHash, afterStateHash: null, restoredStateHash: beforeStateHash, restoredBeforeStateVerified: true },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'recovered', terminal: true, recovery: 'verified', proof: { kind: 'verified_recovery' }, replay } });
    }
    return operationSafetyResultSchema.parse({ ...common,
        evidence: { targetUuid: result.plan.before.uuid, beforeStateHash, afterStateHash: null, restoredStateHash: null, restoredBeforeStateVerified: false },
        executionEvidence: { outcome: 'proven_pre_apply' },
        resolution: { status: 'failed', terminal: true, recovery: 'not_required', proof: { kind: 'proven_pre_apply', mutationAttempted: false }, replay } });
}
async function assertSafety(value, requestDigest, attestation, resolver) {
    const result = embedImageResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null)
        throw new Error('Embed terminal result requires attestation.');
    await assertOperationSafetyAdapterConformance({ registration: EMBED_IMAGE_SAFETY, plan, result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
export const EMBED_IMAGE_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
var EMBED_IMAGE_MAX_DIRECT_ITEMS = ${EMBED_IMAGE_MAX_DIRECT_ITEMS};
var EMBED_IMAGE_TOLERANCE_PT = ${EMBED_IMAGE_TOLERANCE_PT};
var EMBED_IMAGE_PRECISION_DIGITS = ${EMBED_IMAGE_PRECISION_DIGITS};
var EMBED_IMAGE_MEASURED_APP_VERSION = ${JSON.stringify(EMBED_IMAGE_MEASURED_APP_VERSION)};
var EMBED_IMAGE_MEASURED_COLOR_SPACES = ${JSON.stringify(EMBED_IMAGE_MEASURED_COLOR_SPACES)};

function embedRound(value) {
  var rounded = Number(mutationFiniteNumber(value, "geometry").toFixed(EMBED_IMAGE_PRECISION_DIGITS));
  return rounded === 0 ? 0 : rounded;
}
function embedNear(a, b) { return Math.abs(a - b) <= EMBED_IMAGE_TOLERANCE_PT; }
function embedContains(list, value) { for (var i = 0; i < list.length; i++) if (list[i] === value) return true; return false; }

/** Images resolve through their typed collections, never getPageItemFromUuid (read path). */
function embedScan(collection, uuid) {
  if (!collection || typeof collection.length !== "number") throw mutationError("preflight_failed", "The document image collection is unavailable.");
  for (var index = 0; index < collection.length; index++) if (String(collection[index].uuid) === uuid) return collection[index];
  return null;
}

function embedLayerPath(document, targetLayer) {
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

function embedValidateRequest() {
  var source = params.source;
  if (!source || typeof source.path !== "string" || source.path.charAt(0) !== "/" || typeof source.sha256 !== "string" || source.sha256.length !== 64) {
    throw mutationError("preflight_failed", "Source path and SHA-256 are required.");
  }
  var admission = params.sourceAdmission;
  if (!admission || (admission.status !== "admitted" && admission.status !== "blocked") || !params.sourceColorSpace) {
    throw mutationError("preflight_failed", "Source admission is missing; the request did not pass Node-side file admission.");
  }
  if (admission.status === "admitted" && (typeof admission.resolvedPath !== "string" || admission.resolvedPath.charAt(0) !== "/" || admission.sha256 !== source.sha256)) {
    throw mutationError("preflight_failed", "Source admission facts are inconsistent with the request.");
  }
  if (!params.backup || typeof params.backup.sourcePath !== "string" || typeof params.backup.sourceFileRevision !== "string") {
    throw mutationError("preflight_failed", "The backup was not admitted; call through the MCP server.");
  }
  if (typeof params.targetUuid !== "string" || params.targetUuid.length === 0) throw mutationError("preflight_failed", "A target UUID is required.");
}

/** Slot of an item among its layer's direct children plus every other sibling UUID, in order. */
function embedSlot(layer, item) {
  var pageItems = layer.pageItems;
  if (!pageItems || typeof pageItems.length !== "number" || pageItems.length > EMBED_IMAGE_MAX_DIRECT_ITEMS) throw mutationError("preflight_failed", "Target layer item count is unavailable or over the supported bound.");
  var index = -1; var siblings = [];
  for (var i = 0; i < pageItems.length; i++) {
    if (pageItems[i] === item) index = i;
    else { var uuid = pageItems[i].uuid; if (typeof uuid !== "string" || uuid.length === 0) throw mutationError("preflight_failed", "A sibling native UUID is unavailable."); siblings.push(uuid); }
  }
  return { index: index, siblings: siblings };
}

function embedCommon(document, item) {
  if (typeof item.locked !== "boolean" || typeof item.hidden !== "boolean" || !item.layer || typeof item.layer.visible !== "boolean" || typeof item.layer.locked !== "boolean") {
    throw mutationError("preflight_failed", "Target safety state is unavailable.");
  }
  if (!item.parent || String(item.parent.typename) !== "Layer") throw mutationError("preflight_failed", "Embedding supports layer-direct items only; the target is inside a " + String(item.parent && item.parent.typename) + ".");
  var layerPath = embedLayerPath(document, item.layer);
  if (layerPath === null) throw mutationError("preflight_failed", "Target layer path is unavailable.");
  var slot = embedSlot(item.layer, item);
  if (slot.index < 0) throw mutationError("preflight_failed", "Target is not a direct child of its layer.");
  var position = item.position, bounds = item.geometricBounds;
  if (!position || position.length !== 2 || !bounds || bounds.length !== 4) throw mutationError("preflight_failed", "Target geometry is unavailable.");
  return {
    uuid: String(item.uuid), layerPath: layerPath, layerIndex: slot.index, siblingUuids: slot.siblings, name: String(item.name || ""),
    position: [embedRound(position[0]), embedRound(position[1])],
    geometricBounds: [embedRound(bounds[0]), embedRound(bounds[1]), embedRound(bounds[2]), embedRound(bounds[3])],
    locked: item.locked, hidden: item.hidden, layerVisible: item.layer.visible, layerLocked: item.layer.locked
  };
}

function embedBeforeSnapshot(document, target) {
  if (String(target.typename) !== "PlacedItem") throw mutationError("preflight_failed", "Embedding supports linked PlacedItem targets only.");
  var snapshot = embedCommon(document, target);
  var matrix = target.matrix;
  if (!matrix) throw mutationError("preflight_failed", "Target matrix is unavailable.");
  var linkPath = null;
  try { linkPath = String(target.file.fsName); } catch (fileError) { linkPath = null; }
  return {
    uuid: snapshot.uuid, type: "PlacedItem", layerPath: snapshot.layerPath, layerIndex: snapshot.layerIndex, siblingUuids: snapshot.siblingUuids,
    name: snapshot.name, position: snapshot.position, geometricBounds: snapshot.geometricBounds,
    locked: snapshot.locked, hidden: snapshot.hidden, layerVisible: snapshot.layerVisible, layerLocked: snapshot.layerLocked,
    linkPath: linkPath, width: embedRound(target.width), height: embedRound(target.height),
    matrix: [embedRound(matrix.mValueA), embedRound(matrix.mValueB), embedRound(matrix.mValueC), embedRound(matrix.mValueD), embedRound(matrix.mValueTX), embedRound(matrix.mValueTY)]
  };
}

function embedRasterSnapshot(document, raster) {
  if (String(raster.typename) !== "RasterItem") throw mutationError("verify_mismatch", "The embedded item is a " + String(raster.typename) + ", not a RasterItem.");
  var snapshot = embedCommon(document, raster);
  var box = raster.boundingBox;
  if (!box || box.length !== 4) throw mutationError("verify_mismatch", "The raster pixel box is unavailable.");
  return {
    uuid: snapshot.uuid, type: "RasterItem", layerPath: snapshot.layerPath, layerIndex: snapshot.layerIndex, siblingUuids: snapshot.siblingUuids,
    name: snapshot.name, position: snapshot.position, geometricBounds: snapshot.geometricBounds,
    locked: snapshot.locked, hidden: snapshot.hidden, layerVisible: snapshot.layerVisible, layerLocked: snapshot.layerLocked,
    embedded: raster.embedded === true,
    pixels: { width: Math.round(Math.abs(Number(box[2]) - Number(box[0]))), height: Math.round(Math.abs(Number(box[1]) - Number(box[3]))) }
  };
}

function embedBeforeMatches(left, right) {
  if (!left || !right || left.type !== right.type || !mutationSameSequence(left.layerPath, right.layerPath) || left.layerIndex !== right.layerIndex ||
      !mutationSameSequence(left.siblingUuids, right.siblingUuids) || left.name !== right.name || left.linkPath !== right.linkPath ||
      left.locked !== right.locked || left.hidden !== right.hidden || left.layerVisible !== right.layerVisible || left.layerLocked !== right.layerLocked) return false;
  for (var p = 0; p < 2; p++) if (!embedNear(left.position[p], right.position[p])) return false;
  for (var b = 0; b < 4; b++) if (!embedNear(left.geometricBounds[b], right.geometricBounds[b])) return false;
  if (!embedNear(left.width, right.width) || !embedNear(left.height, right.height)) return false;
  for (var m = 0; m < 6; m++) if (!embedNear(left.matrix[m], right.matrix[m])) return false;
  return true;
}

function embedAfterMatches(left, right) {
  if (!left || !right || left.type !== right.type || !mutationSameSequence(left.layerPath, right.layerPath) || left.layerIndex !== right.layerIndex ||
      !mutationSameSequence(left.siblingUuids, right.siblingUuids) || left.name !== right.name || left.embedded !== right.embedded ||
      !left.pixels || !right.pixels || left.pixels.width !== right.pixels.width || left.pixels.height !== right.pixels.height ||
      left.locked !== right.locked || left.hidden !== right.hidden || left.layerVisible !== right.layerVisible || left.layerLocked !== right.layerLocked) return false;
  for (var p = 0; p < 2; p++) if (!embedNear(left.position[p], right.position[p])) return false;
  for (var b = 0; b < 4; b++) if (!embedNear(left.geometricBounds[b], right.geometricBounds[b])) return false;
  return true;
}

function embedPlannedAfter(before) {
  var admission = params.sourceAdmission;
  if (admission.status !== "admitted" || !admission.pixels) return null;
  return {
    uuid: null, type: "RasterItem", layerPath: before.layerPath, layerIndex: before.layerIndex, siblingUuids: before.siblingUuids,
    name: before.name, position: before.position, geometricBounds: before.geometricBounds,
    locked: before.locked, hidden: before.hidden, layerVisible: before.layerVisible, layerLocked: before.layerLocked,
    embedded: true, pixels: { width: admission.pixels.width, height: admission.pixels.height }
  };
}

/** Host-side identity re-check of the admitted file: existence, byte length, and mtime (second precision). */
function embedFileChanged(path, bytes, modifiedAtMs) {
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

function embedResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  embedValidateRequest();
  var target = embedScan(document.placedItems, params.targetUuid);
  if (target === null) {
    var embedded = embedScan(document.rasterItems, params.targetUuid) !== null;
    throw new Error("MCP_ERROR:" + stringifyJson({ code: embedded ? "EMBED_TARGET_NOT_LINKED" : "OBJECT_NOT_FOUND", uuid: params.targetUuid }));
  }
  var before = embedBeforeSnapshot(document, target);
  var blockers = [];
  function block(code) { if (!embedContains(blockers, code)) blockers.push(code); }
  if (!context.mutationAllowed) block("document_not_saved");
  if (context.path !== params.backup.sourcePath) block("backup_mismatch");
  else if (context.fileRevision !== params.backup.sourceFileRevision) block("backup_stale");
  if (String(app.version) !== EMBED_IMAGE_MEASURED_APP_VERSION) block("host_version_unmeasured");
  if (context.colorSpace !== "RGB") block("document_color_space_unmeasured");
  if (before.locked) block("target_locked");
  if (before.hidden) block("target_hidden");
  if (!before.layerVisible) block("layer_hidden");
  if (before.layerLocked) block("layer_locked");
  if (before.linkPath === null || !(new File(before.linkPath)).exists) block("link_missing");
  // A broken link (file throws) reads as a placeholder path, which no admitted source equals.
  if (before.linkPath === null) before.linkPath = "/unavailable";
  var admission = params.sourceAdmission;
  if (admission.status === "blocked") block(admission.reason);
  else {
    if (admission.resolvedPath !== before.linkPath) block("link_path_mismatch");
    if (!admission.pixels) block("source_pixels_unknown");
    if (params.sourceColorSpace.status !== "available" || !embedContains(EMBED_IMAGE_MEASURED_COLOR_SPACES, params.sourceColorSpace.value)) block("source_color_space_unmeasured");
    var changed = embedFileChanged(admission.resolvedPath, admission.bytes, params.sourceModifiedAtMs);
    if (changed === "missing") block("source_file_missing");
    else if (changed === "changed") block("source_file_changed");
  }
  if (forApply && blockers.length > 0) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "EMBED_IMAGE_APPLY_BLOCKED", reasonCodes: blockers, uuid: params.targetUuid }));
  }
  return { context: context, document: document, target: target, before: before, after: embedPlannedAfter(before), blockers: blockers };
}

function embedPreflight(forApply) {
  var resolved = embedResolve(forApply);
  if (forApply) {
    if (String(params.expectedBefore.uuid) !== resolved.before.uuid || !embedBeforeMatches(resolved.before, params.expectedBefore)) throw mutationError("preflight_failed", "Target state does not match expected_before.");
    if (params.confirmedAfter.uuid !== null || !embedAfterMatches(resolved.after, params.confirmedAfter)) throw mutationError("preflight_failed", "confirmed_after does not match the planned embed state.");
  }
  return resolved;
}

function embedPlan(preflight) {
  return {
    operation: "embed_image", documentKey: preflight.context.key, backup: params.backup,
    source: { path: params.source.path, sha256: params.source.sha256 }, sourceAdmission: params.sourceAdmission, sourceColorSpace: params.sourceColorSpace,
    before: preflight.before, after: preflight.after,
    applyBlockedReasonCodes: preflight.blockers, confirmationStatus: params.apply === true ? "confirmed" : "required",
    applyAllowed: params.apply === true && preflight.blockers.length === 0
  };
}

function embedRevalidate(preflight, plan) {
  var current;
  try { current = embedResolve(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Embed preconditions changed before apply.")); }
  if (current.document !== preflight.document || current.target !== preflight.target || current.before.uuid !== plan.before.uuid ||
      !embedBeforeMatches(current.before, plan.before) || !embedAfterMatches(current.after, plan.after)) {
    throw mutationBeforeSideEffectError("Embed target or link state changed before apply.");
  }
}

function embedApply(preflight, plan, state) {
  var document = preflight.document;
  var layer = preflight.target.layer;
  state.operationState.counts = { placed: document.placedItems.length, raster: document.rasterItems.length };
  var previousInteractionLevel = app.userInteractionLevel;
  try {
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    state.operationState.embedCalled = true;
    try { preflight.target.embed(); }
    catch (embedError) { throw mutationError("apply_failed", "Illustrator refused to embed the image: " + mutationPublicMessage(embedError, String(embedError && embedError.message))); }
    state.operationState.embedReturned = true;
    // The raster takes the placed item's slot among the layer's direct children.
    var slot = layer.pageItems.length > plan.before.layerIndex ? layer.pageItems[plan.before.layerIndex] : null;
    if (slot === null || String(slot.typename) !== "RasterItem") throw mutationError("apply_failed", "No RasterItem took the embedded item's place in its layer.");
    var uuid = slot.uuid;
    if (typeof uuid !== "string" || uuid.length === 0) throw mutationError("apply_failed", "The embedded raster has no native UUID.");
    state.operationState.afterUuid = uuid;
    state.operationState.rollbackEvidence.afterUuid = uuid;
    state.operationState.nameRestored = false;
    if (String(slot.name || "") !== plan.before.name) { slot.name = plan.before.name; state.operationState.nameRestored = true; }
    return slot;
  } finally {
    app.userInteractionLevel = previousInteractionLevel;
  }
}

function embedVerify(preflight, plan, state) {
  var document = preflight.document;
  if (app.documents.length === 0 || app.activeDocument !== document) throw mutationError("verify_mismatch", "Active document changed during embed verification.");
  var afterUuid = state.operationState.afterUuid;
  if (typeof afterUuid !== "string" || afterUuid === plan.before.uuid) throw mutationError("verify_mismatch", "Embedding did not produce a new native UUID.");
  var raster = embedScan(document.rasterItems, afterUuid);
  if (raster === null || raster !== state.applyValue) throw mutationError("verify_mismatch", "The new native UUID does not resolve to the embedded raster.");
  if (embedScan(document.placedItems, plan.before.uuid) !== null) throw mutationError("verify_mismatch", "The linked item still resolves after embedding.");
  var counts = state.operationState.counts;
  if (document.placedItems.length !== counts.placed - 1 || document.rasterItems.length !== counts.raster + 1) throw mutationError("verify_mismatch", "The placed and raster counts did not change by exactly one.");
  var actual = embedRasterSnapshot(document, raster);
  if (!embedAfterMatches(actual, plan.after)) throw mutationError("verify_mismatch", "The embedded raster does not match the planned after state.");
  var matrix = raster.matrix, box = raster.boundingBox;
  return {
    raster: actual,
    evidence: {
      matrix: [embedRound(matrix.mValueA), embedRound(matrix.mValueB), embedRound(matrix.mValueC), embedRound(matrix.mValueD), embedRound(matrix.mValueTX), embedRound(matrix.mValueTY)],
      boundingBox: [embedRound(box[0]), embedRound(box[1]), embedRound(box[2]), embedRound(box[3])],
      imageColorSpace: String(raster.imageColorSpace), bitsPerChannel: Number(raster.bitsPerChannel), channels: Number(raster.channels),
      nameRestored: state.operationState.nameRestored === true,
      placedCountBefore: counts.placed, placedCountAfter: document.placedItems.length, rasterCountBefore: counts.raster, rasterCountAfter: document.rasterItems.length,
      saved: document.saved === true
    }
  };
}

var EMBED_RECOVERY_MESSAGE = "An embedded image cannot be un-embedded in the same call. The command keeps the Illustrator lock until illustrator_reconcile action=release_unverified releases it; the document file is unchanged and equals the backup, so the before state is restored by closing the document without saving and reopening its file.";

/** Only an embed() that threw can be proven harmless: the linked item still reads back as the before state. */
function embedRollback(state) {
  var preflight = state.preflight;
  if (state.operationState.embedReturned === true) return { status: "indeterminate", message: EMBED_RECOVERY_MESSAGE };
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) return { status: "indeterminate", message: "Rollback document identity is indeterminate. " + EMBED_RECOVERY_MESSAGE };
  var target = embedScan(preflight.document.placedItems, preflight.before.uuid);
  if (target === null || target !== preflight.target) return { status: "indeterminate", message: "The linked item no longer resolves under its UUID. " + EMBED_RECOVERY_MESSAGE };
  var current;
  try { current = embedBeforeSnapshot(preflight.document, target); } catch (error) { return { status: "indeterminate", message: "Rollback target state is indeterminate. " + EMBED_RECOVERY_MESSAGE }; }
  if (current.uuid !== preflight.before.uuid || !embedBeforeMatches(current, preflight.before)) return { status: "indeterminate", message: "The linked item changed although embed() failed. " + EMBED_RECOVERY_MESSAGE };
  state.operationState.rollbackEvidence.unchangedSnapshot = current;
  return { status: "verified" };
}

var embedExecution = runMutationTransaction({
  apply: params.apply === true,
  initialOperationState: function () { return { embedCalled: false, embedReturned: false, afterUuid: null, counts: null, nameRestored: false,
    rollbackEvidence: { targetUuid: params.targetUuid, afterUuid: null, unchangedSnapshot: null } }; },
  preflight: embedPreflight,
  plan: embedPlan,
  revalidate: embedRevalidate,
  applyMutation: embedApply,
  verify: embedVerify,
  rollback: embedRollback,
  hasMutationEvidence: function (state) { return state.operationState.embedCalled === true; },
  applyIndeterminate: function (state) { return { reasonCode: "embed_outcome_unknown", message: "Embed apply outcome is indeterminate. " + EMBED_RECOVERY_MESSAGE,
    evidence: { targetUuid: params.targetUuid, afterUuid: state.operationState.afterUuid, unchangedSnapshot: null } }; },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var embedDocument = embedExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === embedExecution.preflight.document) embedDocument = getDocumentContext();
var result = { operation: "embed_image", applied: embedExecution.transaction.state === "verified", document: embedDocument, plan: embedExecution.plan, transaction: embedExecution.transaction };
if (embedExecution.transaction.state === "verified") result.postcondition = embedExecution.value;
`;
export const EMBED_IMAGE_HOST_SCRIPT_DIGEST = canonicalSha256(EMBED_IMAGE_SCRIPT);
export const EMBED_IMAGE_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: EMBED_IMAGE_OPERATION, validator: EMBED_IMAGE_VALIDATOR,
    canonicalContractVersion: CANONICAL_VERSION, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: EMBED_IMAGE_SAFETY_IDENTITY, hostScriptDigest: EMBED_IMAGE_HOST_SCRIPT_DIGEST,
    mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    const { commandId: _commandId, sourceAdmission: _s, sourceColorSpace: _c, sourceModifiedAtMs: _m, backup: _b, ...digestRequest } = request;
    const digest = canonicalSha256({ operation: EMBED_IMAGE_OPERATION, validator: EMBED_IMAGE_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: 'commandId' in request ? request.commandId : null, documentKey: request.expectedDocumentKey, digest };
}
export const embedImageToolContract = {
    name: 'illustrator_embed_image',
    title: 'Plan or Embed Linked Image',
    description: `Plan or embed one linked, layer-direct PlacedItem (bound by document key and native UUID) into the document, so illustrator_optimize_images can process it. Irreversible in the document: requires a verified backup (illustrator_create_backup) of the clean saved file and the linked file's absolute path and SHA-256. Measured scope only (Illustrator ${EMBED_IMAGE_MEASURED_APP_VERSION}, foreground, unlocked, RGB document, ${EMBED_IMAGE_MEASURED_FORMATS.join('/').toUpperCase()} RGB sources). The plan returns before (the linked item) and after (a RasterItem in the same slot, name and frame, with the source's pixels); apply echoes both as expected_before and confirmed_after, re-checks them and the link immediately before embedding, and verifies the raster (new UUID, which the result reports). Refused: missing or changed links, other files, locked or hidden items or layers, items in groups, dirty or unsaved documents, backup mismatch or staleness. The document is then unsaved; save it with illustrator_save_document and the same backup_id. There is no in-call undo: a failure after embedding is indeterminate and keeps the Illustrator lock (release with illustrator_reconcile action=release_unverified); the unchanged file equals the backup, so closing without saving and reopening restores the before state.`,
    inputSchema,
    publicInputSchema: embedImagePublicInputSchema,
    outputSchema: embedImageResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(EMBED_IMAGE_SAFETY.policy),
    normalizePublicInput,
};
export function createEmbedImageAdapter() {
    return {
        version: 1, operation: EMBED_IMAGE_OPERATION, validator: EMBED_IMAGE_VALIDATOR,
        safety: EMBED_IMAGE_SAFETY, safetyRegistrationIdentity: EMBED_IMAGE_SAFETY_IDENTITY,
        adapterIdentity: EMBED_IMAGE_ADAPTER_IDENTITY, tool: embedImageToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: embedImageResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: CLASSIFIER_VERSION, safetyConformanceVersion: CONFORMANCE_VERSION,
        errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: EMBED_IMAGE_HOST_SCRIPT_DIGEST,
        mutationHostApplicationMode: 'foreground',
        admit: admitEmbedImageRequest,
        beforeHost,
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: EMBED_IMAGE_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: EMBED_IMAGE_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: EMBED_IMAGE_OPERATION, documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: EMBED_IMAGE_ADAPTER_IDENTITY, mutationHostApplicationMode: 'foreground', script: EMBED_IMAGE_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = embedImageResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back')
                return { state };
            if (state === 'planned')
                throw new Error('An embed plan is not a terminal mutation result.');
            throw new Error('An unverified embed must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error, detail) {
            if (error instanceof DeleteBackupError)
                return new Error(`Embedding refused before any host call (${error.message}).`);
            if (detail?.code === 'OBJECT_NOT_FOUND')
                return new Error(`No PlacedItem with UUID ${JSON.stringify(detail.uuid ?? '')} exists in the bound document.`);
            if (detail?.code === 'EMBED_TARGET_NOT_LINKED')
                return new Error(`target_already_embedded: the item ${JSON.stringify(detail.uuid ?? '')} is an embedded RasterItem, not a linked PlacedItem.`);
            if (detail?.code === 'EMBED_IMAGE_APPLY_BLOCKED')
                return new Error(`Embedding is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}.`);
            if (detail?.code === 'DOCUMENT_NOT_SAVED')
                return new Error(`document_not_saved: ${detail.message ?? 'only a clean saved document can be embedded into'}. Nothing was embedded.`);
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
