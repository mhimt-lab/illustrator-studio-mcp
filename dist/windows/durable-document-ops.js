import { lstat, realpath, stat } from 'node:fs/promises';
import { win32 } from 'node:path';
import { BackupPreconditionError } from '../document-backup.js';
import { LifecyclePreconditionError } from '../document-lifecycle.js';
import { openPrivateDirectory } from '../private-state.js';
import { barrierPathCandidates } from '../release-barrier.js';
import { defaultWindowsDocumentFileOps, readWindowsDocumentFileFacts, resolveWindowsDocumentPath, } from './document-file-facts.js';
import { WINDOWS_DOCUMENT_PATH_MAX_CHARS, WindowsDocumentPathError, isWindowsOneDrivePath, windowsPathKey } from './document-path.js';
import { WindowsOutputDirectoryError } from './output-dir-guard.js';
function describeError(error) {
    return error instanceof Error ? error.message : String(error);
}
function pathCandidates(path) {
    return new Set([...barrierPathCandidates(path), windowsPathKey(path)]);
}
export function windowsSameFilePath(left, right) {
    const known = pathCandidates(right);
    for (const candidate of pathCandidates(left))
        if (known.has(candidate))
            return true;
    return false;
}
export async function assertWindowsSameFilePathIdentity(reported, admitted) {
    if (!windowsSameFilePath(reported, admitted))
        throw new Error('File path is not canonically equivalent to the admitted path.');
    if (reported === admitted)
        return;
    const [left, right, leftPath, rightPath] = await Promise.all([
        lstat(reported, { bigint: true }), lstat(admitted, { bigint: true }), realpath(reported), realpath(admitted),
    ]);
    if (!left.isFile() || !right.isFile() || left.dev !== right.dev || left.ino !== right.ino || windowsPathKey(leftPath) !== windowsPathKey(rightPath)) {
        throw new Error('Canonical file path aliases do not identify the same admitted file entry.');
    }
}
export async function assertWindowsCanonicalDocumentPath(path) {
    let leaf;
    try {
        leaf = await lstat(path);
    }
    catch (error) {
        throw new LifecyclePreconditionError('source_file_unavailable', `The document file could not be inspected: ${describeError(error)}`);
    }
    if (leaf.isSymbolicLink() || !leaf.isFile())
        throw new LifecyclePreconditionError('document_not_admitted', 'The document path is not a regular file; a symbolic link is refused for in-place save.');
    let real;
    try {
        real = await realpath(path);
    }
    catch (error) {
        throw new LifecyclePreconditionError('source_file_unavailable', `The document file could not be resolved: ${describeError(error)}`);
    }
    if (!windowsSameFilePath(real, path)) {
        throw new LifecyclePreconditionError('document_not_admitted', `The document path resolves through a link, junction, substituted drive or short name (${real}); in-place save requires the canonical path.`);
    }
}
function isSourceBusy(error) {
    const code = error?.code;
    return code === 'EBUSY' || code === 'EPERM';
}
export function createWindowsInspectSourceFile(ops = defaultWindowsDocumentFileOps) {
    return async (path) => {
        let busy;
        const watched = {
            ...ops,
            statOpened: async (target) => {
                try {
                    return await ops.statOpened(target);
                }
                catch (error) {
                    if (isSourceBusy(error))
                        busy = error;
                    throw error;
                }
            },
        };
        let facts;
        try {
            facts = await readWindowsDocumentFileFacts(await resolveWindowsDocumentPath(path, watched), watched);
        }
        catch (error) {
            if (busy !== undefined) {
                throw new BackupPreconditionError('source_file_unavailable', `[source_file_busy] The source file could not be opened for reading; another process (usually Illustrator) holds it in a way that denies the copy: ${describeError(busy)}`);
            }
            if (error instanceof WindowsDocumentPathError)
                throw new BackupPreconditionError('source_file_unavailable', error.message);
            throw error;
        }
        let named;
        try {
            named = await stat(facts.path, { bigint: true });
        }
        catch (error) {
            throw new BackupPreconditionError('source_file_unavailable', `The source file could not be inspected: ${describeError(error)}`);
        }
        const { dev, ino, size, mtimeNs } = facts.identity;
        if (!named.isFile() || named.dev !== dev || named.ino !== ino || named.size !== size || named.mtimeNs !== mtimeNs) {
            throw new BackupPreconditionError('source_file_unavailable', 'The source file changed while it was being inspected.');
        }
        const identity = { dev, ino, size, mtimeNs, ctimeNs: named.ctimeNs };
        return { path: facts.path, bytes: facts.bytes, identity };
    };
}
export async function resolveWindowsBackupRoot(path) {
    const unavailable = (message) => new BackupPreconditionError('backup_root_unavailable', message);
    let resolved;
    try {
        resolved = await realpath(path);
    }
    catch (error) {
        throw unavailable(`The backup root could not be resolved: ${describeError(error)}`);
    }
    let metadata;
    try {
        metadata = await stat(resolved);
    }
    catch (error) {
        throw unavailable(`The backup root could not be inspected: ${describeError(error)}`);
    }
    if (!metadata.isDirectory())
        throw unavailable('The backup root is not a directory.');
    if (windowsPathKey(resolved) !== windowsPathKey(path)) {
        throw unavailable(`The backup root resolves to ${resolved}: a link, junction, substituted drive or short name is not accepted.`);
    }
    try {
        await (await openPrivateDirectory(path)).close();
    }
    catch (error) {
        throw unavailable(`The backup root must be a plain directory inside the MCP state root of this process: ${describeError(error)}`);
    }
    return path;
}
export function windowsBackupFileName(backupId, sourcePath, backupRoot) {
    const name = win32.basename(sourcePath);
    const extension = win32.extname(name);
    const stem = name.slice(0, name.length - extension.length);
    const prefix = `${backupId}-`;
    const budget = WINDOWS_DOCUMENT_PATH_MAX_CHARS - backupRoot.length - 1 - prefix.length - extension.length;
    if (stem.length <= budget)
        return `${prefix}${stem}${extension}`;
    let kept = '';
    for (const character of stem) {
        if (kept.length + character.length > budget)
            break;
        kept += character;
    }
    if (extension === '')
        kept = kept.replace(/[. ]+$/u, '');
    return `${prefix}${kept}${extension}`;
}
export function windowsBackupRootRefusal(requested) {
    if (requested === undefined)
        return null;
    return '[backup_root_unsupported] backup_root is not supported on Windows: backups are always kept in the backups folder of the MCP state root. Call again without backup_root. Nothing was read, copied or opened.';
}
export function createWindowsSavedDocumentCloseRefusal(saveDocumentRegistered) {
    return () => saveDocumentRegistered ? null
        : 'On Windows only a document that has no file on disk (never saved) can be closed; this document is backed by a file, so nothing was closed.';
}
export function windowsHostPathForms(path) {
    return [path];
}
export async function checkWindowsDocumentSaveLocation(documentPath, env = process.env) {
    if (!isWindowsOneDrivePath(documentPath, env))
        return;
    throw new WindowsDocumentPathError('onedrive_output', 'path_invalid', `${documentPath} is in a OneDrive folder; an in-place save is not accepted there. Save a copy with illustrator_save_document_as to a local folder instead. / ` +
        'OneDrive のフォルダにある文書は、上書き保存できません。illustrator_save_document_as でローカルのフォルダへ保存してください。');
}
const DOCUMENT_FOLDER_NOTE = ' (document folder / 文書のフォルダ: the folder the document is saved in is not accepted for an in-place save. ' +
    'Use illustrator_save_document_as to a folder only you can write to, or create a folder directly under your profile and turn its inheritance off. / ' +
    '文書を上書き保存するフォルダが条件を満たしません。illustrator_save_document_as で自分だけが書き込めるフォルダへ保存するか、プロファイル直下に継承を切ったフォルダを作ってください。)';
export function createWindowsDocumentDirectoryCheck(guard, resolveReal = realpath) {
    return async (point, documentPath) => {
        let real;
        try {
            real = await resolveReal(documentPath);
        }
        catch (error) {
            throw new LifecyclePreconditionError('source_file_unavailable', `The document file could not be resolved: ${describeError(error)}`);
        }
        try {
            await guard.check({ kind: 'document', point, parent: win32.dirname(real), files: [real] });
        }
        catch (error) {
            if (error instanceof WindowsOutputDirectoryError) {
                throw new LifecyclePreconditionError(error.publicReason, `${error.message}${DOCUMENT_FOLDER_NOTE}`);
            }
            throw error;
        }
    };
}
