# Setup / 接続と診断

まず[導入手順](install.md)でnpmの`@beta`または配布用tgzから入れます。配布用snapshotはビルド済みで、開発用テストの実行は必要ありません。

## Stable Illustrator

通常版のIllustratorを起動し、前面に表示して画面ロックを解除します。既定の接続先は`id:com.adobe.illustrator`です。制作物ではなく専用のテスト書類で確認します。

## Illustrator Beta

`ILLUSTRATOR_APPLICATION=id:com.adobe.illustratorBeta`を設定するとBeta版を選択できます。ただし選択できることと、その版での制作操作の検証は別です。Beta版Illustratorの操作をSupportedとは表記していません。

## Doctor

```bash
illustrator-studio-mcp doctor
illustrator-studio-mcp doctor --json
```

診断はMac・Node.js・Illustratorの接続先と起動状態・操作許可・実行記録の保管場所を調べます。書類を編集せず、設定や記録を自動修復しません。各項目のpass / skip / indeterminate / failを確認し、終了コードだけで全項目の成功を判断しないでください。

## First verification

AIアプリから開いている書類と選択内容を読み取り、画面と照合します。編集は対象と計画を確認してから、テスト書類だけに適用します。応答が不明になった場合は[復旧手順](runbook.md)で止めるべき操作を確認してください。

## Streamable HTTP

通常はstdioを使います。HTTPを使う場合は`illustrator-studio-mcp http`を起動し、`ILLUSTRATOR_STUDIO_MCP_HTTP_TOKEN`へ32文字以上の秘密値を設定します。値をIssueやログへ書かないでください。bind先はloopbackのみで、外部公開用ではありません。ポート設定は`ILLUSTRATOR_STUDIO_MCP_HTTP_PORT`、Originの許可は`ILLUSTRATOR_STUDIO_MCP_HTTP_ALLOWED_ORIGINS`です。[接続方式とアプリの検証状況](compatibility.md)は別々に扱います。
