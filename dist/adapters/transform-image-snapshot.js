import { z } from 'zod';
export const TRANSFORM_IMAGE_LINEAR_TOLERANCE = 1e-6;
const finite = z.number().finite();
export const transformImageSchema = z.strictObject({
    kind: z.enum(['linked', 'embedded']),
    parent: z.enum(['layer', 'group']),
    filePath: z.string().min(1).max(4_096).nullable(),
    intrinsicSize: z.tuple([finite.positive(), finite.positive()]),
    linear: z.tuple([finite, finite, finite, finite]),
}).superRefine((value, context) => {
    if ((value.kind === 'linked') !== (value.filePath !== null)) {
        context.addIssue({ code: 'custom', message: 'Only a linked image carries a file path, and it requires one.' });
    }
});
const canonical = (value) => Number(value.toFixed(12)) || 0;
function documentLinear(image) {
    const [a, b, c, d] = image.linear;
    return image.kind === 'linked' ? [a, -b, c, -d] : [a, b, c, d];
}
function fromDocumentLinear(kind, linear) {
    const [a, b, c, d] = linear.map(canonical);
    return kind === 'linked' ? [a, canonical(-b), c, canonical(-d)] : [a, b, c, d];
}
export function imageCorners(image, bounds) {
    const [a, b, c, d] = documentLinear(image);
    const [w, h] = image.intrinsicSize;
    const cx = (bounds[0] + bounds[2]) / 2;
    const cy = (bounds[1] + bounds[3]) / 2;
    const u = [a * w / 2, b * w / 2];
    const v = [c * h / 2, d * h / 2];
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sv]) => [cx + su * u[0] + sv * v[0], cy + su * u[1] + sv * v[1]]);
}
export function cornerBounds(points) {
    return [
        canonical(Math.min(...points.map((p) => p[0]))), canonical(Math.max(...points.map((p) => p[1]))),
        canonical(Math.max(...points.map((p) => p[0]))), canonical(Math.min(...points.map((p) => p[1]))),
    ];
}
export function imageModelMatches(image, bounds, tolerance) {
    const modelled = cornerBounds(imageCorners(image, bounds));
    return modelled.every((value, index) => Math.abs(value - bounds[index]) <= tolerance);
}
export function scaleImage(image, factor) {
    return { ...image, linear: image.linear.map((value) => canonical(value * factor)) };
}
export function rotateImage(image, bounds, degrees) {
    const radians = degrees * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const cx = (bounds[0] + bounds[2]) / 2;
    const cy = (bounds[1] + bounds[3]) / 2;
    const rotated = imageCorners(image, bounds).map(([x, y]) => [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos]);
    const [a, b, c, d] = documentLinear(image);
    return {
        bounds: cornerBounds(rotated),
        image: { ...image, linear: fromDocumentLinear(image.kind, [a * cos - b * sin, a * sin + b * cos, c * cos - d * sin, c * sin + d * cos]) },
    };
}
export function imageMatches(left, right) {
    if (left === undefined || right === undefined)
        return left === right;
    return left.kind === right.kind && left.parent === right.parent && left.filePath === right.filePath &&
        left.intrinsicSize.every((value, index) => Math.abs(value - right.intrinsicSize[index]) <= TRANSFORM_IMAGE_LINEAR_TOLERANCE) &&
        left.linear.every((value, index) => Math.abs(value - right.linear[index]) <= TRANSFORM_IMAGE_LINEAR_TOLERANCE);
}
export const TRANSFORM_IMAGE_SCRIPT = `
var TRANSFORM_IMAGE_LINEAR_TOLERANCE = ${TRANSFORM_IMAGE_LINEAR_TOLERANCE};
function transformImageFind(document, uuid) {
  var collections = [document.placedItems, document.rasterItems], found = null;
  for (var c = 0; c < collections.length; c++) {
    var items = collections[c];
    if (items === undefined) continue;
    if (!items || typeof items.length !== "number") throw mutationError("preflight_failed", "Image collections are unavailable.");
    for (var index = 0; index < items.length; index++) {
      if (String(items[index].uuid) !== uuid) continue;
      if (found !== null) throw mutationError("preflight_failed", "Image native UUID is not unique.");
      found = items[index];
    }
  }
  return found;
}
function transformImageEvidence(target) {
  var typename = String(target.typename);
  var parent = target.parent, parentType = String(parent.typename);
  if (parentType === "GroupItem") {
    if (parent.clipped === true || String(parent.parent.typename) !== "Layer") {
      throw mutationError("preflight_failed", "Image transform supports images directly on a layer or in one unclipped group on a layer.");
    }
  } else if (parentType !== "Layer") {
    throw mutationError("preflight_failed", "Image transform supports images directly on a layer or in one unclipped group on a layer.");
  }
  var filePath = null;
  if (typename === "PlacedItem") {
    try { filePath = String(target.file.fsName); } catch (fileError) { throw mutationError("preflight_failed", "The linked image has no readable file; relink it first."); }
    if (filePath.length === 0) throw mutationError("preflight_failed", "The linked image has no readable file; relink it first.");
  }
  var box = target.boundingBox, m = target.matrix;
  if (!box || box.length !== 4 || !m) throw mutationError("preflight_failed", "Image intrinsic bounds or matrix are unavailable.");
  var width = transformNumber(Math.abs(box[2] - box[0]), "image.width"), height = transformNumber(Math.abs(box[1] - box[3]), "image.height");
  if (!(width > 0) || !(height > 0)) throw mutationError("preflight_failed", "Image intrinsic size is degenerate.");
  return { kind: typename === "PlacedItem" ? "linked" : "embedded", parent: parentType === "Layer" ? "layer" : "group", filePath: filePath,
    intrinsicSize: [width, height],
    linear: [transformNumber(m.mValueA, "matrix.a"), transformNumber(m.mValueB, "matrix.b"), transformNumber(m.mValueC, "matrix.c"), transformNumber(m.mValueD, "matrix.d")] };
}
function transformImageMatches(left, right) {
  if (!left || !right) return !left && !right;
  if (left.kind !== right.kind || left.parent !== right.parent || left.filePath !== right.filePath) return false;
  for (var i = 0; i < 2; i++) if (Math.abs(left.intrinsicSize[i] - right.intrinsicSize[i]) > TRANSFORM_IMAGE_LINEAR_TOLERANCE) return false;
  for (var j = 0; j < 4; j++) if (Math.abs(left.linear[j] - right.linear[j]) > TRANSFORM_IMAGE_LINEAR_TOLERANCE) return false;
  return true;
}
function transformImageDocumentLinear(image) {
  var l = image.linear;
  return image.kind === "linked" ? [l[0], -l[1], l[2], -l[3]] : [l[0], l[1], l[2], l[3]];
}
function transformImageCorners(image, bounds) {
  var l = transformImageDocumentLinear(image), w = image.intrinsicSize[0], h = image.intrinsicSize[1];
  var cx = (bounds[0] + bounds[2]) / 2, cy = (bounds[1] + bounds[3]) / 2;
  var u = [l[0] * w / 2, l[1] * w / 2], v = [l[2] * h / 2, l[3] * h / 2];
  return [[cx - u[0] - v[0], cy - u[1] - v[1]], [cx + u[0] - v[0], cy + u[1] - v[1]], [cx + u[0] + v[0], cy + u[1] + v[1]], [cx - u[0] + v[0], cy - u[1] + v[1]]];
}
function transformImageBox(points, name) {
  var left = points[0][0], top = points[0][1], right = points[0][0], bottom = points[0][1];
  for (var i = 1; i < points.length; i++) {
    left = Math.min(left, points[i][0]); right = Math.max(right, points[i][0]);
    top = Math.max(top, points[i][1]); bottom = Math.min(bottom, points[i][1]);
  }
  return [transformNumber(left, name + ".left"), transformNumber(top, name + ".top"), transformNumber(right, name + ".right"), transformNumber(bottom, name + ".bottom")];
}
function transformImageRequireModel(before) {
  var modelled = transformImageBox(transformImageCorners(before.image, before.geometricBounds), "image.model");
  for (var i = 0; i < 4; i++) {
    if (Math.abs(modelled[i] - before.geometricBounds[i]) > TRANSFORM_TOLERANCE_PT) {
      throw mutationError("preflight_failed", "Image bounds do not match its matrix; scale and rotation are unsupported for this image.");
    }
  }
}
function transformImageWith(before, bounds, linear) {
  var snapshot = {};
  for (var key in before) if (before.hasOwnProperty(key)) snapshot[key] = before[key];
  snapshot.geometricBounds = bounds;
  snapshot.position = [bounds[0], bounds[1]];
  snapshot.image = { kind: before.image.kind, parent: before.image.parent, filePath: before.image.filePath,
    intrinsicSize: before.image.intrinsicSize, linear: linear };
  return snapshot;
}
function transformImageScale(before, factor) {
  transformImageRequireModel(before);
  var b = before.geometricBounds, cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, l = before.image.linear;
  return transformImageWith(before, [
    transformNumber(cx + (b[0] - cx) * factor, "after.left"), transformNumber(cy + (b[1] - cy) * factor, "after.top"),
    transformNumber(cx + (b[2] - cx) * factor, "after.right"), transformNumber(cy + (b[3] - cy) * factor, "after.bottom")
  ], [transformNumber(l[0] * factor, "after.a"), transformNumber(l[1] * factor, "after.b"), transformNumber(l[2] * factor, "after.c"), transformNumber(l[3] * factor, "after.d")]);
}
function transformImageRotate(before, angleDegrees) {
  transformImageRequireModel(before);
  var b = before.geometricBounds, cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
  var radians = angleDegrees * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians);
  var corners = transformImageCorners(before.image, b), rotated = [];
  for (var i = 0; i < corners.length; i++) {
    var dx = corners[i][0] - cx, dy = corners[i][1] - cy;
    rotated.push([cx + dx * cosine - dy * sine, cy + dx * sine + dy * cosine]);
  }
  var d = transformImageDocumentLinear(before.image);
  var r = [d[0] * cosine - d[1] * sine, d[0] * sine + d[1] * cosine, d[2] * cosine - d[3] * sine, d[2] * sine + d[3] * cosine];
  if (before.image.kind === "linked") { r[1] = -r[1]; r[3] = -r[3]; }
  return transformImageWith(before, transformImageBox(rotated, "rotation"),
    [transformNumber(r[0], "rotation.a"), transformNumber(r[1], "rotation.b"), transformNumber(r[2], "rotation.c"), transformNumber(r[3], "rotation.d")]);
}
`;
