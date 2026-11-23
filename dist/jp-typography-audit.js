import { z } from 'zod';
import { assertShapeExtraSourceUnchanged, judgeShapeExtraFrame, jpAuditLooseLineSchema, jpAuditSettingCombinationSchema, looseLineEvidenceSchema, settingCombinationEvidenceSchema, shapeExtraInputError, shapeMeasurementSchema, } from './jp-loose-line-audit.js';
import { frameExtentEvidenceSchema, judgeSettingProfileFrame, jpAuditSettingProfileSchema, settingMismatchEvidenceSchema, settingProfilePolicyError, settingProfilePresetReport, settingProfileResultSchema, settingProfileRulesRun, } from './jp-setting-profile-audit.js';
import { documentContextSchema } from './mutation-result-schema-core.js';
import { groupFindings } from './jp-audit-grouping.js';
import { evaluateLatinBodyFrame, LATIN_DEFERRED_REASON, LATIN_DEFERRED_RULES, LATIN_FINDING_RULES, LATIN_RULE_META, LATIN_RULES, LATIN_SKIP_REASONS, latinBodyNeeds, latinBodyPolicyError, latinBodyResultSchema, } from './latin-body-audit.js';
import { breaksCluster, clusterAt, clusterBefore, countCharacters, isBreakUnit, isJapanese } from './typography-text.js';
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
function isDigit(codePoint) {
    return CLASS_OF.get(foldFullWidth(codePoint)) === 'cl-24';
}
function isNumeralSeparator(codePoint) {
    const folded = foldFullWidth(codePoint);
    return folded === 0x2C || folded === 0x2E;
}
export const JUSTIFY_BODY_SPACING_ATTRIBUTES = ['minimum_word_spacing', 'desired_word_spacing', 'maximum_word_spacing',
    'minimum_letter_spacing', 'desired_letter_spacing', 'maximum_letter_spacing', 'minimum_glyph_scaling', 'desired_glyph_scaling',
    'maximum_glyph_scaling'];
const HOST_SPACING_FIELDS = ['minimumWordSpacing', 'desiredWordSpacing', 'maximumWordSpacing', 'minimumLetterSpacing',
    'desiredLetterSpacing', 'maximumLetterSpacing', 'minimumGlyphScaling', 'desiredGlyphScaling', 'maximumGlyphScaling'];
const SCOPE_DIGEST_SOURCE = `
function jpAuditDigest(uuids) {
  var first = 2166136261;
  var second = 5381;
  var hex = function (value) { var text = value.toString(16); while (text.length < 8) text = "0" + text; return text; };
  for (var index = 0; index < uuids.length; index++) {
    var text = uuids[index] + "\\n";
    for (var position = 0; position < text.length; position++) {
      var code = text.charCodeAt(position);
      first = (first ^ code) >>> 0;
      first = (first + (first << 1) + (first << 4) + (first << 7) + (first << 8) + (first << 24)) >>> 0;
      second = (((second << 5) + second) ^ code) >>> 0;
    }
  }
  return hex(first) + hex(second);
}
`;
export function scopeUuidDigest(uuids) {
    let first = 2166136261;
    let second = 5381;
    const hex = (value) => value.toString(16).padStart(8, '0');
    for (const uuid of uuids) {
        const text = `${uuid}\n`;
        for (let position = 0; position < text.length; position += 1) {
            const code = text.charCodeAt(position);
            first = (first ^ code) >>> 0;
            first = (first + (first << 1) + (first << 4) + (first << 7) + (first << 8) + (first << 24)) >>> 0;
            second = (((second << 5) + second) ^ code) >>> 0;
        }
    }
    return hex(first) + hex(second);
}
export function wholePageScopeDigest(host) {
    if ((host.startIndex ?? 0) !== 0 || (host.nextIndex ?? null) !== null)
        return null;
    const entries = [...host.frames, ...host.skipped];
    if (entries.length !== host.framesInScope || entries.some((entry) => entry.index === undefined))
        return null;
    const ordered = entries.sort((left, right) => left.index - right.index);
    if (ordered.some((entry, position) => entry.index !== position))
        return null;
    return scopeUuidDigest(ordered.map((entry) => entry.uuid));
}
export const AUDIT_JAPANESE_TYPOGRAPHY_SCRIPT = `
var JP_AUDIT_MAX_FRAMES = ${JP_AUDIT_LIMITS.frames};
var JP_AUDIT_MAX_CHARACTERS = ${JP_AUDIT_LIMITS.characters};
var JP_AUDIT_MAX_LINES = ${JP_AUDIT_LIMITS.lines};
var JP_AUDIT_MAX_PARAGRAPHS = ${JP_AUDIT_LIMITS.paragraphs};
var JP_AUDIT_SPACING_FIELDS = ${JSON.stringify(HOST_SPACING_FIELDS)};

${SCOPE_DIGEST_SOURCE}
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

/** Justification and the nine spacing values, read apart so that a failure here never hides the kinsoku values. */
function jpAuditJustifyBody(attributes) {
  try {
    var spacing = [];
    for (var index = 0; index < JP_AUDIT_SPACING_FIELDS.length; index++) spacing.push(attributes[JP_AUDIT_SPACING_FIELDS[index]]);
    return { justification: String(attributes.justification), spacing: spacing };
  } catch (justifyError) { return { error: "paragraph_attribute_unreadable" }; }
}

/** Hyphenation (policy latin_body_v1), read apart so that a failure here never hides the other values; Node checks the type. */
function jpAuditLatinBody(attributes) {
  try { return { hyphenation: attributes.hyphenation }; }
  catch (latinBodyError) { return { error: "paragraph_attribute_unreadable" }; }
}

/**
 * kinsoku and mojikumi are read apart. A paragraph whose kinsoku is None or whose mojikumi is "none" reads as error 9563 on the host (#841 P0):
 * that is the value "none" (#871), not an unreadable paragraph. Any other failure goes up to the caller as before.
 */
function jpAuditSettingName(attributes, key) {
  try { return String(attributes[key]); }
  catch (settingError) {
    if (settingError && settingError.number === 9563) return "none";
    throw settingError;
  }
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
      var kinsoku = jpAuditSettingName(attributes, "kinsoku");
      var mojikumi = jpAuditSettingName(attributes, "mojikumi");
      var record = { start: start, end: end, kinsoku: kinsoku, mojikumi: mojikumi, burasagariType: String(attributes.burasagariType),
        bunriKinshi: attributes.bunriKinshi, kinsokuOrder: String(attributes.kinsokuOrder) };
      if (params.readJustifyBody === true) record.justifyBody = jpAuditJustifyBody(attributes);
      if (params.readLatinBody === true) record.latinBody = jpAuditLatinBody(attributes);
      out.push(record);
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
// The whole-document scope is read by index, one page at a time (a page ends at the frame, character, line or paragraph limit); frames past
// the page are counted, never read. startIndex is where this page starts in the scope (0 for the first page).
var jpAuditStart = typeof params.startIndex === "number" ? params.startIndex : 0;
// A number when a second read of character attributes follows: the characters of the frames that read may take are limited, and a page ends before it.
var jpAuditAttributeBudget = typeof params.attributeBudget === "number" ? params.attributeBudget : null;
// A soft size for this page (#1071): no frame is added once the page's characters would pass it. The first admitted frame is always taken, and the
// check is made where a frame is admitted (after every reason to skip it), so a re-read with the same value gives the same page as the first read.
var jpAuditPageHint = typeof params.pageCharacters === "number" ? params.pageCharacters : null;
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
if (jpAuditStart < 0 || jpAuditStart > jpAuditScopeCount || (jpAuditStart === jpAuditScopeCount && jpAuditStart > 0)) {
  jpAuditFail("JP_AUDIT_START_OUT_OF_RANGE", { start: jpAuditStart, count: jpAuditScopeCount });
}
var jpAuditFrames = [];
var jpAuditSkipped = [];
var jpAuditStop = null;
var jpAuditNext = null;
var jpAuditCharacters = 0;
var jpAuditAttributeCharacters = 0;
var jpAuditLineTotal = 0;
var jpAuditParagraphTotal = 0;
for (var jpAuditFrameIndex = jpAuditStart; jpAuditFrameIndex < jpAuditScopeCount; jpAuditFrameIndex++) {
  if (jpAuditFrameIndex - jpAuditStart >= JP_AUDIT_MAX_FRAMES) { jpAuditStop = "scan_limit"; jpAuditNext = jpAuditFrameIndex; break; }
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
  if (jpAuditSkip !== null) { jpAuditSkipped.push({ index: jpAuditFrameIndex, uuid: jpAuditUuid, name: jpAuditFrameName, reason: jpAuditSkip }); continue; }
  var jpAuditContents;
  try { jpAuditContents = String(jpAuditFrame.contents); }
  catch (jpAuditContentsError) { jpAuditSkipped.push({ index: jpAuditFrameIndex, uuid: jpAuditUuid, name: jpAuditFrameName, reason: "unreadable_frame" }); continue; }
  if (jpAuditContents.length === 0) { jpAuditSkipped.push({ index: jpAuditFrameIndex, uuid: jpAuditUuid, name: jpAuditFrameName, reason: "empty" }); continue; }
  // A frame that alone is past a limit of one read can never fit a page: it is reported as too_large (never dropped) and the scan goes on.
  if (jpAuditContents.length > JP_AUDIT_MAX_CHARACTERS) { jpAuditSkipped.push({ index: jpAuditFrameIndex, uuid: jpAuditUuid, name: jpAuditFrameName, reason: "too_large" }); continue; }
  var jpAuditCountsForAttributes = jpAuditAttributeBudget !== null && jpAuditContents.length <= jpAuditAttributeBudget;
  if (jpAuditCharacters + jpAuditContents.length > JP_AUDIT_MAX_CHARACTERS ||
      (jpAuditCountsForAttributes && jpAuditAttributeCharacters + jpAuditContents.length > jpAuditAttributeBudget)) {
    jpAuditStop = "scan_limit"; jpAuditNext = jpAuditFrameIndex; break;
  }
  var jpAuditLineCount = -1;
  try { jpAuditLineCount = Number(jpAuditFrame.lines.length); } catch (jpAuditCountError) { jpAuditLineCount = -1; }
  if (jpAuditLineCount > JP_AUDIT_MAX_LINES) { jpAuditSkipped.push({ index: jpAuditFrameIndex, uuid: jpAuditUuid, name: jpAuditFrameName, reason: "too_large" }); continue; }
  if (jpAuditLineCount > 0 && jpAuditLineTotal + jpAuditLineCount > JP_AUDIT_MAX_LINES) { jpAuditStop = "line_cap"; jpAuditNext = jpAuditFrameIndex; break; }
  var jpAuditParagraphCollection = null;
  var jpAuditParagraphCount = 0;
  try { jpAuditParagraphCollection = jpAuditFrame.paragraphs; jpAuditParagraphCount = Number(jpAuditParagraphCollection.length); }
  catch (jpAuditParagraphCountError) { jpAuditParagraphCollection = null; }
  if (jpAuditParagraphCollection !== null && jpAuditParagraphCount > JP_AUDIT_MAX_PARAGRAPHS) {
    jpAuditSkipped.push({ index: jpAuditFrameIndex, uuid: jpAuditUuid, name: jpAuditFrameName, reason: "too_large" });
    continue;
  }
  if (jpAuditParagraphCollection !== null && jpAuditParagraphTotal + jpAuditParagraphCount > JP_AUDIT_MAX_PARAGRAPHS) {
    jpAuditStop = "paragraph_cap";
    jpAuditNext = jpAuditFrameIndex;
    break;
  }
  if (jpAuditPageHint !== null && jpAuditFrames.length > 0 && jpAuditCharacters + jpAuditContents.length > jpAuditPageHint) {
    jpAuditStop = "scan_limit"; jpAuditNext = jpAuditFrameIndex; break;
  }
  if (jpAuditParagraphCollection !== null) jpAuditParagraphTotal += jpAuditParagraphCount;
  jpAuditCharacters += jpAuditContents.length;
  if (jpAuditCountsForAttributes) jpAuditAttributeCharacters += jpAuditContents.length;
  var jpAuditLineRecords = null;
  if (jpAuditLineCount >= 0) {
    jpAuditLineTotal += jpAuditLineCount;
    try { jpAuditLineRecords = jpAuditLines(jpAuditFrame); } catch (jpAuditLinesError) { jpAuditLineRecords = null; }
  }
  jpAuditFrames.push({ index: jpAuditFrameIndex, uuid: jpAuditUuid, name: jpAuditFrameName, kind: jpAuditKind, orientation: jpAuditOrientation,
    contents: jpAuditContents, lines: jpAuditLineRecords,
    paragraphs: jpAuditParagraphs(jpAuditParagraphCollection, jpAuditParagraphCount, jpAuditContents) });
}
// A digest of the scope's UUIDs in order, read only when there is more than one page (a continuation, or a page that left frames): Node binds
// the next page's cursor to it, so a frame added, removed or moved between two pages is detected, not silently skipped. The targets are known to Node.
var jpAuditScopeDigest = null;
if (jpAuditAll !== null && (jpAuditStart > 0 || jpAuditNext !== null)) {
  var jpAuditScopeUuids = [];
  for (var jpAuditScopeIndex = 0; jpAuditScopeIndex < jpAuditScopeCount; jpAuditScopeIndex++) {
    var jpAuditScopeUuid = "";
    try { jpAuditScopeUuid = String(jpAuditAll[jpAuditScopeIndex].uuid); } catch (jpAuditScopeUuidError) { jpAuditScopeUuid = ""; }
    jpAuditScopeUuids.push(jpAuditScopeUuid);
  }
  jpAuditScopeDigest = jpAuditDigest(jpAuditScopeUuids);
}
var result = { document: jpAuditContext, savedBefore: jpAuditSavedBefore, savedAfter: jpAuditDocument.saved,
  framesInScope: jpAuditScopeCount, startIndex: jpAuditStart, nextIndex: jpAuditNext, scopeDigest: jpAuditScopeDigest, stop: jpAuditStop,
  frames: jpAuditFrames, skipped: jpAuditSkipped };
`;
export const JP_AUDIT_SKIP_REASONS = ['path_text', 'threaded', 'locked_or_hidden', 'vertical_point_text', 'empty', 'unreadable_frame', 'too_large'];
export const JP_AUDIT_INCOMPLETE_REASONS = ['skipped_frames', 'scan_limit', 'line_cap', 'paragraph_cap', 'finding_limit', 'response_limit', 'unreadable_line',
    'unreadable_paragraph', 'unreadable_paragraph_attribute', 'overset_paragraph', 'paragraph_shape_unmeasured', 'rule_skipped',
    'setting_profile_unmeasured'];
export const JP_AUDIT_RULES = ['JP_LINE_END_PROHIBITED', 'JP_LINE_START_PROHIBITED', 'JP_UNBREAKABLE_SPLIT',
    'JP_PROTECTED_TERM_SPLIT', 'JP_HALFWIDTH_PUNCTUATION', 'JP_OVERSET', 'JP_JUSTIFY_LAST_LINE', 'JP_SPACING_RANGE',
    'JP_SHORT_LAST_LINE', 'JP_SHORT_LINE_HEAD', 'JP_LOOSE_LINE', 'JP_PARAGRAPH_SETTING_COMBINATION', 'JP_SETTING_PROFILE_MISMATCH',
    'JP_BETA_FRAME_EXTENT'];
export const JP_AUDIT_RESULT_FORMATS = ['grouped', 'findings'];
export const JP_AUDIT_POLICIES = ['jp_line_break_v1', 'jp_justify_body_v1', 'jp_paragraph_shape_v1', 'latin_body_v1', 'jp_setting_profile_v1'];
export const JP_AUDIT_RESPONSE_BYTES = { default: 30_000, max: 80_000 };
export const JP_AUDIT_CURSOR_RESERVE_BYTES = 2_048;
export const JUSTIFICATIONS = ['LEFT', 'CENTER', 'RIGHT', 'FULLJUSTIFY', 'FULLJUSTIFYLASTLINELEFT', 'FULLJUSTIFYLASTLINECENTER',
    'FULLJUSTIFYLASTLINERIGHT'];
export const LAST_LINE_ALIGNMENTS = ['left', 'center', 'right', 'justify'];
const LAST_LINE_OF = { FULLJUSTIFY: 'justify', FULLJUSTIFYLASTLINELEFT: 'left',
    FULLJUSTIFYLASTLINECENTER: 'center', FULLJUSTIFYLASTLINERIGHT: 'right' };
export const HOST_NEW_DOCUMENT_DEFAULTS = { justification: 'LEFT', minimum_word_spacing: 80, desired_word_spacing: 100,
    maximum_word_spacing: 133, minimum_letter_spacing: 0, desired_letter_spacing: 0, maximum_letter_spacing: 0,
    minimum_glyph_scaling: 100, desired_glyph_scaling: 100, maximum_glyph_scaling: 100 };
const HOST_DEFAULTS_SOURCE = 'Illustrator 30.8.1 new document as read on the measured host (#53 T33, #341 WP_D)';
function normalizeSpacing(value) {
    return Math.round(value * 10_000) / 10_000;
}
const hostOffset = z.number().int().nonnegative();
const skipEntrySchema = z.strictObject({
    uuid: z.string().max(255),
    name: z.string().max(255),
    reason: z.enum(JP_AUDIT_SKIP_REASONS),
});
const hostSkipEntrySchema = skipEntrySchema.extend({ index: z.number().int().nonnegative().optional() });
export const jpAuditHostDataSchema = z.strictObject({
    document: documentContextSchema,
    savedBefore: z.boolean(),
    savedAfter: z.boolean(),
    framesInScope: z.number().int().nonnegative(),
    startIndex: z.number().int().nonnegative().default(0),
    nextIndex: z.number().int().positive().nullable().default(null),
    scopeDigest: z.string().regex(/^[0-9a-f]{16}$/u).nullable().default(null),
    stop: z.enum(['scan_limit', 'line_cap', 'paragraph_cap']).nullable(),
    frames: z.array(z.strictObject({
        index: z.number().int().nonnegative().optional(),
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
                burasagariType: z.string(), bunriKinshi: z.unknown(), kinsokuOrder: z.string(),
                justifyBody: z.union([
                    z.strictObject({ justification: z.string(), spacing: z.array(z.unknown()) }),
                    z.strictObject({ error: z.literal('paragraph_attribute_unreadable') }),
                ]).optional(),
                latinBody: z.union([
                    z.strictObject({ hyphenation: z.unknown() }),
                    z.strictObject({ error: z.literal('paragraph_attribute_unreadable') }),
                ]).optional() }),
            z.strictObject({ start: z.unknown(), end: z.unknown(), empty: z.literal(true) }),
            z.strictObject({ trailingEmpty: z.literal(true) }),
            z.strictObject({ error: z.literal('paragraph_unreadable') }),
        ])).max(JP_AUDIT_LIMITS.paragraphs).nullable(),
    })).max(JP_AUDIT_LIMITS.frames),
    skipped: z.array(hostSkipEntrySchema).max(JP_AUDIT_LIMITS.frames),
});
export const jpAuditProtectedTermSchema = z.strictObject({ text: z.string().min(1).max(64) });
const spacingBoundSchema = z.strictObject({ at_least: z.number().min(-1000).max(1000).optional(),
    at_most: z.number().min(-1000).max(1000).optional() });
const spacingRangesSchema = z.strictObject(Object.fromEntries(JUSTIFY_BODY_SPACING_ATTRIBUTES.map((attribute) => [attribute, spacingBoundSchema.optional()])));
export const jpAuditJustifyBodySchema = z.strictObject({
    last_line: z.enum(LAST_LINE_ALIGNMENTS).optional(),
    spacing_ranges: spacingRangesSchema.optional(),
    short_last_line_max_characters: z.number().int().min(1).max(100).optional(),
});
export const jpAuditParagraphShapeSchema = z.strictObject({
    short_line_head: z.strictObject({
        max_characters: z.number().int().min(1).max(10),
        punctuation_classes: z.array(z.enum(Object.keys(JLREQ_CLASS_MEMBERS))).min(1)
            .max(Object.keys(JLREQ_CLASS_MEMBERS).length),
    }).optional(),
    short_last_line_max_characters: z.number().int().min(1).max(100).optional(),
    loose_line: jpAuditLooseLineSchema.optional(),
    setting_combination: jpAuditSettingCombinationSchema.optional(),
});
export { latinBodySchema as jpAuditLatinBodySchema } from './latin-body-audit.js';
export { jpAuditSettingProfileSchema };
const currentStateSchema = z.strictObject({
    kinsoku: z.string(),
    mojikumi: z.string(),
    burasagari_type: z.string(),
    bunri_kinshi: z.boolean().nullable(),
    kinsoku_order: z.string(),
});
const jpAuditNoBreakPlanCallSchema = z.strictObject({
    tool: z.literal('illustrator_set_no_break'),
    arguments: z.strictObject({
        expected_document_key: z.string().min(1).max(16_384),
        target_uuid: z.string().min(1).max(255),
        start: z.number().int().safe().nonnegative(),
        end: z.number().int().safe().nonnegative(),
        no_break: z.literal(true),
        apply: z.literal(false),
    }),
});
const NO_BREAK_RULES = new Set(['JP_UNBREAKABLE_SPLIT', 'JP_PROTECTED_TERM_SPLIT']);
export const JP_AUDIT_NO_BREAK_NOTE = 'next_call is a plan call only (apply false); illustrator_set_no_break refuses, with a reason, any target outside its measured profile (layer-direct, no manual kerning or tab stops, supported justification, and so on). Vertical text gets no next_call.';
function noBreakPlanCall(documentKey, targetUuid, range) {
    return { tool: 'illustrator_set_no_break', arguments: { expected_document_key: documentKey, target_uuid: targetUuid,
            start: range.start, end: range.end, no_break: true, apply: false } };
}
const evidenceLineShape = {
    line_start: hostOffset.nullable(),
    line_end: hostOffset.nullable(),
    character: z.string().nullable(),
    character_class: z.string().nullable(),
    prev_line_tail: z.string().nullable(),
    next_line_head: z.string().nullable(),
};
const evidenceExtraShape = {
    term: z.string().optional(),
    justification: z.string().optional(),
    expected_last_line: z.string().optional(),
    spacing: z.array(z.strictObject({ attribute: z.string(), value: z.number(),
        at_least: z.number().nullable(), at_most: z.number().nullable() })).optional(),
    loose_line: looseLineEvidenceSchema.optional(),
    setting_combination: settingCombinationEvidenceSchema.optional(),
    setting_mismatch: settingMismatchEvidenceSchema.optional(),
    frame_extent: frameExtentEvidenceSchema.optional(),
    last_line_characters: z.number().int().nonnegative().optional(),
    head_characters: z.number().int().positive().optional(),
    max_characters: z.number().int().positive().optional(),
    min_characters: z.number().int().positive().optional(),
    hyphenation: z.boolean().optional(),
    consecutive_hyphen_lines: z.number().int().positive().optional(),
    max_consecutive_hyphens: z.number().int().positive().optional(),
    excerpt: z.string().optional(),
};
const findingRuleId = z.enum([...JP_AUDIT_RULES, ...LATIN_FINDING_RULES]);
const findingTargetSchema = z.strictObject({
    uuid: z.string().max(255),
    name: z.string().max(255),
    kind: z.enum(['point', 'area']),
    orientation: z.enum(['horizontal', 'vertical']),
});
const findingSchema = z.strictObject({
    rule_id: findingRuleId,
    severity: z.enum(['error', 'warning', 'info']),
    determinism: z.enum(['deterministic', 'heuristic']),
    source_class: z.enum(['jlreq', 'adobe', 'house_rule', 'convention']),
    source_ref: z.string(),
    target: findingTargetSchema,
    range: z.strictObject({ start: hostOffset, end: hostOffset }),
    line_index: z.number().int().nonnegative().nullable(),
    evidence: z.strictObject({ ...evidenceLineShape, ...evidenceExtraShape }),
    current_state: currentStateSchema.nullable(),
    recommendation: z.string(),
    can_auto_fix: z.literal(false),
    required_capability: z.enum(['set_no_break']).nullable(),
    next_call: jpAuditNoBreakPlanCallSchema.optional(),
});
const groupedRuleSchema = z.strictObject({
    rule_id: findingRuleId,
    severity: z.enum(['error', 'warning', 'info']),
    determinism: z.enum(['deterministic', 'heuristic']),
    source_class: z.enum(['jlreq', 'adobe', 'house_rule', 'convention']),
    source_ref: z.string(),
    recommendation: z.string(),
    can_auto_fix: z.literal(false),
    required_capability: z.enum(['set_no_break']).nullable(),
});
const groupedIndex = z.number().int().nonnegative();
const groupedFindingsSchema = z.strictObject({
    rules: z.array(groupedRuleSchema).max(64),
    frames: z.array(findingTargetSchema).max(JP_AUDIT_LIMITS.findings),
    states: z.array(currentStateSchema).max(JP_AUDIT_LIMITS.findings),
    groups: z.array(z.strictObject({
        rule: groupedIndex,
        frame: groupedIndex,
        state: groupedIndex.nullable(),
        evidence: z.strictObject({ line_start: evidenceLineShape.line_start.optional(), line_end: evidenceLineShape.line_end.optional(),
            character: evidenceLineShape.character.optional(), character_class: evidenceLineShape.character_class.optional(),
            prev_line_tail: evidenceLineShape.prev_line_tail.optional(), next_line_head: evidenceLineShape.next_line_head.optional(),
            ...evidenceExtraShape }),
        ranges: z.array(z.tuple([hostOffset, hostOffset, groupedIndex.nullable(), groupedIndex])).min(1).max(JP_AUDIT_LIMITS.findings),
    })).max(JP_AUDIT_LIMITS.findings),
});
const observedValueSchema = z.strictObject({ value: z.union([z.string(), z.number()]), paragraph_count: z.number().int().positive() });
const JUSTIFY_BODY_ATTRIBUTES = ['justification', ...JUSTIFY_BODY_SPACING_ATTRIBUTES];
const OBSERVED_VALUE_LIMIT = 10;
export const jpAuditResultSchema = z.strictObject({
    status: z.enum(['complete', 'partial']),
    policies: z.array(z.enum(JP_AUDIT_POLICIES)),
    policy: z.strictObject({
        id: z.literal('jp_line_break_v1'),
        line_start_relaxations: z.array(z.enum(LINE_START_RELAXATIONS)),
        halfwidth_punctuation: z.enum(['report', 'ignore']),
        protected_term_count: z.number().int().nonnegative(),
    }).nullable(),
    justify_body: z.strictObject({
        rules_run: z.array(z.string()),
        paragraphs_read: z.number().int().nonnegative(),
        observed: z.array(z.strictObject({ attribute: z.string(), values: z.array(observedValueSchema).max(OBSERVED_VALUE_LIMIT),
            other_paragraph_count: z.number().int().nonnegative() })),
        host_new_document_default: z.record(z.string(), z.union([z.string(), z.number()])),
        host_default_source: z.string(),
    }).nullable(),
    paragraph_shape: z.strictObject({ rules_run: z.array(z.string()), measurement: shapeMeasurementSchema.optional() }).nullable(),
    latin_body: latinBodyResultSchema.optional(),
    setting_profile: settingProfileResultSchema.optional(),
    document: documentContextSchema,
    coverage: z.strictObject({
        frames_in_scope: z.number().int().nonnegative(),
        frames_audited: z.number().int().nonnegative(),
        frames_skipped: z.array(skipEntrySchema),
        page: z.strictObject({
            first_frame_index: z.number().int().nonnegative(),
            next_frame_index: z.number().int().positive().nullable(),
        }),
    }),
    incomplete: z.array(z.enum(JP_AUDIT_INCOMPLETE_REASONS)),
    notes: z.array(z.string()).max(1),
    format: z.enum(JP_AUDIT_RESULT_FORMATS),
    findings: z.array(findingSchema).max(JP_AUDIT_LIMITS.findings).optional(),
    grouped: groupedFindingsSchema.optional(),
    next_cursor: z.string().min(1).max(32_768).optional(),
});
export function jpAuditPolicyError(policies, justifyBody, paragraphShape, latinBody, protectedTermCount = 0, settingProfile) {
    if (new Set(policies).size !== policies.length)
        return 'policy must not repeat an entry.';
    if (policies.includes('latin_body_v1')) {
        const latinError = latinBodyPolicyError(latinBody, protectedTermCount);
        if (latinError !== null)
            return latinError;
    }
    else if (latinBody !== undefined) {
        return 'latin_body is used only with policy latin_body_v1.';
    }
    const profileError = settingProfilePolicyError(policies.includes('jp_setting_profile_v1'), settingProfile);
    if (profileError !== null)
        return profileError;
    if (!policies.includes('jp_paragraph_shape_v1')) {
        if (paragraphShape !== undefined)
            return 'paragraph_shape is used only with policy jp_paragraph_shape_v1.';
    }
    else if (paragraphShape === undefined || (paragraphShape.short_line_head === undefined &&
        paragraphShape.short_last_line_max_characters === undefined && paragraphShape.loose_line === undefined &&
        paragraphShape.setting_combination === undefined)) {
        return 'policy jp_paragraph_shape_v1 needs paragraph_shape with at least one of short_line_head, short_last_line_max_characters, loose_line or setting_combination; no threshold is assumed.';
    }
    else if (shapeExtraInputError(paragraphShape) !== null) {
        return shapeExtraInputError(paragraphShape);
    }
    else if (paragraphShape.short_line_head !== undefined &&
        new Set(paragraphShape.short_line_head.punctuation_classes).size !== paragraphShape.short_line_head.punctuation_classes.length) {
        return 'paragraph_shape.short_line_head.punctuation_classes must not repeat a class.';
    }
    const wantsJustify = policies.includes('jp_justify_body_v1');
    if (!wantsJustify)
        return justifyBody === undefined ? null : 'justify_body is used only with policy jp_justify_body_v1.';
    if (justifyBody === undefined || (justifyBody.last_line === undefined && justifyBody.spacing_ranges === undefined &&
        justifyBody.short_last_line_max_characters === undefined)) {
        return 'policy jp_justify_body_v1 needs justify_body with at least one of last_line, spacing_ranges or short_last_line_max_characters; no threshold is assumed.';
    }
    if (justifyBody.spacing_ranges !== undefined) {
        const entries = Object.entries(justifyBody.spacing_ranges).filter(([, bound]) => bound !== undefined);
        if (entries.length === 0)
            return 'justify_body.spacing_ranges needs at least one attribute.';
        for (const [attribute, bound] of entries) {
            if (bound.at_least === undefined && bound.at_most === undefined)
                return `justify_body.spacing_ranges.${attribute} needs at_least or at_most.`;
            if (bound.at_least !== undefined && bound.at_most !== undefined && bound.at_least > bound.at_most) {
                return `justify_body.spacing_ranges.${attribute}: at_least must not exceed at_most.`;
            }
        }
    }
    return null;
}
const RULE_ORDER = new Map([...JP_AUDIT_RULES, ...LATIN_FINDING_RULES].map((rule, index) => [rule, index]));
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
    JP_JUSTIFY_LAST_LINE: { severity: 'warning', source_class: 'house_rule', source_ref: 'justify_body.last_line', required_capability: null,
        recommendation: 'A justified paragraph treats its last line differently from justify_body.last_line (FULLJUSTIFY stretches the last line; FULLJUSTIFYLASTLINELEFT keeps it left). Change the paragraph justification if the house style requires it.' },
    JP_SPACING_RANGE: { severity: 'warning', source_class: 'house_rule', source_ref: 'justify_body.spacing_ranges', required_capability: null,
        recommendation: 'A word spacing, letter spacing or glyph scaling value is outside justify_body.spacing_ranges. Change the paragraph\'s justification settings if the house style requires it; observed and host defaults are evidence, not targets.' },
    JP_SHORT_LAST_LINE: { severity: 'warning', source_class: 'house_rule', source_ref: 'short_last_line_max_characters (justify_body or paragraph_shape)',
        required_capability: null,
        recommendation: 'The last line of the paragraph is short. Adjust tracking, frame width or text, then audit again because the line breaks move.' },
    JP_SHORT_LINE_HEAD: { severity: 'warning', source_class: 'house_rule', source_ref: 'paragraph_shape.short_line_head', required_capability: null,
        recommendation: 'A wrapped line starts with a few characters and then punctuation. Adjust tracking, frame width, no-break or text, then audit again because the line breaks move.' },
    JP_LOOSE_LINE: { severity: 'warning', source_class: 'house_rule', source_ref: 'paragraph_shape.loose_line', required_capability: null,
        recommendation: 'The characters of a justified, wrapped line are spread apart by more than loose_line allows (measured against the nominal advance, in em; ink bearings are not removed). Adjust tracking, frame width, mojikumi set or text, then audit again because the line breaks move.' },
    JP_SETTING_PROFILE_MISMATCH: { severity: 'warning', source_class: 'house_rule', source_ref: 'setting_profile.expected', required_capability: null,
        recommendation: 'A character range or paragraph differs from the value setting_profile.expected names (evidence: attribute, expected, current, current_raw). Change it if the house style requires it; this audit changes nothing.' },
    JP_BETA_FRAME_EXTENT: { severity: 'warning', source_class: 'adobe', source_ref: 'Adobe mojikumi manual p.08', required_capability: null,
        recommendation: 'The inner width (horizontal) or height (vertical) of the frame is not a whole number of character advances, so a justified paragraph spreads its lines unevenly. Resize the frame to one of the candidates, then audit again.' },
    JP_PARAGRAPH_SETTING_COMBINATION: { severity: 'warning', source_class: 'house_rule', source_ref: 'paragraph_shape.setting_combination', required_capability: null,
        recommendation: 'The paragraph is fully justified with a mojikumi set and kerning method that setting_combination names; the extra space of justification can open unevenly around punctuation. Consider another mojikumi set or kerning method for this paragraph, then audit again.' },
};
const RULE_DETERMINISM = { JP_SHORT_LAST_LINE: 'heuristic', JP_SHORT_LINE_HEAD: 'heuristic', JP_LOOSE_LINE: 'heuristic' };
function readJustifyBody(paragraph) {
    const raw = paragraph.justifyBody;
    if (raw === undefined || typeof raw.justification !== 'string' || !Array.isArray(raw.spacing) ||
        raw.spacing.length !== JUSTIFY_BODY_SPACING_ATTRIBUTES.length)
        return null;
    const match = /^Justification\.([A-Z]+)$/u.exec(raw.justification);
    if (match === null || !JUSTIFICATIONS.includes(match[1]))
        return null;
    const values = raw.spacing;
    if (!values.every((value) => typeof value === 'number' && Number.isFinite(value)))
        return null;
    return { justification: match[1], spacing: Object.fromEntries(JUSTIFY_BODY_SPACING_ATTRIBUTES.map((attribute, index) => [attribute, normalizeSpacing(values[index])])) };
}
function readHyphenation(paragraph) {
    const raw = paragraph.latinBody;
    return raw !== undefined && typeof raw.hyphenation === 'boolean' ? raw.hyphenation : null;
}
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
export function judgeJapaneseTypographyPage(host, policy) {
    if (host.savedBefore !== host.savedAfter) {
        throw new Error('The document\'s saved state changed during the read-only audit; the read is not reported.');
    }
    const startIndex = host.startIndex ?? 0;
    const nextIndex = host.nextIndex ?? null;
    const policies = JP_AUDIT_POLICIES.filter((id) => (policy.policies ?? ['jp_line_break_v1']).includes(id));
    const lineBreak = policies.includes('jp_line_break_v1');
    const justifyBody = policies.includes('jp_justify_body_v1') ? policy.justifyBody ?? null : null;
    if (policies.includes('jp_justify_body_v1') && justifyBody === null)
        throw new Error('policy jp_justify_body_v1 needs justify_body.');
    const paragraphShape = policies.includes('jp_paragraph_shape_v1') ? policy.paragraphShape ?? null : null;
    if (policies.includes('jp_paragraph_shape_v1') && paragraphShape === null)
        throw new Error('policy jp_paragraph_shape_v1 needs paragraph_shape.');
    const latin = policies.includes('latin_body_v1') ? policy.latinBody ?? null : null;
    if (policies.includes('latin_body_v1') && latin === null)
        throw new Error('policy latin_body_v1 needs latin_body.');
    const settingProfile = policies.includes('jp_setting_profile_v1') ? policy.settingProfile ?? null : null;
    if (policies.includes('jp_setting_profile_v1') && settingProfile === null)
        throw new Error('policy jp_setting_profile_v1 needs setting_profile.');
    const latinNeeds = latinBodyNeeds(latin?.rules ?? []);
    const latinSkips = new Map();
    const observed = new Map(JUSTIFY_BODY_ATTRIBUTES.map((attribute) => [attribute, new Map()]));
    let paragraphsRead = 0;
    const relaxations = new Set(policy.lineStartRelaxations);
    const incomplete = new Set();
    if (host.skipped.length > 0)
        incomplete.add('skipped_frames');
    if (host.stop !== null)
        incomplete.add(host.stop);
    const collected = [];
    const shapeExtra = paragraphShape !== null && (paragraphShape.loose_line !== undefined || paragraphShape.setting_combination !== undefined);
    if (policy.paragraphShapeExtra !== undefined) {
        if (policy.paragraphShapeExtra.document.key !== host.document.key) {
            throw new Error('The document changed between the two reads of the audit; the read is not reported.');
        }
        assertShapeExtraSourceUnchanged(policy.paragraphShapeExtra);
    }
    const shapeSkipped = [];
    const profileSkipped = [];
    const profileHeights = [];
    let profileFramesMeasured = 0;
    let shapeFramesMeasured = 0;
    let shapeLinesJudged = 0;
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
        const push = (rule, anchor, range, lineIndex, evidence, stateOffset, source) => {
            const line = lineAt(lineIndex);
            const finding = {
                rule_id: rule, ...RULE_META[rule], ...(source ?? {}), determinism: RULE_DETERMINISM[rule] ?? 'deterministic', target, range, line_index: lineIndex,
                evidence: { line_start: line?.start ?? null, line_end: line?.end ?? null, character: null, character_class: null,
                    prev_line_tail: null, next_line_head: null, ...evidence },
                current_state: paragraphStateAt(frame.paragraphs, stateOffset),
                can_auto_fix: false,
            };
            if (NO_BREAK_RULES.has(rule) && frame.orientation === 'horizontal') {
                finding.next_call = noBreakPlanCall(host.document.keyShort, frame.uuid, range);
            }
            collected.push({ frameOrder, anchor, finding });
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
        for (const { offset, prevLine } of lineBreak ? softWraps : []) {
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
        for (const term of lineBreak ? policy.protectedTerms : []) {
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
        if (lineBreak && policy.halfwidthPunctuation === 'report') {
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
        if (lineBreak && visibleFromStart && frame.kind === 'area' && lines.every((line) => line !== null)) {
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
        const linesReadable = visibleFromStart && lines.every((line) => line !== null);
        const shortLastLineJudged = new Set();
        const shortLastLine = (start, end, maxCharacters, evidence) => {
            if (!linesReadable)
                return;
            const ownLines = lines.map((line, index) => ({ line, index })).filter(({ line }) => start <= line.start && line.start < end);
            const lastLine = ownLines.length === 0 ? null : ownLines[ownLines.length - 1];
            if (lastLine === null || lastLine.line.end < end) {
                incomplete.add('overset_paragraph');
                return;
            }
            if (ownLines.length < 2 || shortLastLineJudged.has(lastLine.index))
                return;
            const characters = countCharacters(contents.substring(lastLine.line.start, lastLine.line.end));
            if (characters === null) {
                incomplete.add('unreadable_line');
                return;
            }
            if (characters <= maxCharacters) {
                push('JP_SHORT_LAST_LINE', lastLine.line.start, { start: lastLine.line.start, end: lastLine.line.end }, lastLine.index, { ...evidence, last_line_characters: characters, max_characters: maxCharacters }, lastLine.line.start);
                shortLastLineJudged.add(lastLine.index);
            }
        };
        if (justifyBody !== null) {
            for (const paragraph of frame.paragraphs ?? []) {
                if (!('kinsoku' in paragraph))
                    continue;
                const { start, end } = paragraph;
                if (typeof start !== 'number' || typeof end !== 'number' || !Number.isInteger(start) || !Number.isInteger(end) || end <= start)
                    continue;
                const values = readJustifyBody(paragraph);
                if (values === null) {
                    incomplete.add('unreadable_paragraph_attribute');
                    continue;
                }
                paragraphsRead += 1;
                const count = (attribute, value) => {
                    const entries = observed.get(attribute);
                    entries.set(value, (entries.get(value) ?? 0) + 1);
                };
                count('justification', values.justification);
                for (const attribute of JUSTIFY_BODY_SPACING_ATTRIBUTES)
                    count(attribute, values.spacing[attribute]);
                const ownLines = linesReadable
                    ? lines.map((line, index) => ({ line, index })).filter(({ line }) => start <= line.start && line.start < end)
                    : [];
                const lastLine = ownLines.length === 0 ? null : ownLines[ownLines.length - 1];
                const lastLineOf = LAST_LINE_OF[values.justification];
                const evidence = { justification: values.justification };
                if (justifyBody.last_line !== undefined && lastLineOf !== undefined && lastLineOf !== justifyBody.last_line) {
                    push('JP_JUSTIFY_LAST_LINE', start, { start, end }, lastLine?.index ?? null, { ...evidence, expected_last_line: justifyBody.last_line }, start);
                }
                if (justifyBody.spacing_ranges !== undefined) {
                    const outside = JUSTIFY_BODY_SPACING_ATTRIBUTES.flatMap((attribute) => {
                        const bound = justifyBody.spacing_ranges[attribute];
                        const value = values.spacing[attribute];
                        if (bound === undefined)
                            return [];
                        if ((bound.at_least === undefined || value >= bound.at_least) && (bound.at_most === undefined || value <= bound.at_most))
                            return [];
                        return [{ attribute, value, at_least: bound.at_least ?? null, at_most: bound.at_most ?? null }];
                    });
                    if (outside.length > 0)
                        push('JP_SPACING_RANGE', start, { start, end }, lastLine?.index ?? null, { ...evidence, spacing: outside }, start);
                }
                const maxCharacters = justifyBody.short_last_line_max_characters;
                if (maxCharacters !== undefined && lastLineOf !== undefined)
                    shortLastLine(start, end, maxCharacters, evidence);
            }
        }
        if (paragraphShape !== null) {
            const head = paragraphShape.short_line_head;
            if (head !== undefined) {
                const classes = new Set(head.punctuation_classes);
                for (const { prevLine } of softWraps) {
                    const line = lines[prevLine + 1];
                    if (line === null || line === undefined)
                        continue;
                    let characters = 0;
                    for (let index = line.start; index < line.end && characters <= head.max_characters;) {
                        const cluster = clusterAt(contents, index);
                        if (cluster === null) {
                            incomplete.add('unreadable_line');
                            break;
                        }
                        const characterClass = jlreqClassOf(cluster.codePoint);
                        if (characterClass !== null && classes.has(characterClass)) {
                            if (characters >= 1) {
                                push('JP_SHORT_LINE_HEAD', line.start, { start: line.start, end: cluster.end }, prevLine + 1, {
                                    character: cluster.text, character_class: characterClass, head_characters: characters, max_characters: head.max_characters,
                                    prev_line_tail: clusterBefore(contents, line.start)?.text ?? null,
                                }, line.start);
                            }
                            break;
                        }
                        characters += 1;
                        index = cluster.end;
                    }
                }
            }
            const maxCharacters = paragraphShape.short_last_line_max_characters;
            if (maxCharacters !== undefined) {
                for (const paragraph of frame.paragraphs ?? []) {
                    if (!('kinsoku' in paragraph))
                        continue;
                    const { start, end } = paragraph;
                    if (typeof start !== 'number' || typeof end !== 'number' || !Number.isInteger(start) || !Number.isInteger(end) || end <= start)
                        continue;
                    shortLastLine(start, end, maxCharacters, {});
                }
            }
        }
        if (settingProfile !== null) {
            const outcome = judgeSettingProfileFrame({ uuid: frame.uuid, name: frame.name, contents, kind: frame.kind, orientation: frame.orientation,
                rawLines: frame.lines }, policy.paragraphShapeExtra?.frames.find((entry) => entry.uuid === frame.uuid), settingProfile);
            for (const draft of outcome.findings)
                push(draft.rule, draft.anchor, draft.range, null, draft.evidence, draft.stateOffset, draft.source);
            profileSkipped.push(...outcome.skipped);
            profileHeights.push(...outcome.heights);
            if (outcome.measured)
                profileFramesMeasured += 1;
        }
        if (shapeExtra) {
            const outcome = judgeShapeExtraFrame({ uuid: frame.uuid, name: frame.name, contents, rawLines: frame.lines, lines, linesReadable }, policy.paragraphShapeExtra?.frames.find((entry) => entry.uuid === frame.uuid), { looseLine: paragraphShape.loose_line, settingCombination: paragraphShape.setting_combination }, jlreqClassOf);
            for (const draft of outcome.findings)
                push(draft.rule, draft.anchor, draft.range, draft.lineIndex, draft.evidence, draft.stateOffset);
            shapeSkipped.push(...outcome.skipped);
            shapeLinesJudged += outcome.linesJudged;
            if (outcome.measured)
                shapeFramesMeasured += 1;
        }
        if (latin !== null) {
            const latinParagraphs = [];
            for (const paragraph of frame.paragraphs ?? []) {
                if (!('kinsoku' in paragraph))
                    continue;
                const { start, end } = paragraph;
                if (typeof start !== 'number' || typeof end !== 'number' || !Number.isInteger(start) || !Number.isInteger(end) || end <= start)
                    continue;
                latinParagraphs.push({ start, end,
                    justification: latinNeeds.justification ? readJustifyBody(paragraph)?.justification ?? null : null,
                    hyphenation: latinNeeds.hyphenation ? readHyphenation(paragraph) : null });
            }
            const judged = evaluateLatinBodyFrame({ input: latin, protectedTerms: policy.protectedTerms }, {
                contents, orientation: frame.orientation, lines, linesReadable, softWraps, paragraphs: latinParagraphs
            });
            for (const raw of judged.findings) {
                const meta = LATIN_RULE_META[raw.rule];
                const line = lineAt(raw.lineIndex);
                collected.push({ frameOrder, anchor: raw.anchor, finding: {
                        rule_id: raw.rule, severity: meta.severity, determinism: meta.determinism, source_class: meta.source_class,
                        source_ref: meta.source_ref, target, range: raw.range, line_index: raw.lineIndex,
                        evidence: { line_start: line?.start ?? null, line_end: line?.end ?? null, character: null, character_class: null,
                            prev_line_tail: null, next_line_head: null, ...raw.evidence },
                        current_state: null, recommendation: meta.recommendation, can_auto_fix: false, required_capability: null,
                    } });
            }
            for (const entry of judged.skipped) {
                const key = `${entry.rule}:${entry.reason}`;
                const known = latinSkips.get(key);
                if (known === undefined)
                    latinSkips.set(key, { rule: entry.rule, reason: entry.reason, frames: 1 });
                else
                    known.frames += 1;
            }
            for (const reason of judged.incomplete)
                incomplete.add(reason);
        }
    });
    const latinRulesSkipped = [];
    if (latin !== null) {
        for (const rule of LATIN_DEFERRED_RULES.filter((candidate) => latin.rules.includes(candidate))) {
            latinRulesSkipped.push({ rule_id: rule, reason: LATIN_DEFERRED_REASON[rule], frames: null });
        }
        latinRulesSkipped.push(...[...latinSkips.values()].map((entry) => ({ rule_id: entry.rule, reason: entry.reason, frames: entry.frames })));
        const requestOrder = [...LATIN_RULES, ...LATIN_DEFERRED_RULES];
        latinRulesSkipped.sort((left, right) => requestOrder.indexOf(left.rule_id) - requestOrder.indexOf(right.rule_id) ||
            LATIN_SKIP_REASONS.indexOf(left.reason) - LATIN_SKIP_REASONS.indexOf(right.reason));
        if (latinRulesSkipped.length > 0)
            incomplete.add('rule_skipped');
    }
    collected.sort((left, right) => left.frameOrder - right.frameOrder || left.anchor - right.anchor ||
        RULE_ORDER.get(left.finding.rule_id) - RULE_ORDER.get(right.finding.rule_id) ||
        left.finding.range.start - right.finding.range.start || left.finding.range.end - right.finding.range.end);
    const findings = collected.map((entry) => entry.finding);
    if (shapeSkipped.length > 0)
        incomplete.add('paragraph_shape_unmeasured');
    if (profileSkipped.length > 0)
        incomplete.add('setting_profile_unmeasured');
    const base = {
        policies,
        policy: lineBreak ? {
            id: 'jp_line_break_v1',
            line_start_relaxations: LINE_START_RELAXATIONS.filter((relaxation) => relaxations.has(relaxation)),
            halfwidth_punctuation: policy.halfwidthPunctuation,
            protected_term_count: policy.protectedTerms.length,
        } : null,
        justify_body: justifyBody === null ? null : {
            rules_run: [
                ...(justifyBody.last_line === undefined ? [] : ['JP_JUSTIFY_LAST_LINE']),
                ...(justifyBody.spacing_ranges === undefined ? [] : ['JP_SPACING_RANGE']),
                ...(justifyBody.short_last_line_max_characters === undefined ? [] : ['JP_SHORT_LAST_LINE']),
            ],
            paragraphs_read: paragraphsRead,
            observed: JUSTIFY_BODY_ATTRIBUTES.map((attribute) => {
                const values = [...observed.get(attribute).entries()].map(([value, paragraph_count]) => ({ value, paragraph_count }))
                    .sort((left, right) => right.paragraph_count - left.paragraph_count || (typeof left.value === 'number' && typeof right.value === 'number'
                    ? left.value - right.value : String(left.value).localeCompare(String(right.value))));
                const kept = values.slice(0, OBSERVED_VALUE_LIMIT);
                return { attribute, values: kept, other_paragraph_count: values.slice(OBSERVED_VALUE_LIMIT).reduce((sum, entry) => sum + entry.paragraph_count, 0) };
            }),
            host_new_document_default: { ...HOST_NEW_DOCUMENT_DEFAULTS },
            host_default_source: HOST_DEFAULTS_SOURCE,
        },
        ...(latin === null ? {} : { latin_body: {
                rules_run: LATIN_RULES.filter((rule) => latin.rules.includes(rule)),
                rules_skipped: latinRulesSkipped,
            } }),
        ...(settingProfile === null ? {} : { setting_profile: {
                rules_run: settingProfileRulesRun(settingProfile),
                ...(settingProfile.preset === undefined ? {} : { preset: settingProfilePresetReport(settingProfile) }),
                frames_measured: profileFramesMeasured, skipped: profileSkipped,
                ...(settingProfile.frame_extent === undefined ? {} : { frame_heights: profileHeights })
            } }),
        paragraph_shape: paragraphShape === null ? null : { rules_run: [
                ...(paragraphShape.short_line_head === undefined ? [] : ['JP_SHORT_LINE_HEAD']),
                ...(paragraphShape.short_last_line_max_characters === undefined ? [] : ['JP_SHORT_LAST_LINE']),
                ...(paragraphShape.loose_line === undefined ? [] : ['JP_LOOSE_LINE']),
                ...(paragraphShape.setting_combination === undefined ? [] : ['JP_PARAGRAPH_SETTING_COMBINATION']),
            ], ...(shapeExtra ? { measurement: { frames_measured: shapeFramesMeasured, lines_judged: shapeLinesJudged, skipped: shapeSkipped } } : {}) },
        document: host.document,
        coverage: { frames_in_scope: host.framesInScope, frames_audited: host.frames.length,
            frames_skipped: host.skipped.map(({ uuid, name, reason }) => ({ uuid, name, reason })),
            page: { first_frame_index: startIndex, next_frame_index: nextIndex } },
    };
    return { base, findings, incomplete, startIndex, nextIndex, documentKeyShort: host.document.keyShort };
}
export function auditNextCallOf(documentKeyShort) {
    return (finding) => (NO_BREAK_RULES.has(finding.rule_id) && finding.target.orientation === 'horizontal'
        ? noBreakPlanCall(documentKeyShort, finding.target.uuid, finding.range) : undefined);
}
function buildAuditResult(page, shown, incomplete, format) {
    const reasons = JP_AUDIT_INCOMPLETE_REASONS.filter((reason) => incomplete.has(reason));
    return {
        status: reasons.length === 0 ? 'complete' : 'partial',
        ...page.base,
        incomplete: reasons,
        notes: shown.some((finding) => finding.next_call !== undefined) ? [JP_AUDIT_NO_BREAK_NOTE] : [],
        format,
        ...(format === 'findings' ? { findings: shown } : { grouped: groupFindings(shown, auditNextCallOf(page.documentKeyShort)) }),
    };
}
export function assembleAuditResult(page, options) {
    if (options.skip > page.findings.length)
        throw new Error('The cursor skips more findings than the page holds.');
    const available = page.findings.slice(options.skip);
    const countLimit = Math.min(options.maxFindings, available.length);
    const build = (shown, incomplete) => buildAuditResult(page, shown, incomplete, options.format);
    const withLimits = (shown) => {
        const incomplete = new Set([...page.incomplete, ...(options.extraIncomplete ?? [])]);
        if (countLimit < available.length)
            incomplete.add('finding_limit');
        if (shown < countLimit)
            incomplete.add('response_limit');
        return incomplete;
    };
    let shown = countLimit;
    if (options.maxResponseBytes !== undefined && countLimit > 1) {
        const budget = options.maxResponseBytes - (options.reserveBytes ?? 0);
        const fits = (count) => Buffer.byteLength(JSON.stringify(build(available.slice(0, count), withLimits(count))), 'utf8') <= budget;
        let low = 1;
        let high = countLimit;
        while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            if (fits(middle))
                low = middle;
            else
                high = middle - 1;
        }
        shown = low;
    }
    const incomplete = withLimits(shown);
    const parsed = jpAuditResultSchema.parse(build(available.slice(0, shown), incomplete));
    const next = shown < available.length ? { offset: page.startIndex, skip: options.skip + shown }
        : page.nextIndex !== null ? { offset: page.nextIndex, skip: 0 } : null;
    return { result: parsed, next };
}
export function fitAuditPage(host, policy, full, options) {
    const whole = { page: full, extraIncomplete: [], frames: host.frames.length, cut: false };
    if (options.skip > 0 || host.frames.length < 2 || full.findings.length === 0)
        return whole;
    const frameCount = host.frames.length;
    const perFrame = new Map();
    for (const finding of full.findings)
        perFrame.set(finding.target.uuid, (perFrame.get(finding.target.uuid) ?? 0) + 1);
    const ends = [0];
    for (const frame of host.frames)
        ends.push(ends[ends.length - 1] + (perFrame.get(frame.uuid) ?? 0));
    if (ends[frameCount] !== full.findings.length)
        throw new Error('A finding belongs to no frame of its page; the read is not reported.');
    const budget = options.maxResponseBytes === undefined ? undefined : options.maxResponseBytes - (options.reserveBytes ?? 0);
    const measure = (frames) => {
        const count = ends[frames];
        const incomplete = new Set([...full.incomplete, ...(frames < frameCount ? ['response_limit'] : [])]);
        const bytes = Buffer.byteLength(JSON.stringify(buildAuditResult(full, full.findings.slice(0, count), incomplete, options.format)), 'utf8');
        return { countExceeded: count > options.maxFindings, bytesExceeded: budget !== undefined && bytes > budget };
    };
    const fits = (frames) => { const m = measure(frames); return !m.countExceeded && !m.bytesExceeded; };
    if (fits(frameCount))
        return whole;
    if (host.frames.some((frame) => frame.index === undefined) || host.skipped.some((entry) => entry.index === undefined)) {
        throw new Error('A page cannot be cut at a frame because the host did not return where its frames are in the scope.');
    }
    let low = 0;
    let high = frameCount - 1;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (fits(middle))
            low = middle;
        else
            high = middle - 1;
    }
    const kept = Math.max(1, low);
    const missing = kept === low ? measure(kept + 1) : null;
    const cutIndex = host.frames[kept].index;
    const keptUuids = new Set(host.frames.slice(0, kept).map((frame) => frame.uuid));
    const shorter = { ...host, frames: host.frames.slice(0, kept), skipped: host.skipped.filter((entry) => entry.index < cutIndex),
        nextIndex: cutIndex, stop: 'scan_limit' };
    const shorterPolicy = policy.paragraphShapeExtra === undefined ? policy
        : { ...policy, paragraphShapeExtra: { ...policy.paragraphShapeExtra, frames: policy.paragraphShapeExtra.frames.filter((entry) => keptUuids.has(entry.uuid)) } };
    const extraIncomplete = [];
    if (missing !== null) {
        if (missing.countExceeded)
            extraIncomplete.push('finding_limit');
        if (missing.bytesExceeded || !missing.countExceeded)
            extraIncomplete.push('response_limit');
    }
    return { page: judgeJapaneseTypographyPage(shorter, shorterPolicy), extraIncomplete, frames: kept, cut: true };
}
export function judgeJapaneseTypography(host, policy) {
    return assembleAuditResult(judgeJapaneseTypographyPage(host, policy), { format: 'findings', skip: 0, maxFindings: policy.maxFindings }).result;
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
