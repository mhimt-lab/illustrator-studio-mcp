# 88 MCP tools

[日本語](tools.md) | **English**

All 88 tool names published in this release. It lists availability, not live verification of every input. Ask your AI app for the current input schema; do not guess argument names. See [verified scope](compatibility.en.md), [installation](install.en.md), and [recovery](runbook.en.md).

Keep stable Illustrator in the foreground and the screen unlocked. Sessions cover 36 editing operations; delete, embed, vector import and artboard updates are excluded. Backup and the effective session ceiling are 1,000 items, checked in one 1,000-item live run. SVG export, artboard removal, paragraph styles, ungrouping, missing-link repair, and Windows remain outside Beta scope. A preview capture is not a general export tool. Deleting one object requires its explicit backup and confirmation contract.

| # | Tool identifier |
| --- | --- |
| 1 | `illustrator_align_objects` |
| 2 | `illustrator_apply_character_style` |
| 3 | `illustrator_apply_pathfinder` |
| 4 | `illustrator_audit_typography` |
| 5 | `illustrator_capture_preview` |
| 6 | `illustrator_capture_structure_snapshot` |
| 7 | `illustrator_check_contrast` |
| 8 | `illustrator_check_text_consistency` |
| 9 | `illustrator_close_document` |
| 10 | `illustrator_close_edit_session` |
| 11 | `illustrator_compare_images` |
| 12 | `illustrator_create_area_text` |
| 13 | `illustrator_create_backup` |
| 14 | `illustrator_create_batch` |
| 15 | `illustrator_create_character_style` |
| 16 | `illustrator_create_clipping_mask` |
| 17 | `illustrator_create_document` |
| 18 | `illustrator_create_layer` |
| 19 | `illustrator_create_point_text` |
| 20 | `illustrator_create_rectangle` |
| 21 | `illustrator_create_shape` |
| 22 | `illustrator_create_swatch_resource` |
| 23 | `illustrator_create_trim_marks` |
| 24 | `illustrator_delete_objects` |
| 25 | `illustrator_diff_structure` |
| 26 | `illustrator_duplicate_object` |
| 27 | `illustrator_edit_path_points` |
| 28 | `illustrator_embed_image` |
| 29 | `illustrator_export` |
| 30 | `illustrator_export_outlined` |
| 31 | `illustrator_export_pdf` |
| 32 | `illustrator_extract_design_tokens` |
| 33 | `illustrator_find_color_usages` |
| 34 | `illustrator_find_fonts` |
| 35 | `illustrator_get_area_text_options` |
| 36 | `illustrator_get_context` |
| 37 | `illustrator_get_edit_session` |
| 38 | `illustrator_get_object` |
| 39 | `illustrator_get_path_points` |
| 40 | `illustrator_group_objects` |
| 41 | `illustrator_import_vector_artwork` |
| 42 | `illustrator_list_documents` |
| 43 | `illustrator_list_layers` |
| 44 | `illustrator_list_objects` |
| 45 | `illustrator_list_recipes` |
| 46 | `illustrator_list_selection` |
| 47 | `illustrator_list_swatches` |
| 48 | `illustrator_list_text_styles` |
| 49 | `illustrator_make_compound_path` |
| 50 | `illustrator_move_object_to_layer` |
| 51 | `illustrator_mutate_batch` |
| 52 | `illustrator_open_document` |
| 53 | `illustrator_open_edit_session` |
| 54 | `illustrator_optimize_images` |
| 55 | `illustrator_place_image` |
| 56 | `illustrator_plan_color_replacement` |
| 57 | `illustrator_plan_recipe` |
| 58 | `illustrator_preflight_images` |
| 59 | `illustrator_preflight_print` |
| 60 | `illustrator_read_structure_diff` |
| 61 | `illustrator_reconcile` |
| 62 | `illustrator_reconcile_backup` |
| 63 | `illustrator_reconcile_delete` |
| 64 | `illustrator_reconcile_export` |
| 65 | `illustrator_reconcile_save_as` |
| 66 | `illustrator_release_clipping_mask` |
| 67 | `illustrator_relink_image` |
| 68 | `illustrator_reorder_layer` |
| 69 | `illustrator_replace_font` |
| 70 | `illustrator_replace_point_text` |
| 71 | `illustrator_replace_point_text_batch` |
| 72 | `illustrator_replace_text_range` |
| 73 | `illustrator_run_m6_appearance_preview_recipe` |
| 74 | `illustrator_run_recipe` |
| 75 | `illustrator_save_document` |
| 76 | `illustrator_save_document_as` |
| 77 | `illustrator_save_recipe` |
| 78 | `illustrator_set_area_text_columns` |
| 79 | `illustrator_set_layer_state` |
| 80 | `illustrator_set_no_break` |
| 81 | `illustrator_set_object_state` |
| 82 | `illustrator_set_path_appearance` |
| 83 | `illustrator_set_stacking_order` |
| 84 | `illustrator_set_text_orientation` |
| 85 | `illustrator_set_text_style` |
| 86 | `illustrator_transform_object` |
| 87 | `illustrator_update_artboard` |
| 88 | `illustrator_update_character_style` |

## Guide by task

Each item under “What you can do” in the README links here. Conditions differ by task; see the [verified scope](compatibility.en.md).

### Create shapes and text
`illustrator_create_batch` plans several shapes and point texts together and creates them in one apply, then reads each one back from Illustrator. Single items use `illustrator_create_shape`, `illustrator_create_point_text` and `illustrator_create_area_text`.

### Align and space evenly
`illustrator_align_objects` aligns 2–16 paths to the first target or the artboard (left, center, right, top, middle, bottom), or spaces 3–16 paths evenly by their centers. Targets are paths (`PathItem`), measured without stroke width.

### Replace text in one go
`illustrator_replace_point_text_batch` replaces 2–32 point texts at once, and `illustrator_mutate_batch` runs 2–16 steps of text, style, move and path changes. If any target is unsupported, nothing is written.

### Check Japanese line breaks
`illustrator_audit_typography` reads the line breaks Illustrator actually set and reports line-start and line-end kinsoku, unbreakable sequences, protected terms you list, half-width punctuation between Japanese characters, and overset text. It does not change the document. Forced line breaks, justified spacing, ruby and warichu are not checked (details below).

### Replace several fonts at once
`mappings` in `illustrator_replace_font` replaces up to 16 font pairs in one apply, all or nothing. It only uses installed fonts that the OS and Illustrator's font lists confirm; it does not write fonts it cannot confirm (a font missing on this Mac, or one Creative Cloud activates only for Adobe apps). Composite fonts are not supported.

### Switch to vertical text
`illustrator_set_text_orientation` switches unthreaded point or area text directly on a layer between horizontal and vertical, optionally with leading. Area text changes only when the whole story fits before and after.

### Fit a photo to a frame
`size` in `illustrator_place_image` sets a width or height, fits the photo inside a box (`contain`) or fills it (`cover`). `focal_point` (the point of the photo to show) and `align_to` (center or a thirds intersection) set the position, clamped so the frame stays filled. The plan shows the placed size and the effective PPI. `cover` does not crop the overflow; crop it with a clipping mask.

### Crop a photo
`illustrator_create_clipping_mask` makes a clipping mask from a rectangular path directly in front of a photo. The image must be upright and uniformly scaled: a PNG link in an RGB document, a TIFF link in a CMYK document, or an embedded image matching the document. Releasing or nesting image clips is not supported.

### Check before printing
`illustrator_preflight_print` checks color, inks, overprint, transparency, bleed, strokes, fonts and images; `illustrator_preflight_images` checks linked and embedded image identity and effective resolution. Items it could not confirm are never reported as passing.

### PDF with bleed and trim marks
`illustrator_export_pdf` writes chosen artboards of a saved document to a new PDF, with trim marks, registration marks, color bars and page information (Japanese or Roman style) and 0–72 pt of bleed on each side. It checks the page count, trim size and bleed of the written PDF before publishing it, and never overwrites a file. Give bleed in whole points: Illustrator rounds a fraction, so the check of the written PDF stops the export. PDF/X presets are not available.

### Add trim marks to the document
`illustrator_create_trim_marks` draws editable trim marks around an artboard as paths on a new layer. Bleed, offset, length and stroke width are given in points (there are no presets; use your printer's values). If the PDF export also adds trim marks, use only one of them.

### Export with outlined text
`illustrator_export_outlined` outlines all text in a work copy and writes a new AI or PDF. The original document and file are not changed.

### Keep your manual edits
Every change goes plan → check again right before writing → apply → read back. If the target changed after the plan, it stops before writing. See [Safety](safety.en.md).

### Back up before saving over
`illustrator_create_backup` copies the saved file, opens the copy and compares it before recording the backup. Saving over a file and deleting require this backup. If an outcome is unclear, check the state with the [recovery guide](runbook.en.md).

## Plan, then apply (`next_call` and `command_id`)

Every change is two calls: `apply: false` returns a plan, and `apply: true` with a `command_id` carries it out. All 40 mutation tools return `next_call` when the plan has no blockers and its complete apply arguments pass the public input schema. This contains the tool name and exact apply arguments, including a fresh `command_id` candidate. Send those arguments unchanged. Coverage includes duplication, grouping, stacking, compound paths, Pathfinder, clipping, layers, character styles, font replacement, embedding, path editing, deletion, vector import, batches, alignment and artboard updates. Blocked, incomplete or inconsistent plans return no candidate. A candidate does not bypass document, target, backup, indeterminate-command or other apply-time checks. `illustrator_export` returns the exact apply arguments in its plan result as `nextCall`.

A blocked plan returns `next_steps` instead of `next_call`: the reason code (`blocked_by`), the next actions (`actions`: `resolve_document_state`, `reconcile`, `unlock_target`, `show_target`, `install_font`, `narrow_scope`, `unsupported`, `fix_request`), and a short instruction for the AI app (`note`). Do not make the same change through GUI automation or a custom script; report the reason and next steps to the user.

`command_id` is a lowercase UUID v4 (`xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx`), for example `next_call.arguments.command_id` or `uuidgen | tr A-Z a-z`. Resend the same value only to retry the same apply, including after a timeout and `illustrator_reconcile`; that returns the recorded result instead of applying twice. After planning again, use the new plan's candidate. A plan's candidate is not recorded by the server, and an apply from an older plan is still refused when the document no longer matches that plan's `before`.

An argument error names each missing required argument and suggests the right name for an unknown one (for example `document_key` → `expected_document_key`).

## Result field notes

| Field | Tools | Meaning |
| --- | --- | --- |
| `keyShort` | every tool that returns a document context | First 16 hex characters of SHA-256 over `key`; accepted as `expected_document_key`. |
| `mutationProfile` | every tool that returns a document context | `saved_file`: verified file revision; `unsaved_document`: no backing file exists; `edit_session_file`: file of an open edit session; `null`: blocked. |
| `bundleId` | application information | Configured bundle identifier the bridge addresses; `null` when `ILLUSTRATOR_APPLICATION` is a LaunchServices name. |
| `version` | application information | `app.version` reported by the Illustrator instance that executed this read. |
| `templateState` | `illustrator_list_layers` | Template state is unavailable from the Illustrator Layer scripting API; create tools assume `non_template`. |
| `editable` | `illustrator_list_layers` | True when the layer and every ancestor are visible and unlocked (structural conditions only). |
| `editabilityBlockedReasons` | `illustrator_list_layers` | Structural blockers in production order: `layer_hidden`, `ancestor_hidden`, `layer_locked`, `ancestor_locked`. Empty when editable. |
| `document` | `illustrator_save_document_as` | The document reopened from `output_path`: a new Document object with a new key; page-item UUIDs are not preserved across the reopen. For `output_exists`: the document is still open and points at the retained staged file. |
| `previousFilePreserved` | `illustrator_save_document_as` | `true` when the file the document pointed at before is byte-identical; `null` for a document that had no file. |
| `path` | document lifecycle tools | File the host may have written or re-pointed to. |
| `files` | document lifecycle tools | Save-as only: the staged file (retained) and the published output, when they exist. |
| `editSession` | `illustrator_save_document` | Present when the file belonged to an open edit session; the full scan matched its head right before save. |
| `editSession.state` | `illustrator_save_document` | `closed` once the saved file ends the session; `open` only if closing it failed (the next change then suspends it on the new file revision). |
| `document` | `illustrator_open_document` | For `already_open`: the document that already uses the path. |
| `filePreserved` | `illustrator_close_document` | `true` when the closed document's file is byte-identical to before; `null` when it had no file. |

`illustrator_update_artboard` is experimental: in saved RGB documents it renames a board, updates a board (including the active one) with an integer-point rect, switches the active board, or appends a named integer-point board. Adding makes the new board active, and adding or switching sets the document origin to `[-left,-bottom]` of the active board. Moving or resizing the active board also moves the document origin to `[-left,-bottom]` of the new board. It is accepted only when every board origin is `[0,0]` and the document origin already follows that rule; otherwise the plan is blocked (`unmeasured_ruler_origin`). Rename, rect updates and adding leave the document unsaved, so save before the next change; an active switch keeps a saved document saved. This server has no way to remove an added artboard. Up to 256 boards, 128 ordinary paths directly on layers and 256 total points. With `pixel` (width, height and scale 1 or 2; at most 4000 px per side and 12,000,000 px in total) on a rect update or add, the plan shows the pixel size `illustrator_export` would write and blocks with `pixel_size_mismatch` if it differs (it returns the difference and adjusts nothing). Fractional points and edit sessions are unsupported. The live product-path check passed for rename and its inverse, inactive rect and its inverse, adding, an active switch and its inverse, an active rect and its inverse, and a matching and a mismatching `pixel`.

`illustrator_export` exports one artboard of a saved, unmodified RGB document as one new PNG24 or JPEG file. The source document and file are not changed. The export runs on a work copy; the file is fully decoded and its pixel size must equal the plan before it is published. An existing path is refused, never overwritten. Supported: scale 1 or 2 (size = artboard width and height × scale, exact), edges whose width and height times the scale are whole numbers (fractions of .5 pt at 1x, .25 pt or .5 pt at 2x), at most 4000 px per side and 12,000,000 px in total, a whole-number artboard ruler origin, and an opaque PNG only at 1x. Unsupported sizes are refused with `fractional_pixel_size`, `fractional_edge_unmeasured` or `artboard_ruler_origin_unmeasured`. Anything else, unsaved changes, never-saved documents, open edit sessions, CMYK and linked images are refused in the plan. SVG is not supported yet. Exports run one at a time. After an indeterminate result, `illustrator_reconcile_export` offers the actions allowed at the stop point: `inspect`, `close_work_copy`, `finalize` (record a publication that already happened, then clean up), `abandon` (record the export as failed without publishing; files are kept), and `release_quarantined` (with `confirm_export_id`, after you have checked the files).

`illustrator_audit_typography` is read-only. It reads the line breaks Illustrator composed in Japanese text and reports line-start prohibitions (`JP_LINE_START_PROHIBITED`), line-end prohibitions (`JP_LINE_END_PROHIBITED`), unbreakable sequences (`JP_UNBREAKABLE_SPLIT`), protected terms you specify (`JP_PROTECTED_TERM_SPLIT`, `protected_terms`), half-width punctuation between Japanese characters (`JP_HALFWIDTH_PUNCTUATION`) and overset area text (`JP_OVERSET`). `policy` is a list; its only value is `jp_line_break_v1`. One read covers up to 200 frames, 20,000 characters, 2,000 lines and 2,000 paragraphs. Path text, threaded text, locked or hidden frames, vertical point text and empty frames are skipped with a reason, and the result is partial (`incomplete`). Forced line breaks, the hidden overset part, justified spacing, ruby and warichu are not judged. If the document's saved state changes during the read, it returns an error instead of a result.

`illustrator_replace_font` takes `scope` (exactly one of `artboard_index`, `layer_path`, `selection: true` or `target_uuids`). One apply covers up to 40,000 characters, 1,000 style runs and 512 frames; one plan scans up to 100,000 characters. A larger range is planned in chunks (`remaining`): apply a chunk, plan the same scope again, and the plan moves to the next chunk. Locked, hidden, unreadable and unsupported frames are returned in `plan.blockedFrames` with the reason and layer position, up to 64. Usage is reported as `usage.stories` and `usage.storyList`, and each entry has `frames`. Composite fonts are not supported.

The `translate` of `illustrator_transform_object` and `illustrator_mutate_batch` also moves unthreaded point and area text frames directly on a layer (horizontal or vertical, 1–512 characters). Path text, threaded text, text in groups, text with spot colors or gradients, and scaled or rotated text are refused in the plan. `illustrator_align_objects` does not handle text frames.

`illustrator_save_document_as` records the run before it starts staging. When it stops part way, it returns `saveAsId` and `nextCall`, and other changes, backups, exports and save-as runs are refused until it is resolved. `illustrator_reconcile_save_as` resolves it with `inspect` (read-only), `switch_document` (requires `confirm_document_key`; closes the document without saving or writing anything and opens the output), `cleanup_staging` (removes only the hidden staging name) or `abandon` (requires `confirm_save_as_id`; releases the record without deleting anything). It does not touch a save-as another MCP server is still running. The result's `outputHidden` is the hidden flag a sync folder sets on the output (`null` when it cannot be read).
