export const OBSERVATION_PROTOCOL_VERSION = 1;
export const OBSERVATION_HELPER_SCRIPT = String.raw `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using Microsoft.Win32.SafeHandles;
public sealed class McpObs { public int Err; public bool Ids; public uint Attrs, Vol; public ulong Index; public byte[] Sd; }
public static class McpObserve {
  [StructLayout(LayoutKind.Sequential)] struct BHFI { public uint attrs; public uint c0, c1, a0, a1, w0, w1; public uint vol, sizeHigh, sizeLow, links, idxHigh, idxLow; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafeFileHandle CreateFileW(string n, uint acc, uint share, IntPtr sa, uint disp, uint flags, IntPtr t);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h, out BHFI i);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetKernelObjectSecurity(SafeFileHandle h, uint info, byte[] sd, uint len, out uint needed);
  // share read/write/delete, OPEN_EXISTING, BACKUP_SEMANTICS (directories) | OPEN_REPARSE_POINT (a link is opened itself)
  static SafeFileHandle Open(string p, uint access) { return CreateFileW(p, access, 7, IntPtr.Zero, 3, 0x02000000 | 0x00200000, IntPtr.Zero); }
  public static McpObs Read(string p) {
    McpObs o = new McpObs();
    bool aclReadable = true;
    SafeFileHandle h = Open(p, 0x80 | 0x20000); // FILE_READ_ATTRIBUTES | READ_CONTROL
    if (h.IsInvalid) {
      int e = Marshal.GetLastWin32Error();
      h.Dispose();
      if (e != 5) { o.Err = e; return o; }
      h = Open(p, 0x80); // ERROR_ACCESS_DENIED: attributes only, so the DACL being unreadable does not hide the attributes
      if (h.IsInvalid) { o.Err = Marshal.GetLastWin32Error(); h.Dispose(); return o; }
      aclReadable = false;
      o.Err = 5;
    }
    using (h) {
      BHFI i;
      if (!GetFileInformationByHandle(h, out i)) { o.Err = Marshal.GetLastWin32Error(); return o; }
      o.Ids = true; o.Attrs = i.attrs; o.Vol = i.vol; o.Index = (((ulong)i.idxHigh) << 32) | i.idxLow;
      if (!aclReadable) return o;
      uint need = 0;
      GetKernelObjectSecurity(h, 5, null, 0, out need); // OWNER | DACL
      if (need == 0) { o.Err = Marshal.GetLastWin32Error(); return o; }
      byte[] buf = new byte[need];
      if (!GetKernelObjectSecurity(h, 5, buf, need, out need)) { o.Err = Marshal.GetLastWin32Error(); return o; }
      o.Sd = buf;
    }
    return o;
  }
}
'@
$utf8 = [System.Text.UTF8Encoding]::new($false)
$reader = [System.IO.StreamReader]::new([Console]::OpenStandardInput(), $utf8)
$writer = [System.IO.StreamWriter]::new([Console]::OpenStandardOutput(), $utf8)
$writer.NewLine = [string][char]10
$writer.AutoFlush = $true
$tab = [char]9
$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value

function Format-Error($o, [string]$token) {
  if ($null -ne $o -and $o.Ids) {
    return '{"attrs":' + $o.Attrs + ',"vol":"' + $o.Vol + '","index":"' + $o.Index + '","owner":null,"daclNull":null,"aces":[],"error":"' + $token + '"}'
  }
  return '{"attrs":null,"vol":null,"index":null,"owner":null,"daclNull":null,"aces":[],"error":"' + $token + '"}'
}

function Observe([string[]]$Paths, [string]$Id) {
  $sb = [System.Text.StringBuilder]::new()
  $aceCount = 0
  [void]$sb.Append('{"id":').Append($Id).Append(',"userSid":"').Append($me).Append('","drive":')
  try {
    $di = [System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($Paths[0]))
    $format = $di.DriveFormat -replace '[^A-Za-z0-9._ -]', '_'
    [void]$sb.Append('{"type":"').Append([string]$di.DriveType).Append('","format":"').Append($format).Append('"}')
  } catch { [void]$sb.Append('{"error":"drive_failed"}') }
  [void]$sb.Append(',"objects":[')
  $first = $true
  foreach ($p in $Paths) {
    if (-not $first) { [void]$sb.Append(',') }
    $first = $false
    $o = $null
    try {
      $o = [McpObserve]::Read($p)
      if ($o.Err -ne 0) { $one = Format-Error $o ('win32_' + $o.Err) }
      else {
        $raw = [System.Security.AccessControl.RawSecurityDescriptor]::new($o.Sd, 0)
        if ($null -eq $raw.Owner) { $one = Format-Error $o 'owner_unreadable' }
        else {
          $b = [System.Text.StringBuilder]::new()
          $n = 0
          [void]$b.Append('{"attrs":').Append($o.Attrs).Append(',"vol":"').Append($o.Vol).Append('","index":"').Append($o.Index).Append('","owner":"').Append($raw.Owner.Value).Append('",')
          if ($null -eq $raw.DiscretionaryAcl) { [void]$b.Append('"daclNull":true,"aces":[],"error":null}') }
          else {
            [void]$b.Append('"daclNull":false,"aces":[')
            $firstAce = $true
            foreach ($ace in $raw.DiscretionaryAcl) {
              if (-not $firstAce) { [void]$b.Append(',') }
              $firstAce = $false
              $known = $ace -as [System.Security.AccessControl.KnownAce]
              if ($null -eq $known) { [void]$b.Append('{"type":"').Append([string]$ace.AceType).Append('","sid":null,"mask":0,"flags":').Append([int]$ace.AceFlags).Append('}') }
              else { [void]$b.Append('{"type":"').Append([string]$ace.AceType).Append('","sid":"').Append($known.SecurityIdentifier.Value).Append('","mask":').Append([int]$known.AccessMask).Append(',"flags":').Append([int]$ace.AceFlags).Append('}') }
              $n++
            }
            [void]$b.Append('],"error":null}')
          }
          $one = $b.ToString()
          $aceCount += $n
        }
      }
    } catch { $one = Format-Error $o 'read_failed' }
    [void]$sb.Append($one)
  }
  [void]$sb.Append('],"count":').Append($Paths.Count).Append(',"aceCount":').Append($aceCount).Append(',"end":true}')
  return $sb.ToString()
}

$null = Observe @([System.IO.Path]::GetTempPath().TrimEnd([char]92)) '0'
$writer.WriteLine('{"ready":true,"v":1,"pid":' + $PID + ',"mode":"handle"}')
while ($true) {
  $line = $reader.ReadLine()
  if ($null -eq $line) { break }
  $parts = $line.Split($tab)
  try {
    if ($parts.Length -lt 2 -or $parts[0] -notmatch '^[0-9]{1,15}$') { throw 'request' }
    $out = Observe ([string[]]$parts[1..($parts.Length - 1)]) $parts[0]
  } catch { $out = '{"id":0,"error":"request_failed","end":true}' }
  $writer.WriteLine($out)
}
`;
