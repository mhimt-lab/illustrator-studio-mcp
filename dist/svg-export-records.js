import { z } from 'zod';
import { RASTER_SVG_RECORD_VERSION, rasterExportBindingSchema, rasterExportCleanupSchema, rasterExportFailedSchema, rasterExportHostOpenSchema, rasterExportHostTerminalSchema, rasterExportPrepareSchema, rasterExportPublishedSchema, rasterExportQuarantineSchema, rasterExportSessionSchema, } from './raster-export-records.js';
const v4Version = { version: z.literal(RASTER_SVG_RECORD_VERSION) };
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
export const svgLengthSchema = z.number().finite().min(0.001).max(16_383)
    .refine((value) => Number(value.toFixed(12)) === value, 'An SVG length must use the canonical 12-decimal representation.');
export const svgExportOptionsSchema = z.strictObject({
    format: z.literal('svg'),
    exportType: z.literal('WOSVG'),
    saveMultipleArtboards: z.literal(true),
    artboardRange: z.string().regex(/^[1-9]\d{0,5}$/),
    fontType: z.literal('OUTLINEFONT'),
    rasterImageLocation: z.literal('EMBED'),
    svgResponsive: z.literal(false),
    svgMinify: z.literal(false),
    coordinatePrecision: z.literal(3),
});
export const svgExpectedSchema = z.strictObject({ width: svgLengthSchema, height: svgLengthSchema });
const finiteSchema = z.number().finite();
export const svgExpectedBoundsSchema = z.strictObject({
    union: z.tuple([finiteSchema, finiteSchema, finiteSchema, finiteSchema]).nullable(),
    itemCount: z.number().int().min(0).max(2_000),
    digest: sha256Schema,
});
const svgViewBoxSchema = z.string().regex(/^0 0 \d+(?:\.\d+)? \d+(?:\.\d+)?$/);
export const svgArtifactSchema = z.strictObject({
    path: z.string().min(1),
    mediaType: z.literal('image/svg+xml'),
    bytes: z.number().int().positive(),
    sha256: sha256Schema,
    width: svgLengthSchema,
    height: svgLengthSchema,
    viewBox: svgViewBoxSchema,
});
const sameBoard = (record) => record.options.artboardRange === String(record.artboardIndex + 1);
export const svgSessionSchema = rasterExportSessionSchema.extend({
    ...v4Version,
    options: svgExportOptionsSchema,
    expected: svgExpectedSchema,
    expectedBounds: svgExpectedBoundsSchema,
    expectedActive: z.number().int().nonnegative(),
}).refine(sameBoard, 'artboardRange must be artboardIndex + 1.');
export const SVG_EXPORT_RECORD_SCHEMAS = {
    prepare: rasterExportPrepareSchema.extend(v4Version),
    session: svgSessionSchema,
    host_open: rasterExportHostOpenSchema.extend({ ...v4Version, activeArtboardIndex: z.number().int().nonnegative() }),
    artifact_binding: rasterExportBindingSchema.extend({
        ...v4Version,
        mediaType: z.literal('image/svg+xml'),
        width: svgLengthSchema,
        height: svgLengthSchema,
        viewBox: svgViewBoxSchema,
    }),
    host_terminal: rasterExportHostTerminalSchema.extend(v4Version),
    published: rasterExportPublishedSchema.extend({
        ...v4Version,
        options: svgExportOptionsSchema,
        expected: svgExpectedSchema,
        expectedBounds: svgExpectedBoundsSchema,
        artifact: svgArtifactSchema,
    }).refine(sameBoard, 'artboardRange must be artboardIndex + 1.'),
    failed: rasterExportFailedSchema.extend(v4Version),
    cleanup: rasterExportCleanupSchema.extend(v4Version),
    quarantine: rasterExportQuarantineSchema.extend(v4Version),
};
