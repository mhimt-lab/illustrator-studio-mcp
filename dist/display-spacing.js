import { createHash, randomUUID } from 'node:crypto';
import { rmdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { createStagingDirectory } from './document-export.js';
import { DocumentMismatchError, IndeterminateExecutionError, ObjectNotFoundError } from './domain.js';
import { documentContextSchema } from './mutation-result-schema-core.js';
import { ensurePrivateDirectory, ensurePrivateStateRoot, isWindowsPrivateState } from './private-state.js';
import { decodePng, inspectSupportedPng, privatePreviewReadGate, readStableImage } from './visual-diff.js';
export const DISPLAY_SPACING_LIMITS = { characters: 64, kerningChange: 200 };
export const DISPLAY_SPACING_HOST_TIMEOUT_MS = 60_000;
export const DISPLAY_SPACING_SCRATCH_LAYER = 'illustrator-studio-mcp display spacing scratch';
export const DISPLAY_SPACING_PREVIEW_PPI = 288;
export const DISPLAY_SPACING_PREVIEW_MAX_SIDE_PT = 1024;
const PREVIEW_STAGING_PREFIX = '.illustrator-studio-mcp-display-spacing-';
const PREVIEW_FILE_NAME = 'display-spacing.png';
const SCANLINES = 64;
const CUBIC_STEPS = 16;
export const DISPLAY_SPACING_SPACE_CODES = [0x20, 0xA0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004,
    0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A, 0x202F, 0x205F, 0x3000];
export const DISPLAY_SPACING_CANDIDATE_NOTE = 'Candidates are heuristic, not a quality verdict: judge them by eye at the final size and medium.';
export const DISPLAY_SPACING_REJECT_REASONS = ['not_text', 'path_text', 'vertical', 'locked_or_hidden', 'threaded', 'empty',
    'too_long', 'multiple_lines', 'overset', 'unsupported_characters', 'mixed_size', 'too_few_glyphs', 'transformed',
    'unreadable'];
const KERNING_METHODS = { 'AutoKernType.NOAUTOKERN': 'none', 'AutoKernType.AUTO': 'auto', 'AutoKernType.OPTICAL': 'optical',
    'AutoKernType.METRICSROMANONLY': 'metrics_roman_only' };
const kerningMethodSchema = z.enum(['none', 'auto', 'optical', 'metrics_roman_only']);
export const DISPLAY_SPACING_WARNINGS = ['optical_with_proportional_metrics', 'optical_method', 'mixed_kerning_method',
    'noautokern_reads_zero', 'manual_kerning_with_auto_method', 'collision', 'preview_outside_scratch_board',
    'preview_too_large', 'scratch_close_reported_error'];
export const DISPLAY_SPACING_SCRIPT = `
var MUTATION_SIDE_EFFECT_ATTEMPTED = false;
var MUTATION_RUNNER_DISPOSITION = null;
var DS_SPACES = ${JSON.stringify(DISPLAY_SPACING_SPACE_CODES)};
function dsNow() { return new Date().getTime(); }
function dsFail(code, detail) {
  detail.code = code;
  throw new Error("MCP_ERROR:" + stringifyJson(detail));
}
function dsReject(reason) { dsFail("DISPLAY_SPACING_TARGET_UNSUPPORTED", { reason: reason }); }
function dsMessage(error) {
  try { return String(error && error.message ? error.message : error); } catch (messageError) { return "unreadable error"; }
}
function dsRound(value) { return Math.round(Number(value) * 1000) / 1000; }
function dsIsSpace(code) {
  for (var spaceIndex = 0; spaceIndex < DS_SPACES.length; spaceIndex++) if (DS_SPACES[spaceIndex] === code) return true;
  return false;
}
/** A scratch document: exactly one layer with the reserved name, and no file on disk. */
function dsScratchDocuments() {
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
function dsFind(document, uuid) {
  if (typeof document.getPageItemFromUuid !== "function") dsFail("DISPLAY_SPACING_UUID_LOOKUP_UNAVAILABLE", { uuid: uuid });
  var target = null;
  try {
    target = document.getPageItemFromUuid(uuid);
  } catch (lookupError) {
    var message = lookupError && lookupError.message ? String(lookupError.message) : "";
    if (!(lookupError && lookupError.name === "Error" && lookupError.number === 1200 &&
        message === "an Illustrator error occurred: 1346458189 ('MRAP')")) throw lookupError;
    target = null;
  }
  if (target === null || target === undefined) dsFail("OBJECT_NOT_FOUND", { uuid: uuid });
  if (String(target.typename) !== "TextFrame") dsReject("not_text");
  return target;
}
/** "locked_or_hidden", "readable", or "unreadable" from the frame and every ancestor up to the document. */
function dsLockState(frame) {
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
/** One record per character; the character is held while its attributes are read (a released one expires, 9503). */
function dsStates(frame, count) {
  var out = [];
  var characters = frame.characters;
  for (var index = 0; index < count; index++) {
    var held = characters[index];
    var kerning = null;
    try { kerning = held.kerning; }
    catch (kerningError) {
      if (!(kerningError && kerningError.number === 9551)) throw kerningError;
      kerning = null;
    }
    var attributes = held.characterAttributes;
    var font = attributes.textFont;
    out.push({ kerning: kerning, method: String(attributes.kerningMethod), palt: attributes.proportionalMetrics,
      tsume: attributes.Tsume, akiLeft: attributes.akiLeft, akiRight: attributes.akiRight, tracking: attributes.tracking,
      size: attributes.size, font: String(font.name) });
  }
  return out;
}
/** The source facts a read must leave alone, and the active document and view. */
function dsSnapshot(document, activeLayer) {
  var index = -1;
  for (var cursor = 0; cursor < app.documents.length; cursor++) if (app.documents[cursor] === document) index = cursor;
  var view = document.views[0];
  var center = view.centerPoint;
  return { key: getDocumentIdentity(document, index).key, index: index, saved: document.saved === true,
    documents: app.documents.length, active: app.activeDocument === document, pageItems: document.pageItems.length,
    layers: document.layers.length, selection: document.selection.length, activeLayer: document.activeLayer === activeLayer,
    views: document.views.length, zoom: view.zoom, center: [Number(center[0]), Number(center[1])], screenMode: String(view.screenMode) };
}
function dsPoints(path) {
  var points = [];
  var list = path.pathPoints;
  for (var p = 0; p < list.length; p++) {
    var point = list[p];
    var anchor = point.anchor; var left = point.leftDirection; var right = point.rightDirection;
    points.push([dsRound(anchor[0]), dsRound(anchor[1]), dsRound(left[0]), dsRound(left[1]), dsRound(right[0]), dsRound(right[1])]);
  }
  return { closed: path.closed === true, points: points };
}
function dsGlyph(item) {
  var typename = String(item.typename);
  var bounds = item.geometricBounds;
  var record = { typename: typename, bounds: [dsRound(bounds[0]), dsRound(bounds[1]), dsRound(bounds[2]), dsRound(bounds[3])], paths: [] };
  if (typename === "CompoundPathItem") { for (var c = 0; c < item.pathItems.length; c++) record.paths.push(dsPoints(item.pathItems[c])); }
  else if (typename === "PathItem") record.paths.push(dsPoints(item));
  return record;
}

var dsLeftovers = dsScratchDocuments();
if (dsLeftovers.length > 0) dsFail("DISPLAY_SPACING_SCRATCH_LEFT_OPEN", { documents: dsLeftovers });
var dsContext = requireDocumentForRead(params.expectedDocumentKey);
var dsDocument = app.activeDocument;
var dsSavedBefore = dsDocument.saved === true;
var dsFrame = dsFind(dsDocument, params.targetUuid);
var dsKind = null;
var dsContents = "";
var dsStatesRead = null;
try {
  var dsRawKind = dsFrame.kind;
  if (dsRawKind === TextType.PATHTEXT) dsReject("path_text");
  else if (dsRawKind === TextType.POINTTEXT) dsKind = "point";
  else if (dsRawKind === TextType.AREATEXT) dsKind = "area";
  else dsReject("unreadable");
  var dsLock = dsLockState(dsFrame);
  if (dsLock !== "readable") dsReject(dsLock === "locked_or_hidden" ? "locked_or_hidden" : "unreadable");
  var dsStory = dsFrame.story;
  if (!dsStory || !dsStory.textFrames || dsStory.textFrames.length !== 1) dsReject("threaded");
  if (String(dsFrame.orientation) !== "TextOrientation.HORIZONTAL") dsReject("vertical");
  var dsMatrix = dsFrame.matrix;
  if (Math.abs(dsMatrix.mValueA - 1) > 1e-4 || Math.abs(dsMatrix.mValueB) > 1e-4 || Math.abs(dsMatrix.mValueC) > 1e-4 ||
      Math.abs(dsMatrix.mValueD - 1) > 1e-4) dsReject("transformed");
  dsContents = String(dsFrame.contents);
  if (dsContents.length === 0) dsReject("empty");
  if (dsContents.length > params.maxCharacters) dsReject("too_long");
  var dsInked = 0;
  for (var dsUnit = 0; dsUnit < dsContents.length; dsUnit++) {
    var dsCode = dsContents.charCodeAt(dsUnit);
    if (dsCode === 13 || dsCode === 10 || dsCode === 3 || dsCode === 0x2028 || dsCode === 0x2029) dsReject("multiple_lines");
    if (dsCode < 32 || (dsCode >= 0x7F && dsCode <= 0x9F) || (dsCode >= 0xD800 && dsCode <= 0xDFFF) ||
        (dsCode >= 0xFE00 && dsCode <= 0xFE0F) || dsCode === 0x3099 || dsCode === 0x309A || (dsCode >= 0x200B && dsCode <= 0x200D) ||
        dsCode === 0xFEFF) dsReject("unsupported_characters");
    if (!dsIsSpace(dsCode)) dsInked++;
  }
  if (dsFrame.characters.length !== dsContents.length) dsReject("unsupported_characters");
  var dsLines = dsFrame.lines;
  if (dsLines.length !== 1) dsReject(dsLines.length === 0 ? "overset" : "multiple_lines");
  if (String(dsLines[0].contents) !== dsContents) dsReject("overset");
  if (dsInked < 2) dsReject("too_few_glyphs");
  dsStatesRead = dsStates(dsFrame, dsContents.length);
  for (var dsSizeIndex = 1; dsSizeIndex < dsStatesRead.length; dsSizeIndex++) {
    if (dsStatesRead[dsSizeIndex].size !== dsStatesRead[0].size) dsReject("mixed_size");
  }
} catch (dsReadError) {
  if (dsMessage(dsReadError).indexOf("MCP_ERROR:") === 0) throw dsReadError;
  dsFail("DISPLAY_SPACING_TARGET_UNSUPPORTED", { reason: "unreadable", message: dsMessage(dsReadError) });
}
var dsFrameFacts = { uuid: String(dsFrame.uuid), kind: dsKind, contents: dsContents };
var result;
if (params.measure === "state_only") {
  result = { document: dsContext, measure: "state_only", frame: dsFrameFacts, states: dsStatesRead,
    savedBefore: dsSavedBefore, savedAfter: dsDocument.saved === true, outline: null };
} else {
  var dsActiveLayer = dsDocument.activeLayer;
  var dsBefore = dsSnapshot(dsDocument, dsActiveLayer);
  var dsScratch = null;
  // A closed host Document can throw even when compared with null. Keep only primitive facts in results.
  var dsScratchOpened = false;
  var dsCopyStates = null;
  var dsGlyphs = null;
  var dsPreview = null;
  var dsMeasureError = null;
  var dsCloseError = null;
  var dsTimes = { open: null, measure: null, close: null, active: null };
  var dsInteraction = app.userInteractionLevel;
  var dsUnexpected = null;
  try {
  MUTATION_SIDE_EFFECT_ATTEMPTED = true;
  var dsOpened = dsNow();
  app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
  try {
    try {
      dsScratch = app.documents.add(DocumentColorSpace.RGB, 1600, 1600);
      dsScratchOpened = true;
      dsScratch.layers[0].name = params.scratchLayer;
      dsTimes.open = dsNow() - dsOpened;
      var dsMeasureStarted = dsNow();
      var dsCopy = dsFrame.duplicate(dsScratch.layers[0], ElementPlacement.PLACEATBEGINNING);
      dsCopyStates = dsStates(dsCopy, dsContents.length);
      var dsGroup = dsCopy.createOutline();
      var dsItems = dsGroup.pageItems;
      dsGlyphs = [];
      for (var dsItemIndex = 0; dsItemIndex < dsItems.length; dsItemIndex++) dsGlyphs.push(dsGlyph(dsItems[dsItemIndex]));
      if (params.preview !== null) {
        var dsVisible = dsGroup.visibleBounds;
        var dsClip = [Math.floor(dsVisible[0]) - 4, Math.ceil(dsVisible[1]) + 4, Math.ceil(dsVisible[2]) + 4, Math.floor(dsVisible[3]) - 4];
        var dsBoard = dsScratch.artboards[0].artboardRect;
        dsPreview = { clip: dsClip, skipped: null, captureError: null, outputExists: false, captureMs: null };
        if (!(dsClip[0] >= dsBoard[0] && dsClip[1] <= dsBoard[1] && dsClip[2] <= dsBoard[2] && dsClip[3] >= dsBoard[3])) {
          dsPreview.skipped = "preview_outside_scratch_board";
        } else if (dsClip[2] - dsClip[0] > params.preview.maxSidePt || dsClip[1] - dsClip[3] > params.preview.maxSidePt) {
          dsPreview.skipped = "preview_too_large";
        } else {
          var dsCaptureOptions = new ImageCaptureOptions();
          dsCaptureOptions.resolution = params.preview.resolution;
          dsCaptureOptions.antiAliasing = true;
          dsCaptureOptions.transparency = true;
          var dsCaptureStarted = dsNow();
          try { dsScratch.imageCapture(new File(params.preview.path), dsClip, dsCaptureOptions); }
          catch (dsCaptureError) { dsPreview.captureError = dsMessage(dsCaptureError); }
          dsPreview.captureMs = dsNow() - dsCaptureStarted;
          dsPreview.outputExists = new File(params.preview.path).exists === true;
        }
      }
      dsGroup.remove();
      dsTimes.measure = dsNow() - dsMeasureStarted;
    } catch (dsError) {
      dsMeasureError = dsMessage(dsError);
    }
  } finally {
    if (dsScratch !== null) {
      var dsCloseStarted = dsNow();
      try { dsScratch.close(SaveOptions.DONOTSAVECHANGES); } catch (dsCloseFailure) { dsCloseError = dsMessage(dsCloseFailure); }
      dsTimes.close = dsNow() - dsCloseStarted;
      dsTimes.active = dsNow() - dsOpened;
    }
    app.userInteractionLevel = dsInteraction;
  }
  // After the marker nothing throws: the facts are the result. A scratch document that may still be open, or a source
  // that cannot be read back, keeps the command lock (indeterminate) with these facts in the recorded result.
  var dsAfter = null;
  var dsAfterError = null;
  var dsDocumentsAfter = -1;
  var dsScratchLeft = -1;
  var dsSavedAfter = null;
  try {
    dsDocumentsAfter = app.documents.length;
    dsScratchLeft = dsScratchDocuments().length;
    dsAfter = dsSnapshot(dsDocument, dsActiveLayer);
    dsSavedAfter = dsDocument.saved === true;
  } catch (dsAfterFailure) { dsAfterError = dsMessage(dsAfterFailure); }
  // close() reporting an error does not by itself leave the lock: the document count and the scratch scan decide.
  if (dsAfterError !== null || dsDocumentsAfter !== dsBefore.documents || dsScratchLeft !== 0) {
    MUTATION_RUNNER_DISPOSITION = "indeterminate";
  }
  result = { document: dsContext, measure: "outline", frame: dsFrameFacts, states: dsStatesRead,
    savedBefore: dsSavedBefore, savedAfter: dsSavedAfter,
    outline: { before: dsBefore, after: dsAfter, copyStates: dsCopyStates, glyphs: dsGlyphs,
      preview: dsPreview, measureError: dsMeasureError, scratchOpened: dsScratchOpened, times: dsTimes,
      closeError: dsCloseError, afterError: dsAfterError, documentsAfter: dsDocumentsAfter, scratchLeft: dsScratchLeft,
      unexpectedError: null } };
  } catch (dsUnexpectedFailure) {
    // Anything else after the marker: the command stays indeterminate and the recorded result names what threw.
    dsUnexpected = dsMessage(dsUnexpectedFailure);
    MUTATION_RUNNER_DISPOSITION = "indeterminate";
    var dsCountNow = -1;
    try { dsCountNow = app.documents.length; } catch (dsCountFailure) { dsCountNow = -1; }
    result = { measure: "outline", outline: { unexpectedError: dsUnexpected, closeError: dsCloseError, measureError: dsMeasureError,
      scratchOpened: dsScratchOpened, documentsAfter: dsCountNow, times: dsTimes } };
  }
}
`;
const hostNumber = z.number().finite();
const hostStateSchema = z.strictObject({
    kerning: z.number().int().nullable(),
    method: z.string().max(64),
    palt: z.boolean(),
    tsume: hostNumber,
    akiLeft: hostNumber,
    akiRight: hostNumber,
    tracking: hostNumber,
    size: hostNumber.positive(),
    font: z.string().max(255),
});
const snapshotSchema = z.strictObject({
    key: z.string(), index: z.number().int(), saved: z.boolean(), documents: z.number().int(), active: z.boolean(),
    pageItems: z.number().int(), layers: z.number().int(), selection: z.number().int(), activeLayer: z.boolean(),
    views: z.number().int(), zoom: hostNumber, center: z.tuple([hostNumber, hostNumber]), screenMode: z.string(),
});
const glyphSchema = z.strictObject({
    typename: z.string().max(64),
    bounds: z.tuple([hostNumber, hostNumber, hostNumber, hostNumber]),
    paths: z.array(z.strictObject({
        closed: z.boolean(),
        points: z.array(z.tuple([hostNumber, hostNumber, hostNumber, hostNumber, hostNumber, hostNumber])).max(4_096),
    })).max(256),
});
const msOrNull = z.number().int().nonnegative().nullable();
export const displaySpacingHostDataSchema = z.strictObject({
    document: documentContextSchema,
    measure: z.enum(['outline', 'state_only']),
    frame: z.strictObject({
        uuid: z.string().min(1).max(255),
        kind: z.enum(['point', 'area']),
        contents: z.string().min(1).max(DISPLAY_SPACING_LIMITS.characters),
    }),
    states: z.array(hostStateSchema).min(1).max(DISPLAY_SPACING_LIMITS.characters),
    savedBefore: z.boolean(),
    savedAfter: z.boolean(),
    outline: z.strictObject({
        before: snapshotSchema,
        after: snapshotSchema,
        copyStates: z.array(hostStateSchema).max(DISPLAY_SPACING_LIMITS.characters).nullable(),
        glyphs: z.array(glyphSchema).max(DISPLAY_SPACING_LIMITS.characters).nullable(),
        preview: z.strictObject({
            clip: z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int()]),
            skipped: z.enum(['preview_outside_scratch_board', 'preview_too_large']).nullable(),
            captureError: z.string().nullable(),
            outputExists: z.boolean(),
            captureMs: msOrNull,
        }).nullable(),
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
const emValue = z.number().finite();
const characterSchema = z.strictObject({
    index: z.number().int().nonnegative(),
    char: z.string().length(1),
    kerning_method: kerningMethodSchema,
    manual_kerning: z.number().int().nullable(),
    proportional_metrics: z.boolean(),
    tsume: z.number(),
    aki_left: z.number(),
    aki_right: z.number(),
    tracking: z.number(),
    font: z.string(),
});
const boundarySchema = z.enum(['latin', 'japanese', 'wa_o', 'word_space']);
const candidateReasonSchema = z.enum(['toward_target', 'limited_by_collision', 'limited_to_range']);
const pairSchema = z.strictObject({
    index: z.number().int().positive(),
    left: z.string().length(1),
    right: z.string().length(1),
    boundary: boundarySchema,
    manual_kerning: z.number().int().nullable(),
    bbox_gap_em: emValue,
    min_gap_em: emValue.nullable(),
    white_em: emValue.nullable(),
    collision: z.boolean(),
    deviation_em: emValue.nullable(),
    candidate: z.strictObject({
        kerning_change: z.number().int().min(-DISPLAY_SPACING_LIMITS.kerningChange).max(DISPLAY_SPACING_LIMITS.kerningChange),
        determinism: z.literal('heuristic'),
        reason: candidateReasonSchema,
    }).nullable(),
});
export const displaySpacingResultSchema = z.strictObject({
    document: documentContextSchema,
    measure: z.enum(['outline', 'state_only']),
    frame: z.strictObject({
        uuid: z.string(),
        kind: z.enum(['point', 'area']),
        contents: z.string(),
        size_pt: z.number().positive(),
        fonts: z.array(z.string()),
    }),
    characters: z.array(characterSchema),
    pairs: z.array(pairSchema),
    target_white_em: emValue.nullable(),
    depth_cap_em: z.number(),
    warnings: z.array(z.enum(DISPLAY_SPACING_WARNINGS)),
    candidate_note: z.literal(DISPLAY_SPACING_CANDIDATE_NOTE),
    preview: z.strictObject({
        clip_pt: z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int()]),
        resolution_ppi: z.literal(DISPLAY_SPACING_PREVIEW_PPI),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        bytes: z.number().int().positive(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    }).nullable(),
    source_unchanged: z.literal(true),
    timing_ms: z.strictObject({ scratch_open: msOrNull, measure: msOrNull, scratch_close: msOrNull, scratch_active: msOrNull }),
});
export class DisplaySpacingRejectedError extends Error {
    code;
    constructor(code, message) {
        super(`${code}: ${message}`);
        this.code = code;
        this.name = 'DisplaySpacingRejectedError';
    }
}
export class DisplaySpacingFailedError extends Error {
    code;
    constructor(code, message) {
        super(`${code}: ${message}`);
        this.code = code;
        this.name = 'DisplaySpacingFailedError';
    }
}
const REJECT_MESSAGES = {
    not_text: 'the item is not a TextFrame',
    path_text: 'path text is not supported',
    vertical: 'vertical text is not supported',
    locked_or_hidden: 'the frame or an ancestor is locked or hidden',
    threaded: 'threaded text is not supported',
    empty: 'the frame is empty',
    too_long: `the frame holds more than ${DISPLAY_SPACING_LIMITS.characters} UTF-16 units`,
    multiple_lines: 'the frame has more than one line (a line break or a wrap)',
    overset: 'the frame shows only part of its text',
    unsupported_characters: 'the text holds a control character, a surrogate pair, a variation selector or a combining mark',
    mixed_size: 'the characters do not share one font size',
    too_few_glyphs: 'fewer than two inked characters',
    transformed: 'the frame is rotated, sheared, flipped or scaled',
    unreadable: 'Illustrator did not answer a property of the frame',
};
function parseHostError(error) {
    if (!(error instanceof Error) || !error.message.startsWith('MCP_ERROR:'))
        return null;
    try {
        const parsed = JSON.parse(error.message.slice('MCP_ERROR:'.length));
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}
const leftoverSchema = z.array(z.strictObject({
    key: z.string(), keyShort: z.string(), name: z.string(), saved: z.boolean(), active: z.boolean(),
}));
export function displaySpacingHostErrorMessage(detail) {
    if (detail?.code === 'DISPLAY_SPACING_TARGET_UNSUPPORTED') {
        const reason = detail.reason;
        const text = reason !== undefined && reason in REJECT_MESSAGES ? REJECT_MESSAGES[reason] : 'unsupported frame';
        return `${reason ?? 'unknown'}: ${text}. v1 measures one horizontal, single-line, ` +
            'unrotated point or area frame. Nothing was opened or measured.';
    }
    if (detail?.code === 'DISPLAY_SPACING_UUID_LOOKUP_UNAVAILABLE')
        return 'Illustrator native UUID lookup is unavailable.';
    if (detail?.code === 'DISPLAY_SPACING_SCRATCH_LEFT_OPEN') {
        const parsed = leftoverSchema.safeParse(detail.documents);
        const documents = parsed.success ? parsed.data : [];
        const listed = documents.map((entry) => `key ${JSON.stringify(entry.key)} (name ${JSON.stringify(entry.name)}` +
            `${entry.active ? ', active' : ''})`).join('; ');
        if (documents.length === 1) {
            return `a scratch document of an earlier call is still open: ${listed}. It has no ` +
                `file and only the layer "${DISPLAY_SPACING_SCRATCH_LAYER}". Check it in Illustrator, then close it without saving with ` +
                'illustrator_close_document (expected_document_key = that key, discard_changes = true; bring it to the front first ' +
                'if it is not active) and read the source key again with illustrator_get_context. Nothing was closed or measured.';
        }
        return `${documents.length} scratch documents are open (${listed}). The outcome of ` +
            'the earlier calls is unknown; check every one in Illustrator by eye before closing anything. Nothing was closed or measured.';
    }
    return null;
}
export function flattenOutline(path) {
    const points = path.points;
    const out = [];
    const segments = path.closed ? points.length : points.length - 1;
    for (let segment = 0; segment < segments; segment += 1) {
        const p = points[segment];
        const q = points[(segment + 1) % points.length];
        for (let step = 0; step < CUBIC_STEPS; step += 1) {
            const u = step / CUBIC_STEPS;
            const v = 1 - u;
            out.push([
                v * v * v * p[0] + 3 * v * v * u * p[4] + 3 * v * u * u * q[2] + u * u * u * q[0],
                v * v * v * p[1] + 3 * v * v * u * p[5] + 3 * v * u * u * q[3] + u * u * u * q[1],
            ]);
        }
    }
    return out;
}
export function inkSpan(polygons, y) {
    let min = Infinity;
    let max = -Infinity;
    for (const polygon of polygons) {
        for (let index = 0; index < polygon.length; index += 1) {
            const [x1, y1] = polygon[index];
            const [x2, y2] = polygon[(index + 1) % polygon.length];
            if ((y1 <= y && y < y2) || (y2 <= y && y < y1)) {
                const x = x1 + ((y - y1) * (x2 - x1)) / (y2 - y1);
                if (x < min)
                    min = x;
                if (x > max)
                    max = x;
            }
        }
    }
    return min === Infinity ? null : [min, max];
}
function median(values) {
    if (values.length === 0)
        return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
const round4 = (value) => Math.round(value * 10_000) / 10_000;
export function minimumGap(left, right) {
    const top = Math.min(left.bounds[1], right.bounds[1]);
    const bottom = Math.max(left.bounds[3], right.bounds[3]);
    if (!(top > bottom))
        return null;
    const step = (top - bottom) / SCANLINES;
    let min = null;
    for (let row = 0; row < SCANLINES; row += 1) {
        const y = bottom + (row + 0.5) * step;
        const a = inkSpan(left.polygons, y);
        const b = inkSpan(right.polygons, y);
        if (a && b && (min === null || b[0] - a[1] < min))
            min = b[0] - a[1];
    }
    return min;
}
export function cappedWhite(left, right, band, cap) {
    const [bottom, top] = band;
    const step = (top - bottom) / SCANLINES;
    const boxGap = right.bounds[0] - left.bounds[2];
    let sum = 0;
    for (let row = 0; row < SCANLINES; row += 1) {
        const y = bottom + (row + 0.5) * step;
        const a = inkSpan(left.polygons, y);
        const b = inkSpan(right.polygons, y);
        const depthLeft = a === null ? cap : Math.min(Math.max(left.bounds[2] - a[1], 0), cap);
        const depthRight = b === null ? cap : Math.min(Math.max(b[0] - right.bounds[0], 0), cap);
        sum += boxGap + depthLeft + depthRight;
    }
    return sum / SCANLINES;
}
function isJapanese(code) {
    return (code >= 0x3000 && code <= 0x30FF) || (code >= 0x31F0 && code <= 0x31FF) || (code >= 0x3400 && code <= 0x4DBF) ||
        (code >= 0x4E00 && code <= 0x9FFF) || (code >= 0xF900 && code <= 0xFAFF) || (code >= 0xFF01 && code <= 0xFF60) ||
        (code >= 0xFF66 && code <= 0xFF9F);
}
const isSpace = (code) => DISPLAY_SPACING_SPACE_CODES.includes(code);
function methodOf(raw) {
    const method = KERNING_METHODS[raw];
    if (method === undefined)
        throw new DisplaySpacingFailedError('DISPLAY_SPACING_STATE_UNREADABLE', `Unknown kerning method ${JSON.stringify(raw)}.`);
    return method;
}
function sameState(a, b) {
    return a.kerning === b.kerning && a.method === b.method && a.palt === b.palt && a.tsume === b.tsume && a.akiLeft === b.akiLeft &&
        a.akiRight === b.akiRight && a.tracking === b.tracking && a.size === b.size && a.font === b.font;
}
export function describeSnapshotChanges(before, after) {
    const changes = [];
    for (const field of ['key', 'index', 'saved', 'documents', 'pageItems', 'layers', 'selection', 'views', 'zoom', 'screenMode']) {
        if (before[field] !== after[field])
            changes.push(`${field} ${JSON.stringify(before[field])} -> ${JSON.stringify(after[field])}`);
    }
    if (before.center[0] !== after.center[0] || before.center[1] !== after.center[1])
        changes.push('view center');
    if (!after.active)
        changes.push('the source is no longer the active document');
    if (!after.activeLayer)
        changes.push('the active layer changed');
    return changes;
}
export function judgeDisplaySpacing(host, options, preview = null) {
    const contents = host.frame.contents;
    if (host.states.length !== contents.length) {
        throw new DisplaySpacingFailedError('DISPLAY_SPACING_STATE_UNREADABLE', 'The character states do not cover the frame contents.');
    }
    if (host.savedBefore !== host.savedAfter || host.savedBefore !== host.document.saved) {
        throw new DisplaySpacingFailedError('DISPLAY_SPACING_CHANGED_STATE', 'The saved state of the document changed during the read.');
    }
    const size = host.states[0].size;
    const characters = host.states.map((state, index) => ({
        index, char: contents[index], kerning_method: methodOf(state.method), manual_kerning: state.kerning,
        proportional_metrics: state.palt, tsume: state.tsume, aki_left: state.akiLeft, aki_right: state.akiRight,
        tracking: state.tracking, font: state.font,
    }));
    const warnings = new Set();
    const methods = new Set(characters.map((entry) => entry.kerning_method));
    if (characters.some((entry) => entry.kerning_method === 'optical'))
        warnings.add('optical_method');
    if (characters.some((entry) => entry.kerning_method === 'optical' && entry.proportional_metrics))
        warnings.add('optical_with_proportional_metrics');
    if (methods.size > 1)
        warnings.add('mixed_kerning_method');
    if (methods.has('none'))
        warnings.add('noautokern_reads_zero');
    if (characters.some((entry) => (entry.kerning_method === 'auto' || entry.kerning_method === 'metrics_roman_only') &&
        entry.manual_kerning !== null))
        warnings.add('manual_kerning_with_auto_method');
    const base = {
        document: host.document, measure: host.measure,
        frame: { uuid: host.frame.uuid, kind: host.frame.kind, contents, size_pt: size, fonts: [...new Set(characters.map((entry) => entry.font))] },
        characters, depth_cap_em: options.depthCapEm, candidate_note: DISPLAY_SPACING_CANDIDATE_NOTE, source_unchanged: true,
    };
    if (host.measure === 'state_only') {
        return displaySpacingResultSchema.parse({ ...base, pairs: [], target_white_em: null, warnings: [...warnings], preview: null,
            timing_ms: { scratch_open: null, measure: null, scratch_close: null, scratch_active: null } });
    }
    const outline = host.outline;
    if (outline === null)
        throw new DisplaySpacingFailedError('DISPLAY_SPACING_OUTLINE_MISSING', 'Illustrator returned no outline measurement.');
    const changes = describeSnapshotChanges(outline.before, outline.after);
    if (changes.length > 0) {
        throw new DisplaySpacingFailedError('DISPLAY_SPACING_CHANGED_STATE', `The source document or its view changed (${changes.join('; ')}). ` +
            'No result is returned; read the document context again before any further operation.');
    }
    if (outline.measureError !== null) {
        throw new DisplaySpacingFailedError('DISPLAY_SPACING_MEASURE_FAILED', `Illustrator failed while measuring the scratch copy: ` +
            `${outline.measureError}. The scratch document was closed and the source is unchanged.`);
    }
    if (outline.copyStates === null || outline.copyStates.length !== host.states.length ||
        outline.copyStates.some((state, index) => !sameState(state, host.states[index]))) {
        throw new DisplaySpacingFailedError('DISPLAY_SPACING_COPY_STATE_CHANGED', 'The copy in the scratch document does not keep ' +
            'the per-character spacing state of the source frame, so its outline would not show the source spacing. Nothing is returned.');
    }
    const inked = [...contents].map((char, index) => ({ char, index })).filter((entry) => !isSpace(entry.char.charCodeAt(0)));
    const rawGlyphs = outline.glyphs ?? [];
    if (rawGlyphs.length !== inked.length || rawGlyphs.some((glyph) => (glyph.typename !== 'CompoundPathItem' && glyph.typename !== 'PathItem') || glyph.paths.length === 0 ||
        glyph.paths.some((path) => path.points.length < 2))) {
        throw new DisplaySpacingFailedError('GLYPH_MAPPING_UNAVAILABLE', `The outline has ${rawGlyphs.length} items for ${inked.length} ` +
            'inked characters, or an item that is not a path (a ligature or a glyph substitution). No pair can be attributed.');
    }
    const glyphs = [...rawGlyphs].reverse().map((glyph) => ({ bounds: glyph.bounds, polygons: glyph.paths.map(flattenOutline) }));
    const centre = (glyph) => (glyph.bounds[0] + glyph.bounds[2]) / 2;
    if (glyphs.some((glyph, index) => index > 0 && !(centre(glyph) > centre(glyphs[index - 1])))) {
        throw new DisplaySpacingFailedError('GLYPH_MAPPING_UNAVAILABLE', 'The outlined glyphs do not run left to right in story order.');
    }
    const band = [median(glyphs.map((glyph) => glyph.bounds[3])), median(glyphs.map((glyph) => glyph.bounds[1]))];
    const cap = options.depthCapEm * size;
    const measured = inked.slice(1).map((right, position) => {
        const left = inked[position];
        const a = glyphs[position];
        const b = glyphs[position + 1];
        const spaced = right.index - left.index > 1;
        const leftCode = left.char.charCodeAt(0);
        const rightCode = right.char.charCodeAt(0);
        const boundary = spaced ? 'word_space'
            : isJapanese(leftCode) && isJapanese(rightCode) ? 'japanese'
                : isJapanese(leftCode) || isJapanese(rightCode) ? 'wa_o' : 'latin';
        const minGap = minimumGap(a, b);
        const white = band[1] > band[0] ? cappedWhite(a, b, band, cap) / size : null;
        return { index: right.index, left: left.char, right: right.char, boundary, manual_kerning: host.states[right.index].kerning,
            bbox_gap_em: round4((b.bounds[0] - a.bounds[2]) / size), min_gap_em: minGap === null ? null : round4(minGap / size),
            white_em: white === null ? null : round4(white), collision: minGap !== null && minGap < 0 };
    });
    const letterWhites = measured.filter((pair) => pair.boundary !== 'word_space' && pair.white_em !== null).map((pair) => pair.white_em);
    const frameMedian = median(letterWhites);
    const target = options.targetWhiteEm ?? frameMedian;
    if (measured.some((pair) => pair.collision))
        warnings.add('collision');
    const pairs = measured.map((pair) => {
        const deviation = pair.white_em === null || frameMedian === null ? null : round4(pair.white_em - frameMedian);
        let candidate = null;
        if (pair.boundary !== 'word_space' && pair.white_em !== null && target !== null) {
            let change = Math.round((target - pair.white_em) * 1000);
            let reason = 'toward_target';
            if (pair.min_gap_em !== null) {
                const floor = Math.ceil(-pair.min_gap_em * 1000);
                if (change < floor) {
                    change = floor;
                    reason = 'limited_by_collision';
                }
            }
            if (Math.abs(change) > DISPLAY_SPACING_LIMITS.kerningChange) {
                change = Math.sign(change) * DISPLAY_SPACING_LIMITS.kerningChange;
                reason = 'limited_to_range';
            }
            if (change !== 0)
                candidate = { kerning_change: change, determinism: 'heuristic', reason };
        }
        return { ...pair, deviation_em: deviation, candidate };
    });
    if (outline.preview?.skipped)
        warnings.add(outline.preview.skipped);
    if (outline.closeError !== null)
        warnings.add('scratch_close_reported_error');
    return displaySpacingResultSchema.parse({
        ...base, pairs, target_white_em: target === null ? null : round4(target), warnings: [...warnings], preview,
        timing_ms: { scratch_open: outline.times.open, measure: outline.times.measure, scratch_close: outline.times.close,
            scratch_active: outline.times.active },
    });
}
function describeProfile(observation) {
    return `profile ${observation.profile}, lock ${observation.lockState}, frontmost ${observation.frontmostBundleId ?? 'unknown'}, expected ${observation.expectedBundleId}`;
}
async function removeStaging(directory, file) {
    try {
        await unlink(file).catch((error) => { if (error.code !== 'ENOENT')
            throw error; });
        await rmdir(directory);
        return true;
    }
    catch {
        return false;
    }
}
export async function analyzeDisplaySpacing(deps, input) {
    const outline = input.measure === 'outline';
    if (!outline && input.includePreview) {
        throw new DisplaySpacingRejectedError('DISPLAY_SPACING_PREVIEW_REQUIRES_OUTLINE', 'include_preview needs measure "outline"; nothing was read.');
    }
    if (outline) {
        const observation = deps.hostProfileProbe.observeForEditSession
            ? await deps.hostProfileProbe.observeForEditSession()
            : await deps.hostProfileProbe.observe();
        if (observation.profile !== 'foreground') {
            throw new DisplaySpacingRejectedError('DISPLAY_SPACING_UNSUPPORTED_HOST_PROFILE', 'measure "outline" opens a scratch ' +
                `document and is supported only with the screen unlocked and Illustrator frontmost (${describeProfile(observation)}); ` +
                'nothing was opened. measure "state_only" opens nothing.');
        }
    }
    let staging = null;
    if (outline && input.includePreview) {
        try {
            if (isWindowsPrivateState())
                await ensurePrivateStateRoot(dirname(deps.previewRoot));
            await ensurePrivateDirectory(deps.previewRoot, 'preview staging root');
            staging = await createStagingDirectory(deps.previewRoot, randomUUID(), PREVIEW_FILE_NAME, PREVIEW_STAGING_PREFIX);
        }
        catch (error) {
            throw new DisplaySpacingRejectedError('DISPLAY_SPACING_STAGING_UNAVAILABLE', error instanceof Error ? error.message : String(error));
        }
    }
    let host;
    let privateSource;
    try {
        const data = (await deps.bridge.execute({
            kind: 'read',
            script: DISPLAY_SPACING_SCRIPT,
            ...(outline ? {} : { hostGate: deps.reportingReadGate }),
            ...(isWindowsPrivateState() && staging !== null ? { hostGate: privatePreviewReadGate(staging.stagedPath, (data) => {
                    const capture = displaySpacingHostDataSchema.parse(data).outline?.preview;
                    return capture !== null && capture !== undefined && capture.skipped === null && capture.captureError === null && capture.outputExists;
                }, (source) => { privateSource = source; }) } : {}),
            params: {
                expectedDocumentKey: input.expectedDocumentKey,
                targetUuid: input.targetUuid,
                measure: input.measure,
                scratchLayer: DISPLAY_SPACING_SCRATCH_LAYER,
                maxCharacters: DISPLAY_SPACING_LIMITS.characters,
                preview: staging === null ? null
                    : { path: staging.stagedPath, resolution: DISPLAY_SPACING_PREVIEW_PPI, maxSidePt: DISPLAY_SPACING_PREVIEW_MAX_SIDE_PT },
            },
            timeoutMs: DISPLAY_SPACING_HOST_TIMEOUT_MS,
        })).data;
        host = displaySpacingHostDataSchema.parse(data);
    }
    catch (error) {
        if (error instanceof IndeterminateExecutionError) {
            const kept = staging === null ? '' : ` The preview staging directory is kept: ${staging.directory}.`;
            throw new IndeterminateExecutionError(`${error.message} ${outline ? 'The outcome is unknown: a scratch document may still be open. Run illustrator_reconcile ' +
                'before the next command; the next illustrator_analyze_display_spacing call reports a scratch document left open.'
                : 'Run illustrator_reconcile before the next command.'}${kept}`, error.commandId, { code: error.code, exitCode: error.exitCode, signal: error.signal, killed: error.killed });
        }
        if (staging !== null)
            await removeStaging(staging.directory, staging.stagedPath);
        const detail = parseHostError(error);
        if (detail?.code === 'DOCUMENT_MISMATCH')
            throw new DocumentMismatchError(detail.expected ?? input.expectedDocumentKey, detail.actual ?? '');
        if (detail?.code === 'OBJECT_NOT_FOUND')
            throw new ObjectNotFoundError(detail.uuid ?? input.targetUuid);
        const message = displaySpacingHostErrorMessage(detail);
        if (message !== null)
            throw new DisplaySpacingRejectedError(detail.code, message);
        throw error;
    }
    let png = null;
    let preview = null;
    try {
        const capture = host.outline?.preview ?? null;
        if (staging !== null && capture !== null && capture.skipped === null) {
            if (capture.captureError !== null) {
                throw new DisplaySpacingFailedError('DISPLAY_SPACING_PREVIEW_FAILED', `Illustrator imageCapture failed: ${capture.captureError}.`);
            }
            if (!capture.outputExists)
                throw new DisplaySpacingFailedError('DISPLAY_SPACING_PREVIEW_FAILED', 'Illustrator reported no capture file.');
            const scale = DISPLAY_SPACING_PREVIEW_PPI / 72;
            const width = (capture.clip[2] - capture.clip[0]) * scale;
            const height = (capture.clip[1] - capture.clip[3]) * scale;
            try {
                if (isWindowsPrivateState() && privateSource === undefined)
                    throw new Error('Bridge did not verify private preview readback under its lock.');
                const source = isWindowsPrivateState() ? privateSource : await readStableImage(staging.stagedPath, 'preview');
                const dimensions = inspectSupportedPng(source.bytes, 'preview');
                if (dimensions.width !== width || dimensions.height !== height) {
                    throw new Error(`the capture is ${dimensions.width}x${dimensions.height} px, expected ${width}x${height} px`);
                }
                if (decodePng(source.bytes, 'preview').length !== width * height * 4)
                    throw new Error('the decoded pixel count does not match');
                png = source.bytes;
            }
            catch (error) {
                throw new DisplaySpacingFailedError('DISPLAY_SPACING_PREVIEW_FAILED', error instanceof Error ? error.message : String(error));
            }
            preview = { clip_pt: capture.clip, resolution_ppi: DISPLAY_SPACING_PREVIEW_PPI, width, height, bytes: png.length,
                sha256: createHash('sha256').update(png).digest('hex') };
        }
        const result = judgeDisplaySpacing(host, { depthCapEm: input.depthCapEm, targetWhiteEm: input.targetWhiteEm ?? null }, preview);
        return { result, png };
    }
    finally {
        if (staging !== null)
            await removeStaging(staging.directory, staging.stagedPath);
    }
}
