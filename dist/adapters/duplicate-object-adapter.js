import { z } from 'zod';
import { supportedPathCmykPaintSchema } from './supported-path-item-host-script.js';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { boundsSchema, documentContextSchema, layerPathSchema, mutationAuditSchema, } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
export const DUPLICATE_OBJECT_OPERATION = 'duplicate_object';
export const DUPLICATE_OBJECT_VALIDATOR = { kind: DUPLICATE_OBJECT_OPERATION, version: 1 };
export const DUPLICATE_MAX_PATH_POINTS = 256;
export const DUPLICATE_MAX_PARENT_ITEMS = 128;
const DUPLICATE_CANONICAL_VERSION = 1;
const DUPLICATE_RESULT_SCHEMA_VERSION = 1;
const DUPLICATE_CLASSIFIER_VERSION = 1;
const DUPLICATE_CONFORMANCE_VERSION = 1;
const DUPLICATE_ERROR_MAPPING_VERSION = 1;
const canonicalNumberSchema = z.number().finite().overwrite((value) => Object.is(value, -0) ? 0 : value);
const pointSchema = z.tuple([canonicalNumberSchema, canonicalNumberSchema]);
const rgbSchema = z.strictObject({
    type: z.literal('RGBColor'),
    red: canonicalNumberSchema,
    green: canonicalNumberSchema,
    blue: canonicalNumberSchema,
});
const pathPointSchema = z.strictObject({
    anchor: pointSchema,
    leftDirection: pointSchema,
    rightDirection: pointSchema,
    pointType: z.enum(['PointType.CORNER', 'PointType.SMOOTH']),
});
const parentOrderSchema = z.array(z.string().min(1).max(255)).min(1).max(DUPLICATE_MAX_PARENT_ITEMS)
    .superRefine((order, context) => {
    if (new Set(order).size !== order.length) {
        context.addIssue({ code: 'custom', message: 'Parent order must contain unique native UUIDs.' });
    }
});
export const duplicateObjectSnapshotShape = {
    uuid: z.string().min(1).max(255),
    type: z.literal('PathItem'),
    name: z.string().max(255),
    layerPath: layerPathSchema,
    geometricBounds: boundsSchema,
    controlBounds: boundsSchema,
    visibleBounds: boundsSchema,
    position: pointSchema,
    width: canonicalNumberSchema.nonnegative(),
    height: canonicalNumberSchema.nonnegative(),
    closed: z.boolean(),
    pathPoints: z.array(pathPointSchema).min(1).max(DUPLICATE_MAX_PATH_POINTS),
    filled: z.boolean(),
    fillColor: rgbSchema.nullable(),
    fillOverprint: z.boolean(),
    stroked: z.boolean(),
    strokeColor: rgbSchema.nullable(),
    strokeWidth: canonicalNumberSchema.nonnegative().nullable(),
    strokeOverprint: z.boolean(),
    strokeDashes: z.array(canonicalNumberSchema.nonnegative()).max(32),
    strokeDashOffset: canonicalNumberSchema,
    strokeCap: z.enum(['StrokeCap.BUTTENDCAP', 'StrokeCap.ROUNDENDCAP', 'StrokeCap.PROJECTINGENDCAP']),
    strokeJoin: z.enum(['StrokeJoin.BEVELENDJOIN', 'StrokeJoin.ROUNDENDJOIN', 'StrokeJoin.MITERENDJOIN']),
    strokeMiterLimit: canonicalNumberSchema.nonnegative(),
    evenodd: z.boolean(),
    polarity: z.literal('PolarityValues.POSITIVE'),
    resolution: canonicalNumberSchema.positive(),
    artworkKnockout: z.literal('KnockoutState.DISABLED'),
    blendingMode: z.literal('BlendModes.NORMAL'),
    opacity: canonicalNumberSchema.min(0).max(100),
    pixelAligned: z.boolean(),
    noteEmpty: z.literal(true),
    tagsEmpty: z.literal(true),
    urlEmpty: z.literal(true),
    visibilityVariableAbsent: z.literal(true),
    wrapped: z.literal(false),
    clipping: z.literal(false),
    guides: z.literal(false),
    sliced: z.literal(false),
    isolated: z.literal(false),
    locked: z.boolean(),
    hidden: z.boolean(),
    editable: z.boolean(),
    layerVisible: z.boolean(),
    layerLocked: z.boolean(),
    effectiveLayerVisible: z.boolean(),
    effectiveLayerLocked: z.boolean(),
};
export function refineDuplicateObjectSnapshot(snapshot, context) {
    if (snapshot.filled !== (snapshot.fillColor !== null)) {
        context.addIssue({ code: 'custom', message: 'fillColor must be present exactly when filled is true.' });
    }
    if (snapshot.stroked !== (snapshot.strokeColor !== null && snapshot.strokeWidth !== null)) {
        context.addIssue({ code: 'custom', message: 'Stroke color and width must be present exactly when stroked is true.' });
    }
    if (snapshot.effectiveLayerVisible && !snapshot.layerVisible) {
        context.addIssue({ code: 'custom', message: 'An effectively visible layer must itself be visible.' });
    }
    if (snapshot.layerLocked && !snapshot.effectiveLayerLocked) {
        context.addIssue({ code: 'custom', message: 'A locked layer must be effectively locked.' });
    }
}
export const duplicateObjectSnapshotSchema = z.strictObject({
    ...duplicateObjectSnapshotShape,
    fillColor: z.union([rgbSchema, supportedPathCmykPaintSchema]).nullable(),
    strokeColor: z.union([rgbSchema, supportedPathCmykPaintSchema]).nullable(),
})
    .superRefine(refineDuplicateObjectSnapshot);
function snapshotWithoutUuid(snapshot) {
    return { ...snapshot, uuid: 'duplicate-native-uuid' };
}
function snapshotsEqualExceptUuid(left, right) {
    return canonicalSha256(snapshotWithoutUuid(left)) === canonicalSha256(snapshotWithoutUuid(right));
}
function insertedAfter(order, sourceUuid, duplicateUuid) {
    const sourceIndex = order.indexOf(sourceUuid);
    if (sourceIndex < 0 || order.lastIndexOf(sourceUuid) !== sourceIndex) {
        throw new Error('Source UUID must occur exactly once in the complete parent order.');
    }
    return [...order.slice(0, sourceIndex + 1), duplicateUuid, ...order.slice(sourceIndex + 1)];
}
const commonInternalFields = {
    expectedDocumentKey: z.string().min(1).max(16_384),
    sourceUuid: z.string().min(1).max(255),
    placement: z.literal('after_source'),
};
const duplicateObjectInternalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternalFields, apply: z.literal(false) }),
    z.strictObject({
        ...commonInternalFields,
        expectedBefore: duplicateObjectSnapshotSchema,
        expectedParentOrder: parentOrderSchema,
        apply: z.literal(true),
        commandId: canonicalCommandIdSchema,
    }),
]);
const commonPublicFields = {
    expected_document_key: z.string().min(1).max(16_384),
    source_uuid: z.string().min(1).max(255),
    placement: z.literal('after_source'),
};
export const duplicateObjectPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublicFields, apply: z.literal(false).default(false) }),
    z.strictObject({
        ...commonPublicFields,
        expected_before: duplicateObjectSnapshotSchema,
        expected_parent_order: parentOrderSchema,
        apply: z.literal(true),
        command_id: applyCommandIdSchema,
    }),
]);
const duplicateObjectInputSchema = z.strictObject({
    ...commonPublicFields,
    expected_before: duplicateObjectSnapshotSchema.optional(),
    expected_parent_order: parentOrderSchema.optional(),
    apply: z.boolean().default(false),
    command_id: applyCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(duplicateObjectPublicInputSchema, { io: 'input' });
duplicateObjectInputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = duplicateObjectPublicInputSchema.parse(input);
    const common = {
        expectedDocumentKey: value.expected_document_key,
        sourceUuid: value.source_uuid,
        placement: value.placement,
    };
    return value.apply
        ? {
            ...common,
            expectedBefore: value.expected_before,
            expectedParentOrder: value.expected_parent_order,
            apply: true,
            commandId: value.command_id,
        }
        : { ...common, apply: false };
}
const blockerSchema = z.enum([
    'document_mutation_not_allowed',
    'target_locked',
    'target_hidden',
    'target_not_editable',
    'layer_hidden',
    'ancestor_hidden',
    'layer_locked',
    'ancestor_locked',
    'result_size_limit_exceeded',
]);
const duplicatePlanSchema = z.strictObject({
    operation: z.literal(DUPLICATE_OBJECT_OPERATION),
    documentKey: z.string().min(1).max(16_384),
    sourceUuid: z.string().min(1).max(255),
    placement: z.literal('after_source'),
    sourceBefore: duplicateObjectSnapshotSchema,
    parentOrderBefore: parentOrderSchema,
    sourceIndex: z.number().int().nonnegative().max(DUPLICATE_MAX_PARENT_ITEMS - 1),
    resultSizeWithinLimit: z.boolean(),
    applyBlockedReasonCodes: z.array(blockerSchema),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    if (plan.sourceUuid !== plan.sourceBefore.uuid || plan.parentOrderBefore[plan.sourceIndex] !== plan.sourceUuid ||
        plan.parentOrderBefore.indexOf(plan.sourceUuid) !== plan.parentOrderBefore.lastIndexOf(plan.sourceUuid)) {
        context.addIssue({ code: 'custom', message: 'Duplicate plan source identity must bind the complete parent order.' });
    }
    if (plan.applyAllowed !== (plan.applyBlockedReasonCodes.length === 0)) {
        context.addIssue({ code: 'custom', message: 'Duplicate applyAllowed must exactly reflect blockers.' });
    }
    if (plan.resultSizeWithinLimit === plan.applyBlockedReasonCodes.includes('result_size_limit_exceeded')) {
        context.addIssue({ code: 'custom', message: 'Duplicate result-size admission must match its blocker.' });
    }
});
const applyFailureSchema = z.strictObject({
    phase: z.literal('apply'),
    reasonCode: z.literal('apply_failed'),
    message: z.string().min(1).max(500),
});
const verifyFailureSchema = z.strictObject({
    phase: z.literal('verify'),
    reasonCode: z.literal('verify_mismatch'),
    message: z.string().min(1).max(500),
});
const indeterminateFailureSchema = z.strictObject({
    phase: z.literal('apply'),
    reasonCode: z.literal('apply_indeterminate'),
    message: z.string().min(1).max(500),
});
const duplicateTransactionSchema = z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('planned'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('verified'), audit: mutationAuditSchema }),
    z.strictObject({
        state: z.literal('apply_failed'),
        failure: applyFailureSchema,
        rollback: z.strictObject({ status: z.literal('not_required') }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rolled_back'),
        failure: z.discriminatedUnion('phase', [applyFailureSchema, verifyFailureSchema]),
        rollback: z.strictObject({
            status: z.literal('verified'),
            duplicateUuid: z.string().min(1).max(255),
            restoredSource: duplicateObjectSnapshotSchema,
            restoredParentOrder: parentOrderSchema,
        }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rollback_failed'),
        failure: z.discriminatedUnion('phase', [applyFailureSchema, verifyFailureSchema]),
        rollback: z.strictObject({
            status: z.literal('failed'),
            reasonCode: z.literal('rollback_failed'),
            message: z.string().min(1).max(500),
            duplicateUuid: z.string().min(1).max(255),
            restoredSource: duplicateObjectSnapshotSchema.nullable(),
            restoredParentOrder: parentOrderSchema.nullable(),
        }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('apply_indeterminate'),
        failure: indeterminateFailureSchema,
        rollback: z.strictObject({
            status: z.literal('indeterminate'),
            reasonCode: z.literal('identity_unavailable'),
            message: z.string().min(1).max(500),
            duplicateUuid: z.null(),
            restoredSource: z.null(),
            restoredParentOrder: z.null(),
        }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rollback_indeterminate'),
        failure: z.discriminatedUnion('phase', [applyFailureSchema, verifyFailureSchema]),
        rollback: z.strictObject({
            status: z.literal('indeterminate'),
            reasonCode: z.literal('rollback_indeterminate'),
            message: z.string().min(1).max(500),
            duplicateUuid: z.string().min(1).max(255).nullable(),
            restoredSource: duplicateObjectSnapshotSchema.nullable(),
            restoredParentOrder: parentOrderSchema.nullable(),
        }),
        audit: mutationAuditSchema,
    }),
]).superRefine((transaction, context) => {
    const prefix = [
        'preflight:started:',
        'preflight:succeeded:',
        'plan:started:',
        'plan:succeeded:',
    ];
    let expected;
    if (transaction.state === 'planned') {
        expected = [...prefix, 'apply:skipped:not_requested', 'verify:skipped:not_requested',
            'rollback:skipped:not_requested'];
    }
    else if (transaction.state === 'verified') {
        expected = [...prefix, 'apply:started:', 'apply:attempted:', 'apply:succeeded:',
            'verify:started:', 'verify:succeeded:', 'rollback:skipped:not_required'];
    }
    else if (transaction.state === 'apply_failed') {
        expected = [...prefix, 'apply:started:', 'apply:failed:apply_failed',
            'verify:skipped:not_required', 'rollback:skipped:not_required'];
    }
    else if (transaction.state === 'apply_indeterminate') {
        expected = [...prefix, 'apply:started:', 'apply:attempted:', 'apply:failed:apply_indeterminate'];
    }
    else {
        const failure = transaction.failure.phase === 'apply'
            ? ['apply:started:', 'apply:attempted:', 'apply:failed:apply_failed', 'verify:skipped:not_required']
            : ['apply:started:', 'apply:attempted:', 'apply:succeeded:', 'verify:started:',
                'verify:failed:verify_mismatch'];
        expected = [...prefix, ...failure, 'rollback:started:', transaction.state === 'rolled_back'
                ? 'rollback:succeeded:'
                : `rollback:failed:${transaction.state === 'rollback_failed' ? 'rollback_failed' : 'rollback_indeterminate'}`];
    }
    const actual = transaction.audit.map((event) => `${event.phase}:${event.event}:${'reasonCode' in event ? event.reasonCode : ''}`);
    if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
        context.addIssue({ code: 'custom', message: 'Duplicate audit sequence does not match transaction state.' });
    }
    transaction.audit.forEach((event, index) => {
        if (event.sequence !== index) {
            context.addIssue({ code: 'custom', message: 'Duplicate audit sequence numbers must be contiguous.', path: ['audit', index] });
        }
    });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' &&
            event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode &&
            event.message === transaction.failure.message);
        if (matches.length !== 1) {
            context.addIssue({ code: 'custom', message: 'Duplicate failure summary must match one audit event.' });
        }
    }
    if (transaction.state === 'rollback_failed' || transaction.state === 'rollback_indeterminate') {
        const matches = transaction.audit.filter((event) => event.event === 'failed' && event.phase === 'rollback' &&
            event.reasonCode === transaction.rollback.reasonCode && event.message === transaction.rollback.message);
        if (matches.length !== 1) {
            context.addIssue({ code: 'custom', message: 'Duplicate rollback summary must match one audit event.' });
        }
    }
    if (transaction.state === 'apply_indeterminate' && transaction.rollback.message !== transaction.failure.message) {
        context.addIssue({ code: 'custom', message: 'Duplicate indeterminate summaries must match.' });
    }
});
const duplicatePostconditionSchema = z.strictObject({
    sourceUuid: z.string().min(1).max(255),
    duplicate: duplicateObjectSnapshotSchema,
    parentOrderAfter: parentOrderSchema,
});
export const duplicateObjectResultSchema = z.union([
    z.strictObject({
        operation: z.literal(DUPLICATE_OBJECT_OPERATION),
        applied: z.literal(false),
        document: documentContextSchema,
        plan: duplicatePlanSchema,
        transaction: duplicateTransactionSchema,
    }),
    z.strictObject({
        operation: z.literal(DUPLICATE_OBJECT_OPERATION),
        applied: z.literal(true),
        document: documentContextSchema,
        plan: duplicatePlanSchema,
        postcondition: duplicatePostconditionSchema,
        transaction: duplicateTransactionSchema,
    }),
]).superRefine((result, context) => {
    if (result.transaction.state !== 'planned' && !result.plan.applyAllowed) {
        context.addIssue({ code: 'custom', message: 'A duplicate apply outcome requires an executable plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified') {
            context.addIssue({ code: 'custom', message: 'Applied duplicate requires a verified transaction.' });
            return;
        }
        if (result.postcondition.sourceUuid !== result.plan.sourceUuid) {
            context.addIssue({ code: 'custom', message: 'Verified duplicate must bind the source native UUID.' });
        }
        if (result.postcondition.duplicate.uuid === result.plan.sourceUuid ||
            !snapshotsEqualExceptUuid(result.postcondition.duplicate, result.plan.sourceBefore)) {
            context.addIssue({ code: 'custom', message: 'Verified duplicate must match the source except for native UUID.' });
        }
        const expectedOrder = insertedAfter(result.plan.parentOrderBefore, result.plan.sourceUuid, result.postcondition.duplicate.uuid);
        if (canonicalSha256(expectedOrder) !==
            canonicalSha256(result.postcondition.parentOrderAfter)) {
            context.addIssue({ code: 'custom', message: 'Verified duplicate must be immediately after its source.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified duplicate transaction must be applied.' });
    }
    if (result.transaction.state === 'rolled_back') {
        const rollback = result.transaction.rollback;
        if (canonicalSha256(rollback.restoredSource) !==
            canonicalSha256(result.plan.sourceBefore) ||
            canonicalSha256(rollback.restoredParentOrder) !==
                canonicalSha256(result.plan.parentOrderBefore)) {
            context.addIssue({ code: 'custom', message: 'Rolled-back duplicate must prove exact source and order restoration.' });
        }
    }
});
const finalizedAtSchema = z.string().datetime({ offset: true });
export const duplicateObjectResponseSchema = z.strictObject({
    outcome: duplicateObjectResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: finalizedAtSchema }),
});
export const DUPLICATE_OBJECT_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: DUPLICATE_OBJECT_OPERATION,
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
        class: 'create',
        explicitDocumentBinding: true,
        validateTargetsBeforeApply: true,
        captureNativeUuid: true,
        verifyCreatedState: true,
        rollbackSelfCreatedUuidOnly: true,
        verifyRollbackAbsence: true,
        reconcileIndeterminate: true,
        durableTerminalReplay: true,
        trustedTerminalAttestationResolver: true,
    },
});
export const DUPLICATE_OBJECT_SAFETY_IDENTITY = canonicalDigest(DUPLICATE_OBJECT_SAFETY);
function duplicateSafetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    return bindOperationSafetyPlan({
        policyVersion: 1,
        operationClass: 'create',
        operationId: DUPLICATE_OBJECT_OPERATION,
        canonicalRequestDigest: requestDigest,
        evidence: {
            documentKey: admissionDocumentKey,
            targetLocator: `source:${result.plan.sourceUuid};layer:${result.plan.sourceBefore.layerPath.join('.')};order:${canonicalDigest(result.plan.parentOrderBefore)}`,
        },
        preconditions: {
            status: result.plan.applyAllowed ? 'satisfied' : 'blocked',
            targetsValidated: result.plan.applyBlockedReasonCodes.length === 0,
        },
        confirmation: { kind: 'risk_scoped', status: 'not_required' },
        applyAllowed: result.plan.applyAllowed,
    });
}
function duplicateSafetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' ||
        transaction.state === 'rollback_indeterminate') {
        throw new Error('Indeterminate duplicate results cannot be represented as terminal safety results.');
    }
    const common = {
        policyVersion: 1,
        operationClass: 'create',
        operationId: DUPLICATE_OBJECT_OPERATION,
        canonicalRequestDigest: requestDigest,
        planDigest: plan.planDigest,
        attestation,
    };
    if (transaction.state === 'verified' && result.applied) {
        return operationSafetyResultSchema.parse({
            ...common,
            evidence: {
                nativeUuid: result.postcondition.duplicate.uuid,
                ownership: 'self_created_only',
                postconditionVerified: true,
                outstandingEffect: null,
            },
            executionEvidence: { outcome: 'completed' },
            resolution: {
                status: 'succeeded', terminal: true, recovery: 'not_required',
                proof: { kind: 'verified_postcondition' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false },
            },
        });
    }
    if (transaction.state === 'rolled_back') {
        return operationSafetyResultSchema.parse({
            ...common,
            evidence: {
                nativeUuid: transaction.rollback.duplicateUuid,
                ownership: 'self_created_only',
                postconditionVerified: false,
                outstandingEffect: null,
            },
            executionEvidence: { outcome: 'completed' },
            resolution: {
                status: 'recovered', terminal: true, recovery: 'verified',
                proof: { kind: 'verified_recovery' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false },
            },
        });
    }
    if (transaction.state === 'rollback_failed') {
        return operationSafetyResultSchema.parse({
            ...common,
            evidence: {
                nativeUuid: transaction.rollback.duplicateUuid,
                ownership: 'self_created_only',
                postconditionVerified: false,
                outstandingEffect: transaction.rollback.duplicateUuid === null ? null : {
                    kind: 'native_uuid_still_present', nativeUuid: transaction.rollback.duplicateUuid,
                },
            },
            executionEvidence: { outcome: 'recovery_failed' },
            resolution: {
                status: 'recovery_failed', terminal: true, recovery: 'failed',
                outstandingEffect: 'known_effect_present',
                proof: { kind: 'verified_outstanding_effect' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false },
            },
        });
    }
    return operationSafetyResultSchema.parse({
        ...common,
        evidence: {
            nativeUuid: null,
            ownership: 'self_created_only',
            postconditionVerified: false,
            outstandingEffect: null,
        },
        executionEvidence: { outcome: 'proven_pre_apply' },
        resolution: {
            status: 'failed', terminal: true, recovery: 'not_required',
            proof: { kind: 'proven_pre_apply', mutationAttempted: false },
            replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false },
        },
    });
}
async function assertDuplicateSafetyConformance(value, requestDigest, attestation, resolver) {
    const result = duplicateObjectResultSchema.parse(value);
    const plan = duplicateSafetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null) {
        throw new Error('Duplicate terminal result requires a durable attestation resolver.');
    }
    await assertOperationSafetyAdapterConformance({
        registration: DUPLICATE_OBJECT_SAFETY,
        plan,
        result: duplicateSafetyResult(result, requestDigest, attestation, plan),
    }, resolver);
}
export const DUPLICATE_OBJECT_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
var DUPLICATE_MAX_PATH_POINTS = ${DUPLICATE_MAX_PATH_POINTS};
var DUPLICATE_MAX_PARENT_ITEMS = ${DUPLICATE_MAX_PARENT_ITEMS};
var DUPLICATE_SNAPSHOT_MAX_BYTES = 65536;
var DUPLICATE_ORDER_MAX_BYTES = 32768;
var DUPLICATE_CONTEXT_MAX_BYTES = 24576;

function duplicateUtf8ByteLength(value) {
  var bytes = 0;
  for (var index = 0; index < value.length; index++) {
    var code = value.charCodeAt(index);
    if (code <= 0x7F) bytes += 1;
    else if (code <= 0x7FF) bytes += 2;
    else if (code >= 0xD800 && code <= 0xDBFF && index + 1 < value.length) {
      var low = value.charCodeAt(index + 1);
      if (low >= 0xDC00 && low <= 0xDFFF) { bytes += 4; index++; }
      else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

function duplicateFindTarget(document, uuid) {
  if (typeof document.getPageItemFromUuid !== "function") {
    throw mutationError("preflight_failed", "Illustrator native UUID lookup is unavailable.");
  }
  try {
    var target = document.getPageItemFromUuid(uuid);
    if (target === null || target === undefined) return null;
    return target;
  } catch (lookupError) {
    var message = lookupError && lookupError.message ? String(lookupError.message) : "";
    if (lookupError && lookupError.name === "Error" && lookupError.number === 1200 &&
        message === "an Illustrator error occurred: 1346458189 ('MRAP')") return null;
    throw lookupError;
  }
}

function duplicateLayerChain(document, targetLayer) {
  function visit(layers, prefix, ancestors) {
    for (var index = 0; index < layers.length; index++) {
      var layer = layers[index];
      var path = prefix.concat([index]);
      var chain = ancestors.concat([layer]);
      if (layer === targetLayer) return { path: path, chain: chain };
      if (path.length < 64 && layer.layers && layer.layers.length > 0) {
        var nested = visit(layer.layers, path, chain);
        if (nested !== null) return nested;
      }
    }
    return null;
  }
  return visit(document.layers, [], []);
}

function duplicateNumber(value, name) {
  var rounded = Number(mutationFiniteNumber(value, name).toFixed(12));
  return rounded === 0 ? 0 : rounded;
}

function duplicatePoint(value, name) {
  if (!value || value.length !== 2) throw mutationError("preflight_failed", name + " is unavailable.");
  return [duplicateNumber(value[0], name + "[0]"), duplicateNumber(value[1], name + "[1]")];
}

function duplicateBounds(value, name) {
  if (!value || value.length !== 4) throw mutationError("preflight_failed", name + " is unavailable.");
  return [duplicateNumber(value[0], name + "[0]"), duplicateNumber(value[1], name + "[1]"),
    duplicateNumber(value[2], name + "[2]"), duplicateNumber(value[3], name + "[3]")];
}

function duplicateProcessColor(value, name, document) {
  if (value && String(value.typename) === "CMYKColor") {
    if (document.documentColorSpace !== DocumentColorSpace.CMYK) {
      throw mutationError("preflight_failed", name + " supports CMYKColor only in a CMYK document.");
    }
    function channel(value, label) {
      var number = duplicateNumber(value, label);
      if (number < 0 || number > 100) throw mutationError("preflight_failed", label + " is outside 0..100.");
      return Math.round(number * 100000) / 100000;
    }
    return { type: "CMYKColor", cyan: channel(value.cyan, name + ".cyan"),
      magenta: channel(value.magenta, name + ".magenta"), yellow: channel(value.yellow, name + ".yellow"),
      black: channel(value.black, name + ".black") };
  }
  if (!value || String(value.typename) !== "RGBColor") {
    throw mutationError("preflight_failed", name + " supports RGBColor only.");
  }
  return { type: "RGBColor", red: duplicateNumber(value.red, name + ".red"),
    green: duplicateNumber(value.green, name + ".green"), blue: duplicateNumber(value.blue, name + ".blue") };
}

function duplicateSnapshot(document, target, expectedUuid) {
  if (!target || target.typename !== "PathItem" || target.parent.typename !== "Layer") {
    throw mutationError("preflight_failed", "Duplicate v1 supports layer-direct PathItem targets only.");
  }
  if (typeof target.uuid !== "string" || target.uuid.length === 0 ||
      (expectedUuid !== null && target.uuid !== expectedUuid)) {
    throw mutationError("preflight_failed", "Target native UUID is unavailable or changed.");
  }
  var layerInfo = duplicateLayerChain(document, target.layer);
  if (layerInfo === null || target.parent !== target.layer) {
    throw mutationError("preflight_failed", "Target layer identity is unavailable.");
  }
  var effectiveVisible = true;
  var effectiveLocked = false;
  for (var layerIndex = 0; layerIndex < layerInfo.chain.length; layerIndex++) {
    var layer = layerInfo.chain[layerIndex];
    if (typeof layer.visible !== "boolean" || typeof layer.locked !== "boolean") {
      throw mutationError("preflight_failed", "Layer safety state is unavailable.");
    }
    if (!layer.visible) effectiveVisible = false;
    if (layer.locked) effectiveLocked = true;
  }
  if (!target.pathPoints || target.pathPoints.length < 1 || target.pathPoints.length > DUPLICATE_MAX_PATH_POINTS) {
    throw mutationError("preflight_failed", "Duplicate supports PathItems with 1 to " +
      DUPLICATE_MAX_PATH_POINTS + " readable path points only.");
  }
  var pathPoints = [];
  for (var pointIndex = 0; pointIndex < target.pathPoints.length; pointIndex++) {
    var point = target.pathPoints[pointIndex];
    var pointType = String(point.pointType);
    if (pointType !== "PointType.CORNER" && pointType !== "PointType.SMOOTH") {
      throw mutationError("preflight_failed", "Unsupported path-point type.");
    }
    pathPoints.push({
      anchor: duplicatePoint(point.anchor, "pathPoints[" + pointIndex + "].anchor"),
      leftDirection: duplicatePoint(point.leftDirection, "pathPoints[" + pointIndex + "].leftDirection"),
      rightDirection: duplicatePoint(point.rightDirection, "pathPoints[" + pointIndex + "].rightDirection"),
      pointType: pointType
    });
  }
  if (typeof target.filled !== "boolean" || typeof target.stroked !== "boolean" ||
      typeof target.locked !== "boolean" || typeof target.hidden !== "boolean" || typeof target.editable !== "boolean") {
    throw mutationError("preflight_failed", "Target appearance or safety state is unavailable.");
  }
  var strokeDashes = [];
  if (!target.strokeDashes || target.strokeDashes.length > 32) {
    throw mutationError("preflight_failed", "Target stroke dash state is unavailable or too large.");
  }
  for (var dashIndex = 0; dashIndex < target.strokeDashes.length; dashIndex++) {
    strokeDashes.push(duplicateNumber(target.strokeDashes[dashIndex], "strokeDashes[" + dashIndex + "]"));
  }
  var visibilityVariable;
  try { visibilityVariable = target.visibilityVariable; }
  catch (variableError) { throw mutationError("preflight_failed", "Target visibility variable state is unreadable."); }
  if (target.clipping || target.guides || target.sliced || target.isIsolated || target.wrapped ||
      String(target.artworkKnockout) !== "KnockoutState.DISABLED" ||
      String(target.blendingMode) !== "BlendModes.NORMAL" || visibilityVariable !== null ||
      String(target.note) !== "" || target.tags.length !== 0 || String(target.uRL) !== "" ||
      String(target.polarity) !== "PolarityValues.POSITIVE") {
    throw mutationError("preflight_failed", "Target uses an unsupported structural or appearance state.");
  }
  var strokeCap = String(target.strokeCap);
  var strokeJoin = String(target.strokeJoin);
  if ((strokeCap !== "StrokeCap.BUTTENDCAP" && strokeCap !== "StrokeCap.ROUNDENDCAP" &&
       strokeCap !== "StrokeCap.PROJECTINGENDCAP") ||
      (strokeJoin !== "StrokeJoin.BEVELENDJOIN" && strokeJoin !== "StrokeJoin.ROUNDENDJOIN" &&
       strokeJoin !== "StrokeJoin.MITERENDJOIN")) {
    throw mutationError("preflight_failed", "Target stroke cap or join is unsupported.");
  }
  return {
    uuid: target.uuid,
    type: target.typename,
    name: String(target.name || ""),
    layerPath: layerInfo.path,
    geometricBounds: duplicateBounds(target.geometricBounds, "geometricBounds"),
    controlBounds: duplicateBounds(target.controlBounds, "controlBounds"),
    visibleBounds: duplicateBounds(target.visibleBounds, "visibleBounds"),
    position: duplicatePoint(target.position, "position"),
    width: duplicateNumber(target.width, "width"),
    height: duplicateNumber(target.height, "height"),
    closed: Boolean(target.closed),
    pathPoints: pathPoints,
    filled: target.filled,
    fillColor: target.filled ? duplicateProcessColor(target.fillColor, "fillColor", document) : null,
    fillOverprint: Boolean(target.fillOverprint),
    stroked: target.stroked,
    strokeColor: target.stroked ? duplicateProcessColor(target.strokeColor, "strokeColor", document) : null,
    strokeWidth: target.stroked ? duplicateNumber(target.strokeWidth, "strokeWidth") : null,
    strokeOverprint: Boolean(target.strokeOverprint),
    strokeDashes: strokeDashes,
    strokeDashOffset: duplicateNumber(target.strokeDashOffset, "strokeDashOffset"),
    strokeCap: strokeCap,
    strokeJoin: strokeJoin,
    strokeMiterLimit: duplicateNumber(target.strokeMiterLimit, "strokeMiterLimit"),
    evenodd: Boolean(target.evenodd),
    polarity: String(target.polarity),
    resolution: duplicateNumber(target.resolution, "resolution"),
    artworkKnockout: String(target.artworkKnockout),
    blendingMode: String(target.blendingMode),
    opacity: duplicateNumber(target.opacity, "opacity"),
    pixelAligned: Boolean(target.pixelAligned),
    noteEmpty: true,
    tagsEmpty: true,
    urlEmpty: true,
    visibilityVariableAbsent: true,
    wrapped: false,
    clipping: false,
    guides: false,
    sliced: false,
    isolated: false,
    locked: target.locked,
    hidden: target.hidden,
    editable: target.editable,
    layerVisible: target.layer.visible,
    layerLocked: target.layer.locked,
    effectiveLayerVisible: effectiveVisible,
    effectiveLayerLocked: effectiveLocked
  };
}

function duplicateParentOrder(layer) {
  if (!layer.pageItems || layer.pageItems.length < 1 || layer.pageItems.length > DUPLICATE_MAX_PARENT_ITEMS) {
    throw mutationError("preflight_failed", "Duplicate parent must contain 1 to " +
      DUPLICATE_MAX_PARENT_ITEMS + " direct page items.");
  }
  var order = [];
  var seen = {};
  for (var index = 0; index < layer.pageItems.length; index++) {
    var item = layer.pageItems[index];
    if (item.parent !== layer || typeof item.uuid !== "string" || item.uuid.length === 0 || seen[item.uuid]) {
      throw mutationError("preflight_failed", "Duplicate requires a complete unique direct-parent UUID order.");
    }
    seen[item.uuid] = true;
    order.push(item.uuid);
  }
  return order;
}

function duplicateSnapshotMatches(left, right) {
  return stringifyJson(left) === stringifyJson(right);
}

function duplicateSnapshotMatchesExceptUuid(left, right) {
  if (!left || !right) return false;
  var leftUuid = left.uuid;
  var rightUuid = right.uuid;
  left.uuid = right.uuid = "duplicate-native-uuid";
  var matches = stringifyJson(left) === stringifyJson(right);
  left.uuid = leftUuid;
  right.uuid = rightUuid;
  return matches;
}

function duplicateExpectedOrder(before, sourceUuid, duplicateUuid) {
  var result = [];
  var inserted = false;
  for (var index = 0; index < before.length; index++) {
    result.push(before[index]);
    if (before[index] === sourceUuid) {
      if (inserted) throw mutationError("preflight_failed", "Source UUID occurs more than once in parent order.");
      result.push(duplicateUuid);
      inserted = true;
    }
  }
  if (!inserted) throw mutationError("preflight_failed", "Source UUID is absent from parent order.");
  return result;
}

function duplicateResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  if (params.placement !== "after_source") {
    throw mutationError("preflight_failed", "Duplicate v1 supports placement after_source only.");
  }
  var source = duplicateFindTarget(document, params.sourceUuid);
  if (source === null) throw new Error("MCP_ERROR:" + stringifyJson({ code: "OBJECT_NOT_FOUND", uuid: params.sourceUuid }));
  var sourceBefore = duplicateSnapshot(document, source, params.sourceUuid);
  var parentOrderBefore = duplicateParentOrder(source.layer);
  var sourceIndex = -1;
  for (var index = 0; index < parentOrderBefore.length; index++) {
    if (parentOrderBefore[index] === params.sourceUuid) {
      if (sourceIndex !== -1) throw mutationError("preflight_failed", "Source UUID is duplicated in parent order.");
      sourceIndex = index;
    }
  }
  if (sourceIndex < 0) throw mutationError("preflight_failed", "Source UUID is absent from parent order.");
  var resultSizeWithinLimit =
    duplicateUtf8ByteLength(stringifyJson(sourceBefore)) <= DUPLICATE_SNAPSHOT_MAX_BYTES &&
    duplicateUtf8ByteLength(stringifyJson(parentOrderBefore)) <= DUPLICATE_ORDER_MAX_BYTES &&
    duplicateUtf8ByteLength(stringifyJson(context)) <= DUPLICATE_CONTEXT_MAX_BYTES;
  var blockers = [];
  if (!context.mutationAllowed) blockers.push("document_mutation_not_allowed");
  if (sourceBefore.locked) blockers.push("target_locked");
  if (sourceBefore.hidden) blockers.push("target_hidden");
  if (!sourceBefore.editable) blockers.push("target_not_editable");
  if (!sourceBefore.layerVisible) blockers.push("layer_hidden");
  if (!sourceBefore.effectiveLayerVisible && sourceBefore.layerVisible) blockers.push("ancestor_hidden");
  if (sourceBefore.layerLocked) blockers.push("layer_locked");
  if (sourceBefore.effectiveLayerLocked && !sourceBefore.layerLocked) blockers.push("ancestor_locked");
  if (!resultSizeWithinLimit) blockers.push("result_size_limit_exceeded");
  if (forApply && blockers.length > 0) {
    throw new Error("MCP_ERROR:" + stringifyJson({
      code: "DUPLICATE_APPLY_BLOCKED", reasonCodes: blockers, uuid: params.sourceUuid
    }));
  }
  return { context: context, document: document, source: source, sourceBefore: sourceBefore,
    parentLayer: source.layer, parentOrderBefore: parentOrderBefore, sourceIndex: sourceIndex,
    resultSizeWithinLimit: resultSizeWithinLimit, blockers: blockers };
}

function duplicatePreflight(forApply) {
  var resolved = duplicateResolve(forApply);
  if (forApply) {
    if (!duplicateSnapshotMatches(resolved.sourceBefore, params.expectedBefore)) {
      throw mutationError("preflight_failed", "Source state does not match expected_before.");
    }
    if (!mutationSameSequence(resolved.parentOrderBefore, params.expectedParentOrder)) {
      throw mutationError("preflight_failed", "Parent order does not match expected_parent_order.");
    }
  }
  return resolved;
}

function duplicatePlan(preflight) {
  return {
    operation: "duplicate_object",
    documentKey: preflight.context.key,
    sourceUuid: params.sourceUuid,
    placement: params.placement,
    sourceBefore: preflight.sourceBefore,
    parentOrderBefore: preflight.parentOrderBefore,
    sourceIndex: preflight.sourceIndex,
    resultSizeWithinLimit: preflight.resultSizeWithinLimit,
    applyBlockedReasonCodes: preflight.blockers,
    applyAllowed: preflight.blockers.length === 0
  };
}

function duplicateRevalidate(preflight, plan) {
  var current;
  try { current = duplicateResolve(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Duplicate preconditions changed before apply.")); }
  if (current.document !== preflight.document || current.source !== preflight.source ||
      current.parentLayer !== preflight.parentLayer ||
      !duplicateSnapshotMatches(current.sourceBefore, plan.sourceBefore) ||
      !mutationSameSequence(current.parentOrderBefore, plan.parentOrderBefore)) {
    throw mutationBeforeSideEffectError("Duplicate source or complete parent order changed before apply.");
  }
}

function duplicateApply(preflight, plan, state) {
  state.operationState.mutationStarted = true;
  var created = preflight.source.duplicate(preflight.source, ElementPlacement.PLACEAFTER);
  state.operationState.createdObject = created;
  if (!created || typeof created.uuid !== "string" || created.uuid.length === 0 || created.uuid === params.sourceUuid) {
    throw mutationError("apply_failed", "Illustrator did not return a distinct native UUID for the duplicate.");
  }
  state.operationState.createdUuid = created.uuid;
  state.operationState.rollbackEvidence.duplicateUuid = created.uuid;
  return created;
}

function duplicateVerify(preflight, plan, state) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) {
    throw mutationError("verify_mismatch", "Active document changed during duplicate verification.");
  }
  var source = duplicateFindTarget(preflight.document, params.sourceUuid);
  var created = duplicateFindTarget(preflight.document, state.operationState.createdUuid);
  if (source === null || source !== preflight.source || created === null ||
      created !== state.operationState.createdObject || created === source || created.parent !== preflight.parentLayer) {
    throw mutationError("verify_mismatch", "Source or duplicate native identity does not match the plan.");
  }
  var sourceAfter = duplicateSnapshot(preflight.document, source, params.sourceUuid);
  var duplicateAfter = duplicateSnapshot(preflight.document, created, state.operationState.createdUuid);
  var parentOrderAfter = duplicateParentOrder(preflight.parentLayer);
  var expectedOrder = duplicateExpectedOrder(plan.parentOrderBefore, params.sourceUuid, state.operationState.createdUuid);
  if (!duplicateSnapshotMatches(sourceAfter, plan.sourceBefore) ||
      !duplicateSnapshotMatchesExceptUuid(duplicateAfter, plan.sourceBefore) ||
      !mutationSameSequence(parentOrderAfter, expectedOrder)) {
    throw mutationError("verify_mismatch", "Duplicate state or complete parent order does not match the plan.");
  }
  return { sourceUuid: sourceAfter.uuid, duplicate: duplicateAfter, parentOrderAfter: parentOrderAfter };
}

function duplicateCreatedReferenceState(reference, expectedUuid) {
  try {
    if (typeof reference.uuid !== "string" || reference.uuid !== expectedUuid) return "mismatch";
    return "present";
  } catch (error) {
    if (error && error.name === "ReferenceError" && error.number === 45) return "invalid";
    throw error;
  }
}

function duplicateRollback(state) {
  var preflight = state.preflight;
  var createdUuid = state.operationState.createdUuid;
  var createdReference = state.operationState.createdObject;
  if (!preflight || typeof createdUuid !== "string" || !createdReference ||
      app.documents.length === 0 || app.activeDocument !== preflight.document) {
    return { status: "indeterminate", message: "Rollback duplicate identity or document is indeterminate." };
  }
  var created;
  try { created = duplicateFindTarget(preflight.document, createdUuid); }
  catch (error) { return { status: "indeterminate", message: "Rollback duplicate lookup is indeterminate." }; }
  if (created === null) {
    try {
      return duplicateCreatedReferenceState(createdReference, createdUuid) === "invalid"
        ? { status: "indeterminate", message: "Duplicate was absent before rollback restoration could be verified." }
        : { status: "indeterminate", message: "Duplicate UUID absence conflicts with its captured reference." };
    } catch (error) { return { status: "indeterminate", message: "Rollback captured-reference state is indeterminate." }; }
  }
  if (created !== createdReference || created.parent !== preflight.parentLayer ||
      typeof created.locked !== "boolean" || typeof created.hidden !== "boolean" ||
      typeof created.editable !== "boolean") {
    return { status: "indeterminate", message: "Rollback refused because duplicate identity changed." };
  }
  if (created.locked || created.hidden || !created.editable || preflight.parentLayer.locked || !preflight.parentLayer.visible) {
    return { status: "failed", message: "Rollback refused because the captured duplicate is not safely editable." };
  }
  var removeThrew = false;
  try { created.remove(); }
  catch (error) { removeThrew = true; }
  var remaining;
  try { remaining = duplicateFindTarget(preflight.document, createdUuid); }
  catch (error) { return { status: "indeterminate", message: "Rollback absence verification is indeterminate." }; }
  if (remaining !== null) {
    if (remaining === createdReference && remaining.uuid === createdUuid) {
      return { status: "failed", message: removeThrew
        ? "Rollback removal threw before removing the captured duplicate."
        : "Rollback removal did not remove the captured duplicate." };
    }
    return { status: "indeterminate", message: "Rollback UUID resolved to an unexpected object identity." };
  }
  try {
    if (duplicateCreatedReferenceState(createdReference, createdUuid) !== "invalid") {
      return { status: "indeterminate", message: "Rollback UUID is absent but the captured reference remains valid." };
    }
    var source = duplicateFindTarget(preflight.document, params.sourceUuid);
    if (source === null || source !== preflight.source) {
      return { status: "indeterminate", message: "Rollback source identity is indeterminate." };
    }
    var restoredSource = duplicateSnapshot(preflight.document, source, params.sourceUuid);
    var restoredParentOrder = duplicateParentOrder(preflight.parentLayer);
    state.operationState.rollbackEvidence.duplicateUuid = createdUuid;
    state.operationState.rollbackEvidence.restoredSource = restoredSource;
    state.operationState.rollbackEvidence.restoredParentOrder = restoredParentOrder;
    if (!duplicateSnapshotMatches(restoredSource, preflight.sourceBefore) ||
        !mutationSameSequence(restoredParentOrder, preflight.parentOrderBefore)) {
      return { status: "indeterminate", message: "Duplicate is absent but exact source or order restoration is unproved." };
    }
    return { status: "verified" };
  } catch (error) {
    return { status: "indeterminate", message: "Rollback restoration verification is indeterminate." };
  }
}

var duplicateExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionLayers: function (phase, preflight) { return [preflight.parentLayer]; },
  editSessionAffected: function (phase, preflight, plan, state) { return (phase === "after") ? [state.operationState.createdUuid] : []; },
  initialOperationState: function () {
    return { mutationStarted: false, createdObject: null, createdUuid: null,
      rollbackEvidence: { duplicateUuid: null, restoredSource: null, restoredParentOrder: null } };
  },
  preflight: duplicatePreflight,
  plan: duplicatePlan,
  revalidate: duplicateRevalidate,
  applyMutation: duplicateApply,
  verify: duplicateVerify,
  rollback: duplicateRollback,
  hasMutationEvidence: function (state) {
    return state.operationState.createdObject !== null && state.operationState.createdObject !== undefined;
  },
  applyIndeterminate: function (state) {
    return {
      reasonCode: "identity_unavailable",
      message: "Duplicate apply outcome is indeterminate because created-object identity is unavailable.",
      evidence: state.operationState.rollbackEvidence
    };
  },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var duplicateDocument = duplicateExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === duplicateExecution.preflight.document) {
  duplicateDocument = getDocumentContext();
}
var result = {
  operation: "duplicate_object",
  applied: duplicateExecution.transaction.state === "verified",
  document: duplicateDocument,
  plan: duplicateExecution.plan,
  transaction: duplicateExecution.transaction
};
if (duplicateExecution.transaction.state === "verified") result.postcondition = duplicateExecution.value;
`;
export const DUPLICATE_OBJECT_HOST_SCRIPT_DIGEST = canonicalSha256(DUPLICATE_OBJECT_SCRIPT);
export const DUPLICATE_OBJECT_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2,
    contractVersion: 1,
    operation: DUPLICATE_OBJECT_OPERATION,
    validator: DUPLICATE_OBJECT_VALIDATOR,
    canonicalContractVersion: DUPLICATE_CANONICAL_VERSION,
    resultSchemaVersion: DUPLICATE_RESULT_SCHEMA_VERSION,
    terminalClassifierVersion: DUPLICATE_CLASSIFIER_VERSION,
    safetyConformanceVersion: DUPLICATE_CONFORMANCE_VERSION,
    errorMappingVersion: DUPLICATE_ERROR_MAPPING_VERSION,
    safetyIdentity: DUPLICATE_OBJECT_SAFETY_IDENTITY,
    hostScriptDigest: DUPLICATE_OBJECT_HOST_SCRIPT_DIGEST,
});
function normalizedRequest(input) {
    const request = duplicateObjectInternalInputSchema.parse(input);
    const digestRequest = 'commandId' in request
        ? (({ commandId: _commandId, ...rest }) => rest)(request)
        : request;
    const digest = canonicalSha256({
        operation: DUPLICATE_OBJECT_OPERATION,
        validator: DUPLICATE_OBJECT_VALIDATOR,
        request: digestRequest,
    });
    return {
        intent: request.apply ? 'apply' : 'plan',
        request,
        commandId: 'commandId' in request ? request.commandId : null,
        documentKey: request.expectedDocumentKey,
        digest,
    };
}
export const duplicateObjectToolContract = {
    name: 'illustrator_duplicate_object',
    title: 'Plan or Duplicate Object',
    description: 'RGB paint and CMYK paint in CMYK documents are supported. Plan or duplicate one supported layer-direct PathItem after its native-UUID source. Apply compares the complete supported source snapshot and bounded parent order, verifies the distinct duplicate UUID and exact insertion, and rolls back only the captured self-created object.',
    inputSchema: duplicateObjectInputSchema,
    publicInputSchema: duplicateObjectPublicInputSchema,
    outputSchema: duplicateObjectResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(DUPLICATE_OBJECT_SAFETY.policy),
    normalizePublicInput,
};
export function createDuplicateObjectAdapter() {
    return {
        version: 1,
        operation: DUPLICATE_OBJECT_OPERATION,
        validator: DUPLICATE_OBJECT_VALIDATOR,
        safety: DUPLICATE_OBJECT_SAFETY,
        safetyRegistrationIdentity: DUPLICATE_OBJECT_SAFETY_IDENTITY,
        adapterIdentity: DUPLICATE_OBJECT_ADAPTER_IDENTITY,
        tool: duplicateObjectToolContract,
        canonical: {
            version: DUPLICATE_CANONICAL_VERSION,
            normalize: normalizedRequest,
            safetyDigest: (input) => normalizedRequest(input).digest,
        },
        resultSchema: duplicateObjectResultSchema,
        resultSchemaVersion: DUPLICATE_RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: DUPLICATE_CLASSIFIER_VERSION,
        safetyConformanceVersion: DUPLICATE_CONFORMANCE_VERSION,
        errorMappingVersion: DUPLICATE_ERROR_MAPPING_VERSION,
        hostScriptDigest: DUPLICATE_OBJECT_HOST_SCRIPT_DIGEST,
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: DUPLICATE_OBJECT_SCRIPT, params };
            return {
                kind: 'mutation',
                mutationValidator: DUPLICATE_OBJECT_VALIDATOR,
                idempotency: {
                    commandId: normalized.commandId,
                    operation: DUPLICATE_OBJECT_OPERATION,
                    documentKey: normalized.documentKey,
                    requestDigest: normalized.digest,
                },
                adapterIdentity: DUPLICATE_OBJECT_ADAPTER_IDENTITY,
                script: DUPLICATE_OBJECT_SCRIPT,
                params,
            };
        },
        classifyTerminal(value) {
            const state = duplicateObjectResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back' || state === 'rollback_failed') {
                return { state };
            }
            if (state === 'planned')
                throw new Error('Duplicate plan is not a terminal mutation result.');
            throw new Error('Unverified duplicate identity or recovery must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertDuplicateSafetyConformance,
        mapExecutionError(error, detail) {
            if (detail?.code === 'OBJECT_NOT_FOUND') {
                return new Error(`No PageItem with UUID ${JSON.stringify(detail.uuid ?? '')} exists in the bound document.`);
            }
            if (detail?.code === 'DUPLICATE_APPLY_BLOCKED') {
                return new Error(`Duplicate apply is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}.`);
            }
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
