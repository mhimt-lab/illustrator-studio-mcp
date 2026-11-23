import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { DATASET_EDIT_HELPERS, DATASET_EDIT_MAX_LISTED } from '../dataset-edit-host-script.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema } from '../mutation-result-schema-core.js';
import { canonicalDigest, operationSafetyPolicyToMcpAnnotations } from '../operation-safety-policy-core.js';
import { PAGE_ITEM_RESOLVE_HOST_SCRIPT } from '../page-item-resolve.js';
import { DATASET_HOST_HELPERS, DATASET_HOST_TIMEOUT_MS, DATASET_MAX_BOUND, DATASET_MAX_DATASETS, DATASET_MAX_VARIABLES, DATASET_PREFLIGHT_MAX_MS } from '../variables-host-script.js';
import { applyDatasetBeforeSchema } from './apply-dataset-adapter.js';
import { artboardSafetyAsserter, artboardSafetyRegistration, artboardTransactionSchema, classifyArtboardTerminal } from './artboard-update-safety.js';
import { SNAPSHOT_RESULT_ADMISSION_BYTES } from './snapshot-result-size.js';
export const BIND_VARIABLE_OPERATION = 'bind_variable';
export const BIND_VARIABLE_VALIDATOR = { kind: BIND_VARIABLE_OPERATION, version: 1 };
const keySchema = z.string().min(1).max(16_384);
const hex24 = z.string().regex(/^[0-9a-f]{24}$/u);
const uuidSchema = z.string().min(1).max(256);
const nameSchema = z.string().min(1).max(1024).regex(/^[^\uD800-\uDFFF]+$/, 'The name must not contain characters outside the Basic Multilingual Plane (surrogate pairs).');
const rankSchema = z.number().int().nonnegative().max(DATASET_MAX_BOUND);
const selectionSchema = z.strictObject({ count: z.number().int().min(-1), items: z.array(z.strictObject({ type: z.string().max(64), name: z.string().max(1024) })).max(20) });
const existingSchema = z.strictObject({ index: z.number().int().nonnegative().max(DATASET_MAX_VARIABLES - 1), name: z.string().min(1).max(1024) });
const createSchema = z.strictObject({ name: nameSchema, kind: z.enum(['textual', 'visibility', 'image']) });
const variableSchema = z.union([z.strictObject({ existing: existingSchema }), z.strictObject({ create: createSchema }), z.null()]);
const common = { expectedDocumentKey: keySchema, targetUuid: uuidSchema, property: z.enum(['content', 'visibility']), variable: variableSchema };
const internalSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...common, apply: z.literal(false) }),
    z.strictObject({ ...common, apply: z.literal(true), expectedDigest: hex24, commandId: canonicalCommandIdSchema }),
]);
const publicCommon = {
    expected_document_key: keySchema, target_uuid: uuidSchema,
    property: z.enum(['content', 'visibility']).describe('content: textual variable on a text frame, image variable on a placed image. visibility: visibility variable on any item but a graph.'),
    variable: variableSchema.describe('{existing:{index,name}}, or {create:{name,kind}} (a new variable: every existing dataset then holds the item\'s current value), or null (unbind).'),
};
export const bindVariablePublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...publicCommon, apply: z.literal(false).default(false) }),
    z.strictObject({ ...publicCommon, apply: z.literal(true), expected_digest: hex24.describe("Copy of the plan's beforeDigest (use the plan's next_call)."), command_id: applyCommandIdSchema }),
]);
const inputSchema = z.strictObject({ ...publicCommon, apply: z.boolean().default(false), expected_digest: hex24.optional(), command_id: applyCommandIdSchema.optional() });
const { $schema: _schemaDialect, ...publishedSchema } = z.toJSONSchema(bindVariablePublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedSchema });
function normalizePublicInput(input) {
    const v = bindVariablePublicInputSchema.parse(input);
    const base = { expectedDocumentKey: v.expected_document_key, targetUuid: v.target_uuid, property: v.property, variable: v.variable };
    return v.apply ? { ...base, apply: true, expectedDigest: v.expected_digest, commandId: v.command_id } : { ...base, apply: false };
}
export const BIND_VARIABLE_BLOCKERS = ['document_mutation_not_allowed', 'target_not_found', 'binding_unsupported', 'variable_selector_mismatch', 'variable_name_taken', 'variable_kind_mismatch',
    'target_already_bound', 'nothing_to_unbind', 'variables_locked', 'bindings_incomplete', 'text_too_long_to_verify', 'scan_limit_exceeded'];
const blockerSchema = z.enum(BIND_VARIABLE_BLOCKERS);
const BINDING_REASONS = ['binding_unconfirmed', 'unsupported_bound_type', 'multi_run_text', 'multi_paragraph_text', 'text_attribute_unreadable', 'text_too_long'];
const ADMITTED_PROFILES = ['saved_file', 'unsaved_document', 'dirty_file'];
export const VISIBILITY_BINDABLE_TYPES = ['TextFrame', 'PlacedItem', 'RasterItem', 'PathItem', 'CompoundPathItem', 'GroupItem', 'SymbolItem'];
export function allowedVariableKind(type, property) {
    if (type === null)
        return null;
    if (property === 'visibility')
        return VISIBILITY_BINDABLE_TYPES.includes(type) ? 'visibility' : null;
    if (type === 'TextFrame')
        return 'textual';
    if (type === 'PlacedItem')
        return 'image';
    return null;
}
function same(a, b) { return canonicalSha256(a) === canonicalSha256(b); }
const targetSchema = z.strictObject({
    found: z.boolean(), type: z.string().max(64).nullable(), name: z.string().max(1024).nullable(), layer: z.string().max(1024).nullable(),
    binding: z.strictObject({ content: z.string().max(1024).nullable(), visibility: z.string().max(1024).nullable() }),
});
const variableFactsSchema = z.strictObject({
    mode: z.enum(['existing', 'create', 'unbind']), kind: z.enum(['textual', 'visibility', 'image', 'graph', 'unknown']).nullable(), index: z.number().int().nonnegative().nullable(),
    name: z.string().max(1024).nullable(), selectorMatches: z.boolean(), nameTaken: z.boolean(), boundNow: z.number().int().nonnegative().nullable(),
});
export function bindVariableExpectedBlockers(p) {
    const out = [];
    const reasons = new Set(p.blockedBindings.flatMap((row) => row.reasons));
    const binds = p.variable.mode !== 'unbind';
    const allowed = allowedVariableKind(p.target.type, p.property);
    if (!p.documentBefore.mutationAllowed || !ADMITTED_PROFILES.includes(p.documentBefore.mutationProfile ?? ''))
        out.push('document_mutation_not_allowed');
    if (!p.target.found)
        out.push('target_not_found');
    else if (allowed === null)
        out.push('binding_unsupported');
    if (p.variable.mode === 'existing' && !p.variable.selectorMatches)
        out.push('variable_selector_mismatch');
    if (p.variable.mode === 'create' && p.variable.nameTaken)
        out.push('variable_name_taken');
    if (p.target.found && allowed !== null && p.variable.kind !== null && p.variable.kind !== allowed)
        out.push('variable_kind_mismatch');
    if (p.target.found && binds && p.target.binding[p.property] !== null)
        out.push('target_already_bound');
    if (p.target.found && !binds && p.target.binding[p.property] === null)
        out.push('nothing_to_unbind');
    if (p.before.variablesLocked)
        out.push('variables_locked');
    if (reasons.has('binding_unconfirmed') || reasons.has('unsupported_bound_type'))
        out.push('bindings_incomplete');
    if (reasons.has('text_too_long') || p.readMs > DATASET_PREFLIGHT_MAX_MS)
        out.push('text_too_long_to_verify');
    if (!p.scanComplete)
        out.push('scan_limit_exceeded');
    return out;
}
const planSchema = z.strictObject({
    operation: z.literal(BIND_VARIABLE_OPERATION), profile: z.literal('variable_bind_v1'), documentKey: keySchema, documentBefore: documentContextSchema,
    targetUuid: uuidSchema, property: z.enum(['content', 'visibility']), request: z.unknown(), target: targetSchema, variable: variableFactsSchema,
    before: applyDatasetBeforeSchema, beforeDigest: hex24, stateDigest: hex24, scanComplete: z.boolean(),
    readMs: z.number().int().nonnegative().max(600_000).describe('Milliseconds the first read took (over the budget: text_too_long_to_verify).'),
    blockedBindings: z.array(z.strictObject({ variable: z.number().int().nonnegative(), rank: rankSchema, type: z.string().max(64), name: z.string().max(1024), reasons: z.array(z.enum(BINDING_REASONS)).min(1).max(4) })).max(DATASET_EDIT_MAX_LISTED),
    datasetsReceiveValue: z.number().int().nonnegative().max(DATASET_MAX_DATASETS).describe('For a new variable: how many existing datasets then hold the item\'s current value for it.'),
    variableUnbound: z.boolean().nullable().describe('Unbind: the variable is left with no bound item (update_dataset and create_dataset then refuse the document).'),
    changesState: z.literal(true), applyBlockedReasonCodes: z.array(blockerSchema), applyBlockedMessage: z.string().min(1).max(500).optional(),
    confirmationStatus: z.enum(['required', 'confirmed']), applyAllowed: z.boolean(),
}).superRefine((p, ctx) => {
    if (p.documentKey !== p.documentBefore.key)
        ctx.addIssue({ code: 'custom', message: 'Plan must bind the native document context.' });
    if (!same(bindVariableExpectedBlockers(p), p.applyBlockedReasonCodes))
        ctx.addIssue({ code: 'custom', message: 'Plan must expose exactly the blockers of its evidence.' });
    if ((p.applyBlockedMessage === undefined) !== (p.applyBlockedReasonCodes.length === 0))
        ctx.addIssue({ code: 'custom', message: 'A blocked plan carries one message, an unblocked one none.' });
    if (p.applyAllowed !== (p.confirmationStatus === 'confirmed' && p.applyBlockedReasonCodes.length === 0))
        ctx.addIssue({ code: 'custom', message: 'Invalid admission flags.' });
    if (!variableSchema.safeParse(p.request).success || (p.request === null) !== (p.variable.mode === 'unbind'))
        ctx.addIssue({ code: 'custom', message: 'The request must be the one asked for and the variable mode must follow it.' });
    if ((p.datasetsReceiveValue > 0) !== (p.variable.mode === 'create' && p.before.datasets.length > 0) || (p.datasetsReceiveValue !== 0 && p.datasetsReceiveValue !== p.before.datasets.length))
        ctx.addIssue({ code: 'custom', message: 'datasetsReceiveValue is the dataset count for a new variable and 0 otherwise.' });
    p.before.bound.forEach((row, index) => {
        if (row.variable >= p.before.variables.length)
            ctx.addIssue({ code: 'custom', message: 'A bound item names a variable that is not listed.', path: ['before', 'bound', index] });
    });
});
const postconditionSchema = z.strictObject({
    target: z.strictObject({ uuid: uuidSchema, type: z.string().max(64), name: z.string().max(1024) }),
    property: z.enum(['content', 'visibility']),
    bound: z.strictObject({ index: z.number().int().nonnegative().max(DATASET_MAX_VARIABLES), name: z.string().max(1024), kind: z.enum(['textual', 'visibility', 'image']) }).nullable(),
    variableCreated: z.boolean(),
    variableUnbound: z.boolean().nullable(),
    boundItems: z.number().int().nonnegative().max(DATASET_MAX_BOUND),
    datasetsReceiveValue: z.number().int().nonnegative().max(DATASET_MAX_DATASETS),
    datasets: z.array(z.string().max(1024)).max(DATASET_MAX_DATASETS),
    selection: z.strictObject({ before: selectionSchema, after: selectionSchema, changed: z.boolean() }),
    saved: z.strictObject({ before: z.boolean(), after: z.boolean() }),
    unbound: z.strictObject({ count: z.number().int().nonnegative(), witness: hex24 }),
    items: z.number().int().nonnegative(),
});
const transactionSchema = artboardTransactionSchema(BIND_VARIABLE_OPERATION, { restoredStateDigest: hex24.nullable() }, { restoredStateDigest: null }, (v) => v.restoredStateDigest !== null);
const scanMsSchema = z.array(z.number().int().nonnegative()).max(16).optional();
export const bindVariableResultSchema = z.union([
    z.strictObject({ scanMs: scanMsSchema, operation: z.literal(BIND_VARIABLE_OPERATION), applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ scanMs: scanMsSchema, operation: z.literal(BIND_VARIABLE_OPERATION), applied: z.literal(true), document: documentContextSchema, plan: planSchema, postcondition: postconditionSchema, transaction: transactionSchema }),
]).superRefine((r, ctx) => {
    const planned = r.transaction.state === 'planned';
    const b = r.plan.documentBefore;
    if (r.document.path !== b.path || r.document.fileRevision !== b.fileRevision || r.document.name !== b.name || r.document.appVersion !== b.appVersion || r.document.colorSpace !== b.colorSpace)
        ctx.addIssue({ code: 'custom', message: 'Result document must preserve the admitted file identity and profile.' });
    if (r.plan.confirmationStatus !== (planned ? 'required' : 'confirmed') || (!planned && (!r.plan.applyAllowed || r.plan.applyBlockedReasonCodes.length !== 0)))
        ctx.addIssue({ code: 'custom', message: 'Transaction requires the exact confirmed, unblocked plan.' });
    if (r.applied !== (r.transaction.state === 'verified'))
        ctx.addIssue({ code: 'custom', message: 'Only a verified transaction is applied.' });
    if (r.applied) {
        const p = r.postcondition;
        if (p.target.uuid !== r.plan.targetUuid || p.property !== r.plan.property)
            ctx.addIssue({ code: 'custom', message: 'The result must name the planned target and property.' });
        if ((p.bound === null) !== (r.plan.variable.mode === 'unbind') || p.variableCreated !== (r.plan.variable.mode === 'create'))
            ctx.addIssue({ code: 'custom', message: 'The result must follow the planned mode.' });
        if (p.datasetsReceiveValue !== r.plan.datasetsReceiveValue || !same(p.datasets, r.plan.before.datasets))
            ctx.addIssue({ code: 'custom', message: 'The datasets must be the planned ones.' });
        if (p.items !== r.plan.before.structure.items)
            ctx.addIssue({ code: 'custom', message: 'The document must keep its items.' });
    }
    if (r.transaction.state === 'rolled_back' && r.transaction.rollback.restoredStateDigest !== r.plan.stateDigest)
        ctx.addIssue({ code: 'custom', message: 'Recovery must prove the baseline state digest.' });
});
const responseSchema = z.strictObject({ outcome: bindVariableResultSchema, delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }) });
export const BIND_VARIABLE_SAFETY = artboardSafetyRegistration(BIND_VARIABLE_OPERATION);
export const BIND_VARIABLE_SAFETY_IDENTITY = canonicalDigest(BIND_VARIABLE_SAFETY);
const assertSafety = artboardSafetyAsserter(BIND_VARIABLE_SAFETY, (value) => {
    const r = bindVariableResultSchema.parse(value);
    return { operationId: BIND_VARIABLE_OPERATION, documentKey: r.plan.documentKey,
        identityToken: `artboard-update-v1:${canonicalDigest({ operation: BIND_VARIABLE_OPERATION, target: r.plan.targetUuid, property: r.plan.property, request: r.plan.request, beforeDigest: r.plan.beforeDigest })}`,
        beforeState: { path: r.plan.documentBefore.path, fileRevision: r.plan.documentBefore.fileRevision, snapshot: r.plan.before, beforeDigest: r.plan.beforeDigest, stateDigest: r.plan.stateDigest },
        afterState: { target: r.plan.targetUuid, property: r.plan.property, request: r.plan.request },
        changeSet: { target: r.plan.targetUuid, property: r.plan.property, request: r.plan.request, profile: r.plan.profile },
        blocked: r.plan.applyBlockedReasonCodes.length > 0, confirmationStatus: r.plan.confirmationStatus, applyAllowed: r.plan.applyAllowed,
        transactionState: r.transaction.state, applied: r.applied };
});
export const BIND_VARIABLE_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}${PAGE_ITEM_RESOLVE_HOST_SCRIPT}${DATASET_HOST_HELPERS}${DATASET_EDIT_HELPERS}
var BV_ADMITTED = ${JSON.stringify(ADMITTED_PROFILES)}, BV_BLOCKERS = ${JSON.stringify(BIND_VARIABLE_BLOCKERS)}, BV_VISIBILITY_TYPES = ${JSON.stringify(VISIBILITY_BINDABLE_TYPES)};
function bvAllowedKind(type, property) {
  var i;
  if (type === null) return null;
  if (property === "visibility") { for (i = 0; i < BV_VISIBILITY_TYPES.length; i++) if (BV_VISIBILITY_TYPES[i] === type) return "visibility"; return null; }
  if (type === "TextFrame") return "textual";
  if (type === "PlacedItem") return "image";
  return null;
}
function bvKindConstant(kind) {
  if (kind === "textual") return VariableKind.TEXTUAL;
  if (kind === "visibility") return VariableKind.VISIBILITY;
  if (kind === "image") return VariableKind.IMAGE;
  throw new Error("KIND:" + kind);
}
function bvProp() { return params.property === "content" ? "contentVariable" : "visibilityVariable"; }
function bvVariableByName(doc, name) {
  var i;
  for (i = 0; i < doc.variables.length; i++) if (String(doc.variables[i].name) === name) return doc.variables[i];
  return null;
}
// The items outside every binding, leaving the target out whether or not it is bound (it is the one item whose binding changes).
function bvWitness(doc, snapshot, uuid) {
  return dvWitness(doc, { variables: snapshot.variables.concat([{ rows: [{ uuid: uuid }] }]) });
}
// Every bound row as variable name | uuid | property -> state text: the part of the document a bind must leave alone, apart from the target's own row.
function bvRowMap(snapshot) {
  var map = {}, i, j, row;
  for (i = 0; i < snapshot.variables.length; i++) for (j = 0; j < snapshot.variables[i].rows.length; j++) {
    row = snapshot.variables[i].rows[j];
    map[snapshot.variables[i].name + "|" + row.uuid + "|" + row.property] = dvStateText(row);
  }
  return map;
}
function bvSameMap(a, b) {
  var k, n = 0, m = 0;
  for (k in a) if (a.hasOwnProperty(k)) { n++; if (b[k] !== a[k]) return false; }
  for (k in b) if (b.hasOwnProperty(k)) m++;
  return n === m;
}
function bvBindingOf(snapshot, uuid) {
  var out = { content: null, visibility: null }, i, j, row;
  for (i = 0; i < snapshot.variables.length; i++) for (j = 0; j < snapshot.variables[i].rows.length; j++) {
    row = snapshot.variables[i].rows[j];
    if (row.uuid === uuid) out[row.property] = snapshot.variables[i].name;
  }
  return out;
}
function bvVariableIndex(snapshot, name) { var i; for (i = 0; i < snapshot.variables.length; i++) if (snapshot.variables[i].name === name) return i; return -1; }
function bvTargetRow(item, kind) {
  var budget = { left: DV_MAX_TEXT_TOTAL };
  return dvRow(item, kind, "", 0, 0, true, budget, new Date().getTime() + DE_SNAPSHOT_BUDGET);
}
// The baseline proof of a rollback. Unlike deDigests it leaves out the rank of a row in its variable: a bind-again after an unbind may put the item back at the end of the variable's pageItems
// (unmeasured), and the value a dataset holds is per variable, so the order of the bound items has no meaning. Rows are summed (the lane sum is commutative) by variable name, uuid and property.
function bvStateDigest(snapshot, structure, witness) {
  var lanes = [0, 0, 0], i, j, row, head = stringifyJson(structure) + "|" + (snapshot.locked ? "1" : "0") + "|" + witness.count + "|" + witness.witness;
  for (i = 0; i < snapshot.variables.length; i++) head += "|v" + i + ":" + snapshot.variables[i].name + ":" + snapshot.variables[i].kind + ":" + snapshot.variables[i].bound;
  for (i = 0; i < snapshot.datasets.length; i++) head += "|d" + i + ":" + snapshot.datasets[i];
  dvAddLane(lanes, head);
  for (i = 0; i < snapshot.variables.length; i++) for (j = 0; j < snapshot.variables[i].rows.length; j++) {
    row = snapshot.variables[i].rows[j];
    dvAddLane(lanes, snapshot.variables[i].name + "|" + row.uuid + "|" + row.property + "|" + dvStateText(row));
  }
  return dvLaneHex(lanes);
}
function bvResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var doc = app.activeDocument, found = [], blocked = [], messages = [], readStarted, readMs, i, j, row, refusing, resolved, type = null, name = null, layer = null, item = null, request = params.variable;
  var mode = request === null ? "unbind" : (request.hasOwnProperty("create") ? "create" : "existing");
  var snapshot, rows, structure, selection, witness, before, digests, target, binding, facts, targetRow = null, allowed, datasetsReceive = 0, variableUnbound = null, lanes = [0, 0, 0], prop = bvProp();
  readStarted = new Date().getTime();
  snapshot = dvSnapshot(doc, true, DE_SNAPSHOT_BUDGET); rows = deBoundRows(snapshot); structure = dvStructure(doc); selection = dvSelection(doc);
  resolved = resolvePageItem(doc, params.targetUuid);
  if (resolved !== null) { item = resolved.item; type = resolved.typename; try { name = String(item.name); } catch (nameError) { name = ""; } try { layer = String(item.layer.name); } catch (layerError) { layer = ""; } }
  witness = snapshot.scanComplete ? bvWitness(doc, snapshot, params.targetUuid) : { count: 0, witness: DE_ZERO };
  readMs = new Date().getTime() - readStarted;
  binding = bvBindingOf(snapshot, params.targetUuid);
  allowed = bvAllowedKind(type, params.property);
  facts = { mode: mode, kind: null, index: null, name: null, selectorMatches: false, nameTaken: false, boundNow: null };
  if (mode === "existing") {
    facts.name = request.existing.name; facts.index = request.existing.index;
    if (request.existing.index < snapshot.variables.length && snapshot.variables[request.existing.index].name === request.existing.name) {
      facts.selectorMatches = true; facts.kind = snapshot.variables[request.existing.index].kind; facts.boundNow = snapshot.variables[request.existing.index].bound;
    }
  } else if (mode === "create") {
    facts.name = request.create.name; facts.kind = request.create.kind; facts.selectorMatches = true; facts.nameTaken = bvVariableIndex(snapshot, request.create.name) >= 0;
    datasetsReceive = snapshot.datasets.length;
  } else {
    if (binding[params.property] !== null) {
      j = bvVariableIndex(snapshot, binding[params.property]);
      facts.name = binding[params.property]; facts.index = j >= 0 ? j : null; facts.selectorMatches = true;
      if (j >= 0) { facts.kind = snapshot.variables[j].kind; facts.boundNow = snapshot.variables[j].bound; variableUnbound = snapshot.variables[j].bound === 1; }
    } else facts.selectorMatches = true;
  }
  target = { found: resolved !== null, type: type, name: name, layer: layer, binding: binding };
  if (item !== null) targetRow = bvTargetRow(item, facts.kind === null || facts.kind === "graph" || facts.kind === "unknown" ? (params.property === "visibility" ? "visibility" : "textual") : facts.kind);
  before = deBefore(snapshot, structure, witness, selection); digests = deDigests(snapshot, structure, witness);
  dvAddLane(lanes, digests.identity + "|" + params.targetUuid + "|" + String(type) + "|" + String(name) + "|" + binding.content + "|" + binding.visibility + "|" + (targetRow === null ? "-" : dvStateText(targetRow)));
  if (!deAdmitted(context, BV_ADMITTED)) found.push("document_mutation_not_allowed");
  if (resolved === null) { found.push("target_not_found"); messages.push("no page item has the UUID " + params.targetUuid); }
  else if (allowed === null) { found.push("binding_unsupported"); messages.push("a " + type + " does not take a " + params.property + " variable that is measured (see the table of permitted combinations)"); }
  if (mode === "existing" && !facts.selectorMatches) { found.push("variable_selector_mismatch"); messages.push("the document has no variable " + request.existing.index + " named that way; call illustrator_list_variables again"); }
  if (mode === "create" && facts.nameTaken) { found.push("variable_name_taken"); messages.push("a variable named " + request.create.name + " exists; names are unique in a document"); }
  if (resolved !== null && allowed !== null && facts.kind !== null && facts.kind !== allowed) { found.push("variable_kind_mismatch"); messages.push("a " + type + " takes a " + allowed + " variable for " + params.property + ", not a " + facts.kind + " one (the host would rewrite the variable's kind)"); }
  if (resolved !== null && mode !== "unbind" && binding[params.property] !== null) { found.push("target_already_bound"); messages.push("the item is already bound to " + binding[params.property] + "; unbind it first (variable: null)"); }
  if (resolved !== null && mode === "unbind" && binding[params.property] === null) { found.push("nothing_to_unbind"); messages.push("the item has no " + params.property + " binding"); }
  if (snapshot.locked) { found.push("variables_locked"); messages.push(mode === "unbind" ? "the variables are locked; an unbind could not be undone (the host refuses to bind again: 9121), so unlock them first" : "the variables are locked; the host refuses to bind (9121) or to make a variable, so unlock them first"); }
  for (i = 0; i < rows.length; i++) {
    row = rows[i]; refusing = deRefusing(row.reasons, false);
    if (refusing.length === 0) continue;
    if (blocked.length >= DE_MAX_LISTED) deFail("More than " + DE_MAX_LISTED + " bound items block the change.");
    blocked.push({ variable: row.variable, rank: row.rank, type: row.type, name: row.name, reasons: refusing });
    if (deHas(refusing, "binding_unconfirmed") || deHas(refusing, "unsupported_bound_type")) found.push("bindings_incomplete");
    if (deHas(refusing, "text_too_long")) { found.push("text_too_long_to_verify"); messages.push("the text " + row.name + " is too long to read back within the time budget"); }
  }
  if (!snapshot.scanComplete) { found.push("scan_limit_exceeded"); messages.push("more than " + DV_MAX_BOUND + " items are bound (or too many variables or datasets); split the work"); }
  if (readMs > DE_PREFLIGHT_MAX) { found.push("text_too_long_to_verify"); messages.push("reading the bound items took " + readMs + " ms; more than " + DE_PREFLIGHT_MAX + " ms is refused; split the work"); }
  var blockers = deOrder(found, BV_BLOCKERS), message = deMessage(blockers, messages);
  if (stringifyJson(before).length * 3 > ${SNAPSHOT_RESULT_ADMISSION_BYTES}) deFail("The plan would exceed the result size limit (result_too_large); fewer items must be bound.");
  var identity = dvLaneHex(lanes);
  if (forApply) {
    if (params.expectedDigest !== identity) deFail("expected_digest does not match the current state; plan again.");
    if (blockers.length > 0) deFail(message);
  }
  return { context: context, document: doc, item: item, snapshot: snapshot, structure: structure, selection: selection, witness: witness, before: before, digests: digests, identity: identity,
    blockers: blockers, message: message, blocked: blocked, saved: doc.saved === true, readMs: readMs, target: target, facts: facts, targetRow: targetRow, mode: mode, stateOrderFree: bvStateDigest(snapshot, structure, witness),
    datasetsReceive: datasetsReceive, variableUnbound: variableUnbound, rowMap: bvRowMap(snapshot) };
}
function bvPlan(p) {
  var plan = { operation: "bind_variable", profile: "variable_bind_v1", documentKey: p.context.key, documentBefore: p.context, targetUuid: params.targetUuid, property: params.property, request: params.variable,
    target: p.target, variable: p.facts, before: p.before, beforeDigest: p.identity, stateDigest: p.stateOrderFree, scanComplete: p.snapshot.scanComplete, readMs: p.readMs, blockedBindings: p.blocked,
    datasetsReceiveValue: p.datasetsReceive, variableUnbound: p.variableUnbound, changesState: true, applyBlockedReasonCodes: p.blockers };
  if (p.message !== null) plan.applyBlockedMessage = p.message;
  plan.confirmationStatus = params.apply === true ? "confirmed" : "required";
  plan.applyAllowed = params.apply === true && p.blockers.length === 0;
  return plan;
}
function bvRevalidate(p) {
  try {
    var resolved;
    if (app.documents.length === 0 || app.activeDocument !== p.document) deFail("Document reference changed before apply.");
    if (!deSame(dvStructure(p.document), p.structure)) deFail("The document structure changed before apply.");
    resolved = resolvePageItem(p.document, params.targetUuid);
    if (resolved === null || String(resolved.typename) !== p.target.type) deFail("The target item changed before apply.");
  } catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "The target or the document changed before apply.")); }
}
function bvApply(p, plan, state) {
  var ev = state.operationState, item = resolvePageItem(p.document, params.targetUuid).item, prop = bvProp(), made, existing;
  ev.mutationStarted = true;
  if (p.mode === "unbind") {
    ev.previousName = p.facts.name; ev.previousIndex = p.facts.index;
    try { item[prop] = null; } catch (unbindError) { mutationNativeFailure("PageItem." + prop, unbindError); }
    ev.changed = true;
    return;
  }
  if (p.mode === "create") {
    try { made = p.document.variables.add(); } catch (addError) { mutationNativeFailure("Variables.add", addError); }
    ev.created = true;
    try { made.kind = bvKindConstant(params.variable.create.kind); } catch (kindError) { mutationNativeFailure("Variable.kind", kindError); }
    try { made.name = params.variable.create.name; } catch (nameError) { mutationNativeFailure("Variable.name", nameError); }
    ev.named = true;
    existing = made;
  } else existing = p.document.variables[params.variable.existing.index];
  try { item[prop] = existing; } catch (bindError) { mutationNativeFailure("PageItem." + prop, bindError); }
  ev.bound = true;
}
function bvVerify(p, plan, state) {
  var read = deRead(p), after = read.snapshot, i, resolved, row, witness, expected, index, variableName, selection, binding, readName, afterMap, boundNow = 0, created = p.mode === "create", unbind = p.mode === "unbind";
  if (!deSame(read.structure, p.structure)) throw mutationError("verify_mismatch", "The document structure changed.");
  if (!after.scanComplete || after.locked !== p.snapshot.locked) throw mutationError("verify_mismatch", "The variables or their lock changed.");
  if (!deSame(after.datasets, p.snapshot.datasets)) throw mutationError("verify_mismatch", "The dataset list changed.");
  variableName = unbind ? p.facts.name : (created ? params.variable.create.name : params.variable.existing.name);
  if (after.variables.length !== p.snapshot.variables.length + (created ? 1 : 0)) throw mutationError("verify_mismatch", "The variable list is not the expected one.");
  for (i = 0; i < p.snapshot.variables.length; i++) {
    expected = p.snapshot.variables[i].bound + (p.snapshot.variables[i].name === variableName ? (unbind ? -1 : 1) : 0);
    if (after.variables[i].name !== p.snapshot.variables[i].name || after.variables[i].kind !== p.snapshot.variables[i].kind || after.variables[i].bound !== expected) throw mutationError("verify_mismatch", "A variable changed besides the target's binding: " + p.snapshot.variables[i].name + ".");
  }
  if (created && (after.variables[after.variables.length - 1].name !== variableName || after.variables[after.variables.length - 1].kind !== params.variable.create.kind || after.variables[after.variables.length - 1].bound !== 1)) throw mutationError("verify_mismatch", "The new variable is not " + variableName + " (" + params.variable.create.kind + ") bound to the target.");
  resolved = resolvePageItem(p.document, params.targetUuid);
  if (resolved === null || String(resolved.typename) !== p.target.type) throw mutationError("verify_mismatch", "The target could not be found again by its UUID.");
  binding = bvBindingOf(after, params.targetUuid);
  if (binding[params.property] !== (unbind ? null : variableName)) throw mutationError("verify_mismatch", "The target is not bound as requested.");
  if ((params.property === "content" ? binding.visibility : binding.content) !== (params.property === "content" ? p.target.binding.visibility : p.target.binding.content)) throw mutationError("verify_mismatch", "The other binding of the target changed.");
  readName = dvBindName(resolved.item, bvProp());
  if (readName !== (unbind ? null : variableName)) throw mutationError("verify_mismatch", "The target reads back as " + readName + ".");
  // every other bound row is the row it was, and the target's own state (not its binding) is unchanged
  afterMap = bvRowMap(after);
  expected = {};
  for (i in p.rowMap) if (p.rowMap.hasOwnProperty(i)) expected[i] = p.rowMap[i];
  row = bvTargetRow(resolved.item, unbind ? p.facts.kind : (created ? params.variable.create.kind : p.facts.kind));
  if (unbind) delete expected[variableName + "|" + params.targetUuid + "|" + params.property];
  else expected[variableName + "|" + params.targetUuid + "|" + params.property] = dvStateText(row);
  if (!bvSameMap(expected, afterMap)) throw mutationError("verify_mismatch", "A bound item changed besides the target's binding.");
  if (p.targetRow !== null && dvStateText(row) !== dvStateText(p.targetRow)) throw mutationError("verify_mismatch", "The target changed besides its binding.");
  witness = bvWitness(p.document, after, params.targetUuid);
  if (witness.count !== p.witness.count || witness.witness !== p.witness.witness) throw mutationError("verify_mismatch", "An item outside every binding changed.");
  index = bvVariableIndex(after, variableName);
  if (index >= 0) boundNow = after.variables[index].bound;
  selection = dvSelection(p.document);
  return { target: { uuid: params.targetUuid, type: p.target.type, name: p.target.name }, property: params.property,
    bound: unbind ? null : { index: index, name: variableName, kind: after.variables[index].kind }, variableCreated: created, variableUnbound: unbind ? (index >= 0 && boundNow === 0) : null,
    boundItems: boundNow, datasetsReceiveValue: p.datasetsReceive, datasets: after.datasets,
    selection: { before: p.selection, after: selection, changed: !deSame(p.selection, selection) }, saved: { before: p.saved, after: p.document.saved === true },
    unbound: { count: witness.count, witness: witness.witness }, items: read.structure.items };
}
// The rollback reads what the target is bound to now and undoes that (the host may take an assignment and still throw): a bind is cleared when the target reads back as the requested variable,
// an unbind is bound again to the variable it had when the target reads back as unbound. A variable made here is taken out again. The baseline is proved by an order-free digest and by the target's own state.
function bvRollback(state) {
  var p = state.preflight, ev = state.operationState, prop = bvProp(), resolved, made = null, after, witness, digests, previous, current, requested, row;
  try {
    if (!p || app.documents.length === 0 || app.activeDocument !== p.document) return { status: "indeterminate", message: "Rollback document is indeterminate." };
    resolved = resolvePageItem(p.document, params.targetUuid);
    if (resolved === null) return { status: "indeterminate", message: "Rollback could not find the target again." };
    current = dvBindName(resolved.item, prop);
    if (current === "!unreadable") return { status: "indeterminate", message: "Rollback could not read the target's binding." };
    if (p.mode === "unbind") {
      if (current === null) {
        previous = p.document.variables[p.facts.index];
        if (previous === undefined || String(previous.name) !== p.facts.name) return { status: "indeterminate", message: "Rollback could not find the previous variable again." };
        resolved.item[prop] = previous;
      }
    } else {
      requested = p.mode === "create" ? params.variable.create.name : params.variable.existing.name;
      if (current === requested) resolved.item[prop] = null;
      else if (current !== null) return { status: "indeterminate", message: "Rollback found the target bound to another variable." };
    }
    if (p.mode === "create") {
      if (ev.named === true) made = bvVariableByName(p.document, params.variable.create.name);
      if (made === null && p.document.variables.length > p.snapshot.variables.length) made = p.document.variables[p.document.variables.length - 1];
      if (made !== null) made.remove();
    }
    after = dvSnapshot(p.document, true, DE_LATER_BUDGET);
    if (!after.scanComplete) return { status: "indeterminate", message: "Rollback could not read the variables again." };
    witness = bvWitness(p.document, after, params.targetUuid); digests = bvStateDigest(after, dvStructure(p.document), witness);
    state.operationState.rollbackEvidence.restoredStateDigest = digests;
    if (digests !== p.stateOrderFree) return { status: "failed", message: "Rollback did not restore the baseline state." };
    resolved = resolvePageItem(p.document, params.targetUuid);
    row = resolved === null ? null : bvTargetRow(resolved.item, p.targetRow !== null && p.targetRow.property === "visibility" ? "visibility" : (p.facts.kind === "image" ? "image" : "textual"));
    if (row === null || (p.targetRow !== null && dvStateText(row) !== dvStateText(p.targetRow))) return { status: "failed", message: "Rollback did not restore the target itself." };
    return { status: "verified" };
  } catch (error) { return { status: "indeterminate", message: "Rollback could not prove the baseline state." }; }
}
var bvExecution = runMutationTransaction({
  apply: params.apply === true,
  initialOperationState: function () { return { mutationStarted: false, created: false, named: false, bound: false, changed: false, rollbackEvidence: { restoredStateDigest: null } }; },
  preflight: bvResolve, plan: bvPlan, revalidate: bvRevalidate, applyMutation: bvApply, verify: bvVerify, rollback: bvRollback,
  hasMutationEvidence: function (s) { return s.operationState.mutationStarted === true; },
  applyIndeterminate: function () { return { reasonCode: "artboard_state_unknown", message: "Variable binding outcome is indeterminate.", evidence: { restoredStateDigest: null } }; },
  rollbackEvidence: function (s) { return s.operationState.rollbackEvidence; }
});
var bvDocument = bvExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === bvExecution.preflight.document) bvDocument = getDocumentContext();
var result = { operation: "bind_variable", applied: bvExecution.transaction.state === "verified", document: bvDocument, plan: bvExecution.plan, transaction: bvExecution.transaction };
if (result.applied) result.postcondition = bvExecution.value;
if (dvScanMs.length > 0) result.scanMs = dvScanMs;
`;
export const BIND_VARIABLE_HOST_SCRIPT_DIGEST = canonicalSha256(BIND_VARIABLE_SCRIPT);
export const BIND_VARIABLE_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: BIND_VARIABLE_OPERATION, validator: BIND_VARIABLE_VALIDATOR,
    canonicalContractVersion: 1, resultSchemaVersion: 1, terminalClassifierVersion: 1, safetyConformanceVersion: 1, errorMappingVersion: 1,
    safetyIdentity: BIND_VARIABLE_SAFETY_IDENTITY, hostScriptDigest: BIND_VARIABLE_HOST_SCRIPT_DIGEST, mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalSchema.parse(input);
    const { commandId: _commandId, ...bound } = request;
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: request.apply ? request.commandId : null, documentKey: request.expectedDocumentKey,
        digest: canonicalSha256({ operation: BIND_VARIABLE_OPERATION, validator: BIND_VARIABLE_VALIDATOR, request: bound }) };
}
export const bindVariableToolContract = {
    name: 'illustrator_bind_variable', title: 'Plan or Bind a Page Item to a Variable (or Unbind it)',
    description: 'Bind one page item (target_uuid) to a variable so datasets drive it, or unbind it (variable: null). Plan returns beforeDigest; apply compares it, binds, reads everything back and undoes the change if anything but the target\'s binding changed. The next apply_dataset replaces the item\'s current text, image or visibility with the dataset\'s. Refused: a variable whose kind does not fit the item, an item already bound (unbind first), graphs, raster images, locked variables. Illustrator frontmost.',
    inputSchema, publicInputSchema: bindVariablePublicInputSchema, outputSchema: responseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(BIND_VARIABLE_SAFETY.policy), normalizePublicInput,
};
export function createBindVariableAdapter() {
    return {
        version: 1, operation: BIND_VARIABLE_OPERATION, validator: BIND_VARIABLE_VALIDATOR,
        safety: BIND_VARIABLE_SAFETY, safetyRegistrationIdentity: BIND_VARIABLE_SAFETY_IDENTITY, adapterIdentity: BIND_VARIABLE_ADAPTER_IDENTITY,
        tool: bindVariableToolContract, canonical: { version: 1, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: bindVariableResultSchema, resultSchemaVersion: 1, terminalClassifierVersion: 1, safetyConformanceVersion: 1, errorMappingVersion: 1,
        hostScriptDigest: BIND_VARIABLE_HOST_SCRIPT_DIGEST, mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const n = normalizedRequest(input), { commandId: _commandId, ...params } = n.request;
            if (n.intent === 'plan')
                return { kind: 'read', script: BIND_VARIABLE_SCRIPT, params, timeoutMs: DATASET_HOST_TIMEOUT_MS };
            return { kind: 'mutation', mutationValidator: BIND_VARIABLE_VALIDATOR, idempotency: { commandId: n.commandId, operation: BIND_VARIABLE_OPERATION, documentKey: n.documentKey, requestDigest: n.digest },
                adapterIdentity: BIND_VARIABLE_ADAPTER_IDENTITY, mutationHostApplicationMode: 'foreground', script: BIND_VARIABLE_SCRIPT, params, timeoutMs: DATASET_HOST_TIMEOUT_MS };
        },
        classifyTerminal(value) { return classifyArtboardTerminal(bindVariableResultSchema.parse(value).transaction.state, 'Variable binding'); },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error) { return error instanceof Error ? error : new Error(String(error)); },
    };
}
