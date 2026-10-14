import { execFile } from 'node:child_process';
import { realpath as fsRealpath } from 'node:fs';
import { windowsPowerShellEnvironment } from './powershell-runner.js';
export const FILE_ATTRIBUTE_OFFLINE = 0x1000;
export const FILE_ATTRIBUTE_REPARSE_POINT = 0x400;
export const FILE_ATTRIBUTE_RECALL_ON_OPEN = 0x40000;
export const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS = 0x400000;
export const MAX_BATCH_PATHS = 50;
export const POWERSHELL_BATCH_TIMEOUT_MS = 30_000;
const MAX_ENVIRONMENT_JSON_CHARS = 30_000;
const FETCH_ON_READ_ATTRIBUTES = [
    ['OFFLINE', FILE_ATTRIBUTE_OFFLINE],
    ['RECALL_ON_OPEN', FILE_ATTRIBUTE_RECALL_ON_OPEN],
    ['RECALL_ON_DATA_ACCESS', FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS],
];
export function fetchOnReadAttributes(attributes) {
    assertAttributes(attributes);
    return FETCH_ON_READ_ATTRIBUTES.filter(([, bit]) => (attributes & bit) !== 0).map(([name]) => name);
}
function assertAttributes(attributes) {
    if (!Number.isInteger(attributes) || attributes < 0 || attributes > 0xffffffff) {
        throw new RangeError(`File attributes must be an unsigned 32-bit integer, got ${String(attributes)}.`);
    }
}
export const READ_ATTRIBUTES_BATCH_SCRIPT = String.raw `
$ErrorActionPreference = 'Stop'
$paths = ConvertFrom-Json -InputObject $env:ISM_IMAGE_PATHS
$values = New-Object System.Collections.Generic.List[string]
foreach ($path in @($paths)) {
  try { $values.Add([string][int64][IO.File]::GetAttributes($path)) }
  catch [System.IO.FileNotFoundException] { $values.Add('M') }
  catch [System.IO.DirectoryNotFoundException] { $values.Add('M') }
  catch { $values.Add('E') }
}
[Console]::Out.Write(($values -join ','))
`;
export function parseAttributeBatchOutput(output, expectedCount) {
    const tokens = output.trim().split(',');
    if (tokens.length !== expectedCount || !tokens.every((token) => /^(?:\d{1,10}|M|E)$/u.test(token))) {
        throw new Error(`Linked image attribute observation is not ${expectedCount} readings.`);
    }
    return tokens.map((token) => {
        if (token === 'M')
            return { status: 'missing' };
        if (token === 'E')
            return { status: 'error' };
        const attributes = Number(token);
        assertAttributes(attributes);
        return { status: 'ok', attributes };
    });
}
async function readWindowsAttributesBatch(paths) {
    const systemRoot = process.env.SystemRoot;
    if (!systemRoot)
        throw new Error('SystemRoot is not set; image attributes cannot be observed.');
    const json = JSON.stringify(paths);
    if (json.length > MAX_ENVIRONMENT_JSON_CHARS)
        throw new RangeError('The image path batch is too large for one attribute read.');
    const output = await new Promise((resolve, reject) => {
        execFile(`${systemRoot.replace(/\\+$/u, '')}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(READ_ATTRIBUTES_BATCH_SCRIPT, 'utf16le').toString('base64')], { env: { ...windowsPowerShellEnvironment(process.env), ISM_IMAGE_PATHS: json },
            windowsHide: true, timeout: POWERSHELL_BATCH_TIMEOUT_MS, maxBuffer: 16 * 1024, encoding: 'utf8' }, (error, stdout) => {
            if (error)
                reject(Object.assign(new Error('Linked image attributes could not be observed.'), { code: error.killed ? 'ETIMEDOUT' : error.code, signal: error.signal, killed: error.killed }));
            else
                resolve(stdout);
        });
    });
    return parseAttributeBatchOutput(output, paths.length);
}
export const defaultReparseGateOps = {
    realpath: (path) => new Promise((resolve, reject) => {
        fsRealpath.native(path, { encoding: 'utf8' }, (error, resolved) => (error ? reject(error) : resolve(resolved)));
    }),
    readAttributesBatch: readWindowsAttributesBatch,
};
function isMissing(error) {
    const code = error?.code;
    return code === 'ENOENT' || code === 'ENOTDIR';
}
function describe(error) {
    const raw = error instanceof Error ? error.message : String(error);
    return (raw.length > 0 ? raw : 'unknown error').slice(0, 300);
}
export async function checkLinkTargetsBeforeOpen(paths, ops = defaultReparseGateOps) {
    if (paths.length > MAX_BATCH_PATHS) {
        throw new RangeError(`At most ${MAX_BATCH_PATHS} images can be checked in one call, got ${paths.length}.`);
    }
    const verdicts = paths.map(() => null);
    const finals = [];
    for (const [index, path] of paths.entries()) {
        try {
            finals.push({ index, finalPath: await ops.realpath(path) });
        }
        catch (error) {
            verdicts[index] = isMissing(error)
                ? { status: 'missing' }
                : { status: 'unreadable', message: `The link target could not be resolved (${describe(error)}); the file was not opened.` };
        }
    }
    if (finals.length > 0) {
        const unique = [...new Set(finals.map((entry) => entry.finalPath))];
        let readings = null;
        let failure = '';
        try {
            readings = await ops.readAttributesBatch(unique);
            if (readings.length !== unique.length)
                throw new Error('Linked image attribute observation is incomplete.');
            for (const reading of readings)
                if (reading.status === 'ok')
                    assertAttributes(reading.attributes);
        }
        catch (error) {
            readings = null;
            failure = describe(error);
        }
        for (const { index, finalPath } of finals) {
            const reading = readings?.[unique.indexOf(finalPath)];
            if (reading === undefined) {
                verdicts[index] = {
                    status: 'unreadable',
                    message: `The linked file attributes could not be read (${failure}); the file was not opened because it may be a cloud placeholder.`,
                };
            }
            else if (reading.status === 'missing') {
                verdicts[index] = { status: 'missing' };
            }
            else if (reading.status === 'error') {
                verdicts[index] = {
                    status: 'unreadable',
                    message: 'The linked file attributes could not be read; the file was not opened because it may be a cloud placeholder.',
                };
            }
            else {
                const names = fetchOnReadAttributes(reading.attributes);
                verdicts[index] = names.length > 0
                    ? { status: 'would_fetch', finalPath, attributes: reading.attributes, names }
                    : { status: 'clear', finalPath, attributes: reading.attributes };
            }
        }
    }
    return verdicts;
}
export function refusalMessage(verdict) {
    return verdict.status === 'would_fetch'
        ? `The linked file may be a cloud placeholder (${verdict.names.join(', ')}); it was not opened, to avoid downloading it.`
        : verdict.message;
}
