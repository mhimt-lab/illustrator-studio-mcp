import { illustratorApplicationTarget, } from './illustrator-application.js';
import { HostProcessExitError } from './host-transport.js';
import { executionIdentityMatches, executionRecordsMatch } from './execution-record.js';
import { createHash, randomUUID } from 'node:crypto';
import { LockObservationBudgetExhaustedError } from './lock-observation-budget.js';
import { CommandLockedError, MUTATION_DURABLE_STATE_VERSION, assertNeverTerminalKind, } from './command-store.js';
import { IndeterminateExecutionError, CommandQuarantinedError, CommandReleasedAsOrphanError, CommandReleasedUnverifiedError, ProvenPreApplyFailureError, HostReferenceInvalidError, hostReferenceInvalidDetail, } from './domain.js';
import { buildJsxCommand } from './jsx-runtime.js';
import { auditMismatchInResult } from './mutation-audit-consistency.js';
import { barrierTargetFromKey, barrierTargetFromResultText } from './release-barrier.js';
import { validateMutationResultArtifact, } from './mutation-result-validator.js';
export const DEFAULT_CALL_QUEUE_WAIT_LIMIT_MS = 60_000;
export function commandMayWriteAuditEvents(command) {
    return command.kind === 'mutation' || command.script.includes('recordMutationAuditEvent');
}
export function describeValidationCause(error) {
    const issues = typeof error === 'object' && error !== null ? error.issues : undefined;
    if (!Array.isArray(issues) || issues.length === 0)
        return '';
    const first = issues[0];
    const code = typeof first?.code === 'string' && /^[a-z_]{1,40}$/.test(first.code) ? first.code : 'invalid';
    const path = Array.isArray(first?.path)
        ? first.path.filter((part) => typeof part === 'number' || (typeof part === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(part))).slice(0, 8).join('.')
        : '';
    return ` (reason_code ${code}${path === '' ? '' : ` at ${path}`}${issues.length > 1 ? `; ${String(issues.length - 1)} more` : ''})`;
}
function readReleaseHint(kind, commandId) {
    if (kind !== 'read')
        return '';
    return ` The read's lock stays until you reconcile it: run illustrator_reconcile with command_id=${commandId} (action=inspect). ` +
        `If it reports canAbandon, run it again with action=abandon, command_id=${commandId} and confirm_command_id=${commandId}; ` +
        'if Illustrator is still running the script, wait for it to finish first.';
}
export const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
export const MAX_READ_HOST_TIMEOUT_MS = 300_000;
export const STALE_READ_RELEASE_MARGIN_MS = 60_000;
export const STALE_READ_RELEASE_MIN_AGE_MS = MAX_READ_HOST_TIMEOUT_MS + STALE_READ_RELEASE_MARGIN_MS;
export const STALE_READ_CLAIM_RESUME_MS = 60_000;
export const STALE_READ_CLAIM_WAIT_MS = 250;
const RECENT_GO_LIMIT = 16;
function formatAge(ms) {
    const seconds = Math.max(0, Math.round(ms / 1000));
    if (seconds < 60)
        return `${seconds} s`;
    if (seconds < 3600)
        return `${Math.round(seconds / 60)} min`;
    if (seconds < 172_800)
        return `${Math.round(seconds / 3600)} h`;
    return `${Math.round(seconds / 86_400)} days`;
}
export class IllustratorBusyError extends Error {
    waitedMs;
    constructor(waitedMs) {
        super(`Illustrator is still running earlier calls from this server after ${Math.round(waitedMs)} ms; ` +
            'this call was not started. Wait for them to finish and retry.');
        this.waitedMs = waitedMs;
        this.name = 'IllustratorBusyError';
    }
}
export function parseHostResultEnvelope(record, commandId) {
    if (record.state === 'missing')
        return { ok: false, reason: 'missing' };
    if (record.state === 'invalid')
        return { ok: false, reason: 'unsafe' };
    let raw;
    try {
        raw = JSON.parse(record.text);
    }
    catch (_error) {
        return { ok: false, reason: 'invalid_json' };
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
        return { ok: false, reason: 'invalid_structure' };
    const value = raw;
    if (value.commandId !== commandId ||
        (value.state !== 'completed' && value.state !== 'failed' && value.state !== 'indeterminate') ||
        (value.state === 'failed' && typeof value.message !== 'string') ||
        (value.state === 'completed' && !('data' in value))) {
        return { ok: false, reason: 'invalid_structure' };
    }
    return { ok: true, raw: value };
}
class HostResultUnavailableError extends Error {
    commandId;
    reason;
    constructor(commandId, reason) {
        super(`Illustrator command result is ${reason === 'missing' ? 'missing' : reason === 'unsafe' ? 'unsafe' : 'unreadable'} (${reason}; ${commandId}).`);
        this.commandId = commandId;
        this.reason = reason;
        this.name = 'HostResultUnavailableError';
    }
}
export function missingReadRecoveryCandidate(platform, commandId, lockOwner, kind, status, execution) {
    return platform === 'win32' && lockOwner === commandId && kind === 'read' &&
        status.state === 'unknown' && execution.state === 'missing';
}
export function missingMutationRecoveryCandidate(platform, commandId, lockOwner, kind, status, execution) {
    return platform === 'win32' && lockOwner === commandId && kind === 'mutation' &&
        status.state === 'unknown' && execution.state === 'missing';
}
export class DurableCommandBridge {
    store;
    registry;
    transport;
    target;
    queueWaitLimitMs;
    queueTail = Promise.resolve();
    terminalObserver = null;
    barrierStore;
    now;
    inFlightCommandIds = new Set();
    recentGoCommandIds = [];
    constructor(application, store, registry, transport, options = {}) {
        this.store = store;
        this.registry = registry;
        this.transport = transport;
        this.queueWaitLimitMs = options.queueWaitLimitMs ?? DEFAULT_CALL_QUEUE_WAIT_LIMIT_MS;
        this.barrierStore = options.barrierStore ?? null;
        this.now = options.now ?? Date.now;
        if (!this.registry.isSealed() || this.store.getAdapterRegistry() !== this.registry) {
            throw new Error('Bridge and command store must share the exact sealed mutation adapter registry.');
        }
        this.target = illustratorApplicationTarget(application);
    }
    async legacyBarrierSources() {
        return await this.store.listLegacyBarrierSources((execution) => this.releaseExecutionLiveness(execution));
    }
    releaseBarrierStore() {
        return this.barrierStore;
    }
    applicationTarget() {
        return { ...this.target };
    }
    setMutationTerminalObserver(observer) {
        if (this.terminalObserver !== null && this.terminalObserver !== observer) {
            throw new Error('A different mutation terminal observer is already installed.');
        }
        this.terminalObserver = observer;
    }
    async observeAttested(commandId, terminalState) {
        await this.ensureAttestedBarrier(commandId, terminalState);
        if (this.terminalObserver === null || await this.store.readLockOwner() !== commandId)
            return;
        const result = await this.store.readResult(commandId);
        if (result.state !== 'valid')
            throw new Error(`The attested result of ${commandId} is unreadable; edit sessions cannot be updated.`);
        await this.terminalObserver.attested({ commandId, terminalState, resultText: result.text });
    }
    async ensureAttestedBarrier(commandId, terminalState) {
        if (this.barrierStore === null || await this.store.readLockOwner() !== commandId)
            return;
        try {
            const compact = await this.store.inspectCompactIdempotency(commandId);
            const result = await this.store.readResult(commandId);
            const resultText = result.state === 'valid' ? result.text : '';
            const source = terminalState === 'rollback_failed' ? 'rollback_failed'
                : auditMismatchInResult(resultText) ? 'audit_mismatch' : null;
            if (source === null)
                return;
            const target = barrierTargetFromResultText(resultText, compact.state === 'valid' ? compact.value.documentKey : undefined);
            if (target !== null)
                await this.barrierStore.ensure(target, { commandId, source });
        }
        catch (error) {
            throw new IndeterminateExecutionError(`The document barrier could not be made durable (${commandId}); the lock is kept. ${error instanceof Error ? error.message : String(error)}`, commandId);
        }
    }
    async ensureReleasedBarrier(record) {
        if (this.barrierStore === null)
            return;
        try {
            const target = barrierTargetFromKey(record.documentKey);
            if (target !== null)
                await this.barrierStore.ensure(target, { commandId: record.commandId, source: 'released_unverified' });
        }
        catch (error) {
            throw new IndeterminateExecutionError(`The released document barrier could not be made durable (${record.commandId}); the lock is kept. ${error instanceof Error ? error.message : String(error)}`, record.commandId);
        }
    }
    async observeProvenPreApplyFailure(commandId) {
        if (await this.store.readLockOwner() !== commandId)
            return { message: null, audit: null };
        const status = await this.store.readStatus(commandId);
        const message = status.state === 'failed' ? status.message ?? null : null;
        const failed = (await this.store.readMutationAudit(commandId))?.at(-1);
        const audit = failed?.event === 'failed' && (failed.phase === 'preflight' || failed.phase === 'plan')
            ? { phase: failed.phase, message: failed.message }
            : null;
        if (this.terminalObserver !== null)
            await this.terminalObserver.provenPreApplyFailure({ commandId, message });
        return { message, audit };
    }
    async observeUnresolved(commandId, reason = 'indeterminate') {
        if (this.terminalObserver === null || await this.store.readLockOwner() !== commandId)
            return;
        await this.terminalObserver.unresolved({ commandId, reason });
    }
    releaseUnverifiedOffered() { return true; }
    async execute(command) {
        const leave = await this.enterQueue();
        try {
            return await this.executeOne(command);
        }
        catch (error) {
            if (command.kind === 'mutation' && error instanceof IndeterminateExecutionError &&
                error.commandId === command.idempotency.commandId) {
                await this.observeUnresolved(error.commandId);
            }
            if (error instanceof CommandLockedError) {
                throw new IndeterminateExecutionError(error.message, error.commandId);
            }
            throw error;
        }
        finally {
            leave();
        }
    }
    async enterQueue() {
        const previous = this.queueTail;
        let leave;
        const finished = new Promise((resolve) => { leave = resolve; });
        this.queueTail = previous.then(() => finished);
        const started = performance.now();
        let timer;
        const admitted = await Promise.race([
            previous.then(() => true),
            new Promise((resolve) => { timer = setTimeout(() => resolve(false), this.queueWaitLimitMs); }),
        ]);
        clearTimeout(timer);
        if (!admitted) {
            leave();
            throw new IllustratorBusyError(performance.now() - started);
        }
        return leave;
    }
    async resolveTerminalAttestation(expectation) {
        const compact = await this.store.inspectCompactIdempotency(expectation.commandId);
        if (compact.state !== 'valid' || compact.value.kind !== 'replay_bundle')
            return null;
        const record = compact.value;
        if (record.operation !== expectation.operationId ||
            record.documentKey !== expectation.documentKey ||
            record.validatorKind !== expectation.validatorIdentity ||
            record.validatorVersion !== expectation.validatorVersion ||
            record.requestDigest !== expectation.canonicalRequestDigest ||
            record.terminalState !== expectation.terminalState ||
            record.finalizedAt !== expectation.finalizedAt)
            return null;
        await this.readValidatedCompactReplay(record);
        return {
            version: 1,
            commandId: record.commandId,
            operationId: record.operation,
            documentKey: record.documentKey,
            validatorIdentity: record.validatorKind,
            validatorVersion: record.validatorVersion,
            canonicalRequestDigest: record.requestDigest,
            resultDigestAlgorithm: record.resultDigestAlgorithm,
            durableResultArtifactDigest: record.resultDigest,
            terminalState: record.terminalState,
            finalizedAt: record.finalizedAt,
        };
    }
    async reconcile(options = {}) {
        if (options.releaseUnverified) {
            if (options.commandId === undefined)
                throw new Error('Releasing a command without verification requires command_id.');
            if (options.abandon || options.quarantine)
                throw new Error('A release cannot be combined with abandon or quarantine.');
            const leave = await this.enterQueue();
            try {
                return await this.releaseUnverified(options.commandId, options.confirmCommandId ?? '');
            }
            finally {
                leave();
            }
        }
        return await this.reconcileCommand(options);
    }
    async releaseProvenPreCreateLock(commandId, evidence) {
        this.store.files(commandId);
        const leave = await this.enterQueue();
        try {
            if (this.inFlightCommandIds.has(commandId) || this.recentGoCommandIds.includes(commandId)) {
                return { state: 'refused', reason: 'not_lock_owner', message: `Command ${commandId} is running in this server.` };
            }
            return await this.store.releaseProvenPreCreateLock(commandId, evidence);
        }
        finally {
            leave();
        }
    }
    async releaseUnverified(commandId, confirmCommandId) {
        this.store.files(commandId);
        if (confirmCommandId !== commandId) {
            throw new Error('Releasing a command without verification requires confirm_command_id to exactly match command_id.');
        }
        const inspected = await this.reconcileCommand({ commandId });
        if (inspected !== null && (inspected.state === 'completed' || inspected.state === 'failed' ||
            ('executionRecord' in inspected && inspected.executionRecord === 'released_unverified'))) {
            return inspected;
        }
        await this.observeUnresolved(commandId, 'released_unverified');
        const record = await this.store.releaseUnverified(commandId, {
            confirmCommandId,
            executionLiveness: (execution) => this.releaseExecutionLiveness(execution),
            beforeUnlock: (released) => this.ensureReleasedBarrier(released),
        });
        return await this.releasedStatus(record);
    }
    async releaseExecutionLiveness(execution) {
        return execution.version === 1
            ? this.transport.processGroupLiveness?.(execution.processGroupId) ?? 'unknown'
            : await this.transport.liveness(execution);
    }
    async releasedStatus(record) {
        const result = await this.store.readResult(record.commandId);
        const digest = result.state === 'valid' ? createHash('sha256').update(result.bytes).digest('hex') : null;
        const changed = digest !== record.evidence.resultDigest
            ? ' Its result artifact arrived or changed after the release; it is kept as evidence and never read as an outcome.'
            : '';
        return {
            commandId: record.commandId,
            state: 'unknown',
            message: `Command ${record.commandId} was released without verification (${record.reasonCode}) at ${record.releasedAt}. ` +
                'The document state after it is unknown and it will never be replayed or reapplied. Check the document in ' +
                'Illustrator (close a saved file without saving and reopen it), read it again, and plan any change again.' + changed,
            executionStatus: 'inactive',
            canAbandon: false,
            executionRecord: 'released_unverified',
            documentState: 'unverified',
            releasedAt: record.releasedAt,
            reasonCode: record.reasonCode,
        };
    }
    async reconcileCommand(options) {
        if (options.quarantine) {
            if (options.commandId === undefined)
                throw new Error('Quarantine requires command_id.');
            if (options.abandon)
                throw new Error('A command cannot be abandoned and quarantined in one call.');
            await this.observeUnresolved(options.commandId);
            const quarantined = await this.store.quarantineCommand(options.commandId, {
                confirmCommandId: options.confirmCommandId ?? '',
                processGroupLiveness: (processGroupId) => this.transport.processGroupLiveness?.(processGroupId) ?? 'unknown',
            });
            return {
                commandId: quarantined.commandId,
                state: 'unknown',
                message: `Command ${quarantined.commandId} is quarantined: its state was moved unchanged under ${quarantined.area}, ` +
                    'and it will never be replayed or reapplied. Other commands can continue.',
                executionStatus: 'unknown',
                canAbandon: false,
            };
        }
        const lockOwner = await this.store.readLockOwner();
        const targetId = options.commandId ?? lockOwner;
        if (!targetId)
            return null;
        this.store.files(targetId);
        const quarantine = await this.store.inspectQuarantine(targetId);
        if (quarantine !== null) {
            if (options.abandon)
                throw new Error(`A quarantined command cannot be abandoned (${targetId}).`);
            return { commandId: targetId, state: 'unknown', message: quarantine.message, executionStatus: 'unknown', canAbandon: false };
        }
        if (targetId === lockOwner) {
            const quarantining = await this.store.findQuarantineOperation(targetId);
            if (quarantining !== null) {
                if (options.abandon)
                    throw new Error(`The active lock belongs to the quarantine of ${quarantining} and cannot be abandoned.`);
                return {
                    commandId: targetId,
                    state: 'unknown',
                    message: `The active lock belongs to an interrupted quarantine of command ${quarantining}. Run illustrator_reconcile ` +
                        `with action=quarantine, command_id=${quarantining}, and confirm_command_id=${quarantining} to finish it.`,
                    executionStatus: 'unknown',
                    canAbandon: false,
                };
            }
        }
        const compact = await this.store.inspectCompactIdempotency(targetId);
        if (compact.state === 'valid' && compact.value.kind === 'released_unverified') {
            if (options.abandon)
                throw new Error(`A command released without verification cannot be abandoned (${targetId}).`);
            if (lockOwner === targetId) {
                await this.observeUnresolved(targetId, 'released_unverified');
                await this.ensureReleasedBarrier(compact.value);
                await this.store.release(targetId);
            }
            return await this.releasedStatus(compact.value);
        }
        if (compact.state === 'valid') {
            if (compact.value.kind === 'replay_bundle')
                await this.readValidatedCompactReplay(compact.value);
            await this.finishCompactCleanup(compact.value);
            if (options.abandon)
                throw new Error('A compact terminal idempotency record cannot be abandoned.');
            if (lockOwner === targetId && compact.value.kind === 'replay_bundle') {
                await this.observeAttested(targetId, compact.value.terminalState);
                await this.store.release(targetId);
            }
            return compact.value.kind === 'replay_bundle' && compact.value.terminalState === 'verified'
                ? { commandId: targetId, state: 'completed', executionStatus: 'inactive', canAbandon: false,
                    executionRecord: 'compacted' }
                : { commandId: targetId, state: 'failed', message: `Command compacted as ${compact.value.terminalState}.`,
                    executionStatus: 'inactive', canAbandon: false, executionRecord: 'compacted' };
        }
        if (compact.state === 'legacy') {
            return await this.reconcileLegacyState(targetId, lockOwner, options, 'compact');
        }
        if (compact.state === 'invalid') {
            if (!options.abandon && lockOwner === targetId && this.releaseUnverifiedOffered()) {
                const eligibility = await this.store.inspectReleaseUnverified(targetId, (record) => this.releaseExecutionLiveness(record));
                if (eligibility.eligible && eligibility.resume === 'twin') {
                    return {
                        commandId: targetId,
                        state: 'unknown',
                        message: `The release of command ${targetId} without verification was interrupted. Run illustrator_reconcile ` +
                            `with action=release_unverified, command_id=${targetId}, and confirm_command_id=${targetId} again to finish it.`,
                        executionStatus: 'unknown',
                        canAbandon: false,
                    };
                }
            }
            throw new IndeterminateExecutionError(`Compact idempotency state is ${compact.reason}; reconciliation remains blocked (${targetId}).`, targetId);
        }
        let status = await this.store.readStatus(targetId);
        const metadataInspection = await this.store.inspectMetadata(targetId);
        if (metadataInspection.state === 'legacy') {
            return await this.reconcileLegacyState(targetId, lockOwner, options, 'metadata', metadataInspection.value);
        }
        const metadata = metadataInspection.state === 'valid' ? metadataInspection.value : null;
        const inspection = await this.store.readExecution(targetId);
        const execution = inspection.state === 'valid' ? inspection.value : null;
        const unstartedWindowsRead = missingReadRecoveryCandidate(process.platform, targetId, lockOwner, metadata?.kind, status, inspection) &&
            !(await this.store.hostRunningPublished(targetId));
        const unstartedWindowsMutation = metadata?.kind === 'mutation' &&
            missingMutationRecoveryCandidate(process.platform, targetId, lockOwner, metadata.kind, status, inspection) &&
            await this.store.inspectNeverStartedMutation(targetId);
        if (unstartedWindowsMutation && metadata?.kind === 'mutation') {
            return await this.reconcileUnstartedWindowsMutation(targetId, metadata, status, options);
        }
        const executionStatus = execution === null ? (unstartedWindowsRead ? 'inactive' : 'unknown') : await this.transport.liveness(execution);
        let finalizationBlocked = metadata === null;
        if (metadata === null && (status.state === 'completed' || status.state === 'failed')) {
            status = {
                ...status,
                state: 'unknown',
                message: 'Mutation metadata is missing, unsafe, or resolves to no registered adapter.',
            };
        }
        if (metadata?.kind === 'mutation' && status.state === 'failed') {
            if (executionStatus === 'inactive' && await this.compactPersistedFailure(targetId, metadata)) {
                return await this.reconcileCommand(options);
            }
            status = {
                ...status,
                state: 'unknown',
                message: 'Mutation failure cannot become terminal until its inactive execution and pre-attempt audit are verified.',
            };
            finalizationBlocked = true;
        }
        else if (metadata?.kind === 'mutation') {
            if (executionStatus === 'inactive') {
                if (await this.finalizePersistedMutation(targetId, metadata)) {
                    return await this.reconcileCommand(options);
                }
                else {
                    status = {
                        ...status,
                        state: status.state === 'completed' ? 'unknown' : status.state,
                        message: 'Mutation result validation or finalization attestation is missing, invalid, or unknown.',
                    };
                    finalizationBlocked = true;
                }
            }
            else {
                finalizationBlocked = true;
                if (status.state === 'completed') {
                    status = {
                        ...status,
                        state: 'unknown',
                        message: 'Mutation host completion cannot become terminal while execution may still be active.',
                    };
                }
            }
        }
        if (metadata?.kind === 'read' && (status.state === 'completed' || status.state === 'failed') &&
            !(await this.readTerminalProven(targetId, status))) {
            status = {
                ...status,
                state: 'unknown',
                message: 'Illustrator may have run this read, but its result is missing or does not match its recorded status; the outcome is unknown. ' +
                    'Check Illustrator, then abandon it (read commands can be abandoned once their process has stopped).',
            };
        }
        if ((status.state === 'completed' || status.state === 'failed') && executionStatus !== 'inactive') {
            status = {
                ...status,
                state: 'unknown',
                message: 'A terminal command candidate cannot be published while execution liveness is not inactive.',
            };
        }
        if (status.state === 'completed' || status.state === 'failed') {
            if (executionStatus === 'inactive' && !finalizationBlocked)
                await this.store.release(targetId);
            return this.publicCommandStatus(status, execution, executionStatus, false);
        }
        const mutationAudit = await this.store.readMutationAudit(targetId);
        const transaction = mutationAudit === null ? undefined : this.indeterminateTransaction(mutationAudit);
        const canAbandon = lockOwner === targetId && executionStatus === 'inactive' && !finalizationBlocked;
        const canReleaseUnverified = this.releaseUnverifiedOffered() && !canAbandon && lockOwner === targetId && executionStatus === 'inactive' &&
            (await this.store.inspectReleaseUnverified(targetId, (record) => this.releaseExecutionLiveness(record))).eligible;
        const releaseGuidance = canReleaseUnverified
            ? ` Its outcome cannot be verified. An inactive controller does not prove that the Illustrator script has finished. ` +
                'Check the document in Illustrator first (make sure no script is still running; ' +
                'close a saved file without saving and reopen it, or check an unsaved document by eye), then run ' +
                `illustrator_reconcile with action=release_unverified, command_id=${targetId}, and confirm_command_id=${targetId}. ` +
                'The document state stays unverified and this command is never replayed or reapplied.'
            : '';
        if (options.abandon) {
            if (options.confirmCommandId !== targetId) {
                throw new Error('Abandoning a command requires confirm_command_id to exactly match the locked command.');
            }
            if (!canAbandon) {
                throw new Error('The command cannot be abandoned while execution or mutation finalization remains unverified.' +
                    releaseGuidance);
            }
            if (metadata?.kind !== 'read')
                await this.observeUnresolved(targetId);
            if (metadata?.kind === 'read' && !(await this.store.hostRunningPublished(targetId))) {
                await this.store.retireUnstartedHostArtifacts(targetId);
            }
            await this.store.abandon(targetId);
            return this.publicCommandStatus(await this.store.readStatus(targetId), execution, executionStatus, false, unstartedWindowsRead);
        }
        if (status.state !== 'running' && status.state !== 'unknown') {
            throw new Error('Nonterminal reconciliation reached an impossible command state.');
        }
        const nonterminal = this.publicCommandStatus({
            ...status,
            ...(releaseGuidance === '' ? {} : { message: `${status.message ?? `Command ${targetId} is unresolved.`}${releaseGuidance}` }),
            ...(transaction === undefined ? {} : { transaction }),
        }, execution, executionStatus, canAbandon, unstartedWindowsRead);
        return canReleaseUnverified ? { ...nonterminal, canReleaseUnverified: true } : nonterminal;
    }
    async reconcileUnstartedWindowsMutation(commandId, metadata, status, options) {
        if (options.quarantine || options.releaseUnverified) {
            throw new Error('An unstarted Windows mutation can only be inspected or abandoned; quarantine and release_unverified are not available.');
        }
        if (!options.abandon) {
            return this.publicCommandStatus({
                ...status,
                message: `The runner of mutation ${commandId} never reached the host (no execution record, no host marker). ` +
                    `Run illustrator_reconcile with action=abandon, command_id=${commandId}, and confirm_command_id=${commandId} ` +
                    'to record it as failed before apply and free the lock; the command is never reapplied.',
            }, null, 'inactive', true, true);
        }
        if (options.confirmCommandId !== commandId) {
            throw new Error('Abandoning a command requires confirm_command_id to exactly match the locked command.');
        }
        const leave = await this.enterQueue();
        try {
            if (!(await this.store.inspectNeverStartedMutation(commandId))) {
                throw new Error('The command cannot be abandoned: it is no longer provably an unstarted mutation.');
            }
            await this.observeProvenPreApplyFailure(commandId);
            await this.store.finalizeNeverStartedMutation(this.store.files(commandId), metadata);
        }
        finally {
            leave();
        }
        return this.publicCommandStatus({
            commandId,
            state: 'failed',
            message: `Mutation ${commandId} never reached the host; it was recorded as failed before apply and will not be reapplied.`,
        }, null, 'inactive', false, true);
    }
    async reconcileLegacyState(commandId, lockOwner, options, source, metadata) {
        const inspection = await this.store.readExecution(commandId);
        const execution = inspection.state === 'valid' ? inspection.value : null;
        const executionStatus = execution === null ? 'unknown' : await this.transport.liveness(execution);
        const finalization = source === 'metadata'
            ? await this.store.inspectFinalization(commandId)
            : { state: 'missing' };
        const hasMatchingLegacyFinalization = metadata?.kind === 'mutation' && finalization.state === 'legacy' &&
            finalization.value.commandId === metadata.commandId &&
            finalization.value.operation === metadata.operation &&
            finalization.value.documentKey === metadata.documentKey &&
            finalization.value.requestDigest === metadata.requestDigest &&
            finalization.value.validatorKind === metadata.mutationValidator.kind &&
            finalization.value.validatorVersion === metadata.mutationValidator.version &&
            finalization.value.adapterIdentity === metadata.adapterIdentity;
        const hasFixedLegacyTerminalRecord = source === 'compact' || hasMatchingLegacyFinalization;
        const recoverable = process.platform !== 'win32' && lockOwner === commandId &&
            (metadata?.kind === 'read' || executionStatus === 'inactive' || hasFixedLegacyTerminalRecord);
        const message = source === 'compact'
            ? 'Durable version 1 compact state is quarantined and cannot be replayed under the current adapter identity.'
            : 'Durable version 1 command state is quarantined and cannot be finalized under the current adapter identity.';
        if (options.abandon) {
            if (options.confirmCommandId !== commandId) {
                throw new Error('Abandoning a command requires confirm_command_id to exactly match the locked command.');
            }
            if (!recoverable) {
                throw new Error('Legacy command state cannot be abandoned while execution may still be active or the lock is not owned.');
            }
            if (metadata?.kind !== 'read')
                await this.observeUnresolved(commandId);
            await this.store.abandon(commandId);
            if (execution !== null && executionStatus === 'inactive') {
                return this.publicCommandStatus({ commandId, state: 'failed', message }, execution, executionStatus, false);
            }
            return { commandId, state: 'unknown', message, executionStatus: 'unknown', canAbandon: false };
        }
        if (execution === null) {
            return { commandId, state: 'unknown', message, executionStatus: 'unknown', canAbandon: false };
        }
        return this.publicCommandStatus({ commandId, state: 'unknown', message }, execution, executionStatus, recoverable && executionStatus === 'inactive');
    }
    async readTerminalProven(commandId, status) {
        const envelope = parseHostResultEnvelope(await this.store.readResult(commandId), commandId);
        if (envelope.ok)
            return envelope.raw.state === status.state;
        return status.state === 'failed' && envelope.reason === 'missing' && this.transport.isUndeliveredFailure(status.message ?? '') &&
            !(await this.store.hostRunningPublished(commandId));
    }
    async finalizePersistedMutation(commandId, metadata) {
        if (metadata.kind !== 'mutation')
            return false;
        try {
            const files = this.store.files(commandId);
            const resultRecord = await this.store.readResult(commandId);
            if (resultRecord.state !== 'valid')
                return false;
            const artifact = validateMutationResultArtifact(this.registry, {
                commandId,
                operation: metadata.operation,
                intent: 'apply',
                validator: metadata.mutationValidator,
                adapterIdentity: metadata.adapterIdentity,
            }, resultRecord.bytes);
            const attestation = await this.store.readFinalization(commandId);
            if (attestation === null) {
                if (await this.store.finalizationArtifactExists(commandId))
                    return false;
                await this.store.writeFinalization(files, metadata);
            }
            else if (attestation.commandId !== commandId ||
                attestation.operation !== metadata.operation ||
                attestation.documentKey !== metadata.documentKey ||
                attestation.requestDigest !== metadata.requestDigest ||
                attestation.adapterIdentity !== metadata.adapterIdentity ||
                attestation.validatorKind !== metadata.mutationValidator.kind ||
                attestation.validatorVersion !== metadata.mutationValidator.version ||
                attestation.resultDigestAlgorithm !== 'sha256' || attestation.resultDigest !== artifact.digest ||
                attestation.terminalState !== artifact.classification.state) {
                return false;
            }
            await this.store.writeStatus(files, { commandId, state: 'completed' });
            const finalized = await this.store.readFinalization(commandId);
            if (finalized === null)
                return false;
            await this.store.compactMutation(files, metadata, { kind: 'attested' });
            return true;
        }
        catch (_error) {
            return false;
        }
    }
    async executeOne(command) {
        if (this.staleReadReleaseApplies() && command.kind === 'read' &&
            (command.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS) > MAX_READ_HOST_TIMEOUT_MS) {
            throw new Error(`A read command may declare a host timeout of at most ${MAX_READ_HOST_TIMEOUT_MS} ms (got ${String(command.timeoutMs)}).`);
        }
        let mutationAdapter = null;
        if (command.kind === 'mutation') {
            mutationAdapter = this.registry.resolveIdentity(command.idempotency.operation, command.mutationValidator, command.adapterIdentity);
            if (command.mutationHostApplicationMode !== mutationAdapter.mutationHostApplicationMode) {
                throw new Error('Mutation command host application mode does not match its durable adapter identity.');
            }
        }
        const commandId = command.kind === 'mutation' ? command.idempotency.commandId : randomUUID();
        this.store.files(commandId);
        if (command.kind === 'mutation') {
            const replay = await this.replayMutation(command);
            if (replay !== null)
                return replay;
            if (mutationAdapter?.mutationHostApplicationMode !== undefined) {
                await this.transport.assertHostAvailable(mutationAdapter.mutationHostApplicationMode);
            }
        }
        const call = command.kind === 'read' ? command.hostCall : undefined;
        const callApplication = await this.transport.resolveCallApplication(this.target, call);
        await this.acquireLock(commandId);
        this.inFlightCommandIds.add(commandId);
        let files;
        let expectedExecution;
        let goSent = false;
        let hostOutcome = 'unknown';
        try {
            const gate = command.hostGate?.beforeHost ? await command.hostGate.beforeHost({ commandId }) : undefined;
            const editSessionAdmission = gate ? gate.editSessionAdmission : undefined;
            const dirtyFileAdmission = gate ? gate.dirtyFileAdmission : undefined;
            if (command.kind === 'mutation')
                await this.store.assertMutationCapacity();
            files = await this.store.create(commandId, command.kind, command.mutationValidator, command.kind === 'mutation' ? command.idempotency : undefined);
            await this.store.writeCommandArtifacts(files, [
                { path: files.paramsPath, contents: JSON.stringify(command.params ?? {}) },
                { path: files.scriptPath, contents: `\uFEFF${buildJsxCommand({
                        commandId,
                        paramsPath: files.paramsPath,
                        resultPath: files.resultPath,
                        statusPath: files.statusPath,
                        script: command.script,
                        mutation: command.kind === 'mutation',
                        ...(editSessionAdmission === undefined ? {} : { editSessionAdmission }),
                        ...(dirtyFileAdmission === undefined ? {} : { dirtyFileAdmission }),
                    })}` },
                { path: files.runnerPath, contents: this.transport.buildRunner(files.scriptPath, callApplication, command.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS, command.kind === 'mutation' ? command.mutationHostApplicationMode : undefined, call) },
            ]);
            await this.store.prepareHostArtifactTemps(files, { auditEvents: commandMayWriteAuditEvents(command) });
            const launchFiles = files;
            await this.transport.launch(launchFiles, command.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS, async (identity) => {
                expectedExecution = await this.store.writeExecution(launchFiles, identity);
            }, () => { goSent = true; this.noteGo(commandId); }, call);
            const resultRecord = await this.store.readResult(commandId);
            const envelope = parseHostResultEnvelope(resultRecord, commandId);
            if (!envelope.ok || resultRecord.state !== 'valid') {
                throw new HostResultUnavailableError(commandId, envelope.ok ? 'unsafe' : envelope.reason);
            }
            const raw = envelope.raw;
            if (raw.state === 'failed') {
                if (typeof raw.message !== 'string')
                    throw new HostResultUnavailableError(commandId, 'invalid_structure');
                hostOutcome = 'failed';
                const hostReference = hostReferenceInvalidDetail(raw.message);
                if (hostReference !== null)
                    throw new HostReferenceInvalidError(hostReference);
                throw new Error(raw.message);
            }
            if (raw.state === 'indeterminate') {
                throw new IndeterminateExecutionError(`Illustrator transaction outcome is indeterminate (${commandId}).`, commandId);
            }
            const successLiveness = await this.executionLiveness(commandId, expectedExecution);
            if (expectedExecution && successLiveness !== 'inactive') {
                throw new IndeterminateExecutionError(`Illustrator execution process group is ${successLiveness}; outcome publication cannot be finalized (${commandId}).`, commandId);
            }
            hostOutcome = 'completed';
            if (command.kind === 'mutation') {
                let validatedData;
                let finalizedAt;
                let terminalState;
                try {
                    const metadata = await this.store.readMetadata(commandId);
                    if (metadata?.kind !== 'mutation')
                        throw new Error('Mutation metadata disappeared before finalization.');
                    const artifact = validateMutationResultArtifact(this.registry, {
                        commandId,
                        operation: metadata.operation,
                        intent: 'apply',
                        validator: metadata.mutationValidator,
                        adapterIdentity: metadata.adapterIdentity,
                    }, resultRecord.bytes);
                    validatedData = artifact.data;
                    const attestation = await this.store.writeFinalization(files, metadata);
                    if (attestation.adapterIdentity !== metadata.adapterIdentity ||
                        attestation.resultDigest !== artifact.digest ||
                        attestation.terminalState !== artifact.classification.state) {
                        throw new Error('Published finalization does not match the canonical mutation artifact.');
                    }
                    await this.store.writeStatus(files, { commandId, state: 'completed' });
                    await this.store.compactMutation(files, metadata, { kind: 'attested' });
                    finalizedAt = attestation.finalizedAt;
                    terminalState = attestation.terminalState;
                }
                catch (cause) {
                    throw new IndeterminateExecutionError(`Illustrator mutation result could not be canonically validated and durably attested${describeValidationCause(cause)} (${commandId}).`, commandId);
                }
                try {
                    await this.observeAttested(commandId, terminalState);
                }
                catch (_observerError) {
                    throw new IndeterminateExecutionError(`Illustrator mutation ${commandId} is attested, but its document barrier or edit session could not be updated; the lock is kept. Run illustrator_reconcile.`, commandId);
                }
                raw.data = validatedData;
                raw.delivery = { mode: 'original', finalizedAt };
            }
            else {
                raw.delivery = { mode: 'original', finalizedAt: new Date().toISOString() };
            }
            if (command.hostGate?.afterHost)
                await command.hostGate.afterHost({ commandId, data: raw.data });
            await this.store.release(commandId);
            return raw;
        }
        catch (error) {
            const executionLiveness = await this.executionLiveness(commandId, expectedExecution);
            const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
            if (expectedExecution && executionLiveness !== 'inactive') {
                if (error instanceof IndeterminateExecutionError)
                    throw error;
                throw new IndeterminateExecutionError(`Illustrator execution process group is ${executionLiveness}; outcome is indeterminate (${commandId}).${readReleaseHint(command.kind, commandId)}`, commandId, error instanceof HostProcessExitError
                    ? { exitCode: error.exitCode, signal: error.signal, killed: error.killed }
                    : code === 'ETIMEDOUT' ? { code: 'ETIMEDOUT' } : {});
            }
            if (code === 'ETIMEDOUT') {
                throw new IndeterminateExecutionError(`Illustrator command timed out; outcome is indeterminate (${commandId}).${readReleaseHint(command.kind, commandId)}`, commandId, { code: 'ETIMEDOUT' });
            }
            if (error instanceof HostProcessExitError && (error.signal !== null || error.killed)) {
                const termination = [
                    `exit code ${String(error.exitCode)}`,
                    `signal ${error.signal ?? 'none'}`,
                    `killed ${String(error.killed)}`,
                ].join(', ');
                throw new IndeterminateExecutionError(`Illustrator command process terminated; outcome is indeterminate (${termination}; ${commandId}).${readReleaseHint(command.kind, commandId)}`, commandId, {
                    exitCode: error.exitCode,
                    signal: error.signal,
                    killed: error.killed,
                });
            }
            if (error instanceof IndeterminateExecutionError)
                throw error;
            if (command.kind === 'mutation' && error instanceof HostResultUnavailableError &&
                (error.reason === 'invalid_json' || error.reason === 'invalid_structure')) {
                throw new IndeterminateExecutionError(`${error.message} Illustrator may have applied the change; the outcome is indeterminate.`, commandId);
            }
            if (files && command.kind === 'read' && hostOutcome === 'unknown' && goSent) {
                const undelivered = error instanceof HostProcessExitError &&
                    this.transport.isUndeliveredFailure(error.message) && !(await this.store.hostRunningPublished(commandId));
                if (!undelivered) {
                    const cause = error instanceof HostResultUnavailableError ? `result ${error.reason}`
                        : error instanceof HostProcessExitError ? `osascript exit code ${String(error.exitCode)}` : 'unclassified failure';
                    throw new IndeterminateExecutionError(`Illustrator may have run this command, but its outcome cannot be read (${cause}). ` +
                        `Run illustrator_reconcile for ${commandId} before anything else.`, commandId);
                }
            }
            if (files && command.kind === 'mutation') {
                let hostFailure = { message: null, audit: null };
                try {
                    if (!expectedExecution || executionLiveness !== 'inactive') {
                        throw new Error('Mutation execution inactivity is not proven.');
                    }
                    const metadata = await this.store.readMetadata(commandId);
                    if (metadata?.kind !== 'mutation')
                        throw new Error('Mutation metadata is unavailable for failure tombstone.');
                    hostFailure = await this.observeProvenPreApplyFailure(commandId);
                    await this.store.finalizeProvenPreApplyFailure(files, metadata);
                }
                catch (_terminalError) {
                    throw new IndeterminateExecutionError(`Illustrator mutation does not have one complete, consistent proven pre-apply terminal snapshot; outcome is indeterminate (${commandId}).`, commandId);
                }
                throw new ProvenPreApplyFailureError(commandId, hostFailure.message, hostFailure.audit);
            }
            if (files) {
                try {
                    const durableStatus = await this.store.readStatus(commandId);
                    if (durableStatus.state !== 'completed' && durableStatus.state !== 'failed') {
                        await this.store.writeStatus(files, {
                            commandId,
                            state: 'failed',
                            message: error instanceof Error ? error.message : String(error),
                        });
                    }
                }
                catch (_statusError) {
                    throw new IndeterminateExecutionError(`Illustrator command terminal status could not be published safely (${commandId}).`, commandId);
                }
            }
            try {
                await this.store.release(commandId);
            }
            catch (_releaseError) {
                throw new IndeterminateExecutionError(`Illustrator command lock release could not be verified (${commandId}).`, commandId);
            }
            throw error;
        }
        finally {
            this.inFlightCommandIds.delete(commandId);
        }
    }
    staleReadReleaseApplies() {
        return this.transport.processGroupLiveness !== undefined;
    }
    noteGo(commandId) {
        this.recentGoCommandIds.push(commandId);
        if (this.recentGoCommandIds.length > RECENT_GO_LIMIT)
            this.recentGoCommandIds.shift();
    }
    async acquireLock(commandId) {
        try {
            await this.store.acquire(commandId);
            return;
        }
        catch (first) {
            if (!(first instanceof CommandLockedError))
                throw first;
            let released = false;
            let refusalNote = null;
            try {
                released = await this.releaseStaleUnstartedRead(first.commandId);
            }
            catch (error) {
                refusalNote = `Automatic release of the stale read failed (${error instanceof Error ? error.message : String(error)}); the lock is kept.`;
            }
            if (released) {
                try {
                    await this.store.acquire(commandId);
                    return;
                }
                catch (second) {
                    if (!(second instanceof CommandLockedError))
                        throw second;
                    throw await this.describedLockError(second, null);
                }
            }
            throw await this.describedLockError(first, refusalNote);
        }
    }
    async releaseStaleUnstartedRead(ownerId) {
        if (ownerId === 'unknown' || !this.staleReadReleaseApplies())
            return false;
        if (this.inFlightCommandIds.has(ownerId) || this.recentGoCommandIds.includes(ownerId))
            return false;
        const observationBudget = this.store.createLockObservationBudget();
        const processGroupLiveness = (processGroupId) => this.transport.processGroupLiveness(processGroupId);
        const inspect = async () => await this.store.inspectStaleUnstartedRead(ownerId, {
            minAgeMs: STALE_READ_RELEASE_MIN_AGE_MS, now: this.now(), processGroupLiveness, resumeClaimed: true, observationBudget,
        });
        const eligibility = await inspect();
        if (!eligibility.eligible)
            return false;
        const claim = await this.store.claimStaleReadRelease(ownerId, eligibility.evidence, this.now());
        if (claim.state === 'held' && (claim.claimedAt === null || this.now() - claim.claimedAt <= STALE_READ_CLAIM_RESUME_MS)) {
            observationBudget.startWaiting();
            try {
                while (true) {
                    if (await this.store.readLockOwner(observationBudget, 'stale_owner') !== ownerId)
                        return true;
                }
            }
            catch (error) {
                if (error instanceof LockObservationBudgetExhaustedError)
                    return false;
                throw error;
            }
        }
        const again = await inspect();
        if (!again.eligible)
            return false;
        await this.store.releaseStaleUnstartedRead(ownerId, again.evidence, observationBudget);
        const seconds = String(Math.round(again.evidence.ageMs / 1000));
        process.stderr.write(`illustrator-studio-mcp: released stale unstarted read ${ownerId} (process group ${again.evidence.executionProcessGroupId} stopped, age ${seconds} s)\n`);
        return await this.store.readLockOwner(observationBudget, 'completion_owner') !== ownerId;
    }
    async describedLockError(error, note) {
        if (error.commandId === 'unknown')
            return error;
        let description;
        try {
            description = await this.store.describeLockOwner(error.commandId, (execution) => this.releaseExecutionLiveness(execution));
        }
        catch (_describeError) {
            return error;
        }
        const id = error.commandId;
        const parts = [];
        if (description.kind === null || description.createdAt === null)
            parts.push('its record is unreadable');
        else
            parts.push(`${description.kind}, created ${description.createdAt}, ${formatAge(this.now() - Date.parse(description.createdAt))} ago`);
        if (description.liveness === 'missing')
            parts.push('no execution record');
        else if (description.processGroupId !== null) {
            parts.push(`process group ${description.processGroupId} ${description.liveness === 'inactive' ? 'has stopped' : `is ${description.liveness}`}`);
        }
        else
            parts.push(`its execution is ${description.liveness}`);
        parts.push(`canAbandon=${String(description.canAbandon)}`);
        const inspect = `illustrator_reconcile (action=inspect, command_id=${id})`;
        const steps = description.canAbandon
            ? `It can be abandoned: check it with ${inspect}, then run illustrator_reconcile (action=abandon, command_id=${id}, confirm_command_id=${id}).`
            : description.liveness === 'active'
                ? `Its process is still running: wait for it to finish and retry, or check it with ${inspect}.`
                : `Check it with ${inspect}.`;
        return new CommandLockedError(id, { summary: parts.join('; '), nextSteps: note === null ? steps : `${steps} ${note}` });
    }
    async replayMutation(command) {
        const commandId = command.idempotency.commandId;
        if (await this.store.isQuarantined(commandId))
            throw new CommandQuarantinedError(commandId);
        const compact = await this.store.inspectCompactIdempotency(commandId);
        if (compact.state === 'legacy') {
            throw new IndeterminateExecutionError(`Durable version 1 compact state is quarantined; the command cannot be replayed or reapplied (${commandId}).`, commandId);
        }
        if (compact.state === 'invalid') {
            throw new IndeterminateExecutionError(`Compact idempotency state is ${compact.reason}; the command cannot be replayed or reapplied (${commandId}).`, commandId);
        }
        if (compact.state === 'valid') {
            const terminal = compact.value;
            if (terminal.kind === 'released_unverified') {
                const matches = terminal.operation === command.idempotency.operation &&
                    terminal.documentKey === command.idempotency.documentKey &&
                    terminal.requestDigest === command.idempotency.requestDigest;
                throw new CommandReleasedUnverifiedError(commandId, matches ? undefined : 'The resent request also differs from the released one.');
            }
            const stored = terminal;
            if (stored.operation !== command.idempotency.operation || stored.documentKey !== command.idempotency.documentKey ||
                stored.requestDigest !== command.idempotency.requestDigest ||
                stored.adapterIdentity !== command.adapterIdentity ||
                stored.validatorKind !== command.mutationValidator.kind || stored.validatorVersion !== command.mutationValidator.version) {
                throw new Error(`Idempotency command ID collision for ${commandId}; operation, validator, or canonical request differs.`);
            }
            if (stored.kind === 'tombstone') {
                await this.finishCompactCleanup(stored);
                throw new ProvenPreApplyFailureError(commandId);
            }
            let validatedData;
            try {
                validatedData = (await this.readValidatedCompactReplay(stored)).data;
            }
            catch (cause) {
                throw new IndeterminateExecutionError(`Compact replay result failed canonical validation${describeValidationCause(cause)} (${commandId}).`, commandId);
            }
            await this.finishCompactCleanup(stored);
            await this.observeAttested(commandId, stored.terminalState);
            await this.store.release(commandId);
            if (stored.terminalState !== 'verified') {
                throw new Error(`Command ${commandId} already has durable terminal state ${stored.terminalState} and will not be reapplied.`);
            }
            return {
                commandId,
                state: 'completed',
                data: validatedData,
                delivery: { mode: 'replay', finalizedAt: stored.finalizedAt },
            };
        }
        const metadata = await this.store.inspectMetadata(commandId);
        if (metadata.state === 'missing')
            return null;
        if (metadata.state === 'legacy') {
            throw new IndeterminateExecutionError(`Durable version 1 metadata is quarantined; the command cannot be replayed or reapplied (${commandId}).`, commandId);
        }
        if (metadata.state === 'invalid') {
            if (metadata.reason === 'metadata_missing' && await this.store.hasOrphanFence(commandId))
                throw new CommandReleasedAsOrphanError(commandId);
            throw new IndeterminateExecutionError(`Durable idempotency metadata is ${metadata.reason}; the command cannot be replayed or reapplied (${commandId}).`, commandId);
        }
        const stored = metadata.value;
        if (stored.kind !== 'mutation' || stored.operation !== command.idempotency.operation ||
            stored.documentKey !== command.idempotency.documentKey ||
            stored.requestDigest !== command.idempotency.requestDigest ||
            stored.adapterIdentity !== command.adapterIdentity ||
            stored.mutationValidator.kind !== command.mutationValidator.kind ||
            stored.mutationValidator.version !== command.mutationValidator.version) {
            throw new Error(`Idempotency command ID collision for ${commandId}; operation, validator, or canonical request differs.`);
        }
        const status = await this.store.readStatus(commandId);
        if (status.state === 'failed') {
            const inspection = await this.store.readExecution(commandId);
            const execution = inspection.state === 'valid' ? inspection.value : null;
            if (execution !== null && (await this.transport.liveness(execution)) === 'inactive' &&
                await this.compactPersistedFailure(commandId, stored)) {
                return await this.replayMutation(command);
            }
            throw new IndeterminateExecutionError(`Command ${commandId} has an uncompacted failure whose inactive pre-attempt state is not proven.`, commandId);
        }
        const resultRecord = await this.store.readResult(commandId);
        const attestation = await this.store.readFinalization(commandId);
        if (resultRecord.state === 'valid' && attestation !== null) {
            let artifact;
            let compacted;
            try {
                artifact = validateMutationResultArtifact(this.registry, {
                    commandId,
                    operation: stored.operation,
                    intent: 'apply',
                    validator: stored.mutationValidator,
                    adapterIdentity: stored.adapterIdentity,
                }, resultRecord.bytes);
                if (attestation.commandId !== commandId || attestation.operation !== stored.operation ||
                    attestation.documentKey !== stored.documentKey || attestation.requestDigest !== stored.requestDigest ||
                    attestation.adapterIdentity !== stored.adapterIdentity ||
                    attestation.validatorKind !== stored.mutationValidator.kind ||
                    attestation.validatorVersion !== stored.mutationValidator.version ||
                    attestation.resultDigestAlgorithm !== 'sha256' || attestation.resultDigest !== artifact.digest ||
                    attestation.terminalState !== artifact.classification.state) {
                    throw new Error('Attested mutation terminal state does not match its canonical result.');
                }
                if (status.state !== 'completed') {
                    await this.store.writeStatus(this.store.files(commandId), { commandId, state: 'completed' });
                }
                compacted = await this.store.compactMutation(this.store.files(commandId), stored, { kind: 'attested' });
            }
            catch (_error) {
                throw new IndeterminateExecutionError(`Attested mutation replay result failed canonical validation (${commandId}).`, commandId);
            }
            await this.observeAttested(commandId, artifact.classification.state);
            await this.store.release(commandId);
            if (artifact.classification.state !== 'verified') {
                throw new Error(`Command ${commandId} already has durable terminal state ${artifact.classification.state} and will not be reapplied.`);
            }
            return {
                commandId,
                state: 'completed',
                data: artifact.data,
                delivery: { mode: 'replay', finalizedAt: compacted.finalizedAt },
            };
        }
        throw new IndeterminateExecutionError(`Command ${commandId} is active, unattested, incomplete, or unsafe; reconcile it instead of reapplying.`, commandId);
    }
    async compactPersistedFailure(commandId, metadata) {
        try {
            await this.observeProvenPreApplyFailure(commandId);
            await this.store.finalizeProvenPreApplyFailure(this.store.files(commandId), metadata);
            return true;
        }
        catch (_error) {
            return false;
        }
    }
    async readValidatedCompactReplay(record) {
        const resultRecord = await this.store.readResult(record.commandId);
        if (resultRecord.state !== 'valid') {
            throw new IndeterminateExecutionError(`Compact replay result is missing, unsafe, or tampered (${record.commandId}).`, record.commandId);
        }
        try {
            const artifact = validateMutationResultArtifact(this.registry, {
                commandId: record.commandId,
                operation: record.operation,
                intent: 'apply',
                validator: { kind: record.validatorKind, version: record.validatorVersion },
                adapterIdentity: record.adapterIdentity,
            }, resultRecord.bytes);
            if (artifact.digest !== record.resultDigest || artifact.classification.state !== record.terminalState) {
                throw new Error('Compact replay marker does not match its canonical result artifact.');
            }
            return artifact;
        }
        catch (_error) {
            throw new IndeterminateExecutionError(`Compact replay result failed canonical validation (${record.commandId}).`, record.commandId);
        }
    }
    async finishCompactCleanup(terminal) {
        switch (terminal.kind) {
            case 'released_unverified':
                return;
            case 'replay_bundle':
            case 'tombstone':
                break;
            default:
                assertNeverTerminalKind(terminal);
        }
        const record = terminal;
        const metadata = {
            version: MUTATION_DURABLE_STATE_VERSION,
            commandId: record.commandId,
            createdAt: record.finalizedAt,
            kind: 'mutation',
            operation: record.operation,
            documentKey: record.documentKey,
            requestDigest: record.requestDigest,
            mutationValidator: { kind: record.validatorKind, version: record.validatorVersion },
            adapterIdentity: record.adapterIdentity,
        };
        switch (record.kind) {
            case 'replay_bundle':
                await this.store.compactMutation(this.store.files(record.commandId), metadata, { kind: 'attested' });
                break;
            case 'tombstone':
                await this.store.finalizeProvenPreApplyFailure(this.store.files(record.commandId), metadata);
                break;
            default:
                assertNeverTerminalKind(record);
        }
    }
    async commandExecutionState(commandId) {
        let execution;
        try {
            const inspection = await this.store.readExecution(commandId);
            if (inspection.state === 'missing')
                return 'inactive';
            if (inspection.state !== 'valid')
                return 'unknown';
            execution = inspection.value;
        }
        catch (_error) {
            return 'unknown';
        }
        return await this.transport.liveness(execution);
    }
    async executionLiveness(commandId, expectedExecution) {
        if (expectedExecution === undefined)
            return 'inactive';
        let durableExecution;
        try {
            const inspection = await this.store.readExecution(commandId);
            if (inspection.state !== 'valid')
                return 'unknown';
            durableExecution = inspection.value;
        }
        catch (_error) {
            return 'unknown';
        }
        if (durableExecution === null || !(expectedExecution.version === 1
            ? executionIdentityMatches(durableExecution, expectedExecution) : executionRecordsMatch(durableExecution, expectedExecution)))
            return 'unknown';
        return await this.transport.liveness(durableExecution);
    }
    publicCommandStatus(status, execution, executionStatus, canAbandon, unstartedWindows = false) {
        const base = {
            commandId: status.commandId,
            ...(status.message === undefined ? {} : { message: status.message }),
        };
        if (unstartedWindows && execution === null) {
            if (status.state === 'completed')
                throw new Error('A missing execution cannot prove completion.');
            if (status.state === 'failed')
                return { ...base, state: 'failed', executionRecord: 'missing',
                    executionStatus: 'inactive', canAbandon: false };
            return { ...base, state: status.state, executionRecord: 'missing', executionStatus: 'inactive',
                canAbandon };
        }
        const identity = execution === null ? null : {
            ...(execution.version === 1 ? { executionControllerProcessGroupId: execution.processGroupId }
                : { executionIdentity: { kind: 'windows_process', pid: execution.pid, creationTime: execution.creationTime } }),
            executionNonce: execution.nonce, executionState: execution.state,
        };
        if (status.state === 'completed' || status.state === 'failed') {
            if (execution === null || executionStatus !== 'inactive') {
                throw new Error('Terminal command publication requires a complete inactive execution identity.');
            }
            return {
                ...base,
                state: status.state,
                ...identity,
                executionStatus,
                canAbandon: false,
            };
        }
        const nonterminal = {
            ...base,
            state: status.state,
            ...(status.transaction === undefined ? {} : { transaction: status.transaction }),
        };
        if (execution === null) {
            return { ...nonterminal, executionStatus: 'unknown', canAbandon: false };
        }
        if (executionStatus === 'inactive') {
            return { ...nonterminal, ...identity, executionStatus, canAbandon };
        }
        return { ...nonterminal, ...identity, executionStatus, canAbandon: false };
    }
    indeterminateTransaction(audit) {
        let pending = null;
        let lastExecuted = null;
        for (const event of audit) {
            if (event.event === 'started') {
                pending = event.phase;
                lastExecuted = event.phase;
            }
            else if (event.event === 'succeeded' || event.event === 'failed') {
                if (pending === event.phase)
                    pending = null;
                lastExecuted = event.phase;
            }
        }
        const phase = pending ?? lastExecuted;
        if (phase === null)
            return undefined;
        if (phase === 'rollback') {
            const lastRollback = [...audit].reverse().find((event) => event.phase === 'rollback');
            let rollbackStatus = 'indeterminate';
            if (pending !== 'rollback' && lastRollback?.event === 'succeeded')
                rollbackStatus = 'verified';
            if (pending !== 'rollback' && lastRollback?.event === 'failed' && lastRollback.reasonCode === 'rollback_failed') {
                rollbackStatus = 'failed';
            }
            return { state: 'indeterminate', phase, rollback: { status: rollbackStatus }, audit };
        }
        return { state: 'indeterminate', phase, rollback: { status: 'not_started' }, audit };
    }
}
