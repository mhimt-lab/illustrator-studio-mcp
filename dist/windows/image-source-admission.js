import { checkLinkTargetsBeforeOpen, FILE_ATTRIBUTE_REPARSE_POINT } from './image-reparse-gate.js';
import { validateWindowsOutputPath } from './output-path.js';
export const WINDOWS_SOURCE_REFUSAL_CODES = [
    'source_path_invalid', 'source_path_reparse', 'source_cloud_placeholder', 'source_file_missing', 'source_not_regular_file',
    'source_file_unavailable', 'source_hash_mismatch', 'source_format_not_supported',
];
export const WINDOWS_CURRENT_LINK_REFUSAL_CODES = [
    'current_link_path_invalid', 'current_link_path_reparse', 'current_link_cloud_placeholder', 'current_link_missing',
    'current_link_not_regular_file', 'current_link_unavailable', 'current_link_format_not_supported',
];
export class WindowsImageRefusedError extends Error {
    reasonCode;
    detail;
    code = 'WINDOWS_IMAGE_REFUSED';
    constructor(reasonCode, detail) {
        super(`Windows image refused before any change (${reasonCode}): ${detail}`);
        this.reasonCode = reasonCode;
        this.detail = detail;
        this.name = 'WindowsImageRefusedError';
    }
}
export const WINDOWS_IMAGE_PATH_MAX_CHARS = 259;
export const WINDOWS_IMAGE_FORMATS = ['tiff', 'jpeg', 'png'];
export function windowsImageRefusalCode(subject, family) {
    if (subject === 'source') {
        const codes = {
            path_invalid: 'source_path_invalid', path_reparse: 'source_path_reparse', cloud_placeholder: 'source_cloud_placeholder',
            missing: 'source_file_missing', not_regular_file: 'source_not_regular_file', unavailable: 'source_file_unavailable',
            format_not_supported: 'source_format_not_supported',
        };
        return codes[family];
    }
    const codes = {
        path_invalid: 'current_link_path_invalid', path_reparse: 'current_link_path_reparse', cloud_placeholder: 'current_link_cloud_placeholder',
        missing: 'current_link_missing', not_regular_file: 'current_link_not_regular_file', unavailable: 'current_link_unavailable',
        format_not_supported: 'current_link_format_not_supported',
    };
    return codes[family];
}
export function sameWindowsPath(left, right) {
    const canonical = (path) => path.normalize('NFC').replaceAll('/', '\\').toLowerCase();
    return canonical(left) === canonical(right);
}
export async function inspectWindowsLocalImage(path, subject, inspector, check = checkLinkTargetsBeforeOpen) {
    const refuse = (family, detail) => new WindowsImageRefusedError(windowsImageRefusalCode(subject, family), detail);
    const shape = validateWindowsOutputPath(path);
    if (!shape.ok) {
        throw refuse('path_invalid', `${path} is not a plain local drive-letter path (${shape.reason}${shape.component === undefined ? '' : `: ${shape.component}`}); UNC, device, relative and alternate-stream paths are refused. Write it as X:\\folder\\file.png with backslashes.`);
    }
    if (path.length > WINDOWS_IMAGE_PATH_MAX_CHARS) {
        throw refuse('path_invalid', `${path} is longer than ${WINDOWS_IMAGE_PATH_MAX_CHARS} characters.`);
    }
    const verdicts = await check([path]);
    if (verdicts.length !== 1)
        throw new Error('Image attribute observation did not return exactly one verdict; the file was not opened.');
    const verdict = verdicts[0];
    if (verdict.status === 'missing')
        throw refuse('missing', `${path} does not exist.`);
    if (verdict.status === 'unreadable')
        throw refuse('unavailable', verdict.message);
    if (verdict.status === 'would_fetch') {
        throw refuse('cloud_placeholder', `${path} may be a cloud placeholder (${verdict.names.join(', ')}); it was not opened, to avoid downloading it.`);
    }
    if (!sameWindowsPath(verdict.finalPath, path)) {
        throw refuse('path_reparse', `${path} resolves to ${verdict.finalPath}; a symbolic link, junction or substituted drive is traversed.`);
    }
    if ((verdict.attributes & FILE_ATTRIBUTE_REPARSE_POINT) !== 0) {
        throw refuse('path_reparse', `${path} is a reparse point (attributes 0x${verdict.attributes.toString(16)}): a symbolic link, a junction or a cloud-synced file.`);
    }
    const inspection = await inspector.inspect(verdict.finalPath);
    if (inspection.status === 'missing')
        throw refuse('missing', `${verdict.finalPath} does not exist.`);
    if (inspection.status === 'unavailable') {
        throw refuse(inspection.reason === 'file_not_regular' ? 'not_regular_file' : 'unavailable', `${inspection.reason}: ${inspection.message}`);
    }
    return { resolvedPath: verdict.finalPath, inspection };
}
export function windowsImageFormatOf(inspection, subject) {
    const format = inspection.metadata.format;
    if (format.status !== 'available') {
        throw new WindowsImageRefusedError(windowsImageRefusalCode(subject, 'format_not_supported'), format.message);
    }
    if (!WINDOWS_IMAGE_FORMATS.includes(format.value)) {
        throw new WindowsImageRefusedError(windowsImageRefusalCode(subject, 'format_not_supported'), `${format.value} is not measured on Windows; only TIFF, JPEG and PNG are admitted.`);
    }
    return format.value;
}
