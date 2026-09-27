# Windows 検証キット（協力者向け手順書）

**日本語** | [English](README.en.md)

Illustrator Studio MCP の Windows 対応は準備中です。対応の形を決めるために、Windows と Illustrator をお持ちの方に、このキットで基本的な動作を測っていただく協力をお願いしています。

このキットは MCP サーバーの Windows 版ではありません。Windows から Illustrator に接続できるか、スクリプトを実行できるか、画面ロック中や Illustrator が背面のときにどう振る舞うかを、決まった順番で 17 項目（W0〜W16）測り、結果をファイルに書き出すだけです。

## 最初にお読みください（結果は公開されます）

- **結果は公開の Issue に添付していただきます。誰でも読めます。** 添付したファイルは後から完全には消せません。
- キットは結果を書き出す時点で、Windows のユーザー名・コンピューター名・ドメイン名と、ユーザーのフォルダ（`C:\Users\<名前>` など）を `%USERNAME%`・`%USERPROFILE%` のような変数名に置き換えます。アカウントの SID も伏せます。
- それでも、**添付する前に必ず中身をご自身で確認してください**（「[提出前の確認](#提出前の確認)」）。名前や社名などが残っていたら、その部分を消してから添付するか、提出を見送ってください。
- 業務の Illustrator 文書や個人のファイルがある Windows ユーザーでは実行しないでください。**キット専用の Windows ユーザー**（または別のマシン）を用意してください。
- 協力は任意です。途中でやめても構いません。

## 必要な環境

| 項目 | 要件 |
| --- | --- |
| Windows | Windows 11、または Windows 10 22H2（ビルド 19045）以降。x64（ARM 版の Windows は対象外） |
| セッション | そのマシンの画面の前で操作すること（ローカルのコンソール）。リモート デスクトップ（RDP）は対象外。仮想マシンの場合は仮想化ソフトのコンソール画面で操作 |
| Illustrator | Creative Cloud の現行の通常版（stable）が 1 つ。サインイン済み。Illustrator Beta は任意（入っていれば W14 で追加の測定をします） |
| Node.js | 20 以上の x64 版（公式インストーラー） |
| PowerShell | Windows に最初から入っている Windows PowerShell 5.1。組織のポリシーで実行ポリシーが固定されていないこと（C4） |
| Git | Git for Windows |
| 権限 | 通常ユーザー。管理者として実行しない（昇格しない） |
| サインイン | パスワードまたは PIN が設定されていること（画面ロックと解錠を測るため） |
| Windows ユーザー | 業務の文書や個人のファイルが無い、キット専用のユーザー |

**所要時間の目安:** 2〜3 時間。多くは待ち時間ですが、途中で次の操作をお願いします。画面の指示に従ってください。

- Illustrator の終了と起動、確認用の文書 2 枚の保存（W12・W0）
- Beta が入っている場合は Beta の起動と終了（W14）
- モーダルダイアログを開いたままにして、指示で閉じる（W3・W9）
- 画面ロックの後の解錠、2 回（W4〜W6・W15）
- Illustrator とエクスプローラーの前面・背面の切り替え（W15・W7・W8）

## キットが読むもの・書くもの

**読むもの（記録するもの）:** OS のバージョンと CPU の種類、PowerShell のバージョンと実行ポリシー、Node.js のバージョンと実行ファイルの場所、管理者として実行していないか（`whoami /groups` から判定結果だけを記録）、Git の HEAD と未変更かどうか、実行中の Illustrator の実行ファイルの場所、レジストリに登録された `Illustrator.Application` の名前、画面ロックの状態、最前面のウィンドウのプロセスの実行ファイルの場所、キットが作ったフォルダのアクセス権（アクセス規則の一覧）。

**書くもの:**

- 結果フォルダ `windows-probe-results-<日付>\`（リポジトリの直下）: `environment.json`、項目ごとの `w<番号>.json`、`summary.md`
- 作業フォルダ（`--state-root` に指定した空のフォルダ）: 1 回ごとのスクリプトと結果のファイル、ロックファイル
- `%LOCALAPPDATA%\illustrator-studio-mcp-probe-<日付>\`: ファイルシステムの振る舞いを測る小さなテキストファイル（W11）

**Illustrator に対して:**

- キットは Illustrator を**起動しません**。起動済みの Illustrator に接続するだけです。
- 読み取りと変更の対象は、名前が `mcp-windows-probe` で始まる確認用の文書だけです。ほかの文書は数を数えるだけで、中身を読みません。
- 変更は 1 回だけです: W7 で確認用の文書 `mcp-windows-probe.ai` に小さな長方形を 1 つ描きます。保存はしません。
- 画面を 2 回ロックします（W4・W15）。解錠はご自身で行ってください。

キットは作ったファイルやフォルダを消しません。提出の後に、上の 3 つのフォルダと確認用の文書を手で削除してください。

## 結果に含めないもの

- Illustrator 文書の内容、キットが実行するスクリプトの本文
- PowerShell のエラーの全文（分類の短い印と HRESULT の値だけを記録します）
- ユーザー名・コンピューター名・ドメイン名・ユーザーのフォルダを含むパス（変数名に置き換えます）、アカウントの SID

## 事前の準備

1. キット専用の Windows ユーザーでサインインします（画面の前で。RDP は使いません）。
2. Node.js 20 以上（x64）と Git for Windows をインストールします。
3. Illustrator を起動していないことを確かめます。
4. 確認用の文書を保存するフォルダ（例: `C:\mcp-probe-docs`）を作ります。キットの作業フォルダ（例: `C:\mcp-probe-state`）は**まだ作らないでください**（空か、存在しないことが条件です）。`%TEMP%` の下は使えません。
5. キットを取得します。**`--config core.autocrlf=false` を必ず付けてください**（改行が書き換わると、キットのファイルの SHA-256 が合わなくなり、C9 で止まります）。`<タグ>` は、このキットを案内したリリースのタグです（リリースノートの「Windows 検証キット」の節に書いてあります）。

   ```powershell
   git clone --config core.autocrlf=false https://github.com/mhimt-lab/illustrator-studio-mcp.git
   cd illustrator-studio-mcp
   git checkout <タグ>
   ```

### 開始前の確認（C1〜C10）

キットは開始時に次を確かめ、`environment.json` に記録します。1 つでも満たされなければ、Illustrator に触れずに終了します（`summary.md` に満たされなかった項目が書かれます）。事前に PowerShell で確かめておくと確実です。

| # | 確認 | PowerShell のコマンド | 条件 |
| --- | --- | --- | --- |
| C1 | OS と CPU | `[Environment]::OSVersion.Version`、`$env:PROCESSOR_ARCHITECTURE` | ビルド 19045 以降、`AMD64` |
| C2 | セッション | `query session`（自分の行） | `console`（RDP ではない）、ロックされていない |
| C3 | PowerShell | `$PSVersionTable.PSVersion` | 5.1.x |
| C4 | 実行ポリシー | `Get-ExecutionPolicy -List` | `MachinePolicy` と `UserPolicy` が `Undefined` |
| C5 | Node.js | `node -p "process.version + ' ' + process.arch"` | 20 以上、`x64` |
| C6 | Illustrator | （開始時に質問します） | 通常版が 1 つ |
| C7 | 権限 | `whoami /groups` | `Medium Mandatory Level`（管理者として実行していない） |
| C8 | 業務の文書 | （開始時に質問します） | このユーザーに業務の Illustrator 文書が無い |
| C9 | キット | （キットが確かめます） | HEAD がタグと一致、未変更、キットの SHA-256 が一致 |
| C10 | サインイン | （開始時に質問します） | パスワードか PIN がある |

## 実行

PowerShell（管理者ではない通常のウィンドウ）で、リポジトリのフォルダから実行します。`<タグ>` と `<キットの SHA-256>` はリリースノートの「Windows 検証キット」の節の値に置き換えてください。

```powershell
node windows-probe\illustrator-windows-probe.mjs --state-root C:\mcp-probe-state --expect-head (git rev-parse "<タグ>^{commit}") --expect-sha256 <キットの SHA-256>
```

画面に日本語と英語の指示が出ます。指示の操作を終えてから Enter を押してください。W0 では Illustrator の通常版を起動し、新規文書を次の 2 つの名前で確認用のフォルダに保存して、2 枚とも開いたままにします（名前はここからコピーしてください）。

```text
mcp-windows-probe.ai
mcp-windows-probe-日本語.ai
```

W3 では、`mcp-windows-probe.ai` でモーダルダイアログ（例: ファイル > ドキュメント設定）を開いたままにします。W9 で「閉じてください」と表示されるまで閉じないでください。

1 項目が終わるたびに、1 行の JSON（`"event":"cell"`）が表示されます。最後に `"event":"completed"`（全項目の終了）または `"event":"stopped"`（途中で停止）が表示されます。

### 画面ロックと解錠

W4 と W15 で、キットが画面をロックします。ロックされたら **1 分ほど待ってから**、いつもどおりパスワードか PIN で解錠してください。W5・W6 はロック中に自動で進みます。キットは解錠を待ちます（最大 15 分）。

### 止まったとき

- **途中で止まっても、キットを再実行しないでください。** 止まった項目より後は実行されず、`summary.md` に `NOT_RUN` と記録されます。その結果も大事なデータなので、そのまま提出してください。
- **時間切れ（timeout）は「失敗」ではなく「結果が分からない」という記録です**（`INDETERMINATE`）。再試行しないでください。
- Illustrator が応答しなくなったときは、無理に操作を続けず、キットの表示が止まったのを確かめてから Illustrator を終了してください。確認用の文書は保存しなくて構いません。
- 同じ日に結果フォルダがすでにあると、キットは何もせずに終了します（結果を上書きしないため）。

## 提出前の確認

添付する前に、結果フォルダのファイルをすべてメモ帳などで開き、中身を確認してください。そのうえで、PowerShell で自分の名前やコンピューター名が残っていないかを検索します。**何も表示されなければ** 問題ありません。

```powershell
Select-String -Path .\windows-probe-results-*\* -SimpleMatch -Pattern $env:USERNAME, $env:COMPUTERNAME, $env:USERDOMAIN
```

表示された行があれば、その部分を消すか、提出を見送ってください。ほかに、社名・メールアドレス・実名など、公開したくない言葉が無いことも確かめてください。

## 提出

公開リポジトリの Issue フォーム「[Windows 検証キットの結果](https://github.com/mhimt-lab/illustrator-studio-mcp/issues/new?template=windows-probe-result.yml)」から提出します。GitHub のアカウントが必要です。

1. フォームの同意と確認の項目に目を通し、チェックを入れます。
2. 結果フォルダの `environment.json`・`summary.md`・すべての `w<番号>.json` を添付欄にドラッグします（まとめて ZIP にしても構いません）。
3. Windows と Illustrator の版、止まった場合はその時の様子を書いて送信します。

送信した Issue とファイルは誰でも読めます。

## 提出の後

作業フォルダ（例: `C:\mcp-probe-state`）、`%LOCALAPPDATA%\illustrator-studio-mcp-probe-<日付>\`、結果フォルダ、確認用の文書を削除して構いません。
