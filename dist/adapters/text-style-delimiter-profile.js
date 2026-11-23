import { z } from 'zod';
import { canonicalSha256 } from '../mutation-canonical.js';
import { GuidedRefusalError } from '../blocked-guidance.js';
import { RECORDED_MULTILINE_PROFILE, recordedStyleDelimiterSchema } from './text-recorded-multiline-profile.js';
export const TEXT_DELIMITER_REASONS = [
    'text_delimiter_attributes_mismatch', 'text_delimiter_range_not_uniform',
    'text_delimiter_attributes_unreadable', 'text_delimiter_profile_unmeasured',
];
export const delimiterEffectSchema = z.strictObject({
    offset: z.number().int().nonnegative(), kind: z.enum(['paragraph_break', 'line_break']),
    fields: z.array(z.enum(['font', 'size', 'tracking', 'horizontalScale', 'verticalScale', 'leading', 'fillColor', 'tsume'])).max(8),
    before: recordedStyleDelimiterSchema, after: recordedStyleDelimiterSchema,
});
export function textDelimiterRefusal(detail) {
    if (detail?.code !== 'TEXT_STYLE_DELIMITER_REFUSED')
        return null;
    const reason = TEXT_DELIMITER_REASONS.find(value => value === detail.reason) ?? 'text_delimiter_attributes_unreadable';
    return new GuidedRefusalError(reason, detail.message ?? 'The delimiter attributes cannot be read; their restoration is unmeasured.');
}
const same = (a, b) => canonicalSha256(a) === canonicalSha256(b);
const attributes = (entry) => Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'contents' && key !== 'kind'));
export function delimiterPlanError(plan) {
    const boundary = plan.before.profile === RECORDED_MULTILINE_PROFILE && /[\r\u0003]/u.test(plan.before.contents.charAt(plan.end));
    if (!boundary)
        return plan.delimiterEffect === undefined ? null : 'A delimiter effect belongs only to the delimiter immediately after a recorded style range.';
    const effect = plan.delimiterEffect, before = plan.before.characters[plan.end], after = plan.after.characters[plan.end];
    if (!effect || !before || !after || plan.start >= plan.end)
        return 'A delimiter-adjacent style range must report its exact delimiter effect.';
    if (plan.start > 0 && /[\r\u0003]/u.test(plan.before.contents.charAt(plan.start - 1)))
        return 'A range beginning immediately after a delimiter has no measured delimiter inverse.';
    for (let index = plan.start; index < plan.end; index += 1) {
        if (!same(attributes(plan.before.characters[index]), attributes(before)))
            return 'Every range character and the following delimiter must share all recorded attributes.';
    }
    if (!same(attributes(after), attributes(plan.after.characters[plan.end - 1])))
        return 'The delimiter after must copy the last range character after.';
    const changed = Object.keys(attributes(before)).filter(key => !same(before[key], after[key])).sort();
    if (effect.offset !== plan.end || effect.kind !== before.kind || !same(effect.before, before) || !same(effect.after, after) || !same(effect.fields, changed)) {
        return 'The delimiter effect must report the exact offset, kind, changed fields and before/after records.';
    }
    return null;
}
export const TEXT_STYLE_DELIMITER_SCRIPT = String.raw `
function styleDelimiterRefuse(reason, offset, message) {
  throw mutationError("preflight_failed", stringifyJson({ code: "TEXT_STYLE_DELIMITER_REFUSED", reason: reason,
    message: "Delimiter at offset " + offset + ": " + message }));
}
function styleDelimiterSnapshot(document, target, expectedUuid) {
  var snapshot = recordedMultilineSnapshot(document, target, expectedUuid), tables = RECORDED_MULTILINE_TABLES.latest[expectedUuid];
  var characters = target.textRange.characters, index, value, character, read;
  for (index = 0; index < snapshot.contents.length; index++) {
    value = snapshot.contents.charAt(index);
    if (value !== "\r" && value !== "\x03") continue;
    try { character = characters[index]; read = styleV3Character(character, true); }
    catch (readError) { styleDelimiterRefuse("text_delimiter_attributes_unreadable", index, "the character attributes cannot be read; a complete inverse is unmeasured."); }
    if (read.entry.contents !== value) styleDelimiterRefuse("text_delimiter_attributes_unreadable", index, "the retained character does not match the contents unit.");
    read.entry.kind = value === "\r" ? "paragraph_break" : "line_break";
    snapshot.characters[index] = read.entry; tables.rows[index] = read.row;
    if (read.manual) snapshot.manualKerning = "present";
  }
  snapshot.attributeRecord = recordedMultilineRecord(tables.rows, tables.paragraphs, tables.frame);
  return snapshot;
}
function styleDelimiterBoundary(before) {
  if (!before || before.profile !== RECORDED_MULTILINE_PROFILE) return false;
  var value = before.contents.charAt(params.end);
  return value === "\r" || value === "\x03";
}
function styleDelimiterAttributes(entry) {
  var copy = styleV3Copy(entry); delete copy.contents; delete copy.kind; return copy;
}
function styleDelimiterSame(left, right) { return pointTextCanonicalJson(left) === pointTextCanonicalJson(right); }
function styleDelimiterAssert(before) {
  if (!styleDelimiterBoundary(before)) return;
  if (params.start > 0 && recordedMultilineHasBreak(before.contents.charAt(params.start - 1)))
    styleDelimiterRefuse("text_delimiter_profile_unmeasured", params.end, "the range begins immediately after another delimiter; its complete inverse is unmeasured.");
  var tables = RECORDED_MULTILINE_TABLES.before[before.uuid], first = before.characters[params.start], row = tables.rows[params.start], index;
  for (index = params.start + 1; index < params.end; index++) {
    if (!styleDelimiterSame(styleDelimiterAttributes(first), styleDelimiterAttributes(before.characters[index])) || !styleDelimiterSame(row, tables.rows[index]))
      styleDelimiterRefuse("text_delimiter_range_not_uniform", params.end, "the range characters differ in recorded attributes; changing them also changes the following delimiter and its complete inverse is unmeasured.");
  }
  if (!styleDelimiterSame(styleDelimiterAttributes(first), styleDelimiterAttributes(before.characters[params.end])) || !styleDelimiterSame(row, tables.rows[params.end]))
    styleDelimiterRefuse("text_delimiter_attributes_mismatch", params.end, "the following delimiter has different recorded attributes from the range; changing the range also changes that delimiter and its complete inverse is unmeasured.");
}
function styleDelimiterPredict(before, after) {
  if (!styleDelimiterBoundary(before)) return after;
  var delimiter = styleV3Copy(after.characters[params.end - 1]);
  delimiter.contents = before.characters[params.end].contents; delimiter.kind = before.characters[params.end].kind;
  after.characters[params.end] = delimiter; return after;
}
function styleDelimiterEffect(plan) {
  if (!styleDelimiterBoundary(plan.before)) return;
  var before = plan.before.characters[params.end], after = plan.after.characters[params.end], fields = [], key;
  for (key in before) if (before.hasOwnProperty(key) && key !== "contents" && key !== "kind" && !styleDelimiterSame(before[key], after[key])) fields.push(key);
  fields.sort(); plan.delimiterEffect = { offset: params.end, kind: before.kind, fields: fields, before: before, after: after };
}
function styleDelimiterVerify(before, actual) {
  if (!styleDelimiterBoundary(before)) return true;
  var rows = RECORDED_MULTILINE_TABLES.latest[before.uuid].rows;
  return styleDelimiterSame(styleDelimiterAttributes(actual.characters[params.end]), styleDelimiterAttributes(actual.characters[params.end - 1])) &&
    styleDelimiterSame(rows[params.end], rows[params.end - 1]);
}
function styleDelimiterRestored(before) {
  if (!styleDelimiterBoundary(before)) return true;
  return styleDelimiterSame(RECORDED_MULTILINE_TABLES.before[before.uuid].rows[params.end], RECORDED_MULTILINE_TABLES.latest[before.uuid].rows[params.end]);
}
`;
