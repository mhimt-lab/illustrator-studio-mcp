import { createHash } from 'node:crypto';
import { lstat, mkdir, open, link, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { fileIdentitySchema, serializeFileIdentity } from './document-backup.js';
import { noFollowDirectoryFlags, noFollowNonBlockingReadFlags, exclusiveCreateNoFollowFlags, currentUid } from './platform-primitives.js';
import { ensurePrivateDirectory } from './private-state.js';
import { canonicalSerialize } from './mutation-canonical.js';
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const directoryIdentitySchema = z.strictObject({ dev: z.string().regex(/^\d+$/u), ino: z.string().regex(/^\d+$/u) });
const destination = { path: z.string().min(1), parentIdentity: directoryIdentitySchema };
export const expectedOutputSchema = z.discriminatedUnion('action', [
    z.strictObject({ action: z.literal('create'), ...destination }),
    z.strictObject({ action: z.literal('replace'), ...destination, identity: fileIdentitySchema, bytes: z.number().int().nonnegative(), sha256: digest,
        uid: z.number().int().nonnegative(), mode: z.number().int().nonnegative(), nlink: z.literal(1) }),
]);
const boundFileSchema = z.strictObject({ path: z.string().min(1), identity: fileIdentitySchema, bytes: z.number().int().nonnegative(), sha256: digest });
const restoredForeignSchema = z.strictObject({ path: z.string().min(1), identity: fileIdentitySchema, bytes: z.number().int().nonnegative(),
    sha256: digest.nullable(), hashUnavailable: z.enum(['too_large', 'not_owned', 'unreadable']).nullable() })
    .refine(value => (value.sha256 === null) === (value.hashUnavailable !== null), 'A missing foreign hash requires its reason.');
export const replacementSummarySchema = z.strictObject({
    mode: z.enum(['create', 'replace']),
    archive: z.strictObject({ id: z.uuid(), path: z.string().min(1), identity: fileIdentitySchema, bytes: z.number().int().nonnegative(), sha256: digest }).nullable(),
    previousSha256: digest.nullable(),
    retained: z.array(z.strictObject({ path: z.string().min(1), reason: z.string().min(1) })),
    restoredForeign: restoredForeignSchema.optional(),
});
export const replacementIntentSchema = z.strictObject({
    version: z.literal(5), kind: z.literal('raster_vector_export'), recordType: z.literal('replacement_intent'), exportId: z.uuid(), planDigest: digest,
    renderVersion: z.union([z.literal(2), z.literal(3), z.literal(4)]), prepareDigest: digest, bindingDigest: digest, hostTerminalDigest: digest,
    publicationDigest: digest,
    expected: expectedOutputSchema, staged: boundFileSchema, stageIdentity: directoryIdentitySchema,
    archive: boundFileSchema.nullable(), slot: z.string().nullable(),
    privateDirectories: z.array(z.strictObject({ path: z.string().min(1), identity: directoryIdentitySchema })).min(1).max(3),
});
export const RESTORED_FOREIGN_REASON = 'Third-party file quarantined after the output changed during detach; never delete this slot automatically.';
export const PREINTENT_ARCHIVE_REASON = 'Unbound previous-output archive copy retained; no publication or detach occurred.';
export class OutputReplacementError extends Error {
    reason;
    retained;
    foreignRestored;
    restoredForeign;
    constructor(reason, message, retained = [], foreignRestored = false, restoredForeign) {
        super(message);
        this.reason = reason;
        this.retained = retained;
        this.foreignRestored = foreignRestored;
        this.restoredForeign = restoredForeign;
        this.name = 'OutputReplacementError';
    }
}
const missing = (e) => e !== null && typeof e === 'object' && 'code' in e && e.code === 'ENOENT';
export async function replacementStat(path) {
    try {
        return await lstat(path, { bigint: true });
    }
    catch (e) {
        if (missing(e))
            return null;
        throw e;
    }
}
const identity = (s) => ({ dev: s.dev, ino: s.ino, size: s.size, mtimeNs: s.mtimeNs, ctimeNs: s.ctimeNs });
const directoryIdentity = (s) => ({ dev: String(s.dev), ino: String(s.ino) });
const sameInode = (a, b) => String(a.dev) === b.dev && String(a.ino) === b.ino;
const sameRead = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.nlink === b.nlink;
export const previousOutputLimit = (format) => (format === 'svg' ? 8 : 64) * 1024 * 1024;
async function facts(path, maxBytes) {
    const named = await lstat(path, { bigint: true });
    if (!named.isFile() || named.isSymbolicLink() || named.uid !== BigInt(currentUid()))
        throw new OutputReplacementError('output_previous_unsafe', `Not an owned regular file: ${path}.`);
    if (named.size > BigInt(maxBytes))
        throw new OutputReplacementError('output_previous_too_large', `The previous output exceeds ${maxBytes} bytes: ${path}.`);
    const handle = await open(path, noFollowNonBlockingReadFlags());
    try {
        const before = await handle.stat({ bigint: true });
        if (!sameRead(named, before) || !before.isFile())
            throw new OutputReplacementError('output_changed', `File changed before reading: ${path}.`);
        const hash = createHash('sha256');
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        let bytes = 0;
        for (;;) {
            const read = await handle.read(buffer, 0, Math.min(buffer.length, maxBytes - bytes + 1), null);
            if (!read.bytesRead)
                break;
            bytes += read.bytesRead;
            if (bytes > maxBytes)
                throw new OutputReplacementError('output_previous_too_large', `File grew beyond ${maxBytes} bytes: ${path}.`);
            hash.update(buffer.subarray(0, read.bytesRead));
        }
        const after = await handle.stat({ bigint: true });
        const final = await lstat(path, { bigint: true });
        if (BigInt(bytes) !== before.size || !sameRead(before, after) || !sameRead(after, final))
            throw new OutputReplacementError('output_changed', `File changed while reading: ${path}.`);
        return { path, identity: serializeFileIdentity(identity(after)), bytes, sha256: hash.digest('hex'), stat: after };
    }
    finally {
        await handle.close();
    }
}
export async function captureExpectedOutput(path, maxBytes) {
    const parent = await lstat(dirname(path), { bigint: true });
    if (!parent.isDirectory() || parent.isSymbolicLink())
        throw new OutputReplacementError('output_previous_unsafe', 'The output parent is not a directory.');
    const parentIdentity = directoryIdentity(parent);
    const named = await replacementStat(path);
    if (named === null)
        return { action: 'create', path, parentIdentity };
    const file = await facts(path, maxBytes);
    if (file.stat.nlink !== 1n)
        throw new OutputReplacementError('output_previous_unsafe', `The previous output must have exactly one link: ${path}.`);
    return { action: 'replace', path, parentIdentity, identity: file.identity, bytes: file.bytes, sha256: file.sha256, uid: Number(file.stat.uid), mode: Number(file.stat.mode), nlink: 1 };
}
export async function assertExpectedOutput(expected, maxBytes) {
    const actual = await captureExpectedOutput(expected.path, maxBytes);
    if (canonicalSerialize(actual) !== canonicalSerialize(expected))
        throw new OutputReplacementError('output_changed_since_plan', 'The output or its parent changed since the plan. Plan again.');
}
export async function syncReplacementDirectory(path) {
    const h = await open(path, noFollowDirectoryFlags());
    try {
        await h.sync();
    }
    finally {
        await h.close();
    }
}
async function assertDirectory(path, expected, privateMode = false) {
    const s = await lstat(path, { bigint: true });
    if (!s.isDirectory() || s.isSymbolicLink() || !sameInode(s, expected) || (privateMode && (s.uid !== BigInt(currentUid()) || (s.mode & 511n) !== 448n))) {
        throw new OutputReplacementError('replacement_unresolved', `Directory identity changed: ${path}.`);
    }
}
export async function assertReplacementScopes(intent, allowMissingStage = false) {
    for (const directory of intent.privateDirectories)
        await assertDirectory(directory.path, directory.identity, true);
    await assertDirectory(dirname(intent.expected.path), intent.expected.parentIdentity);
    const stage = dirname(intent.staged.path);
    if (allowMissingStage && await replacementStat(stage) === null)
        return;
    await assertDirectory(stage, intent.stageIdentity, true);
}
export async function verifyReplacementFile(file, links = [1], exactIdentity = false) {
    const s = await replacementStat(file.path);
    if (s === null || !s.isFile() || !sameInode(s, file.identity) || !links.includes(Number(s.nlink)))
        return false;
    const actual = await facts(file.path, Math.max(file.bytes, 1));
    return actual.bytes === file.bytes && actual.sha256 === file.sha256 && actual.identity.mtimeNs === file.identity.mtimeNs && actual.identity.dev === file.identity.dev && actual.identity.ino === file.identity.ino &&
        (!exactIdentity || canonicalSerialize(actual.identity) === canonicalSerialize(file.identity));
}
export function replacementSummary(intent, retained = []) {
    return { mode: intent.expected.action, archive: intent.archive === null ? null : { id: intent.exportId, ...intent.archive },
        previousSha256: intent.expected.action === 'replace' ? intent.expected.sha256 : null, retained };
}
export async function verifyReplacementArchive(intent) {
    if (intent.expected.action === 'create') {
        if (intent.archive !== null || intent.slot !== null)
            throw new OutputReplacementError('replacement_unresolved', 'A create intent contains a previous file.');
    }
    else if (intent.archive === null || intent.archive.sha256 !== intent.expected.sha256 || intent.archive.bytes !== intent.expected.bytes || !await verifyReplacementFile(intent.archive, [1], true)) {
        throw new OutputReplacementError('replacement_unresolved', 'The independently bound previous-output archive is unavailable.');
    }
}
export async function prepareReplacementIntent(input, stateRoot, hook) {
    return replacementIntentSchema.parse(await prepareReplacementFilesystem(input, stateRoot, hook));
}
export async function prepareReplacementFilesystem(input, stateRoot, hook) {
    await hook?.('before_archive');
    await assertExpectedOutput(input.expected, input.expected.action === 'replace' ? input.expected.bytes : 1);
    if (!await verifyReplacementFile(input.staged))
        throw new OutputReplacementError('replacement_unresolved', 'The verified stage changed before archiving.');
    const stage = dirname(input.staged.path);
    const stageIdentity = directoryIdentity(await lstat(stage, { bigint: true }));
    const privateDirectories = [{ path: stateRoot, identity: directoryIdentity(await lstat(stateRoot, { bigint: true })) }];
    let archive = null;
    if (input.expected.action === 'replace') {
        const base = join(stateRoot, 'output-replacements');
        await ensurePrivateDirectory(base, 'output replacement archive root');
        await syncReplacementDirectory(stateRoot);
        const dir = join(base, input.exportId);
        await mkdir(dir, { mode: 0o700 });
        await syncReplacementDirectory(base);
        privateDirectories.push({ path: base, identity: directoryIdentity(await lstat(base, { bigint: true })) }, { path: dir, identity: directoryIdentity(await lstat(dir, { bigint: true })) });
        const path = join(dir, 'old.bin');
        try {
            const source = await open(input.expected.path, noFollowNonBlockingReadFlags());
            try {
                const before = await source.stat({ bigint: true });
                if (!before.isFile() || before.uid !== BigInt(currentUid()) || before.nlink !== 1n)
                    throw new OutputReplacementError('output_previous_unsafe', 'The previous output is no longer an owned single-link regular file.');
                if (canonicalSerialize(serializeFileIdentity(identity(before))) !== canonicalSerialize(input.expected.identity))
                    throw new OutputReplacementError('output_changed', 'The previous output changed before its archive copy.');
                const target = await open(path, exclusiveCreateNoFollowFlags(), 0o600);
                try {
                    const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(Math.max(1, Math.min(1024 * 1024, input.expected.bytes + 1)));
                    let total = 0;
                    for (;;) {
                        const read = await source.read(buffer, 0, Math.min(buffer.length, input.expected.bytes - total + 1), null);
                        if (!read.bytesRead)
                            break;
                        total += read.bytesRead;
                        if (total > input.expected.bytes)
                            throw new OutputReplacementError('output_changed', 'The previous output grew during its archive copy.');
                        hash.update(buffer.subarray(0, read.bytesRead));
                        await target.writeFile(buffer.subarray(0, read.bytesRead));
                    }
                    await target.sync();
                    const after = await source.stat({ bigint: true }), named = await lstat(input.expected.path, { bigint: true });
                    if (!sameRead(before, after) || !sameRead(after, named) || total !== input.expected.bytes || hash.digest('hex') !== input.expected.sha256)
                        throw new OutputReplacementError('output_changed', 'The previous output changed during its archive copy.');
                }
                finally {
                    await target.close();
                }
            }
            finally {
                await source.close();
            }
        }
        catch (error) {
            if (error instanceof OutputReplacementError)
                throw error;
            throw new OutputReplacementError('replacement_unresolved', `The previous-output archive copy did not complete: ${error instanceof Error ? error.message : String(error)}`);
        }
        await syncReplacementDirectory(dir);
        const copied = await facts(path, Math.max(input.expected.bytes, 1));
        if (copied.bytes !== input.expected.bytes || copied.sha256 !== input.expected.sha256)
            throw new OutputReplacementError('output_changed', 'The independently read archive differs from the planned previous output.');
        archive = { path, identity: copied.identity, bytes: copied.bytes, sha256: copied.sha256 };
        if (!await verifyReplacementFile(archive))
            throw new OutputReplacementError('replacement_unresolved', 'The old-output archive could not be verified.');
        await syncReplacementDirectory(dir);
        await syncReplacementDirectory(base);
        await hook?.('archive_copied');
        await assertExpectedOutput(input.expected, input.expected.bytes);
    }
    const intent = { ...input, archive, slot: archive === null ? null : join(stage, 'previous-output'), stageIdentity, privateDirectories };
    await assertReplacementScopes(intent);
    await hook?.('archive_synced');
    return intent;
}
export async function detachPreviousOutput(intent, hook) {
    await assertReplacementScopes(intent);
    await verifyReplacementArchive(intent);
    if (intent.expected.action === 'create')
        return;
    await assertExpectedOutput(intent.expected, intent.expected.bytes);
    const slot = intent.slot;
    if (await replacementStat(slot) !== null)
        throw new OutputReplacementError('replacement_unresolved', `The new private slot is already occupied: ${slot}.`);
    await hook?.('before_detach');
    await assertReplacementScopes(intent);
    if (await replacementStat(slot) !== null)
        throw new OutputReplacementError('replacement_unresolved', `The new private slot is already occupied: ${slot}.`);
    await rename(intent.expected.path, slot);
    await hook?.('detached');
    await assertReplacementScopes(intent);
    const previous = { path: slot, identity: intent.expected.identity, bytes: intent.expected.bytes, sha256: intent.expected.sha256 };
    let matchesPrevious = false;
    try {
        matchesPrevious = await verifyReplacementFile(previous);
    }
    catch { }
    if (!matchesPrevious) {
        const retained = [{ path: slot, reason: RESTORED_FOREIGN_REASON }];
        const stat = await replacementStat(slot);
        if (stat === null || !stat.isFile() || stat.nlink !== 1n)
            throw new OutputReplacementError('replacement_unresolved', `A foreign entry is retained at ${slot}.`, retained);
        const foreign = { path: slot, identity: serializeFileIdentity(identity(stat)), bytes: Number(stat.size), sha256: null, hashUnavailable: 'unreadable' };
        try {
            await link(slot, intent.expected.path);
        }
        catch (e) {
            if (e !== null && typeof e === 'object' && 'code' in e && e.code === 'EEXIST')
                throw new OutputReplacementError('replacement_unresolved', `A third-party output already exists; the displaced file stays at ${slot}.`, retained);
            throw e;
        }
        await syncReplacementDirectory(dirname(intent.expected.path));
        await syncReplacementDirectory(dirname(slot));
        if (!await verifyRestoredForeign(foreign, intent.expected.path))
            throw new OutputReplacementError('replacement_unresolved', 'The restored third-party identity cannot be verified.', retained);
        if (stat.size > 64n * 1024n * 1024n)
            foreign.hashUnavailable = 'too_large';
        else if (stat.uid !== BigInt(currentUid()))
            foreign.hashUnavailable = 'not_owned';
        else {
            try {
                const hashed = await facts(slot, 64 * 1024 * 1024);
                if (hashed.identity.dev !== foreign.identity.dev || hashed.identity.ino !== foreign.identity.ino || hashed.bytes !== foreign.bytes || hashed.identity.mtimeNs !== foreign.identity.mtimeNs)
                    throw new Error('The restored foreign file changed before hashing.');
                foreign.sha256 = hashed.sha256;
                foreign.hashUnavailable = null;
            }
            catch {
                foreign.sha256 = null;
                foreign.hashUnavailable = 'unreadable';
            }
        }
        if (!await verifyRestoredForeign(foreign, intent.expected.path))
            throw new OutputReplacementError('replacement_unresolved', 'The restored third-party file changed during verification.', retained);
        await hook?.('foreign_restored');
        throw new OutputReplacementError('output_changed', `The raced-in file was restored; its additional quarantine link is retained at ${slot}.`, retained, true, foreign);
    }
    await syncReplacementDirectory(dirname(slot));
    await syncReplacementDirectory(dirname(intent.expected.path));
    await hook?.('detach_synced');
}
export async function verifyRestoredForeign(foreign, output) {
    for (const path of [foreign.path, output]) {
        const stat = await replacementStat(path);
        if (stat === null || !stat.isFile() || !sameInode(stat, foreign.identity) || stat.nlink !== 2n || String(stat.size) !== foreign.identity.size ||
            Number(stat.size) !== foreign.bytes || String(stat.mtimeNs) !== foreign.identity.mtimeNs)
            return false;
    }
    return foreign.sha256 === null || await verifyReplacementFile({ ...foreign, sha256: foreign.sha256 }, [2]) && await verifyReplacementFile({ ...foreign, path: output, sha256: foreign.sha256 }, [2]);
}
export async function classifyReplacement(intent) {
    await verifyReplacementArchive(intent);
    const output = await replacementStat(intent.expected.path);
    const outputNew = output !== null && sameInode(output, intent.staged.identity);
    await assertReplacementScopes(intent, outputNew);
    const staged = await replacementStat(intent.staged.path);
    const slot = intent.slot === null ? null : await replacementStat(intent.slot);
    const stagedNew = staged !== null && await verifyReplacementFile(intent.staged, [1, 2]);
    if (outputNew) {
        if (!await verifyReplacementFile({ ...intent.staged, path: intent.expected.path }, [stagedNew ? 2 : 1]) || (staged !== null && !stagedNew))
            return 'foreign';
        if (slot !== null && (intent.expected.action !== 'replace' || !await verifyReplacementFile({ ...intent.expected, path: intent.slot })))
            return 'foreign';
        return 'published';
    }
    if (!stagedNew || staged.nlink !== 1n)
        return 'foreign';
    if (intent.expected.action === 'create')
        return output === null ? 'create' : 'foreign';
    const old = { identity: intent.expected.identity, bytes: intent.expected.bytes, sha256: intent.expected.sha256 };
    if (output === null)
        return slot !== null && await verifyReplacementFile({ ...old, path: intent.slot }) ? 'detached' : 'foreign';
    if (slot === null && await verifyReplacementFile({ ...old, path: intent.expected.path }))
        return 'previous';
    if (slot !== null && await verifyReplacementFile({ ...old, path: intent.slot }, [2]) && await verifyReplacementFile({ ...old, path: intent.expected.path }, [2]))
        return 'restored';
    return 'foreign';
}
export async function restorePreviousOutput(intent, hook) {
    const state = await classifyReplacement(intent);
    if (state !== 'detached' && state !== 'restored')
        throw new OutputReplacementError('replacement_unresolved', `restore_previous is not allowed in ${state}.`);
    if (state === 'detached')
        await link(intent.slot, intent.expected.path);
    await syncReplacementDirectory(dirname(intent.expected.path));
    await syncReplacementDirectory(dirname(intent.staged.path));
    if (await classifyReplacement(intent) !== 'restored')
        throw new OutputReplacementError('replacement_unresolved', 'The previous output did not restore to its bound inode.');
    await hook?.('previous_restored');
}
export async function cleanupPreviousSlot(intent, hook) {
    await verifyReplacementArchive(intent);
    if (intent.slot === null || await replacementStat(intent.slot) === null)
        return;
    await assertReplacementScopes(intent);
    if (intent.expected.action !== 'replace' || !await verifyReplacementFile({ ...intent.expected, path: intent.slot }, [1, 2]))
        throw new OutputReplacementError('replacement_unresolved', `A foreign slot is retained at ${intent.slot}.`, [{ path: intent.slot, reason: 'Slot identity is not the planned previous output.' }]);
    await unlink(intent.slot);
    await syncReplacementDirectory(dirname(intent.slot));
    await hook?.('slot_unlinked');
}
