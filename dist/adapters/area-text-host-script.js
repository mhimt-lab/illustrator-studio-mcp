import { z } from 'zod';
import { layerPathSchema } from '../mutation-result-schema-core.js';
import { PLAIN_POINT_TEXT_V1, POINT_TEXT_MAX_LAYER_DEPTH_LIMIT, pointTextFillColorSchema } from './point-text-host-script.js';
export const AREA_TEXT_MAX_CODE_UNITS = 5_000;
export const AREA_TEXT_MAX_LINES = 2_000;
export const AREA_TEXT_PROFILE_NAME = 'plain_area_text_v1';
export const AREA_TEXT_MAX_LAYER_DEPTH_LIMIT = POINT_TEXT_MAX_LAYER_DEPTH_LIMIT;
export const AREA_TEXT_JUSTIFICATIONS = [
    'Justification.LEFT', 'Justification.CENTER', 'Justification.RIGHT',
];
const areaTextJustificationSchema = z.enum(AREA_TEXT_JUSTIFICATIONS);
export const PLAIN_AREA_TEXT_V1 = {
    character: PLAIN_POINT_TEXT_V1.character,
    paragraph: PLAIN_POINT_TEXT_V1.paragraph,
    frame: {
        artworkKnockout: 'o:KnockoutState.DISABLED', blendingMode: 'o:BlendModes.NORMAL', columnCount: '1',
        columnGutter: '0', contentVariable: 'undefined', flowLinksHorizontally: 'true', isIsolated: 'false',
        opacity: '100', opticalAlignment: 'false', orientation: 'o:TextOrientation.HORIZONTAL', rowCount: '1',
        rowGutter: '0', sliced: 'false', spacing: '0', visibilityVariable: 'null', wrapped: 'false',
    },
    listStyleUnboundErrorNumber: PLAIN_POINT_TEXT_V1.listStyleUnboundErrorNumber,
};
export const areaTextContentsSchema = z.string()
    .min(1)
    .max(AREA_TEXT_MAX_CODE_UNITS)
    .regex(/^[^\r]+$/u, 'Area-text contents must not contain a carriage return or U+0003.')
    .regex(/[^\n]/u, 'Area-text contents must contain at least one non-newline character.');
const areaTextStyleSchema = z.strictObject({
    font: z.strictObject({
        postScriptName: z.string().min(1).max(255),
        family: z.string().min(1).max(255),
        style: z.string().min(1).max(255),
    }),
    size: z.number().finite().positive(),
    tracking: z.number().finite(),
    horizontalScale: z.number().finite().positive(),
    verticalScale: z.number().finite().positive(),
    leading: z.number().finite().positive(),
    fillColor: pointTextFillColorSchema,
    strokeColor: z.strictObject({ model: z.literal('none') }),
    justification: areaTextJustificationSchema,
});
const areaTextFrameSchema = z.strictObject({
    geometricBounds: z.tuple([
        z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite(),
    ]),
    matrix: z.strictObject({
        a: z.number().finite(), b: z.number().finite(), c: z.number().finite(),
        d: z.number().finite(), tx: z.number().finite(), ty: z.number().finite(),
    }),
    antialias: z.string().min(1).max(255),
    pixelAligned: z.boolean(),
    tagCount: z.literal(0),
});
const areaTextLayerAncestorSchema = z.strictObject({
    name: z.string().max(255),
    visible: z.boolean(),
    locked: z.boolean(),
});
export const areaTextFitSchema = z.strictObject({
    status: z.literal('fits'),
    visibleCharacterCount: z.number().int().nonnegative(),
    requestedCharacterCount: z.number().int().nonnegative(),
    lineCount: z.number().int().nonnegative().max(AREA_TEXT_MAX_LINES),
});
export const areaTextSnapshotSchema = z.strictObject({
    uuid: z.string().min(1).max(255),
    type: z.literal('TextFrame'),
    kind: z.literal('TextType.AREATEXT'),
    profile: z.literal(AREA_TEXT_PROFILE_NAME),
    frameShape: z.literal('area_text_unthreaded'),
    fontInstalled: z.literal(true),
    storyFrameCount: z.literal(1),
    textRunCount: z.literal(1),
    manualKerning: z.literal('none'),
    tabStopCount: z.literal(0),
    fit: areaTextFitSchema,
    style: areaTextStyleSchema,
    frame: areaTextFrameSchema,
    layerPath: layerPathSchema,
    layerAncestry: z.array(areaTextLayerAncestorSchema).min(1).max(AREA_TEXT_MAX_LAYER_DEPTH_LIMIT),
    contents: areaTextContentsSchema,
    locked: z.boolean(),
    hidden: z.boolean(),
    editable: z.boolean(),
    layerVisible: z.boolean(),
    layerLocked: z.boolean(),
});
const CARRIAGE_RETURN = String.fromCharCode(13);
const NEWLINE = String.fromCharCode(10);
const INLINE_GRAPHIC = String.fromCharCode(3);
export const AREA_TEXT_SNAPSHOT_SCRIPT = `
var AREA_TEXT_MAX_CODE_UNITS = ${AREA_TEXT_MAX_CODE_UNITS};
var AREA_TEXT_MAX_LINES = ${AREA_TEXT_MAX_LINES};
var AREA_TEXT_PROFILE = ${JSON.stringify(AREA_TEXT_PROFILE_NAME)};
var AREA_TEXT_MAX_LAYER_DEPTH = ${AREA_TEXT_MAX_LAYER_DEPTH_LIMIT};
var AREA_TEXT_PINNED = ${JSON.stringify({
    character: PLAIN_AREA_TEXT_V1.character,
    paragraph: PLAIN_AREA_TEXT_V1.paragraph,
    frame: PLAIN_AREA_TEXT_V1.frame,
})};
var AREA_TEXT_LIST_STYLE_UNBOUND_ERROR = ${PLAIN_AREA_TEXT_V1.listStyleUnboundErrorNumber};
var AREA_TEXT_CARRIAGE_RETURN = String.fromCharCode(13);
var AREA_TEXT_NEWLINE = String.fromCharCode(10);
var AREA_TEXT_INLINE_GRAPHIC = String.fromCharCode(3);

/** Drops paragraph separators in either spelling, plus the inline-graphic marker. */
function areaTextStripBreaks(value) {
  var out = "";
  for (var index = 0; index < value.length; index++) {
    var code = value.charCodeAt(index);
    if (code === 13 || code === 10 || code === 3) continue;
    out += value.charAt(index);
  }
  return out;
}

/** The request spells paragraph breaks as newlines; Illustrator stores carriage returns. */
function areaTextHostContents(value) {
  var out = "";
  for (var index = 0; index < value.length; index++) {
    out += value.charCodeAt(index) === 10 ? AREA_TEXT_CARRIAGE_RETURN : value.charAt(index);
  }
  return out;
}

function areaTextValidateContents(value, name) {
  if (typeof value !== "string" || value.length < 1 || value.length > AREA_TEXT_MAX_CODE_UNITS ||
      value.indexOf(AREA_TEXT_CARRIAGE_RETURN) >= 0 || value.indexOf(AREA_TEXT_INLINE_GRAPHIC) >= 0 ||
      areaTextStripBreaks(value).length < 1) {
    throw mutationError("preflight_failed", name + " must be 1 to " + AREA_TEXT_MAX_CODE_UNITS +
      " UTF-16 code units of body text, with paragraphs separated by a newline and no carriage return.");
  }
  return value;
}

/**
 * Concatenates the visible lines with every paragraph separator removed. An unreadable line leaves the
 * visible text unknown, which is reported rather than guessed.
 */
function areaTextVisibleText(target) {
  var lines;
  try { lines = target.lines; }
  catch (linesError) { return { status: "indeterminate", reason: "lines_unavailable", lineCount: -1 }; }
  if (!lines || typeof lines.length !== "number") {
    return { status: "indeterminate", reason: "lines_unavailable", lineCount: -1 };
  }
  var lineCount = Number(lines.length);
  if (!isFinite(lineCount) || lineCount < 0 || lineCount > AREA_TEXT_MAX_LINES) {
    return { status: "indeterminate", reason: "line_count_out_of_range", lineCount: lineCount };
  }
  var joined = "";
  for (var index = 0; index < lineCount; index++) {
    var contents;
    try { contents = String(lines[index].contents); }
    catch (lineError) { return { status: "indeterminate", reason: "line_unreadable", lineCount: lineCount }; }
    joined += areaTextStripBreaks(contents);
  }
  return { status: "value", joined: joined, lineCount: lineCount };
}

/**
 * Proves whether the frame shows the whole requested story.
 *
 * "fits" requires the visible text to equal the requested text exactly. A visible text that is a
 * strict prefix of the request is proven overflow. Anything else — a mismatch that is not a prefix, or
 * an unreadable line — is indeterminate and fails closed; it is never reported as success.
 */
function areaTextFit(target, requestedContents) {
  var expected = areaTextStripBreaks(requestedContents);
  var visible = areaTextVisibleText(target);
  if (visible.status !== "value") {
    return { status: "indeterminate", reason: visible.reason, visibleCharacterCount: -1,
      requestedCharacterCount: expected.length, lineCount: visible.lineCount };
  }
  if (visible.joined === expected) {
    return { status: "fits", reason: "visible_text_equals_request",
      visibleCharacterCount: visible.joined.length,
      requestedCharacterCount: expected.length, lineCount: visible.lineCount };
  }
  if (visible.joined.length < expected.length &&
      expected.substring(0, visible.joined.length) === visible.joined) {
    return { status: "overflows", reason: "visible_text_is_a_prefix",
      visibleCharacterCount: visible.joined.length,
      requestedCharacterCount: expected.length, lineCount: visible.lineCount };
  }
  return { status: "indeterminate", reason: "visible_text_does_not_match_request",
    visibleCharacterCount: visible.joined.length,
    requestedCharacterCount: expected.length, lineCount: visible.lineCount };
}

function areaTextParagraphState(range) {
  var paragraph;
  try { paragraph = range.paragraphAttributes; }
  catch (paragraphError) { throw mutationError("preflight_failed", "Target paragraph attributes are unavailable."); }
  pointTextAssertPinned(paragraph, AREA_TEXT_PINNED.paragraph, "paragraph attribute");
  var listStyle;
  try { listStyle = paragraph.listStyle; }
  catch (listStyleError) { throw mutationError("preflight_failed", "Target paragraph list style is unavailable."); }
  if (!listStyle) throw mutationError("preflight_failed", "Target paragraph list style is unavailable.");
  pointTextAssertTypedError(listStyle, "name", AREA_TEXT_LIST_STYLE_UNBOUND_ERROR, "paragraph list style");
  var tabStops;
  try { tabStops = paragraph.tabStops; }
  catch (tabStopError) { throw mutationError("preflight_failed", "Target tab stops are unavailable."); }
  if (!tabStops || typeof tabStops.length !== "number") {
    throw mutationError("preflight_failed", "Target tab stops are unavailable.");
  }
  if (tabStops.length !== 0) {
    throw mutationError("preflight_failed", "Area-text operations do not support tab stops.");
  }
  return 0;
}

function areaTextStyle(target) {
  var range = target.textRange;
  var attributes;
  var font;
  var fillColor;
  var strokeColor;
  var justification;
  try {
    attributes = range.characterAttributes;
    font = attributes.textFont;
    fillColor = attributes.fillColor;
    strokeColor = attributes.strokeColor;
    justification = range.paragraphAttributes.justification;
  } catch (styleError) {
    throw mutationError("preflight_failed", "Area-text style or font is unavailable.");
  }
  if (!font || typeof font.name !== "string" || !font.name || typeof font.family !== "string" ||
      !font.family || typeof font.style !== "string" || !font.style) {
    throw mutationError("preflight_failed", "Area-text font identity is unavailable.");
  }
  // Identity, not just a name match, so a substituted or missing font cannot pass as installed.
  var located = null;
  try { located = app.textFonts.getByName(font.name); }
  catch (fontCatalogError) { located = null; }
  if (located === null || located === undefined || located !== font) {
    throw mutationError("preflight_failed", "Area-text font is not installed.");
  }
  pointTextAssertPinned(attributes, AREA_TEXT_PINNED.character, "character attribute");
  // The same reader as point text: RGB, CMYK or Gray whatever the document space; writes are gated separately.
  var readFillColor = pointTextReadFillColor(fillColor);
  if (!strokeColor || String(strokeColor.typename) !== "NoColor") {
    throw mutationError("preflight_failed", "Area-text operations support unstroked characters only.");
  }
  return {
    font: { postScriptName: font.name, family: font.family, style: font.style },
    size: pointTextNumber(attributes.size, "characterAttributes.size"),
    tracking: pointTextNumber(attributes.tracking, "characterAttributes.tracking"),
    horizontalScale: pointTextNumber(attributes.horizontalScale, "characterAttributes.horizontalScale"),
    verticalScale: pointTextNumber(attributes.verticalScale, "characterAttributes.verticalScale"),
    leading: pointTextNumber(attributes.leading, "characterAttributes.leading"),
    fillColor: readFillColor,
    strokeColor: { model: "none" },
    justification: pointTextSupportedJustification(justification)
  };
}

function areaTextFrameState(target) {
  pointTextAssertPinned(target, AREA_TEXT_PINNED.frame, "frame property");
  var matrix;
  try { matrix = target.matrix; }
  catch (matrixError) { throw mutationError("preflight_failed", "Target frame matrix is unavailable."); }
  var geometricBounds;
  try { geometricBounds = target.geometricBounds; }
  catch (boundsError) { throw mutationError("preflight_failed", "Target frame bounds are unavailable."); }
  if (!geometricBounds || typeof geometricBounds.length !== "number" || geometricBounds.length !== 4) {
    throw mutationError("preflight_failed", "Target frame bounds are unavailable.");
  }
  var tagCount;
  try { tagCount = target.tags.length; }
  catch (tagError) { throw mutationError("preflight_failed", "Target frame tag state is unavailable."); }
  if (tagCount !== 0) {
    throw mutationError("preflight_failed", "Area-text operations do not support a target that carries tags.");
  }
  if (typeof target.pixelAligned !== "boolean") {
    throw mutationError("preflight_failed", "Target frame state is unavailable.");
  }
  return {
    geometricBounds: [
      pointTextNumber(geometricBounds[0], "frame.geometricBounds[0]"),
      pointTextNumber(geometricBounds[1], "frame.geometricBounds[1]"),
      pointTextNumber(geometricBounds[2], "frame.geometricBounds[2]"),
      pointTextNumber(geometricBounds[3], "frame.geometricBounds[3]")
    ],
    matrix: {
      a: pointTextNumber(matrix.mValueA, "frame.matrix.a"), b: pointTextNumber(matrix.mValueB, "frame.matrix.b"),
      c: pointTextNumber(matrix.mValueC, "frame.matrix.c"), d: pointTextNumber(matrix.mValueD, "frame.matrix.d"),
      tx: pointTextNumber(matrix.mValueTX, "frame.matrix.tx"), ty: pointTextNumber(matrix.mValueTY, "frame.matrix.ty")
    },
    antialias: String(target.antialias),
    pixelAligned: target.pixelAligned,
    tagCount: 0
  };
}

/**
 * The complete area-text snapshot, or a thrown failure. The requested contents are the request as the
 * caller spelled it; fit is proved against that, never against what the frame happens to hold.
 */
function areaTextSnapshot(document, target, expectedUuid, requestedContents) {
  if (!target || target.typename !== "TextFrame") {
    throw mutationError("preflight_failed", "Area-text operations support TextFrame targets only.");
  }
  if (target.kind !== TextType.AREATEXT) {
    throw mutationError("preflight_failed", "Area-text operations support TextType.AREATEXT only.");
  }
  if (typeof target.uuid !== "string" || (expectedUuid !== null && target.uuid !== expectedUuid)) {
    throw mutationError("preflight_failed", "Target native UUID is unavailable or changed.");
  }
  if (!target.layer || target.parent !== target.layer) {
    throw mutationError("preflight_failed", "Area-text target must be directly contained by its layer.");
  }
  // Threading is unsupported (measured operation), so the story must hold exactly this frame.
  if (!target.story || !target.story.textFrames ||
      target.story.textFrames.length !== 1 || target.story.textFrames[0] !== target) {
    throw mutationError("preflight_failed", "Area-text operations support unthreaded text only.");
  }
  if (typeof target.locked !== "boolean" || typeof target.hidden !== "boolean" ||
      typeof target.editable !== "boolean" || typeof target.layer.visible !== "boolean" ||
      typeof target.layer.locked !== "boolean") {
    throw mutationError("preflight_failed", "Target safety state is unavailable.");
  }
  var layerPath = pointTextLayerPath(document, target.layer);
  if (layerPath === null) throw mutationError("preflight_failed", "Target layer path is unavailable.");
  var textRange = target.textRange;
  if (!textRange || typeof textRange.getTextRunLength !== "function" ||
      typeof textRange.length !== "number" || textRange.length < 1) {
    throw mutationError("preflight_failed", "Target native text-run state is unavailable.");
  }
  var firstRunLength;
  try { firstRunLength = textRange.getTextRunLength(); }
  catch (textRunError) {
    throw mutationError("preflight_failed", "Target native text-run state is unavailable.");
  }
  if (typeof firstRunLength !== "number" || firstRunLength !== textRange.length) {
    throw mutationError("preflight_failed", "Area-text operations support one complete native text style run only.");
  }
  var fit = areaTextFit(target, requestedContents);
  if (fit.status === "overflows") {
    throw mutationError("verify_mismatch", "The area text overflows its frame: " + fit.visibleCharacterCount +
      " of " + fit.requestedCharacterCount + " requested characters are visible across " + fit.lineCount +
      " lines. Enlarge the rectangle or shorten the text.");
  }
  if (fit.status !== "fits") {
    throw mutationError("verify_mismatch", "The area text fit cannot be proved (" + fit.reason + "): " +
      fit.visibleCharacterCount + " visible of " + fit.requestedCharacterCount +
      " requested characters across " + fit.lineCount + " lines.");
  }
  return {
    uuid: target.uuid,
    type: target.typename,
    kind: "TextType.AREATEXT",
    profile: AREA_TEXT_PROFILE,
    frameShape: "area_text_unthreaded",
    fontInstalled: true,
    storyFrameCount: 1,
    textRunCount: 1,
    manualKerning: pointTextManualKerning(textRange),
    tabStopCount: areaTextParagraphState(textRange),
    fit: { status: "fits", visibleCharacterCount: fit.visibleCharacterCount,
      requestedCharacterCount: fit.requestedCharacterCount, lineCount: fit.lineCount },
    style: areaTextStyle(target),
    frame: areaTextFrameState(target),
    layerPath: layerPath,
    layerAncestry: pointTextAncestry(target),
    contents: requestedContents,
    locked: target.locked,
    hidden: target.hidden,
    editable: target.editable,
    layerVisible: target.layer.visible,
    layerLocked: target.layer.locked
  };
}
`;
export function areaTextStripBreaks(value) {
    let out = '';
    for (const character of value) {
        if (character === CARRIAGE_RETURN || character === NEWLINE || character === INLINE_GRAPHIC)
            continue;
        out += character;
    }
    return out;
}
