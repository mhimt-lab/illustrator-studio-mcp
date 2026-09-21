import { z } from 'zod';
import { buildEditSessionSnapshotBody, EDIT_SESSION_JSX } from './edit-session-jsx.js';
import { EDIT_SESSION_MAX_ITEMS, EDIT_SESSION_SCAN_DEADLINE_MS, editSessionScanSchema, editSessionStructureSchema, editSessionSuspendReasonSchema, } from './edit-session.js';
import { documentContextSchema } from './mutation-result-schema-core.js';
export const EDIT_SESSION_SUPPORT_PROFILE = 'An edit session is an occupancy declaration: while it is open, nobody else (a person, another app, another session) may edit the document. ' +
    'Only what the fingerprint covers is detected: a structural external change (items added or removed directly on a layer, layers, artboards, swatches, style names) is refused at the next change; ' +
    'an external change to an existing item\'s attributes, anything inside groups, clip groups or compound paths, the stacking order (on a layer or in a group) or a placed image\'s link ' +
    'is refused when saving, before anything is written. Appearance stacks, graphic styles, symbols, placed-image pixels, document settings and attributes after the first character ' +
    'of a text are NOT detected. The only restore point is the backup the session was opened with; restoring it loses every change made after it. Measured envelope: Illustrator 30.8.1 ' +
    'foreground and unlocked, at most 2,000 items (nested ones included; in practice at most 1,000, the ceiling of the backup a session needs) that are paths, text, groups, clip groups, compound paths or linked placed images under top-level layers; ' +
    'no sublayers, embedded images or other item types. delete_objects, embed_image and import_vector_artwork are refused while a session is open.';
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
]);
export const openEditSessionResultSchema = z.discriminatedUnion('outcome', [
    z.strictObject({
        outcome: z.literal('opened'),
        session: editSessionSummarySchema,
        document: documentContextSchema,
        scan: z.strictObject({ items: z.number().int().nonnegative(), scanMs: z.number().nonnegative() }),
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
requireDocumentForRead(params.expectedDocumentKey);
var result = (function () {
${buildEditSessionSnapshotBody(EDIT_SESSION_SCAN_DEADLINE_MS, EDIT_SESSION_MAX_ITEMS)}
})();
`;
export const editSessionSnapshotSchema = z.object({
    structure: editSessionStructureSchema,
    structureStable: z.boolean(),
    scan: editSessionScanSchema,
    context: documentContextSchema,
});
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
    EDIT_SESSION_FILE_CHANGED: 'The file revision differs from the one the edit session was opened on (an external save or replacement); the session is suspended.',
    EDIT_SESSION_STRUCTURE_CHANGED: 'The document structure (items, layers, artboards, swatches or style names) changed outside the session; the session is suspended.',
    EDIT_SESSION_UNMEASURED_HOST_STATE: `Edit-session changes are measured only with Illustrator in the foreground and the screen unlocked. ${EDIT_SESSION_FOREGROUND_HINT}`,
    EDIT_SESSION_DOCUMENT_TOO_LARGE: `The document exceeds the measured edit-session limit of ${EDIT_SESSION_MAX_ITEMS} items (nested items included).`,
    EDIT_SESSION_UNMEASURED_CONTENT: 'The document now contains sublayers, which the edit session has not measured.',
    EDIT_SESSION_OPERATION_UNSUPPORTED: 'This operation cannot run on a document occupied by an edit session: delete_objects and embed_image recover by reopening the file (neither has an in-document undo), which would drop the session\'s changes, and import_vector_artwork creates items that cannot be read back by uuid in the same call. Close the session (illustrator_close_edit_session) to use it.',
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
