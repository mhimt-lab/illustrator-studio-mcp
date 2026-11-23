import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema } from '../mutation-result-schema-core.js';
import { canonicalDigest, operationSafetyPolicyToMcpAnnotations } from '../operation-safety-policy-core.js';
import { OBJECT_WALK_HELPERS, OBJECT_WITNESS_HELPERS, READ_PAGE_ITEM_AT_HELPER } from '../page-item-walk.js';
import { DATASET_HOST_HELPERS, DATASET_HOST_TIMEOUT_MS, DATASET_LATER_BUDGET_MS, DATASET_MAX_BOUND, DATASET_MAX_DATASETS, DATASET_MAX_TEXT, DATASET_MAX_VARIABLES, DATASET_PREFLIGHT_MAX_MS, DATASET_SNAPSHOT_BUDGET_MS, VARIABLE_KINDS, } from '../variables-host-script.js';
import { artboardSafetyAsserter, artboardSafetyRegistration, artboardTransactionSchema, classifyArtboardTerminal } from './artboard-update-safety.js';
import { SNAPSHOT_RESULT_ADMISSION_BYTES } from './snapshot-result-size.js';
export const APPLY_DATASET_OPERATION = 'apply_dataset';
export const APPLY_DATASET_VALIDATOR = { kind: APPLY_DATASET_OPERATION, version: 1 };
const MAX_LISTED = 20;
const keySchema = z.string().min(1).max(16_384);
const hex24 = z.string().regex(/^[0-9a-f]{24}$/u);
const selectorSchema = z.strictObject({ index: z.number().int().nonnegative().max(DATASET_MAX_DATASETS - 1), name: z.string().min(1).max(1024) });
const rankSchema = z.number().int().nonnegative().max(DATASET_MAX_BOUND);
const stateSchema = z.strictObject({
    hidden: z.boolean(),
    textLength: z.number().int().nonnegative().max(2 * DATASET_MAX_TEXT).optional(), textPreview: z.string().max(40).optional(), runCount: z.number().int().nonnegative().max(2_000).optional(),
    linkName: z.string().max(1024).optional(),
});
const boundSchema = z.strictObject({
    variable: z.number().int().nonnegative().max(DATASET_MAX_VARIABLES - 1), rank: rankSchema, property: z.enum(['content', 'visibility']),
    type: z.string().min(1).max(64), name: z.string().max(1024), uuid: z.string().min(1).max(256), layer: z.string().max(1024), state: stateSchema,
});
const selectionSchema = z.strictObject({ count: z.number().int().min(-1), items: z.array(z.strictObject({ type: z.string().max(64), name: z.string().max(1024) })).max(20) });
const displayedSchema = z.discriminatedUnion('status', [z.strictObject({ status: z.literal('readable'), name: z.string().max(1024) }), z.strictObject({ status: z.literal('none') }), z.strictObject({ status: z.literal('unavailable') })]);
export const applyDatasetBeforeSchema = z.strictObject({
    structure: z.strictObject({ items: z.number().int().nonnegative(), layers: z.number().int().nonnegative(), boards: z.array(z.strictObject({ name: z.string().max(1024), rect: z.tuple([z.number(), z.number(), z.number(), z.number()]) })).max(1_000) }),
    variablesLocked: z.boolean(),
    variables: z.array(z.strictObject({ index: z.number().int().nonnegative(), name: z.string().max(1024), kind: z.enum(VARIABLE_KINDS), bound: z.number().int().nonnegative() })).max(DATASET_MAX_VARIABLES),
    datasets: z.array(z.string().max(1024)).max(DATASET_MAX_DATASETS),
    displayedDataset: displayedSchema,
    bound: z.array(boundSchema).max(DATASET_MAX_BOUND),
    unbound: z.strictObject({ count: z.number().int().nonnegative(), witness: hex24 }),
    selection: selectionSchema,
});
const common = { expectedDocumentKey: keySchema, dataset: selectorSchema };
const internalSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...common, apply: z.literal(false) }),
    z.strictObject({ ...common, apply: z.literal(true), expectedDigest: hex24, commandId: canonicalCommandIdSchema }),
]);
const publicCommon = { expected_document_key: keySchema, dataset: selectorSchema.describe('index and name must both match (names are unique in a document)') };
export const applyDatasetPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...publicCommon, apply: z.literal(false).default(false) }),
    z.strictObject({ ...publicCommon, apply: z.literal(true), expected_digest: hex24.describe("Copy of the plan's beforeDigest (use the plan's next_call)."), command_id: applyCommandIdSchema }),
]);
const inputSchema = z.strictObject({ ...publicCommon, apply: z.boolean().default(false), expected_digest: hex24.optional(), command_id: applyCommandIdSchema.optional() });
const { $schema: _schemaDialect, ...publishedSchema } = z.toJSONSchema(applyDatasetPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedSchema });
function normalizePublicInput(input) {
    const v = applyDatasetPublicInputSchema.parse(input);
    const base = { expectedDocumentKey: v.expected_document_key, dataset: v.dataset };
    return v.apply ? { ...base, apply: true, expectedDigest: v.expected_digest, commandId: v.command_id } : { ...base, apply: false };
}
export const APPLY_DATASET_BLOCKERS = ['document_mutation_not_allowed', 'dataset_selector_mismatch', 'nothing_to_apply', 'graph_variable_bound', 'unsupported_variable_kind',
    'bindings_incomplete', 'text_formatting_not_restorable', 'text_too_long_to_verify', 'scan_limit_exceeded'];
const blockerSchema = z.enum(APPLY_DATASET_BLOCKERS);
const BINDING_REASONS = ['binding_unconfirmed', 'unsupported_bound_type', 'multi_run_text', 'multi_paragraph_text', 'text_attribute_unreadable', 'text_too_long'];
const ADMITTED_PROFILES = ['saved_file', 'unsaved_document', 'dirty_file'];
function same(a, b) { return canonicalSha256(a) === canonicalSha256(b); }
export function applyDatasetExpectedBlockers(p) {
    const out = [];
    const reasons = new Set(p.blockedBindings.flatMap((row) => row.reasons));
    if (!p.documentBefore.mutationAllowed || !ADMITTED_PROFILES.includes(p.documentBefore.mutationProfile ?? ''))
        out.push('document_mutation_not_allowed');
    if (!p.selectorMatches)
        out.push('dataset_selector_mismatch');
    if (p.before.bound.length === 0)
        out.push('nothing_to_apply');
    if (p.before.variables.some((v) => v.kind === 'graph' && v.bound > 0))
        out.push('graph_variable_bound');
    if (p.before.variables.some((v) => v.kind === 'unknown' && v.bound > 0))
        out.push('unsupported_variable_kind');
    if (reasons.has('binding_unconfirmed') || reasons.has('unsupported_bound_type'))
        out.push('bindings_incomplete');
    if (reasons.has('multi_run_text') || reasons.has('multi_paragraph_text') || reasons.has('text_attribute_unreadable'))
        out.push('text_formatting_not_restorable');
    if (reasons.has('text_too_long') || p.readMs > DATASET_PREFLIGHT_MAX_MS)
        out.push('text_too_long_to_verify');
    if (!p.scanComplete)
        out.push('scan_limit_exceeded');
    return out;
}
const planSchema = z.strictObject({
    operation: z.literal(APPLY_DATASET_OPERATION), profile: z.literal('dataset_display_v1'), documentKey: keySchema, documentBefore: documentContextSchema,
    dataset: selectorSchema, selectorMatches: z.boolean(), before: applyDatasetBeforeSchema, beforeDigest: hex24, stateDigest: hex24, scanComplete: z.boolean(),
    readMs: z.number().int().nonnegative().max(600_000).describe('Milliseconds the first read of the bound items and of the rest took; more than the budget refuses (text_too_long_to_verify), because the verification and a rollback read again.'),
    blockedBindings: z.array(z.strictObject({ variable: z.number().int().nonnegative(), rank: rankSchema, type: z.string().max(64), name: z.string().max(1024), reasons: z.array(z.enum(BINDING_REASONS)).min(1).max(4) })).max(MAX_LISTED),
    afterKnown: z.literal('after_display_only'),
    expectedChange: z.strictObject({ textual: z.tuple([z.literal('contents')]), image: z.tuple([z.literal('file')]), visibility: z.tuple([z.literal('hidden')]) }),
    changesState: z.literal(true), applyBlockedReasonCodes: z.array(blockerSchema), applyBlockedMessage: z.string().min(1).max(500).optional(),
    confirmationStatus: z.enum(['required', 'confirmed']), applyAllowed: z.boolean(),
}).superRefine((p, ctx) => {
    if (p.documentKey !== p.documentBefore.key)
        ctx.addIssue({ code: 'custom', message: 'Plan must bind the native document context.' });
    if (p.selectorMatches !== (p.dataset.index < p.before.datasets.length && p.before.datasets[p.dataset.index] === p.dataset.name))
        ctx.addIssue({ code: 'custom', message: 'selectorMatches must follow the dataset list.' });
    if (!same(applyDatasetExpectedBlockers(p), p.applyBlockedReasonCodes))
        ctx.addIssue({ code: 'custom', message: 'Plan must expose exactly the blockers of its evidence.' });
    if ((p.applyBlockedMessage === undefined) !== (p.applyBlockedReasonCodes.length === 0))
        ctx.addIssue({ code: 'custom', message: 'A blocked plan carries one message, an unblocked one none.' });
    if (p.applyAllowed !== (p.confirmationStatus === 'confirmed' && p.applyBlockedReasonCodes.length === 0))
        ctx.addIssue({ code: 'custom', message: 'Invalid admission flags.' });
    p.before.bound.forEach((row, index) => {
        if (row.variable >= p.before.variables.length)
            ctx.addIssue({ code: 'custom', message: 'A bound item names a variable that is not listed.', path: ['before', 'bound', index] });
    });
});
const CHANGED_FIELDS = ['contents', 'runs', 'bounds', 'file', 'hidden'];
const changedSchema = z.strictObject({
    variable: z.number().int().nonnegative(), rank: rankSchema, property: z.enum(['content', 'visibility']), type: z.string().max(64), name: z.string().max(1024),
    uuidBefore: z.string().min(1).max(256), uuidAfter: z.string().min(1).max(256), fields: z.array(z.enum(CHANGED_FIELDS)).max(CHANGED_FIELDS.length),
});
const postconditionSchema = z.strictObject({
    activeDataSet: z.strictObject({ name: z.string().max(1024) }),
    changed: z.array(changedSchema).max(DATASET_MAX_BOUND),
    uuidChanges: z.number().int().nonnegative().max(DATASET_MAX_BOUND),
    selection: z.strictObject({ before: selectionSchema, after: selectionSchema, changed: z.boolean() }),
    saved: z.strictObject({ before: z.boolean(), after: z.boolean() }),
    unbound: z.strictObject({ count: z.number().int().nonnegative(), witness: hex24 }),
    items: z.number().int().nonnegative(),
});
const transactionSchema = artboardTransactionSchema(APPLY_DATASET_OPERATION, { restoredStateDigest: hex24.nullable() }, { restoredStateDigest: null }, (v) => v.restoredStateDigest !== null);
const scanMsSchema = z.array(z.number().int().nonnegative()).max(16).optional();
export const applyDatasetResultSchema = z.union([
    z.strictObject({ scanMs: scanMsSchema, operation: z.literal(APPLY_DATASET_OPERATION), applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ scanMs: scanMsSchema, operation: z.literal(APPLY_DATASET_OPERATION), applied: z.literal(true), document: documentContextSchema, plan: planSchema, postcondition: postconditionSchema, transaction: transactionSchema }),
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
        const p = r.postcondition, bound = r.plan.before.bound;
        if (p.activeDataSet.name !== r.plan.dataset.name)
            ctx.addIssue({ code: 'custom', message: 'The displayed dataset must be the requested one.' });
        if (p.changed.length !== bound.length || p.changed.some((row, i) => row.variable !== bound[i].variable || row.rank !== bound[i].rank || row.property !== bound[i].property || row.uuidBefore !== bound[i].uuid)
            || p.uuidChanges !== p.changed.filter((row) => row.uuidBefore !== row.uuidAfter).length)
            ctx.addIssue({ code: 'custom', message: 'Every planned bound item needs one verified row, found again by its variable and rank.' });
        if (p.unbound.count !== r.plan.before.unbound.count || p.unbound.witness !== r.plan.before.unbound.witness || p.items !== r.plan.before.structure.items)
            ctx.addIssue({ code: 'custom', message: 'The items outside every binding must be unchanged.' });
    }
    if (r.transaction.state === 'rolled_back' && r.transaction.rollback.restoredStateDigest !== r.plan.stateDigest)
        ctx.addIssue({ code: 'custom', message: 'Recovery must prove the baseline state digest.' });
});
const responseSchema = z.strictObject({ outcome: applyDatasetResultSchema, delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }) });
export const APPLY_DATASET_SAFETY = artboardSafetyRegistration(APPLY_DATASET_OPERATION);
export const APPLY_DATASET_SAFETY_IDENTITY = canonicalDigest(APPLY_DATASET_SAFETY);
const assertSafety = artboardSafetyAsserter(APPLY_DATASET_SAFETY, (value) => {
    const r = applyDatasetResultSchema.parse(value);
    return { operationId: APPLY_DATASET_OPERATION, documentKey: r.plan.documentKey,
        identityToken: `artboard-update-v1:${canonicalDigest({ operation: APPLY_DATASET_OPERATION, dataset: r.plan.dataset, beforeDigest: r.plan.beforeDigest })}`,
        beforeState: { path: r.plan.documentBefore.path, fileRevision: r.plan.documentBefore.fileRevision, snapshot: r.plan.before, beforeDigest: r.plan.beforeDigest, stateDigest: r.plan.stateDigest },
        afterState: { dataset: r.plan.dataset, afterKnown: r.plan.afterKnown },
        changeSet: { dataset: r.plan.dataset, expectedChange: r.plan.expectedChange, profile: r.plan.profile },
        blocked: r.plan.applyBlockedReasonCodes.length > 0, confirmationStatus: r.plan.confirmationStatus, applyAllowed: r.plan.applyAllowed,
        transactionState: r.transaction.state, applied: r.applied };
});
export const APPLY_DATASET_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}${READ_PAGE_ITEM_AT_HELPER}${OBJECT_WITNESS_HELPERS}${OBJECT_WALK_HELPERS}${DATASET_HOST_HELPERS}
var AD_ADMITTED = ${JSON.stringify(ADMITTED_PROFILES)}, AD_MAX_LISTED = ${MAX_LISTED}, AD_ZERO = "000000000000000000000000";
var AD_SNAPSHOT_BUDGET = ${DATASET_SNAPSHOT_BUDGET_MS}, AD_LATER_BUDGET = ${DATASET_LATER_BUDGET_MS}, AD_PREFLIGHT_MAX = ${DATASET_PREFLIGHT_MAX_MS};
var AD_BLOCKERS = ${JSON.stringify(APPLY_DATASET_BLOCKERS)};
var AD_FIELDS = ["name", "layer", "locked", "opacity", "bounds", "hidden", "contents", "runs", "file"];
function adFail(message) { throw mutationError("preflight_failed", message); }
function adSame(a, b) { return stringifyJson(a) === stringifyJson(b); }
function adHas(list, code) { var i; for (i = 0; i < list.length; i++) if (list[i] === code) return true; return false; }
function adBoundRows(snapshot) {
  var rows = [], i, j;
  for (i = 0; i < snapshot.variables.length; i++) for (j = 0; j < snapshot.variables[i].rows.length; j++) rows.push(snapshot.variables[i].rows[j]);
  return rows;
}
// The digests: \`identity\` binds the whole state including every uuid (the compare-and-set of the apply); \`state\` leaves out the uuids, the selection and the displayed
// dataset, so it is the same before and after a correct write-back (the proof of the inverse).
function adDigests(snapshot, structure, witness) {
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
function adBoundJson(snapshot) {
  var out = [], rows = adBoundRows(snapshot), i, row, state;
  for (i = 0; i < rows.length; i++) {
    row = rows[i]; state = { hidden: row.hidden };
    if (row.contents !== undefined) { state.textLength = row.contents.length; state.textPreview = row.contents.substring(0, 40); state.runCount = row.runCount; }
    if (row.file !== undefined) state.linkName = String(row.file).substring(String(row.file).lastIndexOf("/") + 1);
    out.push({ variable: row.variable, rank: row.rank, property: row.property, type: row.type, name: row.name, uuid: row.uuid, layer: row.layer, state: state });
  }
  return out;
}
function adDisplayed(snapshot) {
  if (snapshot.displayed === undefined || snapshot.displayed.status === "unavailable") return { status: "unavailable" };
  if (snapshot.displayed.status === "none") return { status: "none" };
  return { status: "readable", name: snapshot.displayed.name };
}
function adBefore(snapshot, structure, witness, selection) {
  var variables = [], i;
  for (i = 0; i < snapshot.variables.length; i++) variables.push({ index: i, name: snapshot.variables[i].name, kind: snapshot.variables[i].kind, bound: snapshot.variables[i].bound });
  return { structure: structure, variablesLocked: snapshot.locked, variables: variables, datasets: snapshot.datasets, displayedDataset: adDisplayed(snapshot),
    bound: adBoundJson(snapshot), unbound: witness, selection: selection };
}
function adBlockerOrder(found) {
  var out = [], i;
  for (i = 0; i < AD_BLOCKERS.length; i++) if (adHas(found, AD_BLOCKERS[i])) out.push(AD_BLOCKERS[i]);
  return out;
}
function adResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var doc = app.activeDocument, selector = params.dataset, dataset = null, selectorOk = false, i, row, found = [], blocked = [], messages = [], admitted = false, reasons;
  if (selector.index < doc.dataSets.length && String(doc.dataSets[selector.index].name) === selector.name) { selectorOk = true; dataset = doc.dataSets[selector.index]; }
  var readStarted = new Date().getTime(), readMs;
  var snapshot = dvSnapshot(doc, true, AD_SNAPSHOT_BUDGET), rows = adBoundRows(snapshot);
  var structure = dvStructure(doc), selection = dvSelection(doc);
  var witness = snapshot.scanComplete ? dvWitness(doc, snapshot) : { count: 0, witness: AD_ZERO };
  readMs = new Date().getTime() - readStarted;
  var before = adBefore(snapshot, structure, witness, selection), digests = adDigests(snapshot, structure, witness);
  for (i = 0; i < AD_ADMITTED.length; i++) if (context.mutationProfile === AD_ADMITTED[i]) admitted = true;
  if (!context.mutationAllowed || !admitted) found.push("document_mutation_not_allowed");
  if (!selectorOk) { found.push("dataset_selector_mismatch"); messages.push("the document has no dataset " + selector.index + " named that way; call illustrator_list_variables again"); }
  if (rows.length === 0) { found.push("nothing_to_apply"); messages.push("no item is bound to a variable, so showing a dataset changes nothing"); }
  for (i = 0; i < snapshot.variables.length; i++) {
    if (snapshot.variables[i].kind === "graph" && snapshot.variables[i].bound > 0) { found.push("graph_variable_bound"); messages.push("a graph variable is bound; the graph data cannot be read back, so a display could not be verified or undone"); }
    if (snapshot.variables[i].kind === "unknown" && snapshot.variables[i].bound > 0) { found.push("unsupported_variable_kind"); messages.push("a variable of an unknown kind is bound"); }
  }
  for (i = 0; i < rows.length; i++) {
    row = rows[i]; reasons = row.reasons;
    if (reasons.length === 0) continue;
    if (blocked.length >= AD_MAX_LISTED) adFail("More than " + AD_MAX_LISTED + " bound items block the change.");
    blocked.push({ variable: row.variable, rank: row.rank, type: row.type, name: row.name, reasons: reasons });
    if (adHas(reasons, "binding_unconfirmed") || adHas(reasons, "unsupported_bound_type")) found.push("bindings_incomplete");
    if (adHas(reasons, "multi_run_text") || adHas(reasons, "multi_paragraph_text") || adHas(reasons, "text_attribute_unreadable")) {
      found.push("text_formatting_not_restorable");
      messages.push("the text " + row.name + (adHas(reasons, "multi_paragraph_text") ? " has several paragraphs (unmeasured)" : (adHas(reasons, "text_attribute_unreadable") ? " has a character attribute that cannot be read, so one run cannot be proved" : " has several runs")) + "; a display collapses the formatting and no write-back restores it");
    }
    if (adHas(reasons, "text_too_long")) { found.push("text_too_long_to_verify"); messages.push("the text " + row.name + " is too long to read back within the time budget"); }
  }
  if (!snapshot.scanComplete) { found.push("scan_limit_exceeded"); messages.push("more than " + DV_MAX_BOUND + " items are bound (or too many variables or datasets); split the work"); }
  if (readMs > AD_PREFLIGHT_MAX) { found.push("text_too_long_to_verify"); messages.push("reading the bound items took " + readMs + " ms; the verification and a rollback read them again, so more than " + AD_PREFLIGHT_MAX + " ms is refused; split the work"); }
  var blockers = adBlockerOrder(found), message = null;
  if (blockers.length > 0) { message = messages.join("; "); if (message.length > 500) message = message.substring(0, 497) + "..."; if (message.length === 0) message = "The change is blocked: " + blockers.join(", ") + "."; }
  if (stringifyJson(before).length * 3 > ${SNAPSHOT_RESULT_ADMISSION_BYTES}) adFail("The plan would exceed the result size limit (result_too_large); fewer items must be bound.");
  if (forApply) {
    if (params.expectedDigest !== digests.identity) adFail("expected_digest does not match the current bound state; plan again.");
    if (blockers.length > 0) adFail(message);
  }
  return { context: context, document: doc, dataset: dataset, snapshot: snapshot, structure: structure, selection: selection, witness: witness, before: before, digests: digests,
    blockers: blockers, message: message, blocked: blocked, selectorOk: selectorOk, saved: doc.saved === true, readMs: readMs };
}
function adPlan(p) {
  var plan = { operation: "apply_dataset", profile: "dataset_display_v1", documentKey: p.context.key, documentBefore: p.context, dataset: params.dataset, selectorMatches: p.selectorOk,
    before: p.before, beforeDigest: p.digests.identity, stateDigest: p.digests.state, scanComplete: p.snapshot.scanComplete, readMs: p.readMs, blockedBindings: p.blocked, afterKnown: "after_display_only",
    expectedChange: { textual: ["contents"], image: ["file"], visibility: ["hidden"] }, changesState: true, applyBlockedReasonCodes: p.blockers };
  if (p.message !== null) plan.applyBlockedMessage = p.message;
  plan.confirmationStatus = params.apply === true ? "confirmed" : "required";
  plan.applyAllowed = params.apply === true && p.blockers.length === 0;
  return plan;
}
// The preflight of this same call has just read and proved the complete before; nothing runs between it and the apply, so this re-reads the cheap parts only.
function adRevalidate(p) {
  try {
    var i, j, items;
    if (app.documents.length === 0 || app.activeDocument !== p.document) adFail("Document reference changed before apply.");
    if (!adSame(dvStructure(p.document), p.structure)) adFail("The document structure changed before apply.");
    if (p.document.dataSets.length !== p.snapshot.datasets.length || String(p.document.dataSets[params.dataset.index].name) !== params.dataset.name) adFail("The dataset list changed before apply.");
    if (p.document.variables.length !== p.snapshot.variables.length) adFail("The variable list changed before apply.");
    for (i = 0; i < p.snapshot.variables.length; i++) {
      items = p.document.variables[i].pageItems;
      if (items.length !== p.snapshot.variables[i].rows.length) adFail("The items bound to a variable changed before apply.");
      for (j = 0; j < items.length; j++) if (String(items[j].uuid) !== p.snapshot.variables[i].rows[j].uuid) adFail("A bound item changed before apply.");
    }
  } catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "The bound items or the document changed before apply.")); }
}
function adApply(p, plan, state) {
  state.operationState.mutationStarted = true;
  try { p.dataset.display(); } catch (error) { mutationNativeFailure("Dataset.display", error); }
}
function adSelectionAfter(doc) { return dvSelection(doc); }
// What a display may change on a bound item, by the binding kinds of the item (the union when it is bound twice).
function adAllowed(beforeRows) {
  var allowed = {}, i, row, set, k;
  for (i = 0; i < beforeRows.length; i++) {
    row = beforeRows[i]; set = allowed["u:" + row.uuid]; if (set === undefined) { set = {}; allowed["u:" + row.uuid] = set; }
    if (row.property === "visibility") set.hidden = true;
    else if (row.type === "TextFrame") { set.contents = true; set.bounds = true; }
    else if (row.type === "PlacedItem") { set.file = true; set.bounds = true; }
  }
  return allowed;
}
function adCompare(p, after) {
  var beforeRows = adBoundRows(p.snapshot), afterRows = adBoundRows(after), allowed = adAllowed(beforeRows), changed = [], i, j, b, a, fields, f, allow, uuidChanges = 0;
  if (beforeRows.length !== afterRows.length) throw mutationError("verify_mismatch", "The bound items could not be found again: " + afterRows.length + " of " + beforeRows.length + ".");
  for (i = 0; i < beforeRows.length; i++) {
    b = beforeRows[i]; a = afterRows[i];
    if (a.variable !== b.variable || a.rank !== b.rank || a.property !== b.property || a.type !== b.type || a.name !== b.name) throw mutationError("verify_mismatch", "A bound item could not be found again through its variable: " + b.name + ".");
    if (adHas(a.reasons, "binding_unconfirmed") || adHas(a.reasons, "unsupported_bound_type") || adHas(a.reasons, "text_too_long") || adHas(a.reasons, "text_attribute_unreadable") || adHas(a.reasons, "multi_run_text")) throw mutationError("verify_mismatch", "A bound item is unreadable after the display: " + b.name + ".");
    fields = []; allow = allowed["u:" + b.uuid];
    for (j = 0; j < AD_FIELDS.length; j++) {
      f = AD_FIELDS[j];
      if (b[f] === a[f]) continue;
      // The formatting signature of a text may change only when the text was or becomes empty (no character carries a format then). A display that alters the formatting
      // of a text that has characters is a change nothing here can write back, so it is a mismatch, never an expected change.
      if (f === "runs") {
        if (b.runCount === 0 || a.runCount === 0) { fields.push(f); continue; }
        throw mutationError("verify_mismatch", "The character formatting of " + b.name + " changed (runs); a write-back of the contents does not restore it.");
      }
      if (allow.hasOwnProperty(f) !== true) throw mutationError("verify_mismatch", "An attribute the dataset does not govern changed: " + f + " of " + b.name + ".");
      fields.push(f);
    }
    if (a.uuid !== b.uuid) uuidChanges++;
    changed.push({ variable: b.variable, rank: b.rank, property: b.property, type: b.type, name: b.name, uuidBefore: b.uuid, uuidAfter: a.uuid, fields: fields });
  }
  return { changed: changed, uuidChanges: uuidChanges };
}
// Items bound to one variable show one value after a display.
function adAgree(after) {
  var i, j, first, value;
  for (i = 0; i < after.variables.length; i++) {
    first = null;
    for (j = 0; j < after.variables[i].rows.length; j++) {
      value = after.variables[i].kind === "visibility" ? (after.variables[i].rows[j].hidden ? "1" : "0") : (after.variables[i].kind === "image" ? after.variables[i].rows[j].file : after.variables[i].rows[j].contents);
      if (first === null) first = { value: value }; else if (first.value !== value) throw mutationError("verify_mismatch", "Items bound to the variable " + after.variables[i].name + " do not show one value after the display.");
    }
  }
}
function adRead(p) {
  if (app.documents.length === 0 || app.activeDocument !== p.document) throw mutationError("verify_mismatch", "Document reference changed.");
  var current = getDocumentContext();
  if (current.path !== p.context.path || current.fileRevision !== p.context.fileRevision || current.name !== p.context.name || current.appVersion !== p.context.appVersion) throw mutationError("verify_mismatch", "The document file identity changed after apply.");
  var snapshot = dvSnapshot(p.document, true, AD_LATER_BUDGET), structure = dvStructure(p.document);
  return { snapshot: snapshot, structure: structure };
}
function adVerify(p, plan, state) {
  var read = adRead(p), after = read.snapshot, i, compared, witness;
  if (!adSame(read.structure, p.structure)) throw mutationError("verify_mismatch", "The document structure changed.");
  if (!after.scanComplete || after.locked !== p.snapshot.locked || !adSame(after.datasets, p.snapshot.datasets) || after.variables.length !== p.snapshot.variables.length) throw mutationError("verify_mismatch", "The variable or dataset list changed.");
  for (i = 0; i < after.variables.length; i++) if (after.variables[i].name !== p.snapshot.variables[i].name || after.variables[i].kind !== p.snapshot.variables[i].kind || after.variables[i].bound !== p.snapshot.variables[i].bound) throw mutationError("verify_mismatch", "A variable changed.");
  compared = adCompare(p, after);
  adAgree(after);
  if (after.displayed === undefined || after.displayed.status !== "readable" || after.displayed.name !== params.dataset.name) throw mutationError("verify_mismatch", "The displayed dataset is not " + params.dataset.name + ".");
  witness = dvWitness(p.document, after);
  if (witness.count !== p.witness.count || witness.witness !== p.witness.witness) throw mutationError("verify_mismatch", "An item outside every binding changed.");
  var selection = adSelectionAfter(p.document);
  return { activeDataSet: { name: after.displayed.name }, changed: compared.changed, uuidChanges: compared.uuidChanges,
    selection: { before: p.selection, after: selection, changed: !adSame(p.selection, selection) }, saved: { before: p.saved, after: p.document.saved === true },
    unbound: { count: witness.count, witness: witness.witness }, items: read.structure.items };
}
function adWriteBack(p, after) {
  var beforeRows = adBoundRows(p.snapshot), afterRows = adBoundRows(after), i, pass, b, a, kind;
  // The links last: writing a file gives the item a new uuid, so a handle read before the write (the same item bound to a second variable) must not be used after it.
  for (pass = 0; pass < 2; pass++) for (i = 0; i < beforeRows.length; i++) {
    b = beforeRows[i]; a = afterRows[i]; kind = p.snapshot.variables[b.variable].kind;
    if (pass === 0 && kind === "textual" && b.contents !== a.contents) a.item.contents = b.contents;
    else if (pass === 0 && kind === "visibility" && b.hidden !== a.hidden) a.item.hidden = b.hidden;
    else if (pass === 1 && kind === "image" && b.file !== a.file) a.item.file = new File(b.file);
  }
}
function adRollback(state) {
  var p = state.preflight, after, witness, digests, i, rows, found;
  try {
    if (!p || app.documents.length === 0 || app.activeDocument !== p.document) return { status: "indeterminate", message: "Rollback document is indeterminate." };
    after = dvSnapshot(p.document, true, AD_LATER_BUDGET);
    if (!after.scanComplete || after.variables.length !== p.snapshot.variables.length) return { status: "indeterminate", message: "Rollback could not read the variables again." };
    rows = adBoundRows(after); found = adBoundRows(p.snapshot);
    if (rows.length !== found.length) return { status: "indeterminate", message: "Rollback could not find the bound items again." };
    for (i = 0; i < rows.length; i++) if (rows[i].variable !== found[i].variable || rows[i].rank !== found[i].rank || rows[i].type !== found[i].type || rows[i].name !== found[i].name) return { status: "indeterminate", message: "Rollback could not find a bound item again through its variable." };
    witness = dvWitness(p.document, after); digests = adDigests(after, dvStructure(p.document), witness);
    if (digests.state !== p.digests.state) {
      adWriteBack(p, after);
      after = dvSnapshot(p.document, true, AD_LATER_BUDGET);
      witness = dvWitness(p.document, after); digests = adDigests(after, dvStructure(p.document), witness);
    }
    state.operationState.rollbackEvidence.restoredStateDigest = digests.state;
    if (digests.state !== p.digests.state) return { status: "failed", message: "Rollback did not restore the baseline state of the bound items." };
    return { status: "verified" };
  } catch (error) { return { status: "indeterminate", message: "Rollback could not prove the baseline state." }; }
}
var adExecution = runMutationTransaction({
  apply: params.apply === true,
  initialOperationState: function () { return { mutationStarted: false, rollbackEvidence: { restoredStateDigest: null } }; },
  preflight: adResolve, plan: adPlan, revalidate: adRevalidate, applyMutation: adApply, verify: adVerify, rollback: adRollback,
  hasMutationEvidence: function (s) { return s.operationState.mutationStarted === true; },
  applyIndeterminate: function () { return { reasonCode: "artboard_state_unknown", message: "Dataset display outcome is indeterminate.", evidence: { restoredStateDigest: null } }; },
  rollbackEvidence: function (s) { return s.operationState.rollbackEvidence; }
});
var adDocument = adExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === adExecution.preflight.document) adDocument = getDocumentContext();
var result = { operation: "apply_dataset", applied: adExecution.transaction.state === "verified", document: adDocument, plan: adExecution.plan, transaction: adExecution.transaction };
if (result.applied) result.postcondition = adExecution.value;
if (dvScanMs.length > 0) result.scanMs = dvScanMs;
`;
export const APPLY_DATASET_HOST_SCRIPT_DIGEST = canonicalSha256(APPLY_DATASET_SCRIPT);
export const APPLY_DATASET_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: APPLY_DATASET_OPERATION, validator: APPLY_DATASET_VALIDATOR,
    canonicalContractVersion: 1, resultSchemaVersion: 1, terminalClassifierVersion: 1, safetyConformanceVersion: 1, errorMappingVersion: 1,
    safetyIdentity: APPLY_DATASET_SAFETY_IDENTITY, hostScriptDigest: APPLY_DATASET_HOST_SCRIPT_DIGEST, mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalSchema.parse(input);
    const { commandId: _commandId, ...bound } = request;
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: request.apply ? request.commandId : null, documentKey: request.expectedDocumentKey,
        digest: canonicalSha256({ operation: APPLY_DATASET_OPERATION, validator: APPLY_DATASET_VALIDATOR, request: bound }) };
}
export const applyDatasetToolContract = {
    name: 'illustrator_apply_dataset', title: 'Plan or Display an Existing Dataset',
    description: 'Show one existing dataset of the active document (Dataset.display()): every item bound to a variable takes that dataset\'s text, visibility or image at once. Plan reads the bound items (from illustrator_list_variables) and what lies outside every binding and returns beforeDigest; apply compares it, displays the dataset once, reads everything back and writes the previous values back if anything else changed. Bound text and visibility edited by hand are overwritten. A bound image gets a new UUID (the result lists old and new) and the selection may change (reported). Refused: graph variables, text of several runs (a display collapses the formatting). Illustrator frontmost.',
    inputSchema, publicInputSchema: applyDatasetPublicInputSchema, outputSchema: responseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(APPLY_DATASET_SAFETY.policy), normalizePublicInput,
};
export function createApplyDatasetAdapter() {
    return {
        version: 1, operation: APPLY_DATASET_OPERATION, validator: APPLY_DATASET_VALIDATOR,
        safety: APPLY_DATASET_SAFETY, safetyRegistrationIdentity: APPLY_DATASET_SAFETY_IDENTITY, adapterIdentity: APPLY_DATASET_ADAPTER_IDENTITY,
        tool: applyDatasetToolContract, canonical: { version: 1, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: applyDatasetResultSchema, resultSchemaVersion: 1, terminalClassifierVersion: 1, safetyConformanceVersion: 1, errorMappingVersion: 1,
        hostScriptDigest: APPLY_DATASET_HOST_SCRIPT_DIGEST, mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const n = normalizedRequest(input), { commandId: _commandId, ...params } = n.request;
            if (n.intent === 'plan')
                return { kind: 'read', script: APPLY_DATASET_SCRIPT, params, timeoutMs: DATASET_HOST_TIMEOUT_MS };
            return { kind: 'mutation', mutationValidator: APPLY_DATASET_VALIDATOR, idempotency: { commandId: n.commandId, operation: APPLY_DATASET_OPERATION, documentKey: n.documentKey, requestDigest: n.digest },
                adapterIdentity: APPLY_DATASET_ADAPTER_IDENTITY, mutationHostApplicationMode: 'foreground', script: APPLY_DATASET_SCRIPT, params, timeoutMs: DATASET_HOST_TIMEOUT_MS };
        },
        classifyTerminal(value) { return classifyArtboardTerminal(applyDatasetResultSchema.parse(value).transaction.state, 'Dataset display'); },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error) { return error instanceof Error ? error : new Error(String(error)); },
    };
}
