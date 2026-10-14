# Client compatibility and verified scope

[日本語](compatibility.md) | **English**

**Public Beta 0.1.0-beta.6.** Keep stable Illustrator in the foreground and the screen unlocked. Transport checks and end-to-end artwork checks through an AI app are separate evidence.

## AI clients

The table below records historical beta.4 checks. It does not report verification of the beta.6 distribution.

| Client | Connection | Historical checks on beta.4 | Status |
| --- | --- | --- | --- |
| Claude Code 2.1.278 | stdio | Install, registration, discovery, doctor, reads, backup, rectangle plan/apply/verification, save, reopen, independent read-back | Beta client |
| Claude Desktop 2.2553.1 | Desktop extension (`.mcpb`, built-in Node.js) | Install, saving the settings with their defaults, discovery, reads, backup, rectangle plan/apply/verification, save, reopen, read-back. Desktop cannot run doctor itself | Beta client (main install method) |
| Claude Desktop 2.2553.1 | stdio, configuration file | Registration, discovery, reads, backup, rectangle plan/apply/verification, save, reopen, read-back | Beta client (alternative install method) |
| Codex CLI 0.155.1 | stdio | Connection, approval, discovery, reads, backup, rectangle plan/apply/verification, save, reopen, read-back. The client used the plan's `next_call` and reached the applied edit without extra instructions | Beta client |
| ChatGPT (Work, On your computer) | Plugin (added from the ChatGPT app or with `codex plugin add`, launched with `npx`) | The 13 steps through the plugin (discovery, reads, backup, rectangle plan/apply/verification, save, reopen, read-back) were checked at the release-candidate stage with a test plugin launching the package (tgz) published as beta.4. The client used the plan's `next_call` and reached the applied edit without extra instructions. Updating and removing the plugin left other settings and execution records in place. The published plugin was confirmed to launch npm 0.1.0-beta.4 and become ready. Adding it entirely from the ChatGPT app (adding the marketplace, installing, and uninstalling) was also checked with the published plugin, and it writes the same settings as the commands. No tool was called after installing from the app. Setup steps are in the [install guide](install.en.md#add-the-plugin-main-method) | Beta client (main method) |
| ChatGPT (Work, On your computer) | Local stdio (registered with the one-line `codex mcp add`) | Registration, discovery, reads, backup, rectangle plan/apply/verification, save, reopen, read-back. The client used the plan's `next_call` and reached the applied edit without extra instructions. Setup steps are in the [install guide](install.en.md#register-with-one-command-alternative) | Beta client (alternative) |
| ChatGPT (Work, In the cloud) | Remote MCP | Not run | Not supported (this MCP drives a local Illustrator) |

Configuration alone, transport discovery, or success in another app does not establish support. For beta.4, each client above completed the bounded rectangle workflow on a test document with the package published as beta.4. This does not cover every editing operation or every failure path, and does not guarantee arbitrary artwork support.

## Per-operation live verification

Operations were measured individually on stable Illustrator 30.8.x. Principal paths were checked on 30.8.1, macOS 27.0, foreground and unlocked. Dedicated SDK-driven RGB and CMYK sessions each completed 103 consecutive changes and 108 changes including recovery. These are separate from the client-specific checks above.

- Supported inputs for shapes, text, placed images, layers, and other operations have individual measurements. The [tool catalog](tools.en.md) lists available functions; it does not promise live coverage of every input.
- In sessions, delete, embed, vector import, artboard updates, in-document trim marks, barcodes, QR codes and stroke styles are excluded. Backups were measured up to 20,778 items (documents above 1,000 items are compared in full as a stream, 12–15 s per pass at 20,778 items), and sessions up to 3,000 items per scan and 20,779 items with chunked scans. Larger documents are refused.
- In CMYK documents, compound-path creation is unsupported. Intermittent invalid group references remain unresolved; restart is not a guaranteed repair. Long document-key records and existing stroked text have known limits too.
- Do not generalize to background/locked operation, arbitrary artwork, or long-running production.

## Verification and limitations

Recent live checks used macOS 27.0 and stable Illustrator 30.8.1, foreground and unlocked. RGB and CMYK test documents each completed 103 consecutive changes and 108 total changes including recovery checks. There are 45 major execution records, supplemented by new measurements for operations whose code subsequently changed.

These are bounded tests through a dedicated connection program. They do not establish arbitrary artwork support, every AI app, or long-running production use. Do not extend the results to Illustrator Beta, background operation, or a locked screen.

| Limitation | Current state |
| --- | --- |
| Reading groups | Known intermittent issue: a group reference can become unreadable, and the operation then stops on the safe side (fails closed). The cause is unresolved; restarting Illustrator is not an established repair |
| Long document identifiers | Long information identifying a document, including its path, can make a saved execution record unreadable. Replay and recovery are not guaranteed for arbitrary documents |
| Continuous editing | With a verified backup and exclusive document use, most editing operations are supported. Delete, embed, vector import, artboard updates, in-document trim marks, barcodes, QR codes and stroke styles are excluded. Backups were measured up to 20,778 items and sessions up to 20,779 items with chunked scans; larger documents are refused. Performance, finished-record retention, and recovery usability remain unfinished |
| Stroke after saving text | Newly created point text acquiring a stroke after save was corrected and rechecked in RGB/CMYK. Existing stroked text remains unsupported |
| Character-style restoration | An incorrect restoration result was corrected. Forcing a failure through the actual tool and completing live rollback remains unverified |
| Unsupported work | Path text, paragraph-style mutation, ungrouping, missing-link repair, and outlining in the original document, among other limits |

If a response stops, do not bypass it by sending the edit as a new request or deleting execution records. See [client verification](#ai-clients) and [recovery steps](runbook.en.md).

## Beta scope

| Area | Details |
| --- | --- |
| In scope | Reading and inspection; non-destructive edits of supported shapes, text, and images (including CMYK documents); continuous editing of saved files (edit sessions, experimental); backup and overwrite save; outlined AI/PDF export; PDF export with trim marks and bleed; PNG/JPEG export of one artboard (RGB documents, scale 1 or 2 or an exact pixel size, never overwriting an existing file); placing, relinking, embedding (JPEG/PNG in RGB documents only), and optimizing images; EAN-13, EAN-8 and ITF-14 barcodes and QR codes; rendering artboards to compare before and after, and extracting all text; stdio transport (MCP 2026-07-28) |
| Out of scope | SVG export, artboard removal, fractional-point artboard updates, paragraph styles, MCP Tasks, Windows, deleting several objects at once (one object per delete), missing-link repair, ungrouping |
| Streamable HTTP | Covered by automated tests and client connection checks only. No Illustrator operation over HTTP has been recorded. Loopback (`127.0.0.1`) only; not for external exposure |
| CMYK documents | Creating compound paths is not supported (refused) |
| Known intermittent issue | Reading groups can intermittently lose the reference to an item. The operation then stops on the safe side (fails closed) instead of guessing. It is not hidden by retries, and restarting Illustrator is not guaranteed to fix it |
| CI | Before publication, the release candidate source must pass the full test suite on macOS CI and locally |

## Transports

| Transport | Evidence | Not established |
| --- | --- | --- |
| stdio | SDK automated tests; isolated installed package initialize and complete discovery | Every client workflow or arbitrary artwork |
| Streamable HTTP | SDK and HTTP-boundary automated tests; loopback, Bearer, Host/Origin checks | Public HTTPS, OAuth, connection from ChatGPT Work "In the cloud", or Illustrator editing over HTTP |

HTTP is restricted to `127.0.0.1`. Tokens need at least 32 characters; only explicitly allowed Origins are accepted. This is not an externally accessible server.

## Beta and Stable

Beta is for trials within measured conditions and known limits. Stable requires separate acceptance for sustained use, recovery, updates, record retention, performance, and support. Built JavaScript is shipped without post-processing. Replaying unresolved commands from an older version is not guaranteed safe. See [recovery](runbook.en.md).

QR Code is a registered trademark of DENSO WAVE INCORPORATED in Japan and in other countries.
