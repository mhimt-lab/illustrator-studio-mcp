# Illustrator Studio MCP

[![License: BUSL-1.1](https://img.shields.io/badge/license-BUSL--1.1-blue.svg)](LICENSE) ![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg) ![Node.js >=20](https://img.shields.io/badge/node-%3E%3D20-339933.svg) ![MCP: 2026-07-28](https://img.shields.io/badge/MCP-2026--07--28-blue.svg) ![Status: beta](https://img.shields.io/badge/status-beta-orange.svg) [![npm beta version](https://img.shields.io/npm/v/illustrator-studio-mcp/beta)](https://www.npmjs.com/package/illustrator-studio-mcp)

[日本語](README.md) | **English**

**Ask an AI assistant to do your Illustrator work, in plain words.**

For example:

- “Change the selected headline to ‘Weekend Special’. Keep its size and color.”
- “Space these three shapes evenly in a row.”
- “Swap this photo for the latest version. Keep its position and size.”

Before changing anything, it shows what will change and where. Afterwards, it reads the result back from Illustrator to check it. This is a Public Beta (0.1.0-beta.4).

[84 functions](docs/tools.en.md) · [Checked operation by operation on Illustrator 2026 (30.8)](docs/compatibility.en.md) · Works with Claude Desktop, ChatGPT, Claude Code, and Codex CLI

## AI apps and how to start

### Claude Desktop (easiest, no Node.js needed)

1. [Download illustrator-studio-mcp-0.1.0-beta.4.mcpb](https://github.com/mhimt-lab/illustrator-studio-mcp/releases/download/v0.1.0-beta.4/illustrator-studio-mcp-0.1.0-beta.4.mcpb), double-click it, then click Install.
2. Check that the extension is enabled, then start using it in a new chat.

To check the downloaded file, compare it with `SHA256SUMS` on the [GitHub release page](https://github.com/mhimt-lab/illustrator-studio-mcp/releases/tag/v0.1.0-beta.4) (steps in [Install](docs/install.en.md#desktop-extension-mcpb-main-method)).

### ChatGPT

You need: Node.js 20 or newer (install it with the installer from the [official website](https://nodejs.org/))

1. In the ChatGPT sidebar, open Plugins, then choose Add (top right) → Add a marketplace.
2. Enter `mhimt-lab/illustrator-studio-mcp` as the Source and `v0.1.0-beta.4` as the Git ref, then click Add marketplace. The Git ref pins the version.
3. On the same screen, search for "Illustrator" and click the "+" next to Illustrator Studio MCP. It is done when "plugin installed" appears.
4. Choose Work at the top, check that the computer icon at the lower right of the message box is set to On your computer, then start using it in a new chat.

To remove it, choose "…" → Uninstall on Illustrator Studio MCP under Plugins. Some ChatGPT models may fail without looking for the tools. If it does not work, try a more capable model. Running "In the cloud" is not supported.

If you are comfortable with Terminal, you can also add it with two Codex CLI commands (restart ChatGPT afterwards):

```bash
codex plugin marketplace add mhimt-lab/illustrator-studio-mcp --ref v0.1.0-beta.4
codex plugin add illustrator-studio-mcp@illustrator-studio-mcp
```

### Claude Code

Requires Node.js 20 or newer. Run this in Terminal, then restart Claude Code:

```bash
claude mcp add --transport stdio illustrator-studio -- npx -y illustrator-studio-mcp@beta
```

### Codex CLI

Requires Node.js 20 or newer. Run this in Terminal, then restart Codex CLI:

```bash
codex mcp add illustrator-studio -- npx -y illustrator-studio-mcp@beta
```

For checking the download, updating, uninstalling, and other ways to register, see [Install](docs/install.en.md).

## Before you use it

- **Mac only.** Use it with stable Adobe Illustrator (checked with Illustrator 2026, version 30.8).
- **Keep Illustrator in the foreground and the screen unlocked.** In the background or with the screen locked, operations stop or fail with an unclear reason.
- **Try it on a copy of your artwork first.** This is a trial release, not production-ready.

## Your first requests

Open a test document in Illustrator and start with a request that only looks. If macOS asks permission to control Illustrator, review and allow it.

```text
Tell me which documents are open in Illustrator and which text or shapes are selected.
Only look. Do not change, save, or export anything.
```

If the answer matches what you see in Illustrator, you are ready. “No selection” is correct when nothing is selected.

Next, ask to see a proposed edit only. Select one line of text outside a group (text you created by clicking with the Type tool), then ask:

```text
I'd like to change the selected headline to “Weekend Special”, keeping its size and color.
Show me what you would change and where. Do not change or save anything yet.
If its formatting is unsupported, tell me why.
```

If the target and text are right, ask it to go ahead with that change. See [Usage and examples](docs/usage.en.md) for more requests.

## How it keeps your work safe

- Before changing anything, it shows the target and the proposed change. You check it before it is applied.
- It checks the target again immediately before writing, and reads the result back from Illustrator afterwards. Check the final look and print readiness in Illustrator yourself.
- If a response is lost and the outcome is unclear, it stops further edits instead of guessing.

## More information

- [Usage and examples](docs/usage.en.md) — everything you can ask for, and requests to copy
- [Install](docs/install.en.md) — setup for each AI app, updating and uninstalling
- [Compatibility and verification](docs/compatibility.en.md) — Beta scope, per-app verification, known limitations
- [Safety](docs/safety.en.md) — how each change is checked, saving over and backups
- [Recovery](docs/runbook.en.md) — when a response stops or the outcome is unclear
- [Tool catalog](docs/tools.en.md) — the functions your AI app uses
- [Changelog](CHANGELOG.en.md) and [release notes](RELEASE_NOTES.en.md) — changes in each version
- [Support](SUPPORT.md) and [Security](SECURITY.md) — reporting bugs and vulnerabilities
- [日本語のREADME](README.md) — Japanese version

## License

[Business Source License 1.1](LICENSE). The Additional Use Grant permits ordinary internal business use and design services where clients receive creative outputs. Providing a Competitive Offering to third parties is restricted. This is not an OSI-approved open source license. Read the full [LICENSE](LICENSE) for its terms.

Illustrator Studio MCP is an independent project, not an Adobe product. It is not affiliated with, endorsed by, or sponsored by Adobe. Adobe and Illustrator are either registered trademarks or trademarks of Adobe in the United States and/or other countries.

<details>
<summary>Connection reference: tool identifiers (not needed for everyday requests)</summary>

`illustrator_align_objects`, `illustrator_apply_character_style`, `illustrator_apply_pathfinder`, `illustrator_capture_preview`, `illustrator_capture_structure_snapshot`, `illustrator_check_contrast`, `illustrator_check_text_consistency`, `illustrator_close_document`, `illustrator_close_edit_session`, `illustrator_compare_images`, `illustrator_create_area_text`, `illustrator_create_backup`, `illustrator_create_batch`, `illustrator_create_character_style`, `illustrator_create_clipping_mask`, `illustrator_create_document`, `illustrator_create_layer`, `illustrator_create_point_text`, `illustrator_create_rectangle`, `illustrator_create_shape`, `illustrator_create_swatch_resource`, `illustrator_delete_objects`, `illustrator_diff_structure`, `illustrator_duplicate_object`, `illustrator_edit_path_points`, `illustrator_embed_image`, `illustrator_export`, `illustrator_export_outlined`, `illustrator_extract_design_tokens`, `illustrator_find_color_usages`, `illustrator_find_fonts`, `illustrator_get_area_text_options`, `illustrator_get_context`, `illustrator_get_edit_session`, `illustrator_get_object`, `illustrator_get_path_points`, `illustrator_group_objects`, `illustrator_import_vector_artwork`, `illustrator_list_documents`, `illustrator_list_layers`, `illustrator_list_objects`, `illustrator_list_recipes`, `illustrator_list_selection`, `illustrator_list_swatches`, `illustrator_list_text_styles`, `illustrator_make_compound_path`, `illustrator_move_object_to_layer`, `illustrator_mutate_batch`, `illustrator_open_document`, `illustrator_open_edit_session`, `illustrator_optimize_images`, `illustrator_place_image`, `illustrator_plan_color_replacement`, `illustrator_plan_recipe`, `illustrator_preflight_images`, `illustrator_preflight_print`, `illustrator_read_structure_diff`, `illustrator_reconcile`, `illustrator_reconcile_backup`, `illustrator_reconcile_delete`, `illustrator_reconcile_export`, `illustrator_release_clipping_mask`, `illustrator_relink_image`, `illustrator_reorder_layer`, `illustrator_replace_font`, `illustrator_replace_point_text`, `illustrator_replace_point_text_batch`, `illustrator_replace_text_range`, `illustrator_run_m6_appearance_preview_recipe`, `illustrator_run_recipe`, `illustrator_save_document`, `illustrator_save_document_as`, `illustrator_save_recipe`, `illustrator_set_area_text_columns`, `illustrator_set_layer_state`, `illustrator_set_no_break`, `illustrator_set_object_state`, `illustrator_set_path_appearance`, `illustrator_set_stacking_order`, `illustrator_set_text_orientation`, `illustrator_set_text_style`, `illustrator_transform_object`, `illustrator_update_artboard`, `illustrator_update_character_style`

</details>

## Contact

The approved maintainer identity is **mhimt**, with contact [sporks-framer9t@icloud.com](mailto:sporks-framer9t@icloud.com). There is no guaranteed response time. Keep vulnerabilities and private materials out of ordinary Issues; use [private vulnerability reporting](https://github.com/mhimt-lab/illustrator-studio-mcp/security/advisories/new), or send a redacted initial summary by email.
