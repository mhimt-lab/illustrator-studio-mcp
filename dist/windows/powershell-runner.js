import { execFile } from 'node:child_process';
import { WINDOWS_RUNNER_EXIT as EXIT, WINDOWS_RUNNER_STDERR_TOKEN as TOKEN } from './runner-exit-codes.js';
const SESSION_TYPE = [
    "Add-Type -TypeDefinition @'",
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class McpWindowsSession {',
    '  [DllImport("wtsapi32.dll", SetLastError = true)]',
    '  private static extern bool WTSQuerySessionInformationW(IntPtr server, int sessionId, int infoClass, out IntPtr buffer, out int bytes);',
    '  [DllImport("wtsapi32.dll")]',
    '  private static extern void WTSFreeMemory(IntPtr memory);',
    '  private static IntPtr Query(int infoClass, int minimumBytes) {',
    '    IntPtr buffer; int bytes;',
    '    if (!WTSQuerySessionInformationW(IntPtr.Zero, -1, infoClass, out buffer, out bytes)) throw new System.ComponentModel.Win32Exception();',
    '    if (bytes < minimumBytes) { WTSFreeMemory(buffer); throw new InvalidOperationException("WTS buffer is too short."); }',
    '    return buffer;',
    '  }',
    '  // WTSSessionInfoEx (25): WTSINFOEXW.Level (DWORD) at 0; the union is 8-aligned, so WTSINFOEX_LEVEL1_W.SessionFlags (LONG) is at 16.',
    '  public static int SessionFlags() {',
    '    IntPtr buffer = Query(25, 20);',
    '    try {',
    '      if (Marshal.ReadInt32(buffer, 0) != 1) throw new InvalidOperationException("Unexpected WTSINFOEX level.");',
    '      return Marshal.ReadInt32(buffer, 16);',
    '    } finally { WTSFreeMemory(buffer); }',
    '  }',
    '  // WTSClientProtocolType (16): USHORT, 0 for the console session.',
    '  public static int ClientProtocolType() {',
    '    IntPtr buffer = Query(16, 2);',
    '    try { return Marshal.ReadInt16(buffer, 0); } finally { WTSFreeMemory(buffer); }',
    '  }',
    '}',
    "'@",
];
const RUNNER_LINES = [
    '# illustrator-studio-mcp Windows runner. Fixed text: values arrive only as positional arguments.',
    "$ErrorActionPreference = 'Stop'",
    'Set-StrictMode -Version 2.0',
    'function Stop-McpRunner([int]$Code, [string]$Line) {',
    '  [Console]::Error.WriteLine($Line)',
    '  [Console]::Error.Flush()',
    '  exit $Code',
    '}',
    `if ($args.Count -ne 2) { exit ${EXIT.goNonceMismatch} }`,
    '$nonce = [string]$args[0]',
    '$jsxPath = [string]$args[1]',
    `if ($nonce -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') { exit ${EXIT.goNonceMismatch} }`,
    `if ($jsxPath.Length -eq 0) { exit ${EXIT.goNonceMismatch} }`,
    ...SESSION_TYPE,
    '$creationTime = [Diagnostics.Process]::GetCurrentProcess().StartTime.ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture)',
    '[Console]::Out.Write("ready $nonce $PID $creationTime`n")',
    '[Console]::Out.Flush()',
    '$go = [Console]::In.ReadLine()',
    `if ($go -cne "go $nonce") { Stop-McpRunner ${EXIT.goNonceMismatch} '${TOKEN.goNonceMismatch}' }`,
    '# MCP_TRACE go_received',
    'try {',
    '  $sessionFlags = [McpWindowsSession]::SessionFlags()',
    '  $clientProtocol = [McpWindowsSession]::ClientProtocolType()',
    `} catch { Stop-McpRunner ${EXIT.sessionUnknown} '${TOKEN.sessionUnknown}' }`,
    `if ($clientProtocol -ne 0) { Stop-McpRunner ${EXIT.sessionUnknown} '${TOKEN.sessionUnknown}' }`,
    `if ($sessionFlags -eq 0) { Stop-McpRunner ${EXIT.sessionLocked} '${TOKEN.sessionLocked}' }`,
    `if ($sessionFlags -ne 1) { Stop-McpRunner ${EXIT.sessionUnknown} '${TOKEN.sessionUnknown}' }`,
    "try { $illustrators = @(Get-Process -Name 'Illustrator' -ErrorAction Stop) } catch {",
    `  Stop-McpRunner ${EXIT.illustratorNotSingle} '${TOKEN.illustratorNotSingle}'`,
    '}',
    `if ($illustrators.Count -ne 1) { Stop-McpRunner ${EXIT.illustratorNotSingle} '${TOKEN.illustratorNotSingle}' }`,
    '# MCP_TRACE com_begin',
    "try { $application = [Runtime.InteropServices.Marshal]::GetActiveObject('Illustrator.Application') } catch {",
    `  Stop-McpRunner ${EXIT.activeObjectUnavailable} '${TOKEN.activeObjectUnavailable}'`,
    '}',
    'try { $null = $application.DoJavaScriptFile($jsxPath, @(), 1) } catch {',
    '  $exception = $_.Exception',
    '  $hresult = $exception.HResult',
    '  while ($null -ne $exception) {',
    '    if ($exception -is [Runtime.InteropServices.COMException]) { $hresult = $exception.HResult; break }',
    '    $exception = $exception.InnerException',
    '  }',
    `  Stop-McpRunner ${EXIT.doJavaScriptFileComException} ('${TOKEN.doJavaScriptFileComException} 0x{0:X8}' -f $hresult)`,
    '}',
    `exit ${EXIT.hostReturned}`,
];
export const WINDOWS_RUNNER_SOURCE = `${RUNNER_LINES.join('\r\n')}\r\n`;
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const PREFLIGHT_LINES = [
    '# MCP_PREFLIGHT read-only attach observation (plain reads only). Node decides; the only Illustrator contact is GetActiveObject.',
    '$mcpPaths = @()',
    '$mcpVersions = @()',
    '$mcpAvailable = $false',
    "$mcpProcesses = @([Diagnostics.Process]::GetProcessesByName('Illustrator'))",
    'foreach ($mcpProcess in $mcpProcesses) {',
    '  $mcpPath = $null',
    '  try { $mcpPath = [string]$mcpProcess.MainModule.FileName } catch { }',
    '  $mcpVersion = $null',
    '  if ($mcpPath) { try { $mcpVersion = [string][Diagnostics.FileVersionInfo]::GetVersionInfo($mcpPath).FileVersion } catch { } }',
    '  $mcpPaths += , $mcpPath',
    '  $mcpVersions += , $mcpVersion',
    '}',
    'if ($mcpProcesses.Count -eq 1 -and $mcpPaths[0]) {',
    '  $mcpApplication = $null',
    "  try { $mcpApplication = [Runtime.InteropServices.Marshal]::GetActiveObject('Illustrator.Application') } catch { }",
    '  $mcpAvailable = $null -ne $mcpApplication',
    '  if ($null -ne $mcpApplication) { try { $null = [Runtime.InteropServices.Marshal]::ReleaseComObject($mcpApplication) } catch { } }',
    '  $mcpApplication = $null',
    '}',
    '$mcpJson = ConvertTo-Json -Compress -InputObject ([ordered]@{ powerShellVersion = [string]$PSVersionTable.PSVersion;',
    '  apartmentState = [string][Threading.Thread]::CurrentThread.ApartmentState; processCount = $mcpProcesses.Count;',
    '  paths = $mcpPaths; fileVersions = $mcpVersions; attachAvailable = $mcpAvailable; version = $null })',
    "$mcpJson = [Text.RegularExpressions.Regex]::Replace($mcpJson, '[^\\x20-\\x7e]', { param($m) '\\u{0:x4}' -f [int][char]$m.Value })",
    '[Console]::Out.Write("attach $nonce $mcpJson`n")',
    '[Console]::Out.Flush()',
];
const PREFLIGHT_ANCHOR = '$creationTime = [Diagnostics.Process]::GetCurrentProcess().StartTime.ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture)';
function insertBeforeOnce(lines, anchor, block) {
    const at = lines.flatMap((line, index) => line === anchor ? [index] : []);
    if (at.length !== 1)
        throw new Error(`The runner preflight anchor must occur exactly once (found ${at.length}).`);
    return [...lines.slice(0, at[0]), ...block, ...lines.slice(at[0])];
}
export const WINDOWS_READ_RUNNER_SOURCE = `${insertBeforeOnce(RUNNER_LINES, PREFLIGHT_ANCHOR, PREFLIGHT_LINES).join('\r\n')}\r\n`;
export const WINDOWS_READ_RUNNER_PREFLIGHT_SOURCE = `${PREFLIGHT_LINES.join('\r\n')}\r\n`;
export function windowsReadRunnerFileContents() {
    return Buffer.concat([UTF8_BOM, Buffer.from(WINDOWS_READ_RUNNER_SOURCE, 'utf8')]);
}
export function windowsRunnerFileContents() {
    return Buffer.concat([UTF8_BOM, Buffer.from(WINDOWS_RUNNER_SOURCE, 'utf8')]);
}
export function windowsRunnerInvocation(input) {
    return {
        command: windowsPowerShellExecutable(input.systemRoot),
        args: ['-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', input.runnerPath, input.nonce, input.jsxPath],
    };
}
export function windowsPowerShellExecutable(systemRoot) {
    return `${systemRoot.replace(/\\+$/u, '')}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}
export function windowsPowerShellEnvironment(env) {
    return Object.fromEntries(Object.entries(env).filter(([name]) => name.toUpperCase() !== 'PSMODULEPATH'));
}
export const windowsCommandRunner = (command, args, timeoutMs) => new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 65536,
        env: windowsPowerShellEnvironment(process.env) }, (error, stdout, stderr) => {
        if (error === null)
            resolve({ kind: 'exit', code: 0, signal: null, stdout, stderr });
        else if (error.killed)
            resolve({ kind: 'timeout', timeoutMs });
        else if (typeof error.code === 'number')
            resolve({ kind: 'exit', code: error.code, signal: error.signal ?? null, stdout, stderr });
        else
            resolve({ kind: 'spawn_error', message: 'Windows PowerShell could not start.' });
    });
});
