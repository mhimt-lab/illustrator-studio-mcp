import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { DATASET_EDIT_HELPERS, DATASET_EDIT_MAX_LISTED } from '../dataset-edit-host-script.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema } from '../mutation-result-schema-core.js';
import { canonicalDigest, operationSafetyPolicyToMcpAnnotations } from '../operation-safety-policy-core.js';
import { OBJECT_WALK_HELPERS, OBJECT_WITNESS_HELPERS, READ_PAGE_ITEM_AT_HELPER } from '../page-item-walk.js';
import { DATASET_HOST_HELPERS, DATASET_HOST_TIMEOUT_MS, DATASET_MAX_BOUND, DATASET_MAX_DATASETS, DATASET_MAX_TEXT, DATASET_MAX_VARIABLES } from '../variables-host-script.js';
import { applyDatasetBeforeSchema } from './apply-dataset-adapter.js';
import { artboardSafetyAsserter, artboardSafetyRegistration, artboardTransactionSchema, classifyArtboardTerminal } from './artboard-update-safety.js';
import { SNAPSHOT_RESULT_ADMISSION_BYTES } from './snapshot-result-size.js';
export const UPDATE_DATASET_OPERATION = 'update_dataset';
export const UPDATE_DATASET_PREFLIGHT_MAX_MS = 3_000;
export const UPDATE_DATASET_LATER_BUDGET_MAX_MS = 3_300;
export const UPDATE_DATASET_READ_COUNT_BOUND = 10;
export const UPDATE_DATASET_VALIDATOR = { kind: UPDATE_DATASET_OPERATION, version: 1 };
const keySchema = z.string().min(1).max(16_384);
const hex24 = z.string().regex(/^[0-9a-f]{24}$/u);
const selectorSchema = z.strictObject({ index: z.number().int().nonnegative().max(DATASET_MAX_DATASETS - 1), name: z.string().min(1).max(1024) });
const rankSchema = z.number().int().nonnegative().max(DATASET_MAX_BOUND);
const selectionSchema = z.strictObject({ count: z.number().int().min(-1), items: z.array(z.strictObject({ type: z.string().max(64), name: z.string().max(1024) })).max(20) });
const displayedSchema = z.discriminatedUnion('status', [z.strictObject({ status: z.literal('readable'), name: z.string().max(1024) }), z.strictObject({ status: z.literal('none') }), z.strictObject({ status: z.literal('unavailable') })]);
const common = { expectedDocumentKey: keySchema, dataset: selectorSchema };
const internalSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...common, apply: z.literal(false) }),
    z.strictObject({ ...common, apply: z.literal(true), expectedDigest: hex24, commandId: canonicalCommandIdSchema }),
]);
const publicCommon = { expected_document_key: keySchema, dataset: selectorSchema.describe('index and name must both match (names are unique in a document)') };
export const updateDatasetPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...publicCommon, apply: z.literal(false).default(false) }),
    z.strictObject({ ...publicCommon, apply: z.literal(true), expected_digest: hex24.describe("Copy of the plan's beforeDigest (use the plan's next_call)."), command_id: applyCommandIdSchema }),
]);
const inputSchema = z.strictObject({ ...publicCommon, apply: z.boolean().default(false), expected_digest: hex24.optional(), command_id: applyCommandIdSchema.optional() });
const { $schema: _schemaDialect, ...publishedSchema } = z.toJSONSchema(updateDatasetPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedSchema });
function normalizePublicInput(input) {
    const v = updateDatasetPublicInputSchema.parse(input);
    const base = { expectedDocumentKey: v.expected_document_key, dataset: v.dataset };
    return v.apply ? { ...base, apply: true, expectedDigest: v.expected_digest, commandId: v.command_id } : { ...base, apply: false };
}
export const UPDATE_DATASET_BLOCKERS = ['document_mutation_not_allowed', 'dataset_selector_mismatch', 'nothing_to_update', 'graph_variable_bound', 'unsupported_variable_kind',
    'variable_without_bound_item', 'bound_values_disagree', 'bindings_incomplete', 'text_formatting_not_restorable', 'text_too_long_to_verify', 'scan_limit_exceeded'];
const blockerSchema = z.enum(UPDATE_DATASET_BLOCKERS);
const BINDING_REASONS = ['binding_unconfirmed', 'unsupported_bound_type', 'multi_run_text', 'multi_paragraph_text', 'text_attribute_unreadable', 'text_too_long'];
const ADMITTED_PROFILES = ['saved_file', 'unsaved_document', 'dirty_file'];
function same(a, b) { return canonicalSha256(a) === canonicalSha256(b); }
export function updateDatasetExpectedBlockers(p) {
    const out = [];
    const reasons = new Set(p.blockedBindings.flatMap((row) => row.reasons));
    if (!p.documentBefore.mutationAllowed || !ADMITTED_PROFILES.includes(p.documentBefore.mutationProfile ?? ''))
        out.push('document_mutation_not_allowed');
    if (!p.selectorMatches)
        out.push('dataset_selector_mismatch');
    if (p.before.bound.length === 0)
        out.push('nothing_to_update');
    if (p.before.variables.some((v) => v.kind === 'graph' && v.bound > 0))
        out.push('graph_variable_bound');
    if (p.before.variables.some((v) => v.kind === 'unknown' && v.bound > 0))
        out.push('unsupported_variable_kind');
    if (p.before.variables.some((v) => v.bound === 0))
        out.push('variable_without_bound_item');
    if (p.disagreeingVariables.length > 0)
        out.push('bound_values_disagree');
    if (reasons.has('binding_unconfirmed') || reasons.has('unsupported_bound_type'))
        out.push('bindings_incomplete');
    if (reasons.has('multi_run_text') || reasons.has('multi_paragraph_text') || reasons.has('text_attribute_unreadable'))
        out.push('text_formatting_not_restorable');
    if (reasons.has('text_too_long') || p.readMs > UPDATE_DATASET_PREFLIGHT_MAX_MS)
        out.push('text_too_long_to_verify');
    if (!p.scanComplete)
        out.push('scan_limit_exceeded');
    return out;
}
const planSchema = z.strictObject({
    operation: z.literal(UPDATE_DATASET_OPERATION), profile: z.literal('dataset_update_v1'), documentKey: keySchema, documentBefore: documentContextSchema,
    disagreeingVariables: z.array(z.string().max(1024)).max(DATASET_MAX_VARIABLES).describe('Variables whose bound items show different values (a dataset keeps one value per variable): refused until they agree.'),
    dataset: selectorSchema, selectorMatches: z.boolean(), before: applyDatasetBeforeSchema, beforeDigest: hex24, stateDigest: hex24, scanComplete: z.boolean(),
    readMs: z.number().int().nonnegative().max(600_000).describe('Milliseconds the first read of the bound items and of the rest took; more than the budget refuses (text_too_long_to_verify), because the apply reads about ten times and displays up to five times (the limit is UPDATE_DATASET_PREFLIGHT_MAX_MS).'),
    blockedBindings: z.array(z.strictObject({ variable: z.number().int().nonnegative(), rank: rankSchema, type: z.string().max(64), name: z.string().max(1024), reasons: z.array(z.enum(BINDING_REASONS)).min(1).max(4) })).max(DATASET_EDIT_MAX_LISTED),
    overwrites: z.literal('current_values_of_bound_items').describe('After the apply the dataset holds the values the bound items show now; what it held before is read during the apply and reported as previous.'),
    changesState: z.literal(true), applyBlockedReasonCodes: z.array(blockerSchema), applyBlockedMessage: z.string().min(1).max(500).optional(),
    confirmationStatus: z.enum(['required', 'confirmed']), applyAllowed: z.boolean(),
}).superRefine((p, ctx) => {
    if (p.documentKey !== p.documentBefore.key)
        ctx.addIssue({ code: 'custom', message: 'Plan must bind the native document context.' });
    if (p.selectorMatches !== (p.dataset.index < p.before.datasets.length && p.before.datasets[p.dataset.index] === p.dataset.name))
        ctx.addIssue({ code: 'custom', message: 'selectorMatches must follow the dataset list.' });
    if (!same(updateDatasetExpectedBlockers(p), p.applyBlockedReasonCodes))
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
const valueSchema = z.strictObject({ hidden: z.boolean(), textLength: z.number().int().nonnegative().max(2 * DATASET_MAX_TEXT).optional(), textPreview: z.string().max(40).optional(), linkName: z.string().max(1024).optional() });
const valueRowSchema = z.strictObject({ variable: z.number().int().nonnegative().max(DATASET_MAX_VARIABLES - 1), rank: rankSchema, property: z.enum(['content', 'visibility']), type: z.string().max(64), name: z.string().max(1024), value: valueSchema });
const postconditionSchema = z.strictObject({
    dataset: selectorSchema,
    previous: z.array(valueRowSchema).max(DATASET_MAX_BOUND).describe('The values the dataset held before the update, read by displaying it.'),
    written: z.array(valueRowSchema).max(DATASET_MAX_BOUND).describe('The values it holds now (the bound items as they were).'),
    changedRows: z.number().int().nonnegative().max(DATASET_MAX_BOUND).describe('How many bound items have a value that differs from what the dataset held.'),
    displayed: z.strictObject({ before: displayedSchema, after: displayedSchema, restored: z.boolean() }),
    uuidChanges: z.number().int().nonnegative().max(DATASET_MAX_BOUND),
    selection: z.strictObject({ before: selectionSchema, after: selectionSchema, changed: z.boolean() }),
    saved: z.strictObject({ before: z.boolean(), after: z.boolean() }),
    unbound: z.strictObject({ count: z.number().int().nonnegative(), witness: hex24 }),
    items: z.number().int().nonnegative(),
});
const transactionSchema = artboardTransactionSchema(UPDATE_DATASET_OPERATION, { restoredStateDigest: hex24.nullable(), datasetProven: z.boolean().nullable() }, { restoredStateDigest: null, datasetProven: null }, (v) => v.restoredStateDigest !== null && v.datasetProven === true);
const scanMsSchema = z.array(z.number().int().nonnegative()).max(16).optional();
export const updateDatasetResultSchema = z.union([
    z.strictObject({ scanMs: scanMsSchema, operation: z.literal(UPDATE_DATASET_OPERATION), applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ scanMs: scanMsSchema, operation: z.literal(UPDATE_DATASET_OPERATION), applied: z.literal(true), document: documentContextSchema, plan: planSchema, postcondition: postconditionSchema, transaction: transactionSchema }),
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
        if (p.dataset.index !== r.plan.dataset.index || p.dataset.name !== r.plan.dataset.name)
            ctx.addIssue({ code: 'custom', message: 'The result must name the planned dataset.' });
        if (p.previous.length !== bound.length || p.written.length !== bound.length || p.previous.some((row, i) => row.variable !== bound[i].variable || row.rank !== bound[i].rank) || p.written.some((row, i) => row.variable !== bound[i].variable || row.rank !== bound[i].rank))
            ctx.addIssue({ code: 'custom', message: 'Every planned bound item needs one previous and one written value.' });
        if (p.unbound.count !== r.plan.before.unbound.count || p.unbound.witness !== r.plan.before.unbound.witness || p.items !== r.plan.before.structure.items)
            ctx.addIssue({ code: 'custom', message: 'The items outside every binding must be unchanged.' });
    }
    if (r.transaction.state === 'rolled_back' && r.transaction.rollback.restoredStateDigest !== r.plan.stateDigest)
        ctx.addIssue({ code: 'custom', message: 'Recovery must prove the baseline state digest.' });
});
const responseSchema = z.strictObject({ outcome: updateDatasetResultSchema, delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }) });
export const UPDATE_DATASET_SAFETY = artboardSafetyRegistration(UPDATE_DATASET_OPERATION);
export const UPDATE_DATASET_SAFETY_IDENTITY = canonicalDigest(UPDATE_DATASET_SAFETY);
const assertSafety = artboardSafetyAsserter(UPDATE_DATASET_SAFETY, (value) => {
    const r = updateDatasetResultSchema.parse(value);
    return { operationId: UPDATE_DATASET_OPERATION, documentKey: r.plan.documentKey,
        identityToken: `artboard-update-v1:${canonicalDigest({ operation: UPDATE_DATASET_OPERATION, dataset: r.plan.dataset, beforeDigest: r.plan.beforeDigest })}`,
        beforeState: { path: r.plan.documentBefore.path, fileRevision: r.plan.documentBefore.fileRevision, snapshot: r.plan.before, beforeDigest: r.plan.beforeDigest, stateDigest: r.plan.stateDigest },
        afterState: { dataset: r.plan.dataset, overwrites: r.plan.overwrites },
        changeSet: { dataset: r.plan.dataset, overwrites: r.plan.overwrites, profile: r.plan.profile },
        blocked: r.plan.applyBlockedReasonCodes.length > 0, confirmationStatus: r.plan.confirmationStatus, applyAllowed: r.plan.applyAllowed,
        transactionState: r.transaction.state, applied: r.applied };
});
export const UPDATE_DATASET_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}${READ_PAGE_ITEM_AT_HELPER}${OBJECT_WITNESS_HELPERS}${OBJECT_WALK_HELPERS}${DATASET_HOST_HELPERS}${DATASET_EDIT_HELPERS}
var UD_ADMITTED = ${JSON.stringify(ADMITTED_PROFILES)}, UD_BLOCKERS = ${JSON.stringify(UPDATE_DATASET_BLOCKERS)}, UD_PREFLIGHT_MAX = ${UPDATE_DATASET_PREFLIGHT_MAX_MS}, UD_LATER_MAX = ${UPDATE_DATASET_LATER_BUDGET_MAX_MS};
function udDatasetByName(doc, name) {
  var i;
  for (i = 0; i < doc.dataSets.length; i++) if (String(doc.dataSets[i].name) === name) return doc.dataSets[i];
  return null;
}
function udResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var doc = app.activeDocument, selector = params.dataset, dataset = null, selectorOk = false, found = [], blocked = [], messages = [], readStarted, readMs;
  if (selector.index < doc.dataSets.length && String(doc.dataSets[selector.index].name) === selector.name) { selectorOk = true; dataset = doc.dataSets[selector.index]; }
  readStarted = new Date().getTime();
  var snapshot = dvSnapshot(doc, true, DE_SNAPSHOT_BUDGET), rows = deBoundRows(snapshot), structure = dvStructure(doc), selection = dvSelection(doc);
  var witness = snapshot.scanComplete ? dvWitness(doc, snapshot) : { count: 0, witness: DE_ZERO };
  readMs = new Date().getTime() - readStarted;
  var before = deBefore(snapshot, structure, witness, selection), digests = deDigests(snapshot, structure, witness);
  if (!deAdmitted(context, UD_ADMITTED)) found.push("document_mutation_not_allowed");
  if (!selectorOk) { found.push("dataset_selector_mismatch"); messages.push("the document has no dataset " + selector.index + " named that way; call illustrator_list_variables again"); }
  if (rows.length === 0) { found.push("nothing_to_update"); messages.push("no item is bound to a variable, so an update would store nothing"); }
  var disagree = deClassify(snapshot, rows, found, messages, blocked, true);
  if (readMs > UD_PREFLIGHT_MAX) { found.push("text_too_long_to_verify"); messages.push("reading the bound items took " + readMs + " ms; the apply reads about ten times and displays up to five times, so more than " + UD_PREFLIGHT_MAX + " ms is refused; split the work"); }
  var blockers = deOrder(found, UD_BLOCKERS), message = deMessage(blockers, messages);
  if (stringifyJson(before).length * 3 > ${SNAPSHOT_RESULT_ADMISSION_BYTES}) deFail("The plan would exceed the result size limit (result_too_large); fewer items must be bound.");
  if (forApply) {
    if (params.expectedDigest !== digests.identity) deFail("expected_digest does not match the current bound state; plan again.");
    if (blockers.length > 0) deFail(message);
  }
  return { context: context, document: doc, dataset: dataset, snapshot: snapshot, structure: structure, selection: selection, witness: witness, before: before, digests: digests,
    blockers: blockers, message: message, blocked: blocked, selectorOk: selectorOk, saved: doc.saved === true, readMs: readMs, valueRows: deValueRows(snapshot), disagree: disagree,
    laterBudget: Math.min(UD_LATER_MAX, 2 * readMs + 1000) };
}
function udPlan(p) {
  var plan = { operation: "update_dataset", profile: "dataset_update_v1", documentKey: p.context.key, documentBefore: p.context, dataset: params.dataset, selectorMatches: p.selectorOk,
    before: p.before, beforeDigest: p.digests.identity, stateDigest: p.digests.state, scanComplete: p.snapshot.scanComplete, readMs: p.readMs, blockedBindings: p.blocked, disagreeingVariables: p.disagree,
    overwrites: "current_values_of_bound_items", changesState: true, applyBlockedReasonCodes: p.blockers };
  if (p.message !== null) plan.applyBlockedMessage = p.message;
  plan.confirmationStatus = params.apply === true ? "confirmed" : "required";
  plan.applyAllowed = params.apply === true && p.blockers.length === 0;
  return plan;
}
function udRevalidate(p) { deRevalidate(p, params.dataset); }
// The dataset displayed before, when it can be read and is not the target: showing it again (then writing the current values back) leaves the document as it was.
function udShowBefore(p) {
  var name = p.snapshot.displayed !== undefined && p.snapshot.displayed.status === "readable" ? p.snapshot.displayed.name : null, other;
  if (name === null || name === params.dataset.name) return false;
  other = udDatasetByName(p.document, name);
  if (other === null) return false;
  try { other.display(); } catch (error) { mutationNativeFailure("Dataset.display", error); }
  return true;
}
function udApply(p, plan, state) {
  var ev = state.operationState, shown, after, check, digests;
  ev.mutationStarted = true;
  // 1. show the target: what it held is what the bound items show now.
  try { p.dataset.display(); } catch (error) { mutationNativeFailure("Dataset.display", error); }
  ev.stage = "target_shown";
  after = deRead(p).snapshot;
  deCompareDisplay(p.snapshot, after);
  deAgree(after);
  ev.previousRows = deValueRows(after); ev.previousDigest = deValuesDigest(after);
  // 2. put the current values back, so update() stores them.
  deWriteValues(p.valueRows, after);
  ev.stage = "current_restored";
  // 3. update (from here the dataset may hold the current values).
  ev.updateCalled = true;
  try { p.dataset.update(); } catch (error) { mutationNativeFailure("Dataset.update", error); }
  ev.stage = "updated";
  // 4. prove it: show the target again; the bound items must show the current values.
  try { p.dataset.display(); } catch (error) { mutationNativeFailure("Dataset.display", error); }
  check = deRead(p).snapshot;
  deCompareDisplay(p.snapshot, check);
  if (deValuesDigest(check) !== deValuesDigest(p.snapshot)) throw mutationError("verify_mismatch", "The dataset does not hold the current values after the update.");
  ev.datasetProven = true;
  // 5. show the dataset that was displayed before and put the current values back (the update is done, the document is as it was).
  shown = udShowBefore(p);
  ev.displayedRestored = shown || (p.snapshot.displayed !== undefined && p.snapshot.displayed.status === "readable" && p.snapshot.displayed.name === params.dataset.name);
  ev.stage = "finishing";
  after = dvSnapshot(p.document, true, p.laterBudget);
  deWriteValues(p.valueRows, after);
  ev.stage = "done";
}
function udVerify(p, plan, state) {
  var ev = state.operationState, read = deRead(p), after = read.snapshot, i, witness, digests, selection, previous, written, changedRows = 0, uuidChanges = 0, rowsBefore, rowsAfter;
  if (!deSame(read.structure, p.structure)) throw mutationError("verify_mismatch", "The document structure changed.");
  if (!after.scanComplete || after.locked !== p.snapshot.locked || !deSame(after.datasets, p.snapshot.datasets) || after.variables.length !== p.snapshot.variables.length) throw mutationError("verify_mismatch", "The variable or dataset list changed.");
  for (i = 0; i < after.variables.length; i++) if (after.variables[i].name !== p.snapshot.variables[i].name || after.variables[i].kind !== p.snapshot.variables[i].kind || after.variables[i].bound !== p.snapshot.variables[i].bound) throw mutationError("verify_mismatch", "A variable changed.");
  witness = dvWitness(p.document, after); digests = deDigests(after, read.structure, witness);
  if (digests.state !== p.digests.state) throw mutationError("verify_mismatch", "The bound items are not in the state they started in.");
  if (witness.count !== p.witness.count || witness.witness !== p.witness.witness) throw mutationError("verify_mismatch", "An item outside every binding changed.");
  if (ev.datasetProven !== true) throw mutationError("verify_mismatch", "The dataset was not proved to hold the current values.");
  selection = dvSelection(p.document);
  rowsBefore = deBoundRows(p.snapshot); rowsAfter = deBoundRows(after);
  for (i = 0; i < rowsBefore.length; i++) if (rowsBefore[i].uuid !== rowsAfter[i].uuid) uuidChanges++;
  previous = deValuesJson(ev.previousRows); written = deValuesJson(p.valueRows);
  for (i = 0; i < previous.length; i++) if (!deSame(previous[i].value, written[i].value)) changedRows++;
  return { dataset: params.dataset, previous: previous, written: written, changedRows: changedRows,
    displayed: { before: deDisplayedJson(p.snapshot), after: deDisplayedJson(after), restored: deSame(deDisplayedJson(p.snapshot), deDisplayedJson(after)) },
    uuidChanges: uuidChanges, selection: { before: p.selection, after: selection, changed: !deSame(p.selection, selection) }, saved: { before: p.saved, after: p.document.saved === true },
    unbound: { count: witness.count, witness: witness.witness }, items: read.structure.items };
}
// The rollback: if update() may have run, write the values the dataset held back and update again, prove it by a display; then show the dataset that was displayed before (whenever it can be read and
// is not the one showing now: a display that threw may still have changed it) and write the current values back.
function udRollback(state) {
  var p = state.preflight, ev = state.operationState, current, proven = true, restored, name, other, shownNow;
  try {
    if (!p || app.documents.length === 0 || app.activeDocument !== p.document) return { status: "indeterminate", message: "Rollback document is indeterminate." };
    if (ev.updateCalled === true) {
      if (ev.previousRows === undefined) return { status: "indeterminate", message: "Rollback has no previous values to put back." };
      current = dvSnapshot(p.document, true, p.laterBudget);
      deWriteValues(ev.previousRows, current);
      try { p.dataset.update(); } catch (error) { return { status: "indeterminate", message: "Rollback could not update the dataset again." }; }
      try { p.dataset.display(); } catch (error) { return { status: "indeterminate", message: "Rollback could not show the dataset to prove it." }; }
      current = dvSnapshot(p.document, true, p.laterBudget);
      proven = deValuesDigest(current) === ev.previousDigest;
    }
    name = p.snapshot.displayed !== undefined && p.snapshot.displayed.status === "readable" ? p.snapshot.displayed.name : null;
    if (name !== null) {
      shownNow = dvDisplayed(p.document);
      if (!(shownNow.status === "readable" && shownNow.name === name)) {
        other = udDatasetByName(p.document, name);
        if (other !== null) { try { other.display(); } catch (error) { return { status: "indeterminate", message: "Rollback could not show the earlier dataset again." }; } }
      }
    }
    restored = deRestoreItems(p.document, p.valueRows, p.digests.state, p.laterBudget);
    ev.restoredStateDigest = restored.digests.state;
    state.operationState.rollbackEvidence.restoredStateDigest = restored.digests.state;
    state.operationState.rollbackEvidence.datasetProven = proven;
    if (restored.digests.state !== p.digests.state) return { status: "failed", message: "Rollback did not restore the baseline state of the bound items." };
    if (!proven) return { status: "failed", message: "Rollback could not prove the dataset holds its previous values again." };
    return { status: "verified" };
  } catch (error) { return { status: "indeterminate", message: "Rollback could not prove the baseline state." }; }
}
var udExecution = runMutationTransaction({
  apply: params.apply === true,
  initialOperationState: function () { return { mutationStarted: false, updateCalled: false, rollbackEvidence: { restoredStateDigest: null, datasetProven: null } }; },
  preflight: udResolve, plan: udPlan, revalidate: udRevalidate, applyMutation: udApply, verify: udVerify, rollback: udRollback,
  hasMutationEvidence: function (s) { return s.operationState.mutationStarted === true; },
  applyIndeterminate: function () { return { reasonCode: "artboard_state_unknown", message: "Dataset update outcome is indeterminate.", evidence: { restoredStateDigest: null, datasetProven: null } }; },
  rollbackEvidence: function (s) { return s.operationState.rollbackEvidence; }
});
var udDocument = udExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === udExecution.preflight.document) udDocument = getDocumentContext();
var result = { operation: "update_dataset", applied: udExecution.transaction.state === "verified", document: udDocument, plan: udExecution.plan, transaction: udExecution.transaction };
if (result.applied) result.postcondition = udExecution.value;
if (dvScanMs.length > 0) result.scanMs = dvScanMs;
`;
export const UPDATE_DATASET_HOST_SCRIPT_DIGEST = canonicalSha256(UPDATE_DATASET_SCRIPT);
export const UPDATE_DATASET_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: UPDATE_DATASET_OPERATION, validator: UPDATE_DATASET_VALIDATOR,
    canonicalContractVersion: 1, resultSchemaVersion: 1, terminalClassifierVersion: 1, safetyConformanceVersion: 1, errorMappingVersion: 1,
    safetyIdentity: UPDATE_DATASET_SAFETY_IDENTITY, hostScriptDigest: UPDATE_DATASET_HOST_SCRIPT_DIGEST, mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalSchema.parse(input);
    const { commandId: _commandId, ...bound } = request;
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: request.apply ? request.commandId : null, documentKey: request.expectedDocumentKey,
        digest: canonicalSha256({ operation: UPDATE_DATASET_OPERATION, validator: UPDATE_DATASET_VALIDATOR, request: bound }) };
}
export const updateDatasetToolContract = {
    name: 'illustrator_update_dataset', title: 'Plan or Overwrite an Existing Dataset with the Current Values',
    description: 'Overwrite one existing dataset of the active document (Dataset.update()) with the values the bound items show now (text, visibility, linked image). What it held before is read first (by showing it) and returned as `previous`: a preview only (up to 40 characters of text, the linked file name, visibility), not a backup. Plan reads the bound items (from illustrator_list_variables) and what lies outside every binding and returns beforeDigest; apply compares it, shows the dataset to read its old values, puts the current values back, updates, shows it again to prove it holds them, shows the dataset that was displayed before and leaves the bound items as they were; any mismatch writes the old values back and updates again. A bound image gets a new UUID (reported). Refused: graph variables, a variable with no bound item, text of several runs. Illustrator frontmost.',
    inputSchema, publicInputSchema: updateDatasetPublicInputSchema, outputSchema: responseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(UPDATE_DATASET_SAFETY.policy), normalizePublicInput,
};
export function createUpdateDatasetAdapter() {
    return {
        version: 1, operation: UPDATE_DATASET_OPERATION, validator: UPDATE_DATASET_VALIDATOR,
        safety: UPDATE_DATASET_SAFETY, safetyRegistrationIdentity: UPDATE_DATASET_SAFETY_IDENTITY, adapterIdentity: UPDATE_DATASET_ADAPTER_IDENTITY,
        tool: updateDatasetToolContract, canonical: { version: 1, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: updateDatasetResultSchema, resultSchemaVersion: 1, terminalClassifierVersion: 1, safetyConformanceVersion: 1, errorMappingVersion: 1,
        hostScriptDigest: UPDATE_DATASET_HOST_SCRIPT_DIGEST, mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const n = normalizedRequest(input), { commandId: _commandId, ...params } = n.request;
            if (n.intent === 'plan')
                return { kind: 'read', script: UPDATE_DATASET_SCRIPT, params, timeoutMs: DATASET_HOST_TIMEOUT_MS };
            return { kind: 'mutation', mutationValidator: UPDATE_DATASET_VALIDATOR, idempotency: { commandId: n.commandId, operation: UPDATE_DATASET_OPERATION, documentKey: n.documentKey, requestDigest: n.digest },
                adapterIdentity: UPDATE_DATASET_ADAPTER_IDENTITY, mutationHostApplicationMode: 'foreground', script: UPDATE_DATASET_SCRIPT, params, timeoutMs: DATASET_HOST_TIMEOUT_MS };
        },
        classifyTerminal(value) { return classifyArtboardTerminal(updateDatasetResultSchema.parse(value).transaction.state, 'Dataset update'); },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error) { return error instanceof Error ? error : new Error(String(error)); },
    };
}
