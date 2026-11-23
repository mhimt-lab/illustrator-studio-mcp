import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { DISPLAY_SPACING_SCRATCH_LAYER, DISPLAY_SPACING_SPACE_CODES, describeSnapshotChanges, snapshotSchema } from './display-spacing.js';
import { documentContextSchema } from './mutation-result-schema-core.js';
export const LOOSE_LINE_LIMITS = { characters: 20_000, outlineCharacters: 5_000, attributeCharacters: 5_000, runs: 2_000 };
export const LOOSE_LINE_HOST_TIMEOUT_MS = 120_000;
export const LOOSE_LINE_POSITION_CLASSES = ['middle_dot', 'comma', 'bracket', 'period', 'other_punctuation', 'non_punctuation'];
export const SETTING_COMBINATION_KERNING_METHODS = ['none', 'auto', 'optical', 'metrics_roman_only'];
const KERNING_METHOD_OF = { 'AutoKernType.NOAUTOKERN': 'none', 'AutoKernType.AUTO': 'auto',
    'AutoKernType.OPTICAL': 'optical', 'AutoKernType.METRICSROMANONLY': 'metrics_roman_only' };
export const SHAPE_EXTRA_RULES = ['JP_LOOSE_LINE', 'JP_PARAGRAPH_SETTING_COMBINATION'];
export const SHAPE_SKIP_REASONS = ['legacy_text', 'legacy_text_unknown', 'not_horizontal', 'multi_column', 'transformed', 'unreadable_frame',
    'scan_limit', 'frame_changed', 'unreadable_line', 'unreadable_paragraph', 'attributes_unreadable', 'spacing_attributes_set',
    'unsupported_characters', 'outline_failed', 'glyph_correspondence', 'not_read'];
export const jpAuditLooseLineSchema = z.strictObject({
    mean_increase_em: z.number().min(0).max(4).optional(),
    max_gap_increase_em: z.number().min(0).max(4).optional(),
    max_gap_classes: z.array(z.enum(LOOSE_LINE_POSITION_CLASSES)).min(1).max(LOOSE_LINE_POSITION_CLASSES.length).optional(),
});
export const jpAuditSettingCombinationSchema = z.strictObject({
    kerning_methods: z.array(z.enum(SETTING_COMBINATION_KERNING_METHODS)).min(1).max(SETTING_COMBINATION_KERNING_METHODS.length),
    mojikumi_sets: z.array(z.string().min(1).max(255)).min(1).max(20),
});
export function shapeExtraInputError(shape) {
    const loose = shape.loose_line;
    if (loose !== undefined) {
        if (loose.mean_increase_em === undefined && loose.max_gap_increase_em === undefined) {
            return 'paragraph_shape.loose_line needs mean_increase_em or max_gap_increase_em; no threshold is assumed.';
        }
        if (loose.max_gap_classes !== undefined) {
            if (loose.max_gap_increase_em === undefined)
                return 'paragraph_shape.loose_line.max_gap_classes is used only with max_gap_increase_em.';
            if (new Set(loose.max_gap_classes).size !== loose.max_gap_classes.length)
                return 'paragraph_shape.loose_line.max_gap_classes must not repeat a class.';
        }
    }
    const combination = shape.setting_combination;
    if (combination !== undefined) {
        if (new Set(combination.kerning_methods).size !== combination.kerning_methods.length) {
            return 'paragraph_shape.setting_combination.kerning_methods must not repeat a method.';
        }
        if (new Set(combination.mojikumi_sets).size !== combination.mojikumi_sets.length) {
            return 'paragraph_shape.setting_combination.mojikumi_sets must not repeat a name.';
        }
    }
    return null;
}
export const AUDIT_PARAGRAPH_SHAPE_EXTRA_SCRIPT = `
var MUTATION_SIDE_EFFECT_ATTEMPTED = false;
var MUTATION_RUNNER_DISPOSITION = null;
var PS_MAX_CHARACTERS = ${LOOSE_LINE_LIMITS.characters};
var PS_MAX_OUTLINE_CHARACTERS = ${LOOSE_LINE_LIMITS.outlineCharacters};
var PS_MAX_ATTRIBUTE_CHARACTERS = ${LOOSE_LINE_LIMITS.attributeCharacters};
var PS_MAX_RUNS = ${LOOSE_LINE_LIMITS.runs};
var PS_MAX_PATH_POINTS = 8;
function psNow() { return new Date().getTime(); }
function psFail(code, detail) {
  detail.code = code;
  throw new Error("MCP_ERROR:" + stringifyJson(detail));
}
function psMessage(error) {
  try { return String(error && error.message ? error.message : error).substring(0, 300); } catch (messageError) { return "unreadable error"; }
}
function psRound(value) { return Math.round(Number(value) * 1000) / 1000; }
function psThrown(error) {
  try { return error && error.message ? String(error.message) : ""; } catch (messageError) { return ""; }
}
/** A scratch document: exactly one layer with the reserved name, and no file on disk. */
function psScratchDocuments() {
  var found = [];
  for (var cursor = 0; cursor < app.documents.length; cursor++) {
    var candidate = app.documents[cursor];
    var layerName = "";
    try { layerName = candidate.layers.length === 1 ? String(candidate.layers[0].name) : ""; } catch (layerError) { layerName = ""; }
    if (layerName !== params.scratchLayer) continue;
    var identity = getDocumentIdentity(candidate, cursor);
    if (identity.fileExists === true) continue;
    found.push({ key: identity.key, keyShort: identity.keyShort, name: identity.name, saved: identity.saved,
      active: app.activeDocument === candidate });
  }
  return found;
}
/** The frame, or null when the lookup says it is gone; a non-text item is reported as unreadable by the caller. */
function psFind(document, uuid) {
  if (typeof document.getPageItemFromUuid !== "function") psFail("JP_AUDIT_UUID_LOOKUP_UNAVAILABLE", { uuid: uuid });
  var target = null;
  try {
    target = document.getPageItemFromUuid(uuid);
  } catch (lookupError) {
    var message = lookupError && lookupError.message ? String(lookupError.message) : "";
    if (!(lookupError && lookupError.name === "Error" && lookupError.number === 1200 &&
        message === "an Illustrator error occurred: 1346458189 ('MRAP')")) throw lookupError;
    target = null;
  }
  if (target === null || target === undefined) return null;
  if (String(target.typename) !== "TextFrame") return null;
  return target;
}
/** The source facts a read must leave alone, and the active document and view. */
function psSnapshot(document, activeLayer) {
  var index = -1;
  for (var cursor = 0; cursor < app.documents.length; cursor++) if (app.documents[cursor] === document) index = cursor;
  var view = document.views[0];
  var center = view.centerPoint;
  return { key: getDocumentIdentity(document, index).key, index: index, saved: document.saved === true,
    documents: app.documents.length, active: app.activeDocument === document, pageItems: document.pageItems.length,
    layers: document.layers.length, selection: document.selection.length, activeLayer: document.activeLayer === activeLayer,
    views: document.views.length, zoom: view.zoom, center: [Number(center[0]), Number(center[1])], screenMode: String(view.screenMode) };
}
function psLines(frame) {
  var count = Number(frame.lines.length);
  var out = [];
  for (var index = 0; index < count; index++) {
    try {
      var line = frame.lines[index];
      out.push({ start: line.start, end: line.end, contents: String(line.contents) });
    } catch (lineError) { out.push({ error: "line_unreadable" }); }
  }
  return out;
}
/** A paragraph kinsoku or mojikumi that is None reads as error 9563 on the host (#841 P0): the setting is "none" (#871). */
function psIsNone(error) {
  try { return !!error && error.number === 9563; } catch (numberError) { return false; }
}
/** Justification, mojikumi and (policy jp_setting_profile_v1) kinsoku are read apart: an undefined mojikumi (error 9563) must not hide the others. */
function psParagraphs(frame, contents, readKinsoku, readIndents) {
  var collection = frame.paragraphs;
  var count = Number(collection.length);
  var out = [];
  for (var index = 0; index < count; index++) {
    var paragraph = null;
    try { paragraph = collection[index]; }
    catch (itemError) {
      var trailing = index === count - 1 && contents.charAt(contents.length - 1) === "\\r" && psThrown(itemError) === "No such element";
      out.push(trailing ? { trailingEmpty: true } : { error: "paragraph_unreadable" });
      continue;
    }
    var start = null;
    var end = null;
    try {
      start = paragraph.start;
      end = paragraph.end;
      var attributes = paragraph.paragraphAttributes;
      var record = { start: start, end: end, justification: String(attributes.justification), mojikumi: null };
      try { record.mojikumi = String(attributes.mojikumi); } catch (mojikumiError) { record.mojikumi = psIsNone(mojikumiError) ? "none" : null; }
      // #841: the kinsoku name is read apart as well, only for policy jp_setting_profile_v1.
      if (readKinsoku === true) {
        record.kinsoku = null;
        try { record.kinsoku = String(attributes.kinsoku); } catch (kinsokuError) { record.kinsoku = psIsNone(kinsokuError) ? "none" : null; }
      }
      // #841: the left and right indent shorten the line (JP_BETA_FRAME_EXTENT), each read apart; firstLineIndent only moves the first line and is not read.
      if (readIndents === true) {
        record.leftIndent = null;
        record.rightIndent = null;
        try { record.leftIndent = attributes.leftIndent; } catch (leftIndentError) { record.leftIndent = null; }
        try { record.rightIndent = attributes.rightIndent; } catch (rightIndentError) { record.rightIndent = null; }
      }
      out.push(record);
    } catch (paragraphError) {
      var empty = typeof start === "number" && start === end && psThrown(paragraphError) === "Illegal Argument";
      out.push(empty ? { start: start, end: end, empty: true } : { error: "paragraph_unreadable" });
    }
  }
  return out;
}
/**
 * Character runs: the attributes that decide the nominal advance of a character, read character by character (the route
 * measured for #625, #645 and LL6; the text-run collection of a range is not readable on stable 30.8.2) and merged on the host into maximal
 * spans of equal values, so that the wire carries a few runs instead of one record per character. The character handle is
 * held in a variable (an attribute read off a temporary fails with error 9503). Nothing is defaulted: a value that cannot
 * be read throws, and the caller records the runs as unreadable.
 */
function psRuns(frame, length, readLeading) {
  var characters = frame.textRange.characters;
  var count = Number(characters.length);
  if (count !== length) return { error: "characters_not_covering" };
  var out = [];
  var last = null;
  for (var index = 0; index < count; index++) {
    var character = characters[index];
    var attributes = character.characterAttributes;
    var kerning = null;
    try { kerning = character.kerning; }
    catch (kerningError) {
      if (!(kerningError && kerningError.number === 9551)) throw kerningError;
      kerning = null;
    }
    var size = attributes.size;
    var tracking = attributes.tracking;
    var horizontalScale = attributes.horizontalScale;
    var verticalScale = attributes.verticalScale;
    var tsume = attributes.Tsume;
    var akiLeft = attributes.akiLeft;
    var akiRight = attributes.akiRight;
    var method = String(attributes.kerningMethod);
    var palt = attributes.proportionalMetrics;
    // #871: the leading, for the height formula of frame_extent only; each is read apart and null when it cannot be read, so that the other rules are not lost.
    var autoLeading;
    var leading;
    if (readLeading === true) {
      autoLeading = null;
      leading = null;
      try { autoLeading = attributes.autoLeading; } catch (autoLeadingError) { autoLeading = null; }
      if (autoLeading === false) {
        try { leading = attributes.leading; } catch (leadingError) { leading = null; }
      }
    }
    if (last !== null && last.size === size && last.tracking === tracking && last.horizontalScale === horizontalScale && last.verticalScale === verticalScale && last.tsume === tsume &&
        last.akiLeft === akiLeft && last.akiRight === akiRight && last.kerning === kerning && last.method === method && last.palt === palt &&
        last.autoLeading === autoLeading && last.leading === leading) {
      last.end = index + 1;
      continue;
    }
    if (out.length >= PS_MAX_RUNS) return { error: "too_many_runs" };
    last = { start: index, end: index + 1, size: size, tracking: tracking, horizontalScale: horizontalScale, verticalScale: verticalScale, tsume: tsume, akiLeft: akiLeft,
      akiRight: akiRight, kerning: kerning, method: method, palt: palt };
    if (readLeading === true) { last.autoLeading = autoLeading; last.leading = leading; }
    out.push(last);
  }
  return out;
}
/**
 * #841: the inset and the text path of an area frame, for JP_BETA_FRAME_EXTENT. The text path's own bounds are not readable
 * (error 21), so its points are read: anchor and both handles of each, the handles Node needs to tell a corner from a curve.
 * Each point is held in a variable before its members are read.
 */
function psExtent(frame) {
  var spacing = psRound(frame.spacing);
  var points = frame.textPath.pathPoints;
  var count = Number(points.length);
  if (count > PS_MAX_PATH_POINTS) return { spacing: spacing, pointCount: count, points: null };
  var out = [];
  for (var index = 0; index < count; index++) {
    var point = points[index];
    var anchor = point.anchor;
    var left = point.leftDirection;
    var right = point.rightDirection;
    out.push({ anchor: [psRound(anchor[0]), psRound(anchor[1])], left: [psRound(left[0]), psRound(left[1])], right: [psRound(right[0]), psRound(right[1])] });
  }
  return { spacing: spacing, pointCount: count, points: out };
}
function psMatrixIdentity(frame) {
  var matrix = frame.matrix;
  return !(Math.abs(matrix.mValueA - 1) > 1e-4 || Math.abs(matrix.mValueB) > 1e-4 || Math.abs(matrix.mValueC) > 1e-4 ||
    Math.abs(matrix.mValueD - 1) > 1e-4);
}
/** The leaf items of an outlined frame: one compound path or path per inked character, possibly inside groups. */
function psLeaves(item, out, depth) {
  var typename = String(item.typename);
  if (typename === "GroupItem") {
    if (depth > 8) throw new Error("outline_depth");
    var children = item.pageItems;
    for (var child = 0; child < children.length; child++) psLeaves(children[child], out, depth + 1);
  } else if (typename === "CompoundPathItem" || typename === "PathItem") {
    var bounds = item.geometricBounds;
    out.push([psRound(bounds[0]), psRound(bounds[1]), psRound(bounds[2]), psRound(bounds[3])]);
  } else { throw new Error("outline_item:" + typename); }
}
function psHasJustified(paragraphs) {
  for (var index = 0; index < paragraphs.length; index++) {
    var justification = paragraphs[index].justification;
    if (typeof justification === "string" && justification.indexOf("Justification.FULLJUSTIFY") === 0) return true;
  }
  return false;
}

// #841: what policy jp_setting_profile_v1 adds to this one read, absent for the other callers: runs (every frame's character attributes), kinsoku,
// extent, and justifiedRuns (the two #709 rules are also asked, so the runs of a fully justified frame are read whatever runs says).
var psProfile = params.settingProfile === undefined || params.settingProfile === null ? null : params.settingProfile;
var psLeftovers = params.outline === true ? psScratchDocuments() : [];
if (psLeftovers.length > 0) psFail("JP_AUDIT_SCRATCH_LEFT_OPEN", { documents: psLeftovers });
var psContext = requireDocumentForRead(params.expectedDocumentKey);
var psDocument = app.activeDocument;
var psSavedBefore = psDocument.saved === true;
var psLegacy;
try { psLegacy = { count: Number(psDocument.legacyTextItems.length) }; } catch (psLegacyError) { psLegacy = { error: true }; }
if (psLegacy.count !== undefined && !(psLegacy.count >= 0)) psLegacy = { error: true };
var psFrames = [];
var psToOutline = [];
var psOutlineCharacters = 0;
var psAttributeCharacters = 0;
for (var psIndex = 0; psIndex < params.frames.length; psIndex++) {
  var psUuid = params.frames[psIndex].uuid;
  var psFrame = null;
  try { psFrame = psFind(psDocument, psUuid); }
  catch (psFindError) {
    if (psMessage(psFindError).indexOf("MCP_ERROR:") === 0) throw psFindError;
    psFrame = null;
  }
  if (psFrame === null) { psFrames.push({ uuid: psUuid, status: "skipped", reason: "unreadable_frame" }); continue; }
  var psRecord = { uuid: psUuid, status: "read", facts: null, outline: { status: "skipped", reason: params.outline === true ? "unreadable_frame" : "not_requested" } };
  try {
    var psContents = String(psFrame.contents);
    var psKind = psFrame.kind;
    var psFacts = { contents: psContents, lines: null, orientation: null, paragraphs: null, runs: null, columns: null, transformed: null };
    if (psContents.length > PS_MAX_CHARACTERS) { psFrames.push({ uuid: psUuid, status: "skipped", reason: "scan_limit" }); continue; }
    var psRawOrientation = String(psFrame.orientation);
    psFacts.orientation = psRawOrientation === "TextOrientation.HORIZONTAL" ? "horizontal" : (psRawOrientation === "TextOrientation.VERTICAL" ? "vertical" : null);
    try { psFacts.lines = psLines(psFrame); } catch (psLinesError) { psFacts.lines = null; }
    try { psFacts.paragraphs = psParagraphs(psFrame, psContents, psProfile !== null && psProfile.kinsoku === true, psProfile !== null && psProfile.extent === true); } catch (psParagraphsError) { psFacts.paragraphs = null; }
    // The two #709 rules judge fully justified paragraphs only, so the (per character) attribute read is for those frames; policy
    // jp_setting_profile_v1 reads every frame whatever its justification. One budget per call either way.
    if ((psProfile !== null && psProfile.runs === true) ||
        ((psProfile === null || psProfile.justifiedRuns === true) && psFacts.paragraphs !== null && psHasJustified(psFacts.paragraphs))) {
      if (psAttributeCharacters + psContents.length > PS_MAX_ATTRIBUTE_CHARACTERS) { psFrames.push({ uuid: psUuid, status: "skipped", reason: "scan_limit" }); continue; }
      psAttributeCharacters += psContents.length;
      try { psFacts.runs = psRuns(psFrame, psContents.length, psProfile !== null && psProfile.extent === true); } catch (psRunsError) { psFacts.runs = { error: "runs_unreadable" }; }
    }
    try { psFacts.transformed = !psMatrixIdentity(psFrame); } catch (psMatrixError) { psFacts.transformed = null; }
    if (psKind === TextType.AREATEXT) {
      try { psFacts.columns = { count: psFrame.columnCount, rows: psFrame.rowCount }; } catch (psColumnsError) { psFacts.columns = { error: true }; }
      if (psProfile !== null && psProfile.extent === true) {
        try { psFacts.extent = psExtent(psFrame); } catch (psExtentError) { psFacts.extent = { error: true }; }
      }
    }
    psRecord.facts = psFacts;
    if (params.outline === true) {
      var psReason = null;
      if (psFacts.paragraphs === null || !psHasJustified(psFacts.paragraphs)) psReason = "no_justified_paragraph";
      else if (psLegacy.error === true) psReason = "legacy_text_unknown";
      else if (psLegacy.count > 0) psReason = "legacy_text";
      else if (psFacts.orientation === null || psFacts.transformed === null) psReason = "unreadable_frame";
      else if (psFacts.orientation !== "horizontal") psReason = "not_horizontal";
      else if (psFacts.transformed === true) psReason = "transformed";
      else if (psKind === TextType.AREATEXT && (psFacts.columns === null || psFacts.columns.error === true)) psReason = "unreadable_frame";
      else if (psKind === TextType.AREATEXT && (psFacts.columns.count !== 1 || psFacts.columns.rows !== 1)) psReason = "multi_column";
      else if (psKind !== TextType.AREATEXT && psKind !== TextType.POINTTEXT) psReason = "unreadable_frame";
      else if (psOutlineCharacters + psContents.length > PS_MAX_OUTLINE_CHARACTERS) psReason = "scan_limit";
      // The frame handle is held from here: once the scratch document is active the lookup on the source document throws (MRAP, measured on 30.8.2).
      if (psReason === null) { psOutlineCharacters += psContents.length; psToOutline.push({ record: psRecord, frame: psFrame }); }
      else psRecord.outline = { status: "skipped", reason: psReason };
    }
  } catch (psReadError) {
    psRecord = { uuid: psUuid, status: "skipped", reason: "unreadable_frame" };
  }
  psFrames.push(psRecord);
}

var psScratchReport = null;
if (psToOutline.length > 0) {
  var psActiveLayer = psDocument.activeLayer;
  var psBefore = psSnapshot(psDocument, psActiveLayer);
  var psScratch = null;
  var psScratchOpened = false;
  var psMeasureError = null;
  var psCloseError = null;
  var psTimes = { open: null, measure: null, close: null, active: null };
  var psInteraction = app.userInteractionLevel;
  try {
  MUTATION_SIDE_EFFECT_ATTEMPTED = true;
  var psOpened = psNow();
  app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
  try {
    try {
      psScratch = app.documents.add(DocumentColorSpace.RGB, 1600, 1600);
      psScratchOpened = true;
      psScratch.layers[0].name = params.scratchLayer;
      psTimes.open = psNow() - psOpened;
      var psMeasureStarted = psNow();
      for (var psOutlineIndex = 0; psOutlineIndex < psToOutline.length; psOutlineIndex++) {
        var psTarget = psToOutline[psOutlineIndex].record;
        var psSource = psToOutline[psOutlineIndex].frame;
        var psFrameStarted = psNow();
        try {
          var psCopy = psSource.duplicate(psScratch.layers[0], ElementPlacement.PLACEATBEGINNING);
          var psGroup = psCopy.createOutline();
          var psGlyphs = [];
          psLeaves(psGroup, psGlyphs, 0);
          psGroup.remove();
          psTarget.outline = { status: "measured", glyphs: psGlyphs, ms: psNow() - psFrameStarted };
        } catch (psFrameError) {
          psTarget.outline = { status: "error", message: psMessage(psFrameError) };
        }
      }
      psTimes.measure = psNow() - psMeasureStarted;
    } catch (psError) {
      psMeasureError = psMessage(psError);
    }
  } finally {
    if (psScratch !== null) {
      var psCloseStarted = psNow();
      try { psScratch.close(SaveOptions.DONOTSAVECHANGES); } catch (psCloseFailure) { psCloseError = psMessage(psCloseFailure); }
      psTimes.close = psNow() - psCloseStarted;
      psTimes.active = psNow() - psOpened;
    }
    app.userInteractionLevel = psInteraction;
  }
  // After the marker nothing throws: the facts are the result. A scratch document that may still be open, or a source
  // that cannot be read back, keeps the command lock (indeterminate) with these facts in the recorded result.
  var psAfter = null;
  var psAfterError = null;
  var psDocumentsAfter = -1;
  var psScratchLeft = -1;
  var psSavedAfter = null;
  try {
    psDocumentsAfter = app.documents.length;
    psScratchLeft = psScratchDocuments().length;
    psAfter = psSnapshot(psDocument, psActiveLayer);
    psSavedAfter = psDocument.saved === true;
  } catch (psAfterFailure) { psAfterError = psMessage(psAfterFailure); }
  if (psAfterError !== null || psDocumentsAfter !== psBefore.documents || psScratchLeft !== 0) MUTATION_RUNNER_DISPOSITION = "indeterminate";
  psScratchReport = { before: psBefore, after: psAfter, measureError: psMeasureError, scratchOpened: psScratchOpened, times: psTimes,
    closeError: psCloseError, afterError: psAfterError, documentsAfter: psDocumentsAfter, scratchLeft: psScratchLeft, unexpectedError: null };
  } catch (psUnexpectedFailure) {
    MUTATION_RUNNER_DISPOSITION = "indeterminate";
    var psCountNow = -1;
    try { psCountNow = app.documents.length; } catch (psCountFailure) { psCountNow = -1; }
    psScratchReport = { before: null, after: null, measureError: psMeasureError, scratchOpened: psScratchOpened, times: psTimes,
      closeError: psCloseError, afterError: null, documentsAfter: psCountNow, scratchLeft: -1, unexpectedError: psMessage(psUnexpectedFailure) };
  }
}
var result = { document: psContext, savedBefore: psSavedBefore, savedAfter: psDocument.saved === true, legacy: psLegacy,
  frames: psFrames, scratch: psScratchReport };
`;
const hostNumber = z.number().finite();
const glyphBounds = z.tuple([hostNumber, hostNumber, hostNumber, hostNumber]);
const msOrNull = z.number().int().nonnegative().nullable();
const factsSchema = z.strictObject({
    contents: z.string().max(LOOSE_LINE_LIMITS.characters),
    lines: z.array(z.union([
        z.strictObject({ start: z.unknown(), end: z.unknown(), contents: z.string() }),
        z.strictObject({ error: z.literal('line_unreadable') }),
    ])).max(2_000).nullable(),
    orientation: z.enum(['horizontal', 'vertical']).nullable(),
    paragraphs: z.array(z.union([
        z.strictObject({ start: z.unknown(), end: z.unknown(), justification: z.string(), mojikumi: z.string().nullable(), kinsoku: z.string().nullable().optional(),
            leftIndent: z.unknown().optional(), rightIndent: z.unknown().optional() }),
        z.strictObject({ start: z.unknown(), end: z.unknown(), empty: z.literal(true) }),
        z.strictObject({ trailingEmpty: z.literal(true) }),
        z.strictObject({ error: z.literal('paragraph_unreadable') }),
    ])).max(2_000).nullable(),
    runs: z.union([
        z.array(z.strictObject({ start: z.unknown(), end: z.unknown(), size: z.unknown(), tracking: z.unknown(), horizontalScale: z.unknown(),
            verticalScale: z.unknown().optional(), tsume: z.unknown(), akiLeft: z.unknown(), akiRight: z.unknown(), kerning: z.unknown(), method: z.string(), palt: z.unknown(),
            autoLeading: z.unknown().optional(), leading: z.unknown().optional() })).max(LOOSE_LINE_LIMITS.runs),
        z.strictObject({ error: z.string().max(64) }),
    ]).nullable(),
    columns: z.union([z.strictObject({ count: z.unknown(), rows: z.unknown() }), z.strictObject({ error: z.literal(true) })]).nullable(),
    transformed: z.boolean().nullable(),
    extent: z.union([
        z.strictObject({ spacing: z.unknown(), pointCount: z.unknown(), points: z.array(z.strictObject({ anchor: z.unknown(), left: z.unknown(), right: z.unknown() })).max(8).nullable() }),
        z.strictObject({ error: z.literal(true) }),
    ]).optional(),
});
const outlineSchema = z.union([
    z.strictObject({ status: z.literal('measured'), glyphs: z.array(glyphBounds).max(LOOSE_LINE_LIMITS.outlineCharacters), ms: z.number().int().nonnegative() }),
    z.strictObject({ status: z.literal('skipped'), reason: z.enum(['not_requested', 'no_justified_paragraph', 'legacy_text', 'legacy_text_unknown',
            'not_horizontal', 'multi_column', 'transformed', 'unreadable_frame', 'scan_limit']) }),
    z.strictObject({ status: z.literal('error'), message: z.string().max(300) }),
]);
export const jpAuditShapeExtraHostSchema = z.strictObject({
    document: documentContextSchema,
    savedBefore: z.boolean(),
    savedAfter: z.boolean(),
    legacy: z.union([z.strictObject({ count: z.number().int().nonnegative() }), z.strictObject({ error: z.literal(true) })]),
    frames: z.array(z.union([
        z.strictObject({ uuid: z.string().max(255), status: z.literal('skipped'), reason: z.enum(['scan_limit', 'unreadable_frame']) }),
        z.strictObject({ uuid: z.string().max(255), status: z.literal('read'), facts: factsSchema.nullable(), outline: outlineSchema }),
    ])).max(200),
    scratch: z.strictObject({
        before: snapshotSchema,
        after: snapshotSchema,
        measureError: z.string().nullable(),
        scratchOpened: z.boolean(),
        times: z.strictObject({ open: msOrNull, measure: msOrNull, close: msOrNull, active: msOrNull }),
        closeError: z.string().nullable(),
        afterError: z.null(),
        documentsAfter: z.number().int().nonnegative(),
        scratchLeft: z.literal(0),
        unexpectedError: z.null(),
    }).nullable(),
});
const range = z.strictObject({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() });
export const looseLineEvidenceSchema = z.strictObject({
    mean_increase_em: z.number(),
    max_gap_increase_em: z.number().nullable(),
    max_gap_class: z.enum(LOOSE_LINE_POSITION_CLASSES).nullable(),
    max_gap_range: range.nullable(),
    pairs_measured: z.number().int().positive(),
    criteria: z.array(z.enum(['mean', 'max_gap'])).min(1),
    mean_threshold_em: z.number().nullable(),
    max_gap_threshold_em: z.number().nullable(),
});
export const settingCombinationEvidenceSchema = z.strictObject({
    mojikumi: z.string(),
    kerning_methods: z.array(z.enum(SETTING_COMBINATION_KERNING_METHODS)).min(1),
});
export const shapeSkipEntrySchema = z.strictObject({
    rule: z.enum(SHAPE_EXTRA_RULES),
    uuid: z.string().max(255),
    name: z.string().max(255),
    reason: z.enum(SHAPE_SKIP_REASONS),
});
export const shapeMeasurementSchema = z.strictObject({
    frames_measured: z.number().int().nonnegative(),
    lines_judged: z.number().int().nonnegative(),
    skipped: z.array(shapeSkipEntrySchema).max(2 * 200),
});
const FULL_JUSTIFICATIONS = new Set(['FULLJUSTIFY', 'FULLJUSTIFYLASTLINELEFT', 'FULLJUSTIFYLASTLINECENTER',
    'FULLJUSTIFYLASTLINERIGHT']);
const SPACE_CODES = new Set(DISPLAY_SPACING_SPACE_CODES);
const round4 = (value) => Math.round(value * 10_000) / 10_000;
const finiteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const wholeNumber = (value) => typeof value === 'number' && Number.isInteger(value);
export function positionClassOfJlreq(jlreqClass) {
    switch (jlreqClass) {
        case 'cl-05': return 'middle_dot';
        case 'cl-07': return 'comma';
        case 'cl-01':
        case 'cl-02': return 'bracket';
        case 'cl-06': return 'period';
        case 'cl-03':
        case 'cl-04':
        case 'cl-08': return 'other_punctuation';
        default: return 'non_punctuation';
    }
}
function continuationAt(text, index) {
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
function inkClusters(text, start, end) {
    const out = [];
    let afterSpace = false;
    for (let index = start; index < end;) {
        const unit = text.charCodeAt(index);
        if (unit < 0x20 || (unit >= 0x7F && unit <= 0x9F) || unit === 0x2028 || unit === 0x2029 || (unit >= 0x200B && unit <= 0x200D) || unit === 0xFEFF ||
            (unit >= 0xDC00 && unit <= 0xDFFF) || continuationAt(text, index) > 0)
            return null;
        let next = index + 1;
        if (unit >= 0xD800 && unit <= 0xDBFF) {
            const low = text.charCodeAt(index + 1);
            if (!(low >= 0xDC00 && low <= 0xDFFF))
                return null;
            next = index + 2;
        }
        for (let length = continuationAt(text, next); length > 0; length = continuationAt(text, next))
            next += length;
        const codePoint = text.codePointAt(index);
        if (next > end)
            return null;
        if (SPACE_CODES.has(codePoint))
            afterSpace = true;
        else {
            out.push({ start: index, end: next, codePoint, afterSpace });
            afterSpace = false;
        }
        index = next;
    }
    return out;
}
const NO_EXPLICIT_AKI = new Set([-1, 0]);
function readRuns(facts, length) {
    const raw = facts.runs;
    if (raw === null || !Array.isArray(raw) || raw.length === 0)
        return null;
    const out = [];
    let cursor = 0;
    for (const run of raw) {
        if (!wholeNumber(run.start) || !wholeNumber(run.end) || run.start !== cursor || run.end <= run.start)
            return null;
        if (!finiteNumber(run.size) || run.size <= 0 || !finiteNumber(run.tracking) || !finiteNumber(run.horizontalScale) || run.horizontalScale <= 0 ||
            !finiteNumber(run.tsume) || !finiteNumber(run.akiLeft) || !finiteNumber(run.akiRight) || typeof run.palt !== 'boolean' ||
            !(run.kerning === null || finiteNumber(run.kerning)))
            return null;
        const method = KERNING_METHOD_OF[run.method];
        if (method === undefined)
            return null;
        const baselineValid = run.tsume === 0 && NO_EXPLICIT_AKI.has(run.akiLeft) && NO_EXPLICIT_AKI.has(run.akiRight) && (run.kerning === null || run.kerning === 0) &&
            !run.palt && method !== 'optical';
        out.push({ start: run.start, end: run.end, size: run.size, advance: run.size * (1 + run.tracking / 1000) * run.horizontalScale / 100,
            baselineValid, method });
        cursor = run.end;
    }
    return cursor === length ? out : null;
}
function justifiedParagraphs(facts, contents) {
    const paragraphs = facts.paragraphs;
    if (paragraphs === null)
        return 'unreadable';
    const out = [];
    for (let index = 0; index < paragraphs.length; index += 1) {
        const paragraph = paragraphs[index];
        if ('error' in paragraph)
            return 'unreadable';
        if ('trailingEmpty' in paragraph) {
            if (index !== paragraphs.length - 1 || !contents.endsWith('\r'))
                return 'unreadable';
            continue;
        }
        if (!wholeNumber(paragraph.start) || !wholeNumber(paragraph.end) || paragraph.end < paragraph.start || paragraph.end > contents.length)
            return 'unreadable';
        if ('empty' in paragraph)
            continue;
        const match = /^Justification\.([A-Z]+)$/u.exec(paragraph.justification);
        if (match === null)
            return 'unreadable';
        if (FULL_JUSTIFICATIONS.has(match[1]))
            out.push({ start: paragraph.start, end: paragraph.end, justification: match[1], mojikumi: paragraph.mojikumi });
    }
    return out;
}
function assignGlyphs(clustersByLine, bounds) {
    const total = clustersByLine.reduce((sum, clusters) => sum + (clusters?.length ?? 0), 0);
    if (clustersByLine.some((clusters) => clusters === null) || bounds.length !== total)
        return null;
    const ordered = bounds.map(([left, top, , bottom]) => ({ left, middle: (top + bottom) / 2 })).sort((a, b) => b.middle - a.middle);
    const rows = [];
    let cursor = 0;
    let previousLowest = null;
    for (const clusters of clustersByLine) {
        const count = clusters.length;
        if (count === 0) {
            rows.push([]);
            continue;
        }
        const row = ordered.slice(cursor, cursor + count);
        cursor += count;
        const highest = Math.max(...row.map((glyph) => glyph.middle));
        const lowest = Math.min(...row.map((glyph) => glyph.middle));
        if (previousLowest !== null && !(previousLowest > highest))
            return null;
        previousLowest = lowest;
        row.sort((a, b) => a.left - b.left);
        for (let index = 1; index < row.length; index += 1)
            if (!(row[index].left > row[index - 1].left))
                return null;
        rows.push(row);
    }
    return rows;
}
function skipOf(rule, frame, reason) {
    return { rule, uuid: frame.uuid, name: frame.name, reason };
}
export function judgeShapeExtraFrame(frame, record, input, classOf) {
    const rules = [...(input.looseLine === undefined ? [] : ['JP_LOOSE_LINE']),
        ...(input.settingCombination === undefined ? [] : ['JP_PARAGRAPH_SETTING_COMBINATION'])];
    const outcome = { findings: [], skipped: [], linesJudged: 0, measured: false };
    const skipAll = (reason) => { for (const rule of rules)
        outcome.skipped.push(skipOf(rule, frame, reason)); return outcome; };
    if (record === undefined)
        return skipAll('not_read');
    if (record.status === 'skipped')
        return skipAll(record.reason);
    const facts = record.facts;
    if (facts === null)
        return skipAll('unreadable_frame');
    if (frame.rawLines === null || !frame.linesReadable)
        return skipAll('unreadable_line');
    if (facts.contents !== frame.contents || facts.lines === null || !isDeepStrictEqual(facts.lines, frame.rawLines))
        return skipAll('frame_changed');
    const paragraphs = justifiedParagraphs(facts, frame.contents);
    if (paragraphs === 'unreadable')
        return skipAll('unreadable_paragraph');
    const runs = readRuns(facts, frame.contents.length);
    if (input.settingCombination !== undefined) {
        const wanted = input.settingCombination;
        for (const paragraph of paragraphs) {
            if (paragraph.end <= paragraph.start)
                continue;
            if (paragraph.mojikumi === null) {
                outcome.skipped.push(skipOf('JP_PARAGRAPH_SETTING_COMBINATION', frame, 'attributes_unreadable'));
                break;
            }
            if (!wanted.mojikumi_sets.includes(paragraph.mojikumi))
                continue;
            if (runs === null) {
                outcome.skipped.push(skipOf('JP_PARAGRAPH_SETTING_COMBINATION', frame, 'attributes_unreadable'));
                break;
            }
            const methods = new Set();
            let known = true;
            for (const run of runs) {
                if (run.end <= paragraph.start || run.start >= paragraph.end)
                    continue;
                if (run.method === null)
                    known = false;
                else
                    methods.add(run.method);
            }
            if (!known) {
                outcome.skipped.push(skipOf('JP_PARAGRAPH_SETTING_COMBINATION', frame, 'attributes_unreadable'));
                break;
            }
            if (methods.size === 0 || ![...methods].every((method) => wanted.kerning_methods.includes(method)))
                continue;
            outcome.findings.push({ rule: 'JP_PARAGRAPH_SETTING_COMBINATION', anchor: paragraph.start,
                range: { start: paragraph.start, end: paragraph.end }, lineIndex: null, stateOffset: paragraph.start,
                evidence: { justification: paragraph.justification, setting_combination: { mojikumi: paragraph.mojikumi,
                        kerning_methods: SETTING_COMBINATION_KERNING_METHODS.filter((method) => methods.has(method)) } } });
        }
    }
    const looseInput = input.looseLine;
    if (looseInput === undefined || paragraphs.every((paragraph) => paragraph.end <= paragraph.start))
        return outcome;
    const skipLoose = (reason) => { outcome.skipped.push(skipOf('JP_LOOSE_LINE', frame, reason)); return outcome; };
    const outline = record.outline;
    if (outline.status === 'skipped') {
        return skipLoose(outline.reason === 'not_requested' || outline.reason === 'no_justified_paragraph' ? 'not_read' : outline.reason);
    }
    if (outline.status === 'error')
        return skipLoose('outline_failed');
    if (runs === null)
        return skipLoose('attributes_unreadable');
    if (runs.some((run) => !run.baselineValid))
        return skipLoose('spacing_attributes_set');
    if (!frame.linesReadable)
        return skipLoose('unreadable_line');
    const lines = frame.lines;
    const clusters = lines.map((line) => inkClusters(frame.contents, line.start, line.end));
    if (clusters.some((entry) => entry === null))
        return skipLoose('unsupported_characters');
    const rows = assignGlyphs(clusters, outline.glyphs);
    if (rows === null)
        return skipLoose('glyph_correspondence');
    outcome.measured = true;
    const runAt = (offset) => runs.find((run) => run.start <= offset && offset < run.end);
    const meanThreshold = looseInput.mean_increase_em ?? null;
    const maxThreshold = looseInput.max_gap_increase_em ?? null;
    const allowed = looseInput.max_gap_classes === undefined ? null : new Set(looseInput.max_gap_classes);
    lines.forEach((line, index) => {
        const next = lines[index + 1];
        if (next === undefined || next.start !== line.end)
            return;
        const paragraph = paragraphs.find((candidate) => candidate.start <= line.start && line.start < candidate.end);
        if (paragraph === undefined)
            return;
        const lineClusters = clusters[index];
        const glyphs = rows[index];
        let sum = 0;
        let pairs = 0;
        let best = null;
        for (let position = 0; position + 1 < lineClusters.length; position += 1) {
            const right = lineClusters[position + 1];
            if (right.afterSpace)
                continue;
            const left = lineClusters[position];
            const run = runAt(left.start);
            const increase = (glyphs[position + 1].left - glyphs[position].left - run.advance) / run.size;
            sum += increase;
            pairs += 1;
            const leftClass = positionClassOfJlreq(classOf(left.codePoint));
            const positionClass = leftClass !== 'non_punctuation' ? leftClass : positionClassOfJlreq(classOf(right.codePoint));
            if ((allowed === null || allowed.has(positionClass)) && (best === null || increase > best.value)) {
                best = { value: increase, position: positionClass, start: left.start, end: right.end };
            }
        }
        if (pairs === 0)
            return;
        outcome.linesJudged += 1;
        const mean = round4(sum / pairs);
        const maxValue = best === null ? null : round4(best.value);
        const criteria = [];
        if (meanThreshold !== null && mean >= meanThreshold)
            criteria.push('mean');
        if (maxThreshold !== null && maxValue !== null && maxValue >= maxThreshold)
            criteria.push('max_gap');
        if (criteria.length === 0)
            return;
        outcome.findings.push({ rule: 'JP_LOOSE_LINE', anchor: line.start, range: { start: line.start, end: line.end }, lineIndex: index,
            stateOffset: line.start, evidence: { justification: paragraph.justification, loose_line: { mean_increase_em: mean,
                    max_gap_increase_em: maxValue, max_gap_class: best?.position ?? null,
                    max_gap_range: best === null ? null : { start: best.start, end: best.end }, pairs_measured: pairs, criteria,
                    mean_threshold_em: meanThreshold, max_gap_threshold_em: maxThreshold } } });
    });
    return outcome;
}
export function assertShapeExtraSourceUnchanged(host) {
    if (host.savedBefore !== host.savedAfter) {
        throw new Error('The document\'s saved state changed during the read-only audit; the read is not reported.');
    }
    const scratch = host.scratch;
    if (scratch === null)
        return;
    const changes = describeSnapshotChanges(scratch.before, scratch.after);
    if (changes.length > 0) {
        throw new Error(`The source document or its view changed while the scratch copy was measured (${changes.join('; ')}). ` +
            'No result is returned; read the document context again before any further operation.');
    }
}
const leftoverSchema = z.array(z.strictObject({ key: z.string(), keyShort: z.string(), name: z.string(), saved: z.boolean(), active: z.boolean() }));
export function shapeExtraErrorMessage(detail) {
    if (detail?.code !== 'JP_AUDIT_SCRATCH_LEFT_OPEN')
        return null;
    const parsed = leftoverSchema.safeParse(detail.documents);
    const documents = parsed.success ? parsed.data : [];
    const listed = documents.map((entry) => `key ${JSON.stringify(entry.key)} (name ${JSON.stringify(entry.name)}${entry.active ? ', active' : ''})`).join('; ');
    if (documents.length === 1) {
        return `a scratch document of an earlier call is still open: ${listed}. It has no file and only the layer "${DISPLAY_SPACING_SCRATCH_LAYER}". ` +
            'Check it in Illustrator, then close it without saving with illustrator_close_document (expected_document_key = that key, discard_changes = true; ' +
            'bring it to the front first if it is not active) and read the source key again with illustrator_get_context. Nothing was closed or measured.';
    }
    return `${documents.length} scratch documents are open (${listed}). The outcome of the earlier calls is unknown; check every one in Illustrator by eye ` +
        'before closing anything. Nothing was closed or measured.';
}
export { DISPLAY_SPACING_SCRATCH_LAYER as LOOSE_LINE_SCRATCH_LAYER };
