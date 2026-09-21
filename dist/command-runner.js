import { execFile } from 'node:child_process';
export const defaultCommandRunner = (command, args, timeoutMs) => new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
        if (error === null) {
            resolve({ kind: 'exit', code: 0, signal: null, stdout, stderr });
            return;
        }
        const failure = error;
        if (failure.killed === true) {
            resolve({ kind: 'timeout', timeoutMs });
            return;
        }
        if (typeof failure.code === 'number') {
            resolve({ kind: 'exit', code: failure.code, signal: failure.signal ?? null, stdout, stderr });
            return;
        }
        if (failure.signal !== undefined && failure.signal !== null && failure.code === undefined) {
            resolve({ kind: 'exit', code: null, signal: failure.signal, stdout, stderr });
            return;
        }
        resolve({ kind: 'spawn_error', message: failure.message });
    });
});
export function describeCommandOutcome(outcome) {
    switch (outcome.kind) {
        case 'timeout': return `timed out after ${outcome.timeoutMs} ms`;
        case 'spawn_error': return `could not be started (${outcome.message})`;
        case 'exit': return `exited with status ${String(outcome.code)}${outcome.signal === null ? '' : ` (signal ${outcome.signal})`}`;
    }
}
