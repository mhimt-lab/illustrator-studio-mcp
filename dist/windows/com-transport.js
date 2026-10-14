import { DurableCommandBridge } from '../durable-command-bridge.js';
import { IndeterminateExecutionError } from '../domain.js';
import { HostProcessExitError } from '../host-transport.js';
import { classifyWindowsRunnerTermination } from './failure-classification.js';
import { windowsRecordLiveness } from './liveness.js';
import { WINDOWS_RUNNER_SOURCE, windowsCommandRunner, windowsPowerShellExecutable } from './powershell-runner.js';
import { assertWindowsMutationAdmission } from './mutation-admission.js';
import { CREATE_RECTANGLE_ADAPTER_IDENTITY } from '../adapters/create-rectangle-adapter.js';
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
  processCount = $processes.Count; paths = $paths; attachAvailable = $available; version = $version } | ConvertTo-Json -Compress
`;
const WINDOWS_DESTINATION_PROBE = WINDOWS_ATTACH_PROBE.replace('$version = [string]$application.Version\n    $available = $version.Length -gt 0', '$available = $null -ne $application');
export function parseWindowsAttachObservation(outcome) {
    if (outcome.kind !== 'exit' || outcome.code !== 0 || outcome.signal !== null)
        return null;
    try {
        const value = JSON.parse(outcome.stdout);
        if (!value || !/^5\.1\./u.test(value.powerShellVersion) || value.apartmentState !== 'STA' ||
            !Number.isSafeInteger(value.processCount) || value.processCount < 0 || !Array.isArray(value.paths) ||
            value.paths.length !== value.processCount ||
            value.paths.some((path) => typeof path !== 'string' || !/^[A-Za-z]:\\.*\\Illustrator\.exe$/iu.test(path)) ||
            typeof value.attachAvailable !== 'boolean' || (value.version !== null && typeof value.version !== 'string') ||
            (value.attachAvailable && value.processCount !== 1))
            return null;
        return value;
    }
    catch {
        return null;
    }
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
    async assertHostAvailable(mode) {
        if (mode !== 'foreground')
            throw new WindowsReadOnlyError();
        await assertWindowsMutationAdmission(this.run);
    }
    resolveCallApplication(target) {
        return measureWindowsDuration('win.resolve', () => this.resolveApplication(target), this.durationObserver);
    }
    async resolveApplication(target) {
        const owner = await this.readStore?.readLockOwner();
        if (owner) {
            const kind = (await this.readStore?.readMetadata(owner).catch(() => undefined))?.kind ?? 'command';
            throw new IndeterminateExecutionError(`An unresolved ${kind} blocks Windows host access; reconcile it first.`, owner);
        }
        if (target.application !== WINDOWS_ILLUSTRATOR_APPLICATION)
            throw new WindowsHostUnavailableError('unsupported ProgID; use Illustrator.Application');
        const observation = await probeWindowsAttach(this.run, false, this.durationObserver);
        if (!observation)
            throw new WindowsHostUnavailableError('PowerShell 5.1 / STA or process enumeration unverified');
        if (observation.processCount !== 1)
            throw new WindowsHostUnavailableError('Illustrator process count is not one (concurrent channels are refused)');
        if (!observation.attachAvailable)
            throw new WindowsHostUnavailableError('GetActiveObject unavailable');
        return WINDOWS_ILLUSTRATOR_APPLICATION;
    }
    buildRunner(_jsxPath, callApplication, _timeoutMs, mode) {
        if (mode !== undefined && mode !== 'foreground')
            throw new WindowsReadOnlyError();
        if (callApplication !== WINDOWS_ILLUSTRATOR_APPLICATION)
            throw new WindowsHostUnavailableError('runner destination mismatch');
        return `\uFEFF${WINDOWS_RUNNER_SOURCE}`;
    }
    isUndeliveredFailure(message) { return message === NOT_CONTACTED; }
    async launch(files, timeoutMs, recordExecution, onGo) {
        try {
            await launchWindowsRunner(files, timeoutMs, recordExecution, onGo, this.durationObserver === this.launchOptions.durationObserver ? this.launchOptions : { ...this.launchOptions, durationObserver: this.durationObserver });
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
export const WINDOWS_MUTATION_ADAPTER_ALLOWLIST = [CREATE_RECTANGLE_ADAPTER_IDENTITY];
export class WindowsBridge extends DurableCommandBridge {
    mutationAllowlist;
    adapterRegistry;
    hostTransport;
    constructor(application, store, registry, transport, options = {}) {
        if (!(transport instanceof WindowsComTransport))
            throw new Error('Windows bridge requires WindowsComTransport.');
        transport.bindReadStore(store);
        super(application, store, registry, transport, options);
        this.adapterRegistry = registry;
        this.hostTransport = transport;
        this.mutationAllowlist = new Set((options.mutationAllowlist ?? []).filter((identity) => WINDOWS_MUTATION_ADAPTER_ALLOWLIST.includes(identity)));
    }
    async execute(command) {
        if (command.kind !== 'read') {
            if (command.idempotency?.operation === undefined)
                throw new WindowsReadOnlyError();
            const adapter = this.adapterRegistry.resolveIdentity(command.idempotency.operation, command.mutationValidator, command.adapterIdentity);
            if (!this.mutationAllowlist.has(adapter.adapterIdentity))
                throw new WindowsReadOnlyError();
            await this.hostTransport.assertHostAvailable('foreground');
        }
        return await super.execute(command);
    }
    releaseUnverifiedOffered() { return this.mutationAllowlist.size > 0; }
    async reconcile(options = {}) {
        if (options.quarantine || (options.releaseUnverified && this.mutationAllowlist.size === 0))
            throw new WindowsReadOnlyError();
        return await super.reconcile(options);
    }
}
