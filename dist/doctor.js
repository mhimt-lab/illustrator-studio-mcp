import { constants } from 'node:fs';
import { access, lstat, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { defaultStateRoot } from './command-store.js';
import { appleScriptApplicationReference, BETA_ILLUSTRATOR_APPLICATION, detectRunningIllustratorBundles, illustratorApplicationTarget, resolveIllustratorApplication, runningIllustratorChannelBundleIds, spotlightQueryForApplication, STABLE_ILLUSTRATOR_APPLICATION, } from './illustrator-application.js';
import { defaultCommandRunner, describeCommandOutcome } from './command-runner.js';
import { summarizeEditSessionRecords } from './edit-session.js';
import { validatePrivateDirectory } from './private-state.js';
import { quarantineArea } from './state-quarantine.js';
export { spotlightQueryForApplication } from './illustrator-application.js';
export const DOCTOR_REPORT_VERSION = 1;
export const MINIMUM_NODE_MAJOR = 20;
export { defaultCommandRunner } from './command-runner.js';
export const APPLE_EVENT_PROBE_TIMEOUT_MS = 15_000;
const SHORT_COMMAND_TIMEOUT_MS = 10_000;
const MAX_BUNDLE_CANDIDATES = 5;
const SIGNING_RECORD_FILES = ['cursor-signing-state.v1', 'cursor-signing-key.v1'];
const LOCK_FILE = 'active-command.lock';
export function defaultDoctorEnvironment() {
    return {
        platform: process.platform,
        nodeVersion: process.versions.node,
        application: resolveIllustratorApplication({ env: process.env.ILLUSTRATOR_APPLICATION }).application,
        stateRoot: defaultStateRoot(),
        uid: typeof process.getuid === 'function' ? process.getuid() : undefined,
        runCommand: defaultCommandRunner,
    };
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
const describeOutcome = describeCommandOutcome;
export function checkNodeRuntime(nodeVersion) {
    const major = Number.parseInt(nodeVersion.split('.')[0] ?? '', 10);
    const evidence = { nodeVersion, minimumMajor: MINIMUM_NODE_MAJOR };
    if (!Number.isInteger(major)) {
        return {
            id: 'node_runtime', status: 'indeterminate', evidence,
            summary: `Node.js version string "${nodeVersion}" could not be parsed.`,
            recommendation: `Run the server with Node.js ${MINIMUM_NODE_MAJOR} or newer.`,
        };
    }
    if (major < MINIMUM_NODE_MAJOR) {
        return {
            id: 'node_runtime', status: 'fail', evidence,
            summary: `Node.js ${nodeVersion} is older than the required major ${MINIMUM_NODE_MAJOR}.`,
            recommendation: `Install Node.js ${MINIMUM_NODE_MAJOR} or newer and point the MCP client's "command" at that binary.`,
        };
    }
    return { id: 'node_runtime', status: 'pass', evidence, summary: `Node.js ${nodeVersion} satisfies >=${MINIMUM_NODE_MAJOR}.` };
}
export async function checkMacosPlatform(environment) {
    if (environment.platform !== 'darwin') {
        return {
            id: 'macos_platform', status: 'fail',
            evidence: { platform: environment.platform },
            summary: `Platform "${environment.platform}" is not macOS.`,
            recommendation: 'The osascript bridge supports macOS only. Run the server on the Mac that hosts Illustrator.',
        };
    }
    const outcome = await environment.runCommand('/usr/bin/sw_vers', ['-productVersion'], SHORT_COMMAND_TIMEOUT_MS);
    if (outcome.kind !== 'exit' || outcome.code !== 0) {
        return {
            id: 'macos_platform', status: 'indeterminate',
            evidence: { platform: 'darwin', productVersion: null },
            summary: `macOS version could not be read: sw_vers ${describeOutcome(outcome)}.`,
            recommendation: 'Confirm the macOS version manually with "sw_vers -productVersion".',
        };
    }
    const productVersion = outcome.stdout.trim();
    return {
        id: 'macos_platform', status: 'pass',
        evidence: { platform: 'darwin', productVersion },
        summary: `macOS ${productVersion}.`,
    };
}
async function readPlistString(environment, bundlePath, key) {
    const outcome = await environment.runCommand('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', join(bundlePath, 'Contents', 'Info.plist')], SHORT_COMMAND_TIMEOUT_MS);
    if (outcome.kind !== 'exit' || outcome.code !== 0)
        return null;
    const value = outcome.stdout.trim();
    return value.length === 0 ? null : value;
}
export async function findIllustratorBundles(environment) {
    const outcome = await environment.runCommand('/usr/bin/mdfind', [spotlightQueryForApplication(environment.application)], SHORT_COMMAND_TIMEOUT_MS);
    if (outcome.kind !== 'exit' || outcome.code !== 0) {
        return { kind: 'error', message: `mdfind ${describeOutcome(outcome)}${outcome.kind === 'exit' && outcome.stderr.trim() ? `: ${outcome.stderr.trim()}` : ''}` };
    }
    const paths = outcome.stdout.split('\n').map((line) => line.trim()).filter((line) => line.endsWith('.app'));
    const bundles = [];
    for (const path of paths.slice(0, MAX_BUNDLE_CANDIDATES)) {
        bundles.push({
            path,
            bundleIdentifier: await readPlistString(environment, path, 'CFBundleIdentifier'),
            shortVersion: await readPlistString(environment, path, 'CFBundleShortVersionString'),
            executable: await readPlistString(environment, path, 'CFBundleExecutable'),
        });
    }
    return { kind: 'found', bundles };
}
export function checkIllustratorBundle(application, lookup) {
    if (lookup.kind === 'error') {
        return {
            id: 'illustrator_bundle', status: 'indeterminate',
            evidence: { application, candidates: [] },
            summary: `Illustrator bundle lookup failed: ${lookup.message}.`,
            recommendation: 'Spotlight (mdfind) must be available and indexing /Applications. Verify the Illustrator install path manually.',
        };
    }
    const candidates = lookup.bundles.map((bundle) => bundle.path);
    const versions = lookup.bundles.map((bundle) => bundle.shortVersion ?? 'unknown');
    const identifiers = lookup.bundles.map((bundle) => bundle.bundleIdentifier ?? 'unknown');
    const evidence = { application, candidates, bundleIdentifiers: identifiers, versions };
    if (lookup.bundles.length === 0) {
        return {
            id: 'illustrator_bundle', status: 'fail', evidence,
            summary: `No application bundle matches ILLUSTRATOR_APPLICATION "${application}".`,
            recommendation: 'Install Adobe Illustrator, or set ILLUSTRATOR_APPLICATION to the installed app name or "id:<bundle identifier>" (see docs/setup.md).',
        };
    }
    const [first] = lookup.bundles;
    if (lookup.bundles.length > 1) {
        return {
            id: 'illustrator_bundle', status: 'indeterminate', evidence,
            summary: `${lookup.bundles.length} bundles match "${application}"; LaunchServices decides which one receives Apple events.`,
            recommendation: 'Keep a single Illustrator install per identifier, or confirm which bundle the bridge reaches by comparing the apple_event_read_only version with the intended install.',
        };
    }
    return {
        id: 'illustrator_bundle', status: 'pass', evidence,
        summary: `${first?.path ?? ''} (${first?.bundleIdentifier ?? 'unknown id'} ${first?.shortVersion ?? 'unknown version'}).`,
    };
}
export async function checkIllustratorProcess(environment, bundles) {
    const targets = bundles.length > 0
        ? bundles.map((bundle) => ({ path: bundle.path, pattern: `^${escapeRegex(join(bundle.path, 'Contents', 'MacOS', bundle.executable ?? 'Adobe Illustrator'))}$` }))
        : [{ path: null, pattern: `^/.*/${escapeRegex(environment.application.startsWith('id:') ? 'Adobe Illustrator' : environment.application)}(\\.app)?/Contents/MacOS/[^/]+$` }];
    const patterns = targets.map((target) => target.pattern);
    const matchedPids = [];
    const runningBundles = [];
    for (const target of targets) {
        const outcome = await environment.runCommand('/usr/bin/pgrep', ['-f', target.pattern], SHORT_COMMAND_TIMEOUT_MS);
        if (outcome.kind === 'exit' && outcome.code === 0) {
            matchedPids.push(...outcome.stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0));
            if (target.path !== null)
                runningBundles.push(target.path);
        }
        else if (outcome.kind !== 'exit' || outcome.code !== 1) {
            return {
                id: 'illustrator_process', status: 'indeterminate', running: false,
                evidence: { patterns, pids: [], runningBundles: [] },
                summary: `Process lookup failed: pgrep ${describeOutcome(outcome)}.`,
                recommendation: 'Check whether Illustrator is running from the Dock or Activity Monitor, then rerun the doctor.',
            };
        }
    }
    if (matchedPids.length === 0) {
        return {
            id: 'illustrator_process', status: 'skip', running: false,
            evidence: { patterns, pids: [], runningBundles: [] },
            summary: 'Illustrator is not running; the doctor never launches it.',
            recommendation: 'Start Illustrator manually and rerun the doctor to exercise the Apple event permission.',
        };
    }
    return {
        id: 'illustrator_process', status: 'pass', running: true,
        evidence: { patterns, pids: matchedPids, runningBundles },
        summary: runningBundles.length > 0
            ? `Illustrator is running: ${runningBundles.join(', ')} (pid ${matchedPids.join(', ')}).`
            : `Illustrator is running (pid ${matchedPids.join(', ')}).`,
    };
}
function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
export async function checkIllustratorConcurrentChannels(environment) {
    const target = illustratorApplicationTarget(environment.application);
    const detected = await detectRunningIllustratorBundles(environment.runCommand, SHORT_COMMAND_TIMEOUT_MS);
    if (detected.status !== 'ok' && target.form === 'bundle_id') {
        return {
            id: 'illustrator_concurrent_channels', status: 'pass',
            evidence: { application: environment.application, form: target.form, runningBundleIdentifiers: [] },
            summary: `The bundle identifier target "${environment.application}" pins which instance receives Apple events, so other running Illustrator channels do not matter (the running instances could not be listed: ${detected.message}).`,
        };
    }
    if (detected.status !== 'ok') {
        return {
            id: 'illustrator_concurrent_channels', status: 'indeterminate',
            evidence: { application: environment.application, form: target.form, runningBundleIdentifiers: [] },
            summary: `Running Illustrator instances could not be listed: ${detected.message}.`,
            recommendation: 'System Events must be allowed to list application processes (Automation permission); check Activity Monitor for "Adobe Illustrator" and "Adobe Illustrator (Beta)", then rerun the doctor.',
        };
    }
    const channels = runningIllustratorChannelBundleIds(detected.bundles);
    const evidence = {
        application: environment.application, form: target.form,
        runningBundleIdentifiers: channels,
        runningApplicationCount: detected.bundles.length,
    };
    if (channels.length > 1 && target.form === 'name') {
        return {
            id: 'illustrator_concurrent_channels', status: 'fail', evidence,
            summary: `Stable and Beta Illustrator are both running (${channels.join(', ')}) and ILLUSTRATOR_APPLICATION "${environment.application}" is a name; tool calls are refused as application_ambiguous.`,
            recommendation: `Set ILLUSTRATOR_APPLICATION to "${STABLE_ILLUSTRATOR_APPLICATION}" or "${BETA_ILLUSTRATOR_APPLICATION}", or quit one of the two instances.`,
        };
    }
    if (channels.length > 1) {
        return {
            id: 'illustrator_concurrent_channels', status: 'pass', evidence,
            summary: `Stable and Beta Illustrator are both running (${channels.join(', ')}); the bundle identifier target "${environment.application}" pins which one receives Apple events.`,
        };
    }
    return {
        id: 'illustrator_concurrent_channels', status: 'pass', evidence,
        summary: channels.length === 1
            ? `One Illustrator channel is running (${channels[0]}).`
            : 'Stable and Beta Illustrator are not running together.',
    };
}
export function appleEventProbeScript(application) {
    const reference = appleScriptApplicationReference(application);
    return `tell ${reference} to get version`;
}
export function classifyAppleEventFailure(stderr) {
    const text = stderr.trim();
    if (/-1743\b/.test(text) || /not authori[sz]ed to send apple events/i.test(text)) {
        return {
            status: 'fail',
            summary: 'macOS denied Apple events from this process to Illustrator (error -1743).',
            recommendation: 'Open System Settings > Privacy & Security > Automation and allow the terminal or MCP client process to control Illustrator, then rerun the doctor.',
        };
    }
    if (/-1712\b/.test(text) || /timed out/i.test(text)) {
        return {
            status: 'indeterminate',
            summary: 'Illustrator did not answer the Apple event before the AppleScript timeout (error -1712).',
            recommendation: 'Dismiss any modal dialog in Illustrator, make sure the screen is unlocked, and rerun the doctor.',
        };
    }
    if (/-600\b|-609\b|-10810\b/.test(text)) {
        return {
            status: 'fail',
            summary: `Illustrator process could not be reached: ${text}.`,
            recommendation: 'Confirm Illustrator finished launching and is not quitting or crashed, then rerun the doctor.',
        };
    }
    return {
        status: 'fail',
        summary: `osascript reported: ${text || 'no error text'}.`,
        recommendation: 'Run the reported AppleScript manually with osascript to see the full error, and confirm ILLUSTRATOR_APPLICATION names the intended install.',
    };
}
export async function checkAppleEventReadOnly(environment, illustratorRunning) {
    const script = appleEventProbeScript(environment.application);
    const evidence = { script, timeoutMs: APPLE_EVENT_PROBE_TIMEOUT_MS };
    if (!illustratorRunning) {
        return {
            id: 'apple_event_read_only', status: 'skip', evidence,
            summary: 'Skipped because Illustrator is not running; sending an Apple event now would launch it.',
            recommendation: 'Start Illustrator manually and rerun the doctor.',
        };
    }
    const outcome = await environment.runCommand('/usr/bin/osascript', ['-e', script], APPLE_EVENT_PROBE_TIMEOUT_MS);
    if (outcome.kind === 'timeout') {
        return {
            id: 'apple_event_read_only', status: 'indeterminate', evidence,
            summary: `osascript did not return within ${APPLE_EVENT_PROBE_TIMEOUT_MS} ms; a locked screen, a modal dialog, or a pending permission prompt can hold the reply.`,
            recommendation: 'Unlock the screen, answer any Automation permission prompt or Illustrator dialog, then rerun the doctor.',
        };
    }
    if (outcome.kind === 'spawn_error') {
        return {
            id: 'apple_event_read_only', status: 'indeterminate', evidence,
            summary: `osascript could not be started (${outcome.message}).`,
            recommendation: 'Confirm /usr/bin/osascript exists and is executable.',
        };
    }
    if (outcome.code !== 0) {
        const classified = classifyAppleEventFailure(outcome.stderr);
        return { id: 'apple_event_read_only', ...classified, evidence: { ...evidence, exitCode: outcome.code, stderr: outcome.stderr.trim() } };
    }
    const version = outcome.stdout.trim();
    return {
        id: 'apple_event_read_only', status: 'pass',
        evidence: { ...evidence, version },
        summary: `Illustrator answered a read-only Apple event (version ${version}).`,
    };
}
async function pathIsWritable(path) {
    try {
        await access(path, constants.W_OK | constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
async function describeSigningRecord(path, uid) {
    let metadata;
    try {
        metadata = await lstat(path);
    }
    catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
            return { present: false };
        return { present: true, problem: `could not be inspected (${errorMessage(error)})`, mode: 'unknown' };
    }
    const mode = (metadata.mode & 0o7777).toString(8).padStart(4, '0');
    if (metadata.isSymbolicLink())
        return { present: true, problem: 'is a symbolic link', mode };
    if (!metadata.isFile())
        return { present: true, problem: 'is not a regular file', mode };
    if (uid !== undefined && metadata.uid !== uid)
        return { present: true, problem: 'is not owned by the current user', mode };
    if ((metadata.mode & 0o7777) !== 0o600)
        return { present: true, problem: `has mode ${mode} instead of 0600`, mode };
    return { present: true, problem: null, mode };
}
export async function checkStateRoot(environment) {
    const root = environment.stateRoot;
    const evidence = { stateRoot: root };
    const recovery = 'Do not chmod or delete anything while a server may be running. Follow the maintenance steps in docs/setup.md (Local state and cursor keys).';
    let exists = true;
    try {
        await lstat(root);
    }
    catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
            exists = false;
        else {
            return {
                id: 'state_root', status: 'indeterminate', evidence: { ...evidence, exists: null },
                summary: `State root could not be inspected (${errorMessage(error)}).`,
                recommendation: 'Confirm the path in ILLUSTRATOR_STUDIO_MCP_STATE_DIR is reachable by this user.',
            };
        }
    }
    evidence.exists = exists;
    if (!exists) {
        const parent = dirname(root);
        const parentWritable = await pathIsWritable(parent);
        evidence.parent = parent;
        evidence.parentWritable = parentWritable;
        if (!parentWritable) {
            return {
                id: 'state_root', status: 'fail', evidence,
                summary: `State root does not exist and its parent ${parent} is not writable, so the server cannot create it.`,
                recommendation: 'Create the parent directory as the current user, or point ILLUSTRATOR_STUDIO_MCP_STATE_DIR at a writable private location.',
            };
        }
        return {
            id: 'state_root', status: 'pass', evidence,
            summary: 'State root does not exist yet; the server creates it with mode 0700 on first use.',
        };
    }
    try {
        await validatePrivateDirectory(root, 0o700, 'state root');
    }
    catch (error) {
        return {
            id: 'state_root', status: 'fail', evidence,
            summary: errorMessage(error),
            recommendation: recovery,
        };
    }
    const writable = await pathIsWritable(root);
    evidence.writable = writable;
    if (!writable) {
        return {
            id: 'state_root', status: 'fail', evidence,
            summary: 'State root exists with the expected owner and mode but is not writable by this process.',
            recommendation: 'Check filesystem permissions, read-only mounts, or sandbox restrictions for the state root.',
        };
    }
    const records = await Promise.all(SIGNING_RECORD_FILES.map((file) => describeSigningRecord(join(root, file), environment.uid)));
    const presentCount = records.filter((record) => record.present).length;
    evidence.signingRecordsPresent = presentCount;
    const problems = records.flatMap((record, index) => record.present && record.problem !== null ? [`${SIGNING_RECORD_FILES[index]} ${record.problem}`] : []);
    if (problems.length > 0) {
        return {
            id: 'state_root', status: 'fail', evidence: { ...evidence, signingRecordProblems: problems },
            summary: `Signing record anomaly: ${problems.join('; ')}.`,
            recommendation: recovery,
        };
    }
    if (presentCount === 1) {
        return {
            id: 'state_root', status: 'fail', evidence,
            summary: 'Only one of the two cursor signing records exists; the pair must be present together or absent together.',
            recommendation: recovery,
        };
    }
    let lockPresent = false;
    try {
        await lstat(join(root, LOCK_FILE));
        lockPresent = true;
    }
    catch {
        lockPresent = false;
    }
    evidence.activeCommandLockPresent = lockPresent;
    let editSessionsInvalid = 0;
    try {
        const sessions = await summarizeEditSessionRecords(root);
        evidence.editSessionsOpen = sessions.open;
        evidence.editSessionsSuspended = sessions.suspended;
        evidence.editSessionsClosed = sessions.closed;
        evidence.editSessionsInvalid = editSessionsInvalid = sessions.invalid;
    }
    catch (error) {
        evidence.editSessionsInvalid = null;
        evidence.editSessionsError = errorMessage(error);
    }
    for (const [kind, key] of [['commands', 'quarantinedCommands'], ['edit-sessions', 'quarantinedEditSessions']]) {
        try {
            evidence[key] = (await readdir(quarantineArea(root, kind).area)).filter((name) => /^[^.]+\.json$/u.test(name)).length;
        }
        catch (error) {
            evidence[key] = typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT' ? 0 : null;
        }
    }
    return {
        id: 'state_root', status: 'pass', evidence,
        summary: presentCount === 0
            ? 'State root is private (0700), writable, and not yet initialized for cursor signing.'
            : 'State root is private (0700), writable, and holds a complete cursor signing record pair.',
        ...(lockPresent ? { recommendation: 'An active-command lock exists. If no server is running, reconcile the recorded command with illustrator_reconcile before new mutations.' } : {}),
        ...(!lockPresent && editSessionsInvalid > 0 ? { recommendation: `${editSessionsInvalid} edit session record(s) under edit-sessions/ are unreadable and are left as is; they refuse every new edit session.` } : {}),
    };
}
export function resolveBundleByAppleEventVersion(bundleCheck, bundles, appleEvent) {
    if (appleEvent.status !== 'pass' || bundles.length === 0)
        return;
    const version = appleEvent.evidence.version;
    if (typeof version !== 'string')
        return;
    const matches = bundles.filter((bundle) => bundle.shortVersion === version);
    if (matches.length !== 1)
        return;
    const [resolved] = matches;
    if (resolved === undefined)
        return;
    bundleCheck.evidence.resolvedByAppleEventVersion = resolved.path;
    if (bundleCheck.status !== 'indeterminate')
        return;
    bundleCheck.status = 'pass';
    bundleCheck.summary = `${bundles.length} bundles match the application name; Apple events reached ${resolved.path} (${resolved.bundleIdentifier ?? 'unknown id'} ${version}).`;
    bundleCheck.recommendation = `If that is not the intended install, set ILLUSTRATOR_APPLICATION to "id:<bundle identifier>" so the choice no longer depends on LaunchServices name resolution.`;
}
export async function runDoctor(environment = defaultDoctorEnvironment()) {
    const checks = [];
    checks.push(checkNodeRuntime(environment.nodeVersion));
    const platform = await checkMacosPlatform(environment);
    checks.push(platform);
    let running = false;
    if (platform.status === 'fail') {
        const skipped = 'Skipped because the platform is not macOS.';
        checks.push({ id: 'illustrator_bundle', status: 'skip', evidence: {}, summary: skipped });
        checks.push({ id: 'illustrator_process', status: 'skip', evidence: {}, summary: skipped });
        checks.push({ id: 'illustrator_concurrent_channels', status: 'skip', evidence: {}, summary: skipped });
        checks.push({ id: 'apple_event_read_only', status: 'skip', evidence: {}, summary: skipped });
    }
    else {
        const lookup = await findIllustratorBundles(environment);
        const bundles = lookup.kind === 'found' ? lookup.bundles : [];
        const bundleCheck = checkIllustratorBundle(environment.application, lookup);
        checks.push(bundleCheck);
        const process = await checkIllustratorProcess(environment, bundles);
        running = process.running;
        const { running: _running, ...processCheck } = process;
        checks.push(processCheck);
        checks.push(await checkIllustratorConcurrentChannels(environment));
        const appleEvent = await checkAppleEventReadOnly(environment, running);
        checks.push(appleEvent);
        resolveBundleByAppleEventVersion(bundleCheck, bundles, appleEvent);
    }
    checks.push(await checkStateRoot(environment));
    return {
        version: DOCTOR_REPORT_VERSION,
        generatedAt: new Date().toISOString(),
        application: environment.application,
        stateRoot: environment.stateRoot,
        checks,
        ok: checks.every((check) => check.status === 'pass' || check.status === 'skip'),
    };
}
export function doctorExitCode(report) {
    if (report.checks.some((check) => check.status === 'fail'))
        return 1;
    if (report.checks.some((check) => check.status === 'indeterminate'))
        return 2;
    return 0;
}
export function formatDoctorReport(report) {
    const label = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP', indeterminate: 'INDET' };
    const lines = [
        `illustrator-studio-mcp doctor (application: ${report.application})`,
        `state root: ${report.stateRoot}`,
        '',
    ];
    for (const check of report.checks) {
        lines.push(`[${label[check.status].padEnd(5)}] ${check.id}: ${check.summary}`);
        if (check.recommendation !== undefined)
            lines.push(`        -> ${check.recommendation}`);
    }
    lines.push('');
    lines.push(report.ok
        ? 'Result: ready. No repair was performed.'
        : 'Result: attention needed. No repair was performed; follow the recommendations above.');
    return `${lines.join('\n')}\n`;
}
