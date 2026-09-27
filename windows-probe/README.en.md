# Windows verification kit (guide for collaborators)

[日本語](README.md) | **English**

Windows support for Illustrator Studio MCP is in preparation. To decide how it should work, we are asking people who have Windows and Illustrator to measure some basic behavior with this kit.

This kit is not a Windows version of the MCP server. It measures 17 items (W0〜W16) in a fixed order — whether Windows can attach to Illustrator, whether it can run scripts, and how Illustrator behaves while the screen is locked or while it is in the background — and writes the results to files. That is all it does.

## Read this first (results are public)

- **You attach the results to a public issue. Anyone can read them.** Attached files cannot be fully removed later.
- When the kit writes the results, it replaces your Windows user name, computer name, domain name and your folders (such as `C:\Users\<name>`) with variable names such as `%USERNAME%` and `%USERPROFILE%`. Account SIDs are masked as well.
- Even so, **check the contents yourself before attaching them** (see [Check before you submit](#check-before-you-submit)). If a name, a company name or anything similar remains, remove it before attaching, or do not submit.
- Do not run the kit as a Windows user that has work Illustrator documents or personal files. Prepare a **Windows user dedicated to the kit** (or a separate machine).
- Taking part is voluntary. You may stop at any time.

## Requirements

| Item | Requirement |
| --- | --- |
| Windows | Windows 11, or Windows 10 22H2 (build 19045) or later. x64 (Windows on ARM is out of scope) |
| Session | Operate the machine in front of its screen (local console). Remote Desktop (RDP) is out of scope. For a virtual machine, use the hypervisor's console window |
| Illustrator | Exactly one current stable Creative Cloud Illustrator, signed in. Illustrator Beta is optional (when installed, W14 measures it too) |
| Node.js | 20 or later, x64 (official installer) |
| PowerShell | Windows PowerShell 5.1, included with Windows. The execution policy must not be fixed by an organization policy (C4) |
| Git | Git for Windows |
| Privileges | A standard user. Do not run as administrator (no elevation) |
| Sign-in | A password or PIN is set (the kit measures locking and unlocking) |
| Windows user | A user dedicated to the kit, with no work documents or personal files |

**Expected time:** 2–3 hours. Most of it is waiting, but the kit asks you to do the following along the way. Follow the instructions on screen.

- Quit and start Illustrator, and save two test documents (W12, W0)
- If Beta is installed, start and quit Beta (W14)
- Keep a modal dialog open, then close it when asked (W3, W9)
- Unlock the screen after the kit locks it, twice (W4〜W6, W15)
- Switch Illustrator and File Explorer between the front and the back (W15, W7, W8)

## What the kit reads and writes

**Reads (and records):** the OS version and CPU architecture, the PowerShell version and execution policies, the Node.js version and executable location, whether you run as administrator (only the verdict from `whoami /groups` is recorded), the Git HEAD and whether the checkout is unmodified, the executable locations of running Illustrator processes, the `Illustrator.Application` names registered in the registry, the screen lock state, the executable location of the foreground window's process, and the permissions (access rules) of a folder the kit creates.

**Writes:**

- The results folder `windows-probe-results-<date>\` (at the repository root): `environment.json`, one `w<number>.json` per item, and `summary.md`
- The work folder (the empty folder given as `--state-root`): the per-call script and result files, and a lock file
- `%LOCALAPPDATA%\illustrator-studio-mcp-probe-<date>\`: small text files used to measure file system behavior (W11)

**In Illustrator:**

- The kit **never starts** Illustrator. It only attaches to an Illustrator that is already running.
- It reads and changes only the test documents whose names start with `mcp-windows-probe`. Other documents are only counted; their contents are not read.
- It makes exactly one change: in W7 it draws one small rectangle in the test document `mcp-windows-probe.ai`. It does not save it.
- It locks the screen twice (W4, W15). You unlock it yourself.

The kit does not delete the files and folders it creates. After you submit, delete the three folders above and the test documents by hand.

## What the results never contain

- The contents of Illustrator documents, or the text of the scripts the kit runs
- Full PowerShell error records (only a short classification token and the HRESULT value are recorded)
- Paths that contain your user name, computer name, domain name or user folders (they are replaced with variable names), and account SIDs

## Preparation

1. Sign in as the Windows user dedicated to the kit (in front of the machine, not over RDP).
2. Install Node.js 20 or later (x64) and Git for Windows.
3. Make sure Illustrator is not running.
4. Create a folder for the test documents (for example `C:\mcp-probe-docs`). **Do not create** the kit's work folder (for example `C:\mcp-probe-state`) yet: it must be empty or absent. A folder under `%TEMP%` cannot be used.
5. Get the kit. **Always pass `--config core.autocrlf=false`**: if Git rewrites line endings, the kit files' SHA-256 no longer matches and the kit stops at C9. `<tag>` is the tag of the release that announced this kit (listed in the "Windows verification kit" section of the release notes).

   ```powershell
   git clone --config core.autocrlf=false https://github.com/mhimt-lab/illustrator-studio-mcp.git
   cd illustrator-studio-mcp
   git checkout <tag>
   ```

### Checks before the start (C1〜C10)

When it starts, the kit checks the following and records them in `environment.json`. If any of them is not met, it ends without touching Illustrator (`summary.md` lists the items that were not met). Checking them in PowerShell beforehand saves a restart.

| # | Check | PowerShell command | Requirement |
| --- | --- | --- | --- |
| C1 | OS and CPU | `[Environment]::OSVersion.Version`, `$env:PROCESSOR_ARCHITECTURE` | Build 19045 or later, `AMD64` |
| C2 | Session | `query session` (your own row) | `console` (not RDP), not locked |
| C3 | PowerShell | `$PSVersionTable.PSVersion` | 5.1.x |
| C4 | Execution policy | `Get-ExecutionPolicy -List` | `MachinePolicy` and `UserPolicy` are `Undefined` |
| C5 | Node.js | `node -p "process.version + ' ' + process.arch"` | 20 or later, `x64` |
| C6 | Illustrator | (asked at the start) | Exactly one stable Illustrator |
| C7 | Privileges | `whoami /groups` | `Medium Mandatory Level` (not running as administrator) |
| C8 | Work documents | (asked at the start) | This user has no work Illustrator documents |
| C9 | Kit | (checked by the kit) | HEAD matches the tag, no local changes, the kit's SHA-256 matches |
| C10 | Sign-in | (asked at the start) | A password or PIN is set |

## Running the kit

Run it from the repository folder in a standard (not administrator) PowerShell window. Replace `<tag>` and `<kit SHA-256>` with the values in the "Windows verification kit" section of the release notes.

```powershell
node windows-probe\illustrator-windows-probe.mjs --state-root C:\mcp-probe-state --expect-head (git rev-parse "<tag>^{commit}") --expect-sha256 <kit SHA-256>
```

The kit shows each instruction in Japanese and English. Finish the requested action, then press Enter. In W0, start stable Illustrator, save two new documents with the following names in the test document folder, and keep both open (copy the names from here).

```text
mcp-windows-probe.ai
mcp-windows-probe-日本語.ai
```

In W3, open a modal dialog in `mcp-windows-probe.ai` (for example File > Document Setup) and keep it open. Do not close it until W9 asks you to.

After each item, the kit prints one JSON line (`"event":"cell"`). At the end it prints `"event":"completed"` (all items ran) or `"event":"stopped"` (it stopped part way).

### Screen lock and unlock

In W4 and W15 the kit locks the screen. Once it is locked, **wait about one minute**, then unlock it with your password or PIN as usual. W5 and W6 run automatically while the screen is locked. The kit waits for you to unlock (up to 15 minutes).

### If the kit stops

- **Do not run the kit again after it stops.** The items after the one that stopped are not run and are recorded as `NOT_RUN` in `summary.md`. That result is valuable data too; submit it as it is.
- **A timeout is not a failure; it records that the result is unknown** (`INDETERMINATE`). Do not retry.
- If Illustrator stops responding, do not keep operating it. Check that the kit's output has stopped, then quit Illustrator. You do not need to save the test documents.
- If a results folder for the same day already exists, the kit ends without doing anything (it never overwrites results).

## Check before you submit

Before attaching anything, open every file in the results folder (in Notepad, for example) and read it. Then search in PowerShell for your user name and computer name. **If nothing is printed**, you are fine.

```powershell
Select-String -Path .\windows-probe-results-*\* -SimpleMatch -Pattern $env:USERNAME, $env:COMPUTERNAME, $env:USERDOMAIN
```

If any line is printed, remove that part or do not submit. Also make sure there is no company name, email address, real name or any other word you do not want to publish.

## Submitting

Submit through the issue form "[Windows verification kit results](https://github.com/mhimt-lab/illustrator-studio-mcp/issues/new?template=windows-probe-result.yml)" in the public repository. You need a GitHub account.

1. Read the consent and confirmation items in the form and check them.
2. Drag `environment.json`, `summary.md` and every `w<number>.json` from the results folder into the attachment field (a single ZIP of them is fine too).
3. Fill in the Windows and Illustrator versions and, if the kit stopped, what happened, then submit.

The issue and the attached files can be read by anyone.

## After submitting

You may delete the work folder (for example `C:\mcp-probe-state`), `%LOCALAPPDATA%\illustrator-studio-mcp-probe-<date>\`, the results folder and the test documents.
