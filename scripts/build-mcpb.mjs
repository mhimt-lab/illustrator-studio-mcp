#!/usr/bin/env node
// Builds the Claude Desktop extension (.mcpb) from the reviewed npm tarball, reproducibly.
//   node scripts/build-mcpb.mjs --tarball <path/to/name-version.tgz> --out-dir <dir>
// The bundle is the tarball's package/ directory (dist, package.json, LICENSE, README, shrinkwrap)
// plus its production dependencies installed with `npm ci --omit=dev --ignore-scripts` from the
// shipped npm-shrinkwrap.json, plus manifest.json filled from package.json.
// The archive is written by writeReproducibleZip() below, not by an external `zip`, so its bytes depend
// only on the file names and contents: entries in UTF-8 byte order, one fixed DOS timestamp computed
// from UTC (no time zone), mode 0644 on every file, no directory entries, no extra fields (so no
// uid/gid, extended timestamps or macOS extended attributes), and a fixed deflate level. The same
// tarball therefore yields the same .mcpb on the reviewer's Mac and on the publishing runner.
// It writes <name>-<version>.mcpb into --out-dir and prints its SHA-256; it never publishes.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { deflateRawSync } from 'node:zlib';

const execFileAsync = promisify(execFile);
// Deliberately a constant, not SOURCE_DATE_EPOCH or the build time: any input that can differ between the
// reviewer's build and the runner's rebuild would change the digest the release gate binds.
export const ZIP_ENTRY_TIME = { year: 2026, month: 1, day: 1, hour: 0, minute: 0, second: 0 };
const ZIP_FILE_MODE = 0o100644;
const DEFLATE_LEVEL = 9;
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

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const dosTime = ({ hour, minute, second }) => (hour << 11) | (minute << 5) | (second >> 1);
const dosDate = ({ year, month, day }) => ((year - 1980) << 9) | (month << 5) | day;
const compareUtf8 = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));

/** Writes a deterministic ZIP (see the header comment). `files` are paths relative to `root`. */
export async function writeReproducibleZip(root, files, outputPath) {
  const names = [...files].sort(compareUtf8);
  if (names.length > 0xffff) throw new Error('Too many entries for a ZIP without ZIP64.');
  const time = dosTime(ZIP_ENTRY_TIME);
  const date = dosDate(ZIP_ENTRY_TIME);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const name of names) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = await readFile(join(root, name));
    const deflated = deflateRawSync(data, { level: DEFLATE_LEVEL });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // no extra field
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by Unix, spec 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    // extra, comment, disk, internal attributes stay 0
    central.writeUInt32LE((ZIP_FILE_MODE << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + body.length;
    if (offset > 0xffffffff) throw new Error('Archive exceeds 4 GiB; ZIP64 is not supported.');
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  await writeFile(outputPath, Buffer.concat([...locals, directory, end]));
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
    const files = await listFiles(bundle);
    const outputName = `${pkg.name}-${pkg.version}.mcpb`;
    const outputPath = join(outDir, outputName);
    await rm(outputPath, { force: true });
    await mkdir(outDir, { recursive: true });
    await writeReproducibleZip(bundle, files, outputPath);
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
