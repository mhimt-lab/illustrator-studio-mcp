import { z } from 'zod';
import { boundsSchema, documentContextSchema } from './mutation-result-schema-core.js';
import { cmykColorSummarySchema, finiteNumberSchema, grayColorSummarySchema, gradientSummarySchema, labColorSummarySchema, patternColorSummarySchema, percentSchema, rgbChannelSchema, rgbColorSummarySchema, spotSummarySchema, unknownColorSummarySchema, } from './object-appearance-schema.js';
import { CONTRAST_LARGE_TEXT, CONTRAST_THRESHOLDS, DESIGN_ANALYSIS_LIMITS } from './design-analysis.js';
const message = z.string().min(1).max(500);
const count = z.number().int().nonnegative();
const tokenId = z.string().min(1).max(255);
const swatchGradientColorSchema = z.strictObject({
    model: z.literal('gradient'),
    name: z.string(),
    type: z.enum(['linear', 'radial']),
    stops: z.array(z.strictObject({
        rampPoint: percentSchema,
        midPoint: finiteNumberSchema.min(13).max(87),
        opacity: percentSchema,
        color: z.discriminatedUnion('model', [
            grayColorSummarySchema,
            rgbColorSummarySchema,
            cmykColorSummarySchema,
            labColorSummarySchema,
            z.strictObject({
                model: z.literal('spot'),
                name: z.string(),
                tint: percentSchema,
                colorType: z.enum(['spot', 'registration', 'unknown']),
                baseColor: z.discriminatedUnion('model', [
                    z.strictObject({ model: z.literal('none') }),
                    grayColorSummarySchema,
                    rgbColorSummarySchema,
                    cmykColorSummarySchema,
                    labColorSummarySchema,
                ]),
            }),
        ]),
    })).min(2).max(32),
});
const gradientReferenceSchema = z.strictObject({ model: z.literal('gradient'), name: z.string() });
export const designTokenColorSchema = z.union([
    grayColorSummarySchema,
    rgbColorSummarySchema,
    cmykColorSummarySchema,
    labColorSummarySchema,
    spotSummarySchema,
    gradientSummarySchema,
    swatchGradientColorSchema,
    gradientReferenceSchema,
    patternColorSummarySchema,
    unknownColorSummarySchema,
]).meta({ id: 'DesignTokenColor' });
const colorTokenSchema = z.strictObject({
    id: tokenId,
    color: designTokenColorSchema,
    swatchNames: z.array(z.string()).max(512),
    usage: z.strictObject({ fill: count, stroke: count, text: count, total: count.min(1) }),
    css: z.string().min(1).max(4_000).nullable(),
});
const fontTokenSchema = z.strictObject({
    postScriptName: z.string(),
    family: z.string(),
    style: z.string(),
    characterCount: count,
    runCount: count.min(1),
    textFrameCount: count.min(1),
    sizesPt: z.array(finiteNumberSchema).max(DESIGN_ANALYSIS_LIMITS.fontSizes),
});
const missingFontTokenSchema = z.strictObject({
    fontName: z.string().nullable(),
    reason: z.enum(['font_missing', 'font_unavailable']),
    characterCount: count,
    textFrameCount: count.min(1),
});
const fontSizeTokenSchema = z.strictObject({ sizePt: finiteNumberSchema, characterCount: count, runCount: count.min(1) });
const strokeWidthTokenSchema = z.strictObject({ widthPt: finiteNumberSchema.nonnegative(), usage: count.min(1) });
const lineHeightSchema = z.strictObject({
    textFrameUuid: z.string().min(1).max(255),
    status: z.enum(['available', 'unavailable']),
    reason: z.enum(['native_leading_sample_observed', 'foreground_profile_required', 'unsupported_host_version', 'native_property_unavailable', 'mixed_frame_single_token_unavailable', 'unsupported_text_frame_scope', 'line_height_scan_limit', 'line_height_sample_scope_required']),
    observationScope: z.literal('complete_frame_single_glyph_lines').nullable(),
    sampledVisibleLines: count.nullable(),
    nativeLeadingPt: finiteNumberSchema.nullable(),
    autoLeading: z.boolean().nullable(),
    paragraphAutoLeadingAmounts: z.array(finiteNumberSchema).max(100).nullable(),
    cssResolvedLineHeightPt: z.null(),
    cssUnavailableReason: z.literal('render_oracle_fixture_specific'),
}).superRefine((value, context) => {
    if (value.status === 'available' && (value.reason !== 'native_leading_sample_observed' ||
        value.observationScope === null || value.sampledVisibleLines === null || value.sampledVisibleLines < 1 ||
        value.nativeLeadingPt === null || value.autoLeading === null || value.paragraphAutoLeadingAmounts === null ||
        value.paragraphAutoLeadingAmounts.length !== value.sampledVisibleLines)) {
        context.addIssue({ code: 'custom', message: 'Available line-height samples require complete scoped native values.' });
    }
    if (value.status === 'unavailable' && (value.reason === 'native_leading_sample_observed' ||
        value.nativeLeadingPt !== null || value.autoLeading !== null ||
        value.paragraphAutoLeadingAmounts !== null)) {
        context.addIssue({ code: 'custom', message: 'Unavailable line-height samples cannot expose native values.' });
    }
    if ((value.observationScope === null) !== (value.sampledVisibleLines === null)) {
        context.addIssue({ code: 'custom', message: 'Line-height observation scope and sample count must be reported together.' });
    }
});
export const designTokensResultSchema = z.strictObject({
    document: documentContextSchema,
    format: z.enum(['json', 'css']),
    colors: z.array(colorTokenSchema).max(DESIGN_ANALYSIS_LIMITS.colors),
    fonts: z.array(fontTokenSchema).max(DESIGN_ANALYSIS_LIMITS.fonts),
    missingFonts: z.array(missingFontTokenSchema).max(DESIGN_ANALYSIS_LIMITS.fonts),
    fontSizes: z.array(fontSizeTokenSchema).max(DESIGN_ANALYSIS_LIMITS.fontSizes),
    strokeWidths: z.array(strokeWidthTokenSchema).max(DESIGN_ANALYSIS_LIMITS.strokeWidths),
    lineHeights: z.array(lineHeightSchema).max(DESIGN_ANALYSIS_LIMITS.textFrameDetailReads),
    coverage: z.strictObject({
        pageItems: count,
        textFrames: count,
        textFramesDetailed: count,
        swatches: count,
        unavailableAttributes: count,
    }),
    complete: z.boolean(),
    incompleteReasons: z.array(z.enum([
        'text_frame_detail_limit', 'text_style_scan_truncated', 'text_content_truncated', 'colors_truncated',
        'fonts_truncated', 'font_sizes_truncated', 'stroke_widths_truncated', 'attribute_unavailable',
    ])).max(8),
    limitations: z.array(z.enum(['line_height_css_value_unavailable', 'cmyk_css_not_color_managed'])).max(2),
    css: z.string().nullable(),
}).superRefine((value, context) => {
    if (value.complete !== (value.incompleteReasons.length === 0)) {
        context.addIssue({ code: 'custom', message: 'complete must equal incompleteReasons.length === 0.', path: ['complete'] });
    }
    if ((value.format === 'css') !== (value.css !== null)) {
        context.addIssue({ code: 'custom', message: 'css is present exactly when format is css.', path: ['css'] });
    }
    if (value.coverage.textFramesDetailed > value.coverage.textFrames) {
        context.addIssue({ code: 'custom', message: 'textFramesDetailed cannot exceed textFrames.', path: ['coverage', 'textFramesDetailed'] });
    }
});
const textTargetSchema = z.strictObject({
    uuid: z.string().min(1).max(255),
    name: z.string().max(500),
    hidden: z.boolean().nullable(),
});
const excerptSchema = z.string().max(100);
export const textConsistencyFindingSchema = z.discriminatedUnion('rule', [
    z.strictObject({
        rule: z.literal('placeholder_text'),
        severity: z.literal('warning'),
        message,
        target: textTargetSchema,
        evidence: z.strictObject({ pattern: z.string().min(1), excerpt: excerptSchema }),
    }),
    ...['trailing_whitespace', 'consecutive_whitespace'].map((rule) => z.strictObject({
        rule: z.literal(rule),
        severity: z.literal('warning'),
        message,
        target: textTargetSchema,
        evidence: z.strictObject({ lineIndex: count, excerpt: excerptSchema }),
    })),
    z.strictObject({
        rule: z.literal('duplicate_word'),
        severity: z.literal('warning'),
        message,
        target: textTargetSchema,
        evidence: z.strictObject({ word: z.string().min(1), excerpt: excerptSchema }),
    }),
    ...['case_variant', 'width_variant', 'mixed_variant'].map((rule) => z.strictObject({
        rule: z.literal(rule),
        severity: z.literal('info'),
        message,
        evidence: z.strictObject({
            key: z.string().min(1),
            forms: z.array(z.strictObject({
                form: z.string().min(1),
                count: count.min(1),
                targets: z.array(textTargetSchema).min(1),
            })).min(2).max(DESIGN_ANALYSIS_LIMITS.variantForms),
        }),
    })),
]);
export const textConsistencyResultSchema = z.strictObject({
    document: documentContextSchema,
    textFrames: count,
    scannedTextFrames: count,
    findings: z.array(textConsistencyFindingSchema).max(DESIGN_ANALYSIS_LIMITS.findings),
    findingCount: count,
    complete: z.boolean(),
    incompleteReasons: z.array(z.enum(['text_content_truncated', 'text_unavailable', 'findings_truncated'])).max(3),
}).superRefine((value, context) => {
    if (value.complete !== (value.incompleteReasons.length === 0)) {
        context.addIssue({ code: 'custom', message: 'complete must equal incompleteReasons.length === 0.', path: ['complete'] });
    }
    if (value.findingCount < value.findings.length) {
        context.addIssue({ code: 'custom', message: 'findingCount cannot be below findings.length.', path: ['findingCount'] });
    }
    if (value.scannedTextFrames > value.textFrames) {
        context.addIssue({ code: 'custom', message: 'scannedTextFrames cannot exceed textFrames.', path: ['scannedTextFrames'] });
    }
});
export const contrastColorInputSchema = z.discriminatedUnion('model', [
    z.strictObject({ model: z.literal('rgb'), red: rgbChannelSchema, green: rgbChannelSchema, blue: rgbChannelSchema }),
    z.strictObject({
        model: z.literal('cmyk'), cyan: percentSchema, magenta: percentSchema, yellow: percentSchema, black: percentSchema,
    }),
    z.strictObject({ model: z.literal('gray'), gray: percentSchema }),
    z.strictObject({ model: z.literal('hex'), value: z.string().regex(/^#?[0-9a-fA-F]{6}$/) }),
]);
export const contrastPairInputSchema = z.strictObject({
    id: z.string().min(1).max(255).optional(),
    foreground: contrastColorInputSchema,
    background: contrastColorInputSchema,
    text: z.strictObject({
        size_pt: finiteNumberSchema.positive().max(10_000),
        bold: z.boolean().default(false),
    }).optional(),
});
export const contrastRequestSchema = z.discriminatedUnion('mode', [
    z.strictObject({
        mode: z.literal('pairs'),
        pairs: z.array(contrastPairInputSchema).min(1).max(DESIGN_ANALYSIS_LIMITS.contrastPairs),
    }),
    z.strictObject({ mode: z.literal('auto_detect') }),
]);
const srgbByte = z.number().int().min(0).max(255);
const resolvedColorSchema = z.strictObject({
    input: contrastColorInputSchema,
    srgb: z.strictObject({ red: srgbByte, green: srgbByte, blue: srgbByte }),
    conversion: z.enum(['srgb_exact', 'gray_ink_coverage', 'cmyk_naive']),
    relativeLuminance: finiteNumberSchema.min(0).max(1),
});
const levelPairSchema = z.strictObject({ normal: z.boolean(), large: z.boolean() });
const hostProfileObservationSchema = z.strictObject({
    profile: z.enum(['foreground', 'background', 'locked', 'unknown']),
    lockState: z.enum(['locked', 'unlocked', 'unknown']),
    frontmostBundleId: z.string().min(1).nullable(),
    expectedBundleId: z.string().min(1),
    observedAt: z.string().min(1),
});
const contrastPairsResultSchema = z.strictObject({
    mode: z.literal('pairs'),
    documentKey: z.string().min(1),
    hostRead: z.literal(false),
    formula: z.literal('wcag-2.x-relative-luminance'),
    thresholds: z.strictObject({
        aaNormal: z.literal(CONTRAST_THRESHOLDS.aaNormal),
        aaLarge: z.literal(CONTRAST_THRESHOLDS.aaLarge),
        aaaNormal: z.literal(CONTRAST_THRESHOLDS.aaaNormal),
        aaaLarge: z.literal(CONTRAST_THRESHOLDS.aaaLarge),
    }),
    largeText: z.strictObject({
        minimumSizePt: z.literal(CONTRAST_LARGE_TEXT.minimumSizePt),
        minimumBoldSizePt: z.literal(CONTRAST_LARGE_TEXT.minimumBoldSizePt),
    }),
    pairs: z.array(z.strictObject({
        index: count,
        id: z.string().nullable(),
        foreground: resolvedColorSchema,
        background: resolvedColorSchema,
        ratio: finiteNumberSchema.min(1).max(21),
        levels: z.strictObject({ aa: levelPairSchema, aaa: levelPairSchema }),
        text: z.strictObject({
            sizePt: finiteNumberSchema.positive(),
            bold: z.boolean(),
            large: z.boolean(),
            aa: z.boolean(),
            aaa: z.boolean(),
        }).nullable(),
    })).min(1).max(DESIGN_ANALYSIS_LIMITS.contrastPairs),
    complete: z.literal(true),
});
const contrastAutoDetectUnsupportedSchema = z.strictObject({
    mode: z.literal('auto_detect'),
    documentKey: z.string().min(1),
    hostRead: z.boolean(),
    outcome: z.literal('unsupported'),
    reason: z.literal('auto_detect_unsupported_profile'),
    observed: hostProfileObservationSchema,
    message,
});
const overlapReferenceSchema = z.strictObject({
    uuid: z.string().min(1).max(255),
    name: z.string().max(500),
    type: z.string().min(1).max(255),
    bounds: boundsSchema,
    visibleRegion: boundsSchema,
});
const overlapIndeterminateReason = z.enum([
    'visibility_unavailable', 'parent_unavailable', 'clip_unresolved', 'text_fill_unavailable',
    'text_fill_unsupported_model', 'background_fill_unavailable', 'background_fill_unsupported_model',
    'opacity_unavailable', 'opacity_not_opaque',
]);
const overlapOutcomeSchema = z.discriminatedUnion('status', [
    z.strictObject({
        status: z.literal('evaluated'),
        foreground: resolvedColorSchema,
        background: resolvedColorSchema,
        ratio: finiteNumberSchema.min(1).max(21),
        levels: z.strictObject({ aa: levelPairSchema, aaa: levelPairSchema }),
    }),
    z.strictObject({ status: z.literal('no_background') }),
    z.strictObject({ status: z.literal('indeterminate'), reason: overlapIndeterminateReason }),
]);
const contrastAutoDetectResultSchema = z.strictObject({
    mode: z.literal('auto_detect'),
    document: documentContextSchema,
    hostRead: z.literal(true),
    profile: z.literal('foreground'),
    observed: z.strictObject({ before: hostProfileObservationSchema, after: hostProfileObservationSchema }),
    formula: z.literal('wcag-2.x-relative-luminance'),
    thresholds: contrastPairsResultSchema.shape.thresholds,
    largeText: contrastPairsResultSchema.shape.largeText,
    entries: z.array(z.strictObject({
        text: overlapReferenceSchema,
        background: overlapReferenceSchema.nullable(),
        candidateCount: count,
        outcome: overlapOutcomeSchema,
    })).max(DESIGN_ANALYSIS_LIMITS.findings),
    summary: z.strictObject({
        textFrames: count,
        hiddenTextFrames: count,
        clippedAwayTextFrames: count,
        evaluated: count,
        noBackground: count,
        indeterminate: count,
        entryCount: count,
    }),
    complete: z.boolean(),
    incompleteReasons: z.array(z.enum(['entries_truncated', 'attribute_unavailable'])).max(2),
    limitations: z.array(z.enum([
        'profile_foreground_only', 'background_finder_close_indeterminate', 'locked_unmeasured',
        'frame_level_text_fill_only', 'text_size_not_read', 'stroke_and_effects_ignored', 'path_backgrounds_only',
        'cmyk_conversion_naive',
    ])).max(8),
}).superRefine((value, context) => {
    if (value.complete !== (value.incompleteReasons.length === 0)) {
        context.addIssue({ code: 'custom', message: 'complete must equal incompleteReasons.length === 0.', path: ['complete'] });
    }
    if (value.observed.before.profile !== 'foreground' || value.observed.after.profile !== 'foreground') {
        context.addIssue({ code: 'custom', message: 'auto_detect results require foreground observations.', path: ['observed'] });
    }
    if (value.summary.entryCount < value.entries.length) {
        context.addIssue({ code: 'custom', message: 'entryCount cannot be below entries.length.', path: ['summary', 'entryCount'] });
    }
    for (const [index, entry] of value.entries.entries()) {
        if (entry.outcome.status === 'evaluated' && entry.background === null) {
            context.addIssue({ code: 'custom', message: 'evaluated entries need a background.', path: ['entries', index, 'background'] });
        }
        if (entry.outcome.status === 'no_background' && entry.background !== null) {
            context.addIssue({ code: 'custom', message: 'no_background entries cannot carry a background.', path: ['entries', index, 'background'] });
        }
    }
});
export const contrastResultSchema = z.union([
    contrastPairsResultSchema,
    contrastAutoDetectUnsupportedSchema,
    contrastAutoDetectResultSchema,
]);
