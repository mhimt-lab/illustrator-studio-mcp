import { randomUUID } from 'node:crypto';
import { rmdir, unlink } from 'node:fs/promises';
import { z } from 'zod';
import { createStagingDirectory } from './document-export.js';
import { DocumentMismatchError, IndeterminateExecutionError } from './domain.js';
import { documentContextSchema } from './mutation-result-schema-core.js';
import { ensurePrivateDirectory } from './private-state.js';
import { decodePng, inspectSupportedPng, readStableImage, VISUAL_DIFF_MAX_FILE_BYTES } from './visual-diff.js';
export const PREVIEW_APP_VERSION = '30.8.1';
export const PREVIEW_RESOLUTION_PPI = 72;
export const PREVIEW_MAX_SIDE_PT = 2048;
export const PREVIEW_HOST_TIMEOUT_MS = 60_000;
export const PREVIEW_STAGING_PREFIX = '.illustrator-studio-mcp-preview-';
const PREVIEW_FILE_NAME = 'preview.png';
export const previewBoundsSchema = z.array(z.number().int().min(-16_384).max(16_384)).length(4)
    .superRefine((bounds, context) => {
    const width = bounds[2] - bounds[0];
    const height = bounds[1] - bounds[3];
    if (width < 1 || height < 1) {
        context.addIssue({ code: 'custom', message: 'Bounds must be [left, top, right, bottom] with left < right and top > bottom.' });
    }
    else if (width > PREVIEW_MAX_SIDE_PT || height > PREVIEW_MAX_SIDE_PT) {
        context.addIssue({ code: 'custom', message: `Width and height must each be at most ${PREVIEW_MAX_SIDE_PT} pt.` });
    }
});
const intBoundsSchema = z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int()]);
export const previewResultSchema = z.strictObject({
    document: documentContextSchema,
    range: z.strictObject({
        bounds: intBoundsSchema,
        unit: z.literal('pt'),
        coordinateSpace: z.literal('document'),
        artboardIndex: z.number().int().nonnegative(),
    }),
    image: z.strictObject({
        format: z.literal('png'),
        mimeType: z.literal('image/png'),
        pixelFormat: z.enum(['rgba8_straight_alpha', 'rgb8_opaque']),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        bytes: z.number().int().positive().max(VISUAL_DIFF_MAX_FILE_BYTES),
        sha256: z.string().regex(/^[0-9a-f]{64}$/u),
        resolutionPpi: z.literal(PREVIEW_RESOLUTION_PPI),
        antiAliasing: z.literal(true),
        transparentBackground: z.literal(true),
    }),
    verification: z.strictObject({
        savedBefore: z.literal(false),
        savedAfter: z.literal(false),
        documentKeyUnchanged: z.literal(true),
        pageItems: z.number().int().nonnegative(),
        layers: z.number().int().nonnegative(),
        artboards: z.number().int().positive(),
        hostProfileBefore: z.literal('foreground'),
        hostProfileAfter: z.literal('foreground'),
    }),
    timing: z.strictObject({ hostCaptureMs: z.number().int().nonnegative() }),
    staging: z.strictObject({ removed: z.boolean() }),
    evidenceClass: z.literal('host_rendered_range_capture'),
});
export class PreviewRejectedError extends Error {
    code;
    constructor(code, message) {
        super(`${code}: ${message}`);
        this.code = code;
        this.name = 'PreviewRejectedError';
    }
}
export class PreviewFailedError extends Error {
    code;
    constructor(code, message) {
        super(`${code}: ${message}`);
        this.code = code;
        this.name = 'PreviewFailedError';
    }
}
const SAVED_REFUSAL_MESSAGE = 'The document is saved (saved=true). Capturing a preview changes saved to false on a saved ' +
    'document, after which every mutation that requires the saved file is refused. Preview is supported only on ' +
    'a document with unsaved changes or a new unsaved document; nothing was captured.';
export const PREVIEW_CAPTURE_SCRIPT = `
var MUTATION_SIDE_EFFECT_ATTEMPTED = false;
function previewReject(code, message, actual) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: code, message: message, actual: actual === undefined ? null : actual }));
}
function previewState(doc) {
  var rects = [];
  for (var abIndex = 0; abIndex < doc.artboards.length; abIndex++) {
    var abRect = doc.artboards[abIndex].artboardRect;
    rects.push([abRect[0], abRect[1], abRect[2], abRect[3]]);
  }
  return { context: getDocumentContext(), pageItems: doc.pageItems.length, layers: doc.layers.length, artboards: rects, active: app.activeDocument === doc };
}
var previewContext = requireDocumentForRead(params.expectedDocumentKey);
var previewDocument = app.activeDocument;
if (String(app.version) !== params.expectedAppVersion) {
  previewReject("PREVIEW_UNSUPPORTED_HOST_VERSION", "Preview is measured only on Illustrator " + params.expectedAppVersion + ".", String(app.version));
}
if (previewContext.saved !== false) previewReject("PREVIEW_DOCUMENT_SAVED", params.savedRefusalMessage);
var previewClip = [params.bounds[0], params.bounds[1], params.bounds[2], params.bounds[3]];
var previewArtboard = -1;
for (var previewIndex = 0; previewIndex < previewDocument.artboards.length; previewIndex++) {
  var previewRect = previewDocument.artboards[previewIndex].artboardRect;
  if (previewClip[0] >= previewRect[0] && previewClip[1] <= previewRect[1] &&
      previewClip[2] <= previewRect[2] && previewClip[3] >= previewRect[3]) { previewArtboard = previewIndex; break; }
}
if (previewArtboard < 0) previewReject("PREVIEW_RANGE_OUTSIDE_ARTBOARD", "The range must lie entirely inside one artboard.");
var previewFile = new File(params.outputPath);
if (previewFile.exists) previewReject("PREVIEW_STAGING_UNAVAILABLE", "The private staging file already exists.");
var previewBefore = previewState(previewDocument);
var previewOptions = new ImageCaptureOptions();
previewOptions.resolution = params.resolution;
previewOptions.antiAliasing = true;
previewOptions.transparency = true;
previewOptions.matte = false;
var previewCaptureError = null;
MUTATION_SIDE_EFFECT_ATTEMPTED = true;
var previewStarted = new Date().getTime();
try {
  previewDocument.imageCapture(previewFile, previewClip, previewOptions);
} catch (previewError) {
  previewCaptureError = String(previewError && previewError.message ? previewError.message : previewError);
}
var previewCaptureMs = new Date().getTime() - previewStarted;
var result = {
  before: previewBefore,
  after: previewState(previewDocument),
  artboardIndex: previewArtboard,
  captureError: previewCaptureError,
  outputExists: new File(params.outputPath).exists === true,
  captureMs: previewCaptureMs
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
function describeProfile(observation) {
    return `profile ${observation.profile}, lock ${observation.lockState}, frontmost ${observation.frontmostBundleId ?? 'unknown'}, expected ${observation.expectedBundleId}`;
}
export function describePreviewStateChanges(before, after) {
    const changes = [];
    if (before.context.saved !== after.context.saved)
        changes.push(`saved ${String(before.context.saved)} -> ${String(after.context.saved)}`);
    if (before.context.key !== after.context.key)
        changes.push(`document key ${before.context.keyShort} -> ${after.context.keyShort}`);
    if (!after.active)
        changes.push('the captured document is no longer the active document');
    if (before.pageItems !== after.pageItems)
        changes.push(`pageItems ${before.pageItems} -> ${after.pageItems}`);
    if (before.layers !== after.layers)
        changes.push(`layers ${before.layers} -> ${after.layers}`);
    if (JSON.stringify(before.artboards) !== JSON.stringify(after.artboards))
        changes.push('artboards changed');
    return changes;
}
async function removeStaging(directory, file) {
    try {
        await unlink(file).catch((error) => { if (error.code !== 'ENOENT')
            throw error; });
        await rmdir(directory);
        return true;
    }
    catch {
        return false;
    }
}
export async function capturePreview(deps, input) {
    const bounds = previewBoundsSchema.parse(input.bounds);
    const width = (bounds[2] - bounds[0]) * PREVIEW_RESOLUTION_PPI / 72;
    const height = (bounds[1] - bounds[3]) * PREVIEW_RESOLUTION_PPI / 72;
    const profileBefore = await deps.hostProfileProbe.observe();
    if (profileBefore.profile !== 'foreground') {
        throw new PreviewRejectedError('PREVIEW_UNSUPPORTED_HOST_PROFILE', `Preview is supported only with the screen unlocked and Illustrator frontmost (${describeProfile(profileBefore)}); nothing was captured.`);
    }
    let staging;
    try {
        await ensurePrivateDirectory(deps.previewRoot, 'preview staging root');
        staging = await createStagingDirectory(deps.previewRoot, randomUUID(), PREVIEW_FILE_NAME, PREVIEW_STAGING_PREFIX);
    }
    catch (error) {
        throw new PreviewRejectedError('PREVIEW_STAGING_UNAVAILABLE', error instanceof Error ? error.message : String(error));
    }
    const stagedPath = staging.stagedPath;
    let host;
    try {
        host = (await deps.bridge.execute({
            kind: 'read',
            script: PREVIEW_CAPTURE_SCRIPT,
            params: {
                expectedDocumentKey: input.expectedDocumentKey,
                expectedAppVersion: PREVIEW_APP_VERSION,
                bounds,
                resolution: PREVIEW_RESOLUTION_PPI,
                outputPath: stagedPath,
                savedRefusalMessage: SAVED_REFUSAL_MESSAGE,
            },
            timeoutMs: PREVIEW_HOST_TIMEOUT_MS,
        })).data;
    }
    catch (error) {
        if (error instanceof IndeterminateExecutionError) {
            throw new IndeterminateExecutionError(`${error.message} The preview staging directory is kept for inspection: ${staging.directory}. Run illustrator_reconcile before the next command.`, error.commandId, { code: error.code, exitCode: error.exitCode, signal: error.signal, killed: error.killed });
        }
        await removeStaging(staging.directory, stagedPath);
        const detail = parseHostError(error);
        if (detail?.code === 'DOCUMENT_MISMATCH')
            throw new DocumentMismatchError(input.expectedDocumentKey, String(detail.actual ?? ''));
        if (detail?.code === 'PREVIEW_DOCUMENT_SAVED' || detail?.code === 'PREVIEW_RANGE_OUTSIDE_ARTBOARD' ||
            detail?.code === 'PREVIEW_UNSUPPORTED_HOST_VERSION' || detail?.code === 'PREVIEW_STAGING_UNAVAILABLE') {
            const actual = detail.actual === null || detail.actual === undefined ? '' : ` (actual ${String(detail.actual)})`;
            throw new PreviewRejectedError(detail.code, `${detail.message ?? detail.code}${actual}`);
        }
        throw error;
    }
    try {
        const changes = describePreviewStateChanges(host.before, host.after);
        if (changes.length > 0) {
            throw new PreviewFailedError('PREVIEW_CHANGED_DOCUMENT_STATE', `The capture changed the document state (${changes.join('; ')}). No image is returned; re-read the document context before any further operation.`);
        }
        if (host.captureError !== null) {
            throw new PreviewFailedError('PREVIEW_CAPTURE_FAILED', `Illustrator imageCapture failed: ${host.captureError}. The document state was re-read and is unchanged.`);
        }
        if (!host.outputExists)
            throw new PreviewFailedError('PREVIEW_OUTPUT_MISSING', 'Illustrator reported no capture file.');
        const profileAfter = await deps.hostProfileProbe.observe();
        if (profileAfter.profile !== 'foreground') {
            throw new PreviewFailedError('PREVIEW_HOST_PROFILE_CHANGED', `The host left the measured foreground profile during the capture (${describeProfile(profileAfter)}); the image is discarded. The document state was re-read and is unchanged.`);
        }
        let source;
        try {
            source = await readStableImage(stagedPath, 'preview');
            const dimensions = inspectSupportedPng(source.bytes, 'preview');
            if (dimensions.width !== width || dimensions.height !== height) {
                throw new Error(`the capture is ${dimensions.width}x${dimensions.height} px, expected ${width}x${height} px`);
            }
            if (decodePng(source.bytes, 'preview').length !== width * height * 4)
                throw new Error('the decoded pixel count does not match');
        }
        catch (error) {
            throw new PreviewFailedError('PREVIEW_OUTPUT_INVALID', error instanceof Error ? error.message : String(error));
        }
        const removed = await removeStaging(staging.directory, stagedPath);
        const result = previewResultSchema.parse({
            document: host.after.context,
            range: { bounds, unit: 'pt', coordinateSpace: 'document', artboardIndex: host.artboardIndex },
            image: {
                format: 'png',
                mimeType: 'image/png',
                pixelFormat: source.bytes[25] === 6 ? 'rgba8_straight_alpha' : 'rgb8_opaque',
                width,
                height,
                bytes: source.metadata.bytes,
                sha256: source.metadata.sha256,
                resolutionPpi: PREVIEW_RESOLUTION_PPI,
                antiAliasing: true,
                transparentBackground: true,
            },
            verification: {
                savedBefore: host.before.context.saved,
                savedAfter: host.after.context.saved,
                documentKeyUnchanged: true,
                pageItems: host.after.pageItems,
                layers: host.after.layers,
                artboards: host.after.artboards.length,
                hostProfileBefore: profileBefore.profile,
                hostProfileAfter: profileAfter.profile,
            },
            timing: { hostCaptureMs: Math.max(0, Math.round(host.captureMs)) },
            staging: { removed },
            evidenceClass: 'host_rendered_range_capture',
        });
        return { result, png: source.bytes };
    }
    catch (error) {
        await removeStaging(staging.directory, stagedPath);
        throw error;
    }
}
