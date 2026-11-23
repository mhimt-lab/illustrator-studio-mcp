import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { boundsSchema, documentContextSchema, layerPathSchema, layerStructuralReasonSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { BEARER_BAR_MODES, mmToPt } from '../barcode/layout.js';
import { BARCODE_BACKGROUNDS, BARCODE_SYMBOLOGIES, barcodeWarnings, hostLayout, resolveBarcode, symbolSummary, } from '../barcode/plan.js';
import { CREATE_RECTANGLE_MODULE_SCRIPT } from './create-rectangle/jsx.js';
import { EDIT_SESSION_CAPACITY_SCRIPT } from './edit-session-capacity-jsx.js';
import { mutationTransactionSchema } from './create-rectangle/result-schema.js';
import { sameCanonical } from './layer-ops-shared.js';
export const CREATE_BARCODE_OPERATION = 'create_barcode';
export const CREATE_BARCODE_VALIDATOR = { kind: CREATE_BARCODE_OPERATION, version: 1 };
const CANONICAL_VERSION = 1;
const RESULT_SCHEMA_VERSION = 2;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
export const BARCODE_EDGE_TOLERANCE_PT = 0.02;
const dataSchema = z.string({ error: 'BARCODE_NON_NUMERIC_DATA: data must be a JSON string of digits; a number may have lost digits.' }).max(64);
const hriSchema = z.strictObject({
    enabled: z.literal(true, { error: 'BARCODE_HRI_REQUIRED: the human-readable digits are mandatory; enabled:false is refused.' }).optional(),
});
const bearerBarSchema = z.strictObject({ mode: z.enum(BEARER_BAR_MODES) });
const commonPublic = {
    expected_document_key: z.string().min(1).max(16_384),
    expected_layer_path: layerPathSchema,
    artboard_index: z.number().int().safe().nonnegative(),
    x: z.number().finite().describe('Left edge of the symbol box (its left Quiet Zone, and a plate bearer bar, included), pt from the artboard\'s left.'),
    y: z.number().finite().describe('Top edge of the bars (itf14: of the top bearer bar), pt from the artboard\'s top.'),
    symbology: z.enum(BARCODE_SYMBOLOGIES).describe('ean13 = EAN-13 (JAN standard, GTIN-13); ean8 = EAN-8 (JAN short, GTIN-8); itf14 = GS1 ITF-14 (14 digits, bearer_bar required).'),
    data: dataSchema,
    check_digit: z.enum(['validate', 'calculate']).default('validate'),
    normalize_gtin13: z.enum(['reject', 'prefix_zero']).optional().describe('itf14 only: "prefix_zero" pads a complete GTIN-13 with a leading 0; default reject.'),
    magnification: z.number().finite().optional().describe('EAN only.'),
    x_dimension_mm: z.number().finite().optional().describe('EAN 0.264-0.66; itf14 0.635-1.016 (default 1.016).'),
    bearer_bar: bearerBarSchema.optional().describe('itf14 only, required: plate = 4.8 mm frame all round (usual form); non_plate = top and bottom bars of 2X.'),
    background: z.enum(BARCODE_BACKGROUNDS).default('white'),
    hri: hriSchema.optional(),
    name: z.string().max(255).optional(),
};
export const createBarcodePublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({ ...commonPublic, apply: z.literal(true), command_id: applyCommandIdSchema }),
]);
const inputSchema = z.strictObject({ ...commonPublic, apply: z.boolean().default(false), command_id: applyCommandIdSchema.optional() });
const { $schema: _dialect, ...publishedInputSchema } = z.toJSONSchema(createBarcodePublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
const finite = z.number().finite();
const internalFields = {
    expectedDocumentKey: z.string().min(1).max(16_384), expectedLayerPath: layerPathSchema, artboardIndex: z.number().int().safe().nonnegative(),
    x: finite, y: finite, symbology: z.enum(BARCODE_SYMBOLOGIES), data: dataSchema, checkDigit: z.enum(['validate', 'calculate']),
    normalizeGtin13: z.enum(['reject', 'prefix_zero']).optional(), bearerBar: z.enum(BEARER_BAR_MODES).optional(),
    magnification: finite.optional(), xDimensionMm: finite.optional(), background: z.enum(BARCODE_BACKGROUNDS),
    name: z.string().max(255).optional(),
};
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...internalFields, apply: z.literal(false) }),
    z.strictObject({ ...internalFields, apply: z.literal(true), commandId: canonicalCommandIdSchema }),
]);
function normalizePublicInput(input) {
    const value = createBarcodePublicInputSchema.parse(input);
    const common = {
        expectedDocumentKey: value.expected_document_key, expectedLayerPath: value.expected_layer_path, artboardIndex: value.artboard_index, x: value.x, y: value.y,
        symbology: value.symbology, data: value.data, checkDigit: value.check_digit, background: value.background,
        ...(value.normalize_gtin13 === undefined ? {} : { normalizeGtin13: value.normalize_gtin13 }),
        ...(value.bearer_bar === undefined ? {} : { bearerBar: value.bearer_bar.mode }),
        ...(value.magnification === undefined ? {} : { magnification: value.magnification }),
        ...(value.x_dimension_mm === undefined ? {} : { xDimensionMm: value.x_dimension_mm }),
        ...(value.name === undefined ? {} : { name: value.name }),
    };
    return value.apply ? { ...common, apply: true, commandId: value.command_id } : { ...common, apply: false };
}
function requestFields(request) {
    return { symbology: request.symbology, data: request.data, checkDigit: request.checkDigit, magnification: request.magnification, xDimensionMm: request.xDimensionMm,
        background: request.background, normalizeGtin13: request.normalizeGtin13, bearerBar: request.bearerBar };
}
const fillSchema = z.strictObject({ model: z.enum(['cmyk', 'rgb']), values: z.array(finite).min(3).max(4) });
const fillsFor = (colorSpace) => colorSpace === 'CMYK'
    ? { bar: { model: 'cmyk', values: [0, 0, 0, 100] }, background: { model: 'cmyk', values: [0, 0, 0, 0] } }
    : { bar: { model: 'rgb', values: [0, 0, 0] }, background: { model: 'rgb', values: [255, 255, 255] } };
const blockerSchema = z.enum(['layer_hidden', 'ancestor_hidden', 'layer_locked', 'ancestor_locked', 'document_mutation_not_allowed']);
const warningSchema = z.strictObject({ code: z.string().min(1).max(64), message: z.string().min(1).max(400) });
const planSchema = z.strictObject({
    operation: z.literal(CREATE_BARCODE_OPERATION),
    documentKey: z.string().min(1).max(16_384),
    coordinateSpace: z.literal('artboard_top_left'),
    unit: z.literal('pt'),
    artboardIndex: z.number().int().nonnegative(),
    artboardBounds: boundsSchema,
    targetBounds: boundsSchema,
    withinArtboard: z.boolean(),
    symbology: z.enum(BARCODE_SYMBOLOGIES),
    data: z.string().min(8).max(14),
    checkDigit: z.strictObject({ value: z.number().int().min(0).max(9), status: z.enum(['valid', 'calculated']) }),
    scale: z.strictObject({ magnification: finite.nullable(), xDimensionMm: finite }),
    symbol: z.strictObject({
        widthPt: finite, heightPt: finite, widthMm: finite, heightMm: finite,
        quietZoneMm: z.strictObject({ left: finite, right: finite }), rectangleCount: z.number().int().positive(), digitCount: z.number().int().positive(),
    }),
    background: z.enum(BARCODE_BACKGROUNDS),
    hri: z.strictObject({ mode: z.literal('outline_paths') }),
    itf14: z.strictObject({
        wideNarrowRatio: finite, barHeightMm: finite, symbolWidthMm: finite,
        bearerBar: z.strictObject({ mode: z.enum(BEARER_BAR_MODES), thicknessMm: finite }),
        normalization: z.strictObject({ rule: z.literal('prefix_zero'), input: z.string().length(13) }).nullable(),
    }).nullable(),
    colors: z.strictObject({ bar: fillSchema, background: fillSchema.nullable() }),
    targetLayer: z.strictObject({
        path: layerPathSchema, name: z.string(), visible: z.boolean(), locked: z.boolean(), effectiveVisible: z.boolean(), effectiveLocked: z.boolean(),
    }),
    layerSafetyReasonCodes: z.array(layerStructuralReasonSchema),
    applyBlockedReasonCodes: z.array(blockerSchema),
    applyAllowed: z.boolean(),
    warnings: z.array(warningSchema).max(8),
});
export const BARCODE_ECHO_TOLERANCE = 1e-6;
export const BARCODE_FILL_TOLERANCE = 0.001;
export function closeCanonical(left, right, tolerance = BARCODE_ECHO_TOLERANCE) {
    if (typeof left === 'number' && typeof right === 'number')
        return Math.abs(left - right) <= tolerance;
    if (Array.isArray(left) && Array.isArray(right))
        return left.length === right.length && left.every((value, index) => closeCanonical(value, right[index], tolerance));
    if (typeof left === 'object' && left !== null && typeof right === 'object' && right !== null && !Array.isArray(left) && !Array.isArray(right)) {
        const keys = Object.keys(left);
        return keys.length === Object.keys(right).length && keys.every((key) => key in right && closeCanonical(left[key], right[key], tolerance));
    }
    return left === right;
}
export function barcodePlanIssues(plan, colorSpace) {
    const issues = [];
    let resolved;
    try {
        resolved = resolveBarcode({ symbology: plan.symbology, data: plan.data, checkDigit: 'validate', xDimensionMm: plan.scale.xDimensionMm, background: plan.background,
            bearerBar: plan.itf14?.bearerBar.mode }, plan.scale);
        if (plan.itf14 !== null && plan.itf14.normalization !== null) {
            if (plan.data !== `0${plan.itf14.normalization.input}`)
                issues.push('itf14.normalization must be the 13-digit input with a leading 0 equal to data.');
            resolved = { ...resolved, itf14: { ...resolved.itf14, normalization: plan.itf14.normalization },
                warnings: barcodeWarnings({ symbology: plan.symbology, scale: plan.scale, background: plan.background, zeroPadded: true }) };
        }
    }
    catch (error) {
        return [`The plan request fields do not resolve: ${error instanceof Error ? error.message : String(error)}`];
    }
    if (resolved.gtin.checkDigit !== plan.checkDigit.value)
        issues.push('checkDigit.value must be the last digit of data.');
    if (!closeCanonical(plan.symbol, symbolSummary(resolved)))
        issues.push('symbol must derive from the module grid and scale.');
    if (!sameCanonical(plan.warnings, resolved.warnings))
        issues.push('warnings must derive from the request.');
    if (!closeCanonical(plan.hri, resolved.hri))
        issues.push('hri must be the outline numerals of the bundled font.');
    if (!closeCanonical(plan.itf14, resolved.itf14))
        issues.push('itf14 must derive from the grid, the bearer bar mode and the X-dimension (and exist for itf14 only).');
    const fills = fillsFor(colorSpace);
    if (!closeCanonical(plan.colors, { bar: fills.bar, background: plan.background === 'white' ? fills.background : null }, BARCODE_FILL_TOLERANCE))
        issues.push('colors must be black bars on white for the document color space.');
    const [left, top, right, bottom] = plan.targetBounds;
    if (Math.abs(right - left - plan.symbol.widthPt) > 1e-6 || Math.abs(top - bottom - plan.symbol.heightPt) > 1e-6)
        issues.push('targetBounds must have the symbol size.');
    const [al, at, ar, ab] = plan.artboardBounds;
    const within = left >= al - 0.01 && top <= at + 0.01 && right <= ar + 0.01 && bottom >= ab - 0.01;
    if (plan.withinArtboard !== within)
        issues.push('withinArtboard must derive from targetBounds and artboardBounds.');
    if (plan.applyAllowed !== (plan.applyBlockedReasonCodes.length === 0))
        issues.push('applyAllowed must reflect the blockers.');
    return issues;
}
const barcodeItemSchema = z.strictObject({
    uuid: z.string().min(1).max(255), type: z.literal('GroupItem'), name: z.string().max(255), bounds: boundsSchema,
    rectangleCount: z.number().int().positive(), digitCount: z.number().int().positive(),
    barFill: fillSchema, backgroundFill: fillSchema.nullable(),
    hriDigits: z.string().min(8).max(14), hriMode: z.literal('outline_paths'), maxEdgeErrorPt: finite.min(0),
});
export const createBarcodeResultSchema = z.union([
    z.strictObject({ applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: mutationTransactionSchema.options[0], hostError: z.string().max(500).optional() }),
    z.strictObject({ applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: mutationTransactionSchema.options[2], hostError: z.string().max(500).optional() }),
    z.strictObject({ applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: mutationTransactionSchema.options[3], hostError: z.string().max(500).optional() }),
    z.strictObject({ applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: mutationTransactionSchema.options[4], hostError: z.string().max(500).optional() }),
    z.strictObject({ applied: z.literal(true), document: documentContextSchema, plan: planSchema, item: barcodeItemSchema, transaction: mutationTransactionSchema.options[1] }),
]).superRefine((result, context) => {
    if (!mutationTransactionSchema.safeParse(result.transaction).success) {
        context.addIssue({ code: 'custom', message: 'Mutation transaction semantic invariants are invalid.', path: ['transaction'] });
    }
    for (const issue of barcodePlanIssues(result.plan, result.document.colorSpace))
        context.addIssue({ code: 'custom', message: issue, path: ['plan'] });
    if (result.transaction.state !== 'planned' && (!result.plan.applyAllowed || result.plan.applyBlockedReasonCodes.length !== 0)) {
        context.addIssue({ code: 'custom', message: 'An applied barcode must derive from an allowed plan.', path: ['plan'] });
    }
    if (result.applied) {
        const { item, plan } = result;
        if (item.rectangleCount !== plan.symbol.rectangleCount || item.digitCount !== plan.symbol.digitCount || item.hriDigits !== plan.data || item.hriMode !== plan.hri.mode ||
            !closeCanonical(item.barFill, plan.colors.bar, BARCODE_FILL_TOLERANCE) || !closeCanonical(item.backgroundFill, plan.colors.background, BARCODE_FILL_TOLERANCE) || item.maxEdgeErrorPt > BARCODE_EDGE_TOLERANCE_PT) {
            context.addIssue({ code: 'custom', message: 'A verified barcode must read back exactly as planned within the edge tolerance.', path: ['item'] });
        }
    }
});
const finalizedAtSchema = z.string().datetime({ offset: true });
export const createBarcodeResponseSchema = z.strictObject({ outcome: createBarcodeResultSchema, delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: finalizedAtSchema }) });
export const CREATE_BARCODE_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: CREATE_BARCODE_OPERATION,
    policy: {
        version: 1, class: 'create', destructive: false,
        evidence: { identity: 'native_uuid', ownership: 'self_created_only', postcondition: 'created_state_matches_plan' },
        preconditions: { documentBinding: 'explicit_document_key', targetValidation: 'same_execution_before_apply' },
        confirmation: 'risk_scoped',
        recovery: { mode: 'remove_self_created_uuid', verification: 'native_uuid_absent', unknownIdentity: 'indeterminate' },
        terminal: { success: 'verified', failure: 'proven_pre_apply_or_verified_recovery', partialSuccess: 'nonterminal_until_reconciled' },
        replay: { requestBinding: 'canonical_request_digest', retry: 'return_attested_terminal_result', beforeTerminal: 'reconcile_required', reapplyOnRetry: false },
    },
    capabilities: {
        class: 'create', explicitDocumentBinding: true, validateTargetsBeforeApply: true, captureNativeUuid: true, verifyCreatedState: true,
        rollbackSelfCreatedUuidOnly: true, verifyRollbackAbsence: true, reconcileIndeterminate: true, durableTerminalReplay: true, trustedTerminalAttestationResolver: true,
    },
});
export const CREATE_BARCODE_SAFETY_IDENTITY = canonicalDigest(CREATE_BARCODE_SAFETY);
function safetyPlan(result, requestDigest) {
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'create', operationId: CREATE_BARCODE_OPERATION, canonicalRequestDigest: requestDigest,
        evidence: { documentKey: result.plan.documentKey, targetLocator: `layer:${result.plan.targetLayer.path.join('.')};artboard:${result.plan.artboardIndex}` },
        preconditions: { status: result.plan.applyBlockedReasonCodes.length === 0 ? 'satisfied' : 'blocked', targetsValidated: result.plan.layerSafetyReasonCodes.length === 0 },
        confirmation: { kind: 'risk_scoped', status: 'not_required' },
        applyAllowed: result.plan.applyAllowed,
    });
}
function safetyResult(result, requestDigest, attestation) {
    const transaction = result.transaction;
    if (transaction.state === 'planned')
        throw new Error('A planned barcode has no terminal operation safety result.');
    const plan = safetyPlan(result, requestDigest);
    const replay = { status: 'durable_terminal', action: 'return_attested_result', reapply: false };
    if (result.applied && transaction.state === 'verified') {
        return operationSafetyResultSchema.parse({
            policyVersion: 1, operationClass: 'create', operationId: CREATE_BARCODE_OPERATION, canonicalRequestDigest: requestDigest, planDigest: plan.planDigest, attestation,
            evidence: { nativeUuid: result.item.uuid, ownership: 'self_created_only', postconditionVerified: true, outstandingEffect: null },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'succeeded', terminal: true, recovery: 'not_required', proof: { kind: 'verified_postcondition' }, replay },
        });
    }
    const nativeUuid = transaction.state === 'rolled_back' || transaction.state === 'rollback_failed' ? transaction.rollback.itemUuid : null;
    const status = transaction.state === 'rolled_back' ? 'recovered' : transaction.state === 'rollback_failed' ? 'recovery_failed' : 'failed';
    const recovery = transaction.state === 'rolled_back' ? 'verified' : transaction.state === 'rollback_failed' ? 'failed' : 'not_required';
    const proof = status === 'recovered' ? { kind: 'verified_recovery' }
        : status === 'recovery_failed' ? { kind: 'verified_outstanding_effect' } : { kind: 'proven_pre_apply', mutationAttempted: false };
    return operationSafetyResultSchema.parse({
        policyVersion: 1, operationClass: 'create', operationId: CREATE_BARCODE_OPERATION, canonicalRequestDigest: requestDigest, planDigest: plan.planDigest, attestation,
        evidence: { nativeUuid, ownership: 'self_created_only', postconditionVerified: false,
            outstandingEffect: status === 'recovery_failed' && nativeUuid !== null ? { kind: 'native_uuid_still_present', nativeUuid } : null },
        executionEvidence: { outcome: status === 'recovery_failed' ? 'recovery_failed' : status === 'failed' ? 'proven_pre_apply' : 'completed' },
        resolution: { status, terminal: true, recovery, ...(status === 'recovery_failed' ? { outstandingEffect: 'known_effect_present' } : {}), proof, replay },
    });
}
async function assertSafety(value, requestDigest, attestation, resolver) {
    const result = createBarcodeResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null)
        throw new Error('Barcode terminal result requires a durable attestation reference.');
    if (resolver === null)
        throw new Error('Barcode terminal result requires a trusted attestation resolver.');
    await assertOperationSafetyAdapterConformance({ registration: CREATE_BARCODE_SAFETY, plan, result: safetyResult(result, requestDigest, attestation) }, resolver);
}
export const CREATE_BARCODE_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${CREATE_RECTANGLE_MODULE_SCRIPT}${EDIT_SESSION_CAPACITY_SCRIPT}
var BARCODE_EDGE_TOLERANCE_PT = ${BARCODE_EDGE_TOLERANCE_PT};

var barcodeHostError = null;
/** Keeps the host's own words for the first exception of apply or verify: the transaction result carries only a generic message. */
function barcodeNote(stage, error) {
  var text = stage + ": " + String(error && error.message ? error.message : error);
  if (error && error.line !== undefined) text += " (line " + error.line + ")";
  if (error && error.number !== undefined) text += " [error " + error.number + "]";
  if (barcodeHostError === null) barcodeHostError = text.substring(0, 500);
}
function barcodeReject(code, message) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: code, message: message }));
}
function barcodeFill(context, kind) {
  var dark = kind === "dark";
  if (context.colorSpace === "CMYK") return { model: "cmyk", values: [0, 0, 0, dark ? 100 : 0] };
  if (context.colorSpace === "RGB") return { model: "rgb", values: dark ? [0, 0, 0] : [255, 255, 255] };
  barcodeReject("BARCODE_COLOR_SPACE_UNSUPPORTED", "Only CMYK and RGB documents are supported.");
}
function barcodeNativeColor(fill) {
  if (fill.model === "cmyk") { var c = new CMYKColor(); c.cyan = fill.values[0]; c.magenta = fill.values[1]; c.yellow = fill.values[2]; c.black = fill.values[3]; return c; }
  var r = new RGBColor(); r.red = fill.values[0]; r.green = fill.values[1]; r.blue = fill.values[2]; return r;
}
function barcodeReadFill(color) {
  var t = String(color.typename);
  if (t === "CMYKColor") return { model: "cmyk", values: [color.cyan, color.magenta, color.yellow, color.black] };
  if (t === "RGBColor") return { model: "rgb", values: [color.red, color.green, color.blue] };
  return { model: "other:" + t, values: [] };
}
function barcodeSameFill(left, right) {
  if (left.model !== right.model || left.values.length !== right.values.length) return false;
  for (var i = 0; i < left.values.length; i++) if (Math.abs(left.values[i] - right.values[i]) > 0.001) return false;
  return true;
}
function barcodeEdges(item) { var b = item.geometricBounds; return [b[0], b[1], b[2], b[3]]; }

/** Every item the symbol adds: the group, the background, the bearer bars, the bars, and per numeral one path or one compound path plus its contours. */
function barcodeItemCount() {
  var layout = params.layout;
  var count = 1 + (params.background === "white" ? 1 : 0) + layout.frame.length + layout.bars.length;
  for (var n = 0; n < layout.digits.length; n++) count += layout.digits[n][2].length > 1 ? 1 + layout.digits[n][2].length : 1;
  return count;
}

function barcodePreflight(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var doc = app.activeDocument;
  mutationFiniteNumber(params.x, "x");
  mutationFiniteNumber(params.y, "y");
  if (typeof params.artboardIndex !== "number" || !(params.artboardIndex >= 0) || Math.floor(params.artboardIndex) !== params.artboardIndex || params.artboardIndex >= doc.artboards.length) {
    throw mutationError("preflight_failed", "Invalid artboard index.");
  }
  var fills = { bar: barcodeFill(context, "dark"), background: params.background === "white" ? barcodeFill(context, "light") : null };
  var layerChain = mutationResolveLayerPath(doc, params.expectedLayerPath);
  var layerInspection = mutationInspectLayerChain(layerChain);
  var blockers = layerInspection.reasonCodes.slice(0);
  if (!context.mutationAllowed) blockers.push("document_mutation_not_allowed");
  var nativeArtboard = doc.artboards[params.artboardIndex].artboardRect;
  var artboardBounds = [];
  for (var b = 0; b < 4; b++) artboardBounds.push(mutationFiniteNumber(nativeArtboard[b], "artboardBounds[" + b + "]"));
  if (!(artboardBounds[0] < artboardBounds[2]) || !(artboardBounds[1] > artboardBounds[3])) throw mutationError("preflight_failed", "The selected artboard has degenerate bounds.");
  var left = artboardBounds[0] + params.x;
  var top = artboardBounds[1] - params.y;
  var targetBounds = [left, top, left + params.layout.widthPt, top - params.layout.heightPt];
  for (var t = 0; t < 4; t++) mutationFiniteNumber(targetBounds[t], "targetBounds[" + t + "]");
  if (forApply && blockers.length > 0) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "BARCODE_APPLY_BLOCKED", reasonCodes: blockers, layerPath: params.expectedLayerPath }));
  }
  if (forApply) sessionCapacityRefuse(context, barcodeItemCount(), "BARCODE_SESSION_TOO_LARGE", "The barcode");
  return { context: context, doc: doc, layerChain: layerChain, targetLayer: layerInspection.targetLayer, layerInspection: layerInspection, blockers: blockers,
    artboardBounds: artboardBounds, targetBounds: targetBounds, fills: fills };
}

function barcodePlan(preflight) {
  var inspection = preflight.layerInspection;
  return {
    operation: "create_barcode", documentKey: preflight.context.key, coordinateSpace: "artboard_top_left", unit: "pt", artboardIndex: params.artboardIndex,
    artboardBounds: preflight.artboardBounds, targetBounds: preflight.targetBounds, withinArtboard: rectangleWithinArtboard(preflight.targetBounds, preflight.artboardBounds),
    symbology: params.symbology, data: params.digits, checkDigit: params.checkDigit, scale: params.scale, symbol: params.symbol, background: params.background,
    hri: params.hri, itf14: params.itf14, colors: preflight.fills,
    targetLayer: { path: params.expectedLayerPath, name: preflight.targetLayer.name || "", visible: inspection.targetVisible, locked: inspection.targetLocked,
      effectiveVisible: inspection.ancestorVisible && inspection.targetVisible, effectiveLocked: inspection.ancestorLocked || inspection.targetLocked },
    layerSafetyReasonCodes: inspection.reasonCodes, applyBlockedReasonCodes: preflight.blockers, applyAllowed: preflight.blockers.length === 0, warnings: params.warnings
  };
}

function barcodeRevalidate(preflight, plan) {
  var current;
  try { current = barcodePreflight(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Barcode preconditions changed before apply.")); }
  if (current.doc !== preflight.doc || current.targetLayer !== preflight.targetLayer) throw mutationBeforeSideEffectError("The document or target layer identity changed before apply.");
  if (!mutationSameSequence(current.targetBounds, plan.targetBounds) || String(current.targetLayer.name || "") !== plan.targetLayer.name) {
    throw mutationBeforeSideEffectError("The barcode plan changed before apply.");
  }
}

function barcodeRememberUuid(state, item, direct) {
  var uuid = String(item.uuid);
  if (direct === true) state.operationState.direct += 1;
  if (uuid.length === 0) throw mutationError("apply_failed", "Illustrator did not return a valid native UUID.");
  state.operationState.uuids.push(uuid);
  return uuid;
}

function barcodeStyle(item, fill) {
  item.filled = true; item.fillColor = barcodeNativeColor(fill); item.stroked = false;
}
/** Builds one closed outline (points are [anchor x, y, left handle x, y, right handle x, y], y down from the symbol's top-left) into a path made by make. */
function barcodeOutline(make, contour, left, top) {
  var anchors = [];
  for (var p = 0; p < contour.length; p++) anchors.push([left + contour[p][0], top - contour[p][1]]);
  var path = make();
  path.setEntirePath(anchors);
  path.closed = true;
  for (var q = 0; q < contour.length; q++) {
    var point = path.pathPoints[q];
    if (contour[q][2] !== contour[q][0] || contour[q][3] !== contour[q][1]) point.leftDirection = [left + contour[q][2], top - contour[q][3]];
    if (contour[q][4] !== contour[q][0] || contour[q][5] !== contour[q][1]) point.rightDirection = [left + contour[q][4], top - contour[q][5]];
  }
  return path;
}

function barcodeApplyBody(preflight, plan, state) {
  var layout = params.layout;
  var left = plan.targetBounds[0];
  var top = plan.targetBounds[1];
  var group = preflight.targetLayer.groupItems.add();
  state.operationState.group = group;
  state.operationState.groupUuid = barcodeRememberUuid(state, group, false);
  group.name = params.name === undefined ? params.defaultName : params.name;
  if (plan.background === "white") {
    var background = group.pathItems.rectangle(top, left, layout.widthPt, layout.heightPt);
    barcodeRememberUuid(state, background, true);
    background.name = "bg"; barcodeStyle(background, preflight.fills.background);
  }
  for (var f = 0; f < layout.frame.length; f++) {
    var bearer = group.pathItems.rectangle(top - layout.frame[f][2], left + layout.frame[f][1], layout.frame[f][3], layout.frame[f][4]);
    barcodeRememberUuid(state, bearer, true);
    bearer.name = layout.frame[f][0]; barcodeStyle(bearer, preflight.fills.bar);
  }
  for (var i = 0; i < layout.bars.length; i++) {
    var bar = group.pathItems.rectangle(top - layout.barTopPt, left + layout.bars[i][0], layout.bars[i][1], layout.bars[i][2]);
    barcodeRememberUuid(state, bar, true);
    bar.name = "bar-" + i; barcodeStyle(bar, preflight.fills.bar);
  }
  for (var d = 0; d < layout.digits.length; d++) {
    var contours = layout.digits[d][2];
    if (contours.length === 1) {
      var glyph = barcodeOutline(function () { return group.pathItems.add(); }, contours[0], left, top);
      barcodeRememberUuid(state, glyph, true);
      glyph.name = "hri-" + d; barcodeStyle(glyph, preflight.fills.bar);
    } else {
      var compound = group.compoundPathItems.add();
      barcodeRememberUuid(state, compound, true);
      compound.name = "hri-" + d;
      for (var c = 0; c < contours.length; c++) {
        var sub = barcodeOutline(function () { return compound.pathItems.add(); }, contours[c], left, top);
        barcodeRememberUuid(state, sub, false);
        barcodeStyle(sub, preflight.fills.bar);
      }
    }
  }
  return group;
}

function barcodeAnchorsMatch(path, contour, left, top) {
  if (path.pathPoints.length !== contour.length || path.closed !== true) return false;
  for (var p = 0; p < contour.length; p++) {
    var point = path.pathPoints[p];
    var read = [point.anchor, point.leftDirection, point.rightDirection];
    for (var q = 0; q < 3; q++) {
      var ex = left + contour[p][2 * q]; var ey = top - contour[p][2 * q + 1];
      if (Math.abs(read[q][0] - ex) > BARCODE_EDGE_TOLERANCE_PT || Math.abs(read[q][1] - ey) > BARCODE_EDGE_TOLERANCE_PT) return false;
    }
  }
  return true;
}

function barcodeVerifyBody(preflight, plan, state) {
  var doc = mutationRequireSameDocument(preflight.doc);
  var inspection = mutationRequireSameLayer(doc, params.expectedLayerPath, preflight.targetLayer);
  if (inspection.reasonCodes.length > 0) throw mutationError("verify_mismatch", "The target layer or an ancestor became unsafe during verification.");
  var layout = params.layout;
  var group = mutationFindPageItemByUuid(doc, state.operationState.groupUuid);
  if (group === null || group !== state.operationState.group || String(group.uuid) !== state.operationState.groupUuid) {
    throw mutationError("verify_mismatch", "The created native UUID could not be resolved to the created group.");
  }
  if (String(group.typename) !== "GroupItem" || group.layer !== preflight.targetLayer || String(group.parent.typename) !== "Layer") {
    throw mutationError("verify_mismatch", "The created group has an unexpected type or parent.");
  }
  if (group.locked || group.hidden || String(group.note) !== "") throw mutationError("verify_mismatch", "The created group is locked, hidden or carries a note.");
  var rectangles = layout.bars.length + layout.frame.length + (plan.background === "white" ? 1 : 0);
  var compounds = 0;
  for (var n = 0; n < layout.digits.length; n++) if (layout.digits[n][2].length > 1) compounds += 1;
  var expectedPathItems = rectangles + layout.digits.length - compounds;
  if (group.pageItems.length !== rectangles + layout.digits.length || group.pathItems.length !== expectedPathItems ||
      group.compoundPathItems.length !== compounds || group.textFrames.length !== 0) {
    throw mutationError("verify_mismatch", "The created group does not hold exactly the planned rectangles and numerals.");
  }
  // Stacking: pageItems[0] is the front. A white background that is not the back-most item would hide the bars and numerals behind it.
  if (plan.background === "white" && String(group.pageItems[group.pageItems.length - 1].name) !== "bg") {
    throw mutationError("verify_mismatch", "The background rectangle is not the back-most item of the created group.");
  }
  var left = plan.targetBounds[0];
  var top = plan.targetBounds[1];
  var byName = {};
  for (var k = 0; k < group.pageItems.length; k++) byName[String(group.pageItems[k].name)] = group.pageItems[k];
  var maxError = 0;
  function checkPlain(item, name, fill) {
    if (item.filled !== true || item.stroked !== false || String(item.note) !== "" || item.locked || item.hidden) {
      throw mutationError("verify_mismatch", "A created shape (" + name + ") is not fill-only, plain and editable.");
    }
    var read = barcodeReadFill(item.fillColor);
    if (!barcodeSameFill(read, fill)) throw mutationError("verify_mismatch", "A created shape (" + name + ") has an unexpected fill.");
    return read;
  }
  function checkRect(item, name, expected, fill) {
    if (!item || String(item.typename) !== "PathItem" || item.parent !== group) throw mutationError("verify_mismatch", "A created rectangle (" + name + ") is missing or outside the group.");
    var edges = barcodeEdges(item);
    for (var e = 0; e < 4; e++) {
      var error = Math.abs(edges[e] - expected[e]);
      if (error > maxError) maxError = error;
      if (error > BARCODE_EDGE_TOLERANCE_PT) throw mutationError("verify_mismatch", "A created rectangle (" + name + ") does not match the module grid.");
    }
    return checkPlain(item, name, fill);
  }
  var backgroundFill = null;
  if (plan.background === "white") {
    backgroundFill = checkRect(byName["bg"], "bg", [left, top, left + layout.widthPt, top - layout.heightPt], preflight.fills.background);
  }
  var barFill = null;
  for (var f = 0; f < layout.frame.length; f++) {
    var rect = layout.frame[f];
    barFill = checkRect(byName[rect[0]], rect[0], [left + rect[1], top - rect[2], left + rect[1] + rect[3], top - rect[2] - rect[4]], preflight.fills.bar);
  }
  for (var i = 0; i < layout.bars.length; i++) {
    barFill = checkRect(byName["bar-" + i], "bar-" + i, [left + layout.bars[i][0], top - layout.barTopPt, left + layout.bars[i][0] + layout.bars[i][1], top - layout.barTopPt - layout.bars[i][2]], preflight.fills.bar);
  }
  var digits = "";
  for (var d = 0; d < layout.digits.length; d++) {
    var item = byName["hri-" + d];
    if (!item || item.parent !== group) throw mutationError("verify_mismatch", "A created numeral (hri-" + d + ") is missing or outside the group.");
    var contours = layout.digits[d][2];
    var subs = [];
    if (contours.length === 1) {
      if (String(item.typename) !== "PathItem") throw mutationError("verify_mismatch", "A created numeral outline is not a path.");
      subs.push(item);
    } else {
      if (String(item.typename) !== "CompoundPathItem" || item.pathItems.length !== contours.length) throw mutationError("verify_mismatch", "A created numeral outline is not the planned compound path.");
      for (var s = 0; s < item.pathItems.length; s++) subs.push(item.pathItems[s]);
    }
    var used = {};
    for (var c = 0; c < contours.length; c++) {
      var found = -1;
      for (var u = 0; u < subs.length; u++) if (used[u] !== true && barcodeAnchorsMatch(subs[u], contours[c], left, top)) { found = u; break; }
      if (found < 0) throw mutationError("verify_mismatch", "A created numeral outline does not read back at its planned points (hri-" + d + ").");
      used[found] = true;
    }
    checkPlain(subs[0], "hri-" + d, preflight.fills.bar);
    if (contours.length > 1) for (var t = 1; t < subs.length; t++) checkPlain(subs[t], "hri-" + d, preflight.fills.bar);
    digits += layout.digits[d][0];
  }
  if (digits !== params.digits) throw mutationError("verify_mismatch", "The numerals do not read back the encoded data.");
  return { uuid: state.operationState.groupUuid, type: "GroupItem", name: String(group.name), bounds: barcodeEdges(group), rectangleCount: rectangles, digitCount: layout.digits.length,
    barFill: barFill, backgroundFill: backgroundFill, hriDigits: digits, hriMode: "outline_paths", maxEdgeErrorPt: maxError };
}

function barcodeApply(preflight, plan, state) {
  try { return barcodeApplyBody(preflight, plan, state); } catch (error) { barcodeNote("apply", error); throw error; }
}
function barcodeVerify(preflight, plan, state) {
  try { return barcodeVerifyBody(preflight, plan, state); } catch (error) { barcodeNote("verify", error); throw error; }
}

function barcodeRollback(state) {
  var doc = state.preflight.doc;
  var group = state.operationState.group;
  var uuids = state.operationState.uuids;
  try {
    if (app.documents.length === 0 || app.activeDocument !== doc) return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
    mutationRequireSameLayer(doc, params.expectedLayerPath, state.preflight.targetLayer);
  } catch (lookupError) { return { status: "indeterminate", message: "Rollback target lookup is indeterminate." }; }
  if (!group || typeof state.operationState.groupUuid !== "string") return { status: "indeterminate", message: "Rollback cannot identify the created group." };
  var present;
  try { present = mutationCreatedObjectReferenceState(group, state.operationState.groupUuid); }
  catch (identityError) { return { status: "indeterminate", message: "Rollback object-identity lookup is indeterminate." }; }
  if (present === "mismatch") return { status: "indeterminate", message: "Rollback UUID changed while the created group reference remains valid." };
  if (present === "present") {
    try {
      if (String(group.typename) !== "GroupItem" || group.layer !== state.preflight.targetLayer || group.pageItems.length !== state.operationState.direct) {
        return { status: "indeterminate", message: "Rollback refused because the created group no longer holds exactly what this command created." };
      }
      group.remove();
    } catch (removeError) { return { status: "indeterminate", message: "Rollback removal is indeterminate." }; }
  }
  var unproved;
  try { unproved = esAbsenceUnproved(doc, uuids); } catch (scanError) { unproved = "scan_failed"; }
  if (unproved === null) return { status: "verified" };
  return { status: "indeterminate", message: "Rollback could not prove the created group and its items absent (" + unproved + ")." };
}

var barcodeExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionAffected: function (phase, preflight, plan, state, value) { return phase === "after" ? [value.uuid] : []; },
  editSessionLayers: function (phase, preflight) { return [preflight.targetLayer]; },
  initialOperationState: function () { return { group: null, groupUuid: null, uuids: [], direct: 0 }; },
  preflight: barcodePreflight,
  plan: barcodePlan,
  revalidate: barcodeRevalidate,
  applyMutation: barcodeApply,
  verify: barcodeVerify,
  rollback: barcodeRollback,
  hasMutationEvidence: function (state) { return state.operationState.group !== null && state.operationState.group !== undefined; },
  applyIndeterminate: function () {
    return { reasonCode: "identity_unavailable", message: "Apply outcome is indeterminate because created-object identity is unavailable.", evidence: { itemUuid: null } };
  },
  rollbackEvidence: function (state) {
    return { itemUuid: typeof state.operationState.groupUuid === "string" && state.operationState.groupUuid.length > 0 ? state.operationState.groupUuid : null };
  }
});
var barcodeDocument = barcodeExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === barcodeExecution.preflight.doc) barcodeDocument = getDocumentContext();
var result = barcodeExecution.transaction.state === "verified"
  ? { applied: true, document: barcodeDocument, plan: barcodeExecution.plan, item: barcodeExecution.value, transaction: barcodeExecution.transaction }
  : { applied: false, document: barcodeDocument, plan: barcodeExecution.plan, transaction: barcodeExecution.transaction };
if (barcodeExecution.transaction.state !== "verified" && barcodeHostError !== null) result.hostError = barcodeHostError;
`;
export const CREATE_BARCODE_HOST_SCRIPT_DIGEST = canonicalSha256(CREATE_BARCODE_SCRIPT);
export const CREATE_BARCODE_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: CREATE_BARCODE_OPERATION, validator: CREATE_BARCODE_VALIDATOR,
    canonicalContractVersion: CANONICAL_VERSION, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: CREATE_BARCODE_SAFETY_IDENTITY, hostScriptDigest: CREATE_BARCODE_HOST_SCRIPT_DIGEST,
});
export function barcodeDerivedFields(request) {
    const resolved = resolveBarcode(requestFields(request));
    const label = resolved.symbology === 'ean13' ? 'EAN-13' : resolved.symbology === 'ean8' ? 'EAN-8' : 'ITF-14';
    return {
        digits: resolved.gtin.digits, checkDigit: { value: resolved.gtin.checkDigit, status: resolved.gtin.checkDigitStatus },
        scale: { magnification: resolved.scale.magnification, xDimensionMm: resolved.scale.xDimensionMm },
        symbol: symbolSummary(resolved), layout: hostLayout(resolved), warnings: resolved.warnings, hri: resolved.hri, itf14: resolved.itf14,
        defaultName: `${label} ${resolved.gtin.digits}`,
    };
}
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    const derived = barcodeDerivedFields(request);
    const digestRequest = request.apply ? (({ commandId: _commandId, ...rest }) => rest)(request) : request;
    const digest = canonicalSha256({ operation: CREATE_BARCODE_OPERATION, validator: CREATE_BARCODE_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request: { ...request, ...derived }, commandId: request.apply ? request.commandId : null, documentKey: request.expectedDocumentKey, digest };
}
export function barcodeHostParams(request) {
    const { commandId: _commandId, ...params } = normalizedRequest(request).request;
    return params;
}
export const createBarcodeToolContract = {
    name: 'illustrator_create_barcode',
    title: 'Plan or Create a JAN / EAN / ITF-14 Barcode',
    description: 'Plan or draw an EAN-13 (ean13), EAN-8 (ean8) or ITF-14 (itf14) barcode as native vector in one new group at expected_layer_path. data is the GTIN digit string: check_digit "validate" (default) needs the complete number, "calculate" appends the check digit to the body. Nothing is normalized and GTINs are never assigned, so the caller supplies its own. Size: magnification (EAN, 0.8-2.0) or x_dimension_mm, not both. itf14 needs bearer_bar (plate or non_plate; never chosen for you). Numerals are always outlines (hri.enabled:false is refused). The plan returns the resolved GTIN, layout, warnings and a software decode of the planned bars. Apply verifies every edge and numeral by read-back and rolls back only its own group on a read-back mismatch; a raster decode mismatch is an error naming the group to remove. Not GS1 certification or print verification. Supports edit sessions: the created group, every bar and numeral outline, and the target layer\'s stacking order join the session head before one final save; a symbol that would push the session past its item limit is refused before any change. Inside a session a raster decode mismatch cannot be removed with illustrator_delete_objects: do not save, close the session, close the document without saving and reopen the saved file.',
    inputSchema,
    publicInputSchema: createBarcodePublicInputSchema,
    outputSchema: createBarcodeResponseSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    normalizePublicInput,
};
export function createCreateBarcodeAdapter() {
    return {
        version: 1, operation: CREATE_BARCODE_OPERATION, validator: CREATE_BARCODE_VALIDATOR,
        safety: CREATE_BARCODE_SAFETY, safetyRegistrationIdentity: CREATE_BARCODE_SAFETY_IDENTITY,
        adapterIdentity: CREATE_BARCODE_ADAPTER_IDENTITY, tool: createBarcodeToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: createBarcodeResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
        safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: CREATE_BARCODE_HOST_SCRIPT_DIGEST,
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: CREATE_BARCODE_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: CREATE_BARCODE_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: CREATE_BARCODE_OPERATION, documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: CREATE_BARCODE_ADAPTER_IDENTITY, script: CREATE_BARCODE_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = createBarcodeResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back' || state === 'rollback_failed')
                return { state };
            if (state === 'planned')
                throw new Error('An apply mutation result artifact cannot have transaction state planned.');
            throw new Error('Indeterminate mutation results cannot be compacted as terminal state.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error, detail) {
            if (detail?.code?.startsWith('BARCODE_')) {
                const reasons = detail.reasonCodes === undefined || detail.reasonCodes.length === 0 ? '' : ` (${detail.reasonCodes.join(', ')})`;
                return new Error(`${detail.code}: ${detail.message ?? (error instanceof Error ? error.message : String(error))}${reasons}`);
            }
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
export { mmToPt };
