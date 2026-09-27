import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema } from '../mutation-result-schema-core.js';
import { canonicalDigest, operationSafetyPolicyToMcpAnnotations } from '../operation-safety-policy-core.js';
import { LAYER_OPS_HOST_SCRIPT } from './layer-ops-host-script.js';
import { classifyLayerTerminal, containerTargetSchema, insertSibling, layerBlockers, layerBlockerSchema, layerDocumentKeySchema, layerIdentityToken, layerNameSchema, layerPathSchema, layerSafetyAsserter, layerSafetyRegistration, layerTransactionSchema, sameCanonical, siblingEntrySchema, siblingOrderSchema, } from './layer-ops-shared.js';
import { shiftPathForInsert } from './create-layer-adapter.js';
import { mapLayerExecutionError } from './reorder-layer-adapter.js';
export const CREATE_TRIM_MARKS_OPERATION = 'create_trim_marks';
export const CREATE_TRIM_MARKS_VALIDATOR = { kind: CREATE_TRIM_MARKS_OPERATION, version: 1 };
const CANONICAL_VERSION = 1;
const RESULT_SCHEMA_VERSION = 1;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
export const TRIM_MARKS_MAX_COORDINATE_PT = 16_383;
export const TRIM_MARKS_TOLERANCE_PT = 0.001;
export const TRIM_MARKS_DEFAULT_LAYER_NAME = 'Trim Marks';
const TRIM_MARK_CORNERS = ['TL', 'TR', 'BL', 'BR'];
const lengthSchema = (max) => z.number().finite().nonnegative().max(max);
export const trimMarksSpecSchema = z.strictObject({
    bleedPt: lengthSchema(72),
    offsetPt: lengthSchema(288),
    lengthPt: z.number().finite().positive().max(288),
    strokeWidthPt: z.number().finite().positive().max(10),
    lines: z.enum(['trim', 'trim_and_bleed']),
}).superRefine((spec, context) => {
    if (spec.offsetPt < spec.bleedPt)
        context.addIssue({ code: 'custom', message: 'offset_pt must be at least bleed_pt, so no mark enters the bleed area.' });
});
const publicSpecSchema = z.strictObject({
    bleed_pt: lengthSchema(72).describe('Bleed distance outside the trim edge (0 when there is none).'),
    offset_pt: lengthSchema(288).describe('Gap from the trim edge to where each mark starts; at least bleed_pt.'),
    length_pt: z.number().finite().positive().max(288).describe('Length of each mark line.'),
    stroke_width_pt: z.number().finite().positive().max(10),
    lines: z.enum(['trim', 'trim_and_bleed']).describe('trim: one line per side at each corner, on the trim edge. trim_and_bleed: a second line on the bleed edge (double corner marks).'),
}).superRefine((spec, context) => {
    if (spec.offset_pt < spec.bleed_pt)
        context.addIssue({ code: 'custom', message: 'offset_pt must be at least bleed_pt, so no mark enters the bleed area.' });
});
export const trimMarkLineSchema = z.strictObject({ id: z.string().min(1).max(32), anchors: z.array(z.array(z.number().finite()).length(2)).length(2) });
const artboardRectSchema = z.array(z.number().finite()).length(4);
export function planTrimMarkLines(rect, spec) {
    const [left, top, right, bottom] = rect;
    const corners = [[left, top, -1, 1], [right, top, 1, 1], [left, bottom, -1, -1], [right, bottom, 1, -1]];
    const edges = spec.lines === 'trim_and_bleed' ? [['trim', 0], ['bleed', spec.bleedPt]] : [['trim', 0]];
    const lines = [];
    corners.forEach(([x, y, sx, sy], corner) => {
        for (const [edge, distance] of edges) {
            const near = spec.offsetPt;
            const far = spec.offsetPt + spec.lengthPt;
            lines.push({ id: `${TRIM_MARK_CORNERS[corner]}_${edge}_h`, anchors: [[x + sx * near, y + sy * distance], [x + sx * far, y + sy * distance]] });
            lines.push({ id: `${TRIM_MARK_CORNERS[corner]}_${edge}_v`, anchors: [[x + sx * distance, y + sy * near], [x + sx * distance, y + sy * far]] });
        }
    });
    return lines;
}
export function trimMarksLayerEntry(name) {
    return { name, visible: true, locked: false, printable: true, childLayerCount: 0, pageItemCount: 1 };
}
const commonInternal = { expectedDocumentKey: layerDocumentKeySchema, artboardIndex: z.number().int().nonnegative(), marks: trimMarksSpecSchema, layerName: layerNameSchema };
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({ ...commonInternal, expectedContainerBefore: containerTargetSchema, expectedSiblingOrder: siblingOrderSchema, expectedArtboardRect: artboardRectSchema,
        apply: z.literal(true), commandId: canonicalCommandIdSchema }),
]);
const commonPublic = { expected_document_key: layerDocumentKeySchema, artboard_index: z.number().int().nonnegative(), marks: publicSpecSchema,
    layer_name: layerNameSchema.default(TRIM_MARKS_DEFAULT_LAYER_NAME) };
export const createTrimMarksPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({ ...commonPublic, expected_container_before: containerTargetSchema, expected_sibling_order: siblingOrderSchema, expected_artboard_rect: artboardRectSchema,
        apply: z.literal(true), command_id: applyCommandIdSchema }),
]);
const inputSchema = z.strictObject({ ...commonPublic, expected_container_before: containerTargetSchema.optional(), expected_sibling_order: siblingOrderSchema.optional(),
    expected_artboard_rect: artboardRectSchema.optional(), apply: z.boolean().default(false), command_id: applyCommandIdSchema.optional() });
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(createTrimMarksPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = createTrimMarksPublicInputSchema.parse(input);
    const marks = { bleedPt: value.marks.bleed_pt, offsetPt: value.marks.offset_pt, lengthPt: value.marks.length_pt, strokeWidthPt: value.marks.stroke_width_pt, lines: value.marks.lines };
    const common = { expectedDocumentKey: value.expected_document_key, artboardIndex: value.artboard_index, marks, layerName: value.layer_name };
    return value.apply
        ? { ...common, expectedContainerBefore: value.expected_container_before, expectedSiblingOrder: value.expected_sibling_order, expectedArtboardRect: value.expected_artboard_rect,
            apply: true, commandId: value.command_id }
        : { ...common, apply: false };
}
const registrationSchema = z.strictObject({ name: z.string().max(1024), colorType: z.literal('ColorModel.REGISTRATION') });
const planSchema = z.strictObject({
    operation: z.literal(CREATE_TRIM_MARKS_OPERATION),
    documentKey: layerDocumentKeySchema,
    artboardIndex: z.number().int().nonnegative(),
    artboardRect: artboardRectSchema,
    marks: trimMarksSpecSchema,
    layerName: layerNameSchema,
    registration: registrationSchema,
    plannedLines: z.array(trimMarkLineSchema).min(8).max(16),
    containerBefore: containerTargetSchema,
    siblingOrderBefore: siblingOrderSchema,
    siblingOrderAfter: siblingOrderSchema,
    createdLayer: siblingEntrySchema,
    createdLayerPath: layerPathSchema,
    activeLayerPathBefore: layerPathSchema,
    activeLayerPathAfter: layerPathSchema,
    applyBlockedReasonCodes: z.array(layerBlockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    if (plan.containerBefore.path.length !== 0 || plan.containerBefore.childLayerCount !== plan.siblingOrderBefore.length) {
        context.addIssue({ code: 'custom', message: 'Trim-marks plan must bind the document root with its complete layer order.' });
    }
    const [left, top, right, bottom] = plan.artboardRect;
    if (!(left < right) || !(top > bottom))
        context.addIssue({ code: 'custom', message: 'Trim-marks plan artboard rect is degenerate.' });
    if (!sameCanonical(plan.plannedLines, planTrimMarkLines(plan.artboardRect, plan.marks)))
        context.addIssue({ code: 'custom', message: 'Trim-marks plan lines must derive from the artboard rect and marks.' });
    if (plan.plannedLines.some((line) => line.anchors.some((anchor) => anchor.some((value) => Math.abs(value) > TRIM_MARKS_MAX_COORDINATE_PT)))) {
        context.addIssue({ code: 'custom', message: 'Trim-marks plan lines must stay on the canvas.' });
    }
    if (!sameCanonical(plan.createdLayer, trimMarksLayerEntry(plan.layerName)) || !sameCanonical(plan.createdLayerPath, [0])) {
        context.addIssue({ code: 'custom', message: 'Trim-marks plan must create one front root layer holding one group.' });
    }
    if (plan.siblingOrderBefore.some((entry) => entry.name === plan.layerName))
        context.addIssue({ code: 'custom', message: 'Trim-marks plan layer name must be unused at the root.' });
    try {
        if (!sameCanonical(insertSibling(plan.siblingOrderBefore, 0, plan.createdLayer), plan.siblingOrderAfter))
            context.addIssue({ code: 'custom', message: 'Trim-marks plan after order must insert exactly the new layer.' });
    }
    catch {
        context.addIssue({ code: 'custom', message: 'Trim-marks plan after order cannot be derived.' });
    }
    if (!sameCanonical(shiftPathForInsert(plan.activeLayerPathBefore, [], 0), plan.activeLayerPathAfter))
        context.addIssue({ code: 'custom', message: 'Trim-marks plan must derive the active layer path after insertion.' });
    if (plan.applyAllowed !== (plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0))
        context.addIssue({ code: 'custom', message: 'Trim-marks applyAllowed must require confirmation and no blockers.' });
});
const createdLineSchema = z.strictObject({ id: z.string().min(1).max(32), uuid: z.string().min(1).max(64) });
const postconditionSchema = z.strictObject({
    siblingOrder: siblingOrderSchema, createdLayerPath: layerPathSchema, activeLayerPath: layerPathSchema,
    groupUuid: z.string().min(1).max(64), lines: z.array(createdLineSchema).min(8).max(16),
});
const rollbackEvidence = { restoredSiblingOrder: siblingOrderSchema.nullable(), createdLayerRemoved: z.boolean() };
const transactionSchema = layerTransactionSchema('create_trim_marks', rollbackEvidence, { restoredSiblingOrder: null, createdLayerRemoved: false }, (evidence) => evidence.restoredSiblingOrder !== null && evidence.createdLayerRemoved);
export const createTrimMarksResultSchema = z.union([
    z.strictObject({ operation: z.literal(CREATE_TRIM_MARKS_OPERATION), applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ operation: z.literal(CREATE_TRIM_MARKS_OPERATION), applied: z.literal(true), document: documentContextSchema, plan: planSchema, postcondition: postconditionSchema, transaction: transactionSchema }),
]).superRefine((result, context) => {
    const expectedBlockers = layerBlockers(result.transaction.state === 'planned' ? result.document.mutationAllowed : true, result.plan.containerBefore, { targetStateBlocks: false, targetIsAncestor: true });
    if (result.transaction.state === 'planned') {
        if (result.plan.confirmationStatus !== 'required' || !sameCanonical(result.plan.applyBlockedReasonCodes, expectedBlockers))
            context.addIssue({ code: 'custom', message: 'Planned trim marks must expose exact blockers.' });
    }
    else if (result.plan.confirmationStatus !== 'confirmed' || result.plan.applyBlockedReasonCodes.length !== 0 || !result.plan.applyAllowed || expectedBlockers.length !== 0) {
        context.addIssue({ code: 'custom', message: 'Applied trim marks must derive from an allowed confirmed plan.' });
    }
    if (result.applied) {
        const post = result.postcondition;
        const uuids = new Set([post.groupUuid, ...post.lines.map((line) => line.uuid)]);
        if (result.transaction.state !== 'verified' || !sameCanonical(post.siblingOrder, result.plan.siblingOrderAfter) || !sameCanonical(post.createdLayerPath, result.plan.createdLayerPath) ||
            !sameCanonical(post.activeLayerPath, result.plan.activeLayerPathAfter) || !sameCanonical(post.lines.map((line) => line.id), result.plan.plannedLines.map((line) => line.id)) ||
            uuids.size !== post.lines.length + 1) {
            context.addIssue({ code: 'custom', message: 'Verified trim marks must match the planned order, lines, restored active layer and distinct UUIDs.' });
        }
    }
    else if (result.transaction.state === 'verified')
        context.addIssue({ code: 'custom', message: 'Verified trim marks must be applied.' });
    if (result.transaction.state === 'rolled_back' && !sameCanonical(result.transaction.rollback.restoredSiblingOrder, result.plan.siblingOrderBefore)) {
        context.addIssue({ code: 'custom', message: 'Rolled-back trim marks must prove the exact baseline layer order.' });
    }
});
export const createTrimMarksResponseSchema = z.strictObject({ outcome: createTrimMarksResultSchema, delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }) });
export const CREATE_TRIM_MARKS_SAFETY = layerSafetyRegistration(CREATE_TRIM_MARKS_OPERATION);
export const CREATE_TRIM_MARKS_SAFETY_IDENTITY = canonicalDigest(CREATE_TRIM_MARKS_SAFETY);
const assertSafety = layerSafetyAsserter(CREATE_TRIM_MARKS_SAFETY, (value) => {
    const result = createTrimMarksResultSchema.parse(value);
    const plan = result.plan;
    return {
        operationId: CREATE_TRIM_MARKS_OPERATION, documentKey: result.document.key, identityToken: layerIdentityToken(plan.containerBefore, plan.siblingOrderBefore),
        beforeState: { container: plan.containerBefore, siblingOrder: plan.siblingOrderBefore, activeLayerPath: plan.activeLayerPathBefore, artboardRect: plan.artboardRect },
        afterState: { container: { ...plan.containerBefore, childLayerCount: plan.containerBefore.childLayerCount + 1 }, siblingOrder: plan.siblingOrderAfter,
            activeLayerPath: plan.activeLayerPathAfter, artboardRect: plan.artboardRect, lines: plan.plannedLines },
        changeSet: { operation: CREATE_TRIM_MARKS_OPERATION, layerName: plan.layerName, artboardIndex: plan.artboardIndex, marks: plan.marks, registration: plan.registration },
        blocked: plan.applyBlockedReasonCodes.length > 0, confirmationStatus: plan.confirmationStatus, applyAllowed: plan.applyAllowed,
        transactionState: result.transaction.state, applied: result.applied,
    };
});
export const CREATE_TRIM_MARKS_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${LAYER_OPS_HOST_SCRIPT}

var TRIM_MARKS_MAX_COORDINATE_PT = ${TRIM_MARKS_MAX_COORDINATE_PT};
var TRIM_MARKS_TOLERANCE_PT = ${TRIM_MARKS_TOLERANCE_PT};
var TRIM_MARK_CORNERS = ${JSON.stringify(TRIM_MARK_CORNERS)};

/** Identical to planTrimMarkLines in TypeScript. */
function trimMarksPlanLines(rect, spec) {
  var corners = [[rect[0], rect[1], -1, 1], [rect[2], rect[1], 1, 1], [rect[0], rect[3], -1, -1], [rect[2], rect[3], 1, -1]];
  var edges = [["trim", 0]];
  if (spec.lines === "trim_and_bleed") edges.push(["bleed", spec.bleedPt]);
  var lines = [];
  for (var corner = 0; corner < corners.length; corner++) {
    var x = corners[corner][0], y = corners[corner][1], sx = corners[corner][2], sy = corners[corner][3];
    for (var edgeIndex = 0; edgeIndex < edges.length; edgeIndex++) {
      var distance = edges[edgeIndex][1];
      var near = spec.offsetPt;
      var far = spec.offsetPt + spec.lengthPt;
      var prefix = TRIM_MARK_CORNERS[corner] + "_" + edges[edgeIndex][0];
      lines.push({ id: prefix + "_h", anchors: [[x + sx * near, y + sy * distance], [x + sx * far, y + sy * distance]] });
      lines.push({ id: prefix + "_v", anchors: [[x + sx * distance, y + sy * near], [x + sx * distance, y + sy * far]] });
    }
  }
  return lines;
}
function trimMarksArtboardRect(document, artboardIndex) {
  if (typeof artboardIndex !== "number" || Math.floor(artboardIndex) !== artboardIndex || artboardIndex < 0 || artboardIndex >= document.artboards.length) {
    throw mutationError("preflight_failed", "The requested artboard does not exist in the bound document.");
  }
  var rect = document.artboards[artboardIndex].artboardRect;
  if (!rect || rect.length !== 4) throw mutationError("preflight_failed", "The requested artboard rectangle is unavailable.");
  var bounds = [mutationFiniteNumber(rect[0], "artboardRect[0]"), mutationFiniteNumber(rect[1], "artboardRect[1]"),
    mutationFiniteNumber(rect[2], "artboardRect[2]"), mutationFiniteNumber(rect[3], "artboardRect[3]")];
  if (!(bounds[0] < bounds[2]) || !(bounds[1] > bounds[3])) throw mutationError("preflight_failed", "The selected artboard has degenerate bounds.");
  return bounds;
}
/** The document's single built-in Registration spot, found by colorType (its name is localized). */
function trimMarksRegistration(document) {
  var found = [];
  for (var index = 0; index < document.spots.length; index++) {
    var spot = document.spots[index];
    if (String(spot.colorType) === String(ColorModel.REGISTRATION)) found.push(spot);
  }
  if (found.length !== 1) throw mutationError("preflight_failed", "The document must have exactly one Registration swatch; found " + found.length + ".");
  return found[0];
}
function trimMarksResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  // artboardRect and setEntirePath share one frame only in document coordinates; under the artboard system the anchors
  // would move while their read-back (same frame) still matched, so any other system is refused before any write.
  if (String(app.coordinateSystem) !== String(CoordinateSystem.DOCUMENTCOORDINATESYSTEM)) {
    throw mutationError("preflight_failed", "app.coordinateSystem must be DOCUMENTCOORDINATESYSTEM (measured frame of artboardRect and path anchors); found " + String(app.coordinateSystem) + ".");
  }
  if (!layerOpsValidName(params.layerName)) throw mutationError("preflight_failed", "layer_name must not be empty, padded with whitespace, or contain control characters.");
  var rect = trimMarksArtboardRect(document, params.artboardIndex);
  var registration = trimMarksRegistration(document);
  var snapshot = layerOpsContainerSnapshot(document, [], []);
  var orderBefore = layerOpsOrder(document);
  if (orderBefore.length >= LAYER_OPS_MAX_SIBLINGS) throw mutationError("preflight_failed", "The document already holds the maximum number of root layers.");
  for (var existing = 0; existing < orderBefore.length; existing++) {
    if (orderBefore[existing].name === params.layerName) throw mutationError("preflight_failed", "A root layer named layer_name already exists; trim marks may already be in the document. Choose another layer_name only if a second set is intended.");
  }
  var lines = trimMarksPlanLines(rect, params.marks);
  for (var line = 0; line < lines.length; line++) {
    for (var point = 0; point < 2; point++) {
      if (Math.abs(lines[line].anchors[point][0]) > TRIM_MARKS_MAX_COORDINATE_PT || Math.abs(lines[line].anchors[point][1]) > TRIM_MARKS_MAX_COORDINATE_PT) {
        throw mutationError("preflight_failed", "A planned trim mark leaves the canvas.");
      }
    }
  }
  var entry = { name: params.layerName, visible: true, locked: false, printable: true, childLayerCount: 0, pageItemCount: 1 };
  var orderAfter = layerOpsInsert(orderBefore, 0, entry);
  var activeLayer = document.activeLayer;
  var activePath = layerOpsPathOfLayer(document, activeLayer);
  if (activePath === null) throw mutationError("preflight_failed", "The active layer could not be located in the document layer tree.");
  var blockers = layerOpsBlockers(context, snapshot, false, true);
  if (forApply) {
    if (!layerOpsSameTarget(snapshot, params.expectedContainerBefore)) throw mutationError("preflight_failed", "Document root does not match expected_container_before.");
    if (!layerOpsSameOrder(orderBefore, params.expectedSiblingOrder)) throw mutationError("preflight_failed", "Root layer order does not match expected_sibling_order.");
    if (!mutationSameSequence(rect, params.expectedArtboardRect)) throw mutationError("preflight_failed", "Artboard rect does not match expected_artboard_rect.");
    if (blockers.length > 0) throw new Error("MCP_ERROR:" + stringifyJson({ code: "LAYER_APPLY_BLOCKED", reasonCodes: blockers, layerPath: [] }));
  }
  return { context: context, document: document, rect: rect, registration: registration, snapshot: snapshot, orderBefore: orderBefore, orderAfter: orderAfter, entry: entry,
    lines: lines, activeLayer: activeLayer, activePath: activePath, blockers: blockers };
}
function trimMarksShiftedActivePath(path) { var shifted = path.slice(0); shifted[0] = path[0] + 1; return shifted; }
function trimMarksPlan(preflight) {
  return { operation: "create_trim_marks", documentKey: preflight.context.key, artboardIndex: params.artboardIndex, artboardRect: preflight.rect, marks: params.marks,
    layerName: params.layerName, registration: { name: String(preflight.registration.name), colorType: String(preflight.registration.colorType) }, plannedLines: preflight.lines,
    containerBefore: preflight.snapshot, siblingOrderBefore: preflight.orderBefore, siblingOrderAfter: preflight.orderAfter, createdLayer: preflight.entry, createdLayerPath: [0],
    activeLayerPathBefore: preflight.activePath, activeLayerPathAfter: trimMarksShiftedActivePath(preflight.activePath), applyBlockedReasonCodes: preflight.blockers,
    confirmationStatus: params.apply === true ? "confirmed" : "required", applyAllowed: params.apply === true && preflight.blockers.length === 0 };
}
function trimMarksRevalidate(preflight, plan) {
  var current;
  try { current = trimMarksResolve(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Trim-marks preconditions changed before apply.")); }
  if (current.document !== preflight.document || current.activeLayer !== preflight.activeLayer || !layerOpsSameTarget(current.snapshot, plan.containerBefore) ||
      !layerOpsSameOrder(current.orderBefore, plan.siblingOrderBefore) || !mutationSameSequence(current.activePath, plan.activeLayerPathBefore) ||
      !mutationSameSequence(current.rect, plan.artboardRect)) {
    throw mutationBeforeSideEffectError("Root layers, active layer, or artboard changed before apply.");
  }
}
function trimMarksApply(preflight, plan, state) {
  var operationState = state.operationState;
  operationState.mutationStarted = true;
  var layer = preflight.document.layers.add();
  operationState.layer = layer;
  layer.name = params.layerName;
  var group = layer.groupItems.add();
  operationState.group = group;
  group.name = "Trim Marks " + (params.artboardIndex + 1);
  for (var index = 0; index < plan.plannedLines.length; index++) {
    var line = group.pathItems.add();
    operationState.lines.push(line);
    line.setEntirePath(plan.plannedLines[index].anchors);
    line.closed = false; line.filled = false; line.stroked = true; line.strokeWidth = params.marks.strokeWidthPt;
    var paint = new SpotColor(); paint.spot = preflight.registration; paint.tint = 100;
    line.strokeColor = paint;
    line.name = "Trim " + plan.plannedLines[index].id;
  }
  preflight.document.activeLayer = preflight.activeLayer;
  return { created: true };
}
function trimMarksNear(left, right) { return Math.abs(left - right) <= TRIM_MARKS_TOLERANCE_PT; }
function trimMarksVerifyLine(line, planned, groupUuid) {
  if (String(line.typename) !== "PathItem") throw mutationError("verify_mismatch", "A created trim mark is not a path.");
  if (String(line.parent.typename) !== "GroupItem" || String(line.parent.uuid) !== groupUuid) throw mutationError("verify_mismatch", "A created trim mark is not in the created group.");
  if (line.pathPoints.length !== 2 || line.closed !== false || line.filled !== false || line.stroked !== true) throw mutationError("verify_mismatch", "A created trim mark is not a stroked open two-point path.");
  for (var point = 0; point < 2; point++) {
    var anchor = line.pathPoints[point].anchor;
    var left = line.pathPoints[point].leftDirection;
    var right = line.pathPoints[point].rightDirection;
    var expected = planned.anchors[point];
    if (!trimMarksNear(anchor[0], expected[0]) || !trimMarksNear(anchor[1], expected[1]) || !trimMarksNear(left[0], expected[0]) || !trimMarksNear(left[1], expected[1]) ||
        !trimMarksNear(right[0], expected[0]) || !trimMarksNear(right[1], expected[1])) {
      throw mutationError("verify_mismatch", "A created trim mark does not read back at its planned anchors.");
    }
  }
  if (!trimMarksNear(line.strokeWidth, params.marks.strokeWidthPt)) throw mutationError("verify_mismatch", "A created trim mark stroke width does not match the plan.");
  var stroke = line.strokeColor;
  if (String(stroke.typename) !== "SpotColor" || String(stroke.spot.colorType) !== String(ColorModel.REGISTRATION) || stroke.tint !== 100) {
    throw mutationError("verify_mismatch", "A created trim mark is not stroked with Registration at tint 100.");
  }
  return String(line.uuid);
}
function trimMarksVerify(preflight, plan, state) {
  layerOpsRequireSameDocument(preflight.document, "verify_mismatch");
  var operationState = state.operationState;
  var order = layerOpsOrder(preflight.document);
  if (!layerOpsSameOrder(order, plan.siblingOrderAfter)) throw mutationError("verify_mismatch", "Root layer order does not match the planned order after creation.");
  if (preflight.document.layers[0] !== operationState.layer) throw mutationError("verify_mismatch", "The created layer is not the front root layer.");
  var group = operationState.group;
  var groupUuid = String(group.uuid);
  if (String(operationState.layer.pageItems[0].uuid) !== groupUuid || String(group.parent.typename) !== "Layer") throw mutationError("verify_mismatch", "The created group is not the only item of the created layer.");
  if (group.pageItems.length !== plan.plannedLines.length || operationState.lines.length !== plan.plannedLines.length) throw mutationError("verify_mismatch", "The created group does not hold exactly the planned lines.");
  var created = [];
  var seen = {};
  seen[groupUuid] = true;
  for (var index = 0; index < plan.plannedLines.length; index++) {
    var uuid = trimMarksVerifyLine(operationState.lines[index], plan.plannedLines[index], groupUuid);
    if (seen[uuid] === true) throw mutationError("verify_mismatch", "Created trim marks do not have distinct UUIDs.");
    seen[uuid] = true;
    if (String(preflight.document.getPageItemFromUuid(uuid).uuid) !== uuid) throw mutationError("verify_mismatch", "A created trim mark does not resolve by UUID.");
    created.push({ id: plan.plannedLines[index].id, uuid: uuid });
  }
  if (preflight.document.activeLayer !== preflight.activeLayer) throw mutationError("verify_mismatch", "The active layer was not restored.");
  var activePath = layerOpsPathOfLayer(preflight.document, preflight.document.activeLayer);
  if (activePath === null || !mutationSameSequence(activePath, plan.activeLayerPathAfter)) throw mutationError("verify_mismatch", "The restored active layer path does not match the plan.");
  return { siblingOrder: order, createdLayerPath: [0], activeLayerPath: activePath, groupUuid: groupUuid, lines: created };
}
/** Removes only what this command created (the group, then its still otherwise-empty layer), restores the active layer and proves the baseline order. */
function trimMarksRollback(state) {
  var preflight = state.preflight;
  var operationState = state.operationState;
  var layer = operationState.layer;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
  if (!layer) return { status: "indeterminate", message: "Rollback refused because the created layer reference was not captured." };
  var index;
  try { index = layerOpsIndexOfRef(preflight.document.layers, layer); } catch (e) { return { status: "indeterminate", message: "Rollback layer lookup is indeterminate." }; }
  if (index < 0 || preflight.document.layers.length !== preflight.orderBefore.length + 1) return { status: "indeterminate", message: "Rollback refused because the root does not hold exactly the baseline plus the created layer." };
  var group = operationState.group;
  try {
    if (layer.layers.length !== 0) return { status: "indeterminate", message: "Rollback refused because the created layer holds sublayers." };
    if (group) {
      var groupUuid = String(group.uuid);
      if (layer.pageItems.length !== 1 || String(layer.pageItems[0].uuid) !== groupUuid) return { status: "indeterminate", message: "Rollback refused because the created layer holds foreign items." };
      if (group.pageItems.length !== operationState.lines.length) return { status: "indeterminate", message: "Rollback refused because the created group holds foreign items." };
    } else if (layer.pageItems.length !== 0) return { status: "indeterminate", message: "Rollback refused because the created layer holds foreign items." };
  } catch (readError) { return { status: "indeterminate", message: "Rollback refused because the created contents are unreadable." }; }
  try { if (group) group.remove(); layer.remove(); } catch (removeError) { return { status: "indeterminate", message: "Rollback removal is indeterminate." }; }
  operationState.rollbackEvidence.createdLayerRemoved = true;
  try { preflight.document.activeLayer = preflight.activeLayer; } catch (activeError) { return { status: "indeterminate", message: "Rollback active-layer restore is indeterminate." }; }
  var restoredOrder;
  try { restoredOrder = layerOpsOrder(preflight.document); } catch (e) { return { status: "indeterminate", message: "Rollback verification is indeterminate." }; }
  operationState.rollbackEvidence.restoredSiblingOrder = restoredOrder;
  if (!layerOpsSameOrder(restoredOrder, preflight.orderBefore)) return { status: "failed", message: "Rollback did not restore the exact baseline root layer order." };
  if (preflight.document.activeLayer !== preflight.activeLayer) return { status: "failed", message: "Rollback did not restore the active layer." };
  return { status: "verified" };
}

var trimMarksExecution = runMutationTransaction({
  apply: params.apply === true,
  initialOperationState: function () { return { mutationStarted: false, layer: null, group: null, lines: [], rollbackEvidence: { restoredSiblingOrder: null, createdLayerRemoved: false } }; },
  preflight: trimMarksResolve,
  plan: trimMarksPlan,
  revalidate: trimMarksRevalidate,
  applyMutation: trimMarksApply,
  verify: trimMarksVerify,
  rollback: trimMarksRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () { return { reasonCode: "layer_state_unknown", message: "Trim-marks apply outcome is indeterminate.", evidence: { restoredSiblingOrder: null, createdLayerRemoved: false } }; },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});
var trimMarksDocument = trimMarksExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === trimMarksExecution.preflight.document) trimMarksDocument = getDocumentContext();
var result = { operation: "create_trim_marks", applied: trimMarksExecution.transaction.state === "verified", document: trimMarksDocument, plan: trimMarksExecution.plan, transaction: trimMarksExecution.transaction };
if (trimMarksExecution.transaction.state === "verified") result.postcondition = trimMarksExecution.value;
`;
export const CREATE_TRIM_MARKS_HOST_SCRIPT_DIGEST = canonicalSha256(CREATE_TRIM_MARKS_SCRIPT);
export const CREATE_TRIM_MARKS_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: CREATE_TRIM_MARKS_OPERATION, validator: CREATE_TRIM_MARKS_VALIDATOR,
    canonicalContractVersion: CANONICAL_VERSION, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: CREATE_TRIM_MARKS_SAFETY_IDENTITY, hostScriptDigest: CREATE_TRIM_MARKS_HOST_SCRIPT_DIGEST,
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    const digestRequest = 'commandId' in request ? (({ commandId: _commandId, ...rest }) => rest)(request) : request;
    const digest = canonicalSha256({ operation: CREATE_TRIM_MARKS_OPERATION, validator: CREATE_TRIM_MARKS_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: 'commandId' in request ? request.commandId : null, documentKey: request.expectedDocumentKey, digest };
}
export const createTrimMarksToolContract = {
    name: 'illustrator_create_trim_marks',
    title: 'Plan or Create Trim Marks on an Artboard',
    description: 'Plan or apply drawing editable trim marks (crop marks) as paths in the document around one artboard (artboard_index, 0-based). '
        + 'This is for marks that must exist in the .ai itself; for marks only in a PDF use illustrator_export_pdf trim_marks instead, and never both for the same output (double marks). '
        + 'Every dimension is an explicit point value (1 mm = 72/25.4 pt); there is no Japanese/Western preset, so take bleed, offset and length from the print provider. '
        + 'At each artboard corner one horizontal and one vertical line run outward from offset_pt to offset_pt + length_pt on the trim edge, and with lines "trim_and_bleed" also on the bleed edge (8 or 16 lines). '
        + 'The lines go into one group on a new front root layer (layer_name, default "Trim Marks"; refused if a root layer of that name exists), stroked with the document\'s Registration swatch at tint 100, geometry from the artboard rect only. '
        + 'The plan binds the root layer order, the active layer and the artboard rect and lists every planned line. Apply compares and sets them, restores the active layer (the selection is not touched), and verifies every anchor, the stroke and the UUIDs by native read-back; on failure only the created group and layer are removed and the baseline order is proved. '
        + 'Created UUIDs are not durable across a later save. Not available inside an edit session.',
    inputSchema,
    publicInputSchema: createTrimMarksPublicInputSchema,
    outputSchema: createTrimMarksResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(CREATE_TRIM_MARKS_SAFETY.policy),
    normalizePublicInput,
};
export function createCreateTrimMarksAdapter() {
    return {
        version: 1, operation: CREATE_TRIM_MARKS_OPERATION, validator: CREATE_TRIM_MARKS_VALIDATOR,
        safety: CREATE_TRIM_MARKS_SAFETY, safetyRegistrationIdentity: CREATE_TRIM_MARKS_SAFETY_IDENTITY,
        adapterIdentity: CREATE_TRIM_MARKS_ADAPTER_IDENTITY, tool: createTrimMarksToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: createTrimMarksResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
        safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: CREATE_TRIM_MARKS_HOST_SCRIPT_DIGEST,
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: CREATE_TRIM_MARKS_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: CREATE_TRIM_MARKS_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: CREATE_TRIM_MARKS_OPERATION, documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: CREATE_TRIM_MARKS_ADAPTER_IDENTITY, script: CREATE_TRIM_MARKS_SCRIPT, params };
        },
        classifyTerminal(value) { return classifyLayerTerminal(createTrimMarksResultSchema.parse(value).transaction.state, 'Create-trim-marks'); },
        assertSafetyConformance: assertSafety,
        mapExecutionError: mapLayerExecutionError,
    };
}
