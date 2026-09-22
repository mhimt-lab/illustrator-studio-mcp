import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { boundsSchema, documentContextSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { CLIPPING_MASK_HOST_SCRIPT, clipAuditMatches, clipLayerStateSchema, clipParentOrderSchema, clipPathSnapshotSchema, sameCanonical, } from './clipping-mask-shared.js';
import { SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS } from './supported-path-item-host-script.js';
export const MAKE_COMPOUND_PATH_OPERATION = 'make_compound_path';
export const MAKE_COMPOUND_PATH_VALIDATOR = { kind: MAKE_COMPOUND_PATH_OPERATION, version: 1 };
const CANONICAL_VERSION = 1;
const RESULT_SCHEMA_VERSION = 1;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
export const MAKE_COMPOUND_PATH_MAX_SELECTION = 256;
const uuidSchema = z.string().min(1).max(255);
const documentKeySchema = z.string().min(1).max(16_384);
const sourceUuidsSchema = z.tuple([uuidSchema, uuidSchema]).superRefine(([first, second], context) => {
    if (first === second)
        context.addIssue({ code: 'custom', message: 'source_uuids must name two different paths.' });
});
const sourcesSnapshotSchema = z.tuple([clipPathSnapshotSchema, clipPathSnapshotSchema]);
export const compoundMemberSnapshotSchema = z.strictObject({
    ...clipPathSnapshotSchema.shape,
    parentType: z.literal('CompoundPathItem'),
    polarity: z.string().min(1).max(64),
});
const selectionUuidsSchema = z.array(uuidSchema).max(MAKE_COMPOUND_PATH_MAX_SELECTION);
const selectionSchema = z.strictObject({
    before: selectionUuidsSchema,
    after: selectionUuidsSchema.nullable(),
    restored: z.boolean(),
}).superRefine((selection, context) => {
    const same = selection.after !== null && sameCanonical([...selection.before].sort(), [...selection.after].sort());
    if (selection.restored !== same)
        context.addIssue({ code: 'custom', message: 'Selection restored must reflect the read-back.' });
});
const commonInternal = { expectedDocumentKey: documentKeySchema, sourceUuids: sourceUuidsSchema };
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({
        ...commonInternal,
        expectedSourcesBefore: sourcesSnapshotSchema,
        expectedParentOrder: clipParentOrderSchema,
        apply: z.literal(true),
        commandId: canonicalCommandIdSchema,
    }),
]);
const commonPublic = {
    expected_document_key: documentKeySchema,
    source_uuids: sourceUuidsSchema.describe('Native PageItem.uuid of exactly two closed straight-segment PathItems directly on the same top-level layer, with the same paint.'),
};
export const makeCompoundPathPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({
        ...commonPublic,
        expected_sources_before: sourcesSnapshotSchema,
        expected_parent_order: clipParentOrderSchema,
        apply: z.literal(true),
        command_id: applyCommandIdSchema,
    }),
]);
const inputSchema = z.strictObject({
    ...commonPublic,
    expected_sources_before: sourcesSnapshotSchema.optional(),
    expected_parent_order: clipParentOrderSchema.optional(),
    apply: z.boolean().default(false),
    command_id: applyCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(makeCompoundPathPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = makeCompoundPathPublicInputSchema.parse(input);
    const common = { expectedDocumentKey: value.expected_document_key, sourceUuids: value.source_uuids };
    return value.apply ? {
        ...common,
        expectedSourcesBefore: value.expected_sources_before,
        expectedParentOrder: value.expected_parent_order,
        apply: true,
        commandId: value.command_id,
    } : { ...common, apply: false };
}
export const compoundBlockerSchema = z.enum([
    'document_mutation_not_allowed', 'unsupported_host_version',
    'source_locked', 'source_hidden', 'target_not_editable', 'layer_hidden', 'layer_locked', 'selection_unsupported',
]);
export function unionBounds(left, right) {
    return [Math.min(left[0], right[0]), Math.max(left[1], right[1]), Math.max(left[2], right[2]), Math.min(left[3], right[3])];
}
export function frontToBack(parentOrder, sourceUuids) {
    const first = parentOrder.indexOf(sourceUuids[0]);
    const second = parentOrder.indexOf(sourceUuids[1]);
    if (first < 0 || second < 0)
        throw new Error('Both sources must be in the parent order.');
    return first < second ? [sourceUuids[0], sourceUuids[1]] : [sourceUuids[1], sourceUuids[0]];
}
export function samePointsOrReversed(before, after) {
    if (sameCanonical(before, after))
        return true;
    const reversed = [...before].reverse().map((point) => ({
        ...point, leftDirection: point.rightDirection, rightDirection: point.leftDirection,
    }));
    return sameCanonical(reversed, after);
}
export function memberMatchesSource(source, member) {
    const strip = (value) => {
        const { uuid: _uuid, parentType: _parent, name: _name, pathPoints: _points, polarity: _polarity, ...rest } = value;
        return rest;
    };
    return sameCanonical(strip(source), strip(member)) && samePointsOrReversed(source.pathPoints, member.pathPoints);
}
const planSchema = z.strictObject({
    operation: z.literal(MAKE_COMPOUND_PATH_OPERATION),
    documentKey: documentKeySchema,
    sourceUuids: sourceUuidsSchema,
    layer: clipLayerStateSchema,
    sourcesBefore: sourcesSnapshotSchema,
    parentOrderBefore: clipParentOrderSchema,
    predicted: z.strictObject({
        consumedSourceUuids: z.array(uuidSchema).length(0),
        memberSourceOrder: z.tuple([uuidSchema, uuidSchema]),
        parentOrderAfter: z.array(uuidSchema.nullable()).min(2).max(SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS),
        compoundGeometricBounds: boundsSchema,
        compoundVisibleBounds: boundsSchema,
    }),
    applyBlockedReasonCodes: z.array(compoundBlockerSchema),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    const [first, second] = plan.sourcesBefore;
    if (first.uuid !== plan.sourceUuids[0] || second.uuid !== plan.sourceUuids[1] ||
        first.parentType !== 'Layer' || second.parentType !== 'Layer' || first.clipping || second.clipping) {
        context.addIssue({ code: 'custom', message: 'Compound plan must bind the two requested layer-direct, non-clipping sources.' });
    }
    let order = null;
    try {
        order = frontToBack(plan.parentOrderBefore, plan.sourceUuids);
    }
    catch { }
    if (order === null || !sameCanonical(order, plan.predicted.memberSourceOrder) ||
        !sameCanonical(plan.predicted.parentOrderAfter, [...plan.parentOrderBefore, null]) ||
        !sameCanonical(plan.predicted.compoundGeometricBounds, unionBounds(first.geometricBounds, second.geometricBounds)) ||
        !sameCanonical(plan.predicted.compoundVisibleBounds, unionBounds(first.visibleBounds, second.visibleBounds))) {
        context.addIssue({ code: 'custom', message: 'Compound plan prediction must follow from the sources and the parent order.' });
    }
    if (plan.applyAllowed !== (plan.applyBlockedReasonCodes.length === 0)) {
        context.addIssue({ code: 'custom', message: 'Compound applyAllowed must exactly reflect blockers.' });
    }
});
const applyFailureSchema = z.strictObject({ phase: z.literal('apply'), reasonCode: z.literal('apply_failed'), message: z.string().min(1).max(500) });
const verifyFailureSchema = z.strictObject({ phase: z.literal('verify'), reasonCode: z.literal('verify_mismatch'), message: z.string().min(1).max(500) });
const failureSchema = z.discriminatedUnion('phase', [applyFailureSchema, verifyFailureSchema]);
const createdIdentity = {
    compoundUuid: uuidSchema.nullable(),
    duplicateUuids: z.array(uuidSchema).max(2),
};
const transactionSchema = z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('planned'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('verified'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('apply_failed'), failure: applyFailureSchema, rollback: z.strictObject({ status: z.literal('not_required') }), audit: mutationAuditSchema }),
    z.strictObject({
        state: z.literal('rolled_back'), failure: failureSchema,
        rollback: z.strictObject({
            status: z.literal('verified'), ...createdIdentity, duplicateUuids: z.array(uuidSchema).min(1).max(2),
            restoredSources: sourcesSnapshotSchema, restoredParentOrder: clipParentOrderSchema, selection: selectionSchema.nullable(),
        }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rollback_failed'), failure: failureSchema,
        rollback: z.strictObject({
            status: z.literal('failed'), reasonCode: z.literal('rollback_failed'), message: z.string().min(1).max(500),
            ...createdIdentity, duplicateUuids: z.array(uuidSchema).min(1).max(2),
            restoredSources: z.null(), restoredParentOrder: z.null(), selection: selectionSchema.nullable(),
        }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('apply_indeterminate'),
        failure: z.strictObject({ phase: z.literal('apply'), reasonCode: z.literal('apply_indeterminate'), message: z.string().min(1).max(500) }),
        rollback: z.strictObject({
            status: z.literal('indeterminate'), reasonCode: z.literal('identity_unavailable'), message: z.string().min(1).max(500),
            compoundUuid: z.null(), duplicateUuids: z.array(uuidSchema).length(0),
            restoredSources: z.null(), restoredParentOrder: z.null(), selection: z.null(),
        }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rollback_indeterminate'), failure: failureSchema,
        rollback: z.strictObject({
            status: z.literal('indeterminate'), reasonCode: z.literal('rollback_indeterminate'), message: z.string().min(1).max(500),
            ...createdIdentity, restoredSources: sourcesSnapshotSchema.nullable(), restoredParentOrder: clipParentOrderSchema.nullable(),
            selection: selectionSchema.nullable(),
        }),
        audit: mutationAuditSchema,
    }),
]).superRefine((transaction, context) => {
    if (!clipAuditMatches(transaction))
        context.addIssue({ code: 'custom', message: 'Compound audit sequence does not match transaction state.' });
    if ((transaction.state === 'rollback_failed' || transaction.state === 'rollback_indeterminate') &&
        transaction.audit.filter((event) => event.event === 'failed' && event.phase === 'rollback' &&
            event.reasonCode === transaction.rollback.reasonCode && event.message === transaction.rollback.message).length !== 1) {
        context.addIssue({ code: 'custom', message: 'Compound rollback summary must match one audit event.' });
    }
    if (transaction.state === 'apply_indeterminate' && transaction.rollback.message !== transaction.failure.message) {
        context.addIssue({ code: 'custom', message: 'Compound indeterminate summaries must match.' });
    }
});
const createdCompoundSchema = z.strictObject({
    uuid: uuidSchema,
    layerPath: clipLayerStateSchema.shape.layerPath,
    geometricBounds: boundsSchema,
    visibleBounds: boundsSchema,
    locked: z.literal(false),
    hidden: z.literal(false),
    memberOrder: z.tuple([uuidSchema, uuidSchema]),
});
const postconditionSchema = z.strictObject({
    compound: createdCompoundSchema,
    members: z.tuple([compoundMemberSnapshotSchema, compoundMemberSnapshotSchema]),
    sourcesAfter: sourcesSnapshotSchema,
    parentOrderAfter: clipParentOrderSchema,
    selection: selectionSchema,
});
export const makeCompoundPathResultSchema = z.union([
    z.strictObject({ operation: z.literal(MAKE_COMPOUND_PATH_OPERATION), applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ operation: z.literal(MAKE_COMPOUND_PATH_OPERATION), applied: z.literal(true), document: documentContextSchema, plan: planSchema, postcondition: postconditionSchema, transaction: transactionSchema }),
]).superRefine((result, context) => {
    if (result.transaction.state !== 'planned' && !result.plan.applyAllowed) {
        context.addIssue({ code: 'custom', message: 'A compound apply outcome requires an executable plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified') {
            context.addIssue({ code: 'custom', message: 'Applied compound requires a verified transaction.' });
            return;
        }
        const { compound, members, sourcesAfter, parentOrderAfter } = result.postcondition;
        const plan = result.plan;
        const sourceByUuid = new Map(plan.sourcesBefore.map((source) => [source.uuid, source]));
        const memberSources = plan.predicted.memberSourceOrder.map((uuid) => sourceByUuid.get(uuid));
        const created = [compound.uuid, ...compound.memberOrder];
        if (new Set(created).size !== 3 || created.some((uuid) => plan.parentOrderBefore.includes(uuid)) ||
            !sameCanonical(compound.layerPath, plan.layer.layerPath) ||
            !sameCanonical(members.map((member) => member.uuid), compound.memberOrder) ||
            members.some((member, index) => !memberMatchesSource(memberSources[index], member)) ||
            !sameCanonical(compound.geometricBounds, plan.predicted.compoundGeometricBounds) ||
            !sameCanonical(compound.visibleBounds, plan.predicted.compoundVisibleBounds) ||
            !sameCanonical(sourcesAfter, plan.sourcesBefore) ||
            !sameCanonical(parentOrderAfter, plan.predicted.parentOrderAfter.map((uuid) => uuid ?? compound.uuid))) {
            context.addIssue({ code: 'custom', message: 'Verified compound must match the planned members, bounds, untouched sources, and parent order.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified compound transaction must be applied.' });
    }
    if (result.transaction.state === 'rolled_back' &&
        (!sameCanonical(result.transaction.rollback.restoredSources, result.plan.sourcesBefore) ||
            !sameCanonical(result.transaction.rollback.restoredParentOrder, result.plan.parentOrderBefore))) {
        context.addIssue({ code: 'custom', message: 'Rolled-back compound must prove exact sources and parent order.' });
    }
});
export const makeCompoundPathResponseSchema = z.strictObject({
    outcome: makeCompoundPathResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
export const MAKE_COMPOUND_PATH_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: MAKE_COMPOUND_PATH_OPERATION,
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
export const MAKE_COMPOUND_PATH_SAFETY_IDENTITY = canonicalDigest(MAKE_COMPOUND_PATH_SAFETY);
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    return bindOperationSafetyPlan({
        policyVersion: 1,
        operationClass: 'create',
        operationId: MAKE_COMPOUND_PATH_OPERATION,
        canonicalRequestDigest: requestDigest,
        evidence: {
            documentKey: admissionDocumentKey,
            targetLocator: `sources:${result.plan.sourceUuids.join(',')};layer:${result.plan.layer.layerPath.join('.')};order:${canonicalDigest(result.plan.parentOrderBefore)}`,
        },
        preconditions: {
            status: result.plan.applyAllowed ? 'satisfied' : 'blocked',
            targetsValidated: result.plan.applyBlockedReasonCodes.length === 0,
        },
        confirmation: { kind: 'risk_scoped', status: 'not_required' },
        applyAllowed: result.plan.applyAllowed,
    });
}
function createdNativeUuid(rollback) {
    return rollback.compoundUuid ?? rollback.duplicateUuids[0];
}
function safetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' || transaction.state === 'rollback_indeterminate') {
        throw new Error('Indeterminate compound results cannot be represented as terminal safety results.');
    }
    const common = {
        policyVersion: 1, operationClass: 'create', operationId: MAKE_COMPOUND_PATH_OPERATION,
        canonicalRequestDigest: requestDigest, planDigest: plan.planDigest, attestation,
    };
    const replay = { status: 'durable_terminal', action: 'return_attested_result', reapply: false };
    if (transaction.state === 'verified' && result.applied) {
        return operationSafetyResultSchema.parse({
            ...common,
            evidence: { nativeUuid: result.postcondition.compound.uuid, ownership: 'self_created_only', postconditionVerified: true, outstandingEffect: null },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'succeeded', terminal: true, recovery: 'not_required', proof: { kind: 'verified_postcondition' }, replay },
        });
    }
    if (transaction.state === 'rolled_back') {
        return operationSafetyResultSchema.parse({
            ...common,
            evidence: { nativeUuid: createdNativeUuid(transaction.rollback), ownership: 'self_created_only', postconditionVerified: false, outstandingEffect: null },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'recovered', terminal: true, recovery: 'verified', proof: { kind: 'verified_recovery' }, replay },
        });
    }
    if (transaction.state === 'rollback_failed') {
        const nativeUuid = createdNativeUuid(transaction.rollback);
        return operationSafetyResultSchema.parse({
            ...common,
            evidence: {
                nativeUuid, ownership: 'self_created_only', postconditionVerified: false,
                outstandingEffect: { kind: 'native_uuid_still_present', nativeUuid },
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
    const result = makeCompoundPathResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null)
        throw new Error('Compound terminal result requires a durable attestation resolver.');
    await assertOperationSafetyAdapterConformance({
        registration: MAKE_COMPOUND_PATH_SAFETY, plan, result: safetyResult(result, requestDigest, attestation, plan),
    }, resolver);
}
export const MAKE_COMPOUND_PATH_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}${CLIPPING_MASK_HOST_SCRIPT}
var COMPOUND_MAX_SELECTION = ${MAKE_COMPOUND_PATH_MAX_SELECTION};

/** Only the measured source shape: closed, straight segments (every point a corner without handles). */
function compoundAssertMeasuredShape(snapshot) {
  if (!snapshot.closed || snapshot.pathPoints.length < 2) throw clipUnsupported("path_shape_unmeasured", snapshot.uuid);
  for (var index = 0; index < snapshot.pathPoints.length; index++) {
    var point = snapshot.pathPoints[index];
    if (point.pointType !== "PointType.CORNER" ||
        point.leftDirection[0] !== point.anchor[0] || point.leftDirection[1] !== point.anchor[1] ||
        point.rightDirection[0] !== point.anchor[0] || point.rightDirection[1] !== point.anchor[1]) {
      throw clipUnsupported("path_shape_unmeasured", snapshot.uuid);
    }
  }
}

/** Both measured sources had one paint; how the menu command merges different paint is unmeasured. */
function compoundPaint(snapshot) {
  return stringifyJson({ filled: snapshot.filled, fillColor: snapshot.fillColor, stroked: snapshot.stroked,
    strokeColor: snapshot.strokeColor, strokeWidth: snapshot.strokeWidth, opacity: snapshot.opacity });
}

/** The current selection as page items, or null when it is not an array of UUID-bearing page items. */
function compoundReadSelection(document) {
  var selection = document.selection;
  if (selection === null || selection === undefined) return { items: [], uuids: [] };
  if (typeof selection !== "object" || selection.typename !== undefined || typeof selection.length !== "number" ||
      selection.length > COMPOUND_MAX_SELECTION) return null;
  var items = [];
  var uuids = [];
  for (var index = 0; index < selection.length; index++) {
    var item = selection[index];
    if (!item || typeof item.uuid !== "string" || item.uuid.length === 0) return null;
    items.push(item);
    uuids.push(item.uuid);
  }
  return { items: items, uuids: uuids };
}

function compoundSameSet(left, right) {
  if (left.length !== right.length) return false;
  var a = left.slice(0).sort();
  var b = right.slice(0).sort();
  for (var index = 0; index < a.length; index++) if (a[index] !== b[index]) return false;
  return true;
}

/** Writes the saved selection back and reads it again; a failure is reported, never thrown. */
function compoundRestoreSelection(document, saved) {
  var after = null;
  try {
    document.selection = saved.items.length === 0 ? null : saved.items;
    var read = compoundReadSelection(document);
    after = read === null ? null : read.uuids;
  } catch (error) { after = null; }
  return { before: saved.uuids, after: after, restored: after !== null && compoundSameSet(saved.uuids, after) };
}

function compoundUnion(left, right) {
  return [Math.min(left[0], right[0]), Math.max(left[1], right[1]), Math.max(left[2], right[2]), Math.min(left[3], right[3])];
}

function compoundResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  var uuids = params.sourceUuids;
  if (!uuids || uuids.length !== 2) throw mutationError("preflight_failed", "Exactly two source UUIDs are required.");
  if (uuids[0] === uuids[1]) throw clipUnsupported("same_target", uuids[0]);
  var sources = [clipResolve(document, uuids[0], ["PathItem"]), clipResolve(document, uuids[1], ["PathItem"])];
  var layer = sources[0].layer;
  if (!layer || String(layer.typename) !== "Layer" || sources[0].parent !== layer) throw clipUnsupported("parent_unmeasured", uuids[0]);
  if (sources[1].layer !== layer || sources[1].parent !== layer) throw clipUnsupported("parent_unmeasured", uuids[1]);
  var layerState = clipLayerState(document, layer, uuids[0]);
  var snapshots = [clipPathSnapshot(document, sources[0], layer), clipPathSnapshot(document, sources[1], layer)];
  for (var index = 0; index < 2; index++) {
    if (snapshots[index].clipping) throw clipUnsupported("source_is_clipping_path", uuids[index]);
    compoundAssertMeasuredShape(snapshots[index]);
  }
  if (compoundPaint(snapshots[0]) !== compoundPaint(snapshots[1])) throw clipUnsupported("paint_mismatch_unmeasured", uuids[1]);
  var parentOrder = supportedPathOrder(layer);
  if (parentOrder.length >= SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS) throw clipUnsupported("parent_too_large", uuids[0]);
  var firstIndex = clipIndexOf(parentOrder, uuids[0]);
  var secondIndex = clipIndexOf(parentOrder, uuids[1]);
  var frontIndex = firstIndex < secondIndex ? 0 : 1;
  var blockers = [];
  clipCommonBlockers(context, layerState, blockers);
  clipItemBlockers(snapshots[0], "source_locked", "source_hidden", blockers);
  clipItemBlockers(snapshots[1], "source_locked", "source_hidden", blockers);
  clipEditableBlocker(sources, blockers);
  if (compoundReadSelection(document) === null) clipAddBlocker(blockers, "selection_unsupported");
  if (forApply && blockers.length > 0) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "COMPOUND_APPLY_BLOCKED", reasonCodes: blockers }));
  }
  return { context: context, document: document, layer: layer, layerState: layerState, sources: sources,
    snapshots: snapshots, parentOrderBefore: parentOrder, front: sources[frontIndex], back: sources[1 - frontIndex],
    memberSourceOrder: [uuids[frontIndex], uuids[1 - frontIndex]], blockers: blockers };
}

function compoundPreflight(forApply) {
  var resolved = compoundResolve(forApply);
  if (forApply) {
    if (!supportedPathSame(resolved.snapshots, params.expectedSourcesBefore)) {
      throw mutationError("preflight_failed", "Source state does not match expected_sources_before.");
    }
    if (!mutationSameSequence(resolved.parentOrderBefore, params.expectedParentOrder)) {
      throw mutationError("preflight_failed", "Parent order does not match expected_parent_order.");
    }
  }
  return resolved;
}

function compoundPlan(preflight) {
  var order = [];
  for (var index = 0; index < preflight.parentOrderBefore.length; index++) order.push(preflight.parentOrderBefore[index]);
  order.push(null);
  return {
    operation: "make_compound_path", documentKey: preflight.context.key,
    sourceUuids: [params.sourceUuids[0], params.sourceUuids[1]], layer: preflight.layerState,
    sourcesBefore: preflight.snapshots, parentOrderBefore: preflight.parentOrderBefore,
    predicted: {
      consumedSourceUuids: [],
      memberSourceOrder: preflight.memberSourceOrder,
      parentOrderAfter: order,
      compoundGeometricBounds: compoundUnion(preflight.snapshots[0].geometricBounds, preflight.snapshots[1].geometricBounds),
      compoundVisibleBounds: compoundUnion(preflight.snapshots[0].visibleBounds, preflight.snapshots[1].visibleBounds)
    },
    applyBlockedReasonCodes: preflight.blockers, applyAllowed: preflight.blockers.length === 0
  };
}

function compoundRevalidate(preflight, plan) {
  var current;
  try { current = compoundResolve(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Compound preconditions changed before apply.")); }
  if (current.document !== preflight.document || current.layer !== preflight.layer ||
      current.sources[0] !== preflight.sources[0] || current.sources[1] !== preflight.sources[1] ||
      !supportedPathSame(current.snapshots, plan.sourcesBefore) ||
      !mutationSameSequence(current.parentOrderBefore, plan.parentOrderBefore)) {
    throw mutationBeforeSideEffectError("Compound sources or complete parent order changed before apply.");
  }
  // Read in the same call right before the first write; compoundResolve(true) already refused an unsupported selection.
  preflight.savedSelection = compoundReadSelection(preflight.document);
  if (preflight.savedSelection === null) throw mutationBeforeSideEffectError("The selection is not a list of page items.");
}

/** The one CompoundPathItem in the typed collection whose pathItems are exactly the duplicates, in order. */
function compoundFindByMembers(document, memberUuids) {
  var collection = clipCollection(document, "CompoundPathItem");
  var found = null;
  for (var index = 0; index < collection.length; index++) {
    var candidate = collection[index];
    var members = candidate.pathItems;
    if (!members || members.length !== memberUuids.length) continue;
    var matches = true;
    for (var memberIndex = 0; memberIndex < members.length; memberIndex++) {
      if (String(members[memberIndex].uuid) !== memberUuids[memberIndex]) { matches = false; break; }
    }
    if (!matches) continue;
    if (found !== null) throw mutationError("apply_failed", "More than one compound path holds the duplicates.");
    found = candidate;
  }
  return found;
}

function compoundCaptureDuplicate(state, source, layer) {
  // Set before the first write: from here on a throw can leave a created item behind.
  state.operationState.mutationStarted = true;
  var duplicate = source.duplicate(layer, ElementPlacement.PLACEATEND);
  if (!duplicate) throw mutationError("apply_failed", "Illustrator did not return the duplicate path.");
  state.operationState.duplicates.push(duplicate);
  var uuid = duplicate.uuid;
  if (typeof uuid !== "string" || uuid.length === 0 || uuid === params.sourceUuids[0] || uuid === params.sourceUuids[1] ||
      clipIndexOf(state.operationState.rollbackEvidence.duplicateUuids, uuid) >= 0) {
    throw mutationError("apply_failed", "Illustrator did not return a distinct native UUID for the duplicate path.");
  }
  state.operationState.rollbackEvidence.duplicateUuids.push(uuid);
  return duplicate;
}

function compoundApply(preflight, plan, state) {
  var document = preflight.document;
  var saved = preflight.savedSelection;
  state.operationState.savedSelection = saved;
  // Measured sequence (A30_COMPOUND_MAKE): duplicate both to the end of the layer, select the duplicates, run the
  // menu command with alerts off. Front source first, so the duplicates keep the sources' stacking order.
  var front = compoundCaptureDuplicate(state, preflight.front, preflight.layer);
  var back = compoundCaptureDuplicate(state, preflight.back, preflight.layer);
  var previousInteraction = app.userInteractionLevel;
  app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
  try {
    document.selection = [front, back];
    app.executeMenuCommand("compoundPath");
  } finally {
    app.userInteractionLevel = previousInteraction;
  }
  var compound = compoundFindByMembers(document, state.operationState.rollbackEvidence.duplicateUuids);
  if (compound === null) throw mutationError("apply_failed", "Illustrator did not create one compound path from the duplicates.");
  var compoundUuid = compound.uuid;
  if (typeof compoundUuid !== "string" || compoundUuid.length === 0 ||
      compoundUuid === params.sourceUuids[0] || compoundUuid === params.sourceUuids[1] ||
      clipIndexOf(state.operationState.rollbackEvidence.duplicateUuids, compoundUuid) >= 0) {
    throw mutationError("apply_failed", "Illustrator did not return a distinct native UUID for the compound path.");
  }
  state.operationState.compound = compound;
  state.operationState.rollbackEvidence.compoundUuid = compoundUuid;
  state.operationState.selection = compoundRestoreSelection(document, saved);
  state.operationState.rollbackEvidence.selection = state.operationState.selection;
  return compound;
}

function compoundSameExceptIdentity(source, member) {
  var skip = { uuid: true, parentType: true, name: true, pathPoints: true, polarity: true };
  var left = {};
  var right = {};
  for (var key in source) if (source.hasOwnProperty(key) && !skip[key]) left[key] = source[key];
  for (var memberKey in member) if (member.hasOwnProperty(memberKey) && !skip[memberKey]) right[memberKey] = member[memberKey];
  if (!supportedPathSame(left, right)) return false;
  if (supportedPathSame(source.pathPoints, member.pathPoints)) return true;
  var reversed = [];
  for (var index = source.pathPoints.length - 1; index >= 0; index--) {
    var point = source.pathPoints[index];
    reversed.push({ anchor: point.anchor, leftDirection: point.rightDirection, rightDirection: point.leftDirection, pointType: point.pointType });
  }
  return supportedPathSame(reversed, member.pathPoints);
}

/**
 * Member-only snapshot. The layer-direct path gate does not apply to a compound member (live run 3): its \`wrapped\`
 * read throws Error 1200 MRAP, so it is not read, and its \`polarity\` is set by the menu command, so it is recorded
 * and not required. Every other field is read and compared exactly as for a source.
 */
function compoundMemberSnapshot(member, compound, index) {
  function differs(what) { return mutationError("verify_mismatch", "Compound member " + index + " " + what + "."); }
  if (!member || String(member.typename) !== "PathItem" || typeof member.uuid !== "string" || member.uuid.length === 0) {
    throw differs("identity is unavailable");
  }
  if (member.parent !== compound) throw differs("is not parented by the created compound");
  if (!member.pathPoints || member.pathPoints.length < 1 || member.pathPoints.length > SUPPORTED_PATH_ITEM_MAX_PATH_POINTS) {
    throw differs("point count is outside the support profile");
  }
  var pathPoints = [];
  for (var pointIndex = 0; pointIndex < member.pathPoints.length; pointIndex++) {
    var point = member.pathPoints[pointIndex];
    var pointType = String(point.pointType);
    if (pointType !== "PointType.CORNER" && pointType !== "PointType.SMOOTH") throw differs("has an unmeasured point type");
    pathPoints.push({
      anchor: supportedPathPoint(point.anchor, "member.pathPoints[" + pointIndex + "].anchor"),
      leftDirection: supportedPathPoint(point.leftDirection, "member.pathPoints[" + pointIndex + "].leftDirection"),
      rightDirection: supportedPathPoint(point.rightDirection, "member.pathPoints[" + pointIndex + "].rightDirection"),
      pointType: pointType
    });
  }
  if (typeof member.filled !== "boolean" || typeof member.stroked !== "boolean" || typeof member.clipping !== "boolean" ||
      typeof member.locked !== "boolean" || typeof member.hidden !== "boolean") {
    throw differs("appearance or safety state is unavailable");
  }
  var visibilityVariable;
  try { visibilityVariable = member.visibilityVariable; }
  catch (variableError) { throw differs("visibility variable state is unreadable"); }
  if (member.guides || member.sliced || member.isIsolated ||
      String(member.artworkKnockout) !== "KnockoutState.DISABLED" ||
      String(member.blendingMode) !== "BlendModes.NORMAL" || visibilityVariable !== null ||
      String(member.note) !== "" || member.tags.length !== 0 || String(member.uRL) !== "" ||
      !member.strokeDashes || member.strokeDashes.length !== 0) {
    throw differs("state differs from its source (" + compoundMemberStateFacts(member, compound) + ")");
  }
  function rgb(value, label) {
    if (!value || String(value.typename) !== "RGBColor") throw differs(label + " is not RGB");
    return supportedPathRgb(value, label);
  }
  return {
    uuid: member.uuid,
    type: "PathItem",
    name: String(member.name || ""),
    parentType: "CompoundPathItem",
    geometricBounds: supportedPathBounds(member.geometricBounds, "member.geometricBounds"),
    visibleBounds: supportedPathBounds(member.visibleBounds, "member.visibleBounds"),
    closed: Boolean(member.closed),
    pathPoints: pathPoints,
    filled: member.filled,
    fillColor: member.filled ? rgb(member.fillColor, "fillColor") : null,
    stroked: member.stroked,
    strokeColor: member.stroked ? rgb(member.strokeColor, "strokeColor") : null,
    strokeWidth: member.stroked ? supportedPathNumber(member.strokeWidth, "strokeWidth") : null,
    opacity: supportedPathNumber(member.opacity, "opacity"),
    clipping: member.clipping,
    locked: member.locked,
    hidden: member.hidden,
    polarity: String(member.polarity)
  };
}

/** A readable reason for an error that carries no public message (a shared-gate refusal or a host exception). */
function compoundDescribeError(error) {
  var message = error && error.message ? String(error.message) : String(error);
  if (message.indexOf("MCP_ERROR:") === 0) return message.substring("MCP_ERROR:".length);
  return (error && error.name ? String(error.name) + " " : "") + (error && typeof error.number === "number" ? error.number + " " : "") + message;
}

/** The member state the shared path gate refuses, each read on its own, so a refusal names the property. */
function compoundMemberStateFacts(member, compound) {
  // \`wrapped\` is not read: on a compound member it throws Error 1200 MRAP (live run 3).
  var names = ["polarity", "artworkKnockout", "blendingMode", "note", "uRL", "guides", "sliced", "isIsolated"];
  var facts = [];
  for (var index = 0; index < names.length; index++) {
    try { facts.push(names[index] + "=" + String(member[names[index]])); }
    catch (error) { facts.push(names[index] + "!" + compoundDescribeError(error)); }
  }
  try { facts.push("tags=" + member.tags.length); } catch (tagsError) { facts.push("tags!" + compoundDescribeError(tagsError)); }
  try { facts.push("dashes=" + member.strokeDashes.length); } catch (dashError) { facts.push("dashes!" + compoundDescribeError(dashError)); }
  try {
    var parent = member.parent;
    facts.push("parentType=" + String(parent.typename) + ",parentIsCompound=" + (parent === compound) + ",parentUuid=" + String(parent.uuid));
  } catch (parentError) { facts.push("parent!" + compoundDescribeError(parentError)); }
  return facts.join(",");
}

/** Every verify failure names its check: an error without a public message becomes a described verify_mismatch. */
function compoundVerify(preflight, plan, state) {
  try { return compoundVerifyChecked(preflight, plan, state); }
  catch (error) {
    if (error && typeof error.mutationPublicMessage === "string" && error.mutationPublicMessage.length > 0) throw error;
    throw mutationError("verify_mismatch", "Compound verification raised: " + compoundDescribeError(error));
  }
}

function compoundVerifyChecked(preflight, plan, state) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) {
    throw mutationError("verify_mismatch", "Active document changed during compound verification.");
  }
  var document = preflight.document;
  var compoundUuid = state.operationState.rollbackEvidence.compoundUuid;
  var compound = clipTyped(document, "CompoundPathItem", compoundUuid);
  if (compound === null || compound !== state.operationState.compound || compound.parent !== preflight.layer) {
    throw mutationError("verify_mismatch", "Created compound path native identity does not match the plan.");
  }
  if (typeof compound.locked !== "boolean" || typeof compound.hidden !== "boolean" || compound.locked || compound.hidden) {
    throw mutationError("verify_mismatch", "Created compound path is locked, hidden, or unreadable.");
  }
  var duplicateUuids = state.operationState.rollbackEvidence.duplicateUuids;
  var members = compound.pathItems;
  if (!members || members.length !== 2) throw mutationError("verify_mismatch", "Created compound path does not hold exactly two members.");
  var memberSnapshots = [];
  var sourceSnapshots = [];
  for (var index = 0; index < 2; index++) {
    var member = members[index];
    if (String(member.uuid) !== duplicateUuids[index] || member !== state.operationState.duplicates[index] || member.parent !== compound) {
      throw mutationError("verify_mismatch", "Compound member order or identity does not match the duplicates.");
    }
    var snapshot;
    try { snapshot = compoundMemberSnapshot(member, compound, index); }
    catch (snapshotError) {
      if (snapshotError && typeof snapshotError.mutationPublicMessage === "string" && snapshotError.mutationPublicMessage.length > 0) throw snapshotError;
      throw mutationError("verify_mismatch", "Compound member " + index + " could not be read: " +
        compoundDescribeError(snapshotError) + "; " + compoundMemberStateFacts(member, compound));
    }
    var source = plan.sourcesBefore[plan.sourceUuids[0] === plan.predicted.memberSourceOrder[index] ? 0 : 1];
    if (!compoundSameExceptIdentity(source, snapshot)) {
      throw mutationError("verify_mismatch", "A compound member does not match its source path.");
    }
    memberSnapshots.push(snapshot);
  }
  for (var sourceIndex = 0; sourceIndex < 2; sourceIndex++) {
    var current = clipTyped(document, "PathItem", params.sourceUuids[sourceIndex]);
    if (current !== preflight.sources[sourceIndex]) throw mutationError("verify_mismatch", "A source path identity changed.");
    sourceSnapshots.push(clipPathSnapshot(document, current, preflight.layer));
  }
  if (!supportedPathSame(sourceSnapshots, plan.sourcesBefore)) throw mutationError("verify_mismatch", "A source path changed.");
  var geometricBounds = supportedPathBounds(compound.geometricBounds, "compound.geometricBounds");
  var visibleBounds = supportedPathBounds(compound.visibleBounds, "compound.visibleBounds");
  if (!supportedPathSame(geometricBounds, plan.predicted.compoundGeometricBounds) ||
      !supportedPathSame(visibleBounds, plan.predicted.compoundVisibleBounds)) {
    throw mutationError("verify_mismatch", "Compound path bounds do not match the union of the sources.");
  }
  var parentOrderAfter = supportedPathOrder(preflight.layer);
  var expectedOrder = plan.parentOrderBefore.slice(0);
  expectedOrder.push(compoundUuid);
  if (!mutationSameSequence(parentOrderAfter, expectedOrder)) {
    throw mutationError("verify_mismatch", "Parent order after the compound path does not match the plan.");
  }
  var layerInfo = supportedPathLayerChain(document, preflight.layer);
  return {
    compound: { uuid: compoundUuid, layerPath: layerInfo.path, geometricBounds: geometricBounds, visibleBounds: visibleBounds,
      locked: false, hidden: false, memberOrder: [duplicateUuids[0], duplicateUuids[1]] },
    members: memberSnapshots, sourcesAfter: sourceSnapshots, parentOrderAfter: parentOrderAfter,
    selection: state.operationState.selection
  };
}

function compoundVerifyRestored(state) {
  var preflight = state.preflight;
  var document = preflight.document;
  var evidence = state.operationState.rollbackEvidence;
  if (evidence.compoundUuid !== null && clipTyped(document, "CompoundPathItem", evidence.compoundUuid) !== null) {
    return { status: "indeterminate", message: "The created compound path is still present after recovery." };
  }
  for (var index = 0; index < evidence.duplicateUuids.length; index++) {
    if (clipTyped(document, "PathItem", evidence.duplicateUuids[index]) !== null) {
      return { status: "indeterminate", message: "A created duplicate path is still present after recovery." };
    }
  }
  var restored = [];
  for (var sourceIndex = 0; sourceIndex < 2; sourceIndex++) {
    var source = clipTyped(document, "PathItem", params.sourceUuids[sourceIndex]);
    if (source !== preflight.sources[sourceIndex] || source.parent !== preflight.layer) {
      return { status: "indeterminate", message: "Restored source identity or parent is indeterminate." };
    }
    restored.push(clipPathSnapshot(document, source, preflight.layer));
  }
  var restoredOrder = supportedPathOrder(preflight.layer);
  evidence.restoredSources = restored;
  evidence.restoredParentOrder = restoredOrder;
  if (!supportedPathSame(restored, preflight.snapshots) || !mutationSameSequence(restoredOrder, preflight.parentOrderBefore)) {
    return { status: "indeterminate", message: "Exact source or parent-order restoration is unproved." };
  }
  return { status: "verified" };
}

/** Removes one self-created item captured by reference; "failed" only when it provably stayed. */
function compoundRemoveCaptured(document, type, uuid, reference, layer) {
  var current = clipTyped(document, type, uuid);
  if (current === null) return null;
  if (current !== reference) return { status: "indeterminate", message: "Rollback refused because a created " + type + " identity changed." };
  if (current.parent !== layer && !(type === "PathItem" && current.parent && String(current.parent.typename) === "CompoundPathItem")) {
    return { status: "indeterminate", message: "Rollback refused because a created " + type + " moved." };
  }
  if (typeof current.locked !== "boolean" || typeof current.hidden !== "boolean") {
    return { status: "indeterminate", message: "Rollback " + type + " safety state is unreadable." };
  }
  if (current.locked || current.hidden) return { status: "failed", message: "Rollback refused because a created " + type + " is not safely editable." };
  try { current.remove(); } catch (error) { /* absence decides below */ }
  if (clipTyped(document, type, uuid) !== null) return { status: "failed", message: "Rollback did not remove the created " + type + "." };
  return null;
}

function compoundRollback(state) {
  var preflight = state.preflight;
  var operationState = state.operationState;
  var evidence = operationState.rollbackEvidence;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) {
    return { status: "indeterminate", message: "Rollback compound document is indeterminate." };
  }
  var document = preflight.document;
  // A duplicate() that threw, or returned without a recorded UUID, may have left an item nobody can name.
  if (evidence.duplicateUuids.length === 0 || operationState.duplicates.length !== evidence.duplicateUuids.length) {
    return { status: "indeterminate", message: "Rollback refused because a created duplicate has no recorded native UUID." };
  }
  if (preflight.layer.locked || !preflight.layer.visible) {
    return { status: "failed", message: "Rollback refused because the target layer is not safely editable." };
  }
  var outcome;
  try {
    // Measured inverse (A30_COMPOUND_MAKE): remove the created compound, which takes its two members with it.
    if (evidence.compoundUuid !== null) {
      outcome = compoundRemoveCaptured(document, "CompoundPathItem", evidence.compoundUuid, operationState.compound, preflight.layer);
      if (outcome !== null) return outcome;
    }
    // A duplicate that never became a member is removed on its own.
    for (var index = 0; index < evidence.duplicateUuids.length; index++) {
      outcome = compoundRemoveCaptured(document, "PathItem", evidence.duplicateUuids[index], operationState.duplicates[index], preflight.layer);
      if (outcome !== null) return outcome;
    }
  } catch (error) { return { status: "indeterminate", message: "Rollback compound removal is indeterminate." }; }
  if (operationState.savedSelection !== null) {
    evidence.selection = compoundRestoreSelection(document, operationState.savedSelection);
  }
  try { return compoundVerifyRestored(state); }
  catch (error) { return { status: "indeterminate", message: "Rollback compound restoration verification is indeterminate." }; }
}

var compoundExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionAffected: function (phase, preflight, plan, state) { return (phase === "after") ? [state.operationState.rollbackEvidence.compoundUuid] : []; },
  editSessionLayers: function (phase, preflight) { return [preflight.layer]; },
  initialOperationState: function () {
    return { mutationStarted: false, compound: null, duplicates: [], savedSelection: null, selection: null,
      rollbackEvidence: { compoundUuid: null, duplicateUuids: [], restoredSources: null, restoredParentOrder: null, selection: null } };
  },
  preflight: compoundPreflight,
  plan: compoundPlan,
  revalidate: compoundRevalidate,
  applyMutation: compoundApply,
  verify: compoundVerify,
  rollback: compoundRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function (state) {
    return { reasonCode: "identity_unavailable",
      message: "Compound apply outcome is indeterminate because created-path identity is unavailable.",
      evidence: { compoundUuid: null, duplicateUuids: [], restoredSources: null, restoredParentOrder: null, selection: null } };
  },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var compoundDocument = compoundExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === compoundExecution.preflight.document) compoundDocument = getDocumentContext();
var result = {
  operation: "make_compound_path", applied: compoundExecution.transaction.state === "verified",
  document: compoundDocument, plan: compoundExecution.plan, transaction: compoundExecution.transaction
};
if (compoundExecution.transaction.state === "verified") result.postcondition = compoundExecution.value;
`;
export const MAKE_COMPOUND_PATH_HOST_SCRIPT_DIGEST = canonicalSha256(MAKE_COMPOUND_PATH_SCRIPT);
export const MAKE_COMPOUND_PATH_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2,
    contractVersion: 1,
    operation: MAKE_COMPOUND_PATH_OPERATION,
    validator: MAKE_COMPOUND_PATH_VALIDATOR,
    canonicalContractVersion: CANONICAL_VERSION,
    resultSchemaVersion: RESULT_SCHEMA_VERSION,
    terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION,
    errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: MAKE_COMPOUND_PATH_SAFETY_IDENTITY,
    hostScriptDigest: MAKE_COMPOUND_PATH_HOST_SCRIPT_DIGEST,
    mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    const digestRequest = 'commandId' in request ? (({ commandId: _commandId, ...rest }) => rest)(request) : request;
    const digest = canonicalSha256({
        operation: MAKE_COMPOUND_PATH_OPERATION, validator: MAKE_COMPOUND_PATH_VALIDATOR, request: digestRequest,
    });
    return {
        intent: request.apply ? 'apply' : 'plan', request,
        commandId: 'commandId' in request ? request.commandId : null,
        documentKey: request.expectedDocumentKey, digest,
    };
}
export const makeCompoundPathToolContract = {
    name: 'illustrator_make_compound_path',
    title: 'Plan or Make Compound Path',
    description: 'Plan or make one compound path from two paths (source_uuids). Non-destructive: the two sources stay unchanged; the tool duplicates both to the back of their layer and makes the duplicates one CompoundPathItem there (use illustrator_set_stacking_order to move it). Measured profile only: two closed straight-segment paths (corner points without handles) with the same RGB or no paint, directly on the same top-level layer of an RGB document, Illustrator 30.8.1 in the foreground; curves, open paths, different paint, groups, clip groups, existing compound paths, text, sublayers, and locked or hidden items are refused. Releasing a compound path is not supported; for Pathfinder (unite, minus front, intersect, exclude) use illustrator_apply_pathfinder. The plan shows the member order (front source first), the parent order with the new compound last, and the predicted bounds. Apply compares expected_sources_before and expected_parent_order, runs the menu command with only the duplicates selected, restores the previous selection (reported, never a failure), verifies the compound, both members, the untouched sources, and the parent order by native read-back, and on failure removes only what it created.',
    inputSchema,
    publicInputSchema: makeCompoundPathPublicInputSchema,
    outputSchema: makeCompoundPathResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(MAKE_COMPOUND_PATH_SAFETY.policy),
    normalizePublicInput,
};
export function mapCompoundExecutionError(error, detail) {
    if (detail?.code === 'OBJECT_NOT_FOUND') {
        return new Error(`No PageItem with UUID ${JSON.stringify(detail.uuid ?? '')} exists in the bound document.`);
    }
    if (detail?.code === 'CLIP_UNSUPPORTED_TARGET') {
        return new Error(`Compound path source ${JSON.stringify(detail.uuid ?? '')} is outside the measured support profile (${detail.reason ?? 'unknown'}).`);
    }
    if (detail?.code === 'COMPOUND_APPLY_BLOCKED') {
        return new Error(`Compound path apply is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}.`);
    }
    return error instanceof Error ? error : new Error(String(error));
}
export function createMakeCompoundPathAdapter() {
    return {
        version: 1,
        operation: MAKE_COMPOUND_PATH_OPERATION,
        validator: MAKE_COMPOUND_PATH_VALIDATOR,
        safety: MAKE_COMPOUND_PATH_SAFETY,
        safetyRegistrationIdentity: MAKE_COMPOUND_PATH_SAFETY_IDENTITY,
        adapterIdentity: MAKE_COMPOUND_PATH_ADAPTER_IDENTITY,
        tool: makeCompoundPathToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: makeCompoundPathResultSchema,
        resultSchemaVersion: RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: CLASSIFIER_VERSION,
        safetyConformanceVersion: CONFORMANCE_VERSION,
        errorMappingVersion: ERROR_MAPPING_VERSION,
        hostScriptDigest: MAKE_COMPOUND_PATH_HOST_SCRIPT_DIGEST,
        mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: MAKE_COMPOUND_PATH_SCRIPT, params };
            return {
                kind: 'mutation', mutationValidator: MAKE_COMPOUND_PATH_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: MAKE_COMPOUND_PATH_OPERATION,
                    documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: MAKE_COMPOUND_PATH_ADAPTER_IDENTITY,
                mutationHostApplicationMode: 'foreground',
                script: MAKE_COMPOUND_PATH_SCRIPT,
                params,
            };
        },
        classifyTerminal(value) {
            const state = makeCompoundPathResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back' || state === 'rollback_failed')
                return { state };
            if (state === 'planned')
                throw new Error('Compound plan is not a terminal mutation result.');
            throw new Error('Unverified compound identity or recovery must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError: mapCompoundExecutionError,
    };
}
