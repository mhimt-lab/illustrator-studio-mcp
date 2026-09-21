# Setup and diagnostics

[日本語](setup.md) | **English**

First follow [installation](install.en.md) using npm `@beta` or the distribution tgz. The distribution snapshot is already built; you do not need to run development tests.

## Stable Illustrator

Start stable Illustrator, keep it in the foreground, and unlock the screen. The default target is `id:com.adobe.illustrator`. Verify with a dedicated test document rather than production artwork.

## Illustrator Beta

Set `ILLUSTRATOR_APPLICATION=id:com.adobe.illustratorBeta` to select Illustrator Beta. Being able to select a version and having verified artwork operations on it are separate matters. Operations on Illustrator Beta are not described as Supported.

## Doctor

```bash
illustrator-studio-mcp doctor
illustrator-studio-mcp doctor --json
```

Diagnostics inspect the Mac, Node.js, Illustrator target and running state, control permissions, and execution-record storage. They do not edit documents or automatically repair settings or records. Inspect each item's `pass / skip / indeterminate / fail` result; do not infer that all checks passed from the exit code alone.

## First verification

Ask your AI app to read open documents and the selection, then compare the results with the screen. Before editing, check the target and plan, and apply only to a test document. If the outcome becomes unclear, consult the [failure runbook](runbook.en.md) to see which operations to stop.

## Streamable HTTP

Use stdio normally. To use HTTP, start `illustrator-studio-mcp http` and set `ILLUSTRATOR_STUDIO_MCP_HTTP_TOKEN` to a secret of at least 32 characters. Do not put its value in Issues or logs. Binding is loopback-only, not for external exposure. Configure the port with `ILLUSTRATOR_STUDIO_MCP_HTTP_PORT` and allowed Origins with `ILLUSTRATOR_STUDIO_MCP_HTTP_ALLOWED_ORIGINS`. [Transport and client verification](compatibility.en.md) are tracked separately.
