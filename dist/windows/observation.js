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
export function parseWindowsForegroundObservation(output, lockState, observedAt) {
    const observation = (profile, expected = '', frontmost = null) => ({ profile, lockState, frontmostBundleId: frontmost, expectedBundleId: expected, observedAt });
    if (lockState === 'locked')
        return observation('locked');
    if (lockState !== 'unlocked')
        return observation('unknown');
    const value = parseJsonObjectLine(output);
    if (value === null || !hasExactKeys(value, ['foregroundExecutablePath', 'illustratorExecutablePaths']))
        return observation('unknown');
    const running = value.illustratorExecutablePaths;
    if (!Array.isArray(running) || running.length !== 1 || !isExecutablePath(running[0]))
        return observation('unknown');
    const expected = running[0];
    const foreground = value.foregroundExecutablePath;
    if (foreground === null || !isExecutablePath(foreground))
        return observation('unknown', expected);
    return observation(foreground === expected ? 'foreground' : 'background', expected, foreground);
}
