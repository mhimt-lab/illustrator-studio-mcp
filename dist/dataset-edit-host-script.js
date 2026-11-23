import { DATASET_LATER_BUDGET_MS, DATASET_PREFLIGHT_MAX_MS, DATASET_SNAPSHOT_BUDGET_MS } from './variables-host-script.js';
export const DATASET_EDIT_MAX_LISTED = 20;
export const DATASET_EDIT_HELPERS = `
var DE_SNAPSHOT_BUDGET = ${DATASET_SNAPSHOT_BUDGET_MS}, DE_LATER_BUDGET = ${DATASET_LATER_BUDGET_MS}, DE_PREFLIGHT_MAX = ${DATASET_PREFLIGHT_MAX_MS}, DE_MAX_LISTED = ${DATASET_EDIT_MAX_LISTED};
var DE_ZERO = "000000000000000000000000", DE_FIELDS = ["name", "layer", "locked", "opacity", "bounds", "hidden", "contents", "runs", "file"];
function deFail(message) { throw mutationError("preflight_failed", message); }
function deSame(a, b) { return stringifyJson(a) === stringifyJson(b); }
function deHas(list, code) { var i; for (i = 0; i < list.length; i++) if (list[i] === code) return true; return false; }
function deOrder(found, order) {
  var out = [], i;
  for (i = 0; i < order.length; i++) if (deHas(found, order[i])) out.push(order[i]);
  return out;
}
function deBoundRows(snapshot) {
  var rows = [], i, j;
  for (i = 0; i < snapshot.variables.length; i++) for (j = 0; j < snapshot.variables[i].rows.length; j++) rows.push(snapshot.variables[i].rows[j]);
  return rows;
}
// \`identity\` binds the whole state including every uuid (the compare-and-set of an apply); \`state\` leaves out the uuids, the selection and the displayed dataset, so it is
// the same before and after a correct write-back (the proof of an inverse). The dataset list is part of both.
function deDigests(snapshot, structure, witness) {
  var identity = [0, 0, 0], state = [0, 0, 0], i, j, row, text, head;
  head = stringifyJson(structure) + "|" + (snapshot.locked ? "1" : "0") + "|" + witness.count + "|" + witness.witness;
  for (i = 0; i < snapshot.variables.length; i++) head += "|v" + i + ":" + snapshot.variables[i].name + ":" + snapshot.variables[i].kind + ":" + snapshot.variables[i].bound;
  for (i = 0; i < snapshot.datasets.length; i++) head += "|d" + i + ":" + snapshot.datasets[i];
  dvAddLane(state, head); dvAddLane(identity, head + "|" + (snapshot.displayed === undefined ? "-" : snapshot.displayed.status + ":" + snapshot.displayed.name));
  for (i = 0; i < snapshot.variables.length; i++) for (j = 0; j < snapshot.variables[i].rows.length; j++) {
    row = snapshot.variables[i].rows[j]; text = i + "|" + j + "|" + row.property + "|" + dvStateText(row);
    dvAddLane(state, text); dvAddLane(identity, text + "|" + row.uuid);
  }
  return { identity: dvLaneHex(identity), state: dvLaneHex(state) };
}
// The values the bound items show (what a dataset stores), as one digest: contents, hidden, file by variable and rank.
function deValuesDigest(snapshot) {
  var lanes = [0, 0, 0], i, j, row;
  for (i = 0; i < snapshot.variables.length; i++) for (j = 0; j < snapshot.variables[i].rows.length; j++) {
    row = snapshot.variables[i].rows[j];
    dvAddLane(lanes, i + "|" + j + "|" + snapshot.variables[i].kind + "|" + (snapshot.variables[i].kind === "visibility" ? (row.hidden ? "1" : "0") : (snapshot.variables[i].kind === "image" ? String(row.file) : String(row.contents))));
  }
  return dvLaneHex(lanes);
}
// The values of the bound items as plain data (no handles): what a write-back needs.
function deValueRows(snapshot) {
  var out = [], rows = deBoundRows(snapshot), i, row;
  for (i = 0; i < rows.length; i++) { row = rows[i]; out.push({ variable: row.variable, rank: row.rank, contents: row.contents, hidden: row.hidden, file: row.file, name: row.name, type: row.type, property: row.property }); }
  return out;
}
function deStateJson(row) {
  var state = { hidden: row.hidden };
  if (row.contents !== undefined) { state.textLength = row.contents.length; state.textPreview = row.contents.substring(0, 40); state.runCount = row.runCount; }
  if (row.file !== undefined) state.linkName = String(row.file).substring(String(row.file).lastIndexOf("/") + 1);
  return state;
}
function deBoundJson(snapshot) {
  var out = [], rows = deBoundRows(snapshot), i, row;
  for (i = 0; i < rows.length; i++) { row = rows[i]; out.push({ variable: row.variable, rank: row.rank, property: row.property, type: row.type, name: row.name, uuid: row.uuid, layer: row.layer, state: deStateJson(row) }); }
  return out;
}
// The value a dataset holds for each bound item, in the shape the report shows (no uuid, no layer).
function deValuesJson(valueRows) {
  var out = [], i, row, state;
  for (i = 0; i < valueRows.length; i++) {
    row = valueRows[i]; state = { hidden: row.hidden === true };
    if (row.contents !== undefined) { state.textLength = row.contents.length; state.textPreview = row.contents.substring(0, 40); }
    if (row.file !== undefined) state.linkName = String(row.file).substring(String(row.file).lastIndexOf("/") + 1);
    out.push({ variable: row.variable, rank: row.rank, property: row.property, type: row.type, name: row.name, value: state });
  }
  return out;
}
function deDisplayedJson(snapshot) {
  if (snapshot.displayed === undefined || snapshot.displayed.status === "unavailable") return { status: "unavailable" };
  if (snapshot.displayed.status === "none") return { status: "none" };
  return { status: "readable", name: snapshot.displayed.name };
}
function deBefore(snapshot, structure, witness, selection) {
  var variables = [], i;
  for (i = 0; i < snapshot.variables.length; i++) variables.push({ index: i, name: snapshot.variables[i].name, kind: snapshot.variables[i].kind, bound: snapshot.variables[i].bound });
  return { structure: structure, variablesLocked: snapshot.locked, variables: variables, datasets: snapshot.datasets, displayedDataset: deDisplayedJson(snapshot),
    bound: deBoundJson(snapshot), unbound: witness, selection: selection };
}
// The reasons that make a bound row refuse the change. \`textRestrictions\`: a display collapses a text of several runs, so a tool that displays refuses it; a tool that only reads does not
// (its rows with only those reasons are not listed, so many formatted texts never fail a plan on the list limit).
function deRefusing(reasons, textRestrictions) {
  var out = [], i, r;
  for (i = 0; i < reasons.length; i++) {
    r = reasons[i];
    if (r === "binding_unconfirmed" || r === "unsupported_bound_type" || r === "text_too_long") out.push(r);
    else if (textRestrictions && (r === "multi_run_text" || r === "multi_paragraph_text" || r === "text_attribute_unreadable")) out.push(r);
  }
  return out;
}
// Variables whose bound items do not all show one value: a dataset keeps one value per variable, and which item it takes is unmeasured, so what a create captures or an update stores is not defined.
function deDisagree(snapshot) {
  var out = [], i, j, first, value, kind, rows;
  for (i = 0; i < snapshot.variables.length; i++) {
    rows = snapshot.variables[i].rows; kind = snapshot.variables[i].kind; first = null;
    for (j = 0; j < rows.length; j++) {
      value = kind === "visibility" ? (rows[j].hidden ? "1" : "0") : (kind === "image" ? String(rows[j].file) : String(rows[j].contents));
      if (first === null) first = { value: value };
      else if (first.value !== value) { out.push(snapshot.variables[i].name); break; }
    }
  }
  return out;
}
function deClassify(snapshot, rows, found, messages, blocked, textRestrictions) {
  var i, row, reasons, disagree;
  for (i = 0; i < snapshot.variables.length; i++) {
    if (snapshot.variables[i].kind === "graph" && snapshot.variables[i].bound > 0) { found.push("graph_variable_bound"); messages.push("a graph variable is bound; the graph data cannot be read back, so a change could not be verified or undone"); }
    if (snapshot.variables[i].kind === "unknown" && snapshot.variables[i].bound > 0) { found.push("unsupported_variable_kind"); messages.push("a variable of an unknown kind is bound"); }
    if (snapshot.variables[i].bound === 0) { found.push("variable_without_bound_item"); messages.push("the variable " + snapshot.variables[i].name + " has no bound item; bind an item to it first (a dataset's value for it cannot be read or restored, and an update would erase it)"); }
  }
  disagree = deDisagree(snapshot);
  if (disagree.length > 0) { found.push("bound_values_disagree"); messages.push("the items bound to " + disagree.join(", ") + " show different values; make them agree first (which item a dataset takes its value from is unmeasured)"); }
  for (i = 0; i < rows.length; i++) {
    row = rows[i]; reasons = deRefusing(row.reasons, textRestrictions);
    if (reasons.length === 0) continue;
    if (deHas(reasons, "binding_unconfirmed") || deHas(reasons, "unsupported_bound_type")) found.push("bindings_incomplete");
    if (deHas(reasons, "text_too_long")) { found.push("text_too_long_to_verify"); messages.push("the text " + row.name + " is too long to read back within the time budget"); }
    if (deHas(reasons, "multi_run_text") || deHas(reasons, "multi_paragraph_text") || deHas(reasons, "text_attribute_unreadable")) {
      found.push("text_formatting_not_restorable");
      messages.push("the text " + row.name + (deHas(reasons, "multi_paragraph_text") ? " has several paragraphs (unmeasured)" : (deHas(reasons, "text_attribute_unreadable") ? " has a character attribute that cannot be read, so one run cannot be proved" : " has several runs")) + "; a display collapses the formatting and no write-back restores it");
    }
    if (blocked.length < DE_MAX_LISTED) blocked.push({ variable: row.variable, rank: row.rank, type: row.type, name: row.name, reasons: reasons });
    else deFail("More than " + DE_MAX_LISTED + " bound items block the change.");
  }
  if (!snapshot.scanComplete) { found.push("scan_limit_exceeded"); messages.push("more than " + DV_MAX_BOUND + " items are bound (or too many variables or datasets); split the work"); }
  return disagree;
}
function deMessage(blockers, messages) {
  var message;
  if (blockers.length === 0) return null;
  message = messages.join("; ");
  if (message.length > 500) message = message.substring(0, 497) + "...";
  if (message.length === 0) message = "The change is blocked: " + blockers.join(", ") + ".";
  return message;
}
function deAdmitted(context, profiles) {
  var i;
  if (!context.mutationAllowed) return false;
  for (i = 0; i < profiles.length; i++) if (context.mutationProfile === profiles[i]) return true;
  return false;
}
// The cheap re-checks of an apply right after its own preflight read the complete state: document, structure, lists, and the uuids of the bound items.
function deRevalidate(p, datasetSelector) {
  try {
    var i, j, items;
    if (app.documents.length === 0 || app.activeDocument !== p.document) deFail("Document reference changed before apply.");
    if (!deSame(dvStructure(p.document), p.structure)) deFail("The document structure changed before apply.");
    if (p.document.dataSets.length !== p.snapshot.datasets.length) deFail("The dataset list changed before apply.");
    if (datasetSelector !== null && String(p.document.dataSets[datasetSelector.index].name) !== datasetSelector.name) deFail("The dataset list changed before apply.");
    if (p.document.variables.length !== p.snapshot.variables.length) deFail("The variable list changed before apply.");
    for (i = 0; i < p.snapshot.variables.length; i++) {
      items = p.document.variables[i].pageItems;
      if (items.length !== p.snapshot.variables[i].rows.length) deFail("The items bound to a variable changed before apply.");
      for (j = 0; j < items.length; j++) if (String(items[j].uuid) !== p.snapshot.variables[i].rows[j].uuid) deFail("A bound item changed before apply.");
    }
  } catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "The bound items or the document changed before apply.")); }
}
// The time one read after the first may take: a tool that reads many times sets \`p.laterBudget\` from its own preflight read, so the sum stays inside the host timeout.
function deLater(p) { return p.laterBudget === undefined ? DE_LATER_BUDGET : p.laterBudget; }
function deRead(p) {
  if (app.documents.length === 0 || app.activeDocument !== p.document) throw mutationError("verify_mismatch", "Document reference changed.");
  var current = getDocumentContext();
  if (current.path !== p.context.path || current.fileRevision !== p.context.fileRevision || current.name !== p.context.name || current.appVersion !== p.context.appVersion) throw mutationError("verify_mismatch", "The document file identity changed after apply.");
  return { snapshot: dvSnapshot(p.document, true, deLater(p)), structure: dvStructure(p.document) };
}
// What a display may change on a bound item, by the binding kinds of the item (the union when it is bound twice).
function deAllowed(beforeRows) {
  var allowed = {}, i, row, set;
  for (i = 0; i < beforeRows.length; i++) {
    row = beforeRows[i]; set = allowed["u:" + row.uuid]; if (set === undefined) { set = {}; allowed["u:" + row.uuid] = set; }
    if (row.property === "visibility") set.hidden = true;
    else if (row.type === "TextFrame") { set.contents = true; set.bounds = true; }
    else if (row.type === "PlacedItem") { set.file = true; set.bounds = true; }
  }
  return allowed;
}
// A display must have changed only the attribute the variable kind implies, and left the formatting of a text that has characters alone.
function deCompareDisplay(baseSnapshot, after) {
  var beforeRows = deBoundRows(baseSnapshot), afterRows = deBoundRows(after), allowed = deAllowed(beforeRows), i, j, b, a, f, allow;
  if (beforeRows.length !== afterRows.length) throw mutationError("verify_mismatch", "The bound items could not be found again: " + afterRows.length + " of " + beforeRows.length + ".");
  for (i = 0; i < beforeRows.length; i++) {
    b = beforeRows[i]; a = afterRows[i]; allow = allowed["u:" + b.uuid];
    if (a.variable !== b.variable || a.rank !== b.rank || a.property !== b.property || a.type !== b.type || a.name !== b.name) throw mutationError("verify_mismatch", "A bound item could not be found again through its variable: " + b.name + ".");
    if (deHas(a.reasons, "binding_unconfirmed") || deHas(a.reasons, "unsupported_bound_type") || deHas(a.reasons, "text_too_long") || deHas(a.reasons, "text_attribute_unreadable") || deHas(a.reasons, "multi_run_text")) throw mutationError("verify_mismatch", "A bound item is unreadable after the display: " + b.name + ".");
    for (j = 0; j < DE_FIELDS.length; j++) {
      f = DE_FIELDS[j];
      if (b[f] === a[f]) continue;
      if (f === "runs") {
        if (b.runCount === 0 || a.runCount === 0) continue;
        throw mutationError("verify_mismatch", "The character formatting of " + b.name + " changed (runs); a write-back of the contents does not restore it.");
      }
      if (allow.hasOwnProperty(f) !== true) throw mutationError("verify_mismatch", "An attribute the dataset does not govern changed: " + f + " of " + b.name + ".");
    }
  }
}
// Items bound to one variable show one value after a display.
function deAgree(after) {
  var i, j, first, value;
  for (i = 0; i < after.variables.length; i++) {
    first = null;
    for (j = 0; j < after.variables[i].rows.length; j++) {
      value = after.variables[i].kind === "visibility" ? (after.variables[i].rows[j].hidden ? "1" : "0") : (after.variables[i].kind === "image" ? after.variables[i].rows[j].file : after.variables[i].rows[j].contents);
      if (first === null) first = { value: value }; else if (first.value !== value) throw mutationError("verify_mismatch", "Items bound to the variable " + after.variables[i].name + " do not show one value after the display.");
    }
  }
}
// Write the values of \`valueRows\` (aligned with the bound items by variable and rank) into the items of \`current\`: the contents and the visibility first, the links last (a link write gives
// the placed item a new uuid, so a handle read before it must not be used after it).
function deWriteValues(valueRows, current) {
  var rows = deBoundRows(current), pass, i, want, row, kind;
  if (rows.length !== valueRows.length) throw mutationError("verify_mismatch", "The bound items could not be found again to write the values back.");
  for (pass = 0; pass < 2; pass++) for (i = 0; i < rows.length; i++) {
    want = valueRows[i]; row = rows[i]; kind = current.variables[row.variable].kind;
    if (want.variable !== row.variable || want.rank !== row.rank || want.type !== row.type || want.name !== row.name) throw mutationError("verify_mismatch", "A bound item no longer matches its variable and rank: " + row.name + ".");
    if (pass === 0 && kind === "textual" && want.contents !== row.contents) row.item.contents = want.contents;
    else if (pass === 0 && kind === "visibility" && want.hidden !== row.hidden) row.item.hidden = want.hidden;
    else if (pass === 1 && kind === "image" && want.file !== row.file) row.item.file = new File(want.file);
  }
}
// Read the document again and, if the bound items are not in the state of \`targetDigest\`, write \`valueRows\` back and read once more. Returns the digests and the snapshot read last.
function deRestoreItems(doc, valueRows, targetDigest, budget) {
  var after = dvSnapshot(doc, true, budget === undefined ? DE_LATER_BUDGET : budget), witness, digests;
  if (!after.scanComplete) throw mutationError("verify_mismatch", "Rollback could not read the variables again.");
  witness = dvWitness(doc, after); digests = deDigests(after, dvStructure(doc), witness);
  if (digests.state !== targetDigest) {
    deWriteValues(valueRows, after);
    after = dvSnapshot(doc, true, budget === undefined ? DE_LATER_BUDGET : budget);
    witness = dvWitness(doc, after); digests = deDigests(after, dvStructure(doc), witness);
  }
  return { digests: digests, snapshot: after };
}
`;
