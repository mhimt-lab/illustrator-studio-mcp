import { OBJECT_WALK_HELPERS, OBJECT_WITNESS_HELPERS, READ_PAGE_ITEM_AT_HELPER } from './page-item-walk.js';
export const PAGE_ITEM_RESOLVE_DEADLINE_MS = 10_000;
export const PAGE_ITEM_RESOLVE_HOST_SCRIPT = `${READ_PAGE_ITEM_AT_HELPER}${OBJECT_WITNESS_HELPERS}${OBJECT_WALK_HELPERS}
var params;
var PAGE_ITEM_RESOLVE_DEADLINE_MS = ${PAGE_ITEM_RESOLVE_DEADLINE_MS};
var scanStartedAt = 0;
var scanTotal = 0;
var scanVisited = 0;
var scanTicks = 0;
var resolveWalkFound = { walkFound: true };

function resolveError(message) {
  var error = new Error(message);
  error.mutationReasonCode = "preflight_failed";
  error.mutationPublicMessage = message;
  return error;
}

function resolveReadUuidAndType(item) {
  try { return { uuid: String(item.uuid), typename: String(item.typename) }; } catch (readError) { return null; }
}

function resolveViaNativeUuid(doc, uuid) {
  var startedAt = new Date().getTime();
  var item = null;
  try { item = doc.getPageItemFromUuid(uuid); } catch (lookupError) { item = null; }
  if (item === undefined || item === null) return null;
  var answer = resolveReadUuidAndType(item);
  if (answer === null || answer.uuid !== uuid) return null;
  if (answer.typename === "PathItem" || answer.typename === "TextFrame") return { item: item, typename: answer.typename, route: "native" };
  var siblings = null;
  try {
    var parent = item.parent;
    var parentType = String(parent.typename);
    if (parentType === "Layer" || parentType === "GroupItem") siblings = parent.pageItems;
    else if (parentType === "CompoundPathItem") siblings = parent.pathItems;
  } catch (parentError) { siblings = null; }
  if (siblings === null || siblings === undefined) return null;
  var count = siblings.length;
  for (var siblingIndex = 0; siblingIndex < count; siblingIndex++) {
    if ((siblingIndex & 15) === 0 && new Date().getTime() - startedAt > PAGE_ITEM_RESOLVE_DEADLINE_MS) return null;
    var entry = readPageItemAt("parent.collection", siblingIndex, function () {
      var candidate = siblings[siblingIndex];
      return String(candidate.uuid) === uuid ? candidate : null;
    });
    if (entry !== null) return { item: entry, typename: String(entry.typename), route: "parent" };
  }
  return null;
}

function resolveScanBegin(doc) {
  if (typeof params !== "object" || params === null) params = {};
  params.deadlineMs = PAGE_ITEM_RESOLVE_DEADLINE_MS;
  scanStartedAt = new Date().getTime();
  scanTotal = doc.pageItems.length;
  scanVisited = 0;
  scanTicks = 0;
}

function resolveViaWalk(doc, uuid) {
  resolveScanBegin(doc);
  var foundItem = null;
  try {
    walkDocumentTree(doc, function (item) {
      if (String(item.uuid) === uuid) { foundItem = item; throw resolveWalkFound; }
    });
  } catch (walkError) {
    if (walkError === resolveWalkFound) return { item: foundItem, typename: String(foundItem.typename), route: "walk" };
    var text = walkError && walkError.message ? String(walkError.message) : "";
    if (String(text).indexOf("READ_SCAN_DEADLINE") >= 0 || String(text).indexOf("READ_WALK_INCOMPLETE") >= 0) {
      throw resolveError("The document could not be searched completely for the target UUID within " + PAGE_ITEM_RESOLVE_DEADLINE_MS + " ms, so its absence is unproven.");
    }
    throw walkError;
  }
  if (scanVisited !== scanTotal) {
    throw resolveError("The document walk reached " + scanVisited + " of " + scanTotal + " page items, so the absence of the target UUID is unproven.");
  }
  return null;
}

/** The direct-reference route only (no walk): null when it cannot answer. For a caller whose own fallback decides what absence means. */
function resolvePageItemDirect(doc, uuid) {
  return resolveViaNativeUuid(doc, uuid);
}

function resolvePageItem(doc, uuid) {
  var fast = resolveViaNativeUuid(doc, uuid);
  if (fast !== null) return fast;
  return resolveViaWalk(doc, uuid);
}
`;
