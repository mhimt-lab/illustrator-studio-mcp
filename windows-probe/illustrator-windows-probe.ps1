# illustrator-studio-mcp Windows verification kit: helper (see README.md next to this file).
# Fixed text. Run only by windows-probe/illustrator-windows-probe.mjs on Windows, one observation per process:
#   powershell.exe -NoProfile -NonInteractive -Sta -ExecutionPolicy Bypass -File <this> <action> [pid]
#   (the optional second argument is a pid for creation-time and a directory for acl)
# Prints one JSON line on stdout (UTF-8). Never calls CreateObject / New-Object -ComObject: Illustrator is
# only ever attached with GetActiveObject, so a probe can never launch it.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
if ($args.Count -lt 1) { exit 2 }
$action = [string]$args[0]
# `$args` is read here, in script scope; switch clauses below do not see the script's arguments reliably.
$secondArgument = if ($args.Count -eq 2) { [string]$args[1] } else { $null }
$addTypeWatch = [Diagnostics.Stopwatch]::StartNew()
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
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool LockWorkStation();
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
  // Process id that owns the foreground window; 0 when there is no foreground window (GetForegroundWindow returns NULL) or no owner.
  public static uint ForegroundProcessId() {
    IntPtr window = GetForegroundWindow();
    if (window == IntPtr.Zero) return 0;
    uint processId;
    GetWindowThreadProcessId(window, out processId);
    return processId;
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
$addTypeMs = $addTypeWatch.ElapsedMilliseconds

function Write-ProbeJson($value) {
  [Console]::Out.Write((ConvertTo-Json -InputObject $value -Compress -Depth 6) + "`n")
  [Console]::Out.Flush()
}

function Get-IllustratorPaths {
  $paths = @()
  foreach ($process in @(Get-Process -Name 'Illustrator' -ErrorAction SilentlyContinue)) {
    $paths += , [McpWindowsProbe]::ImagePath([uint32]$process.Id)
  }
  return , $paths
}

function Get-IllustratorCount {
  return @(Get-Process -Name 'Illustrator' -ErrorAction SilentlyContinue).Count
}

function Get-HResult($exception) {
  $hresult = $exception.HResult
  while ($null -ne $exception) {
    if ($exception -is [Runtime.InteropServices.COMException]) { return ('0x{0:X8}' -f $exception.HResult) }
    $exception = $exception.InnerException
  }
  return ('0x{0:X8}' -f $hresult)
}

switch ($action) {
  # Session observation: exactly {"SessionFlags":n,"WTSClientProtocolType":n}. A failure prints nothing and exits 70.
  'session' {
    try {
      $flags = [McpWindowsProbe]::SessionFlags()
      $protocol = [McpWindowsProbe]::ClientProtocolType()
    } catch { exit 70 }
    [Console]::Out.Write('{"SessionFlags":' + $flags + ',"WTSClientProtocolType":' + $protocol + "}`n")
    exit 0
  }
  # Starts the lock only; the caller verifies it by polling `session` (LockWorkStation is asynchronous).
  'lock' {
    Write-ProbeJson ([ordered]@{ started = [McpWindowsProbe]::LockWorkStation() })
    exit 0
  }
  # Foreground observation: exactly {"foregroundExecutablePath":...,"illustratorExecutablePaths":[...],"foregroundProcessId":n,"illustratorProcessIds":[...]}. Timing goes to stderr.
  'foreground' {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $foregroundPid = [McpWindowsProbe]::ForegroundProcessId()
    $foreground = $null
    if ($foregroundPid -ne 0) { $foreground = [McpWindowsProbe]::ImagePath($foregroundPid) }
    $paths = Get-IllustratorPaths
    $illustratorPids = @()
    foreach ($process in @(Get-Process -Name 'Illustrator' -ErrorAction SilentlyContinue)) { $illustratorPids += [int]$process.Id }
    $elapsed = $watch.Elapsed.TotalMilliseconds
    Write-ProbeJson ([ordered]@{ foregroundExecutablePath = $foreground; illustratorExecutablePaths = $paths;
      foregroundProcessId = [int]$foregroundPid; illustratorProcessIds = $illustratorPids })
    [Console]::Error.WriteLine('observeMs=' + $elapsed.ToString([Globalization.CultureInfo]::InvariantCulture))
    exit 0
  }
  # W12 / W0 / W5: GetActiveObject then Version, with the Illustrator process count around it.
  'active-object' {
    $before = Get-IllustratorCount
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $result = [ordered]@{ addTypeMs = $addTypeMs; processesBefore = $before }
    try {
      $application = [Runtime.InteropServices.Marshal]::GetActiveObject('Illustrator.Application')
      $result.attached = $true
      $result.version = [string]$application.Version
    } catch {
      $result.attached = $false
      $result.exceptionType = $_.Exception.GetType().FullName
      $result.hresult = Get-HResult $_.Exception
    }
    $result.callMs = $watch.ElapsedMilliseconds
    $result.processesAfter = Get-IllustratorCount
    Write-ProbeJson $result
    exit 0
  }
  # W14: running Illustrator-like processes by image path, and the registered ProgIDs with CurVer.
  'enumerate' {
    $processes = @()
    foreach ($process in @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like '*Illustrator*' })) {
      $processes += , ([ordered]@{ id = $process.Id; name = $process.ProcessName; path = [McpWindowsProbe]::ImagePath([uint32]$process.Id) })
    }
    $progIds = @()
    foreach ($key in @(Get-ChildItem -Path 'Registry::HKEY_CLASSES_ROOT' -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -like 'Illustrator.Application*' })) {
      $curVer = $null
      try { $curVer = (Get-ItemProperty -Path ('Registry::HKEY_CLASSES_ROOT\' + $key.PSChildName + '\CurVer') -ErrorAction Stop).'(default)' } catch { $curVer = $null }
      $progIds += , ([ordered]@{ progId = $key.PSChildName; curVer = $curVer })
    }
    Write-ProbeJson ([ordered]@{ processes = $processes; progIds = $progIds })
    exit 0
  }
  # W10 liveness input: {"pid":n,"kind":"found","creationTime":"<o, UTC>"} | not_found | error.
  'creation-time' {
    if ($null -eq $secondArgument -or $secondArgument -notmatch '^[1-9][0-9]{0,9}$') { exit 2 }
    $processId = [int]$secondArgument
    try {
      $process = Get-Process -Id $processId -ErrorAction Stop
    } catch [Microsoft.PowerShell.Commands.ProcessCommandException] {
      Write-ProbeJson ([ordered]@{ pid = $processId; kind = 'not_found' })
      exit 0
    } catch {
      Write-ProbeJson ([ordered]@{ pid = $processId; kind = 'error' })
      exit 0
    }
    try {
      $creationTime = $process.StartTime.ToUniversalTime().ToString('o', [Globalization.CultureInfo]::InvariantCulture)
      Write-ProbeJson ([ordered]@{ pid = $processId; kind = 'found'; creationTime = $creationTime })
    } catch {
      Write-ProbeJson ([ordered]@{ pid = $processId; kind = 'error' })
    }
    exit 0
  }
  # W11: the directory's access rules as structured data (icacls prints in the OEM code page).
  'acl' {
    if ($null -eq $secondArgument) { exit 2 }
    $rules = @()
    foreach ($rule in @([IO.Directory]::GetAccessControl($secondArgument).GetAccessRules($true, $true, [Security.Principal.NTAccount]))) {
      $rules += , ([ordered]@{
        identity = [string]$rule.IdentityReference; rights = [string]$rule.FileSystemRights; type = [string]$rule.AccessControlType
        inherited = $rule.IsInherited; inheritance = [string]$rule.InheritanceFlags; propagation = [string]$rule.PropagationFlags
      })
    }
    Write-ProbeJson ([ordered]@{ rules = $rules })
    exit 0
  }
  # W8: Document.Activate on the one disposable probe document, then the foreground image.
  'activate-document' {
    $result = [ordered]@{ foregroundBefore = [McpWindowsProbe]::ForegroundImagePath() }
    try {
      $application = [Runtime.InteropServices.Marshal]::GetActiveObject('Illustrator.Application')
      $targets = @()
      foreach ($document in @($application.Documents)) {
        if ([string]$document.Name -like 'mcp-windows-probe*') { $targets += , $document }
      }
      $result.disposableDocuments = $targets.Count
      if ($targets.Count -ge 1) {
        $targets[0].Activate()
        Start-Sleep -Milliseconds 500
        $result.activated = $true
      } else {
        $result.activated = $false
      }
    } catch {
      $result.activated = $false
      $result.exceptionType = $_.Exception.GetType().FullName
      $result.hresult = Get-HResult $_.Exception
    }
    $result.foregroundAfter = [McpWindowsProbe]::ForegroundImagePath()
    $result.illustratorExecutablePaths = Get-IllustratorPaths
    Write-ProbeJson $result
    exit 0
  }
  default { exit 2 }
}
