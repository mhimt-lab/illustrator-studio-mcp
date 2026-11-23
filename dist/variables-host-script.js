import { RECORDED_CHARACTER_NAMES, RECORDED_EXTRA_CHARACTER_LABELS } from './adapters/text-recorded-profile.js';
export const DATASET_MAX_BOUND = 500;
export const DATASET_MAX_TEXT = 2_000;
export const DATASET_MAX_TEXT_TOTAL = 20_000;
export const DATASET_MAX_ITEMS = 20_778;
export const DATASET_SCAN_DEADLINE_MS = 4_000;
export const DATASET_MAX_VARIABLES = 256;
export const DATASET_MAX_DATASETS = 512;
export const DATASET_HOST_TIMEOUT_MS = 60_000;
export const DATASET_SNAPSHOT_BUDGET_MS = 5_000;
export const DATASET_LATER_BUDGET_MS = 10_000;
export const DATASET_PREFLIGHT_MAX_MS = 6_000;
export const DATASET_CHARACTER_ATTRIBUTES = Object.freeze([...new Set([
        'size', 'textFont', 'fillColor', 'strokeColor', 'tracking', 'horizontalScale', 'verticalScale', 'leading', 'autoLeading', 'kerning',
        ...RECORDED_CHARACTER_NAMES, ...RECORDED_EXTRA_CHARACTER_LABELS,
    ])]);
export const VARIABLE_KINDS = ['textual', 'visibility', 'image', 'graph', 'unknown'];
export const BINDING_PROPERTIES = ['content', 'visibility'];
export const DATASET_HOST_HELPERS = `
var DV_MAX_BOUND = ${DATASET_MAX_BOUND}, DV_MAX_TEXT = ${DATASET_MAX_TEXT}, DV_MAX_TEXT_TOTAL = ${DATASET_MAX_TEXT_TOTAL}, DV_MAX_ITEMS = ${DATASET_MAX_ITEMS};
var DV_MAX_VARIABLES = ${DATASET_MAX_VARIABLES}, DV_MAX_DATASETS = ${DATASET_MAX_DATASETS}, DV_DEADLINE_MS = ${DATASET_SCAN_DEADLINE_MS};
var DV_ATTRIBUTES = ${JSON.stringify(DATASET_CHARACTER_ATTRIBUTES)};
var DV_KIND_NAMES = { "VariableKind.TEXTUAL": "textual", "VariableKind.VISIBILITY": "visibility", "VariableKind.IMAGE": "image", "VariableKind.GRAPH": "graph" };
var dvScanMs = [];
var scanStartedAt = 0, scanTotal = 0, scanVisited = 0, scanTicks = 0;
function dvKindOf(variable) {
  var raw = String(variable.kind);
  return DV_KIND_NAMES.hasOwnProperty(raw) ? DV_KIND_NAMES[raw] : "unknown";
}
function dvAddReason(list, code) { var i; for (i = 0; i < list.length; i++) if (list[i] === code) return; list.push(code); }
function dvNum(value) { return String(Math.round(value * 1000000) / 1000000); }
// The name of the variable an item property names: null when unbound or undefined, "!unreadable" when the read throws.
function dvBindName(item, key) {
  var bound;
  try { bound = item[key]; if (bound === null || bound === undefined) return null; return String(bound.name); }
  catch (readError) { return "!unreadable"; }
}
function dvBounds(item) {
  var text = "", i, b;
  try { b = item.geometricBounds; for (i = 0; i < 4; i++) text += (i > 0 ? "," : "") + dvNum(b[i]); return text; }
  catch (boundsError) { return "!"; }
}
// A colour as a canonical token. RGB, CMYK and Gray list their channels; a spot colour lists its name and tint (the repository's own read, edit-session-jsx.ts). Every other
// type (gradient, pattern, Lab, unknown) cannot be written out in full, so it is "err:": the caller refuses a text it cannot prove uniform.
function dvColorSig(color) {
  var type;
  if (color === null || color === undefined) return "none";
  type = String(color.typename);
  if (type === "NoColor") return type;
  if (type === "RGBColor") return type + ":" + dvNum(color.red) + "," + dvNum(color.green) + "," + dvNum(color.blue);
  if (type === "CMYKColor") return type + ":" + dvNum(color.cyan) + "," + dvNum(color.magenta) + "," + dvNum(color.yellow) + "," + dvNum(color.black);
  if (type === "GrayColor") return type + ":" + dvNum(color.gray);
  if (type === "SpotColor") {
    try { return type + ":" + String(color.spot.name) + ":" + dvNum(color.tint); }
    catch (spotError) { return "err:spot"; }
  }
  return "err:" + type;
}
// One character attribute as a canonical token. A read that throws is "err:<number>": the caller refuses a frame it cannot prove uniform.
function dvAttrValue(attrs, name) {
  var value;
  try { value = attrs[name]; } catch (readError) { return "err:" + (readError && typeof readError.number === "number" ? readError.number : "x"); }
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "number") return isFinite(value) ? dvNum(value) : "nonfinite";
  if (typeof value === "boolean" || typeof value === "string") return String(value);
  try {
    if (name === "textFont") return "font:" + String(value.name);
    if (name === "fillColor" || name === "strokeColor") return dvColorSig(value);
    return String(value);
  } catch (objectError) { return "err:" + (objectError && typeof objectError.number === "number" ? objectError.number : "x"); }
}
function dvHashText(text) {
  var lanes = [0, 0, 0], hashed = witnessText(text);
  lanes[0] = hashed[0]; lanes[1] = hashed[1]; lanes[2] = (hashed[0] ^ hashed[1]) >>> 0;
  return witnessHex(lanes[0]) + witnessHex(lanes[1]) + witnessHex(lanes[2]);
}
// Is the text of a frame one run: every character carries the same value for every attribute of DV_ATTRIBUTES? Reads stop at the first difference (a refusal), at the first
// attribute that cannot be read, at the character or time limit. count 0 = empty, 1 = one run (sig = hash of its attribute values), 2 = several, unreadable / skipped = refused.
function dvRuns(frame, budget, deadline) {
  var chars = frame.textRange.characters, n = chars.length, first = null, i, j, attrs, key, token;
  if (n > DV_MAX_TEXT || n > budget.left) return { skipped: true };
  for (i = 0; i < n; i++) {
    if (new Date().getTime() > deadline) return { skipped: true };
    attrs = chars[i].characterAttributes; key = "";
    for (j = 0; j < DV_ATTRIBUTES.length; j++) {
      token = dvAttrValue(attrs, DV_ATTRIBUTES[j]);
      if (token.substring(0, 4) === "err:") return { unreadable: DV_ATTRIBUTES[j] };
      key += token + "\\u0001";
    }
    if (first === null) first = key; else if (key !== first) return { count: 2 };
  }
  return { count: n === 0 ? 0 : 1, sig: first === null ? "" : dvHashText(first) };
}
// One bound item. \`state\` fields are read only when wanted: the plan and the checks need them, a plain list does not.
function dvRow(item, kind, variableName, variableIndex, rank, wantState, textBudget, deadline) {
  var type = String(item.typename), property = kind === "visibility" ? "visibility" : "content", row, runs, layer;
  row = { variable: variableIndex, rank: rank, property: property, item: item, type: type, uuid: String(item.uuid), name: String(item.name), reasons: [] };
  row.confirmed = dvBindName(item, property === "content" ? "contentVariable" : "visibilityVariable") === variableName;
  if (!row.confirmed) row.reasons.push("binding_unconfirmed");
  if ((kind === "textual" && type !== "TextFrame") || (kind === "image" && type !== "PlacedItem")) row.reasons.push("unsupported_bound_type");
  try { layer = String(item.layer.name); } catch (layerError) { layer = "!"; }
  row.layer = layer;
  if (!wantState) return row;
  row.locked = item.locked === true; row.hidden = item.hidden === true; row.opacity = dvNum(item.opacity); row.bounds = dvBounds(item);
  if (type === "TextFrame") {
    row.contents = String(item.contents);
    // Several paragraphs: the paragraph formatting of a display is unmeasured (the recorded point-text profile admits a single line only), so it is refused as well.
    if (String(row.contents).indexOf("\\r") >= 0) row.reasons.push("multi_paragraph_text");
    runs = dvRuns(item, textBudget, deadline);
    row.runCount = 0; row.runs = "";
    if (runs.skipped === true) row.reasons.push("text_too_long");
    else if (runs.unreadable !== undefined) row.reasons.push("text_attribute_unreadable");
    else {
      textBudget.left -= row.contents.length;
      row.runCount = runs.count; row.runs = runs.sig === undefined ? "" : runs.sig;
      if (runs.count > 1) row.reasons.push("multi_run_text");
    }
  } else if (type === "PlacedItem") {
    try { row.file = String(item.file.fsName); } catch (fileError) { row.file = "!"; row.reasons.push("binding_unconfirmed"); }
  }
  return row;
}
function dvStateText(row) {
  return [row.type, row.name, row.layer, row.locked ? "1" : "0", row.hidden ? "1" : "0", row.opacity, row.bounds, row.contents === undefined ? "-" : "c" + row.contents.length + ":" + row.contents,
    row.runs === undefined ? "-" : row.runs, row.file === undefined ? "-" : row.file].join("|");
}
function dvDisplayed(doc) {
  var active, name, i;
  if (doc.dataSets.length === 0) return { status: "none", name: null };
  try {
    active = doc.activeDataSet;
    if (active === null || active === undefined) return { status: "none", name: null };
    name = String(active.name);
  } catch (activeError) { return { status: "unavailable", name: null }; }
  for (i = 0; i < doc.dataSets.length; i++) if (String(doc.dataSets[i].name) === name) return { status: "readable", name: name };
  return { status: "unavailable", name: null };
}
function dvSelection(doc) {
  var selection = doc.selection, items = [], i;
  if (selection === null || selection === undefined) return { count: 0, items: [] };
  if (typeof selection.typename === "string") return { count: -1, items: [] };
  for (i = 0; i < selection.length && i < 20; i++) items.push({ type: String(selection[i].typename), name: String(selection[i].name) });
  return { count: selection.length, items: items };
}
function dvStructure(doc) {
  var boards = [], i, rect, j, text;
  for (i = 0; i < doc.artboards.length; i++) {
    rect = doc.artboards[i].artboardRect; text = [];
    for (j = 0; j < 4; j++) text.push(Math.round(rect[j] * 1000000) / 1000000);
    boards.push({ name: String(doc.artboards[i].name), rect: text });
  }
  return { items: doc.pageItems.length, layers: doc.layers.length, boards: boards };
}
// Every variable with the items bound to it (in the order of its \`pageItems\`), the datasets, the displayed dataset. Stops reading bound items past the limit.
function dvSnapshot(doc, wantState, budgetMs) {
  var deadline = new Date().getTime() + (budgetMs === undefined ? DV_DEADLINE_MS : budgetMs);
  var out = { variables: [], datasets: [], locked: doc.variablesLocked === true, boundCount: 0, scanComplete: true, graph: false, unknownKind: false }, textBudget = { left: DV_MAX_TEXT_TOTAL };
  var i, j, variable, kind, name, items, rows, row;
  if (doc.variables.length > DV_MAX_VARIABLES || doc.dataSets.length > DV_MAX_DATASETS) { out.scanComplete = false; return out; }
  for (i = 0; i < doc.dataSets.length; i++) out.datasets.push(String(doc.dataSets[i].name));
  out.displayed = dvDisplayed(doc);
  for (i = 0; i < doc.variables.length; i++) {
    variable = doc.variables[i]; kind = dvKindOf(variable); name = String(variable.name); items = variable.pageItems; rows = [];
    if (kind === "graph") out.graph = true;
    if (kind === "unknown") out.unknownKind = true;
    for (j = 0; j < items.length; j++) {
      if (out.boundCount >= DV_MAX_BOUND) { out.scanComplete = false; break; }
      row = dvRow(items[j], kind, name, i, j, wantState, textBudget, deadline);
      rows.push(row); out.boundCount++;
    }
    out.variables.push({ index: i, name: name, kind: kind, bound: items.length, rows: rows });
  }
  return out;
}
function dvAddLane(lanes, text) {
  var hashed = witnessText(text);
  lanes[0] = (lanes[0] + hashed[0]) >>> 0; lanes[1] = (lanes[1] + hashed[1]) >>> 0; lanes[2] = (lanes[2] + ((hashed[0] ^ hashed[1]) >>> 0)) >>> 0;
}
function dvLaneHex(lanes) { return witnessHex(lanes[0]) + witnessHex(lanes[1]) + witnessHex(lanes[2]); }
// The items outside every binding: their count and a witness of uuid, type, name and bounds. Bound items are left out by their uuid in the same read.
function dvWitness(doc, snapshot) {
  var bound = {}, lanes = [0, 0, 0], count = 0, i, j;
  for (i = 0; i < snapshot.variables.length; i++) for (j = 0; j < snapshot.variables[i].rows.length; j++) bound["u:" + snapshot.variables[i].rows[j].uuid] = true;
  params.deadlineMs = DV_DEADLINE_MS;
  scanStartedAt = new Date().getTime(); scanTotal = doc.pageItems.length; scanVisited = 0; scanTicks = 0;
  if (scanTotal > DV_MAX_ITEMS) throw mutationError("preflight_failed", "Artwork count " + scanTotal + " exceeds the " + DV_MAX_ITEMS + "-item limit.");
  try {
    walkDocumentTree(doc, function (item, typeName, layerInfo) {
      var uuid = String(item.uuid);
      if (bound.hasOwnProperty("u:" + uuid)) return;
      count++;
      dvAddLane(lanes, uuid + "|" + typeName + "|" + String(item.name) + "|" + layerInfo.name + "|" + dvBounds(item));
    });
  } catch (walkError) {
    if (String(walkError && walkError.message).indexOf("READ_SCAN_DEADLINE") >= 0) throw mutationError("preflight_failed", "The artwork scan exceeded " + DV_DEADLINE_MS + " ms; no complete witness is available.");
    throw walkError;
  }
  if (scanVisited !== scanTotal) throw mutationError("preflight_failed", "The artwork walk reached " + scanVisited + " of " + scanTotal + " page items, so the identity is incomplete.");
  dvScanMs.push(new Date().getTime() - scanStartedAt);
  return { count: count, witness: dvLaneHex(lanes) };
}
`;
