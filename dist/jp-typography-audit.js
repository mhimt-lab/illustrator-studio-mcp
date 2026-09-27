import { z } from 'zod';
import { documentContextSchema } from './mutation-result-schema-core.js';
export const JP_AUDIT_LIMITS = { frames: 200, characters: 20_000, lines: 2_000, paragraphs: 2_000, targets: 50, findings: 500,
    terms: 100 };
export const JLREQ_CLASS_MEMBERS = {
    'cl-01': [0x2018, 0x201C, 0x0028, 0x3014, 0x005B, 0x007B, 0x3008, 0x300A, 0x300C, 0x300E, 0x3010, 0x2985, 0x3018, 0x3016, 0x00AB, 0x301D],
    'cl-02': [0x2019, 0x201D, 0x0029, 0x3015, 0x005D, 0x007D, 0x3009, 0x300B, 0x300D, 0x300F, 0x3011, 0x2986, 0x3019, 0x3017, 0x00BB, 0x301F],
    'cl-03': [0x2010, 0x301C, 0x30A0, 0x2013],
    'cl-04': [0x0021, 0x003F, 0x203C, 0x2047, 0x2048, 0x2049],
    'cl-05': [0x30FB, 0x003A, 0x003B],
    'cl-06': [0x3002, 0x002E],
    'cl-07': [0x3001, 0x002C],
    'cl-08': [0x2014, 0x2026, 0x2025, 0x3033, 0x3034, 0x3035],
    'cl-09': [0x30FD, 0x30FE, 0x309D, 0x309E, 0x3005, 0x303B],
    'cl-10': [0x30FC],
    'cl-11': [0x3041, 0x3043, 0x3045, 0x3047, 0x3049, 0x30A1, 0x30A3, 0x30A5, 0x30A7, 0x30A9, 0x3063, 0x3083, 0x3085, 0x3087,
        0x308E, 0x3095, 0x3096, 0x30C3, 0x30E3, 0x30E5, 0x30E7, 0x30EE, 0x30F5, 0x30F6, 0x31F0, 0x31F1, 0x31F2, 0x31F3, 0x31F4,
        0x31F5, 0x31F6, 0x31F7, 0x31F8, 0x31F9, 0x31FA, 0x31FB, 0x31FC, 0x31FD, 0x31FE, 0x31FF],
    'cl-12': [0x00A5, 0x0024, 0x00A3, 0x0023, 0x20AC, 0x2116],
    'cl-13': [0x00B0, 0x2032, 0x2033, 0x2103, 0x00A2, 0x0025, 0x2030, 0x33CB, 0x2113, 0x3303, 0x330D, 0x3314, 0x3318, 0x3322,
        0x3323, 0x3326, 0x3327, 0x332B, 0x3336, 0x333B, 0x3349, 0x334A, 0x334D, 0x3351, 0x3357, 0x338E, 0x338F, 0x339C, 0x339D,
        0x339E, 0x33A1, 0x33C4],
    'cl-24': [0x0030, 0x0031, 0x0032, 0x0033, 0x0034, 0x0035, 0x0036, 0x0037, 0x0038, 0x0039],
};
const CLASS_OF = new Map();
for (const [name, members] of Object.entries(JLREQ_CLASS_MEMBERS)) {
    for (const codePoint of members)
        CLASS_OF.set(codePoint, name);
}
export function foldFullWidth(codePoint) {
    if (codePoint >= 0xFF01 && codePoint <= 0xFF5E)
        return codePoint - 0xFEE0;
    if (codePoint === 0xFF5F)
        return 0x2985;
    if (codePoint === 0xFF60)
        return 0x2986;
    if (codePoint === 0xFFE0)
        return 0x00A2;
    if (codePoint === 0xFFE1)
        return 0x00A3;
    if (codePoint === 0xFFE5)
        return 0x00A5;
    return codePoint;
}
export function jlreqClassOf(codePoint) {
    return CLASS_OF.get(foldFullWidth(codePoint)) ?? null;
}
const LINE_START_PROHIBITED = new Set(['cl-02', 'cl-03', 'cl-04', 'cl-05', 'cl-06', 'cl-07', 'cl-09', 'cl-10', 'cl-11']);
export const LINE_START_RELAXATIONS = ['iteration_mark', 'prolonged_sound_mark', 'small_kana', 'katakana_middle_dot', 'dividing_punctuation'];
function relaxed(codePoint, relaxations) {
    const folded = foldFullWidth(codePoint);
    if (relaxations.has('iteration_mark') && folded === 0x3005)
        return true;
    if (relaxations.has('prolonged_sound_mark') && folded === 0x30FC)
        return true;
    if (relaxations.has('small_kana') && CLASS_OF.get(folded) === 'cl-11')
        return true;
    if (relaxations.has('katakana_middle_dot') && folded === 0x30FB)
        return true;
    if (relaxations.has('dividing_punctuation') && (folded === 0x003F || folded === 0x0021))
        return true;
    return false;
}
const HALFWIDTH_PUNCTUATION = new Set([0x28, 0x29, 0x5B, 0x5D, 0x7B, 0x7D, 0x21, 0x3F, 0x3A, 0x3B, 0x2E, 0x2C,
    0xFF61, 0xFF62, 0xFF63, 0xFF64, 0xFF65]);
function isJapanese(codePoint) {
    return (codePoint >= 0x3000 && codePoint <= 0x30FF) || (codePoint >= 0x31F0 && codePoint <= 0x31FF) ||
        (codePoint >= 0x3400 && codePoint <= 0x4DBF) || (codePoint >= 0x4E00 && codePoint <= 0x9FFF) ||
        (codePoint >= 0xF900 && codePoint <= 0xFAFF) || (codePoint >= 0xFF01 && codePoint <= 0xFF60) ||
        (codePoint >= 0xFF66 && codePoint <= 0xFF9F) || (codePoint >= 0x20000 && codePoint <= 0x3FFFF);
}
function isDigit(codePoint) {
    return CLASS_OF.get(foldFullWidth(codePoint)) === 'cl-24';
}
function isNumeralSeparator(codePoint) {
    const folded = foldFullWidth(codePoint);
    return folded === 0x2C || folded === 0x2E;
}
const isHigh = (unit) => unit >= 0xD800 && unit <= 0xDBFF;
const isLow = (unit) => unit >= 0xDC00 && unit <= 0xDFFF;
function continuationLengthAt(text, index) {
    const unit = text.charCodeAt(index);
    if ((unit >= 0xFE00 && unit <= 0xFE0F) || unit === 0x3099 || unit === 0x309A)
        return 1;
    if (unit === 0xDB40) {
        const next = text.charCodeAt(index + 1);
        if (next >= 0xDD00 && next <= 0xDDEF)
            return 2;
    }
    return 0;
}
function continuationLengthBefore(text, end) {
    if (end >= 1) {
        const unit = text.charCodeAt(end - 1);
        if ((unit >= 0xFE00 && unit <= 0xFE0F) || unit === 0x3099 || unit === 0x309A)
            return 1;
        if (end >= 2 && unit >= 0xDD00 && unit <= 0xDDEF && text.charCodeAt(end - 2) === 0xDB40)
            return 2;
    }
    return 0;
}
function clusterBefore(text, end) {
    let baseEnd = end;
    for (let unit = continuationLengthBefore(text, baseEnd); unit > 0; unit = continuationLengthBefore(text, baseEnd))
        baseEnd -= unit;
    if (baseEnd <= 0)
        return null;
    const last = text.charCodeAt(baseEnd - 1);
    if (isHigh(last))
        return null;
    if (isLow(last)) {
        if (baseEnd < 2 || !isHigh(text.charCodeAt(baseEnd - 2)))
            return null;
        return { start: baseEnd - 2, end, codePoint: text.codePointAt(baseEnd - 2), text: text.slice(baseEnd - 2, end) };
    }
    return { start: baseEnd - 1, end, codePoint: last, text: text.slice(baseEnd - 1, end) };
}
function clusterAt(text, start) {
    if (start >= text.length)
        return null;
    const first = text.charCodeAt(start);
    if (isLow(first) || continuationLengthAt(text, start) > 0)
        return null;
    let end = start + 1;
    if (isHigh(first)) {
        if (!isLow(text.charCodeAt(start + 1)))
            return null;
        end = start + 2;
    }
    for (let unit = continuationLengthAt(text, end); unit > 0; unit = continuationLengthAt(text, end))
        end += unit;
    return { start, end, codePoint: text.codePointAt(start), text: text.slice(start, end) };
}
function breaksCluster(text, offset) {
    if (offset <= 0 || offset >= text.length)
        return false;
    return (isHigh(text.charCodeAt(offset - 1)) && isLow(text.charCodeAt(offset))) || continuationLengthAt(text, offset) > 0;
}
function isBreakUnit(text, index) {
    const unit = text.charCodeAt(index);
    return unit === 0x0D || unit === 0x0A || unit === 0x03;
}
export const AUDIT_JAPANESE_TYPOGRAPHY_SCRIPT = `
var JP_AUDIT_MAX_FRAMES = ${JP_AUDIT_LIMITS.frames};
var JP_AUDIT_MAX_CHARACTERS = ${JP_AUDIT_LIMITS.characters};
var JP_AUDIT_MAX_LINES = ${JP_AUDIT_LIMITS.lines};
var JP_AUDIT_MAX_PARAGRAPHS = ${JP_AUDIT_LIMITS.paragraphs};

function jpAuditFail(code, detail) {
  detail.code = code;
  throw new Error("MCP_ERROR:" + stringifyJson(detail));
}

function jpAuditFind(document, uuid) {
  if (typeof document.getPageItemFromUuid !== "function") jpAuditFail("JP_AUDIT_UUID_LOOKUP_UNAVAILABLE", { uuid: uuid });
  var target = null;
  try {
    target = document.getPageItemFromUuid(uuid);
  } catch (lookupError) {
    var message = lookupError && lookupError.message ? String(lookupError.message) : "";
    if (!(lookupError && lookupError.name === "Error" && lookupError.number === 1200 &&
        message === "an Illustrator error occurred: 1346458189 ('MRAP')")) throw lookupError;
    target = null;
  }
  if (target === null || target === undefined) jpAuditFail("OBJECT_NOT_FOUND", { uuid: uuid });
  if (String(target.typename) !== "TextFrame") jpAuditFail("JP_AUDIT_TARGET_UNSUPPORTED", { uuid: uuid, actual: String(target.typename) });
  return target;
}

function jpAuditName(frame) {
  var name = "";
  try { name = String(frame.name); } catch (nameError) { name = ""; }
  return name.length > 255 ? name.substring(0, 255) : name;
}

/** "locked_or_hidden", "readable", or "unreadable" from the frame and every ancestor up to the document. */
function jpAuditLockState(frame) {
  if (frame.locked !== false || frame.hidden !== false) return frame.locked === true || frame.hidden === true ? "locked_or_hidden" : "unreadable";
  var node = frame.parent;
  for (var depth = 0; depth < 256; depth++) {
    if (node === null || node === undefined) return "unreadable";
    var typename = String(node.typename);
    if (typename === "Document") return "readable";
    if (typename === "Layer") {
      if (node.visible !== true || node.locked !== false) return node.visible === false || node.locked === true ? "locked_or_hidden" : "unreadable";
    } else {
      if (node.locked !== false || node.hidden !== false) return node.locked === true || node.hidden === true ? "locked_or_hidden" : "unreadable";
    }
    node = node.parent;
  }
  return "unreadable";
}

function jpAuditLines(frame) {
  var collection = frame.lines;
  var count = Number(collection.length);
  var out = [];
  for (var index = 0; index < count; index++) {
    try {
      var line = collection[index];
      out.push({ start: line.start, end: line.end, contents: String(line.contents) });
    } catch (lineError) { out.push({ error: "line_unreadable" }); }
  }
  return out;
}

function jpAuditThrownMessage(error) {
  try { return error && error.message ? String(error.message) : ""; } catch (messageError) { return ""; }
}

/**
 * Two measured exceptions are kept as values, every other failure is paragraph_unreadable: the attributes of a
 * zero-length paragraph throw "Illegal Argument", and after a trailing \\r the last paragraph item throws
 * "No such element". Node checks both against the story and the line ranges.
 */
function jpAuditParagraphs(collection, count, contents) {
  if (collection === null) return null;
  var out = [];
  for (var index = 0; index < count; index++) {
    var paragraph = null;
    try { paragraph = collection[index]; }
    catch (itemError) {
      var trailing = index === count - 1 && contents.charAt(contents.length - 1) === "\\r" &&
        jpAuditThrownMessage(itemError) === "No such element";
      out.push(trailing ? { trailingEmpty: true } : { error: "paragraph_unreadable" });
      continue;
    }
    var start = null;
    var end = null;
    try {
      start = paragraph.start;
      end = paragraph.end;
      var attributes = paragraph.paragraphAttributes;
      out.push({ start: start, end: end, kinsoku: String(attributes.kinsoku),
        mojikumi: String(attributes.mojikumi), burasagariType: String(attributes.burasagariType),
        bunriKinshi: attributes.bunriKinshi, kinsokuOrder: String(attributes.kinsokuOrder) });
    } catch (paragraphError) {
      var empty = typeof start === "number" && start === end && jpAuditThrownMessage(paragraphError) === "Illegal Argument";
      out.push(empty ? { start: start, end: end, empty: true } : { error: "paragraph_unreadable" });
    }
  }
  return out;
}

var jpAuditContext = requireDocumentForRead(params.expectedDocumentKey);
var jpAuditDocument = app.activeDocument;
var jpAuditSavedBefore = jpAuditDocument.saved;
// The whole-document scope is read by index up to the frame limit; frames past it are counted, never enumerated.
var jpAuditAll = null;
var jpAuditTargets = [];
var jpAuditScopeCount;
if (params.targetUuids === null) {
  jpAuditAll = jpAuditDocument.textFrames;
  jpAuditScopeCount = Number(jpAuditAll.length);
} else {
  // Every target is resolved before any text is read, so a missing UUID fails the call without a partial read.
  for (var jpAuditTargetIndex = 0; jpAuditTargetIndex < params.targetUuids.length; jpAuditTargetIndex++) {
    jpAuditTargets.push(jpAuditFind(jpAuditDocument, params.targetUuids[jpAuditTargetIndex]));
  }
  jpAuditScopeCount = jpAuditTargets.length;
}
var jpAuditFrames = [];
var jpAuditSkipped = [];
var jpAuditStop = null;
var jpAuditCharacters = 0;
var jpAuditLineTotal = 0;
var jpAuditParagraphTotal = 0;
for (var jpAuditFrameIndex = 0; jpAuditFrameIndex < jpAuditScopeCount; jpAuditFrameIndex++) {
  if (jpAuditFrameIndex >= JP_AUDIT_MAX_FRAMES) { jpAuditStop = "scan_limit"; break; }
  var jpAuditFrame = jpAuditAll === null ? jpAuditTargets[jpAuditFrameIndex] : jpAuditAll[jpAuditFrameIndex];
  var jpAuditUuid = "";
  try { jpAuditUuid = String(jpAuditFrame.uuid); } catch (jpAuditUuidError) { jpAuditUuid = ""; }
  var jpAuditFrameName = jpAuditName(jpAuditFrame);
  var jpAuditSkip = jpAuditUuid === "" || jpAuditUuid.length > 255 ? "unreadable_frame" : null;
  var jpAuditKind = null;
  var jpAuditOrientation = null;
  try {
    var jpAuditRawKind = jpAuditSkip === null ? jpAuditFrame.kind : null;
    if (jpAuditSkip !== null) jpAuditKind = null;
    else if (jpAuditRawKind === TextType.PATHTEXT) jpAuditSkip = "path_text";
    else if (jpAuditRawKind === TextType.POINTTEXT) jpAuditKind = "point";
    else if (jpAuditRawKind === TextType.AREATEXT) jpAuditKind = "area";
    else jpAuditSkip = "unreadable_frame";
    if (jpAuditSkip === null) {
      var jpAuditLock = jpAuditLockState(jpAuditFrame);
      if (jpAuditLock !== "readable") jpAuditSkip = jpAuditLock === "locked_or_hidden" ? "locked_or_hidden" : "unreadable_frame";
    }
    if (jpAuditSkip === null) {
      var jpAuditStory = jpAuditFrame.story;
      if (!jpAuditStory || !jpAuditStory.textFrames || jpAuditStory.textFrames.length !== 1) jpAuditSkip = "threaded";
    }
    if (jpAuditSkip === null) {
      var jpAuditRawOrientation = String(jpAuditFrame.orientation);
      if (jpAuditRawOrientation === "TextOrientation.HORIZONTAL") jpAuditOrientation = "horizontal";
      else if (jpAuditRawOrientation === "TextOrientation.VERTICAL") jpAuditOrientation = "vertical";
      else jpAuditSkip = "unreadable_frame";
      if (jpAuditSkip === null && jpAuditKind === "point" && jpAuditOrientation === "vertical") jpAuditSkip = "vertical_point_text";
    }
  } catch (jpAuditFrameError) { jpAuditSkip = "unreadable_frame"; }
  if (jpAuditSkip !== null) { jpAuditSkipped.push({ uuid: jpAuditUuid, name: jpAuditFrameName, reason: jpAuditSkip }); continue; }
  var jpAuditContents;
  try { jpAuditContents = String(jpAuditFrame.contents); }
  catch (jpAuditContentsError) { jpAuditSkipped.push({ uuid: jpAuditUuid, name: jpAuditFrameName, reason: "unreadable_frame" }); continue; }
  if (jpAuditContents.length === 0) { jpAuditSkipped.push({ uuid: jpAuditUuid, name: jpAuditFrameName, reason: "empty" }); continue; }
  if (jpAuditCharacters + jpAuditContents.length > JP_AUDIT_MAX_CHARACTERS) { jpAuditStop = "scan_limit"; break; }
  var jpAuditLineCount = -1;
  try { jpAuditLineCount = Number(jpAuditFrame.lines.length); } catch (jpAuditCountError) { jpAuditLineCount = -1; }
  if (jpAuditLineCount > 0 && jpAuditLineTotal + jpAuditLineCount > JP_AUDIT_MAX_LINES) { jpAuditStop = "line_cap"; break; }
  var jpAuditParagraphCollection = null;
  var jpAuditParagraphCount = 0;
  try { jpAuditParagraphCollection = jpAuditFrame.paragraphs; jpAuditParagraphCount = Number(jpAuditParagraphCollection.length); }
  catch (jpAuditParagraphCountError) { jpAuditParagraphCollection = null; }
  if (jpAuditParagraphCollection !== null && jpAuditParagraphTotal + jpAuditParagraphCount > JP_AUDIT_MAX_PARAGRAPHS) {
    jpAuditStop = "paragraph_cap";
    break;
  }
  if (jpAuditParagraphCollection !== null) jpAuditParagraphTotal += jpAuditParagraphCount;
  jpAuditCharacters += jpAuditContents.length;
  var jpAuditLineRecords = null;
  if (jpAuditLineCount >= 0) {
    jpAuditLineTotal += jpAuditLineCount;
    try { jpAuditLineRecords = jpAuditLines(jpAuditFrame); } catch (jpAuditLinesError) { jpAuditLineRecords = null; }
  }
  jpAuditFrames.push({ uuid: jpAuditUuid, name: jpAuditFrameName, kind: jpAuditKind, orientation: jpAuditOrientation,
    contents: jpAuditContents, lines: jpAuditLineRecords,
    paragraphs: jpAuditParagraphs(jpAuditParagraphCollection, jpAuditParagraphCount, jpAuditContents) });
}
var result = { document: jpAuditContext, savedBefore: jpAuditSavedBefore, savedAfter: jpAuditDocument.saved,
  framesInScope: jpAuditScopeCount, stop: jpAuditStop, frames: jpAuditFrames, skipped: jpAuditSkipped };
`;
export const JP_AUDIT_SKIP_REASONS = ['path_text', 'threaded', 'locked_or_hidden', 'vertical_point_text', 'empty', 'unreadable_frame'];
export const JP_AUDIT_INCOMPLETE_REASONS = ['skipped_frames', 'scan_limit', 'line_cap', 'paragraph_cap', 'finding_limit', 'unreadable_line',
    'unreadable_paragraph'];
export const JP_AUDIT_RULES = ['JP_LINE_END_PROHIBITED', 'JP_LINE_START_PROHIBITED', 'JP_UNBREAKABLE_SPLIT',
    'JP_PROTECTED_TERM_SPLIT', 'JP_HALFWIDTH_PUNCTUATION', 'JP_OVERSET'];
const hostOffset = z.number().int().nonnegative();
const skipEntrySchema = z.strictObject({
    uuid: z.string().max(255),
    name: z.string().max(255),
    reason: z.enum(JP_AUDIT_SKIP_REASONS),
});
export const jpAuditHostDataSchema = z.strictObject({
    document: documentContextSchema,
    savedBefore: z.boolean(),
    savedAfter: z.boolean(),
    framesInScope: z.number().int().nonnegative(),
    stop: z.enum(['scan_limit', 'line_cap', 'paragraph_cap']).nullable(),
    frames: z.array(z.strictObject({
        uuid: z.string().max(255),
        name: z.string().max(255),
        kind: z.enum(['point', 'area']),
        orientation: z.enum(['horizontal', 'vertical']),
        contents: z.string().min(1).max(JP_AUDIT_LIMITS.characters),
        lines: z.array(z.union([
            z.strictObject({ start: z.unknown(), end: z.unknown(), contents: z.string() }),
            z.strictObject({ error: z.literal('line_unreadable') }),
        ])).max(JP_AUDIT_LIMITS.lines).nullable(),
        paragraphs: z.array(z.union([
            z.strictObject({ start: z.unknown(), end: z.unknown(), kinsoku: z.string(), mojikumi: z.string(),
                burasagariType: z.string(), bunriKinshi: z.unknown(), kinsokuOrder: z.string() }),
            z.strictObject({ start: z.unknown(), end: z.unknown(), empty: z.literal(true) }),
            z.strictObject({ trailingEmpty: z.literal(true) }),
            z.strictObject({ error: z.literal('paragraph_unreadable') }),
        ])).max(JP_AUDIT_LIMITS.paragraphs).nullable(),
    })).max(JP_AUDIT_LIMITS.frames),
    skipped: z.array(skipEntrySchema).max(JP_AUDIT_LIMITS.frames),
});
export const jpAuditProtectedTermSchema = z.strictObject({ text: z.string().min(1).max(64) });
const currentStateSchema = z.strictObject({
    kinsoku: z.string(),
    mojikumi: z.string(),
    burasagari_type: z.string(),
    bunri_kinshi: z.boolean().nullable(),
    kinsoku_order: z.string(),
});
const findingSchema = z.strictObject({
    rule_id: z.enum(JP_AUDIT_RULES),
    severity: z.enum(['error', 'warning']),
    determinism: z.literal('deterministic'),
    source_class: z.enum(['jlreq', 'adobe', 'house_rule']),
    source_ref: z.string(),
    target: z.strictObject({
        uuid: z.string().max(255),
        name: z.string().max(255),
        kind: z.enum(['point', 'area']),
        orientation: z.enum(['horizontal', 'vertical']),
    }),
    range: z.strictObject({ start: hostOffset, end: hostOffset }),
    line_index: z.number().int().nonnegative().nullable(),
    evidence: z.strictObject({
        line_start: hostOffset.nullable(),
        line_end: hostOffset.nullable(),
        character: z.string().nullable(),
        character_class: z.string().nullable(),
        prev_line_tail: z.string().nullable(),
        next_line_head: z.string().nullable(),
        term: z.string().optional(),
    }),
    current_state: currentStateSchema.nullable(),
    recommendation: z.string(),
    can_auto_fix: z.literal(false),
    required_capability: z.enum(['set_no_break']).nullable(),
});
export const jpAuditResultSchema = z.strictObject({
    status: z.enum(['complete', 'partial']),
    policy: z.strictObject({
        id: z.literal('jp_line_break_v1'),
        line_start_relaxations: z.array(z.enum(LINE_START_RELAXATIONS)),
        halfwidth_punctuation: z.enum(['report', 'ignore']),
        protected_term_count: z.number().int().nonnegative(),
    }),
    document: documentContextSchema,
    coverage: z.strictObject({
        frames_in_scope: z.number().int().nonnegative(),
        frames_audited: z.number().int().nonnegative(),
        frames_skipped: z.array(skipEntrySchema),
    }),
    incomplete: z.array(z.enum(JP_AUDIT_INCOMPLETE_REASONS)),
    findings: z.array(findingSchema).max(JP_AUDIT_LIMITS.findings),
});
const RULE_ORDER = Object.fromEntries(JP_AUDIT_RULES.map((rule, index) => [rule, index]));
const RULE_META = {
    JP_LINE_END_PROHIBITED: { severity: 'error', source_class: 'jlreq', source_ref: 'JLReq 3.1.8', required_capability: null,
        recommendation: 'An opening bracket ends the line. Move it to the next line by changing the frame width, tracking, or text; Illustrator\'s own kinsoku setting for the paragraph is in current_state.' },
    JP_LINE_START_PROHIBITED: { severity: 'error', source_class: 'jlreq', source_ref: 'JLReq 3.1.7', required_capability: null,
        recommendation: 'A character that must not start a line starts it. Keep it with the previous line (push-in or push-out) by changing the frame width, tracking, or text; Illustrator\'s own kinsoku setting for the paragraph is in current_state.' },
    JP_UNBREAKABLE_SPLIT: { severity: 'error', source_class: 'jlreq', source_ref: 'JLReq 3.1.10', required_capability: 'set_no_break',
        recommendation: 'An unbreakable sequence is split across lines. Keep it on one line, for example with no-break on the sequence, then audit again because the following line breaks can move.' },
    JP_PROTECTED_TERM_SPLIT: { severity: 'error', source_class: 'house_rule', source_ref: 'protected_terms', required_capability: 'set_no_break',
        recommendation: 'A protected term is split across lines. Keep it on one line, for example with no-break on the term, then audit again because the following line breaks can move.' },
    JP_HALFWIDTH_PUNCTUATION: { severity: 'warning', source_class: 'house_rule', source_ref: 'halfwidth_punctuation',
        required_capability: null,
        recommendation: 'Half-width punctuation between Japanese characters. Use the full-width form if the house style requires it.' },
    JP_OVERSET: { severity: 'error', source_class: 'adobe', source_ref: 'Illustrator area-text overflow (visible prefix)',
        required_capability: null,
        recommendation: 'Part of the story is not visible. Enlarge the frame or shorten the text; line-break rules are not judged in the hidden part.' },
};
function paragraphStateAt(paragraphs, offset) {
    if (paragraphs === null)
        return null;
    for (const paragraph of paragraphs) {
        if (!('kinsoku' in paragraph))
            continue;
        if (typeof paragraph.start !== 'number' || typeof paragraph.end !== 'number')
            continue;
        if (paragraph.start <= offset && offset < paragraph.end) {
            return { kinsoku: paragraph.kinsoku, mojikumi: paragraph.mojikumi, burasagari_type: paragraph.burasagariType,
                bunri_kinshi: typeof paragraph.bunriKinshi === 'boolean' ? paragraph.bunriKinshi : null,
                kinsoku_order: paragraph.kinsokuOrder };
        }
    }
    return null;
}
function paragraphsReadable(frame) {
    const { paragraphs, contents } = frame;
    if (paragraphs === null)
        return false;
    return paragraphs.every((paragraph, index) => {
        if ('error' in paragraph)
            return false;
        if ('trailingEmpty' in paragraph)
            return index === paragraphs.length - 1 && contents.endsWith('\r');
        const { start, end } = paragraph;
        if (typeof start !== 'number' || typeof end !== 'number' || !Number.isInteger(start) || !Number.isInteger(end))
            return false;
        if (!('empty' in paragraph))
            return true;
        return start === end && start <= contents.length && (frame.lines ?? []).some((line) => !('error' in line) && line.start === start && line.end === end && line.contents === '');
    });
}
function stripBreaks(text) {
    return text.replace(/[\r\n\u0003]/gu, '');
}
export function judgeJapaneseTypography(host, policy) {
    if (host.savedBefore !== host.savedAfter) {
        throw new Error('The document\'s saved state changed during the read-only audit; the read is not reported.');
    }
    const relaxations = new Set(policy.lineStartRelaxations);
    const incomplete = new Set();
    if (host.skipped.length > 0)
        incomplete.add('skipped_frames');
    if (host.stop !== null)
        incomplete.add(host.stop);
    const collected = [];
    host.frames.forEach((frame, frameOrder) => {
        const contents = frame.contents;
        const target = { uuid: frame.uuid, name: frame.name, kind: frame.kind, orientation: frame.orientation };
        if (!paragraphsReadable(frame))
            incomplete.add('unreadable_paragraph');
        const lines = (frame.lines ?? []).map((line) => {
            if ('error' in line)
                return null;
            const { start, end } = line;
            if (typeof start !== 'number' || typeof end !== 'number' || !Number.isInteger(start) || !Number.isInteger(end) ||
                start < 0 || end < start || end > contents.length || contents.substring(start, end) !== line.contents)
                return null;
            return { start, end };
        });
        if (frame.lines === null || lines.some((line) => line === null))
            incomplete.add('unreadable_line');
        const lineAt = (index) => (index === null ? null : lines[index] ?? null);
        const push = (rule, anchor, range, lineIndex, evidence, stateOffset) => {
            const line = lineAt(lineIndex);
            collected.push({ frameOrder, anchor, finding: {
                    rule_id: rule, ...RULE_META[rule], determinism: 'deterministic', target, range, line_index: lineIndex,
                    evidence: { line_start: line?.start ?? null, line_end: line?.end ?? null, character: null, character_class: null,
                        prev_line_tail: null, next_line_head: null, ...evidence },
                    current_state: paragraphStateAt(frame.paragraphs, stateOffset),
                    can_auto_fix: false,
                } });
        };
        const visibleFromStart = frame.lines !== null && (lines.length === 0 || lines[0]?.start === 0);
        if (frame.lines !== null && !visibleFromStart)
            incomplete.add('unreadable_line');
        const softWraps = [];
        if (visibleFromStart) {
            for (let index = 0; index + 1 < lines.length; index += 1) {
                const previous = lines[index];
                const next = lines[index + 1];
                if (previous === null || previous === undefined || next === null || next === undefined)
                    continue;
                if (next.start === previous.end) {
                    if (breaksCluster(contents, previous.end) || isBreakUnit(contents, previous.end - 1) || isBreakUnit(contents, previous.end)) {
                        incomplete.add('unreadable_line');
                        continue;
                    }
                    softWraps.push({ offset: previous.end, prevLine: index });
                }
                else if (next.start === previous.end + 1 && (contents[previous.end] === '\r' || contents[previous.end] === '\u0003')) {
                }
                else {
                    incomplete.add('unreadable_line');
                }
            }
        }
        for (const { offset, prevLine } of softWraps) {
            const tail = clusterBefore(contents, offset);
            const head = clusterAt(contents, offset);
            if (tail === null || head === null) {
                incomplete.add('unreadable_line');
                continue;
            }
            const tailClass = jlreqClassOf(tail.codePoint);
            const headClass = jlreqClassOf(head.codePoint);
            const around = { prev_line_tail: tail.text, next_line_head: head.text };
            if (tailClass === 'cl-01') {
                push('JP_LINE_END_PROHIBITED', offset, { start: tail.start, end: tail.end }, prevLine, { ...around, character: tail.text, character_class: tailClass }, tail.start);
            }
            if (headClass !== null && LINE_START_PROHIBITED.has(headClass) && !relaxed(head.codePoint, relaxations)) {
                push('JP_LINE_START_PROHIBITED', offset, { start: head.start, end: head.end }, prevLine + 1, { ...around, character: head.text, character_class: headClass }, head.start);
            }
            const unbreakable = unbreakablePair(contents, tail, head);
            if (unbreakable !== null) {
                push('JP_UNBREAKABLE_SPLIT', offset, { start: unbreakable.start, end: unbreakable.end }, prevLine, { ...around, character: contents.substring(unbreakable.start, unbreakable.end), character_class: unbreakable.kind }, tail.start);
            }
        }
        for (const term of policy.protectedTerms) {
            for (let from = contents.indexOf(term); from >= 0; from = contents.indexOf(term, from + 1)) {
                const end = from + term.length;
                const crossing = softWraps.find((wrap) => from < wrap.offset && wrap.offset < end);
                if (crossing === undefined)
                    continue;
                push('JP_PROTECTED_TERM_SPLIT', crossing.offset, { start: from, end }, crossing.prevLine, {
                    prev_line_tail: clusterBefore(contents, crossing.offset)?.text ?? null,
                    next_line_head: clusterAt(contents, crossing.offset)?.text ?? null,
                    character: term, term,
                }, from);
            }
        }
        if (policy.halfwidthPunctuation === 'report') {
            const lineOf = (offset) => {
                const index = lines.findIndex((line) => line !== null && line.start <= offset && offset < line.end);
                return index < 0 ? null : index;
            };
            for (let index = 0; index < contents.length;) {
                if (!HALFWIDTH_PUNCTUATION.has(contents.charCodeAt(index))) {
                    index += 1;
                    continue;
                }
                let end = index;
                while (end < contents.length && HALFWIDTH_PUNCTUATION.has(contents.charCodeAt(end)))
                    end += 1;
                const before = clusterBefore(contents, index);
                const after = clusterAt(contents, end);
                if (before !== null && after !== null && isJapanese(before.codePoint) && isJapanese(after.codePoint)) {
                    push('JP_HALFWIDTH_PUNCTUATION', index, { start: index, end }, lineOf(index), {
                        character: contents.substring(index, end), character_class: jlreqClassOf(contents.codePointAt(index)),
                    }, index);
                }
                index = end;
            }
        }
        if (visibleFromStart && frame.kind === 'area' && lines.every((line) => line !== null)) {
            const lastEnd = lines.length === 0 ? 0 : lines[lines.length - 1].end;
            if (stripBreaks(contents.substring(lastEnd)).length > 0) {
                push('JP_OVERSET', lastEnd, { start: lastEnd, end: contents.length }, lines.length === 0 ? null : lines.length - 1, {}, lastEnd);
            }
        }
        else if (visibleFromStart && frame.kind === 'point' && lines.every((line) => line !== null)) {
            const lastEnd = lines.length === 0 ? 0 : lines[lines.length - 1].end;
            if (stripBreaks(contents.substring(lastEnd)).length > 0)
                incomplete.add('unreadable_line');
        }
    });
    collected.sort((left, right) => left.frameOrder - right.frameOrder || left.anchor - right.anchor ||
        RULE_ORDER[left.finding.rule_id] - RULE_ORDER[right.finding.rule_id] ||
        left.finding.range.start - right.finding.range.start || left.finding.range.end - right.finding.range.end);
    const findings = collected.map((entry) => entry.finding);
    if (findings.length > policy.maxFindings)
        incomplete.add('finding_limit');
    const orderedIncomplete = JP_AUDIT_INCOMPLETE_REASONS.filter((reason) => incomplete.has(reason));
    return jpAuditResultSchema.parse({
        status: orderedIncomplete.length === 0 ? 'complete' : 'partial',
        policy: {
            id: 'jp_line_break_v1',
            line_start_relaxations: LINE_START_RELAXATIONS.filter((relaxation) => relaxations.has(relaxation)),
            halfwidth_punctuation: policy.halfwidthPunctuation,
            protected_term_count: policy.protectedTerms.length,
        },
        document: host.document,
        coverage: { frames_in_scope: host.framesInScope, frames_audited: host.frames.length, frames_skipped: host.skipped },
        incomplete: orderedIncomplete,
        findings: findings.slice(0, policy.maxFindings),
    });
}
function unbreakablePair(contents, tail, head) {
    const tailFolded = foldFullWidth(tail.codePoint);
    const headFolded = foldFullWidth(head.codePoint);
    if (tailFolded === headFolded && (tailFolded === 0x2014 || tailFolded === 0x2026 || tailFolded === 0x2025)) {
        return { start: tail.start, end: head.end, kind: 'cl-08' };
    }
    if (isDigit(tail.codePoint) && isDigit(head.codePoint))
        return { start: tail.start, end: head.end, kind: 'cl-24' };
    if (isNumeralSeparator(tail.codePoint) && isDigit(head.codePoint)) {
        const beforeSeparator = clusterBefore(contents, tail.start);
        if (beforeSeparator !== null && isDigit(beforeSeparator.codePoint))
            return { start: beforeSeparator.start, end: head.end, kind: 'cl-24' };
    }
    if (isDigit(tail.codePoint) && isNumeralSeparator(head.codePoint)) {
        const afterSeparator = clusterAt(contents, head.end);
        if (afterSeparator !== null && isDigit(afterSeparator.codePoint))
            return { start: tail.start, end: afterSeparator.end, kind: 'cl-24' };
    }
    if (jlreqClassOf(tail.codePoint) === 'cl-12' && isDigit(head.codePoint))
        return { start: tail.start, end: head.end, kind: 'cl-12' };
    if (isDigit(tail.codePoint) && jlreqClassOf(head.codePoint) === 'cl-13')
        return { start: tail.start, end: head.end, kind: 'cl-13' };
    return null;
}
export function jpAuditErrorMessage(detail) {
    if (detail?.code === 'JP_AUDIT_TARGET_UNSUPPORTED') {
        return `The item with UUID ${JSON.stringify(detail.uuid ?? '')} is a ${detail.actual ?? 'non-text'} item; only TextFrame items can be audited.`;
    }
    if (detail?.code === 'JP_AUDIT_UUID_LOOKUP_UNAVAILABLE')
        return 'Illustrator native UUID lookup is unavailable.';
    return null;
}
