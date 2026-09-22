#!/usr/bin/env node
// Builds the Claude Desktop extension (.mcpb) from the reviewed npm tarball, reproducibly.
//   node scripts/build-mcpb.mjs --tarball <path/to/name-version.tgz> --out-dir <dir>
// The bundle is the tarball's package/ directory (dist, package.json, LICENSE, README, shrinkwrap)
// plus its production dependencies installed with `npm ci --omit=dev --ignore-scripts` from the
// shipped npm-shrinkwrap.json, plus manifest.json filled from package.json. Every entry gets a
// fixed mtime and the zip lists entries in sorted order, so the same tarball yields the same bytes.
// It writes <name>-<version>.mcpb into --out-dir and prints its SHA-256; it never publishes.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const FIXED_MTIME = new Date('2026-01-01T00:00:00Z');
const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), '..', 'mcpb', 'manifest.json');

function emit(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({ event, ...fields })}\n`);
}

function parseArguments(argv) {
  const options = { tarball: null, outDir: null, manifestTemplate: TEMPLATE, record: false };
  for (let index = 0; index < argv.length; index += 1) {
    const next = () => { const value = argv[++index]; if (!value) throw new Error(`${argv[index - 1]} needs a value.`); return value; };
    switch (argv[index]) {
      case '--tarball': options.tarball = resolve(next()); break;
      case '--out-dir': options.outDir = resolve(next()); break;
      case '--manifest-template': options.manifestTemplate = resolve(next()); break;
      case '--record': options.record = true; break;
      default: throw new Error(`Unknown argument: ${argv[index]}`);
    }
  }
  if (!options.tarball || !options.outDir) throw new Error('Usage: build-mcpb.mjs --tarball <tgz> --out-dir <dir>');
  return options;
}

async function listFiles(root, prefix = '') {
  const out = [];
  for (const entry of (await readdir(join(root, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await listFiles(root, path));
    else if (entry.isFile()) out.push(path);
    else throw new Error(`Bundle contains a symlink or non-regular entry: ${path}`);
  }
  return out;
}

async function touchTree(root) {
  for (const path of await listFiles(root)) await utimes(join(root, path), FIXED_MTIME, FIXED_MTIME);
  const dirs = new Set();
  for (const path of await listFiles(root)) {
    let dir = dirname(path);
    while (dir !== '.' && !dirs.has(dir)) { dirs.add(dir); dir = dirname(dir); }
  }
  for (const dir of [...dirs].sort().reverse()) await utimes(join(root, dir), FIXED_MTIME, FIXED_MTIME);
}

export async function buildMcpb({ tarball, outDir, manifestTemplate = TEMPLATE }) {
  const staging = await mkdtemp(join(tmpdir(), 'mcpb-'));
  try {
    await execFileAsync('tar', ['-xzf', tarball, '-C', staging]);
    const bundle = join(staging, 'package');
    const pkg = JSON.parse(await readFile(join(bundle, 'package.json'), 'utf8'));
    if (await stat(join(bundle, 'dist/index.js')).catch(() => null) === null) throw new Error('The tarball has no dist/index.js.');
    if (await stat(join(bundle, 'LICENSE')).catch(() => null) === null) throw new Error('The tarball has no LICENSE.');
    if (await stat(join(bundle, 'npm-shrinkwrap.json')).catch(() => null) === null) throw new Error('The tarball has no npm-shrinkwrap.json.');
    await execFileAsync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: bundle, maxBuffer: 16 * 1024 * 1024 });
    await rm(join(bundle, 'node_modules', '.package-lock.json'), { force: true });
    const template = JSON.parse(await readFile(manifestTemplate, 'utf8'));
    const manifest = { ...template, name: pkg.name, version: pkg.version, description: pkg.description, license: pkg.license };
    await writeFile(join(bundle, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await touchTree(bundle);
    const files = await listFiles(bundle);
    const outputName = `${pkg.name}-${pkg.version}.mcpb`;
    const outputPath = join(outDir, outputName);
    await rm(outputPath, { force: true });
    await execFileAsync('mkdir', ['-p', outDir]);
    await new Promise((resolvePromise, reject) => {
      const child = execFile('zip', ['-X', '-D', '-q', '-@', outputPath], { cwd: bundle }, (error) => (error ? reject(error) : resolvePromise()));
      child.stdin.end(`${files.join('\n')}\n`);
    });
    const sha256 = createHash('sha256').update(await readFile(outputPath)).digest('hex');
    return { file: outputName, path: outputPath, sha256, entries: files.length, version: pkg.version };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

// Records the built .mcpb next to the tarball: one SHA256SUMS line and release-manifest.json "mcpb".
export async function recordMcpb(artifactDir, result) {
  const manifestPath = join(artifactDir, 'release-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.mcpb) throw new Error('release-manifest.json already records a .mcpb.');
  if (resolve(dirname(result.path)) !== resolve(artifactDir)) throw new Error('The .mcpb must be written into the artifact directory before it is recorded.');
  await appendFile(join(artifactDir, 'SHA256SUMS'), `${result.sha256}  ${result.file}\n`);
  await writeFile(manifestPath, `${JSON.stringify({ ...manifest, mcpb: { file: result.file, sha256: result.sha256 } }, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = await buildMcpb(options);
    if (options.record) await recordMcpb(options.outDir, result);
    emit('mcpb_written', { file: result.file, sha256: result.sha256, entries: result.entries, version: result.version, outDir: relative(process.cwd(), dirname(result.path)) || '.' });
  } catch (error) {
    emit('mcpb_failed', { message: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  }
}
