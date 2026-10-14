import { createHash, randomUUID } from 'node:crypto';
import { lstat, readdir, rmdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { currentUid } from './platform-primitives.js';
import { readSecurePrivateHandle } from './private-record.js';
import { createPrivateFileExclusive, ensurePrivateDirectory, ensurePrivateStateRoot, isMissingPath, isWindowsPrivateState, openPrivateFileForRead, validatePrivateDirectory, } from './private-state.js';
import { StructureSnapshotChangedError, } from './structure-diff.js';
export const STRUCTURE_STREAM_LIMITS = {
    maxFileBytes: 64 * 1024 * 1024,
    maxCallsPerPass: 32,
    maxPassBytes: 128 * 1024 * 1024,
};
export class StructureStreamError extends Error {
    reason;
    constructor(reason, message) {
        super(message);
        this.reason = reason;
        this.name = 'StructureStreamError';
    }
}
export const streamHeaderSchema = z.strictObject({
    h: z.literal(1),
    key: z.string().min(1),
    pageItems: z.number().int().nonnegative(),
    artboards: z.number().int().nonnegative(),
    saved: z.boolean(),
    position: z.number().int().nonnegative(),
});
export const streamTrailerSchema = z.strictObject({
    t: z.literal(1),
    done: z.boolean(),
    lines: z.number().int().nonnegative(),
    chars: z.number().int().nonnegative(),
    position: z.number().int().nonnegative(),
});
export const streamCallResultSchema = z.object({
    done: z.boolean(),
    lines: z.number().int().nonnegative(),
    chars: z.number().int().nonnegative(),
    position: z.number().int().nonnegative(),
    document: z.custom((value) => typeof value === 'object' && value !== null && typeof value.key === 'string'),
});
export const STRUCTURE_SPOOL_STALE_MS = 60 * 60 * 1000;
const SPOOL_DIRECTORY_NAME = /^(\d{1,10})-(\d{10,15})-[0-9a-f-]{36}$/;
function processAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return error.code === 'EPERM';
    }
}
export class StructureSpool {
    directory;
    files = [];
    disposed = false;
    constructor(directory) {
        this.directory = directory;
    }
    static async create(stateRoot, options = {}) {
        if (isWindowsPrivateState()) {
            throw new StructureStreamError('unsupported_platform', 'The structure stream is measured on macOS only; a document above the digest limit is refused on this platform.');
        }
        await ensurePrivateStateRoot(stateRoot);
        const parent = join(stateRoot, 'structure-spool');
        await ensurePrivateDirectory(parent, 'structure spool directory');
        const now = options.now ?? Date.now;
        await StructureSpool.sweep(parent, options);
        const directory = join(parent, `${process.pid}-${now()}-${randomUUID()}`);
        await ensurePrivateDirectory(directory, 'structure spool read directory');
        return new StructureSpool(directory);
    }
    static async sweep(parent, options = {}) {
        const sweep = { removed: [], ignored: [] };
        const now = (options.now ?? Date.now)();
        const alive = options.isProcessAlive ?? processAlive;
        const maxAge = options.maxAgeMs ?? STRUCTURE_SPOOL_STALE_MS;
        let names;
        try {
            names = await readdir(parent);
        }
        catch (error) {
            sweep.ignored.push({ name: '.', reason: `unreadable: ${error instanceof Error ? error.message : String(error)}` });
            return sweep;
        }
        for (const name of names) {
            const match = SPOOL_DIRECTORY_NAME.exec(name);
            if (match === null) {
                sweep.ignored.push({ name, reason: 'not a spool directory name' });
                continue;
            }
            const pid = Number(match[1]);
            const startedAt = Number(match[2]);
            if (pid === process.pid && now - startedAt < maxAge) {
                sweep.ignored.push({ name, reason: 'this process' });
                continue;
            }
            if (pid !== process.pid && alive(pid) && now - startedAt < maxAge) {
                sweep.ignored.push({ name, reason: 'owner alive and recent' });
                continue;
            }
            const path = join(parent, name);
            try {
                const facts = await lstat(path, { bigint: true });
                if (!facts.isDirectory() || facts.isSymbolicLink() || facts.uid !== BigInt(currentUid()) || (facts.mode & 511n) !== 448n) {
                    sweep.ignored.push({ name, reason: 'not a private directory of this user' });
                    continue;
                }
                const entries = await readdir(path);
                let clean = true;
                for (const entry of entries) {
                    const entryFacts = await lstat(join(path, entry), { bigint: true });
                    if (!entry.endsWith('.ndjson') || !entryFacts.isFile() || entryFacts.nlink !== 1n) {
                        clean = false;
                        break;
                    }
                }
                if (!clean) {
                    sweep.ignored.push({ name, reason: 'holds something other than spool files' });
                    continue;
                }
                for (const entry of entries)
                    await unlink(join(path, entry));
                await rmdir(path);
                sweep.removed.push(name);
            }
            catch (error) {
                sweep.ignored.push({ name, reason: `not removed: ${error instanceof Error ? error.message : String(error)}` });
            }
        }
        return sweep;
    }
    async newFile(label) {
        if (this.disposed)
            throw new Error('The structure spool is already disposed.');
        if (!/^[a-z0-9-]{1,40}$/.test(label))
            throw new Error('A spool file label is lowercase letters, digits and hyphens.');
        const path = join(this.directory, `${label}.ndjson`);
        const handle = await createPrivateFileExclusive(path);
        await handle.close();
        this.files.push(path);
        const facts = await lstat(path, { bigint: true });
        return { path, dev: facts.dev, ino: facts.ino };
    }
    async dispose() {
        this.disposed = true;
        let removedAll = true;
        for (const path of this.files.splice(0)) {
            try {
                await unlink(path);
            }
            catch (error) {
                if (!isMissingPath(error))
                    removedAll = false;
            }
        }
        if (!removedAll)
            return;
        try {
            const entries = await readdir(this.directory);
            if (entries.length === 0)
                await rmdir(this.directory);
        }
        catch (_error) {
        }
    }
    async assertStable() {
        if (this.disposed)
            throw new Error('The structure spool is already disposed.');
        await validatePrivateDirectory(this.directory, 0o700, 'structure spool read directory');
    }
}
export function parseStreamText(text) {
    const malformed = (message) => { throw new StructureStreamError('spool_malformed', `The structure stream file is malformed: ${message}.`); };
    if (!text.endsWith('\n'))
        malformed('it does not end with a newline');
    const lines = text.split('\n');
    lines.pop();
    if (lines.length < 2)
        malformed('it has no header and trailer');
    const parseLine = (line, what) => {
        try {
            return JSON.parse(line);
        }
        catch (_error) {
            return malformed(`${what} is not JSON`);
        }
    };
    const headerParsed = streamHeaderSchema.safeParse(parseLine(lines[0], 'the header'));
    if (!headerParsed.success)
        malformed('the header has an unexpected shape');
    const trailerParsed = streamTrailerSchema.safeParse(parseLine(lines[lines.length - 1], 'the trailer'));
    if (!trailerParsed.success)
        malformed('the trailer is missing or has an unexpected shape');
    const header = headerParsed.data;
    const trailer = trailerParsed.data;
    const body = lines.slice(1, -1);
    let artboardsLine = null;
    if (body.length > 0 && body[0].startsWith('{"a":'))
        artboardsLine = body.shift();
    if (header.position === 0 && artboardsLine === null)
        malformed('the first call has no artboard line');
    if (header.position !== 0 && artboardsLine !== null)
        malformed('a continuation call has an artboard line');
    if (body.length !== trailer.lines)
        malformed(`the trailer counts ${trailer.lines} record lines, the file has ${body.length}`);
    const chars = body.reduce((sum, line) => sum + line.length + 1, 0);
    if (chars !== trailer.chars)
        malformed(`the trailer counts ${trailer.chars} characters, the record lines have ${chars}`);
    if (trailer.position !== header.position + trailer.lines)
        malformed('the trailer position does not follow the header position by its line count');
    return { header, artboardsLine, recordLines: body, trailer, bytes: Buffer.byteLength(text, 'utf8') };
}
export async function readSpoolFile(file, result, maxBytes = STRUCTURE_STREAM_LIMITS.maxFileBytes) {
    let handle;
    try {
        handle = await openPrivateFileForRead(file.path);
    }
    catch (error) {
        throw new StructureStreamError('spool_unsafe', `The structure stream file could not be opened: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
        const opened = await handle.stat({ bigint: true });
        if (opened.dev !== file.dev || opened.ino !== file.ino) {
            throw new StructureStreamError('spool_unsafe', 'The structure stream file is not the file Node created (its identity changed).');
        }
        const record = await readSecurePrivateHandle(handle, maxBytes);
        if (record.state !== 'valid')
            throw new StructureStreamError('spool_unsafe', `The structure stream file failed its check (${record.state === 'invalid' ? record.reason : 'missing'}).`);
        const parsed = parseStreamText(record.text);
        if (parsed.trailer.done !== result.done || parsed.trailer.lines !== result.lines || parsed.trailer.chars !== result.chars ||
            parsed.trailer.position !== result.position) {
            throw new StructureStreamError('spool_malformed', 'The structure stream file and the host result disagree.');
        }
        return parsed;
    }
    finally {
        await handle.close().catch(() => undefined);
    }
}
export async function runStreamPass(host, passLabel) {
    const recordLines = [];
    let artboardsLine = null;
    let witness = null;
    let document = null;
    let header = null;
    let position = 0;
    let bytes = 0;
    for (let call = 0; call < STRUCTURE_STREAM_LIMITS.maxCallsPerPass; call += 1) {
        const file = await host.newFile(`${passLabel}-${call}`);
        const result = streamCallResultSchema.parse(await host.call(file, position));
        const parsed = await readSpoolFile(file, result);
        if (parsed.header.position !== position)
            throw new StructureStreamError('spool_malformed', 'A continuation call started at a different position than requested.');
        const callWitness = JSON.stringify([parsed.header.key, parsed.header.pageItems, parsed.header.artboards]);
        if (witness === null)
            witness = callWitness;
        else if (witness !== callWitness)
            throw new StructureSnapshotChangedError();
        if (document === null)
            document = result.document;
        else if (document.key !== result.document.key)
            throw new StructureSnapshotChangedError();
        header ??= { key: parsed.header.key, pageItems: parsed.header.pageItems, artboards: parsed.header.artboards };
        if (parsed.artboardsLine !== null)
            artboardsLine = parsed.artboardsLine;
        bytes += parsed.bytes;
        if (bytes > STRUCTURE_STREAM_LIMITS.maxPassBytes)
            throw new StructureStreamError('pass_too_large', 'The structure stream of this document exceeds the measured byte limit.');
        for (const line of parsed.recordLines)
            recordLines.push(line);
        position = parsed.trailer.position;
        if (parsed.trailer.done) {
            if (document === null || header === null || artboardsLine === null)
                throw new StructureStreamError('spool_malformed', 'The structure stream ended without its header or artboards.');
            if (recordLines.length !== header.pageItems) {
                throw new StructureStreamError('coverage_incomplete', `The walk of the document reached ${recordLines.length} of its ${header.pageItems} page items, so the structure cannot be compared completely.`);
            }
            return { document, header, artboardsLine, recordLines, calls: call + 1, bytes };
        }
        if (parsed.trailer.lines === 0)
            throw new StructureStreamError('spool_malformed', 'A continuation call made no progress.');
    }
    throw new StructureStreamError('too_many_calls', `The structure stream needed more than ${STRUCTURE_STREAM_LIMITS.maxCallsPerPass} host calls.`);
}
export async function readStructureStream(host, labelPrefix = 'read') {
    const first = await runStreamPass(host, `${labelPrefix}-p1`);
    const second = await runStreamPass(host, `${labelPrefix}-p2`);
    if (first.document.key !== second.document.key || first.header.pageItems !== second.header.pageItems ||
        first.header.artboards !== second.header.artboards || first.artboardsLine !== second.artboardsLine ||
        first.recordLines.length !== second.recordLines.length) {
        throw new StructureSnapshotChangedError();
    }
    for (let index = 0; index < first.recordLines.length; index += 1) {
        if (first.recordLines[index] !== second.recordLines[index])
            throw new StructureSnapshotChangedError();
    }
    const hash = createHash('sha256');
    const items = [];
    for (let index = 0; index < first.recordLines.length; index += 1) {
        const line = first.recordLines[index];
        hash.update(line);
        hash.update('\n');
        let item;
        try {
            item = JSON.parse(line);
        }
        catch (_error) {
            throw new StructureStreamError('spool_malformed', `Record ${index} is not JSON.`);
        }
        if (typeof item !== 'object' || item === null || typeof item.uuid !== 'string' ||
            typeof item.type !== 'string' || item.documentIndex !== index) {
            throw new StructureStreamError('spool_malformed', `Record ${index} is not a canonical item record at its position.`);
        }
        items.push(item);
    }
    let artboards;
    try {
        artboards = JSON.parse(first.artboardsLine).a;
    }
    catch (_error) {
        throw new StructureStreamError('spool_malformed', 'The artboard line is not JSON.');
    }
    if (!Array.isArray(artboards) || artboards.length !== first.header.artboards) {
        throw new StructureStreamError('spool_malformed', 'The artboard line does not hold the counted artboards.');
    }
    return {
        document: first.document,
        artboards,
        items,
        scan: { totalPageItems: items.length, readIntegrity: 'verified', snapshotDigest: hash.digest('hex') },
        streamCalls: first.calls + second.calls,
    };
}
