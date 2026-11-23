import { spawn } from 'node:child_process';
import { OBSERVATION_HELPER_SCRIPT, OBSERVATION_PROTOCOL_VERSION } from './observation-helper-script.js';
import { windowsPowerShellEnvironment, windowsPowerShellExecutable } from './powershell-runner.js';
export const OBSERVATION_CALL_TIMEOUT_MS = 5_000;
export const OBSERVATION_READY_TIMEOUT_MS = 20_000;
export const OBSERVATION_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const OBSERVATION_IDLE_SHUTDOWN_MS = 10 * 60 * 1000;
export const OBSERVATION_CIRCUIT_FAILURES = 3;
export const OBSERVATION_CIRCUIT_OPEN_MS = 30_000;
const KILL_GRACE_MS = 3_000;
const DETAIL_LIMIT = 200;
export class ObservationHelperError extends Error {
    code;
    detail;
    constructor(code, detail) {
        super(`${code}: ${detail}`);
        this.code = code;
        this.detail = detail;
        this.name = 'ObservationHelperError';
    }
}
const defaultSpawn = (command, args, options) => spawn(command, [...args], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: options.env });
export function observationHelperArguments(text) {
    return ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(text, 'utf16le').toString('base64')];
}
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isInteger = (value) => typeof value === 'number' && Number.isInteger(value);
const decimal = /^\d{1,20}$/u;
const errorToken = /^(?:win32_\d{1,10}|owner_unreadable|read_failed)$/u;
const invalid = (detail) => new ObservationHelperError('helper_output_invalid', detail);
function parseAce(value, where) {
    if (!isRecord(value) || typeof value.type !== 'string' || !(value.sid === null || typeof value.sid === 'string')
        || !isInteger(value.mask) || !isInteger(value.flags))
        throw invalid(`${where}: malformed ACE`);
    return { type: value.type, sid: value.sid, mask: value.mask, flags: value.flags };
}
function parseObject(value, index) {
    const where = `object ${index}`;
    if (!isRecord(value))
        throw invalid(`${where}: not an object`);
    const { attrs, vol, index: fileIndex, owner, daclNull, aces, error } = value;
    if (!(attrs === null || (isInteger(attrs) && attrs >= 0)))
        throw invalid(`${where}: attrs`);
    if (!(vol === null || (typeof vol === 'string' && decimal.test(vol))))
        throw invalid(`${where}: vol`);
    if (!(fileIndex === null || (typeof fileIndex === 'string' && decimal.test(fileIndex))))
        throw invalid(`${where}: index`);
    if (!(owner === null || typeof owner === 'string'))
        throw invalid(`${where}: owner`);
    if (!(daclNull === null || typeof daclNull === 'boolean'))
        throw invalid(`${where}: daclNull`);
    if (!Array.isArray(aces))
        throw invalid(`${where}: aces`);
    if (!(error === null || (typeof error === 'string' && errorToken.test(error))))
        throw invalid(`${where}: error token`);
    const parsed = { attrs, vol, index: fileIndex, owner, daclNull, aces: aces.map((ace) => parseAce(ace, where)), error };
    if (error === null && (attrs === null || vol === null || fileIndex === null || owner === null || daclNull === null))
        throw invalid(`${where}: incomplete without an error`);
    if (daclNull === true && parsed.aces.length > 0)
        throw invalid(`${where}: null DACL with ACEs`);
    return parsed;
}
export function parseObservation(line, requestId, pathCount) {
    let value;
    try {
        value = JSON.parse(line);
    }
    catch {
        throw invalid('the answer is not JSON');
    }
    if (!isRecord(value))
        throw invalid('the answer is not an object');
    if (value.id !== requestId)
        throw invalid('the answer id does not match the request');
    if (value.end !== true)
        throw new ObservationHelperError('helper_output_truncated', 'the answer has no end mark');
    if (typeof value.userSid !== 'string' || !isRecord(value.drive) || !Array.isArray(value.objects))
        throw invalid('the answer has no userSid, drive or objects');
    if (value.objects.length !== pathCount || value.count !== pathCount)
        throw invalid('the object count does not match the request');
    const objects = value.objects.map(parseObject);
    const aceCount = objects.reduce((sum, object) => sum + object.aces.length, 0);
    if (value.aceCount !== aceCount)
        throw new ObservationHelperError('helper_output_truncated', 'the ACE count does not match');
    const drive = value.drive;
    for (const key of ['type', 'format', 'error'])
        if (key in drive && typeof drive[key] !== 'string')
            throw invalid(`drive.${key}`);
    return { id: requestId, userSid: value.userSid, drive: drive, objects, count: pathCount, aceCount, end: true };
}
function validateRequest(paths) {
    if (!Array.isArray(paths) || paths.length === 0)
        throw new TypeError('observe() needs at least one path.');
    for (const path of paths) {
        if (typeof path !== 'string' || path.length === 0 || /[\u0000-\u001f\u007f]/u.test(path))
            throw new TypeError('observe() paths must be non-empty strings without control characters.');
    }
}
const brief = (text) => text.replace(/\s+/gu, ' ').trim().slice(0, DETAIL_LIMIT);
export class ResidentObservationHelper {
    #systemRoot;
    #helperText;
    #env;
    #spawn;
    #callTimeoutMs;
    #readyTimeoutMs;
    #maxResponseBytes;
    #idleShutdownMs;
    #circuitFailures;
    #circuitOpenMs;
    #clock;
    #current = null;
    #queue = Promise.resolve();
    #queued = 0;
    #nextId = 1;
    #idleTimer = null;
    #consecutiveStartFailures = 0;
    #circuitOpenUntil = 0;
    #closed = false;
    constructor(options = {}) {
        this.#systemRoot = 'systemRoot' in options ? options.systemRoot : process.env.SystemRoot;
        this.#helperText = options.script ?? OBSERVATION_HELPER_SCRIPT;
        this.#env = windowsPowerShellEnvironment(options.env ?? process.env);
        this.#spawn = options.spawnProcess ?? defaultSpawn;
        this.#callTimeoutMs = options.callTimeoutMs ?? OBSERVATION_CALL_TIMEOUT_MS;
        this.#readyTimeoutMs = options.readyTimeoutMs ?? OBSERVATION_READY_TIMEOUT_MS;
        this.#maxResponseBytes = options.maxResponseBytes ?? OBSERVATION_MAX_RESPONSE_BYTES;
        this.#idleShutdownMs = options.idleShutdownMs ?? OBSERVATION_IDLE_SHUTDOWN_MS;
        this.#circuitFailures = options.circuitFailures ?? OBSERVATION_CIRCUIT_FAILURES;
        this.#circuitOpenMs = options.circuitOpenMs ?? OBSERVATION_CIRCUIT_OPEN_MS;
        this.#clock = options.clock ?? Date.now;
    }
    get childPid() {
        return this.#current?.child.pid ?? null;
    }
    warmUp() {
        if (this.#closed || this.#circuitIsOpen())
            return;
        this.#clearIdle();
        this.#ensureSession().then(() => this.#armIdle(), () => undefined);
    }
    async observe(paths) {
        validateRequest(paths);
        const request = [...paths];
        this.#clearIdle();
        this.#queued += 1;
        const run = async () => {
            try {
                const session = await this.#ensureSession();
                return await this.#send(session, request);
            }
            finally {
                this.#queued -= 1;
                this.#armIdle();
            }
        };
        const result = this.#queue.then(run, run);
        this.#queue = result.then(() => undefined, () => undefined);
        return await result;
    }
    async close() {
        this.#closed = true;
        this.#clearIdle();
        const session = this.#current;
        if (session === null)
            return;
        if (session.state === 'starting' || session.inflight !== null) {
            this.#fail(session, 'helper_exited', 'the helper was closed');
            return;
        }
        this.#current = null;
        await this.#shutDown(session, true);
    }
    #circuitIsOpen() {
        return this.#consecutiveStartFailures >= this.#circuitFailures && this.#clock() < this.#circuitOpenUntil;
    }
    async #ensureSession() {
        if (this.#closed)
            throw new ObservationHelperError('helper_unavailable', 'the observation helper is closed');
        if (this.#current === null) {
            if (this.#circuitIsOpen()) {
                throw new ObservationHelperError('helper_unavailable', `the helper failed to start ${this.#consecutiveStartFailures} times in a row; no new start before the circuit closes`);
            }
            this.#current = this.#startSession();
        }
        const session = this.#current;
        await session.ready;
        return session;
    }
    #startSession() {
        if (!this.#systemRoot) {
            this.#noteStartFailure();
            throw new ObservationHelperError('helper_start_failed', 'SystemRoot is not set');
        }
        let child;
        try {
            child = this.#spawn(windowsPowerShellExecutable(this.#systemRoot), observationHelperArguments(this.#helperText), { env: this.#env });
        }
        catch (error) {
            this.#noteStartFailure();
            throw new ObservationHelperError('helper_start_failed', brief(error instanceof Error ? error.message : String(error)));
        }
        let resolveReady = () => undefined;
        let rejectReady = (_error) => undefined;
        const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
        ready.catch(() => undefined);
        let resolveExited = () => undefined;
        const exited = new Promise((resolve) => { resolveExited = resolve; });
        const session = {
            child, state: 'starting', chunks: [], buffered: 0, stderr: '', inflight: null, readyTimer: null, killTimer: null,
            ready, resolveReady, rejectReady, processExitHook: () => { child.kill(); }, exited, resolveExited,
        };
        session.readyTimer = setTimeout(() => this.#fail(session, 'helper_timeout', `no ready line within ${this.#readyTimeoutMs} ms`), this.#readyTimeoutMs);
        process.on('exit', session.processExitHook);
        child.unref();
        for (const stream of [child.stdin, child.stdout, child.stderr])
            stream.unref?.();
        child.stdout.on('data', (chunk) => this.#onStdout(session, chunk));
        child.stdout.on('error', (error) => this.#fail(session, 'helper_exited', `stdout: ${brief(error.message)}`));
        child.stderr.on('data', (chunk) => { if (session.state !== 'dead')
            session.stderr = (session.stderr + chunk.toString('utf8')).slice(0, 4096); });
        child.stderr.on('error', () => undefined);
        child.stdin.on('error', (error) => this.#fail(session, 'helper_exited', `stdin: ${brief(error.message)}`));
        child.on('error', (error) => this.#fail(session, 'helper_exited', brief(error.message)));
        child.on('exit', (code, signal) => this.#onExit(session, code, signal));
        return session;
    }
    #onStdout(session, chunk) {
        if (session.state === 'dead' || session.state === 'closing')
            return;
        const newline = chunk.indexOf(0x0a);
        if (newline < 0) {
            session.chunks.push(chunk);
            session.buffered += chunk.length;
            if (session.buffered > this.#maxResponseBytes)
                this.#fail(session, 'helper_output_too_large', `more than ${this.#maxResponseBytes} bytes without a line end`);
            return;
        }
        if (session.buffered + newline > this.#maxResponseBytes) {
            this.#fail(session, 'helper_output_too_large', `a line of more than ${this.#maxResponseBytes} bytes`);
            return;
        }
        if (newline !== chunk.length - 1) {
            this.#fail(session, 'helper_output_invalid', 'output after the end of a line');
            return;
        }
        const line = Buffer.concat([...session.chunks, chunk.subarray(0, newline)]).toString('utf8');
        session.chunks = [];
        session.buffered = 0;
        this.#onLine(session, line);
    }
    #onLine(session, line) {
        if (session.state === 'starting') {
            let ready;
            try {
                ready = JSON.parse(line);
            }
            catch {
                this.#fail(session, 'helper_output_invalid', 'the ready line is not JSON');
                return;
            }
            if (!isRecord(ready) || ready.ready !== true || ready.v !== OBSERVATION_PROTOCOL_VERSION || !isInteger(ready.pid)) {
                this.#fail(session, 'helper_output_invalid', `the ready line is not protocol v${OBSERVATION_PROTOCOL_VERSION}`);
                return;
            }
            if (session.readyTimer !== null)
                clearTimeout(session.readyTimer);
            session.readyTimer = null;
            session.state = 'ready';
            if (this.#current === session)
                this.#consecutiveStartFailures = 0;
            session.resolveReady();
            return;
        }
        const inflight = session.inflight;
        if (inflight === null) {
            this.#fail(session, 'helper_output_invalid', 'output without a request');
            return;
        }
        let observation;
        try {
            observation = parseObservation(line, inflight.id, inflight.count);
        }
        catch (error) {
            if (error instanceof ObservationHelperError)
                this.#fail(session, error.code, error.detail);
            else
                throw error;
            return;
        }
        clearTimeout(inflight.timer);
        session.inflight = null;
        inflight.resolve(observation);
    }
    #onExit(session, code, signal) {
        if (session.state === 'closing') {
            this.#finish(session);
            return;
        }
        this.#fail(session, 'helper_exited', `the helper exited (code ${code ?? 'none'}, signal ${signal ?? 'none'})${session.stderr ? `: ${brief(session.stderr)}` : ''}`);
    }
    #send(session, paths) {
        return new Promise((resolve, reject) => {
            if (session.state !== 'ready' || session.inflight !== null) {
                reject(new ObservationHelperError('helper_exited', 'the helper is not ready for a request'));
                return;
            }
            const id = this.#nextId;
            this.#nextId += 1;
            const timer = setTimeout(() => this.#fail(session, 'helper_timeout', `no answer within ${this.#callTimeoutMs} ms`), this.#callTimeoutMs);
            session.inflight = { id, count: paths.length, timer, resolve, reject };
            session.child.stdin.write(`${id}\t${paths.join('\t')}\n`, 'utf8', (error) => {
                if (error)
                    this.#fail(session, 'helper_exited', `stdin: ${brief(error.message)}`);
            });
        });
    }
    #fail(session, code, detail) {
        if (session.state === 'dead')
            return;
        const wasStarting = session.state === 'starting';
        this.#finish(session);
        session.child.kill();
        const error = new ObservationHelperError(wasStarting ? 'helper_start_failed' : code, wasStarting ? `${code}: ${detail}` : detail);
        if (this.#current === session) {
            this.#current = null;
            if (wasStarting && !this.#closed)
                this.#noteStartFailure();
        }
        if (wasStarting)
            session.rejectReady(error);
        const inflight = session.inflight;
        session.inflight = null;
        if (inflight !== null) {
            clearTimeout(inflight.timer);
            inflight.reject(error);
        }
    }
    #finish(session) {
        session.state = 'dead';
        if (session.readyTimer !== null)
            clearTimeout(session.readyTimer);
        if (session.killTimer !== null)
            clearTimeout(session.killTimer);
        session.readyTimer = null;
        session.killTimer = null;
        process.off('exit', session.processExitHook);
        session.resolveExited();
    }
    #noteStartFailure() {
        this.#consecutiveStartFailures += 1;
        if (this.#consecutiveStartFailures >= this.#circuitFailures)
            this.#circuitOpenUntil = this.#clock() + this.#circuitOpenMs;
    }
    #shutDown(session, awaited = false) {
        if (session.state === 'dead')
            return Promise.resolve();
        session.state = 'closing';
        session.killTimer = setTimeout(() => { session.child.kill(); }, KILL_GRACE_MS);
        if (!awaited)
            session.killTimer.unref();
        session.child.stdin.end();
        return session.exited;
    }
    #clearIdle() {
        if (this.#idleTimer !== null)
            clearTimeout(this.#idleTimer);
        this.#idleTimer = null;
    }
    #armIdle() {
        this.#clearIdle();
        if (this.#queued > 0 || this.#current === null || this.#closed)
            return;
        this.#idleTimer = setTimeout(() => {
            this.#idleTimer = null;
            const session = this.#current;
            if (session === null || this.#queued > 0 || session.state !== 'ready' || session.inflight !== null)
                return;
            this.#current = null;
            void this.#shutDown(session);
        }, this.#idleShutdownMs);
        this.#idleTimer.unref();
    }
}
export function createScriptedObservationHelper(respond) {
    const helper = {
        requests: [],
        warmUps: 0,
        closed: false,
        warmUp() { helper.warmUps += 1; },
        async observe(paths) {
            validateRequest(paths);
            if (helper.closed)
                throw new ObservationHelperError('helper_unavailable', 'the observation helper is closed');
            helper.requests.push([...paths]);
            return await respond(paths, helper.requests.length);
        },
        async close() { helper.closed = true; },
    };
    return helper;
}
