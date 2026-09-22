# Client compatibility and verified scope

[日本語](compatibility.md) | **English**

**Public Beta 0.1.0-beta.2.** Keep stable Illustrator in the foreground and the screen unlocked. Transport checks and end-to-end artwork checks through an AI app are separate evidence.

## AI clients

| Client | Connection | Checks on this exact distribution (beta.2) | Status |
| --- | --- | --- | --- |
| Claude Code 2.1.278 | stdio | Install, registration, discovery, doctor, reads, backup, rectangle plan/apply/verification, save, reopen, independent read-back | Beta client |
| Claude Desktop 2.2553.1 | Desktop extension (`.mcpb`, built-in Node.js) | Install, saving the settings with their defaults, discovery, reads, backup, rectangle plan/apply/verification, save, reopen, read-back. Desktop cannot run doctor itself | Beta client (main install method) |
| Claude Desktop 2.2553.1 | stdio, configuration file | Registration, discovery, reads, backup, rectangle plan/apply/verification, save, reopen, read-back | Beta client (alternative install method) |
| Codex CLI 0.155.1 | stdio | Connection, approval, discovery, reads, backup, rectangle plan/apply/verification, save, reopen, read-back. The client used the plan's `next_call` and reached the applied edit without extra instructions | Beta client |
| ChatGPT Work Local | Local stdio (registered with the one-line `codex mcp add`) | Registration, discovery, reads, backup, rectangle plan/apply/verification, save, reopen, read-back. The client used the plan's `next_call` and reached the applied edit without extra instructions. Setup steps are in the [install guide](install.en.md#chatgpt-work-local) | Beta client |
| ChatGPT Work Cloud | Remote MCP | Not run | Not supported (this MCP drives a local Illustrator) |

Configuration alone, transport discovery, or success in another app does not establish support. For beta.2, each client above completed the bounded rectangle workflow on a test document with the same package that is published. This does not cover every editing operation or every failure path, and does not guarantee arbitrary artwork support.

## Per-operation live verification

Operations were measured individually on stable Illustrator 30.8.x. Principal paths were checked on 30.8.1, macOS 27.0, foreground and unlocked. Dedicated SDK-driven RGB and CMYK sessions each completed 103 consecutive changes and 108 changes including recovery. These are separate from the client-specific checks above.

- Supported inputs for shapes, text, placed images, layers, and other operations have individual measurements. The [82-tool catalog](tools.en.md) lists available functions; it does not promise live coverage of every input.
- Sessions cover 36 of 39 editing operations; delete, embed, and vector import are excluded. The prerequisite backup is limited to 1,000 items, so the effective session ceiling is also 1,000. This is extrapolated from one 600-item live run, not a measured 1,000-item workflow.
- CMYK stacking supports `front` only; compound-path creation is unsupported. Intermittent invalid group references remain unresolved; restart is not a guaranteed repair. Long document-key records and existing stroked text have known limits too.
- Do not generalize to background/locked operation, arbitrary artwork, or long-running production.

## Transports

| Transport | Evidence | Not established |
| --- | --- | --- |
| stdio | SDK automated tests; isolated installed package initialize and complete discovery | Every client workflow or arbitrary artwork |
| Streamable HTTP | SDK and HTTP-boundary automated tests; loopback, Bearer, Host/Origin checks | Public HTTPS, OAuth, Work Cloud connection, or Illustrator editing over HTTP |

HTTP is restricted to `127.0.0.1`. Tokens need at least 32 characters; only explicitly allowed Origins are accepted. This is not an externally accessible server.

## Beta and Stable

Beta is for trials within measured conditions and known limits. Stable requires separate acceptance for sustained use, recovery, updates, record retention, performance, and support. Built JavaScript is shipped without post-processing. Replaying unresolved commands from an older version is not guaranteed safe. See [recovery](runbook.en.md).
