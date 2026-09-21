import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, open, realpath, rmdir, unlink } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { fileIdentitySchema, serializeFileIdentity } from './document-backup.js';
import { documentContextSchema, documentContextWithApplicationSchema } from './mutation-result-schema-core.js';
import { EDIT_SESSION_JSX } from './edit-session-jsx.js';
export const LIFECYCLE_HOST_TIMEOUT_MS = 300_000;
const HASH_CHUNK_BYTES = 1024 * 1024;
const MAX_HASHED_FILE_BYTES = 2n ** 31n;
const documentKeyInputSchema = z.string().min(1).max(16_384);
const pathInputSchema = z.string().min(1).max(4_096);
export const saveDocumentAsPublicInputSchema = z.strictObject({
    expected_document_key: documentKeyInputSchema,
    output_path: pathInputSchema.describe('Absolute, normalized path of the new .ai file. It must not exist; the parent directory must exist and be owned by the current user.'),
});
export const saveDocumentPublicInputSchema = z.strictObject({
    expected_document_key: documentKeyInputSchema,
    backup_id: z.uuid().describe('backupId of a verified illustrator_create_backup record whose bytes still equal the file that will be overwritten.'),
});
export const openDocumentPublicInputSchema = z.strictObject({
    path: pathInputSchema.describe('Absolute, normalized path of an existing .ai file that is not open yet.'),
});
export const closeDocumentPublicInputSchema = z.strictObject({
    expected_document_key: documentKeyInputSchema,
    discard_changes: z.boolean().default(false).describe('Required true to close a document with unsaved changes; the changes are discarded, nothing is written.'),
});
export function normalizeSaveDocumentAsPublicInput(input) {
    const value = saveDocumentAsPublicInputSchema.parse(input);
    return { expectedDocumentKey: value.expected_document_key, outputPath: value.output_path };
}
export function normalizeSaveDocumentPublicInput(input) {
    const value = saveDocumentPublicInputSchema.parse(input);
    return { expectedDocumentKey: value.expected_document_key, backupId: value.backup_id };
}
export function normalizeOpenDocumentPublicInput(input) {
    return { path: openDocumentPublicInputSchema.parse(input).path };
}
export function normalizeCloseDocumentPublicInput(input) {
    const value = closeDocumentPublicInputSchema.parse(input);
    return { expectedDocumentKey: value.expected_document_key, discardChanges: value.discard_changes };
}
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
export const lifecycleStageSchema = z.enum([
    'read_document', 'validate_path', 'verify_backup', 'save_as', 'verify_output', 'publish_output', 'switch_reference', 'cleanup_staging', 'save', 'open', 'close', 'verify_file',
]);
export const SAVE_AS_STAGING_PREFIX = '.illustrator-studio-mcp-save-as-';
const previousDocumentSchema = z.strictObject({
    key: z.string().min(1),
    path: z.string().nullable(),
    saved: z.boolean(),
    fileRevision: z.string().nullable(),
    mutationProfile: z.enum(['saved_file', 'unsaved_document']).nullable(),
});
const fileFactsSchema = z.strictObject({
    path: z.string().min(1),
    bytes: z.number().int().positive(),
    sha256: sha256Schema,
    identity: fileIdentitySchema,
});
const existingDocumentSchema = z.strictObject({
    keyBefore: z.string().min(1),
    keyAfter: z.string().min(1),
    indexBefore: z.number().int().nonnegative(),
    indexAfter: z.number().int().nonnegative(),
    path: z.string().nullable(),
    saved: z.boolean(),
    fileRevision: z.string().nullable(),
});
const documentIdentitySummarySchema = z.strictObject({
    key: z.string().min(1),
    keyShort: z.string().min(1),
    name: z.string(),
    path: z.string().nullable(),
    saved: z.boolean(),
    fileRevision: z.string().nullable(),
    colorSpace: z.enum(['RGB', 'CMYK', 'unknown']),
});
const indeterminateSchema = z.strictObject({
    outcome: z.literal('indeterminate'),
    stage: lifecycleStageSchema,
    message: z.string().min(1),
    commandId: z.string().nullable(),
    document: documentContextSchema.nullable(),
    path: z.string().nullable().describe('File the host may have written or re-pointed to.'),
    files: z.strictObject({ stagedPath: z.string().nullable(), outputPath: z.string().nullable() }).optional()
        .describe('save-as only: the staged file (retained) and the published output, when they exist.'),
});
export const saveDocumentAsRejectionReasonSchema = z.enum(['document_key_mismatch', 'document_not_admitted', 'output_path_invalid', 'output_exists']);
export const saveDocumentAsFailureReasonSchema = z.enum(['save_failed', 'output_exists', 'output_cross_device']);
export const saveDocumentAsResultSchema = z.discriminatedUnion('outcome', [
    z.strictObject({
        outcome: z.literal('saved'),
        document: documentContextWithApplicationSchema.describe('The document reopened from output_path: a new Document object with a new key; page-item UUIDs are not preserved across the reopen.'),
        previous: previousDocumentSchema,
        output: fileFactsSchema,
        previousFilePreserved: z.boolean().nullable().describe('true when the file the document pointed at before is byte-identical; null for a document that had no file.'),
        staging: z.strictObject({ directory: z.string().min(1), removed: z.boolean() }),
    }),
    z.strictObject({ outcome: z.literal('rejected'), reason: saveDocumentAsRejectionReasonSchema, message: z.string().min(1), document: documentContextSchema.nullable() }),
    z.strictObject({
        outcome: z.literal('failed'),
        reason: saveDocumentAsFailureReasonSchema,
        message: z.string().min(1),
        document: documentContextSchema.nullable().describe('For output_exists: the document is still open and points at the retained staged file.'),
        files: z.strictObject({ stagedPath: z.string().nullable(), outputPath: z.string().nullable() }),
    }),
    indeterminateSchema,
]);
export const saveDocumentRejectionReasonSchema = z.enum([
    'document_key_mismatch', 'document_not_admitted', 'nothing_to_save', 'backup_not_found', 'backup_invalid', 'backup_mismatch', 'backup_stale', 'backup_file_unavailable', 'source_file_unavailable',
    'edit_session_invalid', 'edit_session_suspended', 'edit_session_backup_mismatch', 'edit_session_mismatch',
]);
export const saveDocumentResultSchema = z.discriminatedUnion('outcome', [
    z.strictObject({
        outcome: z.literal('saved'),
        document: documentContextWithApplicationSchema,
        previous: z.strictObject({ key: z.string().min(1), fileRevision: z.string().min(1) }),
        backup: z.strictObject({ backupId: z.uuid(), backupPath: z.string().min(1), bytes: z.number().int().positive(), sha256: sha256Schema }),
        file: fileFactsSchema.extend({ inodeReplaced: z.boolean() }),
        editSession: z.strictObject({
            sessionId: z.string().regex(/^es_[0-9a-f]{32}$/u),
            state: z.enum(['closed', 'open']).describe('closed once the saved file ends the session; open only if closing it failed (the next change then suspends it on the new file revision).'),
            scanMs: z.number().nonnegative(),
        }).optional().describe('Present when the file belonged to an open edit session; the full scan matched its head right before save.'),
    }),
    z.strictObject({ outcome: z.literal('rejected'), reason: saveDocumentRejectionReasonSchema, message: z.string().min(1), document: documentContextSchema.nullable() }),
    z.strictObject({ outcome: z.literal('failed'), reason: z.literal('save_failed'), message: z.string().min(1), document: documentContextSchema.nullable() }),
    indeterminateSchema,
]);
export const openDocumentRejectionReasonSchema = z.enum(['path_invalid', 'source_file_unavailable', 'already_open']);
const openInventorySchema = z.strictObject({
    countBefore: z.number().int().nonnegative(),
    countAfter: z.number().int().nonnegative(),
    openedIndex: z.number().int().nonnegative().nullable(),
    existingDocuments: z.array(existingDocumentSchema),
});
export const openDocumentResultSchema = z.discriminatedUnion('outcome', [
    z.strictObject({ outcome: z.literal('opened'), document: documentContextWithApplicationSchema, inventory: openInventorySchema }),
    z.strictObject({
        outcome: z.literal('rejected'),
        reason: openDocumentRejectionReasonSchema,
        message: z.string().min(1),
        document: documentIdentitySummarySchema.nullable().describe('For already_open: the document that already uses the path.'),
    }),
    z.strictObject({ outcome: z.literal('failed'), reason: z.literal('open_failed'), message: z.string().min(1), inventory: openInventorySchema }),
    z.strictObject({ outcome: z.literal('rolled_back'), reason: z.literal('verify_mismatch'), message: z.string().min(1), inventory: openInventorySchema }),
    z.strictObject({ outcome: z.literal('rollback_failed'), reason: z.literal('verify_mismatch'), message: z.string().min(1), rollbackMessage: z.string().min(1), inventory: openInventorySchema }),
    indeterminateSchema,
]);
export const closeDocumentRejectionReasonSchema = z.enum(['document_key_mismatch', 'unsaved_changes']);
const closeInventorySchema = z.strictObject({
    countBefore: z.number().int().nonnegative(),
    countAfter: z.number().int().nonnegative(),
    remaining: z.array(existingDocumentSchema),
});
export const closeDocumentResultSchema = z.discriminatedUnion('outcome', [
    z.strictObject({
        outcome: z.literal('closed'),
        closed: documentIdentitySummarySchema.extend({ discardedChanges: z.boolean() }),
        inventory: closeInventorySchema,
        activeDocument: documentContextWithApplicationSchema.nullable(),
        filePreserved: z.boolean().nullable().describe('true when the closed document\'s file is byte-identical to before; null when it had no file.'),
    }),
    z.strictObject({ outcome: z.literal('rejected'), reason: closeDocumentRejectionReasonSchema, message: z.string().min(1), document: documentContextSchema.nullable() }),
    z.strictObject({ outcome: z.literal('failed'), reason: z.literal('close_failed'), message: z.string().min(1), inventory: closeInventorySchema }),
    indeterminateSchema,
]);
export const LIFECYCLE_PRE_ATTEMPT_CODES = Object.freeze([
    'DOCUMENT_MISMATCH', 'DOCUMENT_KEY_AMBIGUOUS', 'LIFECYCLE_INVALID_INPUT', 'LIFECYCLE_PATH_UNAVAILABLE', 'OUTPUT_EXISTS',
    'NOTHING_TO_SAVE', 'SAVE_PATH_MISMATCH', 'SOURCE_FILE_MISSING', 'ALREADY_OPEN', 'OPEN_FILE_MISSING', 'UNSAVED_CHANGES', 'SWITCH_PRECONDITION',
]);
export const LIFECYCLE_SHARED = `
var MUTATION_FORCE_INDETERMINATE = false;
var MUTATION_RUNNER_DISPOSITION = null;
function lifecycleBeginSideEffect() { MUTATION_FORCE_INDETERMINATE = true; }
function lifecycleRetainLock() { MUTATION_RUNNER_DISPOSITION = "indeterminate"; }
function lifecycleIndexOf(doc) {
  for (var cursor = 0; cursor < app.documents.length; cursor++) {
    try { if (app.documents[cursor] === doc) return cursor; } catch (_compareError) {}
  }
  return -1;
}
function lifecycleKeyWithoutIndex(key) { return key.replace(/\\|index=-?\\d+\\|/, "|index=*|"); }
function lifecyclePathOf(doc) {
  try { var value = doc.fullName.fsName; return typeof value === "string" ? value : ""; } catch (_pathError) { return ""; }
}
function lifecycleMessage(error) { return error && error.message ? String(error.message) : String(error); }
function lifecycleError(code, extra) {
  var payload = { code: code };
  if (extra) { for (var key in extra) { if (extra.hasOwnProperty(key)) payload[key] = extra[key]; } }
  throw new Error("MCP_ERROR:" + stringifyJson(payload));
}
function lifecycleSummary(identity) {
  return { key: identity.key, keyShort: identity.keyShort, name: identity.name, path: identity.path, saved: identity.saved, fileRevision: identity.fileRevision, colorSpace: identity.colorSpace };
}
function lifecycleInventory() {
  var entries = [];
  for (var cursor = 0; cursor < app.documents.length; cursor++) {
    entries.push({ doc: app.documents[cursor], identity: getDocumentIdentity(app.documents[cursor], cursor), index: cursor });
  }
  return entries;
}
function lifecycleExistingReport(before, skipDoc) {
  var report = [];
  for (var cursor = 0; cursor < before.length; cursor++) {
    var entry = before[cursor];
    if (skipDoc !== null && entry.doc === skipDoc) continue;
    var indexAfter = lifecycleIndexOf(entry.doc);
    var identityAfter = indexAfter >= 0 ? getDocumentIdentity(entry.doc, indexAfter) : null;
    report.push({
      keyBefore: entry.identity.key,
      keyAfter: identityAfter === null ? "" : identityAfter.key,
      indexBefore: entry.index,
      indexAfter: indexAfter < 0 ? 0 : indexAfter,
      path: identityAfter === null ? entry.identity.path : identityAfter.path,
      saved: identityAfter === null ? false : identityAfter.saved,
      fileRevision: identityAfter === null ? null : identityAfter.fileRevision
    });
  }
  return report;
}
function lifecycleExistingUnchanged(before, skipDoc) {
  for (var cursor = 0; cursor < before.length; cursor++) {
    var entry = before[cursor];
    if (skipDoc !== null && entry.doc === skipDoc) continue;
    var indexAfter = lifecycleIndexOf(entry.doc);
    if (indexAfter < 0) return "A pre-existing document disappeared from the collection.";
    var identityAfter = getDocumentIdentity(entry.doc, indexAfter);
    if (lifecycleKeyWithoutIndex(identityAfter.key) !== lifecycleKeyWithoutIndex(entry.identity.key)) return "A pre-existing document identity changed apart from its collection index.";
    if (identityAfter.saved !== entry.identity.saved) return "A pre-existing document changed its saved state.";
  }
  return null;
}
function lifecycleSafeContext() {
  try { return getDocumentContext(); } catch (_contextError) { return null; }
}
`;
export const LIFECYCLE_READ_SCRIPT = `
${LIFECYCLE_SHARED}
var lifecycleReadContext = requireDocumentForRead(params.expectedDocumentKey);
var result = { document: lifecycleReadContext, documentIndex: lifecycleIndexOf(app.activeDocument), documentCount: app.documents.length };
`;
export const SAVE_DOCUMENT_AS_SCRIPT = `
${LIFECYCLE_SHARED}
if (typeof params.outputPath !== "string" || params.outputPath.length === 0) lifecycleError("LIFECYCLE_INVALID_INPUT", { message: "outputPath must be a non-empty string." });
var lifecycleContextBefore = resolveExpectedDocument(params.expectedDocumentKey);
var lifecycleDoc = app.activeDocument;
if (!readDocumentPath(lifecycleDoc).available) lifecycleError("LIFECYCLE_PATH_UNAVAILABLE", { message: "The document path could not be read; save-as is refused." });
var lifecycleIndexBefore = lifecycleIndexOf(lifecycleDoc);
var lifecycleCountBefore = app.documents.length;
var lifecycleOutputFile = new File(params.outputPath);
if (lifecycleOutputFile.exists === true) lifecycleError("OUTPUT_EXISTS", { path: params.outputPath });
var lifecyclePrevious = {
  key: lifecycleContextBefore.key, path: lifecycleContextBefore.path, saved: lifecycleContextBefore.saved,
  fileRevision: lifecycleContextBefore.fileRevision, mutationProfile: lifecycleContextBefore.mutationProfile
};
var lifecyclePreviousInteraction = app.userInteractionLevel;
var lifecycleSaveError = null;
var result;
app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
try {
  try {
    var lifecycleOptions = new IllustratorSaveOptions();
    lifecycleOptions.compressed = true;
    lifecycleOptions.pdfCompatible = true;
    lifecycleOptions.embedICCProfile = true;
    lifecycleBeginSideEffect();
    lifecycleDoc.saveAs(lifecycleOutputFile, lifecycleOptions);
  } catch (saveError) {
    lifecycleSaveError = lifecycleMessage(saveError);
  }
  var lifecycleOutputExists = false;
  try { lifecycleOutputExists = new File(params.outputPath).exists === true; } catch (_existsError) {}
  if (lifecycleSaveError !== null) {
    result = { outcome: "save_failed", message: lifecycleSaveError, outputExists: lifecycleOutputExists, document: lifecycleSafeContext() };
    lifecycleRetainLock();
  } else {
    var lifecycleVerifyMessage = null;
    var lifecycleAfterContext = null;
    var lifecycleIndexAfter = lifecycleIndexOf(lifecycleDoc);
    try {
      if (lifecycleIndexAfter !== lifecycleIndexBefore) lifecycleVerifyMessage = "The document changed its collection index during save-as.";
      else if (app.documents.length !== lifecycleCountBefore) lifecycleVerifyMessage = "The document count changed during save-as.";
      else if (app.activeDocument !== lifecycleDoc) lifecycleVerifyMessage = "The saved document is no longer the active document.";
      else if (lifecyclePathOf(lifecycleDoc) !== params.outputPath) lifecycleVerifyMessage = "The document does not point at the requested output path after save-as (" + lifecyclePathOf(lifecycleDoc) + ").";
      else if (!lifecycleOutputExists) lifecycleVerifyMessage = "saveAs returned but the output file does not exist.";
      else if (lifecycleDoc.saved !== true) lifecycleVerifyMessage = "The document is not clean after save-as.";
      else {
        lifecycleAfterContext = getDocumentContext();
        if (lifecycleAfterContext.path !== params.outputPath || lifecycleAfterContext.saved !== true || lifecycleAfterContext.fileRevision === null) {
          lifecycleVerifyMessage = "The document context does not reflect the save-as (path, saved, or file revision).";
        }
      }
    } catch (verifyError) {
      lifecycleVerifyMessage = "Verification failed: " + lifecycleMessage(verifyError);
    }
    if (lifecycleVerifyMessage !== null) {
      result = { outcome: "verify_mismatch", message: lifecycleVerifyMessage, outputExists: lifecycleOutputExists, document: lifecycleSafeContext() };
      lifecycleRetainLock();
    } else {
      result = { outcome: "saved", document: lifecycleAfterContext, previous: lifecyclePrevious, documentIndex: lifecycleIndexAfter, documentCount: app.documents.length };
    }
  }
} finally {
  app.userInteractionLevel = lifecyclePreviousInteraction;
}
`;
export const SAVE_DOCUMENT_SCRIPT = `
${LIFECYCLE_SHARED}
${EDIT_SESSION_JSX}
if (typeof params.path !== "string" || params.path.length === 0) lifecycleError("LIFECYCLE_INVALID_INPUT", { message: "path must be a non-empty string." });
var lifecycleContextBefore = resolveExpectedDocument(params.expectedDocumentKey);
var lifecycleDoc = app.activeDocument;
if (!readDocumentPath(lifecycleDoc).available) lifecycleError("LIFECYCLE_PATH_UNAVAILABLE", { message: "The document path could not be read; save is refused." });
if (lifecycleDoc.saved === true) lifecycleError("NOTHING_TO_SAVE", { message: "The document has no unsaved changes." });
if (lifecyclePathOf(lifecycleDoc) !== params.path) lifecycleError("SAVE_PATH_MISMATCH", { expected: params.path, actual: lifecyclePathOf(lifecycleDoc) });
if (new File(params.path).exists !== true) lifecycleError("SOURCE_FILE_MISSING", { path: params.path });
if (lifecycleContextBefore.fileRevision === null) lifecycleError("LIFECYCLE_PATH_UNAVAILABLE", { message: "The file revision of the document could not be read; save is refused." });
if (typeof params.expectedRevision !== "string" || typeof params.expectedBytes !== "number") lifecycleError("LIFECYCLE_INVALID_INPUT", { message: "expectedRevision and expectedBytes are required." });
if (lifecycleContextBefore.fileRevision !== params.expectedRevision) lifecycleError("SAVE_PATH_MISMATCH", { expected: params.expectedRevision, actual: lifecycleContextBefore.fileRevision, message: "The document file revision differs from the verified one." });
var lifecycleIndexBefore = lifecycleIndexOf(lifecycleDoc);
var lifecycleCountBefore = app.documents.length;
var lifecyclePrevious = { key: lifecycleContextBefore.key, fileRevision: lifecycleContextBefore.fileRevision };
var lifecyclePreviousInteraction = app.userInteractionLevel;
var lifecycleSaveError = null;
var result;
function lifecycleObserveFile() {
  var observed = { length: null, revision: null };
  try {
    var file = new File(params.path);
    if (file.exists === true) { observed.length = file.length; observed.revision = String(file.length) + ":" + String(file.modified.getTime()); }
  } catch (_observeError) {}
  return observed;
}
app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
try {
  // Review finding 3: the host re-reads the file's length and modification time immediately before save() and
  // refuses to write when they differ from what Node verified against the backup record.
  var lifecycleObserved = lifecycleObserveFile();
  var lifecycleSessionCheck = null;
  if (params.editSession !== undefined && params.editSession !== null) {
    var lifecycleSessionStructure = esStructure(lifecycleDoc);
    var lifecycleSessionScan = esScan(lifecycleDoc, params.editSession.deadlineMs, params.editSession.maxItems);
    lifecycleSessionCheck = { structureDigest: lifecycleSessionStructure.digest, itemAggregate: lifecycleSessionScan.aggregate,
      total: lifecycleSessionScan.total, visited: lifecycleSessionScan.visited, truncated: lifecycleSessionScan.truncated,
      overLimit: lifecycleSessionScan.overLimit, scanMs: lifecycleSessionStructure.durationMs + lifecycleSessionScan.durationMs };
  }
  if (lifecycleObserved.length !== params.expectedBytes || lifecycleObserved.revision !== params.expectedRevision) {
    result = { outcome: "precondition_changed", message: "The file under the document changed between verification and save; nothing was written.", observed: lifecycleObserved, document: lifecycleSafeContext() };
  } else if (lifecycleSessionCheck !== null && (lifecycleSessionCheck.truncated || lifecycleSessionCheck.overLimit ||
      lifecycleSessionCheck.structureDigest !== params.editSession.structureDigest ||
      lifecycleSessionCheck.itemAggregate !== params.editSession.itemAggregate)) {
    result = { outcome: "edit_session_mismatch", check: lifecycleSessionCheck, document: lifecycleSafeContext() };
  } else {
    try {
      lifecycleDoc.save();
    } catch (saveError) {
      lifecycleSaveError = lifecycleMessage(saveError);
    }
  }
  if (result !== undefined) {
    // precondition_changed or edit_session_mismatch: no write attempted.
  } else if (lifecycleSaveError !== null) {
    result = { outcome: "save_failed", message: lifecycleSaveError, document: lifecycleSafeContext() };
  } else {
    var lifecycleVerifyMessage = null;
    var lifecycleAfterContext = null;
    try {
      if (lifecycleIndexOf(lifecycleDoc) !== lifecycleIndexBefore) lifecycleVerifyMessage = "The document changed its collection index during save.";
      else if (app.documents.length !== lifecycleCountBefore) lifecycleVerifyMessage = "The document count changed during save.";
      else if (app.activeDocument !== lifecycleDoc) lifecycleVerifyMessage = "The saved document is no longer the active document.";
      else if (lifecyclePathOf(lifecycleDoc) !== params.path) lifecycleVerifyMessage = "The document path changed during save (" + lifecyclePathOf(lifecycleDoc) + ").";
      else if (lifecycleDoc.saved !== true) lifecycleVerifyMessage = "The document is not clean after save.";
      else {
        lifecycleAfterContext = getDocumentContext();
        if (lifecycleAfterContext.path !== params.path || lifecycleAfterContext.saved !== true || lifecycleAfterContext.fileRevision === null) {
          lifecycleVerifyMessage = "The document context does not reflect the save (path, saved, or file revision).";
        } else if (lifecycleAfterContext.fileRevision === lifecyclePrevious.fileRevision) {
          lifecycleVerifyMessage = "The file revision did not change after save.";
        }
      }
    } catch (verifyError) {
      lifecycleVerifyMessage = "Verification failed: " + lifecycleMessage(verifyError);
    }
    if (lifecycleVerifyMessage !== null) result = { outcome: "verify_mismatch", message: lifecycleVerifyMessage, document: lifecycleSafeContext() };
    else result = { outcome: "saved", document: lifecycleAfterContext, previous: lifecyclePrevious, editSessionCheck: lifecycleSessionCheck };
  }
} finally {
  app.userInteractionLevel = lifecyclePreviousInteraction;
}
`;
export const OPEN_DOCUMENT_SCRIPT = `
${LIFECYCLE_SHARED}
if (typeof params.path !== "string" || params.path.length === 0) lifecycleError("LIFECYCLE_INVALID_INPUT", { message: "path must be a non-empty string." });
var lifecycleFile = new File(params.path);
if (lifecycleFile.exists !== true) lifecycleError("OPEN_FILE_MISSING", { path: params.path });
var lifecycleBefore = lifecycleInventory();
for (var lifecycleScan = 0; lifecycleScan < lifecycleBefore.length; lifecycleScan++) {
  if (lifecyclePathOf(lifecycleBefore[lifecycleScan].doc) === params.path) {
    lifecycleError("ALREADY_OPEN", { path: params.path, document: lifecycleSummary(lifecycleBefore[lifecycleScan].identity), index: lifecycleScan });
  }
}
var lifecycleCountBefore = app.documents.length;
var lifecyclePreviousInteraction = app.userInteractionLevel;
var lifecycleOpened = null;
var lifecycleOpenError = null;
var result;
function lifecycleOpenInventory(openedIndex) {
  return { countBefore: lifecycleCountBefore, countAfter: app.documents.length, openedIndex: openedIndex, existingDocuments: lifecycleExistingReport(lifecycleBefore, null) };
}
app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
try {
  try {
    lifecycleBeginSideEffect();
    lifecycleOpened = app.open(lifecycleFile);
  } catch (openError) {
    lifecycleOpenError = lifecycleMessage(openError);
  }
  // Review finding 2: app.open may hand back a document that was already open (measured RETURNS_EXISTING for an
  // identical path; an alias path could slip past the string scan). Compare the returned object with every
  // pre-existing reference: an existing document is never closed by this call.
  var lifecycleReturnedExisting = -1;
  if (lifecycleOpened !== null && lifecycleOpened !== undefined) {
    for (var lifecycleRef = 0; lifecycleRef < lifecycleBefore.length; lifecycleRef++) {
      try { if (lifecycleBefore[lifecycleRef].doc === lifecycleOpened) { lifecycleReturnedExisting = lifecycleRef; break; } } catch (_refError) {}
    }
  }
  if (lifecycleOpened === null || lifecycleOpened === undefined) {
    var lifecycleOpenFailureMessage = null;
    try {
      if (app.documents.length !== lifecycleCountBefore) lifecycleOpenFailureMessage = "app.open returned no document but changed the document count.";
      else lifecycleOpenFailureMessage = lifecycleExistingUnchanged(lifecycleBefore, null);
    } catch (openFailureVerifyError) {
      lifecycleOpenFailureMessage = "Open failure verification failed: " + lifecycleMessage(openFailureVerifyError);
    }
    if (lifecycleOpenFailureMessage === null) {
      result = { outcome: "open_failed", message: lifecycleOpenError === null ? "app.open returned no document." : lifecycleOpenError, inventory: lifecycleOpenInventory(null) };
    } else {
      result = { outcome: "verify_mismatch_no_rollback", message: lifecycleOpenFailureMessage + " No rollback target was returned.", inventory: lifecycleOpenInventory(null) };
      lifecycleRetainLock();
    }
  } else if (lifecycleReturnedExisting >= 0) {
    var lifecycleExistingIndex = lifecycleIndexOf(lifecycleOpened);
    var lifecycleReturnedExistingMessage = null;
    try {
      if (lifecycleExistingIndex < 0) lifecycleReturnedExistingMessage = "app.open returned a pre-existing reference that is not in the collection.";
      else if (app.documents.length !== lifecycleCountBefore) lifecycleReturnedExistingMessage = "app.open returned a pre-existing reference but changed the document count.";
      else lifecycleReturnedExistingMessage = lifecycleExistingUnchanged(lifecycleBefore, null);
    } catch (returnedExistingVerifyError) {
      lifecycleReturnedExistingMessage = "Existing-document verification failed: " + lifecycleMessage(returnedExistingVerifyError);
    }
    if (lifecycleReturnedExistingMessage === null) {
      var lifecycleExistingIdentity = getDocumentIdentity(lifecycleOpened, lifecycleExistingIndex);
      result = { outcome: "returned_existing", document: lifecycleSummary(lifecycleExistingIdentity), index: lifecycleExistingIndex, inventory: lifecycleOpenInventory(null) };
    } else {
      result = { outcome: "verify_mismatch_no_rollback", message: lifecycleReturnedExistingMessage + " Nothing was closed.", inventory: lifecycleOpenInventory(null) };
      lifecycleRetainLock();
    }
  } else {
    var lifecycleVerifyMessage = null;
    var lifecycleOpenedIndex = lifecycleIndexOf(lifecycleOpened);
    var lifecycleContext = null;
    try {
      if (String(lifecycleOpened.typename) !== "Document") lifecycleVerifyMessage = "app.open returned a " + String(lifecycleOpened.typename) + ".";
      else if (app.documents.length !== lifecycleCountBefore + 1) lifecycleVerifyMessage = "The document count did not grow by exactly one.";
      else if (lifecycleOpenedIndex !== 0) lifecycleVerifyMessage = "The opened document is not at collection index 0.";
      else if (app.activeDocument !== lifecycleOpened) lifecycleVerifyMessage = "The opened document is not the active document.";
      else if (lifecyclePathOf(lifecycleOpened) !== params.path) lifecycleVerifyMessage = "The opened document does not report the requested path (" + lifecyclePathOf(lifecycleOpened) + ").";
      else if (lifecycleOpened.saved !== true) lifecycleVerifyMessage = "The opened document is not clean.";
      else {
        lifecycleVerifyMessage = lifecycleExistingUnchanged(lifecycleBefore, null);
        if (lifecycleVerifyMessage === null) {
          var lifecycleIdentity = getDocumentIdentity(lifecycleOpened, lifecycleOpenedIndex);
          lifecycleContext = getDocumentContext();
          if (lifecycleIdentity.fileExists !== true) lifecycleVerifyMessage = "The opened document does not report an existing file.";
          else if (lifecycleContext.key !== lifecycleIdentity.key) lifecycleVerifyMessage = "The opened document context does not match its identity.";
          else if (lifecycleContext.mutationProfile !== "saved_file") lifecycleVerifyMessage = "The opened document is not admitted as saved_file (" + String(lifecycleContext.mutationBlockedReason) + ").";
        }
      }
    } catch (verifyError) {
      lifecycleVerifyMessage = "Verification failed: " + lifecycleMessage(verifyError);
    }
    if (lifecycleVerifyMessage === null) {
      result = { outcome: "opened", document: lifecycleContext, inventory: lifecycleOpenInventory(lifecycleOpenedIndex) };
    } else if (lifecycleOpenedIndex < 0 || app.documents.length !== lifecycleCountBefore + 1) {
      // The returned object is not a newly added member of the collection: nothing this call can prove it created, so nothing is closed.
      result = { outcome: "verify_mismatch_no_rollback", message: lifecycleVerifyMessage + " The returned document could not be proven new, so nothing was closed.", inventory: lifecycleOpenInventory(lifecycleOpenedIndex < 0 ? null : lifecycleOpenedIndex) };
      lifecycleRetainLock();
    } else {
      var lifecycleRollbackMessage = null;
      try {
        lifecycleOpened.close(SaveOptions.DONOTSAVECHANGES);
      } catch (closeError) {
        lifecycleRollbackMessage = "close threw: " + lifecycleMessage(closeError);
      }
      lifecycleOpened = null;
      if (lifecycleRollbackMessage === null && app.documents.length !== lifecycleCountBefore) lifecycleRollbackMessage = "The document count was not restored after closing the opened document.";
      if (lifecycleRollbackMessage === null) lifecycleRollbackMessage = lifecycleExistingUnchanged(lifecycleBefore, null);
      var lifecycleRollbackInventory = lifecycleOpenInventory(lifecycleOpenedIndex < 0 ? null : lifecycleOpenedIndex);
      if (lifecycleRollbackMessage === null) result = { outcome: "rolled_back", reason: "verify_mismatch", message: lifecycleVerifyMessage, inventory: lifecycleRollbackInventory };
      else {
        result = { outcome: "rollback_failed", reason: "verify_mismatch", message: lifecycleVerifyMessage, rollbackMessage: lifecycleRollbackMessage, inventory: lifecycleRollbackInventory };
        lifecycleRetainLock();
      }
    }
  }
} finally {
  app.userInteractionLevel = lifecyclePreviousInteraction;
}
`;
export const SAVE_AS_SWITCH_SCRIPT = `
${LIFECYCLE_SHARED}
if (typeof params.stagedPath !== "string" || typeof params.outputPath !== "string") lifecycleError("LIFECYCLE_INVALID_INPUT", { message: "stagedPath and outputPath are required." });
var lifecycleContextBefore = resolveExpectedDocument(params.expectedDocumentKey);
var lifecycleDoc = app.activeDocument;
if (lifecyclePathOf(lifecycleDoc) !== params.stagedPath) lifecycleError("SWITCH_PRECONDITION", { message: "The document does not point at the staged file.", actual: lifecyclePathOf(lifecycleDoc) });
if (lifecycleDoc.saved !== true) lifecycleError("SWITCH_PRECONDITION", { message: "The document is not clean after save-as; it will not be closed." });
if (new File(params.outputPath).exists !== true) lifecycleError("SWITCH_PRECONDITION", { message: "The published output does not exist." });
var lifecycleBefore = lifecycleInventory();
// A closed Illustrator Document reference becomes invalid immediately. Capture the entries that must survive the
// switch while every reference is still valid, then never compare or pass lifecycleDoc after close().
var lifecycleExistingBefore = [];
for (var lifecycleExistingCursor = 0; lifecycleExistingCursor < lifecycleBefore.length; lifecycleExistingCursor++) {
  if (lifecycleBefore[lifecycleExistingCursor].doc !== lifecycleDoc) lifecycleExistingBefore.push(lifecycleBefore[lifecycleExistingCursor]);
}
var lifecycleCountBefore = app.documents.length;
for (var lifecycleScan = 0; lifecycleScan < lifecycleBefore.length; lifecycleScan++) {
  if (lifecyclePathOf(lifecycleBefore[lifecycleScan].doc) === params.outputPath) lifecycleError("SWITCH_PRECONDITION", { message: "A document already uses the output path." });
}
var lifecyclePreviousInteraction = app.userInteractionLevel;
var result;
app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
try {
  var lifecycleCloseError = null;
  try { lifecycleBeginSideEffect(); lifecycleDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (closeError) { lifecycleCloseError = lifecycleMessage(closeError); }
  lifecycleDoc = null;
  var lifecycleStillOpen = app.documents.length === lifecycleCountBefore;
  if (lifecycleCloseError !== null || app.documents.length !== lifecycleCountBefore - 1) {
    result = { outcome: "close_failed", message: lifecycleCloseError === null ? "The staged document did not leave the collection." : lifecycleCloseError, stillOpen: lifecycleStillOpen, documentCount: app.documents.length };
    lifecycleRetainLock();
  } else {
    var lifecycleOpened = null;
    var lifecycleOpenError = null;
    try { lifecycleOpened = app.open(new File(params.outputPath)); } catch (openError) { lifecycleOpenError = lifecycleMessage(openError); }
    if (lifecycleOpened === null || lifecycleOpened === undefined) {
      result = { outcome: "reopen_failed", message: lifecycleOpenError === null ? "app.open returned no document." : lifecycleOpenError, documentCount: app.documents.length };
      lifecycleRetainLock();
    } else {
      var lifecycleVerifyMessage = null;
      var lifecycleContext = null;
      var lifecycleOpenedIndex = lifecycleIndexOf(lifecycleOpened);
      try {
        for (var lifecycleRef = 0; lifecycleRef < lifecycleExistingBefore.length; lifecycleRef++) {
          if (lifecycleExistingBefore[lifecycleRef].doc === lifecycleOpened) lifecycleVerifyMessage = "app.open returned a pre-existing document.";
        }
        if (lifecycleVerifyMessage !== null) {}
        else if (app.documents.length !== lifecycleCountBefore) lifecycleVerifyMessage = "The document count was not restored after reopening the output.";
        else if (lifecycleOpenedIndex !== 0) lifecycleVerifyMessage = "The reopened document is not at collection index 0.";
        else if (app.activeDocument !== lifecycleOpened) lifecycleVerifyMessage = "The reopened document is not the active document.";
        else if (lifecyclePathOf(lifecycleOpened) !== params.outputPath) lifecycleVerifyMessage = "The reopened document does not report the output path (" + lifecyclePathOf(lifecycleOpened) + ").";
        else if (lifecycleOpened.saved !== true) lifecycleVerifyMessage = "The reopened document is not clean.";
        else {
          lifecycleVerifyMessage = lifecycleExistingUnchanged(lifecycleExistingBefore, null);
          if (lifecycleVerifyMessage === null) {
            lifecycleContext = getDocumentContext();
            if (lifecycleContext.path !== params.outputPath || lifecycleContext.mutationProfile !== "saved_file") lifecycleVerifyMessage = "The reopened document context is not admitted as saved_file at the output path.";
            else if (lifecycleContext.colorSpace !== lifecycleContextBefore.colorSpace || lifecycleContext.artboardCount !== lifecycleContextBefore.artboardCount) lifecycleVerifyMessage = "The reopened document differs from the saved one (color space or artboard count).";
          }
        }
      } catch (verifyError) {
        lifecycleVerifyMessage = "Verification failed: " + lifecycleMessage(verifyError);
      }
      if (lifecycleVerifyMessage !== null) {
        result = { outcome: "verify_mismatch", message: lifecycleVerifyMessage, document: lifecycleSafeContext(), documentCount: app.documents.length };
        lifecycleRetainLock();
      }
      else result = { outcome: "switched", document: lifecycleContext, documentIndex: lifecycleOpenedIndex, documentCount: app.documents.length };
    }
  }
} finally {
  app.userInteractionLevel = lifecyclePreviousInteraction;
}
`;
export const CLOSE_DOCUMENT_SCRIPT = `
${LIFECYCLE_SHARED}
var lifecycleContextBefore = resolveExpectedDocument(params.expectedDocumentKey);
var lifecycleDoc = app.activeDocument;
if (lifecycleDoc.saved !== true && params.discardChanges !== true) {
  lifecycleError("UNSAVED_CHANGES", { message: "The document has unsaved changes; pass discard_changes: true to close it without saving, or save it first." });
}
var lifecycleBefore = lifecycleInventory();
var lifecycleExistingBefore = [];
for (var lifecycleExistingCursor = 0; lifecycleExistingCursor < lifecycleBefore.length; lifecycleExistingCursor++) {
  if (lifecycleBefore[lifecycleExistingCursor].doc !== lifecycleDoc) lifecycleExistingBefore.push(lifecycleBefore[lifecycleExistingCursor]);
}
var lifecycleCountBefore = app.documents.length;
var lifecycleClosedSummary = {
  key: lifecycleContextBefore.key, keyShort: lifecycleContextBefore.keyShort, name: lifecycleContextBefore.name, path: lifecycleContextBefore.path,
  saved: lifecycleContextBefore.saved, fileRevision: lifecycleContextBefore.fileRevision, colorSpace: lifecycleContextBefore.colorSpace,
  discardedChanges: lifecycleContextBefore.saved !== true
};
var lifecyclePreviousInteraction = app.userInteractionLevel;
var lifecycleCloseError = null;
var result;
function lifecycleCloseInventory() {
  return { countBefore: lifecycleCountBefore, countAfter: app.documents.length, remaining: lifecycleExistingReport(lifecycleExistingBefore, null) };
}
app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
try {
  try {
    lifecycleBeginSideEffect();
    lifecycleDoc.close(SaveOptions.DONOTSAVECHANGES);
  } catch (closeError) {
    lifecycleCloseError = lifecycleMessage(closeError);
  }
  lifecycleDoc = null;
  if (lifecycleCloseError !== null) {
    result = { outcome: "close_failed", message: lifecycleCloseError, inventory: lifecycleCloseInventory() };
    lifecycleRetainLock();
  } else {
    var lifecycleVerifyMessage = null;
    var lifecycleActive = null;
    try {
      if (app.documents.length !== lifecycleCountBefore - 1) lifecycleVerifyMessage = "The document count did not shrink by exactly one.";
      else lifecycleVerifyMessage = lifecycleExistingUnchanged(lifecycleExistingBefore, null);
      if (lifecycleVerifyMessage === null && app.documents.length > 0) lifecycleActive = getDocumentContext();
    } catch (verifyError) {
      lifecycleVerifyMessage = "Verification failed: " + lifecycleMessage(verifyError);
    }
    if (lifecycleVerifyMessage !== null) {
      result = { outcome: "verify_mismatch", message: lifecycleVerifyMessage, inventory: lifecycleCloseInventory() };
      lifecycleRetainLock();
    }
    else result = { outcome: "closed", closed: lifecycleClosedSummary, inventory: lifecycleCloseInventory(), activeDocument: lifecycleActive };
  }
} finally {
  app.userInteractionLevel = lifecyclePreviousInteraction;
}
`;
export class LifecyclePreconditionError extends Error {
    reason;
    constructor(reason, message) {
        super(message);
        this.reason = reason;
        this.name = 'LifecyclePreconditionError';
    }
}
function describeError(error) {
    return error instanceof Error ? error.message : String(error);
}
function fileIdentityOf(metadata) {
    return { dev: metadata.dev, ino: metadata.ino, size: metadata.size, mtimeNs: metadata.mtimeNs, ctimeNs: metadata.ctimeNs };
}
export async function readFileFacts(path) {
    let handle;
    try {
        handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    }
    catch (error) {
        throw new LifecyclePreconditionError('file_unavailable', `The file could not be opened: ${describeError(error)}`);
    }
    try {
        const before = await handle.stat({ bigint: true });
        if (!before.isFile())
            throw new LifecyclePreconditionError('file_unavailable', 'The path is not a regular file.');
        if (before.size <= 0n)
            throw new LifecyclePreconditionError('file_unavailable', 'The file is empty.');
        if (before.size > MAX_HASHED_FILE_BYTES)
            throw new LifecyclePreconditionError('file_unavailable', 'The file is too large to verify.');
        const hash = createHash('sha256');
        const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
        let total = 0n;
        for (;;) {
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
            if (bytesRead === 0)
                break;
            hash.update(buffer.subarray(0, bytesRead));
            total += BigInt(bytesRead);
        }
        const after = await handle.stat({ bigint: true });
        const identity = fileIdentityOf(before);
        if (total !== before.size || !sameIdentity(identity, fileIdentityOf(after))) {
            throw new LifecyclePreconditionError('file_unavailable', 'The file changed while it was being read.');
        }
        return { path, bytes: Number(before.size), sha256: hash.digest('hex'), identity };
    }
    finally {
        await handle.close().catch(() => undefined);
    }
}
export function sameIdentity(left, right) {
    return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
export function serializeFileFacts(facts) {
    return { path: facts.path, bytes: facts.bytes, sha256: facts.sha256, identity: serializeFileIdentity(facts.identity) };
}
export function fileRevisionSize(revision) {
    if (revision === null)
        return null;
    const match = /^(\d+):(\d+)$/.exec(revision);
    return match ? Number(match[1]) : null;
}
export function keyWithoutIndex(key) {
    return key.replace(/\|index=-?\d+\|/, '|index=*|');
}
export async function validateOpenPath(input, stateRoot) {
    const invalid = (message) => new LifecyclePreconditionError('path_invalid', message);
    if (!isAbsolute(input))
        throw invalid('path must be an absolute path.');
    if (input !== resolve(input) || input.endsWith('/'))
        throw invalid('path must be a normalized file path.');
    if (extname(input).toLowerCase() !== '.ai')
        throw invalid('path must end with .ai; other formats are not supported by illustrator_open_document.');
    if (basename(input) === '.ai')
        throw invalid('path needs a file name before the extension.');
    let leaf;
    try {
        leaf = await lstat(input);
    }
    catch (error) {
        throw new LifecyclePreconditionError('source_file_unavailable', `The file could not be inspected: ${describeError(error)}`);
    }
    if (leaf.isSymbolicLink())
        throw invalid('path must not be a symbolic link.');
    if (!leaf.isFile())
        throw new LifecyclePreconditionError('source_file_unavailable', 'The path is not a regular file.');
    let real;
    try {
        real = await realpath(input);
    }
    catch (error) {
        throw new LifecyclePreconditionError('source_file_unavailable', `The file could not be resolved: ${describeError(error)}`);
    }
    let resolvedStateRoot = null;
    try {
        resolvedStateRoot = await realpath(stateRoot);
    }
    catch {
        resolvedStateRoot = null;
    }
    if (resolvedStateRoot !== null && (real === resolvedStateRoot || real.startsWith(`${resolvedStateRoot}/`))) {
        throw invalid('path must not be inside the MCP state root (backup and export work files are managed by their own tools).');
    }
    const facts = await readFileFacts(real).catch((error) => {
        throw new LifecyclePreconditionError('source_file_unavailable', describeError(error));
    });
    return { path: real, bytes: facts.bytes };
}
export class OutputLinkError extends Error {
    reason;
    constructor(reason, message) {
        super(message);
        this.reason = reason;
        this.name = 'OutputLinkError';
    }
}
export async function linkStagedToOutput(stagedPath, outputPath, expected, parentScope, options = {}) {
    const linkFile = options.linkImpl ?? link;
    const handle = await open(stagedPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const before = await handle.stat({ bigint: true });
        if (!before.isFile() || !sameIdentity(expected.identity, fileIdentityOf(before)) || before.nlink !== 1n) {
            throw new LifecyclePreconditionError('file_unavailable', `The staged file ${stagedPath} was replaced or modified before publication.`);
        }
        await parentScope.assertStable();
        try {
            await linkFile(stagedPath, outputPath);
        }
        catch (error) {
            const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
            if (code === 'EEXIST')
                throw new OutputLinkError('output_exists', `The output path already exists: ${outputPath}. Nothing was overwritten; the saved file remains at ${stagedPath} and the document still points there.`);
            if (code === 'EXDEV')
                throw new OutputLinkError('output_cross_device', `The output path is on a different device from its staging directory: ${describeError(error)}`);
            throw error;
        }
        await parentScope.sync();
        const linked = await handle.stat({ bigint: true });
        const published = await lstat(outputPath, { bigint: true });
        if (!published.isFile() || published.dev !== linked.dev || published.ino !== linked.ino || linked.nlink !== 2n) {
            throw new LifecyclePreconditionError('file_unavailable', 'The published output does not resolve to the verified staged inode.');
        }
        return fileIdentityOf(linked);
    }
    finally {
        await handle.close();
    }
}
export async function removeStagedFile(stagedPath, expected, parentScope) {
    let handle;
    try {
        handle = await open(stagedPath, constants.O_RDONLY | constants.O_NOFOLLOW);
        const before = await handle.stat({ bigint: true });
        if (!before.isFile() || before.dev !== expected.dev || before.ino !== expected.ino || before.nlink !== 2n)
            return false;
        await parentScope.assertStable();
        await unlink(stagedPath);
        const after = await handle.stat({ bigint: true });
        if (after.nlink !== 1n)
            return false;
        await rmdir(dirname(stagedPath));
        await parentScope.sync();
        return true;
    }
    catch {
        return false;
    }
    finally {
        await handle?.close().catch(() => undefined);
    }
}
export async function assertCanonicalDocumentPath(path) {
    let leaf;
    try {
        leaf = await lstat(path);
    }
    catch (error) {
        throw new LifecyclePreconditionError('source_file_unavailable', `The document file could not be inspected: ${describeError(error)}`);
    }
    if (leaf.isSymbolicLink() || !leaf.isFile())
        throw new LifecyclePreconditionError('document_not_admitted', 'The document path is not a regular file; a symbolic link is refused for in-place save.');
    let real;
    try {
        real = await realpath(path);
    }
    catch (error) {
        throw new LifecyclePreconditionError('source_file_unavailable', `The document file could not be resolved: ${describeError(error)}`);
    }
    if (real !== path)
        throw new LifecyclePreconditionError('document_not_admitted', `The document path resolves through a symbolic link (${real}); in-place save requires the canonical path.`);
}
export function withApplication(document, application) {
    const bounds = document.activeArtboardBounds;
    return { ...document, activeArtboardBounds: [bounds[0], bounds[1], bounds[2], bounds[3]], application };
}
