import { defaultWindowsDocumentFileOps, readWindowsDocumentFileFacts, recheckWindowsDocumentFile, resolveWindowsDocumentPath, } from './document-file-facts.js';
import { WindowsDocumentPathError, isWithinWindowsDirectory, sameWindowsFilePath } from './document-path.js';
export function windowsOpenPathPolicy(ops = defaultWindowsDocumentFileOps, env = process.env) {
    return {
        async validate(input, stateRoot) {
            const realPath = await resolveWindowsDocumentPath(input, ops, { env });
            const root = await ops.realpath(stateRoot).catch(() => null);
            if (root !== null && isWithinWindowsDirectory(realPath, root)) {
                throw new WindowsDocumentPathError('inside_state_root', 'path_invalid', 'The path is inside the MCP state root (backup and export work files are managed by their own tools).');
            }
            const facts = await readWindowsDocumentFileFacts(realPath, ops);
            return { path: facts.path, bytes: facts.bytes, confirmOpened: (hostFileRevision) => recheckWindowsDocumentFile(facts, hostFileRevision, ops) };
        },
        sameFile: sameWindowsFilePath,
    };
}
