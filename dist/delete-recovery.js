import { z } from 'zod';
import { DELETE_TARGET_LIST_MAX, DELETE_TARGET_LOOKUP_SCRIPT } from './delete-shared.js';
import { LIFECYCLE_SHARED } from './document-lifecycle.js';
import { documentContextSchema } from './mutation-result-schema-core.js';
import { MUTATION_TRANSACTION_SCRIPT } from './mutation-transaction.js';
const pathSchema = z.string().min(1).max(4_096);
const documentKeySchema = z.string().min(1).max(16_384);
const uuidSchema = z.string().min(1).max(255);
export const reconcileDeletePublicInputSchema = z.strictObject({
    backup_id: z.uuid().describe('The backup_id the delete apply was bound to.'),
    expected_document_path: pathSchema.describe('Path of the document the delete ran on; must equal the backup record\'s source path.'),
    expected_document_key: documentKeySchema.describe('The expected_document_key the delete apply used.'),
    target_uuids: z.array(uuidSchema).min(1).max(DELETE_TARGET_LIST_MAX).describe('The target_uuids the delete apply used.'),
    action: z.enum(['inspect', 'revert']).default('inspect'),
    confirm_document_key: documentKeySchema.nullable().optional()
        .describe('For revert: the full key inspect reported for the single open document at the path, or null when inspect reported none open.'),
});
export function normalizeReconcileDeletePublicInput(input) {
    const value = reconcileDeletePublicInputSchema.parse(input);
    return {
        backupId: value.backup_id, expectedDocumentPath: value.expected_document_path, expectedDocumentKey: value.expected_document_key,
        targetUuids: value.target_uuids, action: value.action, confirmDocumentKey: value.confirm_document_key,
    };
}
const openDocumentSummarySchema = z.strictObject({
    key: z.string().min(1),
    keyShort: z.string().min(1),
    name: z.string(),
    saved: z.boolean(),
    fileRevision: z.string().nullable(),
    index: z.number().int().nonnegative(),
});
const targetPresenceSchema = z.strictObject({ uuid: uuidSchema, present: z.boolean() });
export const reconcileDeleteRefusalSchema = z.enum([
    'backup_not_found', 'backup_invalid', 'backup_stale', 'backup_file_unavailable', 'backup_mismatch', 'source_file_unavailable',
    'confirmation_required', 'confirmation_mismatch', 'ambiguous_documents', 'file_changed', 'command_locked',
]);
export const reconcileDeleteResultSchema = z.discriminatedUnion('status', [
    z.strictObject({
        status: z.literal('not_applied'), action: z.literal('inspect'), backupId: z.uuid(), path: pathSchema,
        fileMatchesBackup: z.literal(true), documents: z.array(openDocumentSummarySchema).length(1),
        targets: z.array(targetPresenceSchema).min(1), message: z.string().min(1),
    }),
    z.strictObject({
        status: z.literal('revert_required'), action: z.literal('inspect'), backupId: z.uuid(), path: pathSchema,
        fileMatchesBackup: z.boolean(), documents: z.array(openDocumentSummarySchema), keyMatches: z.boolean(),
        targets: z.array(targetPresenceSchema).nullable(), message: z.string().min(1),
    }),
    z.strictObject({
        status: z.literal('restored'), action: z.literal('revert'), backupId: z.uuid(), path: pathSchema,
        closedDocument: openDocumentSummarySchema.nullable(), document: documentContextSchema,
        targets: z.array(targetPresenceSchema).min(1), targetUuidsResolve: z.boolean(), fileUnchanged: z.literal(true), durationMs: z.number().nonnegative(),
        message: z.string().min(1),
    }),
    z.strictObject({
        status: z.literal('not_restored'), action: z.literal('revert'), backupId: z.uuid(), path: pathSchema,
        stage: z.enum(['close', 'open', 'verify', 'file']), documents: z.array(openDocumentSummarySchema), message: z.string().min(1),
    }),
    z.strictObject({ status: z.literal('refused'), action: z.enum(['inspect', 'revert']), reason: reconcileDeleteRefusalSchema, message: z.string().min(1) }),
    z.strictObject({ status: z.literal('indeterminate'), action: z.literal('revert'), commandId: z.string().nullable(), message: z.string().min(1) }),
]);
const DELETE_RECOVERY_SHARED = `${MUTATION_TRANSACTION_SCRIPT}
${LIFECYCLE_SHARED}
${DELETE_TARGET_LOOKUP_SCRIPT}
function deleteRecoverySummary(doc, index) {
  var identity = getDocumentIdentity(doc, index);
  return { key: identity.key, keyShort: identity.keyShort, name: identity.name, saved: identity.saved, fileRevision: identity.fileRevision, index: index };
}
function deleteRecoveryDocumentsAt(path) {
  var matches = [];
  for (var index = 0; index < app.documents.length; index++) {
    if (lifecyclePathOf(app.documents[index]) === path) matches.push({ doc: app.documents[index], summary: deleteRecoverySummary(app.documents[index], index) });
  }
  return matches;
}
/** Full or short expected key against a full key, with the positional "index=" field ignored. */
function deleteRecoveryKeyMatches(expected, actualFullKey) {
  if (!isShortDocumentKey(expected)) return lifecycleKeyWithoutIndex(expected) === lifecycleKeyWithoutIndex(actualFullKey);
  for (var index = -1; index <= app.documents.length + 1; index++) {
    if (documentKeyShort(actualFullKey.replace(/\\|index=-?\\d+\\|/, "|index=" + index + "|")) === expected) return true;
  }
  return false;
}
function deleteRecoveryTargets(doc, uuids) {
  var targets = [];
  for (var index = 0; index < uuids.length; index++) targets.push({ uuid: uuids[index], present: deleteResolveTyped(doc, uuids[index]) !== null });
  return targets;
}
function deleteRecoverySummaries(matches) {
  var summaries = [];
  for (var index = 0; index < matches.length; index++) summaries.push(matches[index].summary);
  return summaries;
}
`;
export const DELETE_INSPECT_SCRIPT = `${DELETE_RECOVERY_SHARED}
var deleteInspectMatches = deleteRecoveryDocumentsAt(params.sourcePath);
var result = {
  documents: deleteRecoverySummaries(deleteInspectMatches),
  documentCount: app.documents.length,
  keyMatches: deleteInspectMatches.length === 1 && deleteRecoveryKeyMatches(params.expectedDocumentKey, deleteInspectMatches[0].summary.key),
  targets: deleteInspectMatches.length === 1 ? deleteRecoveryTargets(deleteInspectMatches[0].doc, params.targetUuids) : null
};
`;
export const DELETE_REVERT_SCRIPT = `${DELETE_RECOVERY_SHARED}
var deleteRevertStartedAt = new Date().getTime();
var deleteRevertFile = new File(params.sourcePath);
if (deleteRevertFile.exists !== true || deleteRevertFile.length !== params.bytes) lifecycleError("DELETE_REVERT_FILE_CHANGED", { message: "The file at the backup's source path is missing or no longer has the backup's size." });
var deleteRevertMatches = deleteRecoveryDocumentsAt(params.sourcePath);
if (deleteRevertMatches.length > 1) lifecycleError("DELETE_REVERT_AMBIGUOUS", { message: "More than one open document uses the path; close the extra ones yourself first." });
if (deleteRevertMatches.length === 1 && deleteRevertMatches[0].summary.key !== params.confirmDocumentKey) {
  lifecycleError("DELETE_REVERT_CONFIRMATION_MISMATCH", { expected: String(params.confirmDocumentKey), actual: deleteRevertMatches[0].summary.key });
}
if (deleteRevertMatches.length === 0 && params.confirmDocumentKey !== null) {
  lifecycleError("DELETE_REVERT_CONFIRMATION_MISMATCH", { expected: String(params.confirmDocumentKey), actual: "no open document at the path" });
}
var deleteRevertTarget = deleteRevertMatches.length === 1 ? deleteRevertMatches[0].doc : null;
var deleteRevertBefore = lifecycleInventory();
var deleteRevertOthers = [];
for (var deleteRevertCursor = 0; deleteRevertCursor < deleteRevertBefore.length; deleteRevertCursor++) {
  if (deleteRevertBefore[deleteRevertCursor].doc !== deleteRevertTarget) deleteRevertOthers.push(deleteRevertBefore[deleteRevertCursor]);
}
var deleteRevertClosed = deleteRevertTarget === null ? null : deleteRevertMatches[0].summary;
var deleteRevertInteraction = app.userInteractionLevel;
var result;
app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
try {
  lifecycleBeginSideEffect();
  var deleteRevertStage = "close";
  var deleteRevertError = null;
  try {
    if (deleteRevertTarget !== null) deleteRevertTarget.close(SaveOptions.DONOTSAVECHANGES);
    deleteRevertTarget = null;
    deleteRevertStage = "open";
    app.open(deleteRevertFile);
  } catch (revertError) {
    deleteRevertError = lifecycleMessage(revertError);
  }
  if (deleteRevertError !== null) {
    result = { outcome: deleteRevertStage === "close" ? "close_failed" : "open_failed", message: deleteRevertError, documents: deleteRecoverySummaries(deleteRecoveryDocumentsAt(params.sourcePath)) };
  } else {
    var deleteRevertReopened = deleteRecoveryDocumentsAt(params.sourcePath);
    if (deleteRevertReopened.length !== 1 || app.activeDocument !== deleteRevertReopened[0].doc) {
      result = { outcome: "open_failed", message: "The reopened document is not the single active document at the path.", documents: deleteRecoverySummaries(deleteRevertReopened) };
    } else {
      var deleteRevertSummary = deleteRevertReopened[0].summary;
      var deleteRevertContext = getDocumentContext();
      result = {
        outcome: "reopened",
        closed: deleteRevertClosed,
        document: deleteRevertContext,
        checks: {
          path: deleteRevertContext.path === params.sourcePath,
          revision: deleteRevertSummary.fileRevision === params.sourceFileRevision,
          saved: deleteRevertSummary.saved === true,
          profile: deleteRevertContext.mutationProfile === "saved_file",
          key: deleteRecoveryKeyMatches(params.expectedDocumentKey, deleteRevertSummary.key),
          others: lifecycleExistingUnchanged(deleteRevertOthers, null) === null,
          count: app.documents.length === deleteRevertOthers.length + 1
        },
        targets: deleteRecoveryTargets(deleteRevertReopened[0].doc, params.targetUuids),
        durationMs: new Date().getTime() - deleteRevertStartedAt,
        documents: deleteRecoverySummaries(deleteRevertReopened)
      };
    }
  }
} finally {
  app.userInteractionLevel = deleteRevertInteraction;
}
`;
