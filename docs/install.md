# Install / 導入

**Public Beta 0.1.0-beta.1。** npmの`beta`タグ、またはGitHub prereleaseに添付した配布用ファイル（`.tgz`）から導入します。Illustratorは前面に表示し、画面ロックを解除した状態で使ってください。

Mac、通常版Illustrator、Node.js 20以上、対応を確認するAIアプリが必要です。AIアプリごとの検証状況は[互換性](compatibility.md)を参照してください。

## npmから入れる

```bash
npm install -g illustrator-studio-mcp@beta
illustrator-studio-mcp --version
illustrator-studio-mcp doctor
```

## 配布用ファイルから入れる

GitHub prereleaseから`.tgz`を取得し、ファイルがあるフォルダで実行します。

```bash
npm install -g ./illustrator-studio-mcp-0.1.0-beta.1.tgz
illustrator-studio-mcp --version
illustrator-studio-mcp doctor
```

prereleaseに添付されたSHA-256と手元のファイルを照合してください。配布用のJavaScriptは`dist/`に同梱済みです。この配布用snapshotはTypeScript開発checkoutではなく、buildや実機開発テストのコマンドは含みません。

## Register the installed command

### Claude Code

```bash
claude mcp add --transport stdio illustrator-studio -- illustrator-studio-mcp
```

### Claude Desktop

アプリのDeveloper設定からMCP設定を開き、既存項目を保持して次のserver項目を追加します。アプリを再起動して接続を確認します。

```json
{"mcpServers":{"illustrator-studio":{"command":"illustrator-studio-mcp","args":[]}}}
```

### Codex CLI

```bash
codex mcp add illustrator-studio -- illustrator-studio-mcp
```

## 書類を変えずに試す

通常版Illustratorを前面に表示し、画面ロックを解除します。テスト用の書類だけを使い、AIアプリに次のように依頼します。

> 開いているIllustratorの書類と、選択した文字や図形を教えて。変更・保存・書き出しはしないで。

表示と返答を照合します。書類がない場合の拒否と、選択なしは区別してください。診断や応答が「不明」「未実施」なら成功と扱いません。問題があれば[復旧の案内](runbook.md)へ進みます。

## 更新・削除

更新は`npm install -g illustrator-studio-mcp@beta`（または新しい`.tgz`）で同じ方法でinstallし、AIアプリを起動し直します。版と[変更履歴](../CHANGELOG.md)を確認してください。削除は`npm uninstall -g illustrator-studio-mcp`の後、アプリのserver設定を外します。未解決の実行記録は削除しません。

Betaはnpmの`beta` dist-tagとGitHubのprereleaseで提供します。Stableになるまで`latest`へ向けません。Claude Desktopのワンクリック導入（`.mcpb`）は初回Betaに含めず、次のベータで提供予定です。現在の版はDesktop内蔵のNodeで起動するとIllustratorを操作する補助プロセスを起動できない既知の問題があります。Desktopは上の設定ファイル方式を使ってください。
