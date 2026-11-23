import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, rename, rmdir, stat, statfs, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { realpathSync } from 'node:fs';
import { basename, join } from 'node:path';
import { LockObservationBudget, LockObservationBudgetExhaustedError } from './lock-observation-budget.js';
import { QuotaScanCache } from './quota-scan-cache.js';
import { CANONICAL_COMMAND_ID_MESSAGE, isCanonicalCommandId } from './command-id.js';
import { PRE_CREATE_LOCK_FAMILIES, } from './pre-create-lock-types.js';
import { CommandQuarantinedError, CommandReleasedAsOrphanError, CommandReleasedUnverifiedError } from './domain.js';
import { pathContainsPercentEscape } from './file-path.js';
import { describeStateEntry, ensurePrivateDirectory, ensurePrivateStateRoot, isMissingPath, isWindowsPrivateState, privateOwnerModeViolation, unsafeStateEntriesError, validatePrivateDirectory, validatePrivateStateRoot, withPrivateDirectoryScope, } from './private-state.js';
import { PRIVATE_RECORD_LIMITS, atomicCreatePrivateRecord, atomicCreatePrivateRecords, atomicReplacePrivateRecord, createEmptyPrivateStagingRecords, readSecurePrivateRecord, unlinkPrivateRecord, unlinkPrivateRecords, } from './private-record.js';
import { rectangleResultSchema as legacyRectangleResultSchema } from './legacy-rectangle-result-v1.js';
import { parseCompletedResultEnvelope, validateMutationResultArtifact } from './mutation-result-validator.js';
import { classifyCommandDirectory, ensureQuarantineArea, inspectCommandDirectory, publishQuarantineManifest, quarantineArea, quarantineManifestExists, readQuarantineManifest, scanCommandQuarantineArea, snapshotMatches, stateRootDevice, temporaryTwinPattern, } from './state-quarantine.js';
import { defaultMutationOperationRegistry } from './default-mutation-operation-adapters.js';
import { legacyCommandMetadata, legacyCompactIdempotency, legacyFinalization, } from './legacy-mutation-state-v1.js';
import { currentUid, PlatformUnsupportedError } from './platform-primitives.js';
import { windowsPathComponentRejection } from './windows/output-path.js';
import { isFileTime, parseExecutionRecord, prepareExecutionRecord, executionIdentityMatches, executionRecordsMatch } from './execution-record.js';
export { parseExecutionRecord } from './execution-record.js';
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
export const ORPHAN_PRECREATE_MARKER_NAME = 'orphan-precreate-release.json';
export { PRE_CREATE_LOCK_FAMILIES } from './pre-create-lock-types.js';
const RELEASE_CLAIM_WAIT_MS = 250;
const heldReleaseClaims = new Set();
const RELEASE_CLAIM_NONCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const COMMAND_CREATED_NOT_STARTED_MESSAGE = 'Command created but not started.';
export const AUTO_RELEASE_STATUS_PREFIX = 'Command was released automatically by a later call:';
export const AUTO_RELEASE_RECORD_NAME = 'auto-release.json';
export class LockReleaseInProgressError extends Error {
    commandId;
    claimPath;
    constructor(commandId, claimPath) {
        super(`The Illustrator lock of command ${commandId} is being released by another call (${basename(claimPath)}). ` +
            'The lock is kept and nothing was lost: wait a moment and retry the same action (for example illustrator_reconcile with action=abandon). ' +
            `If it keeps failing and no illustrator-studio-mcp process is running, remove the files named active-command.lock.release-${commandId}* from the state root and retry.`);
        this.commandId = commandId;
        this.claimPath = claimPath;
        this.name = 'LockReleaseInProgressError';
    }
}
export class CommandLockedError extends Error {
    commandId;
    constructor(commandId, diagnosis) {
        super(`Illustrator is reserved by command ${commandId}${diagnosis === undefined ? '' : ` (${diagnosis.summary})`}. ` +
            `${diagnosis === undefined ? '' : `${diagnosis.nextSteps} `}` +
            'If that command is still running (a call from another ' +
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
    const root = resolveStateRoot();
    if (pathContainsPercentEscape(root))
        throw new Error(`The state root contains a '%' escape ('%' and two hex digits), which ExtendScript would decode (#848): ${root}. Use ILLUSTRATOR_STUDIO_MCP_STATE_DIR with a path that has none.`);
    return root;
}
function resolveStateRoot() {
    if (process.env.ILLUSTRATOR_STUDIO_MCP_STATE_DIR !== undefined)
        return process.env.ILLUSTRATOR_STUDIO_MCP_STATE_DIR;
    if (process.platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA;
        if (localAppData === undefined || localAppData === '')
            throw new Error('LOCALAPPDATA is not set; the state root cannot be located.');
        return join(realpathSync.native(localAppData), 'illustrator-studio-mcp');
    }
    return join(homedir(), 'Library', 'Application Support', 'illustrator-studio-mcp');
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
const WINDOWS_RELEASED_UNVERIFIED_EVIDENCE_KEYS = [
    'adapterResolved', 'executionCreationTime', 'executionNonce', 'executionProcessId', 'resultDigest', 'resultDigestAlgorithm',
].join(',');
function releasedEvidenceIdentityValid(evidence) {
    const keys = Object.keys(evidence).sort().join(',');
    const pid = keys === RELEASED_UNVERIFIED_EVIDENCE_KEYS ? evidence.executionProcessGroupId : evidence.executionProcessId;
    return typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0 &&
        (keys === RELEASED_UNVERIFIED_EVIDENCE_KEYS ||
            (keys === WINDOWS_RELEASED_UNVERIFIED_EVIDENCE_KEYS && isFileTime(evidence.executionCreationTime)));
}
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
        !releasedEvidenceIdentityValid(evidence) ||
        typeof evidence.executionNonce !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(evidence.executionNonce) ||
        evidence.resultDigestAlgorithm !== 'sha256' ||
        (evidence.resultDigest !== null &&
            (typeof evidence.resultDigest !== 'string' || !/^[0-9a-f]{64}$/.test(evidence.resultDigest))) ||
        typeof evidence.adapterResolved !== 'boolean')
        return null;
    return value;
}
export const CAPACITY_SCAN_LSTAT_CONCURRENCY = 16;
export async function lstatAllInOrder(paths, limit, statPath = lstat) {
    if (!Number.isSafeInteger(limit) || limit < 1)
        throw new Error('lstat concurrency must be a positive integer.');
    const settled = new Array(paths.length);
    let next = 0;
    const worker = async () => {
        while (next < paths.length) {
            const index = next;
            next += 1;
            try {
                settled[index] = { status: 'fulfilled', value: await statPath(paths[index]) };
            }
            catch (reason) {
                settled[index] = { status: 'rejected', reason };
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, paths.length) }, worker));
    return settled.map((result) => {
        if (result.status === 'rejected')
            throw result.reason;
        return result.value;
    });
}
export class FileCommandStore {
    root;
    lockPath;
    mutationQuota;
    availableBytes;
    registry;
    quarantinesInFlight = new Set();
    capacityScanCache;
    releaseBoundary;
    releaseClaimWaitMs;
    lockObservation;
    fenceBoundary;
    constructor(root = defaultStateRoot(), options = {}) {
        this.root = root;
        this.lockPath = join(root, 'active-command.lock');
        this.mutationQuota = options.mutationQuota ?? DEFAULT_MUTATION_STATE_QUOTA;
        this.availableBytes = options.availableBytes ?? (async (path) => {
            const filesystem = await statfs(path, { bigint: true });
            return filesystem.bavail * filesystem.bsize;
        });
        this.capacityScanCache = new QuotaScanCache(options.capacityScanClock);
        this.registry = options.registry ?? defaultMutationOperationRegistry();
        this.releaseBoundary = options.releaseBoundary;
        this.releaseClaimWaitMs = options.releaseClaimWaitMs ?? RELEASE_CLAIM_WAIT_MS;
        this.lockObservation = options.lockObservation;
        this.fenceBoundary = options.fenceBoundary;
        if (!this.registry.isSealed())
            throw new Error('FileCommandStore requires a sealed mutation adapter registry.');
    }
    async initialize() {
        await this.ensureStateDirectories();
        await this.prune();
    }
    async ensureStateDirectories() {
        await ensurePrivateStateRoot(this.root);
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
            try {
                await mkdir(directory, { mode: 0o700 });
            }
            catch (error) {
                if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST' && await this.hasOrphanFence(commandId)) {
                    throw new CommandReleasedAsOrphanError(commandId);
                }
                throw error;
            }
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
        await this.writeStatus(files, { commandId, state: 'unknown', message: COMMAND_CREATED_NOT_STARTED_MESSAGE });
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
    orphanMarkerPath(commandId) {
        return join(this.files(commandId).directory, ORPHAN_PRECREATE_MARKER_NAME);
    }
    async hasOrphanFence(commandId) {
        try {
            const entry = await lstat(this.orphanMarkerPath(commandId));
            return entry.isFile() && !entry.isSymbolicLink();
        }
        catch (error) {
            if (isMissingPath(error) || (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOTDIR'))
                return false;
            throw error;
        }
    }
    async inspectFenceDirectory(commandId) {
        const files = this.files(commandId);
        const entry = await lstat(files.directory).catch((error) => {
            if (isMissingPath(error))
                return null;
            throw error;
        });
        if (entry === null)
            return { state: 'absent' };
        if (!entry.isDirectory() || entry.isSymbolicLink()) {
            return { state: 'other', reason: 'command_directory_present', message: `${files.directory} exists and is not a command directory.` };
        }
        return await this.withCommandScope(commandId, async (scope) => {
            const names = await readdir(files.directory);
            const twin = new RegExp(`^${ORPHAN_PRECREATE_MARKER_NAME.replaceAll('.', '\\.')}\\.[0-9a-f-]{36}\\.tmp$`, 'u');
            const unexpected = names.filter((name) => name !== ORPHAN_PRECREATE_MARKER_NAME && !twin.test(name));
            if (unexpected.length > 0) {
                return { state: 'other', reason: 'command_directory_present', message: `The command directory of ${commandId} exists and holds entries (${unexpected.length}); the command protocol started.` };
            }
            if (!names.includes(ORPHAN_PRECREATE_MARKER_NAME)) {
                return { state: 'other', reason: 'fence_incomplete', message: `The command directory of ${commandId} exists and is empty: it cannot be told from a directory a stopped server made, so the lock is kept.` };
            }
            const record = await readSecurePrivateRecord(join(files.directory, ORPHAN_PRECREATE_MARKER_NAME), PRIVATE_RECORD_LIMITS.metadata, { scope, maxLinkCount: 2 });
            await scope.assertStable();
            if (record.state !== 'valid') {
                return { state: 'other', reason: 'fence_incomplete', message: `The fence marker of ${commandId} is not readable; the lock is kept.` };
            }
            let value;
            try {
                value = JSON.parse(record.text);
            }
            catch {
                return { state: 'other', reason: 'fence_incomplete', message: `The fence marker of ${commandId} is not JSON; the lock is kept.` };
            }
            if (Object.keys(value).sort().join(',') !== 'commandId,family,kind,nonce,pid,releasedAt,sessionDigest,sessionId,version' ||
                value.version !== 1 || value.kind !== 'orphan_precreate_release' || value.commandId !== commandId ||
                !PRE_CREATE_LOCK_FAMILIES.includes(value.family) || typeof value.sessionId !== 'string' ||
                typeof value.sessionDigest !== 'string' || !/^[0-9a-f]{64}$/.test(value.sessionDigest) ||
                typeof value.nonce !== 'string' || !RELEASE_CLAIM_NONCE.test(value.nonce) || !Number.isInteger(value.pid) ||
                !hasCanonicalTimestamp(value.releasedAt)) {
                return { state: 'other', reason: 'fence_incomplete', message: `The fence marker of ${commandId} has an unknown shape; the lock is kept.` };
            }
            return { state: 'fence', marker: value };
        });
    }
    async releaseProvenPreCreateLock(commandId, evidence) {
        const files = this.files(commandId);
        const refuse = (reason, message) => ({ state: 'refused', reason, message });
        if (isWindowsPrivateState())
            return refuse('unsupported_platform', 'Releasing a lock that never reached its command directory is defined for POSIX only.');
        if (evidence.kind !== 'external_session_open_pending' || !PRE_CREATE_LOCK_FAMILIES.includes(evidence.family) ||
            evidence.boundCommandId !== commandId || !/^[0-9a-f]{64}$/.test(evidence.sessionDigest) ||
            !/^\d+$/.test(evidence.sessionIdentity.dev) || !/^\d+$/.test(evidence.sessionIdentity.ino) ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(evidence.sessionId)) {
            return refuse('invalid_evidence', 'The lease evidence is not an exact binding to this lock owner.');
        }
        if (await this.readLockOwner(this.createLockObservationBudget(), 'eligibility_owner') !== commandId) {
            return refuse('not_lock_owner', `Command ${commandId} does not hold the active lock.`);
        }
        if (await this.isQuarantined(commandId) || await this.findQuarantineOperation(commandId) !== null) {
            return refuse('quarantined', `Command ${commandId} is quarantined or the lock belongs to a quarantine.`);
        }
        if ((await this.inspectCompactIdempotency(commandId)).state !== 'missing') {
            return refuse('compact_record', `Command ${commandId} has a compact idempotency record.`);
        }
        const leaseUnchanged = async () => {
            const current = await evidence.reread();
            if (current === 'gone')
                return refuse('evidence_gone', `The lease ${evidence.sessionId} is gone.`);
            if (current === 'ambiguous')
                return refuse('evidence_ambiguous', `More than one lease names ${commandId} as its open command.`);
            if (current.boundCommandId !== commandId || current.sessionDigest !== evidence.sessionDigest ||
                current.sessionIdentity.dev !== evidence.sessionIdentity.dev || current.sessionIdentity.ino !== evidence.sessionIdentity.ino) {
                return refuse('evidence_changed', `The lease ${evidence.sessionId} changed since it was read.`);
            }
            return null;
        };
        const directory = await this.inspectFenceDirectory(commandId);
        let fence;
        if (directory.state === 'other')
            return refuse(directory.reason, directory.message);
        if (directory.state === 'fence') {
            if (directory.marker.family !== evidence.family || directory.marker.sessionId !== evidence.sessionId ||
                directory.marker.sessionDigest !== evidence.sessionDigest) {
                return refuse('fence_mismatch', `The fence marker of ${commandId} names another lease; the lock is kept.`);
            }
            const unchanged = await leaseUnchanged();
            if (unchanged !== null)
                return unchanged;
            fence = 'resumed';
        }
        else {
            const unchanged = await leaseUnchanged();
            if (unchanged !== null)
                return unchanged;
            const made = await this.withCommandsScope(async (scope) => {
                await scope.assertStable();
                try {
                    await mkdir(files.directory, { mode: 0o700 });
                }
                catch (error) {
                    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST')
                        return false;
                    throw error;
                }
                await scope.assertStable();
                await scope.syncLeafParent();
                return true;
            });
            if (!made)
                return refuse('command_directory_appeared', `The command directory of ${commandId} appeared while it was checked; the command protocol started.`);
            await this.fenceBoundary?.('after_mkdir');
            const marker = {
                version: 1, kind: 'orphan_precreate_release', commandId, family: evidence.family, sessionId: evidence.sessionId,
                sessionDigest: evidence.sessionDigest, releasedAt: new Date().toISOString(), pid: process.pid, nonce: randomUUID(),
            };
            await this.withCommandScope(commandId, async (scope) => atomicCreatePrivateRecord(this.orphanMarkerPath(commandId), JSON.stringify(marker), { scope }));
            await this.fenceBoundary?.('after_marker');
            fence = 'created';
        }
        const stillBound = await leaseUnchanged();
        if (stillBound !== null)
            return stillBound;
        await this.fenceBoundary?.('before_release');
        if (await this.readLockOwner(this.createLockObservationBudget(), 'pre_release_owner') === commandId) {
            await this.release(commandId);
            if (await this.readLockOwner(this.createLockObservationBudget(), 'completion_owner') === commandId) {
                throw new Error(`The lock of ${commandId} could not be verified as released after its fence.`);
            }
        }
        return { state: 'released', fence };
    }
    createLockObservationBudget() {
        return new LockObservationBudget(this.releaseClaimWaitMs, this.lockObservation);
    }
    async release(commandId, budget = this.createLockObservationBudget()) {
        this.files(commandId);
        if (await this.readLockOwner(budget) !== commandId)
            return;
        const compact = await this.inspectCompactIdempotency(commandId);
        if (compact.state === 'valid') {
            switch (compact.value.kind) {
                case 'tombstone':
                    await this.assertNoTombstoneTerminalArtifacts(commandId);
                    break;
                case 'released_unverified':
                    await this.assertReleasedUnverifiedBinding(compact.value);
                    if ('executionProcessId' in compact.value.evidence && await this.readLockOwner(budget, 'released_owner') !== commandId)
                        return;
                    break;
                case 'replay_bundle':
                    break;
                default:
                    assertNeverTerminalKind(compact.value);
            }
        }
        await this.releaseBoundary?.('before_claim');
        await this.unlinkLockUnderClaim(commandId, budget);
    }
    releaseClaimPath(commandId) {
        return `${this.lockPath}.release-${commandId}`;
    }
    async tryCreateReleaseClaim(path, commandId) {
        const record = JSON.stringify({ version: 1, commandId, pid: process.pid, nonce: randomUUID() });
        const added = !heldReleaseClaims.has(path);
        if (added)
            heldReleaseClaims.add(path);
        try {
            await this.withRootScope(async (scope) => atomicCreatePrivateRecord(path, record, { scope, unsynced: true }));
            return true;
        }
        catch (error) {
            if (added)
                heldReleaseClaims.delete(path);
            if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST')
                return false;
            throw error;
        }
    }
    async removeReleaseClaims(paths) {
        for (const path of paths) {
            try {
                await this.withRootScope(async (scope) => unlinkPrivateRecord(path, { scope, unsynced: true })).catch((error) => {
                    if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'))
                        throw error;
                });
            }
            finally {
                heldReleaseClaims.delete(path);
            }
        }
    }
    async unlinkLockUnderClaim(commandId, budget) {
        const claimPath = this.releaseClaimPath(commandId);
        try {
            while (true) {
                await budget.enter('claim_create');
                if (await this.tryCreateReleaseClaim(claimPath, commandId)) {
                    await this.unlinkLockHoldingClaims(commandId, 'after_claim', [claimPath], [claimPath], budget);
                    return;
                }
                budget.startWaiting();
                if (await this.waitOnHeldReleaseClaim(commandId, claimPath, budget) === 'done')
                    return;
            }
        }
        catch (error) {
            if (error instanceof LockObservationBudgetExhaustedError)
                throw new LockReleaseInProgressError(commandId, claimPath);
            throw error;
        }
    }
    async unlinkLockHoldingClaims(commandId, boundary, removeOnFailure, removeOnSuccess, budget) {
        try {
            await this.releaseBoundary?.(boundary);
            if (await this.readLockOwner(budget, 'authority_owner') === commandId) {
                await this.withRootScope(async (scope) => unlinkPrivateRecord(this.lockPath, { scope })).catch((error) => {
                    if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'))
                        throw error;
                });
            }
        }
        catch (error) {
            await this.removeReleaseClaims(removeOnFailure).catch(() => undefined);
            throw error;
        }
        await this.removeReleaseClaims(removeOnSuccess);
    }
    async readReleaseClaim(path, commandId, budget) {
        await budget.enter('held_claim');
        let record;
        while (true) {
            record = await this.withRootScope(async (scope) => readSecurePrivateRecord(path, PRIVATE_RECORD_LIMITS.metadata, { scope, maxLinkCount: 2 }));
            if (record.state !== 'invalid' || !this.canReobserveLockSample(record.reason) || !await budget.retry('held_claim'))
                break;
        }
        if (record.state === 'missing')
            return { state: 'missing' };
        if (record.state === 'invalid')
            return { state: 'unsafe', reason: record.reason };
        try {
            const parsed = JSON.parse(record.text);
            if (parsed.version === 1 && parsed.commandId === commandId && typeof parsed.pid === 'number' && Number.isInteger(parsed.pid) &&
                parsed.pid > 0 && typeof parsed.nonce === 'string' && RELEASE_CLAIM_NONCE.test(parsed.nonce)) {
                return { state: 'valid', pid: parsed.pid, nonce: parsed.nonce };
            }
        }
        catch (_error) {
        }
        return { state: 'unparsable' };
    }
    releaseClaimHolderIsGone(claimPath, pid) {
        if (pid === process.pid)
            return !heldReleaseClaims.has(claimPath);
        try {
            process.kill(pid, 0);
            return false;
        }
        catch (error) {
            return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH';
        }
    }
    async waitOnHeldReleaseClaim(commandId, claimPath, budget) {
        while (true) {
            if (await this.readLockOwner(budget, 'held_owner') !== commandId)
                return 'done';
            await this.releaseBoundary?.('claim_held');
            const claim = await this.readReleaseClaim(claimPath, commandId, budget);
            if (claim.state === 'missing')
                return 'retry';
            if (claim.state === 'unsafe') {
                throw new Error(`The release claim ${basename(claimPath)} is unsafe (${claim.reason}); the lock of ${commandId} is kept.`);
            }
            if (claim.state === 'unparsable' || (claim.state === 'valid' && this.releaseClaimHolderIsGone(claimPath, claim.pid))) {
                await this.takeOverReleaseClaim(commandId, claimPath, claim.state === 'valid' ? claim.nonce : 'unparsable', budget);
                return 'done';
            }
        }
    }
    async takeOverReleaseClaim(commandId, claimPath, key, budget) {
        const takeoverPath = `${claimPath}.takeover-${key}`;
        await budget.enter('takeover_create');
        if (await this.tryCreateReleaseClaim(takeoverPath, commandId)) {
            await this.unlinkLockHoldingClaims(commandId, 'after_takeover', [takeoverPath], [claimPath, takeoverPath], budget);
            return;
        }
        budget.startWaiting();
        try {
            while (await this.readLockOwner(budget, 'takeover_owner') === commandId) { }
        }
        catch (error) {
            if (error instanceof LockObservationBudgetExhaustedError)
                throw new LockReleaseInProgressError(commandId, takeoverPath);
            throw error;
        }
    }
    canReobserveLockSample(reason) {
        return reason === 'changed_during_read' || reason === 'unexpected_link_count';
    }
    async readLockOwner(budget = this.createLockObservationBudget(), phase = 'owner') {
        await budget.enter(phase);
        while (true) {
            try {
                await validatePrivateStateRoot(this.root);
            }
            catch (error) {
                if (isMissingPath(error))
                    return null;
                throw error;
            }
            const record = await this.withRootScope(async (scope) => readSecurePrivateRecord(this.lockPath, PRIVATE_RECORD_LIMITS.lock, { scope }));
            if (record.state === 'missing')
                return null;
            if (record.state === 'invalid') {
                if (this.canReobserveLockSample(record.reason) && await budget.retry(phase))
                    continue;
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
            runnerPath: join(directory, process.platform === 'win32' ? 'runner.ps1' : 'runner.applescript'),
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
    async inspectMetadataStructure(commandId, directory) {
        const files = this.files(commandId);
        try {
            const record = await this.readCommandRecord(commandId, join(files.directory, 'metadata.json'), PRIVATE_RECORD_LIMITS.metadata, directory);
            if (record.state === 'missing') {
                try {
                    await this.validateBarrierDirectory(commandId, directory);
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
    async prepareHostArtifactTemps(files, options = {}) {
        files = this.validateCommandFiles(files);
        const paths = [
            `${files.resultPath}.tmp`,
            `${files.statusPath}.running.json.tmp`,
            `${files.statusPath}.host_completed.json.tmp`,
            `${files.statusPath}.completed.json.tmp`,
            `${files.statusPath}.failed.json.tmp`,
            ...(options.auditEvents === false ? [] : Array.from({ length: 32 }, (_unused, index) => `${files.statusPath}.audit.${String(index).padStart(3, '0')}.json.tmp`)),
        ];
        const running = new Map([[`${files.statusPath}.running.json.tmp`, JSON.stringify({ commandId: files.commandId, state: 'running' })]]);
        await this.withCommandScope(files.commandId, async (scope) => createEmptyPrivateStagingRecords(paths, { scope }, running));
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
    async inspectFinalization(commandId, directory) {
        const path = this.files(commandId).finalizationPath;
        try {
            const record = await this.readCommandRecord(commandId, path, PRIVATE_RECORD_LIMITS.finalization, directory);
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
    async inspectCompactIdempotency(commandId, directory) {
        const files = this.files(commandId);
        try {
            const record = await this.readCommandRecord(commandId, files.idempotencyPath, PRIVATE_RECORD_LIMITS.idempotency, directory);
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
                if (terminal.evidence === 'never_started')
                    await this.assertNeverStartedMutationEvidence(files.commandId, false);
                else
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
                if (!metadata.isFile() || metadata.isSymbolicLink() || privateOwnerModeViolation(metadata, 0o600) !== null ||
                    (isWindowsPrivateState() && windowsPathComponentRejection(name) !== null)) {
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
                await scope.assertStable();
                await unlink(path);
                await options.boundary?.('artifact_unlinked', name);
                if (record.kind === 'tombstone')
                    await this.assertNoTombstoneTerminalArtifacts(files.commandId);
            }
            await scope.assertStable();
            await scope.syncLeafParent();
            await options.boundary?.('cleanup_synced');
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
        const budget = this.createLockObservationBudget();
        await this.release(files.commandId, budget);
        if (await this.readLockOwner(budget, 'completion_owner') === files.commandId) {
            throw new Error('Proven pre-apply terminalization could not verify command lock release.');
        }
        return compacted;
    }
    async windowsQuarantineAreaScan() {
        const { base } = quarantineArea(this.root, 'commands');
        try {
            await lstat(base);
        }
        catch (error) {
            if (isMissingPath(error))
                return { bytes: 0n, quarantined: 0, violations: [] };
            throw error;
        }
        return { bytes: 0n, quarantined: 0, violations: [
                `quarantine area present but Windows does not implement quarantine: ${base}`,
            ] };
    }
    async inspectNeverStartedMutation(commandId) {
        try {
            await this.assertNeverStartedMutationEvidence(commandId);
            return true;
        }
        catch (_error) {
            return false;
        }
    }
    async assertNeverStartedMutationEvidence(commandId, requireStaging = true) {
        if (!isWindowsPrivateState())
            throw new Error('Never-started mutation recovery is defined for Windows only.');
        const files = this.files(commandId);
        const fail = (reason) => {
            throw new Error(`Command ${commandId} is not provably an unstarted mutation: ${reason}.`);
        };
        if (await this.readLockOwner() !== commandId)
            fail('it does not own the active command lock');
        if ((await this.readMetadata(commandId))?.kind !== 'mutation')
            fail('its metadata is not a valid mutation record');
        if ((await this.inspectCompactIdempotency(commandId)).state !== 'missing')
            fail('a compact idempotency record exists');
        if ((await this.readExecution(commandId)).state !== 'missing')
            fail('an execution record exists');
        if (await this.hostRunningPublished(commandId))
            fail('the host running marker exists');
        const status = await this.readStatus(commandId);
        if (status.state !== 'unknown' || status.message !== COMMAND_CREATED_NOT_STARTED_MESSAGE)
            fail('its status is not the created state');
        const published = new Set(['metadata.json', 'status.json.unknown.json', 'params.json', 'command.jsx', 'runner.ps1']);
        const stagingNames = new Set([
            'result.json.tmp',
            'status.json.running.json.tmp',
            'status.json.host_completed.json.tmp',
            'status.json.completed.json.tmp',
            'status.json.failed.json.tmp',
            ...Array.from({ length: 32 }, (_unused, index) => `status.json.audit.${String(index).padStart(3, '0')}.json.tmp`),
        ]);
        const twinBases = new Set([...published, 'execution.json']);
        await this.withCommandScope(commandId, async (scope) => {
            const names = await readdir(files.directory);
            if (names.length > 128)
                fail('the directory holds too many entries');
            if (requireStaging && !names.includes('status.json.running.json.tmp'))
                fail('the host staging was not prepared (the creating process may still be running)');
            for (const name of names) {
                const twin = /^(.+)\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/u.exec(name);
                if (!published.has(name) && !stagingNames.has(name) && !(twin !== null && twinBases.has(twin[1]))) {
                    fail(`unexpected entry ${JSON.stringify(name)}`);
                }
            }
            for (const name of names) {
                const metadata = await lstat(join(files.directory, name));
                if (!metadata.isFile() || metadata.isSymbolicLink())
                    fail(`entry ${JSON.stringify(name)} is not a regular file`);
            }
            await scope.assertStable();
        });
    }
    async finalizeNeverStartedMutation(files, metadata, options = {}) {
        files = this.validateCommandFiles(files);
        const existing = await this.inspectCompactIdempotency(files.commandId);
        let finalizedAt = new Date().toISOString();
        if (existing.state === 'valid' && existing.value.kind === 'tombstone')
            finalizedAt = existing.value.finalizedAt;
        else {
            await this.assertNeverStartedMutationEvidence(files.commandId);
            await options.neverStartedBoundary?.('before_retire');
            await this.retireUnstartedHostArtifacts(files.commandId);
            await options.neverStartedBoundary?.('after_retire');
            await this.assertNeverStartedMutationEvidence(files.commandId, false);
        }
        const compacted = await this.compactMutationInternal(files, metadata, {
            kind: 'proven_pre_apply_failed',
            finalizedAt,
            evidence: 'never_started',
        }, options);
        if (compacted.kind !== 'tombstone')
            throw new Error('Never-started terminalization did not produce a tombstone.');
        const budget = this.createLockObservationBudget();
        await this.release(files.commandId, budget);
        if (await this.readLockOwner(budget, 'completion_owner') === files.commandId) {
            throw new Error('Never-started terminalization could not verify command lock release.');
        }
        return compacted;
    }
    async assertMutationCapacity() {
        try {
            await this.scanMutationCapacity();
        }
        catch (error) {
            this.capacityScanCache.clear();
            throw error;
        }
    }
    async scanMutationCapacity() {
        const quota = this.mutationQuota;
        if (!Number.isSafeInteger(quota.maxCommandCount) || quota.maxCommandCount < 1 ||
            !Number.isSafeInteger(quota.maxTotalBytes) || quota.maxTotalBytes < 1 ||
            !Number.isSafeInteger(quota.reservationBytes) || quota.reservationBytes < 1 ||
            quota.reservationBytes > quota.maxTotalBytes) {
            throw new Error('Mutation state quota configuration is invalid.');
        }
        const selfUid = isWindowsPrivateState() ? null : currentUid();
        const scanCache = this.capacityScanCache;
        await this.withCommandsScope(async (scope) => {
            const commandsRoot = join(this.root, 'commands');
            const entries = await readdir(commandsRoot, { withFileTypes: true });
            if (entries.length >= quota.maxCommandCount) {
                throw new Error('Mutation state quota is full; a new command ID cannot be applied.');
            }
            const useCache = selfUid !== null;
            const bypassCache = !useCache || scanCache.bypass(entries.length, quota.maxCommandCount, quota.maxTotalBytes);
            const verified = new Map();
            const violations = [];
            const violatingCommands = [];
            let totalBytes = 0n;
            for (const entry of entries) {
                const before = violations.length;
                const directory = join(commandsRoot, entry.name);
                const directoryStats = await lstat(directory, { bigint: true });
                const directoryMetadata = {
                    isFile: () => directoryStats.isFile(),
                    isDirectory: () => directoryStats.isDirectory(),
                    isSymbolicLink: () => directoryStats.isSymbolicLink(),
                    uid: Number(directoryStats.uid),
                    mode: Number(directoryStats.mode),
                };
                if (!entry.isDirectory() || !isCanonicalCommandId(entry.name)) {
                    violations.push(`unsafe command entry: ${describeStateEntry(directory, directoryMetadata, 0o700)}`);
                    continue;
                }
                if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink() ||
                    privateOwnerModeViolation(directoryMetadata, 0o700) !== null) {
                    violations.push(`unsafe command directory: ${describeStateEntry(directory, directoryMetadata, 0o700)}`);
                    violatingCommands.push(entry.name);
                    continue;
                }
                const cached = bypassCache ? null : scanCache.lookup(entry.name, directoryStats);
                if (cached !== null) {
                    verified.set(entry.name, cached);
                    totalBytes += cached.bytes;
                    continue;
                }
                let commandBytes = 0n;
                await this.withCommandScope(entry.name, async (commandScope) => {
                    const artifacts = await readdir(directory, { withFileTypes: true });
                    if (artifacts.length > 128) {
                        violations.push(`per-command artifact limit exceeded: ${directory} (artifacts=${artifacts.length}, limit=128)`);
                        await commandScope.assertStable();
                        return;
                    }
                    const artifactPaths = artifacts.map((artifact) => join(directory, artifact.name));
                    const artifactStats = await lstatAllInOrder(artifactPaths, CAPACITY_SCAN_LSTAT_CONCURRENCY);
                    for (const [index, artifact] of artifacts.entries()) {
                        const artifactPath = artifactPaths[index];
                        const artifactMetadata = artifactStats[index];
                        if (!artifact.isFile() || artifact.isSymbolicLink() ||
                            !artifactMetadata.isFile() || artifactMetadata.isSymbolicLink()) {
                            violations.push(`nonregular artifact: ${describeStateEntry(artifactPath, artifactMetadata, 0o600)}`);
                            continue;
                        }
                        if (privateOwnerModeViolation(artifactMetadata, 0o600) !== null ||
                            !Number.isSafeInteger(artifactMetadata.size) || artifactMetadata.size < 0) {
                            violations.push(`unsafe artifact: ${describeStateEntry(artifactPath, artifactMetadata, 0o600)}`);
                            continue;
                        }
                        commandBytes += BigInt(artifactMetadata.size);
                    }
                    await commandScope.assertStable();
                });
                totalBytes += commandBytes;
                if (violations.length > before)
                    violatingCommands.push(entry.name);
                else if (useCache) {
                    const fresh = scanCache.entry(directoryStats, commandBytes);
                    if (fresh !== null)
                        verified.set(entry.name, fresh);
                }
            }
            const quarantined = selfUid === null
                ? await this.windowsQuarantineAreaScan()
                : await scanCommandQuarantineArea(this.root, selfUid, commandsRoot);
            violations.push(...quarantined.violations);
            totalBytes += quarantined.bytes;
            await scope.assertStable();
            if (violations.length === 0 && useCache)
                scanCache.commit(verified, totalBytes);
            if (violations.length > 0) {
                throw unsafeStateEntriesError('Mutation state quota scan', violations, selfUid === null
                    ? ['Windows does not implement quarantine: the evidence is retained and no automatic repair was performed.']
                    : await this.quarantineGuidance(violatingCommands, selfUid));
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
    async hostRunningPublished(commandId) {
        try {
            const record = await this.readCommandRecord(commandId, `${this.files(commandId).statusPath}.running.json`, PRIVATE_RECORD_LIMITS.status);
            return record.state !== 'missing';
        }
        catch (_error) {
            return true;
        }
    }
    async retireUnstartedHostArtifacts(commandId, options = {}) {
        const files = this.files(commandId);
        const runningStarted = async () => {
            try {
                await lstat(`${files.statusPath}.running.json`);
                return true;
            }
            catch (error) {
                if (isMissingPath(error))
                    return false;
                return true;
            }
        };
        const refuse = () => new Error(`The host script of ${commandId} has started (its running marker exists); run illustrator_reconcile again instead of abandoning it.`);
        if (await runningStarted())
            throw refuse();
        await options.boundary?.('before_running_unlink');
        try {
            await this.withCommandScope(commandId, async (scope) => unlinkPrivateRecord(`${files.statusPath}.running.json.tmp`, { scope }));
        }
        catch (error) {
            if (!isMissingPath(error))
                throw error;
        }
        if (await runningStarted())
            throw refuse();
        const candidates = [
            `${files.resultPath}.tmp`,
            `${files.statusPath}.host_completed.json.tmp`,
            `${files.statusPath}.completed.json.tmp`,
            `${files.statusPath}.failed.json.tmp`,
            ...Array.from({ length: 32 }, (_unused, index) => `${files.statusPath}.audit.${String(index).padStart(3, '0')}.json.tmp`),
        ];
        const present = [];
        for (const path of candidates) {
            try {
                await lstat(path);
                present.push(path);
            }
            catch (error) {
                if (!isMissingPath(error))
                    throw error;
            }
        }
        await this.withCommandScope(commandId, async (scope) => unlinkPrivateRecords(present, { scope }));
        if (await runningStarted())
            throw refuse();
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
        const execution = prepareExecutionRecord(record, new Date().toISOString());
        await this.withCommandScope(files.commandId, async (scope) => atomicReplacePrivateRecord(files.executionPath, JSON.stringify(execution), { scope }));
        const inspection = await this.readExecution(files.commandId);
        const published = inspection.state === 'valid' ? inspection.value : null;
        if (!published || !executionIdentityMatches(published, execution) ||
            (execution.version === 2 && !executionRecordsMatch(published, execution))) {
            throw new Error('Durable execution record could not be verified before launch.');
        }
        return published;
    }
    async readExecution(commandId) {
        const files = this.files(commandId);
        try {
            const record = await this.readCommandRecord(commandId, files.executionPath, PRIVATE_RECORD_LIMITS.execution);
            if (record.state !== 'valid')
                return { state: record.state === 'missing' ? 'missing' : 'invalid' };
            return parseExecutionRecord(record.text);
        }
        catch (error) {
            if (isMissingPath(error))
                return { state: 'missing' };
            if (error instanceof SyntaxError)
                return { state: 'invalid' };
            throw error;
        }
    }
    async readExecutionPid(commandId) {
        this.files(commandId);
        const inspection = await this.readExecution(commandId);
        return inspection.state === 'valid' ? inspection.value.pid : null;
    }
    async abandon(commandId, message = 'Command was explicitly abandoned after its execution process was confirmed stopped.', budget = this.createLockObservationBudget()) {
        const files = this.files(commandId);
        await this.writeStatus(files, {
            commandId,
            state: 'failed',
            message,
        });
        await this.release(commandId, budget);
    }
    async describeLockOwner(commandId, executionLiveness) {
        this.files(commandId);
        const metadata = await this.inspectMetadataStructure(commandId);
        const kind = metadata.state === 'valid' ? metadata.value.kind : null;
        const createdAt = metadata.state === 'valid' && hasCanonicalTimestamp(metadata.value.createdAt) ? metadata.value.createdAt : null;
        const inspection = await this.readExecution(commandId);
        let liveness = 'missing';
        let processGroupId = null;
        if (inspection.state === 'valid') {
            processGroupId = inspection.value.version === 1 ? inspection.value.processGroupId : null;
            try {
                liveness = await executionLiveness(inspection.value);
            }
            catch {
                liveness = 'unknown';
            }
        }
        else if (inspection.state !== 'missing')
            liveness = 'unknown';
        const status = await this.readStatus(commandId);
        const terminal = status.state === 'completed' || status.state === 'failed';
        return {
            kind,
            createdAt,
            liveness,
            processGroupId,
            terminalStatus: terminal,
            canAbandon: kind === 'read' && liveness === 'inactive' && !terminal && await this.readLockOwner() === commandId &&
                !(await this.isQuarantined(commandId)) && await this.findQuarantineOperation(commandId) === null &&
                (await this.inspectCompactIdempotency(commandId)).state === 'missing',
        };
    }
    async inspectStaleUnstartedRead(commandId, options) {
        const files = this.files(commandId);
        const refuse = (reason) => ({ eligible: false, reason });
        if (isWindowsPrivateState())
            return refuse('automatic release is defined for POSIX only');
        if (await this.readLockOwner(options.observationBudget, 'eligibility_owner') !== commandId)
            return refuse('the command does not hold the active lock');
        if (await this.isQuarantined(commandId))
            return refuse('the command is quarantined');
        if (await this.findQuarantineOperation(commandId) !== null)
            return refuse('the lock belongs to a quarantine');
        if ((await this.inspectCompactIdempotency(commandId)).state !== 'missing')
            return refuse('a compact idempotency record exists');
        const metadata = await this.inspectMetadata(commandId);
        if (metadata.state !== 'valid' || metadata.value.kind !== 'read')
            return refuse('its metadata is not a valid read record');
        if (!hasCanonicalTimestamp(metadata.value.createdAt))
            return refuse('its creation time is not canonical');
        const createdMs = Date.parse(metadata.value.createdAt);
        const ageMs = options.now - createdMs;
        if (!(ageMs >= options.minAgeMs))
            return refuse(`it is only ${Math.max(0, Math.round(ageMs / 1000))} s old (the minimum is ${Math.round(options.minAgeMs / 1000)} s)`);
        const status = await this.readStatus(commandId);
        const created = status.state === 'unknown' && status.message === COMMAND_CREATED_NOT_STARTED_MESSAGE;
        const resumed = options.resumeClaimed === true && status.state === 'failed' &&
            status.message?.startsWith(AUTO_RELEASE_STATUS_PREFIX) === true;
        if (!created && !resumed)
            return refuse('its status is not the created state');
        if (await this.hostRunningPublished(commandId))
            return refuse('the host running marker exists or cannot be read');
        if ((await this.readResult(commandId)).state !== 'missing')
            return refuse('a result artifact exists');
        const inspection = await this.readExecution(commandId);
        if (inspection.state !== 'valid' || inspection.value.version !== 1)
            return refuse('its POSIX execution record is missing or unreadable');
        const execution = inspection.value;
        if (!(Date.parse(execution.startedAt) >= createdMs))
            return refuse('its execution record predates the command');
        let liveness;
        try {
            liveness = options.processGroupLiveness(execution.processGroupId);
        }
        catch {
            liveness = 'unknown';
        }
        if (liveness !== 'inactive')
            return refuse(`its execution process group is ${liveness}`);
        const published = new Set([
            basename(files.paramsPath), basename(files.scriptPath), basename(files.runnerPath), basename(files.executionPath),
            'metadata.json', 'status.json.unknown.json', 'status.json.failed.json', AUTO_RELEASE_RECORD_NAME,
        ]);
        const emptyStaging = new Set([
            'result.json.tmp',
            'status.json.running.json.tmp',
            'status.json.host_completed.json.tmp',
            'status.json.completed.json.tmp',
            'status.json.failed.json.tmp',
            ...Array.from({ length: 32 }, (_unused, index) => `status.json.audit.${String(index).padStart(3, '0')}.json.tmp`),
        ]);
        const twinBases = new Set([...published].filter((name) => name !== AUTO_RELEASE_RECORD_NAME));
        try {
            await this.withCommandScope(commandId, async (scope) => {
                const names = await readdir(files.directory);
                if (names.length > 128)
                    throw new Error('the directory holds too many entries');
                for (const name of names) {
                    const twin = /^(.+)\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/u.exec(name);
                    if (!published.has(name) && !emptyStaging.has(name) && !(twin !== null && twinBases.has(twin[1]))) {
                        throw new Error(`unexpected entry ${JSON.stringify(name)}`);
                    }
                    const entry = await lstat(join(files.directory, name));
                    if (!entry.isFile() || entry.isSymbolicLink())
                        throw new Error(`entry ${JSON.stringify(name)} is not a regular file`);
                    if (emptyStaging.has(name) && name !== 'status.json.running.json.tmp' && entry.size !== 0) {
                        throw new Error(`staging file ${name} is not empty`);
                    }
                }
                await scope.assertStable();
            });
        }
        catch (error) {
            return refuse(`its directory is not the unstarted layout (${error instanceof Error ? error.message : String(error)})`);
        }
        return {
            eligible: true,
            evidence: {
                kind: 'read',
                createdAt: metadata.value.createdAt,
                ageMs,
                executionProcessGroupId: execution.processGroupId,
                executionNonce: execution.nonce,
                executionStartedAt: execution.startedAt,
                liveness: 'inactive',
            },
        };
    }
    async claimStaleReadRelease(commandId, evidence, claimedAt) {
        const files = this.files(commandId);
        const path = join(files.directory, AUTO_RELEASE_RECORD_NAME);
        const record = {
            version: 1,
            commandId,
            reason: 'stale_unstarted_read',
            claimedAt: new Date(claimedAt).toISOString(),
            claimedByPid: process.pid,
            evidence,
        };
        try {
            await this.withCommandScope(commandId, async (scope) => atomicCreatePrivateRecord(path, JSON.stringify(record), { scope }));
            return { state: 'claimed' };
        }
        catch (error) {
            if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'))
                throw error;
        }
        try {
            const existing = await this.readCommandRecord(commandId, path, PRIVATE_RECORD_LIMITS.status);
            if (existing.state !== 'valid')
                return { state: 'held', claimedAt: null };
            const parsed = JSON.parse(existing.text);
            return { state: 'held', claimedAt: hasCanonicalTimestamp(parsed.claimedAt) ? Date.parse(parsed.claimedAt) : null };
        }
        catch (_error) {
            return { state: 'held', claimedAt: null };
        }
    }
    async releaseStaleUnstartedRead(commandId, evidence, budget = this.createLockObservationBudget()) {
        await this.retireUnstartedHostArtifacts(commandId);
        await this.abandon(commandId, `${AUTO_RELEASE_STATUS_PREFIX} it never started (no running marker, no result), it is a read, and its execution process group ` +
            `${String(evidence.executionProcessGroupId)} had stopped; it was released ${String(Math.round(evidence.ageMs / 1000))} s after it was created.`, budget);
    }
    async inspectReleaseUnverified(commandId, executionLiveness, budget = this.createLockObservationBudget()) {
        this.files(commandId);
        const refuse = (reason) => ({ eligible: false, reason });
        let selfUid = null;
        if (!isWindowsPrivateState()) {
            try {
                selfUid = currentUid();
            }
            catch (error) {
                if (error instanceof PlatformUnsupportedError)
                    return refuse('the operating-system user cannot be verified');
                throw error;
            }
        }
        else {
            const quarantineExists = await this.withRootScope(async (scope) => {
                try {
                    await lstat(join(this.root, 'quarantine'));
                    return true;
                }
                catch (error) {
                    if (isMissingPath(error))
                        return false;
                    throw error;
                }
                finally {
                    await scope.assertStable();
                }
            });
            if (quarantineExists)
                return refuse('Windows quarantine state is unsupported and is retained');
        }
        if (await this.isQuarantined(commandId))
            return refuse('the command is quarantined');
        if (await this.readLockOwner(budget, 'eligibility_owner') !== commandId)
            return refuse('the command does not hold the active lock');
        const metadata = await this.inspectMetadataStructure(commandId);
        if (metadata.state !== 'valid' || metadata.value.kind !== 'mutation') {
            return refuse(metadata.state === 'legacy'
                ? 'its state is durable version 1; use action=abandon'
                : 'its metadata is missing, unsafe, or not a mutation');
        }
        const execution = await this.readReleaseExecution(commandId);
        if (execution === null)
            return refuse('its execution record is missing or unreadable, so its runner is not proven stopped');
        const snapshot = Object.freeze({ ...execution });
        let liveness;
        try {
            liveness = await executionLiveness(snapshot);
        }
        catch {
            liveness = 'unknown';
        }
        if (liveness !== 'inactive')
            return refuse(`its execution ${snapshot.version === 1 ? 'process group' : 'process'} is ${liveness}`);
        const compact = await this.inspectCompactIdempotency(commandId);
        let resume = 'none';
        if (compact.state === 'valid') {
            if (compact.value.kind !== 'released_unverified')
                return refuse(`it already has a ${compact.value.kind} terminal record`);
            if (!this.releasedMatches(compact.value, metadata.value, snapshot))
                return refuse('its released record does not match its metadata and execution');
            resume = 'record';
        }
        else if (compact.state === 'missing') {
            if (await this.finalizationArtifactExists(commandId)) {
                return refuse('a finalization attestation exists; its attested compaction has not finished, so reconcile it again instead');
            }
        }
        else if ((await this.readReleaseTwin(commandId, metadata.value, snapshot)) !== null) {
            resume = 'twin';
        }
        else {
            return refuse(`its terminal idempotency record is ${compact.state === 'legacy' ? 'durable version 1' : compact.reason}`);
        }
        if (selfUid === null) {
            const reason = await this.inspectWindowsReleaseDirectory(commandId);
            if (reason !== null)
                return refuse(reason);
        }
        else {
            const uid = selfUid;
            const attribution = await this.withCommandsScope(async (scope) => {
                const classified = await classifyCommandDirectory(this.files(commandId).directory, uid);
                await scope.assertStable();
                return classified;
            });
            if (attribution === null)
                return refuse('its command directory does not exist');
            if (attribution.state === 'unattributable') {
                return refuse(`its command directory has state that cannot be attributed to this user (${attribution.reasons.join('; ')})`);
            }
        }
        if (!await this.releaseSnapshotMatches(commandId, metadata.value, snapshot))
            return refuse('its metadata or execution changed during the release observation');
        return { eligible: true, resume, execution: snapshot, adapterResolved: metadata.adapterResolved,
            metadata: Object.freeze({ ...metadata.value, mutationValidator: Object.freeze({ ...metadata.value.mutationValidator }) }) };
    }
    async inspectWindowsReleaseDirectory(commandId) {
        return await this.withCommandScope(commandId, async (scope) => {
            const directory = this.files(commandId).directory;
            const names = await readdir(directory);
            if (names.length > 128)
                return 'its command directory exceeds the 128-artifact limit';
            const entries = new Map();
            for (const name of names) {
                if (!/^[A-Za-z0-9._-]{1,128}$/u.test(name) || name.includes('..') || windowsPathComponentRejection(name) !== null) {
                    return 'its command directory has an unsafe artifact name';
                }
                const entry = await lstat(join(directory, name), { bigint: true });
                if (entry.isSymbolicLink() || !entry.isFile())
                    return 'its command directory has a link or non-regular artifact';
                entries.set(name, entry);
            }
            for (const [name, entry] of entries) {
                if (entry.nlink === 1n)
                    continue;
                const twins = [...entries].filter(([other, stat]) => other !== name && stat.nlink === 2n &&
                    stat.dev === entry.dev && stat.ino === entry.ino &&
                    (temporaryTwinPattern(name).test(other) || temporaryTwinPattern(other).test(name)));
                if (entry.nlink !== 2n || twins.length !== 1)
                    return 'its command directory has an unexpected hard-link alias';
            }
            await scope.assertStable();
            return null;
        });
    }
    async readReleaseExecution(commandId) {
        try {
            const inspected = await this.readExecution(commandId);
            return inspected.state === 'valid' ? inspected.value : null;
        }
        catch {
            return null;
        }
    }
    releaseMetadataMatches(left, right) {
        return left.kind === 'mutation' && right.kind === 'mutation' && left.commandId === right.commandId &&
            left.operation === right.operation && left.documentKey === right.documentKey && left.requestDigest === right.requestDigest &&
            left.adapterIdentity === right.adapterIdentity && left.mutationValidator.kind === right.mutationValidator.kind &&
            left.mutationValidator.version === right.mutationValidator.version;
    }
    async releaseSnapshotMatches(commandId, metadata, execution) {
        const currentMetadata = await this.inspectMetadataStructure(commandId);
        const currentExecution = await this.readReleaseExecution(commandId);
        return currentMetadata.state === 'valid' && currentExecution !== null &&
            this.releaseMetadataMatches(metadata, currentMetadata.value) && executionRecordsMatch(execution, currentExecution);
    }
    async listLegacyBarrierSources(executionLiveness = async () => 'unknown') {
        const names = new Set();
        try {
            for (const name of await readdir(join(this.root, 'commands')))
                if (isCanonicalCommandId(name))
                    names.add(name);
        }
        catch (error) {
            if (!isMissingPath(error))
                throw error;
        }
        try {
            for (const name of await readdir(quarantineArea(this.root, 'commands').area)) {
                const id = name.endsWith('.json') ? name.slice(0, -5) : name;
                if (isCanonicalCommandId(id))
                    names.add(id);
            }
        }
        catch (error) {
            if (!isMissingPath(error))
                throw error;
        }
        const owner = await this.readLockOwner();
        const sources = [];
        for (const commandId of [...names].sort()) {
            const unknown = () => { sources.push({ commandId, source: 'released_unverified' }); };
            const manifest = await readQuarantineManifest(this.root, 'commands', commandId);
            if (manifest.state === 'invalid') {
                unknown();
                continue;
            }
            if (manifest.state === 'valid' && owner === manifest.manifest.operation?.id)
                continue;
            if (owner === commandId)
                continue;
            let directory;
            if (manifest.state === 'valid') {
                const state = await this.inspectQuarantine(commandId);
                if (state?.state === 'inconsistent') {
                    unknown();
                    continue;
                }
                const retained = join(quarantineArea(this.root, 'commands').area, commandId);
                const moved = await pathExists(retained);
                if (state?.state === 'quarantined' || moved)
                    directory = retained;
            }
            else if (await pathExists(join(quarantineArea(this.root, 'commands').area, commandId))) {
                unknown();
                continue;
            }
            try {
                const found = await this.inspectLegacyBarrierCommand(commandId, directory, executionLiveness);
                if (found !== null)
                    sources.push(found);
            }
            catch {
                unknown();
            }
        }
        return sources;
    }
    async inspectLegacyBarrierCommand(commandId, directory, executionLiveness) {
        const unknown = () => ({ commandId, source: 'released_unverified' });
        await this.validateBarrierDirectory(commandId, directory);
        const files = this.files(commandId);
        const read = (path, limit) => this.readCommandRecord(commandId, path, limit, directory);
        const compact = await this.inspectCompactIdempotency(commandId, directory);
        if (compact.state === 'invalid')
            return unknown();
        const result = await read(files.resultPath, PRIVATE_RECORD_LIMITS.result);
        const finalization = await this.inspectFinalization(commandId, directory);
        const terminal = (record) => {
            if (!('resultDigest' in record) || result.state !== 'valid')
                throw new Error('The terminal result is not readable.');
            const digest = createHash('sha256').update(result.bytes).digest('hex');
            if (digest !== record.resultDigest)
                throw new Error('The terminal digest differs from its record.');
            if (record.version === 1) {
                const envelope = parseCompletedResultEnvelope(result.text, commandId);
                const parsed = legacyRectangleResultSchema.parse(envelope.data);
                if (parsed.transaction.state !== record.terminalState)
                    throw new Error('The legacy terminal differs from its result.');
            }
            else {
                const artifact = validateMutationResultArtifact(this.registry, {
                    commandId, operation: record.operation, intent: 'apply',
                    validator: { kind: record.validatorKind, version: record.validatorVersion }, adapterIdentity: record.adapterIdentity,
                }, result.bytes);
                if (artifact.classification.state !== record.terminalState)
                    throw new Error('The terminal differs from its result.');
            }
            return record.terminalState === 'rollback_failed'
                ? { commandId, source: 'rollback_failed', documentKey: record.documentKey, resultText: result.text } : null;
        };
        if (compact.state === 'valid' || compact.state === 'legacy') {
            const record = compact.value;
            if (record.kind === 'released_unverified')
                return { commandId, source: 'released_unverified', documentKey: record.documentKey };
            if (record.kind === 'tombstone') {
                if (result.state !== 'missing' || finalization.state !== 'missing')
                    return unknown();
                return null;
            }
            return terminal(record);
        }
        const metadata = await this.inspectMetadataStructure(commandId, directory);
        if (metadata.state !== 'valid' && metadata.state !== 'legacy')
            return unknown();
        const execution = await read(files.executionPath, PRIVATE_RECORD_LIMITS.execution);
        let inactive = execution.state === 'missing';
        if (execution.state === 'valid') {
            const parsed = parseExecutionRecord(execution.text);
            inactive = parsed.state === 'valid' && await executionLiveness(parsed.value) === 'inactive';
        }
        if (!inactive)
            return unknown();
        const value = metadata.value;
        if (value.kind === 'read') {
            if (finalization.state !== 'missing')
                return unknown();
            const states = ['completed', 'failed', 'running', 'unknown'];
            for (const state of states) {
                const record = await read(`${files.statusPath}.${state}.json`, PRIVATE_RECORD_LIMITS.status);
                if (record.state === 'invalid')
                    return unknown();
                if (record.state === 'valid') {
                    if (parseStoredCommandStatus(record.text, commandId).state !== state)
                        return unknown();
                    return null;
                }
            }
            const legacy = await read(files.statusPath, PRIVATE_RECORD_LIMITS.status);
            if (legacy.state !== 'valid')
                return unknown();
            parseStoredCommandStatus(legacy.text, commandId);
            return null;
        }
        if (finalization.state === 'valid' || finalization.state === 'legacy') {
            const attestation = finalization.value;
            if (attestation.version !== value.version || attestation.operation !== value.operation ||
                attestation.documentKey !== value.documentKey || attestation.requestDigest !== value.requestDigest ||
                attestation.validatorKind !== value.mutationValidator.kind || attestation.validatorVersion !== value.mutationValidator.version ||
                attestation.adapterIdentity !== value.adapterIdentity)
                return unknown();
            return terminal(attestation);
        }
        if (finalization.state !== 'missing' || result.state !== 'missing')
            return unknown();
        if (execution.state === 'missing') {
            const status = await read(`${files.statusPath}.unknown.json`, PRIVATE_RECORD_LIMITS.status);
            const staging = await read(`${files.statusPath}.running.json.tmp`, PRIVATE_RECORD_LIMITS.status);
            const started = await read(`${files.statusPath}.running.json`, PRIVATE_RECORD_LIMITS.status);
            if (status.state === 'valid' && staging.state === 'valid' && staging.bytes.length === 0 && started.state === 'missing') {
                const parsed = parseStoredCommandStatus(status.text, commandId);
                if (parsed.state === 'unknown' && parsed.message === COMMAND_CREATED_NOT_STARTED_MESSAGE) {
                    const params = await read(files.paramsPath, 16_777_216);
                    const script = await read(files.scriptPath, 16_777_216);
                    const runner = await read(files.runnerPath, 16_777_216);
                    if (params.state === 'valid' && script.state === 'valid' && runner.state === 'valid' && script.bytes.length > 0 && runner.bytes.length > 0)
                        return null;
                }
            }
        }
        const names = (await readdir(directory ?? files.directory)).filter(name => /^status\.json\.audit\.\d{3}\.json$/u.test(name)).sort();
        const audit = [];
        for (let index = 0; index < names.length && names.length <= 32; index++) {
            const record = await read(join(files.directory, names[index]), PRIVATE_RECORD_LIMITS.audit);
            if (record.state !== 'valid')
                return unknown();
            const event = JSON.parse(record.text);
            if (!isMutationAuditEvent(event, index))
                return unknown();
            audit.push(event);
        }
        if (isProvenPreApplyFailureAudit(audit)) {
            for (const state of ['unknown', 'running', 'failed']) {
                const record = await read(`${files.statusPath}.${state}.json`, PRIVATE_RECORD_LIMITS.status);
                if (record.state !== 'valid' || parseStoredCommandStatus(record.text, commandId).state !== state)
                    return unknown();
            }
            return null;
        }
        return unknown();
    }
    async releaseUnverified(commandId, options) {
        const files = this.files(commandId);
        const budget = this.createLockObservationBudget();
        if (options.confirmCommandId !== commandId) {
            throw new Error('Releasing a command without verification requires confirm_command_id to exactly match command_id.');
        }
        const lockOwner = await this.readLockOwner(budget, 'unverified_owner');
        if (lockOwner !== commandId) {
            const compact = await this.inspectCompactIdempotency(commandId);
            if (compact.state === 'valid' && compact.value.kind === 'released_unverified')
                return compact.value;
        }
        const eligibility = await this.inspectReleaseUnverified(commandId, options.executionLiveness, budget);
        if (!eligibility.eligible) {
            throw new Error(`Command ${commandId} cannot be released without verification: ${eligibility.reason}. Nothing was written.`);
        }
        const { metadata, execution } = eligibility;
        if (!await this.releaseSnapshotMatches(commandId, metadata, execution) || await this.readLockOwner(budget, 'pre_release_owner') !== commandId) {
            throw new Error(`Command ${commandId} changed during its release; nothing was written.`);
        }
        if (eligibility.resume === 'twin') {
            await this.completeReleaseTwin(commandId, metadata, execution);
            await options.boundary?.('twin_completed');
        }
        else if (eligibility.resume === 'none') {
            const record = await this.releasedRecord(commandId, metadata, eligibility.adapterResolved, execution);
            try {
                await this.withCommandScope(commandId, async (scope) => {
                    if (!await this.releaseSnapshotMatches(commandId, metadata, execution))
                        throw new Error('Release identity changed before publication; its lock is kept.');
                    await atomicCreatePrivateRecord(files.idempotencyPath, JSON.stringify(record), {
                        scope,
                        ...(options.durabilityBoundary === undefined ? {} : { durabilityBoundary: options.durabilityBoundary }),
                    });
                });
            }
            catch (error) {
                if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'))
                    throw error;
            }
        }
        const published = await this.inspectCompactIdempotency(commandId);
        if (published.state !== 'valid' || published.value.kind !== 'released_unverified' ||
            !this.releasedMatches(published.value, metadata, execution) || !await this.releaseSnapshotMatches(commandId, metadata, execution)) {
            throw new Error(`The released record of ${commandId} could not be verified; its lock is kept.`);
        }
        await options.boundary?.('record_verified');
        if (execution.version === 2 && !await this.releaseSnapshotMatches(commandId, metadata, execution)) {
            throw new Error(`Command ${commandId} changed before its lock release; its released record and lock are kept.`);
        }
        if (options.beforeUnlock !== undefined)
            await options.beforeUnlock(published.value);
        await this.release(commandId, budget);
        if (await this.readLockOwner(budget, 'completion_owner') === commandId)
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
                ...(execution.version === 1 ? { executionProcessGroupId: execution.processGroupId }
                    : { executionProcessId: execution.pid, executionCreationTime: execution.creationTime }),
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
            (execution.version === 1
                ? 'executionProcessGroupId' in record.evidence && record.evidence.executionProcessGroupId === execution.processGroupId
                : 'executionProcessId' in record.evidence && record.evidence.executionProcessId === execution.pid &&
                    record.evidence.executionCreationTime === execution.creationTime);
    }
    async assertReleasedUnverifiedBinding(record) {
        if ('executionProcessId' in record.evidence) {
            await this.withCommandScope(record.commandId, async (scope) => { await scope.syncLeafParent(); });
        }
        const metadata = await this.inspectMetadataStructure(record.commandId);
        const execution = await this.readReleaseExecution(record.commandId);
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
                    if (candidate.isFile() && candidate.dev === target.dev && candidate.ino === target.ino)
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
                return { twin: join(files.directory, twins[0]), dev: target.dev, ino: target.ino };
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
        if (after.dev !== found.dev || after.ino !== found.ino || after.nlink !== 1n) {
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
        const selfUid = currentUid();
        if (this.quarantinesInFlight.has(commandId))
            throw new Error(`Command ${commandId} is already being quarantined by this server.`);
        this.quarantinesInFlight.add(commandId);
        try {
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
                const inspection = parseExecutionRecord(record.text);
                return inspection.state === 'valid' && inspection.value.version === 1 ? inspection.value : null;
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
        const budget = this.createLockObservationBudget();
        await this.release(operationId, budget);
        if (await this.readLockOwner(budget, 'completion_owner') === operationId)
            throw new Error('The quarantine could not verify its lock release.');
    }
    async readCommandRecord(commandId, path, maxBytes, directory) {
        if (directory !== undefined && directory !== this.files(commandId).directory) {
            const retained = join(quarantineArea(this.root, 'commands').area, commandId);
            if (directory !== retained)
                throw new Error('Barrier inspection must use the recorded command directory.');
            try {
                return await withPrivateDirectoryScope([
                    { path: this.root, description: 'state root' },
                    { path: quarantineArea(this.root, 'commands').base, description: 'quarantine directory' },
                    { path: quarantineArea(this.root, 'commands').area, description: 'command quarantine directory' },
                    { path: retained, description: 'retained command directory' },
                ], async (scope) => readSecurePrivateRecord(join(retained, basename(path)), maxBytes, { scope }));
            }
            catch (error) {
                if (isMissingPath(error))
                    return { state: 'missing' };
                return { state: 'invalid', reason: 'unsafe_retained_directory' };
            }
        }
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
    async validateBarrierDirectory(commandId, directory) {
        if (directory === undefined || directory === this.files(commandId).directory)
            return await this.validateCommandDirectory(commandId);
        if (directory !== join(quarantineArea(this.root, 'commands').area, commandId))
            throw new Error('Unexpected retained directory.');
        await validatePrivateStateRoot(this.root);
        await validatePrivateDirectory(quarantineArea(this.root, 'commands').base, 0o700, 'quarantine directory');
        await validatePrivateDirectory(quarantineArea(this.root, 'commands').area, 0o700, 'command quarantine directory');
        await validatePrivateDirectory(directory, 0o700, 'retained command directory');
    }
    async validateCommandDirectory(commandId) {
        await validatePrivateStateRoot(this.root);
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
                if (!metadata.isFile() || metadata.isSymbolicLink() || privateOwnerModeViolation(metadata, 0o600) !== null) {
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
