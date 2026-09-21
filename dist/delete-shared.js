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
function deleteScanCollection(collection, uuid, typename, found) {
  for (var index = 0; index < collection.length; index++) {
    var candidate = collection[index];
    if (String(candidate.uuid) === uuid) found.push({ item: candidate, typename: typename });
  }
}
/** Measured route: only the typed collections of the supported types (getPageItemFromUuid misreports some types). */
function deleteResolveTyped(document, uuid) {
  var found = [];
  deleteScanCollection(document.pathItems, uuid, "PathItem", found);
  deleteScanCollection(document.textFrames, uuid, "TextFrame", found);
  deleteScanCollection(document.groupItems, uuid, "GroupItem", found);
  if (found.length > 1) throw mutationError("preflight_failed", "More than one supported item carries UUID " + uuid + ".");
  if (found.length === 0) return null;
  if (String(found[0].item.typename) !== found[0].typename) throw mutationError("preflight_failed", "The item with UUID " + uuid + " does not report its collection type.");
  return found[0];
}
/** Diagnostic only: the typename the document-wide collection reports for a UUID outside the supported types. */
function deleteOtherTypename(document, uuid) {
  for (var index = 0; index < document.pageItems.length; index++) {
    var item = document.pageItems[index];
    if (String(item.uuid) === uuid) return String(item.typename);
  }
  return null;
}
/** Measured absence (D1-D4): the lookup throws (MRAP 1200) and no typed collection holds the UUID. */
function deleteIsAbsent(document, uuid) {
  var lookupThrew = false;
  try { document.getPageItemFromUuid(uuid); } catch (_lookupError) { lookupThrew = true; }
  if (!lookupThrew) return false;
  var found = [];
  deleteScanCollection(document.pathItems, uuid, "PathItem", found);
  deleteScanCollection(document.textFrames, uuid, "TextFrame", found);
  deleteScanCollection(document.groupItems, uuid, "GroupItem", found);
  return found.length === 0;
}
`;
