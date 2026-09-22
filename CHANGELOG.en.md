# Changelog

[日本語](CHANGELOG.md) | **English**

Dates use JST (Asia/Tokyo).

## [0.1.0-beta.3] - 2026-09-22

[日本語](https://github.com/mhimt-lab/illustrator-studio-mcp/blob/main/CHANGELOG.md) | **English**

An update from 0.1.0-beta.1. It starts distributing the Claude Desktop extension (`.mcpb`) and helps AI apps build the arguments of editing tools correctly. It is not a production-ready release.

0.1.0-beta.2 was tagged on GitHub (`v0.1.0-beta.2`) but not published to npm or as a GitHub prerelease: the Desktop extension (`.mcpb`) could not be rebuilt with the same bytes, because the times stored in its zip depended on the build machine's time zone. 0.1.0-beta.3 has the same contents as 0.1.0-beta.2 (the `.mcpb` is now built with the same bytes in any time zone).

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

## [0.1.0-beta.2] - 2026-09-22

Not published (tag only). Same contents as 0.1.0-beta.3; see the 0.1.0-beta.3 entry above.

## [0.1.0-beta.1] - 2026-09-22

[日本語](https://github.com/mhimt-lab/illustrator-studio-mcp/blob/main/CHANGELOG.md) | **English**

This is the first Beta for operating stable Illustrator on Mac through an AI app, in the order of planning, checking immediately before writing, applying, and reading the result back. It is not a production-ready release.

**Requirement:** Keep Illustrator in the foreground and the screen unlocked. Many operations are refused in the background or with the screen locked.

#### Included

- Reading and inspection (documents, layers, selection, fonts, color usage, preflight checks, and more)
- Non-destructive editing of supported shapes, text, and images, including CMYK documents
- Continuous editing of saved files (edit sessions, experimental). Supports 36 of 39 editing operations; delete, image embedding, and vector import are excluded. The required starting backup is limited to 1,000 objects (extrapolated from one live run with 600 objects), making this the effective ceiling
- Backup, overwrite save, save as, and outlined AI/PDF export
- Image placement, relinking, embedding (JPEG/PNG in RGB documents only), and optimization
- stdio transport (MCP 2026-07-28)
- Distribution: npm's `beta` tag and a GitHub prerelease. The package includes the same bytes as the verified build, with no rewriting of runnable JavaScript during distribution

#### Out of scope

PNG, JPEG, and SVG export; artboard operations; paragraph styles; MCP Tasks; Windows; deleting multiple objects at once; missing-link repair; ungrouping.

#### Known limitations

- Streamable HTTP is covered only by automated tests and AI app connection checks. No Illustrator operation over HTTP has been recorded
- In CMYK documents, stacking-order changes support bring-to-front (`front`) only; compound-path creation is unsupported
- Reading groups can intermittently lose the reference to an item. The operation then stops on the safe side (fails closed)
- Execution records containing long document-identifying information may not be readable
- Existing stroked text is excluded from editing
- Automated tests on GitHub Actions have not passed at the time of this release (the full suite was checked locally)

Read [installation](docs/install.en.md), [compatibility](docs/compatibility.en.md), [recovery](docs/runbook.en.md), and the [LICENSE](LICENSE).
