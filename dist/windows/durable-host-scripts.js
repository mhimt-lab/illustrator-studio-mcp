import { BACKUP_CLOSE_RESTORE_TEST_SCRIPT, BACKUP_INVENTORY_SCRIPT, BACKUP_OPEN_RESTORE_TEST_SCRIPT, BACKUP_PATH_FORMS_JSX, BACKUP_RECONCILE_CLOSE_SCRIPT, } from '../document-backup.js';
import { EXPORT_CLOSE_WORK_COPY_SCRIPT, EXPORT_INVENTORY_SCRIPT, EXPORT_OPEN_WORK_COPY_SCRIPT, EXPORT_READ_SOURCE_SCRIPT, EXPORT_RECONCILE_CLOSE_SCRIPT, EXPORT_SAVE_OUTPUT_SCRIPT, } from '../document-export.js';
import { SAVE_AS_SWITCH_SCRIPT, SAVE_DOCUMENT_AS_SCRIPT, SAVE_DOCUMENT_SCRIPT } from '../document-lifecycle.js';
import { HOST_FILE_PATH_HELPERS } from '../file-path.js';
import { PDF_EXPORT_SAVE_PRESERVE_SCRIPT, PDF_EXPORT_SAVE_SCRIPT } from '../pdf-export.js';
import { RASTER_EXACT_EXPORT_EXCLUDING_SCRIPT, RASTER_EXACT_EXPORT_SCRIPT, RASTER_EXPORT_EXCLUDING_SCRIPT, RASTER_EXPORT_SCRIPT, RASTER_READ_SOURCE_LAYERS_SCRIPT, RASTER_READ_SOURCE_SCRIPT, RASTER_RECONCILE_CLOSE_SCRIPT, } from '../raster-export.js';
import { RASTER_BATCH_EXPORT_EXCLUDING_SCRIPT, RASTER_BATCH_EXPORT_SCRIPT } from '../raster-batch-export.js';
function replaceOnce(source, anchor, replacement, label) {
    const parts = source.split(anchor);
    if (parts.length !== 2) {
        throw new Error(`Windows host script derivation: ${label} must occur exactly once in the macOS script (found ${parts.length - 1}).`);
    }
    return parts.join(replacement);
}
export const MACOS_HOST_FILE_PATH_MATCHES = `function hostFilePathMatches(actual, expected) {
  if (actual === expected) return true;
  var forms = params.hostFilePathForms;
  if (!forms || !Object.prototype.hasOwnProperty.call(forms, expected)) return false;
  var candidates = forms[expected];
  for (var pathFormIndex = 0; pathFormIndex < candidates.length; pathFormIndex++) {
    if (actual === candidates[pathFormIndex]) return true;
  }
  return false;
}`;
export const WINDOWS_HOST_FILE_PATH_MATCHES = `function hostFilePathMatches(actual, expected) {
  if (actual === expected) return true;
  if (typeof actual !== "string" || typeof expected !== "string") return false;
  return actual.toLowerCase() === expected.toLowerCase();
}`;
export const WINDOWS_HOST_FILE_PATH_HELPERS = replaceOnce(HOST_FILE_PATH_HELPERS, MACOS_HOST_FILE_PATH_MATCHES, WINDOWS_HOST_FILE_PATH_MATCHES, 'hostFilePathMatches in HOST_FILE_PATH_HELPERS');
export function windowsHostPathVariant(macosScript) {
    return replaceOnce(macosScript, HOST_FILE_PATH_HELPERS, WINDOWS_HOST_FILE_PATH_HELPERS, 'HOST_FILE_PATH_HELPERS');
}
export const MACOS_BACKUP_PATH_IS_REPORTED = `function backupPathIsReported(path, forms) {
  for (var backupFormIndex = 0; backupFormIndex < forms.length; backupFormIndex++) {
    if (path === forms[backupFormIndex]) return true;
  }
  return false;
}`;
export const WINDOWS_BACKUP_PATH_IS_REPORTED = `function backupPathIsReported(path, forms) {
  if (typeof path !== "string") return false;
  var backupLowerPath = path.toLowerCase();
  for (var backupFormIndex = 0; backupFormIndex < forms.length; backupFormIndex++) {
    if (backupLowerPath === String(forms[backupFormIndex]).toLowerCase()) return true;
  }
  return false;
}
function backupSamePath(left, right) {
  return typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();
}`;
export const WINDOWS_BACKUP_PATH_FORMS_JSX = replaceOnce(BACKUP_PATH_FORMS_JSX, MACOS_BACKUP_PATH_IS_REPORTED, WINDOWS_BACKUP_PATH_IS_REPORTED, 'backupPathIsReported in BACKUP_PATH_FORMS_JSX');
function windowsBackupVariant(macosScript) {
    return replaceOnce(macosScript, BACKUP_PATH_FORMS_JSX, WINDOWS_BACKUP_PATH_FORMS_JSX, 'BACKUP_PATH_FORMS_JSX');
}
export const MACOS_BACKUP_SOURCE_PATH_TEST = 'if (backupCandidateIdentity.path === params.sourcePath) {';
export const WINDOWS_BACKUP_SOURCE_PATH_TEST = 'if (backupSamePath(backupCandidateIdentity.path, params.sourcePath)) {';
export const MACOS_REVISION_CHANGED_CHECK = `        } else if (lifecycleAfterContext.fileRevision === lifecyclePrevious.fileRevision) {
          lifecycleVerifyMessage = "The file revision did not change after save.";
        }`;
export const WINDOWS_REVISION_UNCHANGED_NOTE = `        } else if (lifecycleAfterContext.fileRevision === lifecyclePrevious.fileRevision) {
          lifecycleRevisionUnchanged = true;
        }`;
export const MACOS_MENU_SAVE_CALL = `        if (app.activeDocument !== lifecycleDoc) throw new Error("The document to save is not the active document.");
        app.executeMenuCommand("save");`;
export const WINDOWS_DOC_SAVE_CALL = '        lifecycleDoc.save();';
function windowsSaveDocumentScript() {
    let script = windowsHostPathVariant(SAVE_DOCUMENT_SCRIPT);
    script = replaceOnce(script, MACOS_MENU_SAVE_CALL, WINDOWS_DOC_SAVE_CALL, 'the menu save call of the save script');
    script = replaceOnce(script, 'var lifecycleSaveMs = 0;\n', 'var lifecycleSaveMs = 0;\nvar lifecycleRevisionUnchanged = false;\n', 'the lifecycleSaveMs declaration');
    script = replaceOnce(script, MACOS_REVISION_CHANGED_CHECK, WINDOWS_REVISION_UNCHANGED_NOTE, 'the revision-changed check of the save script');
    script = replaceOnce(script, 'else result = { outcome: "saved", document: lifecycleAfterContext, previous: lifecyclePrevious, editSessionCheck: lifecycleSessionCheck };', 'else result = { outcome: "saved", document: lifecycleAfterContext, previous: lifecyclePrevious, editSessionCheck: lifecycleSessionCheck, revisionUnchanged: lifecycleRevisionUnchanged };', 'the saved result of the save script');
    return script;
}
export const WINDOWS_SAVE_DOCUMENT_SCRIPT = windowsSaveDocumentScript();
export const WINDOWS_SAVE_DOCUMENT_AS_SCRIPT = windowsHostPathVariant(SAVE_DOCUMENT_AS_SCRIPT);
export const WINDOWS_SAVE_AS_SWITCH_SCRIPT = windowsHostPathVariant(SAVE_AS_SWITCH_SCRIPT);
export const WINDOWS_BACKUP_OPEN_RESTORE_TEST_SCRIPT = windowsBackupVariant(BACKUP_OPEN_RESTORE_TEST_SCRIPT);
export const WINDOWS_BACKUP_CLOSE_RESTORE_TEST_SCRIPT = replaceOnce(windowsBackupVariant(BACKUP_CLOSE_RESTORE_TEST_SCRIPT), MACOS_BACKUP_SOURCE_PATH_TEST, WINDOWS_BACKUP_SOURCE_PATH_TEST, 'the source path test of the close script');
export const WINDOWS_BACKUP_INVENTORY_SCRIPT = windowsBackupVariant(BACKUP_INVENTORY_SCRIPT);
export const WINDOWS_BACKUP_RECONCILE_CLOSE_SCRIPT = windowsBackupVariant(BACKUP_RECONCILE_CLOSE_SCRIPT);
const WINDOWS_DURABLE_HOST_SCRIPTS = new Map([
    [SAVE_DOCUMENT_SCRIPT, WINDOWS_SAVE_DOCUMENT_SCRIPT],
    [BACKUP_OPEN_RESTORE_TEST_SCRIPT, WINDOWS_BACKUP_OPEN_RESTORE_TEST_SCRIPT],
    [BACKUP_CLOSE_RESTORE_TEST_SCRIPT, WINDOWS_BACKUP_CLOSE_RESTORE_TEST_SCRIPT],
    [BACKUP_INVENTORY_SCRIPT, WINDOWS_BACKUP_INVENTORY_SCRIPT],
    [BACKUP_RECONCILE_CLOSE_SCRIPT, WINDOWS_BACKUP_RECONCILE_CLOSE_SCRIPT],
]);
export function windowsDurableHostScript(macosScript) {
    const variant = WINDOWS_DURABLE_HOST_SCRIPTS.get(macosScript);
    if (variant === undefined)
        throw new Error('No Windows variant of this durable host script is available yet.');
    return variant;
}
export const WINDOWS_EXPORT_HOST_SCRIPTS = Object.freeze({
    readSource: windowsHostPathVariant(EXPORT_READ_SOURCE_SCRIPT),
    openWorkCopy: windowsHostPathVariant(EXPORT_OPEN_WORK_COPY_SCRIPT),
    saveOutput: windowsHostPathVariant(EXPORT_SAVE_OUTPUT_SCRIPT),
    closeWorkCopy: windowsHostPathVariant(EXPORT_CLOSE_WORK_COPY_SCRIPT),
    inventory: windowsHostPathVariant(EXPORT_INVENTORY_SCRIPT),
    reconcileClose: windowsHostPathVariant(EXPORT_RECONCILE_CLOSE_SCRIPT),
    pdfSave: windowsHostPathVariant(PDF_EXPORT_SAVE_SCRIPT),
    pdfSavePreserve: windowsHostPathVariant(PDF_EXPORT_SAVE_PRESERVE_SCRIPT),
    rasterReadSource: windowsHostPathVariant(RASTER_READ_SOURCE_SCRIPT),
    rasterReadSourceLayers: windowsHostPathVariant(RASTER_READ_SOURCE_LAYERS_SCRIPT),
    rasterExport: windowsHostPathVariant(RASTER_EXPORT_SCRIPT),
    rasterExactExport: windowsHostPathVariant(RASTER_EXACT_EXPORT_SCRIPT),
    rasterExportExcluding: windowsHostPathVariant(RASTER_EXPORT_EXCLUDING_SCRIPT),
    rasterExactExportExcluding: windowsHostPathVariant(RASTER_EXACT_EXPORT_EXCLUDING_SCRIPT),
    rasterReconcileClose: windowsHostPathVariant(RASTER_RECONCILE_CLOSE_SCRIPT),
    rasterBatchExport: windowsHostPathVariant(RASTER_BATCH_EXPORT_SCRIPT),
    rasterBatchExportExcluding: windowsHostPathVariant(RASTER_BATCH_EXPORT_EXCLUDING_SCRIPT),
});
