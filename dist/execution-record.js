export function isFileTime(value) {
    return typeof value === 'string' && /^[1-9][0-9]*$/u.test(value);
}
export function parseExecutionRecord(text, platform = process.platform) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return { state: 'invalid' };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        return { state: 'invalid' };
    const value = parsed;
    if (!Number.isSafeInteger(value.version) || value.version <= 0)
        return { state: 'invalid' };
    if (value.version !== (platform === 'win32' ? 2 : 1))
        return { state: 'unsupported_version' };
    const keys = Object.keys(value).sort().join(',');
    const expected = value.version === 1 ? 'nonce,pid,processGroupId,startedAt,state,version'
        : 'creationTime,nonce,pid,startedAt,state,version';
    if (keys !== expected || value.state !== 'prepared' || typeof value.pid !== 'number' ||
        !Number.isSafeInteger(value.pid) || value.pid <= 0 || typeof value.nonce !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.nonce) ||
        typeof value.startedAt !== 'string' || value.startedAt.length === 0 ||
        (value.version === 1 ? value.processGroupId !== value.pid : !isFileTime(value.creationTime))) {
        return { state: 'invalid' };
    }
    return { state: 'valid', value: value };
}
export function prepareExecutionRecord(identity, startedAt, platform = process.platform) {
    const value = { version: platform === 'win32' ? 2 : 1, state: 'prepared', ...identity, startedAt };
    if (platform !== 'win32')
        return value;
    const inspection = parseExecutionRecord(JSON.stringify(value), platform);
    if (inspection.state !== 'valid')
        throw new Error('Execution identity does not match the current platform.');
    return inspection.value;
}
export function executionIdentityMatches(actual, expected) {
    if (actual.version !== expected.version || actual.pid !== expected.pid || actual.nonce !== expected.nonce)
        return false;
    return actual.version === 1 && expected.version === 1 ? actual.processGroupId === expected.processGroupId
        : actual.version === 2 && expected.version === 2 && actual.creationTime === expected.creationTime;
}
export function executionRecordsMatch(actual, expected) {
    return executionIdentityMatches(actual, expected) && actual.state === expected.state && actual.startedAt === expected.startedAt;
}
