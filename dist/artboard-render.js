import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { copyFileExclusive, inspectSourceFile, sameFileOrSameBytes } from './document-backup.js';
import { DocumentMismatchError, IndeterminateExecutionError } from './domain.js';
import { documentKeyPath, HOST_FILE_PATH_HELPERS } from './file-path.js';
import { evaluateHostVersion } from './host-version-policy.js';
import { nonPrintingLayerWarning, NON_PRINTING_LAYER_HELPERS } from './non-printing-layers.js';
import { pruneRenderSets, RENDER_RETENTION_LIMITS } from './render-retention.js';
import { ensurePrivateDirectory, isWindowsPrivateState } from './private-state.js';
import { comparePngImages, decodePng, inspectSupportedPng, readStableImage } from './visual-diff.js';
export const RENDER_RESOLUTIONS = [72, 144];
export const RENDER_LIMITS = { artboards: 100, pixels: 60_000_000, maxSidePx: 4096, inlineImages: 4 };
export const RENDER_HOST_TIMEOUT_MS = 60_000;
export const RENDER_HOST_BUDGET_MS = 40_000;
const RENDER_SET_PREFIX = 'render-';
export class RenderSetStore {
    sets = new Map();
    reserved = new Set();
    get(id) { return this.sets.get(id); }
    put(set) { this.sets.set(set.id, set); }
    reserve(id) { this.reserved.add(id); }
    release(id) { this.reserved.delete(id); }
    isReferenced(id) { return this.sets.has(id) || this.reserved.has(id); }
}
export const renderResultSchema = z.object({
    documentKey: z.string(),
    renderSetId: z.string(),
    artboards: z.array(z.object({ index: z.number(), name: z.string(), width: z.number(), height: z.number(), path: z.string() })),
    comparison: z.object({
        baseline: z.string(),
        unchanged: z.number(),
        differing: z.array(z.object({ index: z.number(), changedPixels: z.number(), box: z.array(z.number()), diffPath: z.string() })),
        structureChanged: z.array(z.number()),
    }).nullable(),
    hostVersion: z.string(),
    hostMs: z.number(),
    cleanup: z.object({ removed: z.number(), kept: z.number() }).optional(),
    notes: z.array(z.string()),
});
export class RenderRejectedError extends Error {
    code;
    constructor(code, message) {
        super(`${code}: ${message}`);
        this.code = code;
        this.name = 'RenderRejectedError';
    }
}
export class RenderFailedError extends Error {
    code;
    constructor(code, message) {
        super(`${code}: ${message}`);
        this.code = code;
        this.name = 'RenderFailedError';
    }
}
export const RENDER_ARTBOARDS_SCRIPT = `${HOST_FILE_PATH_HELPERS}${NON_PRINTING_LAYER_HELPERS}
var MUTATION_SIDE_EFFECT_ATTEMPTED = false;
function renderReject(code, message, actual) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: code, message: message, actual: actual === undefined ? null : actual }));
}
function renderPath(doc) { try { return readDocumentPath(doc).path; } catch (pathError) { return null; } }
function renderState(doc) {
  var rects = [];
  for (var abIndex = 0; abIndex < doc.artboards.length; abIndex++) {
    var abRect = doc.artboards[abIndex].artboardRect;
    rects.push([abRect[0], abRect[1], abRect[2], abRect[3]]);
  }
  var layerName = "";
  try { layerName = String(doc.activeLayer.name); } catch (layerError) { layerName = ""; }
  return { context: getDocumentContext(), pageItems: doc.pageItems.length, layers: doc.layers.length, artboards: rects,
    active: app.activeDocument === doc, selection: doc.selection ? doc.selection.length : 0, activeLayer: layerName };
}
/** Indices and limits on the document to be captured; a refusal message, or null. */
function renderCheck(doc) {
  var pixels = 0;
  for (var checkIndex = 0; checkIndex < params.boards.length; checkIndex++) {
    var board = params.boards[checkIndex];
    if (board >= doc.artboards.length) return { code: "RENDER_ARTBOARD_OUT_OF_RANGE", message: "Artboard " + board + " does not exist; the document has " + doc.artboards.length + "." };
    var r = doc.artboards[board].artboardRect;
    var w = Math.round((r[2] - r[0]) * params.resolution / 72), h = Math.round((r[1] - r[3]) * params.resolution / 72);
    if (w < 1 || h < 1 || w > params.maxSidePx || h > params.maxSidePx) return { code: "RENDER_ARTBOARD_TOO_LARGE", message: "Artboard " + board + " would be " + w + "x" + h + " px; each side must be 1 to " + params.maxSidePx + " px." };
    pixels += w * h;
  }
  if (pixels > params.maxPixels) return { code: "RENDER_LIMIT_EXCEEDED", message: "The artboards would be " + pixels + " px in all; at most " + params.maxPixels + " px per call. Split the artboards over several calls." };
  return null;
}
function renderCapture(doc) {
  var started = new Date().getTime(), boards = [], notRendered = [];
  for (var captureIndex = 0; captureIndex < params.boards.length; captureIndex++) {
    var board = params.boards[captureIndex];
    if (new Date().getTime() - started > params.budgetMs) { notRendered.push(board); continue; }
    var r = doc.artboards[board].artboardRect, file = new File(params.outputDir + "/ab-" + board + ".png");
    var options = new ImageCaptureOptions();
    options.resolution = params.resolution; options.antiAliasing = true; options.transparency = true; options.matte = false;
    var t0 = new Date().getTime(), error = null;
    if (file.exists) error = "the output file already exists";
    else {
      MUTATION_SIDE_EFFECT_ATTEMPTED = true;
      try { doc.imageCapture(file, [r[0], r[1], r[2], r[3]], options); } catch (captureError) { error = String(captureError && captureError.message ? captureError.message : captureError); }
    }
    boards.push({ index: board, name: String(doc.artboards[board].name), rect: [r[0], r[1], r[2], r[3]], captured: error === null && new File(params.outputDir + "/ab-" + board + ".png").exists === true,
      error: error, ms: new Date().getTime() - t0 });
  }
  return { boards: boards, notRendered: notRendered, hostMs: new Date().getTime() - started };
}
for (var residueIndex = 0; residueIndex < app.documents.length; residueIndex++) {
  var residuePath = renderPath(app.documents[residueIndex]);
  if (residuePath && String(residuePath).indexOf(params.workRoot) === 0) {
    renderReject("RENDER_WORK_COPY_OPEN", "A render work copy from an earlier call is still open; close it without saving (illustrator_close_document with discard_changes) and retry.", getDocumentIdentity(app.documents[residueIndex], residueIndex).key);
  }
}
var renderContext = requireDocumentForRead(params.expectedDocumentKey);
var renderDocument = app.activeDocument;
var result;
if (params.source === "current") {
  if (renderContext.saved !== false) renderReject("RENDER_DOCUMENT_SAVED", params.savedRefusalMessage);
  var currentRefusal = renderCheck(renderDocument);
  if (currentRefusal !== null) renderReject(currentRefusal.code, currentRefusal.message);
  var currentBefore = renderState(renderDocument);
  var currentLayers = nplScanSafe(renderDocument);
  var current = renderCapture(renderDocument);
  result = { before: currentBefore, after: renderState(renderDocument), boards: current.boards, notRendered: current.notRendered, hostMs: current.hostMs, appVersion: String(app.version),
    nonPrintingLayers: currentLayers };
} else {
  if (!renderContext.path) renderReject("RENDER_NO_FILE", "The document has never been saved, so it has no file to render; use source current.");
  if (!new File(params.workCopyPath).exists) renderReject("RENDER_WORK_COPY_MISSING", "The private work copy is missing.");
  var fileBefore = renderState(renderDocument), fileOutcome = { boards: [], notRendered: [], hostMs: 0 }, fileRefusal = null, workClosed = false, fileLayers = null;
  var previousInteraction = app.userInteractionLevel;
  MUTATION_SIDE_EFFECT_ATTEMPTED = true;
  app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
  var work = null;
  try {
    work = app.open(new File(params.workCopyPath));
    if (!hostFilePathMatches(renderPath(work), params.workCopyPath) || app.activeDocument !== work) fileRefusal = { code: "RENDER_WORK_COPY_NOT_OPENED", message: "The work copy did not open as the active document." };
    else {
      fileRefusal = renderCheck(work);
      if (fileRefusal === null) { fileLayers = nplScanSafe(work); fileOutcome = renderCapture(work); }
    }
  } finally {
    if (work !== null) work.close(SaveOptions.DONOTSAVECHANGES);
    app.userInteractionLevel = previousInteraction;
    if (app.activeDocument !== renderDocument) app.activeDocument = renderDocument;
  }
  workClosed = true;
  for (var closedIndex = 0; closedIndex < app.documents.length; closedIndex++) {
    if (hostFilePathMatches(renderPath(app.documents[closedIndex]), params.workCopyPath)) workClosed = false;
  }
  result = { before: fileBefore, after: renderState(renderDocument), boards: fileOutcome.boards, notRendered: fileOutcome.notRendered, hostMs: fileOutcome.hostMs,
    appVersion: String(app.version), workCopyClosed: workClosed, refusal: fileRefusal, nonPrintingLayers: fileLayers };
}
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
export function describeRenderStateChanges(before, after) {
    const changes = [];
    if (before.context.key !== after.context.key)
        changes.push(`document key ${before.context.keyShort} -> ${after.context.keyShort}`);
    if (before.context.saved !== after.context.saved)
        changes.push(`saved ${String(before.context.saved)} -> ${String(after.context.saved)}`);
    if (!after.active)
        changes.push('the document is no longer the active document');
    for (const field of ['pageItems', 'layers', 'selection', 'activeLayer']) {
        if (before[field] !== after[field])
            changes.push(`${field} ${String(before[field])} -> ${String(after[field])}`);
    }
    if (JSON.stringify(before.artboards) !== JSON.stringify(after.artboards))
        changes.push('artboards changed');
    if (before.context.activeArtboardIndex !== after.context.activeArtboardIndex)
        changes.push('active artboard changed');
    return changes;
}
function hostVersion(app) {
    const { status } = evaluateHostVersion('artboard_render', app);
    if (status === 'unreadable')
        throw new RenderFailedError('RENDER_HOST_VERSION_UNREADABLE', `Illustrator reported version ${app}, which cannot be read.`);
    return `${app} ${status}`;
}
export function profileRefusal(observation, what = 'Rendering', nothing = 'nothing was rendered') {
    const detail = `(profile ${observation.profile}, frontmost ${observation.frontmostBundleId ?? 'unknown'}); ${nothing}.`;
    if (observation.profile === 'locked')
        return new RenderRejectedError('RENDER_SCREEN_LOCKED', `The screen is locked; unlock it and retry ${detail}`);
    if (observation.profile === 'unknown')
        return new RenderRejectedError('RENDER_HOST_PROFILE_UNKNOWN', `The screen lock state or the frontmost application could not be read ${detail}`);
    return new RenderRejectedError('RENDER_ILLUSTRATOR_NOT_FRONTMOST', `${what} is measured with Illustrator frontmost only; bring it to the front and retry ${detail}`);
}
const SAVED_REFUSAL_MESSAGE = 'The document is saved (saved=true). Drawing it marks it changed, so source current is refused; ' +
    'use source file to draw its file (the same content), or render after the first change. Nothing was rendered.';
const documentIdentity = (context) => context.path ?? `name:${context.name}`;
function changedBox(before, after, width, height, threshold) {
    const a = decodePng(before, 'before'), b = decodePng(after, 'after');
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const o = (y * width + x) * 4;
            if (Math.max(Math.abs(a[o] - b[o]), Math.abs(a[o + 1] - b[o + 1]), Math.abs(a[o + 2] - b[o + 2]), Math.abs(a[o + 3] - b[o + 3])) > threshold) {
                if (x < left)
                    left = x;
                if (x > right)
                    right = x;
                if (y < top)
                    top = y;
                if (y > bottom)
                    bottom = y;
            }
        }
    }
    return [left, top, right, bottom];
}
export async function renderArtboards(deps, input) {
    const created = { directory: null, id: null };
    try {
        return await renderArtboardsIn(deps, input, created);
    }
    catch (error) {
        if (created.directory !== null && (error instanceof RenderRejectedError || error instanceof DocumentMismatchError)) {
            await rm(created.directory, { recursive: true, force: true }).catch(() => undefined);
        }
        throw error;
    }
    finally {
        if (created.id !== null)
            deps.store.release(created.id);
    }
}
async function renderArtboardsIn(deps, input, created) {
    if (isWindowsPrivateState())
        throw new RenderRejectedError('RENDER_PLATFORM_UNMEASURED', 'Artboard rendering is measured on macOS only; nothing was rendered.');
    const baseline = input.compareTo === undefined ? null : deps.store.get(input.compareTo) ?? null;
    if (input.compareTo !== undefined && baseline === null) {
        throw new RenderRejectedError('RENDER_BASELINE_UNKNOWN', `Render set ${input.compareTo} is not known to this server (render sets last only while the server runs). Render the baseline again, then compare.`);
    }
    if (baseline !== null && baseline.resolution !== input.resolution) {
        throw new RenderRejectedError('RENDER_BASELINE_RESOLUTION', `Render set ${baseline.id} was drawn at ${baseline.resolution} ppi; compare at the same resolution.`);
    }
    if (input.artboards !== undefined && input.artboards.length > RENDER_LIMITS.artboards) {
        throw new RenderRejectedError('RENDER_LIMIT_EXCEEDED', `At most ${RENDER_LIMITS.artboards} artboards per call; split them over several calls.`);
    }
    const profileBefore = await deps.hostProfileProbe.observe();
    if (profileBefore.profile !== 'foreground')
        throw profileRefusal(profileBefore);
    let boards = input.artboards;
    let workSource = null;
    const id = randomUUID();
    created.id = id;
    deps.store.reserve(id);
    const directory = join(deps.renderRoot, `${RENDER_SET_PREFIX}${id}`);
    await ensurePrivateDirectory(deps.renderRoot, 'render root');
    const cleanupNotes = [];
    let cleanup;
    const retention = deps.retention ?? { now: Date.now, limits: RENDER_RETENTION_LIMITS };
    try {
        const pruned = await pruneRenderSets({ renderRoot: deps.renderRoot, prefix: RENDER_SET_PREFIX, isReferenced: (candidate) => deps.store.isReferenced(candidate), now: retention.now(), limits: retention.limits });
        cleanup = { removed: pruned.removed, kept: pruned.kept };
        if (pruned.unexpected.length > 0)
            cleanupNotes.push(`Render sets ${pruned.unexpected.join(', ')} were kept: they hold files other than the render's own.`);
        if (pruned.failed.length > 0)
            cleanupNotes.push(`Render sets ${pruned.failed.map((failure) => failure.name).join(', ')} were not removed: ${pruned.failed.map((failure) => failure.reason).join('; ')}.`);
    }
    catch (error) {
        cleanupNotes.push(`Old render sets were not cleaned up (${error instanceof Error ? error.message : String(error)}); the render continues.`);
    }
    await mkdir(directory, { mode: 0o700 });
    created.directory = directory;
    const workCopyPath = join(directory, 'work.ai');
    if (boards === undefined || input.source === 'file') {
        const context = (await deps.bridge.execute({
            kind: 'read', script: 'var result = requireDocumentForRead(params.expectedDocumentKey);', params: { expectedDocumentKey: input.expectedDocumentKey },
        }).catch((error) => {
            const detail = parseHostError(error);
            if (detail?.code === 'DOCUMENT_MISMATCH')
                throw new DocumentMismatchError(input.expectedDocumentKey, String(detail.actual ?? ''));
            throw error;
        })).data;
        if (boards === undefined) {
            if (context.artboardCount > RENDER_LIMITS.artboards) {
                throw new RenderRejectedError('RENDER_LIMIT_EXCEEDED', `The document has ${context.artboardCount} artboards; at most ${RENDER_LIMITS.artboards} per call. Pass artboards to split them over several calls.`);
            }
            boards = Array.from({ length: context.artboardCount }, (_, index) => index);
        }
        if (input.source === 'file') {
            const path = context.path ?? documentKeyPath(input.expectedDocumentKey);
            if (path === null || context.fileRevision === null)
                throw new RenderRejectedError('RENDER_NO_FILE', 'The document has no saved file to render; use source current.');
            const source = await inspectSourceFile(path);
            const copy = await copyFileExclusive(source.path, workCopyPath, source.identity);
            workSource = { path: source.path, identity: source.identity, sha256: copy.sha256 };
        }
    }
    if (baseline !== null) {
        const keyPath = documentKeyPath(input.expectedDocumentKey);
        if (keyPath !== null && baseline.document !== keyPath) {
            throw new RenderRejectedError('RENDER_BASELINE_OTHER_DOCUMENT', `Render set ${baseline.id} is of another document; compare renders of the same document.`);
        }
    }
    let host;
    try {
        host = (await deps.bridge.execute({
            kind: 'read',
            script: RENDER_ARTBOARDS_SCRIPT,
            params: {
                expectedDocumentKey: input.expectedDocumentKey, source: input.source, boards, resolution: input.resolution, outputDir: directory,
                workCopyPath, workRoot: deps.renderRoot, budgetMs: RENDER_HOST_BUDGET_MS, maxPixels: RENDER_LIMITS.pixels, maxSidePx: RENDER_LIMITS.maxSidePx,
                savedRefusalMessage: SAVED_REFUSAL_MESSAGE,
            },
            timeoutMs: RENDER_HOST_TIMEOUT_MS,
        })).data;
    }
    catch (error) {
        if (error instanceof IndeterminateExecutionError) {
            throw new IndeterminateExecutionError(`${error.message} The render directory is kept: ${directory}. A work copy may still be open; run illustrator_reconcile before the next command.`, error.commandId, { code: error.code, exitCode: error.exitCode, signal: error.signal, killed: error.killed });
        }
        const detail = parseHostError(error);
        if (detail?.code === 'DOCUMENT_MISMATCH')
            throw new DocumentMismatchError(input.expectedDocumentKey, String(detail.actual ?? ''));
        if (detail?.code?.startsWith('RENDER_') === true) {
            const actual = detail.actual === null || detail.actual === undefined ? '' : ` (${String(detail.actual)})`;
            throw new RenderRejectedError(detail.code, `${detail.message ?? detail.code}${actual}`);
        }
        throw error;
    }
    if (host.boards.length > 0)
        created.directory = null;
    const changes = describeRenderStateChanges(host.before, host.after);
    if (changes.length > 0) {
        throw new RenderFailedError('RENDER_CHANGED_DOCUMENT_STATE', `The render changed the document state (${changes.join('; ')}). No result is returned; re-read the document before any further operation.`);
    }
    if (input.source === 'file') {
        if (host.workCopyClosed !== true)
            throw new RenderFailedError('RENDER_WORK_COPY_NOT_CLOSED', `The work copy ${workCopyPath} is still open; close it without saving.`);
        const current = await inspectSourceFile(workSource.path);
        if (!await sameFileOrSameBytes(workSource.path, current.identity, workSource.identity, workSource.sha256)) {
            throw new RenderFailedError('RENDER_SOURCE_FILE_CHANGED', 'The document file changed while its copy was rendered; the result is discarded.');
        }
        if (host.refusal)
            throw new RenderRejectedError(host.refusal.code, `${host.refusal.message} The work copy was closed without saving.`);
    }
    const failed = host.boards.filter((board) => !board.captured);
    if (failed.length > 0) {
        throw new RenderFailedError('RENDER_CAPTURE_FAILED', `Illustrator did not render artboard ${failed.map((board) => `${board.index} (${board.error ?? 'no file'})`).join(', ')}. The document state was re-read and is unchanged.`);
    }
    const profileAfter = await deps.hostProfileProbe.observe();
    if (profileAfter.profile !== 'foreground') {
        throw new RenderFailedError('RENDER_HOST_PROFILE_CHANGED', `The host left the measured foreground profile during the render (profile ${profileAfter.profile}); the result is discarded.`);
    }
    const rendered = [];
    const bytesOf = new Map();
    for (const board of host.boards) {
        const rect = board.rect;
        const width = Math.round((rect[2] - rect[0]) * input.resolution / 72), height = Math.round((rect[1] - rect[3]) * input.resolution / 72);
        const path = join(directory, `ab-${board.index}.png`);
        const source = await readStableImage(path, 'preview');
        const dimensions = inspectSupportedPng(source.bytes, 'preview');
        if (dimensions.width !== width || dimensions.height !== height) {
            throw new RenderFailedError('RENDER_OUTPUT_INVALID', `Artboard ${board.index} rendered ${dimensions.width}x${dimensions.height} px, expected ${width}x${height} px.`);
        }
        bytesOf.set(board.index, source.bytes);
        rendered.push({ index: board.index, name: board.name, rect, width, height, rounded: rect.some((value) => !Number.isInteger(value)), path, sha256: source.metadata.sha256 });
    }
    const document = documentIdentity(host.after.context);
    if (baseline !== null && baseline.document !== document) {
        throw new RenderRejectedError('RENDER_BASELINE_OTHER_DOCUMENT', `Render set ${baseline.id} is of another document; compare renders of the same document.`);
    }
    deps.store.put({ id, document, source: input.source, resolution: input.resolution, boards: rendered });
    let comparison = null;
    const images = [];
    if (baseline !== null) {
        const differing = [];
        const structureChanged = [];
        let unchanged = 0;
        for (const board of rendered) {
            const before = baseline.boards.find((candidate) => candidate.index === board.index);
            if (before === undefined) {
                structureChanged.push(board.index);
                continue;
            }
            if (before.width !== board.width || before.height !== board.height || before.name !== board.name ||
                before.rect.some((value, position) => value !== board.rect[position])) {
                structureChanged.push(board.index);
                continue;
            }
            const output = await comparePngImages({ beforePath: before.path, afterPath: board.path, threshold: input.threshold, origin: 'private_state' });
            if (output.result.comparison.changedPixels === 0) {
                unchanged++;
                continue;
            }
            const diffPath = join(directory, `diff-${board.index}.png`);
            await writeFile(diffPath, output.images.diff, { flag: 'wx', mode: 0o600 });
            differing.push({ index: board.index, changedPixels: output.result.comparison.changedPixels,
                box: changedBox(output.images.before, output.images.after, board.width, board.height, input.threshold), diffPath });
            if (images.length < input.maxInlineImages * 2) {
                images.push({ label: `artboard ${board.index} ${board.name} after`, png: bytesOf.get(board.index) });
                images.push({ label: `artboard ${board.index} ${board.name} diff`, png: output.images.diff });
            }
        }
        for (const board of baseline.boards) {
            if (input.artboards === undefined && !rendered.some((candidate) => candidate.index === board.index))
                structureChanged.push(board.index);
        }
        comparison = { baseline: baseline.id, unchanged, differing, structureChanged };
    }
    const notes = ['Render sets last only while this server runs; after a restart render the baseline again.',
        `The PNG files are kept in ${directory} and are not deleted automatically by this call; render sets outside the retention limits are removed when a later call starts.`];
    if (input.source === 'current' && host.after.context.fileRevision === null)
        notes.push('This document has never been saved: its renders cannot be drawn again from a file after a restart.');
    const rounded = rendered.filter((board) => board.rounded).map((board) => board.index);
    if (rounded.length > 0)
        notes.push(`Artboards ${rounded.join(', ')} have a non-integer edge: each side is rounded to the nearest pixel; edge pixels are not measured.`);
    if (comparison !== null && comparison.structureChanged.length > 0)
        notes.push(`Artboards ${comparison.structureChanged.join(', ')} were not compared: their name, position or size differs from the baseline, or only one render has them.`);
    if (host.notRendered.length > 0)
        notes.push(`Artboards ${host.notRendered.join(', ')} were not rendered within the call budget; render them in another call.`);
    const layerWarning = nonPrintingLayerWarning(host.nonPrintingLayers ?? undefined, 'warn_only');
    if (layerWarning !== null)
        notes.push(layerWarning.message);
    notes.push(...cleanupNotes);
    const result = renderResultSchema.parse({
        documentKey: host.after.context.key,
        renderSetId: id,
        artboards: rendered.map(({ index, name, width, height, path }) => ({ index, name, width, height, path })),
        comparison,
        hostVersion: hostVersion(host.appVersion),
        hostMs: Math.max(0, Math.round(host.hostMs)),
        cleanup,
        notes,
    });
    return { result, images };
}
