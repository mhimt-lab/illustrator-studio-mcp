# 84 MCP tools

[日本語](tools.md) | **English**

All 84 tool names discovered from the installed Public Beta 0.1.0-beta.4 package. It lists availability, not live verification of every input. Ask your AI app for the current input schema; do not guess argument names. See [verified scope](compatibility.en.md), [installation](install.en.md), and [recovery](runbook.en.md).

Keep stable Illustrator in the foreground and the screen unlocked. Sessions cover 36 editing operations; delete, embed, vector import and artboard updates are excluded. Backup and the effective session ceiling are 1,000 items, checked in one 1,000-item live run. SVG export, artboard removal/Web pixel profiles, paragraph styles, ungrouping, missing-link repair, and Windows remain outside Beta scope. A preview capture is not a general export tool. Deleting one object requires its explicit backup and confirmation contract.

| # | Tool identifier |
| --- | --- |
| 1 | `illustrator_align_objects` |
| 2 | `illustrator_apply_character_style` |
| 3 | `illustrator_apply_pathfinder` |
| 4 | `illustrator_capture_preview` |
| 5 | `illustrator_capture_structure_snapshot` |
| 6 | `illustrator_check_contrast` |
| 7 | `illustrator_check_text_consistency` |
| 8 | `illustrator_close_document` |
| 9 | `illustrator_close_edit_session` |
| 10 | `illustrator_compare_images` |
| 11 | `illustrator_create_area_text` |
| 12 | `illustrator_create_backup` |
| 13 | `illustrator_create_batch` |
| 14 | `illustrator_create_character_style` |
| 15 | `illustrator_create_clipping_mask` |
| 16 | `illustrator_create_document` |
| 17 | `illustrator_create_layer` |
| 18 | `illustrator_create_point_text` |
| 19 | `illustrator_create_rectangle` |
| 20 | `illustrator_create_shape` |
| 21 | `illustrator_create_swatch_resource` |
| 22 | `illustrator_delete_objects` |
| 23 | `illustrator_diff_structure` |
| 24 | `illustrator_duplicate_object` |
| 25 | `illustrator_edit_path_points` |
| 26 | `illustrator_embed_image` |
| 27 | `illustrator_export` |
| 28 | `illustrator_export_outlined` |
| 29 | `illustrator_extract_design_tokens` |
| 30 | `illustrator_find_color_usages` |
| 31 | `illustrator_find_fonts` |
| 32 | `illustrator_get_area_text_options` |
| 33 | `illustrator_get_context` |
| 34 | `illustrator_get_edit_session` |
| 35 | `illustrator_get_object` |
| 36 | `illustrator_get_path_points` |
| 37 | `illustrator_group_objects` |
| 38 | `illustrator_import_vector_artwork` |
| 39 | `illustrator_list_documents` |
| 40 | `illustrator_list_layers` |
| 41 | `illustrator_list_objects` |
| 42 | `illustrator_list_recipes` |
| 43 | `illustrator_list_selection` |
| 44 | `illustrator_list_swatches` |
| 45 | `illustrator_list_text_styles` |
| 46 | `illustrator_make_compound_path` |
| 47 | `illustrator_move_object_to_layer` |
| 48 | `illustrator_mutate_batch` |
| 49 | `illustrator_open_document` |
| 50 | `illustrator_open_edit_session` |
| 51 | `illustrator_optimize_images` |
| 52 | `illustrator_place_image` |
| 53 | `illustrator_plan_color_replacement` |
| 54 | `illustrator_plan_recipe` |
| 55 | `illustrator_preflight_images` |
| 56 | `illustrator_preflight_print` |
| 57 | `illustrator_read_structure_diff` |
| 58 | `illustrator_reconcile` |
| 59 | `illustrator_reconcile_backup` |
| 60 | `illustrator_reconcile_delete` |
| 61 | `illustrator_reconcile_export` |
| 62 | `illustrator_release_clipping_mask` |
| 63 | `illustrator_relink_image` |
| 64 | `illustrator_reorder_layer` |
| 65 | `illustrator_replace_font` |
| 66 | `illustrator_replace_point_text` |
| 67 | `illustrator_replace_point_text_batch` |
| 68 | `illustrator_replace_text_range` |
| 69 | `illustrator_run_m6_appearance_preview_recipe` |
| 70 | `illustrator_run_recipe` |
| 71 | `illustrator_save_document` |
| 72 | `illustrator_save_document_as` |
| 73 | `illustrator_save_recipe` |
| 74 | `illustrator_set_area_text_columns` |
| 75 | `illustrator_set_layer_state` |
| 76 | `illustrator_set_no_break` |
| 77 | `illustrator_set_object_state` |
| 78 | `illustrator_set_path_appearance` |
| 79 | `illustrator_set_stacking_order` |
| 80 | `illustrator_set_text_orientation` |
| 81 | `illustrator_set_text_style` |
| 82 | `illustrator_transform_object` |
| 83 | `illustrator_update_artboard` |
| 84 | `illustrator_update_character_style` |

## Plan, then apply (`next_call` and `command_id`)

Every change is two calls: `apply: false` returns a plan, and `apply: true` with a `command_id` carries it out. All 40 mutation tools return `next_call` when the plan has no blockers and its complete apply arguments pass the public input schema. This contains the tool name and exact apply arguments, including a fresh `command_id` candidate. Send those arguments unchanged. Coverage includes duplication, grouping, stacking, compound paths, Pathfinder, clipping, layers, character styles, font replacement, embedding, path editing, deletion, vector import, batches, alignment and artboard updates. Blocked, incomplete or inconsistent plans return no candidate. A candidate does not bypass document, target, backup, indeterminate-command or other apply-time checks. `illustrator_export` returns the exact apply arguments in its plan result as `nextCall`.

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

`illustrator_update_artboard` is experimental: in saved RGB documents it renames a board, updates an inactive board with an integer-point rect, switches the active board, or appends a named integer-point board. Adding makes the new board active, and adding or switching sets the document origin to `[-left,-bottom]` of the active board. It is accepted only when every board origin is `[0,0]` and the document origin already follows that rule; otherwise the plan is blocked (`unmeasured_ruler_origin`). Rename, rect updates and adding leave the document unsaved, so save before the next change; an active switch keeps a saved document saved. This server has no way to remove an added artboard. Up to 256 boards, 128 ordinary paths directly on layers and 256 total points. Web pixel profiles and edit sessions are unsupported. The live product-path check passed for rename and its inverse, inactive rect and its inverse, adding, and an active switch and its inverse.

`illustrator_export` exports one artboard of a saved, unmodified RGB document as one new PNG24 or JPEG file. The source document and file are not changed. The export runs on a work copy; the file is fully decoded and its pixel size must equal the plan before it is published. An existing path is refused, never overwritten. Supported: artboards whose edges are whole points, scale 1 or 2 (size = artboard pt × scale, exact), at most 4000 px per side and 12,000,000 px in total, artboard ruler origin `[0,0]`, and an opaque PNG only at 1x. Anything else, unsaved changes, never-saved documents, open edit sessions, CMYK and linked images are refused in the plan. SVG is not supported yet. Exports run one at a time. After an indeterminate result, `illustrator_reconcile_export` offers the actions allowed at the stop point: `inspect`, `close_work_copy`, `finalize` (record a publication that already happened, then clean up), `abandon` (record the export as failed without publishing; files are kept), and `release_quarantined` (with `confirm_export_id`, after you have checked the files).
