import { z } from 'zod';
import { canonicalSha256 } from '../../mutation-canonical.js';
import { documentContextSchema, mutationAuditSchema } from '../../mutation-result-schema-core.js';
import { swatchResourceDefinitionSchema } from './request.js';
import { spotHostVersionVerified } from './version-gate.js';
const snapshotEntrySchema = z.string().min(1).max(16_384);
export const RESOURCE_SNAPSHOT_MAX_BYTES = 32 * 1024;
export const RESOURCE_CONTEXT_MAX_BYTES = 24 * 1024;
export const RESOURCE_DURABLE_RESULT_MAX_BYTES = 256 * 1024;
function utf8Size(value) {
    return new TextEncoder().encode(JSON.stringify(value)).length;
}
export const resourceCollectionsSnapshotSchema = z.strictObject({
    complete: z.literal(true),
    swatches: z.array(snapshotEntrySchema).max(512),
    gradients: z.array(snapshotEntrySchema).max(512),
    spots: z.array(snapshotEntrySchema).max(512),
});
const collectionKindSchema = z.enum(['swatches', 'gradients', 'spots']);
function expectedCollectionKind(kind) {
    return kind === 'process' ? 'swatches' : kind === 'gradient' ? 'gradients' : 'spots';
}
function expectedResourceType(resource) {
    return resource.kind === 'process' ? (resource.color.model === 'cmyk' ? 'process_cmyk' : 'process_rgb') : resource.kind === 'gradient' ? 'linear_rgb_gradient' : 'spot_rgb';
}
const hostResourceIdentitySchema = z.strictObject({
    collectionKind: collectionKindSchema,
    collectionIndex: z.number().int().nonnegative().max(511),
    swatchIndex: z.number().int().nonnegative().max(511),
    name: z.string().min(1).max(31),
    resourceType: z.enum(['process_rgb', 'process_cmyk', 'linear_rgb_gradient', 'spot_rgb']),
    definition: swatchResourceDefinitionSchema,
    beforeSnapshot: resourceCollectionsSnapshotSchema,
}).superRefine((identity, context) => {
    if (identity.resourceType !== expectedResourceType(identity.definition) ||
        identity.collectionKind !== expectedCollectionKind(identity.definition.kind) ||
        identity.name !== identity.definition.name ||
        (identity.definition.kind === 'process' && identity.collectionIndex !== identity.swatchIndex)) {
        context.addIssue({ code: 'custom', message: 'Native resource identity must be internally consistent with its definition.' });
    }
});
const blockedReasonSchema = z.enum([
    'document_mutation_not_allowed',
    'document_color_space_not_rgb',
    'process_color_space_mismatch',
    'resource_name_already_exists',
    'resource_collection_capacity_exceeded',
    'result_size_limit_exceeded',
    'spot_host_version_unverified',
]);
const planSchema = z.strictObject({
    operation: z.literal('create_swatch_resource'),
    documentKey: z.string().min(1).max(16_384),
    resource: swatchResourceDefinitionSchema,
    collectionKind: collectionKindSchema,
    beforeSnapshot: resourceCollectionsSnapshotSchema,
    nameAbsent: z.boolean(),
    collectionCapacityWithinLimit: z.boolean(),
    resultSizeWithinLimit: z.boolean(),
    hostVersionVerified: z.boolean(),
    applyAllowed: z.boolean(),
    applyBlockedReasonCodes: z.array(blockedReasonSchema),
}).superRefine((plan, context) => {
    if (plan.collectionKind !== expectedCollectionKind(plan.resource.kind)) {
        context.addIssue({ code: 'custom', message: 'Resource kind must match its native collection.', path: ['collectionKind'] });
    }
    if (plan.applyAllowed !== (plan.applyBlockedReasonCodes.length === 0)) {
        context.addIssue({ code: 'custom', message: 'applyAllowed must match the blocker set.', path: ['applyAllowed'] });
    }
    if (plan.nameAbsent === plan.applyBlockedReasonCodes.includes('resource_name_already_exists')) {
        context.addIssue({ code: 'custom', message: 'Name absence must match the collision blocker.', path: ['nameAbsent'] });
    }
    if (plan.collectionCapacityWithinLimit === plan.applyBlockedReasonCodes.includes('resource_collection_capacity_exceeded')) {
        context.addIssue({ code: 'custom', message: 'Predicted collection capacity must match its blocker.', path: ['collectionCapacityWithinLimit'] });
    }
    if (plan.resultSizeWithinLimit === plan.applyBlockedReasonCodes.includes('result_size_limit_exceeded')) {
        context.addIssue({ code: 'custom', message: 'Result-size admission must match its blocker.', path: ['resultSizeWithinLimit'] });
    }
    if (plan.hostVersionVerified === plan.applyBlockedReasonCodes.includes('spot_host_version_unverified')) {
        context.addIssue({ code: 'custom', message: 'Host version verification must match its blocker.', path: ['hostVersionVerified'] });
    }
    if (plan.resource.kind !== 'spot' && !plan.hostVersionVerified) {
        context.addIssue({ code: 'custom', message: 'Only Spot creation is host-version gated.', path: ['hostVersionVerified'] });
    }
});
const executablePlanSchema = z.strictObject({
    ...planSchema.shape,
    nameAbsent: z.literal(true),
    collectionCapacityWithinLimit: z.literal(true),
    resultSizeWithinLimit: z.literal(true),
    hostVersionVerified: z.literal(true),
    applyAllowed: z.literal(true),
    applyBlockedReasonCodes: z.array(z.never()).length(0),
}).superRefine((plan, context) => {
    if (!planSchema.safeParse(plan).success) {
        context.addIssue({ code: 'custom', message: 'Executable resource plan invariants are invalid.' });
    }
    if (utf8Size(plan.beforeSnapshot) > RESOURCE_SNAPSHOT_MAX_BYTES) {
        context.addIssue({ code: 'custom', message: 'Executable resource snapshot exceeds the durable result-size budget.' });
    }
});
const applyFailureSchema = z.strictObject({
    phase: z.literal('apply'), reasonCode: z.literal('apply_failed'), message: z.string().min(1).max(500),
});
const verifyFailureSchema = z.strictObject({
    phase: z.literal('verify'), reasonCode: z.literal('verify_mismatch'), message: z.string().min(1).max(500),
});
const mutationFailureSchema = z.discriminatedUnion('phase', [applyFailureSchema, verifyFailureSchema]);
const transactionSchema = z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('planned'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('verified'), audit: mutationAuditSchema }),
    z.strictObject({
        state: z.literal('apply_failed'), failure: applyFailureSchema,
        rollback: z.strictObject({ status: z.literal('not_required') }), audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rolled_back'), failure: mutationFailureSchema,
        rollback: z.strictObject({
            status: z.literal('verified'), resourceIdentity: hostResourceIdentitySchema,
            restoredSnapshot: resourceCollectionsSnapshotSchema,
        }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rollback_failed'), failure: mutationFailureSchema,
        rollback: z.strictObject({
            status: z.literal('failed'), resourceIdentity: hostResourceIdentitySchema,
            restoredSnapshot: resourceCollectionsSnapshotSchema,
            reasonCode: z.literal('rollback_failed'), message: z.string().min(1).max(500),
        }),
        audit: mutationAuditSchema,
    }),
]).superRefine((transaction, context) => {
    const compact = transaction.audit.map((event) => [
        event.phase, event.event, 'reasonCode' in event ? event.reasonCode : null,
    ]);
    const prefix = [
        ['preflight', 'started', null], ['preflight', 'succeeded', null],
        ['plan', 'started', null], ['plan', 'succeeded', null],
    ];
    let expected;
    if (transaction.state === 'planned') {
        expected = [...prefix, ['apply', 'skipped', 'not_requested'], ['verify', 'skipped', 'not_requested'],
            ['rollback', 'skipped', 'not_requested']];
    }
    else if (transaction.state === 'verified') {
        expected = [...prefix, ['apply', 'started', null], ['apply', 'attempted', null],
            ['apply', 'succeeded', null], ['verify', 'started', null], ['verify', 'succeeded', null],
            ['rollback', 'skipped', 'not_required']];
    }
    else if (transaction.state === 'apply_failed') {
        expected = [...prefix, ['apply', 'started', null], ['apply', 'failed', 'apply_failed'],
            ['verify', 'skipped', 'not_required'], ['rollback', 'skipped', 'not_required']];
    }
    else {
        const failureEvents = transaction.failure.phase === 'apply'
            ? [['apply', 'started', null], ['apply', 'attempted', null], ['apply', 'failed', 'apply_failed'],
                ['verify', 'skipped', 'not_required']]
            : [['apply', 'started', null], ['apply', 'attempted', null], ['apply', 'succeeded', null],
                ['verify', 'started', null], ['verify', 'failed', 'verify_mismatch']];
        expected = [...prefix, ...failureEvents, ['rollback', 'started', null],
            transaction.state === 'rolled_back'
                ? ['rollback', 'succeeded', null]
                : ['rollback', 'failed', 'rollback_failed']];
    }
    if (compact.length !== expected.length || compact.some((entry, index) => entry[0] !== expected[index]?.[0] || entry[1] !== expected[index]?.[1] || entry[2] !== expected[index]?.[2])) {
        context.addIssue({ code: 'custom', message: 'Mutation audit sequence does not match transaction state.', path: ['audit'] });
    }
    transaction.audit.forEach((event, index) => {
        if (event.sequence !== index)
            context.addIssue({ code: 'custom', message: 'Audit sequences must be contiguous.', path: ['audit', index, 'sequence'] });
    });
    if ('failure' in transaction) {
        const match = transaction.audit.filter((event) => event.event === 'failed' &&
            event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode);
        if (match.length !== 1 || match[0]?.event !== 'failed' || match[0].message !== transaction.failure.message) {
            context.addIssue({ code: 'custom', message: 'Failure summary must match its audit event.', path: ['failure', 'message'] });
        }
    }
});
function digest(value) {
    return canonicalSha256(value);
}
function removeAt(values, index) {
    if (index < 0 || index >= values.length)
        return null;
    return [...values.slice(0, index), ...values.slice(index + 1)];
}
function exactSnapshotEntry(value, expected) {
    return value === JSON.stringify(expected);
}
function verifiedDeltaMatches(identity, after) {
    const before = identity.beforeSnapshot;
    if (identity.resourceType === 'process_rgb' || identity.resourceType === 'process_cmyk') {
        if (identity.definition.kind !== 'process' || !exactSnapshotEntry(after.swatches[identity.swatchIndex], {
            name: identity.definition.name,
            color: identity.definition.color,
        }))
            return false;
        return identity.collectionKind === 'swatches' && identity.collectionIndex === identity.swatchIndex &&
            after.swatches.length === before.swatches.length + 1 &&
            digest(removeAt(after.swatches, identity.swatchIndex)) === digest(before.swatches) &&
            digest(after.gradients) === digest(before.gradients) && digest(after.spots) === digest(before.spots);
    }
    if (identity.resourceType === 'spot_rgb') {
        if (identity.definition.kind !== 'spot')
            return false;
        const nativeSpot = {
            name: identity.definition.name,
            colorType: 'ColorModel.SPOT',
            baseColor: identity.definition.color,
        };
        if (!exactSnapshotEntry(after.spots[identity.collectionIndex], nativeSpot) ||
            !exactSnapshotEntry(after.swatches[identity.swatchIndex], {
                name: identity.definition.name,
                color: { model: 'spot', name: nativeSpot.name, tint: 100, colorType: nativeSpot.colorType, baseColor: nativeSpot.baseColor },
            }))
            return false;
        return identity.collectionKind === 'spots' &&
            after.swatches.length === before.swatches.length + 1 && after.spots.length === before.spots.length + 1 &&
            digest(removeAt(after.swatches, identity.swatchIndex)) === digest(before.swatches) &&
            digest(removeAt(after.spots, identity.collectionIndex)) === digest(before.spots) &&
            digest(after.gradients) === digest(before.gradients);
    }
    if (identity.definition.kind !== 'gradient')
        return false;
    const nativeGradient = {
        name: identity.definition.name,
        type: 'GradientType.LINEAR',
        stops: identity.definition.stops,
    };
    if (!exactSnapshotEntry(after.gradients[identity.collectionIndex], nativeGradient) ||
        !exactSnapshotEntry(after.swatches[identity.swatchIndex], {
            name: identity.definition.name,
            color: { model: 'gradient', ...nativeGradient },
        }))
        return false;
    return identity.collectionKind === 'gradients' &&
        after.swatches.length === before.swatches.length + 1 && after.gradients.length === before.gradients.length + 1 &&
        digest(removeAt(after.swatches, identity.swatchIndex)) === digest(before.swatches) &&
        digest(removeAt(after.gradients, identity.collectionIndex)) === digest(before.gradients) &&
        digest(after.spots) === digest(before.spots);
}
const verifiedResultSchema = z.strictObject({
    applied: z.literal(true), document: documentContextSchema, plan: executablePlanSchema,
    resource: hostResourceIdentitySchema.safeExtend({ afterSnapshot: resourceCollectionsSnapshotSchema }),
    transaction: transactionSchema.options[1],
}).superRefine((result, context) => {
    const identity = result.resource;
    if (identity.name !== result.plan.resource.name || identity.definition.kind !== result.plan.resource.kind ||
        digest(identity.definition) !== digest(result.plan.resource) ||
        digest(identity.beforeSnapshot) !== digest(result.plan.beforeSnapshot) ||
        identity.collectionKind !== result.plan.collectionKind ||
        !verifiedDeltaMatches(identity, identity.afterSnapshot)) {
        context.addIssue({ code: 'custom', message: 'Verified resource identity or collection delta does not match the plan.', path: ['resource'] });
    }
});
export const swatchResourceResultSchema = z.union([
    z.strictObject({ applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema.options[0] }),
    z.strictObject({ applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema.options[2] }),
    z.strictObject({ applied: z.literal(false), document: documentContextSchema, plan: executablePlanSchema, transaction: transactionSchema.options[3] }),
    z.strictObject({ applied: z.literal(false), document: documentContextSchema, plan: executablePlanSchema, transaction: transactionSchema.options[4] }),
    verifiedResultSchema,
]).superRefine((result, context) => {
    if (!transactionSchema.safeParse(result.transaction).success) {
        context.addIssue({ code: 'custom', message: 'Resource transaction invariants are invalid.', path: ['transaction'] });
    }
    if (result.transaction.state === 'rolled_back' || result.transaction.state === 'rollback_failed') {
        const identity = result.transaction.rollback.resourceIdentity;
        if (identity.name !== result.plan.resource.name || identity.definition.kind !== result.plan.resource.kind ||
            digest(identity.definition) !== digest(result.plan.resource) ||
            digest(identity.beforeSnapshot) !== digest(result.plan.beforeSnapshot) ||
            identity.collectionKind !== result.plan.collectionKind) {
            context.addIssue({ code: 'custom', message: 'Rollback resource identity does not match the plan.', path: ['transaction', 'rollback', 'resourceIdentity'] });
        }
    }
    if (result.plan.resource.kind === 'spot' &&
        result.plan.hostVersionVerified !== spotHostVersionVerified(result.document.appVersion)) {
        context.addIssue({ code: 'custom', message: 'Spot host-version verification must match the measured application version allowlist.', path: ['plan', 'hostVersionVerified'] });
    }
    if (result.transaction.state === 'rolled_back' &&
        digest(result.transaction.rollback.restoredSnapshot) !== digest(result.transaction.rollback.resourceIdentity.beforeSnapshot)) {
        context.addIssue({ code: 'custom', message: 'Verified rollback must restore the exact complete before snapshot.', path: ['transaction', 'rollback'] });
    }
    if (result.transaction.state === 'rollback_failed' &&
        !verifiedDeltaMatches(result.transaction.rollback.resourceIdentity, result.transaction.rollback.restoredSnapshot)) {
        context.addIssue({ code: 'custom', message: 'Failed rollback must prove the exact captured resource remains present.', path: ['transaction', 'rollback'] });
    }
    const terminalSnapshot = result.applied
        ? result.resource.afterSnapshot
        : result.transaction.state === 'rolled_back' || result.transaction.state === 'rollback_failed'
            ? result.transaction.rollback.restoredSnapshot
            : null;
    if (terminalSnapshot !== null && utf8Size(terminalSnapshot) > RESOURCE_SNAPSHOT_MAX_BYTES) {
        context.addIssue({ code: 'custom', message: 'Terminal resource snapshot exceeds the durable result-size budget.', path: ['transaction'] });
    }
    if (utf8Size(result.document) > RESOURCE_CONTEXT_MAX_BYTES) {
        context.addIssue({ code: 'custom', message: 'Document context exceeds the durable result-size budget.', path: ['document'] });
    }
    if (utf8Size(result) > RESOURCE_DURABLE_RESULT_MAX_BYTES) {
        context.addIssue({ code: 'custom', message: 'Resource result exceeds the durable private-record limit.' });
    }
});
const finalizedAtSchema = z.string().datetime({ offset: true });
export const swatchResourceResponseSchema = z.union([
    z.strictObject({ outcome: swatchResourceResultSchema, delivery: z.strictObject({ mode: z.literal('original'), finalizedAt: finalizedAtSchema }) }),
    z.strictObject({ outcome: verifiedResultSchema, delivery: z.strictObject({ mode: z.literal('replay'), finalizedAt: finalizedAtSchema }) }),
]);
