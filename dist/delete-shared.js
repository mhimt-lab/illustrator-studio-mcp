import { z } from 'zod';
import { BackupRecordError } from './document-backup.js';
import { readFileFacts } from './document-lifecycle.js';
export const DELETE_TARGET_LIST_MAX = 50;
const pathSchema = z.string().min(1).max(4_096);
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
export const deleteBackupFactsSchema = z.strictObject({
    backupId: z.uuid(),
    sourcePath: pathSchema,
    sourceFileRevision: z.string().min(1).max(256),
    bytes: z.number().int().positive(),
    sha256: sha256Schema,
});
export const DELETE_BACKUP_REJECTIONS = ['backup_not_found', 'backup_invalid', 'backup_stale', 'backup_file_unavailable', 'backup_mismatch', 'source_file_unavailable'];
export class DeleteBackupError extends Error {
    reason;
    constructor(reason, message) {
        super(`${reason}: ${message}`);
        this.reason = reason;
        this.name = 'DeleteBackupError';
    }
}
export async function verifyDeleteBackup(store, backupId) {
    let record;
    try {
        record = await store.readRecord(backupId);
    }
    catch (error) {
        if (error instanceof BackupRecordError)
            throw new DeleteBackupError('backup_invalid', error.message);
        throw error;
    }
    if (record === null)
        throw new DeleteBackupError('backup_not_found', `No backup record exists for backup_id ${backupId}; run illustrator_create_backup first.`);
    let source;
    try {
        source = await readFileFacts(record.sourcePath);
    }
    catch (error) {
        throw new DeleteBackupError('source_file_unavailable', `The document file ${record.sourcePath} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (source.sha256 !== record.sha256 || source.bytes !== record.bytes) {
        throw new DeleteBackupError('backup_stale', `The file on disk no longer matches backup ${backupId} (bytes ${source.bytes}/${record.bytes}). Save state changed; create a new backup.`);
    }
    let backup;
    try {
        backup = await readFileFacts(record.backupPath);
    }
    catch (error) {
        throw new DeleteBackupError('backup_file_unavailable', `The backup file could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (backup.sha256 !== record.sha256 || backup.bytes !== record.bytes) {
        throw new DeleteBackupError('backup_file_unavailable', `The backup file ${record.backupPath} no longer matches its record.`);
    }
    return deleteBackupFactsSchema.parse({
        backupId: record.backupId, sourcePath: record.sourcePath, sourceFileRevision: record.sourceFileRevision,
        bytes: record.bytes, sha256: record.sha256,
    });
}
export const DELETE_TARGET_LOOKUP_SCRIPT = `
/** Resolves a supported target (PathItem, TextFrame, GroupItem) by native UUID; any other item, and an absent one, is null. */
function deleteResolveTyped(document, uuid) {
  var resolved = resolvePageItem(document, uuid);
  if (resolved === null) return null;
  if (resolved.typename !== "PathItem" && resolved.typename !== "TextFrame" && resolved.typename !== "GroupItem") return null;
  return { item: resolved.item, typename: resolved.typename };
}
/** Diagnostic only: the typename the document reports for a UUID outside the supported types. */
function deleteOtherTypename(document, uuid) {
  var resolved = resolvePageItem(document, uuid);
  return resolved === null ? null : resolved.typename;
}
/** Absence: no direct reference answers and a walk that reached every page item finds no item with the UUID; an incomplete walk is refused, never read as absent. */
function deleteIsAbsent(document, uuid) {
  return resolvePageItem(document, uuid) === null;
}
`;
