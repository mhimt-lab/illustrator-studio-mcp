import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { findZbarimg, NO_SYMBOL_EXIT_CODES, ZBAR_TIMEOUT_MS } from './barcode/zbar.js';
export { findZbarimg, ZBAR_TIMEOUT_MS };
export function compositeOnWhitePng(png) {
    const image = PNG.sync.read(png, { checkCRC: true });
    const flat = new PNG({ width: image.width, height: image.height });
    for (let offset = 0; offset < image.data.length; offset += 4) {
        const alpha = (image.data[offset + 3] ?? 255) / 255;
        for (let channel = 0; channel < 3; channel += 1) {
            flat.data[offset + channel] = Math.round((image.data[offset + channel] ?? 0) * alpha + 255 * (1 - alpha));
        }
        flat.data[offset + 3] = 255;
    }
    return PNG.sync.write(flat, { colorType: 2 });
}
export async function decodeWithZbar(png, options = {}) {
    const executable = options.zbarimgPath === undefined ? findZbarimg() : options.zbarimgPath;
    if (executable === null)
        return { status: 'unavailable', reason: 'zbarimg_not_found' };
    const directory = await mkdtemp(join(tmpdir(), 'illustrator-studio-mcp-zbar-'));
    const started = performance.now();
    try {
        const file = join(directory, 'symbol.png');
        await writeFile(file, compositeOnWhitePng(png), { mode: 0o600 });
        return await new Promise((resolve) => {
            execFile(executable, ['--quiet', '--raw', '-Sbinary', file], { encoding: 'buffer', timeout: options.timeoutMs ?? ZBAR_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
                const elapsedMs = Math.round(performance.now() - started);
                if (error === null)
                    return resolve({ status: 'decoded', payload: stdout, elapsedMs });
                const code = error.code;
                if (typeof code === 'number' && NO_SYMBOL_EXIT_CODES.includes(code))
                    return resolve({ status: 'no_symbol', elapsedMs });
                resolve({ status: 'error', message: `zbarimg failed (${String(code)}): ${stderr.toString('utf8').slice(0, 200)}`, elapsedMs });
            });
        });
    }
    finally {
        await rm(directory, { recursive: true, force: true });
    }
}
