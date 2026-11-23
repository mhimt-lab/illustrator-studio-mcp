import { LifecyclePreconditionError } from '../document-lifecycle.js';
import { validateWindowsOutputPath } from './output-path.js';
export const WINDOWS_DOCUMENT_PATH_MAX_CHARS = 259;
export class WindowsDocumentPathError extends LifecyclePreconditionError {
    code;
    constructor(code, reason, detail) {
        super(reason, `[${code}] ${detail}`);
        this.code = code;
        this.name = 'WindowsDocumentPathError';
    }
}
const ONEDRIVE_COMPONENT = /^onedrive(?: - .+)?$/iu;
export function isWindowsOneDrivePath(path, env = process.env) {
    const lower = path.toLowerCase();
    for (const name of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
        const root = env[name]?.trim().replace(/\\+$/u, '').toLowerCase();
        if (root && (lower === root || lower.startsWith(`${root}\\`)))
            return true;
    }
    return path.split('\\').slice(0, -1).some((component) => ONEDRIVE_COMPONENT.test(component));
}
export function validateWindowsDocumentPath(path, purpose, options = {}) {
    const shape = validateWindowsOutputPath(path);
    if (!shape.ok) {
        if (shape.reason === 'forbidden_character' && shape.component?.includes(':'))
            return { ok: false, reason: 'alternate_data_stream', component: shape.component };
        return shape;
    }
    if (path.length > WINDOWS_DOCUMENT_PATH_MAX_CHARS)
        return { ok: false, reason: 'path_too_long' };
    const leaf = path.slice(path.lastIndexOf('\\') + 1);
    const extension = options.extension ?? '.ai';
    if (!leaf.toLowerCase().endsWith(extension))
        return { ok: false, reason: 'wrong_extension', component: leaf };
    if (leaf.length === extension.length)
        return { ok: false, reason: 'no_file_name', component: leaf };
    if (purpose === 'output' && isWindowsOneDrivePath(path, options.env))
        return { ok: false, reason: 'onedrive_output' };
    return { ok: true };
}
export function describeWindowsDocumentPathRejection(reason, component) {
    const where = component === undefined ? '' : ` (${JSON.stringify(component)})`;
    switch (reason) {
        case 'unc_or_device': return 'UNC and device paths (\\\\server\\share, \\\\?\\, \\\\.\\) are not accepted; use a local drive path such as C:\\dir\\file.ai.';
        case 'alternate_data_stream': return `The path names an alternate data stream${where}; use a plain file name.`;
        case 'path_too_long': return `The path is longer than ${WINDOWS_DOCUMENT_PATH_MAX_CHARS} characters.`;
        case 'wrong_extension': return `The path must end with the document extension${where}.`;
        case 'onedrive_output': return 'A OneDrive folder is not accepted as an output location on Windows.';
        default: return `The path must be a fully qualified local drive path with \\ separators and plain file names: ${reason}${where}.`;
    }
}
export function assertWindowsDocumentPath(path, purpose, options = {}) {
    const verdict = validateWindowsDocumentPath(path, purpose, options);
    if (!verdict.ok)
        throw new WindowsDocumentPathError(verdict.reason, 'path_invalid', describeWindowsDocumentPathRejection(verdict.reason, verdict.component));
}
export function windowsPathKey(path) {
    return path.replace(/^\\\\\?\\/u, '').normalize('NFC').toLowerCase();
}
export function sameWindowsFilePath(left, right) {
    return windowsPathKey(left) === windowsPathKey(right);
}
export function isWithinWindowsDirectory(path, directory) {
    const base = windowsPathKey(directory).replace(/\\+$/u, '');
    const key = windowsPathKey(path);
    return key === base || key.startsWith(`${base}\\`);
}
