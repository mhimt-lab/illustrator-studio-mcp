import { z } from 'zod';
import { LARGE_DOCUMENT_WORKAROUND } from './document-backup.js';
import { EDIT_SESSION_CHUNK_JSX, EDIT_SESSION_JSX } from './edit-session-jsx.js';
import { EDIT_SESSION_MAX_ITEMS, EDIT_SESSION_CHUNKED_MAX_ITEMS, EDIT_SESSION_SCAN_DEADLINE_MS, editSessionScanSchema, editSessionStructureSchema, editSessionSuspendReasonSchema, } from './edit-session.js';
import { scanContinuationSchema } from './edit-session-chunked-scan.js';
import { USER_SAVED_SESSION_HINT } from './unsaved-document-guidance.js';
import { documentContextSchema } from './mutation-result-schema-core.js';
export const EDIT_SESSION_SUPPORT_PROFILE = 'An edit session is an occupancy declaration: while it is open, nobody else (a person, another app, another session) may edit the document. ' +
    'Only what the fingerprint covers is detected: a structural external change (items added or removed directly on a layer, layers, artboards, swatches, style names) is refused at the next change; ' +
    'an external change to an existing item\'s attributes, anything inside groups, clip groups or compound paths, the stacking order (on a layer or in a group) or a placed image\'s link ' +
    'is refused when saving, before anything is written. Above 3,000 items, chunked saves can miss attribute edits after their scan but before save; ask before accept_chunked_scan_window=true. ' +
    'Appearance stacks, graphic styles, symbols, embedded- and placed-image pixels, profiles and colorants, document settings and attributes after the first character ' +
    'of a text are NOT detected. The only restore point is the backup the session was opened with; restoring it loses every change made after it. Cap: 20,779 items including nested ones; production-copy P0 5/5 (30.8.2). ' +
    'Measured foreground/unlocked: up to 3,000 items on Illustrator 30.8.1; chunked-open P0: 2,900 synthetic RGB items on stable 30.8.2. Content under top-level layers: paths, text, groups, clip groups, compound paths, linked placed images, embedded RasterItems; ' +
    'no sublayers or other item types. delete_objects, embed_image, import_vector_artwork, update_artboard, create_trim_marks, create_barcode, create_qr_code and set_stroke_style are refused while a session is open.';
export const sessionIdSchema = z.string().regex(/^es_[0-9a-f]{32}$/u);
const headSchema = z.strictObject({
    structureDigest: z.string(),
    itemAggregate: z.string(),
    sequence: z.number().int().nonnegative(),
    commandId: z.string().nullable(),
});
export const editSessionSummarySchema = z.strictObject({
    sessionId: sessionIdSchema,
    state: z.enum(['open', 'suspended', 'closed']),
    suspendReason: editSessionSuspendReasonSchema.nullable(),
    sourcePath: z.string(),
    sourceFileRevision: z.string(),
    backupId: z.uuid(),
    head: headSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
});
export function summarizeEditSession(record) {
    return {
        sessionId: record.sessionId,
        state: record.state,
        suspendReason: record.suspendReason,
        sourcePath: record.sourcePath,
        sourceFileRevision: record.sourceFileRevision,
        backupId: record.backupId,
        head: { ...record.head },
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}
export const editSessionOpenRejectionSchema = z.enum([
    'backup_not_found', 'backup_invalid', 'document_key_mismatch', 'path_not_canonical', 'source_file_unavailable',
    'session_record_invalid', 'active_session_exists', 'not_saved_file', 'backup_mismatch', 'document_too_large',
    'unmeasured_content', 'unmeasured_host_state', 'scan_incomplete', 'session_suspended', 'session_closed',
    'document_changed_during_scan', 'scan_no_progress', 'scan_too_slow', 'scan_time_limit', 'scan_call_limit', 'scan_expired', 'scan_context_mismatch',
]);
export const openEditSessionResultSchema = z.discriminatedUnion('outcome', [
    z.strictObject({
        outcome: z.literal('opened'),
        session: editSessionSummarySchema,
        document: documentContextSchema,
        scan: z.strictObject({ items: z.number().int().nonnegative(), scanMs: z.number().nonnegative() }),
    }),
    z.strictObject({ outcome: z.literal('scan_in_progress'), scan_continuation: scanContinuationSchema,
        progress: z.strictObject({ items: z.number().int().nonnegative(), total: z.number().int().nonnegative(),
            calls: z.number().int().positive(), elapsedMs: z.number().nonnegative(), estimatedRemainingMs: z.number().nonnegative().nullable() }),
    }),
    z.strictObject({ outcome: z.literal('rejected'), reason: editSessionOpenRejectionSchema, message: z.string().min(1) }),
]);
export const closeEditSessionResultSchema = z.discriminatedUnion('outcome', [
    z.strictObject({ outcome: z.literal('closed'), session: editSessionSummarySchema }),
    z.strictObject({ outcome: z.literal('quarantined'), sessionId: sessionIdSchema }),
    z.strictObject({ outcome: z.literal('rejected'), reason: z.enum(['confirmation_mismatch', 'not_found', 'record_invalid', 'record_valid', 'not_quarantinable']), message: z.string().min(1) }),
]);
export const getEditSessionsResultSchema = z.strictObject({
    sessions: z.array(editSessionSummarySchema),
    invalid: z.array(z.strictObject({ name: z.string(), sessionId: sessionIdSchema.nullable(), reason: z.string() })),
});
export function listEditSessionsResult(entries) {
    return {
        sessions: entries.flatMap((entry) => entry.read.state === 'valid' ? [summarizeEditSession(entry.read.record)] : []),
        invalid: entries.flatMap((entry) => entry.read.state === 'invalid' ? [{ name: entry.name, sessionId: entry.sessionId, reason: entry.read.reason }] : []),
    };
}
export const EDIT_SESSION_OPEN_SCRIPT = `${EDIT_SESSION_JSX}
${EDIT_SESSION_CHUNK_JSX}
requireDocumentForRead(params.expectedDocumentKey);
var esDoc = app.activeDocument;
var result = stringifyJson(csChunk(esDoc, params.cursor, params.scanOptions));
`;
export const editSessionSnapshotSchema = z.object({
    structure: editSessionStructureSchema,
    structureStable: z.boolean(),
    scan: editSessionScanSchema,
    context: documentContextSchema,
});
export function editSessionTooLargeNote(counted) {
    return `${counted === null ? 'The document' : `The document has ${counted} items`}; an edit session admits at most ${EDIT_SESSION_CHUNKED_MAX_ITEMS}. ${LARGE_DOCUMENT_WORKAROUND}`;
}
export function saveSessionSuspension(outcome, check, headStructureDigest) {
    if (outcome !== 'edit_session_mismatch' || check === null)
        return null;
    return check.structureDigest !== headStructureDigest ? 'structure_changed' : 'item_aggregate_mismatch';
}
export const EDIT_SESSION_RESTART_HINT = 'Illustrator slows down after a long continuous run (hours to days): quit and reopen Illustrator, then run the same call again. Nothing was written.';
export const EDIT_SESSION_SLOW_HOST_HINT = `The full scan did not finish within ${EDIT_SESSION_SCAN_DEADLINE_MS / 1000} s. ` + EDIT_SESSION_RESTART_HINT;
export function editSessionScanIncompleteMessage(sessionId, check) {
    const reason = check.overLimit
        ? `the document holds more than ${EDIT_SESSION_MAX_ITEMS} items, the single-call save limit`
        : check.truncated
            ? `the full scan did not finish within ${EDIT_SESSION_SCAN_DEADLINE_MS / 1000} s (Illustrator may be slow after a long continuous run)`
            : `the full scan reached ${check.visited} of ${check.total ?? 'an unknown number of'} items`;
    return `Nothing was written: edit session ${sessionId} was not saved because ${reason}. The session is still open and unchanged, and its changes are still in the document. ` +
        (check.overLimit
            ? `For a session of at most ${EDIT_SESSION_CHUNKED_MAX_ITEMS} items, ask the user about the scan window, then pass accept_chunked_scan_window=true: an attribute edit to an already scanned item before save can be missed. Otherwise reduce the number of items, or close the session and save on your own judgement. `
            : 'Run illustrator_save_document again with the same backup_id. If Illustrator is slow, do NOT restart it before the changes are saved: a restart loses every unsaved change. ') +
        'The way out is illustrator_close_edit_session followed by a save under the backup contract (illustrator_save_document with the backup_id of a fresh illustrator_create_backup).';
}
export class EditSessionRefusedError extends Error {
    code;
    sessionId;
    constructor(code, sessionId) {
        super(`${code}: ${EDIT_SESSION_REFUSAL_MESSAGES[code] ?? 'The change was refused by the edit session.'} (session ${sessionId}; nothing was changed)`);
        this.code = code;
        this.sessionId = sessionId;
        this.name = 'EditSessionRefusedError';
    }
}
export const EDIT_SESSION_FOREGROUND_HINT = 'Bring Illustrator to the front (click its window, or run `open -b com.adobe.illustrator`), keep the screen unlocked, and run the same call again; nothing was changed.';
export const EDIT_SESSION_REFUSAL_MESSAGES = {
    EDIT_SESSION_FILE_CHANGED: `The file revision differs from the one the edit session was opened on (an external save or replacement); the session is suspended. ${USER_SAVED_SESSION_HINT}`,
    EDIT_SESSION_STRUCTURE_CHANGED: 'The document structure (items, layers, artboards, swatches or style names) changed outside the session; the session is suspended.',
    EDIT_SESSION_UNMEASURED_HOST_STATE: `Edit-session changes are measured only with Illustrator in the foreground and the screen unlocked. ${EDIT_SESSION_FOREGROUND_HINT}`,
    EDIT_SESSION_DOCUMENT_TOO_LARGE: `The document exceeds the measured edit-session limit of ${EDIT_SESSION_CHUNKED_MAX_ITEMS} items (nested items included). ${LARGE_DOCUMENT_WORKAROUND}`,
    EDIT_SESSION_UNMEASURED_CONTENT: 'The document now contains sublayers, which the edit session has not measured.',
    EDIT_SESSION_OPERATION_UNSUPPORTED: 'This operation cannot run on a document occupied by an edit session: delete_objects and embed_image recover by reopening the file (neither has an in-document undo), which would drop the session\'s changes, import_vector_artwork creates items that cannot be read back by uuid in the same call, update_artboard has no measured session origin and structure check, create_trim_marks, create_barcode and create_qr_code do not declare the items they change, and set_stroke_style works only in a never-saved document. Close the session (illustrator_close_edit_session) to use it.',
};
export function editSessionRefusal(message) {
    if (message === null)
        return null;
    const raw = message.startsWith('MCP_ERROR:') ? message.slice('MCP_ERROR:'.length) : message;
    let value;
    try {
        value = JSON.parse(raw);
    }
    catch {
        return null;
    }
    if (typeof value !== 'object' || value === null)
        return null;
    const { code, sessionId } = value;
    if (typeof code !== 'string' || !code.startsWith('EDIT_SESSION_') || typeof sessionId !== 'string')
        return null;
    return new EditSessionRefusedError(code, sessionId);
}
