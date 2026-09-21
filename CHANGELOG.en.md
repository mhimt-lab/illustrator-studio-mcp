# Changelog

[日本語](CHANGELOG.md) | **English**

Dates use JST (Asia/Tokyo).

## [0.1.0-beta.1] - 2026-09-22

[日本語](https://github.com/mhimt-lab/illustrator-studio-mcp/blob/main/RELEASE_NOTES.md) | **English**

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
