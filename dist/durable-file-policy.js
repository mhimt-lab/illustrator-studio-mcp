import { backupFileName, copyFileExclusive, inspectSourceFile, removeRestoreTestFile, resolveBackupRoot, sameFileIdentity, sameFileOrSameBytes, sameFilePath, verifyTrackedFile, } from './document-backup.js';
import { createStagingDirectory, validateOutputPath, withOutputParentScope, } from './document-export.js';
import { assertCanonicalDocumentPath, readFileFacts, removeStagedFile } from './document-lifecycle.js';
import { assertSameFilePathIdentity } from './file-path-identity.js';
import { hostPathForms } from './file-path.js';
import { barrierPathCandidates } from './release-barrier.js';
export function noWarmUp() { }
export async function noOutputParentCheckpoint(_point, _scope, _extra) { }
export function noBackupRootRefusal(_requested) { return null; }
export function noBackupDigestReadHostOptions(_pageItems) { return {}; }
export const noStructureReadHostOptions = noBackupDigestReadHostOptions;
export async function noDocumentDirectoryCheck(_point, _documentPath) { }
export async function noDocumentSaveLocationCheck(_documentPath) { }
export function noSavedDocumentCloseRefusal() { return null; }
export function macosHostScript(macosScript) { return macosScript; }
export const DURABLE_FILE_POLICY_MEMBER_STEPS = {
    copyFileExclusive: 'step 1',
    readFileFacts: 'step 1',
    verifyTrackedFile: 'step 1',
    removeRestoreTestFile: 'step 1',
    removeStagedFile: 'step 1',
    sameFileIdentity: 'step 1',
    sameFileOrSameBytes: 'step 1',
    barrierPathCandidates: 'step 1',
    validateOutputPath: 'step 2',
    withOutputParentScope: 'step 2',
    createStagingDirectory: 'step 2',
    warmUp: 'step 2',
    checkOutputParentCheckpoint: 'step 2',
    inspectSourceFile: 'step 3',
    resolveBackupRoot: 'step 3',
    backupFileName: 'step 3',
    backupRootRefusal: 'step 3',
    backupDigestReadHostOptions: 'step 3',
    structureReadHostOptions: 'step 3',
    sameFilePath: 'step 3',
    assertSameFilePathIdentity: 'step 3',
    assertCanonicalDocumentPath: 'step 3',
    checkDocumentDirectory: 'step 3',
    checkDocumentSaveLocation: 'step 3',
    hostPathForms: 'step 3',
    durableHostScript: 'step 3',
    savedDocumentCloseRefusal: 'step 3',
};
export const DEFAULT_DURABLE_FILE_POLICY = Object.freeze({
    get copyFileExclusive() { return copyFileExclusive; },
    get readFileFacts() { return readFileFacts; },
    get verifyTrackedFile() { return verifyTrackedFile; },
    get removeRestoreTestFile() { return removeRestoreTestFile; },
    get removeStagedFile() { return removeStagedFile; },
    get sameFileIdentity() { return sameFileIdentity; },
    get sameFileOrSameBytes() { return sameFileOrSameBytes; },
    get barrierPathCandidates() { return barrierPathCandidates; },
    get validateOutputPath() { return validateOutputPath; },
    get withOutputParentScope() { return withOutputParentScope; },
    get createStagingDirectory() { return createStagingDirectory; },
    get warmUp() { return noWarmUp; },
    get checkOutputParentCheckpoint() { return noOutputParentCheckpoint; },
    get inspectSourceFile() { return inspectSourceFile; },
    get resolveBackupRoot() { return resolveBackupRoot; },
    get backupFileName() { return backupFileName; },
    get backupRootRefusal() { return noBackupRootRefusal; },
    get backupDigestReadHostOptions() { return noBackupDigestReadHostOptions; },
    get structureReadHostOptions() { return noStructureReadHostOptions; },
    get sameFilePath() { return sameFilePath; },
    get assertSameFilePathIdentity() { return assertSameFilePathIdentity; },
    get assertCanonicalDocumentPath() { return assertCanonicalDocumentPath; },
    get checkDocumentDirectory() { return noDocumentDirectoryCheck; },
    get checkDocumentSaveLocation() { return noDocumentSaveLocationCheck; },
    get hostPathForms() { return hostPathForms; },
    get durableHostScript() { return macosHostScript; },
    get savedDocumentCloseRefusal() { return noSavedDocumentCloseRefusal; },
});
