import { z } from 'zod';
export const nextStepActionSchema = z.enum([
    'resolve_document_state',
    'reconcile',
    'unlock_target',
    'show_target',
    'install_font',
    'narrow_scope',
    'unsupported',
    'fix_request',
]);
export const BLOCKED_NEXT_STEPS_NOTE = 'Apply is blocked. Tell the user the blocker codes and these actions and let them decide; '
    + 'do not make the same change through GUI automation or a custom script. '
    + '適用は止まっています。理由と次の手を利用者に伝えて判断を仰ぎ、GUI の自動操作や独自のスクリプトで代わりに変更しないでください。';
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
    return ACTION_RULES.find(([pattern]) => pattern.test(code))?.[1] ?? 'fix_request';
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
export function buildBlockedNextSteps(response) {
    if (!isRecord(response) || !isRecord(response.outcome))
        return undefined;
    const { outcome } = response;
    if (outcome.applied !== false || !isRecord(outcome.plan))
        return undefined;
    const codes = [...new Set(planBlockerCodes(outcome.plan))].slice(0, MAX_BLOCKED_CODES);
    if (codes.length === 0)
        return undefined;
    return { blocked_by: codes, actions: [...new Set(codes.map(nextStepAction))], note: BLOCKED_NEXT_STEPS_NOTE };
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
