# Changelog

**日本語** | [English](CHANGELOG.en.md)

日付は JST（Asia/Tokyo）です。

## [0.1.0-beta.7] - 2026-11-23

**日本語** | [English](https://github.com/mhimt-lab/illustrator-studio-mcp/blob/main/CHANGELOG.en.md)

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

- **`illustrator_audit_typography` の既定の結果が集約形（`result_format: "grouped"`）に変わりました。** ruleの説明・枠・段落の状態を1回ずつ書き、同じ証拠の範囲を `[start, end, line_index, 位置]` で並べます。各所見は1件ずつの形へ戻せます。従来の1件ずつの形は `result_format: "findings"` で選べます（1件の形は従来と同じです）。走査の上限（200枠・20,000字・2,000行・2,000段落、文字属性を読むポリシーは5,000字）、`max_findings`、新しい `max_response_bytes`（結果のJSONのUTF-8バイト数、既定30,000・上限80,000）に達したときは `next_cursor` を返し、同じ入力に `cursor` を付けて続きを読めます（書類・入力・枠の並びに結び付き、枠が増減・並べ替えされたら拒否します）。1つの枠だけで1回の読みの上限を超える枠は、黙って走査を止めず `too_large` として結果に載せます。`incomplete` の `scan_limit`・`line_cap`・`paragraph_cap`・`finding_limit`・`response_limit` は「ページの終わり（`next_cursor` あり）」を意味します。`coverage` はそのページの値で、`coverage.page` に枠の位置を返します。300枠・12,000字の書類を、Illustrator 31.0.0でページ分けして最後まで読めることを実機で確かめました。続きのページは、前のページで読んだ枠の文字属性を読み直さなくなり、ページ送りが速くなりました。所見が収まらないときは、収まる最後の枠の終わりでページを閉じ、続きは次の枠から読みます（`coverage.page` の区切りはこの枠の境界になります）。続きのページの読み方も、Illustrator 31.0.0の実機で確かめました
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

## [0.1.0-beta.6] - 2026-10-14

**日本語** | [English](https://github.com/mhimt-lab/illustrator-studio-mcp/blob/main/CHANGELOG.en.md)

0.1.0-beta.5からの更新です。JAN（EAN-13・EAN-8）とITF-14のバーコードとQRコードを編集できるベクターで作る機能、見出しやロゴの字間の測定、文書を変えずにアートボードを描画して比べる機能と全テキストの抽出、1段落のエリア内文字の範囲置換、線の破線・線端・角の設定、パスの一部のアンカーの拡大縮小を追加しました。複数のアートボードの一括書き出し、画素数を指定した書き出し、PDF/Xの指定、グループの中の文字の編集、両端揃えと段落の形の組版監査を加え、約2万点のオブジェクトがある文書でもバックアップ・編集セッション・読み取り・変更を使えるようにしました。確かめていない通常版のIllustratorでも、同意の確認なしで変更系ツールを使えるようになりました。本番運用向けの完成版ではありません。

**前提:** Illustratorを前面に表示し、画面ロックを解除した状態で使います。背面や画面ロック中は、多くの操作が拒否されます。

#### 追加

- `illustrator_create_barcode`: JAN（EAN-13・短縮のEAN-8）とITF-14のバーコードを、数字つきの編集できるベクターとして、指定したレイヤーの1つのグループに描きます。バーは黒（CMYKはK100、RGBは0,0,0）の塗りだけの長方形で、白い背景を付けるか選べます。数字は同梱のOCR-Bフォントのアウトラインで、フォントのインストールは要りません。チェックデジットは確かめるのが既定で、`check_digit: "calculate"` を指定したときだけ計算して付けます。番号の採番はしません。大きさはEANが倍率0.8〜2.0か `x_dimension_mm` 0.264〜0.66、ITF-14が `x_dimension_mm` 0.635〜1.016（既定1.016）です。ITF-14はベアラーバー（`bearer_bar`: `plate`・`non_plate`）の指定が必須で、13桁のGTINは `normalize_gtin13: "prefix_zero"` を指定したときだけ先頭に0を補います。計画では予定のバーを、適用の後は使い捨ての文書に複製して描画したものを、zbarimgで読み取って照合し、合わなければ成功として返しません。実機（Illustrator 30.8.2）で、EAN-13（倍率1.0）・EAN-8（倍率0.8）・ITF-14を確かめました。編集セッション中は使えません
- `illustrator_create_qr_code`: URLや日本語などのテキスト（UTF-8）から、QRコード（Model 2、バージョン1〜40、誤り訂正L/M/Q/H）を編集できるベクターで描きます。暗いモジュールを横の並びごとに長方形にまとめた1つの複合パスと、選んだときはQuiet Zone（4モジュール以上）を含む白い長方形を、1つのグループにします。前景は黒（CMYKはK100、RGBは0,0,0）だけです。`size_pt` はQuiet Zoneを含む正方形全体の一辺で、計画は版・モジュール数・長方形の数・1モジュールの大きさを返します。計画では予定の長方形を、適用の後は使い捨ての文書に複製して描画したものを、zbarimgで読み取って内容と照合し、合わなければ成功として返しません。実機では、バージョン40・誤り訂正Hの7,842個の長方形の作成と照合に3.95秒かかりました。装飾・ロゴ・ほかの色・GS1への適合は扱いません。編集セッション中は使えません
- `illustrator_analyze_display_spacing`（読み取りのみ）: 見出しやロゴの文字の枠1つの字間を測ります。対象は横組みのポイント文字・エリア内文字の1行（64文字まで、文字サイズは1つ、欧文または和文）です。既定の `measure: "outline"` は、保存しない作業用の文書に枠を複製してアウトライン化し、隣り合う文字の組ごとに、外枠の間隔・インクの最短の間隔・間の白さ・接触・枠の中央値からのずれと、中央値か `target_white_em` に近づけるカーニングの目安（1/1000 em）を返します。目安は経験則なので、仕上がりの大きさと媒体で判断してください。作業用の文書は約0.5秒アクティブになり、保存せずに閉じます。前面・画面ロック解除が必要です。`"state_only"` はカーニングの方式・手動カーニング・プロポーショナルメトリクス・ツメ・アキ・トラッキングだけを読み、何も開きません。`include_preview` で、アウトライン化した複製のPNG（288 ppi）も返します。パス上・縦組み・連結・ロックまたは非表示・変形した枠と複数行は拒否します。前後で文書のキー・保存状態・数・選択・表示を比べ、変わっていればエラーにします。実機（30.8.2）で13項目を確かめました
- `illustrator_render_artboards`（読み取りのみ）: 文書を変えずに、各アートボードをPNG（72または144 ppi）に描画します。`source: "current"` は開いている未保存の文書（`saved=false`）を、`"file"` は保存済みのファイルを非公開の複製から描画します。`compare_to` に前の描画を指定すると、アートボードごとに変わった画素、その範囲の枠、差分画像を返します。1回で100アートボード・6,000万画素までです。描画はサーバーが動いている間だけ参照でき、置き場は24時間・20件・2 GBを超えた古いものから片付けます（結果の `cleanup` に数を返します）。前面・画面ロック解除が必要で、前面化には対応していません
- `illustrator_extract_text`（文書は変更しません）: すべてのテキストフレームの文字を、アートボードごとに、段落（改行）と行（強制改行）を分けて返します。末尾の区切りの有無も返します。1回で5,000枠・40万字までで、続きは `truncated.nextStartIndex` から読みます。`activate_if_needed: true` のときは、画面ロックがかかっていなければ設定済みのIllustratorを前面にしてから読みます（文書の選択や保存はしません）
- `illustrator_replace_area_text_range`: Illustrator 30.8.2で、レイヤー直下の横組み・連結なし・1段落・1段のエリア内文字（1〜5,000字、最初に全文が見えていること）の範囲を差し替えます。確かめた揃えは両端揃え（最終行左揃え）だけで、ほかの揃えは止めます。差し替える文字は空でもよく、改行は含められません。範囲の外の書式の混在は保ち、行の折り返しは予測せず、Illustratorが組んだ行を読みます。あふれたときや結果が合わないときは元に戻します。サロゲートペア（絵文字や一部の漢字など）を含む文字、手動カーニング、タブやリスト、範囲内の書式の混在は止めます
- `illustrator_set_stroke_style`: 破線・破線のオフセット・線端・角の形・比率の上限を1組として設定します（実線・破線・丸い点線など）。書くのはこの5つだけで、塗り・線の色・線幅・不透明度・形・ほかのオブジェクトは前後で比べ、変わっていれば元に戻します。対象は、一度も保存していない1レイヤーのCMYK文書にある、CMYKの塗りと線を持つ3点の開いた直線のパスです。前面・画面ロック解除が必要です。ほかの文書や形は、測っていないため止めます。編集セッション中は使えません
- `illustrator_transform_path_anchors`: 1つのパスで選んだアンカーを、ハンドルごと縦横別の倍率（0.25〜4）で、指定した点かアンカーの1つを基準に拡大縮小します。アンカーは番号・yの範囲・xの範囲で選びます。点の種類・数・開閉は変えません。対象はレイヤー直下のパス（256点まで）で、RGBの塗りと、CMYK文書ではCMYKの塗り・線、特色の塗り、極性 `NEGATIVE` に対応します。適用は読み戻しで確かめ、失敗したときは書いた点をすべて戻します
- `illustrator_export` の複数アートボード: `output_dir`（既存のフォルダ）と `artboard_indexes`（32まで）または `all_artboards: true` で、複数のアートボードを1回の計画・適用で書き出します。ファイル名は `<アートボード名>.png`・`.jpg` で、名前は変換しません。使えない名前・重複する名前（大文字小文字やUnicodeの正規化の違いを含む）・既にあるファイルがあると、アートボードごとに理由を付けて全体を止めます。すべてのファイルを確かめてから置き、途中で失敗したときは、この書き出しで置いたファイルだけを取り除きます。実機では、実際の8枚（1025×3840 pxのJPEG）を5.4秒で書き出しました
- `illustrator_export` の画素数の指定: アートボード1枚の書き出しで、`scale` の代わりに `width_px` か `height_px` を指定できます。縦横比を保ち、指定した辺も求めた辺も整数px、1辺4000 px・合計1200万画素以内のときだけ受け付け、書き出したファイルの寸法が計画と完全に一致したときだけ置きます。Illustrator 30.8.x（実測30.8.2）の通常版で、JPEG・PNG（透明・不透明）を倍率25〜400%の範囲（各形式11点で実測）で書き出せます。アートボードの寸法が整数ptであることが必要で、複数アートボードの書き出しでは使えません。最初にIllustratorを呼ぶ前に前面・画面ロック解除を確かめ、自動では前面にしません
- `illustrator_export_pdf` の `pdfx`: PDF/Xの規格（`x3_2002`・`x3_2003`・`x4`）を明示して書き出せます。`output_condition` は `x4` のときだけ指定できます。X-1aは、Illustratorが黙って無視すると測れたため止めます。文書のフォントがこの機械にあると確かめられないときも止めます（欠けたフォントは黙って置き換えられ、PDF/Xの情報も書かれないため）。書き出したファイルにPDF/Xの版（InfoとXMP）と出力インテントがあることを確かめますが、規格への適合は検証しません（結果の `pdfx.conformance` は常に `not_validated`）。PDF/Xのプリセットは引き続き使えません
- `illustrator_export_pdf` の裁ち落としと編集機能: `bleed: {mode: "document", expected_mm: 3}` は、プリセットの「ドキュメントの裁ち落とし設定を使用」に任せて書き出し、全ページの裁ち落とし（BleedBox）が四辺とも3 mm（誤差0.01 pt）のときだけ置きます。整数ptを明示するときは、この設定がオフのプリセットを使ってください（オンだと文書の値が使われ、照合で止まります）。`preserve_editability` は、指定したときだけ「Illustratorの編集機能を保持」を書き、読み戻した値を `options.preserveEditability` に返します。共有やメールには `false`（実測で1ページのPDFが16.4 MBから387 KBに）、Illustratorで開き直して編集するなら `true` です。省略するとプリセットのままです。トンボかレジストレーションマークを付けるとき、文書にレジストレーション色の線（`illustrator_create_trim_marks` で作ったトンボなど）があれば計画で警告します（先頭の5,000パスまでを調べ、止めはしません）
- `illustrator_audit_typography` の監査を2つ追加: `policy` に `jp_justify_body_v1`（両端揃えと字間）と `jp_paragraph_shape_v1`（段落の形）を加えました。`jp_justify_body_v1` は段落の揃えと、単語間隔・文字間隔・字形の拡大・縮小（最小・最適・最大）を読み、`justify_body` で指定した規則だけを判定します（両端揃えの最終行の扱い `JP_JUSTIFY_LAST_LINE`、指定範囲の外の値 `JP_SPACING_RANGE`、短い最終行 `JP_SHORT_LAST_LINE`）。`jp_paragraph_shape_v1` は、`paragraph_shape` で指定したときだけ、自動改行の次の行が指定した字数以内の文字と、指定した分類の約物で始まる行（`JP_SHORT_LINE_HEAD`）と、2行以上の段落の短い最終行を判定します。閾値の既定値は持たず、監査した段落の値の分布と新規文書の既定値を参考として返します。文書は変更しません。**結果の形が変わりました:** 結果に `policies` と `justify_body` が加わり、`jp_line_break_v1` を指定しないときは `policy` が `null` になります
- グループの中のポイント文字の編集: `illustrator_replace_text_range`・`illustrator_replace_point_text`（`illustrator_replace_point_text_batch` を含む）・`illustrator_set_text_style` と、`illustrator_mutate_batch` の同じ手順で、グループ（入れ子と、先頭の子がマスクのクリップグループを含む）の中のポイント文字を、グループを解除せず、何も動かさずに編集できるようにしました。祖先のグループの状態（UUID・ロック・表示・不透明度・描画モード・クリップ・子の順序）を計画に固定し、変わっていれば書き込む前に止めます。ロックまたは非表示の祖先グループ、32段を超える入れ子、子が1,024個を超えるグループは、そのグループを示して止めます。文字スタイルの適用は対象外です
- 複数段落のポイント文字: `illustrator_replace_text_range` と `illustrator_set_text_style` が、改行（段落）か強制改行で区切った32行までのポイント文字に対応しました。範囲は1つの行の中に限り、1文字を改行か強制改行1文字に置き換えて行を分けられます。空の行ができる編集と、区切りの削除・種類の変更は止めます。文字・段落・枠の属性は前後で照合します。**数値の報告が変わりました:** この2つのツールは、1行の文字の数値も小数5桁の値で報告します
- `illustrator_set_text_style` の文字揃えと行送りの基準位置: `style.alignment`（`center`・`roman_baseline`）で、標準の文字スタイルを使う1行の文字の文字揃えを設定できます。`paragraph_style.leading_type`（`top_to_top`・`bottom_to_bottom`）で、レイヤー直下の2段落以上のポイント文字の段落1つ全体の行送りの基準位置を設定できます（段落内の文字属性が一様で、標準の文字スタイル・段落スタイル、左揃えの場合）。どちらもほかの属性とは一緒に指定できません。`illustrator_get_object` は、書式の区切りごとの `alignment` と、段落ごとの `leadingType` を返します
- `illustrator_set_no_break` のエリア内文字: レイヤー直下の横組み・連結なし・1段落のエリア内文字（全文が見えていて、揃えが左か両端揃え（最終行左揃え））にも使えるようにしました。計画と結果は、変更の前後にIllustratorが組んだ行を返します。分割禁止で文字が枠からあふれたときは、検証の失敗として元に戻します。**結果の形が変わりました:** ポイント文字を含め、スナップショットの1文字ごとの `characters` は、属性が同じ連続区間の `runs` になりました（結果の版3）
- `illustrator_create_area_text` の `style.leading`: 行送りを数値（pt、小数5桁まで）で指定できます。全文字の自動行送りをオフにして書き、読み戻した実際の値を返します。いまは1段落だけで、改行を含むと止めます。省略すると従来どおり自動行送りです
- `illustrator_align_objects`: 対象にレイヤー直下の横組みのポイント文字（2〜16個、パスとの混在は不可）を加え、`distribute` に端と端の間隔をそろえる `spacing: "gaps"` を加えました。両端の対象は動かしません。外側の幅が対象の合計より狭いときは、書き込む前に `negative_gap` で止めます。回転は180°だけを確かめています
- `illustrator_create_shape` の配置: レイヤー直下の、ロックも非表示もない基準のパス（UUID）のすぐ上かすぐ下に作れるようにしました。省略すると従来どおり最前面に作ります
- `illustrator_capture_preview` の `activate_if_needed`: `true` のとき、Illustratorが前面になく画面ロックもかかっていなければ、設定済みのIllustratorを前面にしてから描画します（起動はしません。文書の選択や保存はせず、前面を元に戻しません）。前面になったことは直後に確かめ直します。**拒否の理由コードが変わりました:** `PREVIEW_UNSUPPORTED_HOST_PROFILE` は `PREVIEW_ILLUSTRATOR_NOT_FRONTMOST`・`PREVIEW_SCREEN_LOCKED`・`PREVIEW_HOST_PROFILE_UNKNOWN` に分かれ、`PREVIEW_ACTIVATION_FAILED` が加わりました。前面を変えうるため、このツールと `illustrator_extract_text` には読み取り専用の注釈（`readOnlyHint`）を付けていません
- `illustrator_find_fonts` の `query`: PostScript名・ファミリー名・スタイル名の部分一致（ASCII、1〜64字）で探し、50件ずつページ送りします。実測で、4,939フォントの環境で1回約1.3秒でした。`post_script_names` と一緒には使えません
- `illustrator_update_artboard` の一括指定と作品のある文書: `renames`・`rects`・`adds` の配列で、複数のアートボードの名前変更・移動とサイズ変更・追加を1回の計画・適用で行えます（1〜256件、合計256枚まで）。移動・サイズ変更と追加は、パスのほかに文字やグループなどの作品がある文書でも、全オブジェクトのUUIDと最上位の範囲で作品を固定して使えます（20,778点・1回の走査3秒までを実測。適用の応答に約9秒かかることがあります）。追加するボードが既存のボードと重なる・接するときは、理由と番号を付けて計画で止めます。サブレイヤー・ガイド・パス上文字などがある文書は対象外です。`pixel` は1件の移動・サイズ変更か追加のときだけ指定できます
- `illustrator_mutate_batch` の手順: レイヤーの移動（`move_object_to_layer`）、文字スタイルの適用（`apply_character_style`）、レイヤーの状態（名前・表示・ロック）をそれぞれちょうど2手順で、オブジェクトの状態（`set_object_state` の名前・不透明度・表示・ロック）を2〜3手順で実行できるようにしました。文字の書式の手順には、トラッキング（Illustratorが小数を整数で保存するため整数のみ）・水平比率・垂直比率を加えました。どれも実機で測った小さな構成（ルートレイヤーや対象の数、カラーモード、フォントなど）だけを受け付け、外れるものは書き込む前に止めます。オブジェクトの状態の手順はIllustrator 30.8.2だけです
- `illustrator_duplicate_object` のグループの中の複製: グループの中のパス（RGBの1レイヤーの文書で1〜3段）・文字（短いASCIIの文字など、狭い条件）・画像（拡大縮小していないリンクのPNGか埋め込みのRGB画像）と、CMYKの1レイヤーの文書で、2段のグループの中のCMYKで塗ったパスと、通常のCMYKを元にした特色で塗ったレイヤー直下のパスを複製できるようにしました。複製の前後で兄弟・順序・特色の定義が完全に一致することを確かめ、失敗したときは自分の複製だけを取り除きます。RGB・Labを元にした特色、レジストレーション、グラデーション・パターン、特色の線は止めます
- `illustrator_transform_object` のグループの平行移動: 埋め込み画像（RGB・CMYKの8ビット）を含むグループと、最前面の閉じたパスでマスクした、レイヤー直下のクリップグループも平行移動できるようにしました。CMYK文書では、ポイント文字・2点の直線・長方形の3つを持つ1段のグループの中で、文字と直線をグループのまま動かせます（`illustrator_mutate_batch` でも使えます）。グループの拡大縮小・回転、入れ子のクリップ、複合パスのマスクは対象外です
- `illustrator_embed_image` のCMYK文書: CMYK文書に、ICCプロファイル付きの8ビットの平坦なPSD（RGB・CMYK）とCMYKのTIFFを埋め込めるようにしました。Illustratorが作る子1つだけのグループを外し、レイヤー直下のCMYKの埋め込み画像にします。ICCプロファイルのないもの、測ったものとレイヤー数・チャンネル数が違うPSD、RGBのTIFF、16ビット、複数ページ、回転・傾斜・縦横で違う倍率の配置は計画で止めます。こうして埋め込んだ画像のクリッピングマスクは、まだ作れません
- `illustrator_set_stacking_order` のCMYK文書: CMYKの塗り・線、特色の塗り、タグ1つ、極性 `NEGATIVE` のパスも、CMYK文書で最前面・最背面・前面へ・背面へのすべての重ね順の変更ができるようにしました（実制作の文書の複製で16項目を実機確認）。止めるときは、理由になった項目の名前を返します
- 未保存のまま続ける変更（`mutationProfile: dirty_file`）: 保存済みのファイルに未保存の変更があっても、それだけを理由には止めなくなりました。`illustrator_set_text_style`・`illustrator_replace_point_text`・`illustrator_replace_text_range`・`illustrator_transform_object`・`illustrator_set_path_appearance` は、編集セッションなしで、指定した対象の前後の照合で続けられます。対象の外の変更は検出しません（結果の `document_admission` に明記します）。ほかの操作は従来どおり止めます。結果を確かめられずに解除した変更や、元に戻せなかった変更の後は、文書を変更のない状態に戻すまで、この続け方とこのサーバーでの保存を止めます。いくつも変更してから利用者が確かめて保存する使い方では、最初の変更の前に編集セッションを開くよう案内し、`illustrator_close_edit_session` で閉じた後に利用者がIllustratorで保存（Cmd+S）できます
- `setup` コマンド: `npx -y illustrator-studio-mcp@beta setup --client claude-code`（または `--client codex`）で、実行した版に固定した登録コマンドを表示します。AIアプリの設定を読み書きせず、AIアプリ・MCPサーバー・Illustratorも起動しません。`--current`・`--previous` を渡すと、更新と戻しのコマンドも表示します。`--json` で構造化した出力になります

#### 変更

- **更新の前に:** 結果不明のまま残った操作、開いている編集セッション、止まった書き出し・別名保存は、更新前の版で解決してから更新してください。版の判定を直したため、版を確かめる10の操作では、更新前の版が作った実行記録を新しい版が記録の不一致として受け付けません（消しも上書きもしません）。日本語などASCII以外のパスで止まった書き出し・別名保存や開いた編集セッションを残したまま、古い版に戻すことにも対応しません。更新の直後は、以前の記録を新しい版で確かめられないため、未保存のまま続ける変更（`dirty_file`）と保存が一度止まることがあります（開いている保存済みの文書を保存するか閉じて、`illustrator_list_documents` を読むと解けます）
- 確かめていない版の扱い: 同意の確認をやめました。確かめていない通常版のIllustrator（別のmajor・minorを含む）でも、版を確かめる変更系ツール（画像の埋め込み・削除・パスの編集・SVGの読み込みなど）は、`accept_unmeasured_host_version` なしで計画・適用できます（古いAIアプリが送る値は受け取って無視します）。計画と結果の `host_version` に未測定の版であることを示し、変更は前後の比較で確かめます。保存済みのファイルを変える操作は、未測定の版に限り、適用の前に確認済みのバックアップ（`backup_id`）が要ります（無ければ `HOST_VERSION_BACKUP_REQUIRED` で何も変えずに止めます）。止める対象の版・読めない版・通常版以外（Beta版など）は引き続き止めます。画素数を指定した書き出しは、30.8以外のminorでは止めます
- 拒否されたときの案内: 拒否の種類で次の手を分けました。機能がない・未測定・測った範囲の外という理由の拒否では、`next_steps.actions` に `custom_script` を付けます。このときAIアプリは、確認を待たずに、このサーバーの外の独自のスクリプトで進めてよいことにしました（何を変えるかを伝える、保存済みの文書は先に `illustrator_create_backup` を取る、読み取りツールで結果を確かめて報告する、文書のキーを読み直す）。結果不明・解決していないロック・対象の取り違え・画面ロックや前面でないといった環境の状態による拒否には付けず、その場合はこのサーバーで解決してからやり直します。上限による拒否は `narrow_scope`、ロック・非表示は `unlock_target`・`show_target` のままです。beta.5でサーバーの案内に加えた「独自のスクリプトで同じ変更をしない」という規則は、この範囲で改めました。任意のスクリプトを実行するツールはありません
- `illustrator_create_backup`: 1,000点を超える文書も、全件の記録を2回読んで一致を確かめてから比べる方法で、macOSでは20,778点まで確かめます（実制作の20,778点の文書で37.8秒）。超える文書は、文書の点数と上限、回避策を付けて `document_too_large` で止めます
- 編集セッションの上限: 1回の走査で確かめる上限を2,000点から3,000点に、走査の期限を15秒から60秒にしました。3,000点を超える文書は、区切って走査を続ける方法（`scan_continuation`）で20,779点まで開けます。3,000点を超える文書の保存には、走査の後・保存の前に外部で変わった属性を見逃しうる時間（実測で約12分）があるため、利用者に確かめてから `accept_chunked_scan_window: true` を指定します。約2万点の実制作の文書の複製で、開くのに約6分、保存に約12.5分かかりました。埋め込み画像（リンクなし）のある文書でも開けるようになりました（位置・大きさ・名前・不透明度などの外部の変更は保存の前に検出しますが、画素やプロファイルの変更は検出しません）
- `illustrator_save_document`: 編集セッションの全体の走査が期限内に終わらないとき、セッションを中断せず、何も書かずに `edit_session_scan_incomplete` を返します（セッションは開いたままです）。もう一度実行してください。変更を保存する前にIllustratorを再起動しないでください
- `illustrator_list_objects`・`illustrator_get_object` が、文書の大きさの2乗で遅くならないようにしました（20,778点で、一覧と不在の確認が1回0.5〜1.7秒）。変更系ツールの対象の探し方も直し、同じ文書で `illustrator_set_object_state` の計画が18.8秒から約0.37秒に、30秒で時間切れになっていた適用が約0.48秒になりました。**一覧の順序とカーソルが変わりました:** 一覧はレイヤーの木の順（グループの子はグループの直後）になり、カーソルは版2になりました。版1のカーソルは古いものとして拒否されるので、最初から一覧し直してください
- `illustrator_mutate_batch` の応答を小さくしました: 各手順は要求・止める理由・変わる値（`changes`）と、前後のスナップショットのSHA-256だけを返し、適用は `postconditionSha256` と予測との差（`observed`）を返します（16手順・192文字の文字サイズの変更で、計画が1.1 MBから約33 KBに）。計画の `next_call` は `expected_before_sha256`・`confirmed_after_sha256` を使い、完全な `expected_before`・`confirmed_after` も引き続き受け付けます。参照するスナップショットはサーバーのメモリにだけあるため、サーバーを再起動した後などは何も書かずに拒否します。計画し直してください。値は読み取りツールで確かめます。**結果の形が変わりました**
- 全ツールの応答の本文（`content`）のJSONを、整形なしにしました（`structuredContent` は変わりません）
- `illustrator_set_text_orientation`: スナップショットを1文字ごとの `characters` から、属性が同じ連続区間の `runs` に替えました。照合・検証・逆操作は従来どおり全文字で行います。**結果の形が変わりました:** 結果の版3
- `illustrator_set_text_style` と `illustrator_mutate_batch` の文字の書式の手順: 1行のポイント文字（レイヤー直下と通常のグループの中）のサイズ・トラッキング・比率・塗り・フォントの変更で、新規文書の既定値との完全な一致を求めなくなりました。言語・禁則・文字組み・自動行送りの量・段落のアキ・カーニングなどは変更の前に記録して後で照合し、巻き添えの変化があれば元に戻して属性名を返します。小数5桁で表せないサイズは計画で止めます。実機（30.8.2）で24項目を確かめました
- `illustrator_preflight_print`・`illustrator_preflight_images`・`illustrator_check_text_consistency` は、すべての結果に固定の `scopeNote` を返します。行った検査だけを報告していること、指摘がなくても入稿してよいという意味ではないこと、最終の見た目は利用者がIllustratorと印刷会社の条件で確かめることを伝えます
- `illustrator_export`: 辺の位置や幅・高さに測っていない端数があるアートボードも、整数ptに丸めた寸法×倍率を予測して書き出します。計画は端数のある辺を `edgeWarnings` に、許す範囲を `expectedRange` に示し、結果は実際の寸法を返します
- `illustrator_optimize_images`: 描画の比較で止まったとき、比べた画像（前・後・差分）と概要を `evidenceDirectory` に残します（上限つき）。利用者の作品を含むため、不要になったら手で消してください。成功したときは残しません
- エラーの伝え方: 適用の途中でIllustratorが例外を出したとき、失敗のメッセージと実行記録に、分かる場合はAPI名と、パスとファイル名を除いた原文（500字まで）を残します（以前は `Apply failed.` だけでした）。結果の検査の失敗は、項目の配列ではなく、条件・アートボード・値を示す1文で返します
- `illustrator_get_object`: 文字の書式の区切りは、同じ属性が続く分をまとめて最大32件で返します

#### 修正

- `illustrator_export_pdf` で端数の裁ち落とし（8.5ptなど）を指定すると、計画は通るのに適用の検証で止まり、作業用の複製と途中のPDFが残っていた問題を修正しました。整数ptでない辺は計画の段階で `bleed_invalid` として止め、近い整数ptとそのmm（例: 8 pt（2.82 mm）か9 pt（3.18 mm））を示します。黙って丸めることはしません
- アートボードの端に浮動小数の誤差（`5.7e-14`・`699.9999999999999` など）がある文書で、`illustrator_export`・`illustrator_update_artboard`・`illustrator_export_pdf`・`illustrator_export_outlined`・`illustrator_optimize_images`・`illustrator_create_trim_marks` が止まっていた問題を修正しました。1e-6以内の差は同じ値として比べ、文書を書き換えて直すことはしません。端にあるオブジェクトも、`illustrator_capture_preview`・`illustrator_preflight_print`・`illustrator_list_objects` の範囲の判定でアートボードの内側として扱います
- 日本語の名前の文書やフォルダで、Node.jsとIllustratorの間のパスの表記の違い（濁点の合成・分解など）のため、バックアップ・上書き保存・書き出しの後始末・別名保存の復旧・編集セッション・配置や差し替えの後の画像のパスの照合が失敗することがあった問題を修正しました
- 開いているファイルを表記だけが違うパスで開こうとすると、Illustratorに使えない2つ目の文書ができてしまうため、`illustrator_open_document` と別名保存の切り替えは、Illustratorに開かせる前に止めるようにしました（別名保存は `output_already_open` で止まり、`illustrator_reconcile_save_as` で解決します）
- `illustrator_create_layer`・`illustrator_reorder_layer` で、置く位置の基準になる隣のレイヤーがロックまたは非表示だと、適用の途中でIllustratorのエラーになっていた問題を修正しました。計画の段階で `reference_sibling_locked_or_hidden` として止めます（自動では解除しません）
- 長い文字や大きなグループを含む文字の変更で、計画は通るのに適用の結果が実行記録の上限を超え、結果不明（ロックが残る）になることがあった問題を修正しました。`illustrator_replace_text_range`・`illustrator_set_text_style`・`illustrator_replace_point_text`・`illustrator_replace_point_text_batch`・`illustrator_set_text_orientation`・`illustrator_set_no_break`・`illustrator_mutate_batch` は、結果の大きさ（絵文字などのサロゲートや、グループの子の一覧を含む）を見積もり、209,715バイトを超えるときは計画の段階で `result_too_large` で止めます
- `illustrator_get_object` が、ポイント文字やエリア内文字で `No such element` だけを返して失敗することがあった問題を修正しました。内容が空のときや末尾が改行のときの最後の段落は `trailing_empty_paragraph` として返し、ほかの読めない値は `details.unreadable`（属性・Illustratorのエラー番号・次の手順）に残して、読めた値を返します。`illustrator_extract_design_tokens`・`illustrator_check_text_consistency` は、読めない枠を `unreadableTextFrames` に残します
- 未保存の変更がある保存済み文書で `illustrator_delete_objects` を計画すると、止める理由の文が長すぎてサーバーの検査で拒否されていた問題を修正しました。`document_not_saved` で止めた計画と次の手順を返します（全文は `document.mutationBlockedReason`）
- 編集セッション中に複合パスを変更すると、その後の保存が外部の変更として拒否されていた問題を修正しました
- beta.5で、Creative CloudがAdobeのアプリ専用に有効にするAdobe Fontsのフォントを確かめられず、フォントの書き込みで止まっていた問題に対処しました。Illustratorを起動して文書を開く前に `illustrator_list_documents` か `illustrator_find_fonts` を一度呼ぶと、Illustratorのフォント一覧を読み、そこにあるフォントを `illustrator_set_text_style`・`illustrator_replace_font` で確かめたものとして使えます（Illustrator 30.8.2の通常版、前面・画面ロック解除のとき）。書き込むたびに、Illustratorがその名前を今も見つけることも確かめます。一覧はサーバーのメモリにだけ持ちます

#### 既知の制限

- Adobe Fontsのフォントは、文書を開く前に読んだフォント一覧にあるときだけ書き込めます。サーバーやIllustratorの再起動の後と、一覧を読んだ後に追加したフォントは、文書をすべて閉じた状態でもう一度読むまで使えません。`illustrator_replace_font` でAdobe Fontsのフォントを使う経路は、実機では確かめていません。文字の作成と文字スタイルのツールは、引き続きIllustratorの中だけでフォントを確かめます
- `illustrator_replace_text_range`・`illustrator_set_text_style` は、実行記録の大きさのため、短いフォント情報の場合で1つの枠が約200字（改行・強制改行を含むと約180字）を超えると `result_too_large` で止まります。範囲や枠を分けてください
- `illustrator_create_barcode`・`illustrator_create_qr_code` の読み取りの照合には zbarimg が要ります（同梱していません）。無いときは `not_run` になり、読み取りでは確かめません。形と読み取りの照合は、GS1の認証や印刷物での読み取りの保証ではなく、バーコードのケース上の位置も確かめません。最終の印刷条件（方式・紙・インク・読み取り機器）で確かめてください
- `illustrator_set_stroke_style` が対応するのは、実機で測った1つの形（一度も保存していない1レイヤーのCMYK文書の、3点の開いた直線のパス）だけです
- `illustrator_replace_area_text_range` は、Illustrator 30.8.2で、両端揃え（最終行左揃え）の1段落だけを確かめています
- `illustrator_render_artboards` は前面化に対応していません。`illustrator_capture_preview`・`illustrator_extract_text` の前面化は、画面ロック中は行わず、最小化したIllustratorや別のデスクトップ（Space）にあるIllustratorには対応していません
- 3,000点を超える文書の編集セッションでは、走査の後・保存の前に外部で変わった属性を見逃すことがあります。開くのにも保存にも数分以上かかります
- `dirty_file` で続ける変更は、指定した対象の外で起きた変更を検出しません
- `custom_script` の案内に従ってAIアプリが独自のスクリプトで行った変更は、このサーバーの計画・適用・読み戻しの確認の外です。読み取りツールで結果を確かめてください
- 確かめていない版での変更は前後の比較で確かめますが、その版での実機の確認はありません
- `illustrator_mutate_batch` のレイヤーの状態の手順と、文字の書式の手順のトラッキング・比率は、公開しているツールを通した実機の確認がまだです
- `illustrator_export_pdf` の `pdfx` は、PDF/Xの情報を書いたことまでを確かめます。規格への適合は検証しません
- `illustrator_audit_typography` の短い行の判定は経験則です。字間の開いた行は、判定に使う値を測っていないため判定しません。禁則に反する改行を見つける規則は自動テストで確かめています。実機で確かめたのは、禁則Hardの文書で行頭・行末禁則の指摘が0件になることまでです。ルビ・割注・強制改行は判定しません
- `illustrator_create_trim_marks` には日本式・欧文式の寸法の既定値がありません。寸法はすべて指定してください
- `illustrator_optimize_images` は、大きな画像（原点にある800×800pt）では描画の検証で止まることがあります
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

## [0.1.0-beta.5] - 2026-09-27

**日本語** | [English](https://github.com/mhimt-lab/illustrator-studio-mcp/blob/main/CHANGELOG.en.md)

0.1.0-beta.4からの更新です。トンボ・裁ち落とし付きのPDF書き出しと文書内のトンボ、配置画像の寸法指定（枠に収める・覆う、見せる位置）と画像の移動・拡大縮小・回転・クリッピングマスク、複数のフォントの組の一括置換、日本語の改行位置を読むだけで確かめる組版の監査、文字の枠の移動、冊子規模のフォント置換、activeアートボードの移動・サイズ変更と書き出し寸法の照合、別名保存が途中で止まったときの解決手段を追加しました。Illustratorのパッチ版への更新でも変更系が止まらないようにしました。結果が確かめられないときの扱いと、ロック・非表示の確認を強めています。Windows対応の準備として、検証キットを公開しました。本番運用向けの完成版ではありません。

**前提:** Illustratorを前面に表示し、画面ロックを解除した状態で使います。背面や画面ロック中は、多くの操作が拒否されます。

#### 追加

- `illustrator_audit_typography`（読み取りのみ）: Illustratorが実際に組んだ日本語の改行位置を読み、行頭禁則・行末禁則・分割禁止（JLReq）、指定した分割禁止語、和文に挟まれた半角約物、エリア内文字のあふれを指摘として返します。`policy` は配列で、いまは `jp_line_break_v1` だけです。1回の読み取りは200枠・20,000字・2,000行・2,000段落までで、パス上文字・連結した文字・ロックまたは非表示・縦組みのポイント文字・空の枠は理由を付けて除外します（結果は部分的になります）。文書は変更しません
- `illustrator_reconcile_save_as`: `illustrator_save_document_as` は準備を始める前に実行を記録し、途中で止まったときは `saveAsId` と、このツールの呼び出し（`nextCall`）を返します。解決するまで、ほかの変更・バックアップ・書き出し・別名保存を止めます。このツールは止まった段階を読み取り（`inspect`）、保存せずに閉じて出力先を開き直す（`switch_document`）、隠しの一時ファイル名だけを消す（`cleanup_staging`）、何も消さずに記録を外す（`abandon`）で解決します。別のMCPサーバーが実行中の別名保存には触れません
- `illustrator_transform_object`・`illustrator_mutate_batch` の平行移動（`translate`）で、レイヤー直下の連結していないポイント文字・エリア内文字の枠（横組み・縦組み、1〜512文字）を動かせるようにしました。内容・表示される行・文字ごとの書式・段落揃え・段組を計画に固定し、適用の直前と読み戻しで確かめます。回転・拡大縮小は対象外です
- `illustrator_update_artboard`（実験段階）: activeのアートボードも整数ptで移動・サイズ変更できるようにしました。文書の原点は新しいボードの左下に合わせて動きます。移動・サイズ変更と追加に `pixel`（幅・高さ・倍率1または2）を指定すると、`illustrator_export` で書き出したときの画素寸法を計画で示し、合わなければ `pixel_size_mismatch` で止めます（差分を返し、自動では合わせません）
- 変更系ツールの計画が止められたとき（blockerがあるとき）、`next_call` の代わりに `next_steps` を返します。止めた理由のコード（`blocked_by`）、次の手（`actions`: ロック解除・表示・フォントのインストール・範囲を絞るなど）、AIアプリへの短い指示（`note`）を含みます。あわせてサーバーの案内に、拒否・停止・結果不明のときは理由と次の手を利用者に伝えて判断を仰ぎ、画面の自動操作や独自のスクリプトで同じ変更をしない、という規則を加えました
- `illustrator_export_pdf`: 保存済みの文書から選んだアートボードを、1つの新しいPDFとして書き出します。元の文書とファイルは変更せず、既存のファイルは上書きしません。PDFプリセットはIllustratorのプリセット名を完全一致で指定します（PDF/Xのプリセットは未対応）。トンボ（日本式・欧文式）・レジストレーションマーク・カラーバー・ページ情報と、四辺の裁ち落とし（0〜72pt）を指定できます。書き出したPDFのページ数・仕上がりの大きさ（TrimBox）・各辺の裁ち落としを確かめてから出力します。プリセットの設定がPDFに反映されたことまでは確かめません（結果に明記します）。途中で止まった書き出しは `illustrator_reconcile_export` で解決します
- `illustrator_create_trim_marks`: アートボードの四隅に、編集できるトンボをパスで作ります。仕上がり線だけ（8本）か、裁ち落とし線も（16本）を選べます。新しい最前面のレイヤーに1つのグループとして作り、線はレジストレーション色です。裁ち落とし・オフセット・長さ・線幅はptで指定します。同じ名前のレイヤーがあるときは、二重に作らないよう止めます。編集セッション中は使えません
- `illustrator_place_image` の `size`: 幅または高さ（縦横比を保つ）、枠に収める `contain`・枠を覆う `cover`、明示したときだけの `stretch` で配置寸法を指定できます。`contain`・`cover` では `focal_point`・`align_to` で見せる位置を選べます。計画で配置後の寸法と縦横の実効解像度を示し、`minimum_effective_ppi` を下回ると警告します（止めません）。`cover` のはみ出しはクリップしません。**結果の形が変わりました:** 計画と結果の版が1から3になりました
- `illustrator_transform_object` で、リンク画像・埋め込み画像を移動・中心基準の拡大縮小・回転できるようにしました（レイヤー直下か、クリップしていないグループ1段の中）。適用に失敗したときは、確かめた逆変換で戻します。一括変更と整列では、引き続き画像を対象にしません
- `illustrator_create_clipping_mask` で、画像のクリッピングマスクを作れるようにしました。隣り合う長方形のパスをマスクにし、同じレイヤーにある回転していない縦横同倍率の画像（RGBのPNGリンク、CMYKのTIFFリンク、文書と同じカラーの埋め込み画像）を切り抜きます。画像のクリップの解除と入れ子は未対応です。**結果の形が変わりました:** 計画と結果の版が2から3になりました
- `illustrator_replace_font` の `mappings`: 複数のフォントの組（最大16組）を1回の適用でまとめて置換します。全部置換するか、何もしないかのどちらかです。同じ置換元の重複や、置換元でも置換先でもあるフォント（連鎖・循環）は、Illustratorを呼ぶ前に止めます。1回の適用に収まらない範囲は、途中まで置換せず `mapping_scope_exceeds_limit` で止めます。1組の指定はこれまでどおり使えます。**結果の形が変わりました:** 計画の置換元・置換先の情報は `plan.mappings[0]` に移り、計画と結果の版が1から3になりました
- Illustratorの版の扱い: 確かめた版と同じminorのパッチ版（30.8.xなど、通常版に限る）では、変更系ツールをそのまま使えます。確かめていない版の通常版では、画像の埋め込み・削除・パスの編集・SVGの読み込みなどの一部の変更系ツールが `accept_unmeasured_host_version` を受け付けます。AIアプリはその版での実行について利用者の明示の同意を得てから指定し、ファイルを伴う変更には確認済みのバックアップが要ります。プレビューの取得と行送りの読み取りは、確かめていない版やBeta版でも使えます
<!-- windows-probe-kit:added:start -->
- Windows検証キット（`windows-probe/`、公開リポジトリのみ。npmのパッケージには含みません）: Windows対応は準備中です。WindowsとIllustratorをお持ちの方に向けて、Illustratorへの接続・スクリプトの実行・画面ロック中や背面での振る舞いを測る検証キットと手順書（日本語・英語）を公開しました。結果は公開リポジトリのIssueフォームから提出していただきます（提出した結果は公開されます）。MCPサーバー自体は引き続きMac専用です
<!-- windows-probe-kit:added:end -->

#### 変更

- `illustrator_replace_font` が冊子規模の文書（数万字、連結した文字・複数の段落・両端揃え・縦組みを含む）で使えるようになりました。`scope`（`artboard_index`・`layer_path`・`selection: true`・`target_uuids` のいずれか1つ）で範囲を絞れます。1回の適用に収まらない範囲は区切りごとに計画を返し、区切りを適用してから同じ範囲でもう一度計画すると、次の区切りに進みます。止まった枠は、理由とレイヤーの位置を付けて最大64件返します。1回の適用は40,000字・書式の区切り1,000・512枠までです。**結果の形が変わりました:** `usage.frames`・`expected_usage.frames`・`remaining.frames` は `stories` に、`usage.frameList` は `usage.storyList` になり、各項目に `frames` が加わりました
- `illustrator_export` で、辺に端数があっても幅・高さ×倍率が整数になるアートボード（1倍では.5pt、2倍では.25ptまたは.5pt）と、0以外の整数のボード原点を書き出せるようにしました。対応しない寸法は、書き出す前に理由を示して止めます。**拒否の理由コードが変わりました:** `fractional_artboard_edge` は `fractional_pixel_size`・`fractional_edge_unmeasured`・`artboard_ruler_origin_unmeasured` の3つに分かれました
- 読み取りや計画の途中でIllustratorが無効になった参照を返したとき（グループの読み取りの既知の間欠事象など）、新しいエラー `ILLUSTRATOR_HOST_REFERENCE_INVALID` で止まり、経路・位置とIllustratorのエラー番号を返します。その項目を読み飛ばしたり、存在しないものとして扱ったりはしません
- 変更の適用が1回あたり約0.2秒短くなりました（実行記録を整理するときのディスクへの書き込みの確定を1回にまとめました）。実機で、長方形の作成・見た目の変更・一括作成の適用の平均が約751msから約544msになりました（前後を交互に各5回）。記録の形と安全性の確認は変わりません
- `illustrator_save_document` は、別の名前（ハードリンク）を持つファイルへの上書き保存を拒否します。別名保存の一時ファイルを消せなかったときは、`saved` ではなく結果不明として扱います
- SVGの読み込み（`illustrator_import_vector_artwork`）は、文字を含むSVGで、`tspan` や入れ子のグループ、表示の判断があいまいな文字を計画の段階で止め、`next_steps` を返します。XMLとして正しくないSVGも止めます（以前はIllustratorが読み込めた不正なSVGも拒否されることがあります）
- 確かめていない版で止めたときの理由コードを `host_version_unmeasured` にそろえました（以前の `unmeasured_app_version`・`unsupported_host_version`・`spot_host_version_unverified`・`host_version_unverified`・`app_version_unmeasured`）
- 公開READMEを英語を主にして書き直しました（日本語は `README.ja.md`）。npmのパッケージページも英語になります

#### 修正

- iCloud Driveの「デスクトップと書類」などの同期フォルダで、同期の仕組みがファイルに印を付けて変更時刻（ctime）だけを進めるため、中身が同じでも別名保存・上書き保存・閉じる・バックアップ・アウトライン化した書き出し・PNG/JPEG書き出し・画像の最適化と検査が失敗や結果不明になることがあった問題を修正しました。ctimeだけが変わったときは読み直すか中身の一致を確かめ、差し替えや書き換えは引き続き検出します
- ロックまたは非表示の親レイヤー（サブレイヤーの親）やグループの中にある対象を、`illustrator_relink_image`・`illustrator_embed_image` が変更できてしまう問題を修正しました。これらと `illustrator_transform_object`・`illustrator_align_objects`・`illustrator_mutate_batch` は、計画の段階で `ancestor_locked`・`ancestor_hidden` で止まり、`next_steps` でロック解除・表示を案内します
- Illustrator側で結果の書き出しに失敗したとき（空のファイルなど）、完了として扱わないようにしました。書き込みを確かめてから結果を公開します。読み取りでも結果を読めないときは結果不明として扱い、`illustrator_reconcile` で解決するまで次の操作を止めます（以前は読み取りの失敗として解放していました）
- 異体字セレクタ（U+E0100など）を含む文字がある文書で、読み取りの結果が空になって失敗することがあった問題を修正しました
- Illustratorを操作する補助プロセスが起動の直後に終了したとき、MCPサーバーのプロセスごと終了するおそれがあった問題を修正しました。呼び出し元には従来どおり起動失敗のエラーを返します
- 開いている文書が使っていると、この機械にないフォントもIllustratorが名前で見つけてしまうため、`illustrator_find_fonts`・`illustrator_replace_font`・`illustrator_set_text_style` が欠落フォントを「インストール済み」と判定していた問題を修正しました。Illustratorの外でもフォントを確かめ、確かめられないフォントは `unverified` と答えて、書き込みでは止めます
- SVGの読み込みで、先頭のフォントに無い字形の文字が消えても検証を通っていた問題を修正しました。読み込んだ文字の数を元のSVGと照合し、合わなければ元に戻します。実際に使われたフォントが指定と違うときは警告します
- `illustrator_set_area_text_columns`・`illustrator_update_character_style` で変更しても、Illustratorが文書を変更なしのまま扱うため、上書き保存が `nothing_to_save` で拒否され、閉じると変更が失われていた問題を修正しました。値が実際に変わったときは文書を変更ありにします
- 要素の多い文書で `illustrator_create_backup` が `restore_structure_mismatch` で止まり、上書き保存の前のバックアップが取れないことがあった問題を、原因ごとに修正しました。SVGの読み込みが残す空の複合パスは読み込みの時点で止め、ファイルに保存されていない段組は原因を示して知らせます
- 原点から離れた位置にある埋め込み画像を `illustrator_optimize_images` で縮小すると、検証で止まっていた問題を修正しました。位置を保ったまま縮小します。寸法が画素に割り切れない画像と、定規の原点が0でない文書は計画の段階で除外します

#### 既知の制限

- `illustrator_export_pdf` で端数の裁ち落とし（例: 3mm相当の8.5pt）を指定すると、計画は通りますが、Illustratorが整数ptに丸めて書くため、適用の検証で止まります（誤ったPDFは出力しません）。当面は整数ptで指定してください
- Creative CloudがAdobeのアプリ専用に有効にするAdobe Fontsのフォントは、この機械にあることを確かめられず、フォントの書き込み（置換・文字の書式の変更）で止まります。これはbeta.4からの後退です。文字の作成と文字スタイルのツールは、引き続きIllustratorの中だけでフォントを確かめます
- `illustrator_create_trim_marks` には日本式・欧文式の寸法の既定値がありません。寸法はすべて指定してください
- `illustrator_optimize_images` は、大きな画像（原点にある800×800pt）では描画の検証で止まることがあります
- `illustrator_audit_typography` が禁則に反する改行を見つける規則は、自動テストで確かめています。実機で確かめたのは、禁則Hardの文書で行頭・行末禁則の指摘が0件になることまでです。ルビ・割注・強制改行は判定しません
- `illustrator_replace_font` は合成フォントに対応していません。保存済みの文書では、区切りを適用するたびにバックアップと上書き保存が要ります。置換先に対象の字形がないと、検証の不一致で元に戻ります
- 文字の枠の平行移動は、CMYK文書では確かめていません
- `illustrator_mutate_batch` の見た目・文字の置換・文字の書式の手順は、親グループのロック・非表示で止まったときに `next_steps` が付きません（書き込みは行いません）
- `illustrator_run_m6_appearance_preview_recipe` のプレビューをiCloudなどの同期フォルダに出力すると、中身が同じでも変更と誤判定して止まることがあります。同期フォルダの外に出力してください
- 作成時の見た目の指定は、特色（スポットカラー）とグラデーションに対応していません。作成後に `illustrator_set_path_appearance` を使ってください
- 4000×3000 pxのJPEGを書き出すとき、寸法の確認でNode.jsのメモリを一時的に約570 MiB使いました（1回の実測）
- Streamable HTTPは自動テストとAIアプリとの接続確認までです。HTTP経由でIllustratorを操作した記録はありません
- CMYK文書では、重なり順の変更は最前面（`front`）だけ、複合パスの作成は未対応です
- グループの読み取りで、ときどき対象を参照できなくなる既知の間欠事象があります。原因は未解決です。このとき操作は安全側で止まり（fail closed）、結果が確かめられない場合は「結果不明」として扱います
- 長い文書識別情報を含む実行記録は、読み戻せないことがあります
- 既存の線付き文字は編集対象外です
- Desktop拡張には署名がありません。インストール画面で提供元と版を確認してください
- npmでは必ず `@beta` を付けてください。タグなしのインストールは `latest` を使い、この版になるとは限りません

<!-- windows-probe-kit:section:start -->
#### Windows検証キット

- タグ: `v0.1.0-beta.5`
- キットのSHA-256（`--expect-sha256`）: `421f2fe2943a177f52d9c83376b239207c449429f16b4538cdf0ff2b68b31573`
- 手順書: [`windows-probe/README.md`](https://github.com/mhimt-lab/illustrator-studio-mcp/blob/v0.1.0-beta.5/windows-probe/README.md)
<!-- windows-probe-kit:section:end -->

[導入](docs/install.md)・[互換性](docs/compatibility.md)・[復旧](docs/runbook.md)・[LICENSE](LICENSE)を確認してください。

## [0.1.0-beta.4] - 2026-09-23

**日本語** | [English](https://github.com/mhimt-lab/illustrator-studio-mcp/blob/main/CHANGELOG.en.md)

0.1.0-beta.3からの更新です。アートボードの追加・active切替と、既存ボードの名前変更・移動・サイズ変更、アートボード1枚のPNG・JPEG書き出し、作成と同時の見た目の指定を追加して作図の往復を減らし、不具合を修正しました。本番運用向けの完成版ではありません。

**前提:** Illustratorを前面に表示し、画面ロックを解除した状態で使います。背面や画面ロック中は、多くの操作が拒否されます。

#### 追加

- `illustrator_export`: 保存済みで未編集のRGB文書のアートボード1枚を、新しいPNG24またはJPEGファイルとして書き出します。元の文書とファイルは変更せず、既存のファイルは上書きしません。倍率1・2、1辺4000 px・総画素1200万まで、辺が整数ptのアートボードに対応し、書き出したファイルの画素寸法が計画と一致することを確かめます。不透明なPNGは1倍のみです。SVGは未対応です
- `illustrator_reconcile_export`: `illustrator_export` が結果不明で止まったとき、止まった段階に応じた `finalize`・`abandon`・`release_quarantined` を使えます
- `illustrator_update_artboard`（実験段階）: 既存アートボードの名前変更、activeでないボードの整数ptでの移動・サイズ変更、activeの切替、名前つきボードの末尾への追加を、計画・適用・読み戻しで行います。保存済みRGB文書、最大256ボード、レイヤー直下の通常パス128個・合計256点までです。全ボードの原点が `[0,0]` の文書だけを受け付けます。名前変更・移動・サイズ変更・追加の後は文書が未保存になるため、続けて変更する前に保存してください。activeの切替は保存を必要としません。追加したボードをこのサーバーで削除する手段はありません。Webピクセル指定と編集セッションは対象外です
- `illustrator_create_rectangle`・`illustrator_create_shape` で、作成と同時に不透明度・塗り・線（RGB・CMYK・グレー、なし）を指定できるようにしました。同じ適用の中で設定し、読み戻して確かめます。`illustrator_create_batch` は図形（`create_shape`）と、長方形・図形の初期の見た目を扱えるようになり、1回の上限を8件から16件にしました（図形のアンカー合計256まで）。12オブジェクト程度の作図が、計画と適用の2往復で済みます

#### 変更

- 公開パッケージの依存に `jpeg-js`（BSD-3-Clause）を追加しました。書き出したJPEGの寸法を全画素の読み込みで確かめるためです
- バックアップ作成時の文書構造の確認で、同じ文書の2回目の読み取りを、SHA-256の再計算ではなく1回目との厳密な比較で確認するようにしました。確認の厳しさとバックアップの上限（1,000オブジェクト）は変わりません。実機1回の計測で、600オブジェクトのバックアップは約18.0秒から約11.5秒になり、1,000オブジェクトは約18.3秒でした
- 連続編集（edit session）中の適用が、1回あたり約0.2秒短くなりました（Illustratorが前面にあるかの確認を軽い方法に変更。実機で各5回の中央値）
- 連続編集を、CMYK文書での制作の流れ（62件の変更、外部で変更されたときの検出と回復、再送、保存と再読込）で実機確認しました

#### 修正

- 適用の直前の確認で拒否されたとき（計画の後に対象が変わった場合など）、拒否の区分と理由、「計画を取り直して新しい `command_id` で適用する」という次の手順を結果に返すようにしました。何も書き込まれないことは従来どおりです。同じ `command_id` を再送したときの応答は、従来の文言のままです
- グループの参照が一時的に読めなくなったとき、長方形の作成の取り消しと編集セッションの検証が、その対象を「存在しない」と扱って成功を返すことがあった問題を修正しました。存在しないことを確かめられない場合は、結果不明として扱い、編集セッションを進めません
- `illustrator_create_shape` で星形を作成したあと、その図形が選択状態のまま残り、利用者の選択が変わっていた問題を修正しました。星形も他の図形と同じく、選択を変えずに作成します
- 範囲全体が不透明な画素だけのとき、`illustrator_capture_preview` が `PREVIEW_OUTPUT_INVALID` で失敗していた問題を修正しました。この場合はIllustratorが書き出したRGBのPNGをそのまま返し、`image.pixelFormat` が `rgb8_opaque` になります。透明な画素を含む範囲は従来どおりRGBA（`rgba8_straight_alpha`）です
- `illustrator_set_path_appearance` の計画に `next_call` が付かなかった問題を修正しました
- バックアップの復元テストで、元の文書と数値がごくわずか（許容差の範囲内）に違うとき、比較の読み取りに失敗してバックアップが作れなかった問題を修正しました
- `illustrator_open_edit_session` の説明を、実際に受け付ける範囲（入れ子を含む2,000 items、グループ・クリップグループ・複合パス・リンク配置画像）に合わせました
- `illustrator_set_path_appearance` で既存のオブジェクトの塗りをなしにする適用が、検証の不一致で必ず取り消されていた問題を修正しました
- `illustrator_update_artboard` の計画に `next_call` が付くようになりました

#### 既知の制限

- 作成時の見た目の指定は、特色（スポットカラー）とグラデーションに対応していません。作成後に `illustrator_set_path_appearance` を使ってください
- 4000×3000 pxのJPEGを書き出すとき、寸法の確認でNode.jsのメモリを一時的に約570 MiB使いました（1回の実測）
- Streamable HTTPは自動テストとAIアプリとの接続確認までです。HTTP経由でIllustratorを操作した記録はありません
- CMYK文書では、重なり順の変更は最前面（`front`）だけ、複合パスの作成は未対応です
- グループの読み取りで、ときどき対象を参照できなくなる既知の間欠事象があります。原因は未解決です。このとき操作は安全側で止まり（fail closed）、結果が確かめられない場合は「結果不明」として扱います
- 長い文書識別情報を含む実行記録は、読み戻せないことがあります
- 既存の線付き文字は編集対象外です
- Desktop拡張には署名がありません。インストール画面で提供元と版を確認してください
- npmでは必ず `@beta` を付けてください。タグなしのインストールは `latest` を使い、この版になるとは限りません

[導入](docs/install.md)・[互換性](docs/compatibility.md)・[復旧](docs/runbook.md)・[LICENSE](LICENSE)を確認してください。

## [0.1.0-beta.3] - 2026-09-22

**日本語** | [English](https://github.com/mhimt-lab/illustrator-studio-mcp/blob/main/CHANGELOG.en.md)

0.1.0-beta.1からの更新です。Claude Desktop拡張（`.mcpb`）の配布を始め、AIアプリが変更系ツールの引数を迷わず組み立てられるようにしました。本番運用向けの完成版ではありません。

0.1.0-beta.2は、GitHubのtag（`v0.1.0-beta.2`）までは作成しましたが、Desktop拡張（`.mcpb`）を同じbytesで作り直せない問題（zipに記録される時刻が実行環境のタイムゾーンで変わる）が見つかったため、npmとGitHubのprereleaseでは公開していません。0.1.0-beta.3の内容は0.1.0-beta.2と同じです（`.mcpb` はタイムゾーンによらず同じbytesになる作り方に変更しました）。

**前提:** Illustratorを前面に表示し、画面ロックを解除した状態で使います。背面や画面ロック中は、多くの操作が拒否されます。

#### 追加

- Claude Desktop拡張（`.mcpb`）をGitHubのprereleaseで配布します。Desktopに内蔵されたNode.jsで動き、実行に必要な依存を同梱しています。拡張は審査済みのnpm配布物（tgz）から作り、同じtgzから同じbytesを再現できます。`SHA256SUMS` に拡張の行も記載します
- ChatGPT Work Localを対応するAIアプリに加えました。`codex mcp add` の1行で登録できます

#### 変更

- 変更系ツールの計画（`apply: false`）の結果に `next_call` を付けます。作成系のツールと、適用時に計画の値を送り返すツールが対象で、適用にそのまま渡す引数と、新しい `command_id` の候補を含みます
- 各ツールの入力仕様に、`command_id` の形式（小文字のUUID v4）と、同じ値を再送してよい場面（同じ適用の再試行だけ）を記載しました
- 引数の誤りでは、欠けている必須引数を名指しし、知らない引数名には正しい名前を示します。拒否した `command_id` もエラーに引用します
- Codex CLIとChatGPT Work Localで、追加の指示なしに変更の適用まで進むことを確認しました
- Desktop拡張の設定「Illustrator application」を、既定値 `id:com.adobe.illustrator` のまま保存できるようにしました

#### 修正

- Claude Desktopの内蔵Node.jsで動かしたとき、Illustratorを操作する補助プロセスを起動できなかった問題を修正しました

#### 既知の制限

- Streamable HTTPは自動テストとAIアプリとの接続確認までです。HTTP経由でIllustratorを操作した記録はありません
- CMYK文書では、重なり順の変更は最前面（`front`）だけ、複合パスの作成は未対応です
- グループの読み取りで、ときどき対象を参照できなくなる既知の間欠事象があります。このとき操作は安全側で止まります（fail closed）
- 長い文書識別情報を含む実行記録は、読み戻せないことがあります
- 既存の線付き文字は編集対象外です
- Desktop拡張には署名がありません。インストール画面で提供元と版を確認してください
- npmでは必ず `@beta` を付けてください。タグなしのインストールは `latest` を使い、この版になるとは限りません

[導入](docs/install.md)・[互換性](docs/compatibility.md)・[復旧](docs/runbook.md)・[LICENSE](LICENSE)を確認してください。

## [0.1.0-beta.2] - 2026-09-22

未公開です（tagのみ）。内容は0.1.0-beta.3と同じです。上の0.1.0-beta.3の説明を参照してください。

## [0.1.0-beta.1] - 2026-09-22

**日本語** | [English](https://github.com/mhimt-lab/illustrator-studio-mcp/blob/main/CHANGELOG.en.md)

Mac上の通常版Illustratorを、AIアプリから計画・直前照合・適用・結果の読み直しの順で操作する初回Betaです。本番運用向けの完成版ではありません。

**前提:** Illustratorを前面に表示し、画面ロックを解除した状態で使います。背面や画面ロック中は、多くの操作が拒否されます。

#### 含まれるもの

- 読み取り・検査（文書・レイヤー・選択・フォント・色の使用箇所・印刷前チェックなど）
- 対応する図形・文字・画像の非破壊編集。CMYK文書にも対応します
- 保存済みファイルの連続編集（edit session、experimental）。39種類中36種類の変更操作に対応し、削除・画像埋め込み・ベクター取り込みは対象外です。開始に必要なバックアップの上限が1,000オブジェクト（600オブジェクトでの実機1回からの外挿値）なので、これが実質の上限です
- バックアップ・上書き保存・別名保存、アウトライン化したAI／PDFの書き出し
- 画像の配置・リンク差し替え・埋め込み（RGB文書のJPEG／PNGだけ）・最適化
- stdio接続（MCP 2026-07-28対応）
- 配布: npmの`beta`タグとGitHubのprerelease。検証済みbuildと同じbytesを収録し、配布時に実行JavaScriptを書き換えません

#### 対象外

PNG・JPEG・SVGの書き出し、アートボードの操作、段落スタイル、MCP Tasks、Windows、複数オブジェクトの一括削除、リンク切れの修復、グループ解除。

#### 既知の制限

- Streamable HTTPは自動テストとAIアプリとの接続確認までです。HTTP経由でIllustratorを操作した記録はありません
- CMYK文書では、重なり順の変更は最前面（`front`）だけ、複合パスの作成は未対応です
- グループの読み取りで、ときどき対象を参照できなくなる既知の間欠事象があります。このとき操作は安全側で止まります（fail closed）
- 長い文書識別情報を含む実行記録は、読み戻せないことがあります
- 既存の線付き文字は編集対象外です
- GitHub Actionsでの自動テストは、このリリース時点で未通過です（ローカルの全体テストで確認）

[導入](docs/install.md)・[互換性](docs/compatibility.md)・[復旧](docs/runbook.md)・[LICENSE](LICENSE)を確認してください。
