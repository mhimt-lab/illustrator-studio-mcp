import { randomBytes } from 'node:crypto';
import { lstat, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { atomicCreatePrivateRecord, atomicReplacePrivateRecord, PRIVATE_RECORD_LIMITS, readSecurePrivateRecord, } from './private-record.js';
import { ensurePrivateDirectory, isMissingPath, withPrivateDirectoryScope } from './private-state.js';
import { attributeEntry, ensureQuarantineArea, publishQuarantineManifest, quarantineArea, quarantineManifestExists, readQuarantineManifest, stateRootDevice, temporaryTwinPattern, } from './state-quarantine.js';
export const EDIT_SESSION_RECORD_VERSION = 1;
export const EDIT_SESSION_MAX_ITEMS = 2_000;
export const EDIT_SESSION_SCAN_DEADLINE_MS = 15_000;
const sessionIdPattern = /^es_[0-9a-f]{32}$/u;
const digestPattern = /^[0-9a-f]{16}$/u;
const aggregatePattern = /^([0-9a-f]{8})([0-9a-f]{8}):(0|[1-9][0-9]*)$/u;
export const editSessionSuspendReasonSchema = z.enum([
    'file_changed',
    'structure_changed',
    'item_aggregate_mismatch',
    'indeterminate',
    'chain_evidence_missing',
    'released_unverified',
]);
const headSchema = z.strictObject({
    structureDigest: z.string().regex(digestPattern),
    itemAggregate: z.string().regex(aggregatePattern),
    sequence: z.number().int().nonnegative(),
    commandId: z.string().min(1).nullable(),
});
const inodeSchema = z.strictObject({ dev: z.string().regex(/^\d+$/u), ino: z.string().regex(/^\d+$/u) });
export const editSessionRecordSchema = z.strictObject({
    recordVersion: z.literal(EDIT_SESSION_RECORD_VERSION),
    sessionId: z.string().regex(sessionIdPattern),
    sourcePath: z.string().min(1),
    sourceInode: inodeSchema,
    sourceFileRevision: z.string().min(1),
    backupId: z.uuid(),
    openingDocumentKey: z.string().min(1),
    head: headSchema,
    state: z.enum(['open', 'suspended', 'closed']),
    suspendReason: editSessionSuspendReasonSchema.nullable(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
}).superRefine((record, context) => {
    if (record.state === 'open' && record.suspendReason !== null) {
        context.addIssue({ code: 'custom', message: 'An open session has no suspend reason.', path: ['suspendReason'] });
    }
    if (record.state === 'suspended' && record.suspendReason === null) {
        context.addIssue({ code: 'custom', message: 'A suspended session names its reason.', path: ['suspendReason'] });
    }
    if ((record.head.sequence === 0) !== (record.head.commandId === null)) {
        context.addIssue({ code: 'custom', message: 'Only the opening head has no command id.', path: ['head'] });
    }
});
export class EditSessionRecordError extends Error {
    constructor(message) {
        super(message);
        this.name = 'EditSessionRecordError';
    }
}
export function newEditSessionId() {
    return `es_${randomBytes(16).toString('hex')}`;
}
export function isEditSessionId(value) {
    return sessionIdPattern.test(value);
}
const LANE = 4_294_967_296;
function parseAggregate(text) {
    const match = aggregatePattern.exec(text);
    if (match === null)
        throw new EditSessionRecordError(`Malformed item aggregate: ${text}`);
    return { a: Number.parseInt(match[1], 16), b: Number.parseInt(match[2], 16), n: Number(match[3]) };
}
export function aggregateItemCount(aggregate) {
    return parseAggregate(aggregate).n;
}
function formatAggregate(aggregate) {
    const hex = (value) => value.toString(16).padStart(8, '0');
    return `${hex(aggregate.a)}${hex(aggregate.b)}:${aggregate.n}`;
}
function addRow(aggregate, rowHash, sign) {
    if (!digestPattern.test(rowHash))
        throw new EditSessionRecordError(`Malformed row hash: ${rowHash}`);
    aggregate.a = (aggregate.a + sign * Number.parseInt(rowHash.slice(0, 8), 16) + LANE) % LANE;
    aggregate.b = (aggregate.b + sign * Number.parseInt(rowHash.slice(8), 16) + LANE) % LANE;
    aggregate.n += sign;
}
export function aggregateItemRows(rowHashes) {
    const aggregate = { a: 0, b: 0, n: 0 };
    for (const hash of rowHashes)
        addRow(aggregate, hash, 1);
    return formatAggregate(aggregate);
}
export function advanceItemAggregate(aggregate, beforeRowHashes, afterRowHashes) {
    const next = parseAggregate(aggregate);
    for (const hash of beforeRowHashes)
        addRow(next, hash, -1);
    if (next.n < 0)
        throw new EditSessionRecordError('The before rows are not contained in the item aggregate.');
    for (const hash of afterRowHashes)
        addRow(next, hash, 1);
    return formatAggregate(next);
}
export const editSessionStructureSchema = z.object({
    digest: z.string().regex(digestPattern),
    itemCount: z.number().int().nonnegative().nullable(),
    layerCount: z.number().int().nonnegative(),
    sublayerCount: z.number().int().nonnegative(),
    durationMs: z.number(),
});
export const editSessionScanSchema = z.object({
    aggregate: z.string().regex(aggregatePattern).nullable(),
    total: z.number().int().nonnegative().nullable(),
    visited: z.number().int().nonnegative(),
    missingUuid: z.number().int().nonnegative(),
    unmeasured: z.number().int().nonnegative(),
    truncated: z.boolean(),
    overLimit: z.boolean(),
    layerRows: z.number().int().nonnegative(),
    durationMs: z.number(),
});
function sameInode(left, right) {
    return left !== null && left.dev === right.dev && left.ino === right.ino;
}
function unmeasuredStructure(structure) {
    if (structure.itemCount === null || structure.itemCount > EDIT_SESSION_MAX_ITEMS)
        return 'document_too_large';
    if (structure.sublayerCount > 0)
        return 'unmeasured_content';
    return null;
}
export function decideEditSessionAdmission(session, observed) {
    if (session.state === 'missing')
        return { outcome: 'no_session' };
    if (session.state === 'invalid')
        return { outcome: 'refuse', reason: 'session_record_invalid' };
    const { record } = session;
    if (record.state === 'closed')
        return { outcome: 'refuse', reason: 'session_closed' };
    if (record.state === 'suspended')
        return { outcome: 'refuse', reason: 'session_suspended' };
    if (observed.sourcePath !== record.sourcePath || !sameInode(observed.sourceInode, record.sourceInode) ||
        observed.sourceFileRevision !== record.sourceFileRevision) {
        return { outcome: 'suspend', sessionId: record.sessionId, reason: 'file_changed' };
    }
    if (observed.structure.digest !== record.head.structureDigest) {
        return { outcome: 'suspend', sessionId: record.sessionId, reason: 'structure_changed' };
    }
    if (observed.hostProfile !== 'foreground_unlocked')
        return { outcome: 'refuse', reason: 'unmeasured_host_state' };
    const unmeasured = unmeasuredStructure(observed.structure);
    if (unmeasured !== null)
        return { outcome: 'refuse', reason: unmeasured };
    if (aggregateItemCount(record.head.itemAggregate) - observed.structure.layerCount > EDIT_SESSION_MAX_ITEMS) {
        return { outcome: 'refuse', reason: 'document_too_large' };
    }
    return { outcome: 'admit', sessionId: record.sessionId, head: record.head };
}
export function decideEditSessionOpen(existing, backup, observed) {
    const refuse = (reason) => ({ outcome: 'refuse', reason });
    if (existing.some((entry) => entry.state === 'invalid'))
        return refuse('session_record_invalid');
    if (existing.some((entry) => entry.state === 'valid' && entry.record.state !== 'closed' &&
        entry.record.sourcePath === observed.sourcePath))
        return refuse('active_session_exists');
    if (observed.mutationProfile !== 'saved_file' || !observed.saved || observed.sourceFileRevision === null) {
        return refuse('not_saved_file');
    }
    if (backup.sourcePath !== observed.sourcePath || backup.sourceFileRevision !== observed.sourceFileRevision ||
        backup.sha256 !== observed.sourceSha256)
        return refuse('backup_mismatch');
    if (observed.hostProfile !== 'foreground_unlocked')
        return refuse('unmeasured_host_state');
    const unmeasured = unmeasuredStructure(observed.structure);
    if (unmeasured !== null)
        return refuse(unmeasured);
    const { scan } = observed;
    if (scan.overLimit)
        return refuse('document_too_large');
    if (scan.missingUuid > 0 || scan.unmeasured > 0)
        return refuse('unmeasured_content');
    if (scan.truncated || scan.aggregate === null || !observed.structureStable || scan.total === null ||
        observed.structure.itemCount === null || scan.total < observed.structure.itemCount ||
        scan.visited !== scan.total)
        return refuse('scan_incomplete');
    return { outcome: 'open', head: { structureDigest: observed.structure.digest, itemAggregate: scan.aggregate, sequence: 0, commandId: null } };
}
const RECORD_SUFFIX = '.json';
function serialize(record) {
    const contents = `${JSON.stringify(editSessionRecordSchema.parse(record), null, 2)}\n`;
    if (Buffer.byteLength(contents) > PRIVATE_RECORD_LIMITS.editSession) {
        throw new EditSessionRecordError('The edit session record exceeds its size limit.');
    }
    return contents;
}
function parseRecord(sessionId, text) {
    let value;
    try {
        value = JSON.parse(text);
    }
    catch {
        return { state: 'invalid', reason: 'malformed_json' };
    }
    if (typeof value === 'object' && value !== null && 'recordVersion' in value &&
        value.recordVersion !== EDIT_SESSION_RECORD_VERSION) {
        return { state: 'invalid', reason: 'unsupported_version' };
    }
    const parsed = editSessionRecordSchema.safeParse(value);
    if (!parsed.success)
        return { state: 'invalid', reason: 'malformed_record' };
    if (parsed.data.sessionId !== sessionId)
        return { state: 'invalid', reason: 'session_id_mismatch' };
    return { state: 'valid', record: parsed.data };
}
const TRANSIENT_READ_FAILURES = new Set(['changed_during_read', 'read_failed', 'open_failed']);
export function isTransientEditSessionReadFailure(reason) {
    return TRANSIENT_READ_FAILURES.has(reason);
}
export class EditSessionStore {
    stateRoot;
    leaseGuard;
    recordOptions;
    constructor(stateRoot, leaseGuard, recordOptions = {}) {
        this.stateRoot = stateRoot;
        this.leaseGuard = leaseGuard;
        this.recordOptions = recordOptions;
    }
    get recordDirectory() {
        return join(this.stateRoot, 'edit-sessions');
    }
    recordPath(sessionId) {
        if (!isEditSessionId(sessionId))
            throw new EditSessionRecordError('session_id must be es_ followed by 32 lowercase hex digits.');
        return join(this.recordDirectory, `${sessionId}${RECORD_SUFFIX}`);
    }
    async ensure() {
        await ensurePrivateDirectory(this.stateRoot, 'state root');
        await ensurePrivateDirectory(this.recordDirectory, 'edit session record directory');
    }
    async read(sessionId) {
        const path = this.recordPath(sessionId);
        if (await quarantineManifestExists(this.stateRoot, 'edit-sessions', sessionId))
            return { state: 'invalid', reason: 'quarantined' };
        return await this.readRecord(path, sessionId);
    }
    async readRecord(path, sessionId) {
        let record;
        try {
            record = await readSecurePrivateRecord(path, PRIVATE_RECORD_LIMITS.editSession);
        }
        catch (error) {
            if (isMissingPath(error))
                return { state: 'missing' };
            throw error;
        }
        if (record.state === 'missing')
            return { state: 'missing' };
        if (record.state === 'invalid')
            return { state: 'invalid', reason: record.reason };
        return parseRecord(sessionId, record.text);
    }
    async list() {
        let names;
        try {
            names = await readdir(this.recordDirectory);
        }
        catch (error) {
            if (isMissingPath(error))
                return [];
            throw error;
        }
        const entries = [];
        for (const name of names.sort()) {
            if (name.endsWith('.tmp'))
                continue;
            const sessionId = name.endsWith(RECORD_SUFFIX) ? name.slice(0, -RECORD_SUFFIX.length) : null;
            if (sessionId === null || !isEditSessionId(sessionId)) {
                entries.push({ sessionId: null, name, read: { state: 'invalid', reason: 'unexpected_entry' } });
                continue;
            }
            entries.push({ sessionId, name, read: await this.read(sessionId) });
        }
        return entries;
    }
    async findActiveForPath(sourcePath) {
        const entries = await this.list();
        if (entries.some((entry) => entry.read.state === 'invalid'))
            return { state: 'invalid', reason: 'unreadable_session_record' };
        const active = entries.flatMap((entry) => entry.read.state === 'valid' && entry.read.record.state !== 'closed' &&
            entry.read.record.sourcePath === sourcePath ? [entry.read.record] : []);
        if (active.length > 1)
            return { state: 'invalid', reason: 'duplicate_active_session' };
        return active.length === 1 ? { state: 'valid', record: active[0] } : { state: 'missing' };
    }
    async quarantine(sessionId, options) {
        const path = this.recordPath(sessionId);
        if (options.confirmSessionId !== sessionId) {
            throw new EditSessionRecordError('Quarantining an edit session requires confirmSessionId to exactly match the session id.');
        }
        if (typeof process.getuid !== 'function')
            throw new EditSessionRecordError('Quarantine cannot verify the operating-system user.');
        const selfUid = process.getuid();
        const hooks = options.hooks ?? {};
        const name = `${sessionId}${RECORD_SUFFIX}`;
        const { area } = quarantineArea(this.stateRoot, 'edit-sessions');
        const moved = join(area, `${sessionId}.record${RECORD_SUFFIX}`);
        const existing = await readQuarantineManifest(this.stateRoot, 'edit-sessions', sessionId);
        if (existing.state === 'invalid') {
            throw new EditSessionRecordError(`Edit session ${sessionId} has an unreadable quarantine manifest (${existing.reason}); it stays refused.`);
        }
        let manifest;
        if (existing.state === 'valid') {
            manifest = existing.manifest;
        }
        else {
            const first = await this.quarantineObservation(path, name, selfUid);
            const second = await this.quarantineObservation(path, name, selfUid);
            if (first.reason !== second.reason || first.manifest.source.ino !== second.manifest.source.ino) {
                throw new EditSessionRecordError(`Edit session ${sessionId} changed between two reads; nothing was quarantined.`);
            }
            manifest = { ...second.manifest, id: sessionId };
            await ensureQuarantineArea(this.stateRoot, 'edit-sessions', hooks);
            await publishQuarantineManifest(this.stateRoot, 'edit-sessions', manifest, 'create', hooks);
        }
        const rootDevice = (await stateRootDevice(this.stateRoot)).toString();
        const matches = async (candidate) => {
            let metadata;
            try {
                metadata = await lstat(candidate, { bigint: true });
            }
            catch (error) {
                if (isMissingPath(error))
                    return null;
                throw error;
            }
            const [recorded] = manifest.entries;
            return metadata.isFile() && !metadata.isSymbolicLink() && metadata.ino.toString() === manifest.source.ino &&
                metadata.dev.toString() === rootDevice && recorded !== undefined && recorded.name === name &&
                Number(metadata.mode & 4095n) === recorded.mode && Number(metadata.uid) === recorded.uid &&
                Number(metadata.size) === recorded.size;
        };
        await withPrivateDirectoryScope([
            { path: this.stateRoot, description: 'state root' },
            { path: this.recordDirectory, description: 'edit session record directory' },
            { path: quarantineArea(this.stateRoot, 'edit-sessions').base, description: 'quarantine directory' },
            { path: area, description: 'quarantine edit-sessions directory' },
        ], async (scope) => {
            const done = await matches(moved);
            if (done === true)
                return;
            if (done === false)
                throw new EditSessionRecordError(`${moved} does not match its quarantine manifest; nothing was moved.`);
            if (await matches(path) !== true) {
                throw new EditSessionRecordError(`Edit session ${sessionId} no longer matches its quarantine manifest; nothing was moved and it stays refused.`);
            }
            await rename(path, moved);
            await hooks.boundary?.('renamed');
            await scope.assertStable();
            await scope.syncDirectory(area);
            await scope.syncDirectory(this.recordDirectory);
        });
        await hooks.boundary?.('moved');
    }
    async quarantineObservation(path, name, selfUid) {
        const sessionId = name.slice(0, -RECORD_SUFFIX.length);
        const read = await this.readRecord(path, sessionId);
        if (read.state === 'missing')
            throw new EditSessionRecordError(`Edit session ${sessionId} does not exist.`);
        if (read.state === 'valid')
            throw new EditSessionRecordError(`Edit session ${sessionId} is readable; close it instead of quarantining it.`);
        if (TRANSIENT_READ_FAILURES.has(read.reason)) {
            throw new EditSessionRecordError(`Edit session ${sessionId} could not be read (${read.reason}); that can be a concurrent write, so it is not quarantined.`);
        }
        const metadata = await lstat(path, { bigint: true });
        const names = await readdir(this.recordDirectory);
        const twinPattern = temporaryTwinPattern(name);
        const twins = [];
        for (const candidate of names) {
            if (!twinPattern.test(candidate))
                continue;
            const twin = await lstat(join(this.recordDirectory, candidate), { bigint: true });
            if (twin.isFile() && twin.ino === metadata.ino)
                twins.push({ name: candidate, twin });
        }
        const attribution = attributeEntry({
            isFile: () => metadata.isFile(),
            isDirectory: () => metadata.isDirectory(),
            isSymbolicLink: () => metadata.isSymbolicLink(),
            uid: Number(metadata.uid),
            mode: Number(metadata.mode),
            nlink: Number(metadata.nlink),
        }, 'file', selfUid, twins.length === 1);
        if (!attribution.attributable) {
            throw new EditSessionRecordError(`Edit session ${sessionId} cannot be quarantined: ${attribution.reason}. Nothing was written.`);
        }
        const entry = (entryName, stats) => ({
            name: entryName,
            ino: stats.ino.toString(),
            mode: Number(stats.mode & 4095n),
            uid: Number(stats.uid),
            size: Number(stats.size),
            nlink: Number(stats.nlink),
        });
        return {
            reason: read.reason,
            manifest: {
                quarantineRecordVersion: 1,
                kind: 'edit_session',
                id: sessionId,
                quarantinedAt: new Date().toISOString(),
                source: { dev: metadata.dev.toString(), ino: metadata.ino.toString() },
                entries: [entry(name, metadata), ...twins.map(({ name: twinName, twin }) => entry(twinName, twin))],
                violations: [`${path}: unreadable (${read.reason})`],
            },
        };
    }
    async open(input) {
        await this.leaseGuard.assertNoUnresolvedSession();
        if (input.backup.backupId !== input.backupId)
            throw new EditSessionRecordError('The backup record names a different backup id.');
        await this.ensure();
        const decision = decideEditSessionOpen((await this.list()).map((entry) => entry.read), input.backup, input.observed);
        if (decision.outcome === 'refuse')
            return decision;
        const timestamp = (input.now ?? new Date()).toISOString();
        const record = {
            recordVersion: EDIT_SESSION_RECORD_VERSION,
            sessionId: newEditSessionId(),
            sourcePath: input.observed.sourcePath,
            sourceInode: input.observed.sourceInode,
            sourceFileRevision: input.observed.sourceFileRevision,
            backupId: input.backupId,
            openingDocumentKey: input.openingDocumentKey,
            head: decision.head,
            state: 'open',
            suspendReason: null,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        await atomicCreatePrivateRecord(this.recordPath(record.sessionId), serialize(record), this.recordOptions);
        return { ...decision, record };
    }
    async current(sessionId) {
        const read = await this.read(sessionId);
        if (read.state === 'missing')
            throw new EditSessionRecordError(`Edit session ${sessionId} does not exist.`);
        if (read.state === 'invalid') {
            throw new EditSessionRecordError(`Edit session ${sessionId} is unreadable (${read.reason}); it is left as is.`);
        }
        return read.record;
    }
    async replace(next, now) {
        const record = { ...next, updatedAt: (now ?? new Date()).toISOString() };
        await atomicReplacePrivateRecord(this.recordPath(record.sessionId), serialize(record), this.recordOptions);
        return record;
    }
    async advanceHead(sessionId, step) {
        const current = await this.current(sessionId);
        if (current.state !== 'open')
            throw new EditSessionRecordError(`Edit session ${sessionId} is ${current.state}; its head does not advance.`);
        if (current.head.sequence !== step.expectedSequence) {
            throw new EditSessionRecordError(`Edit session ${sessionId} is at sequence ${current.head.sequence}, not ${step.expectedSequence}.`);
        }
        return await this.replace({
            ...current,
            head: { structureDigest: step.structureDigest, itemAggregate: step.itemAggregate, sequence: current.head.sequence + 1, commandId: step.commandId },
        }, step.now);
    }
    async suspend(sessionId, reason, now) {
        const current = await this.current(sessionId);
        if (current.state === 'suspended')
            return current;
        if (current.state === 'closed')
            throw new EditSessionRecordError(`Edit session ${sessionId} is closed.`);
        return await this.replace({ ...current, state: 'suspended', suspendReason: editSessionSuspendReasonSchema.parse(reason) }, now);
    }
    async close(sessionId, now) {
        const current = await this.current(sessionId);
        if (current.state === 'closed')
            return current;
        return await this.replace({ ...current, state: 'closed' }, now);
    }
}
export async function summarizeEditSessionRecords(stateRoot) {
    const readOnly = new EditSessionStore(stateRoot, {
        assertNoUnresolvedSession: async () => { throw new EditSessionRecordError('The read-only summary never opens a session.'); },
    });
    const counts = { open: 0, suspended: 0, closed: 0, invalid: 0 };
    for (const { read } of await readOnly.list()) {
        if (read.state === 'valid')
            counts[read.record.state] += 1;
        else if (read.state === 'invalid')
            counts.invalid += 1;
    }
    return counts;
}
