import { workCopyOverwriteFields, workCopyPdfResultSchema, workCopyOutlinedResultSchema } from './work-copy-overwrite-public.js';
import { scanContinuationSchema } from './edit-session-chunked-scan.js';
import { SvgTextPlanBlockedError } from './adapters/import-vector-artwork-adapter.js';
import { HOST_VERSION_SCOPE_NOTE, hostVersionPublicFields } from './host-version-consent.js';
import { McpServer } from '@modelcontextprotocol/server';
import { createRequire } from 'node:module';
import { z } from 'zod';
import { boundsSchema, documentContextSchema, getContextResultSchema, documentKeyShortSchema, illustratorApplicationEvidenceSchema, isMutationAuditPrefix, layerStructuralReasonSchema, mutationAuditSchema, toBounds, } from './mutation-result-schema-core.js';
export { documentContextSchema } from './mutation-result-schema-core.js';
export { rectangleResponseSchema, rectangleResultSchema } from './rectangle-result-schema.js';
export { operationSafetyPlanSchema, operationSafetyPolicySchema, operationSafetyResultSchema, } from './operation-safety-policy-core.js';
import { textStyleListSchema } from './text-style-resources.js';
import { FONT_LOOKUP_MAX_NAMES, fontCursorSchema, fontLookupResultSchema, fontPostScriptNameSchema, fontQuerySchema, fontSearchResultSchema } from './font-lookup.js';
import { getPathPointsResultSchema, PATH_EDIT_MAX_POINTS } from './path-points.js';
import { measureScaleReferenceResultSchema, SCALE_REFERENCE_MAX_REFERENCES, scaleReferenceInputSchema } from './scale-reference.js';
import { getAreaTextOptionsResultSchema } from './area-text-options.js';
import { displaySpacingResultSchema } from './display-spacing.js';
import { planTextIncrementResultSchema, textIncrementRuleSchema } from './text-increment.js';
import { PLAN_TEXT_FIT_LIMITS, planTextFitConstraintSchema, planTextFitResultSchema, planTextFitSearchSchema } from './plan-text-fit.js';
import { JP_AUDIT_LIMITS, JP_AUDIT_POLICIES, JP_AUDIT_RESPONSE_BYTES, JP_AUDIT_RESULT_FORMATS, jpAuditJustifyBodySchema, jpAuditLatinBodySchema, jpAuditParagraphShapeSchema, jpAuditProtectedTermSchema, jpAuditResultSchema, jpAuditSettingProfileSchema, LINE_START_RELAXATIONS } from './jp-typography-audit.js';
import { canonicalCommandIdSchema } from './command-id.js';
import { installPercentPathRefusal } from './percent-path-refusal.js';
import { installToolValidationErrors } from './tool-validation-errors.js';
import { variableListSchema } from './variables-read.js';
import { createBackupResultSchema, reconcileBackupResultSchema } from './document-backup.js';
import { normalizeReconcileDeletePublicInput, reconcileDeletePublicInputSchema, reconcileDeleteResultSchema } from './delete-recovery.js';
import { createDocumentPublicInputSchema, createDocumentResultSchema, normalizeCreateDocumentPublicInput } from './document-create.js';
import { activateDocumentPublicInputSchema, activateDocumentResultSchema, closeDocumentPublicInputSchema, closeDocumentResultSchema, normalizeActivateDocumentPublicInput, normalizeCloseDocumentPublicInput, normalizeOpenDocumentPublicInput, normalizeSaveDocumentAsPublicInput, normalizeSaveDocumentPublicInput, openDocumentPublicInputSchema, openDocumentResultSchema, saveDocumentAsPublicInputSchema, saveDocumentAsResultSchema, saveDocumentPublicInputSchema, saveDocumentResultSchema, } from './document-lifecycle.js';
import { exportOutlinedResultSchema, reconcileExportResultSchema } from './document-export.js';
import { pdfExportResultSchema, pdfExportBleedInputSchema } from './pdf-export.js';
import { closeEditSessionResultSchema, getEditSessionsResultSchema, openEditSessionResultSchema, sessionIdSchema, } from './edit-session-tools.js';
import { IMAGE_OPTIMIZE_MAX_PPI, IMAGE_OPTIMIZE_MAX_TARGETS, IMAGE_OPTIMIZE_MIN_PPI, imageOptimizeResultSchema, } from './image-optimize.js';
import { m6P0RecipeToolContract } from './m6-p0-recipe.js';
import { recipeToolContracts } from './recipe.js';
import { COMPLETE_RESULT_DEPTH } from './published-result-shape.js';
import { PUBLISHED_DEPTH_KEY, installPublishedToolList, installSharedToolSchemas } from './published-tool-schema.js';
import { installWindowsReadOnlyRegistration, windowsServerInstructions } from './windows/read-tools.js';
import { WindowsReadOnlyError } from './windows/com-transport.js';
import { imagePreflightPageSchema } from './image-preflight-schema.js';
import { PREFLIGHT_DESCRIPTION_SENTENCE } from './preflight-scope-note.js';
import { printPreflightConditionsSchema, printPreflightResultSchema } from './print-preflight-schema.js';
import { contrastRequestSchema, contrastResultSchema, designTokensResultSchema, textConsistencyResultSchema, } from './design-analysis-schema.js';
import { colorMatchSchema, colorReplacementPlanSchema, colorUsagePageSchema, replacementColorSchema, } from './color-replacement.js';
import { cmykColorSummarySchema, colorSummarySchema, finiteNumberSchema, grayColorSummarySchema, labColorSummarySchema, noneColorSummarySchema, objectSummarySchema, pathAppearanceSchema, patternColorSummarySchema, percentSchema, requiredAvailabilitySchema, rgbColorSummarySchema, TEXT_DETAIL_LIMITS, textAppearanceSchema, unavailableMessageSchema, unknownColorSummarySchema, unsupportedAppearanceSchema, } from './object-appearance-schema.js';
import { structureDiffIdSchema, structureDiffPageSchema, structureSnapshotIdSchema, structureSnapshotSummarySchema, } from './structure-diff-schema.js';
import { STRUCTURE_DIFF_DEFAULT_TOLERANCE_PT, STRUCTURE_DIFF_MAX_TOLERANCE_PT, STRUCTURE_SNAPSHOT_LIMITS, } from './structure-diff.js';
import { comparePngImages, visualDiffResultSchema } from './visual-diff.js';
import { previewBoundsSchema, previewResultSchema } from './document-preview.js';
import { RENDER_LIMITS, renderResultSchema } from './artboard-render.js';
import { TEXT_EXTRACT_LIMITS, textExtractResultSchema } from './text-extract.js';
import { rasterExportResultSchema, rasterReconcileResultSchema } from './raster-export.js';
import { rasterExportToolInputShape } from './raster-batch-export.js';
import { GuidedRefusalError, buildBackupNextSteps, buildBlockedNextSteps, nextStepsSchema } from './blocked-guidance.js';
import { DIRTY_FILE_ADMISSION_OPERATIONS, documentAdmissionNote, documentAdmissionNoteSchema } from './dirty-file-admission.js';
import { admitHostVersionPlan, hostVersionNoteSchema } from './host-version-admission.js';
import { saveAsReconcileActionSchema, saveAsReconcileResultSchema } from './save-as-reconcile.js';
import { rasterToolStep } from './raster-steps.js';
import { SnapshotRefCache } from './snapshot-ref-cache.js';
import { createBatchNextCallWithRef, createBatchView, createBatchViewSchema, expandCreateBatchStepsRef } from './adapters/create-batch-view.js';
import { expandMutateBatchSnapshotRefs, mutateBatchNextCallWithRefs, mutateBatchView, mutateBatchViewSchema } from './adapters/mutate-batch-view.js';
import { REPLACE_RGB_BLACK_OPERATION } from './adapters/replace-rgb-black-adapter.js';
import { rgbBlackSelectionSchema } from './rgb-black.js';
import { NEXT_CALL_BUILDERS, buildNextCall, formatToolArgumentError, nextCallSchema, toolArgumentIssueMessage } from './tool-arguments.js';
export { imagePreflightItemSchema, imagePreflightPageSchema } from './image-preflight-schema.js';
export { printPreflightFindingSchema, printPreflightResultSchema } from './print-preflight-schema.js';
export { structureDiffPageSchema, structureSnapshotSummarySchema } from './structure-diff-schema.js';
export { visualDiffResultSchema } from './visual-diff.js';
export { previewResultSchema } from './document-preview.js';
export { contrastResultSchema, designTokensResultSchema, textConsistencyResultSchema } from './design-analysis-schema.js';
export { backupRecordSchema, backupSessionSchema, createBackupResultSchema, reconcileBackupResultSchema } from './document-backup.js';
export { exportOutlinedResultSchema, exportRecordSchema, exportSessionSchema, reconcileExportResultSchema } from './document-export.js';
export { activateDocumentResultSchema, closeDocumentResultSchema, openDocumentResultSchema, saveDocumentAsResultSchema, saveDocumentResultSchema } from './document-lifecycle.js';
const RESPONSE_VIEWS = {
    illustrator_mutate_batch: { outputSchema: mutateBatchViewSchema, render: mutateBatchView,
        nextCall: mutateBatchNextCallWithRefs, expand: expandMutateBatchSnapshotRefs },
    illustrator_create_batch: { outputSchema: createBatchViewSchema, render: createBatchView,
        nextCall: createBatchNextCallWithRef, expand: expandCreateBatchStepsRef },
};
const SNAPSHOT_REFS = new SnapshotRefCache();
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const RECONCILE = { readOnlyHint: false };
const ACTIVATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const BACKUP = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const DESTRUCTIVE_WITH_BACKUP = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
function text(value) {
    return {
        content: [{ type: 'text', text: JSON.stringify(value) }],
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
        reason: z.enum(['scan_limit', 'run_limit', 'read_failed']),
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
    mergedCount: z.number().int().positive().optional(),
    font: fontAvailabilitySchema,
    size: characterStyleAvailabilitySchema,
    tracking: characterStyleAvailabilitySchema,
    fill: colorStyleAvailabilitySchema,
    stroke: colorStyleAvailabilitySchema,
    alignment: requiredAvailabilitySchema(z.enum(['center', 'roman_baseline']), z.literal('character_style_unavailable')),
});
const paragraphUnavailableReasonSchema = z.enum(['paragraph_style_unavailable', 'trailing_empty_paragraph']);
const paragraphSchema = z.strictObject({
    index: z.number().int().nonnegative(),
    characterCount: z.number().int().nonnegative(),
    preview: z.string().max(200),
    previewTruncated: z.boolean(),
    justification: requiredAvailabilitySchema(z.string(), paragraphUnavailableReasonSchema),
    leadingType: requiredAvailabilitySchema(z.enum(['top_to_top', 'bottom_to_bottom']), paragraphUnavailableReasonSchema),
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
    if (items.length === 0 && collection.status === 'truncated' && collection.reason === 'read_failed')
        return;
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
        if (range.mergedCount !== undefined && range.mergedCount > range.length) {
            context.addIssue({ code: 'custom', message: 'Native run count cannot exceed run length.',
                path: ['styleRuns', 'items', index, 'mergedCount'] });
        }
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
const unreadableTextReadSchema = z.strictObject({
    scope: z.enum(['paragraph', 'style_runs']),
    attribute: z.string().min(1).max(64),
    index: z.number().int().nonnegative().nullable(),
    reason: z.enum(['host_no_such_element', 'host_illegal_argument', 'host_error']),
    hostErrorNumber: z.number().int().nullable(),
    guidance: z.string().min(1).max(400),
});
const textFrameDetailsSchema = z.strictObject({
    kind: z.literal('text_frame'),
    illustratorType: z.literal('TextFrame'),
    content: textContentSchema,
    paragraphs: itemCountCollectionSchema(paragraphSchema, TEXT_DETAIL_LIMITS.paragraphs),
    styleRuns: scannedCollectionSchema(textStyleRunSchema, TEXT_DETAIL_LIMITS.styleRuns),
    fonts: scannedCollectionSchema(fontUsageSchema, TEXT_DETAIL_LIMITS.fonts),
    missingFonts: scannedCollectionSchema(missingFontSchema, TEXT_DETAIL_LIMITS.missingFonts),
    unreadable: z.array(unreadableTextReadSchema).max(TEXT_DETAIL_LIMITS.unreadable),
}).superRefine((details, context) => {
    const totalCharacters = details.content.status === 'complete'
        ? details.content.text.length
        : details.content.totalCharacters;
    const unreadableParagraphs = new Set(details.unreadable.filter((read) => read.scope === 'paragraph' && read.index !== null).map((read) => read.index));
    let expectedIndex = 0;
    for (let index = 0; index < details.paragraphs.items.length; index++) {
        while (unreadableParagraphs.has(expectedIndex))
            expectedIndex++;
        if (details.paragraphs.items[index].index !== expectedIndex) {
            context.addIssue({
                code: 'custom',
                message: 'Paragraph indices must be zero-based and in order, with gaps only for listed unreadable paragraphs.',
                path: ['paragraphs', 'items', index, 'index'],
            });
        }
        expectedIndex++;
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
        (details.styleRuns.reason === 'scan_limit' || details.styleRuns.reason === 'run_limit' || details.styleRuns.reason === 'read_failed')) {
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
                    message: 'An item-limited complete scan cannot produce scan_limit, run_limit or read_failed dependents.',
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
    possible_freeform_gradient_fills: z.number().int().min(0).max(1),
    possible_freeform_gradient_note: z.string().min(1).nullable(),
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
    text_selection: z.object({
        frame_uuids: z.array(z.string().min(1)).max(64),
        character_offset: z.number().int().nonnegative().nullable(),
        length: z.number().int().nonnegative().nullable(),
    }).optional(),
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
const windowsCommandExecutionIdentityShape = {
    executionIdentity: z.strictObject({
        kind: z.literal('windows_process'),
        pid: z.number().int().safe().positive(),
        creationTime: z.string().regex(/^[1-9][0-9]*$/u),
    }),
    executionNonce: commandExecutionIdentityShape.executionNonce,
    executionState: commandExecutionIdentityShape.executionState,
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
function buildCommandStatusSchema(windowsRelease) {
    return z.union([
        z.strictObject({
            ...commandStatusBaseShape, ...windowsCommandExecutionIdentityShape,
            state: terminalCommandStateSchema, executionStatus: z.literal('inactive'), canAbandon: z.literal(false),
        }),
        z.strictObject({
            ...commandStatusBaseShape, ...windowsCommandExecutionIdentityShape,
            state: nonterminalCommandStateSchema, executionStatus: z.enum(['active', 'unknown']), canAbandon: z.literal(false),
            transaction: indeterminateTransactionStatusSchema.optional(),
        }),
        z.strictObject({
            ...commandStatusBaseShape, ...windowsCommandExecutionIdentityShape,
            state: nonterminalCommandStateSchema, executionStatus: z.literal('inactive'), canAbandon: z.boolean(),
            ...(windowsRelease ? { canReleaseUnverified: z.boolean().optional() } : {}),
            transaction: indeterminateTransactionStatusSchema.optional(),
        }),
        z.strictObject({
            ...commandStatusBaseShape, state: nonterminalCommandStateSchema,
            executionRecord: z.literal('missing'), executionStatus: z.literal('inactive'), canAbandon: z.boolean(),
        }),
        z.strictObject({
            ...commandStatusBaseShape, state: z.literal('failed'),
            executionRecord: z.literal('missing'), executionStatus: z.literal('inactive'), canAbandon: z.literal(false),
        }),
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
}
export const commandStatusSchema = buildCommandStatusSchema(true);
const windowsDefaultCommandStatusSchema = buildCommandStatusSchema(false);
export const SERVER_INSTRUCTIONS = [
    'Mutations are two-step: call the tool with apply:false to get a plan, then apply with the plan\'s next_call arguments when present (otherwise apply:true, the before/after values the plan returned, and a new lowercase UUID v4 command_id); resend the same command_id only to retry that same apply.',
    'Bind every mutation to the full document key from illustrator_get_context or illustrator_list_documents, and read it again after any save, since keys change.',
    'Call tools one at a time; parallel calls are refused.',
    'A timeout or indeterminate result blocks later mutations; resolve it with illustrator_reconcile (or the matching reconcile tool) before continuing.',
    'Overwriting a saved file requires a verified backup from illustrator_create_backup. For several unsaved changes, open illustrator_open_edit_session with it before the first change; a few tools also continue unsaved files without one (dirty_file).',
    'When a call is refused, tell the user the reason and the next steps. A refusal because the feature is missing, unmeasured or outside the measured scope (next_steps action custom_script) may be done by your own script outside this server, without asking first: say what you will change, create_backup first for a saved file, check the result with the read tools, report what changed outside this server, and read the document key again. Never use a script or GUI automation after a timeout or indeterminate result, an unresolved lock, a stale or mismatched target, or an environment state (screen lock, Illustrator not frontmost, modal): reconcile, re-read, or fix the state and retry here.',
].join('\n');
const windowsToolCacheKeys = new WeakMap();
const WINDOWS_RELEASE_SENTENCE = ' With the Windows mutation candidate opt-in, action=release_unverified is the last resort for a stopped candidate mutation whose outcome cannot be verified (inspect reports canReleaseUnverified): check the document in Illustrator first, then it records the command as released without verification and frees the lock; the document state stays unknown and the command is never replayed or reapplied. It requires command_id and an identical confirm_command_id.';
const windowsReleaseToolCacheKeys = new WeakMap();
export function createServer(operations, mutationAdapters = operations.getMutationAdapterRegistry(), options = {}) {
    if (mutationAdapters !== operations.getMutationAdapterRegistry()) {
        throw new Error('MCP server and Illustrator operations must share the exact sealed mutation adapter registry.');
    }
    const windowsReadOnly = options.windowsReadOnly === true;
    const windowsMutationTools = options.windowsMutationTools ?? new Set();
    if (!windowsReadOnly && windowsMutationTools.size > 0)
        throw new Error('windowsMutationTools requires the Windows registration.');
    let cacheKey = mutationAdapters;
    const windowsRelease = windowsReadOnly && windowsMutationTools.size > 0;
    if (windowsReadOnly) {
        const keys = windowsRelease ? windowsReleaseToolCacheKeys : windowsToolCacheKeys;
        let key = keys.get(mutationAdapters);
        if (key === undefined) {
            key = {};
            keys.set(mutationAdapters, key);
        }
        cacheKey = key;
    }
    const server = new McpServer({ name: 'illustrator-studio-mcp', version: packageVersion }, { instructions: windowsReadOnly ? windowsServerInstructions(windowsMutationTools) : SERVER_INSTRUCTIONS });
    installSharedToolSchemas(server, cacheKey);
    installToolValidationErrors(server);
    installPercentPathRefusal(server);
    if (windowsReadOnly)
        installWindowsReadOnlyRegistration(server, windowsMutationTools);
    server.registerTool('illustrator_get_context', {
        title: 'Get Illustrator Context',
        description: 'Read the active Illustrator document context without modifying it. Includes keyShort (accepted as expected_document_key), mutationProfile, and the application {bundleId, version, channel} that answered.',
        inputSchema: {},
        outputSchema: { result: getContextResultSchema },
        annotations: READ_ONLY,
    }, async () => text(await operations.getContext()));
    server.registerTool('illustrator_list_documents', {
        title: 'List Illustrator Documents and Artboards',
        description: 'Read every open document and artboard in Illustrator collection order. Returns a complete, unpaginated snapshot without modifying document state, plus the application {bundleId, version, channel} that answered. Only the active:true document can be bound by the other tools; for an active:false one call illustrator_activate_document with its key first.',
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
    server.registerTool('illustrator_list_variables', {
        title: 'List Illustrator Variables, Bindings and Datasets',
        description: 'Read the variables of the active document and what each is bound to (native UUID, type, name, property, rank in variable.pageItems), the datasets by index and name, and the dataset the last display() showed (Document.activeDataSet; it does not follow a hand edit of the bound items). One host call; changes nothing. A bound image gets a new UUID on every dataset display, so find items again through the variable, not by an old UUID.',
        inputSchema: {
            expected_document_key: z.string().min(1).max(16_384),
        },
        outputSchema: { result: variableListSchema },
        annotations: READ_ONLY,
    }, async (params) => text(await operations.listVariables({
        expectedDocumentKey: params.expected_document_key,
    })));
    server.registerTool('illustrator_list_objects', {
        title: 'List Illustrator Objects',
        description: 'List native PageItem UUIDs in layer-tree order (a group\'s children follow it). Follow nextCursor until hasMore=false before concluding an object is absent.',
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
        description: 'Get one PageItem by native UUID with bounded type-specific text, font, link, and appearance details in an explicitly bound document. Text style runs merge equal reported attributes; at most 32 runs.',
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
        description: 'Read linked and embedded image file identity, SHA-256, source/current color facts, native and effective PPI, and structured warnings without modifying Illustrator. Follow nextCursor until hasMore=false before concluding an image is absent. With target_ppi, each item also gets resizeSpec (pixels for that PPI and the visible source range); with bleed_mm too, it adds bleedShortfall per artboard edge. ' + PREFLIGHT_DESCRIPTION_SENTENCE,
        inputSchema: {
            expected_document_key: z.string().min(1).max(16_384),
            minimum_effective_ppi: z.number().finite().positive().max(100_000),
            target_ppi: z.number().finite().min(72).max(2400).optional(),
            bleed_mm: z.number().finite().min(0).max(25).optional(),
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
        ...(params.target_ppi === undefined ? {} : { targetPpi: params.target_ppi }),
        ...(params.bleed_mm === undefined ? {} : { bleedMm: params.bleed_mm }),
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
        maximum_total_ink_percent: z.number().finite().min(100).max(400).optional(),
        classify_blacks: z.boolean().optional(),
        rich_black_min_text_pt: z.number().finite().min(0.1).max(72).optional(),
        rich_black_min_stroke_pt: z.number().finite().min(0.01).max(10).optional(),
    }).superRefine((value, context) => {
        for (const key of ['rich_black_min_text_pt', 'rich_black_min_stroke_pt']) {
            if (value[key] !== undefined && value.classify_blacks !== true) {
                context.addIssue({ code: 'custom', message: `${key} requires classify_blacks: true.`, path: [key] });
            }
        }
        uniqueColorSpaces(value.allowed_document_color_spaces, context, 'allowed_document_color_spaces');
        uniqueColorSpaces(value.allowed_image_color_spaces, context, 'allowed_image_color_spaces');
    });
    server.registerTool('illustrator_preflight_print', {
        title: 'Preflight Illustrator Print Document',
        description: 'Read a bounded complete print-preflight snapshot across document color, used inks, overprint, transparency, raster effects, bleed availability, artboard geometry, strokes, fonts, images, and total ink when maximum_total_ink_percent is given. classify_blacks adds black-kind and Registration-in-artwork findings; rich_black_min_text_pt and rich_black_min_stroke_pt (need classify_blacks) warn on small rich-black text and thin rich-black strokes. Unavailable or truncated required checks can never produce pass. ' + PREFLIGHT_DESCRIPTION_SENTENCE,
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
            ...(params.conditions.maximum_total_ink_percent === undefined ? {} : { maximumTotalInkPercent: params.conditions.maximum_total_ink_percent }),
            ...(params.conditions.classify_blacks === undefined ? {} : { classifyBlacks: params.conditions.classify_blacks }),
            ...(params.conditions.rich_black_min_text_pt === undefined ? {} : { richBlackMinTextPt: params.conditions.rich_black_min_text_pt }),
            ...(params.conditions.rich_black_min_stroke_pt === undefined ? {} : { richBlackMinStrokePt: params.conditions.rich_black_min_stroke_pt }),
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
        description: 'Read-only replacement planning over a stable color snapshot. Returns a plan-only illustrator_mutate_batch request for supported PathItem appearance and uniform complete RGB or CMYK text-fill targets, paged at the batch maximum. Gradient-stop, swatch-resource, text-stroke, mixed/incomplete text, and color-space mismatches are returned with exact fail-closed reasons. A path whose fill reads as gray 0 may carry a freeform gradient the DOM cannot tell from gray 0, so it is left out (fill_may_be_freeform_gradient) unless treat_gray0_fills_as_solid is true.',
        inputSchema: {
            expected_document_key: z.string().min(1).max(16_384),
            match: colorMatchSchema,
            replacement: replacementColorSchema,
            limit: z.number().int().min(2).max(16).default(16),
            cursor: z.string().min(1).max(32_768).optional(),
            treat_gray0_fills_as_solid: z.boolean().default(false).describe('Set true only after confirming the document has no freeform gradient: a fill that reads as gray 0 may be one, and a solid replacement destroys it.'),
        },
        outputSchema: { result: colorReplacementPlanSchema },
        annotations: READ_ONLY,
    }, async (params) => text(await operations.planColorReplacement({
        expectedDocumentKey: params.expected_document_key,
        match: params.match,
        replacement: params.replacement,
        limit: params.limit,
        treatGray0FillsAsSolid: params.treat_gray0_fills_as_solid,
        ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
    })));
    server.registerTool('illustrator_check_text_consistency', {
        title: 'Check Illustrator Text Consistency',
        description: 'Read-only scan of every TextFrame for placeholder text (fixed catalogue), trailing and consecutive whitespace, consecutively repeated Latin words, and case / full-width vs half-width spelling variants of the same token across the document. Rules are fixed and documented; nothing is inferred beyond them. ' + PREFLIGHT_DESCRIPTION_SENTENCE,
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
                { type: 'text', text: JSON.stringify(output.result) },
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
        description: 'Render one explicit rectangle of the bound document to a PNG and return it as MCP image content, without changing the document. bounds is [left, top, right, bottom] in document points, integer edges, at most 2048 pt per side, entirely inside one artboard; the image is 72 ppi, anti-aliased, transparent where uncovered (RGBA), or RGB when artwork covers every pixel. Only a document with unsaved changes (saved=false) is captured; a saved document is refused before anything is written. Needs the screen unlocked and Illustrator frontmost, or activate_if_needed=true to bring Illustrator to the front (app focus only; focus is not restored). If the document state changes during the capture, the call is an error and no image is returned. The temporary PNG is removed afterwards.',
        inputSchema: {
            expected_document_key: z.string().min(1).max(16_384),
            bounds: previewBoundsSchema,
            activate_if_needed: z.boolean().default(false),
        },
        outputSchema: { result: previewResultSchema },
        annotations: { ...READ_ONLY, readOnlyHint: false },
    }, async (params) => {
        const output = await operations.capturePreview({
            expectedDocumentKey: params.expected_document_key,
            bounds: params.bounds,
            activateIfNeeded: params.activate_if_needed,
        });
        return {
            content: [
                { type: 'text', text: JSON.stringify(output.result) },
                { type: 'image', data: output.png.toString('base64'), mimeType: 'image/png' },
            ],
            structuredContent: { result: output.result },
        };
    });
    server.registerTool('illustrator_render_artboards', {
        title: 'Render Artboards',
        description: `PNG of each artboard via imageCapture, document unchanged; compare_to a render set gives changed pixels, box and diff PNG per artboard. source current: open document, saved=false only; file: its saved file via a private copy (baseline). Illustrator frontmost, screen unlocked. Max ${RENDER_LIMITS.artboards} artboards, ${RENDER_LIMITS.pixels / 1_000_000} Mpx per call. Sets last while the server runs.`,
        inputSchema: {
            expected_document_key: z.string().min(1).max(16_384),
            source: z.enum(['current', 'file']).default('current'),
            artboards: z.array(z.number().int().min(0).max(9999)).min(1).max(RENDER_LIMITS.artboards).optional(),
            resolution_ppi: z.number().int().min(72).max(144).multipleOf(72).default(72),
            compare_to: z.string().min(1).max(128).optional(),
            threshold: z.number().int().min(0).max(255).default(0),
        },
        outputSchema: { result: renderResultSchema },
        annotations: READ_ONLY,
    }, async (params) => {
        const output = await operations.renderArtboards({
            expectedDocumentKey: params.expected_document_key, source: params.source, ...(params.artboards === undefined ? {} : { artboards: params.artboards }),
            resolution: params.resolution_ppi, ...(params.compare_to === undefined ? {} : { compareTo: params.compare_to }),
            threshold: params.threshold, maxInlineImages: RENDER_LIMITS.inlineImages,
        });
        return {
            content: [
                { type: 'text', text: JSON.stringify(output.result) },
                ...output.images.flatMap((image) => [{ type: 'text', text: image.label }, { type: 'image', data: image.png.toString('base64'), mimeType: 'image/png' }]),
            ],
            structuredContent: { result: output.result },
        };
    });
    server.registerTool('illustrator_extract_text', {
        title: 'Extract All Text',
        description: `Read every text frame's text by artboard, document unchanged: paragraphs split at CR, lines at U+0003 (forced break), with trailing-break flags. Illustrator frontmost, screen unlocked, or activate_if_needed=true to bring the configured Illustrator to the front (app focus only: no document is selected or saved). Max ${TEXT_EXTRACT_LIMITS.frames} frames, ${TEXT_EXTRACT_LIMITS.characters} chars per call; continue at truncated.nextStartIndex.`,
        inputSchema: {
            expected_document_key: z.string().min(1).max(16_384),
            start_index: z.number().int().min(0).max(99999).default(0),
            activate_if_needed: z.boolean().default(false),
        },
        outputSchema: { result: textExtractResultSchema },
        annotations: { ...READ_ONLY, readOnlyHint: false },
    }, async (params) => text(await operations.extractText({
        expectedDocumentKey: params.expected_document_key,
        startIndex: params.start_index,
        activateIfNeeded: params.activate_if_needed,
    })));
    server.registerTool('illustrator_list_selection', {
        title: 'List Illustrator Selection',
        description: 'Read selected objects using Illustrator native UUIDs. This tool never writes metadata. While a text range is selected, items is empty and text_selection gives the frames, offset and length.',
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
        description: 'Read-only. Lists every named paragraph and character style of the bound document with its collection index and the attributes it actually defines (an attribute the style does not define is reported as undefined, not guessed). Names that resolve to more than one style are reported as conflicts, and those names are refused by every style mutation. With target {uuid, start, end}, also reports one TextFrame\'s character range (bounded to 256 characters and 64 paragraphs): each character\'s resolved attributes, the styles it reports as applied, and the override difference against that style, limited to the fields the style defines. Style resources and text are never written by this tool.',
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
        title: 'Find Installed Illustrator Fonts',
        description: 'Read-only. Look up fonts by PostScript name; needs no open document and touches none. Give either post_script_names (up to 32 exact names; each returns installed, unverified or not_installed, in request order, no fuzzy match) or query (1-64 characters; case-insensitive partial match on PostScript name, family or style, ASCII letters only; 50 per page sorted by PostScript name; matched is the total; pass next_cursor as cursor). unverified means Illustrator resolves the name but no font list shows it; font writes refuse it. Use the PostScript name with illustrator_set_text_style or illustrator_replace_font. Composite fonts are not supported for font writes.',
        inputSchema: {
            post_script_names: z.array(fontPostScriptNameSchema).min(1).max(FONT_LOOKUP_MAX_NAMES).optional(),
            query: fontQuerySchema.optional(),
            cursor: fontCursorSchema.optional(),
        },
        outputSchema: { result: z.union([fontLookupResultSchema, fontSearchResultSchema]) },
        annotations: READ_ONLY,
    }, async (params) => {
        if ((params.post_script_names === undefined) === (params.query === undefined)) {
            throw new Error('illustrator_find_fonts: give exactly one of post_script_names or query.');
        }
        if (params.post_script_names !== undefined) {
            if (params.cursor !== undefined)
                throw new Error('illustrator_find_fonts: cursor is only used with query.');
            return text(await operations.findFonts({ postScriptNames: params.post_script_names }));
        }
        return text(await operations.searchFonts({ query: params.query, ...(params.cursor === undefined ? {} : { cursor: params.cursor }) }));
    });
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
    server.registerTool('illustrator_measure_scale_reference', {
        title: 'Measure a Scale Reference',
        description: 'Read-only. From 1-8 references, each a real length actual_mm (mm) and the same length in the document (kind points: [x, y] from/to in points; kind path: one PathItem by native UUID, measure length (default) or chord), returns per reference the factor and scale_percent (actual_mm * 72 / 25.4 / measured pt), and the median as summary with the spread and a hint for a mm-read-as-pt drawing (283.464567%). Names no dimension text. Bound by expected_document_key; writes nothing.',
        inputSchema: {
            expected_document_key: z.string().min(1).max(16_384),
            references: z.array(z.record(z.string(), z.unknown())).min(1).max(SCALE_REFERENCE_MAX_REFERENCES),
        },
        outputSchema: { result: measureScaleReferenceResultSchema },
        annotations: READ_ONLY,
    }, async (params) => text(await operations.measureScaleReference({
        expectedDocumentKey: params.expected_document_key,
        references: params.references.map((reference) => scaleReferenceInputSchema.parse(reference)),
    })));
    server.registerTool('illustrator_get_area_text_options', {
        title: 'Get Illustrator Area-Text Options',
        description: 'Read-only. Returns the column and row layout (columnCount, columnGutter, rowCount, rowGutter, flowLinksHorizontally), frame bounds and matrix, contents, fit, and lock and visibility state of one unthreaded, horizontal AREATEXT frame directly on a layer, bound by document key and native UUID, with the reasons illustrator_set_area_text_columns would refuse to edit it. fit is fits (every story character visible), overflows (only a leading part visible) or indeterminate (the edit refuses it). Area inset is not reported. Threaded, vertical and grouped frames are refused.',
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
    server.registerTool('illustrator_audit_typography', {
        title: 'Audit Typography',
        description: 'Read-only typography audit of text frames (all, or target_uuids), bound by expected_document_key; nothing in the document changes. policy selects jp_line_break_v1 (line-start and line-end prohibitions, unbreakable splits, protected_terms splits, half-width punctuation, overset; the default), jp_justify_body_v1 (runs only with the justify_body input), jp_paragraph_shape_v1 (runs only with the paragraph_shape input: short line heads and last lines from the composed line ranges; loose_line judges the em increase of the character pitch over the nominal advance on soft-wrapped lines of fully justified paragraphs, measured on an outlined copy in a scratch document, so it needs Illustrator frontmost and the screen unlocked and skips with a reason what it cannot match; setting_combination reports justified paragraphs with the mojikumi sets and kerning methods you name, attributes only) and/or latin_body_v1 (Latin body text; runs only the latin_body.rules asked for, each with the units, threshold or terms it needs; a rule this version cannot judge is listed in latin_body.rules_skipped and makes status partial; language is never inferred) and/or jp_setting_profile_v1 (runs only with setting_profile: preset names one of the three recommended settings of the Adobe manual (beta-gumi, tsume-gumi with metrics or optical kerning), expected lists the settings you require and wins over the preset, reported per range or paragraph, and kinsoku/mojikumi none is an undefined paragraph setting; frame_extent flags a one-column rectangular area frame whose inner width, or height if vertical, is not a whole number of character advances and returns frame_heights as evidence; no value is assumed). Ruby, warichu, ideographic numerals and style overrides are not judged. Path, threaded, locked or hidden, vertical point, empty and too large frames are skipped with a reason and make status partial. A scope too large for one result is read in pages: when next_cursor is present, call again with the same request and cursor (the result says where the page ended; no cursor means nothing is left). result_format grouped (default) says what findings share once and lists each range as [start, end, line_index, position]; findings returns one entry per finding. A page stops at max_findings or max_response_bytes.',
        inputSchema: {
            expected_document_key: z.string().min(1).max(16_384),
            target_uuids: z.array(z.string().min(1).max(255)).min(1).max(JP_AUDIT_LIMITS.targets).optional(),
            policy: z.array(z.enum(JP_AUDIT_POLICIES)).min(1).max(JP_AUDIT_POLICIES.length).default(['jp_line_break_v1']),
            justify_body: jpAuditJustifyBodySchema.optional(),
            paragraph_shape: jpAuditParagraphShapeSchema.optional(),
            latin_body: jpAuditLatinBodySchema.optional(),
            setting_profile: jpAuditSettingProfileSchema.optional(),
            line_start_relaxations: z.array(z.enum(LINE_START_RELAXATIONS)).max(LINE_START_RELAXATIONS.length).default([]),
            halfwidth_punctuation: z.enum(['report', 'ignore']).default('report'),
            protected_terms: z.array(jpAuditProtectedTermSchema).max(JP_AUDIT_LIMITS.terms).default([]),
            max_findings: z.number().int().min(1).max(JP_AUDIT_LIMITS.findings).default(200),
            max_response_bytes: z.number().int().min(4_096).max(JP_AUDIT_RESPONSE_BYTES.max).default(JP_AUDIT_RESPONSE_BYTES.default),
            result_format: z.enum(JP_AUDIT_RESULT_FORMATS).default('grouped'),
            cursor: z.string().min(1).max(32_768).optional(),
        },
        outputSchema: { result: jpAuditResultSchema },
        annotations: READ_ONLY,
    }, async (params) => text(await operations.auditTypography({
        expectedDocumentKey: params.expected_document_key,
        ...(params.target_uuids === undefined ? {} : { targetUuids: params.target_uuids }),
        lineStartRelaxations: params.line_start_relaxations,
        halfwidthPunctuation: params.halfwidth_punctuation,
        protectedTerms: params.protected_terms.map((term) => term.text),
        maxFindings: params.max_findings,
        maxResponseBytes: params.max_response_bytes,
        resultFormat: params.result_format,
        ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
        policies: params.policy,
        ...(params.justify_body === undefined ? {} : { justifyBody: params.justify_body }),
        ...(params.paragraph_shape === undefined ? {} : { paragraphShape: params.paragraph_shape }),
        ...(params.latin_body === undefined ? {} : { latinBody: params.latin_body }),
        ...(params.setting_profile === undefined ? {} : { settingProfile: params.setting_profile }),
    })));
    server.registerTool('illustrator_analyze_display_spacing', {
        title: 'Analyze Display Spacing',
        description: 'Read-only letter-spacing analysis of one headline or logotype frame: horizontal point or area text, one line, at most 64 UTF-16 units, one font size, Latin or Japanese. measure="outline" (default) outlines a copy in a scratch unsaved document (briefly active, closed unsaved); it needs Illustrator frontmost and the screen unlocked, and returns per-pair ink gaps, white and heuristic kerning_change (1/1000 em) toward the median white or target_white_em. measure="state_only" reads kerning and tracking settings and opens nothing. include_preview adds a 288 ppi PNG. Path, vertical, threaded, locked, hidden, transformed and multi-line frames are refused. Candidates are heuristic: judge at the final size. The document, selection and view must not change. A timeout is indeterminate: run illustrator_reconcile, then close any reported scratch document with illustrator_close_document.',
        inputSchema: {
            expected_document_key: z.string().min(1).max(16_384),
            target_uuid: z.string().min(1).max(255),
            measure: z.enum(['outline', 'state_only']).default('outline'),
            target_white_em: z.number().min(0).max(2).optional(),
            depth_cap_em: z.number().min(0.05).max(1).default(0.25),
            include_preview: z.boolean().default(false),
        },
        outputSchema: { result: displaySpacingResultSchema },
        annotations: READ_ONLY,
    }, async (params) => {
        const output = await operations.analyzeDisplaySpacing({
            expectedDocumentKey: params.expected_document_key,
            targetUuid: params.target_uuid,
            measure: params.measure,
            ...(params.target_white_em === undefined ? {} : { targetWhiteEm: params.target_white_em }),
            depthCapEm: params.depth_cap_em,
            includePreview: params.include_preview,
        });
        if (output.png === null)
            return text(output.result);
        return {
            content: [
                { type: 'text', text: JSON.stringify(output.result) },
                { type: 'image', data: output.png.toString('base64'), mimeType: 'image/png' },
            ],
            structuredContent: { result: output.result },
        };
    });
    server.registerTool('illustrator_plan_text_fit', {
        title: 'Plan Text Fit',
        description: 'Read-only search for the tracking and/or horizontal scale (the condensed-type percentage) at which one horizontal, unthreaded, unlocked area-text frame (at most 150 UTF-16 units) shows all its text. Measured on Illustrator 30.8.2 (public P0): candidate order, fit and line counts and the first fitting value match an independent reading, the source stays unchanged and no scratch document is left. The real frame is duplicated into a scratch unsaved document (briefly active, closed unsaved; needs Illustrator frontmost and the screen unlocked), the copy is checked equal to the source (text, paragraphs, every character attribute, frame shape, line breaks, fit), and candidates are tried one by one from the original values, never chained; the fit comes from the visible lines, with the line count. Each axis runs from max down to min in steps (set max to the current value). With both axes, tracking_first tries every tracking value at a scale before lowering the scale one step, horizontal_scale_first the reverse. The first candidate that fits, with at most constraint.max_lines lines, is chosen and the search stops; no binary search. max_candidates (default 50, at most 100) bounds the grid before any host call, and a host time budget can end the search early (incomplete_deadline). The caller decides the smallest acceptable tracking and horizontal scale by setting min: this tool does not judge legibility or labeling rules. next_call is the plan call of illustrator_set_text_composition writing the chosen values to the whole frame, given only when that tool accepts them (its own preflight; tracking whole, scale up to 4 decimals); else null with next_call_unavailable. Point, vertical, path, threaded, locked, hidden and mixed-value frames are refused. The source must read back unchanged and the scratch document closed, or there is no result. A timeout is indeterminate: run illustrator_reconcile, then close any reported scratch document with illustrator_close_document.',
        inputSchema: z.strictObject({
            expected_document_key: z.string().min(1).max(16_384),
            target_uuid: z.string().min(1).max(255),
            search: planTextFitSearchSchema,
            constraint: planTextFitConstraintSchema.default({ require_fits: true }),
            max_candidates: z.number().int().min(1).max(PLAN_TEXT_FIT_LIMITS.candidates).default(PLAN_TEXT_FIT_LIMITS.defaultCandidates),
        }),
        outputSchema: z.object({ result: planTextFitResultSchema }),
        annotations: READ_ONLY,
    }, async (params) => {
        return text(await operations.planTextFit({
            expectedDocumentKey: params.expected_document_key,
            targetUuid: params.target_uuid,
            tracking: params.search.tracking ?? null,
            horizontalScale: params.search.horizontal_scale ?? null,
            order: params.search.order,
            maxLines: params.constraint.max_lines ?? null,
            maxCandidates: params.max_candidates,
        }));
    });
    server.registerTool('illustrator_plan_text_increment', {
        title: 'Plan Text Increment',
        description: 'Read-only plan that moves the dates, weekdays and numbers of one TextFrame by a rule and returns only the characters that change, as ranges for illustrator_replace_text_range. year is required (the year of dates written without one; weekdays are recomputed from the real calendar, never trusted). rule: date_shift (days, may be negative), date_set (to YYYY-MM-DD; exactly one date in the text), number_add (delta; every number in the text, or only occurrence n, 0-based; digit count and commas kept). Notation is kept as written: full/half-width digits, zero padding, brackets, separators. Dates M/D, M月D日, YYYY/M/D, YYYY年M月D日, and M.D only with a weekday right after it (8.24（月）), with an optional （火） or (火); times are left alone. A month that goes back inside the frame (12/28（月）〜1/4（月）) is year + 1 only when its weekday fits year + 1 and not year. An edit changes the fewest characters (8/10 -> 8/11 is the last digit), so per-character styling of the rest is untouched. A wrong weekday in the text is a warning and is corrected. Not decided, never guessed: Japanese-era years, English weekdays, a dot date without weekday, a day without its month, a month that goes back with no weekday proof, slash dates in two readings, decimals, numbers beside Latin letters or over 9 digits; any of these makes status blocked and next_calls empty. next_calls are plan calls of illustrator_replace_text_range ordered back to front, so a length change never moves an edit still to come; run each plan and its apply in order. Reads the text once with the get_object read; whether replace_text_range accepts the frame is decided by its own plan.',
        inputSchema: z.strictObject({
            expected_document_key: z.string().min(1).max(16_384),
            target_uuid: z.string().min(1).max(255),
            year: z.number().int().min(1900).max(2200),
            rule: textIncrementRuleSchema,
        }),
        outputSchema: z.object({ result: planTextIncrementResultSchema }),
        annotations: READ_ONLY,
    }, async (params) => text(await operations.planTextIncrement({
        expectedDocumentKey: params.expected_document_key,
        targetUuid: params.target_uuid,
        year: params.year,
        rule: params.rule,
    })));
    for (const adapter of mutationAdapters.list()) {
        server.registerTool(adapter.tool.name, {
            title: adapter.tool.title,
            description: adapter.tool.description + (adapter.hostVersionOperation === undefined ? '' : ' ' + HOST_VERSION_SCOPE_NOTE),
            inputSchema: adapter.tool.inputSchema,
            outputSchema: z.object({
                result: RESPONSE_VIEWS[adapter.tool.name]?.outputSchema ?? adapter.tool.outputSchema,
                ...(NEXT_CALL_BUILDERS[adapter.tool.name] === undefined ? {} : { next_call: nextCallSchema.optional() }),
                next_steps: nextStepsSchema.optional(),
                ...(rasterToolStep(adapter.operation) === undefined ? {} : { decode: rasterToolStep(adapter.operation).decodeSchema.optional() }),
                ...(adapter.hostVersionOperation === undefined ? {} : { host_version: hostVersionNoteSchema.optional() }),
                ...(DIRTY_FILE_ADMISSION_OPERATIONS.has(adapter.operation) ? { document_admission: documentAdmissionNoteSchema.optional() } : {}),
                ...(adapter.operation === REPLACE_RGB_BLACK_OPERATION ? { selection: rgbBlackSelectionSchema.optional() } : {}),
            }),
            annotations: adapter.tool.annotations,
        }, async (params) => {
            const checked = await adapter.tool.publicInputSchema.safeParseAsync(params, { error: toolArgumentIssueMessage });
            if (!checked.success)
                throw new Error(formatToolArgumentError(adapter.tool.name, checked.error.issues));
            let executed;
            const view = RESPONSE_VIEWS[adapter.tool.name];
            let requestParams = params;
            let rgbBlackSelection;
            if (adapter.operation === REPLACE_RGB_BLACK_OPERATION && requestParams.apply !== true && requestParams.target_uuids === undefined) {
                const picked = await operations.selectRgbConvertedBlackTargets({ expectedDocumentKey: String(requestParams.expected_document_key) });
                rgbBlackSelection = picked.summary;
                if (picked.targets.length === 0) {
                    const nothing = text({ outcome: { operation: REPLACE_RGB_BLACK_OPERATION, applied: false, no_eligible_targets: true, document: picked.document } });
                    const selectionOnly = { selection: picked.summary };
                    return {
                        content: [...nothing.content, { type: 'text', text: JSON.stringify(selectionOnly) }],
                        structuredContent: { ...nothing.structuredContent, ...selectionOnly },
                    };
                }
                requestParams = { ...requestParams, target_uuids: picked.targets.map((target) => target.uuid) };
            }
            const normalizedInput = adapter.tool.normalizePublicInput(view === undefined ? requestParams : view.expand(requestParams, SNAPSHOT_REFS));
            const rasterStep = rasterToolStep(adapter.operation);
            const rasterPre = rasterStep === undefined ? null : await rasterStep.pre(normalizedInput);
            try {
                executed = await operations.executeAdapterWithHostVersion(adapter.operation, normalizedInput);
            }
            catch (error) {
                if (!(error instanceof SvgTextPlanBlockedError || error instanceof GuidedRefusalError))
                    throw error;
                const refusal = { code: error.reason, message: error.message, next_steps: error.nextSteps() };
                return { isError: true, content: [{ type: 'text', text: JSON.stringify(refusal) }] };
            }
            const { response, hostVersion } = executed;
            let rasterDecode;
            if (rasterStep !== undefined && rasterPre !== null) {
                const post = await rasterStep.post(operations, rasterPre, response);
                if (post.mismatch !== null)
                    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ...post.mismatch, result: response }) }] };
                rasterDecode = { decode: post.decode };
            }
            const builtNextCall = buildNextCall(adapter.tool, requestParams, response);
            const nextCall = builtNextCall === undefined || view === undefined ? builtNextCall : view.nextCall(builtNextCall, SNAPSHOT_REFS);
            const guidance = nextCall === undefined ? buildBlockedNextSteps(response) : undefined;
            const guided = nextCall !== undefined ? { next_call: nextCall } : guidance !== undefined ? { next_steps: guidance } : undefined;
            const withDecode = rasterDecode === undefined ? guided : { ...guided, ...rasterDecode };
            const withVersion = hostVersion === null ? withDecode : { ...withDecode, host_version: hostVersion };
            const admission = DIRTY_FILE_ADMISSION_OPERATIONS.has(adapter.operation) ? documentAdmissionNote(response) : null;
            const withAdmission = admission === null ? withVersion : { ...withVersion, document_admission: admission };
            const extra = rgbBlackSelection === undefined ? withAdmission : { ...withAdmission, selection: rgbBlackSelection };
            const shown = view === undefined ? response : view.render(response);
            if (extra === undefined)
                return text(shown);
            const result = text(shown);
            return {
                content: [...result.content, { type: 'text', text: JSON.stringify(extra) }],
                structuredContent: { ...result.structuredContent, ...extra },
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
        description: 'Create one new, unsaved Illustrator document (RGB or CMYK, one artboard of width_pt x height_pt, optional artboard name) and return its context. It becomes the active document, and existing document keys change in the index segment, so re-read them. It is mutable as mutationProfile unsaved_document and needs no backup (it has no file). Verification failures close only the created document, without saving. Refused while a backup or export session is unresolved. A timeout is indeterminate and may leave the new document open.',
        inputSchema: createDocumentPublicInputSchema.shape,
        outputSchema: { result: createDocumentResultSchema },
        annotations: BACKUP,
    }, async (params) => text(await operations.createDocument(normalizeCreateDocumentPublicInput(params))));
    server.registerTool('illustrator_save_document_as', {
        title: 'Save Illustrator Document As New File',
        description: 'Save the bound active Illustrator document (saved, unsaved, or with pending changes) to a new .ai file at output_path and return its new context. output_path must be absolute, end with .ai, not exist, and sit in an existing directory owned by the current user. Illustrator never writes output_path itself: the file is staged, verified and published without overwriting, and the document switches to it as a new object with a new key (page-item UUIDs are not preserved, undo history is lost); re-read it from the result. Optional compatibility cc or cs6 writes an older-compatible file (checked by its header marks); the document stays bound to that file and is shown as having unsaved changes (reopenedAsConverted). A later save by Illustrator itself writes the current version, not the older one, and illustrator_create_backup cannot yet back up an older-version file, so an in-place save through this server is refused. The output keeps the embedded ICC profile on and follows the PDF-compatible content and the compression of the file the document came from (the result\'s options says so; a document without a file yet keeps the default of on, and a document whose file cannot show them is refused with save_attributes_unreadable before anything is written). The file the document pointed at before stays unchanged. The run is recorded as a save-as session first; until it is resolved, every mutation, backup, export and save-as is refused. An indeterminate or retained result returns saveAsId and a nextCall to illustrator_reconcile_save_as.',
        inputSchema: saveDocumentAsPublicInputSchema.shape,
        outputSchema: { result: saveDocumentAsResultSchema },
        annotations: BACKUP,
    }, async (params) => text(await operations.saveDocumentAs(normalizeSaveDocumentAsPublicInput(params))));
    server.registerTool('illustrator_save_document', {
        title: 'Save Illustrator Document In Place (Overwrite With Backup)',
        description: 'Overwrite the file of the bound, file-backed active Illustrator document with its pending changes. Destructive: backup_id must be a verified illustrator_create_backup record whose SHA-256 matches the file on disk, otherwise the call is rejected before Illustrator is touched. The path must be canonical (no symbolic link). A clean document is rejected with nothing_to_save; an unsaved document has no file (use illustrator_save_document_as). If the file changes just before the save, nothing is written and the result is indeterminate. The document key changes after a save: re-read it. Refused while a backup or export session is unresolved. With an open edit session, backup_id must be that session\'s backup; above 3,000 items ask before accept_chunked_scan_window=true. If a scan does not finish, nothing is written; run it again and do not restart Illustrator before saving. A timeout is indeterminate: keep the lock, use illustrator_reconcile with the same command_id, and do not resend the save. The save keeps the embedded ICC profile, the PDF-compatible content and the compression of the file (it saves the way File > Save does, with Illustrator\'s own remembered options); the result reads these from the file bytes before and after (attributes: each attribute is preserved, changed or unknown, and verified is true only when all are preserved). An attribute the bytes cannot show, such as the compression of an older-version file, is unknown and is not reported as kept. If an attribute changed, the outcome is saved_attributes_changed (the file was written; the message gives the backup path to copy back by hand, which loses later edits; no tool here restores a backup), never saved. On Windows a file that holds an ICC profile is refused (icc_profile_save_unsupported) until that save is measured there.',
        inputSchema: saveDocumentPublicInputSchema.shape,
        outputSchema: { result: saveDocumentResultSchema },
        annotations: DESTRUCTIVE_WITH_BACKUP,
    }, async (params) => text(await operations.saveDocument(normalizeSaveDocumentPublicInput(params))));
    server.registerTool('illustrator_open_edit_session', {
        title: 'Open Edit Session',
        description: 'Open an edit session on one saved, clean Illustrator file so verified changes can continue while the document is dirty. An edit session is an occupancy declaration: while it is open, nobody else may edit the document. backup_id must name a verified illustrator_create_backup record of the exact bytes on disk; it is the only restore point (restoring it loses later changes). On scan_in_progress, call again with the same expected_document_key, backup_id and scan_continuation (single use; tokens expire after 10 idle minutes). Scan limits: 40 s per call, 20 minutes or 200 calls in total; a limit hit ends the scan with a rejection. illustrator_save_document with the same backup_id writes and closes the session. Detected external edits: structure, item attributes outside groups, stacking order, placed-image links. Not detected: appearance stacks, graphic styles, symbols, image pixels, profiles, document settings.',
        inputSchema: {
            expected_document_key: z.string().min(1).max(16_384),
            backup_id: z.uuid(),
            scan_continuation: scanContinuationSchema.optional(),
        },
        outputSchema: { result: openEditSessionResultSchema },
        annotations: BACKUP,
    }, async (params) => text(await operations.openEditSession({ expectedDocumentKey: params.expected_document_key, backupId: params.backup_id,
        ...(params.scan_continuation === undefined ? {} : { scanContinuation: params.scan_continuation }) })));
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
        description: 'action=close ends an open or suspended edit session without saving: the document keeps its changes and stays unsaved. Use it when the user has saved the file (Cmd+S) themselves; until then further changes are refused, and the save changes the document key (read it again). If the user saved while the session was open, the next context read or change suspends it (file_changed); close it then. The session backup stays the restore point. action=quarantine moves one unreadable session record out of the live state so mutations can continue; a readable record is refused. Both need session_id and an identical confirm_session_id, and run under the active-command lock. A suspended session cannot be resumed.',
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
        description: 'Open one existing .ai file in Illustrator and return its context; nothing is written. path must be absolute, end with .ai, and be a regular file outside the MCP state root. A file that is already open is rejected with already_open and the open document\'s identity; bind that key instead. The opened document becomes the active document, and existing document keys change in the index segment, so re-read them. Refused while a backup or export session is unresolved. Only a document this call created is closed on a verification failure, without saving. A timeout is indeterminate; a missing-font or profile dialog is unmeasured and can time out. Locked-screen behaviour is unmeasured.',
        inputSchema: openDocumentPublicInputSchema.shape,
        outputSchema: { result: openDocumentResultSchema },
        annotations: BACKUP,
    }, async (params) => text(await operations.openDocument(normalizeOpenDocumentPublicInput(params))));
    server.registerTool('illustrator_activate_document', {
        title: 'Activate Illustrator Document',
        description: 'Bring one open document to the front so the tools that bind the active document can use it: list_documents, then this, then backup / read / change / save / export / close. expected_document_key is the full key from the list_documents you just read; a stale key is rejected with document_key_mismatch and is never corrected (read the list again, do not guess the new index). Nothing in any document is changed or saved, and the selection, active layer, active artboard and view of every open document are compared before and after (a difference is returned as unverified, not reverted). Use result.document.key for every following call on this document: the index segment of every key may change. A dirty or never-saved document can be activated; the following tools apply their own rules. An already-active document returns already_active without a write. Measured on Illustrator 30.8.2 with Illustrator in front and the screen unlocked only: otherwise it is refused with host_profile_unsupported and nothing is sent. It does not bring the application to the front. A timeout, or a verification that finds the document set or an identity changed, is indeterminate and blocks later changes until illustrator_reconcile: call illustrator_list_documents first (the document with active:true is the current one), then reconcile and use a fresh key. A refused or failed activation (failed) and a moved view member (unverified) block nothing.',
        inputSchema: activateDocumentPublicInputSchema.shape,
        outputSchema: { result: activateDocumentResultSchema },
        annotations: ACTIVATE,
    }, async (params) => text(await operations.activateDocument(normalizeActivateDocumentPublicInput(params))));
    server.registerTool('illustrator_close_document', {
        title: 'Close Illustrator Document',
        description: 'Close the bound active Illustrator document without saving. A clean document (saved=true) closes by default. A document with unsaved changes is rejected with unsaved_changes unless discard_changes is true, which discards those changes. Nothing is written by this tool, and the file is proven unchanged. To keep changes, call illustrator_save_document_as or illustrator_save_document first. Refused while a backup or export session is unresolved. The result reports the closed identity, the remaining inventory and the new active document (null when none). Other documents keep their identity apart from the index segment of their key. Behaviour on a locked screen is unmeasured.',
        inputSchema: closeDocumentPublicInputSchema.shape,
        outputSchema: { result: closeDocumentResultSchema },
        annotations: BACKUP,
    }, async (params) => text(await operations.closeDocument(normalizeCloseDocumentPublicInput(params))));
    server.registerTool('illustrator_create_backup', {
        title: 'Create Verified Illustrator Backup',
        description: 'Copy the saved file of the bound document to a new backup file and verify the copy: only a restore-test copy is opened in Illustrator and compared with the source structure, then closed without saving; the source document and file are never written. A private backup record is published. Unsaved, dirty, or stale-key documents are rejected before any copy. A document above the structure-comparison limit is rejected as document_too_large, with its item count and the limit. backup_root must be a directory owned by the current user with mode 0700. An indeterminate result blocks mutations until illustrator_reconcile_backup releases it. Backups are never deleted automatically.',
        inputSchema: {
            expected_document_key: z.string().min(1).max(16_384),
            backup_root: z.string().min(1).max(4_096).optional(),
        },
        outputSchema: { result: createBackupResultSchema, next_steps: nextStepsSchema.optional() },
        annotations: BACKUP,
    }, async (params) => {
        const response = await operations.createBackup({
            expectedDocumentKey: params.expected_document_key,
            ...(params.backup_root === undefined ? {} : { backupRoot: params.backup_root }),
        });
        const result = text(response);
        const guidance = buildBackupNextSteps(response);
        if (guidance === undefined)
            return result;
        return {
            content: [...result.content, { type: 'text', text: JSON.stringify({ next_steps: guidance }) }],
            structuredContent: { ...result.structuredContent, next_steps: guidance },
        };
    });
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
        description: 'Check, and if needed revert, a deletion made by illustrator_delete_objects by reopening the unchanged file. It runs as an ordinary command, so it needs the Illustrator lock to be free. After an indeterminate delete the lock stays held until illustrator_reconcile with action=release_unverified (command_id and an identical confirm_command_id, once inspect reports canReleaseUnverified); while it is held this tool refuses with command_locked. action=inspect (read-only) reports whether the deletion was applied (not_applied) or revert_required. action=revert closes the open document without saving and reopens the file; unsaved changes in that document are discarded. It succeeds only when the reopened file matches the backup. It never changes a command\'s recorded outcome, and nothing is retried automatically.',
        inputSchema: reconcileDeletePublicInputSchema.shape,
        outputSchema: { result: reconcileDeleteResultSchema },
        annotations: DESTRUCTIVE_WITH_BACKUP,
    }, async (params) => text(await operations.reconcileDelete(normalizeReconcileDeletePublicInput(params))));
    server.registerTool('illustrator_export_outlined', {
        title: 'Export Outlined AI or PDF',
        description: 'Export the saved document as outlined AI or PDF using a private work copy; the source stays unchanged. pdf_preset is required for PDF. Existing output is refused by default. overwrite=true plans; apply its nextCall unchanged to archive the previous file and publish the verified output. Recovery uses illustrator_reconcile_export with explicit restore_previous or finalize_publish. Archives are retained manually.',
        inputSchema: {
            ...workCopyOverwriteFields,
            apply: z.boolean().optional(),
            expected_plan_digest: z.string().regex(/^[0-9a-f]{64}$/u).optional(),
            expected_document_key: z.string().min(1).max(16_384),
            format: z.enum(['ai', 'pdf']),
            output_path: z.string().min(1).max(4_096),
            pdf_preset: z.string().min(1).max(512).optional(),
        },
        outputSchema: { result: z.union([exportOutlinedResultSchema, workCopyOutlinedResultSchema]) },
        annotations: DESTRUCTIVE_WITH_BACKUP,
    }, async (params) => text(await operations.exportOutlined({
        expectedDocumentKey: params.expected_document_key,
        ...(params.overwrite === undefined ? {} : { overwrite: params.overwrite }),
        ...(params.apply === undefined ? {} : { apply: params.apply }),
        ...(params.expected_plan_digest === undefined ? {} : { expectedPlanDigest: params.expected_plan_digest }),
        ...(params.expected_output === undefined ? {} : { expectedOutput: params.expected_output }),
        ...(params.command_id === undefined ? {} : { commandId: params.command_id }),
        format: params.format,
        outputPath: params.output_path,
        ...(params.pdf_preset === undefined ? {} : { pdfPreset: params.pdf_preset }),
    })));
    server.registerTool('illustrator_export_pdf', {
        title: 'Export PDF with Page Selection, Marks and Bleed',
        description: 'Save chosen artboards of the bound, saved Illustrator document as one new PDF, with optional page marks and bleed, without changing the source document or file. apply=false plans and returns nextCall; apply nextCall unchanged. artboards is "all" or ranges such as "1,3" or "2-4". Marks (trim, registration, color_bars, page_information) are added only to the PDF and default off; leave trim off if the document has editable trim marks (illustrator_create_trim_marks). Bleed defaults to 0 (whole points 0-72 per side), or bleed={mode:"document",expected_mm:3}; explicit sides need a preset with Use Document Bleed Settings OFF. pdf_preset must uniquely match Illustrator\'s PDF preset list; PDF/X presets are refused. pdfx: x3_2002, x3_2003 or x4 (output_condition needs x4). preserve_editability: false for sharing and mail, true to reopen and edit. A stale plan is refused; existing output is refused by default. overwrite=true archives the previous file before verified publication; apply nextCall unchanged. An indeterminate result blocks mutations until illustrator_reconcile_export releases it.',
        inputSchema: {
            ...workCopyOverwriteFields,
            expected_document_key: z.string().min(1).max(16_384),
            output_path: z.string().min(1).max(4_096),
            pdf_preset: z.string().min(1).max(512),
            artboards: z.string().min(1).max(512).default('all'),
            marks: z.strictObject({
                trim: z.boolean().optional(),
                registration: z.boolean().optional(),
                color_bars: z.boolean().optional(),
                page_information: z.boolean().optional(),
                style: z.enum(['roman', 'japanese']).optional(),
            }).optional(),
            bleed: pdfExportBleedInputSchema.optional(),
            preserve_editability: z.boolean().optional(),
            pdfx: z.strictObject({
                standard: z.enum(['x1a_2001', 'x1a_2003', 'x3_2002', 'x3_2003', 'x4']),
                output_condition: z.strictObject({
                    identifier: z.string().min(1).max(256),
                    condition: z.string().min(1).max(256).optional(),
                    registry: z.string().min(1).max(256).optional(),
                }).optional(),
            }).optional(),
            apply: z.boolean().default(false),
            expected_plan_digest: z.string().regex(/^[0-9a-f]{64}$/).optional(),
        },
        outputSchema: { result: z.union([pdfExportResultSchema, workCopyPdfResultSchema]) },
        annotations: DESTRUCTIVE_WITH_BACKUP,
    }, async (params) => text(await operations.exportPdf({
        expectedDocumentKey: params.expected_document_key,
        ...(params.overwrite === undefined ? {} : { overwrite: params.overwrite }),
        ...(params.expected_output === undefined ? {} : { expectedOutput: params.expected_output }),
        ...(params.command_id === undefined ? {} : { commandId: params.command_id }),
        outputPath: params.output_path,
        pdfPreset: params.pdf_preset,
        artboards: params.artboards,
        marks: {
            ...(params.marks?.trim === undefined ? {} : { trim: params.marks.trim }),
            ...(params.marks?.registration === undefined ? {} : { registration: params.marks.registration }),
            ...(params.marks?.color_bars === undefined ? {} : { colorBars: params.marks.color_bars }),
            ...(params.marks?.page_information === undefined ? {} : { pageInformation: params.marks.page_information }),
            ...(params.marks?.style === undefined ? {} : { style: params.marks.style }),
        },
        bleed: Object.fromEntries(Object.entries(params.bleed ?? {}).filter(([, value]) => value !== undefined)),
        ...(params.preserve_editability === undefined ? {} : { preserveEditability: params.preserve_editability }),
        ...(params.pdfx === undefined ? {} : { pdfx: {
                standard: params.pdfx.standard,
                ...(params.pdfx.output_condition === undefined ? {} : { outputCondition: {
                        identifier: params.pdfx.output_condition.identifier,
                        ...(params.pdfx.output_condition.condition === undefined ? {} : { condition: params.pdfx.output_condition.condition }),
                        ...(params.pdfx.output_condition.registry === undefined ? {} : { registry: params.pdfx.output_condition.registry }),
                    } }),
            } }),
        apply: params.apply,
        ...(params.expected_plan_digest === undefined ? {} : { expectedPlanDigest: params.expected_plan_digest }),
    })));
    server.registerTool('illustrator_optimize_images', {
        title: 'Optimize Embedded Images to a PPI Cap',
        description: 'Downsample embedded RGB images whose effective PPI exceeds max_ppi, on a private work copy of the bound saved document, and save the result as one new .ai at output_path (must not exist); the source document and file are never written. apply=false (default) is a read-only plan: eligible targets, every excluded image with its reason, the save options and the render size. apply=true needs target_uuids from the plan (at most 10), output_path, and Illustrator in the foreground. Every target and the artboard render are verified before the one save; the output is verified and published without overwrite. The source ICC profile is not carried over, and no size reduction or codec quality is promised. Other stable versions are admitted and reported as host_version. An indeterminate result blocks mutations until illustrator_reconcile_export releases its export session.',
        inputSchema: {
            accept_unmeasured_host_version: hostVersionPublicFields.accept_unmeasured_host_version,
            expected_document_key: z.string().min(1).max(16_384),
            max_ppi: z.number().int().min(IMAGE_OPTIMIZE_MIN_PPI).max(IMAGE_OPTIMIZE_MAX_PPI),
            apply: z.boolean().default(false),
            target_uuids: z.array(z.string().min(1).max(128)).min(1).max(IMAGE_OPTIMIZE_MAX_TARGETS).optional(),
            output_path: z.string().min(1).max(4_096).optional(),
        },
        outputSchema: { result: imageOptimizeResultSchema, host_version: hostVersionNoteSchema.optional(), next_steps: nextStepsSchema.optional() },
        annotations: BACKUP,
    }, async (params) => {
        const response = await operations.optimizeImages({
            expectedDocumentKey: params.expected_document_key,
            capPpi: params.max_ppi,
            apply: params.apply,
            ...(params.target_uuids === undefined ? {} : { targetUuids: params.target_uuids }),
            ...(params.output_path === undefined ? {} : { outputPath: params.output_path }),
        });
        const result = text(response);
        const versionNote = response.outcome === 'planned' || response.outcome === 'verified'
            ? admitHostVersionPlan('optimize_images', response.document.appVersion, 'stable') : null;
        const extra = response.outcome === 'rejected' && response.reason === 'host_version_unmeasured'
            ? { next_steps: { blocked_by: ['host_version_unmeasured'], actions: ['unsupported'], note: response.message } }
            : versionNote !== null ? { host_version: versionNote } : {};
        return { ...result, content: [...result.content, { type: 'text', text: JSON.stringify(extra) }], structuredContent: { ...result.structuredContent, ...extra } };
    });
    server.registerTool('illustrator_export', {
        title: 'Export Artboards as PNG, JPEG or SVG',
        description: 'Export one artboard of the bound, saved, clean RGB document as one new PNG, JPEG or SVG file; the source document and file are never changed. apply=false returns a read-only plan and nextCall; apply those arguments unchanged. Existing outputs are refused unless single-artboard overwrite=true requests verified archival replacement; its nextCall binds expected_output. PNG/JPEG: scale 1 or 2, or single-artboard exact px (width_px/height_px, whole-point boards, frontmost and unlocked). output_dir with artboard_indexes/all_artboards exports up to 32 raster artboards all-or-nothing. Every placed image link must be readable; the plan lists links. SVG measured by public P0 on macOS stable30.8.2, foreground/unlocked: vectors, unitless pt dimensions, verified geometry (not visual equivalence). Requires artboard_index/.svg output_path; no raster/exclude_non_printing_layers/batch options. Refuses images, hidden/nonrendering/non-printing/crossing items and overlapping boards. Clipping masks and gradient fills fail verification and are never published; text is unmeasured. Unknown SVG elements/attributes are not published. Unsaved, dirty, CMYK and open-edit-session documents are refused. A timeout blocks mutations until illustrator_reconcile_export resolves it.',
        inputSchema: rasterExportToolInputShape,
        outputSchema: { result: rasterExportResultSchema },
        annotations: { ...BACKUP, destructiveHint: true },
    }, async (params) => text(await operations.rasterExport(params)));
    server.registerTool('illustrator_reconcile_save_as', {
        title: 'Reconcile Illustrator Save-As Session',
        description: 'Resolve an illustrator_save_document_as run that stopped (indeterminate, or failed with the saved file retained). A session still running in a live MCP server is never touched (in_progress). Call with action=inspect first (read-only): it reports the state and nextCall, and releases only a run that saved nothing or has already converged. switch_document (with confirm_document_key from inspect) closes the clean staged document without saving and opens the published output; nothing is written. cleanup_staging removes the hidden staging name once no document uses it; the output is untouched. abandon (confirm_save_as_id equal to save_as_id) releases the session and deletes nothing; it is the last resort. A saved file that was never published is never deleted. Mutations stay blocked until the session is released.',
        inputSchema: {
            save_as_id: z.uuid(),
            action: saveAsReconcileActionSchema.default('inspect'),
            confirm_document_key: z.string().min(1).max(16_384).optional(),
            confirm_save_as_id: z.uuid().optional(),
        },
        outputSchema: { result: saveAsReconcileResultSchema },
        annotations: RECONCILE,
    }, async (params) => text(await operations.reconcileSaveAs({
        saveAsId: params.save_as_id,
        action: params.action,
        ...(params.confirm_document_key === undefined ? {} : { confirmDocumentKey: params.confirm_document_key }),
        ...(params.confirm_save_as_id === undefined ? {} : { confirmSaveAsId: params.confirm_save_as_id }),
    })));
    server.registerTool('illustrator_reconcile_export', {
        title: 'Reconcile Illustrator Export Session',
        description: 'Resolve an unresolved illustrator_export_outlined, illustrator_export_pdf, illustrator_optimize_images or illustrator_export session after a timeout or indeterminate result. Legacy outlined/PDF/optimize sessions take action `inspect` (reads which open documents still use the work copy or output path; releases the session only when none does) or `close_work_copy` (closes the single matching document without saving, after re-verifying it). For illustrator_export sessions the result names the stop point (window) and the allowed actions: `inspect`; `close_work_copy` (only a copy matching the recorded state); `finalize` (records a publication that already happened, then cleans up); `abandon` (records the export as failed without publishing; keeps every file); or `release_quarantined` with confirm_export_id equal to export_id, after checking its files. SVG sessions also cover every document under their private stage. For overwrite sessions only, restore_previous restores a detached old inode and finalize_publish publishes the bound stage using create-only links; each requires confirm_export_id. Foreign slots are retained and named by inspect. Legacy output files are never touched, and mutations stay blocked until every session is released.',
        inputSchema: {
            export_id: canonicalCommandIdSchema,
            action: z.enum(['inspect', 'close_work_copy', 'finalize', 'abandon', 'release_quarantined', 'restore_previous', 'finalize_publish']).default('inspect'),
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
        description: windowsReadOnly ? `Inspect an indeterminate read or abandon it with confirm_command_id when execution is proven inactive. No host mutation is performed.${windowsRelease ? WINDOWS_RELEASE_SENTENCE : ''}` : 'Check durable command and transaction-phase status after a timeout or other indeterminate result, before another mutation is allowed. action=quarantine moves one command whose unsafe state is confined to it (reported by the state scan) out of the live state, unchanged, so other mutations can continue. action=release_unverified is the last resort for a stopped command whose outcome cannot be verified (inspect reports canReleaseUnverified): check the document in Illustrator first; it then records the command as released without verification, frees the lock, and leaves the document state unknown. Both actions require command_id and an identical confirm_command_id. A command is never replayed or reapplied.',
        inputSchema: {
            command_id: canonicalCommandIdSchema.optional(),
            action: (windowsReadOnly ? (windowsRelease ? z.enum(['inspect', 'abandon', 'release_unverified']) : z.enum(['inspect', 'abandon'])) : z.enum(['inspect', 'abandon', 'quarantine', 'release_unverified'])).default('inspect'),
            confirm_command_id: canonicalCommandIdSchema.optional(),
        },
        outputSchema: { result: (windowsReadOnly && !windowsRelease ? windowsDefaultCommandStatusSchema : commandStatusSchema).nullable().meta({ [PUBLISHED_DEPTH_KEY]: COMPLETE_RESULT_DEPTH }) },
        annotations: RECONCILE,
    }, async (params) => {
        const action = params.action;
        if (windowsReadOnly && (action === 'quarantine' || (action === 'release_unverified' && !windowsRelease)))
            throw new WindowsReadOnlyError();
        return text(await operations.reconcile({
            ...(params.command_id === undefined ? {} : { commandId: params.command_id }),
            abandon: action === 'abandon',
            quarantine: action === 'quarantine',
            releaseUnverified: action === 'release_unverified',
            ...(params.confirm_command_id === undefined ? {} : { confirmCommandId: params.confirm_command_id }),
        }));
    });
    installPublishedToolList(server, cacheKey);
    return server;
}
