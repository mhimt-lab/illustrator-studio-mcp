import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { canonicalSha256 } from '../mutation-canonical.js';
import { documentContextSchema } from '../mutation-result-schema-core.js';
import { SNAPSHOT_SHA256_PATTERN, SnapshotRefUnavailableError } from '../snapshot-ref-cache.js';
import { MUTATE_BATCH_OPERATION, SNAPSHOT_ECHO_FIELDS, mutateBatchComparedState, mutateBatchResponseSchema, mutateBatchStepRequest, } from './mutate-batch-adapter.js';
const sha256Schema = z.string().regex(SNAPSHOT_SHA256_PATTERN);
export const snapshotChangeSchema = z.union([
    z.strictObject({ path: z.string(), before: z.unknown(), after: z.unknown() }),
    z.strictObject({ path: z.string(), beforeLength: z.number().int().nonnegative(), afterLength: z.number().int().nonnegative() }),
]);
const stepViewSchema = z.strictObject({
    operation: z.string(),
    targetUuid: z.string(),
    request: z.record(z.string(), z.unknown()),
    applyBlockedReasonCodes: z.array(z.string()),
    contents: z.string().optional(),
    beforeSha256: sha256Schema,
    afterSha256: sha256Schema,
    changes: z.array(snapshotChangeSchema),
    postconditionSha256: sha256Schema.optional(),
    observed: z.array(snapshotChangeSchema).optional(),
});
const rollbackStepViewSchema = z.strictObject({
    operation: z.string(),
    targetUuid: z.string(),
    outcome: z.enum(['not_written', 'restored', 'outstanding', 'indeterminate']),
    restoredSha256: sha256Schema.nullable(),
    outstandingChanges: z.array(snapshotChangeSchema).nullable(),
});
const transactionViewSchema = z.strictObject({
    state: z.enum(['planned', 'verified', 'apply_failed', 'rolled_back', 'rollback_failed', 'apply_indeterminate', 'rollback_indeterminate']),
    audit: z.array(z.record(z.string(), z.unknown())),
    failure: z.record(z.string(), z.unknown()).optional(),
    rollback: z.strictObject({
        status: z.string(), reasonCode: z.string().optional(), message: z.string().optional(),
        attemptedCount: z.number().int().nonnegative().optional(), steps: z.array(rollbackStepViewSchema).optional(),
    }).optional(),
});
export const mutateBatchViewSchema = z.strictObject({
    outcome: z.strictObject({
        operation: z.literal(MUTATE_BATCH_OPERATION),
        applied: z.boolean(),
        document: documentContextSchema,
        plan: z.strictObject({
            operation: z.literal(MUTATE_BATCH_OPERATION),
            documentKey: z.string(),
            steps: z.array(stepViewSchema),
            applyBlockedReasonCodes: z.array(z.string()),
            confirmationStatus: z.enum(['required', 'confirmed']),
            applyAllowed: z.boolean(),
        }),
        transaction: transactionViewSchema,
    }),
    delivery: mutateBatchResponseSchema.shape.delivery,
});
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
function collectDifferences(before, after, path, out) {
    if (isPlainObject(before) && isPlainObject(after)) {
        const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
        for (const key of keys)
            collectDifferences(before[key] ?? null, after[key] ?? null, [...path, key], out);
        return;
    }
    if (Array.isArray(before) && Array.isArray(after)) {
        if (before.length !== after.length) {
            out.push({ path, beforeLength: before.length, afterLength: after.length });
            return;
        }
        before.forEach((item, index) => collectDifferences(item, after[index], [...path, index], out));
        return;
    }
    if (!isDeepStrictEqual(before, after))
        out.push({ path, before, after });
}
function formatPath(path, ranges) {
    let text = '';
    let rangeUsed = false;
    for (const segment of path) {
        if (typeof segment === 'number') {
            text += ranges !== undefined && !rangeUsed ? `[${ranges}]` : `[${segment}]`;
            rangeUsed ||= ranges !== undefined;
        }
        else
            text += text === '' ? segment : `.${segment}`;
    }
    return text;
}
function indexRanges(indices) {
    const ranges = [];
    for (const index of indices) {
        const last = ranges.at(-1);
        if (last !== undefined && last[1] === index - 1)
            last[1] = index;
        else
            ranges.push([index, index]);
    }
    return ranges.map(([first, last]) => first === last ? `${first}` : `${first}-${last}`).join(',');
}
export function snapshotChanges(before, after) {
    const differences = [];
    collectDifferences(before, after, [], differences);
    const groups = new Map();
    for (const difference of differences) {
        const position = difference.path.findIndex((segment) => typeof segment === 'number');
        const shape = position < 0 ? difference.path : [...difference.path.slice(0, position), '#', ...difference.path.slice(position + 1)];
        const values = 'beforeLength' in difference ? [difference.beforeLength, difference.afterLength] : [difference.before, difference.after];
        const key = JSON.stringify([shape, 'beforeLength' in difference, values]);
        const group = groups.get(key);
        if (group === undefined)
            groups.set(key, { difference, indices: position < 0 ? [] : [difference.path[position]] });
        else
            group.indices.push(difference.path[position]);
    }
    return [...groups.values()].map(({ difference, indices }) => {
        const path = formatPath(difference.path, indices.length === 0 ? undefined : indexRanges(indices));
        return 'beforeLength' in difference
            ? { path, beforeLength: difference.beforeLength, afterLength: difference.afterLength }
            : { path, before: difference.before, after: difference.after };
    });
}
const snapshotSha256 = (value) => canonicalSha256(value);
function stepView(step) {
    const { before, after } = step.plan;
    const contents = isPlainObject(before) && typeof before.contents === 'string' && isPlainObject(after) && after.contents === before.contents
        ? before.contents : undefined;
    return {
        operation: step.operation,
        targetUuid: step.targetUuid,
        request: mutateBatchStepRequest(step),
        applyBlockedReasonCodes: 'applyBlockedReasonCodes' in step.plan ? [...step.plan.applyBlockedReasonCodes] : [],
        ...(contents === undefined ? {} : { contents }),
        beforeSha256: snapshotSha256(before),
        afterSha256: snapshotSha256(after),
        changes: snapshotChanges(before, after),
    };
}
export function mutateBatchView(value) {
    const response = value;
    const { outcome } = response;
    const steps = outcome.plan.steps;
    const views = steps.map(stepView);
    if (outcome.applied) {
        outcome.postcondition.forEach((postcondition, index) => {
            views[index].postconditionSha256 = snapshotSha256(postcondition);
            views[index].observed = snapshotChanges(mutateBatchComparedState(steps, index, true), postcondition);
        });
    }
    const { transaction } = outcome;
    const transactionView = { state: transaction.state, audit: transaction.audit };
    if ('failure' in transaction)
        transactionView.failure = transaction.failure;
    if ('rollback' in transaction) {
        const { rollback } = transaction;
        transactionView.rollback = 'steps' in rollback ? {
            ...rollback,
            steps: rollback.steps.map((step, index) => ({
                operation: step.operation,
                targetUuid: step.targetUuid,
                outcome: step.outcome,
                restoredSha256: step.restoredSnapshot === null ? null : snapshotSha256(step.restoredSnapshot),
                outstandingChanges: step.observedSnapshot === null ? null
                    : snapshotChanges(mutateBatchComparedState(steps, index, false), step.observedSnapshot),
            })),
        } : { ...rollback };
    }
    return mutateBatchViewSchema.parse({
        outcome: {
            operation: outcome.operation,
            applied: outcome.applied,
            document: outcome.document,
            plan: {
                operation: outcome.plan.operation,
                documentKey: outcome.plan.documentKey,
                steps: views,
                applyBlockedReasonCodes: outcome.plan.applyBlockedReasonCodes,
                confirmationStatus: outcome.plan.confirmationStatus,
                applyAllowed: outcome.plan.applyAllowed,
            },
            transaction: transactionView,
        },
        delivery: response.delivery,
    });
}
export function mutateBatchNextCallWithRefs(nextCall, cache) {
    const steps = nextCall.arguments.steps;
    if (!Array.isArray(steps))
        return nextCall;
    const references = steps.map((step) => SNAPSHOT_ECHO_FIELDS.map(([full]) => step[full] === undefined ? null : cache.put(step[full])));
    return {
        ...nextCall,
        arguments: {
            ...nextCall.arguments,
            steps: steps.map((step, index) => {
                const echoed = { ...step };
                SNAPSHOT_ECHO_FIELDS.forEach(([full, reference], field) => {
                    const put = references[index][field];
                    if (put === null || !put.held || !cache.has(put.sha256))
                        return;
                    echoed[reference] = put.sha256;
                    delete echoed[full];
                });
                return echoed;
            }),
        },
    };
}
export function expandMutateBatchSnapshotRefs(input, cache) {
    const steps = input.steps;
    if (!Array.isArray(steps))
        return input;
    let expanded = false;
    const next = steps.map((step, index) => {
        if (!isPlainObject(step))
            return step;
        const result = { ...step };
        for (const [full, reference] of SNAPSHOT_ECHO_FIELDS) {
            const sha256 = result[reference];
            if (typeof sha256 !== 'string')
                continue;
            const value = cache.get(sha256);
            if (value === undefined)
                throw new SnapshotRefUnavailableError(`steps[${index}].${reference}`, sha256);
            result[full] = value;
            delete result[reference];
            expanded = true;
        }
        return result;
    });
    return expanded ? { ...input, steps: next } : input;
}
