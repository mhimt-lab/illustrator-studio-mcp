import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { SUPPORTED_PATH_ITEM_HOST_SCRIPT } from './supported-path-item-host-script.js';
import { PATH_EDIT_MAX_POINTS, PATH_EDIT_MEASURED_APP_VERSIONS, samePathXY, PATH_POINTS_READ_MODULE_SCRIPT, pathEditBlockerSchema, pathEditBlockers, pathEditErrorMessage, pathGeometrySchema, pathTargetSnapshotSchema, pathXYSchema, sameCanonical, samePathTarget, } from '../path-points.js';
export const EDIT_PATH_POINTS_OPERATION = 'edit_path_points';
export const EDIT_PATH_POINTS_VALIDATOR = { kind: EDIT_PATH_POINTS_OPERATION, version: 1 };
export const PATH_EDIT_MIN_POINTS = 2;
export const PATH_EDIT_KINDS = ['move_anchor', 'set_left_direction', 'set_right_direction', 'append_point', 'remove_point', 'set_closed'];
const CANONICAL_VERSION = 1;
const RESULT_SCHEMA_VERSION = 1;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
const uuidSchema = z.string().min(1).max(255);
const documentKeySchema = z.string().min(1).max(16_384);
const pointIndexSchema = z.number().int().min(0).max(PATH_EDIT_MAX_POINTS - 1);
export const pathEditSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('move_anchor'), pointIndex: pointIndexSchema, anchor: pathXYSchema }),
    z.strictObject({ kind: z.literal('set_left_direction'), pointIndex: pointIndexSchema, leftDirection: pathXYSchema }),
    z.strictObject({ kind: z.literal('set_right_direction'), pointIndex: pointIndexSchema, rightDirection: pathXYSchema }),
    z.strictObject({ kind: z.literal('append_point'), anchor: pathXYSchema, leftDirection: pathXYSchema, rightDirection: pathXYSchema }),
    z.strictObject({ kind: z.literal('remove_point'), pointIndex: pointIndexSchema }),
    z.strictObject({ kind: z.literal('set_closed'), closed: z.boolean() }),
]);
const publicPointSchema = pathXYSchema.describe('[x, y] in points, Illustrator document coordinates (the same space as geometricBounds; y increases upward).');
const publicPointIndexSchema = pointIndexSchema.describe('Zero-based index into expected_path.points.');
const publicPathEditSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('move_anchor'), point_index: publicPointIndexSchema, anchor: publicPointSchema }),
    z.strictObject({ kind: z.literal('set_left_direction'), point_index: publicPointIndexSchema, left_direction: publicPointSchema }),
    z.strictObject({ kind: z.literal('set_right_direction'), point_index: publicPointIndexSchema, right_direction: publicPointSchema }),
    z.strictObject({ kind: z.literal('append_point'), anchor: publicPointSchema, left_direction: publicPointSchema, right_direction: publicPointSchema }),
    z.strictObject({ kind: z.literal('remove_point'), point_index: publicPointIndexSchema }),
    z.strictObject({ kind: z.literal('set_closed'), closed: z.boolean() }),
]);
export function derivePathEdit(before, edit) {
    const count = before.points.length;
    if (count < PATH_EDIT_MIN_POINTS)
        throw new Error(`Path edits require a PathItem with at least ${PATH_EDIT_MIN_POINTS} points.`);
    const points = before.points.map((point) => ({
        anchor: [point.anchor[0], point.anchor[1]],
        leftDirection: [point.leftDirection[0], point.leftDirection[1]],
        rightDirection: [point.rightDirection[0], point.rightDirection[1]],
        pointType: point.pointType,
    }));
    let closed = before.closed;
    const index = (pointIndex) => {
        if (!Number.isInteger(pointIndex) || pointIndex < 0 || pointIndex >= count)
            throw new Error('point_index is outside the target path.');
        return pointIndex;
    };
    const noChange = () => new Error('The requested edit does not change the path.');
    if (edit.kind === 'move_anchor' || edit.kind === 'set_left_direction' || edit.kind === 'set_right_direction') {
        const at = index(edit.pointIndex);
        if (points[at].pointType !== 'corner')
            throw new Error('Anchor and direction edits are measured on corner points only.');
        const field = edit.kind === 'move_anchor' ? 'anchor' : edit.kind === 'set_left_direction' ? 'leftDirection' : 'rightDirection';
        const value = edit.kind === 'move_anchor' ? edit.anchor : edit.kind === 'set_left_direction' ? edit.leftDirection : edit.rightDirection;
        if (samePathXY(points[at][field], value))
            throw noChange();
        points[at][field] = [value[0], value[1]];
    }
    else if (edit.kind === 'append_point') {
        if (count + 1 > PATH_EDIT_MAX_POINTS)
            throw new Error(`A path may hold at most ${PATH_EDIT_MAX_POINTS} points.`);
        points.push({
            anchor: [edit.anchor[0], edit.anchor[1]], leftDirection: [edit.leftDirection[0], edit.leftDirection[1]],
            rightDirection: [edit.rightDirection[0], edit.rightDirection[1]], pointType: 'corner',
        });
    }
    else if (edit.kind === 'remove_point') {
        const at = index(edit.pointIndex);
        if (count - 1 < PATH_EDIT_MIN_POINTS)
            throw new Error(`At least ${PATH_EDIT_MIN_POINTS} points must remain.`);
        points.splice(at, 1);
    }
    else {
        if (edit.closed === closed)
            throw noChange();
        closed = edit.closed;
    }
    return { closed, points };
}
const commonInternal = { expectedDocumentKey: documentKeySchema, targetUuid: uuidSchema, expectedPath: pathGeometrySchema, edit: pathEditSchema };
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({ ...commonInternal, confirmedAfter: pathGeometrySchema, apply: z.literal(true), commandId: canonicalCommandIdSchema }),
]);
const commonPublic = {
    expected_document_key: documentKeySchema,
    target_uuid: uuidSchema.describe('Native PageItem.uuid of the target PathItem.'),
    expected_path: pathGeometrySchema.describe('The target path exactly as illustrator_get_path_points returned it (closed and every point); any difference beyond 0.01 pt is refused.'),
    edit: publicPathEditSchema,
};
export const editPathPointsPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({ ...commonPublic, confirmed_after: pathGeometrySchema.describe('plan.after.path from the apply:false plan.'), apply: z.literal(true), command_id: applyCommandIdSchema }),
]);
const inputSchema = z.strictObject({ ...commonPublic, confirmed_after: pathGeometrySchema.optional(), apply: z.boolean().default(false), command_id: applyCommandIdSchema.optional() });
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(editPathPointsPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizeEdit(edit) {
    if (edit.kind === 'move_anchor')
        return { kind: edit.kind, pointIndex: edit.point_index, anchor: edit.anchor };
    if (edit.kind === 'set_left_direction')
        return { kind: edit.kind, pointIndex: edit.point_index, leftDirection: edit.left_direction };
    if (edit.kind === 'set_right_direction')
        return { kind: edit.kind, pointIndex: edit.point_index, rightDirection: edit.right_direction };
    if (edit.kind === 'append_point')
        return { kind: edit.kind, anchor: edit.anchor, leftDirection: edit.left_direction, rightDirection: edit.right_direction };
    if (edit.kind === 'remove_point')
        return { kind: edit.kind, pointIndex: edit.point_index };
    return { kind: edit.kind, closed: edit.closed };
}
function normalizePublicInput(input) {
    const value = editPathPointsPublicInputSchema.parse(input);
    const common = { expectedDocumentKey: value.expected_document_key, targetUuid: value.target_uuid, expectedPath: value.expected_path, edit: normalizeEdit(value.edit) };
    return value.apply ? { ...common, confirmedAfter: value.confirmed_after, apply: true, commandId: value.command_id } : { ...common, apply: false };
}
const planSchema = z.strictObject({
    operation: z.literal(EDIT_PATH_POINTS_OPERATION),
    documentKey: documentKeySchema,
    targetUuid: uuidSchema,
    edit: pathEditSchema,
    before: pathTargetSnapshotSchema,
    after: pathTargetSnapshotSchema,
    applyBlockedReasonCodes: z.array(pathEditBlockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    if (plan.before.uuid !== plan.targetUuid)
        context.addIssue({ code: 'custom', message: 'Path edit plan must bind the target UUID.' });
    let derived = null;
    try {
        derived = derivePathEdit(plan.before.path, plan.edit);
    }
    catch {
        derived = null;
    }
    if (derived === null || !sameCanonical({ ...plan.before, path: derived }, plan.after)) {
        context.addIssue({ code: 'custom', message: 'Path edit plan after state must be derived from the before path and the edit.' });
    }
    if (plan.applyAllowed !== (plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0)) {
        context.addIssue({ code: 'custom', message: 'Path edit applyAllowed must require confirmation and no blockers.' });
    }
});
const failureSchema = z.strictObject({ phase: z.enum(['apply', 'verify']), reasonCode: z.enum(['apply_failed', 'verify_mismatch']), message: z.string().min(1).max(500) })
    .superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed'))
        context.addIssue({ code: 'custom', message: 'Path edit failure phase and reason code must match.' });
});
const indeterminateFailureSchema = z.strictObject({ phase: z.literal('apply'), reasonCode: z.literal('apply_indeterminate'), message: z.string().min(1).max(500) });
const rollbackEvidence = { restoredState: pathTargetSnapshotSchema.nullable() };
const transactionSchema = z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('planned'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('verified'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('apply_failed'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('not_required') }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('rolled_back'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('verified'), ...rollbackEvidence }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('rollback_failed'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('failed'), reasonCode: z.literal('rollback_failed'), message: z.string().min(1).max(500), ...rollbackEvidence }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('apply_indeterminate'), failure: indeterminateFailureSchema, rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('path_edit_unknown'), message: z.string().min(1).max(500), restoredState: z.null() }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('rollback_indeterminate'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('rollback_indeterminate'), message: z.string().min(1).max(500), ...rollbackEvidence }), audit: mutationAuditSchema }),
]).superRefine((transaction, context) => {
    const prefix = ['preflight:started:', 'preflight:succeeded:', 'plan:started:', 'plan:succeeded:'];
    let expected;
    if (transaction.state === 'planned')
        expected = [...prefix, 'apply:skipped:not_requested', 'verify:skipped:not_requested', 'rollback:skipped:not_requested'];
    else if (transaction.state === 'verified')
        expected = [...prefix, 'apply:started:', 'apply:attempted:', 'apply:succeeded:', 'verify:started:', 'verify:succeeded:', 'rollback:skipped:not_required'];
    else if (transaction.state === 'apply_failed')
        expected = [...prefix, 'apply:started:', 'apply:failed:apply_failed', 'verify:skipped:not_required', 'rollback:skipped:not_required'];
    else if (transaction.state === 'apply_indeterminate')
        expected = [...prefix, 'apply:started:', 'apply:attempted:', 'apply:failed:apply_indeterminate'];
    else {
        const failure = transaction.failure.phase === 'apply'
            ? ['apply:started:', 'apply:attempted:', 'apply:failed:apply_failed', 'verify:skipped:not_required']
            : ['apply:started:', 'apply:attempted:', 'apply:succeeded:', 'verify:started:', 'verify:failed:verify_mismatch'];
        expected = [...prefix, ...failure, 'rollback:started:', transaction.state === 'rolled_back' ? 'rollback:succeeded:' : `rollback:failed:${transaction.state === 'rollback_failed' ? 'rollback_failed' : 'rollback_indeterminate'}`];
    }
    const actual = transaction.audit.map((event) => `${event.phase}:${event.event}:${'reasonCode' in event ? event.reasonCode : ''}`);
    if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index]))
        context.addIssue({ code: 'custom', message: 'Path edit audit sequence does not match transaction state.' });
    transaction.audit.forEach((event, index) => { if (event.sequence !== index)
        context.addIssue({ code: 'custom', message: 'Path edit audit sequence must be contiguous.' }); });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' && event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode && event.message === transaction.failure.message);
        if (matches.length !== 1)
            context.addIssue({ code: 'custom', message: 'Path edit failure must match one audit event.' });
    }
    if (transaction.state === 'rolled_back' && transaction.rollback.restoredState === null) {
        context.addIssue({ code: 'custom', message: 'A rolled-back path edit must carry the restored snapshot.' });
    }
    if (transaction.state === 'rollback_failed' && transaction.rollback.restoredState === null) {
        context.addIssue({ code: 'custom', message: 'A failed path edit rollback must report the snapshot it observed.' });
    }
});
const postconditionSchema = z.strictObject({ state: pathTargetSnapshotSchema, saved: z.boolean() });
export const editPathPointsResultSchema = z.union([
    z.strictObject({ operation: z.literal(EDIT_PATH_POINTS_OPERATION), applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ operation: z.literal(EDIT_PATH_POINTS_OPERATION), applied: z.literal(true), document: documentContextSchema, plan: planSchema, postcondition: postconditionSchema, transaction: transactionSchema }),
]).superRefine((result, context) => {
    if (result.transaction.state === 'planned') {
        if (result.plan.confirmationStatus !== 'required' ||
            !sameCanonical(result.plan.applyBlockedReasonCodes, pathEditBlockers(result.document.mutationAllowed, result.document.appVersion, result.plan.before))) {
            context.addIssue({ code: 'custom', message: 'Planned path edit must expose exact blockers.' });
        }
    }
    else if (result.plan.confirmationStatus !== 'confirmed' || result.plan.applyBlockedReasonCodes.length !== 0 || !result.plan.applyAllowed ||
        pathEditBlockers(true, result.document.appVersion, result.plan.before).length !== 0) {
        context.addIssue({ code: 'custom', message: 'Applied path edit attempt must derive from an allowed confirmed plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified' || !samePathTarget(result.postcondition.state, result.plan.after)) {
            context.addIssue({ code: 'custom', message: 'Verified path edit must match the planned after state.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified path edit transaction must be applied.' });
    }
    if (result.transaction.state === 'rolled_back' && !samePathTarget(result.transaction.rollback.restoredState, result.plan.before)) {
        context.addIssue({ code: 'custom', message: 'Rolled-back path edit must prove the exact before snapshot.' });
    }
});
export const editPathPointsResponseSchema = z.strictObject({
    outcome: editPathPointsResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
export const EDIT_PATH_POINTS_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: EDIT_PATH_POINTS_OPERATION,
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
export const EDIT_PATH_POINTS_SAFETY_IDENTITY = canonicalDigest(EDIT_PATH_POINTS_SAFETY);
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    const beforeStateHash = canonicalDigest(result.plan.before);
    const afterStateHash = canonicalDigest(result.plan.after);
    const changeSetHash = canonicalDigest({ targetUuid: result.plan.targetUuid, edit: result.plan.edit, beforeStateHash, afterStateHash });
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'update_existing', operationId: EDIT_PATH_POINTS_OPERATION, canonicalRequestDigest: requestDigest,
        evidence: { documentKey: admissionDocumentKey, targetUuid: result.plan.targetUuid, beforeStateHash, plannedAfterStateHash: afterStateHash, plannedChangeSetDigest: changeSetHash },
        preconditions: { status: result.plan.applyBlockedReasonCodes.length === 0 ? 'satisfied' : 'blocked', compareAndSetMatched: result.plan.applyBlockedReasonCodes.length === 0 },
        confirmation: { kind: 'exact_change_set', canonicalRequestDigest: requestDigest, changeSetHash, status: result.plan.confirmationStatus },
        applyAllowed: result.plan.applyAllowed,
    });
}
function safetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' || transaction.state === 'rollback_indeterminate' || transaction.state === 'rollback_failed') {
        throw new Error('Indeterminate or failed path edit recovery cannot be terminal.');
    }
    const common = { policyVersion: 1, operationClass: 'update_existing', operationId: EDIT_PATH_POINTS_OPERATION, canonicalRequestDigest: requestDigest, planDigest: plan.planDigest, attestation };
    const boundPlan = plan;
    const beforeStateHash = boundPlan.evidence.beforeStateHash;
    const evidence = { targetUuid: result.plan.targetUuid };
    if (transaction.state === 'verified' && result.applied) {
        return operationSafetyResultSchema.parse({ ...common, evidence: { ...evidence, beforeStateHash, afterStateHash: boundPlan.evidence.plannedAfterStateHash, restoredStateHash: null, restoredBeforeStateVerified: false },
            executionEvidence: { outcome: 'completed' }, resolution: { status: 'succeeded', terminal: true, recovery: 'not_required', proof: { kind: 'verified_postcondition' }, replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    if (transaction.state === 'rolled_back') {
        return operationSafetyResultSchema.parse({ ...common, evidence: { ...evidence, beforeStateHash, afterStateHash: null, restoredStateHash: beforeStateHash, restoredBeforeStateVerified: true },
            executionEvidence: { outcome: 'completed' }, resolution: { status: 'recovered', terminal: true, recovery: 'verified', proof: { kind: 'verified_recovery' }, replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    return operationSafetyResultSchema.parse({ ...common, evidence: { ...evidence, beforeStateHash, afterStateHash: null, restoredStateHash: null, restoredBeforeStateVerified: false },
        executionEvidence: { outcome: 'proven_pre_apply' }, resolution: { status: 'failed', terminal: true, recovery: 'not_required', proof: { kind: 'proven_pre_apply', mutationAttempted: false }, replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
}
async function assertSafety(value, requestDigest, attestation, resolver) {
    const result = editPathPointsResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null)
        throw new Error('Path edit terminal result requires attestation.');
    await assertOperationSafetyAdapterConformance({ registration: EDIT_PATH_POINTS_SAFETY, plan, result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
const PATH_EDIT_MODULE_SCRIPT = `
var PATH_EDIT_MIN_POINTS = ${PATH_EDIT_MIN_POINTS};

function pathEditNativePointType(value) { return value === "smooth" ? PointType.SMOOTH : PointType.CORNER; }
function pathEditCopyPoint(point) {
  return { anchor: [point.anchor[0], point.anchor[1]], leftDirection: [point.leftDirection[0], point.leftDirection[1]],
    rightDirection: [point.rightDirection[0], point.rightDirection[1]], pointType: point.pointType };
}
function pathEditIndex(edit, count) {
  var index = edit.pointIndex;
  if (typeof index !== "number" || index % 1 !== 0 || index < 0 || index >= count) throw mutationError("preflight_failed", "point_index is outside the target path.");
  return index;
}
/** Identical to the TypeScript derivation. */
function pathEditDerive(before, edit) {
  if (!edit || typeof edit.kind !== "string") throw mutationError("preflight_failed", "edit is required.");
  var count = before.points.length;
  if (count < PATH_EDIT_MIN_POINTS) throw mutationError("preflight_failed", "Path edits require a PathItem with at least " + PATH_EDIT_MIN_POINTS + " points.");
  var points = [];
  for (var copyIndex = 0; copyIndex < count; copyIndex++) points.push(pathEditCopyPoint(before.points[copyIndex]));
  var closed = before.closed;
  var index;
  if (edit.kind === "move_anchor" || edit.kind === "set_left_direction" || edit.kind === "set_right_direction") {
    index = pathEditIndex(edit, count);
    if (points[index].pointType !== "corner") throw mutationError("preflight_failed", "Anchor and direction edits are measured on corner points only.");
    var field = edit.kind === "move_anchor" ? "anchor" : (edit.kind === "set_left_direction" ? "leftDirection" : "rightDirection");
    var value = pathEditPoint(edit[field], field);
    if (pathEditSamePoint(points[index][field], value)) throw mutationError("preflight_failed", "The requested edit does not change the path.");
    points[index][field] = value;
  } else if (edit.kind === "append_point") {
    if (count + 1 > PATH_EDIT_MAX_POINTS) throw mutationError("preflight_failed", "A path may hold at most " + PATH_EDIT_MAX_POINTS + " points.");
    points.push({ anchor: pathEditPoint(edit.anchor, "anchor"), leftDirection: pathEditPoint(edit.leftDirection, "leftDirection"),
      rightDirection: pathEditPoint(edit.rightDirection, "rightDirection"), pointType: "corner" });
  } else if (edit.kind === "remove_point") {
    index = pathEditIndex(edit, count);
    if (count - 1 < PATH_EDIT_MIN_POINTS) throw mutationError("preflight_failed", "At least " + PATH_EDIT_MIN_POINTS + " points must remain.");
    points.splice(index, 1);
  } else if (edit.kind === "set_closed") {
    if (typeof edit.closed !== "boolean") throw mutationError("preflight_failed", "closed must be a boolean.");
    if (edit.closed === closed) throw mutationError("preflight_failed", "The requested edit does not change the path.");
    closed = edit.closed;
  } else {
    throw mutationError("preflight_failed", "Unsupported path edit kind.");
  }
  return { closed: closed, points: points };
}
function pathEditWithPath(snapshot, path) {
  var copy = {};
  for (var key in snapshot) if (snapshot.hasOwnProperty(key)) copy[key] = snapshot[key];
  copy.path = path;
  return copy;
}
/** The measured exact inverse (measured operation restore): setEntirePath, closed, then per-point anchor, directions, and type. */
function pathEditRestore(target, before) {
  var anchors = [];
  for (var anchorIndex = 0; anchorIndex < before.points.length; anchorIndex++) anchors.push([before.points[anchorIndex].anchor[0], before.points[anchorIndex].anchor[1]]);
  target.setEntirePath(anchors);
  target.closed = before.closed;
  for (var index = 0; index < before.points.length; index++) {
    var from = before.points[index], to = target.pathPoints[index];
    to.anchor = [from.anchor[0], from.anchor[1]];
    to.leftDirection = [from.leftDirection[0], from.leftDirection[1]];
    to.rightDirection = [from.rightDirection[0], from.rightDirection[1]];
    to.pointType = pathEditNativePointType(from.pointType);
  }
}
`;
const EDIT_PATH_POINTS_TRANSACTION_SCRIPT = `
function pathEditResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  var target = pathEditResolveTarget(document, params.targetUuid);
  var before = pathEditSnapshot(document, target, params.targetUuid);
  if (!pathEditSameGeometry(before.path, params.expectedPath)) pathEditFailTarget("PATH_FINGERPRINT_MISMATCH", params.targetUuid);
  var afterPath = pathEditDerive(before.path, params.edit);
  var blockers = pathEditBlockers(context, before);
  if (forApply) {
    if (!pathEditSameGeometry(afterPath, params.confirmedAfter)) throw mutationError("preflight_failed", "confirmed_after does not match the planned path.");
    if (blockers.length > 0) throw new Error("MCP_ERROR:" + stringifyJson({ code: "PATH_EDIT_APPLY_BLOCKED", reasonCodes: blockers, uuid: params.targetUuid }));
  }
  return { context: context, document: document, target: target, before: before, after: pathEditWithPath(before, afterPath), blockers: blockers };
}

function pathEditPlan(preflight) {
  return { operation: "edit_path_points", documentKey: preflight.context.key, targetUuid: params.targetUuid, edit: params.edit,
    before: preflight.before, after: preflight.after, applyBlockedReasonCodes: preflight.blockers,
    confirmationStatus: params.apply === true ? "confirmed" : "required", applyAllowed: params.apply === true && preflight.blockers.length === 0 };
}

function pathEditRevalidate(preflight, plan) {
  var current;
  try { current = pathEditResolve(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Path edit preconditions changed before apply.")); }
  if (current.document !== preflight.document || current.target !== preflight.target) throw mutationBeforeSideEffectError("Path edit target native identity changed before apply.");
  if (stringifyJson(current.before) !== stringifyJson(plan.before)) throw mutationBeforeSideEffectError("Path edit target changed before apply.");
}

function pathEditApply(preflight, plan, state) {
  var target = preflight.target, edit = plan.edit, after = plan.after.path;
  state.operationState.mutationStarted = true;
  if (edit.kind === "move_anchor") {
    target.pathPoints[edit.pointIndex].anchor = [after.points[edit.pointIndex].anchor[0], after.points[edit.pointIndex].anchor[1]];
  } else if (edit.kind === "set_left_direction") {
    target.pathPoints[edit.pointIndex].leftDirection = [after.points[edit.pointIndex].leftDirection[0], after.points[edit.pointIndex].leftDirection[1]];
  } else if (edit.kind === "set_right_direction") {
    target.pathPoints[edit.pointIndex].rightDirection = [after.points[edit.pointIndex].rightDirection[0], after.points[edit.pointIndex].rightDirection[1]];
  } else if (edit.kind === "append_point") {
    var appended = after.points[after.points.length - 1];
    var added = target.pathPoints.add();
    added.anchor = [appended.anchor[0], appended.anchor[1]];
    added.leftDirection = [appended.leftDirection[0], appended.leftDirection[1]];
    added.rightDirection = [appended.rightDirection[0], appended.rightDirection[1]];
  } else if (edit.kind === "remove_point") {
    target.pathPoints[edit.pointIndex].remove();
  } else if (edit.kind === "set_closed") {
    target.closed = after.closed;
  } else {
    throw mutationError("apply_failed", "Unsupported path edit kind.");
  }
  return after.points.length;
}

function pathEditVerify(preflight, plan) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) throw mutationError("verify_mismatch", "Active document changed during path edit verification.");
  var target = supportedPathFind(preflight.document, params.targetUuid);
  if (target === null || target !== preflight.target) throw mutationError("verify_mismatch", "Path edit target native identity does not match the plan.");
  var snapshot = pathEditSnapshot(preflight.document, target, params.targetUuid);
  if (!pathEditSameTarget(snapshot, plan.after)) throw mutationError("verify_mismatch", "Path read-back does not match the planned after state.");
  return { state: snapshot, saved: preflight.document.saved === true };
}

function pathEditRollback(state) {
  var preflight = state.preflight;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
  var target;
  try { target = supportedPathFind(preflight.document, params.targetUuid); }
  catch (lookupError) { return { status: "indeterminate", message: "Rollback target lookup is indeterminate." }; }
  if (target === null || target !== preflight.target) return { status: "indeterminate", message: "Rollback target identity changed." };
  try { pathEditRestore(target, preflight.before.path); }
  catch (writeError) { return { status: "indeterminate", message: "Rollback write is indeterminate." }; }
  var snapshot;
  try { snapshot = pathEditSnapshot(preflight.document, target, params.targetUuid); }
  catch (readError) { return { status: "indeterminate", message: "Rollback verification is indeterminate." }; }
  state.operationState.rollbackEvidence.restoredState = snapshot;
  if (!pathEditSameTarget(snapshot, preflight.before)) return { status: "failed", message: "Rollback did not restore the exact before path." };
  return { status: "verified" };
}

var pathEditExecution = runMutationTransaction({
  apply: params.apply === true,
  // the items this change reads and writes, so an edit session can advance its item aggregate.
  editSessionAffected: function () { return [params.targetUuid]; },
  initialOperationState: function () { return { mutationStarted: false, rollbackEvidence: { restoredState: null } }; },
  preflight: pathEditResolve,
  plan: pathEditPlan,
  revalidate: pathEditRevalidate,
  applyMutation: pathEditApply,
  verify: pathEditVerify,
  rollback: pathEditRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () { return { reasonCode: "path_edit_unknown", message: "Path edit apply outcome is indeterminate.", evidence: { restoredState: null } }; },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var pathEditDocument = pathEditExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === pathEditExecution.preflight.document) pathEditDocument = getDocumentContext();
var result = { operation: "edit_path_points", applied: pathEditExecution.transaction.state === "verified", document: pathEditDocument, plan: pathEditExecution.plan, transaction: pathEditExecution.transaction };
if (pathEditExecution.transaction.state === "verified") result.postcondition = pathEditExecution.value;
`;
export const EDIT_PATH_POINTS_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${SUPPORTED_PATH_ITEM_HOST_SCRIPT}
${PATH_POINTS_READ_MODULE_SCRIPT}
${PATH_EDIT_MODULE_SCRIPT}
${EDIT_PATH_POINTS_TRANSACTION_SCRIPT}`;
export const EDIT_PATH_POINTS_HOST_SCRIPT_DIGEST = canonicalSha256(EDIT_PATH_POINTS_SCRIPT);
export const EDIT_PATH_POINTS_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: EDIT_PATH_POINTS_OPERATION, validator: EDIT_PATH_POINTS_VALIDATOR,
    canonicalContractVersion: CANONICAL_VERSION, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: EDIT_PATH_POINTS_SAFETY_IDENTITY, hostScriptDigest: EDIT_PATH_POINTS_HOST_SCRIPT_DIGEST,
    mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    const digestRequest = 'commandId' in request ? (({ commandId: _commandId, ...rest }) => rest)(request) : request;
    const digest = canonicalSha256({ operation: EDIT_PATH_POINTS_OPERATION, validator: EDIT_PATH_POINTS_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: 'commandId' in request ? request.commandId : null, documentKey: request.expectedDocumentKey, digest };
}
export const editPathPointsToolContract = {
    name: 'illustrator_edit_path_points',
    title: 'Plan or Edit Path Points',
    description: `Plan or apply one measured point edit to one PathItem bound by document key, native UUID, and expected_path (the closed flag and every point from illustrator_get_path_points; 0.01 pt tolerance). edit.kind is move_anchor, set_left_direction, or set_right_direction (corner points only), append_point (adds a corner point at the end), remove_point (at least ${PATH_EDIT_MIN_POINTS} points remain), or set_closed. Coordinates are points in Illustrator document coordinates, the same space as geometricBounds. The plan returns the full before and after path and blockers (locked or hidden target or layer; unmeasured Illustrator version — only ${PATH_EDIT_MEASURED_APP_VERSIONS.join(', ')}). Apply echoes plan.after.path as confirmed_after, requires the unlocked foreground host, verifies the whole path by native read-back, and on failure restores the exact before path with the measured inverse. Group members, CompoundPathItem members, clipping paths, guides, and paths with more than ${PATH_EDIT_MAX_POINTS} points are refused. Changing a point type is not offered: on the measured host a SMOOTH write reads back SMOOTH in the same call but CORNER in the next call.`,
    inputSchema,
    publicInputSchema: editPathPointsPublicInputSchema,
    outputSchema: editPathPointsResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(EDIT_PATH_POINTS_SAFETY.policy),
    normalizePublicInput,
};
export function createEditPathPointsAdapter() {
    return {
        version: 1, operation: EDIT_PATH_POINTS_OPERATION, validator: EDIT_PATH_POINTS_VALIDATOR,
        safety: EDIT_PATH_POINTS_SAFETY, safetyRegistrationIdentity: EDIT_PATH_POINTS_SAFETY_IDENTITY,
        adapterIdentity: EDIT_PATH_POINTS_ADAPTER_IDENTITY, tool: editPathPointsToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: editPathPointsResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
        safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: EDIT_PATH_POINTS_HOST_SCRIPT_DIGEST,
        mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: EDIT_PATH_POINTS_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: EDIT_PATH_POINTS_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: EDIT_PATH_POINTS_OPERATION, documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: EDIT_PATH_POINTS_ADAPTER_IDENTITY, mutationHostApplicationMode: 'foreground', script: EDIT_PATH_POINTS_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = editPathPointsResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back')
                return { state };
            if (state === 'planned')
                throw new Error('Path edit plan is not a terminal mutation result.');
            throw new Error('Unverified path edit recovery must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error, detail) {
            const message = pathEditErrorMessage(detail);
            if (message !== null)
                return new Error(message);
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
