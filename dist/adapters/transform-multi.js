import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { documentContextSchema, layerPathSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { canonicalDigest } from '../operation-safety-policy-core.js';
import { TRANSFORM_MULTI_GEOMETRY_TOLERANCE_PT, TRANSFORM_MULTI_GRADIENT_MATRIX_TOLERANCE, TRANSFORM_MULTI_LINEAR_TOLERANCE, transformMultiGradientTolerance, TRANSFORM_MULTI_MARGIN_TOLERANCE_PT, TRANSFORM_MULTI_MAX_ROWS, TRANSFORM_MULTI_MAX_TARGETS, TRANSFORM_MULTI_MIN_TARGETS, } from './transform-multi-host-script.js';
const uuidSchema = z.string().min(1).max(255);
const documentKeySchema = z.string().min(1).max(16_384);
const pointSchema = z.tuple([z.number().finite(), z.number().finite()]);
const boundsSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
const ROW_TYPES = ['GroupItem', 'PathItem', 'TextFrame', 'PlacedItem', 'RasterItem'];
export const transformMultiRowSchema = z.strictObject({
    uuid: uuidSchema,
    parentUuid: z.string().max(255),
    type: z.enum(ROW_TYPES),
    name: z.string().max(1_024),
    bounds: boundsSchema,
    coords: z.array(pointSchema).max(3 * 256 * 8 + 8),
    attrs: z.record(z.string(), z.unknown()),
    margin: boundsSchema.nullable(),
});
export const transformMultiSnapshotSchema = z.strictObject({
    uuid: uuidSchema,
    type: z.enum(ROW_TYPES),
    layerPath: layerPathSchema,
    locked: z.boolean(),
    hidden: z.boolean(),
    editable: z.boolean(),
    layerVisible: z.boolean(),
    layerLocked: z.boolean(),
    ancestorLocked: z.boolean(),
    ancestorHidden: z.boolean(),
    rows: z.array(transformMultiRowSchema).min(1).max(TRANSFORM_MULTI_MAX_ROWS),
}).superRefine((snapshot, context) => {
    const seen = new Map();
    for (const [index, row] of snapshot.rows.entries()) {
        const parentType = seen.get(row.parentUuid);
        if (seen.has(row.uuid) || (index === 0 ? row.uuid !== snapshot.uuid || row.type !== snapshot.type || row.parentUuid !== '' : parentType !== 'GroupItem')) {
            context.addIssue({ code: 'custom', message: 'A transform snapshot needs the target first, then unique descendants listed after their group.' });
            return;
        }
        seen.set(row.uuid, row.type);
    }
});
export const transformMultiExpectedBeforeSchema = transformMultiSnapshotSchema.superRefine((snapshot, context) => {
    if (snapshot.rows.some((row) => row.margin === null))
        context.addIssue({ code: 'custom', message: 'expected_before must carry every row\'s margin, as the plan returned it.' });
});
const near = (left, right, tolerance) => Math.abs(left - right) <= tolerance;
function toleranceFor(key, gradientTolerance) {
    if (key === 'length')
        return gradientTolerance;
    if (key === 'gm')
        return TRANSFORM_MULTI_GRADIENT_MATRIX_TOLERANCE;
    return key === 'linear' ? TRANSFORM_MULTI_LINEAR_TOLERANCE : TRANSFORM_MULTI_GEOMETRY_TOLERANCE_PT;
}
function valueMatch(left, right, key, gradientTolerance) {
    if (typeof left === 'number' && typeof right === 'number')
        return near(left, right, toleranceFor(key, gradientTolerance));
    if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object')
        return left === right;
    if (Array.isArray(left) !== Array.isArray(right))
        return false;
    if (Array.isArray(left) && Array.isArray(right)) {
        return left.length === right.length && left.every((value, index) => valueMatch(value, right[index], key, gradientTolerance));
    }
    const l = left, r = right;
    const keys = Object.keys(l);
    return keys.length === Object.keys(r).length && keys.every((name) => Object.hasOwn(r, name) && valueMatch(l[name], r[name], name, gradientTolerance));
}
function textBelow(rows) {
    const flags = [];
    for (let i = rows.length - 1; i >= 0; i -= 1) {
        let has = rows[i].type === 'TextFrame';
        for (let k = i + 1; k < rows.length && !has; k += 1)
            if (rows[k].parentUuid === rows[i].uuid && flags[k] === true)
                has = true;
        flags[i] = has;
    }
    return flags;
}
function comparableAttrs(row, noLength) {
    const attrs = row.attrs;
    if (row.type === 'TextFrame' && Array.isArray(attrs.matrix))
        return { ...attrs, matrix: attrs.matrix.slice(0, 4) };
    const plain = { ...attrs };
    for (const name of ['fill', 'stroke']) {
        const paint = plain[name];
        if (paint !== null && paint !== undefined && paint.t === 'gradient') {
            const rest = { ...paint };
            delete rest.origin;
            if (noLength && name === 'stroke') {
                delete rest.length;
                delete rest.lr;
            }
            plain[name] = rest;
        }
    }
    return plain;
}
function strokeGradientOf(row) {
    const stroke = row.attrs.stroke;
    return stroke !== null && stroke !== undefined && stroke.t === 'gradient' ? stroke : null;
}
function strokeLengthMatches(left, right) {
    const a = strokeGradientOf(left), b = strokeGradientOf(right);
    if (a === null || b === null)
        return true;
    const ranged = a.lr !== undefined ? a : b.lr !== undefined ? b : null;
    if (ranged === null)
        return true;
    if (a.lr !== undefined && b.lr !== undefined)
        return near(a.lr[0], b.lr[0], TRANSFORM_MULTI_GEOMETRY_TOLERANCE_PT) && near(a.lr[1], b.lr[1], TRANSFORM_MULTI_GEOMETRY_TOLERANCE_PT);
    const other = ranged === a ? b : a;
    return other.length >= ranged.lr[0] - TRANSFORM_MULTI_GEOMETRY_TOLERANCE_PT && other.length <= ranged.lr[1] + TRANSFORM_MULTI_GEOMETRY_TOLERANCE_PT;
}
export function transformMultiRowsMatch(left, right, mode, factor = 1) {
    if (left.length !== right.length)
        return false;
    const gradientTolerance = transformMultiGradientTolerance(factor);
    const text = mode === 'rotate' ? textBelow(left) : null;
    return left.every((x, i) => {
        const y = right[i];
        if (x.uuid !== y.uuid || x.parentUuid !== y.parentUuid || x.type !== y.type || x.name !== y.name || x.coords.length !== y.coords.length)
            return false;
        if (!strokeLengthMatches(x, y))
            return false;
        const ranged = strokeGradientOf(x)?.lr !== undefined || strokeGradientOf(y)?.lr !== undefined;
        if (!valueMatch(comparableAttrs(x, ranged), comparableAttrs(y, ranged), 'attrs', gradientTolerance))
            return false;
        if (!x.coords.every((p, c) => near(p[0], y.coords[c][0], TRANSFORM_MULTI_GEOMETRY_TOLERANCE_PT) && near(p[1], y.coords[c][1], TRANSFORM_MULTI_GEOMETRY_TOLERANCE_PT)))
            return false;
        if (!(mode === 'rotate' && text[i] === true) && !x.bounds.every((value, k) => near(value, y.bounds[k], TRANSFORM_MULTI_GEOMETRY_TOLERANCE_PT)))
            return false;
        return mode === 'rotate' || x.margin === null || y.margin === null || x.margin.every((value, k) => near(value, y.margin[k], TRANSFORM_MULTI_MARGIN_TOLERANCE_PT));
    });
}
export function transformMultiSnapshotsMatch(left, right, mode, factor = 1) {
    return left.uuid === right.uuid && left.type === right.type && canonicalDigest(left.layerPath) === canonicalDigest(right.layerPath) &&
        left.locked === right.locked && left.hidden === right.hidden && left.editable === right.editable && left.layerVisible === right.layerVisible &&
        left.layerLocked === right.layerLocked && left.ancestorLocked === right.ancestorLocked && left.ancestorHidden === right.ancestorHidden &&
        transformMultiRowsMatch(left.rows, right.rows, mode, factor);
}
const canonicalNumberSchema = z.number().finite().overwrite((value) => Object.is(value, -0) ? 0 : value);
export const TRANSFORM_MULTI_ANCHORS = ['selection_center', 'each_center'];
const anchorSchema = z.enum(TRANSFORM_MULTI_ANCHORS);
export function transformMultiVisualBox(rows, index = 0) {
    const row = rows[index];
    if (row.type !== 'GroupItem')
        return row.bounds;
    const boxes = [];
    for (let k = index + 1; k < rows.length; k += 1) {
        if (rows[k].parentUuid !== row.uuid)
            continue;
        if (row.attrs.clipped === true && rows[k].type === 'PathItem' && rows[k].attrs.clip === true)
            return rows[k].bounds;
        boxes.push(transformMultiVisualBox(rows, k));
    }
    return boxes.length === 0 ? row.bounds : [Math.min(...boxes.map((b) => b[0])), Math.max(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.min(...boxes.map((b) => b[3]))];
}
const SCALE_MIN = 10, SCALE_MAX = 1_000, ANGLE_MIN = -180, ANGLE_MAX = 180;
export const transformMultiTransformSchema = z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('translate'), deltaX: canonicalNumberSchema, deltaY: canonicalNumberSchema })
        .superRefine((value, context) => { if (!(value.deltaX !== 0 || value.deltaY !== 0))
        context.addIssue({ code: 'custom', message: 'Translation must move on at least one axis.' }); }),
    z.strictObject({ type: z.literal('scale'), scalePercent: z.number().int().min(SCALE_MIN).max(SCALE_MAX), anchor: anchorSchema })
        .superRefine((value, context) => { if (!(value.scalePercent !== 100))
        context.addIssue({ code: 'custom', message: 'Scale must change the target size.' }); }),
    z.strictObject({ type: z.literal('rotate'), angleDegrees: z.number().int().min(ANGLE_MIN).max(ANGLE_MAX), anchor: anchorSchema })
        .superRefine((value, context) => { if (!(value.angleDegrees !== 0))
        context.addIssue({ code: 'custom', message: 'Rotation must change the target orientation.' }); }),
]);
function distinct(targets, context) {
    if (new Set(targets.map((target) => target.targetUuid)).size !== targets.length)
        context.addIssue({ code: 'custom', message: 'Targets must be distinct native UUIDs.' });
}
const targetCount = { min: TRANSFORM_MULTI_MIN_TARGETS, max: TRANSFORM_MULTI_MAX_TARGETS };
export const transformMultiInternalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ expectedDocumentKey: documentKeySchema, targets: z.array(z.strictObject({ targetUuid: uuidSchema })).min(targetCount.min).max(targetCount.max),
        transform: transformMultiTransformSchema, apply: z.literal(false) }).superRefine((value, context) => distinct(value.targets, context)),
    z.strictObject({ expectedDocumentKey: documentKeySchema, targets: z.array(z.strictObject({ targetUuid: uuidSchema,
            expectedBefore: transformMultiExpectedBeforeSchema, confirmedAfter: transformMultiSnapshotSchema })).min(targetCount.min).max(targetCount.max),
        transform: transformMultiTransformSchema, apply: z.literal(true), commandId: canonicalCommandIdSchema }).superRefine((value, context) => distinct(value.targets, context)),
]);
export const transformMultiPublicTransformSchema = z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('translate'), delta_x: canonicalNumberSchema, delta_y: canonicalNumberSchema })
        .superRefine((value, context) => { if (!(value.delta_x !== 0 || value.delta_y !== 0))
        context.addIssue({ code: 'custom', message: 'Translation must move on at least one axis.' }); }),
    z.strictObject({ type: z.literal('scale'), scale_percent: z.number().int().min(SCALE_MIN).max(SCALE_MAX), anchor: anchorSchema })
        .superRefine((value, context) => { if (!(value.scale_percent !== 100))
        context.addIssue({ code: 'custom', message: 'Scale must change the target size.' }); }),
    z.strictObject({ type: z.literal('rotate'), angle_degrees: z.number().int().min(ANGLE_MIN).max(ANGLE_MAX), anchor: anchorSchema })
        .superRefine((value, context) => { if (!(value.angle_degrees !== 0))
        context.addIssue({ code: 'custom', message: 'Rotation must change the target orientation.' }); }),
]);
const publicDistinct = (targets, context) => distinct(targets.map((t) => ({ targetUuid: t.target_uuid })), context);
export const transformMultiPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ expected_document_key: documentKeySchema, targets: z.array(z.strictObject({ target_uuid: uuidSchema })).min(targetCount.min).max(targetCount.max),
        transform: transformMultiPublicTransformSchema, apply: z.literal(false).default(false) }).superRefine((value, context) => publicDistinct(value.targets, context)),
    z.strictObject({ expected_document_key: documentKeySchema, targets: z.array(z.strictObject({ target_uuid: uuidSchema,
            expected_before: transformMultiExpectedBeforeSchema, confirmed_after: transformMultiSnapshotSchema })).min(targetCount.min).max(targetCount.max),
        transform: transformMultiPublicTransformSchema, apply: z.literal(true), command_id: applyCommandIdSchema }).superRefine((value, context) => publicDistinct(value.targets, context)),
]);
const snapshotEchoSchema = z.record(z.string(), z.unknown());
export const transformMultiPublishedInputSchema = z.discriminatedUnion('apply', [
    transformMultiPublicInputSchema.options[0],
    z.strictObject({ expected_document_key: documentKeySchema, targets: z.array(z.strictObject({ target_uuid: uuidSchema,
            expected_before: snapshotEchoSchema, confirmed_after: snapshotEchoSchema })).min(targetCount.min).max(targetCount.max),
        transform: transformMultiPublicTransformSchema, apply: z.literal(true), command_id: applyCommandIdSchema }),
]);
export function normalizeTransformMultiTransform(transform) {
    if (transform.type === 'translate')
        return { type: 'translate', deltaX: transform.delta_x, deltaY: transform.delta_y };
    if (transform.type === 'scale')
        return { type: 'scale', scalePercent: transform.scale_percent, anchor: transform.anchor };
    return { type: 'rotate', angleDegrees: transform.angle_degrees, anchor: transform.anchor };
}
export function normalizeTransformMultiInput(input) {
    const value = transformMultiPublicInputSchema.parse(input);
    const transform = normalizeTransformMultiTransform(value.transform);
    if (!value.apply)
        return { expectedDocumentKey: value.expected_document_key, targets: value.targets.map((t) => ({ targetUuid: t.target_uuid })), transform, apply: false };
    return { expectedDocumentKey: value.expected_document_key, transform, apply: true, commandId: value.command_id,
        targets: value.targets.map((t) => ({ targetUuid: t.target_uuid, expectedBefore: t.expected_before, confirmedAfter: t.expected_before === undefined ? undefined : t.confirmed_after })) };
}
export const transformMultiBlockerSchema = z.enum(['document_mutation_not_allowed', 'target_locked', 'target_hidden', 'target_not_editable', 'layer_hidden',
    'layer_locked', 'ancestor_hidden', 'ancestor_locked']);
export function transformMultiTargetBlockers(mutationAllowed, before) {
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
    if (before.ancestorHidden)
        blockers.push('ancestor_hidden');
    if (before.ancestorLocked)
        blockers.push('ancestor_locked');
    return blockers;
}
const unionBlockers = (perTarget) => transformMultiBlockerSchema.options.filter((blocker) => perTarget.some((blockers) => blockers.includes(blocker)));
export const transformMultiModeOf = (transform) => transform.type;
export const transformMultiFactorOf = (transform) => transform.type === 'scale' ? transform.scalePercent / 100 : 1;
const planTargetSchema = z.strictObject({
    targetUuid: uuidSchema, before: transformMultiSnapshotSchema, after: transformMultiSnapshotSchema, applyBlockedReasonCodes: z.array(transformMultiBlockerSchema),
});
export const transformMultiPlanSchema = z.strictObject({
    operation: z.literal('transform_object'),
    documentKey: documentKeySchema,
    transform: transformMultiTransformSchema,
    pivot: pointSchema.nullable(),
    targets: z.array(planTargetSchema).min(targetCount.min).max(targetCount.max),
    applyBlockedReasonCodes: z.array(transformMultiBlockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    distinct(plan.targets, context);
    if ((plan.transform.type !== 'translate' && plan.transform.anchor === 'selection_center') !== (plan.pivot !== null)) {
        context.addIssue({ code: 'custom', message: 'The plan carries a pivot exactly for a selection_center scale or rotation.' });
    }
    if (plan.pivot !== null) {
        const boxes = plan.targets.map((target) => transformMultiVisualBox(target.before.rows));
        const center = [(Math.min(...boxes.map((b) => b[0])) + Math.max(...boxes.map((b) => b[2]))) / 2, (Math.max(...boxes.map((b) => b[1])) + Math.min(...boxes.map((b) => b[3]))) / 2];
        if (!near(plan.pivot[0], center[0], TRANSFORM_MULTI_GEOMETRY_TOLERANCE_PT) || !near(plan.pivot[1], center[1], TRANSFORM_MULTI_GEOMETRY_TOLERANCE_PT)) {
            context.addIssue({ code: 'custom', message: 'The pivot must be the centre of the union of the targets\' visible boxes.' });
        }
    }
    plan.targets.forEach((target) => {
        const same = target.before.uuid === target.targetUuid && target.after.uuid === target.targetUuid && target.before.type === target.after.type &&
            canonicalDigest(target.before.layerPath) === canonicalDigest(target.after.layerPath) && target.before.locked === target.after.locked &&
            target.before.hidden === target.after.hidden && target.before.editable === target.after.editable && target.before.rows.length === target.after.rows.length &&
            target.before.rows.every((row, index) => row.uuid === target.after.rows[index].uuid && row.type === target.after.rows[index].type);
        if (!same)
            context.addIssue({ code: 'custom', message: 'A planned target keeps its identity, layer, safety state and rows.' });
    });
    if (JSON.stringify(plan.applyBlockedReasonCodes) !== JSON.stringify(unionBlockers(plan.targets.map((target) => target.applyBlockedReasonCodes)))) {
        context.addIssue({ code: 'custom', message: 'Plan blockers must be the ordered union of every target blocker.' });
    }
    if (plan.applyAllowed !== (plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0)) {
        context.addIssue({ code: 'custom', message: 'applyAllowed must require confirmation and no blockers.' });
    }
});
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']), reasonCode: z.enum(['apply_failed', 'verify_mismatch']), message: z.string().min(1).max(500),
}).superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed'))
        context.addIssue({ code: 'custom', message: 'Failure phase and reason code must match.' });
});
const indeterminateFailureSchema = z.strictObject({ phase: z.literal('apply'), reasonCode: z.literal('apply_indeterminate'), message: z.string().min(1).max(500) });
const rollbackTargetSchema = z.strictObject({
    targetUuid: uuidSchema, outcome: z.enum(['not_written', 'restored', 'outstanding', 'indeterminate']),
    restoredSnapshot: transformMultiSnapshotSchema.nullable(), observedSnapshot: transformMultiSnapshotSchema.nullable(),
    differences: z.string().max(1100).nullable().optional(),
});
const rollbackEvidence = {
    attemptedCount: z.number().int().min(0).max(TRANSFORM_MULTI_MAX_TARGETS),
    targets: z.array(rollbackTargetSchema).min(targetCount.min).max(targetCount.max),
};
const RECOVERY_STATES = ['rolled_back', 'rollback_failed', 'apply_indeterminate', 'rollback_indeterminate'];
export const transformMultiTransactionSchema = z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('planned'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('verified'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('apply_failed'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('not_required') }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.enum(RECOVERY_STATES), failure: z.union([failureSchema, indeterminateFailureSchema]),
        rollback: z.strictObject({ status: z.enum(['verified', 'failed', 'indeterminate']), reasonCode: z.string().min(1).max(64).optional(),
            message: z.string().min(1).max(500).optional(), ...rollbackEvidence }), audit: mutationAuditSchema }),
]).superRefine((transaction, context) => {
    if (RECOVERY_STATES.includes(transaction.state) && 'rollback' in transaction && 'targets' in transaction.rollback) {
        const { status, reasonCode, message } = transaction.rollback;
        const wanted = { rolled_back: ['verified', undefined], rollback_failed: ['failed', 'rollback_failed'], apply_indeterminate: ['indeterminate', 'transform_state_unknown'],
            rollback_indeterminate: ['indeterminate', 'rollback_indeterminate'] }[transaction.state];
        const apply = transaction.state === 'apply_indeterminate';
        if (status !== wanted[0] || reasonCode !== wanted[1] || (wanted[1] !== undefined && message === undefined) ||
            'failure' in transaction && (transaction.failure.reasonCode === 'apply_indeterminate') !== apply) {
            context.addIssue({ code: 'custom', message: 'Recovery status, reason and failure must match the transaction state.' });
        }
    }
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
    if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index]))
        context.addIssue({ code: 'custom', message: 'Audit sequence does not match transaction state.' });
    transaction.audit.forEach((event, index) => { if (event.sequence !== index)
        context.addIssue({ code: 'custom', message: 'Audit sequence must be contiguous.' }); });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' && event.phase === transaction.failure.phase &&
            event.reasonCode === transaction.failure.reasonCode && event.message === transaction.failure.message);
        if (matches.length !== 1)
            context.addIssue({ code: 'custom', message: 'The failure must match one audit event.' });
    }
    if ('rollback' in transaction && 'targets' in transaction.rollback) {
        const { targets, attemptedCount } = transaction.rollback;
        if (targets.some((target, index) => (target.outcome === 'not_written') !== (index >= attemptedCount && transaction.state !== 'apply_indeterminate'))) {
            context.addIssue({ code: 'custom', message: 'Rollback evidence must mark exactly the unattempted targets as not written.' });
        }
        if (transaction.state === 'rolled_back' && (attemptedCount === 0 || targets.some((target, index) => index < attemptedCount && target.outcome !== 'restored'))) {
            context.addIssue({ code: 'custom', message: 'A rolled-back transform must prove every attempted target restored.' });
        }
        if (transaction.state === 'rollback_failed' && (targets.some((target) => target.outcome === 'indeterminate') || !targets.some((target) => target.outcome === 'outstanding'))) {
            context.addIssue({ code: 'custom', message: 'A failed rollback must name an outstanding target and prove the rest.' });
        }
        for (const target of targets) {
            if ((target.outcome === 'restored') !== (target.restoredSnapshot !== null) || (target.outcome === 'outstanding') !== (target.observedSnapshot !== null) ||
                (target.restoredSnapshot !== null && target.restoredSnapshot.uuid !== target.targetUuid) || (target.observedSnapshot !== null && target.observedSnapshot.uuid !== target.targetUuid)) {
                context.addIssue({ code: 'custom', message: 'Rollback target snapshots must match their outcome and target.' });
            }
        }
    }
});
export const transformMultiResultSchema = z.union([
    z.strictObject({ operation: z.literal('transform_object'), applied: z.literal(false), document: documentContextSchema, plan: transformMultiPlanSchema, transaction: transformMultiTransactionSchema }),
    z.strictObject({ operation: z.literal('transform_object'), applied: z.literal(true), document: documentContextSchema, plan: transformMultiPlanSchema,
        postcondition: z.array(transformMultiSnapshotSchema).min(targetCount.min).max(targetCount.max), transaction: transformMultiTransactionSchema }),
]).superRefine((result, context) => {
    const mode = transformMultiModeOf(result.plan.transform);
    if (result.transaction.state === 'planned') {
        const exact = result.plan.targets.every((target) => JSON.stringify(target.applyBlockedReasonCodes) === JSON.stringify(transformMultiTargetBlockers(result.document.mutationAllowed, target.before)));
        if (result.plan.confirmationStatus !== 'required' || !exact)
            context.addIssue({ code: 'custom', message: 'A planned transform exposes exact blockers for every target.' });
    }
    else if (result.plan.confirmationStatus !== 'confirmed' || result.plan.applyBlockedReasonCodes.length !== 0 || !result.plan.applyAllowed) {
        context.addIssue({ code: 'custom', message: 'An applied transform derives from an allowed, confirmed plan.' });
    }
    if (result.applied) {
        const matches = result.transaction.state === 'verified' && result.postcondition.length === result.plan.targets.length &&
            result.plan.targets.every((target, index) => transformMultiSnapshotsMatch(result.postcondition[index], target.after, mode, transformMultiFactorOf(result.plan.transform)));
        if (!matches)
            context.addIssue({ code: 'custom', message: 'A verified transform matches every planned after snapshot in order.' });
    }
    else if (result.transaction.state === 'verified')
        context.addIssue({ code: 'custom', message: 'A verified transaction must be applied.' });
    if ('rollback' in result.transaction && 'targets' in result.transaction.rollback) {
        const rollbackTargets = result.transaction.rollback.targets;
        if (rollbackTargets.length !== result.plan.targets.length || rollbackTargets.some((target, index) => target.targetUuid !== result.plan.targets[index].targetUuid)) {
            context.addIssue({ code: 'custom', message: 'Rollback evidence covers every plan target in order.' });
        }
        else if (rollbackTargets.some((target, index) => target.outcome === 'restored' && !transformMultiSnapshotsMatch(target.restoredSnapshot, result.plan.targets[index].before, null))) {
            context.addIssue({ code: 'custom', message: 'Restored targets must prove restoration of the before snapshot.' });
        }
    }
});
