export const ANCESTOR_STATE_MAX_DEPTH = 32;
export const ANCESTOR_STATE_SCRIPT = `
function mutationAncestorState(item) {
  var state = { ancestorLocked: false, ancestorHidden: false };
  var node = item.parent, depth = 0, ownLayerSeen = false;
  while (true) {
    if (!node) throw mutationError("preflight_failed", "Target ancestor state is unavailable.");
    var type = String(node.typename);
    if (type === "Document") return state;
    if (++depth > ${ANCESTOR_STATE_MAX_DEPTH}) throw mutationError("preflight_failed", "Target ancestor state is unavailable.");
    var hidden = type === "Layer" ? (typeof node.visible === "boolean" ? !node.visible : null) : node.hidden;
    if (typeof node.locked !== "boolean" || typeof hidden !== "boolean") {
      throw mutationError("preflight_failed", "Target ancestor state is unavailable.");
    }
    if (type !== "Layer" || ownLayerSeen) {
      if (node.locked) state.ancestorLocked = true;
      if (hidden) state.ancestorHidden = true;
    }
    if (type === "Layer") ownLayerSeen = true;
    node = node.parent;
  }
}
`;
