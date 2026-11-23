import { sameFilePath } from './file-path.js';
import { matchingDocumentPaths, withFilePathComparisons } from './file-path-identity.js';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, realpath, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { ARTBOARD_INTEGER_TOLERANCE } from './artboard-integer.js';
import { applyCommandIdSchema } from './command-id.js';
import { BackupCopyError, BackupPreconditionError, copyErrorCreatedDestination, copyFileExclusive, hostDocumentIdentitySchema, inspectSourceFile, resolveBackupRoot, sameFileOrSameBytes, serializeFileIdentity, verifyTrackedFile, withBackupRootScope, } from './document-backup.js';
import { assertOutputAbsent, EXPORT_CLOSE_WORK_COPY_SCRIPT, EXPORT_HELPERS, EXPORT_HOST_TIMEOUT_MS, EXPORT_INVENTORY_SCRIPT, EXPORT_OPEN_PRE_ATTEMPT_CODES, EXPORT_OPEN_WORK_COPY_SCRIPT, ExportPreconditionError, createOnceLinkAllowance, OutputPreLinkCheckError, parseExportHostError, STAGING_DIRECTORY_PREFIX, withOutputParentScope, workCopyFileName, } from './document-export.js';
import { documentKeyMatches } from './document-key.js';
import { DEFAULT_DURABLE_FILE_POLICY } from './durable-file-policy.js';
import { IndeterminateExecutionError } from './domain.js';
import { canonicalSha256 } from './mutation-canonical.js';
import { atomicCreatePrivateRecord, readSecurePrivateRecord } from './private-record.js';
import { currentUid, noFollowReadFlags } from './platform-primitives.js';
import { isMissingPath } from './private-state.js';
import { rasterQuarantinePaths } from './raster-export.js';
import { EXCLUDE_NON_PRINTING_LAYERS_DESCRIPTION, NON_PRINTING_LAYER_HELPERS } from './non-printing-layers.js';
import { RASTER_READ_LINKS_SCRIPT, admitLinkedFiles } from './raster-linked-files.js';
import { RASTER_BATCH_MAX_ITEMS, RASTER_BATCH_RECORD_MAX_BYTES, RASTER_BATCH_RECORD_SCHEMAS, RASTER_BATCH_SESSION_MAX_BYTES, rasterBatchSessionSchema, } from './raster-batch-export-records.js';
import { assessRasterRecordSet, RASTER_BATCH_EXPORT_KIND, RASTER_EXPORT_RECORD_SUFFIXES, RASTER_EXPORT_RECORD_VERSION, } from './raster-export-records.js';
import { inspectRasterArtifact, linkBoundArtifact, hashWholeFile, pathTaken, readBounded, rasterExtension, rasterExportInputSchema, RASTER_EXPORT_FAILED_CODE, RASTER_EXPORT_PRE_ATTEMPT_CODES, RASTER_MAX_ARTIFACT_BYTES, RASTER_READ_SOURCE_LAYERS_SCRIPT, RasterAfterHostError, RasterArtifactError, RasterPrepareRefusal, RasterPublishError, RasterStateChangedError, recordSetFingerprint, removeEmptyDirectory, removeOwnedFile, retainedEntry, syncDirectory, unlinkStagedName, WEB_RGB_PIXEL_CONTRACT, RASTER_EXPORT_TOOL, artifactSizeAdmitted, describeExpectedSize, nonPrintingWarnings, } from './raster-export.js';
export const RASTER_BATCH_PROFILE = 'raster_batch_export_v1';
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
export const rasterBatchInputSchema = z.strictObject({
    overwrite: z.literal(false).optional(),
    expected_document_key: z.string().min(1).max(16_384),
    format: z.enum(['png', 'jpeg']),
    output_dir: z.string().min(1).max(4_096),
    artboard_indexes: z.array(z.number().int().nonnegative()).min(1).max(1_000).optional(),
    all_artboards: z.literal(true).optional(),
    scale: z.union([z.literal(1), z.literal(2)]).optional(),
    transparent: z.boolean().optional(),
    quality: z.number().int().min(0).max(100).optional(),
    exclude_non_printing_layers: z.boolean().optional().describe(EXCLUDE_NON_PRINTING_LAYERS_DESCRIPTION),
    apply: z.boolean().default(false),
    command_id: applyCommandIdSchema.optional(),
    confirm_export_hash: sha256Schema.optional(),
}).superRefine((input, context) => {
    if ((input.artboard_indexes === undefined) === (input.all_artboards === undefined)) {
        context.addIssue({ code: 'custom', path: ['artboard_indexes'], message: 'Give exactly one of artboard_indexes and all_artboards.' });
    }
    if (input.artboard_indexes !== undefined && new Set(input.artboard_indexes).size !== input.artboard_indexes.length) {
        context.addIssue({ code: 'custom', path: ['artboard_indexes'], message: 'artboard_indexes must not repeat an index.' });
    }
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
export const rasterExportToolInputShape = {
    ...rasterExportInputSchema.shape,
    output_path: rasterExportInputSchema.shape.output_path.optional(),
    artboard_index: rasterExportInputSchema.shape.artboard_index.optional(),
    output_dir: z.string().min(1).max(4_096).optional().describe('Several artboards: existing folder; files <artboard name>.png/.jpg must not exist. Not with output_path.'),
    artboard_indexes: z.array(z.number().int().nonnegative()).min(1).max(1_000).optional().describe('Several artboards: indexes, at most 32.'),
    all_artboards: z.literal(true).optional().describe('Several artboards: all of them.'),
};
export function isBatchInput(input) {
    return input.output_dir !== undefined || input.artboard_indexes !== undefined || input.all_artboards !== undefined;
}
function optionsOf(input) {
    const scale = input.scale ?? 1;
    return input.format === 'png'
        ? { format: 'png', scale, transparent: input.transparent ?? true }
        : { format: 'jpeg', scale, quality: input.quality ?? 80 };
}
const NAME_MAX_BYTES = 255;
export function batchLeaf(name, format) {
    if (name.trim() === '')
        return { reason: 'name_empty', message: 'The artboard has no name to use as a file name.' };
    if (/[/:\u0000-\u001f\u007f]/u.test(name))
        return { reason: 'name_invalid_character', message: 'The artboard name contains "/", ":" or a control character.' };
    if (name.startsWith('.'))
        return { reason: 'name_leading_dot', message: 'The artboard name starts with ".", which would make a hidden file.' };
    if (name !== name.trim())
        return { reason: 'name_edge_space', message: 'The artboard name starts or ends with a space.' };
    const leaf = `${name}${rasterExtension(format)}`;
    if (Buffer.byteLength(leaf, 'utf8') > NAME_MAX_BYTES)
        return { reason: 'name_too_long', message: `The file name is longer than ${NAME_MAX_BYTES} bytes.` };
    return { leaf };
}
export const batchLeafKey = (leaf) => leaf.normalize('NFC').toLowerCase();
export const RASTER_BATCH_EXPORT_SCRIPT = `${EXPORT_HELPERS}
var batchTarget = exportRequireWorkCopy(params.workCopyPath, params.workCopyKey);
var batchDocument = batchTarget.doc;
if (app.activeDocument !== batchDocument) throw new Error("MCP_ERROR:" + stringifyJson({ code: "RASTER_WORK_COPY_NOT_ACTIVE" }));
var batchBoardsBefore = exportArtboards(batchDocument);
var batchBoardsChanged = batchBoardsBefore.length !== params.artboards.length;
for (var batchBoardCursor = 0; !batchBoardsChanged && batchBoardCursor < batchBoardsBefore.length; batchBoardCursor++) {
  var batchActual = batchBoardsBefore[batchBoardCursor];
  var batchExpected = params.artboards[batchBoardCursor];
  if (batchActual.name !== batchExpected.name) batchBoardsChanged = true;
  for (var batchEdge = 0; batchEdge < 4; batchEdge++) if (!exportEdgesEqual(batchActual.rect[batchEdge], batchExpected.rect[batchEdge])) batchBoardsChanged = true;
}
if (batchBoardsChanged) throw new Error("MCP_ERROR:" + stringifyJson({ code: "RASTER_ARTBOARDS_CHANGED", actual: batchBoardsBefore }));
for (var batchCheckCursor = 0; batchCheckCursor < params.items.length; batchCheckCursor++) {
  if (new File(params.items[batchCheckCursor].basePath).exists || new File(params.items[batchCheckCursor].stagedPath).exists) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "RASTER_STAGE_NOT_EMPTY" }));
  }
}
var batchPreviousInteraction = app.userInteractionLevel;
app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
try {
  for (var batchItemCursor = 0; batchItemCursor < params.items.length; batchItemCursor++) {
    var batchItem = params.items[batchItemCursor];
    var batchType;
    var batchOptions;
    if (params.format === "png") {
      batchType = ExportType.PNG24;
      batchOptions = new ExportOptionsPNG24();
      batchOptions.transparency = params.transparent === true;
    } else {
      batchType = ExportType.JPEG;
      batchOptions = new ExportOptionsJPEG();
      batchOptions.qualitySetting = params.quality;
    }
    batchOptions.artBoardClipping = true;
    batchOptions.antiAliasing = true;
    batchOptions.horizontalScale = params.scale * 100;
    batchOptions.verticalScale = params.scale * 100;
    batchDocument.artboards.setActiveArtboardIndex(batchItem.artboardIndex);
    try {
      batchDocument.exportFile(new File(batchItem.basePath), batchType, batchOptions);
    } catch (batchExportError) {
      throw new Error("MCP_ERROR:" + stringifyJson({ code: "RASTER_EXPORT_FAILED", message: "artboard " + batchItem.artboardIndex + ": " + String(batchExportError.message || batchExportError) }));
    }
  }
} finally {
  app.userInteractionLevel = batchPreviousInteraction;
}
var batchIndexAfter = -1;
for (var batchIndexCursor = 0; batchIndexCursor < app.documents.length; batchIndexCursor++) {
  if (app.documents[batchIndexCursor] === batchDocument) batchIndexAfter = batchIndexCursor;
}
if (batchIndexAfter < 0) throw new Error("MCP_ERROR:" + stringifyJson({ code: "RASTER_WORK_COPY_NOT_LISTED" }));
var result = {
  workCopy: getDocumentIdentity(batchDocument, batchIndexAfter),
  activeArtboardIndex: batchDocument.artboards.getActiveArtboardIndex(),
  artboards: exportArtboards(batchDocument),
  documentCount: app.documents.length
};
`;
export const RASTER_BATCH_EXPORT_EXCLUDING_SCRIPT = (() => {
    const helpered = RASTER_BATCH_EXPORT_SCRIPT.replace(EXPORT_HELPERS, `${EXPORT_HELPERS}${NON_PRINTING_LAYER_HELPERS}`);
    const hiding = helpered.replace('app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;\ntry {\n  for (var batchItemCursor', 'app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;\ntry {\n  try { nplScan(batchDocument, true); }\n' +
        '  catch (batchHideError) { throw new Error("MCP_ERROR:" + stringifyJson({ code: "RASTER_EXPORT_FAILED", message: "hiding non-printing layers: " + String(batchHideError.message || batchHideError) })); }\n  for (var batchItemCursor');
    if (helpered === RASTER_BATCH_EXPORT_SCRIPT || hiding === helpered)
        throw new Error('The raster batch export script no longer has the expected shape.');
    return hiding;
})();
function classifyBatchRecord(text, exportId, recordType) {
    let value;
    try {
        value = JSON.parse(text);
    }
    catch {
        return { state: 'invalid', reason: 'malformed_json' };
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return { state: 'invalid', reason: 'not_an_object' };
    const entry = value;
    if (entry.version !== RASTER_EXPORT_RECORD_VERSION)
        return { state: 'invalid', reason: 'unsupported_version' };
    if (entry.kind !== RASTER_BATCH_EXPORT_KIND)
        return { state: 'invalid', reason: 'unknown_kind' };
    if (entry.recordType !== recordType)
        return { state: 'invalid', reason: 'record_type_mismatch' };
    if (entry.exportId !== exportId)
        return { state: 'invalid', reason: 'export_id_mismatch' };
    const parsed = RASTER_BATCH_RECORD_SCHEMAS[recordType].safeParse(entry);
    return parsed.success ? { state: 'v2', record: parsed.data, digest: '' } : { state: 'invalid', reason: 'schema_invalid' };
}
export class RasterBatchRecordStore {
    store;
    constructor(store) {
        this.store = store;
    }
    async write(recordType, record) {
        const validated = RASTER_BATCH_RECORD_SCHEMAS[recordType].parse(record);
        const contents = `${JSON.stringify(validated, null, 2)}\n`;
        if (Buffer.byteLength(contents) > RASTER_BATCH_RECORD_MAX_BYTES)
            throw new Error('The export record exceeds its size limit.');
        const path = this.store.rasterRecordPath(validated.exportId, recordType);
        await atomicCreatePrivateRecord(path, contents);
        return { path, digest: createHash('sha256').update(contents).digest('hex') };
    }
    async openSession(session) {
        const contents = `${JSON.stringify(rasterBatchSessionSchema.parse(session), null, 2)}\n`;
        if (Buffer.byteLength(contents) > RASTER_BATCH_SESSION_MAX_BYTES)
            throw new Error('The export session exceeds its size limit.');
        const path = this.store.sessionPath(session.exportId);
        await atomicCreatePrivateRecord(path, contents);
        return path;
    }
    async read(exportId, recordType) {
        const path = this.store.rasterRecordPath(exportId, recordType);
        let record;
        try {
            record = await readSecurePrivateRecord(path, RASTER_BATCH_RECORD_MAX_BYTES, { maxLinkCount: await createOnceLinkAllowance(path) });
        }
        catch (error) {
            if (isMissingPath(error))
                return { state: 'absent' };
            throw error;
        }
        if (record.state === 'missing')
            return { state: 'absent' };
        if (record.state === 'invalid')
            return { state: 'invalid', reason: 'unsafe_file' };
        const entry = classifyBatchRecord(record.text, exportId, recordType);
        return entry.state === 'v2' ? { ...entry, digest: createHash('sha256').update(record.bytes).digest('hex') } : entry;
    }
    async readRasterRecordSet(exportId) {
        const types = Object.keys(RASTER_EXPORT_RECORD_SUFFIXES);
        const reads = await Promise.all(types.map(async (type) => [type, await this.read(exportId, type)]));
        return Object.fromEntries(reads);
    }
    async release(exportId) {
        await this.store.releaseRasterSession(exportId);
    }
}
export async function isBatchExportId(store, exportId) {
    const entry = await store.readSessionEntry(exportId);
    if (entry?.format === 'invalid' && entry.reason === 'raster_batch_export')
        return true;
    if (entry !== null)
        return false;
    const set = await new RasterBatchRecordStore(store).readRasterRecordSet(exportId);
    return Object.values(set).some((read) => read.state === 'v2');
}
const isBound = (metadata, identity) => metadata !== null && metadata.isFile() && String(metadata.dev) === identity.dev && String(metadata.ino) === identity.ino;
const lstatOrNull = async (path) => await lstat(path, { bigint: true }).catch((error) => {
    if (error.code === 'ENOENT')
        return null;
    throw error;
});
export async function classifyPublication(item, verifyHash) {
    const staged = await lstatOrNull(item.stagedPath);
    const output = await lstatOrNull(item.outputPath);
    if (isBound(staged, item.stagedIdentity) && staged.nlink === 1n) {
        if (output === null)
            return 'S1';
        return isBound(output, item.stagedIdentity) ? 'other' : 'X';
    }
    if (isBound(staged, item.stagedIdentity) && staged.nlink === 2n && isBound(output, item.stagedIdentity) && output.nlink === 2n) {
        if (verifyHash && await hashWholeFile(item.outputPath) !== item.sha256)
            return 'other';
        return 'L';
    }
    return 'other';
}
export async function removeLinkedOutput(item) {
    let handle;
    try {
        handle = await open(item.outputPath, noFollowReadFlags());
    }
    catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ELOOP')
            return false;
        throw error;
    }
    try {
        const before = await handle.stat({ bigint: true });
        if (!before.isFile() || String(before.dev) !== item.stagedIdentity.dev || String(before.ino) !== item.stagedIdentity.ino ||
            before.nlink !== 2n || String(before.size) !== item.stagedIdentity.size)
            return false;
        const bytes = await readBounded(handle, RASTER_MAX_ARTIFACT_BYTES);
        if (bytes === null || createHash('sha256').update(bytes).digest('hex') !== item.sha256)
            return false;
        await unlink(item.outputPath);
        if ((await handle.stat({ bigint: true })).nlink !== 1n)
            throw new Error(`${item.outputPath} kept another link after the unlink.`);
    }
    finally {
        await handle.close();
    }
    await syncDirectory(dirname(item.outputPath));
    return true;
}
export async function rollbackPublished(items) {
    const removed = [];
    const unproven = [];
    for (const item of [...items].reverse()) {
        const state = await classifyPublication(item, false);
        if (state === 'L') {
            if (await removeLinkedOutput(item))
                removed.push(item.artboardIndex);
            else
                unproven.push(item.artboardIndex);
        }
        else if (state === 'other') {
            unproven.push(item.artboardIndex);
        }
    }
    return { removed, unproven };
}
export async function removeBoundStagedFile(path, identity) {
    let handle;
    try {
        handle = await open(path, noFollowReadFlags());
    }
    catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ELOOP')
            return false;
        throw error;
    }
    try {
        const before = await handle.stat({ bigint: true });
        if (!before.isFile() || String(before.dev) !== identity.dev || String(before.ino) !== identity.ino || String(before.size) !== identity.size || before.nlink !== 1n)
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
export const deserializeIdentity = (identity) => ({ dev: BigInt(identity.dev), ino: BigInt(identity.ino), size: BigInt(identity.size), mtimeNs: BigInt(identity.mtimeNs), ctimeNs: BigInt(identity.ctimeNs) });
export async function validateOutputDirectory(directory, stateRoot) {
    const invalid = (message) => new ExportPreconditionError('output_path_invalid', message);
    if (!isAbsolute(directory))
        throw invalid('output_dir must be an absolute path.');
    if (directory !== resolve(directory) || directory.endsWith('/'))
        throw invalid('output_dir must be a normalized folder path without a trailing slash.');
    let real;
    try {
        real = await realpath(directory);
    }
    catch (error) {
        throw invalid(`The output folder could not be resolved: ${error instanceof Error ? error.message : String(error)}`);
    }
    let resolvedStateRoot = null;
    try {
        resolvedStateRoot = await realpath(stateRoot);
    }
    catch {
        resolvedStateRoot = null;
    }
    if (resolvedStateRoot !== null && (real === resolvedStateRoot || real.startsWith(`${resolvedStateRoot}/`)))
        throw invalid('output_dir must not be inside the MCP state root.');
    const metadata = await lstat(real);
    if (!metadata.isDirectory())
        throw invalid('output_dir is not a directory.');
    if (metadata.uid !== currentUid() && metadata.uid !== 0)
        throw invalid('The output folder is owned by another user.');
    if ((metadata.mode & 0o022) !== 0 && (metadata.mode & 0o1000) === 0) {
        throw invalid('The output folder is writable by group or others without the sticky bit, so another account could replace the output.');
    }
    return real;
}
export class RasterBatchExportOperation {
    deps;
    contract;
    now;
    records;
    constructor(deps) {
        this.deps = deps;
        this.contract = deps.dimensionContract ?? WEB_RGB_PIXEL_CONTRACT;
        this.now = deps.now ?? (() => new Date());
        this.records = new RasterBatchRecordStore(deps.exportStore);
    }
    async host(meter, command) {
        const started = performance.now();
        meter.calls += 1;
        try {
            return (await (this.deps.executeHost === undefined
                ? this.deps.bridge.execute(withFilePathComparisons(command))
                : this.deps.executeHost(command))).data;
        }
        finally {
            meter.ms += performance.now() - started;
        }
    }
    async run(raw) {
        const started = performance.now();
        const meter = { calls: 0, ms: 0 };
        const input = rasterBatchInputSchema.parse(raw);
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
            output_dir: input.output_dir,
            artboard_indexes: plan.items.map((item) => item.artboard.index),
            scale: plan.options.scale,
            ...(plan.options.format === 'png' ? { transparent: plan.options.transparent } : { quality: plan.options.quality }),
            ...(plan.excludeNonPrintingLayers ? { exclude_non_printing_layers: true } : {}),
            apply: true,
            command_id: randomUUID(),
            confirm_export_hash: plan.digest,
        };
        return {
            outcome: 'planned_batch', options: plan.options,
            items: plan.items.map(({ artboard, outputPath, expected, expectedRange, roundedEdges, edgeWarnings }) => ({ artboard, outputPath, expected, ...(expectedRange === undefined ? {} : { expectedRange }), ...(roundedEdges === undefined ? {} : { roundedEdges }), ...(edgeWarnings === undefined ? {} : { edgeWarnings }) })),
            ...(plan.links.length === 0 ? {} : { links: plan.links }),
            ...nonPrintingWarnings(plan.source.nonPrintingLayers, plan.excludeNonPrintingLayers),
            planDigest: plan.digest, nextCall: { tool: RASTER_EXPORT_TOOL, arguments: args },
        };
    }
    async plan(input, meter) {
        const result = (value) => ({ kind: 'result', result: value });
        let source;
        try {
            source = await this.host(meter, {
                kind: 'read',
                script: RASTER_READ_SOURCE_LAYERS_SCRIPT,
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
        const admitLinks = async () => {
            try {
                return await admitLinkedFiles({
                    placedItems: source.placedItems, documentKey: document.key,
                    readLinks: async () => await this.host(meter, {
                        kind: 'read', script: RASTER_READ_LINKS_SCRIPT, params: { expectedDocumentKey: input.expected_document_key },
                        hostGate: { beforeHost: async () => { await this.deps.assertNoUnresolvedLease(); } },
                    }),
                });
            }
            catch (error) {
                if (parseExportHostError(error)?.code === 'DOCUMENT_MISMATCH')
                    return { kind: 'rejected', reason: 'document_key_mismatch', message: 'The active document key does not match expected_document_key.' };
                throw error;
            }
        };
        let linked = null;
        if (!document.saved) {
            if (source.placedItems > 0) {
                linked = await admitLinks();
                if (linked.kind === 'rejected' && linked.reason === 'linked_file_unavailable')
                    return result(this.rejected(linked.reason, linked.message, document));
            }
            return result(this.rejected('document_dirty', 'この書き出しでは未保存の変更を含められません。現在の内容を書き出すには、変更を保存してからもう一度お試しください。元ファイルを更新したくない場合は、別名で保存した文書から書き出してください。', document));
        }
        if (document.mutationProfile !== 'saved_file') {
            return result(this.rejected('document_not_admitted', document.mutationBlockedReason ?? 'The document is not a saved, file-backed document.', document));
        }
        if (document.colorSpace !== 'RGB')
            return result(this.rejected('color_space_not_admitted', 'Only RGB documents are measured for this export.', document));
        linked ??= await admitLinks();
        if (linked.kind === 'rejected')
            return result(this.rejected(linked.reason, linked.message, document));
        const indexes = input.all_artboards === true ? source.artboards.map((board) => board.index) : input.artboard_indexes;
        if (indexes.length > RASTER_BATCH_MAX_ITEMS) {
            return result(this.rejected('too_many_artboards', `${indexes.length} artboards were requested; at most ${RASTER_BATCH_MAX_ITEMS} are exported in one call.`, document));
        }
        let sourceFile;
        let parent;
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
            parent = await validateOutputDirectory(input.output_dir, this.deps.exportStore.stateRootPath);
        }
        catch (error) {
            if (error instanceof BackupPreconditionError)
                return result(this.rejected('source_file_unavailable', error.message, document));
            if (error instanceof ExportPreconditionError)
                return result(this.rejected('output_dir_invalid', error.message, document));
            throw error;
        }
        const options = optionsOf(input);
        const blocked = [];
        const items = [];
        const leafCounts = new Map();
        const evaluated = indexes.map((index) => {
            const artboard = source.artboards[index];
            if (artboard === undefined)
                return { index, artboard: null, name: '', leaf: null, problem: { reason: 'artboard_out_of_range', message: `artboard index ${index} is outside the ${source.artboards.length} artboard(s).` } };
            const named = batchLeaf(artboard.name, options.format);
            return { index, artboard, name: artboard.name, leaf: 'leaf' in named ? named.leaf : null, problem: 'leaf' in named ? null : named };
        });
        for (const entry of evaluated) {
            if (entry.leaf === null || entry.problem !== null)
                continue;
            const key = batchLeafKey(entry.leaf);
            leafCounts.set(key, [...(leafCounts.get(key) ?? []), entry.index]);
        }
        for (const entry of evaluated) {
            const refuse = (reason, message) => blocked.push({ artboardIndex: entry.index, name: entry.name, leaf: entry.leaf, reason, message });
            if (entry.artboard === null || entry.problem !== null) {
                refuse(entry.problem.reason, entry.problem.message);
                continue;
            }
            const same = leafCounts.get(batchLeafKey(entry.leaf)) ?? [];
            if (same.length > 1) {
                refuse('name_duplicate', `The file name ${entry.leaf} is also the name of artboard ${same.filter((other) => other !== entry.index).join(', ')}.`);
                continue;
            }
            const outputPath = join(parent, entry.leaf);
            try {
                await assertOutputAbsent(outputPath);
            }
            catch (error) {
                if (!(error instanceof ExportPreconditionError))
                    throw error;
                refuse(error.reason === 'output_exists' ? 'output_exists' : 'output_path_invalid', error.message);
                continue;
            }
            const dimensions = this.contract({ options, artboard: { index: entry.artboard.index, rect: entry.artboard.rect, origin: entry.artboard.origin }, documentRulerOrigin: source.rulerOrigin });
            if (dimensions.status === 'unsupported') {
                refuse(dimensions.reason, dimensions.message);
                continue;
            }
            items.push({
                artboard: entry.artboard, leaf: entry.leaf, outputPath, stagedBasePath: '', stagedPath: '',
                expected: { width: dimensions.width, height: dimensions.height },
                ...(dimensions.range === undefined ? {} : { expectedRange: dimensions.range }),
                ...(dimensions.roundedEdges === undefined ? {} : { roundedEdges: dimensions.roundedEdges }),
                ...(dimensions.edgeWarnings === undefined ? {} : { edgeWarnings: dimensions.edgeWarnings }),
            });
        }
        if (blocked.length > 0) {
            return result({
                outcome: 'blocked', reason: 'batch_items_blocked', document, items: blocked,
                message: `${blocked.length} of ${indexes.length} artboard(s) cannot be exported; nothing is written. See items.`,
            });
        }
        const digest = canonicalSha256({
            profile: RASTER_BATCH_PROFILE,
            appVersion: document.appVersion,
            source: { key: document.key, path: sourceFile.path, fileRevision: document.fileRevision, sha256: sourceFile.sha256, identity: serializeFileIdentity(sourceFile.identity) },
            artboards: source.artboards,
            rulerOrigin: source.rulerOrigin,
            ...(linked.binding.length === 0 ? {} : { links: linked.binding }),
            ...(input.exclude_non_printing_layers === true ? { excludeNonPrintingLayers: true } : {}),
            destination: { parent },
            items: items.map((item) => ({ index: item.artboard.index, leaf: item.leaf, expected: item.expected, ...(item.expectedRange === undefined ? {} : { expectedRange: item.expectedRange }) })),
            options,
        });
        return { kind: 'plan', plan: { document, source, options, sourceFile, parent, items, links: linked.links, linkBinding: linked.binding, excludeNonPrintingLayers: input.exclude_non_printing_layers === true, digest } };
    }
    async existingOutcome(exportId, planDigest) {
        if (await pathTaken(rasterQuarantinePaths(this.deps.exportStore.stateRootPath, exportId).manifest)) {
            return this.rejected('export_records_invalid', `The records of export ${exportId} were moved to quarantine; use a new command_id.`);
        }
        const set = await this.records.readRasterRecordSet(exportId);
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
        return {
            outcome: 'failed', exportId: failed.exportId, delivery, stage: failed.stage, reason: failed.reason, message: failed.message,
            cleanup: this.cleanupEntries(set), itemIndex: failed.itemIndex,
        };
    }
    async replayPublished(exportId, set) {
        if (set.published.state !== 'v2')
            throw new Error('No published record.');
        const published = set.published.record;
        const started = performance.now();
        for (const item of published.items) {
            let handle;
            try {
                handle = await open(item.artifact.path, noFollowReadFlags());
            }
            catch {
                return this.rejected('artifact_unavailable', `The exported file ${item.artifact.path} (artboard ${item.artboardIndex}) is gone; nothing is exported again.`);
            }
            try {
                const metadata = await handle.stat({ bigint: true });
                const recorded = item.outputIdentity;
                const sameInode = metadata.isFile() && String(metadata.dev) === recorded.dev && String(metadata.ino) === recorded.ino && String(metadata.size) === recorded.size;
                const bytes = sameInode ? await readBounded(handle, RASTER_MAX_ARTIFACT_BYTES) : null;
                if (bytes === null || createHash('sha256').update(bytes).digest('hex') !== item.artifact.sha256) {
                    return this.rejected('artifact_identity_mismatch', `The file at ${item.artifact.path} (artboard ${item.artboardIndex}) is no longer the exported file; nothing is exported again.`);
                }
            }
            finally {
                await handle.close();
            }
        }
        return {
            outcome: 'verified_batch', exportId, delivery: 'replay', sourcePreserved: true, cleanup: this.cleanupEntries(set),
            artifacts: published.items.map((item) => ({ artboardIndex: item.artboardIndex, ...item.artifact })),
            timing: { totalMs: performance.now() - started, hostCalls: 0, hostMs: 0 },
        };
    }
    async apply(exportId, plan, meter, started) {
        const store = this.deps.exportStore;
        const records = this.records;
        const recordedAt = () => this.now().toISOString();
        const common = { version: RASTER_EXPORT_RECORD_VERSION, kind: RASTER_BATCH_EXPORT_KIND, exportId, planDigest: plan.digest };
        let stage = 'prepare';
        let prepared = false;
        let leaseHeld = false;
        let fingerprint = null;
        const refresh = async () => { fingerprint = recordSetFingerprint(await records.readRasterRecordSet(exportId)); };
        const assertUnchanged = async () => {
            if (recordSetFingerprint(await records.readRasterRecordSet(exportId)) !== fingerprint) {
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
                const set = await records.readRasterRecordSet(exportId).catch(() => null);
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
        return await withBackupRootScope(exportRoot, async (rootScope) => await withOutputParentScope(plan.parent, async (parentScope) => {
            const workCopyPath = join(exportRoot, workCopyFileName(exportId, plan.sourceFile.path));
            const stagingDirectory = join(plan.parent, `${STAGING_DIRECTORY_PREFIX}${exportId}`);
            const items = plan.items.map((item) => {
                const stagedBasePath = join(stagingDirectory, `artifact-${item.artboard.index}`);
                return { ...item, stagedBasePath, stagedPath: `${stagedBasePath}${rasterExtension(plan.options.format)}` };
            });
            const sessionPaths = [workCopyPath, ...items.map((item) => item.stagedPath), ...items.map((item) => item.outputPath)];
            const parentIdentity = await lstat(plan.parent, { bigint: true });
            const boards = plan.source.artboards.map(({ index, name, rect }) => ({ index, name, rect }));
            const assertOutputsAbsent = async () => { for (const item of items)
                await assertOutputAbsent(item.outputPath); };
            let copied = null;
            const ownedWorkCopy = () => [{ path: workCopyPath, remove: async () => copied === null ? false : await removeOwnedFile(workCopyPath, copied.identity) }];
            stage = 'open_work_copy';
            let opened;
            try {
                opened = await this.host(meter, {
                    kind: 'read',
                    script: EXPORT_OPEN_WORK_COPY_SCRIPT,
                    params: { expectedDocumentKey: plan.document.key, workCopyPath, stagedPath: items[0].stagedPath, outputPath: items[0].outputPath, sessionPaths },
                    timeoutMs: EXPORT_HOST_TIMEOUT_MS,
                    hostGate: {
                        beforeHost: async ({ commandId }) => {
                            await this.deps.assertNoUnresolvedLease();
                            await rootScope.assertStable();
                            await parentScope.assertStable();
                            if (assessRasterRecordSet(await records.readRasterRecordSet(exportId)).state !== 'none') {
                                throw new RasterPrepareRefusal('command_id_in_use', `command_id ${exportId} was used meanwhile; use a new command_id.`);
                            }
                            if (await pathTaken(workCopyPath) || await pathTaken(stagingDirectory)) {
                                throw new RasterPrepareRefusal('command_id_in_use', `command_id ${exportId} already has a work copy or stage; use a new command_id.`);
                            }
                            await assertOutputsAbsent();
                            await records.write('prepare', {
                                ...common, recordType: 'prepare', recordedAt: recordedAt(),
                                sourcePath: plan.sourceFile.path, sourceSha256: plan.sourceFile.sha256, sourceIdentity: serializeFileIdentity(plan.sourceFile.identity),
                                workCopyPath, stagingDirectory, outputParent: plan.parent,
                                outputParentIdentity: { dev: String(parentIdentity.dev), ino: String(parentIdentity.ino) },
                                items: items.map((item) => ({ artboardIndex: item.artboard.index, leaf: item.leaf, outputPath: item.outputPath, stagedPath: item.stagedPath })),
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
                            for (const item of items)
                                await assertOutputAbsent(item.stagedPath);
                            await records.openSession({
                                version: RASTER_EXPORT_RECORD_VERSION, kind: RASTER_BATCH_EXPORT_KIND, recordType: 'session', exportId, commandId: exportId,
                                planDigest: plan.digest, openCommandId: commandId, documentKey: plan.document.key, sourcePath: plan.sourceFile.path,
                                sourceSha256: plan.sourceFile.sha256, sourceIdentity: serializeFileIdentity(plan.sourceFile.identity), options: plan.options,
                                workCopyPath, workCopyIdentity: serializeFileIdentity(copy.identity), stagingDirectory,
                                items: items.map((item) => ({
                                    artboardIndex: item.artboard.index, leaf: item.leaf, outputPath: item.outputPath,
                                    stagedBasePath: item.stagedBasePath, stagedPath: item.stagedPath, expected: item.expected,
                                })),
                                createdAt: recordedAt(),
                            });
                            leaseHeld = true;
                            await refresh();
                        },
                        afterHost: async ({ commandId, data }) => await recorded('open', commandId, async () => {
                            const result = data;
                            if ((result.opened.path === null || !sameFilePath(result.opened.path, workCopyPath)) || result.documentCountAfter !== result.documentCountBefore + 1 ||
                                result.source.key !== plan.document.key || result.opened.key === plan.document.key) {
                                throw new Error('Illustrator reported an unexpected document inventory after opening the work copy.');
                            }
                            await assertUnchanged();
                            await records.write('host_open', {
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
            stage = 'export';
            let failure = null;
            let artifacts = null;
            let closeKey = opened.opened.key;
            try {
                const exported = await this.host(meter, {
                    kind: 'read',
                    script: plan.excludeNonPrintingLayers ? RASTER_BATCH_EXPORT_EXCLUDING_SCRIPT : RASTER_BATCH_EXPORT_SCRIPT,
                    params: {
                        workCopyPath, workCopyKey: opened.opened.key, artboards: boards,
                        items: items.map((item) => ({ artboardIndex: item.artboard.index, basePath: item.stagedBasePath, stagedPath: item.stagedPath })),
                        format: plan.options.format, scale: plan.options.scale,
                        transparent: plan.options.format === 'png' ? plan.options.transparent : false,
                        quality: plan.options.format === 'jpeg' ? plan.options.quality : 0,
                        excludeNonPrintingLayers: plan.excludeNonPrintingLayers,
                    },
                    timeoutMs: EXPORT_HOST_TIMEOUT_MS,
                    hostGate: {
                        beforeHost: async () => {
                            await rootScope.assertStable();
                            await parentScope.assertStable();
                            await assertOutputsAbsent();
                            await assertUnchanged();
                        },
                        afterHost: async ({ commandId, data }) => await recorded('export', commandId, async () => {
                            const result = data;
                            if ((result.workCopy.path === null || !sameFilePath(result.workCopy.path, workCopyPath)) || result.activeArtboardIndex !== items[items.length - 1].artboard.index) {
                                throw new Error('Illustrator reported an unexpected work-copy state after the export.');
                            }
                            await assertUnchanged();
                            if (!sameBoards(result.artboards, boards)) {
                                failure = { stage: 'verify_output', reason: 'artboards_changed', message: 'The artboards of the work copy changed during the export.' };
                                return;
                            }
                            const verified = await this.verifyStage(stagingDirectory, items);
                            if ('failure' in verified) {
                                failure = verified.failure;
                                return;
                            }
                            const session = await records.read(exportId, 'session');
                            if (session.state !== 'v2')
                                throw new Error('The lease could not be read back before binding.');
                            await records.write('artifact_binding', {
                                ...common, recordType: 'artifact_binding', recordedAt: recordedAt(), export: { commandId, completedInactive: true }, sessionDigest: session.digest,
                                items: verified.artifacts.map((artifact, position) => ({
                                    artboardIndex: items[position].artboard.index, stagedPath: items[position].stagedPath, stagedIdentity: serializeFileIdentity(artifact.identity),
                                    mediaType: artifact.mediaType, bytes: artifact.bytes, sha256: artifact.sha256, width: artifact.width, height: artifact.height,
                                })),
                                copyAfterExport: { identity: hostDocumentIdentitySchema.parse(result.workCopy), activeArtboardIndex: result.activeArtboardIndex, artboards: result.artboards },
                            });
                            artifacts = verified.artifacts;
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
                            if (result.documentCount !== opened.documentCountBefore || (result.closedBeforeClose.path === null || !sameFilePath(result.closedBeforeClose.path, workCopyPath)) || result.source.key !== plan.document.key) {
                                throw new Error('Illustrator reported an unexpected document inventory after closing the work copy.');
                            }
                            await assertUnchanged();
                            if ((await matchingDocumentPaths(result, sessionPaths)).length !== 0)
                                throw new Error('A session document remains open; the export evidence is kept.');
                            await records.write('host_terminal', {
                                ...common, recordType: 'host_terminal', recordedAt: recordedAt(), close: { commandId, completedInactive: true },
                                closedBeforeClose: hostDocumentIdentitySchema.parse(result.closedBeforeClose), sourceKey: result.source.key,
                                sourceSaved: true, sourceFileRevision: plan.document.fileRevision, documentCount: result.documentCount,
                            });
                            stage = 'verify_source';
                            try {
                                const after = await inspectSourceFile(plan.sourceFile.path);
                                if (after.path !== plan.sourceFile.path || !await sameFileOrSameBytes(plan.sourceFile.path, after.identity, plan.sourceFile.identity, plan.sourceFile.sha256)) {
                                    failure ??= { stage, reason: 'source_changed', message: 'The source file changed during the export.' };
                                }
                            }
                            catch (error) {
                                if (!(error instanceof BackupPreconditionError))
                                    throw error;
                                failure ??= { stage, reason: 'source_changed', message: error.message };
                            }
                            const bound = artifacts;
                            if (failure !== null || bound === null) {
                                outcome = await this.recordFailure(exportId, common, failure ?? { stage, reason: 'output_verification_failed', message: 'The export produced no verified file.' }, [], ownedWorkCopy());
                                return;
                            }
                            stage = 'publish_output';
                            await rootScope.assertStable();
                            await parentScope.assertStable();
                            const boundItems = items.map((item, position) => ({
                                artboardIndex: item.artboard.index, stagedPath: item.stagedPath, outputPath: item.outputPath,
                                stagedIdentity: serializeFileIdentity(bound[position].identity), sha256: bound[position].sha256,
                            }));
                            try {
                                await (this.deps.durableFilePolicy ?? DEFAULT_DURABLE_FILE_POLICY).checkOutputParentCheckpoint('beforeLink', parentScope, { staging: stagingDirectory, files: items.map((item) => item.stagedPath) });
                            }
                            catch (error) {
                                if (!(error instanceof OutputPreLinkCheckError))
                                    throw error;
                                outcome = await this.recordFailure(exportId, common, { stage: 'pre_link_check', reason: 'output_verification_failed', message: error.message }, [], ownedWorkCopy());
                                return;
                            }
                            const identities = [];
                            let publishFailure = null;
                            for (const [position, item] of items.entries()) {
                                await parentScope.assertStable();
                                try {
                                    identities.push(await linkBoundArtifact(item.stagedPath, item.outputPath, bound[position], parentScope));
                                }
                                catch (error) {
                                    if (error instanceof RasterPublishError)
                                        publishFailure = { stage, reason: error.reason, message: error.message, itemIndex: item.artboard.index };
                                    else if (error instanceof BackupCopyError)
                                        publishFailure = { stage, reason: 'file_replaced', message: error.message, itemIndex: item.artboard.index };
                                    else
                                        throw error;
                                    break;
                                }
                            }
                            if (publishFailure !== null) {
                                stage = 'rollback_publish';
                                const { removed, unproven } = await rollbackPublished(boundItems);
                                if (unproven.length > 0) {
                                    await records.write('quarantine', {
                                        ...common, recordType: 'quarantine', recordedAt: recordedAt(),
                                        reason: `the rollback of a partial publication could not prove artboard(s) ${unproven.join(', ')} to be this export's files`,
                                    });
                                    outcome = indeterminate(`The publication stopped (${publishFailure.message}) and artboard(s) ${unproven.join(', ')} could not be proven to be this export's files; ` +
                                        'they were not touched and the export is quarantined. Check the output folder, then run illustrator_reconcile_export.');
                                    return;
                                }
                                const cleaned = boundItems.map((item) => ({
                                    path: item.stagedPath, remove: async () => await removeBoundStagedFile(item.stagedPath, item.stagedIdentity),
                                }));
                                outcome = await this.recordFailure(exportId, common, publishFailure, removed.map((artboardIndex) => ({ artboardIndex, outputPath: items.find((item) => item.artboard.index === artboardIndex).outputPath })), [...cleaned, { path: stagingDirectory, remove: async () => await removeEmptyDirectory(stagingDirectory, plan.parent) }, ...ownedWorkCopy()]);
                                return;
                            }
                            const set = await records.readRasterRecordSet(exportId);
                            if (set.artifact_binding.state !== 'v2' || set.host_terminal.state !== 'v2')
                                throw new Error('The binding or host evidence could not be read back before publishing.');
                            const publishedItems = items.map((item, position) => ({
                                artboardIndex: item.artboard.index,
                                artifact: { path: item.outputPath, mediaType: bound[position].mediaType, bytes: bound[position].bytes, sha256: bound[position].sha256, width: bound[position].width, height: bound[position].height },
                                outputIdentity: serializeFileIdentity(identities[position]),
                            }));
                            await records.write('published', {
                                ...common, recordType: 'published', recordedAt: recordedAt(), bindingDigest: set.artifact_binding.digest,
                                hostTerminalDigest: set.host_terminal.digest, items: publishedItems, sourcePath: plan.sourceFile.path, options: plan.options,
                            });
                            stage = 'cleanup';
                            const entries = await this.cleanup([
                                ...items.map((item, position) => ({ path: item.stagedPath, remove: async () => await unlinkStagedName(item.stagedPath, identities[position], parentScope) })),
                                { path: stagingDirectory, remove: async () => await removeEmptyDirectory(stagingDirectory, plan.parent) },
                                ...ownedWorkCopy(),
                            ]);
                            await records.write('cleanup', { ...common, recordType: 'cleanup', recordedAt: recordedAt(), disposition: 'published', entries });
                            await records.release(exportId);
                            outcome = {
                                outcome: 'verified_batch', exportId, delivery: 'original', sourcePreserved: true, cleanup: entries,
                                artifacts: publishedItems.map((item) => ({ artboardIndex: item.artboardIndex, ...item.artifact })),
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
            return final.outcome === 'verified_batch'
                ? { ...final, timing: { totalMs: performance.now() - started, hostCalls: meter.calls, hostMs: meter.ms } }
                : final;
        }));
    }
    async verifyStage(stagingDirectory, items) {
        const stage = 'verify_output';
        const names = (await readdir(stagingDirectory)).sort();
        const expectedNames = items.map((item) => basename(item.stagedPath)).sort();
        if (names.length !== expectedNames.length || names.some((name, position) => name !== expectedNames[position])) {
            return { failure: { stage, reason: 'unexpected_output_files', message: `The stage holds ${JSON.stringify(names)} instead of ${JSON.stringify(expectedNames)}.` } };
        }
        const artifacts = [];
        for (const item of items) {
            let artifact;
            try {
                artifact = await inspectRasterArtifact(item.stagedPath, plannedFormat(item.stagedPath));
            }
            catch (error) {
                if (error instanceof RasterArtifactError)
                    return { failure: { stage, reason: 'output_verification_failed', message: `Artboard ${item.artboard.index}: ${error.message}`, itemIndex: item.artboard.index } };
                throw error;
            }
            if (!artifactSizeAdmitted(artifact, item.expected, item.expectedRange)) {
                return { failure: { stage, reason: 'dimension_mismatch', message: `Artboard ${item.artboard.index}: the file is ${artifact.width}x${artifact.height} px; the contract expects ${describeExpectedSize(item.expected, item.expectedRange)}.`, itemIndex: item.artboard.index } };
            }
            artifacts.push(artifact);
        }
        await syncDirectory(stagingDirectory);
        return { artifacts };
    }
    async cleanup(targets) {
        const entries = [];
        for (const target of targets) {
            const removed = await target.remove();
            entries.push(removed ? { path: target.path, removed, reason: 'owned' } : await retainedEntry(target.path, 'retained: ownership not proven'));
        }
        return entries;
    }
    async recordFailure(exportId, common, failure, rolledBack, owned) {
        const set = await this.records.readRasterRecordSet(exportId);
        const evidenceDigests = {};
        for (const [type, read] of Object.entries(set))
            if (read.state === 'v2')
                evidenceDigests[type] = read.digest;
        await this.records.write('failed', {
            ...common, recordType: 'failed', recordedAt: this.now().toISOString(), stage: failure.stage, reason: failure.reason, message: failure.message,
            itemIndex: failure.itemIndex ?? null, rolledBack, evidenceDigests,
        });
        const entries = await this.cleanup(owned);
        await this.records.write('cleanup', { ...common, recordType: 'cleanup', recordedAt: this.now().toISOString(), disposition: 'failed', entries });
        await this.records.release(exportId);
        return this.failedResult(await this.records.readRasterRecordSet(exportId), 'original');
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
                        outcome = await this.recordFailure(exportId, common, failure, [], owned);
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
const plannedFormat = (stagedPath) => stagedPath.endsWith('.png') ? 'png' : 'jpeg';
function sameBoards(actual, expected) {
    return actual.length === expected.length && actual.every((board, position) => {
        const other = expected[position];
        return board.name === other.name && board.rect.length === other.rect.length && board.rect.every((edge, side) => Math.abs(edge - other.rect[side]) <= ARTBOARD_INTEGER_TOLERANCE);
    });
}
