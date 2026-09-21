import { describeCommandOutcome } from './command-runner.js';
export const STABLE_ILLUSTRATOR_BUNDLE_ID = 'com.adobe.illustrator';
export const BETA_ILLUSTRATOR_BUNDLE_ID = 'com.adobe.illustratorBeta';
export const STABLE_ILLUSTRATOR_APPLICATION = `id:${STABLE_ILLUSTRATOR_BUNDLE_ID}`;
export const BETA_ILLUSTRATOR_APPLICATION = `id:${BETA_ILLUSTRATOR_BUNDLE_ID}`;
export function illustratorApplicationForm(application) {
    return application.startsWith('id:') ? 'bundle_id' : 'name';
}
export function illustratorBundleIdentifier(application) {
    return application.startsWith('id:') ? application.slice(3) : null;
}
export function illustratorChannel(application) {
    const identifier = illustratorBundleIdentifier(application);
    if (identifier === STABLE_ILLUSTRATOR_BUNDLE_ID)
        return 'stable';
    if (identifier === BETA_ILLUSTRATOR_BUNDLE_ID)
        return 'beta';
    return 'unknown';
}
export function resolveIllustratorApplication(options = {}) {
    const defaultApplication = options.defaultApplication ?? STABLE_ILLUSTRATOR_APPLICATION;
    const flag = normalize(options.flag);
    const env = normalize(options.env);
    const [application, source] = flag !== null ? [flag, 'flag'] : env !== null ? [env, 'env'] : [defaultApplication, 'default'];
    const form = illustratorApplicationForm(application);
    const channel = illustratorChannel(application);
    const warnings = [];
    if (form === 'name') {
        warnings.push(`ILLUSTRATOR_APPLICATION "${application}" is a LaunchServices name; a stable and a Beta install can share it, ` +
            `so the reached version is not fixed by configuration. Prefer "${STABLE_ILLUSTRATOR_APPLICATION}" or "${BETA_ILLUSTRATOR_APPLICATION}".`);
    }
    else if (channel === 'unknown') {
        warnings.push(`Bundle identifier "${application.slice(3)}" is neither the stable nor the Beta Illustrator identifier; version evidence is recorded as channel "unknown".`);
    }
    return { application, form, channel, source, warnings };
}
function normalize(value) {
    if (value === undefined)
        return null;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
}
export function spotlightQueryForApplication(application) {
    const literal = (value) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
    const identifier = illustratorBundleIdentifier(application);
    if (identifier !== null) {
        return `kMDItemCFBundleIdentifier == ${literal(identifier)}`;
    }
    const name = application.endsWith('.app') ? application.slice(0, -4) : application;
    return `kMDItemContentType == "com.apple.application-bundle" && ` +
        `(kMDItemDisplayName == ${literal(name)} || kMDItemFSName == ${literal(`${name}.app`)})`;
}
export function appleScriptApplicationReference(application) {
    const escape = (value) => value.replaceAll('"', '\\"');
    const identifier = illustratorBundleIdentifier(application);
    return identifier !== null ? `application id "${escape(identifier)}"` : `application "${escape(application)}"`;
}
export function illustratorApplicationTarget(application) {
    return {
        application,
        form: illustratorApplicationForm(application),
        channel: illustratorChannel(application),
        bundleId: illustratorBundleIdentifier(application),
    };
}
const RUNNING_PROBE_TIMEOUT_MS = 10_000;
export const RUNNING_APPLICATIONS_APPLESCRIPT = 'tell application "System Events" to get bundle identifier of every application process';
export async function detectRunningIllustratorBundles(runCommand, timeoutMs = RUNNING_PROBE_TIMEOUT_MS) {
    const outcome = await runCommand('/usr/bin/osascript', ['-e', RUNNING_APPLICATIONS_APPLESCRIPT], timeoutMs);
    if (outcome.kind !== 'exit' || outcome.code !== 0) {
        return { status: 'indeterminate', message: `osascript ${describeCommandOutcome(outcome)}` };
    }
    const entries = outcome.stdout.trim().length === 0 ? [] : outcome.stdout.trim().split(',').map((entry) => entry.trim());
    const unidentified = entries.filter((entry) => entry.length === 0 || entry === 'missing value').length;
    if (unidentified > 0) {
        return { status: 'indeterminate', message: `${unidentified} running application process${unidentified === 1 ? '' : 'es'} reported no bundle identifier` };
    }
    return { status: 'ok', bundles: entries.map((bundleId) => ({ bundleId })) };
}
export function nameResolutionAppleScript(name) {
    return `id of application "${name.replaceAll('"', '\\"')}"`;
}
export async function resolveIllustratorNameToBundleId(runCommand, name, timeoutMs = RUNNING_PROBE_TIMEOUT_MS) {
    const outcome = await runCommand('/usr/bin/osascript', ['-e', nameResolutionAppleScript(name)], timeoutMs);
    if (outcome.kind !== 'exit' || outcome.code !== 0)
        return null;
    const identifier = outcome.stdout.trim();
    return /^[A-Za-z0-9.-]+$/.test(identifier) ? identifier : null;
}
export function runningIllustratorChannelBundleIds(bundles) {
    const running = new Set(bundles.map((bundle) => bundle.bundleId));
    return [STABLE_ILLUSTRATOR_BUNDLE_ID, BETA_ILLUSTRATOR_BUNDLE_ID].filter((identifier) => running.has(identifier));
}
export class IllustratorApplicationAmbiguousError extends Error {
    application;
    candidates;
    code = 'application_ambiguous';
    constructor(application, candidates) {
        super(`application_ambiguous: ILLUSTRATOR_APPLICATION "${application}" is a LaunchServices name and both ` +
            `${candidates.join(' and ')} are running, so the reached instance is not fixed. ` +
            `Set ILLUSTRATOR_APPLICATION to "${STABLE_ILLUSTRATOR_APPLICATION}" or "${BETA_ILLUSTRATOR_APPLICATION}" and retry.`);
        this.application = application;
        this.candidates = candidates;
        this.name = 'IllustratorApplicationAmbiguousError';
    }
}
export class IllustratorApplicationUnresolvedError extends Error {
    application;
    code = 'application_unresolved';
    constructor(application) {
        super(`application_unresolved: ILLUSTRATOR_APPLICATION "${application}" is a LaunchServices name, no Illustrator channel is running, ` +
            `and LaunchServices did not resolve the name to a bundle identifier. Set ILLUSTRATOR_APPLICATION to ` +
            `"${STABLE_ILLUSTRATOR_APPLICATION}" or "${BETA_ILLUSTRATOR_APPLICATION}".`);
        this.application = application;
        this.name = 'IllustratorApplicationUnresolvedError';
    }
}
export class IllustratorApplicationProbeError extends Error {
    application;
    code = 'application_probe_indeterminate';
    constructor(application, detail) {
        super(`application_probe_indeterminate: ILLUSTRATOR_APPLICATION "${application}" is a LaunchServices name and the running ` +
            `Illustrator instances could not be listed (${detail}). Set ILLUSTRATOR_APPLICATION to "${STABLE_ILLUSTRATOR_APPLICATION}" ` +
            `or "${BETA_ILLUSTRATOR_APPLICATION}" so the target does not depend on name resolution.`);
        this.application = application;
        this.name = 'IllustratorApplicationProbeError';
    }
}
export async function resolveIllustratorApplicationForCall(target, probes) {
    if (target.form === 'bundle_id' && target.bundleId !== null)
        return { bundleId: target.bundleId, application: target.application };
    const result = await probes.running();
    if (result.status !== 'ok')
        throw new IllustratorApplicationProbeError(target.application, result.message);
    const channels = runningIllustratorChannelBundleIds(result.bundles);
    if (channels.length > 1)
        throw new IllustratorApplicationAmbiguousError(target.application, channels);
    const bundleId = channels.length === 1 ? channels[0] : await probes.resolveName(target.application);
    if (bundleId === null)
        throw new IllustratorApplicationUnresolvedError(target.application);
    return { bundleId, application: `id:${bundleId}` };
}
export async function assertIllustratorApplicationUnambiguous(target, probe) {
    if (target.form !== 'name')
        return;
    const result = await probe();
    if (result.status !== 'ok')
        throw new IllustratorApplicationProbeError(target.application, result.message);
    const channels = runningIllustratorChannelBundleIds(result.bundles);
    if (channels.length > 1)
        throw new IllustratorApplicationAmbiguousError(target.application, channels);
}
