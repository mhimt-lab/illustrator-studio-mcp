import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { defaultCommandRunner } from './command-runner.js';
import { IndeterminateExecutionError } from './domain.js';
import { HostProcessExitError, } from './host-transport.js';
import { appleScriptApplicationReference, detectRunningIllustratorBundles, resolveIllustratorApplicationForCall, resolveIllustratorNameToBundleId, } from './illustrator-application.js';
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
export const defaultHostApplicationAvailabilityProbe = async () => {
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
export class OsascriptProcessExitError extends HostProcessExitError {
    constructor(message, exitCode, signal, killed) {
        super(message, exitCode, signal, killed);
        this.name = 'OsascriptProcessExitError';
    }
}
function throwOnLauncherExit(outcome, child, stderr) {
    if (outcome.error)
        throw outcome.error;
    if (outcome.signal !== null || child.killed) {
        throw new OsascriptProcessExitError(stderr.trim() || `osascript controller terminated with status ${String(outcome.code)}, signal ${outcome.signal ?? 'none'}, killed ${String(child.killed)}.`, outcome.code, outcome.signal, child.killed);
    }
    if (outcome.code !== 0) {
        throw new OsascriptProcessExitError(stderr.trim() || `osascript exited with status ${String(outcome.code)}.`, outcome.code, null, false);
    }
}
const UNDELIVERED_APPLE_EVENT_ERRORS = Object.freeze([-600, -1743]);
export function isUndeliveredHostFailure(message) {
    const text = message.trim();
    if (text.length === 0 || /[\r\n]/u.test(text))
        return false;
    const match = /execution error: .*\((-?\d+)\)$/u.exec(text);
    return match !== null && UNDELIVERED_APPLE_EVENT_ERRORS.includes(Number(match[1]));
}
export const defaultIllustratorApplicationProbes = {
    running: () => detectRunningIllustratorBundles(defaultCommandRunner),
    resolveName: (name) => resolveIllustratorNameToBundleId(defaultCommandRunner, name),
};
export class OsascriptTransport {
    processRunner;
    hostApplicationAvailabilityProbe;
    applicationProbes;
    launchController;
    shProcessRunner;
    constructor(processRunner, hostApplicationAvailabilityProbe, applicationProbes, launchController, shProcessRunner) {
        this.processRunner = processRunner;
        this.hostApplicationAvailabilityProbe = hostApplicationAvailabilityProbe;
        this.applicationProbes = applicationProbes;
        this.launchController = launchController;
        this.shProcessRunner = shProcessRunner;
    }
    async assertHostAvailable(mode) {
        await this.hostApplicationAvailabilityProbe(mode);
    }
    async resolveCallApplication(target) {
        return (await resolveIllustratorApplicationForCall(target, this.applicationProbes)).application;
    }
    isUndeliveredFailure(message) {
        return isUndeliveredHostFailure(message);
    }
    buildRunner(jsxPath, callApplication, timeoutMs, mode) {
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
        const appleEventSeconds = Math.ceil(timeoutMs / 1000) + 30;
        return `${foregroundGuard}tell ${applicationReference}\n${activation}  with timeout of ${appleEventSeconds} seconds\n` +
            `    do javascript of file "${escapedPath}"\n  end timeout\nend tell\n`;
    }
    async launch(files, timeoutMs, recordExecution, onGo = () => undefined) {
        if (this.launchController === 'sh')
            await this.runShLauncher(files, timeoutMs, recordExecution, onGo);
        else
            await this.runNodeLauncher(files, timeoutMs, recordExecution, onGo);
    }
    async runNodeLauncher(files, timeoutMs, recordExecution, onGo) {
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
        void ready.catch(() => undefined);
        try {
            await recordExecution({ pid: child.pid, processGroupId: child.pid, nonce });
        }
        catch (error) {
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
            onGo();
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
    async runShLauncher(files, timeoutMs, recordExecution, onGo) {
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
        void ready.catch(() => undefined);
        try {
            await recordExecution({ pid: child.pid, processGroupId: child.pid, nonce });
        }
        catch (error) {
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
            onGo();
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
    liveness(processGroupId) {
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
}
