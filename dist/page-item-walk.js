export const READ_PAGE_ITEM_AT_HELPER = `
// An invalid reference while reading one item fails the whole read with its route and index; it is never skipped.
function readPageItemAt(route, index, read) {
  try { return read(); }
  catch (readError) {
    if (!isHostReferenceInvalidError(readError)) throw readError;
    throw new Error(hostReferenceInvalidMessage({ route: route, index: index, hostError: hostErrorEvidence(readError) }));
  }
}
`;
export const OBJECT_WITNESS_HELPERS = `
function createSnapshotWitness() { return { a: 0, b: 0, c: 0, d: 0 }; }

function witnessText(text) {
  var p = 5381;
  var q = 7;
  for (var charIndex = 0; charIndex < text.length; charIndex++) {
    var code = text.charCodeAt(charIndex);
    p = (p * 33 + code) >>> 0;
    q = (q * 131 + code + 1) >>> 0;
  }
  return [p, q];
}

function witnessNumber(value) {
  var scaled = Math.round(value * 1000000) % 4294967296;
  if (scaled < 0) scaled += 4294967296;
  return scaled;
}

function addSnapshotWitness(witness, summary, layerWitness, typeWitness, position) {
  var uuid = witnessText(summary.uuid);
  var name = witnessText(summary.name);
  var p = uuid[0];
  var q = uuid[1];
  p = (p * 65599 + name[0]) >>> 0; q = (q * 65537 + name[1]) >>> 0;
  p = (p * 65599 + typeWitness[0]) >>> 0; q = (q * 65537 + typeWitness[1]) >>> 0;
  p = (p * 65599 + layerWitness[0]) >>> 0; q = (q * 65537 + layerWitness[1]) >>> 0;
  for (var boundsIndex = 0; boundsIndex < 4; boundsIndex++) {
    var scaled = witnessNumber(summary.bounds[boundsIndex]);
    p = (p * 65599 + scaled) >>> 0;
    q = (q * 65537 + scaled + 1) >>> 0;
  }
  witness.a = (witness.a * 65599 + p) >>> 0;
  witness.b = (witness.b * 65537 + q) >>> 0;
  witness.c = (witness.c + p * ((position % 4093) + 1)) >>> 0;
  witness.d = (witness.d + q) >>> 0;
}

function witnessHex(value) { return ("00000000" + value.toString(16)).slice(-8); }

function finishSnapshotWitness(witness) {
  return witnessHex(witness.a) + witnessHex(witness.b) + witnessHex(witness.c) + witnessHex(witness.d);
}
`;
export const OBJECT_WALK_HELPERS = `
function readScanFailure(code, extra) {
  var payload = { code: code, scanned: scanVisited, total: scanTotal, elapsedMs: new Date().getTime() - scanStartedAt, deadlineMs: params.deadlineMs };
  for (var key in extra) if (extra.hasOwnProperty(key)) payload[key] = extra[key];
  throw new Error("MCP_ERROR:" + stringifyJson(payload));
}

function scanTick() {
  if ((scanTicks++ & 15) === 0 && new Date().getTime() - scanStartedAt > params.deadlineMs) readScanFailure("READ_SCAN_DEADLINE", {});
}

var walkCompoundGroups = {};

function collectCompoundGroups(doc) {
  walkCompoundGroups = {};
  var groups = doc.groupItems;
  var count = groups.length;
  for (var groupIndex = 0; groupIndex < count; groupIndex++) {
    scanTick();
    readPageItemAt("document.groupItems", groupIndex, function () {
      var group = groups[groupIndex];
      var parent = group.parent;
      if (parent.typename !== "CompoundPathItem") return null;
      var parentKey = "c" + String(parent.uuid);
      if (!walkCompoundGroups.hasOwnProperty(parentKey)) walkCompoundGroups[parentKey] = [];
      walkCompoundGroups[parentKey].push(group);
      return null;
    });
  }
}

function walkPageItems(collection, layerInfo, route, visit) {
  var count = collection.length;
  for (var itemIndex = 0; itemIndex < count; itemIndex++) {
    scanTick();
    var step = readPageItemAt(route, scanVisited, function () {
      var item = collection[itemIndex];
      var typeName = item.typename;
      scanVisited++;
      visit(item, typeName, layerInfo);
      if (typeName === "GroupItem") return { children: item.pageItems, extra: null };
      if (typeName === "CompoundPathItem") {
        var extra = walkCompoundGroups["c" + String(item.uuid)];
        return { children: item.pathItems, extra: extra === undefined ? null : extra };
      }
      return null;
    });
    if (step === null) continue;
    if (step.children === undefined) readScanFailure("READ_WALK_INCOMPLETE", { reason: "children_unavailable" });
    walkPageItems(step.children, layerInfo, "pageItem.children", visit);
    if (step.extra !== null) walkPageItems(step.extra, layerInfo, "compound.groups", visit);
  }
}

function walkLayerTree(layers, parentPath, visit) {
  var count = layers.length;
  for (var layerIndex = 0; layerIndex < count; layerIndex++) {
    var layer = layers[layerIndex];
    var path = parentPath.concat([layerIndex]);
    var name = layer.name || "";
    var layerInfo = { path: path, name: name, witness: witnessText(name + "\\u0001" + path.join(",")) };
    walkPageItems(layer.pageItems, layerInfo, "layer.pageItems", visit);
    walkLayerTree(layer.layers, path, visit);
  }
}

function walkDocumentTree(doc, visit) {
  collectCompoundGroups(doc);
  walkLayerTree(doc.layers, [], visit);
}
`;
