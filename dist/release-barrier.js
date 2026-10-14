import { createHash } from 'node:crypto';
import { lstat, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { isShortDocumentKey } from './document-key.js';
import { hostPathForms, sameFilePath } from './file-path.js';
import { assertSameFilePathIdentity } from './file-path-identity.js';
import { temporaryTwinPattern } from './state-quarantine.js';
import { boundsSchema, documentContextSchema, documentKeyShortSchema } from './mutation-result-schema-core.js';
import { atomicCreatePrivateRecord, readSecurePrivateRecord, unlinkPrivateRecord, } from './private-record.js';
import { ensurePrivateDirectory, ensurePrivateStateRoot, isMissingPath, withPrivateDirectoryScope } from './private-state.js';
export const RELEASE_BARRIER_RECORD_VERSION = 1;
export const BARRIER_READ_LIMIT = 256;
const RECORD_LIMIT = 4_096;
const LAYOUT_FILE = 'layout.json';
const SUFFIX = '.json';
const NAME_PATTERN = /^[0-9a-f]{64}\.json$/u;
const barrierRecordSchema = z.strictObject({
    version: z.literal(RELEASE_BARRIER_RECORD_VERSION),
    kind: z.literal('document_barrier'),
    scope: z.enum(['path', 'global']),
    source: z.enum(['released_unverified', 'rollback_failed', 'audit_mismatch', 'legacy_sweep']),
    commandId: z.string().min(1).max(128),
    sourcePath: z.string().min(1).max(4_096).nullable(),
    fileRevision: z.string().max(512).nullable(),
    createdAt: z.string().min(1).max(64),
}).superRefine((record, issues) => {
    if ((record.scope === 'path') !== (record.sourcePath !== null)) {
        issues.addIssue({ code: 'custom', message: 'A path barrier names its path; a global barrier names none.', path: ['sourcePath'] });
    }
});
const layoutSchema = z.strictObject({ version: z.literal(RELEASE_BARRIER_RECORD_VERSION), kind: z.literal('barrier_layout') });
const cleanListSchema = z.strictObject({
    complete: z.literal(true), coordinateSpace: z.literal('illustrator_document'), unit: z.literal('pt'), appVersion: z.string(),
    documentCount: z.number().int().nonnegative(),
    documents: z.array(z.strictObject({
        keyVersion: z.literal(1), key: z.string().min(1), keyShort: documentKeyShortSchema,
        index: z.number().int().nonnegative(), name: z.string(), path: z.string().nullable(), fileRevision: z.string().nullable(),
        saved: z.boolean(), colorSpace: z.enum(['RGB', 'CMYK', 'unknown']), active: z.boolean(),
        artboards: z.array(z.strictObject({ index: z.number().int().nonnegative(), name: z.string(), bounds: boundsSchema, active: z.boolean() })),
    })),
}).refine((value) => value.documentCount === value.documents.length, 'A clean inventory must be complete.');
const FULL_KEY = /^v1\|path=([^|]*)\|name=[^|]*\|index=-?\d+\|saved=(?:true|false)\|revision=([^|]*)\|artboards=[^|]*$/u;
const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/u;
export function documentKeyFacts(key) {
    if (typeof key !== 'string' || isShortDocumentKey(key))
        return { kind: 'unknown' };
    const match = FULL_KEY.exec(key);
    if (match === null)
        return { kind: 'unknown' };
    try {
        const path = decodeURIComponent(match[1]);
        if (path === '' || !ABSOLUTE_PATH.test(path))
            return { kind: 'unknown' };
        const revision = decodeURIComponent(match[2]);
        return { kind: 'file', path, revision: revision === '' ? null : revision };
    }
    catch {
        return { kind: 'unknown' };
    }
}
export function barrierTargetFromKey(key) {
    const facts = documentKeyFacts(key);
    if (facts.kind === 'unknown')
        return { scope: 'global' };
    if (facts.revision === null)
        return null;
    return { scope: 'path', path: facts.path, revision: facts.revision };
}
export function barrierTargetFromResultText(text, documentKey) {
    const key = documentKeyFacts(documentKey);
    if (key.kind === 'file' && key.revision !== null)
        return { scope: 'path', path: key.path, revision: key.revision };
    let data;
    try {
        const envelope = JSON.parse(text);
        data = envelope.data;
    }
    catch {
        return { scope: 'global' };
    }
    const document = typeof data === 'object' && data !== null ? data.document : undefined;
    if (typeof document !== 'object' || document === null)
        return { scope: 'global' };
    const { path, fileRevision } = document;
    if (typeof path !== 'string' || path === '' || !ABSOLUTE_PATH.test(path) ||
        (fileRevision !== null && typeof fileRevision !== 'string'))
        return { scope: 'global' };
    if (typeof fileRevision === 'string' && fileRevision !== '')
        return { scope: 'path', path, revision: fileRevision };
    return key.kind === 'file' && key.revision === null ? null : { scope: 'global' };
}
function asciiLower(value) {
    return value.replace(/[A-Z]/gu, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));
}
export function barrierScopeKey(path) {
    return path === null ? 'global' : `path:${path}`;
}
function barrierFileName(scopeKey) {
    return `${createHash('sha256').update(scopeKey, 'utf8').digest('hex')}${SUFFIX}`;
}
export function barrierPathCandidates(path) {
    return [...new Set(hostPathForms(path).map(asciiLower))];
}
export class ReleaseBarrierStore {
    stateRoot;
    options;
    now;
    clearDiagnostics = [];
    constructor(stateRoot, options = {}) {
        this.stateRoot = stateRoot;
        this.options = options;
        this.now = options.now ?? (() => new Date());
    }
    get directory() {
        return join(this.stateRoot, 'release-barriers');
    }
    recordOptions() {
        return this.options.durabilityBoundary === undefined ? {} : { durabilityBoundary: this.options.durabilityBoundary };
    }
    async ensureDirectory() {
        await ensurePrivateStateRoot(this.stateRoot);
        await ensurePrivateDirectory(this.directory, 'release barrier directory');
        await this.options.directoryBoundary?.('root_sync');
        await withPrivateDirectoryScope([{ path: this.stateRoot, description: 'state root' }], async (scope) => { await scope.syncLeafParent(); });
        await this.options.directoryBoundary?.('root_synced');
    }
    async syncDirectory() {
        await this.options.directoryBoundary?.('directory_sync');
        await withPrivateDirectoryScope([{ path: this.directory, description: 'release barrier directory' }], async (scope) => { await scope.syncLeafParent(); });
        await this.options.directoryBoundary?.('directory_synced');
    }
    async list(options = {}) {
        let names;
        try {
            names = await readdir(this.directory);
        }
        catch (error) {
            if (isMissingPath(error))
                return { layout: 'legacy', invalid: null, global: null, paths: [] };
            return { layout: 'migrating', invalid: 'directory_unreadable', global: null, paths: [] };
        }
        let invalid = null;
        let layout = 'migrating';
        let global = null;
        const paths = [];
        const records = names.filter((name) => NAME_PATTERN.test(name));
        for (const name of names.sort()) {
            if (this.isTemporary(name))
                continue;
            if (name === LAYOUT_FILE) {
                const layoutRecord = await this.readLayout();
                if (layoutRecord === 'valid')
                    layout = 'active';
                else
                    invalid ??= 'layout_unreadable';
                continue;
            }
            if (!NAME_PATTERN.test(name)) {
                invalid ??= 'unexpected_entry';
                continue;
            }
            const read = await this.readRecord(join(this.directory, name));
            if (read === 'missing')
                continue;
            if (read === 'invalid' || !this.recordBoundToName(read, name)) {
                invalid ??= 'unreadable_barrier';
                continue;
            }
            if (read.scope === 'global')
                global = read;
            else if (options.uncapped || paths.length < BARRIER_READ_LIMIT)
                paths.push(read);
        }
        if (invalid === null && !options.uncapped && records.length > BARRIER_READ_LIMIT)
            invalid = 'too_many';
        return { layout, invalid, global, paths };
    }
    recordBoundToName(record, name) {
        return barrierFileName(barrierScopeKey(record.sourcePath)) === name &&
            (record.scope === 'global' || (record.sourcePath !== null && ABSOLUTE_PATH.test(record.sourcePath) &&
                typeof record.fileRevision === 'string' && record.fileRevision !== ''));
    }
    isTemporary(name) {
        const base = name.replace(/\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/u, '');
        return (base === LAYOUT_FILE || NAME_PATTERN.test(base)) && temporaryTwinPattern(base).test(name);
    }
    async linkLimit(path) {
        const leaf = await lstat(path, { bigint: true });
        if (leaf.nlink !== 2n)
            return 1;
        const pattern = temporaryTwinPattern(basename(path));
        for (const name of await readdir(this.directory)) {
            if (!pattern.test(name))
                continue;
            const twin = await lstat(join(this.directory, name), { bigint: true });
            if (twin.isFile() && twin.dev === leaf.dev && twin.ino === leaf.ino && twin.nlink === 2n)
                return 2;
        }
        return 1;
    }
    async readLayout() {
        try {
            const path = join(this.directory, LAYOUT_FILE);
            const record = await readSecurePrivateRecord(path, RECORD_LIMIT, { maxLinkCount: await this.linkLimit(path) });
            if (record.state !== 'valid')
                return 'invalid';
            return layoutSchema.safeParse(JSON.parse(record.text)).success ? 'valid' : 'invalid';
        }
        catch {
            return 'invalid';
        }
    }
    async readRecord(path) {
        try {
            const record = await readSecurePrivateRecord(path, RECORD_LIMIT, { maxLinkCount: await this.linkLimit(path) });
            if (record.state === 'missing')
                return 'missing';
            if (record.state === 'invalid')
                return 'invalid';
            const parsed = barrierRecordSchema.safeParse(JSON.parse(record.text));
            return parsed.success ? parsed.data : 'invalid';
        }
        catch (error) {
            if (isMissingPath(error))
                return 'missing';
            return 'invalid';
        }
    }
    async readByScope(path) {
        try {
            await stat(this.directory);
        }
        catch (error) {
            if (isMissingPath(error))
                return null;
            return 'invalid';
        }
        const name = barrierFileName(barrierScopeKey(path));
        const read = await this.readRecord(join(this.directory, name));
        if (read === 'missing')
            return null;
        if (read === 'invalid' || !this.recordBoundToName(read, name))
            return 'invalid';
        return read;
    }
    async ensure(target, input) {
        await this.ensureDirectory();
        const sourcePath = target.scope === 'path' ? target.path : null;
        const record = {
            version: RELEASE_BARRIER_RECORD_VERSION,
            kind: 'document_barrier',
            scope: target.scope,
            source: input.source,
            commandId: input.commandId,
            sourcePath,
            fileRevision: target.scope === 'path' ? target.revision : null,
            createdAt: this.now().toISOString(),
        };
        const path = join(this.directory, barrierFileName(barrierScopeKey(sourcePath)));
        try {
            await atomicCreatePrivateRecord(path, JSON.stringify(record), this.recordOptions());
        }
        catch (error) {
            if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'))
                throw error;
            await this.syncDirectory();
        }
    }
    async clearPath(path) {
        const listing = await this.list({ uncapped: true });
        const errors = [];
        for (const record of listing.paths) {
            const source = record.sourcePath;
            if (!sameFilePath(path, source))
                continue;
            try {
                await assertSameFilePathIdentity(path, source);
                await this.unlinkByName(barrierFileName(barrierScopeKey(source)));
            }
            catch (error) {
                errors.push(error instanceof Error ? error.message : String(error));
            }
        }
        if (listing.invalid !== null)
            errors.push(`Barrier integrity: ${listing.invalid}`);
        if (errors.length > 0)
            throw new Error(errors.join('; '));
    }
    async clearGlobal() {
        const record = await this.readByScope(null);
        if (record === null)
            return;
        if (record === 'invalid' || record.scope !== 'global')
            throw new Error('The global barrier is unreadable.');
        await this.unlinkByName(barrierFileName(barrierScopeKey(null)));
    }
    async unlinkByName(name) {
        try {
            await unlinkPrivateRecord(join(this.directory, name), this.recordOptions());
        }
        catch (error) {
            if (isMissingPath(error))
                return;
            throw error;
        }
    }
    async observeClean(data, source) {
        try {
            if (typeof data !== 'object' || data === null)
                return;
            const value = data;
            const documents = [];
            let complete = false;
            if (source === 'list') {
                const parsed = cleanListSchema.safeParse(value);
                if (!parsed.success)
                    return;
                documents.push(...parsed.data.documents);
                complete = true;
            }
            else if (source === 'document' || source === 'context') {
                const parsed = documentContextSchema.safeParse(source === 'document' ? value.document : value);
                if (!parsed.success)
                    return;
                documents.push(parsed.data);
            }
            else
                return;
            let everyFileBackedClean = true;
            for (const entry of documents) {
                if (typeof entry !== 'object' || entry === null) {
                    everyFileBackedClean = false;
                    continue;
                }
                const { path, saved, fileRevision } = entry;
                if (typeof path !== 'string' || path === '' || !ABSOLUTE_PATH.test(path) ||
                    (typeof fileRevision !== 'string' && fileRevision !== null) || typeof saved !== 'boolean') {
                    everyFileBackedClean = false;
                    continue;
                }
                if (fileRevision === null || fileRevision === '')
                    continue;
                if (saved === true)
                    await this.clearPath(path);
                else
                    everyFileBackedClean = false;
            }
            if (complete && everyFileBackedClean)
                await this.clearGlobal();
        }
        catch (error) {
            this.clearDiagnostics.push(error instanceof Error ? error.message : String(error));
        }
    }
    async observeCleanScan(path) {
        try {
            await this.clearPath(path);
        }
        catch (error) {
            this.clearDiagnostics.push(error instanceof Error ? error.message : String(error));
        }
    }
    async prepare(options = {}) {
        const listing = await this.list(options);
        if (listing.layout === 'active')
            return listing;
        try {
            const sources = await (this.options.legacySources ?? (async () => []))();
            for (const entry of sources) {
                const target = entry.source === 'released_unverified'
                    ? barrierTargetFromKey(entry.documentKey)
                    : barrierTargetFromResultText(entry.resultText ?? '', entry.documentKey);
                if (target !== null)
                    await this.ensure(target, { commandId: entry.commandId, source: 'legacy_sweep' });
            }
            await this.ensureDirectory();
            await this.syncDirectory();
            const layoutPath = join(this.directory, LAYOUT_FILE);
            try {
                await atomicCreatePrivateRecord(layoutPath, JSON.stringify({ version: RELEASE_BARRIER_RECORD_VERSION, kind: 'barrier_layout' }), this.recordOptions());
            }
            catch (error) {
                if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'))
                    throw error;
                await this.syncDirectory();
            }
        }
        catch (error) {
            return { ...(await this.list(options)), invalid: `sweep_failed:${error instanceof Error ? error.message : String(error)}` };
        }
        return await this.list(options);
    }
}
