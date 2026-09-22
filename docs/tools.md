# 84のMCPツール

**日本語** | [English](tools.en.md)

Public Beta 0.1.0-beta.4のinstalled packageで機能取得を確認した84件の全ツール名です。利用可能な機能の一覧であり、全入力の実機確認を意味しません。引数はAIアプリが取得する入力仕様を確認し、名前を推測しないでください。[確認範囲](compatibility.md)、[導入](install.md)、[復旧](runbook.md)も参照してください。

通常版Illustratorを前面に表示し、画面ロックを解除して使います。sessionは36種類の変更操作に対応し、削除・画像埋め込み・ベクター取り込み・アートボード更新は対象外です。backupとsessionの実質上限は1,000 items（1,000 itemsの実機1回で確認）です。SVG書き出し、アートボードの削除・Webピクセル指定、段落スタイル、グループ解除、リンク切れ修復、Windowsは対象外です。プレビュー取得は汎用の書き出し機能ではありません。1件の削除にも明示的なbackup・確認契約が必要です。

| # | ツール識別名 |
| --- | --- |
| 1 | `illustrator_align_objects` |
| 2 | `illustrator_apply_character_style` |
| 3 | `illustrator_apply_pathfinder` |
| 4 | `illustrator_capture_preview` |
| 5 | `illustrator_capture_structure_snapshot` |
| 6 | `illustrator_check_contrast` |
| 7 | `illustrator_check_text_consistency` |
| 8 | `illustrator_close_document` |
| 9 | `illustrator_close_edit_session` |
| 10 | `illustrator_compare_images` |
| 11 | `illustrator_create_area_text` |
| 12 | `illustrator_create_backup` |
| 13 | `illustrator_create_batch` |
| 14 | `illustrator_create_character_style` |
| 15 | `illustrator_create_clipping_mask` |
| 16 | `illustrator_create_document` |
| 17 | `illustrator_create_layer` |
| 18 | `illustrator_create_point_text` |
| 19 | `illustrator_create_rectangle` |
| 20 | `illustrator_create_shape` |
| 21 | `illustrator_create_swatch_resource` |
| 22 | `illustrator_delete_objects` |
| 23 | `illustrator_diff_structure` |
| 24 | `illustrator_duplicate_object` |
| 25 | `illustrator_edit_path_points` |
| 26 | `illustrator_embed_image` |
| 27 | `illustrator_export` |
| 28 | `illustrator_export_outlined` |
| 29 | `illustrator_extract_design_tokens` |
| 30 | `illustrator_find_color_usages` |
| 31 | `illustrator_find_fonts` |
| 32 | `illustrator_get_area_text_options` |
| 33 | `illustrator_get_context` |
| 34 | `illustrator_get_edit_session` |
| 35 | `illustrator_get_object` |
| 36 | `illustrator_get_path_points` |
| 37 | `illustrator_group_objects` |
| 38 | `illustrator_import_vector_artwork` |
| 39 | `illustrator_list_documents` |
| 40 | `illustrator_list_layers` |
| 41 | `illustrator_list_objects` |
| 42 | `illustrator_list_recipes` |
| 43 | `illustrator_list_selection` |
| 44 | `illustrator_list_swatches` |
| 45 | `illustrator_list_text_styles` |
| 46 | `illustrator_make_compound_path` |
| 47 | `illustrator_move_object_to_layer` |
| 48 | `illustrator_mutate_batch` |
| 49 | `illustrator_open_document` |
| 50 | `illustrator_open_edit_session` |
| 51 | `illustrator_optimize_images` |
| 52 | `illustrator_place_image` |
| 53 | `illustrator_plan_color_replacement` |
| 54 | `illustrator_plan_recipe` |
| 55 | `illustrator_preflight_images` |
| 56 | `illustrator_preflight_print` |
| 57 | `illustrator_read_structure_diff` |
| 58 | `illustrator_reconcile` |
| 59 | `illustrator_reconcile_backup` |
| 60 | `illustrator_reconcile_delete` |
| 61 | `illustrator_reconcile_export` |
| 62 | `illustrator_release_clipping_mask` |
| 63 | `illustrator_relink_image` |
| 64 | `illustrator_reorder_layer` |
| 65 | `illustrator_replace_font` |
| 66 | `illustrator_replace_point_text` |
| 67 | `illustrator_replace_point_text_batch` |
| 68 | `illustrator_replace_text_range` |
| 69 | `illustrator_run_m6_appearance_preview_recipe` |
| 70 | `illustrator_run_recipe` |
| 71 | `illustrator_save_document` |
| 72 | `illustrator_save_document_as` |
| 73 | `illustrator_save_recipe` |
| 74 | `illustrator_set_area_text_columns` |
| 75 | `illustrator_set_layer_state` |
| 76 | `illustrator_set_no_break` |
| 77 | `illustrator_set_object_state` |
| 78 | `illustrator_set_path_appearance` |
| 79 | `illustrator_set_stacking_order` |
| 80 | `illustrator_set_text_orientation` |
| 81 | `illustrator_set_text_style` |
| 82 | `illustrator_transform_object` |
| 83 | `illustrator_update_artboard` |
| 84 | `illustrator_update_character_style` |

## plan から apply へ（`next_call` と `command_id`）

変更はどれも2回の呼び出しです。`apply: false` で plan を受け取り、`apply: true` と `command_id` で実行します。変更ツール40種すべてで、blocker がなく、必要な値を公開入力 schema に適合する形で組み立てられた場合に `next_call` が付きます。ツール名と apply にそのまま渡す引数（新しい `command_id` の候補を含む）です。この引数を変えずに送ってください。複製・グループ・重なり順・複合パス・パスファインダー・クリッピング・レイヤー・文字スタイル・フォント置換・画像埋め込み・パス編集・削除・ベクター読み込み・バッチ・整列・アートボード更新も対象です。blocker や値の欠落・不整合がある場合、候補は返しません。候補があっても、実行時の文書・対象・バックアップ・結果不明のコマンドなどの確認は省略されません。`illustrator_export` は計画の結果の `nextCall` に、適用にそのまま渡す引数を返します。

`command_id` は小文字の UUID v4（`xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx`）です。`next_call.arguments.command_id` や `uuidgen | tr A-Z a-z` の値を使えます。同じ値を再送してよいのは同じ apply の再試行だけで、タイムアウト後や `illustrator_reconcile` の後も同じです。再送すると二重に適用せず、記録済みの結果を返します。plan をやり直したら、新しい plan の候補を使ってください。plan の候補はサーバーに記録されません。古い plan から apply しても、ドキュメントがその plan の `before` と一致しなければ拒否されます。

引数のエラーでは、欠けている必須引数を名指しし、知らない引数名には正しい名前を示します（例: `document_key` → `expected_document_key`）。

## 結果フィールドの補足

| フィールド | ツール | 意味 |
| --- | --- | --- |
| `keyShort` | document context を返すすべてのツール | `key` の SHA-256 の先頭 16 桁（16 進）。`expected_document_key` に使えます。 |
| `mutationProfile` | document context を返すすべてのツール | `saved_file`: 検証済みのファイル版、`unsaved_document`: 保存先のファイルなし、`edit_session_file`: 開いている edit session のファイル、`null`: 変更不可。 |
| `bundleId` | アプリケーション情報 | bridge が操作する bundle identifier。`ILLUSTRATOR_APPLICATION` が LaunchServices 名なら `null`。 |
| `version` | アプリケーション情報 | この読み取りを実行した Illustrator の `app.version`。 |
| `templateState` | `illustrator_list_layers` | テンプレート状態は Illustrator の Layer スクリプト API から取得できません。作成ツールは `non_template` とみなします。 |
| `editable` | `illustrator_list_layers` | そのレイヤーとすべての祖先が表示かつロック解除のとき `true`（構造上の条件のみ）。 |
| `editabilityBlockedReasons` | `illustrator_list_layers` | 構造上の blocker（`layer_hidden`、`ancestor_hidden`、`layer_locked`、`ancestor_locked` の順）。編集可能なら空。 |
| `document` | `illustrator_save_document_as` | `output_path` から開き直したドキュメント（新しい Document オブジェクトと新しい key。page item の UUID は引き継がれません）。`output_exists` では、開いたまま、保持された staging ファイルを指すドキュメント。 |
| `previousFilePreserved` | `illustrator_save_document_as` | 元のファイルがバイト単位で同一なら `true`。ファイルのなかったドキュメントでは `null`。 |
| `path` | ドキュメントの保存・開閉ツール | host が書き込んだ、または指し直した可能性のあるファイル。 |
| `files` | ドキュメントの保存・開閉ツール | 別名保存のみ: 保持された staging ファイルと公開された出力（存在する場合）。 |
| `editSession` | `illustrator_save_document` | ファイルが開いている edit session のものだったときに付きます。保存直前の全走査がその head と一致しています。 |
| `editSession.state` | `illustrator_save_document` | 保存でセッションが終われば `closed`。閉じるのに失敗したときだけ `open`（次の変更で新しいファイル版に対して一時停止されます）。 |
| `document` | `illustrator_open_document` | `already_open` のとき、そのパスを使っているドキュメント。 |
| `filePreserved` | `illustrator_close_document` | 閉じたドキュメントのファイルがバイト単位で同一なら `true`。ファイルがなかったときは `null`。 |

`illustrator_update_artboard` は実験段階です。保存済みRGB文書で、名前変更、非activeボードの整数pt更新、active切替、名前つき整数ptボードの末尾への追加を扱います。追加すると新しいボードがactiveになり、追加とactive切替では文書の原点がactiveボードの `[-left,-bottom]` になります。全ボードの原点が `[0,0]` で文書の原点がこの規則どおりの時だけ受け付け、それ以外は計画の段階で止まります（`unmeasured_ruler_origin`）。名前変更・整数pt更新・追加の後は文書が未保存になるため、続けて変更する前に保存が必要です。active切替は保存済みの文書を未保存にしません。追加したアートボードをこのサーバーで削除する手段はありません。最大256ボード、通常のレイヤー直下パス128個・合計256点。Webピクセル指定と編集セッションは非対応。製品経路の実機確認は、名前変更とその戻し、非activeボードの移動・サイズ変更とその戻し、追加、active切替とその戻しで通過しています。

`illustrator_export` は、保存済みで未編集のRGB文書のアートボード1枚を、新しいPNG24またはJPEGファイルとして書き出します。元の文書とファイルは変更しません。書き出しは作業用の複製で行い、ファイル全体を読み込んで画素寸法が計画と一致することを確かめてから公開します。既存のパスは上書きせず拒否します。対応範囲は、辺が整数ptのアートボード、倍率1または2（寸法はアートボードのpt×倍率で完全一致）、1辺4000 px・総画素1200万まで、アートボードの定規原点が `[0,0]`、不透明なPNGは1倍のみです。範囲外、未保存の変更、一度も保存していない文書、編集セッション中、CMYK、リンク画像は計画の段階で拒否します。SVGは未対応です。書き出しは同時に1つずつです。結果不明で止まった場合は `illustrator_reconcile_export` で、止まった段階に応じて `inspect`・`close_work_copy`・`finalize`（既に公開された書き出しを記録して後処理）・`abandon`（公開せずに失敗として記録。ファイルは消さない）・`release_quarantined`（隔離された記録を、ファイルを確認した後に `confirm_export_id` を付けて解放）を行います。
