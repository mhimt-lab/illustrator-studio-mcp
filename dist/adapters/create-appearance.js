import { z } from 'zod';
import { cmykColorSchema, grayColorSchema, rgbColorSchema, rgbPathColorSchema, requestedStrokeWidthSchema, SET_PATH_APPEARANCE_MODULE_SCRIPT, strokeWidthMatches, } from './set-path-appearance-adapter.js';
const PROCESS_COLOR_ONLY = 'Initial appearance accepts only rgb, cmyk, or gray colors; set a spot or gradient color with illustrator_set_path_appearance after creating the object.';
const CREATION_COLOR_DESCRIPTION = 'rgb (0-255), cmyk or gray (0-100), matching the document color space (gray fits both).';
const creationColorSchema = z.discriminatedUnion('model', [rgbPathColorSchema, cmykColorSchema, grayColorSchema], { error: PROCESS_COLOR_ONLY })
    .describe(CREATION_COLOR_DESCRIPTION);
const creationColorStateSchema = z.discriminatedUnion('model', [rgbColorSchema, cmykColorSchema, grayColorSchema], { error: PROCESS_COLOR_ONLY })
    .describe(CREATION_COLOR_DESCRIPTION);
export const creationAppearanceSchema = z.strictObject({
    opacity: z.number().finite().min(0).max(100),
    fill: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('none') }),
        z.strictObject({ kind: z.literal('solid'), color: creationColorSchema }),
    ]),
    stroke: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('none') }),
        z.strictObject({ kind: z.literal('solid'), color: creationColorSchema, width: requestedStrokeWidthSchema }),
    ]),
}).describe('Optional initial appearance set and verified in the same apply. Without it the path keeps Illustrator\'s current default fill and stroke.');
const noneColorSchema = z.strictObject({ model: z.literal('none') });
export const creationAppearanceStateSchema = z.strictObject({
    opacity: z.number().finite().min(0).max(100),
    fill: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('none'), color: noneColorSchema }),
        z.strictObject({ kind: z.literal('solid'), color: creationColorStateSchema }),
    ]),
    stroke: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('none'), color: noneColorSchema, width: z.number().finite().min(0).max(10_000) }),
        z.strictObject({ kind: z.literal('solid'), color: creationColorStateSchema, width: z.number().finite().positive().max(10_000) }),
    ]),
});
function sameColor(left, right) {
    if (left.model === 'rgb' && right.model === 'rgb')
        return left.red === right.red && left.green === right.green && left.blue === right.blue;
    if (left.model === 'cmyk' && right.model === 'cmyk') {
        return left.cyan === right.cyan && left.magenta === right.magenta && left.yellow === right.yellow && left.black === right.black;
    }
    if (left.model === 'gray' && right.model === 'gray')
        return left.gray === right.gray;
    return false;
}
export function creationAppearanceMatches(request, state) {
    if (request.opacity !== state.opacity || request.fill.kind !== state.fill.kind || request.stroke.kind !== state.stroke.kind)
        return false;
    if (request.fill.kind === 'none' && state.fill.color.model !== 'none')
        return false;
    if (request.stroke.kind === 'none' && state.stroke.color.model !== 'none')
        return false;
    if (request.fill.kind === 'solid' && !sameColor(request.fill.color, state.fill.color))
        return false;
    if (request.stroke.kind === 'solid') {
        const stroke = state.stroke;
        if (!sameColor(request.stroke.color, stroke.color) || !strokeWidthMatches(request.stroke.width, stroke.width))
            return false;
    }
    return true;
}
export const CREATION_APPEARANCE_MODULE_SCRIPT = `${SET_PATH_APPEARANCE_MODULE_SCRIPT}
function creationAppearanceProcessColor(color) {
  return color.model === "none" || color.model === "rgb" || color.model === "cmyk" || color.model === "gray";
}

function creationAppearanceValidate(document, context, value) {
  appearanceValidateDesired(value, context.colorSpace, document);
  if ((value.fill.kind === "solid" && !creationAppearanceProcessColor(value.fill.color)) ||
      (value.stroke.kind === "solid" && !creationAppearanceProcessColor(value.stroke.color))) {
    throw mutationError("preflight_failed", "Initial appearance accepts only rgb, cmyk, or gray colors.");
  }
}

function creationAppearanceApply(document, item, value) {
  var before;
  try { before = { stroke: { width: appearanceNumber(item.strokeWidth, "strokeWidth", 0, 10000) } }; }
  catch (readError) { throw mutationError("apply_failed", "The new path's default stroke width could not be read."); }
  var desired = appearanceDesiredState(value, before);
  appearanceWrite(document, item, desired);
  return desired;
}

/** #1007 / #974: an off stroke has no comparable width; keep the actual read-back unchanged in the result. */
function creationAppearanceComparable(state) {
  if (state.stroke.kind !== "none") return state;
  return { opacity: state.opacity, fill: state.fill, stroke: { kind: state.stroke.kind, color: state.stroke.color } };
}

function creationAppearanceVerify(item, desired) {
  var actual = appearanceRead(item);
  var comparedActual = creationAppearanceComparable(actual), comparedDesired = creationAppearanceComparable(desired);
  if (!appearanceEqual(comparedActual, comparedDesired)) {
    throw mutationError("verify_mismatch", "The created path's appearance does not match the request at " + appearanceMismatch(comparedActual, comparedDesired) + ".");
  }
  return actual;
}
`;
