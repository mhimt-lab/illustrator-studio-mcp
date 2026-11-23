import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import { isCanonicalCommandId } from './command-id.js';
import { backupSessionSchema, BACKUP_SESSION_MAX_BYTES } from './document-backup.js';
import { createOnceLinkAllowance, EXPORT_SESSION_MAX_BYTES, exportSessionSchema } from './document-export.js';
import { isMissingPath } from './private-state.js';
import { readSecurePrivateRecord } from './private-record.js';
import { OVERWRITE_RECORD_SCHEMAS } from './raster-overwrite-records.js';
import { rasterBatchSessionSchema, RASTER_BATCH_SESSION_MAX_BYTES } from './raster-batch-export-records.js';
import { RASTER_EXPORT_KIND, RASTER_EXPORT_SESSION_MAX_BYTES, rasterExactSessionSchema, rasterExportSessionSchema, } from './raster-export-records.js';
import { SAVE_AS_SESSION_VERSION, saveAsSessionV4Schema } from './save-as-session.js';
import { svgSessionSchema } from './svg-export-records.js';
import { WORK_COPY_OVERWRITE_KIND, WORK_COPY_RECORD_SCHEMAS } from './work-copy-overwrite-records.js';
const SESSION_SUFFIX = '.session.json';
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export class PreCreateLeaseReader {
    backupStore;
    exportStore;
    constructor(backupStore, exportStore) {
        this.backupStore = backupStore;
        this.exportStore = exportStore;
    }
    async read(sessionId) {
        if (!SESSION_ID.test(sessionId))
            return { state: 'unusable', reason: 'the session id is not a canonical UUID' };
        const backup = await this.readFile(this.backupStore.sessionPath(sessionId), BACKUP_SESSION_MAX_BYTES);
        if (backup.state === 'present')
            return this.parse('backup', sessionId, backup);
        if (backup.state === 'unusable')
            return backup;
        const exported = await this.readFile(this.exportStore.sessionPath(sessionId), Math.max(EXPORT_SESSION_MAX_BYTES, RASTER_EXPORT_SESSION_MAX_BYTES, RASTER_BATCH_SESSION_MAX_BYTES, 16_384));
        if (exported.state === 'absent')
            return { state: 'absent' };
        if (exported.state === 'unusable')
            return exported;
        return this.parse('exports', sessionId, exported);
    }
    async evidence(sessionId, families) {
        const first = await this.read(sessionId);
        if (first.state === 'absent')
            return { refusal: `No session ${sessionId} is unresolved.` };
        if (first.state === 'unusable')
            return { refusal: `The session ${sessionId} cannot be used as evidence: ${first.reason}.` };
        const lease = first.lease;
        if (!families.includes(lease.family))
            return { refusal: `The session ${sessionId} is a ${lease.family} session; its own reconcile tool resolves it.` };
        const reread = async () => {
            const again = await this.read(sessionId);
            if (again.state !== 'lease')
                return 'gone';
            if ((await this.countClaiming(lease.openCommandId)) !== 1)
                return 'ambiguous';
            return { boundCommandId: again.lease.openCommandId, sessionDigest: again.lease.digest, sessionIdentity: again.lease.identity };
        };
        return { evidence: {
                kind: 'external_session_open_pending', family: lease.family, sessionId, boundCommandId: lease.openCommandId,
                sessionDigest: lease.digest, sessionIdentity: lease.identity, reread,
            } };
    }
    async countClaiming(openCommandId) {
        let claims = 0;
        const names = [
            ...(await this.listIds(this.backupStore.recordDirectory)),
            ...(await this.listIds(this.exportStore.recordDirectory)),
        ];
        for (const id of new Set(names)) {
            const read = await this.read(id);
            if (read.state === 'lease' && read.lease.openCommandId === openCommandId)
                claims += 1;
            else if (read.state === 'unusable')
                claims += 1;
        }
        return claims;
    }
    async listIds(directory) {
        try {
            return (await readdir(directory)).filter((name) => name.endsWith(SESSION_SUFFIX)).map((name) => name.slice(0, -SESSION_SUFFIX.length))
                .filter((id) => SESSION_ID.test(id));
        }
        catch (error) {
            if (isMissingPath(error))
                return [];
            throw error;
        }
    }
    async readFile(path, maxBytes) {
        const before = await lstat(path, { bigint: true }).catch((error) => {
            if (isMissingPath(error))
                return null;
            throw error;
        });
        if (before === null)
            return { state: 'absent' };
        if (!before.isFile())
            return { state: 'unusable', reason: 'the lease is not a regular file' };
        const record = await readSecurePrivateRecord(path, maxBytes, { maxLinkCount: await createOnceLinkAllowance(path) });
        if (record.state === 'missing')
            return { state: 'absent' };
        if (record.state === 'invalid')
            return { state: 'unusable', reason: `the lease file is unsafe (${record.reason})` };
        const after = await lstat(path, { bigint: true }).catch(() => null);
        if (after === null || after.dev !== before.dev || after.ino !== before.ino)
            return { state: 'unusable', reason: 'the lease file was replaced while it was read' };
        return { state: 'present', text: record.text, bytes: record.bytes, identity: { dev: before.dev.toString(), ino: before.ino.toString() } };
    }
    parse(where, sessionId, file) {
        let value;
        try {
            value = JSON.parse(file.text);
        }
        catch {
            return { state: 'unusable', reason: 'the lease is not JSON' };
        }
        if (value === null || typeof value !== 'object' || Array.isArray(value))
            return { state: 'unusable', reason: 'the lease is not an object' };
        const entry = value;
        const done = (family, openCommandId, idField) => {
            if (idField !== sessionId)
                return { state: 'unusable', reason: 'the lease names another session id' };
            if (!isCanonicalCommandId(openCommandId))
                return { state: 'unusable', reason: 'the lease has no canonical open command id' };
            return { state: 'lease', lease: { family, sessionId, openCommandId, digest: createHash('sha256').update(file.bytes).digest('hex'), identity: file.identity } };
        };
        const invalid = (what) => ({ state: 'unusable', reason: `the lease is not a valid ${what} session` });
        if (where === 'backup') {
            const parsed = backupSessionSchema.safeParse(entry);
            return parsed.success ? done('backup', parsed.data.openCommandId, parsed.data.backupId) : invalid('backup');
        }
        if (entry.kind === 'save_as_session') {
            if (entry.version !== SAVE_AS_SESSION_VERSION)
                return { state: 'unusable', reason: 'a save-as session of version 3 carries no open command id' };
            const parsed = saveAsSessionV4Schema.safeParse(entry);
            return parsed.success ? done('save_as', parsed.data.openCommandId, parsed.data.saveAsId) : invalid('save-as');
        }
        if (entry.kind === WORK_COPY_OVERWRITE_KIND) {
            const parsed = WORK_COPY_RECORD_SCHEMAS.session.safeParse(entry);
            return parsed.success ? done('work_copy', parsed.data.openCommandId, parsed.data.exportId) : invalid('work-copy export');
        }
        if (entry.kind === 'raster_batch_export') {
            const parsed = rasterBatchSessionSchema.safeParse(entry);
            return parsed.success ? done('raster_batch', parsed.data.openCommandId, parsed.data.exportId) : invalid('batch export');
        }
        if (entry.kind === RASTER_EXPORT_KIND) {
            const schema = entry.version === 5 ? OVERWRITE_RECORD_SCHEMAS.session : entry.version === 2 ? rasterExportSessionSchema
                : entry.version === 3 ? rasterExactSessionSchema : entry.version === 4 ? svgSessionSchema : null;
            const parsed = schema === null ? null : schema.safeParse(entry);
            if (parsed === null || !parsed.success)
                return invalid('raster export');
            const data = parsed.data;
            return done('raster', data.openCommandId, data.exportId);
        }
        if (entry.version === 1 && !Object.hasOwn(entry, 'kind')) {
            const parsed = exportSessionSchema.safeParse(entry);
            return parsed.success ? done('export', parsed.data.openCommandId, parsed.data.exportId) : invalid('export');
        }
        return { state: 'unusable', reason: 'the lease is of an unknown kind or version' };
    }
}
