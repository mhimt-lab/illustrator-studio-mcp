import { z } from 'zod';
import { canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { boundsSchema, documentContextSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { CLIPPING_MASK_HOST_SCRIPT, clipAuditMatches, clipLayerStateSchema, clipParentOrderSchema, clipPathSnapshotSchema, sameCanonical, } from './clipping-mask-shared.js';
import { SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS, supportedPathCmykPaintSchema, } from './supported-path-item-host-script.js';
export const APPLY_PATHFINDER_OPERATION = 'apply_pathfinder';
export const APPLY_PATHFINDER_VALIDATOR = { kind: APPLY_PATHFINDER_OPERATION, version: 1 };
const CANONICAL_VERSION = 1;
const RESULT_SCHEMA_VERSION = 1;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
export const APPLY_PATHFINDER_MAX_SELECTION = 256;
export const PATHFINDER_GEOMETRY_TOLERANCE = 0.001;
export const PATHFINDER_MODES = ['unite', 'minus_front', 'intersect', 'exclude'];
export const PATHFINDER_LIVE_COMMANDS = {
    unite: 'Live Pathfinder Add',
    minus_front: 'Live Pathfinder Subtract',
    intersect: 'Live Pathfinder Intersect',
    exclude: 'Live Pathfinder Exclude',
};
const modeSchema = z.enum(PATHFINDER_MODES);
const uuidSchema = z.string().min(1).max(255);
const documentKeySchema = z.string().min(1).max(16_384);
const numberSchema = z.number().finite();
const anchorSchema = z.tuple([numberSchema, numberSchema]);
const sourceUuidsSchema = z.tuple([uuidSchema, uuidSchema]).superRefine(([first, second], context) => {
    if (first === second)
        context.addIssue({ code: 'custom', message: 'source_uuids must name two different paths.' });
});
const sourcesSnapshotSchema = z.tuple([clipPathSnapshotSchema, clipPathSnapshotSchema]);
const colorSpaceSchema = z.enum(['RGB', 'CMYK']);
const paintSchema = z.union([
    z.strictObject({ type: z.literal('RGBColor'), red: numberSchema, green: numberSchema, blue: numberSchema }),
    supportedPathCmykPaintSchema,
]);
const selectionUuidsSchema = z.array(uuidSchema).max(APPLY_PATHFINDER_MAX_SELECTION);
const selectionSchema = z.strictObject({
    before: selectionUuidsSchema,
    after: selectionUuidsSchema.nullable(),
    restored: z.boolean(),
}).superRefine((selection, context) => {
    const same = selection.after !== null && sameCanonical([...selection.before].sort(), [...selection.after].sort());
    if (selection.restored !== same)
        context.addIssue({ code: 'custom', message: 'Selection restored must reflect the read-back.' });
});
const commonInternal = { expectedDocumentKey: documentKeySchema, sourceUuids: sourceUuidsSchema, mode: modeSchema };
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
    source_uuids: sourceUuidsSchema.describe('Native PageItem.uuid of exactly two axis-aligned rectangle PathItems directly on the same top-level layer, overlapping at one corner each.'),
    mode: modeSchema.describe('unite (Add), minus_front (the front rectangle cut from the back one), intersect, or exclude.'),
};
export const applyPathfinderPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({
        ...commonPublic,
        expected_sources_before: sourcesSnapshotSchema,
        expected_parent_order: clipParentOrderSchema,
        apply: z.literal(true),
        command_id: canonicalCommandIdSchema,
    }),
]);
const inputSchema = z.strictObject({
    ...commonPublic,
    expected_sources_before: sourcesSnapshotSchema.optional(),
    expected_parent_order: clipParentOrderSchema.optional(),
    apply: z.boolean().default(false),
    command_id: canonicalCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(applyPathfinderPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = applyPathfinderPublicInputSchema.parse(input);
    const common = { expectedDocumentKey: value.expected_document_key, sourceUuids: value.source_uuids, mode: value.mode };
    return value.apply ? {
        ...common,
        expectedSourcesBefore: value.expected_sources_before,
        expectedParentOrder: value.expected_parent_order,
        apply: true,
        commandId: value.command_id,
    } : { ...common, apply: false };
}
export const pathfinderBlockerSchema = z.enum([
    'document_mutation_not_allowed', 'unsupported_host_version',
    'source_locked', 'source_hidden', 'target_not_editable', 'layer_hidden', 'layer_locked', 'selection_unsupported',
]);
export function rectangleCorners(bounds) {
    return [[bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[2], bounds[3]], [bounds[0], bounds[3]]];
}
function hasAnchor(list, anchor) {
    return list.some((item) => item[0] === anchor[0] && item[1] === anchor[1]);
}
function symmetricDifference(left, right) {
    return [...left.filter((anchor) => !hasAnchor(right, anchor)), ...right.filter((anchor) => !hasAnchor(left, anchor))];
}
function strictlyInside(anchor, bounds) {
    return bounds[0] < anchor[0] && anchor[0] < bounds[2] && bounds[3] < anchor[1] && anchor[1] < bounds[1];
}
export function sortAnchors(anchors) {
    return [...anchors].sort((left, right) => (left[0] - right[0]) || (left[1] - right[1]));
}
function expandBounds(bounds, half) {
    return [bounds[0] - half, bounds[1] + half, bounds[2] + half, bounds[3] - half];
}
function unionBounds(left, right) {
    return [Math.min(left[0], right[0]), Math.max(left[1], right[1]), Math.max(left[2], right[2]), Math.min(left[3], right[3])];
}
function strictPartialOverlap(firstStart, firstEnd, secondStart, secondEnd) {
    return (firstStart < secondStart && secondStart < firstEnd && firstEnd < secondEnd) ||
        (secondStart < firstStart && firstStart < secondEnd && secondEnd < firstEnd);
}
export function cornerOverlap(front, back) {
    return strictPartialOverlap(front[0], front[2], back[0], back[2]) && strictPartialOverlap(front[3], front[1], back[3], back[1]);
}
const predictedPathSchema = z.strictObject({
    paintSourceUuid: uuidSchema,
    geometricBounds: boundsSchema,
    visibleBounds: boundsSchema,
    anchors: z.array(anchorSchema).min(4).max(8),
});
export function predictPathfinder(mode, front, back) {
    const frontBounds = front.geometricBounds;
    const backBounds = back.geometricBounds;
    const overlap = [Math.max(frontBounds[0], backBounds[0]), Math.min(frontBounds[1], backBounds[1]),
        Math.min(frontBounds[2], backBounds[2]), Math.max(frontBounds[3], backBounds[3])];
    const frontCorners = rectangleCorners(frontBounds);
    const backCorners = rectangleCorners(backBounds);
    const overlapCorners = rectangleCorners(overlap);
    const path = (source, bounds, anchors) => ({
        paintSourceUuid: source.uuid, geometricBounds: bounds,
        visibleBounds: expandBounds(bounds, (source.strokeWidth ?? 0) / 2), anchors: sortAnchors(anchors),
    });
    let paths;
    if (mode === 'unite') {
        const all = [];
        for (const anchor of [...frontCorners, ...backCorners, ...overlapCorners]) {
            if (!hasAnchor(all, anchor) && !strictlyInside(anchor, frontBounds) && !strictlyInside(anchor, backBounds))
                all.push(anchor);
        }
        paths = [path(front, unionBounds(frontBounds, backBounds), all)];
    }
    else if (mode === 'minus_front') {
        paths = [path(back, backBounds, symmetricDifference(backCorners, overlapCorners))];
    }
    else if (mode === 'intersect') {
        paths = [path(front, overlap, overlapCorners)];
    }
    else {
        paths = [path(front, frontBounds, symmetricDifference(frontCorners, overlapCorners)),
            path(front, backBounds, symmetricDifference(backCorners, overlapCorners))];
    }
    let groupGeometricBounds = paths[0].geometricBounds;
    let groupVisibleBounds = paths[0].visibleBounds;
    for (const item of paths.slice(1)) {
        groupGeometricBounds = unionBounds(groupGeometricBounds, item.geometricBounds);
        groupVisibleBounds = unionBounds(groupVisibleBounds, item.visibleBounds);
    }
    return { groupGeometricBounds, groupVisibleBounds, paths };
}
export function frontToBack(parentOrder, sourceUuids) {
    const first = parentOrder.indexOf(sourceUuids[0]);
    const second = parentOrder.indexOf(sourceUuids[1]);
    if (first < 0 || second < 0)
        throw new Error('Both sources must be in the parent order.');
    return first < second ? [sourceUuids[0], sourceUuids[1]] : [sourceUuids[1], sourceUuids[0]];
}
function close(left, right) {
    return Math.abs(left - right) <= PATHFINDER_GEOMETRY_TOLERANCE;
}
function closeList(left, right) {
    return left.length === right.length && left.every((value, index) => close(value, right[index]));
}
export function sameAnchorSet(actual, expected) {
    if (actual.length !== expected.length)
        return false;
    const used = actual.map(() => false);
    return expected.every((anchor) => {
        const index = actual.findIndex((candidate, candidateIndex) => !used[candidateIndex] && closeList(candidate, anchor));
        if (index < 0)
            return false;
        used[index] = true;
        return true;
    });
}
export function axisAlignedOutline(anchors) {
    return anchors.every((anchor, index) => {
        const next = anchors[(index + 1) % anchors.length];
        return close(anchor[0], next[0]) || close(anchor[1], next[1]);
    });
}
function isMeasuredRectangle(snapshot) {
    const bounds = snapshot.geometricBounds;
    const anchors = snapshot.pathPoints.map((point) => point.anchor);
    return snapshot.closed && snapshot.pathPoints.length === 4 && bounds[2] > bounds[0] && bounds[1] > bounds[3] &&
        snapshot.pathPoints.every((point) => point.pointType === 'PointType.CORNER' &&
            sameCanonical(point.leftDirection, point.anchor) && sameCanonical(point.rightDirection, point.anchor)) &&
        sortAnchors(anchors).every((anchor, index) => sameCanonical(anchor, sortAnchors(rectangleCorners(bounds))[index])) &&
        axisAlignedOutline(anchors);
}
function hasMeasuredPaint(snapshot, colorSpace) {
    const model = colorSpace === 'CMYK' ? 'CMYKColor' : 'RGBColor';
    return snapshot.filled && snapshot.stroked && snapshot.strokeWidth === 1 && snapshot.opacity === 100 &&
        snapshot.fillColor?.type === model && snapshot.strokeColor?.type === model;
}
const planSchema = z.strictObject({
    operation: z.literal(APPLY_PATHFINDER_OPERATION),
    documentKey: documentKeySchema,
    mode: modeSchema,
    liveCommand: z.string().min(1).max(64),
    colorSpace: colorSpaceSchema,
    sourceUuids: sourceUuidsSchema,
    layer: clipLayerStateSchema,
    sourcesBefore: sourcesSnapshotSchema,
    parentOrderBefore: clipParentOrderSchema,
    predicted: z.strictObject({
        consumedSourceUuids: z.array(uuidSchema).length(0),
        operandOrder: z.tuple([uuidSchema, uuidSchema]),
        parentOrderAfter: z.array(uuidSchema.nullable()).min(2).max(SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS),
        groupGeometricBounds: boundsSchema,
        groupVisibleBounds: boundsSchema,
        paths: z.array(predictedPathSchema).min(1).max(2),
    }),
    applyBlockedReasonCodes: z.array(pathfinderBlockerSchema),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    const [first, second] = plan.sourcesBefore;
    if (first.uuid !== plan.sourceUuids[0] || second.uuid !== plan.sourceUuids[1] ||
        first.parentType !== 'Layer' || second.parentType !== 'Layer' || first.clipping || second.clipping ||
        !isMeasuredRectangle(first) || !isMeasuredRectangle(second) ||
        !hasMeasuredPaint(first, plan.colorSpace) || !hasMeasuredPaint(second, plan.colorSpace)) {
        context.addIssue({ code: 'custom', message: 'Pathfinder plan must bind two layer-direct measured rectangles with measured paint.' });
        return;
    }
    let order = null;
    try {
        order = frontToBack(plan.parentOrderBefore, plan.sourceUuids);
    }
    catch { }
    const byUuid = new Map(plan.sourcesBefore.map((source) => [source.uuid, source]));
    const front = order === null ? undefined : byUuid.get(order[0]);
    const back = order === null ? undefined : byUuid.get(order[1]);
    if (order === null || front === undefined || back === undefined || !sameCanonical(order, plan.predicted.operandOrder) ||
        plan.liveCommand !== PATHFINDER_LIVE_COMMANDS[plan.mode] ||
        !cornerOverlap(front.geometricBounds, back.geometricBounds) ||
        !sameCanonical(plan.predicted.parentOrderAfter, [null, ...plan.parentOrderBefore])) {
        context.addIssue({ code: 'custom', message: 'Pathfinder plan must follow from the sources, the mode, and the parent order.' });
        return;
    }
    const expected = predictPathfinder(plan.mode, front, back);
    if (!sameCanonical(expected.paths, plan.predicted.paths) ||
        !sameCanonical(expected.groupGeometricBounds, plan.predicted.groupGeometricBounds) ||
        !sameCanonical(expected.groupVisibleBounds, plan.predicted.groupVisibleBounds)) {
        context.addIssue({ code: 'custom', message: 'Pathfinder plan prediction must follow from the sources and the mode.' });
    }
    if (plan.applyAllowed !== (plan.applyBlockedReasonCodes.length === 0)) {
        context.addIssue({ code: 'custom', message: 'Pathfinder applyAllowed must exactly reflect blockers.' });
    }
});
const applyFailureSchema = z.strictObject({ phase: z.literal('apply'), reasonCode: z.literal('apply_failed'), message: z.string().min(1).max(500) });
const verifyFailureSchema = z.strictObject({ phase: z.literal('verify'), reasonCode: z.literal('verify_mismatch'), message: z.string().min(1).max(500) });
const failureSchema = z.discriminatedUnion('phase', [applyFailureSchema, verifyFailureSchema]);
const createdIdentity = {
    resultGroupUuid: uuidSchema.nullable(),
    operandGroupUuid: uuidSchema.nullable(),
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
            resultGroupUuid: z.null(), operandGroupUuid: z.null(), duplicateUuids: z.array(uuidSchema).length(0),
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
        context.addIssue({ code: 'custom', message: 'Pathfinder audit sequence does not match transaction state.' });
    if ((transaction.state === 'rollback_failed' || transaction.state === 'rollback_indeterminate') &&
        transaction.audit.filter((event) => event.event === 'failed' && event.phase === 'rollback' &&
            event.reasonCode === transaction.rollback.reasonCode && event.message === transaction.rollback.message).length !== 1) {
        context.addIssue({ code: 'custom', message: 'Pathfinder rollback summary must match one audit event.' });
    }
    if (transaction.state === 'apply_indeterminate' && transaction.rollback.message !== transaction.failure.message) {
        context.addIssue({ code: 'custom', message: 'Pathfinder indeterminate summaries must match.' });
    }
});
export const pathfinderResultPathSchema = z.strictObject({
    uuid: uuidSchema,
    type: z.literal('PathItem'),
    parentType: z.literal('GroupItem'),
    geometricBounds: boundsSchema,
    visibleBounds: boundsSchema,
    closed: z.literal(true),
    anchors: z.array(anchorSchema).min(4).max(8),
    filled: z.boolean(),
    fillColor: paintSchema.nullable(),
    stroked: z.boolean(),
    strokeColor: paintSchema.nullable(),
    strokeWidth: numberSchema.nonnegative().nullable(),
    polarity: z.string().min(1).max(64),
    locked: z.literal(false),
    hidden: z.literal(false),
});
const createdGroupSchema = z.strictObject({
    uuid: uuidSchema,
    layerPath: clipLayerStateSchema.shape.layerPath,
    geometricBounds: boundsSchema,
    visibleBounds: boundsSchema,
    clipped: z.literal(false),
    locked: z.literal(false),
    hidden: z.literal(false),
    childOrder: z.array(uuidSchema).min(1).max(2),
});
const provenanceSchema = z.strictObject({
    duplicates: z.array(z.strictObject({ sourceUuid: uuidSchema, duplicateUuid: uuidSchema })).length(2),
    operandGroupUuid: uuidSchema,
    resultGroupUuid: uuidSchema,
    resultPaths: z.array(z.strictObject({ uuid: uuidSchema, paintSourceUuid: uuidSchema })).min(1).max(2),
});
const postconditionSchema = z.strictObject({
    group: createdGroupSchema,
    paths: z.array(pathfinderResultPathSchema).min(1).max(2),
    provenance: provenanceSchema,
    sourcesAfter: sourcesSnapshotSchema,
    parentOrderAfter: clipParentOrderSchema,
    selection: selectionSchema,
});
function paintOf(snapshot) {
    return { filled: snapshot.filled, fillColor: snapshot.fillColor, stroked: snapshot.stroked, strokeColor: snapshot.strokeColor, strokeWidth: snapshot.strokeWidth };
}
export function resultPathMatches(predicted, source, path) {
    return sameAnchorSet(path.anchors, predicted.anchors) && axisAlignedOutline(path.anchors) &&
        closeList(path.geometricBounds, predicted.geometricBounds) && closeList(path.visibleBounds, predicted.visibleBounds) &&
        sameCanonical(paintOf(path), paintOf(source));
}
export const applyPathfinderResultSchema = z.union([
    z.strictObject({ operation: z.literal(APPLY_PATHFINDER_OPERATION), applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ operation: z.literal(APPLY_PATHFINDER_OPERATION), applied: z.literal(true), document: documentContextSchema, plan: planSchema, postcondition: postconditionSchema, transaction: transactionSchema }),
]).superRefine((result, context) => {
    if (result.transaction.state !== 'planned' && !result.plan.applyAllowed) {
        context.addIssue({ code: 'custom', message: 'A pathfinder apply outcome requires an executable plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified') {
            context.addIssue({ code: 'custom', message: 'Applied pathfinder requires a verified transaction.' });
            return;
        }
        const { group, paths, provenance, sourcesAfter, parentOrderAfter } = result.postcondition;
        const plan = result.plan;
        const sourceByUuid = new Map(plan.sourcesBefore.map((source) => [source.uuid, source]));
        const created = [group.uuid, provenance.operandGroupUuid, ...provenance.duplicates.map((item) => item.duplicateUuid), ...group.childOrder];
        if (new Set(created).size !== created.length || created.some((uuid) => plan.parentOrderBefore.includes(uuid)) ||
            provenance.resultGroupUuid !== group.uuid ||
            !sameCanonical(provenance.duplicates.map((item) => item.sourceUuid), plan.predicted.operandOrder) ||
            !sameCanonical(provenance.resultPaths, paths.map((path, index) => ({ uuid: path.uuid, paintSourceUuid: plan.predicted.paths[index]?.paintSourceUuid }))) ||
            !sameCanonical(group.layerPath, plan.layer.layerPath) ||
            !sameCanonical(group.childOrder, paths.map((path) => path.uuid)) ||
            paths.length !== plan.predicted.paths.length ||
            paths.some((path, index) => {
                const predicted = plan.predicted.paths[index];
                return !resultPathMatches(predicted, sourceByUuid.get(predicted.paintSourceUuid), path);
            }) ||
            !closeList(group.geometricBounds, plan.predicted.groupGeometricBounds) ||
            !closeList(group.visibleBounds, plan.predicted.groupVisibleBounds) ||
            !sameCanonical(sourcesAfter, plan.sourcesBefore) ||
            !sameCanonical(parentOrderAfter, plan.predicted.parentOrderAfter.map((uuid) => uuid ?? group.uuid))) {
            context.addIssue({ code: 'custom', message: 'Verified pathfinder result must match the planned structure, outline, paint, untouched sources, and parent order.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified pathfinder transaction must be applied.' });
    }
    if (result.transaction.state === 'rolled_back' &&
        (!sameCanonical(result.transaction.rollback.restoredSources, result.plan.sourcesBefore) ||
            !sameCanonical(result.transaction.rollback.restoredParentOrder, result.plan.parentOrderBefore))) {
        context.addIssue({ code: 'custom', message: 'Rolled-back pathfinder must prove exact sources and parent order.' });
    }
});
export const applyPathfinderResponseSchema = z.strictObject({
    outcome: applyPathfinderResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
export const APPLY_PATHFINDER_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: APPLY_PATHFINDER_OPERATION,
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
export const APPLY_PATHFINDER_SAFETY_IDENTITY = canonicalDigest(APPLY_PATHFINDER_SAFETY);
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    return bindOperationSafetyPlan({
        policyVersion: 1,
        operationClass: 'create',
        operationId: APPLY_PATHFINDER_OPERATION,
        canonicalRequestDigest: requestDigest,
        evidence: {
            documentKey: admissionDocumentKey,
            targetLocator: `sources:${result.plan.sourceUuids.join(',')};mode:${result.plan.mode};layer:${result.plan.layer.layerPath.join('.')};order:${canonicalDigest(result.plan.parentOrderBefore)}`,
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
    return rollback.resultGroupUuid ?? rollback.operandGroupUuid ?? rollback.duplicateUuids[0];
}
function safetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' || transaction.state === 'rollback_indeterminate') {
        throw new Error('Indeterminate pathfinder results cannot be represented as terminal safety results.');
    }
    const common = {
        policyVersion: 1, operationClass: 'create', operationId: APPLY_PATHFINDER_OPERATION,
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
    const result = applyPathfinderResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null)
        throw new Error('Pathfinder terminal result requires a durable attestation resolver.');
    await assertOperationSafetyAdapterConformance({
        registration: APPLY_PATHFINDER_SAFETY, plan, result: safetyResult(result, requestDigest, attestation, plan),
    }, resolver);
}
export const APPLY_PATHFINDER_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}${CLIPPING_MASK_HOST_SCRIPT}
var PATHFINDER_MAX_SELECTION = ${APPLY_PATHFINDER_MAX_SELECTION};
var PATHFINDER_TOLERANCE = ${PATHFINDER_GEOMETRY_TOLERANCE};
var PATHFINDER_LIVE_COMMANDS = ${JSON.stringify(PATHFINDER_LIVE_COMMANDS)};

/** The paint model the cells measured for this document: RGBColor in RGB, CMYKColor in CMYK. */
function pathfinderDocumentModel(document) {
  var space;
  try { space = document.documentColorSpace; }
  catch (spaceError) { throw mutationError("preflight_failed", "The bound document color space is unavailable."); }
  if (space === DocumentColorSpace.CMYK) return { colorSpace: "CMYK", model: "CMYKColor" };
  if (space === DocumentColorSpace.RGB) return { colorSpace: "RGB", model: "RGBColor" };
  throw mutationError("preflight_failed", "The bound document color space is not RGB or CMYK.");
}

function pathfinderCorners(bounds) {
  return [[bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[2], bounds[3]], [bounds[0], bounds[3]]];
}

function pathfinderHas(list, anchor) {
  for (var index = 0; index < list.length; index++) if (list[index][0] === anchor[0] && list[index][1] === anchor[1]) return true;
  return false;
}

function pathfinderSymmetricDifference(left, right) {
  var out = [];
  var index;
  for (index = 0; index < left.length; index++) if (!pathfinderHas(right, left[index])) out.push(left[index]);
  for (index = 0; index < right.length; index++) if (!pathfinderHas(left, right[index])) out.push(right[index]);
  return out;
}

function pathfinderInside(anchor, bounds) {
  return bounds[0] < anchor[0] && anchor[0] < bounds[2] && bounds[3] < anchor[1] && anchor[1] < bounds[1];
}

function pathfinderSortAnchors(anchors) {
  var copy = anchors.slice(0);
  copy.sort(function (left, right) { return (left[0] - right[0]) || (left[1] - right[1]); });
  return copy;
}

function pathfinderExpand(bounds, half) {
  return [bounds[0] - half, bounds[1] + half, bounds[2] + half, bounds[3] - half];
}

function pathfinderUnion(left, right) {
  return [Math.min(left[0], right[0]), Math.max(left[1], right[1]), Math.max(left[2], right[2]), Math.min(left[3], right[3])];
}

function pathfinderStrictPartial(firstStart, firstEnd, secondStart, secondEnd) {
  return ((firstStart < secondStart) && (secondStart < firstEnd) && (firstEnd < secondEnd)) ||
    ((secondStart < firstStart) && (firstStart < secondEnd) && (secondEnd < firstEnd));
}

function pathfinderClose(left, right) { return Math.abs(left - right) <= PATHFINDER_TOLERANCE; }

function pathfinderCloseList(left, right) {
  if (left.length !== right.length) return false;
  for (var index = 0; index < left.length; index++) if (!pathfinderClose(left[index], right[index])) return false;
  return true;
}

function pathfinderSameAnchorSet(actual, expected) {
  if (actual.length !== expected.length) return false;
  var used = [];
  for (var fill = 0; fill < actual.length; fill++) used.push(false);
  for (var index = 0; index < expected.length; index++) {
    var found = -1;
    for (var candidate = 0; candidate < actual.length; candidate++) {
      if (!used[candidate] && pathfinderCloseList(actual[candidate], expected[index])) { found = candidate; break; }
    }
    if (found < 0) return false;
    used[found] = true;
  }
  return true;
}

function pathfinderAxisAligned(anchors) {
  for (var index = 0; index < anchors.length; index++) {
    var anchor = anchors[index];
    var next = anchors[(index + 1) % anchors.length];
    if (!pathfinderClose(anchor[0], next[0]) && !pathfinderClose(anchor[1], next[1])) return false;
  }
  return true;
}

/** Only the measured operand: a closed axis-aligned rectangle of four corner points without handles. */
function pathfinderAssertRectangle(snapshot) {
  var bounds = snapshot.geometricBounds;
  if (!snapshot.closed || snapshot.pathPoints.length !== 4 || !(bounds[2] > bounds[0]) || !(bounds[1] > bounds[3])) {
    throw clipUnsupported("path_shape_unmeasured", snapshot.uuid);
  }
  var anchors = [];
  for (var index = 0; index < 4; index++) {
    var point = snapshot.pathPoints[index];
    if (point.pointType !== "PointType.CORNER" ||
        point.leftDirection[0] !== point.anchor[0] || point.leftDirection[1] !== point.anchor[1] ||
        point.rightDirection[0] !== point.anchor[0] || point.rightDirection[1] !== point.anchor[1]) {
      throw clipUnsupported("path_shape_unmeasured", snapshot.uuid);
    }
    anchors.push(point.anchor);
  }
  var sorted = pathfinderSortAnchors(anchors);
  var corners = pathfinderSortAnchors(pathfinderCorners(bounds));
  for (var cornerIndex = 0; cornerIndex < 4; cornerIndex++) {
    if (sorted[cornerIndex][0] !== corners[cornerIndex][0] || sorted[cornerIndex][1] !== corners[cornerIndex][1]) {
      throw clipUnsupported("path_shape_unmeasured", snapshot.uuid);
    }
  }
  if (!pathfinderAxisAligned(anchors)) throw clipUnsupported("path_shape_unmeasured", snapshot.uuid);
}

/** Only the measured paint: filled and stroked at 1 pt in the document's model, opacity 100. */
function pathfinderAssertPaint(snapshot, model) {
  if (!snapshot.filled || !snapshot.stroked || snapshot.strokeWidth !== 1) throw clipUnsupported("paint_unmeasured", snapshot.uuid);
  if (snapshot.fillColor.type !== model || snapshot.strokeColor.type !== model) throw clipUnsupported("color_model_unmeasured", snapshot.uuid);
  if (snapshot.opacity !== 100) throw clipUnsupported("opacity_unmeasured", snapshot.uuid);
}

function pathfinderPredictedPath(source, bounds, anchors) {
  return { paintSourceUuid: source.uuid, geometricBounds: bounds,
    visibleBounds: pathfinderExpand(bounds, source.strokeWidth / 2), anchors: pathfinderSortAnchors(anchors) };
}

/** Same arithmetic as predictPathfinder in the adapter; the plan schema recomputes it. */
function pathfinderPredict(mode, front, back) {
  var frontBounds = front.geometricBounds;
  var backBounds = back.geometricBounds;
  var overlap = [Math.max(frontBounds[0], backBounds[0]), Math.min(frontBounds[1], backBounds[1]),
    Math.min(frontBounds[2], backBounds[2]), Math.max(frontBounds[3], backBounds[3])];
  var frontCorners = pathfinderCorners(frontBounds);
  var backCorners = pathfinderCorners(backBounds);
  var overlapCorners = pathfinderCorners(overlap);
  var paths;
  if (mode === "unite") {
    var candidates = frontCorners.concat(backCorners).concat(overlapCorners);
    var all = [];
    for (var index = 0; index < candidates.length; index++) {
      var anchor = candidates[index];
      if (!pathfinderHas(all, anchor) && !pathfinderInside(anchor, frontBounds) && !pathfinderInside(anchor, backBounds)) all.push(anchor);
    }
    paths = [pathfinderPredictedPath(front, pathfinderUnion(frontBounds, backBounds), all)];
  } else if (mode === "minus_front") {
    paths = [pathfinderPredictedPath(back, backBounds, pathfinderSymmetricDifference(backCorners, overlapCorners))];
  } else if (mode === "intersect") {
    paths = [pathfinderPredictedPath(front, overlap, overlapCorners)];
  } else {
    paths = [pathfinderPredictedPath(front, frontBounds, pathfinderSymmetricDifference(frontCorners, overlapCorners)),
      pathfinderPredictedPath(front, backBounds, pathfinderSymmetricDifference(backCorners, overlapCorners))];
  }
  var groupGeometric = paths[0].geometricBounds;
  var groupVisible = paths[0].visibleBounds;
  for (var pathIndex = 1; pathIndex < paths.length; pathIndex++) {
    groupGeometric = pathfinderUnion(groupGeometric, paths[pathIndex].geometricBounds);
    groupVisible = pathfinderUnion(groupVisible, paths[pathIndex].visibleBounds);
  }
  return { groupGeometricBounds: groupGeometric, groupVisibleBounds: groupVisible, paths: paths };
}

/** The current selection as page items, or null when it is not an array of UUID-bearing page items. */
function pathfinderReadSelection(document) {
  var selection = document.selection;
  if (selection === null || selection === undefined) return { items: [], uuids: [] };
  if (typeof selection !== "object" || selection.typename !== undefined || typeof selection.length !== "number" ||
      selection.length > PATHFINDER_MAX_SELECTION) return null;
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

function pathfinderSameSet(left, right) {
  if (left.length !== right.length) return false;
  var a = left.slice(0).sort();
  var b = right.slice(0).sort();
  for (var index = 0; index < a.length; index++) if (a[index] !== b[index]) return false;
  return true;
}

/** Writes the saved selection back and reads it again; a failure is reported, never thrown. */
function pathfinderRestoreSelection(document, saved) {
  var after = null;
  try {
    document.selection = saved.items.length === 0 ? null : saved.items;
    var read = pathfinderReadSelection(document);
    after = read === null ? null : read.uuids;
  } catch (error) { after = null; }
  return { before: saved.uuids, after: after, restored: after !== null && pathfinderSameSet(saved.uuids, after) };
}

/** Document-wide counts: a created item the call cannot name still changes one of them. */
function pathfinderCounts(document) {
  return { pathItems: clipCollection(document, "PathItem").length, groupItems: clipCollection(document, "GroupItem").length,
    compoundPathItems: clipCollection(document, "CompoundPathItem").length };
}

function pathfinderResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  var uuids = params.sourceUuids;
  if (!uuids || uuids.length !== 2) throw mutationError("preflight_failed", "Exactly two source UUIDs are required.");
  if (uuids[0] === uuids[1]) throw clipUnsupported("same_target", uuids[0]);
  var liveCommand = PATHFINDER_LIVE_COMMANDS.hasOwnProperty(params.mode) ? PATHFINDER_LIVE_COMMANDS[params.mode] : null;
  if (typeof liveCommand !== "string") throw mutationError("preflight_failed", "Pathfinder mode is not one of the measured modes.");
  var space = pathfinderDocumentModel(document);
  var admitCmyk = function () { return space.colorSpace === "CMYK"; };
  var sources = [clipResolve(document, uuids[0], ["PathItem"]), clipResolve(document, uuids[1], ["PathItem"])];
  var layer = sources[0].layer;
  if (!layer || String(layer.typename) !== "Layer" || sources[0].parent !== layer) throw clipUnsupported("parent_unmeasured", uuids[0]);
  if (sources[1].layer !== layer || sources[1].parent !== layer) throw clipUnsupported("parent_unmeasured", uuids[1]);
  var layerState = clipLayerState(document, layer, uuids[0]);
  var snapshots = [clipPathSnapshot(document, sources[0], layer, admitCmyk), clipPathSnapshot(document, sources[1], layer, admitCmyk)];
  for (var index = 0; index < 2; index++) {
    if (snapshots[index].clipping) throw clipUnsupported("source_is_clipping_path", uuids[index]);
    pathfinderAssertRectangle(snapshots[index]);
    pathfinderAssertPaint(snapshots[index], space.model);
  }
  var parentOrder = supportedPathOrder(layer);
  if (parentOrder.length >= SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS) throw clipUnsupported("parent_too_large", uuids[0]);
  var frontIndex = clipIndexOf(parentOrder, uuids[0]) < clipIndexOf(parentOrder, uuids[1]) ? 0 : 1;
  var front = snapshots[frontIndex];
  var back = snapshots[1 - frontIndex];
  if (!pathfinderStrictPartial(front.geometricBounds[0], front.geometricBounds[2], back.geometricBounds[0], back.geometricBounds[2]) ||
      !pathfinderStrictPartial(front.geometricBounds[3], front.geometricBounds[1], back.geometricBounds[3], back.geometricBounds[1])) {
    throw clipUnsupported("overlap_unmeasured", uuids[1]);
  }
  var blockers = [];
  clipCommonBlockers(context, layerState, blockers);
  clipItemBlockers(snapshots[0], "source_locked", "source_hidden", blockers);
  clipItemBlockers(snapshots[1], "source_locked", "source_hidden", blockers);
  clipEditableBlocker(sources, blockers);
  if (pathfinderReadSelection(document) === null) clipAddBlocker(blockers, "selection_unsupported");
  if (forApply && blockers.length > 0) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "PATHFINDER_APPLY_BLOCKED", reasonCodes: blockers }));
  }
  return { context: context, document: document, layer: layer, layerState: layerState, sources: sources, space: space,
    liveCommand: liveCommand, snapshots: snapshots, parentOrderBefore: parentOrder,
    front: sources[frontIndex], back: sources[1 - frontIndex], frontSnapshot: front, backSnapshot: back,
    operandOrder: [uuids[frontIndex], uuids[1 - frontIndex]], counts: pathfinderCounts(document), blockers: blockers };
}

function pathfinderPreflight(forApply) {
  var resolved = pathfinderResolve(forApply);
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

function pathfinderPlan(preflight) {
  var order = [null];
  for (var index = 0; index < preflight.parentOrderBefore.length; index++) order.push(preflight.parentOrderBefore[index]);
  var predicted = pathfinderPredict(params.mode, preflight.frontSnapshot, preflight.backSnapshot);
  return {
    operation: "apply_pathfinder", documentKey: preflight.context.key, mode: params.mode, liveCommand: preflight.liveCommand,
    colorSpace: preflight.space.colorSpace, sourceUuids: [params.sourceUuids[0], params.sourceUuids[1]],
    layer: preflight.layerState, sourcesBefore: preflight.snapshots, parentOrderBefore: preflight.parentOrderBefore,
    predicted: {
      consumedSourceUuids: [],
      operandOrder: preflight.operandOrder,
      parentOrderAfter: order,
      groupGeometricBounds: predicted.groupGeometricBounds,
      groupVisibleBounds: predicted.groupVisibleBounds,
      paths: predicted.paths
    },
    applyBlockedReasonCodes: preflight.blockers, applyAllowed: preflight.blockers.length === 0
  };
}

function pathfinderRevalidate(preflight, plan) {
  var current;
  try { current = pathfinderResolve(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Pathfinder preconditions changed before apply.")); }
  if (current.document !== preflight.document || current.layer !== preflight.layer ||
      current.sources[0] !== preflight.sources[0] || current.sources[1] !== preflight.sources[1] ||
      !supportedPathSame(current.snapshots, plan.sourcesBefore) ||
      !mutationSameSequence(current.parentOrderBefore, plan.parentOrderBefore) ||
      !supportedPathSame(current.counts, preflight.counts)) {
    throw mutationBeforeSideEffectError("Pathfinder sources, parent order, or document counts changed before apply.");
  }
  // Read in the same call right before the first write; pathfinderResolve(true) already refused an unsupported selection.
  preflight.savedSelection = pathfinderReadSelection(preflight.document);
  if (preflight.savedSelection === null) throw mutationBeforeSideEffectError("The selection is not a list of page items.");
}

function pathfinderKnownUuid(state, uuid) {
  var evidence = state.operationState.rollbackEvidence;
  return uuid === params.sourceUuids[0] || uuid === params.sourceUuids[1] || uuid === evidence.operandGroupUuid ||
    uuid === evidence.resultGroupUuid || clipIndexOf(evidence.duplicateUuids, uuid) >= 0;
}

function pathfinderCaptureDuplicate(state, source, layer) {
  // Set before the first write: from here on a throw can leave a created item behind.
  state.operationState.mutationStarted = true;
  var duplicate = source.duplicate(layer, ElementPlacement.PLACEATEND);
  if (!duplicate) throw mutationError("apply_failed", "Illustrator did not return the duplicate path.");
  state.operationState.duplicates.push(duplicate);
  var uuid = duplicate.uuid;
  if (typeof uuid !== "string" || uuid.length === 0 || pathfinderKnownUuid(state, uuid)) {
    throw mutationError("apply_failed", "Illustrator did not return a distinct native UUID for the duplicate path.");
  }
  state.operationState.rollbackEvidence.duplicateUuids.push(uuid);
  return duplicate;
}

/**
 * After expandStyle (measured): the operand group and both duplicates are gone and exactly one new GroupItem sits
 * at the front of the layer. Its identity is captured before the remaining checks, so a later refusal still lets
 * the rollback remove it.
 */
function pathfinderCaptureResult(document, preflight, state) {
  var evidence = state.operationState.rollbackEvidence;
  var order = supportedPathOrder(preflight.layer);
  if (order.length === preflight.parentOrderBefore.length + 1 && !pathfinderKnownUuid(state, order[0])) {
    var candidate = preflight.layer.pageItems[0];
    if (String(candidate.typename) === "GroupItem" && clipTyped(document, "GroupItem", order[0]) === candidate) {
      state.operationState.resultGroup = candidate;
      evidence.resultGroupUuid = order[0];
    }
  }
  if (evidence.operandGroupUuid !== null && clipTyped(document, "GroupItem", evidence.operandGroupUuid) !== null) {
    throw mutationError("apply_failed", "Illustrator did not expand the live pathfinder: the operand group is still present.");
  }
  for (var index = 0; index < evidence.duplicateUuids.length; index++) {
    if (clipTyped(document, "PathItem", evidence.duplicateUuids[index]) !== null) {
      throw mutationError("apply_failed", "A duplicate operand is still present after the expansion.");
    }
  }
  if (evidence.resultGroupUuid === null || !mutationSameSequence(order.slice(1), preflight.parentOrderBefore)) {
    throw mutationError("apply_failed", "The layer does not hold exactly one new group at the front after the expansion.");
  }
  return state.operationState.resultGroup;
}

function pathfinderApply(preflight, plan, state) {
  var document = preflight.document;
  var layer = preflight.layer;
  var operationState = state.operationState;
  var evidence = operationState.rollbackEvidence;
  operationState.savedSelection = preflight.savedSelection;
  // Measured sequence: duplicate both, group them front first, select the group, run the live command and
  // expandStyle with alerts off.
  var front = pathfinderCaptureDuplicate(state, preflight.front, layer);
  var back = pathfinderCaptureDuplicate(state, preflight.back, layer);
  operationState.groupAddAttempted = true;
  var group = layer.groupItems.add();
  if (!group) throw mutationError("apply_failed", "Illustrator did not return the operand group.");
  var groupUuid = group.uuid;
  if (typeof groupUuid !== "string" || groupUuid.length === 0 || pathfinderKnownUuid(state, groupUuid)) {
    throw mutationError("apply_failed", "Illustrator did not return a distinct native UUID for the operand group.");
  }
  operationState.operandGroup = group;
  evidence.operandGroupUuid = groupUuid;
  front.move(group, ElementPlacement.PLACEATEND);
  back.move(group, ElementPlacement.PLACEATEND);
  var previousInteraction = app.userInteractionLevel;
  app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
  try {
    document.selection = [group];
    app.executeMenuCommand(preflight.liveCommand);
    app.executeMenuCommand("expandStyle");
  } finally {
    app.userInteractionLevel = previousInteraction;
  }
  var result = pathfinderCaptureResult(document, preflight, state);
  operationState.selection = pathfinderRestoreSelection(document, operationState.savedSelection);
  evidence.selection = operationState.selection;
  return result;
}

/** A readable reason for an error that carries no public message (a shared-gate refusal or a host exception). */
function pathfinderDescribeError(error) {
  var message = error && error.message ? String(error.message) : String(error);
  if (message.indexOf("MCP_ERROR:") === 0) return message.substring("MCP_ERROR:".length);
  return (error && error.name ? String(error.name) + " " : "") + (error && typeof error.number === "number" ? error.number + " " : "") + message;
}

/** Result path read with the properties the measured read-back read, and nothing else. */
function pathfinderResultPath(path, group, index, model, admitCmyk) {
  function differs(what) { return mutationError("verify_mismatch", "Pathfinder result path " + index + " " + what + "."); }
  if (!path || String(path.typename) !== "PathItem" || typeof path.uuid !== "string" || path.uuid.length === 0) {
    throw differs("is not a PathItem with a native UUID");
  }
  if (path.parent !== group) throw differs("is not parented by the result group");
  if (!path.pathPoints || path.pathPoints.length < 4 || path.pathPoints.length > 8) throw differs("point count is outside the prediction");
  var anchors = [];
  for (var pointIndex = 0; pointIndex < path.pathPoints.length; pointIndex++) {
    var point = path.pathPoints[pointIndex];
    var anchor = supportedPathPoint(point.anchor, "result.pathPoints[" + pointIndex + "].anchor");
    var left = supportedPathPoint(point.leftDirection, "result.pathPoints[" + pointIndex + "].leftDirection");
    var right = supportedPathPoint(point.rightDirection, "result.pathPoints[" + pointIndex + "].rightDirection");
    if (String(point.pointType) !== "PointType.CORNER" || !pathfinderCloseList(left, anchor) || !pathfinderCloseList(right, anchor)) {
      throw differs("has a curved or smooth point");
    }
    anchors.push(anchor);
  }
  if (typeof path.filled !== "boolean" || typeof path.stroked !== "boolean" ||
      typeof path.locked !== "boolean" || typeof path.hidden !== "boolean") {
    throw differs("appearance or safety state is unavailable");
  }
  if (path.closed !== true) throw differs("is open");
  if (path.locked || path.hidden) throw differs("is locked or hidden");
  function paint(value, label) {
    if (!value || String(value.typename) !== model) throw differs(label + " is not " + model);
    return supportedPathPaint(value, label, { cmykAdmitted: admitCmyk, cmykRefusal: "" });
  }
  return {
    uuid: path.uuid,
    type: "PathItem",
    parentType: "GroupItem",
    geometricBounds: supportedPathBounds(path.geometricBounds, "result.geometricBounds"),
    visibleBounds: supportedPathBounds(path.visibleBounds, "result.visibleBounds"),
    closed: true,
    anchors: anchors,
    filled: path.filled,
    fillColor: path.filled ? paint(path.fillColor, "fillColor") : null,
    stroked: path.stroked,
    strokeColor: path.stroked ? paint(path.strokeColor, "strokeColor") : null,
    strokeWidth: path.stroked ? supportedPathNumber(path.strokeWidth, "strokeWidth") : null,
    polarity: String(path.polarity),
    locked: false,
    hidden: false
  };
}

function pathfinderPaint(snapshot) {
  return stringifyJson({ filled: snapshot.filled, fillColor: snapshot.fillColor, stroked: snapshot.stroked,
    strokeColor: snapshot.strokeColor, strokeWidth: snapshot.strokeWidth });
}

/** Every verify failure names its check: an error without a public message becomes a described verify_mismatch. */
function pathfinderVerify(preflight, plan, state) {
  try { return pathfinderVerifyChecked(preflight, plan, state); }
  catch (error) {
    if (error && typeof error.mutationPublicMessage === "string" && error.mutationPublicMessage.length > 0) throw error;
    throw mutationError("verify_mismatch", "Pathfinder verification raised: " + pathfinderDescribeError(error));
  }
}

function pathfinderVerifyChecked(preflight, plan, state) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) {
    throw mutationError("verify_mismatch", "Active document changed during pathfinder verification.");
  }
  var document = preflight.document;
  var evidence = state.operationState.rollbackEvidence;
  var group = clipTyped(document, "GroupItem", evidence.resultGroupUuid);
  if (group === null || group !== state.operationState.resultGroup || group.parent !== preflight.layer) {
    throw mutationError("verify_mismatch", "Result group native identity does not match the plan.");
  }
  if (typeof group.locked !== "boolean" || typeof group.hidden !== "boolean" || typeof group.clipped !== "boolean" ||
      group.locked || group.hidden || group.clipped) {
    throw mutationError("verify_mismatch", "Result group is locked, hidden, clipped, or unreadable.");
  }
  var expectedPaths = plan.predicted.paths;
  var children = group.pageItems;
  if (!children || children.length !== expectedPaths.length) {
    throw mutationError("verify_mismatch", "Result group holds " + (children ? children.length : "no") + " items; the plan predicted " + expectedPaths.length + ".");
  }
  var admitCmyk = function () { return preflight.space.colorSpace === "CMYK"; };
  var paths = [];
  var childOrder = [];
  var resultPaths = [];
  for (var index = 0; index < children.length; index++) {
    var child = children[index];
    if (String(child.typename) !== "PathItem" || clipTyped(document, "PathItem", String(child.uuid)) !== child) {
      throw mutationError("verify_mismatch", "Result group item " + index + " is a " + String(child.typename) + ", not a PathItem.");
    }
    var snapshot = pathfinderResultPath(child, group, index, preflight.space.model, admitCmyk);
    if (pathfinderKnownUuid(state, snapshot.uuid) || clipIndexOf(childOrder, snapshot.uuid) >= 0) {
      throw mutationError("verify_mismatch", "Result path " + index + " reuses a known native UUID.");
    }
    var predicted = expectedPaths[index];
    var source = plan.sourcesBefore[plan.sourceUuids[0] === predicted.paintSourceUuid ? 0 : 1];
    if (!pathfinderSameAnchorSet(snapshot.anchors, predicted.anchors) || !pathfinderAxisAligned(snapshot.anchors)) {
      throw mutationError("verify_mismatch", "Result path " + index + " outline does not match the prediction (" + stringifyJson(snapshot.anchors) + ").");
    }
    if (!pathfinderCloseList(snapshot.geometricBounds, predicted.geometricBounds) ||
        !pathfinderCloseList(snapshot.visibleBounds, predicted.visibleBounds)) {
      throw mutationError("verify_mismatch", "Result path " + index + " bounds do not match the prediction.");
    }
    if (pathfinderPaint(snapshot) !== pathfinderPaint(source)) {
      throw mutationError("verify_mismatch", "Result path " + index + " paint does not match its source " + predicted.paintSourceUuid + ".");
    }
    paths.push(snapshot);
    childOrder.push(snapshot.uuid);
    resultPaths.push({ uuid: snapshot.uuid, paintSourceUuid: predicted.paintSourceUuid });
  }
  var geometricBounds = supportedPathBounds(group.geometricBounds, "group.geometricBounds");
  var visibleBounds = supportedPathBounds(group.visibleBounds, "group.visibleBounds");
  if (!pathfinderCloseList(geometricBounds, plan.predicted.groupGeometricBounds) ||
      !pathfinderCloseList(visibleBounds, plan.predicted.groupVisibleBounds)) {
    throw mutationError("verify_mismatch", "Result group bounds do not match the prediction.");
  }
  var sourceSnapshots = [];
  for (var sourceIndex = 0; sourceIndex < 2; sourceIndex++) {
    var current = clipTyped(document, "PathItem", params.sourceUuids[sourceIndex]);
    if (current !== preflight.sources[sourceIndex]) throw mutationError("verify_mismatch", "A source path identity changed.");
    sourceSnapshots.push(clipPathSnapshot(document, current, preflight.layer, admitCmyk));
  }
  if (!supportedPathSame(sourceSnapshots, plan.sourcesBefore)) throw mutationError("verify_mismatch", "A source path changed.");
  var parentOrderAfter = supportedPathOrder(preflight.layer);
  var expectedOrder = [evidence.resultGroupUuid].concat(plan.parentOrderBefore);
  if (!mutationSameSequence(parentOrderAfter, expectedOrder)) {
    throw mutationError("verify_mismatch", "Parent order after the pathfinder does not match the plan.");
  }
  var counts = pathfinderCounts(document);
  if (counts.pathItems !== preflight.counts.pathItems + expectedPaths.length ||
      counts.groupItems !== preflight.counts.groupItems + 1 || counts.compoundPathItems !== preflight.counts.compoundPathItems) {
    throw mutationError("verify_mismatch", "Document item counts do not match one result group (" + stringifyJson(counts) + ").");
  }
  var layerInfo = supportedPathLayerChain(document, preflight.layer);
  var duplicates = [];
  for (var duplicateIndex = 0; duplicateIndex < 2; duplicateIndex++) {
    duplicates.push({ sourceUuid: plan.predicted.operandOrder[duplicateIndex], duplicateUuid: evidence.duplicateUuids[duplicateIndex] });
  }
  return {
    group: { uuid: evidence.resultGroupUuid, layerPath: layerInfo.path, geometricBounds: geometricBounds, visibleBounds: visibleBounds,
      clipped: false, locked: false, hidden: false, childOrder: childOrder },
    paths: paths,
    provenance: { duplicates: duplicates, operandGroupUuid: evidence.operandGroupUuid, resultGroupUuid: evidence.resultGroupUuid,
      resultPaths: resultPaths },
    sourcesAfter: sourceSnapshots, parentOrderAfter: parentOrderAfter,
    selection: state.operationState.selection
  };
}

function pathfinderVerifyRestored(state) {
  var preflight = state.preflight;
  var document = preflight.document;
  var evidence = state.operationState.rollbackEvidence;
  var groups = [evidence.resultGroupUuid, evidence.operandGroupUuid];
  for (var groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    if (groups[groupIndex] !== null && clipTyped(document, "GroupItem", groups[groupIndex]) !== null) {
      return { status: "indeterminate", message: "A created group is still present after recovery." };
    }
  }
  for (var index = 0; index < evidence.duplicateUuids.length; index++) {
    if (clipTyped(document, "PathItem", evidence.duplicateUuids[index]) !== null) {
      return { status: "indeterminate", message: "A created duplicate path is still present after recovery." };
    }
  }
  var admitCmyk = function () { return preflight.space.colorSpace === "CMYK"; };
  var restored = [];
  for (var sourceIndex = 0; sourceIndex < 2; sourceIndex++) {
    var source = clipTyped(document, "PathItem", params.sourceUuids[sourceIndex]);
    if (source !== preflight.sources[sourceIndex] || source.parent !== preflight.layer) {
      return { status: "indeterminate", message: "Restored source identity or parent is indeterminate." };
    }
    restored.push(clipPathSnapshot(document, source, preflight.layer, admitCmyk));
  }
  var restoredOrder = supportedPathOrder(preflight.layer);
  evidence.restoredSources = restored;
  evidence.restoredParentOrder = restoredOrder;
  if (!supportedPathSame(restored, preflight.snapshots) || !mutationSameSequence(restoredOrder, preflight.parentOrderBefore)) {
    return { status: "indeterminate", message: "Exact source or parent-order restoration is unproved." };
  }
  if (!supportedPathSame(pathfinderCounts(document), preflight.counts)) {
    return { status: "indeterminate", message: "Document item counts differ after recovery; an unnamed created item may remain." };
  }
  return { status: "verified" };
}

/** Removes one self-created item captured by reference; "failed" only when it provably stayed. */
function pathfinderRemoveCaptured(document, type, uuid, reference, allowedParents) {
  var current = clipTyped(document, type, uuid);
  if (current === null) return null;
  if (current !== reference) return { status: "indeterminate", message: "Rollback refused because a created " + type + " identity changed." };
  var parentAllowed = false;
  for (var index = 0; index < allowedParents.length; index++) if (allowedParents[index] !== null && current.parent === allowedParents[index]) parentAllowed = true;
  if (!parentAllowed) return { status: "indeterminate", message: "Rollback refused because a created " + type + " moved." };
  if (typeof current.locked !== "boolean" || typeof current.hidden !== "boolean") {
    return { status: "indeterminate", message: "Rollback " + type + " safety state is unreadable." };
  }
  if (current.locked || current.hidden) return { status: "failed", message: "Rollback refused because a created " + type + " is not safely editable." };
  try { current.remove(); } catch (error) { /* absence decides below */ }
  if (clipTyped(document, type, uuid) !== null) return { status: "failed", message: "Rollback did not remove the created " + type + "." };
  return null;
}

function pathfinderRollback(state) {
  var preflight = state.preflight;
  var operationState = state.operationState;
  var evidence = operationState.rollbackEvidence;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) {
    return { status: "indeterminate", message: "Rollback pathfinder document is indeterminate." };
  }
  var document = preflight.document;
  // A duplicate() or groupItems.add() that threw, or returned without a recorded UUID, may have left an item
  // nobody can name.
  if (evidence.duplicateUuids.length === 0 || operationState.duplicates.length !== evidence.duplicateUuids.length) {
    return { status: "indeterminate", message: "Rollback refused because a created duplicate has no recorded native UUID." };
  }
  if (operationState.groupAddAttempted && evidence.operandGroupUuid === null) {
    return { status: "indeterminate", message: "Rollback refused because the created operand group has no recorded native UUID." };
  }
  if (preflight.layer.locked || !preflight.layer.visible) {
    return { status: "failed", message: "Rollback refused because the target layer is not safely editable." };
  }
  var outcome;
  try {
    // Measured inverse: remove the created result group. Before the expansion, the operand group (and the
    // duplicates inside it) or loose duplicates are this call's own and are removed the same way.
    if (evidence.resultGroupUuid !== null) {
      outcome = pathfinderRemoveCaptured(document, "GroupItem", evidence.resultGroupUuid, operationState.resultGroup, [preflight.layer]);
      if (outcome !== null) return outcome;
    }
    if (evidence.operandGroupUuid !== null) {
      outcome = pathfinderRemoveCaptured(document, "GroupItem", evidence.operandGroupUuid, operationState.operandGroup, [preflight.layer]);
      if (outcome !== null) return outcome;
    }
    for (var index = 0; index < evidence.duplicateUuids.length; index++) {
      outcome = pathfinderRemoveCaptured(document, "PathItem", evidence.duplicateUuids[index], operationState.duplicates[index],
        [preflight.layer, operationState.operandGroup]);
      if (outcome !== null) return outcome;
    }
  } catch (error) { return { status: "indeterminate", message: "Rollback pathfinder removal is indeterminate." }; }
  if (operationState.savedSelection !== null) {
    evidence.selection = pathfinderRestoreSelection(document, operationState.savedSelection);
  }
  try { return pathfinderVerifyRestored(state); }
  catch (error) { return { status: "indeterminate", message: "Rollback pathfinder restoration verification is indeterminate." }; }
}

var pathfinderExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionLayers: function (phase, preflight) { return [preflight.layer]; },
  editSessionAffected: function (phase, preflight, plan, state) { return (phase === "after") ? [state.operationState.rollbackEvidence.resultGroupUuid] : []; },
  initialOperationState: function () {
    return { mutationStarted: false, groupAddAttempted: false, resultGroup: null, operandGroup: null, duplicates: [],
      savedSelection: null, selection: null,
      rollbackEvidence: { resultGroupUuid: null, operandGroupUuid: null, duplicateUuids: [], restoredSources: null,
        restoredParentOrder: null, selection: null } };
  },
  preflight: pathfinderPreflight,
  plan: pathfinderPlan,
  revalidate: pathfinderRevalidate,
  applyMutation: pathfinderApply,
  verify: pathfinderVerify,
  rollback: pathfinderRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function (state) {
    return { reasonCode: "identity_unavailable",
      message: "Pathfinder apply outcome is indeterminate because created-item identity is unavailable.",
      evidence: { resultGroupUuid: null, operandGroupUuid: null, duplicateUuids: [], restoredSources: null,
        restoredParentOrder: null, selection: null } };
  },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var pathfinderDocument = pathfinderExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === pathfinderExecution.preflight.document) pathfinderDocument = getDocumentContext();
var result = {
  operation: "apply_pathfinder", applied: pathfinderExecution.transaction.state === "verified",
  document: pathfinderDocument, plan: pathfinderExecution.plan, transaction: pathfinderExecution.transaction
};
if (pathfinderExecution.transaction.state === "verified") result.postcondition = pathfinderExecution.value;
`;
export const APPLY_PATHFINDER_HOST_SCRIPT_DIGEST = canonicalSha256(APPLY_PATHFINDER_SCRIPT);
export const APPLY_PATHFINDER_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2,
    contractVersion: 1,
    operation: APPLY_PATHFINDER_OPERATION,
    validator: APPLY_PATHFINDER_VALIDATOR,
    canonicalContractVersion: CANONICAL_VERSION,
    resultSchemaVersion: RESULT_SCHEMA_VERSION,
    terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION,
    errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: APPLY_PATHFINDER_SAFETY_IDENTITY,
    hostScriptDigest: APPLY_PATHFINDER_HOST_SCRIPT_DIGEST,
    mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    const digestRequest = 'commandId' in request ? (({ commandId: _commandId, ...rest }) => rest)(request) : request;
    const digest = canonicalSha256({
        operation: APPLY_PATHFINDER_OPERATION, validator: APPLY_PATHFINDER_VALIDATOR, request: digestRequest,
    });
    return {
        intent: request.apply ? 'apply' : 'plan', request,
        commandId: 'commandId' in request ? request.commandId : null,
        documentKey: request.expectedDocumentKey, digest,
    };
}
export const applyPathfinderToolContract = {
    name: 'illustrator_apply_pathfinder',
    title: 'Plan or Apply Pathfinder',
    description: 'Plan or apply one Pathfinder operation (mode: unite, minus_front, intersect, exclude) to two paths (source_uuids). Non-destructive: the two sources stay unchanged; the tool duplicates both, groups the duplicates, applies the live pathfinder, and expands it, which leaves one new group at the front of the layer holding the result paths (one path; two for exclude, no compound path). Measured profile only: two axis-aligned rectangles (four corner points, no handles), each with exactly one corner strictly inside the other, filled and stroked at 1 pt in the document colour model (RGB in an RGB document, process CMYK in a CMYK document), opacity 100, directly on the same top-level layer, Illustrator 30.8.1 in the foreground; curves, other shapes, contained or separate rectangles, no fill or stroke, other stroke widths, Gray, spot or gradient paint, groups, compound paths, sublayers, and locked or hidden items are refused. The result takes the front source\'s paint (the back source\'s for minus_front). The plan shows that no source is consumed, the front-to-back operand order, the parent order with the new group first, and every result path\'s anchors, bounds, and paint source. Apply compares expected_sources_before and expected_parent_order, restores the previous selection (reported, never a failure), verifies the group, each path\'s outline, bounds, and paint, the untouched sources, the parent order, and the document item counts by native read-back, and on failure removes only what it created.',
    inputSchema,
    publicInputSchema: applyPathfinderPublicInputSchema,
    outputSchema: applyPathfinderResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(APPLY_PATHFINDER_SAFETY.policy),
    normalizePublicInput,
};
export function mapPathfinderExecutionError(error, detail) {
    if (detail?.code === 'OBJECT_NOT_FOUND') {
        return new Error(`No PageItem with UUID ${JSON.stringify(detail.uuid ?? '')} exists in the bound document.`);
    }
    if (detail?.code === 'CLIP_UNSUPPORTED_TARGET') {
        return new Error(`Pathfinder source ${JSON.stringify(detail.uuid ?? '')} is outside the measured support profile (${detail.reason ?? 'unknown'}).`);
    }
    if (detail?.code === 'PATHFINDER_APPLY_BLOCKED') {
        return new Error(`Pathfinder apply is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}.`);
    }
    return error instanceof Error ? error : new Error(String(error));
}
export function createApplyPathfinderAdapter() {
    return {
        version: 1,
        operation: APPLY_PATHFINDER_OPERATION,
        validator: APPLY_PATHFINDER_VALIDATOR,
        safety: APPLY_PATHFINDER_SAFETY,
        safetyRegistrationIdentity: APPLY_PATHFINDER_SAFETY_IDENTITY,
        adapterIdentity: APPLY_PATHFINDER_ADAPTER_IDENTITY,
        tool: applyPathfinderToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: applyPathfinderResultSchema,
        resultSchemaVersion: RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: CLASSIFIER_VERSION,
        safetyConformanceVersion: CONFORMANCE_VERSION,
        errorMappingVersion: ERROR_MAPPING_VERSION,
        hostScriptDigest: APPLY_PATHFINDER_HOST_SCRIPT_DIGEST,
        mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: APPLY_PATHFINDER_SCRIPT, params };
            return {
                kind: 'mutation', mutationValidator: APPLY_PATHFINDER_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: APPLY_PATHFINDER_OPERATION,
                    documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: APPLY_PATHFINDER_ADAPTER_IDENTITY,
                mutationHostApplicationMode: 'foreground',
                script: APPLY_PATHFINDER_SCRIPT,
                params,
            };
        },
        classifyTerminal(value) {
            const state = applyPathfinderResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back' || state === 'rollback_failed')
                return { state };
            if (state === 'planned')
                throw new Error('Pathfinder plan is not a terminal mutation result.');
            throw new Error('Unverified pathfinder identity or recovery must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError: mapPathfinderExecutionError,
    };
}
