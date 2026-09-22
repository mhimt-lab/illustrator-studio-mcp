import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { boundsSchema, documentContextSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { CLIPPING_MASK_HOST_SCRIPT, clipAuditMatches, clipBlockerSchema, clipCmykWithinMeasuredScope, clipContentSnapshotSchema, clipLayerStateSchema, clipParentOrderSchema, clipPathSnapshotSchema, expectedContentAfterCreate, sameCanonical, sameMaskAfterCreate, } from './clipping-mask-shared.js';
export const CREATE_CLIPPING_MASK_OPERATION = 'create_clipping_mask';
export const CREATE_CLIPPING_MASK_VALIDATOR = { kind: CREATE_CLIPPING_MASK_OPERATION, version: 1 };
const CANONICAL_VERSION = 2;
const RESULT_SCHEMA_VERSION = 2;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 2;
const uuidSchema = z.string().min(1).max(255);
const documentKeySchema = z.string().min(1).max(16_384);
const commonInternal = { expectedDocumentKey: documentKeySchema, maskUuid: uuidSchema, contentUuid: uuidSchema };
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({
        ...commonInternal,
        expectedMaskBefore: clipPathSnapshotSchema,
        expectedContentBefore: clipContentSnapshotSchema,
        expectedParentOrder: clipParentOrderSchema,
        apply: z.literal(true),
        commandId: canonicalCommandIdSchema,
    }),
]);
const commonPublic = {
    expected_document_key: documentKeySchema,
    mask_uuid: uuidSchema.describe('Native PageItem.uuid of the PathItem that becomes the clipping path.'),
    content_uuid: uuidSchema.describe('Native PageItem.uuid of the clipped item: a PathItem, or one clip group (nested clip). It must sit directly behind the mask on the same top-level layer.'),
};
export const createClippingMaskPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({
        ...commonPublic,
        expected_mask_before: clipPathSnapshotSchema,
        expected_content_before: clipContentSnapshotSchema,
        expected_parent_order: clipParentOrderSchema,
        apply: z.literal(true),
        command_id: applyCommandIdSchema,
    }),
]);
const inputSchema = z.strictObject({
    ...commonPublic,
    expected_mask_before: clipPathSnapshotSchema.optional(),
    expected_content_before: clipContentSnapshotSchema.optional(),
    expected_parent_order: clipParentOrderSchema.optional(),
    apply: z.boolean().default(false),
    command_id: applyCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(createClippingMaskPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = createClippingMaskPublicInputSchema.parse(input);
    const common = { expectedDocumentKey: value.expected_document_key, maskUuid: value.mask_uuid, contentUuid: value.content_uuid };
    return value.apply ? {
        ...common,
        expectedMaskBefore: value.expected_mask_before,
        expectedContentBefore: value.expected_content_before,
        expectedParentOrder: value.expected_parent_order,
        apply: true,
        commandId: value.command_id,
    } : { ...common, apply: false };
}
export function predictedParentOrderAfterCreate(before, maskUuid, contentUuid) {
    const maskIndex = before.indexOf(maskUuid);
    if (maskIndex < 0 || before[maskIndex + 1] !== contentUuid) {
        throw new Error('The mask must sit directly in front of the content in the parent order.');
    }
    return [...before.slice(0, maskIndex), null, ...before.slice(maskIndex + 2)];
}
const planSchema = z.strictObject({
    operation: z.literal(CREATE_CLIPPING_MASK_OPERATION),
    documentKey: documentKeySchema,
    maskUuid: uuidSchema,
    contentUuid: uuidSchema,
    layer: clipLayerStateSchema,
    maskBefore: clipPathSnapshotSchema,
    contentBefore: clipContentSnapshotSchema,
    parentOrderBefore: clipParentOrderSchema,
    predicted: z.strictObject({
        parentOrderAfter: z.array(uuidSchema.nullable()).min(1),
        groupChildOrder: z.tuple([uuidSchema, uuidSchema]),
        maskAppearanceAfter: z.strictObject({
            filled: z.literal(false), fillColor: z.null(), stroked: z.literal(false), strokeColor: z.null(), strokeWidth: z.null(),
        }),
    }),
    applyBlockedReasonCodes: z.array(clipBlockerSchema),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    if (plan.maskBefore.uuid !== plan.maskUuid || plan.contentBefore.uuid !== plan.contentUuid || plan.maskUuid === plan.contentUuid ||
        plan.maskBefore.parentType !== 'Layer' || plan.contentBefore.parentType !== 'Layer' || plan.maskBefore.clipping) {
        context.addIssue({ code: 'custom', message: 'Clip plan must bind two distinct layer-direct targets and an unclipped mask.' });
    }
    let predictedOrder = null;
    try {
        predictedOrder = predictedParentOrderAfterCreate(plan.parentOrderBefore, plan.maskUuid, plan.contentUuid);
    }
    catch { }
    if (predictedOrder === null || !sameCanonical(predictedOrder, plan.predicted.parentOrderAfter) ||
        !sameCanonical(plan.predicted.groupChildOrder, [plan.maskUuid, plan.contentUuid])) {
        context.addIssue({ code: 'custom', message: 'Clip plan prediction must follow from the adjacent mask/content run.' });
    }
    if (plan.applyAllowed !== (plan.applyBlockedReasonCodes.length === 0)) {
        context.addIssue({ code: 'custom', message: 'Clip applyAllowed must exactly reflect blockers.' });
    }
});
const applyFailureSchema = z.strictObject({ phase: z.literal('apply'), reasonCode: z.literal('apply_failed'), message: z.string().min(1).max(500) });
const verifyFailureSchema = z.strictObject({ phase: z.literal('verify'), reasonCode: z.literal('verify_mismatch'), message: z.string().min(1).max(500) });
const failureSchema = z.discriminatedUnion('phase', [applyFailureSchema, verifyFailureSchema]);
const restoredEvidence = {
    groupUuid: uuidSchema,
    restoredMask: clipPathSnapshotSchema,
    restoredContent: clipContentSnapshotSchema,
    restoredParentOrder: clipParentOrderSchema,
};
const transactionSchema = z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('planned'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('verified'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('apply_failed'), failure: applyFailureSchema, rollback: z.strictObject({ status: z.literal('not_required') }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('rolled_back'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('verified'), ...restoredEvidence }), audit: mutationAuditSchema }),
    z.strictObject({
        state: z.literal('rollback_failed'), failure: failureSchema,
        rollback: z.strictObject({
            status: z.literal('failed'), reasonCode: z.literal('rollback_failed'), message: z.string().min(1).max(500),
            groupUuid: uuidSchema, restoredMask: z.null(), restoredContent: z.null(), restoredParentOrder: z.null(),
        }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('apply_indeterminate'),
        failure: z.strictObject({ phase: z.literal('apply'), reasonCode: z.literal('apply_indeterminate'), message: z.string().min(1).max(500) }),
        rollback: z.strictObject({
            status: z.literal('indeterminate'), reasonCode: z.literal('identity_unavailable'), message: z.string().min(1).max(500),
            groupUuid: z.null(), restoredMask: z.null(), restoredContent: z.null(), restoredParentOrder: z.null(),
        }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rollback_indeterminate'), failure: failureSchema,
        rollback: z.strictObject({
            status: z.literal('indeterminate'), reasonCode: z.literal('rollback_indeterminate'), message: z.string().min(1).max(500),
            groupUuid: uuidSchema.nullable(), restoredMask: clipPathSnapshotSchema.nullable(),
            restoredContent: clipContentSnapshotSchema.nullable(), restoredParentOrder: clipParentOrderSchema.nullable(),
        }),
        audit: mutationAuditSchema,
    }),
]).superRefine((transaction, context) => {
    if (!clipAuditMatches(transaction))
        context.addIssue({ code: 'custom', message: 'Clip audit sequence does not match transaction state.' });
    if ((transaction.state === 'rollback_failed' || transaction.state === 'rollback_indeterminate') &&
        transaction.audit.filter((event) => event.event === 'failed' && event.phase === 'rollback' &&
            event.reasonCode === transaction.rollback.reasonCode && event.message === transaction.rollback.message).length !== 1) {
        context.addIssue({ code: 'custom', message: 'Clip rollback summary must match one audit event.' });
    }
    if (transaction.state === 'apply_indeterminate' && transaction.rollback.message !== transaction.failure.message) {
        context.addIssue({ code: 'custom', message: 'Clip indeterminate summaries must match.' });
    }
});
const createdGroupSchema = z.strictObject({
    uuid: uuidSchema,
    layerPath: clipLayerStateSchema.shape.layerPath,
    geometricBounds: boundsSchema,
    visibleBounds: boundsSchema,
    clipped: z.literal(true),
    locked: z.literal(false),
    hidden: z.literal(false),
    childOrder: z.tuple([uuidSchema, uuidSchema]),
});
const postconditionSchema = z.strictObject({
    group: createdGroupSchema,
    mask: clipPathSnapshotSchema,
    content: clipContentSnapshotSchema,
    parentOrderAfter: clipParentOrderSchema,
});
export const createClippingMaskResultSchema = z.union([
    z.strictObject({ operation: z.literal(CREATE_CLIPPING_MASK_OPERATION), applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ operation: z.literal(CREATE_CLIPPING_MASK_OPERATION), applied: z.literal(true), document: documentContextSchema, plan: planSchema, postcondition: postconditionSchema, transaction: transactionSchema }),
]).superRefine((result, context) => {
    if (!clipCmykWithinMeasuredScope(result.document.colorSpace, result.plan.maskBefore, result.plan.contentBefore)) {
        context.addIssue({ code: 'custom', message: 'CMYK clip paint is measured in a CMYK document with PathItem content only.' });
    }
    if (result.transaction.state !== 'planned' && !result.plan.applyAllowed) {
        context.addIssue({ code: 'custom', message: 'A clip apply outcome requires an executable plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified') {
            context.addIssue({ code: 'custom', message: 'Applied clip requires a verified transaction.' });
            return;
        }
        const { group, mask, content, parentOrderAfter } = result.postcondition;
        const expectedOrder = result.plan.predicted.parentOrderAfter.map((uuid) => uuid ?? group.uuid);
        if ([result.plan.maskUuid, result.plan.contentUuid].includes(group.uuid) ||
            !sameCanonical(group.layerPath, result.plan.layer.layerPath) ||
            !sameCanonical(group.childOrder, result.plan.predicted.groupChildOrder) ||
            !sameMaskAfterCreate(result.plan.maskBefore, mask) ||
            !sameCanonical(content, expectedContentAfterCreate(result.plan.contentBefore)) ||
            !sameCanonical(parentOrderAfter, expectedOrder)) {
            context.addIssue({ code: 'custom', message: 'Verified clip must match the planned group structure, mask effect, and parent order.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified clip transaction must be applied.' });
    }
    if (result.transaction.state === 'rolled_back' &&
        (!sameCanonical(result.transaction.rollback.restoredMask, result.plan.maskBefore) ||
            !sameCanonical(result.transaction.rollback.restoredContent, result.plan.contentBefore) ||
            !sameCanonical(result.transaction.rollback.restoredParentOrder, result.plan.parentOrderBefore))) {
        context.addIssue({ code: 'custom', message: 'Rolled-back clip must prove exact mask, content, and order restoration.' });
    }
});
export const createClippingMaskResponseSchema = z.strictObject({
    outcome: createClippingMaskResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
export const CREATE_CLIPPING_MASK_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: CREATE_CLIPPING_MASK_OPERATION,
    policy: {
        version: 1,
        class: 'create',
        destructive: false,
        evidence: { identity: 'native_uuid', ownership: 'self_created_only', postcondition: 'created_state_matches_plan' },
        preconditions: { documentBinding: 'explicit_document_key', targetValidation: 'same_execution_before_apply' },
        confirmation: 'risk_scoped',
        recovery: { mode: 'remove_self_created_uuid', verification: 'native_uuid_absent', unknownIdentity: 'indeterminate' },
        terminal: { success: 'verified', failure: 'proven_pre_apply_or_verified_recovery', partialSuccess: 'nonterminal_until_reconciled' },
        replay: { requestBinding: 'canonical_request_digest', retry: 'return_attested_terminal_result', beforeTerminal: 'reconcile_required', reapplyOnRetry: false },
    },
    capabilities: {
        class: 'create', explicitDocumentBinding: true, validateTargetsBeforeApply: true,
        captureNativeUuid: true, verifyCreatedState: true, rollbackSelfCreatedUuidOnly: true,
        verifyRollbackAbsence: true, reconcileIndeterminate: true, durableTerminalReplay: true,
        trustedTerminalAttestationResolver: true,
    },
});
export const CREATE_CLIPPING_MASK_SAFETY_IDENTITY = canonicalDigest(CREATE_CLIPPING_MASK_SAFETY);
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    return bindOperationSafetyPlan({
        policyVersion: 1,
        operationClass: 'create',
        operationId: CREATE_CLIPPING_MASK_OPERATION,
        canonicalRequestDigest: requestDigest,
        evidence: {
            documentKey: admissionDocumentKey,
            targetLocator: `mask:${result.plan.maskUuid};content:${result.plan.contentUuid};layer:${result.plan.layer.layerPath.join('.')};order:${canonicalDigest(result.plan.parentOrderBefore)}`,
        },
        preconditions: {
            status: result.plan.applyAllowed ? 'satisfied' : 'blocked',
            targetsValidated: result.plan.applyBlockedReasonCodes.length === 0,
        },
        confirmation: { kind: 'risk_scoped', status: 'not_required' },
        applyAllowed: result.plan.applyAllowed,
    });
}
function safetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' || transaction.state === 'rollback_indeterminate') {
        throw new Error('Indeterminate clip results cannot be represented as terminal safety results.');
    }
    const common = {
        policyVersion: 1, operationClass: 'create', operationId: CREATE_CLIPPING_MASK_OPERATION,
        canonicalRequestDigest: requestDigest, planDigest: plan.planDigest, attestation,
    };
    const replay = { status: 'durable_terminal', action: 'return_attested_result', reapply: false };
    if (transaction.state === 'verified' && result.applied) {
        return operationSafetyResultSchema.parse({
            ...common,
            evidence: { nativeUuid: result.postcondition.group.uuid, ownership: 'self_created_only', postconditionVerified: true, outstandingEffect: null },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'succeeded', terminal: true, recovery: 'not_required', proof: { kind: 'verified_postcondition' }, replay },
        });
    }
    if (transaction.state === 'rolled_back') {
        return operationSafetyResultSchema.parse({
            ...common,
            evidence: { nativeUuid: transaction.rollback.groupUuid, ownership: 'self_created_only', postconditionVerified: false, outstandingEffect: null },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'recovered', terminal: true, recovery: 'verified', proof: { kind: 'verified_recovery' }, replay },
        });
    }
    if (transaction.state === 'rollback_failed') {
        return operationSafetyResultSchema.parse({
            ...common,
            evidence: {
                nativeUuid: transaction.rollback.groupUuid, ownership: 'self_created_only', postconditionVerified: false,
                outstandingEffect: { kind: 'native_uuid_still_present', nativeUuid: transaction.rollback.groupUuid },
            },
            executionEvidence: { outcome: 'recovery_failed' },
            resolution: {
                status: 'recovery_failed', terminal: true, recovery: 'failed', outstandingEffect: 'known_effect_present',
                proof: { kind: 'verified_outstanding_effect' }, replay,
            },
        });
    }
    return operationSafetyResultSchema.parse({
        ...common,
        evidence: { nativeUuid: null, ownership: 'self_created_only', postconditionVerified: false, outstandingEffect: null },
        executionEvidence: { outcome: 'proven_pre_apply' },
        resolution: { status: 'failed', terminal: true, recovery: 'not_required', proof: { kind: 'proven_pre_apply', mutationAttempted: false }, replay },
    });
}
async function assertSafety(value, requestDigest, attestation, resolver) {
    const result = createClippingMaskResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null)
        throw new Error('Clip terminal result requires a durable attestation resolver.');
    await assertOperationSafetyAdapterConformance({
        registration: CREATE_CLIPPING_MASK_SAFETY, plan, result: safetyResult(result, requestDigest, attestation, plan),
    }, resolver);
}
export const CREATE_CLIPPING_MASK_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}${CLIPPING_MASK_HOST_SCRIPT}
function createClipResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  if (params.maskUuid === params.contentUuid) throw clipUnsupported("same_target", params.maskUuid);
  var mask = clipResolve(document, params.maskUuid, ["PathItem"]);
  var content = clipResolve(document, params.contentUuid, ["PathItem", "GroupItem"]);
  var layer = mask.layer;
  if (!layer || String(layer.typename) !== "Layer" || mask.parent !== layer) throw clipUnsupported("parent_unmeasured", params.maskUuid);
  if (content.layer !== layer || content.parent !== layer) throw clipUnsupported("parent_unmeasured", params.contentUuid);
  var layerState = clipLayerState(document, layer, params.maskUuid);
  // CMYK paint is measured for a PathItem content only (CMYK-CLIP-CREATE); a nested clip content stays RGB-only.
  var admitCmyk = clipCmykScope(document, String(content.typename) === "PathItem");
  var maskBefore = clipPathSnapshot(document, mask, layer, admitCmyk);
  if (maskBefore.clipping) throw clipUnsupported("mask_already_clipping", params.maskUuid);
  var contentBefore;
  if (String(content.typename) === "PathItem") {
    contentBefore = clipPathSnapshot(document, content, layer, admitCmyk);
    if (contentBefore.clipping) throw clipUnsupported("content_is_clipping_path", params.contentUuid);
  } else {
    contentBefore = clipGroupSnapshot(document, content, layer, false, false);
    if (!clipIsMeasuredClipGroup(contentBefore)) throw clipUnsupported("content_group_unmeasured", params.contentUuid);
  }
  var parentOrder = supportedPathOrder(layer);
  var maskIndex = clipIndexOf(parentOrder, params.maskUuid);
  if (maskIndex < 0 || parentOrder[maskIndex + 1] !== params.contentUuid) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "CLIP_TARGETS_NOT_ADJACENT" }));
  }
  var blockers = [];
  clipCommonBlockers(context, layerState, blockers);
  clipItemBlockers(maskBefore, "mask_locked", "mask_hidden", blockers);
  clipItemBlockers(contentBefore, "content_locked", "content_hidden", blockers);
  clipEditableBlocker([mask, content], blockers);
  if (forApply && blockers.length > 0) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "CLIP_APPLY_BLOCKED", reasonCodes: blockers }));
  }
  return { context: context, document: document, layer: layer, layerState: layerState, mask: mask, content: content,
    admitCmyk: admitCmyk, maskBefore: maskBefore, contentBefore: contentBefore, parentOrderBefore: parentOrder, maskIndex: maskIndex, blockers: blockers };
}

function createClipPreflight(forApply) {
  var resolved = createClipResolve(forApply);
  if (forApply) {
    if (!supportedPathSame(resolved.maskBefore, params.expectedMaskBefore)) {
      throw mutationError("preflight_failed", "Mask state does not match expected_mask_before.");
    }
    if (!supportedPathSame(resolved.contentBefore, params.expectedContentBefore)) {
      throw mutationError("preflight_failed", "Content state does not match expected_content_before.");
    }
    if (!mutationSameSequence(resolved.parentOrderBefore, params.expectedParentOrder)) {
      throw mutationError("preflight_failed", "Parent order does not match expected_parent_order.");
    }
  }
  return resolved;
}

function createClipPredictedOrder(before, maskIndex, groupUuid) {
  var order = [];
  for (var index = 0; index < before.length; index++) {
    if (index === maskIndex) order.push(groupUuid);
    else if (index !== maskIndex + 1) order.push(before[index]);
  }
  return order;
}

function createClipPlan(preflight) {
  return {
    operation: "create_clipping_mask", documentKey: preflight.context.key,
    maskUuid: params.maskUuid, contentUuid: params.contentUuid, layer: preflight.layerState,
    maskBefore: preflight.maskBefore, contentBefore: preflight.contentBefore,
    parentOrderBefore: preflight.parentOrderBefore,
    predicted: {
      parentOrderAfter: createClipPredictedOrder(preflight.parentOrderBefore, preflight.maskIndex, null),
      groupChildOrder: [params.maskUuid, params.contentUuid],
      maskAppearanceAfter: { filled: false, fillColor: null, stroked: false, strokeColor: null, strokeWidth: null }
    },
    applyBlockedReasonCodes: preflight.blockers, applyAllowed: preflight.blockers.length === 0
  };
}

function createClipRevalidate(preflight, plan) {
  var current;
  try { current = createClipResolve(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Clip preconditions changed before apply.")); }
  if (current.document !== preflight.document || current.layer !== preflight.layer ||
      current.mask !== preflight.mask || current.content !== preflight.content ||
      !supportedPathSame(current.maskBefore, plan.maskBefore) || !supportedPathSame(current.contentBefore, plan.contentBefore) ||
      !mutationSameSequence(current.parentOrderBefore, plan.parentOrderBefore)) {
    throw mutationBeforeSideEffectError("Clip targets or complete parent order changed before apply.");
  }
}

function createClipApply(preflight, plan, state) {
  var mask = preflight.mask;
  // The measured inverse writes these host color objects back after the clip removed them (A35_CLIP_CREATE, RGB).
  // CMYK paint is kept as its raw channels and written back as a fresh CMYKColor, as CMYK-CLIP-CREATE measured.
  state.operationState.maskAppearance = { filled: mask.filled, fillColor: mask.filled ? createClipSavedColor(mask.fillColor) : null,
    stroked: mask.stroked, strokeColor: mask.stroked ? createClipSavedColor(mask.strokeColor) : null, strokeWidth: mask.stroked ? mask.strokeWidth : null };
  var group = preflight.layer.groupItems.add();
  state.operationState.createdGroup = group;
  if (!group || typeof group.uuid !== "string" || group.uuid.length === 0 ||
      group.uuid === params.maskUuid || group.uuid === params.contentUuid) {
    throw mutationError("apply_failed", "Illustrator did not return a distinct native UUID for the clip group.");
  }
  state.operationState.groupUuid = group.uuid;
  state.operationState.rollbackEvidence.groupUuid = group.uuid;
  group.move(mask, ElementPlacement.PLACEBEFORE);
  mask.move(group, ElementPlacement.PLACEATBEGINNING);
  preflight.content.move(group, ElementPlacement.PLACEATEND);
  mask.clipping = true;
  group.clipped = true;
  return group;
}

function createClipVerify(preflight, plan, state) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) {
    throw mutationError("verify_mismatch", "Active document changed during clip verification.");
  }
  var groupUuid = state.operationState.groupUuid;
  var group = clipTyped(preflight.document, "GroupItem", groupUuid);
  if (group === null || group !== state.operationState.createdGroup || group.parent !== preflight.layer) {
    throw mutationError("verify_mismatch", "Created clip group native identity does not match the plan.");
  }
  var snapshot = clipGroupSnapshot(preflight.document, group, preflight.layer, true, preflight.admitCmyk);
  if (snapshot.mask.uuid !== params.maskUuid || snapshot.content.uuid !== params.contentUuid ||
      snapshot.childOrder[0] !== params.maskUuid || snapshot.childOrder[1] !== params.contentUuid ||
      !snapshot.clipped || snapshot.locked || snapshot.hidden) {
    throw mutationError("verify_mismatch", "Clip group flags or child order do not match the plan.");
  }
  var expectedMask = {};
  for (var key in plan.maskBefore) if (plan.maskBefore.hasOwnProperty(key)) expectedMask[key] = plan.maskBefore[key];
  expectedMask.parentType = "GroupItem";
  expectedMask.clipping = true;
  expectedMask.filled = false; expectedMask.fillColor = null;
  expectedMask.stroked = false; expectedMask.strokeColor = null; expectedMask.strokeWidth = null;
  // The mask's visible bounds follow its removed stroke and are not predicted.
  expectedMask.visibleBounds = snapshot.mask.visibleBounds;
  var expectedContent = {};
  for (var contentKey in plan.contentBefore) if (plan.contentBefore.hasOwnProperty(contentKey)) expectedContent[contentKey] = plan.contentBefore[contentKey];
  expectedContent.parentType = "GroupItem";
  var parentOrderAfter = supportedPathOrder(preflight.layer);
  if (!supportedPathSame(snapshot.mask, expectedMask) || !supportedPathSame(snapshot.content, expectedContent) ||
      !mutationSameSequence(parentOrderAfter, createClipPredictedOrder(plan.parentOrderBefore, preflight.maskIndex, groupUuid))) {
    throw mutationError("verify_mismatch", "Clip mask effect, content state, or parent order does not match the plan.");
  }
  var layerInfo = supportedPathLayerChain(preflight.document, preflight.layer);
  return {
    group: { uuid: groupUuid, layerPath: layerInfo.path, geometricBounds: snapshot.geometricBounds,
      visibleBounds: snapshot.visibleBounds, clipped: true, locked: false, hidden: false, childOrder: snapshot.childOrder },
    mask: snapshot.mask, content: snapshot.content, parentOrderAfter: parentOrderAfter
  };
}

function createClipSavedColor(color) {
  if (String(color.typename) !== "CMYKColor") return color;
  return { cmyk: true, cyan: color.cyan, magenta: color.magenta, yellow: color.yellow, black: color.black };
}

function createClipWritableColor(saved) {
  if (saved.cmyk !== true) return saved;
  var color = new CMYKColor();
  color.cyan = saved.cyan; color.magenta = saved.magenta; color.yellow = saved.yellow; color.black = saved.black;
  return color;
}

function createClipRestoreAppearance(mask, saved) {
  mask.filled = saved.filled;
  if (saved.filled) mask.fillColor = createClipWritableColor(saved.fillColor);
  mask.stroked = saved.stroked;
  if (saved.stroked) { mask.strokeColor = createClipWritableColor(saved.strokeColor); mask.strokeWidth = saved.strokeWidth; }
}

function createClipVerifyRestored(state) {
  var preflight = state.preflight;
  var mask = clipTyped(preflight.document, "PathItem", params.maskUuid);
  var content = clipTyped(preflight.document, String(preflight.content.typename), params.contentUuid);
  if (mask !== preflight.mask || content !== preflight.content || mask.parent !== preflight.layer || content.parent !== preflight.layer) {
    return { status: "indeterminate", message: "Restored mask or content identity or parent is indeterminate." };
  }
  var restoredMask = clipPathSnapshot(preflight.document, mask, preflight.layer, preflight.admitCmyk);
  var restoredContent = String(content.typename) === "PathItem"
    ? clipPathSnapshot(preflight.document, content, preflight.layer, preflight.admitCmyk)
    : clipGroupSnapshot(preflight.document, content, preflight.layer, false, false);
  var restoredOrder = supportedPathOrder(preflight.layer);
  state.operationState.rollbackEvidence.restoredMask = restoredMask;
  state.operationState.rollbackEvidence.restoredContent = restoredContent;
  state.operationState.rollbackEvidence.restoredParentOrder = restoredOrder;
  if (!supportedPathSame(restoredMask, preflight.maskBefore) || !supportedPathSame(restoredContent, preflight.contentBefore) ||
      !mutationSameSequence(restoredOrder, preflight.parentOrderBefore)) {
    return { status: "indeterminate", message: "Exact mask, content, or parent-order restoration is unproved." };
  }
  return { status: "verified" };
}

function createClipRollback(state) {
  var preflight = state.preflight;
  var groupUuid = state.operationState.groupUuid;
  var groupReference = state.operationState.createdGroup;
  var savedAppearance = state.operationState.maskAppearance;
  if (!preflight || typeof groupUuid !== "string" || !groupReference || !savedAppearance ||
      app.documents.length === 0 || app.activeDocument !== preflight.document) {
    return { status: "indeterminate", message: "Rollback clip group identity or document is indeterminate." };
  }
  var group;
  try { group = supportedPathFind(preflight.document, groupUuid); }
  catch (error) { return { status: "indeterminate", message: "Rollback clip group lookup is indeterminate." }; }
  if (group === null) return { status: "indeterminate", message: "Rollback clip group is absent before recovery." };
  if (group !== groupReference || group.parent !== preflight.layer ||
      typeof group.locked !== "boolean" || typeof group.hidden !== "boolean") {
    return { status: "indeterminate", message: "Rollback refused because clip group identity changed." };
  }
  if (group.locked || group.hidden || preflight.layer.locked || !preflight.layer.visible) {
    return { status: "failed", message: "Rollback refused because the captured clip group is not safely editable." };
  }
  var targets = [preflight.mask, preflight.content];
  var targetUuids = [params.maskUuid, params.contentUuid];
  try {
    for (var childIndex = 0; childIndex < group.pageItems.length; childIndex++) {
      if (clipIndexOf(targetUuids, String(group.pageItems[childIndex].uuid)) < 0) {
        return { status: "indeterminate", message: "Rollback refused because the clip group contains an unexpected child." };
      }
    }
    for (var targetIndex = 0; targetIndex < targets.length; targetIndex++) {
      if (targets[targetIndex].uuid !== targetUuids[targetIndex] ||
          (targets[targetIndex].parent !== group && targets[targetIndex].parent !== preflight.layer)) {
        return { status: "indeterminate", message: "Rollback target identity or parent changed." };
      }
    }
  } catch (error) { return { status: "indeterminate", message: "Rollback target inspection is indeterminate." }; }
  // Measured inverse (A35_CLIP_CREATE): unset both flags, move both back in order, remove the group, write the
  // captured appearance back.
  try {
    if (group.clipped) group.clipped = false;
    if (preflight.mask.clipping) preflight.mask.clipping = false;
    for (var restoreIndex = 0; restoreIndex < targets.length; restoreIndex++) {
      if (targets[restoreIndex].parent === group) targets[restoreIndex].move(group, ElementPlacement.PLACEBEFORE);
    }
  } catch (error) { return { status: "indeterminate", message: "Rollback clip restoration write is indeterminate." }; }
  if (group.pageItems.length !== 0) return { status: "indeterminate", message: "Rollback clip group is not empty after restoration." };
  var removeThrew = false;
  try { group.remove(); }
  catch (error) { removeThrew = true; }
  var remaining;
  try { remaining = supportedPathFind(preflight.document, groupUuid); }
  catch (error) { return { status: "indeterminate", message: "Rollback clip group absence verification is indeterminate." }; }
  if (remaining !== null) {
    if (remaining === groupReference && remaining.uuid === groupUuid) {
      return { status: "failed", message: removeThrew
        ? "Rollback clip group removal threw before removing the captured group."
        : "Rollback clip group removal did not remove the captured group." };
    }
    return { status: "indeterminate", message: "Rollback clip group UUID resolved to an unexpected identity." };
  }
  try {
    if (clipReferenceState(groupReference, groupUuid) !== "invalid") {
      return { status: "indeterminate", message: "Clip group UUID is absent but its captured reference remains valid." };
    }
    createClipRestoreAppearance(preflight.mask, savedAppearance);
    return createClipVerifyRestored(state);
  } catch (error) { return { status: "indeterminate", message: "Rollback clip restoration verification is indeterminate." }; }
}

var createClipExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionLayers: function (phase, preflight) { return [preflight.layer]; },
  editSessionAffected: function (phase, preflight, plan, state) { var uuids = [params.maskUuid, params.contentUuid]; if (phase === "after") uuids.push(state.operationState.groupUuid); return uuids; },
  initialOperationState: function () {
    return { createdGroup: null, groupUuid: null, maskAppearance: null,
      rollbackEvidence: { groupUuid: null, restoredMask: null, restoredContent: null, restoredParentOrder: null } };
  },
  preflight: createClipPreflight,
  plan: createClipPlan,
  revalidate: createClipRevalidate,
  applyMutation: createClipApply,
  verify: createClipVerify,
  rollback: createClipRollback,
  hasMutationEvidence: function (state) {
    return state.operationState.createdGroup !== null && state.operationState.createdGroup !== undefined;
  },
  applyIndeterminate: function (state) {
    return { reasonCode: "identity_unavailable",
      message: "Clip apply outcome is indeterminate because created-group identity is unavailable.",
      evidence: { groupUuid: null, restoredMask: null, restoredContent: null, restoredParentOrder: null } };
  },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var createClipDocument = createClipExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === createClipExecution.preflight.document) createClipDocument = getDocumentContext();
var result = {
  operation: "create_clipping_mask", applied: createClipExecution.transaction.state === "verified",
  document: createClipDocument, plan: createClipExecution.plan, transaction: createClipExecution.transaction
};
if (createClipExecution.transaction.state === "verified") result.postcondition = createClipExecution.value;
`;
export const CREATE_CLIPPING_MASK_HOST_SCRIPT_DIGEST = canonicalSha256(CREATE_CLIPPING_MASK_SCRIPT);
export const CREATE_CLIPPING_MASK_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2,
    contractVersion: 1,
    operation: CREATE_CLIPPING_MASK_OPERATION,
    validator: CREATE_CLIPPING_MASK_VALIDATOR,
    canonicalContractVersion: CANONICAL_VERSION,
    resultSchemaVersion: RESULT_SCHEMA_VERSION,
    terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION,
    errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: CREATE_CLIPPING_MASK_SAFETY_IDENTITY,
    hostScriptDigest: CREATE_CLIPPING_MASK_HOST_SCRIPT_DIGEST,
    mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    const digestRequest = 'commandId' in request ? (({ commandId: _commandId, ...rest }) => rest)(request) : request;
    const digest = canonicalSha256({
        operation: CREATE_CLIPPING_MASK_OPERATION, validator: CREATE_CLIPPING_MASK_VALIDATOR, request: digestRequest,
    });
    return {
        intent: request.apply ? 'apply' : 'plan', request,
        commandId: 'commandId' in request ? request.commandId : null,
        documentKey: request.expectedDocumentKey, digest,
    };
}
export const createClippingMaskToolContract = {
    name: 'illustrator_create_clipping_mask',
    title: 'Plan or Create Clipping Mask',
    description: 'Plan or make one PathItem (mask_uuid) the clipping path of one content item (content_uuid): a PathItem, or one existing clip group for a nested clip. Measured profile only: both items directly on the same top-level layer of an RGB document, the mask directly in front of the content, RGB or no paint, Illustrator 30.8.1 in the foreground; PlacedItem, CompoundPathItem, text, sublayers, and other shapes are refused. The plan shows the resulting group [mask, content] at the mask\'s z-order slot and that Illustrator removes the mask\'s fill and stroke. Locked or hidden targets and layers are refused by this tool (Illustrator itself does not refuse them). Apply compares expected_mask_before, expected_content_before, and expected_parent_order, verifies the group, flags, mask effect, and parent order by native read-back, and on failure unclips, moves both items back, removes only the created group, and writes the mask\'s fill and stroke back.',
    inputSchema,
    publicInputSchema: createClippingMaskPublicInputSchema,
    outputSchema: createClippingMaskResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(CREATE_CLIPPING_MASK_SAFETY.policy),
    normalizePublicInput,
};
export function mapClipExecutionError(error, detail) {
    if (detail?.code === 'OBJECT_NOT_FOUND') {
        return new Error(`No PageItem with UUID ${JSON.stringify(detail.uuid ?? '')} exists in the bound document.`);
    }
    if (detail?.code === 'CLIP_UNSUPPORTED_TARGET') {
        return new Error(`Clipping mask target ${JSON.stringify(detail.uuid ?? '')} is outside the measured support profile (${detail.reason ?? 'unknown'}).${detail.reason === 'color_model_unmeasured' ? ' Supported paint is RGB, or process CMYK on the mask and a path content in a CMYK document; CMYK inside a nested clip, CMYK in an RGB document, Gray, and Spot are not supported yet.' : ''}`);
    }
    if (detail?.code === 'CLIP_TARGETS_NOT_ADJACENT') {
        return new Error('The mask must sit directly in front of the content in the same layer.');
    }
    if (detail?.code === 'CLIP_APPLY_BLOCKED') {
        return new Error(`Clipping mask apply is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}.`);
    }
    return error instanceof Error ? error : new Error(String(error));
}
export function createCreateClippingMaskAdapter() {
    return {
        version: 1,
        operation: CREATE_CLIPPING_MASK_OPERATION,
        validator: CREATE_CLIPPING_MASK_VALIDATOR,
        safety: CREATE_CLIPPING_MASK_SAFETY,
        safetyRegistrationIdentity: CREATE_CLIPPING_MASK_SAFETY_IDENTITY,
        adapterIdentity: CREATE_CLIPPING_MASK_ADAPTER_IDENTITY,
        tool: createClippingMaskToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: createClippingMaskResultSchema,
        resultSchemaVersion: RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: CLASSIFIER_VERSION,
        safetyConformanceVersion: CONFORMANCE_VERSION,
        errorMappingVersion: ERROR_MAPPING_VERSION,
        hostScriptDigest: CREATE_CLIPPING_MASK_HOST_SCRIPT_DIGEST,
        mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: CREATE_CLIPPING_MASK_SCRIPT, params };
            return {
                kind: 'mutation', mutationValidator: CREATE_CLIPPING_MASK_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: CREATE_CLIPPING_MASK_OPERATION,
                    documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: CREATE_CLIPPING_MASK_ADAPTER_IDENTITY,
                mutationHostApplicationMode: 'foreground',
                script: CREATE_CLIPPING_MASK_SCRIPT,
                params,
            };
        },
        classifyTerminal(value) {
            const state = createClippingMaskResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back' || state === 'rollback_failed')
                return { state };
            if (state === 'planned')
                throw new Error('Clip plan is not a terminal mutation result.');
            throw new Error('Unverified clip identity or recovery must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError: mapClipExecutionError,
    };
}
