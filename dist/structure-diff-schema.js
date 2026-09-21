import { z } from 'zod';
import { boundsSchema, documentContextSchema } from './mutation-result-schema-core.js';
import { availableFillSchema, availableStrokeSchema, objectLayerSchema, opacitySchema, unavailableMessageSchema, } from './object-appearance-schema.js';
import { STRUCTURE_DIFF_MAX_TOLERANCE_PT, STRUCTURE_SNAPSHOT_LIMITS } from './structure-diff.js';
export const structureSnapshotIdSchema = z.string().regex(/^ss_[0-9a-f]{32}$/);
export const structureDiffIdSchema = z.string().regex(/^sd_[0-9a-f]{32}$/);
const availability = (valueSchema, reasonSchema) => z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('available'), value: valueSchema }),
    z.strictObject({ status: z.literal('unavailable'), reason: reasonSchema, message: unavailableMessageSchema }),
]);
const retentionSchema = z.strictObject({
    scope: z.literal('process_memory'),
    maxSnapshots: z.literal(STRUCTURE_SNAPSHOT_LIMITS.storedSnapshots),
    maxDiffs: z.literal(STRUCTURE_SNAPSHOT_LIMITS.storedDiffs),
}).meta({ id: 'StructureRetention' });
const structureBoundsSchema = boundsSchema.meta({ id: 'StructureBounds' });
const structureLayerSchema = objectLayerSchema.meta({ id: 'StructureLayer' });
const structureDocumentSchema = documentContextSchema.meta({ id: 'StructureDocument' });
export const structureSnapshotSummarySchema = z.strictObject({
    snapshotId: structureSnapshotIdSchema,
    document: structureDocumentSchema,
    capturedAt: z.string().min(1),
    itemCount: z.number().int().min(0).max(STRUCTURE_SNAPSHOT_LIMITS.pageItems),
    artboardCount: z.number().int().min(0).max(STRUCTURE_SNAPSHOT_LIMITS.artboards),
    unavailableAttributeCount: z.number().int().nonnegative(),
    snapshotDigest: z.string().regex(/^[0-9a-f]{64}$/),
    complete: z.literal(true),
    retention: retentionSchema,
});
const artboardSchema = z.strictObject({
    index: z.number().int().nonnegative(),
    name: z.string(),
    bounds: structureBoundsSchema,
}).meta({ id: 'StructureArtboard' });
const parentSchema = availability(z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('layer') }),
    z.strictObject({ kind: z.literal('page_item'), uuid: z.string().min(1), type: z.string().min(1) }),
]), z.literal('parent_unavailable')).meta({ id: 'StructureParent' });
const lockedSchema = availability(z.boolean(), z.literal('lock_state_unavailable')).meta({ id: 'StructureLocked' });
const hiddenSchema = availability(z.boolean(), z.literal('hidden_state_unavailable')).meta({ id: 'StructureHidden' });
const structureOpacitySchema = opacitySchema.meta({ id: 'StructureOpacity' });
const textSchema = availability(z.strictObject({
    text: z.string().max(STRUCTURE_SNAPSHOT_LIMITS.textCharacters),
    totalCharacters: z.number().int().nonnegative(),
    truncated: z.boolean(),
}), z.literal('text_unavailable')).meta({ id: 'StructureText' }).nullable();
const notApplicablePaintSchema = z.strictObject({
    status: z.literal('not_applicable'),
    reason: z.enum(['paint_disabled', 'unsupported_object_type']),
});
const fillSchema = z.discriminatedUnion('status', [...availableFillSchema.options, notApplicablePaintSchema]).meta({ id: 'StructureFill' });
const strokeSchema = z.discriminatedUnion('status', [...availableStrokeSchema.options, notApplicablePaintSchema]).meta({ id: 'StructureStroke' });
const changeStatusShape = {
    status: z.enum(['changed', 'indeterminate']),
    reason: z.enum(['attribute_unavailable', 'text_truncated']).optional(),
};
const change = (category, field, valueSchema) => z.strictObject({
    category: z.literal(category),
    field: z.literal(field),
    ...changeStatusShape,
    before: valueSchema,
    after: valueSchema,
});
export const structureDiffChangeSchema = z.union([
    z.strictObject({
        category: z.literal('bounds'),
        field: z.literal('position'),
        ...changeStatusShape,
        before: structureBoundsSchema,
        after: structureBoundsSchema,
        delta: z.strictObject({ dx: z.number().finite(), dy: z.number().finite() }),
    }),
    change('bounds', 'bounds', structureBoundsSchema),
    change('bounds', 'visibleBounds', structureBoundsSchema),
    change('style', 'opacity', structureOpacitySchema),
    change('style', 'fill', fillSchema),
    change('style', 'stroke', strokeSchema),
    change('text', 'text', textSchema),
    change('hierarchy', 'layer', structureLayerSchema),
    change('hierarchy', 'parent', parentSchema),
    change('hierarchy', 'order', z.strictObject({ documentIndex: z.number().int().nonnegative() })),
    change('attributes', 'name', z.string()),
    change('attributes', 'type', z.string().min(1)),
    change('attributes', 'locked', lockedSchema),
    change('attributes', 'hidden', hiddenSchema),
]).superRefine((value, context) => {
    if (value.status === 'indeterminate' && value.reason === undefined) {
        context.addIssue({ code: 'custom', message: 'An indeterminate change must carry a reason.', path: ['reason'] });
    }
    if (value.status === 'changed' && value.reason !== undefined) {
        context.addIssue({ code: 'custom', message: 'A changed entry must not carry a reason.', path: ['reason'] });
    }
}).meta({ id: 'StructureDiffChange' });
const itemReferenceSchema = z.strictObject({
    type: z.string().min(1),
    name: z.string(),
    layer: structureLayerSchema,
    bounds: structureBoundsSchema,
}).meta({ id: 'StructureItemReference' });
export const structureDiffEntrySchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('added'), uuid: z.string().min(1), item: itemReferenceSchema }),
    z.strictObject({ kind: z.literal('removed'), uuid: z.string().min(1), item: itemReferenceSchema }),
    z.strictObject({
        kind: z.enum(['moved', 'changed', 'indeterminate']),
        uuid: z.string().min(1),
        type: z.string().min(1),
        name: z.string(),
        changes: z.array(structureDiffChangeSchema).min(1).max(16),
    }),
]).meta({ id: 'StructureDiffEntry' });
export const structureDocumentChangeSchema = z.discriminatedUnion('scope', [
    z.strictObject({
        scope: z.literal('document'),
        field: z.enum(['name', 'path', 'colorSpace']),
        status: z.literal('changed'),
        before: z.string().nullable(),
        after: z.string().nullable(),
    }),
    z.strictObject({
        scope: z.literal('artboard'),
        index: z.number().int().nonnegative(),
        status: z.enum(['added', 'removed', 'changed']),
        before: artboardSchema.nullable(),
        after: artboardSchema.nullable(),
    }),
]).meta({ id: 'StructureDocumentChange' });
const countSchema = z.number().int().nonnegative();
export const structureDiffSummarySchema = z.strictObject({
    baseItemCount: countSchema,
    targetItemCount: countSchema,
    comparedItemCount: countSchema,
    added: countSchema,
    removed: countSchema,
    moved: countSchema,
    changed: countSchema,
    indeterminate: countSchema,
    partiallyIndeterminate: countSchema,
    unchanged: countSchema,
    entryCount: countSchema,
    documentChangeCount: countSchema,
    byCategory: z.strictObject({
        bounds: countSchema,
        style: countSchema,
        text: countSchema,
        hierarchy: countSchema,
        attributes: countSchema,
    }),
}).meta({ id: 'StructureDiffSummary' });
const snapshotReferenceShape = {
    snapshotId: structureSnapshotIdSchema,
    documentKey: z.string().min(1),
    capturedAt: z.string().min(1),
};
const diffPageShape = {
    diffId: structureDiffIdSchema,
    computedAt: z.string().min(1),
    document: structureDocumentSchema,
    tolerancePt: z.number().finite().min(0).max(STRUCTURE_DIFF_MAX_TOLERANCE_PT),
    base: z.strictObject(snapshotReferenceShape),
    target: z.strictObject({ ...snapshotReferenceShape, mode: z.enum(['live', 'snapshot']) }),
    scope: z.discriminatedUnion('mode', [
        z.strictObject({ mode: z.literal('document') }),
        z.strictObject({
            mode: z.literal('objects'),
            uuids: z.array(z.string().min(1)).min(1).max(STRUCTURE_SNAPSHOT_LIMITS.scopeUuids),
        }),
    ]),
    summary: structureDiffSummarySchema,
    documentChanges: z.array(structureDocumentChangeSchema).max(STRUCTURE_SNAPSHOT_LIMITS.artboards + 3),
    limit: z.number().int().min(1).max(STRUCTURE_SNAPSHOT_LIMITS.pageLimit),
    entries: z.array(structureDiffEntrySchema).max(STRUCTURE_SNAPSHOT_LIMITS.pageLimit),
    retention: retentionSchema,
};
export const structureDiffPageSchema = z.discriminatedUnion('hasMore', [
    z.strictObject({
        ...diffPageShape,
        hasMore: z.literal(true),
        nextCursor: z.string().min(1),
        complete: z.literal(false),
        absenceConclusive: z.literal(false),
    }),
    z.strictObject({
        ...diffPageShape,
        hasMore: z.literal(false),
        nextCursor: z.null(),
        complete: z.literal(true),
        absenceConclusive: z.literal(true),
    }),
]).superRefine((page, context) => {
    if (page.entries.length > page.limit) {
        context.addIssue({ code: 'custom', message: 'A page must not exceed its limit.', path: ['entries'] });
    }
    const summary = page.summary;
    if (summary.added + summary.removed + summary.moved + summary.changed + summary.indeterminate !== summary.entryCount) {
        context.addIssue({ code: 'custom', message: 'Entry kinds must sum to entryCount.', path: ['summary', 'entryCount'] });
    }
    if (summary.documentChangeCount !== page.documentChanges.length) {
        context.addIssue({ code: 'custom', message: 'documentChangeCount must equal documentChanges.length.', path: ['summary', 'documentChangeCount'] });
    }
});
