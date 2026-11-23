export const EDIT_SESSION_CAPACITY_SCRIPT = `
function sessionCapacityRefuse(context, addedItems, code, subject) {
  if (MUTATION_EDIT_SESSION === null) return;
  var session = editSessionForPath(context.path, context.key);
  if (session === null) return;
  var maxItems = EDIT_SESSION_ADMISSION_INPUT.maxItems;
  var current = session.itemTotal - MUTATION_EDIT_SESSION.beforeStructure.layerCount;
  if (current + addedItems > maxItems) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: code, message: subject + " adds " + addedItems + " items to the " + current + " the edit session holds, above its limit of " + maxItems + "; nothing was changed. Close the session to create it, or create it before opening the session." }));
  }
}
`;
