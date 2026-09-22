import { McpServer } from '@modelcontextprotocol/server';
import { createRequire } from 'node:module';
import { z } from 'zod';
import { boundsSchema, documentContextSchema, documentContextWithApplicationSchema, documentKeyShortSchema, illustratorApplicationEvidenceSchema, isMutationAuditPrefix, layerStructuralReasonSchema, mutationAuditSchema, toBounds, } from './mutation-result-schema-core.js';
export { documentContextSchema } from './mutation-result-schema-core.js';
export { rectangleResponseSchema, rectangleResultSchema } from './rectangle-result-schema.js';
export { operationSafetyPlanSchema, operationSafetyPolicySchema, operationSafetyResultSchema, } from './operation-safety-policy-core.js';
import { textStyleListSchema } from './text-style-resources.js';
import { FONT_LOOKUP_MAX_NAMES, fontLookupResultSchema, fontPostScriptNameSchema } from './font-lookup.js';
import { getPathPointsResultSchema, PATH_EDIT_MAX_POINTS } from './path-points.js';
import { getAreaTextOptionsResultSchema } from './area-text-options.js';
import { canonicalCommandIdSchema } from './command-id.js';
import { createBackupResultSchema, reconcileBackupResultSchema } from './document-backup.js';
import { normalizeReconcileDeletePublicInput, reconcileDeletePublicInputSchema, reconcileDeleteResultSchema } from './delete-recovery.js';
import { createDocumentPublicInputSchema, createDocumentResultSchema, normalizeCreateDocumentPublicInput } from './document-create.js';
import { closeDocumentPublicInputSchema, closeDocumentResultSchema, normalizeCloseDocumentPublicInput, normalizeOpenDocumentPublicInput, normalizeSaveDocumentAsPublicInput, normalizeSaveDocumentPublicInput, openDocumentPublicInputSchema, openDocumentResultSchema, saveDocumentAsPublicInputSchema, saveDocumentAsResultSchema, saveDocumentPublicInputSchema, saveDocumentResultSchema, } from './document-lifecycle.js';
import { exportOutlinedResultSchema, reconcileExportResultSchema } from './document-export.js';
import { closeEditSessionResultSchema, EDIT_SESSION_SUPPORT_PROFILE, getEditSessionsResultSchema, openEditSessionResultSchema, sessionIdSchema, } from './edit-session-tools.js';
import { IMAGE_OPTIMIZE_APP_VERSION, IMAGE_OPTIMIZE_MAX_PPI, IMAGE_OPTIMIZE_MAX_TARGETS, IMAGE_OPTIMIZE_MIN_PPI, IMAGE_OPTIMIZE_RENDER_MAX_PIXELS, imageOptimizeResultSchema, } from './image-optimize.js';
import { m6P0RecipeToolContract } from './m6-p0-recipe.js';
import { recipeToolContracts } from './recipe.js';
import { installPublishedToolList, installSharedToolSchemas } from './published-tool-schema.js';
import { imagePreflightPageSchema } from './image-preflight-schema.js';
import { printPreflightConditionsSchema, printPreflightResultSchema } from './print-preflight-schema.js';
import { contrastRequestSchema, contrastResultSchema, designTokensResultSchema, textConsistencyResultSchema, } from './design-analysis-schema.js';
import { colorMatchSchema, colorReplacementPlanSchema, colorUsagePageSchema, replacementColorSchema, } from './color-replacement.js';
import { cmykColorSummarySchema, colorSummarySchema, finiteNumberSchema, grayColorSummarySchema, labColorSummarySchema, noneColorSummarySchema, objectSummarySchema, pathAppearanceSchema, patternColorSummarySchema, percentSchema, requiredAvailabilitySchema, rgbColorSummarySchema, TEXT_DETAIL_LIMITS, textAppearanceSchema, unavailableMessageSchema, unknownColorSummarySchema, unsupportedAppearanceSchema, } from './object-appearance-schema.js';
import { structureDiffIdSchema, structureDiffPageSchema, structureSnapshotIdSchema, structureSnapshotSummarySchema, } from './structure-diff-schema.js';
import { STRUCTURE_DIFF_DEFAULT_TOLERANCE_PT, STRUCTURE_DIFF_MAX_TOLERANCE_PT, STRUCTURE_SNAPSHOT_LIMITS, } from './structure-diff.js';
import { comparePngImages, visualDiffResultSchema } from './visual-diff.js';
import { PREVIEW_MAX_SIDE_PT, previewBoundsSchema, previewResultSchema } from './document-preview.js';
import { rasterExportInputSchema, rasterExportResultSchema, rasterReconcileResultSchema } from './raster-export.js';
import { NEXT_CALL_BUILDERS, buildNextCall, formatToolArgumentError, nextCallSchema, toolArgumentIssueMessage } from './tool-arguments.js';
export { imagePreflightItemSchema, imagePreflightPageSchema } from './image-preflight-schema.js';
export { printPreflightFindingSchema, printPreflightResultSchema } from './print-preflight-schema.js';
export { structureDiffPageSchema, structureSnapshotSummarySchema } from './structure-diff-schema.js';
export { visualDiffResultSchema } from './visual-diff.js';
export { previewResultSchema } from './document-preview.js';
export { contrastResultSchema, designTokensResultSchema, textConsistencyResultSchema } from './design-analysis-schema.js';
export { backupRecordSchema, backupSessionSchema, createBackupResultSchema, reconcileBackupResultSchema } from './document-backup.js';
export { exportOutlinedResultSchema, exportRecordSchema, exportSessionSchema, reconcileExportResultSchema } from './document-export.js';
export { closeDocumentResultSchema, openDocumentResultSchema, saveDocumentAsResultSchema, saveDocumentResultSchema } from './document-lifecycle.js';
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const RECONCILE = { readOnlyHint: false };
const BACKUP = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const DESTRUCTIVE_WITH_BACKUP = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
function text(value) {
    return {
        content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        structuredContent: { result: value },
    };
}
const packageVersion = createRequire(import.meta.url)('../package.json').version;
const itemCountCollectionSchema = (itemSchema, maxItems) => z.union([
    z.strictObject({
        status: z.literal('complete'),
        items: z.array(itemSchema).max(maxItems),
    }),
    z.strictObject({
        status: z.literal('truncated'),
        items: z.array(itemSchema).length(maxItems),
        reason: z.literal('item_limit'),
        total: z.number().int().positive(),
    }),
]).superRefine((collection, context) => {
    if (collection.status === 'truncated' && collection.total <= collection.items.length) {
        context.addIssue({
            code: 'custom',
            message: 'item_limit total must be greater than items.length.',
            path: ['total'],
        });
    }
});
const scannedCollectionSchema = (itemSchema, maxItems) => z.union([
    z.strictObject({
        status: z.literal('complete'),
        items: z.array(itemSchema).max(maxItems),
    }),
    z.strictObject({
        status: z.literal('truncated'),
        items: z.array(itemSchema).length(maxItems),
        reason: z.literal('item_limit'),
        total: z.number().int().positive(),
    }),
    z.strictObject({
        status: z.literal('truncated'),
        items: z.array(itemSchema).max(maxItems),
        reason: z.enum(['scan_limit', 'run_limit']),
        total: z.null(),
    }),
]).superRefine((collection, context) => {
    if (collection.status === 'truncated' && collection.reason === 'item_limit' && collection.total <= collection.items.length) {
        context.addIssue({
            code: 'custom',
            message: 'item_limit total must be greater than items.length.',
            path: ['total'],
        });
    }
});
const fontValueSchema = z.strictObject({ family: z.string(), style: z.string(), postScriptName: z.string() });
const fontAvailabilitySchema = z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('available'), value: fontValueSchema }),
    z.strictObject({
        status: z.literal('unavailable'),
        reason: z.enum(['font_missing', 'font_unavailable']),
        message: unavailableMessageSchema,
        fontName: z.string().nullable(),
    }),
]);
const characterStyleAvailabilitySchema = requiredAvailabilitySchema(finiteNumberSchema, z.literal('character_style_unavailable'));
const colorStyleAvailabilitySchema = requiredAvailabilitySchema(colorSummarySchema, z.literal('character_style_unavailable'));
const textStyleRunSchema = z.strictObject({
    start: z.number().int().nonnegative(),
    length: z.number().int().positive(),
    font: fontAvailabilitySchema,
    size: characterStyleAvailabilitySchema,
    tracking: characterStyleAvailabilitySchema,
    fill: colorStyleAvailabilitySchema,
    stroke: colorStyleAvailabilitySchema,
});
const paragraphSchema = z.strictObject({
    index: z.number().int().nonnegative(),
    characterCount: z.number().int().nonnegative(),
    preview: z.string().max(200),
    previewTruncated: z.boolean(),
    justification: requiredAvailabilitySchema(z.string(), z.literal('paragraph_style_unavailable')),
}).superRefine((paragraph, context) => {
    if (!paragraph.previewTruncated && paragraph.preview.length !== paragraph.characterCount) {
        context.addIssue({
            code: 'custom',
            message: 'An untruncated preview must contain exactly characterCount UTF-16 code units.',
            path: ['preview'],
        });
    }
    if (paragraph.previewTruncated && paragraph.preview.length >= paragraph.characterCount) {
        context.addIssue({
            code: 'custom',
            message: 'A truncated preview must contain fewer UTF-16 code units than characterCount.',
            path: ['preview'],
        });
    }
});
const fontUsageSchema = fontValueSchema.extend({ characterCount: z.number().int().positive() });
const missingFontSchema = z.strictObject({
    start: z.number().int().nonnegative(),
    length: z.number().int().positive(),
    reason: z.enum(['font_missing', 'font_unavailable']),
    message: unavailableMessageSchema,
    fontName: z.string().nullable(),
});
function validateStyleRunPrefix(collection, totalCharacters, context) {
    const items = collection.items;
    if (totalCharacters === 0) {
        if (items.length !== 0 || collection.status !== 'complete') {
            context.addIssue({
                code: 'custom',
                message: 'Empty content requires a complete empty style-run collection.',
                path: ['styleRuns'],
            });
        }
        return;
    }
    if (items.length === 0) {
        context.addIssue({
            code: 'custom',
            message: 'Nonempty content requires a nonempty style-run prefix.',
            path: ['styleRuns', 'items'],
        });
        return;
    }
    let previousEnd = 0;
    for (let index = 0; index < items.length; index++) {
        const range = items[index];
        const end = range.start + range.length;
        if (end > totalCharacters) {
            context.addIssue({
                code: 'custom',
                message: 'Range must end within content totalCharacters.',
                path: ['styleRuns', 'items', index, 'length'],
            });
        }
        if (range.start !== previousEnd) {
            context.addIssue({
                code: 'custom',
                message: 'Style runs must form a contiguous prefix starting at zero.',
                path: ['styleRuns', 'items', index, 'start'],
            });
        }
        previousEnd = end;
    }
    if (collection.status === 'complete' && previousEnd !== totalCharacters) {
        context.addIssue({
            code: 'custom',
            message: 'A complete style-run collection must cover all content.',
            path: ['styleRuns', 'items'],
        });
    }
    if (collection.status === 'truncated' && previousEnd >= totalCharacters) {
        context.addIssue({
            code: 'custom',
            message: 'A truncated style-run collection must omit a nonempty suffix.',
            path: ['styleRuns', 'items'],
        });
    }
}
function sameMissingIdentity(left, right) {
    return left.reason === right.reason && left.message === right.message && left.fontName === right.fontName;
}
function validateMissingRanges(items, totalCharacters, styleRuns, context) {
    let previousEnd = 0;
    for (let index = 0; index < items.length; index++) {
        const range = items[index];
        const end = range.start + range.length;
        if (end > totalCharacters) {
            context.addIssue({
                code: 'custom',
                message: 'Range must end within content totalCharacters.',
                path: ['missingFonts', 'items', index, 'length'],
            });
        }
        if (index > 0 && range.start < previousEnd) {
            context.addIssue({
                code: 'custom',
                message: 'Missing-font ranges must be ordered and non-overlapping.',
                path: ['missingFonts', 'items', index, 'start'],
            });
        }
        if (index > 0 && range.start === previousEnd && sameMissingIdentity(items[index - 1], range)) {
            context.addIssue({
                code: 'custom',
                message: 'Adjacent missing-font ranges with the same identity must be merged.',
                path: ['missingFonts', 'items', index, 'start'],
            });
        }
        for (let runIndex = 0; runIndex < styleRuns.length; runIndex++) {
            const run = styleRuns[runIndex];
            if (run.font.status !== 'available')
                continue;
            const runEnd = run.start + run.length;
            if (range.start < runEnd && end > run.start) {
                context.addIssue({
                    code: 'custom',
                    message: 'A missing-font range cannot overlap an available-font style run.',
                    path: ['missingFonts', 'items', index, 'start'],
                });
                break;
            }
        }
        previousEnd = end;
    }
}
function deriveFontUsages(styleRuns) {
    const usages = [];
    for (const run of styleRuns) {
        if (run.font.status !== 'available')
            continue;
        const font = run.font.value;
        const existing = usages.find((usage) => usage.postScriptName === font.postScriptName);
        if (existing)
            existing.characterCount += run.length;
        else
            usages.push({ ...font, characterCount: run.length });
    }
    return usages;
}
function deriveMissingRanges(styleRuns) {
    const ranges = [];
    for (const run of styleRuns) {
        if (run.font.status === 'available')
            continue;
        const candidate = {
            start: run.start,
            length: run.length,
            reason: run.font.reason,
            message: run.font.message,
            fontName: run.font.fontName,
        };
        const previous = ranges.at(-1);
        if (previous && previous.start + previous.length === candidate.start && sameMissingIdentity(previous, candidate)) {
            previous.length += candidate.length;
        }
        else
            ranges.push(candidate);
    }
    return ranges;
}
function sameFontUsage(left, right) {
    return left.family === right.family && left.style === right.style &&
        left.postScriptName === right.postScriptName && left.characterCount === right.characterCount;
}
function sameMissingRange(left, right) {
    return left.start === right.start && left.length === right.length && sameMissingIdentity(left, right);
}
function validateExpectedCollection(collection, expected, collectionPath, equals, context) {
    if (collection.status === 'truncated' && collection.reason !== 'item_limit') {
        context.addIssue({
            code: 'custom',
            message: 'A fully scanned style-run collection cannot have scan-limited dependent summaries.',
            path: [collectionPath],
        });
        return;
    }
    const expectedItems = collection.status === 'complete' ? expected : expected.slice(0, collection.items.length);
    if (collection.status === 'complete' && collection.items.length !== expected.length) {
        context.addIssue({ code: 'custom', message: 'Complete summary count does not match style runs.', path: [collectionPath, 'items'] });
    }
    if (collection.status === 'truncated' && collection.total !== expected.length) {
        context.addIssue({ code: 'custom', message: 'Truncated summary total does not match style runs.', path: [collectionPath, 'total'] });
    }
    for (let index = 0; index < collection.items.length && index < expectedItems.length; index++) {
        if (!equals(collection.items[index], expectedItems[index])) {
            context.addIssue({
                code: 'custom',
                message: 'Summary items must match style-run aggregation in first-occurrence order.',
                path: [collectionPath, 'items', index],
            });
        }
    }
}
function validateVisibleFontPrefix(collection, visible, styleRuns, totalCharacters, context) {
    const comparableCount = Math.min(collection.items.length, visible.length);
    for (let index = 0; index < comparableCount; index++) {
        const actual = collection.items[index];
        const minimum = visible[index];
        if (actual.family !== minimum.family || actual.style !== minimum.style ||
            actual.postScriptName !== minimum.postScriptName || actual.characterCount < minimum.characterCount) {
            context.addIssue({
                code: 'custom',
                message: 'Font summaries must preserve visible style-run order, identity, and minimum usage.',
                path: ['fonts', 'items', index],
            });
        }
    }
    if (collection.items.length < Math.min(visible.length, TEXT_DETAIL_LIMITS.fonts)) {
        context.addIssue({
            code: 'custom',
            message: 'A font summary cannot omit fonts proven by visible style runs.',
            path: ['fonts', 'items'],
        });
    }
    validateDependentCollectionCount(collection, visible.length, styleRuns, totalCharacters, 'fonts', context);
}
function validateVisibleMissingPrefix(collection, visible, visibleRuns, styleRunCollection, totalCharacters, context) {
    const comparableCount = Math.min(collection.items.length, visible.length);
    const visibleEndsWithMissingFont = visibleRuns.at(-1)?.font.status === 'unavailable';
    for (let index = 0; index < comparableCount; index++) {
        const actual = collection.items[index];
        const expected = visible[index];
        const mayExtendIntoUnseenSuffix = visibleEndsWithMissingFont && index === visible.length - 1;
        const lengthMatches = mayExtendIntoUnseenSuffix
            ? actual.length >= expected.length
            : actual.length === expected.length;
        if (actual.start !== expected.start || !sameMissingIdentity(actual, expected) || !lengthMatches) {
            context.addIssue({
                code: 'custom',
                message: 'Missing-font summaries must preserve the normalized visible style-run prefix.',
                path: ['missingFonts', 'items', index],
            });
        }
    }
    if (collection.items.length < Math.min(visible.length, TEXT_DETAIL_LIMITS.missingFonts)) {
        context.addIssue({
            code: 'custom',
            message: 'A missing-font summary cannot omit ranges proven by visible style runs.',
            path: ['missingFonts', 'items'],
        });
    }
    validateDependentCollectionCount(collection, visible.length, styleRunCollection, totalCharacters, 'missingFonts', context);
}
function validateDependentCollectionCount(collection, visibleCount, styleRuns, totalCharacters, collectionPath, context) {
    if (collection.status === 'complete') {
        const itemLimit = TEXT_DETAIL_LIMITS[collectionPath];
        if (visibleCount > itemLimit) {
            context.addIssue({
                code: 'custom',
                message: 'A complete dependent summary cannot contain more visible entries than its return cap.',
                path: [collectionPath],
            });
        }
        return;
    }
    if (collection.reason !== 'item_limit')
        return;
    if (collection.total < visibleCount) {
        context.addIssue({
            code: 'custom',
            message: 'An item-limited dependent total cannot be below the count proven by visible style runs.',
            path: [collectionPath, 'total'],
        });
    }
    if (collection.total > totalCharacters) {
        context.addIssue({
            code: 'custom',
            message: 'A dependent entry count cannot exceed the content character count.',
            path: [collectionPath, 'total'],
        });
    }
    if (styleRuns.status === 'truncated' && styleRuns.reason === 'item_limit') {
        const unseenRunCount = styleRuns.total - styleRuns.items.length;
        if (!Number.isSafeInteger(unseenRunCount) || unseenRunCount < 0 ||
            visibleCount > Number.MAX_SAFE_INTEGER - unseenRunCount) {
            context.addIssue({
                code: 'custom',
                message: 'The exact unseen style-run count cannot be represented safely.',
                path: ['styleRuns', 'total'],
            });
            return;
        }
        const maxDependentTotal = visibleCount + unseenRunCount;
        if (collection.total > maxDependentTotal) {
            context.addIssue({
                code: 'custom',
                message: 'Dependent total exceeds visible entries plus the exact count of unseen style runs.',
                path: [collectionPath, 'total'],
            });
        }
    }
}
function addCharacterCount(runningTotal, value, totalCharacters, path, context) {
    if (value > totalCharacters || runningTotal > totalCharacters - value) {
        context.addIssue({
            code: 'custom',
            message: 'Returned character accounting cannot exceed content totalCharacters.',
            path,
        });
        return null;
    }
    return runningTotal + value;
}
function validateCharacterAccounting(fonts, missingFonts, totalCharacters, context) {
    let fontCharacters = 0;
    for (let index = 0; index < fonts.length; index++) {
        if (fontCharacters === null)
            break;
        fontCharacters = addCharacterCount(fontCharacters, fonts[index].characterCount, totalCharacters, ['fonts', 'items', index, 'characterCount'], context);
    }
    let missingCharacters = 0;
    for (let index = 0; index < missingFonts.length; index++) {
        if (missingCharacters === null)
            break;
        missingCharacters = addCharacterCount(missingCharacters, missingFonts[index].length, totalCharacters, ['missingFonts', 'items', index, 'length'], context);
    }
    if (fontCharacters !== null && missingCharacters !== null &&
        fontCharacters > totalCharacters - missingCharacters) {
        context.addIssue({
            code: 'custom',
            message: 'Returned available-font usage and missing-font ranges cannot double-count beyond content totalCharacters.',
            path: ['fonts', 'items'],
        });
    }
}
const textContentSchema = z.discriminatedUnion('status', [
    z.strictObject({
        status: z.literal('complete'),
        text: z.string().max(10_000),
    }),
    z.strictObject({
        status: z.literal('truncated'),
        text: z.string().max(10_000),
        totalCharacters: z.number().int().positive(),
    }),
]).superRefine((content, context) => {
    if (content.status === 'truncated' && content.totalCharacters <= content.text.length) {
        context.addIssue({
            code: 'custom',
            message: 'Truncated content totalCharacters must exceed text.length.',
            path: ['totalCharacters'],
        });
    }
});
const textFrameDetailsSchema = z.strictObject({
    kind: z.literal('text_frame'),
    illustratorType: z.literal('TextFrame'),
    content: textContentSchema,
    paragraphs: itemCountCollectionSchema(paragraphSchema, TEXT_DETAIL_LIMITS.paragraphs),
    styleRuns: scannedCollectionSchema(textStyleRunSchema, TEXT_DETAIL_LIMITS.styleRuns),
    fonts: scannedCollectionSchema(fontUsageSchema, TEXT_DETAIL_LIMITS.fonts),
    missingFonts: scannedCollectionSchema(missingFontSchema, TEXT_DETAIL_LIMITS.missingFonts),
}).superRefine((details, context) => {
    const totalCharacters = details.content.status === 'complete'
        ? details.content.text.length
        : details.content.totalCharacters;
    for (let index = 0; index < details.paragraphs.items.length; index++) {
        if (details.paragraphs.items[index].index !== index) {
            context.addIssue({
                code: 'custom',
                message: 'Paragraph indices must be contiguous and zero-based.',
                path: ['paragraphs', 'items', index, 'index'],
            });
        }
    }
    validateStyleRunPrefix(details.styleRuns, totalCharacters, context);
    validateMissingRanges(details.missingFonts.items, totalCharacters, details.styleRuns.items, context);
    validateCharacterAccounting(details.fonts.items, details.missingFonts.items, totalCharacters, context);
    if (details.styleRuns.status === 'truncated' && details.styleRuns.reason === 'item_limit' &&
        details.styleRuns.total > totalCharacters) {
        context.addIssue({
            code: 'custom',
            message: 'A positive-length style-run count cannot exceed content totalCharacters.',
            path: ['styleRuns', 'total'],
        });
    }
    const seenFontNames = [];
    for (let index = 0; index < details.fonts.items.length; index++) {
        const fontName = details.fonts.items[index].postScriptName;
        if (seenFontNames.includes(fontName)) {
            context.addIssue({
                code: 'custom',
                message: 'Font summaries must contain each PostScript name exactly once.',
                path: ['fonts', 'items', index, 'postScriptName'],
            });
        }
        seenFontNames.push(fontName);
    }
    if (details.styleRuns.status === 'complete') {
        validateExpectedCollection(details.fonts, deriveFontUsages(details.styleRuns.items), 'fonts', sameFontUsage, context);
        validateExpectedCollection(details.missingFonts, deriveMissingRanges(details.styleRuns.items), 'missingFonts', sameMissingRange, context);
    }
    else {
        validateVisibleFontPrefix(details.fonts, deriveFontUsages(details.styleRuns.items), details.styleRuns, totalCharacters, context);
        validateVisibleMissingPrefix(details.missingFonts, deriveMissingRanges(details.styleRuns.items), details.styleRuns.items, details.styleRuns, totalCharacters, context);
    }
    if (details.styleRuns.status === 'truncated' &&
        (details.styleRuns.reason === 'scan_limit' || details.styleRuns.reason === 'run_limit')) {
        for (const [path, collection] of [
            ['fonts', details.fonts],
            ['missingFonts', details.missingFonts],
        ]) {
            if (collection.status !== 'truncated' || collection.reason !== details.styleRuns.reason) {
                context.addIssue({
                    code: 'custom',
                    message: 'Scan-limited dependent summaries must carry the same truncation reason as styleRuns.',
                    path: [path],
                });
            }
        }
    }
    else {
        for (const [path, collection] of [
            ['fonts', details.fonts],
            ['missingFonts', details.missingFonts],
        ]) {
            if (collection.status === 'truncated' && collection.reason !== 'item_limit') {
                context.addIssue({
                    code: 'custom',
                    message: 'An item-limited complete scan cannot produce scan_limit or run_limit dependents.',
                    path: [path],
                });
            }
        }
    }
});
const availableLinkSchema = z.strictObject({
    status: z.literal('available'),
    value: z.strictObject({ path: z.string(), name: z.string(), exists: z.literal(true) }),
});
const unavailableLinkSchema = z.strictObject({
    status: z.literal('unavailable'),
    reason: z.enum(['link_file_missing', 'link_file_unavailable']),
    message: unavailableMessageSchema,
});
const linkedStateSchema = z.strictObject({ status: z.literal('available'), value: z.literal('linked') });
const unavailableStateSchema = z.strictObject({
    status: z.literal('unavailable'), reason: z.literal('link_state_unavailable'), message: unavailableMessageSchema,
});
const placedItemDetailsSchema = z.union([
    z.strictObject({
        kind: z.literal('placed_item'),
        illustratorType: z.literal('PlacedItem'),
        state: linkedStateSchema,
        link: z.union([availableLinkSchema, unavailableLinkSchema]),
    }),
    z.strictObject({
        kind: z.literal('placed_item'),
        illustratorType: z.literal('PlacedItem'),
        state: unavailableStateSchema,
        link: z.strictObject({
            status: z.literal('unavailable'), reason: z.literal('link_file_unavailable'), message: unavailableMessageSchema,
        }),
    }),
]);
const rasterItemDetailsSchema = z.union([
    z.strictObject({
        kind: z.literal('raster_item'),
        illustratorType: z.literal('RasterItem'),
        state: linkedStateSchema,
        link: z.union([availableLinkSchema, unavailableLinkSchema]),
    }),
    z.strictObject({
        kind: z.literal('raster_item'),
        illustratorType: z.literal('RasterItem'),
        state: z.strictObject({ status: z.literal('available'), value: z.literal('embedded') }),
        link: z.strictObject({ status: z.literal('not_applicable'), reason: z.literal('embedded_item') }),
    }),
    z.strictObject({
        kind: z.literal('raster_item'),
        illustratorType: z.literal('RasterItem'),
        state: unavailableStateSchema,
        link: z.strictObject({
            status: z.literal('unavailable'), reason: z.literal('link_file_unavailable'), message: unavailableMessageSchema,
        }),
    }),
]);
const otherDetailsSchema = z.strictObject({
    kind: z.literal('other'),
    reason: z.literal('unsupported_object_type'),
});
const objectDetailBaseShape = {
    ...objectSummarySchema.omit({ type: true }).shape,
    visibleBounds: boundsSchema,
    locked: z.boolean(),
    hidden: z.boolean(),
    editable: z.boolean(),
};
export const objectDetailSchema = z.union([
    z.strictObject({
        ...objectDetailBaseShape,
        type: z.literal('PathItem'),
        appearance: pathAppearanceSchema,
        details: otherDetailsSchema,
    }),
    z.strictObject({
        ...objectDetailBaseShape,
        type: z.literal('TextFrame'),
        appearance: textAppearanceSchema,
        details: textFrameDetailsSchema,
    }),
    z.strictObject({
        ...objectDetailBaseShape,
        type: z.literal('PlacedItem'),
        appearance: unsupportedAppearanceSchema,
        details: placedItemDetailsSchema,
    }),
    z.strictObject({
        ...objectDetailBaseShape,
        type: z.literal('RasterItem'),
        appearance: unsupportedAppearanceSchema,
        details: rasterItemDetailsSchema,
    }),
    z.strictObject({
        ...objectDetailBaseShape,
        type: z.string().regex(/^(?!PathItem$|TextFrame$|PlacedItem$|RasterItem$).+$/),
        appearance: unsupportedAppearanceSchema,
        details: otherDetailsSchema,
    }),
]);
export const objectDetailResultSchema = z.strictObject({
    document: documentContextSchema,
    item: objectDetailSchema,
});
const objectFiltersSchema = z.object({
    type: z.string().nullable(),
    layerPath: z.array(z.number().int().nonnegative()).min(1).nullable(),
    bounds: boundsSchema.nullable(),
    boundsMode: z.enum(['intersects', 'contained']),
});
const objectPageBaseSchema = z.object({
    document: documentContextSchema,
    filters: objectFiltersSchema,
    limit: z.number().int().min(1).max(200),
    items: z.array(objectSummarySchema),
});
export const objectPageSchema = z.discriminatedUnion('hasMore', [
    objectPageBaseSchema.extend({
        hasMore: z.literal(true),
        nextCursor: z.string().min(1),
        complete: z.literal(false),
        absenceConclusive: z.literal(false),
    }),
    objectPageBaseSchema.extend({
        hasMore: z.literal(false),
        nextCursor: z.null(),
        complete: z.literal(true),
        absenceConclusive: z.literal(true),
    }),
]);
export const layerNodeSchema = z.lazy(() => z.object({
    index: z.number().int().nonnegative(),
    path: z.array(z.number().int().nonnegative()).min(1),
    name: z.string(),
    zOrderPosition: z.number().int(),
    active: z.boolean(),
    visible: z.boolean(),
    locked: z.boolean(),
    printable: z.boolean(),
    preview: z.boolean(),
    dimPlacedImages: z.boolean(),
    effectiveVisible: z.boolean(),
    effectiveLocked: z.boolean(),
    effectivePrintable: z.boolean(),
    templateState: z.literal('unknown').describe('Template state is unavailable from the Illustrator Layer scripting API; create tools assume non_template.'),
    editable: z.boolean().describe('True when the layer and every ancestor are visible and unlocked (structural conditions only).'),
    editabilityBlockedReasons: z.array(layerStructuralReasonSchema)
        .describe('Structural blockers in production order: layer_hidden, ancestor_hidden, layer_locked, ancestor_locked. Empty when editable.'),
    layers: z.array(layerNodeSchema),
}));
const layerListSchema = z.object({
    document: documentContextSchema,
    complete: z.literal(true),
    layerCount: z.number().int().nonnegative(),
    layers: z.array(layerNodeSchema),
});
const documentListSchema = z.object({
    complete: z.literal(true),
    coordinateSpace: z.literal('illustrator_document'),
    unit: z.literal('pt'),
    application: illustratorApplicationEvidenceSchema,
    documentCount: z.number().int().nonnegative(),
    documents: z.array(z.object({
        keyVersion: z.literal(1),
        key: z.string().min(1),
        keyShort: documentKeyShortSchema,
        index: z.number().int().nonnegative(),
        name: z.string(),
        path: z.string().nullable(),
        fileRevision: z.string().nullable(),
        saved: z.boolean(),
        colorSpace: z.enum(['RGB', 'CMYK', 'unknown']),
        active: z.boolean(),
        artboards: z.array(z.object({
            index: z.number().int().nonnegative(),
            name: z.string(),
            bounds: boundsSchema,
            active: z.boolean(),
        })),
    })),
});
const selectionResultSchema = z.object({
    document: documentContextSchema,
    items: z.array(z.object({
        uuid: z.string().min(1),
        type: z.string().min(1),
        name: z.string(),
        bounds: boundsSchema,
    })),
});
const swatchProcessColorSchema = z.discriminatedUnion('model', [
    noneColorSummarySchema,
    grayColorSummarySchema,
    rgbColorSummarySchema,
    cmykColorSummarySchema,
    labColorSummarySchema,
]);
const swatchSpotColorSchema = z.strictObject({
    model: z.literal('spot'),
    name: z.string(),
    tint: percentSchema,
    colorType: z.enum(['spot', 'registration', 'unknown']),
    baseColor: swatchProcessColorSchema,
});
const swatchGradientStopColorSchema = z.discriminatedUnion('model', [
    grayColorSummarySchema,
    rgbColorSummarySchema,
    cmykColorSummarySchema,
    labColorSummarySchema,
    swatchSpotColorSchema,
]);
const swatchGradientColorSchema = z.strictObject({
    model: z.literal('gradient'),
    name: z.string(),
    type: z.enum(['linear', 'radial']),
    stops: z.array(z.strictObject({
        rampPoint: percentSchema,
        midPoint: finiteNumberSchema.min(13).max(87),
        opacity: percentSchema,
        color: swatchGradientStopColorSchema,
    })).min(2).max(32),
});
const swatchColorSchema = z.discriminatedUnion('model', [
    ...swatchProcessColorSchema.options,
    swatchSpotColorSchema,
    swatchGradientColorSchema,
    patternColorSummarySchema,
    unknownColorSummarySchema,
]);
const swatchSummarySchema = z.strictObject({
    index: z.number().int().nonnegative(),
    name: z.string(),
    color: requiredAvailabilitySchema(swatchColorSchema, z.literal('color_unavailable')),
});
export const swatchListSchema = z.strictObject({
    document: documentContextSchema,
    complete: z.literal(true),
    swatchCount: z.number().int().nonnegative().max(512),
    swatches: z.array(swatchSummarySchema).max(512),
}).superRefine((value, context) => {
    if (value.swatchCount !== value.swatches.length) {
        context.addIssue({
            code: 'custom',
            message: 'swatchCount must equal swatches.length.',
            path: ['swatchCount'],
        });
    }
    for (let index = 0; index < value.swatches.length; index++) {
        if (value.swatches[index].index !== index) {
            context.addIssue({
                code: 'custom',
                message: 'Swatch indices must be contiguous and zero-based.',
                path: ['swatches', index, 'index'],
            });
        }
    }
});
const commandStatusBaseShape = {
    commandId: z.string().min(1),
    message: z.string().optional(),
};
const commandExecutionIdentityShape = {
    executionControllerProcessGroupId: z.number().int().safe().positive(),
    executionNonce: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
    executionState: z.literal('prepared'),
};
const indeterminateTransactionStatusSchema = z.discriminatedUnion('phase', [
    z.strictObject({
        state: z.literal('indeterminate'),
        phase: z.enum(['preflight', 'plan', 'apply', 'verify']),
        rollback: z.strictObject({ status: z.literal('not_started') }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('indeterminate'),
        phase: z.literal('rollback'),
        rollback: z.strictObject({ status: z.enum(['verified', 'failed', 'indeterminate']) }),
        audit: mutationAuditSchema,
    }),
]).superRefine((transaction, context) => {
    let pending = null;
    let lastExecuted = null;
    for (let index = 0; index < transaction.audit.length; index++) {
        const event = transaction.audit[index];
        if (event.sequence !== index) {
            context.addIssue({
                code: 'custom',
                message: 'Mutation audit sequence numbers must be contiguous.',
                path: ['audit', index, 'sequence'],
            });
        }
        if (event.event === 'started') {
            pending = event.phase;
            lastExecuted = event.phase;
        }
        else if (event.event === 'succeeded' || event.event === 'failed') {
            if (pending === event.phase)
                pending = null;
            lastExecuted = event.phase;
        }
    }
    if (!isMutationAuditPrefix(transaction.audit)) {
        context.addIssue({
            code: 'custom',
            message: 'Durable transaction audit is not a valid mutation-state prefix.',
            path: ['audit'],
        });
    }
    const phase = pending ?? lastExecuted;
    if (phase !== transaction.phase) {
        context.addIssue({
            code: 'custom',
            message: 'Indeterminate phase must match the latest durable audit phase.',
            path: ['phase'],
        });
        return;
    }
    if (transaction.phase === 'rollback') {
        const lastRollback = [...transaction.audit].reverse().find((event) => event.phase === 'rollback');
        let expectedStatus = 'indeterminate';
        if (pending !== 'rollback' && lastRollback?.event === 'succeeded')
            expectedStatus = 'verified';
        if (pending !== 'rollback' && lastRollback?.event === 'failed' && lastRollback.reasonCode === 'rollback_failed') {
            expectedStatus = 'failed';
        }
        if (transaction.rollback.status !== expectedStatus) {
            context.addIssue({
                code: 'custom',
                message: 'Rollback reconciliation status must match the latest durable rollback event.',
                path: ['rollback', 'status'],
            });
        }
    }
});
const terminalCommandStateSchema = z.enum(['completed', 'failed']);
const nonterminalCommandStateSchema = z.enum(['running', 'unknown']);
export const commandStatusSchema = z.union([
    z.strictObject({
        ...commandStatusBaseShape,
        ...commandExecutionIdentityShape,
        state: terminalCommandStateSchema,
        executionStatus: z.literal('inactive'),
        canAbandon: z.literal(false),
    }),
    z.strictObject({
        ...commandStatusBaseShape,
        state: terminalCommandStateSchema,
        executionStatus: z.literal('inactive'),
        canAbandon: z.literal(false),
        executionRecord: z.literal('compacted'),
    }),
    z.strictObject({
        ...commandStatusBaseShape,
        state: nonterminalCommandStateSchema,
        executionStatus: z.literal('unknown'),
        canAbandon: z.literal(false),
        transaction: indeterminateTransactionStatusSchema.optional(),
    }),
    z.strictObject({
        ...commandStatusBaseShape,
        ...commandExecutionIdentityShape,
        state: nonterminalCommandStateSchema,
        executionStatus: z.enum(['active', 'unknown']),
        canAbandon: z.literal(false),
        transaction: indeterminateTransactionStatusSchema.optional(),
    }),
    z.strictObject({
        ...commandStatusBaseShape,
        ...commandExecutionIdentityShape,
        state: nonterminalCommandStateSchema,
        executionStatus: z.literal('inactive'),
        canAbandon: z.boolean(),
        canReleaseUnverified: z.boolean().optional(),
        transaction: indeterminateTransactionStatusSchema.optional(),
    }),
    z.strictObject({
        ...commandStatusBaseShape,
        state: z.literal('unknown'),
        executionStatus: z.literal('inactive'),
        canAbandon: z.literal(false),
        executionRecord: z.literal('released_unverified'),
        documentState: z.literal('unverified'),
        releasedAt: z.string().min(1),
        reasonCode: z.enum(['adapter_unresolved', 'result_missing', 'host_indeterminate', 'host_failed_unproven', 'result_unverifiable']),
    }),
]);
export const SERVER_INSTRUCTIONS = [
    'Mutations are two-step: call the tool with apply:false to get a plan, then apply with the plan\'s next_call arguments when present (otherwise apply:true, the before/after values the plan returned, and a new lowercase UUID v4 command_id); resend the same command_id only to retry that same apply.',
    'Bind every mutation to the full document key from illustrator_get_context or illustrator_list_documents, and read it again after any save, since keys change.',
    'Call tools one at a time: Illustrator handles a single command at once, so parallel calls are refused.',
    'A timeout or indeterminate result blocks later mutations; resolve it with illustrator_reconcile (or the matching reconcile tool) before continuing.',
    'Overwriting a saved file requires a verified backup from illustrator_create_backup.',
].join('\n');
export function createServer(operations, mutationAdapters = operations.getMutationAdapterRegistry()) {
    if (mutationAdapters !== operations.getMutationAdapterRegistry()) {
        throw new Error('MCP server and Illustrator operations must share the exact sealed mutation adapter registry.');
    }
    const server = new McpServer({ name: 'illustrator-studio-mcp', version: packageVersion }, { instructions: SERVER_INSTRUCTIONS });
    installSharedToolSchemas(server, mutationAdapters);
    server.registerTool('illustrator_get_context', {
        title: 'Get Illustrator Context',
        description: 'Read the active Illustrator document context without modifying it. Includes keyShort (accepted as expected_document_key), mutationProfile, and the application {bundleId, version, channel} that answered.',
        inputSchema: {},
        outputSchema: { result: documentContextWithApplicationSchema },
        annotations: READ_ONLY,
    }, async () => text(await operations.getContext()));
    server.registerTool('illustrator_list_documents', {
        title: 'List Illustrator Documents and Artboards',
        description: 'Read every open document and artboard in Illustrator collection order. Returns a complete, unpaginated snapshot without modifying document state, plus the application {bundleId, version, channel} that answered.',
        inputSchema: {},
        outputSchema: { result: documentListSchema },
        annotations: READ_ONLY,
    }, async () => text(await operations.listDocuments()));
    server.registerTool('illustrator_list_layers', {
        title: 'List Illustrator Layers',
        description: 'Read the complete active-document layer hierarchy and conservative write-target safety without modifying Illustrator state.',
        inputSchema: {},
        outputSchema: { result: layerListSchema },
        annotations: READ_ONLY,
    }, async () => text(await operations.listLayers()));
    server.registerTool('illustrator_list_swatches', {
        title: 'List Illustrator Swatches',
        description: 'Read the complete active-document swatch collection, including process, Spot, Gradient, and Pattern definitions, without modifying Illustrator state.',
        inputSchema: {
            expected_document_key: z.string().min(1).max(16_384),
        },
        outputSchema: { result: swatchListSchema },
        annotations: READ_ONLY,
    }, async (params) => text(await operations.listSwatches({
        expectedDocumentKey: params.expected_document_key,
    })));
    server.registerTool('illustrator_list_objects', {
        title: 'List Illustrator Objects',
        description: 'List native PageItem UUIDs in stable collection order. Follow nextCursor until hasMore=false before concluding an object is absent.',
        inputSchema: {
            expected_document_key: z.string().min(1).max(16_384),
            limit: z.number().int().min(1).max(200).default(50),
            cursor: z.string().min(1).max(32_768).optional(),
            type: z.string().min(1).max(255).optional(),
            layer_path: z.array(z.number().int().nonnegative()).min(1).max(64).optional(),
            bounds: boundsSchema.optional(),
            bounds_mode: z.enum(['intersects', 'contained']).default('intersects'),
        },
        outputSchema: { result: objectPageSchema },
        annotations: READ_ONLY,
    }, async (params) => text(await operations.listObjects({
        expectedDocumentKey: params.expected_document_key,
        limit: params.limit,
        ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
        ...(params.type === undefined ? {} : { type: params.type }),
        ...(params.layer_path === undefined ? {} : { layerPath: params.layer_path }),
        ...(params.bounds === undefined ? {} : { bounds: toBounds(params.bounds) }),
        boundsMode: params.bounds_mode,
    })));
    server.registerTool('illustrator_get_object', {
        title: 'Get Illustrator Object',
        description: 'Get one PageItem by native UUID with bounded type-specific text, font, link, and appearance details in an explicitly bound document.',
        inputSchema: {
            expected_document_key: z.string().min(1).max(16_384),
            uuid: z.string().min(1).max(255),
        },
        outputSchema: { result: objectDetailResultSchema },
        annotations: READ_ONLY,
    }, async (params) => text(await operations.getObject({
        expectedDocumentKey: params.expected_document_key,
        uuid: params.uuid,
    })));
    const explicitImageScopeSchema = z.strictObject({
        mode: z.literal('objects'),
        uuids: z.array(z.string().min(1).max(255)).min(1).max(50),
    }).superRefine((value, context) => {
        const seen = new Set();
        for (let index = 0; index < value.uuids.length; index++) {
            const uuid = value.uuids[index];
            if (seen.has(uuid)) {
                context.addIssue({ code: 'custom', message: 'Image UUIDs must be unique.', path: ['uuids', index] });
            }
            seen.add(uuid);
        }
    });
    server.registerTool('illustrator_preflight_images', {
        title: 'Preflight Illustrator Images',
        description: 'Read linked and embedded image file identity, SHA-256, source/current color facts, native and effective PPI, and structured warnings without modifying Illustrator. Follow nextCursor until hasMore=false before concluding an image is absent.',
        inputSchema: {
            expected_document_key: z.string().min(1).max(16_384),
            minimum_effective_ppi: z.number().finite().positive().max(100_000),
            scope: z.discriminatedUnion('mode', [
                z.strictObject({
                    mode: z.literal('document'),
                    limit: z.number().int().min(1).max(50).default(20),
                    cursor: z.string().min(1).max(32_768).optional(),
                }),
                explicitImageScopeSchema,
            ]),
        },
        outputSchema: { result: imagePreflightPageSchema },
        annotations: READ_ONLY,
    }, async (params) => text(await operations.preflightImages({
        expectedDocumentKey: params.expected_document_key,
        minimumEffectivePpi: params.minimum_effective_ppi,
        scope: params.scope.mode === 'document'
            ? {
                mode: 'document',
                limit: params.scope.limit,
                ...(params.scope.cursor === undefined ? {} : { cursor: params.scope.cursor }),
            }
            : { mode: 'objects', uuids: params.scope.uuids },
    })));
    const uniqueColorSpaces = (values, context, path) => {
        const seen = new Set();
        for (let index = 0; index < values.length; index++) {
            const value = values[index];
            if (seen.has(value))
                context.addIssue({ code: 'custom', message: 'Color spaces must be unique.', path: [path, index] });
            seen.add(value);
        }
    };
    const printConditionsInputSchema = z.strictObject({
        minimum_effective_ppi: z.number().finite().positive().max(100_000),
        minimum_stroke_width_pt: z.number().finite().nonnegative().max(10_000),
        minimum_raster_effect_ppi: z.number().finite().positive().max(2_400),
        required_bleed_pt: z.strictObject({
            top: z.number().finite().nonnegative().max(10_000),
            right: z.number().finite().nonnegative().max(10_000),
            bottom: z.number().finite().nonnegative().max(10_000),
            left: z.number().finite().nonnegative().max(10_000),
        }),
        allowed_document_color_spaces: z.array(z.enum(['RGB', 'CMYK'])).min(1).max(2),
        allowed_image_color_spaces: z.array(z.enum(['RGB', 'CMYK', 'Gray', 'Lab', 'Indexed', 'unknown'])).min(1).max(6),
        allow_spot_colors: z.boolean(),
        allow_overprint: z.boolean(),
        allow_transparency: z.boolean(),
        require_linked_image_icc: z.boolean(),
    }).superRefine((value, context) => {
        uniqueColorSpaces(value.allowed_document_color_spaces, context, 'allowed_document_color_spaces');
        uniqueColorSpaces(value.allowed_image_color_spaces, context, 'allowed_image_color_spaces');
    });
    server.registerTool('illustrator_preflight_print', {
        title: 'Preflight Illustrator Print Document',
        description: 'Read a bounded complete print-preflight snapshot across document color, used inks, overprint, transparency, raster effects, bleed availability, artboard geometry, strokes, fonts, and images. Unavailable or truncated required checks can never produce pass.',
        inputSchema: {
            expected_document_key: z.string().min(1).max(16_384),
            conditions: printConditionsInputSchema,
        },
        outputSchema: { result: printPreflightResultSchema },
        annotations: READ_ONLY,
    }, async (params) => {
        const conditions = printPreflightConditionsSchema.parse({
            minimumEffectivePpi: params.conditions.minimum_effective_ppi,
            minimumStrokeWidthPt: params.conditions.minimum_stroke_width_pt,
            minimumRasterEffectPpi: params.conditions.minimum_raster_effect_ppi,
            requiredBleedPt: params.conditions.required_bleed_pt,
            allowedDocumentColorSpaces: params.conditions.allowed_document_color_spaces,
            allowedImageColorSpaces: params.conditions.allowed_image_color_spaces,
            allowSpotColors: params.conditions.allow_spot_colors,
            allowOverprint: params.conditions.allow_overprint,
            allowTransparency: params.conditions.allow_transparency,
            requireLinkedImageIcc: params.conditions.require_linked_image_icc,
        });
        return text(await operations.preflightPrint({
            expectedDocumentKey: params.expected_document_key,
            conditions,
        }));
    });
    server.registerTool('illustrator_extract_design_tokens', {
        title: 'Extract Illustrator Design Tokens',
        description: 'Read-only aggregation of used colors (RGB/CMYK/Gray/Lab/Spot/Gradient with usage counts and swatch names), fonts (PostScript name, sizes), font sizes, and stroke widths across the bound document, as JSON or CSS custom properties. Line height is not collected. The result states complete=false with reasons when any bounded read was truncated.',
        inputSchema: {
            expected_document_key: z.string().min(1).max(16_384),
            format: z.enum(['json', 'css']).default('json'),
        },
        outputSchema: { result: designTokensResultSchema },
        annotations: READ_ONLY,
    }, async (params) => text(await operations.extractDesignTokens({
        expectedDocumentKey: params.expected_document_key,
        format: params.format,
    })));
    server.registerTool('illustrator_find_color_usages', {
        title: 'Find Illustrator Color Usages',
        description: 'Read-only, snapshot-bound search for matching PathItem fill/stroke, TextFrame fill/stroke, Gradient stops, and swatches. Matching is by exact swatch name or same-space channel/Delta E 76 tolerance; CMYK and Spot Delta E are rejected instead of implicitly converting color spaces. Follow next_cursor until has_more=false before concluding a usage is absent.',
        inputSchema: {
            expected_document_key: z.string().min(1).max(16_384),
            match: colorMatchSchema,
            limit: z.number().int().min(1).max(200).default(50),
            cursor: z.string().min(1).max(32_768).optional(),
        },
        outputSchema: { result: colorUsagePageSchema },
        annotations: READ_ONLY,
    }, async (params) => text(await operations.findColorUsages({
        expectedDocumentKey: params.expected_document_key,
        match: params.match,
        limit: params.limit,
        ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
    })));
    server.registerTool('illustrator_plan_color_replacement', {
        title: 'Plan Illustrator Color Replacement',
        description: 'Read-only replacement planning over a stable color snapshot. Returns a plan-only illustrator_mutate_batch request for supported PathItem appearance and uniform complete RGB text-fill targets, paged at the batch maximum. Gradient-stop, swatch-resource, text-stroke, mixed/incomplete text, and color-space mismatches are returned with exact fail-closed reasons.',
        inputSchema: {
            expected_document_key: z.string().min(1).max(16_384),
            match: colorMatchSchema,
            replacement: replacementColorSchema,
            limit: z.number().int().min(2).max(16).default(16),
            cursor: z.string().min(1).max(32_768).optional(),
        },
        outputSchema: { result: colorReplacementPlanSchema },
        annotations: READ_ONLY,
    }, async (params) => text(await operations.planColorReplacement({
        expectedDocumentKey: params.expected_document_key,
        match: params.match,
        replacement: params.replacement,
        limit: params.limit,
        ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
    })));
    server.registerTool('illustrator_check_text_consistency', {
        title: 'Check Illustrator Text Consistency',
        description: 'Read-only scan of every TextFrame for placeholder text (fixed catalogue), trailing and consecutive whitespace, consecutively repeated Latin words, and case / full-width vs half-width spelling variants of the same token across the document. Rules are fixed and documented; nothing is inferred beyond them.',
        inputSchema: {
            expected_document_key: z.string().min(1).max(16_384),
        },
        outputSchema: { result: textConsistencyResultSchema },
        annotations: READ_ONLY,
    }, async (params) => text(await operations.checkTextConsistency({
        expectedDocumentKey: params.expected_document_key,
    })));
    server.registerTool('illustrator_check_contrast', {
        title: 'Check WCAG Contrast',
        description: 'WCAG 2.x contrast ratio and AA / AAA judgement for explicit color pairs (mode "pairs": RGB, hex, Gray, or naive non-color-managed CMYK; optional text size and weight select the large-text thresholds). Computed in Node without contacting Illustrator. mode "auto_detect" reads the bound document (structure snapshot, layers, clipping flags) and pairs every visible TextFrame with the nearest filled PathItem behind it by document order, clipping regions applied; it is supported only while the screen is unlocked and Illustrator is frontmost (measured F0 profile) and otherwise returns unsupported with the observed host state.',
        inputSchema: {
            expected_document_key: z.string().min(1).max(16_384),
            request: contrastRequestSchema,
        },
        outputSchema: { result: contrastResultSchema },
        annotations: READ_ONLY,
    }, async (params) => text(await operations.checkContrast(params.request.mode === 'auto_detect'
        ? { expectedDocumentKey: params.expected_document_key, mode: 'auto_detect' }
        : {
            expectedDocumentKey: params.expected_document_key,
            mode: 'pairs',
            pairs: params.request.pairs.map((pair) => ({
                id: pair.id ?? null,
                foreground: pair.foreground,
                background: pair.background,
                text: pair.text === undefined ? null : { sizePt: pair.text.size_pt, bold: pair.text.bold },
            })),
        })));
    server.registerTool('illustrator_compare_images', {
        title: 'Compare Existing PNG Images',
        description: 'Compare two existing same-size 8-bit RGBA non-interlaced PNG files entirely in Node, without contacting Illustrator. Returns byte-bound provenance, deterministic straight-RGBA difference metrics, and before/after/diff MCP image content. Files are never resized, color-converted, modified, retained, or deleted; changed, malformed, oversized, unsupported, or dimension-mismatched inputs are rejected.',
        inputSchema: {
            before_path: z.string().min(1).max(16_384),
            after_path: z.string().min(1).max(16_384),
            threshold: z.number().int().min(0).max(255).default(0),
        },
        outputSchema: { result: visualDiffResultSchema },
        annotations: READ_ONLY,
    }, async (params) => {
        const output = await comparePngImages({
            beforePath: params.before_path,
            afterPath: params.after_path,
            threshold: params.threshold,
        });
        return {
            content: [
                { type: 'text', text: JSON.stringify(output.result, null, 2) },
                { type: 'text', text: 'before' },
                { type: 'image', data: output.images.before.toString('base64'), mimeType: 'image/png' },
                { type: 'text', text: 'after' },
                { type: 'image', data: output.images.after.toString('base64'), mimeType: 'image/png' },
                { type: 'text', text: 'diff' },
                { type: 'image', data: output.images.diff.toString('base64'), mimeType: 'image/png' },
            ],
            structuredContent: { result: output.result },
        };
    });
    server.registerTool('illustrator_capture_preview', {
        title: 'Capture Illustrator Preview',
        description: `Render one explicit rectangle of the bound document to a PNG and return it as MCP image content, without changing the document. bounds is [left, top, right, bottom] in document points (the coordinates of artboard and object bounds), integer edges, at most ${PREVIEW_MAX_SIDE_PT} pt per side, entirely inside one artboard; the image is 72 ppi (1 px per pt) and anti-aliased, with a transparent background: RGBA when the range has any uncovered pixel, RGB (image.pixelFormat rgb8_opaque) when artwork covers every pixel. Only a document with saved=false (unsaved changes, or new and never saved) is captured: Illustrator's capture marks a saved document as changed, so a saved document is refused before anything is written. Requires stable Illustrator 30.8.1 frontmost with the screen unlocked. The saved state, document key, item and layer counts, and artboards are re-read after the capture; any change is an error and no image is returned. The temporary PNG is written to a private directory and removed.`,
        inputSchema: {
            expected_document_key: z.string().min(1).max(16_384),
            bounds: previewBoundsSchema,
        },
        outputSchema: { result: previewResultSchema },
        annotations: READ_ONLY,
    }, async (params) => {
        const output = await operations.capturePreview({
            expectedDocumentKey: params.expected_document_key,
            bounds: params.bounds,
        });
        return {
            content: [
                { type: 'text', text: JSON.stringify(output.result, null, 2) },
                { type: 'image', data: output.png.toString('base64'), mimeType: 'image/png' },
            ],
            structuredContent: { result: output.result },
        };
    });
    server.registerTool('illustrator_list_selection', {
        title: 'List Illustrator Selection',
        description: 'Read selected objects using Illustrator native UUIDs. This tool never writes metadata.',
        inputSchema: {},
        outputSchema: { result: selectionResultSchema },
        annotations: READ_ONLY,
    }, async () => text(await operations.listSelection()));
    server.registerTool('illustrator_capture_structure_snapshot', {
        title: 'Capture Illustrator Structure Snapshot',
        description: 'Read a complete UUID-keyed structure snapshot (bounds, appearance, text, layer, parent, order, lock/hidden state, artboards) of the bound document and hold it in MCP process memory for illustrator_diff_structure. Never modifies Illustrator. Documents above the item limit are rejected.',
        inputSchema: {
            expected_document_key: z.string().min(1).max(16_384),
        },
        outputSchema: { result: structureSnapshotSummarySchema },
        annotations: READ_ONLY,
    }, async (params) => text(await operations.captureStructureSnapshot({
        expectedDocumentKey: params.expected_document_key,
    })));
    const uniqueScopeUuids = (value, context) => {
        const seen = new Set();
        for (let index = 0; index < value.uuids.length; index++) {
            const uuid = value.uuids[index];
            if (seen.has(uuid))
                context.addIssue({ code: 'custom', message: 'Scope UUIDs must be unique.', path: ['uuids', index] });
            seen.add(uuid);
        }
    };
    server.registerTool('illustrator_diff_structure', {
        title: 'Diff Illustrator Structure',
        description: 'Compare a held base structure snapshot with the live document (default) or another held snapshot and classify every native UUID as added, removed, moved, changed, or indeterminate with bounds/style/text/hierarchy/attribute changes under an explicit point tolerance. Returns a summary, document/artboard changes, the first page of entries, and a diff handle for illustrator_read_structure_diff. Follow nextCursor until hasMore=false before concluding an object is unchanged.',
        inputSchema: {
            expected_document_key: z.string().min(1).max(16_384),
            base_snapshot_id: structureSnapshotIdSchema,
            target: z.discriminatedUnion('mode', [
                z.strictObject({ mode: z.literal('live') }),
                z.strictObject({ mode: z.literal('snapshot'), snapshot_id: structureSnapshotIdSchema }),
            ]).default({ mode: 'live' }),
            tolerance_pt: z.number().finite().min(0).max(STRUCTURE_DIFF_MAX_TOLERANCE_PT).default(STRUCTURE_DIFF_DEFAULT_TOLERANCE_PT),
            scope: z.discriminatedUnion('mode', [
                z.strictObject({ mode: z.literal('document') }),
                z.strictObject({
                    mode: z.literal('objects'),
                    uuids: z.array(z.string().min(1).max(255)).min(1).max(STRUCTURE_SNAPSHOT_LIMITS.scopeUuids),
                }).superRefine(uniqueScopeUuids),
            ]).default({ mode: 'document' }),
            limit: z.number().int().min(1).max(STRUCTURE_SNAPSHOT_LIMITS.pageLimit).default(50),
        },
        outputSchema: { result: structureDiffPageSchema },
        annotations: READ_ONLY,
    }, async (params) => text(await operations.diffStructure({
        expectedDocumentKey: params.expected_document_key,
        baseSnapshotId: params.base_snapshot_id,
        target: params.target.mode === 'live' ? { mode: 'live' } : { mode: 'snapshot', snapshotId: params.target.snapshot_id },
        tolerancePt: params.tolerance_pt,
        scope: params.scope.mode === 'document' ? { mode: 'document' } : { mode: 'objects', uuids: params.scope.uuids },
        limit: params.limit,
    })));
    server.registerTool('illustrator_read_structure_diff', {
        title: 'Read Illustrator Structure Diff',
        description: 'Page through the entries of a held structure diff by diff handle without touching Illustrator. Follow nextCursor until hasMore=false.',
        inputSchema: {
            diff_id: structureDiffIdSchema,
            limit: z.number().int().min(1).max(STRUCTURE_SNAPSHOT_LIMITS.pageLimit).default(50),
            cursor: z.string().min(1).max(32_768).optional(),
        },
        outputSchema: { result: structureDiffPageSchema },
        annotations: READ_ONLY,
    }, async (params) => text(await operations.readStructureDiff({
        diffId: params.diff_id,
        limit: params.limit,
        ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
    })));
    server.registerTool('illustrator_list_text_styles', {
        title: 'List Illustrator Paragraph and Character Styles',
        description: 'Read-only. Lists every named paragraph and character style of the bound document with its collection index and the attributes it actually defines (an attribute the style does not define is reported as undefined rather than guessed), and names that resolve to more than one style are reported as conflicts — those names are refused by every style mutation. With `target`, also reports a bounded character range of one TextFrame: each character\'s resolved attributes, the styles the range reports as applied, and the override difference against that style, limited to the fields the style defines. The applied-style read is not covered by measured host evidence and carries its own status, so it never silently becomes a refusal. Style resources and text are never written by this tool.',
        inputSchema: {
            expected_document_key: z.string().min(1).max(16_384),
            target: z.strictObject({
                uuid: z.string().min(1).max(255),
                start: z.number().int().safe().nonnegative().optional(),
                end: z.number().int().safe().nonnegative().optional(),
            }).optional(),
        },
        outputSchema: { result: textStyleListSchema },
        annotations: READ_ONLY,
    }, async (params) => text(await operations.listTextStyles({
        expectedDocumentKey: params.expected_document_key,
        ...(params.target === undefined ? {} : { target: params.target }),
    })));
    server.registerTool('illustrator_find_fonts', {
        title: 'Find Installed Illustrator Fonts by PostScript Name',
        description: 'Read-only. Looks up up to ' + FONT_LOOKUP_MAX_NAMES + ' PostScript names exactly among the fonts installed for Illustrator and returns, per name in request order, either `installed` with the font\'s PostScript name, family and style, or `not_installed`. There is no fuzzy match and no fallback: a name that is not installed, or that the host would answer with a different font, is `not_installed`. Needs no open document and touches none. Use the returned PostScript name with illustrator_set_text_style or illustrator_replace_font. Composite fonts are not supported for font writes.',
        inputSchema: {
            post_script_names: z.array(fontPostScriptNameSchema).min(1).max(FONT_LOOKUP_MAX_NAMES),
        },
        outputSchema: { result: fontLookupResultSchema },
        annotations: READ_ONLY,
    }, async (params) => text(await operations.findFonts({ postScriptNames: params.post_script_names })));
    server.registerTool('illustrator_get_path_points', {
        title: 'Get Illustrator Path Points',
        description: 'Read-only. Returns the closed flag and every path point (anchor, leftDirection, rightDirection as [x, y] in points in Illustrator document coordinates, and pointType corner/smooth) of one PathItem directly on a layer, bound by document key and native UUID, with its layer path, lock and visibility state, and the reasons illustrator_edit_path_points would refuse to edit it. Pass `target.path` unchanged as expected_path to illustrator_edit_path_points. Group members, CompoundPathItem members, clipping paths, guides, and paths with more than ' + PATH_EDIT_MAX_POINTS + ' points are refused.',
        inputSchema: {
            expected_document_key: z.string().min(1).max(16_384),
            uuid: z.string().min(1).max(255),
        },
        outputSchema: { result: getPathPointsResultSchema },
        annotations: READ_ONLY,
    }, async (params) => text(await operations.getPathPoints({
        expectedDocumentKey: params.expected_document_key,
        uuid: params.uuid,
    })));
    server.registerTool('illustrator_get_area_text_options', {
        title: 'Get Illustrator Area-Text Options',
        description: 'Read-only. Returns the column and row layout (columnCount, columnGutter, rowCount, rowGutter, flowLinksHorizontally), frame bounds and matrix, contents, and fit of one unthreaded, horizontal AREATEXT frame directly on a layer, bound by document key and native UUID, with its lock and visibility state and the reasons illustrator_set_area_text_columns would refuse to edit it. `fit` is proved from the visible lines: `fits` (every story character visible), `overflows` (only a leading part is visible), or `indeterminate` (unprovable; the edit refuses it). Illustrator\'s own `overflows` flag is not used because it does not read back on the measured host. Area inset and threading are not reported. Threaded, vertical, and grouped frames are refused.',
        inputSchema: {
            expected_document_key: z.string().min(1).max(16_384),
            target_uuid: z.string().min(1).max(255),
        },
        outputSchema: { result: getAreaTextOptionsResultSchema },
        annotations: READ_ONLY,
    }, async (params) => text(await operations.getAreaTextOptions({
        expectedDocumentKey: params.expected_document_key,
        targetUuid: params.target_uuid,
    })));
    for (const adapter of mutationAdapters.list()) {
        server.registerTool(adapter.tool.name, {
            title: adapter.tool.title,
            description: adapter.tool.description,
            inputSchema: adapter.tool.inputSchema,
            outputSchema: z.object({
                result: adapter.tool.outputSchema,
                ...(NEXT_CALL_BUILDERS[adapter.tool.name] === undefined ? {} : { next_call: nextCallSchema.optional() }),
            }),
            annotations: adapter.tool.annotations,
        }, async (params) => {
            const checked = await adapter.tool.publicInputSchema.safeParseAsync(params, { error: toolArgumentIssueMessage });
            if (!checked.success)
                throw new Error(formatToolArgumentError(adapter.tool.name, checked.error.issues));
            const response = await operations.executeAdapter(adapter.operation, adapter.tool.normalizePublicInput(params));
            const nextCall = buildNextCall(adapter.tool, params, response);
            if (nextCall === undefined)
                return text(response);
            const result = text(response);
            return {
                content: [...result.content, { type: 'text', text: JSON.stringify({ next_call: nextCall }, null, 2) }],
                structuredContent: { ...result.structuredContent, next_call: nextCall },
            };
        });
    }
    server.registerTool(m6P0RecipeToolContract.name, {
        title: m6P0RecipeToolContract.title,
        description: m6P0RecipeToolContract.description,
        inputSchema: m6P0RecipeToolContract.inputSchema,
        outputSchema: z.object({ result: m6P0RecipeToolContract.outputSchema }),
        annotations: m6P0RecipeToolContract.annotations,
    }, async (params) => text(await operations.runM6P0AppearancePreviewRecipe(m6P0RecipeToolContract.normalizePublicInput(params))));
    server.registerTool(recipeToolContracts.save.name, {
        title: recipeToolContracts.save.title,
        description: recipeToolContracts.save.description,
        inputSchema: recipeToolContracts.save.inputSchema,
        outputSchema: { result: recipeToolContracts.save.outputSchema },
        annotations: recipeToolContracts.save.annotations,
    }, async (params) => text(await operations.saveRecipe({ recipe: params.recipe })));
    server.registerTool(recipeToolContracts.list.name, {
        title: recipeToolContracts.list.title,
        description: recipeToolContracts.list.description,
        inputSchema: recipeToolContracts.list.inputSchema,
        outputSchema: { result: recipeToolContracts.list.outputSchema },
        annotations: recipeToolContracts.list.annotations,
    }, async () => text(await operations.listRecipes()));
    server.registerTool(recipeToolContracts.plan.name, {
        title: recipeToolContracts.plan.title,
        description: recipeToolContracts.plan.description,
        inputSchema: recipeToolContracts.plan.inputSchema,
        outputSchema: { result: recipeToolContracts.plan.outputSchema },
        annotations: recipeToolContracts.plan.annotations,
    }, async (params) => text(await operations.planRecipe(params)));
    server.registerTool(recipeToolContracts.run.name, {
        title: recipeToolContracts.run.title,
        description: recipeToolContracts.run.description,
        inputSchema: recipeToolContracts.run.inputSchema,
        outputSchema: { result: recipeToolContracts.run.outputSchema },
        annotations: recipeToolContracts.run.annotations,
    }, async (params) => text(await operations.runRecipe(params)));
    server.registerTool('illustrator_create_document', {
        title: 'Create New Illustrator Document',
        description: 'Create one new, unsaved Illustrator document (RGB or CMYK, one artboard of width_pt x height_pt, optional artboard name) and return its context. Measured on Illustrator 30.8.1: the new document is inserted at collection index 0 and becomes the active document; existing documents keep their path, saved state, and file revision (their document keys change only in the index segment, so re-read them). The created document is mutable as mutationProfile unsaved_document. Verification failures close only the created document without saving. Refused while a backup or export session is unresolved. A timeout is indeterminate and may leave the new document open.',
        inputSchema: createDocumentPublicInputSchema.shape,
        outputSchema: { result: createDocumentResultSchema },
        annotations: BACKUP,
    }, async (params) => text(await operations.createDocument(normalizeCreateDocumentPublicInput(params))));
    server.registerTool('illustrator_save_document_as', {
        title: 'Save Illustrator Document As New File',
        description: 'Save the bound active Illustrator document (saved, unsaved, or with pending changes) to a new .ai file at output_path and return its new context. output_path must be absolute, end with .ai, not exist, and sit in an existing directory owned by the current user. Illustrator never writes output_path: it saves into a private staging directory next to it, Node verifies the file (identity, SHA-256, size against the host file revision) and publishes it with link(2), which cannot overwrite (an existing entry fails as output_exists with the staged file retained); the document is then switched to output_path by closing the clean staged document and opening the published file, so the result document is a new object with a new key (page-item UUIDs are not preserved, undo history is lost). Measured on Illustrator 30.8.1: the file the document pointed at before stays byte-identical (previousFilePreserved). Refused while a backup or export session is unresolved. A timeout is indeterminate and reports the staged and published paths. Locked-screen behaviour is unmeasured.',
        inputSchema: saveDocumentAsPublicInputSchema.shape,
        outputSchema: { result: saveDocumentAsResultSchema },
        annotations: BACKUP,
    }, async (params) => text(await operations.saveDocumentAs(normalizeSaveDocumentAsPublicInput(params))));
    server.registerTool('illustrator_save_document', {
        title: 'Save Illustrator Document In Place (Overwrite With Backup)',
        description: 'Overwrite the file of the bound, file-backed active Illustrator document with its pending changes. This is a destructive operation: backup_id must name a verified illustrator_create_backup record whose sourcePath and sourceFileRevision match the document and whose SHA-256 equals both the file currently on disk and the backup file itself; otherwise the call is rejected (backup_not_found, backup_mismatch, backup_stale, backup_file_unavailable) before Illustrator is touched. The document path must be canonical (a symbolic link is refused). The digest is re-verified under the active-command lock immediately before the host call, and Illustrator re-checks the file length and modification time right before save(); a change there writes nothing and is reported as indeterminate. A clean document is rejected with nothing_to_save; an unsaved document has no file to overwrite (use illustrator_save_document_as). Measured on Illustrator 30.8.1: save() rewrites the file with a new inode and a new file revision, so the document key changes; re-read it from the result. Refused while a backup or export session is unresolved. A timeout is indeterminate. Locked-screen behaviour is unmeasured. when the file belongs to an open edit session, backup_id must be that session\'s backup and the same host call scans the whole document first; it writes only when the structure digest and item aggregate still equal the session head (then the session closes), otherwise nothing is written and the session is suspended (edit_session_mismatch). A suspended session refuses the save (edit_session_suspended) until it is closed.',
        inputSchema: saveDocumentPublicInputSchema.shape,
        outputSchema: { result: saveDocumentResultSchema },
        annotations: DESTRUCTIVE_WITH_BACKUP,
    }, async (params) => text(await operations.saveDocument(normalizeSaveDocumentPublicInput(params))));
    server.registerTool('illustrator_open_edit_session', {
        title: 'Open Edit Session',
        description: 'Declare occupancy of one saved, clean Illustrator file so that verified changes can continue while the document is dirty. ' +
            'backup_id must name a verified illustrator_create_backup record of the exact bytes on disk (same path, revision and SHA-256); it is the session\'s only restore point. ' +
            'One host call binds the key, reads the structure digest and scans every item (at most 2,000 including nested ones, foreground and unlocked, canonical path; paths, text, groups, clip groups, compound paths and linked placed images under top-level layers; no sublayers, embedded images or other item types); anything else is rejected without writing. ' +
            'While the session is open, only operations that declare the items they change run on the file (the others are refused with EDIT_SESSION_OPERATION_UNSUPPORTED before any change); ' +
            'illustrator_save_document with the same backup_id scans the document again and writes only if it still matches, which closes the session. ' + EDIT_SESSION_SUPPORT_PROFILE,
        inputSchema: {
            expected_document_key: z.string().min(1).max(16_384),
            backup_id: z.uuid(),
        },
        outputSchema: { result: openEditSessionResultSchema },
        annotations: BACKUP,
    }, async (params) => text(await operations.openEditSession({ expectedDocumentKey: params.expected_document_key, backupId: params.backup_id })));
    server.registerTool('illustrator_get_edit_session', {
        title: 'List Edit Sessions',
        description: 'List every edit session record (open, suspended with its reason, closed) and every unreadable record. Read-only; never touches Illustrator. ' +
            'An unreadable record refuses every mutation until it is quarantined with illustrator_close_edit_session action=quarantine.',
        inputSchema: {},
        outputSchema: { result: getEditSessionsResultSchema },
        annotations: READ_ONLY,
    }, async () => text(await operations.getEditSessions()));
    server.registerTool('illustrator_close_edit_session', {
        title: 'Close or Quarantine Edit Session',
        description: 'action=close ends an open or suspended edit session (the document keeps its changes and stays dirty; save it on your own judgement or restore the session backup). ' +
            'action=quarantine moves one unreadable session record, unchanged, out of the live state so mutations can continue; a readable record is refused. ' +
            'Both require session_id and an identical confirm_session_id, and run under the active-command lock (one trivial Illustrator call). There is no way to resume a suspended session.',
        inputSchema: {
            session_id: sessionIdSchema,
            confirm_session_id: sessionIdSchema,
            action: z.enum(['close', 'quarantine']).default('close'),
        },
        outputSchema: { result: closeEditSessionResultSchema },
        annotations: RECONCILE,
    }, async (params) => text(await operations.closeEditSession({ sessionId: params.session_id, confirmSessionId: params.confirm_session_id, action: params.action })));
    server.registerTool('illustrator_open_document', {
        title: 'Open Illustrator Document (Read-Only Open)',
        description: 'Open one existing .ai file in Illustrator and return its context. path must be absolute, end with .ai, and resolve to a regular file outside the MCP state root. A file that is already open is rejected with already_open together with the identity of the open document (bind that key instead); if Illustrator hands back an already-open document under an alias path, that document is never closed and the same rejection is returned. Measured on Illustrator 30.8.1: the opened document is inserted at collection index 0 and becomes the active document; existing documents keep their path, saved state, and file revision (their keys change only in the index segment, so re-read them). Verification failures close only a document this call can prove it created, without saving. Nothing is written. Refused while a backup or export session is unresolved. A timeout is indeterminate (a dialog for missing fonts or profiles is unmeasured and would time out). Locked-screen behaviour is unmeasured.',
        inputSchema: openDocumentPublicInputSchema.shape,
        outputSchema: { result: openDocumentResultSchema },
        annotations: BACKUP,
    }, async (params) => text(await operations.openDocument(normalizeOpenDocumentPublicInput(params))));
    server.registerTool('illustrator_close_document', {
        title: 'Close Illustrator Document',
        description: 'Close the bound active Illustrator document without saving. A clean document (saved=true) closes by default; a document with unsaved changes is rejected with unsaved_changes unless discard_changes is true, in which case the changes are discarded and the file is proven unchanged (filePreserved). Nothing is ever written by this tool; to keep changes, call illustrator_save_document_as or illustrator_save_document first. Measured on Illustrator 30.8.1: close returns in well under a second and the remaining documents keep their identity apart from the index segment. The result reports the closed identity, the remaining inventory, and the new active document (null when none is open). Refused while a backup or export session is unresolved. A timeout is indeterminate. Locked-screen behaviour is unmeasured.',
        inputSchema: closeDocumentPublicInputSchema.shape,
        outputSchema: { result: closeDocumentResultSchema },
        annotations: BACKUP,
    }, async (params) => text(await operations.closeDocument(normalizeCloseDocumentPublicInput(params))));
    server.registerTool('illustrator_create_backup', {
        title: 'Create Verified Illustrator Backup',
        description: 'Copy the saved file of the bound Illustrator document to a new backup file, verify the copy by opening only the restore-test copy in Illustrator and comparing its structure with the source, close that copy without saving, and publish a private backup record. The source document and file are never written. Unsaved, dirty, or stale-key documents are rejected before any copy, and so is a document above 1,000 items (document_too_large; extrapolated from one live measurement so that no host call nears its timeout). backup_root must be a directory owned by the current user with mode 0700. An indeterminate result leaves a session that blocks mutations until illustrator_reconcile_backup releases it. Backups are never deleted automatically.',
        inputSchema: {
            expected_document_key: z.string().min(1).max(16_384),
            backup_root: z.string().min(1).max(4_096).optional(),
        },
        outputSchema: { result: createBackupResultSchema },
        annotations: BACKUP,
    }, async (params) => text(await operations.createBackup({
        expectedDocumentKey: params.expected_document_key,
        ...(params.backup_root === undefined ? {} : { backupRoot: params.backup_root }),
    })));
    server.registerTool('illustrator_reconcile_backup', {
        title: 'Reconcile Illustrator Backup Session',
        description: 'Resolve an unresolved illustrator_create_backup session after a timeout or indeterminate result. Reads which open documents still use the restore-test copy; releases the session only when none does. With action close_restore_test the single matching restore-test document is closed without saving first. Backup files are never deleted. Mutations stay blocked until every session is released.',
        inputSchema: {
            backup_id: z.uuid(),
            action: z.enum(['inspect', 'close_restore_test']).default('inspect'),
        },
        outputSchema: { result: reconcileBackupResultSchema },
        annotations: BACKUP,
    }, async (params) => text(await operations.reconcileBackup({ backupId: params.backup_id, action: params.action })));
    server.registerTool('illustrator_reconcile_delete', {
        title: 'Reconcile or Revert an Illustrator Deletion',
        description: 'Check and, if needed, undo a deletion made by illustrator_delete_objects by reopening the unchanged file. It runs as an ordinary command, so it needs the Illustrator lock to be free: after an indeterminate delete apply the lock stays held (illustrator_reconcile cannot abandon it) until illustrator_reconcile with action=release_unverified (command_id and an identical confirm_command_id, once inspect reports canReleaseUnverified); while it is held this tool refuses with command_locked. action inspect (read-only) reports the open documents on the backup\'s source path, their keys and saved state, and which target UUIDs resolve: not_applied only when exactly one clean document carries the apply key, every target resolves, and the file still matches the backup; otherwise revert_required. action revert closes that document without saving and reopens the same file, only after the backup record, the file, and the backup file are re-verified under the command lock and confirm_document_key equals the key inspect reported (null when no document was open); it succeeds (restored) only when the reopened document shows the path, the backup revision, saved, saved_file, and the apply key apart from the collection index, other documents are unchanged, and the file still hashes to the backup. Unsaved changes in that document are discarded. It never changes a command\'s recorded outcome. Target UUID resolution after the reopen is informational. Nothing is retried automatically.',
        inputSchema: reconcileDeletePublicInputSchema.shape,
        outputSchema: { result: reconcileDeleteResultSchema },
        annotations: DESTRUCTIVE_WITH_BACKUP,
    }, async (params) => text(await operations.reconcileDelete(normalizeReconcileDeletePublicInput(params))));
    server.registerTool('illustrator_export_outlined', {
        title: 'Export Outlined AI or PDF',
        description: 'Export the bound, saved Illustrator document as one new outlined AI or PDF file without touching the source document or file: the saved file is copied into the private state root, only that copy is opened, every text frame on the copy is outlined, the copy is saved once to output_path (which must not exist), the file is verified in Node (PDF header, one page object per artboard, SHA-256), the copy is closed without saving, the source is verified unchanged, and a private export record is published. Unsaved, dirty, or stale-key documents and an existing output_path are rejected before any host write. For format "pdf", pdf_preset must name an entry of Illustrator\'s PDF preset list (a rejection returns availablePresets). An indeterminate result leaves a session that blocks mutations until illustrator_reconcile_export releases it. Output files are never deleted or overwritten.',
        inputSchema: {
            expected_document_key: z.string().min(1).max(16_384),
            format: z.enum(['ai', 'pdf']),
            output_path: z.string().min(1).max(4_096),
            pdf_preset: z.string().min(1).max(512).optional(),
        },
        outputSchema: { result: exportOutlinedResultSchema },
        annotations: BACKUP,
    }, async (params) => text(await operations.exportOutlined({
        expectedDocumentKey: params.expected_document_key,
        format: params.format,
        outputPath: params.output_path,
        ...(params.pdf_preset === undefined ? {} : { pdfPreset: params.pdf_preset }),
    })));
    server.registerTool('illustrator_optimize_images', {
        title: 'Optimize Embedded Images to a PPI Cap',
        description: `Downsample embedded RGB images whose effective PPI exceeds max_ppi, on a private work copy of the bound saved document, and save the result as one new .ai at output_path (which must not exist); the source document and file are never written. apply=false (default) is a read-only plan: the eligible targets with their pixels, effective PPI and expected pixels, every excluded image with its reason, the save options, and the render size. apply=true needs target_uuids from the plan (at most ${IMAGE_OPTIMIZE_MAX_TARGETS}) and output_path, and the foreground host: the saved file is copied into the private state root, only the copy is opened, rendered at max_ppi as the baseline (nothing is saved before the rasterize), each target is rasterized at max_ppi (Document.rasterize, anti-aliased, transparency kept) with its name restored, and every target is verified (pixels, effective PPI, bounds, position, colour space, bit depth, layer, stacking order) together with the artboard render at max_ppi before the one saveAs; the output is verified in Node and published without overwrite. Saves always use explicit IllustratorSaveOptions: pdfCompatible follows the source file (PDF image objects present or not), compressed on, linked files not embedded, and embedICCProfile=false: an ICC profile embedded in the source is NOT carried over to the output, which matters for colour-managed print (every plan and verified result repeats this in iccProfile and returns the chosen save options). Reported bytes are whole-document sizes (source file and output file); no reduction is promised and per-image bytes, codec and quality are not available. Measured scope only (Illustrator ${IMAGE_OPTIMIZE_APP_VERSION}, RGB document, one artboard whose render at max_ppi fits ${IMAGE_OPTIMIZE_RENDER_MAX_PIXELS} px): linked, CMYK or grayscale, non-8-bit, rotated, flipped or non-uniformly scaled, grouped or clipped, locked or hidden, non-opaque or non-normal-blend images and images outside the artboard are excluded and left unchanged. An indeterminate result leaves an export session that blocks mutations until illustrator_reconcile_export releases it.`,
        inputSchema: {
            expected_document_key: z.string().min(1).max(16_384),
            max_ppi: z.number().int().min(IMAGE_OPTIMIZE_MIN_PPI).max(IMAGE_OPTIMIZE_MAX_PPI),
            apply: z.boolean().default(false),
            target_uuids: z.array(z.string().min(1).max(128)).min(1).max(IMAGE_OPTIMIZE_MAX_TARGETS).optional(),
            output_path: z.string().min(1).max(4_096).optional(),
        },
        outputSchema: { result: imageOptimizeResultSchema },
        annotations: BACKUP,
    }, async (params) => text(await operations.optimizeImages({
        expectedDocumentKey: params.expected_document_key,
        capPpi: params.max_ppi,
        apply: params.apply,
        ...(params.target_uuids === undefined ? {} : { targetUuids: params.target_uuids }),
        ...(params.output_path === undefined ? {} : { outputPath: params.output_path }),
    })));
    server.registerTool('illustrator_export', {
        title: 'Export One Artboard as PNG or JPEG',
        description: 'Export one artboard of the bound, clean, saved RGB Illustrator document as one new PNG24 or JPEG file, ' +
            'without touching the source document or file. apply=false (default) is a read-only plan (one host call) that returns the ' +
            'expected pixel size and nextCall; apply with those arguments unchanged. The saved file is copied into the private state root, ' +
            'only the copy is opened, the target artboard is selected and exported once to a private staging folder, the file is fully ' +
            'decoded and its pixel size must equal the plan, the copy is closed without saving, and the file is published at output_path ' +
            'with link(2), which never overwrites (an existing path is refused). Supported: artboards whose edges are whole points, scale 1 ' +
            'or 2 (size = artboard pt x scale, exact), at most 4000 px per side and 12,000,000 px in total, artboard ruler origin [0,0]; ' +
            'an opaque PNG only at 1x. Anything else is refused in the plan. Unsaved changes, never-saved documents, open edit sessions, ' +
            'CMYK and linked images are refused (save first). SVG is not supported yet. Exports run one at a time. The same command_id ' +
            'replays the stored result without calling Illustrator; a timeout leaves a session that blocks mutations until ' +
            'illustrator_reconcile_export resolves it.',
        inputSchema: rasterExportInputSchema.shape,
        outputSchema: { result: rasterExportResultSchema },
        annotations: BACKUP,
    }, async (params) => text(await operations.rasterExport(params)));
    server.registerTool('illustrator_reconcile_export', {
        title: 'Reconcile Illustrator Export Session',
        description: 'Resolve an unresolved illustrator_export_outlined, illustrator_optimize_images or illustrator_export session after a timeout or indeterminate result. ' +
            'For outlined/optimize sessions (actions inspect, close_work_copy): reads which open documents still use the work copy or the output path; releases the session only when none does; close_work_copy closes the single matching document without saving after re-verifying it. ' +
            'For illustrator_export sessions the result names the stop point (window) and what is allowed there: inspect; close_work_copy (only a copy that matches the recorded state); ' +
            'finalize (record a publication that already happened, then clean up); abandon (record the export as failed without publishing; keeps every file); ' +
            'release_quarantined with confirm_export_id equal to export_id (release a quarantined or unreadable export after you have checked its files). ' +
            'Nothing is exported, linked or deleted again, output files are never touched, and every change runs under the command lock. Mutations stay blocked until every session is released.',
        inputSchema: {
            export_id: z.uuid(),
            action: z.enum(['inspect', 'close_work_copy', 'finalize', 'abandon', 'release_quarantined']).default('inspect'),
            confirm_export_id: z.uuid().optional(),
        },
        outputSchema: { result: z.union([reconcileExportResultSchema, rasterReconcileResultSchema]) },
        annotations: BACKUP,
    }, async (params) => text(await operations.reconcileExport({
        exportId: params.export_id,
        action: params.action,
        ...(params.confirm_export_id === undefined ? {} : { confirmExportId: params.confirm_export_id }),
    })));
    server.registerTool('illustrator_reconcile', {
        title: 'Reconcile Illustrator Command',
        description: 'Check durable command and transaction-phase status after a timeout or other indeterminate result before another mutation is allowed. action=quarantine moves one command whose unsafe state is confined to it (reported by the state scan) out of the live state, unchanged, so other mutations can continue; that command is never replayed or reapplied. It requires command_id and an identical confirm_command_id. action=release_unverified is the last resort for a stopped command whose outcome cannot be verified (inspect reports canReleaseUnverified): check the document in Illustrator first, then it records the command as released without verification and frees the lock; the document state stays unknown and the command is never replayed or reapplied. It also requires command_id and an identical confirm_command_id.',
        inputSchema: {
            command_id: canonicalCommandIdSchema.optional(),
            action: z.enum(['inspect', 'abandon', 'quarantine', 'release_unverified']).default('inspect'),
            confirm_command_id: canonicalCommandIdSchema.optional(),
        },
        outputSchema: { result: commandStatusSchema.nullable() },
        annotations: RECONCILE,
    }, async (params) => text(await operations.reconcile({
        ...(params.command_id === undefined ? {} : { commandId: params.command_id }),
        abandon: params.action === 'abandon',
        quarantine: params.action === 'quarantine',
        releaseUnverified: params.action === 'release_unverified',
        ...(params.confirm_command_id === undefined ? {} : { confirmCommandId: params.confirm_command_id }),
    })));
    installPublishedToolList(server, mutationAdapters);
    return server;
}
