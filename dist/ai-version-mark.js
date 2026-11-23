import { open } from 'node:fs/promises';
import { noFollowReadFlags } from './platform-primitives.js';
export const SAVE_AS_COMPATIBILITIES = ['cc', 'cs6'];
export const SAVE_AS_CONVERTED_NOTE = 'Illustrator opens an older-version file as a conversion, so this document shows unsaved changes until the next save; the file on disk is unchanged.';
export const SAVE_AS_COMPATIBILITY_SPEC = {
    cc: { hostKey: 'ILLUSTRATOR17', creator: '17.0', fileFormat: '13.0' },
    cs6: { hostKey: 'ILLUSTRATOR16', creator: '16.0', fileFormat: '12.0' },
};
export const VERSION_MARK_SCAN_BYTES = 262_144;
export function parseAiVersionMarks(head) {
    const text = head.subarray(0, VERSION_MARK_SCAN_BYTES).toString('latin1');
    return {
        creator: /^%%Creator: Adobe Illustrator\(R\) (\d+(?:\.\d+)?)[ \t]*\r?$/mu.exec(text)?.[1] ?? null,
        fileFormat: /^%AI5_FileFormat (\d+(?:\.\d+)?)[ \t]*\r?$/mu.exec(text)?.[1] ?? null,
    };
}
export function compatibilityMarkMismatch(marks, compatibility) {
    const expected = SAVE_AS_COMPATIBILITY_SPEC[compatibility];
    if (marks.creator === expected.creator && marks.fileFormat === expected.fileFormat)
        return null;
    return `The saved file does not carry the ${compatibility} version marks (expected %%Creator ${expected.creator} and %AI5_FileFormat ${expected.fileFormat}; found ${marks.creator ?? 'none'} and ${marks.fileFormat ?? 'none'}).`;
}
export async function readAiVersionMarks(path) {
    const handle = await open(path, noFollowReadFlags());
    try {
        const buffer = Buffer.alloc(VERSION_MARK_SCAN_BYTES);
        const { bytesRead } = await handle.read(buffer, 0, VERSION_MARK_SCAN_BYTES, 0);
        return parseAiVersionMarks(buffer.subarray(0, bytesRead));
    }
    finally {
        await handle.close();
    }
}
export async function opensAsConverted(path) {
    try {
        const { fileFormat } = await readAiVersionMarks(path);
        return fileFormat !== null && SAVE_AS_COMPATIBILITIES.some((name) => SAVE_AS_COMPATIBILITY_SPEC[name].fileFormat === fileFormat);
    }
    catch {
        return false;
    }
}
