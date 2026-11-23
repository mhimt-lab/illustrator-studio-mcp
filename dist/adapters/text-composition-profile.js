import { z } from 'zod';
import { layerPathSchema } from '../mutation-result-schema-core.js';
import { AREA_TEXT_MAX_CODE_UNITS, PLAIN_AREA_TEXT_V1 } from './area-text-host-script.js';
import { POINT_TEXT_MAX_CODE_UNITS, POINT_TEXT_MAX_LAYER_DEPTH_LIMIT, PLAIN_POINT_TEXT_V1 } from './point-text-host-script.js';
import { snapshotJsonBytes } from './snapshot-result-size.js';
import { attributeRecordSchema, RECORDED_BOUNDS_TOLERANCE_PT } from './text-recorded-profile.js';
export const TEXT_COMPOSITION_PROFILE_NAME = 'recorded_text_composition_v2';
export const TEXT_COMPOSITION_MAX_POINT_CODE_UNITS = POINT_TEXT_MAX_CODE_UNITS;
export const TEXT_COMPOSITION_MAX_AREA_CODE_UNITS = AREA_TEXT_MAX_CODE_UNITS;
export const TEXT_COMPOSITION_MAX_LINES = 2_000;
export const KERNING_METHODS = ['none', 'auto', 'optical', 'metrics_roman_only'];
export const kerningMethodSchema = z.enum(KERNING_METHODS);
export const NATIVE_KERNING_METHOD = Object.freeze({
    none: 'NOAUTOKERN', auto: 'AUTO', optical: 'OPTICAL', metrics_roman_only: 'METRICSROMANONLY',
});
export const MOJIKUMI_SETS = ['YakumonoHankaku', 'GyomatsuYakumonoHankaku', 'GyomatsuYakumonoZenkaku', 'YakumonoZenkaku', 'GyomatsuYakumonoZenkakuOrHankaku',
    'TsumeGumi', 'BetaGumi'];
export const KINSOKU_SETS = ['Hard', 'Soft', 'Soft_v2'];
export const NONE_SET = 'none';
export const mojikumiRequestSchema = z.enum([...MOJIKUMI_SETS, NONE_SET]);
export const kinsokuRequestSchema = z.enum([...KINSOKU_SETS, NONE_SET]);
export const DEFAULT_MOJIKUMI_SET = 'GyomatsuYakumonoHankaku';
export const DEFAULT_KINSOKU_SET = 'Hard';
export const COMPOSITION_EXTRA_BLOCKERS = ['composition_inverse_unreachable'];
export function compositionMayBlockInverse(paragraphs, request, runs = [], aki = undefined, characters = undefined) {
    if (characters?.tracking !== undefined) {
        for (const run of runs) {
            if (run.end <= characters.start || run.start >= characters.end)
                continue;
            if (run.tracking !== characters.tracking && (characters.tracking === 0 || run.tracking === 0))
                return true;
        }
    }
    for (const entry of aki ?? []) {
        for (let index = entry.start; index < entry.end; index += 1) {
            const run = runs.find((candidate) => index >= candidate.start && index < candidate.end);
            if (run !== undefined && ((entry.left !== undefined && entry.left !== AUTO && run.akiLeft === AUTO) || (entry.right !== undefined && entry.right !== AUTO && run.akiRight === AUTO)))
                return true;
        }
    }
    for (const item of request ?? []) {
        const row = paragraphs[item.index];
        if (row === undefined)
            continue;
        const mojikumi = item.mojikumi === undefined ? undefined : item.mojikumi === NONE_SET ? null : item.mojikumi;
        const kinsoku = item.kinsoku === undefined ? undefined : item.kinsoku === NONE_SET ? null : item.kinsoku;
        if ((mojikumi !== undefined && row.mojikumi === DEFAULT_MOJIKUMI_SET && mojikumi !== DEFAULT_MOJIKUMI_SET) ||
            (kinsoku !== undefined && row.kinsoku === DEFAULT_KINSOKU_SET && kinsoku !== DEFAULT_KINSOKU_SET) ||
            (item.justification !== undefined && row.justification === DEFAULT_JUSTIFICATION && item.justification !== DEFAULT_JUSTIFICATION))
            return true;
    }
    return false;
}
export const JUSTIFICATIONS = ['left', 'center', 'right', 'justify_last_left', 'justify_last_center', 'justify_last_right', 'justify_all'];
export const justificationSchema = z.enum(JUSTIFICATIONS);
export const NATIVE_JUSTIFICATION = Object.freeze({
    left: 'LEFT', center: 'CENTER', right: 'RIGHT', justify_last_left: 'FULLJUSTIFYLASTLINELEFT', justify_last_center: 'FULLJUSTIFYLASTLINECENTER',
    justify_last_right: 'FULLJUSTIFYLASTLINERIGHT', justify_all: 'FULLJUSTIFY',
});
export const DEFAULT_JUSTIFICATION = 'left';
export const AUTO = 'auto';
export const leadingValueSchema = z.union([z.literal(AUTO), z.number().finite().positive()]);
export const AKI_AUTO_NATIVE = -1;
export const akiValueSchema = z.union([z.literal(AUTO), z.number().finite()]);
export const COMPOSITION_ROUTES = ['direct', 'compound_reset'];
export const COMPOSITION_EXPLICIT_CHARACTER_NAMES = ['proportionalMetrics', 'kerningMethod', 'autoLeading', 'leading', 'akiLeft', 'akiRight', 'tracking', 'horizontalScale'];
export const COMPOSITION_EXPLICIT_PARAGRAPH_NAMES = ['mojikumi', 'kinsoku', 'justification'];
const without = (names, excluded) => Object.freeze(names.filter((name) => !excluded.includes(name)));
export const COMPOSITION_CHARACTER_NAMES = without(Object.keys(PLAIN_POINT_TEXT_V1.character), COMPOSITION_EXPLICIT_CHARACTER_NAMES);
export const COMPOSITION_PARAGRAPH_NAMES = without(Object.keys(PLAIN_POINT_TEXT_V1.paragraph), COMPOSITION_EXPLICIT_PARAGRAPH_NAMES);
export const COMPOSITION_POINT_FRAME_NAMES = without(Object.keys(PLAIN_POINT_TEXT_V1.frame), ['orientation', 'wrapped']);
export const COMPOSITION_AREA_FRAME_NAMES = without(Object.keys(PLAIN_AREA_TEXT_V1.frame), ['orientation']);
const unique = (names) => Object.freeze([...new Set(names)]);
export const COMPOSITION_RESTORE_CHARACTER_NAMES = unique(['language', 'autoLeading', 'size', 'tracking', 'horizontalScale', 'verticalScale', 'leading', ...Object.keys(PLAIN_POINT_TEXT_V1.character)]);
export const COMPOSITION_RESTORE_PARAGRAPH_NAMES = unique([...Object.keys(PLAIN_POINT_TEXT_V1.paragraph), 'justification']);
const coordinate = z.number().finite();
const characterRunSchema = z.strictObject({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    proportionalMetrics: z.boolean(),
    kerningMethod: kerningMethodSchema,
    leading: leadingValueSchema,
    akiLeft: akiValueSchema,
    akiRight: akiValueSchema,
    tracking: z.number().finite(),
    horizontalScale: z.number().finite(),
});
const paragraphRowSchema = z.strictObject({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    mojikumi: z.string().min(1).max(255).nullable(),
    kinsoku: z.string().min(1).max(255).nullable(),
    justification: justificationSchema,
});
const frameStateSchema = z.strictObject({
    anchor: z.tuple([coordinate, coordinate]).nullable(),
    geometricBounds: z.tuple([coordinate, coordinate, coordinate, coordinate]).nullable(),
    matrix: z.strictObject({ a: coordinate, b: coordinate, c: coordinate, d: coordinate, tx: coordinate, ty: coordinate }),
    antialias: z.string().min(1).max(255),
    pixelAligned: z.boolean(),
    tagCount: z.number().int().nonnegative(),
});
const ancestorSchema = z.strictObject({ name: z.string().max(255), visible: z.boolean(), locked: z.boolean() });
const fitSchema = z.strictObject({ status: z.enum(['fits', 'overflows', 'indeterminate']), visibleCharacterCount: z.number().int().min(-1) });
export const compositionSnapshotInputSchema = z.strictObject({
    uuid: z.string().min(1).max(255),
    type: z.literal('TextFrame'),
    kind: z.enum(['TextType.POINTTEXT', 'TextType.AREATEXT']),
    profile: z.literal(TEXT_COMPOSITION_PROFILE_NAME),
    frameShape: z.enum(['point_text_unthreaded', 'area_text_unthreaded']),
    storyFrameCount: z.literal(1),
    contents: z.string().min(1).max(TEXT_COMPOSITION_MAX_AREA_CODE_UNITS),
    characterRuns: z.array(characterRunSchema).min(1).max(TEXT_COMPOSITION_MAX_AREA_CODE_UNITS),
    paragraphs: z.array(paragraphRowSchema).min(1).max(TEXT_COMPOSITION_MAX_AREA_CODE_UNITS),
    frame: frameStateSchema,
    fit: fitSchema.nullable(),
    layerPath: layerPathSchema,
    layerAncestry: z.array(ancestorSchema).min(1).max(POINT_TEXT_MAX_LAYER_DEPTH_LIMIT),
    locked: z.boolean(), hidden: z.boolean(), editable: z.boolean(), layerVisible: z.boolean(), layerLocked: z.boolean(),
    attributeRecord: attributeRecordSchema.extend({
        characterRuns: z.number().int().min(1).max(TEXT_COMPOSITION_MAX_AREA_CODE_UNITS),
        recordedCount: z.number().int().min(1).max(TEXT_COMPOSITION_MAX_AREA_CODE_UNITS * 80),
    }),
});
export const COMPOSITION_ROUTE_BYTES_PER_PARAGRAPH = 96;
export function compositionResultPairs(plan) {
    return [{ targetUuid: plan.targetUuid, before: plan.before, after: plan.after, metadata: { characters: plan.characters, paragraphs: plan.paragraphs, aki: plan.aki },
            terminalBytes: Math.max(snapshotJsonBytes(plan.before), snapshotJsonBytes(plan.after)) + COMPOSITION_ROUTE_BYTES_PER_PARAGRAPH * plan.before.paragraphs.length }];
}
export const compositionSnapshotSchema = compositionSnapshotInputSchema.superRefine((value, context) => {
    const point = value.kind === 'TextType.POINTTEXT';
    if (point !== (value.frameShape === 'point_text_unthreaded') || point !== (value.fit === null) || point !== (value.frame.anchor !== null) ||
        point === (value.frame.geometricBounds !== null)) {
        context.addIssue({ code: 'custom', message: 'A composition snapshot must be consistently point text or area text.' });
    }
    if (value.contents.length > (point ? TEXT_COMPOSITION_MAX_POINT_CODE_UNITS : TEXT_COMPOSITION_MAX_AREA_CODE_UNITS)) {
        context.addIssue({ code: 'custom', message: 'The contents exceed the measured limit of this frame type.' });
    }
    let expectedEnd = 0;
    value.characterRuns.forEach((run, index) => {
        const previous = value.characterRuns[index - 1];
        if (run.start !== expectedEnd || run.end <= run.start || (previous !== undefined && sameRunValues(previous, run))) {
            context.addIssue({ code: 'custom', message: 'Character runs must be a maximal, exact partition of the contents.' });
        }
        expectedEnd = run.end;
    });
    if (expectedEnd !== value.contents.length)
        context.addIssue({ code: 'custom', message: 'Character runs must cover the complete contents.' });
    const spans = paragraphSpans(value.contents);
    if (spans.length !== value.paragraphs.length ||
        spans.some(([start, end], index) => value.paragraphs[index].start !== start || value.paragraphs[index].end !== end)) {
        context.addIssue({ code: 'custom', message: 'Paragraph rows must be the carriage-return separated paragraphs of the contents.' });
    }
});
export function paragraphSpans(contents) {
    const spans = [];
    let start = 0;
    for (let index = 0; index <= contents.length; index += 1) {
        if (index === contents.length || contents.charAt(index) === '\r') {
            spans.push([start, index]);
            start = index + 1;
        }
    }
    return spans;
}
export const compositionLayoutSchema = z.strictObject({
    lines: z.array(z.string().max(TEXT_COMPOSITION_MAX_AREA_CODE_UNITS + TEXT_COMPOSITION_MAX_LINES)).max(TEXT_COMPOSITION_MAX_LINES),
    bounds: z.tuple([coordinate, coordinate, coordinate, coordinate]),
});
export const COMPOSITION_BOUNDS_TOLERANCE_PT = RECORDED_BOUNDS_TOLERANCE_PT;
export const TRACKING_SCALE_PER_CHARACTER_LIMIT = 1_500;
export const HORIZONTAL_SCALE_DECIMALS = 4;
export function quantizeHorizontalScale(value) {
    const rounded = Math.round(Math.fround(value / 100) * 100 * 100_000) / 100_000;
    return rounded === 0 ? 0 : rounded;
}
export function isTrackingScaleOnly(request) {
    return request !== undefined && request.proportionalMetrics === undefined && request.kerningMethod === undefined &&
        (request.tracking !== undefined || request.horizontalScale !== undefined);
}
export function sameRunValues(left, right) {
    return left.proportionalMetrics === right.proportionalMetrics && left.kerningMethod === right.kerningMethod && left.leading === right.leading &&
        left.akiLeft === right.akiLeft && left.akiRight === right.akiRight && left.tracking === right.tracking && left.horizontalScale === right.horizontalScale;
}
export function paragraphLeadingSpan(contents, index) {
    const [start, end] = paragraphSpans(contents)[index];
    return [start, end < contents.length ? end + 1 : end];
}
export function predictCompositionCharacterRuns(runs, request, aki = [], leading = []) {
    const rows = [];
    for (const run of runs)
        for (let index = run.start; index < run.end; index += 1) {
            rows.push({ proportionalMetrics: run.proportionalMetrics, kerningMethod: run.kerningMethod, leading: run.leading, akiLeft: run.akiLeft, akiRight: run.akiRight,
                tracking: run.tracking, horizontalScale: run.horizontalScale });
        }
    if (request !== undefined) {
        const scale = request.horizontalScale === undefined ? undefined : quantizeHorizontalScale(request.horizontalScale);
        for (let index = request.start; index < request.end; index += 1) {
            const row = rows[index];
            if (request.proportionalMetrics !== undefined)
                row.proportionalMetrics = request.proportionalMetrics;
            if (request.kerningMethod !== undefined)
                row.kerningMethod = request.kerningMethod;
            if (request.tracking !== undefined)
                row.tracking = request.tracking;
            if (scale !== undefined)
                row.horizontalScale = scale;
        }
    }
    for (const entry of leading)
        for (let index = entry.span[0]; index < entry.span[1]; index += 1)
            rows[index].leading = entry.value;
    for (const entry of aki) {
        for (let index = entry.start; index < entry.end; index += 1) {
            if (entry.left !== undefined)
                rows[index].akiLeft = entry.left;
            if (entry.right !== undefined)
                rows[index].akiRight = entry.right;
        }
    }
    const out = [];
    rows.forEach((row, index) => {
        const last = out[out.length - 1];
        if (last !== undefined && sameRunValues(last, row))
            last.end = index + 1;
        else
            out.push({ start: index, end: index + 1, ...row });
    });
    return out;
}
export function predictCompositionParagraphs(paragraphs, request) {
    const out = paragraphs.map((paragraph) => ({ ...paragraph }));
    for (const item of request) {
        const target = out[item.index];
        if (target === undefined)
            continue;
        if (item.mojikumi !== undefined)
            target.mojikumi = item.mojikumi === NONE_SET ? null : item.mojikumi;
        if (item.kinsoku !== undefined)
            target.kinsoku = item.kinsoku === NONE_SET ? null : item.kinsoku;
        if (item.justification !== undefined)
            target.justification = item.justification;
    }
    return out;
}
const hostNames = (names) => JSON.stringify(names);
export const TEXT_COMPOSITION_MODULE_SCRIPT = String.raw `var TC_PROFILE = ${JSON.stringify(TEXT_COMPOSITION_PROFILE_NAME)};
var TC_MAX_POINT = ${TEXT_COMPOSITION_MAX_POINT_CODE_UNITS};
var TC_MAX_AREA = ${TEXT_COMPOSITION_MAX_AREA_CODE_UNITS};
var TC_MAX_LINES = ${TEXT_COMPOSITION_MAX_LINES};
var TC_CHAR_NAMES = ${hostNames(COMPOSITION_CHARACTER_NAMES)};
var TC_PARA_NAMES = ${hostNames(COMPOSITION_PARAGRAPH_NAMES)};
var TC_POINT_FRAME_NAMES = ${hostNames(COMPOSITION_POINT_FRAME_NAMES)};
var TC_AREA_FRAME_NAMES = ${hostNames(COMPOSITION_AREA_FRAME_NAMES)};
var TC_RESTORE_CHAR_NAMES = ${hostNames(COMPOSITION_RESTORE_CHARACTER_NAMES)};
var TC_RESTORE_PARA_NAMES = ${hostNames(COMPOSITION_RESTORE_PARAGRAPH_NAMES)};
var TC_KERNING_WIRE = { "AutoKernType.NOAUTOKERN": "none", "AutoKernType.AUTO": "auto", "AutoKernType.OPTICAL": "optical", "AutoKernType.METRICSROMANONLY": "metrics_roman_only" };
var TC_KERNING_NATIVE = ${JSON.stringify(NATIVE_KERNING_METHOD)};
var TC_JUSTIFICATION_NATIVE = ${JSON.stringify(NATIVE_JUSTIFICATION)};
var TC_JUSTIFICATION_WIRE = ${JSON.stringify(Object.fromEntries(Object.entries(NATIVE_JUSTIFICATION).map(([wire, native]) => [`Justification.${native}`, wire])))};
var TC_AKI_AUTO = ${AKI_AUTO_NATIVE};
var TC_STATE = { cache: {}, before: {}, latest: {}, routes: [], akiRoutes: [], trackingRoutes: [] };
var TC_PER_CHARACTER_LIMIT = ${TRACKING_SCALE_PER_CHARACTER_LIMIT};

function tcRefuse(code, message) {
  throw mutationError("preflight_failed", code + ": " + message + " Nothing was written. MCP cannot change this itself and does not work around it with GUI automation or an ad-hoc script.");
}

function tcKerningRequested() {
  return !!params.characters && params.characters.kerningMethod !== undefined;
}

/** Single-precision rounding of a number (ExtendScript has no Math.fround): round to a multiple of 2^(e-23), ties to even. Tested against Math.fround. */
function tcFround32(x) {
  if (x === 0 || !isFinite(x)) return x;
  var sign = x < 0 ? -1 : 1, a = Math.abs(x), e = Math.floor(Math.log(a) / Math.LN2), quantum, r, f, d;
  while (Math.pow(2, e) > a) e--;
  while (Math.pow(2, e + 1) <= a) e++;
  quantum = Math.pow(2, e - 23); r = a / quantum; f = Math.floor(r); d = r - f;
  if (d > 0.5 || (d === 0.5 && f % 2 === 1)) f++;
  return sign * f * quantum;
}
/** The horizontal scale Illustrator reads back after a write of value percent: the single-precision fraction times 100, canonical at five decimals (F0 #914). */
function tcQuantScale(value) {
  var rounded = Math.round(tcFround32(value / 100) * 100 * 100000) / 100000;
  return rounded === 0 ? 0 : rounded;
}
function tcTrackingScaleRequested() {
  return !!params.characters && (params.characters.tracking !== undefined || params.characters.horizontalScale !== undefined);
}
/** A request that writes tracking and / or scale and no other character attribute: it may cross a paragraph break and may start on an overflowing frame. */
function tcOnlyTrackingScale() {
  return tcTrackingScaleRequested() && params.characters.proportionalMetrics === undefined && params.characters.kerningMethod === undefined;
}

/** A canonical value; a read that throws is a state of its own ("err:<number>"), comparable before and after. Numbers are canonical at five decimals. */
function tcValue(host, name) {
  try {
    var value = host[name];
    if (typeof value === "number") return isFinite(value) ? String(pointTextCanonicalChannel(value, name)) : "nonfinite";
    return pointTextCanonicalValue(value);
  } catch (readError) {
    return "err:" + (readError && typeof readError.number === "number" ? readError.number : "x");
  }
}

function tcHash32(text) {
  var h = 0x811c9dc5, i;
  for (i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0; }
  return h;
}
function tcHash2(text) {
  var h = 5381, i;
  for (i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h;
}
function tcFingerprintText(rows, paragraphRows, frameRow) {
  var runs = [], last = null, count = 0, index, key, paragraphs = [];
  for (index = 0; index < rows.length; index++) {
    key = rows[index].join("\u0001");
    if (last !== null && key === last) { count++; continue; }
    if (last !== null) runs.push(count + "\u0002" + last);
    last = key; count = 1;
  }
  if (last !== null) runs.push(count + "\u0002" + last);
  for (index = 0; index < paragraphRows.length; index++) paragraphs.push(paragraphRows[index].join("\u0001"));
  return runs.join("\u0003") + "\u0004" + paragraphs.join("\u0005") + "\u0004" + frameRow.join("\u0001");
}

function tcStroke(color) {
  var type;
  try { type = String(color.typename); } catch (strokeError) { tcRefuse("composition_attribute_unreadable", "a character's stroke color cannot be read, so it cannot be compared before and after."); }
  if (type === "NoColor") return "none";
  if (type === "RGBColor" || type === "CMYKColor" || type === "GrayColor") return tcCanonicalJson(pointTextReadFillColor(color));
  tcRefuse("composition_attribute_unreadable", "a character's stroke is a " + type + ", which cannot be compared before and after (RGB, CMYK, Gray or none only).");
}

/**
 * The manual-kerning amount (\`kerning\`, read per character) follows the kerning method of the character to its LEFT, and a first character (no left
 * neighbour) follows its own: writing a method over [start, end) changes the amount read at start+1 ... end, and at start too when start is 0
 * (err:9551 <-> 0 when NOAUTOKERN is involved). Measured on stable 30.8.2 (F0 raw of #708: every method transition over 4 scopes; the P0 attempt 1 stop
 * was the character at \`end\`, outside the range) and on 31.0.0 (#1043 F0: 62 steps over 4 scopes, [0, length), [0, 30), [0, 1) and [29, length); every
 * change fits start0 ... end for start 0 and start+1 ... end otherwise). Those indexes are blanked (\`derived\`) in the recorded table; every index from
 * start to end (the last one if it exists) must carry no real pair kern, which is refused, not masked: a real amount at character 0 is refused as before.
 */
function tcKernRole(index, length) {
  var role = { checked: false, masked: false };
  if (!tcKerningRequested()) return role;
  var last = params.characters.end < length ? params.characters.end : length - 1;
  role.checked = index >= params.characters.start && index <= last;
  role.masked = (params.characters.start === 0 ? index >= 0 : index > params.characters.start) && index <= last;
  return role;
}

/**
 * One character, held by the caller (a character released before its attributes are read fails with error 9503). The explicit attributes always, the
 * recorded row on a full read. \`role.masked\` blanks the derived manual-kerning label (see tcKernRole); \`role.checked\` refuses a real pair kern.
 */
function tcCharacter(character, index, full, role) {
  var attributes;
  try { attributes = character.characterAttributes; }
  catch (attributesError) { throw mutationError("preflight_failed", "A character's attributes are unavailable."); }
  var palt = attributes.proportionalMetrics;
  if (typeof palt !== "boolean") tcRefuse("composition_attribute_unreadable", "a character's proportional metrics cannot be read.");
  var method = TC_KERNING_WIRE[String(attributes.kerningMethod)];
  if (method === undefined) tcRefuse("composition_attribute_unreadable", "a character's kerning method is not one of the four this tool knows (" + String(attributes.kerningMethod) + ").");
  var autoLeading = attributes.autoLeading;
  if (typeof autoLeading !== "boolean") tcRefuse("composition_attribute_unreadable", "a character's auto leading state cannot be read.");
  var explicit = { proportionalMetrics: palt, kerningMethod: method,
    leading: autoLeading ? "auto" : pointTextCanonicalChannel(pointTextNumber(attributes.leading, "characterAttributes.leading"), "leading"),
    akiLeft: tcAki(attributes, "akiLeft"), akiRight: tcAki(attributes, "akiRight"),
    tracking: pointTextCanonicalChannel(pointTextNumber(attributes.tracking, "characterAttributes.tracking"), "tracking"),
    horizontalScale: pointTextCanonicalChannel(pointTextNumber(attributes.horizontalScale, "characterAttributes.horizontalScale"), "horizontalScale") };
  if (!full) return { explicit: explicit, row: null };
  var font = attributes.textFont;
  if (!font || typeof font.name !== "string" || !font.name) throw mutationError("preflight_failed", "A character's font identity is unavailable.");
  var located = null;
  try { located = app.textFonts.getByName(font.name); } catch (fontError) { located = null; }
  if (located === null || located === undefined || located !== font) throw mutationError("preflight_failed", "A character's font is not installed.");
  var row = [String(character.contents), font.name, String(font.family), String(font.style),
    String(pointTextCanonicalChannel(pointTextNumber(attributes.size, "characterAttributes.size"), "size")),
    String(pointTextCanonicalChannel(pointTextNumber(attributes.verticalScale, "characterAttributes.verticalScale"), "verticalScale")),
    tcCanonicalJson(pointTextReadFillColor(attributes.fillColor)), tcStroke(attributes.strokeColor)], k;
  for (k = 0; k < TC_CHAR_NAMES.length; k++) row.push(tcValue(attributes, TC_CHAR_NAMES[k]));
  var label, kerning;
  try {
    kerning = character.kerning;
    label = (typeof kerning === "number" && isFinite(kerning)) ? "k:" + String(pointTextCanonicalChannel(kerning, "kerning")) : "kerning:" + String(kerning);
  } catch (kerningError) {
    label = kerningError && Number(kerningError.number) === 9551 ? "none" : "err:" + (kerningError && typeof kerningError.number === "number" ? kerningError.number : "x");
  }
  if (role.checked && label !== "none" && label !== "k:0") {
    tcRefuse("composition_manual_kerning", "a character in or right after the range carries manual pair kerning (" + label + "), so a change of the kerning method is not measured for it.");
  }
  if (role.masked) label = "derived";
  row.push(label);
  return { explicit: explicit, row: row };
}

/** akiLeft / akiRight: "auto" for the native -1, otherwise the canonical number. */
function tcAki(attributes, name) {
  var value = attributes[name];
  if (typeof value !== "number" || !isFinite(value)) tcRefuse("composition_attribute_unreadable", "a character's " + name + " cannot be read.");
  return value === TC_AKI_AUTO ? "auto" : pointTextCanonicalChannel(value, name);
}

/**
 * An empty paragraph (a carriage return right after another) whose attributes cannot be read: every attribute read fails with Illustrator error 1220 on
 * stable 30.8.2 (#708 P0 v2, L-EMPTY setup). Called on a failed read only, so a readable frame costs nothing more. Refuses the frame with the reason named.
 */
function tcRefuseEmptyParagraph(span, index) {
  if (!span || span[0] !== span[1]) return;
  throw mutationError("preflight_failed", stringifyJson({ code: "COMPOSITION_REFUSED", reason: "composition_empty_paragraph",
    message: "composition_empty_paragraph: paragraph " + index + " is empty (a line break right after another), and Illustrator does not let its paragraph attributes be read, so this frame is refused. Nothing was written. Separate paragraphs with space before / space after instead of an empty line, or remove the empty line, then plan again." }));
}

/** The paragraph's two explicit names (null when Illustrator reports the attribute as undefined: error 9563) and, on a full read, its recorded row. */
function tcParagraph(paragraph, full, span, index) {
  var attributes;
  try { attributes = paragraph.paragraphAttributes; }
  catch (paragraphError) { tcRefuseEmptyParagraph(span, index); throw mutationError("preflight_failed", "Target paragraph attributes are unavailable."); }
  var names = {}, keys = ["mojikumi", "kinsoku"], k, value;
  for (k = 0; k < keys.length; k++) {
    try {
      value = attributes[keys[k]];
      names[keys[k]] = (value === undefined || value === null) ? null : String(value);
    } catch (nameError) {
      if (nameError && Number(nameError.number) === POINT_TEXT_UNDEFINED_ATTRIBUTE_ERROR) names[keys[k]] = null;
      else { tcRefuseEmptyParagraph(span, index); tcRefuse("composition_attribute_unreadable", "the paragraph " + keys[k] + " cannot be read" + (nameError && typeof nameError.number === "number" ? " (Illustrator error " + nameError.number + ")" : "") + "."); }
    }
  }
  var justification;
  try { justification = TC_JUSTIFICATION_WIRE[String(attributes.justification)]; } catch (justificationError) { justification = undefined; }
  if (justification === undefined) { tcRefuseEmptyParagraph(span, index); tcRefuse("composition_attribute_unreadable", "the paragraph justification cannot be read as one of the seven this tool knows."); }
  names.justification = justification;
  if (!full) return { names: names, row: null };
  var row = [];
  for (k = 0; k < TC_PARA_NAMES.length; k++) row.push(tcValue(attributes, TC_PARA_NAMES[k]));
  var stops = "err:x", detail, tabs, j, count;
  try {
    tabs = attributes.tabStops; count = tabs.length; detail = [String(count)];
    for (j = 0; j < count; j++) detail.push(tcValue(tabs[j], "position") + "/" + tcValue(tabs[j], "alignment") + "/" + tcValue(tabs[j], "leader") + "/" + tcValue(tabs[j], "decimalCharacter"));
    stops = detail.join(";");
  } catch (stopsError) { stops = "err:" + (stopsError && typeof stopsError.number === "number" ? stopsError.number : "x"); }
  row.push(stops);
  var listText;
  try { listText = "name:" + String(attributes.listStyle.name); }
  catch (listError) { listText = listError && Number(listError.number) === POINT_TEXT_LIST_STYLE_UNBOUND_ERROR ? "unbound" : "err:" + (listError && typeof listError.number === "number" ? listError.number : "x"); }
  row.push(listText);
  return { names: names, row: row };
}

function tcFrame(target, point) {
  var orientation = tcValue(target, "orientation");
  if (orientation !== "o:TextOrientation.HORIZONTAL") tcRefuse("composition_structure_unsupported", "the frame orientation reads " + orientation + "; only horizontal text is measured.");
  var names = point ? TC_POINT_FRAME_NAMES : TC_AREA_FRAME_NAMES, row = [], k;
  if (point) {
    pointTextFrameShape(target);
    if (tcValue(target, "wrapped") !== "false") tcRefuse("composition_structure_unsupported", "the frame wraps around objects; that is not the measured point text.");
  } else if (!/^([1-9]|1[0-9]|20)$/.test(tcValue(target, "columnCount")) || tcValue(target, "rowCount") !== "1") {
    tcRefuse("composition_structure_unsupported", "the area frame has more than one row or more than 20 columns; one row of 1 to 20 columns is measured.");
  }
  for (k = 0; k < names.length; k++) row.push(tcValue(target, names[k]));
  var tagCount;
  try { tagCount = target.tags.length; } catch (tagError) { throw mutationError("preflight_failed", "Target frame tag state is unavailable."); }
  if (typeof tagCount !== "number") throw mutationError("preflight_failed", "Target frame tag state is unavailable.");
  row.push(String(tagCount));
  var matrix = target.matrix, anchor = null, bounds = null, raw, index;
  if (point) {
    raw = target.anchor;
    if (!raw || typeof raw.length !== "number" || raw.length !== 2) throw mutationError("preflight_failed", "Target frame anchor is unavailable.");
    anchor = [pointTextNumber(raw[0], "frame.anchor[0]"), pointTextNumber(raw[1], "frame.anchor[1]")];
  } else {
    raw = target.geometricBounds;
    if (!raw || typeof raw.length !== "number" || raw.length !== 4) throw mutationError("preflight_failed", "Target frame bounds are unavailable.");
    bounds = [];
    for (index = 0; index < 4; index++) bounds.push(pointTextNumber(raw[index], "frame.geometricBounds[" + index + "]"));
  }
  if (typeof target.pixelAligned !== "boolean") throw mutationError("preflight_failed", "Target frame state is unavailable.");
  return { row: row, state: {
    anchor: anchor, geometricBounds: bounds,
    matrix: { a: pointTextNumber(matrix.mValueA, "frame.matrix.a"), b: pointTextNumber(matrix.mValueB, "frame.matrix.b"),
      c: pointTextNumber(matrix.mValueC, "frame.matrix.c"), d: pointTextNumber(matrix.mValueD, "frame.matrix.d"),
      tx: pointTextNumber(matrix.mValueTX, "frame.matrix.tx"), ty: pointTextNumber(matrix.mValueTY, "frame.matrix.ty") },
    antialias: String(target.antialias), pixelAligned: target.pixelAligned, tagCount: tagCount } };
}

/** The composed lines and the frame bounds, observed. A frame whose lines cannot be read is refused (the result would have nothing to report). */
function tcLayout(target) {
  var lines = [], count, index, total = 0, text, bounds = [], raw;
  try {
    count = Number(target.lines.length);
    if (!isFinite(count) || count < 0 || count > TC_MAX_LINES) throw new Error("line count");
    for (index = 0; index < count; index++) {
      text = String(target.lines[index].contents);
      total += text.length;
      if (total > TC_MAX_AREA + TC_MAX_LINES) throw new Error("line total");
      lines.push(text);
    }
    raw = target.geometricBounds;
    for (index = 0; index < 4; index++) bounds.push(pointTextCanonicalChannel(pointTextNumber(raw[index], "geometricBounds"), "geometricBounds"));
  } catch (layoutError) {
    throw mutationError("preflight_failed", "The composed lines of the frame could not be read.");
  }
  return { lines: lines, bounds: bounds };
}

function tcSameRun(left, right) {
  return left.proportionalMetrics === right.proportionalMetrics && left.kerningMethod === right.kerningMethod && left.leading === right.leading &&
    left.akiLeft === right.akiLeft && left.akiRight === right.akiRight && left.tracking === right.tracking && left.horizontalScale === right.horizontalScale;
}
/** The explicit values of every character, expanded from runs (a copy). */
function tcRows(runs) {
  var rows = [], index, run, position;
  for (index = 0; index < runs.length; index++) {
    run = runs[index];
    for (position = run.start; position < run.end; position++) rows.push({ proportionalMetrics: run.proportionalMetrics, kerningMethod: run.kerningMethod,
      leading: run.leading, akiLeft: run.akiLeft, akiRight: run.akiRight, tracking: run.tracking, horizontalScale: run.horizontalScale });
  }
  return rows;
}
/** \`[start, last)\` of the characters a paragraph's leading is written to: its characters and its carriage return. */
function tcLeadingSpan(contents, index) {
  var span = tcSpans(contents)[index];
  return [span[0], span[1] < contents.length ? span[1] + 1 : span[1]];
}
function tcRuns(explicitList) {
  var runs = [], index, current, last;
  for (index = 0; index < explicitList.length; index++) {
    current = explicitList[index]; last = runs.length > 0 ? runs[runs.length - 1] : null;
    if (last !== null && tcSameRun(last, current)) last.end = index + 1;
    else runs.push({ start: index, end: index + 1, proportionalMetrics: current.proportionalMetrics, kerningMethod: current.kerningMethod,
      leading: current.leading, akiLeft: current.akiLeft, akiRight: current.akiRight, tracking: current.tracking, horizontalScale: current.horizontalScale });
  }
  return runs;
}

function tcSpans(contents) {
  var spans = [], start = 0, index;
  for (index = 0; index <= contents.length; index++) {
    if (index === contents.length || contents.charAt(index) === "\r") { spans.push([start, index]); start = index + 1; }
  }
  return spans;
}

/**
 * The snapshot of a horizontal, unthreaded, layer-direct point or area frame. A full read records every table once (the first read of a target in a
 * host call is its before state, the latest one is kept for the in-call comparison); a light read (revalidation) re-reads the explicit fields and
 * reuses the recorded part, so a change in it shows at verification.
 */
function tcSnapshot(document, target, expectedUuid, light) {
  if (!target || target.typename !== "TextFrame") throw mutationError("preflight_failed", "Text-composition operations support TextFrame targets only.");
  var point;
  if (target.kind === TextType.POINTTEXT) point = true;
  else if (target.kind === TextType.AREATEXT) point = false;
  else throw mutationError("preflight_failed", "Text-composition operations support point text and area text only.");
  if (typeof target.uuid !== "string" || target.uuid !== expectedUuid) throw mutationError("preflight_failed", "Target native UUID is unavailable or changed.");
  if (!target.layer || target.parent !== target.layer) throw mutationError("preflight_failed", "The text-composition target must be directly contained by its layer.");
  if (!target.story || !target.story.textFrames || target.story.textFrames.length !== 1 || target.story.textFrames[0] !== target) {
    throw mutationError("preflight_failed", "Text-composition operations support unthreaded text only.");
  }
  if (typeof target.locked !== "boolean" || typeof target.hidden !== "boolean" || typeof target.editable !== "boolean" ||
      typeof target.layer.visible !== "boolean" || typeof target.layer.locked !== "boolean") {
    throw mutationError("preflight_failed", "Target safety state is unavailable.");
  }
  var layerPath = pointTextLayerPath(document, target.layer);
  if (layerPath === null) throw mutationError("preflight_failed", "Target layer path is unavailable.");
  var contents = target.contents, limit = point ? TC_MAX_POINT : TC_MAX_AREA;
  if (typeof contents !== "string" || contents.length < 1 || contents.length > limit || String(contents).indexOf("\x03") >= 0 || String(contents).indexOf("\n") >= 0) {
    throw mutationError("preflight_failed", "Target contents must be 1 to " + limit + " UTF-16 code units without inline graphics or line feeds.");
  }
  var characters = target.characters;
  if (!characters || typeof characters.length !== "number" || characters.length !== contents.length) {
    throw mutationError("preflight_failed", "Target characters are unavailable or do not match the contents.");
  }
  var cached = TC_STATE.cache[expectedUuid];
  var isLight = light === true && cached !== undefined;
  var explicitList = [], rows = [], index, read;
  for (index = 0; index < characters.length; index++) {
    // Held, not temporary: an attribute read off a released character fails with error 9503.
    read = tcCharacter(characters[index], index, !isLight, tcKernRole(index, characters.length));
    explicitList.push(read.explicit);
    if (!isLight) rows.push(read.row);
  }
  var paragraphs = target.paragraphs;
  var spans = tcSpans(contents);
  if (!paragraphs || typeof paragraphs.length !== "number" || paragraphs.length !== spans.length) {
    throw mutationError("preflight_failed", "Target paragraphs do not match the carriage-return separated paragraphs of the contents.");
  }
  var paragraphRows = [], paragraphList = [], item;
  for (index = 0; index < spans.length; index++) {
    item = tcParagraph(paragraphs[index], !isLight, spans[index], index);
    paragraphList.push({ start: spans[index][0], end: spans[index][1], mojikumi: item.names.mojikumi, kinsoku: item.names.kinsoku, justification: item.names.justification });
    if (!isLight) paragraphRows.push(item.row);
  }
  var record, frameState, fit = null;
  if (isLight) {
    record = cached.record; frameState = cached.frameState;
  } else {
    var frame = tcFrame(target, point);
    var runs = 0, last = null, key;
    for (index = 0; index < rows.length; index++) { key = rows[index].join("\u0001"); if (key !== last) { runs++; last = key; } }
    var fingerprintText = tcFingerprintText(rows, paragraphRows, frame.row);
    record = { fingerprint: tcHash32(fingerprintText) + ":" + tcHash2(fingerprintText) + ":" + fingerprintText.length,
      characterRuns: runs, recordedCount: rows.length * (rows[0].length) + paragraphRows.length * (paragraphRows[0].length) + frame.row.length };
    frameState = frame.state;
    var tables = { rows: rows, paragraphs: paragraphRows, frame: frame.row };
    TC_STATE.latest[expectedUuid] = tables;
    if (TC_STATE.before[expectedUuid] === undefined) TC_STATE.before[expectedUuid] = tables;
    TC_STATE.cache[expectedUuid] = { record: record, frameState: frameState };
  }
  if (!point) { var proof = areaTextFit(target, contents); fit = { status: proof.status, visibleCharacterCount: proof.visibleCharacterCount }; }
  return {
    uuid: target.uuid, type: target.typename, kind: point ? "TextType.POINTTEXT" : "TextType.AREATEXT", profile: TC_PROFILE,
    frameShape: point ? "point_text_unthreaded" : "area_text_unthreaded", storyFrameCount: 1,
    contents: contents, characterRuns: tcRuns(explicitList), paragraphs: paragraphList, frame: frameState, fit: fit,
    layerPath: layerPath, layerAncestry: pointTextAncestry(target),
    locked: target.locked, hidden: target.hidden, editable: target.editable, layerVisible: target.layer.visible, layerLocked: target.layer.locked,
    attributeRecord: record
  };
}

/** The first recorded labels that differ between the state read before the write and the latest one (for a failed verification or rollback). */
function tcDifferences(uuid, limit) {
  var before = TC_STATE.before[uuid], latest = TC_STATE.latest[uuid], names = [], seen = {}, index, k;
  if (before === undefined || latest === undefined) return names;
  function note(text) { if (!seen[text] && names.length < limit) { seen[text] = true; names.push(text); } }
  for (index = 0; index < before.rows.length && index < latest.rows.length; index++) {
    for (k = 0; k < before.rows[index].length; k++) {
      if (before.rows[index][k] !== latest.rows[index][k]) note("character[" + index + "].column" + k + " (" + before.rows[index][k] + " -> " + latest.rows[index][k] + ")");
    }
  }
  for (index = 0; index < before.paragraphs.length && index < latest.paragraphs.length; index++) {
    for (k = 0; k < before.paragraphs[index].length; k++) {
      if (before.paragraphs[index][k] !== latest.paragraphs[index][k]) note("paragraph[" + index + "].column" + k + " (" + before.paragraphs[index][k] + " -> " + latest.paragraphs[index][k] + ")");
    }
  }
  for (k = 0; k < before.frame.length; k++) {
    if (before.frame[k] !== latest.frame[k]) note("frame.column" + k + " (" + before.frame[k] + " -> " + latest.frame[k] + ")");
  }
  return names;
}
function tcDiffSuffix(uuid) {
  var names = tcDifferences(uuid, 6);
  return names.length === 0 ? "" : " Recorded attributes that differ from the state read before the write: " + names.join("; ") + ".";
}

/** Key-order independent JSON: an echoed snapshot comes back through the published schema, which orders keys by its own declaration. */
function tcCanonicalJson(value) {
  if (value === null || typeof value !== "object") return stringifyJson(value);
  var index, items = [], keys = [], key;
  if (value instanceof Array) {
    for (index = 0; index < value.length; index++) items.push(tcCanonicalJson(value[index]));
    return "[" + items.join(",") + "]";
  }
  for (key in value) if (value.hasOwnProperty(key)) keys.push(key);
  keys.sort();
  for (index = 0; index < keys.length; index++) items.push(stringifyJson(keys[index]) + ":" + tcCanonicalJson(value[keys[index]]));
  return "{" + items.join(",") + "}";
}

function tcCopy(value) {
  if (value === null || typeof value !== "object") return value;
  var copy = value instanceof Array ? [] : {}, key;
  for (key in value) if (value.hasOwnProperty(key)) copy[key] = tcCopy(value[key]);
  return copy;
}
function tcSame(left, right) {
  return left !== null && left !== undefined && right !== null && right !== undefined && tcCanonicalJson(left) === tcCanonicalJson(right);
}

/** The requested values (characters, aki ranges, paragraph leading over the paragraph's characters, paragraph sets); nothing else moves. */
function tcPredictAfter(before) {
  var after = tcCopy(before), rows = tcRows(before.characterRuns), index, k, span, entry;
  if (params.characters) {
    for (index = params.characters.start; index < params.characters.end; index++) {
      if (params.characters.proportionalMetrics !== undefined) rows[index].proportionalMetrics = params.characters.proportionalMetrics;
      if (params.characters.kerningMethod !== undefined) rows[index].kerningMethod = params.characters.kerningMethod;
      if (params.characters.tracking !== undefined) rows[index].tracking = params.characters.tracking;
      if (params.characters.horizontalScale !== undefined) rows[index].horizontalScale = tcQuantScale(params.characters.horizontalScale);
    }
  }
  if (params.paragraphs) {
    for (k = 0; k < params.paragraphs.length; k++) {
      if (params.paragraphs[k].leading === undefined) continue;
      span = tcLeadingSpan(before.contents, params.paragraphs[k].index);
      for (index = span[0]; index < span[1]; index++) rows[index].leading = params.paragraphs[k].leading;
    }
  }
  if (params.aki) {
    for (k = 0; k < params.aki.length; k++) {
      entry = params.aki[k];
      for (index = entry.start; index < entry.end; index++) {
        if (entry.left !== undefined) rows[index].akiLeft = entry.left;
        if (entry.right !== undefined) rows[index].akiRight = entry.right;
      }
    }
  }
  after.characterRuns = tcRuns(rows);
  // #914: tracking and scale alone may start on an overflowing frame; the change is kept only if the whole text then shows, so that is the state planned.
  if (before.fit && before.fit.status === "overflows" && tcOnlyTrackingScale() && !params.paragraphs && !params.aki) {
    after.fit = { status: "fits", visibleCharacterCount: String(before.contents).replace(/[\r\n\x03]/g, "").length };
  }
  if (params.paragraphs) {
    for (index = 0; index < params.paragraphs.length; index++) {
      var item = params.paragraphs[index];
      if (item.mojikumi !== undefined) after.paragraphs[item.index].mojikumi = item.mojikumi === "none" ? null : item.mojikumi;
      if (item.kinsoku !== undefined) after.paragraphs[item.index].kinsoku = item.kinsoku === "none" ? null : item.kinsoku;
      if (item.justification !== undefined) after.paragraphs[item.index].justification = item.justification;
    }
  }
  return after;
}

function tcRunAt(runs, index) {
  for (var k = 0; k < runs.length; k++) if (index >= runs[k].start && index < runs[k].end) return runs[k];
  throw mutationError("apply_failed", "Character index outside the recorded runs.");
}

/** Each held character in the range, nothing outside it. \`values(index)\` gives the explicit values to write (palt and kerning method, as requested). */
function tcWriteCharacters(target, start, end, values) {
  var index, character, attributes, value;
  if (params.characters.proportionalMetrics === undefined && params.characters.kerningMethod === undefined) return;
  for (index = start; index < end; index++) {
    character = target.characters[index];
    attributes = character.characterAttributes;
    value = values(index);
    if (params.characters.proportionalMetrics !== undefined) attributes.proportionalMetrics = value.proportionalMetrics;
    if (params.characters.kerningMethod !== undefined) attributes.kerningMethod = AutoKernType[TC_KERNING_NATIVE[value.kerningMethod]];
  }
}

/** How [start, end) is written: the held text range (the whole frame), the held handle of one whole paragraph (with its carriage return), or one character at a time. */
function tcWriteRoute(contents, start, end) {
  if (start === 0 && end === contents.length) return "range";
  var spans = tcSpans(contents), k, last;
  for (k = 0; k < spans.length; k++) {
    last = spans[k][1] < contents.length ? spans[k][1] + 1 : spans[k][1];
    if (start === spans[k][0] && end === last) return "paragraph:" + k;
  }
  return "chars";
}
function tcTrackingScaleKeys() {
  var keys = [];
  if (params.characters.tracking !== undefined) keys.push("tracking");
  if (params.characters.horizontalScale !== undefined) keys.push("horizontalScale");
  return keys;
}
/** Whether \`want(index)\` is the same for every character of [start, end) in each listed key. */
function tcUniformWant(start, end, keys, want) {
  var first = want(start), index, k, value;
  for (index = start + 1; index < end; index++) {
    value = want(index);
    for (k = 0; k < keys.length; k++) if (value[keys[k]] !== first[keys[k]]) return null;
  }
  return first;
}
/**
 * The requested tracking and / or horizontal scale of [start, end), including paragraph breaks (F0 #914: the held text range and the held paragraph handle reached
 * every character, carriage returns included, with nothing else moved, 2 to 21 ms; one character at a time took 4.6 s for 1,009 characters). \`want(index)\` gives the
 * values. Returns the route taken.
 */
function tcWriteTrackingScale(target, contents, start, end, want) {
  var keys = tcTrackingScaleKeys(), route = tcWriteRoute(contents, start, end), uniform = tcUniformWant(start, end, keys, want), k, index, range, handle, character, attributes, value;
  if (uniform !== null && route !== "chars") {
    if (route === "range") { range = target.textRange; attributes = range.characterAttributes; }
    else { handle = target.paragraphs[Number(route.substring(10))]; attributes = handle.characterAttributes; }
    for (k = 0; k < keys.length; k++) attributes[keys[k]] = uniform[keys[k]];
    return route === "range" ? "range" : "paragraph";
  }
  for (index = start; index < end; index++) {
    character = target.characters[index];
    attributes = character.characterAttributes;
    value = want(index);
    for (k = 0; k < keys.length; k++) attributes[keys[k]] = value[keys[k]];
  }
  return "chars";
}
/**
 * A write of tracking 0 over a character with no other override is ignored (F0 #914; the horizontal scale 100 is not). For each paragraph where a character does not read
 * the wanted tracking, the paragraph is put back to "no override" and every attribute written back with the wanted tracking (the reset of aki and the sets).
 * Returns, for every paragraph the range touches, how its tracking was reached.
 */
function tcSettleTracking(document, target, contents, start, end, want) {
  if (params.characters.tracking === undefined) return [];
  var spans = tcSpans(contents), missed = {}, seen = {}, order = [], routes = [], index, paragraph, character, attributes, k;
  for (index = start; index < end; index++) {
    paragraph = tcParagraphOf(spans, index);
    if (seen[paragraph] !== true) { seen[paragraph] = true; order.push(paragraph); }
    character = target.characters[index];
    attributes = character.characterAttributes;
    if (tcValue(attributes, "tracking") !== String(want(index).tracking)) missed[paragraph] = true;
  }
  for (k = 0; k < order.length; k++) {
    paragraph = order[k];
    if (missed[paragraph] !== true) { routes.push({ index: paragraph, route: "direct" }); continue; }
    tcCompoundReset(document, target, paragraph, { start: spans[paragraph][0], end: spans[paragraph][1] }, function (at, record) {
      if (at >= start && at < end) { record.s.tracking = String(want(at).tracking); record.v.tracking = want(at).tracking; }
    }, {});
    for (index = start; index < end; index++) {
      if (tcParagraphOf(spans, index) !== paragraph) continue;
      character = target.characters[index];
      attributes = character.characterAttributes;
      if (tcValue(attributes, "tracking") !== String(want(index).tracking)) throw mutationError("apply_failed", "The tracking could not be put back to the requested value.");
    }
    routes.push({ index: paragraph, route: "compound_reset" });
  }
  return routes;
}

/**
 * The leading of each held character of [start, end): "auto" sets \`autoLeading\` (the read of \`leading\` then follows the size), a number clears it first and
 * writes the leading (A203-05 and #708 F0 order). \`value(index)\` gives the value for each character.
 */
function tcWriteLeading(target, start, end, value) {
  var index, character, attributes, wanted;
  for (index = start; index < end; index++) {
    character = target.characters[index];
    attributes = character.characterAttributes;
    wanted = value(index);
    if (wanted === "auto") attributes.autoLeading = true;
    else { attributes.autoLeading = false; attributes.leading = wanted; }
  }
}
/** The aki of each held character of [start, end): \`side\` is akiLeft or akiRight, "auto" writes the native -1. */
function tcWriteAki(target, start, end, side, value) {
  var index, character, attributes, wanted;
  for (index = start; index < end; index++) {
    character = target.characters[index];
    attributes = character.characterAttributes;
    wanted = value(index);
    attributes[side] = wanted === "auto" ? TC_AKI_AUTO : wanted;
  }
}
/**
 * The leading of a whole paragraph through its held handle: one assignment reaches every character of the paragraph and its carriage return (#708 F0 v2,
 * 362/362 cells, nothing else moved; about 1/170 of the time of the per-character writes).
 */
function tcWriteParagraphLeading(target, index, value) {
  var paragraph = target.paragraphs[index];
  var attributes = paragraph.characterAttributes;
  if (value === "auto") attributes.autoLeading = true;
  else { attributes.autoLeading = false; attributes.leading = value; }
}
/** The one leading every character of [start, end) has in \`rows\`, or undefined when they differ. */
function tcUniformLeading(rows, start, end) {
  var index, first = rows[start].leading;
  for (index = start + 1; index < end; index++) if (rows[index].leading !== first) return undefined;
  return first;
}
/** Every requested leading and aki; \`fromRows\` (the before rows, for the inverse) or the request gives the values. Returns the aki routes by paragraph. */
function tcWriteCharacterLayout(document, target, contents, fromRows) {
  var k, span, entry, uniform;
  if (params.paragraphs) {
    for (k = 0; k < params.paragraphs.length; k++) {
      entry = params.paragraphs[k];
      if (entry.leading === undefined) continue;
      span = tcLeadingSpan(contents, entry.index);
      uniform = fromRows === null ? entry.leading : tcUniformLeading(fromRows, span[0], span[1]);
      // The paragraph handle was measured on area text only (F0 v2 lead_range); point text keeps the measured per-character writes.
      if (uniform !== undefined && target.kind === TextType.AREATEXT) tcWriteParagraphLeading(target, entry.index, uniform);
      else tcWriteLeading(target, span[0], span[1], function (index) { return fromRows === null ? entry.leading : fromRows[index].leading; });
    }
  }
  if (!params.aki) return [];
  for (k = 0; k < params.aki.length; k++) {
    entry = params.aki[k];
    if (entry.left !== undefined) tcWriteAki(target, entry.start, entry.end, "akiLeft", function (index) { return fromRows === null ? entry.left : fromRows[index].akiLeft; });
    if (entry.right !== undefined) tcWriteAki(target, entry.start, entry.end, "akiRight", function (index) { return fromRows === null ? entry.right : fromRows[index].akiRight; });
  }
  return tcSettleAki(document, target, contents, fromRows);
}

/** The aki each requested position must read, by position: { akiLeft?: value, akiRight?: value }. */
function tcWantedAki(fromRows) {
  var wanted = {}, k, entry, index;
  for (k = 0; k < params.aki.length; k++) {
    entry = params.aki[k];
    for (index = entry.start; index < entry.end; index++) {
      if (wanted[index] === undefined) wanted[index] = {};
      if (entry.left !== undefined) wanted[index].akiLeft = fromRows === null ? entry.left : fromRows[index].akiLeft;
      if (entry.right !== undefined) wanted[index].akiRight = fromRows === null ? entry.right : fromRows[index].akiRight;
    }
  }
  return wanted;
}
function tcParagraphOf(spans, position) {
  for (var k = 0; k < spans.length; k++) if (position >= spans[k][0] && position <= spans[k][1]) return k;
  return -1;
}
/**
 * Illustrator ignores a write of aki -1 ("auto") on a character with no other override (#708 F0 v2). Such a paragraph is put back to "no override" with the
 * standard paragraph style and every recorded attribute is written back, with "auto" in place of the ignored aki (the reset itself reads -1, measured).
 * Returns, for every paragraph the aki ranges touch, how it was reached.
 */
function tcSettleAki(document, target, contents, fromRows) {
  var wanted = tcWantedAki(fromRows), spans = tcSpans(contents), routes = {}, missed = {}, order = [], position, side, character, read, paragraph, k;
  for (position in wanted) {
    if (!wanted.hasOwnProperty(position)) continue;
    paragraph = tcParagraphOf(spans, Number(position));
    if (routes[paragraph] === undefined) { routes[paragraph] = "direct"; order.push(paragraph); }
    character = target.characters[Number(position)];
    read = character.characterAttributes;
    for (side in wanted[position]) {
      if (wanted[position].hasOwnProperty(side) && wanted[position][side] === "auto" && tcAki(read, side) !== "auto") missed[paragraph] = true;
    }
  }
  order.sort(function (a, b) { return a - b; });
  for (k = 0; k < order.length; k++) {
    paragraph = order[k];
    if (missed[paragraph] !== true) continue;
    tcCompoundReset(document, target, paragraph, { start: spans[paragraph][0], end: spans[paragraph][1] }, function (at, record) {
      var want = wanted[at], name;
      if (want === undefined) return;
      for (name in want) if (want.hasOwnProperty(name) && want[name] === "auto") { record.s[name] = String(TC_AKI_AUTO); record.v[name] = TC_AKI_AUTO; }
    }, {});
    for (position in wanted) {
      if (!wanted.hasOwnProperty(position) || tcParagraphOf(spans, Number(position)) !== paragraph) continue;
      character = target.characters[Number(position)];
      read = character.characterAttributes;
      for (side in wanted[position]) {
        if (wanted[position].hasOwnProperty(side) && wanted[position][side] === "auto" && tcAki(read, side) !== "auto") throw mutationError("apply_failed", "The aki could not be put back to auto.");
      }
    }
    routes[paragraph] = "compound_reset";
  }
  var out = [];
  for (k = 0; k < order.length; k++) out.push({ index: order[k], route: routes[order[k]] });
  return out;
}

var TC_DEFAULT_MOJIKUMI = ${JSON.stringify(DEFAULT_MOJIKUMI_SET)};
var TC_DEFAULT_JUSTIFICATION = ${JSON.stringify(DEFAULT_JUSTIFICATION)};
var TC_DEFAULT_KINSOKU = ${JSON.stringify(DEFAULT_KINSOKU_SET)};

/** The name a value stands for: "none" (or null, as the snapshot reports it) is the absent set. */
function tcWantName(value) { return value === null || value === "none" ? null : value; }

/** Writes the requested sets of one paragraph through its held handle. \`value\` gives the names (a name, "none", or null for the absent set). */
function tcWriteSets(document, target, index, item, value) {
  var paragraph = target.paragraphs[index];
  var attributes = paragraph.paragraphAttributes;
  if (item.mojikumi !== undefined) attributes.mojikumi = tcMojikumiValue(document, value.mojikumi === null ? "none" : value.mojikumi);
  if (item.kinsoku !== undefined) attributes.kinsoku = tcKinsokuValue(value.kinsoku === null ? "none" : value.kinsoku);
  if (item.justification !== undefined) attributes.justification = Justification[TC_JUSTIFICATION_NATIVE[value.justification]];
}

/** Whether the paragraph reads as requested ("none" reads as error 9563, which the snapshot reports as null). */
function tcSetsTaken(target, index, item, value) {
  var names = tcParagraph(target.paragraphs[index], false).names;
  if (item.mojikumi !== undefined && names.mojikumi !== tcWantName(value.mojikumi)) return false;
  if (item.kinsoku !== undefined && names.kinsoku !== tcWantName(value.kinsoku)) return false;
  if (item.justification !== undefined && names.justification !== value.justification) return false;
  return true;
}

/** The typed values of the listed attributes (raw, to write back) and their canonical text (to compare); a read that fails has no value to write back. */
function tcRecordNames(host, names) {
  var rec = { s: {}, v: {} }, k;
  for (k = 0; k < names.length; k++) {
    rec.s[names[k]] = tcValue(host, names[k]);
    try { rec.v[names[k]] = host[names[k]]; } catch (readError) { rec.v[names[k]] = undefined; }
  }
  return rec;
}
function tcStrokeObject(color) {
  return String(color.typename) === "NoColor" ? null : pointTextReadFillColor(color);
}
/** One character, held by the caller: every attribute the paragraph reset can change. */
function tcRecordCharacter(character) {
  var attributes = character.characterAttributes, rec = tcRecordNames(attributes, TC_RESTORE_CHAR_NAMES), font = attributes.textFont;
  if (!font || typeof font.name !== "string" || !font.name) tcRefuse("composition_default_unreachable", "a character's font cannot be recorded, so the paragraph cannot be reset and restored.");
  rec.fontName = font.name;
  rec.fill = pointTextReadFillColor(attributes.fillColor);
  rec.stroke = tcStrokeObject(attributes.strokeColor);
  return rec;
}
/** Writes back, in the order of #619 R2, only what differs from the record (font, then the listed attributes, then fill and stroke). */
function tcRestoreCharacter(character, rec) {
  var attributes = character.characterAttributes, font = attributes.textFont, k, name, stroke;
  if (!font || font.name !== rec.fontName) attributes.textFont = app.textFonts.getByName(rec.fontName);
  for (k = 0; k < TC_RESTORE_CHAR_NAMES.length; k++) {
    name = TC_RESTORE_CHAR_NAMES[k];
    if (rec.v[name] === undefined || tcValue(attributes, name) === rec.s[name]) continue;
    if (name === "leading" && rec.s.autoLeading === "true") continue;
    attributes[name] = rec.v[name];
  }
  if (tcCanonicalJson(pointTextReadFillColor(attributes.fillColor)) !== tcCanonicalJson(rec.fill)) attributes.fillColor = pointTextNativeFillColor(rec.fill);
  stroke = tcStrokeObject(attributes.strokeColor);
  if (tcCanonicalJson(stroke) !== tcCanonicalJson(rec.stroke)) attributes.strokeColor = rec.stroke === null ? new NoColor() : pointTextNativeFillColor(rec.stroke);
}
function tcRestoreParagraph(paragraph, rec, skip) {
  var attributes = paragraph.paragraphAttributes, k, name;
  for (k = 0; k < TC_RESTORE_PARA_NAMES.length; k++) {
    name = TC_RESTORE_PARA_NAMES[k];
    if (skip[name] === true || rec.v[name] === undefined || tcValue(attributes, name) === rec.s[name]) continue;
    attributes[name] = rec.v[name];
  }
}

/**
 * What stops the paragraph reset, or null. The reset resets more than the attributes the snapshot tells apart and writes back only part of it: the applied
 * paragraph style, the applied character styles, tab stops, a bound list style and manual pair kerning (which lives outside the character attributes) are not
 * written back, so a paragraph that has any of them is not reset. The same check admits the reset at the apply and decides the plan blocker.
 */
function tcCompoundObstacle(document, target, index, last, span) {
  var paragraph = target.paragraphs[index], attributes = paragraph.paragraphAttributes, names = [], applied, standard, k, position, character, tabs, kerning;
  try {
    applied = paragraph.paragraphStyles;
    for (k = 0; k < applied.length; k++) names.push(String(applied[k].name));
    standard = String(document.paragraphStyles[0].name);
  } catch (styleError) { return "the applied paragraph style cannot be read, so the paragraph cannot be put back to the default set."; }
  if (names.length !== 1 || names[0] !== standard) return "the paragraph must carry the standard paragraph style to be put back to the default set.";
  for (position = span.start; position < last; position++) {
    character = target.characters[position];
    names = [];
    try {
      applied = character.characterStyles;
      for (k = 0; k < applied.length; k++) names.push(String(applied[k].name));
      standard = String(document.characterStyles[0].name);
    } catch (characterStyleError) { return "the applied character style cannot be read, so the paragraph cannot be put back to the default set."; }
    if (names.length !== 1 || names[0] !== standard) return "the characters of the paragraph must carry the standard character style to put the paragraph back to the default set.";
    try { kerning = character.kerning; }
    catch (kerningError) {
      if (kerningError && Number(kerningError.number) === 9551) continue;
      return "a manual pair kerning cannot be read, so the paragraph cannot be put back to the default set.";
    }
    if (typeof kerning !== "number" || kerning !== 0) return "a character of the paragraph carries manual pair kerning, which the reset would clear and the write-back does not restore, so the paragraph cannot be put back to the default set.";
  }
  try { tabs = attributes.tabStops; if (Number(tabs.length) !== 0) return "the paragraph has tab stops, which the reset would clear, so it cannot be put back to the default set."; }
  catch (tabError) { return "the tab stops cannot be read, so the paragraph cannot be put back to the default set."; }
  try { String(attributes.listStyle.name); return "the paragraph is bound to a list style, which the reset would clear, so it cannot be put back to the default set."; }
  catch (listError) {
    if (!listError || Number(listError.number) !== POINT_TEXT_LIST_STYLE_UNBOUND_ERROR) return "the list style cannot be read, so the paragraph cannot be put back to the default set.";
  }
  return null;
}
function tcParagraphLast(target, span) { return span.end < target.contents.length ? span.end + 1 : span.end; }
function tcAdmitCompound(document, target, index, span) {
  var obstacle = tcCompoundObstacle(document, target, index, tcParagraphLast(target, span), span);
  if (obstacle !== null) tcRefuse("composition_default_unreachable", obstacle);
}

/**
 * The route for a write the host ignored (a write of a default value that would remove the last override of the paragraph; #877 F0, F0-2'): the standard
 * paragraph style is applied with its overrides cleared, every character attribute and paragraph attribute that the reset changed is written back, and the
 * requested sets are written over the cleared paragraph. The whole snapshot is compared afterwards by the verification.
 */
/**
 * The paragraph reset: record every character (and its paragraph mark) and the paragraph, apply the standard paragraph style with its overrides cleared, and write
 * back what the reset changed. \`adjust(position, record)\` may replace a recorded value with the one wanted; \`skip\` names paragraph attributes not written back.
 */
function tcCompoundReset(document, target, index, span, adjust, skip) {
  var last = tcParagraphLast(target, span), position, character, records = [], paragraphRecord;
  tcAdmitCompound(document, target, index, span);
  paragraphRecord = tcRecordParagraph(target.paragraphs[index]);
  for (position = span.start; position < last; position++) { character = target.characters[position]; records.push(tcRecordCharacter(character)); }
  if (adjust !== null) for (position = span.start; position < last; position++) adjust(position, records[position - span.start]);
  document.paragraphStyles[0].applyTo(target.paragraphs[index], true);
  for (position = span.start; position < last; position++) { character = target.characters[position]; tcRestoreCharacter(character, records[position - span.start]); }
  tcRestoreParagraph(target.paragraphs[index], paragraphRecord, skip);
}
function tcCompoundSet(document, target, index, item, value, span) {
  var skip = {};
  if (item.mojikumi !== undefined) skip.mojikumi = true;
  if (item.kinsoku !== undefined) skip.kinsoku = true;
  if (item.justification !== undefined) skip.justification = true;
  tcCompoundReset(document, target, index, span, null, skip);
  tcWriteSets(document, target, index, item, value);
}
function tcRecordParagraph(paragraph) { return tcRecordNames(paragraph.paragraphAttributes, TC_RESTORE_PARA_NAMES); }

/** One requested paragraph: a direct write, and when the host ignored a write of a default value, the compound route. Returns the route taken. */
function tcSetParagraph(document, target, index, item, value, span) {
  tcWriteSets(document, target, index, item, value);
  if (tcSetsTaken(target, index, item, value)) return "direct";
  var defaultTarget = (item.mojikumi !== undefined && tcWantName(value.mojikumi) === TC_DEFAULT_MOJIKUMI) || (item.kinsoku !== undefined && tcWantName(value.kinsoku) === TC_DEFAULT_KINSOKU) ||
    (item.justification !== undefined && value.justification === TC_DEFAULT_JUSTIFICATION);
  // A write of a non-default value is never ignored (measured); if one did not take, the verification refuses and the rollback restores.
  if (!defaultTarget) return "direct";
  tcCompoundSet(document, target, index, item, value, span);
  if (!tcSetsTaken(target, index, item, value)) throw mutationError("apply_failed", "The paragraph could not be put back to the requested default set.");
  return "compound_reset";
}

/** Each requested paragraph; \`values(index)\` gives the names to write (a name, "none", or null). Returns the routes taken, by paragraph. */
function tcWriteParagraphs(document, target, spans, values) {
  var k, item, routes = [];
  for (k = 0; k < params.paragraphs.length; k++) {
    item = params.paragraphs[k];
    routes.push({ index: item.index, route: tcSetParagraph(document, target, item.index, item, values(item.index), spans[item.index]) });
  }
  return routes;
}

function tcSplitsCharacter(contents, start, end) {
  var low = contents.charCodeAt(start), after = end < contents.length ? contents.charCodeAt(end) : 0;
  return (low >= 0xDC00 && low <= 0xDFFF) || (after >= 0xDC00 && after <= 0xDFFF);
}
function tcAdmitAki(contents) {
  if (!params.aki) return;
  var k, entry, last = 0;
  for (k = 0; k < params.aki.length; k++) {
    entry = params.aki[k];
    if (entry.start < last || entry.end <= entry.start || entry.end > contents.length) throw mutationError("preflight_failed", "An aki range is outside the target contents, empty, or overlaps the one before it.");
    if (tcSplitsCharacter(contents, entry.start, entry.end)) tcRefuse("composition_range_splits_character", "an aki range starts or ends inside a surrogate pair.");
    if (String(contents.substring(entry.start, entry.end)).indexOf("\r") >= 0) tcRefuse("composition_range_spans_paragraphs", "an aki range contains a paragraph break.");
    last = entry.end;
  }
}
/** A uniform value of each requested key over [start, end) in the before runs, or null when a requested key differs between characters (the inverse then writes one character at a time). */
function tcBeforeUniform(runs, start, end) {
  var keys = tcTrackingScaleKeys(), first = tcRunAt(runs, start), index, run, k;
  for (index = start + 1; index < end; index++) {
    run = tcRunAt(runs, index);
    for (k = 0; k < keys.length; k++) if (run[keys[k]] !== first[keys[k]]) return false;
  }
  return true;
}
function tcAdmit(before, contents) {
  // #914: tracking and scale alone may start on a frame that overflows (the use case of plan_text_fit); the check after the write still demands that the whole text is shown.
  var overflowAllowed = before.fit && before.fit.status === "overflows" && tcOnlyTrackingScale() && !params.paragraphs && !params.aki;
  if (before.fit && before.fit.status !== "fits" && !overflowAllowed) {
    tcRefuse("composition_area_overflows", "the area frame does not show its whole text, so a change that moves the line breaks cannot be judged.");
  }
  tcAdmitAki(contents);
  if (params.characters) {
    if (params.characters.end > contents.length || params.characters.start >= params.characters.end) {
      throw mutationError("preflight_failed", "The requested character range is outside the target contents.");
    }
    var lowAtStart = contents.charCodeAt(params.characters.start), lowAtEnd = params.characters.end < contents.length ? contents.charCodeAt(params.characters.end) : 0;
    if ((lowAtStart >= 0xDC00 && lowAtStart <= 0xDFFF) || (lowAtEnd >= 0xDC00 && lowAtEnd <= 0xDFFF)) {
      tcRefuse("composition_range_splits_character", "the character range starts or ends inside a surrogate pair.");
    }
    if (String(contents.substring(params.characters.start, params.characters.end)).indexOf("\r") >= 0 && !tcOnlyTrackingScale()) {
      tcRefuse("composition_range_spans_paragraphs", "the character range contains a paragraph break; write each paragraph's range with its own call.");
    }
    if (tcTrackingScaleRequested() && params.characters.end - params.characters.start > TC_PER_CHARACTER_LIMIT &&
        (tcWriteRoute(contents, params.characters.start, params.characters.end) === "chars" || !tcBeforeUniform(before.characterRuns, params.characters.start, params.characters.end))) {
      throw mutationError("preflight_failed", stringifyJson({ code: "COMPOSITION_REFUSED", reason: "composition_range_too_long",
        message: "composition_range_too_long: this tracking / horizontal scale range is written (or restored) one character at a time and is longer than " + TC_PER_CHARACTER_LIMIT +
          " characters. Nothing was written. Write the whole frame in one call, or one whole paragraph (with its paragraph break) per call." }));
    }
  }
}

/** The set a request names, as the value to assign: the element of \`Document.mojikumiSet\` (by name, never by index), or the none value. */
function tcMojikumiValue(document, name) {
  if (name === "none") return "\u306A\u3057";
  var list = document.mojikumiSet, index;
  for (index = 0; index < list.length; index++) if (String(list[index]) === name) return list[index];
  return null;
}
function tcKinsokuValue(name) {
  return name === "none" ? "None" : name;
}
function tcParagraphRequested(index) {
  if (!params.paragraphs) return null;
  for (var k = 0; k < params.paragraphs.length; k++) if (params.paragraphs[k].index === index) return params.paragraphs[k];
  return null;
}
function tcAdmitParagraphs(document, before) {
  if (!params.paragraphs) return;
  var k, item, seen = {};
  for (k = 0; k < params.paragraphs.length; k++) {
    item = params.paragraphs[k];
    if (item.index >= before.paragraphs.length || seen[item.index] === true) {
      throw mutationError("preflight_failed", "A requested paragraph index is outside the target or repeated.");
    }
    seen[item.index] = true;
    if (item.justification !== undefined && before.kind === "TextType.POINTTEXT") {
      tcRefuse("composition_structure_unsupported", "the justification of point text is not offered: point text is recomposed around its anchor and the frame moves. Use area text.");
    }
    if (item.mojikumi !== undefined && tcMojikumiValue(document, item.mojikumi) === null) {
      tcRefuse("composition_set_unavailable", "this document has no mojikumi set named " + item.mojikumi + ".");
    }
  }
}

/**
 * The blocker this profile adds: a requested paragraph whose mojikumi or kinsoku is at its default and changes to another value could only be written back
 * by the paragraph reset (the write of the default is ignored), and a paragraph that the reset cannot be applied to would be left unrestorable if the
 * verification after the apply failed. Twin of compositionExtraBlockers in the Node module (which re-derives only the part visible in the snapshot).
 */
function tcExtraBlockers(document, target, before) {
  var out = [], k, item, row, leavesDefault;
  for (k = 0; params.paragraphs && k < params.paragraphs.length; k++) {
    item = params.paragraphs[k];
    row = before.paragraphs[item.index];
    if (row === undefined) continue;
    leavesDefault = (item.mojikumi !== undefined && row.mojikumi === TC_DEFAULT_MOJIKUMI && tcWantName(item.mojikumi) !== TC_DEFAULT_MOJIKUMI) ||
      (item.kinsoku !== undefined && row.kinsoku === TC_DEFAULT_KINSOKU && tcWantName(item.kinsoku) !== TC_DEFAULT_KINSOKU) ||
      (item.justification !== undefined && row.justification === TC_DEFAULT_JUSTIFICATION && item.justification !== TC_DEFAULT_JUSTIFICATION);
    if (leavesDefault && tcCompoundObstacle(document, target, item.index, tcParagraphLast(target, row), row) !== null) { out.push("composition_inverse_unreachable"); break; }
  }
  if (out.length === 0 && params.characters && params.characters.tracking !== undefined) {
    // #914 F0: a write of tracking 0 over a character with no other override is ignored, so a tracking write that writes or restores 0 may need the paragraph reset.
    var trackingRows = tcRows(before.characterRuns), trackingSeen = {}, trackingIndex, trackingParagraph, trackingSpans = tcSpans(before.contents);
    for (trackingIndex = params.characters.start; trackingIndex < params.characters.end && out.length === 0; trackingIndex++) {
      if (trackingRows[trackingIndex].tracking === params.characters.tracking || !(params.characters.tracking === 0 || trackingRows[trackingIndex].tracking === 0)) continue;
      trackingParagraph = tcParagraphOf(trackingSpans, trackingIndex);
      if (trackingSeen[trackingParagraph] === true) continue;
      trackingSeen[trackingParagraph] = true;
      if (tcCompoundObstacle(document, target, trackingParagraph, tcParagraphLast(target, before.paragraphs[trackingParagraph]), before.paragraphs[trackingParagraph]) !== null) out.push("composition_inverse_unreachable");
    }
  }
  if (out.length === 0 && params.aki) {
    // A character that leaves aki "auto" may be one whose write of auto back is ignored (no other override): its inverse is the paragraph reset.
    var rows = tcRows(before.characterRuns), spans = tcSpans(before.contents), seen = {}, entry, index, paragraph;
    for (k = 0; k < params.aki.length && out.length === 0; k++) {
      entry = params.aki[k];
      for (index = entry.start; index < entry.end; index++) {
        if (!((entry.left !== undefined && entry.left !== "auto" && rows[index].akiLeft === "auto") || (entry.right !== undefined && entry.right !== "auto" && rows[index].akiRight === "auto"))) continue;
        paragraph = tcParagraphOf(spans, index);
        if (seen[paragraph] === true) continue;
        seen[paragraph] = true;
        if (tcCompoundObstacle(document, target, paragraph, tcParagraphLast(target, before.paragraphs[paragraph]), before.paragraphs[paragraph]) !== null) { out.push("composition_inverse_unreachable"); break; }
      }
    }
  }
  return out;
}

/** A request that changes nothing is refused: the plan would promise a change that the verification cannot tell from a write the host ignored. */
function tcAdmitChange(before) {
  if (tcSame(tcPredictAfter(before), before)) tcRefuse("composition_no_change", "the requested attributes already have the requested values.");
}

function tcResolve(forApply, light) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  var target = pointTextFind(document, params.targetUuid);
  if (target === null) throw mutationError("preflight_failed", stringifyJson({ code: "OBJECT_NOT_FOUND", uuid: params.targetUuid }));
  var before = tcSnapshot(document, target, params.targetUuid, light);
  var blockers = pointTextBlockers(context, before);
  if (forApply && blockers.length > 0) {
    throw mutationBeforeSideEffectError(stringifyJson({ code: "TEXT_LAYOUT_APPLY_BLOCKED", reasonCodes: blockers, uuid: params.targetUuid }));
  }
  return { context: context, document: document, target: target, before: before, blockers: blockers };
}

function tcPreflight(forApply) {
  var resolved = tcResolve(forApply, false);
  tcAdmit(resolved.before, resolved.before.contents);
  tcAdmitParagraphs(resolved.document, resolved.before);
  tcAdmitChange(resolved.before);
  var extra = tcExtraBlockers(resolved.document, resolved.target, resolved.before);
  if (forApply && extra.length > 0) throw mutationBeforeSideEffectError(stringifyJson({ code: "TEXT_LAYOUT_APPLY_BLOCKED", reasonCodes: extra, uuid: params.targetUuid }));
  resolved.blockers = resolved.blockers.concat(extra);
  resolved.layoutBefore = tcLayout(resolved.target);
  resolved.layoutAfter = null;
  if (forApply) {
    if (!tcSame(resolved.before, params.expectedBefore)) throw mutationError("preflight_failed", "Target state does not match expected_before." + tcDiffSuffix(params.targetUuid));
    if (!tcSame(tcPredictAfter(resolved.before), params.confirmedAfter)) throw mutationError("preflight_failed", "confirmed_after does not match the derived text-composition state.");
  }
  return resolved;
}

/** Host twin of compositionResultPairs (Node). */
function tcResultPairs(plan) {
  return [{ targetUuid: plan.targetUuid, before: plan.before, after: plan.after, metadata: { characters: plan.characters, paragraphs: plan.paragraphs, aki: plan.aki },
    terminalBytes: Math.max(snapshotJsonBytes(plan.before), snapshotJsonBytes(plan.after)) + ${COMPOSITION_ROUTE_BYTES_PER_PARAGRAPH} * plan.before.paragraphs.length }];
}

function tcPlan(preflight) {
  var plan = {
    operation: "set_text_composition", documentKey: preflight.context.key, targetUuid: params.targetUuid,
    before: preflight.before, after: tcPredictAfter(preflight.before), layoutBefore: preflight.layoutBefore,
    applyBlockedReasonCodes: preflight.blockers,
    confirmationStatus: params.apply === true ? "confirmed" : "required",
    applyAllowed: params.apply === true && preflight.blockers.length === 0
  };
  if (params.characters) plan.characters = params.characters;
  if (params.paragraphs) plan.paragraphs = params.paragraphs;
  if (params.aki) plan.aki = params.aki;
  return snapshotResultAdmitPlan(plan, tcResultPairs(plan), plan.before.contents.length);
}

function tcRevalidate(preflight, plan) {
  var current;
  try { current = tcResolve(true, true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Text-composition preconditions changed before apply.")); }
  if (current.document !== preflight.document || current.target !== preflight.target || !tcSame(current.before, plan.before)) {
    throw mutationBeforeSideEffectError("Text-composition target changed before apply.");
  }
  if (!tcSame(tcLayout(current.target), preflight.layoutBefore)) throw mutationBeforeSideEffectError("Text-composition line layout changed before apply.");
}

function tcApply(preflight, plan, state) {
  state.operationState.mutationStarted = true;
  if (params.characters) tcWriteCharacters(preflight.target, params.characters.start, params.characters.end, function () {
    return { proportionalMetrics: params.characters.proportionalMetrics, kerningMethod: params.characters.kerningMethod };
  });
  TC_STATE.trackingRoutes = [];
  if (tcTrackingScaleRequested()) {
    var wantRequested = function () { return { tracking: params.characters.tracking, horizontalScale: params.characters.horizontalScale }; };
    tcWriteTrackingScale(preflight.target, plan.before.contents, params.characters.start, params.characters.end, wantRequested);
    TC_STATE.trackingRoutes = tcSettleTracking(preflight.document, preflight.target, plan.before.contents, params.characters.start, params.characters.end, wantRequested);
  }
  TC_STATE.akiRoutes = tcWriteCharacterLayout(preflight.document, preflight.target, plan.before.contents, null);
  TC_STATE.routes = [];
  if (params.paragraphs) TC_STATE.routes = tcWriteParagraphs(preflight.document, preflight.target, plan.before.paragraphs, function (index) {
    var item = tcParagraphRequested(index);
    return { mojikumi: item.mojikumi === undefined ? null : item.mojikumi, kinsoku: item.kinsoku === undefined ? null : item.kinsoku,
      justification: item.justification === undefined ? null : item.justification };
  });
  return preflight.target;
}

function tcVerify(preflight, plan) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) throw mutationError("verify_mismatch", "Active document changed during text-composition verification.");
  var target = pointTextFind(preflight.document, plan.before.uuid);
  if (target === null || target !== preflight.target) throw mutationError("verify_mismatch", "Target native UUID no longer resolves to the same TextFrame.");
  var actual = tcSnapshot(preflight.document, target, params.targetUuid, false);
  // An overflow is named first: the fit is part of the snapshot, so the comparison below would report it only as a mismatch.
  if (actual.fit && actual.fit.status !== "fits") {
    throw mutationError("verify_mismatch", "The area frame does not show its whole text after the change (" + actual.fit.visibleCharacterCount + " of " + actual.contents.length +
      " characters visible), so the change is undone. Use a smaller tracking or a lower horizontal scale, or enlarge the frame.");
  }
  if (!tcSame(actual, plan.after)) throw mutationError("verify_mismatch", "Text-composition postcondition does not match the plan." + tcDiffSuffix(params.targetUuid));
  preflight.layoutAfter = tcLayout(target);
  return actual;
}

/** \`current\` with every requested attribute (characters, aki ranges, paragraph leading, paragraph sets), the recorded part and the fit proof taken from \`before\`. */
function tcMaskedLikeBefore(current, before) {
  var probe = tcCopy(current), rows = tcRows(current.characterRuns), original = tcRows(before.characterRuns), index, k, span, entry;
  if (params.characters) {
    for (index = params.characters.start; index < params.characters.end; index++) {
      if (params.characters.proportionalMetrics !== undefined) rows[index].proportionalMetrics = original[index].proportionalMetrics;
      if (params.characters.kerningMethod !== undefined) rows[index].kerningMethod = original[index].kerningMethod;
      if (params.characters.tracking !== undefined) rows[index].tracking = original[index].tracking;
      if (params.characters.horizontalScale !== undefined) rows[index].horizontalScale = original[index].horizontalScale;
    }
  }
  if (params.paragraphs) {
    for (k = 0; k < params.paragraphs.length; k++) {
      if (params.paragraphs[k].leading === undefined) continue;
      span = tcLeadingSpan(before.contents, params.paragraphs[k].index);
      for (index = span[0]; index < span[1]; index++) rows[index].leading = original[index].leading;
    }
  }
  if (params.aki) {
    for (k = 0; k < params.aki.length; k++) {
      entry = params.aki[k];
      for (index = entry.start; index < entry.end; index++) {
        if (entry.left !== undefined) rows[index].akiLeft = original[index].akiLeft;
        if (entry.right !== undefined) rows[index].akiRight = original[index].akiRight;
      }
    }
  }
  probe.characterRuns = tcRuns(rows);
  if (params.paragraphs) {
    for (index = 0; index < params.paragraphs.length; index++) {
      var item = params.paragraphs[index];
      if (item.mojikumi !== undefined) probe.paragraphs[item.index].mojikumi = before.paragraphs[item.index].mojikumi;
      if (item.kinsoku !== undefined) probe.paragraphs[item.index].kinsoku = before.paragraphs[item.index].kinsoku;
      if (item.justification !== undefined) probe.paragraphs[item.index].justification = before.paragraphs[item.index].justification;
    }
  }
  probe.attributeRecord = before.attributeRecord;
  probe.fit = before.fit;
  return probe;
}

function tcRollback(state) {
  var preflight = state.preflight;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
  var target, current;
  try {
    target = pointTextFind(preflight.document, params.targetUuid);
    if (target === null || target !== preflight.target) return { status: "indeterminate", message: "Rollback target identity is indeterminate." };
    current = tcSnapshot(preflight.document, target, params.targetUuid, false);
  } catch (error) { return { status: "indeterminate", message: "Rollback target state is indeterminate." }; }
  var probe = tcMaskedLikeBefore(current, preflight.before);
  // The inverse proceeds only when the state differs from the before state in nothing but the requested attributes inside the range (the recorded part may
  // differ too: judging that is what the restore and the comparison after it do).
  if (!tcSame(probe, preflight.before)) {
    return { status: "indeterminate", message: "Rollback refused because the target changed outside the requested attributes." + tcDiffSuffix(params.targetUuid) };
  }
  if (!tcSame(current, preflight.before)) {
    try {
      if (params.characters) tcWriteCharacters(target, params.characters.start, params.characters.end, function (index) { return tcRunAt(preflight.before.characterRuns, index); });
      if (tcTrackingScaleRequested()) {
        var wantBefore = function (index) { var run = tcRunAt(preflight.before.characterRuns, index); return { tracking: run.tracking, horizontalScale: run.horizontalScale }; };
        tcWriteTrackingScale(target, preflight.before.contents, params.characters.start, params.characters.end, wantBefore);
        tcSettleTracking(preflight.document, target, preflight.before.contents, params.characters.start, params.characters.end, wantBefore);
      }
      tcWriteCharacterLayout(preflight.document, target, preflight.before.contents, tcRows(preflight.before.characterRuns));
      if (params.paragraphs) tcWriteParagraphs(preflight.document, target, preflight.before.paragraphs, function (index) { return preflight.before.paragraphs[index]; });
    } catch (writeError) { return { status: "indeterminate", message: "Rollback write is indeterminate." }; }
    try { current = tcSnapshot(preflight.document, target, params.targetUuid, false); }
    catch (verifyError) { return { status: "indeterminate", message: "Rollback verification is indeterminate." }; }
  }
  state.operationState.rollbackEvidence.restoredSnapshot = current;
  if (!tcSame(current, preflight.before)) return { status: "failed", message: "Rollback did not restore the exact before state." + tcDiffSuffix(params.targetUuid) };
  var layout = null;
  try { layout = tcLayout(target); } catch (layoutError) { layout = null; }
  if (layout === null || !tcSame(layout, preflight.layoutBefore)) {
    return { status: "indeterminate", message: "Rollback restored the state but the line layout is not the one read before the change." };
  }
  return { status: "verified" };
}
`;
