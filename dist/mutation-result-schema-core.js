import { z } from 'zod';
import { DOCUMENT_KEY_SHORT_PATTERN } from './document-key.js';
export const boundsSchema = z.array(z.number().finite()).length(4)
    .superRefine((bounds, context) => {
    if (bounds[0] <= bounds[2] && bounds[1] >= bounds[3])
        return;
    context.addIssue({
        code: 'custom',
        message: 'Bounds must be [left, top, right, bottom] with left <= right and top >= bottom.',
    });
});
export function toBounds(bounds) {
    return [bounds[0], bounds[1], bounds[2], bounds[3]];
}
export const documentKeyShortSchema = z.string().regex(DOCUMENT_KEY_SHORT_PATTERN)
    .describe('First 16 hex characters of SHA-256 over key; accepted as expected_document_key.');
export const documentMutationProfileSchema = z.enum(['saved_file', 'unsaved_document', 'edit_session_file']);
export const illustratorApplicationEvidenceSchema = z.strictObject({
    bundleId: z.string().min(1).nullable()
        .describe('Configured bundle identifier the bridge addresses; null when ILLUSTRATOR_APPLICATION is a LaunchServices name.'),
    version: z.string().describe('app.version reported by the Illustrator instance that executed this read.'),
    channel: z.enum(['stable', 'beta', 'unknown']),
});
const documentContextShape = {
    keyVersion: z.literal(1),
    key: z.string().min(1),
    keyShort: documentKeyShortSchema,
    name: z.string(),
    path: z.string().nullable(),
    fileRevision: z.string().nullable(),
    saved: z.boolean(),
    colorSpace: z.enum(['RGB', 'CMYK', 'unknown']),
    activeArtboardIndex: z.number().int().nonnegative(),
    activeArtboardBounds: boundsSchema,
    artboardCount: z.number().int().positive(),
    appVersion: z.string(),
    mutationProfile: documentMutationProfileSchema.nullable()
        .describe('saved_file: verified file revision; unsaved_document: no backing file exists; edit_session_file: file of an open edit session; null: blocked.'),
    mutationAllowed: z.boolean(),
    mutationBlockedReason: z.string().nullable(),
};
function refineDocumentContext(context, issues) {
    if (context.mutationAllowed !== (context.mutationProfile !== null)) {
        issues.addIssue({
            code: 'custom',
            message: 'mutationAllowed must be true exactly when a mutation profile is present.',
            path: ['mutationAllowed'],
        });
    }
}
export const documentContextSchema = z.strictObject(documentContextShape).superRefine(refineDocumentContext);
export const documentContextWithApplicationSchema = z.strictObject({
    ...documentContextShape,
    application: illustratorApplicationEvidenceSchema,
}).superRefine(refineDocumentContext);
export const layerPathSchema = z.array(z.number().int().nonnegative()).min(1).max(64);
export const layerStructuralReasonSchema = z.enum([
    'layer_hidden',
    'ancestor_hidden',
    'layer_locked',
    'ancestor_locked',
]);
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
