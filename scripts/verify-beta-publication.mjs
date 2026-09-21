#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertBetaMetadata, snapshotDigest, sha256, validateGateManifest } from './beta-release-policy.mjs';
const root = process.cwd();
const [artifact, tag] = process.argv.slice(2);
if (!artifact || !tag) throw new Error('Artifact directory and immutable Beta tag are required.');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
assertBetaMetadata(pkg, tag);
const manifest = JSON.parse(await readFile(join(artifact, 'release-manifest.json'), 'utf8'));
if (manifest.version !== pkg.version || manifest.tarball !== `${pkg.name}-${pkg.version}.tgz`) throw new Error('Artifact identity mismatch.');
if (manifest.releaseNotesSource !== 'released') throw new Error('Finalize the dated public CHANGELOG before release approval.');
const digest = sha256(await readFile(join(artifact, manifest.tarball)));
if (digest !== manifest.sha256) throw new Error('Artifact checksum mismatch.');
validateGateManifest(JSON.parse(await readFile('BETA-RELEASE-GATE.json', 'utf8')), { version: pkg.version, candidateSha256: await snapshotDigest(root), packageSha256: digest });
console.log('Public manifest matches this snapshot and tarball. Private evidence verification is performed before transfer; authorization relies on the protected publication environment.');
