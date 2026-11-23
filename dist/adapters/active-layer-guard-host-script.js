export const ACTIVE_LAYER_GUARD_MAX_DEPTH = 64;
export const ACTIVE_LAYER_GUARD_SCRIPT = `
var ACTIVE_LAYER_GUARD_MAX_DEPTH = ${ACTIVE_LAYER_GUARD_MAX_DEPTH};

/** Index path of a layer from the document root, or null when it is not in the layer tree. */
function guardLayerPath(document, targetLayer) {
  function visit(layers, prefix) {
    for (var index = 0; index < layers.length; index++) {
      var layer = layers[index];
      var path = prefix.concat([index]);
      if (layer === targetLayer) return path;
      if (path.length < ACTIVE_LAYER_GUARD_MAX_DEPTH && layer.layers && layer.layers.length > 0) {
        var nested = visit(layer.layers, path);
        if (nested !== null) return nested;
      }
    }
    return null;
  }
  return visit(document.layers, []);
}

/** The active layer as the baseline to restore: the layer itself, its name and its index path. */
function guardCaptureActiveLayer(document) {
  var layer, name, path;
  try { layer = document.activeLayer; name = layer ? String(layer.name) : null; path = layer ? guardLayerPath(document, layer) : null; }
  catch (activeError) { throw mutationError("preflight_failed", "The active layer is unavailable."); }
  if (!layer || name === null || path === null) throw mutationError("preflight_failed", "The active layer is not part of the document layer tree.");
  return { layer: layer, name: name, path: path };
}

/** True when the document's current active layer has the recorded index path and name. Never throws. */
function guardActiveLayerMatches(document, baseline) {
  try {
    var layer = document.activeLayer;
    if (!layer || String(layer.name) !== baseline.name) return false;
    var path = guardLayerPath(document, layer);
    return path !== null && mutationSameSequence(path, baseline.path);
  } catch (readError) { return false; }
}

/** Makes layer the active layer and reads it back; throws when the host did not take it. */
function guardSelectActiveLayer(document, layer) {
  var expected = guardLayerPath(document, layer);
  if (expected === null) throw mutationError("apply_failed", "The target layer is not part of the document layer tree.");
  var already = guardLayerPath(document, document.activeLayer);
  if (already !== null && mutationSameSequence(already, expected)) return;
  try { document.activeLayer = layer; }
  catch (selectError) { throw mutationError("apply_failed", "Illustrator refused to make the target layer the active layer."); }
  var current = guardLayerPath(document, document.activeLayer);
  if (current === null || !mutationSameSequence(current, expected)) throw mutationError("apply_failed", "The target layer did not become the active layer.");
}

/** Puts the recorded active layer back and reports whether the read-back matches. Never throws. */
function guardRestoreActiveLayer(document, baseline) {
  if (guardActiveLayerMatches(document, baseline)) return true;
  try { document.activeLayer = baseline.layer; } catch (restoreError) { return false; }
  return guardActiveLayerMatches(document, baseline);
}

/** Item counts of the whole document: the document total, and the direct item count of every layer by index path. */
function guardCaptureCounts(document) {
  var layers = [];
  function visit(list, prefix) {
    for (var index = 0; index < list.length; index++) {
      var layer = list[index];
      var path = prefix.concat([index]);
      if (typeof layer.pageItems.length !== "number") throw mutationError("preflight_failed", "A layer item count is unavailable.");
      layers.push({ path: path, count: layer.pageItems.length });
      if (layer.layers && layer.layers.length > 0) {
        if (path.length >= ACTIVE_LAYER_GUARD_MAX_DEPTH) throw mutationError("preflight_failed", "The layer tree exceeds the supported depth.");
        visit(layer.layers, path);
      }
    }
  }
  var total;
  try { total = document.pageItems.length; visit(document.layers, []); }
  catch (countError) { throw mutationError("preflight_failed", mutationPublicMessage(countError, "Document item counts are unavailable.")); }
  if (typeof total !== "number") throw mutationError("preflight_failed", "The document item count is unavailable.");
  return { total: total, layers: layers };
}

/**
 * Differences between two count records: structureChanged when the layer tree has another shape, totalDelta, and
 * the layers whose direct item count moved (index path and delta).
 */
function guardCountsDelta(before, after) {
  var delta = { structureChanged: false, totalDelta: after.total - before.total, changed: [] };
  if (before.layers.length !== after.layers.length) { delta.structureChanged = true; return delta; }
  for (var index = 0; index < before.layers.length; index++) {
    if (!mutationSameSequence(before.layers[index].path, after.layers[index].path)) { delta.structureChanged = true; return delta; }
    var moved = after.layers[index].count - before.layers[index].count;
    if (moved !== 0) delta.changed.push({ path: before.layers[index].path, delta: moved });
  }
  return delta;
}

function guardCountsUnchanged(before, after) {
  var delta = guardCountsDelta(before, after);
  return !delta.structureChanged && delta.totalDelta === 0 && delta.changed.length === 0;
}

/** True when exactly one item was added, on the layer at layerPath, and nothing else in the document moved. */
function guardCountsOnlyAdded(before, after, layerPath) {
  var delta = guardCountsDelta(before, after);
  return !delta.structureChanged && delta.totalDelta === 1 && delta.changed.length === 1 &&
    delta.changed[0].delta === 1 && mutationSameSequence(delta.changed[0].path, layerPath);
}
`;
