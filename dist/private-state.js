import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
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
export function validatePrivateOwnerAndMode(metadata, expectedMode, description) {
    if (typeof process.getuid !== 'function') {
        throw unsafePrivateState('the current operating-system user cannot be verified.');
    }
    if (metadata.uid !== process.getuid())
        throw unsafePrivateState(`${description} is not owned by the current user.`);
    if ((metadata.mode & 0o7777) !== expectedMode) {
        throw unsafePrivateState(`${description} must already have mode ${expectedMode.toString(8).padStart(4, '0')}.`);
    }
}
export async function validatePrivateDirectory(path, expectedMode, description) {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink())
        throw unsafePrivateState(`${description} must not be a symbolic link.`);
    if (!metadata.isDirectory())
        throw unsafePrivateState(`${description} must be a directory.`);
    validatePrivateOwnerAndMode(metadata, expectedMode, `the existing ${description}`);
    let handle;
    try {
        handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
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
    if (typeof constants.O_DIRECTORY !== 'number' || typeof constants.O_NOFOLLOW !== 'number') {
        throw unsafePrivateState('secure directory descriptors require O_DIRECTORY and O_NOFOLLOW support.');
    }
    const held = [];
    try {
        for (const candidate of requirements) {
            const requirement = { ...candidate, expectedMode: candidate.expectedMode ?? 0o700 };
            let handle;
            try {
                handle = await open(requirement.path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
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
    const expectedUid = typeof process.getuid === 'function' ? String(process.getuid()) : 'unknown';
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
