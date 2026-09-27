export const PLACE_FIT_PRECISION_DIGITS = 6;
export const PLACE_FIT_MIN_PT = 0.01;
export const PLACE_FIT_MAX_PT = 16_383;
export const FIT_ALIGN_NAMES = ['center', 'thirds_top_left', 'thirds_top_right', 'thirds_bottom_left', 'thirds_bottom_right'];
export function fitAlignment(value = 'center') {
    if (typeof value !== 'string')
        return value;
    if (value === 'center')
        return { x: 0.5, y: 0.5 };
    return { x: value.endsWith('_left') ? 1 / 3 : 2 / 3, y: value.startsWith('thirds_top_') ? 1 / 3 : 2 / 3 };
}
export function fitComposition(size, request, focalPoint = { x: 0.5, y: 0.5 }, alignTo = 'center') {
    if (request.fit !== 'contain' && request.fit !== 'cover')
        throw new Error('Composition requires contain or cover.');
    const align = fitAlignment(alignTo);
    const remaining = [round(request.width - size.width), round(request.height - size.height)];
    const requestedOffset = [round(request.width * align.x - size.width * focalPoint.x), round(request.height * align.y - size.height * focalPoint.y)];
    const effectiveOffset = requestedOffset.map((value, i) => round(Math.max(Math.min(0, remaining[i]), Math.min(Math.max(0, remaining[i]), value))));
    return { requestedOffset, effectiveOffset, clamp: effectiveOffset.map((value, i) => round(value - requestedOffset[i])) };
}
const round = (value) => Number(value.toFixed(PLACE_FIT_PRECISION_DIGITS)) || 0;
export function fitPlacedSize(pixels, request) {
    const { width: pw, height: ph } = pixels;
    let width;
    let height;
    if (request.fit === 'width') {
        width = request.width;
        height = request.width * ph / pw;
    }
    else if (request.fit === 'height') {
        height = request.height;
        width = request.height * pw / ph;
    }
    else if (request.fit === 'stretch') {
        width = request.width;
        height = request.height;
    }
    else {
        const pick = request.fit === 'contain' ? Math.min : Math.max;
        const scale = pick(request.width / pw, request.height / ph);
        width = pw * scale;
        height = ph * scale;
    }
    const boxed = request.fit === 'contain' || request.fit === 'cover';
    return {
        width: round(width),
        height: round(height),
        offset: boxed ? [round((request.width - width) / 2), round((request.height - height) / 2)] : [0, 0],
    };
}
export function placedSizeInRange(size) {
    return [size.width, size.height].every((value) => Number.isFinite(value) && value >= PLACE_FIT_MIN_PT && value <= PLACE_FIT_MAX_PT);
}
export function placedEffectivePpi(pixels, size) {
    return { x: round(pixels.width * 72 / size.width), y: round(pixels.height * 72 / size.height) };
}
export function checkEffectivePpi(ppi, minimum) {
    if (ppi === null)
        return { status: 'unknown', failingAxes: [] };
    const failingAxes = ['x', 'y'].filter((axis) => ppi[axis] < minimum);
    return { status: failingAxes.length === 0 ? 'meets' : 'below', failingAxes };
}
export const PLACE_FIT_SCRIPT = `
var PLACE_FIT_PRECISION_DIGITS = ${PLACE_FIT_PRECISION_DIGITS};
var PLACE_FIT_MIN_PT = ${PLACE_FIT_MIN_PT};
var PLACE_FIT_MAX_PT = ${PLACE_FIT_MAX_PT};
function placeFitRound(value) { var rounded = Number(value.toFixed(PLACE_FIT_PRECISION_DIGITS)); return rounded === 0 ? 0 : rounded; }
function placeFitSize(pixels, request) {
  var pw = pixels.width, ph = pixels.height, width, height;
  if (request.fit === "width") { width = request.width; height = request.width * ph / pw; }
  else if (request.fit === "height") { height = request.height; width = request.height * pw / ph; }
  else if (request.fit === "stretch") { width = request.width; height = request.height; }
  else {
    var scale = request.fit === "contain" ? Math.min(request.width / pw, request.height / ph) : Math.max(request.width / pw, request.height / ph);
    width = pw * scale; height = ph * scale;
  }
  var boxed = request.fit === "contain" || request.fit === "cover";
  return { width: placeFitRound(width), height: placeFitRound(height),
    offset: boxed ? [placeFitRound((request.width - width) / 2), placeFitRound((request.height - height) / 2)] : [0, 0] };
}
function placeFitAlignment(value) {
  if (value === undefined || value === "center") return { x: 0.5, y: 0.5 };
  if (typeof value !== "string") return value;
  var points = { thirds_top_left: [1/3,1/3], thirds_top_right: [2/3,1/3], thirds_bottom_left: [1/3,2/3], thirds_bottom_right: [2/3,2/3] };
  if (!points.hasOwnProperty(value)) throw new Error("Invalid align_to.");
  return { x: points[value][0], y: points[value][1] };
}
function placeFitComposition(size, request, focalPoint, alignTo) {
  if (request.fit !== "contain" && request.fit !== "cover") throw new Error("Composition requires contain or cover.");
  var focal = focalPoint || { x: 0.5, y: 0.5 }, align = placeFitAlignment(alignTo);
  var remaining = [placeFitRound(request.width-size.width),placeFitRound(request.height-size.height)];
  var requested = [placeFitRound(request.width*align.x-size.width*focal.x),placeFitRound(request.height*align.y-size.height*focal.y)];
  var effective = [], delta = [];
  for (var i=0;i<2;i++) {
    effective.push(placeFitRound(Math.max(Math.min(0,remaining[i]),Math.min(Math.max(0,remaining[i]),requested[i]))));
    delta.push(placeFitRound(effective[i]-requested[i]));
  }
  return { requestedOffset: requested, effectiveOffset: effective, clamp: delta };
}
function placeFitInRange(size) {
  return size.width >= PLACE_FIT_MIN_PT && size.width <= PLACE_FIT_MAX_PT && size.height >= PLACE_FIT_MIN_PT && size.height <= PLACE_FIT_MAX_PT;
}
function placeFitPpi(pixels, size) {
  return { x: placeFitRound(pixels.width * 72 / size.width), y: placeFitRound(pixels.height * 72 / size.height) };
}
function placeFitCheck(ppi, minimum) {
  if (ppi === null) return { status: "unknown", failingAxes: [] };
  var failing = [];
  if (ppi.x < minimum) failing.push("x");
  if (ppi.y < minimum) failing.push("y");
  return { status: failing.length === 0 ? "meets" : "below", failingAxes: failing };
}
`;
