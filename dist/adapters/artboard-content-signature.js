import { PLAIN_POINT_TEXT_V1 } from './point-text-host-script.js';
export const ARTBOARD_COPY_GEOMETRY_TOLERANCE = 0.0009765625;
export const ARTBOARD_COPY_LINEAR_TOLERANCE = 0.000001;
export const ARTBOARD_COPY_MAX_ROOTS = 64;
export const ARTBOARD_COPY_MAX_NODES = 2_000;
export const ARTBOARD_COPY_MAX_CHARS = 5_000;
export const ARTBOARD_COPY_MAX_POINTS = 20_000;
export const ARTBOARD_COPY_MAX_DEPTH = 8;
export const ARTBOARD_COPY_TYPES = ['PathItem', 'CompoundPathItem', 'GroupItem', 'TextFrame', 'PlacedItem', 'RasterItem'];
const PARAGRAPH_NAMES = [...Object.keys(PLAIN_POINT_TEXT_V1.paragraph), 'justification'];
const CHARACTER_NAMES = Object.keys(PLAIN_POINT_TEXT_V1.character);
const FRAME_NAMES = Object.keys(PLAIN_POINT_TEXT_V1.frame);
export const ARTBOARD_CONTENT_SIGNATURE_SCRIPT = `
var DA_PARA_NAMES = ${JSON.stringify(PARAGRAPH_NAMES)};
var DA_CHAR_NAMES = ${JSON.stringify(CHARACTER_NAMES)};
var DA_FRAME_NAMES = ${JSON.stringify(FRAME_NAMES)};
var DA_TOLERANCE = ${ARTBOARD_COPY_GEOMETRY_TOLERANCE};
var DA_LINEAR_TOLERANCE = ${ARTBOARD_COPY_LINEAR_TOLERANCE};
var DA_MAX_NODES = ${ARTBOARD_COPY_MAX_NODES};
var DA_MAX_CHARS = ${ARTBOARD_COPY_MAX_CHARS};
var DA_MAX_POINTS = ${ARTBOARD_COPY_MAX_POINTS};
var DA_MAX_DEPTH = ${ARTBOARD_COPY_MAX_DEPTH};
function daRead(fn) {
  try { return { v: fn() }; }
  catch (error) { return { e: (error && typeof error.number === "number") ? error.number : -1 }; }
}
// One attribute as text: a read error is part of the value (the same error on both sides is equal), numbers are rounded to 5 decimals.
function daCanon(r) {
  if (r.e !== undefined) return "err:" + r.e;
  var v = r.v, t = typeof v;
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (t === "number") return isFinite(v) ? String(Math.round(v * 100000) / 100000) : "nonfinite";
  if (t === "boolean") return v ? "true" : "false";
  if (t === "string") return "s:" + v;
  return "o:" + String(v);
}
function daTable(host, names) {
  var out = [], i;
  for (i = 0; i < names.length; i++) out.push(names[i] + "=" + daCanon(daRead(function () { return host[names[i]]; })));
  return out.join(";");
}
function daNumbersOf(value, length, label) {
  if (!value || value.length !== length) throw mutationError("preflight_failed", label + " is unavailable.");
  var out = [], i;
  for (i = 0; i < length; i++) out.push(mutationFiniteNumber(value[i], label));
  return out;
}
// A paint as text, or null when it is outside the measured profile (the caller records the reason). level 2: a path fill or stroke or a character paint
// (spot colour and, with a signature object, gradient allowed); 1: a gradient stop (flat and spot); 0: the base colour of a spot (flat only). A gradient pushes its placement into sig.gfix.
function daFlatPaint(color) {
  var t = String(color.typename);
  if (t === "RGBColor") return "rgb:" + color.red + "," + color.green + "," + color.blue;
  if (t === "GrayColor") return "gray:" + color.gray;
  if (t === "NoColor") return "none";
  if (t === "CMYKColor") return "cmyk:" + daCanon({ v: color.cyan }) + "," + daCanon({ v: color.magenta }) + "," + daCanon({ v: color.yellow }) + "," + daCanon({ v: color.black });
  return null;
}
function daPaint(color, sig, level) {
  if (color === null || color === undefined) return "null";
  var t = String(color.typename), flat = daFlatPaint(color), spot, base, text, g, stops, n, i, stop, geometry, m;
  if (flat !== null) return flat;
  if (t === "SpotColor" && level >= 1) {
    spot = daRead(function () { return color.spot; });
    if (spot.e !== undefined || !spot.v) return null;
    base = daRead(function () { return daPaint(spot.v.color, null, 0); });
    if (base.e !== undefined || base.v === null || base.v === "null") return null;
    return "spot:" + String(spot.v.name) + "|" + String(spot.v.colorType) + "|tint:" + daCanon(daRead(function () { return color.tint; })) + "|base:" + base.v;
  }
  if (t === "GradientColor" && level >= 2 && sig) {
    g = daRead(function () { return color.gradient; });
    if (g.e !== undefined || !g.v) return null;
    stops = g.v.gradientStops; n = stops.length;
    if (n < 2 || n > 32) return null;
    text = "grad:" + String(g.v.name) + "|" + String(g.v.type) + "|" + n;
    for (i = 0; i < n; i++) {
      stop = stops[i];
      base = daRead(function () { return daPaint(stop.color, null, 1); });
      if (base.e !== undefined || base.v === null || base.v === "null") return null;
      text += "|" + daCanon(daRead(function () { return stop.rampPoint; })) + "," + daCanon(daRead(function () { return stop.midPoint; })) + "," + daCanon(daRead(function () { return stop.opacity; })) + "," + base.v;
    }
    geometry = daRead(function () { m = color.matrix; return [color.angle, color.length, color.hiliteAngle, color.hiliteLength, m.mValueA, m.mValueB, m.mValueC, m.mValueD, m.mValueTX, m.mValueTY]; });
    // An unreadable or non-finite placement is a refusal (or a failed verification on the copy), never an exception that ends the whole read.
    if (geometry.e !== undefined || !geometry.v) { sig.paintReason = "gradient_placement_unreadable"; return null; }
    for (i = 0; i < geometry.v.length; i++) if (typeof geometry.v[i] !== "number" || !isFinite(geometry.v[i])) { sig.paintReason = "gradient_placement_unreadable"; return null; }
    for (i = 0; i < geometry.v.length; i++) sig.gfix.push(geometry.v[i]);
    return text;
  }
  return null;
}
function daRefuse(sig, reason) { if (sig.refusal === null) sig.refusal = reason; }
function daAttr(sig, name, value) { sig.parts.push(name + "=" + value); }
function daPush(sig, list) { var i; for (i = 0; i < list.length; i++) sig.geo.push(list[i]); }
function daPush2(target, list) { var i; for (i = 0; i < list.length; i++) target.push(list[i]); }
function daPaintPart(sig, name, color) {
  var text = daPaint(color, sig, 2);
  if (text === null) { daRefuse(sig, "unsupported_paint:" + (sig.paintReason !== null ? sig.paintReason : String(color.typename))); sig.paintReason = null; text = "unsupported"; }
  daAttr(sig, name, text);
}
function daMatrix(sig, item) {
  var m = daRead(function () { return item.matrix; });
  if (m.e !== undefined || !m.v) { daAttr(sig, "matrix", "err"); return; }
  // The 2x2 part does not move with the copy, but a host that recomputes a matrix may leave float noise in it: compared within DA_LINEAR_TOLERANCE, not as text.
  daPush2(sig.lin, [mutationFiniteNumber(m.v.mValueA, "matrix.a"), mutationFiniteNumber(m.v.mValueB, "matrix.b"), mutationFiniteNumber(m.v.mValueC, "matrix.c"), mutationFiniteNumber(m.v.mValueD, "matrix.d")]);
  daPush(sig, [mutationFiniteNumber(m.v.mValueTX, "matrix.tx"), mutationFiniteNumber(m.v.mValueTY, "matrix.ty")]);
}
function daPathGeometry(sig, path) {
  var count = path.pathPoints.length, i, point;
  sig.points += count;
  if (sig.points > DA_MAX_POINTS) throw mutationError("preflight_failed", "The artboard content has more than " + DA_MAX_POINTS + " path points.");
  daAttr(sig, "points", count);
  for (i = 0; i < count; i++) {
    point = path.pathPoints[i];
    daAttr(sig, "pt", String(point.pointType));
    daPush(sig, daNumbersOf(point.anchor, 2, "anchor").concat(daNumbersOf(point.leftDirection, 2, "leftDirection"), daNumbersOf(point.rightDirection, 2, "rightDirection")));
  }
}
// One character paint as text; a paint outside the profile (a gradient on text, a pattern) refuses the item.
function daRunPaint(sig, ca, which) {
  var r = daRead(function () { var c = ca[which], text = daPaint(c, null, 2); return text === null ? "unsupported:" + String(c.typename) : text; });
  if (r.e === undefined && String(r.v).indexOf("unsupported:") === 0) { daRefuse(sig, "unsupported_paint:" + String(r.v).substring(12)); return "unsupported"; }
  return daCanon(r);
}
function daRunRow(sig, ch) {
  var ca = ch.characterAttributes;
  return daCanon(daRead(function () { return ca.size; })) + "," + daCanon(daRead(function () { return ca.textFont ? String(ca.textFont.name) : null; })) + "," +
    daCanon(daRead(function () { return ca.tracking; })) + "," + daCanon(daRead(function () { return ca.leading; })) + "," + daCanon(daRead(function () { return ca.autoLeading; })) + "," +
    daCanon(daRead(function () { return ca.horizontalScale; })) + "," + daCanon(daRead(function () { return ca.verticalScale; })) + "," + daCanon(daRead(function () { return ca.baselineShift; })) + "," +
    daRunPaint(sig, ca, "fillColor") + "," + daRunPaint(sig, ca, "strokeColor") + "," + daCanon(daRead(function () { return ca.strokeWeight; }));
}
function daTextNode(sig, item) {
  var count = item.characters.length, i, mid, kind = String(item.kind);
  sig.chars += count;
  if (sig.chars > DA_MAX_CHARS) throw mutationError("preflight_failed", "The artboard content has more than " + DA_MAX_CHARS + " characters of text.");
  if (kind !== "TextType.POINTTEXT" && kind !== "TextType.AREATEXT") { daRefuse(sig, "unsupported_text_kind:" + kind); return; }
  if (count < 1) { daRefuse(sig, "empty_text"); return; }
  mid = Math.floor(count / 2);
  daAttr(sig, "kind", kind);
  daAttr(sig, "contents", String(item.contents));
  daAttr(sig, "frame", daTable(item, DA_FRAME_NAMES));
  daAttr(sig, "paragraph", daTable(item.textRange.paragraphAttributes, DA_PARA_NAMES));
  daAttr(sig, "charFirst", daTable(item.characters[0].characterAttributes, DA_CHAR_NAMES));
  daAttr(sig, "charMid", daTable(item.characters[mid].characterAttributes, DA_CHAR_NAMES));
  daAttr(sig, "charLast", daTable(item.characters[count - 1].characterAttributes, DA_CHAR_NAMES));
  for (i = 0; i < count; i++) daAttr(sig, "run", daRunRow(sig, item.characters[i]));
  daMatrix(sig, item);
  if (kind === "TextType.POINTTEXT") daPush(sig, daNumbersOf(item.anchor, 2, "anchor"));
  else daPathGeometry(sig, item.textPath);
}
function daImageNode(sig, item, type) {
  daMatrix(sig, item);
  if (type === "PlacedItem") {
    var file = daRead(function () { return String(item.file.fsName); });
    daAttr(sig, "file", daCanon(file));
  } else {
    daAttr(sig, "imageColorSpace", daCanon(daRead(function () { return item.imageColorSpace; })));
    daAttr(sig, "bitsPerChannel", daCanon(daRead(function () { return item.bitsPerChannel; })));
    daAttr(sig, "channels", daCanon(daRead(function () { return item.channels; })));
    daAttr(sig, "embedded", daCanon(daRead(function () { return item.embedded; })));
  }
}
function daNode(sig, item, depth) {
  var type = String(item.typename), i, children;
  if (depth > DA_MAX_DEPTH) throw mutationError("preflight_failed", "The artboard content is nested deeper than " + DA_MAX_DEPTH + " levels.");
  sig.nodes++;
  if (sig.nodes > DA_MAX_NODES) throw mutationError("preflight_failed", "The artboard content has more than " + DA_MAX_NODES + " page items.");
  var uuid = item.uuid;
  if (typeof uuid !== "string" || uuid.length < 1 || uuid.length > 256) throw mutationError("preflight_failed", "A page item has no native UUID.");
  sig.uuids.push(uuid);
  daAttr(sig, "type", type);
  daAttr(sig, "name", String(item.name));
  daAttr(sig, "locked", item.locked === true);
  daAttr(sig, "hidden", item.hidden === true);
  daAttr(sig, "opacity", daCanon(daRead(function () { return item.opacity; })));
  daAttr(sig, "blend", daCanon(daRead(function () { return item.blendingMode; })));
  daAttr(sig, "knockout", daCanon(daRead(function () { return item.artworkKnockout; })));
  daAttr(sig, "isolated", daCanon(daRead(function () { return item.isIsolated; })));
  daAttr(sig, "note", daCanon(daRead(function () { return item.note; })));
  daPush(sig, daNumbersOf(item.geometricBounds, 4, "geometricBounds"));
  daPush(sig, daNumbersOf(item.visibleBounds, 4, "visibleBounds"));
  daPush(sig, daNumbersOf(item.controlBounds, 4, "controlBounds"));
  daPush(sig, daNumbersOf(item.position, 2, "position"));
  if (type === "PathItem") {
    if (item.guides) daRefuse(sig, "guide");
    daAttr(sig, "closed", item.closed === true);
    daAttr(sig, "clipping", item.clipping === true);
    daAttr(sig, "filled", item.filled === true);
    daPaintPart(sig, "fill", item.filled ? item.fillColor : null);
    daAttr(sig, "fillOverprint", item.fillOverprint === true);
    daAttr(sig, "stroked", item.stroked === true);
    daPaintPart(sig, "stroke", item.stroked ? item.strokeColor : null);
    daAttr(sig, "strokeWidth", daCanon(daRead(function () { return item.strokeWidth; })));
    daAttr(sig, "strokeCap", daCanon(daRead(function () { return item.strokeCap; })));
    daAttr(sig, "strokeJoin", daCanon(daRead(function () { return item.strokeJoin; })));
    daAttr(sig, "strokeMiter", daCanon(daRead(function () { return item.strokeMiterLimit; })));
    daAttr(sig, "strokeDashes", daCanon(daRead(function () { var dashes = [], k; for (k = 0; k < item.strokeDashes.length; k++) dashes.push(item.strokeDashes[k]); return dashes.join(","); })));
    daAttr(sig, "strokeDashOffset", daCanon(daRead(function () { return item.strokeDashOffset; })));
    daAttr(sig, "strokeOverprint", item.strokeOverprint === true);
    daAttr(sig, "evenodd", daCanon(daRead(function () { return item.evenodd; })));
    daAttr(sig, "polarity", daCanon(daRead(function () { return item.polarity; })));
    daPathGeometry(sig, item);
  } else if (type === "CompoundPathItem") {
    children = item.pathItems;
    daAttr(sig, "children", children.length);
    if (item.groupItems && item.groupItems.length > 0) daRefuse(sig, "compound_group_children");
    for (i = 0; i < children.length; i++) daNode(sig, children[i], depth + 1);
  } else if (type === "GroupItem") {
    daAttr(sig, "clipped", item.clipped === true);
    children = item.pageItems;
    daAttr(sig, "children", children.length);
    for (i = 0; i < children.length; i++) daNode(sig, children[i], depth + 1);
  } else if (type === "TextFrame") daTextNode(sig, item);
  else if (type === "PlacedItem" || type === "RasterItem") daImageNode(sig, item, type);
  else daRefuse(sig, "unsupported_type:" + type);
}
// The signature of one top-level item: { parts, geo, uuids, nodes, chars, points, refusal }.
function daSignature(item) {
  var sig = { parts: [], geo: [], lin: [], gfix: [], uuids: [], nodes: 0, chars: 0, points: 0, refusal: null, paintReason: null };
  daNode(sig, item, 0);
  return sig;
}
function daSigText(sig) { return sig.parts.join("|"); }
// A short text digest: three 32-bit lanes over the attributes and the exact geometry text.
function daDigest(sig) {
  var text = daSigText(sig) + "#" + sig.geo.join(",") + "@" + sig.lin.join(",") + "~" + sig.gfix.join(","), a = 5381, b = 7, c = 0, i, code;
  for (i = 0; i < text.length; i++) {
    code = text.charCodeAt(i);
    a = (a * 33 + code) >>> 0; b = (b * 131 + code + 1) >>> 0; c = (c * 65599 + code + (i % 251)) >>> 0;
  }
  return witnessHex(a) + witnessHex(b) + witnessHex(c);
}
// The copy of \`source\` moved by (dx, dy): equal attributes, geometry within the tolerance. Returns { ok, maxResidual, nonzero, reason }.
function daCompareCopy(source, copy, dx, dy) {
  var result = { ok: false, maxResidual: 0, nonzero: 0, reason: null }, i, residual;
  if (daSigText(source) !== daSigText(copy)) { result.reason = "attributes_differ"; return result; }
  if (source.geo.length !== copy.geo.length || source.lin.length !== copy.lin.length || source.gfix.length !== copy.gfix.length) { result.reason = "geometry_length_differs"; return result; }
  // A gradient's placement (angle, length, highlight, the object-relative matrix) does not move with the copy: equal within the same float32 tolerance, and reported with the residuals.
  for (i = 0; i < source.gfix.length; i++) {
    residual = copy.gfix[i] - source.gfix[i];
    if (residual < 0) residual = 0 - residual;
    if (residual > DA_TOLERANCE) { result.reason = "gradient_placement_differs"; result.maxResidual = residual; return result; }
    if (residual > 0) result.nonzero++;
    if (residual > result.maxResidual) result.maxResidual = residual;
  }
  for (i = 0; i < source.lin.length; i++) {
    residual = copy.lin[i] - source.lin[i];
    if (residual < 0) residual = 0 - residual;
    if (residual > DA_LINEAR_TOLERANCE) { result.reason = "linear_part_differs"; return result; }
  }
  for (i = 0; i < source.geo.length; i++) {
    residual = copy.geo[i] - (source.geo[i] + (i % 2 === 0 ? dx : dy));
    if (residual < 0) residual = 0 - residual;
    if (residual > DA_TOLERANCE) { result.reason = "geometry_beyond_tolerance"; result.maxResidual = residual; return result; }
    if (residual > 0) result.nonzero++;
    if (residual > result.maxResidual) result.maxResidual = residual;
  }
  result.ok = true;
  return result;
}
`;
