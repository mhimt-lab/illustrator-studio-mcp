import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { extname } from 'node:path';
import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, layerPathSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
export const IMPORT_VECTOR_ARTWORK_OPERATION = 'import_vector_artwork';
export const IMPORT_VECTOR_ARTWORK_VALIDATOR = { kind: IMPORT_VECTOR_ARTWORK_OPERATION, version: 1 };
export const IMPORT_VECTOR_MEASURED_APP_VERSION = '30.8.1';
export const IMPORT_VECTOR_MAX_LAYER_ITEMS = 128;
export const IMPORT_VECTOR_MAX_SOURCE_CHILDREN = 256;
export const IMPORT_VECTOR_MAX_SVG_BYTES = 8 * 1024 * 1024;
export const IMPORT_VECTOR_MAX_SOURCE_BYTES = 256 * 1024 * 1024;
export const IMPORT_VECTOR_TOLERANCE_PT = 0.01;
export const IMPORT_VECTOR_MAX_COORDINATE_PT = 16_383;
export const IMPORT_VECTOR_PRECISION_DIGITS = 6;
export const IMPORT_VECTOR_MAX_PATH_LENGTH = 4_096;
export const IMPORT_VECTOR_MEASURED_CHILD_TYPES = ['PathItem', 'CompoundPathItem', 'TextFrame'];
const CANONICAL_VERSION = 1;
const RESULT_SCHEMA_VERSION = 2;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
const uuidSchema = z.string().min(1).max(255);
const documentKeySchema = z.string().min(1).max(16_384);
const canonicalNumberSchema = z.number().finite().min(-IMPORT_VECTOR_MAX_COORDINATE_PT).max(IMPORT_VECTOR_MAX_COORDINATE_PT)
    .overwrite((value) => Object.is(value, -0) ? 0 : value);
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const sourcePathSchema = z.string().min(5).max(IMPORT_VECTOR_MAX_PATH_LENGTH)
    .regex(/^\/(?!(?:.*\/)?\.\.(?:\/|$))[^\0]*\.(?:svg|ai)$/iu, 'Source path must be an absolute .svg or .ai path without NUL or parent-directory segments.');
const sourceSchema = z.strictObject({ path: sourcePathSchema, sha256: sha256Schema });
const anchorSchema = z.strictObject({ x: canonicalNumberSchema, y: canonicalNumberSchema });
const layerItemUuidsSchema = z.array(uuidSchema).max(IMPORT_VECTOR_MAX_LAYER_ITEMS);
export const importVectorSourceBlockerSchema = z.enum([
    'source_file_missing', 'source_file_unavailable', 'source_hash_mismatch', 'source_format_unmeasured',
    'source_svg_linked_content', 'source_svg_units_unmeasured',
]);
export const importVectorAdmissionSchema = z.discriminatedUnion('status', [
    z.strictObject({
        status: z.literal('admitted'),
        resolvedPath: sourcePathSchema,
        format: z.enum(['svg', 'ai']),
        bytes: z.number().int().positive(),
        modifiedAtSeconds: z.number().int().nonnegative(),
        sha256: sha256Schema,
    }),
    z.strictObject({
        status: z.literal('blocked'),
        resolvedPath: z.string().min(1).max(IMPORT_VECTOR_MAX_PATH_LENGTH).nullable(),
        reason: importVectorSourceBlockerSchema,
        message: z.string().min(1).max(500),
    }),
]);
const commonRequest = {
    expectedDocumentKey: documentKeySchema,
    expectedLayerPath: layerPathSchema,
    artboardIndex: z.number().int().safe().nonnegative(),
    source: sourceSchema,
    anchor: anchorSchema,
};
const unadmittedInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonRequest, apply: z.literal(false) }),
    z.strictObject({ ...commonRequest, expectedLayerItemUuids: layerItemUuidsSchema, apply: z.literal(true), commandId: canonicalCommandIdSchema }),
]);
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonRequest, admission: importVectorAdmissionSchema.optional(), apply: z.literal(false) }),
    z.strictObject({ ...commonRequest, admission: importVectorAdmissionSchema.optional(), expectedLayerItemUuids: layerItemUuidsSchema,
        apply: z.literal(true), commandId: canonicalCommandIdSchema }),
]).superRefine((request, context) => {
    if (request.admission?.status === 'admitted' && request.admission.sha256 !== request.source.sha256) {
        context.addIssue({ code: 'custom', message: 'An admitted source must carry the requested SHA-256.' });
    }
});
const commonPublic = {
    expected_document_key: documentKeySchema,
    expected_layer_path: layerPathSchema,
    artboard_index: z.number().int().safe().nonnegative(),
    source: sourceSchema.describe('Absolute path of the .svg or .ai file and its SHA-256.'),
    anchor: anchorSchema.describe('Where the top-left of the imported group\'s geometric bounds goes, in points from the artboard top-left (y down).'),
};
export const importVectorArtworkPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({
        ...commonPublic,
        expected_layer_item_uuids: layerItemUuidsSchema.describe('plan.layer.itemUuids from the plan call, unchanged.'),
        apply: z.literal(true),
        command_id: applyCommandIdSchema,
    }),
]);
const inputSchema = z.strictObject({
    ...commonPublic,
    expected_layer_item_uuids: layerItemUuidsSchema.optional(),
    apply: z.boolean().default(false),
    command_id: applyCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(importVectorArtworkPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = importVectorArtworkPublicInputSchema.parse(input);
    const common = {
        expectedDocumentKey: value.expected_document_key, expectedLayerPath: value.expected_layer_path,
        artboardIndex: value.artboard_index, source: value.source, anchor: value.anchor,
    };
    return value.apply
        ? { ...common, expectedLayerItemUuids: value.expected_layer_item_uuids, apply: true, commandId: value.command_id }
        : { ...common, apply: false };
}
export async function admitImportVectorRequest(input) {
    const request = unadmittedInputSchema.parse(input);
    return { ...request, admission: await admitVectorSource(request.source) };
}
function boundedMessage(error) {
    const raw = error instanceof Error ? error.message : String(error);
    return (raw.length > 0 ? raw : 'Unknown source admission error.').slice(0, 500);
}
const SVG_PX_LENGTH = /^\s*\d+(?:\.\d+)?px\s*$/u;
export function svgSourceBlocker(text) {
    if (/<!DOCTYPE|<!ENTITY/iu.test(text)) {
        return { reason: 'source_format_unmeasured', message: 'SVG with a DOCTYPE or entity declaration is not supported.' };
    }
    const root = /<svg\b[^>]*>/iu.exec(text);
    if (root === null)
        return { reason: 'source_format_unmeasured', message: 'The file has no <svg> root element.' };
    if (/<(?:image|foreignObject|script|iframe|video|audio)\b/iu.test(text)) {
        return { reason: 'source_svg_linked_content', message: 'SVG contains an image, foreignObject, or other external-content element.' };
    }
    for (const match of text.matchAll(/(?:xlink:)?href\s*=\s*["']([^"']*)["']/giu)) {
        if (!match[1].startsWith('#'))
            return { reason: 'source_svg_linked_content', message: 'SVG references an external resource.' };
    }
    for (const match of text.matchAll(/url\(\s*["']?([^)"']*)/giu)) {
        if (!match[1].startsWith('#'))
            return { reason: 'source_svg_linked_content', message: 'SVG references an external resource in url().' };
    }
    const attribute = (name) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'u').exec(root[0])?.[1] ?? null;
    const width = attribute('width');
    const height = attribute('height');
    if (width === null || height === null || !SVG_PX_LENGTH.test(width) || !SVG_PX_LENGTH.test(height)) {
        return { reason: 'source_svg_units_unmeasured', message: 'Only an SVG root with explicit px width and height is supported.' };
    }
    return null;
}
export async function admitVectorSource(source) {
    let resolvedPath;
    try {
        resolvedPath = await realpath(source.path);
    }
    catch (error) {
        const code = error?.code;
        if (code === 'ENOENT' || code === 'ENOTDIR') {
            return { status: 'blocked', resolvedPath: null, reason: 'source_file_missing', message: `Source file ${source.path} does not exist.` };
        }
        return { status: 'blocked', resolvedPath: null, reason: 'source_file_unavailable', message: boundedMessage(error) };
    }
    if (!sourcePathSchema.safeParse(resolvedPath).success) {
        return { status: 'blocked', resolvedPath: null, reason: 'source_file_unavailable', message: 'Resolved source path is not an admissible .svg or .ai path.' };
    }
    const format = extname(resolvedPath).toLowerCase() === '.svg' ? 'svg' : 'ai';
    let handle;
    try {
        handle = await open(resolvedPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    }
    catch (error) {
        return { status: 'blocked', resolvedPath, reason: 'source_file_unavailable', message: boundedMessage(error) };
    }
    try {
        const before = await handle.stat({ bigint: true });
        if (!before.isFile())
            return { status: 'blocked', resolvedPath, reason: 'source_file_unavailable', message: 'Source is not a regular file.' };
        if (before.size === 0n || before.size > BigInt(IMPORT_VECTOR_MAX_SOURCE_BYTES)) {
            return { status: 'blocked', resolvedPath, reason: 'source_file_unavailable', message: 'Source file is empty or larger than the supported size.' };
        }
        const bytes = await handle.readFile();
        const after = await handle.stat({ bigint: true });
        if (after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs || BigInt(bytes.length) !== before.size) {
            return { status: 'blocked', resolvedPath, reason: 'source_file_unavailable', message: 'Source file changed while it was read.' };
        }
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        if (sha256 !== source.sha256) {
            return { status: 'blocked', resolvedPath, reason: 'source_hash_mismatch', message: `Source file SHA-256 ${sha256} does not match the requested ${source.sha256}.` };
        }
        if (format === 'svg') {
            if (bytes.length > IMPORT_VECTOR_MAX_SVG_BYTES) {
                return { status: 'blocked', resolvedPath, reason: 'source_format_unmeasured', message: 'SVG is larger than the supported size.' };
            }
            const blocker = svgSourceBlocker(bytes.toString('utf8'));
            if (blocker !== null)
                return { status: 'blocked', resolvedPath, ...blocker };
        }
        else {
            const head = bytes.subarray(0, 16).toString('latin1');
            if (!head.startsWith('%PDF-') && !head.startsWith('%!PS-Adobe')) {
                return { status: 'blocked', resolvedPath, reason: 'source_format_unmeasured', message: 'The .ai file does not start with a PDF or PostScript header.' };
            }
        }
        return {
            status: 'admitted', resolvedPath, format, bytes: bytes.length,
            modifiedAtSeconds: Number(before.mtimeNs / 1000000000n), sha256,
        };
    }
    catch (error) {
        return { status: 'blocked', resolvedPath, reason: 'source_file_unavailable', message: boundedMessage(error) };
    }
    finally {
        await handle.close();
    }
}
function round(value) {
    const rounded = Number(value.toFixed(IMPORT_VECTOR_PRECISION_DIGITS));
    return Object.is(rounded, -0) ? 0 : rounded;
}
export function deriveImportTopLeft(artboardBounds, anchor) {
    return [round(artboardBounds[0] + anchor.x), round(artboardBounds[1] - anchor.y)];
}
const boundsSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
const hostBlockerSchema = z.enum([
    'document_mutation_not_allowed', 'unsupported_host_version', 'other_documents_open', 'document_color_space_unmeasured',
    'layer_not_top_level', 'layer_has_sublayers', 'layer_hidden', 'layer_locked', 'layer_item_capacity_exceeded',
    'source_file_changed', 'source_is_target_document',
]);
const blockerSchema = z.enum([...hostBlockerSchema.options, ...importVectorSourceBlockerSchema.options]);
const layerStateSchema = z.strictObject({
    path: layerPathSchema,
    name: z.string().max(255),
    visible: z.boolean(),
    locked: z.boolean(),
    sublayerCount: z.number().int().nonnegative(),
    itemUuids: z.array(uuidSchema).max(IMPORT_VECTOR_MAX_LAYER_ITEMS),
});
const planSchema = z.strictObject({
    operation: z.literal(IMPORT_VECTOR_ARTWORK_OPERATION),
    documentKey: documentKeySchema,
    hostVersion: z.string().max(64),
    documentCount: z.number().int().nonnegative(),
    coordinateSpace: z.literal('artboard_top_left'),
    unit: z.literal('pt'),
    artboardIndex: z.number().int().nonnegative(),
    artboardBounds: boundsSchema,
    source: sourceSchema,
    admission: importVectorAdmissionSchema,
    anchor: anchorSchema,
    targetTopLeft: z.tuple([z.number().finite(), z.number().finite()]),
    layer: layerStateSchema,
    predicted: z.strictObject({
        consumedUuids: z.array(uuidSchema).length(0),
        created: z.literal('one GroupItem at index 0 of the layer; its UUIDs and children are known only after apply opens the source'),
    }),
    applyBlockedReasonCodes: z.array(blockerSchema),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    if (plan.applyAllowed !== (plan.applyBlockedReasonCodes.length === 0)) {
        context.addIssue({ code: 'custom', message: 'Vector import applyAllowed must require no blockers.' });
    }
    const derived = deriveImportTopLeft(plan.artboardBounds, plan.anchor);
    if (plan.targetTopLeft[0] !== derived[0] || plan.targetTopLeft[1] !== derived[1]) {
        context.addIssue({ code: 'custom', message: 'Vector import target top-left must equal the position derived from the anchor.' });
    }
    if (plan.admission.status === 'admitted' && plan.admission.sha256 !== plan.source.sha256) {
        context.addIssue({ code: 'custom', message: 'Vector import admission must carry the requested SHA-256.' });
    }
});
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']), reasonCode: z.enum(['apply_failed', 'verify_mismatch']), message: z.string().min(1).max(500),
}).superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed')) {
        context.addIssue({ code: 'custom', message: 'Vector import failure phase and reason code must match.' });
    }
});
const applyStepSchema = z.enum(['duplicate', 'identity', 'close_source', 'post_close_scan', 'translate', 'verify']);
const sourceCloseAttemptSchema = z.strictObject({
    stage: z.enum(['apply', 'rollback']),
    ms: z.number().int().nonnegative(),
    threw: z.string().max(500).nullable(),
    documentsAfter: z.number().int().nonnegative(),
    activeIsTarget: z.boolean(),
    sourcePathOpen: z.boolean(),
    closed: z.boolean(),
});
const stageEvidence = {
    failedStep: applyStepSchema.nullable(),
    sourceCloseAttempts: z.array(sourceCloseAttemptSchema).max(4),
};
const rollbackEvidence = {
    ...stageEvidence,
    createdUuid: uuidSchema.nullable(),
    restoredItemUuids: z.array(uuidSchema).max(IMPORT_VECTOR_MAX_LAYER_ITEMS + 1).nullable(),
    sourceClosed: z.boolean().nullable(),
};
const transactionSchema = z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('planned'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('verified'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('apply_failed'), failure: failureSchema,
        rollback: z.strictObject({ status: z.literal('not_required') }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('rolled_back'), failure: failureSchema,
        rollback: z.strictObject({ status: z.literal('verified'), ...stageEvidence, createdUuid: uuidSchema,
            restoredItemUuids: z.array(uuidSchema).max(IMPORT_VECTOR_MAX_LAYER_ITEMS), sourceClosed: z.literal(true) }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('rollback_failed'), failure: failureSchema,
        rollback: z.strictObject({ status: z.literal('failed'), reasonCode: z.literal('rollback_failed'),
            message: z.string().min(1).max(500), ...stageEvidence, createdUuid: uuidSchema, restoredItemUuids: rollbackEvidence.restoredItemUuids,
            sourceClosed: rollbackEvidence.sourceClosed }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('apply_indeterminate'),
        failure: z.strictObject({ phase: z.literal('apply'), reasonCode: z.literal('apply_indeterminate'), message: z.string().min(1).max(500) }),
        rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('created_state_unknown'),
            message: z.string().min(1).max(500), failedStep: z.null(), sourceCloseAttempts: z.array(sourceCloseAttemptSchema).max(0),
            createdUuid: z.null(), restoredItemUuids: z.null(), sourceClosed: z.null() }), audit: mutationAuditSchema }),
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
        context.addIssue({ code: 'custom', message: 'Vector import audit sequence does not match transaction state.' });
    }
    transaction.audit.forEach((event, index) => {
        if (event.sequence !== index)
            context.addIssue({ code: 'custom', message: 'Vector import audit sequence must be contiguous.' });
    });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' && event.phase === transaction.failure.phase &&
            event.reasonCode === transaction.failure.reasonCode && event.message === transaction.failure.message);
        if (matches.length !== 1)
            context.addIssue({ code: 'custom', message: 'Vector import failure must match one audit event.' });
    }
});
const treeNodeSchema = z.strictObject({
    uuid: uuidSchema,
    typename: z.enum(IMPORT_VECTOR_MEASURED_CHILD_TYPES),
    name: z.string().max(255),
    memberCount: z.number().int().nonnegative().nullable(),
});
const scanSchema = z.strictObject({
    documentPageItems: z.number().int().nonnegative(),
    documentGroupItems: z.number().int().nonnegative(),
    layerPageItems: z.number().int().nonnegative(),
    layerGroupItems: z.number().int().nonnegative(),
    exact: z.boolean(),
});
const unmeasuredEvidenceSchema = z.strictObject({
    sourceClose: z.strictObject({ ms: z.number().int().nonnegative(), threw: z.string().max(500).nullable(),
        documentsAfter: z.number().int().nonnegative(), activeIsTarget: z.boolean(), sourcePathOpen: z.boolean() }),
    postCloseScan: scanSchema.extend({ ms: z.number().int().nonnegative() }),
    translate: z.strictObject({ ms: z.number().int().nonnegative(), threw: z.string().max(500).nullable(),
        delta: z.tuple([z.number().finite(), z.number().finite()]), boundsBefore: boundsSchema, boundsAfter: boundsSchema }),
});
const createdSchema = z.strictObject({
    uuid: uuidSchema,
    type: z.literal('GroupItem'),
    name: z.string().max(255),
    geometricBounds: boundsSchema,
    width: z.number().finite().nonnegative(),
    height: z.number().finite().nonnegative(),
    children: z.array(treeNodeSchema).min(1).max(IMPORT_VECTOR_MAX_SOURCE_CHILDREN),
    layerItemUuids: z.array(uuidSchema).min(1).max(IMPORT_VECTOR_MAX_LAYER_ITEMS + 1),
    source: z.strictObject({
        rootName: z.string().max(255),
        geometricBounds: boundsSchema,
        children: z.array(treeNodeSchema.omit({ uuid: true })).min(1).max(IMPORT_VECTOR_MAX_SOURCE_CHILDREN),
    }),
    timing: z.strictObject({ openMs: z.number().int().nonnegative(), duplicateMs: z.number().int().nonnegative() }),
    unmeasured: unmeasuredEvidenceSchema,
});
function nodeDerivedBlockers(result, planned) {
    const blockers = new Set();
    const { plan } = result;
    if (planned && !result.document.mutationAllowed)
        blockers.add('document_mutation_not_allowed');
    if (plan.hostVersion !== IMPORT_VECTOR_MEASURED_APP_VERSION)
        blockers.add('unsupported_host_version');
    if (planned && plan.documentCount !== 1)
        blockers.add('other_documents_open');
    if (result.document.colorSpace !== 'RGB')
        blockers.add('document_color_space_unmeasured');
    if (plan.layer.path.length !== 1)
        blockers.add('layer_not_top_level');
    if (plan.layer.sublayerCount !== 0)
        blockers.add('layer_has_sublayers');
    if (!plan.layer.visible)
        blockers.add('layer_hidden');
    if (plan.layer.locked)
        blockers.add('layer_locked');
    if (plan.layer.itemUuids.length >= IMPORT_VECTOR_MAX_LAYER_ITEMS)
        blockers.add('layer_item_capacity_exceeded');
    if (plan.admission.status === 'blocked')
        blockers.add(plan.admission.reason);
    return blockers;
}
const HOST_ONLY_BLOCKERS = new Set(['source_file_changed', 'source_is_target_document', 'source_file_missing']);
export const importVectorArtworkResultSchema = z.union([
    z.strictObject({ operation: z.literal(IMPORT_VECTOR_ARTWORK_OPERATION), applied: z.literal(false),
        document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ operation: z.literal(IMPORT_VECTOR_ARTWORK_OPERATION), applied: z.literal(true),
        document: documentContextSchema, plan: planSchema, created: createdSchema, transaction: transactionSchema }),
]).superRefine((result, context) => {
    const planned = result.transaction.state === 'planned';
    const derived = nodeDerivedBlockers(result, planned);
    const reported = new Set(result.plan.applyBlockedReasonCodes);
    if (planned) {
        for (const blocker of derived)
            if (!reported.has(blocker))
                context.addIssue({ code: 'custom', message: `Planned vector import must expose blocker ${blocker}.` });
        for (const blocker of reported) {
            if (!derived.has(blocker) && !HOST_ONLY_BLOCKERS.has(blocker)) {
                context.addIssue({ code: 'custom', message: `Planned vector import reports an underivable blocker ${blocker}.` });
            }
        }
    }
    else if (reported.size !== 0 || !result.plan.applyAllowed || derived.size !== 0 || result.plan.admission.status !== 'admitted') {
        context.addIssue({ code: 'custom', message: 'Applied vector import must derive from an allowed, admitted plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified') {
            context.addIssue({ code: 'custom', message: 'An imported group must come from a verified transaction.' });
            return;
        }
        const { created, plan } = result;
        if (created.layerItemUuids[0] !== created.uuid || created.layerItemUuids.length !== plan.layer.itemUuids.length + 1 ||
            created.layerItemUuids.slice(1).some((uuid, index) => uuid !== plan.layer.itemUuids[index])) {
            context.addIssue({ code: 'custom', message: 'The imported group must be the only new item, at the front, with the prior order intact.' });
        }
        const sourceWidth = created.source.geometricBounds[2] - created.source.geometricBounds[0];
        const sourceHeight = created.source.geometricBounds[1] - created.source.geometricBounds[3];
        if (Math.abs(created.geometricBounds[0] - plan.targetTopLeft[0]) > IMPORT_VECTOR_TOLERANCE_PT ||
            Math.abs(created.geometricBounds[1] - plan.targetTopLeft[1]) > IMPORT_VECTOR_TOLERANCE_PT ||
            Math.abs(created.width - sourceWidth) > IMPORT_VECTOR_TOLERANCE_PT || Math.abs(created.height - sourceHeight) > IMPORT_VECTOR_TOLERANCE_PT) {
            context.addIssue({ code: 'custom', message: 'The imported group must sit at the planned top-left with the source size.' });
        }
        if (created.children.length !== created.source.children.length || created.children.some((child, index) => {
            const expected = created.source.children[index];
            return child.typename !== expected.typename || child.name !== expected.name || child.memberCount !== expected.memberCount;
        })) {
            context.addIssue({ code: 'custom', message: 'The imported group must keep the source children, their types, names, and order.' });
        }
        const evidence = created.unmeasured;
        if (evidence.sourceClose.threw !== null || evidence.sourceClose.documentsAfter !== 1 || !evidence.sourceClose.activeIsTarget ||
            evidence.sourceClose.sourcePathOpen ||
            !evidence.postCloseScan.exact || evidence.translate.threw !== null) {
            context.addIssue({ code: 'custom', message: 'A verified vector import requires clean source-close, post-close scan, and translate evidence.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified vector import must report the created group.' });
    }
    if (result.transaction.state === 'rolled_back' &&
        canonicalSha256(result.transaction.rollback.restoredItemUuids) !==
            canonicalSha256(result.plan.layer.itemUuids)) {
        context.addIssue({ code: 'custom', message: 'A rolled-back vector import must prove the exact baseline layer order.' });
    }
});
export const importVectorArtworkResponseSchema = z.strictObject({
    outcome: importVectorArtworkResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
export const IMPORT_VECTOR_ARTWORK_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: IMPORT_VECTOR_ARTWORK_OPERATION,
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
export const IMPORT_VECTOR_ARTWORK_SAFETY_IDENTITY = canonicalDigest(IMPORT_VECTOR_ARTWORK_SAFETY);
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'create', operationId: IMPORT_VECTOR_ARTWORK_OPERATION, canonicalRequestDigest: requestDigest,
        evidence: { documentKey: admissionDocumentKey,
            targetLocator: `layer:${result.plan.layer.path.join('.')};artboard:${result.plan.artboardIndex};source:${result.plan.source.sha256};order:${canonicalDigest(result.plan.layer.itemUuids)}` },
        preconditions: { status: result.plan.applyBlockedReasonCodes.length === 0 ? 'satisfied' : 'blocked',
            targetsValidated: result.plan.applyBlockedReasonCodes.length === 0 },
        confirmation: { kind: 'risk_scoped', status: 'not_required' },
        applyAllowed: result.plan.applyAllowed,
    });
}
function safetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' || transaction.state === 'rollback_indeterminate') {
        throw new Error('Indeterminate vector import cannot be terminal.');
    }
    const common = { policyVersion: 1, operationClass: 'create', operationId: IMPORT_VECTOR_ARTWORK_OPERATION,
        canonicalRequestDigest: requestDigest, planDigest: plan.planDigest, attestation };
    const replay = { status: 'durable_terminal', action: 'return_attested_result', reapply: false };
    if (result.applied && transaction.state === 'verified') {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { nativeUuid: result.created.uuid, ownership: 'self_created_only', postconditionVerified: true, outstandingEffect: null },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'succeeded', terminal: true, recovery: 'not_required', proof: { kind: 'verified_postcondition' }, replay } });
    }
    if (transaction.state === 'rolled_back') {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { nativeUuid: transaction.rollback.createdUuid, ownership: 'self_created_only', postconditionVerified: false, outstandingEffect: null },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'recovered', terminal: true, recovery: 'verified', proof: { kind: 'verified_recovery' }, replay } });
    }
    if (transaction.state === 'rollback_failed') {
        const nativeUuid = transaction.rollback.createdUuid;
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { nativeUuid, ownership: 'self_created_only', postconditionVerified: false,
                outstandingEffect: { kind: 'native_uuid_still_present', nativeUuid } },
            executionEvidence: { outcome: 'recovery_failed' },
            resolution: { status: 'recovery_failed', terminal: true, recovery: 'failed', outstandingEffect: 'known_effect_present',
                proof: { kind: 'verified_outstanding_effect' }, replay } });
    }
    return operationSafetyResultSchema.parse({ ...common,
        evidence: { nativeUuid: null, ownership: 'self_created_only', postconditionVerified: false, outstandingEffect: null },
        executionEvidence: { outcome: 'proven_pre_apply' },
        resolution: { status: 'failed', terminal: true, recovery: 'not_required', proof: { kind: 'proven_pre_apply', mutationAttempted: false }, replay } });
}
async function assertSafety(value, requestDigest, attestation, resolver) {
    const result = importVectorArtworkResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null)
        throw new Error('Vector import terminal result requires attestation.');
    await assertOperationSafetyAdapterConformance({ registration: IMPORT_VECTOR_ARTWORK_SAFETY, plan, result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
export const IMPORT_VECTOR_ARTWORK_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
var VI_MEASURED_APP_VERSION = ${JSON.stringify(IMPORT_VECTOR_MEASURED_APP_VERSION)};
var VI_MAX_LAYER_ITEMS = ${IMPORT_VECTOR_MAX_LAYER_ITEMS};
var VI_MAX_SOURCE_CHILDREN = ${IMPORT_VECTOR_MAX_SOURCE_CHILDREN};
var VI_TOLERANCE_PT = ${IMPORT_VECTOR_TOLERANCE_PT};
var VI_PRECISION_DIGITS = ${IMPORT_VECTOR_PRECISION_DIGITS};
var VI_CHILD_TYPES = { PathItem: true, CompoundPathItem: true, TextFrame: true };

function viRound(value) {
  var rounded = Number(mutationFiniteNumber(value, "geometry").toFixed(VI_PRECISION_DIGITS));
  return rounded === 0 ? 0 : rounded;
}
function viBounds(item) {
  var b = item.geometricBounds;
  if (!b || b.length !== 4) throw mutationError("verify_mismatch", "Geometric bounds are unavailable.");
  return [viRound(b[0]), viRound(b[1]), viRound(b[2]), viRound(b[3])];
}
function viNow() { return new Date().getTime(); }
function viElapsed(start) { var elapsed = viNow() - start; return elapsed < 0 ? 0 : elapsed; }
function viMessage(error) { var text = "unknown"; try { text = String(error && error.message ? error.message : error); } catch (_e) {} return mutationTruncateMessage(text); }

/** Re-checks the plan-side rejections so a caller cannot reach the host with an unadmitted request. */
function viValidateRequest() {
  var source = params.source;
  if (!source || typeof source.path !== "string" || source.path.charAt(0) !== "/") throw mutationError("preflight_failed", "Source path must be an absolute path.");
  if (typeof source.sha256 !== "string" || source.sha256.length !== 64) throw mutationError("preflight_failed", "Source SHA-256 is required.");
  var admission = params.admission;
  if (!admission || (admission.status !== "admitted" && admission.status !== "blocked")) {
    throw mutationError("preflight_failed", "Source admission is missing; the request did not pass Node-side file admission.");
  }
  if (admission.status === "admitted" && (typeof admission.resolvedPath !== "string" || admission.resolvedPath.charAt(0) !== "/" ||
      admission.sha256 !== source.sha256 || typeof admission.bytes !== "number" || typeof admission.modifiedAtSeconds !== "number")) {
    throw mutationError("preflight_failed", "Source admission facts are inconsistent with the request.");
  }
  if (!params.anchor) throw mutationError("preflight_failed", "An anchor is required.");
  mutationFiniteNumber(params.anchor.x, "anchor.x"); mutationFiniteNumber(params.anchor.y, "anchor.y");
}

function viResolveLayer(document, path) {
  var container = document;
  if (!path || typeof path.length !== "number" || path.length < 1 || path.length > 64) throw mutationError("preflight_failed", "The requested layer path is invalid.");
  for (var index = 0; index < path.length; index++) {
    var layers = container.layers;
    if (typeof path[index] !== "number" || path[index] < 0 || Math.floor(path[index]) !== path[index] || path[index] >= layers.length) {
      throw mutationError("preflight_failed", "The requested layer path does not exist in the bound document.");
    }
    container = layers[path[index]];
  }
  if (!container || String(container.typename) !== "Layer") throw mutationError("preflight_failed", "The requested layer path does not resolve to a layer.");
  return container;
}

/** Layer order through the layer's own pageItems, which lists a new item in the call that created it (measured). */
function viLayerOrder(layer) {
  var order = [];
  for (var index = 0; index < layer.pageItems.length; index++) {
    var uuid = layer.pageItems[index].uuid;
    if (typeof uuid !== "string" || uuid.length === 0) throw mutationError("preflight_failed", "A layer item native UUID is unavailable.");
    order.push(uuid);
  }
  return order;
}

function viArtboardRect(document, artboardIndex) {
  if (typeof artboardIndex !== "number" || Math.floor(artboardIndex) !== artboardIndex || artboardIndex < 0 || artboardIndex >= document.artboards.length) {
    throw mutationError("preflight_failed", "The requested artboard does not exist in the bound document.");
  }
  var rect = document.artboards[artboardIndex].artboardRect;
  var bounds = [mutationFiniteNumber(rect[0], "artboardRect[0]"), mutationFiniteNumber(rect[1], "artboardRect[1]"),
    mutationFiniteNumber(rect[2], "artboardRect[2]"), mutationFiniteNumber(rect[3], "artboardRect[3]")];
  if (!(bounds[0] < bounds[2]) || !(bounds[1] > bounds[3])) throw mutationError("preflight_failed", "The selected artboard has degenerate bounds.");
  return bounds;
}

function viDocumentPath(document) {
  try { return String(document.fullName.fsName); } catch (_error) { return ""; }
}

/** Host-side confirmation of the admitted file: it exists with the admitted length and modification second. */
function viSourceFileUnchanged(admission) {
  var file = new File(admission.resolvedPath);
  if (!file.exists) return false;
  var length = -1; var seconds = -1;
  try { length = Number(file.length); seconds = Math.floor(file.modified.getTime() / 1000); } catch (_error) { return false; }
  return length === admission.bytes && seconds === admission.modifiedAtSeconds;
}

function viSourceBlockers(admission, document) {
  if (admission.status === "blocked") return [admission.reason];
  var blockers = [];
  if (!new File(admission.resolvedPath).exists) { blockers.push("source_file_missing"); return blockers; }
  if (!viSourceFileUnchanged(admission)) blockers.push("source_file_changed");
  if (viDocumentPath(document) === admission.resolvedPath) blockers.push("source_is_target_document");
  return blockers;
}

function viResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  viValidateRequest();
  var layer = viResolveLayer(document, params.expectedLayerPath);
  var order = viLayerOrder(layer);
  var rect = viArtboardRect(document, params.artboardIndex);
  var topLeft = [viRound(rect[0] + params.anchor.x), viRound(rect[1] - params.anchor.y)];
  var sublayerCount = layer.layers.length;
  var blockers = [];
  if (!context.mutationAllowed) blockers.push("document_mutation_not_allowed");
  if (String(app.version) !== VI_MEASURED_APP_VERSION) blockers.push("unsupported_host_version");
  // Measured with the target as the only open document; which document becomes active after closing the source
  // with others open is not measured.
  if (app.documents.length !== 1) blockers.push("other_documents_open");
  if (context.colorSpace !== "RGB") blockers.push("document_color_space_unmeasured");
  if (params.expectedLayerPath.length !== 1) blockers.push("layer_not_top_level");
  if (sublayerCount !== 0) blockers.push("layer_has_sublayers");
  if (!layer.visible) blockers.push("layer_hidden");
  if (layer.locked) blockers.push("layer_locked");
  if (order.length >= VI_MAX_LAYER_ITEMS) blockers.push("layer_item_capacity_exceeded");
  var sourceBlockers = viSourceBlockers(params.admission, document);
  for (var s = 0; s < sourceBlockers.length; s++) blockers.push(sourceBlockers[s]);
  if (forApply && blockers.length > 0) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "IMPORT_VECTOR_APPLY_BLOCKED", reasonCodes: blockers }));
  }
  if (forApply && !mutationSameSequence(order, params.expectedLayerItemUuids)) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "IMPORT_VECTOR_LAYER_ORDER_CHANGED" }));
  }
  return { context: context, document: document, layer: layer, order: order, rect: rect, topLeft: topLeft,
    sublayerCount: sublayerCount, blockers: blockers };
}

function viPlan(preflight) {
  return {
    operation: "import_vector_artwork", documentKey: preflight.context.key, hostVersion: String(app.version),
    documentCount: app.documents.length, coordinateSpace: "artboard_top_left", unit: "pt",
    artboardIndex: params.artboardIndex, artboardBounds: preflight.rect,
    source: { path: params.source.path, sha256: params.source.sha256 }, admission: params.admission,
    anchor: { x: params.anchor.x, y: params.anchor.y }, targetTopLeft: preflight.topLeft,
    layer: { path: params.expectedLayerPath, name: preflight.layer.name, visible: preflight.layer.visible, locked: preflight.layer.locked,
      sublayerCount: preflight.sublayerCount, itemUuids: preflight.order },
    predicted: { consumedUuids: [], created: "one GroupItem at index 0 of the layer; its UUIDs and children are known only after apply opens the source" },
    applyBlockedReasonCodes: preflight.blockers, applyAllowed: preflight.blockers.length === 0
  };
}

/** The children of the root group, or a refusal reason; nothing nested, locked, hidden, or of an unmeasured type. */
function viTree(root, withUuid) {
  var nodes = [];
  var items = root.pageItems;
  if (items.length < 1 || items.length > VI_MAX_SOURCE_CHILDREN) return { reason: "source_content_unmeasured" };
  for (var index = 0; index < items.length; index++) {
    var item = items[index];
    var typename = String(item.typename);
    if (VI_CHILD_TYPES[typename] !== true || item.locked === true || item.hidden === true) return { reason: "source_content_unmeasured" };
    var node = { typename: typename, name: String(item.name), memberCount: typename === "CompoundPathItem" ? item.pathItems.length : null };
    if (withUuid) node = { uuid: String(item.uuid), typename: node.typename, name: node.name, memberCount: node.memberCount };
    nodes.push(node);
  }
  return { nodes: nodes };
}

function viSameTree(source, copy) {
  if (source.length !== copy.length) return false;
  for (var index = 0; index < source.length; index++) {
    if (source[index].typename !== copy[index].typename || source[index].name !== copy[index].name ||
        source[index].memberCount !== copy[index].memberCount) return false;
  }
  return true;
}

/**
 * Measured source profile (the probe's own criterion in measured operation): RGB, exactly one page item whose parent is a layer,
 * that item an unclipped, unlocked, visible GroupItem on a visible unlocked layer.
 */
function viInspectSource(source) {
  if (source.documentColorSpace !== DocumentColorSpace.RGB) return { reason: "source_color_space_unmeasured" };
  var roots = [];
  for (var index = 0; index < source.pageItems.length; index++) {
    if (String(source.pageItems[index].parent.typename) === "Layer") roots.push(source.pageItems[index]);
  }
  if (roots.length !== 1) return { reason: "source_root_count" };
  var root = roots[0];
  if (!root.layer.visible || root.layer.locked) return { reason: "source_layer_unmeasured" };
  if (String(root.typename) !== "GroupItem" || root.clipped === true || root.locked === true || root.hidden === true) return { reason: "source_root_not_group" };
  if (source.placedItems.length !== 0 || source.rasterItems.length !== 0) return { reason: "source_content_unmeasured" };
  var tree = viTree(root, false);
  if (tree.reason) return tree;
  return { root: root, rootName: String(root.name), rootBounds: viBounds(root), children: tree.nodes };
}

function viWithoutAlerts(callback) {
  var previous = app.userInteractionLevel;
  try { app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS; return callback(); }
  finally { app.userInteractionLevel = previous; }
}

/**
 * The open documents as the host lists them now. A Document reference is never used once it may be closed: live run 1
 * (validation "implementation history import product path - run 1") lost the source state exactly where the script compared a closed
 * source reference. The source is identified by the path the host reported right after opening it, and only live
 * references from app.documents are compared.
 */
function viInventory(preflight) {
  var inventory = { documents: app.documents.length, activeIsTarget: false, sourcePathOpen: false, source: null, unknown: 0 };
  try { inventory.activeIsTarget = app.documents.length > 0 && app.activeDocument === preflight.document; } catch (_activeError) { inventory.activeIsTarget = false; }
  for (var index = 0; index < app.documents.length; index++) {
    var document = app.documents[index];
    if (document === preflight.document) continue;
    var path = null;
    try { path = String(document.fullName.fsName); } catch (_pathError) { path = null; }
    if (path !== null && typeof preflight.sourceHostPath === "string" && path === preflight.sourceHostPath) {
      inventory.sourcePathOpen = true;
      if (inventory.source === null) inventory.source = document;
    } else {
      inventory.unknown++;
    }
  }
  return inventory;
}

/**
 * Closes the source without saving and records the attempt for its stage; closed only when the host lists the target
 * as the only and active document and no document at the source path.
 */
function viCloseSource(preflight, sourceDocument, stage, attempts) {
  var start = viNow(); var threw = null;
  try { viWithoutAlerts(function () { sourceDocument.close(SaveOptions.DONOTSAVECHANGES); }); } catch (error) { threw = viMessage(error); }
  var ms = viElapsed(start);
  var inventory = viInventory(preflight);
  var attempt = { stage: stage, ms: ms, threw: threw, documentsAfter: inventory.documents, activeIsTarget: inventory.activeIsTarget,
    sourcePathOpen: inventory.sourcePathOpen,
    closed: threw === null && inventory.documents === 1 && inventory.activeIsTarget && !inventory.sourcePathOpen };
  if (attempts && attempts.length < 4) attempts.push(attempt);
  return attempt;
}

/** Opens the admitted source (measured: index 0, active) and refuses anything outside the measured profile before any write to the target. */
function viRevalidate(preflight, plan) {
  var current;
  try { current = viResolve(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Vector import preconditions changed before apply.")); }
  if (current.document !== preflight.document || current.layer !== preflight.layer || !mutationSameSequence(current.order, plan.layer.itemUuids) ||
      !mutationSameSequence(current.rect, plan.artboardBounds) || !mutationSameSequence(current.topLeft, plan.targetTopLeft)) {
    throw mutationBeforeSideEffectError("Vector import target, layer, or artboard changed before apply.");
  }
  var openStart = viNow();
  var sourceDocument = null; var openError = null;
  try { sourceDocument = viWithoutAlerts(function () { return app.open(new File(params.admission.resolvedPath)); }); }
  catch (error) { openError = error; }
  preflight.openMs = viElapsed(openStart);
  if (sourceDocument === null || sourceDocument === undefined) {
    if (app.documents.length === 1 && app.activeDocument === preflight.document) {
      throw mutationBeforeSideEffectError("Illustrator could not open the source: " + viMessage(openError));
    }
    throw new Error("Source open outcome is indeterminate.");
  }
  preflight.sourceDocument = sourceDocument;
  // Read while the reference is certainly live; every later check finds the source by this path.
  try { preflight.sourceHostPath = String(sourceDocument.fullName.fsName); } catch (_hostPathError) { preflight.sourceHostPath = null; }
  var refusal = null; var inspection = null;
  if (sourceDocument === preflight.document || app.documents.length !== 2 || app.activeDocument !== sourceDocument) {
    refusal = "source_open_unexpected_inventory";
  } else if (typeof preflight.sourceHostPath !== "string" || preflight.sourceHostPath.length === 0) {
    refusal = "source_unreadable";
  } else {
    try { inspection = viInspectSource(sourceDocument); if (inspection.reason) refusal = inspection.reason; }
    catch (inspectError) { refusal = "source_unreadable"; }
  }
  if (refusal !== null) {
    if (sourceDocument === preflight.document) throw new Error("Source open returned the target document.");
    var closed = viCloseSource(preflight, sourceDocument, "refusal", null);
    if (!closed.closed) throw new Error("The refused source (" + refusal + ") did not close cleanly: " + stringifyJson(closed));
    preflight.sourceDocument = null;
    throw mutationBeforeSideEffectError("Source is outside the measured import profile (" + refusal + ").");
  }
  preflight.source = inspection;
}

function viCountMatches(collection, uuid, reference) {
  var initial = collection.length; var matches = 0; var same = 0;
  for (var index = 0; index < collection.length; index++) {
    var item = collection[index];
    if (String(item.uuid) === uuid) { matches++; if (reference !== null && item === reference) same++; }
  }
  if (collection.length !== initial) throw mutationError("verify_mismatch", "A collection changed length while it was scanned.");
  return { matches: matches, same: same };
}

/**
 * Identity of the copy: exactly one same-reference match in the document and layer pageItems and groupItems, with
 * the target layer as parent and layer (measured profile). getPageItemFromUuid is never used: it threw 1200 for the copy.
 */
function viScan(preflight, uuid, reference) {
  var d = viCountMatches(preflight.document.pageItems, uuid, reference);
  var dg = viCountMatches(preflight.document.groupItems, uuid, reference);
  var l = viCountMatches(preflight.layer.pageItems, uuid, reference);
  var lg = viCountMatches(preflight.layer.groupItems, uuid, reference);
  var exact = reference !== null && d.matches === 1 && d.same === 1 && dg.matches === 1 && dg.same === 1 &&
    l.matches === 1 && l.same === 1 && lg.matches === 1 && lg.same === 1 && reference.parent === preflight.layer && reference.layer === preflight.layer;
  return { documentPageItems: d.matches, documentGroupItems: dg.matches, layerPageItems: l.matches, layerGroupItems: lg.matches, exact: exact };
}

/** A raw host exception keeps its text and the step it came from, instead of the runner's generic message. */
function viTyped(error, reasonCode, step) {
  if (error && typeof error.mutationReasonCode === "string") return error;
  return mutationError(reasonCode, "Host exception at " + step + ": " + viMessage(error));
}

function viApply(preflight, plan, state) {
  var op = state.operationState;
  try { return viApplySteps(preflight, plan, op); }
  catch (error) { throw viTyped(error, "apply_failed", op.step); }
}

function viApplySteps(preflight, plan, op) {
  op.mutationStarted = true;
  op.step = "duplicate";
  op.rollbackEvidence.failedStep = "duplicate";
  var duplicateStart = viNow();
  var copy = preflight.source.root.duplicate(preflight.layer, ElementPlacement.PLACEATBEGINNING);
  op.duplicateMs = viElapsed(duplicateStart);
  if (!copy || typeof copy.uuid !== "string" || copy.uuid.length === 0) throw mutationError("apply_failed", "Illustrator did not return a copy with a native UUID.");
  op.copy = copy;
  op.copiedUuid = String(copy.uuid);
  op.rollbackEvidence.createdUuid = op.copiedUuid;
  viStep(op, "identity");
  if (String(copy.typename) !== "GroupItem" || !viScan(preflight, op.copiedUuid, copy).exact) {
    throw mutationError("apply_failed", "The copy is not the only same-reference GroupItem in the target document and layer.");
  }
  var copyTree = viTree(copy, true);
  if (copyTree.reason || !viSameTree(preflight.source.children, copyTree.nodes)) throw mutationError("apply_failed", "The copy does not keep the source children.");

  // Unmeasured (1): closing the source in this call while the copy exists.
  viStep(op, "close_source");
  var closed = viCloseSource(preflight, preflight.sourceDocument, "apply", op.rollbackEvidence.sourceCloseAttempts);
  op.evidence.sourceClose = { ms: closed.ms, threw: closed.threw, documentsAfter: closed.documentsAfter, activeIsTarget: closed.activeIsTarget,
    sourcePathOpen: closed.sourcePathOpen };
  if (!closed.closed) throw mutationError("apply_failed", "The source document did not close cleanly after the duplicate.");

  // Unmeasured (3): the identity scans after that close.
  viStep(op, "post_close_scan");
  var scanStart = viNow();
  var scan = viScan(preflight, op.copiedUuid, copy);
  scan.ms = viElapsed(scanStart);
  op.evidence.postCloseScan = scan;
  if (!scan.exact) throw mutationError("apply_failed", "The copy identity is not exact after the source closed.");

  // Unmeasured (2): GroupItem.translate, with the arguments measured for PathItem translate.
  viStep(op, "translate");
  var before = viBounds(copy);
  var delta = [viRound(plan.targetTopLeft[0] - before[0]), viRound(plan.targetTopLeft[1] - before[1])];
  var translateStart = viNow(); var translateThrew = null;
  try { copy.translate(delta[0], delta[1], true, false, false, false); } catch (error) { translateThrew = viMessage(error); }
  var translateMs = viElapsed(translateStart);
  var after = null;
  try { after = viBounds(copy); } catch (_error) { after = null; }
  op.evidence.translate = { ms: translateMs, threw: translateThrew, delta: delta, boundsBefore: before, boundsAfter: after === null ? before : after };
  if (translateThrew !== null || after === null) throw mutationError("apply_failed", "Moving the copy to the anchor failed" + (translateThrew === null ? "." : ": " + translateThrew));
  viStep(op, "verify");
  return copy;
}

function viStep(op, step) { op.step = step; op.rollbackEvidence.failedStep = step; }

function viVerify(preflight, plan, state) {
  try { return viVerifySteps(preflight, plan, state.operationState); }
  catch (error) { throw viTyped(error, "verify_mismatch", "verify"); }
}

function viVerifySteps(preflight, plan, op) {
  if (app.documents.length !== 1 || app.activeDocument !== preflight.document) throw mutationError("verify_mismatch", "The target is not the only and active document after the import.");
  var copy = op.copy;
  var scan = viScan(preflight, op.copiedUuid, copy);
  if (!scan.exact) throw mutationError("verify_mismatch", "The imported group identity is not exact.");
  if (copy.locked === true || copy.hidden === true) throw mutationError("verify_mismatch", "The imported group is not editable.");
  var order = viLayerOrder(preflight.layer);
  if (order.length !== plan.layer.itemUuids.length + 1 || order[0] !== op.copiedUuid || !mutationSameSequence(order.slice(1), plan.layer.itemUuids)) {
    throw mutationError("verify_mismatch", "The imported group is not the only new front item of its layer.");
  }
  var bounds = viBounds(copy);
  var sourceBounds = preflight.source.rootBounds;
  var width = viRound(bounds[2] - bounds[0]); var height = viRound(bounds[1] - bounds[3]);
  if (Math.abs(bounds[0] - plan.targetTopLeft[0]) > VI_TOLERANCE_PT || Math.abs(bounds[1] - plan.targetTopLeft[1]) > VI_TOLERANCE_PT ||
      Math.abs(width - (sourceBounds[2] - sourceBounds[0])) > VI_TOLERANCE_PT || Math.abs(height - (sourceBounds[1] - sourceBounds[3])) > VI_TOLERANCE_PT) {
    throw mutationError("verify_mismatch", "The imported group is not at the anchor with the source size.");
  }
  var tree = viTree(copy, true);
  if (tree.reason || !viSameTree(preflight.source.children, tree.nodes)) throw mutationError("verify_mismatch", "The imported group does not keep the source children.");
  if (!viSourceFileUnchanged(params.admission)) throw mutationError("verify_mismatch", "The source file changed during the import.");
  return { uuid: op.copiedUuid, type: "GroupItem", name: String(copy.name), geometricBounds: bounds, width: width, height: height,
    children: tree.nodes, layerItemUuids: order,
    source: { rootName: preflight.source.rootName, geometricBounds: sourceBounds, children: preflight.source.children },
    timing: { openMs: preflight.openMs, duplicateMs: op.duplicateMs }, unmeasured: op.evidence };
}

/**
 * Cleanup in a fixed order, every branch reaching the source close (design doc "Failure cleanup"):
 * 1. the copy: removed only when the scans identify exactly one same-reference copy (with the source possibly still
 *    open, as the probe's measured rollback did); an unidentifiable copy is never touched;
 * 2. the source: found by the host path recorded at open, closed without saving while it is listed; a Document
 *    reference that may be closed is never used;
 * 3. proof: the host lists the target as the only, active document, and its layer order is the baseline.
 * Anything unproved is indeterminate and names what may remain: the copy UUID, the source's open state, the step the
 * apply failed at, and every close attempt with its stage.
 */
function viRollback(state) {
  try { return viRollbackSteps(state); }
  catch (error) { return { status: "indeterminate", message: "Rollback host exception: " + viMessage(error) }; }
}

function viRollbackSteps(state) {
  var preflight = state.preflight; var op = state.operationState; var evidence = op.rollbackEvidence;
  if (!preflight) return { status: "indeterminate", message: "Rollback target identity is indeterminate." };
  var copyOutcome = "not_created";
  if (op.copy !== null && typeof op.copiedUuid === "string") {
    copyOutcome = "unidentified";
    try {
      if (viScan(preflight, op.copiedUuid, op.copy).exact) {
        try { op.copy.remove(); } catch (_removeError) { /* judged by the scans below */ }
        var absent = viScan(preflight, op.copiedUuid, null);
        if (absent.documentPageItems + absent.documentGroupItems + absent.layerPageItems + absent.layerGroupItems === 0) copyOutcome = "removed";
        else if (viScan(preflight, op.copiedUuid, op.copy).exact) copyOutcome = "still_present";
      }
    } catch (_scanError) { copyOutcome = "unidentified"; }
  } else if (op.mutationStarted === true) {
    // The duplicate threw or returned no usable copy: an effect cannot be tied to a UUID.
    copyOutcome = "unknown";
  }
  if (preflight.sourceDocument) {
    try {
      var inventory = viInventory(preflight);
      if (inventory.source !== null) {
        evidence.sourceClosed = viCloseSource(preflight, inventory.source, "rollback", evidence.sourceCloseAttempts).closed;
      } else {
        evidence.sourceClosed = inventory.documents === 1 && inventory.activeIsTarget && !inventory.sourcePathOpen ? true : null;
      }
    } catch (_closeError) { evidence.sourceClosed = null; }
  }
  try { evidence.restoredItemUuids = viLayerOrder(preflight.layer); } catch (_orderError) { evidence.restoredItemUuids = null; }
  if (copyOutcome === "still_present") return { status: "failed", message: "Rollback did not remove the copy; it is still present in the target layer." };
  if (copyOutcome !== "removed") {
    return { status: "indeterminate", message: copyOutcome === "unknown"
      ? "The duplicate returned no identifiable copy; its effect must be reconciled against the baseline layer order."
      : "Rollback could not identify exactly one copy; nothing was removed." };
  }
  if (evidence.sourceClosed !== true) return { status: "indeterminate", message: "Rollback removed the copy but the source document may still be open." };
  var finalInventory = viInventory(preflight);
  if (finalInventory.documents !== 1 || !finalInventory.activeIsTarget) return { status: "indeterminate", message: "Rollback left another document open or the target inactive." };
  if (evidence.restoredItemUuids === null || !mutationSameSequence(evidence.restoredItemUuids, preflight.order)) {
    return { status: "indeterminate", message: "Rollback did not restore the baseline layer order." };
  }
  return { status: "verified" };
}

var viExecution = runMutationTransaction({
  apply: params.apply === true,
  initialOperationState: function () {
    return { mutationStarted: false, step: "open", copy: null, copiedUuid: null, duplicateMs: 0,
      evidence: { sourceClose: null, postCloseScan: null, translate: null },
      rollbackEvidence: { createdUuid: null, restoredItemUuids: null, sourceClosed: null, failedStep: null, sourceCloseAttempts: [] } };
  },
  preflight: viResolve,
  plan: viPlan,
  revalidate: viRevalidate,
  applyMutation: viApply,
  verify: viVerify,
  rollback: viRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () { return { reasonCode: "created_state_unknown", message: "Vector import outcome is indeterminate.", evidence: { createdUuid: null, restoredItemUuids: null, sourceClosed: null, failedStep: null, sourceCloseAttempts: [] } }; },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var viDocument = viExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === viExecution.preflight.document) viDocument = getDocumentContext();
var result = { operation: "import_vector_artwork", applied: viExecution.transaction.state === "verified",
  document: viDocument, plan: viExecution.plan, transaction: viExecution.transaction };
if (viExecution.transaction.state === "verified") result.created = viExecution.value;
`;
export const IMPORT_VECTOR_ARTWORK_HOST_SCRIPT_DIGEST = canonicalSha256(IMPORT_VECTOR_ARTWORK_SCRIPT);
export const IMPORT_VECTOR_ARTWORK_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: IMPORT_VECTOR_ARTWORK_OPERATION, validator: IMPORT_VECTOR_ARTWORK_VALIDATOR,
    canonicalContractVersion: CANONICAL_VERSION, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: IMPORT_VECTOR_ARTWORK_SAFETY_IDENTITY, hostScriptDigest: IMPORT_VECTOR_ARTWORK_HOST_SCRIPT_DIGEST,
    mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    const { commandId: _commandId, admission: _admission, ...digestRequest } = request;
    const digest = canonicalSha256({ operation: IMPORT_VECTOR_ARTWORK_OPERATION, validator: IMPORT_VECTOR_ARTWORK_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: 'commandId' in request ? request.commandId : null,
        documentKey: request.expectedDocumentKey, digest };
}
export const importVectorArtworkToolContract = {
    name: 'illustrator_import_vector_artwork',
    title: 'Plan or Import SVG / AI Artwork',
    description: 'Plan or import the editable contents of one .svg or .ai file (absolute path plus its SHA-256) as one new GroupItem at the front of an explicit top-level layer, with the top-left of its bounds at an artboard-top-left anchor in points. Measured profile only: Illustrator 30.8.1 in the foreground, the target is the only open document, RGB source and target, a top-level target layer without sublayers, and a source whose single layer holds exactly one visible unlocked GroupItem of paths, compound paths, and text. SVG must declare px width and height and must not reference images or external resources; anything else is refused. The plan reads only the target (the source is checked in Node); pass plan.layer.itemUuids back as expected_layer_item_uuids to apply. Apply opens the source without alerts, duplicates the root group, proves the copy by collection scans, closes the source without saving, moves the copy to the anchor, and verifies position, size, children, and layer order; on failure it removes only the copy and closes the source. The source file is never written.',
    inputSchema,
    publicInputSchema: importVectorArtworkPublicInputSchema,
    outputSchema: importVectorArtworkResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(IMPORT_VECTOR_ARTWORK_SAFETY.policy),
    normalizePublicInput,
};
export function mapImportVectorExecutionError(error, detail) {
    if (detail?.code === 'IMPORT_VECTOR_APPLY_BLOCKED') {
        return new Error(`Vector import is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}.`);
    }
    if (detail?.code === 'IMPORT_VECTOR_LAYER_ORDER_CHANGED') {
        return new Error('The target layer order does not match expected_layer_item_uuids; plan again.');
    }
    return error instanceof Error ? error : new Error(String(error));
}
export function createImportVectorArtworkAdapter() {
    return {
        version: 1, operation: IMPORT_VECTOR_ARTWORK_OPERATION, validator: IMPORT_VECTOR_ARTWORK_VALIDATOR,
        safety: IMPORT_VECTOR_ARTWORK_SAFETY, safetyRegistrationIdentity: IMPORT_VECTOR_ARTWORK_SAFETY_IDENTITY,
        adapterIdentity: IMPORT_VECTOR_ARTWORK_ADAPTER_IDENTITY, tool: importVectorArtworkToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: importVectorArtworkResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: CLASSIFIER_VERSION, safetyConformanceVersion: CONFORMANCE_VERSION,
        errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: IMPORT_VECTOR_ARTWORK_HOST_SCRIPT_DIGEST,
        mutationHostApplicationMode: 'foreground',
        admit: admitImportVectorRequest,
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: IMPORT_VECTOR_ARTWORK_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: IMPORT_VECTOR_ARTWORK_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: IMPORT_VECTOR_ARTWORK_OPERATION, documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: IMPORT_VECTOR_ARTWORK_ADAPTER_IDENTITY, mutationHostApplicationMode: 'foreground', script: IMPORT_VECTOR_ARTWORK_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = importVectorArtworkResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back' || state === 'rollback_failed')
                return { state };
            if (state === 'planned')
                throw new Error('Vector import plan is not a terminal mutation result.');
            throw new Error('Indeterminate vector import must retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError: mapImportVectorExecutionError,
    };
}
