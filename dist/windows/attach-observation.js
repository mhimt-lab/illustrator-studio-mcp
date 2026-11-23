export function validateWindowsAttachObservation(parsed) {
    const value = parsed;
    if (!value || !/^5\.1\./u.test(value.powerShellVersion) || value.apartmentState !== 'STA' ||
        !Number.isSafeInteger(value.processCount) || value.processCount < 0 || !Array.isArray(value.paths) ||
        value.paths.length !== value.processCount ||
        (value.fileVersions !== undefined && (!Array.isArray(value.fileVersions) || value.fileVersions.length !== value.processCount ||
            value.fileVersions.some((fileVersion) => fileVersion !== null && typeof fileVersion !== 'string'))) ||
        value.paths.some((path) => typeof path !== 'string' || !/^[A-Za-z]:\\.*\\Illustrator\.exe$/iu.test(path)) ||
        typeof value.attachAvailable !== 'boolean' || (value.version !== null && typeof value.version !== 'string') ||
        (value.attachAvailable && value.processCount !== 1))
        return null;
    return value;
}
