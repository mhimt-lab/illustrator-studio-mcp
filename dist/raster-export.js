import { evaluateHostVersion, hostVersionAdmitted } from './host-version-policy.js';
import { admitHostVersionPlan, hostVersionNoteSchema } from './host-version-admission.js';
import { pathComparisonParams, sameFilePath } from './file-path.js';
import { matchingDocumentScope, withFilePathComparisons } from './file-path-identity.js';
import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readdir, rmdir, unlink } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { z } from 'zod';
import { STABLE_ILLUSTRATOR_BUNDLE_ID } from './illustrator-application.js';
import { callTimingEnabled } from './call-timing.js';
import { applyCommandIdSchema, canonicalCommandIdSchema } from './command-id.js';
import { BackupCopyError, BackupPreconditionError, copyErrorCreatedDestination, copyFileExclusive, hostDocumentIdentitySchema, inspectSourceFile, resolveBackupRoot, CTIME_ONLY_READ_ATTEMPTS, onlyCtimeDiffers, sameFileIdentity, sameFileOrSameBytes, serializeFileIdentity, verifyTrackedFile, withBackupRootScope, } from './document-backup.js';
import { assertOutputAbsent, EXPORT_CLOSE_WORK_COPY_SCRIPT, EXPORT_HELPERS, EXPORT_HOST_TIMEOUT_MS, EXPORT_INVENTORY_SCRIPT, EXPORT_OPEN_PRE_ATTEMPT_CODES, EXPORT_OPEN_WORK_COPY_SCRIPT, ExportPreconditionError, OutputPreLinkCheckError, parseExportHostError, STAGING_DIRECTORY_PREFIX, createOnceLinkAllowance, validateOutputLocation, withOutputParentScope, workCopyFileName, } from './document-export.js';
import { DEFAULT_DURABLE_FILE_POLICY } from './durable-file-policy.js';
import { ARTBOARD_INTEGER_TOLERANCE, isIntegerWithinTolerance } from './artboard-integer.js';
import { summarizeValidationFailure } from './tool-arguments.js';
import { documentKeyMatches } from './document-key.js';
import { RASTER_READ_LINKS_SCRIPT, admitLinkedFiles, rasterLinkFactSchema } from './raster-linked-files.js';
import { IndeterminateExecutionError } from './domain.js';
import { EXCLUDE_NON_PRINTING_LAYERS_DESCRIPTION, NON_PRINTING_LAYER_HELPERS, nonPrintingLayerWarning, nonPrintingLayerWarningSchema, } from './non-printing-layers.js';
import { canonicalSha256 } from './mutation-canonical.js';
import { documentContextSchema } from './mutation-result-schema-core.js';
import { atomicCreatePrivateRecord, atomicReplacePrivateRecord, readSecurePrivateRecord } from './private-record.js';
import { temporaryTwinPattern } from './state-quarantine.js';
import { assessRasterRecordSet, RASTER_EXPORT_KIND, RASTER_EXPORT_RECORD_SUFFIXES, RASTER_EXPORT_RECORD_VERSION, RASTER_EXACT_PX_RECORD_VERSION, RASTER_SVG_RECORD_VERSION, rasterExportArtifactSchema, rasterExportOptionsSchema, singleRasterExportOptionsSchema, } from './raster-export-records.js';
import { svgArtifactSchema, svgExpectedSchema, svgExportOptionsSchema } from './svg-export-records.js';
import { SvgArtifactError, SVG_EXPORT_LIMITS, svgArtboardNameMeasured, verifySvgArtifact } from './svg-export-verification.js';
import { noFollowReadFlags, noFollowNonBlockingReadFlags, noFollowDirectoryFlags, currentUid } from './platform-primitives.js';
import { isSvgExportRecord, isExactExportRecord } from './raster-export-records.js';
import { expectedOutputSchema, replacementSummarySchema, captureExpectedOutput, assertExpectedOutput, previousOutputLimit, prepareReplacementIntent, detachPreviousOutput, cleanupPreviousSlot, restorePreviousOutput, replacementSummary, assertReplacementScopes, syncReplacementDirectory, verifyReplacementFile, OutputReplacementError, } from './output-replacement.js';
import { PUBLISHED_DEPTH_KEY } from './published-tool-schema.js';
import { assessReplacementTerminal, requireReplacementTerminal, replacementPublicationPayload, replacementTerminalEvidence, ReplacementTerminalInvalidError } from './raster-overwrite-terminal.js';
export const RASTER_EXPORT_TOOL = 'illustrator_export';
export const RASTER_EXPORT_PROFILE = 'raster_export_v1';
export const RASTER_MAX_SIDE_PX = 4000;
export const RASTER_MAX_TOTAL_PX = 12_000_000;
export const RASTER_MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const MEASURED_EDGE_FRACTIONS = { 1: [0, 0.5], 2: [0, 0.25, 0.5] };
function readMeasuredEdge(edge, fractions) {
    if (!Number.isFinite(edge))
        return null;
    const magnitude = Math.abs(edge);
    const whole = Math.floor(magnitude);
    for (const measured of [...fractions, 1]) {
        if (Math.abs(magnitude - whole - measured) <= ARTBOARD_INTEGER_TOLERANCE)
            return Math.sign(edge) * (whole + measured) || 0;
    }
    return null;
}
const EDGE_NAMES = ['left', 'top', 'right', 'bottom'];
export function artifactSizeAdmitted(actual, expected, range) {
    if (range === undefined)
        return actual.width === expected.width && actual.height === expected.height;
    return actual.width >= range.width[0] && actual.width <= range.width[1] && actual.height >= range.height[0] && actual.height <= range.height[1];
}
export function describeExpectedSize(expected, range) {
    if (range === undefined)
        return `${expected.width}x${expected.height}`;
    return `${range.width[0]}-${range.width[1]} x ${range.height[0]}-${range.height[1]} px (predicted ${expected.width}x${expected.height})`;
}
export const WEB_RGB_PIXEL_CONTRACT = ({ options, artboard }) => {
    const unsupported = (reason, message) => ({ status: 'unsupported', reason, message });
    const fractions = MEASURED_EDGE_FRACTIONS[options.scale];
    const read = artboard.rect.map((edge) => readMeasuredEdge(edge, fractions));
    const edgeWarnings = [];
    artboard.rect.forEach((edge, position) => {
        if (read[position] === null)
            edgeWarnings.push({ artboardIndex: artboard.index, edge: EDGE_NAMES[position], value: edge });
    });
    if (!isIntegerWithinTolerance(artboard.origin[0]) || !isIntegerWithinTolerance(artboard.origin[1])) {
        return unsupported('artboard_ruler_origin_unmeasured', `The artboard has a non-integer ruler origin [${artboard.origin[0]}, ${artboard.origin[1]}]; only integer origins (within ${ARTBOARD_INTEGER_TOLERANCE}) are measured.`);
    }
    if (options.format === 'png' && !options.transparent && options.scale === 2) {
        return unsupported('opaque_png_2x_unmeasured', 'An opaque PNG at 2x is not measured; export it at 1x or with transparency.');
    }
    const [left, top, right, bottom] = artboard.rect.map((edge, position) => read[position] ?? edge);
    const sizePtWidth = right - left;
    const sizePtHeight = top - bottom;
    if (!(sizePtWidth > 0 && sizePtHeight > 0))
        return unsupported('empty_artboard', 'The artboard has no area.');
    const wholeSize = isIntegerWithinTolerance(sizePtWidth) && isIntegerWithinTolerance(sizePtHeight);
    const side = (sizePt) => {
        if (isIntegerWithinTolerance(sizePt)) {
            const exact = Math.round(sizePt) * options.scale;
            return { predicted: exact, range: [exact, exact] };
        }
        const predicted = Math.round(sizePt) * options.scale;
        return { predicted, range: [Math.min(predicted, Math.floor(sizePt * options.scale)), Math.max(predicted, Math.ceil(sizePt) * options.scale)] };
    };
    const widthSide = side(sizePtWidth);
    const heightSide = side(sizePtHeight);
    const width = widthSide.predicted;
    const height = heightSide.predicted;
    const range = { width: widthSide.range, height: heightSide.range };
    const rangeOpen = range.width[0] !== range.width[1] || range.height[0] !== range.height[1];
    if (!wholeSize) {
        artboard.rect.forEach((edge, position) => {
            const value = read[position] ?? edge;
            if (read[position] !== null && !isIntegerWithinTolerance(value))
                edgeWarnings.push({ artboardIndex: artboard.index, edge: EDGE_NAMES[position], value: edge });
        });
        edgeWarnings.sort((a, b) => EDGE_NAMES.indexOf(a.edge) - EDGE_NAMES.indexOf(b.edge));
    }
    if (range.width[1] > RASTER_MAX_SIDE_PX || range.height[1] > RASTER_MAX_SIDE_PX || range.width[1] * range.height[1] > RASTER_MAX_TOTAL_PX) {
        return unsupported('large_board_unmeasured', `The export would be ${range.width[1]}x${range.height[1]} px; only up to ${RASTER_MAX_SIDE_PX} px per side and ${RASTER_MAX_TOTAL_PX} px in total are measured.`);
    }
    const roundedEdges = artboard.rect.map((edge, position) => read[position] ?? edge);
    return {
        status: 'supported', width, height,
        ...(rangeOpen ? { range } : {}),
        ...(roundedEdges.some((edge, position) => edge !== artboard.rect[position]) ? { roundedEdges } : {}),
        ...(edgeWarnings.length > 0 ? { edgeWarnings } : {}),
    };
};
export function canonicalRasterScalePercent(value) {
    const rounded = Number(value.toFixed(12));
    return Object.is(rounded, -0) ? 0 : rounded;
}
export const EXACT_PX_MIN_SCALE_PERCENT = 25;
export const EXACT_PX_MAX_SCALE_PERCENT = 400;
export const EXACT_PX_SCALE_INTERVALS = {
    jpeg: [[EXACT_PX_MIN_SCALE_PERCENT, EXACT_PX_MAX_SCALE_PERCENT]],
    pngTransparent: [[EXACT_PX_MIN_SCALE_PERCENT, EXACT_PX_MAX_SCALE_PERCENT]],
    pngOpaque: [[EXACT_PX_MIN_SCALE_PERCENT, EXACT_PX_MAX_SCALE_PERCENT]],
};
export function exactPixelRasterDimensions(input) {
    const unsupported = (reason, message) => ({ status: 'unsupported', reason, message });
    const { artboard, sizeIntent } = input;
    const rawWidth = artboard.rect[2] - artboard.rect[0];
    const rawHeight = artboard.rect[1] - artboard.rect[3];
    if (!(rawWidth > 0 && rawHeight > 0))
        return unsupported('empty_artboard', 'The artboard has no area.');
    if (!isIntegerWithinTolerance(rawWidth) || !isIntegerWithinTolerance(rawHeight))
        return unsupported('target_pixel_board_unmeasured', 'Exact-px export requires whole-point artboard dimensions.');
    if (!artboard.origin.every(isIntegerWithinTolerance))
        return unsupported('artboard_ruler_origin_unmeasured', 'Exact-px export requires an integer artboard ruler origin.');
    const widthPt = Math.round(rawWidth), heightPt = Math.round(rawHeight);
    const requested = sizeIntent.mode === 'width_px' ? sizeIntent.widthPx : sizeIntent.heightPx;
    if (!Number.isInteger(requested) || requested < 1 || requested > RASTER_MAX_SIDE_PX)
        return unsupported('target_pixel_size_invalid', 'The requested side must be an integer from 1 to 4000 px.');
    const rawScale = requested / (sizeIntent.mode === 'width_px' ? widthPt : heightPt) * 100;
    const derived = (sizeIntent.mode === 'width_px' ? heightPt : widthPt) * rawScale / 100;
    if (!Number.isFinite(derived) || Math.abs(derived - Math.round(derived)) > 1e-9)
        return unsupported('target_pixel_ratio_unmeasured', 'The other side is not an integer pixel size; no rounding rule is admitted.');
    const width = sizeIntent.mode === 'width_px' ? requested : Math.round(derived);
    const height = sizeIntent.mode === 'height_px' ? requested : Math.round(derived);
    if (width < 1 || height < 1 || width > RASTER_MAX_SIDE_PX || height > RASTER_MAX_SIDE_PX || width * height > RASTER_MAX_TOTAL_PX)
        return unsupported('large_board_unmeasured', 'The output exceeds the 4000 px side or 12000000 px total ceiling.');
    const renderScalePercent = canonicalRasterScalePercent(rawScale);
    const intervals = input.format === 'jpeg' ? EXACT_PX_SCALE_INTERVALS.jpeg
        : (input.transparent === false ? EXACT_PX_SCALE_INTERVALS.pngOpaque : EXACT_PX_SCALE_INTERVALS.pngTransparent);
    if (!Number.isFinite(renderScalePercent) || !intervals.some(([min, max]) => renderScalePercent >= min && renderScalePercent <= max)) {
        const ranges = intervals.map(([min, max]) => `${min}–${max}%`).join(', ');
        return unsupported(input.format === 'png' ? 'target_pixel_png_scale_unmeasured' : 'target_pixel_scale_unmeasured', `Exact-px ${input.format === 'jpeg' ? 'JPEG' : (input.transparent === false ? 'opaque PNG' : 'transparent PNG')} admits only the supported intervals ${ranges}; scales outside them are unmeasured.`);
    }
    return { status: 'supported', width, height, renderScalePercent };
}
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
export const rasterExportInputSchema = z.strictObject({
    expected_document_key: z.string().min(1).max(16_384),
    format: z.enum(['png', 'jpeg', 'svg']),
    output_path: z.string().min(1).max(4_096).describe('Absolute path of a new file (.png, .jpg/.jpeg or .svg) in an existing folder; it must not exist.'),
    artboard_index: z.number().int().nonnegative().describe('0-based index of the one artboard to export (it need not be active).'),
    scale: z.union([z.literal(1), z.literal(2)]).optional().describe('1 (default) or 2: 1 pt becomes 1 or 2 px.'),
    width_px: z.number().int().min(1).max(4000).optional().describe('Single artboard: exact width in px, preserving aspect ratio. Not with height_px or scale; both output sides must be integer px.'),
    height_px: z.number().int().min(1).max(4000).optional().describe('Single artboard: exact height in px. Not with width_px or scale; both output sides must be integer px.'),
    transparent: z.boolean().optional().describe('PNG only; default true. false gives a white background (legacy 1x or measured exact-px).'),
    quality: z.number().int().min(0).max(100).optional().describe('JPEG only; default 80.'),
    exclude_non_printing_layers: z.boolean().optional().describe(EXCLUDE_NON_PRINTING_LAYERS_DESCRIPTION),
    apply: z.boolean().default(false),
    command_id: applyCommandIdSchema.optional(),
    confirm_export_hash: sha256Schema.optional().describe('The plan\'s planDigest, as in its nextCall arguments.'),
    overwrite: z.boolean().optional().describe('Single artboard only: back up the existing output before replacing it; default false.'),
    expected_output: z.union([expectedOutputSchema]).meta({ [PUBLISHED_DEPTH_KEY]: 0 }).optional().describe('Echo unchanged from the overwrite plan nextCall.'),
}).superRefine((input, context) => {
    if (input.expected_output !== undefined && (input.overwrite !== true || !input.apply))
        context.addIssue({ code: 'custom', path: ['expected_output'], message: 'expected_output is only accepted in an overwrite apply nextCall.' });
    if (input.overwrite === true && input.apply && input.expected_output === undefined)
        context.addIssue({ code: 'custom', path: ['expected_output'], message: 'Overwrite apply requires expected_output from the plan nextCall.' });
    if (input.format === 'svg')
        for (const key of ['scale', 'width_px', 'height_px', 'transparent', 'quality', 'exclude_non_printing_layers']) {
            if (input[key] !== undefined)
                context.addIssue({ code: 'custom', path: [key], message: `${key} cannot be combined with format "svg".` });
        }
    if (input.width_px !== undefined && input.height_px !== undefined)
        context.addIssue({ code: 'custom', path: ['width_px'], message: 'width_px and height_px are mutually exclusive.' });
    if ((input.width_px !== undefined || input.height_px !== undefined) && input.scale !== undefined)
        context.addIssue({ code: 'custom', path: ['scale'], message: 'scale cannot be combined with an exact-px side.' });
    if (input.format !== 'png' && input.transparent !== undefined)
        context.addIssue({ code: 'custom', path: ['transparent'], message: 'transparent applies to format "png" only.' });
    if (input.format !== 'jpeg' && input.quality !== undefined)
        context.addIssue({ code: 'custom', path: ['quality'], message: 'quality applies to format "jpeg" only.' });
    if (input.apply && (input.command_id === undefined || input.confirm_export_hash === undefined)) {
        context.addIssue({ code: 'custom', path: ['command_id'], message: 'apply=true needs command_id and confirm_export_hash from the plan\'s next_call.' });
    }
    if (!input.apply && (input.command_id !== undefined || input.confirm_export_hash !== undefined)) {
        context.addIssue({ code: 'custom', path: ['apply'], message: 'command_id and confirm_export_hash are for apply=true only.' });
    }
});
export function rasterOptionsOf(input) {
    if (input.format === 'svg')
        throw new Error('SVG has its own measured options, not raster options.');
    const scale = input.scale ?? 1;
    return input.format === 'png'
        ? { format: 'png', scale, transparent: input.transparent ?? true }
        : { format: 'jpeg', scale, quality: input.quality ?? 80 };
}
const artboardSchema = z.strictObject({
    index: z.number().int().nonnegative(),
    name: z.string(),
    rect: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    origin: z.tuple([z.number(), z.number()]),
});
export const rasterExportRejectionSchema = z.enum([
    'document_key_mismatch', 'document_not_admitted', 'document_dirty', 'document_not_saved', 'color_space_not_admitted',
    'artwork_not_admitted', 'edit_session_open', 'edit_session_invalid', 'artboard_out_of_range', 'source_file_unavailable',
    'export_root_unavailable', 'output_path_invalid', 'output_exists', 'output_cross_device', 'plan_changed',
    'dimension_contract_unavailable', 'command_id_conflict', 'command_id_in_use', 'export_records_invalid',
    'artifact_unavailable', 'artifact_identity_mismatch', 'too_many_artboards', 'output_dir_invalid',
    'host_not_foreground', 'host_screen_locked', 'host_profile_unknown', 'linked_file_unavailable',
    'output_changed_since_plan', 'output_previous_unsafe', 'output_previous_too_large', 'output_changed', 'replacement_unresolved', 'overwrite_not_supported_on_platform',
]);
const contextSchema = documentContextSchema;
const timingSchema = z.strictObject({ totalMs: z.number().nonnegative(), hostCalls: z.number().int().nonnegative(), hostMs: z.number().nonnegative() });
const roundedEdgesSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const edgeWarningSchema = z.strictObject({
    artboardIndex: z.number().int().nonnegative(),
    edge: z.enum(['left', 'top', 'right', 'bottom']), value: z.number(),
});
const edgeWarningFields = { edgeWarnings: z.array(edgeWarningSchema).optional() };
const rangeSideSchema = z.array(z.number().int().positive()).length(2);
const expectedRangeSchema = z.strictObject({ width: rangeSideSchema, height: rangeSideSchema });
const expectedRangeFields = { expectedRange: expectedRangeSchema.optional() };
const batchPlannedItemSchema = z.strictObject({
    artboard: artboardSchema,
    outputPath: z.string().min(1),
    expected: z.strictObject({ width: z.number().int().positive(), height: z.number().int().positive() }),
    ...expectedRangeFields,
    roundedEdges: roundedEdgesSchema.optional(),
    ...edgeWarningFields,
});
const batchBlockedItemSchema = z.strictObject({
    artboardIndex: z.number().int().nonnegative(),
    name: z.string(),
    leaf: z.string().nullable(),
    reason: z.string().min(1),
    message: z.string(),
});
export const rasterExportResultSchema = z.discriminatedUnion('outcome', [
    z.strictObject({
        outcome: z.literal('planned_batch'),
        options: rasterExportOptionsSchema,
        items: z.array(batchPlannedItemSchema),
        links: z.array(rasterLinkFactSchema).optional(),
        warnings: z.array(nonPrintingLayerWarningSchema).optional(),
        planDigest: sha256Schema,
        nextCall: z.strictObject({ tool: z.literal(RASTER_EXPORT_TOOL), arguments: z.record(z.string(), z.unknown()) }),
    }),
    z.strictObject({
        outcome: z.literal('verified_batch'),
        exportId: z.uuid(),
        delivery: z.enum(['original', 'replay']),
        artifacts: z.array(rasterExportArtifactSchema.extend({ artboardIndex: z.number().int().nonnegative() })),
        sourcePreserved: z.literal(true),
        cleanup: z.array(z.strictObject({ path: z.string().min(1), removed: z.boolean(), reason: z.string() })),
        timing: timingSchema,
    }),
    z.strictObject({
        outcome: z.literal('planned'),
        existingOutput: expectedOutputSchema.optional(),
        document: contextSchema,
        artboard: artboardSchema,
        options: z.union([singleRasterExportOptionsSchema, svgExportOptionsSchema]),
        outputPath: z.string().min(1),
        expected: z.union([z.strictObject({ width: z.number().int().positive(), height: z.number().int().positive() }), svgExpectedSchema]),
        ...expectedRangeFields,
        roundedEdges: roundedEdgesSchema.optional(),
        ...edgeWarningFields,
        links: z.array(rasterLinkFactSchema).optional(),
        warnings: z.array(nonPrintingLayerWarningSchema).optional(),
        host_version: hostVersionNoteSchema.optional(),
        planDigest: sha256Schema,
        nextCall: z.strictObject({ tool: z.literal(RASTER_EXPORT_TOOL), arguments: z.record(z.string(), z.unknown()) }),
    }),
    z.strictObject({
        outcome: z.literal('blocked'),
        reason: z.string().min(1),
        message: z.string(),
        next_steps: z.array(z.string()).optional(),
        document: contextSchema,
        items: z.array(batchBlockedItemSchema).optional(),
    }),
    z.strictObject({
        outcome: z.literal('rejected'),
        reason: rasterExportRejectionSchema,
        message: z.string(),
        document: contextSchema.nullable(),
    }),
    z.strictObject({
        outcome: z.literal('verified'),
        replacement: replacementSummarySchema.optional(),
        exportId: z.uuid(),
        delivery: z.enum(['original', 'replay']),
        artifact: z.union([rasterExportArtifactSchema, svgArtifactSchema]),
        sourcePreserved: z.literal(true),
        cleanup: z.array(z.strictObject({ path: z.string().min(1), removed: z.boolean(), reason: z.string() })),
        timing: timingSchema,
    }),
    z.strictObject({
        outcome: z.literal('failed'),
        replacement: replacementSummarySchema.optional(),
        exportId: z.uuid(),
        delivery: z.enum(['original', 'replay']),
        stage: z.string().min(1),
        reason: z.string().min(1),
        message: z.string(),
        cleanup: z.array(z.strictObject({ path: z.string().min(1), removed: z.boolean(), reason: z.string() })),
        itemIndex: z.number().int().nonnegative().nullable().optional(),
    }),
    z.strictObject({
        outcome: z.literal('indeterminate'),
        replacement: replacementSummarySchema.optional(),
        exportId: z.uuid(),
        stage: z.string().min(1),
        message: z.string(),
        commandId: z.string().nullable(),
    }),
]);
export const RASTER_READ_SOURCE_SCRIPT = `${EXPORT_HELPERS}
var rasterReadContext = requireDocumentForRead(params.expectedDocumentKey);
var rasterReadDocument = app.activeDocument;
var rasterReadBoards = [];
for (var rasterReadCursor = 0; rasterReadCursor < rasterReadDocument.artboards.length; rasterReadCursor++) {
  var rasterReadBoard = rasterReadDocument.artboards[rasterReadCursor];
  var rasterReadRect = rasterReadBoard.artboardRect;
  var rasterReadOrigin = rasterReadBoard.rulerOrigin;
  rasterReadBoards.push({ index: rasterReadCursor, name: String(rasterReadBoard.name),
    rect: [rasterReadRect[0], rasterReadRect[1], rasterReadRect[2], rasterReadRect[3]], origin: [rasterReadOrigin[0], rasterReadOrigin[1]] });
}
var rasterReadDocumentOrigin = rasterReadDocument.rulerOrigin;
var result = {
  document: rasterReadContext,
  artboards: rasterReadBoards,
  activeArtboardIndex: rasterReadDocument.artboards.getActiveArtboardIndex(),
  rulerOrigin: [rasterReadDocumentOrigin[0], rasterReadDocumentOrigin[1]],
  placedItems: rasterReadDocument.placedItems.length
};
`;
export const RASTER_EXPORT_PRE_ATTEMPT_CODES = [
    'EXPORT_WORK_COPY_NOT_UNIQUE', 'EXPORT_WORK_COPY_IDENTITY_MISMATCH', 'RASTER_WORK_COPY_NOT_ACTIVE', 'RASTER_ARTBOARDS_CHANGED', 'RASTER_STAGE_NOT_EMPTY',
];
export const RASTER_EXPORT_FAILED_CODE = 'RASTER_EXPORT_FAILED';
export const RASTER_EXPORT_SCRIPT = `${EXPORT_HELPERS}
var rasterTarget = exportRequireWorkCopy(params.workCopyPath, params.workCopyKey);
var rasterDocument = rasterTarget.doc;
if (app.activeDocument !== rasterDocument) throw new Error("MCP_ERROR:" + stringifyJson({ code: "RASTER_WORK_COPY_NOT_ACTIVE" }));
var rasterBoardsBefore = exportArtboards(rasterDocument);
var rasterBoardsChanged = rasterBoardsBefore.length !== params.artboards.length;
for (var rasterBoardCursor = 0; !rasterBoardsChanged && rasterBoardCursor < rasterBoardsBefore.length; rasterBoardCursor++) {
  var rasterActual = rasterBoardsBefore[rasterBoardCursor];
  var rasterExpected = params.artboards[rasterBoardCursor];
  if (rasterActual.name !== rasterExpected.name) rasterBoardsChanged = true;
  for (var rasterEdge = 0; rasterEdge < 4; rasterEdge++) if (!exportEdgesEqual(rasterActual.rect[rasterEdge], rasterExpected.rect[rasterEdge])) rasterBoardsChanged = true;
}
if (rasterBoardsChanged) throw new Error("MCP_ERROR:" + stringifyJson({ code: "RASTER_ARTBOARDS_CHANGED", actual: rasterBoardsBefore }));
if (new File(params.basePath).exists || new File(params.stagedPath).exists) throw new Error("MCP_ERROR:" + stringifyJson({ code: "RASTER_STAGE_NOT_EMPTY" }));
var rasterType;
var rasterOptions;
if (params.format === "png") {
  rasterType = ExportType.PNG24;
  rasterOptions = new ExportOptionsPNG24();
  rasterOptions.transparency = params.transparent === true;
} else {
  rasterType = ExportType.JPEG;
  rasterOptions = new ExportOptionsJPEG();
  rasterOptions.qualitySetting = params.quality;
}
rasterOptions.artBoardClipping = true;
rasterOptions.antiAliasing = true;
rasterOptions.horizontalScale = params.scale * 100;
rasterOptions.verticalScale = params.scale * 100;
rasterDocument.artboards.setActiveArtboardIndex(params.artboardIndex);
var rasterPreviousInteraction = app.userInteractionLevel;
app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
try {
  rasterDocument.exportFile(new File(params.basePath), rasterType, rasterOptions);
} catch (rasterExportError) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "RASTER_EXPORT_FAILED", message: String(rasterExportError.message || rasterExportError) }));
} finally {
  app.userInteractionLevel = rasterPreviousInteraction;
}
var rasterIndexAfter = -1;
for (var rasterIndexCursor = 0; rasterIndexCursor < app.documents.length; rasterIndexCursor++) {
  if (app.documents[rasterIndexCursor] === rasterDocument) rasterIndexAfter = rasterIndexCursor;
}
if (rasterIndexAfter < 0) throw new Error("MCP_ERROR:" + stringifyJson({ code: "RASTER_WORK_COPY_NOT_LISTED" }));
var result = {
  workCopy: getDocumentIdentity(rasterDocument, rasterIndexAfter),
  activeArtboardIndex: rasterDocument.artboards.getActiveArtboardIndex(),
  artboards: exportArtboards(rasterDocument),
  documentCount: app.documents.length
};
`;
export const RASTER_EXACT_EXPORT_SCRIPT = RASTER_EXPORT_SCRIPT.replace('rasterOptions.horizontalScale = params.scale * 100;\nrasterOptions.verticalScale = params.scale * 100;', 'rasterOptions.horizontalScale = params.renderScalePercent;\nrasterOptions.verticalScale = params.renderScalePercent;');
export const RASTER_READ_SOURCE_LAYERS_SCRIPT = (() => {
    const helpered = RASTER_READ_SOURCE_SCRIPT.replace(EXPORT_HELPERS, `${EXPORT_HELPERS}${NON_PRINTING_LAYER_HELPERS}`);
    const scanning = helpered.replace('  placedItems: rasterReadDocument.placedItems.length\n};', '  placedItems: rasterReadDocument.placedItems.length,\n  nonPrintingLayers: nplScanSafe(rasterReadDocument)\n};');
    if (helpered === RASTER_READ_SOURCE_SCRIPT || scanning === helpered)
        throw new Error('The raster read-source script no longer has the expected shape.');
    return scanning;
})();
function excludingNonPrintingLayers(script) {
    const helpered = script.replace(`${EXPORT_HELPERS}\nvar rasterTarget`, `${EXPORT_HELPERS}${NON_PRINTING_LAYER_HELPERS}\nvar rasterTarget`);
    const hiding = helpered.replace('try {\n  rasterDocument.exportFile(', 'try {\n  nplScan(rasterDocument, true);\n  rasterDocument.exportFile(');
    if (helpered === script || hiding === helpered)
        throw new Error('The raster export script no longer has the expected shape.');
    return hiding;
}
export const RASTER_EXPORT_EXCLUDING_SCRIPT = excludingNonPrintingLayers(RASTER_EXPORT_SCRIPT);
export const RASTER_EXACT_EXPORT_EXCLUDING_SCRIPT = excludingNonPrintingLayers(RASTER_EXACT_EXPORT_SCRIPT);
export const RASTER_RECONCILE_CLOSE_SCRIPT = `${EXPORT_HELPERS}
var rasterReconcileMatches = exportMatchesByPath(params.sessionPaths);
if (rasterReconcileMatches.length > 1) throw new Error("MCP_ERROR:" + stringifyJson({ code: "RASTER_RECONCILE_NOT_UNIQUE", count: rasterReconcileMatches.length }));
if (rasterReconcileMatches.length === 0) {
  var result = { closed: null, documents: exportRawInventory(), documentCount: app.documents.length };
} else {
var rasterReconcileEntry = rasterReconcileMatches[0].entry;
var rasterReconcileBoards = exportArtboards(rasterReconcileMatches[0].doc);
var rasterReconcileBoardsDiffer = rasterReconcileBoards.length !== params.expected.artboards.length;
for (var rasterReconcileBoard = 0; !rasterReconcileBoardsDiffer && rasterReconcileBoard < rasterReconcileBoards.length; rasterReconcileBoard++) {
  for (var rasterReconcileEdge = 0; rasterReconcileEdge < 4; rasterReconcileEdge++) {
    if (!exportEdgesEqual(rasterReconcileBoards[rasterReconcileBoard].rect[rasterReconcileEdge], params.expected.artboards[rasterReconcileBoard].rect[rasterReconcileEdge])) rasterReconcileBoardsDiffer = true;
  }
}
if (rasterReconcileEntry.path !== params.expected.path || exportKeyWithoutIndex(rasterReconcileEntry.key) !== exportKeyWithoutIndex(params.expected.key) ||
    rasterReconcileEntry.saved !== params.expected.saved || rasterReconcileEntry.fileRevision !== params.expected.fileRevision || rasterReconcileBoardsDiffer) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "RASTER_RECONCILE_CLOSE_REFUSED", actual: rasterReconcileEntry }));
}
var rasterReconcileInteraction = app.userInteractionLevel;
app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
try { rasterReconcileMatches[0].doc.close(SaveOptions.DONOTSAVECHANGES); }
finally { app.userInteractionLevel = rasterReconcileInteraction; }
var result = { closed: rasterReconcileEntry, documents: exportRawInventory(), documentCount: app.documents.length };
}
`;
const EXPORT_MATCHES_BY_SCOPE = `function exportMatchesByScope(paths, directories) {
  var exportScopeMatches = exportMatchesByPath(paths);
  var exportScopeForms = params.hostFilePathForms;
  for (var exportScopeScan = 0; exportScopeScan < app.documents.length; exportScopeScan++) {
    var exportScopeDoc = app.documents[exportScopeScan];
    var exportScopeSeen = false;
    for (var exportScopeKnown = 0; exportScopeKnown < exportScopeMatches.length; exportScopeKnown++) {
      if (exportScopeMatches[exportScopeKnown].doc === exportScopeDoc) exportScopeSeen = true;
    }
    if (exportScopeSeen) continue;
    var exportScopePath = exportPathOf(exportScopeDoc);
    var exportScopeUnder = false;
    for (var exportScopeDir = 0; exportScopeDir < directories.length && !exportScopeUnder; exportScopeDir++) {
      var exportScopeCandidates = [directories[exportScopeDir]];
      if (exportScopeForms && Object.prototype.hasOwnProperty.call(exportScopeForms, directories[exportScopeDir])) exportScopeCandidates = exportScopeForms[directories[exportScopeDir]];
      for (var exportScopeForm = 0; exportScopeForm < exportScopeCandidates.length; exportScopeForm++) {
        if (String(exportScopePath).indexOf(exportScopeCandidates[exportScopeForm] + "/") === 0) { exportScopeUnder = true; break; }
      }
    }
    if (exportScopeUnder) exportScopeMatches.push({ doc: exportScopeDoc, index: exportScopeScan, entry: exportInventoryEntry(exportScopeDoc, exportScopeScan) });
  }
  return exportScopeMatches;
}
`;
export const RASTER_RECONCILE_CLOSE_SCOPE_SCRIPT = (() => {
    const helpered = RASTER_RECONCILE_CLOSE_SCRIPT.replace(EXPORT_HELPERS, `${EXPORT_HELPERS}${EXPORT_MATCHES_BY_SCOPE}`);
    const scoped = helpered.replace('var rasterReconcileMatches = exportMatchesByPath(params.sessionPaths);', 'var rasterReconcileMatches = exportMatchesByScope(params.sessionPaths, params.sessionDirectoryPaths);');
    if (helpered === RASTER_RECONCILE_CLOSE_SCRIPT || scoped === helpered)
        throw new Error('The raster reconcile-close script no longer has the expected shape.');
    return scoped;
})();
function svgDerive(script, before, after) {
    if (script.split(before).length !== 2)
        throw new Error('The SVG host-script derivation no longer matches its pinned baseline.');
    return script.replace(before, after);
}
export const SVG_SOURCE_SCAN_LIMITS = { entries: 2000, layers: 64, depth: 8 };
const SVG_READ_SOURCE_SCRIPT = svgDerive(RASTER_READ_SOURCE_LAYERS_SCRIPT, 'var result = {', `
var svgItems = [], svgLayers = [], svgLayerStack = [], svgScanLimitReason = null;
var svgScan = { entries: 0, layers: 0, itemDepth: 0, layerDepth: 0, layerComparisons: 0, boundsReads: 0 };
var svgMaxEntries = ${SVG_SOURCE_SCAN_LIMITS.entries}, svgMaxLayers = ${SVG_SOURCE_SCAN_LIMITS.layers}, svgMaxDepth = ${SVG_SOURCE_SCAN_LIMITS.depth};
var svgRootLayers = rasterReadDocument.layers;
var svgRootLayerCount = svgRootLayers.length, svgReservedLayers = svgRootLayerCount;
if (svgRootLayerCount > svgMaxLayers) svgScanLimitReason = "layers";
else for (var svgRootLayer = 0; svgRootLayer < svgRootLayerCount; svgRootLayer++) svgLayerStack.push({ layer: svgRootLayers[svgRootLayer], hidden: false, depth: 1 });
while (svgLayerStack.length > 0 && svgScanLimitReason === null) {
  var svgLayerEntry = svgLayerStack.pop();
  var svgLayer = svgLayerEntry.layer;
  svgScan.layers++;
  if (svgLayerEntry.depth > svgScan.layerDepth) svgScan.layerDepth = svgLayerEntry.depth;
  var svgHiddenLayer = svgLayerEntry.hidden || svgLayer.visible !== true;
  // Layer.template is absent in the 30.8.2 DOM (#853); non-printing admission uses nplScanSafe below.
  svgLayers.push({ layer: svgLayer, hidden: svgHiddenLayer });
  var svgChildren = svgLayer.layers;
  var svgChildCount = svgChildren.length;
  if (svgReservedLayers + svgChildCount > svgMaxLayers) { svgScanLimitReason = "layers"; break; }
  if (svgChildCount > 0 && svgLayerEntry.depth >= svgMaxDepth) { svgScanLimitReason = "depth"; break; }
  svgReservedLayers += svgChildCount;
  for (var svgChild = 0; svgChild < svgChildCount; svgChild++) svgLayerStack.push({ layer: svgChildren[svgChild], hidden: svgHiddenLayer, depth: svgLayerEntry.depth + 1 });
}
var svgItemStack = [], svgCandidates = [], svgReservedEntries = 0;
if (svgScanLimitReason === null) {
  var svgPageItems = rasterReadDocument.pageItems;
  var svgPageItemCount = svgPageItems.length;
  if (svgPageItemCount > svgMaxEntries) svgScanLimitReason = "entries";
  else { svgReservedEntries = svgPageItemCount; svgItemStack.push({ collection: svgPageItems, count: svgPageItemCount, depth: 1 }); }
}
while (svgItemStack.length > 0 && svgScanLimitReason === null) {
  var svgItemFrame = svgItemStack.pop();
  for (var svgItemIndex = 0; svgItemIndex < svgItemFrame.count; svgItemIndex++) {
    var svgItem = svgItemFrame.collection[svgItemIndex];
    svgScan.entries++;
    if (svgItemFrame.depth > svgScan.itemDepth) svgScan.itemDepth = svgItemFrame.depth;
    var svgKind = String(svgItem.typename), svgParent = svgItem.parent, svgNonrendering = false;
    if (svgKind === "GroupItem" || svgKind === "CompoundPathItem") {
      var svgItemChildren = svgKind === "GroupItem" ? svgItem.pageItems : svgItem.pathItems;
      var svgItemChildCount = svgItemChildren.length;
      if (svgKind === "GroupItem") svgNonrendering = svgItemChildCount === 0;
      if (svgReservedEntries + svgItemChildCount > svgMaxEntries) { svgScanLimitReason = "entries"; break; }
      if (svgItemChildCount > 0 && svgItemFrame.depth >= svgMaxDepth) { svgScanLimitReason = "depth"; break; }
      svgReservedEntries += svgItemChildCount;
      if (svgItemChildCount > 0) svgItemStack.push({ collection: svgItemChildren, count: svgItemChildCount, depth: svgItemFrame.depth + 1 });
    }
    if (svgParent.typename === "Layer") svgCandidates.push({ item: svgItem, parent: svgParent, kind: svgKind, nonrendering: svgNonrendering });
  }
}
if (svgScanLimitReason === null) for (var svgCandidateIndex = 0; svgCandidateIndex < svgCandidates.length; svgCandidateIndex++) {
  var svgCandidate = svgCandidates[svgCandidateIndex], svgItem = svgCandidate.item;
  var svgHidden = svgItem.hidden === true;
  for (var svgLayerIndex = 0; svgLayerIndex < svgLayers.length; svgLayerIndex++) {
    svgScan.layerComparisons++;
    if (svgLayers[svgLayerIndex].layer === svgCandidate.parent && svgLayers[svgLayerIndex].hidden) svgHidden = true;
  }
  var svgNonrendering = svgCandidate.nonrendering;
  if (svgCandidate.kind === "PathItem") svgNonrendering = svgItem.guides === true;
  var svgBounds = null;
  if (!svgNonrendering) {
    svgScan.boundsReads++;
    var svgVisibleBounds = svgItem.visibleBounds;
    svgBounds = [svgVisibleBounds[0], svgVisibleBounds[1], svgVisibleBounds[2], svgVisibleBounds[3]];
  }
  svgItems.push({ bounds: svgBounds, hidden: svgHidden, locked: svgItem.locked === true,
    opacity: Number(svgItem.opacity), nonrendering: svgNonrendering, kind: svgCandidate.kind });
}
var svgFacts = { items: svgItems, scanLimit: svgScanLimitReason !== null, scanLimitReason: svgScanLimitReason, scan: svgScan, rasterItems: rasterReadDocument.rasterItems.length };
var result = {`);
export const SVG_READ_SOURCE_FACTS_SCRIPT = svgDerive(SVG_READ_SOURCE_SCRIPT, '  nonPrintingLayers: nplScanSafe(rasterReadDocument)', '  nonPrintingLayers: svgScanLimitReason === null ? nplScanSafe(rasterReadDocument) : { layers: [], truncated: true, unavailable: true },\n  svg: svgFacts');
export const SVG_OPEN_WORK_COPY_SCRIPT = svgDerive(svgDerive(svgDerive(EXPORT_OPEN_WORK_COPY_SCRIPT, EXPORT_HELPERS, `${EXPORT_HELPERS}${EXPORT_MATCHES_BY_SCOPE}`), 'exportMatchesByPath(params.sessionPaths)', 'exportMatchesByScope(params.sessionPaths, params.sessionDirectoryPaths)'), '  opened: exportOpenedIdentity,', '  opened: exportOpenedIdentity,\n  activeArtboardIndex: exportOpenedDocument.artboards.getActiveArtboardIndex(),');
export const SVG_CLOSE_WORK_COPY_SCRIPT = svgDerive(svgDerive(EXPORT_CLOSE_WORK_COPY_SCRIPT, EXPORT_HELPERS, `${EXPORT_HELPERS}${EXPORT_MATCHES_BY_SCOPE}`), 'exportMatchesByPath(params.sessionPaths)', 'exportMatchesByScope(params.sessionPaths, params.sessionDirectoryPaths)');
export const SVG_EXPORT_SCRIPT = (() => {
    const prefix = RASTER_EXPORT_SCRIPT.slice(0, RASTER_EXPORT_SCRIPT.indexOf('if (new File(params.basePath).exists'));
    const suffix = RASTER_EXPORT_SCRIPT.slice(RASTER_EXPORT_SCRIPT.indexOf('var rasterPreviousInteraction'));
    if (!prefix.endsWith('\n') || !suffix.startsWith('var rasterPreviousInteraction'))
        throw new Error('The SVG export derivation no longer matches its baseline.');
    return `${prefix}
if (new Folder(params.stagingDirectory).getFiles().length !== 0) throw new Error("MCP_ERROR:" + stringifyJson({ code: "RASTER_STAGE_NOT_EMPTY" }));
var rasterType = ExportType.WOSVG;
var rasterOptions = new ExportOptionsWebOptimizedSVG();
rasterOptions.saveMultipleArtboards = true;
rasterOptions.artboardRange = String(params.artboardIndex + 1);
rasterOptions.fontType = SVGFontType.OUTLINEFONT;
rasterOptions.rasterImageLocation = RasterImageLocation.EMBED;
rasterOptions.svgResponsive = false;
rasterOptions.svgMinify = false;
rasterOptions.coordinatePrecision = 3;
if (rasterOptions.saveMultipleArtboards !== true || rasterOptions.artboardRange !== String(params.artboardIndex + 1) ||
    rasterOptions.fontType !== SVGFontType.OUTLINEFONT || rasterOptions.rasterImageLocation !== RasterImageLocation.EMBED ||
    rasterOptions.svgResponsive !== false || rasterOptions.svgMinify !== false || rasterOptions.coordinatePrecision !== 3) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "RASTER_EXPORT_OPTIONS_NOT_APPLIED" }));
}
${suffix}`;
})();
export async function closeRasterWorkCopy(bridge, sessionScope, expected, lease) {
    let matches = [];
    const scope = Array.isArray(sessionScope) ? { paths: sessionScope, directories: [] } : sessionScope;
    const close = async (paths, binding, directories = []) => await bridge.execute(withFilePathComparisons({
        kind: 'read', script: directories.length === 0 ? RASTER_RECONCILE_CLOSE_SCRIPT : RASTER_RECONCILE_CLOSE_SCOPE_SCRIPT,
        params: pathComparisonParams({ sessionPaths: paths, ...(directories.length === 0 ? {} : { sessionDirectoryPaths: directories }), expected: binding }), timeoutMs: EXPORT_HOST_TIMEOUT_MS,
        hostGate: {
            beforeHost: async () => {
                if (recordSetFingerprint(await lease.records.readRasterRecordSet(lease.exportId)) !== lease.fingerprint) {
                    throw new Error('The export records changed; nothing was closed.');
                }
            },
            afterHost: async ({ data }) => { matches = await matchingDocumentScope(data, scope); },
        },
    }));
    let result = await close(scope.paths, expected, scope.directories);
    if (result.data.closed === null && matches.length === 1) {
        const target = matches[0];
        if (target.path !== expected.path || target.key.replace(/\|index=-?\d+\|/u, '|index=*|') !== expected.key.replace(/\|index=-?\d+\|/u, '|index=*|') ||
            target.saved !== expected.saved || target.fileRevision !== expected.fileRevision) {
            throw new Error('MCP_ERROR:{"code":"RASTER_RECONCILE_CLOSE_REFUSED"}');
        }
        result = await close([target.path], { ...expected, path: target.path, key: target.key });
    }
    return { remaining: matches.length, documents: matches, documentCount: result.data.documentCount };
}
export class RasterArtifactError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RasterArtifactError';
    }
}
async function inspectSvgArtifact(path, plan, artboards) {
    const handle = await open(path, noFollowReadFlags());
    try {
        const before = await handle.stat({ bigint: true });
        if (!before.isFile() || before.nlink !== 1n)
            throw new SvgArtifactError('svg_artifact_invalid', 'SVG must be a single regular file.');
        const bytes = await readBounded(handle, SVG_EXPORT_LIMITS.bytes);
        if (bytes === null)
            throw new SvgArtifactError('svg_limit', 'SVG exceeds 8 MiB.');
        const after = await handle.stat({ bigint: true });
        if (!sameFileIdentity(fileIdentityOf(before), fileIdentityOf(after)) || BigInt(bytes.length) !== after.size)
            throw new SvgArtifactError('svg_artifact_changed', 'SVG changed while being read.');
        let source;
        try {
            source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        }
        catch {
            throw new SvgArtifactError('svg_xml_invalid', 'SVG is not valid UTF-8.');
        }
        const target = artboards[plan.artboard.index];
        if (target === undefined || target.index !== plan.artboard.index || target.name.normalize('NFC') !== plan.artboard.name.normalize('NFC') ||
            artboards.filter((board) => board.name.normalize('NFC') === target.name.normalize('NFC')).length !== 1) {
            throw new SvgArtifactError('svg_output_index_mismatch', 'The work-copy artboard name does not uniquely bind the planned target.');
        }
        const verified = verifySvgArtifact(source, { name: basename(path), artboardIndex: target.index, artboardName: target.name, expected: plan.expected, expectedBounds: plan.svg.bounds });
        await handle.sync();
        return { path, mediaType: 'image/svg+xml', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
            width: verified.width, height: verified.height, viewBox: verified.viewBox, identity: fileIdentityOf(before) };
    }
    finally {
        await handle.close();
    }
}
export function jpegFrame(bytes) {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
        throw new RasterArtifactError('The JPEG has no start-of-image marker.');
    if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9)
        throw new RasterArtifactError('The JPEG is truncated (no end-of-image marker).');
    let offset = 2;
    while (offset + 4 <= bytes.length) {
        if (bytes[offset] !== 0xff)
            throw new RasterArtifactError('The JPEG has a malformed marker.');
        const marker = bytes[offset + 1];
        if (marker === 0xda)
            break;
        const length = bytes.readUInt16BE(offset + 2);
        if (length < 2 || offset + 2 + length > bytes.length)
            throw new RasterArtifactError('The JPEG has a truncated segment.');
        if (marker >= 0xc1 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            throw new RasterArtifactError(`The JPEG frame type 0x${marker.toString(16)} is not the measured baseline.`);
        }
        if (marker === 0xc0) {
            if (length < 8)
                throw new RasterArtifactError('The JPEG frame header is truncated.');
            const height = bytes.readUInt16BE(offset + 5);
            const width = bytes.readUInt16BE(offset + 7);
            if (width <= 0 || height <= 0)
                throw new RasterArtifactError('The JPEG frame has no size.');
            return { width, height };
        }
        offset += 2 + length;
    }
    throw new RasterArtifactError('The JPEG has no baseline frame header.');
}
export async function readBounded(handle, limit) {
    const chunks = [];
    let total = 0;
    for (;;) {
        const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, limit + 1 - total));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, total);
        if (bytesRead === 0)
            break;
        chunks.push(buffer.subarray(0, bytesRead));
        total += bytesRead;
        if (total > limit)
            return null;
    }
    return Buffer.concat(chunks, total);
}
function assertWithinPixelCeiling(width, height, format) {
    if (width > RASTER_MAX_SIDE_PX || height > RASTER_MAX_SIDE_PX || width * height > RASTER_MAX_TOTAL_PX) {
        throw new RasterArtifactError(`The ${format} header declares ${width}x${height} px, beyond the measured ceiling; it is not decoded.`);
    }
}
export function fileIdentityOf(metadata) {
    return { dev: metadata.dev, ino: metadata.ino, size: metadata.size, mtimeNs: metadata.mtimeNs, ctimeNs: metadata.ctimeNs };
}
export async function inspectRasterArtifact(path, format) {
    let handle;
    const flags = noFollowReadFlags();
    try {
        handle = await open(path, flags);
    }
    catch (error) {
        throw new RasterArtifactError(`The exported file could not be opened: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
        let before;
        let bytes;
        for (let attempt = 1;; attempt += 1) {
            before = await handle.stat({ bigint: true });
            if (!before.isFile() || before.nlink !== 1n)
                throw new RasterArtifactError('The exported file is not a single regular file.');
            const read = await readBounded(handle, RASTER_MAX_ARTIFACT_BYTES);
            if (read === null)
                throw new RasterArtifactError(`The exported file is larger than ${RASTER_MAX_ARTIFACT_BYTES} bytes.`);
            bytes = read;
            const after = await handle.stat({ bigint: true });
            if (sameFileIdentity(fileIdentityOf(before), fileIdentityOf(after)) && BigInt(bytes.length) === after.size)
                break;
            if (attempt < CTIME_ONLY_READ_ATTEMPTS && BigInt(bytes.length) === after.size && onlyCtimeDiffers(fileIdentityOf(before), fileIdentityOf(after)))
                continue;
            throw new RasterArtifactError('The exported file changed while it was read.');
        }
        if (bytes.length === 0)
            throw new RasterArtifactError('The exported file is empty.');
        let size;
        if (format === 'png') {
            if (bytes.length < 24 || bytes.toString('latin1', 12, 16) !== 'IHDR')
                throw new RasterArtifactError('The PNG has no IHDR header.');
            assertWithinPixelCeiling(bytes.readUInt32BE(16), bytes.readUInt32BE(20), 'PNG');
            try {
                const decoded = PNG.sync.read(bytes, { checkCRC: true });
                size = { width: decoded.width, height: decoded.height };
            }
            catch (error) {
                throw new RasterArtifactError(`The PNG does not decode: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        else {
            const frame = jpegFrame(bytes);
            assertWithinPixelCeiling(frame.width, frame.height, 'JPEG');
            let decoded;
            try {
                decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: false, maxResolutionInMP: RASTER_MAX_TOTAL_PX / 1_000_000, maxMemoryUsageInMB: 256 });
            }
            catch (error) {
                throw new RasterArtifactError(`The JPEG does not decode: ${error instanceof Error ? error.message : String(error)}`);
            }
            if (decoded.width !== frame.width || decoded.height !== frame.height)
                throw new RasterArtifactError('The decoded JPEG size differs from its frame header.');
            size = frame;
        }
        await handle.sync();
        return {
            mediaType: format === 'png' ? 'image/png' : 'image/jpeg',
            bytes: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            ...size,
            identity: fileIdentityOf(before),
        };
    }
    finally {
        await handle.close();
    }
}
export function rasterExtension(format) {
    return format === 'png' ? '.png' : '.jpg';
}
export async function syncDirectory(path) {
    const handle = await open(path, noFollowDirectoryFlags());
    try {
        await handle.sync();
    }
    finally {
        await handle.close();
    }
}
function svgPlanFacts(source, artboard) {
    const blocked = (reason, message) => ({ reason, message });
    const name = artboard.name.normalize('NFC');
    const defaultName = /^アートボード (\d+)$/u.exec(name);
    if (!svgArtboardNameMeasured(name) || (defaultName !== null && Number(defaultName[1]) !== artboard.index + 1) ||
        source.artboards.filter((board) => board.name.normalize('NFC') === name).length !== 1) {
        return { reason: 'svg_artboard_name_unmeasured', message: 'The SVG output name is unmeasured for this artboard name, or the name is duplicated.',
            next_steps: ['Rename the artboard to a unique, nonempty name using only Kanji, Katakana, ASCII letters/digits and spaces, save the document, then plan again. Leading/trailing whitespace, symbols, English defaults (Artboard N) and Japanese default names whose number does not match index + 1 are not admitted.'] };
    }
    const facts = source.svg;
    if (facts === undefined)
        throw new Error('The SVG read-source response has no scan facts.');
    if (source.placedItems > 0 || facts.rasterItems > 0)
        return blocked('svg_images_unmeasured', 'SVG export does not admit placed or raster images.');
    if (facts.scanLimit || facts.items.length > SVG_SOURCE_SCAN_LIMITS.entries)
        return blocked('svg_item_scan_limit', `SVG source scan exceeds ${facts.scanLimitReason ?? 'entries'}: at most 2,000 collection visits, 64 layers and depth 8. Descendant and repeated visits count toward the limit.`);
    if (source.nonPrintingLayers.layers.length > 0 || source.nonPrintingLayers.truncated || source.nonPrintingLayers.unavailable === true || facts.items.some((item) => item.nonrendering)) {
        return { reason: 'svg_nonrendering_item_unmeasured', message: 'Guides, empty groups, and template or non-printing layers are unmeasured for SVG.',
            next_steps: ['Make non-printing layers (including template layers) printable or move their contents to printable layers, save the document, then plan again. Guides and empty groups must also be removed before planning again.'] };
    }
    if (facts.items.some((item) => item.hidden || item.opacity === 0))
        return blocked('svg_hidden_item_unmeasured', 'Hidden or zero-opacity items are unmeasured for SVG.');
    const [left, top, right, bottom] = artboard.rect;
    const expected = { width: Number((right - left).toFixed(12)), height: Number((top - bottom).toFixed(12)) };
    if (!svgExpectedSchema.safeParse(expected).success)
        return blocked('svg_dimensions_unmeasured', 'SVG artboard sides must be between 0.001 and 16,383 pt.');
    if (source.artboards.some((board) => board.index !== artboard.index && Math.min(right, board.rect[2]) > Math.max(left, board.rect[0]) && Math.min(top, board.rect[1]) > Math.max(bottom, board.rect[3])))
        return blocked('svg_artboards_overlap_unmeasured', 'The target artboard overlaps another artboard.');
    const bounds = [];
    let union = null;
    for (const item of facts.items) {
        const b = item.bounds;
        if (!Number.isFinite(item.opacity) || b === null || b.length !== 4 || b.some((v) => !Number.isFinite(v) || Math.abs(v) > SVG_EXPORT_LIMITS.coordinate) || b[2] < b[0] || b[1] < b[3])
            return blocked('svg_item_bounds_unmeasured', 'An item has unavailable or unmeasured bounds.');
        if (b[2] < left || b[0] > right || b[3] > top || b[1] < bottom)
            continue;
        if (b[0] < left || b[2] > right || b[1] > top || b[3] < bottom)
            return blocked('svg_item_crosses_artboard_unmeasured', 'A top-level item crosses the target artboard.');
        const boardBounds = [b[0] - left, top - b[1], b[2] - left, top - b[3]];
        bounds.push(boardBounds);
        union = union === null ? [...boardBounds] : [Math.min(union[0], boardBounds[0]), Math.min(union[1], boardBounds[1]), Math.max(union[2], boardBounds[2]), Math.max(union[3], boardBounds[3])];
    }
    return { expected, svg: { bounds, expectedBounds: { union, itemCount: bounds.length, digest: canonicalSha256(bounds) }, expectedActive: source.activeArtboardIndex } };
}
class ExactHostProfileRefusal extends Error {
    reason;
    constructor(reason, message) {
        super(message);
        this.reason = reason;
    }
}
export function nonPrintingWarnings(scan, excluded) {
    const warning = nonPrintingLayerWarning(scan, excluded ? 'excluded' : 'warn_with_option');
    return warning === null ? {} : { warnings: [warning] };
}
export async function hashWholeFile(path) {
    const handle = await open(path, noFollowReadFlags());
    try {
        const hash = createHash('sha256');
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        for (;;) {
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
            if (bytesRead === 0)
                break;
            hash.update(buffer.subarray(0, bytesRead));
        }
        return hash.digest('hex');
    }
    finally {
        await handle.close();
    }
}
export class RasterExportOperation {
    deps;
    contract;
    now;
    constructor(deps) {
        this.deps = deps;
        this.contract = deps.dimensionContract ?? WEB_RGB_PIXEL_CONTRACT;
        this.now = deps.now ?? (() => new Date());
    }
    async host(meter, command) {
        const started = performance.now();
        meter.calls += 1;
        try {
            const guarded = meter.exactProfilePending ? { ...command, hostGate: { ...command.hostGate, beforeHost: async (context) => {
                        const admission = await command.hostGate?.beforeHost?.(context);
                        meter.exactProfilePending = false;
                        const probe = this.deps.hostProfileProbe;
                        if (probe === undefined)
                            throw new ExactHostProfileRefusal('host_profile_unknown', 'Host state cannot be verified. Unlock the screen, bring Illustrator to the front, and try again.');
                        const started = performance.now();
                        const observed = await (probe.observeForEditSession ? probe.observeForEditSession() : probe.observe());
                        if (callTimingEnabled())
                            process.stderr.write(JSON.stringify({ event: 'exact_px_host_profile_observed', profile: observed.profile, durationMs: performance.now() - started }) + '\n');
                        if (observed.lockState === 'locked')
                            throw new ExactHostProfileRefusal('host_screen_locked', 'Unlock the screen and bring Illustrator to the front, then try again.');
                        if (observed.lockState !== 'unlocked' || observed.profile === 'unknown')
                            throw new ExactHostProfileRefusal('host_profile_unknown', 'Host state cannot be verified. Unlock the screen, bring Illustrator to the front, and try again.');
                        if (observed.profile !== 'foreground')
                            throw new ExactHostProfileRefusal('host_not_foreground', 'Bring Illustrator to the front, then try again.');
                        return admission;
                    } } } : command;
            return (await (this.deps.executeHost === undefined
                ? this.deps.bridge.execute(withFilePathComparisons(guarded))
                : this.deps.executeHost(guarded))).data;
        }
        finally {
            meter.ms += performance.now() - started;
        }
    }
    async run(raw) {
        const started = performance.now();
        const input = rasterExportInputSchema.parse(raw);
        if (input.overwrite === true && process.platform === 'win32')
            return this.rejected('overwrite_not_supported_on_platform', 'Overwrite export is not supported on Windows.');
        const meter = { calls: 0, ms: 0,
            ...(input.format === 'svg' || input.width_px !== undefined || input.height_px !== undefined ? { exactProfilePending: true } : {}) };
        try {
            if (!input.apply) {
                const planned = await this.plan(input, meter);
                return planned.kind === 'result' ? planned.result : this.plannedResult(planned.plan, input);
            }
            const exportId = input.command_id;
            const confirm = input.confirm_export_hash;
            const existing = await this.existingOutcome(exportId, confirm, input);
            if (existing !== null)
                return existing;
            if (input.overwrite === true)
                await assertExpectedOutput(input.expected_output, previousOutputLimit(input.format));
            const planned = await this.plan(input, meter);
            if (planned.kind === 'result') {
                const result = planned.result;
                if (result.outcome === 'blocked')
                    return this.rejected('dimension_contract_unavailable', result.message, result.document);
                return result;
            }
            if (planned.plan.digest !== confirm) {
                return this.rejected('plan_changed', 'The document, file, output or options changed since the plan; plan again and use its next_call.', planned.plan.document);
            }
            if (input.overwrite === true && canonicalSha256(input.expected_output) !== canonicalSha256(planned.plan.expectedOutput)) {
                return this.rejected('output_changed_since_plan', 'expected_output must be echoed unchanged from the overwrite plan.');
            }
            if (input.overwrite === true)
                planned.plan.requestDigest = canonicalSha256(input);
            return await this.apply(exportId, planned.plan, meter, started);
        }
        catch (error) {
            if (error instanceof ExactHostProfileRefusal)
                return this.rejected(error.reason, error.message);
            if (error instanceof OutputReplacementError)
                return this.rejected(error.reason, error.message);
            throw error;
        }
    }
    rejected(reason, message, document = null) {
        return { outcome: 'rejected', reason, message, document };
    }
    plannedResult(plan, input) {
        const args = {
            expected_document_key: input.expected_document_key,
            format: plan.options.format,
            output_path: input.output_path,
            artboard_index: plan.artboard.index,
            ...(plan.options.format === 'svg' ? {} : 'scale' in plan.options ? { scale: plan.options.scale } : plan.options.sizeIntent.mode === 'width_px' ? { width_px: plan.options.sizeIntent.widthPx } : { height_px: plan.options.sizeIntent.heightPx }),
            ...(plan.options.format === 'svg' ? {} : plan.options.format === 'png' ? { transparent: plan.options.transparent } : { quality: plan.options.quality }),
            ...(plan.excludeNonPrintingLayers ? { exclude_non_printing_layers: true } : {}),
            apply: true,
            command_id: randomUUID(),
            confirm_export_hash: plan.digest,
            ...(plan.expectedOutput === undefined ? {} : { overwrite: true, expected_output: plan.expectedOutput }),
        };
        return {
            outcome: 'planned', document: plan.document, artboard: plan.artboard, options: plan.options, outputPath: plan.output.path,
            ...(plan.expectedOutput === undefined ? {} : { existingOutput: plan.expectedOutput }),
            expected: plan.expected, ...(plan.expectedRange === undefined ? {} : { expectedRange: plan.expectedRange }), ...(plan.roundedEdges === undefined ? {} : { roundedEdges: plan.roundedEdges }), ...(plan.edgeWarnings === undefined ? {} : { edgeWarnings: plan.edgeWarnings }), ...(plan.links.length === 0 ? {} : { links: plan.links }),
            ...nonPrintingWarnings(plan.source.nonPrintingLayers, plan.excludeNonPrintingLayers), ...(plan.hostVersion === undefined ? {} : { host_version: plan.hostVersion }), planDigest: plan.digest, nextCall: { tool: RASTER_EXPORT_TOOL, arguments: args },
        };
    }
    async plan(input, meter) {
        const result = (value) => ({ kind: 'result', result: value });
        let source;
        try {
            source = await this.host(meter, {
                kind: 'read',
                script: input.format === 'svg' ? SVG_READ_SOURCE_FACTS_SCRIPT : RASTER_READ_SOURCE_LAYERS_SCRIPT,
                params: { expectedDocumentKey: input.expected_document_key },
                hostGate: { beforeHost: async () => { await this.deps.assertNoUnresolvedLease(); } },
            });
        }
        catch (error) {
            const detail = parseExportHostError(error);
            if (detail?.code === 'DOCUMENT_MISMATCH')
                return result(this.rejected('document_key_mismatch', 'The active document key does not match expected_document_key.'));
            throw error;
        }
        const document = source.document;
        if (!documentKeyMatches(input.expected_document_key, document.key)) {
            return result(this.rejected('document_key_mismatch', 'Illustrator reported a different document key than expected.'));
        }
        if (document.path === null || document.fileRevision === null) {
            return result(this.rejected('document_not_saved', 'この文書はまだ保存されていません。AI 形式で保存してから、もう一度お試しください。', document));
        }
        const admitLinks = async () => {
            try {
                return await admitLinkedFiles({
                    placedItems: source.placedItems, documentKey: document.key,
                    readLinks: async () => await this.host(meter, {
                        kind: 'read', script: RASTER_READ_LINKS_SCRIPT, params: { expectedDocumentKey: input.expected_document_key },
                        hostGate: { beforeHost: async () => { await this.deps.assertNoUnresolvedLease(); } },
                    }),
                });
            }
            catch (error) {
                if (parseExportHostError(error)?.code === 'DOCUMENT_MISMATCH')
                    return { kind: 'rejected', reason: 'document_key_mismatch', message: 'The active document key does not match expected_document_key.' };
                throw error;
            }
        };
        let linked = null;
        if (!document.saved) {
            if (source.placedItems > 0) {
                linked = await admitLinks();
                if (linked.kind === 'rejected' && linked.reason === 'linked_file_unavailable')
                    return result(this.rejected(linked.reason, linked.message, document));
            }
            return result(this.rejected('document_dirty', 'この書き出しでは未保存の変更を含められません。現在の内容を書き出すには、変更を保存してからもう一度お試しください。元ファイルを更新したくない場合は、別名で保存した文書から書き出してください。', document));
        }
        if (document.mutationProfile !== 'saved_file') {
            return result(this.rejected('document_not_admitted', document.mutationBlockedReason ?? 'The document is not a saved, file-backed document.', document));
        }
        if (document.colorSpace !== 'RGB')
            return result(this.rejected('color_space_not_admitted', 'Only RGB documents are measured for this export.', document));
        if (input.format === 'svg' && source.placedItems > 0)
            return result({ outcome: 'blocked', reason: 'svg_images_unmeasured', message: 'SVG export does not admit placed images.', document });
        linked ??= await admitLinks();
        if (linked.kind === 'rejected')
            return result(this.rejected(linked.reason, linked.message, document));
        const artboard = source.artboards[input.artboard_index];
        if (artboard === undefined) {
            return result(this.rejected('artboard_out_of_range', `artboard_index ${input.artboard_index} is outside the ${source.artboards.length} artboard(s).`, document));
        }
        let sourceFile;
        let output;
        let expectedOutput;
        try {
            const facts = await inspectSourceFile(document.path);
            sourceFile = { ...facts, sha256: await hashWholeFile(facts.path) };
            const session = await this.deps.editSessionForPath(facts.path);
            if (session.state === 'invalid') {
                return result(this.rejected('edit_session_invalid', `An edit session record cannot be read (${session.reason}); inspect it with illustrator_get_edit_session.`, document));
            }
            if (session.state === 'valid') {
                return result(this.rejected('edit_session_open', '編集中のセッションでは書き出せません。変更を保存し、編集セッションを終了してから、もう一度お試しください。', document));
            }
            await this.deps.exportStore.ensure();
            const extensions = input.format === 'svg' ? ['.svg'] : input.format === 'png' ? ['.png'] : ['.jpg', '.jpeg'];
            if (!extensions.includes(extname(input.output_path).toLowerCase()) || extensions.includes(basename(input.output_path).toLowerCase())) {
                return result(this.rejected('output_path_invalid', `output_path must end with ${extensions.join(' or ')} for format "${input.format}".`, document));
            }
            output = await validateOutputLocation(input.output_path, sourceFile.path, this.deps.exportStore.stateRootPath, input.overwrite === true);
            if (input.overwrite === true)
                expectedOutput = await captureExpectedOutput(output.path, previousOutputLimit(input.format));
        }
        catch (error) {
            if (error instanceof BackupPreconditionError)
                return result(this.rejected('source_file_unavailable', error.message, document));
            if (error instanceof OutputReplacementError)
                return result(this.rejected(error.reason, error.message, document));
            if (error instanceof ExportPreconditionError) {
                const reason = error.reason === 'output_exists' || error.reason === 'output_cross_device' ? error.reason : 'output_path_invalid';
                return result(this.rejected(reason, error.message, document));
            }
            throw error;
        }
        const sizeIntent = input.width_px !== undefined ? { mode: 'width_px', widthPx: input.width_px }
            : input.height_px !== undefined ? { mode: 'height_px', heightPx: input.height_px } : null;
        if (input.format === 'svg') {
            const target = this.deps.bridge.applicationTarget?.();
            if (!hostVersionAdmitted('svg_export', document.appVersion) || target?.channel !== 'stable' || target.bundleId !== STABLE_ILLUSTRATOR_BUNDLE_ID)
                return result({ outcome: 'blocked', reason: 'svg_host_unmeasured', message: 'SVG export needs the configured macOS stable Illustrator bundle with a readable version that the host version policy admits.', document });
            const svgHostVersion = admitHostVersionPlan('svg_export', document.appVersion, target.channel);
            const facts = svgPlanFacts(source, artboard);
            if ('reason' in facts)
                return result({ outcome: 'blocked', ...facts, document });
            const options = svgExportOptionsSchema.parse({ format: 'svg', exportType: 'WOSVG', saveMultipleArtboards: true, artboardRange: String(artboard.index + 1), fontType: 'OUTLINEFONT', rasterImageLocation: 'EMBED', svgResponsive: false, svgMinify: false, coordinatePrecision: 3 });
            const digest = canonicalSha256({ profile: 'svg_export_v1', appVersion: document.appVersion,
                ...(expectedOutput === undefined ? {} : { overwrite: true, expectedOutput }),
                source: { key: document.key, path: sourceFile.path, fileRevision: document.fileRevision, sha256: sourceFile.sha256, identity: serializeFileIdentity(sourceFile.identity) },
                artboards: source.artboards, rulerOrigin: source.rulerOrigin, target: artboard.index, expectedActive: facts.svg.expectedActive,
                destination: { parent: output.parent, leaf: basename(output.path) }, options, expected: facts.expected, expectedBounds: facts.svg.expectedBounds,
            });
            return { kind: 'plan', plan: { document, source, artboard, options, sourceFile, output, expected: facts.expected, svg: facts.svg, links: [], linkBinding: [], excludeNonPrintingLayers: false, ...(expectedOutput === undefined ? {} : { expectedOutput }), ...(svgHostVersion === null ? {} : { hostVersion: svgHostVersion }), digest } };
        }
        const legacyOptions = rasterOptionsOf(input);
        const dimensions = sizeIntent === null
            ? this.contract({ options: legacyOptions, artboard: { index: artboard.index, rect: artboard.rect, origin: artboard.origin }, documentRulerOrigin: source.rulerOrigin })
            : exactPixelRasterDimensions({ sizeIntent, artboard, format: input.format, ...(input.format === 'png' ? { transparent: input.transparent ?? true } : {}) });
        if (dimensions.status === 'unsupported')
            return result({ outcome: 'blocked', reason: dimensions.reason, message: dimensions.message, document });
        const target = sizeIntent === null ? null : this.deps.bridge.applicationTarget?.();
        if (sizeIntent !== null) {
            const version = evaluateHostVersion('export_exact_px', document.appVersion);
            if ((version.status !== 'measured' && version.status !== 'patch_unmeasured') || target?.channel !== 'stable' || target.bundleId !== STABLE_ILLUSTRATOR_BUNDLE_ID)
                return result({ outcome: 'blocked', reason: 'target_pixel_host_unmeasured', message: 'Exact-px export requires the configured stable Illustrator 30.8.x bundle (measured 30.8.2; other patches are policy-admitted, unmeasured).', document });
        }
        const options = sizeIntent === null ? legacyOptions
            : { ...(input.format === 'png' ? { format: 'png', transparent: input.transparent ?? true } : { format: 'jpeg', quality: input.quality ?? 80 }), sizeIntent, renderScalePercent: dimensions.renderScalePercent };
        const expected = { width: dimensions.width, height: dimensions.height };
        const digest = canonicalSha256({
            profile: RASTER_EXPORT_PROFILE,
            ...(expectedOutput === undefined ? {} : { overwrite: true, expectedOutput }),
            appVersion: document.appVersion,
            source: { key: document.key, path: sourceFile.path, fileRevision: document.fileRevision, sha256: sourceFile.sha256, identity: serializeFileIdentity(sourceFile.identity) },
            artboards: source.artboards,
            rulerOrigin: source.rulerOrigin,
            target: artboard.index,
            ...(linked.binding.length === 0 ? {} : { links: linked.binding }),
            ...(input.exclude_non_printing_layers === true ? { excludeNonPrintingLayers: true } : {}),
            destination: { parent: output.parent, leaf: basename(output.path) },
            options,
            expected,
            ...(!('range' in dimensions) || dimensions.range === undefined ? {} : { expectedRange: dimensions.range }),
        });
        return { kind: 'plan', plan: { document, source, artboard, options, sourceFile, output, expected, links: linked.links, linkBinding: linked.binding, excludeNonPrintingLayers: input.exclude_non_printing_layers === true,
                ...(expectedOutput === undefined ? {} : { expectedOutput }),
                ...('range' in dimensions && dimensions.range !== undefined ? { expectedRange: dimensions.range } : {}),
                ...('roundedEdges' in dimensions && dimensions.roundedEdges !== undefined ? { roundedEdges: dimensions.roundedEdges } : {}),
                ...('edgeWarnings' in dimensions && dimensions.edgeWarnings !== undefined ? { edgeWarnings: dimensions.edgeWarnings } : {}), digest } };
    }
    async existingOutcome(exportId, planDigest, input) {
        if (await pathTaken(rasterQuarantinePaths(this.deps.exportStore.stateRootPath, exportId).manifest)) {
            return this.rejected('export_records_invalid', `The records of export ${exportId} were moved to quarantine; use a new command_id.`);
        }
        const set = await this.deps.exportStore.readRasterRecordSet(exportId);
        if (input.overwrite === true && set.prepare.state === 'v2' && set.prepare.record.version !== 5)
            return this.rejected('command_id_conflict', 'This command_id belongs to a non-overwrite export.');
        if (set.prepare.state === 'v2' && set.prepare.record.version === 5 && set.prepare.record.requestDigest !== canonicalSha256(input)) {
            return this.rejected('command_id_conflict', 'This command_id belongs to different overwrite arguments.');
        }
        const state = assessRasterRecordSet(set, planDigest);
        if (set.prepare.state === 'v2' && set.prepare.record.version === 5 && state.state !== 'invalid' && state.state !== 'published' && state.state !== 'failed') {
            const terminal = await assessReplacementTerminal(this.deps.exportStore, set);
            if (terminal.state === 'invalid')
                return this.rejected('export_records_invalid', `${terminal.reason}: ${terminal.detail}; the lease is retained.`);
        }
        switch (state.state) {
            case 'none': return null;
            case 'invalid':
                return state.reason === 'command_id_conflict'
                    ? this.rejected('command_id_conflict', 'command_id was already used for a different export; use the plan\'s next_call for a new export.')
                    : this.rejected('export_records_invalid', `The records of export ${exportId} are not a legal state (${state.reason}); nothing was changed.`);
            case 'prepared':
                return this.rejected('command_id_in_use', `command_id ${exportId} started an export that never reached Illustrator; use a new command_id (illustrator_reconcile_export can clean up its residue).`);
            case 'leased':
                return { outcome: 'indeterminate', exportId, stage: 'existing_lease', message: `Export ${exportId} is unresolved; run the export reconcile before another attempt. It is never resumed automatically.`, commandId: null };
            case 'quarantined':
                return this.rejected('export_records_invalid', `Export ${exportId} is quarantined; nothing is replayed or exported again.`);
            case 'published': return await this.replayPublished(exportId, set);
            case 'failed': return this.failedResult(set, 'replay');
        }
    }
    cleanupEntries(set) {
        return set.cleanup.state === 'v2' ? set.cleanup.record.entries : [];
    }
    async failedResult(set, delivery) {
        if (set.failed.state !== 'v2')
            throw new Error('No failed record.');
        const failed = set.failed.record;
        if (failed.version === 5) {
            const terminal = await assessReplacementTerminal(this.deps.exportStore, set);
            if (terminal.state === 'invalid' || terminal.disposition !== 'failed')
                return this.rejected('export_records_invalid', terminal.state === 'invalid' ? `${terminal.reason}: ${terminal.detail}` : 'The failed replacement is not terminal.');
        }
        return { outcome: 'failed', exportId: failed.exportId, delivery, stage: failed.stage, reason: failed.reason, message: failed.message, cleanup: this.cleanupEntries(set), ...(failed.version === 5 ? { replacement: failed.replacement } : {}) };
    }
    async replayPublished(exportId, set) {
        if (set.published.state !== 'v2')
            throw new Error('No published record.');
        const published = set.published.record;
        if (published.version === 5) {
            const started = performance.now();
            const terminal = await assessReplacementTerminal(this.deps.exportStore, set);
            if (terminal.state === 'invalid' || terminal.disposition !== 'published')
                return this.rejected('export_records_invalid', terminal.state === 'invalid' ? `${terminal.reason}: ${terminal.detail}` : 'The replacement is not published.');
            return { outcome: 'verified', exportId, delivery: 'replay', artifact: published.artifact, sourcePreserved: true,
                replacement: terminal.summary, cleanup: this.cleanupEntries(set), timing: { totalMs: performance.now() - started, hostCalls: 0, hostMs: 0 } };
        }
        const started = performance.now();
        let handle;
        const flags = noFollowReadFlags();
        try {
            handle = await open(published.artifact.path, flags);
        }
        catch {
            return this.rejected('artifact_unavailable', `The exported file ${published.artifact.path} is gone; it is not exported again.`);
        }
        try {
            const metadata = await handle.stat({ bigint: true });
            const recorded = published.outputIdentity;
            const sameInode = metadata.isFile() && String(metadata.dev) === recorded.dev && String(metadata.ino) === recorded.ino && String(metadata.size) === recorded.size;
            const bytes = sameInode ? await readBounded(handle, RASTER_MAX_ARTIFACT_BYTES) : null;
            if (bytes === null || createHash('sha256').update(bytes).digest('hex') !== published.artifact.sha256) {
                return this.rejected('artifact_identity_mismatch', `The file at ${published.artifact.path} is no longer the exported file; it is not exported again.`);
            }
        }
        finally {
            await handle.close();
        }
        return {
            outcome: 'verified', exportId, delivery: 'replay', artifact: published.artifact, sourcePreserved: true,
            cleanup: this.cleanupEntries(set), timing: { totalMs: performance.now() - started, hostCalls: 0, hostMs: 0 },
        };
    }
    async apply(exportId, plan, meter, started) {
        const store = this.deps.exportStore;
        const recordedAt = () => this.now().toISOString();
        const svg = plan.options.format === 'svg';
        const renderVersion = svg ? RASTER_SVG_RECORD_VERSION : 'scale' in plan.options ? RASTER_EXPORT_RECORD_VERSION : RASTER_EXACT_PX_RECORD_VERSION;
        const common = { version: plan.expectedOutput === undefined ? renderVersion : 5, kind: RASTER_EXPORT_KIND, exportId, planDigest: plan.digest,
            ...(plan.expectedOutput === undefined ? {} : { renderVersion, expectedOutput: plan.expectedOutput, requestDigest: plan.requestDigest }) };
        const assertDestination = async () => plan.expectedOutput === undefined ? await assertOutputAbsent(plan.output.path) : await assertExpectedOutput(plan.expectedOutput, previousOutputLimit(plan.options.format));
        let replacement;
        let replacementIntent = null;
        let stage = 'prepare';
        let prepared = false;
        let leaseHeld = false;
        let fingerprint = null;
        const refresh = async () => { fingerprint = recordSetFingerprint(await store.readRasterRecordSet(exportId)); };
        const assertUnchanged = async () => {
            if (recordSetFingerprint(await store.readRasterRecordSet(exportId)) !== fingerprint) {
                throw new RasterStateChangedError(`The records of export ${exportId} changed outside this apply (a reconcile ran); nothing more is written.`);
            }
        };
        const indeterminate = (message, commandId = null) => ({ outcome: 'indeterminate', exportId, stage, message, commandId, ...(replacement === undefined ? {} : { replacement }) });
        const asIndeterminate = (error) => {
            const invalid = error instanceof ReplacementTerminalInvalidError ? error : error instanceof RasterAfterHostError && error.cause instanceof ReplacementTerminalInvalidError ? error.cause : null;
            return invalid !== null ? this.rejected('export_records_invalid', invalid.message) : indeterminate(error instanceof Error ? error.message : String(error), error instanceof IndeterminateExecutionError || error instanceof RasterAfterHostError ? error.commandId : null);
        };
        const recorded = async (step, commandId, body) => {
            try {
                await body();
            }
            catch (error) {
                const set = await store.readRasterRecordSet(exportId).catch(() => null);
                const written = set === null ? ['unknown'] : Object.entries(set).filter(([, read]) => read.state === 'v2').map(([type]) => type);
                throw new RasterAfterHostError(step, commandId, written, error);
            }
        };
        let exportRoot;
        try {
            exportRoot = await resolveBackupRoot(store.recordDirectory);
        }
        catch (error) {
            if (error instanceof BackupPreconditionError)
                return this.rejected('export_root_unavailable', error.message, plan.document);
            throw error;
        }
        return await withBackupRootScope(exportRoot, async (rootScope) => await withOutputParentScope(plan.output.parent, async (parentScope) => {
            const workCopyPath = join(exportRoot, workCopyFileName(exportId, plan.sourceFile.path));
            const stagingDirectory = join(plan.output.parent, `${STAGING_DIRECTORY_PREFIX}${exportId}`);
            const basePath = join(stagingDirectory, 'artifact');
            let stagedPath = `${basePath}${plan.options.format === 'svg' ? '.svg' : rasterExtension(plan.options.format)}`;
            const sessionPaths = [workCopyPath, stagedPath, plan.output.path];
            const sessionScope = svg ? { paths: [workCopyPath, plan.output.path], directories: [stagingDirectory] } : { paths: sessionPaths, directories: [] };
            const scopeParams = svg ? { sessionPaths: sessionScope.paths, sessionDirectoryPaths: sessionScope.directories } : { sessionPaths };
            const parentIdentity = await lstat(plan.output.parent, { bigint: true });
            const boards = plan.source.artboards.map(({ index, name, rect }) => ({ index, name, rect }));
            let copied = null;
            const ownedWorkCopy = () => [{ path: workCopyPath, remove: async () => copied === null ? false : await removeOwnedFile(workCopyPath, copied.identity) }];
            stage = 'open_work_copy';
            let openCommandId = null;
            let opened;
            try {
                opened = await this.host(meter, {
                    kind: 'read',
                    script: svg ? SVG_OPEN_WORK_COPY_SCRIPT : EXPORT_OPEN_WORK_COPY_SCRIPT,
                    params: { expectedDocumentKey: plan.document.key, workCopyPath, stagedPath, outputPath: plan.expectedOutput === undefined ? plan.output.path : stagedPath, ...scopeParams },
                    timeoutMs: EXPORT_HOST_TIMEOUT_MS,
                    hostGate: {
                        beforeHost: async ({ commandId }) => {
                            await this.deps.assertNoUnresolvedLease();
                            await rootScope.assertStable();
                            await parentScope.assertStable();
                            if (assessRasterRecordSet(await store.readRasterRecordSet(exportId)).state !== 'none') {
                                throw new RasterPrepareRefusal('command_id_in_use', `command_id ${exportId} was used meanwhile; use a new command_id.`);
                            }
                            if (await pathTaken(workCopyPath) || await pathTaken(stagingDirectory)) {
                                throw new RasterPrepareRefusal('command_id_in_use', `command_id ${exportId} already has a work copy or stage; use a new command_id.`);
                            }
                            await assertDestination();
                            await store.writeRasterRecord('prepare', {
                                ...common, recordType: 'prepare', recordedAt: recordedAt(),
                                sourcePath: plan.sourceFile.path, sourceSha256: plan.sourceFile.sha256, sourceIdentity: serializeFileIdentity(plan.sourceFile.identity),
                                workCopyPath, stagingDirectory, outputParent: plan.output.parent,
                                outputParentIdentity: { dev: String(parentIdentity.dev), ino: String(parentIdentity.ino) }, outputPath: plan.output.path,
                            });
                            prepared = true;
                            const copy = await copyFileExclusive(plan.sourceFile.path, workCopyPath, plan.sourceFile.identity);
                            copied = copy;
                            if (copy.sha256 !== plan.sourceFile.sha256)
                                throw new BackupCopyError('The source bytes changed since the plan.');
                            await mkdir(stagingDirectory, { mode: 0o700 });
                            await syncDirectory(stagingDirectory);
                            await parentScope.sync();
                            await verifyTrackedFile(workCopyPath, copy.identity, copy.sha256);
                            await assertOutputAbsent(stagedPath);
                            await store.openRasterSession({
                                ...common, recordType: 'session', commandId: exportId, openCommandId: commandId,
                                documentKey: plan.document.key, sourcePath: plan.sourceFile.path, sourceSha256: plan.sourceFile.sha256,
                                sourceIdentity: serializeFileIdentity(plan.sourceFile.identity), artboardIndex: plan.artboard.index, options: plan.options,
                                ...('scale' in plan.options ? {} : { expected: plan.expected }),
                                ...(plan.svg === undefined ? {} : { expectedBounds: plan.svg.expectedBounds, expectedActive: plan.svg.expectedActive }),
                                workCopyPath, workCopyIdentity: serializeFileIdentity(copy.identity), stagingDirectory, stagedBasePath: basePath,
                                outputPath: plan.output.path, createdAt: recordedAt(),
                            });
                            leaseHeld = true;
                            openCommandId = commandId;
                            await refresh();
                        },
                        afterHost: async ({ commandId, data }) => await recorded('open', commandId, async () => {
                            const result = data;
                            if ((result.opened.path === null || !sameFilePath(result.opened.path, workCopyPath)) || result.documentCountAfter !== result.documentCountBefore + 1 ||
                                result.source.key !== plan.document.key || result.opened.key === plan.document.key) {
                                throw new Error('Illustrator reported an unexpected document inventory after opening the work copy.');
                            }
                            await assertUnchanged();
                            await store.writeRasterRecord('host_open', {
                                ...common, recordType: 'host_open', recordedAt: recordedAt(),
                                open: { commandId, completedInactive: true }, workCopy: hostDocumentIdentitySchema.parse(result.opened), sourceKey: result.source.key,
                                artboards: boards, documentCountBefore: result.documentCountBefore, documentCountAfter: result.documentCountAfter,
                                ...(svg ? { activeArtboardIndex: result.activeArtboardIndex } : {}),
                            });
                            await refresh();
                        }),
                    },
                });
            }
            catch (error) {
                if (error instanceof RasterPrepareRefusal)
                    return this.rejected(error.reason, error.message, plan.document);
                if (!leaseHeld) {
                    if (!prepared)
                        return asIndeterminate(error);
                    if (error instanceof BackupCopyError && !copyErrorCreatedDestination(error) && copied === null) {
                        return indeterminate(`The source file changed since the plan (${error.message}); the prepare record stays and the export reconcile can close it.`);
                    }
                    return indeterminate(`The export stopped before Illustrator was contacted (${error instanceof Error ? error.message : String(error)}); run the export reconcile to clean up its residue.`);
                }
                const detail = parseExportHostError(error);
                if (!(error instanceof IndeterminateExecutionError) && detail?.code !== undefined && EXPORT_OPEN_PRE_ATTEMPT_CODES.includes(detail.code)) {
                    return await this.failBeforeWriting(exportId, common, meter, { stage, reason: 'work_copy_open_failed', message: `The work copy was not opened (${detail.code}).` }, sessionScope, ownedWorkCopy(), assertUnchanged);
                }
                return asIndeterminate(error);
            }
            void openCommandId;
            stage = 'export';
            let failure = null;
            let artifact = null;
            let closeKey = opened.opened.key;
            try {
                const exported = await this.host(meter, {
                    kind: 'read',
                    script: svg ? SVG_EXPORT_SCRIPT : 'scale' in plan.options
                        ? (plan.excludeNonPrintingLayers ? RASTER_EXPORT_EXCLUDING_SCRIPT : RASTER_EXPORT_SCRIPT)
                        : (plan.excludeNonPrintingLayers ? RASTER_EXACT_EXPORT_EXCLUDING_SCRIPT : RASTER_EXACT_EXPORT_SCRIPT),
                    params: {
                        workCopyPath, workCopyKey: opened.opened.key, artboards: boards, artboardIndex: plan.artboard.index, basePath, stagedPath,
                        ...(svg ? { stagingDirectory } : {}),
                        format: plan.options.format, ...(plan.options.format === 'svg' ? {} : 'scale' in plan.options ? { scale: plan.options.scale } : { renderScalePercent: plan.options.renderScalePercent }),
                        transparent: plan.options.format === 'png' ? plan.options.transparent : false,
                        quality: plan.options.format === 'jpeg' ? plan.options.quality : 0,
                        excludeNonPrintingLayers: plan.excludeNonPrintingLayers,
                    },
                    timeoutMs: EXPORT_HOST_TIMEOUT_MS,
                    hostGate: {
                        beforeHost: async () => {
                            await rootScope.assertStable();
                            await parentScope.assertStable();
                            await assertDestination();
                            await assertUnchanged();
                        },
                        afterHost: async ({ commandId, data }) => await recorded('export', commandId, async () => {
                            const result = data;
                            if ((result.workCopy.path === null || !sameFilePath(result.workCopy.path, workCopyPath)) || (!svg && result.activeArtboardIndex !== plan.artboard.index)) {
                                throw new Error('Illustrator reported an unexpected work-copy state after the export.');
                            }
                            await assertUnchanged();
                            if (svg && result.activeArtboardIndex !== opened.activeArtboardIndex) {
                                failure = { stage: 'export', reason: 'svg_active_artboard_changed', message: 'WOSVG changed the work copy active artboard.' };
                                return;
                            }
                            if (svg && result.workCopy.saved !== true) {
                                failure = { stage: 'export', reason: 'svg_copy_state_changed', message: 'WOSVG left the work copy dirty, outside the measured profile.' };
                                return;
                            }
                            const verified = await this.verifyStage(stagingDirectory, stagedPath, plan, result.artboards);
                            if ('failure' in verified) {
                                failure = verified.failure;
                                return;
                            }
                            if ('path' in verified.artifact)
                                stagedPath = verified.artifact.path;
                            const session = await store.readRasterRecord(exportId, 'session');
                            if (session.state !== 'v2')
                                throw new Error('The lease could not be read back before binding.');
                            await store.writeRasterRecord('artifact_binding', {
                                ...common, recordType: 'artifact_binding', recordedAt: recordedAt(), export: { commandId, completedInactive: true }, sessionDigest: session.digest,
                                stagedPath, stagedIdentity: serializeFileIdentity(verified.artifact.identity), mediaType: verified.artifact.mediaType, bytes: verified.artifact.bytes,
                                sha256: verified.artifact.sha256, width: verified.artifact.width, height: verified.artifact.height,
                                ...('viewBox' in verified.artifact ? { viewBox: verified.artifact.viewBox } : {}),
                                copyAfterExport: { identity: hostDocumentIdentitySchema.parse(result.workCopy), activeArtboardIndex: result.activeArtboardIndex, artboards: result.artboards },
                            });
                            artifact = verified.artifact;
                            await refresh();
                        }),
                    },
                });
                closeKey = exported.workCopy.key;
            }
            catch (error) {
                const detail = parseExportHostError(error);
                if (error instanceof IndeterminateExecutionError || detail?.code === undefined)
                    return asIndeterminate(error);
                if (detail.code === 'EXPORT_WORK_COPY_NOT_UNIQUE' || detail.code === 'EXPORT_WORK_COPY_IDENTITY_MISMATCH')
                    return asIndeterminate(error);
                if (RASTER_EXPORT_PRE_ATTEMPT_CODES.includes(detail.code) || (svg && detail.code === 'RASTER_EXPORT_OPTIONS_NOT_APPLIED')) {
                    failure = { stage: 'export', reason: 'export_refused', message: `The export was refused before any write (${detail.code}).` };
                }
                else if (detail.code === RASTER_EXPORT_FAILED_CODE) {
                    failure = { stage: 'export', reason: 'export_failed', message: `Illustrator refused the export: ${detail.message ?? 'unknown error'}` };
                }
                else {
                    return asIndeterminate(error);
                }
            }
            stage = 'close_work_copy';
            let outcome = null;
            try {
                await this.host(meter, {
                    kind: 'read',
                    script: svg ? SVG_CLOSE_WORK_COPY_SCRIPT : EXPORT_CLOSE_WORK_COPY_SCRIPT,
                    params: {
                        workCopyPath, workCopyKey: closeKey, ...scopeParams, sourcePath: plan.sourceFile.path,
                        expectedDocumentKey: plan.document.key, sourceFileRevision: plan.document.fileRevision,
                    },
                    timeoutMs: EXPORT_HOST_TIMEOUT_MS,
                    hostGate: {
                        beforeHost: async () => { await assertUnchanged(); },
                        afterHost: async ({ commandId, data }) => await recorded('close', commandId, async () => {
                            const result = data;
                            if (result.documentCount !== opened.documentCountBefore || (result.closedBeforeClose.path === null || !sameFilePath(result.closedBeforeClose.path, workCopyPath)) || result.source.key !== plan.document.key) {
                                throw new Error('Illustrator reported an unexpected document inventory after closing the work copy.');
                            }
                            await assertUnchanged();
                            if ((await matchingDocumentScope(result, sessionScope)).length !== 0)
                                throw new Error('A session document remains open; the export evidence is kept.');
                            await store.writeRasterRecord('host_terminal', {
                                ...common, recordType: 'host_terminal', recordedAt: recordedAt(), close: { commandId, completedInactive: true },
                                closedBeforeClose: hostDocumentIdentitySchema.parse(result.closedBeforeClose), sourceKey: result.source.key,
                                sourceSaved: true, sourceFileRevision: plan.document.fileRevision, documentCount: result.documentCount,
                            });
                            stage = 'verify_source';
                            try {
                                const after = await inspectSourceFile(plan.sourceFile.path);
                                if (after.path !== plan.sourceFile.path || !await sameFileOrSameBytes(plan.sourceFile.path, after.identity, plan.sourceFile.identity, plan.sourceFile.sha256)) {
                                    failure ??= { stage, reason: 'source_changed', message: 'The source file changed during the export.' };
                                }
                            }
                            catch (error) {
                                if (!(error instanceof BackupPreconditionError))
                                    throw error;
                                failure ??= { stage, reason: 'source_changed', message: error.message };
                            }
                            const bound = artifact;
                            if (failure !== null || bound === null) {
                                outcome = await this.recordFailure(exportId, common, failure ?? { stage, reason: 'output_verification_failed', message: 'The export produced no verified file.' }, ownedWorkCopy());
                                return;
                            }
                            stage = 'publish_output';
                            await rootScope.assertStable();
                            await parentScope.assertStable();
                            let outputIdentity;
                            try {
                                await (this.deps.durableFilePolicy ?? DEFAULT_DURABLE_FILE_POLICY).checkOutputParentCheckpoint('beforeLink', parentScope, { staging: stagingDirectory, files: [stagedPath] });
                                if (plan.expectedOutput !== undefined) {
                                    const records = await store.readRasterRecordSet(exportId);
                                    if (records.prepare.state !== 'v2' || records.artifact_binding.state !== 'v2' || records.host_terminal.state !== 'v2')
                                        throw new Error('Overwrite requires the full pre-publication record chain.');
                                    replacementIntent = await prepareReplacementIntent({ version: 5, kind: RASTER_EXPORT_KIND, recordType: 'replacement_intent', exportId, planDigest: plan.digest, renderVersion,
                                        publicationDigest: canonicalSha256(replacementPublicationPayload(records)),
                                        expected: plan.expectedOutput, staged: { path: stagedPath, identity: serializeFileIdentity(bound.identity), bytes: bound.bytes, sha256: bound.sha256 },
                                        prepareDigest: records.prepare.digest, bindingDigest: records.artifact_binding.digest, hostTerminalDigest: records.host_terminal.digest }, store.stateRootPath, this.deps.replacementHook);
                                    await store.writeReplacementIntent(replacementIntent);
                                    replacement = replacementSummary(replacementIntent);
                                    await this.deps.replacementHook?.('intent_ready');
                                    await requireReplacementTerminal(store, await store.readRasterRecordSet(exportId));
                                    await detachPreviousOutput(replacementIntent, this.deps.replacementHook);
                                    await this.deps.replacementHook?.('before_publish');
                                    await requireReplacementTerminal(store, await store.readRasterRecordSet(exportId));
                                }
                                outputIdentity = await linkBoundArtifact(stagedPath, plan.output.path, bound, parentScope);
                                if (replacementIntent !== null) {
                                    await syncReplacementDirectory(stagingDirectory);
                                    const terminal = await requireReplacementTerminal(store, await store.readRasterRecordSet(exportId));
                                    if (terminal.filesystem !== 'published')
                                        throw new ReplacementTerminalInvalidError('The new output does not match the replacement intent.');
                                    await this.deps.replacementHook?.('published');
                                }
                            }
                            catch (error) {
                                if (plan.expectedOutput !== undefined && error instanceof OutputReplacementError && await store.readReplacementIntent(exportId) === null) {
                                    const beforeIntent = await requireReplacementTerminal(store, await store.readRasterRecordSet(exportId));
                                    outcome = await this.recordFailure(exportId, common, { stage, reason: error.reason, message: error.message }, ownedWorkCopy(), beforeIntent.summary);
                                    return;
                                }
                                if (replacementIntent !== null && (error instanceof OutputReplacementError || error instanceof RasterPublishError)) {
                                    const retained = error instanceof OutputReplacementError && error.retained.length ? error.retained : replacementIntent.slot === null ? [] : [{ path: replacementIntent.slot, reason: 'Previous or foreign output retained pending reconciliation.' }];
                                    replacement = replacementSummary(replacementIntent, retained);
                                    if (error instanceof OutputReplacementError && error.restoredForeign !== undefined)
                                        replacement.restoredForeign = error.restoredForeign;
                                    if (error instanceof OutputReplacementError && error.foreignRestored) {
                                        outcome = await this.recordFailure(exportId, common, { stage, reason: 'output_changed', message: error.message }, ownedWorkCopy(), replacement);
                                    }
                                    else {
                                        await store.writeRasterRecord('quarantine', { ...common, recordType: 'quarantine', recordedAt: recordedAt(), reason: error.message });
                                        outcome = indeterminate(`${error.message} Run illustrator_reconcile_export inspect; retained paths are included in replacement.`);
                                    }
                                    return;
                                }
                                if (error instanceof OutputPreLinkCheckError) {
                                    outcome = await this.recordFailure(exportId, common, { stage: 'pre_link_check', reason: 'output_verification_failed', message: error.message }, ownedWorkCopy());
                                    return;
                                }
                                if (!(error instanceof RasterPublishError))
                                    throw error;
                                outcome = await this.recordFailure(exportId, common, { stage, reason: error.reason, message: error.message }, ownedWorkCopy());
                                return;
                            }
                            const artifactRecord = z.union([rasterExportArtifactSchema, svgArtifactSchema]).parse({ path: plan.output.path, mediaType: bound.mediaType, bytes: bound.bytes, sha256: bound.sha256, width: bound.width, height: bound.height, ...('viewBox' in bound ? { viewBox: bound.viewBox } : {}) });
                            const set = await store.readRasterRecordSet(exportId);
                            if (set.artifact_binding.state !== 'v2' || set.host_terminal.state !== 'v2')
                                throw new Error('The binding or host evidence could not be read back before publishing.');
                            await store.writeRasterRecord('published', {
                                ...common, recordType: 'published', recordedAt: recordedAt(), bindingDigest: set.artifact_binding.digest,
                                hostTerminalDigest: set.host_terminal.digest, artifact: artifactRecord, outputIdentity: serializeFileIdentity(outputIdentity),
                                sourcePath: plan.sourceFile.path, artboardIndex: plan.artboard.index, options: plan.options,
                                ...('scale' in plan.options ? {} : { expected: plan.expected }),
                                ...(plan.svg === undefined ? {} : { expectedBounds: plan.svg.expectedBounds }),
                                ...(replacementIntent === null ? {} : replacementPublicationPayload(set)),
                                ...(replacement === undefined ? {} : { replacement }),
                            });
                            stage = 'cleanup';
                            if (replacementIntent !== null) {
                                await requireReplacementTerminal(store, await store.readRasterRecordSet(exportId), 'published');
                                await cleanupPreviousSlot(replacementIntent, this.deps.replacementHook);
                                await requireReplacementTerminal(store, await store.readRasterRecordSet(exportId), 'published');
                            }
                            const entries = await this.cleanup([
                                { path: stagedPath, remove: async () => await unlinkStagedName(stagedPath, outputIdentity, parentScope) },
                                { path: stagingDirectory, remove: async () => await removeEmptyDirectory(stagingDirectory, plan.output.parent) },
                                ...ownedWorkCopy(),
                            ], replacementIntent === null ? undefined : async () => { await requireReplacementTerminal(store, await store.readRasterRecordSet(exportId), 'published'); });
                            await store.writeRasterRecord('cleanup', { ...common, recordType: 'cleanup', recordedAt: recordedAt(), disposition: 'published', entries });
                            if (replacementIntent !== null)
                                await requireReplacementTerminal(store, await store.readRasterRecordSet(exportId), 'published');
                            await store.releaseRasterSession(exportId);
                            outcome = {
                                outcome: 'verified', exportId, delivery: 'original', artifact: artifactRecord, sourcePreserved: true, cleanup: entries,
                                ...(replacement === undefined ? {} : { replacement }),
                                timing: { totalMs: 0, hostCalls: 0, hostMs: 0 },
                            };
                        }),
                    },
                });
            }
            catch (error) {
                return asIndeterminate(error);
            }
            const final = outcome;
            if (final === null)
                return indeterminate('The close completed without a recorded outcome.');
            return final.outcome === 'verified'
                ? { ...final, timing: { totalMs: performance.now() - started, hostCalls: meter.calls, hostMs: meter.ms } }
                : final;
        }));
    }
    async verifyStage(stagingDirectory, stagedPath, plan, artboards) {
        const stage = 'verify_output';
        const names = await readdir(stagingDirectory);
        if (plan.options.format === 'svg') {
            if (names.length !== 1)
                return { failure: { stage, reason: 'unexpected_output_files', message: `The SVG stage must contain exactly one file; found ${JSON.stringify(names)}.` } };
            try {
                const artifact = await inspectSvgArtifact(join(stagingDirectory, names[0]), plan, artboards);
                await syncDirectory(stagingDirectory);
                return { artifact };
            }
            catch (error) {
                if (error instanceof SvgArtifactError)
                    return { failure: { stage, reason: error.reason, message: error.message } };
                throw error;
            }
        }
        if (names.length !== 1 || names[0] !== basename(stagedPath)) {
            return { failure: { stage, reason: 'unexpected_output_files', message: `The stage holds ${JSON.stringify(names)} instead of one ${basename(stagedPath)}.` } };
        }
        let artifact;
        try {
            artifact = await inspectRasterArtifact(stagedPath, plan.options.format);
        }
        catch (error) {
            if (error instanceof RasterArtifactError)
                return { failure: { stage, reason: 'output_verification_failed', message: error.message } };
            throw error;
        }
        await syncDirectory(stagingDirectory);
        if (!artifactSizeAdmitted(artifact, plan.expected, plan.expectedRange)) {
            return { failure: { stage, reason: 'dimension_mismatch', message: `The file is ${artifact.width}x${artifact.height} px; the contract expects ${describeExpectedSize(plan.expected, plan.expectedRange)}.` } };
        }
        return { artifact };
    }
    async cleanup(targets, beforeRemove) {
        const entries = [];
        for (const target of targets) {
            await beforeRemove?.();
            const removed = await target.remove();
            entries.push(removed ? { path: target.path, removed, reason: 'owned' } : await retainedEntry(target.path, 'retained: ownership not proven'));
        }
        return entries;
    }
    async recordFailure(exportId, common, failure, owned, replacement) {
        const store = this.deps.exportStore;
        const set = await store.readRasterRecordSet(exportId);
        const evidenceDigests = common.version === 5 ? replacementTerminalEvidence(set) : {};
        if (common.version !== 5)
            for (const [type, read] of Object.entries(set))
                if (read.state === 'v2')
                    evidenceDigests[type] = read.digest;
        const summary = common.version !== 5 ? undefined : replacement ?? (await requireReplacementTerminal(store, set)).summary;
        await store.writeRasterRecord('failed', { ...common, recordType: 'failed', recordedAt: this.now().toISOString(), ...failure, evidenceDigests, ...(summary === undefined ? {} : { replacement: summary }) });
        if (common.version === 5)
            await requireReplacementTerminal(store, await store.readRasterRecordSet(exportId), 'failed');
        const entries = await this.cleanup(owned, common.version !== 5 ? undefined : async () => { await requireReplacementTerminal(store, await store.readRasterRecordSet(exportId), 'failed'); });
        await store.writeRasterRecord('cleanup', { ...common, recordType: 'cleanup', recordedAt: this.now().toISOString(), disposition: 'failed', entries });
        if (common.version === 5)
            await requireReplacementTerminal(store, await store.readRasterRecordSet(exportId), 'failed');
        await store.releaseRasterSession(exportId);
        return this.failedResult(await store.readRasterRecordSet(exportId), 'original');
    }
    async failBeforeWriting(exportId, common, meter, failure, sessionScope, owned, assertUnchanged) {
        let outcome = null;
        try {
            await this.host(meter, {
                kind: 'read', script: EXPORT_INVENTORY_SCRIPT, params: { sessionPaths: sessionScope.paths, ...(sessionScope.directories.length === 0 ? {} : { sessionDirectoryPaths: sessionScope.directories }) },
                hostGate: {
                    afterHost: async ({ data }) => {
                        if ((await matchingDocumentScope(data, sessionScope)).length !== 0)
                            return;
                        await assertUnchanged();
                        outcome = await this.recordFailure(exportId, common, failure, owned);
                    },
                },
            });
        }
        catch (error) {
            return { outcome: 'indeterminate', exportId, stage: failure.stage, message: `${failure.message} The failure could not be recorded: ${error instanceof Error ? error.message : String(error)}`, commandId: null };
        }
        return outcome ?? { outcome: 'indeterminate', exportId, stage: failure.stage, message: `${failure.message} A session document is open.`, commandId: null };
    }
}
export class RasterPrepareRefusal extends Error {
    reason;
    constructor(reason, message) {
        super(message);
        this.reason = reason;
        this.name = 'RasterPrepareRefusal';
    }
}
export class RasterAfterHostError extends Error {
    step;
    commandId;
    constructor(step, commandId, written, cause) {
        super(`Illustrator completed the ${step} (command ${commandId}); the records written so far are ${written.join(', ') || 'none'}, and the rest were not written ` +
            `(${cause instanceof z.ZodError ? summarizeValidationFailure(cause) : cause instanceof Error ? cause.message : String(cause)}). The lease is kept for the export reconcile.`, { cause });
        this.step = step;
        this.commandId = commandId;
        this.name = 'RasterAfterHostError';
    }
}
export class RasterStateChangedError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RasterStateChangedError';
    }
}
export function recordSetFingerprint(set) {
    return JSON.stringify(Object.keys(set).sort().map((type) => {
        const read = set[type];
        return [type, read.state, read.state === 'v2' ? read.digest : read.state === 'invalid' ? read.reason : null];
    }));
}
export async function pathTaken(path) {
    return await lstat(path).then(() => true, (error) => {
        if (error.code === 'ENOENT')
            return false;
        throw error;
    });
}
export async function removeOwnedFile(path, identity) {
    let handle;
    const flags = noFollowReadFlags();
    try {
        handle = await open(path, flags);
    }
    catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ELOOP')
            return false;
        throw error;
    }
    try {
        const before = await handle.stat({ bigint: true });
        if (!before.isFile() || !sameFileIdentity(identity, fileIdentityOf(before)) || before.nlink !== 1n)
            return false;
        await unlink(path);
        if ((await handle.stat({ bigint: true })).nlink !== 0n)
            throw new Error(`${path} kept another link after the unlink.`);
    }
    finally {
        await handle.close();
    }
    await syncDirectory(dirname(path));
    return true;
}
export async function removeEmptyDirectory(path, parent) {
    try {
        await rmdir(path);
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOTEMPTY' || code === 'EEXIST' || code === 'ENOENT' || code === 'ENOTDIR')
            return false;
        throw error;
    }
    await syncDirectory(parent);
    return true;
}
const digitsSchema = z.string().regex(/^\d+$/u);
const quarantinedFileSchema = z.strictObject({
    name: z.string().regex(/^[A-Za-z0-9._-]{1,200}$/u),
    size: z.number().int().nonnegative(),
    sha256: sha256Schema,
    dev: digitsSchema,
    ino: digitsSchema,
    mode: z.number().int().nonnegative(),
    uid: z.number().int().nonnegative(),
    nlink: z.number().int().positive(),
});
export const rasterQuarantineManifestSchema = z.strictObject({
    version: z.literal(1),
    kind: z.literal('raster_export'),
    exportId: z.uuid(),
    quarantinedAt: z.string().min(1),
    entries: z.array(quarantinedFileSchema).max(256),
});
export function rasterQuarantinePaths(stateRoot, exportId) {
    const base = join(stateRoot, 'quarantine');
    const area = join(base, 'exports');
    return { base, area, manifest: join(area, `${exportId}.json`), directory: join(area, exportId) };
}
export async function readRasterQuarantineManifest(stateRoot, exportId) {
    const path = rasterQuarantinePaths(stateRoot, exportId).manifest;
    if (!await pathTaken(path))
        return { state: 'missing' };
    const record = await readSecurePrivateRecord(path, 262_144, { maxLinkCount: await createOnceLinkAllowance(path) }).catch((error) => {
        if (error.code === 'ENOENT')
            return { state: 'missing' };
        throw error;
    });
    if (record.state === 'missing')
        return { state: 'missing' };
    if (record.state === 'invalid')
        return { state: 'invalid', reason: record.reason };
    try {
        const parsed = rasterQuarantineManifestSchema.safeParse(JSON.parse(record.text));
        if (!parsed.success || parsed.data.exportId !== exportId)
            return { state: 'invalid', reason: 'malformed_manifest' };
        return { state: 'valid', manifest: parsed.data };
    }
    catch {
        return { state: 'invalid', reason: 'malformed_json' };
    }
}
async function ensurePrivateSubdirectory(path, parent) {
    try {
        await mkdir(path, { mode: 0o700 });
    }
    catch (error) {
        if (error.code !== 'EEXIST')
            throw error;
    }
    const metadata = await lstat(path, { bigint: true });
    const uid = currentUid();
    if (!metadata.isDirectory() || Number(metadata.uid) !== uid || (metadata.mode & 511n) !== 448n) {
        throw new RasterQuarantineRefusal(`${path} is not a private directory of this user.`);
    }
    await syncDirectory(parent);
}
export class RasterQuarantineRefusal extends Error {
    constructor(message) {
        super(message);
        this.name = 'RasterQuarantineRefusal';
    }
}
const QUARANTINE_FILE_LIMIT = 1_048_576;
const QUARANTINE_NAME = /^[A-Za-z0-9._-]{1,200}$/u;
async function hashEntry(path, expected) {
    const handle = await open(path, noFollowNonBlockingReadFlags());
    try {
        const metadata = await handle.stat({ bigint: true });
        if (!metadata.isFile() || metadata.ino !== expected.ino || metadata.dev !== expected.dev)
            throw new RasterQuarantineRefusal(`${basename(path)} changed while it was inspected.`);
        const bytes = await readBounded(handle, QUARANTINE_FILE_LIMIT);
        if (bytes === null)
            throw new RasterQuarantineRefusal(`${basename(path)} is larger than ${QUARANTINE_FILE_LIMIT} bytes.`);
        return createHash('sha256').update(bytes).digest('hex');
    }
    finally {
        await handle.close();
    }
}
export async function moveRasterExportToQuarantine(stateRoot, exportsDirectory, exportId, now) {
    const paths = rasterQuarantinePaths(stateRoot, exportId);
    const uid = currentUid();
    const lease = `${exportId}${RASTER_EXPORT_RECORD_SUFFIXES.session}`;
    const names = (await readdir(exportsDirectory)).filter((name) => name.startsWith(`${exportId}.`)).sort();
    if (names.length > 256)
        throw new RasterQuarantineRefusal(`Export ${exportId} has ${names.length} entries; at most 256 are moved.`);
    const observed = new Map();
    for (const name of names) {
        if (!QUARANTINE_NAME.test(name))
            throw new RasterQuarantineRefusal(`${JSON.stringify(name)} is not a safe entry name.`);
        observed.set(name, await lstat(join(exportsDirectory, name), { bigint: true }));
    }
    const existing = await readRasterQuarantineManifest(stateRoot, exportId);
    if (existing.state === 'invalid')
        throw new RasterQuarantineRefusal(`The quarantine manifest of ${exportId} is unreadable (${existing.reason}).`);
    const recorded = existing.state === 'valid' ? existing.manifest.entries : [];
    const quarantined = new Map();
    for (const name of await readdir(paths.directory).catch(() => [])) {
        const metadata = await lstat(join(paths.directory, name), { bigint: true });
        if (!recorded.some((entry) => entry.name === name && entry.ino === String(metadata.ino) && entry.dev === String(metadata.dev))) {
            throw new RasterQuarantineRefusal(`${name} in the quarantine directory is not in its manifest.`);
        }
        quarantined.set(name, metadata);
    }
    for (const [name, metadata] of observed) {
        if (metadata.isSymbolicLink() || !metadata.isFile())
            throw new RasterQuarantineRefusal(`${name} is not a regular file.`);
        if (Number(metadata.uid) !== uid)
            throw new RasterQuarantineRefusal(`${name} is owned by another user.`);
        const same = (candidate) => candidate.ino === metadata.ino && candidate.dev === metadata.dev;
        const here = [...observed.entries()].filter(([other, candidate]) => other !== name && same(candidate));
        if (!here.every(([other]) => temporaryTwinPattern(name).test(other) || temporaryTwinPattern(other).test(name))) {
            throw new RasterQuarantineRefusal(`${name} shares its inode with an unrelated entry.`);
        }
        const there = [...quarantined.values()].filter(same).length;
        if (metadata.nlink !== BigInt(1 + here.length + there))
            throw new RasterQuarantineRefusal(`${name} has an unexpected link count.`);
    }
    const entries = [...recorded];
    for (const [name, metadata] of observed) {
        const known = recorded.find((entry) => entry.name === name);
        if (known !== undefined) {
            if (known.ino !== String(metadata.ino) || known.dev !== String(metadata.dev))
                throw new RasterQuarantineRefusal(`${name} changed since it was recorded in the manifest.`);
            continue;
        }
        entries.push({ name, size: Number(metadata.size), sha256: await hashEntry(join(exportsDirectory, name), metadata), dev: String(metadata.dev),
            ino: String(metadata.ino), mode: Number(metadata.mode & 4095n), uid: Number(metadata.uid), nlink: Number(metadata.nlink) });
    }
    if (entries.length > 256)
        throw new RasterQuarantineRefusal(`The quarantine manifest of ${exportId} would exceed 256 entries.`);
    await ensurePrivateSubdirectory(paths.base, stateRoot);
    await ensurePrivateSubdirectory(paths.area, paths.base);
    const manifest = rasterQuarantineManifestSchema.parse({ version: 1, kind: 'raster_export', exportId,
        quarantinedAt: existing.state === 'valid' ? existing.manifest.quarantinedAt : now, entries });
    if (existing.state === 'missing')
        await atomicCreatePrivateRecord(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
    else if (entries.length !== recorded.length)
        await atomicReplacePrivateRecord(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
    await ensurePrivateSubdirectory(paths.directory, paths.area);
    const moved = [];
    const move = async (name) => {
        const source = join(exportsDirectory, name);
        const target = join(paths.directory, name);
        const metadata = observed.get(name);
        try {
            await link(source, target);
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                throw error;
            const present = await lstat(target, { bigint: true });
            if (present.ino !== metadata.ino || present.dev !== metadata.dev)
                throw new RasterQuarantineRefusal(`${name} already exists in the quarantine directory as another file.`);
        }
        await syncDirectory(paths.directory);
        await unlink(source);
        await syncDirectory(exportsDirectory);
        moved.push(name);
    };
    for (const name of names)
        if (name !== lease)
            await move(name);
    if (names.includes(lease))
        await move(lease);
    return moved;
}
export const RASTER_RECONCILE_ACTIONS = ['inspect', 'close_work_copy', 'finalize', 'abandon', 'release_quarantined', 'restore_previous', 'finalize_publish'];
const residueSchema = z.strictObject({ path: z.string(), present: z.boolean(), owned: z.boolean(), reason: z.string() });
export const rasterReconcileResultSchema = z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('no_records'), exportId: z.string() }),
    z.strictObject({ status: z.literal('invalid'), exportId: z.string(), reason: z.string() }),
    z.strictObject({ status: z.literal('closed'), exportId: z.string(), replacement: replacementSummarySchema.optional(), disposition: z.enum(['published', 'failed']).optional() }),
    z.strictObject({
        status: z.literal('unresolved'), exportId: z.string(), window: z.string(), action: z.enum(RASTER_RECONCILE_ACTIONS),
        reason: z.string().nullable(), documents: z.number().int().nonnegative().nullable(), residue: z.array(residueSchema),
        message: z.string().nullable(),
    }),
    z.strictObject({
        status: z.literal('released'), exportId: z.string(), window: z.string(), action: z.enum(RASTER_RECONCILE_ACTIONS),
        disposition: z.enum(['published', 'failed', 'released_after_cleanup', 'quarantine_released', 'moved_to_quarantine']),
    }),
    z.strictObject({ status: z.literal('moved_to_quarantine'), exportId: z.string(), manifestPath: z.string(), entries: z.array(z.string()) }),
    z.strictObject({
        status: z.literal('residue_cleaned'), exportId: z.string(),
        entries: z.array(z.strictObject({ path: z.string().min(1), removed: z.boolean(), reason: z.string() })),
    }),
]);
export function rasterWindow(set, stageHasFiles) {
    const has = (type) => set[type].state === 'v2';
    if (has('quarantine'))
        return has('session') ? 'Q' : 'closed';
    if (!has('session'))
        return has('prepare') && !has('published') && !has('failed') && !has('cleanup') ? 'W0' : 'closed';
    if (has('cleanup'))
        return 'W8';
    if (has('failed'))
        return 'F';
    if (has('published'))
        return 'W7';
    if (has('host_terminal'))
        return 'W5';
    if (has('artifact_binding'))
        return 'W4';
    if (has('host_open'))
        return stageHasFiles ? 'W3' : 'W2';
    return 'W1';
}
export async function retainedEntry(path, reason) {
    return { path, removed: false, reason: await pathTaken(path) ? reason : 'absent' };
}
export async function presence(paths) {
    return await Promise.all(paths.map(async (path) => {
        const present = await pathTaken(path);
        return { path, present, owned: false, reason: present ? 'retained' : 'absent' };
    }));
}
export async function w0Residue(prepare) {
    const uid = currentUid();
    const checks = [];
    const present = async (path) => await lstat(path, { bigint: true }).catch((error) => {
        if (error.code === 'ENOENT')
            return null;
        throw error;
    });
    const copy = await present(prepare.workCopyPath);
    if (copy === null) {
        checks.push({ path: prepare.workCopyPath, present: false, owned: false, reason: 'absent' });
    }
    else {
        let owned = copy.isFile() && Number(copy.uid) === uid && copy.nlink === 1n;
        let reason = owned ? 'owned' : 'not a single regular file of this user';
        if (owned && await hashWholeFile(prepare.workCopyPath) !== prepare.sourceSha256) {
            owned = false;
            reason = 'content differs from the source (partial or replaced copy)';
        }
        const identity = fileIdentityOf(copy);
        checks.push({ path: prepare.workCopyPath, present: true, owned, reason, ...(owned ? { remove: async () => await removeOwnedFile(prepare.workCopyPath, identity) } : {}) });
    }
    const stage = await present(prepare.stagingDirectory);
    if (stage === null) {
        checks.push({ path: prepare.stagingDirectory, present: false, owned: false, reason: 'absent' });
    }
    else {
        const parent = await lstat(prepare.outputParent, { bigint: true });
        const empty = stage.isDirectory() ? (await readdir(prepare.stagingDirectory)).length === 0 : false;
        const owned = stage.isDirectory() && Number(stage.uid) === uid && (stage.mode & 511n) === 448n && empty &&
            String(parent.dev) === prepare.outputParentIdentity.dev && String(parent.ino) === prepare.outputParentIdentity.ino && stage.dev === parent.dev;
        checks.push({ path: prepare.stagingDirectory, present: true, owned, reason: owned ? 'owned' : 'not an empty private directory of this user in the recorded output folder',
            ...(owned ? { remove: async () => await removeEmptyDirectory(prepare.stagingDirectory, prepare.outputParent) } : {}) });
    }
    return checks;
}
export class RasterExportReconciler {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    get store() { return this.deps.exportStore; }
    now() { return (this.deps.now ?? (() => new Date()))().toISOString(); }
    async reconcile(input) {
        try {
            return await this.reconcileInternal(input);
        }
        catch (error) {
            if (error instanceof ReplacementTerminalInvalidError)
                return { status: 'invalid', exportId: input.exportId, reason: error.message };
            throw error;
        }
    }
    async reconcileInternal(input) {
        const exportId = canonicalCommandIdSchema.parse(input.exportId);
        const leasePresent = await pathTaken(this.store.rasterRecordPath(exportId, 'session'));
        const moved = await readRasterQuarantineManifest(this.store.stateRootPath, exportId);
        const set = await this.store.readRasterRecordSet(exportId);
        const state = assessRasterRecordSet(set);
        const overwrite = Object.values(set).some(read => read.state === 'v2' && read.record.version === 5) || await pathTaken(this.store.replacementIntentPath(exportId));
        if (!overwrite && (input.action === 'restore_previous' || input.action === 'finalize_publish'))
            throw new Error('This action applies only to an overwrite export (version 5).');
        const replacementTerminal = overwrite ? await assessReplacementTerminal(this.store, set) : null;
        if (replacementTerminal?.state === 'invalid')
            return { status: 'invalid', exportId, reason: `${replacementTerminal.reason}: ${replacementTerminal.detail}` };
        if (leasePresent && (state.state === 'invalid' || moved.state !== 'missing')) {
            return await this.moveToQuarantine(input, exportId, set, state.state === 'invalid' ? state.reason : 'quarantine move in progress');
        }
        if (moved.state === 'valid') {
            return { status: 'moved_to_quarantine', exportId, manifestPath: rasterQuarantinePaths(this.store.stateRootPath, exportId).manifest, entries: moved.manifest.entries.map((entry) => entry.name) };
        }
        if (moved.state === 'invalid')
            return { status: 'invalid', exportId, reason: `quarantine manifest: ${moved.reason}` };
        if (state.state === 'none')
            return { status: 'no_records', exportId };
        if (state.state === 'invalid')
            return { status: 'invalid', exportId, reason: state.reason };
        if (state.state === 'published' || state.state === 'failed' || (state.state === 'prepared' && state.abandoned) ||
            (state.state === 'quarantined' && state.released)) {
            return { status: 'closed', exportId, ...(replacementTerminal?.state === 'valid' && replacementTerminal.disposition !== null ? { replacement: replacementTerminal.summary } : {}) };
        }
        const prepare = set.prepare.state === 'v2' ? set.prepare.record : null;
        if (prepare === null)
            return { status: 'invalid', exportId, reason: 'records without prepare' };
        const stageFiles = await readdir(prepare.stagingDirectory).then((names) => names.length > 0, () => false);
        const window = rasterWindow(set, stageFiles);
        const common = commonForRecord(prepare);
        const scope = sessionScopeOf(prepare, set);
        const fingerprint = recordSetFingerprint(set);
        const unresolved = (reason, documents = null, residue = [], message = null) => ({
            status: 'unresolved', exportId, window, action: input.action, reason, documents,
            residue: residue.map(({ path, present, owned, reason: why }) => ({ path, present, owned, reason: why })), message,
        });
        const unchanged = async () => recordSetFingerprint(await this.store.readRasterRecordSet(exportId)) === fingerprint;
        if (prepare.version === 5 && window !== 'W0' && (input.action !== 'close_work_copy' || window === 'Q'))
            return await this.reconcileOverwrite(input, set, prepare, scope);
        if (window === 'Q') {
            const residue = await presence([prepare.workCopyPath, prepare.stagingDirectory, ...(scope.stagedPath === null ? [] : [scope.stagedPath]), prepare.outputPath]);
            const guidance = `Export ${exportId} is quarantined. Check ${prepare.outputPath} and the retained files, then run release_quarantined with confirm_export_id equal to the export id.`;
            if (input.action !== 'release_quarantined')
                return unresolved('quarantined', null, residue, guidance);
            if (input.confirmExportId !== exportId)
                return unresolved('confirm_export_id_mismatch', null, residue, guidance);
            let released = false;
            let refusal = null;
            const documents = await this.inventory(scope, async (count) => {
                if (count !== 0) {
                    refusal = 'session_document_open';
                    return;
                }
                if (!await unchanged()) {
                    refusal = 'state_changed';
                    return;
                }
                if (set.cleanup.state !== 'v2') {
                    const entries = await Promise.all([prepare.workCopyPath, prepare.stagingDirectory, prepare.outputPath].map(async (path) => await retainedEntry(path, 'retained: quarantined evidence')));
                    await this.store.writeRasterRecord('cleanup', { ...common, recordType: 'cleanup', recordedAt: this.now(), disposition: 'quarantine_released', entries });
                }
                await this.store.releaseRasterSession(exportId);
                released = true;
            });
            return released ? { status: 'released', exportId, window, action: input.action, disposition: 'quarantine_released' } : unresolved(refusal, documents, residue, guidance);
        }
        if (window === 'W0') {
            const residue = await w0Residue(prepare);
            if (input.action !== 'abandon')
                return unresolved('prepared_before_open', null, residue);
            let entries = null;
            let refusal = null;
            await this.inventory(scope, async (count) => {
                if (count !== 0) {
                    refusal = 'session_document_open';
                    return;
                }
                if (!await unchanged()) {
                    refusal = 'state_changed';
                    return;
                }
                if (prepare.version === 5)
                    await requireReplacementTerminal(this.store, await this.store.readRasterRecordSet(exportId));
                const removed = [];
                for (const check of await w0Residue(prepare)) {
                    const done = check.remove ? await check.remove() : false;
                    removed.push({ path: check.path, removed: done, reason: done ? 'owned' : `retained: ${check.reason}` });
                }
                if (prepare.version === 5)
                    await requireReplacementTerminal(this.store, await this.store.readRasterRecordSet(exportId));
                await this.store.writeRasterRecord('cleanup', { ...common, recordType: 'cleanup', recordedAt: this.now(), disposition: 'abandoned_before_open', entries: removed });
                entries = removed;
            });
            return entries === null ? unresolved(refusal ?? 'not_cleaned', null, residue) : { status: 'residue_cleaned', exportId, entries };
        }
        if (input.action === 'close_work_copy') {
            const expected = window === 'W2' && set.host_open.state === 'v2'
                ? { identity: set.host_open.record.workCopy, artboards: set.host_open.record.artboards }
                : window === 'W4' && set.artifact_binding.state === 'v2'
                    ? { identity: set.artifact_binding.record.copyAfterExport.identity, artboards: set.artifact_binding.record.copyAfterExport.artboards }
                    : null;
            if (expected === null) {
                const reason = window === 'W3' ? 'dirty_copy_without_export_evidence' : window === 'W1' ? 'copy_open_without_evidence' : 'nothing_to_close';
                return unresolved(reason, null, [], window === 'W1' || window === 'W3'
                    ? 'This copy cannot be closed automatically; close it in Illustrator without saving, then run abandon.' : null);
            }
            try {
                const closed = await closeRasterWorkCopy(this.deps.bridge, scope, { path: expected.identity.path, key: expected.identity.key, saved: expected.identity.saved, fileRevision: expected.identity.fileRevision,
                    artboards: expected.artboards.map((board) => ({ rect: board.rect })) }, { records: this.store, exportId, fingerprint });
                return unresolved(closed.remaining === 0 ? 'work_copy_closed' : 'work_copy_still_open', closed.remaining);
            }
            catch (error) {
                const detail = parseExportHostError(error);
                if (detail?.code === 'RASTER_RECONCILE_CLOSE_REFUSED' || detail?.code === 'RASTER_RECONCILE_NOT_UNIQUE')
                    return unresolved(`close_refused:${detail.code}`);
                throw error;
            }
        }
        let released = null;
        let refusal = null;
        const documents = await this.inventory(scope, async (count) => {
            if (input.action === 'inspect')
                return;
            if (count !== 0) {
                refusal = 'session_document_open';
                return;
            }
            if (!await unchanged()) {
                refusal = 'state_changed';
                return;
            }
            const outcome = await this.resolveWindow(window, input.action, set, prepare, common);
            if (outcome === null)
                refusal = `action_not_allowed_in_${window}`;
            else if (outcome === 'quarantined')
                refusal = 'quarantined';
            else
                released = { status: 'released', exportId, window, action: input.action, disposition: outcome };
        });
        return released ?? unresolved(refusal, documents);
    }
    async reconcileOverwrite(input, set, prepare, scope) {
        const common = commonForRecord(prepare);
        const initial = await assessReplacementTerminal(this.store, set);
        if (initial.state === 'invalid')
            return { status: 'invalid', exportId: input.exportId, reason: `${initial.reason}: ${initial.detail}` };
        const intent = initial.intent;
        const paths = [prepare.workCopyPath, prepare.stagingDirectory, prepare.outputPath,
            ...(intent?.slot ? [intent.slot] : []), ...(intent?.archive ? [intent.archive.path] : [])];
        const residue = await presence(paths);
        for (const r of residue)
            if (intent?.slot === r.path)
                r.reason = 'Previous or third-party output retained in the private slot; inspect identity before recovery.';
        const unresolved = (reason, window = 'Q', documents = null) => ({
            status: 'unresolved', exportId: input.exportId, window, action: input.action, reason, documents, residue,
            message: 'Output changes require explicit restore_previous or finalize_publish with confirm_export_id. Foreign slots are retained, never deleted automatically.',
        });
        if (set.quarantine.state === 'v2')
            return unresolved(`quarantined: ${set.quarantine.record.reason}`);
        const observed = initial.filesystem;
        const failed = set.failed.state === 'v2' && set.failed.record.version === 5 ? set.failed.record : null;
        if (observed === 'foreign' && failed === null)
            return unresolved('output_or_slot_identity_mismatch');
        if (input.action === 'inspect')
            return unresolved('explicit_action_required', observed);
        if (input.action === 'release_quarantined' || input.action === 'close_work_copy')
            return unresolved('action_not_allowed', observed);
        if ((input.action === 'restore_previous' || input.action === 'finalize_publish') && input.confirmExportId !== input.exportId)
            return unresolved('confirm_export_id_mismatch', observed);
        const fingerprint = recordSetFingerprint(set);
        const intentDigest = (await this.store.readReplacementIntent(input.exportId))?.digest ?? null;
        let result = null;
        const documents = await this.inventory(scope, async (count) => {
            if (count !== 0) {
                result = unresolved('session_document_open', observed, count);
                return;
            }
            if (recordSetFingerprint(await this.store.readRasterRecordSet(input.exportId)) !== fingerprint || ((await this.store.readReplacementIntent(input.exportId))?.digest ?? null) !== intentDigest) {
                result = unresolved('state_changed', observed, count);
                return;
            }
            const ids = new Set();
            if (set.session.state === 'v2')
                ids.add(set.session.record.openCommandId);
            if (set.host_open.state === 'v2')
                ids.add(set.host_open.record.open.commandId);
            if (set.artifact_binding.state === 'v2')
                ids.add(set.artifact_binding.record.export.commandId);
            if (set.host_terminal.state === 'v2')
                ids.add(set.host_terminal.record.close.commandId);
            for (const id of ids)
                if (await this.deps.bridge.commandExecutionState?.(id) !== 'inactive') {
                    result = unresolved('host_command_not_inactive', observed, count);
                    return;
                }
            const terminal = await assessReplacementTerminal(this.store, await this.store.readRasterRecordSet(input.exportId));
            if (terminal.state === 'invalid') {
                result = { status: 'invalid', exportId: input.exportId, reason: `${terminal.reason}: ${terminal.detail}` };
                return;
            }
            let current = terminal.filesystem;
            if (failed !== null) {
                if (!['finalize', 'restore_previous', 'abandon'].includes(input.action)) {
                    result = unresolved('failed_terminal_requires_finalize', current, count);
                    return;
                }
                await requireReplacementTerminal(this.store, set, 'failed');
                if (intent !== null && current === 'restored')
                    await cleanupPreviousSlot(intent);
                if (set.cleanup.state !== 'v2')
                    await this.store.writeRasterRecord('cleanup', { ...common, recordType: 'cleanup', recordedAt: this.now(), disposition: 'failed', entries: await Promise.all(paths.map(path => retainedEntry(path, 'retained: failed overwrite evidence'))) });
                await requireReplacementTerminal(this.store, await this.store.readRasterRecordSet(input.exportId), 'failed');
                await this.store.releaseRasterSession(input.exportId);
                result = { status: 'released', exportId: input.exportId, window: current, action: input.action, disposition: 'failed' };
                return;
            }
            const published = async () => {
                if (intent === null || set.artifact_binding.state !== 'v2' || set.host_terminal.state !== 'v2' || set.session.state !== 'v2')
                    throw new Error('Replacement publication requires its original record chain.');
                const metadata = await lstat(prepare.outputPath, { bigint: true });
                if (set.published.state !== 'v2')
                    await this.store.writeRasterRecord('published', {
                        ...common, recordType: 'published', recordedAt: this.now(), bindingDigest: set.artifact_binding.digest, hostTerminalDigest: set.host_terminal.digest,
                        ...replacementPublicationPayload(set), replacement: terminal.summary,
                    });
                await requireReplacementTerminal(this.store, await this.store.readRasterRecordSet(input.exportId), 'published');
                await cleanupPreviousSlot(intent);
                await requireReplacementTerminal(this.store, await this.store.readRasterRecordSet(input.exportId), 'published');
                const entries = [];
                const removed = await unlinkStagedName(intent.staged.path, fileIdentityOf(metadata), null);
                entries.push({ path: intent.staged.path, removed, reason: removed ? 'owned' : 'already absent or retained' });
                await requireReplacementTerminal(this.store, await this.store.readRasterRecordSet(input.exportId), 'published');
                const stageRemoved = await removeEmptyDirectory(prepare.stagingDirectory, prepare.outputParent);
                entries.push({ path: prepare.stagingDirectory, removed: stageRemoved, reason: stageRemoved ? 'owned' : 'retained' });
                entries.push(await retainedEntry(prepare.workCopyPath, 'retained: reconcile does not delete the work copy'));
                if (set.cleanup.state !== 'v2')
                    await this.store.writeRasterRecord('cleanup', { ...common, recordType: 'cleanup', recordedAt: this.now(), disposition: 'published', entries });
                await requireReplacementTerminal(this.store, await this.store.readRasterRecordSet(input.exportId), 'published');
                await this.store.releaseRasterSession(input.exportId);
                result = { status: 'released', exportId: input.exportId, window: 'published', action: input.action, disposition: 'published' };
            };
            if (input.action === 'finalize_publish' && (current === 'detached' || current === 'create')) {
                if (intent === null)
                    throw new Error('Missing write-ahead replacement intent.');
                await assertReplacementScopes(intent);
                await withOutputParentScope(prepare.outputParent, async (parent) => {
                    const i = intent.staged.identity;
                    await linkBoundArtifact(intent.staged.path, prepare.outputPath, { identity: { dev: BigInt(i.dev), ino: BigInt(i.ino), size: BigInt(i.size), mtimeNs: BigInt(i.mtimeNs), ctimeNs: BigInt(i.ctimeNs) }, bytes: intent.staged.bytes, sha256: intent.staged.sha256 }, parent);
                    await syncReplacementDirectory(prepare.stagingDirectory);
                });
                current = (await requireReplacementTerminal(this.store, await this.store.readRasterRecordSet(input.exportId))).filesystem;
            }
            if (current === 'published' && (input.action === 'finalize' || input.action === 'finalize_publish')) {
                await published();
                return;
            }
            if (intent !== null && input.action === 'restore_previous' && (current === 'detached' || current === 'restored')) {
                await restorePreviousOutput(intent);
                current = (await requireReplacementTerminal(this.store, await this.store.readRasterRecordSet(input.exportId))).filesystem;
            }
            if ((input.action === 'abandon' && (current === 'previous' || current === 'create' || current === 'before_intent')) || (input.action === 'restore_previous' && current === 'restored')) {
                const assessment = await requireReplacementTerminal(this.store, await this.store.readRasterRecordSet(input.exportId));
                const summary = assessment.summary;
                if (set.failed.state !== 'v2')
                    await this.store.writeRasterRecord('failed', { ...common, recordType: 'failed', recordedAt: this.now(), stage: 'reconcile',
                        reason: current === 'restored' ? 'previous_restored' : 'not_published', message: 'No new output is published; retained evidence is kept.', evidenceDigests: replacementTerminalEvidence(set), replacement: summary });
                await requireReplacementTerminal(this.store, await this.store.readRasterRecordSet(input.exportId), 'failed');
                if (intent !== null && current === 'restored')
                    await cleanupPreviousSlot(intent);
                if (set.cleanup.state !== 'v2')
                    await this.store.writeRasterRecord('cleanup', { ...common, recordType: 'cleanup', recordedAt: this.now(), disposition: 'failed', entries: await Promise.all(paths.map(path => retainedEntry(path, 'retained: overwrite recovery evidence'))) });
                await requireReplacementTerminal(this.store, await this.store.readRasterRecordSet(input.exportId), 'failed');
                await this.store.releaseRasterSession(input.exportId);
                result = { status: 'released', exportId: input.exportId, window: current, action: input.action, disposition: 'failed' };
                return;
            }
            result = unresolved(`action_not_allowed_in_${current}`, current, count);
        });
        return result ?? unresolved('not_released', observed, documents);
    }
    async inventory(scope, underLock) {
        let matched = null;
        await this.deps.bridge.execute({
            kind: 'read', script: EXPORT_INVENTORY_SCRIPT, params: { sessionPaths: scope.paths },
            hostGate: { afterHost: async ({ data }) => {
                    const inventory = data;
                    matched = (await matchingDocumentScope(inventory, scope)).length;
                    await underLock(matched, inventory.documentCount);
                } },
        });
        if (matched === null)
            throw new Error('The export inventory was not verified under the host lock.');
        return matched;
    }
    async quarantineCandidateState(exportId) {
        const leasePresent = await pathTaken(this.store.rasterRecordPath(exportId, 'session'));
        const manifest = await readRasterQuarantineManifest(this.store.stateRootPath, exportId);
        const set = await this.store.readRasterRecordSet(exportId);
        if (!leasePresent || Object.values(set).some((read) => read.state === 'v1'))
            return null;
        const state = assessRasterRecordSet(set);
        if (state.state !== 'invalid' && manifest.state === 'missing')
            return null;
        return JSON.stringify([recordSetFingerprint(set), manifest.state, manifest.state === 'valid' ? manifest.manifest.entries.length : null]);
    }
    async moveToQuarantine(input, exportId, set, why) {
        const prepare = set.prepare.state === 'v2' ? set.prepare.record : null;
        const scope = prepare === null ? { paths: [], directories: [], stagedPath: null } : sessionScopeOf(prepare, set);
        const guidance = `The records of export ${exportId} are not a legal state (${why}). Check the export folder and the files, then run release_quarantined with confirm_export_id equal to the export id; the records are moved unread into quarantine/exports/ and the lease last.`;
        const unresolved = (reason, documents = null) => ({ status: 'unresolved', exportId, window: 'I', action: input.action, reason, documents, residue: [], message: guidance });
        if (Object.values(set).some((read) => read.state === 'v1'))
            return unresolved('version_1_records_present');
        if (input.action !== 'release_quarantined')
            return unresolved(`invalid_records: ${why}`);
        if (input.confirmExportId !== exportId)
            return unresolved('confirm_export_id_mismatch');
        const observedState = await this.quarantineCandidateState(exportId);
        let refusal = null;
        let moved = false;
        const documents = await this.inventory(scope, async (count, documentCount) => {
            if (prepare !== null ? count !== 0 : documentCount !== 0) {
                refusal = prepare !== null ? 'session_document_open' : 'documents_open_without_prepare';
                return;
            }
            const now = await this.quarantineCandidateState(exportId);
            if (now === null || now !== observedState) {
                refusal = 'state_changed';
                return;
            }
            try {
                await moveRasterExportToQuarantine(this.store.stateRootPath, this.store.recordDirectory, exportId, this.now());
                moved = true;
            }
            catch (error) {
                if (!(error instanceof RasterQuarantineRefusal))
                    throw error;
                refusal = `quarantine_refused: ${error.message}`;
            }
        });
        return moved ? { status: 'released', exportId, window: 'I', action: input.action, disposition: 'moved_to_quarantine' } : unresolved(refusal ?? 'not_moved', documents);
    }
    async resolveWindow(window, action, set, prepare, common) {
        const exportId = common.exportId;
        const retainAll = async () => await Promise.all([prepare.workCopyPath, prepare.stagingDirectory].map(async (path) => await retainedEntry(path, 'retained: reconcile keeps evidence')));
        const fail = async (reason, message) => {
            const evidenceDigests = {};
            for (const [type, read] of Object.entries(set))
                if (read.state === 'v2')
                    evidenceDigests[type] = read.digest;
            await this.store.writeRasterRecord('failed', { ...common, recordType: 'failed', recordedAt: this.now(), stage: `reconcile_${window}`, reason, message, evidenceDigests });
            await this.store.writeRasterRecord('cleanup', { ...common, recordType: 'cleanup', recordedAt: this.now(), disposition: 'failed', entries: await retainAll() });
            await this.store.releaseRasterSession(exportId);
            return 'failed';
        };
        switch (window) {
            case 'W8':
                if (action !== 'finalize')
                    return null;
                await this.store.releaseRasterSession(exportId);
                return 'released_after_cleanup';
            case 'F':
                if (action !== 'finalize' && action !== 'abandon')
                    return null;
                await this.store.writeRasterRecord('cleanup', { ...common, recordType: 'cleanup', recordedAt: this.now(), disposition: 'failed', entries: await retainAll() });
                await this.store.releaseRasterSession(exportId);
                return 'failed';
            case 'W7': {
                if (action !== 'finalize' || set.published.state !== 'v2' || set.artifact_binding.state !== 'v2')
                    return null;
                const outputIdentity = set.published.record.outputIdentity;
                const staged = set.artifact_binding.record.stagedPath;
                const identity = { dev: BigInt(outputIdentity.dev), ino: BigInt(outputIdentity.ino), size: BigInt(outputIdentity.size),
                    mtimeNs: BigInt(outputIdentity.mtimeNs), ctimeNs: BigInt(outputIdentity.ctimeNs) };
                const stagedRemoved = await unlinkStagedName(staged, identity, null);
                const stageRemoved = await removeEmptyDirectory(prepare.stagingDirectory, prepare.outputParent);
                const entries = [
                    stagedRemoved ? { path: staged, removed: true, reason: 'owned' } : await retainedEntry(staged, 'retained: not the second link of the output'),
                    stageRemoved ? { path: prepare.stagingDirectory, removed: true, reason: 'owned' } : await retainedEntry(prepare.stagingDirectory, 'retained: not empty'),
                    await retainedEntry(prepare.workCopyPath, 'retained: reconcile keeps the work copy'),
                ];
                await this.store.writeRasterRecord('cleanup', { ...common, recordType: 'cleanup', recordedAt: this.now(), disposition: 'published', entries });
                await this.store.releaseRasterSession(exportId);
                return 'published';
            }
            case 'W5':
            case 'W6': {
                if (set.host_terminal.state !== 'v2' || set.session.state !== 'v2')
                    return null;
                if (set.artifact_binding.state !== 'v2') {
                    return action === 'abandon' ? await fail('not_published', 'The export stopped after the copy was closed without a verified file; nothing was published.') : null;
                }
                const binding = set.artifact_binding.record;
                const session = set.session.record;
                const stat = async (path) => await lstat(path, { bigint: true }).catch((error) => {
                    if (error.code === 'ENOENT')
                        return null;
                    throw error;
                });
                const staged = await stat(binding.stagedPath);
                const output = await stat(prepare.outputPath);
                const isBound = (metadata) => metadata !== null && metadata.isFile() &&
                    String(metadata.dev) === binding.stagedIdentity.dev && String(metadata.ino) === binding.stagedIdentity.ino;
                const stagedUnlinked = isBound(staged) && staged.nlink === 1n;
                if (stagedUnlinked && output === null) {
                    return action === 'abandon' ? await fail('not_published', 'The export stopped after the copy was closed and before publication; nothing was published.') : null;
                }
                if (stagedUnlinked && output !== null && !isBound(output)) {
                    return action === 'abandon' || action === 'finalize'
                        ? await fail('output_exists', `Another file appeared at ${prepare.outputPath} before publication; it was not touched.`)
                        : null;
                }
                if (isBound(staged) && staged.nlink === 2n && isBound(output) && await hashWholeFile(prepare.outputPath) === binding.sha256) {
                    if (action !== 'finalize')
                        return null;
                    await this.store.writeRasterRecord('published', isSvgExportRecord(session) && isSvgExportRecord(binding) ? {
                        ...common, recordType: 'published', recordedAt: this.now(), bindingDigest: set.artifact_binding.digest, hostTerminalDigest: set.host_terminal.digest,
                        artifact: { path: prepare.outputPath, mediaType: binding.mediaType, bytes: binding.bytes, sha256: binding.sha256, width: binding.width, height: binding.height, viewBox: binding.viewBox },
                        outputIdentity: serializeFileIdentity(fileIdentityOf(output)), sourcePath: prepare.sourcePath, artboardIndex: session.artboardIndex, options: session.options,
                        expected: session.expected, expectedBounds: session.expectedBounds,
                    } : {
                        ...common, recordType: 'published', recordedAt: this.now(), bindingDigest: set.artifact_binding.digest, hostTerminalDigest: set.host_terminal.digest,
                        artifact: { path: prepare.outputPath, mediaType: binding.mediaType, bytes: binding.bytes, sha256: binding.sha256, width: binding.width, height: binding.height },
                        outputIdentity: serializeFileIdentity(fileIdentityOf(output)), sourcePath: prepare.sourcePath, artboardIndex: session.artboardIndex, options: session.options,
                        ...(isExactExportRecord(session) ? { expected: session.expected } : {}),
                    });
                    return await this.resolveWindow('W7', 'finalize', await this.store.readRasterRecordSet(exportId), prepare, common);
                }
                await this.store.writeRasterRecord('quarantine', { ...common, recordType: 'quarantine', recordedAt: this.now(), reason: 'the staged and output files match no §6.3.4 case' });
                return 'quarantined';
            }
            case 'W1':
            case 'W2':
            case 'W3':
            case 'W4':
                if (action !== 'abandon')
                    return null;
                return await fail(window === 'W1' ? 'open_not_completed' : window === 'W4' ? 'not_published' : 'unbound_artifact_or_not_exported', `The export stopped in ${window}; no file was published and the retained residue is kept as evidence.`);
            default:
                return null;
        }
    }
}
function rasterExtensionOf(set) {
    return set.session.state === 'v2' && set.session.record.options.format === 'jpeg' ? '.jpg' : '.png';
}
export function sessionScopeOf(prepare, set) {
    if (isSvgExportRecord(prepare)) {
        const stagedPath = set.artifact_binding.state === 'v2' ? set.artifact_binding.record.stagedPath : null;
        return { paths: [prepare.workCopyPath, prepare.outputPath, ...(stagedPath === null ? [] : [stagedPath])], directories: [prepare.stagingDirectory], stagedPath };
    }
    const stagedPath = join(prepare.stagingDirectory, `artifact${rasterExtensionOf(set)}`);
    return { paths: [prepare.workCopyPath, stagedPath, prepare.outputPath], directories: [], stagedPath };
}
export class RasterPublishError extends Error {
    reason;
    constructor(reason, message) {
        super(message);
        this.reason = reason;
        this.name = 'RasterPublishError';
    }
}
export async function linkBoundArtifact(stagedPath, outputPath, bound, parentScope, linkImpl = link, streamingByteLimit) {
    const handle = await open(stagedPath, noFollowReadFlags());
    try {
        const before = await handle.stat({ bigint: true });
        if (!before.isFile() || before.nlink !== 1n || before.dev !== bound.identity.dev || before.ino !== bound.identity.ino || before.size !== bound.identity.size) {
            throw new RasterPublishError('file_replaced', `The staged file ${stagedPath} is no longer the bound artifact.`);
        }
        try {
            await linkImpl(stagedPath, outputPath);
        }
        catch (error) {
            const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
            if (code === 'EEXIST')
                throw new RasterPublishError('output_exists', `The output path already exists: ${outputPath}. Nothing was overwritten; the verified file remains at ${stagedPath}.`);
            if (code === 'EXDEV')
                throw new RasterPublishError('output_cross_device', 'The output path is on a different device from its staging directory.');
            throw error;
        }
        await parentScope.sync();
        const published = await open(outputPath, noFollowReadFlags());
        try {
            const metadata = await published.stat({ bigint: true });
            const hashMatches = streamingByteLimit === undefined
                ? createHash('sha256').update(await readBounded(published, RASTER_MAX_ARTIFACT_BYTES) ?? Buffer.alloc(0)).digest('hex') === bound.sha256
                : bound.bytes <= streamingByteLimit && await verifyReplacementFile({ path: outputPath, identity: serializeFileIdentity(bound.identity), bytes: bound.bytes, sha256: bound.sha256 }, [2]);
            if (!metadata.isFile() || metadata.dev !== before.dev || metadata.ino !== before.ino || metadata.nlink !== 2n || !hashMatches) {
                throw new BackupCopyError('The published output does not resolve to the bound staged inode and bytes.');
            }
            return fileIdentityOf(metadata);
        }
        finally {
            await published.close();
        }
    }
    finally {
        await handle.close();
    }
}
export async function unlinkStagedName(stagedPath, outputIdentity, parentScope) {
    let metadata;
    try {
        metadata = await lstat(stagedPath, { bigint: true });
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return false;
        throw error;
    }
    if (!metadata.isFile() || metadata.dev !== outputIdentity.dev || metadata.ino !== outputIdentity.ino || metadata.nlink !== 2n)
        return false;
    await parentScope?.assertStable();
    await unlink(stagedPath);
    await syncDirectory(dirname(stagedPath));
    return true;
}
function commonForRecord(prepare) {
    return { version: prepare.version, kind: RASTER_EXPORT_KIND, exportId: prepare.exportId, planDigest: prepare.planDigest,
        ...(prepare.version === 5 ? { renderVersion: prepare.renderVersion, expectedOutput: prepare.expectedOutput, requestDigest: prepare.requestDigest } : {}) };
}
