import { createHash } from 'node:crypto';
export function canonicalSerialize(value) {
    if (value === null || typeof value === 'boolean' || typeof value === 'string')
        return JSON.stringify(value);
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            throw new Error('Canonical mutation requests require finite numbers.');
        return JSON.stringify(Object.is(value, -0) ? 0 : value);
    }
    if (Array.isArray(value))
        return `[${value.map(canonicalSerialize).join(',')}]`;
    const entries = Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalSerialize(item)}`).join(',')}}`;
}
export function canonicalSha256(value) {
    return createHash('sha256').update(canonicalSerialize(value), 'utf8').digest('hex');
}
