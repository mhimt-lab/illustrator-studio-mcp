export const WINDOWS_STRUCTURE_READ_MAX_PAGE_ITEMS = 1_000;
export const STRUCTURE_READ_COUNT_SCRIPT = `
var structureCountContext = requireDocumentForRead(params.expectedDocumentKey);
var result = { document: structureCountContext, totalPageItems: app.activeDocument.pageItems.length };
`;
export const STRUCTURE_READ_COUNT_GUARD = `
requireDocumentForRead(params.expectedDocumentKey);
var budgetItemCount = app.activeDocument.pageItems.length;
if (budgetItemCount > params.maxPageItems) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "STRUCTURE_SNAPSHOT_TOO_LARGE",
    collection: "pageItems", total: budgetItemCount, limit: params.maxPageItems }));
}
if (budgetItemCount !== params.budgetItemCount) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "STRUCTURE_SNAPSHOT_CHANGED" }));
}
`;
