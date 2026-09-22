# Installation and AI app setup

[日本語](install.md) | **English**

**Public Beta 0.1.0-beta.4.** Requires macOS, stable Illustrator, and Node.js 20+. Keep Illustrator in the foreground and the screen unlocked. Check [client-specific verification](compatibility.en.md).

## Install from npm

```bash
npm install -g illustrator-studio-mcp@beta
illustrator-studio-mcp --version
illustrator-studio-mcp doctor
```

The version should be `0.1.0-beta.4`. It is not Stable. Always include `@beta`: a plain `npm install illustrator-studio-mcp` uses the `latest` tag, which may not be this version. Use `@0.1.0-beta.4` instead to pin the version.

To launch without a global install:

```bash
npx -y illustrator-studio-mcp@beta
```

This starts a stdio server waiting for an AI app, not an interactive terminal UI. Append `--version` or `doctor` for those checks. `@beta` follows future Beta updates.

## Install the release file

Download the tgz and `SHA256SUMS` from the [GitHub prerelease](https://github.com/mhimt-lab/illustrator-studio-mcp/releases/tag/v0.1.0-beta.4) into the same directory, then run there. `SHA256SUMS` also lists the Desktop extension (`.mcpb`); `--ignore-missing` skips files you did not download.

```bash
shasum -a 256 -c SHA256SUMS --ignore-missing
npm install -g ./illustrator-studio-mcp-0.1.0-beta.4.tgz
illustrator-studio-mcp --version
illustrator-studio-mcp doctor
```

Stop if the checksum differs. Built JavaScript is included in `dist/`; no build is needed. This public tree is not the TypeScript development checkout.

## Register the installed command

Preserve existing server entries and avoid duplicate names. The default Illustrator target is `id:com.adobe.illustrator`.

### Claude Code

After the global install:

```bash
claude mcp add --transport stdio illustrator-studio -- illustrator-studio-mcp
```

Or use npx instead (choose one registration method):

```bash
claude mcp add --transport stdio illustrator-studio -- npx -y illustrator-studio-mcp@beta
```

Restart and check `/mcp`.

### Claude Desktop

#### Desktop extension (`.mcpb`, main method)

The Desktop extension runs on the Node.js built into Claude Desktop. It needs neither the npm install nor configuration file edits.

1. Download `illustrator-studio-mcp-0.1.0-beta.4.mcpb` and `SHA256SUMS` from the [GitHub prerelease](https://github.com/mhimt-lab/illustrator-studio-mcp/releases/tag/v0.1.0-beta.4) into the same directory and run `shasum -a 256 -c SHA256SUMS --ignore-missing` there. If the hash does not match, stop and do not install.
2. Double-click the `.mcpb` file to open it in Claude Desktop. In the install dialog, confirm the author **mhimt**, version **0.1.0-beta.4**, and license **BUSL-1.1**, then choose Install. The extension is not signed.
3. For stable Illustrator, keep the default "Illustrator application" setting `id:com.adobe.illustrator` and save (use `id:com.adobe.illustratorBeta` for Illustrator Beta).
4. Confirm the extension is enabled, then start a new chat with a read-only request ([Start with a read](#start-with-a-read)).

Uninstall it from Claude Desktop's Settings → Extensions. If you also register the server through the configuration file, the same tools appear twice; use one or the other.

#### Configuration file (alternative)

To run on regular Node.js, or to use the version installed with npm, you can register the server in the configuration file instead. After installing globally, find your real paths:

```bash
command -v node
npm root -g
```

Open Settings → Developer → Edit Config. On macOS the file is `~/Library/Application Support/Claude/claude_desktop_config.json`. Add the server to the existing `mcpServers` object. Replace `command` with the absolute path returned by `command -v node`. Replace the argument with the `npm root -g` directory followed by `/illustrator-studio-mcp/dist/index.js`. Do not save the illustrative paths unchanged.

```json
{
  "mcpServers": {
    "illustrator-studio": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/global/node_modules/illustrator-studio-mcp/dist/index.js"],
      "env": {"ILLUSTRATOR_APPLICATION": "id:com.adobe.illustrator"}
    }
  }
}
```

Fully quit and reopen Desktop, then check the connection. Review the paths after Node upgrades. Connection success and a completed artwork workflow are separate checks.

### Codex CLI

After the global install:

```bash
codex mcp add illustrator-studio -- illustrator-studio-mcp
```

Or use npx:

```bash
codex mcp add illustrator-studio -- npx -y illustrator-studio-mcp@beta
```

As an alternative to CLI registration, add this to `~/.codex/config.toml`. Inspect any existing entry with the same name instead of overwriting it:

```toml
[mcp_servers.illustrator-studio]
command = "npx"
args = ["-y", "illustrator-studio-mcp@beta"]

[mcp_servers.illustrator-studio.env]
ILLUSTRATOR_APPLICATION = "id:com.adobe.illustrator"
```

If `npx` is not found, use its absolute path from `command -v npx` and ensure Node.js is visible to the launch environment. Restart Codex and check `/mcp`.

For editing tools, the `apply: false` plan returns a `next_call`. Codex can apply by sending those arguments (including `command_id`) unchanged. Review the plan before approving a change. On beta.4, Codex CLI completed rectangle plan, apply, save, and reopen without extra instructions ([verification status](compatibility.en.md)).

### ChatGPT Work Local

Use this MCP as a local stdio server from **Work locally** in the ChatGPT desktop app. ChatGPT Work Cloud (Work running in the cloud) is not supported.

The ChatGPT desktop app and Codex CLI share the same MCP configuration ([official documentation](https://learn.chatgpt.com/docs/extend/mcp)). If you have Codex CLI, one command in Terminal registers the server. If you already registered it under "Codex CLI" above, the same server appears in ChatGPT.

```bash
codex mcp add illustrator-studio -- npx -y illustrator-studio-mcp@beta
```

- If a server with the same name exists, choose a different name so the existing entry is not overwritten.
- When `codex mcp add` rewrites the configuration file, it may drop settings that only restate a default (for example `enabled = true`). The meaning is unchanged. To be safe, copy `~/.codex/config.toml` first.
- Without `ILLUSTRATOR_APPLICATION`, the server drives the standard Illustrator release (`id:com.adobe.illustrator`).

After registering, open Settings → Plugins → **MCP** in the ChatGPT desktop app, confirm the server is listed, and turn its switch off and on again. In a new Work locally chat, start with a read:

> Run illustrator_list_documents once and tell me which documents are open. Do not create, edit, or save anything.

#### Without Codex CLI (register in the app)

Install the package globally first, then check the actual paths in Terminal:

```bash
command -v node
npm root -g
```

1. In the ChatGPT desktop app, open **Work locally**, then Settings → Plugins → **MCP** → Add → **STDIO**.
2. Enter the following. If a server with the same name exists, inspect it instead of overwriting it.
   - Command: the absolute path of node from `command -v node`
   - Arguments: the output of `npm root -g` followed by `/illustrator-studio-mcp/dist/index.js`, as an absolute path (without a global install, use the absolute path from `command -v npx` as the command and `-y` and `illustrator-studio-mcp@beta` as the arguments)
   - Environment variable: `ILLUSTRATOR_APPLICATION` = `id:com.adobe.illustrator`
3. After saving, turn the server's switch off and on again to reconnect.

Notes:

- Keep tool-call approval (the permission mode) at a setting that lets you review changes. For editing tools, check the `apply: false` plan before approving the apply.
- If the plan result has `next_call`, use its arguments (including `command_id`) for the apply as is. Reuse the same value only to retry the same apply.
- The state directory (`ILLUSTRATOR_STUDIO_MCP_STATE_DIR`) normally needs no setting (default: `~/Library/Application Support/illustrator-studio-mcp`). If you point it at a directory you created, set its permissions to `0700` (`chmod 700 <directory>`); a directory you do not own or with wider permissions is refused when the server uses it.

Verification status: the beta.4 package itself, registered with the same one-line `codex mcp add … -- npx -y …` command (before publication, with the package argument replaced by the path of the distribution file), completed rectangle plan, apply, read-back, save, and reopen from a new Work locally chat. See [compatibility and verification scope](compatibility.en.md).

## Start with a read

Use a test document and ask:

> Tell me which Illustrator documents are open and which text or shapes are selected. Do not change, save, or export anything.

Compare the response with Illustrator. No document and no selection are different states. Unknown or skipped checks are not success; consult [recovery steps](runbook.en.md).

## Update or uninstall

Update with `npm install -g illustrator-studio-mcp@beta` or a newer tgz, then restart the AI app. Check the version and [changelog](../CHANGELOG.en.md). To uninstall, run `npm uninstall -g illustrator-studio-mcp`, then remove that server entry from the app. Preserve unresolved execution records.

Documentation on GitHub main can be corrected after publication. Later documentation changes do not replace the README or tarball of any version already published on npm. Use the [public README](../README.en.md) for current guidance.

Configuration references: [Claude Code](https://code.claude.com/docs/en/mcp), [Claude Desktop local MCP](https://modelcontextprotocol.io/docs/develop/connect-local-servers), [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp), [npm exec / npx](https://docs.npmjs.com/cli/v11/commands/npm-exec/). Configuration syntax is separate from live verification.

The CHANGELOG inside the already published npm 0.1.0-beta.1 tgz cannot be replaced. Its original date remains unchanged; the publication date is 2026-09-22 JST (Asia/Tokyo).
