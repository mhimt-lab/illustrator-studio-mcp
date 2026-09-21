import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalCommandIdSchema } from './command-id.js';
import { canonicalSha256 } from './mutation-canonical.js';
import { atomicCreatePrivateRecord, readSecurePrivateRecord } from './private-record.js';
import { ensurePrivateDirectory, isMissingPath, validatePrivateDirectory, withPrivateDirectoryScope } from './private-state.js';
export const RECIPE_EXECUTION_AUTHORITY_VERSION = 1;
const DIRECTORY = 'recipe-executions';
const MAX_RECORD_BYTES = 262_144;
export const RECIPE_EXECUTION_PROTOCOL_STATES = [
    'open',
    'writing_batch',
    'closed_completed',
];
function codedError(message, code) {
    return Object.assign(new Error(message), { code });
}
function hasCode(error, code) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
function recordFileName(sequence, state) {
    return `${String(sequence).padStart(2, '0')}-${state}.json`;
}
function isDigest(value) {
    return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}
function recordBody(record) {
    return record;
}
function buildRecord(input) {
    const body = { version: RECIPE_EXECUTION_AUTHORITY_VERSION, ...input };
    return { ...body, recordDigest: canonicalSha256(recordBody(body)) };
}
function parseRecord(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return null;
    const record = value;
    if (Object.keys(record).sort().join(',') !==
        'commandId,evidence,executionDigest,previousRecordDigest,recordDigest,sequence,state,version' ||
        record.version !== RECIPE_EXECUTION_AUTHORITY_VERSION ||
        typeof record.commandId !== 'string' || !isDigest(record.executionDigest) ||
        !Number.isSafeInteger(record.sequence) || record.sequence < 0 ||
        typeof record.state !== 'string' ||
        ![...RECIPE_EXECUTION_PROTOCOL_STATES, 'closed_failed_pre_apply'].includes(record.state) ||
        !(record.previousRecordDigest === null || isDigest(record.previousRecordDigest)) ||
        !isDigest(record.recordDigest) || !('evidence' in record))
        return null;
    try {
        canonicalCommandIdSchema.parse(record.commandId);
        const expected = canonicalSha256(recordBody({
            version: RECIPE_EXECUTION_AUTHORITY_VERSION,
            commandId: record.commandId,
            executionDigest: record.executionDigest,
            sequence: record.sequence,
            state: record.state,
            previousRecordDigest: record.previousRecordDigest,
            evidence: record.evidence,
        }));
        if (expected !== record.recordDigest)
            return null;
    }
    catch (_error) {
        return null;
    }
    return record;
}
function allowedNextState(current, next) {
    if (current === null)
        return next === 'open';
    if (current === 'open')
        return next === 'writing_batch';
    return current === 'writing_batch' && (next === 'closed_completed' || next === 'closed_failed_pre_apply');
}
export class RecipeExecutionAuthorityStore {
    root;
    options;
    executionsRoot;
    constructor(root, options = {}) {
        this.root = root;
        this.options = options;
        this.executionsRoot = join(root, DIRECTORY);
    }
    executionDirectory(commandId) {
        canonicalCommandIdSchema.parse(commandId);
        return join(this.executionsRoot, commandId);
    }
    async begin(input) {
        canonicalCommandIdSchema.parse(input.commandId);
        if (!isDigest(input.executionDigest))
            throw new Error('Recipe execution digest must be SHA-256.');
        await ensurePrivateDirectory(this.root, 'state root');
        await ensurePrivateDirectory(this.executionsRoot, 'recipe executions directory');
        const directory = this.executionDirectory(input.commandId);
        let directoryCreated = false;
        try {
            await withPrivateDirectoryScope([
                { path: this.root, description: 'state root' },
                { path: this.executionsRoot, description: 'recipe executions directory' },
            ], async (scope) => {
                await mkdir(directory, { mode: 0o700 });
                directoryCreated = true;
                await scope.syncLeafParent();
            });
        }
        catch (error) {
            if (!hasCode(error, 'EEXIST'))
                throw error;
            await validatePrivateDirectory(directory, 0o700, 'recipe execution directory');
        }
        if (!directoryCreated) {
            const existing = await this.requireValid(input.commandId);
            this.requireInitialBinding(existing, input);
            return existing;
        }
        try {
            await this.appendRecord(input.commandId, input.executionDigest, 'open', input.binding, true);
        }
        catch (error) {
            throw codedError(`Recipe execution directory exists without a durable intent (${error instanceof Error ? error.message : String(error)}).`, 'RECIPE_EXECUTION_INDETERMINATE');
        }
        const inspection = await this.requireValid(input.commandId);
        try {
            this.requireInitialBinding(inspection, input);
        }
        catch (error) {
            if (hasCode(error, 'RECIPE_EXECUTION_CONFLICT'))
                throw error;
            throw codedError(`Recipe execution directory exists without a durable intent (${error instanceof Error ? error.message : String(error)}).`, 'RECIPE_EXECUTION_INDETERMINATE');
        }
        return inspection;
    }
    async append(commandId, executionDigest, state, evidence) {
        return await this.appendRecord(commandId, executionDigest, state, evidence, false);
    }
    requireInitialBinding(inspection, input) {
        if (inspection.records[0]?.executionDigest !== input.executionDigest ||
            canonicalSha256(inspection.records[0]?.evidence ?? null) !== canonicalSha256(input.binding)) {
            throw codedError('Recipe command ID is already bound to another execution.', 'RECIPE_EXECUTION_CONFLICT');
        }
    }
    async appendRecord(commandId, executionDigest, state, evidence, initialPublisher) {
        canonicalCommandIdSchema.parse(commandId);
        const before = await this.inspect(commandId);
        if (before.state === 'missing')
            throw codedError('Recipe execution authority is missing.', 'RECIPE_EXECUTION_INDETERMINATE');
        if (before.state === 'invalid' && !(initialPublisher && state === 'open' &&
            before.reason === 'missing_intent_record' && before.records.length === 0)) {
            throw codedError(`Recipe execution authority is unsafe (${before.reason ?? 'unknown'}).`, 'RECIPE_EXECUTION_INDETERMINATE');
        }
        if (before.records[0] !== undefined && before.records[0].executionDigest !== executionDigest) {
            throw codedError('Recipe command ID is already bound to another execution.', 'RECIPE_EXECUTION_CONFLICT');
        }
        const existing = before.records.find((record) => record.state === state);
        const record = buildRecord({
            commandId,
            executionDigest,
            sequence: existing?.sequence ?? before.records.length,
            state,
            previousRecordDigest: existing === undefined ? before.records.at(-1)?.recordDigest ?? null : existing.previousRecordDigest,
            evidence,
        });
        if (existing) {
            if (canonicalSha256(existing) !== canonicalSha256(record)) {
                throw codedError(`Recipe execution authority state ${state} has different evidence.`, 'RECIPE_EXECUTION_CONFLICT');
            }
            return existing;
        }
        if (!allowedNextState(before.records.at(-1)?.state ?? null, state)) {
            throw codedError(`Illegal recipe execution authority transition to ${state}.`, 'RECIPE_EXECUTION_TRANSITION');
        }
        const directory = this.executionDirectory(commandId);
        const text = JSON.stringify(record);
        try {
            await withPrivateDirectoryScope([
                { path: this.root, description: 'state root' },
                { path: this.executionsRoot, description: 'recipe executions directory' },
                { path: directory, description: 'recipe execution directory' },
            ], async (scope) => {
                await atomicCreatePrivateRecord(join(directory, recordFileName(record.sequence, state)), text, {
                    scope,
                    durabilityBoundary: async (boundary) => await this.options.durabilityBoundary?.(state, boundary),
                });
            });
            return record;
        }
        catch (error) {
            if (!hasCode(error, 'EEXIST'))
                throw error;
            const winner = await this.requireValid(commandId);
            const existingWinner = winner.records.find((candidate) => candidate.state === state);
            if (!existingWinner || canonicalSha256(existingWinner) !==
                canonicalSha256(record)) {
                throw codedError(`Concurrent recipe execution authority transition to ${state} used different evidence.`, 'RECIPE_EXECUTION_CONFLICT');
            }
            return existingWinner;
        }
    }
    async inspect(commandId) {
        canonicalCommandIdSchema.parse(commandId);
        try {
            await validatePrivateDirectory(this.root, 0o700, 'state root');
            await validatePrivateDirectory(this.executionsRoot, 0o700, 'recipe executions directory');
        }
        catch (error) {
            if (isMissingPath(error))
                return { state: 'missing', reason: null, records: [] };
            return { state: 'invalid', reason: 'unsafe_authority_root', records: [] };
        }
        const directory = this.executionDirectory(commandId);
        try {
            await validatePrivateDirectory(directory, 0o700, 'recipe execution directory');
        }
        catch (error) {
            if (isMissingPath(error))
                return { state: 'missing', reason: null, records: [] };
            return { state: 'invalid', reason: 'unsafe_execution_directory', records: [] };
        }
        return await withPrivateDirectoryScope([
            { path: this.root, description: 'state root' },
            { path: this.executionsRoot, description: 'recipe executions directory' },
            { path: directory, description: 'recipe execution directory' },
        ], async (scope) => {
            const records = [];
            for (const name of (await readdir(directory)).sort()) {
                if (!/^\d{2}-(?:open|writing_batch|closed_completed|closed_failed_pre_apply)\.json$/u.test(name)) {
                    return { state: 'invalid', reason: 'unexpected_authority_entry', records };
                }
                const raw = await readSecurePrivateRecord(join(directory, name), MAX_RECORD_BYTES, { scope });
                if (raw.state !== 'valid')
                    return { state: 'invalid', reason: `unsafe_record_${raw.state}`, records };
                let parsed;
                try {
                    parsed = JSON.parse(raw.text);
                }
                catch (_error) {
                    return { state: 'invalid', reason: 'invalid_record_json', records };
                }
                const record = parseRecord(parsed);
                if (record === null || record.commandId !== commandId || name !== recordFileName(record.sequence, record.state) ||
                    record.sequence !== records.length || record.previousRecordDigest !== (records.at(-1)?.recordDigest ?? null) ||
                    !allowedNextState(records.at(-1)?.state ?? null, record.state) ||
                    (records.length > 0 && record.executionDigest !== records[0].executionDigest)) {
                    return { state: 'invalid', reason: 'invalid_record_chain', records };
                }
                records.push(record);
            }
            await scope.assertStable();
            return records.length === 0
                ? { state: 'invalid', reason: 'missing_intent_record', records }
                : { state: 'valid', reason: null, records };
        });
    }
    async requireValid(commandId) {
        const inspection = await this.inspect(commandId);
        if (inspection.state !== 'valid')
            throw codedError(`Recipe execution authority is not valid (${inspection.reason ?? inspection.state}).`, 'RECIPE_EXECUTION_INDETERMINATE');
        return inspection;
    }
}
