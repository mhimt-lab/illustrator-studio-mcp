import { z } from 'zod';
import { MUTATION_TRANSACTION_SCRIPT } from './mutation-transaction.js';
import { documentContextSchema, layerPathSchema } from './mutation-result-schema-core.js';
import { POINT_TEXT_APPLY_BLOCKERS, POINT_TEXT_BLOCKERS_SCRIPT, POINT_TEXT_SNAPSHOT_SCRIPT, } from './adapters/point-text-host-script.js';
import { AREA_TEXT_MAX_CODE_UNITS, AREA_TEXT_MAX_LAYER_DEPTH_LIMIT, AREA_TEXT_SNAPSHOT_SCRIPT, } from './adapters/area-text-host-script.js';
export const areaColumnsBlockerSchema = z.enum(POINT_TEXT_APPLY_BLOCKERS);
export const areaTextOptionsSchema = z.strictObject({
    columnCount: z.number().int().min(1),
    columnGutter: z.number().finite(),
    rowCount: z.number().int().min(1),
    rowGutter: z.number().finite(),
    flowLinksHorizontally: z.boolean(),
});
const areaColumnsFitSchema = z.strictObject({
    status: z.enum(['fits', 'overflows']),
    visibleCharacterCount: z.number().int().nonnegative(),
    storyCharacterCount: z.number().int().nonnegative(),
});
export function fitConsistent(fit) {
    return (fit.status === 'fits') === (fit.visibleCharacterCount === fit.storyCharacterCount) &&
        fit.visibleCharacterCount <= fit.storyCharacterCount;
}
const layerAncestorSchema = z.strictObject({
    name: z.string().max(255),
    visible: z.boolean(),
    locked: z.boolean(),
});
export const areaColumnsSnapshotSchema = z.strictObject({
    uuid: z.string().min(1).max(255),
    type: z.literal('TextFrame'),
    kind: z.literal('TextType.AREATEXT'),
    orientation: z.literal('TextOrientation.HORIZONTAL'),
    frameShape: z.literal('area_text_unthreaded'),
    options: areaTextOptionsSchema,
    geometricBounds: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]),
    matrix: z.strictObject({
        a: z.number().finite(), b: z.number().finite(), c: z.number().finite(),
        d: z.number().finite(), tx: z.number().finite(), ty: z.number().finite(),
    }),
    contents: z.string().max(AREA_TEXT_MAX_CODE_UNITS),
    fit: areaColumnsFitSchema,
    layerPath: layerPathSchema,
    layerAncestry: z.array(layerAncestorSchema).min(1).max(AREA_TEXT_MAX_LAYER_DEPTH_LIMIT),
    locked: z.boolean(),
    hidden: z.boolean(),
    editable: z.boolean(),
});
export const AREA_COLUMNS_READ_SCRIPT = `
var AREA_COLUMNS_OPTION_ORDER = ["columnCount", "columnGutter", "rowCount", "rowGutter", "flowLinksHorizontally"];

function areaColumnsFailTarget(uuid, actual) {
  throw mutationError("preflight_failed", stringifyJson({ code: "AREA_COLUMNS_TARGET_UNSUPPORTED", uuid: uuid, actual: actual }));
}

function areaColumnsResolve(document, uuid) {
  var target = pointTextFind(document, uuid);
  if (target === null) {
    throw mutationError("preflight_failed", stringifyJson({ code: "OBJECT_NOT_FOUND", uuid: uuid }));
  }
  return target;
}

function areaColumnsOptions(target) {
  var values = {};
  try {
    values.columnCount = target.columnCount; values.columnGutter = target.columnGutter;
    values.rowCount = target.rowCount; values.rowGutter = target.rowGutter;
    values.flowLinksHorizontally = target.flowLinksHorizontally;
  } catch (optionError) { areaColumnsFailTarget(params.targetUuid, "area_options_unreadable"); }
  var columnCount = mutationFiniteNumber(values.columnCount, "columnCount");
  var rowCount = mutationFiniteNumber(values.rowCount, "rowCount");
  if (Math.floor(columnCount) !== columnCount || columnCount < 1 || Math.floor(rowCount) !== rowCount || rowCount < 1) {
    areaColumnsFailTarget(params.targetUuid, "area_options_out_of_range");
  }
  if (typeof values.flowLinksHorizontally !== "boolean") areaColumnsFailTarget(params.targetUuid, "area_options_unreadable");
  return { columnCount: columnCount, columnGutter: mutationFiniteNumber(values.columnGutter, "columnGutter"),
    rowCount: rowCount, rowGutter: mutationFiniteNumber(values.rowGutter, "rowGutter"),
    flowLinksHorizontally: values.flowLinksHorizontally };
}

/** Everything the tools report, with the fit status as proved (including "indeterminate") and the line count. */
function areaColumnsRead(document, target, expectedUuid) {
  if (!target || target.typename !== "TextFrame") areaColumnsFailTarget(expectedUuid, "not_text_frame:" + String(target.typename));
  if (target.kind !== TextType.AREATEXT) areaColumnsFailTarget(expectedUuid, "not_area_text:" + String(target.kind));
  if (typeof target.uuid !== "string" || target.uuid !== expectedUuid) {
    throw mutationError("preflight_failed", "Target native UUID is unavailable or changed.");
  }
  if (!target.layer || target.parent !== target.layer) areaColumnsFailTarget(expectedUuid, "not_layer_direct");
  // Threading has no measured inverse (measured operation), so a threaded story is outside this operation.
  if (!target.story || !target.story.textFrames ||
      target.story.textFrames.length !== 1 || target.story.textFrames[0] !== target) {
    areaColumnsFailTarget(expectedUuid, "threaded");
  }
  var orientation;
  try { orientation = String(target.orientation); }
  catch (orientationError) { areaColumnsFailTarget(expectedUuid, "orientation_unreadable"); }
  // Only horizontal frames were measured.
  if (orientation !== "TextOrientation.HORIZONTAL") areaColumnsFailTarget(expectedUuid, "orientation:" + orientation);
  if (typeof target.locked !== "boolean" || typeof target.hidden !== "boolean" || typeof target.editable !== "boolean") {
    throw mutationError("preflight_failed", "Target safety state is unavailable.");
  }
  var contents = String(target.contents);
  if (contents.length > AREA_TEXT_MAX_CODE_UNITS) areaColumnsFailTarget(expectedUuid, "contents_too_long");
  var bounds;
  var matrix;
  try { bounds = target.geometricBounds; matrix = target.matrix; }
  catch (frameError) { throw mutationError("preflight_failed", "Target frame bounds are unavailable."); }
  if (!bounds || typeof bounds.length !== "number" || bounds.length !== 4) {
    throw mutationError("preflight_failed", "Target frame bounds are unavailable.");
  }
  var layerPath = pointTextLayerPath(document, target.layer);
  if (layerPath === null) throw mutationError("preflight_failed", "Target layer path is unavailable.");
  var fit = areaTextFit(target, contents);
  return {
    uuid: target.uuid, type: "TextFrame", kind: "TextType.AREATEXT", orientation: orientation,
    frameShape: "area_text_unthreaded",
    options: areaColumnsOptions(target),
    geometricBounds: [
      mutationFiniteNumber(bounds[0], "geometricBounds[0]"), mutationFiniteNumber(bounds[1], "geometricBounds[1]"),
      mutationFiniteNumber(bounds[2], "geometricBounds[2]"), mutationFiniteNumber(bounds[3], "geometricBounds[3]")
    ],
    matrix: {
      a: mutationFiniteNumber(matrix.mValueA, "matrix.a"), b: mutationFiniteNumber(matrix.mValueB, "matrix.b"),
      c: mutationFiniteNumber(matrix.mValueC, "matrix.c"), d: mutationFiniteNumber(matrix.mValueD, "matrix.d"),
      tx: mutationFiniteNumber(matrix.mValueTX, "matrix.tx"), ty: mutationFiniteNumber(matrix.mValueTY, "matrix.ty")
    },
    contents: contents,
    fit: { status: fit.status, visibleCharacterCount: fit.visibleCharacterCount,
      storyCharacterCount: fit.requestedCharacterCount,
      lineCount: typeof fit.lineCount === "number" && isFinite(fit.lineCount) ? fit.lineCount : -1 },
    layerPath: layerPath,
    layerAncestry: pointTextAncestry(target),
    locked: target.locked, hidden: target.hidden, editable: target.editable
  };
}
`;
export const GET_AREA_TEXT_OPTIONS_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${POINT_TEXT_SNAPSHOT_SCRIPT}
${POINT_TEXT_BLOCKERS_SCRIPT}
${AREA_TEXT_SNAPSHOT_SCRIPT}
${AREA_COLUMNS_READ_SCRIPT}
var areaReadContext = requireDocumentForRead(params.expectedDocumentKey);
var areaReadDocument = app.activeDocument;
var areaReadTarget = areaColumnsRead(areaReadDocument, areaColumnsResolve(areaReadDocument, params.targetUuid), params.targetUuid);
var result = { document: areaReadContext, target: areaReadTarget,
  editBlockedReasonCodes: pointTextBlockers(areaReadContext, areaReadTarget) };
`;
export const getAreaTextOptionsResultSchema = z.strictObject({
    document: documentContextSchema,
    target: areaColumnsSnapshotSchema.omit({ fit: true, contents: true }).extend({
        contents: z.string().max(AREA_TEXT_MAX_CODE_UNITS),
        fit: z.strictObject({
            status: z.enum(['fits', 'overflows', 'indeterminate']),
            visibleCharacterCount: z.number().int().min(-1),
            storyCharacterCount: z.number().int().nonnegative(),
            lineCount: z.number().int().min(-1),
        }),
    }),
    editBlockedReasonCodes: z.array(areaColumnsBlockerSchema),
});
export function areaColumnsErrorMessage(detail) {
    if (detail?.code === 'OBJECT_NOT_FOUND')
        return `No PageItem with UUID ${JSON.stringify(detail.uuid ?? '')} exists in the bound document.`;
    if (detail?.code === 'AREA_COLUMNS_TARGET_UNSUPPORTED') {
        return `The item with UUID ${JSON.stringify(detail.uuid ?? '')} is not a supported area-text target `
            + `(${detail.actual ?? 'unsupported'}). Only an unthreaded, horizontal AREATEXT frame directly on a layer `
            + `with at most ${AREA_TEXT_MAX_CODE_UNITS} UTF-16 code units is supported.`;
    }
    if (detail?.code === 'AREA_TEXT_FIT_INDETERMINATE') {
        return `The visible text of ${JSON.stringify(detail.uuid ?? '')} could not be proved against its story `
            + `(${detail.actual ?? 'indeterminate'}), so its layout is not edited.`;
    }
    if (detail?.code === 'AREA_COLUMNS_APPLY_BLOCKED') {
        return `Area-text column edit is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}.`;
    }
    return null;
}
