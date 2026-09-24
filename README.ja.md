# Illustrator Studio MCP

[![License: BUSL-1.1](https://img.shields.io/badge/license-BUSL--1.1-blue.svg)](LICENSE) ![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg) ![Node.js >=20](https://img.shields.io/badge/node-%3E%3D20-339933.svg) ![MCP: 2026-07-28](https://img.shields.io/badge/MCP-2026--07--28-blue.svg) ![Status: beta](https://img.shields.io/badge/status-beta-orange.svg) [![npm beta version](https://img.shields.io/npm/v/illustrator-studio-mcp/beta)](https://www.npmjs.com/package/illustrator-studio-mcp)

[English](README.md) | **日本語**

**Illustratorの作業を、AIに言葉で頼めるツールです。**

たとえば、こんなふうに頼めます。

- 「選択した見出しを『週末限定フェア』に変えて。文字サイズと色はそのままで」
- 「この3つの図形を、横に等間隔で並べて」
- 「この写真を最新版の画像に差し替えて。位置と大きさはそのままで」

変える前に「どこを・どう変えるか」を見せ、変えた後はIllustratorから結果を読み直して確かめます。いまはPublic Beta（0.1.0-beta.4）です。

[84の機能](docs/tools.md) · [Illustrator 2026（30.8）で操作ごとに実機確認](docs/compatibility.md) · Claude Desktop / ChatGPT / Claude Code / Codex CLI に対応

## 使えるAIアプリと始め方

### Claude Desktop（いちばん簡単・Node.js不要）

1. [illustrator-studio-mcp-0.1.0-beta.4.mcpb をダウンロード](https://github.com/mhimt-lab/illustrator-studio-mcp/releases/download/v0.1.0-beta.4/illustrator-studio-mcp-0.1.0-beta.4.mcpb)して、ダブルクリック →「インストール」を押します。
2. 拡張が有効になっていることを確かめて、新しいチャットで使い始めます。

ダウンロードしたファイルを確かめたい場合は、[GitHubの配布ページ](https://github.com/mhimt-lab/illustrator-studio-mcp/releases/tag/v0.1.0-beta.4)の `SHA256SUMS` と照合できます（手順は[導入ガイド](docs/install.md#desktop拡張mcpb主な手順)）。

### ChatGPT

必要なもの: Node.js 20以上（[公式サイト](https://nodejs.org/ja)のインストーラーで入れます）

1. ChatGPTのサイドバーで「プラグイン」を開き、右上の「追加」→「マーケットプレイスを追加」を選びます。
2. 「ソース」に `mhimt-lab/illustrator-studio-mcp`、「Git ref」に `v0.1.0-beta.4` を入力し、「マーケットプレイスを追加」を押します。Git ref は版の固定です。
3. 同じ画面で「Illustrator」を検索し、Illustrator Studio MCP の「＋」を押します。「インストールしました」と表示されれば完了です。
4. 上の「Work」を選び、入力欄の右下のパソコンのアイコンが「お使いのコンピューターで」になっていることを確かめて、新しいチャットで使い始めます。

削除は、「プラグイン」で Illustrator Studio MCP の「…」→「アンインストール」です。ChatGPTのモデルによっては、ツールを探さずに失敗することがあります。うまくいかないときは、上位のモデルで試してください。実行場所の「クラウドで」には対応していません。

ターミナルに慣れている方は、Codex CLIのコマンド2行でも追加できます（追加後はChatGPTを起動し直します）。

```bash
codex plugin marketplace add mhimt-lab/illustrator-studio-mcp --ref v0.1.0-beta.4
codex plugin add illustrator-studio-mcp@illustrator-studio-mcp
```

### Claude Code

Node.js 20以上が必要です。ターミナルで次の1行を実行し、Claude Codeを起動し直します。

```bash
claude mcp add --transport stdio illustrator-studio -- npx -y illustrator-studio-mcp@beta
```

### Codex CLI

Node.js 20以上が必要です。ターミナルで次の1行を実行し、Codex CLIを起動し直します。

```bash
codex mcp add illustrator-studio -- npx -y illustrator-studio-mcp@beta
```

ダウンロードしたファイルの確かめ方、更新・削除、ほかの登録方法は[導入ガイド](docs/install.md)にまとめています。

## 使うときの注意

- **Mac専用です。** 通常版のAdobe Illustrator（2026・30.8で確認）で使います。
- **Illustratorを前面に表示し、画面をロックしないでください。** 背面や画面ロック中は、操作が止まったり、理由の分かりにくい失敗になったりします。
- **まず制作ファイルのコピーで試してください。** 試用版で、本番運用向けの完成版ではありません。

## 最初の頼み方

Illustratorで確認用の書類を開き、まずは見るだけの依頼をします。MacがIllustratorの操作許可を求めた場合は、内容を確認して許可します。

```text
Illustratorで開いている書類と、いま選択している文字や図形を教えて。
確認するだけにして、変更・保存・書き出しはしないで。
```

返答がIllustratorの画面と合っていれば準備完了です。何も選択していない場合は「選択なし」で正常です。

次に、変更案だけを見せてもらいます。グループに入っていない一行の文字（文字ツールでクリックして入力した文字）を選んでから、こう頼みます。

```text
選択した見出しを「週末限定フェア」に変えたい。文字サイズと色はそのままにして。
まず対象と変更案を見せて。まだ変更・保存はしないで。
対応できない書式なら、その理由を教えて。
```

対象と内容に間違いがなければ、「その内容で変更して」と頼みます。ほかの依頼の例は[使い方と依頼例](docs/usage.md)にあります。

## 安全の仕組み

- 変える前に、対象と変更内容を見せます。あなたが確かめてから適用します。
- 書き込む直前にも対象を確かめ、書き込んだ後はIllustratorから結果を読み直します。見た目や入稿品質は、最後にIllustratorの画面で確認してください。
- 応答が途切れて結果が分からないときは、次の編集を止めます。推測で続けません。

## 詳しい情報

- [使い方と依頼例](docs/usage.md) — できることの一覧と、そのまま使える依頼文
- [導入ガイド](docs/install.md) — アプリ別の登録手順、更新・削除
- [対応範囲と検証記録](docs/compatibility.md) — Betaの範囲、アプリ別の確認状況、既知の制約
- [安全の仕組み](docs/safety.md) — 変更を確かめる流れ、上書き保存・バックアップ
- [困ったとき](docs/runbook.md) — 応答が止まった・結果が分からないとき
- [ツール一覧](docs/tools.md) — AIアプリが使う機能の一覧
- [変更履歴](CHANGELOG.md)・[リリースノート](RELEASE_NOTES.md) — 版ごとの変更
- [サポート](SUPPORT.ja.md)・[セキュリティ](SECURITY.ja.md) — 不具合の報告と脆弱性の連絡
- [English README](README.md) — 英語版

## ライセンス

[Business Source License 1.1](LICENSE)です。通常の社内業務や、クライアントにデザイン成果物を納める制作利用はAdditional Use Grantで許可されています。第三者へ競合する製品・サービスとして提供する場合は制限があります。OSI準拠のオープンソースライセンスではありません。利用条件は[LICENSE本文](LICENSE)を確認してください。

Illustrator Studio MCPは独立したプロジェクトで、Adobeの公式製品ではありません。Adobeによる提携・承認・後援はありません。Adobe、IllustratorはAdobeの米国およびその他の国における商標または登録商標です。

<details>
<summary>接続・開発担当者向け：機能の識別名（普段の依頼では入力不要）</summary>

`illustrator_align_objects`, `illustrator_apply_character_style`, `illustrator_apply_pathfinder`, `illustrator_capture_preview`, `illustrator_capture_structure_snapshot`, `illustrator_check_contrast`, `illustrator_check_text_consistency`, `illustrator_close_document`, `illustrator_close_edit_session`, `illustrator_compare_images`, `illustrator_create_area_text`, `illustrator_create_backup`, `illustrator_create_batch`, `illustrator_create_character_style`, `illustrator_create_clipping_mask`, `illustrator_create_document`, `illustrator_create_layer`, `illustrator_create_point_text`, `illustrator_create_rectangle`, `illustrator_create_shape`, `illustrator_create_swatch_resource`, `illustrator_delete_objects`, `illustrator_diff_structure`, `illustrator_duplicate_object`, `illustrator_edit_path_points`, `illustrator_embed_image`, `illustrator_export`, `illustrator_export_outlined`, `illustrator_extract_design_tokens`, `illustrator_find_color_usages`, `illustrator_find_fonts`, `illustrator_get_area_text_options`, `illustrator_get_context`, `illustrator_get_edit_session`, `illustrator_get_object`, `illustrator_get_path_points`, `illustrator_group_objects`, `illustrator_import_vector_artwork`, `illustrator_list_documents`, `illustrator_list_layers`, `illustrator_list_objects`, `illustrator_list_recipes`, `illustrator_list_selection`, `illustrator_list_swatches`, `illustrator_list_text_styles`, `illustrator_make_compound_path`, `illustrator_move_object_to_layer`, `illustrator_mutate_batch`, `illustrator_open_document`, `illustrator_open_edit_session`, `illustrator_optimize_images`, `illustrator_place_image`, `illustrator_plan_color_replacement`, `illustrator_plan_recipe`, `illustrator_preflight_images`, `illustrator_preflight_print`, `illustrator_read_structure_diff`, `illustrator_reconcile`, `illustrator_reconcile_backup`, `illustrator_reconcile_delete`, `illustrator_reconcile_export`, `illustrator_release_clipping_mask`, `illustrator_relink_image`, `illustrator_reorder_layer`, `illustrator_replace_font`, `illustrator_replace_point_text`, `illustrator_replace_point_text_batch`, `illustrator_replace_text_range`, `illustrator_run_m6_appearance_preview_recipe`, `illustrator_run_recipe`, `illustrator_save_document`, `illustrator_save_document_as`, `illustrator_save_recipe`, `illustrator_set_area_text_columns`, `illustrator_set_layer_state`, `illustrator_set_no_break`, `illustrator_set_object_state`, `illustrator_set_path_appearance`, `illustrator_set_stacking_order`, `illustrator_set_text_orientation`, `illustrator_set_text_style`, `illustrator_transform_object`, `illustrator_update_artboard`, `illustrator_update_character_style`

</details>

## 連絡先

公開用の管理者名は **mhimt**、連絡先は [sporks-framer9t@icloud.com](mailto:sporks-framer9t@icloud.com) です。応答時間の保証はありません。脆弱性や私的な資料を通常のIssueに投稿せず、[非公開の脆弱性報告](https://github.com/mhimt-lab/illustrator-studio-mcp/security/advisories/new)、または機密情報を含めない概要のメールを使ってください。
