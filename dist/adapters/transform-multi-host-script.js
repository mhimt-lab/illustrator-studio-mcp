export const TRANSFORM_MULTI_MIN_TARGETS = 1;
export const TRANSFORM_MULTI_MAX_TARGETS = 16;
export const TRANSFORM_MULTI_MAX_ROWS = 128;
export const TRANSFORM_MULTI_MAX_POINTS = 2048;
export const TRANSFORM_MULTI_MAX_GRADIENT_PAINTS = 32;
export const TRANSFORM_MULTI_GRADIENT_MATRIX_TOLERANCE = 0.00001;
export const TRANSFORM_MULTI_GEOMETRY_TOLERANCE_PT = 0.01;
export const TRANSFORM_MULTI_LINEAR_TOLERANCE = 0.00001;
export const TRANSFORM_MULTI_MARGIN_TOLERANCE_PT = 0.5;
export function transformMultiGradientTolerance(factor) {
    return Math.max(factor, 1) * TRANSFORM_MULTI_GEOMETRY_TOLERANCE_PT;
}
export const TRANSFORM_MULTI_BLOCKER_ORDER = [
    'document_mutation_not_allowed', 'target_locked', 'target_hidden', 'target_not_editable', 'layer_hidden', 'layer_locked',
    'ancestor_hidden', 'ancestor_locked',
];
export const TRANSFORM_MULTI_MODULE_SCRIPT = `var TM_MIN_TARGETS = ${TRANSFORM_MULTI_MIN_TARGETS};
var TM_MAX_TARGETS = ${TRANSFORM_MULTI_MAX_TARGETS};
var TM_MAX_ROWS = ${TRANSFORM_MULTI_MAX_ROWS};
var TM_MAX_POINTS = ${TRANSFORM_MULTI_MAX_POINTS};
var TM_MAX_GRADIENT_PAINTS = ${TRANSFORM_MULTI_MAX_GRADIENT_PAINTS};
var TM_GRADIENT_MATRIX_TOL = ${TRANSFORM_MULTI_GRADIENT_MATRIX_TOLERANCE};
var TM_GEOMETRY_TOL = ${TRANSFORM_MULTI_GEOMETRY_TOLERANCE_PT};
var TM_LINEAR_TOL = ${TRANSFORM_MULTI_LINEAR_TOLERANCE};
var TM_MARGIN_TOL = ${TRANSFORM_MULTI_MARGIN_TOLERANCE_PT};
var TM_BLOCKER_ORDER = ${JSON.stringify(TRANSFORM_MULTI_BLOCKER_ORDER)};

function tmRound(value, name) {
  var rounded = Number(mutationFiniteNumber(value, name).toFixed(6));
  return rounded === 0 ? 0 : rounded;
}
function tmPoint(value, name) {
  if (!value || value.length !== 2) throw mutationError("preflight_failed", name + " is unavailable.");
  return [tmRound(value[0], name + "[0]"), tmRound(value[1], name + "[1]")];
}
function tmBox(value, name) {
  if (!value || value.length !== 4) throw mutationError("preflight_failed", name + " is unavailable.");
  return [tmRound(value[0], name + ".left"), tmRound(value[1], name + ".top"), tmRound(value[2], name + ".right"), tmRound(value[3], name + ".bottom")];
}
function tmCenter(box) { return [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]; }
function tmUnion(boxes) {
  var out = [boxes[0][0], boxes[0][1], boxes[0][2], boxes[0][3]];
  for (var i = 1; i < boxes.length; i++) {
    out[0] = Math.min(out[0], boxes[i][0]); out[1] = Math.max(out[1], boxes[i][1]);
    out[2] = Math.max(out[2], boxes[i][2]); out[3] = Math.min(out[3], boxes[i][3]);
  }
  return out;
}
/**
 * What a designer sees as the object's box: a clipped group is its mask, any other group the union of what its members show, a leaf its
 * bounds. Illustrator's own CENTER is the centre of the unclipped union (measured), so a clipped group is moved to turn about its mask.
 */
function tmVisualBox(rows, index) {
  var row = rows[index], boxes = [], k;
  if (row.type !== "GroupItem") return row.bounds;
  for (k = index + 1; k < rows.length; k++) {
    if (rows[k].parentUuid !== row.uuid) continue;
    if (row.attrs.clipped === true && rows[k].type === "PathItem" && rows[k].attrs.clip === true) return rows[k].bounds;
    boxes.push(tmVisualBox(rows, k));
  }
  return boxes.length > 0 ? tmUnion(boxes) : row.bounds;
}
function tmBoxOfPoints(points) {
  var out = [points[0][0], points[0][1], points[0][0], points[0][1]];
  for (var i = 1; i < points.length; i++) {
    out[0] = Math.min(out[0], points[i][0]); out[1] = Math.max(out[1], points[i][1]);
    out[2] = Math.max(out[2], points[i][0]); out[3] = Math.min(out[3], points[i][1]);
  }
  return out;
}
function tmMapPoint(m, p) { return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]; }
function tmCompose(second, first) {
  return [second[0] * first[0] + second[2] * first[1], second[1] * first[0] + second[3] * first[1],
    second[0] * first[2] + second[2] * first[3], second[1] * first[2] + second[3] * first[3],
    second[0] * first[4] + second[2] * first[5] + second[4], second[1] * first[4] + second[3] * first[5] + second[5]];
}
function tmTranslation(dx, dy) { return [1, 0, 0, 1, dx, dy]; }
function tmScaleAbout(factor, p) { return [factor, 0, 0, factor, p[0] * (1 - factor), p[1] * (1 - factor)]; }
function tmRotateAbout(degrees, p) {
  var radians = degrees * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
  return [c, s, -s, c, p[0] - c * p[0] + s * p[1], p[1] - s * p[0] - c * p[1]];
}
/** Exact bounds of a Bezier path read as [anchor, left, right] triples: the segment end points and the roots of the derivative. */
function tmPathBox(points, closed) {
  var samples = [points[0][0]];
  var segments = closed ? points.length : points.length - 1;
  for (var s = 0; s < segments; s++) {
    var p0 = points[s][0], p1 = points[s][2], p2 = points[(s + 1) % points.length][1], p3 = points[(s + 1) % points.length][0];
    samples.push(p3);
    for (var axis = 0; axis < 2; axis++) {
      var a = p1[axis] - p0[axis], b = p2[axis] - p1[axis], c = p3[axis] - p2[axis];
      var qa = a - 2 * b + c, qb = 2 * (b - a), qc = a, roots = [];
      if (Math.abs(qa) < 1e-12) { if (Math.abs(qb) > 1e-12) roots.push(-qc / qb); }
      else {
        var disc = qb * qb - 4 * qa * qc;
        if (disc >= 0) { var root = Math.sqrt(disc); roots.push((-qb + root) / (2 * qa)); roots.push((-qb - root) / (2 * qa)); }
      }
      for (var r = 0; r < roots.length; r++) {
        var t = roots[r];
        if (t > 0 && t < 1) {
          var u = 1 - t;
          samples.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
        }
      }
    }
  }
  return tmBoxOfPoints(samples);
}
function tmClone(value) { return parseJsonValue(stringifyJson(value)); }

function tmPaint(color, label) {
  var type = String(color.typename);
  if (type === "CMYKColor") return { t: "cmyk", v: [tmRound(color.cyan, label), tmRound(color.magenta, label), tmRound(color.yellow, label), tmRound(color.black, label)] };
  if (type === "RGBColor") return { t: "rgb", v: [tmRound(color.red, label), tmRound(color.green, label), tmRound(color.blue, label)] };
  if (type === "GrayColor") return { t: "gray", v: [tmRound(color.gray, label)] };
  if (type === "NoColor") return { t: "none" };
  if (type === "GradientColor") {
    var gradientType = null;
    if (String(color.gradient.type) === "GradientType.LINEAR") gradientType = "linear";
    else if (String(color.gradient.type) === "GradientType.RADIAL") gradientType = "radial";
    var gradientMatrix = color.matrix;
    if (gradientType === null || !gradientMatrix) throw mutationError("preflight_failed", label + ": the gradient type or matrix is unavailable.");
    return { t: "gradient", name: String(color.gradient.name), gradientType: gradientType, origin: tmPoint(color.origin, label + ".origin"), length: tmRound(color.length, label + ".length"),
      gm: [tmRound(gradientMatrix.mValueA, label + ".gm"), tmRound(gradientMatrix.mValueB, label + ".gm"), tmRound(gradientMatrix.mValueC, label + ".gm"), tmRound(gradientMatrix.mValueD, label + ".gm")] };
  }
  if (type === "PatternColor") {
    var matrix = color.matrix;
    return { t: "pattern", name: String(color.pattern.name), m: [tmRound(matrix.mValueA, label), tmRound(matrix.mValueB, label), tmRound(matrix.mValueC, label),
      tmRound(matrix.mValueD, label), tmRound(matrix.mValueTX, label), tmRound(matrix.mValueTY, label)] };
  }
  var unmeasured = mutationError("preflight_failed", "Transform supports CMYK, RGB, gray, gradient and pattern paint only; found " + type + ".");
  unmeasured.tmCode = "target_transform_unmeasured";
  throw unmeasured;
}
function tmIsChildOf(item, parent) {
  var holder = item.parent;
  return String(holder.typename) === "GroupItem" && String(holder.uuid) === String(parent.uuid);
}

/** The rows of one target: the target first, then its descendants in order. Every unsupported thing is refused with its reason. */
function tmRows(target, mode, enclosingBlocked) {
  var rows = [], seen = {}, points = 0, characters = 0;
  function bad(code, message) { var refused = mutationError("preflight_failed", message); refused.tmCode = code; throw refused; }
  function visit(item, parentUuid, depth) {
    if (depth > 8 || rows.length >= TM_MAX_ROWS) bad("target_set_too_large", "The target holds more than " + TM_MAX_ROWS + " objects or nests deeper than 8 levels.");
    var type = String(item.typename), uuid = item.uuid;
    if (typeof uuid !== "string" || uuid.length === 0 || seen.hasOwnProperty(uuid)) bad("unsupported_target_type", "A descendant native UUID is missing or duplicated.");
    seen[uuid] = true;
    if (depth > 0 && (item.locked !== false || item.hidden !== false || (!enclosingBlocked && item.editable !== true))) {
      bad("descendant_locked_or_hidden", "Every object inside the target must be visible, unlocked and editable.");
    }
    var bounds = tmBox(item.geometricBounds, "bounds"), visible = tmBox(item.visibleBounds, "visibleBounds");
    var row = { uuid: uuid, parentUuid: parentUuid, type: type, name: String(item.name), bounds: bounds, coords: [], attrs: {
      opacity: tmRound(item.opacity, "opacity"), blend: String(item.blendingMode) },
      margin: [tmRound(bounds[0] - visible[0], "margin"), tmRound(visible[1] - bounds[1], "margin"), tmRound(visible[2] - bounds[2], "margin"), tmRound(bounds[3] - visible[3], "margin")] };
    rows.push(row);
    if (type === "GroupItem") {
      row.attrs.clipped = item.clipped === true;
      var members = item.pageItems, direct = 0;
      if (members.length < 1) bad("unsupported_target_type", "An empty group cannot be transformed.");
      for (var i = 0; i < members.length; i++) { if (tmIsChildOf(members[i], item)) { visit(members[i], uuid, depth + 1); direct++; } }
      if (direct < 1) bad("unsupported_target_type", "An empty group cannot be transformed.");
    } else if (type === "PathItem") {
      var path = item.pathPoints;
      if (path.length < 1 || path.length > 256) bad("target_set_too_large", "A path must have 1 to 256 points.");
      points += path.length;
      if (points > TM_MAX_POINTS) bad("target_set_too_large", "The target holds more than " + TM_MAX_POINTS + " path points.");
      if (item.guides === true) bad("unsupported_target_type", "Guides cannot be transformed.");
      for (var p = 0; p < path.length; p++) {
        row.coords.push(tmPoint(path[p].anchor, "anchor"), tmPoint(path[p].leftDirection, "left"), tmPoint(path[p].rightDirection, "right"));
      }
      row.attrs.closed = item.closed === true;
      row.attrs.clip = item.clipping === true;
      row.attrs.filled = item.filled === true;
      row.attrs.stroked = item.stroked === true;
      row.attrs.fill = item.filled ? tmPaint(item.fillColor, "fill") : null;
      row.attrs.stroke = item.stroked ? tmPaint(item.strokeColor, "stroke") : null;
      row.attrs.sw = tmRound(item.strokeWidth, "strokeWidth");
      var dashes = item.strokeDashes, dashValues = [];
      for (var d = 0; d < dashes.length; d++) dashValues.push(tmRound(dashes[d], "dash"));
      row.attrs.dashes = dashValues;
      row.attrs.dashOffset = tmRound(item.strokeDashOffset, "dashOffset");
      row.attrs.cap = String(item.strokeCap); row.attrs.join = String(item.strokeJoin); row.attrs.miter = tmRound(item.strokeMiterLimit, "miter");
      row.attrs.fo = item.fillOverprint === true; row.attrs.so = item.strokeOverprint === true;
    } else if (type === "TextFrame") {
      if (String(item.kind) !== "TextType.POINTTEXT") bad("target_frame_unsupported", "Only point text can be transformed; area and path text are unmeasured.");
      if (String(item.orientation) !== "TextOrientation.HORIZONTAL") bad("target_frame_unsupported", "Only horizontal text can be transformed; vertical text is unmeasured.");
      var story = item.story;
      if (!story || !story.textFrames || story.textFrames.length !== 1) bad("target_frame_unsupported", "Threaded text frames are unmeasured.");
      var chars = item.characters;
      if (chars.length < 1 || (characters += chars.length) > 512) bad("target_set_too_large", "A text frame must hold 1 to 512 characters in total.");
      var runs = [], previous = null;
      for (var c = 0; c < chars.length; c++) {
        var ca = chars[c].characterAttributes, fontName = String(ca.textFont.name);
        var style = { f: fontName, s: tmRound(ca.size, "size"), tr: tmRound(ca.tracking, "tracking"), hs: tmRound(ca.horizontalScale, "hs"), vs: tmRound(ca.verticalScale, "vs"),
          bs: tmRound(ca.baselineShift, "baselineShift"), rot: tmRound(ca.rotation, "rotation"), al: ca.autoLeading === true, ld: tmRound(ca.leading, "leading"),
          fill: tmPaint(ca.fillColor, "text fill"), stroke: tmPaint(ca.strokeColor, "text stroke"), sw: tmRound(ca.strokeWeight, "strokeWeight") };
        if (mode !== "translate" && (style.bs !== 0 || style.rot !== 0)) bad("target_transform_unmeasured", "Scaling or rotating text with a baseline shift or a character rotation is unmeasured.");
        if (style.fill.t === "gradient" || style.fill.t === "pattern" || style.stroke.t === "gradient" || style.stroke.t === "pattern") bad("target_transform_unmeasured", "Text with gradient or pattern paint is unmeasured.");
        if (previous !== null && stringifyJson(style) === stringifyJson(previous)) runs[runs.length - 1].n++;
        else { runs.push({ n: 1, style: style }); previous = style; }
      }
      var matrix = item.matrix;
      row.attrs.kind = "point"; row.attrs.contents = String(item.contents); row.attrs.chars = chars.length; row.attrs.runs = runs;
      row.attrs.matrix = [tmRound(matrix.mValueA, "matrix"), tmRound(matrix.mValueB, "matrix"), tmRound(matrix.mValueC, "matrix"),
        tmRound(matrix.mValueD, "matrix"), tmRound(matrix.mValueTX, "matrix"), tmRound(matrix.mValueTY, "matrix")];
      row.coords.push(tmPoint(item.anchor, "anchor"));
    } else if (type === "PlacedItem" || type === "RasterItem") {
      var box = item.boundingBox, matrixImage = item.matrix;
      if (!box || box.length !== 4 || !matrixImage) bad("unsupported_target_type", "Image intrinsic bounds or matrix are unavailable.");
      var width = Math.abs(box[2] - box[0]), height = Math.abs(box[1] - box[3]);
      if (!(width > 0) || !(height > 0)) bad("unsupported_target_type", "Image intrinsic size is degenerate.");
      if (type === "PlacedItem") {
        var file = null;
        try { file = String(item.file.fsName); } catch (fileError) { file = ""; }
        if (file.length === 0) bad("link_missing", "The linked image has no readable file; relink it first.");
        row.attrs.kind = "linked"; row.attrs.file = file;
      } else {
        if (item.embedded !== true) bad("unsupported_target_type", "Only an embedded RasterItem can be transformed.");
        row.attrs.kind = "embedded";
      }
      row.attrs.size = [tmRound(width, "image.width"), tmRound(height, "image.height")];
      row.attrs.linear = [tmRound(matrixImage.mValueA, "matrix.a"), tmRound(matrixImage.mValueB, "matrix.b"), tmRound(matrixImage.mValueC, "matrix.c"), tmRound(matrixImage.mValueD, "matrix.d")];
    } else {
      bad("unsupported_target_type", "Transform supports PathItem, GroupItem, PlacedItem, RasterItem and point TextFrame only; found " + type + ".");
    }
  }
  visit(target, "", 0);
  return rows;
}

/**
 * P0 (2026-10-14): a rotated text scaled 150% came back with the planned size, leading, anchor and bounds but a different matrix translation, and a
 * translation of such a text is unmeasured too. A text whose matrix is not a plain translation is therefore refused for every operation, when the
 * transform is planned; reading it back after an operation (which may rotate it) is not refused.
 */
function tmRefuseTurnedText(snapshot) {
  for (var i = 0; i < snapshot.rows.length; i++) {
    var row = snapshot.rows[i];
    if (row.type !== "TextFrame") continue;
    var matrix = row.attrs.matrix;
    if (Math.abs(matrix[0] - 1) > 0.0001 || Math.abs(matrix[3] - 1) > 0.0001 || Math.abs(matrix[1]) > 0.0001 || Math.abs(matrix[2]) > 0.0001) {
      var refused = mutationError("preflight_failed", "Text that is already rotated or scaled is unmeasured: Illustrator rewrites the translation of its matrix, so the result cannot be verified.");
      refused.tmCode = "target_transform_unmeasured";
      throw refused;
    }
  }
}

function tmSnapshot(document, target, mode) {
  if (typeof target.uuid !== "string" || target.uuid.length === 0) throw mutationError("preflight_failed", "Target native UUID is unavailable.");
  if (typeof target.locked !== "boolean" || typeof target.hidden !== "boolean" || typeof target.editable !== "boolean" || !target.layer ||
      typeof target.layer.visible !== "boolean" || typeof target.layer.locked !== "boolean") {
    throw mutationError("preflight_failed", "Target safety state is unavailable.");
  }
  if (!target.parent || String(target.parent.typename) !== "Layer") {
    var placed = mutationError("preflight_failed", "Only objects directly on a layer can be transformed together; a group member must be transformed through its group.");
    placed.tmCode = "unsupported_target_position";
    throw placed;
  }
  var layerPath = transformLayerPath(document, target.layer);
  if (layerPath === null) throw mutationError("preflight_failed", "Target layer path is unavailable.");
  var ancestors = mutationAncestorState(target);
  var blocked = target.locked || target.hidden || !target.editable || target.layer.locked || !target.layer.visible || ancestors.ancestorLocked || ancestors.ancestorHidden;
  return { uuid: target.uuid, type: String(target.typename), layerPath: layerPath, locked: target.locked, hidden: target.hidden, editable: target.editable,
    layerVisible: target.layer.visible, layerLocked: target.layer.locked, ancestorLocked: ancestors.ancestorLocked, ancestorHidden: ancestors.ancestorHidden,
    rows: tmRows(target, mode, blocked) };
}

/** A rotation turns the gradient with the object, in the same direction: gm' = R(angle) * gm (measured, J980). */
function tmRotateMatrix(gm, degrees) {
  var radians = degrees * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians);
  return [tmRound(cosine * gm[0] - sine * gm[1], "gm"), tmRound(sine * gm[0] + cosine * gm[1], "gm"),
    tmRound(cosine * gm[2] - sine * gm[3], "gm"), tmRound(sine * gm[2] + cosine * gm[3], "gm")];
}

/** Mapping a snapshot by one native operation: the geometry the operation moves, and the attributes it is measured to change. */
function tmMapRows(rows, op) {
  var out = [], index = {}, i;
  for (i = 0; i < rows.length; i++) {
    var source = rows[i], row = tmClone(source), j;
    if (source.type === "PathItem") {
      var triples = [];
      for (j = 0; j + 2 < source.coords.length; j += 3) triples.push([tmMapPoint(op.m, source.coords[j]), tmMapPoint(op.m, source.coords[j + 1]), tmMapPoint(op.m, source.coords[j + 2])]);
      var coords = [];
      for (j = 0; j < triples.length; j++) coords.push(tmPoint(triples[j][0], "map"), tmPoint(triples[j][1], "map"), tmPoint(triples[j][2], "map"));
      row.coords = coords;
      row.bounds = tmBox(tmPathBox(triples, source.attrs.closed), "map");
      var paints = [row.attrs.fill, row.attrs.stroke];
      for (j = 0; j < 2; j++) {
        if (paints[j] && paints[j].t === "gradient") {
          // The origin is not predicted (nor compared): it stays as read before (see transformMultiGradientTolerance).
          if (op.kind === "scale") {
            // A fill gradient's length multiplies by the factor. A stroke gradient's length is g + m (the extent along the gradient, which scales, and a margin
            // of the line that does not), and a rotation keeps the stored length, so only the range is known: L + (f - 1) * g with 0 <= g <= L (#980 P0).
            if (j === 0) paints[j].length = tmRound(paints[j].length * op.f, "gradient");
            else paints[j].lr = [tmRound(Math.min(paints[j].length, paints[j].length * op.f), "gradient"), tmRound(Math.max(paints[j].length, paints[j].length * op.f), "gradient")];
          } else if (op.kind === "rotate") {
            paints[j].gm = tmRotateMatrix(paints[j].gm, op.angle);
          }
        }
      }
    } else if (source.type === "TextFrame") {
      row.coords = [tmPoint(tmMapPoint(op.m, source.coords[0]), "map")];
      var b = source.bounds, corners = [tmMapPoint(op.m, [b[0], b[1]]), tmMapPoint(op.m, [b[2], b[1]]), tmMapPoint(op.m, [b[2], b[3]]), tmMapPoint(op.m, [b[0], b[3]])];
      row.bounds = tmBox(tmBoxOfPoints(corners), "map");
      if (op.kind === "scale") {
        for (j = 0; j < row.attrs.runs.length; j++) {
          var size = row.attrs.runs[j].style.s * op.f, leading = row.attrs.runs[j].style.ld * op.f;
          // Illustrator's character panel takes sizes of 0.1 to 1296 pt and leading of 0.1 to 5000 pt.
          if (size < 0.1 || size > 1296 || leading < 0.1 || leading > 5000) {
            var range = mutationError("preflight_failed", "Scaling to " + op.percent + "% would make a font size of " + tmRound(size, "size") + " pt and a leading of " + tmRound(leading, "leading") + " pt, outside Illustrator's 0.1-1296 pt and 0.1-5000 pt.");
            range.tmCode = "text_size_out_of_range";
            throw range;
          }
          row.attrs.runs[j].style.s = tmRound(size, "size");
          row.attrs.runs[j].style.ld = tmRound(leading, "leading");
        }
      } else {
        var mapped = tmCompose(op.m, source.attrs.matrix);
        row.attrs.matrix = [tmRound(mapped[0], "matrix"), tmRound(mapped[1], "matrix"), tmRound(mapped[2], "matrix"), tmRound(mapped[3], "matrix"), tmRound(mapped[4], "matrix"), tmRound(mapped[5], "matrix")];
      }
    } else if (source.type === "PlacedItem" || source.type === "RasterItem") {
      var linked = source.attrs.kind === "linked", l = source.attrs.linear;
      var doc = linked ? [l[0], -l[1], l[2], -l[3]] : [l[0], l[1], l[2], l[3]];
      var w = source.attrs.size[0], h = source.attrs.size[1], c = tmCenter(source.bounds);
      var u = [doc[0] * w / 2, doc[1] * w / 2], v = [doc[2] * h / 2, doc[3] * h / 2];
      var cs = [[c[0] - u[0] - v[0], c[1] - u[1] - v[1]], [c[0] + u[0] - v[0], c[1] + u[1] - v[1]], [c[0] + u[0] + v[0], c[1] + u[1] + v[1]], [c[0] - u[0] + v[0], c[1] - u[1] + v[1]]];
      var mappedCorners = [];
      for (j = 0; j < 4; j++) mappedCorners.push(tmMapPoint(op.m, cs[j]));
      row.bounds = tmBox(tmBoxOfPoints(mappedCorners), "map");
      var next = [op.m[0] * doc[0] + op.m[2] * doc[1], op.m[1] * doc[0] + op.m[3] * doc[1], op.m[0] * doc[2] + op.m[2] * doc[3], op.m[1] * doc[2] + op.m[3] * doc[3]];
      row.attrs.linear = linked ? [tmRound(next[0], "map"), tmRound(-next[1], "map"), tmRound(next[2], "map"), tmRound(-next[3], "map")]
        : [tmRound(next[0], "map"), tmRound(next[1], "map"), tmRound(next[2], "map"), tmRound(next[3], "map")];
    }
    if (op.kind === "rotate") row.margin = null;
    out.push(row);
    index[row.uuid] = out.length - 1;
  }
  // A group's bounds are the union of its children's, resolved bottom-up (children follow their parent in preorder).
  for (i = out.length - 1; i >= 0; i--) {
    if (out[i].type !== "GroupItem") continue;
    var boxes = [];
    for (var k = 0; k < out.length; k++) if (out[k].parentUuid === out[i].uuid) boxes.push(out[k].bounds);
    out[i].bounds = tmBox(tmUnion(boxes), "map");
  }
  // A group's visible box is the union of what its children show, so its margin is that union against its own bounds, not the old margin: where the
  // child that reaches farthest geometrically is not the child that reaches farthest visibly, scaling moves the two by different amounts.
  if (op.kind !== "rotate") {
    for (i = out.length - 1; i >= 0; i--) {
      if (out[i].type !== "GroupItem") continue;
      var shown = [];
      for (var q = 0; q < out.length; q++) {
        var kid = out[q];
        if (kid.parentUuid !== out[i].uuid || kid.margin === null) continue;
        shown.push([kid.bounds[0] - kid.margin[0], kid.bounds[1] + kid.margin[1], kid.bounds[2] + kid.margin[2], kid.bounds[3] - kid.margin[3]]);
      }
      if (shown.length > 0) {
        var visibleUnion = tmUnion(shown), own = out[i].bounds;
        out[i].margin = [tmRound(own[0] - visibleUnion[0], "map"), tmRound(visibleUnion[1] - own[1], "map"), tmRound(visibleUnion[2] - own[2], "map"), tmRound(own[3] - visibleUnion[3], "map")];
      }
    }
  }
  return out;
}
function tmMapSnapshot(snapshot, op) {
  var out = tmClone(snapshot);
  out.rows = tmMapRows(snapshot.rows, op);
  return out;
}

function tmNear(a, b, tol) { return Math.abs(a - b) <= tol; }
/** The factor of a whole operation: the gradient length tolerance grows with it (see transformMultiGradientTolerance). */
function tmFactor(transform) { return transform.type === "scale" ? transform.scalePercent / 100 : 1; }
function tmGradientTolerance(factor) { return Math.max(factor, 1) * TM_GEOMETRY_TOL; }
function tmToleranceFor(key, gradientTol) {
  if (key === "length") return gradientTol;
  if (key === "gm") return TM_GRADIENT_MATRIX_TOL;
  if (key === "linear") return TM_LINEAR_TOL;
  return TM_GEOMETRY_TOL;
}
/** The first place two values differ, as "path: observed vs planned" (the first argument is what was read, the second what the plan said). */
function tmValueDiff(x, y, path, key, gradientTol) {
  if (typeof x === "number" && typeof y === "number") return tmNear(x, y, tmToleranceFor(key, gradientTol)) ? null : path + ": " + stringifyJson(x) + " vs " + stringifyJson(y);
  if (x === null || y === null || typeof x !== "object" || typeof y !== "object") return x === y ? null : path + ": " + stringifyJson(x) + " vs " + stringifyJson(y);
  var arrayX = x instanceof Array, arrayY = y instanceof Array, i, k, inner;
  if (arrayX !== arrayY) return path + ": " + stringifyJson(x) + " vs " + stringifyJson(y);
  if (arrayX) {
    if (x.length !== y.length) return path + ": length " + x.length + " vs " + y.length;
    for (i = 0; i < x.length; i++) { inner = tmValueDiff(x[i], y[i], path + "[" + i + "]", key, gradientTol); if (inner !== null) return inner; }
    return null;
  }
  for (k in x) if (x.hasOwnProperty(k)) {
    if (!y.hasOwnProperty(k)) return path + "." + k + ": present vs absent";
    inner = tmValueDiff(x[k], y[k], path + "." + k, k, gradientTol);
    if (inner !== null) return inner;
  }
  for (k in y) if (y.hasOwnProperty(k) && !x.hasOwnProperty(k)) return path + "." + k + ": absent vs present";
  return null;
}
/** A difference is kept to a bounded text: it travels in the result of a failed transaction. */
function tmTrim(text) { return text.length > 1500 ? text.substring(0, 1500) + "..." : text; }
function tmTextBelow(rows) {
  var flags = [], i, k;
  for (i = rows.length - 1; i >= 0; i--) {
    var has = rows[i].type === "TextFrame";
    for (k = i + 1; k < rows.length && !has; k++) if (rows[k].parentUuid === rows[i].uuid && flags[k] === true) has = true;
    flags[i] = has;
  }
  return flags;
}
/**
 * The attributes a row is compared on. A text's matrix is compared on its linear part only: its translation is an internal value, not a document
 * coordinate (P0, 2026-10-14: Illustrator rewrote it to a value the plan could not predict, twice, while the anchor, bounds, size and leading were
 * exactly as planned). The position is verified through the anchor and the bounds; the translation is still recorded in the evidence.
 */
function tmComparableAttrs(row, noLength) {
  if (row.type === "TextFrame" && row.attrs && row.attrs.matrix) {
    var copy = tmClone(row.attrs);
    copy.matrix = [copy.matrix[0], copy.matrix[1], copy.matrix[2], copy.matrix[3]];
    return copy;
  }
  if (!row.attrs) return row.attrs;
  var plain = tmClone(row.attrs), names = ["fill", "stroke"], n;
  for (n = 0; n < 2; n++) if (plain[names[n]] && plain[names[n]].t === "gradient") {
    // The origin is never compared (see transformMultiGradientTolerance). A stroke gradient with a planned range is compared by tmStrokeLengthDiff, not by value.
    delete plain[names[n]].origin;
    if (noLength === true && names[n] === "stroke") { delete plain[names[n]].length; delete plain[names[n]].lr; }
  }
  return plain;
}
/** A stroke gradient's length against a planned range lr (x is what was read, y the plan, or the other way round); both ranges must agree; null when it holds. */
function tmStrokeLengthDiff(x, y, where) {
  var a = x.attrs && x.attrs.stroke && x.attrs.stroke.t === "gradient" ? x.attrs.stroke : null;
  var b = y.attrs && y.attrs.stroke && y.attrs.stroke.t === "gradient" ? y.attrs.stroke : null;
  if (a === null || b === null) return null;
  var ranged = a.lr ? a : (b.lr ? b : null);
  if (ranged === null) return null;
  if (a.lr && b.lr) {
    return tmNear(a.lr[0], b.lr[0], TM_GEOMETRY_TOL) && tmNear(a.lr[1], b.lr[1], TM_GEOMETRY_TOL) ? null : where + ": stroke gradient range [" + a.lr.join(",") + "] vs [" + b.lr.join(",") + "]";
  }
  var other = ranged === a ? b : a;
  return other.length >= ranged.lr[0] - TM_GEOMETRY_TOL && other.length <= ranged.lr[1] + TM_GEOMETRY_TOL ? null :
    where + ": stroke gradient length " + other.length + " outside [" + ranged.lr.join(",") + "]";
}
/** What differs in one row, or null: the identity, the attributes, the points, the bounds, the margin. */
function tmRowDiff(x, y, i, mode, gradientTol, textBelow) {
  var where = "row " + i + " (" + x.type + " " + x.name + ")";
  if (x.uuid !== y.uuid || x.parentUuid !== y.parentUuid || x.type !== y.type || x.name !== y.name || x.coords.length !== y.coords.length) return where + ": identity or point count differs";
  var lengthDiff = tmStrokeLengthDiff(x, y, where);
  if (lengthDiff !== null) return tmTrim(lengthDiff);
  var rangedStroke = (x.attrs && x.attrs.stroke && x.attrs.stroke.lr) || (y.attrs && y.attrs.stroke && y.attrs.stroke.lr);
  var attrDiff = tmValueDiff(tmComparableAttrs(x, !!rangedStroke), tmComparableAttrs(y, !!rangedStroke), "attrs", "attrs", gradientTol);
  if (attrDiff !== null) return tmTrim(where + ": attributes differ at " + attrDiff);
  for (var c = 0; c < x.coords.length; c++) if (!tmNear(x.coords[c][0], y.coords[c][0], TM_GEOMETRY_TOL) || !tmNear(x.coords[c][1], y.coords[c][1], TM_GEOMETRY_TOL)) return where + ": point " + c + " differs";
  if (!(mode === "rotate" && textBelow === true)) {
    for (var k = 0; k < 4; k++) if (!tmNear(x.bounds[k], y.bounds[k], TM_GEOMETRY_TOL)) return where + ": bounds " + stringifyJson(x.bounds) + " vs " + stringifyJson(y.bounds);
  }
  if (mode !== "rotate" && x.margin !== null && y.margin !== null) {
    for (var m = 0; m < 4; m++) if (!tmNear(x.margin[m], y.margin[m], TM_MARGIN_TOL)) return where + ": the visible margin differs";
  }
  return null;
}
/** Every row's first difference (an empty list: the rows agree). mode: "translate" | "scale" | "rotate" (what a read-back of that operation can be compared on) | null (identical states: compare everything). */
function tmRowsDiffs(a, b, mode, factor) {
  if (!a || !b || a.length !== b.length) return ["the object count differs"];
  // The gradient origin is not compared; a gradient length is a float, so the tolerance is the geometry one times max(factor, 1).
  var gradientTol = tmGradientTolerance(factor === undefined ? 1 : factor);
  var text = mode === "rotate" ? tmTextBelow(a) : null, found = [];
  for (var i = 0; i < a.length; i++) {
    var diff = tmRowDiff(a[i], b[i], i, mode, gradientTol, text === null ? false : text[i]);
    if (diff !== null) found.push(diff);
  }
  return found;
}
function tmRowsDiff(a, b, mode, factor) {
  var found = tmRowsDiffs(a, b, mode, factor);
  return found.length === 0 ? null : found[0];
}
function tmRowsMatch(a, b, mode, factor) { return tmRowsDiff(a, b, mode, factor) === null; }
/** What differs between two snapshots (a is what was read, b what the plan said); an empty list when they agree. */
function tmSnapshotDiffs(a, b, mode, factor) {
  if (!a || !b || a.uuid !== b.uuid || a.type !== b.type || !mutationSameSequence(a.layerPath, b.layerPath) || a.locked !== b.locked || a.hidden !== b.hidden ||
      a.editable !== b.editable || a.layerVisible !== b.layerVisible || a.layerLocked !== b.layerLocked || a.ancestorLocked !== b.ancestorLocked ||
      a.ancestorHidden !== b.ancestorHidden) return ["the object identity or its safety state differs"];
  return tmRowsDiffs(a.rows, b.rows, mode, factor);
}
function tmSnapshotDiff(a, b, mode, factor) {
  var found = tmSnapshotDiffs(a, b, mode, factor);
  return found.length === 0 ? null : found[0];
}
function tmSnapshotsMatch(a, b, mode, factor) { return tmSnapshotDiff(a, b, mode, factor) === null; }

/**
 * The native operations of one target and the snapshot after each: [before, after the first, after the second]. The map wanted is a scale or a
 * rotation about a pivot (the selection's visual centre, or the target's own); the first call turns about Illustrator's CENTER and a
 * translation by M(c) - c (c the CENTER) brings the object to where that map puts it, which is no call at all when the pivot is c.
 */
function tmDeriveTarget(before, transform, pivot) {
  var c = tmCenter(before.rows[0].bounds), own = tmCenter(tmVisualBox(before.rows, 0)), ops = [], stages = [before], current = before;
  var about = transform.type !== "translate" && transform.anchor === "selection_center" ? pivot : own;
  function push(op) { ops.push(op); current = tmMapSnapshot(current, op); stages.push(current); }
  function shiftTo(wanted) {
    var landed = tmMapPoint(wanted, c), dx = landed[0] - c[0], dy = landed[1] - c[1];
    if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) push({ kind: "translate", dx: dx, dy: dy, m: tmTranslation(dx, dy) });
  }
  if (transform.type === "translate") {
    push({ kind: "translate", dx: transform.deltaX, dy: transform.deltaY, m: tmTranslation(transform.deltaX, transform.deltaY) });
  } else if (transform.type === "scale") {
    var f = transform.scalePercent / 100;
    push({ kind: "scale", percent: transform.scalePercent, f: f, m: tmScaleAbout(f, c) });
    shiftTo(tmScaleAbout(f, about));
  } else {
    push({ kind: "rotate", angle: transform.angleDegrees, m: tmRotateAbout(transform.angleDegrees, c) });
    shiftTo(tmRotateAbout(transform.angleDegrees, about));
  }
  return { ops: ops, stages: stages };
}
function tmRunOp(target, op) {
  if (op.kind === "translate") target.translate(op.dx, op.dy, true, false, false, false);
  else if (op.kind === "scale") target.resize(op.percent, op.percent, true, false, true, false, 100, Transformation.CENTER);
  else target.rotate(op.angle, true, false, true, false, Transformation.CENTER);
}

function tmTargetBlockers(context, before) {
  var blockers = [];
  if (!context.mutationAllowed) blockers.push("document_mutation_not_allowed");
  if (before.locked) blockers.push("target_locked");
  if (before.hidden) blockers.push("target_hidden");
  if (!before.editable) blockers.push("target_not_editable");
  if (!before.layerVisible) blockers.push("layer_hidden");
  if (before.layerLocked) blockers.push("layer_locked");
  if (before.ancestorHidden) blockers.push("ancestor_hidden");
  if (before.ancestorLocked) blockers.push("ancestor_locked");
  return blockers;
}
function tmUnionBlockers(perTarget) {
  var present = {}, out = [], t, b;
  for (t = 0; t < perTarget.length; t++) for (b = 0; b < perTarget[t].length; b++) present[perTarget[t][b]] = true;
  for (var o = 0; o < TM_BLOCKER_ORDER.length; o++) if (present[TM_BLOCKER_ORDER[o]]) out.push(TM_BLOCKER_ORDER[o]);
  return out;
}
function tmCause(error) { return error && error.message ? " (" + String(error.message).substring(0, 140) + ")" : ""; }
/** A refused target: a classified error carries its code to the caller (next steps come from the code); anything else stays a plain refusal. */
function tmRefusal(error, index, uuid) {
  var text = tmLabel(index, uuid) + ": " + mutationPublicMessage(error, "its state cannot be read." + tmCause(error));
  if (error && typeof error.tmCode === "string") return new Error("MCP_ERROR:" + stringifyJson({ code: "TRANSFORM_TARGET_REFUSED", reason: error.tmCode, message: text }));
  return mutationError("preflight_failed", text);
}
function tmGradientPaintCount(snapshot) {
  var count = 0;
  for (var i = 0; i < snapshot.rows.length; i++) {
    var attrs = snapshot.rows[i].attrs;
    if (attrs.fill && attrs.fill.t === "gradient") count++;
    if (attrs.stroke && attrs.stroke.t === "gradient") count++;
  }
  return count;
}
function tmLabel(index, uuid) { return "Target " + (index + 1) + " (" + uuid + ")"; }
function tmSameTarget(a, b) { return a === b || (a && b && String(a.uuid) === String(b.uuid) && String(a.typename) === String(b.typename)); }

function tmResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument, requested = params.targets, transform = params.transform;
  if (!requested || typeof requested.length !== "number" || requested.length < TM_MIN_TARGETS || requested.length > TM_MAX_TARGETS) {
    throw mutationError("preflight_failed", "Transforming together requires " + TM_MIN_TARGETS + " to " + TM_MAX_TARGETS + " targets.");
  }
  var seen = {}, entries = [], boxes = [], gradientPaints = 0, i;
  for (i = 0; i < requested.length; i++) {
    var uuid = requested[i].targetUuid;
    if (typeof uuid !== "string" || uuid.length === 0 || seen["u:" + uuid] === true) throw mutationError("preflight_failed", "Targets must be distinct non-empty native UUIDs.");
    seen["u:" + uuid] = true;
    var target = transformFindTarget(document, uuid);
    if (target === null) throw new Error("MCP_ERROR:" + stringifyJson({ code: "OBJECT_NOT_FOUND", uuid: uuid }));
    var before;
    try { before = tmSnapshot(document, target, transform.type); tmRefuseTurnedText(before); }
    catch (snapshotError) { throw tmRefusal(snapshotError, i, uuid); }
    gradientPaints += tmGradientPaintCount(before);
    if (gradientPaints > TM_MAX_GRADIENT_PAINTS) {
      var crowded = mutationError("preflight_failed", "The targets hold more than " + TM_MAX_GRADIENT_PAINTS + " gradient fills or strokes; transform fewer per call.");
      crowded.tmCode = "target_set_too_large";
      throw tmRefusal(crowded, i, uuid);
    }
    entries.push({ index: i, uuid: uuid, target: target, before: before, blockers: tmTargetBlockers(context, before) });
    boxes.push(tmVisualBox(before.rows, 0));
  }
  var pivot = null;
  if (transform.type !== "translate" && transform.anchor === "selection_center") pivot = tmCenter(tmUnion(boxes));
  var perTarget = [];
  for (i = 0; i < entries.length; i++) {
    var derived;
    try { derived = tmDeriveTarget(entries[i].before, transform, pivot); }
    catch (deriveError) { throw tmRefusal(deriveError, i, entries[i].uuid); }
    entries[i].ops = derived.ops; entries[i].stages = derived.stages; entries[i].after = derived.stages[derived.stages.length - 1];
    if (forApply) {
      // A plan's before always carries its margins; an echo without them would switch the margin check off.
      for (var m = 0; m < requested[i].expectedBefore.rows.length; m++) {
        if (requested[i].expectedBefore.rows[m].margin === null) throw mutationError("preflight_failed", tmLabel(i, entries[i].uuid) + ": expected_before must carry every row's margin.");
      }
      if (!tmSnapshotsMatch(entries[i].before, requested[i].expectedBefore, null)) throw mutationError("preflight_failed", tmLabel(i, entries[i].uuid) + ": state does not match expected_before.");
      if (!tmSnapshotsMatch(entries[i].after, requested[i].confirmedAfter, null)) throw mutationError("preflight_failed", tmLabel(i, entries[i].uuid) + ": confirmed_after does not match the derived state.");
    }
    perTarget.push(entries[i].blockers);
  }
  var union = tmUnionBlockers(perTarget);
  if (forApply && union.length > 0) {
    var blockedUuids = [];
    for (var b = 0; b < entries.length; b++) if (entries[b].blockers.length > 0) blockedUuids.push(entries[b].uuid);
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "TRANSFORM_APPLY_BLOCKED", reasonCodes: union, uuids: blockedUuids }));
  }
  var pairs = [];
  for (i = 0; i < entries.length; i++) pairs.push({ before: entries[i].before, after: entries[i].after, targetUuid: entries[i].uuid });
  if (snapshotResultBytes(context.key, pairs) > SNAPSHOT_RESULT_ADMISSION_BYTES) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "TRANSFORM_TARGET_REFUSED", reason: "result_too_large", message: "The targets' snapshots are too large for one result record; transform fewer or simpler objects per call." }));
  }
  return { context: context, document: document, transform: transform, pivot: pivot, entries: entries, blockers: union };
}

function tmPlan(preflight) {
  var targets = [];
  for (var i = 0; i < preflight.entries.length; i++) {
    var entry = preflight.entries[i];
    targets.push({ targetUuid: entry.uuid, before: entry.before, after: entry.after, applyBlockedReasonCodes: entry.blockers });
  }
  return { operation: "transform_object", documentKey: preflight.context.key, transform: preflight.transform, pivot: preflight.pivot, targets: targets,
    applyBlockedReasonCodes: preflight.blockers, confirmationStatus: params.apply === true ? "confirmed" : "required",
    applyAllowed: params.apply === true && preflight.blockers.length === 0 };
}
function tmRevalidate(preflight, plan) {
  var current;
  try { current = tmResolve(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Transform preconditions changed before apply.")); }
  if (current.document !== preflight.document || current.entries.length !== preflight.entries.length) throw mutationBeforeSideEffectError("Transform document or target count changed before apply.");
  for (var i = 0; i < current.entries.length; i++) {
    if (!tmSameTarget(current.entries[i].target, preflight.entries[i].target) || !tmSnapshotsMatch(current.entries[i].before, plan.targets[i].before, null) ||
        !tmSnapshotsMatch(current.entries[i].after, plan.targets[i].after, null)) {
      throw mutationBeforeSideEffectError(tmLabel(i, preflight.entries[i].uuid) + ": target or state changed before apply.");
    }
  }
}
function tmApply(preflight, plan, state) {
  state.operationState.mutationStarted = true;
  var attempted = 0;
  for (var i = 0; i < preflight.entries.length; i++) {
    var entry = preflight.entries[i];
    attempted += 1;
    state.operationState.attemptedCount = attempted;
    state.operationState.rollbackEvidence.attemptedCount = attempted;
    for (var k = 0; k < entry.ops.length; k++) tmRunOp(entry.target, entry.ops[k]);
  }
  return attempted;
}
function tmVerify(preflight, plan, state) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) throw mutationError("verify_mismatch", "Active document changed during transform verification.");
  var actual = [], summary = [];
  for (var i = 0; i < preflight.entries.length; i++) {
    var entry = preflight.entries[i], target = transformFindTarget(preflight.document, entry.uuid);
    if (target === null || !tmSameTarget(target, entry.target)) throw mutationError("verify_mismatch", tmLabel(i, entry.uuid) + ": native UUID no longer resolves to the same PageItem.");
    var read;
    try { read = tmSnapshot(preflight.document, target, preflight.transform.type); }
    catch (readError) { throw mutationError("verify_mismatch", tmLabel(i, entry.uuid) + ": " + mutationPublicMessage(readError, "its state cannot be read back." + tmCause(readError))); }
    var diffs = tmSnapshotDiffs(read, entry.after, preflight.transform.type, tmFactor(preflight.transform));
    if (diffs.length > 0) {
      var text = diffs.join("; ");
      // The failure message is cut at 500 characters by the transaction, so every target's own differences travel with its rollback evidence.
      state.operationState.rollbackEvidence.targets[i].differences = text.length > 1000 ? text.substring(0, 1000) + "..." : text;
      summary.push(tmLabel(i, entry.uuid) + ": " + diffs[0]);
    }
    actual.push(read);
  }
  // Every target is read and compared before this fails, so that one failure names what differed on all of them (read vs planned).
  if (summary.length > 0) {
    throw mutationError("verify_mismatch", summary.length + " of " + preflight.entries.length + " targets do not match the plan (read vs planned; every target's differences are in transaction.rollback.targets[].differences). " + summary.join(" | "));
  }
  return actual;
}

function tmInitialRollbackEvidence() {
  var targets = [];
  for (var i = 0; i < params.targets.length; i++) targets.push({ targetUuid: params.targets[i].targetUuid, outcome: "not_written", restoredSnapshot: null, observedSnapshot: null, differences: null });
  return { attemptedCount: 0, targets: targets };
}
/** Restores one attempted target from the state it is really in: the stage that matches decides which inverse operations to run. */
function tmRollbackTarget(preflight, entry) {
  var target = transformFindTarget(preflight.document, entry.uuid), mode = preflight.transform.type;
  if (target === null || !tmSameTarget(target, entry.target)) return { status: "indeterminate", message: "target identity is indeterminate." };
  var live = tmSnapshot(preflight.document, target, mode);
  var stage = -1, s;
  for (s = entry.stages.length - 1; s >= 0; s--) {
    if (tmSnapshotsMatch(live, entry.stages[s], s === 0 ? null : mode, tmFactor(preflight.transform))) { stage = s; break; }
  }
  if (stage < 0) {
    var nearest = tmSnapshotDiff(live, entry.stages[entry.stages.length - 1], mode, tmFactor(preflight.transform));
    return { status: "indeterminate", observed: live, message: "the target matches no planned stage, so no inverse can be proven" + (nearest === null ? "." : " (against the planned result, read vs planned: " + nearest + ")." ) };
  }
  for (var k = stage - 1; k >= 0; k--) {
    var op = entry.ops[k], goal = entry.stages[k];
    if (op.kind === "translate") {
      target.translate(goal.rows[0].bounds[0] - live.rows[0].bounds[0], goal.rows[0].bounds[1] - live.rows[0].bounds[1], true, false, false, false);
    } else if (op.kind === "scale") {
      target.resize(10000 / op.percent, 10000 / op.percent, true, false, true, false, 100, Transformation.CENTER);
    } else {
      target.rotate(-op.angle, true, false, true, false, Transformation.CENTER);
      var turned = tmSnapshot(preflight.document, target, mode);
      var was = tmCenter(goal.rows[0].bounds), now = tmCenter(turned.rows[0].bounds), offset = [was[0] - now[0], was[1] - now[1]];
      var expected = tmClone(goal);
      expected.rows = tmMapRows(goal.rows, { kind: "translate", dx: -offset[0], dy: -offset[1], m: tmTranslation(-offset[0], -offset[1]) });
      var shifted = tmRowsDiff(turned.rows, expected.rows, null);
      if (shifted !== null) return { status: "indeterminate", observed: turned, message: "the inverse rotation is not one translation of the earlier state (" + shifted + ")." };
      target.translate(offset[0], offset[1], true, false, false, false);
    }
    live = tmSnapshot(preflight.document, target, mode);
    if (!tmSnapshotsMatch(live, goal, k === 0 ? null : mode, tmFactor(preflight.transform))) return { status: "failed", observed: live, message: "the inverse did not restore the earlier state." };
  }
  return { status: "verified", restored: live };
}
function tmRollback(state) {
  var preflight = state.preflight;
  var evidence = state.operationState.rollbackEvidence.targets;
  var attempted = state.operationState.attemptedCount || 0;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) {
    for (var u = 0; u < attempted && u < evidence.length; u++) evidence[u].outcome = "indeterminate";
    return { status: "indeterminate", message: "Rollback document identity is indeterminate. plan.targets of the result lists every target UUID; check each one." };
  }
  var firstIndeterminate = null, firstOutstanding = null;
  for (var k = attempted - 1; k >= 0; k--) {
    var entry = preflight.entries[k], outcome;
    try { outcome = tmRollbackTarget(preflight, entry); }
    catch (rollbackError) { outcome = { status: "indeterminate", message: mutationPublicMessage(rollbackError, "the rollback threw.") }; }
    if (outcome.status === "verified") { evidence[k].outcome = "restored"; evidence[k].restoredSnapshot = outcome.restored; evidence[k].observedSnapshot = null; }
    else if (outcome.status === "failed") {
      evidence[k].outcome = "outstanding"; evidence[k].restoredSnapshot = null; evidence[k].observedSnapshot = outcome.observed;
      if (firstOutstanding === null) firstOutstanding = tmLabel(k, entry.uuid) + ": " + outcome.message;
    } else {
      evidence[k].outcome = "indeterminate"; evidence[k].restoredSnapshot = null; evidence[k].observedSnapshot = null;
      if (firstIndeterminate === null) firstIndeterminate = tmLabel(k, entry.uuid) + ": " + outcome.message;
    }
  }
  if (firstIndeterminate !== null) return { status: "indeterminate", message: "Rollback is indeterminate. " + firstIndeterminate + " plan.targets of the result lists every target UUID; check each one." };
  if (firstOutstanding !== null) return { status: "failed", message: "Rollback did not restore every attempted target. " + firstOutstanding + " plan.targets of the result lists every target UUID; check each one." };
  return { status: "verified" };
}

`;
export const TRANSFORM_MULTI_RUNNER_SCRIPT = `function tmDefinition() {
  return {
    apply: params.apply === true,
    editSessionAffected: function () { var uuids = []; for (var i = 0; i < params.targets.length; i++) uuids.push(params.targets[i].targetUuid); return uuids; },
    initialOperationState: function () { return { mutationStarted: false, attemptedCount: 0, rollbackEvidence: tmInitialRollbackEvidence() }; },
    preflight: tmResolve,
    plan: tmPlan,
    revalidate: tmRevalidate,
    applyMutation: tmApply,
    verify: tmVerify,
    rollback: tmRollback,
    hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
    applyIndeterminate: function (state) {
      var targets = state.operationState.rollbackEvidence.targets;
      for (var i = 0; i < targets.length; i++) { targets[i].outcome = "indeterminate"; targets[i].restoredSnapshot = null; targets[i].observedSnapshot = null; }
      return { reasonCode: "transform_state_unknown", message: "Transform apply outcome is indeterminate for " + targets.length + " target(s); plan.targets of the result lists every target UUID.", evidence: { attemptedCount: targets.length, targets: targets } };
    },
    rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
  };
}
`;
