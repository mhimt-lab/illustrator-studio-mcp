import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, rmdir, unlink } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from './command-id.js';
import { BackupCopyError, BackupPreconditionError, copyErrorCreatedDestination, copyFileExclusive, hostDocumentIdentitySchema, inspectSourceFile, resolveBackupRoot, sameFileIdentity, serializeFileIdentity, verifyTrackedFile, withBackupRootScope, } from './document-backup.js';
import { assertOutputAbsent, EXPORT_CLOSE_WORK_COPY_SCRIPT, EXPORT_HELPERS, EXPORT_HOST_TIMEOUT_MS, EXPORT_INVENTORY_SCRIPT, EXPORT_OPEN_PRE_ATTEMPT_CODES, EXPORT_OPEN_WORK_COPY_SCRIPT, ExportPreconditionError, parseExportHostError, STAGING_DIRECTORY_PREFIX, createOnceLinkAllowance, validateOutputLocation, withOutputParentScope, workCopyFileName, } from './document-export.js';
import { documentKeyMatches } from './document-key.js';
import { IndeterminateExecutionError } from './domain.js';
import { canonicalSha256 } from './mutation-canonical.js';
import { documentContextSchema } from './mutation-result-schema-core.js';
import { atomicCreatePrivateRecord, atomicReplacePrivateRecord, readSecurePrivateRecord } from './private-record.js';
import { temporaryTwinPattern } from './state-quarantine.js';
import { assessRasterRecordSet, RASTER_EXPORT_KIND, RASTER_EXPORT_RECORD_SUFFIXES, RASTER_EXPORT_RECORD_VERSION, rasterExportArtifactSchema, rasterExportOptionsSchema, } from './raster-export-records.js';
export const RASTER_EXPORT_TOOL = 'illustrator_export';
export const RASTER_EXPORT_PROFILE = 'raster_export_v1';
export const RASTER_MAX_SIDE_PX = 4000;
export const RASTER_MAX_TOTAL_PX = 12_000_000;
export const RASTER_MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
export const WEB_RGB_PIXEL_CONTRACT = ({ options, artboard }) => {
    const unsupported = (reason, message) => ({ status: 'unsupported', reason, message });
    const [left, top, right, bottom] = artboard.rect;
    if (!artboard.rect.every((edge) => Number.isInteger(edge))) {
        return unsupported('fractional_artboard_edge', 'The artboard has a non-integer edge in points; only integer-pt artboards have a measured pixel size.');
    }
    if (artboard.origin[0] !== 0 || artboard.origin[1] !== 0) {
        return unsupported('artboard_ruler_origin_unmeasured', 'The artboard has its own ruler origin; only [0,0] is measured.');
    }
    if (options.format === 'png' && !options.transparent && options.scale === 2) {
        return unsupported('opaque_png_2x_unmeasured', 'An opaque PNG at 2x is not measured; export it at 1x or with transparency.');
    }
    const width = (right - left) * options.scale;
    const height = (top - bottom) * options.scale;
    if (!(width > 0 && height > 0))
        return unsupported('empty_artboard', 'The artboard has no area.');
    if (width > RASTER_MAX_SIDE_PX || height > RASTER_MAX_SIDE_PX || width * height > RASTER_MAX_TOTAL_PX) {
        return unsupported('large_board_unmeasured', `The export would be ${width}x${height} px; only up to ${RASTER_MAX_SIDE_PX} px per side and ${RASTER_MAX_TOTAL_PX} px in total are measured.`);
    }
    return { status: 'supported', width, height };
};
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
export const rasterExportInputSchema = z.strictObject({
    expected_document_key: z.string().min(1).max(16_384),
    format: z.enum(['png', 'jpeg']),
    output_path: z.string().min(1).max(4_096).describe('Absolute path of a new file (.png, or .jpg/.jpeg) in an existing folder; it must not exist.'),
    artboard_index: z.number().int().nonnegative().describe('0-based index of the one artboard to export (it need not be active).'),
    scale: z.union([z.literal(1), z.literal(2)]).optional().describe('1 (default) or 2: 1 pt becomes 1 or 2 px.'),
    transparent: z.boolean().optional().describe('PNG only; default true. false gives a white background (1x only).'),
    quality: z.number().int().min(0).max(100).optional().describe('JPEG only; default 80.'),
    apply: z.boolean().default(false),
    command_id: applyCommandIdSchema.optional(),
    confirm_export_hash: sha256Schema.optional().describe('The plan\'s planDigest, as in its nextCall arguments.'),
}).superRefine((input, context) => {
    if (input.format !== 'png' && input.transparent !== undefined)
        context.addIssue({ code: 'custom', path: ['transparent'], message: 'transparent applies to format "png" only.' });
    if (input.format !== 'jpeg' && input.quality !== undefined)
        context.addIssue({ code: 'custom', path: ['quality'], message: 'quality applies to format "jpeg" only.' });
    if (input.apply && (input.command_id === undefined || input.confirm_export_hash === undefined)) {
        context.addIssue({ code: 'custom', path: ['command_id'], message: 'apply=true needs command_id and confirm_export_hash from the plan\'s next_call.' });
    }
    if (!input.apply && (input.command_id !== undefined || input.confirm_export_hash !== undefined)) {
        context.addIssue({ code: 'custom', path: ['apply'], message: 'command_id and confirm_export_hash are for apply=true only.' });
    }
});
export function rasterOptionsOf(input) {
    const scale = input.scale ?? 1;
    return input.format === 'png'
        ? { format: 'png', scale, transparent: input.transparent ?? true }
        : { format: 'jpeg', scale, quality: input.quality ?? 80 };
}
const artboardSchema = z.strictObject({
    index: z.number().int().nonnegative(),
    name: z.string(),
    rect: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    origin: z.tuple([z.number(), z.number()]),
});
export const rasterExportRejectionSchema = z.enum([
    'document_key_mismatch', 'document_not_admitted', 'document_dirty', 'document_not_saved', 'color_space_not_admitted',
    'artwork_not_admitted', 'edit_session_open', 'edit_session_invalid', 'artboard_out_of_range', 'source_file_unavailable',
    'export_root_unavailable', 'output_path_invalid', 'output_exists', 'output_cross_device', 'plan_changed',
    'dimension_contract_unavailable', 'command_id_conflict', 'command_id_in_use', 'export_records_invalid',
    'artifact_unavailable', 'artifact_identity_mismatch',
]);
const contextSchema = documentContextSchema;
const timingSchema = z.strictObject({ totalMs: z.number().nonnegative(), hostCalls: z.number().int().nonnegative(), hostMs: z.number().nonnegative() });
export const rasterExportResultSchema = z.discriminatedUnion('outcome', [
    z.strictObject({
        outcome: z.literal('planned'),
        document: contextSchema,
        artboard: artboardSchema,
        options: rasterExportOptionsSchema,
        outputPath: z.string().min(1),
        expected: z.strictObject({ width: z.number().int().positive(), height: z.number().int().positive() }),
        planDigest: sha256Schema,
        nextCall: z.strictObject({ tool: z.literal(RASTER_EXPORT_TOOL), arguments: z.record(z.string(), z.unknown()) }),
    }),
    z.strictObject({
        outcome: z.literal('blocked'),
        reason: z.string().min(1),
        message: z.string(),
        document: contextSchema,
    }),
    z.strictObject({
        outcome: z.literal('rejected'),
        reason: rasterExportRejectionSchema,
        message: z.string(),
        document: contextSchema.nullable(),
    }),
    z.strictObject({
        outcome: z.literal('verified'),
        exportId: z.uuid(),
        delivery: z.enum(['original', 'replay']),
        artifact: rasterExportArtifactSchema,
        sourcePreserved: z.literal(true),
        cleanup: z.array(z.strictObject({ path: z.string().min(1), removed: z.boolean(), reason: z.string() })),
        timing: timingSchema,
    }),
    z.strictObject({
        outcome: z.literal('failed'),
        exportId: z.uuid(),
        delivery: z.enum(['original', 'replay']),
        stage: z.string().min(1),
        reason: z.string().min(1),
        message: z.string(),
        cleanup: z.array(z.strictObject({ path: z.string().min(1), removed: z.boolean(), reason: z.string() })),
    }),
    z.strictObject({
        outcome: z.literal('indeterminate'),
        exportId: z.uuid(),
        stage: z.string().min(1),
        message: z.string(),
        commandId: z.string().nullable(),
    }),
]);
export const RASTER_READ_SOURCE_SCRIPT = `${EXPORT_HELPERS}
var rasterReadContext = requireDocumentForRead(params.expectedDocumentKey);
var rasterReadDocument = app.activeDocument;
var rasterReadBoards = [];
for (var rasterReadCursor = 0; rasterReadCursor < rasterReadDocument.artboards.length; rasterReadCursor++) {
  var rasterReadBoard = rasterReadDocument.artboards[rasterReadCursor];
  var rasterReadRect = rasterReadBoard.artboardRect;
  var rasterReadOrigin = rasterReadBoard.rulerOrigin;
  rasterReadBoards.push({ index: rasterReadCursor, name: String(rasterReadBoard.name),
    rect: [rasterReadRect[0], rasterReadRect[1], rasterReadRect[2], rasterReadRect[3]], origin: [rasterReadOrigin[0], rasterReadOrigin[1]] });
}
var rasterReadDocumentOrigin = rasterReadDocument.rulerOrigin;
var result = {
  document: rasterReadContext,
  artboards: rasterReadBoards,
  activeArtboardIndex: rasterReadDocument.artboards.getActiveArtboardIndex(),
  rulerOrigin: [rasterReadDocumentOrigin[0], rasterReadDocumentOrigin[1]],
  placedItems: rasterReadDocument.placedItems.length
};
`;
export const RASTER_EXPORT_PRE_ATTEMPT_CODES = [
    'EXPORT_WORK_COPY_NOT_UNIQUE', 'EXPORT_WORK_COPY_IDENTITY_MISMATCH', 'RASTER_WORK_COPY_NOT_ACTIVE', 'RASTER_ARTBOARDS_CHANGED', 'RASTER_STAGE_NOT_EMPTY',
];
export const RASTER_EXPORT_FAILED_CODE = 'RASTER_EXPORT_FAILED';
export const RASTER_EXPORT_SCRIPT = `${EXPORT_HELPERS}
var rasterTarget = exportRequireWorkCopy(params.workCopyPath, params.workCopyKey);
var rasterDocument = rasterTarget.doc;
if (app.activeDocument !== rasterDocument) throw new Error("MCP_ERROR:" + stringifyJson({ code: "RASTER_WORK_COPY_NOT_ACTIVE" }));
var rasterBoardsBefore = exportArtboards(rasterDocument);
var rasterBoardsChanged = rasterBoardsBefore.length !== params.artboards.length;
for (var rasterBoardCursor = 0; !rasterBoardsChanged && rasterBoardCursor < rasterBoardsBefore.length; rasterBoardCursor++) {
  var rasterActual = rasterBoardsBefore[rasterBoardCursor];
  var rasterExpected = params.artboards[rasterBoardCursor];
  if (rasterActual.name !== rasterExpected.name) rasterBoardsChanged = true;
  for (var rasterEdge = 0; rasterEdge < 4; rasterEdge++) if (rasterActual.rect[rasterEdge] !== rasterExpected.rect[rasterEdge]) rasterBoardsChanged = true;
}
if (rasterBoardsChanged) throw new Error("MCP_ERROR:" + stringifyJson({ code: "RASTER_ARTBOARDS_CHANGED", actual: rasterBoardsBefore }));
if (new File(params.basePath).exists || new File(params.stagedPath).exists) throw new Error("MCP_ERROR:" + stringifyJson({ code: "RASTER_STAGE_NOT_EMPTY" }));
var rasterType;
var rasterOptions;
if (params.format === "png") {
  rasterType = ExportType.PNG24;
  rasterOptions = new ExportOptionsPNG24();
  rasterOptions.transparency = params.transparent === true;
} else {
  rasterType = ExportType.JPEG;
  rasterOptions = new ExportOptionsJPEG();
  rasterOptions.qualitySetting = params.quality;
}
rasterOptions.artBoardClipping = true;
rasterOptions.antiAliasing = true;
rasterOptions.horizontalScale = params.scale * 100;
rasterOptions.verticalScale = params.scale * 100;
rasterDocument.artboards.setActiveArtboardIndex(params.artboardIndex);
var rasterPreviousInteraction = app.userInteractionLevel;
app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
try {
  rasterDocument.exportFile(new File(params.basePath), rasterType, rasterOptions);
} catch (rasterExportError) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "RASTER_EXPORT_FAILED", message: String(rasterExportError.message || rasterExportError) }));
} finally {
  app.userInteractionLevel = rasterPreviousInteraction;
}
var rasterIndexAfter = -1;
for (var rasterIndexCursor = 0; rasterIndexCursor < app.documents.length; rasterIndexCursor++) {
  if (app.documents[rasterIndexCursor] === rasterDocument) rasterIndexAfter = rasterIndexCursor;
}
if (rasterIndexAfter < 0) throw new Error("MCP_ERROR:" + stringifyJson({ code: "RASTER_WORK_COPY_NOT_LISTED" }));
var result = {
  workCopy: getDocumentIdentity(rasterDocument, rasterIndexAfter),
  activeArtboardIndex: rasterDocument.artboards.getActiveArtboardIndex(),
  artboards: exportArtboards(rasterDocument),
  documentCount: app.documents.length
};
`;
export const RASTER_RECONCILE_CLOSE_SCRIPT = `${EXPORT_HELPERS}
var rasterReconcileMatches = exportMatchesByPath(params.sessionPaths);
if (rasterReconcileMatches.length !== 1) throw new Error("MCP_ERROR:" + stringifyJson({ code: "RASTER_RECONCILE_NOT_UNIQUE", count: rasterReconcileMatches.length }));
var rasterReconcileEntry = rasterReconcileMatches[0].entry;
var rasterReconcileBoards = exportArtboards(rasterReconcileMatches[0].doc);
var rasterReconcileBoardsDiffer = rasterReconcileBoards.length !== params.expected.artboards.length;
for (var rasterReconcileBoard = 0; !rasterReconcileBoardsDiffer && rasterReconcileBoard < rasterReconcileBoards.length; rasterReconcileBoard++) {
  for (var rasterReconcileEdge = 0; rasterReconcileEdge < 4; rasterReconcileEdge++) {
    if (rasterReconcileBoards[rasterReconcileBoard].rect[rasterReconcileEdge] !== params.expected.artboards[rasterReconcileBoard].rect[rasterReconcileEdge]) rasterReconcileBoardsDiffer = true;
  }
}
if (rasterReconcileEntry.path !== params.expected.path || exportKeyWithoutIndex(rasterReconcileEntry.key) !== exportKeyWithoutIndex(params.expected.key) ||
    rasterReconcileEntry.saved !== params.expected.saved || rasterReconcileBoardsDiffer) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "RASTER_RECONCILE_CLOSE_REFUSED", actual: rasterReconcileEntry }));
}
var rasterReconcileInteraction = app.userInteractionLevel;
app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
try { rasterReconcileMatches[0].doc.close(SaveOptions.DONOTSAVECHANGES); }
finally { app.userInteractionLevel = rasterReconcileInteraction; }
var result = { closed: rasterReconcileEntry, remaining: exportMatchesByPath(params.sessionPaths).length, documentCount: app.documents.length };
`;
export class RasterArtifactError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RasterArtifactError';
    }
}
export function jpegFrame(bytes) {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
        throw new RasterArtifactError('The JPEG has no start-of-image marker.');
    if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9)
        throw new RasterArtifactError('The JPEG is truncated (no end-of-image marker).');
    let offset = 2;
    while (offset + 4 <= bytes.length) {
        if (bytes[offset] !== 0xff)
            throw new RasterArtifactError('The JPEG has a malformed marker.');
        const marker = bytes[offset + 1];
        if (marker === 0xda)
            break;
        const length = bytes.readUInt16BE(offset + 2);
        if (length < 2 || offset + 2 + length > bytes.length)
            throw new RasterArtifactError('The JPEG has a truncated segment.');
        if (marker >= 0xc1 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            throw new RasterArtifactError(`The JPEG frame type 0x${marker.toString(16)} is not the measured baseline.`);
        }
        if (marker === 0xc0) {
            if (length < 8)
                throw new RasterArtifactError('The JPEG frame header is truncated.');
            const height = bytes.readUInt16BE(offset + 5);
            const width = bytes.readUInt16BE(offset + 7);
            if (width <= 0 || height <= 0)
                throw new RasterArtifactError('The JPEG frame has no size.');
            return { width, height };
        }
        offset += 2 + length;
    }
    throw new RasterArtifactError('The JPEG has no baseline frame header.');
}
export async function readBounded(handle, limit) {
    const chunks = [];
    let total = 0;
    for (;;) {
        const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, limit + 1 - total));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
        if (bytesRead === 0)
            break;
        chunks.push(buffer.subarray(0, bytesRead));
        total += bytesRead;
        if (total > limit)
            return null;
    }
    return Buffer.concat(chunks, total);
}
function assertWithinPixelCeiling(width, height, format) {
    if (width > RASTER_MAX_SIDE_PX || height > RASTER_MAX_SIDE_PX || width * height > RASTER_MAX_TOTAL_PX) {
        throw new RasterArtifactError(`The ${format} header declares ${width}x${height} px, beyond the measured ceiling; it is not decoded.`);
    }
}
function fileIdentityOf(metadata) {
    return { dev: metadata.dev, ino: metadata.ino, size: metadata.size, mtimeNs: metadata.mtimeNs, ctimeNs: metadata.ctimeNs };
}
export async function inspectRasterArtifact(path, format) {
    let handle;
    try {
        handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    }
    catch (error) {
        throw new RasterArtifactError(`The exported file could not be opened: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
        const before = await handle.stat({ bigint: true });
        if (!before.isFile() || before.nlink !== 1n)
            throw new RasterArtifactError('The exported file is not a single regular file.');
        const bytes = await readBounded(handle, RASTER_MAX_ARTIFACT_BYTES);
        if (bytes === null)
            throw new RasterArtifactError(`The exported file is larger than ${RASTER_MAX_ARTIFACT_BYTES} bytes.`);
        const after = await handle.stat({ bigint: true });
        if (!sameFileIdentity(fileIdentityOf(before), fileIdentityOf(after)) || BigInt(bytes.length) !== after.size) {
            throw new RasterArtifactError('The exported file changed while it was read.');
        }
        if (bytes.length === 0)
            throw new RasterArtifactError('The exported file is empty.');
        let size;
        if (format === 'png') {
            if (bytes.length < 24 || bytes.toString('latin1', 12, 16) !== 'IHDR')
                throw new RasterArtifactError('The PNG has no IHDR header.');
            assertWithinPixelCeiling(bytes.readUInt32BE(16), bytes.readUInt32BE(20), 'PNG');
            try {
                const decoded = PNG.sync.read(bytes, { checkCRC: true });
                size = { width: decoded.width, height: decoded.height };
            }
            catch (error) {
                throw new RasterArtifactError(`The PNG does not decode: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        else {
            const frame = jpegFrame(bytes);
            assertWithinPixelCeiling(frame.width, frame.height, 'JPEG');
            let decoded;
            try {
                decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: false, maxResolutionInMP: RASTER_MAX_TOTAL_PX / 1_000_000, maxMemoryUsageInMB: 256 });
            }
            catch (error) {
                throw new RasterArtifactError(`The JPEG does not decode: ${error instanceof Error ? error.message : String(error)}`);
            }
            if (decoded.width !== frame.width || decoded.height !== frame.height)
                throw new RasterArtifactError('The decoded JPEG size differs from its frame header.');
            size = frame;
        }
        await handle.sync();
        return {
            mediaType: format === 'png' ? 'image/png' : 'image/jpeg',
            bytes: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            ...size,
            identity: fileIdentityOf(after),
        };
    }
    finally {
        await handle.close();
    }
}
export function rasterExtension(format) {
    return format === 'png' ? '.png' : '.jpg';
}
async function syncDirectory(path) {
    const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
        await handle.sync();
    }
    finally {
        await handle.close();
    }
}
async function hashWholeFile(path) {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const hash = createHash('sha256');
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        for (;;) {
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
            if (bytesRead === 0)
                break;
            hash.update(buffer.subarray(0, bytesRead));
        }
        return hash.digest('hex');
    }
    finally {
        await handle.close();
    }
}
export class RasterExportOperation {
    deps;
    contract;
    now;
    constructor(deps) {
        this.deps = deps;
        this.contract = deps.dimensionContract ?? WEB_RGB_PIXEL_CONTRACT;
        this.now = deps.now ?? (() => new Date());
    }
    async host(meter, command) {
        const started = performance.now();
        meter.calls += 1;
        try {
            return (await this.deps.bridge.execute(command)).data;
        }
        finally {
            meter.ms += performance.now() - started;
        }
    }
    async run(raw) {
        const started = performance.now();
        const meter = { calls: 0, ms: 0 };
        const input = rasterExportInputSchema.parse(raw);
        if (!input.apply) {
            const planned = await this.plan(input, meter);
            return planned.kind === 'result' ? planned.result : this.plannedResult(planned.plan, input);
        }
        const exportId = input.command_id;
        const confirm = input.confirm_export_hash;
        const existing = await this.existingOutcome(exportId, confirm);
        if (existing !== null)
            return existing;
        const planned = await this.plan(input, meter);
        if (planned.kind === 'result') {
            const result = planned.result;
            if (result.outcome === 'blocked')
                return this.rejected('dimension_contract_unavailable', result.message, result.document);
            return result;
        }
        if (planned.plan.digest !== confirm) {
            return this.rejected('plan_changed', 'The document, file, output or options changed since the plan; plan again and use its next_call.', planned.plan.document);
        }
        return await this.apply(exportId, planned.plan, meter, started);
    }
    rejected(reason, message, document = null) {
        return { outcome: 'rejected', reason, message, document };
    }
    plannedResult(plan, input) {
        const args = {
            expected_document_key: input.expected_document_key,
            format: plan.options.format,
            output_path: input.output_path,
            artboard_index: plan.artboard.index,
            scale: plan.options.scale,
            ...(plan.options.format === 'png' ? { transparent: plan.options.transparent } : { quality: plan.options.quality }),
            apply: true,
            command_id: randomUUID(),
            confirm_export_hash: plan.digest,
        };
        return {
            outcome: 'planned', document: plan.document, artboard: plan.artboard, options: plan.options, outputPath: plan.output.path,
            expected: plan.expected, planDigest: plan.digest, nextCall: { tool: RASTER_EXPORT_TOOL, arguments: args },
        };
    }
    async plan(input, meter) {
        const result = (value) => ({ kind: 'result', result: value });
        let source;
        try {
            source = await this.host(meter, {
                kind: 'read',
                script: RASTER_READ_SOURCE_SCRIPT,
                params: { expectedDocumentKey: input.expected_document_key },
                hostGate: { beforeHost: async () => { await this.deps.assertNoUnresolvedLease(); } },
            });
        }
        catch (error) {
            const detail = parseExportHostError(error);
            if (detail?.code === 'DOCUMENT_MISMATCH')
                return result(this.rejected('document_key_mismatch', 'The active document key does not match expected_document_key.'));
            throw error;
        }
        const document = source.document;
        if (!documentKeyMatches(input.expected_document_key, document.key)) {
            return result(this.rejected('document_key_mismatch', 'Illustrator reported a different document key than expected.'));
        }
        if (document.path === null || document.fileRevision === null) {
            return result(this.rejected('document_not_saved', 'この文書はまだ保存されていません。AI 形式で保存してから、もう一度お試しください。', document));
        }
        if (!document.saved) {
            return result(this.rejected('document_dirty', 'この書き出しでは未保存の変更を含められません。現在の内容を書き出すには、変更を保存してからもう一度お試しください。元ファイルを更新したくない場合は、別名で保存した文書から書き出してください。', document));
        }
        if (document.mutationProfile !== 'saved_file') {
            return result(this.rejected('document_not_admitted', document.mutationBlockedReason ?? 'The document is not a saved, file-backed document.', document));
        }
        if (document.colorSpace !== 'RGB')
            return result(this.rejected('color_space_not_admitted', 'Only RGB documents are measured for this export.', document));
        if (source.placedItems !== 0)
            return result(this.rejected('artwork_not_admitted', 'Linked (placed) images are not measured for this export; embed them first.', document));
        const artboard = source.artboards[input.artboard_index];
        if (artboard === undefined) {
            return result(this.rejected('artboard_out_of_range', `artboard_index ${input.artboard_index} is outside the ${source.artboards.length} artboard(s).`, document));
        }
        let sourceFile;
        let output;
        try {
            const facts = await inspectSourceFile(document.path);
            sourceFile = { ...facts, sha256: await hashWholeFile(facts.path) };
            const session = await this.deps.editSessionForPath(facts.path);
            if (session.state === 'invalid') {
                return result(this.rejected('edit_session_invalid', `An edit session record cannot be read (${session.reason}); inspect it with illustrator_get_edit_session.`, document));
            }
            if (session.state === 'valid') {
                return result(this.rejected('edit_session_open', '編集中のセッションでは書き出せません。変更を保存し、編集セッションを終了してから、もう一度お試しください。', document));
            }
            await this.deps.exportStore.ensure();
            const extensions = input.format === 'png' ? ['.png'] : ['.jpg', '.jpeg'];
            if (!extensions.includes(extname(input.output_path).toLowerCase()) || extensions.includes(basename(input.output_path).toLowerCase())) {
                return result(this.rejected('output_path_invalid', `output_path must end with ${extensions.join(' or ')} for format "${input.format}".`, document));
            }
            output = await validateOutputLocation(input.output_path, sourceFile.path, this.deps.exportStore.stateRootPath);
        }
        catch (error) {
            if (error instanceof BackupPreconditionError)
                return result(this.rejected('source_file_unavailable', error.message, document));
            if (error instanceof ExportPreconditionError) {
                const reason = error.reason === 'output_exists' || error.reason === 'output_cross_device' ? error.reason : 'output_path_invalid';
                return result(this.rejected(reason, error.message, document));
            }
            throw error;
        }
        const options = rasterOptionsOf(input);
        const dimensions = this.contract({ options, artboard: { index: artboard.index, rect: artboard.rect, origin: artboard.origin }, documentRulerOrigin: source.rulerOrigin });
        if (dimensions.status === 'unsupported')
            return result({ outcome: 'blocked', reason: dimensions.reason, message: dimensions.message, document });
        const expected = { width: dimensions.width, height: dimensions.height };
        const digest = canonicalSha256({
            profile: RASTER_EXPORT_PROFILE,
            appVersion: document.appVersion,
            source: { key: document.key, path: sourceFile.path, fileRevision: document.fileRevision, sha256: sourceFile.sha256, identity: serializeFileIdentity(sourceFile.identity) },
            artboards: source.artboards,
            rulerOrigin: source.rulerOrigin,
            target: artboard.index,
            destination: { parent: output.parent, leaf: basename(output.path) },
            options,
            expected,
        });
        return { kind: 'plan', plan: { document, source, artboard, options, sourceFile, output, expected, digest } };
    }
    async existingOutcome(exportId, planDigest) {
        if (await pathTaken(rasterQuarantinePaths(this.deps.exportStore.stateRootPath, exportId).manifest)) {
            return this.rejected('export_records_invalid', `The records of export ${exportId} were moved to quarantine; use a new command_id.`);
        }
        const set = await this.deps.exportStore.readRasterRecordSet(exportId);
        const state = assessRasterRecordSet(set, planDigest);
        switch (state.state) {
            case 'none': return null;
            case 'invalid':
                return state.reason === 'command_id_conflict'
                    ? this.rejected('command_id_conflict', 'command_id was already used for a different export; use the plan\'s next_call for a new export.')
                    : this.rejected('export_records_invalid', `The records of export ${exportId} are not a legal state (${state.reason}); nothing was changed.`);
            case 'prepared':
                return this.rejected('command_id_in_use', `command_id ${exportId} started an export that never reached Illustrator; use a new command_id (illustrator_reconcile_export can clean up its residue).`);
            case 'leased':
                return { outcome: 'indeterminate', exportId, stage: 'existing_lease', message: `Export ${exportId} is unresolved; run the export reconcile before another attempt. It is never resumed automatically.`, commandId: null };
            case 'quarantined':
                return this.rejected('export_records_invalid', `Export ${exportId} is quarantined; nothing is replayed or exported again.`);
            case 'published': return await this.replayPublished(exportId, set);
            case 'failed': return this.failedResult(set, 'replay');
        }
    }
    cleanupEntries(set) {
        return set.cleanup.state === 'v2' ? set.cleanup.record.entries : [];
    }
    failedResult(set, delivery) {
        if (set.failed.state !== 'v2')
            throw new Error('No failed record.');
        const failed = set.failed.record;
        return { outcome: 'failed', exportId: failed.exportId, delivery, stage: failed.stage, reason: failed.reason, message: failed.message, cleanup: this.cleanupEntries(set) };
    }
    async replayPublished(exportId, set) {
        if (set.published.state !== 'v2')
            throw new Error('No published record.');
        const published = set.published.record;
        const started = performance.now();
        let handle;
        try {
            handle = await open(published.artifact.path, constants.O_RDONLY | constants.O_NOFOLLOW);
        }
        catch {
            return this.rejected('artifact_unavailable', `The exported file ${published.artifact.path} is gone; it is not exported again.`);
        }
        try {
            const metadata = await handle.stat({ bigint: true });
            const recorded = published.outputIdentity;
            const sameInode = metadata.isFile() && String(metadata.dev) === recorded.dev && String(metadata.ino) === recorded.ino && String(metadata.size) === recorded.size;
            const bytes = sameInode ? await readBounded(handle, RASTER_MAX_ARTIFACT_BYTES) : null;
            if (bytes === null || createHash('sha256').update(bytes).digest('hex') !== published.artifact.sha256) {
                return this.rejected('artifact_identity_mismatch', `The file at ${published.artifact.path} is no longer the exported file; it is not exported again.`);
            }
        }
        finally {
            await handle.close();
        }
        return {
            outcome: 'verified', exportId, delivery: 'replay', artifact: published.artifact, sourcePreserved: true,
            cleanup: this.cleanupEntries(set), timing: { totalMs: performance.now() - started, hostCalls: 0, hostMs: 0 },
        };
    }
    async apply(exportId, plan, meter, started) {
        const store = this.deps.exportStore;
        const recordedAt = () => this.now().toISOString();
        const common = { version: RASTER_EXPORT_RECORD_VERSION, kind: RASTER_EXPORT_KIND, exportId, planDigest: plan.digest };
        let stage = 'prepare';
        let prepared = false;
        let leaseHeld = false;
        let fingerprint = null;
        const refresh = async () => { fingerprint = recordSetFingerprint(await store.readRasterRecordSet(exportId)); };
        const assertUnchanged = async () => {
            if (recordSetFingerprint(await store.readRasterRecordSet(exportId)) !== fingerprint) {
                throw new RasterStateChangedError(`The records of export ${exportId} changed outside this apply (a reconcile ran); nothing more is written.`);
            }
        };
        const indeterminate = (message, commandId = null) => ({ outcome: 'indeterminate', exportId, stage, message, commandId });
        const asIndeterminate = (error) => indeterminate(error instanceof Error ? error.message : String(error), error instanceof IndeterminateExecutionError || error instanceof RasterAfterHostError ? error.commandId : null);
        const recorded = async (step, commandId, body) => {
            try {
                await body();
            }
            catch (error) {
                const set = await store.readRasterRecordSet(exportId).catch(() => null);
                const written = set === null ? ['unknown'] : Object.entries(set).filter(([, read]) => read.state === 'v2').map(([type]) => type);
                throw new RasterAfterHostError(step, commandId, written, error);
            }
        };
        let exportRoot;
        try {
            exportRoot = await resolveBackupRoot(store.recordDirectory);
        }
        catch (error) {
            if (error instanceof BackupPreconditionError)
                return this.rejected('export_root_unavailable', error.message, plan.document);
            throw error;
        }
        return await withBackupRootScope(exportRoot, async (rootScope) => await withOutputParentScope(plan.output.parent, async (parentScope) => {
            const workCopyPath = join(exportRoot, workCopyFileName(exportId, plan.sourceFile.path));
            const stagingDirectory = join(plan.output.parent, `${STAGING_DIRECTORY_PREFIX}${exportId}`);
            const basePath = join(stagingDirectory, 'artifact');
            const stagedPath = `${basePath}${rasterExtension(plan.options.format)}`;
            const sessionPaths = [workCopyPath, stagedPath, plan.output.path];
            const parentIdentity = await lstat(plan.output.parent, { bigint: true });
            const boards = plan.source.artboards.map(({ index, name, rect }) => ({ index, name, rect }));
            let copied = null;
            const ownedWorkCopy = () => [{ path: workCopyPath, remove: async () => copied === null ? false : await removeOwnedFile(workCopyPath, copied.identity) }];
            stage = 'open_work_copy';
            let openCommandId = null;
            let opened;
            try {
                opened = await this.host(meter, {
                    kind: 'read',
                    script: EXPORT_OPEN_WORK_COPY_SCRIPT,
                    params: { expectedDocumentKey: plan.document.key, workCopyPath, stagedPath, outputPath: plan.output.path, sessionPaths },
                    timeoutMs: EXPORT_HOST_TIMEOUT_MS,
                    hostGate: {
                        beforeHost: async ({ commandId }) => {
                            await this.deps.assertNoUnresolvedLease();
                            await rootScope.assertStable();
                            await parentScope.assertStable();
                            if (assessRasterRecordSet(await store.readRasterRecordSet(exportId)).state !== 'none') {
                                throw new RasterPrepareRefusal('command_id_in_use', `command_id ${exportId} was used meanwhile; use a new command_id.`);
                            }
                            if (await pathTaken(workCopyPath) || await pathTaken(stagingDirectory)) {
                                throw new RasterPrepareRefusal('command_id_in_use', `command_id ${exportId} already has a work copy or stage; use a new command_id.`);
                            }
                            await assertOutputAbsent(plan.output.path);
                            await store.writeRasterRecord('prepare', {
                                ...common, recordType: 'prepare', recordedAt: recordedAt(),
                                sourcePath: plan.sourceFile.path, sourceSha256: plan.sourceFile.sha256, sourceIdentity: serializeFileIdentity(plan.sourceFile.identity),
                                workCopyPath, stagingDirectory, outputParent: plan.output.parent,
                                outputParentIdentity: { dev: String(parentIdentity.dev), ino: String(parentIdentity.ino) }, outputPath: plan.output.path,
                            });
                            prepared = true;
                            const copy = await copyFileExclusive(plan.sourceFile.path, workCopyPath, plan.sourceFile.identity);
                            copied = copy;
                            if (copy.sha256 !== plan.sourceFile.sha256)
                                throw new BackupCopyError('The source bytes changed since the plan.');
                            await mkdir(stagingDirectory, { mode: 0o700 });
                            await syncDirectory(stagingDirectory);
                            await parentScope.sync();
                            await verifyTrackedFile(workCopyPath, copy.identity, copy.sha256);
                            await assertOutputAbsent(stagedPath);
                            await store.openRasterSession({
                                ...common, recordType: 'session', commandId: exportId, openCommandId: commandId,
                                documentKey: plan.document.key, sourcePath: plan.sourceFile.path, sourceSha256: plan.sourceFile.sha256,
                                sourceIdentity: serializeFileIdentity(plan.sourceFile.identity), artboardIndex: plan.artboard.index, options: plan.options,
                                workCopyPath, workCopyIdentity: serializeFileIdentity(copy.identity), stagingDirectory, stagedBasePath: basePath,
                                outputPath: plan.output.path, createdAt: recordedAt(),
                            });
                            leaseHeld = true;
                            openCommandId = commandId;
                            await refresh();
                        },
                        afterHost: async ({ commandId, data }) => await recorded('open', commandId, async () => {
                            const result = data;
                            if (result.opened.path !== workCopyPath || result.documentCountAfter !== result.documentCountBefore + 1 ||
                                result.source.key !== plan.document.key || result.opened.key === plan.document.key) {
                                throw new Error('Illustrator reported an unexpected document inventory after opening the work copy.');
                            }
                            await assertUnchanged();
                            await store.writeRasterRecord('host_open', {
                                ...common, recordType: 'host_open', recordedAt: recordedAt(),
                                open: { commandId, completedInactive: true }, workCopy: hostDocumentIdentitySchema.parse(result.opened), sourceKey: result.source.key,
                                artboards: boards, documentCountBefore: result.documentCountBefore, documentCountAfter: result.documentCountAfter,
                            });
                            await refresh();
                        }),
                    },
                });
            }
            catch (error) {
                if (error instanceof RasterPrepareRefusal)
                    return this.rejected(error.reason, error.message, plan.document);
                if (!leaseHeld) {
                    if (!prepared)
                        return asIndeterminate(error);
                    if (error instanceof BackupCopyError && !copyErrorCreatedDestination(error) && copied === null) {
                        return indeterminate(`The source file changed since the plan (${error.message}); the prepare record stays and the export reconcile can close it.`);
                    }
                    return indeterminate(`The export stopped before Illustrator was contacted (${error instanceof Error ? error.message : String(error)}); run the export reconcile to clean up its residue.`);
                }
                const detail = parseExportHostError(error);
                if (!(error instanceof IndeterminateExecutionError) && detail?.code !== undefined && EXPORT_OPEN_PRE_ATTEMPT_CODES.includes(detail.code)) {
                    return await this.failBeforeWriting(exportId, common, meter, { stage, reason: 'work_copy_open_failed', message: `The work copy was not opened (${detail.code}).` }, sessionPaths, ownedWorkCopy(), assertUnchanged);
                }
                return asIndeterminate(error);
            }
            void openCommandId;
            stage = 'export';
            let failure = null;
            let artifact = null;
            let closeKey = opened.opened.key;
            try {
                const exported = await this.host(meter, {
                    kind: 'read',
                    script: RASTER_EXPORT_SCRIPT,
                    params: {
                        workCopyPath, workCopyKey: opened.opened.key, artboards: boards, artboardIndex: plan.artboard.index, basePath, stagedPath,
                        format: plan.options.format, scale: plan.options.scale,
                        transparent: plan.options.format === 'png' ? plan.options.transparent : false,
                        quality: plan.options.format === 'jpeg' ? plan.options.quality : 0,
                    },
                    timeoutMs: EXPORT_HOST_TIMEOUT_MS,
                    hostGate: {
                        beforeHost: async () => {
                            await rootScope.assertStable();
                            await parentScope.assertStable();
                            await assertOutputAbsent(plan.output.path);
                            await assertUnchanged();
                        },
                        afterHost: async ({ commandId, data }) => await recorded('export', commandId, async () => {
                            const result = data;
                            if (result.workCopy.path !== workCopyPath || result.activeArtboardIndex !== plan.artboard.index) {
                                throw new Error('Illustrator reported an unexpected work-copy state after the export.');
                            }
                            await assertUnchanged();
                            const verified = await this.verifyStage(stagingDirectory, stagedPath, plan);
                            if ('failure' in verified) {
                                failure = verified.failure;
                                return;
                            }
                            const session = await store.readRasterRecord(exportId, 'session');
                            if (session.state !== 'v2')
                                throw new Error('The lease could not be read back before binding.');
                            await store.writeRasterRecord('artifact_binding', {
                                ...common, recordType: 'artifact_binding', recordedAt: recordedAt(), export: { commandId, completedInactive: true }, sessionDigest: session.digest,
                                stagedPath, stagedIdentity: serializeFileIdentity(verified.artifact.identity), mediaType: verified.artifact.mediaType, bytes: verified.artifact.bytes,
                                sha256: verified.artifact.sha256, width: verified.artifact.width, height: verified.artifact.height,
                                copyAfterExport: { identity: hostDocumentIdentitySchema.parse(result.workCopy), activeArtboardIndex: result.activeArtboardIndex, artboards: result.artboards },
                            });
                            artifact = verified.artifact;
                            await refresh();
                        }),
                    },
                });
                closeKey = exported.workCopy.key;
            }
            catch (error) {
                const detail = parseExportHostError(error);
                if (error instanceof IndeterminateExecutionError || detail?.code === undefined)
                    return asIndeterminate(error);
                if (detail.code === 'EXPORT_WORK_COPY_NOT_UNIQUE' || detail.code === 'EXPORT_WORK_COPY_IDENTITY_MISMATCH')
                    return asIndeterminate(error);
                if (RASTER_EXPORT_PRE_ATTEMPT_CODES.includes(detail.code)) {
                    failure = { stage: 'export', reason: 'export_refused', message: `The export was refused before any write (${detail.code}).` };
                }
                else if (detail.code === RASTER_EXPORT_FAILED_CODE) {
                    failure = { stage: 'export', reason: 'export_failed', message: `Illustrator refused the export: ${detail.message ?? 'unknown error'}` };
                }
                else {
                    return asIndeterminate(error);
                }
            }
            stage = 'close_work_copy';
            let outcome = null;
            try {
                await this.host(meter, {
                    kind: 'read',
                    script: EXPORT_CLOSE_WORK_COPY_SCRIPT,
                    params: {
                        workCopyPath, workCopyKey: closeKey, sessionPaths, sourcePath: plan.sourceFile.path,
                        expectedDocumentKey: plan.document.key, sourceFileRevision: plan.document.fileRevision,
                    },
                    timeoutMs: EXPORT_HOST_TIMEOUT_MS,
                    hostGate: {
                        beforeHost: async () => { await assertUnchanged(); },
                        afterHost: async ({ commandId, data }) => await recorded('close', commandId, async () => {
                            const result = data;
                            if (result.documentCount !== opened.documentCountBefore || result.closedBeforeClose.path !== workCopyPath || result.source.key !== plan.document.key) {
                                throw new Error('Illustrator reported an unexpected document inventory after closing the work copy.');
                            }
                            await assertUnchanged();
                            await store.writeRasterRecord('host_terminal', {
                                ...common, recordType: 'host_terminal', recordedAt: recordedAt(), close: { commandId, completedInactive: true },
                                closedBeforeClose: hostDocumentIdentitySchema.parse(result.closedBeforeClose), sourceKey: result.source.key,
                                sourceSaved: true, sourceFileRevision: plan.document.fileRevision, documentCount: result.documentCount,
                            });
                            stage = 'verify_source';
                            try {
                                const after = await inspectSourceFile(plan.sourceFile.path);
                                if (after.path !== plan.sourceFile.path || !sameFileIdentity(after.identity, plan.sourceFile.identity)) {
                                    failure ??= { stage, reason: 'source_changed', message: 'The source file changed during the export.' };
                                }
                            }
                            catch (error) {
                                if (!(error instanceof BackupPreconditionError))
                                    throw error;
                                failure ??= { stage, reason: 'source_changed', message: error.message };
                            }
                            const bound = artifact;
                            if (failure !== null || bound === null) {
                                outcome = await this.recordFailure(exportId, common, failure ?? { stage, reason: 'output_verification_failed', message: 'The export produced no verified file.' }, ownedWorkCopy());
                                return;
                            }
                            stage = 'publish_output';
                            await rootScope.assertStable();
                            await parentScope.assertStable();
                            let outputIdentity;
                            try {
                                outputIdentity = await linkBoundArtifact(stagedPath, plan.output.path, bound, parentScope);
                            }
                            catch (error) {
                                if (!(error instanceof RasterPublishError))
                                    throw error;
                                outcome = await this.recordFailure(exportId, common, { stage, reason: error.reason, message: error.message }, ownedWorkCopy());
                                return;
                            }
                            const artifactRecord = { path: plan.output.path, mediaType: bound.mediaType, bytes: bound.bytes, sha256: bound.sha256, width: bound.width, height: bound.height };
                            const set = await store.readRasterRecordSet(exportId);
                            if (set.artifact_binding.state !== 'v2' || set.host_terminal.state !== 'v2')
                                throw new Error('The binding or host evidence could not be read back before publishing.');
                            await store.writeRasterRecord('published', {
                                ...common, recordType: 'published', recordedAt: recordedAt(), bindingDigest: set.artifact_binding.digest,
                                hostTerminalDigest: set.host_terminal.digest, artifact: artifactRecord, outputIdentity: serializeFileIdentity(outputIdentity),
                                sourcePath: plan.sourceFile.path, artboardIndex: plan.artboard.index, options: plan.options,
                            });
                            stage = 'cleanup';
                            const entries = await this.cleanup([
                                { path: stagedPath, remove: async () => await unlinkStagedName(stagedPath, outputIdentity, parentScope) },
                                { path: stagingDirectory, remove: async () => await removeEmptyDirectory(stagingDirectory, plan.output.parent) },
                                ...ownedWorkCopy(),
                            ]);
                            await store.writeRasterRecord('cleanup', { ...common, recordType: 'cleanup', recordedAt: recordedAt(), disposition: 'published', entries });
                            await store.releaseRasterSession(exportId);
                            outcome = {
                                outcome: 'verified', exportId, delivery: 'original', artifact: artifactRecord, sourcePreserved: true, cleanup: entries,
                                timing: { totalMs: 0, hostCalls: 0, hostMs: 0 },
                            };
                        }),
                    },
                });
            }
            catch (error) {
                return asIndeterminate(error);
            }
            const final = outcome;
            if (final === null)
                return indeterminate('The close completed without a recorded outcome.');
            return final.outcome === 'verified'
                ? { ...final, timing: { totalMs: performance.now() - started, hostCalls: meter.calls, hostMs: meter.ms } }
                : final;
        }));
    }
    async verifyStage(stagingDirectory, stagedPath, plan) {
        const stage = 'verify_output';
        const names = await readdir(stagingDirectory);
        if (names.length !== 1 || names[0] !== basename(stagedPath)) {
            return { failure: { stage, reason: 'unexpected_output_files', message: `The stage holds ${JSON.stringify(names)} instead of one ${basename(stagedPath)}.` } };
        }
        let artifact;
        try {
            artifact = await inspectRasterArtifact(stagedPath, plan.options.format);
        }
        catch (error) {
            if (error instanceof RasterArtifactError)
                return { failure: { stage, reason: 'output_verification_failed', message: error.message } };
            throw error;
        }
        await syncDirectory(stagingDirectory);
        if (artifact.width !== plan.expected.width || artifact.height !== plan.expected.height) {
            return { failure: { stage, reason: 'dimension_mismatch', message: `The file is ${artifact.width}x${artifact.height} px; the contract expects ${plan.expected.width}x${plan.expected.height}.` } };
        }
        return { artifact };
    }
    async cleanup(targets) {
        const entries = [];
        for (const target of targets) {
            const removed = await target.remove();
            entries.push(removed ? { path: target.path, removed, reason: 'owned' } : await retainedEntry(target.path, 'retained: ownership not proven'));
        }
        return entries;
    }
    async recordFailure(exportId, common, failure, owned) {
        const store = this.deps.exportStore;
        const set = await store.readRasterRecordSet(exportId);
        const evidenceDigests = {};
        for (const [type, read] of Object.entries(set))
            if (read.state === 'v2')
                evidenceDigests[type] = read.digest;
        await store.writeRasterRecord('failed', { ...common, recordType: 'failed', recordedAt: this.now().toISOString(), ...failure, evidenceDigests });
        const entries = await this.cleanup(owned);
        await store.writeRasterRecord('cleanup', { ...common, recordType: 'cleanup', recordedAt: this.now().toISOString(), disposition: 'failed', entries });
        await store.releaseRasterSession(exportId);
        return this.failedResult(await store.readRasterRecordSet(exportId), 'original');
    }
    async failBeforeWriting(exportId, common, meter, failure, sessionPaths, owned, assertUnchanged) {
        let outcome = null;
        try {
            await this.host(meter, {
                kind: 'read', script: EXPORT_INVENTORY_SCRIPT, params: { sessionPaths },
                hostGate: {
                    afterHost: async ({ data }) => {
                        if (data.documents.length !== 0)
                            return;
                        await assertUnchanged();
                        outcome = await this.recordFailure(exportId, common, failure, owned);
                    },
                },
            });
        }
        catch (error) {
            return { outcome: 'indeterminate', exportId, stage: failure.stage, message: `${failure.message} The failure could not be recorded: ${error instanceof Error ? error.message : String(error)}`, commandId: null };
        }
        return outcome ?? { outcome: 'indeterminate', exportId, stage: failure.stage, message: `${failure.message} A session document is open.`, commandId: null };
    }
}
class RasterPrepareRefusal extends Error {
    reason;
    constructor(reason, message) {
        super(message);
        this.reason = reason;
        this.name = 'RasterPrepareRefusal';
    }
}
class RasterAfterHostError extends Error {
    step;
    commandId;
    constructor(step, commandId, written, cause) {
        super(`Illustrator completed the ${step} (command ${commandId}); the records written so far are ${written.join(', ') || 'none'}, and the rest were not written ` +
            `(${cause instanceof Error ? cause.message : String(cause)}). The lease is kept for the export reconcile.`, { cause });
        this.step = step;
        this.commandId = commandId;
        this.name = 'RasterAfterHostError';
    }
}
class RasterStateChangedError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RasterStateChangedError';
    }
}
export function recordSetFingerprint(set) {
    return JSON.stringify(Object.keys(set).sort().map((type) => {
        const read = set[type];
        return [type, read.state, read.state === 'v2' ? read.digest : read.state === 'invalid' ? read.reason : null];
    }));
}
async function pathTaken(path) {
    return await lstat(path).then(() => true, (error) => {
        if (error.code === 'ENOENT')
            return false;
        throw error;
    });
}
export async function removeOwnedFile(path, identity) {
    let handle;
    try {
        handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    }
    catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ELOOP')
            return false;
        throw error;
    }
    try {
        const before = await handle.stat({ bigint: true });
        if (!before.isFile() || !sameFileIdentity(identity, fileIdentityOf(before)) || before.nlink !== 1n)
            return false;
        await unlink(path);
        if ((await handle.stat({ bigint: true })).nlink !== 0n)
            throw new Error(`${path} kept another link after the unlink.`);
    }
    finally {
        await handle.close();
    }
    await syncDirectory(dirname(path));
    return true;
}
export async function removeEmptyDirectory(path, parent) {
    try {
        await rmdir(path);
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOTEMPTY' || code === 'EEXIST' || code === 'ENOENT' || code === 'ENOTDIR')
            return false;
        throw error;
    }
    await syncDirectory(parent);
    return true;
}
const digitsSchema = z.string().regex(/^\d+$/u);
const quarantinedFileSchema = z.strictObject({
    name: z.string().regex(/^[A-Za-z0-9._-]{1,200}$/u),
    size: z.number().int().nonnegative(),
    sha256: sha256Schema,
    dev: digitsSchema,
    ino: digitsSchema,
    mode: z.number().int().nonnegative(),
    uid: z.number().int().nonnegative(),
    nlink: z.number().int().positive(),
});
export const rasterQuarantineManifestSchema = z.strictObject({
    version: z.literal(1),
    kind: z.literal('raster_export'),
    exportId: z.uuid(),
    quarantinedAt: z.string().min(1),
    entries: z.array(quarantinedFileSchema).max(256),
});
export function rasterQuarantinePaths(stateRoot, exportId) {
    const base = join(stateRoot, 'quarantine');
    const area = join(base, 'exports');
    return { base, area, manifest: join(area, `${exportId}.json`), directory: join(area, exportId) };
}
export async function readRasterQuarantineManifest(stateRoot, exportId) {
    const path = rasterQuarantinePaths(stateRoot, exportId).manifest;
    if (!await pathTaken(path))
        return { state: 'missing' };
    const record = await readSecurePrivateRecord(path, 262_144, { maxLinkCount: await createOnceLinkAllowance(path) }).catch((error) => {
        if (error.code === 'ENOENT')
            return { state: 'missing' };
        throw error;
    });
    if (record.state === 'missing')
        return { state: 'missing' };
    if (record.state === 'invalid')
        return { state: 'invalid', reason: record.reason };
    try {
        const parsed = rasterQuarantineManifestSchema.safeParse(JSON.parse(record.text));
        if (!parsed.success || parsed.data.exportId !== exportId)
            return { state: 'invalid', reason: 'malformed_manifest' };
        return { state: 'valid', manifest: parsed.data };
    }
    catch {
        return { state: 'invalid', reason: 'malformed_json' };
    }
}
async function ensurePrivateSubdirectory(path, parent) {
    try {
        await mkdir(path, { mode: 0o700 });
    }
    catch (error) {
        if (error.code !== 'EEXIST')
            throw error;
    }
    const metadata = await lstat(path, { bigint: true });
    const uid = typeof process.getuid === 'function' ? process.getuid() : -1;
    if (!metadata.isDirectory() || Number(metadata.uid) !== uid || (metadata.mode & 511n) !== 448n) {
        throw new RasterQuarantineRefusal(`${path} is not a private directory of this user.`);
    }
    await syncDirectory(parent);
}
class RasterQuarantineRefusal extends Error {
    constructor(message) {
        super(message);
        this.name = 'RasterQuarantineRefusal';
    }
}
const QUARANTINE_FILE_LIMIT = 1_048_576;
const QUARANTINE_NAME = /^[A-Za-z0-9._-]{1,200}$/u;
async function hashEntry(path, expected) {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const metadata = await handle.stat({ bigint: true });
        if (!metadata.isFile() || metadata.ino !== expected.ino || metadata.dev !== expected.dev)
            throw new RasterQuarantineRefusal(`${basename(path)} changed while it was inspected.`);
        const bytes = await readBounded(handle, QUARANTINE_FILE_LIMIT);
        if (bytes === null)
            throw new RasterQuarantineRefusal(`${basename(path)} is larger than ${QUARANTINE_FILE_LIMIT} bytes.`);
        return createHash('sha256').update(bytes).digest('hex');
    }
    finally {
        await handle.close();
    }
}
export async function moveRasterExportToQuarantine(stateRoot, exportsDirectory, exportId, now) {
    const paths = rasterQuarantinePaths(stateRoot, exportId);
    const uid = typeof process.getuid === 'function' ? process.getuid() : -1;
    const lease = `${exportId}${RASTER_EXPORT_RECORD_SUFFIXES.session}`;
    const names = (await readdir(exportsDirectory)).filter((name) => name.startsWith(`${exportId}.`)).sort();
    if (names.length > 256)
        throw new RasterQuarantineRefusal(`Export ${exportId} has ${names.length} entries; at most 256 are moved.`);
    const observed = new Map();
    for (const name of names) {
        if (!QUARANTINE_NAME.test(name))
            throw new RasterQuarantineRefusal(`${JSON.stringify(name)} is not a safe entry name.`);
        observed.set(name, await lstat(join(exportsDirectory, name), { bigint: true }));
    }
    const existing = await readRasterQuarantineManifest(stateRoot, exportId);
    if (existing.state === 'invalid')
        throw new RasterQuarantineRefusal(`The quarantine manifest of ${exportId} is unreadable (${existing.reason}).`);
    const recorded = existing.state === 'valid' ? existing.manifest.entries : [];
    const quarantined = new Map();
    for (const name of await readdir(paths.directory).catch(() => [])) {
        const metadata = await lstat(join(paths.directory, name), { bigint: true });
        if (!recorded.some((entry) => entry.name === name && entry.ino === String(metadata.ino) && entry.dev === String(metadata.dev))) {
            throw new RasterQuarantineRefusal(`${name} in the quarantine directory is not in its manifest.`);
        }
        quarantined.set(name, metadata);
    }
    for (const [name, metadata] of observed) {
        if (metadata.isSymbolicLink() || !metadata.isFile())
            throw new RasterQuarantineRefusal(`${name} is not a regular file.`);
        if (Number(metadata.uid) !== uid)
            throw new RasterQuarantineRefusal(`${name} is owned by another user.`);
        const same = (candidate) => candidate.ino === metadata.ino && candidate.dev === metadata.dev;
        const here = [...observed.entries()].filter(([other, candidate]) => other !== name && same(candidate));
        if (!here.every(([other]) => temporaryTwinPattern(name).test(other) || temporaryTwinPattern(other).test(name))) {
            throw new RasterQuarantineRefusal(`${name} shares its inode with an unrelated entry.`);
        }
        const there = [...quarantined.values()].filter(same).length;
        if (metadata.nlink !== BigInt(1 + here.length + there))
            throw new RasterQuarantineRefusal(`${name} has an unexpected link count.`);
    }
    const entries = [...recorded];
    for (const [name, metadata] of observed) {
        const known = recorded.find((entry) => entry.name === name);
        if (known !== undefined) {
            if (known.ino !== String(metadata.ino) || known.dev !== String(metadata.dev))
                throw new RasterQuarantineRefusal(`${name} changed since it was recorded in the manifest.`);
            continue;
        }
        entries.push({ name, size: Number(metadata.size), sha256: await hashEntry(join(exportsDirectory, name), metadata), dev: String(metadata.dev),
            ino: String(metadata.ino), mode: Number(metadata.mode & 4095n), uid: Number(metadata.uid), nlink: Number(metadata.nlink) });
    }
    if (entries.length > 256)
        throw new RasterQuarantineRefusal(`The quarantine manifest of ${exportId} would exceed 256 entries.`);
    await ensurePrivateSubdirectory(paths.base, stateRoot);
    await ensurePrivateSubdirectory(paths.area, paths.base);
    const manifest = rasterQuarantineManifestSchema.parse({ version: 1, kind: 'raster_export', exportId,
        quarantinedAt: existing.state === 'valid' ? existing.manifest.quarantinedAt : now, entries });
    if (existing.state === 'missing')
        await atomicCreatePrivateRecord(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
    else if (entries.length !== recorded.length)
        await atomicReplacePrivateRecord(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
    await ensurePrivateSubdirectory(paths.directory, paths.area);
    const moved = [];
    const move = async (name) => {
        const source = join(exportsDirectory, name);
        const target = join(paths.directory, name);
        const metadata = observed.get(name);
        try {
            await link(source, target);
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                throw error;
            const present = await lstat(target, { bigint: true });
            if (present.ino !== metadata.ino || present.dev !== metadata.dev)
                throw new RasterQuarantineRefusal(`${name} already exists in the quarantine directory as another file.`);
        }
        await syncDirectory(paths.directory);
        await unlink(source);
        await syncDirectory(exportsDirectory);
        moved.push(name);
    };
    for (const name of names)
        if (name !== lease)
            await move(name);
    if (names.includes(lease))
        await move(lease);
    return moved;
}
export const RASTER_RECONCILE_ACTIONS = ['inspect', 'close_work_copy', 'finalize', 'abandon', 'release_quarantined'];
const residueSchema = z.strictObject({ path: z.string(), present: z.boolean(), owned: z.boolean(), reason: z.string() });
export const rasterReconcileResultSchema = z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('no_records'), exportId: z.string() }),
    z.strictObject({ status: z.literal('invalid'), exportId: z.string(), reason: z.string() }),
    z.strictObject({ status: z.literal('closed'), exportId: z.string() }),
    z.strictObject({
        status: z.literal('unresolved'), exportId: z.string(), window: z.string(), action: z.enum(RASTER_RECONCILE_ACTIONS),
        reason: z.string().nullable(), documents: z.number().int().nonnegative().nullable(), residue: z.array(residueSchema),
        message: z.string().nullable(),
    }),
    z.strictObject({
        status: z.literal('released'), exportId: z.string(), window: z.string(), action: z.enum(RASTER_RECONCILE_ACTIONS),
        disposition: z.enum(['published', 'failed', 'released_after_cleanup', 'quarantine_released', 'moved_to_quarantine']),
    }),
    z.strictObject({ status: z.literal('moved_to_quarantine'), exportId: z.string(), manifestPath: z.string(), entries: z.array(z.string()) }),
    z.strictObject({
        status: z.literal('residue_cleaned'), exportId: z.string(),
        entries: z.array(z.strictObject({ path: z.string().min(1), removed: z.boolean(), reason: z.string() })),
    }),
]);
export function rasterWindow(set, stageHasFiles) {
    const has = (type) => set[type].state === 'v2';
    if (has('quarantine'))
        return has('session') ? 'Q' : 'closed';
    if (!has('session'))
        return has('prepare') && !has('published') && !has('failed') && !has('cleanup') ? 'W0' : 'closed';
    if (has('cleanup'))
        return 'W8';
    if (has('failed'))
        return 'F';
    if (has('published'))
        return 'W7';
    if (has('host_terminal'))
        return 'W5';
    if (has('artifact_binding'))
        return 'W4';
    if (has('host_open'))
        return stageHasFiles ? 'W3' : 'W2';
    return 'W1';
}
async function retainedEntry(path, reason) {
    return { path, removed: false, reason: await pathTaken(path) ? reason : 'absent' };
}
async function presence(paths) {
    return await Promise.all(paths.map(async (path) => {
        const present = await pathTaken(path);
        return { path, present, owned: false, reason: present ? 'retained' : 'absent' };
    }));
}
async function w0Residue(prepare) {
    const uid = typeof process.getuid === 'function' ? process.getuid() : -1;
    const checks = [];
    const present = async (path) => await lstat(path, { bigint: true }).catch((error) => {
        if (error.code === 'ENOENT')
            return null;
        throw error;
    });
    const copy = await present(prepare.workCopyPath);
    if (copy === null) {
        checks.push({ path: prepare.workCopyPath, present: false, owned: false, reason: 'absent' });
    }
    else {
        let owned = copy.isFile() && Number(copy.uid) === uid && copy.nlink === 1n;
        let reason = owned ? 'owned' : 'not a single regular file of this user';
        if (owned && await hashWholeFile(prepare.workCopyPath) !== prepare.sourceSha256) {
            owned = false;
            reason = 'content differs from the source (partial or replaced copy)';
        }
        const identity = fileIdentityOf(copy);
        checks.push({ path: prepare.workCopyPath, present: true, owned, reason, ...(owned ? { remove: async () => await removeOwnedFile(prepare.workCopyPath, identity) } : {}) });
    }
    const stage = await present(prepare.stagingDirectory);
    if (stage === null) {
        checks.push({ path: prepare.stagingDirectory, present: false, owned: false, reason: 'absent' });
    }
    else {
        const parent = await lstat(prepare.outputParent, { bigint: true });
        const empty = stage.isDirectory() ? (await readdir(prepare.stagingDirectory)).length === 0 : false;
        const owned = stage.isDirectory() && Number(stage.uid) === uid && (stage.mode & 511n) === 448n && empty &&
            String(parent.dev) === prepare.outputParentIdentity.dev && String(parent.ino) === prepare.outputParentIdentity.ino && stage.dev === parent.dev;
        checks.push({ path: prepare.stagingDirectory, present: true, owned, reason: owned ? 'owned' : 'not an empty private directory of this user in the recorded output folder',
            ...(owned ? { remove: async () => await removeEmptyDirectory(prepare.stagingDirectory, prepare.outputParent) } : {}) });
    }
    return checks;
}
export class RasterExportReconciler {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    get store() { return this.deps.exportStore; }
    now() { return (this.deps.now ?? (() => new Date()))().toISOString(); }
    async reconcile(input) {
        const exportId = canonicalCommandIdSchema.parse(input.exportId);
        const leasePresent = await pathTaken(this.store.rasterRecordPath(exportId, 'session'));
        const moved = await readRasterQuarantineManifest(this.store.stateRootPath, exportId);
        const set = await this.store.readRasterRecordSet(exportId);
        const state = assessRasterRecordSet(set);
        if (leasePresent && (state.state === 'invalid' || moved.state !== 'missing')) {
            return await this.moveToQuarantine(input, exportId, set, state.state === 'invalid' ? state.reason : 'quarantine move in progress');
        }
        if (moved.state === 'valid') {
            return { status: 'moved_to_quarantine', exportId, manifestPath: rasterQuarantinePaths(this.store.stateRootPath, exportId).manifest, entries: moved.manifest.entries.map((entry) => entry.name) };
        }
        if (moved.state === 'invalid')
            return { status: 'invalid', exportId, reason: `quarantine manifest: ${moved.reason}` };
        if (state.state === 'none')
            return { status: 'no_records', exportId };
        if (state.state === 'invalid')
            return { status: 'invalid', exportId, reason: state.reason };
        if (state.state === 'published' || state.state === 'failed' || (state.state === 'prepared' && state.abandoned) ||
            (state.state === 'quarantined' && state.released))
            return { status: 'closed', exportId };
        const prepare = set.prepare.state === 'v2' ? set.prepare.record : null;
        if (prepare === null)
            return { status: 'invalid', exportId, reason: 'records without prepare' };
        const stageFiles = await readdir(prepare.stagingDirectory).then((names) => names.length > 0, () => false);
        const window = rasterWindow(set, stageFiles);
        const common = { version: RASTER_EXPORT_RECORD_VERSION, kind: RASTER_EXPORT_KIND, exportId, planDigest: prepare.planDigest };
        const sessionPaths = [prepare.workCopyPath, join(prepare.stagingDirectory, `artifact${rasterExtensionOf(set)}`), prepare.outputPath];
        const fingerprint = recordSetFingerprint(set);
        const unresolved = (reason, documents = null, residue = [], message = null) => ({
            status: 'unresolved', exportId, window, action: input.action, reason, documents,
            residue: residue.map(({ path, present, owned, reason: why }) => ({ path, present, owned, reason: why })), message,
        });
        const unchanged = async () => recordSetFingerprint(await this.store.readRasterRecordSet(exportId)) === fingerprint;
        if (window === 'Q') {
            const residue = await presence([prepare.workCopyPath, prepare.stagingDirectory, sessionPaths[1], prepare.outputPath]);
            const guidance = `Export ${exportId} is quarantined. Check ${prepare.outputPath} and the retained files, then run release_quarantined with confirm_export_id equal to the export id.`;
            if (input.action !== 'release_quarantined')
                return unresolved('quarantined', null, residue, guidance);
            if (input.confirmExportId !== exportId)
                return unresolved('confirm_export_id_mismatch', null, residue, guidance);
            let released = false;
            let refusal = null;
            const documents = await this.inventory(sessionPaths, async (count) => {
                if (count !== 0) {
                    refusal = 'session_document_open';
                    return;
                }
                if (!await unchanged()) {
                    refusal = 'state_changed';
                    return;
                }
                if (set.cleanup.state !== 'v2') {
                    const entries = await Promise.all([prepare.workCopyPath, prepare.stagingDirectory, prepare.outputPath].map(async (path) => await retainedEntry(path, 'retained: quarantined evidence')));
                    await this.store.writeRasterRecord('cleanup', { ...common, recordType: 'cleanup', recordedAt: this.now(), disposition: 'quarantine_released', entries });
                }
                await this.store.releaseRasterSession(exportId);
                released = true;
            });
            return released ? { status: 'released', exportId, window, action: input.action, disposition: 'quarantine_released' } : unresolved(refusal, documents, residue, guidance);
        }
        if (window === 'W0') {
            const residue = await w0Residue(prepare);
            if (input.action !== 'abandon')
                return unresolved('prepared_before_open', null, residue);
            let entries = null;
            let refusal = null;
            await this.inventory(sessionPaths, async (count) => {
                if (count !== 0) {
                    refusal = 'session_document_open';
                    return;
                }
                if (!await unchanged()) {
                    refusal = 'state_changed';
                    return;
                }
                const removed = [];
                for (const check of await w0Residue(prepare)) {
                    const done = check.remove ? await check.remove() : false;
                    removed.push({ path: check.path, removed: done, reason: done ? 'owned' : `retained: ${check.reason}` });
                }
                await this.store.writeRasterRecord('cleanup', { ...common, recordType: 'cleanup', recordedAt: this.now(), disposition: 'abandoned_before_open', entries: removed });
                entries = removed;
            });
            return entries === null ? unresolved(refusal ?? 'not_cleaned', null, residue) : { status: 'residue_cleaned', exportId, entries };
        }
        if (input.action === 'close_work_copy') {
            const expected = window === 'W2' && set.host_open.state === 'v2'
                ? { identity: set.host_open.record.workCopy, artboards: set.host_open.record.artboards }
                : window === 'W4' && set.artifact_binding.state === 'v2'
                    ? { identity: set.artifact_binding.record.copyAfterExport.identity, artboards: set.artifact_binding.record.copyAfterExport.artboards }
                    : null;
            if (expected === null) {
                const reason = window === 'W3' ? 'dirty_copy_without_export_evidence' : window === 'W1' ? 'copy_open_without_evidence' : 'nothing_to_close';
                return unresolved(reason, null, [], window === 'W1' || window === 'W3'
                    ? 'This copy cannot be closed automatically; close it in Illustrator without saving, then run abandon.' : null);
            }
            try {
                const closed = await this.deps.bridge.execute({
                    kind: 'read',
                    script: RASTER_RECONCILE_CLOSE_SCRIPT,
                    params: { sessionPaths, expected: { path: expected.identity.path, key: expected.identity.key, saved: expected.identity.saved,
                            artboards: expected.artboards.map((board) => ({ rect: board.rect })) } },
                    timeoutMs: EXPORT_HOST_TIMEOUT_MS,
                    hostGate: { beforeHost: async () => { if (!await unchanged())
                            throw new Error('The export records changed; nothing was closed.'); } },
                });
                return unresolved(closed.data.remaining === 0 ? 'work_copy_closed' : 'work_copy_still_open', closed.data.remaining);
            }
            catch (error) {
                const detail = parseExportHostError(error);
                if (detail?.code === 'RASTER_RECONCILE_CLOSE_REFUSED' || detail?.code === 'RASTER_RECONCILE_NOT_UNIQUE')
                    return unresolved(`close_refused:${detail.code}`);
                throw error;
            }
        }
        let released = null;
        let refusal = null;
        const documents = await this.inventory(sessionPaths, async (count) => {
            if (input.action === 'inspect')
                return;
            if (count !== 0) {
                refusal = 'session_document_open';
                return;
            }
            if (!await unchanged()) {
                refusal = 'state_changed';
                return;
            }
            const outcome = await this.resolveWindow(window, input.action, set, prepare, common);
            if (outcome === null)
                refusal = `action_not_allowed_in_${window}`;
            else if (outcome === 'quarantined')
                refusal = 'quarantined';
            else
                released = { status: 'released', exportId, window, action: input.action, disposition: outcome };
        });
        return released ?? unresolved(refusal, documents);
    }
    async inventory(sessionPaths, underLock) {
        const result = await this.deps.bridge.execute({
            kind: 'read', script: EXPORT_INVENTORY_SCRIPT, params: { sessionPaths },
            hostGate: { afterHost: async ({ data }) => {
                    const inventory = data;
                    await underLock(inventory.documents.length, inventory.documentCount);
                } },
        });
        return result.data.documents.length;
    }
    async quarantineCandidateState(exportId) {
        const leasePresent = await pathTaken(this.store.rasterRecordPath(exportId, 'session'));
        const manifest = await readRasterQuarantineManifest(this.store.stateRootPath, exportId);
        const set = await this.store.readRasterRecordSet(exportId);
        if (!leasePresent || Object.values(set).some((read) => read.state === 'v1'))
            return null;
        const state = assessRasterRecordSet(set);
        if (state.state !== 'invalid' && manifest.state === 'missing')
            return null;
        return JSON.stringify([recordSetFingerprint(set), manifest.state, manifest.state === 'valid' ? manifest.manifest.entries.length : null]);
    }
    async moveToQuarantine(input, exportId, set, why) {
        const prepare = set.prepare.state === 'v2' ? set.prepare.record : null;
        const sessionPaths = prepare === null ? [] : [prepare.workCopyPath, join(prepare.stagingDirectory, `artifact${rasterExtensionOf(set)}`), prepare.outputPath];
        const guidance = `The records of export ${exportId} are not a legal state (${why}). Check the export folder and the files, then run release_quarantined with confirm_export_id equal to the export id; the records are moved unread into quarantine/exports/ and the lease last.`;
        const unresolved = (reason, documents = null) => ({ status: 'unresolved', exportId, window: 'I', action: input.action, reason, documents, residue: [], message: guidance });
        if (Object.values(set).some((read) => read.state === 'v1'))
            return unresolved('version_1_records_present');
        if (input.action !== 'release_quarantined')
            return unresolved(`invalid_records: ${why}`);
        if (input.confirmExportId !== exportId)
            return unresolved('confirm_export_id_mismatch');
        const observedState = await this.quarantineCandidateState(exportId);
        let refusal = null;
        let moved = false;
        const documents = await this.inventory(sessionPaths, async (count, documentCount) => {
            if (prepare !== null ? count !== 0 : documentCount !== 0) {
                refusal = prepare !== null ? 'session_document_open' : 'documents_open_without_prepare';
                return;
            }
            const now = await this.quarantineCandidateState(exportId);
            if (now === null || now !== observedState) {
                refusal = 'state_changed';
                return;
            }
            try {
                await moveRasterExportToQuarantine(this.store.stateRootPath, this.store.recordDirectory, exportId, this.now());
                moved = true;
            }
            catch (error) {
                if (!(error instanceof RasterQuarantineRefusal))
                    throw error;
                refusal = `quarantine_refused: ${error.message}`;
            }
        });
        return moved ? { status: 'released', exportId, window: 'I', action: input.action, disposition: 'moved_to_quarantine' } : unresolved(refusal ?? 'not_moved', documents);
    }
    async resolveWindow(window, action, set, prepare, common) {
        const exportId = common.exportId;
        const retainAll = async () => await Promise.all([prepare.workCopyPath, prepare.stagingDirectory].map(async (path) => await retainedEntry(path, 'retained: reconcile keeps evidence')));
        const fail = async (reason, message) => {
            const evidenceDigests = {};
            for (const [type, read] of Object.entries(set))
                if (read.state === 'v2')
                    evidenceDigests[type] = read.digest;
            await this.store.writeRasterRecord('failed', { ...common, recordType: 'failed', recordedAt: this.now(), stage: `reconcile_${window}`, reason, message, evidenceDigests });
            await this.store.writeRasterRecord('cleanup', { ...common, recordType: 'cleanup', recordedAt: this.now(), disposition: 'failed', entries: await retainAll() });
            await this.store.releaseRasterSession(exportId);
            return 'failed';
        };
        switch (window) {
            case 'W8':
                if (action !== 'finalize')
                    return null;
                await this.store.releaseRasterSession(exportId);
                return 'released_after_cleanup';
            case 'F':
                if (action !== 'finalize' && action !== 'abandon')
                    return null;
                await this.store.writeRasterRecord('cleanup', { ...common, recordType: 'cleanup', recordedAt: this.now(), disposition: 'failed', entries: await retainAll() });
                await this.store.releaseRasterSession(exportId);
                return 'failed';
            case 'W7': {
                if (action !== 'finalize' || set.published.state !== 'v2' || set.artifact_binding.state !== 'v2')
                    return null;
                const outputIdentity = set.published.record.outputIdentity;
                const staged = set.artifact_binding.record.stagedPath;
                const identity = { dev: BigInt(outputIdentity.dev), ino: BigInt(outputIdentity.ino), size: BigInt(outputIdentity.size),
                    mtimeNs: BigInt(outputIdentity.mtimeNs), ctimeNs: BigInt(outputIdentity.ctimeNs) };
                const stagedRemoved = await unlinkStagedName(staged, identity, null);
                const stageRemoved = await removeEmptyDirectory(prepare.stagingDirectory, prepare.outputParent);
                const entries = [
                    stagedRemoved ? { path: staged, removed: true, reason: 'owned' } : await retainedEntry(staged, 'retained: not the second link of the output'),
                    stageRemoved ? { path: prepare.stagingDirectory, removed: true, reason: 'owned' } : await retainedEntry(prepare.stagingDirectory, 'retained: not empty'),
                    await retainedEntry(prepare.workCopyPath, 'retained: reconcile keeps the work copy'),
                ];
                await this.store.writeRasterRecord('cleanup', { ...common, recordType: 'cleanup', recordedAt: this.now(), disposition: 'published', entries });
                await this.store.releaseRasterSession(exportId);
                return 'published';
            }
            case 'W5':
            case 'W6': {
                if (set.host_terminal.state !== 'v2' || set.session.state !== 'v2')
                    return null;
                if (set.artifact_binding.state !== 'v2') {
                    return action === 'abandon' ? await fail('not_published', 'The export stopped after the copy was closed without a verified file; nothing was published.') : null;
                }
                const binding = set.artifact_binding.record;
                const session = set.session.record;
                const stat = async (path) => await lstat(path, { bigint: true }).catch((error) => {
                    if (error.code === 'ENOENT')
                        return null;
                    throw error;
                });
                const staged = await stat(binding.stagedPath);
                const output = await stat(prepare.outputPath);
                const isBound = (metadata) => metadata !== null && metadata.isFile() &&
                    String(metadata.dev) === binding.stagedIdentity.dev && String(metadata.ino) === binding.stagedIdentity.ino;
                const stagedUnlinked = isBound(staged) && staged.nlink === 1n;
                if (stagedUnlinked && output === null) {
                    return action === 'abandon' ? await fail('not_published', 'The export stopped after the copy was closed and before publication; nothing was published.') : null;
                }
                if (stagedUnlinked && output !== null && !isBound(output)) {
                    return action === 'abandon' || action === 'finalize'
                        ? await fail('output_exists', `Another file appeared at ${prepare.outputPath} before publication; it was not touched.`)
                        : null;
                }
                if (isBound(staged) && staged.nlink === 2n && isBound(output) && await hashWholeFile(prepare.outputPath) === binding.sha256) {
                    if (action !== 'finalize')
                        return null;
                    await this.store.writeRasterRecord('published', {
                        ...common, recordType: 'published', recordedAt: this.now(), bindingDigest: set.artifact_binding.digest, hostTerminalDigest: set.host_terminal.digest,
                        artifact: { path: prepare.outputPath, mediaType: binding.mediaType, bytes: binding.bytes, sha256: binding.sha256, width: binding.width, height: binding.height },
                        outputIdentity: serializeFileIdentity(fileIdentityOf(output)), sourcePath: prepare.sourcePath, artboardIndex: session.artboardIndex, options: session.options,
                    });
                    return await this.resolveWindow('W7', 'finalize', await this.store.readRasterRecordSet(exportId), prepare, common);
                }
                await this.store.writeRasterRecord('quarantine', { ...common, recordType: 'quarantine', recordedAt: this.now(), reason: 'the staged and output files match no §6.3.4 case' });
                return 'quarantined';
            }
            case 'W1':
            case 'W2':
            case 'W3':
            case 'W4':
                if (action !== 'abandon')
                    return null;
                return await fail(window === 'W1' ? 'open_not_completed' : window === 'W4' ? 'not_published' : 'unbound_artifact_or_not_exported', `The export stopped in ${window}; no file was published and the retained residue is kept as evidence.`);
            default:
                return null;
        }
    }
}
function rasterExtensionOf(set) {
    return set.session.state === 'v2' && set.session.record.options.format === 'jpeg' ? '.jpg' : '.png';
}
export class RasterPublishError extends Error {
    reason;
    constructor(reason, message) {
        super(message);
        this.reason = reason;
        this.name = 'RasterPublishError';
    }
}
export async function linkBoundArtifact(stagedPath, outputPath, bound, parentScope, linkImpl = link) {
    const handle = await open(stagedPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const before = await handle.stat({ bigint: true });
        if (!before.isFile() || before.nlink !== 1n || before.dev !== bound.identity.dev || before.ino !== bound.identity.ino || before.size !== bound.identity.size) {
            throw new RasterPublishError('file_replaced', `The staged file ${stagedPath} is no longer the bound artifact.`);
        }
        try {
            await linkImpl(stagedPath, outputPath);
        }
        catch (error) {
            const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
            if (code === 'EEXIST')
                throw new RasterPublishError('output_exists', `The output path already exists: ${outputPath}. Nothing was overwritten; the verified file remains at ${stagedPath}.`);
            if (code === 'EXDEV')
                throw new RasterPublishError('output_cross_device', 'The output path is on a different device from its staging directory.');
            throw error;
        }
        await parentScope.sync();
        const published = await open(outputPath, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            const metadata = await published.stat({ bigint: true });
            const bytes = await readBounded(published, RASTER_MAX_ARTIFACT_BYTES) ?? Buffer.alloc(0);
            if (!metadata.isFile() || metadata.dev !== before.dev || metadata.ino !== before.ino || metadata.nlink !== 2n ||
                createHash('sha256').update(bytes).digest('hex') !== bound.sha256) {
                throw new BackupCopyError('The published output does not resolve to the bound staged inode and bytes.');
            }
            return fileIdentityOf(metadata);
        }
        finally {
            await published.close();
        }
    }
    finally {
        await handle.close();
    }
}
async function unlinkStagedName(stagedPath, outputIdentity, parentScope) {
    let metadata;
    try {
        metadata = await lstat(stagedPath, { bigint: true });
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return false;
        throw error;
    }
    if (!metadata.isFile() || metadata.dev !== outputIdentity.dev || metadata.ino !== outputIdentity.ino || metadata.nlink !== 2n)
        return false;
    await parentScope?.assertStable();
    await unlink(stagedPath);
    await syncDirectory(dirname(stagedPath));
    return true;
}
