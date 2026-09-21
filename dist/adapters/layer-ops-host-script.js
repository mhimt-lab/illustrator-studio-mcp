import { LAYER_NAME_MAX_LENGTH, LAYER_OPS_MAX_DEPTH, LAYER_OPS_MAX_SIBLINGS } from './layer-ops-shared.js';
export const LAYER_OPS_HOST_SCRIPT = `
var LAYER_OPS_MAX_SIBLINGS = ${LAYER_OPS_MAX_SIBLINGS};
var LAYER_OPS_MAX_DEPTH = ${LAYER_OPS_MAX_DEPTH};
var LAYER_NAME_MAX_LENGTH = ${LAYER_NAME_MAX_LENGTH};

function layerOpsBool(value, what) {
  if (typeof value !== "boolean") throw mutationError("preflight_failed", what + " is unavailable.");
  return value;
}
function layerOpsCount(collection, what) {
  if (!collection || typeof collection.length !== "number") throw mutationError("preflight_failed", what + " is unavailable.");
  return collection.length;
}
/** Resolves a root-relative path to its layer chain; an empty path (allowed only when allowRoot) is the document root. */
function layerOpsResolvePath(document, path, allowRoot) {
  if (!path || typeof path.length !== "number" || path.length > LAYER_OPS_MAX_DEPTH || (path.length < 1 && !allowRoot)) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "LAYER_PATH_INVALID", reasonCodes: ["layer_path_invalid"] }));
  }
  var collection = document.layers;
  var chain = [];
  for (var depth = 0; depth < path.length; depth++) {
    var index = path[depth];
    if (typeof index !== "number" || !(index >= 0) || Math.floor(index) !== index || index >= collection.length) {
      throw new Error("MCP_ERROR:" + stringifyJson({ code: "LAYER_PATH_NOT_FOUND", reasonCodes: ["layer_path_not_found"], layerPath: path }));
    }
    var layer = collection[index];
    chain.push(layer);
    collection = layer.layers;
  }
  return chain;
}
function layerOpsContainerOf(document, chain) { return chain.length === 0 ? document : chain[chain.length - 1]; }
function layerOpsEntry(layer) {
  return { name: String(layer.name), visible: layerOpsBool(layer.visible, "Layer visibility"), locked: layerOpsBool(layer.locked, "Layer lock state"),
    printable: layerOpsBool(layer.printable, "Layer printable state"), childLayerCount: layerOpsCount(layer.layers, "Layer sublayers"), pageItemCount: layerOpsCount(layer.pageItems, "Layer page items") };
}
/** Complete front-first structural order of a container's direct layers. */
function layerOpsOrder(container) {
  var collection = container.layers;
  var count = layerOpsCount(collection, "Layer collection");
  if (count > LAYER_OPS_MAX_SIBLINGS) throw mutationError("preflight_failed", "A layer container must hold at most " + LAYER_OPS_MAX_SIBLINGS + " direct layers.");
  var order = [];
  for (var index = 0; index < count; index++) order.push(layerOpsEntry(collection[index]));
  return order;
}
/** Ancestor flags over chain[0 .. chain.length - 1 - skipLast]. */
function layerOpsAncestorState(chain, skipLast) {
  var visible = true, locked = false;
  for (var index = 0; index < chain.length - (skipLast ? 1 : 0); index++) {
    if (layerOpsBool(chain[index].visible, "Ancestor visibility") !== true) visible = false;
    if (layerOpsBool(chain[index].locked, "Ancestor lock state") === true) locked = true;
  }
  return { ancestorVisible: visible, ancestorLocked: locked };
}
function layerOpsTargetSnapshot(chain, path) {
  var layer = chain[chain.length - 1];
  var entry = layerOpsEntry(layer);
  var ancestors = layerOpsAncestorState(chain, true);
  return { path: path, name: entry.name, visible: entry.visible, locked: entry.locked, printable: entry.printable, childLayerCount: entry.childLayerCount,
    pageItemCount: entry.pageItemCount, ancestorVisible: ancestors.ancestorVisible, ancestorLocked: ancestors.ancestorLocked };
}
function layerOpsContainerSnapshot(document, chain, path) {
  if (chain.length === 0) {
    return { path: path, name: null, visible: true, locked: false, printable: true, childLayerCount: layerOpsCount(document.layers, "Document layers"),
      pageItemCount: null, ancestorVisible: true, ancestorLocked: false };
  }
  return layerOpsTargetSnapshot(chain, path);
}
function layerOpsSameEntry(left, right) {
  return left.name === right.name && left.visible === right.visible && left.locked === right.locked && left.printable === right.printable &&
    left.childLayerCount === right.childLayerCount && left.pageItemCount === right.pageItemCount;
}
function layerOpsSameOrder(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  for (var index = 0; index < left.length; index++) if (!layerOpsSameEntry(left[index], right[index])) return false;
  return true;
}
function layerOpsSameTarget(left, right) {
  return mutationSameSequence(left.path, right.path) && left.name === right.name && left.visible === right.visible && left.locked === right.locked &&
    left.printable === right.printable && left.childLayerCount === right.childLayerCount && left.pageItemCount === right.pageItemCount &&
    left.ancestorVisible === right.ancestorVisible && left.ancestorLocked === right.ancestorLocked;
}
function layerOpsValidName(name) {
  if (typeof name !== "string" || name.length < 1 || name.length > LAYER_NAME_MAX_LENGTH) return false;
  if (name.replace(/^\\s+|\\s+$/g, "") !== name) return false;
  for (var index = 0; index < name.length; index++) { var code = name.charCodeAt(index); if (code < 32 || code === 127) return false; }
  return true;
}
function layerOpsIndexOfRef(collection, reference) { for (var index = 0; index < collection.length; index++) if (collection[index] === reference) return index; return -1; }
function layerOpsInsert(order, index, entry) {
  if (typeof index !== "number" || Math.floor(index) !== index || index < 0 || index > order.length) throw mutationError("preflight_failed", "Layer insertion index is out of range.");
  var result = order.slice(0, index); result.push(entry); return result.concat(order.slice(index));
}
function layerOpsReorder(order, fromIndex, toIndex) {
  if (typeof toIndex !== "number" || Math.floor(toIndex) !== toIndex || toIndex < 0 || toIndex >= order.length) throw mutationError("preflight_failed", "Layer destination index is out of range.");
  var entry = order[fromIndex]; var rest = [];
  for (var index = 0; index < order.length; index++) if (index !== fromIndex) rest.push(order[index]);
  var result = rest.slice(0, toIndex); result.push(entry); return result.concat(rest.slice(toIndex));
}
function layerOpsReplace(order, index, entry) { var result = order.slice(0); result[index] = entry; return result; }
function layerOpsBlockers(context, target, targetStateBlocks, targetIsAncestor) {
  var blockers = [];
  if (!context.mutationAllowed) blockers.push("document_mutation_not_allowed");
  if (targetIsAncestor) {
    if (!target.visible || !target.ancestorVisible) blockers.push("ancestor_hidden");
    if (target.locked || target.ancestorLocked) blockers.push("ancestor_locked");
    return blockers;
  }
  if (targetStateBlocks && !target.visible) blockers.push("layer_hidden");
  if (targetStateBlocks && target.locked) blockers.push("layer_locked");
  if (!target.ancestorVisible) blockers.push("ancestor_hidden");
  if (target.ancestorLocked) blockers.push("ancestor_locked");
  return blockers;
}
/** Root-relative path of a layer reference, found by walking the tree; null when the reference is not a document layer. */
function layerOpsPathOfLayer(document, reference) {
  function walk(collection, prefix) {
    for (var index = 0; index < collection.length; index++) {
      var candidate = collection[index];
      var path = prefix.concat([index]);
      if (candidate === reference) return path;
      var nested = walk(candidate.layers, path);
      if (nested !== null) return nested;
    }
    return null;
  }
  return walk(document.layers, []);
}
function layerOpsRequireSameDocument(document, phaseReason) {
  if (app.documents.length === 0 || app.activeDocument !== document) throw mutationError(phaseReason, "The active document changed during the layer transaction.");
}
`;
