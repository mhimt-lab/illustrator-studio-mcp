import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
export const IMAGE_SNAPSHOT_MAX_BYTES = 1024 * 1024 * 1024;
export const IMAGE_SNAPSHOT_TIMEOUT_MS = 30_000;
function truncateUtf16(value, limit) {
    if (value.length <= limit)
        return value;
    let end = limit;
    const previous = value.charCodeAt(end - 1);
    const next = value.charCodeAt(end);
    if (previous >= 0xD800 && previous <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF)
        end--;
    return value.slice(0, end);
}
function boundedMessage(value) {
    const raw = value instanceof Error ? value.message : String(value);
    const message = raw.length > 0 ? raw : 'Unknown image-inspection error.';
    return truncateUtf16(message, 500);
}
function unavailable(reason, message) {
    return { status: 'unavailable', reason, message: boundedMessage(message) };
}
async function stableStat(path) {
    try {
        const value = await stat(path, { bigint: true });
        return {
            dev: value.dev,
            ino: value.ino,
            size: value.size,
            mtimeNs: value.mtimeNs,
            ctimeNs: value.ctimeNs,
            isFile: value.isFile(),
        };
    }
    catch (error) {
        if (error?.code === 'ENOENT')
            return { missing: true };
        return { error };
    }
}
async function stableHandleStat(handle) {
    try {
        const value = await handle.stat({ bigint: true });
        return {
            dev: value.dev,
            ino: value.ino,
            size: value.size,
            mtimeNs: value.mtimeNs,
            ctimeNs: value.ctimeNs,
            isFile: value.isFile(),
        };
    }
    catch (error) {
        return { error };
    }
}
function sameStat(left, right) {
    return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
        left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs && left.isFile === right.isFile;
}
function snapshotSuffix(path) {
    const extension = extname(path).toLowerCase();
    return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : '.image';
}
class SnapshotTimeoutError extends Error {
    constructor() {
        super(`The linked file snapshot did not complete within ${IMAGE_SNAPSHOT_TIMEOUT_MS} ms.`);
        this.name = 'SnapshotTimeoutError';
    }
}
async function snapshotAndSha256(handle, path, size) {
    const digest = createHash('sha256');
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), IMAGE_SNAPSHOT_TIMEOUT_MS);
    timeout.unref();
    let copiedBytes = 0;
    try {
        if (size > 0) {
            const source = createReadStream(`/dev/fd/${handle.fd}`, { start: 0, end: size - 1 });
            const target = createWriteStream(path, { flags: 'wx', mode: 0o600 });
            const hashStream = new Transform({
                transform(chunk, _encoding, callback) {
                    copiedBytes += chunk.length;
                    digest.update(chunk);
                    callback(null, chunk);
                },
            });
            try {
                await pipeline(source, hashStream, target, { signal: abortController.signal });
            }
            catch (error) {
                if (abortController.signal.aborted)
                    throw new SnapshotTimeoutError();
                throw error;
            }
            finally {
                source.destroy();
                hashStream.destroy();
                target.destroy();
            }
        }
        else {
            const empty = await open(path, 'wx', 0o600);
            await empty.close();
        }
        if (copiedBytes !== size)
            throw new Error('The linked file ended before its opened size was copied.');
        return digest.digest('hex');
    }
    finally {
        clearTimeout(timeout);
    }
}
function parseSipsOutput(output) {
    const properties = {};
    const lines = output.replaceAll('\r\n', '\n').split('\n');
    for (const line of lines.slice(1)) {
        const match = /^\s*([^:]+):\s*(.*)$/.exec(line);
        if (match)
            properties[match[1].trim()] = match[2].trim();
    }
    return properties;
}
function readPositiveInteger(properties, first, second) {
    const firstRaw = properties[first];
    const secondRaw = properties[second];
    if (firstRaw === undefined || secondRaw === undefined) {
        return unavailable('pixel_dimensions_missing', 'One or both source pixel dimensions are missing.');
    }
    const width = Number(firstRaw);
    const height = Number(secondRaw);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
        return unavailable('pixel_dimensions_invalid_zero', 'Source pixel dimensions are zero, negative, or invalid.');
    }
    return { status: 'available', value: { width, height } };
}
function readPositivePpi(properties) {
    const xRaw = properties.dpiWidth;
    const yRaw = properties.dpiHeight;
    if (xRaw === undefined || yRaw === undefined) {
        return unavailable('native_ppi_missing', 'One or both native PPI values are missing.');
    }
    const x = Number(xRaw);
    const y = Number(yRaw);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) {
        return unavailable('native_ppi_invalid_zero', 'Native PPI is zero, negative, or invalid.');
    }
    return { status: 'available', value: { x, y } };
}
function sourceFormat(properties) {
    const value = properties.format?.toLowerCase();
    if (value === undefined || value.length === 0) {
        return unavailable('source_format_missing', 'The source image format is missing.');
    }
    if (value === 'tiff' || value === 'jpeg' || value === 'png' || value === 'psd') {
        return { status: 'available', value };
    }
    return unavailable('source_format_unsupported', `The source format ${JSON.stringify(value)} is not measured.`);
}
function sourceColorSpace(properties) {
    const value = properties.space;
    if (value === undefined || value.length === 0) {
        return unavailable('color_space_missing', 'The source color space is missing.');
    }
    const normalized = {
        RGB: 'RGB', CMYK: 'CMYK', Gray: 'Gray', Lab: 'Lab', Indexed: 'Indexed',
    };
    const mapped = normalized[value];
    if (mapped !== undefined)
        return { status: 'available', value: mapped };
    return unavailable('color_space_unsupported', `The source color space ${JSON.stringify(value)} is not recognized.`);
}
function sourceIcc(properties) {
    const value = properties.profile;
    if (value === undefined || value.length === 0) {
        return unavailable('icc_metadata_missing', 'ICC profile metadata is missing.');
    }
    if (value === '<nil>')
        return { status: 'available', value: { present: false, name: null } };
    return { status: 'available', value: { present: true, name: truncateUtf16(value, 500) } };
}
function unsupportedMetadata(format) {
    const message = format.status === 'unavailable' ? format.message : 'The source format is not measured.';
    return {
        format,
        pixels: unavailable('source_format_unsupported', message),
        nativePpi: unavailable('source_format_unsupported', message),
        colorSpace: unavailable('source_format_unsupported', message),
        icc: unavailable('source_format_unsupported', message),
    };
}
function failedMetadata(message) {
    return {
        format: unavailable('metadata_reader_failed', message),
        pixels: unavailable('metadata_reader_failed', message),
        nativePpi: unavailable('metadata_reader_failed', message),
        colorSpace: unavailable('metadata_reader_failed', message),
        icc: unavailable('metadata_reader_failed', message),
    };
}
function parseMetadata(properties) {
    const format = sourceFormat(properties);
    if (format.status === 'unavailable')
        return unsupportedMetadata(format);
    return {
        format,
        pixels: readPositiveInteger(properties, 'pixelWidth', 'pixelHeight'),
        nativePpi: format.value === 'psd'
            ? unavailable('native_ppi_untrusted_format', 'macOS sips native PPI is not trusted for PSD after a measured 300 ppi file was reported as 72 ppi.')
            : readPositivePpi(properties),
        colorSpace: sourceColorSpace(properties),
        icc: sourceIcc(properties),
    };
}
const defaultSipsRunner = async (args) => {
    const { stdout, stderr } = await execFileAsync('/usr/bin/sips', [...args], {
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
    });
    return { stdout, stderr };
};
export class SipsImageFileInspector {
    runSips;
    constructor(runSips = defaultSipsRunner) {
        this.runSips = runSips;
    }
    async inspect(path) {
        let handle;
        try {
            handle = await open(path, 'r');
        }
        catch (error) {
            if (error?.code === 'ENOENT')
                return { status: 'missing', path };
            return { status: 'unavailable', path, reason: 'file_stat_failed', message: boundedMessage(error) };
        }
        try {
            const before = await stableHandleStat(handle);
            if ('error' in before) {
                return { status: 'unavailable', path, reason: 'file_stat_failed', message: boundedMessage(before.error) };
            }
            const pathAtOpen = await stableStat(path);
            if ('missing' in pathAtOpen || 'error' in pathAtOpen || !sameStat(before, pathAtOpen)) {
                return {
                    status: 'unavailable', path, reason: 'file_changed_during_inspection',
                    message: 'The linked path no longer identifies the file object opened for inspection.',
                };
            }
            if (!before.isFile) {
                return { status: 'unavailable', path, reason: 'file_not_regular', message: 'The linked path is not a regular file.' };
            }
            if (before.size > BigInt(Number.MAX_SAFE_INTEGER)) {
                return {
                    status: 'unavailable', path, reason: 'file_too_large_to_report',
                    message: 'The linked file size exceeds the exact JSON integer range.',
                };
            }
            if (before.size > BigInt(IMAGE_SNAPSHOT_MAX_BYTES)) {
                return {
                    status: 'unavailable', path, reason: 'file_snapshot_limit_exceeded',
                    message: `The linked file exceeds the ${IMAGE_SNAPSHOT_MAX_BYTES}-byte inspection snapshot limit.`,
                };
            }
            let digest;
            let metadata;
            const snapshotRoot = await mkdtemp(join(tmpdir(), 'illustrator-image-inspection-'));
            try {
                const snapshotPath = join(snapshotRoot, `source${snapshotSuffix(path)}`);
                try {
                    digest = await snapshotAndSha256(handle, snapshotPath, Number(before.size));
                }
                catch (error) {
                    const afterFailure = await stableHandleStat(handle);
                    if (!('error' in afterFailure) && !sameStat(before, afterFailure)) {
                        return {
                            status: 'unavailable', path, reason: 'file_changed_during_inspection',
                            message: 'The opened linked file changed while it was being copied for inspection.',
                        };
                    }
                    if (error instanceof SnapshotTimeoutError) {
                        return { status: 'unavailable', path, reason: 'file_snapshot_timeout', message: error.message };
                    }
                    return { status: 'unavailable', path, reason: 'file_hash_failed', message: boundedMessage(error) };
                }
                try {
                    const result = await this.runSips([
                        '-g', 'format', '-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'dpiWidth', '-g', 'dpiHeight',
                        '-g', 'space', '-g', 'profile', snapshotPath,
                    ]);
                    if (result.stderr.trim().length > 0)
                        throw new Error(result.stderr.trim());
                    metadata = parseMetadata(parseSipsOutput(result.stdout));
                }
                catch (error) {
                    metadata = failedMetadata(`Image metadata reader failed: ${boundedMessage(error)}`);
                }
            }
            finally {
                await rm(snapshotRoot, { recursive: true, force: true });
            }
            const after = await stableHandleStat(handle);
            const pathAfter = await stableStat(path);
            if ('error' in after || 'missing' in pathAfter || 'error' in pathAfter ||
                !sameStat(before, after) || !sameStat(before, pathAfter)) {
                return {
                    status: 'unavailable', path, reason: 'file_changed_during_inspection',
                    message: 'The linked file identity changed while metadata and SHA-256 were being inspected.',
                };
            }
            const modifiedAt = new Date(Number(before.mtimeNs / 1000000n));
            if (Number.isNaN(modifiedAt.getTime())) {
                return {
                    status: 'unavailable', path, reason: 'file_stat_failed',
                    message: 'The linked file modification time cannot be represented as an ISO timestamp.',
                };
            }
            return {
                status: 'available',
                file: {
                    path,
                    bytes: Number(before.size),
                    modifiedAt: modifiedAt.toISOString(),
                    sha256: digest,
                },
                metadata,
            };
        }
        finally {
            await handle.close();
        }
    }
}
