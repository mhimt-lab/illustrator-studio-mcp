import { z } from 'zod';
import { fileIdentitySchema, hostDocumentIdentitySchema } from './document-backup.js';
import { RASTER_BATCH_EXPORT_KIND, RASTER_EXPORT_RECORD_SUFFIXES, RASTER_EXPORT_RECORD_VERSION, rasterExportArtifactSchema, rasterExportOptionsSchema, } from './raster-export-records.js';
export const RASTER_BATCH_MAX_ITEMS = 32;
export const RASTER_BATCH_SESSION_MAX_BYTES = 32_768;
export const RASTER_BATCH_RECORD_MAX_BYTES = 262_144;
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const indexSchema = z.number().int().nonnegative();
const base = (recordType) => ({
    version: z.literal(RASTER_EXPORT_RECORD_VERSION),
    kind: z.literal(RASTER_BATCH_EXPORT_KIND),
    recordType: z.literal(recordType),
    exportId: z.uuid(),
    planDigest: sha256Schema,
    recordedAt: z.string().min(1),
});
const artboardSnapshotSchema = z.array(z.strictObject({
    index: indexSchema,
    name: z.string(),
    rect: z.tuple([z.number(), z.number(), z.number(), z.number()]),
}));
const completedHostCallSchema = z.strictObject({ commandId: z.string().min(1), completedInactive: z.literal(true) });
export const rasterBatchPlannedItemSchema = z.strictObject({
    artboardIndex: indexSchema,
    leaf: z.string().min(1),
    outputPath: z.string().min(1),
    stagedPath: z.string().min(1),
});
export const rasterBatchSessionItemSchema = z.strictObject({
    artboardIndex: indexSchema,
    leaf: z.string().min(1),
    outputPath: z.string().min(1),
    stagedBasePath: z.string().min(1),
    stagedPath: z.string().min(1),
    expected: z.strictObject({ width: z.number().int().positive(), height: z.number().int().positive() }),
});
export const rasterBatchSessionSchema = z.strictObject({
    version: z.literal(RASTER_EXPORT_RECORD_VERSION),
    kind: z.literal(RASTER_BATCH_EXPORT_KIND),
    recordType: z.literal('session'),
    exportId: z.uuid(),
    commandId: z.string().min(1),
    planDigest: sha256Schema,
    openCommandId: z.string().min(1),
    documentKey: z.string().min(1),
    sourcePath: z.string().min(1),
    sourceSha256: sha256Schema,
    sourceIdentity: fileIdentitySchema,
    options: rasterExportOptionsSchema,
    workCopyPath: z.string().min(1),
    workCopyIdentity: fileIdentitySchema,
    stagingDirectory: z.string().min(1),
    items: z.array(rasterBatchSessionItemSchema).min(1).max(RASTER_BATCH_MAX_ITEMS),
    createdAt: z.string().min(1),
});
export const rasterBatchPrepareSchema = z.strictObject({
    ...base('prepare'),
    sourcePath: z.string().min(1),
    sourceSha256: sha256Schema,
    sourceIdentity: fileIdentitySchema,
    workCopyPath: z.string().min(1),
    stagingDirectory: z.string().min(1),
    outputParent: z.string().min(1),
    outputParentIdentity: z.strictObject({ dev: z.string().regex(/^\d+$/), ino: z.string().regex(/^\d+$/) }),
    items: z.array(rasterBatchPlannedItemSchema).min(1).max(RASTER_BATCH_MAX_ITEMS),
});
export const rasterBatchHostOpenSchema = z.strictObject({
    ...base('host_open'),
    open: completedHostCallSchema,
    workCopy: hostDocumentIdentitySchema,
    sourceKey: z.string().min(1),
    artboards: artboardSnapshotSchema,
    documentCountBefore: z.number().int().nonnegative(),
    documentCountAfter: z.number().int().positive(),
});
export const rasterBatchBindingItemSchema = z.strictObject({
    artboardIndex: indexSchema,
    stagedPath: z.string().min(1),
    stagedIdentity: fileIdentitySchema,
    mediaType: z.enum(['image/png', 'image/jpeg']),
    bytes: z.number().int().positive(),
    sha256: sha256Schema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
});
export const rasterBatchBindingSchema = z.strictObject({
    ...base('artifact_binding'),
    export: completedHostCallSchema,
    sessionDigest: sha256Schema,
    items: z.array(rasterBatchBindingItemSchema).min(1).max(RASTER_BATCH_MAX_ITEMS),
    copyAfterExport: z.strictObject({ identity: hostDocumentIdentitySchema, activeArtboardIndex: indexSchema, artboards: artboardSnapshotSchema }),
});
export const rasterBatchHostTerminalSchema = z.strictObject({
    ...base('host_terminal'),
    close: completedHostCallSchema,
    closedBeforeClose: hostDocumentIdentitySchema,
    sourceKey: z.string().min(1),
    sourceSaved: z.literal(true),
    sourceFileRevision: z.string().min(1),
    documentCount: z.number().int().nonnegative(),
});
export const rasterBatchPublishedItemSchema = z.strictObject({
    artboardIndex: indexSchema,
    artifact: rasterExportArtifactSchema,
    outputIdentity: fileIdentitySchema,
});
export const rasterBatchPublishedSchema = z.strictObject({
    ...base('published'),
    bindingDigest: sha256Schema,
    hostTerminalDigest: sha256Schema,
    items: z.array(rasterBatchPublishedItemSchema).min(1).max(RASTER_BATCH_MAX_ITEMS),
    sourcePath: z.string().min(1),
    options: rasterExportOptionsSchema,
});
export const rasterBatchFailedSchema = z.strictObject({
    ...base('failed'),
    stage: z.string().min(1),
    reason: z.string().min(1),
    message: z.string(),
    itemIndex: indexSchema.nullable(),
    rolledBack: z.array(z.strictObject({ artboardIndex: indexSchema, outputPath: z.string().min(1) })),
    evidenceDigests: z.record(z.string(), sha256Schema),
});
export const rasterBatchCleanupSchema = z.strictObject({
    ...base('cleanup'),
    disposition: z.enum(['published', 'failed', 'abandoned_before_open', 'quarantine_released']),
    entries: z.array(z.strictObject({ path: z.string().min(1), removed: z.boolean(), reason: z.string() })),
});
export const rasterBatchQuarantineSchema = z.strictObject({
    ...base('quarantine'),
    reason: z.string().min(1),
});
export const RASTER_BATCH_RECORD_SCHEMAS = {
    prepare: rasterBatchPrepareSchema,
    session: rasterBatchSessionSchema,
    host_open: rasterBatchHostOpenSchema,
    artifact_binding: rasterBatchBindingSchema,
    host_terminal: rasterBatchHostTerminalSchema,
    published: rasterBatchPublishedSchema,
    failed: rasterBatchFailedSchema,
    cleanup: rasterBatchCleanupSchema,
    quarantine: rasterBatchQuarantineSchema,
};
export const RASTER_BATCH_RECORD_SUFFIXES = RASTER_EXPORT_RECORD_SUFFIXES;
