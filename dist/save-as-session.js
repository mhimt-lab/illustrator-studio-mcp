import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { createOnceLinkAllowance } from './document-export.js';
import { atomicCreatePrivateRecord, readSecurePrivateRecord, unlinkPrivateRecord } from './private-record.js';
import { ensurePrivateDirectory, ensurePrivateStateRoot, isMissingPath } from './private-state.js';
import { noFollowDirectoryFlags, noFollowReadFlags } from './platform-primitives.js';
export const SAVE_AS_RECORD_VERSION = 3;
const MAX_RECORD_BYTES = 16_384;
const execFileAsync = promisify(execFile);
const digitsSchema = z.string().regex(/^\d+$/);
const isoSchema = z.string().min(1).max(64);
const pathSchema = z.string().min(1).max(4_096);
const directoryIdentitySchema = z.strictObject({ dev: digitsSchema, ino: digitsSchema });
export const saveAsOwnerSchema = z.strictObject({
    serverInstanceId: z.uuid(),
    pid: z.number().int().positive(),
    processStartedAt: z.number().int().nonnegative(),
    bootSessionUuid: z.string().min(1).max(64),
});
export const saveAsSessionSchema = z.strictObject({
    version: z.literal(SAVE_AS_RECORD_VERSION),
    kind: z.literal('save_as_session'),
    saveAsId: z.uuid(),
    documentKey: z.string().min(1).max(16_384),
    sourcePath: pathSchema.nullable(),
    outputPath: pathSchema,
    stagingDirectory: pathSchema,
    stagedPath: pathSchema,
    parent: directoryIdentitySchema,
    owner: saveAsOwnerSchema,
    createdAt: isoSchema,
});
export const saveAsPublishSchema = z.strictObject({
    version: z.literal(SAVE_AS_RECORD_VERSION),
    kind: z.literal('save_as_publish'),
    saveAsId: z.uuid(),
    stagedPath: pathSchema,
    outputPath: pathSchema,
    stagingDirectory: directoryIdentitySchema,
    staged: z.strictObject({ dev: digitsSchema, ino: digitsSchema, bytes: z.number().int().positive(), mtimeNs: digitsSchema, sha256: z.string().regex(/^[0-9a-f]{64}$/) }),
    savedDocumentKey: z.string().min(1).max(16_384),
    createdAt: isoSchema,
});
export const saveAsStoppedSchema = z.strictObject({
    version: z.literal(SAVE_AS_RECORD_VERSION),
    kind: z.literal('save_as_stopped'),
    saveAsId: z.uuid(),
    stage: z.string().min(1).max(64),
    message: z.string().max(4_096),
    createdAt: isoSchema,
});
export const saveAsAbandonedSchema = z.strictObject({
    version: z.literal(SAVE_AS_RECORD_VERSION),
    kind: z.literal('save_as_abandoned'),
    saveAsId: z.uuid(),
    retained: z.array(pathSchema).max(16),
    outputHidden: z.boolean().nullable(),
    createdAt: isoSchema,
});
const SUFFIX = {
    session: '.session.json',
    publish: '.save-as-publish.json',
    stopped: '.save-as-stopped.json',
    abandoned: '.save-as-abandoned.json',
};
const SCHEMA = { session: saveAsSessionSchema, publish: saveAsPublishSchema, stopped: saveAsStoppedSchema, abandoned: saveAsAbandonedSchema };
function assertId(saveAsId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(saveAsId))
        throw new Error('save_as_id must be a lowercase UUID.');
}
export class SaveAsSessionStore {
    stateRoot;
    constructor(stateRoot) {
        this.stateRoot = stateRoot;
    }
    get recordDirectory() {
        return join(this.stateRoot, 'exports');
    }
    path(saveAsId, type) {
        assertId(saveAsId);
        return join(this.recordDirectory, `${saveAsId}${SUFFIX[type]}`);
    }
    async ensure() {
        const existed = await lstat(this.recordDirectory).then(() => true, (error) => {
            if (isMissingPath(error))
                return false;
            throw error;
        });
        await ensurePrivateStateRoot(this.stateRoot);
        await ensurePrivateDirectory(this.recordDirectory, 'export record directory');
        if (!existed)
            await syncDirectory(this.stateRoot);
    }
    async create(type, record, options = {}) {
        const validated = SCHEMA[type].parse(record);
        const contents = `${JSON.stringify(validated, null, 2)}\n`;
        if (Buffer.byteLength(contents) > MAX_RECORD_BYTES)
            throw new Error('The save-as record exceeds its size limit.');
        await this.ensure();
        await atomicCreatePrivateRecord(this.path(validated.saveAsId, type), contents, options);
        return { digest: createHash('sha256').update(contents).digest('hex') };
    }
    async read(saveAsId, type) {
        const path = this.path(saveAsId, type);
        let record;
        try {
            record = await readSecurePrivateRecord(path, MAX_RECORD_BYTES, { maxLinkCount: await createOnceLinkAllowance(path) });
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
        let value;
        try {
            value = JSON.parse(record.text);
        }
        catch (_error) {
            return { state: 'invalid', reason: 'malformed_json' };
        }
        if (type === 'session' && typeof value === 'object' && value !== null && value.version !== SAVE_AS_RECORD_VERSION) {
            return { state: 'foreign' };
        }
        const parsed = SCHEMA[type].safeParse(value);
        if (!parsed.success)
            return { state: 'invalid', reason: 'schema_invalid' };
        if (parsed.data.saveAsId !== saveAsId)
            return { state: 'invalid', reason: 'id_mismatch' };
        const metadata = await lstat(path, { bigint: true });
        return {
            state: 'valid', record: parsed.data, digest: createHash('sha256').update(record.bytes).digest('hex'),
            dev: metadata.dev, ino: metadata.ino,
        };
    }
    async isSaveAsLease(saveAsId) {
        const path = this.path(saveAsId, 'session');
        try {
            const record = await readSecurePrivateRecord(path, MAX_RECORD_BYTES, { maxLinkCount: await createOnceLinkAllowance(path) });
            if (record.state !== 'valid')
                return false;
            try {
                const value = JSON.parse(record.text);
                return value !== null && typeof value === 'object' && value.version === SAVE_AS_RECORD_VERSION && value.kind === 'save_as_session';
            }
            catch (_error) {
                return record.text.includes('"save_as_session"');
            }
        }
        catch (_error) {
            return false;
        }
    }
    async remove(saveAsId, type) {
        const path = this.path(saveAsId, type);
        const metadata = await lstat(path, { bigint: true }).catch((error) => {
            if (isMissingPath(error))
                return null;
            throw error;
        });
        if (metadata !== null) {
            const twinPattern = new RegExp(`^${basename(path).replaceAll('.', '\\.')}\\.[0-9a-f-]{36}\\.tmp$`, 'u');
            for (const name of await readdir(dirname(path))) {
                if (!twinPattern.test(name))
                    continue;
                const twin = await lstat(join(dirname(path), name), { bigint: true }).catch(() => null);
                if (twin !== null && twin.isFile() && twin.dev === metadata.dev && twin.ino === metadata.ino)
                    await unlinkPrivateRecord(join(dirname(path), name));
            }
            await unlinkPrivateRecord(path).catch((error) => { if (!isMissingPath(error))
                throw error; });
        }
        else {
            await syncDirectory(this.recordDirectory);
        }
    }
}
async function syncDirectory(path) {
    const handle = await open(path, noFollowDirectoryFlags());
    try {
        await handle.sync();
    }
    finally {
        await handle.close();
    }
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function parsePsLstart(text) {
    const match = /^[A-Z][a-z]{2} ([A-Z][a-z]{2}) +(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/u.exec(text.trim());
    if (match === null)
        return null;
    const month = MONTHS.indexOf(match[1]);
    if (month < 0)
        return null;
    const epoch = Date.UTC(Number(match[6]), month, Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]));
    return Number.isFinite(epoch) ? epoch / 1000 : null;
}
export const defaultProcessIdentityProbe = {
    async bootSessionUuid() {
        try {
            const { stdout } = await execFileAsync('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'], { timeout: 2_000 });
            const value = stdout.trim();
            return /^[0-9A-Fa-f-]{36}$/u.test(value) ? value : null;
        }
        catch (_error) {
            return null;
        }
    },
    async processStartedAt(pid) {
        try {
            const { stdout } = await execFileAsync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { timeout: 2_000, env: { LC_ALL: 'C', TZ: 'UTC0', PATH: '/usr/bin:/bin' } });
            return stdout.trim() === '' ? 'absent' : parsePsLstart(stdout);
        }
        catch (error) {
            const failure = error;
            if (failure.code === 1 && typeof failure.stdout === 'string' && failure.stdout.trim() === '')
                return 'absent';
            return null;
        }
    },
    signalZero(pid) {
        try {
            process.kill(pid, 0);
            return 'alive';
        }
        catch (error) {
            const code = error.code;
            if (code === 'ESRCH')
                return 'absent';
            if (code === 'EPERM')
                return 'alive';
            return 'unknown';
        }
    },
};
export async function currentSaveAsOwner(probe, serverInstanceId) {
    const [bootSessionUuid, processStartedAt] = await Promise.all([probe.bootSessionUuid(), probe.processStartedAt(process.pid)]);
    if (bootSessionUuid === null || typeof processStartedAt !== 'number')
        return null;
    return { serverInstanceId, pid: process.pid, processStartedAt, bootSessionUuid };
}
export async function classifySaveAsOwner(input) {
    const { owner, probe } = input;
    if (input.stoppedOrAbandoned)
        return 'orphan';
    const boot = await probe.bootSessionUuid();
    if (boot === null)
        return 'unknown';
    if (boot !== owner.bootSessionUuid)
        return 'orphan';
    if (owner.serverInstanceId === input.self.serverInstanceId && owner.pid === input.self.pid) {
        return input.self.active.has(input.saveAsId) ? 'in_progress' : 'orphan';
    }
    const signal = probe.signalZero(owner.pid);
    if (signal === 'absent')
        return 'orphan';
    if (signal === 'unknown')
        return 'unknown';
    const started = await probe.processStartedAt(owner.pid);
    if (started === 'absent')
        return 'orphan';
    if (started === null)
        return 'unknown';
    return started === owner.processStartedAt ? 'in_progress' : 'orphan';
}
export const UF_HIDDEN = 0x8000;
export const SF_DATALESS = 0x40000000;
export const readFileFlags = async (path) => {
    try {
        const { stdout } = await execFileAsync('/usr/bin/stat', ['-f', '%Xf', path], { timeout: 1_000 });
        const text = stdout.trim();
        return /^[0-9a-fA-F]+$/u.test(text) ? Number.parseInt(text, 16) : null;
    }
    catch (_error) {
        return null;
    }
};
export function newSaveAsId() {
    return randomUUID();
}
export class SaveAsLeaseRegistry {
    store;
    probe;
    flags;
    serverInstanceId = randomUUID();
    active = new Set();
    #owner = null;
    constructor(store, probe = defaultProcessIdentityProbe, flags = readFileFlags) {
        this.store = store;
        this.probe = probe;
        this.flags = flags;
    }
    owner() {
        this.#owner ??= currentSaveAsOwner(this.probe, this.serverInstanceId);
        return this.#owner;
    }
    async state(session) {
        const [stopped, abandoned] = await Promise.all([
            this.store.read(session.saveAsId, 'stopped'),
            this.store.read(session.saveAsId, 'abandoned'),
        ]);
        return await classifySaveAsOwner({
            owner: session.owner,
            stoppedOrAbandoned: stopped.state === 'valid' || abandoned.state === 'valid',
            self: { serverInstanceId: this.serverInstanceId, pid: process.pid, active: this.active },
            saveAsId: session.saveAsId,
            probe: this.probe,
        });
    }
    async describe(ids) {
        const described = new Map();
        for (const id of ids) {
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(id))
                continue;
            const read = await this.store.read(id, 'session').catch(() => ({ state: 'invalid', reason: 'read_failed' }));
            if (read.state === 'valid')
                described.set(id, await this.state(read.record));
            else if (read.state === 'invalid' && await this.store.isSaveAsLease(id))
                described.set(id, 'invalid');
        }
        return described;
    }
}
export class SaveAsLeaseNotRecordedError extends Error {
    saveAsId;
    constructor(saveAsId, cause) {
        super(`The save-as session could not be recorded (${cause instanceof Error ? cause.message : String(cause)}); nothing was saved.`, { cause });
        this.saveAsId = saveAsId;
        this.name = 'SaveAsLeaseNotRecordedError';
    }
}
export class SaveAsLeaseChangedError extends Error {
    saveAsId;
    constructor(saveAsId) {
        super(`The save-as session ${saveAsId} was changed by another process; this run stops here and leaves everything as it is. Run illustrator_reconcile_save_as.`);
        this.saveAsId = saveAsId;
        this.name = 'SaveAsLeaseChangedError';
    }
}
export async function syncFile(path) {
    const handle = await open(path, noFollowReadFlags());
    try {
        await handle.sync();
    }
    finally {
        await handle.close();
    }
}
export async function syncDirectoryOf(path) {
    await syncDirectory(path);
}
export async function summarizeSaveAsRecords(stateRoot) {
    const store = new SaveAsSessionStore(stateRoot);
    const summary = { sessions: 0, sessionsInvalid: 0, recordsWithoutSession: 0, abandonedWithStaging: 0 };
    let names;
    try {
        names = await readdir(store.recordDirectory);
    }
    catch (error) {
        if (isMissingPath(error))
            return summary;
        throw error;
    }
    const id = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/u;
    const ids = new Set(names.map((name) => id.exec(name)?.[1]).filter((value) => value !== undefined));
    for (const saveAsId of ids) {
        const session = await store.read(saveAsId, 'session');
        if (session.state === 'valid')
            summary.sessions += 1;
        else if (session.state === 'invalid' && await store.isSaveAsLease(saveAsId))
            summary.sessionsInvalid += 1;
        const hasSession = session.state === 'valid' || session.state === 'invalid';
        if (!hasSession && (names.includes(`${saveAsId}.save-as-publish.json`) || names.includes(`${saveAsId}.save-as-stopped.json`))) {
            summary.recordsWithoutSession += 1;
        }
        const abandoned = await store.read(saveAsId, 'abandoned');
        if (abandoned.state === 'valid') {
            const staging = abandoned.record.retained.find((path) => basename(path).startsWith('.illustrator-studio-mcp-save-as-') && !path.endsWith('.ai'));
            if (staging !== undefined && await lstat(staging).then(() => true, () => false))
                summary.abandonedWithStaging += 1;
        }
    }
    return summary;
}
export async function inFileProviderDomain(path) {
    try {
        await execFileAsync('/usr/bin/xattr', ['-p', 'com.apple.file-provider-domain-id', path], { timeout: 2_000 });
        return true;
    }
    catch (error) {
        const code = error.code;
        return code === 1 ? false : null;
    }
}
