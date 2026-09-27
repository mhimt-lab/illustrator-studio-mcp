import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRedactor } from './redact.mjs';

/**
 * illustrator-studio-mcp Windows verification kit. See README.md / README.en.md next to this file.
 * Standalone: it runs the 17 cells (W0〜W16) in a fixed order on a Windows machine prepared as the README
 * describes, and writes redacted results to `windows-probe-results-<YYYYMMDD>/` at the repository root.
 * It never runs anywhere else: on any platform but win32 it prints its plan and limits and exits before
 * touching a process, a file or Illustrator.
 *
 *   node windows-probe/illustrator-windows-probe.mjs --state-root <dir> --expect-head <sha> --expect-sha256 <sha>
 *
 * The run covers only the listed cells in order: no retry, cleanup, reconcile or unlock. Any stop
 * condition stops every later cell. A timeout is recorded as indeterminate, never as a failure.
 * Uses the unwired Windows parts in `dist/windows/` (the PowerShell runner and its classifiers), Windows
 * PowerShell 5.1, and a console session.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PROBE_FILES = [
  'windows-probe/illustrator-windows-probe.mjs',
  'windows-probe/illustrator-windows-probe.ps1',
  'windows-probe/illustrator-windows-probe.jsx',
  'windows-probe/redact.mjs',
];
const DISPOSABLE_ASCII = 'mcp-windows-probe.ai';
const DISPOSABLE_JAPANESE = 'mcp-windows-probe-日本語.ai';

/**
 * The cells in order, with the upper bounds this probe enforces per cell: runner spawns, JSX calls through
 * `DoJavaScriptFile`, helper calls that attach to Illustrator over COM, and all helper spawns (including the
 * COM-free session polls while waiting for the user to unlock). Exceeding a bound stops the probe.
 */
const PLAN = [
  { order: 1, cell: 'W12', hostState: 'Illustrator not running', runner: 0, jsx: 0, comHelper: 1, helper: 2, timeoutMs: 30_000, stop: 'Illustrator process count increased' },
  { order: 2, cell: 'W0', hostState: 'stable running, disposable documents open', runner: 0, jsx: 0, comHelper: 1, helper: 1, timeoutMs: 60_000, stop: 'Illustrator process count increased' },
  { order: 3, cell: 'W14', hostState: 'as W0 (and Beta states when installed)', runner: 0, jsx: 0, comHelper: 3, helper: 7, timeoutMs: 60_000, stop: null },
  { order: 4, cell: 'W13', hostState: 'as W0', runner: 2, jsx: 1, comHelper: 0, helper: 0, timeoutMs: 60_000, stop: 'COM contact before go' },
  { order: 5, cell: 'W1', hostState: 'as W0, ASCII and Japanese document names and state roots', runner: 2, jsx: 2, comHelper: 0, helper: 0, timeoutMs: 60_000, stop: 'result missing or garbled' },
  { order: 6, cell: 'W2', hostState: 'as W0', runner: 2, jsx: 2, comHelper: 0, helper: 0, timeoutMs: 60_000, stop: 'JSX and COM exceptions not distinguishable' },
  { order: 7, cell: 'W16', hostState: 'as W0', runner: 2, jsx: 2, comHelper: 1, helper: 1, timeoutMs: 60_000, stop: 'Illustrator stopped responding' },
  { order: 8, cell: 'W3', hostState: 'modal dialog open in a disposable document', runner: 1, jsx: 1, comHelper: 0, helper: 0, timeoutMs: 20_000, stop: 'Illustrator froze' },
  { order: 9, cell: 'W9', hostState: 'right after W3 (the W3 call, or a busy JSX when W3 returned), probe lock held', runner: 1, jsx: 1, comHelper: 1, helper: 3, timeoutMs: 60_000, stop: 'lock released' },
  { order: 10, cell: 'W10', hostState: 'any', runner: 1, jsx: 0, comHelper: 0, helper: 2, timeoutMs: 30_000, stop: null },
  { order: 11, cell: 'W11', hostState: 'any', runner: 0, jsx: 0, comHelper: 0, helper: 1, timeoutMs: 30_000, stop: null },
  { order: 12, cell: 'W4', hostState: 'unlocked', runner: 0, jsx: 0, comHelper: 0, helper: 19, timeoutMs: 8_000, stop: 'SessionFlags inverted or unknown' },
  { order: 13, cell: 'W5', hostState: 'locked (W4)', runner: 0, jsx: 0, comHelper: 1, helper: 2, timeoutMs: 30_000, stop: 'Illustrator froze' },
  { order: 14, cell: 'W6', hostState: 'locked (W4)', runner: 0, jsx: 0, comHelper: 1, helper: 452, timeoutMs: 30_000, stop: 'durable state created' },
  { order: 15, cell: 'W15', hostState: 'foreground / background / locked', runner: 0, jsx: 0, comHelper: 0, helper: 530, timeoutMs: 30_000, stop: null },
  { order: 16, cell: 'W7', hostState: 'Illustrator in the background', runner: 1, jsx: 1, comHelper: 0, helper: 2, timeoutMs: 60_000, stop: 'document damaged' },
  { order: 17, cell: 'W8', hostState: 'Illustrator in the background', runner: 0, jsx: 0, comHelper: 1, helper: 1, timeoutMs: 30_000, stop: null },
];
const LIMITS = PLAN.reduce((sum, row) => ({
  runner: sum.runner + row.runner, jsx: sum.jsx + row.jsx, comHelper: sum.comHelper + row.comHelper, helper: sum.helper + row.helper,
}), { runner: 0, jsx: 0, comHelper: 0, helper: 0 });

function probeManifest() {
  const files = PROBE_FILES.map((path) => ({ path, sha256: createHash('sha256').update(readFileSync(join(ROOT, path))).digest('hex') }));
  const combined = createHash('sha256').update(files.map((file) => `${file.path}\0${file.sha256}\n`).join('')).digest('hex');
  return { files, sha256: combined };
}

if (process.platform !== 'win32') {
  // Nothing but reading this probe's own files: no spawn, no write, no Illustrator.
  console.log(JSON.stringify({
    event: 'skipped',
    result: { reason: 'not_win32', platform: process.platform, cells: PLAN.map((row) => row.cell), limits: LIMITS, probeSha256: probeManifest().sha256 },
    plan: PLAN,
  }));
  process.exit(0);
}

await runOnWindows();

async function runOnWindows() {
  const { spawn } = await import('node:child_process');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const readline = await import('node:readline/promises');
  const dist = (path) => import(new URL(`../dist/windows/${path}`, import.meta.url).href);
  const { windowsPowerShellEnvironment, windowsRunnerFileContents, windowsRunnerInvocation } = await dist('powershell-runner.js');
  const { classifyWindowsRunnerTermination } = await dist('failure-classification.js');
  const { windowsExecutionLiveness } = await dist('liveness.js');
  const { parseWindowsForegroundObservation, parseWindowsSessionState } = await dist('observation.js');

  const options = parseOptions(process.argv.slice(2));
  const manifest = probeManifest();
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  if (!systemRoot) throw new Error('SystemRoot is not set.');
  const powershell = `${systemRoot.replace(/\\+$/u, '')}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  const helperPath = join(HERE, 'illustrator-windows-probe.ps1');
  const jsxBody = readFileSync(join(HERE, 'illustrator-windows-probe.jsx'), 'utf8').replace(/^\uFEFF/u, '');
  const runnerBytes = windowsRunnerFileContents();
  const runnerSha256 = createHash('sha256').update(runnerBytes).digest('hex');
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const evidenceDir = join(ROOT, `windows-probe-results-${date}`);
  const stateRoot = resolve(options.stateRoot);
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  const counters = { runner: 0, jsx: 0, comHelper: 0, helper: 0 };
  class StopProbe extends Error {}
  let currentCell = null;
  let callSequence = 0;
  const pending = { w3: null };

  // --- evidence (attached to a public issue: every value passes through the redactor) ---------------------
  const redact = createRedactor(process.env, os.hostname());
  const writeEvidence = (name, value) => {
    fs.writeFileSync(join(evidenceDir, name), `${JSON.stringify(redact(value), null, 2)}\n`, { flag: 'wx' });
  };

  // --- processes ------------------------------------------------------------------------------------------
  // Every child gets the parent's environment without PSModulePath (a PS7 parent breaks 5.1 module autoload).
  const childEnv = windowsPowerShellEnvironment(process.env);
  function run(command, args, { timeoutMs, stdin = 'ignore', killOnTimeout = true, onSpawn } = {}) {
    return new Promise((resolveRun) => {
      const startedAt = Date.now();
      const child = spawn(command, args, { windowsHide: true, stdio: [stdin, 'pipe', 'pipe'], env: childEnv });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
      const timer = setTimeout(() => { timedOut = true; if (killOnTimeout) child.kill(); resolveRun(result(null, null)); }, timeoutMs);
      function result(code, signal) {
        return { code, signal, stdout, stderr, timedOut, ms: Date.now() - startedAt, pid: child.pid, child };
      }
      child.once('error', () => { clearTimeout(timer); if (!timedOut) resolveRun(result(null, null)); });
      child.once('exit', (code, signal) => { clearTimeout(timer); if (!timedOut) resolveRun(result(code, signal)); });
      onSpawn?.(child);
    });
  }

  function budget(kind, count = 1) {
    counters[kind] += count;
    const row = PLAN.find((entry) => entry.cell === currentCell);
    const used = currentCell === null ? 0 : (budget.cell[kind] = (budget.cell[kind] ?? 0) + count);
    if (row && used > row[kind]) throw new StopProbe(`${currentCell} exceeded its ${kind} bound (${row[kind]})`);
  }
  budget.cell = {};

  const COM_HELPER_ACTIONS = new Set(['active-object', 'activate-document']);
  async function helper(action, extra = [], timeoutMs = 30_000) {
    budget('helper');
    if (COM_HELPER_ACTIONS.has(action)) budget('comHelper');
    const outcome = await run(powershell, ['-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', helperPath, action, ...extra], { timeoutMs });
    let json = null;
    try { json = JSON.parse(outcome.stdout.trim().split(/\r?\n/u).at(-1) ?? ''); } catch { json = null; }
    const observeMs = /observeMs=([0-9.]+)/u.exec(outcome.stderr)?.[1];
    return { json, raw: outcome.stdout.trim(), code: outcome.code, timedOut: outcome.timedOut, ms: outcome.ms, observeMs: observeMs === undefined ? null : Number(observeMs) };
  }

  async function sessionState() {
    const observed = await helper('session');
    return { raw: observed.raw, state: parseWindowsSessionState(observed.raw), ms: observed.ms, timedOut: observed.timedOut };
  }

  function writeCallFiles(directory, action, busyMs, runnerSource) {
    fs.mkdirSync(directory, { recursive: true });
    const runnerPath = join(directory, 'runner.ps1');
    const jsxPath = join(directory, 'probe.jsx');
    const resultPath = join(directory, 'result.json');
    fs.writeFileSync(runnerPath, runnerSource, { flag: 'wx' });
    const prefix = `var MCP_PROBE_ACTION = ${JSON.stringify(action)};\nvar MCP_PROBE_RESULT = ${JSON.stringify(resultPath)};\nvar MCP_PROBE_BUSY_MS = ${busyMs};\n`;
    fs.writeFileSync(jsxPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(prefix + jsxBody, 'utf8')]), { flag: 'wx' });
    return { runnerPath, jsxPath, resultPath };
  }

  /** The W13 copy of the runner: each `# MCP_TRACE <name>` marker writes a timestamped stderr line. */
  function tracedRunner() {
    const text = runnerBytes.subarray(3).toString('utf8').replace(/^# MCP_TRACE (\w+)$/gmu,
      (_marker, name) => `[Console]::Error.WriteLine('MCP_TRACE ${name} ' + [DateTime]::UtcNow.ToString('o'))`);
    return Buffer.concat([runnerBytes.subarray(0, 3), Buffer.from(text, 'utf8')]);
  }

  /**
   * One runner call: spawn, read `ready <nonce>`, optionally wait, write the `go` line (or a wrong one), and
   * classify how it ended. `killOnTimeout: false` leaves a timed-out runner running (W3 → W9).
   */
  async function runnerCall({ action, root = stateRoot, busyMs = 0, timeoutMs, goNonce, holdBeforeGoMs = 0, trace = false, killOnTimeout = true, onReady }) {
    budget('runner');
    const sendsGo = goNonce !== 'wrong';
    if (sendsGo) budget('jsx');
    callSequence += 1;
    const directory = join(root, `call-${String(callSequence).padStart(2, '0')}-${currentCell}-${action}`);
    const files = writeCallFiles(directory, action, busyMs, trace ? tracedRunner() : runnerBytes);
    const nonce = randomUUID();
    const invocation = windowsRunnerInvocation({ systemRoot, runnerPath: files.runnerPath, nonce, jsxPath: files.jsxPath });
    let readyObserved = false;
    let readyAtMs = null;
    const spawnedAt = Date.now();
    const outcome = await run(invocation.command, invocation.args, {
      timeoutMs, stdin: 'pipe', killOnTimeout,
      onSpawn: (child) => {
        let buffered = '';
        child.stdout.on('data', (chunk) => {
          buffered += chunk.toString('utf8');
          if (!readyObserved && buffered.includes('\n')) {
            if (buffered.split('\n')[0].replace(/\r$/u, '') !== `ready ${nonce}`) { child.stdin.end(); return; }
            readyObserved = true;
            readyAtMs = Date.now() - spawnedAt;
            onReady?.(child);
            setTimeout(() => { child.stdin.write(`go ${sendsGo ? nonce : randomUUID()}\n`); }, holdBeforeGoMs);
          }
        });
      },
    });
    const traces = outcome.stderr.split(/\r?\n/u).filter((line) => line.startsWith('MCP_TRACE '))
      .map((line) => { const [, name, at] = line.split(' '); return { name, at }; });
    const stderr = outcome.stderr.split(/\r?\n/u).filter((line) => !line.startsWith('MCP_TRACE ')).join('\n');
    const classification = classifyWindowsRunnerTermination({
      readyObserved, parentTimedOut: outcome.timedOut, exitCode: outcome.code, signal: outcome.signal, stderr,
    });
    let result = null;
    try { result = JSON.parse(readFileSync(files.resultPath, 'utf8').replace(/^\uFEFF/u, '')); } catch { result = null; }
    return {
      directory, resultPath: files.resultPath, pid: outcome.pid, child: outcome.child, readyAtMs, durationMs: outcome.ms,
      exitCode: outcome.code, signal: outcome.signal, timedOut: outcome.timedOut, classification, traces, result,
    };
  }
  const publicCall = (call) => {
    if (call === null) return null;
    const { child: _child, directory: _directory, resultPath: _resultPath, ...rest } = call;
    return rest;
  };

  const ask = async (question) => (await input.question(`\n${question}\n> `)).trim();
  const confirm = async (question) => /^y(es)?$/iu.test(await ask(`${question} (y/n)`));
  const waitEnter = async (instruction) => { await ask(`${instruction}\n準備ができたら Enter / Press Enter when ready`); };
  const countdown = async (instruction, seconds = 5) => {
    await ask(`${instruction}\nEnter の後 ${seconds} 秒で観測します。その間に切り替えてください / The probe observes ${seconds} seconds after Enter; switch windows in the meantime`);
    await sleep(seconds * 1000);
  };
  const sleep = (ms) => new Promise((resolveSleep) => { setTimeout(resolveSleep, ms); });
  const illustratorCount = (observation) => (observation.json?.processes ?? []).filter((entry) => /\\Illustrator\.exe$/iu.test(entry.path ?? '')).length;

  async function waitForSession(state, limitMs, intervalMs) {
    const started = Date.now();
    const samples = [];
    while (Date.now() - started <= limitMs) {
      const observed = await sessionState();
      samples.push({ raw: observed.raw, state: observed.state, atMs: Date.now() - started });
      if (observed.state === state) return { reached: true, samples };
      await sleep(intervalMs);
    }
    return { reached: false, samples };
  }

  // --- preconditions (C1〜C10) ----------------------------------------------------------------------------
  if (fs.existsSync(evidenceDir)) throw new Error(`Evidence directory already exists: ${relative(ROOT, evidenceDir)}. Nothing was run.`);
  const tempRoot = resolve(os.tmpdir()).toLowerCase();
  if (!/^[A-Za-z]:\\/u.test(stateRoot) || stateRoot.toLowerCase().startsWith(tempRoot)) {
    throw new Error('--state-root must be an absolute drive path outside %TEMP%. Nothing was run.');
  }
  if (fs.existsSync(stateRoot) && fs.readdirSync(stateRoot).length > 0) throw new Error('--state-root must be empty or absent. Nothing was run.');

  const git = async (args) => (await run('git', args, { timeoutMs: 30_000 })).stdout.trim();
  const powershellInfo = await run(powershell, ['-NoProfile', '-NonInteractive', '-Command',
    '$PSVersionTable.PSVersion.ToString(); [Threading.Thread]::CurrentThread.ApartmentState.ToString(); Get-ExecutionPolicy -List | ForEach-Object { $_.Scope.ToString() + "=" + $_.ExecutionPolicy.ToString() }'],
  { timeoutMs: 60_000 });
  const [psVersion = '', apartment = '', ...policies] = powershellInfo.stdout.trim().split(/\r?\n/u).map((line) => line.trim());
  const policy = Object.fromEntries(policies.map((line) => line.split('=')));
  const groups = (await run('whoami', ['/groups'], { timeoutMs: 30_000 })).stdout;
  const session = await sessionState();
  const head = await git(['rev-parse', 'HEAD']);
  // The kit's own results folders are not local changes: an earlier not-started run must not fail C9.
  const dirty = await git(['status', '--porcelain', '--', '.', ':(exclude)windows-probe-results-*']);
  const build = Number(os.release().split('.')[2] ?? 0);
  const environment = {
    C1: { osRelease: os.release(), arch: process.env.PROCESSOR_ARCHITECTURE ?? null, ok: build >= 19045 && process.env.PROCESSOR_ARCHITECTURE === 'AMD64' },
    C2: { session: session.raw, ok: session.state === 'unlocked' },
    C3: { psVersion, apartment, ok: psVersion.startsWith('5.1.') && apartment === 'STA' },
    // readable: false means the policy list could not be read at all, not that a policy is set.
    C4: { policy, readable: policies.length > 0, ok: policy.MachinePolicy === 'Undefined' && policy.UserPolicy === 'Undefined' },
    C5: { node: process.version, arch: process.arch, execPath: process.execPath, ok: Number(process.versions.node.split('.')[0]) >= 20 && process.arch === 'x64' },
    C6: { ok: await confirm('C6: Illustrator stable が 1 つインストールされていますか（Beta は任意） / Is exactly one stable Illustrator installed (Beta is optional)?') },
    // S-1-16-8192 is the Medium Mandatory Level SID, independent of the display language.
    C7: { mediumIntegrity: groups.includes('S-1-16-8192'), elevated: groups.includes('S-1-16-12288'), ok: groups.includes('S-1-16-8192') && !groups.includes('S-1-16-12288') },
    C8: { ok: await confirm('C8: この Windows ユーザーに業務の Illustrator 文書はありませんか（無ければ y） / Is this Windows user free of work Illustrator documents (y if none)?') },
    C9: { head, expectedHead: options.expectHead, clean: dirty === '', probeSha256: manifest.sha256, expectedSha256: options.expectSha256, runnerSha256,
      ok: head === options.expectHead && dirty === '' && manifest.sha256 === options.expectSha256 },
    C10: { ok: await confirm('C10: サインインにパスワードか PIN が設定されていますか / Does sign-in require a password or PIN?') },
  };
  fs.mkdirSync(evidenceDir, { recursive: true });
  writeEvidence('environment.json', { ...environment, probe: manifest, limits: LIMITS });
  const failed = Object.entries(environment).filter(([, value]) => !value.ok).map(([key]) => key);
  if (failed.length > 0) {
    fs.writeFileSync(join(evidenceDir, 'summary.md'), `# Windows probe — not started\n\nPreconditions not met: ${failed.join(', ')}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ event: 'not_started', failed }));
    input.close();
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(stateRoot, { recursive: true });

  // --- cells (W0〜W16) ------------------------------------------------------------------------------------
  const cells = {
    async W12() {
      await waitEnter('W12: Illustrator を終了してください（プロセスが残っていないこと）。\n     Quit Illustrator (no Illustrator process may remain).');
      const attach = await helper('active-object');
      await sleep(5_000);
      const later = await helper('enumerate');
      const observations = { attach: attach.json, processesFiveSecondsLater: illustratorCount(later), timedOut: attach.timedOut };
      if (attach.json === null) return { outcome: 'UNKNOWN', observations };
      if (attach.json.processesBefore !== 0) return { outcome: 'UNKNOWN', observations, stopReason: 'precondition: Illustrator was running' };
      if (attach.json.processesAfter > 0 || observations.processesFiveSecondsLater > 0) {
        return { outcome: 'UNSUPPORTED', observations, stopReason: 'Illustrator process count increased' };
      }
      return { outcome: attach.json.attached ? 'UNKNOWN' : 'PASS', observations };
    },
    async W0() {
      await waitEnter(`W0: Illustrator stable を起動し、新規文書を「${DISPOSABLE_ASCII}」と「${DISPOSABLE_JAPANESE}」の名前で probe 用フォルダに保存し、2 枚とも開いたままにしてください。\n    Start stable Illustrator, save two new documents named "${DISPOSABLE_ASCII}" and "${DISPOSABLE_JAPANESE}" in the probe document folder, and keep both open.`);
      const attach = await helper('active-object', [], 60_000);
      const observations = { attach: attach.json, spawnToExitMs: attach.ms, timedOut: attach.timedOut };
      if (attach.json === null) return { outcome: attach.timedOut ? 'INDETERMINATE' : 'UNKNOWN', observations };
      if (attach.json.processesAfter > attach.json.processesBefore) return { outcome: 'UNSUPPORTED', observations, stopReason: 'Illustrator process count increased' };
      const ok = attach.json.attached && attach.json.version !== '' && attach.json.processesBefore === 1;
      return { outcome: ok ? 'PASS' : 'UNSUPPORTED', observations, ...(ok ? {} : { stopReason: 'W0 is required for every later cell' }) };
    },
    async W14() {
      const states = [];
      const observe = async (label) => {
        const enumerated = await helper('enumerate');
        const attach = await helper('active-object');
        states.push({ label, enumerate: enumerated.json, attach: attach.json });
      };
      await observe('stable only');
      if (await confirm('W14: Illustrator Beta はインストールされていますか / Is Illustrator Beta installed?')) {
        await waitEnter('W14: stable を終了し、Beta だけを起動してください。\n     Quit stable and start only Beta.');
        await observe('beta only');
        await waitEnter('W14: stable も起動し、両方が動いている状態にしてください。\n     Start stable as well, so that both are running.');
        await observe('both');
        await waitEnter(`W14: Beta を終了し、stable で「${DISPOSABLE_ASCII}」と「${DISPOSABLE_JAPANESE}」を開いた状態に戻してください。\n     Quit Beta and return to stable with "${DISPOSABLE_ASCII}" and "${DISPOSABLE_JAPANESE}" open.`);
      }
      const restored = await helper('enumerate');
      if (illustratorCount(restored) !== 1) return { outcome: 'UNKNOWN', observations: { states }, stopReason: 'could not return to exactly one running Illustrator' };
      return { outcome: 'PASS', observations: { states } };
    },
    async W13() {
      const mismatch = await runnerCall({ action: 'read', timeoutMs: 60_000, goNonce: 'wrong', holdBeforeGoMs: 2_000, trace: true });
      const matched = await runnerCall({ action: 'read', timeoutMs: 60_000, holdBeforeGoMs: 2_000, trace: true });
      const goAt = matched.traces.find((entry) => entry.name === 'go_received')?.at ?? null;
      const comAt = matched.traces.find((entry) => entry.name === 'com_begin')?.at ?? null;
      // A wrong `go` must end the runner before either marker; with the right one, COM starts after `go`.
      // The timestamps are .NET round-trip UTC strings, which order lexicographically.
      const comBeforeGo = mismatch.traces.length > 0 || (comAt !== null && (goAt === null || comAt < goAt));
      const observations = { mismatch: publicCall(mismatch), matched: publicCall(matched), goAt, comAt, runnerSha256 };
      if (comBeforeGo) return { outcome: 'UNSUPPORTED', observations, stopReason: 'COM contact before go' };
      const ok = mismatch.exitCode === 64 && mismatch.classification.outcome === 'not_contacted_failure' &&
        matched.classification.outcome === 'host_returned' && goAt !== null && comAt !== null;
      return { outcome: ok ? 'PASS' : 'UNSUPPORTED', observations, ...(ok ? {} : { stopReason: 'W13 is required: line protocol did not behave as specified' }) };
    },
    async W1() {
      const japaneseRoot = join(stateRoot, '状態-日本語');
      const calls = [
        await runnerCall({ action: 'read', timeoutMs: 60_000 }),
        await runnerCall({ action: 'read', root: japaneseRoot, timeoutMs: 60_000 }),
      ];
      const checks = calls.map((call) => {
        const names = (call.result?.disposable ?? []).map((entry) => entry.name);
        const keys = (call.result?.disposable ?? []).map((entry) => { try { return decodeURIComponent(entry.key ?? ''); } catch { return '\uFFFD'; } });
        return {
          stateRoot: call === calls[0] ? 'ascii' : 'japanese',
          classification: call.classification,
          resultPresent: call.result !== null,
          names,
          bothDocumentsFound: names.includes(DISPOSABLE_ASCII) && names.includes(DISPOSABLE_JAPANESE),
          garbled: [...names, ...keys].some((text) => text.includes('\uFFFD')),
          keysEndWithNames: keys.every((key, index) => key.endsWith(names[index] ?? '')),
          modified: (call.result?.disposable ?? []).map((entry) => entry.modified),
          renameOntoExisting: call.result?.renameOntoExisting ?? null,
          durationMs: call.durationMs,
        };
      });
      const ok = checks.every((check) => check.classification.outcome === 'host_returned' && check.resultPresent &&
        check.bothDocumentsFound && !check.garbled && check.keysEndWithNames);
      return { outcome: ok ? 'PASS' : 'UNSUPPORTED', observations: { checks }, ...(ok ? {} : { stopReason: 'result missing or garbled' }) };
    },
    async W2() {
      const caught = await runnerCall({ action: 'throw-caught', timeoutMs: 60_000 });
      const uncaught = await runnerCall({ action: 'throw-uncaught', timeoutMs: 60_000 });
      const observations = { caught: publicCall(caught), uncaught: publicCall(uncaught) };
      const ok = caught.classification.outcome === 'host_returned' && caught.result?.status === 'failed';
      return { outcome: ok ? 'PASS' : 'UNSUPPORTED', observations, ...(ok ? {} : { stopReason: 'JSX and COM exceptions not distinguishable' }) };
    },
    async W16() {
      const busy = runnerCall({ action: 'busy', busyMs: 15_000, timeoutMs: 60_000 });
      await sleep(3_000);
      const second = await runnerCall({ action: 'read', timeoutMs: 45_000 });
      const first = await busy;
      const responsive = await helper('active-object');
      const observations = { first: publicCall(first), second: publicCall(second), responsiveAfter: responsive.json };
      if (first.timedOut || responsive.json?.attached !== true) return { outcome: 'INDETERMINATE', observations, stopReason: 'Illustrator stopped responding' };
      return { outcome: 'PASS', observations };
    },
    async W3() {
      await waitEnter(`W3: 「${DISPOSABLE_ASCII}」でモーダルダイアログ（例: ファイル > ドキュメント設定）を開いたままにしてください。W9 で閉じてもらうまで閉じないでください。\n    In "${DISPOSABLE_ASCII}", open a modal dialog (for example File > Document Setup) and leave it open until W9 asks you to close it.`);
      fs.writeFileSync(join(stateRoot, 'probe.lock'), `${JSON.stringify({ cell: 'W3', at: new Date().toISOString() })}\n`, { flag: 'wx' });
      const call = await runnerCall({ action: 'read', timeoutMs: 20_000, killOnTimeout: false });
      pending.w3 = call;
      // modalBlocked: false is a measured value (the call returned with the dialog open), not a missing one.
      const observations = { call: publicCall(call), modalBlocked: call.timedOut };
      return { outcome: call.timedOut && call.classification.outcome === 'indeterminate' ? 'PASS' : 'UNKNOWN', observations };
    },
    async W9() {
      const closeDialog = () => waitEnter('W9: モーダルダイアログを閉じてください。\n    Close the modal dialog.');
      let call = pending.w3;
      // When the modal did not block W3, the pending call comes from a JSX that outlives a short parent timeout.
      const source = call?.timedOut ? 'w3_modal' : 'busy_jsx';
      if (source === 'busy_jsx') {
        await closeDialog();
        call = await runnerCall({ action: 'busy', busyMs: 30_000, timeoutMs: 5_000, killOnTimeout: false });
        if (!call.timedOut) return { outcome: 'UNKNOWN', observations: { source, call: publicCall(call), reason: 'busy call returned before the parent timeout' } };
      }
      const creation = await helper('creation-time', [String(call.pid)]);
      const exited = new Promise((resolveExit) => {
        if (call.child.exitCode !== null || call.child.signalCode !== null) resolveExit({ code: call.child.exitCode, signal: call.child.signalCode });
        else call.child.once('exit', (code, signal) => { resolveExit({ code, signal }); });
      });
      call.child.kill();
      const termination = await exited;
      const classification = classifyWindowsRunnerTermination({
        readyObserved: call.readyAtMs !== null, parentTimedOut: true, exitCode: termination.code, signal: termination.signal, stderr: '',
      });
      const afterKill = await helper('creation-time', [String(call.pid)]);
      const liveness = creation.json?.kind === 'found'
        ? windowsExecutionLiveness({ pid: call.pid, creationTime: creation.json.creationTime }, afterKill.json ?? { pid: call.pid, kind: 'error' })
        : 'unknown';
      if (source === 'w3_modal') await closeDialog();
      const started = Date.now();
      let lateResultMs = null;
      while (Date.now() - started <= 60_000) {
        if (fs.existsSync(call.resultPath)) { lateResultMs = Date.now() - started; break; }
        await sleep(1_000);
      }
      const lockHeld = fs.existsSync(join(stateRoot, 'probe.lock'));
      const responsive = await helper('active-object');
      const observations = {
        source, termination, classification, livenessAfterKill: liveness, lockHeld, lateResultMs, responsiveAfter: responsive.json,
        // The MCP reconcile tool is not available on Windows yet; the probe records the parts it will use.
        reconcileInspect: 'not_available',
      };
      if (responsive.json?.attached !== true) return { outcome: 'INDETERMINATE', observations, stopReason: 'Illustrator froze' };
      if (!lockHeld) return { outcome: 'UNSUPPORTED', observations, stopReason: 'lock released' };
      return { outcome: classification.outcome === 'indeterminate' ? 'PASS' : 'UNKNOWN', observations };
    },
    async W10() {
      let identity = null;
      const call = await runnerCall({
        action: 'read', timeoutMs: 30_000, goNonce: 'wrong', holdBeforeGoMs: 3_000,
        onReady: (child) => { identity = helper('creation-time', [String(child.pid)]); },
      });
      const whileRunning = await identity;
      const afterExit = await helper('creation-time', [String(call.pid)]);
      const liveness = whileRunning?.json?.kind === 'found'
        ? windowsExecutionLiveness({ pid: call.pid, creationTime: whileRunning.json.creationTime }, afterExit.json ?? { pid: call.pid, kind: 'error' })
        : 'unknown';
      const observations = { whileRunning: whileRunning?.json ?? null, afterExit: afterExit.json, liveness, exitCode: call.exitCode };
      return { outcome: liveness === 'inactive' ? 'PASS' : 'UNKNOWN', observations };
    },
    async W11() {
      const constants = Object.fromEntries(Object.entries(fs.constants).filter(([key]) => /^(O_|UV_FS_O_)/u.test(key)));
      const base = join(process.env.LOCALAPPDATA ?? '', `illustrator-studio-mcp-probe-${date}`);
      fs.mkdirSync(base, { recursive: false });
      const existing = join(base, 'existing.txt');
      const source = join(base, 'source.txt');
      fs.writeFileSync(existing, 'existing');
      fs.writeFileSync(source, 'source');
      const stat = (path) => { const value = fs.statSync(path); return { uid: value.uid, gid: value.gid, mode: value.mode.toString(8) }; };
      let link;
      try { fs.linkSync(source, existing); link = { replaced: true, existingText: readFileSync(existing, 'utf8') }; } catch (error) { link = { replaced: false, code: error.code }; }
      let symlink;
      try {
        fs.symlinkSync(existing, join(base, 'link.txt'));
        symlink = { created: true, isSymbolicLink: fs.lstatSync(join(base, 'link.txt')).isSymbolicLink() };
      } catch (error) { symlink = { created: false, code: error.code }; }
      const acl = (await helper('acl', [base])).json;
      return { outcome: 'PASS', observations: { constants, directory: stat(base), file: stat(existing), link, symlink, acl, probeDirectory: base } };
    },
    async W4() {
      await waitEnter('W4〜W6: 次に画面をロックします。ロックされたら 1 分ほど待ってから解錠してください（W5・W6 はロック中に自動で進みます）。\n        The probe locks the screen next. Once locked, wait about one minute, then unlock (W5 and W6 run while locked).');
      const before = await sessionState();
      if (before.state !== 'unlocked') return { outcome: 'UNKNOWN', observations: { before }, stopReason: 'SessionFlags inverted or unknown' };
      const lock = await helper('lock');
      const polled = await waitForSession('locked', 8_000, 500);
      const observations = { before, lockStarted: lock.json, samples: polled.samples };
      const last = polled.samples.at(-1);
      if (!polled.reached || !/"SessionFlags":0,/u.test(last?.raw ?? '')) return { outcome: 'UNSUPPORTED', observations, stopReason: 'SessionFlags inverted or unknown' };
      return { outcome: 'PASS', observations };
    },
    async W5() {
      const state = await sessionState();
      const read = state.state === 'locked' ? await helper('active-object') : null;
      pending.w5 = { state, read };
      return { outcome: state.state === 'locked' ? 'PASS' : 'UNKNOWN', observations: { session: state, readWhileLocked: read?.json ?? null, timedOut: read?.timedOut ?? null, ms: read?.ms ?? null } };
    },
    async W6() {
      const listing = () => fs.readdirSync(stateRoot).sort().join('\n');
      const before = listing();
      const state = await sessionState();
      // The admission rule: refuse before any durable state unless the session is an unlocked console.
      const admitted = state.state === 'unlocked';
      const unchanged = listing() === before;
      const observations = { session: state, admitted, stateRootUnchanged: unchanged };
      if (!unchanged) return { outcome: 'UNSUPPORTED', observations, stopReason: 'durable state created' };
      const unlock = await waitForSession('unlocked', 15 * 60_000, 2_000);
      const responsive = await helper('active-object');
      observations.unlockedAfterMs = unlock.reached ? unlock.samples.at(-1).atMs : null;
      observations.responsiveAfterUnlock = responsive.json;
      if (!unlock.reached) return { outcome: 'UNKNOWN', observations, stopReason: 'session did not return to unlocked' };
      if (responsive.json?.attached !== true) return { outcome: 'INDETERMINATE', observations, stopReason: 'Illustrator froze' };
      return { outcome: admitted ? 'UNSUPPORTED' : 'PASS', observations, ...(admitted ? { stopReason: 'admitted while locked' } : {}) };
    },
    async W15() {
      const sample = async () => {
        const state = await sessionState();
        const foreground = await helper('foreground');
        const observation = parseWindowsForegroundObservation(foreground.raw, state.state, new Date().toISOString());
        return { profile: observation.profile, sessionMs: state.ms, foregroundSpawnMs: foreground.ms, observeMs: foreground.observeMs };
      };
      const series = async (expected) => { const samples = []; for (let index = 0; index < 10; index += 1) { samples.push(await sample()); await sleep(300); } return { expected, samples }; };
      await countdown('W15: Illustrator を前面にしてください。\n     Bring Illustrator to the front.');
      const foreground = await series('foreground');
      await countdown('W15: エクスプローラーを前面にしてください（Illustrator は背面に）。\n     Bring File Explorer to the front (Illustrator behind it).');
      const background = await series('background');
      await waitEnter('W15: 次に画面をロックします。ロックされたら 1 分ほど待ってから解錠してください。\n     The probe locks the screen next. Once locked, wait about one minute, then unlock.');
      await helper('lock');
      const lockedReached = await waitForSession('locked', 8_000, 500);
      const locked = lockedReached.reached ? await series('locked') : { expected: 'locked', samples: [] };
      const unlock = await waitForSession('unlocked', 15 * 60_000, 2_000);
      const all = [foreground, background, locked];
      const distinguished = all.every((entry) => entry.samples.length === 10 && entry.samples.every((item) => item.profile === entry.expected));
      const observations = { series: all, unlocked: unlock.reached };
      if (!unlock.reached) return { outcome: 'UNKNOWN', observations, stopReason: 'session did not return to unlocked' };
      return { outcome: distinguished ? 'PASS' : 'UNKNOWN', observations };
    },
    async W7() {
      await countdown(`W7: Illustrator で「${DISPOSABLE_ASCII}」をアクティブにしたまま、エクスプローラーを前面にしてください。\n    Keep "${DISPOSABLE_ASCII}" active in Illustrator and bring File Explorer to the front.`);
      const state = await sessionState();
      const foreground = await helper('foreground');
      const profile = parseWindowsForegroundObservation(foreground.raw, state.state, new Date().toISOString()).profile;
      if (profile !== 'background') return { outcome: 'UNKNOWN', observations: { profile }, stopReason: null };
      const call = await runnerCall({ action: 'rectangle', timeoutMs: 60_000 });
      const observations = { profile, call: publicCall(call) };
      if (call.timedOut) return { outcome: 'INDETERMINATE', observations, stopReason: 'rectangle create timed out' };
      const delta = call.result?.status === 'ok' ? call.result.itemsAfter - call.result.itemsBefore : null;
      if (delta !== null && delta !== 1) return { outcome: 'UNSUPPORTED', observations, stopReason: 'document damaged' };
      observations.classification = delta === 1 ? 'BACKGROUND_SUPPORTED' : 'REQUIRES_FOREGROUND';
      return { outcome: call.result?.status === 'refused' ? 'UNKNOWN' : 'PASS', observations };
    },
    async W8() {
      await countdown('W8: エクスプローラーを前面にしてください。\n    Bring File Explorer to the front.');
      const activated = await helper('activate-document');
      return { outcome: activated.json === null ? 'UNKNOWN' : 'PASS', observations: activated.json };
    },
  };

  const summary = [];
  let stopped = null;
  for (const row of PLAN) {
    if (stopped !== null) { summary.push({ cell: row.cell, outcome: 'NOT_RUN' }); continue; }
    currentCell = row.cell;
    budget.cell = {};
    const startedAt = new Date();
    let record;
    try {
      record = await cells[row.cell]();
    } catch (error) {
      record = { outcome: error instanceof StopProbe ? 'INDETERMINATE' : 'UNKNOWN', observations: null, stopReason: String(error?.message ?? error) };
    }
    const evidence = {
      cell: row.cell, head, scriptSha256: manifest.sha256, startedAt: startedAt.toISOString(), durationMs: Date.now() - startedAt.getTime(),
      hostState: row.hostState, observations: record.observations, outcome: record.outcome, calls: { ...budget.cell },
      ...(record.stopReason ? { stopReason: record.stopReason } : {}),
    };
    writeEvidence(`${row.cell.toLowerCase()}.json`, evidence);
    summary.push({ cell: row.cell, outcome: record.outcome, stopReason: record.stopReason ?? null });
    console.log(JSON.stringify({ event: 'cell', cell: row.cell, outcome: record.outcome, stopReason: record.stopReason ?? null }));
    if (record.stopReason) stopped = row.cell;
  }
  input.close();
  const lines = ['# Windows probe summary', '', `HEAD \`${head}\`, probe SHA-256 \`${manifest.sha256}\`, runner SHA-256 \`${runnerSha256}\``, '',
    '| Cell | Outcome | Stop |', '| --- | --- | --- |',
    ...summary.map((entry) => `| ${entry.cell} | ${entry.outcome} | ${entry.stopReason ?? ''} |`), '',
    `Calls: ${JSON.stringify(counters)} (limits ${JSON.stringify(LIMITS)}). The state root and \`%LOCALAPPDATA%\\illustrator-studio-mcp-probe-${date}\` are left in place.`, ''];
  fs.writeFileSync(join(evidenceDir, 'summary.md'), redact(lines.join('\n')), { flag: 'wx' });
  console.log(JSON.stringify({ event: stopped === null ? 'completed' : 'stopped', stoppedAt: stopped, counters, evidence: relative(ROOT, evidenceDir) }));
  process.exit(stopped === null ? 0 : 1);
}

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const [name, value] = [argv[index], argv[index + 1]];
    if (value === undefined) throw new Error(`Missing value for ${name}.`);
    if (name === '--state-root') options.stateRoot = value;
    else if (name === '--expect-head') options.expectHead = value;
    else if (name === '--expect-sha256') options.expectSha256 = value;
    else throw new Error(`Unknown option ${name}.`);
  }
  for (const key of ['stateRoot', 'expectHead', 'expectSha256']) {
    if (!options[key]) throw new Error('Usage: node windows-probe/illustrator-windows-probe.mjs --state-root <dir> --expect-head <sha> --expect-sha256 <sha>');
  }
  return options;
}
