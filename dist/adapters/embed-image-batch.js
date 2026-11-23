import { z } from 'zod';
import { GuidedRefusalError } from '../blocked-guidance.js';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { deleteBackupFactsSchema, verifyDeleteBackup } from '../delete-shared.js';
import { hostVersionInternalFields, hostVersionPublicFields, normalizeHostVersionConsent } from '../host-version-consent.js';
import { documentContextSchema, layerPathSchema } from '../mutation-result-schema-core.js';
import { canonicalDigest } from '../operation-safety-policy-core.js';
import { admitSourceWithColorSpace, placeImageAdmissionSchema } from './place-image-adapter.js';
import { SNAPSHOT_RESULT_ADMISSION_BYTES } from './snapshot-result-size.js';
import { absolutePathSchema, boundsSchema, colorSpaceAdmissionSchema, documentKeySchema, EMBED_IMAGE_MAX_DIRECT_ITEMS, EMBED_IMAGE_TOLERANCE_PT, embedTransactionSchema, matrixSchema, pixelsSchema, positionSchema, sourceSchema, uuidSchema, } from './embed-image-shared.js';
export const EMBED_IMAGE_BATCH_MAX_ITEMS = 16;
export const EMBED_IMAGE_BATCH_MAX_SOURCE_PIXELS = 4_000_000;
export const EMBED_IMAGE_BATCH_SMALL_SOURCE_PIXELS = 960_000;
export const EMBED_IMAGE_BATCH_MAX_LARGE_SOURCES = 2;
export const EMBED_IMAGE_BATCH_MAX_TOTAL_PIXELS = 21_440_000;
export const EMBED_IMAGE_BATCH_MAX_LAYERS = 4;
export const EMBED_IMAGE_BATCH_RESULT_ADMISSION_BYTES = SNAPSHOT_RESULT_ADMISSION_BYTES;
export const EMBED_IMAGE_BATCH_MEASURED_FORMATS = ['jpeg', 'png'];
export const EMBED_IMAGE_BATCH_MEASURED_COLOR_SPACES = ['RGB'];
const slotFields = {
    layerPath: layerPathSchema,
    layerIndex: z.number().int().nonnegative().max(EMBED_IMAGE_MAX_DIRECT_ITEMS),
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
export const embedBatchBeforeItemSchema = z.strictObject({
    uuid: uuidSchema,
    type: z.literal('PlacedItem'),
    ...slotFields,
    linkPath: absolutePathSchema,
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
    matrix: matrixSchema,
});
export const embedBatchAfterItemSchema = z.strictObject({
    uuid: uuidSchema.nullable(),
    type: z.literal('RasterItem'),
    ...slotFields,
    embedded: z.literal(true),
    pixels: pixelsSchema,
});
const layerOrderMax = EMBED_IMAGE_MAX_DIRECT_ITEMS;
const layerBeforeSchema = z.strictObject({ layerPath: layerPathSchema, order: z.array(uuidSchema).min(1).max(layerOrderMax) });
const layerAfterSchema = z.strictObject({ layerPath: layerPathSchema, order: z.array(uuidSchema.nullable()).min(1).max(layerOrderMax) });
function pathKey(path) { return path.join('/'); }
function refineSlots(items, layers, slotValue, context) {
    const byPath = new Map();
    for (const layer of layers) {
        const key = pathKey(layer.layerPath);
        if (byPath.has(key))
            context.addIssue({ code: 'custom', message: 'Embed batch layers must be distinct.' });
        byPath.set(key, layer.order);
    }
    const used = new Set();
    const slots = new Set();
    const uuids = new Set();
    items.forEach((item, index) => {
        const order = byPath.get(pathKey(item.layerPath));
        if (order === undefined) {
            context.addIssue({ code: 'custom', message: `Embed batch item ${index + 1} names a layer that is not listed.` });
            return;
        }
        used.add(pathKey(item.layerPath));
        const slot = `${pathKey(item.layerPath)}#${item.layerIndex}`;
        if (slots.has(slot))
            context.addIssue({ code: 'custom', message: 'Embed batch items must occupy distinct slots.' });
        slots.add(slot);
        if (item.uuid !== null) {
            if (uuids.has(item.uuid))
                context.addIssue({ code: 'custom', message: 'Embed batch items must be distinct.' });
            uuids.add(item.uuid);
        }
        if (item.layerIndex >= order.length || order[item.layerIndex] !== slotValue(item)) {
            context.addIssue({ code: 'custom', message: `Embed batch item ${index + 1} does not match its slot in the layer order.` });
        }
    });
    if (used.size !== layers.length)
        context.addIssue({ code: 'custom', message: 'Every listed embed batch layer must hold a target.' });
}
export const embedBatchBeforeSchema = z.strictObject({
    items: z.array(embedBatchBeforeItemSchema).min(1).max(EMBED_IMAGE_BATCH_MAX_ITEMS),
    layers: z.array(layerBeforeSchema).min(1).max(EMBED_IMAGE_BATCH_MAX_LAYERS),
}).superRefine((value, context) => refineSlots(value.items, value.layers, (item) => item.uuid, context));
export const embedBatchAfterSchema = z.strictObject({
    items: z.array(embedBatchAfterItemSchema).min(1).max(EMBED_IMAGE_BATCH_MAX_ITEMS),
    layers: z.array(layerAfterSchema).min(1).max(EMBED_IMAGE_BATCH_MAX_LAYERS),
}).superRefine((value, context) => refineSlots(value.items, value.layers, () => null, context));
export function plannedEmbedBatchAfter(before, pixels) {
    const slotKeys = new Set(before.items.map((item) => `${pathKey(item.layerPath)}#${item.layerIndex}`));
    return {
        items: before.items.map((item, index) => ({
            uuid: null, type: 'RasterItem', layerPath: item.layerPath, layerIndex: item.layerIndex, name: item.name, position: item.position,
            geometricBounds: item.geometricBounds, locked: item.locked, hidden: item.hidden, layerVisible: item.layerVisible, layerLocked: item.layerLocked,
            ancestorLocked: item.ancestorLocked, ancestorHidden: item.ancestorHidden, embedded: true, pixels: { width: pixels[index].width, height: pixels[index].height },
        })),
        layers: before.layers.map((layer) => ({
            layerPath: layer.layerPath,
            order: layer.order.map((uuid, index) => (slotKeys.has(`${pathKey(layer.layerPath)}#${index}`) ? null : uuid)),
        })),
    };
}
function same(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}
function near(a, b) { return Math.abs(a - b) <= EMBED_IMAGE_TOLERANCE_PT; }
export function embedBatchAfterItemWithinTolerance(left, right) {
    return left.type === right.type && same(left.layerPath, right.layerPath) && left.layerIndex === right.layerIndex && left.name === right.name &&
        left.embedded === right.embedded && left.pixels.width === right.pixels.width && left.pixels.height === right.pixels.height &&
        left.locked === right.locked && left.hidden === right.hidden && left.layerVisible === right.layerVisible && left.layerLocked === right.layerLocked &&
        left.ancestorLocked === right.ancestorLocked && left.ancestorHidden === right.ancestorHidden &&
        left.position.every((value, index) => near(value, right.position[index])) &&
        left.geometricBounds.every((value, index) => near(value, right.geometricBounds[index]));
}
function beforeItemState(item) { const { uuid: _uuid, ...state } = item; return state; }
function afterItemState(item) { const { uuid: _uuid, ...state } = item; return state; }
export function embedBatchBeforeItemWithinTolerance(left, right) {
    return left.uuid === right.uuid && left.type === right.type && same(left.layerPath, right.layerPath) && left.layerIndex === right.layerIndex &&
        left.name === right.name && left.linkPath === right.linkPath && left.locked === right.locked && left.hidden === right.hidden &&
        left.layerVisible === right.layerVisible && left.layerLocked === right.layerLocked && left.ancestorLocked === right.ancestorLocked &&
        left.ancestorHidden === right.ancestorHidden &&
        left.position.every((value, index) => near(value, right.position[index])) &&
        left.geometricBounds.every((value, index) => near(value, right.geometricBounds[index])) &&
        near(left.width, right.width) && near(left.height, right.height) && left.matrix.every((value, index) => near(value, right.matrix[index]));
}
const requestItem = z.strictObject({ targetUuid: uuidSchema, source: sourceSchema });
const admittedItem = requestItem.extend({
    sourceAdmission: placeImageAdmissionSchema.optional(),
    sourceColorSpace: colorSpaceAdmissionSchema.optional(),
    sourceModifiedAtMs: z.number().int().nonnegative().optional(),
});
const itemsOf = (item) => z.array(item).min(1).max(EMBED_IMAGE_BATCH_MAX_ITEMS);
const commonRequest = { ...hostVersionInternalFields, expectedDocumentKey: documentKeySchema, backupId: z.uuid() };
const admissionFields = {
    backup: deleteBackupFactsSchema.optional(),
    resultTooLarge: z.boolean().optional(),
};
function refineDistinct(request, context) {
    const uuids = request.items.map((item) => item.targetUuid);
    if (new Set(uuids).size !== uuids.length)
        context.addIssue({ code: 'custom', path: ['items'], message: 'Duplicate target UUID in the embed batch.' });
}
const unadmittedBatchInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonRequest, items: itemsOf(requestItem), apply: z.literal(false) }),
    z.strictObject({ ...commonRequest, items: itemsOf(requestItem), expectedBefore: embedBatchBeforeSchema, confirmedAfter: embedBatchAfterSchema, apply: z.literal(true), commandId: canonicalCommandIdSchema }),
]).superRefine((request, context) => {
    refineDistinct(request, context);
    if (request.apply)
        refineEchoes(request, context);
});
export const embedBatchInternalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonRequest, ...admissionFields, items: itemsOf(admittedItem), apply: z.literal(false) }),
    z.strictObject({ ...commonRequest, ...admissionFields, items: itemsOf(admittedItem), expectedBefore: embedBatchBeforeSchema, confirmedAfter: embedBatchAfterSchema, apply: z.literal(true), commandId: canonicalCommandIdSchema }),
]).superRefine((request, context) => {
    refineDistinct(request, context);
    request.items.forEach((item, index) => {
        if (item.sourceAdmission?.status === 'admitted' && item.sourceAdmission.sha256 !== item.source.sha256) {
            context.addIssue({ code: 'custom', path: ['items', index], message: 'An admitted source must carry the requested SHA-256.' });
        }
    });
    if (request.backup !== undefined && request.backup.backupId !== request.backupId) {
        context.addIssue({ code: 'custom', message: 'Admitted backup facts must name the requested backup_id.' });
    }
    if (request.apply)
        refineEchoes(request, context);
});
function refineEchoes(request, context) {
    const { expectedBefore, confirmedAfter } = request;
    if (expectedBefore.items.length !== request.items.length || expectedBefore.items.some((item, index) => item.uuid !== request.items[index].targetUuid)) {
        context.addIssue({ code: 'custom', message: 'expected_before must list the requested targets in order.' });
    }
    if (confirmedAfter.items.length !== request.items.length)
        context.addIssue({ code: 'custom', message: 'confirmed_after must list one raster per requested target.' });
    if (confirmedAfter.items.some((item) => item.uuid !== null))
        context.addIssue({ code: 'custom', message: 'confirmed_after must leave the UUIDs unknown (null).' });
}
const publicItem = z.strictObject({ target_uuid: uuidSchema, source: sourceSchema });
const commonPublic = {
    ...hostVersionPublicFields,
    expected_document_key: documentKeySchema,
    items: z.array(publicItem).min(1).max(EMBED_IMAGE_BATCH_MAX_ITEMS).describe('Instead of target_uuid and source; distinct target_uuids.'),
    backup_id: z.uuid(),
};
function refinePublicDistinct(value, context) {
    const uuids = value.items.map((item) => item.target_uuid);
    if (new Set(uuids).size !== uuids.length)
        context.addIssue({ code: 'custom', path: ['items'], message: 'Duplicate target UUID in the embed batch.' });
}
export const embedImageBatchPublicPlanSchema = z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }).superRefine(refinePublicDistinct);
export const embedImageBatchPublicApplySchema = z.strictObject({
    ...commonPublic,
    expected_before: embedBatchBeforeSchema,
    confirmed_after: embedBatchAfterSchema,
    apply: z.literal(true),
    command_id: applyCommandIdSchema,
}).superRefine(refinePublicDistinct);
const echoPublished = z.record(z.string(), z.unknown());
export const embedImageBatchPublishedSchema = z.strictObject({
    expected_document_key: documentKeySchema, items: z.array(publicItem).min(1).max(EMBED_IMAGE_BATCH_MAX_ITEMS), backup_id: z.uuid(),
    apply: z.boolean().default(false), expected_before: echoPublished.optional(), confirmed_after: echoPublished.optional(), command_id: applyCommandIdSchema.optional(),
});
export function normalizeEmbedBatchPublicInput(input) {
    const value = z.union([embedImageBatchPublicPlanSchema, embedImageBatchPublicApplySchema]).parse(input);
    const common = {
        ...normalizeHostVersionConsent(value), expectedDocumentKey: value.expected_document_key, backupId: value.backup_id,
        items: value.items.map((item) => ({ targetUuid: item.target_uuid, source: item.source })),
    };
    return value.apply
        ? { ...common, expectedBefore: value.expected_before, confirmedAfter: value.confirmed_after, apply: true, commandId: value.command_id }
        : { ...common, apply: false };
}
export function isEmbedBatchInput(input) {
    return typeof input === 'object' && input !== null && 'items' in input && input.items !== undefined;
}
function jsonBytes(value) {
    const text = JSON.stringify(value) ?? 'null';
    let bytes = 0;
    for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index);
        if (code < 32 || (code >= 0xd800 && code <= 0xdfff))
            bytes += 6;
        else if (code < 128)
            bytes += 1;
        else if (code < 2048)
            bytes += 2;
        else
            bytes += 3;
    }
    return bytes;
}
export function embedBatchResultBytesBound(documentKey, backup, items) {
    const uuidBytes = 44;
    const nameBytes = 3 * (255 * 3 + 8);
    const snapshotBytes = 2_400;
    const evidenceBytes = 500;
    let bytes = 16_384 + 3 * jsonBytes(documentKey) + jsonBytes(backup);
    for (const item of items) {
        const linkPath = item.sourceAdmission.resolvedPath === null ? 0 : jsonBytes(item.sourceAdmission.resolvedPath);
        bytes += jsonBytes(item.source) + jsonBytes(item.sourceAdmission) + jsonBytes(item.sourceColorSpace) + linkPath +
            nameBytes + snapshotBytes + evidenceBytes + 6 * uuidBytes;
    }
    const layers = Math.min(items.length, EMBED_IMAGE_BATCH_MAX_LAYERS);
    bytes += layers * EMBED_IMAGE_MAX_DIRECT_ITEMS * uuidBytes * 3;
    return bytes;
}
export function assertEmbedBatchPixelAdmission(items) {
    let total = 0;
    let largeSources = 0;
    let firstExtraLarge = null;
    for (const [index, item] of items.entries()) {
        const admission = item.sourceAdmission;
        if (admission?.status !== 'admitted' || admission.pixels === null)
            continue;
        const { width, height } = admission.pixels;
        const pixels = width * height;
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 ||
            !Number.isSafeInteger(pixels) || pixels <= 0 || !Number.isSafeInteger(total + pixels)) {
            throw new GuidedRefusalError('embed_batch_pixels_invalid', `Item ${index + 1}: inspected pixel dimensions, their product and the batch sum must be positive safe integers. Reinspect the linked source before planning again. Nothing was embedded.`);
        }
        if (pixels > EMBED_IMAGE_BATCH_MAX_SOURCE_PIXELS) {
            throw new GuidedRefusalError('embed_batch_pixel_limit', `Item ${index + 1}: ${pixels} pixels exceeds the batch per-source limit of ${EMBED_IMAGE_BATCH_MAX_SOURCE_PIXELS}. Splitting cannot shrink one source. Keep its pixels unchanged and use the existing single-item target_uuid/source input with a new plan and verified backup. Nothing was embedded.`);
        }
        total += pixels;
        if (pixels > EMBED_IMAGE_BATCH_SMALL_SOURCE_PIXELS) {
            largeSources++;
            if (largeSources > EMBED_IMAGE_BATCH_MAX_LARGE_SOURCES && firstExtraLarge === null)
                firstExtraLarge = index;
        }
    }
    const split = `Split targets into smaller batches with at most ${EMBED_IMAGE_BATCH_MAX_LARGE_SOURCES} sources above ${EMBED_IMAGE_BATCH_SMALL_SOURCE_PIXELS} pixels and at most ${EMBED_IMAGE_BATCH_MAX_TOTAL_PIXELS} pixels in total; keep the source pixels unchanged and create a new plan with a verified backup. Nothing was embedded.`;
    if (total > EMBED_IMAGE_BATCH_MAX_TOTAL_PIXELS) {
        throw new GuidedRefusalError('embed_batch_pixel_limit', `Batch total ${total} pixels exceeds the limit of ${EMBED_IMAGE_BATCH_MAX_TOTAL_PIXELS}. ${split}`);
    }
    if (firstExtraLarge !== null) {
        throw new GuidedRefusalError('embed_batch_pixel_limit', `Item ${firstExtraLarge + 1}: the batch has ${largeSources} sources above ${EMBED_IMAGE_BATCH_SMALL_SOURCE_PIXELS} pixels; the limit is ${EMBED_IMAGE_BATCH_MAX_LARGE_SOURCES}. ${split}`);
    }
}
export async function admitEmbedBatchRequest(input, services) {
    const request = unadmittedBatchInputSchema.parse(input);
    if (services.backupStore === undefined)
        throw new Error('Embedding requires the backup store; call through the MCP server.');
    const backup = await verifyDeleteBackup(services.backupStore, request.backupId);
    const items = [];
    for (const item of request.items) {
        const admitted = await admitSourceWithColorSpace(item.source, services.imageFileInspector);
        let sourceAdmission = admitted.admission;
        if (sourceAdmission.status === 'admitted' && !EMBED_IMAGE_BATCH_MEASURED_FORMATS.includes(sourceAdmission.format)) {
            sourceAdmission = { status: 'blocked', resolvedPath: sourceAdmission.resolvedPath, reason: 'source_format_unmeasured',
                message: `Batch embedding is measured for ${EMBED_IMAGE_BATCH_MEASURED_FORMATS.join(', ')} sources in RGB documents only; ${sourceAdmission.format} is excluded.` };
        }
        const sourceColorSpace = admitted.colorSpace === null ? { status: 'unavailable', value: null, message: 'The source was not admitted.' }
            : admitted.colorSpace.status === 'available' ? { status: 'available', value: admitted.colorSpace.value, message: null }
                : { status: 'unavailable', value: null, message: admitted.colorSpace.message.slice(0, 500) };
        const sourceModifiedAtMs = sourceAdmission.status === 'admitted' ? Date.parse(sourceAdmission.modifiedAt) : undefined;
        items.push({ ...item, sourceAdmission, sourceColorSpace, ...(sourceModifiedAtMs === undefined ? {} : { sourceModifiedAtMs }) });
    }
    assertEmbedBatchPixelAdmission(items);
    const resultTooLarge = embedBatchResultBytesBound(request.expectedDocumentKey, backup, items.map((item) => ({ source: item.source, sourceAdmission: item.sourceAdmission, sourceColorSpace: item.sourceColorSpace }))) >
        EMBED_IMAGE_BATCH_RESULT_ADMISSION_BYTES;
    return { ...request, items, backup, ...(resultTooLarge ? { resultTooLarge } : {}) };
}
export const EMBED_IMAGE_BATCH_BLOCKERS = [
    'document_not_saved', 'backup_mismatch', 'backup_stale', 'host_version_unmeasured', 'document_color_space_unmeasured', 'result_too_large',
    'target_locked', 'target_hidden', 'layer_hidden', 'layer_locked', 'ancestor_hidden', 'ancestor_locked',
    'link_missing', 'link_path_mismatch',
    'source_file_missing', 'source_file_unavailable', 'source_hash_mismatch', 'source_format_unmeasured', 'source_file_changed',
    'source_color_space_unmeasured', 'source_pixels_unknown',
];
const blockerSchema = z.enum(EMBED_IMAGE_BATCH_BLOCKERS);
const DOCUMENT_BLOCKERS = new Set(['document_not_saved', 'backup_mismatch', 'backup_stale', 'host_version_unmeasured', 'document_color_space_unmeasured', 'result_too_large']);
const HOST_OBSERVED_ITEM_BLOCKERS = new Set(['link_missing', 'source_file_missing', 'source_file_changed']);
const planItemSchema = z.strictObject({ source: sourceSchema, sourceAdmission: placeImageAdmissionSchema, sourceColorSpace: colorSpaceAdmissionSchema });
const itemBlockersSchema = z.strictObject({ index: z.number().int().nonnegative().max(EMBED_IMAGE_BATCH_MAX_ITEMS - 1), targetUuid: uuidSchema, codes: z.array(blockerSchema).min(1) });
function derivedItemBlockers(plan, index) {
    const before = plan.before.items[index];
    const { sourceAdmission, sourceColorSpace } = plan.items[index];
    const derived = new Set();
    if (before.locked)
        derived.add('target_locked');
    if (before.hidden)
        derived.add('target_hidden');
    if (!before.layerVisible)
        derived.add('layer_hidden');
    if (before.layerLocked)
        derived.add('layer_locked');
    if (before.ancestorHidden)
        derived.add('ancestor_hidden');
    if (before.ancestorLocked)
        derived.add('ancestor_locked');
    if (sourceAdmission.status === 'blocked')
        derived.add(sourceAdmission.reason);
    else {
        if (sourceAdmission.resolvedPath !== before.linkPath)
            derived.add('link_path_mismatch');
        if (sourceAdmission.pixels === null)
            derived.add('source_pixels_unknown');
        if (sourceColorSpace.status !== 'available' || !EMBED_IMAGE_BATCH_MEASURED_COLOR_SPACES.includes(sourceColorSpace.value ?? ''))
            derived.add('source_color_space_unmeasured');
    }
    return derived;
}
export const embedBatchPlanSchema = z.strictObject({
    operation: z.literal('embed_image'),
    documentKey: documentKeySchema,
    backup: deleteBackupFactsSchema,
    items: z.array(planItemSchema).min(1).max(EMBED_IMAGE_BATCH_MAX_ITEMS),
    before: embedBatchBeforeSchema,
    after: embedBatchAfterSchema.nullable(),
    applyBlockedReasonCodes: z.array(blockerSchema),
    itemBlockers: z.array(itemBlockersSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    const confirmedAndClear = plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0;
    if (plan.applyAllowed !== confirmedAndClear)
        context.addIssue({ code: 'custom', message: 'Embed applyAllowed must require confirmation and no blockers.' });
    if (plan.items.length !== plan.before.items.length) {
        context.addIssue({ code: 'custom', message: 'The plan must list one source per target.' });
        return;
    }
    const pixels = [];
    let allKnown = true;
    plan.items.forEach((item, index) => {
        if (item.sourceAdmission.status === 'admitted') {
            if (item.sourceAdmission.sha256 !== item.source.sha256)
                context.addIssue({ code: 'custom', message: 'Embed source admission must carry the requested SHA-256.' });
            if (item.sourceAdmission.pixels === null)
                allKnown = false;
            else
                pixels.push(item.sourceAdmission.pixels);
        }
        else
            allKnown = false;
        const reported = new Set(plan.itemBlockers.filter((entry) => entry.index === index).flatMap((entry) => entry.codes));
        for (const code of derivedItemBlockers(plan, index))
            if (!reported.has(code))
                context.addIssue({ code: 'custom', message: `Embed plan must expose blocker ${code} of item ${index + 1}.` });
        for (const code of reported)
            if (!derivedItemBlockers(plan, index).has(code) && !HOST_OBSERVED_ITEM_BLOCKERS.has(code))
                context.addIssue({ code: 'custom', message: `Embed plan reports an underivable blocker ${code} of item ${index + 1}.` });
    });
    plan.itemBlockers.forEach((entry, position) => {
        if (entry.index >= plan.before.items.length || plan.before.items[entry.index].uuid !== entry.targetUuid)
            context.addIssue({ code: 'custom', message: 'An item blocker must name its planned target.' });
        if (position > 0 && plan.itemBlockers[position - 1].index >= entry.index)
            context.addIssue({ code: 'custom', message: 'Item blockers must be listed once per item in request order.' });
        if (entry.codes.some((code) => DOCUMENT_BLOCKERS.has(code)))
            context.addIssue({ code: 'custom', message: 'A document blocker is not an item blocker.' });
    });
    const reportedAll = new Set(plan.applyBlockedReasonCodes);
    const itemCodes = new Set(plan.itemBlockers.flatMap((entry) => entry.codes));
    for (const code of itemCodes)
        if (!reportedAll.has(code))
            context.addIssue({ code: 'custom', message: `Embed plan must expose blocker ${code}.` });
    for (const code of reportedAll)
        if (!itemCodes.has(code) && !DOCUMENT_BLOCKERS.has(code))
            context.addIssue({ code: 'custom', message: `Embed plan reports an underivable blocker ${code}.` });
    if (!allKnown) {
        if (plan.after !== null)
            context.addIssue({ code: 'custom', message: 'Embed after state requires known admitted pixels for every item.' });
    }
    else if (plan.after === null || plan.after.items.some((item) => item.uuid !== null) ||
        canonicalDigest(afterStateOf(plan.after)) !== canonicalDigest(afterStateOf(plannedEmbedBatchAfter(plan.before, pixels)))) {
        context.addIssue({ code: 'custom', message: 'Embed after state must be the before slots, names and frames as RasterItems of the admitted pixels.' });
    }
});
function afterStateOf(after) { return { items: after.items.map(afterItemState), layers: after.layers }; }
function beforeStateOf(before) { return { items: before.items.map(beforeItemState), layers: before.layers }; }
const rasterEvidenceSchema = z.strictObject({
    matrix: matrixSchema,
    boundingBox: boundsSchema,
    imageColorSpace: z.string().min(1).max(64),
    bitsPerChannel: z.number().finite(),
    channels: z.number().finite(),
    nameRestored: z.boolean(),
});
const postconditionSchema = z.strictObject({
    items: z.array(z.strictObject({ raster: embedBatchAfterItemSchema, evidence: rasterEvidenceSchema })).min(1).max(EMBED_IMAGE_BATCH_MAX_ITEMS),
    layers: z.array(z.strictObject({ layerPath: layerPathSchema, order: z.array(uuidSchema).min(1).max(layerOrderMax) })).min(1).max(EMBED_IMAGE_BATCH_MAX_LAYERS),
    saved: z.boolean(),
});
const batchRollbackEvidence = {
    targetUuids: z.array(uuidSchema).min(1).max(EMBED_IMAGE_BATCH_MAX_ITEMS),
    afterUuids: z.array(uuidSchema.nullable()).min(1).max(EMBED_IMAGE_BATCH_MAX_ITEMS),
    embeddedCount: z.number().int().nonnegative().max(EMBED_IMAGE_BATCH_MAX_ITEMS),
    failedIndex: z.number().int().nonnegative().max(EMBED_IMAGE_BATCH_MAX_ITEMS - 1).nullable(),
    unchangedSnapshots: z.array(embedBatchBeforeItemSchema).max(EMBED_IMAGE_BATCH_MAX_ITEMS).nullable(),
};
const transactionSchema = embedTransactionSchema(batchRollbackEvidence);
export const embedBatchResultSchema = z.union([
    z.strictObject({ operation: z.literal('embed_image'), applied: z.literal(false), document: documentContextSchema, plan: embedBatchPlanSchema, transaction: transactionSchema }),
    z.strictObject({ operation: z.literal('embed_image'), applied: z.literal(true), document: documentContextSchema, plan: embedBatchPlanSchema, postcondition: postconditionSchema, transaction: transactionSchema }),
]).superRefine((result, context) => {
    const { plan, transaction } = result;
    if (transaction.state !== 'planned' && (plan.applyBlockedReasonCodes.length !== 0 || !plan.applyAllowed || plan.after === null)) {
        context.addIssue({ code: 'custom', message: 'An embed mutation must derive from an allowed, admitted plan.' });
    }
    if (transaction.state === 'planned' && plan.confirmationStatus !== 'required')
        context.addIssue({ code: 'custom', message: 'A planned embed must require confirmation.' });
    if (result.applied) {
        const { postcondition } = result;
        if (transaction.state !== 'verified' || plan.after === null || postcondition.items.length !== plan.before.items.length) {
            context.addIssue({ code: 'custom', message: 'An applied embed requires a verified raster for every planned target.' });
        }
        else {
            const newUuids = new Set();
            postcondition.items.forEach(({ raster }, index) => {
                const before = plan.before.items[index];
                if (raster.uuid === null || raster.uuid === before.uuid || newUuids.has(raster.uuid) || !embedBatchAfterItemWithinTolerance(raster, plan.after.items[index])) {
                    context.addIssue({ code: 'custom', message: `An applied embed requires a verified raster with a new UUID matching the planned after state (item ${index + 1}).` });
                }
                else
                    newUuids.add(raster.uuid);
            });
            const expectedLayers = plan.before.layers.map((layer) => layer.order.map((uuid, slot) => {
                const target = plan.before.items.findIndex((item) => pathKey(item.layerPath) === pathKey(layer.layerPath) && item.layerIndex === slot);
                return target < 0 ? uuid : postcondition.items[target].raster.uuid;
            }));
            if (postcondition.layers.length !== plan.before.layers.length ||
                postcondition.layers.some((layer, index) => pathKey(layer.layerPath) !== pathKey(plan.before.layers[index].layerPath) || !same(layer.order, expectedLayers[index]))) {
                context.addIssue({ code: 'custom', message: 'The embedded layer orders must equal the before orders with each target replaced by its raster.' });
            }
        }
    }
    else if (transaction.state === 'verified')
        context.addIssue({ code: 'custom', message: 'A verified embed must be applied.' });
    if ('rollback' in transaction && 'targetUuids' in transaction.rollback) {
        const rollback = transaction.rollback;
        if (!same(rollback.targetUuids, plan.before.items.map((item) => item.uuid)) || rollback.afterUuids.length !== rollback.targetUuids.length) {
            context.addIssue({ code: 'custom', message: 'Embed rollback evidence must list the planned targets in order.' });
        }
        if (rollback.embeddedCount > rollback.targetUuids.length)
            context.addIssue({ code: 'custom', message: 'Embed rollback evidence counts more embeds than targets.' });
    }
    if (transaction.state === 'rolled_back') {
        const { rollback } = transaction;
        const snapshots = rollback.unchangedSnapshots;
        if (rollback.embeddedCount !== 0 || snapshots === null || snapshots.length !== plan.before.items.length ||
            snapshots.some((snapshot, index) => !embedBatchBeforeItemWithinTolerance(snapshot, plan.before.items[index]))) {
            context.addIssue({ code: 'custom', message: 'A rolled-back embed must prove every linked item unchanged under its UUID and that no embed() returned.' });
        }
    }
});
export const embedBatchResponseSchema = z.strictObject({
    outcome: embedBatchResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
export function embedBatchBeforeDigest(before) { return canonicalDigest(beforeStateOf(before)); }
export function embedBatchAfterDigest(after) { return canonicalDigest((after === null ? null : afterStateOf(after))); }
export function embedBatchChangeSetHash(result) {
    const { plan } = result;
    return canonicalDigest({
        targetSetHash: canonicalDigest(plan.before.items.map((item) => item.uuid)),
        targets: plan.before.items.map((item, index) => ({ targetUuid: item.uuid, source: plan.items[index].source })),
        backup: plan.backup, before: beforeStateOf(plan.before), after: plan.after === null ? null : afterStateOf(plan.after),
    });
}
export const EMBED_IMAGE_BATCH_HOST_SCRIPT = `
var EMBED_BATCH_MAX_ITEMS = ${EMBED_IMAGE_BATCH_MAX_ITEMS};
var EMBED_BATCH_MAX_LAYERS = ${EMBED_IMAGE_BATCH_MAX_LAYERS};
var EMBED_BATCH_RECOVERY_MESSAGE = "Embedded images cannot be un-embedded in the same call. The command keeps the Illustrator lock until illustrator_reconcile action=release_unverified releases it; the document file is unchanged and equals the backup, so the before state is restored by closing the document without saving and reopening its file. Do not save the document.";

function embedBatchValidateRequest() {
  var items = params.items;
  if (!items || typeof items.length !== "number" || items.length < 1 || items.length > EMBED_BATCH_MAX_ITEMS) throw mutationError("preflight_failed", "Batch embedding takes 1 to " + EMBED_BATCH_MAX_ITEMS + " items.");
  if (!params.backup || typeof params.backup.sourcePath !== "string" || typeof params.backup.sourceFileRevision !== "string") {
    throw mutationError("preflight_failed", "The backup was not admitted; call through the MCP server.");
  }
  var seen = {};
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var label = "Item " + (i + 1) + ": ";
    if (!item || typeof item.targetUuid !== "string" || item.targetUuid.length === 0) throw mutationError("preflight_failed", label + "a target UUID is required.");
    if (Object.prototype.hasOwnProperty.call(seen, item.targetUuid)) throw mutationError("preflight_failed", label + "the target UUID is listed twice.");
    seen[item.targetUuid] = true;
    var source = item.source;
    if (!source || typeof source.path !== "string" || source.path.charAt(0) !== "/" || typeof source.sha256 !== "string" || source.sha256.length !== 64) {
      throw mutationError("preflight_failed", label + "source path and SHA-256 are required.");
    }
    var admission = item.sourceAdmission;
    if (!admission || (admission.status !== "admitted" && admission.status !== "blocked") || !item.sourceColorSpace) {
      throw mutationError("preflight_failed", label + "source admission is missing; the request did not pass Node-side file admission.");
    }
    if (admission.status === "admitted" && (typeof admission.resolvedPath !== "string" || admission.resolvedPath.charAt(0) !== "/" || admission.sha256 !== source.sha256)) {
      throw mutationError("preflight_failed", label + "source admission facts are inconsistent with the request.");
    }
  }
}

/** The direct children of a layer, each read once: its UUID and its own type. */
function embedBatchRows(layer, code) {
  var pageItems = layer.pageItems;
  if (!pageItems || typeof pageItems.length !== "number" || pageItems.length > EMBED_IMAGE_MAX_DIRECT_ITEMS) throw mutationError(code, "Target layer item count is unavailable or over the supported bound.");
  var rows = [];
  for (var i = 0; i < pageItems.length; i++) {
    var child = pageItems[i];
    var uuid = child.uuid;
    if (typeof uuid !== "string" || uuid.length === 0) throw mutationError(code, "A native UUID in the target layer is unavailable.");
    rows.push({ item: child, uuid: uuid, typename: String(child.typename) });
  }
  return rows;
}

function embedBatchOrder(rows) {
  var order = [];
  for (var i = 0; i < rows.length; i++) order.push(rows[i].uuid);
  return order;
}

/** One entry per distinct target layer (keyed by its path), read once: the state and every direct child. */
function embedBatchLayerEntry(document, state, layer) {
  var path = embedLayerPath(document, layer);
  if (path === null) throw mutationError("preflight_failed", "Target layer path is unavailable.");
  var key = path.join("/");
  for (var i = 0; i < state.layers.length; i++) if (state.layers[i].key === key) return state.layers[i];
  if (state.layers.length >= EMBED_BATCH_MAX_LAYERS) throw mutationError("preflight_failed", "Batch embedding supports at most " + EMBED_BATCH_MAX_LAYERS + " layers per call.");
  if (typeof layer.visible !== "boolean" || typeof layer.locked !== "boolean") throw mutationError("preflight_failed", "Target safety state is unavailable.");
  var rows = embedBatchRows(layer, "preflight_failed");
  var index = {};
  for (var r = 0; r < rows.length; r++) index[rows[r].uuid] = r;
  var entry = { key: key, layer: layer, path: path, visible: layer.visible, locked: layer.locked, rows: rows, index: index, order: embedBatchOrder(rows) };
  state.layers.push(entry);
  return entry;
}

/** The layer holding a UUID, by the native lookup's parent (its type answer is not trusted, #576); null when it does not answer. */
function embedBatchParentLayer(document, uuid) {
  var found = null;
  try { found = document.getPageItemFromUuid(uuid); } catch (lookupError) { found = null; }
  if (found === null || found === undefined) return null;
  try {
    if (String(found.uuid) !== uuid) return null;
    var parent = found.parent;
    return parent && String(parent.typename) === "Layer" ? parent : null;
  } catch (readError) { return null; }
}

function embedBatchLocate(document, state, uuid, index) {
  var label = "Item " + (index + 1) + ": ";
  var layer = embedBatchParentLayer(document, uuid);
  if (layer !== null) {
    var entry = embedBatchLayerEntry(document, state, layer);
    if (Object.prototype.hasOwnProperty.call(entry.index, uuid)) {
      var row = entry.rows[entry.index[uuid]];
      if (row.typename === "PlacedItem") return { entry: entry, slot: entry.index[uuid], row: row };
      if (row.typename === "RasterItem") throw new Error("MCP_ERROR:" + stringifyJson({ code: "EMBED_TARGET_NOT_LINKED", uuid: uuid }));
      throw mutationError("preflight_failed", label + "embedding supports linked PlacedItem targets only.");
    }
  }
  // The fast route did not place it in a layer row: the shared resolver proves absence, or finds an item that is not layer-direct.
  var resolved = resolvePageItem(document, uuid);
  if (resolved === null) throw new Error("MCP_ERROR:" + stringifyJson({ code: "OBJECT_NOT_FOUND", uuid: uuid }));
  if (resolved.typename === "RasterItem") throw new Error("MCP_ERROR:" + stringifyJson({ code: "EMBED_TARGET_NOT_LINKED", uuid: uuid }));
  if (resolved.typename !== "PlacedItem") throw mutationError("preflight_failed", label + "embedding supports linked PlacedItem targets only.");
  throw mutationError("preflight_failed", label + "embedding supports layer-direct items only; the target is inside a " + String(resolved.item.parent && resolved.item.parent.typename) + ".");
}

function embedBatchBeforeItem(target, layerState, slot) {
  if (typeof target.locked !== "boolean" || typeof target.hidden !== "boolean") throw mutationError("preflight_failed", "Target safety state is unavailable.");
  var ancestors = mutationAncestorState(target);
  var position = target.position, bounds = target.geometricBounds, matrix = target.matrix;
  if (!position || position.length !== 2 || !bounds || bounds.length !== 4) throw mutationError("preflight_failed", "Target geometry is unavailable.");
  if (!matrix) throw mutationError("preflight_failed", "Target matrix is unavailable.");
  var linkPath = null;
  try { linkPath = String(target.file.fsName); } catch (fileError) { linkPath = null; }
  return {
    uuid: String(target.uuid), type: "PlacedItem", layerPath: layerState.path, layerIndex: slot, name: String(target.name || ""),
    position: [embedRound(position[0]), embedRound(position[1])],
    geometricBounds: [embedRound(bounds[0]), embedRound(bounds[1]), embedRound(bounds[2]), embedRound(bounds[3])],
    locked: target.locked, hidden: target.hidden, layerVisible: layerState.visible, layerLocked: layerState.locked,
    ancestorLocked: ancestors.ancestorLocked, ancestorHidden: ancestors.ancestorHidden,
    linkPath: linkPath, width: embedRound(target.width), height: embedRound(target.height),
    matrix: [embedRound(matrix.mValueA), embedRound(matrix.mValueB), embedRound(matrix.mValueC), embedRound(matrix.mValueD), embedRound(matrix.mValueTX), embedRound(matrix.mValueTY)]
  };
}

function embedBatchRasterItem(raster, layerState, slot) {
  if (typeof raster.locked !== "boolean" || typeof raster.hidden !== "boolean") throw mutationError("verify_mismatch", "The embedded raster's safety state is unavailable.");
  var ancestors = mutationAncestorState(raster);
  var position = raster.position, bounds = raster.geometricBounds, box = raster.boundingBox;
  if (!position || position.length !== 2 || !bounds || bounds.length !== 4 || !box || box.length !== 4) throw mutationError("verify_mismatch", "The embedded raster's geometry is unavailable.");
  return {
    uuid: String(raster.uuid), type: "RasterItem", layerPath: layerState.path, layerIndex: slot, name: String(raster.name || ""),
    position: [embedRound(position[0]), embedRound(position[1])],
    geometricBounds: [embedRound(bounds[0]), embedRound(bounds[1]), embedRound(bounds[2]), embedRound(bounds[3])],
    locked: raster.locked, hidden: raster.hidden, layerVisible: layerState.visible, layerLocked: layerState.locked,
    ancestorLocked: ancestors.ancestorLocked, ancestorHidden: ancestors.ancestorHidden,
    embedded: raster.embedded === true,
    pixels: { width: Math.round(Math.abs(Number(box[2]) - Number(box[0]))), height: Math.round(Math.abs(Number(box[1]) - Number(box[3]))) }
  };
}

function embedBatchBeforeMatches(left, right) {
  if (!left || !right || left.type !== right.type || !mutationSameSequence(left.layerPath, right.layerPath) || left.layerIndex !== right.layerIndex ||
      left.name !== right.name || left.linkPath !== right.linkPath ||
      left.locked !== right.locked || left.hidden !== right.hidden || left.layerVisible !== right.layerVisible || left.layerLocked !== right.layerLocked ||
      left.ancestorLocked !== right.ancestorLocked || left.ancestorHidden !== right.ancestorHidden) return false;
  for (var p = 0; p < 2; p++) if (!embedNear(left.position[p], right.position[p])) return false;
  for (var b = 0; b < 4; b++) if (!embedNear(left.geometricBounds[b], right.geometricBounds[b])) return false;
  if (!embedNear(left.width, right.width) || !embedNear(left.height, right.height)) return false;
  for (var m = 0; m < 6; m++) if (!embedNear(left.matrix[m], right.matrix[m])) return false;
  return true;
}

function embedBatchAfterMatches(left, right) {
  if (!left || !right || left.type !== right.type || !mutationSameSequence(left.layerPath, right.layerPath) || left.layerIndex !== right.layerIndex ||
      left.name !== right.name || left.embedded !== right.embedded ||
      !left.pixels || !right.pixels || left.pixels.width !== right.pixels.width || left.pixels.height !== right.pixels.height ||
      left.locked !== right.locked || left.hidden !== right.hidden || left.layerVisible !== right.layerVisible || left.layerLocked !== right.layerLocked ||
      left.ancestorLocked !== right.ancestorLocked || left.ancestorHidden !== right.ancestorHidden) return false;
  for (var p = 0; p < 2; p++) if (!embedNear(left.position[p], right.position[p])) return false;
  for (var b = 0; b < 4; b++) if (!embedNear(left.geometricBounds[b], right.geometricBounds[b])) return false;
  return true;
}

function embedBatchPlannedAfter(before, items) {
  var afterItems = [];
  var slotKeys = {};
  for (var i = 0; i < before.items.length; i++) {
    var admission = items[i].sourceAdmission;
    if (admission.status !== "admitted" || !admission.pixels) return null;
    var b = before.items[i];
    slotKeys[b.layerPath.join("/") + "#" + b.layerIndex] = true;
    afterItems.push({
      uuid: null, type: "RasterItem", layerPath: b.layerPath, layerIndex: b.layerIndex, name: b.name, position: b.position, geometricBounds: b.geometricBounds,
      locked: b.locked, hidden: b.hidden, layerVisible: b.layerVisible, layerLocked: b.layerLocked, ancestorLocked: b.ancestorLocked, ancestorHidden: b.ancestorHidden,
      embedded: true, pixels: { width: admission.pixels.width, height: admission.pixels.height }
    });
  }
  var layers = [];
  for (var l = 0; l < before.layers.length; l++) {
    var order = [];
    for (var s = 0; s < before.layers[l].order.length; s++) order.push(Object.prototype.hasOwnProperty.call(slotKeys, before.layers[l].layerPath.join("/") + "#" + s) ? null : before.layers[l].order[s]);
    layers.push({ layerPath: before.layers[l].layerPath, order: order });
  }
  return { items: afterItems, layers: layers };
}

function embedBatchAdd(list, code) { if (!embedContains(list, code)) list.push(code); }

function embedBatchResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  embedBatchValidateRequest();
  var state = { layers: [] };
  var located = [];
  for (var i = 0; i < params.items.length; i++) located.push(embedBatchLocate(document, state, params.items[i].targetUuid, i));
  var documentBlockers = [];
  if (!context.mutationAllowed) embedBatchAdd(documentBlockers, "document_not_saved");
  if (context.path !== params.backup.sourcePath) embedBatchAdd(documentBlockers, "backup_mismatch");
  else if (context.fileRevision !== params.backup.sourceFileRevision) embedBatchAdd(documentBlockers, "backup_stale");
  if (!hostVersionAdmitted("embed_image", String(app.version))) embedBatchAdd(documentBlockers, "host_version_unmeasured");
  if (context.colorSpace !== "RGB") embedBatchAdd(documentBlockers, "document_color_space_unmeasured");
  if (params.resultTooLarge === true) embedBatchAdd(documentBlockers, "result_too_large");
  var beforeItems = [], itemBlockers = [], all = documentBlockers.slice(0);
  for (var k = 0; k < located.length; k++) {
    var request = params.items[k];
    var before = embedBatchBeforeItem(located[k].row.item, located[k].entry, located[k].slot);
    var codes = [];
    if (before.locked) embedBatchAdd(codes, "target_locked");
    if (before.hidden) embedBatchAdd(codes, "target_hidden");
    if (!before.layerVisible) embedBatchAdd(codes, "layer_hidden");
    if (before.layerLocked) embedBatchAdd(codes, "layer_locked");
    if (before.ancestorHidden) embedBatchAdd(codes, "ancestor_hidden");
    if (before.ancestorLocked) embedBatchAdd(codes, "ancestor_locked");
    if (before.linkPath === null || !(new File(before.linkPath)).exists) embedBatchAdd(codes, "link_missing");
    // A broken link (file throws) reads as a placeholder path, which no admitted source equals.
    if (before.linkPath === null) before.linkPath = "/unavailable";
    var admission = request.sourceAdmission;
    if (admission.status === "blocked") embedBatchAdd(codes, admission.reason);
    else {
      if (admission.resolvedPath !== before.linkPath) embedBatchAdd(codes, "link_path_mismatch");
      if (!admission.pixels) embedBatchAdd(codes, "source_pixels_unknown");
      if (request.sourceColorSpace.status !== "available" || !embedContains(EMBED_IMAGE_MEASURED_COLOR_SPACES, request.sourceColorSpace.value)) embedBatchAdd(codes, "source_color_space_unmeasured");
      var changed = embedFileChanged(admission.resolvedPath, admission.bytes, request.sourceModifiedAtMs);
      if (changed === "missing") embedBatchAdd(codes, "source_file_missing");
      else if (changed === "changed") embedBatchAdd(codes, "source_file_changed");
    }
    beforeItems.push(before);
    if (codes.length > 0) {
      itemBlockers.push({ index: k, targetUuid: before.uuid, codes: codes });
      for (var c = 0; c < codes.length; c++) embedBatchAdd(all, codes[c]);
    }
  }
  var layers = [];
  for (var e = 0; e < state.layers.length; e++) layers.push({ layerPath: state.layers[e].path, order: state.layers[e].order });
  var beforeSnapshot = { items: beforeItems, layers: layers };
  if (forApply && all.length > 0) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "EMBED_IMAGE_APPLY_BLOCKED", reasonCodes: all, items: itemBlockers }));
  }
  return { context: context, document: document, state: state, located: located, before: beforeSnapshot, after: embedBatchPlannedAfter(beforeSnapshot, params.items), blockers: all, itemBlockers: itemBlockers };
}

function embedBatchSameLayers(left, right) {
  if (left.length !== right.length) return false;
  for (var i = 0; i < left.length; i++) {
    if (!mutationSameSequence(left[i].layerPath, right[i].layerPath) || !mutationSameSequence(left[i].order, right[i].order)) return false;
  }
  return true;
}

function embedBatchPreflight(forApply) {
  var resolved = embedBatchResolve(forApply);
  if (forApply) {
    var expected = params.expectedBefore, confirmed = params.confirmedAfter;
    if (!expected || expected.items.length !== resolved.before.items.length || !embedBatchSameLayers(expected.layers, resolved.before.layers)) throw mutationError("preflight_failed", "Target state does not match expected_before.");
    for (var i = 0; i < resolved.before.items.length; i++) {
      if (String(expected.items[i].uuid) !== resolved.before.items[i].uuid || !embedBatchBeforeMatches(resolved.before.items[i], expected.items[i])) throw mutationError("preflight_failed", "Target " + (i + 1) + " does not match expected_before.");
    }
    if (!confirmed || resolved.after === null || confirmed.items.length !== resolved.after.items.length || !embedBatchSameLayers(confirmed.layers, resolved.after.layers)) throw mutationError("preflight_failed", "confirmed_after does not match the planned embed state.");
    for (var j = 0; j < resolved.after.items.length; j++) {
      if (confirmed.items[j].uuid !== null || !embedBatchAfterMatches(resolved.after.items[j], confirmed.items[j])) throw mutationError("preflight_failed", "confirmed_after does not match the planned embed state of item " + (j + 1) + ".");
    }
  }
  return resolved;
}

function embedBatchPlan(preflight) {
  var items = [];
  for (var i = 0; i < params.items.length; i++) items.push({ source: { path: params.items[i].source.path, sha256: params.items[i].source.sha256 }, sourceAdmission: params.items[i].sourceAdmission, sourceColorSpace: params.items[i].sourceColorSpace });
  return {
    operation: "embed_image", documentKey: preflight.context.key, backup: params.backup, items: items,
    before: preflight.before, after: preflight.after, applyBlockedReasonCodes: preflight.blockers, itemBlockers: preflight.itemBlockers,
    confirmationStatus: params.apply === true ? "confirmed" : "required",
    applyAllowed: params.apply === true && preflight.blockers.length === 0
  };
}

/** Immediately before the first embed: the document, every layer's order and type, and every linked file as planned. Nothing is written. */
function embedBatchRevalidate(preflight, plan) {
  try {
    var context = requireDocument(params.expectedDocumentKey);
    if (app.documents.length === 0 || app.activeDocument !== preflight.document) throw new Error("The active document changed.");
    if (context.fileRevision !== params.backup.sourceFileRevision || context.path !== params.backup.sourcePath) throw new Error("The document no longer equals the backed-up file.");
    for (var l = 0; l < preflight.state.layers.length; l++) {
      var entry = preflight.state.layers[l];
      var rows = embedBatchRows(entry.layer, "preflight_failed");
      if (!mutationSameSequence(embedBatchOrder(rows), plan.before.layers[l].order)) throw new Error("A target layer's items changed.");
      for (var t = 0; t < plan.before.items.length; t++) {
        var item = plan.before.items[t];
        if (item.layerPath.join("/") === entry.key && rows[item.layerIndex].typename !== "PlacedItem") throw new Error("A target is no longer a linked item.");
      }
    }
    for (var k = 0; k < params.items.length; k++) {
      var admission = params.items[k].sourceAdmission;
      if (embedFileChanged(admission.resolvedPath, admission.bytes, params.items[k].sourceModifiedAtMs) !== null) throw new Error("A linked file changed.");
    }
  } catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Embed preconditions changed before apply.")); }
}

/** A fresh read of one slot of a layer. A reference held from before an embed is never reused (#971). */
function embedBatchSlot(layer, index, code) {
  var pageItems = layer.pageItems;
  if (!pageItems || typeof pageItems.length !== "number" || pageItems.length <= index) throw mutationError(code, "A target layer lost an item.");
  var child = pageItems[index];
  return { item: child, uuid: String(child.uuid), typename: String(child.typename) };
}

function embedBatchApply(preflight, plan, state) {
  var op = state.operationState;
  var previousInteractionLevel = app.userInteractionLevel;
  try {
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    op.embedCalled = true;
    for (var k = 0; k < plan.before.items.length; k++) {
      var before = plan.before.items[k];
      var label = "Item " + (k + 1) + ": ";
      var layer = preflight.located[k].entry.layer;
      var slot = embedBatchSlot(layer, before.layerIndex, "apply_failed");
      if (slot.uuid !== before.uuid || slot.typename !== "PlacedItem") throw mutationError("apply_failed", label + "the target changed before it was embedded.");
      var admission = params.items[k].sourceAdmission;
      if (embedFileChanged(admission.resolvedPath, admission.bytes, params.items[k].sourceModifiedAtMs) !== null) throw mutationError("apply_failed", label + "the linked file changed before it was embedded.");
      try { slot.item.embed(); }
      catch (embedError) { throw mutationError("apply_failed", label + "Illustrator refused to embed the image: " + mutationPublicMessage(embedError, String(embedError && embedError.message))); }
      // The embedded item's reference is invalid from here on: only fresh reads of the slot follow.
      op.embeddedCount = k + 1;
      var raster = embedBatchSlot(layer, before.layerIndex, "apply_failed");
      if (raster.typename !== "RasterItem" || raster.uuid.length === 0 || raster.uuid === before.uuid) throw mutationError("apply_failed", label + "no new RasterItem took the embedded item's place in its layer.");
      op.afterUuids[k] = raster.uuid;
      if (String(raster.item.name || "") !== before.name) { raster.item.name = before.name; op.nameRestored[k] = true; }
    }
  } finally {
    app.userInteractionLevel = previousInteractionLevel;
  }
  return null;
}

function embedBatchVerify(preflight, plan, state) {
  var document = preflight.document;
  var op = state.operationState;
  if (app.documents.length === 0 || app.activeDocument !== document) throw mutationError("verify_mismatch", "Active document changed during embed verification.");
  var count = plan.before.items.length;
  if (op.embeddedCount !== count) throw mutationError("verify_mismatch", "Not every embed() returned.");
  var rastersByItem = [], layersAfter = [];
  var seen = {};
  for (var l = 0; l < plan.before.layers.length; l++) {
    var entry = preflight.state.layers[l];
    var expectedOrder = plan.before.layers[l].order;
    var rows = embedBatchRows(entry.layer, "verify_mismatch");
    if (rows.length !== expectedOrder.length) throw mutationError("verify_mismatch", "A target layer's item count changed.");
    var targetAt = {};
    for (var t = 0; t < count; t++) if (plan.before.items[t].layerPath.join("/") === entry.key) targetAt[plan.before.items[t].layerIndex] = t;
    for (var s = 0; s < rows.length; s++) {
      if (Object.prototype.hasOwnProperty.call(targetAt, s)) {
        var target = targetAt[s];
        if (rows[s].typename !== "RasterItem" || rows[s].uuid !== op.afterUuids[target] || rows[s].uuid === plan.before.items[target].uuid || embedContains(expectedOrder, rows[s].uuid) || Object.prototype.hasOwnProperty.call(seen, rows[s].uuid)) {
          throw mutationError("verify_mismatch", "Item " + (target + 1) + " is not the new RasterItem in its slot.");
        }
        seen[rows[s].uuid] = true;
        rastersByItem[target] = { row: rows[s], entry: entry, slot: s };
      } else if (rows[s].uuid !== expectedOrder[s]) {
        throw mutationError("verify_mismatch", "A sibling of the embedded items moved or changed.");
      }
    }
    layersAfter.push({ layerPath: entry.path, order: embedBatchOrder(rows) });
  }
  var items = [];
  for (var k = 0; k < count; k++) {
    var found = rastersByItem[k];
    var snapshot = embedBatchRasterItem(found.row.item, found.entry, found.slot);
    if (!embedBatchAfterMatches(snapshot, plan.after.items[k])) throw mutationError("verify_mismatch", "The embedded raster " + (k + 1) + " does not match the planned after state.");
    var raster = found.row.item;
    var matrix = raster.matrix, box = raster.boundingBox;
    items.push({ raster: snapshot, evidence: {
      matrix: [embedRound(matrix.mValueA), embedRound(matrix.mValueB), embedRound(matrix.mValueC), embedRound(matrix.mValueD), embedRound(matrix.mValueTX), embedRound(matrix.mValueTY)],
      boundingBox: [embedRound(box[0]), embedRound(box[1]), embedRound(box[2]), embedRound(box[3])],
      imageColorSpace: String(raster.imageColorSpace), bitsPerChannel: Number(raster.bitsPerChannel), channels: Number(raster.channels),
      nameRestored: op.nameRestored[k] === true
    } });
  }
  return { items: items, layers: layersAfter, saved: document.saved === true };
}

/** Only a run in which no embed() returned can be proven harmless: every target is read again from fresh slot reads and must be as planned. */
function embedBatchRollback(state) {
  var op = state.operationState, preflight = state.preflight;
  if (op.embeddedCount > 0) return { status: "indeterminate", message: EMBED_BATCH_RECOVERY_MESSAGE };
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) return { status: "indeterminate", message: "Rollback document identity is indeterminate. " + EMBED_BATCH_RECOVERY_MESSAGE };
  var plan = state.plan;
  var snapshots = [];
  try {
    var rowsByLayer = [];
    for (var l = 0; l < preflight.state.layers.length; l++) {
      var entry = preflight.state.layers[l];
      var rows = embedBatchRows(entry.layer, "preflight_failed");
      if (!mutationSameSequence(embedBatchOrder(rows), plan.before.layers[l].order)) return { status: "indeterminate", message: "A target layer changed although embed() failed. " + EMBED_BATCH_RECOVERY_MESSAGE };
      rowsByLayer.push(rows);
    }
    for (var k = 0; k < plan.before.items.length; k++) {
      var item = plan.before.items[k];
      var layerIndex = 0;
      for (var m = 0; m < preflight.state.layers.length; m++) if (preflight.state.layers[m].key === item.layerPath.join("/")) layerIndex = m;
      var row = rowsByLayer[layerIndex][item.layerIndex];
      if (row.typename !== "PlacedItem" || row.uuid !== item.uuid) return { status: "indeterminate", message: "A linked item no longer resolves under its UUID. " + EMBED_BATCH_RECOVERY_MESSAGE };
      var layerState = { path: item.layerPath, visible: preflight.state.layers[layerIndex].layer.visible, locked: preflight.state.layers[layerIndex].layer.locked };
      var current = embedBatchBeforeItem(row.item, layerState, item.layerIndex);
      if (!embedBatchBeforeMatches(current, item)) return { status: "indeterminate", message: "A linked item changed although embed() failed. " + EMBED_BATCH_RECOVERY_MESSAGE };
      snapshots.push(current);
    }
  } catch (error) { return { status: "indeterminate", message: "Rollback target state is indeterminate. " + EMBED_BATCH_RECOVERY_MESSAGE }; }
  op.rollbackEvidence.unchangedSnapshots = snapshots;
  return { status: "verified" };
}

function embedBatchEvidence(op) {
  var uuids = [];
  for (var i = 0; i < params.items.length; i++) uuids.push(params.items[i].targetUuid);
  return {
    targetUuids: uuids, afterUuids: op.afterUuids, embeddedCount: op.embeddedCount,
    failedIndex: op.embeddedCount < uuids.length ? op.embeddedCount : null, unchangedSnapshots: null
  };
}

/** The transaction definition of a batch; the one runMutationTransaction call of the script runs it (like every adapter script, exactly one call site). */
function embedBatchDefinition() {
  return {
    apply: params.apply === true,
    initialOperationState: function () {
      var afterUuids = [], nameRestored = [];
      for (var i = 0; i < params.items.length; i++) { afterUuids.push(null); nameRestored.push(false); }
      return { embedCalled: false, embeddedCount: 0, afterUuids: afterUuids, nameRestored: nameRestored, rollbackEvidence: null };
    },
    preflight: embedBatchPreflight,
    plan: embedBatchPlan,
    revalidate: embedBatchRevalidate,
    applyMutation: embedBatchApply,
    verify: embedBatchVerify,
    rollback: embedBatchRollback,
    hasMutationEvidence: function (state) { return state.operationState.embedCalled === true; },
    applyIndeterminate: function (state) {
      return { reasonCode: "embed_outcome_unknown", message: "Embed apply outcome is indeterminate. " + EMBED_BATCH_RECOVERY_MESSAGE, evidence: embedBatchEvidence(state.operationState) };
    },
    rollbackEvidence: function (state) {
      var op = state.operationState;
      var unchanged = op.rollbackEvidence === null ? null : op.rollbackEvidence.unchangedSnapshots;
      op.rollbackEvidence = embedBatchEvidence(op);
      op.rollbackEvidence.unchangedSnapshots = unchanged;
      return op.rollbackEvidence;
    }
  };
}
`;
