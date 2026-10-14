import { assertSnapshotResultFits, snapshotResultBytes, SNAPSHOT_RESULT_ADMISSION_BYTES, SNAPSHOT_RESULT_SIZE_SCRIPT } from './snapshot-result-size.js';
import { z } from 'zod';
import { composedAreaLayoutSchema, COMPOSED_AREA_LAYOUT_SCRIPT } from './area-text-layout.js';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema } from '../mutation-result-schema-core.js';
import { canonicalDigest, operationSafetyPolicyToMcpAnnotations } from '../operation-safety-policy-core.js';
import { AREA_TEXT_SNAPSHOT_SCRIPT } from './area-text-host-script.js';
import { validateClusterRange } from './point-text-cluster.js';
import { POINT_TEXT_BLOCKERS_SCRIPT, POINT_TEXT_JUSTIFICATIONS, POINT_TEXT_SNAPSHOT_SCRIPT, pointTextApplyBlockers, } from './point-text-host-script.js';
import { classifyTextLayoutTerminal, mapTextLayoutError, sameCanonical, TEXT_LAYOUT_SNAPSHOT_SCRIPT, textLayoutBlockerSchema, textLayoutSafetyAsserter, textLayoutSafetyRegistration, textLayoutSnapshotSchemasFor, textLayoutTransactionSchema, } from './text-layout-shared.js';
import { decodeTextLayoutRuns, encodeTextLayoutRuns, TEXT_LAYOUT_RUNS_SCRIPT, textLayoutRunSchema, textLayoutRunSchemasFor, } from './text-layout-runs.js';
const noBreakBlockerSchema = z.enum([...textLayoutBlockerSchema.options, 'result_too_large']);
export const SET_NO_BREAK_OPERATION = 'set_no_break';
export const SET_NO_BREAK_VALIDATOR = { kind: SET_NO_BREAK_OPERATION, version: 1 };
const CANONICAL_VERSION = 1;
const RESULT_SCHEMA_VERSION = 4;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 2;
export const NO_BREAK_JUSTIFICATIONS = [...POINT_TEXT_JUSTIFICATIONS, 'Justification.FULLJUSTIFYLASTLINELEFT'];
export const NO_BREAK_AREA_JUSTIFICATIONS = ['Justification.LEFT', 'Justification.FULLJUSTIFYLASTLINELEFT'];
const noBreakSnapshotSchemas = textLayoutSnapshotSchemasFor(NO_BREAK_JUSTIFICATIONS);
const fullSnapshotSchema = noBreakSnapshotSchemas.snapshot;
export const noBreakRunSchema = textLayoutRunSchema;
const noBreakWireSchemas = textLayoutRunSchemasFor(NO_BREAK_JUSTIFICATIONS, 'no-break');
const noBreakWireSnapshotSchema = noBreakWireSchemas.snapshot;
export function decodeNoBreakSnapshot(wire) {
    return decodeTextLayoutRuns(wire);
}
export function encodeNoBreakSnapshot(snapshot) {
    return encodeTextLayoutRuns(snapshot);
}
const textLayoutSnapshotSchema = noBreakWireSnapshotSchema;
const textLayoutSnapshotInputSchema = noBreakWireSchemas.input;
export const noBreakAreaLayoutSchema = composedAreaLayoutSchema;
export const setNoBreakPlanSchema = z.strictObject({
    operation: z.literal(SET_NO_BREAK_OPERATION),
    documentKey: z.string().min(1).max(16_384),
    targetUuid: z.string().min(1).max(255),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    noBreak: z.boolean(),
    before: textLayoutSnapshotSchema,
    after: textLayoutSnapshotSchema,
    layoutBefore: noBreakAreaLayoutSchema.optional(),
    applyBlockedReasonCodes: z.array(noBreakBlockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    if (plan.targetUuid !== plan.before.uuid || plan.before.uuid !== plan.after.uuid) {
        context.addIssue({ code: 'custom', message: 'A no-break plan must bind one target UUID.' });
    }
    if (plan.before.orientation !== 'horizontal') {
        context.addIssue({ code: 'custom', message: 'A no-break plan supports horizontal text only.' });
    }
    if (plan.before.kind === 'TextType.AREATEXT') {
        if (plan.before.paragraphJustifications.length !== 1) {
            context.addIssue({ code: 'custom', message: 'A no-break plan on area text supports a single paragraph only.' });
        }
        else if (!NO_BREAK_AREA_JUSTIFICATIONS.includes(plan.before.paragraphJustifications[0])) {
            context.addIssue({ code: 'custom', message: 'A no-break plan on area text supports the measured paragraph alignments only.' });
        }
        if (plan.before.fit?.status !== 'fits') {
            context.addIssue({ code: 'custom', message: 'A no-break plan on area text requires the whole text to be visible in the frame.' });
        }
        if (plan.layoutBefore === undefined ||
            plan.layoutBefore.fit.visibleCharacterCount !== plan.before.fit?.visibleCharacterCount) {
            context.addIssue({ code: 'custom', message: 'A no-break plan on area text must carry the line layout of its before state.' });
        }
    }
    else {
        if (plan.layoutBefore !== undefined) {
            context.addIssue({ code: 'custom', message: 'A no-break plan on point text carries no line layout.' });
        }
        if (plan.before.paragraphJustifications.some((value) => !POINT_TEXT_JUSTIFICATIONS.includes(value))) {
            context.addIssue({ code: 'custom', message: 'A no-break plan on point text supports left, centre and right alignment only.' });
        }
    }
    if (plan.start >= plan.end || plan.end > plan.before.contents.length) {
        context.addIssue({ code: 'custom', message: 'A no-break range must be a non-empty span inside the target.' });
    }
    if (!sameCanonical(predictNoBreakWireAfter(plan.before, plan.start, plan.end, plan.noBreak), plan.after)) {
        context.addIssue({ code: 'custom', message: 'A no-break plan may move only noBreak inside the range.' });
    }
    const oversized = snapshotResultBytes(plan.documentKey, [plan], plan.before.kind === 'TextType.AREATEXT' ? plan.before.contents.length : undefined) > SNAPSHOT_RESULT_ADMISSION_BYTES;
    if (oversized !== plan.applyBlockedReasonCodes.includes('result_too_large')) {
        context.addIssue({ code: 'custom', message: 'No-break plan must expose exact result size admission.' });
    }
    const allowed = plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0;
    if (plan.applyAllowed !== allowed) {
        context.addIssue({ code: 'custom', message: 'No-break applyAllowed must require confirmation and no blockers.' });
    }
});
export function predictNoBreakAfter(before, start, end, noBreak) {
    return {
        ...before,
        characters: before.characters.map((character, index) => (index >= start && index < end ? { ...character, noBreak } : character)),
    };
}
export function predictNoBreakWireAfter(before, start, end, noBreak) {
    return encodeNoBreakSnapshot(predictNoBreakAfter(decodeNoBreakSnapshot(before), start, end, noBreak));
}
const transactionSchema = textLayoutTransactionSchema('No-break', textLayoutSnapshotSchema);
export const setNoBreakResultSchema = z.union([
    z.strictObject({
        operation: z.literal(SET_NO_BREAK_OPERATION), applied: z.literal(false),
        document: documentContextSchema, plan: setNoBreakPlanSchema, transaction: transactionSchema,
    }),
    z.strictObject({
        operation: z.literal(SET_NO_BREAK_OPERATION), applied: z.literal(true),
        document: documentContextSchema, plan: setNoBreakPlanSchema,
        postcondition: textLayoutSnapshotSchema, transaction: transactionSchema,
        layout: z.strictObject({ before: noBreakAreaLayoutSchema, after: noBreakAreaLayoutSchema }).optional(),
    }),
]).superRefine((result, context) => {
    if (result.transaction.state === 'planned') {
        const blockers = pointTextApplyBlockers(result.document.mutationAllowed, result.plan.before);
        if (snapshotResultBytes(result.plan.documentKey, [result.plan], result.plan.before.kind === 'TextType.AREATEXT' ? result.plan.before.contents.length : undefined) > SNAPSHOT_RESULT_ADMISSION_BYTES)
            blockers.push('result_too_large');
        if (result.plan.confirmationStatus !== 'required' || !sameCanonical(result.plan.applyBlockedReasonCodes, blockers)) {
            context.addIssue({ code: 'custom', message: 'A planned no-break change must expose exact blockers.' });
        }
    }
    else if (result.plan.confirmationStatus !== 'confirmed' || result.plan.applyBlockedReasonCodes.length !== 0 ||
        !result.plan.applyAllowed) {
        context.addIssue({ code: 'custom', message: 'An applied no-break change must derive from an allowed confirmed plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified' || !sameCanonical(result.postcondition, result.plan.after)) {
            context.addIssue({ code: 'custom', message: 'A verified no-break change must match the exact after snapshot.' });
        }
        const area = result.plan.before.kind === 'TextType.AREATEXT';
        if (area !== (result.layout !== undefined) ||
            (result.layout !== undefined && !sameCanonical(result.layout.before, result.plan.layoutBefore))) {
            context.addIssue({ code: 'custom', message: 'A verified area-text no-break change must report the observed line layout before and after.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified no-break transaction must be applied.' });
    }
    if (result.transaction.state === 'rolled_back' &&
        !sameCanonical(result.transaction.rollback.restoredSnapshot, result.plan.before)) {
        context.addIssue({ code: 'custom', message: 'A rolled-back no-break change must prove exact before restoration.' });
    }
});
export const setNoBreakResponseSchema = z.strictObject({
    outcome: setNoBreakResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
const commonInternal = {
    expectedDocumentKey: z.string().min(1).max(16_384),
    targetUuid: z.string().min(1).max(255),
    start: z.number().int().safe().nonnegative(),
    end: z.number().int().safe().nonnegative(),
    noBreak: z.boolean(),
};
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({
        ...commonInternal,
        expectedBefore: textLayoutSnapshotInputSchema,
        confirmedAfter: textLayoutSnapshotInputSchema,
        apply: z.literal(true),
        commandId: canonicalCommandIdSchema,
    }),
]);
const commonPublic = {
    expected_document_key: z.string().min(1).max(16_384),
    target_uuid: z.string().min(1).max(255),
    start: z.number().int().safe().nonnegative(),
    end: z.number().int().safe().nonnegative(),
    no_break: z.boolean(),
};
export const setNoBreakPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({
        ...commonPublic,
        expected_before: textLayoutSnapshotInputSchema,
        confirmed_after: textLayoutSnapshotInputSchema,
        apply: z.literal(true),
        command_id: applyCommandIdSchema,
    }),
]);
const inputSchema = z.strictObject({
    ...commonPublic,
    expected_before: textLayoutSnapshotInputSchema.optional(),
    confirmed_after: textLayoutSnapshotInputSchema.optional(),
    apply: z.boolean().default(false),
    command_id: applyCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(setNoBreakPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = setNoBreakPublicInputSchema.parse(input);
    const common = {
        expectedDocumentKey: value.expected_document_key,
        targetUuid: value.target_uuid,
        start: value.start,
        end: value.end,
        noBreak: value.no_break,
    };
    return value.apply
        ? { ...common, expectedBefore: value.expected_before, confirmedAfter: value.confirmed_after,
            apply: true, commandId: value.command_id }
        : { ...common, apply: false };
}
export const SET_NO_BREAK_SAFETY = textLayoutSafetyRegistration(SET_NO_BREAK_OPERATION);
export const SET_NO_BREAK_SAFETY_IDENTITY = canonicalDigest(SET_NO_BREAK_SAFETY);
export const SET_NO_BREAK_MODULE_SCRIPT = `
var NO_BREAK_JUSTIFICATIONS = ${JSON.stringify(NO_BREAK_JUSTIFICATIONS)};
var NO_BREAK_AREA_JUSTIFICATIONS = ${JSON.stringify(NO_BREAK_AREA_JUSTIFICATIONS)};

function noBreakPredictAfter(before) {
  var after = textLayoutCopy(before);
  for (var index = params.start; index < params.end; index++) after.characters[index].noBreak = params.noBreak;
  return after;
}

/**
 * The composed lines of an area frame, read once, bounded: the raw \`lines[].contents\` and the fit proved by the
 * shared \`areaTextFit\`. Null when a line cannot be read, the count or the total is out of bounds, or the lines
 * do not add up to the visible characters the fit proof counted; the caller treats null as indeterminate.
 */

/** The supported profile: horizontal text; area text additionally one paragraph with the whole text visible. */
function noBreakAdmit(before) {
  if (before.orientation !== "horizontal") {
    throw mutationError("preflight_failed", "No-break changes support horizontal text only.");
  }
  if (before.kind !== "TextType.AREATEXT") {
    for (var pointIndex = 0; pointIndex < before.paragraphJustifications.length; pointIndex++) {
      var pointAligned = false;
      for (var allowedIndex = 0; allowedIndex < POINT_TEXT_JUSTIFICATIONS.length; allowedIndex++) {
        if (before.paragraphJustifications[pointIndex] === POINT_TEXT_JUSTIFICATIONS[allowedIndex]) pointAligned = true;
      }
      if (!pointAligned) {
        throw mutationError("preflight_failed", "No-break changes on point text support left, centre and right alignment only.");
      }
    }
  }
  if (before.kind === "TextType.AREATEXT") {
    if (before.paragraphJustifications.length !== 1) {
      throw mutationError("preflight_failed", "No-break changes on area text support a single paragraph only.");
    }
    var aligned = false;
    for (var index = 0; index < NO_BREAK_AREA_JUSTIFICATIONS.length; index++) {
      if (before.paragraphJustifications[0] === NO_BREAK_AREA_JUSTIFICATIONS[index]) aligned = true;
    }
    if (!aligned) {
      throw mutationError("preflight_failed", "No-break changes on area text support left and last-line-left justified paragraphs only.");
    }
    if (!before.fit || before.fit.status !== "fits") {
      throw mutationError("preflight_failed", "No-break changes on area text require the whole text to be visible in the frame.");
    }
  }
}

function noBreakPreflight(forApply) {
  var resolved = textLayoutResolve(forApply, NO_BREAK_JUSTIFICATIONS);
  noBreakAdmit(resolved.before);
  if (params.end > resolved.before.characters.length || params.start >= params.end) {
    throw mutationError("preflight_failed", "The requested no-break range is outside the target contents.");
  }
  resolved.layoutBefore = null;
  resolved.layoutAfter = null;
  if (resolved.before.kind === "TextType.AREATEXT") {
    resolved.layoutBefore = composedAreaLayout(resolved.target, resolved.before.contents);
    if (resolved.layoutBefore === null || resolved.layoutBefore.fit.status !== "fits") {
      throw mutationError("preflight_failed", "The area text line layout could not be read.");
    }
  }
  if (forApply) {
    if (!textLayoutSame(resolved.before, textLayoutRunsDecode(params.expectedBefore, "expected_before"))) {
      throw mutationError("preflight_failed", "Target state does not match expected_before.");
    }
    if (!textLayoutSame(noBreakPredictAfter(resolved.before), textLayoutRunsDecode(params.confirmedAfter, "confirmed_after"))) {
      throw mutationError("preflight_failed", "confirmed_after does not match the derived no-break state.");
    }
  }
  return resolved;
}

function noBreakPlan(preflight) {
  var plan = {
    operation: "set_no_break", documentKey: preflight.context.key, targetUuid: params.targetUuid,
    start: params.start, end: params.end, noBreak: params.noBreak,
    before: preflight.before,
    after: noBreakPredictAfter(preflight.before),
    applyBlockedReasonCodes: preflight.blockers,
    confirmationStatus: params.apply === true ? "confirmed" : "required",
    applyAllowed: params.apply === true && preflight.blockers.length === 0
  };
  if (preflight.layoutBefore !== null) plan.layoutBefore = preflight.layoutBefore;
  return snapshotResultAdmitPlan(plan, [{ targetUuid: plan.targetUuid, start: plan.start, end: plan.end, noBreak: plan.noBreak, before: textLayoutRunsEncode(plan.before), after: textLayoutRunsEncode(plan.after) }],
    preflight.layoutBefore !== null ? plan.before.contents.length : null);
}

function noBreakRevalidate(preflight, plan) {
  var current;
  try { current = textLayoutResolve(true, NO_BREAK_JUSTIFICATIONS); }
  catch (error) {
    throw mutationBeforeSideEffectError(mutationPublicMessage(error, "No-break preconditions changed before apply."));
  }
  if (current.document !== preflight.document || current.target !== preflight.target ||
      !textLayoutSame(current.before, plan.before)) {
    throw mutationBeforeSideEffectError("No-break target changed before apply.");
  }
  if (preflight.layoutBefore !== null &&
      !textLayoutSame(composedAreaLayout(current.target, current.before.contents), preflight.layoutBefore)) {
    throw mutationBeforeSideEffectError("No-break line layout changed before apply.");
  }
}

/** The measured profile write: each held character in the range, nothing outside it. */
function noBreakWrite(target, start, end, values) {
  for (var index = start; index < end; index++) {
    var character = target.characters[index];
    character.characterAttributes.noBreak = values(index);
  }
}

function noBreakApply(preflight, plan, state) {
  state.operationState.mutationStarted = true;
  noBreakWrite(preflight.target, params.start, params.end, function () { return params.noBreak; });
  return preflight.target;
}

function noBreakVerify(preflight, plan) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) {
    throw mutationError("verify_mismatch", "Active document changed during no-break verification.");
  }
  var target = pointTextFind(preflight.document, plan.before.uuid);
  if (target === null || target !== preflight.target) {
    throw mutationError("verify_mismatch", "Target native UUID no longer resolves to the same TextFrame.");
  }
  var actual = textLayoutSnapshot(preflight.document, target, params.targetUuid, NO_BREAK_JUSTIFICATIONS);
  if (!textLayoutSame(actual, plan.after)) {
    throw mutationError("verify_mismatch", "No-break postcondition does not match the plan.");
  }
  if (preflight.layoutBefore !== null) {
    var layoutAfter = composedAreaLayout(target, actual.contents);
    if (layoutAfter === null || layoutAfter.fit.status !== "fits") {
      throw mutationError("verify_mismatch", "No-break line layout is unreadable or no longer shows the whole text.");
    }
    preflight.layoutAfter = layoutAfter;
  }
  return actual;
}

function noBreakRollback(state) {
  var preflight = state.preflight;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) {
    return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
  }
  var target;
  var current;
  try {
    target = pointTextFind(preflight.document, params.targetUuid);
    if (target === null || target !== preflight.target) {
      return { status: "indeterminate", message: "Rollback target identity is indeterminate." };
    }
    current = textLayoutSnapshot(preflight.document, target, params.targetUuid, NO_BREAK_JUSTIFICATIONS);
  } catch (error) { return { status: "indeterminate", message: "Rollback target state is indeterminate." }; }
  if (textLayoutSame(current, preflight.before)) {
    state.operationState.rollbackEvidence.restoredSnapshot = textLayoutRunsEncode(current);
    return noBreakRollbackLayoutStatus(target, preflight);
  }
  // A no-break range write can overflow an area frame, so the fit proof is masked with the written field. The frame
  // matrix and bounds are not masked: any other change refuses the inverse.
  var mask = { orientation: false, fit: preflight.before.kind === "TextType.AREATEXT",
    start: params.start, end: params.end, characterFields: ["noBreak"] };
  if (!textLayoutSame(textLayoutMasked(current, mask), textLayoutMasked(preflight.before, mask))) {
    return { status: "indeterminate", message: "Rollback refused because the target changed outside the no-break range." };
  }
  try {
    noBreakWrite(target, params.start, params.end, function (index) { return preflight.before.characters[index].noBreak; });
  } catch (writeError) { return { status: "indeterminate", message: "Rollback no-break write is indeterminate." }; }
  var restored;
  try { restored = textLayoutSnapshot(preflight.document, target, params.targetUuid, NO_BREAK_JUSTIFICATIONS); }
  catch (verifyError) { return { status: "indeterminate", message: "Rollback verification is indeterminate." }; }
  state.operationState.rollbackEvidence.restoredSnapshot = textLayoutRunsEncode(restored);
  if (!textLayoutSame(restored, preflight.before)) {
    return { status: "failed", message: "Rollback did not restore the exact before no-break state." };
  }
  return noBreakRollbackLayoutStatus(target, preflight);
}

/** Area text only: the restored snapshot is not enough, the composed lines must be the ones read before the change. */
function noBreakRollbackLayoutStatus(target, preflight) {
  if (preflight.layoutBefore === null) return { status: "verified" };
  var layout = null;
  try { layout = composedAreaLayout(target, preflight.before.contents); } catch (layoutError) { layout = null; }
  if (layout === null || !textLayoutSame(layout, preflight.layoutBefore)) {
    return { status: "indeterminate", message: "Rollback restored the state but the line layout is not the one read before the change." };
  }
  return { status: "verified" };
}
`;
export const SET_NO_BREAK_RUNNER_SCRIPT = `var noBreakExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionAffected: function () { return [params.targetUuid]; },
  initialOperationState: function () {
    return { mutationStarted: false, rollbackEvidence: { targetUuid: params.targetUuid, restoredSnapshot: null } };
  },
  preflight: noBreakPreflight,
  plan: noBreakPlan,
  revalidate: noBreakRevalidate,
  applyMutation: noBreakApply,
  verify: noBreakVerify,
  rollback: noBreakRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () {
    return { reasonCode: "text_state_unknown", message: "No-break apply outcome is indeterminate.",
      evidence: { targetUuid: params.targetUuid, restoredSnapshot: null } };
  },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var noBreakDocument = noBreakExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === noBreakExecution.preflight.document) {
  noBreakDocument = getDocumentContext();
}
var noBreakWirePlan = {};
for (var noBreakPlanKey in noBreakExecution.plan) {
  if (noBreakExecution.plan.hasOwnProperty(noBreakPlanKey)) noBreakWirePlan[noBreakPlanKey] = noBreakExecution.plan[noBreakPlanKey];
}
noBreakWirePlan.before = textLayoutRunsEncode(noBreakExecution.plan.before);
noBreakWirePlan.after = textLayoutRunsEncode(noBreakExecution.plan.after);
var result = { operation: "set_no_break",
  applied: noBreakExecution.transaction.state === "verified",
  document: noBreakDocument, plan: noBreakWirePlan, transaction: noBreakExecution.transaction };
if (noBreakExecution.transaction.state === "verified") {
  result.postcondition = textLayoutRunsEncode(noBreakExecution.value);
  if (noBreakExecution.preflight.layoutBefore !== null) {
    result.layout = { before: noBreakExecution.preflight.layoutBefore, after: noBreakExecution.preflight.layoutAfter };
  }
}
`;
export const SET_NO_BREAK_SCRIPT = `${SNAPSHOT_RESULT_SIZE_SCRIPT}
${MUTATION_TRANSACTION_SCRIPT}
${COMPOSED_AREA_LAYOUT_SCRIPT}
${POINT_TEXT_SNAPSHOT_SCRIPT}
${POINT_TEXT_BLOCKERS_SCRIPT}
${AREA_TEXT_SNAPSHOT_SCRIPT}
${TEXT_LAYOUT_SNAPSHOT_SCRIPT}
${TEXT_LAYOUT_RUNS_SCRIPT}
${SET_NO_BREAK_MODULE_SCRIPT}${SET_NO_BREAK_RUNNER_SCRIPT}`;
export const SET_NO_BREAK_HOST_SCRIPT_DIGEST = canonicalSha256(SET_NO_BREAK_SCRIPT);
export const SET_NO_BREAK_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: SET_NO_BREAK_OPERATION,
    validator: SET_NO_BREAK_VALIDATOR, canonicalContractVersion: CANONICAL_VERSION,
    resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: SET_NO_BREAK_SAFETY_IDENTITY, hostScriptDigest: SET_NO_BREAK_HOST_SCRIPT_DIGEST,
    mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    if (request.apply) {
        assertSnapshotResultFits(request.expectedDocumentKey, [{ targetUuid: request.targetUuid, start: request.start, end: request.end, noBreak: request.noBreak, before: request.expectedBefore, after: request.confirmedAfter }], request.expectedBefore.kind === 'TextType.AREATEXT' ? request.expectedBefore.contents.length : undefined);
        const rejection = validateClusterRange(request.expectedBefore.contents, request.start, request.end);
        if (rejection !== null)
            throw new Error(`No-break request is unsupported: ${rejection.reason}.`);
    }
    const digestRequest = 'commandId' in request
        ? (({ commandId: _commandId, ...rest }) => rest)(request)
        : request;
    const digest = canonicalSha256({ operation: SET_NO_BREAK_OPERATION,
        validator: SET_NO_BREAK_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request,
        commandId: 'commandId' in request ? request.commandId : null,
        documentKey: request.expectedDocumentKey, digest };
}
export const setNoBreakToolContract = {
    name: 'illustrator_set_no_break',
    title: 'Plan or Set No Break (分割禁止) on a Text Range',
    description: 'Plan or apply the no-break (分割禁止) attribute to a bounded UTF-16 range of one layer-direct, '
        + 'unthreaded, horizontal text frame: a single-line POINTTEXT frame, or a one-paragraph AREATEXT frame whose '
        + 'whole text is visible. Bound by explicit document key and native UUID. Only `noBreak` inside the range '
        + 'moves; every character outside it stays unchanged. Ranges that would split a character are refused, as '
        + 'are vertical text, several paragraphs, a frame that already overflows, threaded frames and frames with '
        + 'manual pair kerning. For area text the plan and the verified result report the composed lines before and '
        + 'after (observed, not predicted); a change that makes the text overflow its frame fails verification and is '
        + 'rolled back. Apply performs exact compare-and-set over a per-character fingerprint, native read-back '
        + 'verification, and a per-character verified inverse. Estimated stored result must be <=209715 UTF-8 bytes; '
        + 'result_too_large requires a smaller frame or fewer distinct style runs (splitting only the range does not shrink the frame evidence).',
    inputSchema,
    publicInputSchema: setNoBreakPublicInputSchema,
    outputSchema: setNoBreakResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(SET_NO_BREAK_SAFETY.policy),
    normalizePublicInput,
};
function safetyView(value) {
    const result = setNoBreakResultSchema.parse(value);
    return {
        operationId: SET_NO_BREAK_OPERATION, documentKey: result.document.key, targetUuid: result.plan.targetUuid,
        before: decodeNoBreakSnapshot(result.plan.before), after: decodeNoBreakSnapshot(result.plan.after),
        changeSet: { start: result.plan.start, end: result.plan.end, noBreak: result.plan.noBreak },
        blocked: result.plan.applyBlockedReasonCodes.length > 0,
        confirmationStatus: result.plan.confirmationStatus, applyAllowed: result.plan.applyAllowed,
        transactionState: result.transaction.state, applied: result.applied,
    };
}
export function createSetNoBreakAdapter() {
    return {
        version: 1, operation: SET_NO_BREAK_OPERATION, validator: SET_NO_BREAK_VALIDATOR,
        safety: SET_NO_BREAK_SAFETY, safetyRegistrationIdentity: SET_NO_BREAK_SAFETY_IDENTITY,
        adapterIdentity: SET_NO_BREAK_ADAPTER_IDENTITY, tool: setNoBreakToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest,
            safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: setNoBreakResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: CLASSIFIER_VERSION, safetyConformanceVersion: CONFORMANCE_VERSION,
        errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: SET_NO_BREAK_HOST_SCRIPT_DIGEST,
        mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: SET_NO_BREAK_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: SET_NO_BREAK_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: SET_NO_BREAK_OPERATION,
                    documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: SET_NO_BREAK_ADAPTER_IDENTITY,
                mutationHostApplicationMode: 'foreground', script: SET_NO_BREAK_SCRIPT, params };
        },
        classifyTerminal(value) {
            return classifyTextLayoutTerminal(setNoBreakResultSchema.parse(value).transaction.state, 'No-break');
        },
        assertSafetyConformance: textLayoutSafetyAsserter(SET_NO_BREAK_SAFETY, safetyView),
        mapExecutionError(error, detail) {
            return mapTextLayoutError('No-break change', error, detail);
        },
    };
}
