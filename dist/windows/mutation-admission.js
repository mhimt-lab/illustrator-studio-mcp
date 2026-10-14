import { WINDOWS_PROFILE_FOREGROUND_SOURCE, WINDOWS_PROFILE_TIMEOUT_MS } from './host-profile.js';
import { parseWindowsForegroundObservation, parseWindowsSessionState } from './observation.js';
import { windowsPowerShellExecutable } from './powershell-runner.js';
const GUIDANCE = {
    locked: 'the Windows session is locked; unlock the console session',
    illustrator_instance_count: 'exactly one Illustrator process must be running',
    not_frontmost: 'Illustrator is not the frontmost window; bring Illustrator to the front (the server cannot activate it)',
    modal_open: 'an Illustrator modal dialog is open; close it before retrying',
    host_state_unknown: 'the host state could not be verified (local console session, one Illustrator with a main window, PowerShell 5.1)',
};
export class WindowsMutationAdmissionError extends Error {
    reason;
    code = 'WINDOWS_MUTATION_ADMISSION_REFUSED';
    constructor(reason, detail) {
        super(`Windows mutation refused before any change (${reason}): ${GUIDANCE[reason]}.${detail ? ` ${detail}` : ''}`);
        this.reason = reason;
        this.name = 'WindowsMutationAdmissionError';
    }
}
const MODAL_METHODS = `
  [DllImport("user32.dll")]
  private static extern bool IsWindowEnabled(IntPtr window);
  [DllImport("user32.dll")]
  private static extern IntPtr GetWindow(IntPtr window, uint command);
  // GW_ENABLEDPOPUP = 6
  public static bool ModalOpen(IntPtr main) { return !IsWindowEnabled(main) || GetWindow(main, 6) != IntPtr.Zero; }
`;
const FOREGROUND_TAIL = /\n\}\n'@\n\$foreground = /u;
export const WINDOWS_MUTATION_ADMISSION_SOURCE = (() => {
    const source = WINDOWS_PROFILE_FOREGROUND_SOURCE.replaceAll('\r\n', '\n');
    const tail = FOREGROUND_TAIL.exec(source);
    if (tail === null)
        throw new Error('Windows foreground helper layout changed; update the admission helper.');
    return `${source.slice(0, tail.index)}${MODAL_METHODS}}
'@
try {
  $flags = [McpWindowsProbe]::SessionFlags()
  $protocol = [McpWindowsProbe]::ClientProtocolType()
} catch { exit 70 }
$foreground = [McpWindowsProbe]::ForegroundImagePath()
$processes = @(Get-Process -Name 'Illustrator' -ErrorAction SilentlyContinue)
$paths = @()
foreach ($process in $processes) { $paths += , [McpWindowsProbe]::ImagePath([uint32]$process.Id) }
$modal = $null
if ($processes.Count -eq 1) {
  $handle = $processes[0].MainWindowHandle
  if ($handle -ne [IntPtr]::Zero) { $modal = [McpWindowsProbe]::ModalOpen($handle) }
}
[Console]::Out.Write((ConvertTo-Json -InputObject ([ordered]@{ SessionFlags = $flags; WTSClientProtocolType = $protocol;
  foregroundExecutablePath = $foreground; illustratorExecutablePaths = $paths; modalOpen = $modal }) -Compress) + [string][char]10)
`;
})();
const KEYS = ['SessionFlags', 'WTSClientProtocolType', 'foregroundExecutablePath', 'illustratorExecutablePaths', 'modalOpen'];
export function decideWindowsMutationAdmission(output, observedAt = new Date().toISOString()) {
    const lines = output.split(/\r?\n/u).filter((line) => line.trim() !== '');
    let value;
    try {
        const parsed = lines.length === 1 ? JSON.parse(lines[0]) : null;
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
            throw new Error('shape');
        value = parsed;
    }
    catch {
        throw new WindowsMutationAdmissionError('host_state_unknown', 'The admission helper output was not one JSON object.');
    }
    const actual = Object.keys(value);
    if (actual.length !== KEYS.length || !KEYS.every((key) => Object.hasOwn(value, key))) {
        throw new WindowsMutationAdmissionError('host_state_unknown', 'The admission helper output had unexpected fields.');
    }
    const lockState = parseWindowsSessionState(JSON.stringify({ SessionFlags: value.SessionFlags, WTSClientProtocolType: value.WTSClientProtocolType }));
    if (lockState === 'locked')
        throw new WindowsMutationAdmissionError('locked');
    if (lockState !== 'unlocked')
        throw new WindowsMutationAdmissionError('host_state_unknown');
    if (!Array.isArray(value.illustratorExecutablePaths))
        throw new WindowsMutationAdmissionError('host_state_unknown');
    if (value.illustratorExecutablePaths.length !== 1) {
        throw new WindowsMutationAdmissionError('illustrator_instance_count', `Observed ${value.illustratorExecutablePaths.length}.`);
    }
    const profile = parseWindowsForegroundObservation(JSON.stringify({
        foregroundExecutablePath: value.foregroundExecutablePath, illustratorExecutablePaths: value.illustratorExecutablePaths,
    }), lockState, observedAt).profile;
    if (profile === 'background')
        throw new WindowsMutationAdmissionError('not_frontmost');
    if (profile !== 'foreground')
        throw new WindowsMutationAdmissionError('host_state_unknown');
    if (value.modalOpen === true)
        throw new WindowsMutationAdmissionError('modal_open');
    if (value.modalOpen !== false)
        throw new WindowsMutationAdmissionError('host_state_unknown', 'The Illustrator main window was not observable.');
}
export async function assertWindowsMutationAdmission(run) {
    const systemRoot = process.env.SystemRoot;
    if (!systemRoot || !/^[A-Za-z]:\\[^\\]/u.test(systemRoot) || systemRoot.includes('\0')) {
        throw new WindowsMutationAdmissionError('host_state_unknown', 'SystemRoot is not an absolute drive path.');
    }
    const outcome = await run(windowsPowerShellExecutable(systemRoot), ['-NoProfile', '-NonInteractive', '-Sta', '-EncodedCommand',
        Buffer.from(WINDOWS_MUTATION_ADMISSION_SOURCE, 'utf16le').toString('base64')], WINDOWS_PROFILE_TIMEOUT_MS);
    if (outcome.kind !== 'exit' || outcome.code !== 0 || outcome.signal !== null) {
        throw new WindowsMutationAdmissionError('host_state_unknown', `Helper outcome: ${outcome.kind === 'exit' ? `exit ${outcome.code}` : outcome.kind}.`);
    }
    decideWindowsMutationAdmission(outcome.stdout);
}
