# Installation and AI app setup

[日本語](install.md) | **English**

**Public Beta 0.1.0-beta.1.** Requires macOS, stable Illustrator, and Node.js 20+. Keep Illustrator in the foreground and the screen unlocked. Check [client-specific verification](compatibility.en.md).

## Install from npm

```bash
npm install -g illustrator-studio-mcp@beta
illustrator-studio-mcp --version
illustrator-studio-mcp doctor
```

The version should be `0.1.0-beta.1`. On this initial publication, both npm `beta` and `latest` point to this Beta; it is not Stable. These instructions explicitly use `@beta`. Use `@0.1.0-beta.1` instead to pin the version.

To launch without a global install:

```bash
npx -y illustrator-studio-mcp@beta
```

This starts a stdio server waiting for an AI app, not an interactive terminal UI. Append `--version` or `doctor` for those checks. `@beta` follows future Beta updates.

## Install the release file

Download the tgz and `SHA256SUMS` from the [GitHub prerelease](https://github.com/mhimt-lab/illustrator-studio-mcp/releases/tag/v0.1.0-beta.1) into the same directory, then run there:

```bash
shasum -a 256 -c SHA256SUMS
npm install -g ./illustrator-studio-mcp-0.1.0-beta.1.tgz
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

**No `.mcpb` extension is distributed in beta.1.** Desktop's built-in Node cannot launch the Illustrator helper, so use the configuration file with regular Node.js. The extension is planned for the next Beta.

After installing globally, find your real paths:

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

If `npx` is not found, use its absolute path from `command -v npx` and ensure Node.js is visible to the launch environment. Restart Codex and check `/mcp`. beta.1's Codex live verification stops at backup; editing plan/apply and later steps remain unverified. These examples do not expand that scope.

## Start with a read

Use a test document and ask:

> Tell me which Illustrator documents are open and which text or shapes are selected. Do not change, save, or export anything.

Compare the response with Illustrator. No document and no selection are different states. Unknown or skipped checks are not success; consult [recovery steps](runbook.en.md).

## Update or uninstall

Update with `npm install -g illustrator-studio-mcp@beta` or a newer tgz, then restart the AI app. Check the version and [changelog](../CHANGELOG.en.md). To uninstall, run `npm uninstall -g illustrator-studio-mcp`, then remove that server entry from the app. Preserve unresolved execution records.

Documentation on GitHub main can be corrected after publication. This documentation change does not replace npm's already published 0.1.0-beta.1 README or tarball. Use the [public README](../README.en.md) for current guidance.

Configuration references: [Claude Code](https://code.claude.com/docs/en/mcp), [Claude Desktop local MCP](https://modelcontextprotocol.io/docs/develop/connect-local-servers), [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp), [npm exec / npx](https://docs.npmjs.com/cli/v11/commands/npm-exec/). Configuration syntax is separate from live verification.

The CHANGELOG inside the already published npm 0.1.0-beta.1 tgz cannot be replaced. Its original date remains unchanged; the corrected publication date on GitHub is 2026-09-22 JST (Asia/Tokyo).
