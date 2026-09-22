import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { snapshotsWithinTolerance, TRANSFORM_BOUNDS_TOLERANCE_PT, TRANSFORM_OBJECT_MODULE_SCRIPT, transformPathSnapshotSchema as transformObjectSnapshotSchema, } from './transform-object-adapter.js';
export const ALIGN_OBJECTS_OPERATION = 'align_objects';
export const ALIGN_OBJECTS_VALIDATOR = { kind: ALIGN_OBJECTS_OPERATION, version: 1 };
export const ALIGN_MIN_TARGETS = 2;
export const ALIGN_MIN_DISTRIBUTE_TARGETS = 3;
export const ALIGN_MAX_TARGETS = 16;
export const ALIGN_PRECISION_DIGITS = 6;
const CANONICAL_VERSION = 1;
const RESULT_SCHEMA_VERSION = 1;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
const uuidSchema = z.string().min(1).max(255);
const documentKeySchema = z.string().min(1).max(16_384);
export const ALIGN_AXES = ['left', 'center_x', 'right', 'top', 'center_y', 'bottom'];
export const DISTRIBUTE_AXES = ['x', 'y'];
function sameCanonical(left, right) {
    return canonicalSha256(left) === canonicalSha256(right);
}
function round(value) {
    const rounded = Number(value.toFixed(ALIGN_PRECISION_DIGITS));
    return Object.is(rounded, -0) ? 0 : rounded;
}
function isHorizontal(axis) { return axis === 'left' || axis === 'center_x' || axis === 'right'; }
export function boundsEdge(bounds, axis) {
    if (axis === 'left')
        return bounds[0];
    if (axis === 'right')
        return bounds[2];
    if (axis === 'center_x')
        return (bounds[0] + bounds[2]) / 2;
    if (axis === 'top')
        return bounds[1];
    if (axis === 'bottom')
        return bounds[3];
    return (bounds[1] + bounds[3]) / 2;
}
const alignLayoutSchema = z.strictObject({
    kind: z.literal('align'), axis: z.enum(ALIGN_AXES), reference: z.enum(['first', 'artboard']),
    artboardIndex: z.number().int().safe().nonnegative().optional(),
}).superRefine((layout, context) => {
    if (layout.reference === 'artboard' && layout.artboardIndex === undefined) {
        context.addIssue({ code: 'custom', message: 'Aligning to the artboard needs an artboard index.' });
    }
    if (layout.reference === 'first' && layout.artboardIndex !== undefined) {
        context.addIssue({ code: 'custom', message: 'Aligning to the first target takes no artboard index.' });
    }
});
const distributeLayoutSchema = z.strictObject({ kind: z.literal('distribute'), axis: z.enum(DISTRIBUTE_AXES) });
export const alignLayoutUnionSchema = z.discriminatedUnion('kind', [alignLayoutSchema, distributeLayoutSchema]);
function refineTargets(targets, layout, context) {
    const uuids = targets.map((target) => target.targetUuid);
    if (new Set(uuids).size !== uuids.length)
        context.addIssue({ code: 'custom', message: 'Align targets must be distinct native UUIDs.' });
    if (layout.kind === 'distribute' && targets.length < ALIGN_MIN_DISTRIBUTE_TARGETS) {
        context.addIssue({ code: 'custom', message: `Distribute needs at least ${ALIGN_MIN_DISTRIBUTE_TARGETS} targets.` });
    }
}
const internalPlanTargetSchema = z.strictObject({ targetUuid: uuidSchema });
const internalApplyTargetSchema = z.strictObject({
    targetUuid: uuidSchema, expectedBefore: transformObjectSnapshotSchema, confirmedAfter: transformObjectSnapshotSchema,
});
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ expectedDocumentKey: documentKeySchema, layout: alignLayoutUnionSchema,
        targets: z.array(internalPlanTargetSchema).min(ALIGN_MIN_TARGETS).max(ALIGN_MAX_TARGETS), apply: z.literal(false) })
        .superRefine((value, context) => refineTargets(value.targets, value.layout, context)),
    z.strictObject({ expectedDocumentKey: documentKeySchema, layout: alignLayoutUnionSchema,
        targets: z.array(internalApplyTargetSchema).min(ALIGN_MIN_TARGETS).max(ALIGN_MAX_TARGETS), apply: z.literal(true),
        commandId: canonicalCommandIdSchema })
        .superRefine((value, context) => refineTargets(value.targets, value.layout, context)),
]);
const publicAlignLayoutSchema = z.strictObject({
    kind: z.literal('align'), axis: z.enum(ALIGN_AXES), reference: z.enum(['first', 'artboard']),
    artboard_index: z.number().int().safe().nonnegative().optional(),
}).superRefine((layout, context) => {
    if (layout.reference === 'artboard' && layout.artboard_index === undefined) {
        context.addIssue({ code: 'custom', message: 'Aligning to the artboard needs an artboard index.' });
    }
    if (layout.reference === 'first' && layout.artboard_index !== undefined) {
        context.addIssue({ code: 'custom', message: 'Aligning to the first target takes no artboard index.' });
    }
});
const publicLayoutSchema = z.discriminatedUnion('kind', [publicAlignLayoutSchema, distributeLayoutSchema]);
const publicPlanTargetSchema = z.strictObject({ target_uuid: uuidSchema });
const publicApplyTargetSchema = z.strictObject({
    target_uuid: uuidSchema, expected_before: transformObjectSnapshotSchema, confirmed_after: transformObjectSnapshotSchema,
});
function normalizeLayout(layout) {
    if (layout.kind === 'distribute')
        return layout;
    return { kind: 'align', axis: layout.axis, reference: layout.reference,
        ...(layout.artboard_index === undefined ? {} : { artboardIndex: layout.artboard_index }) };
}
export const alignObjectsPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ expected_document_key: documentKeySchema, layout: publicLayoutSchema,
        targets: z.array(publicPlanTargetSchema).min(ALIGN_MIN_TARGETS).max(ALIGN_MAX_TARGETS), apply: z.literal(false).default(false) })
        .superRefine((value, context) => refineTargets(value.targets.map((t) => ({ targetUuid: t.target_uuid })), normalizeLayout(value.layout), context)),
    z.strictObject({ expected_document_key: documentKeySchema, layout: publicLayoutSchema,
        targets: z.array(publicApplyTargetSchema).min(ALIGN_MIN_TARGETS).max(ALIGN_MAX_TARGETS), apply: z.literal(true),
        command_id: applyCommandIdSchema })
        .superRefine((value, context) => refineTargets(value.targets.map((t) => ({ targetUuid: t.target_uuid })), normalizeLayout(value.layout), context)),
]);
const inputSchema = z.strictObject({
    expected_document_key: documentKeySchema,
    layout: z.strictObject({ kind: z.enum(['align', 'distribute']), axis: z.string().min(1).max(16),
        reference: z.enum(['first', 'artboard']).optional(), artboard_index: z.number().int().safe().nonnegative().optional() }),
    targets: z.array(z.strictObject({ target_uuid: uuidSchema, expected_before: transformObjectSnapshotSchema.optional(),
        confirmed_after: transformObjectSnapshotSchema.optional() })).min(ALIGN_MIN_TARGETS).max(ALIGN_MAX_TARGETS),
    apply: z.boolean().default(false),
    command_id: applyCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(alignObjectsPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function isApplyWithoutPlan(input) {
    if (typeof input !== 'object' || input === null)
        return false;
    const { apply, targets } = input;
    if (apply !== true || !Array.isArray(targets))
        return false;
    return targets.some((target) => typeof target !== 'object' || target === null
        || target.expected_before === undefined
        || target.confirmed_after === undefined);
}
function normalizePublicInput(input) {
    const parsed = alignObjectsPublicInputSchema.safeParse(input);
    if (!parsed.success) {
        if (isApplyWithoutPlan(input)) {
            throw new Error('Applying needs a plan first: call illustrator_align_objects with apply:false, then repeat with apply:true, a new command_id, and each target\'s expected_before and confirmed_after from that plan.');
        }
        throw parsed.error;
    }
    const value = parsed.data;
    const layout = normalizeLayout(value.layout);
    if (value.apply) {
        return { expectedDocumentKey: value.expected_document_key, layout,
            targets: value.targets.map((target) => ({ targetUuid: target.target_uuid, expectedBefore: target.expected_before, confirmedAfter: target.confirmed_after })),
            apply: true, commandId: value.command_id };
    }
    return { expectedDocumentKey: value.expected_document_key, layout, targets: value.targets.map((target) => ({ targetUuid: target.target_uuid })), apply: false };
}
export function deriveAlignDeltas(layout, befores, artboardBounds) {
    if (layout.kind === 'align') {
        const horizontal = isHorizontal(layout.axis);
        let reference;
        if (layout.reference === 'first')
            reference = boundsEdge(befores[0].geometricBounds, layout.axis);
        else {
            if (artboardBounds === null)
                throw new Error('Aligning to the artboard needs artboard bounds.');
            reference = boundsEdge(artboardBounds, layout.axis);
        }
        return befores.map((before) => {
            const delta = round(reference - boundsEdge(before.geometricBounds, layout.axis));
            return horizontal ? { deltaX: delta, deltaY: 0 } : { deltaX: 0, deltaY: delta };
        });
    }
    const axis = layout.axis === 'x' ? 'center_x' : 'center_y';
    const order = befores.map((before, index) => ({ index, centre: boundsEdge(before.geometricBounds, axis) }))
        .sort((left, right) => left.centre - right.centre || left.index - right.index);
    const first = order[0].centre;
    const last = order[order.length - 1].centre;
    const step = (last - first) / (order.length - 1);
    const deltas = befores.map(() => ({ deltaX: 0, deltaY: 0 }));
    order.forEach((entry, position) => {
        const delta = position === 0 || position === order.length - 1 ? 0 : round(first + step * position - entry.centre);
        deltas[entry.index] = layout.axis === 'x' ? { deltaX: delta, deltaY: 0 } : { deltaX: 0, deltaY: delta };
    });
    return deltas;
}
function translatedSnapshot(before, deltaX, deltaY) {
    return { ...before,
        geometricBounds: [before.geometricBounds[0] + deltaX, before.geometricBounds[1] + deltaY, before.geometricBounds[2] + deltaX, before.geometricBounds[3] + deltaY],
        position: [before.position[0] + deltaX, before.position[1] + deltaY] };
}
const blockerSchema = z.enum(['document_mutation_not_allowed', 'target_locked', 'target_hidden', 'target_not_editable', 'layer_hidden', 'layer_locked']);
const BLOCKER_ORDER = blockerSchema.options;
function unionBlockers(perTarget) {
    const present = new Set();
    for (const blockers of perTarget)
        for (const blocker of blockers)
            present.add(blocker);
    return BLOCKER_ORDER.filter((blocker) => present.has(blocker));
}
function targetBlockers(mutationAllowed, before) {
    const blockers = [];
    if (!mutationAllowed)
        blockers.push('document_mutation_not_allowed');
    if (before.locked)
        blockers.push('target_locked');
    if (before.hidden)
        blockers.push('target_hidden');
    if (!before.editable)
        blockers.push('target_not_editable');
    if (!before.layerVisible)
        blockers.push('layer_hidden');
    if (before.layerLocked)
        blockers.push('layer_locked');
    return blockers;
}
const planTargetSchema = z.strictObject({
    targetUuid: uuidSchema,
    delta: z.strictObject({ deltaX: z.number().finite(), deltaY: z.number().finite() }),
    moves: z.boolean(),
    before: transformObjectSnapshotSchema,
    after: transformObjectSnapshotSchema,
    applyBlockedReasonCodes: z.array(blockerSchema),
});
const boundsSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
const planSchema = z.strictObject({
    operation: z.literal(ALIGN_OBJECTS_OPERATION),
    documentKey: documentKeySchema,
    layout: alignLayoutUnionSchema,
    artboardBounds: boundsSchema.nullable(),
    targets: z.array(planTargetSchema).min(ALIGN_MIN_TARGETS).max(ALIGN_MAX_TARGETS),
    applyBlockedReasonCodes: z.array(blockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    const uuids = plan.targets.map((target) => target.targetUuid);
    if (new Set(uuids).size !== uuids.length)
        context.addIssue({ code: 'custom', message: 'Align plan targets must be distinct.' });
    if (plan.layout.kind === 'distribute' && plan.targets.length < ALIGN_MIN_DISTRIBUTE_TARGETS) {
        context.addIssue({ code: 'custom', message: 'Distribute plan needs at least three targets.' });
    }
    if ((plan.layout.kind === 'align' && plan.layout.reference === 'artboard') !== (plan.artboardBounds !== null)) {
        context.addIssue({ code: 'custom', message: 'Align plan artboard bounds must be present exactly for the artboard reference.' });
    }
    let deltas = [];
    try {
        deltas = deriveAlignDeltas(plan.layout, plan.targets.map((target) => target.before), plan.artboardBounds);
    }
    catch {
        context.addIssue({ code: 'custom', message: 'Align plan deltas cannot be derived.' });
        return;
    }
    plan.targets.forEach((target, index) => {
        if (target.targetUuid !== target.before.uuid || target.before.type !== 'PathItem' || target.before.pathGeometry !== null || target.before.stroke !== null) {
            context.addIssue({ code: 'custom', message: 'Align plan target must be a translate-profile PathItem snapshot bound to its UUID.' });
        }
        if (!sameCanonical(target.delta, deltas[index]) || target.moves !== (target.delta.deltaX !== 0 || target.delta.deltaY !== 0)) {
            context.addIssue({ code: 'custom', message: 'Align plan delta must equal the delta derived from the before states.' });
        }
        if (!snapshotsWithinTolerance(target.after, translatedSnapshot(target.before, target.delta.deltaX, target.delta.deltaY))) {
            context.addIssue({ code: 'custom', message: 'Align plan after snapshot must be the before snapshot translated by the delta.' });
        }
    });
    if (!sameCanonical(plan.applyBlockedReasonCodes, unionBlockers(plan.targets.map((target) => target.applyBlockedReasonCodes)))) {
        context.addIssue({ code: 'custom', message: 'Align blockers must be the ordered union of every target blocker.' });
    }
    if (plan.applyAllowed !== (plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0)) {
        context.addIssue({ code: 'custom', message: 'Align applyAllowed must require confirmation and no blockers.' });
    }
});
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']), reasonCode: z.enum(['apply_failed', 'verify_mismatch']), message: z.string().min(1).max(500),
}).superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed'))
        context.addIssue({ code: 'custom', message: 'Align failure phase and reason code must match.' });
});
const indeterminateFailureSchema = z.strictObject({ phase: z.literal('apply'), reasonCode: z.literal('apply_indeterminate'), message: z.string().min(1).max(500) });
const rollbackTargetSchema = z.strictObject({
    targetUuid: uuidSchema,
    outcome: z.enum(['not_written', 'unchanged', 'restored', 'outstanding', 'indeterminate']),
    restoredSnapshot: transformObjectSnapshotSchema.nullable(),
    observedSnapshot: transformObjectSnapshotSchema.nullable(),
});
const rollbackEvidence = {
    attemptedCount: z.number().int().min(0).max(ALIGN_MAX_TARGETS),
    targets: z.array(rollbackTargetSchema).min(ALIGN_MIN_TARGETS).max(ALIGN_MAX_TARGETS),
};
const transactionSchema = z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('planned'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('verified'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('apply_failed'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('not_required') }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('rolled_back'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('verified'), ...rollbackEvidence }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('rollback_failed'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('failed'), reasonCode: z.literal('rollback_failed'), message: z.string().min(1).max(500), ...rollbackEvidence }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('apply_indeterminate'), failure: indeterminateFailureSchema, rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('align_state_unknown'), message: z.string().min(1).max(500), ...rollbackEvidence }), audit: mutationAuditSchema }),
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
        expected = [...prefix, ...failure, 'rollback:started:', transaction.state === 'rolled_back' ? 'rollback:succeeded:'
                : `rollback:failed:${transaction.state === 'rollback_failed' ? 'rollback_failed' : 'rollback_indeterminate'}`];
    }
    const actual = transaction.audit.map((event) => `${event.phase}:${event.event}:${'reasonCode' in event ? event.reasonCode : ''}`);
    if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
        context.addIssue({ code: 'custom', message: 'Align audit sequence does not match transaction state.' });
    }
    transaction.audit.forEach((event, index) => { if (event.sequence !== index)
        context.addIssue({ code: 'custom', message: 'Align audit sequence must be contiguous.' }); });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' && event.phase === transaction.failure.phase &&
            event.reasonCode === transaction.failure.reasonCode && event.message === transaction.failure.message);
        if (matches.length !== 1)
            context.addIssue({ code: 'custom', message: 'Align failure must match one audit event.' });
    }
    if ('rollback' in transaction && 'targets' in transaction.rollback) {
        const targets = transaction.rollback.targets;
        const attempted = transaction.rollback.attemptedCount;
        const moving = targets.filter((target) => target.outcome !== 'unchanged');
        if (attempted > moving.length || moving.some((target, index) => (target.outcome === 'not_written') !== (index >= attempted))) {
            context.addIssue({ code: 'custom', message: 'Align rollback evidence must mark exactly the unattempted moving targets as not written.' });
        }
        if (transaction.state !== 'apply_indeterminate' && 'failure' in transaction && transaction.failure.phase === 'verify' && attempted !== moving.length) {
            context.addIssue({ code: 'custom', message: 'A verify failure implies every moving target was attempted.' });
        }
        if (transaction.state === 'rolled_back' && ((attempted === 0 && moving.length > 0) || moving.some((target, index) => index < attempted && target.outcome !== 'restored'))) {
            context.addIssue({ code: 'custom', message: 'A rolled-back align must prove every attempted target restored.' });
        }
        if (transaction.state === 'rollback_failed' && (targets.some((target) => target.outcome === 'indeterminate') || !targets.some((target) => target.outcome === 'outstanding'))) {
            context.addIssue({ code: 'custom', message: 'A failed align rollback must name an outstanding target and prove the rest.' });
        }
        for (const target of targets) {
            if ((target.outcome === 'restored') !== (target.restoredSnapshot !== null) || (target.outcome === 'outstanding') !== (target.observedSnapshot !== null) ||
                (target.restoredSnapshot !== null && target.restoredSnapshot.uuid !== target.targetUuid) || (target.observedSnapshot !== null && target.observedSnapshot.uuid !== target.targetUuid)) {
                context.addIssue({ code: 'custom', message: 'Align rollback target snapshots must match their outcome and target.' });
            }
        }
    }
});
export const alignObjectsResultSchema = z.union([
    z.strictObject({ operation: z.literal(ALIGN_OBJECTS_OPERATION), applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ operation: z.literal(ALIGN_OBJECTS_OPERATION), applied: z.literal(true), document: documentContextSchema, plan: planSchema,
        postcondition: z.array(transformObjectSnapshotSchema).min(ALIGN_MIN_TARGETS).max(ALIGN_MAX_TARGETS), transaction: transactionSchema }),
]).superRefine((result, context) => {
    if (result.transaction.state === 'planned') {
        const exact = result.plan.targets.every((target) => sameCanonical(target.applyBlockedReasonCodes, targetBlockers(result.document.mutationAllowed, target.before)));
        if (result.plan.confirmationStatus !== 'required' || !exact)
            context.addIssue({ code: 'custom', message: 'Planned align must expose exact blockers for every target.' });
    }
    else if (result.plan.confirmationStatus !== 'confirmed' || result.plan.applyBlockedReasonCodes.length !== 0 || !result.plan.applyAllowed ||
        result.plan.targets.some((target) => target.applyBlockedReasonCodes.length !== 0 || targetBlockers(true, target.before).length !== 0)) {
        context.addIssue({ code: 'custom', message: 'Applied align attempt must derive from an allowed confirmed plan.' });
    }
    if (result.applied) {
        const matches = result.transaction.state === 'verified' && result.postcondition.length === result.plan.targets.length &&
            result.plan.targets.every((target, index) => snapshotsWithinTolerance(result.postcondition[index], target.after));
        if (!matches)
            context.addIssue({ code: 'custom', message: 'Verified align must match every planned after snapshot in order.' });
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified align transaction must be applied.' });
    }
    if ('rollback' in result.transaction && 'targets' in result.transaction.rollback) {
        const rollbackTargets = result.transaction.rollback.targets;
        if (rollbackTargets.length !== result.plan.targets.length ||
            rollbackTargets.some((target, index) => target.targetUuid !== result.plan.targets[index].targetUuid ||
                (target.outcome === 'unchanged') !== !result.plan.targets[index].moves)) {
            context.addIssue({ code: 'custom', message: 'Align rollback evidence must cover every plan target in order, unchanged targets marked as such.' });
        }
        else if (rollbackTargets.some((target, index) => target.outcome === 'restored' && !snapshotsWithinTolerance(target.restoredSnapshot, result.plan.targets[index].before))) {
            context.addIssue({ code: 'custom', message: 'Restored align targets must prove exact before restoration.' });
        }
    }
});
export const alignObjectsResponseSchema = z.strictObject({
    outcome: alignObjectsResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
export const ALIGN_OBJECTS_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: ALIGN_OBJECTS_OPERATION,
    policy: {
        version: 1, class: 'update_existing', destructive: false,
        evidence: { identity: 'target_native_uuid_set', beforeState: 'before_state_hash', postcondition: 'updated_state_matches_plan' },
        preconditions: { documentBinding: 'explicit_document_key', compareAndSet: 'before_state_hash_match' },
        confirmation: 'exact_change_set',
        recovery: { mode: 'verified_inverse', verification: 'restored_state_matches_before_hash', partialRecovery: 'indeterminate' },
        terminal: { success: 'verified', failure: 'proven_pre_apply_or_verified_recovery', partialSuccess: 'nonterminal_until_reconciled' },
        replay: { requestBinding: 'canonical_request_digest', retry: 'return_attested_terminal_result', beforeTerminal: 'reconcile_required', reapplyOnRetry: false },
    },
    capabilities: {
        class: 'update_existing', explicitDocumentBinding: true, bindTargetNativeUuid: true, captureBeforeStateHash: true, compareAndSetBeforeApply: true,
        verifyUpdatedState: true, recoveryMode: 'verified_inverse', verifyRestoredBeforeState: true, reconcileIndeterminate: true,
        durableTerminalReplay: true, trustedTerminalAttestationResolver: true,
    },
});
export const ALIGN_OBJECTS_SAFETY_IDENTITY = canonicalDigest(ALIGN_OBJECTS_SAFETY);
function targetEvidence(result) {
    const targetUuids = result.plan.targets.map((target) => target.targetUuid);
    return { targetUuids, targetSetHash: canonicalDigest(targetUuids) };
}
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    const beforeStateHash = canonicalDigest(result.plan.targets.map((target) => target.before));
    const afterStateHash = canonicalDigest(result.plan.targets.map((target) => target.after));
    const changeSetHash = canonicalDigest({ layout: result.plan.layout,
        targets: result.plan.targets.map((target) => ({ targetUuid: target.targetUuid, delta: target.delta, beforeStateHash: canonicalDigest(target.before), afterStateHash: canonicalDigest(target.after) })),
        beforeStateHash, afterStateHash });
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'update_existing', operationId: ALIGN_OBJECTS_OPERATION, canonicalRequestDigest: requestDigest,
        evidence: { documentKey: admissionDocumentKey, ...targetEvidence(result), beforeStateHash, plannedAfterStateHash: afterStateHash, plannedChangeSetDigest: changeSetHash },
        preconditions: { status: result.plan.applyBlockedReasonCodes.length === 0 ? 'satisfied' : 'blocked', compareAndSetMatched: result.plan.applyBlockedReasonCodes.length === 0 },
        confirmation: { kind: 'exact_change_set', canonicalRequestDigest: requestDigest, changeSetHash, status: result.plan.confirmationStatus },
        applyAllowed: result.plan.applyAllowed,
    });
}
function safetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' || transaction.state === 'rollback_indeterminate' || transaction.state === 'rollback_failed') {
        throw new Error('Indeterminate or failed align recovery cannot be terminal.');
    }
    const common = { policyVersion: 1, operationClass: 'update_existing', operationId: ALIGN_OBJECTS_OPERATION, canonicalRequestDigest: requestDigest, planDigest: plan.planDigest, attestation };
    const boundPlan = plan;
    const beforeStateHash = boundPlan.evidence.beforeStateHash;
    const evidence = targetEvidence(result);
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
    const result = alignObjectsResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null)
        throw new Error('Align terminal result requires attestation.');
    await assertOperationSafetyAdapterConformance({ registration: ALIGN_OBJECTS_SAFETY, plan, result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
export const ALIGN_OBJECTS_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${TRANSFORM_OBJECT_MODULE_SCRIPT}
var ALIGN_MIN_TARGETS = ${ALIGN_MIN_TARGETS};
var ALIGN_MIN_DISTRIBUTE_TARGETS = ${ALIGN_MIN_DISTRIBUTE_TARGETS};
var ALIGN_MAX_TARGETS = ${ALIGN_MAX_TARGETS};
var ALIGN_PRECISION_DIGITS = ${ALIGN_PRECISION_DIGITS};
var ALIGN_AXES = ${JSON.stringify(ALIGN_AXES)};
var ALIGN_BLOCKER_ORDER = ${JSON.stringify(BLOCKER_ORDER)};

function alignRound(value) {
  var rounded = Number(mutationFiniteNumber(value, "delta").toFixed(ALIGN_PRECISION_DIGITS));
  return rounded === 0 ? 0 : rounded;
}
function alignEdge(bounds, axis) {
  if (axis === "left") return bounds[0]; if (axis === "right") return bounds[2]; if (axis === "center_x") return (bounds[0] + bounds[2]) / 2;
  if (axis === "top") return bounds[1]; if (axis === "bottom") return bounds[3]; return (bounds[1] + bounds[3]) / 2;
}
function alignIsHorizontal(axis) { return axis === "left" || axis === "center_x" || axis === "right"; }
function alignDeltas(layout, befores, artboardBounds) {
  var deltas = [];
  if (layout.kind === "align") {
    var horizontal = alignIsHorizontal(layout.axis);
    var reference = layout.reference === "first" ? alignEdge(befores[0].geometricBounds, layout.axis) : alignEdge(artboardBounds, layout.axis);
    for (var i = 0; i < befores.length; i++) {
      var delta = alignRound(reference - alignEdge(befores[i].geometricBounds, layout.axis));
      deltas.push(horizontal ? { deltaX: delta, deltaY: 0 } : { deltaX: 0, deltaY: delta });
    }
    return deltas;
  }
  var axis = layout.axis === "x" ? "center_x" : "center_y";
  var order = [];
  for (var j = 0; j < befores.length; j++) order.push({ index: j, centre: alignEdge(befores[j].geometricBounds, axis) });
  order.sort(function (l, r) { return (l.centre - r.centre) || (l.index - r.index); });
  var first = order[0].centre, last = order[order.length - 1].centre, step = (last - first) / (order.length - 1);
  for (var d = 0; d < befores.length; d++) deltas.push({ deltaX: 0, deltaY: 0 });
  for (var p = 0; p < order.length; p++) {
    var value = (p === 0 || p === order.length - 1) ? 0 : alignRound(first + step * p - order[p].centre);
    deltas[order[p].index] = layout.axis === "x" ? { deltaX: value, deltaY: 0 } : { deltaX: 0, deltaY: value };
  }
  return deltas;
}
function alignUnionBlockers(perTarget) {
  var present = {};
  for (var t = 0; t < perTarget.length; t++) for (var b = 0; b < perTarget[t].length; b++) present[perTarget[t][b]] = true;
  var union = [];
  for (var o = 0; o < ALIGN_BLOCKER_ORDER.length; o++) if (present[ALIGN_BLOCKER_ORDER[o]]) union.push(ALIGN_BLOCKER_ORDER[o]);
  return union;
}
function alignTargetBlockers(context, before) {
  var blockers = [];
  if (!context.mutationAllowed) blockers.push("document_mutation_not_allowed");
  if (before.locked) blockers.push("target_locked");
  if (before.hidden) blockers.push("target_hidden");
  if (!before.editable) blockers.push("target_not_editable");
  if (!before.layerVisible) blockers.push("layer_hidden");
  if (before.layerLocked) blockers.push("layer_locked");
  return blockers;
}
function alignArtboardRect(document, artboardIndex) {
  if (typeof artboardIndex !== "number" || Math.floor(artboardIndex) !== artboardIndex || artboardIndex < 0 ||
      !document.artboards || artboardIndex >= document.artboards.length) throw mutationError("preflight_failed", "The requested artboard does not exist in the bound document.");
  var rect = document.artboards[artboardIndex].artboardRect;
  return [mutationFiniteNumber(rect[0], "artboardRect[0]"), mutationFiniteNumber(rect[1], "artboardRect[1]"), mutationFiniteNumber(rect[2], "artboardRect[2]"), mutationFiniteNumber(rect[3], "artboardRect[3]")];
}
function withStepParams(step, fn) {
  var saved = params;
  params = step.params;
  try { return fn(); }
  finally { params = saved; }
}
function alignStepLabel(step) { return "Target " + (step.index + 1) + " (" + step.request.targetUuid + ")"; }
function alignStepError(step, error) {
  if (error && typeof error.mutationPublicMessage === "string" && error.mutationPublicMessage.length > 0) {
    var named = mutationError(error.mutationReasonCode || "preflight_failed", alignStepLabel(step) + ": " + error.mutationPublicMessage);
    if (error.mutationBeforeSideEffect === true) named.mutationBeforeSideEffect = true;
    return named;
  }
  return error;
}
/** The transform module's snapshot needs a translate-shaped params; the delta is filled in after derivation. */
function alignStepParams(batchParams, request, delta) {
  return { expectedDocumentKey: batchParams.expectedDocumentKey, apply: batchParams.apply === true, targetUuid: request.targetUuid,
    transform: { type: "translate", deltaX: delta.deltaX, deltaY: delta.deltaY } };
}

/** Resolves the document once, snapshots every target, derives deltas, then plans each moving target through the transform module. */
function alignResolve(forApply) {
  var batchParams = params;
  var context = forApply ? requireDocument(batchParams.expectedDocumentKey) : requireDocumentForRead(batchParams.expectedDocumentKey);
  var document = app.activeDocument;
  var requested = batchParams.targets;
  var layout = batchParams.layout;
  if (!requested || typeof requested.length !== "number" || requested.length < ALIGN_MIN_TARGETS || requested.length > ALIGN_MAX_TARGETS) {
    throw mutationError("preflight_failed", "Align requires " + ALIGN_MIN_TARGETS + " to " + ALIGN_MAX_TARGETS + " targets.");
  }
  if (!layout || (layout.kind !== "align" && layout.kind !== "distribute")) throw mutationError("preflight_failed", "Align requires an align or distribute layout.");
  if (layout.kind === "distribute" && requested.length < ALIGN_MIN_DISTRIBUTE_TARGETS) throw mutationError("preflight_failed", "Distribute requires at least " + ALIGN_MIN_DISTRIBUTE_TARGETS + " targets.");
  var artboardBounds = (layout.kind === "align" && layout.reference === "artboard") ? alignArtboardRect(document, layout.artboardIndex) : null;
  var seen = {};
  var steps = [];
  var befores = [];
  for (var index = 0; index < requested.length; index++) {
    var request = requested[index];
    if (typeof request.targetUuid !== "string" || request.targetUuid.length === 0 || seen["u:" + request.targetUuid] === true) {
      throw mutationError("preflight_failed", "Align targets must be distinct non-empty native UUIDs.");
    }
    seen["u:" + request.targetUuid] = true;
    var step = { index: index, request: request, params: alignStepParams(batchParams, request, { deltaX: 0, deltaY: 0 }) };
    var target = transformFindTarget(document, request.targetUuid);
    if (target === null) throw new Error("MCP_ERROR:" + stringifyJson({ code: "OBJECT_NOT_FOUND", uuid: request.targetUuid }));
    // Measured profile only: a standalone PathItem directly on its layer. Compound paths, clipping paths,
    // guides, sliced or isolated items and group members are unmeasured for alignment and fail closed.
    if (String(target.typename) !== "PathItem" || !target.layer || target.parent !== target.layer ||
        target.clipping === true || target.guides === true || target.sliced === true || target.isIsolated === true || target.wrapped === true) {
      throw mutationError("preflight_failed", alignStepLabel(step) + ": align supports standalone layer-direct PathItems only.");
    }
    var before;
    try { before = withStepParams(step, function () { return transformSnapshot(document, target); }); }
    catch (snapshotError) { throw alignStepError(step, snapshotError); }
    step.target = target;
    steps.push(step);
    befores.push(before);
  }
  var deltas = alignDeltas(layout, befores, artboardBounds);
  var entries = [];
  var perTargetBlockers = [];
  for (var s = 0; s < steps.length; s++) {
    var delta = deltas[s];
    var moves = delta.deltaX !== 0 || delta.deltaY !== 0;
    steps[s].params = alignStepParams(batchParams, steps[s].request, delta);
    var resolved, after;
    if (moves) {
      try {
        resolved = withStepParams(steps[s], function () { return transformResolve(false); });
        if (resolved.document !== document || resolved.target !== steps[s].target) throw mutationError("preflight_failed", "resolved a different document or target than the batch holds.");
      } catch (resolveError) { throw alignStepError(steps[s], resolveError); }
      after = resolved.after;
    } else {
      resolved = { context: context, document: document, target: steps[s].target, before: befores[s], after: befores[s], blockers: alignTargetBlockers(context, befores[s]) };
      after = befores[s];
    }
    var blockers = alignTargetBlockers(context, befores[s]);
    if (forApply) {
      if (!transformSnapshotMatches(befores[s], steps[s].request.expectedBefore)) throw mutationError("preflight_failed", alignStepLabel(steps[s]) + ": state does not match expected_before.");
      if (!transformSnapshotMatches(after, steps[s].request.confirmedAfter)) throw mutationError("preflight_failed", alignStepLabel(steps[s]) + ": confirmed_after does not match the derived state.");
    }
    perTargetBlockers.push(blockers);
    entries.push({ step: steps[s], resolved: resolved, delta: delta, moves: moves, before: befores[s], after: after, blockers: blockers });
  }
  var union = alignUnionBlockers(perTargetBlockers);
  if (forApply && union.length > 0) {
    var blockedUuids = [];
    for (var b = 0; b < entries.length; b++) if (entries[b].blockers.length > 0) blockedUuids.push(entries[b].step.request.targetUuid);
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "ALIGN_APPLY_BLOCKED", reasonCodes: union, uuids: blockedUuids }));
  }
  return { context: context, document: document, layout: layout, artboardBounds: artboardBounds, entries: entries, blockers: union };
}

function alignPlan(preflight) {
  var targets = [];
  for (var i = 0; i < preflight.entries.length; i++) {
    var entry = preflight.entries[i];
    targets.push({ targetUuid: entry.step.request.targetUuid, delta: entry.delta, moves: entry.moves, before: entry.before, after: entry.after, applyBlockedReasonCodes: entry.blockers });
  }
  return { operation: "align_objects", documentKey: preflight.context.key, layout: preflight.layout, artboardBounds: preflight.artboardBounds, targets: targets,
    applyBlockedReasonCodes: preflight.blockers, confirmationStatus: params.apply === true ? "confirmed" : "required",
    applyAllowed: params.apply === true && preflight.blockers.length === 0 };
}

function alignRevalidate(preflight, plan) {
  var current;
  try { current = alignResolve(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Align preconditions changed before apply.")); }
  if (current.document !== preflight.document || current.entries.length !== preflight.entries.length) throw mutationBeforeSideEffectError("Align document or target count changed before apply.");
  for (var i = 0; i < current.entries.length; i++) {
    if (current.entries[i].step.target !== preflight.entries[i].step.target || current.entries[i].moves !== plan.targets[i].moves ||
        !transformSnapshotMatches(current.entries[i].before, plan.targets[i].before) || !transformSnapshotMatches(current.entries[i].after, plan.targets[i].after)) {
      throw mutationBeforeSideEffectError(alignStepLabel(preflight.entries[i].step) + ": target or state changed before apply.");
    }
  }
}

/** Per-target transform-module state; the module's own rollback consumes preflight and operationState. */
function alignStepState(entry) {
  var plan = { operation: "transform_object", documentKey: "", transform: entry.step.params.transform, before: entry.before, after: entry.after, applyBlockedReasonCodes: [], confirmationStatus: "confirmed", applyAllowed: true };
  return { preflight: entry.resolved, plan: plan, operationState: { mutationStarted: false, rollbackEvidence: { targetUuid: entry.step.request.targetUuid, restoredSnapshot: null } } };
}

function alignApply(preflight, plan, state) {
  state.operationState.mutationStarted = true;
  state.operationState.stepStates = [];
  for (var i = 0; i < preflight.entries.length; i++) state.operationState.stepStates.push(alignStepState(preflight.entries[i]));
  var attempted = 0;
  for (var a = 0; a < preflight.entries.length; a++) {
    var entry = preflight.entries[a];
    if (!entry.moves) continue;
    var stepState = state.operationState.stepStates[a];
    attempted += 1;
    state.operationState.attemptedCount = attempted;
    state.operationState.rollbackEvidence.attemptedCount = attempted;
    withStepParams(entry.step, function () { return transformApply(entry.resolved, stepState.plan, stepState); });
  }
  return attempted;
}

function alignVerify(preflight, plan) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) throw mutationError("verify_mismatch", "Active document changed during align verification.");
  var actual = [];
  for (var i = 0; i < preflight.entries.length; i++) {
    var entry = preflight.entries[i];
    var snapshot;
    try {
      snapshot = withStepParams(entry.step, function () {
        var target = transformFindTarget(preflight.document, entry.step.request.targetUuid);
        if (target === null || target !== entry.step.target) throw mutationError("verify_mismatch", "native UUID no longer resolves to the same PageItem.");
        var read = transformSnapshot(preflight.document, target);
        if (!transformSnapshotMatches(read, entry.after)) throw mutationError("verify_mismatch", "postcondition does not match the plan.");
        return read;
      });
    } catch (verifyError) { throw alignStepError(entry.step, verifyError); }
    actual.push(snapshot);
  }
  return actual;
}

function alignInitialRollbackEvidence() {
  var targets = [];
  for (var i = 0; i < params.targets.length; i++) targets.push({ targetUuid: params.targets[i].targetUuid, outcome: "not_written", restoredSnapshot: null, observedSnapshot: null });
  return { attemptedCount: 0, targets: targets };
}
function alignMarkUnchanged(evidence, entries) {
  for (var i = 0; i < entries.length; i++) if (!entries[i].moves) evidence[i].outcome = "unchanged";
}

/** Walks the attempted moving targets in reverse request order through the transform module's rollback. */
function alignRollback(state) {
  var preflight = state.preflight;
  var evidence = state.operationState.rollbackEvidence.targets;
  var attempted = state.operationState.attemptedCount || 0;
  alignMarkUnchanged(evidence, preflight ? preflight.entries : []);
  var movingIndexes = [];
  if (preflight) for (var m = 0; m < preflight.entries.length; m++) if (preflight.entries[m].moves) movingIndexes.push(m);
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) {
    for (var u = 0; u < attempted && u < movingIndexes.length; u++) { evidence[movingIndexes[u]].outcome = "indeterminate"; }
    return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
  }
  var firstIndeterminate = null, firstOutstanding = null;
  for (var k = attempted - 1; k >= 0; k--) {
    var index = movingIndexes[k];
    var entry = preflight.entries[index];
    var stepState = state.operationState.stepStates[index];
    var outcome;
    try { outcome = withStepParams(entry.step, function () { return transformRollback(stepState); }); }
    catch (rollbackError) { outcome = { status: "indeterminate", message: mutationPublicMessage(rollbackError, "operation rollback threw") }; }
    if (!outcome || (outcome.status !== "verified" && outcome.status !== "failed" && outcome.status !== "indeterminate")) outcome = { status: "indeterminate", message: "operation rollback returned an invalid outcome" };
    var observed = stepState.operationState.rollbackEvidence.restoredSnapshot;
    if (outcome.status === "verified") { evidence[index].outcome = "restored"; evidence[index].restoredSnapshot = observed; evidence[index].observedSnapshot = null; }
    else if (outcome.status === "failed") { evidence[index].outcome = "outstanding"; evidence[index].restoredSnapshot = null; evidence[index].observedSnapshot = observed;
      if (firstOutstanding === null) firstOutstanding = alignStepLabel(entry.step) + ": " + (outcome.message || "restore did not take effect"); }
    else { evidence[index].outcome = "indeterminate"; evidence[index].restoredSnapshot = null; evidence[index].observedSnapshot = null;
      if (firstIndeterminate === null) firstIndeterminate = alignStepLabel(entry.step) + ": " + (outcome.message || "state is indeterminate"); }
  }
  if (firstIndeterminate !== null) return { status: "indeterminate", message: "Rollback is indeterminate. " + firstIndeterminate };
  if (firstOutstanding !== null) return { status: "failed", message: "Rollback did not restore every attempted target. " + firstOutstanding };
  return { status: "verified" };
}

var alignExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionAffected: function () { var uuids = []; for (var i = 0; i < params.targets.length; i++) uuids.push(params.targets[i].targetUuid); return uuids; },
  initialOperationState: function () { return { mutationStarted: false, attemptedCount: 0, stepStates: [], rollbackEvidence: alignInitialRollbackEvidence() }; },
  preflight: alignResolve,
  plan: alignPlan,
  revalidate: alignRevalidate,
  applyMutation: alignApply,
  verify: alignVerify,
  rollback: alignRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function (state) {
    var targets = state.operationState.rollbackEvidence.targets;
    var entries = state.preflight ? state.preflight.entries : [];
    var moving = 0;
    for (var i = 0; i < targets.length; i++) {
      if (entries[i] && !entries[i].moves) { targets[i].outcome = "unchanged"; continue; }
      moving += 1; targets[i].outcome = "indeterminate"; targets[i].restoredSnapshot = null; targets[i].observedSnapshot = null;
    }
    return { reasonCode: "align_state_unknown", message: "Align apply outcome is indeterminate.", evidence: { attemptedCount: moving, targets: targets } };
  },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var alignDocument = alignExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === alignExecution.preflight.document) alignDocument = getDocumentContext();
var result = { operation: "align_objects", applied: alignExecution.transaction.state === "verified", document: alignDocument, plan: alignExecution.plan, transaction: alignExecution.transaction };
if (alignExecution.transaction.state === "verified") result.postcondition = alignExecution.value;
`;
export const ALIGN_OBJECTS_HOST_SCRIPT_DIGEST = canonicalSha256(ALIGN_OBJECTS_SCRIPT);
export const ALIGN_OBJECTS_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: ALIGN_OBJECTS_OPERATION, validator: ALIGN_OBJECTS_VALIDATOR,
    canonicalContractVersion: CANONICAL_VERSION, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: ALIGN_OBJECTS_SAFETY_IDENTITY, hostScriptDigest: ALIGN_OBJECTS_HOST_SCRIPT_DIGEST,
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    const digestRequest = 'commandId' in request ? (({ commandId: _commandId, ...rest }) => rest)(request) : request;
    const digest = canonicalSha256({ operation: ALIGN_OBJECTS_OPERATION, validator: ALIGN_OBJECTS_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: 'commandId' in request ? request.commandId : null, documentKey: request.expectedDocumentKey, digest };
}
export const alignObjectsToolContract = {
    name: 'illustrator_align_objects',
    title: 'Plan or Align / Distribute Objects',
    description: `Plan or apply an alignment of ${ALIGN_MIN_TARGETS}-${ALIGN_MAX_TARGETS} distinct PathItems to the first target or the artboard on one axis (left, center_x, right, top, center_y, bottom), or an even distribution of ${ALIGN_MIN_DISTRIBUTE_TARGETS}-${ALIGN_MAX_TARGETS} PathItems by geometric centre along x or y with the outermost two fixed. Deltas are derived from geometricBounds (stroke excluded). Planning writes nothing; apply performs per-target compare-and-set, one translate per moving target in one host call, native read-back verification of every target, and verified inverse rollback of attempted moves in reverse order.`,
    inputSchema,
    publicInputSchema: alignObjectsPublicInputSchema,
    outputSchema: alignObjectsResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(ALIGN_OBJECTS_SAFETY.policy),
    normalizePublicInput,
};
export function createAlignObjectsAdapter() {
    return {
        version: 1, operation: ALIGN_OBJECTS_OPERATION, validator: ALIGN_OBJECTS_VALIDATOR,
        safety: ALIGN_OBJECTS_SAFETY, safetyRegistrationIdentity: ALIGN_OBJECTS_SAFETY_IDENTITY,
        adapterIdentity: ALIGN_OBJECTS_ADAPTER_IDENTITY, tool: alignObjectsToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: alignObjectsResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
        safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: ALIGN_OBJECTS_HOST_SCRIPT_DIGEST,
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: ALIGN_OBJECTS_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: ALIGN_OBJECTS_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: ALIGN_OBJECTS_OPERATION, documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: ALIGN_OBJECTS_ADAPTER_IDENTITY, script: ALIGN_OBJECTS_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = alignObjectsResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back')
                return { state };
            if (state === 'planned')
                throw new Error('Align plan is not a terminal mutation result.');
            throw new Error('Unverified align recovery must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error, detail) {
            if (detail?.code === 'OBJECT_NOT_FOUND')
                return new Error(`No PageItem with UUID ${JSON.stringify(detail.uuid ?? '')} exists in the bound document.`);
            if (detail?.code === 'ALIGN_APPLY_BLOCKED') {
                const uuids = detail.uuids ?? [];
                return new Error(`Align is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}${uuids.length > 0 ? ` (targets ${uuids.map((uuid) => JSON.stringify(uuid)).join(', ')})` : ''}.`);
            }
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
export const ALIGN_TOLERANCE_PT = TRANSFORM_BOUNDS_TOLERANCE_PT;
