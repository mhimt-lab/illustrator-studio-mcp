# 88のMCPツール

**日本語** | [English](tools.en.md)

このリリースで公開している88件の全ツール名です。利用可能な機能の一覧であり、全入力の実機確認を意味しません。引数はAIアプリが取得する入力仕様を確認し、名前を推測しないでください。[確認範囲](compatibility.md)、[導入](install.md)、[復旧](runbook.md)も参照してください。

通常版Illustratorを前面に表示し、画面ロックを解除して使います。sessionは36種類の変更操作に対応し、削除・画像埋め込み・ベクター取り込み・アートボード更新は対象外です。backupとsessionの実質上限は1,000 items（1,000 itemsの実機1回で確認）です。SVG書き出し、アートボードの削除、段落スタイル、グループ解除、リンク切れ修復、Windowsは対象外です。プレビュー取得は汎用の書き出し機能ではありません。1件の削除にも明示的なbackup・確認契約が必要です。

| # | ツール識別名 |
| --- | --- |
| 1 | `illustrator_align_objects` |
| 2 | `illustrator_apply_character_style` |
| 3 | `illustrator_apply_pathfinder` |
| 4 | `illustrator_audit_typography` |
| 5 | `illustrator_capture_preview` |
| 6 | `illustrator_capture_structure_snapshot` |
| 7 | `illustrator_check_contrast` |
| 8 | `illustrator_check_text_consistency` |
| 9 | `illustrator_close_document` |
| 10 | `illustrator_close_edit_session` |
| 11 | `illustrator_compare_images` |
| 12 | `illustrator_create_area_text` |
| 13 | `illustrator_create_backup` |
| 14 | `illustrator_create_batch` |
| 15 | `illustrator_create_character_style` |
| 16 | `illustrator_create_clipping_mask` |
| 17 | `illustrator_create_document` |
| 18 | `illustrator_create_layer` |
| 19 | `illustrator_create_point_text` |
| 20 | `illustrator_create_rectangle` |
| 21 | `illustrator_create_shape` |
| 22 | `illustrator_create_swatch_resource` |
| 23 | `illustrator_create_trim_marks` |
| 24 | `illustrator_delete_objects` |
| 25 | `illustrator_diff_structure` |
| 26 | `illustrator_duplicate_object` |
| 27 | `illustrator_edit_path_points` |
| 28 | `illustrator_embed_image` |
| 29 | `illustrator_export` |
| 30 | `illustrator_export_outlined` |
| 31 | `illustrator_export_pdf` |
| 32 | `illustrator_extract_design_tokens` |
| 33 | `illustrator_find_color_usages` |
| 34 | `illustrator_find_fonts` |
| 35 | `illustrator_get_area_text_options` |
| 36 | `illustrator_get_context` |
| 37 | `illustrator_get_edit_session` |
| 38 | `illustrator_get_object` |
| 39 | `illustrator_get_path_points` |
| 40 | `illustrator_group_objects` |
| 41 | `illustrator_import_vector_artwork` |
| 42 | `illustrator_list_documents` |
| 43 | `illustrator_list_layers` |
| 44 | `illustrator_list_objects` |
| 45 | `illustrator_list_recipes` |
| 46 | `illustrator_list_selection` |
| 47 | `illustrator_list_swatches` |
| 48 | `illustrator_list_text_styles` |
| 49 | `illustrator_make_compound_path` |
| 50 | `illustrator_move_object_to_layer` |
| 51 | `illustrator_mutate_batch` |
| 52 | `illustrator_open_document` |
| 53 | `illustrator_open_edit_session` |
| 54 | `illustrator_optimize_images` |
| 55 | `illustrator_place_image` |
| 56 | `illustrator_plan_color_replacement` |
| 57 | `illustrator_plan_recipe` |
| 58 | `illustrator_preflight_images` |
| 59 | `illustrator_preflight_print` |
| 60 | `illustrator_read_structure_diff` |
| 61 | `illustrator_reconcile` |
| 62 | `illustrator_reconcile_backup` |
| 63 | `illustrator_reconcile_delete` |
| 64 | `illustrator_reconcile_export` |
| 65 | `illustrator_reconcile_save_as` |
| 66 | `illustrator_release_clipping_mask` |
| 67 | `illustrator_relink_image` |
| 68 | `illustrator_reorder_layer` |
| 69 | `illustrator_replace_font` |
| 70 | `illustrator_replace_point_text` |
| 71 | `illustrator_replace_point_text_batch` |
| 72 | `illustrator_replace_text_range` |
| 73 | `illustrator_run_m6_appearance_preview_recipe` |
| 74 | `illustrator_run_recipe` |
| 75 | `illustrator_save_document` |
| 76 | `illustrator_save_document_as` |
| 77 | `illustrator_save_recipe` |
| 78 | `illustrator_set_area_text_columns` |
| 79 | `illustrator_set_layer_state` |
| 80 | `illustrator_set_no_break` |
| 81 | `illustrator_set_object_state` |
| 82 | `illustrator_set_path_appearance` |
| 83 | `illustrator_set_stacking_order` |
| 84 | `illustrator_set_text_orientation` |
| 85 | `illustrator_set_text_style` |
| 86 | `illustrator_transform_object` |
| 87 | `illustrator_update_artboard` |
| 88 | `illustrator_update_character_style` |

## 作業ごとの案内

README の「できること」の各項目から、ここへリンクしています。条件は作業ごとに異なります。確認済みの範囲は [確認範囲](compatibility.md) を参照してください。

### 図形と文字をつくる
`illustrator_create_batch` は、図形・ポイント文字などをまとめて計画し、1回の適用で作ります。作った後は1つずつIllustratorから読み直して確かめます。個別の作成は `illustrator_create_shape`・`illustrator_create_point_text`・`illustrator_create_area_text` です。

### 整列と等間隔
`illustrator_align_objects` は、2〜16個のパスを最初の対象かアートボードに揃え（左・中央・右・上・中央・下）、3〜16個を中心の等間隔に並べます。対象はパス（`PathItem`）で、線幅を含まない境界が基準です。

### 文字をまとめて差し替える
`illustrator_replace_point_text_batch` は2〜32件のポイント文字をまとめて置き換え、`illustrator_mutate_batch` は文字の置換・書式・移動などを2〜16ステップで実行します。どちらも1つでも対象外があれば、書き込む前に全体を止めます。

### 日本語の改行を点検する
`illustrator_audit_typography` は、Illustratorが組んだ実際の改行位置を読み、行頭・行末の禁則、分割禁止、指定した分割禁止語、和文に挟まれた半角約物、あふれを指摘します。文書は変更しません。強制改行・両端揃えの字間・ルビ・割注は判定しません（詳しくは下の説明）。

### フォントの組をまとめて置き換える
`illustrator_replace_font` の `mappings` は、最大16組のフォントの置き換えを1回で行います（全部か、何もしないか）。インストールされていて、OSとIllustratorのフォント一覧で確かめられるフォントだけを使います。確かめられないフォント（このMacに無いフォントや、Adobeアプリ専用に有効化されたフォントなど）には書き込みません。合成フォントは未対応です。

### 縦組みに切り替える
`illustrator_set_text_orientation` は、レイヤー直下の連結していないポイント文字・エリア内文字を横組み⇄縦組みに切り替えます。行送りも指定できます。エリア内文字は、切り替えの前後で全文が枠に収まる場合だけ変更します。

### 写真を枠に合わせて配置する
`illustrator_place_image` の `size` で、幅・高さの指定、枠に収める（`contain`）、枠を覆う（`cover`）を選べます。`focal_point`（写真の中の見せたい点）と `align_to`（中央や三分割の交点）で位置を決め、枠から外れないように補正します。計画には配置寸法と実効PPIが出ます。`cover` ははみ出した分を切り抜かないので、切り抜きは次のクリッピングで行います。

### 写真を切り抜く
`illustrator_create_clipping_mask` は、写真のすぐ前にある矩形のパスでクリッピングマスクを作ります。対象は回転・傾斜のない均等拡縮の画像で、RGB文書のPNGリンク、CMYK文書のTIFFリンク、文書と同じ色の埋め込み画像です。画像のクリップの解除と入れ子は未対応です。

### 印刷前にチェックする
`illustrator_preflight_print` は色・インキ・オーバープリント・透明・裁ち落とし・線・フォント・画像などを、`illustrator_preflight_images` はリンク・埋め込み画像の同一性と実効解像度を調べます。確かめられなかった項目は合格にしません。

### 塗り足しとトンボつきのPDF
`illustrator_export_pdf` は、保存済みの文書から選んだアートボードを新しいPDFに書き出します。トンボ・レジストレーションマーク・カラーバー・ページ情報（和文・欧文）と、各辺0〜72 ptの塗り足しを指定できます。書き出したPDFのページ数・仕上がりサイズ・塗り足しを確かめてから公開し、既存のファイルは上書きしません。塗り足しは整数のptで指定してください（端数はIllustratorが丸めるため、書き出したPDFの確認で止まります）。PDF/Xのプリセットは使えません。

### 文書にトンボをつくる
`illustrator_create_trim_marks` は、アートボードの周りに編集できるトンボを、新しいレイヤーのパスとして描きます。塗り足し・オフセット・長さ・線幅はptで指定します（プリセットはありません。印刷所の指定に合わせてください）。PDFの書き出しでトンボを付ける場合は、二重にならないようどちらか一方にします。

### 文字をアウトライン化して書き出す
`illustrator_export_outlined` は、作業用の複製で全テキストをアウトライン化し、新しいAIまたはPDFを書き出します。元の文書とファイルは変更しません。

### 手直しを上書きしない
変更はすべて、計画 → 直前の確認 → 適用 → 読み直し の順で行います。計画の後に対象が変わっていれば、書き込む前に止まります。詳しくは [安全のしくみ](safety.md) を参照してください。

### 上書き前にバックアップ
`illustrator_create_backup` は、保存済みのファイルをコピーし、そのコピーを開いて中身を比べてから記録します。上書き保存と削除には、このバックアップが必要です。結果が分からなくなった時は [復旧](runbook.md) の手順で状態を確かめます。

## plan から apply へ（`next_call` と `command_id`）

変更はどれも2回の呼び出しです。`apply: false` で plan を受け取り、`apply: true` と `command_id` で実行します。変更ツール40種すべてで、blocker がなく、必要な値を公開入力 schema に適合する形で組み立てられた場合に `next_call` が付きます。ツール名と apply にそのまま渡す引数（新しい `command_id` の候補を含む）です。この引数を変えずに送ってください。複製・グループ・重なり順・複合パス・パスファインダー・クリッピング・レイヤー・文字スタイル・フォント置換・画像埋め込み・パス編集・削除・ベクター読み込み・バッチ・整列・アートボード更新も対象です。blocker や値の欠落・不整合がある場合、候補は返しません。候補があっても、実行時の文書・対象・バックアップ・結果不明のコマンドなどの確認は省略されません。`illustrator_export` は計画の結果の `nextCall` に、適用にそのまま渡す引数を返します。

blocker で止まった計画には、`next_call` の代わりに `next_steps` が付きます。止めた理由のコード（`blocked_by`）、次の手（`actions`: `resolve_document_state`・`reconcile`・`unlock_target`・`show_target`・`install_font`・`narrow_scope`・`unsupported`・`fix_request`）、AIアプリへの短い指示（`note`）です。画面の自動操作や独自のスクリプトで同じ変更をせず、理由と次の手を利用者に伝えてください。

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

`illustrator_update_artboard` は実験段階です。保存済みRGB文書で、名前変更、ボードの整数pt更新（activeボードを含む）、active切替、名前つき整数ptボードの末尾への追加を扱います。追加すると新しいボードがactiveになり、追加とactive切替では文書の原点がactiveボードの `[-left,-bottom]` になります。activeボードの移動・サイズ変更でも、文書の原点は新しいボードの `[-left,-bottom]` に合わせて動きます。全ボードの原点が `[0,0]` で文書の原点がこの規則どおりの時だけ受け付け、それ以外は計画の段階で止まります（`unmeasured_ruler_origin`）。名前変更・整数pt更新・追加の後は文書が未保存になるため、続けて変更する前に保存が必要です。active切替は保存済みの文書を未保存にしません。追加したアートボードをこのサーバーで削除する手段はありません。最大256ボード、通常のレイヤー直下パス128個・合計256点。移動・サイズ変更と追加に `pixel`（幅・高さ・倍率1または2、1辺4000 px・総画素1200万まで）を付けると、`illustrator_export` が書き出す画素寸法を計画で示し、合わなければ `pixel_size_mismatch` で止めます（差分を返し、自動では合わせません）。端数ptと編集セッションは非対応。製品経路の実機確認は、名前変更とその戻し、非activeボードの移動・サイズ変更とその戻し、追加、active切替とその戻し、activeボードの移動・サイズ変更とその戻し、`pixel` の一致と不一致で通過しています。

`illustrator_export` は、保存済みで未編集のRGB文書のアートボード1枚を、新しいPNG24またはJPEGファイルとして書き出します。元の文書とファイルは変更しません。書き出しは作業用の複製で行い、ファイル全体を読み込んで画素寸法が計画と一致することを確かめてから公開します。既存のパスは上書きせず拒否します。対応範囲は、倍率1または2（寸法はアートボードの幅・高さ×倍率で完全一致）、幅・高さ×倍率が整数になる辺（端数は1倍で.5pt、2倍で.25ptまたは.5pt）、1辺4000 px・総画素1200万まで、アートボードの定規原点が整数、不透明なPNGは1倍のみです。対応しない寸法は `fractional_pixel_size`・`fractional_edge_unmeasured`・`artboard_ruler_origin_unmeasured` で止まります。範囲外、未保存の変更、一度も保存していない文書、編集セッション中、CMYK、リンク画像は計画の段階で拒否します。SVGは未対応です。書き出しは同時に1つずつです。結果不明で止まった場合は `illustrator_reconcile_export` で、止まった段階に応じて `inspect`・`close_work_copy`・`finalize`（既に公開された書き出しを記録して後処理）・`abandon`（公開せずに失敗として記録。ファイルは消さない）・`release_quarantined`（隔離された記録を、ファイルを確認した後に `confirm_export_id` を付けて解放）を行います。

`illustrator_audit_typography` は読み取りだけのツールです。Illustratorが組んだ日本語の改行位置を読み、行頭禁則（`JP_LINE_START_PROHIBITED`）・行末禁則（`JP_LINE_END_PROHIBITED`）・分割禁止（`JP_UNBREAKABLE_SPLIT`）・指定した分割禁止語（`JP_PROTECTED_TERM_SPLIT`、`protected_terms`）・和文に挟まれた半角約物（`JP_HALFWIDTH_PUNCTUATION`）・エリア内文字のあふれ（`JP_OVERSET`）を返します。`policy` は配列で、いまは `jp_line_break_v1` だけです。1回の読み取りは200枠・20,000字・2,000行・2,000段落まで。パス上文字・連結した文字・ロックまたは非表示・縦組みのポイント文字・空の枠は理由を付けて除外し、結果は部分的（`incomplete`）になります。強制改行、あふれて見えない部分、両端揃えの字間、ルビ、割注は判定しません。読んでいる間に文書の保存状態が変わった場合は、結果を返さずエラーにします。

`illustrator_replace_font` は `scope`（`artboard_index`・`layer_path`・`selection: true`・`target_uuids` のいずれか1つ）で範囲を絞れます。1回の適用は40,000字・書式の区切り1,000・512枠まで、計画1回の走査は100,000字までです。収まらない範囲は区切りごとに計画を返し（`remaining`）、区切りを適用してから同じ範囲でもう一度計画すると次の区切りに進みます。ロック・非表示・読めない・未対応の枠は `plan.blockedFrames` に理由とレイヤーの位置を付けて最大64件返します。使用状況は `usage.stories`・`usage.storyList` で返し、各項目に `frames` が付きます。合成フォントは未対応です。

`illustrator_transform_object`・`illustrator_mutate_batch` の `translate` は、レイヤー直下の連結していないポイント文字・エリア内文字（横組み・縦組み、1〜512文字）にも使えます。パス上文字・連結した文字・グループ内の文字・特色やグラデーションの文字・拡大縮小や回転した文字は計画の段階で拒否します。`illustrator_align_objects` は文字の枠を扱いません。

`illustrator_save_document_as` は準備を始める前に実行を記録します。途中で止まった場合は `saveAsId` と `nextCall` を返し、解決するまでほかの変更・バックアップ・書き出し・別名保存を拒否します。`illustrator_reconcile_save_as` は `inspect`（読み取りだけ）、`switch_document`（`confirm_document_key` が必要。何も書かずに文書を保存せず閉じ、出力を開く）、`cleanup_staging`（隠しの一時ファイル名だけを消す）、`abandon`（`confirm_save_as_id` が必要。何も消さずに記録を外す）で解決します。別のMCPサーバーが実行中の別名保存には触れません。結果の `outputHidden` は、同期フォルダが出力に付ける非表示の印です（読めなければ `null`）。
