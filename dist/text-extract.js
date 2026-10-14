import { z } from 'zod';
import { DocumentMismatchError } from './domain.js';
export const TEXT_EXTRACT_LIMITS = { frames: 5000, characters: 400_000 };
export const TEXT_EXTRACT_HOST_TIMEOUT_MS = 60_000;
const frameSchema = z.object({
    uuid: z.string(),
    kind: z.enum(['point', 'area', 'path', 'unknown']),
    vertical: z.boolean(),
    bounds: z.array(z.number()),
    hidden: z.boolean(),
    paragraphs: z.array(z.array(z.string())),
    trailingEmptyParagraph: z.boolean(),
    trailingForcedBreak: z.boolean(),
});
export const textExtractResultSchema = z.object({
    documentKey: z.string(),
    focus: z.object({ activated: z.boolean(), previousFrontmost: z.string() }).optional(),
    artboards: z.array(z.object({ index: z.number().nullable(), frames: z.array(frameSchema) })),
    unreadable: z.array(z.object({ index: z.number(), message: z.string() })),
    nextStartIndex: z.number().nullable(),
});
export const TEXT_EXTRACT_SCRIPT = `
function textState(doc) {
  var layerName = "";
  try { layerName = String(doc.activeLayer.name); } catch (layerError) { layerName = ""; }
  return { context: getDocumentContext(), pageItems: doc.pageItems.length, textFrames: doc.textFrames.length,
    selection: doc.selection ? doc.selection.length : 0, activeLayer: layerName, active: app.activeDocument === doc };
}
var textContext = requireDocumentForRead(params.expectedDocumentKey);
var textDocument = app.activeDocument;
var textBefore = textState(textDocument);
var textBoards = [];
for (var boardIndex = 0; boardIndex < textDocument.artboards.length; boardIndex++) {
  var boardRect = textDocument.artboards[boardIndex].artboardRect;
  textBoards.push({ name: String(textDocument.artboards[boardIndex].name), rect: [boardRect[0], boardRect[1], boardRect[2], boardRect[3]] });
}
var textFrames = [], textUnreadable = [], textTotal = textDocument.textFrames.length, textCharacters = 0, textNext = null, textStop = null;
for (var frameIndex = params.startIndex; frameIndex < textTotal; frameIndex++) {
  if (textFrames.length >= params.maxFrames) { textNext = frameIndex; textStop = "frames"; break; }
  var frame = textDocument.textFrames[frameIndex], frameUuid = null;
  try {
    frameUuid = String(frame.uuid);
    var frameContents = String(frame.contents);
    if (textFrames.length > 0 && textCharacters + frameContents.length > params.maxCharacters) { textNext = frameIndex; textStop = "characters"; break; }
    var frameBounds = frame.visibleBounds;
    textFrames.push({ index: frameIndex, uuid: frameUuid, name: String(frame.name), kind: String(frame.kind), orientation: String(frame.orientation),
      layer: String(frame.layer.name), bounds: [frameBounds[0], frameBounds[1], frameBounds[2], frameBounds[3]], hidden: frame.hidden === true,
      locked: frame.locked === true, contents: frameContents });
    textCharacters += frameContents.length;
  } catch (frameError) {
    textUnreadable.push({ index: frameIndex, uuid: frameUuid, number: frameError && typeof frameError.number === "number" ? frameError.number : null,
      message: String(frameError && frameError.message ? frameError.message : frameError).substring(0, 200) });
  }
}
var result = { before: textBefore, after: textState(textDocument), artboards: textBoards, frames: textFrames, unreadable: textUnreadable,
  totalFrames: textTotal, nextIndex: textNext, stopReason: textStop };
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
export function splitFrameText(contents) {
    return {
        paragraphs: contents.split('\r').map((paragraph) => paragraph.split('\u0003')),
        trailingEmptyParagraph: contents.endsWith('\r'),
        trailingForcedBreak: contents.endsWith('\u0003'),
    };
}
const KINDS = { 'TextType.POINTTEXT': 'point', 'TextType.AREATEXT': 'area', 'TextType.PATHTEXT': 'path' };
export function groupFrames(data) {
    const artboards = data.artboards.map((_board, index) => ({ index, frames: [] }));
    const outside = [];
    for (const frame of data.frames) {
        const [left, top, right, bottom] = frame.bounds;
        const cx = (left + right) / 2, cy = (top + bottom) / 2;
        const home = data.artboards.findIndex((board) => cx >= board.rect[0] && cx <= board.rect[2] && cy <= board.rect[1] && cy >= board.rect[3]);
        const vertical = frame.orientation === 'TextOrientation.VERTICAL';
        const extracted = {
            uuid: frame.uuid, kind: KINDS[frame.kind] ?? 'unknown', vertical,
            bounds: [left, top, right, bottom], hidden: frame.hidden, ...splitFrameText(frame.contents),
            order: [-top, vertical ? -right : left],
        };
        (home < 0 ? outside : artboards[home].frames).push(extracted);
    }
    const sort = (frames) => frames.sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1]).map(({ order: _order, ...frame }) => frame);
    const grouped = artboards.map((board) => ({ ...board, frames: sort(board.frames) }));
    if (outside.length > 0)
        grouped.push({ index: null, frames: sort(outside) });
    return grouped;
}
export class TextExtractFailedError extends Error {
    code;
    constructor(code, message) {
        super(`${code}: ${message}`);
        this.code = code;
        this.name = 'TextExtractFailedError';
    }
}
function profileRefusal(observation, nothing = 'nothing was read') {
    const detail = `(profile ${observation.profile}, frontmost ${observation.frontmostBundleId ?? 'unknown'}); ${nothing}.`;
    if (observation.profile === 'locked')
        return new TextExtractFailedError('TEXT_EXTRACT_SCREEN_LOCKED', `The screen is locked; unlock it and retry ${detail}`);
    if (observation.profile === 'unknown') {
        return new TextExtractFailedError('TEXT_EXTRACT_HOST_PROFILE_UNKNOWN', `The screen lock state or the frontmost application could not be read ${detail}`);
    }
    return new TextExtractFailedError('TEXT_EXTRACT_ILLUSTRATOR_NOT_FRONTMOST', `Text extraction is measured with Illustrator frontmost only; bring it to the front and retry ${detail}`);
}
export async function extractText(bridge, hostProfileProbe, input, activator = null) {
    const activateIfNeeded = input.activateIfNeeded === true;
    let before = await hostProfileProbe.observe();
    const previousFrontmost = before.frontmostBundleId ?? 'unknown';
    let activated = false;
    if (before.profile !== 'foreground') {
        if (before.profile !== 'background' || !activateIfNeeded)
            throw profileRefusal(before);
        if (activator === null) {
            throw new TextExtractFailedError('TEXT_EXTRACT_ACTIVATION_UNSUPPORTED', 'activate_if_needed is not available on this platform; bring Illustrator to the front yourself. Nothing was read.');
        }
        try {
            await activator.activateExpectedApplication();
        }
        catch (error) {
            throw new TextExtractFailedError('TEXT_EXTRACT_ACTIVATION_FAILED', `Activating Illustrator failed: ${error instanceof Error ? error.message : String(error)}. Nothing was read.`);
        }
        activated = true;
        before = await hostProfileProbe.observe();
        if (before.profile !== 'foreground') {
            if (before.profile === 'background') {
                throw new TextExtractFailedError('TEXT_EXTRACT_ACTIVATION_FAILED', `Illustrator was asked to come to the front but is still not frontmost (profile ${before.profile}, frontmost ${before.frontmostBundleId ?? 'unknown'}); nothing was read.`);
            }
            throw profileRefusal(before);
        }
    }
    let data;
    try {
        data = (await bridge.execute({
            kind: 'read', script: TEXT_EXTRACT_SCRIPT, timeoutMs: TEXT_EXTRACT_HOST_TIMEOUT_MS,
            params: { expectedDocumentKey: input.expectedDocumentKey, startIndex: input.startIndex, maxFrames: TEXT_EXTRACT_LIMITS.frames, maxCharacters: TEXT_EXTRACT_LIMITS.characters },
        })).data;
    }
    catch (error) {
        const detail = parseHostError(error);
        if (detail?.code === 'DOCUMENT_MISMATCH')
            throw new DocumentMismatchError(input.expectedDocumentKey, String(detail.actual ?? ''));
        throw error;
    }
    const changed = ['pageItems', 'textFrames', 'selection', 'activeLayer', 'active'].filter((field) => data.before[field] !== data.after[field]);
    if (data.before.context.key !== data.after.context.key)
        changed.push('key');
    if (changed.length > 0)
        throw new TextExtractFailedError('TEXT_EXTRACT_CHANGED_DOCUMENT_STATE', `The read changed the document state (${changed.join(', ')}); no result is returned.`);
    const after = await hostProfileProbe.observe();
    if (after.profile !== 'foreground') {
        throw new TextExtractFailedError('TEXT_EXTRACT_HOST_PROFILE_CHANGED', `The host left the measured foreground profile during the read (profile ${after.profile}); the result is discarded.`);
    }
    return textExtractResultSchema.parse({
        documentKey: data.after.context.key,
        ...(activateIfNeeded ? { focus: { activated, previousFrontmost } } : {}),
        artboards: groupFrames(data),
        unreadable: data.unreadable.map((row) => ({ index: row.index, message: row.number === null ? row.message : `Error ${row.number}: ${row.message}` })),
        nextStartIndex: data.nextIndex,
    });
}
