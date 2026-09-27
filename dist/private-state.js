import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, realpath, rename, rmdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { noFollowDirectoryFlags, noFollowNonBlockingReadFlags, noFollowReadFlags, currentUid, currentUidForDiagnostics, } from './platform-primitives.js';
import { validateWindowsOutputPath, windowsPathComponentRejection } from './windows/output-path.js';
import { judgeWindowsStateRootObservation, observeWindowsStateRoot } from './windows/state-root.js';
function hasCode(error, code) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
export function isMissingPath(error) {
    return hasCode(error, 'ENOENT');
}
export function unsafePrivateState(message) {
    return new Error(`Private signing state is unsafe: ${message} ` +
        'Stop all MCP server processes using this state root before explicit rotation or recovery; no automatic repair was performed.');
}
export function isWindowsPrivateState() {
    return process.platform === 'win32';
}
export function privateOwnerModeViolation(metadata, expectedMode) {
    if (isWindowsPrivateState())
        return null;
    if (BigInt(metadata.uid) !== BigInt(currentUid()))
        return 'wrong_owner';
    if ((BigInt(metadata.mode) & 4095n) !== BigInt(expectedMode))
        return 'unsafe_mode';
    return null;
}
export function validatePrivateOwnerAndMode(metadata, expectedMode, description) {
    if (isWindowsPrivateState())
        return;
    if (metadata.uid !== currentUid())
        throw unsafePrivateState(`${description} is not owned by the current user.`);
    if ((metadata.mode & 0o7777) !== expectedMode) {
        throw unsafePrivateState(`${description} must already have mode ${expectedMode.toString(8).padStart(4, '0')}.`);
    }
}
const attestedStateRoots = new Map();
const attestationsInFlight = new Map();
const attestationFailures = new Map();
function sameIdentity(left, right) {
    return left.dev === right.dev && left.ino === right.ino;
}
async function assertAttestedRootUnchanged(root, attested) {
    const metadata = await lstat(root, { bigint: true });
    if (metadata.isSymbolicLink() || !metadata.isDirectory() || !sameIdentity(metadata, attested)) {
        throw unsafePrivateState('the attested state root was replaced while this process was using it.');
    }
}
function attestedRootContaining(path) {
    return [...attestedStateRoots.keys()].find((candidate) => path === candidate || path.startsWith(`${candidate}\\`));
}
async function assertWindowsPathComponents(path) {
    const root = attestedRootContaining(path);
    if (root === undefined) {
        await lstat(path);
        throw unsafePrivateState('the path is not inside a state root attested by this process.');
    }
    await assertAttestedRootUnchanged(root, attestedStateRoots.get(root));
    if (path === root)
        return;
    const components = path.slice(root.length + 1).split('\\');
    if (components.some((component) => windowsPathComponentRejection(component) !== null)) {
        throw unsafePrivateState('a state path component is not a plain file name.');
    }
    let current = root;
    for (const component of components.slice(0, -1)) {
        current = join(current, component);
        const metadata = await lstat(current, { bigint: true });
        if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
            throw unsafePrivateState('a state directory is a link or not a directory.');
        }
    }
}
async function openWindowsVerified(path, flags, directory) {
    await assertWindowsPathComponents(path);
    const before = await lstat(path, { bigint: true });
    if (before.isSymbolicLink())
        throw unsafePrivateState('a state entry is a link.');
    if (directory && !before.isDirectory())
        throw unsafePrivateState('a state directory is not a directory.');
    const handle = await open(path, flags);
    try {
        const opened = await handle.stat({ bigint: true });
        if (!sameIdentity(opened, before))
            throw unsafePrivateState('a state entry changed while it was opened.');
        return handle;
    }
    catch (error) {
        await handle.close().catch(() => undefined);
        throw error;
    }
}
export async function openPrivateDirectory(path) {
    if (isWindowsPrivateState())
        return await openWindowsVerified(path, 'r+', true);
    return await open(path, noFollowDirectoryFlags());
}
export async function openPrivateFileForRead(path, options = {}) {
    if (isWindowsPrivateState())
        return await openWindowsVerified(path, 'r', false);
    return await open(path, options.nonBlocking === true ? noFollowNonBlockingReadFlags() : noFollowReadFlags());
}
export async function createPrivateFileExclusive(path, mode = 0o600) {
    if (!isWindowsPrivateState())
        return await open(path, 'wx', mode);
    await assertWindowsPathComponents(path);
    const handle = await open(path, 'wx', mode);
    try {
        const [opened, named] = await Promise.all([handle.stat({ bigint: true }), lstat(path, { bigint: true })]);
        if (named.isSymbolicLink() || !sameIdentity(opened, named))
            throw unsafePrivateState('a created state entry is a link.');
        return handle;
    }
    catch (error) {
        await handle.close().catch(() => undefined);
        throw error;
    }
}
async function assertWindowsStateRootPath(root) {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData === undefined || !validateWindowsOutputPath(localAppData).ok) {
        throw unsafePrivateState('LOCALAPPDATA is not an absolute local path, so no state root can be trusted.');
    }
    if (!validateWindowsOutputPath(root).ok)
        throw unsafePrivateState('the state root is not an absolute local path.');
    const canonicalLocal = await realpath(localAppData);
    const canonicalRoot = join(await realpath(dirname(root)), basename(root));
    if (canonicalRoot !== root) {
        throw unsafePrivateState(`the state root must be given in its canonical form (${canonicalRoot}).`);
    }
    if (!root.startsWith(`${canonicalLocal}\\`))
        throw unsafePrivateState('the state root must be inside %LOCALAPPDATA%.');
}
async function syncWindowsDirectory(path) {
    const handle = await open(path, 'r+');
    try {
        await handle.sync();
    }
    finally {
        await handle.close();
    }
}
async function createWindowsStateRoot(root) {
    const init = join(dirname(root), `${basename(root)}.init-${randomUUID()}`);
    await mkdir(init);
    try {
        const reasons = judgeWindowsStateRootObservation(await observeWindowsStateRoot(init, 'protect'));
        if (reasons.length > 0)
            throw unsafePrivateState(`a new state root could not be protected: ${reasons.join('; ')}.`);
        await rename(init, root);
    }
    catch (error) {
        await rmdir(init);
        if (!hasCode(error, 'EPERM') && !hasCode(error, 'EEXIST'))
            throw error;
        await lstat(root);
        return;
    }
    await syncWindowsDirectory(dirname(root));
}
async function attestWindowsStateRoot(root, create) {
    await assertWindowsStateRootPath(root);
    try {
        await lstat(root);
    }
    catch (error) {
        if (!create || !isMissingPath(error))
            throw error;
        await createWindowsStateRoot(root);
    }
    const before = await lstat(root, { bigint: true });
    const observation = await observeWindowsStateRoot(root, 'attest');
    const after = await lstat(root, { bigint: true });
    if (!sameIdentity(before, after))
        throw unsafePrivateState('the state root was replaced during attestation.');
    const reasons = judgeWindowsStateRootObservation(observation);
    if (observation.ancestors[0]?.path !== root)
        reasons.push('the attested path is not the state root');
    if (reasons.length > 0)
        throw unsafePrivateState(`the state root failed attestation: ${reasons.join('; ')}.`);
    const commands = join(root, 'commands');
    try {
        await mkdir(commands);
    }
    catch (error) {
        if (!hasCode(error, 'EEXIST'))
            throw error;
    }
    const commandsBefore = await lstat(commands, { bigint: true });
    if (commandsBefore.isSymbolicLink() || !commandsBefore.isDirectory())
        throw unsafePrivateState('the commands directory is a link.');
    const pin = await open(commands, 'r+');
    try {
        if (!sameIdentity(await pin.stat({ bigint: true }), commandsBefore))
            throw unsafePrivateState('the commands directory changed while it was opened.');
        await assertAttestedRootUnchanged(root, { ...before, pin });
    }
    catch (error) {
        await pin.close().catch(() => undefined);
        throw error;
    }
    attestedStateRoots.set(root, { dev: before.dev, ino: before.ino, pin });
}
const ATTESTATION_FAILURE_HOLD_MS = 30_000;
async function ensureWindowsStateRoot(root, create) {
    for (;;) {
        const attested = attestedStateRoots.get(root);
        if (attested !== undefined) {
            await assertAttestedRootUnchanged(root, attested);
            return;
        }
        const failed = attestationFailures.get(root);
        if (failed !== undefined && performance.now() < failed.until)
            throw failed.error;
        const pending = attestationsInFlight.get(root);
        if (pending === undefined)
            break;
        await pending.catch(() => undefined);
    }
    const run = attestWindowsStateRoot(root, create).finally(() => { attestationsInFlight.delete(root); });
    attestationsInFlight.set(root, run);
    try {
        await run;
        attestationFailures.delete(root);
    }
    catch (error) {
        if (!isMissingPath(error))
            attestationFailures.set(root, { error, until: performance.now() + ATTESTATION_FAILURE_HOLD_MS });
        throw error;
    }
}
export async function ensurePrivateStateRoot(root) {
    if (isWindowsPrivateState())
        return await ensureWindowsStateRoot(root, true);
    await ensurePrivateDirectory(root, 'state root');
}
export async function validatePrivateStateRoot(root) {
    if (isWindowsPrivateState())
        return await ensureWindowsStateRoot(root, false);
    await validatePrivateDirectory(root, 0o700, 'state root');
}
export async function validatePrivateDirectory(path, expectedMode, description) {
    if (isWindowsPrivateState()) {
        const handle = await openWindowsVerified(path, 'r+', true);
        await handle.close();
        return;
    }
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink())
        throw unsafePrivateState(`${description} must not be a symbolic link.`);
    if (!metadata.isDirectory())
        throw unsafePrivateState(`${description} must be a directory.`);
    validatePrivateOwnerAndMode(metadata, expectedMode, `the existing ${description}`);
    let handle;
    const flags = noFollowDirectoryFlags();
    try {
        handle = await open(path, flags);
    }
    catch (error) {
        throw unsafePrivateState(`${description} could not be opened safely (${error instanceof Error ? error.message : String(error)}).`);
    }
    try {
        const openedMetadata = await handle.stat();
        if (!openedMetadata.isDirectory())
            throw unsafePrivateState(`the opened ${description} is not a directory.`);
        validatePrivateOwnerAndMode(openedMetadata, expectedMode, `the opened ${description}`);
    }
    finally {
        await handle.close();
    }
}
function sameDirectoryIdentity(left, right) {
    return left.dev === right.dev && left.ino === right.ino && left.uid === right.uid &&
        left.mode === right.mode;
}
async function assertHeldPrivateDirectoryStable(held) {
    const opened = await held.handle.stat({ bigint: true });
    if (!opened.isDirectory() || !sameDirectoryIdentity(held.identity, opened)) {
        throw unsafePrivateState(`${held.requirement.description} changed through its opened descriptor.`);
    }
    let pathMetadata;
    try {
        pathMetadata = await lstat(held.requirement.path, { bigint: true });
    }
    catch (error) {
        throw unsafePrivateState(`${held.requirement.description} path could not be revalidated (${error instanceof Error ? error.message : String(error)}).`);
    }
    if (pathMetadata.isSymbolicLink() || !pathMetadata.isDirectory() ||
        !sameDirectoryIdentity(held.identity, pathMetadata)) {
        throw unsafePrivateState(`${held.requirement.description} path no longer identifies the opened directory.`);
    }
}
export async function withPrivateDirectoryScope(requirements, operation) {
    if (requirements.length === 0)
        throw new Error('A private directory scope requires at least one directory.');
    const directoryFlags = isWindowsPrivateState() ? null : noFollowDirectoryFlags();
    const held = [];
    try {
        for (const candidate of requirements) {
            const requirement = { ...candidate, expectedMode: candidate.expectedMode ?? 0o700 };
            let handle;
            try {
                handle = directoryFlags === null
                    ? await openPrivateDirectory(requirement.path)
                    : await open(requirement.path, directoryFlags);
            }
            catch (error) {
                throw unsafePrivateState(`${requirement.description} could not be opened safely (${error instanceof Error ? error.message : String(error)}).`);
            }
            let identity;
            try {
                identity = await handle.stat({ bigint: true });
                if (!identity.isDirectory()) {
                    throw unsafePrivateState(`the opened ${requirement.description} is not a directory.`);
                }
                validatePrivateOwnerAndMode({ uid: Number(identity.uid), mode: Number(identity.mode) }, requirement.expectedMode, `the opened ${requirement.description}`);
            }
            catch (error) {
                await handle.close().catch(() => undefined);
                throw error;
            }
            held.push({ requirement, handle, identity });
        }
        const scope = {
            async assertStable() {
                for (const directory of held)
                    await assertHeldPrivateDirectoryStable(directory);
            },
            async syncLeafParent() {
                const parent = held.at(-1);
                if (!parent)
                    throw unsafePrivateState('private directory scope lost its leaf parent.');
                await parent.handle.sync();
            },
            async syncDirectory(path) {
                const directory = held.find(({ requirement }) => requirement.path === path);
                if (!directory)
                    throw unsafePrivateState(`private directory scope does not hold ${path}.`);
                await assertHeldPrivateDirectoryStable(directory);
                await directory.handle.sync();
            },
        };
        await scope.assertStable();
        const result = await operation(scope);
        await scope.assertStable();
        return result;
    }
    finally {
        await Promise.allSettled(held.reverse().map(async ({ handle }) => await handle.close()));
    }
}
export async function ensurePrivateDirectory(path, description) {
    if (isWindowsPrivateState() && attestedRootContaining(path) === undefined) {
        throw unsafePrivateState(`the ${description} is not inside a state root attested by this process.`);
    }
    try {
        await validatePrivateDirectory(path, 0o700, description);
        return;
    }
    catch (error) {
        if (!isMissingPath(error))
            throw error;
    }
    try {
        await mkdir(path, { recursive: true, mode: 0o700 });
    }
    catch (error) {
        if (!hasCode(error, 'EEXIST'))
            throw error;
    }
    await validatePrivateDirectory(path, 0o700, description);
}
export const PRIVATE_STATE_RECOVERY_GUIDANCE = 'Stop every MCP server process using this state root, then restore owner-only access ' +
    '(regular files to mode 0600, command directories to mode 0700) or move the entry out of the ' +
    'state root; no automatic repair was performed and no artifact contents were read.';
function formatMode(mode) {
    return (mode & 0o7777).toString(8).padStart(4, '0');
}
function entryType(metadata) {
    if (metadata.isSymbolicLink())
        return 'symlink';
    if (metadata.isDirectory())
        return 'directory';
    if (metadata.isFile())
        return 'file';
    return 'other';
}
export function describeStateEntry(path, metadata, expectedMode) {
    const expectedUid = currentUidForDiagnostics();
    return `${path} (type=${entryType(metadata)}, mode=${formatMode(metadata.mode)}, ` +
        `expected mode=${formatMode(expectedMode)}, uid=${metadata.uid}, expected uid=${expectedUid})`;
}
export const UNSAFE_STATE_ENTRY_REPORT_LIMIT = 10;
export function unsafeStateEntriesError(summary, violations, guidance = []) {
    if (violations.length === 0)
        throw new Error('An unsafe state report requires at least one violation.');
    const listed = violations.slice(0, UNSAFE_STATE_ENTRY_REPORT_LIMIT);
    const omitted = violations.length - listed.length;
    return new Error(`${summary} found ${violations.length} unsafe state ${violations.length === 1 ? 'entry' : 'entries'}. ` +
        listed.map((violation, index) => `(${index + 1}) ${violation}`).join(' ') +
        (omitted > 0 ? ` (+${omitted} further violations not listed.)` : '') +
        guidance.map((line) => ` ${line}`).join('') +
        ` ${PRIVATE_STATE_RECOVERY_GUIDANCE}`);
}
