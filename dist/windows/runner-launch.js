import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { IndeterminateExecutionError } from '../domain.js';
import { isFileTime } from '../execution-record.js';
import { HostProcessExitError } from '../host-transport.js';
import { windowsPowerShellEnvironment, windowsRunnerInvocation } from './powershell-runner.js';
import { createWindowsDurationProbe } from './perf-probe.js';
import { parseWindowsAttachLine, WINDOWS_ATTACH_LINE_MAX_CHARS } from './attach-line.js';
class AttachRefusal extends Error {
    refusal;
    constructor(refusal) {
        super('Windows runner attach preflight refused.');
        this.refusal = refusal;
    }
}
export class WindowsRunnerPreGoError extends Error {
    constructor(cause) {
        super(`Windows runner stopped before go: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
        this.name = 'WindowsRunnerPreGoError';
    }
}
export function parseWindowsReadyLine(line, nonce, childPid) {
    const match = /^ready ([0-9a-f-]{36}) ([1-9][0-9]*) ([1-9][0-9]*)\n$/u.exec(line);
    if (!match || match[1] !== nonce || childPid === undefined || !Number.isSafeInteger(Number(match[2])) ||
        Number(match[2]) !== childPid || !isFileTime(match[3]))
        return null;
    return { pid: childPid, creationTime: match[3], nonce };
}
export async function launchWindowsRunner(files, timeoutMs, recordExecution, onGo = () => undefined, options = {}) {
    const readyTimeoutMs = options.readyTimeoutMs ?? 10000;
    const exitGraceMs = options.exitGraceMs ?? 1000;
    if (![timeoutMs, readyTimeoutMs, exitGraceMs].every((value) => Number.isSafeInteger(value) && value > 0)) {
        throw new Error('Windows runner timeouts must be positive safe integers.');
    }
    const systemRoot = options.systemRoot ?? process.env.SystemRoot;
    if (!systemRoot)
        throw new Error('SystemRoot is required to start the Windows runner.');
    const nonce = options.nonce ?? randomUUID();
    const invocation = windowsRunnerInvocation({ systemRoot, runnerPath: files.runnerPath, jsxPath: files.scriptPath, nonce });
    const timing = createWindowsDurationProbe(options.durationObserver);
    const finishReady = timing.start('win.runner.spawn_to_ready');
    let child;
    try {
        child = (options.spawnRunner ?? spawn)(invocation.command, invocation.args, {
            stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: windowsPowerShellEnvironment(process.env),
        });
    }
    catch (error) {
        timing.flush();
        throw error;
    }
    let finishGo;
    let finishExit;
    let crossedGo = false;
    let stderr = '';
    let processError;
    let exited = false;
    let received = '';
    let rejectReady = () => undefined;
    const closed = new Promise((resolve) => {
        child.once('close', (code, signal) => {
            finishExit?.();
            rejectReady(processError ?? new Error('Windows runner ended before ready.'));
            resolve({ code, signal });
        });
    });
    child.once('exit', () => { exited = true; });
    child.on('error', (error) => { processError = error; rejectReady(error); });
    child.stderr?.on('data', (chunk) => { stderr = (stderr + chunk.toString('utf8')).slice(0, 65536); });
    child.stdin?.on('error', (error) => { processError = error; if (!crossedGo)
        rejectReady(error); });
    let readyTimer;
    let hostTimer;
    const stopBeforeGo = async () => {
        child.stdin?.end();
        let graceTimer;
        try {
            const stopped = await Promise.race([
                closed.then(() => true),
                new Promise((resolve) => { graceTimer = setTimeout(() => resolve(false), exitGraceMs); }),
            ]);
            if (!stopped)
                child.kill();
            await closed;
        }
        finally {
            if (graceTimer !== undefined)
                clearTimeout(graceTimer);
        }
    };
    try {
        const identity = await new Promise((resolve, reject) => {
            rejectReady = reject;
            if (!child.stdin || !child.stdout || child.pid === undefined) {
                reject(new Error('Windows runner could not start with private pipes.'));
                return;
            }
            const startsLike = (text, word) => text.startsWith(word.slice(0, Math.min(text.length, word.length)));
            let awaitingAttach = options.attachPreflight !== undefined;
            const refuseAttach = (observation) => {
                try {
                    options.attachPreflight(observation);
                    return false;
                }
                catch (error) {
                    reject(new AttachRefusal(error));
                    return true;
                }
            };
            const receive = (chunk) => {
                received += chunk.toString('utf8');
                if (awaitingAttach) {
                    if (received.startsWith('ready ')) {
                        awaitingAttach = false;
                        if (refuseAttach(null))
                            return;
                    }
                    else if (!startsLike(received, 'attach ') && !startsLike(received, 'ready ')) {
                        reject(new Error('Invalid Windows runner ready line.'));
                        return;
                    }
                    else if (received.includes('\n')) {
                        const end = received.indexOf('\n') + 1;
                        const observation = parseWindowsAttachLine(received.slice(0, end), nonce);
                        received = received.slice(end);
                        awaitingAttach = false;
                        if (refuseAttach(observation))
                            return;
                    }
                    else if (received.length > WINDOWS_ATTACH_LINE_MAX_CHARS) {
                        refuseAttach(null);
                        return;
                    }
                    else {
                        return;
                    }
                }
                if (received.length > 512 || !received.startsWith('ready '.slice(0, Math.min(received.length, 6)))) {
                    reject(new Error('Invalid Windows runner ready line.'));
                }
                else if (received.includes('\n')) {
                    const parsed = parseWindowsReadyLine(received, nonce, child.pid);
                    child.stdout?.removeListener('data', receive);
                    if (parsed === null)
                        reject(new Error('Invalid Windows runner ready identity.'));
                    else {
                        finishReady();
                        finishGo = timing.start('win.runner.ready_to_go');
                        resolve(parsed);
                    }
                }
            };
            child.stdout.on('data', receive);
            child.stdout.once('end', () => reject(new Error('EOF before Windows runner ready.')));
            child.stdout.once('error', reject);
            readyTimer = setTimeout(() => reject(new Error(`Windows runner ready exceeded ${readyTimeoutMs} ms.`)), readyTimeoutMs);
        });
        if (readyTimer !== undefined)
            clearTimeout(readyTimer);
        await recordExecution(identity);
        if (processError !== undefined)
            throw processError;
        if (exited)
            throw new Error('Windows runner exited before go.');
        crossedGo = true;
        finishGo?.();
        finishExit = timing.start('win.runner.go_to_exit');
        onGo();
        const timeout = new Promise((_resolve, reject) => {
            hostTimer = setTimeout(() => reject(Object.assign(new Error(`Windows host call exceeded ${timeoutMs} ms.`), { code: 'ETIMEDOUT' })), timeoutMs);
        });
        await Promise.race([
            new Promise((resolve, reject) => child.stdin.write(`go ${nonce}\n`, (error) => error ? reject(error) : resolve())),
            timeout,
        ]).catch((error) => {
            throw new IndeterminateExecutionError('The Windows go boundary could not be confirmed.', files.commandId, typeof error === 'object' && error !== null && 'code' in error && error.code === 'ETIMEDOUT' ? { code: 'ETIMEDOUT' } : {});
        });
        const outcome = await Promise.race([closed, timeout]);
        if (outcome.code !== 0 || outcome.signal !== null || child.killed) {
            throw new HostProcessExitError(stderr.trim() || 'Windows runner terminated after go.', outcome.code, outcome.signal, child.killed);
        }
    }
    catch (error) {
        if (crossedGo)
            throw error;
        await stopBeforeGo();
        if (error instanceof AttachRefusal)
            throw error.refusal;
        throw new WindowsRunnerPreGoError(error);
    }
    finally {
        if (readyTimer !== undefined)
            clearTimeout(readyTimer);
        if (hostTimer !== undefined)
            clearTimeout(hostTimer);
        timing.flush();
    }
}
