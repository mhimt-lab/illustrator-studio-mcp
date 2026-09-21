import { realpath } from 'node:fs/promises';
import { z } from 'zod';
import { canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, layerPathSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
export const PLACE_IMAGE_OPERATION = 'place_image';
export const PLACE_IMAGE_VALIDATOR = { kind: PLACE_IMAGE_OPERATION, version: 1 };
export const PLACE_IMAGE_MAX_DIRECT_ITEMS = 128;
export const PLACE_IMAGE_MAX_LAYER_DEPTH = 64;
export const PLACE_IMAGE_TOLERANCE_PT = 0.01;
export const PLACE_IMAGE_MAX_COORDINATE_PT = 16_383;
export const PLACE_IMAGE_PRECISION_DIGITS = 6;
export const PLACE_IMAGE_MAX_PATH_LENGTH = 4_096;
export const PLACE_IMAGE_MEASURED_FORMATS = ['tiff', 'jpeg', 'png', 'psd'];
const CANONICAL_VERSION = 1;
const RESULT_SCHEMA_VERSION = 1;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
const canonicalNumberSchema = z.number().finite().min(-PLACE_IMAGE_MAX_COORDINATE_PT).max(PLACE_IMAGE_MAX_COORDINATE_PT)
    .overwrite((value) => Object.is(value, -0) ? 0 : value);
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const absolutePathSchema = z.string().min(2).max(PLACE_IMAGE_MAX_PATH_LENGTH)
    .regex(/^\/(?!(?:.*\/)?\.\.(?:\/|$))[^\0]*$/u, 'Source path must be an absolute path without NUL or parent-directory segments.');
const sourceSchema = z.strictObject({ path: absolutePathSchema, sha256: sha256Schema });
const anchorSchema = z.strictObject({ x: canonicalNumberSchema, y: canonicalNumberSchema });
const formatSchema = z.enum(PLACE_IMAGE_MEASURED_FORMATS);
const dimensionsSchema = z.strictObject({ width: z.number().int().positive(), height: z.number().int().positive() });
const ppiSchema = z.strictObject({ x: z.number().finite().positive(), y: z.number().finite().positive() });
export const sourceBlockerSchema = z.enum([
    'source_file_missing', 'source_file_unavailable', 'source_hash_mismatch', 'source_format_unmeasured',
]);
export const placeImageAdmissionSchema = z.discriminatedUnion('status', [
    z.strictObject({
        status: z.literal('admitted'),
        resolvedPath: absolutePathSchema,
        bytes: z.number().int().positive(),
        modifiedAt: z.string().min(1).max(64),
        sha256: sha256Schema,
        format: formatSchema,
        pixels: dimensionsSchema.nullable(),
        nativePpi: ppiSchema.nullable(),
    }),
    z.strictObject({
        status: z.literal('blocked'),
        resolvedPath: absolutePathSchema.nullable(),
        reason: sourceBlockerSchema,
        message: z.string().min(1).max(500),
    }),
]);
const commonRequest = {
    expectedDocumentKey: z.string().min(1).max(16_384),
    expectedLayerPath: layerPathSchema,
    artboardIndex: z.number().int().safe().nonnegative(),
    source: sourceSchema,
    anchor: anchorSchema,
    name: z.string().max(255).optional(),
};
const unadmittedInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonRequest, apply: z.literal(false) }),
    z.strictObject({ ...commonRequest, apply: z.literal(true), commandId: canonicalCommandIdSchema }),
]);
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonRequest, admission: placeImageAdmissionSchema.optional(), apply: z.literal(false) }),
    z.strictObject({ ...commonRequest, admission: placeImageAdmissionSchema.optional(), apply: z.literal(true), commandId: canonicalCommandIdSchema }),
]).superRefine((request, context) => {
    if (request.admission?.status === 'admitted' && request.admission.sha256 !== request.source.sha256) {
        context.addIssue({ code: 'custom', message: 'An admitted source must carry the requested SHA-256.' });
    }
});
const commonPublic = {
    expected_document_key: z.string().min(1).max(16_384),
    expected_layer_path: layerPathSchema,
    artboard_index: z.number().int().safe().nonnegative(),
    source: sourceSchema,
    anchor: anchorSchema,
    name: z.string().max(255).optional(),
};
export const placeImagePublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({ ...commonPublic, apply: z.literal(true), command_id: canonicalCommandIdSchema }),
]);
const inputSchema = z.strictObject({ ...commonPublic, apply: z.boolean().default(false), command_id: canonicalCommandIdSchema.optional() });
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(placeImagePublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = placeImagePublicInputSchema.parse(input);
    const common = {
        expectedDocumentKey: value.expected_document_key, expectedLayerPath: value.expected_layer_path,
        artboardIndex: value.artboard_index, source: value.source, anchor: value.anchor,
        ...(value.name === undefined ? {} : { name: value.name }),
    };
    return value.apply ? { ...common, apply: true, commandId: value.command_id } : { ...common, apply: false };
}
export async function admitPlaceImageRequest(input, services) {
    const request = unadmittedInputSchema.parse(input);
    return { ...request, admission: await admitSource(request.source, services.imageFileInspector) };
}
export async function admitSource(source, inspector) {
    return (await admitSourceWithColorSpace(source, inspector)).admission;
}
export async function admitSourceWithColorSpace(source, inspector) {
    const admission = await admitSourceInspection(source, inspector);
    return admission.status === 'admitted' ? { admission: admission.value, colorSpace: admission.colorSpace } : { admission: admission.value, colorSpace: null };
}
async function admitSourceInspection(source, inspector) {
    const blocked = (value) => ({ status: 'blocked', value });
    let resolvedPath;
    try {
        resolvedPath = await realpath(source.path);
    }
    catch (error) {
        const code = error?.code;
        if (code === 'ENOENT' || code === 'ENOTDIR') {
            return blocked({ status: 'blocked', resolvedPath: null, reason: 'source_file_missing', message: `Source file ${source.path} does not exist.` });
        }
        return blocked({ status: 'blocked', resolvedPath: null, reason: 'source_file_unavailable', message: boundedMessage(error) });
    }
    if (!absolutePathSchema.safeParse(resolvedPath).success) {
        return blocked({ status: 'blocked', resolvedPath: null, reason: 'source_file_unavailable', message: 'Resolved source path is not an admissible absolute path.' });
    }
    const inspection = await inspector.inspect(resolvedPath);
    if (inspection.status === 'missing') {
        return blocked({ status: 'blocked', resolvedPath, reason: 'source_file_missing', message: `Source file ${resolvedPath} does not exist.` });
    }
    if (inspection.status === 'unavailable') {
        return blocked({ status: 'blocked', resolvedPath, reason: 'source_file_unavailable', message: `${inspection.reason}: ${inspection.message}` });
    }
    if (inspection.file.sha256 !== source.sha256) {
        return blocked({ status: 'blocked', resolvedPath, reason: 'source_hash_mismatch',
            message: `Source file SHA-256 ${inspection.file.sha256} does not match the requested ${source.sha256}.` });
    }
    const format = inspection.metadata.format;
    if (format.status !== 'available') {
        return blocked({ status: 'blocked', resolvedPath, reason: 'source_format_unmeasured', message: format.message });
    }
    const pixels = inspection.metadata.pixels;
    const ppi = inspection.metadata.nativePpi;
    return { status: 'admitted', colorSpace: inspection.metadata.colorSpace, value: {
            status: 'admitted', resolvedPath, bytes: inspection.file.bytes, modifiedAt: inspection.file.modifiedAt,
            sha256: inspection.file.sha256, format: format.value,
            pixels: pixels.status === 'available' ? { width: pixels.value.width, height: pixels.value.height } : null,
            nativePpi: ppi.status === 'available' ? { x: ppi.value.x, y: ppi.value.y } : null,
        } };
}
function boundedMessage(error) {
    const raw = error instanceof Error ? error.message : String(error);
    return (raw.length > 0 ? raw : 'Unknown source admission error.').slice(0, 500);
}
function round(value) {
    const rounded = Number(value.toFixed(PLACE_IMAGE_PRECISION_DIGITS));
    return Object.is(rounded, -0) ? 0 : rounded;
}
export function derivePlacePosition(artboardBounds, anchor) {
    return [round(artboardBounds[0] + anchor.x), round(artboardBounds[1] - anchor.y)];
}
const layerStateSchema = z.strictObject({
    path: layerPathSchema,
    name: z.string().max(255),
    visible: z.boolean(),
    locked: z.boolean(),
    itemUuids: z.array(z.string().min(1).max(255)).max(PLACE_IMAGE_MAX_DIRECT_ITEMS),
    ancestry: z.array(z.strictObject({ name: z.string().max(255), visible: z.boolean(), locked: z.boolean() }))
        .min(1).max(PLACE_IMAGE_MAX_LAYER_DEPTH),
});
const hostBlockerSchema = z.enum(['document_mutation_not_allowed', 'layer_hidden', 'layer_locked', 'layer_item_capacity_exceeded', 'source_file_changed']);
const blockerSchema = z.enum([...hostBlockerSchema.options, ...sourceBlockerSchema.options]);
const boundsSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
const positionSchema = z.tuple([z.number().finite(), z.number().finite()]);
const matrixSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
const planSchema = z.strictObject({
    operation: z.literal(PLACE_IMAGE_OPERATION),
    documentKey: z.string().min(1).max(16_384),
    coordinateSpace: z.literal('artboard_top_left'),
    unit: z.literal('pt'),
    artboardIndex: z.number().int().nonnegative(),
    artboardBounds: boundsSchema,
    source: sourceSchema,
    admission: placeImageAdmissionSchema,
    anchor: anchorSchema,
    position: positionSchema,
    name: z.string().max(255).nullable(),
    layer: layerStateSchema,
    applyBlockedReasonCodes: z.array(blockerSchema),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    if (plan.applyAllowed !== (plan.applyBlockedReasonCodes.length === 0)) {
        context.addIssue({ code: 'custom', message: 'Image placement applyAllowed must require no blockers.' });
    }
    const derived = derivePlacePosition(plan.artboardBounds, plan.anchor);
    if (plan.position[0] !== derived[0] || plan.position[1] !== derived[1]) {
        context.addIssue({ code: 'custom', message: 'Image placement plan position must equal the position derived from the anchor exactly.' });
    }
    if (plan.admission.status === 'admitted' && plan.admission.sha256 !== plan.source.sha256) {
        context.addIssue({ code: 'custom', message: 'Image placement admission must carry the requested SHA-256.' });
    }
});
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']), reasonCode: z.enum(['apply_failed', 'verify_mismatch']), message: z.string().min(1).max(500),
}).superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed')) {
        context.addIssue({ code: 'custom', message: 'Image placement failure phase and reason code must match.' });
    }
});
const indeterminateFailureSchema = z.strictObject({
    phase: z.literal('apply'), reasonCode: z.literal('apply_indeterminate'), message: z.string().min(1).max(500),
});
const rollbackEvidence = {
    createdUuid: z.string().min(1).max(255).nullable(),
    restoredItemUuids: z.array(z.string().min(1).max(255)).nullable(),
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
            message: z.string().min(1).max(500), createdUuid: z.null(), restoredItemUuids: z.null() }), audit: mutationAuditSchema }),
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
                ? 'rollback:succeeded:' : `rollback:failed:${transaction.state === 'rollback_failed' ? 'rollback_failed' : 'rollback_indeterminate'}`];
    }
    const actual = transaction.audit.map((event) => `${event.phase}:${event.event}:${'reasonCode' in event ? event.reasonCode : ''}`);
    if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
        context.addIssue({ code: 'custom', message: 'Image placement audit sequence does not match transaction state.' });
    }
    transaction.audit.forEach((event, index) => {
        if (event.sequence !== index)
            context.addIssue({ code: 'custom', message: 'Image placement audit sequence must be contiguous.' });
    });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' && event.phase === transaction.failure.phase &&
            event.reasonCode === transaction.failure.reasonCode && event.message === transaction.failure.message);
        if (matches.length !== 1)
            context.addIssue({ code: 'custom', message: 'Image placement failure must match one audit event.' });
    }
});
const createdSchema = z.strictObject({
    uuid: z.string().min(1).max(255),
    type: z.literal('PlacedItem'),
    name: z.string().max(255),
    filePath: absolutePathSchema,
    position: positionSchema,
    geometricBounds: boundsSchema,
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
    matrix: matrixSchema,
    layerItemUuids: z.array(z.string().min(1).max(255)).min(1).max(PLACE_IMAGE_MAX_DIRECT_ITEMS + 1),
});
function nodeDerivedBlockers(result, planned) {
    const blockers = new Set();
    if (planned && !result.document.mutationAllowed)
        blockers.add('document_mutation_not_allowed');
    if (result.plan.layer.ancestry.some((ancestor) => !ancestor.visible))
        blockers.add('layer_hidden');
    if (result.plan.layer.ancestry.some((ancestor) => ancestor.locked))
        blockers.add('layer_locked');
    if (result.plan.layer.itemUuids.length >= PLACE_IMAGE_MAX_DIRECT_ITEMS)
        blockers.add('layer_item_capacity_exceeded');
    if (result.plan.admission.status === 'blocked')
        blockers.add(result.plan.admission.reason);
    return blockers;
}
export const placeImageResultSchema = z.union([
    z.strictObject({ operation: z.literal(PLACE_IMAGE_OPERATION), applied: z.literal(false),
        document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ operation: z.literal(PLACE_IMAGE_OPERATION), applied: z.literal(true),
        document: documentContextSchema, plan: planSchema, created: createdSchema, transaction: transactionSchema }),
]).superRefine((result, context) => {
    const derived = nodeDerivedBlockers(result, result.transaction.state === 'planned');
    const reported = new Set(result.plan.applyBlockedReasonCodes);
    if (result.transaction.state === 'planned') {
        for (const blocker of derived)
            if (!reported.has(blocker))
                context.addIssue({ code: 'custom', message: `Planned image placement must expose blocker ${blocker}.` });
        for (const blocker of reported) {
            if (!derived.has(blocker) && blocker !== 'source_file_changed' && blocker !== 'source_file_missing') {
                context.addIssue({ code: 'custom', message: `Planned image placement reports an underivable blocker ${blocker}.` });
            }
        }
    }
    else if (reported.size !== 0 || !result.plan.applyAllowed || derived.size !== 0 || result.plan.admission.status !== 'admitted') {
        context.addIssue({ code: 'custom', message: 'Applied image placement must derive from an allowed, admitted plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified') {
            context.addIssue({ code: 'custom', message: 'A placed image must come from a verified transaction.' });
        }
        if (result.created.layerItemUuids[0] !== result.created.uuid ||
            result.created.layerItemUuids.length !== result.plan.layer.itemUuids.length + 1 ||
            result.created.layerItemUuids.slice(1).some((uuid, index) => uuid !== result.plan.layer.itemUuids[index])) {
            context.addIssue({ code: 'custom', message: 'A placed image must be the only new item, at the front, with the prior order intact.' });
        }
        const admission = result.plan.admission;
        if (Math.abs(result.created.position[0] - result.plan.position[0]) > PLACE_IMAGE_TOLERANCE_PT ||
            Math.abs(result.created.position[1] - result.plan.position[1]) > PLACE_IMAGE_TOLERANCE_PT ||
            (admission.status === 'admitted' && result.created.filePath !== admission.resolvedPath) ||
            (result.plan.name !== null && result.created.name !== result.plan.name)) {
            context.addIssue({ code: 'custom', message: 'A placed image must match the planned position, source path, and name.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified image placement must report the created item.' });
    }
    if (result.transaction.state === 'rolled_back') {
        const rollback = result.transaction.rollback;
        if (rollback.createdUuid === null || rollback.restoredItemUuids === null ||
            canonicalSha256(rollback.restoredItemUuids) !== canonicalSha256(result.plan.layer.itemUuids)) {
            context.addIssue({ code: 'custom', message: 'A rolled-back image placement must name the removed UUID and prove the exact baseline order.' });
        }
    }
    if (result.transaction.state === 'rollback_failed') {
        const rollback = result.transaction.rollback;
        if (rollback.createdUuid === null || rollback.restoredItemUuids === null || !rollback.restoredItemUuids.includes(rollback.createdUuid)) {
            context.addIssue({ code: 'custom', message: 'A failed image placement rollback must name the UUID that is still present and prove it in the read-back order.' });
        }
    }
});
export const placeImageResponseSchema = z.strictObject({
    outcome: placeImageResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
export const PLACE_IMAGE_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: PLACE_IMAGE_OPERATION,
    policy: {
        version: 1, class: 'create', destructive: false,
        evidence: { identity: 'native_uuid', ownership: 'self_created_only', postcondition: 'created_state_matches_plan' },
        preconditions: { documentBinding: 'explicit_document_key', targetValidation: 'same_execution_before_apply' },
        confirmation: 'risk_scoped',
        recovery: { mode: 'remove_self_created_uuid', verification: 'native_uuid_absent', unknownIdentity: 'indeterminate' },
        terminal: { success: 'verified', failure: 'proven_pre_apply_or_verified_recovery', partialSuccess: 'nonterminal_until_reconciled' },
        replay: { requestBinding: 'canonical_request_digest', retry: 'return_attested_terminal_result', beforeTerminal: 'reconcile_required', reapplyOnRetry: false },
    },
    capabilities: {
        class: 'create', explicitDocumentBinding: true, validateTargetsBeforeApply: true, captureNativeUuid: true,
        verifyCreatedState: true, rollbackSelfCreatedUuidOnly: true, verifyRollbackAbsence: true, reconcileIndeterminate: true,
        durableTerminalReplay: true, trustedTerminalAttestationResolver: true,
    },
});
export const PLACE_IMAGE_SAFETY_IDENTITY = canonicalDigest(PLACE_IMAGE_SAFETY);
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'create', operationId: PLACE_IMAGE_OPERATION, canonicalRequestDigest: requestDigest,
        evidence: { documentKey: admissionDocumentKey,
            targetLocator: `layer:${result.plan.layer.path.join('.')};artboard:${result.plan.artboardIndex};source:${result.plan.source.sha256}` },
        preconditions: { status: result.plan.applyBlockedReasonCodes.length === 0 ? 'satisfied' : 'blocked',
            targetsValidated: result.plan.applyBlockedReasonCodes.length === 0 },
        confirmation: { kind: 'risk_scoped', status: 'not_required' },
        applyAllowed: result.plan.applyAllowed,
    });
}
function safetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' || transaction.state === 'rollback_indeterminate') {
        throw new Error('Indeterminate image placement cannot be terminal.');
    }
    const common = { policyVersion: 1, operationClass: 'create', operationId: PLACE_IMAGE_OPERATION,
        canonicalRequestDigest: requestDigest, planDigest: plan.planDigest, attestation };
    if (result.applied && transaction.state === 'verified') {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { nativeUuid: result.created.uuid, ownership: 'self_created_only', postconditionVerified: true, outstandingEffect: null },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'succeeded', terminal: true, recovery: 'not_required', proof: { kind: 'verified_postcondition' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    if (transaction.state === 'rolled_back') {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { nativeUuid: transaction.rollback.createdUuid, ownership: 'self_created_only', postconditionVerified: false, outstandingEffect: null },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'recovered', terminal: true, recovery: 'verified', proof: { kind: 'verified_recovery' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    if (transaction.state === 'rollback_failed') {
        const nativeUuid = transaction.rollback.createdUuid;
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { nativeUuid, ownership: 'self_created_only', postconditionVerified: false,
                outstandingEffect: nativeUuid === null ? null : { kind: 'native_uuid_still_present', nativeUuid } },
            executionEvidence: { outcome: 'recovery_failed' },
            resolution: { status: 'recovery_failed', terminal: true, recovery: 'failed', outstandingEffect: 'known_effect_present',
                proof: { kind: 'verified_outstanding_effect' }, replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    return operationSafetyResultSchema.parse({ ...common,
        evidence: { nativeUuid: null, ownership: 'self_created_only', postconditionVerified: false, outstandingEffect: null },
        executionEvidence: { outcome: 'proven_pre_apply' },
        resolution: { status: 'failed', terminal: true, recovery: 'not_required', proof: { kind: 'proven_pre_apply', mutationAttempted: false },
            replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
}
async function assertSafety(value, requestDigest, attestation, resolver) {
    const result = placeImageResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null)
        throw new Error('Image placement terminal result requires attestation.');
    await assertOperationSafetyAdapterConformance({ registration: PLACE_IMAGE_SAFETY, plan, result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
export const PLACE_IMAGE_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
var PLACE_IMAGE_MAX_DIRECT_ITEMS = ${PLACE_IMAGE_MAX_DIRECT_ITEMS};
var PLACE_IMAGE_MAX_LAYER_DEPTH = ${PLACE_IMAGE_MAX_LAYER_DEPTH};
var PLACE_IMAGE_TOLERANCE_PT = ${PLACE_IMAGE_TOLERANCE_PT};
var PLACE_IMAGE_PRECISION_DIGITS = ${PLACE_IMAGE_PRECISION_DIGITS};

function placeRound(value) {
  var rounded = Number(mutationFiniteNumber(value, "geometry").toFixed(PLACE_IMAGE_PRECISION_DIGITS));
  return rounded === 0 ? 0 : rounded;
}

/** Re-checks every plan-side rejection so a caller cannot reach the host with an unadmitted request. */
function placeValidateRequest() {
  var source = params.source;
  if (!source || typeof source.path !== "string" || source.path.length < 2 || source.path.charAt(0) !== "/") {
    throw mutationError("preflight_failed", "Source path must be an absolute path.");
  }
  if (typeof source.sha256 !== "string" || source.sha256.length !== 64) throw mutationError("preflight_failed", "Source SHA-256 is required.");
  var admission = params.admission;
  if (!admission || (admission.status !== "admitted" && admission.status !== "blocked")) {
    throw mutationError("preflight_failed", "Source admission is missing; the request did not pass Node-side file admission.");
  }
  if (admission.status === "admitted") {
    if (typeof admission.resolvedPath !== "string" || admission.resolvedPath.charAt(0) !== "/" || admission.sha256 !== source.sha256 ||
        typeof admission.bytes !== "number" || admission.bytes <= 0 || typeof admission.format !== "string") {
      throw mutationError("preflight_failed", "Source admission facts are inconsistent with the request.");
    }
  }
  var anchor = params.anchor;
  if (!anchor) throw mutationError("preflight_failed", "An anchor is required.");
  mutationFiniteNumber(anchor.x, "anchor.x"); mutationFiniteNumber(anchor.y, "anchor.y");
  if (params.name !== undefined && (typeof params.name !== "string" || params.name.length > 255)) {
    throw mutationError("preflight_failed", "Image name must be a string of at most 255 characters.");
  }
}

function placeResolveLayer(document, path) {
  var container = document;
  if (!path || typeof path.length !== "number" || path.length < 1 || path.length > PLACE_IMAGE_MAX_LAYER_DEPTH) {
    throw mutationError("preflight_failed", "The requested layer path is invalid.");
  }
  for (var index = 0; index < path.length; index++) {
    var layers = container.layers;
    if (!layers || typeof layers.length !== "number" || typeof path[index] !== "number" || path[index] < 0 ||
        Math.floor(path[index]) !== path[index] || path[index] >= layers.length) {
      throw mutationError("preflight_failed", "The requested layer path does not exist in the bound document.");
    }
    container = layers[path[index]];
  }
  if (!container || String(container.typename) !== "Layer") throw mutationError("preflight_failed", "The requested layer path does not resolve to a layer.");
  return container;
}

function placeLayerOrder(layer) {
  var order = [];
  for (var index = 0; index < layer.pageItems.length; index++) {
    var uuid = layer.pageItems[index].uuid;
    if (typeof uuid !== "string" || uuid.length === 0) throw mutationError("preflight_failed", "A layer item native UUID is unavailable.");
    order.push(uuid);
  }
  return order;
}

function placeLayerAncestry(layer) {
  var chain = [];
  var node = layer;
  while (chain.length <= PLACE_IMAGE_MAX_LAYER_DEPTH) {
    if (node === null || node === undefined) throw mutationError("preflight_failed", "Target layer ancestry does not terminate at the document.");
    var typename;
    try { typename = String(node.typename); } catch (typenameError) { throw mutationError("preflight_failed", "Target layer ancestry is unavailable."); }
    if (typename === "Document") return chain;
    if (typename !== "Layer") throw mutationError("preflight_failed", "Image placement supports layer ancestry only.");
    if (typeof node.name !== "string" || typeof node.visible !== "boolean" || typeof node.locked !== "boolean") {
      throw mutationError("preflight_failed", "Target layer ancestry state is unavailable.");
    }
    chain.push({ name: node.name, visible: node.visible, locked: node.locked });
    try { node = node.parent; } catch (nextError) { throw mutationError("preflight_failed", "Target layer ancestry is unavailable."); }
  }
  throw mutationError("preflight_failed", "Target layer ancestry exceeds the supported depth.");
}

function placeArtboardRect(document, artboardIndex) {
  if (typeof artboardIndex !== "number" || Math.floor(artboardIndex) !== artboardIndex || artboardIndex < 0 ||
      !document.artboards || typeof document.artboards.length !== "number" || artboardIndex >= document.artboards.length) {
    throw mutationError("preflight_failed", "The requested artboard does not exist in the bound document.");
  }
  var rect = document.artboards[artboardIndex].artboardRect;
  if (!rect || rect.length !== 4) throw mutationError("preflight_failed", "The requested artboard rectangle is unavailable.");
  var bounds = [mutationFiniteNumber(rect[0], "artboardRect[0]"), mutationFiniteNumber(rect[1], "artboardRect[1]"),
    mutationFiniteNumber(rect[2], "artboardRect[2]"), mutationFiniteNumber(rect[3], "artboardRect[3]")];
  if (!(bounds[0] < bounds[2]) || !(bounds[1] > bounds[3])) throw mutationError("preflight_failed", "The selected artboard has degenerate bounds.");
  return bounds;
}

/** Measured: PlacedItem UUIDs resolve through the native placedItems collection, not getPageItemFromUuid. */
function placeFind(document, uuid) {
  var collection = document.placedItems;
  if (!collection || typeof collection.length !== "number") throw mutationError("preflight_failed", "The document placed-item collection is unavailable.");
  for (var index = 0; index < collection.length; index++) {
    if (String(collection[index].uuid) === uuid) return collection[index];
  }
  return null;
}

/** Host-side confirmation of the admitted file identity: existence and byte length at this moment. */
function placeSourceBlockers(admission) {
  var blockers = [];
  if (admission.status === "blocked") { blockers.push(admission.reason); return blockers; }
  var file = new File(admission.resolvedPath);
  if (!file.exists) { blockers.push("source_file_missing"); return blockers; }
  var length = -1;
  try { length = Number(file.length); } catch (lengthError) { length = -1; }
  if (length !== admission.bytes) blockers.push("source_file_changed");
  return blockers;
}

function placeReadItem(item) {
  var position = item.position;
  if (!position || position.length !== 2) throw mutationError("verify_mismatch", "The placed item position is unavailable.");
  var bounds = item.geometricBounds;
  if (!bounds || bounds.length !== 4) throw mutationError("verify_mismatch", "The placed item bounds are unavailable.");
  var matrix = item.matrix;
  if (!matrix) throw mutationError("verify_mismatch", "The placed item matrix is unavailable.");
  var width = placeRound(item.width), height = placeRound(item.height);
  if (!(width > 0) || !(height > 0)) throw mutationError("verify_mismatch", "The placed item has no positive size.");
  var filePath;
  try { filePath = String(item.file.fsName); } catch (fileError) { throw mutationError("verify_mismatch", "The placed item has no linked file."); }
  return {
    filePath: filePath,
    position: [placeRound(position[0]), placeRound(position[1])],
    geometricBounds: [placeRound(bounds[0]), placeRound(bounds[1]), placeRound(bounds[2]), placeRound(bounds[3])],
    width: width, height: height,
    matrix: [placeRound(matrix.mValueA), placeRound(matrix.mValueB), placeRound(matrix.mValueC), placeRound(matrix.mValueD),
      placeRound(matrix.mValueTX), placeRound(matrix.mValueTY)]
  };
}

function placeResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  placeValidateRequest();
  var layer = placeResolveLayer(document, params.expectedLayerPath);
  var ancestry = placeLayerAncestry(layer);
  var order = placeLayerOrder(layer);
  var rect = placeArtboardRect(document, params.artboardIndex);
  var position = [placeRound(rect[0] + params.anchor.x), placeRound(rect[1] - params.anchor.y)];
  var blockers = [];
  if (!context.mutationAllowed) blockers.push("document_mutation_not_allowed");
  var ancestorHidden = false, ancestorLocked = false;
  for (var index = 0; index < ancestry.length; index++) {
    if (!ancestry[index].visible) ancestorHidden = true;
    if (ancestry[index].locked) ancestorLocked = true;
  }
  if (ancestorHidden) blockers.push("layer_hidden");
  if (ancestorLocked) blockers.push("layer_locked");
  if (order.length >= PLACE_IMAGE_MAX_DIRECT_ITEMS) blockers.push("layer_item_capacity_exceeded");
  var sourceBlockers = placeSourceBlockers(params.admission);
  for (var s = 0; s < sourceBlockers.length; s++) blockers.push(sourceBlockers[s]);
  if (forApply && blockers.length > 0) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "PLACE_IMAGE_APPLY_BLOCKED", reasonCodes: blockers, layerPath: params.expectedLayerPath }));
  }
  return { context: context, document: document, layer: layer, ancestry: ancestry, order: order, rect: rect, position: position, blockers: blockers };
}

function placePlan(preflight) {
  return {
    operation: "place_image", documentKey: preflight.context.key, coordinateSpace: "artboard_top_left", unit: "pt",
    artboardIndex: params.artboardIndex, artboardBounds: preflight.rect,
    source: { path: params.source.path, sha256: params.source.sha256 }, admission: params.admission,
    anchor: { x: params.anchor.x, y: params.anchor.y }, position: preflight.position,
    name: params.name === undefined ? null : params.name,
    layer: { path: params.expectedLayerPath, name: preflight.layer.name, visible: preflight.layer.visible, locked: preflight.layer.locked,
      itemUuids: preflight.order, ancestry: preflight.ancestry },
    applyBlockedReasonCodes: preflight.blockers, applyAllowed: preflight.blockers.length === 0
  };
}

function placeRevalidate(preflight, plan) {
  var current;
  try { current = placeResolve(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Image placement preconditions changed before apply.")); }
  if (current.document !== preflight.document || current.layer !== preflight.layer ||
      !mutationSameSequence(current.order, plan.layer.itemUuids) || stringifyJson(current.ancestry) !== stringifyJson(plan.layer.ancestry) ||
      !mutationSameSequence(current.rect, plan.artboardBounds) || !mutationSameSequence(current.position, plan.position)) {
    throw mutationBeforeSideEffectError("Image placement target, layer, or artboard changed before apply.");
  }
}

function placeApply(preflight, plan, state) {
  // Measured (30.8.1, Finder-background): linking a file under DISPLAYALERTS stalls the host for about two
  // minutes, past the bridge timeout; the capability probe linked in milliseconds under DONTDISPLAYALERTS.
  // The level is captured and restored on every exit so the session is never left without alerts.
  var previousInteractionLevel = app.userInteractionLevel;
  try {
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    state.operationState.mutationStarted = true;
    // Measured: add() creates an empty PlacedItem that survives a failed file assignment, so capture it first.
    var item = preflight.layer.placedItems.add();
    state.operationState.createdObject = item;
    if (typeof item.uuid !== "string" || item.uuid.length === 0) throw mutationError("apply_failed", "Illustrator did not return a valid native UUID.");
    state.operationState.createdUuid = String(item.uuid);
    try { item.file = new File(params.admission.resolvedPath); }
    catch (fileError) { throw mutationError("apply_failed", "Illustrator refused the source file: " + mutationPublicMessage(fileError, String(fileError && fileError.message))); }
    // Measured (30.8.1): assigning file replaces the native identity, so the UUID is captured again; the
    // pre-file UUID above stays valid only for the empty item a failed assignment leaves behind.
    if (typeof item.uuid !== "string" || item.uuid.length === 0) throw mutationError("apply_failed", "Illustrator did not return a valid native UUID after linking the file.");
    state.operationState.createdUuid = String(item.uuid);
    item.position = [plan.position[0], plan.position[1]];
    if (params.name !== undefined) item.name = params.name;
    return item;
  } finally {
    app.userInteractionLevel = previousInteractionLevel;
  }
}

function placeVerify(preflight, plan, state) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) throw mutationError("verify_mismatch", "Active document changed during image verification.");
  var createdUuid = state.operationState.createdUuid;
  if (typeof createdUuid !== "string" || createdUuid.length === 0) throw mutationError("verify_mismatch", "The placed image has no captured native UUID.");
  var item = placeFind(preflight.document, createdUuid);
  if (item === null || item !== state.operationState.createdObject) throw mutationError("verify_mismatch", "The created native UUID does not resolve to the placed image.");
  if (String(item.typename) !== "PlacedItem" || item.layer !== preflight.layer) throw mutationError("verify_mismatch", "The placed image has an unexpected type or layer.");
  if (typeof item.locked !== "boolean" || typeof item.hidden !== "boolean" || item.locked || item.hidden) {
    throw mutationError("verify_mismatch", "The placed image is not verifiably editable.");
  }
  var order = placeLayerOrder(preflight.layer);
  if (order.length !== plan.layer.itemUuids.length + 1 || order[0] !== createdUuid || !mutationSameSequence(order.slice(1), plan.layer.itemUuids)) {
    throw mutationError("verify_mismatch", "The placed image is not the only new front item of its layer.");
  }
  var read = placeReadItem(item);
  if (read.filePath !== params.admission.resolvedPath) throw mutationError("verify_mismatch", "The placed image links a different file than the admitted source.");
  if (Math.abs(read.position[0] - plan.position[0]) > PLACE_IMAGE_TOLERANCE_PT || Math.abs(read.position[1] - plan.position[1]) > PLACE_IMAGE_TOLERANCE_PT) {
    throw mutationError("verify_mismatch", "The placed image position does not match the plan.");
  }
  if (params.name !== undefined && item.name !== params.name) throw mutationError("verify_mismatch", "The placed image name does not match the plan.");
  return { uuid: createdUuid, type: "PlacedItem", name: item.name || "", filePath: read.filePath, position: read.position,
    geometricBounds: read.geometricBounds, width: read.width, height: read.height, matrix: read.matrix, layerItemUuids: order };
}

function placeRollback(state) {
  var preflight = state.preflight;
  var createdUuid = state.operationState.createdUuid;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) {
    return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
  }
  if (typeof createdUuid !== "string" || createdUuid.length === 0) {
    return { status: "indeterminate", message: "Rollback cannot identify the created item." };
  }
  state.operationState.rollbackEvidence.createdUuid = createdUuid;
  var item;
  try { item = placeFind(preflight.document, createdUuid); } catch (findError) { return { status: "indeterminate", message: "Rollback target identity is indeterminate." }; }
  if (item === null) {
    var absentOrder;
    try { absentOrder = placeLayerOrder(preflight.layer); } catch (e) { return { status: "indeterminate", message: "Rollback layer order is indeterminate." }; }
    if (!mutationSameSequence(absentOrder, preflight.order)) return { status: "indeterminate", message: "Rollback refused because the layer no longer matches the baseline." };
    state.operationState.rollbackEvidence.restoredItemUuids = absentOrder;
    return { status: "verified" };
  }
  var currentOrder;
  try { currentOrder = placeLayerOrder(preflight.layer); } catch (e) { return { status: "indeterminate", message: "Rollback layer order is indeterminate." }; }
  if (currentOrder.length !== preflight.order.length + 1 || currentOrder[0] !== createdUuid || !mutationSameSequence(currentOrder.slice(1), preflight.order)) {
    return { status: "indeterminate", message: "Rollback refused because the layer is neither the baseline nor the created state." };
  }
  try { item.remove(); } catch (removeError) { return { status: "indeterminate", message: "Rollback removal is indeterminate." }; }
  var restored;
  try { restored = placeLayerOrder(preflight.layer); } catch (e) { return { status: "indeterminate", message: "Rollback verification is indeterminate." }; }
  state.operationState.rollbackEvidence.restoredItemUuids = restored;
  var stillPresent;
  try { stillPresent = placeFind(preflight.document, createdUuid) !== null; } catch (e) { return { status: "indeterminate", message: "Rollback absence lookup is indeterminate." }; }
  if (stillPresent) return { status: "failed", message: "Rollback did not remove the placed image native UUID." };
  return mutationSameSequence(restored, preflight.order) ? { status: "verified" } : { status: "indeterminate", message: "Rollback removed the placed image but the layer does not match the baseline." };
}

var placeExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionAffected: function (phase, preflight, plan, state) { return (phase === "after") ? [state.operationState.createdUuid] : []; },
  editSessionLayers: function (phase, preflight) { return [preflight.layer]; },
  initialOperationState: function () { return { mutationStarted: false, createdObject: null, createdUuid: null, rollbackEvidence: { createdUuid: null, restoredItemUuids: null } }; },
  preflight: placeResolve,
  plan: placePlan,
  revalidate: placeRevalidate,
  applyMutation: placeApply,
  verify: placeVerify,
  rollback: placeRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () { return { reasonCode: "created_state_unknown", message: "Image placement outcome is indeterminate.", evidence: { createdUuid: null, restoredItemUuids: null } }; },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var placeDocument = placeExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === placeExecution.preflight.document) placeDocument = getDocumentContext();
var result = { operation: "place_image", applied: placeExecution.transaction.state === "verified",
  document: placeDocument, plan: placeExecution.plan, transaction: placeExecution.transaction };
if (placeExecution.transaction.state === "verified") result.created = placeExecution.value;
`;
export const PLACE_IMAGE_HOST_SCRIPT_DIGEST = canonicalSha256(PLACE_IMAGE_SCRIPT);
export const PLACE_IMAGE_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: PLACE_IMAGE_OPERATION, validator: PLACE_IMAGE_VALIDATOR,
    canonicalContractVersion: CANONICAL_VERSION, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: PLACE_IMAGE_SAFETY_IDENTITY, hostScriptDigest: PLACE_IMAGE_HOST_SCRIPT_DIGEST,
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    const { commandId: _commandId, admission: _admission, ...digestRequest } = request;
    const digest = canonicalSha256({ operation: PLACE_IMAGE_OPERATION, validator: PLACE_IMAGE_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: 'commandId' in request ? request.commandId : null,
        documentKey: request.expectedDocumentKey, digest };
}
export const placeImageToolContract = {
    name: 'illustrator_place_image',
    title: 'Plan or Place Linked Image',
    description: `Plan or place one external raster file (TIFF, JPEG, PNG, or PSD; absolute path plus its SHA-256) as a linked PlacedItem on an explicit layer path at an artboard-top-left anchor in points. The file is admitted in Node before any Illustrator call (existence, exact SHA-256, measured format); a missing, changed, or unmeasured source blocks the plan. Apply creates once, verifies the native UUID, layer order, linked path, and position, and rolls back only its own created item with absence proven. Relink and embed are not part of this tool.`,
    inputSchema,
    publicInputSchema: placeImagePublicInputSchema,
    outputSchema: placeImageResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(PLACE_IMAGE_SAFETY.policy),
    normalizePublicInput,
};
export function createPlaceImageAdapter() {
    return {
        version: 1, operation: PLACE_IMAGE_OPERATION, validator: PLACE_IMAGE_VALIDATOR,
        safety: PLACE_IMAGE_SAFETY, safetyRegistrationIdentity: PLACE_IMAGE_SAFETY_IDENTITY,
        adapterIdentity: PLACE_IMAGE_ADAPTER_IDENTITY, tool: placeImageToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: placeImageResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: CLASSIFIER_VERSION, safetyConformanceVersion: CONFORMANCE_VERSION,
        errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: PLACE_IMAGE_HOST_SCRIPT_DIGEST,
        admit: admitPlaceImageRequest,
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: PLACE_IMAGE_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: PLACE_IMAGE_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: PLACE_IMAGE_OPERATION, documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: PLACE_IMAGE_ADAPTER_IDENTITY, script: PLACE_IMAGE_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = placeImageResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back' || state === 'rollback_failed')
                return { state };
            if (state === 'planned')
                throw new Error('Image placement plan is not a terminal mutation result.');
            throw new Error('Indeterminate image placement must retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error, detail) {
            if (detail?.code === 'PLACE_IMAGE_APPLY_BLOCKED') {
                return new Error(`Image placement is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}.`);
            }
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
