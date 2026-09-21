import { z } from 'zod';
import { boundsSchema } from './mutation-result-schema-core.js';
export const objectLayerSchema = z.strictObject({
    name: z.string(),
    path: z.array(z.number().int().nonnegative()).min(1),
});
export const objectSummarySchema = z.strictObject({
    uuid: z.string().min(1),
    type: z.string().min(1),
    name: z.string(),
    layer: objectLayerSchema,
    bounds: boundsSchema,
});
export const unavailableMessageSchema = z.string().min(1).max(500);
export const requiredAvailabilitySchema = (valueSchema, unavailableReasonSchema) => z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('available'), value: valueSchema }),
    z.strictObject({ status: z.literal('unavailable'), reason: unavailableReasonSchema, message: unavailableMessageSchema }),
]);
export const finiteNumberSchema = z.number().finite();
export const percentSchema = finiteNumberSchema.min(0).max(100);
export const rgbChannelSchema = finiteNumberSchema.min(0).max(255);
export const labChannelSchema = finiteNumberSchema.min(-128).max(128);
export const strokeWidthSchema = finiteNumberSchema.nonnegative();
export const TEXT_DETAIL_LIMITS = { paragraphs: 100, styleRuns: 200, fonts: 100, missingFonts: 100 };
export const noneColorSummarySchema = z.strictObject({ model: z.literal('none') });
export const grayColorSummarySchema = z.strictObject({ model: z.literal('gray'), gray: percentSchema });
export const rgbColorSummarySchema = z.strictObject({
    model: z.literal('rgb'), red: rgbChannelSchema, green: rgbChannelSchema, blue: rgbChannelSchema,
});
export const cmykColorSummarySchema = z.strictObject({
    model: z.literal('cmyk'),
    cyan: percentSchema,
    magenta: percentSchema,
    yellow: percentSchema,
    black: percentSchema,
});
export const labColorSummarySchema = z.strictObject({
    model: z.literal('lab'), lightness: labChannelSchema, a: labChannelSchema, b: labChannelSchema,
});
export const patternColorSummarySchema = z.strictObject({ model: z.literal('pattern'), name: z.string() });
export const unknownColorSummarySchema = z.strictObject({ model: z.literal('unknown'), typename: z.string().min(1) });
export const nonSpotColorSchema = z.discriminatedUnion('model', [
    noneColorSummarySchema,
    grayColorSummarySchema,
    rgbColorSummarySchema,
    cmykColorSummarySchema,
    labColorSummarySchema,
    patternColorSummarySchema,
    unknownColorSummarySchema,
]);
export const spotSummarySchema = z.strictObject({
    model: z.literal('spot'),
    name: z.string(),
    tint: percentSchema,
    baseColor: nonSpotColorSchema,
});
export const gradientStopColorSummarySchema = z.discriminatedUnion('model', [
    grayColorSummarySchema,
    rgbColorSummarySchema,
    cmykColorSummarySchema,
    labColorSummarySchema,
    spotSummarySchema,
]);
export const gradientSummarySchema = z.strictObject({
    model: z.literal('gradient'),
    name: z.string(),
    type: z.enum(['linear', 'radial']),
    angle: finiteNumberSchema.min(-180).max(180),
    stops: z.array(z.strictObject({
        rampPoint: percentSchema,
        midPoint: finiteNumberSchema.min(13).max(87),
        opacity: percentSchema,
        color: gradientStopColorSummarySchema,
    })).min(2).max(32),
});
export const colorSummarySchema = z.discriminatedUnion('model', [
    ...nonSpotColorSchema.options,
    spotSummarySchema,
    gradientSummarySchema,
]);
export const opacitySchema = requiredAvailabilitySchema(percentSchema, z.literal('opacity_unavailable'));
export const fillValueSchema = colorSummarySchema;
export const strokeValueSchema = z.strictObject({ color: colorSummarySchema, width: strokeWidthSchema });
export const availableFillSchema = requiredAvailabilitySchema(fillValueSchema, z.literal('paint_unavailable'));
export const availableStrokeSchema = requiredAvailabilitySchema(strokeValueSchema, z.literal('paint_unavailable'));
export const pathFillSchema = z.discriminatedUnion('status', [
    ...availableFillSchema.options,
    z.strictObject({ status: z.literal('not_applicable'), reason: z.literal('paint_disabled') }),
]);
export const pathStrokeSchema = z.discriminatedUnion('status', [
    ...availableStrokeSchema.options,
    z.strictObject({ status: z.literal('not_applicable'), reason: z.literal('paint_disabled') }),
]);
export const unsupportedPaintSchema = z.strictObject({
    status: z.literal('not_applicable'),
    reason: z.literal('unsupported_object_type'),
});
export const pathAppearanceSchema = z.strictObject({
    opacity: opacitySchema,
    fill: pathFillSchema,
    stroke: pathStrokeSchema,
});
export const textAppearanceSchema = z.strictObject({
    opacity: opacitySchema,
    fill: availableFillSchema,
    stroke: availableStrokeSchema,
});
export const unsupportedAppearanceSchema = z.strictObject({
    opacity: opacitySchema,
    fill: unsupportedPaintSchema,
    stroke: unsupportedPaintSchema,
});
