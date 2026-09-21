import { constants } from 'node:fs';
import { link, open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { withPrivateDirectoryScope, } from './private-state.js';
export const PRIVATE_RECORD_LIMITS = {
    lock: 128,
    metadata: 4_096,
    execution: 4_096,
    finalization: 4_096,
    status: 65_536,
    audit: 4_096,
    result: 262_144,
    idempotency: 4_096,
    editSession: 4_096,
};
function currentUid() {
    if (typeof process.getuid !== 'function') {
        throw new Error('Secure private records require process.getuid support.');
    }
    return process.getuid();
}
function secureReadFlags() {
    if (typeof constants.O_NOFOLLOW !== 'number' || typeof constants.O_NONBLOCK !== 'number') {
        throw new Error('Secure private records require O_NOFOLLOW and O_NONBLOCK support.');
    }
    return constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
}
export async function readSecurePrivateHandle(handle, maxBytes, maxLinkCount = 1) {
    try {
        const before = await handle.stat({ bigint: true });
        if (!before.isFile())
            return { state: 'invalid', reason: 'not_regular_file' };
        if (before.uid !== BigInt(currentUid()))
            return { state: 'invalid', reason: 'wrong_owner' };
        if ((before.mode & 4095n) !== 384n)
            return { state: 'invalid', reason: 'unsafe_mode' };
        if (before.nlink < 1n || before.nlink > BigInt(maxLinkCount))
            return { state: 'invalid', reason: 'unexpected_link_count' };
        if (before.size < 0n || before.size > BigInt(maxBytes))
            return { state: 'invalid', reason: 'oversize' };
        const bytes = await handle.readFile();
        const after = await handle.stat({ bigint: true });
        if (BigInt(bytes.length) !== before.size || before.dev !== after.dev || before.ino !== after.ino ||
            before.size !== after.size || before.nlink !== after.nlink || before.mtimeNs !== after.mtimeNs ||
            before.ctimeNs !== after.ctimeNs) {
            return { state: 'invalid', reason: 'changed_during_read' };
        }
        let text;
        try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        }
        catch (_error) {
            return { state: 'invalid', reason: 'invalid_utf8' };
        }
        return { state: 'valid', bytes, text };
    }
    catch (_error) {
        return { state: 'invalid', reason: 'read_failed' };
    }
}
async function withRecordScope(path, options, operation) {
    if (options?.scope) {
        await options.scope.assertStable();
        const result = await operation(options.scope);
        await options.scope.assertStable();
        return result;
    }
    return await withPrivateDirectoryScope([
        { path: dirname(path), description: 'private record parent directory' },
    ], operation);
}
export async function readSecurePrivateRecord(path, maxBytes, options) {
    return await withRecordScope(path, options, async (scope) => {
        let handle;
        try {
            handle = await open(path, secureReadFlags());
        }
        catch (error) {
            if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
                return { state: 'missing' };
            }
            return { state: 'invalid', reason: 'open_failed' };
        }
        try {
            const result = await readSecurePrivateHandle(handle, maxBytes, options?.maxLinkCount);
            await scope.assertStable();
            return result;
        }
        finally {
            await handle.close().catch(() => undefined);
        }
    });
}
async function writeSyncedTemporary(path, contents, options) {
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    let handle;
    try {
        handle = await open(temporaryPath, 'wx', 0o600);
        await handle.writeFile(contents);
        await handle.sync();
        await options?.durabilityBoundary?.('temporary_synced');
        return temporaryPath;
    }
    catch (error) {
        try {
            await unlink(temporaryPath);
        }
        catch (cleanupError) {
            if (!(typeof cleanupError === 'object' && cleanupError !== null && 'code' in cleanupError &&
                cleanupError.code === 'ENOENT'))
                throw cleanupError;
        }
        throw error;
    }
    finally {
        await handle?.close();
    }
}
async function unlinkTemporary(path, allowMissing) {
    try {
        await unlink(path);
        return true;
    }
    catch (error) {
        if (allowMissing && typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}
export async function atomicReplacePrivateRecord(path, contents, options) {
    await withRecordScope(path, options, async (scope) => {
        const temporaryPath = await writeSyncedTemporary(path, contents, options);
        try {
            await scope.assertStable();
            await rename(temporaryPath, path);
            await options?.durabilityBoundary?.('replaced');
            await scope.assertStable();
            await scope.syncLeafParent();
            await options?.durabilityBoundary?.('replace_parent_synced');
        }
        finally {
            const removed = await unlinkTemporary(temporaryPath, true);
            if (removed)
                await scope.syncLeafParent();
        }
    });
}
export async function atomicCreatePrivateRecord(path, contents, options) {
    await withRecordScope(path, options, async (scope) => {
        const temporaryPath = await writeSyncedTemporary(path, contents, options);
        try {
            await scope.assertStable();
            await link(temporaryPath, path);
            await options?.durabilityBoundary?.('published');
            await scope.assertStable();
            await scope.syncLeafParent();
            await options?.durabilityBoundary?.('publish_parent_synced');
        }
        finally {
            await unlinkTemporary(temporaryPath, false);
            await options?.durabilityBoundary?.('temporary_unlinked');
            await scope.assertStable();
            await scope.syncLeafParent();
            await options?.durabilityBoundary?.('temporary_unlink_parent_synced');
        }
    });
}
export async function atomicCreatePrivateRecords(records, options) {
    const [first] = records;
    if (first === undefined)
        return;
    const parent = dirname(first.path);
    if (records.some(({ path }) => dirname(path) !== parent) || new Set(records.map(({ path }) => path)).size !== records.length) {
        throw new Error('Grouped private records must be distinct entries of one directory.');
    }
    await withRecordScope(first.path, options, async (scope) => {
        const written = await Promise.allSettled(records.map(async ({ path, contents }) => await writeSyncedTemporary(path, contents, options)));
        const temporaryPaths = written.flatMap((outcome) => outcome.status === 'fulfilled' ? [outcome.value] : []);
        try {
            const failed = written.find((outcome) => outcome.status === 'rejected');
            if (failed !== undefined)
                throw failed.reason;
            for (const [index, { path }] of records.entries()) {
                await scope.assertStable();
                await link(temporaryPaths[index], path);
                await options?.durabilityBoundary?.('published');
            }
            await scope.assertStable();
            await scope.syncLeafParent();
            await options?.durabilityBoundary?.('publish_parent_synced');
        }
        finally {
            for (const temporaryPath of temporaryPaths) {
                await unlinkTemporary(temporaryPath, false);
                await options?.durabilityBoundary?.('temporary_unlinked');
            }
            if (temporaryPaths.length > 0) {
                await scope.assertStable();
                await scope.syncLeafParent();
                await options?.durabilityBoundary?.('temporary_unlink_parent_synced');
            }
        }
    });
}
export async function createEmptyPrivateStagingRecords(paths, options) {
    const [first] = paths;
    if (first === undefined)
        return;
    const parent = dirname(first);
    if (paths.some((path) => dirname(path) !== parent) || new Set(paths).size !== paths.length) {
        throw new Error('Empty staging records must be distinct entries of one directory.');
    }
    await withRecordScope(first, options, async (scope) => {
        for (const path of paths) {
            await scope.assertStable();
            const handle = await open(path, 'wx', 0o600);
            await handle.close();
            await options?.durabilityBoundary?.('staging_created');
        }
        await scope.assertStable();
        await scope.syncLeafParent();
        await options?.durabilityBoundary?.('staging_parent_synced');
    });
}
export async function unlinkPrivateRecords(paths, options) {
    const [first] = paths;
    if (first === undefined)
        return;
    if (paths.some((path) => dirname(path) !== dirname(first))) {
        throw new Error('Grouped private record unlinks must be entries of one directory.');
    }
    await withRecordScope(first, options, async (scope) => {
        for (const path of paths) {
            await scope.assertStable();
            await unlink(path);
            await options?.durabilityBoundary?.('unlinked');
        }
        await scope.assertStable();
        await scope.syncLeafParent();
        await options?.durabilityBoundary?.('unlink_parent_synced');
    });
}
export async function unlinkPrivateRecord(path, options) {
    await withRecordScope(path, options, async (scope) => {
        await scope.assertStable();
        await unlink(path);
        await options?.durabilityBoundary?.('unlinked');
        await scope.assertStable();
        await scope.syncLeafParent();
        await options?.durabilityBoundary?.('unlink_parent_synced');
    });
}
