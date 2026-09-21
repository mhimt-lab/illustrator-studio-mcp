import { z } from 'zod';
import { layerPathSchema } from '../mutation-result-schema-core.js';
export const POINT_TEXT_MAX_CODE_UNITS = 1_000;
export const POINT_TEXT_PROFILE_NAME = 'plain_point_text_v2';
export const POINT_TEXT_JUSTIFICATIONS = [
    'Justification.LEFT', 'Justification.CENTER', 'Justification.RIGHT',
];
const pointTextJustificationSchema = z.enum(POINT_TEXT_JUSTIFICATIONS);
export const POINT_TEXT_MAX_LAYER_DEPTH_LIMIT = 64;
export const PLAIN_POINT_TEXT_V1 = {
    character: {
        Tsume: '0', akiLeft: '-1', akiRight: '-1', alignment: 'o:StyleRunAlignmentType.center',
        alternateGlyphs: 'o:AlternateGlyphsForm.DEFAULTFORM', autoLeading: 'true',
        baselineDirection: 'o:BaselineDirectionType.VerticalRotated',
        baselinePosition: 'o:FontBaselineOption.NORMALBASELINE', baselineShift: '0',
        capitalization: 'o:FontCapsOption.NORMALCAPS', connectionForms: 'true', contextualLigature: 'true',
        diacVPos: 'o:DiacVPosType.DEFAULT_POSITION', diacXOffset: '0', diacYOffset: '0',
        digitSet: 'o:DigitSetType.DEFAULT_DIGITS', dirOverride: 'o:DirOverrideType.DEFAULT_DIRECTION',
        discretionaryLigature: 'false', figureStyle: 'o:FigureStyleType.DEFAULTFIGURESTYLE', fractions: 'false',
        italics: 'false', justificationAlternates: 'false', kana: 'false',
        kashidas: 'o:KashidasType.DEFAULT_KASHIDAS', kerningMethod: 'o:AutoKernType.METRICSROMANONLY',
        language: 'o:LanguageType.ENGLISH', ligature: 'true', noBreak: 'false',
        openTypePosition: 'o:FontOpenTypePositionOption.OPENTYPEDEFAULT', ordinals: 'false', ornaments: 'false',
        overprintFill: 'false', overprintStroke: 'false', proportionalMetrics: 'false', rotation: '0',
        strikeThrough: 'false', strokeWeight: '1', stylisticAlternates: 'false', stylisticSets: '0',
        swash: 'false', tateChuYokoHorizontal: '0', tateChuYokoVertical: '0', titling: 'false',
        underline: 'false', wariChuCharactersAfterBreak: '2', wariChuCharactersBeforeBreak: '2',
        wariChuEnabled: 'false', wariChuJustification: 'o:WariChuJustificationType.WARICHUAUTOJUSTIFY',
        wariChuLineGap: '0', wariChuLines: '2', wariChuScale: '50',
    },
    paragraph: {
        autoLeadingAmount: '175', bunriKinshi: 'true', burasagariType: 'o:BurasagariTypeEnum.None',
        composerEngine: 'o:ComposerEngineType.latinCJKComposer', desiredGlyphScaling: '100',
        desiredLetterSpacing: '0', desiredWordSpacing: '100', everyLineComposer: 'false', firstLineIndent: '0',
        hyphenateCapitalizedWords: 'true', hyphenation: 'false', hyphenationPreference: '0.5',
        hyphenationZone: '36', kashidaWidth: 'o:KashidaWidthType.kashidaMedium', kinsoku: 's:Hard',
        kinsokuOrder: 'o:KinsokuOrderEnum.PUSHIN', kurikaeshiMojiShori: 'false',
        leadingType: 'o:AutoLeadingType.TOPTOTOP', leftIndent: '0', listStyleTier: '0',
        maximumConsecutiveHyphens: '0', maximumGlyphScaling: '100', maximumLetterSpacing: '0',
        maximumWordSpacing: '133.000004291534', minimumAfterHyphen: '2', minimumBeforeHyphen: '2',
        minimumGlyphScaling: '100', minimumHyphenatedWordSize: '6', minimumLetterSpacing: '0',
        minimumWordSpacing: '80.0000011920929', mojikumi: 's:GyomatsuYakumonoHankaku',
        paragraphDirection: 'o:ParagraphDirectionType.LEFT_TO_RIGHT_DIRECTION', rightIndent: '0',
        romanHanging: 'false', singleWordJustification: 'o:Justification.FULLJUSTIFY', spaceAfter: '0',
        spaceBefore: '0',
    },
    frame: {
        artworkKnockout: 'o:KnockoutState.DISABLED', blendingMode: 'o:BlendModes.NORMAL', columnCount: '1',
        columnGutter: '0', contentVariable: 'undefined', flowLinksHorizontally: 'true', isIsolated: 'false',
        opacity: '100', opticalAlignment: 'false', orientation: 'o:TextOrientation.HORIZONTAL', rowCount: '1',
        rowGutter: '0', sliced: 'false', spacing: '0', visibilityVariable: 'null', wrapped: 'false',
    },
    frameTypedErrors: {
        endTValue: 9544, firstBaseline: 9544, firstBaselineMin: 9544, nextFrame: 9544, previousFrame: 9544,
        startTValue: 9544, textPath: 9544, wrapInside: 9545, wrapOffset: 9545,
    },
    listStyleUnboundErrorNumber: 9570,
    undefinedStyleAttributeErrorNumber: 9563,
};
export const pointTextSingleLineSchema = z.string()
    .min(1)
    .max(POINT_TEXT_MAX_CODE_UNITS)
    .regex(/^[^\r\n\u0003]+$/u, 'Point-text replacement must be a non-empty single line.');
const pointTextRgbFillSchema = z.strictObject({
    model: z.literal('rgb'),
    red: z.number().finite().min(0).max(255),
    green: z.number().finite().min(0).max(255),
    blue: z.number().finite().min(0).max(255),
});
const pointTextCmykFillSchema = z.strictObject({
    model: z.literal('cmyk'),
    cyan: z.number().finite().min(0).max(100),
    magenta: z.number().finite().min(0).max(100),
    yellow: z.number().finite().min(0).max(100),
    black: z.number().finite().min(0).max(100),
});
const pointTextGrayFillSchema = z.strictObject({
    model: z.literal('gray'),
    gray: z.number().finite().min(0).max(100),
});
export const POINT_TEXT_FILL_COLOR_MODELS = ['rgb', 'cmyk', 'gray'];
export const pointTextFillColorSchema = z.discriminatedUnion('model', [
    pointTextRgbFillSchema, pointTextCmykFillSchema, pointTextGrayFillSchema,
]);
export function pointTextCanonicalChannel(value) {
    const rounded = Math.round(value * 100_000) / 100_000;
    return Object.is(rounded, -0) ? 0 : rounded;
}
export const POINT_TEXT_DOCUMENT_COLOR_SPACES = ['RGB', 'CMYK'];
export function pointTextFillCompatible(model, documentColorSpace) {
    if (model === 'gray')
        return true;
    return model === (documentColorSpace === 'RGB' ? 'rgb' : 'cmyk');
}
const requestChannel = (minimum, maximum) => z.number().finite()
    .transform(pointTextCanonicalChannel).pipe(z.number().min(minimum).max(maximum));
export const pointTextFillColorRequestSchema = z.discriminatedUnion('model', [
    z.strictObject({
        model: z.literal('rgb'),
        red: requestChannel(0, 255), green: requestChannel(0, 255), blue: requestChannel(0, 255),
    }),
    z.strictObject({
        model: z.literal('cmyk'),
        cyan: requestChannel(0, 100), magenta: requestChannel(0, 100),
        yellow: requestChannel(0, 100), black: requestChannel(0, 100),
    }),
    z.strictObject({ model: z.literal('gray'), gray: requestChannel(0, 100) }),
]);
export const pointTextPublicFillColorSchema = z.union([
    z.strictObject({
        model: z.literal('rgb').optional(),
        red: z.number().finite().min(0).max(255),
        green: z.number().finite().min(0).max(255),
        blue: z.number().finite().min(0).max(255),
    }),
    pointTextCmykFillSchema,
    pointTextGrayFillSchema,
]);
export function normalizePointTextPublicFillColor(value) {
    if (value.model === 'cmyk') {
        return { model: 'cmyk',
            cyan: pointTextCanonicalChannel(value.cyan), magenta: pointTextCanonicalChannel(value.magenta),
            yellow: pointTextCanonicalChannel(value.yellow), black: pointTextCanonicalChannel(value.black) };
    }
    if (value.model === 'gray')
        return { model: 'gray', gray: pointTextCanonicalChannel(value.gray) };
    return { model: 'rgb',
        red: pointTextCanonicalChannel(value.red), green: pointTextCanonicalChannel(value.green),
        blue: pointTextCanonicalChannel(value.blue) };
}
const pointTextStyleSchema = z.strictObject({
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
    justification: pointTextJustificationSchema,
});
const pointTextFrameSchema = z.strictObject({
    anchor: z.tuple([z.number().finite(), z.number().finite()]),
    matrix: z.strictObject({
        a: z.number().finite(), b: z.number().finite(), c: z.number().finite(),
        d: z.number().finite(), tx: z.number().finite(), ty: z.number().finite(),
    }),
    antialias: z.string().min(1).max(255),
    pixelAligned: z.boolean(),
    tagCount: z.literal(0),
});
const pointTextLayerAncestorSchema = z.strictObject({
    name: z.string().max(255),
    visible: z.boolean(),
    locked: z.boolean(),
});
export const pointTextSnapshotSchema = z.strictObject({
    uuid: z.string().min(1).max(255),
    type: z.literal('TextFrame'),
    kind: z.literal('TextType.POINTTEXT'),
    profile: z.literal(POINT_TEXT_PROFILE_NAME),
    frameShape: z.literal('point_text_unthreaded'),
    fontInstalled: z.literal(true),
    storyFrameCount: z.literal(1),
    textRunCount: z.literal(1),
    manualKerning: z.literal('none'),
    tabStopCount: z.literal(0),
    style: pointTextStyleSchema,
    frame: pointTextFrameSchema,
    layerPath: layerPathSchema,
    layerAncestry: z.array(pointTextLayerAncestorSchema).min(1).max(POINT_TEXT_MAX_LAYER_DEPTH_LIMIT),
    contents: pointTextSingleLineSchema,
    locked: z.boolean(),
    hidden: z.boolean(),
    editable: z.boolean(),
    layerVisible: z.boolean(),
    layerLocked: z.boolean(),
});
export const pointTextCharacterSchema = z.strictObject({
    contents: z.string().min(1).max(2),
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
});
export const pointTextRangeSnapshotSchema = z.strictObject({
    uuid: z.string().min(1).max(255),
    type: z.literal('TextFrame'),
    kind: z.literal('TextType.POINTTEXT'),
    profile: z.literal(POINT_TEXT_PROFILE_NAME),
    frameShape: z.literal('point_text_unthreaded'),
    storyFrameCount: z.literal(1),
    manualKerning: z.literal('none'),
    tabStopCount: z.literal(0),
    justification: pointTextJustificationSchema,
    characters: z.array(pointTextCharacterSchema).min(1).max(POINT_TEXT_MAX_CODE_UNITS),
    frame: pointTextFrameSchema,
    layerPath: layerPathSchema,
    layerAncestry: z.array(pointTextLayerAncestorSchema).min(1).max(POINT_TEXT_MAX_LAYER_DEPTH_LIMIT),
    contents: pointTextSingleLineSchema,
    locked: z.boolean(),
    hidden: z.boolean(),
    editable: z.boolean(),
    layerVisible: z.boolean(),
    layerLocked: z.boolean(),
});
export const POINT_TEXT_SNAPSHOT_SCRIPT = `
var POINT_TEXT_MAX_CODE_UNITS = ${POINT_TEXT_MAX_CODE_UNITS};
var POINT_TEXT_PROFILE = ${JSON.stringify(POINT_TEXT_PROFILE_NAME)};
var POINT_TEXT_MAX_LAYER_DEPTH = ${POINT_TEXT_MAX_LAYER_DEPTH_LIMIT};
var POINT_TEXT_PINNED = ${JSON.stringify({
    character: PLAIN_POINT_TEXT_V1.character,
    paragraph: PLAIN_POINT_TEXT_V1.paragraph,
    frame: PLAIN_POINT_TEXT_V1.frame,
})};
var POINT_TEXT_FRAME_TYPED_ERRORS = ${JSON.stringify(PLAIN_POINT_TEXT_V1.frameTypedErrors)};
var POINT_TEXT_LIST_STYLE_UNBOUND_ERROR = ${PLAIN_POINT_TEXT_V1.listStyleUnboundErrorNumber};
var POINT_TEXT_JUSTIFICATIONS = ${JSON.stringify(POINT_TEXT_JUSTIFICATIONS)};

/** Accepts only the measured alignments and returns the canonical name for the snapshot. */
function pointTextSupportedJustification(value) {
  var name = String(value);
  var supported = POINT_TEXT_JUSTIFICATIONS;
  for (var index = 0; index < supported.length; index++) {
    if (supported[index] === name) return name;
  }
  throw mutationError("preflight_failed",
    "Point-text operations support left, centre and right justification only.");
}

/**
 * Canonical encoding shared with PLAIN_POINT_TEXT_V1. Enum and object values are tagged "o:" and
 * strings "s:" so an enum whose text equals a string value can never compare equal to it.
 */
function pointTextCanonicalValue(value) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  var type = typeof value;
  if (type === "number") return isFinite(value) ? String(value) : "nonfinite";
  if (type === "boolean") return value ? "true" : "false";
  if (type === "string") return "s:" + value;
  if (type === "function") return "function";
  return "o:" + String(value);
}

function pointTextAssertPinned(host, table, scope) {
  for (var name in table) {
    if (!table.hasOwnProperty(name)) continue;
    var value;
    try { value = host[name]; }
    catch (readError) {
      throw mutationError("preflight_failed",
        "Target " + scope + " " + name + " is unreadable, so the point-text state cannot be bound.");
    }
    if (pointTextCanonicalValue(value) !== table[name]) {
      throw mutationError("preflight_failed",
        "Point-text operations do not support " + scope + " " + name + " outside profile " + POINT_TEXT_PROFILE + ".");
    }
  }
}

/**
 * A property whose read must throw a specific Illustrator error. Returning a value, or throwing a
 * different number, means the frame is not the measured unthreaded point-text shape.
 */
function pointTextAssertTypedError(host, name, expectedNumber, scope) {
  try { host[name]; }
  catch (typedError) {
    if (Number(typedError.number) === expectedNumber) return;
    throw mutationError("preflight_failed",
      "Target " + scope + " " + name + " reported an unexpected state, so the point-text shape cannot be proved.");
  }
  throw mutationError("preflight_failed",
    "Point-text operations do not support a target whose " + scope + " " + name + " is available.");
}

function pointTextFrameShape(target) {
  for (var name in POINT_TEXT_FRAME_TYPED_ERRORS) {
    if (!POINT_TEXT_FRAME_TYPED_ERRORS.hasOwnProperty(name)) continue;
    pointTextAssertTypedError(target, name, POINT_TEXT_FRAME_TYPED_ERRORS[name], "frame property");
  }
  return "point_text_unthreaded";
}

function pointTextAncestry(target) {
  var chain = [];
  var node;
  try { node = target.parent; }
  catch (parentError) { throw mutationError("preflight_failed", "Target layer ancestry is unavailable."); }
  while (chain.length <= POINT_TEXT_MAX_LAYER_DEPTH) {
    if (node === null || node === undefined) {
      throw mutationError("preflight_failed", "Target layer ancestry does not terminate at the document.");
    }
    var typename;
    try { typename = String(node.typename); }
    catch (typenameError) { throw mutationError("preflight_failed", "Target layer ancestry is unavailable."); }
    if (typename === "Document") return chain;
    if (typename !== "Layer") {
      throw mutationError("preflight_failed", "Point-text operations support layer ancestry only.");
    }
    if (typeof node.name !== "string" || typeof node.visible !== "boolean" || typeof node.locked !== "boolean") {
      throw mutationError("preflight_failed", "Target layer ancestry state is unavailable.");
    }
    chain.push({ name: node.name, visible: node.visible, locked: node.locked });
    try { node = node.parent; }
    catch (nextError) { throw mutationError("preflight_failed", "Target layer ancestry is unavailable."); }
  }
  throw mutationError("preflight_failed", "Target layer ancestry exceeds the supported depth.");
}

function pointTextFrameState(target) {
  pointTextAssertPinned(target, POINT_TEXT_PINNED.frame, "frame property");
  var matrix;
  try { matrix = target.matrix; }
  catch (matrixError) { throw mutationError("preflight_failed", "Target frame matrix is unavailable."); }
  var anchor;
  try { anchor = target.anchor; }
  catch (anchorError) { throw mutationError("preflight_failed", "Target frame anchor is unavailable."); }
  if (!anchor || typeof anchor.length !== "number" || anchor.length !== 2) {
    throw mutationError("preflight_failed", "Target frame anchor is unavailable.");
  }
  var tagCount;
  try { tagCount = target.tags.length; }
  catch (tagError) { throw mutationError("preflight_failed", "Target frame tag state is unavailable."); }
  if (tagCount !== 0) {
    throw mutationError("preflight_failed", "Point-text operations do not support a target that carries tags.");
  }
  if (typeof target.pixelAligned !== "boolean") {
    throw mutationError("preflight_failed", "Target frame state is unavailable.");
  }
  return {
    anchor: [pointTextNumber(anchor[0], "frame.anchor[0]"), pointTextNumber(anchor[1], "frame.anchor[1]")],
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

function pointTextParagraphState(range) {
  var paragraph;
  try { paragraph = range.paragraphAttributes; }
  catch (paragraphError) { throw mutationError("preflight_failed", "Target paragraph attributes are unavailable."); }
  pointTextAssertPinned(paragraph, POINT_TEXT_PINNED.paragraph, "paragraph attribute");
  var listStyle;
  try { listStyle = paragraph.listStyle; }
  catch (listStyleError) { throw mutationError("preflight_failed", "Target paragraph list style is unavailable."); }
  if (!listStyle) throw mutationError("preflight_failed", "Target paragraph list style is unavailable.");
  pointTextAssertTypedError(listStyle, "name", POINT_TEXT_LIST_STYLE_UNBOUND_ERROR, "paragraph list style");
  var tabStops;
  try { tabStops = paragraph.tabStops; }
  catch (tabStopError) { throw mutationError("preflight_failed", "Target tab stops are unavailable."); }
  if (!tabStops || typeof tabStops.length !== "number") {
    throw mutationError("preflight_failed", "Target tab stops are unavailable.");
  }
  if (tabStops.length !== 0) {
    throw mutationError("preflight_failed", "Point-text operations do not support tab stops.");
  }
  return 0;
}

function pointTextFind(document, uuid) {
  if (typeof document.getPageItemFromUuid !== "function") {
    throw mutationError("preflight_failed", "Illustrator native UUID lookup is unavailable.");
  }
  try {
    var target = document.getPageItemFromUuid(uuid);
    return target === null || target === undefined ? null : target;
  } catch (lookupError) {
    var message = lookupError && lookupError.message ? String(lookupError.message) : "";
    if (lookupError && lookupError.name === "Error" && lookupError.number === 1200 &&
        message === "an Illustrator error occurred: 1346458189 ('MRAP')") return null;
    throw lookupError;
  }
}

function pointTextLayerPath(document, targetLayer) {
  function visit(layers, prefix) {
    for (var index = 0; index < layers.length; index++) {
      var layer = layers[index];
      var path = prefix.concat([index]);
      if (layer === targetLayer) return path;
      if (path.length < 64 && layer.layers && layer.layers.length > 0) {
        var nested = visit(layer.layers, path);
        if (nested !== null) return nested;
      }
    }
    return null;
  }
  return visit(document.layers, []);
}

function pointTextValidateContents(value, name) {
  if (typeof value !== "string" || value.length < 1 || value.length > POINT_TEXT_MAX_CODE_UNITS ||
      value.indexOf("\\r") >= 0 || value.indexOf("\\n") >= 0 || value.indexOf("\\x03") >= 0) {
    throw mutationError("preflight_failed", name + " must be a non-empty single line of at most " +
      POINT_TEXT_MAX_CODE_UNITS + " UTF-16 code units.");
  }
  return value;
}

function pointTextManualKerning(textRange) {
  if (!textRange.characters || typeof textRange.characters.length !== "number") {
    throw mutationError("preflight_failed", "Point-text manual kerning state is unavailable.");
  }
  for (var characterIndex = 0; characterIndex < textRange.characters.length; characterIndex++) {
    var manualKerning;
    try { manualKerning = textRange.characters[characterIndex].kerning; }
    catch (kerningError) {
      if (kerningError && Number(kerningError.number) === 9551) continue;
      throw mutationError("preflight_failed", "Point-text manual kerning state is unavailable.");
    }
    if (typeof manualKerning !== "number" || !isFinite(manualKerning)) {
      throw mutationError("preflight_failed", "Point-text manual kerning state is unavailable.");
    }
    throw mutationError("preflight_failed", "Point-text operations do not support manual pair kerning.");
  }
  return "none";
}

function pointTextNumber(value, name) {
  return mutationFiniteNumber(value, name);
}

/** Five-decimal canonical rounding, identical to the measured appearance color contract. */
function pointTextCanonicalChannel(value, name) {
  var rounded = Math.round(pointTextNumber(value, name) * 100000) / 100000;
  return rounded === 0 ? 0 : rounded;
}

/**
 * The fill a character actually carries. Reading admits every measured explicit process model, so an
 * existing CMYK or Gray frame stays editable; writing is gated separately by
 * pointTextAssertFillCompatible.
 */
function pointTextReadFillColor(color) {
  if (!color || typeof color.typename !== "string") {
    throw mutationError("preflight_failed", "Point-text character fill is unavailable.");
  }
  if (color.typename === "RGBColor") {
    return { model: "rgb",
      red: pointTextCanonicalChannel(color.red, "fillColor.red"),
      green: pointTextCanonicalChannel(color.green, "fillColor.green"),
      blue: pointTextCanonicalChannel(color.blue, "fillColor.blue") };
  }
  if (color.typename === "CMYKColor") {
    return { model: "cmyk",
      cyan: pointTextCanonicalChannel(color.cyan, "fillColor.cyan"),
      magenta: pointTextCanonicalChannel(color.magenta, "fillColor.magenta"),
      yellow: pointTextCanonicalChannel(color.yellow, "fillColor.yellow"),
      black: pointTextCanonicalChannel(color.black, "fillColor.black") };
  }
  if (color.typename === "GrayColor") {
    return { model: "gray", gray: pointTextCanonicalChannel(color.gray, "fillColor.gray") };
  }
  throw mutationError("preflight_failed",
    "Point-text operations support RGB, CMYK and Gray character fill only.");
}

/** A value copy of a snapshot fill, so a predicted character never aliases the character it inherits from. */
function pointTextCopyFillColor(color) {
  if (!color || typeof color.model !== "string") {
    throw mutationError("preflight_failed", "Point-text character fill is unavailable.");
  }
  if (color.model === "rgb") return { model: "rgb", red: color.red, green: color.green, blue: color.blue };
  if (color.model === "cmyk") {
    return { model: "cmyk", cyan: color.cyan, magenta: color.magenta, yellow: color.yellow, black: color.black };
  }
  if (color.model === "gray") return { model: "gray", gray: color.gray };
  throw mutationError("preflight_failed", "Point-text operations support RGB, CMYK and Gray character fill only.");
}

function pointTextDocumentColorSpace(document) {
  var space;
  try { space = document.documentColorSpace; }
  catch (spaceError) { throw mutationError("preflight_failed", "The bound document color space is unavailable."); }
  if (space === DocumentColorSpace.RGB) return "RGB";
  if (space === DocumentColorSpace.CMYK) return "CMYK";
  throw mutationError("preflight_failed", "The bound document color space is unavailable.");
}

/**
 * A requested fill may only be written in its own document color space; Gray is admitted in both, and
 * nothing is ever implicitly converted (measured for appearance in the capability gate).
 */
function pointTextAssertFillCompatible(color, documentColorSpace) {
  if (!color || typeof color.model !== "string") {
    throw mutationError("preflight_failed", "The requested point-text fill color is incomplete.");
  }
  if (color.model === "gray") return;
  if (color.model === "rgb" && documentColorSpace === "RGB") return;
  if (color.model === "cmyk" && documentColorSpace === "CMYK") return;
  throw mutationError("preflight_failed", stringifyJson({ code: "POINT_TEXT_COLOR_SPACE_MISMATCH",
    requestedModel: color.model, documentColorSpace: documentColorSpace }));
}

/** The native color object for a requested fill. Callers assert compatibility first. */
function pointTextNativeFillColor(color) {
  if (color.model === "rgb") {
    var rgb = new RGBColor();
    rgb.red = color.red; rgb.green = color.green; rgb.blue = color.blue;
    return rgb;
  }
  if (color.model === "cmyk") {
    var cmyk = new CMYKColor();
    cmyk.cyan = color.cyan; cmyk.magenta = color.magenta;
    cmyk.yellow = color.yellow; cmyk.black = color.black;
    return cmyk;
  }
  if (color.model === "gray") {
    var gray = new GrayColor();
    gray.gray = color.gray;
    return gray;
  }
  throw mutationError("apply_failed", "Unsupported point-text fill color model.");
}

function pointTextStyle(target) {
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
    throw mutationError("preflight_failed", "Point-text style or font is unavailable.");
  }
  if (!font || typeof font.name !== "string" || !font.name || typeof font.family !== "string" ||
      !font.family || typeof font.style !== "string" || !font.style) {
    throw mutationError("preflight_failed", "Point-text font identity is unavailable.");
  }
  // Identity, not just a name match: the resolved font must be the very object the target uses, so a
  // substituted or missing font cannot pass as installed.
  var located = null;
  try { located = app.textFonts.getByName(font.name); }
  catch (fontCatalogError) { located = null; }
  if (located === null || located === undefined || located !== font) {
    throw mutationError("preflight_failed", "Point-text font is not installed.");
  }
  pointTextAssertPinned(attributes, POINT_TEXT_PINNED.character, "character attribute");
  var readFillColor = pointTextReadFillColor(fillColor);
  if (!strokeColor || String(strokeColor.typename) !== "NoColor") {
    throw mutationError("preflight_failed", "Point-text operations support unstroked characters only.");
  }
  var justificationName = pointTextSupportedJustification(justification);
  return {
    font: { postScriptName: font.name, family: font.family, style: font.style },
    size: pointTextNumber(attributes.size, "characterAttributes.size"),
    tracking: pointTextNumber(attributes.tracking, "characterAttributes.tracking"),
    horizontalScale: pointTextNumber(attributes.horizontalScale, "characterAttributes.horizontalScale"),
    verticalScale: pointTextNumber(attributes.verticalScale, "characterAttributes.verticalScale"),
    leading: pointTextNumber(attributes.leading, "characterAttributes.leading"),
    fillColor: readFillColor,
    strokeColor: { model: "none" },
    justification: justificationName
  };
}

function pointTextSnapshot(document, target, expectedUuid) {
  if (!target || target.typename !== "TextFrame") {
    throw mutationError("preflight_failed", "Point-text operations support TextFrame targets only.");
  }
  if (target.kind !== TextType.POINTTEXT) {
    throw mutationError("preflight_failed", "Point-text operations support TextType.POINTTEXT only.");
  }
  if (typeof target.uuid !== "string" || (expectedUuid !== null && target.uuid !== expectedUuid)) {
    throw mutationError("preflight_failed", "Target native UUID is unavailable or changed.");
  }
  if (!target.layer || target.parent !== target.layer) {
    throw mutationError("preflight_failed", "Point-text target must be directly contained by its layer.");
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
    throw mutationError("preflight_failed", "Point-text operations support one complete native text style run only.");
  }
  return {
    uuid: target.uuid,
    type: target.typename,
    kind: "TextType.POINTTEXT",
    profile: POINT_TEXT_PROFILE,
    frameShape: pointTextFrameShape(target),
    fontInstalled: true,
    storyFrameCount: 1,
    textRunCount: 1,
    manualKerning: pointTextManualKerning(textRange),
    tabStopCount: pointTextParagraphState(textRange),
    style: pointTextStyle(target),
    frame: pointTextFrameState(target),
    layerPath: layerPath,
    layerAncestry: pointTextAncestry(target),
    contents: pointTextValidateContents(target.contents, "Target contents"),
    locked: target.locked,
    hidden: target.hidden,
    editable: target.editable,
    layerVisible: target.layer.visible,
    layerLocked: target.layer.locked
  };
}

function pointTextSame(left, right) {
  return left && right && left.uuid === right.uuid && left.type === right.type && left.kind === right.kind &&
    left.profile === right.profile && left.frameShape === right.frameShape &&
    left.fontInstalled === right.fontInstalled &&
    left.storyFrameCount === right.storyFrameCount && left.textRunCount === right.textRunCount &&
    left.manualKerning === right.manualKerning && left.tabStopCount === right.tabStopCount &&
    stringifyJson(left.style) === stringifyJson(right.style) &&
    stringifyJson(left.frame) === stringifyJson(right.frame) &&
    stringifyJson(left.layerAncestry) === stringifyJson(right.layerAncestry) &&
    mutationSameSequence(left.layerPath, right.layerPath) && left.contents === right.contents &&
    left.locked === right.locked && left.hidden === right.hidden && left.editable === right.editable &&
    left.layerVisible === right.layerVisible && left.layerLocked === right.layerLocked;
}
`;
export const POINT_TEXT_APPLY_BLOCKERS = [
    'document_mutation_not_allowed',
    'target_locked',
    'target_hidden',
    'target_not_editable',
    'layer_hidden',
    'layer_locked',
];
export function pointTextApplyBlockers(mutationAllowed, before) {
    const blockers = [];
    if (!mutationAllowed)
        blockers.push('document_mutation_not_allowed');
    if (before.locked)
        blockers.push('target_locked');
    if (before.hidden)
        blockers.push('target_hidden');
    if (!before.editable)
        blockers.push('target_not_editable');
    if (before.layerAncestry.some((ancestor) => !ancestor.visible))
        blockers.push('layer_hidden');
    if (before.layerAncestry.some((ancestor) => ancestor.locked))
        blockers.push('layer_locked');
    return blockers;
}
export const POINT_TEXT_BLOCKERS_SCRIPT = `
function pointTextBlockers(context, before) {
  var blockers = [];
  if (!context.mutationAllowed) blockers.push("document_mutation_not_allowed");
  if (before.locked) blockers.push("target_locked");
  if (before.hidden) blockers.push("target_hidden");
  if (!before.editable) blockers.push("target_not_editable");
  var ancestorHidden = false;
  var ancestorLocked = false;
  for (var ancestorIndex = 0; ancestorIndex < before.layerAncestry.length; ancestorIndex++) {
    if (!before.layerAncestry[ancestorIndex].visible) ancestorHidden = true;
    if (before.layerAncestry[ancestorIndex].locked) ancestorLocked = true;
  }
  if (ancestorHidden) blockers.push("layer_hidden");
  if (ancestorLocked) blockers.push("layer_locked");
  return blockers;
}
`;
export const POINT_TEXT_CHARACTER_SCRIPT = `
function pointTextCharacterFingerprint(character) {
  var attributes;
  try { attributes = character.characterAttributes; }
  catch (attributesError) {
    throw mutationError("preflight_failed", "A character's attributes are unavailable.");
  }
  pointTextAssertPinned(attributes, POINT_TEXT_PINNED.character, "character attribute");
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
  return {
    contents: String(character.contents),
    font: { postScriptName: font.name, family: font.family, style: font.style },
    size: pointTextNumber(attributes.size, "characterAttributes.size"),
    tracking: pointTextNumber(attributes.tracking, "characterAttributes.tracking"),
    horizontalScale: pointTextNumber(attributes.horizontalScale, "characterAttributes.horizontalScale"),
    verticalScale: pointTextNumber(attributes.verticalScale, "characterAttributes.verticalScale"),
    leading: pointTextNumber(attributes.leading, "characterAttributes.leading"),
    fillColor: fillColor,
    strokeColor: { model: "none" }
  };
}

/** Every character of the frame, in order. Also proves no manual pair kerning exists at any index. */
function pointTextCharacterFingerprints(target) {
  var characters = target.characters;
  if (!characters || typeof characters.length !== "number") {
    throw mutationError("preflight_failed", "Target characters are unavailable.");
  }
  if (characters.length < 1 || characters.length > POINT_TEXT_MAX_CODE_UNITS) {
    throw mutationError("preflight_failed", "Point-text range operations support 1 to " +
      POINT_TEXT_MAX_CODE_UNITS + " UTF-16 code units.");
  }
  var fingerprints = [];
  for (var index = 0; index < characters.length; index++) {
    var character = characters[index];
    var manualKerning;
    try { manualKerning = character.kerning; }
    catch (kerningError) {
      if (!kerningError || Number(kerningError.number) !== 9551) {
        throw mutationError("preflight_failed", "Point-text manual kerning state is unavailable.");
      }
      fingerprints.push(pointTextCharacterFingerprint(character));
      continue;
    }
    if (typeof manualKerning !== "number" || !isFinite(manualKerning)) {
      throw mutationError("preflight_failed", "Point-text manual kerning state is unavailable.");
    }
    // Measured: a range replacement destroys a manual kern that spans the edited boundary, including
    // one immediately outside the requested range, so any manual kern anywhere fails closed.
    throw mutationError("preflight_failed", "Point-text range operations do not support manual pair kerning.");
  }
  return fingerprints;
}
`;
