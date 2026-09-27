import { execFile } from 'node:child_process';
import { windowsPowerShellEnvironment } from './powershell-runner.js';
const DISQUALIFYING_ATTRIBUTES = [
    ['ReparsePoint', 0x400],
    ['RecallOnOpen', 0x40000],
    ['Pinned', 0x80000],
    ['Unpinned', 0x100000],
    ['RecallOnDataAccess', 0x400000],
];
const FILE_ATTRIBUTE_DIRECTORY = 0x10;
const FULL_CONTROL = 0x1f01ff;
const CONTAINER_AND_OBJECT_INHERIT = 3;
const SID = /^S-1-\d+(?:-\d+)+$/u;
const SCRIPT = String.raw `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$mode = [string]$env:ISM_STATE_ROOT_MODE
$root = [string]$env:ISM_STATE_ROOT_PATH
$me = [Security.Principal.WindowsIdentity]::GetCurrent().User
if ($mode -eq 'protect') {
  $security = New-Object System.Security.AccessControl.DirectorySecurity
  $security.SetAccessRuleProtection($true, $false)
  $security.SetOwner($me)
  $security.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($me, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
  Set-Acl -LiteralPath $root -AclObject $security
} elseif ($mode -ne 'attest') { throw 'unknown mode' }
$sidType = [Security.Principal.SecurityIdentifier]
$item = Get-Item -LiteralPath $root -Force
$acl = Get-Acl -LiteralPath $root
$rules = @($acl.GetAccessRules($true, $true, $sidType) | ForEach-Object {
  [pscustomobject]@{ sid = $_.IdentityReference.Value; rights = [int64]$_.FileSystemRights; type = [string]$_.AccessControlType; inherited = [bool]$_.IsInherited; inheritance = [int]$_.InheritanceFlags; propagation = [int]$_.PropagationFlags }
})
$ancestors = @()
$cursor = $item
while ($null -ne $cursor) {
  $ancestors += [pscustomobject]@{ path = $cursor.FullName; attributes = [int64]$cursor.Attributes }
  $cursor = $cursor.Parent
}
$entries = New-Object System.Collections.Generic.List[object]
$entryCount = 0
$pending = New-Object System.Collections.Stack
$pending.Push((New-Object System.IO.DirectoryInfo($root)))
$accessOnly = [Security.AccessControl.AccessControlSections]::Access
while ($pending.Count -gt 0) {
  $directory = $pending.Pop()
  foreach ($child in $directory.EnumerateFileSystemInfos()) {
    $entryCount++
    $childAcl = $child.GetAccessControl($accessOnly)
    $explicit = $childAcl.GetAccessRules($true, $false, $sidType).Count
    # Only candidates are reported (own ACL, or reparse / cloud bits); the caller judges them again.
    if ($childAcl.AreAccessRulesProtected -or $explicit -ne 0 -or ([int64]$child.Attributes -band 0x5C0400) -ne 0) {
      $entries.Add([pscustomobject]@{ path = $child.FullName; attributes = [int64]$child.Attributes; protected = [bool]$childAcl.AreAccessRulesProtected; explicitRules = $explicit })
    }
    if (($child.Attributes -band [IO.FileAttributes]::Directory) -and -not ($child.Attributes -band [IO.FileAttributes]::ReparsePoint)) { $pending.Push($child) }
  }
}
$drive = New-Object System.IO.DriveInfo($item.Root.FullName)
[Console]::Out.Write((ConvertTo-Json -Compress -Depth 4 ([pscustomobject]@{
  currentSid = $me.Value; owner = $acl.GetOwner($sidType).Value; protected = [bool]$acl.AreAccessRulesProtected
  rules = $rules; ancestors = $ancestors; entryCount = $entryCount; entries = $entries; driveFormat = [string]$drive.DriveFormat; driveType = [string]$drive.DriveType
})))
`;
export async function observeWindowsStateRoot(root, mode) {
    const systemRoot = process.env.SystemRoot;
    if (!systemRoot)
        throw new Error('SystemRoot is not set; the state root cannot be attested.');
    const stdout = await new Promise((resolve, reject) => {
        execFile(`${systemRoot.replace(/\\+$/u, '')}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(SCRIPT, 'utf16le').toString('base64')], {
            env: { ...windowsPowerShellEnvironment(process.env), ISM_STATE_ROOT_MODE: mode, ISM_STATE_ROOT_PATH: root },
            windowsHide: true,
            timeout: 60_000,
            maxBuffer: 64 * 1024 * 1024,
            encoding: 'utf8',
        }, (error, output) => {
            if (error)
                reject(new Error(`The state root ${mode} step failed (${error.code ?? error.name}).`));
            else
                resolve(output);
        });
    });
    const parsed = parseWindowsStateRootObservation(stdout);
    if (parsed === null)
        throw new Error(`The state root ${mode} step returned an unrecognized observation.`);
    return parsed;
}
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isInteger = (value) => typeof value === 'number' && Number.isSafeInteger(value);
const asArray = (value) => (Array.isArray(value) ? value : value === null || value === undefined ? [] : isRecord(value) ? [value] : null);
export function parseWindowsStateRootObservation(output) {
    let value;
    try {
        value = JSON.parse(output.trim());
    }
    catch {
        return null;
    }
    if (!isRecord(value))
        return null;
    const rules = asArray(value.rules);
    const ancestors = asArray(value.ancestors);
    const entries = asArray(value.entries);
    if (typeof value.currentSid !== 'string' || typeof value.owner !== 'string' || typeof value.protected !== 'boolean' ||
        rules === null || ancestors === null || entries === null ||
        typeof value.driveFormat !== 'string' || typeof value.driveType !== 'string' ||
        !isInteger(value.entryCount) || value.entryCount < 0)
        return null;
    const parsedRules = [];
    for (const rule of rules) {
        if (!isRecord(rule) || typeof rule.sid !== 'string' || !isInteger(rule.rights) || typeof rule.type !== 'string' ||
            typeof rule.inherited !== 'boolean' || !isInteger(rule.inheritance) || !isInteger(rule.propagation))
            return null;
        parsedRules.push({ sid: rule.sid, rights: rule.rights, type: rule.type, inherited: rule.inherited, inheritance: rule.inheritance, propagation: rule.propagation });
    }
    const parsedAncestors = [];
    for (const ancestor of ancestors) {
        if (!isRecord(ancestor) || typeof ancestor.path !== 'string' || !isInteger(ancestor.attributes))
            return null;
        parsedAncestors.push({ path: ancestor.path, attributes: ancestor.attributes });
    }
    const parsedEntries = [];
    for (const entry of entries) {
        if (!isRecord(entry) || typeof entry.path !== 'string' || !isInteger(entry.attributes) ||
            typeof entry.protected !== 'boolean' || !isInteger(entry.explicitRules))
            return null;
        parsedEntries.push({ path: entry.path, attributes: entry.attributes, protected: entry.protected, explicitRules: entry.explicitRules });
    }
    return {
        currentSid: value.currentSid,
        owner: value.owner,
        protected: value.protected,
        rules: parsedRules,
        ancestors: parsedAncestors,
        entryCount: value.entryCount,
        entries: parsedEntries,
        driveFormat: value.driveFormat,
        driveType: value.driveType,
    };
}
function disqualifyingAttributes(attributes) {
    return DISQUALIFYING_ATTRIBUTES.filter(([, bit]) => (attributes & bit) !== 0).map(([name]) => name);
}
export function judgeWindowsStateRootObservation(observation) {
    const reasons = [];
    const me = observation.currentSid;
    if (!SID.test(me))
        reasons.push('the current user SID is not recognized');
    const [root] = observation.ancestors;
    if (root === undefined || (root.attributes & FILE_ATTRIBUTE_DIRECTORY) === 0)
        reasons.push('the state root is not a directory');
    const linkedAncestors = observation.ancestors.filter(({ attributes }) => disqualifyingAttributes(attributes).length > 0);
    if (linkedAncestors.length > 0) {
        const names = [...new Set(linkedAncestors.flatMap(({ attributes }) => disqualifyingAttributes(attributes)))];
        reasons.push(`the state root or an ancestor carries ${names.join(', ')}`);
    }
    if (observation.owner !== me)
        reasons.push('the state root is not owned by the current user');
    if (!observation.protected)
        reasons.push('the state root DACL inherits from its parent');
    const [rule, ...others] = observation.rules;
    if (rule === undefined || others.length > 0 || rule.sid !== me || rule.type !== 'Allow' || rule.rights !== FULL_CONTROL ||
        rule.inherited || rule.inheritance !== CONTAINER_AND_OBJECT_INHERIT || rule.propagation !== 0) {
        reasons.push('the state root DACL is not exactly one inheritable owner-only full-control entry');
    }
    const unsafeEntries = observation.entries.filter((entry) => entry.protected || entry.explicitRules !== 0 || disqualifyingAttributes(entry.attributes).length > 0);
    if (unsafeEntries.length > 0)
        reasons.push(`${unsafeEntries.length} entr${unsafeEntries.length === 1 ? 'y' : 'ies'} below the state root ${unsafeEntries.length === 1 ? 'carries its' : 'carry their'} own ACL or a reparse point`);
    if (observation.driveFormat !== 'NTFS' || observation.driveType !== 'Fixed')
        reasons.push('the state root is not on a local fixed NTFS volume');
    return reasons;
}
