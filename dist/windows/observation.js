const SESSION_FLAGS_LOCK = 0;
const SESSION_FLAGS_UNLOCK = 1;
const CLIENT_PROTOCOL_CONSOLE = 0;
function parseJsonObjectLine(output) {
    const lines = output.split(/\r?\n/u).filter((line) => line.trim() !== '');
    if (lines.length !== 1)
        return null;
    let value;
    try {
        value = JSON.parse(lines[0]);
    }
    catch {
        return null;
    }
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
}
export const FOREGROUND_PID_KEYS = ['foregroundProcessId', 'illustratorProcessIds'];
function hasExactKeys(value, keys) {
    const actual = Object.keys(value);
    return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
export function parseWindowsSessionState(output) {
    const value = parseJsonObjectLine(output);
    if (value === null || !hasExactKeys(value, ['SessionFlags', 'WTSClientProtocolType']))
        return 'unknown';
    const flags = value.SessionFlags;
    const protocol = value.WTSClientProtocolType;
    if (!Number.isSafeInteger(flags) || !Number.isSafeInteger(protocol))
        return 'unknown';
    if (protocol !== CLIENT_PROTOCOL_CONSOLE)
        return 'unknown';
    if (flags === SESSION_FLAGS_UNLOCK)
        return 'unlocked';
    if (flags === SESSION_FLAGS_LOCK)
        return 'locked';
    return 'unknown';
}
const DRIVE_ABSOLUTE_PATH = /^[A-Za-z]:\\[^\\]/u;
function isExecutablePath(value) {
    return typeof value === 'string' && DRIVE_ABSOLUTE_PATH.test(value) && !value.includes('\0');
}
function isForegroundPidEvidence(foregroundPid, illustratorPids, imageCount) {
    return Number.isSafeInteger(foregroundPid) && foregroundPid >= 0
        && Array.isArray(illustratorPids) && illustratorPids.length === imageCount
        && illustratorPids.every((entry) => Number.isSafeInteger(entry) && entry > 0);
}
function isForeignProcess(foregroundPid, illustratorPids) {
    return foregroundPid > 0 && !illustratorPids.includes(foregroundPid);
}
export function parseWindowsForegroundObservation(output, lockState, observedAt) {
    const observation = (profile, expected = '', frontmost = null) => ({ profile, lockState, frontmostBundleId: frontmost, expectedBundleId: expected, observedAt });
    if (lockState === 'locked')
        return observation('locked');
    if (lockState !== 'unlocked')
        return observation('unknown');
    const value = parseJsonObjectLine(output);
    const base = ['foregroundExecutablePath', 'illustratorExecutablePaths'];
    const withPids = value !== null && FOREGROUND_PID_KEYS.some((key) => Object.hasOwn(value, key));
    if (value === null || !hasExactKeys(value, withPids ? [...base, ...FOREGROUND_PID_KEYS] : base))
        return observation('unknown');
    const running = value.illustratorExecutablePaths;
    if (!Array.isArray(running) || running.length !== 1 || !isExecutablePath(running[0]))
        return observation('unknown');
    const expected = running[0];
    const foreground = value.foregroundExecutablePath;
    if (withPids && !isForegroundPidEvidence(value.foregroundProcessId, value.illustratorProcessIds, running.length))
        return observation('unknown', expected);
    if (foreground === null && withPids && isForeignProcess(value.foregroundProcessId, value.illustratorProcessIds)) {
        return observation('background', expected);
    }
    if (foreground === null || !isExecutablePath(foreground))
        return observation('unknown', expected);
    return observation(foreground === expected ? 'foreground' : 'background', expected, foreground);
}
export function parseWindowsProfileObservation(output, observedAt) {
    const value = parseJsonObjectLine(output);
    const keyed = value !== null && hasExactKeys(value, ['session', 'foreground']);
    const session = keyed ? value.session : undefined;
    const lockState = typeof session === 'object' && session !== null
        ? parseWindowsSessionState(JSON.stringify(session)) : 'unknown';
    const foreground = keyed && lockState === 'unlocked' ? JSON.stringify(value.foreground) : '';
    return parseWindowsForegroundObservation(foreground, lockState, observedAt);
}
