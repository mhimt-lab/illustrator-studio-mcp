import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, unlink, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { createStagingDirectory } from '../document-export.js';
import { DocumentMismatchError, IndeterminateExecutionError } from '../domain.js';
import { ensurePrivateDirectory, ensurePrivateStateRoot, isWindowsPrivateState } from '../private-state.js';
import { decodePng, inspectSupportedPng, readStableImage } from '../visual-diff.js';
import { placeNumeral } from './digit-outlines.js';
import { flattenContour, pointInPolygon } from './geometry.js';
import { renderLayoutPng } from './render-png.js';
import { decodeWithZbar } from './zbar.js';
export const BARCODE_RASTER_SCALE_PERCENT = 800;
export const BARCODE_RASTER_PIXEL_BUDGET = 3_800_000;
export function rasterScalePercent(widthPt, heightPt, padPt) {
    const widthPoints = Math.ceil(widthPt + 2 * padPt) + 1;
    const heightPoints = Math.ceil(heightPt + 2 * padPt) + 1;
    for (let percent = BARCODE_RASTER_SCALE_PERCENT; percent > 100; percent -= 100) {
        if ((widthPoints * percent / 100) * (heightPoints * percent / 100) <= BARCODE_RASTER_PIXEL_BUDGET)
            return percent;
    }
    return 100;
}
export const BARCODE_RASTER_HOST_TIMEOUT_MS = 60_000;
export const BARCODE_RASTER_STAGING_PREFIX = '.illustrator-studio-mcp-barcode-';
export const BARCODE_GLYPH_MISMATCH_LIMIT = 0.04;
export const planDecodeSchema = z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('match'), decoder: z.string().max(300) }),
    z.strictObject({ status: z.literal('mismatch'), detail: z.string().max(400) }),
    z.strictObject({ status: z.literal('not_run'), reason: z.enum(['zbarimg_not_found', 'zbarimg_failed']), detail: z.string().max(400) }),
]);
const glyphDigitSchema = z.strictObject({ digit: z.string().length(1), pixels: z.number().int().nonnegative(), expectedInk: z.number().int().nonnegative(), actualInk: z.number().int().nonnegative(), mismatchRatio: z.number().min(0) });
const glyphCheckSchema = z.strictObject({ checked: z.number().int().nonnegative(), maxMismatchRatio: z.number().min(0), ok: z.boolean(), digits: z.array(glyphDigitSchema).max(14).optional() });
export const rasterDecodeSchema = z.discriminatedUnion('status', [
    z.strictObject({
        status: z.literal('match'), decoded: z.string().max(16), symbology: z.string().max(16), decoder: z.string().max(300),
        glyphs: glyphCheckSchema.nullable(), image: z.strictObject({ widthPx: z.number().int().positive(), heightPx: z.number().int().positive(), bytes: z.number().int().positive(), scalePercent: z.number() }),
        sourceUnchanged: z.literal(true), hostMs: z.number().int().nonnegative(),
    }),
    z.strictObject({
        status: z.literal('mismatch'), reason: z.enum(['decode', 'glyphs']), decoded: z.string().max(16).nullable(), detail: z.string().max(400),
        glyphs: glyphCheckSchema.nullable(), groupUuid: z.string().max(255),
        retainedImage: z.string().max(1024).optional(),
    }),
    z.strictObject({ status: z.literal('not_run'), reason: z.string().max(64), detail: z.string().max(500) }),
]);
export const barcodeDecodeSchema = z.strictObject({ plan: planDecodeSchema, raster: rasterDecodeSchema.optional() });
export async function decodePlannedBarcode(resolved, binary) {
    const directory = await mkdtemp(join(tmpdir(), 'barcode-plan-'));
    try {
        const file = join(directory, 'planned.png');
        await writeFile(file, renderLayoutPng(resolved.layout, 4).png);
        const result = binary === undefined
            ? await decodeWithZbar(file, resolved.symbology, resolved.gtin.digits)
            : await decodeWithZbar(file, resolved.symbology, resolved.gtin.digits, binary);
        if (result.status === 'match')
            return { status: 'match', decoder: result.decoder };
        if (result.status === 'mismatch')
            return { status: 'mismatch', detail: `${result.detail} (decoded ${result.decoded ?? 'nothing'})` };
        return { status: 'not_run', reason: result.reason, detail: result.detail.slice(0, 400) };
    }
    finally {
        await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
}
export const BARCODE_RASTER_SCRIPT = `var MUTATION_SIDE_EFFECT_ATTEMPTED = false;
function barcodeRasterReject(code, message) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: code, message: message }));
}
function barcodeRasterState(doc) {
  return { context: getDocumentContext(), pageItems: doc.pageItems.length, selection: doc.selection.length, docs: app.documents.length, active: app.activeDocument === doc };
}
var barcodeContext = requireDocumentForRead(params.expectedDocumentKey);
var barcodeSource = app.activeDocument;
var barcodeGroup = null;
try { barcodeGroup = barcodeSource.getPageItemFromUuid(params.groupUuid); } catch (lookupError) { barcodeGroup = null; }
if (barcodeGroup === null || barcodeGroup === undefined || String(barcodeGroup.typename) !== "GroupItem") barcodeRasterReject("BARCODE_RASTER_GROUP_NOT_FOUND", "The created group is no longer in the bound document.");
var barcodeBefore = barcodeRasterState(barcodeSource);
var barcodeSourceBounds = barcodeGroup.geometricBounds;
var barcodeSourceBox = [barcodeSourceBounds[0], barcodeSourceBounds[1], barcodeSourceBounds[2], barcodeSourceBounds[3]];
var barcodeCopyBox = null;
var barcodeScratch = null;
var barcodeError = null;
var barcodeFits = false;
var barcodeVisible = null;
var barcodeRect = null;
var barcodeStarted = new Date().getTime();
MUTATION_SIDE_EFFECT_ATTEMPTED = true;
try {
  barcodeScratch = app.documents.add(barcodeSource.documentColorSpace, 100, 100);
  var barcodeCopy = barcodeGroup.duplicate(barcodeScratch, ElementPlacement.PLACEATBEGINNING);
  var barcodeBounds = barcodeCopy.geometricBounds;
  var barcodeBefore0 = [barcodeBounds[0], barcodeBounds[1], barcodeBounds[2], barcodeBounds[3]];
  barcodeCopyBox = barcodeBefore0;
  var vb = barcodeCopy.visibleBounds;
  barcodeVisible = [vb[0], vb[1], vb[2], vb[3]];
  barcodeScratch.artboards[0].artboardRect = [barcodeVisible[0] - params.padPt, barcodeVisible[1] + params.padPt, barcodeVisible[2] + params.padPt, barcodeVisible[3] - params.padPt];
  var ar = barcodeScratch.artboards[0].artboardRect;
  barcodeRect = [ar[0], ar[1], ar[2], ar[3]];
  var after0 = barcodeCopy.geometricBounds;
  barcodeFits = barcodeRect[0] <= barcodeVisible[0] && barcodeRect[1] >= barcodeVisible[1] && barcodeRect[2] >= barcodeVisible[2] && barcodeRect[3] <= barcodeVisible[3] &&
    after0[0] === barcodeBefore0[0] && after0[1] === barcodeBefore0[1] && after0[2] === barcodeBefore0[2] && after0[3] === barcodeBefore0[3];
  if (barcodeFits) {
    var barcodeOptions = new ExportOptionsPNG24();
    barcodeOptions.antiAliasing = false; barcodeOptions.artBoardClipping = true; barcodeOptions.transparency = false;
    barcodeOptions.horizontalScale = params.scalePercent; barcodeOptions.verticalScale = params.scalePercent;
    barcodeScratch.exportFile(new File(params.outputPath), ExportType.PNG24, barcodeOptions);
  }
} catch (barcodeFailure) {
  barcodeError = String(barcodeFailure && barcodeFailure.message ? barcodeFailure.message : barcodeFailure);
}
var barcodeScratchClosed = true;
if (barcodeScratch !== null) {
  barcodeScratchClosed = false;
  try { barcodeScratch.close(SaveOptions.DONOTSAVECHANGES); barcodeScratchClosed = true; } catch (closeFailure) { barcodeScratchClosed = false; }
}
var result = {
  fits: barcodeFits, visible: barcodeVisible, artboardRect: barcodeRect, sourceBounds: barcodeSourceBox, copyBounds: barcodeCopyBox, error: barcodeError, scratchClosed: barcodeScratchClosed,
  outputExists: new File(params.outputPath).exists === true, hostMs: new Date().getTime() - barcodeStarted,
  before: barcodeBefore, after: barcodeScratchClosed ? barcodeRasterState(barcodeSource) : null
};
`;
function parseHostError(error) {
    if (!(error instanceof Error) || !error.message.startsWith('MCP_ERROR:'))
        return null;
    try {
        const parsed = JSON.parse(error.message.slice('MCP_ERROR:'.length));
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}
export function copyTranslation(source, copy) {
    if (copy === null || source.length !== 4 || copy.length !== 4)
        return null;
    const sameSize = Math.abs((copy[2] - copy[0]) - (source[2] - source[0])) <= 1e-6 && Math.abs((copy[1] - copy[3]) - (source[1] - source[3])) <= 1e-6;
    return sameSize ? { dx: copy[0] - source[0], dy: copy[1] - source[1] } : null;
}
function sameRasterState(before, after) {
    return before.context.key === after.context.key && before.context.saved === after.context.saved && before.pageItems === after.pageItems &&
        before.selection === after.selection && before.docs === after.docs && after.active;
}
export function checkRasterGlyphs(rgba, widthPx, heightPx, artboardRect, origin, resolved, scalePercent) {
    const scale = scalePercent / 100;
    const digits = [];
    const reach = 0.7 / scale;
    const offsets = [[0, 0], [reach, reach], [-reach, reach], [reach, -reach], [-reach, -reach]];
    for (const slot of resolved.layout.hri) {
        const polygons = placeNumeral(slot.digit, resolved.layout.hriHeightPt, slot.centerXPt, resolved.layout.heightPt).map((contour) => {
            const points = contour.map((p) => ({
                anchor: [origin.left + p[0], origin.top - p[1]], left: [origin.left + p[2], origin.top - p[3]], right: [origin.left + p[4], origin.top - p[5]],
            }));
            return flattenContour(points);
        });
        const xs = polygons.flat().map(([x]) => x);
        const ys = polygons.flat().map(([, y]) => y);
        const left = Math.floor((Math.min(...xs) - artboardRect[0]) * scale);
        const right = Math.ceil((Math.max(...xs) - artboardRect[0]) * scale);
        const top = Math.floor((artboardRect[1] - Math.max(...ys)) * scale);
        const bottom = Math.ceil((artboardRect[1] - Math.min(...ys)) * scale);
        let differing = 0;
        let total = 0;
        let expectedInk = 0;
        let actualInk = 0;
        for (let py = Math.max(0, top); py < Math.min(heightPx, bottom); py += 1) {
            for (let px = Math.max(0, left); px < Math.min(widthPx, right); px += 1) {
                const docX = artboardRect[0] + (px + 0.5) / scale;
                const docY = artboardRect[1] - (py + 0.5) / scale;
                let insideCount = 0;
                for (const [dx, dy] of offsets) {
                    let inside = false;
                    for (const polygon of polygons)
                        if (pointInPolygon([docX + dx, docY + dy], polygon))
                            inside = !inside;
                    if (inside)
                        insideCount += 1;
                }
                if (insideCount !== 0 && insideCount !== offsets.length)
                    continue;
                const inside = insideCount === offsets.length;
                const offset = (py * widthPx + px) * 4;
                const dark = (rgba[offset] + rgba[offset + 1] + rgba[offset + 2]) / 3 < 128;
                total += 1;
                if (inside)
                    expectedInk += 1;
                if (dark)
                    actualInk += 1;
                if (dark !== inside)
                    differing += 1;
            }
        }
        digits.push({ digit: slot.digit, pixels: total, expectedInk, actualInk, mismatchRatio: total === 0 ? 1 : differing / total });
    }
    const maxMismatchRatio = Math.max(...digits.map((entry) => entry.mismatchRatio));
    return { checked: digits.length, maxMismatchRatio, ok: maxMismatchRatio <= BARCODE_GLYPH_MISMATCH_LIMIT, digits };
}
async function removeStaging(directory, file) {
    await unlink(file).catch((error) => { if (error.code !== 'ENOENT')
        throw error; }).catch(() => undefined);
    await rmdir(directory).catch(() => undefined);
}
export async function decodeBarcodeRaster(deps, input) {
    const profile = await deps.hostProfileProbe.observe();
    if (profile.profile !== 'foreground') {
        return { status: 'not_run', reason: 'host_profile', detail: `The raster decode needs the screen unlocked and Illustrator frontmost (profile ${profile.profile}); nothing was exported.` };
    }
    let staging;
    try {
        if (isWindowsPrivateState())
            await ensurePrivateStateRoot(dirname(deps.previewRoot));
        await ensurePrivateDirectory(deps.previewRoot, 'barcode staging root');
        staging = await createStagingDirectory(deps.previewRoot, randomUUID(), 'barcode.png', BARCODE_RASTER_STAGING_PREFIX);
    }
    catch (error) {
        return { status: 'not_run', reason: 'staging_unavailable', detail: (error instanceof Error ? error.message : String(error)).slice(0, 400) };
    }
    const { resolved } = input;
    const padPt = 12 * resolved.layout.modulePt;
    const scalePercent = rasterScalePercent(resolved.layout.widthPt, resolved.layout.heightPt, padPt);
    let keep = false;
    let host;
    try {
        host = (await deps.bridge.execute({
            kind: 'read', script: BARCODE_RASTER_SCRIPT, timeoutMs: BARCODE_RASTER_HOST_TIMEOUT_MS,
            params: { expectedDocumentKey: input.documentKey, groupUuid: input.groupUuid, outputPath: staging.stagedPath, scalePercent, padPt },
        })).data;
    }
    catch (error) {
        if (error instanceof IndeterminateExecutionError) {
            throw new IndeterminateExecutionError(`${error.message} A throwaway document may still be open and the raster staging directory is kept: ${staging.directory}. Run illustrator_reconcile before the next command.`, error.commandId, { code: error.code, exitCode: error.exitCode, signal: error.signal, killed: error.killed });
        }
        await removeStaging(staging.directory, staging.stagedPath);
        const detail = parseHostError(error);
        if (detail?.code === 'DOCUMENT_MISMATCH')
            throw new DocumentMismatchError(input.documentKey, String(detail.actual ?? ''));
        if (detail?.code === 'BARCODE_RASTER_GROUP_NOT_FOUND')
            return { status: 'not_run', reason: 'group_not_found', detail: detail.message ?? 'The created group is not in the document.' };
        return { status: 'not_run', reason: 'host_error', detail: (error instanceof Error ? error.message : String(error)).slice(0, 400) };
    }
    try {
        if (!host.scratchClosed) {
            return { status: 'not_run', reason: 'scratch_document_open', detail: 'The throwaway document could not be closed; close it without saving (it is the unsaved document that is not the one you work in), then run illustrator_reconcile.' };
        }
        if (host.after === null || !sameRasterState(host.before, host.after)) {
            return { status: 'not_run', reason: 'source_changed', detail: 'The source document state changed during the raster decode; re-read illustrator_get_context before any further operation. No decode is claimed.' };
        }
        if (host.error !== null)
            return { status: 'not_run', reason: 'host_error', detail: host.error.slice(0, 400) };
        if (!host.fits || host.artboardRect === null)
            return { status: 'not_run', reason: 'copy_outside_artboard', detail: 'The copy does not fit the throwaway artboard; nothing was exported.' };
        if (!host.outputExists)
            return { status: 'not_run', reason: 'no_output', detail: 'The host reported no exported file.' };
        const shift = copyTranslation(host.sourceBounds, host.copyBounds);
        if (shift === null)
            return { status: 'not_run', reason: 'copy_not_a_translation', detail: 'The copy in the throwaway document is not the source group moved: its size differs, so its numerals cannot be located.' };
        const image = await readStableImage(staging.stagedPath, 'preview');
        const dimensions = inspectSupportedPng(image.bytes, 'preview');
        const decoded = await decodeWithZbar(staging.stagedPath, resolved.symbology, resolved.gtin.digits);
        if (decoded.status === 'not_run')
            return { status: 'not_run', reason: decoded.reason, detail: decoded.detail.slice(0, 400) };
        const rgba = decodePng(image.bytes, 'preview');
        const glyphs = checkRasterGlyphs(rgba, dimensions.width, dimensions.height, host.artboardRect, { left: input.origin.left + shift.dx, top: input.origin.top + shift.dy }, resolved, scalePercent);
        if (decoded.status === 'mismatch' || !glyphs.ok) {
            keep = true;
            const retainedImage = staging.stagedPath;
            if (decoded.status === 'mismatch') {
                return { status: 'mismatch', reason: 'decode', decoded: decoded.decoded, detail: decoded.detail, glyphs, groupUuid: input.groupUuid, retainedImage };
            }
            return { status: 'mismatch', reason: 'glyphs', decoded: decoded.decoded, detail: `The drawn numerals differ from their planned shapes (up to ${((glyphs?.maxMismatchRatio ?? 1) * 100).toFixed(1)}% of a numeral's pixels); the raster is kept for inspection.`, glyphs, groupUuid: input.groupUuid, retainedImage };
        }
        return {
            status: 'match', decoded: decoded.decoded, symbology: decoded.symbology, decoder: decoded.decoder, glyphs,
            image: { widthPx: dimensions.width, heightPx: dimensions.height, bytes: image.metadata.bytes, scalePercent },
            sourceUnchanged: true, hostMs: Math.max(0, Math.round(host.hostMs)),
        };
    }
    catch (error) {
        return { status: 'not_run', reason: 'image_invalid', detail: (error instanceof Error ? error.message : String(error)).slice(0, 400) };
    }
    finally {
        if (!keep)
            await removeStaging(staging.directory, staging.stagedPath);
    }
}
