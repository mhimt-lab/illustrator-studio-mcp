import { z } from 'zod';
export const SUPPORTED_PATH_ITEM_MAX_PATH_POINTS = 256;
export const SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS = 128;
export const supportedPathCmykPaintSchema = z.strictObject({
    type: z.literal('CMYKColor'),
    cyan: z.number().finite().min(0).max(100),
    magenta: z.number().finite().min(0).max(100),
    yellow: z.number().finite().min(0).max(100),
    black: z.number().finite().min(0).max(100),
});
export const SUPPORTED_PATH_ITEM_HOST_SCRIPT = `
var SUPPORTED_PATH_ITEM_MAX_PATH_POINTS = ${SUPPORTED_PATH_ITEM_MAX_PATH_POINTS};
var SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS = ${SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS};

function supportedPathUtf8ByteLength(value) {
  var bytes = 0;
  for (var index = 0; index < value.length; index++) {
    var code = value.charCodeAt(index);
    if (code <= 0x7F) bytes += 1;
    else if (code <= 0x7FF) bytes += 2;
    else if (code >= 0xD800 && code <= 0xDBFF && index + 1 < value.length) {
      var low = value.charCodeAt(index + 1);
      if (low >= 0xDC00 && low <= 0xDFFF) { bytes += 4; index++; }
      else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

function supportedPathFind(document, uuid) {
  if (typeof document.getPageItemFromUuid !== "function") {
    throw mutationError("preflight_failed", "Illustrator native UUID lookup is unavailable.");
  }
  try {
    var target = document.getPageItemFromUuid(uuid);
    return target === null || target === undefined ? null : target;
  } catch (lookupError) {
    var message = lookupError && lookupError.message ? String(lookupError.message) : "";
    if (lookupError && lookupError.name === "Error" && lookupError.number === 1200 &&
        (message.indexOf("MRAP") >= 0 || message.indexOf("an Illustrator error occurred") >= 0)) return null;
    throw lookupError;
  }
}

function supportedPathLayerChain(document, targetLayer) {
  function visit(layers, prefix, ancestors) {
    for (var index = 0; index < layers.length; index++) {
      var layer = layers[index];
      var path = prefix.concat([index]);
      var chain = ancestors.concat([layer]);
      if (layer === targetLayer) return { path: path, chain: chain };
      var nested = visit(layer.layers, path, chain);
      if (nested !== null) return nested;
    }
    return null;
  }
  return visit(document.layers, [], []);
}

function supportedPathNumber(value, label) {
  var rounded = Number(mutationFiniteNumber(value, label).toFixed(12));
  return rounded === 0 ? 0 : rounded;
}

function supportedPathPoint(value, label) {
  if (!value || value.length !== 2) throw mutationError("preflight_failed", label + " is unavailable.");
  return [supportedPathNumber(value[0], label + "[0]"), supportedPathNumber(value[1], label + "[1]")];
}

function supportedPathBounds(value, label) {
  if (!value || value.length !== 4) throw mutationError("preflight_failed", label + " is unavailable.");
  return [supportedPathNumber(value[0], label + "[0]"), supportedPathNumber(value[1], label + "[1]"),
    supportedPathNumber(value[2], label + "[2]"), supportedPathNumber(value[3], label + "[3]")];
}

function supportedPathRgb(value, label) {
  if (!value || String(value.typename) !== "RGBColor") {
    throw mutationError("preflight_failed", label + " supports RGBColor only.");
  }
  return { type: "RGBColor", red: supportedPathNumber(value.red, label + ".red"),
    green: supportedPathNumber(value.green, label + ".green"),
    blue: supportedPathNumber(value.blue, label + ".blue") };
}

function supportedPathCanonicalChannel(value, label) {
  var rounded = Math.round(mutationFiniteNumber(value, label) * 100000) / 100000;
  return rounded === 0 ? 0 : rounded;
}

/**
 * Process paint of a structure target. RGB reads exactly as before. CMYK is read only when the caller passes a
 * paint scope whose cmykAdmitted() is true for its own measured scope, with five-decimal channels (the product
 * rule: the host quantizes a written channel in the 13th decimal). The scope is asked only when CMYK paint is
 * found, so an RGB target never reads anything new. Without a scope every other model keeps the RGB-only
 * refusal, so an operation that never measured CMYK is unchanged. A spot fill is read only when the scope also
 * offers spotFillIndex(value), which returns the spot's position in the document's spot list; the paint is then
 * { type, tint, spotIndex } and never carries the spot's name. A spot stroke stays refused.
 */
function supportedPathPaint(value, label, paint) {
  if (paint && paint.spotFillIndex && label === "fillColor" && value && String(value.typename) === "SpotColor") {
    return { type: "SpotColor", tint: supportedPathCanonicalChannel(value.tint, label + ".tint"), spotIndex: paint.spotFillIndex(value) };
  }
  if (paint && value && String(value.typename) === "CMYKColor") {
    if (paint.cmykAdmitted() !== true) throw mutationError("preflight_failed", label + " " + paint.cmykRefusal);
    return { type: "CMYKColor", cyan: supportedPathCanonicalChannel(value.cyan, label + ".cyan"),
      magenta: supportedPathCanonicalChannel(value.magenta, label + ".magenta"),
      yellow: supportedPathCanonicalChannel(value.yellow, label + ".yellow"),
      black: supportedPathCanonicalChannel(value.black, label + ".black") };
  }
  return supportedPathRgb(value, label);
}

/**
 * The structural and appearance items of a path that the shared gate refuses, each as "name=observed value".
 * \`note\`, \`uRL\` and \`tags\` report only that they are non-empty, never their content. An empty list means the
 * target passes. \`admit\` (the paint scope's stateAdmit, absent for every operation that did not measure it) names the
 * values one operation accepts: { maxTags, negativePolarity }. A tag count above maxTags is reported as "tags=N".
 */
function supportedPathStateRefusals(target, visibilityVariable, includeClipping, admit) {
  var refusals = [];
  if (includeClipping && target.clipping) refusals.push("clipping=true");
  if (target.guides) refusals.push("guides=true");
  if (target.sliced) refusals.push("sliced=true");
  if (target.isIsolated) refusals.push("isIsolated=true");
  if (target.wrapped) refusals.push("wrapped=true");
  var knockout = String(target.artworkKnockout);
  if (knockout !== "KnockoutState.DISABLED") refusals.push("artworkKnockout=" + knockout);
  var blendingMode = String(target.blendingMode);
  if (blendingMode !== "BlendModes.NORMAL") refusals.push("blendingMode=" + blendingMode);
  if (visibilityVariable !== null) refusals.push("visibilityVariable=present");
  if (String(target.note) !== "") refusals.push("note=non-empty");
  var tagCount = target.tags.length;
  if (tagCount !== 0 && !(admit && tagCount <= admit.maxTags)) refusals.push(admit ? "tags=" + tagCount : "tags=non-empty");
  if (String(target.uRL) !== "") refusals.push("uRL=non-empty");
  var polarity = String(target.polarity);
  if (polarity !== "PolarityValues.POSITIVE" && !(admit && admit.negativePolarity === true && polarity === "PolarityValues.NEGATIVE")) refusals.push("polarity=" + polarity);
  return refusals;
}

function supportedPathSnapshot(document, target, expectedUuid, expectedParentTypename, paint) {
  if (!target || target.typename !== "PathItem" || !target.parent ||
      String(target.parent.typename) !== expectedParentTypename) {
    throw mutationError("preflight_failed", "Structure operation supports the declared direct PathItem parent only.");
  }
  if (typeof target.uuid !== "string" || target.uuid.length === 0 || target.uuid !== expectedUuid) {
    throw mutationError("preflight_failed", "Target native UUID is unavailable or changed.");
  }
  var layerInfo = supportedPathLayerChain(document, target.layer);
  if (layerInfo === null || (expectedParentTypename === "Layer" && target.parent !== target.layer) ||
      (expectedParentTypename === "GroupItem" && target.parent.layer !== target.layer)) {
    throw mutationError("preflight_failed", "Target layer or parent identity is unavailable.");
  }
  var effectiveVisible = true;
  var effectiveLocked = false;
  for (var layerIndex = 0; layerIndex < layerInfo.chain.length; layerIndex++) {
    var layer = layerInfo.chain[layerIndex];
    if (typeof layer.visible !== "boolean" || typeof layer.locked !== "boolean") {
      throw mutationError("preflight_failed", "Layer safety state is unavailable.");
    }
    if (!layer.visible) effectiveVisible = false;
    if (layer.locked) effectiveLocked = true;
  }
  if (!target.pathPoints || target.pathPoints.length < 1 ||
      target.pathPoints.length > SUPPORTED_PATH_ITEM_MAX_PATH_POINTS) {
    throw mutationError("preflight_failed", "Structure operation supports PathItems with 1 to " +
      SUPPORTED_PATH_ITEM_MAX_PATH_POINTS + " readable path points only.");
  }
  var pathPoints = [];
  for (var pointIndex = 0; pointIndex < target.pathPoints.length; pointIndex++) {
    var point = target.pathPoints[pointIndex];
    var pointType = String(point.pointType);
    if (pointType !== "PointType.CORNER" && pointType !== "PointType.SMOOTH") {
      throw mutationError("preflight_failed", "Unsupported path-point type.");
    }
    pathPoints.push({
      anchor: supportedPathPoint(point.anchor, "pathPoints[" + pointIndex + "].anchor"),
      leftDirection: supportedPathPoint(point.leftDirection, "pathPoints[" + pointIndex + "].leftDirection"),
      rightDirection: supportedPathPoint(point.rightDirection, "pathPoints[" + pointIndex + "].rightDirection"),
      pointType: pointType
    });
  }
  if (typeof target.filled !== "boolean" || typeof target.stroked !== "boolean" ||
      typeof target.locked !== "boolean" || typeof target.hidden !== "boolean" || typeof target.editable !== "boolean") {
    throw mutationError("preflight_failed", "Target appearance or safety state is unavailable.");
  }
  var strokeDashes = [];
  if (!target.strokeDashes || target.strokeDashes.length > 32) {
    throw mutationError("preflight_failed", "Target stroke dash state is unavailable or too large.");
  }
  for (var dashIndex = 0; dashIndex < target.strokeDashes.length; dashIndex++) {
    strokeDashes.push(supportedPathNumber(target.strokeDashes[dashIndex], "strokeDashes[" + dashIndex + "]"));
  }
  var visibilityVariable;
  try { visibilityVariable = target.visibilityVariable; }
  catch (variableError) { throw mutationError("preflight_failed", "Target visibility variable state is unreadable."); }
  var stateRefusals = supportedPathStateRefusals(target, visibilityVariable, true, paint && paint.stateAdmit ? paint.stateAdmit : null);
  if (stateRefusals.length > 0) {
    throw mutationError("preflight_failed", "Target uses an unsupported structural or appearance state (" + stateRefusals.join(", ") + ").");
  }
  var strokeCap = String(target.strokeCap);
  var strokeJoin = String(target.strokeJoin);
  if ((strokeCap !== "StrokeCap.BUTTENDCAP" && strokeCap !== "StrokeCap.ROUNDENDCAP" &&
       strokeCap !== "StrokeCap.PROJECTINGENDCAP") ||
      (strokeJoin !== "StrokeJoin.BEVELENDJOIN" && strokeJoin !== "StrokeJoin.ROUNDENDJOIN" &&
       strokeJoin !== "StrokeJoin.MITERENDJOIN")) {
    throw mutationError("preflight_failed", "Target stroke cap or join is unsupported.");
  }
  var snapshot = {
    uuid: target.uuid,
    type: target.typename,
    name: String(target.name || ""),
    layerPath: layerInfo.path,
    geometricBounds: supportedPathBounds(target.geometricBounds, "geometricBounds"),
    controlBounds: supportedPathBounds(target.controlBounds, "controlBounds"),
    visibleBounds: supportedPathBounds(target.visibleBounds, "visibleBounds"),
    position: supportedPathPoint(target.position, "position"),
    width: supportedPathNumber(target.width, "width"),
    height: supportedPathNumber(target.height, "height"),
    closed: Boolean(target.closed),
    pathPoints: pathPoints,
    filled: target.filled,
    fillColor: target.filled ? supportedPathPaint(target.fillColor, "fillColor", paint) : null,
    fillOverprint: Boolean(target.fillOverprint),
    stroked: target.stroked,
    strokeColor: target.stroked ? supportedPathPaint(target.strokeColor, "strokeColor", paint) : null,
    strokeWidth: target.stroked ? supportedPathNumber(target.strokeWidth, "strokeWidth") : null,
    strokeOverprint: Boolean(target.strokeOverprint),
    strokeDashes: strokeDashes,
    strokeDashOffset: supportedPathNumber(target.strokeDashOffset, "strokeDashOffset"),
    strokeCap: strokeCap,
    strokeJoin: strokeJoin,
    strokeMiterLimit: supportedPathNumber(target.strokeMiterLimit, "strokeMiterLimit"),
    evenodd: Boolean(target.evenodd),
    polarity: String(target.polarity),
    resolution: supportedPathNumber(target.resolution, "resolution"),
    artworkKnockout: String(target.artworkKnockout),
    blendingMode: String(target.blendingMode),
    opacity: supportedPathNumber(target.opacity, "opacity"),
    pixelAligned: Boolean(target.pixelAligned),
    noteEmpty: true,
    tagsEmpty: true,
    urlEmpty: true,
    visibilityVariableAbsent: true,
    wrapped: false,
    clipping: false,
    guides: false,
    sliced: false,
    isolated: false,
    locked: target.locked,
    hidden: target.hidden,
    editable: target.editable,
    layerVisible: target.layer.visible,
    layerLocked: target.layer.locked,
    effectiveLayerVisible: effectiveVisible,
    effectiveLayerLocked: effectiveLocked
  };
  // Only an operation that admits tags carries the count (never their content); every other snapshot is unchanged.
  if (paint && paint.stateAdmit) {
    delete snapshot.tagsEmpty;
    snapshot.tagCount = target.tags.length;
  }
  return snapshot;
}

function supportedPathOrder(container) {
  if (!container.pageItems || container.pageItems.length < 1 ||
      container.pageItems.length > SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS) {
    throw mutationError("preflight_failed", "Structure parent must contain 1 to " +
      SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS + " direct page items.");
  }
  var order = [];
  var seen = {};
  for (var index = 0; index < container.pageItems.length; index++) {
    var item = container.pageItems[index];
    if (item.parent !== container || typeof item.uuid !== "string" || item.uuid.length === 0 || seen[item.uuid]) {
      throw mutationError("preflight_failed", "Structure operation requires a complete unique direct-parent UUID order.");
    }
    seen[item.uuid] = true;
    order.push(item.uuid);
  }
  return order;
}

/** A copy with every object's keys in sorted order, so a comparison never depends on key order. */
function supportedPathSorted(value) {
  if (value === null || typeof value !== "object") return value;
  if (Object.prototype.toString.call(value) === "[object Array]") {
    var items = [];
    for (var index = 0; index < value.length; index++) items.push(supportedPathSorted(value[index]));
    return items;
  }
  var keys = [];
  for (var key in value) if (Object.prototype.hasOwnProperty.call(value, key)) keys.push(key);
  keys.sort();
  var sorted = {};
  for (var at = 0; at < keys.length; at++) sorted[keys[at]] = supportedPathSorted(value[keys[at]]);
  return sorted;
}

function supportedPathSame(left, right) {
  return stringifyJson(supportedPathSorted(left)) === stringifyJson(supportedPathSorted(right));
}
`;
