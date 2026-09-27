import { z } from 'zod';
export const TRANSFORM_TEXT_MAX_CHARACTERS = 512;
export const TRANSFORM_TEXT_MAX_EVIDENCE_UNITS = 16_384;
const point = z.tuple([z.number().finite(), z.number().finite()]);
export const transformTextFrameSchema = z.strictObject({
    kind: z.enum(['point', 'area']),
    orientation: z.enum(['horizontal', 'vertical']),
    characterCount: z.number().int().min(1).max(TRANSFORM_TEXT_MAX_CHARACTERS),
    anchor: point.nullable(),
    matrixTranslation: point,
    attributes: z.string().min(2).max(TRANSFORM_TEXT_MAX_EVIDENCE_UNITS),
}).superRefine((value, context) => {
    if ((value.kind === 'point') !== (value.anchor !== null)) {
        context.addIssue({ code: 'custom', message: 'Only point text carries an anchor.' });
    }
});
export function translateTextFrame(frame, dx, dy) {
    const n = (value) => Number(value.toFixed(12)) || 0;
    const p = (value) => [n(value[0] + dx), n(value[1] + dy)];
    return { ...frame, anchor: frame.anchor === null ? null : p(frame.anchor), matrixTranslation: p(frame.matrixTranslation) };
}
export function textFrameMatches(a, b) {
    if (a === undefined || b === undefined)
        return a === b;
    const near = (x, y) => Math.abs(x[0] - y[0]) <= 0.01 && Math.abs(x[1] - y[1]) <= 0.01;
    return a.kind === b.kind && a.orientation === b.orientation && a.characterCount === b.characterCount &&
        a.attributes === b.attributes && (a.anchor === null) === (b.anchor === null) &&
        (a.anchor === null || near(a.anchor, b.anchor)) && near(a.matrixTranslation, b.matrixTranslation);
}
export const TRANSFORM_TEXT_SCRIPT = `
var TRANSFORM_TEXT_MAX_CHARACTERS = ${TRANSFORM_TEXT_MAX_CHARACTERS};
var TRANSFORM_TEXT_MAX_EVIDENCE_UNITS = ${TRANSFORM_TEXT_MAX_EVIDENCE_UNITS};
function transformTextFrameEvidence(target) {
  function paint(color) {
    var t = String(color.typename);
    if (t === "RGBColor") return [t, color.red, color.green, color.blue];
    if (t === "CMYKColor") return [t, color.cyan, color.magenta, color.yellow, color.black];
    if (t === "GrayColor") return [t, color.gray];
    if (t === "NoColor") return [t];
    throw mutationError("preflight_failed", "Text translation contains unsupported character paint: " + t);
  }
  var kind = String(target.kind), orientation = String(target.orientation);
  if (kind !== "TextType.POINTTEXT" && kind !== "TextType.AREATEXT") {
    throw mutationError("preflight_failed", "Text translation supports point and area text only; path text is unsupported.");
  }
  if (orientation !== "TextOrientation.HORIZONTAL" && orientation !== "TextOrientation.VERTICAL") {
    throw mutationError("preflight_failed", "Text orientation is unreadable.");
  }
  if (!target.layer || target.parent !== target.layer) {
    throw mutationError("preflight_failed", "The translated text frame must be directly on a layer.");
  }
  var story = target.story;
  if (!story || !story.textFrames || story.textFrames.length !== 1 || story.textFrames[0] !== target) {
    throw mutationError("preflight_failed", "Threaded text frames are outside text translation support.");
  }
  var chars = target.characters;
  if (chars.length < 1 || chars.length > TRANSFORM_TEXT_MAX_CHARACTERS) {
    throw mutationError("preflight_failed", "Text translation supports 1 to " + TRANSFORM_TEXT_MAX_CHARACTERS + " characters.");
  }
  var matrix = target.matrix;
  var attrs = {contents:String(target.contents),matrix:[matrix.mValueA,matrix.mValueB,matrix.mValueC,matrix.mValueD],
    lines:[],runs:[],paragraphs:[]};
  var lines = target.lines;
  for (var l = 0; l < lines.length; l++) attrs.lines.push(String(lines[l].contents));
  var previous = null;
  for (var i = 0; i < chars.length; i++) {var ca = chars[i].characterAttributes;var font = ca.textFont;
    var style = stringifyJson({font:String(font.name),size:ca.size,tracking:ca.tracking,
      horizontalScale:ca.horizontalScale,verticalScale:ca.verticalScale,baselineShift:ca.baselineShift,rotation:ca.rotation,
      autoLeading:ca.autoLeading,leading:ca.leading,fill:paint(ca.fillColor),stroke:paint(ca.strokeColor)});
    if (style === previous) attrs.runs[attrs.runs.length - 1].length++;
    else {attrs.runs.push({length:1,style:style});previous = style;}
  }
  var paragraphs = target.paragraphs;
  for (var p = 0; p < paragraphs.length; p++) attrs.paragraphs.push(String(paragraphs[p].paragraphAttributes.justification));
  if (kind === "TextType.AREATEXT") {
    attrs.area = {columns:target.columnCount,rows:target.rowCount,columnGutter:target.columnGutter,rowGutter:target.rowGutter,spacing:target.spacing};
  }
  var attributes = stringifyJson(attrs);
  if (attributes.length > TRANSFORM_TEXT_MAX_EVIDENCE_UNITS) {
    throw mutationError("preflight_failed", "Text attribute evidence exceeds " + TRANSFORM_TEXT_MAX_EVIDENCE_UNITS + " UTF-16 code units; the frame has too much text or too many distinct character styles.");
  }
  return {kind:kind === "TextType.POINTTEXT" ? "point" : "area",orientation:orientation === "TextOrientation.VERTICAL" ? "vertical" : "horizontal",
    characterCount:chars.length,anchor:kind === "TextType.POINTTEXT" ? transformPoint(target.anchor,"text.anchor") : null,
    matrixTranslation:[transformNumber(matrix.mValueTX,"text.matrixTX"),transformNumber(matrix.mValueTY,"text.matrixTY")],
    attributes:attributes};
}
function transformTranslateTextFrame(frame, dx, dy) {
  function point(p) {return [transformNumber(p[0]+dx,"text.x"),transformNumber(p[1]+dy,"text.y")];}
  return {kind:frame.kind,orientation:frame.orientation,characterCount:frame.characterCount,
    anchor:frame.anchor === null ? null : point(frame.anchor),matrixTranslation:point(frame.matrixTranslation),attributes:frame.attributes};
}
function transformTextFrameMatches(a, b) {
  if (!a || !b) return !a && !b;
  if (a.kind !== b.kind || a.orientation !== b.orientation || a.characterCount !== b.characterCount ||
      a.attributes !== b.attributes || (a.anchor === null) !== (b.anchor === null)) return false;
  if (a.anchor !== null && !transformPointMatches(a.anchor, b.anchor)) return false;
  return transformPointMatches(a.matrixTranslation, b.matrixTranslation);
}
`;
