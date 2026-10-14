import { checkLinkTargetsBeforeOpen, MAX_BATCH_PATHS, refusalMessage } from './image-reparse-gate.js';
import { validateWindowsOutputPath } from './output-path.js';
export function windowsImagePreflightBatchGate(check = checkLinkTargetsBeforeOpen) {
    return async (paths) => {
        if (paths.length > MAX_BATCH_PATHS)
            throw new RangeError(`At most ${MAX_BATCH_PATHS} linked paths can be checked per request; files were not opened.`);
        const verdicts = new Map();
        const valid = [];
        for (const path of paths) {
            const shape = validateWindowsOutputPath(path);
            if (shape.ok)
                valid.push(path);
            else
                verdicts.set(path, { status: 'unavailable', path, reason: 'file_stat_failed',
                    message: `The linked path is not a plain local drive-letter path (${shape.reason}); it was not opened.` });
        }
        if (valid.length === 0)
            return verdicts;
        const readings = await check(valid);
        if (readings.length !== valid.length)
            throw new Error('Linked image attribute observation is incomplete; files were not opened.');
        for (const [index, path] of valid.entries()) {
            const reading = readings[index];
            if (reading.status === 'clear')
                verdicts.set(path, { status: 'clear' });
            else if (reading.status === 'missing')
                verdicts.set(path, { status: 'missing', path });
            else if (reading.status === 'would_fetch' || reading.status === 'unreadable') {
                verdicts.set(path, { status: 'unavailable', path, reason: 'file_stat_failed', message: refusalMessage(reading).slice(0, 500) });
            }
            else
                throw new Error('Linked image attribute observation is invalid; files were not opened.');
        }
        return verdicts;
    };
}
