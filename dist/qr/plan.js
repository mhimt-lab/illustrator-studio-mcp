import { PNG } from 'pngjs';
import { z } from 'zod';
import { decodeWithZbar } from '../zbar-decode.js';
import { qrDarkModuleCount, qrDarkRuns, qrGeometry } from './layout.js';
import { encodeQrMatrix, qrContentBytes, qrContentDigest } from './matrix.js';
export const QR_ENCODER_IDENTITY = 'nayuki-qr-code-generator@3c6d0b3cefb4e049dc337e82237c9644399716a8';
export function qrMatrixHex(matrix) {
    const bytes = new Uint8Array(Math.ceil((matrix.modules * matrix.modules) / 8));
    matrix.rows.forEach((row, y) => row.forEach((dark, x) => {
        if (!dark)
            return;
        const index = y * matrix.modules + x;
        bytes[index >> 3] = (bytes[index >> 3] ?? 0) | (0x80 >> (index & 7));
    }));
    return Buffer.from(bytes).toString('hex');
}
const cache = new Map();
const CACHE_LIMIT = 4;
export function resolveQr(fields) {
    const key = JSON.stringify([fields.content, fields.errorCorrection, fields.version, fields.quietZoneModules, fields.sizePt]);
    const cached = cache.get(key);
    if (cached !== undefined)
        return cached;
    const matrix = encodeQrMatrix(fields.content, fields.errorCorrection, fields.version);
    const resolved = {
        matrix, runs: qrDarkRuns(matrix), darkModules: qrDarkModuleCount(matrix), contentBytes: qrContentBytes(fields.content).length,
        contentSha256: qrContentDigest(fields.content), matrixHex: qrMatrixHex(matrix), geometry: qrGeometry(matrix, fields.sizePt, fields.quietZoneModules),
        quietZoneModules: fields.quietZoneModules,
    };
    if (cache.size >= CACHE_LIMIT)
        cache.delete(cache.keys().next().value);
    cache.set(key, resolved);
    return resolved;
}
export const planDecodeSchema = z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('match'), decoder: z.literal('zbarimg') }),
    z.strictObject({ status: z.literal('not_run'), reason: z.enum(['zbarimg_not_found', 'zbarimg_failed']), detail: z.string().max(400) }),
]);
export function renderQrPlanPng(resolved, pixelsPerModule = 4) {
    const side = (resolved.matrix.modules + 2 * resolved.quietZoneModules) * pixelsPerModule;
    const png = new PNG({ width: side, height: side });
    png.data.fill(255);
    for (const run of resolved.runs) {
        for (let dy = 0; dy < pixelsPerModule; dy += 1) {
            for (let dx = 0; dx < run.width * pixelsPerModule; dx += 1) {
                const offset = (((resolved.quietZoneModules + run.y) * pixelsPerModule + dy) * side + (resolved.quietZoneModules + run.x) * pixelsPerModule + dx) * 4;
                png.data[offset] = png.data[offset + 1] = png.data[offset + 2] = 0;
            }
        }
    }
    return PNG.sync.write(png);
}
export class QrPlanDecodeError extends Error {
    constructor(detail) {
        super(`QR_PLAN_DECODE_MISMATCH: the planned rectangles do not decode to the requested content (${detail}); nothing was drawn.`);
        this.name = 'QrPlanDecodeError';
    }
}
export function classifyPlanDecode(outcome, expected) {
    if (outcome.status === 'unavailable')
        return { status: 'not_run', reason: 'zbarimg_not_found', detail: 'zbarimg was not found on PATH or in the usual install directories; the plan is not decode-checked.' };
    if (outcome.status === 'error')
        return { status: 'not_run', reason: 'zbarimg_failed', detail: outcome.message.slice(0, 400) };
    if (outcome.status === 'no_symbol')
        throw new QrPlanDecodeError('no symbol was read');
    if (!outcome.payload.equals(expected))
        throw new QrPlanDecodeError(`decoded ${outcome.payload.length} bytes that differ from the ${expected.length} requested bytes`);
    return { status: 'match', decoder: 'zbarimg' };
}
export async function decodePlannedQr(resolved, content, zbarimgPath) {
    const outcome = await decodeWithZbar(renderQrPlanPng(resolved), zbarimgPath === undefined ? {} : { zbarimgPath });
    return classifyPlanDecode(outcome, qrContentBytes(content));
}
