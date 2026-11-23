# 111のMCPツール

`illustrator_set_text_style` は、範囲末尾の直後の CR／U+0003 の実属性も記録し、その変化を `delimiterEffect`（位置・変わる欄・変更前後）で報告します。範囲の全文字と直後の区切りの全記録属性が揃う場合だけ書き込み、揃わない・読めない形は書く前に拒否します。以前はこの区切りの変化が記録・報告されていませんでした。ほかの区切りと範囲外の通常文字は不変を確かめ、範囲内の逆操作後は区切りを含めて元の全記録と照合します。

**日本語** | [English](tools.en.md)

このリリースで公開している111件の全ツール名です。利用可能な機能の一覧であり、全入力の実機確認を意味しません。引数はAIアプリが取得する入力仕様を確認し、名前を推測しないでください。[確認範囲](compatibility.md)、[導入](install.md)、[復旧](runbook.md)も参照してください。

通常版Illustratorを前面に表示し、画面ロックを解除して使います。sessionでは、削除・画像埋め込み・ベクター取り込み・名前以外のアートボード更新・線のスタイルは対象外です（バーコード・QRコード・トンボの作成とアートボードの名前変更は使えます）。backupは20,778 itemsまで（1,000 itemsを超える書類はストリームで全件を比較）、sessionは1回の走査で3,000 items、分割した走査で20,779 itemsまでを実機で確認しています。アートボードの削除、段落スタイル、グループ解除、リンク切れ修復、Windowsは対象外です。SVG書き出しはアートボード1枚だけで、クリップ・グラデーション・文字を含む書類は未対応です。プレビュー取得は汎用の書き出し機能ではありません。1件の削除にも明示的なbackup・確認契約が必要です。

| # | ツール識別名 |
| --- | --- |
| 1 | `illustrator_activate_document` |
| 2 | `illustrator_align_objects` |
| 3 | `illustrator_analyze_display_spacing` |
| 4 | `illustrator_apply_character_style` |
| 5 | `illustrator_apply_dataset` |
| 6 | `illustrator_apply_pathfinder` |
| 7 | `illustrator_audit_typography` |
| 8 | `illustrator_bind_variable` |
| 9 | `illustrator_capture_preview` |
| 10 | `illustrator_capture_structure_snapshot` |
| 11 | `illustrator_check_contrast` |
| 12 | `illustrator_check_text_consistency` |
| 13 | `illustrator_close_document` |
| 14 | `illustrator_close_edit_session` |
| 15 | `illustrator_compare_images` |
| 16 | `illustrator_create_area_text` |
| 17 | `illustrator_create_backup` |
| 18 | `illustrator_create_barcode` |
| 19 | `illustrator_create_batch` |
| 20 | `illustrator_create_character_style` |
| 21 | `illustrator_create_clipping_mask` |
| 22 | `illustrator_create_dataset` |
| 23 | `illustrator_create_document` |
| 24 | `illustrator_create_layer` |
| 25 | `illustrator_create_point_text` |
| 26 | `illustrator_create_qr_code` |
| 27 | `illustrator_create_rectangle` |
| 28 | `illustrator_create_shape` |
| 29 | `illustrator_create_swatch_resource` |
| 30 | `illustrator_create_trim_marks` |
| 31 | `illustrator_delete_objects` |
| 32 | `illustrator_diff_structure` |
| 33 | `illustrator_duplicate_artboard` |
| 34 | `illustrator_duplicate_object` |
| 35 | `illustrator_edit_path_points` |
| 36 | `illustrator_embed_image` |
| 37 | `illustrator_export` |
| 38 | `illustrator_export_outlined` |
| 39 | `illustrator_export_pdf` |
| 40 | `illustrator_extract_design_tokens` |
| 41 | `illustrator_extract_text` |
| 42 | `illustrator_find_color_usages` |
| 43 | `illustrator_find_fonts` |
| 44 | `illustrator_get_area_text_options` |
| 45 | `illustrator_get_context` |
| 46 | `illustrator_get_edit_session` |
| 47 | `illustrator_get_object` |
| 48 | `illustrator_get_path_points` |
| 49 | `illustrator_group_objects` |
| 50 | `illustrator_import_vector_artwork` |
| 51 | `illustrator_insert_vertical_space` |
| 52 | `illustrator_list_documents` |
| 53 | `illustrator_list_layers` |
| 54 | `illustrator_list_objects` |
| 55 | `illustrator_list_recipes` |
| 56 | `illustrator_list_selection` |
| 57 | `illustrator_list_swatches` |
| 58 | `illustrator_list_text_styles` |
| 59 | `illustrator_list_variables` |
| 60 | `illustrator_make_compound_path` |
| 61 | `illustrator_measure_scale_reference` |
| 62 | `illustrator_move_object_to_layer` |
| 63 | `illustrator_mutate_batch` |
| 64 | `illustrator_normalize_stroke_widths` |
| 65 | `illustrator_open_document` |
| 66 | `illustrator_open_edit_session` |
| 67 | `illustrator_optimize_images` |
| 68 | `illustrator_place_image` |
| 69 | `illustrator_plan_color_replacement` |
| 70 | `illustrator_plan_recipe` |
| 71 | `illustrator_plan_text_fit` |
| 72 | `illustrator_plan_text_increment` |
| 73 | `illustrator_preflight_images` |
| 74 | `illustrator_preflight_print` |
| 75 | `illustrator_read_structure_diff` |
| 76 | `illustrator_reconcile` |
| 77 | `illustrator_reconcile_backup` |
| 78 | `illustrator_reconcile_delete` |
| 79 | `illustrator_reconcile_export` |
| 80 | `illustrator_reconcile_save_as` |
| 81 | `illustrator_release_clipping_mask` |
| 82 | `illustrator_relink_image` |
| 83 | `illustrator_render_artboards` |
| 84 | `illustrator_reorder_layer` |
| 85 | `illustrator_replace_area_text_range` |
| 86 | `illustrator_replace_font` |
| 87 | `illustrator_replace_point_text` |
| 88 | `illustrator_replace_point_text_batch` |
| 89 | `illustrator_replace_rgb_converted_black` |
| 90 | `illustrator_replace_text_range` |
| 91 | `illustrator_run_m6_appearance_preview_recipe` |
| 92 | `illustrator_run_recipe` |
| 93 | `illustrator_save_document` |
| 94 | `illustrator_save_document_as` |
| 95 | `illustrator_save_recipe` |
| 96 | `illustrator_scale_artwork` |
| 97 | `illustrator_set_area_text_columns` |
| 98 | `illustrator_set_layer_state` |
| 99 | `illustrator_set_no_break` |
| 100 | `illustrator_set_object_state` |
| 101 | `illustrator_set_path_appearance` |
| 102 | `illustrator_set_stacking_order` |
| 103 | `illustrator_set_stroke_style` |
| 104 | `illustrator_set_text_composition` |
| 105 | `illustrator_set_text_orientation` |
| 106 | `illustrator_set_text_style` |
| 107 | `illustrator_transform_object` |
| 108 | `illustrator_transform_path_anchors` |
| 109 | `illustrator_update_artboard` |
| 110 | `illustrator_update_character_style` |
| 111 | `illustrator_update_dataset` |

## 作業ごとの案内

README の「できること」の各項目から、ここへリンクしています。条件は作業ごとに異なります。確認済みの範囲は [確認範囲](compatibility.md) を参照してください。

### 図形と文字をつくる
`illustrator_create_batch` は、図形・ポイント文字などをまとめて計画し、1回の適用で作ります。作った後は1つずつIllustratorから読み直して確かめます。個別の作成は `illustrator_create_shape`・`illustrator_create_point_text`・`illustrator_create_area_text` です。

### 整列と等間隔
`illustrator_align_objects` は、2〜16個のパスを最初の対象かアートボードに揃え（左・中央・右・上・中央・下）、3〜16個を中心の等間隔に並べます。対象はパス（`PathItem`）か横組みのポイント文字（混在は不可）で、線幅を含まない境界が基準です。`illustrator_set_stacking_order` は、1つのレイヤーの1〜16個のパスを最前面・最背面へ、または1つ前・後ろへ移します。

### 文字をまとめて差し替える
`illustrator_replace_point_text_batch` は2〜32件のポイント文字をまとめて置き換え、`illustrator_mutate_batch` は文字の置換・書式・移動などを2〜16ステップで実行します。どちらも1つでも対象外があれば、書き込む前に全体を止めます。

### 日本語の改行を点検する
`illustrator_audit_typography` は、Illustratorが組んだ実際の改行位置を読み、行頭・行末の禁則、分割禁止、指定した分割禁止語、和文に挟まれた半角約物、あふれを指摘します。文書は変更しません。強制改行・両端揃えの字間・ルビ・割注は判定しません（詳しくは下の説明）。`illustrator_set_no_break` で範囲に分割禁止を設定すると、語を1行に収められます。

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
`illustrator_export_pdf` は、保存済みの文書から選んだアートボードを新しいPDFに書き出します。トンボ・レジストレーションマーク・カラーバー・ページ情報（和文・欧文）と、各辺0〜72 ptの塗り足しを指定できます。書き出したPDFのページ数・仕上がりサイズ・塗り足しを確かめてから公開し、既存のファイルは既定では拒否します。塗り足しは整数のptで指定してください（端数はIllustratorが丸めるため、計画の段階で止めます）。書類の3 mmの裁ち落とし設定をそのまま使う指定もあります。`pdfx` でPDF/X（`x3_2002`・`x3_2003`・`x4`）を明示できます。書き出したファイルにPDF/Xの版と出力インテントがあることは確かめますが、規格への適合は検証しません。PDF/Xのプリセットは使えません。

### 文書にトンボをつくる
`illustrator_create_trim_marks` は、アートボードの周りに編集できるトンボを、新しいレイヤーのパスとして描きます。塗り足し・オフセット・長さ・線幅はptで指定します（プリセットはありません。印刷所の指定に合わせてください）。PDFの書き出しでトンボを付ける場合は、二重にならないようどちらか一方にします。 編集セッション内でも作成でき、新規レイヤー・グループ・全線をheadへ反映して最後に1回保存します。作成後は既存レイヤーのindex pathがずれるため読み直してください（組み合わせの公開P0は30.8.2 stable・foreground-unlockedの自作保存済みCMYKで11/11 PASS）。

### QRコードをつくる
`illustrator_create_qr_code` は、URLや日本語を含むテキストから標準のQRコード（Model 2、バージョン1〜40、誤り訂正L/M/Q/H）を、編集できるベクターで描きます。暗いモジュールは横に連なる分を1つの矩形にまとめ、1つの複合パスと（白背景を選んだ場合は）Quiet Zoneを含む白い矩形を1つのグループに入れます。前景は黒（CMYKはK100、RGBは0,0,0）だけで、Quiet Zoneは4モジュール以上です。`size_pt` はQuiet Zoneを含む正方形全体の一辺で、plan は版・モジュール数・矩形数・実際の1モジュールの大きさ（pt・mm）を返します。計画の矩形を描画して zbarimg で読み戻し（zbarimg が無ければ `not_run`）、適用後は使い捨ての文書に複製した描画も読み戻して内容との一致を確かめます。不一致は成功として返しません。装飾・ロゴ・GS1適合は扱いません。最終的な印刷条件（方式・紙・インク・読み取り機器）での読み取り確認は必要です。編集セッション内でも作れますが、矩形1,500個までです（上限はplanの`items.rectangles`で数えます）。超える大きさは変更前に断り、sessionの外で作ります。組み合わせはIllustrator 31.0.0の実機で確かめました。session内の読み取り確認が合わない時は、保存せずsessionと書類を閉じ、保存済みのファイルを開き直してください（Windowsではsession内の変更が未測定で、書類を閉じるツールはファイルのある書類を閉じられないため、Illustrator上で閉じてください）。QRコードは株式会社デンソーウェーブの登録商標です。

ツールの説明文には登録商標文を入れています。説明文はAIアプリで利用者が見る画面に表示されるためです。結果とエラーの文面、書類内のオブジェクト名（`QR Code` など）には入れていません。結果とエラーは短い状態の通知で、デンソーウェーブのFAQが「スペースが無いとき（画面表示）」として挙げる扱いに当たり、オブジェクト名は利用者の作品の中身だからです（[登録商標文の掲載について](https://www.denso-wave.com/ja/adcd/support/faq/trademark/comment/)）。

### 文字をアウトライン化して書き出す
`illustrator_export_outlined` は、作業用の複製で全テキストをアウトライン化し、新しいAIまたはPDFを書き出します。元の文書とファイルは変更しません。

PDF とアウトライン AI/PDF の `overwrite: true` は、旧出力（1 GiBまで）を独立したアーカイブへ検証付きで退避し、検証済みの新出力を同じ名前で公開します。最初に計画し、返された `nextCall` を変更せず適用してください。アーカイブは手動保持で、原稿の上書き保存とは別の機能です。中断時は `illustrator_reconcile_export` の明示的な `restore_previous` / `finalize_publish` で復旧し、変更未保存の作業用コピーは自動で閉じません。この上書き経路は macOS・stable 30.8.2・前面・ロック解除の使い捨て保存済みRGB書類で、PDF・アウトライン化したAI・アウトライン化したPDFの3つを実機で確かめています。複数アートボードの一括書き出しは上書きできません。

### 文字の組み方を書く・収まりを探す・日付を進める
`illustrator_set_text_composition` は、既存の文字のプロポーショナルメトリクス・カーニング方式・トラッキング・水平比率、段落の文字組み・禁則・揃え・行送り、文字の左右のアキを書きます。書く属性以外は前後で比べ、全文が見えなくなる変更は元に戻します。`illustrator_plan_text_fit` は、エリア内文字1件が全文を表示できるトラッキングと水平比率を、文書を変えずに探します。`illustrator_plan_text_increment` は、日付・曜日・数値を規則で進めた置換の計画を返します（実機での確認はしていません）。

### アートボードを複製する・縦スペースを挿入する
`illustrator_duplicate_artboard` は、アートボードを内容ごと、整数の距離だけ動かした新しいアートボードへ複製します。`illustrator_insert_vertical_space` は、縦長の画像で、切れ目より下の要素をまとめて動かして縦のスペースを挿入・詰めます。どちらも計画が動かせない要素を理由つきで返し、適用の後に読み直して確かめます。保存済みの書類は確かめていません。

### 変数とデータセットを扱う
`illustrator_list_variables` は変数・結び付いたオブジェクト・データセットを読み、`illustrator_apply_dataset` は既存のデータセットを表示します。`illustrator_create_dataset`・`illustrator_update_dataset` は現在の値を取り込んで作成・上書きし、`illustrator_bind_variable` はオブジェクトを変数に結び付けます。どれも書き込んだ後に全件を読み戻し、合わなければ元へ戻します。

### 図面を実寸に合わせる
`illustrator_measure_scale_reference` は、2点またはパスの長さと実際の長さ（mm）から倍率を求めます。`illustrator_scale_artwork` は、レイヤー直下の要素を、1点を中心に小数6桁までの倍率で拡大縮小し、全要素の位置・大きさ・線幅を読み直して確かめます（1回700要素まで）。`illustrator_normalize_stroke_widths` は、パスの線幅を実測済みの7つの幅へ揃えます。

### RGBに割れた黒を直す
`illustrator_replace_rgb_converted_black` は、印刷前チェックが `rgb_converted_black` と判定するパスの塗りと線を、1つのCMYKの値（既定はK100）に置き換えます。1回256本まで。意図した黒・文字・グラデーションの分岐点・クリップのパスには触れません。

### 前面でない書類を扱う
`illustrator_activate_document` は、前面にない書類を前面にして、続くツールが扱えるようにします。書類の内容は変更も保存もしません。

### 手直しを上書きしない
変更はすべて、計画 → 直前の確認 → 適用 → 読み直し の順で行います。計画の後に対象が変わっていれば、書き込む前に止まります。詳しくは [安全のしくみ](safety.md) を参照してください。

### 上書き前にバックアップ
`illustrator_create_backup` は、保存済みのファイルをコピーし、そのコピーを開いて中身を比べてから記録します。上書き保存と削除には、このバックアップが必要です。結果が分からなくなった時は [復旧](runbook.md) の手順で状態を確かめます。

### 文字の一部を差し替えて書式を変える
`illustrator_replace_text_range` は、ポイント文字（1行、または改行・強制改行で区切った32行まで）の一部を差し替え、ほかの文字とその書式はそのまま残します。`illustrator_set_text_style` は、範囲の文字サイズ・トラッキング・水平／垂直比率・塗り・インストール済みのフォントを設定します。`illustrator_create_character_style` はサイズとトラッキングを持つ文字スタイルを作り、`illustrator_apply_character_style` は既存の文字スタイルを1行のポイント文字の範囲に適用します。Illustrator 30.8.2では、`illustrator_replace_area_text_range` で1段落のエリア内文字の範囲も差し替えられます。

### 見出しの字間を分析する
`illustrator_analyze_display_spacing` は、見出しやロゴを1つ測ります。対象は横組みのポイント文字・エリア内文字の1行（64文字まで、文字サイズは1つ、欧文または和文）です。保存せずに閉じる作業用の文書で複製をアウトライン化し、隣り合う文字の組ごとに、間隔と間の白さ、枠の中央値に近づけるカーニングの目安を返します。元の文書は変えません。Illustratorを前面に表示し、画面ロックを解除して使います。

### エリア内文字を段組みにする
`illustrator_set_area_text_columns` は、レイヤー直下の連結していない横組みのエリア内文字1つに、段数と行数（各1〜20）、間隔（0〜1,000 pt）、流し込む向きを設定します。文字があふれて隠れる設定は元に戻します。今の設定は `illustrator_get_area_text_options` で読めます。

### すべての文字を抜き出して校正する
`illustrator_extract_text` は、すべてのテキストフレームの文字をアートボードごとに、段落と行に分けて返します。`illustrator_check_text_consistency` は、ダミー文字、行末や連続した空白、繰り返した単語、同じ語の大文字・小文字や全角・半角の揺れを見つけます。どちらも文書は変えません。指摘がなくても、入稿できる状態とは限りません。

### 変わった所を画像で比べる
`illustrator_render_artboards` は、文書を変えずに各アートボードをPNGに描画します。`compare_to` を指定すると、アートボードごとに変わった画素、その範囲の枠、差分画像を返します。Illustratorを前面に表示し、画面ロックを解除して使います（1回で100アートボードまで）。`illustrator_diff_structure` は、2つの構造スナップショットの間で追加・削除・移動・変更されたオブジェクトを一覧にします。

### パスの編集とパスファインダー
`illustrator_edit_path_points` は、アンカーの移動、コーナーポイントのハンドルの設定、点の追加・削除、パスを開く・閉じるを行います。`illustrator_transform_path_anchors` は、選んだアンカーをハンドルごと拡大縮小します。`illustrator_apply_pathfinder`（合体・前面オブジェクトで型抜き・交差・中マド）と `illustrator_make_compound_path` は、2つのパスの複製に対して行い、元のパスは変えません。パスファインダーは重なった2つの長方形、複合パスは閉じた直線だけの2つのパスで確認しています。ほかの形は拒否します。

### 破線と線端と角の形
`illustrator_set_stroke_style` は、3点の開いた直線のパスに、破線・破線のオフセット・線端・角の形・比率の上限をまとめて設定します（一度も保存していない1レイヤーのCMYK文書で確認）。`illustrator_set_path_appearance` は、パスの塗り・線・不透明度を文書のカラーモードで設定します。

### アートボードとレイヤーを整理する
`illustrator_update_artboard` は、保存済みのRGB文書でアートボードの名前・大きさの変更、アクティブ化、追加を行います（256枚まで。削除は未対応）。`illustrator_create_layer`、`illustrator_set_layer_state`（名前・表示・ロック・プリント）、`illustrator_reorder_layer` でレイヤーを整理し、`illustrator_move_object_to_layer` でパスを別のレイヤーへ移します。

### SVGやAIを取り込む
`illustrator_import_vector_artwork` は、.svgまたは.aiファイル1つの中身を、最上位レイヤーに編集できる新しいグループ1つとして取り込みます。確認している範囲は狭く、RGB、元のファイルにパス・複合パス・文字だけのグループが1つ、取り込み先が開いている唯一の文書、という条件です。SVGは画像や外部ファイルを参照していないものに限ります。

### 色を探して置き換える
`illustrator_find_color_usages` は、ある色の使用箇所（パスの塗りと線、文字、グラデーションの分岐点、スウォッチ）を一覧にします。`illustrator_plan_color_replacement` は、対応する使用箇所（パスの見た目と、一様なRGBの文字の塗り）を、`illustrator_mutate_batch` で適用する1つのまとまりにします。カラーモードをまたいだ変換はせず、対応しない使用箇所は理由とともに返します。

### 文字と背景のコントラストを判定する
`illustrator_check_contrast` は、指定した色の組み合わせのWCAG 2.xのコントラスト比と、AA・AAAに届くかを、Illustratorに接続せずに計算します。`auto_detect` は、開いている文書の表示中の文字と、その背後で塗りのある図形を組み合わせて判定します（Illustratorを前面に表示し、画面ロックを解除して使います）。

### JANコードをつくる
`illustrator_create_barcode` は、JAN（EAN-13・短縮のEAN-8）とITF-14のバーコードを、数字（ITF-14はベアラーバーも）つきの編集できるベクターで描き、チェックデジットと寸法を確かめ、描いたものを読み取って確認します。番号の採番はしません。GS1の認証や印刷品質は保証しません。編集セッション内でも作れます（組み合わせの公開P0は準備中）。QRコードは上の「QRコードをつくる」を参照してください。

### 画像の解像度を確かめて軽くする
`illustrator_preflight_images` は、リンク画像と埋め込み画像の同一性と、元の解像度・実効解像度を調べます。`illustrator_optimize_images` は、上限のPPIを超える埋め込みのRGB画像を作業用の複製で縮小し、新しい.aiファイルに保存します。元の文書とファイルは変えません。

### PNGやJPEGで書き出す
`illustrator_export` は、保存済みのRGB文書のアートボード1つを新しいPNGまたはJPEGファイルに書き出し、画素数を確かめます。既存のファイルは上書きしません。元の文書とファイルは変えません。

## plan から apply へ（`next_call` と `command_id`）

変更はどれも2回の呼び出しです。`apply: false` で plan を受け取り、`apply: true` と `command_id` で実行します。すべての変更ツールで、blocker がなく、必要な値を公開入力 schema に適合する形で組み立てられた場合に `next_call` が付きます。ツール名と apply にそのまま渡す引数（新しい `command_id` の候補を含む）です。この引数を変えずに送ってください。複製・グループ・重なり順・複合パス・パスファインダー・クリッピング・レイヤー・文字スタイル・フォント置換・画像埋め込み・パス編集・削除・ベクター読み込み・バッチ・整列・アートボード更新も対象です。blocker や値の欠落・不整合がある場合、候補は返しません。候補があっても、実行時の文書・対象・バックアップ・結果不明のコマンドなどの確認は省略されません。`illustrator_export` は計画の結果の `nextCall` に、適用にそのまま渡す引数を返します。

blocker で止まった計画には、`next_call` の代わりに `next_steps` が付きます。止めた理由のコード（`blocked_by`）、次の手（`actions`: `resolve_document_state`・`reconcile`・`unlock_target`・`show_target`・`install_font`・`narrow_scope`・`unsupported`・`fix_request`・`custom_script`）、AIアプリへの短い指示（`note`）です。理由と次の手を利用者に伝えてください。機能がない・測っていない・測った範囲の外という理由で止まった場合（`custom_script`）に限り、AIアプリが自分のスクリプトでMCPの外から同じ変更をしてもかまいません。その場合は、何を変えるかを先に伝え、保存済みのファイルなら先に `illustrator_create_backup` を取り、読み取りのツールで結果を確かめ、MCPの外で変えたことを報告し、文書キーを読み直します。結果不明・解除されていないロック・古いか一致しない対象・画面ロックや前面でない状態で止まったときは、スクリプトや画面の自動操作で代えず、状態を直してからこのサーバーでやり直します。

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

`illustrator_update_artboard` は実験段階です。保存済みRGB文書で、名前変更、ボードの整数pt更新（activeボードを含む）、active切替、名前つき整数ptボードの末尾への追加を扱います。追加すると新しいボードがactiveになり、追加とactive切替では文書の原点がactiveボードの `[-left,-bottom]` になります。activeボードの移動・サイズ変更でも、文書の原点は新しいボードの `[-left,-bottom]` に合わせて動きます。全ボードの原点が `[0,0]` で文書の原点がこの規則どおりの時だけ受け付け、それ以外は計画の段階で止まります（`unmeasured_ruler_origin`）。名前変更・整数pt更新・追加の後は文書が未保存になります。RGB の編集セッションでは `name`・`renames` だけを既存の変更と混在して最後に1回保存できます（公開 P0 実測済み（stable 30.8.2・前面・ロックなし、必須9/9 PASS））。セッション外の保存済み書類は、次の変更前に保存が必要です。active切替は保存済みの文書を未保存にしません。追加したアートボードをこのサーバーで削除する手段はありません。最大256ボード、通常のレイヤー直下パス128個・合計256点。移動・サイズ変更と追加に `pixel`（幅・高さ・倍率1または2、1辺4000 px・総画素1200万まで）を付けると、`illustrator_export` が書き出す画素寸法を計画で示し、合わなければ `pixel_size_mismatch` で止めます（差分を返し、自動では合わせません）。端数ptと、編集セッション内の `rect`・`rects`・`add`・`adds`・`active` は非対応。製品経路の実機確認は、名前変更とその戻し、非activeボードの移動・サイズ変更とその戻し、追加、active切替とその戻し、activeボードの移動・サイズ変更とその戻し、`pixel` の一致と不一致で通過しています。

`illustrator_export` は、保存済みで未編集のRGB文書のアートボード1枚を、新しいPNG24またはJPEGファイルとして書き出します。元の文書とファイルは変更しません。書き出しは作業用の複製で行い、ファイル全体を読み込んで画素寸法が計画と一致することを確かめてから公開します。既存のパスは、`overwrite: true` を明示しない限り上書きせず拒否します（PNG・JPEG・SVG。旧い出力は検証した別のファイルへ退避してから公開します。PNG・SVGはIllustrator 30.8.2で実機確認済みで、JPEGは実機で確かめていません）。対応範囲は、倍率1または2（寸法はアートボードの幅・高さ×倍率で完全一致）、幅・高さ×倍率が整数になる辺（端数は1倍で.5pt、2倍で.25ptまたは.5pt）、1辺4000 px・総画素1200万まで、アートボードの定規原点が整数、不透明なPNGは1倍のみです。対応しない寸法は `fractional_pixel_size`・`fractional_edge_unmeasured`・`artboard_ruler_origin_unmeasured` で止まります。`width_px` か `height_px` で画素数を指定する書き出し（アートボード1枚、縦横比を保つ、30.8.xで倍率25〜400%を実測）と、`output_dir` と `artboard_indexes`（32まで）か `all_artboards: true` で複数のアートボードをまとめて書き出す指定もあります。範囲外、未保存の変更、一度も保存していない文書、編集セッション中、CMYK、リンク画像は計画の段階で拒否します。SVGは、アートボード1枚の非上書きの書き出しに対応します（出力のXML・寸法・幾何を独立して検査し、印刷しないレイヤーは計画の段階で止め、リンク配置の画像は参照先を先に読んで全件が存在するときだけ書き出します。クリップ・グラデーション・文字を含む書類は未対応です）。書き出しは同時に1つずつです。結果不明で止まった場合は `illustrator_reconcile_export` で、止まった段階に応じて `inspect`・`close_work_copy`・`finalize`（既に公開された書き出しを記録して後処理）・`abandon`（公開せずに失敗として記録。ファイルは消さない）・`release_quarantined`（隔離された記録を、ファイルを確認した後に `confirm_export_id` を付けて解放）を行います。

`illustrator_audit_typography` は読み取りだけのツールです。Illustratorが組んだ日本語の改行位置を読み、行頭禁則（`JP_LINE_START_PROHIBITED`）・行末禁則（`JP_LINE_END_PROHIBITED`）・分割禁止（`JP_UNBREAKABLE_SPLIT`）・指定した分割禁止語（`JP_PROTECTED_TERM_SPLIT`、`protected_terms`）・和文に挟まれた半角約物（`JP_HALFWIDTH_PUNCTUATION`）・エリア内文字のあふれ（`JP_OVERSET`）を返します。`policy` は配列で、`jp_line_break_v1` に加えて `jp_justify_body_v1`・`jp_paragraph_shape_v1`・`jp_setting_profile_v1`・`latin_body_v1` を指定できます。既定の結果は集約形（`result_format: "grouped"`）で、ruleの説明・枠・段落の状態を1回ずつ書き、同じ証拠の範囲を `[start, end, line_index, 位置]` で並べます（従来の1件ずつの形は `result_format: "findings"`）。1回の読み取りは200枠・20,000字・2,000行・2,000段落まで（文字属性を読むポリシーは5,000字）で、`max_findings` と `max_response_bytes`（既定30,000・上限80,000）に達したときも、`next_cursor` を返し、同じ入力に `cursor` を付けて続きを読めます（書類・入力・枠の並びが変わると拒否します）。1つの枠で1回の読みの上限を超える枠は `too_large` として結果に載せます。パス上文字・連結した文字・ロックまたは非表示・縦組みのポイント文字・空の枠は理由を付けて除外し、結果は部分的（`incomplete`）になります。強制改行、あふれて見えない部分、両端揃えの字間、ルビ、割注は判定しません。読んでいる間に文書の保存状態が変わった場合は、結果を返さずエラーにします。

`illustrator_replace_font` は `scope`（`artboard_index`・`layer_path`・`selection: true`・`target_uuids` のいずれか1つ）で範囲を絞れます。1回の適用は40,000字・書式の区切り1,000・512枠まで、計画1回の走査は100,000字までです。収まらない範囲は区切りごとに計画を返し（`remaining`）、区切りを適用してから同じ範囲でもう一度計画すると次の区切りに進みます。ロック・非表示・読めない・未対応の枠は `plan.blockedFrames` に理由とレイヤーの位置を付けて最大64件返します。使用状況は `usage.stories`・`usage.storyList` で返し、各項目に `frames` が付きます。合成フォントは未対応です。

`illustrator_transform_object`・`illustrator_mutate_batch` の `translate` は、レイヤー直下の連結していないポイント文字・エリア内文字（横組み・縦組み、1〜512文字）にも使えます。パス上文字・連結した文字・グループ内の文字・特色やグラデーションの文字・拡大縮小や回転した文字は計画の段階で拒否します。`illustrator_align_objects` は文字の枠を扱いません。

`illustrator_save_document_as` は準備を始める前に実行を記録します。途中で止まった場合は `saveAsId` と `nextCall` を返し、解決するまでほかの変更・バックアップ・書き出し・別名保存を拒否します。`illustrator_reconcile_save_as` は `inspect`（読み取りだけ）、`switch_document`（`confirm_document_key` が必要。何も書かずに文書を保存せず閉じ、出力を開く）、`cleanup_staging`（隠しの一時ファイル名だけを消す）、`abandon`（`confirm_save_as_id` が必要。何も消さずに記録を外す）で解決します。別のMCPサーバーが実行中の別名保存には触れません。結果の `outputHidden` は、同期フォルダが出力に付ける非表示の印です（読めなければ `null`）。

`illustrator_normalize_stroke_widths` は明示した native UUID 集合（1 command 最大256本）の線幅分布と色・レイヤー別本数を読み、半開区間の対応表で幅だけを変更します。変更先は実測済み7幅（0.6／0.67／0.74／0.81／1.33 pt、0.1 mm／0.25 mm の pt 換算値）です。未保存CMYK文書・前面／ロック解除済みが対象で、compound は全兄弟を含め同一の幅にそろえます。DOM可視属性の照合、厳密な逆操作、JSON容量の事前検査を行います。256本を超える作業は兄弟を分けずに独立した plan/apply へ分割してください。native F0 は受理済みで、公開製品経路の実機P0（stable 30.8.2・前面／ロック解除・未保存CMYK・256本）は全 cell PASS でした。256本で read 1.57秒・plan 1.59秒・apply 4.02秒、inverse の apply は3.97秒で書き込み前の状態に完全一致し、書類は保存せず閉じて documents 0 です（10-25 の実測は read 19.5秒・plan 24秒・apply は30秒超で timeout）。32／64／128／256本の read はどれも約1.5秒で、本数による増加は見られませんでした。別の版・保存済みファイル・257本以上には一般化しません。
