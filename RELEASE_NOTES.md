# Public Beta 0.1.0-beta.7

**日本語** | [English](RELEASE_NOTES.en.md)

公開日: 2026-11-23 JST（Asia/Tokyo）。

0.1.0-beta.6からの更新です。Illustrator 31.0.0（2027）を、確かめた版に加えました。`illustrator_audit_typography` の既定の結果が集約形（`grouped`）に変わり、大きな結果はページ分け（`cursor`）で続きを読めます。既存の文字の組み方を書く `illustrator_set_text_composition`、収まる字間と水平比率を探す `illustrator_plan_text_fit`、日付・曜日・数値を規則で進める `illustrator_plan_text_increment`、アートボードを内容ごと複製する `illustrator_duplicate_artboard`、変数とデータセットの5ツール、列の縦スペースの挿入、図面を実寸に合わせる拡大縮小、RGBに割れた黒のK100への置き換えなど、15のツールを追加しました。SVG書き出し、書き出しの上書き、編集セッション中のバーコード・QRコード・トンボ・アートボード名の変更も使えるようになりました。本番運用向けの完成版ではありません。

**前提:** Illustratorを前面に表示し、画面ロックを解除した状態で使います。背面や画面ロック中は、多くの操作が拒否されます。

#### 追加

- `illustrator_set_text_composition`: 既存の文字の組み方を書きます。1つの段落の中の範囲に、プロポーショナルメトリクス、カーニング方式（`none`・`auto`・`optical`・`metrics_roman_only`）、トラッキング、水平比率を書けます。段落には、文字組み（組み込みの7セット）、禁則（Hard・Soft・Soft_v2。「なし」を含む）、エリア内文字の揃え（両端揃え系を含む7値）、行送り（固定ptか自動）を書けます。範囲のリストでは、文字の左右のアキ（em: 自動・0・0.125・0.25・0.5・0.75・1）を書けます。1〜20列のエリア内文字にも使えます。書く属性以外の文字・段落・枠の属性は書く前に記録して書いた後に比べ、全文が見えなくなる変更は元に戻します。すべて既定値の段落は、Illustratorが既定値の書き込みを無視するため、標準の段落スタイルで初期化してから書き戻します。空の段落を含む枠は、その段落の属性を読めないため止めます。Illustrator 30.8.2で使い捨ての書類の点文字とエリア内文字を、31.0.0で範囲が0字目から始まる場合を実機で確かめました。保存済みの書類は確かめていません。実験段階です
- `illustrator_plan_text_fit`（読み取りのみ）: エリア内文字1件が全文を表示できるトラッキングと水平比率を、文書を変えずに探します。保存しない仮の文書へ枠を複製し、元と同じ表示になることを確かめてから候補を1つずつ当てて、収まる最初の候補を返します。仮の文書は保存せずに閉じ、元の文書が変わっていないことを読み直した場合だけ結果を返します。候補は既定50・上限100で、許す最小の水平比率は呼び出し側が決めます。Windowsでは使えません
- `illustrator_plan_text_increment`（読み取りのみ）: 日付・曜日・数値を規則で進めた置換の計画を返します。日付をN日進める、指定の日に置き換える、数値にNを足す規則で、変わる文字だけの最小の範囲を返し、曜日は年から計算し直して合わない曜日は警告します。全角・半角・ゼロ埋め・括弧・波ダッシュは元のままです。`M.D（曜）` のドット表記に対応します。和暦・英語の曜日・曜日のないドット表記・小数などは推測せず、理由つきで止めます。続けて使う `illustrator_replace_text_range` の計画は、後ろから前の順で返します。実機での確認はしていません
- `illustrator_list_variables`・`illustrator_apply_dataset`・`illustrator_create_dataset`・`illustrator_update_dataset`・`illustrator_bind_variable`: 変数とデータセットを扱います。読み取りは、変数・変数に結び付いたオブジェクト・データセット・最後に表示したデータセットを返します。表示は、結び付いた全オブジェクトを読み戻し、変数の種類が決める属性だけが変わったことを確かめ、合わなければ元の値へ戻します。作成は現在の値を取り込む新しいデータセットを、更新は既存のデータセットを現在の値で上書きします（上書き前の値を結果に返します）。`illustrator_bind_variable` は、オブジェクトを既存または新規の変数に結び付ける、または外します。グラフの変数、書式が文字ごとに違う文字、グラデーションなど読めない色は止めます。Illustrator 30.8.2で、読み取り・表示・作成・更新・結び付けを実機で確かめました。実験段階です
- `illustrator_duplicate_artboard`: アートボードを内容ごと、整数の距離だけ動かした新しいアートボードへ複製します。対象はレイヤー直下のパス・複合パス・グループ・文字・配置画像・ラスター画像で、RGBに加えてCMYKの文書、CMYK・特色・グラデーションの塗りと線にも対応します。計画は複製できない要素と複製先の既存の要素を理由つきで返し、適用は複製した要素の属性・位置・重ね順を読み直して確かめます。パターン・Labの色・文字へのグラデーションは止めます。Illustrator 30.8.2で、保存していない書類を実機で確かめました。保存済みの書類は確かめていません。実験段階です
- `illustrator_insert_vertical_space`: 縦長の画像（カートなど）で、切れ目より下の要素をまとめて動かし、縦のスペースを挿入または詰めます。要素の移動、切れ目をまたぐガイドの長方形の伸縮、アートボードの移動と下端の伸縮を、1回の計画・適用で行います。計画は動かせない要素と対象外のアートボードを理由つきで返し、適用は動かした要素を読み直して確かめます。RGB書類が対象で、保存済み・未保存・保存済みで未保存の変更がある書類で使えます。Illustrator 30.8.2で実機確認済みです。実験段階です
- `illustrator_activate_document`: 前面にない書類を前面にして、続くツールが扱えるようにします。書類の内容は変更も保存もせず、全書類の選択・アクティブなレイヤーとアートボード・表示が変わっていないかを照合します。Illustrator 30.8.2で、前面・画面ロックなしの場合だけ実機で確かめました。macOSのみ、実験段階です
- `illustrator_measure_scale_reference`（読み取りのみ）: 2点またはパスの長さと実際の長さ（mm）から、図面を実寸に合わせる倍率（小数6桁の `scale_percent`）、基準どうしのばらつき、mmをptと読んだ図面かどうかの手がかりを返します
- `illustrator_scale_artwork`: レイヤー直下の要素を、1点を中心に小数6桁までの倍率で拡大縮小します（mmをptと読んだ図面は283.464567%）。計画が止める理由を並べ、適用は全要素の位置と大きさを予測と0.01 ptで、線幅を指定どおり（保つか倍率に従うか）確かめ、合わなければ元に戻します。`verify_reference` で基準の長さを前後に測ってmmの差を返します。アートボードは変えません。1回は700要素までです
- `illustrator_normalize_stroke_widths`: 明示した256本までのパスについて、線幅の分布を色・レイヤーごとの本数つきで読む、または区間ごとの対応で7つの線幅へ揃える計画と適用を行います。書くのは線幅だけで、見える状態を完全に照合し、元に戻せます。複合パスの仲間は一緒に含め、1つの線幅に揃えます。保存していないCMYK書類で、CMYKのベタの線だけが対象です。Illustrator 30.8.2で、256本の読み取り・計画・適用と逆操作を実機で確かめました
- `illustrator_replace_rgb_converted_black`: 印刷前チェックが `rgb_converted_black` と判定するパスの塗りと線を、1つのCMYKの値（既定はK100）に置き換えます。1回の計画・適用で256本までです。書けるパスは計画が選び、値ごとの本数・書けないものとその理由・残りを返します。意図した黒・文字・グラデーションの分岐点・クリップのパスには触れません。Illustrator 30.8.2で、341項目の書類で256本を実機確認しました
- SVG書き出し: `illustrator_export` で、アートボード1枚をSVGに書き出せます（既存のファイルは上書きしません）。出力のXML・寸法・幾何を独立して検査します。印刷しないレイヤーは計画の段階で止めます。クリップ・グラデーション・文字を含む書類は未対応です。Illustrator 30.8.2で実機確認済みです
- 書き出しの上書き: `illustrator_export`（PNG・JPEG・SVG）、`illustrator_export_pdf`、`illustrator_export_outlined`（AI・PDF）で、`overwrite` を明示すると既存のファイルを置き換えられます。旧いファイルは検証した別のファイルへ退避してから公開し、途中で止まった場合は明示の復旧（`restore_previous`・`finalize_publish`）で戻します。PNG・SVG・PDF・アウトライン化したAI・PDFはIllustrator 30.8.2で実機確認済みです。JPEGの上書きは実機で確かめていません。複数アートボードの一括書き出しは、従来どおり上書きできません
- 編集セッション中の操作: `illustrator_create_barcode`・`illustrator_create_qr_code`・`illustrator_create_trim_marks` が作ったグループを、編集セッションの中でほかの変更と混ぜて、最後に1回の保存で済ませられます。`illustrator_update_artboard` の `name`・`renames` もセッション中に使えます（`rect`・`rects`・`add`・`adds`・`active` は引き続き止めます）。QRコードは1,500個を超える長方形とセッションの項目の上限を超える場合は、描く前に止めます
- `illustrator_embed_image` の `items`: 同じ保存済みRGB書類の、レイヤー直下のリンクJPEG・PNGを1〜16件、1回の計画・適用・検証済みバックアップで埋め込みます。1件ごとの画素数は400万まで、96万画素を超えるものは2件まで、合計は2,144万画素までです。最初の1件を埋め込んだ後の失敗は元に戻さず、結果不明として止めます（保存せずに閉じて開き直してください）
- `illustrator_create_layer` の `names`: 2〜32個のレイヤーを1回の計画・適用で作れます。1つだけの `name` の要求と結果は変わりません。Illustrator 30.8.2で、32個の作成と、直下256層の上限での拒否を確かめました。Windowsは確かめるまで拒否します
- `illustrator_create_batch` の短い入力形: `presets`・`targets`・`rows` で入力を短くでき、計画の `next_call` は `steps_sha256` で手順を参照できます。応答は、止める理由・レイヤーごとの基準・作った項目のUUID・状態と失敗・元に戻した証跡に絞りました。1回の上限は16から64手順になりました。計画は保存される結果の大きさを見積もり、上限の80%を超える要求は書き込む前に `result_too_large` で止めます
- `illustrator_update_artboard`: 一度も保存していないRGB書類で、`add`・`adds`・`name`・`renames` を保存・バックアップ・編集セッションを経ずに使えるようになりました（`rect`・`rects`・`active`・CMYK・未保存の変更がある保存済みファイルは引き続き止めます）
- `illustrator_preflight_print`: 任意の `classify_blacks` で、CMYKの黒を種類ごとに見分けます（4色ベタ・RGB変換の黒をエラー、墨ノセ回避の黒・リッチブラックを情報として返す）。リッチブラックの小さい文字・細い線を警告する `rich_black_min_text_pt`・`rich_black_min_stroke_pt` と、絵柄の中の［レジストレーション］の色をエラーとして返す判定を加えました。任意の `maximum_total_ink_percent`（100〜400）で、CMYKの総インキ量も検査します。指定しなければ結果は変わりません。表示していて印刷しないレイヤーと「Guides Preview for Trim View」レイヤーは、レイヤー単位で名前・パス・中身の数を指摘します
- `illustrator_preflight_images`: 任意の `target_ppi` で、配置画像ごとに目標のppiでの画素数・比・クリップされた元画像の範囲（`resizeSpec`）を返します。任意の `bleed_mm`（0〜25、`target_ppi` と一緒の時だけ）で、アートボードの端に接する辺の画像が、端＋塗り足しまで届かない量とマスクの不足も返します
- `illustrator_plan_color_replacement`: CMYK書類の、一様で完全なCMYKの文字の塗りも、`illustrator_mutate_batch` の `set_text_style` の手順に置き換えられるようになりました（RGBに割れた黒文字をK100へ直す作業など）
- `illustrator_align_objects`・`illustrator_transform_object` の対象の拡大: `illustrator_align_objects` は、レイヤー直下のグループ・リンク画像・埋め込み画像・エリア内文字（横組み・縦組み）にも使え、種類の混在もできます。`layout.as_group: true` で、動く対象を1つの塊として揃えます。`illustrator_transform_object` は `targets`（1〜16個）を受け取り、パス・グループ・画像・水平の点文字を、選択全体の中心または各対象の中心で、移動・拡大縮小・回転します。クリップグループはマスクの中心を基準にし、点文字の拡大縮小はフォントサイズと行送りを予測して確かめます
- `illustrator_audit_typography` の監査の追加: `jp_setting_profile_v1`（`setting_profile.expected` に挙げた文字属性・段落属性と、手引きの推奨設定の名前つきの `preset` との不一致を返す）、`latin_body_v1`（引用符・ダッシュ・三点リーダ・数字範囲のハイフン・和欧間のASCIIスペース・単位の行またぎ・語中改行などの欧文本文の規則。閾値は指定した規則だけを判定）を加えました。`jp_paragraph_shape_v1` には、両端揃えの段落の間延び（`JP_LOOSE_LINE`、経験則）を指定した場合だけ判定する規則を加えました。分割禁止の指摘には、`illustrator_set_no_break` の計画を `next_call` として返します
- `illustrator_set_text_style` の文字ツメ（`style.tsume`、0〜100）: 1行の点文字と、改行を含む点文字の1つの段落項目の範囲に書けます。他の文字・属性・段落・枠は変更の前後で全件照合し、元に戻せます
- 文字組みが「なし」（未定義）の点文字を、`illustrator_replace_text_range`（単一行）・`illustrator_replace_point_text`・`illustrator_replace_point_text_batch`・`illustrator_apply_character_style` で扱えるようにしました。また、最後が改行で終わる点文字など、空の段落を含む点文字も、通常の文字だけの範囲なら `illustrator_replace_text_range`・`illustrator_set_text_style` で書けます（測った形だけで、区切りを含む置換と空の項目が隣り合う枠は止めます）
- `illustrator_save_document_as` の `compatibility`: `cc`（Illustrator CC）または `cs6`（CS6）の互換の `.ai` として、新しいパスへ別名保存します。書かれたファイルのヘッダーが指定の版であることを確かめます。互換で保存した書類はIllustratorが変換として開くため、開き直すと「未保存」になり、結果に `reopenedAsConverted: true` と注記を返します。Illustrator 30.8.2で実機確認済みです
- `illustrator_get_context` の `preferences`: 単位4つ、線幅と効果の拡大縮小、プレビュー境界、パターンの変形、単位なしの数値をptとする設定、角の設定を、読み取りだけで返します。確かめられない値は `null` です
- `illustrator_export` の作業コピーの隠し: 任意の `exclude_non_printing_layers` で、印刷しないレイヤーを作業コピーの中だけ隠して書き出せます。計画は、印刷しない設定のレイヤーがPNG・JPEG・プレビューに写り込むことを警告します（PDFはトップレベルのレイヤーでは除かれますが、印刷しないサブレイヤーには効きません）
- `illustrator_export` のリンク配置の画像: リンク配置の画像（PSD・JPEG・PNG、グループ内・クリップグループ内を含む）を持つ書類を書き出せます。作業コピーを開く前に各リンクの参照先を読み、1件でも読めなければ理由を示して止めます。リンクは100件までです

#### 変更

- **`illustrator_audit_typography` の既定の結果が集約形（`result_format: "grouped"`）に変わりました。** ruleの説明・枠・段落の状態を1回ずつ書き、同じ証拠の範囲を `[start, end, line_index, 位置]` で並べます。各所見は1件ずつの形へ戻せます。従来の1件ずつの形は `result_format: "findings"` で選べます（1件の形は従来と同じです）。走査の上限（200枠・20,000字・2,000行・2,000段落、文字属性を読むポリシーは5,000字）、`max_findings`、新しい `max_response_bytes`（結果のJSONのUTF-8バイト数、既定30,000・上限80,000）に達したときは `next_cursor` を返し、同じ入力に `cursor` を付けて続きを読めます（書類・入力・枠の並びに結び付き、枠が増減・並べ替えされたら拒否します）。1つの枠だけで1回の読みの上限を超える枠は、黙って走査を止めず `too_large` として結果に載せます。`incomplete` の `scan_limit`・`line_cap`・`paragraph_cap`・`finding_limit`・`response_limit` は「ページの終わり（`next_cursor` あり）」を意味します。`coverage` はそのページの値で、`coverage.page` に枠の位置を返します。300枠・12,000字の書類を、Illustrator 31.0.0でページ分けして最後まで読めることを実機で確かめました
- 確かめた版: Illustrator 31.0.0（2027、通常版）の回帰テストを実機で通し、アートボードの更新・オブジェクトの削除・画像の埋め込み・クリッピングマスク系（作成・解除・複合パス・パスファインダー）・ベクターの取り込み・パスの点の編集・プレビューの取得・行間の読み取り・画像の最適化・エリア内文字の範囲の置換の10項目を、31.0.0で確かめた操作にしました。ほかの版・ほかの操作の扱いは変えていません。版を確かめる変更系ツールの判定が一部で30.8.2に固定されていたため、31.0.0などほかの通常版でも、確かめていない版の方針どおり通るようにしました（バッチの4種の手順、複製、エリア内文字の範囲の置換、SVG・作業コピーの書き出し、Illustrator自身のフォント一覧）。変更の結果に `host_version` を付け、保存済みのファイルには検証済みの `backup_id` が要ります。**更新の前に:** 方針の表が変わったため、更新前の版が作った実行記録は新しい版が記録の不一致として受け付けません（消しも上書きもしません）。結果不明の操作・開いている編集セッションは、更新前の版で解決してください
- `tools/list` を約半分（1,294,243 → 639,768バイト）にしました。変更系ツールの結果は、次の呼び出しを決める項目（状態・拒否のcode・document key・`next_call`）を完全に、before/afterのスナップショットや監査などの証跡を「完全なschemaが受け入れる値をすべて受け入れる」ゆるいschemaで公開します。ツールの説明は選択に要る要点に縮めました。サーバーは完全なschemaで入力と結果を検査します
- 外観の指定の精度: 外観の線幅（`illustrator_create_rectangle`・`illustrator_create_shape`・`illustrator_create_batch`・`illustrator_set_path_appearance`・`illustrator_mutate_batch`）は、計画の段階で1/1024 ptの倍数に丸めて `after` に示します。パスのRGBは整数に丸めて示します。色だけを替える `illustrator_set_path_appearance`・バッチ・レシピは、`stroke.width` を省略すると既存の線幅を厳密に保ちます（線をオフからオンにするときは線幅が必要です）
- `illustrator_set_path_appearance` のグラデーション: `angle` はIllustratorの向き（y上向き: 0＝最初の分岐点が左、90＝下、-90＝上から下）で、作成系のy下向きの座標とは逆だと説明に書き、計画に `gradientDirection` を返します。すでにグラデーションを持つパスは、角度以外が現在と同じ要求に限り、グラデーションだけの回転で角度を替えられます。`illustrator_transform_object` の拡大縮小と回転は、パスの塗りと線のグラデーション（線形・放射）も一緒に変形し、適用後に読み戻して比べます（以前は形だけが回り、グラデーションは元の向きのままでした）
- 塗りが `gray 0` と読めるパスのフリーグラデーションの扱い: フリーグラデーションの塗りはIllustratorの読み取りでは本物のグレー0（白）と見分けられません。`illustrator_find_color_usages`・`illustrator_extract_design_tokens`・`illustrator_check_contrast`・`illustrator_preflight_print`・`illustrator_get_object` は従来どおり数えたうえで、結果に `possible_freeform_gradient_fills` と注意文を足しました。`illustrator_set_path_appearance`（`illustrator_mutate_batch`・レシピの同じ手順を含む）は、gray 0と読める塗りを変える要求を計画の段階で `fill_may_be_freeform_gradient` として止め、本物の単色と確かめたときは `fill.confirm_gray0_fill_is_solid: true` で通せます
- `illustrator_save_document` は、埋め込みICCプロファイル・PDF互換・圧縮を失わない保存（Illustratorのメニューの保存）になりました。結果の `attributes` に、保存前後のファイルから読んだICCプロファイル・PDF互換・圧縮が `preserved`・`changed`・`unknown` のどれかを返します（読めない属性は `unknown`。すべて `preserved` のときだけ `verified: true`）。属性が変わった保存は `saved_attributes_changed` を返します
- パスに `%` と16進2桁が続く部分（`%20`・`%2F`・`%E3%81%82` など）を含むファイル・フォルダを、理由つき（`path_contains_percent`）で止めます。Illustratorはパスを URI として読むため、別の文字・別のフォルダになるためです。`50%off` や単独の `%` は受け付けます
- `illustrator_set_text_style` が、範囲末尾の直後の改行（CR・U+0003）の実属性と変化（位置・欄・変更前後）を記録して報告します。以前は無記録で変わっていました。範囲の全文字と区切りの全記録属性が揃わない・読めない形は、書く前に止めます。`illustrator_replace_text_range` が手動ペアカーニング・タブ・枠のタグを持つ点文字を止めるときは、原因・対象の枠を文言で示し、`next_steps`（`custom_script`）を付けます
- `illustrator_replace_text_range` の単一行は、文字ごとに違うベースラインシフトや既定値と違う禁則・自動行送りの量など、固定の値と違う属性を持つ点文字でも、変更前に全属性を記録して変更後に照合する形で扱えます（範囲の外が1件でも変われば元に戻します）。Illustrator 30.8.2で、中央揃え・混在したベースラインシフトの書類を実機で確かめました
- `illustrator_mutate_batch` の `set_text_style`（16手順・192文字）が計画の段階で `result_too_large` で止まっていた問題を、同じ属性が続く文字を1つの連続区間（`runs`）にまとめて運ぶ形で解消しました。全文字は読み・照合・検証し続けます
- `illustrator_create_point_text`・`illustrator_create_shape`・`illustrator_create_batch` の計画が、直下に129個以上の項目があるレイヤーでも、`layer_item_capacity_exceeded` の理由つきで返るようになりました。計画は前から128個のUUIDだけを読むため、読む時間と結果の大きさがレイヤーの項目数に比例しません
- `illustrator_find_fonts` の結果の検証を速くしました（5,000フォントの検索で約13秒かかっていたのが、1ページは数ミリ秒になりました）。`illustrator_preflight_print` は500項目で約10秒かかっていたのを約4秒にしました。項目はレイヤー構造の順に読むため、指摘の並びがレイヤー構造順になります。Hostの期限（24秒）に達したときは結果を返さず `READ_SCAN_DEADLINE` で止まります
- 結果不明（`indeterminate`）になる文に、最初の検証の問題の `reason_code` と位置（と残りの件数）を足しました。文書の文字が入りうる値は出しません
- `illustrator_create_qr_code` の説明に、QRコードの登録商標文を入れました。結果・エラー・オブジェクト名には入れません

#### 修正

- `illustrator_set_text_composition` でカーニング方式を0字目から書くと、検証の不一致で取り消されていた問題を修正しました。0字目は左の文字がなく自分の方式に従うため、範囲が0字目から始まるときは、0字目の手動カーニング量の読みも方式に従う派生として扱います（Illustrator 31.0.0で実測）。0字目に実際の手動量があるときは、従来どおり `composition_manual_kerning` で止めます
- `illustrator_create_rectangle`・`illustrator_create_shape`（`illustrator_create_batch` の同じ手順を含む）で、既定の線幅が1でない書類でも、初期の外観の `stroke: { kind: "none" }` が検証で取り消されないようにしました。`illustrator_set_path_appearance`（バッチ・レシピの同じ手順を含む）で、幅が1でない線を「なし」にする要求が検証で取り消されていた問題も修正しました。線なしの線の幅は比較から外します（線の種類・実線の幅と色・塗り・不透明度は従来どおり厳密に比べます）
- 外観の小数が計画と適用で食い違い、適用が必ず拒否される問題を修正しました（Illustratorは線幅を32ビット浮動小数で、パスのRGBを整数で保存します）。Illustratorが有効数字15桁で返した数値のechoを `===` で比べて拒否されていた問題を、`illustrator_duplicate_artboard`・`illustrator_update_artboard`・`illustrator_set_path_appearance`・`illustrator_mutate_batch` の `set_object_state`・`illustrator_replace_area_text_range` で直しました
- 確かめていない通常版のIllustratorで、保存していない書類の仮のパスを保存済みファイルと誤認してバックアップを要求していた問題を修正しました
- `illustrator_relink_image` が、差し替えで作り直された項目の `note`（属性パネルのメモ）・`uRL`・ユーザーのタグを消していた問題を修正しました。差し替えの前に記録して元へ戻し、戻せなければ検証済みにしません
- `illustrator_place_image` が、非表示のアクティブなレイヤーへ画像を置き、元へ戻す操作が検証済みのまま残る問題を修正しました。置く前に対象のレイヤーをアクティブにし、終わったら元のアクティブなレイヤーへ戻します（戻せなければ検証済みにしません）。`illustrator_relink_image` は、アクティブなレイヤーと選択が差し替えの後も同じことを読み戻して確かめます
- `illustrator_find_color_usages` で、CMYKを許容0で探しても、単精度で保存された色（C93が93.0000007と読まれるなど）が見つからなかった問題を修正しました
- 文字ツールで範囲を選んでいる間に `illustrator_list_selection` が失敗する問題を修正しました（`items` は空で、`text_selection` を返します）。`illustrator_create_clipping_mask` は、文字編集中の選択を `text_editing_selection` で止めます
- 開始されなかった読み取りのlockが、持ち主が消えた後も残り、すべてのツールが使えなくなる問題を修正しました（持ち主がなく、未開始で、読み取りのタイムアウト上限＋60秒を超えたlockを、次の呼び出しが自動で解放します）。lockの確認と削除を1つの操作にし、同時の解放・自動回収が別の呼び出しのlockを消さないようにしました。バックアップ・書き出し・別名保存が、lockを作った後・コマンドを作る前に落ちて、解除できなくなる問題も、`illustrator_reconcile_backup`・`illustrator_reconcile_export`・`illustrator_reconcile_save_as` でセッションIDを明示して解除できるようにしました
- グループを含むアートボードの複製が、Illustratorの項目数の読みが遅れる（グループの複製の後に短く答える）ために検証で拒否され、巻き戻しも確かめられなかった問題を修正しました。`illustrator_update_artboard`・`illustrator_mutate_batch` の `set_object_state`・`illustrator_set_stroke_style` が、書類が「レイヤー直下の通常のパスだけ」かを確かめる列挙を、グループの複製の直後でも古く読まないものに替えました
- `illustrator_run_m6_appearance_preview_recipe` の計画が、`illustrator_set_path_appearance` に加わった `gradientDirection`・`gradientRotation` を `Unrecognized keys` で拒否していた問題を修正しました
- 新しいClaude Desktopで、計画と適用の2段で動く変更ツール（`illustrator_create_rectangle` など56ツール）に引数を渡せず、呼び出しが入力エラーになる問題を修正しました。ツールの入力の定義を、計画の形と適用の形を1つにまとめた、引数の一覧を持つ1つのオブジェクトで公開します。適用だけで使う引数（`command_id` など）には、説明の先頭に「Apply only.」を付けました。計画にも適用にも合わない引数の組み合わせは、従来どおりサーバーが拒否します

#### 既知の制限

- `illustrator_set_text_composition`・`illustrator_duplicate_artboard`・`illustrator_insert_vertical_space`・`illustrator_activate_document`・変数とデータセットの5ツールは実験段階です。確かめたのはIllustrator 30.8.2（`illustrator_set_text_composition` の0字目の場合は31.0.0）の使い捨ての書類までで、保存済みの書類は確かめていません。`illustrator_plan_text_increment` と `illustrator_plan_text_fit` の範囲外の入力は、推測せず理由つきで止めます
- `illustrator_scale_artwork` は1回に700要素までです。`illustrator_export` のSVG書き出しは、クリップ・グラデーション・文字を含む書類に対応していません
- 複合パスを含む書類で `illustrator_duplicate_artboard` を適用したとき、Illustratorの項目数の読みが遅れると、検証と巻き戻しの確認の両方が拒否され、最終の状態を証明できない結果不明（`rollback_indeterminate`）になります。元の書類と複製を読み直して確かめてください
- Illustrator 31.0.0で確かめたのは10項目だけです。スポットカラーの作成が失敗したときの復元、画素数を指定した書き出し、SVG・作業コピーの書き出し、グループの複製・バッチなどは、確かめていない通常版として扱います。Windowsでは31.0.0を確かめていません
- Adobe Fontsのフォントは、文書を開く前に読んだフォント一覧にあるときだけ書き込めます。サーバーやIllustratorの再起動の後と、一覧を読んだ後に追加したフォントは、文書をすべて閉じた状態でもう一度読むまで使えません。`illustrator_replace_font` でAdobe Fontsのフォントを使う経路は、実機では確かめていません。文字の作成と文字スタイルのツールは、引き続きIllustratorの中だけでフォントを確かめます
- `illustrator_replace_text_range`・`illustrator_set_text_style` は、実行記録の大きさのため、短いフォント情報の場合で1つの枠が約200字（改行・強制改行を含むと約180字）を超えると `result_too_large` で止まります。範囲や枠を分けてください
- `illustrator_create_barcode`・`illustrator_create_qr_code` の読み取りの照合には zbarimg が要ります（同梱していません）。無いときは `not_run` になり、読み取りでは確かめません。形と読み取りの照合は、GS1の認証や印刷物での読み取りの保証ではなく、バーコードのケース上の位置も確かめません。最終の印刷条件（方式・紙・インク・読み取り機器）で確かめてください
- `illustrator_set_stroke_style` が対応するのは、実機で測った1つの形（一度も保存していない1レイヤーのCMYK文書の、3点の開いた直線のパス）だけです
- `illustrator_replace_area_text_range` は、Illustrator 30.8.2では両端揃え（最終行左揃え）の1段落だけを、31.0.0では確認用の1つの書類だけを確かめています
- `illustrator_render_artboards` は前面化に対応していません。`illustrator_capture_preview`・`illustrator_extract_text` の前面化は、画面ロック中は行わず、最小化したIllustratorや別のデスクトップ（Space）にあるIllustratorには対応していません
- 3,000点を超える文書の編集セッションでは、走査の後・保存の前に外部で変わった属性を見逃すことがあります。開くのにも保存にも数分以上かかります
- `dirty_file` で続ける変更は、指定した対象の外で起きた変更を検出しません
- `custom_script` の案内に従ってAIアプリが独自のスクリプトで行った変更は、このサーバーの計画・適用・読み戻しの確認の外です。読み取りツールで結果を確かめてください
- 確かめていない版での変更は前後の比較で確かめますが、その版での実機の確認はありません
- `illustrator_mutate_batch` のレイヤーの状態の手順と、文字の書式の手順のトラッキング・比率は、公開しているツールを通した実機の確認がまだです
- `illustrator_export_pdf` の `pdfx` は、PDF/Xの情報を書いたことまでを確かめます。規格への適合は検証しません
- `illustrator_audit_typography` の短い行の判定は経験則です。字間の開いた行の判定（`JP_LOOSE_LINE`）は指定した場合だけ動く経験則で、実機で確かめたのは1つの設定だけです。禁則に反する改行を見つける規則は自動テストで確かめています。実機で確かめたのは、禁則Hardの文書で行頭・行末禁則の指摘が0件になることまでです。ルビ・割注・強制改行は判定しません
- `illustrator_create_trim_marks` には日本式・欧文式の寸法の既定値がありません。寸法はすべて指定してください
- `illustrator_optimize_images` は、Illustrator 30.8.2では大きな画像（原点にある800×800pt）で描画の検証で止まることがありました（31.0.0では再現しませんでした）
- `illustrator_replace_font` は合成フォントに対応していません。保存済みの文書では、区切りを適用するたびにバックアップと上書き保存が要ります。置換先に対象の字形がないと、検証の不一致で元に戻ります
- レイヤー直下の文字の枠の平行移動は、CMYK文書では確かめていません
- `illustrator_mutate_batch` の見た目・文字の置換・文字の書式の手順は、親グループのロック・非表示で止まったときに `next_steps` が付きません（書き込みは行いません）
- `illustrator_run_m6_appearance_preview_recipe` のプレビューをiCloudなどの同期フォルダに出力すると、中身が同じでも変更と誤判定して止まることがあります。同期フォルダの外に出力してください
- 作成時の見た目の指定は、特色（スポットカラー）とグラデーションに対応していません。作成後に `illustrator_set_path_appearance` を使ってください
- 4000×3000 pxのJPEGを書き出すとき、寸法の確認でNode.jsのメモリを一時的に約570 MiB使いました（1回の実測）
- Streamable HTTPは自動テストとAIアプリとの接続確認までです。HTTP経由でIllustratorを操作した記録はありません
- CMYK文書では、複合パスの作成は未対応です
- グループの読み取りで、ときどき対象を参照できなくなる既知の間欠事象があります。原因は未解決です。このとき操作は安全側で止まり（fail closed）、結果が確かめられない場合は「結果不明」として扱います
- 長い文書識別情報を含む実行記録は、読み戻せないことがあります
- 既存の線付き文字は編集対象外です
- Windows対応は準備中で、公開しているパッケージはMac専用です
- Desktop拡張には署名がありません。インストール画面で提供元と版を確認してください
- npmでは必ず `@beta` を付けてください。タグなしのインストールは `latest` を使い、この版になるとは限りません

QRコードは株式会社デンソーウェーブの登録商標です。

[導入](docs/install.md)・[互換性](docs/compatibility.md)・[復旧](docs/runbook.md)・[LICENSE](LICENSE)を確認してください。

以前の版の変更は[変更履歴](CHANGELOG.md)にあります。
