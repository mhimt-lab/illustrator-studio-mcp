import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { extname, isAbsolute, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { z } from 'zod';
export const VISUAL_DIFF_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const VISUAL_DIFF_MAX_PIXELS = 4_194_304;
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const sourceSchema = z.strictObject({
    path: z.string().min(1).max(16_384),
    format: z.literal('png'),
    bytes: z.number().int().positive().max(VISUAL_DIFF_MAX_FILE_BYTES),
    sha256: sha256Schema,
});
export const visualDiffResultSchema = z.strictObject({
    format: z.literal('png'),
    pixelFormat: z.literal('rgba8_straight_alpha'),
    dimensions: z.strictObject({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        pixels: z.number().int().positive().max(VISUAL_DIFF_MAX_PIXELS),
    }),
    sources: z.strictObject({ before: sourceSchema, after: sourceSchema }),
    comparison: z.strictObject({
        threshold: z.strictObject({
            value: z.number().int().min(0).max(255),
            unit: z.literal('rgba8_channel_value'),
            changedPixelRule: z.literal('max_absolute_rgba_channel_delta_gt_threshold'),
        }),
        totalPixels: z.number().int().positive(),
        changedPixels: z.number().int().nonnegative(),
        changedRatio: z.number().finite().min(0).max(1),
        withinThreshold: z.boolean(),
        totalAbsoluteChannelDelta: z.number().int().nonnegative(),
        meanAbsoluteChannelDelta: z.number().finite().min(0).max(255),
        maxChannelDelta: z.number().int().min(0).max(255),
        metricUnit: z.literal('rgba8_channel_value'),
    }),
    diff: z.strictObject({
        format: z.literal('png'),
        mimeType: z.literal('image/png'),
        bytes: z.number().int().positive().max(VISUAL_DIFF_MAX_FILE_BYTES),
        sha256: sha256Schema,
        visualization: z.literal('opaque_grayscale_max_absolute_rgba_channel_delta'),
    }),
    imageContentOrder: z.tuple([z.literal('before'), z.literal('after'), z.literal('diff')]),
    evidenceClass: z.literal('host_free_decoded_image_comparison'),
});
function codedError(code, message) {
    return Object.assign(new Error(message), { code });
}
function sameSnapshot(left, right) {
    return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
        left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs && left.isFile() === right.isFile();
}
function validatePath(path, role) {
    if (!isAbsolute(path) || resolve(path) !== path) {
        throw codedError('INVALID_IMAGE_PATH', `${role}_path must be a normalized absolute path.`);
    }
    if (extname(path).toLowerCase() !== '.png') {
        throw codedError('UNSUPPORTED_IMAGE_FORMAT', `${role}_path must use the .png extension.`);
    }
}
function secureReadFlags() {
    if (typeof constants.O_NOFOLLOW !== 'number' || typeof constants.O_NONBLOCK !== 'number') {
        throw codedError('UNSUPPORTED_FILESYSTEM', 'Secure image reads require O_NOFOLLOW and O_NONBLOCK.');
    }
    return constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
}
export async function readStableImage(path, role) {
    validatePath(path, role);
    let handle;
    try {
        handle = await open(path, secureReadFlags());
    }
    catch (error) {
        const code = error?.code;
        if (code === 'ENOENT')
            throw codedError('IMAGE_NOT_FOUND', `${role} image does not exist.`);
        if (code === 'ELOOP')
            throw codedError('IMAGE_SYMLINK_UNSUPPORTED', `${role} image must not be a symbolic link.`);
        throw codedError('IMAGE_OPEN_FAILED', `${role} image could not be opened: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
        const before = await handle.stat({ bigint: true });
        if (!before.isFile())
            throw codedError('IMAGE_NOT_REGULAR', `${role} image must be a regular file.`);
        if (before.size < 1n || before.size > BigInt(VISUAL_DIFF_MAX_FILE_BYTES)) {
            throw codedError('IMAGE_FILE_SIZE_UNSUPPORTED', `${role} image must be between 1 and ${VISUAL_DIFF_MAX_FILE_BYTES} bytes.`);
        }
        const bytes = await handle.readFile();
        const after = await handle.stat({ bigint: true });
        const pathAfter = await lstat(path, { bigint: true }).catch(() => null);
        if (bytes.length !== Number(before.size) || !sameSnapshot(before, after) || pathAfter === null ||
            !sameSnapshot(before, pathAfter)) {
            throw codedError('IMAGE_CHANGED_DURING_READ', `${role} image changed while it was being read.`);
        }
        return {
            path,
            bytes,
            stat: before,
            metadata: {
                path,
                format: 'png',
                bytes: bytes.length,
                sha256: createHash('sha256').update(bytes).digest('hex'),
            },
        };
    }
    finally {
        await handle.close();
    }
}
function hasPngChunk(bytes, target) {
    let offset = 8;
    while (offset + 12 <= bytes.length) {
        const length = bytes.readUInt32BE(offset);
        const nextOffset = offset + 12 + length;
        if (nextOffset > bytes.length)
            return false;
        if (bytes.subarray(offset + 4, offset + 8).toString('ascii') === target)
            return true;
        offset = nextOffset;
    }
    return false;
}
export function inspectSupportedPng(bytes, role) {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(signature) ||
        bytes.readUInt32BE(8) !== 13 || bytes.subarray(12, 16).toString('ascii') !== 'IHDR') {
        throw codedError('INVALID_PNG', `${role} image is not a structurally valid PNG.`);
    }
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    const bitDepth = bytes[24];
    const colorType = bytes[25];
    const compression = bytes[26];
    const filter = bytes[27];
    const interlace = bytes[28];
    const pixels = width * height;
    if (width < 1 || height < 1 || !Number.isSafeInteger(pixels) || pixels > VISUAL_DIFF_MAX_PIXELS) {
        throw codedError('IMAGE_DIMENSIONS_UNSUPPORTED', `${role} image exceeds the ${VISUAL_DIFF_MAX_PIXELS}-pixel limit or has invalid dimensions.`);
    }
    if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || compression !== 0 || filter !== 0 || interlace !== 0) {
        throw codedError('UNSUPPORTED_PNG_PROFILE', `${role} image must be an 8-bit RGB or RGBA, non-interlaced PNG without implicit color conversion.`);
    }
    if (colorType === 2 && hasPngChunk(bytes, 'tRNS')) {
        throw codedError('UNSUPPORTED_PNG_PROFILE', `${role} RGB image must not use tRNS transparency.`);
    }
    return { width, height, pixels };
}
export function decodePng(bytes, role) {
    try {
        const decoded = PNG.sync.read(bytes, { checkCRC: true, skipRescale: true });
        return Buffer.from(decoded.data);
    }
    catch (error) {
        throw codedError('INVALID_PNG', `${role} PNG could not be decoded: ${error instanceof Error ? error.message : String(error)}`);
    }
}
async function revalidateSource(source, role) {
    const current = await lstat(source.path, { bigint: true }).catch(() => null);
    if (current === null || !sameSnapshot(source.stat, current)) {
        throw codedError('IMAGE_CHANGED_DURING_COMPARISON', `${role} image changed before comparison completed.`);
    }
}
export async function comparePngImages(input) {
    if (!Number.isInteger(input.threshold) || input.threshold < 0 || input.threshold > 255) {
        throw codedError('INVALID_THRESHOLD', 'threshold must be an integer from 0 through 255.');
    }
    const before = await readStableImage(input.beforePath, 'before');
    const after = await readStableImage(input.afterPath, 'after');
    const beforeDimensions = inspectSupportedPng(before.bytes, 'before');
    const afterDimensions = inspectSupportedPng(after.bytes, 'after');
    if (beforeDimensions.width !== afterDimensions.width || beforeDimensions.height !== afterDimensions.height) {
        throw codedError('IMAGE_DIMENSIONS_MISMATCH', `Image dimensions must match exactly; before is ${beforeDimensions.width}x${beforeDimensions.height} and after is ${afterDimensions.width}x${afterDimensions.height}.`);
    }
    const beforeRgba = decodePng(before.bytes, 'before');
    const afterRgba = decodePng(after.bytes, 'after');
    const expectedChannels = beforeDimensions.pixels * 4;
    if (beforeRgba.length !== expectedChannels || afterRgba.length !== expectedChannels) {
        throw codedError('INVALID_PNG', 'Decoded RGBA channel count does not match the PNG dimensions.');
    }
    const diffRgba = Buffer.alloc(expectedChannels);
    let changedPixels = 0;
    let totalAbsoluteChannelDelta = 0;
    let maxChannelDelta = 0;
    for (let offset = 0; offset < expectedChannels; offset += 4) {
        let pixelMax = 0;
        for (let channel = 0; channel < 4; channel++) {
            const delta = Math.abs(beforeRgba[offset + channel] - afterRgba[offset + channel]);
            totalAbsoluteChannelDelta += delta;
            if (delta > pixelMax)
                pixelMax = delta;
        }
        if (pixelMax > input.threshold)
            changedPixels++;
        if (pixelMax > maxChannelDelta)
            maxChannelDelta = pixelMax;
        diffRgba[offset] = pixelMax;
        diffRgba[offset + 1] = pixelMax;
        diffRgba[offset + 2] = pixelMax;
        diffRgba[offset + 3] = 255;
    }
    const diffPng = new PNG({ width: beforeDimensions.width, height: beforeDimensions.height });
    diffPng.data = diffRgba;
    const diffBytes = PNG.sync.write(diffPng, {
        bitDepth: 8,
        colorType: 6,
        inputColorType: 6,
        inputHasAlpha: true,
        deflateLevel: 9,
        deflateStrategy: 3,
    });
    if (diffBytes.length > VISUAL_DIFF_MAX_FILE_BYTES) {
        throw codedError('DIFF_IMAGE_SIZE_UNSUPPORTED', `Generated diff exceeds the ${VISUAL_DIFF_MAX_FILE_BYTES}-byte limit.`);
    }
    await Promise.all([revalidateSource(before, 'before'), revalidateSource(after, 'after')]);
    const result = visualDiffResultSchema.parse({
        format: 'png',
        pixelFormat: 'rgba8_straight_alpha',
        dimensions: beforeDimensions,
        sources: { before: before.metadata, after: after.metadata },
        comparison: {
            threshold: {
                value: input.threshold,
                unit: 'rgba8_channel_value',
                changedPixelRule: 'max_absolute_rgba_channel_delta_gt_threshold',
            },
            totalPixels: beforeDimensions.pixels,
            changedPixels,
            changedRatio: changedPixels / beforeDimensions.pixels,
            withinThreshold: changedPixels === 0,
            totalAbsoluteChannelDelta,
            meanAbsoluteChannelDelta: totalAbsoluteChannelDelta / expectedChannels,
            maxChannelDelta,
            metricUnit: 'rgba8_channel_value',
        },
        diff: {
            format: 'png',
            mimeType: 'image/png',
            bytes: diffBytes.length,
            sha256: createHash('sha256').update(diffBytes).digest('hex'),
            visualization: 'opaque_grayscale_max_absolute_rgba_channel_delta',
        },
        imageContentOrder: ['before', 'after', 'diff'],
        evidenceClass: 'host_free_decoded_image_comparison',
    });
    return { result, images: { before: before.bytes, after: after.bytes, diff: diffBytes } };
}
