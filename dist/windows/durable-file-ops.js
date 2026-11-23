import { createHash } from 'node:crypto';
import { lstat, open, rmdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BackupCopyError, sameContentIdentity, } from '../document-backup.js';
import { LifecyclePreconditionError } from '../document-lifecycle.js';
import { barrierPathCandidates } from '../release-barrier.js';
import { OutputPreLinkCheckError } from '../document-export.js';
import { createPrivateFileExclusive, openPrivateDirectory } from '../private-state.js';
import { windowsPathKey } from './document-path.js';
import { assertWindowsCanonicalDocumentPath, assertWindowsSameFilePathIdentity, checkWindowsDocumentSaveLocation, createWindowsDocumentDirectoryCheck, createWindowsInspectSourceFile, createWindowsSavedDocumentCloseRefusal, resolveWindowsBackupRoot, windowsBackupFileName, windowsBackupRootRefusal, windowsHostPathForms, windowsSameFilePath, } from './durable-document-ops.js';
import { windowsDurableHostScript } from './durable-host-scripts.js';
import { ResidentObservationHelper } from './observation-helper.js';
import { createOutputDirectoryGuard, WindowsOutputDirectoryError } from './output-dir-guard.js';
import { createWindowsOutputDirectoryOperations } from './output-dir-scope.js';
export const WINDOWS_BACKUP_DIGEST_READ_FIXED_MS = 10_000;
export const WINDOWS_BACKUP_DIGEST_READ_MS_PER_ITEM = 42;
export const WINDOWS_BACKUP_DIGEST_READ_SAFETY_FACTOR = 3;
export const WINDOWS_HOST_CALL_DEFAULT_TIMEOUT_MS = 30_000;
export function windowsBackupDigestReadHostOptions(pageItems) {
    if (!Number.isSafeInteger(pageItems) || pageItems < 0)
        throw new RangeError(`A digest read cannot be sized for ${String(pageItems)} page items.`);
    const proportional = WINDOWS_BACKUP_DIGEST_READ_FIXED_MS + pageItems * WINDOWS_BACKUP_DIGEST_READ_MS_PER_ITEM * WINDOWS_BACKUP_DIGEST_READ_SAFETY_FACTOR;
    return { timeoutMs: Math.max(WINDOWS_HOST_CALL_DEFAULT_TIMEOUT_MS, proportional) };
}
const CHUNK_BYTES = 1024 * 1024;
const MAX_HASHED_FILE_BYTES = 2n ** 31n;
function describeError(error) {
    return error instanceof Error ? error.message : String(error);
}
function identityOf(metadata) {
    return { dev: metadata.dev, ino: metadata.ino, size: metadata.size, mtimeNs: metadata.mtimeNs, ctimeNs: metadata.ctimeNs };
}
export function windowsSameFileIdentity(left, right) {
    return sameContentIdentity(left, right);
}
async function openRegularFile(path, fail) {
    let named;
    try {
        named = await lstat(path, { bigint: true });
    }
    catch (error) {
        throw fail(`The file could not be opened: ${describeError(error)}`);
    }
    if (named.isSymbolicLink() || !named.isFile())
        throw fail('The path is not a regular file.');
    let handle;
    try {
        handle = await open(path, 'r');
    }
    catch (error) {
        throw fail(`The file could not be opened: ${describeError(error)}`);
    }
    try {
        const opened = await handle.stat({ bigint: true });
        if (!opened.isFile() || opened.dev !== named.dev || opened.ino !== named.ino)
            throw fail('The path no longer identifies the file that was opened.');
        return { handle, stat: opened };
    }
    catch (error) {
        await handle.close().catch(() => undefined);
        throw error;
    }
}
async function hashHandle(handle) {
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
    let total = 0n;
    for (;;) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, Number(total));
        if (bytesRead === 0)
            break;
        hash.update(buffer.subarray(0, bytesRead));
        total += BigInt(bytesRead);
    }
    return { bytes: total, sha256: hash.digest('hex') };
}
async function hashWindowsFile(path, fail) {
    const { handle, stat: before } = await openRegularFile(path, fail);
    try {
        const { bytes, sha256 } = await hashHandle(handle);
        const after = await handle.stat({ bigint: true });
        if (bytes !== before.size || !windowsSameFileIdentity(identityOf(before), identityOf(after)))
            throw fail(`${path} changed while it was being read.`);
        return { bytes: Number(bytes), sha256, identity: identityOf(before) };
    }
    finally {
        await handle.close().catch(() => undefined);
    }
}
export async function readWindowsFileFacts(path) {
    const fail = (message) => new LifecyclePreconditionError('file_unavailable', message);
    const { handle, stat: before } = await openRegularFile(path, fail);
    try {
        if (before.size <= 0n)
            throw fail('The file is empty.');
        if (before.size > MAX_HASHED_FILE_BYTES)
            throw fail('The file is too large to verify.');
        const { bytes, sha256 } = await hashHandle(handle);
        const after = await handle.stat({ bigint: true });
        if (bytes !== before.size || !windowsSameFileIdentity(identityOf(before), identityOf(after)))
            throw fail('The file changed while it was being read.');
        return { path, bytes: Number(before.size), sha256, identity: identityOf(before) };
    }
    finally {
        await handle.close().catch(() => undefined);
    }
}
export async function verifyWindowsTrackedFile(path, identity, sha256) {
    const fail = (message) => new BackupCopyError(message);
    const { handle, stat: before } = await openRegularFile(path, fail);
    try {
        if (!windowsSameFileIdentity(identity, identityOf(before)))
            throw fail(`The tracked file ${path} was replaced or modified.`);
        const read = await hashHandle(handle);
        const after = await handle.stat({ bigint: true });
        if (read.bytes !== identity.size || read.sha256 !== sha256 || !windowsSameFileIdentity(identity, identityOf(after))) {
            throw fail(`The tracked file ${path} no longer matches its recorded bytes.`);
        }
    }
    finally {
        await handle.close().catch(() => undefined);
    }
}
export async function windowsSameFileOrSameBytes(path, current, recorded, expectedSha256) {
    if (!windowsSameFileIdentity(current, recorded))
        return false;
    try {
        const reread = await hashWindowsFile(path, (message) => new BackupCopyError(message));
        return windowsSameFileIdentity(reread.identity, recorded) && reread.sha256 === expectedSha256;
    }
    catch (_error) {
        return false;
    }
}
async function flushDirectory(path) {
    const directory = await openPrivateDirectory(path);
    try {
        await directory.sync();
    }
    finally {
        await directory.close();
    }
}
export async function copyWindowsFileExclusive(sourcePath, destinationPath, expectedIdentity) {
    const fail = (message) => new BackupCopyError(message);
    let input;
    let destinationCreated = false;
    try {
        const opened = await openRegularFile(sourcePath, fail);
        input = opened.handle;
        const before = opened.stat;
        if (expectedIdentity && !windowsSameFileIdentity(expectedIdentity, identityOf(before)))
            throw fail('The copy source changed before the copy started.');
        let output;
        try {
            output = await createPrivateFileExclusive(destinationPath);
        }
        catch (error) {
            throw fail(`The copy destination could not be created exclusively: ${describeError(error)}`);
        }
        destinationCreated = true;
        const hash = createHash('sha256');
        let total = 0;
        try {
            const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
            for (;;) {
                const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
                if (bytesRead === 0)
                    break;
                const chunk = buffer.subarray(0, bytesRead);
                hash.update(chunk);
                await output.writeFile(chunk);
                total += bytesRead;
            }
            await output.sync();
        }
        finally {
            await output.close();
        }
        await flushDirectory(dirname(destinationPath));
        const after = await input.stat({ bigint: true });
        if (!windowsSameFileIdentity(identityOf(before), identityOf(after)) || BigInt(total) !== before.size)
            throw fail('The copy source changed while it was being copied.');
        const sourceSha256 = hash.digest('hex');
        const copied = await hashWindowsFile(destinationPath, fail);
        if (copied.bytes !== total || copied.sha256 !== sourceSha256)
            throw fail('The copied bytes do not match the source bytes.');
        return { bytes: total, sha256: sourceSha256, destinationCreated, identity: copied.identity };
    }
    catch (error) {
        const failure = error instanceof BackupCopyError ? error : new BackupCopyError(describeError(error));
        failure.destinationCreated = destinationCreated;
        throw failure;
    }
    finally {
        await input?.close().catch(() => undefined);
    }
}
export async function removeWindowsRestoreTestFile(path, identity, scope) {
    let handle;
    try {
        const opened = await openRegularFile(path, (message) => new BackupCopyError(message));
        handle = opened.handle;
        if (!windowsSameFileIdentity(identity, identityOf(opened.stat)) || opened.stat.nlink !== 1n)
            return false;
        await scope.assertStable();
        await unlink(path);
        const after = await handle.stat({ bigint: true });
        if (after.nlink !== 0n)
            return false;
        await scope.syncLeafParent();
        return true;
    }
    catch (_error) {
        return false;
    }
    finally {
        await handle?.close().catch(() => undefined);
    }
}
export async function removeWindowsStagedFile(stagedPath, expected, parentScope) {
    let handle;
    try {
        let opened;
        try {
            opened = await openRegularFile(stagedPath, (message) => new BackupCopyError(message));
        }
        catch (_error) {
            return 'identity_mismatch';
        }
        handle = opened.handle;
        if (opened.stat.dev !== expected.dev || opened.stat.ino !== expected.ino)
            return 'identity_mismatch';
        if (opened.stat.nlink !== 2n)
            return 'not_linked';
        try {
            await parentScope.assertStable();
            await unlink(stagedPath);
        }
        catch (_error) {
            return 'unlink_failed';
        }
        const after = await handle.stat({ bigint: true });
        if (after.nlink !== 1n)
            return 'unlink_failed';
        const held = handle;
        handle = undefined;
        try {
            await held.close();
        }
        catch (_error) {
            return 'staging_not_empty';
        }
        try {
            await rmdir(dirname(stagedPath));
        }
        catch (_error) {
            return 'staging_not_empty';
        }
        try {
            await parentScope.sync();
        }
        catch (_error) {
            return 'sync_failed';
        }
        return 'removed';
    }
    finally {
        await handle?.close().catch(() => undefined);
    }
}
export function windowsBarrierPathCandidates(path) {
    return [...new Set([...barrierPathCandidates(path), windowsPathKey(path)])];
}
export { windowsSameFileById } from './file-id.js';
export function createLazyObservationHelper(create) {
    let helper = null;
    const current = () => (helper ??= create());
    return {
        warmUp: () => current().warmUp(),
        observe: (paths) => current().observe(paths),
        close: async () => { if (helper !== null)
            await helper.close(); },
    };
}
export function createWindowsDurableFilePolicy(options = {}) {
    const helper = options.helper ?? createLazyObservationHelper(() => new ResidentObservationHelper());
    const guard = createOutputDirectoryGuard({ helper });
    const directory = createWindowsOutputDirectoryOperations(guard);
    const policy = {
        copyFileExclusive: copyWindowsFileExclusive,
        readFileFacts: readWindowsFileFacts,
        verifyTrackedFile: verifyWindowsTrackedFile,
        removeRestoreTestFile: removeWindowsRestoreTestFile,
        removeStagedFile: removeWindowsStagedFile,
        sameFileIdentity: windowsSameFileIdentity,
        sameFileOrSameBytes: windowsSameFileOrSameBytes,
        barrierPathCandidates: windowsBarrierPathCandidates,
        validateOutputPath: directory.validateOutputPath,
        withOutputParentScope: directory.withOutputParentScope,
        createStagingDirectory: directory.createStagingDirectory,
        warmUp: () => helper.warmUp(),
        inspectSourceFile: createWindowsInspectSourceFile(),
        resolveBackupRoot: resolveWindowsBackupRoot,
        backupFileName: windowsBackupFileName,
        backupRootRefusal: windowsBackupRootRefusal,
        backupDigestReadHostOptions: windowsBackupDigestReadHostOptions,
        structureReadHostOptions: windowsBackupDigestReadHostOptions,
        sameFilePath: windowsSameFilePath,
        assertSameFilePathIdentity: assertWindowsSameFilePathIdentity,
        assertCanonicalDocumentPath: assertWindowsCanonicalDocumentPath,
        checkDocumentDirectory: createWindowsDocumentDirectoryCheck(guard),
        checkDocumentSaveLocation: checkWindowsDocumentSaveLocation,
        hostPathForms: windowsHostPathForms,
        durableHostScript: windowsDurableHostScript,
        savedDocumentCloseRefusal: createWindowsSavedDocumentCloseRefusal(false),
        checkOutputParentCheckpoint: async (point, scope, extra) => {
            try {
                await directory.checkOutputParentCheckpoint(point, scope, extra);
            }
            catch (error) {
                if (error instanceof WindowsOutputDirectoryError && error.afterHost)
                    throw new OutputPreLinkCheckError(error.code, error.message, { cause: error });
                throw error;
            }
        },
    };
    return Object.freeze(policy);
}
export const WINDOWS_DURABLE_FILE_POLICY = createWindowsDurableFilePolicy();
