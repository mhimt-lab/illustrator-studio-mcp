# Changelog

[日本語](CHANGELOG.md) | **English**

Dates use JST (Asia/Tokyo).

## [0.1.0-beta.5] - 2026-09-27

[日本語](https://github.com/mhimt-lab/illustrator-studio-mcp/blob/main/CHANGELOG.md) | **English**

An update from 0.1.0-beta.4. It adds PDF export with trim marks and bleed and editable trim marks in the document, sizing placed images (fit inside or cover a box, with the part to show) and moving, scaling, rotating and clipping images, replacing several font pairs at once, a read-only audit of Japanese line breaks, moving text frames, font replacement at booklet scale, moving and resizing the active artboard with a check of the exported pixel size, and a way to resolve a save-as that stopped part way. Results that cannot be confirmed and locked or hidden parents are handled more strictly. To prepare Windows support, it publishes a verification kit. It is not a production-ready release.

**Prerequisite:** keep Illustrator in the foreground with the screen unlocked. In the background or while the screen is locked, most operations are refused.

#### Added

- `illustrator_audit_typography` (read-only): reads the line breaks Illustrator actually composed in Japanese text and reports line-start and line-end prohibitions and unbreakable sequences (JLReq), protected terms you specify, half-width punctuation between Japanese characters, and overset area text. `policy` is a list; its only value is `jp_line_break_v1`. One read covers up to 200 frames, 20,000 characters, 2,000 lines and 2,000 paragraphs. Path text, threaded text, locked or hidden frames, vertical point text and empty frames are skipped with a reason, and the result is then partial. The document is not changed
- `illustrator_reconcile_save_as`: `illustrator_save_document_as` now records the run before it starts staging. When it stops part way, it returns `saveAsId` and a call to this tool (`nextCall`), and other changes, backups, exports and save-as runs are refused until it is resolved. This tool reads the stopped stage (`inspect`) and resolves it by closing without saving and opening the output (`switch_document`), removing only the hidden staging name (`cleanup_staging`), or releasing the record without deleting anything (`abandon`). It does not touch a save-as that another MCP server is still running
- The `translate` of `illustrator_transform_object` and `illustrator_mutate_batch` now moves unthreaded point and area text frames directly on a layer (horizontal or vertical, 1–512 characters). The plan pins the contents, visible lines, per-character formatting, paragraph alignment and columns, and they are checked just before applying and when reading back. Rotation and scaling are not supported
- `illustrator_update_artboard` (experimental): the active artboard can now also be moved and resized in whole points. The document origin follows the new board's lower-left corner. With `pixel` (width, height and scale 1 or 2) on a move, resize or add, the plan shows the pixel size `illustrator_export` would write and stops with `pixel_size_mismatch` if it does not match (it returns the difference and does not adjust anything)
- When the plan of an editing tool is blocked, it returns `next_steps` instead of `next_call`: the reason code (`blocked_by`), the next actions (`actions`, such as unlocking, showing, installing a font or narrowing the scope), and a short instruction for the AI app (`note`). The server instructions now also say to report the reason and next steps to the user when a call is refused, blocked or indeterminate, let the user decide, and never make the same change through GUI automation or a custom script
- `illustrator_export_pdf`: exports chosen artboards of a saved document as one new PDF. The source document and file are not changed, and an existing file is never overwritten. The PDF preset must match one of Illustrator's preset names exactly (PDF/X presets are not supported). You can add trim marks (Japanese or Roman), registration marks, color bars and page information, and bleed on four sides (0–72 pt). The page count, the trim size (TrimBox) and the bleed on each side are checked before the PDF is written out. Whether the preset's settings reached the PDF is not checked (the result says so). An export that stops part way is resolved with `illustrator_reconcile_export`
- `illustrator_create_trim_marks`: draws editable trim marks as paths at the four corners of an artboard, either on the trim edge only (8 lines) or also on the bleed edge (16 lines), as one group on a new front layer, stroked with the Registration color. Bleed, offset, length and stroke width are given in points. If a layer with the same name exists, it stops so that a second set is not added. Not available in an edit session
- `size` in `illustrator_place_image`: set the placed size by width or height (keeping the aspect ratio), fit inside a box with `contain`, cover a box with `cover`, or `stretch` only when named. With `contain` and `cover`, `focal_point` and `align_to` choose the part to show. The plan shows the placed size and the effective resolution on each axis, and warns (without stopping) below `minimum_effective_ppi`. `cover` does not clip the overflow. **Result shape changed:** the plan and result schema versions move from 1 to 3
- `illustrator_transform_object` now moves, scales and rotates (around the center) linked and embedded images directly on a layer or inside one unclipped group on a layer. A failed apply is undone with the verified inverse. Batches and alignment still exclude images
- `illustrator_create_clipping_mask` now clips images: an adjacent rectangular path masks an upright, uniformly scaled image on the same layer (an RGB PNG link, a CMYK TIFF link, or an embedded image in the document's color mode). Releasing and nesting image clips are not supported. **Result shape changed:** the plan and result schema versions move from 2 to 3
- `mappings` in `illustrator_replace_font`: replaces several font pairs (up to 16) in one apply, all or nothing. A repeated source, or a font that is both a source and a replacement (a chain or cycle), is refused before Illustrator is called. A scope larger than one apply stops with `mapping_scope_exceeds_limit` instead of replacing part of it. A single pair works as before. **Result shape changed:** the plan's source and replacement details moved into `plan.mappings[0]`, and the plan and result schema versions move from 1 to 3
- Illustrator versions: editing tools keep working on a patch release of a checked version (such as 30.8.x, stable releases only). On an unchecked stable version, some editing tools (such as embedding images, deleting, editing path points and importing SVG) accept `accept_unmeasured_host_version`. The AI app passes it only after the user explicitly agrees to run on that version, and changes to a file also need a verified backup. Capturing a preview and reading line spacing work on unchecked versions and Beta releases
<!-- windows-probe-kit:added:start -->
- Windows verification kit (`windows-probe/`, public repository only; not in the npm package): Windows support is in preparation. For people who have Windows and Illustrator, we published a kit and a guide (Japanese and English) that measure attaching to Illustrator, running scripts, and behavior while the screen is locked or Illustrator is in the background. Results are submitted through an issue form in the public repository (submitted results are public). The MCP server itself remains Mac only
<!-- windows-probe-kit:added:end -->

#### Changed

- `illustrator_replace_font` now works on booklet-scale documents (tens of thousands of characters, including threaded text, several paragraphs, justified and vertical text). `scope` (exactly one of `artboard_index`, `layer_path`, `selection: true` or `target_uuids`) narrows the range. A range that does not fit in one apply is planned in chunks: apply a chunk, plan the same scope again, and the plan moves to the next chunk. Frames that stopped the plan are returned with the reason and layer position, up to 64. One apply covers up to 40,000 characters, 1,000 style runs and 512 frames. **The result shape changed:** `usage.frames`, `expected_usage.frames` and `remaining.frames` are now `stories`, `usage.frameList` is now `usage.storyList`, and each entry gains `frames`
- `illustrator_export` now exports artboards with fractional edges when width and height times the scale are whole numbers (.5 pt at 1x; .25 pt or .5 pt at 2x), and boards with a nonzero whole-number origin. Unsupported sizes are refused with a reason before exporting. **The refusal codes changed:** `fractional_artboard_edge` is split into `fractional_pixel_size`, `fractional_edge_unmeasured` and `artboard_ruler_origin_unmeasured`
- When Illustrator returns an invalid reference during a read or a plan (such as the known intermittent group-reference issue), the call stops with the new error `ILLUSTRATOR_HOST_REFERENCE_INVALID`, returning the route, position and Illustrator's error number. The item is neither skipped nor treated as missing
- Applying a change takes about 0.2 seconds less (the disk flushes when the execution records are compacted are combined into one). Measured live, the mean apply of creating a rectangle, changing appearance and batch creation went from about 751 ms to about 544 ms (before and after alternated, 5 runs each). The record format and the safety checks are unchanged
- `illustrator_save_document` refuses to overwrite a file that has another name (a hard link). When save-as cannot remove its staging file, the result is indeterminate instead of `saved`
- SVG import (`illustrator_import_vector_artwork`) with text now stops in the plan at `tspan`s, nested groups and text whose rendering is ambiguous, and returns `next_steps`. SVG that is not well-formed XML is refused too (invalid SVG that Illustrator used to accept may now be refused)
- Refusals on unchecked versions now use one reason code, `host_version_unmeasured` (formerly `unmeasured_app_version`, `unsupported_host_version`, `spot_host_version_unverified`, `host_version_unverified` and `app_version_unmeasured`)
- The public README is rewritten with English as the main language (Japanese is in `README.ja.md`). The npm package page is in English as well

#### Fixed

- In a sync folder such as iCloud Drive's Desktop & Documents, the sync service flags files and advances only their change time (ctime), so save-as, save, close, backup, outlined export, PNG/JPEG export, image optimization and image inspection could fail or become indeterminate even though the contents were the same. When only ctime changes, the file is read again or its contents are compared; replacements and rewrites are still detected
- `illustrator_relink_image` and `illustrator_embed_image` could change a target inside a locked or hidden parent layer (the parent of a sublayer) or group. These tools and `illustrator_transform_object`, `illustrator_align_objects` and `illustrator_mutate_batch` now stop at the plan with `ancestor_locked` or `ancestor_hidden`, and `next_steps` suggests unlocking or showing it
- A failure to write a result on the Illustrator side (such as an empty file) is no longer treated as completed; the write is checked before the result is published. A read whose result cannot be read is indeterminate as well, and later operations are refused until `illustrator_reconcile` resolves it (previously it was released as a failed read)
- In documents with text that contains a variation selector (such as U+E0100), a read could return an empty result and fail
- When the helper process that drives Illustrator exited right after starting, the MCP server process could exit as well. The caller now receives the launch failure as before
- While an open document uses a font that is missing on this machine, Illustrator still finds it by name, so `illustrator_find_fonts`, `illustrator_replace_font` and `illustrator_set_text_style` treated missing fonts as installed. Fonts are now also checked outside Illustrator; a font that cannot be confirmed is reported as `unverified` and refused for writes
- SVG import passed verification even when characters that the first font lacks disappeared. The number of imported characters is now compared with the source SVG, and a mismatch is rolled back. A warning is given when the fonts actually used differ from the ones specified
- After `illustrator_set_area_text_columns` or `illustrator_update_character_style`, Illustrator kept the document marked unchanged, so saving was refused with `nothing_to_save` and closing lost the change. The document is now marked changed when a value actually changes
- `illustrator_create_backup` could stop with `restore_structure_mismatch` on documents with many items, so no backup could be taken before saving over the file. Each cause is fixed: SVG import now stops at the empty compound path it used to leave, and columns that are not saved in the file are reported with their cause
- Reducing an embedded image away from the origin with `illustrator_optimize_images` stopped at verification. The image now keeps its position. Images whose size is not a whole number of pixels, and documents whose ruler origin is not 0, are excluded in the plan

#### Known limitations

- A fractional bleed in `illustrator_export_pdf` (such as 8.5 pt for about 3 mm) passes the plan, but Illustrator rounds it to whole points, so the apply stops at verification (no wrong PDF is written). Use whole points for now
- Adobe Fonts that Creative Cloud activates only for Adobe applications cannot be confirmed on this machine, so font writes (replacement and text style changes) refuse them. This is a regression from beta.4. Text creation and the character style tools still check fonts inside Illustrator only
- `illustrator_create_trim_marks` has no Japanese or Roman default dimensions. Give every dimension
- `illustrator_optimize_images` can stop at render verification on large images (800×800 pt at the origin)
- The rules with which `illustrator_audit_typography` finds prohibited line breaks are verified by automated tests. Live checks covered only that documents with Hard kinsoku get zero line-start and line-end findings. Ruby, warichu and forced line breaks are not judged
- `illustrator_replace_font` does not support composite fonts. In a saved document, each chunk needs a backup and a save. If the replacement font lacks the glyphs, verification fails and the change is reverted
- Moving text frames has not been checked on CMYK documents
- In `illustrator_mutate_batch`, the appearance, text-replacement and text-style steps do not return `next_steps` when they stop at a locked or hidden parent group (nothing is written)
- Writing the `illustrator_run_m6_appearance_preview_recipe` preview to a sync folder such as iCloud can be refused as changed even when the contents are the same. Write it outside sync folders
- Appearance at creation does not support spot colors or gradients. Use `illustrator_set_path_appearance` after creating
- Exporting a 4000×3000 px JPEG temporarily used about 570 MiB of Node.js memory to check its size (one measurement)
- Streamable HTTP is limited to automated tests and client connection checks. There is no record of operating Illustrator over HTTP
- In CMYK documents, stacking order changes support only `front`, and compound path creation is not supported
- Group reads have a known intermittent issue where the target cannot be referenced. The cause is unresolved. When it happens, the operation stops on the safe side (fail closed), and results that cannot be confirmed are treated as indeterminate
- Execution records with long document identity information may not be readable back
- Existing stroked text cannot be edited
- The Desktop extension is not signed. Check the author and version in the install dialog
- Always include `@beta` with npm. An install without a tag uses `latest`, which may not be this version

<!-- windows-probe-kit:section:start -->
#### Windows verification kit

- Tag: `v0.1.0-beta.5`
- Kit SHA-256 (`--expect-sha256`): `421f2fe2943a177f52d9c83376b239207c449429f16b4538cdf0ff2b68b31573`
- Guide: [`windows-probe/README.en.md`](https://github.com/mhimt-lab/illustrator-studio-mcp/blob/v0.1.0-beta.5/windows-probe/README.en.md)
<!-- windows-probe-kit:section:end -->

Read [installation](docs/install.en.md), [compatibility](docs/compatibility.en.md), [recovery](docs/runbook.en.md), and the [LICENSE](LICENSE).

## [0.1.0-beta.4] - 2026-09-23

[日本語](https://github.com/mhimt-lab/illustrator-studio-mcp/blob/main/CHANGELOG.md) | **English**

An update from 0.1.0-beta.3. It adds adding artboards and switching the active one, renaming, moving and resizing existing ones, PNG/JPEG export of one artboard, and appearance at creation to cut round trips when drawing, and fixes defects. It is not a production-ready release.

**Prerequisite:** keep Illustrator in the foreground with the screen unlocked. In the background or while the screen is locked, most operations are refused.

#### Added

- `illustrator_export`: export one artboard of a saved, unmodified RGB document as one new PNG24 or JPEG file. The source document and file are not changed, and an existing file is never overwritten. Scale 1 or 2, at most 4000 px per side and 12,000,000 px in total, artboards whose edges are whole points; the exported file's pixel size is checked against the plan. An opaque PNG is 1x only. SVG is not supported yet
- `illustrator_reconcile_export`: when `illustrator_export` stops with an indeterminate result, `finalize`, `abandon` and `release_quarantined` are available as allowed at the stop point
- `illustrator_update_artboard` (experimental): plan, apply and read back a rename of an existing artboard, an integer-point move or resize of an inactive one, an active-board switch, or appending a named board. Saved RGB documents only, up to 256 boards, 128 ordinary paths directly on layers and 256 total points; every board origin must be `[0,0]`. Rename, move, resize and adding leave the document unsaved, so save before the next change; an active switch needs no save. This server has no way to remove an added board. Web pixel profiles and edit sessions are unsupported
- `illustrator_create_rectangle` and `illustrator_create_shape` can set opacity, fill and stroke (RGB, CMYK, gray or none) at creation; they are written and read back in the same apply. `illustrator_create_batch` now takes shapes (`create_shape`) and the initial appearance of rectangles and shapes, and its limit rises from 8 to 16 steps (up to 256 shape anchors in total). A layout of about 12 objects takes one plan and one apply

#### Changed

- The published package now depends on `jpeg-js` (BSD-3-Clause), used to decode every exported JPEG and check its pixel size
- Backup's document-structure check now compares the second read of the same document exactly against the first instead of computing its SHA-256 again. The strength of the check and the backup limit (1,000 objects) are unchanged. In one live run, a 600-object backup went from about 18.0 s to about 11.5 s, and a 1,000-object backup took about 18.3 s
- Applying a change during an edit session is about 0.2 s faster per call (a lighter check that Illustrator is in the foreground; median of 5 live runs each)
- Continuous editing was checked live through a CMYK production flow: 62 changes, detection of and recovery from an external change, resend, save and reopen

#### Fixed

- When the check right before apply refuses a change (for example, the target changed after the plan), the result now gives the kind of refusal, the reason, and the next step: plan again and apply with a new `command_id`. Nothing is written, as before. Resending the same `command_id` still returns the previous message
- When a group reference was temporarily unreadable, rolling back a rectangle creation and verifying an edit session could treat the item as absent and report success. When absence cannot be proven, the result is now indeterminate and the edit session does not advance
- A star made by `illustrator_create_shape` stayed selected, changing the user's selection. Stars are now created without changing the selection, like the other shapes
- `illustrator_capture_preview` failed with `PREVIEW_OUTPUT_INVALID` when every pixel in the range was opaque. It now returns the RGB PNG that Illustrator wrote, with `image.pixelFormat` set to `rgb8_opaque`. A range with transparent pixels is RGBA (`rgba8_straight_alpha`) as before
- `illustrator_set_path_appearance` plans did not carry `next_call`
- A backup could fail when the restore-test copy differed from the source by a tiny amount within tolerance, because the comparison read the wrong document
- The description of `illustrator_open_edit_session` now matches what it accepts (up to 2,000 items including nested ones; groups, clip groups, compound paths and linked placed images)
- Setting the fill of an existing object to none with `illustrator_set_path_appearance` was always rolled back on a verification mismatch
- `illustrator_update_artboard` plans now carry `next_call`

#### Known limitations

- Appearance at creation does not support spot colors or gradients. Use `illustrator_set_path_appearance` after creating the object
- Exporting a 4000×3000 px JPEG used about 570 MiB of Node.js memory at peak while checking its size (one measurement)
- Streamable HTTP is covered only by automated tests and AI app connection checks. No Illustrator operation over HTTP has been recorded
- In CMYK documents, stacking-order changes support bring-to-front (`front`) only; compound-path creation is unsupported
- Reading groups can intermittently lose the reference to an item. The cause is unresolved. The operation then stops on the safe side (fails closed), and a result that cannot be confirmed is reported as indeterminate
- Execution records containing long document-identifying information may not be readable
- Existing stroked text is excluded from editing
- The Desktop extension is not signed. Check the author and version in the install dialog
- Always include `@beta` with npm. An install without a tag uses `latest`, which may not be this version

Read [installation](docs/install.en.md), [compatibility](docs/compatibility.en.md), [recovery](docs/runbook.en.md), and the [LICENSE](LICENSE).

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
