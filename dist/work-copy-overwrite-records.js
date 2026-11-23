import { createHash } from 'node:crypto';
import { join, dirname, basename } from 'node:path';
import { z } from 'zod';
import { fileIdentitySchema, hostDocumentIdentitySchema } from './document-backup.js';
import { documentContextSchema } from './mutation-result-schema-core.js';
import { atomicCreatePrivateRecord, readSecurePrivateRecord } from './private-record.js';
import { canonicalSha256 } from './mutation-canonical.js';
import { createOnceLinkAllowance, workCopyFileName } from './document-export.js';
import { expectedOutputSchema, replacementIntentSchema, replacementSummarySchema, directoryIdentitySchema, replacementStat } from './output-replacement.js';
import { pdfExportResultSchema } from './pdf-export.js';
export const WORK_COPY_OVERWRITE_VERSION = 6;
export const WORK_COPY_OVERWRITE_KIND = 'work_copy_export';
export const WORK_COPY_PREVIOUS_LIMIT = 1024 * 1024 * 1024;
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const completed = z.strictObject({ commandId: z.string().min(1), completedInactive: z.literal(true) });
const common = { version: z.literal(6), kind: z.literal('work_copy_export'), operation: z.enum(['pdf', 'outlined']), format: z.enum(['ai', 'pdf']),
    exportId: z.uuid(), planDigest: sha, requestDigest: sha, expectedOutput: expectedOutputSchema };
const board = z.strictObject({ index: z.number().int().nonnegative(), name: z.string(), rect: z.tuple([z.number(), z.number(), z.number(), z.number()]) });
const counts = z.strictObject({ pageItems: z.number().int().nonnegative(), textFrames: z.number().int().nonnegative(), groupItems: z.number().int().nonnegative(),
    compoundPathItems: z.number().int().nonnegative(), pathItems: z.number().int().nonnegative(), placedItems: z.number().int().nonnegative(), rasterItems: z.number().int().nonnegative() });
const layer = z.lazy(() => z.strictObject({
    name: z.string(), visible: z.boolean(), locked: z.boolean(), children: z.array(layer),
}));
const pdfPlan = pdfExportResultSchema.options[0].shape.plan.extend({ preset: z.string(), preserveEditability: z.boolean().nullable() });
export const workCopyOptionsSchema = z.discriminatedUnion('operation', [
    z.strictObject({ operation: z.literal('pdf'), plan: pdfPlan }),
    z.strictObject({ operation: z.literal('outlined'), pdfPreset: z.string().nullable() }),
]);
const source = z.strictObject({ document: documentContextSchema, artboards: z.array(board).min(1), layers: z.array(layer), counts,
    path: z.string().min(1), identity: fileIdentitySchema, bytes: z.number().int().positive(), sha256: sha });
const outline = z.strictObject({ workCopy: hostDocumentIdentitySchema, textFramesBefore: z.number().int().nonnegative(), textFramesAfter: z.number().int().nonnegative(),
    errors: z.array(z.strictObject({ index: z.number().int().nonnegative(), message: z.string() })),
    restoreErrors: z.array(z.strictObject({ layer: z.string(), attribute: z.enum(['locked', 'visible']), message: z.string() })), artboards: z.array(board), counts, layers: z.array(layer) });
const save = z.strictObject({ workCopy: hostDocumentIdentitySchema, pathBefore: z.string(), pathAfter: z.string(), outputExists: z.boolean(), artboardCount: z.number().int().nonnegative(),
    preserveEditability: z.strictObject({ applied: z.boolean().nullable(), note: z.string().nullable() }).optional() });
const verification = z.strictObject({ bytes: z.number().int().positive(), sha256: sha, identity: fileIdentitySchema, header: z.string(), pageObjects: z.number().int().nonnegative(), fontObjects: z.number().int().nonnegative(), imageObjects: z.number().int().nonnegative() });
const outlinedPayload = z.strictObject({ operation: z.literal('outlined'), sourcePath: z.string(), sourceName: z.string(), sourceFileRevision: z.string(), format: z.enum(['ai', 'pdf']), outputPath: z.string(), pdfPreset: z.string().nullable(),
    outline: z.strictObject({ textFramesBefore: z.number().int().nonnegative(), textFramesAfter: z.literal(0), groupItemsAdded: z.number().int(), pageItemsBefore: z.number().int().nonnegative(), pageItemsAfter: z.number().int().nonnegative() }),
    verification: z.strictObject({ method: z.literal('pdf_header_scan'), header: z.string(), pageObjects: z.number().int().nonnegative(), artboardCount: z.number().int().nonnegative(), fontObjects: z.number().int().nonnegative() }), sourcePreserved: z.literal(true) });
const pdfPayload = pdfExportResultSchema.options[1].omit({ outcome: true, workCopy: true, staging: true, hostCalls: true, durationMs: true }).extend({ operation: z.literal('pdf') });
export const workCopyPayloadSchema = z.discriminatedUnion('operation', [pdfPayload, outlinedPayload]);
const artifact = z.strictObject({ path: z.string(), identity: fileIdentitySchema, bytes: z.number().int().positive(), sha256: sha });
const entry = z.strictObject({ path: z.string(), expectedIdentity: fileIdentitySchema.nullable(), removed: z.boolean(), reason: z.string() });
const schemas = {
    prepare: z.strictObject({ ...common, recordType: z.literal('prepare'), openCommandId: z.string().min(1).nullable(), source, options: workCopyOptionsSchema, requestedDocumentKey: z.string().min(1),
        workCopyPath: z.string(), stagingDirectory: z.string(), stagedPath: z.string(), outputPath: z.string(), outputParent: z.string(), outputParentIdentity: directoryIdentitySchema }),
    session: z.strictObject({ ...common, recordType: z.literal('session'), prepareDigest: sha, openCommandId: z.string(), workCopyIdentity: fileIdentitySchema, bytes: z.number().int().positive(), sha256: sha,
        stageIdentity: directoryIdentitySchema, createdAt: z.string() }),
    host_open: z.strictObject({ ...common, recordType: z.literal('host_open'), prepareDigest: sha, sessionDigest: sha, open: completed, workCopy: hostDocumentIdentitySchema, copyFile: z.strictObject({ path: z.string(), identity: fileIdentitySchema, bytes: z.number().int().positive(), sha256: sha }), stageIdentity: directoryIdentitySchema, sourceKey: z.string(), documentCountBefore: z.number().int().nonnegative(), documentCountAfter: z.number().int().positive(), artboards: z.array(board) }),
    host_prepare: z.strictObject({ ...common, recordType: z.literal('host_prepare'), hostOpenDigest: sha, outlineCall: completed, outline }),
    artifact_binding: z.strictObject({ ...common, recordType: z.literal('artifact_binding'), sessionDigest: sha, hostOpenDigest: sha, hostPrepareDigest: sha.nullable(), saveCall: completed, save, artifact, verification, payload: workCopyPayloadSchema }),
    host_terminal: z.strictObject({ ...common, recordType: z.literal('host_terminal'), bindingDigest: sha.nullable(), close: completed, closedBeforeClose: hostDocumentIdentitySchema,
        sourceKey: z.string(), sourceSaved: z.boolean(), sourceFileRevision: z.string(), sourceIdentity: fileIdentitySchema, sourceSha256: sha, saveObservation: save.nullable(), attempts: z.array(z.strictObject({ step: z.enum(['open', 'outline', 'save', 'close']), commandId: z.string().min(1), completedInactive: z.literal(true) })).min(2).max(4), scopeDocuments: z.literal(0), documentCount: z.number().int().nonnegative() }),
    published: z.strictObject({ ...common, recordType: z.literal('published'), bindingDigest: sha, hostTerminalDigest: sha, artifact, payload: workCopyPayloadSchema, replacement: replacementSummarySchema, recordedAt: z.string() }),
    failed: z.strictObject({ ...common, recordType: z.literal('failed'), stage: z.string(), reason: z.string(), message: z.string(), sessionDigest: sha.nullable(), sessionSnapshot: z.string().max(16384).nullable(), abandonment: z.strictObject({ inventory: completed, scopeDocuments: z.literal(0) }).nullable(), evidenceDigests: z.record(z.string(), sha), replacement: replacementSummarySchema, recordedAt: z.string() }),
    cleanup: z.strictObject({ ...common, recordType: z.literal('cleanup'), terminalDigest: sha, sessionDigest: sha.nullable(), disposition: z.enum(['published', 'failed']), entries: z.array(entry) }),
    quarantine: z.strictObject({ ...common, recordType: z.literal('quarantine'), evidenceDigests: z.record(z.string(), sha), residue: z.array(z.string()), reason: z.string() }),
};
export const WORK_COPY_RECORD_SCHEMAS = schemas;
export const workCopyIntentSchema = replacementIntentSchema.omit({ version: true, kind: true, renderVersion: true }).extend({ ...common, recordType: z.literal('replacement_intent') });
export const workCopyDigest = (value) => canonicalSha256(value);
export const workCopyCommon = (p) => ({ version: 6, kind: 'work_copy_export', operation: p.operation, format: p.format, exportId: p.exportId, planDigest: p.planDigest, requestDigest: p.requestDigest, expectedOutput: p.expectedOutput });
const suffixes = { prepare: '.prepare.json', session: '.session.json', host_open: '.session-host.json', host_prepare: '.prepared.json', artifact_binding: '.binding.json', host_terminal: '.host-terminal.json', published: '.json', failed: '.failed.json', cleanup: '.cleanup.json', quarantine: '.quarantine.json' };
export class WorkCopyOverwriteStore {
    store;
    metrics = { records: 0, fsyncs: 0, durationMs: 0 };
    constructor(store) {
        this.store = store;
    }
    path(id, type) { z.uuid().parse(id); return join(this.store.recordDirectory, `${id}${type === 'replacement_intent' ? '.replacement-intent.json' : suffixes[type]}`); }
    async read(id, type) {
        const path = this.path(id, type);
        if (await replacementStat(this.store.recordDirectory) === null)
            return { state: 'absent' };
        const read = await readSecurePrivateRecord(path, type === 'session' ? 16384 : 65536, { maxLinkCount: await createOnceLinkAllowance(path) });
        if (read.state === 'missing')
            return { state: 'absent' };
        if (read.state !== 'valid')
            return { state: 'invalid', reason: 'unsafe_file' };
        let value;
        try {
            value = JSON.parse(read.text);
        }
        catch {
            return { state: 'invalid', reason: 'malformed_json' };
        }
        const parsed = schemas[type].safeParse(value);
        if (!parsed.success || parsed.data.exportId !== id || (parsed.data.operation === 'pdf' && parsed.data.format !== 'pdf'))
            return { state: 'invalid', reason: 'schema_invalid' };
        return { state: 'valid', record: parsed.data, digest: createHash('sha256').update(read.bytes).digest('hex') };
    }
    async set(id) {
        const reads = await Promise.all(Object.keys(schemas).map(async (type) => [type, await this.read(id, type)]));
        return { family: 'work_copy_export', records: Object.fromEntries(reads) };
    }
    async openSession(value) { return this.write('session', value); }
    async readSession(id) { return this.read(id, 'session'); }
    async write(type, value) {
        const parsed = schemas[type].parse(value);
        if (parsed.operation === 'pdf' && parsed.format !== 'pdf')
            throw new Error('Invalid work-copy operation/format.');
        return this.writeBytes(this.path(parsed.exportId, type), parsed, type === 'session' ? 16384 : 65536);
    }
    async writeBytes(path, value, limit) {
        const bytes = `${JSON.stringify(value, null, 2)}\n`;
        if (Buffer.byteLength(bytes) > limit)
            throw new Error('The work-copy export record exceeds its size limit.');
        const started = performance.now();
        try {
            await atomicCreatePrivateRecord(path, bytes, { durabilityBoundary: boundary => {
                    if (['temporary_synced', 'publish_parent_synced', 'temporary_unlink_parent_synced'].includes(boundary))
                        this.metrics.fsyncs++;
                } });
            this.metrics.records++;
        }
        finally {
            this.metrics.durationMs += performance.now() - started;
        }
        return createHash('sha256').update(bytes).digest('hex');
    }
    async writeIntent(value) { return this.writeBytes(this.path(value.exportId, 'replacement_intent'), workCopyIntentSchema.parse(value), 65536); }
    async intent(id) {
        const path = this.path(id, 'replacement_intent');
        const read = await readSecurePrivateRecord(path, 65536, { maxLinkCount: await createOnceLinkAllowance(path) });
        if (read.state === 'missing')
            return null;
        if (read.state !== 'valid')
            throw new Error('The work-copy replacement intent is unsafe.');
        const intent = workCopyIntentSchema.parse(JSON.parse(read.text));
        if (intent.exportId !== id)
            throw new Error('The intent belongs to another export.');
        return intent;
    }
}
export function assertWorkCopyPaths(p, store) {
    const root = store.recordDirectory, parent = dirname(p.outputPath);
    if (p.workCopyPath !== join(root, workCopyFileName(p.exportId, p.source.path)) ||
        p.stagingDirectory !== join(parent, `.illustrator-studio-mcp-export-${p.exportId}`) || p.stagedPath !== join(p.stagingDirectory, basename(p.outputPath)) ||
        p.outputParent !== parent || p.expectedOutput.path !== p.outputPath || workCopyDigest(p.outputParentIdentity) !== workCopyDigest(p.expectedOutput.parentIdentity))
        throw new Error('The work-copy export paths differ from their derived locations.');
}
