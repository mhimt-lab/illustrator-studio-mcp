import { TEXT_RESULT_SIZE_SCRIPT } from './text-result-size.js';
import { z } from 'zod';
import { canonicalSha256 } from '../mutation-canonical.js';
import { POINT_TEXT_MAX_CODE_UNITS, POINT_TEXT_PROFILES, pointTextCharacterSchema, pointTextFrameSchema, pointTextRangeGroupSnapshotSchema } from './point-text-host-script.js';
import { POINT_TEXT_MULTILINE_MAX_PARAGRAPHS, splitBreakUnits, pointTextMultilineRangeGroupSnapshotSchema, pointTextParagraphBreakSchema } from './point-text-multiline.js';
import { attributeRecordSchema, RECORDED_ADMITTED_STYLE_FIELDS, RECORDED_JUSTIFICATIONS, recordedStrokeSchema } from './text-recorded-profile.js';
import { pointTextAlignedCharacterSchema, setTextStyleSnapshotSchema } from './text-alignment-profile.js';
import { validateClusterRange } from './point-text-cluster.js';
import { GuidedRefusalError } from '../blocked-guidance.js';
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
export const recordedStyleDelimiterSchema = pointTextAlignedCharacterSchema.extend({
    contents: z.enum(['\r', '\u0003']), kind: z.enum(['paragraph_break', 'line_break']), autoLeading: z.boolean(),
});
const sharedShape = {
    profile: z.enum([...POINT_TEXT_PROFILES, 'recorded_point_text_v3', RECORDED_MULTILINE_PROFILE]),
    contents: contentsSchema,
    manualKerning: z.enum(['none', 'present']), tabStopCount: z.number().int().nonnegative(),
    justification: z.enum(RECORDED_JUSTIFICATIONS),
    frame: pointTextFrameSchema.extend({ tagCount: z.number().int().nonnegative() }),
    attributeRecord: attributeRecordSchema.optional(),
    layoutBounds: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]).nullable().optional(),
};
export const EMPTY_PARAGRAPH_REFUSAL_CODE = 'EMPTY_PARAGRAPH_REFUSED';
export const EMPTY_PARAGRAPH_REFUSAL_REASON = 'empty_paragraph_structure_unsupported';
export function emptyParagraphRefusal(detail) {
    if (detail?.code !== EMPTY_PARAGRAPH_REFUSAL_CODE)
        return null;
    return new GuidedRefusalError(detail.reason ?? EMPTY_PARAGRAPH_REFUSAL_REASON, detail.message ?? 'The frame holds an empty host paragraph item outside the measured set.');
}
export function emptyUnitsOf(contents) {
    const units = splitBreakUnits(contents);
    return units.flatMap((unit, index) => (unit.start === unit.end ? [{ index, offset: unit.start, form: (index === units.length - 1 ? 'item_unreadable' : 'attrs_unreadable') }] : []));
}
export const hasAdjacentEmptyUnits = (contents) => emptyUnitsOf(contents).some((empty, at, all) => at > 0 && all[at - 1].index === empty.index - 1);
export function emptyStructureDetail(empties) {
    return 'the frame holds empty host paragraph items: ' + empties.map(empty => `unit ${empty.index} at offset ${empty.offset} (${empty.form}, Error ${empty.form === 'item_unreadable' ? 1302 : 1220})`).join('; ')
        + '. The cause is the frame structure, not the requested range. Supported: ordinary characters inside one non-empty unit, no CR or U+0003 in the range or the replacement, no two adjacent empty items; edit anything else with your own script outside this server.';
}
const emptyMask = (contents) => splitBreakUnits(contents).map(unit => (unit.start === unit.end ? '1' : '0')).join('');
function refineRecordedBreakSnapshot(snapshot, context, style = false) {
    const units = splitBreakUnits(snapshot.contents);
    if (units.length > POINT_TEXT_MULTILINE_MAX_PARAGRAPHS) {
        context.addIssue({ code: 'custom', message: 'Recorded multiline text needs 1 to 32 host paragraph items.' });
    }
    if (hasAdjacentEmptyUnits(snapshot.contents) || units.every(unit => unit.start === unit.end)) {
        context.addIssue({ code: 'custom', message: 'Recorded multiline text admits an empty host paragraph item only between, before or after ordinary items, never two next to each other.' });
    }
    if (snapshot.attributeRecord === undefined || snapshot.layoutBounds === undefined || snapshot.paragraphLeading !== undefined) {
        context.addIssue({ code: 'custom', message: 'Recorded multiline text records the attribute tables and bounds, without paragraph_style.' });
    }
    if (snapshot.characters.length !== snapshot.contents.length) {
        context.addIssue({ code: 'custom', message: 'A snapshot needs one entry per UTF-16 unit.' });
        return;
    }
    const ordinary = snapshot.characters.filter(entry => style || !isBreakEntry(entry));
    const tsumeRecorded = ordinary.filter(entry => entry.tsume !== undefined).length;
    if (tsumeRecorded !== 0 && tsumeRecorded !== ordinary.length) {
        context.addIssue({ code: 'custom', message: style ? 'Tsume is recorded for every style snapshot unit, including delimiters, or for none.' : 'Tsume is recorded for every ordinary character of a recorded snapshot or for none.' });
    }
    for (let index = 0; index < snapshot.contents.length; index += 1) {
        const entry = snapshot.characters[index], value = snapshot.contents.charAt(index);
        const kind = value === '\r' ? 'paragraph_break' : value === '\u0003' ? 'line_break' : undefined;
        if (entry.contents !== value || entry.kind !== kind || ((style || kind === undefined) && (entry.autoLeading === undefined || entry.alignment !== undefined))) {
            context.addIssue({ code: 'custom', message: style ? 'CR and U+0003 need distinct kinds and actual attributes; every unit records auto leading.' : 'CR and U+0003 need distinct sentinels; every ordinary character records auto leading and its exact unit.' });
            return;
        }
    }
}
export const rangeEditSnapshotSchema = z.strictObject({ ...pointTextRangeGroupSnapshotSchema.shape, ...sharedShape,
    profile: z.enum([...POINT_TEXT_PROFILES, RECORDED_MULTILINE_PROFILE]),
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
export const batchStylePlanSnapshotSchema = z.strictObject({ ...setTextStyleSnapshotSchema.shape, ...sharedShape,
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
export const multilineStyleSnapshotSchema = z.strictObject({ ...batchStylePlanSnapshotSchema.shape,
    characters: z.array(z.union([pointTextAlignedCharacterSchema, recordedStyleDelimiterSchema, pointTextParagraphBreakSchema, pointTextLineBreakSchema])).min(1).max(POINT_TEXT_MAX_CODE_UNITS),
}).superRefine((snapshot, context) => {
    if (snapshot.profile === RECORDED_MULTILINE_PROFILE)
        refineRecordedBreakSnapshot(snapshot, context, true);
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
export function checkRecordedMultilineReplacement(before, start, end, replacement, recorded = false) {
    if (!recorded && !hasBreakUnits(before.contents) && !hasBreakUnits(replacement))
        return null;
    const crossing = checkBreakRange(before.contents, start, end);
    if (crossing)
        return crossing;
    const empties = emptyUnitsOf(before.contents);
    const structure = empties.length > 0 ? { emptyUnits: empties, detail: emptyStructureDetail(empties) } : {};
    if (hasBreakUnits(replacement)) {
        if (replacement !== '\r' && replacement !== '\u0003' || end - start !== 1)
            return { reason: 'paragraph_split_unsupported' };
        if (empties.length > 0)
            return { reason: 'paragraph_split_unsupported', ...structure };
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
    const afterMask = emptyMask(before.contents.slice(0, start) + replacement + before.contents.slice(end));
    if (empties.length > 0 ? afterMask !== emptyMask(before.contents) : afterMask.includes('1'))
        return { reason: 'paragraph_edge_unsupported', ...structure };
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
/* #935: an empty item is a unit of its own ({empty:true}); only two adjacent empty items are refused here. Which empty items a frame holds is part of every message.
   A refusal the frame's structure causes is thrown as {code, reason, message} so the adapter answers it with its code and next steps (a capability: a client's own script may go on). */
function recordedMultilineStructureRefusal(message) {
  throw mutationError("preflight_failed", stringifyJson({ code: ${JSON.stringify(EMPTY_PARAGRAPH_REFUSAL_CODE)}, reason: ${JSON.stringify(EMPTY_PARAGRAPH_REFUSAL_REASON)}, message: message }));
}
function recordedMultilineEmptyDetail(units) {
  var parts = [], index;
  for (index = 0; index < units.length; index++) if (units[index].empty) parts.push("unit " + index + " at offset " + units[index].start + (index === units.length - 1 ? " (item_unreadable, Error 1302)" : " (attrs_unreadable, Error 1220)"));
  return (parts.length ? "the frame holds empty host paragraph items: " + parts.join("; ") : "the frame holds no empty host paragraph item") +
    ". The cause is the frame structure, not the requested range. Supported: ordinary characters inside one non-empty unit, no CR or U+0003 in the range or the replacement, no two adjacent empty items; edit anything else with your own script outside this server.";
}
function recordedMultilineUnits(text) {
  var units = [], start = 0, index;
  for (index = 0; index <= text.length; index++) {
    if (index !== text.length && text.charAt(index) !== "\r" && text.charAt(index) !== "\x03") continue;
    units.push({ start: start, end: index, empty: start === index }); start = index + 1;
  }
  if (units.length > POINT_TEXT_MULTILINE_MAX_PARAGRAPHS) throw mutationError("preflight_failed", "too_many_paragraphs: at most 32 host paragraph items.");
  for (index = 1; index < units.length; index++) {
    if (units[index].empty && units[index - 1].empty) recordedMultilineStructureRefusal("paragraph_edge_unsupported: empty host paragraph items " + (index - 1) + " and " + index + " (offsets " + units[index - 1].start + " and " + units[index].start + ") are adjacent; " + recordedMultilineEmptyDetail(units));
  }
  return units;
}
/* The measured forms of an empty item (#935 F0, 30.8.2) and nothing else: the last item cannot be taken (Error 1302); any other reads start === end with every attribute throwing 1220. */
function recordedMultilineErrorNumber(error) { return error && typeof error.number === "number" ? error.number : "x"; }
function recordedMultilineEmptyRow(paragraphs, units, index) {
  var last = index === units.length - 1, item = null, attributes, number, names = STYLE_V3_PARA_NAMES.concat(["justification"]), k, read;
  var refuse = function (what) { recordedMultilineStructureRefusal("paragraph_edge_unsupported: empty host paragraph item " + index + " at offset " + units[index].start + " " + what + "; only the measured forms are admitted. " + recordedMultilineEmptyDetail(units)); };
  try { item = paragraphs[index]; }
  catch (itemError) {
    number = recordedMultilineErrorNumber(itemError);
    if (last && number === 1302) return ["empty", "item_unreadable", "1302"];
    refuse("cannot be taken (error " + number + ")");
  }
  if (last) refuse("is readable, but the trailing empty item is measured as unreadable (Error 1302)");
  if (item.start !== units[index].start || item.end !== units[index].end) refuse("reads offsets " + item.start + "-" + item.end);
  try { attributes = item.paragraphAttributes; } catch (attributesError) { refuse("has no attribute object (error " + recordedMultilineErrorNumber(attributesError) + ")"); }
  for (k = 0; k < names.length; k++) {
    try { read = attributes[names[k]]; refuse("reads " + names[k] + " without an error"); }
    catch (readError) {
      if (readError && readError.mutationReasonCode) throw readError;
      number = recordedMultilineErrorNumber(readError);
      if (number !== 1220) refuse("reads " + names[k] + " with error " + number + " (only 1220 is measured)");
    }
  }
  return ["empty", "attrs_unreadable", "1220"];
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
    if (units[index].empty) { paraRows.push(recordedMultilineEmptyRow(paragraphs, units, index)); continue; }
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
  var beforeUnits = recordedMultilineUnits(before.contents), hasEmpty = false, at;
  for (at = 0; at < beforeUnits.length; at++) if (beforeUnits[at].empty) hasEmpty = true;
  if (recordedMultilineHasBreak(replacement)) {
    if ((replacement !== "\r" && replacement !== "\x03") || end - start !== 1) throw mutationError("preflight_failed", "paragraph_split_unsupported: replace exactly one ordinary unit with one CR or U+0003.");
    if (hasEmpty) recordedMultilineStructureRefusal("paragraph_split_unsupported: a split next to an empty host paragraph item is unmeasured; " + recordedMultilineEmptyDetail(beforeUnits));
    if (start === 0 || end >= before.contents.length || recordedMultilineHasBreak(before.contents.charAt(start - 1) + before.contents.charAt(end))) throw mutationError("preflight_failed", "paragraph_edge_unsupported: a split needs ordinary text on both sides.");
  }
  var tables = RECORDED_MULTILINE_TABLES.before[before.uuid], first = tables.rows[start].join("\u0001"), index;
  for (index = start + 1; index < end; index++) if (tables.rows[index].join("\u0001") !== first) throw mutationError("preflight_failed", "range_style_not_uniform: recorded character attributes differ inside the range.");
  if (!replacement.length) {
    if (start > 0 && !pointTextMultilineBoundary(before.contents, start - 1)) throw mutationError("preflight_failed", "Deletion inverse would rewrite part of a character.");
    if (start === 0 || recordedMultilineHasBreak(before.contents.charAt(start - 1)) ||
        rangeStyleKey(before.characters[start - 1]) !== rangeStyleKey(before.characters[start]) || tables.rows[start - 1].join("\u0001") !== first) throw mutationError("preflight_failed", "paragraph_edge_unsupported: deletion needs an unchanged same-style left neighbour.");
  }
  // The empty items stay where they are: an edit may neither empty an item nor fill one.
  var afterUnits = recordedMultilineUnits(before.contents.substring(0, start) + replacement + before.contents.substring(end));
  for (at = 0; at < afterUnits.length; at++) {
    // A split (a frame without empty items) adds an item; every other edit keeps the item count and the empty positions.
    if (hasEmpty ? afterUnits.length !== beforeUnits.length || afterUnits[at].empty !== beforeUnits[at].empty : afterUnits[at].empty) {
      var emptied = "paragraph_edge_unsupported: the edit would " + (afterUnits[at] && afterUnits[at].empty ? "empty" : "fill") + " host paragraph item " + at + "; " + recordedMultilineEmptyDetail(beforeUnits);
      if (hasEmpty) recordedMultilineStructureRefusal(emptied);
      throw mutationError("preflight_failed", emptied);
    }
  }
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
  for (var key in style) if (style.hasOwnProperty(key) && style[key] !== undefined && !styleV3Admitted(key)) throw mutationError("preflight_failed", "multiline_style_unsupported: " + key + " is outside the measured character fields.");
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
    if (params.style.tsume !== undefined) next.tsume = params.style.tsume;
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
    if (params.style.tsume !== undefined) attributes.Tsume = source.tsume;
    if (params.style.fillColor !== undefined) attributes.fillColor = pointTextNativeFillColor(source.fillColor);
    if (params.style.fontPostScriptName !== undefined) attributes.textFont = app.textFonts.getByName(source.font.postScriptName);
  }
}
`;
