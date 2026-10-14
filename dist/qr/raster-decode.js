import { randomUUID } from 'node:crypto';
import { rmdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { createStagingDirectory } from '../document-export.js';
import { DocumentMismatchError, IndeterminateExecutionError } from '../domain.js';
import { ensurePrivateDirectory, ensurePrivateStateRoot, isWindowsPrivateState } from '../private-state.js';
import { inspectSupportedPng, readStableImage } from '../visual-diff.js';
import { decodeWithZbar } from '../zbar-decode.js';
import { qrContentBytes } from './matrix.js';
import { planDecodeSchema } from './plan.js';
export const QR_RASTER_MODULE_PIXELS = 4;
export const QR_RASTER_MAX_SCALE_PERCENT = 800;
export const QR_RASTER_HOST_TIMEOUT_MS = 60_000;
export const QR_RASTER_STAGING_PREFIX = '.illustrator-studio-mcp-qr-';
export const qrRasterDecodeSchema = z.discriminatedUnion('status', [
    z.strictObject({
        status: z.literal('match'), payloadBytes: z.number().int().positive(), decoder: z.literal('zbarimg'),
        image: z.strictObject({ widthPx: z.number().int().positive(), heightPx: z.number().int().positive(), bytes: z.number().int().positive(), scalePercent: z.number() }),
        sourceUnchanged: z.literal(true), hostMs: z.number().int().nonnegative(),
    }),
    z.strictObject({ status: z.literal('mismatch'), reason: z.enum(['no_symbol', 'payload']), detail: z.string().max(400), groupUuid: z.string().max(255) }),
    z.strictObject({ status: z.literal('not_run'), reason: z.string().max(64), detail: z.string().max(500) }),
]);
export const qrDecodeSchema = z.strictObject({ plan: planDecodeSchema, raster: qrRasterDecodeSchema.optional() });
export const QR_RASTER_SCRIPT = `function qrRasterReject(code, message) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: code, message: message }));
}
function qrRasterState(doc) {
  return { context: getDocumentContext(), pageItems: doc.pageItems.length, selection: doc.selection.length, docs: app.documents.length, active: app.activeDocument === doc };
}
var qrContext = requireDocumentForRead(params.expectedDocumentKey);
var qrSource = app.activeDocument;
var qrGroup = null;
try { qrGroup = qrSource.getPageItemFromUuid(params.groupUuid); } catch (lookupError) { qrGroup = null; }
if (qrGroup === null || qrGroup === undefined || String(qrGroup.typename) !== "GroupItem") qrRasterReject("QR_RASTER_GROUP_NOT_FOUND", "The created group is no longer in the bound document.");
var qrBefore = qrRasterState(qrSource);
var qrScratch = null; var qrError = null; var qrFits = false; var qrVisible = null; var qrRect = null;
var qrStarted = new Date().getTime();
try {
  qrScratch = app.documents.add(qrSource.documentColorSpace, 100, 100);
  var qrCopy = qrGroup.duplicate(qrScratch, ElementPlacement.PLACEATBEGINNING);
  var qrBounds = qrCopy.geometricBounds;
  var qrBounds0 = [qrBounds[0], qrBounds[1], qrBounds[2], qrBounds[3]];
  var qrVb = qrCopy.visibleBounds;
  qrVisible = [qrVb[0], qrVb[1], qrVb[2], qrVb[3]];
  qrScratch.artboards[0].artboardRect = [qrVisible[0] - params.padPt, qrVisible[1] + params.padPt, qrVisible[2] + params.padPt, qrVisible[3] - params.padPt];
  var qrAr = qrScratch.artboards[0].artboardRect;
  qrRect = [qrAr[0], qrAr[1], qrAr[2], qrAr[3]];
  var qrAfter0 = qrCopy.geometricBounds;
  qrFits = qrRect[0] <= qrVisible[0] && qrRect[1] >= qrVisible[1] && qrRect[2] >= qrVisible[2] && qrRect[3] <= qrVisible[3] &&
    qrAfter0[0] === qrBounds0[0] && qrAfter0[1] === qrBounds0[1] && qrAfter0[2] === qrBounds0[2] && qrAfter0[3] === qrBounds0[3];
  if (qrFits) {
    var qrOptions = new ExportOptionsPNG24();
    qrOptions.antiAliasing = true; qrOptions.artBoardClipping = true; qrOptions.transparency = false;
    qrOptions.horizontalScale = params.scalePercent; qrOptions.verticalScale = params.scalePercent;
    qrScratch.exportFile(new File(params.outputPath), ExportType.PNG24, qrOptions);
  }
} catch (qrFailure) {
  qrError = String(qrFailure && qrFailure.message ? qrFailure.message : qrFailure);
}
var qrScratchClosed = true;
if (qrScratch !== null) {
  qrScratchClosed = false;
  try { qrScratch.close(SaveOptions.DONOTSAVECHANGES); qrScratchClosed = true; } catch (closeFailure) { qrScratchClosed = false; }
}
var result = {
  fits: qrFits, visible: qrVisible, artboardRect: qrRect, error: qrError, scratchClosed: qrScratchClosed,
  outputExists: new File(params.outputPath).exists === true, hostMs: new Date().getTime() - qrStarted,
  before: qrBefore, after: qrScratchClosed ? qrRasterState(qrSource) : null
};
`;
export function qrRasterScalePercent(modulePt) {
    const percent = Math.ceil((QR_RASTER_MODULE_PIXELS * 100) / modulePt - 1e-9);
    return percent <= QR_RASTER_MAX_SCALE_PERCENT ? Math.max(100, percent) : null;
}
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
function sameRasterState(before, after) {
    return before.context.key === after.context.key && before.context.saved === after.context.saved && before.pageItems === after.pageItems &&
        before.selection === after.selection && before.docs === after.docs && after.active;
}
async function removeStaging(directory, file) {
    await unlink(file).catch(() => undefined);
    await rmdir(directory).catch(() => undefined);
}
export async function decodeQrRaster(deps, input) {
    const scalePercent = qrRasterScalePercent(input.modulePt);
    if (scalePercent === null) {
        return { status: 'not_run', reason: 'module_below_raster_range', detail: `A module of ${input.modulePt.toFixed(3)} pt needs an export scale above ${QR_RASTER_MAX_SCALE_PERCENT}%; the raster decode is measured at ${QR_RASTER_MODULE_PIXELS} pixels per module only, so none is claimed.` };
    }
    const profile = await deps.hostProfileProbe.observe();
    if (profile.profile !== 'foreground') {
        return { status: 'not_run', reason: 'host_profile', detail: `The raster decode needs the screen unlocked and Illustrator frontmost (profile ${profile.profile}); nothing was exported.` };
    }
    let staging;
    try {
        if (isWindowsPrivateState())
            await ensurePrivateStateRoot(dirname(deps.previewRoot));
        await ensurePrivateDirectory(deps.previewRoot, 'QR staging root');
        staging = await createStagingDirectory(deps.previewRoot, randomUUID(), 'qr.png', QR_RASTER_STAGING_PREFIX);
    }
    catch (error) {
        return { status: 'not_run', reason: 'staging_unavailable', detail: (error instanceof Error ? error.message : String(error)).slice(0, 400) };
    }
    const padPt = input.modulePt * (input.background === 'white' ? 1 : input.quietZoneModules + 1);
    let host;
    try {
        host = (await deps.bridge.execute({
            kind: 'read', script: QR_RASTER_SCRIPT, timeoutMs: QR_RASTER_HOST_TIMEOUT_MS,
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
        if (detail?.code === 'QR_RASTER_GROUP_NOT_FOUND')
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
        const image = await readStableImage(staging.stagedPath, 'preview');
        const dimensions = inspectSupportedPng(image.bytes, 'preview');
        const decoded = await decodeWithZbar(image.bytes, deps.zbarimgPath === undefined ? {} : { zbarimgPath: deps.zbarimgPath });
        if (decoded.status === 'unavailable')
            return { status: 'not_run', reason: 'zbarimg_not_found', detail: 'zbarimg was not found on PATH or in the usual install directories.' };
        if (decoded.status === 'error')
            return { status: 'not_run', reason: 'zbarimg_failed', detail: decoded.message.slice(0, 400) };
        if (decoded.status === 'no_symbol')
            return { status: 'mismatch', reason: 'no_symbol', detail: 'zbarimg read no symbol in the exported render.', groupUuid: input.groupUuid };
        const expected = qrContentBytes(input.content);
        if (!decoded.payload.equals(expected)) {
            return { status: 'mismatch', reason: 'payload', detail: `The render decodes to ${decoded.payload.length} bytes that differ from the ${expected.length} requested bytes.`, groupUuid: input.groupUuid };
        }
        return {
            status: 'match', payloadBytes: expected.length, decoder: 'zbarimg',
            image: { widthPx: dimensions.width, heightPx: dimensions.height, bytes: image.metadata.bytes, scalePercent },
            sourceUnchanged: true, hostMs: Math.max(0, Math.round(host.hostMs)),
        };
    }
    catch (error) {
        return { status: 'not_run', reason: 'image_invalid', detail: (error instanceof Error ? error.message : String(error)).slice(0, 400) };
    }
    finally {
        await removeStaging(staging.directory, staging.stagedPath);
    }
}
