import { z } from 'zod';
import { mutationAuditSchema } from '../mutation-result-schema-core.js';
export const EMBED_IMAGE_MAX_DIRECT_ITEMS = 128;
export const EMBED_IMAGE_TOLERANCE_PT = 0.01;
export const uuidSchema = z.string().min(1).max(255);
export const documentKeySchema = z.string().min(1).max(16_384);
export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
export const absolutePathSchema = z.string().min(2).max(4_096)
    .regex(/^\/(?!(?:.*\/)?\.\.(?:\/|$))[^\0]*$/u, 'Source path must be an absolute path without NUL or parent-directory segments.');
export const sourceSchema = z.strictObject({ path: absolutePathSchema, sha256: sha256Schema });
export const boundsSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
export const positionSchema = z.tuple([z.number().finite(), z.number().finite()]);
export const matrixSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
export const pixelsSchema = z.strictObject({ width: z.number().int().positive(), height: z.number().int().positive() });
export const colorSpaceAdmissionSchema = z.strictObject({
    status: z.enum(['available', 'unavailable']),
    value: z.enum(['RGB', 'CMYK', 'Gray', 'Lab', 'Indexed', 'unknown']).nullable(),
    message: z.string().max(500).nullable(),
});
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']), reasonCode: z.enum(['apply_failed', 'verify_mismatch']), message: z.string().min(1).max(500),
}).superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed'))
        context.addIssue({ code: 'custom', message: 'Embed failure phase and reason code must match.' });
});
export function embedTransactionSchema(rollbackEvidence) {
    return z.discriminatedUnion('state', [
        z.strictObject({ state: z.literal('planned'), audit: mutationAuditSchema }),
        z.strictObject({ state: z.literal('verified'), audit: mutationAuditSchema }),
        z.strictObject({ state: z.literal('apply_failed'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('not_required') }), audit: mutationAuditSchema }),
        z.strictObject({ state: z.literal('rolled_back'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('verified'), ...rollbackEvidence }), audit: mutationAuditSchema }),
        z.strictObject({ state: z.literal('apply_indeterminate'),
            failure: z.strictObject({ phase: z.literal('apply'), reasonCode: z.literal('apply_indeterminate'), message: z.string().min(1).max(500) }),
            rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('embed_outcome_unknown'), message: z.string().min(1).max(500), ...rollbackEvidence }),
            audit: mutationAuditSchema }),
        z.strictObject({ state: z.literal('rollback_indeterminate'), failure: failureSchema,
            rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('rollback_indeterminate'), message: z.string().min(1).max(500), ...rollbackEvidence }),
            audit: mutationAuditSchema }),
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
            expected = [...prefix, ...failure, 'rollback:started:', transaction.state === 'rolled_back' ? 'rollback:succeeded:' : 'rollback:failed:rollback_indeterminate'];
            if (transaction.state === 'rolled_back' && transaction.failure.phase !== 'apply')
                context.addIssue({ code: 'custom', message: 'Only a refused embed can be rolled back.' });
        }
        const actual = transaction.audit.map((event) => `${event.phase}:${event.event}:${'reasonCode' in event ? event.reasonCode : ''}`);
        if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index]))
            context.addIssue({ code: 'custom', message: 'Embed audit sequence does not match transaction state.' });
        transaction.audit.forEach((event, index) => { if (event.sequence !== index)
            context.addIssue({ code: 'custom', message: 'Embed audit sequence must be contiguous.' }); });
        if ('failure' in transaction) {
            const matches = transaction.audit.filter((event) => event.event === 'failed' && event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode && event.message === transaction.failure.message);
            if (matches.length !== 1)
                context.addIssue({ code: 'custom', message: 'Embed failure must match one audit event.' });
        }
    });
}
