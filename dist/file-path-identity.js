import { lstat, realpath } from 'node:fs/promises';
import { dirname } from 'node:path';
import { documentKeyPath, pathComparisonParams, sameFilePath } from './file-path.js';
export async function proveSaveSessionIdentity(record, document) {
    if (record.state !== 'open' || record.sourceFileRevision !== document.fileRevision)
        return { state: 'unproven', reason: 'session_state_or_revision_mismatch' };
    try {
        await assertSameFilePathIdentity(document.path, record.sourcePath);
        const observed = await lstat(document.path, { bigint: true });
        if (!observed.isFile() || observed.dev.toString() !== record.sourceInode.dev || observed.ino.toString() !== record.sourceInode.ino) {
            return { state: 'unproven', reason: 'session_record_inode_mismatch' };
        }
        return { state: 'proven', record, documentPath: document.path, documentRevision: document.fileRevision };
    }
    catch (error) {
        return { state: 'unproven', reason: error instanceof Error ? error.message : String(error) };
    }
}
async function bindEditSessionPath(admission, key) {
    const path = documentKeyPath(key);
    if (path === null)
        return admission;
    const matches = admission.sessions.filter((session) => sameFilePath(session.sourcePath, path));
    if (matches.length > 1)
        throw new Error('EDIT_SESSION_DUPLICATE_PATH: More than one open session uses the full key path.');
    if (matches.length === 1)
        await assertSameFilePathIdentity(path, matches[0].sourcePath);
    return { ...admission, boundDocumentKey: key,
        sessions: admission.sessions.map((session) => session === matches[0] ? { ...session, sourcePathMatch: path,
            ...(session.globalExemptPaths?.includes(session.sourcePath) === true
                ? { globalExemptPaths: [...new Set([...session.globalExemptPaths, path])] } : {}),
        } : session), };
}
export async function assertSameFilePathIdentity(reported, admitted) {
    if (!sameFilePath(reported, admitted))
        throw new Error('File path is not canonically equivalent to the admitted path.');
    if (reported === admitted)
        return;
    const [left, right, leftPath, rightPath] = await Promise.all([
        lstat(reported, { bigint: true }), lstat(admitted, { bigint: true }), realpath(reported), realpath(admitted),
    ]);
    if (!left.isFile() || !right.isFile() || left.dev !== right.dev || left.ino !== right.ino || leftPath !== rightPath) {
        throw new Error('Canonical file path aliases do not identify the same admitted file entry.');
    }
}
export async function matchingDocumentPaths(inventory, paths) {
    if (inventory.documents.length !== inventory.documentCount)
        throw new Error('The raw document inventory is incomplete.');
    const matches = [];
    for (const document of inventory.documents) {
        if (document.path === null)
            throw new Error('An open document path is unavailable; absence cannot be established.');
        const admitted = paths.filter((path) => sameFilePath(document.path, path));
        if (admitted.length === 0)
            continue;
        for (const path of admitted)
            await assertSameFilePathIdentity(document.path, path);
        matches.push(document);
    }
    return matches;
}
export async function matchingDocumentScope(inventory, scope) {
    if (scope.directories.length === 0)
        return await matchingDocumentPaths(inventory, scope.paths);
    if (inventory.documents.length !== inventory.documentCount)
        throw new Error('The raw document inventory is incomplete.');
    if (inventory.documentCount === 0)
        return [];
    const directoryIdentities = [];
    for (const directory of scope.directories) {
        const metadata = await lstat(directory, { bigint: true });
        if (!metadata.isDirectory())
            throw new Error('The session scope is not a directory; absence cannot be established.');
        directoryIdentities.push({ dev: metadata.dev, ino: metadata.ino });
    }
    const matches = [];
    for (const document of inventory.documents) {
        if (document.path === null)
            throw new Error('An open document path is unavailable; absence cannot be established.');
        const admitted = scope.paths.filter((path) => sameFilePath(document.path, path));
        if (admitted.length > 0) {
            for (const path of admitted)
                await assertSameFilePathIdentity(document.path, path);
            matches.push(document);
            continue;
        }
        if (await underAnyDirectory(document.path, scope.directories, directoryIdentities))
            matches.push(document);
    }
    return matches;
}
async function underAnyDirectory(documentPath, directories, identities) {
    const normalizedPath = documentPath.normalize('NFC');
    if (directories.some((directory) => normalizedPath.startsWith(`${directory.normalize('NFC').replace(/\/+$/u, '')}/`)))
        return true;
    let real = await realpath(dirname(documentPath));
    for (;;) {
        const metadata = await lstat(real, { bigint: true });
        if (!metadata.isDirectory())
            throw new Error('An open document parent is not a directory; absence cannot be established.');
        if (identities.some((identity) => identity.dev === metadata.dev && identity.ino === metadata.ino))
            return true;
        const next = dirname(real);
        if (next === real)
            return false;
        real = next;
    }
}
export function withFilePathComparisons(command) {
    const params = pathComparisonParams(command.params ?? {});
    const forms = (params.hostFilePathForms ?? {});
    const bindings = (params.hostDocumentPathBindings ?? {});
    const clean = { ...command, ...(command.params === undefined ? {} : { params }) };
    if (Object.keys(forms).length === 0 && Object.keys(bindings).length === 0 && command.hostGate?.beforeHost === undefined)
        return clean;
    return { ...clean, hostGate: { ...command.hostGate, beforeHost: async (context) => {
                for (const [path, candidates] of Object.entries(bindings)) {
                    for (const binding of candidates)
                        await assertSameFilePathIdentity(binding.path, path);
                }
                for (const [path, candidates] of Object.entries(forms)) {
                    try {
                        await lstat(path);
                    }
                    catch (error) {
                        if (error.code === 'ENOENT')
                            continue;
                        throw error;
                    }
                    for (const candidate of candidates) {
                        if (candidate === path)
                            continue;
                        try {
                            await lstat(candidate);
                        }
                        catch (error) {
                            if (error.code === 'ENOENT')
                                continue;
                            throw error;
                        }
                        await assertSameFilePathIdentity(candidate, path);
                    }
                }
                const transport = await command.hostGate?.beforeHost?.(context);
                if (transport?.editSessionAdmission === undefined)
                    return transport;
                return { ...transport, editSessionAdmission: await bindEditSessionPath(transport.editSessionAdmission, params.expectedDocumentKey) };
            } } };
}
