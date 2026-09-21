import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export const PUBLIC_REPO = 'mhimt-lab/illustrator-studio-mcp';
export const PUBLIC_NAME = 'mhimt';
export const PUBLIC_EMAIL = 'sporks-framer9t@icloud.com';
export const REQUIRED_BETA_CHECKS = [
  'lint', 'build', 'tests', 'publicAudit', 'packageReproducibility', 'isolatedInstall',
  'doctor', 'stdio', 'liveEvidence', 'rightsReview', 'privateReporting',
  'claudeCode', 'claudeDesktop', 'codexCli',
];
// Owner decision (2026-09-21) for 0.1.0-beta.1: Codex CLI was verified for connection, approval,
// discovery, reads, save and a clean backup, but not for plan/apply and later steps. Only these checks
// may carry an explicit "partial" status backed by evidence; every other check must pass.
export const PARTIAL_ALLOWED_BETA_CHECKS = ['codexCli'];
export const checkStatusAllowed = (key, status) => status === 'pass' || (status === 'partial' && PARTIAL_ALLOWED_BETA_CHECKS.includes(key));
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function assertBetaMetadata(pkg, tag = `v${pkg.version}`) {
  if (!/^0\.1\.0-beta\.[1-9]\d*$/.test(pkg.version) || tag !== `v${pkg.version}`) throw new Error('Beta version and tag must match.');
  if (pkg.publishConfig?.tag !== 'beta') throw new Error('Beta distribution must use the beta dist-tag.');
  if (pkg.license !== 'BUSL-1.1' || pkg.author?.name !== PUBLIC_NAME || pkg.author?.email !== PUBLIC_EMAIL) throw new Error('Public license or identity mismatch.');
  if (pkg.repository?.url !== `git+https://github.com/${PUBLIC_REPO}.git`) throw new Error('Public repository mismatch.');
}

// Approval is excluded to avoid a circular digest. Git administrative data is never a release file.
// Modes matter for the executable entrypoint; npm's installation gate checks its installed mode.
export async function snapshotManifest(root, prefix = '') {
  const files = [];
  for (const entry of (await readdir(join(root, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if (!prefix && (entry.name === '.git' || entry.name === 'BETA-RELEASE-GATE.json')) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await snapshotManifest(root, path));
    else if (entry.isFile()) files.push({ path, sha256: sha256(await readFile(join(root, path))) });
    else throw new Error('Snapshot contains a symlink or non-regular entry.');
  }
  return files;
}
export async function snapshotDigest(root) { return sha256(JSON.stringify(await snapshotManifest(root))); }

export function validateGateManifest(gate, expected) {
  const errors = [];
  const allowed = ['schema', 'decision', 'reviewer', 'version', 'candidateSha256', 'packageSha256', 'distTag', 'prerelease', 'checks'];
  if (!gate || Object.keys(gate).some(key => !allowed.includes(key))) errors.push('unexpected gate fields');
  if (Object.keys(gate?.checks ?? {}).some(key => !REQUIRED_BETA_CHECKS.includes(key))) errors.push('unexpected checks');
  if (gate?.schema !== 1 || gate?.decision !== 'ready' || gate?.reviewer !== PUBLIC_NAME) errors.push('review decision');
  for (const key of ['version', 'candidateSha256', 'packageSha256']) {
    if (typeof expected[key] !== 'string' || gate?.[key] !== expected[key]) errors.push(key);
  }
  for (const key of REQUIRED_BETA_CHECKS) {
    const row = gate?.checks?.[key];
    if (Object.keys(row ?? {}).some(field => !['status', 'evidenceSha256'].includes(field))) errors.push(`${key} unexpected fields`);
    if (!checkStatusAllowed(key, row?.status) || !/^[a-f0-9]{64}$/.test(row?.evidenceSha256 ?? '') || /^0+$/.test(row.evidenceSha256)) errors.push(key);
  }
  if (gate?.distTag !== 'beta' || gate?.prerelease !== true) errors.push('Beta distribution policy');
  if (errors.length) throw new Error(`Beta release gate is not satisfied: ${errors.join(', ')}`);
  return true;
}
