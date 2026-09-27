const CREATION_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$/u;
function isPid(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function isCreationTime(value) {
    return typeof value === 'string' && CREATION_TIME.test(value);
}
export function windowsExecutionLiveness(record, observation) {
    if (!isPid(record.pid) || !isCreationTime(record.creationTime))
        return 'unknown';
    if (observation.pid !== record.pid)
        return 'unknown';
    switch (observation.kind) {
        case 'not_found':
            return 'inactive';
        case 'found':
            if (!isCreationTime(observation.creationTime))
                return 'unknown';
            return observation.creationTime === record.creationTime ? 'active' : 'inactive';
        case 'error':
            return 'unknown';
        default:
            return 'unknown';
    }
}
