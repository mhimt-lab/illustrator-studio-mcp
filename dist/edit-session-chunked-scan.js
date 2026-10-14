import { lstat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { documentKeyMatches } from './document-key.js';
import { sameFilePath } from './file-path.js';
import { editSessionStructureSchema } from './edit-session.js';
import { documentContextSchema } from './mutation-result-schema-core.js';
export { EDIT_SESSION_CHUNKED_MAX_ITEMS } from './edit-session.js';
export const EDIT_SESSION_CHUNK_BUDGET_MS = 10_000;
export const EDIT_SESSION_CHUNK_DEADLINE_MS = 20_000;
export const EDIT_SESSION_CHUNK_TIMEOUT_MS = 30_000;
export const EDIT_SESSION_CHUNKED_MAX_TOTAL_MS = 20 * 60_000;
export const EDIT_SESSION_CHUNK_MAX_CALLS = 200;
export const EDIT_SESSION_SCAN_TOOL_WALL_MS = 40_000;
export const EDIT_SESSION_SCAN_IDLE_MS = 10 * 60_000;
export const EDIT_SESSION_SCAN_MARGIN_MS = 2_000;
export const DEFAULT_EDIT_SESSION_SCAN_TIMING = Object.freeze({
    budgetMs: EDIT_SESSION_CHUNK_BUDGET_MS, deadlineMs: EDIT_SESSION_CHUNK_DEADLINE_MS, toolWallMs: EDIT_SESSION_SCAN_TOOL_WALL_MS,
});
export function editSessionScanTiming(input) {
    const timing = { ...DEFAULT_EDIT_SESSION_SCAN_TIMING, ...input };
    if (!Object.values(timing).every(value => Number.isSafeInteger(value) && value > 0) ||
        timing.budgetMs > timing.deadlineMs || timing.deadlineMs >= EDIT_SESSION_CHUNK_TIMEOUT_MS ||
        timing.deadlineMs + EDIT_SESSION_SCAN_MARGIN_MS >= timing.toolWallMs) {
        throw new Error('Invalid edit session scan timing.');
    }
    return Object.freeze(timing);
}
export async function readEditSessionScanIdentity(path) {
    const metadata = await lstat(path, { bigint: true });
    if (!metadata.isFile() || metadata.size <= 0n)
        throw new Error('The scan path is not a nonempty regular file.');
    const { dev, ino, size, mtimeNs, ctimeNs } = metadata;
    return { dev, ino, size, mtimeNs, ctimeNs };
}
export const scanContinuationSchema = z.string().regex(/^esc_[0-9a-f]{64}$/u);
export const editSessionScanProgressSchema = z.strictObject({
    items: z.number().int().nonnegative(), total: z.number().int().nonnegative(), calls: z.number().int().nonnegative(),
    elapsedMs: z.number().nonnegative(), estimatedRemainingMs: z.number().nonnegative().nullable(),
});
const count = z.number().int().nonnegative();
const lane = count.max(4_294_967_295);
export const editSessionChunkCursorSchema = z.strictObject({
    phase: z.enum(['items', 'layer_order', 'done']), position: count,
    lo: z.strictObject({ layer: count, index: count, a: lane, b: lane, count: count.nullable() }),
});
export const editSessionChunkSchema = z.object({
    cursorIn: editSessionChunkCursorSchema, cursor: editSessionChunkCursorSchema, done: z.boolean(),
    rowsRead: count, loRead: count, rows: z.strictObject({ a: lane, b: lane, n: count }),
    missingUuid: count, unmeasured: count, total: count.nullable(), overLimit: z.boolean(), structureMismatch: z.boolean(),
    stopReason: z.enum(['budget', 'max_rows', 'deadline', 'reference_invalid', 'walk_incomplete', 'count_mismatch', 'layer_count_changed']).nullable(),
    structureStart: editSessionStructureSchema, structureEnd: editSessionStructureSchema.optional(),
    contextStart: documentContextSchema, contextEnd: documentContextSchema.optional(),
    skipMs: z.number().nonnegative(), rowMs: z.number().nonnegative(), loMs: z.number().nonnegative(), durationMs: z.number().nonnegative(),
});
export class EditSessionScanError extends Error {
    reason;
    constructor(reason) {
        super('The edit session scan stopped: ' + reason + '. No session was created; start again without scan_continuation.');
        this.reason = reason;
        this.name = 'EditSessionScanError';
    }
}
export class EditSessionNotSavedFileError extends Error {
    reason = 'not_saved_file';
    constructor() {
        super('The edit session was not opened: the bound document is not a clean saved file (it has unsaved changes, or no file). Nothing was written.');
        this.name = 'EditSessionNotSavedFileError';
    }
}
export const emptyEditSessionChunkCursor = () => ({ phase: 'items', position: 0, lo: { layer: 0, index: 0, a: 0, b: 0, count: null } });
export class EditSessionOpenScans {
    now;
    pending = new Map();
    constructor(now = Date.now) {
        this.now = now;
    }
    start(input) {
        const now = this.now();
        for (const [token, entry] of this.pending) {
            if (now - entry.lastActive >= EDIT_SESSION_SCAN_IDLE_MS || now - entry.scan.startedAt >= EDIT_SESSION_CHUNKED_MAX_TOTAL_MS)
                this.pending.delete(token);
        }
        if (input.scanContinuation !== undefined) {
            const entry = this.pending.get(input.scanContinuation);
            if (entry === undefined)
                throw new EditSessionScanError('scan_expired');
            this.pending.delete(input.scanContinuation);
            if (entry.scan.expectedDocumentKey !== input.expectedDocumentKey || entry.scan.backupId !== input.backupId) {
                throw new EditSessionScanError('scan_context_mismatch');
            }
            return entry.scan;
        }
        return { expectedDocumentKey: input.expectedDocumentKey, backupId: input.backupId, startedAt: now,
            backup: null, sourceIdentity: null, backupIdentity: null, structure: null, total: null, cursor: emptyEditSessionChunkCursor(),
            partial: { a: 0, b: 0, n: 0, visited: 0, missingUuid: 0, unmeasured: 0, durationMs: 0 }, calls: 0, stalls: 0, estimatedRemainingMs: null };
    }
    checkLimits(scan) {
        if (this.now() - scan.startedAt >= EDIT_SESSION_CHUNKED_MAX_TOTAL_MS)
            throw new EditSessionScanError('scan_time_limit');
        if (scan.calls >= EDIT_SESSION_CHUNK_MAX_CALLS)
            throw new EditSessionScanError('scan_call_limit');
    }
    accept(scan, chunk, saved = false) {
        if (chunk.structureMismatch)
            throw new EditSessionScanError('document_changed_during_scan');
        const start = chunk.contextStart;
        if (scan.save === undefined && scan.calls === 0 && start !== undefined && documentKeyMatches(scan.expectedDocumentKey, start.key) &&
            (!start.saved || start.mutationProfile !== 'saved_file'))
            throw new EditSessionNotSavedFileError();
        if (chunk.overLimit) {
            scan.total = chunk.total;
            throw new EditSessionScanError('document_too_large');
        }
        if (chunk.stopReason !== null && chunk.stopReason !== 'budget' && chunk.stopReason !== 'max_rows')
            throw new EditSessionScanError('scan_incomplete');
        const structure = scan.structure ?? chunk.structureStart;
        const sameStructure = (other) => other !== undefined &&
            other.digest === structure.digest && other.itemCount === structure.itemCount &&
            other.layerCount === structure.layerCount && other.sublayerCount === structure.sublayerCount;
        const contextMatches = (context) => context !== undefined &&
            (scan.save === undefined ? documentKeyMatches(scan.expectedDocumentKey, context.key) && context.saved && context.mutationProfile === 'saved_file'
                : context.key === scan.save.documentKey && !context.saved) &&
            context.fileRevision === scan.backup?.sourceFileRevision && context.path !== null && scan.backup !== null && sameFilePath(context.path, scan.backup.sourcePath);
        if (!sameStructure(chunk.structureStart) || !sameStructure(chunk.structureEnd) || !contextMatches(chunk.contextStart) ||
            !contextMatches(chunk.contextEnd) || chunk.total === null || chunk.total < (structure.itemCount ?? 0) || (scan.total !== null && chunk.total !== scan.total) ||
            !isDeepStrictEqual(chunk.cursorIn, scan.cursor) || chunk.cursor.position !== scan.cursor.position + chunk.rowsRead ||
            chunk.cursor.position > chunk.total || chunk.done !== (chunk.cursor.phase === 'done') ||
            chunk.rows.n !== chunk.rowsRead + chunk.cursor.lo.layer - scan.cursor.lo.layer ||
            chunk.cursor.lo.layer < scan.cursor.lo.layer ||
            (chunk.cursor.lo.layer === scan.cursor.lo.layer && chunk.cursor.lo.index < scan.cursor.lo.index) ||
            (scan.cursor.phase !== 'items' && chunk.cursor.phase === 'items') ||
            chunk.missingUuid > chunk.rowsRead || chunk.unmeasured > chunk.rowsRead) {
            throw new EditSessionScanError('document_changed_during_scan');
        }
        const stalls = !chunk.done && isDeepStrictEqual(chunk.cursor, scan.cursor) ? scan.stalls + 1 : 0;
        if (stalls >= 2)
            throw new EditSessionScanError('scan_no_progress');
        scan.structure = structure;
        scan.total = chunk.total;
        scan.stalls = stalls;
        scan.cursor = chunk.cursor;
        scan.calls++;
        scan.partial = { a: (scan.partial.a + chunk.rows.a) % 4_294_967_296, b: (scan.partial.b + chunk.rows.b) % 4_294_967_296,
            n: scan.partial.n + chunk.rows.n, visited: scan.partial.visited + chunk.rowsRead,
            missingUuid: scan.partial.missingUuid + chunk.missingUuid, unmeasured: scan.partial.unmeasured + chunk.unmeasured,
            durationMs: scan.partial.durationMs + chunk.durationMs };
        const elapsed = this.now() - scan.startedAt;
        if (!saved && elapsed >= EDIT_SESSION_CHUNKED_MAX_TOTAL_MS)
            throw new EditSessionScanError('scan_time_limit');
        if (!chunk.done && scan.calls === 2 && scan.partial.visited > 0) {
            scan.estimatedRemainingMs = Math.ceil((chunk.total - scan.partial.visited) * elapsed / scan.partial.visited);
            if (elapsed + scan.estimatedRemainingMs > EDIT_SESSION_CHUNKED_MAX_TOTAL_MS)
                throw new EditSessionScanError('scan_too_slow');
        }
        if (chunk.done && (scan.partial.visited !== chunk.total || scan.partial.n !== chunk.total + structure.layerCount)) {
            throw new EditSessionScanError('scan_incomplete');
        }
    }
    continue(scan) {
        this.checkLimits(scan);
        const token = 'esc_' + randomBytes(32).toString('hex');
        this.pending.set(token, { scan, lastActive: this.now() });
        return token;
    }
}
export function chunkedAggregateText(scan) {
    const hex = (value) => value.toString(16).padStart(8, '0');
    return hex(scan.partial.a) + hex(scan.partial.b) + ':' + scan.partial.n;
}
