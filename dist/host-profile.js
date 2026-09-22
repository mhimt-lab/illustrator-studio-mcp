import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { illustratorBundleIdentifier, STABLE_ILLUSTRATOR_BUNDLE_ID } from './illustrator-application.js';
const execFileAsync = promisify(execFile);
const defaultExec = async (command, args, options) => {
    const { stdout } = await execFileAsync(command, args, { timeout: options.timeout, maxBuffer: 1024 * 1024 });
    return { stdout: String(stdout) };
};
export const HOST_PROBE_TIMEOUT_MS = 5_000;
const LSAPPINFO_ASN = /^ASN:0x[0-9a-f]+-0x[0-9a-f]+:?$/iu;
export function parseLsappinfoBundleId(output) {
    const match = /"?bundleID"?\s*=\s*"([^"\s]+)"/u.exec(output);
    return match === null ? null : match[1];
}
export function parseScreenLockState(ioregOutput) {
    const observations = [...ioregOutput.matchAll(/(?:CGSSessionScreenIsLocked|IOConsoleLocked)"\s*=\s*(Yes|No)\b/g)]
        .map((match) => match[1]);
    if (observations.includes('Yes'))
        return 'locked';
    if (observations.includes('No'))
        return 'unlocked';
    return 'unknown';
}
export function expectedIllustratorBundleId(application) {
    return illustratorBundleIdentifier(application) ?? STABLE_ILLUSTRATOR_BUNDLE_ID;
}
export class OsascriptHostProfileProbe {
    expectedBundleId;
    exec;
    constructor(expectedBundleId = STABLE_ILLUSTRATOR_BUNDLE_ID, exec = defaultExec) {
        this.expectedBundleId = expectedBundleId;
        this.exec = exec;
    }
    async observe() {
        return this.observeWith(async () => {
            const { stdout } = await this.exec('osascript', [
                '-e',
                'tell application "System Events" to tell first application process whose frontmost is true to return bundle identifier',
            ], { timeout: HOST_PROBE_TIMEOUT_MS });
            return stdout.trim() === '' ? null : stdout.trim();
        });
    }
    async observeForEditSession() {
        return this.observeWith(async () => {
            const front = (await this.exec('lsappinfo', ['front'], { timeout: HOST_PROBE_TIMEOUT_MS })).stdout.trim();
            if (!LSAPPINFO_ASN.test(front))
                return null;
            return parseLsappinfoBundleId((await this.exec('lsappinfo', ['info', '-only', 'bundleid', front], { timeout: HOST_PROBE_TIMEOUT_MS })).stdout);
        });
    }
    async observeWith(frontmost) {
        const observedAt = new Date().toISOString();
        let lockState = 'unknown';
        try {
            lockState = parseScreenLockState((await this.exec('ioreg', ['-n', 'Root', '-d1'], { timeout: HOST_PROBE_TIMEOUT_MS })).stdout);
        }
        catch {
            lockState = 'unknown';
        }
        if (lockState === 'locked') {
            return { profile: 'locked', lockState, frontmostBundleId: null, expectedBundleId: this.expectedBundleId, observedAt };
        }
        if (lockState === 'unknown') {
            return { profile: 'unknown', lockState, frontmostBundleId: null, expectedBundleId: this.expectedBundleId, observedAt };
        }
        let frontmostBundleId = null;
        try {
            frontmostBundleId = await frontmost();
        }
        catch {
            frontmostBundleId = null;
        }
        if (frontmostBundleId === null) {
            return { profile: 'unknown', lockState, frontmostBundleId, expectedBundleId: this.expectedBundleId, observedAt };
        }
        return {
            profile: frontmostBundleId === this.expectedBundleId ? 'foreground' : 'background',
            lockState,
            frontmostBundleId,
            expectedBundleId: this.expectedBundleId,
            observedAt,
        };
    }
}
