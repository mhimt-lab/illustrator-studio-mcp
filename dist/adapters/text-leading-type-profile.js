import { z } from 'zod';
import { isParagraphBreak } from './point-text-multiline.js';
export const TEXT_LEADING_TYPES = ['top_to_top', 'bottom_to_bottom'];
export const textLeadingTypeSchema = z.enum(TEXT_LEADING_TYPES);
export const TEXT_LEADING_TYPE_NATIVE = Object.freeze({
    top_to_top: 'AutoLeadingType.TOPTOTOP',
    bottom_to_bottom: 'AutoLeadingType.BOTTOMTOBOTTOM',
});
export const paragraphStyleRequestSchema = z.strictObject({ leadingType: textLeadingTypeSchema });
export const publicParagraphStyleSchema = z.strictObject({ leading_type: textLeadingTypeSchema });
export const paragraphLeadingEntrySchema = z.strictObject({ leadingType: textLeadingTypeSchema });
export const layoutBoundsSchema = z.tuple([
    z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite(),
]);
export const LEADING_TYPE_REASONS = [
    'leading_type_requires_multiple_paragraphs',
    'leading_type_requires_layer_direct',
    'leading_type_range_must_be_one_paragraph',
    'leading_type_unchanged',
    'leading_type_paragraph_attributes_mixed',
    'leading_type_requires_standard_character_style',
    'leading_type_requires_standard_paragraph_style',
    'leading_type_requires_left_justification',
    'leading_type_snapshot_missing',
];
export function leadingParagraphSpans(contents) {
    const spans = [];
    let begin = 0;
    for (const part of contents.split('\r')) {
        spans.push({ start: begin, end: begin + part.length });
        begin += part.length + 1;
    }
    return spans;
}
export function isLeadingSnapshot(snapshot) {
    return snapshot.paragraphLeading !== undefined;
}
export function checkLeadingTypeRequest(before, start, end, requested) {
    if (before.paragraphLeading === undefined)
        return { reason: 'leading_type_snapshot_missing' };
    if (!before.contents.includes('\r'))
        return { reason: 'leading_type_requires_multiple_paragraphs' };
    const spans = leadingParagraphSpans(before.contents);
    const index = spans.findIndex((span) => span.start === start && span.end === end);
    if (index < 0)
        return { reason: 'leading_type_range_must_be_one_paragraph' };
    if (before.paragraphLeading[index]?.leadingType === requested)
        return { reason: 'leading_type_unchanged' };
    return null;
}
export function leadingParagraphUniform(characters, start, end) {
    let first = null;
    for (let index = start; index < end; index += 1) {
        const entry = characters[index];
        if (isParagraphBreak(entry))
            return false;
        const { contents: _contents, ...style } = entry;
        const key = JSON.stringify(sortKeys(style));
        if (first === null)
            first = key;
        else if (first !== key)
            return false;
    }
    return first !== null;
}
function sortKeys(value) {
    if (Array.isArray(value))
        return value.map(sortKeys);
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([key, entry]) => [key, sortKeys(entry)]));
    }
    return value;
}
export function assertLeadingTypeAlone(style, paragraphStyle) {
    if (paragraphStyle === undefined)
        return;
    if (Object.keys(style).some((key) => style[key] !== undefined)) {
        throw new Error('A point-text paragraph_style edit must not be combined with character style attributes; request them separately.');
    }
}
export const TEXT_LEADING_TYPE_MODULE_SCRIPT = `var STYLE_LEADING_NATIVE_NAMES = ${JSON.stringify(TEXT_LEADING_TYPE_NATIVE)};

/** The shared pins without the two this path records per character / per paragraph instead of pinning. */
var STYLE_PINNED_CHARACTER_FOR_LEADING = (function () {
  var table = {};
  for (var name in POINT_TEXT_PINNED.character) {
    if (POINT_TEXT_PINNED.character.hasOwnProperty(name) && name !== "autoLeading") table[name] = POINT_TEXT_PINNED.character[name];
  }
  return table;
})();
var STYLE_PINNED_PARAGRAPH_FOR_LEADING = (function () {
  var table = {};
  for (var name in POINT_TEXT_PINNED.paragraph) {
    if (POINT_TEXT_PINNED.paragraph.hasOwnProperty(name) && name !== "leadingType") table[name] = POINT_TEXT_PINNED.paragraph[name];
  }
  return table;
})();

function styleLeadingRefuse(code, message) {
  throw mutationError("preflight_failed", code + ": " + message);
}

function styleLeadingPublic(value) {
  var name = String(value);
  for (var key in STYLE_LEADING_NATIVE_NAMES) {
    if (STYLE_LEADING_NATIVE_NAMES.hasOwnProperty(key) && STYLE_LEADING_NATIVE_NAMES[key] === name) return key;
  }
  throw mutationError("preflight_failed", "Point-text leading type is outside the measured top_to_top and bottom_to_bottom: " + name + ".");
}

function styleLeadingNative(publicName) {
  if (publicName === "top_to_top") return AutoLeadingType.TOPTOTOP;
  if (publicName === "bottom_to_bottom") return AutoLeadingType.BOTTOMTOBOTTOM;
  throw mutationError("preflight_failed", "Point-text leading type must be top_to_top or bottom_to_bottom.");
}

/** Twin of pointTextParagraphState for one paragraph, with the leading type recorded instead of pinned. Returns its attributes. */
function styleLeadingParagraphState(paragraph) {
  var attributes;
  try { attributes = paragraph.paragraphAttributes; }
  catch (paragraphError) { throw mutationError("preflight_failed", "Target paragraph attributes are unavailable."); }
  pointTextAssertPinned(attributes, STYLE_PINNED_PARAGRAPH_FOR_LEADING, "paragraph attribute");
  var listStyle;
  try { listStyle = attributes.listStyle; }
  catch (listStyleError) { throw mutationError("preflight_failed", "Target paragraph list style is unavailable."); }
  if (!listStyle) throw mutationError("preflight_failed", "Target paragraph list style is unavailable.");
  pointTextAssertTypedError(listStyle, "name", POINT_TEXT_LIST_STYLE_UNBOUND_ERROR, "paragraph list style");
  var tabStops;
  try { tabStops = attributes.tabStops; }
  catch (tabStopError) { throw mutationError("preflight_failed", "Target tab stops are unavailable."); }
  if (!tabStops || typeof tabStops.length !== "number" || tabStops.length !== 0) {
    throw mutationError("preflight_failed", "Point-text operations do not support tab stops.");
  }
  return attributes;
}

/** Twin of pointTextCharacterFingerprint with autoLeading recorded instead of pinned; the held character keeps its handle alive. */
function styleLeadingFingerprint(character) {
  var attributes;
  try { attributes = character.characterAttributes; }
  catch (attributesError) {
    throw mutationError("preflight_failed", "A character's attributes are unavailable.");
  }
  pointTextAssertPinned(attributes, STYLE_PINNED_CHARACTER_FOR_LEADING, "character attribute");
  var font = attributes.textFont;
  if (!font || typeof font.name !== "string" || !font.name) {
    throw mutationError("preflight_failed", "A character's font identity is unavailable.");
  }
  var located = null;
  try { located = app.textFonts.getByName(font.name); }
  catch (fontError) { located = null; }
  if (located === null || located === undefined || located !== font) {
    throw mutationError("preflight_failed", "A character's font is not installed.");
  }
  var fillColor = pointTextReadFillColor(attributes.fillColor);
  var strokeColor = attributes.strokeColor;
  if (!strokeColor || String(strokeColor.typename) !== "NoColor") {
    throw mutationError("preflight_failed", "Point-text range operations support unstroked characters only.");
  }
  var autoLeading = attributes.autoLeading;
  if (typeof autoLeading !== "boolean") {
    throw mutationError("preflight_failed", "A character's auto leading state is unavailable.");
  }
  return {
    contents: String(character.contents),
    font: { postScriptName: font.name, family: font.family, style: font.style },
    size: pointTextNumber(attributes.size, "characterAttributes.size"),
    tracking: pointTextNumber(attributes.tracking, "characterAttributes.tracking"),
    horizontalScale: pointTextNumber(attributes.horizontalScale, "characterAttributes.horizontalScale"),
    verticalScale: pointTextNumber(attributes.verticalScale, "characterAttributes.verticalScale"),
    leading: pointTextNumber(attributes.leading, "characterAttributes.leading"),
    fillColor: fillColor,
    strokeColor: { model: "none" },
    autoLeading: autoLeading
  };
}

/** One entry per UTF-16 unit; a CR is a sentinel and its Character is never acquired (error 9503). */
function styleLeadingFingerprints(target, text) {
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
      var fingerprint = styleLeadingFingerprint(character);
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

function styleLeadingBounds(target) {
  var bounds;
  try { bounds = target.geometricBounds; }
  catch (boundsError) { throw mutationError("preflight_failed", "Target frame bounds are unavailable."); }
  if (!bounds || typeof bounds.length !== "number" || bounds.length !== 4) {
    throw mutationError("preflight_failed", "Target frame bounds are unavailable.");
  }
  var out = [];
  for (var index = 0; index < 4; index++) {
    out.push(pointTextCanonicalChannel(pointTextNumber(bounds[index], "frame.geometricBounds"), "geometricBounds"));
  }
  return out;
}

/**
 * The snapshot of a frame for a paragraph_style request: the multi-paragraph structure with every character's auto leading, every
 * paragraph's leading type and the frame's bounds recorded. A layer-direct, unthreaded frame with at least two paragraphs only.
 */
function styleLeadingSnapshot(document, target, expectedUuid) {
  var groups = pointTextGroupAncestry(target);
  if (groups.length !== 0) {
    styleLeadingRefuse("leading_type_requires_layer_direct", "paragraph_style edits are admitted for text directly in a layer, not inside a group.");
  }
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
  var text = pointTextMultilineContents(target.contents, "Target contents");
  if (text.indexOf("\\r") < 0) {
    styleLeadingRefuse("leading_type_requires_multiple_paragraphs", "paragraph_style edits are measured on frames with at least two paragraphs.");
  }
  var lengths = pointTextMultilineParagraphLengths(text);
  var paragraphs = target.paragraphs;
  if (lengths === null || !paragraphs || typeof paragraphs.length !== "number" || paragraphs.length !== lengths.length) {
    throw mutationError("preflight_failed", "Target paragraph structure is unavailable or does not match the CR positions.");
  }
  var shared = null;
  var begin = 0;
  var leadingTypes = [];
  for (var index = 0; index < lengths.length; index++) {
    var paragraph = paragraphs[index];
    var attributes = styleLeadingParagraphState(paragraph);
    var justification = pointTextSupportedJustification(attributes.justification);
    if (shared === null) shared = justification;
    else if (shared !== justification) {
      throw mutationError("preflight_failed", "Multi-paragraph point text supports one shared justification only.");
    }
    if (paragraph.start !== begin || paragraph.end !== begin + lengths[index]) {
      throw mutationError("preflight_failed", "Target paragraph offsets do not match the CR positions.");
    }
    leadingTypes.push({ leadingType: styleLeadingPublic(attributes.leadingType) });
    begin += lengths[index] + 1;
  }
  return {
    uuid: target.uuid,
    type: target.typename,
    kind: "TextType.POINTTEXT",
    profile: POINT_TEXT_PROFILE,
    frameShape: pointTextFrameShape(target),
    storyFrameCount: 1,
    manualKerning: "none",
    tabStopCount: 0,
    justification: shared,
    characters: styleLeadingFingerprints(target, text),
    frame: pointTextFrameState(target),
    layerPath: layerPath,
    layerAncestry: pointTextAncestry(target),
    contents: text,
    locked: target.locked,
    hidden: target.hidden,
    editable: target.editable,
    layerVisible: target.layer.visible,
    layerLocked: target.layer.locked,
    paragraphLeading: leadingTypes,
    layoutBounds: styleLeadingBounds(target)
  };
}

/** The index of the paragraph the request selects; a range that is not exactly one whole paragraph is refused. */
function styleLeadingIndex(before) {
  var begin = 0;
  var parts = before.contents.split("\\r");
  for (var index = 0; index < parts.length; index++) {
    var end = begin + parts[index].length;
    if (begin === params.start && end === params.end) return index;
    begin = end + 1;
  }
  styleLeadingRefuse("leading_type_range_must_be_one_paragraph", "the range must select exactly one whole paragraph.");
}

/**
 * Admission of the request on the resolved target: a whole paragraph, a different value, uniform characters of the standard
 * character style under the standard paragraph style.
 */
function styleLeadingAssert(target, before) {
  var index = styleLeadingIndex(before);
  if (before.paragraphLeading[index].leadingType === params.paragraphStyle.leadingType) {
    styleLeadingRefuse("leading_type_unchanged", "the paragraph already has the requested leading type.");
  }
  if (before.justification !== "Justification.LEFT") {
    styleLeadingRefuse("leading_type_requires_left_justification", "the paragraph reset that undoes a top_to_top change is measured on left-justified text only.");
  }
  var first = null;
  var characters = pointTextCharacters(target);
  for (var position = params.start; position < params.end; position++) {
    var key = pointTextMultilineStyleKey(before.characters[position]);
    if (first === null) first = key;
    else if (first !== key) {
      styleLeadingRefuse("leading_type_paragraph_attributes_mixed", "the characters of the paragraph must share every attribute; the paragraph reset that undoes a top_to_top change is measured on uniform paragraphs only.");
    }
    var character = characters[position];
    var names = [];
    var standard;
    try {
      var applied = character.characterStyles;
      for (var appliedIndex = 0; appliedIndex < applied.length; appliedIndex++) names.push(String(applied[appliedIndex].name));
      standard = String(app.activeDocument.characterStyles[0].name);
    } catch (styleError) {
      styleLeadingRefuse("leading_type_requires_standard_character_style", "the applied character style cannot be read, so the edit is refused.");
    }
    if (names.length !== 1 || names[0] !== standard) {
      styleLeadingRefuse("leading_type_requires_standard_character_style", "the paragraph's characters must carry the standard character style.");
    }
  }
  var paragraph = target.paragraphs[index];
  var paragraphNames = [];
  var standardParagraph;
  try {
    var paragraphApplied = paragraph.paragraphStyles;
    for (var paragraphIndex = 0; paragraphIndex < paragraphApplied.length; paragraphIndex++) {
      paragraphNames.push(String(paragraphApplied[paragraphIndex].name));
    }
    standardParagraph = String(app.activeDocument.paragraphStyles[0].name);
  } catch (paragraphStyleError) {
    styleLeadingRefuse("leading_type_requires_standard_paragraph_style", "the applied paragraph style cannot be read, so the edit is refused.");
  }
  if (paragraphNames.length !== 1 || paragraphNames[0] !== standardParagraph) {
    styleLeadingRefuse("leading_type_requires_standard_paragraph_style", "the paragraph must carry the standard paragraph style.");
  }
  return index;
}

function styleLeadingPredictAfter(before) {
  var index = styleLeadingIndex(before);
  var after = {};
  for (var field in before) if (before.hasOwnProperty(field)) after[field] = before[field];
  var leading = [];
  for (var position = 0; position < before.paragraphLeading.length; position++) {
    leading.push(position === index ? { leadingType: params.paragraphStyle.leadingType } : before.paragraphLeading[position]);
  }
  after.paragraphLeading = leading;
  after.layoutBounds = null;
  return after;
}

/** The snapshot without the observed bounds, which a plan cannot predict; the bounds must still be four numbers. */
function styleLeadingWithoutBounds(snapshot) {
  var copy = {};
  for (var field in snapshot) if (snapshot.hasOwnProperty(field)) copy[field] = snapshot[field];
  var bounds = snapshot.layoutBounds;
  if (bounds === null || bounds === undefined || typeof bounds.length !== "number" || bounds.length !== 4) return null;
  copy.layoutBounds = null;
  return copy;
}

function styleSameAfter(actual, expected) {
  if (params.paragraphStyle === undefined) return styleSame(actual, expected);
  var stripped = styleLeadingWithoutBounds(actual);
  return stripped !== null && styleSame(stripped, expected);
}

/** Writes the before values of auto leading, size, (manual only) leading and the free character fields back; only what differs from the host is written. */
function styleLeadingRewrite(target, start, end, source) {
  var characters = pointTextCharacters(target);
  for (var index = start; index < end; index++) {
    // The character and its attributes must be held (error 9503 otherwise).
    var character = characters[index];
    var attributes = character.characterAttributes;
    var wanted = source.characters[index];
    if (attributes.autoLeading !== wanted.autoLeading) attributes.autoLeading = wanted.autoLeading;
    if (pointTextCanonicalChannel(pointTextNumber(attributes.size, "characterAttributes.size"), "size") !== wanted.size) {
      attributes.size = wanted.size;
    }
    if (wanted.autoLeading === false &&
        pointTextCanonicalChannel(pointTextNumber(attributes.leading, "characterAttributes.leading"), "leading") !== wanted.leading) {
      attributes.leading = wanted.leading;
    }
    // Not measured to change under the reset (F0-2 used default values); written back only when they differ, and verified like all the rest.
    if (pointTextCanonicalChannel(pointTextNumber(attributes.tracking, "characterAttributes.tracking"), "tracking") !== wanted.tracking) {
      attributes.tracking = wanted.tracking;
    }
    if (pointTextCanonicalChannel(pointTextNumber(attributes.horizontalScale, "characterAttributes.horizontalScale"), "horizontalScale") !== wanted.horizontalScale) {
      attributes.horizontalScale = wanted.horizontalScale;
    }
    if (pointTextCanonicalChannel(pointTextNumber(attributes.verticalScale, "characterAttributes.verticalScale"), "verticalScale") !== wanted.verticalScale) {
      attributes.verticalScale = wanted.verticalScale;
    }
    if (!attributes.textFont || attributes.textFont.name !== wanted.font.postScriptName) {
      attributes.textFont = app.textFonts.getByName(wanted.font.postScriptName);
    }
    if (pointTextCanonicalJson(pointTextReadFillColor(attributes.fillColor)) !== pointTextCanonicalJson(wanted.fillColor)) {
      attributes.fillColor = pointTextNativeFillColor(wanted.fillColor);
    }
  }
}

/**
 * Sets the leading type of the paragraph to \`wanted\`. bottom_to_bottom is a direct write. top_to_top is the default value, whose
 * direct write is silently ignored (measured), so the paragraph is reset with the standard paragraph style and its characters are
 * given their \`source\` auto leading, size and leading back.
 */
function styleLeadingSet(target, index, wanted, source) {
  var paragraph = target.paragraphs[index];
  var attributes = paragraph.paragraphAttributes;
  if (wanted === "bottom_to_bottom") {
    if (styleLeadingPublic(attributes.leadingType) !== "bottom_to_bottom") attributes.leadingType = styleLeadingNative("bottom_to_bottom");
  } else if (styleLeadingPublic(attributes.leadingType) !== "top_to_top") {
    app.activeDocument.paragraphStyles[0].applyTo(paragraph, true);
  }
  var span = pointTextMultilineParagraphLengths(source.contents);
  var begin = 0;
  for (var position = 0; position < index; position++) begin += span[position] + 1;
  styleLeadingRewrite(target, begin, begin + span[index], source);
}

function styleLeadingForward(target, before) {
  styleLeadingSet(target, styleLeadingIndex(before), params.paragraphStyle.leadingType, before);
}

/** Puts the paragraph back to its \`before\` state (the rollback of either direction). */
function styleLeadingRestore(target, before) {
  var index = styleLeadingIndex(before);
  styleLeadingSet(target, index, before.paragraphLeading[index].leadingType, before);
}

/** A rollback proceeds only when nothing outside the target paragraph moved; inside it, the restore rewrites everything it touches. */
function styleLeadingOutsideSame(current, before) {
  var index = styleLeadingIndex(before);
  var copy = {};
  for (var field in current) if (current.hasOwnProperty(field)) copy[field] = current[field];
  var characters = [];
  for (var position = 0; position < current.characters.length; position++) {
    characters.push(position >= params.start && position < params.end ? before.characters[position] : current.characters[position]);
  }
  copy.characters = characters;
  var leading = [];
  for (var paragraph = 0; paragraph < current.paragraphLeading.length; paragraph++) {
    leading.push(paragraph === index ? before.paragraphLeading[paragraph] : current.paragraphLeading[paragraph]);
  }
  copy.paragraphLeading = leading;
  copy.layoutBounds = before.layoutBounds;
  return styleSame(copy, before);
}

function styleRollbackAcceptable(current, target, before) {
  if (params.paragraphStyle === undefined) return styleSame(current, stylePredictAfter(target, before));
  return styleLeadingOutsideSame(current, before);
}

`;
