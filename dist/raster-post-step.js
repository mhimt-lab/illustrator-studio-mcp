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
        next_steps: [...RASTER_MISMATCH_NEXT_STEPS],
    };
}
