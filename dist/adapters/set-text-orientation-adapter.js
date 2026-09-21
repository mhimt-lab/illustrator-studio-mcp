import { z } from 'zod';
import { canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema } from '../mutation-result-schema-core.js';
import { canonicalDigest, operationSafetyPolicyToMcpAnnotations } from '../operation-safety-policy-core.js';
import { AREA_TEXT_SNAPSHOT_SCRIPT } from './area-text-host-script.js';
import { PLAIN_POINT_TEXT_V1, POINT_TEXT_BLOCKERS_SCRIPT, POINT_TEXT_SNAPSHOT_SCRIPT, pointTextApplyBlockers, } from './point-text-host-script.js';
import { classifyTextLayoutTerminal, mapTextLayoutError, sameCanonical, TEXT_LAYOUT_SNAPSHOT_SCRIPT, textLayoutBlockerSchema, textLayoutOrientationSchema, textLayoutSafetyAsserter, textLayoutSafetyRegistration, textLayoutSnapshotInputSchema, textLayoutSnapshotSchema, textLayoutTransactionSchema, } from './text-layout-shared.js';
export const SET_TEXT_ORIENTATION_OPERATION = 'set_text_orientation';
export const SET_TEXT_ORIENTATION_VALIDATOR = { kind: SET_TEXT_ORIENTATION_OPERATION, version: 1 };
const CANONICAL_VERSION = 1;
const RESULT_SCHEMA_VERSION = 1;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 2;
export const TEXT_LEADING_MAX = 1296;
export const TEXT_AUTO_LEADING_FACTOR = Number(PLAIN_POINT_TEXT_V1.paragraph.autoLeadingAmount) / 100;
const leadingRequestSchema = z.union([z.number().finite().positive().max(TEXT_LEADING_MAX), z.literal('auto')]);
export const setTextOrientationPlanSchema = z.strictObject({
    operation: z.literal(SET_TEXT_ORIENTATION_OPERATION),
    documentKey: z.string().min(1).max(16_384),
    targetUuid: z.string().min(1).max(255),
    orientation: textLayoutOrientationSchema,
    leading: leadingRequestSchema.nullable(),
    before: textLayoutSnapshotSchema,
    after: textLayoutSnapshotSchema,
    applyBlockedReasonCodes: z.array(textLayoutBlockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    if (plan.targetUuid !== plan.before.uuid || plan.before.uuid !== plan.after.uuid) {
        context.addIssue({ code: 'custom', message: 'A text-orientation plan must bind one target UUID.' });
    }
    if (plan.before.orientation === plan.orientation || plan.after.orientation !== plan.orientation) {
        context.addIssue({ code: 'custom', message: 'A text-orientation plan must change the orientation to the requested one.' });
    }
    if (plan.before.kind === 'TextType.AREATEXT' && plan.before.fit?.status !== 'fits') {
        context.addIssue({ code: 'custom', message: 'A text-orientation plan requires area text that fits its frame.' });
    }
    const expected = predictOrientationAfter(plan.before, plan.orientation, plan.leading);
    if (!sameCanonical(expected, plan.after)) {
        context.addIssue({ code: 'custom', message: 'A text-orientation plan may move only the orientation and the requested leading.' });
    }
    const allowed = plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0;
    if (plan.applyAllowed !== allowed) {
        context.addIssue({ code: 'custom', message: 'Text-orientation applyAllowed must require confirmation and no blockers.' });
    }
});
export function predictOrientationAfter(before, orientation, leading) {
    return {
        ...before,
        orientation,
        characters: before.characters.map((character) => {
            if (leading === null)
                return character;
            if (leading === 'auto')
                return { ...character, leading: character.size * TEXT_AUTO_LEADING_FACTOR, autoLeading: true };
            return { ...character, leading, autoLeading: false };
        }),
    };
}
const transactionSchema = textLayoutTransactionSchema('Text orientation');
export const setTextOrientationResultSchema = z.union([
    z.strictObject({
        operation: z.literal(SET_TEXT_ORIENTATION_OPERATION), applied: z.literal(false),
        document: documentContextSchema, plan: setTextOrientationPlanSchema, transaction: transactionSchema,
    }),
    z.strictObject({
        operation: z.literal(SET_TEXT_ORIENTATION_OPERATION), applied: z.literal(true),
        document: documentContextSchema, plan: setTextOrientationPlanSchema,
        postcondition: textLayoutSnapshotSchema, transaction: transactionSchema,
    }),
]).superRefine((result, context) => {
    if (result.transaction.state === 'planned') {
        const blockers = pointTextApplyBlockers(result.document.mutationAllowed, result.plan.before);
        if (result.plan.confirmationStatus !== 'required' || !sameCanonical(result.plan.applyBlockedReasonCodes, blockers)) {
            context.addIssue({ code: 'custom', message: 'A planned text-orientation change must expose exact blockers.' });
        }
    }
    else if (result.plan.confirmationStatus !== 'confirmed' || result.plan.applyBlockedReasonCodes.length !== 0 ||
        !result.plan.applyAllowed) {
        context.addIssue({ code: 'custom', message: 'An applied text-orientation change must derive from an allowed confirmed plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified' || !sameCanonical(result.postcondition, result.plan.after)) {
            context.addIssue({ code: 'custom', message: 'A verified text-orientation change must match the exact after snapshot.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified text-orientation transaction must be applied.' });
    }
    if (result.transaction.state === 'rolled_back' &&
        !sameCanonical(result.transaction.rollback.restoredSnapshot, result.plan.before)) {
        context.addIssue({ code: 'custom', message: 'A rolled-back text-orientation change must prove exact before restoration.' });
    }
});
export const setTextOrientationResponseSchema = z.strictObject({
    outcome: setTextOrientationResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
const commonInternal = {
    expectedDocumentKey: z.string().min(1).max(16_384),
    targetUuid: z.string().min(1).max(255),
    orientation: textLayoutOrientationSchema,
    leading: leadingRequestSchema.nullable(),
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
    orientation: textLayoutOrientationSchema,
    leading: leadingRequestSchema.optional(),
};
export const setTextOrientationPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({
        ...commonPublic,
        expected_before: textLayoutSnapshotInputSchema,
        confirmed_after: textLayoutSnapshotInputSchema,
        apply: z.literal(true),
        command_id: canonicalCommandIdSchema,
    }),
]);
const inputSchema = z.strictObject({
    ...commonPublic,
    expected_before: textLayoutSnapshotInputSchema.optional(),
    confirmed_after: textLayoutSnapshotInputSchema.optional(),
    apply: z.boolean().default(false),
    command_id: canonicalCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(setTextOrientationPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = setTextOrientationPublicInputSchema.parse(input);
    const common = {
        expectedDocumentKey: value.expected_document_key,
        targetUuid: value.target_uuid,
        orientation: value.orientation,
        leading: value.leading ?? null,
    };
    return value.apply
        ? { ...common, expectedBefore: value.expected_before, confirmedAfter: value.confirmed_after,
            apply: true, commandId: value.command_id }
        : { ...common, apply: false };
}
export const SET_TEXT_ORIENTATION_SAFETY = textLayoutSafetyRegistration(SET_TEXT_ORIENTATION_OPERATION);
export const SET_TEXT_ORIENTATION_SAFETY_IDENTITY = canonicalDigest(SET_TEXT_ORIENTATION_SAFETY);
export const SET_TEXT_ORIENTATION_MODULE_SCRIPT = `
function orientationPredictAfter(before) {
  var after = textLayoutCopy(before);
  after.orientation = params.orientation;
  if (params.leading !== null) {
    for (var index = 0; index < after.characters.length; index++) {
      var character = after.characters[index];
      if (params.leading === "auto") {
        character.leading = character.size * ${TEXT_AUTO_LEADING_FACTOR};
        character.autoLeading = true;
      } else {
        character.leading = params.leading;
        character.autoLeading = false;
      }
    }
  }
  return after;
}

function orientationPreflight(forApply) {
  var resolved = textLayoutResolve(forApply);
  if (resolved.before.orientation === params.orientation) {
    throw mutationError("preflight_failed", "The target is already " + params.orientation + "; the orientation must change.");
  }
  if (resolved.before.fit !== null && resolved.before.fit.status !== "fits") {
    throw mutationError("preflight_failed", "Text-orientation changes require area text that shows its whole story.");
  }
  if (forApply) {
    if (!textLayoutSame(resolved.before, params.expectedBefore)) {
      throw mutationError("preflight_failed", "Target state does not match expected_before.");
    }
    if (!textLayoutSame(orientationPredictAfter(resolved.before), params.confirmedAfter)) {
      throw mutationError("preflight_failed", "confirmed_after does not match the derived orientation state.");
    }
  }
  return resolved;
}

function orientationPlan(preflight) {
  return {
    operation: "set_text_orientation", documentKey: preflight.context.key, targetUuid: params.targetUuid,
    orientation: params.orientation, leading: params.leading,
    before: preflight.before,
    after: orientationPredictAfter(preflight.before),
    applyBlockedReasonCodes: preflight.blockers,
    confirmationStatus: params.apply === true ? "confirmed" : "required",
    applyAllowed: params.apply === true && preflight.blockers.length === 0
  };
}

function orientationRevalidate(preflight, plan) {
  var current;
  try { current = textLayoutResolve(true); }
  catch (error) {
    throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Text-orientation preconditions changed before apply."));
  }
  if (current.document !== preflight.document || current.target !== preflight.target ||
      !textLayoutSame(current.before, plan.before)) {
    throw mutationBeforeSideEffectError("Text-orientation target changed before apply.");
  }
}

/** The measured profile / measured operation write order: orientation first, then each held character. */
function orientationApply(preflight, plan, state) {
  var target = preflight.target;
  state.operationState.mutationStarted = true;
  target.orientation = textLayoutNativeOrientation(params.orientation);
  if (params.leading !== null) {
    for (var index = 0; index < target.characters.length; index++) {
      var character = target.characters[index];
      var attributes = character.characterAttributes;
      if (params.leading === "auto") attributes.autoLeading = true;
      else { attributes.autoLeading = false; attributes.leading = params.leading; }
    }
  }
  return target;
}

function orientationVerify(preflight, plan) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) {
    throw mutationError("verify_mismatch", "Active document changed during text-orientation verification.");
  }
  var target = pointTextFind(preflight.document, plan.before.uuid);
  if (target === null || target !== preflight.target) {
    throw mutationError("verify_mismatch", "Target native UUID no longer resolves to the same TextFrame.");
  }
  var actual = textLayoutSnapshot(preflight.document, target, params.targetUuid);
  if (actual.fit !== null && actual.fit.status !== "fits") {
    throw mutationError("verify_mismatch", "The area text no longer fits its frame after the orientation change.");
  }
  if (!textLayoutSame(actual, plan.after)) {
    throw mutationError("verify_mismatch", "Text-orientation postcondition does not match the plan.");
  }
  return actual;
}

/** The measured inverse: the original orientation, then each character's own leading and auto-leading. */
function orientationRestore(target, before) {
  target.orientation = textLayoutNativeOrientation(before.orientation);
  if (params.leading === null) return;
  for (var index = 0; index < before.characters.length; index++) {
    var character = target.characters[index];
    var attributes = character.characterAttributes;
    attributes.leading = before.characters[index].leading;
    attributes.autoLeading = before.characters[index].autoLeading;
  }
}

function orientationRollback(state) {
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
    current = textLayoutSnapshot(preflight.document, target, params.targetUuid);
  } catch (error) { return { status: "indeterminate", message: "Rollback target state is indeterminate." }; }
  if (textLayoutSame(current, preflight.before)) {
    state.operationState.rollbackEvidence.restoredSnapshot = current;
    return { status: "verified" };
  }
  var mask = { orientation: true, start: 0, end: params.leading === null ? 0 : preflight.before.characters.length,
    characterFields: ["leading", "autoLeading"] };
  if (!textLayoutSame(textLayoutMasked(current, mask), textLayoutMasked(preflight.before, mask))) {
    return { status: "indeterminate", message: "Rollback refused because the target changed outside the orientation and leading." };
  }
  try { orientationRestore(target, preflight.before); }
  catch (writeError) { return { status: "indeterminate", message: "Rollback orientation write is indeterminate." }; }
  var restored;
  try { restored = textLayoutSnapshot(preflight.document, target, params.targetUuid); }
  catch (verifyError) { return { status: "indeterminate", message: "Rollback verification is indeterminate." }; }
  state.operationState.rollbackEvidence.restoredSnapshot = restored;
  return textLayoutSame(restored, preflight.before)
    ? { status: "verified" }
    : { status: "failed", message: "Rollback did not restore the exact before text-layout state." };
}
`;
export const SET_TEXT_ORIENTATION_RUNNER_SCRIPT = `var orientationExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionAffected: function () { return [params.targetUuid]; },
  initialOperationState: function () {
    return { mutationStarted: false, rollbackEvidence: { targetUuid: params.targetUuid, restoredSnapshot: null } };
  },
  preflight: orientationPreflight,
  plan: orientationPlan,
  revalidate: orientationRevalidate,
  applyMutation: orientationApply,
  verify: orientationVerify,
  rollback: orientationRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () {
    return { reasonCode: "text_state_unknown", message: "Text-orientation apply outcome is indeterminate.",
      evidence: { targetUuid: params.targetUuid, restoredSnapshot: null } };
  },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var orientationDocument = orientationExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === orientationExecution.preflight.document) {
  orientationDocument = getDocumentContext();
}
var result = { operation: "set_text_orientation",
  applied: orientationExecution.transaction.state === "verified",
  document: orientationDocument, plan: orientationExecution.plan, transaction: orientationExecution.transaction };
if (orientationExecution.transaction.state === "verified") result.postcondition = orientationExecution.value;
`;
export const SET_TEXT_ORIENTATION_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${POINT_TEXT_SNAPSHOT_SCRIPT}
${POINT_TEXT_BLOCKERS_SCRIPT}
${AREA_TEXT_SNAPSHOT_SCRIPT}
${TEXT_LAYOUT_SNAPSHOT_SCRIPT}
${SET_TEXT_ORIENTATION_MODULE_SCRIPT}${SET_TEXT_ORIENTATION_RUNNER_SCRIPT}`;
export const SET_TEXT_ORIENTATION_HOST_SCRIPT_DIGEST = canonicalSha256(SET_TEXT_ORIENTATION_SCRIPT);
export const SET_TEXT_ORIENTATION_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: SET_TEXT_ORIENTATION_OPERATION,
    validator: SET_TEXT_ORIENTATION_VALIDATOR, canonicalContractVersion: CANONICAL_VERSION,
    resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: SET_TEXT_ORIENTATION_SAFETY_IDENTITY, hostScriptDigest: SET_TEXT_ORIENTATION_HOST_SCRIPT_DIGEST,
    mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    const digestRequest = 'commandId' in request
        ? (({ commandId: _commandId, ...rest }) => rest)(request)
        : request;
    const digest = canonicalSha256({ operation: SET_TEXT_ORIENTATION_OPERATION,
        validator: SET_TEXT_ORIENTATION_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request,
        commandId: 'commandId' in request ? request.commandId : null,
        documentKey: request.expectedDocumentKey, digest };
}
export const setTextOrientationToolContract = {
    name: 'illustrator_set_text_orientation',
    title: 'Plan or Set Text Orientation and Leading',
    description: 'Plan or apply a change of writing direction (horizontal ⇄ vertical, 横組み⇄縦組み) on one layer-direct, '
        + 'unthreaded point-text or area-text frame, bound by explicit document key and native UUID, optionally with a '
        + 'leading (行送り) in points written to every character with auto leading off, or "auto" to turn auto leading '
        + 'back on. The orientation must change. Area text must show its whole story before and after; a change that '
        + 'makes it overflow is rolled back. Kinsoku, mojikumi, burasagari and roman hanging are not supported. Apply '
        + 'performs exact compare-and-set over a per-character fingerprint, native read-back verification, and the '
        + 'measured inverse (original orientation, then each character\'s own leading).',
    inputSchema,
    publicInputSchema: setTextOrientationPublicInputSchema,
    outputSchema: setTextOrientationResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(SET_TEXT_ORIENTATION_SAFETY.policy),
    normalizePublicInput,
};
function safetyView(value) {
    const result = setTextOrientationResultSchema.parse(value);
    return {
        operationId: SET_TEXT_ORIENTATION_OPERATION, documentKey: result.document.key, targetUuid: result.plan.targetUuid,
        before: result.plan.before, after: result.plan.after,
        changeSet: { orientation: result.plan.orientation, leading: result.plan.leading },
        blocked: result.plan.applyBlockedReasonCodes.length > 0,
        confirmationStatus: result.plan.confirmationStatus, applyAllowed: result.plan.applyAllowed,
        transactionState: result.transaction.state, applied: result.applied,
    };
}
export function createSetTextOrientationAdapter() {
    return {
        version: 1, operation: SET_TEXT_ORIENTATION_OPERATION, validator: SET_TEXT_ORIENTATION_VALIDATOR,
        safety: SET_TEXT_ORIENTATION_SAFETY, safetyRegistrationIdentity: SET_TEXT_ORIENTATION_SAFETY_IDENTITY,
        adapterIdentity: SET_TEXT_ORIENTATION_ADAPTER_IDENTITY, tool: setTextOrientationToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest,
            safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: setTextOrientationResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: CLASSIFIER_VERSION, safetyConformanceVersion: CONFORMANCE_VERSION,
        errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: SET_TEXT_ORIENTATION_HOST_SCRIPT_DIGEST,
        mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: SET_TEXT_ORIENTATION_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: SET_TEXT_ORIENTATION_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: SET_TEXT_ORIENTATION_OPERATION,
                    documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: SET_TEXT_ORIENTATION_ADAPTER_IDENTITY,
                mutationHostApplicationMode: 'foreground', script: SET_TEXT_ORIENTATION_SCRIPT, params };
        },
        classifyTerminal(value) {
            return classifyTextLayoutTerminal(setTextOrientationResultSchema.parse(value).transaction.state, 'Text-orientation');
        },
        assertSafetyConformance: textLayoutSafetyAsserter(SET_TEXT_ORIENTATION_SAFETY, safetyView),
        mapExecutionError(error, detail) {
            return mapTextLayoutError('Text-orientation change', error, detail);
        },
    };
}
