# 導入とAIアプリの設定

**日本語** | [English](install.en.md)

**Public Beta 0.1.0-beta.6。** Mac、通常版Illustrator、Node.js 20以上が必要です（Claude DesktopのDesktop拡張はNode.js不要）。AIアプリの利用条件・料金は別で、このツール自体のAPIキーは不要です。Illustratorを前面に表示し、画面ロックを解除して使います。[アプリ別の確認範囲](compatibility.md)を確認してください。

## npm / npx から始める（Mac CLI）

通常版Illustratorを前面に表示し、画面ロックを解除して、確認用の書類を開いてから次の2行を実行します。手動download、clone、local build、global installは不要です。

```bash
npx -y illustrator-studio-mcp@beta --version
npx -y illustrator-studio-mcp@0.1.0-beta.6 doctor
```

`@beta` は新しいPublic Betaを見つける入口です。1行目が `0.1.0-beta.6` 以外なら止まり、その版の公開案内・変更履歴を確認してください。2行目と保存する登録設定は、確認したexact versionに固定します。タグなしの指定は `latest` を使います。doctorはIllustratorへ問い合わせますが、書類を編集したり設定を修復したりしません。未実施・結果不明は成功ではありません。初回はmacOSの操作許可が必要な場合があります。

Node/npm/npxが見つからない場合、helperやdoctorにも到達できません。[Node.js公式配布](https://nodejs.org/)でNode.js 20以上を用意し、ターミナルを開き直して `node --version`、`npm --version`、`command -v npx` を確認してください。AIアプリのPATHはターミナルと異なる場合があります。設定には実際の `npx` の絶対パスを使い、NodeもそのアプリのPATHに含めます。registry unavailable / offline時は取得失敗として止まり、手元cacheや別versionの成功で置き換えません。

公開済みnpm 0.1.0-beta.5 の空cacheからの `--version` は既存Macで確認済みです（beta.6は公開後に確認します）。新品Mac、doctor、再起動後のclient接続、更新・rollbackの実機確認は別で、未完了です。

## 配布用ファイルから入れる

[GitHub prerelease](https://github.com/mhimt-lab/illustrator-studio-mcp/releases/tag/v0.1.0-beta.6)からtgzと `SHA256SUMS` を同じフォルダへ取得し、そのフォルダで実行します。`SHA256SUMS` にはDesktop拡張（`.mcpb`）の行もあるため、取得していないファイルは `--ignore-missing` で飛ばします。

```bash
shasum -a 256 -c SHA256SUMS --ignore-missing
npm install -g ./illustrator-studio-mcp-0.1.0-beta.6.tgz
illustrator-studio-mcp --version
illustrator-studio-mcp doctor
```

hash不一致なら導入せず停止してください。配布用JavaScriptは `dist/` に同梱済みで、buildは不要です。この公開ツリーはTypeScriptの開発用checkoutではありません。

## Register the installed command

既存のserver設定を保ち、同名が存在しないことを確認してから、選んだclientの1行をコピーして実行します。通常版Illustratorの接続先は `id:com.adobe.illustrator` です。公開beta.6の完成形は次です。

### Claude Code

```bash
claude mcp add --transport stdio --scope user illustrator-studio -- npx -y illustrator-studio-mcp@0.1.0-beta.6
```

再起動して `/mcp` を確認します。登録されるcommandは `npx`、argsは `-y`, `illustrator-studio-mcp@0.1.0-beta.6` です。

### Claude Desktop

#### Desktop拡張（`.mcpb`、主な手順）

Desktop拡張は、Claude Desktopに内蔵されたNode.jsで動きます。npmでのインストールも設定ファイルの編集も不要です。

1. [illustrator-studio-mcp-0.1.0-beta.6.mcpb をダウンロード](https://github.com/mhimt-lab/illustrator-studio-mcp/releases/download/v0.1.0-beta.6/illustrator-studio-mcp-0.1.0-beta.6.mcpb)します。ファイルを確かめる場合は、[GitHub prerelease](https://github.com/mhimt-lab/illustrator-studio-mcp/releases/tag/v0.1.0-beta.6)から `SHA256SUMS` を同じフォルダへ取得し、そのフォルダで `shasum -a 256 -c SHA256SUMS --ignore-missing` を実行します。hash不一致なら導入せず停止してください。
2. `.mcpb` ファイルをダブルクリックしてClaude Desktopで開きます。インストール画面で提供元 **mhimt**、版 **0.1.0-beta.6**、ライセンス **BUSL-1.1** を確認して「インストール」を押します。この拡張には署名がありません。
3. 設定の「Illustrator application」は、通常版なら既定値 `id:com.adobe.illustrator` のまま保存します（Illustrator Beta版は `id:com.adobe.illustratorBeta`）。
4. 拡張が有効になっていることを確かめ、新しいチャットで読み取りだけを依頼します（[書類を変えずに試す](#書類を変えずに試す)）。

削除は、Claude Desktopの設定 → 拡張機能から行います。同じサーバーを設定ファイル方式でも登録すると、同じツールが2つ表示されます。どちらか一方にしてください。

#### 設定ファイル方式（代替）

通常のNode.jsで動かしたい場合や、npmで入れた版を使いたい場合は、設定ファイルに書く方法も使えます。まずnpmのグローバルインストールを済ませ、ターミナルで実際のパスを確認します。

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

```bash
codex mcp add illustrator-studio -- npx -y illustrator-studio-mcp@0.1.0-beta.6
```

設定保存後に `codex mcp get illustrator-studio` でexact pinを確認します。別のserver名に同じ設定を追加して重複させないでください。代わりにTOMLを使う場合もexact versionを保存します。

```toml
[mcp_servers.illustrator-studio]
command = "npx"
args = ["-y", "illustrator-studio-mcp@0.1.0-beta.6"]

[mcp_servers.illustrator-studio.env]
ILLUSTRATOR_APPLICATION = "id:com.adobe.illustrator"
```

`npx` とNodeがclientのPATHにあることを確認し、Codexを再起動して `/mcp` を確認します。

変更系のツールは、`apply: false` の計画の結果に `next_call` が付きます。Codexはその引数（`command_id` を含む）をそのまま使って適用できます。変更を承認する前に、計画の内容を確かめてください。beta.4では、Codex CLIが追加の指示なしに長方形の計画・適用・保存・再読込まで進むことを確認しています（[確認状況](compatibility.md)）。

### 読み取り専用setup helper

`0.1.0-beta.6` から `setup` があります。次で、起動した版に固定した完成形の登録コマンドを表示できます。先にその版の `--version` と `doctor` を確認してください。

```bash
npx -y illustrator-studio-mcp@beta setup --client claude-code
npx -y illustrator-studio-mcp@beta setup --client codex
```

どちらか自分のclientを選び、表示された `register` の1行をコピーして実行します。package名・server名・versionの入力は不要です。helperは起動したpackageのexact versionを使い、HOME/client設定を読み書きせず、doctor・client・MCP server・Illustratorも起動しません。`--json` は機械可読出力です。`current` と `previous` は設定を検出した値ではなく、利用者が渡した値です。未指定ならunknownです。通常のMCP stdio起動とは出力を分離しています。

### ChatGPT（Work・お使いのコンピューターで）

ChatGPTデスクトップアプリの「Work」で、実行場所（入力欄の右下のパソコンのアイコン、「このチャットをどこで実行しますか？」）を「お使いのコンピューターで」にして使います。このMCPはローカルのstdioサーバーとして動きます。「クラウドで」には対応していません。

#### pluginで追加する（主な手順）

ChatGPTの画面だけで追加できます。必要なのはNode.js 20以上です（[公式サイト](https://nodejs.org/ja)のインストーラーで入れます。pluginは `npx` で `illustrator-studio-mcp@0.1.0-beta.6` を起動します）。

1. ChatGPTのサイドバーで「プラグイン」を開き、右上の「追加」→「マーケットプレイスを追加」を選びます（「設定」→「プラグイン」→「追加」にも同じメニューがあります）。
2. 「プラグインマーケットプレイスを追加」で、「ソース」に `mhimt-lab/illustrator-studio-mcp`、「Git ref」に `v0.1.0-beta.6` を入力し、「マーケットプレイスを追加」を押します。Git ref は版の固定です。版を固定して追加することをおすすめします。
3. 同じ画面で「Illustrator」を検索し、**Illustrator Studio MCP** の「＋」を押します。「Illustrator Studio MCP プラグインをインストールしました」と表示されれば完了です。
4. 上の「Work」を選び、入力欄の右下のパソコンのアイコンが「お使いのコンピューターで」になっていることを確かめて、新しいチャットでまず読み取りだけを依頼します（[書類を変えずに試す](#書類を変えずに試す)）。

ChatGPTのモデルによっては、ツールを探さずに失敗することがあります。うまくいかないときは、上位のモデルで試してください。

削除は、「プラグイン」で **Illustrator Studio MCP** の「…」→「アンインストール」です。下の1行登録と両方を有効にすると、同じ機能のサーバーが2つ表示されます。どちらか一方にしてください。

画面から追加したときに書き込まれる設定は、下のコマンドで追加したときと同じです。

##### ターミナルに慣れている方向け（代わりの方法）

Codex CLIがあれば、ターミナルで次の2行を実行しても同じように追加できます。

```bash
codex plugin marketplace add mhimt-lab/illustrator-studio-mcp --ref v0.1.0-beta.6
codex plugin add illustrator-studio-mcp@illustrator-studio-mcp
```

1行目の `--ref v0.1.0-beta.6` は版の固定です。追加したらChatGPTを完全に終了して起動し直し、「設定」→「プラグイン」で **Illustrator Studio MCP** が有効になっていること、「MCP」タブの「プラグインから」に `illustrator-studio-plugin` があることを確かめます。

コマンドで削除する場合は、「プラグイン」でアンインストールした後、`codex plugin marketplace remove illustrator-studio-mcp` を実行します。確認では、pluginの更新でほかの設定は変わらず、削除で消えたのはこのpluginとmarketplaceの項目だけでした（手動で登録したMCP・ほかのplugin・実行記録は残りました）。

新しい版に更新するときは、次の順に実行します。**この更新手順は、次の版の公開時に確認します（未確認）。**

```bash
codex plugin marketplace remove illustrator-studio-mcp
codex plugin marketplace add mhimt-lab/illustrator-studio-mcp --ref <新しい版のタグ>
codex plugin add illustrator-studio-mcp@illustrator-studio-mcp
```

その後、ChatGPTを完全に終了して起動し直します。

#### コマンド1行で登録する（代わりの方法）

ChatGPTデスクトップとCodex CLIは同じMCP設定を共有します（[公式の説明](https://learn.chatgpt.com/docs/extend/mcp)）。Codex CLIがあれば、ターミナルで次の1行を実行するだけで登録できます。上の「Codex CLI」で登録済みなら、同じサーバーがChatGPTにも表示されます。

```bash
codex mcp add illustrator-studio -- npx -y illustrator-studio-mcp@0.1.0-beta.6
```

- 既に同じ名前のサーバーがある場合は、別の名前にしてください（既存の設定を上書きしないため）。
- `codex mcp add` は設定ファイルを書き直すときに、既定値と同じ値の明示（例: `enabled = true`）を省くことがあります。意味は変わりません。気になる場合は実行前に `~/.codex/config.toml` のコピーを取ってください。
- 操作するIllustratorは、`ILLUSTRATOR_APPLICATION` を設定しなければ通常版（`id:com.adobe.illustrator`）です。

登録後、ChatGPTデスクトップの「設定」→「プラグイン」→「MCP」でサーバーが表示されていることを確認し、そのスイッチを一度オフにしてからオンに戻します。「Work」の新しいチャット（実行場所は「お使いのコンピューターで」）で、まず読み取りだけを依頼します。

> illustrator_list_documents を1回だけ実行して、開いている書類を教えて。作成・編集・保存はしないで。

#### Codex CLIがない場合（画面から登録）

まずnpmのグローバルインストールを済ませ、ターミナルで実際のパスを確認します。

```bash
command -v node
npm root -g
```

1. ChatGPTデスクトップで「Work」を選び、「設定」→「プラグイン」→「MCP」→「追加」→「STDIO」を選びます。
2. 次のように入力します。既存の同名サーバーがあれば上書きせず、内容を確認してください。
   - 「起動用コマンド」: `command -v node` で表示された node の絶対パス
   - 「引数」: `npm root -g` の出力に `/illustrator-studio-mcp/dist/index.js` を付けた絶対パス（グローバルインストールせずに使う場合は、コマンドに `command -v npx` の絶対パス、引数に `-y` と `illustrator-studio-mcp@0.1.0-beta.6`）
   - 「環境変数」: `ILLUSTRATOR_APPLICATION` = `id:com.adobe.illustrator`
3. 保存した後、そのサーバーのスイッチを一度オフにしてからオンに戻し、接続し直します。

使うときの注意:

- ツール呼び出しの承認（許可モード）は、変更を確認できる設定のままにしてください。変更系のツールは、先に `apply: false` の計画を確かめてから適用を承認します。
- 計画の結果に `next_call` があれば、その引数（`command_id` を含む）をそのまま適用に使うと迷いません。同じ適用を再試行するときだけ同じ値を使います。
- 実行記録の置き場所（`ILLUSTRATOR_STUDIO_MCP_STATE_DIR`）は通常は設定不要です（既定は `~/Library/Application Support/illustrator-studio-mcp`）。自分で作ったディレクトリを指定する場合は、権限を `0700` にしてください（`chmod 700 <ディレクトリ>`）。所有者が自分でない、または権限が広いディレクトリは、サーバーが使う時点で拒否されます。

確認状況: beta.4の配布物そのものを、上と同じ `codex mcp add … -- npx -y …` の1行（公開前のため、パッケージ指定だけ配布用ファイルのパスに置き換え）で登録し、「Work」の新しいチャット（実行場所は「お使いのコンピューターで」）から、長方形の計画・適用・結果の読み直し・保存・再読込までを確認しています。詳しくは[対応環境と検証範囲](compatibility.md)を参照してください。

## 書類を変えずに試す

テスト用の書類で、次のように依頼します。

> 開いているIllustratorの書類と、選択した文字や図形を教えて。変更・保存・書き出しはしないで。

画面と返答を照合します。書類がない場合と「選択なし」は区別します。診断や応答が不明・未実施なら成功と扱わず、[復旧手順](runbook.md)を参照してください。

## 更新・削除

<!-- exact-version-history:start -->
### exact versionへ明示更新・rollback

まず `claude mcp get illustrator-studio` または `codex mcp get illustrator-studio` で保存済みのcurrent exactを確認し、同名の別serverでないことと、元の設定・scope・環境を控えます。Claudeの例はuser scopeです。違うscopeの既存設定をこの手順で置き換えないでください。 以下の置換コマンドは、既定の `npx -y <exact>` だけを使い、追加args/envの無い設定に限ります。Illustrator Betaの指定など独自の設定がある場合は、元の設定を保ってclientの設定編集でexact pinだけを変更してください。未解決の操作・結果不明・編集中sessionを解決し、降格先との互換性と変更履歴を確認します。実行記録を消して回避しません。

例: current=`0.1.0-beta.5`、target=`0.1.0-beta.6`、previous=`0.1.0-beta.5`。公開済み版では、選んだclientの次の1行で明示更新します（同じ名前の設定だけを外して登録し直します）。

```bash
claude mcp remove --scope user illustrator-studio && claude mcp add --transport stdio --scope user illustrator-studio -- npx -y illustrator-studio-mcp@0.1.0-beta.6
codex mcp remove illustrator-studio && codex mcp add illustrator-studio -- npx -y illustrator-studio-mcp@0.1.0-beta.6
```

rollbackは、控えたprevious exactを確認して、選んだclientの1行を実行します。この例の完成形は次です。

```bash
claude mcp remove --scope user illustrator-studio && claude mcp add --transport stdio --scope user illustrator-studio -- npx -y illustrator-studio-mcp@0.1.0-beta.5
codex mcp remove illustrator-studio && codex mcp add illustrator-studio -- npx -y illustrator-studio-mcp@0.1.0-beta.5
```

helper公開後はtarget exactのhelperにcurrent/previousを渡すと、3つの版と `update` / `rollback` の完成形が表示されます。

```bash
npx -y illustrator-studio-mcp@beta setup --client codex --current 0.1.0-beta.5 --previous 0.1.0-beta.5
```

表示されたtargetを確認してから、選んだ1行を実行してください。`@beta` は設定に保存しません。登録失敗時は停止して保存先を確認し、控えた設定で復旧します。自動更新・自動設定書換はありません。更新・rollback後はそのexact versionで `--version` と `doctor` を実行し、AIアプリを再起動して `/mcp` を確認します。設定保存、接続、Illustratorの操作成功は別の証拠です。

<!-- exact-version-history:end -->

削除はAIアプリの該当server設定を外します。global installを併用していた場合だけ `npm uninstall -g illustrator-studio-mcp` を使います。未解決の実行記録は削除しません。

GitHubのmain上の案内は公開後にも訂正されることがあります。npmに公開済みの各版のREADMEとtgzは、後からの文書修正では変わりません。最新の案内は[公開README](../README.ja.md)を参照してください。

設定形式の出典: [Claude Code](https://code.claude.com/docs/en/mcp)、[Claude DesktopのローカルMCP](https://modelcontextprotocol.io/docs/develop/connect-local-servers)、[Codex MCP](https://learn.chatgpt.com/docs/extend/mcp)、[npm exec / npx](https://docs.npmjs.com/cli/v11/commands/npm-exec/)。接続例の仕様と実機確認範囲は別です。

公開済みnpm 0.1.0-beta.1のtgz内のCHANGELOGは差し替えできません。収録済みの日付はそのままで、公開日は2026-09-22 JST（Asia/Tokyo）です。
