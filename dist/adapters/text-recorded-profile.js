import { z } from 'zod';
import { canonicalSha256 } from '../mutation-canonical.js';
import { PLAIN_POINT_TEXT_V1 } from './point-text-host-script.js';
export const RECORDED_PROFILE_NAME = 'recorded_point_text_v3';
export const RECORDED_ADMITTED_STYLE_FIELDS = ['size', 'tracking', 'horizontalScale', 'verticalScale', 'fillColor', 'fontPostScriptName', 'tsume'];
export function assertTsumeRepresentable(tsume) {
    if (tsume !== undefined && !sizeRepresentable(tsume)) {
        throw new Error(`style_tsume_not_representable: tsume ${tsume} has more than five decimals, the precision this tool verifies; `
            + `request ${Math.round(tsume * 100_000) / 100_000} or a value with fewer decimals.`);
    }
}
export const RECORDED_PINNED_FRAME_NAMES = ['orientation', 'wrapped'];
export const RECORDED_FINGERPRINT_CHARACTER_NAMES = ['autoLeading'];
export const RECORDED_CHARACTER_NAMES = Object.freeze(Object.keys(PLAIN_POINT_TEXT_V1.character)
    .filter((name) => !RECORDED_FINGERPRINT_CHARACTER_NAMES.includes(name)));
export const RECORDED_PARAGRAPH_NAMES = Object.freeze(Object.keys(PLAIN_POINT_TEXT_V1.paragraph));
export const RECORDED_FRAME_NAMES = Object.freeze(Object.keys(PLAIN_POINT_TEXT_V1.frame)
    .filter((name) => !RECORDED_PINNED_FRAME_NAMES.includes(name)));
export const RECORDED_EXTRA_CHARACTER_LABELS = ['strokeColor', 'kerning'];
export const RECORDED_EXTRA_PARAGRAPH_LABELS = ['justification', 'tabStops', 'listStyle'];
export const RECORDED_EXTRA_FRAME_LABELS = ['tags'];
export const MEASURED_RECORDED = Object.freeze({
    LEADTYPE: ['LT1'], LANG: ['LG1'], KINSOKU: ['K1', 'K2', 'K3'], KERN: ['KM1', 'PM1'], JPSPACE: ['TS1'], PARASPACE: ['PA1'],
    COMPOSE: ['CP1'], GLYPH: ['OT1'], DECOR: ['DEC1'], OVERPRINT: ['OV1'], APPEAR: ['FR1'], LEADING: ['A1', 'A2', 'M1'], COMBINED: ['X1', 'X1P'],
    GROUP: ['G1'], WRITES: ['W1'],
});
export const UNMEASURED_RECORDED = Object.freeze({
    character: ['alignment', 'rotation', 'strokeWeight', 'baselineDirection', 'baselinePosition', 'kana', 'tateChuYokoHorizontal', 'tateChuYokoVertical',
        'wariChuCharactersAfterBreak', 'wariChuCharactersBeforeBreak', 'wariChuEnabled', 'wariChuJustification', 'wariChuLineGap', 'wariChuLines', 'wariChuScale',
        'digitSet', 'dirOverride', 'kashidas', 'connectionForms', 'justificationAlternates', 'diacVPos', 'diacXOffset', 'diacYOffset'],
    paragraph: ['paragraphDirection', 'kashidaWidth', 'listStyleTier'],
    frame: ['columnCount', 'columnGutter', 'rowCount', 'rowGutter', 'spacing', 'flowLinksHorizontally', 'contentVariable', 'visibilityVariable'],
});
export const RECORDED_JUSTIFICATIONS = ['Justification.LEFT', 'Justification.CENTER', 'Justification.RIGHT', 'Justification.FULLJUSTIFY',
    'Justification.FULLJUSTIFYLASTLINELEFT', 'Justification.FULLJUSTIFYLASTLINECENTER', 'Justification.FULLJUSTIFYLASTLINERIGHT'];
export const attributeRecordSchema = z.strictObject({
    fingerprint: z.string().regex(/^\d{1,10}:\d{1,10}:\d{1,9}$/u),
    characterRuns: z.number().int().min(1).max(1_000),
    recordedCount: z.number().int().min(1).max(100_000),
});
export function recordedFingerprint(text) {
    let fnv = 0x811c9dc5;
    let djb = 5381;
    for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        fnv ^= code;
        fnv = (fnv + (fnv << 1) + (fnv << 4) + (fnv << 7) + (fnv << 8) + (fnv << 24)) >>> 0;
        djb = ((djb * 33) ^ code) >>> 0;
    }
    return `${fnv}:${djb}:${text.length}`;
}
export function recordedFingerprintText(characterRows, paragraphRow, frameRow) {
    const runs = [];
    let last = null;
    let count = 0;
    for (const row of characterRows) {
        const key = row.join('\u0001');
        if (last !== null && key === last) {
            count += 1;
            continue;
        }
        if (last !== null)
            runs.push(`${count}\u0002${last}`);
        last = key;
        count = 1;
    }
    if (last !== null)
        runs.push(`${count}\u0002${last}`);
    return `${runs.join('\u0003')}\u0004${paragraphRow.join('\u0001')}\u0004${frameRow.join('\u0001')}`;
}
export const RECORDED_BOUNDS_TOLERANCE_PT = 0.001;
export const recordedStrokeSchema = z.union([z.strictObject({ model: z.literal('none') }), z.strictObject({ model: z.literal('recorded') })]);
export function sizeRepresentable(size) {
    const rounded = Math.round(size * 100_000) / 100_000;
    return rounded === size;
}
export function assertSizeRepresentable(size) {
    if (size !== undefined && !sizeRepresentable(size)) {
        throw new Error(`style_size_not_representable: size ${size} has more than five decimals, the precision Illustrator stores and this tool verifies; `
            + `request ${Math.round(size * 100_000) / 100_000} or a value with fewer decimals.`);
    }
}
export function sameRecordedSnapshots(left, right) {
    const a = left, b = right;
    const strip = (value) => ({ ...value, layoutBounds: null });
    if (canonicalSha256(strip(a)) !== canonicalSha256(strip(b)))
        return false;
    if (a.layoutBounds == null || b.layoutBounds == null)
        return true;
    return a.layoutBounds.length === 4 && b.layoutBounds.length === 4
        && a.layoutBounds.every((value, index) => Math.abs(value - b.layoutBounds[index]) <= RECORDED_BOUNDS_TOLERANCE_PT);
}
export function isRecordedSnapshot(snapshot) {
    return snapshot.profile === RECORDED_PROFILE_NAME;
}
const hostNames = (names) => JSON.stringify(names);
export const TEXT_RECORDED_MODULE_SCRIPT = String.raw `var STYLE_V3_PROFILE = ${JSON.stringify(RECORDED_PROFILE_NAME)};
var STYLE_V3_FIELDS = ${hostNames(RECORDED_ADMITTED_STYLE_FIELDS)};
var STYLE_V3_CHAR_NAMES = ${hostNames(RECORDED_CHARACTER_NAMES)};
var STYLE_V3_PARA_NAMES = ${hostNames(RECORDED_PARAGRAPH_NAMES)};
var STYLE_V3_FRAME_NAMES = ${hostNames(RECORDED_FRAME_NAMES)};
var STYLE_V3_CHAR_LABELS = STYLE_V3_CHAR_NAMES.concat(${hostNames(RECORDED_EXTRA_CHARACTER_LABELS)});
var STYLE_V3_PARA_LABELS = STYLE_V3_PARA_NAMES.concat(${hostNames(RECORDED_EXTRA_PARAGRAPH_LABELS)});
var STYLE_V3_FRAME_LABELS = STYLE_V3_FRAME_NAMES.concat(${hostNames(RECORDED_EXTRA_FRAME_LABELS)});
var STYLE_V3_BOUNDS_TOLERANCE = ${RECORDED_BOUNDS_TOLERANCE_PT};
/** One host call: the first full read of each target (before), the latest one, what a light read reuses, and whether we are revalidating. */
var STYLE_V3_STATE = { revalidating: false, before: {}, latest: {}, cache: {}, lastUuid: null, fullReads: 0, lightReads: 0 };

function styleV3Refuse(code, message) {
  throw mutationError("preflight_failed", code + ": " + message + " Nothing was written. MCP cannot change this itself and does not work around it with GUI automation or an ad-hoc script.");
}

/** (#671) A tsume request records the Tsume of every character as an explicit field (so the request can predict and verify it); the table then carries a constant in its place. */
function styleV3TsumeRequested() {
  return !!params.style && params.style.tsume !== undefined;
}

function styleV3Admitted(key) {
  for (var index = 0; index < STYLE_V3_FIELDS.length; index++) if (STYLE_V3_FIELDS[index] === key) return true;
  return false;
}

/** The request is a recorded-profile request: only admitted style fields, no paragraph style, one line. */
function styleV3Selected(target) {
  var key, count = 0;
  if (params.paragraphStyle !== undefined || !params.style) return false;
  for (key in params.style) {
    if (!params.style.hasOwnProperty(key) || params.style[key] === undefined) continue;
    count++;
    if (!styleV3Admitted(key)) return false;
  }
  if (count === 0) return false;
  var text;
  try { text = target.contents; } catch (contentsError) { return false; }
  return typeof text === "string" && String(text).indexOf("\r") < 0;
}

/** A canonical value; a read that throws is a state of its own ("err:<number>"), comparable before and after. Numbers are canonical at five decimals. */
function styleV3Value(host, name) {
  try {
    var value = host[name];
    if (typeof value === "number") return isFinite(value) ? String(pointTextCanonicalChannel(value, name)) : "nonfinite";
    return pointTextCanonicalValue(value);
  } catch (readError) {
    return "err:" + (readError && typeof readError.number === "number" ? readError.number : "x");
  }
}

function styleV3Hash32(text) {
  var h = 0x811c9dc5, i;
  for (i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0; }
  return h;
}
function styleV3Hash2(text) {
  var h = 5381, i;
  for (i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h;
}
function styleV3FingerprintOf(text) { return styleV3Hash32(text) + ":" + styleV3Hash2(text) + ":" + text.length; }

/** The canonical text: maximal runs of identical character rows, then the paragraph row and the frame row (twin of recordedFingerprintText). */
function styleV3FingerprintText(rows, paraRow, frameRow) {
  var runs = [], last = null, count = 0, index, key;
  for (index = 0; index < rows.length; index++) {
    key = rows[index].join("\u0001");
    if (last !== null && key === last) { count++; continue; }
    if (last !== null) runs.push(count + "\u0002" + last);
    last = key; count = 1;
  }
  if (last !== null) runs.push(count + "\u0002" + last);
  return runs.join("\u0003") + "\u0004" + paraRow.join("\u0001") + "\u0004" + frameRow.join("\u0001");
}

function styleV3ReadStroke(color) {
  var type;
  try { type = String(color.typename); } catch (strokeError) { throw mutationError("preflight_failed", "style_profile_attribute_unreadable: a character's stroke color cannot be read, so it cannot be compared before and after."); }
  if (type === "NoColor") return { entry: { model: "none" }, text: "none" };
  if (type === "RGBColor" || type === "CMYKColor" || type === "GrayColor") {
    return { entry: { model: "recorded" }, text: pointTextCanonicalJson(pointTextReadFillColor(color)) };
  }
  throw mutationError("preflight_failed", "style_profile_attribute_unreadable: a character's stroke is a " + type + ", which cannot be compared before and after (RGB, CMYK, Gray or none only).");
}

/** One character: its explicit fields and, for a full read, its row of recorded values. The Character must be held (error 9503 otherwise). */
function styleV3Character(character, full) {
  var attributes;
  try { attributes = character.characterAttributes; }
  catch (attributesError) { throw mutationError("preflight_failed", "A character's attributes are unavailable."); }
  var font = attributes.textFont;
  if (!font || typeof font.name !== "string" || !font.name) throw mutationError("preflight_failed", "A character's font identity is unavailable.");
  var located = null;
  try { located = app.textFonts.getByName(font.name); } catch (fontError) { located = null; }
  if (located === null || located === undefined || located !== font) throw mutationError("preflight_failed", "A character's font is not installed.");
  var fillColor = pointTextReadFillColor(attributes.fillColor);
  var stroke = styleV3ReadStroke(attributes.strokeColor);
  var autoLeading = attributes.autoLeading;
  if (typeof autoLeading !== "boolean") throw mutationError("preflight_failed", "A character's auto leading state is unavailable.");
  var entry = {
    contents: String(character.contents),
    font: { postScriptName: font.name, family: font.family, style: font.style },
    size: pointTextCanonicalChannel(pointTextNumber(attributes.size, "characterAttributes.size"), "size"),
    tracking: pointTextCanonicalChannel(pointTextNumber(attributes.tracking, "characterAttributes.tracking"), "tracking"),
    horizontalScale: pointTextCanonicalChannel(pointTextNumber(attributes.horizontalScale, "characterAttributes.horizontalScale"), "horizontalScale"),
    verticalScale: pointTextCanonicalChannel(pointTextNumber(attributes.verticalScale, "characterAttributes.verticalScale"), "verticalScale"),
    leading: pointTextCanonicalChannel(pointTextNumber(attributes.leading, "characterAttributes.leading"), "leading"),
    fillColor: fillColor,
    strokeColor: stroke.entry,
    autoLeading: autoLeading
  };
  var tsumeRequested = styleV3TsumeRequested();
  if (tsumeRequested) entry.tsume = pointTextCanonicalChannel(pointTextNumber(attributes.Tsume, "characterAttributes.Tsume"), "Tsume");
  var manual = false, kerning;
  if (!full) return { entry: entry, row: null, manual: false };
  var row = [], index;
  for (index = 0; index < STYLE_V3_CHAR_NAMES.length; index++) {
    row.push(tsumeRequested && STYLE_V3_CHAR_NAMES[index] === "Tsume" ? "explicit" : styleV3Value(attributes, STYLE_V3_CHAR_NAMES[index]));
  }
  row.push(stroke.text);
  try {
    kerning = character.kerning;
    if (typeof kerning === "number" && isFinite(kerning)) { row.push("k:" + String(pointTextCanonicalChannel(kerning, "kerning"))); manual = true; }
    else row.push("kerning:" + String(kerning));
  } catch (kerningError) {
    row.push(kerningError && Number(kerningError.number) === 9551 ? "none" : "err:" + (kerningError && typeof kerningError.number === "number" ? kerningError.number : "x"));
  }
  return { entry: entry, row: row, manual: manual };
}

function styleV3Paragraph(range) {
  var attributes;
  try { attributes = range.paragraphAttributes; }
  catch (paragraphError) { throw mutationError("preflight_failed", "Target paragraph attributes are unavailable."); }
  var row = [], index, justification = styleV3Value(attributes, "justification");
  for (index = 0; index < STYLE_V3_PARA_NAMES.length; index++) row.push(styleV3Value(attributes, STYLE_V3_PARA_NAMES[index]));
  row.push(justification);
  var stops = "err:x", count = 0, detail, tabs, k;
  try {
    tabs = attributes.tabStops; count = tabs.length; detail = [String(count)];
    for (k = 0; k < count; k++) detail.push(styleV3Value(tabs[k], "position") + "/" + styleV3Value(tabs[k], "alignment") + "/" + styleV3Value(tabs[k], "leader") + "/" + styleV3Value(tabs[k], "decimalCharacter"));
    stops = detail.join(";");
  } catch (stopsError) { stops = "err:" + (stopsError && typeof stopsError.number === "number" ? stopsError.number : "x"); count = 0; }
  row.push(stops);
  var listText;
  try { listText = "name:" + String(attributes.listStyle.name); }
  catch (listError) { listText = listError && Number(listError.number) === ${PLAIN_POINT_TEXT_V1.listStyleUnboundErrorNumber} ? "unbound" : "err:" + (listError && typeof listError.number === "number" ? listError.number : "x"); }
  row.push(listText);
  var name = String(justification);
  if (name.indexOf("o:Justification.") !== 0) throw mutationError("preflight_failed", "style_profile_attribute_unreadable: the paragraph justification cannot be read (" + name + ").");
  return { row: row, tabStopCount: count, justification: name.substring(2) };
}

function styleV3Frame(target) {
  var row = [], index, orientation = styleV3Value(target, "orientation"), wrapped = styleV3Value(target, "wrapped");
  if (orientation !== "o:TextOrientation.HORIZONTAL") {
    styleV3Refuse("style_profile_structure_unsupported", "the frame orientation reads " + orientation + "; only horizontal point text is measured for a style edit.");
  }
  if (wrapped !== "false") styleV3Refuse("style_profile_structure_unsupported", "the frame reads wrapped = " + wrapped + "; text that wraps around objects is not point text in the measured profile.");
  for (index = 0; index < STYLE_V3_FRAME_NAMES.length; index++) row.push(styleV3Value(target, STYLE_V3_FRAME_NAMES[index]));
  var tagCount;
  try { tagCount = target.tags.length; } catch (tagError) { throw mutationError("preflight_failed", "Target frame tag state is unavailable."); }
  if (typeof tagCount !== "number") throw mutationError("preflight_failed", "Target frame tag state is unavailable.");
  row.push(String(tagCount));
  return { row: row, tagCount: tagCount };
}

function styleV3FrameState(target, tagCount) {
  var matrix, anchor;
  try { matrix = target.matrix; anchor = target.anchor; }
  catch (matrixError) { throw mutationError("preflight_failed", "Target frame matrix or anchor is unavailable."); }
  if (!anchor || typeof anchor.length !== "number" || anchor.length !== 2 || typeof target.pixelAligned !== "boolean") throw mutationError("preflight_failed", "Target frame state is unavailable.");
  return {
    anchor: [pointTextNumber(anchor[0], "frame.anchor[0]"), pointTextNumber(anchor[1], "frame.anchor[1]")],
    matrix: { a: pointTextNumber(matrix.mValueA, "frame.matrix.a"), b: pointTextNumber(matrix.mValueB, "frame.matrix.b"),
      c: pointTextNumber(matrix.mValueC, "frame.matrix.c"), d: pointTextNumber(matrix.mValueD, "frame.matrix.d"),
      tx: pointTextNumber(matrix.mValueTX, "frame.matrix.tx"), ty: pointTextNumber(matrix.mValueTY, "frame.matrix.ty") },
    antialias: String(target.antialias),
    pixelAligned: target.pixelAligned,
    tagCount: tagCount
  };
}

function styleV3Bounds(target) {
  var bounds, out = [], index;
  try { bounds = target.geometricBounds; } catch (boundsError) { throw mutationError("preflight_failed", "Target frame bounds are unavailable."); }
  if (!bounds || typeof bounds.length !== "number" || bounds.length !== 4) throw mutationError("preflight_failed", "Target frame bounds are unavailable.");
  for (index = 0; index < 4; index++) out.push(pointTextCanonicalChannel(pointTextNumber(bounds[index], "frame.geometricBounds"), "geometricBounds"));
  return out;
}

/**
 * The snapshot of a single-line, unthreaded, horizontal point-text frame in a layer or in plain or clipped groups. A full read records every
 * attribute table once (first read of a target in a host call = before) and keeps the latest for the in-call comparison; during revalidation
 * only the explicit fields are re-read and the recorded part is reused (a change in it shows up as a mismatch at verification).
 */
function styleV3Snapshot(document, target, expectedUuid) {
  if (!target || target.typename !== "TextFrame") throw mutationError("preflight_failed", "Point-text operations support TextFrame targets only.");
  if (target.kind !== TextType.POINTTEXT) throw mutationError("preflight_failed", "Point-text operations support TextType.POINTTEXT only.");
  if (typeof target.uuid !== "string" || target.uuid !== expectedUuid) throw mutationError("preflight_failed", "Target native UUID is unavailable or changed.");
  var groups = pointTextGroupAncestry(target);
  var frameShape = pointTextFrameShape(target);
  if (!target.story || !target.story.textFrames || target.story.textFrames.length !== 1 || target.story.textFrames[0] !== target) {
    throw mutationError("preflight_failed", "Point-text operations support unthreaded text only.");
  }
  if (typeof target.locked !== "boolean" || typeof target.hidden !== "boolean" || typeof target.editable !== "boolean" ||
      typeof target.layer.visible !== "boolean" || typeof target.layer.locked !== "boolean") {
    throw mutationError("preflight_failed", "Target safety state is unavailable.");
  }
  var layerPath = pointTextLayerPath(document, target.layer);
  if (layerPath === null) throw mutationError("preflight_failed", "Target layer path is unavailable.");
  var textRange = target.textRange;
  if (!textRange || typeof textRange.length !== "number" || textRange.length < 1) throw mutationError("preflight_failed", "Target native text-run state is unavailable.");
  var text = pointTextValidateContents(target.contents, "Target contents");
  var characters = target.characters;
  if (!characters || typeof characters.length !== "number" || characters.length !== text.length || characters.length < 1 || characters.length > POINT_TEXT_MAX_CODE_UNITS) {
    throw mutationError("preflight_failed", "Target characters are unavailable or do not match the contents.");
  }
  var cached = STYLE_V3_STATE.cache[expectedUuid];
  var light = STYLE_V3_STATE.revalidating && cached !== undefined;
  if (light) STYLE_V3_STATE.lightReads++; else STYLE_V3_STATE.fullReads++;
  var entries = [], rows = [], manual = false, index, read;
  for (index = 0; index < characters.length; index++) {
    read = styleV3Character(characters[index], !light);
    if (read.entry.contents.length !== 1 || read.entry.contents.charCodeAt(0) !== text.charCodeAt(index)) {
      throw mutationError("preflight_failed", "A character does not match the contents unit at its index.");
    }
    read.entry.contents = text.charAt(index);
    entries.push(read.entry);
    if (!light) rows.push(read.row);
    if (read.manual) manual = true;
  }
  var paragraph, frame, record, manualKerning, tabStopCount, justification, tagCount;
  if (light) {
    record = cached.record; manualKerning = cached.manualKerning; tabStopCount = cached.tabStopCount; justification = cached.justification; tagCount = cached.tagCount;
  } else {
    paragraph = styleV3Paragraph(textRange);
    frame = styleV3Frame(target);
    record = { fingerprint: styleV3FingerprintOf(styleV3FingerprintText(rows, paragraph.row, frame.row)), characterRuns: 1, recordedCount: 0 };
    var runKey = null, runCount = 0;
    for (index = 0; index < rows.length; index++) {
      var key = rows[index].join("\u0001");
      if (key !== runKey) { runCount++; runKey = key; }
    }
    record.characterRuns = runCount;
    record.recordedCount = rows.length * STYLE_V3_CHAR_LABELS.length + STYLE_V3_PARA_LABELS.length + STYLE_V3_FRAME_LABELS.length;
    manualKerning = manual ? "present" : "none"; tabStopCount = paragraph.tabStopCount; justification = paragraph.justification; tagCount = frame.tagCount;
    var tables = { rows: rows, para: paragraph.row, frame: frame.row };
    STYLE_V3_STATE.latest[expectedUuid] = tables;
    if (STYLE_V3_STATE.before[expectedUuid] === undefined) STYLE_V3_STATE.before[expectedUuid] = tables;
    STYLE_V3_STATE.cache[expectedUuid] = { record: record, manualKerning: manualKerning, tabStopCount: tabStopCount, justification: justification, tagCount: tagCount };
    STYLE_V3_STATE.lastUuid = expectedUuid;
  }
  var snapshot = {
    uuid: target.uuid,
    type: target.typename,
    kind: "TextType.POINTTEXT",
    profile: STYLE_V3_PROFILE,
    frameShape: frameShape,
    storyFrameCount: 1,
    manualKerning: manualKerning,
    tabStopCount: tabStopCount,
    justification: justification,
    characters: entries,
    frame: styleV3FrameState(target, tagCount),
    layerPath: layerPath,
    layerAncestry: pointTextAncestryWithGroups(target, groups),
    contents: text,
    locked: target.locked,
    hidden: target.hidden,
    editable: target.editable,
    layerVisible: target.layer.visible,
    layerLocked: target.layer.locked,
    attributeRecord: record,
    layoutBounds: styleV3Bounds(target)
  };
  return pointTextWithGroups(snapshot, groups);
}

/** The first attributes that differ between the before tables and the latest ones of a target (for a refusal or a failed rollback message). */
function styleV3Differences(uuid, limit) {
  var before = STYLE_V3_STATE.before[uuid], latest = STYLE_V3_STATE.latest[uuid], names = [], seen = {}, index, k, label;
  if (before === undefined || latest === undefined) return names;
  function note(text) { if (!seen[text] && names.length < limit) { seen[text] = true; names.push(text); } }
  for (index = 0; index < before.rows.length && index < latest.rows.length; index++) {
    for (k = 0; k < STYLE_V3_CHAR_LABELS.length; k++) {
      if (before.rows[index][k] !== latest.rows[index][k]) { label = "character." + STYLE_V3_CHAR_LABELS[k]; note(label + " (index " + index + ": " + before.rows[index][k] + " -> " + latest.rows[index][k] + ")"); }
    }
  }
  for (k = 0; k < STYLE_V3_PARA_LABELS.length; k++) {
    if (before.para[k] !== latest.para[k]) note("paragraph." + STYLE_V3_PARA_LABELS[k] + " (" + before.para[k] + " -> " + latest.para[k] + ")");
  }
  for (k = 0; k < STYLE_V3_FRAME_LABELS.length; k++) {
    if (before.frame[k] !== latest.frame[k]) note("frame." + STYLE_V3_FRAME_LABELS[k] + " (" + before.frame[k] + " -> " + latest.frame[k] + ")");
  }
  return names;
}

function styleV3DiffSuffix() {
  if (STYLE_V3_STATE.lastUuid === null) return "";
  var names = styleV3Differences(STYLE_V3_STATE.lastUuid, 6);
  return names.length === 0 ? "" : " Recorded attributes that differ from the state read before the write: " + names.join("; ") + ".";
}

function styleV3Copy(source) {
  var copy = {}, key;
  for (key in source) if (source.hasOwnProperty(key)) copy[key] = source[key];
  return copy;
}

/** Whole-snapshot equality, key-order independent; the observed layout bounds count only when both sides carry them, within a tolerance. */
function styleV3Same(left, right) {
  var a = styleV3Copy(left), b = styleV3Copy(right), lb = left.layoutBounds, rb = right.layoutBounds, index;
  delete a.layoutBounds; delete b.layoutBounds;
  if (pointTextCanonicalJson(a) !== pointTextCanonicalJson(b)) return false;
  if (lb === null || lb === undefined || rb === null || rb === undefined) return true;
  if (typeof lb.length !== "number" || typeof rb.length !== "number" || lb.length !== 4 || rb.length !== 4) return false;
  for (index = 0; index < 4; index++) if (Math.abs(lb[index] - rb[index]) > STYLE_V3_BOUNDS_TOLERANCE) return false;
  return true;
}

function styleV3AutoLeadingAmount(target) {
  return mutationFiniteNumber(target.textRange.paragraphAttributes.autoLeadingAmount, "paragraphAttributes.autoLeadingAmount");
}

/** Only the requested fields move, only inside the range, plus leading with size (auto leading derives it; manual leading stays). The bounds are observed, never predicted. */
function styleV3PredictAfter(target, before) {
  var amount = params.style.size !== undefined ? styleV3AutoLeadingAmount(target) : 0;
  var characters = [], index, source, next;
  for (index = 0; index < before.characters.length; index++) {
    source = before.characters[index];
    if (index < params.start || index >= params.end) { characters.push(source); continue; }
    next = styleV3Copy(source);
    if (params.style.size !== undefined) {
      next.size = pointTextCanonicalChannel(params.style.size, "size");
      if (source.autoLeading === true) next.leading = pointTextCanonicalChannel(next.size * amount / 100, "leading");
    }
    if (params.style.tracking !== undefined) next.tracking = params.style.tracking;
    if (params.style.horizontalScale !== undefined) next.horizontalScale = params.style.horizontalScale;
    if (params.style.verticalScale !== undefined) next.verticalScale = params.style.verticalScale;
    if (params.style.tsume !== undefined) next.tsume = params.style.tsume;
    if (params.style.fillColor !== undefined) next.fillColor = params.style.fillColor;
    if (params.style.fontPostScriptName !== undefined) {
      var font = styleFont();
      next.font = { postScriptName: font.name, family: font.family, style: font.style };
    }
    characters.push(next);
  }
  var after = styleV3Copy(before);
  after.characters = characters;
  after.layoutBounds = null;
  return after;
}

/** The inverse writes back only the attributes that were requested, per character. */
function styleV3Restore(target, before) {
  var index, source, character, attributes;
  for (index = params.start; index < params.end; index++) {
    source = before.characters[index];
    character = target.characters[index];
    attributes = character.characterAttributes;
    if (params.style.size !== undefined) attributes.size = source.size;
    if (params.style.tracking !== undefined) attributes.tracking = source.tracking;
    if (params.style.horizontalScale !== undefined) attributes.horizontalScale = source.horizontalScale;
    if (params.style.verticalScale !== undefined) attributes.verticalScale = source.verticalScale;
    if (params.style.tsume !== undefined) attributes.Tsume = source.tsume;
    if (params.style.fillColor !== undefined) attributes.fillColor = pointTextNativeFillColor(source.fillColor);
    if (params.style.fontPostScriptName !== undefined) attributes.textFont = app.textFonts.getByName(source.font.postScriptName);
  }
}

/**
 * A rollback proceeds only when the explicit fields are the before state or the planned after state, as for every point-text edit; the recorded part may
 * differ (a collateral change is exactly what the restore and the comparison after it judge), and the observed bounds are not an admission input.
 */
function styleV3RollbackOk(current, target, before) {
  if (!before || before.profile !== STYLE_V3_PROFILE) return styleSame(current, stylePredictAfter(target, before));
  var copy = styleV3Copy(current);
  copy.attributeRecord = before.attributeRecord;
  copy.layoutBounds = before.layoutBounds;
  return styleSame(copy, before) || styleSame(copy, stylePredictAfter(target, before));
}
`;
