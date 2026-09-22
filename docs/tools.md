# 82のMCPツール

**日本語** | [English](tools.en.md)

Public Beta 0.1.0-beta.2のinstalled packageで機能取得を確認した82件の全ツール名です。利用可能な機能の一覧であり、全入力の実機確認を意味しません。引数はAIアプリが取得する入力仕様を確認し、名前を推測しないでください。[確認範囲](compatibility.md)、[導入](install.md)、[復旧](runbook.md)も参照してください。

通常版Illustratorを前面に表示し、画面ロックを解除して使います。sessionは39種類中36種類の変更操作に対応し、削除・画像埋め込み・ベクター取り込みは対象外です。backupとsessionの実質上限は1,000 items（600 itemsの実測からの外挿）です。PNG/JPEG/SVG書き出し、アートボード操作、段落スタイル、グループ解除、リンク切れ修復、Windowsは対象外です。プレビュー取得は汎用の書き出し機能ではありません。1件の削除にも明示的なbackup・確認契約が必要です。

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
| 27 | `illustrator_export_outlined` |
| 28 | `illustrator_extract_design_tokens` |
| 29 | `illustrator_find_color_usages` |
| 30 | `illustrator_find_fonts` |
| 31 | `illustrator_get_area_text_options` |
| 32 | `illustrator_get_context` |
| 33 | `illustrator_get_edit_session` |
| 34 | `illustrator_get_object` |
| 35 | `illustrator_get_path_points` |
| 36 | `illustrator_group_objects` |
| 37 | `illustrator_import_vector_artwork` |
| 38 | `illustrator_list_documents` |
| 39 | `illustrator_list_layers` |
| 40 | `illustrator_list_objects` |
| 41 | `illustrator_list_recipes` |
| 42 | `illustrator_list_selection` |
| 43 | `illustrator_list_swatches` |
| 44 | `illustrator_list_text_styles` |
| 45 | `illustrator_make_compound_path` |
| 46 | `illustrator_move_object_to_layer` |
| 47 | `illustrator_mutate_batch` |
| 48 | `illustrator_open_document` |
| 49 | `illustrator_open_edit_session` |
| 50 | `illustrator_optimize_images` |
| 51 | `illustrator_place_image` |
| 52 | `illustrator_plan_color_replacement` |
| 53 | `illustrator_plan_recipe` |
| 54 | `illustrator_preflight_images` |
| 55 | `illustrator_preflight_print` |
| 56 | `illustrator_read_structure_diff` |
| 57 | `illustrator_reconcile` |
| 58 | `illustrator_reconcile_backup` |
| 59 | `illustrator_reconcile_delete` |
| 60 | `illustrator_reconcile_export` |
| 61 | `illustrator_release_clipping_mask` |
| 62 | `illustrator_relink_image` |
| 63 | `illustrator_reorder_layer` |
| 64 | `illustrator_replace_font` |
| 65 | `illustrator_replace_point_text` |
| 66 | `illustrator_replace_point_text_batch` |
| 67 | `illustrator_replace_text_range` |
| 68 | `illustrator_run_m6_appearance_preview_recipe` |
| 69 | `illustrator_run_recipe` |
| 70 | `illustrator_save_document` |
| 71 | `illustrator_save_document_as` |
| 72 | `illustrator_save_recipe` |
| 73 | `illustrator_set_area_text_columns` |
| 74 | `illustrator_set_layer_state` |
| 75 | `illustrator_set_no_break` |
| 76 | `illustrator_set_object_state` |
| 77 | `illustrator_set_path_appearance` |
| 78 | `illustrator_set_stacking_order` |
| 79 | `illustrator_set_text_orientation` |
| 80 | `illustrator_set_text_style` |
| 81 | `illustrator_transform_object` |
| 82 | `illustrator_update_character_style` |

## plan から apply へ（`next_call` と `command_id`）

変更はどれも2回の呼び出しです。`apply: false` で plan を受け取り、`apply: true` と `command_id` で実行します。作成系のツールと、apply で plan の `before` / `after` を送り返すツールでは、blocker のない plan に `next_call` が付きます。ツール名と apply にそのまま渡す引数（新しい `command_id` の候補を含む）です。この引数を変えずに送ってください。その他のツールでは、送り返す plan の値を入力 schema に記載しています。

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
