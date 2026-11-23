export const WINDOWS_STABLE_EXECUTABLE_PATH = /^[A-Za-z]:\\Program Files\\Adobe\\Adobe Illustrator \d{4}\\Support Files\\Contents\\Windows\\Illustrator\.exe$/iu;
const VERSION = /^(\d+)\.(\d+)(?:\.\d+){0,2}$/u;
export function windowsVersionMajorMinor(version) {
    if (typeof version !== 'string')
        return null;
    const match = VERSION.exec(version);
    return match === null ? null : `${Number(match[1])}.${Number(match[2])}`;
}
export function windowsProcessEvidence(paths, fileVersions) {
    if (!Array.isArray(paths) || !Array.isArray(fileVersions) || paths.length !== 1 || fileVersions.length !== 1)
        return null;
    const [executablePath] = paths;
    const [fileVersion] = fileVersions;
    return typeof executablePath === 'string' && typeof fileVersion === 'string' ? { executablePath, fileVersion } : null;
}
export function classifyWindowsHostChannel(evidence, comVersion) {
    if (evidence === null || comVersion === null || !WINDOWS_STABLE_EXECUTABLE_PATH.test(evidence.executablePath))
        return 'unknown';
    const file = windowsVersionMajorMinor(evidence.fileVersion);
    return file !== null && file === windowsVersionMajorMinor(comVersion) ? 'stable' : 'unknown';
}
export class WindowsHostChannelState {
    evidence = null;
    comVersion = null;
    static key(evidence) { return `${evidence.executablePath}\0${evidence.fileVersion}`; }
    observe(paths, fileVersions) { this.evidence = windowsProcessEvidence(paths, fileVersions); }
    invalidate() { this.evidence = null; }
    fontApplication() { return this.evidence === null ? null : { ...this.evidence }; }
    noteComVersion(version) {
        if (this.evidence === null || typeof version !== 'string')
            return;
        this.comVersion = { evidenceKey: WindowsHostChannelState.key(this.evidence), version };
    }
    channel() {
        const evidence = this.evidence;
        const com = evidence !== null && this.comVersion?.evidenceKey === WindowsHostChannelState.key(evidence) ? this.comVersion.version : null;
        return classifyWindowsHostChannel(evidence, com);
    }
}
