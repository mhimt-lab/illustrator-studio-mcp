import { TEXT_RESULT_SIZE_SCRIPT } from './text-result-size.js';
import { z } from 'zod';
import { canonicalSha256 } from '../mutation-canonical.js';
import { POINT_TEXT_MAX_CODE_UNITS, pointTextCharacterSchema, pointTextFrameSchema, pointTextRangeGroupSnapshotSchema } from './point-text-host-script.js';
import { POINT_TEXT_MULTILINE_MAX_PARAGRAPHS, splitBreakUnits, pointTextMultilineRangeGroupSnapshotSchema, pointTextParagraphBreakSchema } from './point-text-multiline.js';
import { attributeRecordSchema, RECORDED_ADMITTED_STYLE_FIELDS, RECORDED_JUSTIFICATIONS, recordedStrokeSchema } from './text-recorded-profile.js';
import { pointTextAlignedCharacterSchema, setTextStyleSnapshotSchema } from './text-alignment-profile.js';
import { validateClusterRange } from './point-text-cluster.js';
export const RECORDED_MULTILINE_PROFILE = 'recorded_multiline_point_text_v1';
export const pointTextLineBreakSchema = z.strictObject({ contents: z.literal('\u0003'), kind: z.literal('line_break') });
export function isBreakEntry(entry) {
    return entry.kind === 'paragraph_break' || entry.kind === 'line_break';
}
export const hasBreakUnits = (text) => /[\r\u0003]/u.test(text);
export { splitBreakUnits } from './point-text-multiline.js';
export const recordedBreakReplacementSchema = z.string().max(POINT_TEXT_MAX_CODE_UNITS).regex(/^(?:[^\r\n\u0003]*|\r|\u0003)$/u);
const contentsSchema = z.string().min(1).max(POINT_TEXT_MAX_CODE_UNITS).regex(/^[^\n]+$/u);
const recordedCharacterSchema = pointTextCharacterSchema.extend({ autoLeading: z.boolean().optional(), strokeColor: recordedStrokeSchema });
const sharedShape = {
    profile: z.enum(['plain_point_text_v2', 'recorded_point_text_v3', RECORDED_MULTILINE_PROFILE]),
    contents: contentsSchema,
    manualKerning: z.enum(['none', 'present']), tabStopCount: z.number().int().nonnegative(),
    justification: z.enum(RECORDED_JUSTIFICATIONS),
    frame: pointTextFrameSchema.extend({ tagCount: z.number().int().nonnegative() }),
    attributeRecord: attributeRecordSchema.optional(),
    layoutBounds: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]).nullable().optional(),
};
function refineRecordedBreakSnapshot(snapshot, context) {
    const units = splitBreakUnits(snapshot.contents);
    if (units.length > POINT_TEXT_MULTILINE_MAX_PARAGRAPHS || units.some(unit => unit.start === unit.end)) {
        context.addIssue({ code: 'custom', message: 'Recorded multiline text needs 1 to 32 non-empty host paragraph items.' });
    }
    if (snapshot.attributeRecord === undefined || snapshot.layoutBounds === undefined || snapshot.paragraphLeading !== undefined) {
        context.addIssue({ code: 'custom', message: 'Recorded multiline text records the attribute tables and bounds, without paragraph_style.' });
    }
    if (snapshot.characters.length !== snapshot.contents.length) {
        context.addIssue({ code: 'custom', message: 'A snapshot needs one entry per UTF-16 unit.' });
        return;
    }
    for (let index = 0; index < snapshot.contents.length; index += 1) {
        const entry = snapshot.characters[index], value = snapshot.contents.charAt(index);
        const kind = value === '\r' ? 'paragraph_break' : value === '\u0003' ? 'line_break' : undefined;
        if (entry.contents !== value || entry.kind !== kind || (kind === undefined && (entry.autoLeading === undefined || entry.alignment !== undefined))) {
            context.addIssue({ code: 'custom', message: 'CR and U+0003 need distinct sentinels; every ordinary character records auto leading and its exact unit.' });
            return;
        }
    }
}
export const rangeEditSnapshotSchema = z.strictObject({ ...pointTextRangeGroupSnapshotSchema.shape, ...sharedShape,
    profile: z.enum(['plain_point_text_v2', RECORDED_MULTILINE_PROFILE]),
    characters: z.array(z.union([recordedCharacterSchema, pointTextParagraphBreakSchema, pointTextLineBreakSchema])).min(1).max(POINT_TEXT_MAX_CODE_UNITS),
}).superRefine((snapshot, context) => {
    if (snapshot.profile === RECORDED_MULTILINE_PROFILE)
        refineRecordedBreakSnapshot(snapshot, context);
    else {
        const old = pointTextMultilineRangeGroupSnapshotSchema.safeParse(snapshot);
        if (!old.success)
            for (const issue of old.error.issues)
                context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    }
});
export const multilineStyleSnapshotSchema = z.strictObject({ ...setTextStyleSnapshotSchema.shape, ...sharedShape,
    characters: z.array(z.union([pointTextAlignedCharacterSchema, pointTextParagraphBreakSchema, pointTextLineBreakSchema])).min(1).max(POINT_TEXT_MAX_CODE_UNITS),
}).superRefine((snapshot, context) => {
    if (snapshot.profile === RECORDED_MULTILINE_PROFILE)
        refineRecordedBreakSnapshot(snapshot, context);
    else {
        const old = setTextStyleSnapshotSchema.safeParse(snapshot);
        if (!old.success)
            for (const issue of old.error.issues)
                context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    }
});
export function checkBreakRange(contents, start, end) {
    const breaks = [];
    for (let index = start; index < end; index += 1) {
        if (contents[index] === '\r' || contents[index] === '\u0003')
            breaks.push({ index, kind: contents[index] === '\r' ? 'cr' : 'line_break' });
    }
    return breaks.length ? { reason: 'range_crosses_paragraph', breaks } : null;
}
export function checkRecordedMultilineReplacement(before, start, end, replacement) {
    if (!hasBreakUnits(before.contents) && !hasBreakUnits(replacement))
        return null;
    const crossing = checkBreakRange(before.contents, start, end);
    if (crossing)
        return crossing;
    if (hasBreakUnits(replacement)) {
        if (replacement !== '\r' && replacement !== '\u0003' || end - start !== 1)
            return { reason: 'paragraph_split_unsupported' };
        if (start === 0 || end >= before.contents.length || hasBreakUnits(before.contents[start - 1] + before.contents[end]))
            return { reason: 'paragraph_edge_unsupported' };
    }
    else if (replacement.length === 0) {
        if (start === 0 || hasBreakUnits(before.contents[start - 1]))
            return { reason: 'paragraph_edge_unsupported' };
        const cluster = validateClusterRange(before.contents, start - 1, end);
        if (cluster)
            return cluster;
        const key = (entry) => canonicalSha256({ ...entry, contents: '' });
        if (key(before.characters[start - 1]) !== key(before.characters[start]))
            return { reason: 'paragraph_edge_unsupported' };
    }
    const units = splitBreakUnits(before.contents.slice(0, start) + replacement + before.contents.slice(end));
    if (units.length > POINT_TEXT_MULTILINE_MAX_PARAGRAPHS)
        return { reason: 'too_many_paragraphs' };
    if (units.some(unit => unit.start === unit.end))
        return { reason: 'paragraph_edge_unsupported' };
    return null;
}
export function checkRecordedMultilineStyle(before, start, end, style) {
    return checkBreakRange(before.contents, start, end) ?? (style && Object.keys(style).some(key => style[key] !== undefined && !RECORDED_ADMITTED_STYLE_FIELDS.includes(key))
        ? { reason: 'multiline_style_unsupported' } : null);
}
export const TEXT_RECORDED_MULTILINE_SCRIPT = TEXT_RESULT_SIZE_SCRIPT + String.raw `
var RECORDED_MULTILINE_PROFILE = ${JSON.stringify(RECORDED_MULTILINE_PROFILE)};
var RECORDED_MULTILINE_TABLES = { before: {}, latest: {} };
function recordedMultilineHasBreak(text) { return text.indexOf("\r") >= 0 || text.indexOf("\x03") >= 0; }
function recordedMultilineSelected(target) {
  return recordedMultilineHasBreak(String(target.contents)) || (params.replacement !== undefined && recordedMultilineHasBreak(params.replacement));
}
function recordedMultilineStyleSelected(target) {
  return params.paragraphStyle === undefined && params.style && params.style.alignment === undefined && recordedMultilineHasBreak(String(target.contents));
}
function recordedMultilineUnits(text) {
  var units = [], start = 0, index;
  for (index = 0; index <= text.length; index++) {
    if (index !== text.length && text.charAt(index) !== "\r" && text.charAt(index) !== "\x03") continue;
    if (start === index) throw mutationError("preflight_failed", "paragraph_edge_unsupported: empty host paragraph item at " + index + ".");
    units.push({ start: start, end: index }); start = index + 1;
  }
  if (units.length > POINT_TEXT_MULTILINE_MAX_PARAGRAPHS) throw mutationError("preflight_failed", "too_many_paragraphs: at most 32 host paragraph items.");
  return units;
}
function recordedMultilineFingerprintText(rows, paragraphs, frame) {
  var text = styleV3FingerprintText(rows, [], frame), joined = [], index;
  for (index = 0; index < paragraphs.length; index++) joined.push(paragraphs[index].join("\u0001"));
  // A separate format; the v3 single-line canonical text and digest stay unchanged.
  return text + "\u0006" + joined.join("\u0005");
}
function recordedMultilineRecord(rows, paragraphs, frame) {
  var count = 0, runs = 0, last = null, index, key;
  for (index = 0; index < rows.length; index++) { count += rows[index].length; key = rows[index].join("\u0001"); if (key !== last) runs++; last = key; }
  for (index = 0; index < paragraphs.length; index++) count += paragraphs[index].length;
  return { fingerprint: styleV3FingerprintOf(recordedMultilineFingerprintText(rows, paragraphs, frame)), characterRuns: runs, recordedCount: count + frame.length };
}
function recordedMultilineSnapshot(document, target, expectedUuid) {
  if (!target || target.typename !== "TextFrame" || target.kind !== TextType.POINTTEXT || target.uuid !== expectedUuid) throw mutationError("preflight_failed", "Target POINTTEXT identity changed.");
  var groups = pointTextGroupAncestry(target), shape = pointTextFrameShape(target);
  if (!target.story || !target.story.textFrames || target.story.textFrames.length !== 1 || target.story.textFrames[0] !== target) throw mutationError("preflight_failed", "Only unthreaded point text is supported.");
  if (typeof target.locked !== "boolean" || typeof target.hidden !== "boolean" || typeof target.editable !== "boolean" || typeof target.layer.visible !== "boolean" || typeof target.layer.locked !== "boolean") throw mutationError("preflight_failed", "Target safety state is unavailable.");
  var path = pointTextLayerPath(document, target.layer), text = target.contents;
  if (path === null || typeof text !== "string" || !text.length || text.length > POINT_TEXT_MAX_CODE_UNITS || text.indexOf("\n") >= 0) throw mutationError("preflight_failed", "Target contents or layer path is unsupported.");
  var units = recordedMultilineUnits(text), characters = target.textRange.characters, paragraphs = target.paragraphs;
  if (characters.length !== text.length || paragraphs.length !== units.length) throw mutationError("preflight_failed", "Host item count differs from CR/U+0003 positions.");
  var entries = [], rows = [], paraRows = [], manual = false, tabs = 0, justification = null, index, value, read, paragraph;
  for (index = 0; index < text.length; index++) {
    value = text.charAt(index);
    if (value === "\r" || value === "\x03") { entries.push({ contents: value, kind: value === "\r" ? "paragraph_break" : "line_break" }); rows.push([value === "\r" ? "break:cr" : "break:line"]); continue; }
    var character = characters[index];
    read = styleV3Character(character, true);
    if (read.entry.contents.length !== 1 || read.entry.contents.charCodeAt(0) !== text.charCodeAt(index)) throw mutationError("preflight_failed", "Character differs from the contents unit at " + index + ".");
    read.entry.contents = value; entries.push(read.entry); rows.push(read.row); if (read.manual) manual = true;
  }
  for (index = 0; index < units.length; index++) {
    paragraph = paragraphs[index];
    if (paragraph.start !== units[index].start || paragraph.end !== units[index].end) throw mutationError("preflight_failed", "Host paragraph offsets differ from CR/U+0003 positions.");
    read = styleV3Paragraph(paragraph); paraRows.push(read.row); tabs += read.tabStopCount; if (justification === null) justification = read.justification;
  }
  var frame = styleV3Frame(target), tables = { rows: rows, paragraphs: paraRows, frame: frame.row };
  RECORDED_MULTILINE_TABLES.latest[expectedUuid] = tables;
  if (RECORDED_MULTILINE_TABLES.before[expectedUuid] === undefined) RECORDED_MULTILINE_TABLES.before[expectedUuid] = tables;
  return pointTextWithGroups({ uuid: target.uuid, type: target.typename, kind: "TextType.POINTTEXT", profile: RECORDED_MULTILINE_PROFILE,
    frameShape: shape, storyFrameCount: 1, manualKerning: manual ? "present" : "none", tabStopCount: tabs, justification: justification,
    characters: entries, frame: styleV3FrameState(target, frame.tagCount), layerPath: path, layerAncestry: pointTextAncestryWithGroups(target, groups),
    contents: text, locked: target.locked, hidden: target.hidden, editable: target.editable, layerVisible: target.layer.visible, layerLocked: target.layer.locked,
    attributeRecord: recordedMultilineRecord(rows, paraRows, frame.row), layoutBounds: styleV3Bounds(target) }, groups);
}
function recordedMultilineAssertRange(before, start, end) {
  var breaks = [], index, value;
  for (index = start; index < end; index++) { value = before.contents.charAt(index); if (value === "\r" || value === "\x03") breaks.push({ index: index, kind: value === "\r" ? "cr" : "line_break" }); }
  if (breaks.length) throw mutationError("preflight_failed", "range_crosses_paragraph: joining or replacing CR/U+0003 delimiters is unsupported in slice 1; " + stringifyJson(breaks));
}
function recordedMultilineAssertEdit(before, start, end, replacement) {
  recordedMultilineAssertRange(before, start, end);
  if (recordedMultilineHasBreak(replacement)) {
    if ((replacement !== "\r" && replacement !== "\x03") || end - start !== 1) throw mutationError("preflight_failed", "paragraph_split_unsupported: replace exactly one ordinary unit with one CR or U+0003.");
    if (start === 0 || end >= before.contents.length || recordedMultilineHasBreak(before.contents.charAt(start - 1) + before.contents.charAt(end))) throw mutationError("preflight_failed", "paragraph_edge_unsupported: a split needs ordinary text on both sides.");
  }
  var tables = RECORDED_MULTILINE_TABLES.before[before.uuid], first = tables.rows[start].join("\u0001"), index;
  for (index = start + 1; index < end; index++) if (tables.rows[index].join("\u0001") !== first) throw mutationError("preflight_failed", "range_style_not_uniform: recorded character attributes differ inside the range.");
  if (!replacement.length) {
    if (start > 0 && !pointTextMultilineBoundary(before.contents, start - 1)) throw mutationError("preflight_failed", "Deletion inverse would rewrite part of a character.");
    if (start === 0 || recordedMultilineHasBreak(before.contents.charAt(start - 1)) ||
        rangeStyleKey(before.characters[start - 1]) !== rangeStyleKey(before.characters[start]) || tables.rows[start - 1].join("\u0001") !== first) throw mutationError("preflight_failed", "paragraph_edge_unsupported: deletion needs an unchanged same-style left neighbour.");
  }
  recordedMultilineUnits(before.contents.substring(0, start) + replacement + before.contents.substring(end));
}
function recordedMultilinePredictRange(before) {
  var tables = RECORDED_MULTILINE_TABLES.before[before.uuid], after = styleV3Copy(before), rows = [], entries = [], index, next, value;
  for (index = 0; index < params.start; index++) { entries.push(before.characters[index]); rows.push(tables.rows[index]); }
  for (index = 0; index < params.replacement.length; index++) {
    value = params.replacement.charAt(index);
    if (value === "\r" || value === "\x03") { entries.push({ contents: value, kind: value === "\r" ? "paragraph_break" : "line_break" }); rows.push([value === "\r" ? "break:cr" : "break:line"]); }
    else { next = styleV3Copy(before.characters[params.start]); next.contents = value; entries.push(next); rows.push(tables.rows[params.start]); }
  }
  for (index = params.end; index < before.characters.length; index++) { entries.push(before.characters[index]); rows.push(tables.rows[index]); }
  var paragraphs = tables.paragraphs.slice(0), units = recordedMultilineUnits(before.contents);
  if (recordedMultilineHasBreak(params.replacement)) for (index = 0; index < units.length; index++) if (params.start >= units[index].start && params.start < units[index].end) { paragraphs.splice(index, 0, paragraphs[index]); break; }
  after.characters = entries; after.contents = before.contents.substring(0, params.start) + params.replacement + before.contents.substring(params.end);
  after.attributeRecord = recordedMultilineRecord(rows, paragraphs, tables.frame); after.layoutBounds = null;
  return after;
}
function recordedMultilineAssertStyle(before, start, end, style) {
  recordedMultilineAssertRange(before, start, end);
  for (var key in style) if (style.hasOwnProperty(key) && style[key] !== undefined && !styleV3Admitted(key)) throw mutationError("preflight_failed", "multiline_style_unsupported: " + key + " is outside the measured six character fields.");
}
function recordedMultilinePredictStyle(target, before) {
  var units = recordedMultilineUnits(before.contents), amount = 0, index;
  if (params.style.size !== undefined) for (index = 0; index < units.length; index++) if (params.start >= units[index].start && params.start < units[index].end) { var paragraph = target.paragraphs[index]; amount = mutationFiniteNumber(paragraph.paragraphAttributes.autoLeadingAmount, "paragraph.autoLeadingAmount"); break; }
  var after = styleV3Copy(before), characters = [], source, next;
  for (index = 0; index < before.characters.length; index++) {
    source = before.characters[index]; if (index < params.start || index >= params.end) { characters.push(source); continue; }
    next = styleV3Copy(source);
    if (params.style.size !== undefined) { next.size = pointTextCanonicalChannel(params.style.size, "size"); if (source.autoLeading) next.leading = pointTextCanonicalChannel(next.size * amount / 100, "leading"); }
    if (params.style.tracking !== undefined) next.tracking = params.style.tracking;
    if (params.style.horizontalScale !== undefined) next.horizontalScale = params.style.horizontalScale;
    if (params.style.verticalScale !== undefined) next.verticalScale = params.style.verticalScale;
    if (params.style.fillColor !== undefined) next.fillColor = params.style.fillColor;
    if (params.style.fontPostScriptName !== undefined) { var font = styleFont(); next.font = { postScriptName: font.name, family: font.family, style: font.style }; }
    characters.push(next);
  }
  after.characters = characters; after.layoutBounds = null; return after;
}
function recordedMultilineRestoreStyle(target, before) {
  for (var index = params.start; index < params.end; index++) {
    var source = before.characters[index], character = target.textRange.characters[index], attributes = character.characterAttributes;
    if (params.style.size !== undefined) attributes.size = source.size;
    if (params.style.tracking !== undefined) attributes.tracking = source.tracking;
    if (params.style.horizontalScale !== undefined) attributes.horizontalScale = source.horizontalScale;
    if (params.style.verticalScale !== undefined) attributes.verticalScale = source.verticalScale;
    if (params.style.fillColor !== undefined) attributes.fillColor = pointTextNativeFillColor(source.fillColor);
    if (params.style.fontPostScriptName !== undefined) attributes.textFont = app.textFonts.getByName(source.font.postScriptName);
  }
}
`;
