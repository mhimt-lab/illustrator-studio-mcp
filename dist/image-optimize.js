import { z } from 'zod';
import { EXPORT_HELPERS } from './document-export.js';
import { documentContextSchema } from './mutation-result-schema-core.js';
import { visualDiffResultSchema } from './visual-diff.js';
export const IMAGE_OPTIMIZE_APP_VERSION = '30.8.1';
export const IMAGE_OPTIMIZE_MIN_PPI = 72;
export const IMAGE_OPTIMIZE_MAX_PPI = 1200;
export const IMAGE_OPTIMIZE_MAX_TARGETS = 10;
export const IMAGE_OPTIMIZE_MAX_SCANNED_IMAGES = 500;
export const IMAGE_OPTIMIZE_HOST_TIMEOUT_MS = 300_000;
export const IMAGE_OPTIMIZE_RENDER_MAX_PIXELS = 4_194_304;
export const IMAGE_OPTIMIZE_QUALITY_CONTRACT = Object.freeze({
    channelThreshold: 12, maxChangedRatio: 0.02, maxMeanAbsoluteChannelDelta: 2, maxChannelDelta: 48,
});
export const IMAGE_OPTIMIZE_GEOMETRY_TOLERANCE_PT = 0.01;
export const IMAGE_OPTIMIZE_PIXEL_TOLERANCE = 1;
export const IMAGE_OPTIMIZE_ANISOTROPY_TOLERANCE_PPI = 0.1;
export const IMAGE_OPTIMIZE_FIXED_SAVE_OPTIONS = Object.freeze({
    compressed: true, embedICCProfile: false, embedLinkedFiles: false, saveMultipleArtboards: false,
});
export const IMAGE_OPTIMIZE_ICC_NOTE = 'The output is saved with embedICCProfile=false: an ICC profile embedded in the source is not carried over to the output. Check colour management before using it for print.';
export function imageOptimizeSaveOptions(pdfCompatible) {
    return { pdfCompatible, ...IMAGE_OPTIMIZE_FIXED_SAVE_OPTIONS };
}
const OPTIMIZE_HELPERS = `${EXPORT_HELPERS}
function optimizeNumber(value, label) {
  if (typeof value !== "number" || !isFinite(value)) throw new Error("OPTIMIZE_NON_FINITE:" + label);
  return value;
}
function optimizeVector(value, count, label) {
  if (!value || value.length !== count) throw new Error("OPTIMIZE_VECTOR:" + label);
  var optimizeOut = [];
  for (var optimizeVectorCursor = 0; optimizeVectorCursor < count; optimizeVectorCursor++) optimizeOut.push(optimizeNumber(value[optimizeVectorCursor], label));
  return optimizeOut;
}
function optimizeFacts(item, index) {
  var optimizeClipped = false;
  var optimizeLockedAncestor = false;
  var optimizeHiddenAncestor = false;
  var optimizeNode = item.parent;
  var optimizeParentType = String(optimizeNode.typename);
  while (optimizeNode && optimizeNode.typename !== "Document") {
    if (optimizeNode.typename === "Layer") {
      if (optimizeNode.locked === true) optimizeLockedAncestor = true;
      if (optimizeNode.visible !== true) optimizeHiddenAncestor = true;
    } else {
      if (optimizeNode.typename === "GroupItem" && optimizeNode.clipped === true) optimizeClipped = true;
      if (optimizeNode.locked === true) optimizeLockedAncestor = true;
      if (optimizeNode.hidden === true) optimizeHiddenAncestor = true;
    }
    optimizeNode = optimizeNode.parent;
  }
  var optimizeMatrix = item.matrix;
  return {
    index: index,
    uuid: String(item.uuid),
    name: String(item.name),
    embedded: item.embedded === true,
    bounds: optimizeVector(item.geometricBounds, 4, "bounds"),
    position: optimizeVector(item.position, 2, "position"),
    intrinsicBounds: optimizeVector(item.boundingBox, 4, "boundingBox"),
    matrix: [optimizeNumber(optimizeMatrix.mValueA, "a"), optimizeNumber(optimizeMatrix.mValueB, "b"),
      optimizeNumber(optimizeMatrix.mValueC, "c"), optimizeNumber(optimizeMatrix.mValueD, "d"),
      optimizeNumber(optimizeMatrix.mValueTX, "tx"), optimizeNumber(optimizeMatrix.mValueTY, "ty")],
    colorSpace: String(item.imageColorSpace),
    bitsPerChannel: optimizeNumber(item.bitsPerChannel, "bitsPerChannel"),
    channels: optimizeNumber(item.channels, "channels"),
    locked: item.locked === true,
    hidden: item.hidden === true,
    opacity: optimizeNumber(item.opacity, "opacity"),
    blendNormal: item.blendingMode === BlendModes.NORMAL,
    parentType: optimizeParentType,
    clippedAncestor: optimizeClipped,
    lockedAncestor: optimizeLockedAncestor,
    hiddenAncestor: optimizeHiddenAncestor,
    layer: String(item.layer.name)
  };
}
function optimizeScan(doc) {
  if (doc.rasterItems.length > params.maxScannedImages) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "OPTIMIZE_TOO_MANY_IMAGES", count: doc.rasterItems.length }));
  }
  var optimizeReads = [];
  for (var optimizeScanCursor = 0; optimizeScanCursor < doc.rasterItems.length; optimizeScanCursor++) {
    try { optimizeReads.push({ index: optimizeScanCursor, facts: optimizeFacts(doc.rasterItems[optimizeScanCursor], optimizeScanCursor), readError: null }); }
    catch (optimizeReadError) { optimizeReads.push({ index: optimizeScanCursor, facts: null, readError: String(optimizeReadError.message) }); }
  }
  return optimizeReads;
}
function optimizeSiblings(container) {
  var optimizeUuids = [];
  for (var optimizeSiblingCursor = 0; optimizeSiblingCursor < container.pageItems.length; optimizeSiblingCursor++) {
    optimizeUuids.push(String(container.pageItems[optimizeSiblingCursor].uuid));
  }
  return optimizeUuids;
}
function optimizeAlertsOff(callback) {
  var optimizePreviousInteraction = app.userInteractionLevel;
  app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
  try { return callback(); } finally { app.userInteractionLevel = optimizePreviousInteraction; }
}
function optimizeRender(doc, basePath, scalePercent) {
  var optimizeRenderFile = new File(basePath + ".png");
  if (optimizeRenderFile.exists || new File(basePath).exists) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "OPTIMIZE_RENDER_EXISTS", path: basePath }));
  }
  var optimizeRenderOptions = new ExportOptionsPNG24();
  optimizeRenderOptions.artBoardClipping = true;
  optimizeRenderOptions.horizontalScale = scalePercent;
  optimizeRenderOptions.verticalScale = scalePercent;
  optimizeRenderOptions.antiAliasing = true;
  optimizeRenderOptions.transparency = true;
  optimizeRenderOptions.saveAsHTML = false;
  optimizeAlertsOff(function () { doc.exportFile(new File(basePath), ExportType.PNG24, optimizeRenderOptions); });
  if (!optimizeRenderFile.exists) throw new Error("MCP_ERROR:" + stringifyJson({ code: "OPTIMIZE_RENDER_MISSING", path: basePath }));
  return { path: optimizeRenderFile.fsName, bytes: optimizeRenderFile.length };
}
function optimizeSaveOptions(values) {
  var optimizeOptions = new IllustratorSaveOptions();
  optimizeOptions.pdfCompatible = values.pdfCompatible === true;
  optimizeOptions.compressed = values.compressed === true;
  optimizeOptions.embedICCProfile = values.embedICCProfile === true;
  optimizeOptions.embedLinkedFiles = values.embedLinkedFiles === true;
  optimizeOptions.saveMultipleArtboards = values.saveMultipleArtboards === true;
  return optimizeOptions;
}
/**
 * The work copy is identified by path and content, never by its document key: the PNG render changes it to
 * saved=false and every save changes its file revision, so the key moves on each step (product live validation
 * run 1). Exactly one open document must sit on one of the session's work paths (the work copy or the staged
 * output) with the source's colour space, artboard rectangles, page-item and raster counts; the same idea as the
 * reconcile close.
 */
function optimizeRequireWorkCopy() {
  var optimizeMatches = exportMatchesByPath(params.workCopyPaths);
  if (optimizeMatches.length !== 1) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "OPTIMIZE_WORK_COPY_NOT_UNIQUE", count: optimizeMatches.length }));
  }
  var optimizeEntry = optimizeMatches[0].entry;
  var optimizeExpected = params.workIdentity;
  var optimizeRasterCount = optimizeMatches[0].doc.rasterItems.length;
  if (optimizeEntry.colorSpace !== optimizeExpected.colorSpace || optimizeEntry.artboardRects !== optimizeExpected.artboardRects ||
      optimizeEntry.pageItems !== optimizeExpected.pageItems || optimizeRasterCount !== optimizeExpected.rasterItems) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "OPTIMIZE_WORK_COPY_IDENTITY_MISMATCH", actual: optimizeEntry, rasterItems: optimizeRasterCount }));
  }
  return optimizeMatches[0];
}
function optimizeWorkIdentity(doc, index) {
  var optimizeIdentity = getDocumentIdentity(doc, index);
  return { key: optimizeIdentity.key, path: optimizeIdentity.path, saved: optimizeIdentity.saved, fileRevision: optimizeIdentity.fileRevision };
}
`;
export const IMAGE_OPTIMIZE_READ_SOURCE_SCRIPT = `${OPTIMIZE_HELPERS}
var optimizeSourceContext = requireDocumentForRead(params.expectedDocumentKey);
var optimizeSourceDocument = app.activeDocument;
var result = {
  document: optimizeSourceContext,
  artboards: exportArtboards(optimizeSourceDocument),
  rasterItems: optimizeSourceDocument.rasterItems.length,
  pageItems: optimizeSourceDocument.pageItems.length,
  artboardRects: exportArtboardRects(optimizeSourceDocument),
  rasters: optimizeScan(optimizeSourceDocument)
};
`;
export const IMAGE_OPTIMIZE_BASELINE_CODES = ['OPTIMIZE_TOO_MANY_IMAGES', 'OPTIMIZE_RENDER_EXISTS', 'OPTIMIZE_RENDER_MISSING'];
export const IMAGE_OPTIMIZE_BASELINE_SCRIPT = `${OPTIMIZE_HELPERS}
var optimizeBaselineTarget = optimizeRequireWorkCopy();
var optimizeBaselineDocument = optimizeBaselineTarget.doc;
var optimizeBaselineRasters = optimizeScan(optimizeBaselineDocument);
var optimizeBaselineArtboards = exportArtboards(optimizeBaselineDocument);
var optimizeBaselineRender = optimizeRender(optimizeBaselineDocument, params.renderBeforeBase, params.renderScalePercent);
var result = {
  workCopy: optimizeWorkIdentity(optimizeBaselineDocument, optimizeBaselineTarget.index),
  artboards: optimizeBaselineArtboards,
  rasters: optimizeBaselineRasters,
  render: optimizeBaselineRender
};
`;
export const IMAGE_OPTIMIZE_RASTERIZE_SCRIPT = `${OPTIMIZE_HELPERS}
var optimizeTarget = optimizeRequireWorkCopy();
var optimizeDocument = optimizeTarget.doc;
var optimizeResults = [];
var optimizeErrors = [];
for (var optimizeTargetCursor = 0; optimizeTargetCursor < params.targets.length; optimizeTargetCursor++) {
  var optimizeExpected = params.targets[optimizeTargetCursor];
  var optimizeUuid = optimizeExpected.uuid;
  var optimizeStage = "lookup";
  try {
    // Looked up again in the type collection right before the rasterize, then held to the baseline read.
    var optimizeSource = null;
    for (var optimizeLookup = 0; optimizeLookup < optimizeDocument.rasterItems.length; optimizeLookup++) {
      if (String(optimizeDocument.rasterItems[optimizeLookup].uuid) === optimizeUuid) { optimizeSource = optimizeDocument.rasterItems[optimizeLookup]; break; }
    }
    if (optimizeSource === null) throw new Error("OPTIMIZE_TARGET_NOT_FOUND:" + optimizeUuid);
    optimizeStage = "read_before";
    var optimizeBefore = optimizeFacts(optimizeSource, -1);
    var optimizeBoundsMatch = true;
    for (var optimizeBoundsCursor = 0; optimizeBoundsCursor < 4; optimizeBoundsCursor++) {
      if (Math.abs(optimizeBefore.bounds[optimizeBoundsCursor] - optimizeExpected.bounds[optimizeBoundsCursor]) > params.geometryTolerance) optimizeBoundsMatch = false;
    }
    if (!optimizeBoundsMatch || optimizeBefore.name !== optimizeExpected.name || optimizeBefore.layer !== optimizeExpected.layer) {
      throw new Error("OPTIMIZE_TARGET_CONTENT_MISMATCH:" + stringifyJson({ bounds: optimizeBefore.bounds, name: optimizeBefore.name, layer: optimizeBefore.layer }));
    }
    var optimizeContainer = optimizeSource.parent;
    var optimizeSiblingsBefore = optimizeSiblings(optimizeContainer);
    var optimizeCountBefore = optimizeDocument.rasterItems.length;
    var optimizeOptions = new RasterizeOptions();
    optimizeOptions.resolution = params.capPpi;
    optimizeOptions.antiAliasingMethod = AntiAliasingMethod.ARTOPTIMIZED;
    optimizeOptions.colorModel = RasterizationColorModel.DEFAULTCOLORMODEL;
    optimizeOptions.transparency = true;
    optimizeOptions.padding = 0;
    optimizeOptions.convertSpotColors = true;
    optimizeStage = "rasterize";
    var optimizeMade = optimizeAlertsOff(function () { return optimizeDocument.rasterize(optimizeSource, optimizeSource.geometricBounds, optimizeOptions); });
    if (optimizeMade === null || optimizeMade === undefined) throw new Error("OPTIMIZE_RASTERIZE_RETURNED_NOTHING");
    optimizeStage = "restore_name";
    var optimizeNameAfterRasterize = String(optimizeMade.name);
    if (optimizeNameAfterRasterize !== optimizeBefore.name) optimizeMade.name = optimizeBefore.name;
    optimizeStage = "read_after";
    optimizeResults.push({
      sourceUuid: optimizeUuid,
      before: optimizeBefore,
      after: optimizeFacts(optimizeMade, -1),
      nameAfterRasterize: optimizeNameAfterRasterize,
      rasterCountBefore: optimizeCountBefore,
      rasterCountAfter: optimizeDocument.rasterItems.length,
      siblingsBefore: optimizeSiblingsBefore,
      siblingsAfter: optimizeSiblings(optimizeMade.parent)
    });
  } catch (optimizeCaught) {
    optimizeErrors.push({ uuid: optimizeUuid, stage: optimizeStage, message: String(optimizeCaught.message) });
    break;
  }
}
var optimizeRenderAfter = null;
if (optimizeErrors.length === 0) {
  try { optimizeRenderAfter = optimizeRender(optimizeDocument, params.renderAfterBase, params.renderScalePercent); }
  catch (optimizeRenderError) { optimizeErrors.push({ uuid: "", stage: "render_after", message: String(optimizeRenderError.message) }); }
}
var result = {
  workCopy: optimizeWorkIdentity(optimizeDocument, optimizeTarget.index),
  results: optimizeResults,
  errors: optimizeErrors,
  artboards: exportArtboards(optimizeDocument),
  render: optimizeRenderAfter
};
`;
export const IMAGE_OPTIMIZE_SAVE_PRE_ATTEMPT_CODES = ['OPTIMIZE_WORK_COPY_NOT_UNIQUE', 'OPTIMIZE_WORK_COPY_IDENTITY_MISMATCH', 'EXPORT_OUTPUT_EXISTS'];
export const IMAGE_OPTIMIZE_SAVE_FAILED_CODE = 'OPTIMIZE_SAVE_FAILED';
export const IMAGE_OPTIMIZE_SAVE_SCRIPT = `${OPTIMIZE_HELPERS}
var optimizeSaveTarget = optimizeRequireWorkCopy();
var optimizeSaveDocument = optimizeSaveTarget.doc;
var optimizeStagedFile = new File(params.stagedPath);
if (optimizeStagedFile.exists || new File(params.outputPath).exists) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_OUTPUT_EXISTS" }));
}
var optimizePathBefore = exportPathOf(optimizeSaveDocument);
var optimizeSaveError = null;
optimizeAlertsOff(function () {
  try { optimizeSaveDocument.saveAs(optimizeStagedFile, optimizeSaveOptions(params.saveOptions)); }
  catch (optimizeCaughtSaveError) { optimizeSaveError = String(optimizeCaughtSaveError.message); }
});
var optimizeOutputExists = new File(params.stagedPath).exists;
if (optimizeSaveError !== null) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "OPTIMIZE_SAVE_FAILED", message: optimizeSaveError, outputExists: optimizeOutputExists }));
}
if (!optimizeOutputExists) throw new Error("MCP_ERROR:" + stringifyJson({ code: "OPTIMIZE_SAVE_NO_FILE" }));
var result = {
  workCopy: optimizeWorkIdentity(optimizeSaveDocument, optimizeSaveTarget.index),
  pathBefore: optimizePathBefore,
  pathAfter: exportPathOf(optimizeSaveDocument),
  outputExists: optimizeOutputExists
};
`;
export const IMAGE_OPTIMIZE_CLOSE_WORK_COPY_SCRIPT = `${OPTIMIZE_HELPERS}
var optimizeCloseTarget = optimizeRequireWorkCopy();
var optimizeCloseSources = exportMatchesByPath([params.sourcePath]);
if (optimizeCloseSources.length !== 1) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_SOURCE_NOT_UNIQUE", count: optimizeCloseSources.length }));
}
var optimizeCloseSource = optimizeCloseSources[0];
if (exportKeyWithoutIndex(optimizeCloseSource.entry.key) !== exportKeyWithoutIndex(params.expectedDocumentKey) ||
    optimizeCloseSource.entry.saved !== true || optimizeCloseSource.entry.fileRevision !== params.sourceFileRevision) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_SOURCE_IDENTITY_MISMATCH", actual: optimizeCloseSource.entry }));
}
if (optimizeCloseTarget.doc === optimizeCloseSource.doc) throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_WORK_COPY_IS_SOURCE" }));
var optimizeClosedBefore = getDocumentIdentity(optimizeCloseTarget.doc, optimizeCloseTarget.index);
optimizeAlertsOff(function () { optimizeCloseTarget.doc.close(SaveOptions.DONOTSAVECHANGES); });
if (exportMatchesByPath(params.sessionPaths).length !== 0) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "EXPORT_WORK_COPY_STILL_OPEN" }));
}
app.activeDocument = optimizeCloseSource.doc;
var result = {
  closedBeforeClose: optimizeClosedBefore,
  source: getDocumentContext(),
  documentCount: app.documents.length
};
`;
export function assertRenderBaseName(base) {
    const name = base.slice(base.lastIndexOf('/') + 1);
    if (name.length === 0 || name.includes('.'))
        throw new Error(`A render base name must not contain a dot: ${name}`);
}
const round6 = (value) => Number(value.toFixed(6));
export function effectivePpi(facts) {
    const [left, top, right, bottom] = facts.intrinsicBounds;
    const width = Math.abs(right - left);
    const height = Math.abs(top - bottom);
    const [a, b, c, d] = facts.matrix;
    const xPoints = width * Math.hypot(a, b);
    const yPoints = height * Math.hypot(c, d);
    if (![width, height, xPoints, yPoints].every((value) => Number.isFinite(value) && value > 0))
        return null;
    return {
        pixels: [round6(width), round6(height)],
        points: [round6(xPoints), round6(yPoints)],
        ppi: [round6(width * 72 / xPoints), round6(height * 72 / yPoints)],
    };
}
const within = (inner, outer) => inner[0] >= outer[0] - IMAGE_OPTIMIZE_GEOMETRY_TOLERANCE_PT && inner[1] <= outer[1] + IMAGE_OPTIMIZE_GEOMETRY_TOLERANCE_PT &&
    inner[2] <= outer[2] + IMAGE_OPTIMIZE_GEOMETRY_TOLERANCE_PT && inner[3] >= outer[3] - IMAGE_OPTIMIZE_GEOMETRY_TOLERANCE_PT;
export function classifyRasters(reads, capPpi, artboard) {
    const candidates = [];
    const excluded = [];
    for (const read of reads) {
        const facts = read.facts;
        if (facts === null) {
            excluded.push({ index: read.index, uuid: null, name: null, reason: 'read_failed', ppi: null });
            continue;
        }
        const measured = effectivePpi(facts);
        const exclude = (reason) => {
            excluded.push({ index: read.index, uuid: facts.uuid, name: facts.name, reason, ppi: measured?.ppi ?? null });
        };
        const [a, b, c, d] = facts.matrix;
        if (!facts.embedded)
            exclude('linked');
        else if (facts.colorSpace !== 'ImageColorSpace.RGB')
            exclude('not_rgb');
        else if (facts.bitsPerChannel !== 8)
            exclude('bit_depth_unmeasured');
        else if (b !== 0 || c !== 0 || !(a > 0) || !(d > 0))
            exclude('rotated_or_flipped');
        else if (measured === null)
            exclude('geometry_unavailable');
        else if (Math.abs(measured.ppi[0] - measured.ppi[1]) > IMAGE_OPTIMIZE_ANISOTROPY_TOLERANCE_PPI)
            exclude('anisotropic_scale');
        else if (facts.parentType !== 'Layer')
            exclude('in_group_unmeasured');
        else if (facts.clippedAncestor)
            exclude('clipped');
        else if (facts.locked || facts.hidden || facts.lockedAncestor || facts.hiddenAncestor)
            exclude('locked_or_hidden');
        else if (facts.opacity !== 100 || !facts.blendNormal)
            exclude('appearance_unmeasured');
        else if (!within(facts.bounds, artboard))
            exclude('outside_artboard');
        else if (Math.min(measured.ppi[0], measured.ppi[1]) <= capPpi)
            exclude('at_or_below_cap');
        else {
            const expectedPixels = [Math.round(measured.points[0] * capPpi / 72), Math.round(measured.points[1] * capPpi / 72)];
            if (expectedPixels[0] < 1 || expectedPixels[1] < 1)
                exclude('geometry_unavailable');
            else
                candidates.push({ index: read.index, uuid: facts.uuid, name: facts.name, layer: facts.layer, pixels: measured.pixels, ppi: measured.ppi, expectedPixels });
        }
    }
    return { candidates, excluded };
}
export function renderGeometry(artboard, capPpi) {
    const scale = capPpi / 72;
    return {
        width: Math.round((artboard[2] - artboard[0]) * scale),
        height: Math.round((artboard[1] - artboard[3]) * scale),
        scalePercent: round6(scale * 100),
    };
}
export function workCopyDifferences(source, work) {
    if (source.length !== work.length)
        return [`raster count ${source.length} → ${work.length}`];
    const differences = [];
    for (let index = 0; index < source.length; index++) {
        const left = source[index].facts;
        const right = work[index].facts;
        if (left === null || right === null) {
            if (left !== right)
                differences.push(`raster ${index}: readable on one side only`);
            continue;
        }
        const { uuid: _leftUuid, ...leftRest } = left;
        const { uuid: _rightUuid, ...rightRest } = right;
        for (const key of Object.keys(leftRest)) {
            if (JSON.stringify(leftRest[key]) !== JSON.stringify(rightRest[key]))
                differences.push(`raster ${index}: ${key}`);
        }
    }
    return differences;
}
const near = (left, right, tolerance) => left.length === right.length && left.every((value, index) => Math.abs(value - right[index]) <= tolerance);
export function verifyTargetResult(result, capPpi) {
    const problems = [];
    const { before, after } = result;
    const ppiBefore = effectivePpi(before);
    const ppiAfter = effectivePpi(after);
    if (ppiBefore === null || ppiAfter === null)
        return { problems: ['effective PPI unavailable'], target: null };
    if (result.rasterCountAfter !== result.rasterCountBefore)
        problems.push(`raster count ${result.rasterCountBefore} → ${result.rasterCountAfter}`);
    if (after.uuid === before.uuid)
        problems.push('the result has the source UUID');
    const expected = [ppiBefore.points[0] * capPpi / 72, ppiBefore.points[1] * capPpi / 72];
    if (!near(ppiAfter.pixels, expected, IMAGE_OPTIMIZE_PIXEL_TOLERANCE))
        problems.push(`pixels ${ppiAfter.pixels.join('x')}, expected about ${expected.map((value) => value.toFixed(2)).join('x')}`);
    if (!near(after.bounds, before.bounds, IMAGE_OPTIMIZE_GEOMETRY_TOLERANCE_PT))
        problems.push('bounds changed');
    if (!near(after.position, before.position, IMAGE_OPTIMIZE_GEOMETRY_TOLERANCE_PT))
        problems.push('position changed');
    if (after.matrix[1] !== 0 || after.matrix[2] !== 0 || !(after.matrix[0] > 0) || !(after.matrix[3] > 0))
        problems.push('result is rotated or flipped');
    if (after.colorSpace !== before.colorSpace || after.bitsPerChannel !== before.bitsPerChannel)
        problems.push('colour space or bit depth changed');
    if (!after.embedded)
        problems.push('result is not embedded');
    if (after.layer !== before.layer || after.parentType !== before.parentType)
        problems.push('layer changed');
    if (after.locked !== before.locked || after.hidden !== before.hidden || after.opacity !== before.opacity || after.blendNormal !== before.blendNormal) {
        problems.push('state or appearance changed');
    }
    if (after.name !== before.name)
        problems.push('name not restored');
    const expectedSiblings = result.siblingsBefore.map((uuid) => (uuid === before.uuid ? after.uuid : uuid));
    if (!result.siblingsBefore.includes(before.uuid) || JSON.stringify(expectedSiblings) !== JSON.stringify(result.siblingsAfter)) {
        problems.push('stacking order changed');
    }
    if (problems.length > 0)
        return { problems, target: null };
    return {
        problems,
        target: {
            sourceUuid: result.sourceUuid, resultUuid: after.uuid, name: after.name, nameRestored: result.nameAfterRasterize !== after.name,
            layer: after.layer, pixelsBefore: ppiBefore.pixels, pixelsAfter: ppiAfter.pixels, ppiBefore: ppiBefore.ppi, ppiAfter: ppiAfter.ppi,
            bounds: after.bounds, position: after.position, colorSpace: after.colorSpace, bitsPerChannel: after.bitsPerChannel,
            channelsBefore: before.channels, channelsAfter: after.channels, stackingPreserved: true,
        },
    };
}
export function renderQualityProblem(comparison) {
    const contract = IMAGE_OPTIMIZE_QUALITY_CONTRACT;
    if (comparison.changedRatio > contract.maxChangedRatio || comparison.meanAbsoluteChannelDelta > contract.maxMeanAbsoluteChannelDelta ||
        comparison.maxChannelDelta > contract.maxChannelDelta) {
        return `The render at the cap resolution changed beyond the contract (changed ratio ${comparison.changedRatio}, mean delta ${comparison.meanAbsoluteChannelDelta}, max delta ${comparison.maxChannelDelta}).`;
    }
    return null;
}
const boundsSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const pairSchema = z.tuple([z.number(), z.number()]);
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
export const imageOptimizeStageSchema = z.enum([
    'read_source', 'copy_work', 'open_session', 'open_work_copy', 'baseline', 'rasterize', 'verify_result', 'save_output',
    'verify_output', 'close_work_copy', 'verify_source', 'publish_output', 'cleanup',
]);
const candidateSchema = z.strictObject({
    index: z.number().int().nonnegative(), uuid: z.string(), name: z.string(), layer: z.string(),
    pixels: pairSchema, ppi: pairSchema, expectedPixels: pairSchema,
});
const exclusionSchema = z.strictObject({
    index: z.number().int().nonnegative(), uuid: z.string().nullable(), name: z.string().nullable(),
    reason: z.enum(['read_failed', 'linked', 'not_rgb', 'bit_depth_unmeasured', 'rotated_or_flipped', 'anisotropic_scale', 'in_group_unmeasured',
        'clipped', 'locked_or_hidden', 'appearance_unmeasured', 'outside_artboard', 'geometry_unavailable', 'at_or_below_cap']),
    ppi: pairSchema.nullable(),
});
const saveOptionsSchema = z.strictObject({
    pdfCompatible: z.boolean(), compressed: z.literal(true), embedICCProfile: z.literal(false), embedLinkedFiles: z.literal(false),
    saveMultipleArtboards: z.literal(false),
});
const iccProfileSchema = z.strictObject({ embedded: z.literal(false), carriedOver: z.literal(false), note: z.literal(IMAGE_OPTIMIZE_ICC_NOTE) });
const renderPlanSchema = z.strictObject({ width: z.number().int().positive(), height: z.number().int().positive(), scalePercent: z.number().positive() });
const filesSchema = z.strictObject({
    workCopyPath: z.string().nullable(), stagedPath: z.string().nullable(), outputPath: z.string().nullable(),
    renderFiles: z.array(z.string()),
});
const targetResultSchema = z.strictObject({
    sourceUuid: z.string(), resultUuid: z.string(), name: z.string(), nameRestored: z.boolean(), layer: z.string(),
    pixelsBefore: pairSchema, pixelsAfter: pairSchema, ppiBefore: pairSchema, ppiAfter: pairSchema, bounds: boundsSchema, position: pairSchema,
    colorSpace: z.string(), bitsPerChannel: z.number(), channelsBefore: z.number(), channelsAfter: z.number(), stackingPreserved: z.literal(true),
});
export const imageOptimizeRejectionReasonSchema = z.enum([
    'document_key_mismatch', 'document_not_admitted', 'app_version_unmeasured', 'host_not_foreground', 'document_color_space_unsupported',
    'multiple_artboards_unmeasured', 'render_budget_exceeded', 'source_file_unsupported', 'too_many_images', 'no_targets', 'too_many_targets',
    'target_not_eligible', 'targets_required', 'output_path_required', 'output_exists', 'output_path_invalid', 'output_cross_device',
    'source_file_unavailable', 'export_root_unavailable',
]);
export const imageOptimizeFailureReasonSchema = z.enum([
    'copy_mismatch', 'file_replaced', 'work_copy_open_failed', 'work_copy_mismatch', 'rasterize_failed',
    'verification_failed', 'render_quality_exceeded', 'save_failed', 'output_verification_failed', 'output_exists', 'output_cross_device',
    'source_changed',
]);
const planSchema = z.strictObject({
    capPpi: z.number().int(),
    targets: z.array(candidateSchema),
    excluded: z.array(exclusionSchema),
    save: saveOptionsSchema,
    iccProfile: iccProfileSchema,
    render: renderPlanSchema,
    limits: z.strictObject({ maxTargets: z.number().int(), maxScannedImages: z.number().int(), renderMaxPixels: z.number().int() }),
});
export const imageOptimizeResultSchema = z.discriminatedUnion('outcome', [
    z.strictObject({ outcome: z.literal('planned'), document: documentContextSchema, plan: planSchema }),
    z.strictObject({
        outcome: z.literal('verified'),
        document: documentContextSchema,
        exportId: z.uuid(),
        capPpi: z.number().int(),
        output: z.strictObject({ path: z.string(), bytes: z.number().int().positive(), sha256: sha256Schema, imageObjects: z.number().int().nonnegative() }),
        bytes: z.strictObject({
            source: z.number().int().positive(),
            optimized: z.number().int().positive(),
            savedAgainstSource: z.number().int(),
            ratioAgainstSource: z.number(),
        }),
        save: saveOptionsSchema,
        iccProfile: iccProfileSchema,
        targets: z.array(targetResultSchema),
        excluded: z.array(exclusionSchema),
        render: z.strictObject({ ppi: z.number().int(), width: z.number().int(), height: z.number().int(), comparison: visualDiffResultSchema.shape.comparison }),
        workCopy: z.strictObject({ path: z.string(), removed: z.boolean() }),
        staging: z.strictObject({ directory: z.string(), removed: z.boolean() }),
        renderFilesRemoved: z.boolean(),
        sourcePreserved: z.literal(true),
        timing: z.strictObject({ totalMs: z.number().int().nonnegative(), hostMs: z.record(z.string(), z.number().int().nonnegative()) }),
    }),
    z.strictObject({
        outcome: z.literal('rejected'),
        reason: imageOptimizeRejectionReasonSchema,
        message: z.string(),
        document: documentContextSchema.nullable(),
        details: z.array(z.string()),
    }),
    z.strictObject({
        outcome: z.literal('failed'),
        reason: imageOptimizeFailureReasonSchema,
        stage: imageOptimizeStageSchema,
        message: z.string(),
        details: z.array(z.string()),
        files: filesSchema,
        save: saveOptionsSchema.nullable(),
    }),
    z.strictObject({
        outcome: z.literal('indeterminate'),
        stage: imageOptimizeStageSchema,
        message: z.string(),
        commandId: z.string().nullable(),
        files: filesSchema,
        save: saveOptionsSchema.nullable(),
        sessionId: z.string().nullable(),
    }),
]);
