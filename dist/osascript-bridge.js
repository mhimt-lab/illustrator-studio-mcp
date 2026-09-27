import { spawn } from 'node:child_process';
import { FileCommandStore } from './command-store.js';
import { DurableCommandBridge } from './durable-command-bridge.js';
import { resolveIllustratorApplication } from './illustrator-application.js';
import { OsascriptTransport, defaultHostApplicationAvailabilityProbe, defaultIllustratorApplicationProbes, launchControllerKind, } from './osascript-transport.js';
export { DEFAULT_CALL_QUEUE_WAIT_LIMIT_MS, IllustratorBusyError, parseHostResultEnvelope, } from './durable-command-bridge.js';
export { OSASCRIPT_LAUNCH_CONTROLLER_SOURCE, OSASCRIPT_SH_LAUNCHER_SOURCE, OsascriptProcessExitError, isUndeliveredHostFailure, launchControllerKind, macSessionLockState, } from './osascript-transport.js';
export class OsascriptBridge extends DurableCommandBridge {
    constructor(application = resolveIllustratorApplication({ env: process.env.ILLUSTRATOR_APPLICATION }).application, store = new FileCommandStore(), processRunner = (command, args, options) => spawn(command, args, options), registry = store.getAdapterRegistry(), hostApplicationAvailabilityProbe = defaultHostApplicationAvailabilityProbe, applicationProbes = defaultIllustratorApplicationProbes, options = {}) {
        super(application, store, registry, new OsascriptTransport(processRunner, hostApplicationAvailabilityProbe, applicationProbes, options.launchController ?? launchControllerKind(), options.shProcessRunner ?? ((command, args, spawnOptions) => spawn(command, args, spawnOptions))), options);
    }
}
