# Public Beta 0.1.0-beta.2

**日本語** | [English](RELEASE_NOTES.en.md)

公開日: 2026-09-22 JST（Asia/Tokyo）。

0.1.0-beta.1からの更新です。Claude Desktop拡張（`.mcpb`）の配布を始め、AIアプリが変更系ツールの引数を迷わず組み立てられるようにしました。本番運用向けの完成版ではありません。

**前提:** Illustratorを前面に表示し、画面ロックを解除した状態で使います。背面や画面ロック中は、多くの操作が拒否されます。

#### 追加

- Claude Desktop拡張（`.mcpb`）をGitHubのprereleaseで配布します。Desktopに内蔵されたNode.jsで動き、実行に必要な依存を同梱しています。拡張は審査済みのnpm配布物（tgz）から作り、同じtgzから同じbytesを再現できます。`SHA256SUMS` に拡張の行も記載します
- ChatGPT Work Localを対応するAIアプリに加えました。`codex mcp add` の1行で登録できます

#### 変更

- 変更系ツールの計画（`apply: false`）の結果に `next_call` を付けます。作成系のツールと、適用時に計画の値を送り返すツールが対象で、適用にそのまま渡す引数と、新しい `command_id` の候補を含みます
- 各ツールの入力仕様に、`command_id` の形式（小文字のUUID v4）と、同じ値を再送してよい場面（同じ適用の再試行だけ）を記載しました
- 引数の誤りでは、欠けている必須引数を名指しし、知らない引数名には正しい名前を示します。拒否した `command_id` もエラーに引用します
- Codex CLIとChatGPT Work Localで、追加の指示なしに変更の適用まで進むことを確認しました
- Desktop拡張の設定「Illustrator application」を、既定値 `id:com.adobe.illustrator` のまま保存できるようにしました

#### 修正

- Claude Desktopの内蔵Node.jsで動かしたとき、Illustratorを操作する補助プロセスを起動できなかった問題を修正しました

#### 既知の制限

- Streamable HTTPは自動テストとAIアプリとの接続確認までです。HTTP経由でIllustratorを操作した記録はありません
- CMYK文書では、重なり順の変更は最前面（`front`）だけ、複合パスの作成は未対応です
- グループの読み取りで、ときどき対象を参照できなくなる既知の間欠事象があります。このとき操作は安全側で止まります（fail closed）
- 長い文書識別情報を含む実行記録は、読み戻せないことがあります
- 既存の線付き文字は編集対象外です
- Desktop拡張には署名がありません。インストール画面で提供元と版を確認してください
- npmでは必ず `@beta` を付けてください。タグなしのインストールは `latest` を使い、この版になるとは限りません

[導入](docs/install.md)・[互換性](docs/compatibility.md)・[復旧](docs/runbook.md)・[LICENSE](LICENSE)を確認してください。

以前の版の変更は[変更履歴](CHANGELOG.md)にあります。
