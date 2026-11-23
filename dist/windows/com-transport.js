import { DurableCommandBridge } from '../durable-command-bridge.js';
import { IndeterminateExecutionError } from '../domain.js';
import { HostProcessExitError } from '../host-transport.js';
import { classifyWindowsRunnerTermination } from './failure-classification.js';
import { windowsRecordLiveness } from './liveness.js';
import { WINDOWS_READ_RUNNER_SOURCE, WINDOWS_RUNNER_SOURCE, windowsCommandRunner, windowsPowerShellExecutable } from './powershell-runner.js';
import { validateWindowsAttachObservation } from './attach-observation.js';
import { assertWindowsMutationAdmission, WindowsMutationAdmissionError } from './mutation-admission.js';
import { WindowsHostChannelState } from './host-channel.js';
import { CREATE_AREA_TEXT_ADAPTER_IDENTITY } from '../adapters/create-area-text-adapter.js';
import { TRANSFORM_OBJECT_ADAPTER_IDENTITY } from '../adapters/transform-object-adapter.js';
import { ALIGN_OBJECTS_ADAPTER_IDENTITY } from '../adapters/align-objects-adapter.js';
import { SET_OBJECT_STATE_ADAPTER_IDENTITY } from '../adapters/set-object-state-adapter.js';
import { SET_STACKING_ORDER_ADAPTER_IDENTITY } from '../adapters/set-stacking-order-adapter.js';
import { DUPLICATE_OBJECT_ADAPTER_IDENTITY } from '../adapters/duplicate-object-adapter.js';
import { WINDOWS_DUPLICATE_ADAPTER_IDENTITY } from './duplicate-object.js';
import { GROUP_OBJECTS_ADAPTER_IDENTITY } from '../adapters/group-objects-adapter.js';
import { CREATE_LAYER_ADAPTER_IDENTITY } from '../adapters/create-layer-adapter.js';
import { SET_LAYER_STATE_ADAPTER_IDENTITY } from '../adapters/set-layer-state-adapter.js';
import { MOVE_OBJECT_TO_LAYER_ADAPTER_IDENTITY } from '../adapters/move-object-to-layer-adapter.js';
import { SET_PATH_APPEARANCE_ADAPTER_IDENTITY } from '../adapters/set-path-appearance-adapter.js';
import { CREATE_SHAPE_ADAPTER_IDENTITY } from '../adapters/create-shape-adapter.js';
import { CREATE_POINT_TEXT_ADAPTER_IDENTITY } from '../adapters/create-point-text-adapter.js';
import { CREATE_RECTANGLE_ADAPTER_IDENTITY } from '../adapters/create-rectangle-adapter.js';
import { REPLACE_AREA_TEXT_RANGE_ADAPTER_IDENTITY } from '../adapters/replace-area-text-range-adapter.js';
import { REPLACE_POINT_TEXT_ADAPTER_IDENTITY } from '../adapters/replace-point-text-adapter.js';
import { REPLACE_POINT_TEXT_BATCH_ADAPTER_IDENTITY } from '../adapters/replace-point-text-batch-adapter.js';
import { REPLACE_TEXT_RANGE_ADAPTER_IDENTITY } from '../adapters/replace-text-range-adapter.js';
import { SET_TEXT_STYLE_ADAPTER_IDENTITY } from '../adapters/set-text-style-adapter.js';
import { WINDOWS_PLACE_IMAGE_ADAPTER_IDENTITY } from './place-image.js';
import { WINDOWS_RELINK_IMAGE_ADAPTER_IDENTITY } from './relink-image.js';
import { WINDOWS_STROKE_ADAPTER_IDENTITY } from './set-stroke-style.js';
import { launchWindowsRunner } from './runner-launch.js';
import { measureWindowsDuration } from './perf-probe.js';
export { windowsCommandRunner };
export const WINDOWS_ILLUSTRATOR_APPLICATION = 'Illustrator.Application';
export const WINDOWS_READ_ONLY_NOTICE = 'Mutations not available on Windows yet.';
export class WindowsReadOnlyError extends Error {
    code = 'WINDOWS_READ_ONLY';
    constructor() { super(WINDOWS_READ_ONLY_NOTICE); this.name = 'WindowsReadOnlyError'; }
}
export class WindowsHostUnavailableError extends Error {
    reason;
    code = 'WINDOWS_HOST_UNAVAILABLE';
    constructor(reason) {
        super(`Windows Illustrator attach refused: ${reason}. Start exactly one Illustrator instance; the server never launches it.`);
        this.reason = reason;
        this.name = 'WindowsHostUnavailableError';
    }
}
export const WINDOWS_ATTACH_PROBE = String.raw `
$ErrorActionPreference = 'Stop'
$processes = @(Get-Process -Name Illustrator -ErrorAction SilentlyContinue)
$paths = @($processes | ForEach-Object { $_.Path })
$fileVersions = @()
foreach ($path in $paths) {
  $fileVersion = $null
  if ($path) { try { $fileVersion = [string][System.Diagnostics.FileVersionInfo]::GetVersionInfo($path).FileVersion } catch { } }
  $fileVersions += , $fileVersion
}
$version = $null
$available = $false
if ($processes.Count -eq 1 -and $paths.Count -eq 1 -and $paths[0]) {
  try {
    $application = [Runtime.InteropServices.Marshal]::GetActiveObject('Illustrator.Application')
    $version = [string]$application.Version
    $available = $version.Length -gt 0
  } catch { }
}
@{ powerShellVersion = [string]$PSVersionTable.PSVersion; apartmentState = [string][Threading.Thread]::CurrentThread.ApartmentState;
  processCount = $processes.Count; paths = $paths; fileVersions = $fileVersions; attachAvailable = $available; version = $version } | ConvertTo-Json -Compress
`;
const WINDOWS_DESTINATION_PROBE = WINDOWS_ATTACH_PROBE.replace('$version = [string]$application.Version\n    $available = $version.Length -gt 0', '$available = $null -ne $application');
export function parseWindowsAttachObservation(outcome) {
    if (outcome.kind !== 'exit' || outcome.code !== 0 || outcome.signal !== null)
        return null;
    try {
        return validateWindowsAttachObservation(JSON.parse(outcome.stdout));
    }
    catch {
        return null;
    }
}
function judgeWindowsAttachObservation(observation, hostChannel) {
    if (!observation) {
        hostChannel.invalidate();
        throw new WindowsHostUnavailableError('PowerShell 5.1 / STA or process enumeration unverified');
    }
    hostChannel.observe(observation.paths, observation.fileVersions);
    if (observation.processCount !== 1)
        throw new WindowsHostUnavailableError('Illustrator process count is not one (concurrent channels are refused)');
    if (!observation.attachAvailable)
        throw new WindowsHostUnavailableError('GetActiveObject unavailable');
}
export async function probeWindowsAttach(run = windowsCommandRunner, readVersion = true, durationObserver) {
    const systemRoot = process.env.SystemRoot;
    if (!systemRoot)
        return null;
    return await measureWindowsDuration('win.attach', async () => parseWindowsAttachObservation(await run(windowsPowerShellExecutable(systemRoot), ['-NoProfile', '-NonInteractive', '-Sta', '-EncodedCommand', Buffer.from(readVersion ? WINDOWS_ATTACH_PROBE : WINDOWS_DESTINATION_PROBE, 'utf16le').toString('base64')], 15000)), durationObserver);
}
const NOT_CONTACTED = 'MCP_WINDOWS_NOT_CONTACTED';
export class WindowsComTransport {
    run;
    launchOptions;
    readStore;
    durationObserver;
    hostChannel = new WindowsHostChannelState();
    constructor(run = windowsCommandRunner, launchOptions = {}) {
        this.run = run;
        this.launchOptions = launchOptions;
        this.durationObserver = launchOptions.durationObserver;
    }
    setDurationObserver(observer) { this.durationObserver = observer; }
    bindReadStore(store) {
        if (this.readStore !== undefined && this.readStore !== store)
            throw new Error('Windows transport is already bound to a different command store.');
        this.readStore = store;
    }
    async observeHostChannel() {
        const observation = await probeWindowsAttach(this.run, true, this.durationObserver);
        if (observation === null) {
            this.hostChannel.invalidate();
            return;
        }
        this.hostChannel.observe(observation.paths, observation.fileVersions);
        this.hostChannel.noteComVersion(observation.version);
    }
    async assertHostAvailable(mode) {
        if (mode !== 'foreground')
            throw new WindowsReadOnlyError();
        await assertWindowsMutationAdmission(this.run, this.hostChannel);
    }
    resolveCallApplication(target, call) {
        return measureWindowsDuration('win.resolve', () => this.resolveApplication(target, call), this.durationObserver);
    }
    async resolveApplication(target, call) {
        const owner = await this.readStore?.readLockOwner();
        if (owner) {
            const kind = (await this.readStore?.readMetadata(owner).catch(() => undefined))?.kind ?? 'command';
            throw new IndeterminateExecutionError(`An unresolved ${kind} blocks Windows host access; reconcile it first.`, owner);
        }
        if (target.application !== WINDOWS_ILLUSTRATOR_APPLICATION)
            throw new WindowsHostUnavailableError('unsupported ProgID; use Illustrator.Application');
        if (call?.plainRead === true)
            return WINDOWS_ILLUSTRATOR_APPLICATION;
        judgeWindowsAttachObservation(await probeWindowsAttach(this.run, false, this.durationObserver), this.hostChannel);
        return WINDOWS_ILLUSTRATOR_APPLICATION;
    }
    buildRunner(_jsxPath, callApplication, _timeoutMs, mode, call) {
        if (mode !== undefined && mode !== 'foreground')
            throw new WindowsReadOnlyError();
        if (callApplication !== WINDOWS_ILLUSTRATOR_APPLICATION)
            throw new WindowsHostUnavailableError('runner destination mismatch');
        return `\uFEFF${call?.plainRead === true ? WINDOWS_READ_RUNNER_SOURCE : WINDOWS_RUNNER_SOURCE}`;
    }
    isUndeliveredFailure(message) { return message === NOT_CONTACTED; }
    async launch(files, timeoutMs, recordExecution, onGo, call) {
        const observerMatches = this.durationObserver === this.launchOptions.durationObserver;
        const options = {
            ...this.launchOptions,
            ...(observerMatches ? {} : { durationObserver: this.durationObserver }),
            ...(call?.plainRead === true ? { attachPreflight: (observation) => judgeWindowsAttachObservation(observation, this.hostChannel) } : {}),
        };
        try {
            await launchWindowsRunner(files, timeoutMs, recordExecution, onGo, options);
        }
        catch (error) {
            if (!(error instanceof HostProcessExitError))
                throw error;
            const classification = classifyWindowsRunnerTermination({ readyObserved: true, parentTimedOut: false,
                exitCode: error.exitCode, signal: error.signal, stderr: error.message });
            throw new HostProcessExitError(classification.outcome === 'not_contacted_failure' && !error.killed
                ? NOT_CONTACTED : 'MCP_WINDOWS_HOST_OUTCOME_INDETERMINATE', error.exitCode, error.signal, error.killed);
        }
    }
    async liveness(record) { return await windowsRecordLiveness(record); }
}
export const WINDOWS_MUTATION_ADAPTER_ALLOWLIST = [
    CREATE_RECTANGLE_ADAPTER_IDENTITY,
    REPLACE_POINT_TEXT_ADAPTER_IDENTITY, REPLACE_POINT_TEXT_BATCH_ADAPTER_IDENTITY, REPLACE_TEXT_RANGE_ADAPTER_IDENTITY,
    REPLACE_AREA_TEXT_RANGE_ADAPTER_IDENTITY, SET_TEXT_STYLE_ADAPTER_IDENTITY, CREATE_POINT_TEXT_ADAPTER_IDENTITY, CREATE_AREA_TEXT_ADAPTER_IDENTITY,
    WINDOWS_STROKE_ADAPTER_IDENTITY,
    TRANSFORM_OBJECT_ADAPTER_IDENTITY, ALIGN_OBJECTS_ADAPTER_IDENTITY, SET_OBJECT_STATE_ADAPTER_IDENTITY, SET_STACKING_ORDER_ADAPTER_IDENTITY,
    DUPLICATE_OBJECT_ADAPTER_IDENTITY, GROUP_OBJECTS_ADAPTER_IDENTITY, CREATE_LAYER_ADAPTER_IDENTITY, SET_LAYER_STATE_ADAPTER_IDENTITY,
    WINDOWS_DUPLICATE_ADAPTER_IDENTITY,
    MOVE_OBJECT_TO_LAYER_ADAPTER_IDENTITY, SET_PATH_APPEARANCE_ADAPTER_IDENTITY, CREATE_SHAPE_ADAPTER_IDENTITY,
    WINDOWS_PLACE_IMAGE_ADAPTER_IDENTITY, WINDOWS_RELINK_IMAGE_ADAPTER_IDENTITY,
];
export const WINDOWS_NON_ADAPTER_HOST_COMMAND_ALLOWLIST = [
    'create_document', 'close_document', 'open_document',
    'backup_open_restore_test', 'backup_close_restore_test',
    'save_document',
];
export class WindowsBridge extends DurableCommandBridge {
    mutationAllowlist;
    hostCommandAllowlist;
    adapterRegistry;
    hostTransport;
    commandStore;
    constructor(application, store, registry, transport, options = {}) {
        if (!(transport instanceof WindowsComTransport))
            throw new Error('Windows bridge requires WindowsComTransport.');
        transport.bindReadStore(store);
        super(application, store, registry, transport, options);
        this.adapterRegistry = registry;
        this.hostTransport = transport;
        this.commandStore = store;
        this.mutationAllowlist = new Set((options.mutationAllowlist ?? []).filter((identity) => WINDOWS_MUTATION_ADAPTER_ALLOWLIST.includes(identity)));
        this.hostCommandAllowlist = new Set((options.hostCommandAllowlist ?? []).filter((id) => WINDOWS_NON_ADAPTER_HOST_COMMAND_ALLOWLIST.includes(id)));
    }
    async execute(command) {
        if (command.kind !== 'read') {
            if (command.idempotency?.operation === undefined)
                throw new WindowsReadOnlyError();
            const adapter = this.adapterRegistry.resolveIdentity(command.idempotency.operation, command.mutationValidator, command.adapterIdentity);
            if (!this.mutationAllowlist.has(adapter.adapterIdentity))
                throw new WindowsReadOnlyError();
            await this.hostTransport.assertHostAvailable('foreground');
            if (command.params?.hostVersionChannel === 'stable' && this.currentChannel() !== 'stable') {
                throw new WindowsMutationAdmissionError('host_state_unknown', 'The Illustrator build changed after its stable channel was classified.');
            }
        }
        else if (command.hostCommand !== undefined) {
            if (!this.hostCommandAllowlist.has(command.hostCommand))
                throw new WindowsReadOnlyError();
            await this.hostTransport.assertHostAvailable('foreground');
        }
        return await super.execute(command.kind !== 'read' ? command : { ...command, hostCall: {
                plainRead: command.hostCommand === undefined && (command.hostGate?.beforeHost === undefined || command.preHostRefusalSafe === true)
            } });
    }
    hostPreferencesMeasured() { return false; }
    applicationTarget() {
        return { ...super.applicationTarget(), channel: this.currentChannel() };
    }
    async resolveHostChannel(commandId) {
        if ((await this.commandStore.inspectCompactIdempotency(commandId)).state !== 'missing')
            return this.currentChannel();
        if (this.currentChannel() !== 'stable')
            await this.hostTransport.observeHostChannel();
        return this.currentChannel();
    }
    noteHostVersion(appVersion) { this.hostTransport.hostChannel.noteComVersion(appVersion); }
    currentChannel() { return this.hostTransport.hostChannel.channel(); }
    releaseUnverifiedOffered() { return this.mutationAllowlist.size > 0; }
    async reconcile(options = {}) {
        if (options.quarantine || (options.releaseUnverified && this.mutationAllowlist.size === 0))
            throw new WindowsReadOnlyError();
        return await super.reconcile(options);
    }
}
