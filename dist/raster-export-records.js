import { z } from 'zod';
import { fileIdentitySchema, hostDocumentIdentitySchema } from './document-backup.js';
export const RASTER_EXPORT_RECORD_VERSION = 2;
export const RASTER_EXPORT_KIND = 'raster_vector_export';
export const RASTER_EXPORT_SESSION_MAX_BYTES = 16_384;
export const RASTER_EXPORT_RECORD_MAX_BYTES = 65_536;
export const RASTER_EXPORT_RECORD_SUFFIXES = Object.freeze({
    prepare: '.prepare.json',
    session: '.session.json',
    host_open: '.session-host.json',
    artifact_binding: '.binding.json',
    host_terminal: '.host-terminal.json',
    published: '.json',
    cleanup: '.cleanup.json',
    failed: '.failed.json',
    quarantine: '.quarantine.json',
});
export const rasterExportRecordTypeSchema = z.enum(Object.keys(RASTER_EXPORT_RECORD_SUFFIXES));
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
export const rasterExportOptionsSchema = z.discriminatedUnion('format', [
    z.strictObject({ format: z.literal('png'), scale: z.union([z.literal(1), z.literal(2)]), transparent: z.boolean() }),
    z.strictObject({ format: z.literal('jpeg'), scale: z.union([z.literal(1), z.literal(2)]), quality: z.number().int().min(0).max(100) }),
]);
export const rasterExportSessionSchema = z.strictObject({
    version: z.literal(RASTER_EXPORT_RECORD_VERSION),
    kind: z.literal(RASTER_EXPORT_KIND),
    recordType: z.literal('session'),
    exportId: z.uuid(),
    commandId: z.string().min(1),
    planDigest: sha256Schema,
    openCommandId: z.string().min(1),
    documentKey: z.string().min(1),
    sourcePath: z.string().min(1),
    sourceSha256: sha256Schema,
    sourceIdentity: fileIdentitySchema,
    artboardIndex: z.number().int().nonnegative(),
    options: rasterExportOptionsSchema,
    workCopyPath: z.string().min(1),
    workCopyIdentity: fileIdentitySchema,
    stagingDirectory: z.string().min(1),
    stagedBasePath: z.string().min(1),
    outputPath: z.string().min(1),
    createdAt: z.string().min(1),
});
const base = (recordType) => ({
    version: z.literal(RASTER_EXPORT_RECORD_VERSION),
    kind: z.literal(RASTER_EXPORT_KIND),
    recordType: z.literal(recordType),
    exportId: z.uuid(),
    planDigest: sha256Schema,
    recordedAt: z.string().min(1),
});
const artboardSnapshotSchema = z.array(z.strictObject({
    index: z.number().int().nonnegative(),
    name: z.string(),
    rect: z.tuple([z.number(), z.number(), z.number(), z.number()]),
}));
const completedHostCallSchema = z.strictObject({ commandId: z.string().min(1), completedInactive: z.literal(true) });
export const rasterExportPrepareSchema = z.strictObject({
    ...base('prepare'),
    sourcePath: z.string().min(1),
    sourceSha256: sha256Schema,
    sourceIdentity: fileIdentitySchema,
    workCopyPath: z.string().min(1),
    stagingDirectory: z.string().min(1),
    outputParent: z.string().min(1),
    outputParentIdentity: z.strictObject({ dev: z.string().regex(/^\d+$/), ino: z.string().regex(/^\d+$/) }),
    outputPath: z.string().min(1),
});
export const rasterExportHostOpenSchema = z.strictObject({
    ...base('host_open'),
    open: completedHostCallSchema,
    workCopy: hostDocumentIdentitySchema,
    sourceKey: z.string().min(1),
    artboards: artboardSnapshotSchema,
    documentCountBefore: z.number().int().nonnegative(),
    documentCountAfter: z.number().int().positive(),
});
export const rasterExportBindingSchema = z.strictObject({
    ...base('artifact_binding'),
    export: completedHostCallSchema,
    sessionDigest: sha256Schema,
    stagedPath: z.string().min(1),
    stagedIdentity: fileIdentitySchema,
    mediaType: z.enum(['image/png', 'image/jpeg']),
    bytes: z.number().int().positive(),
    sha256: sha256Schema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    copyAfterExport: z.strictObject({ identity: hostDocumentIdentitySchema, activeArtboardIndex: z.number().int().nonnegative(), artboards: artboardSnapshotSchema }),
});
export const rasterExportHostTerminalSchema = z.strictObject({
    ...base('host_terminal'),
    close: completedHostCallSchema,
    closedBeforeClose: hostDocumentIdentitySchema,
    sourceKey: z.string().min(1),
    sourceSaved: z.literal(true),
    sourceFileRevision: z.string().min(1),
    documentCount: z.number().int().nonnegative(),
});
export const rasterExportArtifactSchema = z.strictObject({
    path: z.string().min(1),
    mediaType: z.enum(['image/png', 'image/jpeg']),
    bytes: z.number().int().positive(),
    sha256: sha256Schema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
});
export const rasterExportPublishedSchema = z.strictObject({
    ...base('published'),
    bindingDigest: sha256Schema,
    hostTerminalDigest: sha256Schema,
    artifact: rasterExportArtifactSchema,
    outputIdentity: fileIdentitySchema,
    sourcePath: z.string().min(1),
    artboardIndex: z.number().int().nonnegative(),
    options: rasterExportOptionsSchema,
});
export const rasterExportFailedSchema = z.strictObject({
    ...base('failed'),
    stage: z.string().min(1),
    reason: z.string().min(1),
    message: z.string(),
    evidenceDigests: z.record(z.string(), sha256Schema),
});
export const rasterExportCleanupSchema = z.strictObject({
    ...base('cleanup'),
    disposition: z.enum(['published', 'failed', 'abandoned_before_open', 'quarantine_released']),
    entries: z.array(z.strictObject({ path: z.string().min(1), removed: z.boolean(), reason: z.string() })),
});
export const rasterExportQuarantineSchema = z.strictObject({
    ...base('quarantine'),
    reason: z.string().min(1),
});
export const RASTER_EXPORT_RECORD_SCHEMAS = {
    prepare: rasterExportPrepareSchema,
    session: rasterExportSessionSchema,
    host_open: rasterExportHostOpenSchema,
    artifact_binding: rasterExportBindingSchema,
    host_terminal: rasterExportHostTerminalSchema,
    published: rasterExportPublishedSchema,
    failed: rasterExportFailedSchema,
    cleanup: rasterExportCleanupSchema,
    quarantine: rasterExportQuarantineSchema,
};
export class ExportSessionFormatError extends Error {
    exportId;
    reason;
    constructor(exportId, reason) {
        super(reason === 'raster_vector_export_session'
            ? `Export session ${exportId} is a raster/vector export (version 2) lease that this operation does not handle; it stays unresolved.`
            : `Export session ${exportId} is not a readable export record (${reason}); it stays unresolved and no host call was made.`);
        this.exportId = exportId;
        this.reason = reason;
        this.name = 'ExportSessionFormatError';
    }
}
export function classifyExportEntry(text, expected, schemas) {
    let value;
    try {
        value = JSON.parse(text);
    }
    catch {
        return { format: 'invalid', reason: 'malformed_json' };
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return { format: 'invalid', reason: 'not_an_object' };
    const entry = value;
    if (entry.version === RASTER_EXPORT_RECORD_VERSION) {
        if (entry.kind !== RASTER_EXPORT_KIND)
            return { format: 'invalid', reason: 'unknown_kind' };
        if (entry.recordType !== expected.recordType)
            return { format: 'invalid', reason: 'record_type_mismatch' };
        if (entry.exportId !== expected.exportId)
            return { format: 'invalid', reason: 'export_id_mismatch' };
        if (schemas.v2 === null)
            return { format: 'invalid', reason: 'schema_invalid' };
        const parsed = schemas.v2.safeParse(entry);
        return parsed.success ? { format: 'v2', record: parsed.data } : { format: 'invalid', reason: 'schema_invalid' };
    }
    if (entry.version === 1) {
        if (Object.hasOwn(entry, 'kind') || Object.hasOwn(entry, 'recordType'))
            return { format: 'invalid', reason: 'kind_on_version_1' };
        if (entry.exportId !== expected.exportId)
            return { format: 'invalid', reason: 'export_id_mismatch' };
        if (schemas.v1 === null)
            return { format: 'invalid', reason: 'schema_invalid' };
        const parsed = schemas.v1.safeParse(entry);
        return parsed.success ? { format: 'v1', record: parsed.data } : { format: 'invalid', reason: 'schema_invalid' };
    }
    return { format: 'invalid', reason: 'unsupported_version' };
}
export function assessRasterRecordSet(set, planDigest) {
    const types = Object.keys(set);
    for (const type of types) {
        const read = set[type];
        if (read.state === 'invalid')
            return { state: 'invalid', reason: `${type}: ${read.reason}` };
        if (read.state === 'v1')
            return { state: 'invalid', reason: `${type}: version 1 record under a version 2 export id` };
    }
    const has = (type) => set[type].state === 'v2';
    if (types.every((type) => !has(type)))
        return { state: 'none' };
    if (planDigest !== undefined) {
        for (const type of types) {
            const read = set[type];
            if (read.state === 'v2' && read.record.planDigest !== planDigest)
                return { state: 'invalid', reason: 'command_id_conflict' };
        }
    }
    if (!has('prepare'))
        return { state: 'invalid', reason: 'records without prepare' };
    const cleanup = set.cleanup.state === 'v2' ? set.cleanup.record : null;
    if (has('quarantine')) {
        if (cleanup === null)
            return has('session') ? { state: 'quarantined', released: false } : { state: 'invalid', reason: 'quarantine without a lease' };
        if (cleanup.disposition !== 'quarantine_released')
            return { state: 'invalid', reason: 'quarantine with another cleanup' };
        return { state: 'quarantined', released: !has('session') };
    }
    if (cleanup?.disposition === 'quarantine_released')
        return { state: 'invalid', reason: 'quarantine release without a quarantine' };
    if (!has('session') && !has('host_open') && !has('artifact_binding') && !has('host_terminal') && !has('published') && !has('failed')) {
        if (cleanup === null)
            return { state: 'prepared', abandoned: false };
        return cleanup.disposition === 'abandoned_before_open'
            ? { state: 'prepared', abandoned: true }
            : { state: 'invalid', reason: 'cleanup without a terminal record' };
    }
    if (cleanup?.disposition === 'abandoned_before_open')
        return { state: 'invalid', reason: 'abandoned before open but later records exist' };
    if (has('published') && has('failed'))
        return { state: 'invalid', reason: 'both published and failed' };
    if (has('artifact_binding') && !has('host_open'))
        return { state: 'invalid', reason: 'binding without host_open' };
    if (has('host_terminal') && !has('host_open'))
        return { state: 'invalid', reason: 'host_terminal without host_open' };
    if (has('published') && (!has('artifact_binding') || !has('host_terminal')))
        return { state: 'invalid', reason: 'published without binding and host_terminal' };
    if (cleanup !== null && cleanup.disposition !== (has('published') ? 'published' : has('failed') ? 'failed' : null)) {
        return { state: 'invalid', reason: 'cleanup disposition does not match the terminal record' };
    }
    if (has('session')) {
        return { state: 'leased' };
    }
    if (cleanup === null)
        return { state: 'invalid', reason: 'lease released before cleanup' };
    if (has('host_open') === false && has('failed') === false)
        return { state: 'invalid', reason: 'lease released without host evidence' };
    return has('published') ? { state: 'published' } : { state: 'failed' };
}
