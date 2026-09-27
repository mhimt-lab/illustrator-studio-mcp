import { z } from 'zod';
import { documentContextSchema } from './mutation-result-schema-core.js';
import { canonicalSha256 } from './mutation-canonical.js';
import { EXPORT_HELPERS, OutputVerificationError, exportStageSchema, } from './document-export.js';
import { PdfStructureError, readPdfFileStructure } from './pdf-structure.js';
export const PDF_EXPORT_MAX_BLEED_PT = 72;
export const PDF_EXPORT_BOX_TOLERANCE_PT = 0.01;
export const PDF_EXPORT_PRESET_NOTE = 'The preset is passed to Illustrator by name; which of its settings reach the file is not verified (a PDF/X preset applied through scripting was measured to produce a non-PDF/X file). The pdf facts are read from the file.';
const PDFX_PRESET_PATTERN = /PDF\s*\/?\s*X/i;
export function parseArtboardSelection(selection, artboardCount) {
    const invalid = (message) => ({ reason: 'artboard_range_invalid', message });
    const text = selection.trim();
    if (text.toLowerCase() === 'all')
        return Array.from({ length: artboardCount }, (_, index) => index + 1);
    if (text === '')
        return invalid('artboards must be "all" or artboard numbers such as "1,3" or "2-4"; an empty range is not accepted.');
    const numbers = [];
    for (const part of text.split(',')) {
        const match = /^\s*(\d{1,4})\s*(?:-\s*(\d{1,4})\s*)?$/.exec(part);
        if (match === null)
            return invalid(`"${part.trim()}" is not an artboard number or span.`);
        const from = Number(match[1]);
        const to = match[2] === undefined ? from : Number(match[2]);
        if (from < 1 || to > artboardCount)
            return invalid(`Artboard ${from < 1 ? from : to} does not exist; the document has ${artboardCount} artboard(s).`);
        if (to < from)
            return invalid(`The span ${from}-${to} is descending; Illustrator writes pages in ascending artboard order only.`);
        for (let number = from; number <= to; number += 1) {
            if (numbers.length > 0 && number <= numbers[numbers.length - 1]) {
                return invalid('Artboards must be listed once each, in ascending order: Illustrator writes pages in ascending artboard order whatever the list order.');
            }
            numbers.push(number);
        }
    }
    return numbers;
}
export function canonicalArtboardRange(numbers) {
    const contiguous = numbers.every((number, index) => index === 0 || number === numbers[index - 1] + 1);
    if (numbers.length === 1)
        return String(numbers[0]);
    return contiguous ? `${numbers[0]}-${numbers[numbers.length - 1]}` : numbers.join(',');
}
function artboardSize(artboard) {
    const [left, top, right, bottom] = artboard.rect;
    return [Number(Math.abs(right - left).toFixed(4)), Number(Math.abs(top - bottom).toFixed(4))];
}
export function planPdfExport(request, document, artboards, presets) {
    if (!presets.includes(request.pdfPreset)) {
        return { reason: 'pdf_preset_unknown', message: `pdf_preset ${JSON.stringify(request.pdfPreset)} is not in Illustrator's PDF preset list (exact match); choose one of availablePresets.` };
    }
    if (PDFX_PRESET_PATTERN.test(request.pdfPreset)) {
        return { reason: 'pdf_preset_unsupported', message: 'PDF/X presets are refused: through scripting, a PDF/X-4 preset was measured to write a PDF 1.4 file without an output intent, so PDF/X output cannot be produced or verified by this tool.' };
    }
    const bleed = { left: request.bleed.left ?? 0, top: request.bleed.top ?? 0, right: request.bleed.right ?? 0, bottom: request.bleed.bottom ?? 0 };
    for (const [side, value] of Object.entries(bleed)) {
        if (!Number.isFinite(value) || value < 0 || value > PDF_EXPORT_MAX_BLEED_PT) {
            return { reason: 'bleed_invalid', message: `bleed.${side} must be between 0 and ${PDF_EXPORT_MAX_BLEED_PT} pt.` };
        }
    }
    const numbers = parseArtboardSelection(request.artboards, artboards.length);
    if (!Array.isArray(numbers))
        return numbers;
    const marks = {
        trim: request.marks.trim ?? false,
        registration: request.marks.registration ?? false,
        colorBars: request.marks.colorBars ?? false,
        pageInformation: request.marks.pageInformation ?? false,
        style: request.marks.style ?? 'roman',
    };
    const pages = numbers.map((number, index) => ({
        page: index + 1, artboard: number, name: artboards[number - 1].name, size: artboardSize(artboards[number - 1]),
    }));
    const artboardRange = canonicalArtboardRange(numbers);
    const planDigest = canonicalSha256({
        kind: 'pdf_export_plan_v1',
        document: { key: document.key, path: document.path, fileRevision: document.fileRevision },
        artboards: artboards.map((artboard) => [...artboard.rect]),
        preset: request.pdfPreset, artboardRange, marks: { ...marks }, bleed: { ...bleed }, outputPath: request.outputPath,
    });
    return { preset: request.pdfPreset, artboardRange, pages, marks, bleed, outputPath: request.outputPath, planDigest };
}
export function artboardRectsKey(artboards) {
    return artboards.map((artboard) => artboard.rect.join(',')).join(';');
}
export const PDF_EXPORT_SAVE_PRE_ATTEMPT_CODES = [
    'EXPORT_WORK_COPY_NOT_UNIQUE',
    'EXPORT_WORK_COPY_IDENTITY_MISMATCH',
    'EXPORT_OUTPUT_EXISTS',
    'EXPORT_PDF_PRESET_UNKNOWN',
    'EXPORT_PDF_ARTBOARDS_CHANGED',
];
export const PDF_EXPORT_SAVE_SCRIPT = `${EXPORT_HELPERS}
var pdfSaveTarget = exportRequireWorkCopy(params.workCopyPath, params.workCopyKey);
var pdfSaveDocument = pdfSaveTarget.doc;
var pdfOutputFile = new File(params.stagedPath);
if (pdfOutputFile.exists || new File(params.outputPath).exists) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_OUTPUT_EXISTS" }));
}
var pdfPresetFound = false;
for (var pdfPresetCursor = 0; pdfPresetCursor < app.PDFPresetsList.length; pdfPresetCursor++) {
  if (String(app.PDFPresetsList[pdfPresetCursor]) === params.preset) pdfPresetFound = true;
}
if (!pdfPresetFound) throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_PDF_PRESET_UNKNOWN", preset: params.preset }));
if (exportArtboardRects(pdfSaveDocument) !== params.artboardRects) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_PDF_ARTBOARDS_CHANGED" }));
}
var pdfOptions = new PDFSaveOptions();
pdfOptions.pDFPreset = params.preset;
pdfOptions.artboardRange = params.artboardRange;
pdfOptions.trimMarks = params.marks.trim;
pdfOptions.registrationMarks = params.marks.registration;
pdfOptions.colorBars = params.marks.colorBars;
pdfOptions.pageInformation = params.marks.pageInformation;
pdfOptions.pageMarksType = params.marks.style === "japanese" ? PageMarksTypes.Japanese : PageMarksTypes.Roman;
pdfOptions.bleedLink = false;
pdfOptions.bleedOffsetRect = [params.bleed.left, params.bleed.top, params.bleed.right, params.bleed.bottom];
pdfOptions.viewAfterSaving = false;
var pdfPathBefore = exportPathOf(pdfSaveDocument);
var pdfPreviousInteraction = app.userInteractionLevel;
app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
var pdfSaveError = null;
try { pdfSaveDocument.saveAs(pdfOutputFile, pdfOptions); }
catch (pdfCaughtSaveError) { pdfSaveError = String(pdfCaughtSaveError.message); }
finally { app.userInteractionLevel = pdfPreviousInteraction; }
var pdfOutputExists = new File(params.stagedPath).exists;
if (pdfSaveError !== null) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_SAVE_FAILED", message: pdfSaveError, outputExists: pdfOutputExists }));
}
if (!pdfOutputExists) throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_SAVE_NO_FILE" }));
var pdfPathAfter = exportPathOf(pdfSaveDocument);
if (pdfPathAfter !== params.stagedPath && pdfPathAfter !== pdfPathBefore) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_SAVE_UNEXPECTED_PATH", actual: pdfPathAfter }));
}
var result = {
  workCopy: getDocumentIdentity(pdfSaveDocument, pdfSaveTarget.index),
  pathBefore: pdfPathBefore,
  pathAfter: pdfPathAfter,
  outputExists: pdfOutputExists,
  artboardCount: pdfSaveDocument.artboards.length
};
`;
export function pdfSaveParams(plan, artboards) {
    return {
        preset: plan.preset,
        artboardRange: plan.artboardRange,
        marks: { ...plan.marks },
        bleed: { ...plan.bleed },
        artboardRects: artboardRectsKey(artboards),
    };
}
function near(a, b) {
    return Math.abs(a - b) <= PDF_EXPORT_BOX_TOLERANCE_PT;
}
export function bleedExtentsOf(page) {
    return {
        left: page.trimBox[0] - page.bleedBox[0],
        top: page.bleedBox[3] - page.trimBox[3],
        right: page.bleedBox[2] - page.trimBox[2],
        bottom: page.trimBox[1] - page.bleedBox[1],
    };
}
export function assertPdfMatchesPlan(structure, plan) {
    const fail = (message) => { throw new OutputVerificationError(message); };
    if (structure.pageCount !== plan.pages.length)
        fail(`The PDF has ${structure.pageCount} page(s); the plan has ${plan.pages.length}.`);
    plan.pages.forEach((expected, index) => {
        const page = structure.pages[index];
        const width = page.trimBox[2] - page.trimBox[0];
        const height = page.trimBox[3] - page.trimBox[1];
        if (!near(width, expected.size[0]) || !near(height, expected.size[1])) {
            fail(`Page ${expected.page} has a ${width}x${height} pt TrimBox; artboard ${expected.artboard} is ${expected.size[0]}x${expected.size[1]} pt.`);
        }
        const bleed = bleedExtentsOf(page);
        for (const side of ['left', 'top', 'right', 'bottom']) {
            if (!near(bleed[side], plan.bleed[side]))
                fail(`Page ${expected.page} has a ${side} bleed of ${bleed[side]} pt; the plan has ${plan.bleed[side]} pt.`);
        }
        const media = page.mediaBox;
        if (media[0] > page.bleedBox[0] + PDF_EXPORT_BOX_TOLERANCE_PT || media[1] > page.bleedBox[1] + PDF_EXPORT_BOX_TOLERANCE_PT ||
            media[2] < page.bleedBox[2] - PDF_EXPORT_BOX_TOLERANCE_PT || media[3] < page.bleedBox[3] - PDF_EXPORT_BOX_TOLERANCE_PT) {
            fail(`Page ${expected.page} has its BleedBox outside the MediaBox.`);
        }
        if (page.rotate % 360 !== 0)
            fail(`Page ${expected.page} is rotated ${page.rotate} degrees.`);
    });
}
export async function verifyPdfStructure(path, plan) {
    let structure;
    try {
        structure = await readPdfFileStructure(path);
    }
    catch (error) {
        if (error instanceof PdfStructureError)
            throw new OutputVerificationError(`The PDF structure could not be verified (${error.code}): ${error.message}`);
        throw error;
    }
    assertPdfMatchesPlan(structure, plan);
    return structure;
}
const boxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const marksSchema = z.strictObject({ trim: z.boolean(), registration: z.boolean(), colorBars: z.boolean(), pageInformation: z.boolean(), style: z.enum(['roman', 'japanese']) });
const bleedSchema = z.strictObject({ left: z.number(), top: z.number(), right: z.number(), bottom: z.number() });
const pageSchema = z.strictObject({ page: z.number().int().positive(), artboard: z.number().int().positive(), name: z.string(), size: z.tuple([z.number(), z.number()]) });
const filesSchema = z.strictObject({ workCopyPath: z.string().nullable(), stagedPath: z.string().nullable(), outputPath: z.string().nullable() });
const presetSchema = z.strictObject({ name: z.string(), settingsVerified: z.literal(false), note: z.string() });
export const pdfExportRejectionReasonSchema = z.enum([
    'document_key_mismatch', 'document_not_admitted', 'output_exists', 'output_path_invalid', 'output_cross_device',
    'pdf_preset_unknown', 'pdf_preset_unsupported', 'artboard_range_invalid', 'bleed_invalid', 'plan_stale',
    'source_file_unavailable', 'export_root_unavailable',
]);
export const pdfExportResultSchema = z.discriminatedUnion('outcome', [
    z.strictObject({
        outcome: z.literal('planned'),
        document: documentContextSchema,
        plan: z.strictObject({
            preset: presetSchema, artboardRange: z.string(), pages: z.array(pageSchema), marks: marksSchema, bleed: bleedSchema,
            outputPath: z.string(), planDigest: z.string(),
        }),
        nextCall: z.record(z.string(), z.unknown()),
        hostCalls: z.number().int().nonnegative(),
        durationMs: z.number().nonnegative(),
    }),
    z.strictObject({
        outcome: z.literal('verified'),
        outputPath: z.string(),
        bytes: z.number().int().positive(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        preset: presetSchema,
        artboardRange: z.string(),
        marks: marksSchema,
        bleed: bleedSchema,
        pages: z.array(pageSchema.extend({ mediaBox: boxSchema, trimBox: boxSchema, bleedBox: boxSchema })),
        pdf: z.strictObject({
            headerVersion: z.string(), catalogVersion: z.string().nullable(), xref: z.enum(['table', 'stream', 'hybrid']), objectStreams: z.number().int().nonnegative(),
            outputIntents: z.number().int().nonnegative(), pdfxVersion: z.string().nullable(),
        }),
        workCopy: z.strictObject({ path: z.string(), removed: z.boolean() }),
        staging: z.strictObject({ directory: z.string(), removed: z.boolean() }),
        sourcePreserved: z.literal(true),
        hostCalls: z.number().int().nonnegative(),
        durationMs: z.number().nonnegative(),
    }),
    z.strictObject({
        outcome: z.literal('rejected'),
        reason: pdfExportRejectionReasonSchema,
        message: z.string(),
        document: documentContextSchema.nullable(),
        availablePresets: z.array(z.string()).nullable(),
    }),
    z.strictObject({
        outcome: z.literal('failed'),
        reason: z.enum(['copy_mismatch', 'file_replaced', 'work_copy_open_failed', 'save_failed', 'output_verification_failed', 'output_exists', 'output_cross_device', 'work_copy_identity_mismatch', 'source_changed']),
        stage: exportStageSchema,
        message: z.string(),
        files: filesSchema,
    }),
    z.strictObject({
        outcome: z.literal('indeterminate'),
        stage: exportStageSchema,
        message: z.string(),
        commandId: z.string().nullable(),
        files: filesSchema,
        sessionId: z.string().nullable(),
    }),
]);
export function presetReport(name) {
    return { name, settingsVerified: false, note: PDF_EXPORT_PRESET_NOTE };
}
export function pdfFacts(structure) {
    return {
        headerVersion: structure.headerVersion, catalogVersion: structure.catalogVersion, xref: structure.xref,
        objectStreams: structure.objectStreams, outputIntents: structure.outputIntents.length, pdfxVersion: structure.pdfxVersion,
    };
}
