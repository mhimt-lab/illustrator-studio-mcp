import { execFile, spawn } from 'node:child_process';
import { defaultCommandRunner } from './command-runner.js';
import { appleScriptApplicationReference, detectRunningIllustratorBundles, illustratorApplicationTarget, resolveIllustratorApplication, resolveIllustratorApplicationForCall, resolveIllustratorNameToBundleId, } from './illustrator-application.js';
import { createHash, randomUUID } from 'node:crypto';
import { CommandLockedError, FileCommandStore, MUTATION_DURABLE_STATE_VERSION, assertNeverTerminalKind, } from './command-store.js';
import { IndeterminateExecutionError, CommandQuarantinedError, CommandReleasedUnverifiedError, ProvenPreApplyFailureError, } from './domain.js';
import { buildJsxCommand } from './jsx-runtime.js';
import { validateMutationResultArtifact, } from './mutation-result-validator.js';
export function launchControllerKind(versions = process.versions) {
    return typeof versions.electron === 'string' ? 'sh' : 'node';
}
export function macSessionLockState(ioregOutput) {
    const observations = [...ioregOutput.matchAll(/(?:CGSSessionScreenIsLocked|IOConsoleLocked)"\s*=\s*(Yes|No)\b/g)].map((match) => match[1]);
    if (observations.includes('Yes'))
        return 'locked';
    if (observations.includes('No'))
        return 'unlocked';
    return 'unknown';
}
const defaultHostApplicationAvailabilityProbe = async () => {
    const stdout = await new Promise((resolve, reject) => {
        execFile('/usr/sbin/ioreg', ['-n', 'Root', '-d1'], { timeout: 5_000 }, (error, output) => {
            if (error)
                reject(error);
            else
                resolve(output);
        });
    });
    const lockState = macSessionLockState(stdout);
    if (lockState !== 'unlocked') {
        throw new Error(`Foreground Illustrator mutation admission requires positive unlocked evidence; session state is ${lockState}. Unlock the screen and retry with a new command_id.`);
    }
};
export const OSASCRIPT_LAUNCH_CONTROLLER_SOURCE = String.raw `
const { spawn } = require("node:child_process");
process.umask(0o077);
const nonce = process.argv[1];
const executable = process.argv[2];
let args;
try { args = JSON.parse(process.argv[3]); } catch (error) { process.exit(64); }
if (typeof nonce !== "string" || typeof executable !== "string" || !(args instanceof Array)) process.exit(64);
for (const argument of args) if (typeof argument !== "string") process.exit(64);
let launched = false;
let inner = null;
function send(message) { if (process.connected) process.send(message); }
process.on("disconnect", function () { if (!launched) process.exit(0); });
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, function () {
    if (inner !== null) inner.kill(signal);
    else process.exit(128);
  });
}
process.on("message", function (message) {
  if (launched || !message || message.type !== "go" || message.nonce !== nonce) return;
  launched = true;
  inner = spawn(executable, args, { stdio: ["ignore", "ignore", "pipe"] });
  send({ type: "launched", nonce: nonce, pid: inner.pid });
  inner.stderr.on("data", function (chunk) { process.stderr.write(chunk); });
  inner.once("error", function (error) {
    send({ type: "result", nonce: nonce, exitCode: null, signal: null, message: error.message });
    process.exit(1);
  });
  inner.once("close", function (code, signal) {
    send({ type: "result", nonce: nonce, exitCode: code, signal: signal });
    if (signal !== null) {
      process.removeAllListeners(signal);
      process.kill(process.pid, signal);
    } else process.exit(code === null ? 1 : code);
  });
});
send({ type: "ready", nonce: nonce });
`;
export const OSASCRIPT_SH_LAUNCHER_SOURCE = [
    'umask 077',
    '[ "$#" -eq 2 ] && [ -n "$1" ] && [ -n "$2" ] || exit 64',
    'printf \'ready %s\\n\' "$1"',
    'IFS= read -r go || exit 0',
    '[ "$go" = "go $1" ] || exit 64',
    'exec osascript "$2" </dev/null >/dev/null',
].join('\n');
class OsascriptProcessExitError extends Error {
    exitCode;
    signal;
    killed;
    constructor(message, exitCode, signal, killed) {
        super(message);
        this.exitCode = exitCode;
        this.signal = signal;
        this.killed = killed;
        this.name = 'OsascriptProcessExitError';
    }
}
function throwOnLauncherExit(outcome, child, stderr) {
    if (outcome.error)
        throw outcome.error;
    if (outcome.signal !== null || child.killed) {
        throw new OsascriptProcessExitError(stderr.trim() || `osascript controller terminated with status ${String(outcome.code)}, signal ${outcome.signal ?? 'none'}, killed ${String(child.killed)}.`, outcome.code, outcome.signal, child.killed);
    }
    if (outcome.code !== 0)
        throw new Error(stderr.trim() || `osascript exited with status ${String(outcome.code)}.`);
}
const defaultIllustratorApplicationProbes = {
    running: () => detectRunningIllustratorBundles(defaultCommandRunner),
    resolveName: (name) => resolveIllustratorNameToBundleId(defaultCommandRunner, name),
};
export const DEFAULT_CALL_QUEUE_WAIT_LIMIT_MS = 60_000;
export class IllustratorBusyError extends Error {
    waitedMs;
    constructor(waitedMs) {
        super(`Illustrator is still running earlier calls from this server after ${Math.round(waitedMs)} ms; ` +
            'this call was not started. Wait for them to finish and retry.');
        this.waitedMs = waitedMs;
        this.name = 'IllustratorBusyError';
    }
}
export class OsascriptBridge {
    store;
    processRunner;
    registry;
    hostApplicationAvailabilityProbe;
    applicationProbes;
    target;
    queueWaitLimitMs;
    launchController;
    shProcessRunner;
    queueTail = Promise.resolve();
    terminalObserver = null;
    constructor(application = resolveIllustratorApplication({ env: process.env.ILLUSTRATOR_APPLICATION }).application, store = new FileCommandStore(), processRunner = (command, args, options) => spawn(command, args, options), registry = store.getAdapterRegistry(), hostApplicationAvailabilityProbe = defaultHostApplicationAvailabilityProbe, applicationProbes = defaultIllustratorApplicationProbes, options = {}) {
        this.store = store;
        this.processRunner = processRunner;
        this.registry = registry;
        this.hostApplicationAvailabilityProbe = hostApplicationAvailabilityProbe;
        this.applicationProbes = applicationProbes;
        this.queueWaitLimitMs = options.queueWaitLimitMs ?? DEFAULT_CALL_QUEUE_WAIT_LIMIT_MS;
        this.launchController = options.launchController ?? launchControllerKind();
        this.shProcessRunner = options.shProcessRunner ?? ((command, args, spawnOptions) => spawn(command, args, spawnOptions));
        if (!this.registry.isSealed() || this.store.getAdapterRegistry() !== this.registry) {
            throw new Error('Bridge and command store must share the exact sealed mutation adapter registry.');
        }
        this.target = illustratorApplicationTarget(application);
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
        if (this.terminalObserver === null || await this.store.readLockOwner() !== commandId)
            return;
        const result = await this.store.readResult(commandId);
        if (result.state !== 'valid')
            throw new Error(`The attested result of ${commandId} is unreadable; edit sessions cannot be updated.`);
        await this.terminalObserver.attested({ commandId, terminalState, resultText: result.text });
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
            processGroupLiveness: (processGroupId) => this.processGroupLiveness(processGroupId),
        });
        return await this.releasedStatus(record);
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
                processGroupLiveness: (processGroupId) => this.processGroupLiveness(processGroupId),
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
            if (!options.abandon && lockOwner === targetId) {
                const eligibility = await this.store.inspectReleaseUnverified(targetId, (id) => this.processGroupLiveness(id));
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
        const execution = await this.store.readExecution(targetId);
        const executionStatus = execution === null ? 'unknown' : this.processGroupLiveness(execution.processGroupId);
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
        const canReleaseUnverified = !canAbandon && lockOwner === targetId && executionStatus === 'inactive' &&
            (await this.store.inspectReleaseUnverified(targetId, (id) => this.processGroupLiveness(id))).eligible;
        const releaseGuidance = canReleaseUnverified
            ? ` Its outcome cannot be verified. Check the document in Illustrator first (make sure no script is still running; ` +
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
            await this.store.abandon(targetId);
            return this.publicCommandStatus(await this.store.readStatus(targetId), execution, executionStatus, false);
        }
        if (status.state !== 'running' && status.state !== 'unknown') {
            throw new Error('Nonterminal reconciliation reached an impossible command state.');
        }
        const nonterminal = this.publicCommandStatus({
            ...status,
            ...(releaseGuidance === '' ? {} : { message: `${status.message ?? `Command ${targetId} is unresolved.`}${releaseGuidance}` }),
            ...(transaction === undefined ? {} : { transaction }),
        }, execution, executionStatus, canAbandon);
        return canReleaseUnverified ? { ...nonterminal, canReleaseUnverified: true } : nonterminal;
    }
    async reconcileLegacyState(commandId, lockOwner, options, source, metadata) {
        const execution = await this.store.readExecution(commandId);
        const executionStatus = execution === null ? 'unknown' : this.processGroupLiveness(execution.processGroupId);
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
        const recoverable = lockOwner === commandId &&
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
                await this.hostApplicationAvailabilityProbe(mutationAdapter.mutationHostApplicationMode);
            }
        }
        const callApplication = (await resolveIllustratorApplicationForCall(this.target, this.applicationProbes)).application;
        await this.store.acquire(commandId);
        let files;
        let expectedExecution;
        try {
            const gate = command.hostGate?.beforeHost ? await command.hostGate.beforeHost({ commandId }) : undefined;
            const editSessionAdmission = gate ? gate.editSessionAdmission : undefined;
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
                    })}` },
                { path: files.runnerPath, contents: this.appleScript(files.scriptPath, callApplication, command.kind === 'mutation' ? command.mutationHostApplicationMode : undefined) },
            ]);
            await this.store.prepareHostArtifactTemps(files);
            await this.runAppleScript(files, command.timeoutMs ?? 30_000, (execution) => { expectedExecution = execution; });
            const resultRecord = await this.store.readResult(commandId);
            if (resultRecord.state !== 'valid') {
                throw new Error(`Illustrator command result is missing or unsafe (${resultRecord.state === 'invalid' ? resultRecord.reason : 'missing'}).`);
            }
            const raw = JSON.parse(resultRecord.text);
            if (typeof raw !== 'object' || raw === null || !('state' in raw) || !('commandId' in raw) ||
                raw.commandId !== commandId || (raw.state !== 'completed' && raw.state !== 'failed' && raw.state !== 'indeterminate')) {
                throw new Error('Illustrator command result is structurally invalid.');
            }
            if (raw.state === 'failed') {
                if (!('message' in raw) || typeof raw.message !== 'string') {
                    throw new Error('Failed Illustrator command result is missing its message.');
                }
                throw new Error(raw.message);
            }
            if (raw.state === 'indeterminate') {
                throw new IndeterminateExecutionError(`Illustrator transaction outcome is indeterminate (${commandId}).`, commandId);
            }
            if (!('data' in raw))
                throw new Error('Completed Illustrator command result is missing data.');
            const successLiveness = await this.executionLiveness(commandId, expectedExecution);
            if (expectedExecution && successLiveness !== 'inactive') {
                throw new IndeterminateExecutionError(`Illustrator execution process group is ${successLiveness}; outcome publication cannot be finalized (${commandId}).`, commandId);
            }
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
                catch (_error) {
                    throw new IndeterminateExecutionError(`Illustrator mutation result could not be canonically validated and durably attested (${commandId}).`, commandId);
                }
                try {
                    await this.observeAttested(commandId, terminalState);
                }
                catch (_observerError) {
                    throw new IndeterminateExecutionError(`Illustrator mutation ${commandId} is attested, but its edit session could not be updated; the lock is kept. Run illustrator_reconcile.`, commandId);
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
                throw new IndeterminateExecutionError(`Illustrator execution process group is ${executionLiveness}; outcome is indeterminate (${commandId}).`, commandId, error instanceof OsascriptProcessExitError
                    ? { exitCode: error.exitCode, signal: error.signal, killed: error.killed }
                    : code === 'ETIMEDOUT' ? { code: 'ETIMEDOUT' } : {});
            }
            if (code === 'ETIMEDOUT') {
                throw new IndeterminateExecutionError(`Illustrator command timed out; outcome is indeterminate (${commandId}).`, commandId, { code: 'ETIMEDOUT' });
            }
            if (error instanceof OsascriptProcessExitError && (error.signal !== null || error.killed)) {
                const termination = [
                    `exit code ${String(error.exitCode)}`,
                    `signal ${error.signal ?? 'none'}`,
                    `killed ${String(error.killed)}`,
                ].join(', ');
                throw new IndeterminateExecutionError(`Illustrator command process terminated; outcome is indeterminate (${termination}; ${commandId}).`, commandId, {
                    exitCode: error.exitCode,
                    signal: error.signal,
                    killed: error.killed,
                });
            }
            if (error instanceof IndeterminateExecutionError)
                throw error;
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
            catch (_error) {
                throw new IndeterminateExecutionError(`Compact replay result failed canonical validation (${commandId}).`, commandId);
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
            const execution = await this.store.readExecution(commandId);
            if (execution !== null && this.processGroupLiveness(execution.processGroupId) === 'inactive' &&
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
    appleScript(jsxPath, callApplication, mode) {
        const escapedPath = jsxPath.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
        const applicationReference = appleScriptApplicationReference(callApplication);
        const foregroundGuard = mode === 'foreground'
            ? 'set mcpSessionState to do shell script "/usr/sbin/ioreg -n Root -d1"\n' +
                'set mcpSessionLocked to mcpSessionState contains "CGSSessionScreenIsLocked\\\"=Yes" or mcpSessionState contains "CGSSessionScreenIsLocked\\\" = Yes" or mcpSessionState contains "IOConsoleLocked\\\"=Yes" or mcpSessionState contains "IOConsoleLocked\\\" = Yes"\n' +
                'set mcpSessionUnlocked to mcpSessionState contains "CGSSessionScreenIsLocked\\\"=No" or mcpSessionState contains "CGSSessionScreenIsLocked\\\" = No" or mcpSessionState contains "IOConsoleLocked\\\"=No" or mcpSessionState contains "IOConsoleLocked\\\" = No"\n' +
                'if mcpSessionLocked then error "MCP_SCREEN_LOCKED" number 69\n' +
                'if not mcpSessionUnlocked then error "MCP_SCREEN_LOCK_STATE_UNKNOWN" number 70\n'
            : '';
        const activation = mode === 'foreground' ? '  activate\n' : '';
        return `${foregroundGuard}tell ${applicationReference}\n${activation}  do javascript of file "${escapedPath}"\nend tell\n`;
    }
    async runAppleScript(files, timeoutMs, onExecutionPrepared) {
        if (this.launchController === 'sh')
            await this.runShLauncher(files, timeoutMs, onExecutionPrepared);
        else
            await this.runNodeLauncher(files, timeoutMs, onExecutionPrepared);
    }
    async runNodeLauncher(files, timeoutMs, onExecutionPrepared) {
        const nonce = randomUUID();
        const child = this.processRunner(process.execPath, [
            '-e',
            OSASCRIPT_LAUNCH_CONTROLLER_SOURCE,
            nonce,
            'osascript',
            JSON.stringify([files.runnerPath]),
        ], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], detached: true });
        if (child.pid === undefined || !child.connected)
            throw new Error('Could not start the osascript launch controller.');
        let stderr = '';
        child.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
        const exit = new Promise((resolve) => {
            child.once('error', (error) => { resolve({ code: null, signal: null, error }); });
            child.once('exit', (code, signal) => { resolve({ code, signal }); });
        });
        const ready = new Promise((resolve, reject) => {
            const onMessage = (message) => {
                if (typeof message === 'object' && message !== null &&
                    message.type === 'ready' && message.nonce === nonce) {
                    child.off('message', onMessage);
                    resolve();
                }
            };
            child.on('message', onMessage);
            void exit.then((outcome) => {
                child.off('message', onMessage);
                reject(outcome.error ?? new Error('Launch controller exited before readiness.'));
            });
        });
        try {
            const execution = await this.store.writeExecution(files, { pid: child.pid, processGroupId: child.pid, nonce });
            onExecutionPrepared(execution);
        }
        catch (error) {
            void ready.catch(() => undefined);
            child.disconnect();
            const stopped = await Promise.race([
                exit.then(() => true),
                new Promise((resolve) => { setTimeout(() => { resolve(false); }, 1_000); }),
            ]);
            if (!stopped) {
                child.kill('SIGTERM');
                await exit;
            }
            throw error;
        }
        let timer;
        const timeout = new Promise((_resolve, reject) => {
            timer = setTimeout(() => {
                const timeoutError = new Error(`osascript exceeded ${timeoutMs} ms.`);
                timeoutError.code = 'ETIMEDOUT';
                reject(timeoutError);
            }, timeoutMs);
        });
        try {
            await Promise.race([ready, timeout]);
            const sent = child.send({ type: 'go', nonce });
            if (!sent) {
                throw new IndeterminateExecutionError(`Launch controller could not acknowledge the go boundary (${files.commandId}).`, files.commandId);
            }
            throwOnLauncherExit(await Promise.race([exit, timeout]), child, stderr);
        }
        finally {
            if (timer !== undefined)
                clearTimeout(timer);
        }
    }
    async runShLauncher(files, timeoutMs, onExecutionPrepared) {
        const nonce = randomUUID();
        const child = this.shProcessRunner('/bin/sh', [
            '-c',
            OSASCRIPT_SH_LAUNCHER_SOURCE,
            'sh',
            nonce,
            files.runnerPath,
        ], { stdio: ['pipe', 'pipe', 'pipe'], detached: true });
        const exit = new Promise((resolve) => {
            child.once('error', (error) => { resolve({ code: null, signal: null, error }); });
            child.once('exit', (code, signal) => { resolve({ code, signal }); });
        });
        const { stdin, stdout } = child;
        if (child.pid === undefined || stdin === null || stdout === null) {
            throw new Error('Could not start the osascript launch controller.');
        }
        let stdinError = null;
        stdin.on('error', (error) => { stdinError = error; });
        let stderr = '';
        child.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
        const readyLine = `ready ${nonce}\n`;
        const ready = new Promise((resolve, reject) => {
            let received = '';
            const onData = (chunk) => {
                received += chunk.toString('utf8');
                if (received === readyLine) {
                    stdout.off('data', onData);
                    resolve();
                }
                else if (!readyLine.startsWith(received)) {
                    stdout.off('data', onData);
                    stdin.end();
                    reject(new Error('Launch controller sent an unexpected readiness line.'));
                }
            };
            stdout.on('data', onData);
            void exit.then((outcome) => {
                stdout.off('data', onData);
                reject(outcome.error ?? new Error('Launch controller exited before readiness.'));
            });
        });
        try {
            const execution = await this.store.writeExecution(files, { pid: child.pid, processGroupId: child.pid, nonce });
            onExecutionPrepared(execution);
        }
        catch (error) {
            void ready.catch(() => undefined);
            stdin.end();
            const stopped = await Promise.race([
                exit.then(() => true),
                new Promise((resolve) => { setTimeout(() => { resolve(false); }, 1_000); }),
            ]);
            if (!stopped) {
                child.kill('SIGTERM');
                await exit;
            }
            throw error;
        }
        let timer;
        const timeout = new Promise((_resolve, reject) => {
            timer = setTimeout(() => {
                const timeoutError = new Error(`osascript exceeded ${timeoutMs} ms.`);
                timeoutError.code = 'ETIMEDOUT';
                reject(timeoutError);
            }, timeoutMs);
        });
        try {
            await Promise.race([ready, timeout]);
            const written = await new Promise((resolve) => {
                stdin.write(`go ${nonce}\n`, (error) => { resolve(error === null || error === undefined); });
            });
            stdin.end();
            if (!written || stdinError !== null) {
                throw new IndeterminateExecutionError(`Launch controller could not acknowledge the go boundary (${files.commandId}).`, files.commandId);
            }
            throwOnLauncherExit(await Promise.race([exit, timeout]), child, stderr);
        }
        finally {
            if (timer !== undefined)
                clearTimeout(timer);
        }
    }
    async commandExecutionState(commandId) {
        let execution;
        try {
            execution = await this.store.readExecution(commandId);
        }
        catch (_error) {
            return 'unknown';
        }
        if (execution === null)
            return 'inactive';
        return this.processGroupLiveness(execution.processGroupId);
    }
    processGroupLiveness(processGroupId) {
        try {
            process.kill(-processGroupId, 0);
            return 'active';
        }
        catch (error) {
            if (typeof error === 'object' && error !== null && 'code' in error) {
                if (error.code === 'ESRCH')
                    return 'inactive';
                if (error.code === 'EPERM')
                    return 'active';
            }
            return 'unknown';
        }
    }
    async executionLiveness(commandId, expectedExecution) {
        if (expectedExecution === undefined)
            return 'inactive';
        let durableExecution;
        try {
            durableExecution = await this.store.readExecution(commandId);
        }
        catch (_error) {
            return 'unknown';
        }
        if (durableExecution === null || durableExecution.pid !== expectedExecution.pid ||
            durableExecution.processGroupId !== expectedExecution.processGroupId ||
            durableExecution.nonce !== expectedExecution.nonce || durableExecution.state !== expectedExecution.state ||
            durableExecution.startedAt !== expectedExecution.startedAt)
            return 'unknown';
        return this.processGroupLiveness(expectedExecution.processGroupId);
    }
    publicCommandStatus(status, execution, executionStatus, canAbandon) {
        const base = {
            commandId: status.commandId,
            ...(status.message === undefined ? {} : { message: status.message }),
        };
        if (status.state === 'completed' || status.state === 'failed') {
            if (execution === null || executionStatus !== 'inactive') {
                throw new Error('Terminal command publication requires a complete inactive execution identity.');
            }
            return {
                ...base,
                state: status.state,
                executionControllerProcessGroupId: execution.processGroupId,
                executionNonce: execution.nonce,
                executionState: execution.state,
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
        const identity = {
            executionControllerProcessGroupId: execution.processGroupId,
            executionNonce: execution.nonce,
            executionState: execution.state,
        };
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
