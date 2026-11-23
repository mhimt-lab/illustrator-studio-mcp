import { hostVersionPublicFields, hostVersionInternalFields, normalizeHostVersionConsent } from '../host-version-consent.js';
import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { DeleteBackupError, deleteBackupFactsSchema, verifyDeleteBackup } from '../delete-shared.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, layerPathSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { ANCESTOR_STATE_SCRIPT } from './ancestor-state-host-script.js';
import { admitSourceWithColorSpace, placeImageAdmissionSchema } from './place-image-adapter.js';
import { inspectEmbedSourceStructure } from '../embed-source-structure.js';
import { HOST_VERSION_POLICY_JSX } from '../host-version-policy.js';
import { absolutePathSchema, boundsSchema, colorSpaceAdmissionSchema, documentKeySchema, EMBED_IMAGE_MAX_DIRECT_ITEMS, EMBED_IMAGE_TOLERANCE_PT, embedTransactionSchema, matrixSchema, pixelsSchema, positionSchema, sourceSchema, uuidSchema, } from './embed-image-shared.js';
import { admitEmbedBatchRequest, assertEmbedBatchPixelAdmission, EMBED_IMAGE_BATCH_HOST_SCRIPT, embedBatchAfterDigest, embedBatchBeforeDigest, embedBatchChangeSetHash, embedBatchInternalInputSchema, embedBatchResultSchema, embedImageBatchPublicApplySchema, embedImageBatchPublicPlanSchema, embedImageBatchPublishedSchema, isEmbedBatchInput, normalizeEmbedBatchPublicInput, } from './embed-image-batch.js';
export const EMBED_IMAGE_OPERATION = 'embed_image';
export const EMBED_IMAGE_VALIDATOR = { kind: EMBED_IMAGE_OPERATION, version: 1 };
export { EMBED_IMAGE_MAX_DIRECT_ITEMS, EMBED_IMAGE_TOLERANCE_PT };
export const EMBED_IMAGE_PRECISION_DIGITS = 6;
export const EMBED_IMAGE_MEASURED_FORMATS = ['jpeg', 'png'];
export const EMBED_IMAGE_MEASURED_COLOR_SPACES = ['RGB'];
export const EMBED_IMAGE_CMYK_PROFILE = 'cmyk_flat_raster_v1';
export const EMBED_IMAGE_CMYK_MEASURED_SOURCES = {
    psd: { RGB: { channels: 3, layers: 1 }, CMYK: { channels: 4, layers: 1 } },
    tiff: { CMYK: { channels: 4, layers: 0 } },
};
export const EMBED_IMAGE_CMYK_UNIFORM_SCALE_TOLERANCE = 1e-4;
export const EMBED_IMAGE_CMYK_EXPECTED = { imageColorSpace: 'ImageColorSpace.CMYK', bitsPerChannel: 8, channels: 4 };
export const EMBED_IMAGE_CMYK_MATRIX_TOLERANCE = 1e-6;
export const EMBED_IMAGE_PPI_RELATIVE_TOLERANCE = 1e-4;
const CANONICAL_VERSION = 2;
const RESULT_SCHEMA_VERSION = 3;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
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
    ancestorLocked: z.boolean(),
    ancestorHidden: z.boolean(),
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
    profile: z.literal(EMBED_IMAGE_CMYK_PROFILE).optional(),
    wrapperDisposition: z.enum(['direct_raster', 'unwrap_single_raster_group']).optional(),
    effectivePpiBefore: z.tuple([z.number().finite(), z.number().finite()]).optional(),
    effectivePpiAfter: z.tuple([z.number().finite(), z.number().finite()]).optional(),
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
        locked: before.locked, hidden: before.hidden, layerVisible: before.layerVisible, layerLocked: before.layerLocked, ancestorLocked: before.ancestorLocked, ancestorHidden: before.ancestorHidden,
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
        left.ancestorLocked === right.ancestorLocked && left.ancestorHidden === right.ancestorHidden &&
        left.position.every((value, index) => near(value, right.position[index])) &&
        left.geometricBounds.every((value, index) => near(value, right.geometricBounds[index]));
}
export const embedSourceProfileSchema = z.strictObject({
    profile: z.literal(EMBED_IMAGE_CMYK_PROFILE),
    icc: z.enum(['present', 'absent', 'unavailable']),
    structure: z.strictObject({
        status: z.enum(['flat', 'layered', 'multi_page', 'unsupported', 'unavailable']),
        bitsPerChannel: z.number().int().nonnegative().nullable(),
        channels: z.number().int().nonnegative().nullable(),
        layers: z.number().int().nonnegative().nullable(),
    }),
});
export function cmykProfileBlockers(plan) {
    const blockers = [];
    const format = plan.sourceAdmission.status === 'admitted' ? plan.sourceAdmission.format : undefined;
    const byColor = format === 'psd' || format === 'tiff' ? EMBED_IMAGE_CMYK_MEASURED_SOURCES[format] : {};
    const color = plan.sourceColorSpace.status === 'available' ? plan.sourceColorSpace.value ?? '' : '';
    const measured = Object.prototype.hasOwnProperty.call(byColor, color) ? byColor[color] : null;
    if (measured === null)
        blockers.push('source_color_space_unmeasured');
    if (plan.sourceProfile.icc !== 'present')
        blockers.push('source_icc_unmeasured');
    const structure = plan.sourceProfile.structure;
    if (measured !== null && (structure.status !== 'flat' || structure.bitsPerChannel !== 8 || structure.channels !== measured.channels || structure.layers !== measured.layers)) {
        blockers.push('source_structure_unmeasured');
    }
    const [a, b, c, d] = plan.before.matrix;
    if (Math.abs(b) > EMBED_IMAGE_CMYK_MATRIX_TOLERANCE || Math.abs(c) > EMBED_IMAGE_CMYK_MATRIX_TOLERANCE || !(a > 0) || !(d < 0) ||
        Math.abs(a - Math.abs(d)) > EMBED_IMAGE_CMYK_UNIFORM_SCALE_TOLERANCE * Math.abs(a))
        blockers.push('target_transform_unmeasured');
    return blockers;
}
const commonRequest = { ...hostVersionInternalFields,
    expectedDocumentKey: documentKeySchema,
    targetUuid: uuidSchema,
    source: sourceSchema,
    backupId: z.uuid(),
};
const admissionFields = {
    sourceAdmission: placeImageAdmissionSchema.optional(),
    sourceColorSpace: colorSpaceAdmissionSchema.optional(),
    sourceProfile: embedSourceProfileSchema.optional(),
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
const commonPublic = { ...hostVersionPublicFields,
    expected_document_key: documentKeySchema,
    target_uuid: uuidSchema.describe('Native PageItem.uuid of the linked PlacedItem to embed.'),
    source: sourceSchema.describe('The linked file: its absolute path (as illustrator_preflight_images reports it) and the SHA-256 of the bytes to embed.'),
    backup_id: z.uuid().describe('backup_id of a verified illustrator_create_backup record of this document\'s current file.'),
};
const embedImageSinglePlanPublicSchema = z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) });
const embedImageSingleApplyPublicSchema = z.strictObject({
    ...commonPublic,
    expected_before: embedImageBeforeSchema.describe('plan.before, echoed.'),
    confirmed_after: embedImageAfterSchema.describe('plan.after, echoed (uuid null).'),
    apply: z.literal(true),
    command_id: applyCommandIdSchema,
});
const embedImageSinglePublicInputSchema = z.discriminatedUnion('apply', [embedImageSinglePlanPublicSchema, embedImageSingleApplyPublicSchema]);
export const embedImagePublicInputSchema = z.union([embedImageSinglePlanPublicSchema, embedImageSingleApplyPublicSchema, embedImageBatchPublicPlanSchema, embedImageBatchPublicApplySchema]);
const inputSchema = z.strictObject({
    ...commonPublic, target_uuid: commonPublic.target_uuid.optional(), source: commonPublic.source.optional(),
    items: z.array(z.unknown()).optional(),
    expected_before: z.unknown().optional(), confirmed_after: z.unknown().optional(),
    apply: z.boolean().default(false), command_id: applyCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(z.union([embedImageSinglePlanPublicSchema, embedImageSingleApplyPublicSchema, embedImageBatchPublishedSchema]), { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    if (isEmbedBatchInput(input))
        return normalizeEmbedBatchPublicInput(input);
    const value = embedImageSinglePublicInputSchema.parse(input);
    const common = { ...normalizeHostVersionConsent(value), expectedDocumentKey: value.expected_document_key, targetUuid: value.target_uuid, source: value.source, backupId: value.backup_id };
    return value.apply
        ? { ...common, expectedBefore: value.expected_before, confirmedAfter: value.confirmed_after, apply: true, commandId: value.command_id }
        : { ...common, apply: false };
}
export async function admitEmbedImageRequest(input, services) {
    if (isEmbedBatchInput(input))
        return admitEmbedBatchRequest(input, services);
    const request = unadmittedInputSchema.parse(input);
    if (services.backupStore === undefined)
        throw new Error('Embedding requires the backup store; call through the MCP server.');
    const backup = await verifyDeleteBackup(services.backupStore, request.backupId);
    const admitted = await admitSourceWithColorSpace(request.source, services.imageFileInspector);
    let sourceAdmission = admitted.admission;
    const cmykFormat = sourceAdmission.status === 'admitted' && (sourceAdmission.format === 'psd' || sourceAdmission.format === 'tiff') ? sourceAdmission.format : null;
    if (sourceAdmission.status === 'admitted' && cmykFormat === null && !EMBED_IMAGE_MEASURED_FORMATS.includes(sourceAdmission.format)) {
        sourceAdmission = { status: 'blocked', resolvedPath: sourceAdmission.resolvedPath, reason: 'source_format_unmeasured',
            message: `Embedding is measured for ${EMBED_IMAGE_MEASURED_FORMATS.join(', ')} and (CMYK documents) ${Object.keys(EMBED_IMAGE_CMYK_MEASURED_SOURCES).join(', ')} sources only; ${sourceAdmission.format} is excluded.` };
    }
    let sourceProfile;
    if (cmykFormat !== null && sourceAdmission.status === 'admitted') {
        const structure = await inspectEmbedSourceStructure(sourceAdmission.resolvedPath, cmykFormat);
        sourceProfile = { profile: EMBED_IMAGE_CMYK_PROFILE,
            icc: admitted.icc === null || admitted.icc.status !== 'available' ? 'unavailable' : admitted.icc.value.present ? 'present' : 'absent',
            structure: { status: structure.status, bitsPerChannel: structure.bitsPerChannel, channels: structure.channels, layers: structure.layers } };
    }
    const sourceColorSpace = admitted.colorSpace === null ? { status: 'unavailable', value: null, message: 'The source was not admitted.' }
        : admitted.colorSpace.status === 'available' ? { status: 'available', value: admitted.colorSpace.value, message: null }
            : { status: 'unavailable', value: null, message: admitted.colorSpace.message.slice(0, 500) };
    const sourceModifiedAtMs = sourceAdmission.status === 'admitted' ? Date.parse(sourceAdmission.modifiedAt) : undefined;
    return { ...request, backup, sourceAdmission, sourceColorSpace, ...(sourceProfile === undefined ? {} : { sourceProfile }),
        ...(sourceModifiedAtMs === undefined ? {} : { sourceModifiedAtMs }) };
}
async function beforeHost(input, services) {
    const request = isEmbedBatchInput(input) ? embedBatchInternalInputSchema.parse(input) : internalInputSchema.parse(input);
    if ('items' in request)
        assertEmbedBatchPixelAdmission(request.items);
    if (services.backupStore === undefined || request.backup === undefined)
        throw new Error('Embedding requires an admitted backup.');
    const current = await verifyDeleteBackup(services.backupStore, request.backupId);
    if (canonicalSha256(current) !== canonicalSha256(request.backup)) {
        throw new DeleteBackupError('backup_stale', `Backup ${request.backupId} changed after the request was admitted; plan again.`);
    }
}
export const EMBED_IMAGE_BLOCKERS = [
    'document_not_saved', 'backup_mismatch', 'backup_stale', 'host_version_unmeasured', 'document_color_space_unmeasured',
    'target_locked', 'target_hidden', 'layer_hidden', 'layer_locked', 'ancestor_hidden', 'ancestor_locked',
    'link_missing', 'link_path_mismatch',
    'source_file_missing', 'source_file_unavailable', 'source_hash_mismatch', 'source_format_unmeasured', 'source_file_changed',
    'source_color_space_unmeasured', 'source_pixels_unknown',
    'source_icc_unmeasured', 'source_structure_unmeasured', 'target_transform_unmeasured',
];
const blockerSchema = z.enum(EMBED_IMAGE_BLOCKERS);
const planSchema = z.strictObject({
    operation: z.literal(EMBED_IMAGE_OPERATION),
    documentKey: documentKeySchema,
    backup: deleteBackupFactsSchema,
    source: sourceSchema,
    sourceAdmission: placeImageAdmissionSchema,
    sourceColorSpace: colorSpaceAdmissionSchema,
    sourceProfile: embedSourceProfileSchema.optional(),
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
const rollbackEvidence = {
    targetUuid: uuidSchema,
    afterUuid: uuidSchema.nullable(),
    unchangedSnapshot: embedImageBeforeSchema.nullable(),
};
const transactionSchema = embedTransactionSchema(rollbackEvidence);
const postconditionSchema = z.strictObject({ raster: embedImageAfterSchema, evidence: rasterEvidenceSchema });
function sameBeforeState(left, right) {
    return canonicalDigest(embedBeforeStateOf(left)) === canonicalDigest(embedBeforeStateOf(right));
}
const embedImageSingleResultSchema = z.union([
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
    if (result.plan.before.ancestorHidden)
        derived.add('ancestor_hidden');
    if (result.plan.before.ancestorLocked)
        derived.add('ancestor_locked');
    if (result.plan.sourceAdmission.status === 'blocked')
        derived.add(result.plan.sourceAdmission.reason);
    else {
        if (result.plan.sourceAdmission.resolvedPath !== result.plan.before.linkPath)
            derived.add('link_path_mismatch');
        if (result.plan.sourceAdmission.pixels === null)
            derived.add('source_pixels_unknown');
        if (result.plan.sourceProfile !== undefined) {
            for (const blocker of cmykProfileBlockers({ ...result.plan, sourceProfile: result.plan.sourceProfile }))
                derived.add(blocker);
        }
        else if (result.plan.sourceColorSpace.status !== 'available' || !EMBED_IMAGE_MEASURED_COLOR_SPACES.includes(result.plan.sourceColorSpace.value ?? '')) {
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
        if (result.plan.sourceProfile !== undefined) {
            const evidence = result.postcondition.evidence;
            if (evidence.profile !== EMBED_IMAGE_CMYK_PROFILE || evidence.wrapperDisposition === undefined || evidence.effectivePpiBefore === undefined || evidence.effectivePpiAfter === undefined ||
                evidence.imageColorSpace !== EMBED_IMAGE_CMYK_EXPECTED.imageColorSpace || evidence.bitsPerChannel !== EMBED_IMAGE_CMYK_EXPECTED.bitsPerChannel || evidence.channels !== EMBED_IMAGE_CMYK_EXPECTED.channels ||
                evidence.effectivePpiBefore.some((before, index) => Math.abs(before - evidence.effectivePpiAfter[index]) > EMBED_IMAGE_PPI_RELATIVE_TOLERANCE * Math.abs(before))) {
                context.addIssue({ code: 'custom', message: 'An applied cmyk_flat_raster_v1 embed requires CMYK 8-bit 4-channel evidence, a wrapper disposition and an unchanged effective PPI.' });
            }
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
export const embedImageResultSchema = z.union([embedImageSingleResultSchema, embedBatchResultSchema]);
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
function batchSafetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    const beforeStateHash = embedBatchBeforeDigest(result.plan.before);
    const changeSetHash = embedBatchChangeSetHash(result);
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'update_existing', operationId: EMBED_IMAGE_OPERATION, canonicalRequestDigest: requestDigest,
        evidence: { documentKey: admissionDocumentKey, targetUuid: result.plan.before.items[0].uuid, beforeStateHash,
            plannedAfterStateHash: embedBatchAfterDigest(result.plan.after), plannedChangeSetDigest: changeSetHash },
        preconditions: { status: result.plan.applyBlockedReasonCodes.length === 0 ? 'satisfied' : 'blocked', compareAndSetMatched: result.plan.applyBlockedReasonCodes.length === 0 },
        confirmation: { kind: 'exact_change_set', canonicalRequestDigest: requestDigest, changeSetHash, status: result.plan.confirmationStatus },
        applyAllowed: result.plan.applyAllowed,
    });
}
function batchSafetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' || transaction.state === 'rollback_indeterminate') {
        throw new Error('An indeterminate embed cannot be terminal.');
    }
    const common = { policyVersion: 1, operationClass: 'update_existing', operationId: EMBED_IMAGE_OPERATION, canonicalRequestDigest: requestDigest, planDigest: plan.planDigest, attestation };
    const targetUuid = result.plan.before.items[0].uuid;
    const beforeStateHash = embedBatchBeforeDigest(result.plan.before);
    const replay = { status: 'durable_terminal', action: 'return_attested_result', reapply: false };
    if (transaction.state === 'verified' && result.applied) {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { targetUuid, beforeStateHash, afterStateHash: embedBatchAfterDigest(result.plan.after), restoredStateHash: null, restoredBeforeStateVerified: false },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'succeeded', terminal: true, recovery: 'not_required', proof: { kind: 'verified_postcondition' }, replay } });
    }
    if (transaction.state === 'rolled_back') {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { targetUuid, beforeStateHash, afterStateHash: null, restoredStateHash: beforeStateHash, restoredBeforeStateVerified: true },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'recovered', terminal: true, recovery: 'verified', proof: { kind: 'verified_recovery' }, replay } });
    }
    return operationSafetyResultSchema.parse({ ...common,
        evidence: { targetUuid, beforeStateHash, afterStateHash: null, restoredStateHash: null, restoredBeforeStateVerified: false },
        executionEvidence: { outcome: 'proven_pre_apply' },
        resolution: { status: 'failed', terminal: true, recovery: 'not_required', proof: { kind: 'proven_pre_apply', mutationAttempted: false }, replay } });
}
async function assertSafety(value, requestDigest, attestation, resolver) {
    const parsed = embedImageResultSchema.parse(value);
    if ('items' in parsed.plan) {
        const batch = parsed;
        const batchPlan = batchSafetyPlan(batch, requestDigest, attestation?.documentKey);
        if (batch.transaction.state === 'planned')
            return;
        if (attestation === null || resolver === null)
            throw new Error('Embed terminal result requires attestation.');
        await assertOperationSafetyAdapterConformance({ registration: EMBED_IMAGE_SAFETY, plan: batchPlan, result: batchSafetyResult(batch, requestDigest, attestation, batchPlan) }, resolver);
        return;
    }
    const result = parsed;
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null)
        throw new Error('Embed terminal result requires attestation.');
    await assertOperationSafetyAdapterConformance({ registration: EMBED_IMAGE_SAFETY, plan, result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
export const EMBED_IMAGE_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}${ANCESTOR_STATE_SCRIPT}
var EMBED_IMAGE_MAX_DIRECT_ITEMS = ${EMBED_IMAGE_MAX_DIRECT_ITEMS};
var EMBED_IMAGE_TOLERANCE_PT = ${EMBED_IMAGE_TOLERANCE_PT};
var EMBED_IMAGE_PRECISION_DIGITS = ${EMBED_IMAGE_PRECISION_DIGITS};
${HOST_VERSION_POLICY_JSX}
var EMBED_IMAGE_MEASURED_COLOR_SPACES = ${JSON.stringify(EMBED_IMAGE_MEASURED_COLOR_SPACES)};
var EMBED_IMAGE_CMYK_MEASURED_SOURCES = ${JSON.stringify(EMBED_IMAGE_CMYK_MEASURED_SOURCES)};
var EMBED_IMAGE_CMYK_EXPECTED = ${JSON.stringify(EMBED_IMAGE_CMYK_EXPECTED)};
var EMBED_IMAGE_CMYK_MATRIX_TOLERANCE = ${EMBED_IMAGE_CMYK_MATRIX_TOLERANCE};
var EMBED_IMAGE_CMYK_UNIFORM_SCALE_TOLERANCE = ${EMBED_IMAGE_CMYK_UNIFORM_SCALE_TOLERANCE};
var EMBED_IMAGE_PPI_RELATIVE_TOLERANCE = ${EMBED_IMAGE_PPI_RELATIVE_TOLERANCE};

function embedRound(value) {
  var rounded = Number(mutationFiniteNumber(value, "geometry").toFixed(EMBED_IMAGE_PRECISION_DIGITS));
  return rounded === 0 ? 0 : rounded;
}
function embedNear(a, b) { return Math.abs(a - b) <= EMBED_IMAGE_TOLERANCE_PT; }
function embedContains(list, value) { for (var i = 0; i < list.length; i++) if (list[i] === value) return true; return false; }

/** Images resolve by direct native UUID reference, with the type taken from the item's own collection row; null when absent or of another type. */
function embedScan(document, type, uuid) {
  var resolved = resolvePageItem(document, uuid);
  return resolved !== null && resolved.typename === type ? resolved.item : null;
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
  if (params.sourceProfile && (params.sourceProfile.profile !== "cmyk_flat_raster_v1" || !params.sourceProfile.structure)) {
    throw mutationError("preflight_failed", "Source profile facts are inconsistent with the request.");
  }
  // A PSD/TIFF source is only ever embedded under the cmyk profile; without its facts the request fails closed.
  if (admission.status === "admitted" && (admission.format === "psd" || admission.format === "tiff") && !params.sourceProfile) {
    throw mutationError("preflight_failed", "A PSD or TIFF source requires the Node-side source profile facts.");
  }
}

function embedProfile() { return params.sourceProfile ? "cmyk_flat_raster_v1" : "rgb_direct_raster_v1"; }
/** The measured facts of this format and source colour space, or null. */
function embedCmykMeasuredSource(format, color) {
  var colors = EMBED_IMAGE_CMYK_MEASURED_SOURCES[format];
  return colors && Object.prototype.hasOwnProperty.call(colors, color) ? colors[color] : null;
}
function embedCmykStructureMeasured(measured, structure) {
  return structure.status === "flat" && structure.bitsPerChannel === 8 && structure.channels === measured.channels && structure.layers === measured.layers;
}
/** The linear matrix of a measured placement: upright (no rotation or shear), uniformly scaled, y-down as the measured placement. */
function embedMeasuredTransform(before) {
  var m = before.matrix;
  return Math.abs(m[1]) <= EMBED_IMAGE_CMYK_MATRIX_TOLERANCE && Math.abs(m[2]) <= EMBED_IMAGE_CMYK_MATRIX_TOLERANCE && m[0] > 0 && m[3] < 0 &&
    Math.abs(m[0] - Math.abs(m[3])) <= EMBED_IMAGE_CMYK_UNIFORM_SCALE_TOLERANCE * Math.abs(m[0]);
}
function embedEffectivePpi(pixels, width, height) {
  return [embedRound(pixels.width * 72 / Math.abs(width)), embedRound(pixels.height * 72 / Math.abs(height))];
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
  var ancestors = mutationAncestorState(item);
  var slot = embedSlot(item.layer, item);
  if (slot.index < 0) throw mutationError("preflight_failed", "Target is not a direct child of its layer.");
  var position = item.position, bounds = item.geometricBounds;
  if (!position || position.length !== 2 || !bounds || bounds.length !== 4) throw mutationError("preflight_failed", "Target geometry is unavailable.");
  return {
    uuid: String(item.uuid), layerPath: layerPath, layerIndex: slot.index, siblingUuids: slot.siblings, name: String(item.name || ""),
    position: [embedRound(position[0]), embedRound(position[1])],
    geometricBounds: [embedRound(bounds[0]), embedRound(bounds[1]), embedRound(bounds[2]), embedRound(bounds[3])],
    locked: item.locked, hidden: item.hidden, layerVisible: item.layer.visible, layerLocked: item.layer.locked,
    ancestorLocked: ancestors.ancestorLocked, ancestorHidden: ancestors.ancestorHidden
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
    locked: snapshot.locked, hidden: snapshot.hidden, layerVisible: snapshot.layerVisible, layerLocked: snapshot.layerLocked, ancestorLocked: snapshot.ancestorLocked, ancestorHidden: snapshot.ancestorHidden,
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
    locked: snapshot.locked, hidden: snapshot.hidden, layerVisible: snapshot.layerVisible, layerLocked: snapshot.layerLocked, ancestorLocked: snapshot.ancestorLocked, ancestorHidden: snapshot.ancestorHidden,
    embedded: raster.embedded === true,
    pixels: { width: Math.round(Math.abs(Number(box[2]) - Number(box[0]))), height: Math.round(Math.abs(Number(box[1]) - Number(box[3]))) }
  };
}

function embedBeforeMatches(left, right) {
  if (!left || !right || left.type !== right.type || !mutationSameSequence(left.layerPath, right.layerPath) || left.layerIndex !== right.layerIndex ||
      !mutationSameSequence(left.siblingUuids, right.siblingUuids) || left.name !== right.name || left.linkPath !== right.linkPath ||
      left.locked !== right.locked || left.hidden !== right.hidden || left.layerVisible !== right.layerVisible || left.layerLocked !== right.layerLocked ||
      left.ancestorLocked !== right.ancestorLocked || left.ancestorHidden !== right.ancestorHidden) return false;
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
      left.locked !== right.locked || left.hidden !== right.hidden || left.layerVisible !== right.layerVisible || left.layerLocked !== right.layerLocked ||
      left.ancestorLocked !== right.ancestorLocked || left.ancestorHidden !== right.ancestorHidden) return false;
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
    locked: before.locked, hidden: before.hidden, layerVisible: before.layerVisible, layerLocked: before.layerLocked, ancestorLocked: before.ancestorLocked, ancestorHidden: before.ancestorHidden,
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
  var target = embedScan(document, "PlacedItem", params.targetUuid);
  if (target === null) {
    var embedded = embedScan(document, "RasterItem", params.targetUuid) !== null;
    throw new Error("MCP_ERROR:" + stringifyJson({ code: embedded ? "EMBED_TARGET_NOT_LINKED" : "OBJECT_NOT_FOUND", uuid: params.targetUuid }));
  }
  var before = embedBeforeSnapshot(document, target);
  var blockers = [];
  function block(code) { if (!embedContains(blockers, code)) blockers.push(code); }
  if (!context.mutationAllowed) block("document_not_saved");
  if (context.path !== params.backup.sourcePath) block("backup_mismatch");
  else if (context.fileRevision !== params.backup.sourceFileRevision) block("backup_stale");
  if (!hostVersionAdmitted("embed_image", String(app.version))) block("host_version_unmeasured");
  var profile = embedProfile();
  if (context.colorSpace !== (profile === "cmyk_flat_raster_v1" ? "CMYK" : "RGB")) block("document_color_space_unmeasured");
  if (before.locked) block("target_locked");
  if (before.hidden) block("target_hidden");
  if (!before.layerVisible) block("layer_hidden");
  if (before.layerLocked) block("layer_locked");
  if (before.ancestorHidden) block("ancestor_hidden");
  if (before.ancestorLocked) block("ancestor_locked");
  if (before.linkPath === null || !(new File(before.linkPath)).exists) block("link_missing");
  // A broken link (file throws) reads as a placeholder path, which no admitted source equals.
  if (before.linkPath === null) before.linkPath = "/unavailable";
  var admission = params.sourceAdmission;
  if (admission.status === "blocked") block(admission.reason);
  else {
    if (admission.resolvedPath !== before.linkPath) block("link_path_mismatch");
    if (!admission.pixels) block("source_pixels_unknown");
    if (profile === "cmyk_flat_raster_v1") {
      var measuredSource = params.sourceColorSpace.status === "available" ? embedCmykMeasuredSource(admission.format, params.sourceColorSpace.value) : null;
      if (measuredSource === null) block("source_color_space_unmeasured");
      if (params.sourceProfile.icc !== "present") block("source_icc_unmeasured");
      if (measuredSource !== null && !embedCmykStructureMeasured(measuredSource, params.sourceProfile.structure)) block("source_structure_unmeasured");
      if (!embedMeasuredTransform(before)) block("target_transform_unmeasured");
    } else if (params.sourceColorSpace.status !== "available" || !embedContains(EMBED_IMAGE_MEASURED_COLOR_SPACES, params.sourceColorSpace.value)) block("source_color_space_unmeasured");
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
  var plan = {
    operation: "embed_image", documentKey: preflight.context.key, backup: params.backup,
    source: { path: params.source.path, sha256: params.source.sha256 }, sourceAdmission: params.sourceAdmission, sourceColorSpace: params.sourceColorSpace,
    before: preflight.before, after: preflight.after,
    applyBlockedReasonCodes: preflight.blockers, confirmationStatus: params.apply === true ? "confirmed" : "required",
    applyAllowed: params.apply === true && preflight.blockers.length === 0
  };
  if (params.sourceProfile) plan.sourceProfile = params.sourceProfile;
  return plan;
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

/**
 * Measured wrapper: embed() of a PSD/TIFF in a CMYK document leaves a GroupItem holding exactly one CMYK
 * RasterItem in the slot. Only that exact form is normalised, with the measured primitive; anything else throws and,
 * because embed() already returned, stays indeterminate.
 */
function embedUnwrap(layer, group, plan, state) {
  var admission = params.sourceAdmission;
  var tags = group.tags;
  var tagsMeasured = tags.length === 0 || (tags.length === 1 && String(tags[0].name) === "BBAccumRotation" && Number(tags[0].value) === 0);
  var visibilityVariable;
  try { visibilityVariable = group.visibilityVariable; } catch (readError) { visibilityVariable = undefined; }
  if (group.parent !== layer || group.clipped || group.locked || group.hidden || Number(group.opacity) !== 100 || String(group.blendingMode) !== "BlendModes.NORMAL" ||
      String(group.note) !== "" || String(group.uRL) !== "" || group.isIsolated || group.sliced || group.wrapped || !tagsMeasured || visibilityVariable !== null) {
    throw mutationError("apply_failed", "The embedded item's wrapper group is not the measured plain wrapper.");
  }
  if (group.pageItems.length !== 1 || String(group.pageItems[0].typename) !== "RasterItem" || group.pageItems[0].parent !== group) {
    throw mutationError("apply_failed", "The embedded item's wrapper group does not hold exactly one RasterItem.");
  }
  var child = group.pageItems[0];
  var groupBounds = group.geometricBounds, childBounds = child.geometricBounds;
  for (var b = 0; b < 4; b++) if (!embedNear(Number(groupBounds[b]), Number(childBounds[b]))) throw mutationError("apply_failed", "The wrapper group and its raster have different bounds.");
  var box = child.boundingBox;
  if (child.embedded !== true || String(child.imageColorSpace) !== EMBED_IMAGE_CMYK_EXPECTED.imageColorSpace || Number(child.bitsPerChannel) !== EMBED_IMAGE_CMYK_EXPECTED.bitsPerChannel ||
      Number(child.channels) !== EMBED_IMAGE_CMYK_EXPECTED.channels || Math.round(Math.abs(Number(box[2]) - Number(box[0]))) !== admission.pixels.width ||
      Math.round(Math.abs(Number(box[1]) - Number(box[3]))) !== admission.pixels.height) {
    throw mutationError("apply_failed", "The wrapped raster is not the CMYK 8-bit 4-channel raster of the admitted pixels.");
  }
  child.move(group, ElementPlacement.PLACEBEFORE);
  if (child.parent !== layer || group.pageItems.length !== 0) throw mutationError("apply_failed", "The raster did not move out of its wrapper group.");
  group.remove();
  var slot = layer.pageItems.length > plan.before.layerIndex ? layer.pageItems[plan.before.layerIndex] : null;
  if (slot !== child) throw mutationError("apply_failed", "The raster did not take the wrapper group's slot.");
  state.operationState.wrapperDisposition = "unwrap_single_raster_group";
  return child;
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
    state.operationState.wrapperDisposition = "direct_raster";
    if (embedProfile() === "cmyk_flat_raster_v1" && slot !== null && String(slot.typename) === "GroupItem") slot = embedUnwrap(layer, slot, plan, state);
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
  var raster = embedScan(document, "RasterItem", afterUuid);
  if (raster === null || raster !== state.applyValue) throw mutationError("verify_mismatch", "The new native UUID does not resolve to the embedded raster.");
  if (embedScan(document, "PlacedItem", plan.before.uuid) !== null) throw mutationError("verify_mismatch", "The linked item still resolves after embedding.");
  var counts = state.operationState.counts;
  if (document.placedItems.length !== counts.placed - 1 || document.rasterItems.length !== counts.raster + 1) throw mutationError("verify_mismatch", "The placed and raster counts did not change by exactly one.");
  var actual = embedRasterSnapshot(document, raster);
  if (!embedAfterMatches(actual, plan.after)) throw mutationError("verify_mismatch", "The embedded raster does not match the planned after state.");
  var matrix = raster.matrix, box = raster.boundingBox;
  var profileEvidence = {};
  if (embedProfile() === "cmyk_flat_raster_v1") {
    if (String(raster.imageColorSpace) !== EMBED_IMAGE_CMYK_EXPECTED.imageColorSpace || Number(raster.bitsPerChannel) !== EMBED_IMAGE_CMYK_EXPECTED.bitsPerChannel || Number(raster.channels) !== EMBED_IMAGE_CMYK_EXPECTED.channels) {
      throw mutationError("verify_mismatch", "The embedded raster is not CMYK 8-bit 4-channel.");
    }
    var ppiBefore = embedEffectivePpi(plan.after.pixels, plan.before.width, plan.before.height);
    var ppiAfter = embedEffectivePpi(actual.pixels, raster.width, raster.height);
    for (var q = 0; q < 2; q++) if (Math.abs(ppiBefore[q] - ppiAfter[q]) > EMBED_IMAGE_PPI_RELATIVE_TOLERANCE * ppiBefore[q]) throw mutationError("verify_mismatch", "The effective PPI changed by embedding.");
    profileEvidence = { profile: "cmyk_flat_raster_v1", wrapperDisposition: state.operationState.wrapperDisposition, effectivePpiBefore: ppiBefore, effectivePpiAfter: ppiAfter };
  }
  var evidence = {
      matrix: [embedRound(matrix.mValueA), embedRound(matrix.mValueB), embedRound(matrix.mValueC), embedRound(matrix.mValueD), embedRound(matrix.mValueTX), embedRound(matrix.mValueTY)],
      boundingBox: [embedRound(box[0]), embedRound(box[1]), embedRound(box[2]), embedRound(box[3])],
      imageColorSpace: String(raster.imageColorSpace), bitsPerChannel: Number(raster.bitsPerChannel), channels: Number(raster.channels),
      nameRestored: state.operationState.nameRestored === true,
      placedCountBefore: counts.placed, placedCountAfter: document.placedItems.length, rasterCountBefore: counts.raster, rasterCountAfter: document.rasterItems.length,
      saved: document.saved === true
  };
  for (var key in profileEvidence) if (Object.prototype.hasOwnProperty.call(profileEvidence, key)) evidence[key] = profileEvidence[key];
  return { raster: actual, evidence: evidence };
}

var EMBED_RECOVERY_MESSAGE = "An embedded image cannot be un-embedded in the same call. The command keeps the Illustrator lock until illustrator_reconcile action=release_unverified releases it; the document file is unchanged and equals the backup, so the before state is restored by closing the document without saving and reopening its file.";

/** Only an embed() that threw can be proven harmless: the linked item still reads back as the before state. */
function embedRollback(state) {
  var preflight = state.preflight;
  if (state.operationState.embedReturned === true) return { status: "indeterminate", message: EMBED_RECOVERY_MESSAGE };
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) return { status: "indeterminate", message: "Rollback document identity is indeterminate. " + EMBED_RECOVERY_MESSAGE };
  var target = embedScan(preflight.document, "PlacedItem", preflight.before.uuid);
  if (target === null || target !== preflight.target) return { status: "indeterminate", message: "The linked item no longer resolves under its UUID. " + EMBED_RECOVERY_MESSAGE };
  var current;
  try { current = embedBeforeSnapshot(preflight.document, target); } catch (error) { return { status: "indeterminate", message: "Rollback target state is indeterminate. " + EMBED_RECOVERY_MESSAGE }; }
  if (current.uuid !== preflight.before.uuid || !embedBeforeMatches(current, preflight.before)) return { status: "indeterminate", message: "The linked item changed although embed() failed. " + EMBED_RECOVERY_MESSAGE };
  state.operationState.rollbackEvidence.unchangedSnapshot = current;
  return { status: "verified" };
}

${EMBED_IMAGE_BATCH_HOST_SCRIPT}
var embedExecution = runMutationTransaction(params.items !== undefined ? embedBatchDefinition() : {
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
function normalizedBatchRequest(input) {
    const request = embedBatchInternalInputSchema.parse(input);
    const { commandId: _commandId, backup: _b, resultTooLarge: _r, items, ...rest } = request;
    const digestItems = items.map(({ sourceAdmission: _s, sourceColorSpace: _c, sourceModifiedAtMs: _m, ...item }) => item);
    const digest = canonicalSha256({ operation: EMBED_IMAGE_OPERATION, validator: EMBED_IMAGE_VALIDATOR, request: { ...rest, items: digestItems } });
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: 'commandId' in request ? request.commandId : null, documentKey: request.expectedDocumentKey, digest };
}
function normalizedRequest(input) {
    if (isEmbedBatchInput(input))
        return normalizedBatchRequest(input);
    const request = internalInputSchema.parse(input);
    const { commandId: _commandId, sourceAdmission: _s, sourceColorSpace: _c, sourceProfile: _p, sourceModifiedAtMs: _m, backup: _b, ...digestRequest } = request;
    const digest = canonicalSha256({ operation: EMBED_IMAGE_OPERATION, validator: EMBED_IMAGE_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: 'commandId' in request ? request.commandId : null, documentKey: request.expectedDocumentKey, digest };
}
export const embedImageToolContract = {
    name: 'illustrator_embed_image',
    title: 'Plan or Embed Linked Image',
    description: 'Plan or embed linked, layer-direct PlacedItems (native UUIDs, bound by document key) into the document so illustrator_optimize_images can process them: one item (target_uuid, source) or 1 to 16 in one plan and one apply (items, one backup, one command_id, JPEG/PNG RGB only; batch limits: each source <=4000000 pixels, at most two above 960000 pixels, total <=21440000 pixels, checked from source inspection before Host dispatch on plan and apply; split oversized batches without resizing sources; any blocked item embeds none; a failure after the first embed is indeterminate and never undone). Irreversible: requires a verified backup (illustrator_create_backup) of the clean saved file, plus each linked file\'s absolute path and SHA-256. Supported: RGB documents with JPEG or PNG RGB sources; CMYK documents with flat 8-bit PSD (RGB/CMYK) or TIFF (CMYK) sources carrying an ICC profile. Needs Illustrator in the foreground, screen unlocked. Apply must echo expected_before and confirmed_after from the plan. Refused: missing or changed links, locked or hidden items, items in groups, dirty or unsaved documents, backup mismatch. The document is then unsaved; save it with illustrator_save_document and the same backup_id. No in-call undo: a failure after embedding keeps the Illustrator lock until illustrator_reconcile action=release_unverified; closing without saving restores the before state.',
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
        hostVersionOperation: () => 'embed_image',
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
            if (detail?.code === 'EMBED_IMAGE_APPLY_BLOCKED') {
                const items = Array.isArray(detail.items) ? detail.items : [];
                const perItem = items.map((item) => `item ${(item.index ?? 0) + 1}: ${(item.codes ?? []).join(', ')}`).join('; ');
                return new Error(`Embedding is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}${perItem === '' ? '' : ` (${perItem}). Nothing was embedded`}.`);
            }
            if (detail?.code === 'DOCUMENT_NOT_SAVED')
                return new Error(`document_not_saved: ${detail.message ?? 'only a clean saved document can be embedded into'}. Nothing was embedded.`);
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
