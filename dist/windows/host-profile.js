import { parseWindowsForegroundObservation, parseWindowsSessionState } from './observation.js';
import { windowsCommandRunner, windowsPowerShellExecutable } from './powershell-runner.js';
import { measureWindowsDuration } from './perf-probe.js';
export const WINDOWS_PROFILE_SESSION_SOURCE = String.raw `$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1 -or [Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') { exit 70 }
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class McpWindowsProbe {
  [DllImport("wtsapi32.dll", SetLastError = true)]
  private static extern bool WTSQuerySessionInformationW(IntPtr server, int sessionId, int infoClass, out IntPtr buffer, out int bytes);
  [DllImport("wtsapi32.dll")]
  private static extern void WTSFreeMemory(IntPtr memory);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  private static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder name, ref uint size);
  [DllImport("kernel32.dll")]
  private static extern bool CloseHandle(IntPtr handle);
  private static IntPtr Query(int infoClass, int minimumBytes) {
    IntPtr buffer; int bytes;
    if (!WTSQuerySessionInformationW(IntPtr.Zero, -1, infoClass, out buffer, out bytes)) throw new System.ComponentModel.Win32Exception();
    if (bytes < minimumBytes) { WTSFreeMemory(buffer); throw new InvalidOperationException("WTS buffer is too short."); }
    return buffer;
  }
  // Same offsets as the PowerShell runner: WTSINFOEXW.Level at 0, WTSINFOEX_LEVEL1_W.SessionFlags at 16.
  public static int SessionFlags() {
    IntPtr buffer = Query(25, 20);
    try {
      if (Marshal.ReadInt32(buffer, 0) != 1) throw new InvalidOperationException("Unexpected WTSINFOEX level.");
      return Marshal.ReadInt32(buffer, 16);
    } finally { WTSFreeMemory(buffer); }
  }
  public static int ClientProtocolType() {
    IntPtr buffer = Query(16, 2);
    try { return Marshal.ReadInt16(buffer, 0); } finally { WTSFreeMemory(buffer); }
  }
  // PROCESS_QUERY_LIMITED_INFORMATION (0x1000); null when the process cannot be opened or named.
  public static string ImagePath(uint processId) {
    IntPtr process = OpenProcess(0x1000, false, processId);
    if (process == IntPtr.Zero) return null;
    try {
      StringBuilder name = new StringBuilder(32768);
      uint size = (uint)name.Capacity;
      return QueryFullProcessImageNameW(process, 0, name, ref size) ? name.ToString(0, (int)size) : null;
    } finally { CloseHandle(process); }
  }
  // Null when there is no foreground window (GetForegroundWindow returns NULL) or its process cannot be named.
  public static string ForegroundImagePath() {
    IntPtr window = GetForegroundWindow();
    if (window == IntPtr.Zero) return null;
    uint processId;
    GetWindowThreadProcessId(window, out processId);
    return processId == 0 ? null : ImagePath(processId);
  }
}
'@
try {
  $flags = [McpWindowsProbe]::SessionFlags()
  $protocol = [McpWindowsProbe]::ClientProtocolType()
} catch { exit 70 }
[Console]::Out.Write('{"SessionFlags":' + $flags + ',"WTSClientProtocolType":' + $protocol + '}' + [string][char]10)
`;
export const WINDOWS_PROFILE_FOREGROUND_SOURCE = String.raw `$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1 -or [Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') { exit 70 }
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class McpWindowsProbe {
  [DllImport("wtsapi32.dll", SetLastError = true)]
  private static extern bool WTSQuerySessionInformationW(IntPtr server, int sessionId, int infoClass, out IntPtr buffer, out int bytes);
  [DllImport("wtsapi32.dll")]
  private static extern void WTSFreeMemory(IntPtr memory);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  private static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder name, ref uint size);
  [DllImport("kernel32.dll")]
  private static extern bool CloseHandle(IntPtr handle);
  private static IntPtr Query(int infoClass, int minimumBytes) {
    IntPtr buffer; int bytes;
    if (!WTSQuerySessionInformationW(IntPtr.Zero, -1, infoClass, out buffer, out bytes)) throw new System.ComponentModel.Win32Exception();
    if (bytes < minimumBytes) { WTSFreeMemory(buffer); throw new InvalidOperationException("WTS buffer is too short."); }
    return buffer;
  }
  // Same offsets as the PowerShell runner: WTSINFOEXW.Level at 0, WTSINFOEX_LEVEL1_W.SessionFlags at 16.
  public static int SessionFlags() {
    IntPtr buffer = Query(25, 20);
    try {
      if (Marshal.ReadInt32(buffer, 0) != 1) throw new InvalidOperationException("Unexpected WTSINFOEX level.");
      return Marshal.ReadInt32(buffer, 16);
    } finally { WTSFreeMemory(buffer); }
  }
  public static int ClientProtocolType() {
    IntPtr buffer = Query(16, 2);
    try { return Marshal.ReadInt16(buffer, 0); } finally { WTSFreeMemory(buffer); }
  }
  // PROCESS_QUERY_LIMITED_INFORMATION (0x1000); null when the process cannot be opened or named.
  public static string ImagePath(uint processId) {
    IntPtr process = OpenProcess(0x1000, false, processId);
    if (process == IntPtr.Zero) return null;
    try {
      StringBuilder name = new StringBuilder(32768);
      uint size = (uint)name.Capacity;
      return QueryFullProcessImageNameW(process, 0, name, ref size) ? name.ToString(0, (int)size) : null;
    } finally { CloseHandle(process); }
  }
  // Null when there is no foreground window (GetForegroundWindow returns NULL) or its process cannot be named.
  public static string ForegroundImagePath() {
    IntPtr window = GetForegroundWindow();
    if (window == IntPtr.Zero) return null;
    uint processId;
    GetWindowThreadProcessId(window, out processId);
    return processId == 0 ? null : ImagePath(processId);
  }
}
'@
$foreground = [McpWindowsProbe]::ForegroundImagePath()
$paths = @()
foreach ($process in @(Get-Process -Name 'Illustrator' -ErrorAction SilentlyContinue)) {
  $paths += , [McpWindowsProbe]::ImagePath([uint32]$process.Id)
}
[Console]::Out.Write((ConvertTo-Json -InputObject ([ordered]@{ foregroundExecutablePath = $foreground; illustratorExecutablePaths = $paths }) -Compress) + [string][char]10)
`;
export const WINDOWS_PROFILE_TIMEOUT_MS = 15_000;
export class WindowsHostProfileProbe {
    run;
    durationObserver;
    constructor(run = windowsCommandRunner, durationObserver) {
        this.run = run;
        this.durationObserver = durationObserver;
    }
    async observe() {
        const observedAt = new Date().toISOString();
        let lockState = 'unknown';
        let foreground = '';
        try {
            const systemRoot = process.env.SystemRoot;
            if (!systemRoot || !/^[A-Za-z]:\\[^\\]/u.test(systemRoot) || systemRoot.includes('\0')) {
                return parseWindowsForegroundObservation('', lockState, observedAt);
            }
            const executable = windowsPowerShellExecutable(systemRoot);
            const observe = async (source) => {
                const outcome = await this.run(executable, ['-NoProfile', '-NonInteractive', '-Sta', '-EncodedCommand',
                    Buffer.from(source, 'utf16le').toString('base64')], WINDOWS_PROFILE_TIMEOUT_MS);
                return outcome.kind === 'exit' && outcome.code === 0 && outcome.signal === null ? outcome.stdout : '';
            };
            lockState = parseWindowsSessionState(await measureWindowsDuration('win.profile.wts', () => observe(WINDOWS_PROFILE_SESSION_SOURCE), this.durationObserver));
            if (lockState === 'unlocked')
                foreground = await measureWindowsDuration('win.profile.foreground', () => observe(WINDOWS_PROFILE_FOREGROUND_SOURCE), this.durationObserver);
        }
        catch { }
        return parseWindowsForegroundObservation(foreground, lockState, observedAt);
    }
}
