import { z } from 'zod';
import { AREA_TEXT_MAX_LINES, AREA_TEXT_SNAPSHOT_SCRIPT, PLAIN_AREA_TEXT_V1 } from './adapters/area-text-host-script.js';
import { COMPOSED_AREA_LAYOUT_SCRIPT } from './adapters/area-text-layout.js';
import { POINT_TEXT_BLOCKERS_SCRIPT, POINT_TEXT_SNAPSHOT_SCRIPT } from './adapters/point-text-host-script.js';
import { SNAPSHOT_RESULT_SIZE_SCRIPT } from './adapters/snapshot-result-size.js';
import { HORIZONTAL_SCALE_DECIMALS, quantizeHorizontalScale, TEXT_COMPOSITION_MODULE_SCRIPT } from './adapters/text-composition-profile.js';
import { MUTATION_TRANSACTION_SCRIPT } from './mutation-transaction.js';
import { describeSnapshotChanges } from './display-spacing.js';
import { DocumentMismatchError, IndeterminateExecutionError, ObjectNotFoundError } from './domain.js';
import { documentContextSchema } from './mutation-result-schema-core.js';
export const PLAN_TEXT_FIT_LIMITS = {
    characters: 150,
    candidates: 100,
    defaultCandidates: 50,
    trackingRange: 1000,
    horizontalScaleMin: 1,
    horizontalScaleMax: 1000,
};
export const PLAN_TEXT_FIT_HOST_TIMEOUT_MS = 30_000;
export const PLAN_TEXT_FIT_CANDIDATE_DEADLINE_MS = 15_000;
export const PLAN_TEXT_FIT_SCRATCH_LAYER = 'illustrator-studio-mcp plan text fit scratch';
const DISPLAY_SPACING_SCRATCH_LAYER_NAME = 'illustrator-studio-mcp display spacing scratch';
const READBACK_TOLERANCE = 1e-4;
export const PLAN_TEXT_FIT_REJECT_REASONS = ['not_text', 'point_text', 'path_text', 'vertical', 'locked_or_hidden', 'threaded',
    'empty', 'too_long', 'unsupported_characters', 'mixed_base_values', 'unreadable'];
export const PLAN_TEXT_FIT_ORDERS = ['tracking_first', 'horizontal_scale_first'];
export class PlanTextFitRejectedError extends Error {
    code;
    constructor(code, message) {
        super(`${code}: ${message}`);
        this.code = code;
        this.name = 'PlanTextFitRejectedError';
    }
}
export class PlanTextFitFailedError extends Error {
    code;
    constructor(code, message) {
        super(`${code}: ${message}`);
        this.code = code;
        this.name = 'PlanTextFitFailedError';
    }
}
function clean(value) {
    const rounded = Number(value.toFixed(6));
    return rounded === 0 ? 0 : rounded;
}
export function fitValues(axis, budget) {
    if (![axis.min, axis.max, axis.step].every(Number.isFinite) || axis.step <= 0 || axis.max < axis.min) {
        throw new PlanTextFitRejectedError('PLAN_TEXT_FIT_INVALID_AXIS', 'An axis needs finite min <= max and a positive step.');
    }
    const intervals = Math.floor((axis.max - axis.min) / axis.step + 1e-9);
    if (!Number.isSafeInteger(intervals) || intervals + 1 > budget) {
        throw new PlanTextFitRejectedError('PLAN_TEXT_FIT_TOO_MANY_CANDIDATES', `One axis alone holds more than the ${budget} candidates allowed. Raise step, narrow min/max, or raise max_candidates (at most ${PLAN_TEXT_FIT_LIMITS.candidates}).`);
    }
    return Array.from({ length: intervals + 1 }, (_, index) => clean(axis.max - index * axis.step));
}
export function fitCandidates(tracking, horizontalScale, order, budget) {
    if (!Number.isSafeInteger(budget) || budget < 1) {
        throw new PlanTextFitRejectedError('PLAN_TEXT_FIT_INVALID_BUDGET', 'max_candidates must be a positive integer.');
    }
    if (tracking === null && horizontalScale === null) {
        throw new PlanTextFitRejectedError('PLAN_TEXT_FIT_NO_AXIS', 'Search at least one of tracking and horizontal_scale.');
    }
    const trackings = tracking === null ? [undefined] : fitValues(tracking, budget);
    const scales = horizontalScale === null ? [undefined] : fitValues(horizontalScale, budget);
    if (trackings.length * scales.length > budget) {
        throw new PlanTextFitRejectedError('PLAN_TEXT_FIT_TOO_MANY_CANDIDATES', `The grid holds ${trackings.length * scales.length} candidates, more than max_candidates ${budget}. Raise step, narrow min/max, or raise max_candidates (at most ${PLAN_TEXT_FIT_LIMITS.candidates}).`);
    }
    const make = (t, h) => ({
        ...(t === undefined ? {} : { tracking: t }), ...(h === undefined ? {} : { horizontalScale: h }),
    });
    return order === 'tracking_first'
        ? scales.flatMap((h) => trackings.map((t) => make(t, h)))
        : trackings.flatMap((t) => scales.map((h) => make(t, h)));
}
export function chooseFit(evaluated, maxLines) {
    const index = evaluated.findIndex((entry) => entry.fit === 'fits' && entry.exact && (maxLines === null || entry.lineCount <= maxLines));
    return index < 0 ? null : index;
}
const axisSchema = (minimum, maximum) => z.strictObject({
    min: z.number().min(minimum).max(maximum),
    max: z.number().min(minimum).max(maximum),
    step: z.number().positive().max(maximum - minimum),
});
const trackingAxisSchema = axisSchema(-PLAN_TEXT_FIT_LIMITS.trackingRange, PLAN_TEXT_FIT_LIMITS.trackingRange);
const horizontalScaleAxisSchema = axisSchema(PLAN_TEXT_FIT_LIMITS.horizontalScaleMin, PLAN_TEXT_FIT_LIMITS.horizontalScaleMax);
export const planTextFitSearchSchema = z.strictObject({
    tracking: trackingAxisSchema.optional(),
    horizontal_scale: horizontalScaleAxisSchema.optional(),
    order: z.enum(PLAN_TEXT_FIT_ORDERS).default('tracking_first'),
}).refine((search) => search.tracking !== undefined || search.horizontal_scale !== undefined, { message: 'search needs at least one of tracking and horizontal_scale' });
export const planTextFitConstraintSchema = z.strictObject({
    max_lines: z.number().int().min(1).max(AREA_TEXT_MAX_LINES).optional(),
    require_fits: z.literal(true).default(true),
});
const CHARACTER_NAMES = [...Object.keys(PLAIN_AREA_TEXT_V1.character), 'size', 'tracking', 'horizontalScale', 'verticalScale', 'leading'];
const PARAGRAPH_NAMES = [...Object.keys(PLAIN_AREA_TEXT_V1.paragraph), 'justification'];
const FRAME_NAMES = Object.keys(PLAIN_AREA_TEXT_V1.frame).filter((name) => name !== 'contentVariable' && name !== 'visibilityVariable');
export const PLAN_TEXT_FIT_SCRIPT = `${SNAPSHOT_RESULT_SIZE_SCRIPT}
${MUTATION_TRANSACTION_SCRIPT}
${POINT_TEXT_SNAPSHOT_SCRIPT}
${POINT_TEXT_BLOCKERS_SCRIPT}
var MUTATION_SIDE_EFFECT_ATTEMPTED = false;
var MUTATION_RUNNER_DISPOSITION = null;
${AREA_TEXT_SNAPSHOT_SCRIPT}
${COMPOSED_AREA_LAYOUT_SCRIPT}
${TEXT_COMPOSITION_MODULE_SCRIPT}
var TF_START = new Date().getTime();
function tfNow() { return new Date().getTime(); }
function tfFail(code, detail) {
  detail.code = code;
  throw new Error("MCP_ERROR:" + stringifyJson(detail));
}
function tfReject(reason) { tfFail("PLAN_TEXT_FIT_TARGET_UNSUPPORTED", { reason: reason }); }
function tfMessage(error) {
  try { return String(error && error.message ? error.message : error); } catch (messageError) { return "unreadable error"; }
}
function tfTag(error) { return "!" + (error && typeof error.number === "number" ? String(error.number) : "x"); }
function tfValue(value) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  var type = typeof value;
  if (type === "number") return isFinite(value) ? String(value) : "nonfinite";
  if (type === "boolean") return value ? "true" : "false";
  if (type === "string") return "s:" + value;
  if (type === "function") return "function";
  return "o:" + String(value);
}
function tfRead(host, name) {
  try { return tfValue(host[name]); } catch (readError) { return tfTag(readError); }
}
function tfRound(value, factor) { return Math.round(Number(value) * factor) / factor; }
function tfColor(host, name) {
  try {
    var color = host[name];
    if (!color) return "none";
    var kind = String(color.typename);
    if (kind === "RGBColor") return kind + ":" + color.red + "," + color.green + "," + color.blue;
    if (kind === "CMYKColor") return kind + ":" + color.cyan + "," + color.magenta + "," + color.yellow + "," + color.black;
    if (kind === "GrayColor") return kind + ":" + color.gray;
    if (kind === "SpotColor") return kind + ":" + String(color.spot.name) + ":" + color.tint;
    return kind;
  } catch (colorError) { return tfTag(colorError); }
}
function tfSubset(host, names) {
  var parts = [];
  for (var index = 0; index < names.length; index++) parts.push(names[index] + "=" + tfRead(host, names[index]));
  return parts.join("|");
}
/** A scratch document: exactly one layer with a reserved name, and no file on disk. */
function tfScratchDocuments() {
  var found = [];
  for (var cursor = 0; cursor < app.documents.length; cursor++) {
    var candidate = app.documents[cursor];
    var layerName = "";
    try { layerName = candidate.layers.length === 1 ? String(candidate.layers[0].name) : ""; } catch (layerError) { layerName = ""; }
    var reserved = false;
    for (var nameIndex = 0; nameIndex < params.scratchLayers.length; nameIndex++) if (layerName === params.scratchLayers[nameIndex]) reserved = true;
    if (!reserved) continue;
    var identity = getDocumentIdentity(candidate, cursor);
    if (identity.fileExists === true) continue;
    found.push({ key: identity.key, keyShort: identity.keyShort, name: identity.name, saved: identity.saved,
      active: app.activeDocument === candidate });
  }
  return found;
}
function tfFind(document, uuid) {
  if (typeof document.getPageItemFromUuid !== "function") tfFail("PLAN_TEXT_FIT_UUID_LOOKUP_UNAVAILABLE", { uuid: uuid });
  var target = null;
  try {
    target = document.getPageItemFromUuid(uuid);
  } catch (lookupError) {
    var message = lookupError && lookupError.message ? String(lookupError.message) : "";
    if (!(lookupError && lookupError.name === "Error" && lookupError.number === 1200 &&
        message === "an Illustrator error occurred: 1346458189 ('MRAP')")) throw lookupError;
    target = null;
  }
  if (target === null || target === undefined) tfFail("OBJECT_NOT_FOUND", { uuid: uuid });
  if (String(target.typename) !== "TextFrame") tfReject("not_text");
  return target;
}
/** "locked_or_hidden", "readable", or "unreadable" from the frame and every ancestor up to the document. */
function tfLockState(frame) {
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
/** The source facts a read must leave alone, and the active document and view. */
function tfSnapshot(document, activeLayer) {
  var index = -1;
  for (var cursor = 0; cursor < app.documents.length; cursor++) if (app.documents[cursor] === document) index = cursor;
  var view = document.views[0];
  var center = view.centerPoint;
  return { key: getDocumentIdentity(document, index).key, index: index, saved: document.saved === true,
    documents: app.documents.length, active: app.activeDocument === document, pageItems: document.pageItems.length,
    layers: document.layers.length, selection: document.selection.length, activeLayer: document.activeLayer === activeLayer,
    views: document.views.length, zoom: view.zoom, center: [Number(center[0]), Number(center[1])], screenMode: String(view.screenMode) };
}
/** One character's whole attribute state as one string; the character is held while it is read (a released one expires, 9503). */
function tfCharacterRecord(held) {
  var attributes;
  try { attributes = held.characterAttributes; } catch (attributesError) { return "attributes" + tfTag(attributesError); }
  var parts = [tfSubset(attributes, params.characterNames)];
  var font;
  try { font = String(attributes.textFont.name); } catch (fontError) { font = tfTag(fontError); }
  parts.push("textFont=" + font);
  parts.push("fillColor=" + tfColor(attributes, "fillColor"));
  parts.push("strokeColor=" + tfColor(attributes, "strokeColor"));
  var kerning;
  try { kerning = tfValue(held.kerning); } catch (kerningError) { kerning = tfTag(kerningError); }
  parts.push("kerning=" + kerning);
  return parts.join("|");
}
function tfParagraphRecord(paragraph) {
  var attributes;
  try { attributes = paragraph.paragraphAttributes; } catch (attributesError) { return "attributes" + tfTag(attributesError); }
  var parts = [tfSubset(attributes, params.paragraphNames)];
  var tabs;
  try { tabs = String(attributes.tabStops.length); } catch (tabError) { tabs = tfTag(tabError); }
  parts.push("tabStops=" + tabs);
  var listStyle;
  try { listStyle = String(attributes.listStyle.name); } catch (listError) { listStyle = tfTag(listError); }
  parts.push("listStyle=" + listStyle);
  return parts.join("|");
}
/** Geometry as sizes and relative points: a copy in another document may sit elsewhere, but must have the same shape. */
function tfFrameRecord(frame) {
  var parts = [tfSubset(frame, params.frameNames)];
  try {
    var bounds = frame.geometricBounds;
    parts.push("size=" + tfRound(bounds[2] - bounds[0], 1000) + "x" + tfRound(bounds[1] - bounds[3], 1000));
  } catch (boundsError) { parts.push("size=" + tfTag(boundsError)); }
  try {
    var matrix = frame.matrix;
    var entries = [matrix.mValueA, matrix.mValueB, matrix.mValueC, matrix.mValueD];
    var rounded = [];
    for (var e = 0; e < entries.length; e++) rounded.push(tfRound(entries[e], 1000000));
    parts.push("matrix=" + rounded.join(","));
  } catch (matrixError) { parts.push("matrix=" + tfTag(matrixError)); }
  try {
    var points = frame.textPath.pathPoints;
    var origin = points[0].anchor;
    var shape = [String(frame.textPath.closed)];
    for (var p = 0; p < points.length; p++) {
      var point = points[p];
      shape.push([tfRound(point.anchor[0] - origin[0], 1000), tfRound(point.anchor[1] - origin[1], 1000),
        tfRound(point.leftDirection[0] - origin[0], 1000), tfRound(point.leftDirection[1] - origin[1], 1000),
        tfRound(point.rightDirection[0] - origin[0], 1000), tfRound(point.rightDirection[1] - origin[1], 1000)].join(","));
    }
    parts.push("textPath=" + shape.join(";"));
  } catch (pathError) { parts.push("textPath=" + tfTag(pathError)); }
  return parts.join("|");
}
/** The whole frame as strings: text, frame, every paragraph and every character. */
function tfFingerprint(frame) {
  var fingerprint = { text: "", frame: "", paragraphs: [], characters: [] };
  fingerprint.text = tfValue(frame.contents);
  fingerprint.frame = tfFrameRecord(frame);
  var paragraphs = frame.paragraphs;
  for (var p = 0; p < paragraphs.length; p++) fingerprint.paragraphs.push(tfParagraphRecord(paragraphs[p]));
  var characters = frame.characters;
  var count = characters.length;
  for (var c = 0; c < count; c++) {
    var held = characters[c];
    fingerprint.characters.push(tfCharacterRecord(held));
  }
  return fingerprint;
}
function tfWithout(record, ignored) {
  if (!ignored) return record;
  var kept = [];
  var parts = record.split("|");
  for (var index = 0; index < parts.length; index++) {
    var name = parts[index].split("=")[0];
    var skip = false;
    for (var i = 0; i < ignored.length; i++) if (name === ignored[i]) skip = true;
    if (!skip) kept.push(parts[index]);
  }
  return kept.join("|");
}
/** The differences between two fingerprints, at most eight, naming the part (and the first differing attribute for a character). */
function tfDiff(left, right, ignored) {
  var found = [];
  function add(label) { if (found.length < 8) found.push(label); }
  if (left.text !== right.text) add("text");
  if (left.frame !== right.frame) add("frame");
  if (left.paragraphs.length !== right.paragraphs.length) add("paragraph_count");
  for (var p = 0; p < left.paragraphs.length && p < right.paragraphs.length; p++) {
    if (left.paragraphs[p] !== right.paragraphs[p]) add("paragraph[" + p + "]");
  }
  if (left.characters.length !== right.characters.length) add("character_count");
  for (var c = 0; c < left.characters.length && c < right.characters.length; c++) {
    var a = tfWithout(left.characters[c], ignored);
    var b = tfWithout(right.characters[c], ignored);
    if (a === b) continue;
    var first = a.split("|"); var second = b.split("|");
    var name = "record";
    for (var k = 0; k < first.length && k < second.length; k++) if (first[k] !== second[k]) { name = first[k].split("=")[0]; break; }
    add("character[" + c + "]." + name);
  }
  return found;
}
/** Two 32-bit FNV-1a lanes over every part: change detection, not security. */
function tfDigest(fingerprint) {
  var lanes = [0x811c9dc5, 0x9747b28c];
  var parts = [fingerprint.text, fingerprint.frame].concat(fingerprint.paragraphs, fingerprint.characters);
  for (var index = 0; index < parts.length; index++) {
    var text = parts[index] + "\\n";
    for (var at = 0; at < text.length; at++) {
      for (var lane = 0; lane < 2; lane++) {
        var h = lanes[lane] ^ text.charCodeAt(at);
        lanes[lane] = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
      }
    }
  }
  return ("00000000" + lanes[0].toString(16)).slice(-8) + ("00000000" + lanes[1].toString(16)).slice(-8);
}
function tfLayoutKey(layout) {
  if (layout === null) return "unreadable";
  return stringifyJson({ status: layout.fit.status, visible: layout.fit.visibleCharacterCount, requested: layout.fit.requestedCharacterCount,
    lineCount: layout.lineCount, lines: layout.lines });
}
/** The searched values of every character: a number when they all agree, "mixed" when they do not, null for an axis not searched. */
function tfSearchedValues(frame, count) {
  var out = { tracking: null, horizontalScale: null };
  var characters = frame.characters;
  var names = [];
  if (params.axes.tracking) names.push("tracking");
  if (params.axes.horizontalScale) names.push("horizontalScale");
  var seen = {};
  for (var index = 0; index < count; index++) {
    var held = characters[index];
    var attributes = held.characterAttributes;
    for (var n = 0; n < names.length; n++) {
      var value = Number(attributes[names[n]]);
      if (!isFinite(value)) tfReject("unreadable");
      if (seen[names[n]] === undefined) seen[names[n]] = value;
      else if (seen[names[n]] !== value) seen[names[n]] = "mixed";
    }
  }
  for (var m = 0; m < names.length; m++) out[names[m]] = seen[names[m]];
  return out;
}
function tfSameSnapshot(before, after) {
  var fields = ["key", "index", "saved", "documents", "active", "pageItems", "layers", "selection", "activeLayer", "views", "zoom", "screenMode"];
  for (var index = 0; index < fields.length; index++) if (before[fields[index]] !== after[fields[index]]) return false;
  return before.center[0] === after.center[0] && before.center[1] === after.center[1];
}

/**
 * Whether illustrator_set_text_composition accepts the chosen values on the source frame: its own preflight (snapshot reader, admission, plan blockers), read-only,
 * run after the scratch document is closed. Never throws. A refusal carries the writer's own message.
 */
function tfWriteProbe(chosen, count) {
  var request = { start: 0, end: count }, same = true;
  if (params.axes.tracking) { request.tracking = chosen.tracking; if (chosen.tracking !== tfBaseValues.tracking) same = false; }
  // The scale is held as a single-precision fraction (90 reads 90.0000023841858): compare what the writer would read back, at five decimals, as strings.
  if (params.axes.horizontalScale) {
    request.horizontalScale = chosen.horizontalScale;
    if (String(tcQuantScale(chosen.horizontalScale)) !== String(Math.round(tfBaseValues.horizontalScale * 100000) / 100000)) same = false;
  }
  if (same) return { status: "skipped", message: null };
  params.characters = request;
  try {
    var resolved = tcPreflight(false);
    if (resolved.blockers.length > 0) return { status: "refused", message: "the plan reports " + resolved.blockers.join(", ") };
    return { status: "accepted", message: null };
  } catch (probeError) {
    return { status: "refused", message: String(mutationPublicMessage(probeError, tfMessage(probeError))).substring(0, 400) };
  }
}

var tfLeftovers = tfScratchDocuments();
if (tfLeftovers.length > 0) tfFail("PLAN_TEXT_FIT_SCRATCH_LEFT_OPEN", { documents: tfLeftovers });
var tfContext = requireDocumentForRead(params.expectedDocumentKey);
var tfDocument = app.activeDocument;
var tfFrame = tfFind(tfDocument, params.targetUuid);
var tfContents = "";
var tfCount = 0;
var tfBaseValues = null;
var tfBasePrint = null;
var tfBaseLayout = null;
var tfBaseKey = "";
var tfParagraphCount = 0;
try {
  var tfKind = tfFrame.kind;
  if (tfKind === TextType.POINTTEXT) tfReject("point_text");
  if (tfKind === TextType.PATHTEXT) tfReject("path_text");
  if (tfKind !== TextType.AREATEXT) tfReject("unreadable");
  var tfLock = tfLockState(tfFrame);
  if (tfLock !== "readable") tfReject(tfLock === "locked_or_hidden" ? "locked_or_hidden" : "unreadable");
  var tfStory = tfFrame.story;
  if (!tfStory || !tfStory.textFrames || tfStory.textFrames.length !== 1 || tfStory.textFrames[0] !== tfFrame) tfReject("threaded");
  if (String(tfFrame.orientation) !== "TextOrientation.HORIZONTAL") tfReject("vertical");
  tfContents = String(tfFrame.contents);
  if (tfContents.length === 0 || areaTextStripBreaks(tfContents).length === 0) tfReject("empty");
  if (tfContents.length > params.maxCharacters) tfReject("too_long");
  if (String(tfContents).indexOf(String.fromCharCode(3)) >= 0) tfReject("unsupported_characters");
  tfCount = tfFrame.characters.length;
  if (tfCount !== tfContents.length) tfReject("unsupported_characters");
  tfParagraphCount = tfFrame.paragraphs.length;
  tfBaseValues = tfSearchedValues(tfFrame, tfCount);
  if (tfBaseValues.tracking === "mixed" || tfBaseValues.horizontalScale === "mixed") tfReject("mixed_base_values");
  tfBasePrint = tfFingerprint(tfFrame);
  tfBaseLayout = composedAreaLayout(tfFrame, tfContents);
  if (tfBaseLayout === null) tfReject("unreadable");
  tfBaseKey = tfLayoutKey(tfBaseLayout);
} catch (tfReadError) {
  if (String(tfMessage(tfReadError)).indexOf("MCP_ERROR:") === 0) throw tfReadError;
  tfFail("PLAN_TEXT_FIT_TARGET_UNSUPPORTED", { reason: "unreadable", message: tfMessage(tfReadError) });
}
var tfActiveLayer = tfDocument.activeLayer;
var tfBefore = tfSnapshot(tfDocument, tfActiveLayer);
var tfDigestBefore = tfDigest(tfBasePrint);
var tfSavedBefore = tfDocument.saved === true;
var tfScratch = null;
// A closed host Document can throw even when compared with null. Keep only primitive facts in results.
var tfScratchOpened = false;
var tfCandidates = [];
var tfCopyMismatch = [];
var tfCollateral = [];
var tfChosen = null;
var tfStopped = "exhausted";
var tfMeasureError = null;
var tfCloseError = null;
var tfTimes = { open: null, search: null, close: null, probe: null };
var tfInteraction = app.userInteractionLevel;
var tfUnexpected = null;
var result;
try {
  MUTATION_SIDE_EFFECT_ATTEMPTED = true;
  var tfOpened = tfNow();
  app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
  try {
    try {
      tfScratch = app.documents.add(DocumentColorSpace.RGB, 1600, 1600);
      tfScratchOpened = true;
      tfScratch.layers[0].name = params.scratchLayer;
      tfTimes.open = tfNow() - tfOpened;
      var tfSearchStarted = tfNow();
      var tfCopy = tfFrame.duplicate(tfScratch.layers[0], ElementPlacement.PLACEATBEGINNING);
      if (tfCopy.kind !== TextType.AREATEXT) tfCopyMismatch.push("kind");
      var tfCopyPrint = tfFingerprint(tfCopy);
      tfCopyMismatch = tfCopyMismatch.concat(tfDiff(tfBasePrint, tfCopyPrint, null));
      if (String(tfCopy.contents) !== tfContents) tfCopyMismatch.push("contents");
      if (tfLayoutKey(composedAreaLayout(tfCopy, tfContents)) !== tfBaseKey) tfCopyMismatch.push("layout");
      if (tfCopyMismatch.length > 0) {
        tfStopped = "copy_mismatch";
      } else {
        for (var tfIndex = 0; tfIndex < params.candidates.length; tfIndex++) {
          if (tfNow() - TF_START > params.deadlineMs) { tfStopped = "deadline"; break; }
          var tfCandidate = params.candidates[tfIndex];
          var tfCandidateStarted = tfNow();
          var tfAttributes = tfCopy.textRange.characterAttributes;
          if (params.axes.tracking) tfAttributes.tracking = tfCandidate.tracking;
          if (params.axes.horizontalScale) tfAttributes.horizontalScale = tfCandidate.horizontalScale;
          var tfActual = tfSearchedValues(tfCopy, tfCount);
          if (String(tfCopy.contents) !== tfContents) throw new Error("the copy's contents changed while searching");
          var tfFit = areaTextFit(tfCopy, tfContents);
          var tfExact = true;
          if (params.axes.tracking && !(tfActual.tracking !== "mixed" && Math.abs(tfActual.tracking - tfCandidate.tracking) <= params.tolerance)) tfExact = false;
          if (params.axes.horizontalScale && !(tfActual.horizontalScale !== "mixed" && Math.abs(tfActual.horizontalScale - tfCandidate.horizontalScale) <= params.tolerance)) tfExact = false;
          tfCandidates.push({ tracking: params.axes.tracking ? tfCandidate.tracking : null,
            horizontalScale: params.axes.horizontalScale ? tfCandidate.horizontalScale : null,
            actualTracking: tfActual.tracking, actualHorizontalScale: tfActual.horizontalScale, fit: tfFit.status,
            lineCount: tfFit.lineCount, visible: tfFit.visibleCharacterCount, requested: tfFit.requestedCharacterCount,
            ms: tfNow() - tfCandidateStarted });
          if (tfFit.status === "fits" && tfExact && (params.maxLines === null || tfFit.lineCount <= params.maxLines)) {
            tfChosen = tfIndex;
            tfStopped = "chosen";
            break;
          }
        }
        var tfSearchedNames = [];
        if (params.axes.tracking) tfSearchedNames.push("tracking");
        if (params.axes.horizontalScale) tfSearchedNames.push("horizontalScale");
        tfCollateral = tfDiff(tfBasePrint, tfFingerprint(tfCopy), tfSearchedNames);
      }
      tfTimes.search = tfNow() - tfSearchStarted;
    } catch (tfError) {
      tfMeasureError = tfMessage(tfError);
    }
  } finally {
    if (tfScratch !== null) {
      var tfCloseStarted = tfNow();
      try { tfScratch.close(SaveOptions.DONOTSAVECHANGES); } catch (tfCloseFailure) { tfCloseError = tfMessage(tfCloseFailure); }
      tfTimes.close = tfNow() - tfCloseStarted;
    }
    app.userInteractionLevel = tfInteraction;
  }
  // After the marker nothing throws: the facts are the result. A scratch document that may still be open, a source that
  // cannot be read back, or any difference in the source keeps the command lock (indeterminate) with these facts recorded.
  var tfAfter = null;
  var tfAfterError = null;
  var tfDocumentsAfter = -1;
  var tfScratchLeft = -1;
  var tfSavedAfter = null;
  var tfDigestAfter = null;
  var tfAfterDiff = [];
  try {
    tfDocumentsAfter = app.documents.length;
    tfScratchLeft = tfScratchDocuments().length;
    tfAfter = tfSnapshot(tfDocument, tfActiveLayer);
    tfSavedAfter = tfDocument.saved === true;
    var tfAfterPrint = tfFingerprint(tfFrame);
    tfDigestAfter = tfDigest(tfAfterPrint);
    tfAfterDiff = tfDiff(tfBasePrint, tfAfterPrint, null);
    if (tfLayoutKey(composedAreaLayout(tfFrame, tfContents)) !== tfBaseKey) tfAfterDiff.push("layout");
  } catch (tfAfterFailure) { tfAfterError = tfMessage(tfAfterFailure); }
  if (tfAfterError !== null || tfDocumentsAfter !== tfBefore.documents || tfScratchLeft !== 0 || tfAfterDiff.length > 0 ||
      !tfSameSnapshot(tfBefore, tfAfter) || tfSavedAfter !== tfSavedBefore) {
    MUTATION_RUNNER_DISPOSITION = "indeterminate";
  }
  var tfProbe = { status: "skipped", message: null };
  if (MUTATION_RUNNER_DISPOSITION !== "indeterminate" && tfChosen !== null) {
    var tfProbeStarted = tfNow();
    tfProbe = tfWriteProbe(params.candidates[tfChosen], tfCount);
    tfTimes.probe = tfNow() - tfProbeStarted;
  }
  result = { document: tfContext, frame: { uuid: String(tfFrame.uuid), characters: tfCount, paragraphs: tfParagraphCount },
    axes: params.axes,
    base: { tracking: tfBaseValues.tracking, horizontalScale: tfBaseValues.horizontalScale, fit: tfBaseLayout.fit.status,
      lineCount: tfBaseLayout.lineCount, visible: tfBaseLayout.fit.visibleCharacterCount, requested: tfBaseLayout.fit.requestedCharacterCount },
    candidates: tfCandidates, chosenIndex: tfChosen, stopped: tfStopped, copyMismatch: tfCopyMismatch, collateral: tfCollateral,
    measureError: tfMeasureError, savedBefore: tfSavedBefore, savedAfter: tfSavedAfter, before: tfBefore, after: tfAfter,
    sourceDigestBefore: tfDigestBefore, sourceDigestAfter: tfDigestAfter, sourceDiff: tfAfterDiff, scratchOpened: tfScratchOpened,
    closeError: tfCloseError, afterError: tfAfterError, documentsAfter: tfDocumentsAfter, scratchLeft: tfScratchLeft,
    unexpectedError: null, writeProbe: tfProbe, times: tfTimes };
} catch (tfUnexpectedFailure) {
  // Anything else after the marker: the command stays indeterminate and the recorded result names what threw.
  tfUnexpected = tfMessage(tfUnexpectedFailure);
  MUTATION_RUNNER_DISPOSITION = "indeterminate";
  var tfCountNow = -1;
  try { tfCountNow = app.documents.length; } catch (tfCountFailure) { tfCountNow = -1; }
  result = { unexpectedError: tfUnexpected, closeError: tfCloseError, measureError: tfMeasureError, scratchOpened: tfScratchOpened,
    documentsAfter: tfCountNow, times: tfTimes };
}
`;
const hostNumber = z.number().finite();
const snapshotSchema = z.strictObject({
    key: z.string(), index: z.number().int(), saved: z.boolean(), documents: z.number().int(), active: z.boolean(),
    pageItems: z.number().int(), layers: z.number().int(), selection: z.number().int(), activeLayer: z.boolean(),
    views: z.number().int(), zoom: hostNumber, center: z.tuple([hostNumber, hostNumber]), screenMode: z.string(),
});
const msSchema = z.number().int().nonnegative();
const searchedValue = z.union([hostNumber, z.literal('mixed')]).nullable();
const fitStatusSchema = z.enum(['fits', 'overflows', 'indeterminate']);
const digestSchema = z.string().regex(/^[0-9a-f]{16}$/u);
const diffLabels = z.array(z.string().max(120)).max(8);
export const planTextFitHostDataSchema = z.strictObject({
    document: documentContextSchema,
    frame: z.strictObject({
        uuid: z.string().min(1).max(255),
        characters: z.number().int().min(1).max(PLAN_TEXT_FIT_LIMITS.characters),
        paragraphs: z.number().int().min(1).max(PLAN_TEXT_FIT_LIMITS.characters),
    }),
    axes: z.strictObject({ tracking: z.boolean(), horizontalScale: z.boolean() }),
    base: z.strictObject({
        tracking: hostNumber.nullable(),
        horizontalScale: hostNumber.nullable(),
        fit: fitStatusSchema,
        lineCount: z.number().int().min(0).max(AREA_TEXT_MAX_LINES),
        visible: z.number().int().min(-1),
        requested: z.number().int().nonnegative(),
    }),
    candidates: z.array(z.strictObject({
        tracking: hostNumber.nullable(),
        horizontalScale: hostNumber.nullable(),
        actualTracking: searchedValue,
        actualHorizontalScale: searchedValue,
        fit: fitStatusSchema,
        lineCount: z.number().int().min(-1).max(AREA_TEXT_MAX_LINES),
        visible: z.number().int().min(-1),
        requested: z.number().int().nonnegative(),
        ms: msSchema,
    })).max(PLAN_TEXT_FIT_LIMITS.candidates),
    chosenIndex: z.number().int().nonnegative().nullable(),
    stopped: z.enum(['chosen', 'exhausted', 'deadline', 'copy_mismatch']),
    copyMismatch: diffLabels,
    collateral: diffLabels,
    measureError: z.string().nullable(),
    savedBefore: z.boolean(),
    savedAfter: z.boolean(),
    before: snapshotSchema,
    after: snapshotSchema,
    sourceDigestBefore: digestSchema,
    sourceDigestAfter: digestSchema,
    sourceDiff: z.array(z.string()).max(0),
    scratchOpened: z.boolean(),
    closeError: z.string().nullable(),
    afterError: z.null(),
    documentsAfter: z.number().int().nonnegative(),
    scratchLeft: z.literal(0),
    unexpectedError: z.null(),
    writeProbe: z.strictObject({ status: z.enum(['accepted', 'refused', 'skipped']), message: z.string().max(400).nullable() }),
    times: z.strictObject({ open: msSchema.nullable(), search: msSchema.nullable(), close: msSchema.nullable(), probe: msSchema.nullable() }),
});
export const NEXT_CALL_UNAVAILABLE_REASONS = ['no_candidate_fits', 'already_current', 'value_not_representable', 'write_refused'];
const valuesShape = { tracking: z.number().optional(), horizontal_scale: z.number().optional() };
const actualValue = z.union([z.number(), z.literal('mixed')]);
export const planTextFitResultSchema = z.strictObject({
    document_key: z.string().min(1),
    frame_uuid: z.string().min(1),
    order: z.enum(PLAN_TEXT_FIT_ORDERS),
    base: z.strictObject({
        ...valuesShape, fit: fitStatusSchema, line_count: z.number().int().nonnegative(), visible_count: z.number().int(),
        requested_count: z.number().int().nonnegative(),
    }),
    planned_candidates: z.number().int().min(1).max(PLAN_TEXT_FIT_LIMITS.candidates),
    candidates: z.array(z.strictObject({
        ...valuesShape,
        fit: fitStatusSchema,
        line_count: z.number().int().min(-1),
        visible_count: z.number().int().min(-1),
        readback: z.enum(['exact', 'differs']),
        meets_constraint: z.boolean(),
        actual: z.strictObject({ tracking: actualValue.optional(), horizontal_scale: actualValue.optional() }).optional(),
    })).max(PLAN_TEXT_FIT_LIMITS.candidates),
    chosen: z.strictObject({ index: z.number().int().nonnegative(), ...valuesShape, line_count: z.number().int().nonnegative() }).nullable(),
    outcome: z.enum(['chosen', 'none_fit', 'incomplete_deadline']),
    source_unchanged: z.literal(true),
    scratch_closed: z.literal(true),
    next_call: z.strictObject({
        tool: z.literal('illustrator_set_text_composition'),
        arguments: z.strictObject({
            expected_document_key: z.string().min(1),
            target_uuid: z.string().min(1),
            characters: z.strictObject({ start: z.literal(0), end: z.number().int().positive(), tracking: z.number().int().optional(), horizontal_scale: z.number().optional() }),
            apply: z.literal(false),
        }),
    }).nullable(),
    next_call_unavailable: z.strictObject({ reason: z.enum(NEXT_CALL_UNAVAILABLE_REASONS), message: z.string().max(500) }).optional(),
    timing_ms: z.strictObject({
        scratch_open: msSchema.nullable(), search: msSchema.nullable(), scratch_close: msSchema.nullable(),
        candidate_avg: msSchema.nullable(), candidate_max: msSchema.nullable(), write_probe: msSchema.nullable(),
    }),
});
const REJECT_MESSAGES = {
    not_text: 'the item is not a TextFrame',
    point_text: 'point text is not supported (use illustrator_set_text_style on point text)',
    path_text: 'path text is not supported',
    vertical: 'vertical text is not supported',
    locked_or_hidden: 'the frame or an ancestor is locked or hidden',
    threaded: 'threaded text is not supported',
    empty: 'the frame is empty',
    too_long: `the frame holds more than ${PLAN_TEXT_FIT_LIMITS.characters} UTF-16 units`,
    unsupported_characters: 'the text holds an inline graphic, a surrogate pair or another character whose attributes cannot be read one per UTF-16 unit',
    mixed_base_values: 'the searched attribute is not the same on every character, so "the change from the original" has no single meaning',
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
export function planTextFitHostErrorMessage(detail) {
    if (detail?.code === 'PLAN_TEXT_FIT_TARGET_UNSUPPORTED') {
        const reason = detail.reason;
        const text = reason !== undefined && reason in REJECT_MESSAGES ? REJECT_MESSAGES[reason] : 'unsupported frame';
        return `${reason ?? 'unknown'}: ${text}. This tool searches one horizontal, unthreaded, unlocked area-text frame of at most ` +
            `${PLAN_TEXT_FIT_LIMITS.characters} UTF-16 units. Nothing was opened or changed.`;
    }
    if (detail?.code === 'PLAN_TEXT_FIT_UUID_LOOKUP_UNAVAILABLE')
        return 'Illustrator native UUID lookup is unavailable.';
    if (detail?.code === 'PLAN_TEXT_FIT_SCRATCH_LEFT_OPEN') {
        const parsed = leftoverSchema.safeParse(detail.documents);
        const documents = parsed.success ? parsed.data : [];
        const listed = documents.map((entry) => `key ${JSON.stringify(entry.key)} (name ${JSON.stringify(entry.name)}` +
            `${entry.active ? ', active' : ''})`).join('; ');
        if (documents.length === 1) {
            return `a scratch document of an earlier call is still open: ${listed}. It has no file and only the layer "${PLAN_TEXT_FIT_SCRATCH_LAYER}" ` +
                `(or the display-spacing scratch layer). Check it in Illustrator, then close it without saving with illustrator_close_document ` +
                '(expected_document_key = that key, discard_changes = true; bring it to the front first if it is not active) and read the source key ' +
                'again with illustrator_get_context. Nothing was closed or searched.';
        }
        return `${documents.length} scratch documents are open (${listed}). The outcome of the earlier calls is unknown; check every one in ` +
            'Illustrator by eye before closing anything. Nothing was closed or searched.';
    }
    return null;
}
function same(left, right) {
    return (left ?? null) === (right ?? null);
}
const roundFive = (value) => Math.round(value * 100_000) / 100_000;
function writableValues(entry) {
    if (entry.tracking !== null && !Number.isInteger(entry.tracking))
        return `tracking ${entry.tracking} is not an integer; Illustrator keeps only whole tracking values`;
    const scale = entry.horizontalScale;
    if (scale !== null && Math.round(scale * 10 ** HORIZONTAL_SCALE_DECIMALS) / 10 ** HORIZONTAL_SCALE_DECIMALS !== scale) {
        return `horizontal scale ${scale} has more than ${HORIZONTAL_SCALE_DECIMALS} decimals; Illustrator keeps it as a single-precision fraction`;
    }
    return null;
}
function refusalText(message) {
    if (message === null)
        return 'no reason given';
    try {
        const parsed = JSON.parse(message);
        if (typeof parsed.message === 'string')
            return parsed.message.slice(0, 300);
    }
    catch { }
    return message.slice(0, 300);
}
function nextCallFor(host, chosen, outcome) {
    const unavailable = (reason, message) => ({ next_call: null, next_call_unavailable: { reason, message } });
    if (chosen === null) {
        return unavailable('no_candidate_fits', outcome === 'incomplete_deadline'
            ? 'the host time budget ended the search before a candidate fit; narrow the grid and search again'
            : 'no candidate fits within the searched values; widen min or raise max_candidates, or enlarge the frame');
    }
    const current = (host.axes.tracking ? chosen.tracking === host.base.tracking : true) &&
        (host.axes.horizontalScale ? String(quantizeHorizontalScale(chosen.horizontalScale)) === String(roundFive(host.base.horizontalScale)) : true);
    if (current) {
        if (host.writeProbe.status !== 'skipped')
            throw new PlanTextFitFailedError('PLAN_TEXT_FIT_INCONSISTENT', 'The host probed the writer for the current values.');
        return unavailable('already_current', 'the chosen values are the current ones; there is nothing to write');
    }
    const notWritable = writableValues(chosen);
    if (notWritable !== null)
        return unavailable('value_not_representable', notWritable);
    if (host.writeProbe.status === 'skipped')
        throw new PlanTextFitFailedError('PLAN_TEXT_FIT_INCONSISTENT', 'The host did not probe the writer for a changed value.');
    if (host.writeProbe.status === 'refused') {
        return unavailable('write_refused', `illustrator_set_text_composition would refuse this frame: ${refusalText(host.writeProbe.message)}`);
    }
    return {
        next_call: {
            tool: 'illustrator_set_text_composition',
            arguments: {
                expected_document_key: host.document.key,
                target_uuid: host.frame.uuid,
                characters: { start: 0, end: host.frame.characters,
                    ...(chosen.tracking === null ? {} : { tracking: chosen.tracking }),
                    ...(chosen.horizontalScale === null ? {} : { horizontal_scale: chosen.horizontalScale }) },
                apply: false,
            },
        },
    };
}
export function judgePlanTextFit(host, plan) {
    if (host.savedBefore !== host.savedAfter || host.savedBefore !== host.document.saved) {
        throw new PlanTextFitFailedError('PLAN_TEXT_FIT_CHANGED_STATE', 'The saved state of the document changed during the search.');
    }
    const changes = describeSnapshotChanges(host.before, host.after);
    if (host.sourceDigestBefore !== host.sourceDigestAfter)
        changes.push('the source frame fingerprint');
    if (host.documentsAfter !== host.before.documents)
        changes.push(`documents ${host.before.documents} -> ${host.documentsAfter}`);
    if (changes.length > 0) {
        throw new PlanTextFitFailedError('PLAN_TEXT_FIT_CHANGED_STATE', `The source document, its frame or its view changed (${changes.join('; ')}). ` +
            'No result is returned; read the document context again before any further operation.');
    }
    if (!host.scratchOpened) {
        throw new PlanTextFitFailedError('PLAN_TEXT_FIT_MEASURE_FAILED', `Illustrator did not open the scratch document${host.measureError === null ? '' : `: ${host.measureError}`}. Nothing was searched.`);
    }
    if (host.closeError !== null) {
        throw new PlanTextFitFailedError('PLAN_TEXT_FIT_CLOSE_REPORTED_ERROR', `Closing the scratch document reported an error (${host.closeError}); it is gone and the ` +
            'source reads back unchanged, but a search whose cleanup did not go cleanly returns no result.');
    }
    if (host.measureError !== null) {
        throw new PlanTextFitFailedError('PLAN_TEXT_FIT_MEASURE_FAILED', `Illustrator failed while searching the scratch copy: ${host.measureError}. ` +
            'The scratch document was closed and the source is unchanged.');
    }
    if (host.copyMismatch.length > 0 || host.stopped === 'copy_mismatch') {
        throw new PlanTextFitFailedError('PLAN_TEXT_FIT_COPY_MISMATCH', `The copy in the scratch document is not the same as the source frame (${host.copyMismatch.join(', ')}), ` +
            'so a fit found on it would not apply to the source. Nothing was searched; the scratch document was closed and the source is unchanged.');
    }
    if (host.collateral.length > 0) {
        throw new PlanTextFitFailedError('PLAN_TEXT_FIT_COLLATERAL_CHANGE', `Writing a candidate changed more than the searched attributes (${host.collateral.join(', ')}). ` +
            'No result is returned; the scratch document was closed and the source is unchanged.');
    }
    if (host.axes.tracking !== plan.candidates.some((entry) => entry.tracking !== undefined) ||
        host.axes.horizontalScale !== plan.candidates.some((entry) => entry.horizontalScale !== undefined)) {
        throw new PlanTextFitFailedError('PLAN_TEXT_FIT_INCONSISTENT', 'The searched axes in the host data are not the requested ones.');
    }
    if (host.candidates.length > plan.candidates.length) {
        throw new PlanTextFitFailedError('PLAN_TEXT_FIT_INCONSISTENT', 'The host evaluated more candidates than were planned.');
    }
    const evaluated = host.candidates.map((entry, index) => {
        const planned = plan.candidates[index];
        if (!same(entry.tracking, planned.tracking) || !same(entry.horizontalScale, planned.horizontalScale)) {
            throw new PlanTextFitFailedError('PLAN_TEXT_FIT_INCONSISTENT', `Candidate ${index} is not the planned one.`);
        }
        const exact = (!host.axes.tracking || (typeof entry.actualTracking === 'number' && Math.abs(entry.actualTracking - planned.tracking) <= READBACK_TOLERANCE)) &&
            (!host.axes.horizontalScale || (typeof entry.actualHorizontalScale === 'number' && Math.abs(entry.actualHorizontalScale - planned.horizontalScale) <= READBACK_TOLERANCE));
        return { fit: entry.fit, lineCount: entry.lineCount, exact };
    });
    const chosenIndex = chooseFit(evaluated, plan.maxLines);
    if (!same(chosenIndex, host.chosenIndex)) {
        throw new PlanTextFitFailedError('PLAN_TEXT_FIT_INCONSISTENT', 'The host and Node disagree on the first candidate that fits.');
    }
    const expectedStop = chosenIndex !== null ? 'chosen' : host.candidates.length === plan.candidates.length ? 'exhausted' : 'deadline';
    if (host.stopped !== expectedStop || (chosenIndex !== null && chosenIndex !== host.candidates.length - 1)) {
        throw new PlanTextFitFailedError('PLAN_TEXT_FIT_INCONSISTENT', 'The search ended for a reason that does not match its candidates.');
    }
    const publicValues = (entry) => ({
        ...(entry.tracking === null ? {} : { tracking: entry.tracking }),
        ...(entry.horizontalScale === null ? {} : { horizontal_scale: entry.horizontalScale }),
    });
    const candidates = host.candidates.map((entry, index) => {
        const detail = evaluated[index];
        return {
            ...publicValues(entry), fit: entry.fit, line_count: entry.lineCount, visible_count: entry.visible,
            readback: detail.exact ? 'exact' : 'differs',
            meets_constraint: chosenIndex === index || (detail.fit === 'fits' && detail.exact && (plan.maxLines === null || detail.lineCount <= plan.maxLines)),
            ...(detail.exact ? {} : { actual: {
                    ...(host.axes.tracking && entry.actualTracking !== null ? { tracking: entry.actualTracking } : {}),
                    ...(host.axes.horizontalScale && entry.actualHorizontalScale !== null ? { horizontal_scale: entry.actualHorizontalScale } : {}),
                } }),
        };
    });
    const chosenEntry = chosenIndex === null ? null : host.candidates[chosenIndex];
    const times = host.candidates.map((entry) => entry.ms);
    const outcome = chosenIndex !== null ? 'chosen' : expectedStop === 'deadline' ? 'incomplete_deadline' : 'none_fit';
    const writable = nextCallFor(host, chosenEntry, outcome);
    return planTextFitResultSchema.parse({
        document_key: host.document.key,
        frame_uuid: host.frame.uuid,
        order: plan.order,
        base: { ...publicValues({ tracking: host.base.tracking, horizontalScale: host.base.horizontalScale }), fit: host.base.fit,
            line_count: host.base.lineCount, visible_count: host.base.visible, requested_count: host.base.requested },
        planned_candidates: plan.candidates.length,
        candidates,
        chosen: chosenEntry === null || chosenIndex === null ? null : { index: chosenIndex, ...publicValues(chosenEntry), line_count: chosenEntry.lineCount },
        outcome,
        source_unchanged: true,
        scratch_closed: true,
        ...writable,
        timing_ms: {
            scratch_open: host.times.open, search: host.times.search, scratch_close: host.times.close, write_probe: host.times.probe,
            candidate_avg: times.length === 0 ? null : Math.round(times.reduce((sum, value) => sum + value, 0) / times.length),
            candidate_max: times.length === 0 ? null : Math.max(...times),
        },
    });
}
function describeProfile(observation) {
    return `profile ${observation.profile}, lock ${observation.lockState}, frontmost ${observation.frontmostBundleId ?? 'unknown'}, expected ${observation.expectedBundleId}`;
}
export async function planTextFit(deps, input) {
    const candidates = fitCandidates(input.tracking, input.horizontalScale, input.order, input.maxCandidates);
    const observation = deps.hostProfileProbe.observeForEditSession
        ? await deps.hostProfileProbe.observeForEditSession()
        : await deps.hostProfileProbe.observe();
    if (observation.profile !== 'foreground') {
        throw new PlanTextFitRejectedError('PLAN_TEXT_FIT_UNSUPPORTED_HOST_PROFILE', 'The search opens a scratch document and is supported only with the ' +
            `screen unlocked and Illustrator frontmost (${describeProfile(observation)}); nothing was opened.`);
    }
    let host;
    try {
        const data = (await deps.bridge.execute({
            kind: 'read',
            script: PLAN_TEXT_FIT_SCRIPT,
            params: {
                expectedDocumentKey: input.expectedDocumentKey,
                targetUuid: input.targetUuid,
                scratchLayer: PLAN_TEXT_FIT_SCRATCH_LAYER,
                scratchLayers: [PLAN_TEXT_FIT_SCRATCH_LAYER, DISPLAY_SPACING_SCRATCH_LAYER_NAME],
                maxCharacters: PLAN_TEXT_FIT_LIMITS.characters,
                axes: { tracking: input.tracking !== null, horizontalScale: input.horizontalScale !== null },
                candidates,
                maxLines: input.maxLines,
                deadlineMs: PLAN_TEXT_FIT_CANDIDATE_DEADLINE_MS,
                tolerance: READBACK_TOLERANCE,
                characterNames: CHARACTER_NAMES,
                paragraphNames: PARAGRAPH_NAMES,
                frameNames: FRAME_NAMES,
            },
            timeoutMs: PLAN_TEXT_FIT_HOST_TIMEOUT_MS,
        })).data;
        host = planTextFitHostDataSchema.parse(data);
    }
    catch (error) {
        if (error instanceof IndeterminateExecutionError) {
            throw new IndeterminateExecutionError(`${error.message} The outcome is unknown: a scratch document may still be open, or the source may have changed. Run illustrator_reconcile ` +
                'before the next command; the next illustrator_plan_text_fit call reports a scratch document left open.', error.commandId, { code: error.code, exitCode: error.exitCode, signal: error.signal, killed: error.killed });
        }
        const detail = parseHostError(error);
        if (detail?.code === 'DOCUMENT_MISMATCH')
            throw new DocumentMismatchError(detail.expected ?? input.expectedDocumentKey, detail.actual ?? '');
        if (detail?.code === 'OBJECT_NOT_FOUND')
            throw new ObjectNotFoundError(detail.uuid ?? input.targetUuid);
        const message = planTextFitHostErrorMessage(detail);
        if (message !== null)
            throw new PlanTextFitRejectedError(detail.code, message);
        throw error;
    }
    return judgePlanTextFit(host, { order: input.order, candidates, maxLines: input.maxLines });
}
