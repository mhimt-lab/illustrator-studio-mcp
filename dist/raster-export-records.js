import { z } from 'zod';
import { fileIdentitySchema, hostDocumentIdentitySchema } from './document-backup.js';
import { canonicalSerialize } from './mutation-canonical.js';
export const RASTER_EXPORT_RECORD_VERSION = 2;
export const RASTER_SVG_RECORD_VERSION = 4;
export const RASTER_EXPORT_KIND = 'raster_vector_export';
export const RASTER_BATCH_EXPORT_KIND = 'raster_batch_export';
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
export const exactRasterSizeIntentSchema = z.union([
    z.strictObject({ mode: z.literal('width_px'), widthPx: z.number().int().min(1).max(4000) }),
    z.strictObject({ mode: z.literal('height_px'), heightPx: z.number().int().min(1).max(4000) }),
]);
const exactSizeFields = {
    sizeIntent: exactRasterSizeIntentSchema,
    renderScalePercent: z.number().positive().refine(value => Number(value.toFixed(12)) === value, 'The render scale must use the canonical 12-decimal representation.'),
};
export const exactRasterExportOptionsSchema = z.discriminatedUnion('format', [
    z.strictObject({ format: z.literal('png'), ...exactSizeFields, transparent: z.boolean() }),
    z.strictObject({ format: z.literal('jpeg'), ...exactSizeFields, quality: z.number().int().min(0).max(100) }),
]);
export const singleRasterExportOptionsSchema = z.union([rasterExportOptionsSchema, exactRasterExportOptionsSchema]);
export const exactRasterExpectedSchema = z.strictObject({ width: z.number().int().min(1).max(4000), height: z.number().int().min(1).max(4000) })
    .refine(size => size.width * size.height <= 12_000_000, 'Pixel ceiling exceeded.');
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
export const RASTER_EXACT_PX_RECORD_VERSION = 3;
const v3Version = { version: z.literal(RASTER_EXACT_PX_RECORD_VERSION) };
const exactIntentMatches = (record) => record.options.sizeIntent.mode === 'width_px' ? record.expected.width === record.options.sizeIntent.widthPx : record.expected.height === record.options.sizeIntent.heightPx;
export const rasterExactSessionSchema = rasterExportSessionSchema.extend({ ...v3Version, options: exactRasterExportOptionsSchema, expected: exactRasterExpectedSchema })
    .refine(exactIntentMatches, 'The requested side must equal the expected dimension.');
export const RASTER_EXACT_RECORD_SCHEMAS = {
    prepare: rasterExportPrepareSchema.extend(v3Version),
    session: rasterExactSessionSchema,
    host_open: rasterExportHostOpenSchema.extend(v3Version),
    artifact_binding: rasterExportBindingSchema.extend(v3Version),
    host_terminal: rasterExportHostTerminalSchema.extend(v3Version),
    published: rasterExportPublishedSchema.extend({ ...v3Version, options: exactRasterExportOptionsSchema, expected: exactRasterExpectedSchema })
        .refine(exactIntentMatches, 'The requested side must equal the expected dimension.'),
    failed: rasterExportFailedSchema.extend(v3Version),
    cleanup: rasterExportCleanupSchema.extend(v3Version),
    quarantine: rasterExportQuarantineSchema.extend(v3Version),
};
export function isSvgExportRecord(record) {
    return record.version === 4 || (record.version === 5 && Reflect.get(record, 'renderVersion') === 4);
}
export function isExactExportRecord(record) {
    return record.version === 3 || (record.version === 5 && Reflect.get(record, 'renderVersion') === 3);
}
export class ExportSessionFormatError extends Error {
    exportId;
    reason;
    constructor(exportId, reason) {
        super(reason === 'raster_vector_export_session'
            ? `Export session ${exportId} is a raster/vector export (version 2) lease that this operation does not handle; it stays unresolved.`
            : reason === 'save_as_session'
                ? `${exportId} is an illustrator_save_document_as session; run illustrator_reconcile_save_as with save_as_id=${exportId}. No host call was made.`
                : reason === 'raster_batch_export'
                    ? `${exportId} is a multi-artboard export record; run illustrator_reconcile_export with export_id=${exportId}. No host call was made.`
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
    if (entry.version === 5) {
        if (schemas.v5 === undefined)
            return { format: 'invalid', reason: 'unsupported_version' };
        if (entry.kind !== RASTER_EXPORT_KIND)
            return { format: 'invalid', reason: 'unknown_kind' };
        if (entry.recordType !== expected.recordType)
            return { format: 'invalid', reason: 'record_type_mismatch' };
        if (entry.exportId !== expected.exportId)
            return { format: 'invalid', reason: 'export_id_mismatch' };
        const parsed = schemas.v5.safeParse(entry);
        return parsed.success ? { format: 'v5', record: parsed.data } : { format: 'invalid', reason: 'schema_invalid' };
    }
    if ((entry.version === 3 || entry.version === 4) && entry.kind === 'save_as_session')
        return { format: 'invalid', reason: 'save_as_session' };
    if (entry.version === RASTER_EXPORT_RECORD_VERSION && entry.kind === RASTER_BATCH_EXPORT_KIND)
        return { format: 'invalid', reason: 'raster_batch_export' };
    if (entry.version === RASTER_SVG_RECORD_VERSION) {
        if (schemas.v4 === undefined)
            return { format: 'invalid', reason: 'unsupported_version' };
        if (entry.kind !== RASTER_EXPORT_KIND)
            return { format: 'invalid', reason: 'unknown_kind' };
        if (entry.recordType !== expected.recordType)
            return { format: 'invalid', reason: 'record_type_mismatch' };
        if (entry.exportId !== expected.exportId)
            return { format: 'invalid', reason: 'export_id_mismatch' };
        const parsed = schemas.v4.safeParse(entry);
        return parsed.success ? { format: 'v4', record: parsed.data } : { format: 'invalid', reason: 'schema_invalid' };
    }
    if (entry.version === RASTER_EXACT_PX_RECORD_VERSION) {
        if (schemas.v3 === undefined)
            return { format: 'invalid', reason: 'unsupported_version' };
        if (entry.kind !== RASTER_EXPORT_KIND)
            return { format: 'invalid', reason: 'unknown_kind' };
        if (entry.recordType !== expected.recordType)
            return { format: 'invalid', reason: 'record_type_mismatch' };
        if (entry.exportId !== expected.exportId)
            return { format: 'invalid', reason: 'export_id_mismatch' };
        const parsed = schemas.v3.safeParse(entry);
        return parsed.success ? { format: 'v3', record: parsed.data } : { format: 'invalid', reason: 'schema_invalid' };
    }
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
    const versions = new Set(types.flatMap(type => set[type].state === 'v2' && set[type].record.version !== undefined ? [set[type].record.version] : []));
    if (versions.size > 1)
        return { state: 'invalid', reason: 'mixed_record_versions' };
    if (versions.has(5)) {
        const raw = set;
        const prepare = raw.prepare.state === 'v2' && raw.prepare.record.version === 5 ? raw.prepare.record : null;
        if (prepare === null)
            return { state: 'invalid', reason: 'overwrite_without_prepare' };
        const projected = Object.fromEntries(types.map(type => {
            const read = raw[type];
            if (read.state !== 'v2')
                return [type, read];
            const record = read.record;
            return [type, { ...read, record: { ...record, version: record.version === 5 ? record.renderVersion : record.version } }];
        }));
        for (const type of types) {
            const read = raw[type];
            if (read.state === 'v2' && (read.record.version !== 5 || read.record.planDigest !== prepare.planDigest || read.record.renderVersion !== prepare.renderVersion || read.record.requestDigest !== prepare.requestDigest ||
                canonicalSerialize(read.record.expectedOutput) !== canonicalSerialize(prepare.expectedOutput)))
                return { state: 'invalid', reason: 'overwrite_intent_mismatch' };
        }
        if (prepare.expectedOutput.path !== prepare.outputPath || canonicalSerialize(prepare.expectedOutput.parentIdentity) !== canonicalSerialize(prepare.outputParentIdentity))
            return { state: 'invalid', reason: 'overwrite_destination_mismatch' };
        return assessRasterRecordSet(projected, planDigest);
    }
    if (versions.has(3)) {
        const exact = set;
        const prepare = exact.prepare.state === 'v2' ? exact.prepare.record : null;
        if (prepare === null)
            return { state: 'invalid', reason: 'records without prepare' };
        for (const type of types) {
            const read = exact[type];
            if (read.state === 'v2' && (read.record.version !== 3 || read.record.planDigest !== prepare.planDigest))
                return { state: 'invalid', reason: 'exact_record_intent_mismatch' };
        }
        const session = exact.session.state === 'v2' && exact.session.record.version === 3 ? exact.session.record : null;
        const binding = exact.artifact_binding.state === 'v2' ? exact.artifact_binding.record : null;
        const published = exact.published.state === 'v2' && exact.published.record.version === 3 ? exact.published.record : null;
        if (session !== null && binding !== null && (binding.sessionDigest !== exact.session.digest || binding.width !== session.expected.width || binding.height !== session.expected.height))
            return { state: 'invalid', reason: 'exact_binding_mismatch' };
        if (published !== null) {
            if (published.artifact.width !== published.expected.width || published.artifact.height !== published.expected.height)
                return { state: 'invalid', reason: 'exact_published_dimension_mismatch' };
            if (exact.artifact_binding.state !== 'v2' || published.bindingDigest !== exact.artifact_binding.digest || exact.host_terminal.state !== 'v2' || published.hostTerminalDigest !== exact.host_terminal.digest)
                return { state: 'invalid', reason: 'exact_published_binding_mismatch' };
            if (session !== null && (canonicalSerialize(session.options) !== canonicalSerialize(published.options) || session.expected.width !== published.expected.width || session.expected.height !== published.expected.height))
                return { state: 'invalid', reason: 'exact_published_intent_mismatch' };
        }
    }
    if (versions.has(4)) {
        const svg = set;
        const prepare = svg.prepare.state === 'v2' ? svg.prepare.record : null;
        if (prepare === null)
            return { state: 'invalid', reason: 'records without prepare' };
        for (const type of types) {
            const read = svg[type];
            if (read.state === 'v2' && (read.record.version !== 4 || read.record.planDigest !== prepare.planDigest))
                return { state: 'invalid', reason: 'svg_record_intent_mismatch' };
        }
        const v4 = (type) => {
            const read = svg[type];
            if (read.state !== 'v2')
                return null;
            const record = read.record;
            return record.version === 4 ? record : null;
        };
        const session = v4('session');
        const binding = v4('artifact_binding');
        const published = v4('published');
        const near = (actual, expected) => Math.abs(actual - expected) <= 0.0005 + 1e-9;
        if (session !== null && binding !== null) {
            if (binding.sessionDigest !== svg.session.digest)
                return { state: 'invalid', reason: 'svg_binding_session_mismatch' };
            if (!near(binding.width, session.expected.width) || !near(binding.height, session.expected.height))
                return { state: 'invalid', reason: 'svg_binding_dimension_mismatch' };
        }
        if (published !== null) {
            if (svg.artifact_binding.state !== 'v2' || published.bindingDigest !== svg.artifact_binding.digest || svg.host_terminal.state !== 'v2' || published.hostTerminalDigest !== svg.host_terminal.digest)
                return { state: 'invalid', reason: 'svg_published_binding_mismatch' };
            if (binding !== null && (published.artifact.sha256 !== binding.sha256 || published.artifact.bytes !== binding.bytes || published.artifact.width !== binding.width ||
                published.artifact.height !== binding.height || published.artifact.viewBox !== binding.viewBox))
                return { state: 'invalid', reason: 'svg_published_artifact_mismatch' };
            if (!near(published.artifact.width, published.expected.width) || !near(published.artifact.height, published.expected.height))
                return { state: 'invalid', reason: 'svg_published_dimension_mismatch' };
            if (session !== null && (canonicalSerialize(session.options) !== canonicalSerialize(published.options) || canonicalSerialize(session.expected) !== canonicalSerialize(published.expected) ||
                canonicalSerialize(session.expectedBounds) !== canonicalSerialize(published.expectedBounds) || session.artboardIndex !== published.artboardIndex))
                return { state: 'invalid', reason: 'svg_published_intent_mismatch' };
        }
    }
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
