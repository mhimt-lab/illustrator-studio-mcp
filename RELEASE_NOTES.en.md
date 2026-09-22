# Public Beta 0.1.0-beta.2

[日本語](RELEASE_NOTES.md) | **English**

Published: 2026-09-22 JST (Asia/Tokyo).

An update from 0.1.0-beta.1. It starts distributing the Claude Desktop extension (`.mcpb`) and helps AI apps build the arguments of editing tools correctly. It is not a production-ready release.

**Requirement:** Keep Illustrator in the foreground and the screen unlocked. Many operations are refused in the background or with the screen locked.

#### Added

- The Claude Desktop extension (`.mcpb`) is distributed with the GitHub prerelease. It runs on the Node.js built into Desktop and bundles its runtime dependencies. It is built from the reviewed npm package (tgz), and the same tgz reproduces the same bytes. `SHA256SUMS` lists the extension too
- ChatGPT Work Local is now a supported AI app. Register it with the one-line `codex mcp add`

#### Changed

- Plans of editing tools (`apply: false`) return a `next_call`. It is added for creation tools and for tools whose apply sends plan values back, and contains the arguments to pass to apply unchanged, including a fresh `command_id` candidate
- Every tool's input schema describes the `command_id` format (lowercase UUID v4) and when the same value may be resent (only to retry the same apply)
- Argument errors name missing required arguments, suggest the correct name for unknown ones, and quote a refused `command_id`
- Codex CLI and ChatGPT Work Local were confirmed to reach the applied edit without extra instructions
- The Desktop extension's "Illustrator application" setting can be saved with its default `id:com.adobe.illustrator`

#### Fixed

- Under Claude Desktop's built-in Node.js, the helper process that drives Illustrator could not start

#### Known limitations

- Streamable HTTP is covered only by automated tests and AI app connection checks. No Illustrator operation over HTTP has been recorded
- In CMYK documents, stacking-order changes support bring-to-front (`front`) only; compound-path creation is unsupported
- Reading groups can intermittently lose the reference to an item. The operation then stops on the safe side (fails closed)
- Execution records containing long document-identifying information may not be readable
- Existing stroked text is excluded from editing
- The Desktop extension is not signed. Check the author and version in the install dialog
- Always include `@beta` with npm. An install without a tag uses `latest`, which may not be this version

Read [installation](docs/install.en.md), [compatibility](docs/compatibility.en.md), [recovery](docs/runbook.en.md), and the [LICENSE](LICENSE).

Changes in earlier versions are in the [changelog](CHANGELOG.en.md).
