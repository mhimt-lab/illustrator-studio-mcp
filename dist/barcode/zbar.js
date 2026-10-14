import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
const FALLBACK_DIRECTORIES = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
const ZBAR_SYMBOL = {
    ean13: { enable: 'ean13', labels: ['EAN-13', 'UPC-A'] },
    ean8: { enable: 'ean8', labels: ['EAN-8'] },
    itf14: { enable: 'i25', labels: ['I2/5'] },
};
export const ZBAR_TIMEOUT_MS = 15_000;
export const NO_SYMBOL_EXIT_CODES = [1, 4];
export function findZbarimg(pathValue = process.env.PATH) {
    const directories = [...(pathValue ?? '').split(delimiter).filter(Boolean), ...FALLBACK_DIRECTORIES];
    for (const directory of directories) {
        const candidate = join(directory, 'zbarimg');
        try {
            accessSync(candidate, constants.X_OK);
            return candidate;
        }
        catch { }
    }
    return null;
}
export async function decodeWithZbar(pngPath, symbology, expectedDigits, binary = findZbarimg()) {
    if (binary === null)
        return { status: 'not_run', reason: 'zbarimg_not_found', detail: 'zbarimg was not found on PATH or in the usual install directories.' };
    const spec = ZBAR_SYMBOL[symbology];
    const args = ['-q', '-Sdisable', `-S${spec.enable}.enable`, pngPath];
    return new Promise((resolve) => {
        execFile(binary, args, { timeout: ZBAR_TIMEOUT_MS, windowsHide: true, maxBuffer: 1 << 20 }, (error, stdout) => {
            const lines = String(stdout).split('\n').map((line) => line.trim()).filter(Boolean);
            if (error !== null && !(typeof error.code === 'number' && NO_SYMBOL_EXIT_CODES.includes(error.code))) {
                resolve({ status: 'not_run', reason: 'zbarimg_failed', detail: `${error.message}`.slice(0, 300) });
                return;
            }
            const decoder = `zbarimg ${binary}`;
            if (lines.length !== 1) {
                resolve({ status: 'mismatch', decoded: null, symbology: null, decoder, detail: `expected one symbol, decoded ${lines.length}` });
                return;
            }
            const separator = lines[0].indexOf(':');
            const label = lines[0].slice(0, separator);
            const decoded = lines[0].slice(separator + 1);
            const normalized = label === 'UPC-A' && decoded.length === 12 ? `0${decoded}` : decoded;
            resolve(spec.labels.includes(label) && normalized === expectedDigits
                ? { status: 'match', decoded: normalized, symbology: label, decoder }
                : { status: 'mismatch', decoded: normalized, symbology: label, decoder, detail: 'decoded value or symbology differs from the request' });
        });
    });
}
