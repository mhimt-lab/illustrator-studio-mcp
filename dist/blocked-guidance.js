import { SNAPSHOT_RESULT_ADMISSION_BYTES } from './adapters/snapshot-result-size.js';
import { textResultSizeMessage } from './adapters/text-result-size.js';
import { batchResultFit, batchResultFitMessage } from './adapters/batch-result-fit.js';
import { recordedRunsTextResultBytes } from './adapters/text-recorded-runs.js';
import { z } from 'zod';
import { UNSAVED_NEXT_STEPS_NOTE } from './unsaved-document-guidance.js';
export const nextStepActionSchema = z.enum([
    'resolve_document_state',
    'reconcile',
    'unlock_target',
    'show_target',
    'install_font',
    'narrow_scope',
    'unsupported',
    'custom_script',
    'fix_request',
]);
export const REFUSAL_CLASSES = ['capability', 'indeterminate', 'mismatch', 'environment', 'user_state', 'limit', 'request'];
export const BLOCKER_CLASSES = Object.freeze({
    capability: [
        'overwrite_not_supported_on_platform', 'output_previous_size_unmeasured',
        'svg_images_unmeasured', 'svg_nonrendering_item_unmeasured', 'svg_dimensions_unmeasured', 'svg_artboards_overlap_unmeasured',
        'svg_item_bounds_unmeasured', 'svg_item_crosses_artboard_unmeasured',
        'svg_artboard_name_unmeasured',
        'artboard_overlap_unmeasured', 'clipping_group', 'current_link_format_unmeasured', 'default_styles_not_canonical',
        'dependent_frame_unsupported', 'dependent_overrides_present', 'document_color_space_not_rgb', 'document_color_space_unmeasured',
        'layer_has_sublayers', 'layer_not_top_level', 'placed_size_out_of_range', 'saved_rgb_profile_required', 'selection_unsupported',
        'source_color_space_unmeasured', 'source_format_unmeasured', 'source_icc_unmeasured', 'source_structure_unmeasured',
        'source_svg_linked_content', 'source_svg_nested_group', 'source_svg_text_unverifiable', 'source_svg_units_unmeasured',
        'target_frame_unsupported', 'target_transform_unmeasured', 'unmeasured_ruler_origin', 'unsupported', 'unsupported_target_position',
        'unsupported_target_type',
        'graph_variable_bound', 'unsupported_variable_kind', 'bindings_incomplete', 'text_formatting_not_restorable',
        'binding_unsupported',
        'stroke_document_scope_unmeasured', 'stroke_paint_unmeasured', 'stroke_saved_document_unmeasured', 'stroke_style_unmeasured',
        'stroke_target_shape_unmeasured',
        'composition_inverse_unreachable',
        'composition_empty_paragraph',
        'empty_paragraph_structure_unsupported',
        'text_delimiter_attributes_mismatch', 'text_delimiter_range_not_uniform',
        'text_delimiter_attributes_unreadable', 'text_delimiter_profile_unmeasured',
        'text_manual_pair_kerning', 'text_tab_stops', 'text_frame_tags',
        'mixed_size', 'unmeasured_script',
        'TEXT_EXTRACT_ACTIVATION_UNSUPPORTED',
    ],
    indeterminate: ['release_barrier', 'release_barrier_global', 'barrier_store_invalid', 'replacement_unresolved'],
    mismatch: [
        'output_changed_since_plan', 'output_changed',
        'area_text_options_not_in_file', 'backup_mismatch', 'backup_stale', 'empty_compound_path_dropped_on_save', 'link_path_mismatch',
        'pixel_size_mismatch', 'source_file_changed', 'source_hash_mismatch', 'source_pixel_dimensions_differ', 'target_not_found',
        'dataset_selector_mismatch', 'variable_selector_mismatch',
        'template_state_confirmation_mismatch',
    ],
    environment: [
        'svg_host_unmeasured',
        'document_mutation_not_allowed', 'document_not_saved', 'host_version_unmeasured', 'other_documents_open',
        'replacement_font_not_installed', 'source_font_not_installed', 'unsupported_host_version',
        'TEXT_EXTRACT_ILLUSTRATOR_NOT_FRONTMOST', 'TEXT_EXTRACT_SCREEN_LOCKED', 'TEXT_EXTRACT_HOST_PROFILE_UNKNOWN', 'TEXT_EXTRACT_ACTIVATION_FAILED',
    ],
    user_state: [
        'svg_hidden_item_unmeasured',
        'ancestor_group_hidden', 'ancestor_group_locked', 'ancestor_hidden', 'ancestor_locked', 'content_hidden', 'content_locked',
        'dependent_frame_hidden', 'dependent_frame_locked', 'descendant_locked_or_hidden', 'destination_ancestor_hidden',
        'destination_ancestor_locked', 'destination_layer_hidden', 'destination_layer_locked', 'group_hidden', 'group_locked', 'hidden',
        'layer_hidden', 'layer_locked', 'locked', 'mask_hidden', 'mask_locked', 'reference_sibling_locked_or_hidden',
        'selection_unrecordable', 'source_ancestor_hidden', 'source_ancestor_locked', 'source_hidden', 'source_layer_hidden', 'source_layer_locked', 'source_locked',
        'target_frame_hidden', 'target_frame_locked', 'target_hidden', 'target_locked', 'target_locked_or_hidden',
        'variables_locked',
    ],
    limit: [
        'output_previous_too_large',
        'embed_batch_pixel_limit',
        'svg_item_scan_limit',
        'destination_capacity_exceeded', 'layer_item_capacity_exceeded', 'mapping_scope_exceeds_limit', 'parent_too_large',
        'resource_collection_capacity_exceeded', 'result_size_limit_exceeded', 'result_too_large', 'target_set_too_large', 'too_many_targets',
        'usage_scan_limit_exceeded',
        'scan_limit_exceeded', 'text_too_long_to_verify',
        'composition_range_too_long',
        'scale_set_too_large', 'scan_deadline',
    ],
    request: [
        'output_previous_unsafe',
        'embed_batch_pixels_invalid',
        'artboard_overlap', 'destination_not_empty', 'source_artboard_empty', 'source_has_blocked_items',
        'artboard_collapse', 'artboard_crosses_x_range', 'artboard_not_affected', 'artboard_not_listed', 'items_blocked', 'nothing_to_move', 'space_not_empty',
        'nothing_to_scale', 'result_out_of_canvas', 'reference_invalid',
        'nothing_to_replace',
        'nothing_to_apply',
        'nothing_to_capture', 'nothing_to_update', 'dataset_name_taken',
        'target_already_bound', 'nothing_to_unbind', 'variable_name_taken',
        'variable_kind_mismatch', 'variable_without_bound_item', 'bound_values_disagree',
        'fill_may_be_freeform_gradient',
        'applied_style_unreadable', 'attribute_not_defined_on_style', 'attribute_value_unreadable', 'character_font_unreadable',
        'current_link_missing', 'current_link_unavailable', 'group_would_become_empty', 'link_missing', 'overlapping_targets',
        'process_color_space_mismatch', 'replacement_font_not_verifiable', 'resource_name_already_exists', 'source_file_missing',
        'source_file_unavailable', 'source_font_not_used', 'source_font_not_verifiable', 'source_is_target_document',
        'source_pixels_unavailable', 'source_pixels_unknown', 'target_is_default_style', 'target_not_editable', 'text_size_out_of_range', 'unreadable', 'value_unchanged',
    ],
});
const CLASS_BY_CODE = new Map(REFUSAL_CLASSES.flatMap((refusalClass) => BLOCKER_CLASSES[refusalClass].map((code) => [code, refusalClass])));
export function refusalClassOf(code) {
    return CLASS_BY_CODE.get(code) ?? 'request';
}
export const BLOCKED_NEXT_STEPS_NOTE = 'Apply is blocked. Tell the user the blocker codes and these actions and let them decide; '
    + 'do not make the same change through GUI automation or a custom script. '
    + '適用は止まっています。理由と次の手を利用者に伝えて判断を仰ぎ、GUI の自動操作や独自のスクリプトで代わりに変更しないでください。';
export const LIMIT_NEXT_STEPS_NOTE = ' A limit is not a reason to script: split the targets into smaller calls and repeat them through this server. '
    + '上限は、対象を小分けにしてこのサーバー経由で繰り返してください。';
export const CAPABILITY_NEXT_STEPS_NOTE = 'This server does not make this change (the feature is missing, unmeasured, or outside its measured scope). '
    + 'You may make it with your own script outside this server, without asking first: tell the user what you will change and how; for a saved '
    + 'document run illustrator_create_backup first (an unsaved document stays unsaved; the user saves it); afterwards check the result with the read '
    + 'tools (get_object, capture_structure_snapshot and diff_structure, or an export compared with the plan), report what you changed outside this server, '
    + 'and read the document key again (close and reopen an edit session: an external change suspends it). '
    + 'このサーバーが扱わない変更（機能がない・未測定・測定範囲外）です。確認を待たずに、このサーバーの外で独自のスクリプトで進めてかまいません。'
    + '何をどう変えるかを利用者に一言告げ、保存済みの書類は先に illustrator_create_backup で backup を取り（未保存の書類は保存せず、保存は利用者が行います）、'
    + '実行後は読み取りツール（get_object、capture_structure_snapshot と diff_structure、書き出しとの比較）で結果を確かめ、サーバーの外で変えた内容を報告し、'
    + 'document key を取り直してください（edit session は外部変更で停止するため閉じて開き直します）。';
export const SELECTION_UNRECORDABLE_NOTE = 'Deselect text or reduce the selection to at most 2000 objects, then plan again. 文字の選択を外すか、選択を 2000 個以下に減らしてから、もう一度計画してください。';
const MAX_BLOCKED_CODES = 32;
export const nextStepsSchema = z.record(z.string(), z.unknown());
const ACTION_RULES = [
    [/^document_mutation_not_allowed$|edit_session/, 'resolve_document_state'],
    [/reconcile|indeterminate/, 'reconcile'],
    [/locked/, 'unlock_target'],
    [/hidden/, 'show_target'],
    [/font_(?:not_installed|missing|unavailable)/, 'install_font'],
    [/limit|scan_incomplete/, 'narrow_scope'],
    [/unsupported|unmeasured|unverified|unreadable|unavailable/, 'unsupported'],
];
export function nextStepAction(code) {
    const refusalClass = refusalClassOf(code);
    if (refusalClass === 'limit')
        return 'narrow_scope';
    if (refusalClass === 'capability')
        return 'unsupported';
    return ACTION_RULES.find(([pattern]) => pattern.test(code))?.[1] ?? 'fix_request';
}
export function nextStepsForCodes(codes, leadingNote = '') {
    const unique = [...new Set(codes)];
    const capabilityOnly = unique.length > 0 && unique.every((code) => refusalClassOf(code) === 'capability');
    const actions = [...new Set(unique.map(nextStepAction))];
    const hasLimit = unique.some((code) => refusalClassOf(code) === 'limit');
    const note = capabilityOnly ? CAPABILITY_NEXT_STEPS_NOTE : BLOCKED_NEXT_STEPS_NOTE + (hasLimit ? LIMIT_NEXT_STEPS_NOTE : '');
    return { blocked_by: unique.slice(0, MAX_BLOCKED_CODES), actions: capabilityOnly ? [...actions, 'custom_script'] : actions, note: leadingNote === '' ? note : `${leadingNote} ${note}` };
}
export class GuidedRefusalError extends Error {
    reason;
    constructor(reason, message) {
        super(message);
        this.reason = reason;
    }
    nextSteps() { return nextStepsForCodes([this.reason], this.message); }
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function planBlockerCodes(plan) {
    const blockers = plan.applyBlockedReasonCodes ?? plan.blockers;
    if (!Array.isArray(blockers))
        return [];
    const codes = blockers.map((blocker) => (typeof blocker === 'string' ? blocker : isRecord(blocker) ? blocker.code : undefined));
    return codes.filter((code) => typeof code === 'string' && code.length > 0);
}
const UNSAVED_DOCUMENT_CODES = new Set(['document_not_saved', 'document_mutation_not_allowed']);
export function buildBlockedNextSteps(response) {
    if (!isRecord(response) || !isRecord(response.outcome))
        return undefined;
    const { outcome } = response;
    if (outcome.applied !== false || !isRecord(outcome.plan))
        return undefined;
    const codes = planBlockerCodes(outcome.plan);
    if (codes.length === 0)
        return undefined;
    const unsaved = codes.some((code) => UNSAVED_DOCUMENT_CODES.has(code));
    const snapshotSizeNote = codes.includes('result_too_large') &&
        ['mutate_batch', 'replace_point_text_batch', 'set_no_break', 'create_batch'].includes(String(outcome.plan.operation))
        ? `The estimated stored result exceeds ${SNAPSHOT_RESULT_ADMISSION_BYTES} bytes. Ask the user to choose a smaller batch or a change to frame/group structure or typography, then create a new plan. Splitting only a text range retains the whole frame evidence. 小さいバッチへの分割、枠・グループ構造や書式の変更は利用者に選んでもらい、改めて plan を作ってください。範囲だけを分けても枠全体の証拠は減りません。` : '';
    const batchFit = codes.includes('result_too_large') && outcome.plan.operation === 'mutate_batch' && Array.isArray(outcome.plan.steps) && typeof outcome.plan.documentKey === 'string'
        ? ` ${batchResultFitMessage(batchResultFit(outcome.plan.documentKey, outcome.plan.steps))}` : '';
    const sizeNote = (snapshotSizeNote ? `${snapshotSizeNote}${batchFit}` : '') || (codes.includes('result_too_large') && isRecord(outcome.plan.before) && isRecord(outcome.plan.after)
        && typeof outcome.plan.before.contents === 'string' && typeof outcome.plan.after.contents === 'string'
        ? textResultSizeMessage(outcome.plan, recordedRunsTextResultBytes(outcome.plan)) : '');
    return nextStepsForCodes(codes, [unsaved ? UNSAVED_NEXT_STEPS_NOTE : '', sizeNote, codes.includes('selection_unrecordable') ? SELECTION_UNRECORDABLE_NOTE : ''].filter(Boolean).join(' '));
}
export const EMPTY_COMPOUND_NEXT_STEPS_NOTE = 'The backup failed: the open document holds empty compound paths (listed in result.cause.items '
    + 'with their layer and position) that Illustrator does not write to the file, so the saved file already lacks them. '
    + 'Tell the user; the usual remedy is to close the document without saving and reopen it from its file, then create the backup again. '
    + 'Do not delete them or edit the file through GUI automation or a custom script. '
    + 'バックアップは失敗しました。開いている文書に、Illustrator がファイルに書き出さない空の複合パス（result.cause.items にレイヤーと位置）があり、'
    + '保存済みのファイルには既にありません。利用者に伝え、保存せずに閉じてファイルから開き直してから、もう一度バックアップを作るよう案内してください。';
export const AREA_TEXT_OPTIONS_NEXT_STEPS_NOTE = 'The backup failed: the column settings of the area text frames listed in result.cause.items '
    + '(with their layer and position) are in the open document but not in its saved file, because Illustrator does not treat that change '
    + 'as unsaved, so a save skipped it. Tell the user; how to get the change into the file is the user\'s decision. '
    + 'Do not close the document without saving (the change would be lost), and do not work around this through GUI automation or a custom script. '
    + 'バックアップは失敗しました。result.cause.items のエリア内文字（レイヤーと位置）の段組の設定は、開いている文書にはありますが保存済みのファイルにはありません。'
    + 'Illustrator がこの変更を未保存として扱わないため、保存で書き出されませんでした。利用者に伝え、ファイルに入れる方法は利用者の判断に委ねてください。'
    + '保存せずに閉じると変更は失われます。GUI の自動操作や独自のスクリプトで回避しないでください。';
export function buildBackupNextSteps(result) {
    if (!isRecord(result) || result.outcome !== 'failed' || !isRecord(result.cause) || typeof result.cause.code !== 'string')
        return undefined;
    const note = result.cause.code === 'area_text_options_not_in_file' ? AREA_TEXT_OPTIONS_NEXT_STEPS_NOTE : EMPTY_COMPOUND_NEXT_STEPS_NOTE;
    return { blocked_by: [result.cause.code], actions: ['resolve_document_state'], note };
}
