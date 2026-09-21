import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { z } from 'zod';
import { documentContextSchema, documentKeyShortSchema } from './mutation-result-schema-core.js';
import { atomicCreatePrivateRecord, readSecurePrivateRecord, unlinkPrivateRecord } from './private-record.js';
import { ensurePrivateDirectory, isMissingPath, validatePrivateDirectory, withPrivateDirectoryScope } from './private-state.js';
export const BACKUP_RECORD_VERSION = 1;
export const BACKUP_RECORD_MAX_BYTES = 16_384;
export const BACKUP_MAX_PAGE_ITEMS = 1_000;
export const BACKUP_STRUCTURE_TOLERANCE_PT = 0.001;
export const BACKUP_NUMERIC_TOLERANCE = 0.0001;
const COPY_CHUNK_BYTES = 1024 * 1024;
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const backupFilesSchema = z.strictObject({
    backupPath: z.string().nullable(),
    restoreTestPath: z.string().nullable(),
});
const structureDeltaSchema = z.strictObject({
    at: z.string(),
    expected: z.unknown(),
    actual: z.unknown(),
});
export const backupRecordSchema = z.strictObject({
    version: z.literal(BACKUP_RECORD_VERSION),
    backupId: z.uuid(),
    documentKey: z.string().min(1),
    sourcePath: z.string().min(1),
    sourceName: z.string(),
    sourceFileRevision: z.string().min(1),
    backupPath: z.string().min(1),
    bytes: z.number().int().positive(),
    sha256: sha256Schema,
    restoreVerified: z.strictObject({
        method: z.literal('open_compare'),
        restoreTestPath: z.string().min(1),
        restoreTestRemoved: z.boolean(),
        restoredDocumentKey: z.string().min(1),
        comparedItemCount: z.number().int().nonnegative(),
        comparedArtboardCount: z.number().int().nonnegative(),
        sourcePreserved: z.literal(true),
        verifiedAt: z.string().min(1),
    }),
    createdAt: z.string().min(1),
});
export const backupStageSchema = z.enum([
    'read_source',
    'copy_backup',
    'copy_restore_test',
    'open_session',
    'open_restore_test',
    'read_restore_test',
    'compare_structure',
    'close_restore_test',
    'verify_source',
    'write_record',
]);
export const createBackupResultSchema = z.discriminatedUnion('outcome', [
    z.strictObject({
        outcome: z.literal('verified'),
        record: backupRecordSchema,
        recordPath: z.string().min(1),
        retention: z.literal('manual'),
    }),
    z.strictObject({
        outcome: z.literal('rejected'),
        reason: z.enum([
            'document_key_mismatch',
            'document_not_admitted',
            'document_too_large',
            'source_file_unavailable',
            'backup_root_unavailable',
        ]),
        message: z.string(),
        document: documentContextSchema.nullable(),
    }),
    z.strictObject({
        outcome: z.literal('failed'),
        reason: z.enum([
            'copy_mismatch',
            'file_replaced',
            'restore_test_open_failed',
            'restore_test_read_failed',
            'restore_structure_mismatch',
            'restore_test_identity_mismatch',
            'source_changed',
        ]),
        stage: backupStageSchema,
        message: z.string(),
        files: backupFilesSchema,
        deltas: z.array(structureDeltaSchema),
    }),
    z.strictObject({
        outcome: z.literal('indeterminate'),
        stage: backupStageSchema,
        message: z.string(),
        commandId: z.string().nullable(),
        files: backupFilesSchema,
        sessionId: z.string().nullable(),
    }),
]);
export const BACKUP_SESSION_VERSION = 1;
export const BACKUP_SESSION_MAX_BYTES = 8_192;
export const fileIdentitySchema = z.strictObject({
    dev: z.string().regex(/^\d+$/),
    ino: z.string().regex(/^\d+$/),
    size: z.string().regex(/^\d+$/),
    mtimeNs: z.string().regex(/^\d+$/),
    ctimeNs: z.string().regex(/^\d+$/),
});
export const backupSessionSchema = z.strictObject({
    version: z.literal(BACKUP_SESSION_VERSION),
    backupId: z.uuid(),
    documentKey: z.string().min(1),
    sourcePath: z.string().min(1),
    backupPath: z.string().min(1),
    backupIdentity: fileIdentitySchema,
    restoreTestPath: z.string().min(1),
    restoreTestIdentity: fileIdentitySchema,
    bytes: z.number().int().positive(),
    sha256: sha256Schema,
    openCommandId: z.string().min(1),
    phase: z.literal('open_pending'),
    createdAt: z.string().min(1),
});
export const hostDocumentIdentitySchema = z.strictObject({
    keyVersion: z.literal(1),
    key: z.string().min(1),
    keyShort: documentKeyShortSchema,
    name: z.string(),
    path: z.string().nullable(),
    fileRevision: z.string().nullable(),
    fileExists: z.boolean().nullable(),
    saved: z.boolean(),
    colorSpace: z.enum(['RGB', 'CMYK', 'unknown']),
});
export const reconcileBackupResultSchema = z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('no_session'), backupId: z.string() }),
    z.strictObject({
        status: z.literal('released'),
        backupId: z.string(),
        action: z.enum(['inspect', 'close_restore_test']),
        restoreTestPath: z.string(),
        documentCount: z.number().int().nonnegative(),
        closedDocument: hostDocumentIdentitySchema.nullable(),
    }),
    z.strictObject({
        status: z.literal('restore_test_open'),
        backupId: z.string(),
        restoreTestPath: z.string(),
        documents: z.array(hostDocumentIdentitySchema),
        documentCount: z.number().int().nonnegative(),
    }),
]);
export class BackupSessionGoneError extends Error {
    backupId;
    constructor(backupId) {
        super(`Backup session ${backupId} no longer exists.`);
        this.backupId = backupId;
        this.name = 'BackupSessionGoneError';
    }
}
export class BackupSessionUnresolvedError extends Error {
    backupIds;
    constructor(backupIds) {
        super(`Unresolved backup session${backupIds.length === 1 ? '' : 's'} ${backupIds.join(', ')} block${backupIds.length === 1 ? 's' : ''} mutations. ` +
            'Run illustrator_reconcile_backup for each backup_id before another mutation or backup.');
        this.backupIds = backupIds;
        this.name = 'BackupSessionUnresolvedError';
    }
}
export const BACKUP_OPEN_PRE_ATTEMPT_CODES = [
    'DOCUMENT_MISMATCH',
    'DOCUMENT_NOT_SAVED',
    'BACKUP_RESTORE_TEST_MISSING',
];
export const BACKUP_OPEN_ALREADY_OPEN_CODE = 'BACKUP_RESTORE_TEST_ALREADY_OPEN';
export const BACKUP_REQUIRES_SAVED_FILE_MESSAGE = 'Backup requires a saved, file-backed document with a verified file revision; unsaved documents have no file to back up.';
export const BACKUP_OPEN_RESTORE_TEST_SCRIPT = `
var backupCountBefore = app.documents.length;
for (var backupScan = 0; backupScan < backupCountBefore; backupScan++) {
  var backupExistingPath = "";
  try { backupExistingPath = app.documents[backupScan].fullName.fsName; } catch (_backupPathError) {}
  if (backupExistingPath === params.restoreTestPath) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "BACKUP_RESTORE_TEST_ALREADY_OPEN" }));
  }
}
var backupRestoreFile = new File(params.restoreTestPath);
if (!backupRestoreFile.exists) throw new Error("MCP_ERROR:" + stringifyJson({ code: "BACKUP_RESTORE_TEST_MISSING" }));
var backupSourceContext = requireDocumentForRead(params.expectedDocumentKey);
if (backupSourceContext.mutationProfile !== "saved_file") {
  throw new Error("MCP_ERROR:" + stringifyJson({
    code: "DOCUMENT_NOT_SAVED",
    message: backupSourceContext.mutationBlockedReason || ${JSON.stringify(BACKUP_REQUIRES_SAVED_FILE_MESSAGE)}
  }));
}
var backupPreviousInteraction = app.userInteractionLevel;
app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
var backupRestoredDocument = null;
try { backupRestoredDocument = app.open(backupRestoreFile); }
finally { app.userInteractionLevel = backupPreviousInteraction; }
var backupRestoredIndex = -1;
for (var backupIndex = 0; backupIndex < app.documents.length; backupIndex++) {
  if (app.documents[backupIndex] === backupRestoredDocument) backupRestoredIndex = backupIndex;
}
if (backupRestoredIndex < 0) throw new Error("MCP_ERROR:" + stringifyJson({ code: "BACKUP_RESTORE_TEST_NOT_LISTED" }));
var backupRestoredIdentity = getDocumentIdentity(backupRestoredDocument, backupRestoredIndex);
if (backupRestoredIdentity.path !== params.restoreTestPath) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "BACKUP_RESTORE_TEST_PATH_MISMATCH", actual: backupRestoredIdentity.path }));
}
if (app.activeDocument !== backupRestoredDocument) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "BACKUP_RESTORE_TEST_NOT_ACTIVE" }));
}
var result = {
  source: backupSourceContext,
  restored: backupRestoredIdentity,
  documentCountBefore: backupCountBefore,
  documentCountAfter: app.documents.length
};
`;
export const BACKUP_CLOSE_PRE_ATTEMPT_CODES = [
    'BACKUP_RESTORE_TEST_NOT_UNIQUE',
    'BACKUP_RESTORE_TEST_IDENTITY_MISMATCH',
    'BACKUP_SOURCE_NOT_UNIQUE',
    'BACKUP_SOURCE_IDENTITY_MISMATCH',
];
export const BACKUP_CLOSE_RESTORE_TEST_SCRIPT = `
function backupKeyWithoutIndex(key) {
  return String(key).replace(/\\|index=-?\\d+\\|/, "|index=*|");
}
var backupRestoreMatches = [];
var backupSourceMatches = [];
for (var backupCloseScan = 0; backupCloseScan < app.documents.length; backupCloseScan++) {
  var backupCandidateIdentity = getDocumentIdentity(app.documents[backupCloseScan], backupCloseScan);
  if (backupCandidateIdentity.path === params.restoreTestPath) {
    backupRestoreMatches.push({ doc: app.documents[backupCloseScan], identity: backupCandidateIdentity });
  }
  if (backupCandidateIdentity.path === params.sourcePath) {
    backupSourceMatches.push({ doc: app.documents[backupCloseScan], identity: backupCandidateIdentity });
  }
}
if (backupRestoreMatches.length !== 1) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "BACKUP_RESTORE_TEST_NOT_UNIQUE", count: backupRestoreMatches.length }));
}
var backupRestoredBeforeClose = backupRestoreMatches[0].identity;
if (backupKeyWithoutIndex(backupRestoredBeforeClose.key) !== backupKeyWithoutIndex(params.restoredDocumentKey) ||
    backupRestoredBeforeClose.saved !== true || backupRestoredBeforeClose.fileRevision !== params.restoredFileRevision) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "BACKUP_RESTORE_TEST_IDENTITY_MISMATCH", actual: backupRestoredBeforeClose }));
}
if (backupSourceMatches.length !== 1) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "BACKUP_SOURCE_NOT_UNIQUE", count: backupSourceMatches.length }));
}
if (backupKeyWithoutIndex(backupSourceMatches[0].identity.key) !== backupKeyWithoutIndex(params.expectedDocumentKey) ||
    backupSourceMatches[0].identity.saved !== true || backupSourceMatches[0].identity.fileRevision !== params.sourceFileRevision) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "BACKUP_SOURCE_IDENTITY_MISMATCH", actual: backupSourceMatches[0].identity }));
}
var backupClosePreviousInteraction = app.userInteractionLevel;
app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
try { backupRestoreMatches[0].doc.close(SaveOptions.DONOTSAVECHANGES); }
finally { app.userInteractionLevel = backupClosePreviousInteraction; }
for (var backupVerifyScan = 0; backupVerifyScan < app.documents.length; backupVerifyScan++) {
  var backupRemainingPath = "";
  try { backupRemainingPath = app.documents[backupVerifyScan].fullName.fsName; } catch (_backupRemainingError) {}
  if (backupRemainingPath === params.restoreTestPath) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "BACKUP_RESTORE_TEST_STILL_OPEN" }));
  }
}
app.activeDocument = backupSourceMatches[0].doc;
var result = {
  restoredBeforeClose: backupRestoredBeforeClose,
  source: getDocumentContext(),
  documentCount: app.documents.length
};
`;
export const BACKUP_INVENTORY_SCRIPT = `
var backupInventory = [];
for (var backupInventoryScan = 0; backupInventoryScan < app.documents.length; backupInventoryScan++) {
  var backupInventoryIdentity = getDocumentIdentity(app.documents[backupInventoryScan], backupInventoryScan);
  if (backupInventoryIdentity.path === params.restoreTestPath) backupInventory.push(backupInventoryIdentity);
}
var result = { documents: backupInventory, documentCount: app.documents.length };
`;
export const BACKUP_RECONCILE_CLOSE_SCRIPT = `
function backupKeyWithoutIndex(key) {
  return String(key).replace(/\\|index=-?\\d+\\|/, "|index=*|");
}
var backupReconcileMatches = [];
for (var backupReconcileScan = 0; backupReconcileScan < app.documents.length; backupReconcileScan++) {
  var backupReconcileIdentity = getDocumentIdentity(app.documents[backupReconcileScan], backupReconcileScan);
  if (backupReconcileIdentity.path === params.restoreTestPath) {
    backupReconcileMatches.push({ doc: app.documents[backupReconcileScan], identity: backupReconcileIdentity });
  }
}
if (backupReconcileMatches.length !== 1) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "BACKUP_RESTORE_TEST_NOT_UNIQUE", count: backupReconcileMatches.length }));
}
var backupReconcileClosed = backupReconcileMatches[0].identity;
if (backupKeyWithoutIndex(backupReconcileClosed.key) !== backupKeyWithoutIndex(params.expectedKey) || backupReconcileClosed.saved !== true ||
    backupReconcileClosed.fileRevision !== params.expectedFileRevision) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "BACKUP_RESTORE_TEST_IDENTITY_MISMATCH", actual: backupReconcileClosed }));
}
var backupReconcilePreviousInteraction = app.userInteractionLevel;
app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
try { backupReconcileMatches[0].doc.close(SaveOptions.DONOTSAVECHANGES); }
finally { app.userInteractionLevel = backupReconcilePreviousInteraction; }
var backupReconcileRemaining = [];
for (var backupReconcileVerify = 0; backupReconcileVerify < app.documents.length; backupReconcileVerify++) {
  var backupReconcileRemainingIdentity = getDocumentIdentity(app.documents[backupReconcileVerify], backupReconcileVerify);
  if (backupReconcileRemainingIdentity.path === params.restoreTestPath) backupReconcileRemaining.push(backupReconcileRemainingIdentity);
}
var result = { closed: backupReconcileClosed, documents: backupReconcileRemaining, documentCount: app.documents.length };
`;
export class BackupPreconditionError extends Error {
    reason;
    constructor(reason, message) {
        super(message);
        this.reason = reason;
        this.name = 'BackupPreconditionError';
    }
}
export class BackupRecordError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BackupRecordError';
    }
}
export class BackupCopyError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BackupCopyError';
    }
}
function fileIdentity(metadata) {
    return { dev: metadata.dev, ino: metadata.ino, size: metadata.size, mtimeNs: metadata.mtimeNs, ctimeNs: metadata.ctimeNs };
}
export function serializeFileIdentity(identity) {
    return {
        dev: identity.dev.toString(), ino: identity.ino.toString(), size: identity.size.toString(),
        mtimeNs: identity.mtimeNs.toString(), ctimeNs: identity.ctimeNs.toString(),
    };
}
export function parseFileIdentity(value) {
    return { dev: BigInt(value.dev), ino: BigInt(value.ino), size: BigInt(value.size), mtimeNs: BigInt(value.mtimeNs), ctimeNs: BigInt(value.ctimeNs) };
}
export async function captureFileIdentity(path) {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const metadata = await handle.stat({ bigint: true });
        if (!metadata.isFile())
            throw new BackupCopyError('The tracked file is no longer a regular file.');
        return fileIdentity(metadata);
    }
    finally {
        await handle.close();
    }
}
export async function verifyTrackedFile(path, identity, sha256) {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const before = await handle.stat({ bigint: true });
        if (!before.isFile() || !sameFileIdentity(identity, fileIdentity(before))) {
            throw new BackupCopyError(`The tracked file ${path} was replaced or modified.`);
        }
        const hash = createHash('sha256');
        const buffer = Buffer.allocUnsafe(COPY_CHUNK_BYTES);
        let total = 0n;
        for (;;) {
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
            if (bytesRead === 0)
                break;
            hash.update(buffer.subarray(0, bytesRead));
            total += BigInt(bytesRead);
        }
        const after = await handle.stat({ bigint: true });
        if (total !== identity.size || hash.digest('hex') !== sha256 || !sameFileIdentity(identity, fileIdentity(after))) {
            throw new BackupCopyError(`The tracked file ${path} no longer matches its recorded bytes.`);
        }
    }
    finally {
        await handle.close();
    }
}
export function sameFileIdentity(left, right) {
    return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
        left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
export async function inspectSourceFile(path) {
    let resolved;
    try {
        resolved = await realpath(path);
    }
    catch (error) {
        throw new BackupPreconditionError('source_file_unavailable', `The source file could not be resolved: ${describeError(error)}`);
    }
    let metadata;
    try {
        metadata = await stat(resolved, { bigint: true });
    }
    catch (error) {
        throw new BackupPreconditionError('source_file_unavailable', `The source file could not be inspected: ${describeError(error)}`);
    }
    if (!metadata.isFile())
        throw new BackupPreconditionError('source_file_unavailable', 'The source path is not a regular file.');
    if (metadata.size <= 0n)
        throw new BackupPreconditionError('source_file_unavailable', 'The source file is empty.');
    if (metadata.size > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new BackupPreconditionError('source_file_unavailable', 'The source file is too large to back up.');
    }
    let handle;
    try {
        handle = await open(resolved, constants.O_RDONLY);
    }
    catch (error) {
        throw new BackupPreconditionError('source_file_unavailable', `The source file is not readable: ${describeError(error)}`);
    }
    await handle.close();
    return { path: resolved, bytes: Number(metadata.size), identity: fileIdentity(metadata) };
}
export async function resolveBackupRoot(path) {
    let resolved;
    try {
        resolved = await realpath(path);
    }
    catch (error) {
        throw new BackupPreconditionError('backup_root_unavailable', `The backup root could not be resolved: ${describeError(error)}`);
    }
    let metadata;
    try {
        metadata = await stat(resolved);
    }
    catch (error) {
        throw new BackupPreconditionError('backup_root_unavailable', `The backup root could not be inspected: ${describeError(error)}`);
    }
    if (!metadata.isDirectory())
        throw new BackupPreconditionError('backup_root_unavailable', 'The backup root is not a directory.');
    try {
        await validatePrivateDirectory(resolved, 0o700, 'backup root');
        await assertManagedNamespace(resolved);
    }
    catch (error) {
        throw new BackupPreconditionError('backup_root_unavailable', `The backup root must be a directory owned by the current user with mode 0700, and every ancestor must be owned by the current user or root and not renameable by other accounts (no group/other write bit, or sticky), so nobody else can replace the directory or its files: ${describeError(error)}`);
    }
    return resolved;
}
export async function assertManagedNamespace(resolvedPath) {
    if (typeof process.getuid !== 'function')
        throw new Error('the current user cannot be verified.');
    const uid = process.getuid();
    let current = dirname(resolvedPath);
    const visited = new Set();
    while (!visited.has(current)) {
        visited.add(current);
        const metadata = await lstat(current);
        if (metadata.isSymbolicLink() || !metadata.isDirectory())
            throw new Error(`ancestor ${current} is not a plain directory.`);
        if (metadata.uid !== uid && metadata.uid !== 0)
            throw new Error(`ancestor ${current} is owned by another user.`);
        if ((metadata.mode & 0o022) !== 0 && (metadata.mode & 0o1000) === 0) {
            throw new Error(`ancestor ${current} is writable by group or others without the sticky bit.`);
        }
        const parent = dirname(current);
        if (parent === current)
            break;
        current = parent;
    }
}
export async function withBackupRootScope(backupRoot, operation) {
    return await withPrivateDirectoryScope([{ path: backupRoot, description: 'backup root' }], operation);
}
async function hashFile(path) {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const hash = createHash('sha256');
        const buffer = Buffer.allocUnsafe(COPY_CHUNK_BYTES);
        let total = 0;
        for (;;) {
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
            if (bytesRead === 0)
                break;
            hash.update(buffer.subarray(0, bytesRead));
            total += bytesRead;
        }
        const metadata = await handle.stat({ bigint: true });
        return { bytes: total, sha256: hash.digest('hex'), identity: fileIdentity(metadata) };
    }
    finally {
        await handle.close();
    }
}
async function syncParentDirectory(path) {
    const directory = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
    try {
        await directory.sync();
    }
    finally {
        await directory.close();
    }
}
export async function copyFileExclusive(sourcePath, destinationPath, expectedIdentity) {
    const input = await open(sourcePath, constants.O_RDONLY);
    let destinationCreated = false;
    try {
        const before = await input.stat({ bigint: true });
        if (!before.isFile())
            throw new BackupCopyError('The copy source is not a regular file.');
        if (expectedIdentity && !sameFileIdentity(expectedIdentity, fileIdentity(before))) {
            throw new BackupCopyError('The copy source changed before the copy started.');
        }
        let output;
        try {
            output = await open(destinationPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        }
        catch (error) {
            throw new BackupCopyError(`The copy destination could not be created exclusively: ${describeError(error)}`);
        }
        destinationCreated = true;
        const hash = createHash('sha256');
        let total = 0;
        try {
            const buffer = Buffer.allocUnsafe(COPY_CHUNK_BYTES);
            for (;;) {
                const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
                if (bytesRead === 0)
                    break;
                const chunk = buffer.subarray(0, bytesRead);
                hash.update(chunk);
                await output.writeFile(chunk);
                total += bytesRead;
            }
            await output.sync();
        }
        finally {
            await output.close();
        }
        await syncParentDirectory(destinationPath);
        const after = await input.stat({ bigint: true });
        if (!sameFileIdentity(fileIdentity(before), fileIdentity(after)) || BigInt(total) !== before.size) {
            throw new BackupCopyError('The copy source changed while it was being copied.');
        }
        const sourceSha256 = hash.digest('hex');
        const copied = await hashFile(destinationPath);
        if (copied.bytes !== total || copied.sha256 !== sourceSha256) {
            throw new BackupCopyError('The copied bytes do not match the source bytes.');
        }
        return { bytes: total, sha256: sourceSha256, destinationCreated, identity: copied.identity };
    }
    catch (error) {
        if (error instanceof BackupCopyError) {
            error.destinationCreated = destinationCreated;
            throw error;
        }
        const wrapped = new BackupCopyError(describeError(error));
        wrapped.destinationCreated = destinationCreated;
        throw wrapped;
    }
    finally {
        await input.close();
    }
}
export function copyErrorCreatedDestination(error) {
    return typeof error === 'object' && error !== null && 'destinationCreated' in error && error.destinationCreated === true;
}
function describeError(error) {
    return error instanceof Error ? error.message : String(error);
}
export function deepDifferences(expected, actual, at = '$') {
    if (typeof expected === 'number') {
        const tolerance = /bounds|Bounds/.test(at) ? BACKUP_STRUCTURE_TOLERANCE_PT : BACKUP_NUMERIC_TOLERANCE;
        if (typeof actual === 'number' && Number.isFinite(expected) && Number.isFinite(actual) &&
            Math.abs(expected - actual) <= tolerance)
            return [];
        return [{ at, expected, actual }];
    }
    if (expected === null || typeof expected !== 'object') {
        return expected === actual ? [] : [{ at, expected, actual }];
    }
    if (actual === null || typeof actual !== 'object' || Array.isArray(expected) !== Array.isArray(actual)) {
        return [{ at, expected, actual }];
    }
    const deltas = [];
    if (Array.isArray(expected) && Array.isArray(actual) && expected.length !== actual.length) {
        deltas.push({ at: `${at}.length`, expected: expected.length, actual: actual.length });
    }
    const expectedRecord = expected;
    const actualRecord = actual;
    const keys = new Set([...Object.keys(expectedRecord), ...Object.keys(actualRecord)]);
    for (const key of keys) {
        const next = Array.isArray(expected) ? `${at}[${key}]` : `${at}.${key}`;
        if (!Object.hasOwn(expectedRecord, key))
            deltas.push({ at: next, expected: undefined, actual: actualRecord[key] });
        else if (!Object.hasOwn(actualRecord, key))
            deltas.push({ at: next, expected: expectedRecord[key], actual: undefined });
        else
            deltas.push(...deepDifferences(expectedRecord[key], actualRecord[key], next));
    }
    return deltas;
}
function comparableItem(item, indexByUuid) {
    const parent = item.parent.status === 'available' && item.parent.value.kind === 'page_item'
        ? {
            status: 'available',
            value: {
                kind: 'page_item',
                type: item.parent.value.type,
                documentIndex: indexByUuid.get(item.parent.value.uuid) ?? null,
            },
        }
        : item.parent;
    return {
        type: item.type,
        name: item.name,
        layer: item.layer,
        bounds: item.bounds,
        visibleBounds: item.visibleBounds,
        documentIndex: item.documentIndex,
        parent,
        locked: item.locked,
        hidden: item.hidden,
        appearance: item.appearance,
        text: item.text,
    };
}
export function compareRestoredStructure(source, restored) {
    const deltas = [];
    deltas.push(...deepDifferences({ colorSpace: source.document.colorSpace, artboardCount: source.document.artboardCount }, { colorSpace: restored.document.colorSpace, artboardCount: restored.document.artboardCount }, '$.document'));
    deltas.push(...deepDifferences(source.artboards, restored.artboards, '$.artboards'));
    const sourceIndex = new Map(source.items.map((item) => [item.uuid, item.documentIndex]));
    const restoredIndex = new Map(restored.items.map((item) => [item.uuid, item.documentIndex]));
    deltas.push(...deepDifferences(source.items.map((item) => comparableItem(item, sourceIndex)), restored.items.map((item) => comparableItem(item, restoredIndex)), '$.items'));
    if (source.scan.totalPageItems !== restored.scan.totalPageItems) {
        deltas.push({ at: '$.scan.totalPageItems', expected: source.scan.totalPageItems, actual: restored.scan.totalPageItems });
    }
    return deltas;
}
export function backupFileName(backupId, sourcePath) {
    return `${backupId}-${basename(sourcePath)}`;
}
export function restoreTestFileName(backupId, sourcePath) {
    return `${backupId}-restore-test-${basename(sourcePath)}`;
}
export class DocumentBackupStore {
    stateRoot;
    constructor(stateRoot) {
        this.stateRoot = stateRoot;
    }
    get recordDirectory() {
        return join(this.stateRoot, 'backups');
    }
    defaultBackupRoot() {
        return this.recordDirectory;
    }
    async ensure() {
        await ensurePrivateDirectory(this.stateRoot, 'state root');
        await ensurePrivateDirectory(this.recordDirectory, 'backup record directory');
    }
    recordPath(backupId) {
        return join(this.recordDirectory, `${backupId}.json`);
    }
    async writeRecord(record) {
        const validated = backupRecordSchema.parse(record);
        const contents = `${JSON.stringify(validated, null, 2)}\n`;
        if (Buffer.byteLength(contents) > BACKUP_RECORD_MAX_BYTES) {
            throw new Error('The backup record exceeds its size limit.');
        }
        const path = this.recordPath(record.backupId);
        await atomicCreatePrivateRecord(path, contents);
        return path;
    }
    async readRecord(backupId) {
        if (!/^[0-9a-f-]{36}$/.test(backupId))
            throw new BackupRecordError('backup_id must be a UUID.');
        const path = this.recordPath(backupId);
        try {
            await lstat(path);
        }
        catch (error) {
            if (isMissingPath(error))
                return null;
            throw new BackupRecordError(`Backup record ${backupId} could not be inspected: ${describeError(error)}`);
        }
        let record;
        try {
            record = await readSecurePrivateRecord(path, BACKUP_RECORD_MAX_BYTES);
        }
        catch (error) {
            if (isMissingPath(error))
                return null;
            throw new BackupRecordError(`Backup record ${backupId} could not be read: ${describeError(error)}`);
        }
        if (record.state === 'missing')
            return null;
        if (record.state === 'invalid')
            throw new BackupRecordError(`Backup record ${backupId} is unsafe (${record.reason}).`);
        const parsed = backupRecordSchema.safeParse((() => { try {
            return JSON.parse(record.text);
        }
        catch {
            return null;
        } })());
        if (!parsed.success)
            throw new BackupRecordError(`Backup record ${backupId} is malformed.`);
        if (parsed.data.backupId !== backupId)
            throw new BackupRecordError(`Backup record ${backupId} names a different backup id.`);
        return parsed.data;
    }
    sessionPath(backupId) {
        return join(this.recordDirectory, `${backupId}.session.json`);
    }
    async openSession(session) {
        const contents = `${JSON.stringify(backupSessionSchema.parse(session), null, 2)}\n`;
        if (Buffer.byteLength(contents) > BACKUP_SESSION_MAX_BYTES)
            throw new Error('The backup session exceeds its size limit.');
        const path = this.sessionPath(session.backupId);
        await atomicCreatePrivateRecord(path, contents);
        return path;
    }
    async readSession(backupId) {
        if (!/^[0-9a-f-]{36}$/.test(backupId))
            throw new Error('backup_id must be a UUID.');
        const path = this.sessionPath(backupId);
        let record;
        try {
            record = await readSecurePrivateRecord(path, BACKUP_SESSION_MAX_BYTES);
        }
        catch (error) {
            if (isMissingPath(error))
                return null;
            throw error;
        }
        if (record.state === 'missing')
            return null;
        if (record.state === 'invalid')
            throw new Error(`Backup session ${backupId} is unsafe (${record.reason}); it stays unresolved.`);
        return backupSessionSchema.parse(JSON.parse(record.text));
    }
    async releaseSession(backupId) {
        await unlinkPrivateRecord(this.sessionPath(backupId));
    }
    async listSessions() {
        let names;
        try {
            names = await readdir(this.recordDirectory);
        }
        catch (error) {
            if (isMissingPath(error))
                return [];
            throw error;
        }
        return names
            .filter((name) => name.endsWith('.session.json'))
            .map((name) => name.slice(0, -'.session.json'.length))
            .sort();
    }
    async assertNoUnresolvedSession() {
        const sessions = await this.listSessions();
        if (sessions.length > 0)
            throw new BackupSessionUnresolvedError(sessions);
    }
}
export function newBackupId() {
    return randomUUID();
}
export async function removeRestoreTestFile(path, identity, scope) {
    let handle;
    try {
        handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        const before = await handle.stat({ bigint: true });
        if (!before.isFile() || !sameFileIdentity(identity, fileIdentity(before)) || before.nlink !== 1n)
            return false;
        await scope.assertStable();
        await unlink(path);
        const after = await handle.stat({ bigint: true });
        if (after.nlink !== 0n)
            return false;
        await scope.syncLeafParent();
        return true;
    }
    catch (_error) {
        return false;
    }
    finally {
        await handle?.close().catch(() => undefined);
    }
}
