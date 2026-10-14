import { open, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { IMAGE_SNAPSHOT_MAX_BYTES, IMAGE_SNAPSHOT_TIMEOUT_MS } from '../image-file-inspector.js';
import { readImageSourceMetadata } from './image-metadata.js';
import { validateWindowsOutputPath } from './output-path.js';
const CHUNK_BYTES = 1024 * 1024;
function boundedMessage(value) {
    const raw = value instanceof Error ? value.message : String(value);
    return (raw.length > 0 ? raw : 'Unknown image-inspection error.').slice(0, 500);
}
function toStable(value) {
    return { dev: value.dev, ino: value.ino, size: value.size, mtimeNs: value.mtimeNs, ctimeNs: value.ctimeNs, isFile: value.isFile() };
}
function sameStat(left, right) {
    return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
        left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs && left.isFile === right.isFile;
}
class SnapshotTimeoutError extends Error {
    constructor() {
        super(`The linked file hash did not complete within ${IMAGE_SNAPSHOT_TIMEOUT_MS} ms.`);
        this.name = 'SnapshotTimeoutError';
    }
}
async function readFully(handle, position, buffer) {
    let total = 0;
    while (total < buffer.length) {
        const { bytesRead } = await handle.read(buffer, total, buffer.length - total, position + total);
        if (bytesRead === 0)
            break;
        total += bytesRead;
    }
    return total;
}
async function sha256OfHandle(handle, size, now) {
    const digest = createHash('sha256');
    const deadline = now() + IMAGE_SNAPSHOT_TIMEOUT_MS;
    const buffer = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, Math.max(size, 1)));
    let position = 0;
    while (position < size) {
        if (now() > deadline)
            throw new SnapshotTimeoutError();
        const want = Math.min(buffer.length, size - position);
        const got = await readFully(handle, position, buffer.subarray(0, want));
        if (got !== want)
            throw new Error('The linked file ended before its opened size was read.');
        digest.update(buffer.subarray(0, got));
        position += got;
    }
    return digest.digest('hex');
}
export class WindowsImageFileInspector {
    now;
    constructor(now = Date.now) {
        this.now = now;
    }
    async inspect(path) {
        const shape = validateWindowsOutputPath(path);
        if (!shape.ok) {
            return {
                status: 'unavailable', path, reason: 'file_stat_failed',
                message: `The linked path is not a plain local drive-letter path (${shape.reason}); it was not opened.`,
            };
        }
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
            let before;
            try {
                before = toStable(await handle.stat({ bigint: true }));
            }
            catch (error) {
                return { status: 'unavailable', path, reason: 'file_stat_failed', message: boundedMessage(error) };
            }
            const named = await stat(path, { bigint: true }).then(toStable, () => null);
            if (named === null || !sameStat(before, named)) {
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
                    message: `The linked file exceeds the ${IMAGE_SNAPSHOT_MAX_BYTES}-byte inspection limit.`,
                };
            }
            const size = Number(before.size);
            let sha256;
            try {
                sha256 = await sha256OfHandle(handle, size, this.now);
            }
            catch (error) {
                const afterFailure = await handle.stat({ bigint: true }).then(toStable, () => null);
                const namedAfterFailure = await stat(path, { bigint: true }).then(toStable, () => null);
                if (namedAfterFailure === null || !sameStat(before, namedAfterFailure) ||
                    (afterFailure !== null && !sameStat(before, afterFailure))) {
                    return {
                        status: 'unavailable', path, reason: 'file_changed_during_inspection',
                        message: 'The linked path or opened file identity changed while it was being read for inspection.',
                    };
                }
                if (error instanceof SnapshotTimeoutError) {
                    return { status: 'unavailable', path, reason: 'file_snapshot_timeout', message: error.message };
                }
                return { status: 'unavailable', path, reason: 'file_hash_failed', message: boundedMessage(error) };
            }
            let metadata;
            try {
                metadata = await readImageSourceMetadata({
                    size,
                    read: async (position, length) => {
                        const buffer = Buffer.alloc(length);
                        return buffer.subarray(0, await readFully(handle, position, buffer));
                    },
                });
            }
            catch (error) {
                const message = `Image metadata reader failed: ${boundedMessage(error)}`;
                const failed = { status: 'unavailable', reason: 'metadata_reader_failed', message };
                metadata = { format: failed, pixels: failed, nativePpi: failed, colorSpace: failed, icc: failed };
            }
            const after = await handle.stat({ bigint: true }).then(toStable, () => null);
            const namedAfter = await stat(path, { bigint: true }).then(toStable, () => null);
            if (after === null || namedAfter === null || !sameStat(before, after) || !sameStat(before, namedAfter)) {
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
            return { status: 'available', file: { path, bytes: size, modifiedAt: modifiedAt.toISOString(), sha256 }, metadata };
        }
        finally {
            await handle.close();
        }
    }
}
