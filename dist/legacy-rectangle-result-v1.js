import { z } from 'zod';
const RECTANGLE_BOUNDS_TOLERANCE_PT = 0.01;
const RECTANGLE_BOUNDS_PRECISION_DIGITS = 12;
export const boundsSchema = z.array(z.number().finite()).length(4)
    .refine((bounds) => bounds[0] <= bounds[2] && bounds[1] >= bounds[3], {
    message: 'Bounds must be [left, top, right, bottom] with left <= right and top >= bottom.',
});
export function toBounds(bounds) {
    return [bounds[0], bounds[1], bounds[2], bounds[3]];
}
export function normalizeRectangleDistance(value) {
    return Number(value.toFixed(RECTANGLE_BOUNDS_PRECISION_DIGITS));
}
export function rectangleBoundMatches(actual, planned) {
    return normalizeRectangleDistance(Math.abs(actual - planned)) <= RECTANGLE_BOUNDS_TOLERANCE_PT;
}
export function rectangleWithinArtboard(bounds, artboardBounds) {
    const outsideDistances = [
        Math.max(0, artboardBounds[0] - bounds[0]),
        Math.max(0, bounds[1] - artboardBounds[1]),
        Math.max(0, bounds[2] - artboardBounds[2]),
        Math.max(0, artboardBounds[3] - bounds[3]),
    ];
    return outsideDistances.every((distance) => normalizeRectangleDistance(distance) <= RECTANGLE_BOUNDS_TOLERANCE_PT);
}
export const documentContextSchema = z.strictObject({
    keyVersion: z.literal(1),
    key: z.string().min(1),
    name: z.string(),
    path: z.string().nullable(),
    fileRevision: z.string().nullable(),
    saved: z.boolean(),
    colorSpace: z.enum(['RGB', 'CMYK', 'unknown']),
    activeArtboardIndex: z.number().int().nonnegative(),
    activeArtboardBounds: boundsSchema,
    artboardCount: z.number().int().positive(),
    appVersion: z.string(),
    mutationAllowed: z.boolean(),
    mutationBlockedReason: z.string().nullable(),
});
export const layerPathSchema = z.array(z.number().int().nonnegative()).min(1).max(64);
export const layerStructuralReasonSchema = z.enum([
    'layer_hidden',
    'ancestor_hidden',
    'layer_locked',
    'ancestor_locked',
]);
const rectanglePlanSchema = z.strictObject({
    operation: z.literal('create_rectangle'),
    coordinateSpace: z.literal('artboard_top_left'),
    unit: z.literal('pt'),
    artboardIndex: z.number().int().nonnegative(),
    artboardBounds: boundsSchema,
    targetBounds: boundsSchema,
    withinArtboard: z.boolean(),
    targetLayer: z.strictObject({
        path: layerPathSchema,
        name: z.string(),
        visible: z.boolean(),
        locked: z.boolean(),
        effectiveVisible: z.boolean(),
        effectiveLocked: z.boolean(),
        templateState: z.literal('unknown'),
    }),
    layerSafetyReasonCodes: z.array(layerStructuralReasonSchema),
    templateRisk: z.strictObject({
        reasonCode: z.literal('template_state_unknown'),
        confirmationStatus: z.enum(['required', 'confirmed', 'mismatch']),
    }),
    applyAllowed: z.boolean(),
    applyBlockedReasonCodes: z.array(z.enum([
        'layer_hidden',
        'ancestor_hidden',
        'layer_locked',
        'ancestor_locked',
        'document_mutation_not_allowed',
        'template_state_confirmation_required',
        'template_state_confirmation_mismatch',
    ])),
}).superRefine((plan, context) => {
    if (plan.applyAllowed !== (plan.applyBlockedReasonCodes.length === 0)) {
        context.addIssue({
            code: 'custom',
            message: 'applyAllowed must exactly reflect whether applyBlockedReasonCodes is empty.',
            path: ['applyAllowed'],
        });
    }
    const reasonSet = new Set(plan.layerSafetyReasonCodes);
    const orderedReasons = ['layer_hidden', 'ancestor_hidden', 'layer_locked', 'ancestor_locked'];
    const orderIsValid = plan.layerSafetyReasonCodes.every((reason, index) => index === 0 || orderedReasons.indexOf(plan.layerSafetyReasonCodes[index - 1]) < orderedReasons.indexOf(reason));
    const layerStateIsValid = reasonSet.has('layer_hidden') === !plan.targetLayer.visible &&
        reasonSet.has('layer_locked') === plan.targetLayer.locked &&
        (!plan.targetLayer.visible || reasonSet.has('ancestor_hidden') === !plan.targetLayer.effectiveVisible) &&
        (!plan.targetLayer.locked || plan.targetLayer.effectiveLocked) &&
        (plan.targetLayer.locked || reasonSet.has('ancestor_locked') === plan.targetLayer.effectiveLocked) &&
        (!plan.targetLayer.effectiveVisible || (plan.targetLayer.visible && !reasonSet.has('ancestor_hidden')));
    const blockedLayerReasons = plan.applyBlockedReasonCodes.filter((reason) => orderedReasons.includes(reason));
    const blockersMatch = blockedLayerReasons.length === plan.layerSafetyReasonCodes.length &&
        blockedLayerReasons.every((reason, index) => reason === plan.layerSafetyReasonCodes[index]);
    if (!orderIsValid || !layerStateIsValid || !blockersMatch) {
        context.addIssue({
            code: 'custom',
            message: 'Layer safety reasons must match target/effective state and apply blockers in production order.',
            path: ['layerSafetyReasonCodes'],
        });
    }
    const templateReason = plan.templateRisk.confirmationStatus === 'confirmed'
        ? null
        : `template_state_confirmation_${plan.templateRisk.confirmationStatus}`;
    const templateReasons = plan.applyBlockedReasonCodes.filter((reason) => reason.startsWith('template_state_'));
    if ((templateReason === null && templateReasons.length !== 0) ||
        (templateReason !== null && (templateReasons.length !== 1 || templateReasons[0] !== templateReason))) {
        context.addIssue({
            code: 'custom',
            message: 'Template confirmation status must match its apply blocker.',
            path: ['templateRisk', 'confirmationStatus'],
        });
    }
    if (plan.withinArtboard !== rectangleWithinArtboard(plan.targetBounds, plan.artboardBounds)) {
        context.addIssue({
            code: 'custom',
            message: 'withinArtboard must be derived from targetBounds and artboardBounds.',
            path: ['withinArtboard'],
        });
    }
});
const rectangleExecutablePlanSchema = z.strictObject({
    ...rectanglePlanSchema.shape,
    templateRisk: z.strictObject({
        reasonCode: z.literal('template_state_unknown'),
        confirmationStatus: z.literal('confirmed'),
    }),
    applyAllowed: z.literal(true),
    applyBlockedReasonCodes: z.array(z.never()).length(0),
}).superRefine((plan, context) => {
    if (!rectanglePlanSchema.safeParse(plan).success) {
        context.addIssue({ code: 'custom', message: 'Executable rectangle plan invariants are invalid.' });
    }
});
const rectangleItemSchema = z.strictObject({
    uuid: z.string().min(1).max(255),
    type: z.literal('PathItem'),
    name: z.string().max(255),
    bounds: boundsSchema,
});
export const mutationPhaseSchema = z.enum(['preflight', 'plan', 'apply', 'verify', 'rollback']);
const mutationAuditEventSchema = z.discriminatedUnion('event', [
    z.strictObject({
        sequence: z.number().int().nonnegative().max(31),
        phase: z.literal('apply'),
        event: z.literal('attempted'),
    }),
    z.strictObject({
        sequence: z.number().int().nonnegative().max(31),
        phase: mutationPhaseSchema,
        event: z.literal('started'),
    }),
    z.strictObject({
        sequence: z.number().int().nonnegative().max(31),
        phase: mutationPhaseSchema,
        event: z.literal('succeeded'),
    }),
    z.strictObject({
        sequence: z.number().int().nonnegative().max(31),
        phase: mutationPhaseSchema,
        event: z.literal('failed'),
        reasonCode: z.enum([
            'preflight_failed',
            'plan_failed',
            'apply_failed',
            'apply_indeterminate',
            'verify_mismatch',
            'rollback_failed',
            'rollback_indeterminate',
        ]),
        message: z.string().min(1).max(500),
    }),
    z.strictObject({
        sequence: z.number().int().nonnegative().max(31),
        phase: mutationPhaseSchema,
        event: z.literal('skipped'),
        reasonCode: z.enum(['not_requested', 'not_required']),
    }),
]);
export const mutationAuditSchema = z.array(mutationAuditEventSchema).min(1).max(32);
function mutationAuditSignature(event) {
    return `${event.phase}:${event.event}:${'reasonCode' in event ? event.reasonCode : ''}`;
}
const mutationAuditPrefix = [
    'preflight:started:',
    'preflight:succeeded:',
    'plan:started:',
    'plan:succeeded:',
];
const mutationAuditFlows = [
    ['preflight:started:', 'preflight:failed:preflight_failed'],
    [...mutationAuditPrefix.slice(0, 3), 'plan:failed:plan_failed'],
    [...mutationAuditPrefix, 'apply:skipped:not_requested', 'verify:skipped:not_requested', 'rollback:skipped:not_requested'],
    [...mutationAuditPrefix, 'apply:started:', 'apply:attempted:', 'apply:succeeded:', 'verify:started:', 'verify:succeeded:', 'rollback:skipped:not_required'],
    [...mutationAuditPrefix, 'apply:started:', 'apply:failed:apply_failed', 'verify:skipped:not_required', 'rollback:skipped:not_required'],
    [...mutationAuditPrefix, 'apply:started:', 'apply:failed:apply_indeterminate'],
    [...mutationAuditPrefix, 'apply:started:', 'apply:attempted:', 'apply:failed:apply_indeterminate'],
    ...(['rollback:succeeded:', 'rollback:failed:rollback_failed', 'rollback:failed:rollback_indeterminate'].map((rollback) => [
        ...mutationAuditPrefix,
        'apply:started:',
        'apply:attempted:',
        'apply:failed:apply_failed',
        'verify:skipped:not_required',
        'rollback:started:',
        rollback,
    ])),
    ...(['rollback:succeeded:', 'rollback:failed:rollback_failed', 'rollback:failed:rollback_indeterminate'].map((rollback) => [
        ...mutationAuditPrefix,
        'apply:started:',
        'apply:attempted:',
        'apply:succeeded:',
        'verify:started:',
        'verify:failed:verify_mismatch',
        'rollback:started:',
        rollback,
    ])),
];
export function isMutationAuditPrefix(events) {
    const signatures = events.map(mutationAuditSignature);
    return mutationAuditFlows.some((flow) => signatures.length <= flow.length && signatures.every((signature, index) => signature === flow[index]));
}
const applyFailureSchema = z.strictObject({
    phase: z.literal('apply'),
    reasonCode: z.literal('apply_failed'),
    message: z.string().min(1).max(500),
});
const applyIndeterminateFailureSchema = z.strictObject({
    phase: z.literal('apply'),
    reasonCode: z.literal('apply_indeterminate'),
    message: z.string().min(1).max(500),
});
const verifyFailureSchema = z.strictObject({
    phase: z.literal('verify'),
    reasonCode: z.literal('verify_mismatch'),
    message: z.string().min(1).max(500),
});
const mutationFailureSchema = z.discriminatedUnion('phase', [applyFailureSchema, verifyFailureSchema]);
const mutationTransactionSchema = z.discriminatedUnion('state', [
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
        failure: mutationFailureSchema,
        rollback: z.strictObject({ status: z.literal('verified'), itemUuid: z.string().min(1).max(255) }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rollback_failed'),
        failure: mutationFailureSchema,
        rollback: z.strictObject({
            status: z.literal('failed'),
            itemUuid: z.string().min(1).max(255),
            reasonCode: z.literal('rollback_failed'),
            message: z.string().min(1).max(500),
        }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('apply_indeterminate'),
        failure: applyIndeterminateFailureSchema,
        rollback: z.strictObject({
            status: z.literal('indeterminate'),
            itemUuid: z.null(),
            reasonCode: z.literal('identity_unavailable'),
            message: z.string().min(1).max(500),
        }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rollback_indeterminate'),
        failure: mutationFailureSchema,
        rollback: z.strictObject({
            status: z.literal('indeterminate'),
            itemUuid: z.string().min(1).max(255).nullable(),
            reasonCode: z.literal('rollback_indeterminate'),
            message: z.string().min(1).max(500),
        }),
        audit: mutationAuditSchema,
    }),
]).superRefine((transaction, context) => {
    const compact = transaction.audit.map((event) => [
        event.phase,
        event.event,
        'reasonCode' in event ? event.reasonCode : null,
    ]);
    const expectedPrefix = [
        ['preflight', 'started', null],
        ['preflight', 'succeeded', null],
        ['plan', 'started', null],
        ['plan', 'succeeded', null],
    ];
    let expected;
    if (transaction.state === 'planned') {
        expected = [
            ...expectedPrefix,
            ['apply', 'skipped', 'not_requested'],
            ['verify', 'skipped', 'not_requested'],
            ['rollback', 'skipped', 'not_requested'],
        ];
    }
    else if (transaction.state === 'verified') {
        expected = [
            ...expectedPrefix,
            ['apply', 'started', null],
            ['apply', 'attempted', null],
            ['apply', 'succeeded', null],
            ['verify', 'started', null],
            ['verify', 'succeeded', null],
            ['rollback', 'skipped', 'not_required'],
        ];
    }
    else if (transaction.state === 'apply_failed') {
        expected = [
            ...expectedPrefix,
            ['apply', 'started', null],
            ['apply', 'failed', 'apply_failed'],
            ['verify', 'skipped', 'not_required'],
            ['rollback', 'skipped', 'not_required'],
        ];
    }
    else if (transaction.state === 'apply_indeterminate') {
        expected = [
            ...expectedPrefix,
            ['apply', 'started', null],
            ['apply', 'attempted', null],
            ['apply', 'failed', 'apply_indeterminate'],
        ];
    }
    else {
        const failureEvents = transaction.failure.phase === 'apply'
            ? [
                ['apply', 'started', null],
                ['apply', 'attempted', null],
                ['apply', 'failed', 'apply_failed'],
                ['verify', 'skipped', 'not_required'],
            ]
            : [
                ['apply', 'started', null],
                ['apply', 'attempted', null],
                ['apply', 'succeeded', null],
                ['verify', 'started', null],
                ['verify', 'failed', 'verify_mismatch'],
            ];
        const rollbackResult = transaction.state === 'rolled_back'
            ? ['rollback', 'succeeded', null]
            : ['rollback', 'failed', transaction.state === 'rollback_failed'
                    ? 'rollback_failed'
                    : 'rollback_indeterminate'];
        expected = [...expectedPrefix, ...failureEvents, ['rollback', 'started', null], rollbackResult];
    }
    if (compact.length !== expected.length || compact.some((entry, index) => entry[0] !== expected[index]?.[0] || entry[1] !== expected[index]?.[1] || entry[2] !== expected[index]?.[2])) {
        context.addIssue({ code: 'custom', message: 'Mutation audit sequence does not match transaction state.', path: ['audit'] });
    }
    for (let index = 0; index < transaction.audit.length; index++) {
        if (transaction.audit[index]?.sequence !== index) {
            context.addIssue({ code: 'custom', message: 'Mutation audit sequence numbers must be contiguous.', path: ['audit', index, 'sequence'] });
        }
    }
    if ('failure' in transaction) {
        const matchingFailureEvents = transaction.audit.filter((event) => event.event === 'failed' &&
            event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode);
        const matchingFailure = matchingFailureEvents[0];
        if (matchingFailureEvents.length !== 1 || matchingFailure?.event !== 'failed' ||
            matchingFailure.message !== transaction.failure.message) {
            context.addIssue({
                code: 'custom',
                message: 'Transaction failure summary must exactly match its audit failure event.',
                path: ['failure', 'message'],
            });
        }
    }
    if (transaction.state === 'rollback_failed' || transaction.state === 'rollback_indeterminate') {
        const matchingRollbackEvents = transaction.audit.filter((event) => event.event === 'failed' &&
            event.phase === 'rollback' && event.reasonCode === transaction.rollback.reasonCode);
        const matchingRollback = matchingRollbackEvents[0];
        if (matchingRollbackEvents.length !== 1 || matchingRollback?.event !== 'failed' ||
            matchingRollback.message !== transaction.rollback.message) {
            context.addIssue({
                code: 'custom',
                message: 'Rollback summary must exactly match its audit failure event.',
                path: ['rollback', 'message'],
            });
        }
    }
    if (transaction.state === 'apply_indeterminate' && transaction.rollback.message !== transaction.failure.message) {
        context.addIssue({
            code: 'custom',
            message: 'Indeterminate apply summaries must describe the same identity-unavailable outcome.',
            path: ['rollback', 'message'],
        });
    }
});
const verifiedRectangleResultSchema = z.strictObject({
    applied: z.literal(true),
    document: documentContextSchema,
    plan: rectangleExecutablePlanSchema,
    item: rectangleItemSchema,
    transaction: mutationTransactionSchema.options[1],
});
export const rectangleResultSchema = z.union([
    z.strictObject({
        applied: z.literal(false),
        document: documentContextSchema,
        plan: rectanglePlanSchema,
        transaction: mutationTransactionSchema.options[0],
    }),
    z.strictObject({
        applied: z.literal(false),
        document: documentContextSchema,
        plan: rectangleExecutablePlanSchema,
        transaction: mutationTransactionSchema.options[2],
    }),
    z.strictObject({
        applied: z.literal(false),
        document: documentContextSchema,
        plan: rectangleExecutablePlanSchema,
        transaction: mutationTransactionSchema.options[3],
    }),
    z.strictObject({
        applied: z.literal(false),
        document: documentContextSchema,
        plan: rectangleExecutablePlanSchema,
        transaction: mutationTransactionSchema.options[4],
    }),
    verifiedRectangleResultSchema,
]).superRefine((result, context) => {
    if (!mutationTransactionSchema.safeParse(result.transaction).success) {
        context.addIssue({
            code: 'custom',
            message: 'Mutation transaction semantic invariants are invalid.',
            path: ['transaction'],
        });
    }
    if (result.applied) {
        for (let index = 0; index < 4; index++) {
            if (!rectangleBoundMatches(result.item.bounds[index], result.plan.targetBounds[index])) {
                context.addIssue({
                    code: 'custom',
                    message: 'Verified rectangle bounds must match the planned target bounds within 0.01pt.',
                    path: ['item', 'bounds', index],
                });
            }
        }
        if (result.plan.withinArtboard !== rectangleWithinArtboard(result.item.bounds, result.plan.artboardBounds)) {
            context.addIssue({
                code: 'custom',
                message: 'Verified withinArtboard must be derived from item and artboard bounds.',
                path: ['plan', 'withinArtboard'],
            });
        }
    }
});
const finalizedAtSchema = z.string().datetime({ offset: true });
export const rectangleResponseSchema = z.union([
    z.strictObject({
        outcome: rectangleResultSchema,
        delivery: z.strictObject({ mode: z.literal('original'), finalizedAt: finalizedAtSchema }),
    }),
    z.strictObject({
        outcome: verifiedRectangleResultSchema,
        delivery: z.strictObject({ mode: z.literal('replay'), finalizedAt: finalizedAtSchema }),
    }),
]).superRefine((response, context) => {
    if (!rectangleResultSchema.safeParse(response.outcome).success) {
        context.addIssue({
            code: 'custom',
            message: 'Rectangle outcome semantic invariants are invalid.',
            path: ['outcome'],
        });
    }
});
