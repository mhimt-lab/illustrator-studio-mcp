#!/usr/bin/env node
// Builds the reproducible release artifact for illustrator-studio-mcp.
//
// Output (default `release/`):
//   illustrator-studio-mcp-<version>.tgz  npm pack tarball (local stdio package, no secrets)
//   SHA256SUMS                            sha256 of the tarball, `sha256sum -c` compatible
//   release-manifest.json                 version, tarball name, digest, git commit, file list
//   RELEASE_NOTES.md                      the CHANGELOG.md section for <version>
//
// Every check fails closed: nothing is written when a gate fails, and no fallback masks an error.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REQUIRED_TARBALL_ENTRIES = ['package.json', 'dist/index.js'];
const FORBIDDEN_TARBALL_PREFIXES = ['src/', 'test/', 'scripts/', 'node_modules/', '.github/', '.env'];

export function parseArguments(argv) {
  const options = {
    projectDir: process.cwd(),
    outDir: null,
    skipBuild: false,
    expectTag: null,
    changelog: 'CHANGELOG.md',
    allowUnreleased: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
      index += 1;
      return value;
    };
    switch (argument) {
      case '--project-dir': options.projectDir = resolve(next()); break;
      case '--out-dir': options.outDir = resolve(next()); break;
      case '--skip-build': options.skipBuild = true; break;
      case '--expect-tag': options.expectTag = next(); break;
      case '--changelog': options.changelog = next(); break;
      case '--allow-unreleased': options.allowUnreleased = true; break;
      default: throw new Error(`Unknown argument: ${argument}`);
    }
  }
  options.outDir ??= join(options.projectDir, 'release');
  return options;
}

function emit(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({ event, ...fields })}\n`);
}

export function extractChangelogSection(changelogText, version, { allowUnreleased = false } = {}) {
  const lines = changelogText.split('\n');
  const heading = new RegExp(`^## \\[${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\] - \\d{4}-\\d{2}-\\d{2}$`);
  let start = lines.findIndex((line) => heading.test(line));
  let source = 'released';
  if (start < 0 && allowUnreleased) {
    start = lines.findIndex((line) => line === '## [Unreleased]');
    source = 'unreleased';
  }
  if (start < 0) {
    throw new Error(`CHANGELOG has no released section "## [${version}] - YYYY-MM-DD". Move the Unreleased entries into a dated section before tagging.`);
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith('## ')) { end = index; break; }
  }
  const body = lines.slice(start + 1, end).join('\n').trim();
  if (body.length === 0) throw new Error(`CHANGELOG section "${lines[start]}" is empty.`);
  return { body, source };
}

async function sha256File(path) {
  const hash = createHash('sha256');
  hash.update(await readFile(path));
  return hash.digest('hex');
}

async function runNpmPack(projectDir, destination) {
  await mkdir(destination, { recursive: true });
  const { stdout } = await execFileAsync('npm', ['pack', '--json', '--pack-destination', destination], {
    cwd: projectDir,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, npm_config_loglevel: 'error' },
  });
  const parsed = JSON.parse(stdout);
  if (!Array.isArray(parsed) || parsed.length !== 1) throw new Error('npm pack --json did not return exactly one package.');
  return parsed[0];
}

function validateTarballEntries(files) {
  const names = files.map((entry) => entry.path);
  for (const required of REQUIRED_TARBALL_ENTRIES) {
    if (!names.includes(required)) throw new Error(`Release tarball is missing required entry: ${required}`);
  }
  const leaked = names.filter((name) => FORBIDDEN_TARBALL_PREFIXES.some((prefix) => name.startsWith(prefix)));
  if (leaked.length > 0) throw new Error(`Release tarball contains non-distributable entries: ${leaked.join(', ')}`);
  return names.sort();
}

async function gitCommit(projectDir) {
  try {
    const { stdout: rootStdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: projectDir });
    if (resolve(rootStdout.trim()) !== resolve(projectDir)) return null;
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: projectDir });
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function buildReleaseArtifact(options) {
  const packageJsonPath = join(options.projectDir, 'package.json');
  const manifest = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const { name, version } = manifest;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`package.json version is not a SemVer release version: ${String(version)}`);
  }
  if (options.expectTag !== null && options.expectTag !== `v${version}`) {
    throw new Error(`Tag ${options.expectTag} does not match package.json version v${version}.`);
  }
  if (manifest.bin?.[name] !== 'dist/index.js') {
    throw new Error(`package.json bin.${name} must point to dist/index.js.`);
  }

  if (!options.skipBuild) {
    emit('build_started');
    await execFileAsync('npm', ['run', 'build'], { cwd: options.projectDir, maxBuffer: 16 * 1024 * 1024 });
  }
  const entrypoint = join(options.projectDir, 'dist', 'index.js');
  const entrypointStat = await stat(entrypoint).catch(() => null);
  if (entrypointStat === null || !entrypointStat.isFile()) {
    throw new Error(`Build output ${entrypoint} does not exist. Run npm run build or drop --skip-build.`);
  }

  if (options.expectTag !== null && options.allowUnreleased) {
    throw new Error('--allow-unreleased cannot be combined with --expect-tag: a tagged release needs a dated CHANGELOG section.');
  }
  const releaseNotes = extractChangelogSection(
    await readFile(join(options.projectDir, options.changelog), 'utf8'),
    version,
    { allowUnreleased: options.allowUnreleased },
  );
  emit('release_notes_selected', { source: releaseNotes.source, version });

  const staging = join(tmpdir(), `illustrator-studio-mcp-release-${process.pid}-${Date.now()}`);
  await mkdir(staging, { recursive: true });
  try {
    const first = await runNpmPack(options.projectDir, join(staging, 'first'));
    const firstPath = join(staging, 'first', first.filename);
    const firstDigest = await sha256File(firstPath);
    const second = await runNpmPack(options.projectDir, join(staging, 'second'));
    const secondDigest = await sha256File(join(staging, 'second', second.filename));
    if (first.filename !== second.filename || firstDigest !== secondDigest) {
      throw new Error(`npm pack is not reproducible: ${firstDigest} != ${secondDigest}`);
    }
    if (first.version !== version) throw new Error(`Packed version ${first.version} differs from package.json ${version}.`);
    const files = validateTarballEntries(first.files);

    await mkdir(options.outDir, { recursive: true });
    const tarballPath = join(options.outDir, first.filename);
    await rm(tarballPath, { force: true });
    await rename(firstPath, tarballPath).catch(async (error) => {
      if (error?.code !== 'EXDEV') throw error;
      await writeFile(tarballPath, await readFile(firstPath));
    });
    const checksumLine = `${firstDigest}  ${first.filename}\n`;
    await writeFile(join(options.outDir, 'SHA256SUMS'), checksumLine);
    await writeFile(join(options.outDir, 'RELEASE_NOTES.md'), `${releaseNotes.body}\n`);
    const releaseManifest = {
      name,
      version,
      tag: `v${version}`,
      releaseNotesSource: releaseNotes.source,
      tarball: first.filename,
      sha256: firstDigest,
      unpackedSize: first.unpackedSize,
      entryCount: first.entryCount,
      commit: await gitCommit(options.projectDir),
      files,
    };
    await writeFile(join(options.outDir, 'release-manifest.json'), `${JSON.stringify(releaseManifest, null, 2)}\n`);
    emit('release_artifact_written', { outDir: options.outDir, tarball: first.filename, sha256: firstDigest, version });
    return releaseManifest;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (invokedDirectly) {
  Promise.resolve().then(() => buildReleaseArtifact(parseArguments(process.argv.slice(2)))).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`${JSON.stringify({ event: 'release_artifact_failed', message })}\n`);
    process.exitCode = 1;
  });
}
