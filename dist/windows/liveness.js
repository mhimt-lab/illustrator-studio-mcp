import { execFile } from 'node:child_process';
import { isFileTime } from '../execution-record.js';
import { windowsPowerShellEnvironment, windowsPowerShellExecutable } from './powershell-runner.js';
function isPid(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
export function windowsExecutionLiveness(record, observation) {
    if (!isPid(record.pid) || !isFileTime(record.creationTime))
        return 'unknown';
    if (observation.pid !== record.pid)
        return 'unknown';
    switch (observation.kind) {
        case 'not_found':
            return 'inactive';
        case 'found':
            if (!isFileTime(observation.creationTime))
                return 'unknown';
            if (observation.creationTime === record.creationTime)
                return 'active';
            return BigInt(observation.creationTime) > BigInt(record.creationTime) ? 'inactive' : 'unknown';
        case 'error':
            return 'unknown';
        default:
            return 'unknown';
    }
}
const PROCESS_CREATION_SCRIPT = [
    "$ErrorActionPreference = 'Stop'",
    '$process = Get-Process -Id ([int]$env:MCP_WIN_LIVENESS_PID) -ErrorAction Stop',
    '[Console]::Out.Write($process.StartTime.ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture))',
].join('\r\n');
export async function observeWindowsProcess(pid) {
    const systemRoot = process.env.SystemRoot;
    if (!isPid(pid) || !systemRoot)
        return { pid, kind: 'error' };
    return await new Promise((resolve) => {
        execFile(windowsPowerShellExecutable(systemRoot), ['-NoProfile', '-NonInteractive', '-Command', PROCESS_CREATION_SCRIPT], {
            windowsHide: true, timeout: 5000, maxBuffer: 4096,
            env: { ...windowsPowerShellEnvironment(process.env), MCP_WIN_LIVENESS_PID: String(pid) },
        }, (error, stdout) => {
            const creationTime = stdout.trim();
            resolve(error === null && isFileTime(creationTime) ? { pid, kind: 'found', creationTime } : { pid, kind: 'error' });
        });
    });
}
export async function windowsRecordLiveness(record, probes = {}) {
    if (record.version !== 2 || !isPid(record.pid) || !isFileTime(record.creationTime))
        return 'unknown';
    try {
        (probes.kill ?? process.kill)(record.pid, 0);
    }
    catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
        if (code === 'ESRCH')
            return 'inactive';
        if (code !== 'EPERM')
            return 'unknown';
    }
    try {
        return windowsExecutionLiveness(record, await (probes.observe ?? observeWindowsProcess)(record.pid));
    }
    catch {
        return 'unknown';
    }
}
