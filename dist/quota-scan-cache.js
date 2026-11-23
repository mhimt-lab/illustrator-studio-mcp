export const QUOTA_SCAN_CACHE_TTL_MS = 5 * 60 * 1000;
export const QUOTA_SCAN_CACHE_RACY_MS = 2_000;
export const QUOTA_SCAN_FULL_SCAN_PERCENT = 80n;
export class QuotaScanCache {
    now;
    entries = new Map();
    lastTotalBytes = 0n;
    constructor(now = Date.now) {
        this.now = now;
    }
    entry(directory, bytes) {
        const verifiedAtMs = this.now();
        const settledNs = BigInt(Math.trunc(verifiedAtMs) - QUOTA_SCAN_CACHE_RACY_MS) * 1000000n;
        if (directory.mtimeNs > settledNs || directory.ctimeNs > settledNs)
            return null;
        return {
            dev: directory.dev, ino: directory.ino, uid: directory.uid, mode: directory.mode, nlink: directory.nlink,
            mtimeNs: directory.mtimeNs, ctimeNs: directory.ctimeNs, bytes, verifiedAtMs,
        };
    }
    lookup(name, directory) {
        const known = this.entries.get(name);
        if (known === undefined || this.now() - known.verifiedAtMs >= QUOTA_SCAN_CACHE_TTL_MS)
            return null;
        return known.dev === directory.dev && known.ino === directory.ino && known.uid === directory.uid &&
            known.mode === directory.mode && known.nlink === directory.nlink &&
            known.mtimeNs === directory.mtimeNs && known.ctimeNs === directory.ctimeNs ? known : null;
    }
    bypass(commandCount, maxCommandCount, maxTotalBytes) {
        return BigInt(commandCount) * 100n >= BigInt(maxCommandCount) * QUOTA_SCAN_FULL_SCAN_PERCENT ||
            this.lastTotalBytes * 100n >= BigInt(maxTotalBytes) * QUOTA_SCAN_FULL_SCAN_PERCENT;
    }
    commit(entries, totalBytes) {
        this.entries = entries;
        this.lastTotalBytes = totalBytes;
    }
    clear() {
        this.entries = new Map();
        this.lastTotalBytes = 0n;
    }
    get size() {
        return this.entries.size;
    }
}
