import { z } from 'zod';
import { canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { CLIPPING_MASK_HOST_SCRIPT, clipAuditMatches, clipBlockerSchema, clipCmykWithinMeasuredScope, clipGroupSnapshotSchema, clipLayerStateSchema, clipParentOrderSchema, sameCanonical, sameGroupAfterRelease, } from './clipping-mask-shared.js';
import { mapClipExecutionError } from './create-clipping-mask-adapter.js';
export const RELEASE_CLIPPING_MASK_OPERATION = 'release_clipping_mask';
export const RELEASE_CLIPPING_MASK_VALIDATOR = { kind: RELEASE_CLIPPING_MASK_OPERATION, version: 1 };
const CANONICAL_VERSION = 2;
const RESULT_SCHEMA_VERSION = 2;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 2;
const uuidSchema = z.string().min(1).max(255);
const documentKeySchema = z.string().min(1).max(16_384);
const commonInternal = { expectedDocumentKey: documentKeySchema, groupUuid: uuidSchema };
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({
        ...commonInternal,
        expectedGroupBefore: clipGroupSnapshotSchema,
        expectedParentOrder: clipParentOrderSchema,
        apply: z.literal(true),
        commandId: canonicalCommandIdSchema,
    }),
]);
const commonPublic = {
    expected_document_key: documentKeySchema,
    group_uuid: uuidSchema.describe('Native PageItem.uuid of the clip group directly on a top-level layer.'),
};
export const releaseClippingMaskPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({
        ...commonPublic,
        expected_group_before: clipGroupSnapshotSchema,
        expected_parent_order: clipParentOrderSchema,
        apply: z.literal(true),
        command_id: canonicalCommandIdSchema,
    }),
]);
const inputSchema = z.strictObject({
    ...commonPublic,
    expected_group_before: clipGroupSnapshotSchema.optional(),
    expected_parent_order: clipParentOrderSchema.optional(),
    apply: z.boolean().default(false),
    command_id: canonicalCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(releaseClippingMaskPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = releaseClippingMaskPublicInputSchema.parse(input);
    const common = { expectedDocumentKey: value.expected_document_key, groupUuid: value.group_uuid };
    return value.apply ? {
        ...common,
        expectedGroupBefore: value.expected_group_before,
        expectedParentOrder: value.expected_parent_order,
        apply: true,
        commandId: value.command_id,
    } : { ...common, apply: false };
}
const planSchema = z.strictObject({
    operation: z.literal(RELEASE_CLIPPING_MASK_OPERATION),
    documentKey: documentKeySchema,
    groupUuid: uuidSchema,
    layer: clipLayerStateSchema,
    groupBefore: clipGroupSnapshotSchema,
    parentOrderBefore: clipParentOrderSchema,
    applyBlockedReasonCodes: z.array(clipBlockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    if (plan.groupBefore.uuid !== plan.groupUuid || plan.groupBefore.parentType !== 'Layer' ||
        !plan.parentOrderBefore.includes(plan.groupUuid) || !plan.groupBefore.clipped || !plan.groupBefore.mask.clipping) {
        context.addIssue({ code: 'custom', message: 'Release plan must bind one layer-direct clipped group.' });
    }
    if (plan.applyAllowed !== (plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0)) {
        context.addIssue({ code: 'custom', message: 'Release applyAllowed must require confirmation and no blockers.' });
    }
});
const failureSchema = z.strictObject({ phase: z.enum(['apply', 'verify']), reasonCode: z.enum(['apply_failed', 'verify_mismatch']), message: z.string().min(1).max(500) })
    .superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed')) {
        context.addIssue({ code: 'custom', message: 'Release failure phase and reason code must match.' });
    }
});
const rollbackEvidence = { restoredGroup: clipGroupSnapshotSchema.nullable(), restoredParentOrder: clipParentOrderSchema.nullable() };
const transactionSchema = z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('planned'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('verified'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('apply_failed'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('not_required') }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('rolled_back'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('verified'), restoredGroup: clipGroupSnapshotSchema, restoredParentOrder: clipParentOrderSchema }), audit: mutationAuditSchema }),
    z.strictObject({
        state: z.literal('apply_indeterminate'),
        failure: z.strictObject({ phase: z.literal('apply'), reasonCode: z.literal('apply_indeterminate'), message: z.string().min(1).max(500) }),
        rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('clip_state_unknown'), message: z.string().min(1).max(500), restoredGroup: z.null(), restoredParentOrder: z.null() }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rollback_indeterminate'), failure: failureSchema,
        rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('rollback_indeterminate'), message: z.string().min(1).max(500), ...rollbackEvidence }),
        audit: mutationAuditSchema,
    }),
]).superRefine((transaction, context) => {
    if (!clipAuditMatches(transaction))
        context.addIssue({ code: 'custom', message: 'Release audit sequence does not match transaction state.' });
    if (transaction.state === 'rollback_indeterminate' &&
        transaction.audit.filter((event) => event.event === 'failed' && event.phase === 'rollback' &&
            event.reasonCode === 'rollback_indeterminate' && event.message === transaction.rollback.message).length !== 1) {
        context.addIssue({ code: 'custom', message: 'Release rollback summary must match one audit event.' });
    }
    if (transaction.state === 'apply_indeterminate' && transaction.rollback.message !== transaction.failure.message) {
        context.addIssue({ code: 'custom', message: 'Release indeterminate summaries must match.' });
    }
});
const postconditionSchema = z.strictObject({ group: clipGroupSnapshotSchema, parentOrderAfter: clipParentOrderSchema });
export const releaseClippingMaskResultSchema = z.union([
    z.strictObject({ operation: z.literal(RELEASE_CLIPPING_MASK_OPERATION), applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ operation: z.literal(RELEASE_CLIPPING_MASK_OPERATION), applied: z.literal(true), document: documentContextSchema, plan: planSchema, postcondition: postconditionSchema, transaction: transactionSchema }),
]).superRefine((result, context) => {
    if (!clipCmykWithinMeasuredScope(result.document.colorSpace, result.plan.groupBefore.mask, result.plan.groupBefore.content)) {
        context.addIssue({ code: 'custom', message: 'CMYK clip paint is measured in a CMYK document with PathItem content only.' });
    }
    if (result.transaction.state === 'planned') {
        if (result.plan.confirmationStatus !== 'required') {
            context.addIssue({ code: 'custom', message: 'A release plan must require confirmation.' });
        }
    }
    else if (result.plan.confirmationStatus !== 'confirmed' || !result.plan.applyAllowed) {
        context.addIssue({ code: 'custom', message: 'A release apply outcome requires an allowed confirmed plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified' ||
            !sameGroupAfterRelease(result.plan.groupBefore, result.postcondition.group) ||
            !sameCanonical(result.postcondition.parentOrderAfter, result.plan.parentOrderBefore)) {
            context.addIssue({ code: 'custom', message: 'Verified release must keep the group, children, and order and clear both flags only.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified release transaction must be applied.' });
    }
    if (result.transaction.state === 'rolled_back' &&
        (!sameCanonical(result.transaction.rollback.restoredGroup, result.plan.groupBefore) ||
            !sameCanonical(result.transaction.rollback.restoredParentOrder, result.plan.parentOrderBefore))) {
        context.addIssue({ code: 'custom', message: 'Rolled-back release must prove the exact before group and order.' });
    }
});
export const releaseClippingMaskResponseSchema = z.strictObject({
    outcome: releaseClippingMaskResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
export const RELEASE_CLIPPING_MASK_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: RELEASE_CLIPPING_MASK_OPERATION,
    policy: {
        version: 1, class: 'update_existing', destructive: false,
        evidence: { identity: 'target_native_uuid', beforeState: 'before_state_hash', postcondition: 'updated_state_matches_plan' },
        preconditions: { documentBinding: 'explicit_document_key', compareAndSet: 'before_state_hash_match' },
        confirmation: 'exact_change_set',
        recovery: { mode: 'verified_inverse', verification: 'restored_state_matches_before_hash', partialRecovery: 'indeterminate' },
        terminal: { success: 'verified', failure: 'proven_pre_apply_or_verified_recovery', partialSuccess: 'nonterminal_until_reconciled' },
        replay: { requestBinding: 'canonical_request_digest', retry: 'return_attested_terminal_result', beforeTerminal: 'reconcile_required', reapplyOnRetry: false },
    },
    capabilities: {
        class: 'update_existing', explicitDocumentBinding: true, bindTargetNativeUuid: true, captureBeforeStateHash: true, compareAndSetBeforeApply: true,
        verifyUpdatedState: true, recoveryMode: 'verified_inverse', verifyRestoredBeforeState: true, reconcileIndeterminate: true, durableTerminalReplay: true, trustedTerminalAttestationResolver: true,
    },
});
export const RELEASE_CLIPPING_MASK_SAFETY_IDENTITY = canonicalDigest(RELEASE_CLIPPING_MASK_SAFETY);
function plannedAfter(before) {
    const { geometricBounds: _geometric, visibleBounds: _visible, ...rest } = before;
    return { ...rest, clipped: false, mask: { ...before.mask, clipping: false } };
}
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    const beforeStateHash = canonicalDigest({ group: result.plan.groupBefore, parentOrder: result.plan.parentOrderBefore });
    const afterStateHash = canonicalDigest({ group: plannedAfter(result.plan.groupBefore), parentOrder: result.plan.parentOrderBefore });
    const changeSetHash = canonicalDigest({ groupUuid: result.plan.groupUuid, changes: ['group.clipped:false', 'mask.clipping:false'], beforeStateHash, afterStateHash });
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'update_existing', operationId: RELEASE_CLIPPING_MASK_OPERATION, canonicalRequestDigest: requestDigest,
        evidence: { documentKey: admissionDocumentKey, targetUuid: result.plan.groupUuid, beforeStateHash, plannedAfterStateHash: afterStateHash, plannedChangeSetDigest: changeSetHash },
        preconditions: { status: result.plan.applyBlockedReasonCodes.length === 0 ? 'satisfied' : 'blocked', compareAndSetMatched: result.plan.applyBlockedReasonCodes.length === 0 },
        confirmation: { kind: 'exact_change_set', canonicalRequestDigest: requestDigest, changeSetHash, status: result.plan.confirmationStatus },
        applyAllowed: result.plan.applyAllowed,
    });
}
function safetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' || transaction.state === 'rollback_indeterminate') {
        throw new Error('Indeterminate release recovery cannot be terminal.');
    }
    const common = { policyVersion: 1, operationClass: 'update_existing', operationId: RELEASE_CLIPPING_MASK_OPERATION, canonicalRequestDigest: requestDigest, planDigest: plan.planDigest, attestation };
    const boundPlan = plan;
    const beforeStateHash = boundPlan.evidence.beforeStateHash;
    const evidence = { targetUuid: result.plan.groupUuid };
    const replay = { status: 'durable_terminal', action: 'return_attested_result', reapply: false };
    if (transaction.state === 'verified' && result.applied) {
        return operationSafetyResultSchema.parse({ ...common, evidence: { ...evidence, beforeStateHash, afterStateHash: boundPlan.evidence.plannedAfterStateHash, restoredStateHash: null, restoredBeforeStateVerified: false },
            executionEvidence: { outcome: 'completed' }, resolution: { status: 'succeeded', terminal: true, recovery: 'not_required', proof: { kind: 'verified_postcondition' }, replay } });
    }
    if (transaction.state === 'rolled_back') {
        return operationSafetyResultSchema.parse({ ...common, evidence: { ...evidence, beforeStateHash, afterStateHash: null, restoredStateHash: beforeStateHash, restoredBeforeStateVerified: true },
            executionEvidence: { outcome: 'completed' }, resolution: { status: 'recovered', terminal: true, recovery: 'verified', proof: { kind: 'verified_recovery' }, replay } });
    }
    return operationSafetyResultSchema.parse({ ...common, evidence: { ...evidence, beforeStateHash, afterStateHash: null, restoredStateHash: null, restoredBeforeStateVerified: false },
        executionEvidence: { outcome: 'proven_pre_apply' }, resolution: { status: 'failed', terminal: true, recovery: 'not_required', proof: { kind: 'proven_pre_apply', mutationAttempted: false }, replay } });
}
async function assertSafety(value, requestDigest, attestation, resolver) {
    const result = releaseClippingMaskResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null)
        throw new Error('Release terminal result requires attestation.');
    await assertOperationSafetyAdapterConformance({ registration: RELEASE_CLIPPING_MASK_SAFETY, plan, result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
export const RELEASE_CLIPPING_MASK_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}${CLIPPING_MASK_HOST_SCRIPT}
function releaseClipResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  var group = clipResolve(document, params.groupUuid, ["GroupItem"]);
  var layer = group.layer;
  if (!layer || String(layer.typename) !== "Layer" || group.parent !== layer) throw clipUnsupported("parent_unmeasured", params.groupUuid);
  var layerState = clipLayerState(document, layer, params.groupUuid);
  // CMYK-CLIP-RELEASE measured CMYK content paint in a CMYK document; a nested clip content stays RGB-only.
  var before = clipGroupSnapshot(document, group, layer, true, clipCmykScope(document, true));
  if (!before.clipped) throw clipUnsupported("not_clip_group", params.groupUuid);
  if (!clipIsMeasuredClipGroup(before)) throw clipUnsupported("group_state_unmeasured", params.groupUuid);
  var mask = clipTyped(document, "PathItem", before.mask.uuid);
  var parentOrder = supportedPathOrder(layer);
  var blockers = [];
  clipCommonBlockers(context, layerState, blockers);
  if (before.locked) clipAddBlocker(blockers, "group_locked");
  if (before.hidden) clipAddBlocker(blockers, "group_hidden");
  clipItemBlockers(before.mask, "mask_locked", "mask_hidden", blockers);
  clipItemBlockers(before.content, "content_locked", "content_hidden", blockers);
  clipEditableBlocker([group], blockers);
  if (forApply && blockers.length > 0) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "CLIP_APPLY_BLOCKED", reasonCodes: blockers }));
  }
  return { context: context, document: document, layer: layer, layerState: layerState, group: group, mask: mask,
    before: before, parentOrderBefore: parentOrder, blockers: blockers };
}

function releaseClipPreflight(forApply) {
  var resolved = releaseClipResolve(forApply);
  if (forApply) {
    if (!supportedPathSame(resolved.before, params.expectedGroupBefore)) {
      throw mutationError("preflight_failed", "Clip group state does not match expected_group_before.");
    }
    if (!mutationSameSequence(resolved.parentOrderBefore, params.expectedParentOrder)) {
      throw mutationError("preflight_failed", "Parent order does not match expected_parent_order.");
    }
  }
  return resolved;
}

function releaseClipPlan(preflight) {
  return {
    operation: "release_clipping_mask", documentKey: preflight.context.key, groupUuid: params.groupUuid,
    layer: preflight.layerState, groupBefore: preflight.before, parentOrderBefore: preflight.parentOrderBefore,
    applyBlockedReasonCodes: preflight.blockers, confirmationStatus: params.apply === true ? "confirmed" : "required",
    applyAllowed: params.apply === true && preflight.blockers.length === 0
  };
}

function releaseClipRevalidate(preflight, plan) {
  var current;
  try { current = releaseClipResolve(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Release preconditions changed before apply.")); }
  if (current.document !== preflight.document || current.group !== preflight.group || current.mask !== preflight.mask ||
      !supportedPathSame(current.before, plan.groupBefore) || !mutationSameSequence(current.parentOrderBefore, plan.parentOrderBefore)) {
    throw mutationBeforeSideEffectError("Clip group or complete parent order changed before apply.");
  }
}

function releaseClipApply(preflight, plan, state) {
  state.operationState.mutationStarted = true;
  // Measured order (A35_CLIP_RELEASE): group flag first, then the mask flag.
  preflight.group.clipped = false;
  preflight.mask.clipping = false;
  return true;
}

function releaseClipSnapshot(preflight) {
  var group = clipTyped(preflight.document, "GroupItem", params.groupUuid);
  if (group === null || group !== preflight.group || group.parent !== preflight.layer) {
    throw mutationError("verify_mismatch", "Clip group native identity changed.");
  }
  return clipGroupSnapshot(preflight.document, group, preflight.layer, true, clipCmykScope(preflight.document, true));
}

function releaseClipVerify(preflight, plan, state) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) {
    throw mutationError("verify_mismatch", "Active document changed during release verification.");
  }
  var after = releaseClipSnapshot(preflight);
  var expected = {};
  for (var key in plan.groupBefore) if (plan.groupBefore.hasOwnProperty(key)) expected[key] = plan.groupBefore[key];
  var expectedMask = {};
  for (var maskKey in plan.groupBefore.mask) if (plan.groupBefore.mask.hasOwnProperty(maskKey)) expectedMask[maskKey] = plan.groupBefore.mask[maskKey];
  expectedMask.clipping = false;
  expected.clipped = false;
  expected.mask = expectedMask;
  // An unclipped group reports the union of its children, so its own bounds are not predicted.
  expected.geometricBounds = after.geometricBounds;
  expected.visibleBounds = after.visibleBounds;
  var parentOrderAfter = supportedPathOrder(preflight.layer);
  if (!supportedPathSame(after, expected) || !mutationSameSequence(parentOrderAfter, plan.parentOrderBefore)) {
    throw mutationError("verify_mismatch", "Released group, children, or parent order does not match the plan.");
  }
  return { group: after, parentOrderAfter: parentOrderAfter };
}

function releaseClipRollback(state) {
  var preflight = state.preflight;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) {
    return { status: "indeterminate", message: "Release rollback document is indeterminate." };
  }
  var group;
  var mask;
  try {
    group = clipTyped(preflight.document, "GroupItem", params.groupUuid);
    mask = clipTyped(preflight.document, "PathItem", preflight.before.mask.uuid);
  } catch (error) { return { status: "indeterminate", message: "Release rollback lookup is indeterminate." }; }
  if (group !== preflight.group || mask !== preflight.mask || group.parent !== preflight.layer || mask.parent !== group) {
    return { status: "indeterminate", message: "Release rollback refused because group or mask identity changed." };
  }
  // Measured inverse (A35_CLIP_RELEASE): set the group flag, then the mask flag.
  try {
    group.clipped = true;
    mask.clipping = true;
  } catch (error) { return { status: "indeterminate", message: "Release rollback write is indeterminate." }; }
  try {
    var restored = releaseClipSnapshot(preflight);
    var restoredOrder = supportedPathOrder(preflight.layer);
    state.operationState.rollbackEvidence.restoredGroup = restored;
    state.operationState.rollbackEvidence.restoredParentOrder = restoredOrder;
    if (!supportedPathSame(restored, preflight.before) || !mutationSameSequence(restoredOrder, preflight.parentOrderBefore)) {
      return { status: "indeterminate", message: "Release rollback did not restore the exact before state." };
    }
  } catch (error) { return { status: "indeterminate", message: "Release rollback verification is indeterminate." }; }
  return { status: "verified" };
}

var releaseClipExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionAffected: function () { return [params.groupUuid]; },
  initialOperationState: function () { return { mutationStarted: false, rollbackEvidence: { restoredGroup: null, restoredParentOrder: null } }; },
  preflight: releaseClipPreflight,
  plan: releaseClipPlan,
  revalidate: releaseClipRevalidate,
  applyMutation: releaseClipApply,
  verify: releaseClipVerify,
  rollback: releaseClipRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () {
    return { reasonCode: "clip_state_unknown", message: "Release apply outcome is indeterminate.",
      evidence: { restoredGroup: null, restoredParentOrder: null } };
  },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var releaseClipDocument = releaseClipExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === releaseClipExecution.preflight.document) releaseClipDocument = getDocumentContext();
var result = {
  operation: "release_clipping_mask", applied: releaseClipExecution.transaction.state === "verified",
  document: releaseClipDocument, plan: releaseClipExecution.plan, transaction: releaseClipExecution.transaction
};
if (releaseClipExecution.transaction.state === "verified") result.postcondition = releaseClipExecution.value;
`;
export const RELEASE_CLIPPING_MASK_HOST_SCRIPT_DIGEST = canonicalSha256(RELEASE_CLIPPING_MASK_SCRIPT);
export const RELEASE_CLIPPING_MASK_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: RELEASE_CLIPPING_MASK_OPERATION, validator: RELEASE_CLIPPING_MASK_VALIDATOR,
    canonicalContractVersion: CANONICAL_VERSION, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: RELEASE_CLIPPING_MASK_SAFETY_IDENTITY, hostScriptDigest: RELEASE_CLIPPING_MASK_HOST_SCRIPT_DIGEST,
    mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    const digestRequest = 'commandId' in request ? (({ commandId: _commandId, ...rest }) => rest)(request) : request;
    const digest = canonicalSha256({ operation: RELEASE_CLIPPING_MASK_OPERATION, validator: RELEASE_CLIPPING_MASK_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: 'commandId' in request ? request.commandId : null, documentKey: request.expectedDocumentKey, digest };
}
export const releaseClippingMaskToolContract = {
    name: 'illustrator_release_clipping_mask',
    title: 'Read or Release Clipping Mask',
    description: 'Read (apply=false) or release one clip group directly on a top-level layer. The plan is the clip-group read: group, mask, and content UUIDs, child order [mask, content], flags, bounds, lock/hidden state, and one nested clip group as content. Measured profile only: a two-child group [clipping PathItem without paint, PathItem or one such clip group], RGB, Illustrator 30.8.1 in the foreground; inner (nested) groups, PlacedItem, CompoundPathItem, sublayers, and other shapes are refused. Locked or hidden groups, children, and layers are refused by this tool (Illustrator itself does not refuse them). Apply compares expected_group_before and expected_parent_order, clears group.clipped and mask.clipping, verifies that the group, both children, and the parent order are otherwise unchanged, and on failure sets both flags back and proves the exact before state. The mask stays in the group without fill or stroke.',
    inputSchema,
    publicInputSchema: releaseClippingMaskPublicInputSchema,
    outputSchema: releaseClippingMaskResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(RELEASE_CLIPPING_MASK_SAFETY.policy),
    normalizePublicInput,
};
export function createReleaseClippingMaskAdapter() {
    return {
        version: 1, operation: RELEASE_CLIPPING_MASK_OPERATION, validator: RELEASE_CLIPPING_MASK_VALIDATOR,
        safety: RELEASE_CLIPPING_MASK_SAFETY, safetyRegistrationIdentity: RELEASE_CLIPPING_MASK_SAFETY_IDENTITY,
        adapterIdentity: RELEASE_CLIPPING_MASK_ADAPTER_IDENTITY, tool: releaseClippingMaskToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: releaseClippingMaskResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
        safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: RELEASE_CLIPPING_MASK_HOST_SCRIPT_DIGEST,
        mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: RELEASE_CLIPPING_MASK_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: RELEASE_CLIPPING_MASK_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: RELEASE_CLIPPING_MASK_OPERATION, documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: RELEASE_CLIPPING_MASK_ADAPTER_IDENTITY, mutationHostApplicationMode: 'foreground', script: RELEASE_CLIPPING_MASK_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = releaseClippingMaskResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back')
                return { state };
            if (state === 'planned')
                throw new Error('Release plan is not a terminal mutation result.');
            throw new Error('Unverified release recovery must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError: mapClipExecutionError,
    };
}
