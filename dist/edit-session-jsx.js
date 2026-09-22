export const EDIT_SESSION_JSX = String.raw `
function esRead(read) { try { var value = read(); return ((value === undefined || value === null) ? ["e"] : ["v", value]); } catch (esError) { return ["e"]; } }
function esEnum(read) { var slot = esRead(read); return ((slot[0] === "e") ? ["e"] : ["v", String(slot[1])]); }
function esLength(read) { var slot = esRead(read); return ((slot[0] === "v" && typeof slot[1] === "number") ? slot[1] : null); }
function esNow() { return new Date().getTime(); }
function esColor(read) {
  var slot = esRead(read);
  if (slot[0] === "e") return ["e"];
  var color = slot[1];
  var typename = esEnum(function () { return color.typename; });
  if (typename[0] === "e") return ["e"];
  if (typename[1] === "RGBColor") return ["v", "rgb", color.red, color.green, color.blue];
  if (typename[1] === "CMYKColor") return ["v", "cmyk", color.cyan, color.magenta, color.yellow, color.black];
  if (typename[1] === "GrayColor") return ["v", "gray", color.gray];
  if (typename[1] === "SpotColor") return ["v", "spot", esRead(function () { return String(color.spot.name); }), esRead(function () { return color.tint; })];
  return ["v", typename[1]];
}
function esLayerPath(layer) {
  var parts = [];
  var cursor = layer;
  while (cursor && cursor.typename === "Layer") { parts.unshift(String(cursor.name)); cursor = cursor.parent; }
  return parts.join("\u0000");
}
function esFnv(text, seed) {
  var hash = seed;
  for (var index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  return hash >>> 0;
}
function esHex(value) { var text = (value >>> 0).toString(16); while (text.length < 8) text = "0" + text; return text; }
function esRowHash(row) { return [esFnv(row, 2166136261), esFnv(row, 84696351)]; }
function esHashText(hash) { return esHex(hash[0]) + esHex(hash[1]); }
function esAggregateEmpty() { return { a: 0, b: 0, n: 0 }; }
function esAggregateAdd(aggregate, hash, sign) {
  aggregate.a = (aggregate.a + sign * hash[0] + 4294967296) % 4294967296;
  aggregate.b = (aggregate.b + sign * hash[1] + 4294967296) % 4294967296;
  aggregate.n += sign;
}
function esAggregateText(aggregate) { return esHex(aggregate.a) + esHex(aggregate.b) + ":" + aggregate.n; }

/**
 * Structure digest S: never iterates page items; per layer it reads only the direct item count.
 *
 * The item total is the sum of those layer counts, never doc.pageItems.length: measured on 30.8.1 (design gate 13.14,
 * the measured profile), right after a path is created doc.pageItems / doc.pathItems keep their old length for the rest of the
 * host call, even through a re-acquired Document, while layer.pageItems is current. A session document holds only
 * items directly under top-level layers (open refuses groups, sublayers, and anything else), so the sum is its
 * item total, and the 2,000-item limit is judged on it.
 */
function esStructure(doc) {
  var startedAt = esNow();
  var rows = [stringifyJson(["D", esEnum(function () { return doc.documentColorSpace; })])];
  var artboardCount = esLength(function () { return doc.artboards.length; });
  rows.push(stringifyJson(["A#", artboardCount]));
  for (var artboardIndex = 0; artboardIndex < ((artboardCount === null) ? 0 : artboardCount); artboardIndex++) {
    var artboard = doc.artboards[artboardIndex];
    rows.push(stringifyJson(["A", artboardIndex, esRead(function () { return artboard.name; }),
      esRead(function () { var rect = artboard.artboardRect; return [rect[0], rect[1], rect[2], rect[3]]; })]));
  }
  var layerRows = 0;
  var sublayerRows = 0;
  var itemCount = 0;
  function walkLayers(container, depth) {
    var layerCount = esLength(function () { return container.layers.length; });
    // An unreadable layer collection leaves the item total unknown (null refuses as too large), never 0.
    if (layerCount === null) itemCount = null;
    rows.push(stringifyJson(["L#", layerCount]));
    for (var layerIndex = 0; layerIndex < ((layerCount === null) ? 0 : layerCount); layerIndex++) {
      var layer = container.layers[layerIndex];
      layerRows++;
      if (depth > 0) sublayerRows++;
      var layerItems = esLength(function () { return layer.pageItems.length; });
      itemCount = ((itemCount === null || layerItems === null) ? null : itemCount + layerItems);
      rows.push(stringifyJson(["L", layerIndex, esLayerPath(layer),
        esRead(function () { return layer.visible; }), esRead(function () { return layer.locked; }),
        esRead(function () { return layer.printable; }), esRead(function () { return layer.preview; }),
        esRead(function () { return layer.opacity; }), layerItems]));
      walkLayers(layer, depth + 1);
    }
  }
  walkLayers(doc, 0);
  rows.push(stringifyJson(["I", itemCount]));
  var swatchCount = esLength(function () { return doc.swatches.length; });
  rows.push(stringifyJson(["S#", swatchCount]));
  for (var swatchIndex = 0; swatchIndex < ((swatchCount === null) ? 0 : swatchCount); swatchIndex++) {
    var swatch = doc.swatches[swatchIndex];
    rows.push(stringifyJson(["S", swatchIndex, esRead(function () { return swatch.name; }), esColor(function () { return swatch.color; })]));
  }
  var characterStyleCount = esLength(function () { return doc.characterStyles.length; });
  rows.push(stringifyJson(["C#", characterStyleCount]));
  for (var characterStyleIndex = 0; characterStyleIndex < ((characterStyleCount === null) ? 0 : characterStyleCount); characterStyleIndex++) {
    var characterStyle = doc.characterStyles[characterStyleIndex];
    rows.push(stringifyJson(["C", characterStyleIndex, esRead(function () { return characterStyle.name; })]));
  }
  var paragraphStyleCount = esLength(function () { return doc.paragraphStyles.length; });
  rows.push(stringifyJson(["P#", paragraphStyleCount]));
  for (var paragraphStyleIndex = 0; paragraphStyleIndex < ((paragraphStyleCount === null) ? 0 : paragraphStyleCount); paragraphStyleIndex++) {
    var paragraphStyle = doc.paragraphStyles[paragraphStyleIndex];
    rows.push(stringifyJson(["P", paragraphStyleIndex, esRead(function () { return paragraphStyle.name; })]));
  }
  return { digest: esHashText(esRowHash(rows.join("\n"))), itemCount: itemCount, layerCount: layerRows,
    sublayerCount: sublayerRows, durationMs: esNow() - startedAt };
}

/**
 * One item row, keyed by uuid and independent of the item's collection index, so the aggregate does not
 * depend on traversal order. Stacking order inside a container is deliberately not part of the row.
 * Text attributes are the whole-range read, which answers with the first character's value (measured).
 * PR-2b (design gate 14.2, 14.13, 14.14): groups, clip groups, compound paths and linked placed images, at any depth
 * under a top-level layer, are measured; the PathItem and TextFrame rows are the PR-2a rows (a clipping path alone gains a flag), so a
 * session opened by the PR-2a build keeps its aggregate.
 */
function esItemRow(item) {
  var typename = esEnum(function () { return item.typename; });
  var row = [esEnum(function () { return item.uuid; }), typename,
    esRead(function () { var bounds = item.geometricBounds; return [bounds[0], bounds[1], bounds[2], bounds[3]]; }),
    esRead(function () { return esLayerPath(item.layer); }),
    esEnum(function () { var parent = item.parent; return ((parent.typename === "Layer") ? "layer" : parent.uuid); }),
    esRead(function () { return item.locked; }), esRead(function () { return item.hidden; }),
    esRead(function () { return item.opacity; }), esEnum(function () { return item.blendingMode; }),
    esRead(function () { return item.name; })];
  if (typename[1] === "PathItem") {
    row.push(esRead(function () { return item.filled; }), esColor(function () { return item.fillColor; }),
      esRead(function () { return item.stroked; }), esColor(function () { return item.strokeColor; }),
      esRead(function () { return item.strokeWidth; }), esRead(function () { return item.closed; }));
    var pointCount = esLength(function () { return item.pathPoints.length; });
    row.push(((pointCount === null) ? ["e"] : ["v", pointCount]));
    for (var pointIndex = 0; pointIndex < ((pointCount === null) ? 0 : pointCount); pointIndex++) {
      row.push(esRead((function (index) {
        return function () {
          var point = item.pathPoints[index];
          return [point.anchor[0], point.anchor[1], point.leftDirection[0], point.leftDirection[1],
            point.rightDirection[0], point.rightDirection[1], String(point.pointType)];
        };
      })(pointIndex)));
    }
  }
  if (typename[1] === "TextFrame") {
    row.push(esRead(function () { return item.contents; }),
      esLength(function () { return item.characters.length; }),
      esRead(function () { return item.textRange.characterAttributes.size; }),
      esEnum(function () { return item.textRange.characterAttributes.textFont.name; }),
      esRead(function () { return item.textRange.characterAttributes.tracking; }),
      esRead(function () { return item.textRange.characterAttributes.leading; }),
      esRead(function () { return item.textRange.characterAttributes.baselineShift; }),
      esColor(function () { return item.textRange.characterAttributes.fillColor; }));
  }
  if (typename[1] === "PathItem" && esRead(function () { return item.clipping; })[1] === true) {
    // Only a clipping path carries the flag, so every other path row stays the PR-2a row.
    row.push(["clipping", true]);
  }
  if (typename[1] === "GroupItem") {
    row.push(esRead(function () { return item.clipped; }));
    var childCount = esLength(function () { return item.pageItems.length; });
    var children = [];
    for (var childIndex = 0; childIndex < ((childCount === null) ? 0 : childCount); childIndex++) {
      children.push(esEnum((function (index) { return function () { return item.pageItems[index].uuid; }; })(childIndex)));
    }
    // The ordered child uuids: a reorder inside a group changes the group's row (probe N, X group_reorder).
    row.push(((childCount === null) ? ["e"] : ["v", children]));
  }
  if (typename[1] === "CompoundPathItem") row.push(esLength(function () { return item.pathItems.length; }));
  if (typename[1] === "PlacedItem") {
    // The linked file and the placement matrix (probe N2: file throws on an unlinked item, so it reads as ["e"]).
    row.push(esRead(function () { return String(item.file.fsName); }),
      esRead(function () { var m = item.matrix; return [m.mValueA, m.mValueB, m.mValueC, m.mValueD, m.mValueTX, m.mValueTY]; }));
  }
  var measured = (typename[1] === "PathItem" || typename[1] === "TextFrame" || typename[1] === "GroupItem" ||
    typename[1] === "CompoundPathItem" || typename[1] === "PlacedItem");
  var parentType = esEnum(function () { return item.parent.typename; });
  var measuredParent = (parentType[0] === "v" &&
    (parentType[1] === "Layer" || parentType[1] === "GroupItem" || parentType[1] === "CompoundPathItem"));
  return { uuid: ((row[0][0] === "v") ? row[0][1] : null), hash: esRowHash(stringifyJson(row)),
    measured: (measured && measuredParent) };
}

/**
 * The rows a declaration touches (design gate 14.1, 14.13 M-a, 14.15): each declared item, every descendant
 * (doc.pageItems holds the children of groups, clip groups and compound paths, so moving or restyling a container
 * changes their rows), and every ancestor container (a child's change moves the group's bounds, and a group row
 * holds its ordered children). Ancestors are added without their other descendants. A uuid that does not resolve
 * stays in the list, so its absence is reported as missing, never dropped.
 */
function esExpandAffected(doc, uuids) {
  var out = [];
  var seen = {};
  function mark(item) {
    var uuid = esEnum(function () { return item.uuid; });
    // An item whose uuid cannot be read may still be in the document; dropping it would hide its subtree.
    if (uuid[0] === "e") throw new Error("An edit session item native UUID is unreadable.");
    if (seen.hasOwnProperty(uuid[1])) return false;
    seen[uuid[1]] = true;
    out.push(uuid[1]);
    return true;
  }
  function descend(item) {
    if (!mark(item)) return;
    var typename = esEnum(function () { return item.typename; });
    if (typename[1] === "GroupItem") {
      var count = esLength(function () { return item.pageItems.length; });
      for (var index = 0; index < ((count === null) ? 0 : count); index++) descend(item.pageItems[index]);
    } else if (typename[1] === "CompoundPathItem") {
      var paths = esLength(function () { return item.pathItems.length; });
      for (var pathIndex = 0; pathIndex < ((paths === null) ? 0 : paths); pathIndex++) descend(item.pathItems[pathIndex]);
    }
  }
  function ascend(item) {
    var parent = esRead(function () { return item.parent; });
    while (parent[0] === "v") {
      var parentType = esEnum(function () { return parent[1].typename; });
      if (parentType[1] !== "GroupItem" && parentType[1] !== "CompoundPathItem") return;
      mark(parent[1]);
      var container = parent[1];
      parent = esRead(function () { return container.parent; });
    }
  }
  for (var index = 0; index < uuids.length; index++) {
    var item = esLookup(doc, uuids[index]);
    if (item === null) {
      if (!seen.hasOwnProperty(uuids[index])) { seen[uuids[index]] = true; out.push(uuids[index]); }
      continue;
    }
    descend(item);
    ascend(item);
  }
  return out;
}

/**
 * Stacking order of one top-level layer's direct items as one aggregate row (design gate 14.14): each uuid gets a
 * short FNV-1a pair, weighted by its 1-based position and summed per lane, so a reorder changes the row. The row
 * holds no layer name or index (a rename or a layer reorder leaves it alone; the structure digest covers those).
 * Measured cost basis (probe N2): reading 1,900 direct uuids took 27 ms; hashing one long string took 90-123 ms,
 * which this form avoids.
 */
function esLayerOrderRow(layer) {
  var items = esRead(function () { return layer.pageItems; });
  var count = ((items[0] === "e") ? null : esLength(function () { return items[1].length; }));
  var a = 0;
  var b = 0;
  for (var index = 0; index < ((count === null) ? 0 : count); index++) {
    var uuid;
    try { uuid = String(items[1][index].uuid); } catch (uuidError) { uuid = "?"; }
    a = (a + esFnv(uuid, 2166136261) * (index + 1)) % 4294967296;
    b = (b + esFnv(uuid, 84696351) * (index + 1)) % 4294967296;
  }
  return esRowHash(stringifyJson(["LO", count, a, b]));
}

/** Top-level layers of a document, in order. */
function esTopLayers(doc) {
  var layers = [];
  var count = esLength(function () { return doc.layers.length; });
  for (var index = 0; index < ((count === null) ? 0 : count); index++) layers.push(doc.layers[index]);
  return layers;
}

/**
 * Full scan at session open and before save (never per mutation). Reads doc.pageItems once and indexes it.
 * Returns without reading any item when the document is over maxItems, and stops with truncated:true when
 * the host deadline is reached, so the call never approaches the AppleEvent limit.
 */
function esScan(doc, deadlineMs, maxItems) {
  var startedAt = esNow();
  var aggregate = esAggregateEmpty();
  var all = doc.pageItems;
  var total = esLength(function () { return all.length; });
  var result = { aggregate: null, total: total, visited: 0, missingUuid: 0, unmeasured: 0, truncated: false,
    overLimit: (total === null || total > maxItems), layerRows: 0, durationMs: 0 };
  if (result.overLimit) { result.durationMs = esNow() - startedAt; return result; }
  for (var itemIndex = 0; itemIndex < total; itemIndex++) {
    if ((itemIndex & 15) === 0 && esNow() - startedAt > deadlineMs) { result.truncated = true; break; }
    var measured = esItemRow(all[itemIndex]);
    result.visited++;
    if (measured.uuid === null) result.missingUuid++;
    if (!measured.measured) result.unmeasured++;
    esAggregateAdd(aggregate, measured.hash, 1);
  }
  // One stacking-order row per top-level layer; the aggregate count is items plus layers.
  result.layerRows = 0;
  if (!result.truncated) {
    var topLayers = esTopLayers(doc);
    for (var layerIndex = 0; layerIndex < topLayers.length; layerIndex++) {
      if (esNow() - startedAt > deadlineMs) { result.truncated = true; break; }
      esAggregateAdd(aggregate, esLayerOrderRow(topLayers[layerIndex]), 1);
      result.layerRows++;
    }
  }
  if (!result.truncated) result.aggregate = esAggregateText(aggregate);
  result.durationMs = esNow() - startedAt;
  return result;
}

function esTypedLookup(read, uuid) {
  var collection = esRead(read);
  if (collection[0] === "e") return null;
  var count = esLength(function () { return collection[1].length; });
  for (var index = 0; index < ((count === null) ? 0 : count); index++) {
    var candidate = collection[1][index];
    if (esEnum(function () { return candidate.uuid; })[1] === uuid) return candidate;
  }
  return null;
}

/**
 * The item for a uuid. Measured on 30.8.1 (design gate 14.14, probe N2): getPageItemFromUuid answers a PlacedItem
 * uuid with an object reporting GroupItem whose row differs from the doc.pageItems row, and a CompoundPathItem uuid
 * with a row that differs too; the typed collections (document.compoundPathItems, document.placedItems), which the
 * compound and placed-image adapters use, return the item itself. Paths and text resolve directly.
 */
function esLookup(doc, uuid) {
  var item = null;
  try { item = doc.getPageItemFromUuid(uuid); } catch (lookupError) { item = null; }
  if (item === undefined) item = null;
  if (item !== null) {
    var typename = esEnum(function () { return item.typename; });
    if (typename[1] === "PathItem" || typename[1] === "TextFrame") return item;
  }
  var typed = esTypedLookup(function () { return doc.compoundPathItems; }, uuid);
  if (typed === null) typed = esTypedLookup(function () { return doc.placedItems; }, uuid);
  return ((typed === null) ? item : typed);
}

/**
 * A uuid lookup that throws MRAP, or a captured reference that reads ReferenceError 45, does not prove
 * absence; live Illustrator 30.8.1 kept such an invalid GroupItem in its collections. Absence is proved only when
 * every item on doc.pageItems, doc.groupItems and each layer's pageItems (sublayers included) reads its uuid and
 * none is one of uuids; the observed invalid items showed on some of these routes and not others. Returns null
 * when proved, otherwise the reason. Called only where absence decides an outcome, in the same host call.
 */
function esAbsenceUnproved(doc, uuids) {
  var wanted = {};
  for (var index = 0; index < uuids.length; index++) wanted[uuids[index]] = true;
  function check(read) {
    var collection = esRead(read);
    if (collection[0] === "e") return "collection_unreadable";
    var count = esLength(function () { return collection[1].length; });
    if (count === null) return "collection_unreadable";
    for (var itemIndex = 0; itemIndex < count; itemIndex++) {
      var uuid = esEnum(function () { return collection[1][itemIndex].uuid; });
      if (uuid[0] === "e") return "item_uuid_unreadable";
      if (wanted.hasOwnProperty(uuid[1])) return "uuid_present";
    }
    return null;
  }
  function checkLayers(read) {
    var layers = esRead(read);
    if (layers[0] === "e") return "collection_unreadable";
    var count = esLength(function () { return layers[1].length; });
    if (count === null) return "collection_unreadable";
    for (var layerIndex = 0; layerIndex < count; layerIndex++) {
      var layer = layers[1][layerIndex];
      var reason = check(function () { return layer.pageItems; });
      if (reason === null) reason = checkLayers(function () { return layer.layers; });
      if (reason !== null) return reason;
    }
    return null;
  }
  var result = check(function () { return doc.pageItems; });
  if (result === null) result = check(function () { return doc.groupItems; });
  if (result === null) result = checkLayers(function () { return doc.layers; });
  return result;
}

/** Rows of the declared affected items, resolved by uuid; an item that no longer resolves contributes nothing. */
function esTargetRows(doc, uuids) {
  var rows = [];
  var missing = [];
  for (var index = 0; index < uuids.length; index++) {
    var item = esLookup(doc, uuids[index]);
    if (item === null) { missing.push(uuids[index]); continue; }
    var measured = esItemRow(item);
    if (measured.uuid !== uuids[index]) { missing.push(uuids[index]); continue; }
    rows.push({ uuid: measured.uuid, hash: esHashText(measured.hash) });
  }
  return { rows: rows, missing: missing };
}
`;
export function buildEditSessionSnapshotBody(deadlineMs, maxItems) {
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0)
        throw new Error('deadlineMs must be a positive integer.');
    if (!Number.isSafeInteger(maxItems) || maxItems <= 0)
        throw new Error('maxItems must be a positive integer.');
    return `var esDoc = app.activeDocument;
var esStructureBefore = esStructure(esDoc);
var esFull = esScan(esDoc, ${deadlineMs}, ${maxItems});
var esStructureAfter = esStructure(esDoc);
return stringifyJson({ structure: esStructureBefore, structureStable: (esStructureBefore.digest === esStructureAfter.digest),
  scan: esFull, context: getDocumentContext() });`;
}
