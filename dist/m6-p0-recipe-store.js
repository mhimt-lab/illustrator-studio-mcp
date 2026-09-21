import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { canonicalCommandIdSchema } from './command-id.js';
import { canonicalSha256 } from './mutation-canonical.js';
import { atomicCreatePrivateRecord, readSecurePrivateRecord, } from './private-record.js';
import { ensurePrivateDirectory, isMissingPath, validatePrivateDirectory, withPrivateDirectoryScope, } from './private-state.js';
export const M6_P0_RECIPE_AUTHORITY_VERSION = 2;
const RECIPE_AUTHORITY_DIRECTORY = 'm6-recipe-executions';
const MAX_RECIPE_RECORD_BYTES = 262_144;
export const M6_P0_RECIPE_PROTOCOL_STATES = [
    'open',
    'writing_bound_effect',
    'bound_effect_verified',
    'writing_publication',
    'published_linked',
    'published_file_synced',
    'published_directory_synced',
    'bound',
    'closed_completed',
];
function hasCode(error, code) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
function codedError(message, code) {
    return Object.assign(new Error(message), { code });
}
function recordFileName(sequence, state) {
    return `${String(sequence).padStart(2, '0')}-${state}.json`;
}
function recordBody(record) {
    return record;
}
function buildRecord(input) {
    const body = {
        version: M6_P0_RECIPE_AUTHORITY_VERSION,
        recipeExecutionId: input.recipeExecutionId,
        executionDigest: input.executionDigest,
        sequence: input.sequence,
        state: input.state,
        previousRecordDigest: input.previousRecordDigest,
        evidence: input.evidence,
    };
    return { ...body, recordDigest: canonicalSha256(recordBody(body)) };
}
function parseRecord(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return null;
    const record = value;
    if (Object.keys(record).sort().join(',') !==
        'evidence,executionDigest,previousRecordDigest,recipeExecutionId,recordDigest,sequence,state,version')
        return null;
    if (record.version !== M6_P0_RECIPE_AUTHORITY_VERSION ||
        typeof record.recipeExecutionId !== 'string' ||
        typeof record.executionDigest !== 'string' || !/^[a-f0-9]{64}$/.test(record.executionDigest) ||
        typeof record.sequence !== 'number' || !Number.isSafeInteger(record.sequence) || record.sequence < 0 ||
        typeof record.state !== 'string' ||
        ![...M6_P0_RECIPE_PROTOCOL_STATES, 'closed_failed_pre_apply'].includes(record.state) ||
        !(record.previousRecordDigest === null ||
            (typeof record.previousRecordDigest === 'string' && /^[a-f0-9]{64}$/.test(record.previousRecordDigest))) ||
        typeof record.recordDigest !== 'string' || !/^[a-f0-9]{64}$/.test(record.recordDigest) ||
        !('evidence' in record))
        return null;
    try {
        canonicalCommandIdSchema.parse(record.recipeExecutionId);
        const expectedDigest = canonicalSha256(recordBody({
            version: M6_P0_RECIPE_AUTHORITY_VERSION,
            recipeExecutionId: record.recipeExecutionId,
            executionDigest: record.executionDigest,
            sequence: record.sequence,
            state: record.state,
            previousRecordDigest: record.previousRecordDigest,
            evidence: record.evidence,
        }));
        if (expectedDigest !== record.recordDigest)
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
    if (current === 'open' && next === 'closed_failed_pre_apply')
        return true;
    if (current === 'writing_bound_effect' && next === 'closed_failed_pre_apply')
        return true;
    const index = M6_P0_RECIPE_PROTOCOL_STATES.indexOf(current);
    return index >= 0 && M6_P0_RECIPE_PROTOCOL_STATES[index + 1] === next;
}
export class M6P0RecipeAuthorityStore {
    options;
    root;
    executionsRoot;
    constructor(root, options = {}) {
        this.options = options;
        this.root = root;
        this.executionsRoot = join(root, RECIPE_AUTHORITY_DIRECTORY);
    }
    async initialize() {
        await ensurePrivateDirectory(this.root, 'state root');
        await ensurePrivateDirectory(this.executionsRoot, 'M6 recipe executions directory');
    }
    executionDirectory(recipeExecutionId) {
        canonicalCommandIdSchema.parse(recipeExecutionId);
        return join(this.executionsRoot, recipeExecutionId);
    }
    async begin(input) {
        canonicalCommandIdSchema.parse(input.recipeExecutionId);
        if (!/^[a-f0-9]{64}$/.test(input.executionDigest))
            throw new Error('Recipe execution digest must be SHA-256.');
        await this.initialize();
        const directory = this.executionDirectory(input.recipeExecutionId);
        let directoryCreated = false;
        try {
            await withPrivateDirectoryScope([
                { path: this.root, description: 'state root' },
                { path: this.executionsRoot, description: 'M6 recipe executions directory' },
            ], async (scope) => {
                await mkdir(directory, { mode: 0o700 });
                directoryCreated = true;
                await scope.syncLeafParent();
            });
        }
        catch (error) {
            if (!hasCode(error, 'EEXIST'))
                throw error;
            await validatePrivateDirectory(directory, 0o700, 'M6 recipe execution directory');
        }
        const appended = await this.appendInternal(input.recipeExecutionId, input.executionDigest, 'open', input.binding).catch((error) => {
            if (directoryCreated) {
                throw codedError(`Recipe authority directory exists without a durable intent (${error instanceof Error ? error.message : String(error)}).`, 'RECIPE_AUTHORITY_INDETERMINATE');
            }
            throw error;
        });
        const inspection = await this.requireValid(input.recipeExecutionId);
        if (inspection.records[0]?.executionDigest !== input.executionDigest) {
            throw codedError('Recipe execution ID is already bound to another canonical digest.', 'RECIPE_EXECUTION_CONFLICT');
        }
        return { created: directoryCreated && appended.created, inspection };
    }
    async append(recipeExecutionId, executionDigest, state, evidence) {
        return await this.appendInternal(recipeExecutionId, executionDigest, state, evidence);
    }
    async waitForAdvance(recipeExecutionId, executionDigest, sequence, timeoutMilliseconds = 2_000) {
        if (!Number.isSafeInteger(sequence) || sequence < 0 ||
            !Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 0 || timeoutMilliseconds > 30_000) {
            throw new Error('Recipe authority wait bounds are invalid.');
        }
        const deadline = performance.now() + timeoutMilliseconds;
        for (;;) {
            const inspection = await this.inspect(recipeExecutionId);
            if (inspection.state !== 'valid' || inspection.records[0]?.executionDigest !== executionDigest) {
                throw codedError('Recipe authority became invalid while waiting for its owner.', 'RECIPE_AUTHORITY_INDETERMINATE');
            }
            if (inspection.records.length > sequence + 1)
                return inspection;
            if (performance.now() >= deadline) {
                throw codedError('Recipe authority owner did not publish an advance within the bounded wait.', 'RECIPE_AUTHORITY_WAIT_TIMEOUT');
            }
            await delay(Math.min(20, Math.max(1, deadline - performance.now())));
        }
    }
    async inspect(recipeExecutionId) {
        const deadline = performance.now() + 2_000;
        for (;;) {
            const inspection = await this.inspectOnce(recipeExecutionId);
            if (inspection.state !== 'invalid' ||
                (inspection.reason !== 'unexpected_authority_entry' && inspection.reason !== 'unsafe_record_invalid') ||
                performance.now() >= deadline)
                return inspection;
            await delay(20);
        }
    }
    async inspectOnce(recipeExecutionId) {
        canonicalCommandIdSchema.parse(recipeExecutionId);
        try {
            await validatePrivateDirectory(this.root, 0o700, 'state root');
            await validatePrivateDirectory(this.executionsRoot, 0o700, 'M6 recipe executions directory');
        }
        catch (error) {
            if (isMissingPath(error))
                return { state: 'missing', reason: null, records: [] };
            return { state: 'invalid', reason: 'unsafe_authority_root', records: [] };
        }
        const directory = this.executionDirectory(recipeExecutionId);
        try {
            await validatePrivateDirectory(directory, 0o700, 'M6 recipe execution directory');
        }
        catch (error) {
            if (isMissingPath(error))
                return { state: 'missing', reason: null, records: [] };
            return { state: 'invalid', reason: 'unsafe_execution_directory', records: [] };
        }
        return await withPrivateDirectoryScope([
            { path: this.root, description: 'state root' },
            { path: this.executionsRoot, description: 'M6 recipe executions directory' },
            { path: directory, description: 'M6 recipe execution directory' },
        ], async (scope) => {
            const names = (await readdir(directory)).sort();
            const records = [];
            for (const name of names) {
                if (!/^\d{2}-(?:open|writing_bound_effect|bound_effect_verified|writing_publication|published_linked|published_file_synced|published_directory_synced|bound|closed_completed|closed_failed_pre_apply)\.json$/.test(name)) {
                    return { state: 'invalid', reason: 'unexpected_authority_entry', records };
                }
                const recordValue = await readSecurePrivateRecord(join(directory, name), MAX_RECIPE_RECORD_BYTES, { scope });
                if (recordValue.state !== 'valid') {
                    return { state: 'invalid', reason: `unsafe_record_${recordValue.state}`, records };
                }
                let parsed;
                try {
                    parsed = JSON.parse(recordValue.text);
                }
                catch (_error) {
                    return { state: 'invalid', reason: 'invalid_record_json', records };
                }
                const record = parseRecord(parsed);
                if (record === null || record.recipeExecutionId !== recipeExecutionId ||
                    name !== recordFileName(record.sequence, record.state) ||
                    record.sequence !== records.length ||
                    record.previousRecordDigest !== (records.at(-1)?.recordDigest ?? null) ||
                    !allowedNextState(records.at(-1)?.state ?? null, record.state) ||
                    (records.length > 0 && record.executionDigest !== records[0].executionDigest)) {
                    return { state: 'invalid', reason: 'invalid_record_chain', records };
                }
                records.push(record);
            }
            await scope.assertStable();
            if (records.length === 0)
                return { state: 'invalid', reason: 'missing_intent_record', records };
            return { state: 'valid', reason: null, records };
        });
    }
    async appendInternal(recipeExecutionId, executionDigest, state, evidence) {
        canonicalCommandIdSchema.parse(recipeExecutionId);
        const before = await this.inspect(recipeExecutionId);
        if (state === 'open' && before.state === 'missing') {
            throw codedError('Recipe authority directory is missing.', 'RECIPE_AUTHORITY_INDETERMINATE');
        }
        if (before.state === 'invalid' && !(state === 'open' &&
            before.reason === 'missing_intent_record' && before.records.length === 0)) {
            throw codedError(`Recipe authority is unsafe (${before.reason ?? 'unknown'}).`, 'RECIPE_AUTHORITY_INDETERMINATE');
        }
        if (before.state === 'valid' && before.records[0]?.executionDigest !== executionDigest) {
            throw codedError('Recipe execution ID is already bound to another canonical digest.', 'RECIPE_EXECUTION_CONFLICT');
        }
        const records = before.records;
        const existing = records.find((record) => record.state === state);
        const record = buildRecord({
            recipeExecutionId,
            executionDigest,
            sequence: existing?.sequence ?? records.length,
            state,
            previousRecordDigest: existing === undefined
                ? records.at(-1)?.recordDigest ?? null
                : existing.previousRecordDigest,
            evidence,
        });
        if (existing) {
            if (JSON.stringify(existing) !== JSON.stringify(record)) {
                throw codedError(`Recipe authority state ${state} already has different evidence.`, 'RECIPE_AUTHORITY_CONFLICT');
            }
            return { created: false, record: existing };
        }
        if (!allowedNextState(records.at(-1)?.state ?? null, state)) {
            throw codedError(`Illegal recipe authority transition to ${state}.`, 'RECIPE_AUTHORITY_TRANSITION');
        }
        const directory = this.executionDirectory(recipeExecutionId);
        const path = join(directory, recordFileName(record.sequence, state));
        const text = JSON.stringify(record);
        let created = false;
        try {
            await withPrivateDirectoryScope([
                { path: this.root, description: 'state root' },
                { path: this.executionsRoot, description: 'M6 recipe executions directory' },
                { path: directory, description: 'M6 recipe execution directory' },
            ], async (scope) => {
                await atomicCreatePrivateRecord(path, text, {
                    scope,
                    durabilityBoundary: async (boundary) => await this.options.durabilityBoundary?.(state, boundary),
                });
                created = true;
            });
        }
        catch (error) {
            if (!hasCode(error, 'EEXIST'))
                throw error;
            const current = await this.requireValid(recipeExecutionId);
            const winner = current.records.find((candidate) => candidate.state === state);
            if (!winner || JSON.stringify(winner) !== text) {
                throw codedError(`Concurrent recipe authority transition to ${state} used different evidence.`, 'RECIPE_AUTHORITY_CONFLICT');
            }
            return { created: false, record: winner };
        }
        return { created, record };
    }
    async requireValid(recipeExecutionId) {
        const inspection = await this.inspect(recipeExecutionId);
        if (inspection.state !== 'valid') {
            throw codedError(`Recipe authority is not valid (${inspection.reason ?? inspection.state}).`, 'RECIPE_AUTHORITY_INDETERMINATE');
        }
        return inspection;
    }
}
