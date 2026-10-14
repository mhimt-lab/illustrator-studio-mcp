import { z } from 'zod';
import { documentContextSchema } from './mutation-result-schema-core.js';
import { canonicalSha256 } from './mutation-canonical.js';
import { EXPORT_HELPERS, OutputVerificationError, exportStageSchema, } from './document-export.js';
import { PdfStructureError, readPdfFileStructure } from './pdf-structure.js';
export const PDF_EXPORT_MAX_BLEED_PT = 72;
export const PDF_EXPORT_BOX_TOLERANCE_PT = 0.01;
export const PDF_EXPORT_PRESET_NOTE = 'The preset is passed to Illustrator by name; which of its settings reach the file is not verified (a PDF/X preset applied through scripting was measured to produce a non-PDF/X file). The pdf facts are read from the file.';
export const PDFX_VERSION_OF = {
    x3_2002: 'PDF/X-3:2002', x3_2003: 'PDF/X-3:2003', x4: 'PDF/X-4',
};
export const PDFX_OUTPUT_CONDITION_MAX = 256;
const PDFX_STRING_PATTERN = /^[\x20-\x7e]+$/;
export const PDF_EXPORT_DOCUMENT_BLEED_PT = 3 * 72 / 25.4;
export const pdfExportBleedInputSchema = z.union([
    z.strictObject({ left: z.number().min(0).max(72).optional(), top: z.number().min(0).max(72).optional(),
        right: z.number().min(0).max(72).optional(), bottom: z.number().min(0).max(72).optional() }),
    z.strictObject({ mode: z.literal('document'), expected_mm: z.literal(3) }),
]);
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
function ptToMm(pt) {
    return (Math.round(pt * 2540 / 72) / 100).toFixed(2);
}
function planPdfx(request) {
    const refuse = (message) => ({ reason: 'pdfx_unsupported', message });
    const { standard, outputCondition } = request;
    if (standard === 'x1a_2001' || standard === 'x1a_2003') {
        return refuse('PDF/X-1a is refused: Illustrator 30.8.2 was measured to ignore it silently (no PDF/X key and no output intent in the file, and no error). Use x3_2002, x3_2003 or x4.');
    }
    if (!Object.prototype.hasOwnProperty.call(PDFX_VERSION_OF, standard))
        return refuse(`pdfx.standard ${JSON.stringify(standard)} is not a known PDF/X standard.`);
    if (outputCondition === undefined)
        return { standard, version: PDFX_VERSION_OF[standard], outputCondition: null };
    if (standard !== 'x4') {
        return refuse('An output condition is admitted with x4 only: its combination with PDF/X-3 was not measured.');
    }
    for (const [field, value] of [['identifier', outputCondition.identifier], ['condition', outputCondition.condition], ['registry', outputCondition.registry]]) {
        if (value === undefined && field !== 'identifier')
            continue;
        if (typeof value !== 'string' || value.length === 0 || value.length > PDFX_OUTPUT_CONDITION_MAX || !PDFX_STRING_PATTERN.test(value)) {
            return refuse(`pdfx.output_condition.${field} must be 1-${PDFX_OUTPUT_CONDITION_MAX} printable ASCII characters.`);
        }
    }
    return {
        standard, version: PDFX_VERSION_OF[standard],
        outputCondition: { identifier: outputCondition.identifier, condition: outputCondition.condition ?? null, registry: outputCondition.registry ?? null },
    };
}
export function normalizePdfBleed(input) {
    const invalid = () => ({ reason: 'bleed_invalid', message: 'bleed must be integer point sides or exactly {mode:"document", expected_mm:3}; do not mix modes.' });
    if (typeof input !== 'object' || input === null || Array.isArray(input))
        return invalid();
    if ('mode' in input) {
        const doc = input;
        if (doc.mode !== 'document' || doc.expected_mm !== 3 || Object.keys(doc).some(key => key !== 'mode' && key !== 'expected_mm'))
            return invalid();
        const pt = PDF_EXPORT_DOCUMENT_BLEED_PT;
        return { source: 'document_via_preset', expectedMm: 3, expectedPoints: { left: pt, top: pt, right: pt, bottom: pt } };
    }
    if (Object.keys(input).some(key => !['left', 'top', 'right', 'bottom'].includes(key)))
        return invalid();
    const explicit = input;
    const bleed = { left: explicit.left ?? 0, top: explicit.top ?? 0, right: explicit.right ?? 0, bottom: explicit.bottom ?? 0 };
    for (const [side, value] of Object.entries(bleed)) {
        if (!Number.isFinite(value) || value < 0 || value > PDF_EXPORT_MAX_BLEED_PT) {
            return { reason: 'bleed_invalid', message: `bleed.${side} must be between 0 and ${PDF_EXPORT_MAX_BLEED_PT} pt.` };
        }
        if (!Number.isInteger(value)) {
            const lower = Math.floor(value);
            const upper = Math.ceil(value);
            return {
                reason: 'bleed_invalid',
                message: `bleed.${side} is ${value} pt, but Illustrator writes bleed in whole points (8.5 pt was measured to become 8 pt). Use ${lower} pt (${ptToMm(lower)} mm) or ${upper} pt (${ptToMm(upper)} mm).`,
            };
        }
    }
    return { source: 'explicit_points', expectedPoints: bleed, expectedMm: null };
}
export function planPdfExport(request, document, artboards, presets) {
    const candidates = presets.filter(raw => raw.normalize('NFC') === request.pdfPreset.normalize('NFC'));
    if (candidates.length !== 1) {
        return { reason: 'pdf_preset_unknown', message: `pdf_preset ${JSON.stringify(request.pdfPreset)} does not resolve uniquely in Illustrator's PDF preset list (NFC match); choose one of availablePresets.` };
    }
    const preset = candidates[0];
    if (PDFX_PRESET_PATTERN.test(preset)) {
        return { reason: 'pdf_preset_unsupported', message: 'PDF/X presets are refused: through scripting, a PDF/X-4 preset was measured to write a PDF 1.4 file without an output intent, so PDF/X output cannot be produced or verified by this tool.' };
    }
    let pdfx = null;
    if (request.pdfx !== undefined) {
        const planned = planPdfx(request.pdfx);
        if ('reason' in planned)
            return planned;
        pdfx = planned;
    }
    const normalized = normalizePdfBleed(request.bleed);
    if ('reason' in normalized)
        return normalized;
    const bleed = normalized.expectedPoints;
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
    const preserveEditability = request.preserveEditability ?? null;
    const planDigest = canonicalSha256({
        kind: normalized.source === 'explicit_points' ? 'pdf_export_plan_v1' : 'pdf_export_plan_v2_document_bleed',
        document: { key: document.key, path: document.path, fileRevision: document.fileRevision },
        artboards: artboards.map((artboard) => [...artboard.rect]),
        preset, artboardRange, marks: { ...marks }, bleed: { ...bleed }, outputPath: request.outputPath,
        ...(normalized.source === 'explicit_points' ? {} : { bleedSource: normalized.source, expectedBleedMm: normalized.expectedMm }),
        ...(pdfx === null ? {} : { pdfx: {
                standard: pdfx.standard, version: pdfx.version,
                outputCondition: pdfx.outputCondition === null ? null : { identifier: pdfx.outputCondition.identifier, condition: pdfx.outputCondition.condition, registry: pdfx.outputCondition.registry },
            } }),
        ...(preserveEditability === null ? {} : { preserveEditability }),
    });
    return { preset, artboardRange, pages, marks, bleed, bleedSource: normalized.source, expectedBleedMm: normalized.expectedMm, pdfx, preserveEditability, outputPath: request.outputPath, planDigest };
}
export function marksNeedRegistrationScan(marks) {
    return marks.trim === true || marks.registration === true;
}
export function registrationScanWarnings(scan) {
    if (scan === null || scan === undefined)
        return [];
    const warnings = [];
    if (scan.registrationStrokedPaths > 0) {
        warnings.push({
            code: 'existing_registration_lines',
            message: `The document already has ${scan.registrationStrokedPaths} path(s) stroked with the Registration colour (for example the lines illustrator_create_trim_marks draws; scanned ${scan.scannedPaths} of ${scan.totalPaths} path(s)). ` +
                'The trim or registration marks requested for the PDF are added on top of them, so the output may carry two sets of marks. This is a warning only; keep both if that is intended.',
        });
    }
    if (scan.scannedPaths < scan.totalPaths) {
        warnings.push({
            code: 'registration_scan_incomplete',
            message: `Only the first ${scan.scannedPaths} of ${scan.totalPaths} path(s) were scanned (limit ${scan.limit}); Registration-stroked paths among the remaining ${scan.totalPaths - scan.scannedPaths} were not checked.`,
        });
    }
    if (scan.unreadablePaths > 0) {
        warnings.push({
            code: 'registration_scan_unreadable',
            message: `${scan.unreadablePaths} scanned path(s) could not be read, so whether they are stroked with the Registration colour is unknown.`,
        });
    }
    return warnings;
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
    'EXPORT_PDF_PDFX_UNKNOWN',
    'EXPORT_PDF_BLEED_SOURCE_UNKNOWN',
];
const PDF_EXPORT_PRESERVE_SET = `// PDFSaveOptions.preserveEditability (#705): written only when requested, then read back before saveAs.
var pdfPreserveApplied = null;
var pdfPreserveNote = null;
pdfOptions.preserveEditability = params.preserveEditability ? true : false;
try {
  var pdfPreserveRead = pdfOptions.preserveEditability;
  if (pdfPreserveRead === true || pdfPreserveRead === false) pdfPreserveApplied = pdfPreserveRead;
  else pdfPreserveNote = "PDFSaveOptions.preserveEditability reads back as " + String(pdfPreserveRead) + ".";
} catch (pdfPreserveError) {
  pdfPreserveNote = "PDFSaveOptions.preserveEditability could not be read back: " + String(pdfPreserveError.message);
}
`;
const PDF_EXPORT_PRESERVE_RECORD = `result.preserveEditability = { applied: pdfPreserveApplied, note: pdfPreserveNote };
`;
function pdfExportSaveSource(preserveSet, preserveRecord) {
    return `${EXPORT_HELPERS}
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
if (!exportRectsEqual(exportArtboardRects(pdfSaveDocument), params.artboardRects)) {
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
if (params.bleedSource === "explicit_points") {
  pdfOptions.bleedLink = false;
  pdfOptions.bleedOffsetRect = [params.bleed.left, params.bleed.top, params.bleed.right, params.bleed.bottom];
} else if (params.bleedSource !== "document_via_preset") {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_PDF_BLEED_SOURCE_UNKNOWN" }));
}
${preserveSet}// Document mode deliberately leaves both bleed properties to the selected preset.
pdfOptions.viewAfterSaving = false;
if (params.pdfx !== null) {
  var pdfxStandards = { x3_2002: PDFXStandard.PDFX32002, x3_2003: PDFXStandard.PDFX32003, x4: PDFXStandard.PDFX42007 };
  if (pdfxStandards[params.pdfx.standard] === undefined) throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_PDF_PDFX_UNKNOWN", standard: params.pdfx.standard }));
  pdfOptions.pDFXStandard = pdfxStandards[params.pdfx.standard];
  if (params.pdfx.outputCondition !== null) {
    pdfOptions.outputConditionID = params.pdfx.outputCondition.identifier;
    if (params.pdfx.outputCondition.condition !== null) pdfOptions.outputCondition = params.pdfx.outputCondition.condition;
    if (params.pdfx.outputCondition.registry !== null) pdfOptions.registryName = params.pdfx.outputCondition.registry;
  }
}
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
if (!hostFilePathMatches(pdfPathAfter, params.stagedPath) && pdfPathAfter !== pdfPathBefore) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_SAVE_UNEXPECTED_PATH", actual: pdfPathAfter }));
}
var result = {
  workCopy: getDocumentIdentity(pdfSaveDocument, pdfSaveTarget.index),
  pathBefore: pdfPathBefore,
  pathAfter: pdfPathAfter,
  outputExists: pdfOutputExists,
  artboardCount: pdfSaveDocument.artboards.length
};
${preserveRecord}`;
}
export const PDF_EXPORT_SAVE_SCRIPT = pdfExportSaveSource('', '');
export const PDF_EXPORT_SAVE_PRESERVE_SCRIPT = pdfExportSaveSource(PDF_EXPORT_PRESERVE_SET, PDF_EXPORT_PRESERVE_RECORD);
export function pdfSaveParams(plan, artboards) {
    return {
        preset: plan.preset,
        artboardRange: plan.artboardRange,
        marks: { ...plan.marks },
        bleed: { ...plan.bleed },
        bleedSource: plan.bleedSource,
        pdfx: plan.pdfx === null ? null : { standard: plan.pdfx.standard, outputCondition: plan.pdfx.outputCondition === null ? null : { ...plan.pdfx.outputCondition } },
        artboardRects: artboardRectsKey(artboards),
        ...(plan.preserveEditability === null ? {} : { preserveEditability: plan.preserveEditability }),
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
        if (plan.bleedSource === 'document_via_preset' && !page.explicit.bleedBox) {
            fail(`Page ${expected.page} has no explicit BleedBox; document bleed could not be verified.`);
        }
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
export function assertPdfxGenerated(structure, pdfx) {
    const fail = (message) => { throw new OutputVerificationError(message); };
    if (structure.pdfxVersion !== pdfx.version)
        fail(`The PDF Info GTS_PDFXVersion is ${JSON.stringify(structure.pdfxVersion)}; the request is ${JSON.stringify(pdfx.version)}.`);
    if (!structure.xmp.readable)
        fail('The PDF XMP metadata could not be read, so GTS_PDFXVersion could not be confirmed there.');
    if (structure.xmp.pdfxidVersion !== pdfx.version || structure.xmp.pdfxVersion !== pdfx.version) {
        fail(`The PDF XMP GTS_PDFXVersion is ${JSON.stringify(structure.xmp.pdfxidVersion)} / ${JSON.stringify(structure.xmp.pdfxVersion)}; the request is ${JSON.stringify(pdfx.version)}.`);
    }
    const intents = structure.outputIntents.filter((intent) => intent.subtype === 'GTS_PDFX');
    if (intents.length !== 1 || structure.outputIntents.length !== 1)
        fail(`The PDF has ${structure.outputIntents.length} output intent(s) (${intents.length} GTS_PDFX); exactly one is expected.`);
    const intent = intents[0];
    const wanted = pdfx.outputCondition;
    if (wanted === null)
        return;
    if (intent.outputConditionIdentifier !== wanted.identifier)
        fail(`The OutputIntent OutputConditionIdentifier is ${JSON.stringify(intent.outputConditionIdentifier)}; the request is ${JSON.stringify(wanted.identifier)}.`);
    if (wanted.condition !== null && intent.outputCondition !== wanted.condition)
        fail(`The OutputIntent OutputCondition is ${JSON.stringify(intent.outputCondition)}; the request is ${JSON.stringify(wanted.condition)}.`);
    if (wanted.registry !== null && intent.registryName !== wanted.registry)
        fail(`The OutputIntent RegistryName is ${JSON.stringify(intent.registryName)}; the request is ${JSON.stringify(wanted.registry)}.`);
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
    if (plan.pdfx !== null)
        assertPdfxGenerated(structure, plan.pdfx);
    return structure;
}
const boxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const marksSchema = z.strictObject({ trim: z.boolean(), registration: z.boolean(), colorBars: z.boolean(), pageInformation: z.boolean(), style: z.enum(['roman', 'japanese']) });
const bleedSchema = z.strictObject({ left: z.number(), top: z.number(), right: z.number(), bottom: z.number() });
const bleedSourceSchema = z.enum(['explicit_points', 'document_via_preset']);
const expectedBleedMmSchema = z.literal(3).nullable();
const pageSchema = z.strictObject({ page: z.number().int().positive(), artboard: z.number().int().positive(), name: z.string(), size: z.tuple([z.number(), z.number()]) });
const filesSchema = z.strictObject({ workCopyPath: z.string().nullable(), stagedPath: z.string().nullable(), outputPath: z.string().nullable() });
const pdfxConditionSchema = z.strictObject({ identifier: z.string(), condition: z.string().nullable(), registry: z.string().nullable() });
const pdfxPlanSchema = z.strictObject({ standard: z.enum(['x3_2002', 'x3_2003', 'x4']), version: z.string(), outputCondition: pdfxConditionSchema.nullable() });
const pdfxGeneratedSchema = z.strictObject({
    infoVersion: z.string().nullable(), xmpVersion: z.string().nullable(),
    outputIntents: z.array(z.strictObject({ identifier: z.string().nullable(), condition: z.string().nullable(), registry: z.string().nullable() })),
    conformance: z.literal('not_validated'),
});
const presetSchema = z.strictObject({ name: z.string(), settingsVerified: z.literal(false), note: z.string() });
const preserveEditabilityOptionsSchema = z.strictObject({
    preserveEditability: z.strictObject({ requested: z.boolean(), applied: z.boolean().nullable(), note: z.string().nullable() }),
});
const warningSchema = z.strictObject({ code: z.enum(['existing_registration_lines', 'registration_scan_incomplete', 'registration_scan_unreadable']), message: z.string() });
const registrationScanSchema = z.strictObject({
    totalPaths: z.number().int().nonnegative(), scannedPaths: z.number().int().nonnegative(), limit: z.number().int().positive(),
    registrationStrokedPaths: z.number().int().nonnegative(), unreadablePaths: z.number().int().nonnegative(),
});
export const pdfExportRejectionReasonSchema = z.enum([
    'document_key_mismatch', 'document_not_admitted', 'output_exists', 'output_path_invalid', 'output_cross_device',
    'pdf_preset_unknown', 'pdf_preset_unsupported', 'pdfx_unsupported', 'pdfx_fonts_unverified', 'artboard_range_invalid', 'bleed_invalid', 'plan_stale',
    'source_file_unavailable', 'export_root_unavailable',
]);
export const pdfExportResultSchema = z.discriminatedUnion('outcome', [
    z.strictObject({
        outcome: z.literal('planned'),
        document: documentContextSchema,
        plan: z.strictObject({
            preset: presetSchema, artboardRange: z.string(), pages: z.array(pageSchema), marks: marksSchema, bleed: bleedSchema, bleedSource: bleedSourceSchema, expectedBleedMm: expectedBleedMmSchema,
            pdfx: pdfxPlanSchema.nullable(), outputPath: z.string(), planDigest: z.string(),
        }),
        warnings: z.array(warningSchema),
        registrationScan: registrationScanSchema.nullable(),
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
        bleedSource: bleedSourceSchema,
        expectedBleedMm: expectedBleedMmSchema,
        pages: z.array(pageSchema.extend({ mediaBox: boxSchema, trimBox: boxSchema, bleedBox: boxSchema })),
        pdf: z.strictObject({
            headerVersion: z.string(), catalogVersion: z.string().nullable(), xref: z.enum(['table', 'stream', 'hybrid']), objectStreams: z.number().int().nonnegative(),
            outputIntents: z.number().int().nonnegative(), pdfxVersion: z.string().nullable(),
        }),
        pdfx: pdfxGeneratedSchema.nullable(),
        options: preserveEditabilityOptionsSchema.optional(),
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
export function pdfxReport(structure, pdfx) {
    if (pdfx === null)
        return null;
    return {
        infoVersion: structure.pdfxVersion, xmpVersion: structure.xmp.pdfxidVersion,
        outputIntents: structure.outputIntents.map((intent) => ({ identifier: intent.outputConditionIdentifier, condition: intent.outputCondition, registry: intent.registryName })),
        conformance: 'not_validated',
    };
}
export function preserveEditabilityOptions(requested, save) {
    if (requested === null)
        return {};
    const host = save?.preserveEditability;
    const applied = host?.applied ?? null;
    const note = host === undefined
        ? 'The save script returned no preserveEditability read back.'
        : host.note ?? (applied !== null && applied !== requested ? `Illustrator reports ${applied} before saving; ${requested} was requested.` : null);
    return { options: { preserveEditability: { requested, applied, note } } };
}
export function pdfFacts(structure) {
    return {
        headerVersion: structure.headerVersion, catalogVersion: structure.catalogVersion, xref: structure.xref,
        objectStreams: structure.objectStreams, outputIntents: structure.outputIntents.length, pdfxVersion: structure.pdfxVersion,
    };
}
export const PDFX_FONT_SCAN_FRAME_LIMIT = 500;
export function pdfxFontRefusal(scan, verification) {
    if (scan.scannedFrames < scan.totalFrames || scan.incompleteFrames > 0 || scan.unreadableFrames > 0) {
        return `The document's fonts could not be checked completely (${scan.scannedFrames} of ${scan.totalFrames} text frame(s) scanned, limit ${scan.limit}; ${scan.incompleteFrames} incomplete, ${scan.unreadableFrames} unreadable). A PDF/X export needs every font proven available, because a missing font is substituted silently and the PDF/X keys are not written.`;
    }
    const unverified = scan.fontNames.filter((name) => !verification[name]);
    if (unverified.length === 0)
        return null;
    const shown = unverified.slice(0, 10).map((name) => JSON.stringify(name)).join(', ');
    return `PDF/X is refused: ${unverified.length} font(s) used by the document could not be proven available on this machine (${shown}${unverified.length > 10 ? ', …' : ''}). A missing font is substituted silently in the PDF and the PDF/X keys are not written. Install the font or replace it, then plan again.`;
}
