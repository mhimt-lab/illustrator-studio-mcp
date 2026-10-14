import { z } from 'zod';
import { canonicalSha256 } from '../mutation-canonical.js';
import { clusterHostTable, validateClusterRange } from './point-text-cluster.js';
import { POINT_TEXT_MAX_CODE_UNITS, pointTextCharacterSchema, pointTextRangeGroupSnapshotSchema, } from './point-text-host-script.js';
export const POINT_TEXT_MULTILINE_MAX_PARAGRAPHS = 32;
export function splitBreakUnits(text) {
    const units = [];
    let start = 0, paragraph = 0, line = 0;
    for (let index = 0; index <= text.length; index += 1) {
        const value = text.charAt(index);
        if (index !== text.length && value !== '\r' && value !== '\u0003')
            continue;
        units.push({ start, end: index, paragraph, line, endsWith: index === text.length ? 'end' : value === '\r' ? 'cr' : 'line_break' });
        if (value === '\r') {
            paragraph += 1;
            line = 0;
        }
        else
            line += 1;
        start = index + 1;
    }
    return units;
}
export const pointTextParagraphBreakSchema = z.strictObject({
    contents: z.literal('\r'),
    kind: z.literal('paragraph_break'),
});
export const pointTextMultilineReplacementSchema = z.string().max(POINT_TEXT_MAX_CODE_UNITS)
    .regex(/^(?:[^\r\n\u0003]*|\r)$/u, 'A point-text range replacement must be free of line breaks, or be exactly one CR.');
export const multilineContentsSchema = z.string().min(1).max(POINT_TEXT_MAX_CODE_UNITS)
    .regex(/^[^\n\u0003]+$/u, 'Point-text contents may use CR paragraph breaks only.');
export function isParagraphBreak(entry) {
    return entry.kind === 'paragraph_break';
}
export function multilineParagraphLengths(contents) {
    const parts = contents.split('\r');
    if (parts.length > POINT_TEXT_MULTILINE_MAX_PARAGRAPHS || parts.some((part) => part.length === 0))
        return null;
    return parts.map((part) => part.length);
}
export function refineMultilineSnapshot(snapshot, context) {
    const hasBreak = snapshot.contents.includes('\r');
    if (!hasBreak) {
        if (snapshot.characters.some(isParagraphBreak)) {
            context.addIssue({ code: 'custom', message: 'A snapshot without a CR must not carry paragraph-break entries.' });
        }
        return;
    }
    if (multilineParagraphLengths(snapshot.contents) === null) {
        context.addIssue({ code: 'custom', message: 'Multi-paragraph point text must have 1 to 32 non-empty paragraphs.' });
    }
    if (snapshot.characters.length !== snapshot.contents.length) {
        context.addIssue({ code: 'custom', message: 'A multi-paragraph snapshot must hold one entry per UTF-16 unit.' });
        return;
    }
    for (let index = 0; index < snapshot.contents.length; index += 1) {
        const entry = snapshot.characters[index];
        const isCr = snapshot.contents.charAt(index) === '\r';
        if (isCr !== isParagraphBreak(entry) || (!isCr && entry.contents !== snapshot.contents.charAt(index))) {
            context.addIssue({ code: 'custom', message: 'Every snapshot entry must match the contents unit at its index; a CR is a paragraph break.' });
            return;
        }
    }
}
export const pointTextMultilineRangeGroupSnapshotSchema = pointTextRangeGroupSnapshotSchema.extend({
    contents: multilineContentsSchema,
    characters: z.array(z.union([pointTextCharacterSchema, pointTextParagraphBreakSchema]))
        .min(1).max(POINT_TEXT_MAX_CODE_UNITS),
}).superRefine(refineMultilineSnapshot);
export const multilineRejectionSchema = z.enum([
    'range_crosses_paragraph',
    'paragraph_split_unsupported',
    'paragraph_edge_unsupported',
    'too_many_paragraphs',
    'multiline_style_unsupported',
]);
function styleKey(entry) {
    return canonicalSha256({ ...entry, contents: '' });
}
export function isMultilineEdit(beforeContents, replacement) {
    return beforeContents.includes('\r') || replacement.includes('\r');
}
export function checkMultilineReplacement(before, start, end, replacement) {
    if (!isMultilineEdit(before.contents, replacement))
        return null;
    if (before.contents.slice(start, end).includes('\r'))
        return { reason: 'range_crosses_paragraph' };
    if (replacement.includes('\r') && replacement !== '\r')
        return { reason: 'paragraph_split_unsupported' };
    if (replacement === '\r') {
        if (end - start !== 1)
            return { reason: 'paragraph_split_unsupported' };
        if (start === 0 || end >= before.contents.length ||
            before.contents.charAt(start - 1) === '\r' || before.contents.charAt(end) === '\r') {
            return { reason: 'paragraph_edge_unsupported' };
        }
    }
    else if (replacement.length === 0) {
        if (start === 0 || before.contents.charAt(start - 1) === '\r')
            return { reason: 'paragraph_edge_unsupported' };
        const clusterRejection = validateClusterRange(before.contents, start - 1, end);
        if (clusterRejection !== null)
            return clusterRejection;
        const neighbour = before.characters[start - 1];
        const first = before.characters[start];
        if (neighbour === undefined || first === undefined || isParagraphBreak(neighbour) || isParagraphBreak(first) ||
            styleKey(neighbour) !== styleKey(first)) {
            return { reason: 'paragraph_edge_unsupported' };
        }
    }
    const result = before.contents.slice(0, start) + replacement + before.contents.slice(end);
    if (result.split('\r').length > POINT_TEXT_MULTILINE_MAX_PARAGRAPHS)
        return { reason: 'too_many_paragraphs' };
    if (result.includes('\r') && multilineParagraphLengths(result) === null)
        return { reason: 'paragraph_edge_unsupported' };
    return null;
}
export function checkMultilineStyle(before, start, end, style) {
    if (!before.contents.includes('\r'))
        return null;
    if (before.contents.slice(start, end).includes('\r'))
        return { reason: 'range_crosses_paragraph' };
    if (style !== undefined && Object.keys(style).some((key) => style[key] !== undefined &&
        key !== 'tracking' && key !== 'horizontalScale')) {
        return { reason: 'multiline_style_unsupported' };
    }
    return null;
}
export const POINT_TEXT_MULTILINE_SCRIPT = `
var POINT_TEXT_MULTILINE_MAX_PARAGRAPHS = ${POINT_TEXT_MULTILINE_MAX_PARAGRAPHS};

function pointTextMultilineIs(target) {
  var text;
  try { text = target.contents; }
  catch (contentsError) { return false; }
  return typeof text === "string" && text.indexOf("\\r") >= 0;
}

/** The characters of a frame in the measured form: the multi-paragraph path reads the text range, the single-line path unchanged. */
function pointTextCharacters(target) {
  return pointTextMultilineIs(target) ? target.textRange.characters : target.characters;
}

function pointTextMultilineContents(value, name) {
  if (typeof value !== "string" || value.length < 1 || value.length > POINT_TEXT_MAX_CODE_UNITS ||
      value.indexOf("\\n") >= 0 || value.indexOf("\\x03") >= 0) {
    throw mutationError("preflight_failed", name + " must be 1 to " + POINT_TEXT_MAX_CODE_UNITS +
      " UTF-16 code units using CR paragraph breaks only.");
  }
  var lengths = pointTextMultilineParagraphLengths(value);
  if (lengths === null) {
    throw mutationError("preflight_failed", "Multi-paragraph point text must have 1 to " +
      POINT_TEXT_MULTILINE_MAX_PARAGRAPHS + " non-empty paragraphs.");
  }
  return value;
}

/** The paragraph sizes, or null when a paragraph is empty or there are too many. */
function pointTextMultilineParagraphLengths(text) {
  var lengths = [];
  var begin = 0;
  for (var index = 0; index <= text.length; index++) {
    if (index === text.length || text.charAt(index) === "\\r") {
      if (index === begin) return null;
      lengths.push(index - begin);
      begin = index + 1;
    }
  }
  return lengths.length > POINT_TEXT_MULTILINE_MAX_PARAGRAPHS ? null : lengths;
}

/**
 * Every paragraph is read through its own handle: pinned attributes, no tab stops, no list style, one shared justification, and
 * the host start/end equal to the offsets the CR positions imply. Returns the shared justification name.
 */
function pointTextMultilineParagraphs(target, text) {
  var lengths = pointTextMultilineParagraphLengths(text);
  var paragraphs = target.paragraphs;
  if (lengths === null || !paragraphs || typeof paragraphs.length !== "number" || paragraphs.length !== lengths.length) {
    throw mutationError("preflight_failed", "Target paragraph structure is unavailable or does not match the CR positions.");
  }
  var shared = null;
  var begin = 0;
  for (var index = 0; index < lengths.length; index++) {
    var paragraph = paragraphs[index];
    pointTextParagraphState(paragraph);
    var name = pointTextSupportedJustification(paragraph.paragraphAttributes.justification);
    if (shared === null) shared = name;
    else if (shared !== name) {
      throw mutationError("preflight_failed", "Multi-paragraph point text supports one shared justification only.");
    }
    if (paragraph.start !== begin || paragraph.end !== begin + lengths[index]) {
      throw mutationError("preflight_failed", "Target paragraph offsets do not match the CR positions.");
    }
    begin += lengths[index] + 1;
  }
  return shared;
}

/**
 * One entry per UTF-16 unit. A CR is a sentinel and its Character is never acquired. The text of every other entry comes
 * from the frame string; the host character must agree with it, and no host string for a surrogate half is serialized.
 */
function pointTextMultilineFingerprints(target, text) {
  var characters = target.textRange.characters;
  if (!characters || typeof characters.length !== "number" || characters.length !== text.length) {
    throw mutationError("preflight_failed", "Target characters are unavailable or do not match the contents.");
  }
  var entries = [];
  for (var index = 0; index < text.length; index++) {
    if (text.charAt(index) === "\\r") {
      entries.push({ contents: "\\r", kind: "paragraph_break" });
      continue;
    }
    var character = characters[index];
    var manualKerning;
    try { manualKerning = character.kerning; }
    catch (kerningError) {
      if (!kerningError || Number(kerningError.number) !== 9551) {
        throw mutationError("preflight_failed", "Point-text manual kerning state is unavailable.");
      }
      var fingerprint = pointTextCharacterFingerprint(character);
      if (fingerprint.contents.length !== 1 || fingerprint.contents.charCodeAt(0) !== text.charCodeAt(index)) {
        throw mutationError("preflight_failed", "A character does not match the contents unit at its index.");
      }
      fingerprint.contents = text.charAt(index);
      entries.push(fingerprint);
      continue;
    }
    if (typeof manualKerning !== "number" || !isFinite(manualKerning)) {
      throw mutationError("preflight_failed", "Point-text manual kerning state is unavailable.");
    }
    throw mutationError("preflight_failed", "Point-text range operations do not support manual pair kerning.");
  }
  return entries;
}

/** The range snapshot of a frame whose contents hold a CR. The bound fields are the single-line ones; the structure differs. */
function pointTextMultilineRangeSnapshot(document, target, expectedUuid) {
  var groups = pointTextGroupAncestry(target);
  if (!target.story || !target.story.textFrames ||
      target.story.textFrames.length !== 1 || target.story.textFrames[0] !== target) {
    throw mutationError("preflight_failed", "Point-text operations support unthreaded text only.");
  }
  if (typeof target.locked !== "boolean" || typeof target.hidden !== "boolean" ||
      typeof target.editable !== "boolean" || typeof target.layer.visible !== "boolean" ||
      typeof target.layer.locked !== "boolean") {
    throw mutationError("preflight_failed", "Target safety state is unavailable.");
  }
  var layerPath = pointTextLayerPath(document, target.layer);
  if (layerPath === null) throw mutationError("preflight_failed", "Target layer path is unavailable.");
  var textRange = target.textRange;
  if (!textRange || typeof textRange.length !== "number" || textRange.length < 1) {
    throw mutationError("preflight_failed", "Target native text-run state is unavailable.");
  }
  var contents = pointTextMultilineContents(target.contents, "Target contents");
  var justificationName = pointTextMultilineParagraphs(target, contents);
  return pointTextWithGroups({
    uuid: target.uuid,
    type: target.typename,
    kind: "TextType.POINTTEXT",
    profile: POINT_TEXT_PROFILE,
    frameShape: pointTextFrameShape(target),
    storyFrameCount: 1,
    manualKerning: "none",
    tabStopCount: 0,
    justification: justificationName,
    characters: pointTextMultilineFingerprints(target, contents),
    frame: pointTextFrameState(target),
    layerPath: layerPath,
    layerAncestry: pointTextAncestryWithGroups(target, groups),
    contents: contents,
    locked: target.locked,
    hidden: target.hidden,
    editable: target.editable,
    layerVisible: target.layer.visible,
    layerLocked: target.layer.locked
  }, groups);
}

/**
 * Character numbers at five decimals, the canonical rounding of the measured appearance and character-style contracts.
 * The host stores a scale as a single-precision fraction, so 95 reads back as 94.9999988079071; with this step the snapshot, the
 * predicted after state, the read-back and the rollback compare the same canonical number, and the result stays exact.
 */
function pointTextRoundSnapshot(snapshot) {
  var rounded = [];
  for (var index = 0; index < snapshot.characters.length; index++) {
    var entry = snapshot.characters[index];
    if (entry.kind === "paragraph_break") { rounded.push(entry); continue; }
    var copy = {};
    for (var key in entry) if (entry.hasOwnProperty(key)) copy[key] = entry[key];
    copy.size = pointTextCanonicalChannel(entry.size, "size");
    copy.tracking = pointTextCanonicalChannel(entry.tracking, "tracking");
    copy.horizontalScale = pointTextCanonicalChannel(entry.horizontalScale, "horizontalScale");
    copy.verticalScale = pointTextCanonicalChannel(entry.verticalScale, "verticalScale");
    copy.leading = pointTextCanonicalChannel(entry.leading, "leading");
    rounded.push(copy);
  }
  snapshot.characters = rounded;
  return snapshot;
}

var POINT_TEXT_CLUSTER_TABLE = ${JSON.stringify(clusterHostTable())};

/**
 * Whether the BMP unit at offset may start a range. Mirrors isClusterBoundary for a unit that is not a surrogate (the table is
 * the TypeScript one); every surrogate half is refused, which is the same answer for a left neighbour.
 */
function pointTextMultilineBoundary(text, offset) {
  if (offset <= 0 || offset >= text.length) return true;
  var unit = text.charCodeAt(offset);
  if (unit >= 0xd800 && unit <= 0xdfff) return false;
  if (unit === POINT_TEXT_CLUSTER_TABLE.joiner || text.charCodeAt(offset - 1) === POINT_TEXT_CLUSTER_TABLE.joiner) return false;
  for (var index = 0; index < POINT_TEXT_CLUSTER_TABLE.extending.length; index++) {
    var range = POINT_TEXT_CLUSTER_TABLE.extending[index];
    if (unit >= range[0] && unit <= range[1]) return false;
  }
  return true;
}

function pointTextMultilineStyleKey(entry) {
  var copy = {};
  for (var key in entry) if (entry.hasOwnProperty(key) && key !== "contents") copy[key] = entry[key];
  return stringifyJson(copy);
}

/** Host twin of checkMultilineReplacement. Single-line text edited without a CR is outside these rules. */
function pointTextMultilineAssertEdit(before, start, end, replacement) {
  if (before.contents.indexOf("\\r") < 0 && replacement.indexOf("\\r") < 0) return;
  if (before.contents.substring(start, end).indexOf("\\r") >= 0) {
    throw mutationError("preflight_failed", "A multi-paragraph edit must stay inside one paragraph.");
  }
  if (replacement.indexOf("\\r") >= 0 && replacement !== "\\r") {
    throw mutationError("preflight_failed", "A CR may be inserted only as the whole replacement.");
  }
  if (replacement === "\\r") {
    if (end - start !== 1) {
      throw mutationError("preflight_failed", "A paragraph split replaces exactly one unit with one CR.");
    }
    if (start === 0 || end >= before.contents.length ||
        before.contents.charAt(start - 1) === "\\r" || before.contents.charAt(end) === "\\r") {
      throw mutationError("preflight_failed", "A paragraph split needs a character of the same paragraph on each side.");
    }
  } else if (replacement.length === 0) {
    if (!pointTextMultilineBoundary(before.contents, start - 1)) {
      throw mutationError("preflight_failed", "A multi-paragraph deletion must not rewrite part of a character.");
    }
    var neighbour = start === 0 ? null : before.characters[start - 1];
    var first = before.characters[start];
    if (start === 0 || before.contents.charAt(start - 1) === "\\r" || !neighbour || !first ||
        neighbour.kind === "paragraph_break" || first.kind === "paragraph_break" ||
        pointTextMultilineStyleKey(neighbour) !== pointTextMultilineStyleKey(first)) {
      throw mutationError("preflight_failed",
        "A multi-paragraph deletion needs a left neighbour in the same paragraph with the style of the removed text.");
    }
  }
  var result = before.contents.substring(0, start) + replacement + before.contents.substring(end);
  if (result.indexOf("\\r") >= 0 && pointTextMultilineParagraphLengths(result) === null) {
    throw mutationError("preflight_failed", "The edit would leave an empty paragraph or exceed " +
      POINT_TEXT_MULTILINE_MAX_PARAGRAPHS + " paragraphs.");
  }
}

/** Host twin of checkMultilineStyle. */
function pointTextMultilineAssertStyle(before, start, end, style) {
  if (before.contents.indexOf("\\r") < 0) return;
  if (before.contents.substring(start, end).indexOf("\\r") >= 0) {
    throw mutationError("preflight_failed", "A multi-paragraph style edit must stay inside one paragraph.");
  }
  for (var key in style) {
    if (style.hasOwnProperty(key) && style[key] !== undefined && key !== "tracking" && key !== "horizontalScale") {
      throw mutationError("preflight_failed",
        "Multi-paragraph point text supports tracking and horizontalScale only; " + key + " is unmeasured there.");
    }
  }
}
`;
