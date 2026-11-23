import { realpath as fsRealpath } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { checkLinkTargetsBeforeOpen } from './image-reparse-gate.js';
import { WindowsDocumentPathError, assertWindowsDocumentPath, windowsPathKey } from './document-path.js';
const toStat = (value) => ({ dev: value.dev, ino: value.ino, size: value.size, mtimeNs: value.mtimeNs, isFile: value.isFile() });
export const defaultWindowsDocumentFileOps = {
    checkTargets: (paths) => checkLinkTargetsBeforeOpen(paths),
    async statOpened(path) {
        const handle = await open(path, 'r');
        try {
            const opened = toStat(await handle.stat({ bigint: true }));
            const named = toStat(await stat(path, { bigint: true }));
            return { opened, named };
        }
        finally {
            await handle.close();
        }
    },
    statPath: async (path) => toStat(await stat(path, { bigint: true })),
    realpath: (path) => new Promise((resolve, reject) => {
        fsRealpath.native(path, { encoding: 'utf8' }, (error, resolved) => (error ? reject(error) : resolve(resolved)));
    }),
};
function errno(error) {
    return error?.code;
}
function describe(error) {
    const raw = error instanceof Error ? error.message : String(error);
    return (raw.length > 0 ? raw : 'unknown error').slice(0, 300);
}
export async function resolveWindowsDocumentPath(path, ops = defaultWindowsDocumentFileOps, options = {}) {
    assertWindowsDocumentPath(path, 'open', options);
    const [verdict] = await ops.checkTargets([path]);
    if (verdict === undefined)
        throw new WindowsDocumentPathError('attributes_unreadable', 'source_file_unavailable', 'The file attributes were not observed; the file was not opened.');
    switch (verdict.status) {
        case 'missing':
            throw new WindowsDocumentPathError('not_found', 'source_file_unavailable', 'The file does not exist.');
        case 'unreadable':
            throw new WindowsDocumentPathError('attributes_unreadable', 'source_file_unavailable', verdict.message);
        case 'would_fetch':
            throw new WindowsDocumentPathError('cloud_placeholder', 'path_invalid', `The file may be a cloud placeholder (${verdict.names.join(', ')}); it was not opened, to avoid downloading it. Make it available offline first.`);
        case 'clear': {
            const final = verdict.finalPath.replace(/^\\\\\?\\/u, '');
            if (windowsPathKey(final) !== windowsPathKey(path)) {
                throw new WindowsDocumentPathError('reparse_point', 'path_invalid', `The path resolves to "${final}": a symbolic link, junction, substituted drive or short name is not accepted. Pass the real path.`);
            }
            return final;
        }
    }
}
export async function readWindowsDocumentFileFacts(realPath, ops = defaultWindowsDocumentFileOps) {
    let seen;
    try {
        seen = await ops.statOpened(realPath);
    }
    catch (error) {
        if (errno(error) === 'ENOENT')
            throw new WindowsDocumentPathError('not_found', 'source_file_unavailable', 'The file does not exist.');
        throw new WindowsDocumentPathError('file_unreadable', 'source_file_unavailable', `The file could not be opened for reading: ${describe(error)}`);
    }
    const { opened, named } = seen;
    if (!opened.isFile || !named.isFile)
        throw new WindowsDocumentPathError('not_regular_file', 'source_file_unavailable', 'The path is not a regular file.');
    if (!sameStat(opened, named))
        throw new WindowsDocumentPathError('file_changed', 'source_file_unavailable', 'The path no longer identifies the file object that was opened.');
    if (opened.size <= 0n)
        throw new WindowsDocumentPathError('file_empty', 'source_file_unavailable', 'The file is empty.');
    if (opened.size > BigInt(Number.MAX_SAFE_INTEGER))
        throw new WindowsDocumentPathError('file_unreadable', 'source_file_unavailable', 'The file size exceeds the exact integer range.');
    const bytes = Number(opened.size);
    const mtimeMs = Number(opened.mtimeNs / 1000000n);
    return { path: realPath, bytes, mtimeMs, fileRevision: `${bytes}:${mtimeMs}`, identity: { dev: opened.dev, ino: opened.ino, size: opened.size, mtimeNs: opened.mtimeNs } };
}
function sameStat(left, right) {
    return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeNs === right.mtimeNs && left.isFile === right.isFile;
}
export async function recheckWindowsDocumentFile(facts, hostFileRevision, ops = defaultWindowsDocumentFileOps) {
    let now;
    try {
        now = await ops.statPath(facts.path);
    }
    catch (error) {
        return `The opened document's file could not be inspected again: ${describe(error)}`;
    }
    if (!now.isFile || now.dev !== facts.identity.dev || now.ino !== facts.identity.ino || now.size !== facts.identity.size || now.mtimeNs !== facts.identity.mtimeNs) {
        return 'The file changed or was replaced while Illustrator opened it.';
    }
    const match = hostFileRevision === null ? null : /^(\d+):\d+$/u.exec(hostFileRevision);
    if (match === null)
        return `The opened document reports no usable file revision (${String(hostFileRevision)}).`;
    if (Number(match[1]) !== facts.bytes)
        return `The opened document's file revision (${String(hostFileRevision)}) does not carry the byte length of the file (${facts.bytes}).`;
    return null;
}
