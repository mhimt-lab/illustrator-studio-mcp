import { z } from 'zod';
import { canonicalSha256 } from '../mutation-canonical.js';
import { documentContextSchema } from '../mutation-result-schema-core.js';
import { SNAPSHOT_SHA256_PATTERN, SnapshotRefUnavailableError } from '../snapshot-ref-cache.js';
import { CREATE_BATCH_BLOCKERS, CREATE_BATCH_OPERATION, createBatchResponseSchema, createBatchTransactionParts, expandCreateBatchRows, } from './create-batch-adapter.js';
const sha256Schema = z.string().regex(SNAPSHOT_SHA256_PATTERN);
const layerViewSchema = z.strictObject({
    path: z.array(z.number().int().nonnegative()),
    name: z.string(),
    visible: z.boolean(),
    locked: z.boolean(),
    ancestry: z.array(z.strictObject({ name: z.string(), visible: z.boolean(), locked: z.boolean() })),
    itemCount: z.number().int().nonnegative(),
    itemUuidsSha256: sha256Schema,
    createdCount: z.number().int().positive(),
});
export const createBatchViewSchema = z.strictObject({
    outcome: z.strictObject({
        operation: z.literal(CREATE_BATCH_OPERATION),
        applied: z.boolean(),
        document: documentContextSchema,
        plan: z.strictObject({
            applyBlockedReasonCodes: z.array(z.enum(CREATE_BATCH_BLOCKERS)),
            applyAllowed: z.boolean(),
            layers: z.array(layerViewSchema),
            stepsOutsideArtboard: z.array(z.number().int().nonnegative()),
        }),
        created: z.array(z.strictObject({ operation: z.string(), uuid: z.string() })).optional(),
        transaction: z.strictObject({
            state: z.enum(['planned', 'verified', 'apply_failed', 'rolled_back', 'rollback_failed', 'apply_indeterminate', 'rollback_indeterminate']),
            failure: createBatchTransactionParts.failure.optional(),
            rollback: createBatchTransactionParts.rollback.optional(),
        }),
    }),
    delivery: createBatchResponseSchema.shape.delivery,
});
function layerView(layer) {
    return {
        path: layer.path,
        name: layer.name,
        visible: layer.visible,
        locked: layer.locked,
        ancestry: layer.ancestry,
        itemCount: layer.itemUuids.length,
        itemUuidsSha256: canonicalSha256(layer.itemUuids),
        createdCount: layer.createdCount,
    };
}
export function createBatchView(value) {
    const response = value;
    const { outcome } = response;
    const { audit: _audit, ...transaction } = outcome.transaction;
    return createBatchViewSchema.parse({
        outcome: {
            operation: outcome.operation,
            applied: outcome.applied,
            document: outcome.document,
            plan: {
                applyBlockedReasonCodes: outcome.plan.applyBlockedReasonCodes,
                applyAllowed: outcome.plan.applyAllowed,
                layers: outcome.plan.layers.map(layerView),
                stepsOutsideArtboard: outcome.plan.steps.flatMap((step, index) => 'withinArtboard' in step && !step.withinArtboard ? [index] : []),
            },
            ...(outcome.applied ? { created: outcome.created.map((created) => ({ operation: created.operation, uuid: created.uuid })) } : {}),
            transaction,
        },
        delivery: response.delivery,
    });
}
export function createBatchNextCallWithRef(nextCall, cache) {
    const { steps: stepsForm, presets, targets, rows, ...rest } = nextCall.arguments;
    const steps = Array.isArray(stepsForm) ? stepsForm
        : Array.isArray(presets) && Array.isArray(targets) && Array.isArray(rows)
            ? expandCreateBatchRows({ presets, targets, rows }) : undefined;
    if (steps === undefined)
        return nextCall;
    const put = cache.put(steps);
    if (!put.held || !cache.has(put.sha256))
        return nextCall;
    return { ...nextCall, arguments: { ...rest, steps_sha256: put.sha256 } };
}
const CREATE_BATCH_RESEND = 'send the planned steps (or presets, targets and rows) with this command_id';
export function expandCreateBatchStepsRef(input, cache) {
    const sha256 = input.steps_sha256;
    if (typeof sha256 !== 'string')
        return input;
    const steps = cache.get(sha256);
    if (!Array.isArray(steps))
        throw new SnapshotRefUnavailableError('steps_sha256', sha256, CREATE_BATCH_RESEND);
    const { steps_sha256: _reference, ...rest } = input;
    return { ...rest, steps };
}
