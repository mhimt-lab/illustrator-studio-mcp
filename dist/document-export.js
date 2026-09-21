import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, realpath, rmdir, unlink } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { documentContextSchema } from './mutation-result-schema-core.js';
import { BackupCopyError, captureFileIdentity, fileIdentitySchema, hostDocumentIdentitySchema, sameFileIdentity, serializeFileIdentity, } from './document-backup.js';
import { atomicCreatePrivateRecord, readSecurePrivateRecord, unlinkPrivateRecord } from './private-record.js';
import { ensurePrivateDirectory, isMissingPath } from './private-state.js';
export const EXPORT_REQUIRES_SAVED_FILE_MESSAGE = 'Export requires a saved, file-backed document with a verified file revision; unsaved documents have no file to export.';
export const EXPORT_RECORD_VERSION = 1;
export const EXPORT_RECORD_MAX_BYTES = 16_384;
export const EXPORT_SESSION_VERSION = 1;
export const EXPORT_SESSION_MAX_BYTES = 8_192;
export const EXPORT_HOST_TIMEOUT_MS = 300_000;
const SCAN_CHUNK_BYTES = 1024 * 1024;
const SCAN_CARRY_BYTES = 32;
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
export const exportFormatSchema = z.enum(['ai', 'pdf']);
const exportFilesSchema = z.strictObject({ workCopyPath: z.string().nullable(), stagedPath: z.string().nullable(), outputPath: z.string().nullable() });
const exportOutlineSummarySchema = z.strictObject({
    textFramesBefore: z.number().int().nonnegative(),
    textFramesAfter: z.number().int().nonnegative(),
    errors: z.array(z.strictObject({ index: z.number().int().nonnegative(), message: z.string() })),
});
export const exportRecordSchema = z.strictObject({
    version: z.literal(EXPORT_RECORD_VERSION),
    exportId: z.uuid(),
    documentKey: z.string().min(1),
    sourcePath: z.string().min(1),
    sourceName: z.string(),
    sourceFileRevision: z.string().min(1),
    format: exportFormatSchema,
    outputPath: z.string().min(1),
    bytes: z.number().int().positive(),
    sha256: sha256Schema,
    outputIdentity: fileIdentitySchema,
    pdfPreset: z.string().nullable(),
    outline: z.strictObject({
        textFramesBefore: z.number().int().nonnegative(),
        textFramesAfter: z.number().int().nonnegative(),
        groupItemsAdded: z.number().int(),
        pageItemsBefore: z.number().int().nonnegative(),
        pageItemsAfter: z.number().int().nonnegative(),
    }),
    verification: z.strictObject({
        method: z.literal('pdf_header_scan'),
        header: z.string().min(1),
        pageObjects: z.number().int().nonnegative(),
        artboardCount: z.number().int().nonnegative(),
        fontObjects: z.number().int().nonnegative(),
    }),
    workCopy: z.strictObject({ path: z.string().min(1), removed: z.boolean() }),
    staging: z.strictObject({ directory: z.string().min(1), removed: z.boolean() }),
    sourcePreserved: z.literal(true),
    createdAt: z.string().min(1),
});
export const exportStageSchema = z.enum([
    'read_source',
    'copy_work',
    'open_session',
    'open_work_copy',
    'outline',
    'save_output',
    'verify_output',
    'close_work_copy',
    'verify_source',
    'publish_output',
    'write_record',
]);
export const exportOutlinedResultSchema = z.discriminatedUnion('outcome', [
    z.strictObject({
        outcome: z.literal('verified'),
        record: exportRecordSchema,
        recordPath: z.string().min(1),
        retention: z.literal('manual'),
    }),
    z.strictObject({
        outcome: z.literal('rejected'),
        reason: z.enum([
            'document_key_mismatch',
            'document_not_admitted',
            'output_exists',
            'output_path_invalid',
            'output_cross_device',
            'pdf_preset_unknown',
            'source_file_unavailable',
            'export_root_unavailable',
        ]),
        message: z.string(),
        document: documentContextSchema.nullable(),
        availablePresets: z.array(z.string()).nullable(),
    }),
    z.strictObject({
        outcome: z.literal('failed'),
        reason: z.enum([
            'copy_mismatch',
            'file_replaced',
            'work_copy_open_failed',
            'outline_incomplete',
            'save_failed',
            'output_verification_failed',
            'output_exists',
            'output_cross_device',
            'work_copy_identity_mismatch',
            'source_changed',
        ]),
        stage: exportStageSchema,
        message: z.string(),
        files: exportFilesSchema,
        outline: exportOutlineSummarySchema.nullable(),
    }),
    z.strictObject({
        outcome: z.literal('indeterminate'),
        stage: exportStageSchema,
        message: z.string(),
        commandId: z.string().nullable(),
        files: exportFilesSchema,
        sessionId: z.string().nullable(),
    }),
]);
export const exportSessionSchema = z.strictObject({
    version: z.literal(EXPORT_SESSION_VERSION),
    exportId: z.uuid(),
    documentKey: z.string().min(1),
    sourcePath: z.string().min(1),
    format: exportFormatSchema,
    workCopyPath: z.string().min(1),
    workCopyIdentity: fileIdentitySchema,
    stagingDirectory: z.string().min(1),
    stagedPath: z.string().min(1),
    outputPath: z.string().min(1),
    bytes: z.number().int().positive(),
    sha256: sha256Schema,
    openCommandId: z.string().min(1),
    phase: z.literal('open_pending'),
    createdAt: z.string().min(1),
});
const hostRecordIdentitySchema = z.strictObject({
    keyVersion: z.literal(1),
    key: z.string().min(1),
    name: z.string(),
    path: z.string().nullable(),
    fileRevision: z.string().nullable(),
    saved: z.boolean(),
    colorSpace: z.enum(['RGB', 'CMYK', 'unknown']),
});
const inventoryDocumentSchema = hostDocumentIdentitySchema.extend({
    textFrames: z.number().int().nonnegative(),
    pageItems: z.number().int().nonnegative(),
    artboardCount: z.number().int().nonnegative(),
    artboardRects: z.string(),
});
export const EXPORT_HOST_RECORD_VERSION = 1;
export const EXPORT_HOST_RECORD_MAX_BYTES = 8_192;
export const exportHostRecordSchema = z.strictObject({
    version: z.literal(EXPORT_HOST_RECORD_VERSION),
    exportId: z.uuid(),
    openCommandId: z.string().min(1),
    workCopy: hostRecordIdentitySchema,
    artboardRects: z.string(),
    recordedAt: z.string().min(1),
});
export function hostRecordIdentityOf(identity) {
    return {
        keyVersion: identity.keyVersion,
        key: identity.key,
        name: identity.name,
        path: identity.path,
        fileRevision: identity.fileRevision,
        saved: identity.saved,
        colorSpace: identity.colorSpace,
    };
}
export const reconcileExportResultSchema = z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('no_session'), exportId: z.string() }),
    z.strictObject({
        status: z.literal('released'),
        exportId: z.string(),
        action: z.enum(['inspect', 'close_work_copy']),
        workCopyPath: z.string(),
        outputPath: z.string(),
        documentCount: z.number().int().nonnegative(),
        closedDocument: inventoryDocumentSchema.nullable(),
    }),
    z.strictObject({
        status: z.literal('work_copy_open'),
        exportId: z.string(),
        workCopyPath: z.string(),
        outputPath: z.string(),
        documents: z.array(inventoryDocumentSchema),
        documentCount: z.number().int().nonnegative(),
    }),
    z.strictObject({
        status: z.literal('close_refused'),
        exportId: z.string(),
        workCopyPath: z.string(),
        outputPath: z.string(),
        reason: z.string(),
        documents: z.array(inventoryDocumentSchema),
        documentCount: z.number().int().nonnegative(),
    }),
]);
export class ExportSessionGoneError extends Error {
    exportId;
    constructor(exportId) {
        super(`Export session ${exportId} no longer exists.`);
        this.exportId = exportId;
        this.name = 'ExportSessionGoneError';
    }
}
export class ExportSessionUnresolvedError extends Error {
    exportIds;
    constructor(exportIds) {
        super(`Unresolved export session${exportIds.length === 1 ? '' : 's'} ${exportIds.join(', ')} block${exportIds.length === 1 ? 's' : ''} mutations. ` +
            'Run illustrator_reconcile_export for each export_id before another mutation, backup, or export.');
        this.exportIds = exportIds;
        this.name = 'ExportSessionUnresolvedError';
    }
}
export class ExportPreconditionError extends Error {
    reason;
    constructor(reason, message) {
        super(message);
        this.reason = reason;
        this.name = 'ExportPreconditionError';
    }
}
export class OutputVerificationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'OutputVerificationError';
    }
}
export class OutputPublishError extends Error {
    reason;
    constructor(reason, message) {
        super(message);
        this.reason = reason;
        this.name = 'OutputPublishError';
    }
}
export const EXPORT_HELPERS = `
function exportKeyWithoutIndex(key) {
  return String(key).replace(/\\|index=-?\\d+\\|/, "|index=*|");
}
function exportPathOf(doc) {
  var exportPathValue = "";
  try { exportPathValue = doc.fullName.fsName; } catch (_exportPathError) {}
  return exportPathValue;
}
function exportArtboards(doc) {
  var exportArtboardList = [];
  for (var exportArtboardCursor = 0; exportArtboardCursor < doc.artboards.length; exportArtboardCursor++) {
    var exportRect = doc.artboards[exportArtboardCursor].artboardRect;
    exportArtboardList.push({ index: exportArtboardCursor, name: String(doc.artboards[exportArtboardCursor].name),
      rect: [exportRect[0], exportRect[1], exportRect[2], exportRect[3]] });
  }
  return exportArtboardList;
}
function exportCounts(doc) {
  return { pageItems: doc.pageItems.length, textFrames: doc.textFrames.length, groupItems: doc.groupItems.length,
    compoundPathItems: doc.compoundPathItems.length, pathItems: doc.pathItems.length,
    placedItems: doc.placedItems.length, rasterItems: doc.rasterItems.length };
}
function exportLayerState(layer) {
  var exportChildren = [];
  for (var exportLayerCursor = 0; exportLayerCursor < layer.layers.length; exportLayerCursor++) exportChildren.push(exportLayerState(layer.layers[exportLayerCursor]));
  return { name: String(layer.name), visible: layer.visible === true, locked: layer.locked === true, children: exportChildren };
}
function exportLayers(doc) {
  var exportLayerList = [];
  for (var exportTopCursor = 0; exportTopCursor < doc.layers.length; exportTopCursor++) exportLayerList.push(exportLayerState(doc.layers[exportTopCursor]));
  return exportLayerList;
}
function exportArtboardRects(doc) {
  var exportRectParts = [];
  for (var exportRectCursor = 0; exportRectCursor < doc.artboards.length; exportRectCursor++) {
    var exportRectValue = doc.artboards[exportRectCursor].artboardRect;
    exportRectParts.push([exportRectValue[0], exportRectValue[1], exportRectValue[2], exportRectValue[3]].join(","));
  }
  return exportRectParts.join(";");
}
function exportInventoryEntry(doc, index) {
  var exportEntry = getDocumentIdentity(doc, index);
  exportEntry.textFrames = doc.textFrames.length;
  exportEntry.pageItems = doc.pageItems.length;
  exportEntry.artboardCount = doc.artboards.length;
  exportEntry.artboardRects = exportArtboardRects(doc);
  return exportEntry;
}
function exportMatchesByPath(paths) {
  var exportMatches = [];
  for (var exportScan = 0; exportScan < app.documents.length; exportScan++) {
    var exportScanPath = exportPathOf(app.documents[exportScan]);
    for (var exportPathCursor = 0; exportPathCursor < paths.length; exportPathCursor++) {
      if (exportScanPath === paths[exportPathCursor]) {
        exportMatches.push({ doc: app.documents[exportScan], index: exportScan, entry: exportInventoryEntry(app.documents[exportScan], exportScan) });
        break;
      }
    }
  }
  return exportMatches;
}
/** Exactly one open document must carry the work-copy path with the expected key (index ignored). */
function exportRequireWorkCopy(path, expectedKey) {
  var exportWorkMatches = exportMatchesByPath([path]);
  if (exportWorkMatches.length !== 1) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_WORK_COPY_NOT_UNIQUE", count: exportWorkMatches.length }));
  }
  if (exportKeyWithoutIndex(exportWorkMatches[0].entry.key) !== exportKeyWithoutIndex(expectedKey)) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_WORK_COPY_IDENTITY_MISMATCH", actual: exportWorkMatches[0].entry }));
  }
  return exportWorkMatches[0];
}
`;
export const EXPORT_READ_SOURCE_SCRIPT = `${EXPORT_HELPERS}
var exportSourceContext = requireDocumentForRead(params.expectedDocumentKey);
var exportSourceDocument = app.activeDocument;
var exportPresetList = [];
var exportRawPresets = app.PDFPresetsList;
for (var exportPresetCursor = 0; exportPresetCursor < exportRawPresets.length; exportPresetCursor++) exportPresetList.push(String(exportRawPresets[exportPresetCursor]));
var result = {
  document: exportSourceContext,
  artboards: exportArtboards(exportSourceDocument),
  counts: exportCounts(exportSourceDocument),
  layers: exportLayers(exportSourceDocument),
  pdfPresets: exportPresetList
};
`;
export const EXPORT_OPEN_PRE_ATTEMPT_CODES = [
    'DOCUMENT_MISMATCH',
    'DOCUMENT_NOT_SAVED',
    'EXPORT_WORK_COPY_MISSING',
    'EXPORT_OUTPUT_EXISTS',
];
export const EXPORT_OPEN_ALREADY_OPEN_CODE = 'EXPORT_WORK_COPY_ALREADY_OPEN';
export const EXPORT_OPEN_WORK_COPY_SCRIPT = `${EXPORT_HELPERS}
var exportCountBefore = app.documents.length;
if (exportMatchesByPath(params.sessionPaths).length !== 0) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_WORK_COPY_ALREADY_OPEN" }));
}
var exportWorkFile = new File(params.workCopyPath);
if (!exportWorkFile.exists) throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_WORK_COPY_MISSING" }));
if (new File(params.outputPath).exists || new File(params.stagedPath).exists) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_OUTPUT_EXISTS" }));
}
var exportSourceContext = requireDocumentForRead(params.expectedDocumentKey);
if (exportSourceContext.mutationProfile !== "saved_file") {
  throw new Error("MCP_ERROR:" + stringifyJson({
    code: "DOCUMENT_NOT_SAVED",
    message: exportSourceContext.mutationBlockedReason || ${JSON.stringify(EXPORT_REQUIRES_SAVED_FILE_MESSAGE)}
  }));
}
var exportPreviousInteraction = app.userInteractionLevel;
app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
var exportOpenedDocument = null;
try { exportOpenedDocument = app.open(exportWorkFile); }
finally { app.userInteractionLevel = exportPreviousInteraction; }
var exportOpenedIndex = -1;
for (var exportOpenedCursor = 0; exportOpenedCursor < app.documents.length; exportOpenedCursor++) {
  if (app.documents[exportOpenedCursor] === exportOpenedDocument) exportOpenedIndex = exportOpenedCursor;
}
if (exportOpenedIndex < 0) throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_WORK_COPY_NOT_LISTED" }));
var exportOpenedIdentity = getDocumentIdentity(exportOpenedDocument, exportOpenedIndex);
if (exportOpenedIdentity.path !== params.workCopyPath) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_WORK_COPY_PATH_MISMATCH", actual: exportOpenedIdentity.path }));
}
if (app.activeDocument !== exportOpenedDocument) throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_WORK_COPY_NOT_ACTIVE" }));
var result = {
  source: exportSourceContext,
  opened: exportOpenedIdentity,
  documentCountBefore: exportCountBefore,
  documentCountAfter: app.documents.length
};
`;
export const EXPORT_OUTLINE_PRE_ATTEMPT_CODES = ['EXPORT_WORK_COPY_NOT_UNIQUE', 'EXPORT_WORK_COPY_IDENTITY_MISMATCH'];
export const EXPORT_OUTLINE_SCRIPT = `${EXPORT_HELPERS}
var exportOutlineTarget = exportRequireWorkCopy(params.workCopyPath, params.workCopyKey);
var exportOutlineDocument = exportOutlineTarget.doc;
var exportTextFramesBefore = exportOutlineDocument.textFrames.length;
var exportLayerStates = [];
function exportCollectLayers(layer) {
  exportLayerStates.push({ layer: layer, visible: layer.visible, locked: layer.locked });
  for (var exportCollectCursor = 0; exportCollectCursor < layer.layers.length; exportCollectCursor++) exportCollectLayers(layer.layers[exportCollectCursor]);
}
for (var exportTopLayer = 0; exportTopLayer < exportOutlineDocument.layers.length; exportTopLayer++) exportCollectLayers(exportOutlineDocument.layers[exportTopLayer]);
var exportOutlineErrors = [];
var exportRestoreErrors = [];
var exportOutlinePreviousInteraction = app.userInteractionLevel;
app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
try {
  try {
    for (var exportUnlock = 0; exportUnlock < exportLayerStates.length; exportUnlock++) {
      exportLayerStates[exportUnlock].layer.locked = false;
      exportLayerStates[exportUnlock].layer.visible = true;
    }
    for (var exportFrameCursor = exportOutlineDocument.textFrames.length - 1; exportFrameCursor >= 0; exportFrameCursor--) {
      try { exportOutlineDocument.textFrames[exportFrameCursor].createOutline(); }
      catch (exportOutlineError) { exportOutlineErrors.push({ index: exportFrameCursor, message: String(exportOutlineError.message) }); }
    }
  } finally {
    // Restore every layer even when one restoration throws; failures are collected and refuse the save.
    for (var exportRestore = exportLayerStates.length - 1; exportRestore >= 0; exportRestore--) {
      var exportRestoreState = exportLayerStates[exportRestore];
      var exportRestoreName = "";
      try { exportRestoreName = String(exportRestoreState.layer.name); } catch (_exportNameError) {}
      try { exportRestoreState.layer.locked = exportRestoreState.locked; }
      catch (exportLockedError) { exportRestoreErrors.push({ layer: exportRestoreName, attribute: "locked", message: String(exportLockedError.message) }); }
      try { exportRestoreState.layer.visible = exportRestoreState.visible; }
      catch (exportVisibleError) { exportRestoreErrors.push({ layer: exportRestoreName, attribute: "visible", message: String(exportVisibleError.message) }); }
    }
  }
} finally {
  app.userInteractionLevel = exportOutlinePreviousInteraction;
}
var result = {
  workCopy: getDocumentIdentity(exportOutlineDocument, exportOutlineTarget.index),
  textFramesBefore: exportTextFramesBefore,
  textFramesAfter: exportOutlineDocument.textFrames.length,
  errors: exportOutlineErrors,
  restoreErrors: exportRestoreErrors,
  artboards: exportArtboards(exportOutlineDocument),
  counts: exportCounts(exportOutlineDocument),
  layers: exportLayers(exportOutlineDocument)
};
`;
export const EXPORT_SAVE_PRE_ATTEMPT_CODES = [
    'EXPORT_WORK_COPY_NOT_UNIQUE',
    'EXPORT_WORK_COPY_IDENTITY_MISMATCH',
    'EXPORT_WORK_COPY_NOT_OUTLINED',
    'EXPORT_OUTPUT_EXISTS',
    'EXPORT_PDF_PRESET_UNKNOWN',
];
export const EXPORT_SAVE_FAILED_CODE = 'EXPORT_SAVE_FAILED';
export const EXPORT_SAVE_OUTPUT_SCRIPT = `${EXPORT_HELPERS}
var exportSaveTarget = exportRequireWorkCopy(params.workCopyPath, params.workCopyKey);
var exportSaveDocument = exportSaveTarget.doc;
if (exportSaveDocument.textFrames.length !== 0) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_WORK_COPY_NOT_OUTLINED", textFrames: exportSaveDocument.textFrames.length }));
}
var exportOutputFile = new File(params.stagedPath);
if (exportOutputFile.exists || new File(params.outputPath).exists) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_OUTPUT_EXISTS" }));
}
var exportSaveOptions = null;
if (params.format === "pdf") {
  var exportPresetFound = false;
  var exportPresetsRaw = app.PDFPresetsList;
  for (var exportPresetScan = 0; exportPresetScan < exportPresetsRaw.length; exportPresetScan++) {
    if (String(exportPresetsRaw[exportPresetScan]) === params.pdfPreset) exportPresetFound = true;
  }
  if (!exportPresetFound) throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_PDF_PRESET_UNKNOWN", preset: params.pdfPreset }));
  exportSaveOptions = new PDFSaveOptions();
  exportSaveOptions.pDFPreset = params.pdfPreset;
  exportSaveOptions.compressArt = true;
  exportSaveOptions.optimization = true;
  exportSaveOptions.preserveEditability = false;
  exportSaveOptions.generateThumbnails = false;
  exportSaveOptions.viewAfterSaving = false;
  exportSaveOptions.saveMultipleArtboards = true;
  exportSaveOptions.artboardRange = "1-" + exportSaveDocument.artboards.length;
} else {
  exportSaveOptions = new IllustratorSaveOptions();
  exportSaveOptions.compressed = true;
  exportSaveOptions.pdfCompatible = true;
  exportSaveOptions.embedICCProfile = true;
}
var exportPathBefore = exportPathOf(exportSaveDocument);
var exportSavePreviousInteraction = app.userInteractionLevel;
app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
var exportSaveError = null;
try { exportSaveDocument.saveAs(exportOutputFile, exportSaveOptions); }
catch (exportCaughtSaveError) { exportSaveError = String(exportCaughtSaveError.message); }
finally { app.userInteractionLevel = exportSavePreviousInteraction; }
var exportOutputExists = new File(params.stagedPath).exists;
if (exportSaveError !== null) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_SAVE_FAILED", message: exportSaveError, outputExists: exportOutputExists }));
}
if (!exportOutputExists) throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_SAVE_NO_FILE" }));
var exportPathAfter = exportPathOf(exportSaveDocument);
if (exportPathAfter !== params.stagedPath && exportPathAfter !== exportPathBefore) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_SAVE_UNEXPECTED_PATH", actual: exportPathAfter }));
}
var result = {
  workCopy: getDocumentIdentity(exportSaveDocument, exportSaveTarget.index),
  pathBefore: exportPathBefore,
  pathAfter: exportPathAfter,
  outputExists: exportOutputExists,
  artboardCount: exportSaveDocument.artboards.length
};
`;
export const EXPORT_CLOSE_PRE_ATTEMPT_CODES = [
    'EXPORT_WORK_COPY_NOT_UNIQUE',
    'EXPORT_WORK_COPY_IDENTITY_MISMATCH',
    'EXPORT_SOURCE_NOT_UNIQUE',
    'EXPORT_SOURCE_IDENTITY_MISMATCH',
];
export const EXPORT_CLOSE_WORK_COPY_SCRIPT = `${EXPORT_HELPERS}
var exportCloseTarget = exportRequireWorkCopy(params.workCopyPath, params.workCopyKey);
var exportCloseSourceMatches = exportMatchesByPath([params.sourcePath]);
if (exportCloseSourceMatches.length !== 1) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_SOURCE_NOT_UNIQUE", count: exportCloseSourceMatches.length }));
}
var exportCloseSource = exportCloseSourceMatches[0];
if (exportKeyWithoutIndex(exportCloseSource.entry.key) !== exportKeyWithoutIndex(params.expectedDocumentKey) ||
    exportCloseSource.entry.saved !== true || exportCloseSource.entry.fileRevision !== params.sourceFileRevision) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_SOURCE_IDENTITY_MISMATCH", actual: exportCloseSource.entry }));
}
if (exportCloseTarget.doc === exportCloseSource.doc) throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_WORK_COPY_IS_SOURCE" }));
var exportClosedBefore = getDocumentIdentity(exportCloseTarget.doc, exportCloseTarget.index);
var exportClosePreviousInteraction = app.userInteractionLevel;
app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
try { exportCloseTarget.doc.close(SaveOptions.DONOTSAVECHANGES); }
finally { app.userInteractionLevel = exportClosePreviousInteraction; }
if (exportMatchesByPath(params.sessionPaths).length !== 0) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_WORK_COPY_STILL_OPEN" }));
}
app.activeDocument = exportCloseSource.doc;
var result = {
  closedBeforeClose: exportClosedBefore,
  source: getDocumentContext(),
  documentCount: app.documents.length
};
`;
export const EXPORT_INVENTORY_SCRIPT = `${EXPORT_HELPERS}
var exportInventoryMatches = exportMatchesByPath(params.sessionPaths);
var exportInventoryDocuments = [];
for (var exportInventoryCursor = 0; exportInventoryCursor < exportInventoryMatches.length; exportInventoryCursor++) {
  exportInventoryDocuments.push(exportInventoryMatches[exportInventoryCursor].entry);
}
var result = { documents: exportInventoryDocuments, documentCount: app.documents.length };
`;
export const EXPORT_RECONCILE_CLOSE_SCRIPT = `${EXPORT_HELPERS}
var exportReconcileMatches = exportMatchesByPath(params.sessionPaths);
if (exportReconcileMatches.length !== 1) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_WORK_COPY_NOT_UNIQUE", count: exportReconcileMatches.length }));
}
var exportReconcileEntry = exportReconcileMatches[0].entry;
if (exportKeyWithoutIndex(exportReconcileEntry.key) !== exportKeyWithoutIndex(params.expected.key) ||
    exportReconcileEntry.path !== params.expected.path || exportReconcileEntry.saved !== params.expected.saved ||
    exportReconcileEntry.fileRevision !== params.expected.fileRevision ||
    exportReconcileEntry.textFrames !== params.expected.textFrames || exportReconcileEntry.pageItems !== params.expected.pageItems ||
    exportReconcileEntry.artboardCount !== params.expected.artboardCount || exportReconcileEntry.artboardRects !== params.expected.artboardRects) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_WORK_COPY_IDENTITY_MISMATCH", actual: exportReconcileEntry }));
}
var exportProvenance = params.provenance;
var exportProvenanceProblem = null;
if (exportReconcileEntry.saved !== true) exportProvenanceProblem = "unsaved_changes";
else if (exportReconcileEntry.path !== exportProvenance.workCopyPath && exportReconcileEntry.path !== exportProvenance.stagedPath) exportProvenanceProblem = "path_not_session_owned";
else if (exportReconcileEntry.colorSpace !== exportProvenance.colorSpace) exportProvenanceProblem = "color_space_mismatch";
else if (exportReconcileEntry.artboardRects !== exportProvenance.artboardRects) exportProvenanceProblem = "artboards_mismatch";
else if (exportReconcileEntry.path === exportProvenance.workCopyPath && exportReconcileEntry.fileRevision !== exportProvenance.fileRevisionAtOpen) exportProvenanceProblem = "file_revision_mismatch";
if (exportProvenanceProblem !== null) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_CLOSE_REFUSED", reason: exportProvenanceProblem, actual: exportReconcileEntry }));
}
var exportReconcilePreviousInteraction = app.userInteractionLevel;
app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
try { exportReconcileMatches[0].doc.close(SaveOptions.DONOTSAVECHANGES); }
finally { app.userInteractionLevel = exportReconcilePreviousInteraction; }
var exportReconcileRemaining = exportMatchesByPath(params.sessionPaths);
var exportReconcileRemainingEntries = [];
for (var exportRemainingCursor = 0; exportRemainingCursor < exportReconcileRemaining.length; exportRemainingCursor++) {
  exportReconcileRemainingEntries.push(exportReconcileRemaining[exportRemainingCursor].entry);
}
var result = { closed: exportReconcileEntry, documents: exportReconcileRemainingEntries, documentCount: app.documents.length };
`;
export const EXPORT_CLOSE_REFUSED_CODE = 'EXPORT_CLOSE_REFUSED';
export function closeRefusalReason(entry, provenance) {
    if (entry.saved !== true)
        return 'unsaved_changes';
    if (entry.path !== provenance.workCopyPath && entry.path !== provenance.stagedPath)
        return 'path_not_session_owned';
    if (entry.colorSpace !== provenance.colorSpace)
        return 'color_space_mismatch';
    if (entry.artboardRects !== provenance.artboardRects)
        return 'artboards_mismatch';
    if (entry.path === provenance.workCopyPath && entry.fileRevision !== provenance.fileRevisionAtOpen)
        return 'file_revision_mismatch';
    return null;
}
function describeError(error) {
    return error instanceof Error ? error.message : String(error);
}
export async function validateOutputPath(outputPath, format, sourceRealPath, stateRoot) {
    const invalid = (message) => new ExportPreconditionError('output_path_invalid', message);
    if (!isAbsolute(outputPath))
        throw invalid('output_path must be an absolute path.');
    if (outputPath !== resolve(outputPath) || outputPath.endsWith('/'))
        throw invalid('output_path must be a normalized file path.');
    if (extname(outputPath).toLowerCase() !== `.${format}`)
        throw invalid(`output_path must end with .${format} for format "${format}".`);
    if (basename(outputPath) === `.${format}`)
        throw invalid('output_path needs a file name before the extension.');
    let parent;
    try {
        parent = await realpath(dirname(outputPath));
    }
    catch (error) {
        throw invalid(`The output directory could not be resolved: ${describeError(error)}`);
    }
    const path = join(parent, basename(outputPath));
    if (path === sourceRealPath)
        throw invalid('output_path must differ from the source file.');
    let resolvedStateRoot = null;
    try {
        resolvedStateRoot = await realpath(stateRoot);
    }
    catch {
        resolvedStateRoot = null;
    }
    if (resolvedStateRoot !== null && (parent === resolvedStateRoot || parent.startsWith(`${resolvedStateRoot}/`))) {
        throw invalid('output_path must not be inside the MCP state root.');
    }
    const parentMetadata = await lstat(parent);
    if (!parentMetadata.isDirectory())
        throw invalid('The output directory is not a directory.');
    if (typeof process.getuid === 'function' && parentMetadata.uid !== process.getuid() && parentMetadata.uid !== 0) {
        throw invalid('The output directory is owned by another user.');
    }
    if ((parentMetadata.mode & 0o022) !== 0 && (parentMetadata.mode & 0o1000) === 0) {
        throw invalid('The output directory is writable by group or others without the sticky bit, so another account could replace the output.');
    }
    await assertOutputAbsent(path);
    return { path, parent };
}
export async function assertOutputAbsent(path) {
    try {
        await lstat(path);
    }
    catch (error) {
        if (isMissingPath(error))
            return;
        throw new ExportPreconditionError('output_path_invalid', `The output path could not be inspected: ${describeError(error)}`);
    }
    throw new ExportPreconditionError('output_exists', `The output path already exists: ${path}. Overwriting is refused; choose a new path.`);
}
const PAGE_OBJECT_PATTERN = /\/Type\s*\/Page(?![s\w])/g;
const FONT_OBJECT_PATTERN = /\/Type\s*\/Font(?![\w])/g;
const IMAGE_OBJECT_PATTERN = /\/Subtype\s*\/Image(?![\w])/g;
function scanChunk(text, tail) {
    const limit = Math.max(0, text.length - tail);
    let cutAt = limit;
    let pageObjects = 0;
    let fontObjects = 0;
    let imageObjects = 0;
    for (const [pattern, kind] of [[PAGE_OBJECT_PATTERN, 'page'], [FONT_OBJECT_PATTERN, 'font'], [IMAGE_OBJECT_PATTERN, 'image']]) {
        pattern.lastIndex = 0;
        for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
            if (match.index + match[0].length <= limit) {
                if (kind === 'page')
                    pageObjects += 1;
                else if (kind === 'font')
                    fontObjects += 1;
                else
                    imageObjects += 1;
            }
            else {
                cutAt = Math.min(cutAt, match.index);
            }
        }
    }
    return { pageObjects, fontObjects, imageObjects, carry: text.slice(cutAt) };
}
async function scanOpenFile(handle) {
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(SCAN_CHUNK_BYTES);
    let total = 0;
    let header = '';
    let carry = '';
    let pageObjects = 0;
    let fontObjects = 0;
    let imageObjects = 0;
    for (;;) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
        if (bytesRead === 0)
            break;
        const chunk = buffer.subarray(0, bytesRead);
        hash.update(chunk);
        if (total === 0)
            header = chunk.subarray(0, 8).toString('latin1');
        total += bytesRead;
        const scanned = scanChunk(carry + chunk.toString('latin1'), SCAN_CARRY_BYTES);
        pageObjects += scanned.pageObjects;
        fontObjects += scanned.fontObjects;
        imageObjects += scanned.imageObjects;
        carry = scanned.carry;
    }
    const flushed = scanChunk(carry, 0);
    return {
        bytes: total, sha256: hash.digest('hex'), header,
        pageObjects: pageObjects + flushed.pageObjects,
        fontObjects: fontObjects + flushed.fontObjects,
        imageObjects: imageObjects + flushed.imageObjects,
    };
}
export async function scanPdfObjects(path) {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const stat = await handle.stat();
        if (!stat.isFile())
            throw new OutputVerificationError(`${path} is not a regular file.`);
        return await scanOpenFile(handle);
    }
    finally {
        await handle.close();
    }
}
export async function verifyOutputFile(path, expectedArtboards, parentSync) {
    let handle;
    try {
        handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    }
    catch (error) {
        throw new OutputVerificationError(`The output file could not be opened: ${describeError(error)}`);
    }
    try {
        const before = await handle.stat({ bigint: true });
        if (!before.isFile())
            throw new OutputVerificationError('The output path is not a regular file.');
        if (before.size <= 0n)
            throw new OutputVerificationError('The output file is empty.');
        const scan = await scanOpenFile(handle);
        if (!scan.header.startsWith('%PDF-'))
            throw new OutputVerificationError(`The output file does not start with a PDF header (got ${JSON.stringify(scan.header)}).`);
        if (expectedArtboards !== null && scan.pageObjects !== expectedArtboards) {
            throw new OutputVerificationError(`The output file has ${scan.pageObjects} page object(s); the source has ${expectedArtboards} artboard(s).`);
        }
        await handle.sync();
        if (parentSync)
            await parentSync();
        const after = await handle.stat({ bigint: true });
        if (BigInt(scan.bytes) !== before.size || !sameFileIdentity(fileIdentityOf(before), fileIdentityOf(after))) {
            throw new OutputVerificationError('The output file changed while it was being verified.');
        }
        return {
            bytes: scan.bytes, sha256: scan.sha256, identity: fileIdentityOf(after), header: scan.header,
            pageObjects: scan.pageObjects, fontObjects: scan.fontObjects, imageObjects: scan.imageObjects,
        };
    }
    finally {
        await handle.close();
    }
}
function fileIdentityOf(metadata) {
    return { dev: metadata.dev, ino: metadata.ino, size: metadata.size, mtimeNs: metadata.mtimeNs, ctimeNs: metadata.ctimeNs };
}
export async function verifyOutputUnchanged(path, expected) {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const before = await handle.stat({ bigint: true });
        if (!before.isFile() || !sameFileIdentity(expected.identity, fileIdentityOf(before))) {
            throw new BackupCopyError(`The output file ${path} was replaced or modified.`);
        }
        const hash = createHash('sha256');
        const buffer = Buffer.allocUnsafe(SCAN_CHUNK_BYTES);
        let total = 0;
        for (;;) {
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
            if (bytesRead === 0)
                break;
            hash.update(buffer.subarray(0, bytesRead));
            total += bytesRead;
        }
        const after = await handle.stat({ bigint: true });
        if (total !== expected.bytes || hash.digest('hex') !== expected.sha256 || !sameFileIdentity(expected.identity, fileIdentityOf(after))) {
            throw new BackupCopyError(`The output file ${path} no longer matches its verified bytes.`);
        }
    }
    finally {
        await handle.close();
    }
}
export async function withOutputParentScope(parent, operation) {
    const handle = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
        const identity = await handle.stat({ bigint: true });
        if (!identity.isDirectory())
            throw new ExportPreconditionError('output_path_invalid', 'The output directory is not a directory.');
        const scope = {
            async assertStable() {
                const current = await lstat(parent, { bigint: true });
                const held = await handle.stat({ bigint: true });
                if (current.isSymbolicLink() || !current.isDirectory() || current.dev !== held.dev || current.ino !== held.ino ||
                    held.dev !== identity.dev || held.ino !== identity.ino || held.nlink === 0n) {
                    throw new ExportPreconditionError('output_path_invalid', 'The output directory no longer identifies the opened directory.');
                }
            },
            async sync() {
                await handle.sync();
            },
        };
        await scope.assertStable();
        const result = await operation(scope);
        await scope.assertStable();
        return result;
    }
    finally {
        await handle.close();
    }
}
export function parseExportHostError(error) {
    if (typeof error !== 'object' || error === null || !('message' in error) ||
        typeof error.message !== 'string' || !error.message.startsWith('MCP_ERROR:'))
        return null;
    try {
        return JSON.parse(error.message.slice('MCP_ERROR:'.length));
    }
    catch {
        return null;
    }
}
export const STAGING_DIRECTORY_PREFIX = '.illustrator-studio-mcp-export-';
export async function createStagingDirectory(parent, exportId, outputPath, prefix = STAGING_DIRECTORY_PREFIX) {
    const directory = join(parent, `${prefix}${exportId}`);
    try {
        await mkdir(directory, { mode: 0o700 });
    }
    catch (error) {
        throw new ExportPreconditionError('output_path_invalid', `The staging directory could not be created next to the output: ${describeError(error)}`);
    }
    const [parentMetadata, directoryMetadata] = await Promise.all([lstat(parent, { bigint: true }), lstat(directory, { bigint: true })]);
    if (parentMetadata.dev !== directoryMetadata.dev) {
        await rmdir(directory).catch(() => undefined);
        throw new ExportPreconditionError('output_cross_device', 'The staging directory is not on the output directory\'s device, so the output could not be published atomically.');
    }
    return { directory, stagedPath: join(directory, basename(outputPath)) };
}
export async function publishOutput(stagedPath, outputPath, expected, parentScope, options = {}) {
    const linkFile = options.linkImpl ?? link;
    const handle = await open(stagedPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const before = await handle.stat({ bigint: true });
        if (!before.isFile() || !sameFileIdentity(expected.identity, fileIdentityOf(before)) || before.nlink !== 1n) {
            throw new BackupCopyError(`The staged file ${stagedPath} was replaced or modified before publication.`);
        }
        await parentScope.assertStable();
        try {
            await linkFile(stagedPath, outputPath);
        }
        catch (error) {
            const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
            if (code === 'EEXIST')
                throw new OutputPublishError('output_exists', `The output path already exists: ${outputPath}. Nothing was overwritten; the verified file remains at ${stagedPath}.`);
            if (code === 'EXDEV')
                throw new OutputPublishError('output_cross_device', `The output path is on a different device from its staging directory: ${describeError(error)}`);
            throw error;
        }
        await parentScope.sync();
        const linked = await handle.stat({ bigint: true });
        const published = await lstat(outputPath, { bigint: true });
        if (!published.isFile() || published.dev !== linked.dev || published.ino !== linked.ino || linked.nlink !== 2n) {
            throw new BackupCopyError('The published output does not resolve to the verified staged inode.');
        }
        let stagingRemoved = false;
        try {
            await parentScope.assertStable();
            await unlink(stagedPath);
            const afterUnlink = await handle.stat({ bigint: true });
            if (afterUnlink.nlink === 1n) {
                await rmdir(dirname(stagedPath));
                await parentScope.sync();
                stagingRemoved = true;
            }
        }
        catch {
            stagingRemoved = false;
        }
        const final = await handle.stat({ bigint: true });
        if (final.dev !== linked.dev || final.ino !== linked.ino || final.size !== expected.identity.size) {
            throw new BackupCopyError('The published output changed while the staging name was being removed.');
        }
        return { identity: fileIdentityOf(final), stagingRemoved };
    }
    finally {
        await handle.close();
    }
}
export function workCopyFileName(exportId, sourcePath) {
    return `${exportId}-work-${basename(sourcePath)}`;
}
export function serializeOutputIdentity(identity) {
    return serializeFileIdentity(identity);
}
export { captureFileIdentity as captureWorkCopyIdentity };
export class DocumentExportStore {
    stateRoot;
    constructor(stateRoot) {
        this.stateRoot = stateRoot;
    }
    get recordDirectory() {
        return join(this.stateRoot, 'exports');
    }
    get stateRootPath() {
        return this.stateRoot;
    }
    async ensure() {
        await ensurePrivateDirectory(this.stateRoot, 'state root');
        await ensurePrivateDirectory(this.recordDirectory, 'export record directory');
    }
    recordPath(exportId) {
        return join(this.recordDirectory, `${exportId}.json`);
    }
    async writeRecord(record) {
        const validated = exportRecordSchema.parse(record);
        const contents = `${JSON.stringify(validated, null, 2)}\n`;
        if (Buffer.byteLength(contents) > EXPORT_RECORD_MAX_BYTES)
            throw new Error('The export record exceeds its size limit.');
        const path = this.recordPath(record.exportId);
        await atomicCreatePrivateRecord(path, contents);
        return path;
    }
    sessionPath(exportId) {
        return join(this.recordDirectory, `${exportId}.session.json`);
    }
    async openSession(session) {
        const contents = `${JSON.stringify(exportSessionSchema.parse(session), null, 2)}\n`;
        if (Buffer.byteLength(contents) > EXPORT_SESSION_MAX_BYTES)
            throw new Error('The export session exceeds its size limit.');
        const path = this.sessionPath(session.exportId);
        await atomicCreatePrivateRecord(path, contents);
        return path;
    }
    async readSession(exportId) {
        if (!/^[0-9a-f-]{36}$/.test(exportId))
            throw new Error('export_id must be a UUID.');
        const path = this.sessionPath(exportId);
        let record;
        try {
            record = await readSecurePrivateRecord(path, EXPORT_SESSION_MAX_BYTES);
        }
        catch (error) {
            if (isMissingPath(error))
                return null;
            throw error;
        }
        if (record.state === 'missing')
            return null;
        if (record.state === 'invalid')
            throw new Error(`Export session ${exportId} is unsafe (${record.reason}); it stays unresolved.`);
        return exportSessionSchema.parse(JSON.parse(record.text));
    }
    hostRecordPath(exportId) {
        return join(this.recordDirectory, `${exportId}.session-host.json`);
    }
    async writeHostRecord(record) {
        const contents = `${JSON.stringify(exportHostRecordSchema.parse(record), null, 2)}\n`;
        if (Buffer.byteLength(contents) > EXPORT_HOST_RECORD_MAX_BYTES)
            throw new Error('The export host record exceeds its size limit.');
        const path = this.hostRecordPath(record.exportId);
        await atomicCreatePrivateRecord(path, contents);
        return path;
    }
    async readHostRecord(exportId) {
        if (!/^[0-9a-f-]{36}$/.test(exportId))
            throw new Error('export_id must be a UUID.');
        let record;
        try {
            record = await readSecurePrivateRecord(this.hostRecordPath(exportId), EXPORT_HOST_RECORD_MAX_BYTES);
        }
        catch (error) {
            if (isMissingPath(error))
                return null;
            throw error;
        }
        if (record.state !== 'valid')
            return null;
        const parsed = exportHostRecordSchema.safeParse(JSON.parse(record.text));
        return parsed.success ? parsed.data : null;
    }
    async releaseSession(exportId) {
        await unlinkPrivateRecord(this.sessionPath(exportId));
    }
    async listSessions() {
        let names;
        try {
            names = await readdir(this.recordDirectory);
        }
        catch (error) {
            if (isMissingPath(error))
                return [];
            throw error;
        }
        return names
            .filter((name) => name.endsWith('.session.json'))
            .map((name) => name.slice(0, -'.session.json'.length))
            .sort();
    }
    async assertNoUnresolvedSession() {
        const sessions = await this.listSessions();
        if (sessions.length > 0)
            throw new ExportSessionUnresolvedError(sessions);
    }
}
export function newExportId() {
    return randomUUID();
}
