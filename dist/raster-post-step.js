import { DocumentMismatchError } from './domain.js';
export const RASTER_DOCUMENT_CHANGED = {
    status: 'not_run', reason: 'document_changed',
    detail: 'The document is no longer the one the symbol was created in (it was saved or changed since), so the created group cannot be located safely; no decode is claimed.',
};
export const RASTER_MISMATCH_NEXT_STEPS = [
    'Do not use this symbol. Save the document (the group UUID changes on save; find the group again by its name with illustrator_list_objects).',
    'Create a backup with illustrator_create_backup, then plan the removal with illustrator_delete_objects (target_uuids = the group, backup_id) and apply its next_call.',
    'Report the decode detail above; geometry and decode evidence are not a certification.',
];
export const RASTER_MISMATCH_SESSION_NEXT_STEPS = [
    'Do not save this document: the symbol is part of the edit session head, so a save would write it to the file. The file on disk is still the baseline until a save.',
    'There is no way to remove it inside the session. Close the edit session (illustrator_close_edit_session, session_id from illustrator_get_edit_session, the same value as confirm_session_id), close the document without saving (illustrator_close_document with discard_changes true), then reopen the saved file (illustrator_open_document). Every unsaved change of the session is lost; repeat the other changes afterwards. On Windows, edit-session changes are unmeasured and illustrator_close_document refuses a document backed by a file: close it in Illustrator yourself.',
    'Report the decode detail above; geometry and decode evidence are not a certification.',
];
export function appliedInEditSession(mutationProfile) {
    return mutationProfile === 'edit_session_file';
}
export async function readRasterAfterApply(group, read, documentChanged) {
    try {
        return await read(group.readInput);
    }
    catch (error) {
        if (!(error instanceof DocumentMismatchError))
            throw error;
        return documentChanged;
    }
}
export function rasterMismatchReport(args) {
    return {
        code: args.code,
        message: args.message,
        group: { uuid: args.group.groupUuid, name: args.group.groupName, document_key: args.group.documentKey },
        decode: args.raster,
        next_steps: [...(args.inEditSession === true ? RASTER_MISMATCH_SESSION_NEXT_STEPS : RASTER_MISMATCH_NEXT_STEPS)],
    };
}
