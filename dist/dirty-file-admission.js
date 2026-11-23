import { z } from 'zod';
import { hostPathForms } from './file-path.js';
import { BARRIER_READ_LIMIT, barrierPathCandidates } from './release-barrier.js';
import { SAVE_REFUSED_BARRIER_MESSAGE } from './unsaved-document-guidance.js';
export const DIRTY_FILE_ADMISSION_OPERATIONS = new Set([
    'set_text_style',
    'replace_point_text',
    'replace_text_range',
    'transform_object',
    'set_path_appearance',
    'insert_vertical_space',
    'scale_artwork',
    'apply_dataset',
    'create_dataset', 'update_dataset',
    'bind_variable',
]);
export async function buildDirtyFileAdmission(barriers, sessions, allowDirtyFile = false) {
    const listing = await barriers.prepare({ uncapped: true });
    const tooMany = listing.paths.length + (listing.global === null ? 0 : 1) > BARRIER_READ_LIMIT;
    const blocked = [];
    for (const record of listing.paths)
        blocked.push({ candidates: barrierPathCandidates(record.sourcePath), reason: 'release_barrier' });
    let sessionsReadable = true;
    try {
        for (const entry of await sessions.list()) {
            if (entry.read.state !== 'valid') {
                sessionsReadable = false;
                continue;
            }
            if (entry.read.record.state === 'closed')
                continue;
            blocked.push({
                candidates: barrierPathCandidates(entry.read.record.sourcePath),
                reason: entry.read.record.state === 'open' ? 'edit_session_open' : 'edit_session_suspended',
            });
        }
    }
    catch {
        sessionsReadable = false;
    }
    return { version: 1, invalid: listing.invalid !== null || tooMany || !sessionsReadable, global: listing.global !== null, allowDirtyFile, blocked };
}
export class SaveBarrierRefusedError extends Error {
    constructor() {
        super(SAVE_REFUSED_BARRIER_MESSAGE);
        this.name = 'SaveBarrierRefusedError';
    }
}
export async function saveBarrierRefusal(barriers, document, options) {
    if (barriers === null || document.saved || document.path === null)
        return null;
    const listing = options.prepare ? await barriers.prepare({ uncapped: true }) : await barriers.list({ uncapped: true });
    let invalid = listing.invalid !== null;
    const pathCandidates = options.pathCandidates ?? barrierPathCandidates;
    const candidates = pathCandidates(document.path);
    for (const record of listing.paths) {
        if (pathCandidates(record.sourcePath).some((candidate) => candidates.includes(candidate)))
            return SAVE_REFUSED_BARRIER_MESSAGE;
    }
    for (const form of hostPathForms(document.path)) {
        const read = await barriers.readByScope(form);
        if (read === 'invalid')
            invalid = true;
        else if (read !== null)
            return SAVE_REFUSED_BARRIER_MESSAGE;
    }
    if (options.ownPathOnly === true)
        return null;
    if (document.fileRevision === null || document.fileRevision === '')
        return null;
    const identity = options.sessionIdentity;
    if (identity?.state === 'proven' && identity.documentPath === document.path && identity.documentRevision === document.fileRevision &&
        identity.record.state === 'open' && identity.record.sourceFileRevision === document.fileRevision)
        return null;
    const global = await barriers.readByScope(null);
    if (invalid || global !== null || listing.global !== null)
        return SAVE_REFUSED_BARRIER_MESSAGE;
    return null;
}
export const documentAdmissionNoteSchema = z.strictObject({
    profile: z.enum(['dirty_file', 'unsaved_document']),
    verified: z.literal('declared_targets'),
    unchecked: z.literal('external_changes_outside_declared_targets'),
    note: z.string(),
});
export const UNSAVED_DOCUMENT_ADMISSION_NOTE = {
    profile: 'unsaved_document', verified: 'declared_targets', unchecked: 'external_changes_outside_declared_targets',
    note: 'This document has no readable saved-file revision and no edit-session integrity check. Only the declared targets are compared before and after the change; edits elsewhere and the history of the source file are not checked.',
};
export const DOCUMENT_ADMISSION_NOTE = {
    profile: 'dirty_file',
    verified: 'declared_targets',
    unchecked: 'external_changes_outside_declared_targets',
    note: 'This saved file has unsaved changes and no edit session. The change is checked against the before and after state of its declared targets only; '
        + 'edits made outside Illustrator or elsewhere in the document are not detected. Open an edit session from a clean file for stronger detection.',
};
export function documentAdmissionNote(response) {
    const outcome = typeof response === 'object' && response !== null ? response.outcome : undefined;
    const document = typeof outcome === 'object' && outcome !== null ? outcome.document : undefined;
    const profile = typeof document === 'object' && document !== null ? document.mutationProfile : undefined;
    return profile === 'dirty_file' ? DOCUMENT_ADMISSION_NOTE : profile === 'unsaved_document' ? UNSAVED_DOCUMENT_ADMISSION_NOTE : null;
}
