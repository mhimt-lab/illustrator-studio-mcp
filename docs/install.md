# 導入とAIアプリの設定

**日本語** | [English](install.en.md)

**Public Beta 0.1.0-beta.1。** Mac、通常版Illustrator、Node.js 20以上が必要です。Illustratorを前面に表示し、画面ロックを解除して使います。[アプリ別の確認範囲](compatibility.md)を確認してください。

## npmから入れる

```bash
npm install -g illustrator-studio-mcp@beta
illustrator-studio-mcp --version
illustrator-studio-mcp doctor
```

版の表示は `0.1.0-beta.1` です。初回公開ではnpmの `beta` と `latest` がともにこのBeta版を指しています。Stable版ではありません。手順では明示的に `@beta` を使い、版を固定したい場合は `@0.1.0-beta.1` に置き換えてください。

グローバルインストールなしで起動するには、次を使います。

```bash
npx -y illustrator-studio-mcp@beta
```

これはstdioサーバーを起動し、AIアプリからの通信を待ちます。ターミナルに対話画面は出ません。版と診断だけを確認する場合は、末尾に `--version` または `doctor` を付けます。`@beta` は将来のBeta更新に追随します。

## 配布用ファイルから入れる

[GitHub prerelease](https://github.com/mhimt-lab/illustrator-studio-mcp/releases/tag/v0.1.0-beta.1)からtgzと `SHA256SUMS` を同じフォルダへ取得し、そのフォルダで実行します。

```bash
shasum -a 256 -c SHA256SUMS
npm install -g ./illustrator-studio-mcp-0.1.0-beta.1.tgz
illustrator-studio-mcp --version
illustrator-studio-mcp doctor
```

hash不一致なら導入せず停止してください。配布用JavaScriptは `dist/` に同梱済みで、buildは不要です。この公開ツリーはTypeScriptの開発用checkoutではありません。

## Register the installed command

いずれの方法でも既存のserver設定は残し、同じ名前の設定を重複させないでください。通常版Illustratorの接続先は `id:com.adobe.illustrator` です。

### Claude Code

グローバルインストール済みの場合:

```bash
claude mcp add --transport stdio illustrator-studio -- illustrator-studio-mcp
```

代わりにnpxで起動する場合（上の登録とどちらか一方）:

```bash
claude mcp add --transport stdio illustrator-studio -- npx -y illustrator-studio-mcp@beta
```

再起動して `/mcp` で接続を確認します。

### Claude Desktop

**beta.1では `.mcpb` を配布していません。** Desktop内蔵NodeではIllustrator用の補助プロセスを起動できないため、通常のNode.jsを使う設定ファイル方式で接続します。`.mcpb` は次のベータで提供予定です。

まずnpmのグローバルインストールを済ませ、ターミナルで実際のパスを確認します。

```bash
command -v node
npm root -g
```

Settings → Developer → Edit Configから `claude_desktop_config.json` を開きます。macOSの保存場所は `~/Library/Application Support/Claude/claude_desktop_config.json` です。既存の `mcpServers` に次の項目を追加します。`command` は `command -v node` の絶対パス、`args` の先頭は `npm root -g` の出力に `/illustrator-studio-mcp/dist/index.js` を付けた絶対パスに置き換えてください。以下の例示パスをそのまま保存しないでください。

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

Desktopを完全に終了して起動し直し、接続を確認します。Nodeの更新でパスが変わった場合は設定も見直します。接続できることと制作E2Eの確認は別です。

### Codex CLI

グローバルインストール済みの場合:

```bash
codex mcp add illustrator-studio -- illustrator-studio-mcp
```

代わりにnpxを使う場合:

```bash
codex mcp add illustrator-studio -- npx -y illustrator-studio-mcp@beta
```

CLI登録の代わりに、`~/.codex/config.toml` へ次を追加する方法もあります。既存の同名設定があれば置き換えず内容を確認してください。

```toml
[mcp_servers.illustrator-studio]
command = "npx"
args = ["-y", "illustrator-studio-mcp@beta"]

[mcp_servers.illustrator-studio.env]
ILLUSTRATOR_APPLICATION = "id:com.adobe.illustrator"
```

`npx` が見つからない場合は `command -v npx` で確認した絶対パスを設定し、Node.jsも起動環境から見えることを確認します。Codexを再起動し `/mcp` で確認します。beta.1のCodex実機検証はbackupまでで、変更系の計画・適用以降は未確認です。設定例はその制限を変更しません。

## 書類を変えずに試す

テスト用の書類で、次のように依頼します。

> 開いているIllustratorの書類と、選択した文字や図形を教えて。変更・保存・書き出しはしないで。

画面と返答を照合します。書類がない場合と「選択なし」は区別します。診断や応答が不明・未実施なら成功と扱わず、[復旧手順](runbook.md)を参照してください。

## 更新・削除

更新は `npm install -g illustrator-studio-mcp@beta` または新しいtgzで行い、AIアプリを再起動します。[変更履歴](../CHANGELOG.md)と版を確認してください。削除は `npm uninstall -g illustrator-studio-mcp` の後にAIアプリのserver設定を外します。未解決の実行記録は削除しません。

GitHubのmain上の案内は公開後にも訂正されます。npmに公開済みの0.1.0-beta.1のREADMEとtgzは、この文書修正では変わりません。最新の案内は[公開README](../README.md)を参照してください。

設定形式の出典: [Claude Code](https://code.claude.com/docs/en/mcp)、[Claude DesktopのローカルMCP](https://modelcontextprotocol.io/docs/develop/connect-local-servers)、[Codex MCP](https://learn.chatgpt.com/docs/extend/mcp)、[npm exec / npx](https://docs.npmjs.com/cli/v11/commands/npm-exec/)。接続例の仕様と実機確認範囲は別です。

公開済みnpm 0.1.0-beta.1のtgz内のCHANGELOGは差し替えできません。収録済みの日付はそのままで、GitHub上の公開日は2026-09-22 JST（Asia/Tokyo）に訂正しています。
