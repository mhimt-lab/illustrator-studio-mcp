import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, rename, rmdir, stat, statfs } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CANONICAL_COMMAND_ID_MESSAGE, isCanonicalCommandId } from './command-id.js';
import { CommandQuarantinedError, CommandReleasedUnverifiedError } from './domain.js';
import { describeStateEntry, ensurePrivateDirectory, isMissingPath, unsafeStateEntriesError, validatePrivateDirectory, withPrivateDirectoryScope, } from './private-state.js';
import { PRIVATE_RECORD_LIMITS, atomicCreatePrivateRecord, atomicCreatePrivateRecords, atomicReplacePrivateRecord, createEmptyPrivateStagingRecords, readSecurePrivateRecord, unlinkPrivateRecord, unlinkPrivateRecords, } from './private-record.js';
import { validateMutationResultArtifact } from './mutation-result-validator.js';
import { classifyCommandDirectory, ensureQuarantineArea, inspectCommandDirectory, publishQuarantineManifest, quarantineArea, quarantineManifestExists, readQuarantineManifest, scanCommandQuarantineArea, snapshotMatches, stateRootDevice, } from './state-quarantine.js';
import { defaultMutationOperationRegistry } from './default-mutation-operation-adapters.js';
import { legacyCommandMetadata, legacyCompactIdempotency, legacyFinalization, } from './legacy-mutation-state-v1.js';
const COMMAND_FILE_KEYS = [
    'commandId',
    'directory',
    'paramsPath',
    'scriptPath',
    'runnerPath',
    'resultPath',
    'statusPath',
    'executionPath',
    'finalizationPath',
    'idempotencyPath',
];
export const MUTATION_DURABLE_STATE_VERSION = 2;
const ACTIVE_LOCK_PUBLICATION_SETTLE_TIMEOUT_MS = 250;
const ACTIVE_LOCK_PUBLICATION_RETRY_INTERVAL_MS = 10;
const RELEASE_REASON_CODES = new Set([
    'adapter_unresolved', 'result_missing', 'host_indeterminate', 'host_failed_unproven', 'result_unverifiable',
]);
export function assertNeverTerminalKind(value) {
    throw new Error(`Unknown terminal idempotency kind: ${JSON.stringify(value.kind)}.`);
}
export const DEFAULT_MUTATION_STATE_QUOTA = {
    maxCommandCount: 1_000,
    maxTotalBytes: 134_217_728,
    reservationBytes: 1_048_576,
};
export class CommandLockedError extends Error {
    commandId;
    constructor(commandId) {
        super(`Illustrator is reserved by command ${commandId}. If that command is still running (a call from another ` +
            'server process; calls from this server wait their turn), wait for it to finish and retry. If it timed out or ' +
            'was interrupted, reconcile it with illustrator_reconcile before continuing; when reconcile reports ' +
            'canReleaseUnverified, check the document in Illustrator first and then use action=release_unverified.');
        this.commandId = commandId;
        this.name = 'CommandLockedError';
    }
}
async function pathExists(path) {
    try {
        await lstat(path);
        return true;
    }
    catch (error) {
        if (isMissingPath(error))
            return false;
        throw error;
    }
}
function defaultProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return !(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH');
    }
}
export function defaultStateRoot() {
    return process.env.ILLUSTRATOR_STUDIO_MCP_STATE_DIR ?? join(homedir(), 'Library', 'Application Support', 'illustrator-studio-mcp');
}
const MUTATION_PHASES = new Set(['preflight', 'plan', 'apply', 'verify', 'rollback']);
const CANONICAL_ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MUTATION_FAILURE_REASONS = new Set([
    'preflight_failed',
    'plan_failed',
    'apply_failed',
    'apply_indeterminate',
    'verify_mismatch',
    'rollback_failed',
    'rollback_indeterminate',
]);
function isMutationAuditEvent(value, expectedSequence) {
    if (typeof value !== 'object' || value === null)
        return false;
    const event = value;
    if (event.sequence !== expectedSequence || !MUTATION_PHASES.has(event.phase))
        return false;
    if (event.event === 'started' || event.event === 'succeeded')
        return Object.keys(event).length === 3;
    if (event.event === 'attempted')
        return event.phase === 'apply' && Object.keys(event).length === 3;
    if (event.event === 'skipped') {
        return Object.keys(event).length === 4 &&
            (event.reasonCode === 'not_requested' || event.reasonCode === 'not_required');
    }
    return event.event === 'failed' && MUTATION_FAILURE_REASONS.has(event.reasonCode) &&
        typeof event.message === 'string' && event.message.length > 0 && event.message.length <= 500 &&
        Object.keys(event).length === 5;
}
function isProvenPreApplyFailureAudit(audit) {
    if (audit === null)
        return false;
    const signature = audit.map((event) => [
        event.phase,
        event.event,
        'reasonCode' in event ? event.reasonCode : null,
    ]);
    const preflightFailure = [
        ['preflight', 'started', null],
        ['preflight', 'failed', 'preflight_failed'],
    ];
    const planFailure = [
        ['preflight', 'started', null],
        ['preflight', 'succeeded', null],
        ['plan', 'started', null],
        ['plan', 'failed', 'plan_failed'],
    ];
    const equals = (expected) => signature.length === expected.length && signature.every((event, index) => event[0] === expected[index]?.[0] && event[1] === expected[index]?.[1] && event[2] === expected[index]?.[2]);
    return equals(preflightFailure) || equals(planFailure);
}
function parseStoredCommandStatus(text, commandId) {
    const value = JSON.parse(text);
    if (typeof value !== 'object' || value === null)
        throw new SyntaxError('Command status is not an object.');
    const status = value;
    const keys = Object.keys(status).sort().join(',');
    if ((keys !== 'commandId,state' && keys !== 'commandId,message,state') || status.commandId !== commandId ||
        (status.state !== 'completed' && status.state !== 'failed' && status.state !== 'running' && status.state !== 'unknown') ||
        (status.message !== undefined && (typeof status.message !== 'string' || status.message.length > 65_000))) {
        throw new SyntaxError('Command status fields are invalid.');
    }
    return status;
}
function parseExecutionRecord(text) {
    const value = JSON.parse(text);
    const keys = Object.keys(value).sort().join(',');
    if (keys !== 'nonce,pid,processGroupId,startedAt,state,version' || value.version !== 1 ||
        value.state !== 'prepared' || typeof value.pid !== 'number' || !Number.isSafeInteger(value.pid) || value.pid <= 0 ||
        value.processGroupId !== value.pid || typeof value.nonce !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.nonce) ||
        typeof value.startedAt !== 'string' || value.startedAt.length === 0)
        return null;
    return value;
}
function hasCanonicalTimestamp(value) {
    return typeof value === 'string' && CANONICAL_ISO_TIMESTAMP.test(value) && Number.isFinite(Date.parse(value));
}
const RELEASE_TWIN_NAME = /^idempotency\.json\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;
const RELEASED_UNVERIFIED_KEYS = [
    'adapterIdentity', 'commandId', 'documentKey', 'documentState', 'evidence', 'kind', 'operation', 'reasonCode',
    'releasedAt', 'requestDigest', 'terminalState', 'validatorKind', 'validatorVersion', 'version',
].join(',');
const RELEASED_UNVERIFIED_EVIDENCE_KEYS = [
    'adapterResolved', 'executionNonce', 'executionProcessGroupId', 'resultDigest', 'resultDigestAlgorithm',
].join(',');
function parseReleasedUnverifiedRecord(value, commandId) {
    const evidence = value.evidence;
    if (Object.keys(value).sort().join(',') !== RELEASED_UNVERIFIED_KEYS ||
        value.version !== MUTATION_DURABLE_STATE_VERSION || value.kind !== 'released_unverified' ||
        value.commandId !== commandId || typeof value.operation !== 'string' || value.operation.length === 0 ||
        typeof value.documentKey !== 'string' || value.documentKey.length === 0 || value.documentKey.length > 16_384 ||
        typeof value.requestDigest !== 'string' || !/^[0-9a-f]{64}$/.test(value.requestDigest) ||
        typeof value.adapterIdentity !== 'string' || !/^[0-9a-f]{64}$/.test(value.adapterIdentity) ||
        typeof value.validatorKind !== 'string' || value.validatorKind.length === 0 ||
        typeof value.validatorVersion !== 'number' || !Number.isSafeInteger(value.validatorVersion) ||
        value.terminalState !== 'released_unverified' || value.documentState !== 'unverified' ||
        !RELEASE_REASON_CODES.has(value.reasonCode) || !hasCanonicalTimestamp(value.releasedAt) ||
        typeof evidence !== 'object' || evidence === null || Array.isArray(evidence) ||
        Object.keys(evidence).sort().join(',') !== RELEASED_UNVERIFIED_EVIDENCE_KEYS ||
        typeof evidence.executionNonce !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(evidence.executionNonce) ||
        typeof evidence.executionProcessGroupId !== 'number' || !Number.isSafeInteger(evidence.executionProcessGroupId) ||
        evidence.executionProcessGroupId <= 0 || evidence.resultDigestAlgorithm !== 'sha256' ||
        (evidence.resultDigest !== null &&
            (typeof evidence.resultDigest !== 'string' || !/^[0-9a-f]{64}$/.test(evidence.resultDigest))) ||
        typeof evidence.adapterResolved !== 'boolean')
        return null;
    return value;
}
export class FileCommandStore {
    root;
    lockPath;
    mutationQuota;
    availableBytes;
    registry;
    quarantinesInFlight = new Set();
    constructor(root = defaultStateRoot(), options = {}) {
        this.root = root;
        this.lockPath = join(root, 'active-command.lock');
        this.mutationQuota = options.mutationQuota ?? DEFAULT_MUTATION_STATE_QUOTA;
        this.availableBytes = options.availableBytes ?? (async (path) => {
            const filesystem = await statfs(path, { bigint: true });
            return filesystem.bavail * filesystem.bsize;
        });
        this.registry = options.registry ?? defaultMutationOperationRegistry();
        if (!this.registry.isSealed())
            throw new Error('FileCommandStore requires a sealed mutation adapter registry.');
    }
    async initialize() {
        await this.ensureStateDirectories();
        await this.prune();
    }
    async ensureStateDirectories() {
        await ensurePrivateDirectory(this.root, 'state root');
        await ensurePrivateDirectory(join(this.root, 'commands'), 'commands directory');
    }
    getAdapterRegistry() { return this.registry; }
    async create(commandId, kind, mutationValidator, idempotency) {
        const files = this.files(commandId);
        if (kind === 'mutation' && mutationValidator === undefined) {
            throw new Error('Mutation commands require a durable result validator identity.');
        }
        if (kind === 'mutation' && (idempotency === undefined || idempotency.commandId !== commandId ||
            idempotency.documentKey.length === 0 ||
            idempotency.documentKey.length > 16_384 || !/^[0-9a-f]{64}$/.test(idempotency.requestDigest))) {
            throw new Error('Mutation commands require matching durable idempotency metadata.');
        }
        const adapterIdentity = kind === 'mutation'
            ? this.registry.resolve(idempotency.operation, mutationValidator).adapterIdentity
            : undefined;
        if (kind === 'read' && mutationValidator !== undefined) {
            throw new Error('Read commands cannot declare a mutation result validator.');
        }
        if (kind === 'read' && idempotency !== undefined)
            throw new Error('Read commands cannot declare idempotency metadata.');
        await this.ensureStateDirectories();
        if (await this.isQuarantined(commandId))
            throw new CommandQuarantinedError(commandId);
        const directory = files.directory;
        await this.withCommandsScope(async (scope) => {
            await scope.assertStable();
            await mkdir(directory, { mode: 0o700 });
            await scope.assertStable();
            await scope.syncLeafParent();
        });
        await this.withCommandScope(commandId, async (scope) => atomicCreatePrivateRecord(join(directory, 'metadata.json'), JSON.stringify({
            version: MUTATION_DURABLE_STATE_VERSION,
            commandId,
            kind,
            createdAt: new Date().toISOString(),
            ...(mutationValidator === undefined ? {} : { mutationValidator }),
            ...(adapterIdentity === undefined ? {} : { adapterIdentity }),
            ...(idempotency === undefined ? {} : {
                operation: idempotency.operation,
                documentKey: idempotency.documentKey,
                requestDigest: idempotency.requestDigest,
            }),
        }), { scope }));
        await this.writeStatus(files, { commandId, state: 'unknown', message: 'Command created but not started.' });
        return files;
    }
    async acquire(commandId) {
        this.files(commandId);
        await this.initialize();
        try {
            await this.withRootScope(async (scope) => atomicCreatePrivateRecord(this.lockPath, commandId, { scope }));
        }
        catch (error) {
            if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
                throw new CommandLockedError(await this.readLockOwner() ?? 'unknown');
            }
            throw error;
        }
    }
    async release(commandId) {
        this.files(commandId);
        if (await this.readLockOwner() !== commandId)
            return;
        const compact = await this.inspectCompactIdempotency(commandId);
        if (compact.state === 'valid') {
            switch (compact.value.kind) {
                case 'tombstone':
                    await this.assertNoTombstoneTerminalArtifacts(commandId);
                    break;
                case 'released_unverified':
                    await this.assertReleasedUnverifiedBinding(compact.value);
                    break;
                case 'replay_bundle':
                    break;
                default:
                    assertNeverTerminalKind(compact.value);
            }
        }
        await this.withRootScope(async (scope) => unlinkPrivateRecord(this.lockPath, { scope })).catch((error) => {
            if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'))
                throw error;
        });
    }
    async readLockOwner() {
        try {
            await validatePrivateDirectory(this.root, 0o700, 'state root');
        }
        catch (error) {
            if (isMissingPath(error))
                return null;
            throw error;
        }
        const deadline = performance.now() + ACTIVE_LOCK_PUBLICATION_SETTLE_TIMEOUT_MS;
        while (true) {
            const record = await this.withRootScope(async (scope) => readSecurePrivateRecord(this.lockPath, PRIVATE_RECORD_LIMITS.lock, { scope }));
            if (record.state === 'missing')
                return null;
            if (record.state === 'invalid') {
                const remaining = deadline - performance.now();
                if (record.reason === 'unexpected_link_count' && remaining > 0) {
                    await delay(Math.min(ACTIVE_LOCK_PUBLICATION_RETRY_INTERVAL_MS, remaining));
                    continue;
                }
                throw new Error(`Active command lock is unsafe (${record.reason}).`);
            }
            const owner = record.text.trim();
            if (!isCanonicalCommandId(owner)) {
                throw new Error('Active command lock owner is not a canonical lowercase UUID v4.');
            }
            return owner;
        }
    }
    files(commandId) {
        if (!isCanonicalCommandId(commandId)) {
            throw new Error(CANONICAL_COMMAND_ID_MESSAGE);
        }
        const directory = join(this.root, 'commands', commandId);
        return {
            commandId,
            directory,
            paramsPath: join(directory, 'params.json'),
            scriptPath: join(directory, 'command.jsx'),
            runnerPath: join(directory, 'runner.applescript'),
            resultPath: join(directory, 'result.json'),
            statusPath: join(directory, 'status.json'),
            executionPath: join(directory, 'execution.json'),
            finalizationPath: join(directory, 'finalization.json'),
            idempotencyPath: join(directory, 'idempotency.json'),
        };
    }
    async readMetadata(commandId) {
        this.files(commandId);
        const inspected = await this.inspectMetadata(commandId);
        return inspected.state === 'valid' ? inspected.value : null;
    }
    async inspectMetadata(commandId) {
        const inspected = await this.inspectMetadataStructure(commandId);
        if (inspected.state !== 'valid')
            return inspected;
        if (!inspected.adapterResolved)
            return { state: 'invalid', reason: 'unknown_mutation_adapter' };
        return { state: 'valid', value: inspected.value };
    }
    async inspectMetadataStructure(commandId) {
        const files = this.files(commandId);
        try {
            const record = await this.readCommandRecord(commandId, join(files.directory, 'metadata.json'), PRIVATE_RECORD_LIMITS.metadata);
            if (record.state === 'missing') {
                try {
                    await this.validateCommandDirectory(commandId);
                    return { state: 'invalid', reason: 'metadata_missing' };
                }
                catch (error) {
                    if (isMissingPath(error))
                        return { state: 'missing' };
                    return { state: 'invalid', reason: 'unsafe_command_directory' };
                }
            }
            if (record.state === 'invalid')
                return record;
            const value = JSON.parse(record.text);
            const legacy = legacyCommandMetadata(value, commandId);
            if (legacy !== null)
                return { state: 'legacy', reason: 'legacy_state_format', value: legacy };
            if (value.version !== MUTATION_DURABLE_STATE_VERSION || value.commandId !== commandId || typeof value.createdAt !== 'string' ||
                value.createdAt.length === 0 || (value.kind !== 'read' && value.kind !== 'mutation')) {
                return { state: 'invalid', reason: 'invalid_metadata' };
            }
            if (value.kind === 'read') {
                if (Object.keys(value).sort().join(',') !== 'commandId,createdAt,kind,version') {
                    return { state: 'invalid', reason: 'invalid_metadata' };
                }
                return { state: 'valid', value: value, adapterResolved: true };
            }
            const validator = value.mutationValidator;
            if (Object.keys(value).sort().join(',') !==
                'adapterIdentity,commandId,createdAt,documentKey,kind,mutationValidator,operation,requestDigest,version' ||
                typeof value.operation !== 'string' || value.operation.length === 0 || typeof value.documentKey !== 'string' ||
                value.documentKey.length === 0 || value.documentKey.length > 16_384 || typeof value.requestDigest !== 'string' ||
                !/^[0-9a-f]{64}$/.test(value.requestDigest) ||
                typeof value.adapterIdentity !== 'string' || !/^[0-9a-f]{64}$/.test(value.adapterIdentity) ||
                typeof validator !== 'object' || validator === null ||
                Object.keys(validator).sort().join(',') !== 'kind,version' ||
                typeof validator.kind !== 'string' ||
                typeof validator.version !== 'number' ||
                !Number.isSafeInteger(validator.version)) {
                return { state: 'invalid', reason: 'invalid_metadata' };
            }
            let adapterResolved = true;
            try {
                this.registry.resolveIdentity(value.operation, validator, value.adapterIdentity);
            }
            catch (_error) {
                adapterResolved = false;
            }
            return { state: 'valid', value: value, adapterResolved };
        }
        catch (error) {
            return { state: 'invalid', reason: error instanceof SyntaxError ? 'invalid_json' : 'metadata_read_failed' };
        }
    }
    async readResult(commandId) {
        return await this.readCommandRecord(commandId, this.files(commandId).resultPath, PRIVATE_RECORD_LIMITS.result);
    }
    async writeCommandArtifact(files, path, contents) {
        await this.writeCommandArtifacts(files, [{ path, contents }]);
    }
    async writeCommandArtifacts(files, artifacts) {
        files = this.validateCommandFiles(files);
        if (artifacts.some(({ path }) => path !== files.paramsPath && path !== files.scriptPath && path !== files.runnerPath)) {
            throw new Error('Only immutable command input artifacts may be published through this writer.');
        }
        await this.withCommandScope(files.commandId, async (scope) => atomicCreatePrivateRecords(artifacts, { scope }));
    }
    async prepareHostArtifactTemps(files) {
        files = this.validateCommandFiles(files);
        const paths = [
            `${files.resultPath}.tmp`,
            `${files.statusPath}.running.json.tmp`,
            `${files.statusPath}.host_completed.json.tmp`,
            `${files.statusPath}.completed.json.tmp`,
            `${files.statusPath}.failed.json.tmp`,
            ...Array.from({ length: 32 }, (_unused, index) => `${files.statusPath}.audit.${String(index).padStart(3, '0')}.json.tmp`),
        ];
        await this.withCommandScope(files.commandId, async (scope) => createEmptyPrivateStagingRecords(paths, { scope }));
    }
    async writeFinalization(files, metadata) {
        files = this.validateCommandFiles(files);
        if (metadata.commandId !== files.commandId) {
            throw new Error('Mutation finalization metadata does not match the command.');
        }
        const persistedMetadata = await this.readMetadata(files.commandId);
        if (persistedMetadata?.kind !== 'mutation' ||
            persistedMetadata.version !== metadata.version || persistedMetadata.commandId !== metadata.commandId ||
            persistedMetadata.createdAt !== metadata.createdAt || persistedMetadata.operation !== metadata.operation ||
            persistedMetadata.documentKey !== metadata.documentKey ||
            persistedMetadata.requestDigest !== metadata.requestDigest ||
            persistedMetadata.adapterIdentity !== metadata.adapterIdentity ||
            persistedMetadata.mutationValidator.kind !== metadata.mutationValidator.kind ||
            persistedMetadata.mutationValidator.version !== metadata.mutationValidator.version) {
            throw new Error('Mutation finalization metadata is missing, unsafe, or mismatched.');
        }
        if ((await this.inspectCompactIdempotency(files.commandId)).state !== 'missing') {
            throw new Error('Mutation finalization cannot follow a published terminal idempotency record.');
        }
        const result = await this.readResult(files.commandId);
        if (result.state !== 'valid') {
            throw new Error('Mutation result artifact is missing or unsafe for finalization.');
        }
        const validatedArtifact = validateMutationResultArtifact(this.registry, {
            commandId: files.commandId,
            operation: metadata.operation,
            intent: 'apply',
            validator: metadata.mutationValidator,
            adapterIdentity: metadata.adapterIdentity,
        }, result.bytes);
        if (await this.finalizationArtifactExists(files.commandId)) {
            throw new Error('Mutation finalization attestation already exists and cannot be overwritten.');
        }
        const attestation = {
            version: MUTATION_DURABLE_STATE_VERSION,
            commandId: files.commandId,
            operation: metadata.operation,
            documentKey: metadata.documentKey,
            requestDigest: metadata.requestDigest,
            validatorKind: metadata.mutationValidator.kind,
            validatorVersion: metadata.mutationValidator.version,
            adapterIdentity: metadata.adapterIdentity,
            resultDigestAlgorithm: 'sha256',
            resultDigest: validatedArtifact.digest,
            terminalState: validatedArtifact.classification.state,
            finalizedAt: new Date().toISOString(),
        };
        await this.withCommandScope(files.commandId, async (scope) => atomicCreatePrivateRecord(files.finalizationPath, JSON.stringify(attestation), { scope }));
        const published = await this.readFinalization(files.commandId);
        if (!published || JSON.stringify(published) !== JSON.stringify(attestation)) {
            throw new Error('Durable mutation finalization attestation could not be verified.');
        }
        return published;
    }
    async readFinalization(commandId) {
        const inspected = await this.inspectFinalization(commandId);
        return inspected.state === 'valid' ? inspected.value : null;
    }
    async inspectFinalization(commandId) {
        const path = this.files(commandId).finalizationPath;
        try {
            const record = await this.readCommandRecord(commandId, path, PRIVATE_RECORD_LIMITS.finalization);
            if (record.state !== 'valid')
                return record;
            const value = JSON.parse(record.text);
            const legacy = legacyFinalization(value, commandId);
            if (legacy !== null)
                return { state: 'legacy', reason: 'legacy_state_format', value: legacy };
            if (Object.keys(value).sort().join(',') !==
                'adapterIdentity,commandId,documentKey,finalizedAt,operation,requestDigest,resultDigest,resultDigestAlgorithm,terminalState,validatorKind,validatorVersion,version' ||
                value.version !== MUTATION_DURABLE_STATE_VERSION || value.commandId !== commandId || typeof value.operation !== 'string' || value.operation.length === 0 ||
                typeof value.documentKey !== 'string' || value.documentKey.length === 0 || value.documentKey.length > 16_384 ||
                typeof value.requestDigest !== 'string' || !/^[0-9a-f]{64}$/.test(value.requestDigest) ||
                typeof value.adapterIdentity !== 'string' || !/^[0-9a-f]{64}$/.test(value.adapterIdentity) ||
                typeof value.validatorKind !== 'string' || typeof value.validatorVersion !== 'number' || !Number.isSafeInteger(value.validatorVersion) || value.resultDigestAlgorithm !== 'sha256' ||
                typeof value.resultDigest !== 'string' || !/^[0-9a-f]{64}$/.test(value.resultDigest) ||
                (value.terminalState !== 'verified' && value.terminalState !== 'apply_failed' &&
                    value.terminalState !== 'rolled_back' && value.terminalState !== 'rollback_failed') ||
                !hasCanonicalTimestamp(value.finalizedAt))
                return { state: 'invalid', reason: 'invalid_finalization' };
            try {
                this.registry.resolveIdentity(value.operation, { kind: value.validatorKind, version: value.validatorVersion }, value.adapterIdentity);
            }
            catch (_error) {
                return { state: 'invalid', reason: 'unknown_mutation_adapter' };
            }
            return { state: 'valid', value: value };
        }
        catch (error) {
            if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
                return { state: 'missing' };
            }
            return { state: 'invalid', reason: error instanceof SyntaxError ? 'invalid_json' : 'finalization_read_failed' };
        }
    }
    async finalizationArtifactExists(commandId) {
        return (await this.readCommandRecord(commandId, this.files(commandId).finalizationPath, PRIVATE_RECORD_LIMITS.finalization)).state !== 'missing';
    }
    async assertNoTombstoneTerminalArtifacts(commandId) {
        if (await this.finalizationArtifactExists(commandId) ||
            (await this.readResult(commandId)).state !== 'missing') {
            throw new Error('A compact tombstone cannot clean up an unexpected mutation result or finalization artifact.');
        }
    }
    async assertProvenPreApplyTerminalEvidence(files) {
        if (await this.readLockOwner() !== files.commandId) {
            throw new Error('Proven pre-apply terminalization requires the exact active command lock.');
        }
        await this.withCommandScope(files.commandId, async (scope) => {
            const names = (await readdir(files.directory)).sort();
            const statusNames = names.filter((name) => name === 'status.json' ||
                (name.startsWith('status.json.') && name.endsWith('.json') &&
                    !/^status\.json\.audit\.\d{3}\.json$/.test(name)));
            const expected = [
                'status.json.failed.json',
                'status.json.running.json',
                'status.json.unknown.json',
            ];
            if (JSON.stringify(statusNames) !== JSON.stringify(expected)) {
                throw new Error('Proven pre-apply terminalization requires exact unknown/running/failed status history.');
            }
            for (const state of ['unknown', 'running', 'failed']) {
                const record = await readSecurePrivateRecord(`${files.statusPath}.${state}.json`, PRIVATE_RECORD_LIMITS.status, { scope });
                if (record.state !== 'valid' || parseStoredCommandStatus(record.text, files.commandId).state !== state) {
                    throw new Error(`Proven pre-apply terminalization has unsafe ${state} status evidence.`);
                }
            }
        });
        if (!isProvenPreApplyFailureAudit(await this.readMutationAudit(files.commandId))) {
            throw new Error('Proven pre-apply terminalization requires an exact terminal failure audit.');
        }
        await this.assertNoTombstoneTerminalArtifacts(files.commandId);
    }
    async inspectCompactIdempotency(commandId) {
        const files = this.files(commandId);
        try {
            const record = await this.readCommandRecord(commandId, files.idempotencyPath, PRIVATE_RECORD_LIMITS.idempotency);
            if (record.state !== 'valid')
                return record;
            const value = JSON.parse(record.text);
            const legacy = legacyCompactIdempotency(value, commandId);
            if (legacy !== null)
                return { state: 'legacy', reason: 'legacy_state_format', value: legacy };
            if (value.kind === 'released_unverified') {
                const released = parseReleasedUnverifiedRecord(value, commandId);
                return released === null
                    ? { state: 'invalid', reason: 'invalid_released_unverified' }
                    : { state: 'valid', value: released };
            }
            const commonKeys = [
                'adapterIdentity', 'commandId', 'documentKey', 'finalizedAt', 'kind', 'operation', 'requestDigest', 'terminalState',
                'validatorKind', 'validatorVersion', 'version',
            ];
            const replay = value.kind === 'replay_bundle';
            const expectedKeys = replay
                ? [...commonKeys, 'resultDigest', 'resultDigestAlgorithm'].sort().join(',')
                : commonKeys.sort().join(',');
            if (Object.keys(value).sort().join(',') !== expectedKeys || value.version !== MUTATION_DURABLE_STATE_VERSION ||
                value.commandId !== commandId || typeof value.operation !== 'string' || value.operation.length === 0 ||
                typeof value.documentKey !== 'string' || value.documentKey.length === 0 || value.documentKey.length > 16_384 ||
                typeof value.requestDigest !== 'string' || !/^[0-9a-f]{64}$/.test(value.requestDigest) ||
                typeof value.adapterIdentity !== 'string' || !/^[0-9a-f]{64}$/.test(value.adapterIdentity) ||
                typeof value.validatorKind !== 'string' || typeof value.validatorVersion !== 'number' || !Number.isSafeInteger(value.validatorVersion) ||
                typeof value.finalizedAt !== 'string' || !CANONICAL_ISO_TIMESTAMP.test(value.finalizedAt) ||
                !Number.isFinite(Date.parse(value.finalizedAt)) ||
                (value.kind !== 'replay_bundle' && value.kind !== 'tombstone')) {
                return { state: 'invalid', reason: 'invalid_compact_idempotency' };
            }
            if (replay) {
                if (value.terminalState !== 'verified' && value.terminalState !== 'apply_failed' &&
                    value.terminalState !== 'rolled_back' && value.terminalState !== 'rollback_failed') {
                    return { state: 'invalid', reason: 'invalid_replay_bundle' };
                }
                if (value.resultDigestAlgorithm !== 'sha256' ||
                    typeof value.resultDigest !== 'string' || !/^[0-9a-f]{64}$/.test(value.resultDigest)) {
                    return { state: 'invalid', reason: 'invalid_replay_bundle' };
                }
            }
            else if (value.terminalState !== 'failed') {
                return { state: 'invalid', reason: 'invalid_tombstone' };
            }
            try {
                this.registry.resolveIdentity(value.operation, {
                    kind: value.validatorKind,
                    version: value.validatorVersion,
                }, value.adapterIdentity);
            }
            catch (_error) {
                return { state: 'invalid', reason: 'unknown_mutation_adapter' };
            }
            return { state: 'valid', value: value };
        }
        catch (error) {
            return { state: 'invalid', reason: error instanceof SyntaxError ? 'invalid_json' : 'compact_read_failed' };
        }
    }
    async compactMutation(files, metadata, terminal, options = {}) {
        return await this.compactMutationInternal(files, metadata, terminal, options);
    }
    async compactMutationInternal(files, metadata, terminal, options = {}) {
        files = this.validateCommandFiles(files);
        const existing = await this.inspectCompactIdempotency(files.commandId);
        if (existing.state === 'invalid' || existing.state === 'legacy') {
            throw new Error('Compact idempotency record is invalid or conflicts with the terminal command.');
        }
        const metadataMatches = (candidate) => candidate.version === metadata.version && candidate.commandId === metadata.commandId &&
            candidate.createdAt === metadata.createdAt && candidate.kind === metadata.kind &&
            candidate.operation === metadata.operation && candidate.documentKey === metadata.documentKey &&
            candidate.requestDigest === metadata.requestDigest &&
            candidate.adapterIdentity === metadata.adapterIdentity &&
            candidate.mutationValidator.kind === metadata.mutationValidator.kind &&
            candidate.mutationValidator.version === metadata.mutationValidator.version;
        let record;
        if (existing.state === 'missing') {
            const persistedMetadata = await this.readMetadata(files.commandId);
            if (persistedMetadata?.kind !== 'mutation' || !metadataMatches(persistedMetadata)) {
                throw new Error('Compact mutation metadata is missing, unsafe, or mismatched.');
            }
            if (terminal.kind === 'attested') {
                const durableAttestation = await this.readFinalization(files.commandId);
                const result = await this.readResult(files.commandId);
                if (durableAttestation === null || result.state !== 'valid') {
                    throw new Error('Durable mutation finalization is missing, unsafe, or mismatched.');
                }
                const artifact = validateMutationResultArtifact(this.registry, {
                    commandId: files.commandId,
                    operation: persistedMetadata.operation,
                    intent: 'apply',
                    validator: persistedMetadata.mutationValidator,
                    adapterIdentity: persistedMetadata.adapterIdentity,
                }, result.bytes);
                if (durableAttestation.commandId !== files.commandId ||
                    durableAttestation.operation !== persistedMetadata.operation ||
                    durableAttestation.documentKey !== persistedMetadata.documentKey ||
                    durableAttestation.requestDigest !== persistedMetadata.requestDigest ||
                    durableAttestation.adapterIdentity !== persistedMetadata.adapterIdentity ||
                    durableAttestation.validatorKind !== persistedMetadata.mutationValidator.kind ||
                    durableAttestation.validatorVersion !== persistedMetadata.mutationValidator.version ||
                    durableAttestation.resultDigestAlgorithm !== 'sha256' ||
                    durableAttestation.resultDigest !== artifact.digest ||
                    durableAttestation.terminalState !== artifact.classification.state) {
                    throw new Error('Durable mutation finalization is missing, unsafe, or mismatched.');
                }
                record = {
                    version: MUTATION_DURABLE_STATE_VERSION, kind: 'replay_bundle', commandId: files.commandId,
                    operation: persistedMetadata.operation, documentKey: persistedMetadata.documentKey,
                    requestDigest: persistedMetadata.requestDigest,
                    validatorKind: persistedMetadata.mutationValidator.kind,
                    validatorVersion: persistedMetadata.mutationValidator.version,
                    adapterIdentity: persistedMetadata.adapterIdentity,
                    terminalState: artifact.classification.state,
                    resultDigestAlgorithm: 'sha256', resultDigest: artifact.digest,
                    finalizedAt: durableAttestation.finalizedAt,
                };
            }
            else {
                await this.assertProvenPreApplyTerminalEvidence(files);
                try {
                    await this.assertNoTombstoneTerminalArtifacts(files.commandId);
                }
                catch (_error) {
                    throw new Error('An attested or existing mutation result cannot be compacted as a pre-apply tombstone.');
                }
                record = {
                    version: MUTATION_DURABLE_STATE_VERSION, kind: 'tombstone', commandId: files.commandId,
                    operation: persistedMetadata.operation, documentKey: persistedMetadata.documentKey,
                    requestDigest: persistedMetadata.requestDigest,
                    validatorKind: persistedMetadata.mutationValidator.kind,
                    validatorVersion: persistedMetadata.mutationValidator.version,
                    adapterIdentity: persistedMetadata.adapterIdentity,
                    terminalState: 'failed', finalizedAt: terminal.finalizedAt,
                };
            }
        }
        else {
            if (existing.value.kind === 'released_unverified') {
                throw new CommandReleasedUnverifiedError(files.commandId, 'Its artifacts are retained and never compacted.');
            }
            record = existing.value;
            if (record.commandId !== metadata.commandId || record.operation !== metadata.operation ||
                record.documentKey !== metadata.documentKey || record.requestDigest !== metadata.requestDigest ||
                record.adapterIdentity !== metadata.adapterIdentity ||
                record.validatorKind !== metadata.mutationValidator.kind ||
                record.validatorVersion !== metadata.mutationValidator.version) {
                throw new Error('Compact idempotency record is invalid or conflicts with the terminal command.');
            }
            if (record.kind === 'replay_bundle') {
                if (terminal.kind !== 'attested') {
                    throw new Error('An attested replay bundle cannot be compacted as a pre-apply tombstone.');
                }
                const result = await this.readResult(files.commandId);
                if (result.state !== 'valid')
                    throw new Error('Replay bundle result artifact is missing or unsafe.');
                const artifact = validateMutationResultArtifact(this.registry, {
                    commandId: files.commandId,
                    operation: metadata.operation,
                    intent: 'apply',
                    validator: metadata.mutationValidator,
                    adapterIdentity: metadata.adapterIdentity,
                }, result.bytes);
                if (record.resultDigestAlgorithm !== 'sha256' || record.resultDigest !== artifact.digest ||
                    record.terminalState !== artifact.classification.state) {
                    throw new Error('Replay bundle terminal state or digest does not match its canonical artifact.');
                }
            }
            else if (terminal.kind !== 'proven_pre_apply_failed' || record.finalizedAt !== terminal.finalizedAt) {
                throw new Error('Compact tombstone does not match the proven pre-apply failure.');
            }
        }
        if (existing.state === 'missing') {
            await this.withCommandScope(files.commandId, async (scope) => atomicCreatePrivateRecord(files.idempotencyPath, JSON.stringify(record), { scope }));
            await options.boundary?.('compact_published');
        }
        const published = await this.inspectCompactIdempotency(files.commandId);
        if (published.state !== 'valid' || JSON.stringify(published.value) !== JSON.stringify(record)) {
            throw new Error('Compact idempotency record could not be verified after publication.');
        }
        if (record.kind === 'replay_bundle') {
            const result = await this.readResult(files.commandId);
            if (result.state !== 'valid')
                throw new Error('Replay bundle result artifact is missing or unsafe.');
            const artifact = validateMutationResultArtifact(this.registry, {
                commandId: files.commandId,
                operation: metadata.operation,
                intent: 'apply',
                validator: metadata.mutationValidator,
                adapterIdentity: metadata.adapterIdentity,
            }, result.bytes);
            if (artifact.digest !== record.resultDigest || artifact.classification.state !== record.terminalState) {
                throw new Error('Replay bundle terminal state or digest does not match its canonical artifact.');
            }
        }
        else
            await this.assertNoTombstoneTerminalArtifacts(files.commandId);
        await options.boundary?.('compact_validated');
        if (record.kind === 'tombstone')
            await this.assertNoTombstoneTerminalArtifacts(files.commandId);
        const retained = new Set(record.kind === 'replay_bundle'
            ? ['idempotency.json', 'result.json']
            : ['idempotency.json', 'result.json', 'finalization.json']);
        await this.withCommandScope(files.commandId, async (scope) => {
            const names = await readdir(files.directory);
            if (names.length > 128)
                throw new Error('Command directory contains too many artifacts to compact safely.');
            const removable = [];
            for (const name of names.sort()) {
                if (retained.has(name))
                    continue;
                if (!/^[A-Za-z0-9._-]{1,128}$/.test(name) || name.includes('..')) {
                    throw new Error(`Command directory contains an unsafe artifact name: ${files.directory} entry ${JSON.stringify(name)}.`);
                }
                const path = join(files.directory, name);
                const metadata = await lstat(path);
                if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.() ||
                    (metadata.mode & 0o7777) !== 0o600) {
                    throw unsafeStateEntriesError('Command directory compaction', [
                        `unsafe artifact that cannot be compacted: ${describeStateEntry(path, metadata, 0o600)}`,
                    ]);
                }
                removable.push({ name, path });
            }
            await options.boundary?.('cleanup_validated');
            if (record.kind === 'tombstone')
                await this.assertNoTombstoneTerminalArtifacts(files.commandId);
            for (const { name, path } of removable) {
                if (record.kind === 'tombstone')
                    await this.assertNoTombstoneTerminalArtifacts(files.commandId);
                await unlinkPrivateRecord(path, { scope });
                await options.boundary?.('artifact_unlinked', name);
                if (record.kind === 'tombstone')
                    await this.assertNoTombstoneTerminalArtifacts(files.commandId);
            }
            await options.boundary?.('cleanup_completed');
            if (record.kind === 'tombstone')
                await this.assertNoTombstoneTerminalArtifacts(files.commandId);
        });
        if (record.kind === 'tombstone')
            await this.assertNoTombstoneTerminalArtifacts(files.commandId);
        return record;
    }
    async finalizeProvenPreApplyFailure(files, metadata, options = {}) {
        files = this.validateCommandFiles(files);
        const existing = await this.inspectCompactIdempotency(files.commandId);
        const finalizedAt = existing.state === 'valid' && existing.value.kind === 'tombstone'
            ? existing.value.finalizedAt
            : new Date().toISOString();
        const compacted = await this.compactMutationInternal(files, metadata, {
            kind: 'proven_pre_apply_failed',
            finalizedAt,
        }, options);
        if (compacted.kind !== 'tombstone') {
            throw new Error('Proven pre-apply terminalization did not produce a tombstone.');
        }
        await this.release(files.commandId);
        if (await this.readLockOwner() === files.commandId) {
            throw new Error('Proven pre-apply terminalization could not verify command lock release.');
        }
        return compacted;
    }
    async assertMutationCapacity() {
        const quota = this.mutationQuota;
        if (!Number.isSafeInteger(quota.maxCommandCount) || quota.maxCommandCount < 1 ||
            !Number.isSafeInteger(quota.maxTotalBytes) || quota.maxTotalBytes < 1 ||
            !Number.isSafeInteger(quota.reservationBytes) || quota.reservationBytes < 1 ||
            quota.reservationBytes > quota.maxTotalBytes) {
            throw new Error('Mutation state quota configuration is invalid.');
        }
        if (typeof process.getuid !== 'function') {
            throw new Error('Mutation state quota scan cannot verify the operating-system user.');
        }
        const selfUid = process.getuid();
        await this.withCommandsScope(async (scope) => {
            const commandsRoot = join(this.root, 'commands');
            const entries = await readdir(commandsRoot, { withFileTypes: true });
            if (entries.length >= quota.maxCommandCount) {
                throw new Error('Mutation state quota is full; a new command ID cannot be applied.');
            }
            const violations = [];
            const violatingCommands = [];
            let totalBytes = 0n;
            for (const entry of entries) {
                const before = violations.length;
                const directory = join(commandsRoot, entry.name);
                const directoryMetadata = await lstat(directory);
                if (!entry.isDirectory() || !isCanonicalCommandId(entry.name)) {
                    violations.push(`unsafe command entry: ${describeStateEntry(directory, directoryMetadata, 0o700)}`);
                    continue;
                }
                if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink() ||
                    directoryMetadata.uid !== selfUid || (directoryMetadata.mode & 0o7777) !== 0o700) {
                    violations.push(`unsafe command directory: ${describeStateEntry(directory, directoryMetadata, 0o700)}`);
                    violatingCommands.push(entry.name);
                    continue;
                }
                await this.withCommandScope(entry.name, async (commandScope) => {
                    const artifacts = await readdir(directory, { withFileTypes: true });
                    if (artifacts.length > 128) {
                        violations.push(`per-command artifact limit exceeded: ${directory} (artifacts=${artifacts.length}, limit=128)`);
                        await commandScope.assertStable();
                        return;
                    }
                    for (const artifact of artifacts) {
                        const artifactPath = join(directory, artifact.name);
                        const artifactMetadata = await lstat(artifactPath);
                        if (!artifact.isFile() || artifact.isSymbolicLink() ||
                            !artifactMetadata.isFile() || artifactMetadata.isSymbolicLink()) {
                            violations.push(`nonregular artifact: ${describeStateEntry(artifactPath, artifactMetadata, 0o600)}`);
                            continue;
                        }
                        if (artifactMetadata.uid !== selfUid || (artifactMetadata.mode & 0o7777) !== 0o600 ||
                            !Number.isSafeInteger(artifactMetadata.size) || artifactMetadata.size < 0) {
                            violations.push(`unsafe artifact: ${describeStateEntry(artifactPath, artifactMetadata, 0o600)}`);
                            continue;
                        }
                        totalBytes += BigInt(artifactMetadata.size);
                    }
                    await commandScope.assertStable();
                });
                if (violations.length > before)
                    violatingCommands.push(entry.name);
            }
            const quarantined = await scanCommandQuarantineArea(this.root, selfUid, commandsRoot);
            violations.push(...quarantined.violations);
            totalBytes += quarantined.bytes;
            await scope.assertStable();
            if (violations.length > 0) {
                throw unsafeStateEntriesError('Mutation state quota scan', violations, await this.quarantineGuidance(violatingCommands, selfUid));
            }
            if (totalBytes + BigInt(quota.reservationBytes) > BigInt(quota.maxTotalBytes)) {
                throw new Error('Mutation state byte quota cannot reserve space for a new command.' + (quarantined.bytes > 0n
                    ? ` Quarantined evidence under ${quarantineArea(this.root, 'commands').area} (${quarantined.bytes} bytes) still counts; ` +
                        'move it out of the state root by hand to free space.'
                    : ''));
            }
            const available = await this.availableBytes(this.root);
            if (available < BigInt(quota.reservationBytes)) {
                throw new Error('Insufficient filesystem space for the mutation state reservation.');
            }
        });
    }
    async readStatus(commandId) {
        const files = this.files(commandId);
        for (const state of ['completed', 'failed', 'running', 'unknown']) {
            try {
                const record = await this.readCommandRecord(commandId, `${files.statusPath}.${state}.json`, PRIVATE_RECORD_LIMITS.status);
                if (record.state === 'missing')
                    continue;
                if (record.state === 'invalid') {
                    return { commandId, state: 'unknown', message: `Command ${state} status is unsafe; explicit reconciliation is required.` };
                }
                return parseStoredCommandStatus(record.text, commandId);
            }
            catch (error) {
                if (error instanceof SyntaxError) {
                    return { commandId, state: 'unknown', message: `Command ${state} status is unreadable; explicit reconciliation is required.` };
                }
                throw error;
            }
        }
        try {
            const record = await this.readCommandRecord(commandId, files.statusPath, PRIVATE_RECORD_LIMITS.status);
            if (record.state === 'missing')
                return { commandId, state: 'unknown', message: 'Command status does not exist.' };
            if (record.state === 'invalid')
                return { commandId, state: 'unknown', message: 'Legacy command status is unsafe.' };
            return parseStoredCommandStatus(record.text, commandId);
        }
        catch (error) {
            if (error instanceof SyntaxError)
                return { commandId, state: 'unknown', message: 'Legacy command status is unreadable; explicit reconciliation is required.' };
            throw error;
        }
    }
    async readMutationAudit(commandId) {
        const files = this.files(commandId);
        try {
            return await this.withCommandScope(commandId, async (scope) => {
                const names = (await readdir(files.directory))
                    .filter((name) => /^status\.json\.audit\.\d{3}\.json$/.test(name))
                    .sort();
                if (names.length > 32)
                    return null;
                const events = [];
                for (let index = 0; index < names.length; index++) {
                    const record = await readSecurePrivateRecord(join(files.directory, names[index]), PRIVATE_RECORD_LIMITS.audit, { scope });
                    if (record.state !== 'valid')
                        return null;
                    const event = JSON.parse(record.text);
                    if (!isMutationAuditEvent(event, index))
                        return null;
                    events.push(event);
                }
                return events;
            });
        }
        catch (error) {
            if (error instanceof SyntaxError || isMissingPath(error))
                return null;
            return null;
        }
    }
    async writeStatus(files, status) {
        files = this.validateCommandFiles(files);
        if (status.commandId !== files.commandId)
            throw new Error('Command status must match its canonical command files.');
        await this.withCommandScope(files.commandId, async (scope) => atomicReplacePrivateRecord(`${files.statusPath}.${status.state}.json`, JSON.stringify(status), { scope }));
    }
    async writeExecution(files, record) {
        files = this.validateCommandFiles(files);
        const execution = {
            version: 1,
            state: 'prepared',
            ...record,
            startedAt: new Date().toISOString(),
        };
        await this.withCommandScope(files.commandId, async (scope) => atomicReplacePrivateRecord(files.executionPath, JSON.stringify(execution), { scope }));
        const published = await this.readExecution(files.commandId);
        if (!published || published.pid !== execution.pid || published.processGroupId !== execution.processGroupId ||
            published.nonce !== execution.nonce) {
            throw new Error('Durable execution record could not be verified before launch.');
        }
        return published;
    }
    async readExecution(commandId) {
        const files = this.files(commandId);
        try {
            const record = await this.readCommandRecord(commandId, files.executionPath, PRIVATE_RECORD_LIMITS.execution);
            if (record.state !== 'valid')
                return null;
            return parseExecutionRecord(record.text);
        }
        catch (error) {
            if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
                return null;
            if (error instanceof SyntaxError)
                return null;
            throw error;
        }
    }
    async readExecutionPid(commandId) {
        this.files(commandId);
        return (await this.readExecution(commandId))?.pid ?? null;
    }
    async abandon(commandId) {
        const files = this.files(commandId);
        await this.writeStatus(files, {
            commandId,
            state: 'failed',
            message: 'Command was explicitly abandoned after its execution process was confirmed stopped.',
        });
        await this.release(commandId);
    }
    async inspectReleaseUnverified(commandId, processGroupLiveness) {
        this.files(commandId);
        const refuse = (reason) => ({ eligible: false, reason });
        if (typeof process.getuid !== 'function')
            return refuse('the operating-system user cannot be verified');
        if (await this.isQuarantined(commandId))
            return refuse('the command is quarantined');
        if (await this.readLockOwner() !== commandId)
            return refuse('the command does not hold the active lock');
        const metadata = await this.inspectMetadataStructure(commandId);
        if (metadata.state !== 'valid' || metadata.value.kind !== 'mutation') {
            return refuse(metadata.state === 'legacy'
                ? 'its state is durable version 1; use action=abandon'
                : 'its metadata is missing, unsafe, or not a mutation');
        }
        const execution = await this.readExecution(commandId).catch(() => null);
        if (execution === null)
            return refuse('its execution record is missing or unreadable, so its runner is not proven stopped');
        const liveness = processGroupLiveness(execution.processGroupId);
        if (liveness !== 'inactive')
            return refuse(`its execution process group is ${liveness}`);
        const compact = await this.inspectCompactIdempotency(commandId);
        let resume = 'none';
        if (compact.state === 'valid') {
            if (compact.value.kind !== 'released_unverified')
                return refuse(`it already has a ${compact.value.kind} terminal record`);
            if (!this.releasedMatches(compact.value, metadata.value, execution))
                return refuse('its released record does not match its metadata and execution');
            resume = 'record';
        }
        else if (compact.state === 'missing') {
            if (await this.finalizationArtifactExists(commandId)) {
                return refuse('a finalization attestation exists; its attested compaction has not finished, so reconcile it again instead');
            }
        }
        else if ((await this.readReleaseTwin(commandId, metadata.value, execution)) !== null) {
            resume = 'twin';
        }
        else {
            return refuse(`its terminal idempotency record is ${compact.state === 'legacy' ? 'durable version 1' : compact.reason}`);
        }
        const attribution = await this.withCommandsScope(async (scope) => {
            const classified = await classifyCommandDirectory(this.files(commandId).directory, process.getuid());
            await scope.assertStable();
            return classified;
        });
        if (attribution === null)
            return refuse('its command directory does not exist');
        if (attribution.state === 'unattributable') {
            return refuse(`its command directory has state that cannot be attributed to this user (${attribution.reasons.join('; ')})`);
        }
        return { eligible: true, resume };
    }
    async releaseUnverified(commandId, options) {
        const files = this.files(commandId);
        if (options.confirmCommandId !== commandId) {
            throw new Error('Releasing a command without verification requires confirm_command_id to exactly match command_id.');
        }
        const lockOwner = await this.readLockOwner();
        if (lockOwner !== commandId) {
            const compact = await this.inspectCompactIdempotency(commandId);
            if (compact.state === 'valid' && compact.value.kind === 'released_unverified')
                return compact.value;
        }
        const eligibility = await this.inspectReleaseUnverified(commandId, options.processGroupLiveness);
        if (!eligibility.eligible) {
            throw new Error(`Command ${commandId} cannot be released without verification: ${eligibility.reason}. Nothing was written.`);
        }
        const metadata = await this.inspectMetadataStructure(commandId);
        const execution = await this.readExecution(commandId);
        if (metadata.state !== 'valid' || metadata.value.kind !== 'mutation' || execution === null) {
            throw new Error(`Command ${commandId} changed during its release; nothing was written.`);
        }
        if (eligibility.resume === 'twin') {
            await this.completeReleaseTwin(commandId, metadata.value, execution);
            await options.boundary?.('twin_completed');
        }
        else if (eligibility.resume === 'none') {
            const record = await this.releasedRecord(commandId, metadata.value, metadata.adapterResolved, execution);
            try {
                await this.withCommandScope(commandId, async (scope) => atomicCreatePrivateRecord(files.idempotencyPath, JSON.stringify(record), {
                    scope,
                    ...(options.durabilityBoundary === undefined ? {} : { durabilityBoundary: options.durabilityBoundary }),
                }));
            }
            catch (error) {
                if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'))
                    throw error;
            }
        }
        const published = await this.inspectCompactIdempotency(commandId);
        if (published.state !== 'valid' || published.value.kind !== 'released_unverified' ||
            !this.releasedMatches(published.value, metadata.value, execution)) {
            throw new Error(`The released record of ${commandId} could not be verified; its lock is kept.`);
        }
        await options.boundary?.('record_verified');
        await this.release(commandId);
        if (await this.readLockOwner() === commandId)
            throw new Error(`The release of ${commandId} could not verify its lock release.`);
        return published.value;
    }
    async releasedRecord(commandId, metadata, adapterResolved, execution) {
        const result = await this.readResult(commandId);
        let reasonCode = 'result_unverifiable';
        if (!adapterResolved)
            reasonCode = 'adapter_unresolved';
        else if (result.state === 'missing')
            reasonCode = 'result_missing';
        else if (result.state === 'valid') {
            let state;
            try {
                state = JSON.parse(result.text).state;
            }
            catch {
                state = undefined;
            }
            if (state === 'indeterminate')
                reasonCode = 'host_indeterminate';
            else if (state === 'failed')
                reasonCode = 'host_failed_unproven';
        }
        if (reasonCode === 'result_unverifiable' && (await this.readStatus(commandId)).state === 'failed') {
            reasonCode = 'host_failed_unproven';
        }
        return {
            version: MUTATION_DURABLE_STATE_VERSION,
            kind: 'released_unverified',
            commandId,
            operation: metadata.operation,
            documentKey: metadata.documentKey,
            requestDigest: metadata.requestDigest,
            validatorKind: metadata.mutationValidator.kind,
            validatorVersion: metadata.mutationValidator.version,
            adapterIdentity: metadata.adapterIdentity,
            terminalState: 'released_unverified',
            documentState: 'unverified',
            reasonCode,
            releasedAt: new Date().toISOString(),
            evidence: {
                executionNonce: execution.nonce,
                executionProcessGroupId: execution.processGroupId,
                resultDigestAlgorithm: 'sha256',
                resultDigest: result.state === 'valid' ? createHash('sha256').update(result.bytes).digest('hex') : null,
                adapterResolved,
            },
        };
    }
    releasedMatches(record, metadata, execution) {
        return metadata.kind === 'mutation' && record.commandId === metadata.commandId &&
            record.operation === metadata.operation && record.documentKey === metadata.documentKey &&
            record.requestDigest === metadata.requestDigest && record.adapterIdentity === metadata.adapterIdentity &&
            record.validatorKind === metadata.mutationValidator.kind &&
            record.validatorVersion === metadata.mutationValidator.version &&
            record.evidence.executionNonce === execution.nonce &&
            record.evidence.executionProcessGroupId === execution.processGroupId;
    }
    async assertReleasedUnverifiedBinding(record) {
        const metadata = await this.inspectMetadataStructure(record.commandId);
        const execution = await this.readExecution(record.commandId);
        if (metadata.state !== 'valid' || execution === null || !this.releasedMatches(record, metadata.value, execution)) {
            throw new Error(`The released record of ${record.commandId} does not match its metadata and execution; its lock is kept.`);
        }
    }
    async readReleaseTwin(commandId, metadata, execution) {
        const files = this.files(commandId);
        try {
            return await this.withCommandScope(commandId, async (scope) => {
                const target = await lstat(files.idempotencyPath, { bigint: true });
                if (!target.isFile() || target.nlink !== 2n)
                    return null;
                const twins = [];
                for (const name of await readdir(files.directory)) {
                    if (!RELEASE_TWIN_NAME.test(name))
                        continue;
                    const candidate = await lstat(join(files.directory, name), { bigint: true });
                    if (candidate.isFile() && candidate.ino === target.ino)
                        twins.push(name);
                }
                if (twins.length !== 1)
                    return null;
                const record = await readSecurePrivateRecord(files.idempotencyPath, PRIVATE_RECORD_LIMITS.idempotency, {
                    scope, maxLinkCount: 2,
                });
                if (record.state !== 'valid')
                    return null;
                const released = parseReleasedUnverifiedRecord(JSON.parse(record.text), commandId);
                if (released === null || !this.releasedMatches(released, metadata, execution))
                    return null;
                await scope.assertStable();
                return { twin: join(files.directory, twins[0]), ino: target.ino };
            });
        }
        catch (_error) {
            return null;
        }
    }
    async completeReleaseTwin(commandId, metadata, execution) {
        const found = await this.readReleaseTwin(commandId, metadata, execution);
        if (found === null)
            throw new Error(`The interrupted release of ${commandId} no longer matches; its lock is kept.`);
        const path = this.files(commandId).idempotencyPath;
        await this.withCommandScope(commandId, async (scope) => unlinkPrivateRecord(found.twin, { scope }));
        const after = await lstat(path, { bigint: true });
        if (after.ino !== found.ino || after.nlink !== 1n) {
            throw new Error(`The released record of ${commandId} changed while its publication was finished; its lock is kept.`);
        }
    }
    async isQuarantined(commandId) {
        this.files(commandId);
        return await quarantineManifestExists(this.root, 'commands', commandId);
    }
    async quarantineGuidance(commandIds, selfUid) {
        const guidance = [];
        for (const commandId of commandIds) {
            if (await this.isQuarantined(commandId)) {
                guidance.push(`Command ${commandId} has a quarantine in progress: run illustrator_reconcile with action=quarantine, ` +
                    `command_id=${commandId}, and confirm_command_id=${commandId} again to finish it.`);
                continue;
            }
            const candidate = await inspectCommandDirectory(this.files(commandId).directory, selfUid);
            if (candidate?.quarantinable) {
                guidance.push(`Command ${commandId} can be quarantined (its violations are confined to it): run illustrator_reconcile ` +
                    `with action=quarantine, command_id=${commandId}, and confirm_command_id=${commandId}; the evidence is moved, not repaired or deleted.`);
            }
        }
        return guidance;
    }
    async inspectQuarantine(commandId) {
        const files = this.files(commandId);
        if (!await this.isQuarantined(commandId))
            return null;
        const rerun = `Run illustrator_reconcile with action=quarantine, command_id=${commandId}, and confirm_command_id=${commandId} to finish it.`;
        const read = await readQuarantineManifest(this.root, 'commands', commandId);
        if (read.state !== 'valid') {
            return { state: 'inconsistent', message: `Command ${commandId} is quarantined, but its manifest is unreadable (${read.state === 'invalid' ? read.reason : 'missing'}); it is refused for good and needs manual inspection.` };
        }
        const lockOwner = await this.readLockOwner();
        const moved = await pathExists(join(quarantineArea(this.root, 'commands').area, commandId));
        const live = await readdir(files.directory).then((names) => names.length, (error) => {
            if (isMissingPath(error))
                return null;
            throw error;
        });
        if (moved && live === 0 && lockOwner !== read.manifest.operation.id) {
            return { state: 'quarantined', message: `Command ${commandId} is quarantined and will never be replayed or reapplied; its state is under ${quarantineArea(this.root, 'commands').area}.` };
        }
        if (moved && live !== null && live > 0) {
            return { state: 'inconsistent', message: `Command ${commandId} is quarantined, but both the live and the moved directory hold entries; it is refused for good and needs manual inspection.` };
        }
        return {
            state: lockOwner === read.manifest.operation.id ? 'locked' : 'pending',
            message: `Command ${commandId} is being quarantined and is refused for good; the quarantine did not finish. ${rerun}`,
        };
    }
    async findQuarantineOperation(operationId) {
        this.files(operationId);
        if (await pathExists(this.files(operationId).directory))
            return null;
        const { base, area } = quarantineArea(this.root, 'commands');
        if (!await pathExists(base) || !await pathExists(area))
            return null;
        for (const name of (await readdir(area)).sort()) {
            const id = /^(.+)\.json$/u.exec(name)?.[1];
            if (id === undefined || !isCanonicalCommandId(id))
                continue;
            const read = await readQuarantineManifest(this.root, 'commands', id);
            if (read.state === 'valid' && read.manifest.operation?.id === operationId)
                return id;
        }
        return null;
    }
    async quarantineCommand(commandId, options) {
        this.files(commandId);
        if (options.confirmCommandId !== commandId) {
            throw new Error('Quarantining a command requires confirm_command_id to exactly match command_id.');
        }
        if (typeof process.getuid !== 'function')
            throw new Error('Quarantine cannot verify the operating-system user.');
        if (this.quarantinesInFlight.has(commandId))
            throw new Error(`Command ${commandId} is already being quarantined by this server.`);
        this.quarantinesInFlight.add(commandId);
        try {
            const selfUid = process.getuid();
            const hooks = options.hooks ?? {};
            const processAlive = options.processAlive ?? defaultProcessAlive;
            const lockOwner = await this.readLockOwner();
            const existing = await readQuarantineManifest(this.root, 'commands', commandId);
            if (existing.state === 'invalid') {
                throw new Error(`Command ${commandId} has an unreadable quarantine manifest (${existing.reason}); it stays refused and needs manual inspection.`);
            }
            let manifest;
            if (existing.state === 'missing') {
                if (lockOwner !== null) {
                    throw new Error(`Command ${lockOwner} holds the active lock; reconcile it before quarantining ${commandId}.`);
                }
                const candidate = await this.quarantineCandidate(commandId, selfUid);
                if (!candidate.quarantinable) {
                    throw new Error(`Command ${commandId} cannot be quarantined: ${candidate.reasons.join('; ')}. Nothing was written.`);
                }
                await this.assertQuarantineExecutionInactive(commandId, options.processGroupLiveness);
                manifest = {
                    quarantineRecordVersion: 1,
                    kind: 'command',
                    id: commandId,
                    operation: { id: randomUUID(), pid: process.pid },
                    quarantinedAt: new Date().toISOString(),
                    ...candidate.snapshot,
                };
                await ensureQuarantineArea(this.root, 'commands', hooks);
                await publishQuarantineManifest(this.root, 'commands', manifest, 'create', hooks);
                await this.acquireQuarantineLock(manifest, commandId);
                await hooks.boundary?.('lock_acquired');
            }
            else {
                manifest = existing.manifest;
                const operation = manifest.operation;
                if (lockOwner === null) {
                    await this.acquireQuarantineLock(manifest, commandId);
                    await hooks.boundary?.('lock_acquired');
                }
                else if (lockOwner !== operation.id) {
                    throw new Error(`Command ${lockOwner} holds the active lock; reconcile it before finishing the quarantine of ${commandId}.`);
                }
                else if (operation.pid !== process.pid && processAlive(operation.pid)) {
                    throw new Error(`The quarantine of ${commandId} is held by process ${operation.pid}, which is still running.`);
                }
            }
            await this.completeQuarantine(commandId, manifest, selfUid, hooks);
            return { commandId, operationId: manifest.operation.id, area: quarantineArea(this.root, 'commands').area };
        }
        finally {
            this.quarantinesInFlight.delete(commandId);
        }
    }
    async quarantineCandidate(commandId, selfUid) {
        return await this.withCommandsScope(async (scope) => {
            const candidate = await inspectCommandDirectory(this.files(commandId).directory, selfUid);
            await scope.assertStable();
            return candidate ?? { quarantinable: false, reasons: [`${this.files(commandId).directory} does not exist`] };
        });
    }
    async withQuarantineCandidateScope(commandId, operation) {
        const directory = this.files(commandId).directory;
        const observed = await lstat(directory);
        return await withPrivateDirectoryScope([
            { path: this.root, description: 'state root' },
            { path: join(this.root, 'commands'), description: 'commands directory' },
            { path: directory, description: 'command directory', expectedMode: observed.mode & 0o7777 },
        ], operation);
    }
    async assertQuarantineExecutionInactive(commandId, processGroupLiveness) {
        const path = this.files(commandId).executionPath;
        const execution = await this.withQuarantineCandidateScope(commandId, async (scope) => {
            if (!await pathExists(path))
                return 'absent';
            const record = await readSecurePrivateRecord(path, PRIVATE_RECORD_LIMITS.execution, { scope });
            if (record.state !== 'valid')
                return null;
            try {
                return parseExecutionRecord(record.text);
            }
            catch {
                return null;
            }
        });
        if (execution === 'absent')
            return;
        if (execution === null) {
            throw new Error(`Command ${commandId} cannot be quarantined: its execution record is unreadable, so its runner is not proven stopped.`);
        }
        const liveness = processGroupLiveness(execution.processGroupId);
        if (liveness !== 'inactive') {
            throw new Error(`Command ${commandId} cannot be quarantined: its execution process group is ${liveness}.`);
        }
    }
    async acquireQuarantineLock(manifest, commandId) {
        try {
            await this.withRootScope(async (scope) => atomicCreatePrivateRecord(this.lockPath, manifest.operation.id, { scope }));
        }
        catch (error) {
            if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
                throw new Error(`The active lock was taken by ${await this.readLockOwner() ?? 'unknown'} first; command ${commandId} ` +
                    'stays refused while its quarantine is pending. Run the quarantine again once the lock is free.');
            }
            throw error;
        }
    }
    async completeQuarantine(commandId, initial, selfUid, hooks) {
        let manifest = initial;
        const operationId = manifest.operation.id;
        const live = this.files(commandId).directory;
        const commandsRoot = join(this.root, 'commands');
        const { base, area } = quarantineArea(this.root, 'commands');
        const moved = join(area, commandId);
        const scopeRequirements = [
            { path: this.root, description: 'state root' },
            { path: commandsRoot, description: 'commands directory' },
            { path: base, description: 'quarantine directory' },
            { path: area, description: 'quarantine commands directory' },
        ];
        const rootDevice = await stateRootDevice(this.root);
        if (!await pathExists(moved)) {
            const candidate = await this.quarantineCandidate(commandId, selfUid);
            const current = candidate.snapshot;
            if (current === undefined || !snapshotMatches(manifest, current, rootDevice)) {
                if (!candidate.quarantinable) {
                    await this.releaseQuarantineLock(operationId);
                    throw new Error(`Command ${commandId} no longer matches its quarantine manifest and cannot be quarantined ` +
                        `(${candidate.reasons.join('; ')}). Nothing was moved; the command stays refused for good.`);
                }
                manifest = { ...manifest, quarantinedAt: new Date().toISOString(), ...candidate.snapshot };
                await publishQuarantineManifest(this.root, 'commands', manifest, 'replace', hooks);
            }
            await withPrivateDirectoryScope(scopeRequirements, async (scope) => {
                if (await this.readLockOwner() !== operationId)
                    throw new Error('The quarantine lost its active lock before the move.');
                if (await pathExists(moved)) {
                    throw new Error(`${moved} appeared before the move; nothing was moved.`);
                }
                const source = await lstat(live, { bigint: true });
                if (source.ino.toString() !== manifest.source.ino)
                    throw new Error(`${live} was replaced before the move; nothing was moved.`);
                await rename(live, moved);
                await hooks.boundary?.('renamed');
                await scope.assertStable();
                await scope.syncDirectory(area);
                await scope.syncDirectory(commandsRoot);
            });
            await hooks.boundary?.('moved');
        }
        const movedCandidate = await withPrivateDirectoryScope(scopeRequirements, async () => await inspectCommandDirectory(moved, selfUid));
        if (movedCandidate?.snapshot === undefined || !snapshotMatches(manifest, movedCandidate.snapshot, rootDevice)) {
            throw new Error(`The quarantined state of ${commandId} under ${moved} no longer matches its manifest; the quarantine ` +
                `lock ${operationId} is kept and the state needs manual inspection.`);
        }
        await this.withCommandsScope(async (scope) => {
            try {
                await mkdir(live, { mode: 0o700 });
                await hooks.boundary?.('placeholder_created');
            }
            catch (error) {
                if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'))
                    throw error;
            }
            const placeholder = await lstat(live);
            if (!placeholder.isDirectory() || placeholder.isSymbolicLink() || placeholder.uid !== selfUid ||
                (placeholder.mode & 0o7777) !== 0o700 || (await readdir(live)).length > 0) {
                throw new Error(`${live} is not an empty private placeholder; the quarantine lock ${operationId} is kept.`);
            }
            await scope.assertStable();
            await scope.syncLeafParent();
        });
        await this.releaseQuarantineLock(operationId);
    }
    async releaseQuarantineLock(operationId) {
        await this.release(operationId);
        if (await this.readLockOwner() === operationId)
            throw new Error('The quarantine could not verify its lock release.');
    }
    async readCommandRecord(commandId, path, maxBytes) {
        try {
            await lstat(this.files(commandId).directory);
        }
        catch (error) {
            if (isMissingPath(error))
                return { state: 'missing' };
            return { state: 'invalid', reason: 'unsafe_command_directory' };
        }
        try {
            return await this.withCommandScope(commandId, async (scope) => readSecurePrivateRecord(path, maxBytes, { scope }));
        }
        catch (error) {
            if (isMissingPath(error))
                return { state: 'missing' };
            return { state: 'invalid', reason: 'unsafe_command_directory' };
        }
    }
    async validateCommandDirectory(commandId) {
        await validatePrivateDirectory(this.root, 0o700, 'state root');
        await validatePrivateDirectory(join(this.root, 'commands'), 0o700, 'commands directory');
        await validatePrivateDirectory(this.files(commandId).directory, 0o700, 'command directory');
    }
    validateCommandFiles(files) {
        const expected = this.files(files.commandId);
        if (COMMAND_FILE_KEYS.some((key) => files[key] !== expected[key])) {
            throw new Error('Command files must match the canonical paths for their command ID.');
        }
        return expected;
    }
    async withRootScope(operation) {
        return await withPrivateDirectoryScope([
            { path: this.root, description: 'state root' },
        ], operation);
    }
    async withCommandsScope(operation) {
        return await withPrivateDirectoryScope([
            { path: this.root, description: 'state root' },
            { path: join(this.root, 'commands'), description: 'commands directory' },
        ], operation);
    }
    async withCommandScope(commandId, operation) {
        const files = this.files(commandId);
        return await withPrivateDirectoryScope([
            { path: this.root, description: 'state root' },
            { path: join(this.root, 'commands'), description: 'commands directory' },
            { path: files.directory, description: 'command directory' },
        ], operation);
    }
    async prune() {
        const commandsRoot = join(this.root, 'commands');
        const retentionDays = Number(process.env.ILLUSTRATOR_STUDIO_MCP_RETENTION_DAYS ?? '7');
        const maxCommands = Number(process.env.ILLUSTRATOR_STUDIO_MCP_MAX_COMMANDS ?? '200');
        if (!Number.isFinite(retentionDays) || retentionDays < 1 || !Number.isInteger(maxCommands) || maxCommands < 1) {
            throw new Error('Command retention settings must be positive numbers.');
        }
        const active = await this.readLockOwner();
        const directories = await this.withCommandsScope(async (scope) => {
            const entries = await readdir(commandsRoot, { withFileTypes: true });
            const records = await Promise.all(entries
                .filter((entry) => entry.isDirectory() && isCanonicalCommandId(entry.name))
                .map(async (entry) => ({
                commandId: entry.name,
                path: join(commandsRoot, entry.name),
                modifiedAt: (await stat(join(commandsRoot, entry.name))).mtimeMs,
            })));
            await scope.assertStable();
            return records;
        });
        directories.sort((a, b) => b.modifiedAt - a.modifiedAt);
        const cutoff = Date.now() - retentionDays * 86_400_000;
        await Promise.all(directories.map(async (entry, index) => {
            if (entry.commandId === active)
                return;
            if (entry.modifiedAt >= cutoff && index < maxCommands)
                return;
            const metadata = await this.inspectMetadata(entry.commandId);
            if (metadata.state !== 'valid' || metadata.value.kind === 'mutation')
                return;
            await this.deleteReadCommand(entry.commandId);
        }));
    }
    async deleteReadCommand(commandId) {
        const files = this.files(commandId);
        await this.withCommandScope(commandId, async (scope) => {
            const names = await readdir(files.directory);
            if (names.length > 128)
                throw new Error('Read command directory contains too many artifacts to delete safely.');
            const paths = [];
            for (const name of names) {
                if (!/^[A-Za-z0-9._-]{1,128}$/.test(name) || name.includes('..')) {
                    throw new Error(`Read command directory contains an unsafe artifact name: ${files.directory} entry ${JSON.stringify(name)}.`);
                }
                const path = join(files.directory, name);
                const metadata = await lstat(path);
                if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.() ||
                    (metadata.mode & 0o7777) !== 0o600) {
                    throw unsafeStateEntriesError('Read command directory cleanup', [
                        `unsafe artifact: ${describeStateEntry(path, metadata, 0o600)}`,
                    ]);
                }
                paths.push(path);
            }
            const metadataPath = join(files.directory, 'metadata.json');
            await unlinkPrivateRecords(paths.filter((path) => path !== metadataPath), { scope });
            if (paths.includes(metadataPath))
                await unlinkPrivateRecord(metadataPath, { scope });
        });
        await this.withCommandsScope(async (scope) => {
            await scope.assertStable();
            await rmdir(files.directory);
            await scope.syncLeafParent();
        });
    }
}
