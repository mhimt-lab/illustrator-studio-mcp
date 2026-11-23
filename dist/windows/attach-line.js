import { validateWindowsAttachObservation } from './attach-observation.js';
export const WINDOWS_ATTACH_LINE_MAX_CHARS = 4096;
const ATTACH_KEYS = ['apartmentState', 'attachAvailable', 'fileVersions', 'paths', 'powerShellVersion', 'processCount', 'version'];
export function parseWindowsAttachLine(line, nonce) {
    if (line.length > WINDOWS_ATTACH_LINE_MAX_CHARS)
        return null;
    const match = /^attach ([0-9a-f-]{36}) (\{[\x20-\x7e]*\})\n$/u.exec(line);
    if (!match || match[1] !== nonce)
        return null;
    let parsed;
    try {
        parsed = JSON.parse(match[2]);
    }
    catch {
        return null;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
        return null;
    const keys = Object.keys(parsed).sort();
    if (keys.length !== ATTACH_KEYS.length || keys.some((key, index) => key !== ATTACH_KEYS[index]))
        return null;
    if (!Array.isArray(parsed.fileVersions))
        return null;
    return validateWindowsAttachObservation(parsed);
}
