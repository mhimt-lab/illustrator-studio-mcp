import { z } from 'zod';
import { boundsSchema, documentContextSchema } from './mutation-result-schema-core.js';
const messageSchema = z.string().min(1).max(500);
const positiveFiniteSchema = z.number().finite().positive();
const imageColorSpaceSchema = z.enum(['RGB', 'CMYK', 'Gray', 'Lab', 'Indexed', 'unknown']);
const available = (value) => z.strictObject({ status: z.literal('available'), value });
const unavailable = (reason) => z.strictObject({
    status: z.literal('unavailable'), reason, message: messageSchema,
});
const layerSchema = z.strictObject({
    name: z.string().max(500),
    path: z.array(z.number().int().nonnegative()).min(1).max(64),
});
const linkageSchema = z.discriminatedUnion('status', [
    available(z.enum(['linked', 'embedded'])),
    unavailable(z.literal('link_state_unavailable')),
]);
const currentFileSchema = z.discriminatedUnion('status', [
    available(z.strictObject({
        path: z.string().min(1).max(32_768),
        bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        modifiedAt: z.string().datetime({ offset: true }),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
    })),
    z.strictObject({ status: z.literal('missing'), path: z.string().max(32_768).nullable(), message: messageSchema }),
    z.strictObject({ status: z.literal('not_applicable'), reason: z.literal('embedded_item') }),
    unavailable(z.enum([
        'link_file_unavailable',
        'file_not_regular',
        'file_stat_failed',
        'file_too_large_to_report',
        'file_snapshot_limit_exceeded',
        'file_snapshot_timeout',
        'file_hash_failed',
        'file_changed_during_inspection',
    ])),
]);
const placementUpdateSchema = z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('not_applicable'), reason: z.literal('embedded_item') }),
    unavailable(z.enum(['placement_update_state_unavailable', 'link_state_unavailable'])),
]);
const sourceFormatSchema = z.discriminatedUnion('status', [
    available(z.enum(['tiff', 'jpeg', 'png', 'psd'])),
    z.strictObject({ status: z.literal('not_applicable'), reason: z.literal('embedded_item') }),
    unavailable(z.enum([
        'source_format_missing',
        'source_format_unsupported',
        'metadata_reader_failed',
        'source_format_unavailable',
    ])),
]);
const pixelsSchema = z.discriminatedUnion('status', [
    available(z.strictObject({ width: z.number().int().positive(), height: z.number().int().positive() })),
    unavailable(z.enum([
        'pixel_dimensions_missing',
        'pixel_dimensions_invalid_zero',
        'source_format_unsupported',
        'metadata_reader_failed',
        'embedded_pixel_dimensions_invalid',
        'pixels_unavailable',
    ])),
]);
const nativePpiSchema = z.discriminatedUnion('status', [
    available(z.strictObject({ x: positiveFiniteSchema, y: positiveFiniteSchema })),
    unavailable(z.enum([
        'native_ppi_missing',
        'native_ppi_invalid_zero',
        'native_ppi_untrusted_format',
        'source_format_unsupported',
        'metadata_reader_failed',
        'embedded_native_ppi_unavailable',
        'native_ppi_unavailable',
    ])),
]);
const effectivePpiSchema = z.discriminatedUnion('status', [
    available(z.strictObject({ x: positiveFiniteSchema, y: positiveFiniteSchema })),
    unavailable(z.enum([
        'effective_ppi_pixels_unavailable',
        'effective_ppi_geometry_unavailable',
        'effective_ppi_invalid_zero',
    ])),
]);
const sourceColorSpaceSchema = z.discriminatedUnion('status', [
    available(imageColorSpaceSchema),
    unavailable(z.enum([
        'color_space_missing',
        'color_space_unsupported',
        'source_format_unsupported',
        'metadata_reader_failed',
        'color_space_unavailable',
    ])),
]);
const iccSchema = z.discriminatedUnion('status', [
    available(z.strictObject({ present: z.boolean(), name: z.string().min(1).max(500).nullable() }).superRefine((value, context) => {
        if (value.present !== (value.name !== null)) {
            context.addIssue({ code: 'custom', message: 'ICC present and name must agree.', path: ['name'] });
        }
    })),
    unavailable(z.enum([
        'icc_metadata_missing',
        'source_format_unsupported',
        'metadata_reader_failed',
        'embedded_icc_unavailable',
        'icc_unavailable',
    ])),
]);
const hostNumberPropertySchema = z.discriminatedUnion('status', [
    available(z.number().int().positive()),
    unavailable(z.literal('property_unavailable')),
]);
const hostColorantsPropertySchema = z.discriminatedUnion('status', [
    available(z.array(z.string().max(500)).max(64)),
    unavailable(z.literal('property_unavailable')),
]);
const colorSchema = z.discriminatedUnion('provenance', [
    z.strictObject({
        provenance: z.literal('linked_source_file'),
        space: sourceColorSpaceSchema,
        icc: iccSchema,
    }),
    z.strictObject({
        provenance: z.literal('embedded_illustrator_object'),
        space: z.discriminatedUnion('status', [
            available(imageColorSpaceSchema),
            unavailable(z.literal('color_space_unavailable')),
        ]),
        icc: unavailable(z.literal('embedded_icc_unavailable')),
        bitsPerChannel: hostNumberPropertySchema,
        channels: hostNumberPropertySchema,
        colorants: hostColorantsPropertySchema,
    }),
    z.strictObject({
        provenance: z.literal('unavailable'),
        space: unavailable(z.literal('color_space_unavailable')),
        icc: unavailable(z.literal('icc_unavailable')),
    }),
]);
const warningSchema = z.discriminatedUnion('code', [
    z.strictObject({ code: z.literal('link_missing'), severity: z.literal('error'), message: messageSchema }),
    z.strictObject({
        code: z.literal('file_inspection_unavailable'), severity: z.literal('warning'), message: messageSchema,
    }),
    z.strictObject({
        code: z.literal('effective_ppi_unavailable'), severity: z.literal('warning'), message: messageSchema,
    }),
    z.strictObject({
        code: z.literal('effective_ppi_below_threshold'),
        severity: z.literal('warning'),
        message: messageSchema,
        threshold: positiveFiniteSchema,
        x: positiveFiniteSchema,
        y: positiveFiniteSchema,
        failingAxes: z.array(z.enum(['x', 'y'])).min(1).max(2),
    }),
]);
export const imagePreflightItemSchema = z.strictObject({
    object: z.strictObject({
        uuid: z.string().min(1).max(255),
        type: z.enum(['PlacedItem', 'RasterItem']),
        name: z.string().max(500),
        layer: layerSchema,
        bounds: boundsSchema,
        visibleBounds: boundsSchema,
        locked: z.boolean(),
        hidden: z.boolean(),
    }),
    linkage: linkageSchema,
    currentFile: currentFileSchema,
    placementUpdate: placementUpdateSchema,
    sourceFormat: sourceFormatSchema,
    pixels: pixelsSchema,
    nativePpi: nativePpiSchema,
    effectivePpi: effectivePpiSchema,
    color: colorSchema,
    warnings: z.array(warningSchema).max(4),
});
const pageBaseSchema = z.strictObject({
    document: documentContextSchema,
    threshold: z.strictObject({ minimumEffectivePpi: positiveFiniteSchema }),
    scope: z.discriminatedUnion('mode', [
        z.strictObject({ mode: z.literal('document') }),
        z.strictObject({ mode: z.literal('objects'), uuids: z.array(z.string().min(1).max(255)).min(1).max(50) }),
    ]),
    items: z.array(imagePreflightItemSchema).max(50),
    warningCount: z.number().int().nonnegative(),
}).superRefine((value, context) => {
    const actual = value.items.reduce((total, item) => total + item.warnings.length, 0);
    if (value.warningCount !== actual) {
        context.addIssue({ code: 'custom', message: 'warningCount must equal the item warning total.', path: ['warningCount'] });
    }
});
export const imagePreflightPageSchema = z.discriminatedUnion('hasMore', [
    pageBaseSchema.safeExtend({
        hasMore: z.literal(true),
        nextCursor: z.string().min(1).max(32_768),
        complete: z.literal(false),
        absenceConclusive: z.literal(false),
    }),
    pageBaseSchema.safeExtend({
        hasMore: z.literal(false),
        nextCursor: z.null(),
        complete: z.literal(true),
        absenceConclusive: z.literal(true),
    }),
]);
