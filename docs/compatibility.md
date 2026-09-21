# Client compatibility / AIアプリ別の確認状況

**Public Beta 0.1.0-beta.1。** 接続方式の検査と、AIアプリからIllustratorで制作を完遂した証拠は別です。Illustratorを前面に表示し、画面ロックを解除した状態が前提です。

## AIアプリ別

| Client | 接続方式 | 初回Betaでの確認（この配布物そのもの） | 扱い |
| --- | --- | --- | --- |
| Claude Code 2.1.278 | stdio | 導入・登録・機能取得・診断・読み取り・計画・直前確認・適用・結果検証・保存・再読込・結果の読み直し | Beta対象 |
| Claude Desktop 2.2553.1 | stdio（設定ファイル方式） | 同上 | Beta対象。`.mcpb`拡張は次のベータで提供予定（Desktop内蔵のNodeでは補助プロセスを起動できない既知の問題） |
| Codex CLI 0.155.1 | stdio | 接続・承認経路・機能取得・読み取り・保存・変更前の書類のバックアップまで。変更系（計画・適用）以降は未確認。確認時はAIモデルが引数名を推測して送り（`document_key`・`layer_path`、`artboard_index`なし）、入力検証で拒否された。クライアントからの診断はCodexのシェルsandbox内では実行できない | Partial・Beta期間中に追加検証 |
| ChatGPT Work | remote MCP経路 | 未実施 | Experimental・Beta期間中に追加検証 |

設定できること、接続できること、別のアプリで動いたことだけではTested / Supportedにしません。初回Betaは、Claude CodeとClaude Desktopで、公開するものと同じ配布物を使い、導入・登録・機能取得・診断・読み取り・計画・直前確認・適用・結果検証・保存・再読込・結果の読み直しと、重要な失敗経路を確認してから公開しています。確認は限定した書類・操作での記録で、任意の制作物での動作を保証するものではありません。

## 接続方式別

| Transport | 現在の証拠 | 保証しないこと |
| --- | --- | --- |
| stdio | SDKを使う自動テストと、隔離installしたpackageのinitialize・機能取得 | 各AIアプリの制作E2E、任意の制作物 |
| Streamable HTTP | SDK適合・HTTP境界の自動テスト。loopbackのみ、Bearer認証、Host/Origin検査 | 公開HTTPS、OAuth、ChatGPT Workへの接続、実IllustratorでのHTTP制作E2E |

HTTPは`127.0.0.1`のローカル接続専用です。トークンは32文字以上が必要で、Originは明示許可したものだけを受け付けます。外部から直接アクセスできるサーバーではありません。

## BetaとStable

Betaは限定した環境と既知の制約を明示して試す段階です。Stableへの昇格には、継続運用、失敗からの復旧、更新、記録保持、性能、サポート範囲の別の受け入れ確認が必要です。Betaの接続成功を本番運用の保証へ広げません。

buildした実行ファイルを後加工せず、同じbytesを配布packageへ収録します。旧版の未解決commandをこの版で再送する安全性は保証しません。
