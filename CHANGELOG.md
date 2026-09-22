# Changelog

**日本語** | [English](CHANGELOG.en.md)

日付は JST（Asia/Tokyo）です。

## [0.1.0-beta.3] - 2026-09-22

**日本語** | [English](https://github.com/mhimt-lab/illustrator-studio-mcp/blob/main/CHANGELOG.en.md)

0.1.0-beta.1からの更新です。Claude Desktop拡張（`.mcpb`）の配布を始め、AIアプリが変更系ツールの引数を迷わず組み立てられるようにしました。本番運用向けの完成版ではありません。

0.1.0-beta.2は、GitHubのtag（`v0.1.0-beta.2`）までは作成しましたが、Desktop拡張（`.mcpb`）を同じbytesで作り直せない問題（zipに記録される時刻が実行環境のタイムゾーンで変わる）が見つかったため、npmとGitHubのprereleaseでは公開していません。0.1.0-beta.3の内容は0.1.0-beta.2と同じです（`.mcpb` はタイムゾーンによらず同じbytesになる作り方に変更しました）。

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

## [0.1.0-beta.2] - 2026-09-22

未公開です（tagのみ）。内容は0.1.0-beta.3と同じです。上の0.1.0-beta.3の説明を参照してください。

## [0.1.0-beta.1] - 2026-09-22

**日本語** | [English](https://github.com/mhimt-lab/illustrator-studio-mcp/blob/main/CHANGELOG.en.md)

Mac上の通常版Illustratorを、AIアプリから計画・直前照合・適用・結果の読み直しの順で操作する初回Betaです。本番運用向けの完成版ではありません。

**前提:** Illustratorを前面に表示し、画面ロックを解除した状態で使います。背面や画面ロック中は、多くの操作が拒否されます。

#### 含まれるもの

- 読み取り・検査（文書・レイヤー・選択・フォント・色の使用箇所・印刷前チェックなど）
- 対応する図形・文字・画像の非破壊編集。CMYK文書にも対応します
- 保存済みファイルの連続編集（edit session、experimental）。39種類中36種類の変更操作に対応し、削除・画像埋め込み・ベクター取り込みは対象外です。開始に必要なバックアップの上限が1,000オブジェクト（600オブジェクトでの実機1回からの外挿値）なので、これが実質の上限です
- バックアップ・上書き保存・別名保存、アウトライン化したAI／PDFの書き出し
- 画像の配置・リンク差し替え・埋め込み（RGB文書のJPEG／PNGだけ）・最適化
- stdio接続（MCP 2026-07-28対応）
- 配布: npmの`beta`タグとGitHubのprerelease。検証済みbuildと同じbytesを収録し、配布時に実行JavaScriptを書き換えません

#### 対象外

PNG・JPEG・SVGの書き出し、アートボードの操作、段落スタイル、MCP Tasks、Windows、複数オブジェクトの一括削除、リンク切れの修復、グループ解除。

#### 既知の制限

- Streamable HTTPは自動テストとAIアプリとの接続確認までです。HTTP経由でIllustratorを操作した記録はありません
- CMYK文書では、重なり順の変更は最前面（`front`）だけ、複合パスの作成は未対応です
- グループの読み取りで、ときどき対象を参照できなくなる既知の間欠事象があります。このとき操作は安全側で止まります（fail closed）
- 長い文書識別情報を含む実行記録は、読み戻せないことがあります
- 既存の線付き文字は編集対象外です
- GitHub Actionsでの自動テストは、このリリース時点で未通過です（ローカルの全体テストで確認）

[導入](docs/install.md)・[互換性](docs/compatibility.md)・[復旧](docs/runbook.md)・[LICENSE](LICENSE)を確認してください。
