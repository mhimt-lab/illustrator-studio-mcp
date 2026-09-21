import { lstat, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { isCanonicalCommandId } from './command-id.js';
import { atomicCreatePrivateRecord, atomicReplacePrivateRecord, readSecurePrivateRecord, } from './private-record.js';
import { describeStateEntry, isMissingPath, withPrivateDirectoryScope, } from './private-state.js';
export const QUARANTINE_RECORD_VERSION = 1;
export const QUARANTINE_MANIFEST_LIMIT = 65_536;
export const QUARANTINE_ENTRY_LIMIT = 128;
const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SAFE_NAME = /^[A-Za-z0-9._-]{1,128}$/u;
function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
export function temporaryTwinPattern(name) {
    return new RegExp(`^${escapeRegExp(name)}\\.${UUID_PATTERN}\\.tmp$`, 'u');
}
function twinBase(name) {
    const match = new RegExp(`^(.+)\\.${UUID_PATTERN}\\.tmp$`, 'u').exec(name);
    return match === null ? null : match[1];
}
export function attributeEntry(metadata, kind, selfUid, hasTemporaryTwin) {
    if (metadata.isSymbolicLink())
        return { attributable: false, reason: 'symbolic link' };
    if (kind === 'file' ? !metadata.isFile() : !metadata.isDirectory()) {
        return { attributable: false, reason: kind === 'file' ? 'not a regular file' : 'not a directory' };
    }
    if (metadata.uid !== selfUid)
        return { attributable: false, reason: 'owned by another user' };
    const mode = metadata.mode & 0o7777;
    if ((mode & 0o7000) !== 0)
        return { attributable: false, reason: 'special permission bits' };
    const owner = kind === 'file' ? 0o600 : 0o700;
    if ((mode & owner) !== owner)
        return { attributable: false, reason: 'owner permission bits missing' };
    if ((mode & 0o022) !== 0)
        return { attributable: false, reason: 'group or other write permission' };
    let linked = false;
    if (kind === 'file' && metadata.nlink !== 1) {
        if (metadata.nlink !== 2 || !hasTemporaryTwin)
            return { attributable: false, reason: 'unexpected link count' };
        linked = true;
    }
    return { attributable: true, violation: linked || mode !== (kind === 'file' ? 0o600 : 0o700) };
}
function observation(metadata) {
    return {
        isFile: () => metadata.isFile(),
        isDirectory: () => metadata.isDirectory(),
        isSymbolicLink: () => metadata.isSymbolicLink(),
        uid: Number(metadata.uid),
        mode: Number(metadata.mode),
        nlink: Number(metadata.nlink),
    };
}
const digitsSchema = z.string().regex(/^\d+$/u);
const entrySchema = z.strictObject({
    name: z.string().regex(SAFE_NAME),
    ino: digitsSchema,
    mode: z.number().int().nonnegative(),
    uid: z.number().int().nonnegative(),
    size: z.number().int().nonnegative(),
    nlink: z.number().int().nonnegative(),
});
export const quarantineManifestSchema = z.strictObject({
    quarantineRecordVersion: z.literal(QUARANTINE_RECORD_VERSION),
    kind: z.enum(['command', 'edit_session']),
    id: z.string().min(1).max(64),
    operation: z.strictObject({ id: z.string(), pid: z.number().int().positive() }).optional(),
    quarantinedAt: z.string().min(1),
    source: z.strictObject({ dev: digitsSchema, ino: digitsSchema }),
    entries: z.array(entrySchema).max(QUARANTINE_ENTRY_LIMIT + 1),
    violations: z.array(z.string().max(2_000)).max(QUARANTINE_ENTRY_LIMIT + 1),
}).superRefine((manifest, context) => {
    if (manifest.kind === 'command' && (manifest.operation === undefined || !isCanonicalCommandId(manifest.operation.id) ||
        !isCanonicalCommandId(manifest.id))) {
        context.addIssue({ code: 'custom', message: 'A command quarantine names canonical command and operation ids.' });
    }
    if (manifest.kind === 'edit_session' && manifest.operation !== undefined) {
        context.addIssue({ code: 'custom', message: 'An edit session quarantine runs under its caller\'s lock.' });
    }
});
export function quarantineArea(root, kind) {
    const base = join(root, 'quarantine');
    return { base, area: join(base, kind) };
}
export function quarantineManifestPath(root, kind, id) {
    return join(quarantineArea(root, kind).area, `${id}.json`);
}
export function areaRequirements(root, kind) {
    const { base, area } = quarantineArea(root, kind);
    return [
        { path: root, description: 'state root' },
        { path: base, description: 'quarantine directory' },
        { path: area, description: `quarantine ${kind} directory` },
    ];
}
async function lstatOrNull(path) {
    try {
        return await lstat(path, { bigint: true });
    }
    catch (error) {
        if (isMissingPath(error))
            return null;
        throw error;
    }
}
async function areaExists(root, kind) {
    const { base, area } = quarantineArea(root, kind);
    if (await lstatOrNull(base) === null)
        return false;
    return await withPrivateDirectoryScope(areaRequirements(root, kind).slice(0, 2), async () => await lstatOrNull(area) !== null);
}
export async function quarantineManifestExists(root, kind, id) {
    if (!await areaExists(root, kind))
        return false;
    return await withPrivateDirectoryScope(areaRequirements(root, kind), async () => await lstatOrNull(quarantineManifestPath(root, kind, id)) !== null);
}
async function hasTwin(directory, name, ino, names) {
    const pattern = temporaryTwinPattern(name);
    const base = twinBase(name);
    for (const candidate of names ?? await readdir(directory)) {
        if (candidate === name || !(pattern.test(candidate) || candidate === base))
            continue;
        const metadata = await lstatOrNull(join(directory, candidate));
        if (metadata !== null && metadata.isFile() && metadata.ino === ino)
            return true;
    }
    return false;
}
export async function readQuarantineManifest(root, kind, id) {
    if (!await areaExists(root, kind))
        return { state: 'missing' };
    const { area } = quarantineArea(root, kind);
    const path = quarantineManifestPath(root, kind, id);
    return await withPrivateDirectoryScope(areaRequirements(root, kind), async (scope) => {
        const metadata = await lstatOrNull(path);
        if (metadata === null)
            return { state: 'missing' };
        const twin = metadata.nlink === 2n && await hasTwin(area, `${id}.json`, metadata.ino);
        const record = await readSecurePrivateRecord(path, QUARANTINE_MANIFEST_LIMIT, { scope, maxLinkCount: twin ? 2 : 1 });
        if (record.state === 'missing')
            return { state: 'missing' };
        if (record.state === 'invalid')
            return { state: 'invalid', reason: record.reason };
        let value;
        try {
            value = JSON.parse(record.text);
        }
        catch {
            return { state: 'invalid', reason: 'malformed_json' };
        }
        const parsed = quarantineManifestSchema.safeParse(value);
        if (!parsed.success)
            return { state: 'invalid', reason: 'malformed_manifest' };
        if (parsed.data.id !== id || parsed.data.kind !== (kind === 'commands' ? 'command' : 'edit_session')) {
            return { state: 'invalid', reason: 'manifest_id_mismatch' };
        }
        return { state: 'valid', manifest: parsed.data };
    });
}
export async function ensureQuarantineArea(root, kind, hooks = {}) {
    const requirements = areaRequirements(root, kind);
    for (let depth = 1; depth < requirements.length; depth += 1) {
        await withPrivateDirectoryScope(requirements.slice(0, depth), async (scope) => {
            try {
                await mkdir(requirements[depth].path, { mode: 0o700 });
            }
            catch (error) {
                if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'))
                    throw error;
            }
            if (depth === 1)
                await hooks.boundary?.('area_created');
            await scope.syncLeafParent();
        });
    }
    await withPrivateDirectoryScope(requirements, async (scope) => scope.assertStable());
}
export async function publishQuarantineManifest(root, kind, manifest, mode, hooks = {}) {
    const contents = JSON.stringify(quarantineManifestSchema.parse(manifest));
    if (Buffer.byteLength(contents) > QUARANTINE_MANIFEST_LIMIT)
        throw new Error('The quarantine manifest exceeds its size limit.');
    const path = quarantineManifestPath(root, kind, manifest.id);
    await withPrivateDirectoryScope(areaRequirements(root, kind), async (scope) => {
        const options = { scope, ...(hooks.durabilityBoundary === undefined ? {} : { durabilityBoundary: hooks.durabilityBoundary }) };
        if (mode === 'create')
            await atomicCreatePrivateRecord(path, contents, options);
        else
            await atomicReplacePrivateRecord(path, contents, options);
    });
    await hooks.boundary?.('manifest_published');
}
function entryOf(name, metadata) {
    return {
        name,
        ino: metadata.ino.toString(),
        mode: Number(metadata.mode & 4095n),
        uid: Number(metadata.uid),
        size: Number(metadata.size),
        nlink: Number(metadata.nlink),
    };
}
export async function classifyCommandDirectory(directory, selfUid) {
    const metadata = await lstatOrNull(directory);
    if (metadata === null)
        return null;
    const reasons = [];
    const violations = [];
    const directoryAttribution = attributeEntry(observation(metadata), 'directory', selfUid, false);
    if (!directoryAttribution.attributable) {
        return { state: 'unattributable', reasons: [`${describeStateEntry(directory, observation(metadata), 0o700)}: ${directoryAttribution.reason}`] };
    }
    if (directoryAttribution.violation)
        violations.push(`command directory: ${describeStateEntry(directory, observation(metadata), 0o700)}`);
    const names = (await readdir(directory)).sort();
    if (names.length > QUARANTINE_ENTRY_LIMIT) {
        return { state: 'unattributable', reasons: [`${directory}: ${names.length} artifacts exceed the limit of ${QUARANTINE_ENTRY_LIMIT}`] };
    }
    const entries = [];
    for (const name of names) {
        if (!SAFE_NAME.test(name) || name.includes('..')) {
            reasons.push(`${directory} entry ${JSON.stringify(name)}: unsafe artifact name`);
            continue;
        }
        const path = join(directory, name);
        const artifact = await lstatOrNull(path);
        if (artifact === null) {
            reasons.push(`${path}: disappeared during inspection`);
            continue;
        }
        const twin = artifact.nlink === 2n && await hasTwin(directory, name, artifact.ino, names);
        const attribution = attributeEntry(observation(artifact), 'file', selfUid, twin);
        if (!attribution.attributable) {
            reasons.push(`${describeStateEntry(path, observation(artifact), 0o600)}: ${attribution.reason}`);
            continue;
        }
        if (attribution.violation) {
            violations.push(`artifact: ${describeStateEntry(path, observation(artifact), 0o600)}${twin ? ' (interrupted publication, link count 2)' : ''}`);
        }
        entries.push(entryOf(name, artifact));
    }
    const snapshot = { source: { dev: metadata.dev.toString(), ino: metadata.ino.toString() }, entries, violations };
    if (reasons.length > 0)
        return { state: 'unattributable', reasons, snapshot };
    return { state: violations.length === 0 ? 'clean' : 'attributable', snapshot };
}
export async function inspectCommandDirectory(directory, selfUid) {
    const attribution = await classifyCommandDirectory(directory, selfUid);
    if (attribution === null)
        return null;
    if (attribution.state === 'unattributable') {
        return { quarantinable: false, reasons: attribution.reasons, ...(attribution.snapshot === undefined ? {} : { snapshot: attribution.snapshot }) };
    }
    if (attribution.state === 'clean') {
        return { quarantinable: false, reasons: [`${directory}: no violation to quarantine`], snapshot: attribution.snapshot };
    }
    return { quarantinable: true, snapshot: attribution.snapshot };
}
export function snapshotMatches(manifest, snapshot, rootDev) {
    if (snapshot.source.ino !== manifest.source.ino || snapshot.source.dev !== rootDev.toString())
        return false;
    if (snapshot.entries.length !== manifest.entries.length)
        return false;
    const expected = new Map(manifest.entries.map((entry) => [entry.name, entry]));
    return snapshot.entries.every((entry) => {
        const recorded = expected.get(entry.name);
        return recorded !== undefined && recorded.ino === entry.ino && recorded.mode === entry.mode &&
            recorded.uid === entry.uid && recorded.size === entry.size;
    });
}
export async function stateRootDevice(root) {
    return (await lstat(root, { bigint: true })).dev;
}
export async function scanCommandQuarantineArea(root, selfUid, commandsRoot) {
    const result = { bytes: 0n, quarantined: 0, violations: [] };
    const { base, area } = quarantineArea(root, 'commands');
    const baseMetadata = await lstatOrNull(base);
    if (baseMetadata === null)
        return result;
    await withPrivateDirectoryScope(areaRequirements(root, 'commands').slice(0, 2), async () => undefined);
    const areaMetadata = await lstatOrNull(area);
    if (areaMetadata === null)
        return result;
    await withPrivateDirectoryScope(areaRequirements(root, 'commands'), async (scope) => {
        const names = (await readdir(area)).sort();
        const nameSet = new Set(names);
        for (const name of names) {
            const path = join(area, name);
            const metadata = await lstatOrNull(path);
            if (metadata === null) {
                result.violations.push(`quarantine entry disappeared during the scan: ${path}`);
                continue;
            }
            const manifestMatch = /^(.+)\.json$/u.exec(name);
            const temporaryId = twinBase(name)?.replace(/\.json$/u, '') ?? null;
            if (isCanonicalCommandId(name)) {
                const candidate = await inspectCommandDirectory(path, selfUid);
                if (candidate === null)
                    continue;
                if (!nameSet.has(`${name}.json`))
                    result.violations.push(`quarantined command directory without its manifest: ${path}`);
                if (candidate.snapshot === undefined || (!candidate.quarantinable && candidate.reasons.some((reason) => !reason.endsWith('no violation to quarantine')))) {
                    const reasons = candidate.quarantinable ? [] : candidate.reasons;
                    result.violations.push(`quarantined evidence is no longer attributable: ${reasons.join('; ')}`);
                }
                result.quarantined += 1;
                for (const entry of candidate.snapshot?.entries ?? [])
                    result.bytes += BigInt(entry.size);
                continue;
            }
            if ((manifestMatch !== null && isCanonicalCommandId(manifestMatch[1])) ||
                (temporaryId !== null && isCanonicalCommandId(temporaryId) && twinBase(name)?.endsWith('.json') === true)) {
                const twin = metadata.nlink === 2n && await hasTwin(area, name, metadata.ino, names);
                const attribution = attributeEntry(observation(metadata), 'file', selfUid, twin);
                if (!attribution.attributable || (metadata.mode & 4095n) !== 384n) {
                    result.violations.push(`unsafe quarantine record: ${describeStateEntry(path, observation(metadata), 0o600)}`);
                    continue;
                }
                result.bytes += metadata.size;
                if (manifestMatch !== null && temporaryId === null) {
                    const id = manifestMatch[1];
                    if (!nameSet.has(id)) {
                        const live = await lstatOrNull(join(commandsRoot, id));
                        const liveHasEvidence = live !== null && live.isDirectory() && (await readdir(join(commandsRoot, id))).length > 0;
                        if (!liveHasEvidence)
                            result.violations.push(`quarantined evidence is missing: ${join(area, id)}`);
                    }
                }
                continue;
            }
            result.violations.push(`unexpected quarantine entry: ${describeStateEntry(path, observation(metadata), 0o600)}`);
        }
        await scope.assertStable();
    });
    return result;
}
