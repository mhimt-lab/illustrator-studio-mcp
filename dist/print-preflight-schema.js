import { z } from 'zod';
import { documentContextSchema } from './mutation-result-schema-core.js';
import { PRINT_PREFLIGHT_LIMITS } from './print-preflight.js';
const message = z.string().min(1).max(500);
const colorSpace = z.enum(['RGB', 'CMYK']);
const imageColorSpace = z.enum(['RGB', 'CMYK', 'Gray', 'Lab', 'Indexed', 'unknown']);
const category = z.enum([
    'color', 'overprint', 'transparency', 'raster_effect', 'bleed',
    'geometry', 'stroke', 'font', 'image', 'layer', 'completeness',
]);
const code = z.enum([
    'document_color_space_disallowed', 'color_profile_unavailable', 'used_ink_list_unavailable',
    'current_vector_rgb_in_cmyk_document', 'spot_color_used', 'overprint_used',
    'transparency_used', 'raster_effect_resolution_below_threshold',
    'raster_effect_settings_unavailable', 'bleed_unavailable',
    'object_outside_artboards', 'object_crosses_artboard', 'stroke_below_minimum',
    'font_missing', 'font_scan_incomplete', 'text_paint_scan_incomplete', 'nonprinting_layer_content',
    'image_link_missing', 'image_print_state_unavailable', 'image_file_inspection_unavailable',
    'image_effective_ppi_unavailable', 'image_effective_ppi_below_threshold',
    'image_color_space_unavailable', 'image_color_space_disallowed',
    'image_icc_unavailable', 'image_icc_missing', 'scan_limit_reached',
    'image_scan_limit_reached', 'findings_truncated',
]);
export const printPreflightConditionsSchema = z.strictObject({
    minimumEffectivePpi: z.number().finite().positive().max(100_000),
    minimumStrokeWidthPt: z.number().finite().nonnegative().max(10_000),
    minimumRasterEffectPpi: z.number().finite().positive().max(2_400),
    requiredBleedPt: z.strictObject({
        top: z.number().finite().nonnegative().max(10_000),
        right: z.number().finite().nonnegative().max(10_000),
        bottom: z.number().finite().nonnegative().max(10_000),
        left: z.number().finite().nonnegative().max(10_000),
    }),
    allowedDocumentColorSpaces: z.array(colorSpace).min(1).max(2),
    allowedImageColorSpaces: z.array(imageColorSpace).min(1).max(6),
    allowSpotColors: z.boolean(),
    allowOverprint: z.boolean(),
    allowTransparency: z.boolean(),
    requireLinkedImageIcc: z.boolean(),
});
const target = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('document') }),
    z.strictObject({
        kind: z.literal('object'),
        uuid: z.string().min(1).max(255),
        type: z.string().min(1).max(255),
        name: z.string().max(500),
    }),
]);
export const printPreflightFindingSchema = z.strictObject({
    category,
    code,
    severity: z.enum(['error', 'warning', 'info']),
    message,
    target,
    actual: z.string().max(2_000).nullable(),
    expected: z.string().max(2_000).nullable(),
});
const propertyUnavailable = (value) => z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('available'), value }),
    z.strictObject({ status: z.literal('unavailable'), reason: z.literal('property_unavailable'), message }),
]);
const facts = z.strictObject({
    documentColorSpace: colorSpace,
    colorProfileName: propertyUnavailable(z.string().min(1).max(500)),
    rasterEffectResolution: propertyUnavailable(z.number().finite().positive().max(2_400)),
    usedSpotNames: propertyUnavailable(z.array(z.string().min(1).max(500)).max(256)),
    bleed: z.discriminatedUnion('status', [
        z.strictObject({
            status: z.literal('available'),
            value: z.strictObject({
                top: z.number().finite().nonnegative().max(10_000),
                right: z.number().finite().nonnegative().max(10_000),
                bottom: z.number().finite().nonnegative().max(10_000),
                left: z.number().finite().nonnegative().max(10_000),
            }),
        }),
        z.strictObject({
            status: z.literal('unavailable'),
            reason: z.literal('current_document_bleed_unavailable'),
            message,
        }),
    ]),
});
const sectionStatus = z.enum(['pass', 'review', 'fail', 'indeterminate', 'not_requested']);
export const printPreflightResultSchema = z.strictObject({
    document: documentContextSchema,
    conditions: printPreflightConditionsSchema,
    verdict: z.enum(['pass', 'review', 'fail', 'indeterminate']),
    complete: z.boolean(),
    absenceConclusive: z.boolean(),
    sections: z.strictObject({
        color: sectionStatus,
        overprint: sectionStatus,
        transparency: sectionStatus,
        raster_effect: sectionStatus,
        bleed: sectionStatus,
        geometry: sectionStatus,
        stroke: sectionStatus,
        font: sectionStatus,
        image: sectionStatus,
        layer: sectionStatus,
    }),
    counts: z.strictObject({
        totalPageItems: z.number().int().nonnegative(),
        scannedPageItems: z.number().int().nonnegative().max(PRINT_PREFLIGHT_LIMITS.pageItems),
        totalImages: z.number().int().nonnegative(),
        scannedImages: z.number().int().nonnegative().max(PRINT_PREFLIGHT_LIMITS.images),
        findings: z.number().int().nonnegative(),
        errors: z.number().int().nonnegative(),
        warnings: z.number().int().nonnegative(),
        infos: z.number().int().nonnegative(),
    }),
    facts,
    findings: z.array(printPreflightFindingSchema).max(PRINT_PREFLIGHT_LIMITS.findings),
}).superRefine((value, context) => {
    if (value.complete !== value.absenceConclusive) {
        context.addIssue({ code: 'custom', message: 'complete and absenceConclusive must agree.', path: ['absenceConclusive'] });
    }
    if (value.counts.errors + value.counts.warnings + value.counts.infos !== value.findings.length) {
        context.addIssue({ code: 'custom', message: 'Severity counts must match returned findings.', path: ['counts'] });
    }
    if (value.verdict === 'pass' && (!value.complete || value.findings.some((finding) => finding.severity !== 'info'))) {
        context.addIssue({ code: 'custom', message: 'pass requires a complete result without error or warning findings.', path: ['verdict'] });
    }
});
