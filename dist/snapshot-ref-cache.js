import { canonicalSha256 } from './mutation-canonical.js';
export const SNAPSHOT_SHA256_PATTERN = /^[0-9a-f]{64}$/u;
export const SNAPSHOT_REF_CACHE_LIMITS = Object.freeze({ maxEntries: 4_096, maxBytes: 32 * 1024 * 1024 });
export class SnapshotRefCache {
    limits;
    entries = new Map();
    bytes = 0;
    constructor(limits = SNAPSHOT_REF_CACHE_LIMITS) {
        this.limits = limits;
    }
    put(value) {
        const sha256 = canonicalSha256(value);
        const existing = this.entries.get(sha256);
        if (existing !== undefined) {
            this.entries.delete(sha256);
            this.entries.set(sha256, existing);
            return { sha256, held: true };
        }
        const text = JSON.stringify(value);
        const bytes = Buffer.byteLength(text, 'utf8');
        if (bytes > this.limits.maxBytes)
            return { sha256, held: false };
        this.entries.set(sha256, { text, bytes });
        this.bytes += bytes;
        while (this.entries.size > this.limits.maxEntries || this.bytes > this.limits.maxBytes) {
            const oldest = this.entries.keys().next().value;
            this.bytes -= this.entries.get(oldest).bytes;
            this.entries.delete(oldest);
        }
        return { sha256, held: true };
    }
    get(sha256) {
        const entry = this.entries.get(sha256);
        if (entry === undefined)
            return undefined;
        this.entries.delete(sha256);
        this.entries.set(sha256, entry);
        return JSON.parse(entry.text);
    }
    has(sha256) { return this.entries.has(sha256); }
    get size() { return this.entries.size; }
    get heldBytes() { return this.bytes; }
}
export class SnapshotRefUnavailableError extends Error {
    field;
    sha256;
    constructor(field, sha256) {
        super(`snapshot_ref_unavailable: ${field} ${sha256} is not held by this server (it was planned before a restart, or `
            + 'evicted). Nothing was written and Illustrator was not called. If this command_id was sent before, check it with '
            + 'illustrator_reconcile (action inspect) and do not apply it again when it is terminal; otherwise plan again '
            + '(apply:false) and send that plan\'s next_call, or send the full expected_before and confirmed_after.');
        this.field = field;
        this.sha256 = sha256;
    }
}
