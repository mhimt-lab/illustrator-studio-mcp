#!/usr/bin/env node
// Verifies a release artifact produced by scripts/release-artifact.mjs in a disposable install prefix.
//
// Gates (all fail closed):
//   1. SHA256SUMS matches the tarball named in release-manifest.json.
//   2. `npm install -g --prefix <tmp>` of the tarball succeeds without lifecycle scripts.
//   3. The installed bin prints exactly the manifest version for `--version`.
//   4. The installed bin completes an MCP initialize handshake over stdio (macOS only; see --handshake).
//
// The child process receives a minimal environment and a disposable state directory, so the
// verification never touches the user's real state root and never logs environment values.
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const HANDSHAKE_MODES = new Set(['auto', 'require', 'skip']);

export function parseArguments(argv) {
  const options = { releaseDir: resolve('release'), handshake: 'auto', keepPrefix: false, handshakeTimeoutMs: 15_000 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
      index += 1;
      return value;
    };
    switch (argument) {
      case '--release-dir': options.releaseDir = resolve(next()); break;
      case '--handshake': {
        const mode = next();
        if (!HANDSHAKE_MODES.has(mode)) throw new Error(`--handshake must be one of ${[...HANDSHAKE_MODES].join('|')}`);
        options.handshake = mode;
        break;
      }
      case '--handshake-timeout-ms': {
        const value = Number.parseInt(next(), 10);
        if (!Number.isInteger(value) || value <= 0) throw new Error('--handshake-timeout-ms must be a positive integer.');
        options.handshakeTimeoutMs = value;
        break;
      }
      case '--keep-prefix': options.keepPrefix = true; break;
      default: throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function emit(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({ event, ...fields })}\n`);
}

export function parseChecksums(text) {
  const entries = new Map();
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
    if (match === null) throw new Error(`Malformed SHA256SUMS line: ${line}`);
    entries.set(match[2], match[1]);
  }
  return entries;
}

async function verifyChecksum(releaseDir, tarball, expectedFromManifest) {
  const sums = parseChecksums(await readFile(join(releaseDir, 'SHA256SUMS'), 'utf8'));
  const listed = sums.get(tarball);
  if (listed === undefined) throw new Error(`SHA256SUMS has no entry for ${tarball}.`);
  if (listed !== expectedFromManifest) throw new Error(`SHA256SUMS digest for ${tarball} differs from release-manifest.json.`);
  const actual = createHash('sha256').update(await readFile(join(releaseDir, tarball))).digest('hex');
  if (actual !== listed) throw new Error(`Tarball ${tarball} sha256 ${actual} does not match SHA256SUMS ${listed}.`);
  return actual;
}

function childEnvironment(stateDir) {
  const environment = { HOME: stateDir, ILLUSTRATOR_STUDIO_MCP_STATE_DIR: join(stateDir, 'state') };
  if (process.env.PATH !== undefined) environment.PATH = process.env.PATH;
  return environment;
}

export async function runHandshake(binPath, environment, expectedVersion, timeoutMs) {
  const child = spawn(process.execPath, [binPath], { env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let id = 0;
  const fail = error => { for (const row of pending.values()) row.reject(error); pending.clear(); };
  child.on('error', fail);
  child.on('exit', () => fail(new Error('MCP process exited before its response.')));
  child.stderr.resume(); // Do not expose host paths or environment through diagnostics.
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    try {
      const message = JSON.parse(line);
      const row = pending.get(message.id);
      if (!row) return;
      pending.delete(message.id);
      if (message.error) row.reject(new Error('MCP returned a protocol error.'));
      else row.resolve(message.result);
    } catch { fail(new Error('MCP stdout is not JSON-RPC.')); }
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('MCP request timed out.')); }, timeoutMs);
    pending.set(requestId, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params })}\n`);
  });
  try {
    const result = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'release-verify', version: '1' } });
    if (result.serverInfo?.name !== 'illustrator-studio-mcp' || result.serverInfo.version !== expectedVersion) throw new Error('MCP server identity mismatch.');
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const names = new Set();
    const cursors = new Set();
    let cursor;
    let pages = 0;
    do {
      const page = await request('tools/list', cursor ? { cursor } : {});
      if (!Array.isArray(page.tools)) throw new Error('Invalid tool discovery response.');
      for (const tool of page.tools) {
        if (typeof tool.name !== 'string' || names.has(tool.name)) throw new Error('Invalid or duplicate tool name.');
        names.add(tool.name);
      }
      pages++;
      cursor = page.nextCursor;
      if (cursor !== undefined && (typeof cursor !== 'string' || cursors.has(cursor) || pages > 100)) throw new Error('Invalid tool pagination.');
      cursors.add(cursor);
    } while (cursor !== undefined);
    if (!names.size) throw new Error('Installed server advertises no tools.');
    return { serverVersion: result.serverInfo.version, toolCount: names.size, pages };
  } finally { lines.close(); child.kill(); }
}

export async function verifyReleaseArtifact(options) {
  const manifest = JSON.parse(await readFile(join(options.releaseDir, 'release-manifest.json'), 'utf8'));
  const { name, version, tarball, sha256 } = manifest;
  if (typeof name !== 'string' || typeof version !== 'string' || typeof tarball !== 'string' || typeof sha256 !== 'string') {
    throw new Error('release-manifest.json is missing name, version, tarball, or sha256.');
  }
  const digest = await verifyChecksum(options.releaseDir, tarball, sha256);
  emit('checksum_verified', { tarball, sha256: digest });

  const prefix = await mkdtemp(join(tmpdir(), 'illustrator-studio-mcp-verify-'));
  try {
    await execFileAsync('npm', [
      'install', '-g', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', join(options.releaseDir, tarball),
    ], { env: { ...process.env, npm_config_loglevel: 'error' }, maxBuffer: 16 * 1024 * 1024 });
    const binPath = join(prefix, 'bin', name);
    const environment = childEnvironment(prefix);
    const { stdout } = await execFileAsync(process.execPath, [binPath, '--version'], { env: environment, timeout: 10_000 });
    if (stdout !== `${version}\n`) throw new Error(`Installed bin printed ${JSON.stringify(stdout)} for --version, expected ${version}.`);
    emit('installed_version_verified', { bin: `<prefix>/bin/${name}`, version });
    if (options.expectedAdapters) {
      const installed = await import(pathToFileURL(join(prefix, 'lib/node_modules', name, 'dist/default-mutation-operation-adapters.js')).href);
      const identities = installed.defaultMutationOperationRegistry().list().map(adapter => ({
        operation: adapter.operation, adapterIdentity: adapter.adapterIdentity,
        hostScriptDigest: adapter.hostScriptDigest, safetyIdentity: adapter.safetyRegistrationIdentity,
      }));
      if (JSON.stringify(identities) !== JSON.stringify(options.expectedAdapters)) throw new Error('Installed adapter/host/safety identities differ from the checked build.');
      emit('installed_identities_verified', { adapters: identities.length, hostScriptDigests: identities.length, safetyIdentities: identities.length });
    }


    const handshakeRequired = options.handshake === 'require' || (options.handshake === 'auto' && process.platform === 'darwin');
    if (handshakeRequired) {
      const handshake = await runHandshake(binPath, environment, version, options.handshakeTimeoutMs);
      emit('handshake_verified', handshake);
    } else {
      emit('handshake_skipped', { reason: options.handshake === 'skip' ? 'requested' : `platform ${process.platform} is not darwin` });
    }
    emit('release_verified', { name, version, tarball, handshake: handshakeRequired ? 'verified' : 'skipped' });
    return { name, version, tarball, sha256: digest, handshake: handshakeRequired ? 'verified' : 'skipped' };
  } finally {
    if (options.keepPrefix) emit('prefix_retained', { prefix });
    else await rm(prefix, { recursive: true, force: true });
  }
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (invokedDirectly) {
  Promise.resolve().then(() => verifyReleaseArtifact(parseArguments(process.argv.slice(2)))).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`${JSON.stringify({ event: 'release_verify_failed', message })}\n`);
    process.exitCode = 1;
  });
}
