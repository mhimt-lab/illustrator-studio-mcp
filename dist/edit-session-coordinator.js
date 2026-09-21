import { lstat } from 'node:fs/promises';
import { z } from 'zod';
import { aggregateItemCount, advanceItemAggregate, decideEditSessionAdmission, EditSessionRecordError, } from './edit-session.js';
import { isMissingPath } from './private-state.js';
const digestSchema = z.string().regex(/^[0-9a-f]{16}$/u);
const rowSchema = z.strictObject({ uuid: z.string().min(1), hash: digestSchema });
const structureSchema = z.strictObject({
    digest: digestSchema,
    itemCount: z.number().int().nonnegative().nullable(),
    layerCount: z.number().int().nonnegative(),
    sublayerCount: z.number().int().nonnegative(),
});
export const editSessionEvidenceSchema = z.strictObject({
    evidenceVersion: z.literal(2),
    sessionId: z.string().regex(/^es_[0-9a-f]{32}$/u),
    sequence: z.number().int().nonnegative(),
    fileRevision: z.string().min(1),
    hostProfile: z.enum(['foreground_unlocked', 'background', 'locked', 'unknown']),
    beforeStructure: structureSchema,
    beforeUuids: z.array(z.string().min(1)),
    beforeRows: z.array(rowSchema),
    beforeLayerRows: z.array(z.string().regex(/^[0-9a-f]{16}$/u)),
    outcome: z.enum(['pending', 'verified', 'rolled_back', 'not_applied', 'indeterminate', 'rollback_failed', 'rollback_indeterminate', 'evidence_unavailable']),
    afterStructure: structureSchema.nullable(),
    afterRows: z.array(rowSchema).nullable(),
    afterLayerRows: z.array(z.string().regex(/^[0-9a-f]{16}$/u)).nullable(),
    afterMissing: z.array(z.string()).nullable(),
    timing: z.strictObject({ admissionMs: z.number(), beforeRowsMs: z.number(), beforeLayerRowsMs: z.number(), afterMs: z.number().nullable() }),
});
export class EditSessionRecordInvalidError extends Error {
    entries;
    code = 'EDIT_SESSION_RECORD_INVALID';
    constructor(entries) {
        super(`Edit session record${entries.length === 1 ? '' : 's'} ${entries.map((entry) => `${entry.name} (${entry.reason})`).join(', ')} ` +
            'cannot be read, so no mutation can be bound to or kept apart from its session. Inspect it with illustrator_get_edit_session ' +
            'and quarantine it with illustrator_close_edit_session action=quarantine before another mutation.');
        this.entries = entries;
        this.name = 'EditSessionRecordInvalidError';
    }
}
async function defaultInodeOf(path) {
    try {
        const metadata = await lstat(path, { bigint: true });
        if (!metadata.isFile())
            return null;
        return { dev: metadata.dev.toString(), ino: metadata.ino.toString() };
    }
    catch (error) {
        if (isMissingPath(error))
            return null;
        throw error;
    }
}
function sameRows(left, right) {
    const key = (rows) => rows.map((row) => `${row.uuid}\u0000${row.hash}`).sort().join('\n');
    return left.length === right.length && key(left) === key(right);
}
function parseHostError(message) {
    if (message === null)
        return null;
    const raw = message.startsWith('MCP_ERROR:') ? message.slice('MCP_ERROR:'.length) : message;
    try {
        const value = JSON.parse(raw);
        return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
    }
    catch {
        return null;
    }
}
export class EditSessionCoordinator {
    store;
    inodeOf;
    constructor(store, options = {}) {
        this.store = store;
        this.inodeOf = options.inodeOf ?? defaultInodeOf;
    }
    async hasRecords() {
        return (await this.store.list()).some((entry) => entry.read.state !== 'valid' || entry.read.record.state !== 'closed');
    }
    async admissionInput(hostProfile, options) {
        const entries = await this.store.list();
        const invalid = entries.flatMap((entry) => entry.read.state === 'invalid' ? [{ name: entry.name, reason: entry.read.reason }] : []);
        if (invalid.length > 0 && options.strict)
            throw new EditSessionRecordInvalidError(invalid);
        const sessions = [];
        for (const entry of entries) {
            if (entry.read.state !== 'valid' || entry.read.record.state !== 'open')
                continue;
            const record = entry.read.record;
            const inode = await this.inodeOf(record.sourcePath);
            if (inode === null || inode.dev !== record.sourceInode.dev || inode.ino !== record.sourceInode.ino) {
                await this.store.suspend(record.sessionId, 'file_changed');
                continue;
            }
            sessions.push({
                sessionId: record.sessionId,
                sourcePath: record.sourcePath,
                sourceFileRevision: record.sourceFileRevision,
                structureDigest: record.head.structureDigest,
                sequence: record.head.sequence,
                itemTotal: aggregateItemCount(record.head.itemAggregate),
            });
        }
        if (sessions.length === 0)
            return undefined;
        return { hostProfile: await hostProfile(), sessions };
    }
    async attested(context) {
        let envelope;
        try {
            envelope = JSON.parse(context.resultText);
        }
        catch {
            return;
        }
        if (typeof envelope !== 'object' || envelope === null || !('editSession' in envelope))
            return;
        const parsed = editSessionEvidenceSchema.safeParse(envelope.editSession);
        if (!parsed.success) {
            await this.suspendAllOpen('chain_evidence_missing');
            return;
        }
        const evidence = parsed.data;
        const read = await this.store.read(evidence.sessionId);
        if (read.state !== 'valid' || read.record.state !== 'open')
            return;
        const record = read.record;
        if (record.head.sequence > evidence.sequence) {
            if (record.head.sequence === evidence.sequence + 1 && record.head.commandId !== context.commandId) {
                await this.store.suspend(record.sessionId, 'chain_evidence_missing');
            }
            return;
        }
        if (record.head.sequence < evidence.sequence) {
            await this.store.suspend(record.sessionId, 'chain_evidence_missing');
            return;
        }
        const decision = decideEditSessionAdmission(read, {
            sourcePath: record.sourcePath,
            sourceInode: record.sourceInode,
            sourceFileRevision: evidence.fileRevision,
            structure: { ...evidence.beforeStructure, durationMs: 0 },
            hostProfile: evidence.hostProfile,
        });
        if (decision.outcome !== 'admit') {
            await this.store.suspend(record.sessionId, decision.outcome === 'suspend' ? decision.reason : 'chain_evidence_missing');
            return;
        }
        const next = this.nextHead(record, context.terminalState, evidence);
        if (next === 'unchanged')
            return;
        if (next === null) {
            await this.store.suspend(record.sessionId, context.terminalState === 'verified' || context.terminalState === 'rolled_back'
                ? 'chain_evidence_missing' : 'indeterminate');
            return;
        }
        await this.store.advanceHead(record.sessionId, {
            expectedSequence: record.head.sequence,
            commandId: context.commandId,
            structureDigest: next.structureDigest,
            itemAggregate: next.itemAggregate,
        });
    }
    nextHead(record, terminalState, evidence) {
        const declared = [...evidence.beforeUuids].sort().join('\n');
        if (declared !== evidence.beforeRows.map((row) => row.uuid).sort().join('\n'))
            return null;
        if (terminalState === 'apply_failed')
            return evidence.outcome === 'not_applied' ? 'unchanged' : null;
        if (terminalState === 'rolled_back') {
            return evidence.outcome === 'rolled_back' && evidence.afterStructure?.digest === evidence.beforeStructure.digest &&
                evidence.afterMissing?.length === 0 && evidence.afterRows !== null && sameRows(evidence.afterRows, evidence.beforeRows) &&
                evidence.afterLayerRows !== null && [...evidence.afterLayerRows].sort().join() === [...evidence.beforeLayerRows].sort().join()
                ? 'unchanged' : null;
        }
        if (terminalState !== 'verified' || evidence.outcome !== 'verified' || evidence.afterStructure === null ||
            evidence.afterRows === null || evidence.afterLayerRows === null || evidence.afterMissing === null ||
            evidence.afterMissing.length > 0)
            return null;
        try {
            return {
                structureDigest: evidence.afterStructure.digest,
                itemAggregate: advanceItemAggregate(record.head.itemAggregate, [...evidence.beforeRows.map((row) => row.hash), ...evidence.beforeLayerRows], [...evidence.afterRows.map((row) => row.hash), ...evidence.afterLayerRows]),
            };
        }
        catch (error) {
            if (error instanceof EditSessionRecordError)
                return null;
            throw error;
        }
    }
    async provenPreApplyFailure(context) {
        const detail = parseHostError(context.message);
        if (detail === null || typeof detail.sessionId !== 'string')
            return;
        const reason = detail.code === 'EDIT_SESSION_FILE_CHANGED' ? 'file_changed'
            : detail.code === 'EDIT_SESSION_STRUCTURE_CHANGED' ? 'structure_changed' : null;
        if (reason === null)
            return;
        let read;
        try {
            read = await this.store.read(detail.sessionId);
        }
        catch (error) {
            if (error instanceof EditSessionRecordError)
                return;
            throw error;
        }
        if (read.state === 'valid' && read.record.state === 'open')
            await this.store.suspend(read.record.sessionId, reason);
    }
    async unresolved(context) {
        await this.suspendAllOpen(context.reason);
    }
    async suspendAllOpen(reason) {
        for (const entry of await this.store.list()) {
            if (entry.read.state === 'valid' && entry.read.record.state === 'open')
                await this.store.suspend(entry.read.record.sessionId, reason);
        }
    }
}
