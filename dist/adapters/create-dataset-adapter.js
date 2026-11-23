import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { DATASET_EDIT_HELPERS, DATASET_EDIT_MAX_LISTED } from '../dataset-edit-host-script.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema } from '../mutation-result-schema-core.js';
import { canonicalDigest, operationSafetyPolicyToMcpAnnotations } from '../operation-safety-policy-core.js';
import { OBJECT_WALK_HELPERS, OBJECT_WITNESS_HELPERS, READ_PAGE_ITEM_AT_HELPER } from '../page-item-walk.js';
import { DATASET_HOST_HELPERS, DATASET_HOST_TIMEOUT_MS, DATASET_MAX_BOUND, DATASET_MAX_TEXT, DATASET_MAX_DATASETS, DATASET_MAX_VARIABLES, DATASET_PREFLIGHT_MAX_MS } from '../variables-host-script.js';
import { applyDatasetBeforeSchema } from './apply-dataset-adapter.js';
import { artboardSafetyAsserter, artboardSafetyRegistration, artboardTransactionSchema, classifyArtboardTerminal } from './artboard-update-safety.js';
import { SNAPSHOT_RESULT_ADMISSION_BYTES } from './snapshot-result-size.js';
export const CREATE_DATASET_OPERATION = 'create_dataset';
export const CREATE_DATASET_VALIDATOR = { kind: CREATE_DATASET_OPERATION, version: 1 };
const keySchema = z.string().min(1).max(16_384);
const hex24 = z.string().regex(/^[0-9a-f]{24}$/u);
const nameSchema = z.string().min(1).max(1024).regex(/^[^\uD800-\uDFFF]+$/, 'The name must not contain characters outside the Basic Multilingual Plane (surrogate pairs).');
const rankSchema = z.number().int().nonnegative().max(DATASET_MAX_BOUND);
const selectionSchema = z.strictObject({ count: z.number().int().min(-1), items: z.array(z.strictObject({ type: z.string().max(64), name: z.string().max(1024) })).max(20) });
const displayedSchema = z.discriminatedUnion('status', [z.strictObject({ status: z.literal('readable'), name: z.string().max(1024) }), z.strictObject({ status: z.literal('none') }), z.strictObject({ status: z.literal('unavailable') })]);
const common = { expectedDocumentKey: keySchema, name: nameSchema };
const internalSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...common, apply: z.literal(false) }),
    z.strictObject({ ...common, apply: z.literal(true), expectedDigest: hex24, commandId: canonicalCommandIdSchema }),
]);
const publicCommon = { expected_document_key: keySchema, name: nameSchema.describe('Name of the new dataset; it must not be used by another dataset (names are unique in a document).') };
export const createDatasetPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...publicCommon, apply: z.literal(false).default(false) }),
    z.strictObject({ ...publicCommon, apply: z.literal(true), expected_digest: hex24.describe("Copy of the plan's beforeDigest (use the plan's next_call)."), command_id: applyCommandIdSchema }),
]);
const inputSchema = z.strictObject({ ...publicCommon, apply: z.boolean().default(false), expected_digest: hex24.optional(), command_id: applyCommandIdSchema.optional() });
const { $schema: _schemaDialect, ...publishedSchema } = z.toJSONSchema(createDatasetPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedSchema });
function normalizePublicInput(input) {
    const v = createDatasetPublicInputSchema.parse(input);
    const base = { expectedDocumentKey: v.expected_document_key, name: v.name };
    return v.apply ? { ...base, apply: true, expectedDigest: v.expected_digest, commandId: v.command_id } : { ...base, apply: false };
}
export const CREATE_DATASET_BLOCKERS = ['document_mutation_not_allowed', 'dataset_name_taken', 'nothing_to_capture', 'graph_variable_bound', 'unsupported_variable_kind',
    'variable_without_bound_item', 'bound_values_disagree', 'bindings_incomplete', 'text_too_long_to_verify', 'scan_limit_exceeded'];
const blockerSchema = z.enum(CREATE_DATASET_BLOCKERS);
const BINDING_REASONS = ['binding_unconfirmed', 'unsupported_bound_type', 'multi_run_text', 'multi_paragraph_text', 'text_attribute_unreadable', 'text_too_long'];
const ADMITTED_PROFILES = ['saved_file', 'unsaved_document', 'dirty_file'];
function same(a, b) { return canonicalSha256(a) === canonicalSha256(b); }
export function createDatasetExpectedBlockers(p) {
    const out = [];
    const reasons = new Set(p.blockedBindings.flatMap((row) => row.reasons));
    if (!p.documentBefore.mutationAllowed || !ADMITTED_PROFILES.includes(p.documentBefore.mutationProfile ?? ''))
        out.push('document_mutation_not_allowed');
    if (p.before.datasets.includes(p.name))
        out.push('dataset_name_taken');
    if (p.before.bound.length === 0)
        out.push('nothing_to_capture');
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
    if (reasons.has('text_too_long') || p.readMs > DATASET_PREFLIGHT_MAX_MS)
        out.push('text_too_long_to_verify');
    if (!p.scanComplete)
        out.push('scan_limit_exceeded');
    return out;
}
const planSchema = z.strictObject({
    operation: z.literal(CREATE_DATASET_OPERATION), profile: z.literal('dataset_create_v1'), documentKey: keySchema, documentBefore: documentContextSchema,
    disagreeingVariables: z.array(z.string().max(1024)).max(DATASET_MAX_VARIABLES).describe('Variables whose bound items show different values (a dataset keeps one value per variable): refused until they agree.'),
    name: nameSchema, newIndex: z.number().int().nonnegative().max(DATASET_MAX_DATASETS), before: applyDatasetBeforeSchema, beforeDigest: hex24, stateDigest: hex24, scanComplete: z.boolean(),
    readMs: z.number().int().nonnegative().max(600_000).describe('Milliseconds the first read of the bound items and of the rest took; more than the budget refuses (text_too_long_to_verify).'),
    blockedBindings: z.array(z.strictObject({ variable: z.number().int().nonnegative(), rank: rankSchema, type: z.string().max(64), name: z.string().max(1024), reasons: z.array(z.enum(BINDING_REASONS)).min(1).max(4) })).max(DATASET_EDIT_MAX_LISTED),
    captures: z.literal('current_values_of_bound_items').describe('The new dataset takes the values the bound items show now (a hand edit included), not the displayed dataset\'s values; it becomes the displayed dataset.'),
    changesState: z.literal(true), applyBlockedReasonCodes: z.array(blockerSchema), applyBlockedMessage: z.string().min(1).max(500).optional(),
    confirmationStatus: z.enum(['required', 'confirmed']), applyAllowed: z.boolean(),
}).superRefine((p, ctx) => {
    if (p.documentKey !== p.documentBefore.key)
        ctx.addIssue({ code: 'custom', message: 'Plan must bind the native document context.' });
    if (p.newIndex !== p.before.datasets.length)
        ctx.addIssue({ code: 'custom', message: 'The new dataset takes the next index.' });
    if (!same(createDatasetExpectedBlockers(p), p.applyBlockedReasonCodes))
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
    dataset: z.strictObject({ index: z.number().int().nonnegative(), name: nameSchema }),
    captured: z.array(valueRowSchema).max(DATASET_MAX_BOUND).describe('The values the new dataset was asked to take: those the bound items showed (the add does not let them be read back without a display).'),
    displayed: z.strictObject({ before: displayedSchema, after: displayedSchema }).describe('Document.activeDataSet reports the new dataset by its default name until it is displayed once, so after may read unavailable.'),
    uuidChanges: z.literal(0),
    selection: z.strictObject({ before: selectionSchema, after: selectionSchema, changed: z.boolean() }),
    saved: z.strictObject({ before: z.boolean(), after: z.boolean() }),
    unbound: z.strictObject({ count: z.number().int().nonnegative(), witness: hex24 }),
    items: z.number().int().nonnegative(),
});
const transactionSchema = artboardTransactionSchema(CREATE_DATASET_OPERATION, { restoredStateDigest: hex24.nullable() }, { restoredStateDigest: null }, (v) => v.restoredStateDigest !== null);
const scanMsSchema = z.array(z.number().int().nonnegative()).max(16).optional();
export const createDatasetResultSchema = z.union([
    z.strictObject({ scanMs: scanMsSchema, operation: z.literal(CREATE_DATASET_OPERATION), applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ scanMs: scanMsSchema, operation: z.literal(CREATE_DATASET_OPERATION), applied: z.literal(true), document: documentContextSchema, plan: planSchema, postcondition: postconditionSchema, transaction: transactionSchema }),
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
        if (p.dataset.index !== r.plan.newIndex || p.dataset.name !== r.plan.name)
            ctx.addIssue({ code: 'custom', message: 'The result must name the planned dataset at the planned index.' });
        if (p.captured.length !== bound.length || p.captured.some((row, i) => row.variable !== bound[i].variable || row.rank !== bound[i].rank))
            ctx.addIssue({ code: 'custom', message: 'Every planned bound item needs one captured value.' });
        if (p.unbound.count !== r.plan.before.unbound.count || p.unbound.witness !== r.plan.before.unbound.witness || p.items !== r.plan.before.structure.items)
            ctx.addIssue({ code: 'custom', message: 'The items outside every binding must be unchanged.' });
    }
    if (r.transaction.state === 'rolled_back' && r.transaction.rollback.restoredStateDigest !== r.plan.stateDigest)
        ctx.addIssue({ code: 'custom', message: 'Recovery must prove the baseline state digest.' });
});
const responseSchema = z.strictObject({ outcome: createDatasetResultSchema, delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }) });
export const CREATE_DATASET_SAFETY = artboardSafetyRegistration(CREATE_DATASET_OPERATION);
export const CREATE_DATASET_SAFETY_IDENTITY = canonicalDigest(CREATE_DATASET_SAFETY);
const assertSafety = artboardSafetyAsserter(CREATE_DATASET_SAFETY, (value) => {
    const r = createDatasetResultSchema.parse(value);
    return { operationId: CREATE_DATASET_OPERATION, documentKey: r.plan.documentKey,
        identityToken: `artboard-update-v1:${canonicalDigest({ operation: CREATE_DATASET_OPERATION, name: r.plan.name, beforeDigest: r.plan.beforeDigest })}`,
        beforeState: { path: r.plan.documentBefore.path, fileRevision: r.plan.documentBefore.fileRevision, snapshot: r.plan.before, beforeDigest: r.plan.beforeDigest, stateDigest: r.plan.stateDigest },
        afterState: { name: r.plan.name, newIndex: r.plan.newIndex, captures: r.plan.captures },
        changeSet: { name: r.plan.name, captures: r.plan.captures, profile: r.plan.profile },
        blocked: r.plan.applyBlockedReasonCodes.length > 0, confirmationStatus: r.plan.confirmationStatus, applyAllowed: r.plan.applyAllowed,
        transactionState: r.transaction.state, applied: r.applied };
});
export const CREATE_DATASET_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}${READ_PAGE_ITEM_AT_HELPER}${OBJECT_WITNESS_HELPERS}${OBJECT_WALK_HELPERS}${DATASET_HOST_HELPERS}${DATASET_EDIT_HELPERS}
var CD_ADMITTED = ${JSON.stringify(ADMITTED_PROFILES)}, CD_BLOCKERS = ${JSON.stringify(CREATE_DATASET_BLOCKERS)};
function cdByName(doc, name) {
  var i;
  for (i = 0; i < doc.dataSets.length; i++) if (String(doc.dataSets[i].name) === name) return doc.dataSets[i];
  return null;
}
function cdTaken(snapshot, name) { var i; for (i = 0; i < snapshot.datasets.length; i++) if (snapshot.datasets[i] === name) return true; return false; }
function cdResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var doc = app.activeDocument, found = [], blocked = [], messages = [], readStarted, readMs;
  readStarted = new Date().getTime();
  var snapshot = dvSnapshot(doc, true, DE_SNAPSHOT_BUDGET), rows = deBoundRows(snapshot), structure = dvStructure(doc), selection = dvSelection(doc);
  var witness = snapshot.scanComplete ? dvWitness(doc, snapshot) : { count: 0, witness: DE_ZERO };
  readMs = new Date().getTime() - readStarted;
  var before = deBefore(snapshot, structure, witness, selection), digests = deDigests(snapshot, structure, witness);
  if (!deAdmitted(context, CD_ADMITTED)) found.push("document_mutation_not_allowed");
  if (cdTaken(snapshot, params.name)) { found.push("dataset_name_taken"); messages.push("a dataset named " + params.name + " exists; names are unique in a document"); }
  if (rows.length === 0) { found.push("nothing_to_capture"); messages.push("no item is bound to a variable, so a new dataset would capture nothing"); }
  var disagree = deClassify(snapshot, rows, found, messages, blocked, false);
  if (readMs > DE_PREFLIGHT_MAX) { found.push("text_too_long_to_verify"); messages.push("reading the bound items took " + readMs + " ms; more than " + DE_PREFLIGHT_MAX + " ms is refused; split the work"); }
  var blockers = deOrder(found, CD_BLOCKERS), message = deMessage(blockers, messages);
  if (stringifyJson(before).length * 3 > ${SNAPSHOT_RESULT_ADMISSION_BYTES}) deFail("The plan would exceed the result size limit (result_too_large); fewer items must be bound.");
  if (forApply) {
    if (params.expectedDigest !== digests.identity) deFail("expected_digest does not match the current bound state; plan again.");
    if (blockers.length > 0) deFail(message);
  }
  return { context: context, document: doc, snapshot: snapshot, structure: structure, selection: selection, witness: witness, before: before, digests: digests,
    blockers: blockers, message: message, blocked: blocked, saved: doc.saved === true, readMs: readMs, valueRows: deValueRows(snapshot), disagree: disagree };
}
function cdPlan(p) {
  var plan = { operation: "create_dataset", profile: "dataset_create_v1", documentKey: p.context.key, documentBefore: p.context, disagreeingVariables: p.disagree, name: params.name, newIndex: p.snapshot.datasets.length,
    before: p.before, beforeDigest: p.digests.identity, stateDigest: p.digests.state, scanComplete: p.snapshot.scanComplete, readMs: p.readMs, blockedBindings: p.blocked,
    captures: "current_values_of_bound_items", changesState: true, applyBlockedReasonCodes: p.blockers };
  if (p.message !== null) plan.applyBlockedMessage = p.message;
  plan.confirmationStatus = params.apply === true ? "confirmed" : "required";
  plan.applyAllowed = params.apply === true && p.blockers.length === 0;
  return plan;
}
function cdRevalidate(p) { deRevalidate(p, null); }
function cdApply(p, plan, state) {
  var ev = state.operationState, added;
  ev.mutationStarted = true;
  try { added = p.document.dataSets.add(); } catch (error) { mutationNativeFailure("Datasets.add", error); }
  ev.added = true;
  try { added.name = params.name; } catch (nameError) { mutationNativeFailure("Dataset.name", nameError); }
  ev.named = true;
}
function cdVerify(p, plan, state) {
  var read = deRead(p), after = read.snapshot, i, witness, digests, expected, expectedSnapshot, selection, rowsBefore, rowsAfter, last;
  if (!deSame(read.structure, p.structure)) throw mutationError("verify_mismatch", "The document structure changed.");
  if (!after.scanComplete || after.locked !== p.snapshot.locked || after.variables.length !== p.snapshot.variables.length) throw mutationError("verify_mismatch", "The variable list changed.");
  if (after.datasets.length !== p.snapshot.datasets.length + 1 || after.datasets[after.datasets.length - 1] !== params.name) throw mutationError("verify_mismatch", "The dataset list is not the old list with " + params.name + " added.");
  for (i = 0; i < p.snapshot.datasets.length; i++) if (after.datasets[i] !== p.snapshot.datasets[i]) throw mutationError("verify_mismatch", "An existing dataset changed.");
  witness = dvWitness(p.document, after); digests = deDigests(after, read.structure, witness);
  expectedSnapshot = { locked: p.snapshot.locked, variables: p.snapshot.variables, datasets: p.snapshot.datasets.concat([params.name]), displayed: p.snapshot.displayed };
  expected = deDigests(expectedSnapshot, p.structure, p.witness);
  if (digests.state !== expected.state) throw mutationError("verify_mismatch", "The bound items or the document changed besides the new dataset.");
  rowsBefore = deBoundRows(p.snapshot); rowsAfter = deBoundRows(after);
  for (i = 0; i < rowsBefore.length; i++) if (rowsBefore[i].uuid !== rowsAfter[i].uuid) throw mutationError("verify_mismatch", "The uuid of a bound item changed.");
  selection = dvSelection(p.document);
  return { dataset: { index: after.datasets.length - 1, name: params.name }, captured: deValuesJson(p.valueRows), displayed: { before: deDisplayedJson(p.snapshot), after: deDisplayedJson(after) }, uuidChanges: 0,
    selection: { before: p.selection, after: selection, changed: !deSame(p.selection, selection) }, saved: { before: p.saved, after: p.document.saved === true },
    unbound: { count: witness.count, witness: witness.witness }, items: read.structure.items };
}
// The rollback: take the added dataset out again (by its name once it is named, else the one beyond the old list) and prove the baseline state digest.
function cdRollback(state) {
  var p = state.preflight, ev = state.operationState, target = null, after, witness, digests;
  try {
    if (!p || app.documents.length === 0 || app.activeDocument !== p.document) return { status: "indeterminate", message: "Rollback document is indeterminate." };
    if (ev.added === true && p.document.dataSets.length > p.snapshot.datasets.length) {
      if (ev.named === true) target = cdByName(p.document, params.name);
      if (target === null) target = p.document.dataSets[p.document.dataSets.length - 1];
      target.remove();
    }
    after = dvSnapshot(p.document, true, DE_LATER_BUDGET);
    if (!after.scanComplete) return { status: "indeterminate", message: "Rollback could not read the variables again." };
    witness = dvWitness(p.document, after); digests = deDigests(after, dvStructure(p.document), witness);
    state.operationState.rollbackEvidence.restoredStateDigest = digests.state;
    if (digests.state !== p.digests.state) return { status: "failed", message: "Rollback did not restore the baseline state." };
    return { status: "verified" };
  } catch (error) { return { status: "indeterminate", message: "Rollback could not prove the baseline state." }; }
}
var cdExecution = runMutationTransaction({
  apply: params.apply === true,
  initialOperationState: function () { return { mutationStarted: false, added: false, named: false, rollbackEvidence: { restoredStateDigest: null } }; },
  preflight: cdResolve, plan: cdPlan, revalidate: cdRevalidate, applyMutation: cdApply, verify: cdVerify, rollback: cdRollback,
  hasMutationEvidence: function (s) { return s.operationState.mutationStarted === true; },
  applyIndeterminate: function () { return { reasonCode: "artboard_state_unknown", message: "Dataset creation outcome is indeterminate.", evidence: { restoredStateDigest: null } }; },
  rollbackEvidence: function (s) { return s.operationState.rollbackEvidence; }
});
var cdDocument = cdExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === cdExecution.preflight.document) cdDocument = getDocumentContext();
var result = { operation: "create_dataset", applied: cdExecution.transaction.state === "verified", document: cdDocument, plan: cdExecution.plan, transaction: cdExecution.transaction };
if (result.applied) result.postcondition = cdExecution.value;
if (dvScanMs.length > 0) result.scanMs = dvScanMs;
`;
export const CREATE_DATASET_HOST_SCRIPT_DIGEST = canonicalSha256(CREATE_DATASET_SCRIPT);
export const CREATE_DATASET_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: CREATE_DATASET_OPERATION, validator: CREATE_DATASET_VALIDATOR,
    canonicalContractVersion: 1, resultSchemaVersion: 1, terminalClassifierVersion: 1, safetyConformanceVersion: 1, errorMappingVersion: 1,
    safetyIdentity: CREATE_DATASET_SAFETY_IDENTITY, hostScriptDigest: CREATE_DATASET_HOST_SCRIPT_DIGEST, mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalSchema.parse(input);
    const { commandId: _commandId, ...bound } = request;
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: request.apply ? request.commandId : null, documentKey: request.expectedDocumentKey,
        digest: canonicalSha256({ operation: CREATE_DATASET_OPERATION, validator: CREATE_DATASET_VALIDATOR, request: bound }) };
}
export const createDatasetToolContract = {
    name: 'illustrator_create_dataset', title: 'Plan or Add a Dataset that Captures the Current Values',
    description: 'Add a dataset to the active document that captures the values the bound items show now (text, visibility, linked image), a hand edit included, and name it. Plan reads the bound items (from illustrator_list_variables) and what lies outside every binding and returns beforeDigest; apply compares it, adds and names the dataset, reads everything back and removes the dataset again if anything besides the new dataset changed. The new dataset becomes the displayed one (reported). Refused: a name that is taken, graph variables, a variable with no bound item, nothing bound. Illustrator frontmost.',
    inputSchema, publicInputSchema: createDatasetPublicInputSchema, outputSchema: responseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(CREATE_DATASET_SAFETY.policy), normalizePublicInput,
};
export function createCreateDatasetAdapter() {
    return {
        version: 1, operation: CREATE_DATASET_OPERATION, validator: CREATE_DATASET_VALIDATOR,
        safety: CREATE_DATASET_SAFETY, safetyRegistrationIdentity: CREATE_DATASET_SAFETY_IDENTITY, adapterIdentity: CREATE_DATASET_ADAPTER_IDENTITY,
        tool: createDatasetToolContract, canonical: { version: 1, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: createDatasetResultSchema, resultSchemaVersion: 1, terminalClassifierVersion: 1, safetyConformanceVersion: 1, errorMappingVersion: 1,
        hostScriptDigest: CREATE_DATASET_HOST_SCRIPT_DIGEST, mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const n = normalizedRequest(input), { commandId: _commandId, ...params } = n.request;
            if (n.intent === 'plan')
                return { kind: 'read', script: CREATE_DATASET_SCRIPT, params, timeoutMs: DATASET_HOST_TIMEOUT_MS };
            return { kind: 'mutation', mutationValidator: CREATE_DATASET_VALIDATOR, idempotency: { commandId: n.commandId, operation: CREATE_DATASET_OPERATION, documentKey: n.documentKey, requestDigest: n.digest },
                adapterIdentity: CREATE_DATASET_ADAPTER_IDENTITY, mutationHostApplicationMode: 'foreground', script: CREATE_DATASET_SCRIPT, params, timeoutMs: DATASET_HOST_TIMEOUT_MS };
        },
        classifyTerminal(value) { return classifyArtboardTerminal(createDatasetResultSchema.parse(value).transaction.state, 'Dataset creation'); },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error) { return error instanceof Error ? error : new Error(String(error)); },
    };
}
