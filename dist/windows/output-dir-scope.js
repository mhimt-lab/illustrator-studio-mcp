import { link, lstat, mkdir, open, readdir, rmdir, unlink } from 'node:fs/promises';
import { realpath as realpathCallback } from 'node:fs';
import { win32 } from 'node:path';
import { STAGING_DIRECTORY_PREFIX, } from '../document-export.js';
import { SAVE_AS_STAGING_PREFIX } from '../document-lifecycle.js';
import { describeWindowsDocumentPathRejection, isWithinWindowsDirectory, sameWindowsFilePath, validateWindowsDocumentPath, WINDOWS_DOCUMENT_PATH_MAX_CHARS, windowsPathKey, } from './document-path.js';
import { windowsSameFileById } from './file-id.js';
import { outputDirectoryRejection, WindowsOutputDirectoryRejection } from './output-dir-guard.js';
const DEFAULT_FS = Object.freeze({ open, mkdir, lstat, link, unlink, readdir, rmdir });
const fsOf = (ops) => ({ ...DEFAULT_FS, ...ops });
const nativeRealpath = (path) => new Promise((resolve, reject) => realpathCallback.native(path, (error, resolved) => (error === null ? resolve(resolved) : reject(error))));
const errnoOf = (error) => error?.code;
const describeError = (error) => (error instanceof Error ? error.message : String(error));
const isMissing = (error) => errnoOf(error) === 'ENOENT' || errnoOf(error) === 'ENOTDIR';
export const OD7_SELFTEST_FILE = 'ism-od7-selftest.tmp';
export const OD7_SELFTEST_LINK = 'ism-od7-selftest.lnk';
const OD7_NAMES = Object.freeze([OD7_SELFTEST_FILE, OD7_SELFTEST_LINK]);
const STAGING_NAME_LENGTH = Math.max(SAVE_AS_STAGING_PREFIX.length, STAGING_DIRECTORY_PREFIX.length) + 36;
export async function windowsValidateOutputPath(guard, outputPath, format, sourceRealPath, stateRoot, ops) {
    const io = fsOf(ops);
    const reject = (...args) => outputDirectoryRejection(...args);
    const shape = validateWindowsDocumentPath(outputPath, 'output', { extension: `.${format}` });
    if (!shape.ok)
        throw reject(shape.reason, 'preflight', describeWindowsDocumentPathRejection(shape.reason, shape.component));
    const requestedParent = win32.dirname(outputPath);
    const fileName = win32.basename(outputPath);
    const stagedLength = requestedParent.replace(/\\$/u, '').length + 1 + STAGING_NAME_LENGTH + 1 + fileName.length;
    if (stagedLength > WINDOWS_DOCUMENT_PATH_MAX_CHARS) {
        throw reject('staging_path_too_long', 'preflight', `The staged file would be ${stagedLength} characters long; the limit is ${WINDOWS_DOCUMENT_PATH_MAX_CHARS}. Choose a shorter output path.`);
    }
    let parent;
    try {
        parent = await nativeRealpath(requestedParent);
    }
    catch (error) {
        if (isMissing(error))
            throw reject('output_dir_missing', 'preflight', `${requestedParent}: the output directory does not exist.`);
        throw reject('output_dir_unobservable', 'preflight', `${requestedParent}: the output directory could not be resolved: ${describeError(error)}`, 'output_path_invalid', { detail: 'realpath_failed' });
    }
    if (windowsPathKey(parent) !== windowsPathKey(requestedParent)) {
        throw reject('output_dir_alias', 'preflight', `${requestedParent} resolves to ${parent}; give the real directory path.`);
    }
    let resolvedStateRoot;
    try {
        resolvedStateRoot = await nativeRealpath(stateRoot);
    }
    catch {
        resolvedStateRoot = null;
    }
    if (resolvedStateRoot !== null && isWithinWindowsDirectory(parent, resolvedStateRoot)) {
        throw reject('output_dir_in_state_root', 'preflight', `${parent} is inside the MCP state root.`);
    }
    const path = win32.join(parent, fileName);
    let sameAsSource = sameWindowsFilePath(path, sourceRealPath);
    if (!sameAsSource) {
        try {
            sameAsSource = await windowsSameFileById(path, sourceRealPath);
        }
        catch (error) {
            if (!isMissing(error))
                throw reject('output_dir_unobservable', 'preflight', `${path}: the file id could not be compared with the source: ${describeError(error)}`, 'output_path_invalid', { detail: 'file_id_compare_failed' });
        }
    }
    if (sameAsSource)
        throw reject('output_is_source', 'preflight', `${path} is the source file; output_path must differ from it.`);
    let exists = true;
    try {
        await io.lstat(path);
    }
    catch (error) {
        if (!isMissing(error))
            throw reject('output_dir_unobservable', 'preflight', `${path}: the output path could not be inspected: ${describeError(error)}`, 'output_path_invalid', { detail: 'lstat_failed' });
        exists = false;
    }
    if (exists)
        throw reject('output_exists', 'preflight', `The output path already exists: ${path}. Overwriting is refused; choose a new path.`, 'output_exists');
    await guard.check({ kind: 'output', point: 'preflight', parent });
    return { path, parent };
}
const scopeParents = new WeakMap();
export async function withWindowsOutputParentScope(parent, operation, ops) {
    const io = fsOf(ops);
    const changed = (text) => outputDirectoryRejection('output_dir_changed', null, `${parent}: ${text}`);
    let handle;
    try {
        handle = await io.open(parent, 'r+');
    }
    catch (error) {
        const code = errnoOf(error);
        if (code === 'EPERM' || code === 'EACCES') {
            throw outputDirectoryRejection('output_dir_flush_unsupported', null, `${parent}: the directory cannot be opened for flushing (${code}).`);
        }
        if (isMissing(error))
            throw outputDirectoryRejection('output_dir_missing', null, `${parent}: the output directory does not exist.`);
        throw outputDirectoryRejection('output_dir_unobservable', null, `${parent}: the output directory could not be opened: ${describeError(error)}`, 'output_path_invalid', { detail: 'open_failed' });
    }
    try {
        const identity = await handle.stat({ bigint: true });
        if (!identity.isDirectory())
            throw outputDirectoryRejection('output_dir_unobservable', null, `${parent}: not a directory.`, 'output_path_invalid', { detail: 'not_a_directory' });
        const scope = {
            async assertStable() {
                let current;
                try {
                    current = await io.lstat(parent, { bigint: true });
                }
                catch (error) {
                    throw changed(`the output directory can no longer be read (${describeError(error)}).`);
                }
                const held = await handle.stat({ bigint: true });
                if (current.isSymbolicLink() || !current.isDirectory() || current.dev !== held.dev || current.ino !== held.ino
                    || held.dev !== identity.dev || held.ino !== identity.ino) {
                    throw changed('the output directory no longer identifies the opened directory.');
                }
            },
            async sync() {
                await handle.sync();
            },
        };
        scopeParents.set(scope, parent);
        await scope.assertStable();
        const result = await operation(scope);
        await scope.assertStable();
        return result;
    }
    finally {
        await handle.close();
    }
}
export async function windowsCreateStagingDirectory(parent, exportId, outputPath, prefix = STAGING_DIRECTORY_PREFIX, ops) {
    const io = fsOf(ops);
    const point = 'afterStaging';
    const directory = win32.join(parent, `${prefix}${exportId}`);
    try {
        await io.mkdir(directory);
    }
    catch (error) {
        throw outputDirectoryRejection('output_dir_not_writable', point, `${directory}: the staging directory could not be created next to the output: ${describeError(error)}`);
    }
    const [parentStat, directoryStat] = await Promise.all([io.lstat(parent, { bigint: true }), io.lstat(directory, { bigint: true })]);
    if (parentStat.dev !== directoryStat.dev) {
        const removal = await io.rmdir(directory).then(() => '', (error) => ` The staging directory could not be removed: ${describeError(error)}`);
        throw outputDirectoryRejection('output_cross_device', point, `The staging directory is not on the output directory's device, so the output could not be published atomically.${removal}`, 'output_cross_device');
    }
    try {
        await selfCheckStaging(io, parent, directory, point);
    }
    catch (error) {
        if (!(error instanceof WindowsOutputDirectoryRejection))
            throw error;
        const rejection = error;
        let residue = '';
        try {
            const result = await reconcileOd7Residue(directory, io);
            if (result.foreign.length > 0)
                residue = ` Unexpected entries remain in the staging directory: ${result.foreign.join(', ')}.`;
        }
        catch (cleanupError) {
            residue = ` The self-check files could not be removed: ${describeError(cleanupError)}.`;
        }
        if (residue === '')
            throw rejection;
        throw new WindowsOutputDirectoryRejection(rejection.reason, `${rejection.message}${residue}`, { code: rejection.code, point: rejection.point, details: rejection.details });
    }
    return { directory, stagedPath: win32.join(directory, win32.basename(outputPath)) };
}
async function selfCheckStaging(io, parent, directory, point) {
    const tmp = win32.join(directory, OD7_SELFTEST_FILE);
    const lnk = win32.join(directory, OD7_SELFTEST_LINK);
    const flushFailed = (what, error) => outputDirectoryRejection('output_dir_flush_unsupported', point, `${what} could not be flushed: ${describeError(error)}`);
    let file;
    try {
        file = await io.open(tmp, 'wx');
    }
    catch (error) {
        throw outputDirectoryRejection('output_dir_not_writable', point, `${tmp}: a file could not be created in the staging directory: ${describeError(error)}`);
    }
    try {
        await file.write(Buffer.from('x'));
        try {
            await file.sync();
        }
        catch (error) {
            throw flushFailed(tmp, error);
        }
    }
    finally {
        await file.close();
    }
    try {
        await io.link(tmp, lnk);
    }
    catch (error) {
        throw outputDirectoryRejection('output_dir_link_unsupported', point, `${tmp}: a hard link could not be created in the staging directory: ${describeError(error)}`);
    }
    const [first, second] = await Promise.all([io.lstat(tmp, { bigint: true }), io.lstat(lnk, { bigint: true })]);
    if (first.nlink !== 2n || second.nlink !== 2n || first.ino !== second.ino || first.dev !== second.dev) {
        throw outputDirectoryRejection('output_dir_link_unsupported', point, `${tmp}: link count ${first.nlink} / ${second.nlink} after the link, expected 2.`);
    }
    for (const name of [tmp, lnk]) {
        try {
            await io.unlink(name);
        }
        catch (error) {
            throw outputDirectoryRejection('output_dir_not_writable', point, `${name}: the self-check file could not be removed: ${describeError(error)}`);
        }
    }
    const left = await io.readdir(directory);
    if (left.length > 0)
        throw outputDirectoryRejection('output_dir_link_unsupported', point, `${directory}: the self-check left ${left.length} entr${left.length === 1 ? 'y' : 'ies'}.`);
    for (const [what, path] of [['the staging directory', directory], ['the output directory', parent]]) {
        let handle;
        try {
            handle = await io.open(path, 'r+');
        }
        catch (error) {
            throw outputDirectoryRejection('output_dir_flush_unsupported', point, `${path}: ${what} cannot be opened for flushing: ${describeError(error)}`);
        }
        try {
            await handle.sync();
        }
        catch (error) {
            throw flushFailed(`${what} (${path})`, error);
        }
        finally {
            await handle.close();
        }
    }
}
export async function reconcileOd7Residue(directory, ops) {
    const io = fsOf(ops);
    const entries = await io.readdir(directory);
    const foreign = entries.filter((name) => !OD7_NAMES.includes(name));
    const candidates = [];
    for (const name of entries.filter((entry) => OD7_NAMES.includes(entry))) {
        const path = win32.join(directory, name);
        const stat = await io.lstat(path, { bigint: true });
        if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 1n)
            foreign.push(name);
        else
            candidates.push({ name, path, dev: stat.dev, ino: stat.ino, nlink: stat.nlink });
    }
    const removed = [];
    const groups = new Map();
    for (const candidate of candidates) {
        const key = `${candidate.dev}:${candidate.ino}`;
        groups.set(key, [...(groups.get(key) ?? []), candidate]);
    }
    for (const group of groups.values()) {
        if (group[0].nlink !== BigInt(group.length)) {
            foreign.push(...group.map((candidate) => candidate.name));
            continue;
        }
        let remaining = group.length;
        for (const candidate of group) {
            await io.unlink(candidate.path);
            removed.push(candidate.name);
            remaining -= 1;
            for (const other of group.filter((entry) => !removed.includes(entry.name))) {
                const stat = await io.lstat(other.path, { bigint: true });
                if (stat.nlink !== BigInt(remaining)) {
                    throw new Error(`${other.path}: link count is ${stat.nlink} after removing ${candidate.name}, expected ${remaining}.`);
                }
            }
        }
    }
    return { removed: removed.sort(), foreign: foreign.sort() };
}
export function createWindowsOutputCheckpoint(guard) {
    return async (point, scope, extra) => {
        const parent = scopeParents.get(scope);
        if (parent === undefined)
            throw new TypeError('The output parent scope was not opened by withWindowsOutputParentScope.');
        await guard.check({
            kind: 'output',
            point,
            parent,
            ...(extra.staging === undefined ? {} : { staging: extra.staging }),
            ...(extra.files === undefined ? {} : { files: extra.files }),
        });
    };
}
export function createWindowsOutputDirectoryOperations(guard) {
    const operations = {
        validateOutputPath: (outputPath, format, sourceRealPath, stateRoot) => windowsValidateOutputPath(guard, outputPath, format, sourceRealPath, stateRoot),
        withOutputParentScope: withWindowsOutputParentScope,
        createStagingDirectory: (parent, exportId, outputPath, prefix) => windowsCreateStagingDirectory(parent, exportId, outputPath, prefix),
        checkOutputParentCheckpoint: createWindowsOutputCheckpoint(guard),
    };
    return Object.freeze(operations);
}
