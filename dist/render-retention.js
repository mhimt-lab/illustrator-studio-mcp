import { lstat, readdir, rmdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { currentUid } from './platform-primitives.js';
import { isMissingPath } from './private-state.js';
export const RENDER_RETENTION_LIMITS = {
    maxAgeMs: 24 * 60 * 60 * 1000,
    maxSets: 20,
    maxBytes: 2 * 1024 * 1024 * 1024,
};
const EXPECTED_FILE = /^(?:ab-\d+\.png|diff-\d+\.png|work\.ai)$/u;
export async function pruneRenderSets(options) {
    const limits = options.limits ?? RENDER_RETENTION_LIMITS;
    const pattern = new RegExp(`^${options.prefix}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$`, 'u');
    const uid = currentUid();
    const result = { removed: 0, kept: 0, unexpected: [], failed: [] };
    const sets = [];
    for (const name of await readdir(options.renderRoot)) {
        const match = pattern.exec(name);
        if (match === null)
            continue;
        const path = join(options.renderRoot, name);
        const facts = await inspectSet(path, uid).catch((error) => { if (isMissingPath(error))
            return null; throw error; });
        if (facts === null)
            continue;
        sets.push({ name, path, id: match[1], ...facts });
        if (!facts.removable)
            result.unexpected.push(name);
    }
    const byAge = (a, b) => a.updatedMs - b.updatedMs || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    const candidates = sets.filter((set) => set.removable && !options.isReferenced(set.id)).sort(byAge);
    const doomed = new Set();
    for (const set of candidates) {
        if (options.now - set.updatedMs > limits.maxAgeMs)
            doomed.add(set);
    }
    const countExcess = sets.length - doomed.size - limits.maxSets;
    for (const set of candidates.filter((set) => !doomed.has(set)).slice(0, Math.max(0, countExcess)))
        doomed.add(set);
    let totalBytes = sets.reduce((sum, set) => sum + (doomed.has(set) ? 0 : set.bytes), 0);
    for (const set of candidates.filter((set) => !doomed.has(set))) {
        if (totalBytes <= limits.maxBytes)
            break;
        doomed.add(set);
        totalBytes -= set.bytes;
    }
    const remaining = new Set(sets);
    for (const set of [...doomed].sort(byAge)) {
        try {
            await removeSet(set, uid);
            remaining.delete(set);
            result.removed++;
        }
        catch (error) {
            result.failed.push({ name: set.name, reason: error instanceof Error ? error.message : String(error) });
        }
    }
    result.kept = remaining.size;
    return result;
}
async function inspectSet(path, uid) {
    const directory = await lstat(path);
    if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== uid)
        return null;
    let updatedMs = directory.mtimeMs;
    let bytes = 0;
    let removable = true;
    const entries = await readdir(path);
    for (const entry of entries) {
        const facts = await lstat(join(path, entry));
        if (!facts.isFile() || facts.isSymbolicLink() || facts.uid !== uid || !EXPECTED_FILE.test(entry))
            removable = false;
        updatedMs = Math.max(updatedMs, facts.mtimeMs);
        bytes += facts.size;
    }
    return { updatedMs, bytes, removable, entries };
}
async function removeSet(set, uid) {
    const facts = await inspectSet(set.path, uid);
    if (facts === null || !facts.removable)
        throw new Error('changed since it was checked, or holds unexpected contents; kept');
    for (const entry of facts.entries)
        await unlink(join(set.path, entry));
    await rmdir(set.path);
}
