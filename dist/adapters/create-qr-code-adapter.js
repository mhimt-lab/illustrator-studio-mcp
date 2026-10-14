import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { boundsSchema, documentContextSchema, layerPathSchema, layerStructuralReasonSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { CREATION_APPEARANCE_MODULE_SCRIPT } from './create-appearance.js';
import { CREATE_RECTANGLE_MODULE_SCRIPT } from './create-rectangle/jsx.js';
import { QR_ERROR_CORRECTION_LEVELS, QR_MAX_VERSION, QR_MIN_QUIET_ZONE_MODULES, QR_MIN_VERSION, QrMatrixError } from '../qr/matrix.js';
import { QR_ENCODER_IDENTITY, resolveQr } from '../qr/plan.js';
export const CREATE_QR_CODE_OPERATION = 'create_qr_code';
export const CREATE_QR_CODE_VALIDATOR = { kind: CREATE_QR_CODE_OPERATION, version: 1 };
const CANONICAL_VERSION = 1;
const RESULT_SCHEMA_VERSION = 1;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
export const QR_COORDINATE_TOLERANCE_PT = 0.01;
export const QR_MAX_QUIET_ZONE_MODULES = 32;
export const QR_MAX_CONTENT_LENGTH = 7200;
export const QR_GROUP_NAME = 'QR Code';
export const QR_MODULES_NAME = 'QR Code modules';
export const QR_BACKGROUND_NAME = 'QR Code background';
const QR_BACKGROUNDS = ['white', 'transparent'];
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const uuidSchema = z.string().min(1).max(255);
const colorSchema = z.strictObject({ model: z.enum(['CMYK', 'RGB']), values: z.array(z.number().finite()).min(3).max(4) });
const planSchema = z.strictObject({
    operation: z.literal(CREATE_QR_CODE_OPERATION),
    documentKey: z.string().min(1).max(16_384),
    coordinateSpace: z.literal('artboard_top_left'),
    unit: z.literal('pt'),
    artboardIndex: z.number().int().nonnegative(),
    symbol: z.strictObject({
        contentSha256: sha256Schema, contentBytes: z.number().int().positive(), version: z.number().int().min(QR_MIN_VERSION).max(QR_MAX_VERSION),
        modules: z.number().int().positive(), errorCorrection: z.enum(QR_ERROR_CORRECTION_LEVELS), mask: z.number().int().min(0).max(7), encoder: z.string().max(200),
    }),
    quietZoneModules: z.number().int().min(QR_MIN_QUIET_ZONE_MODULES).max(QR_MAX_QUIET_ZONE_MODULES),
    background: z.enum(QR_BACKGROUNDS),
    geometry: z.strictObject({
        sizePt: z.number().positive().finite(), modulePt: z.number().positive().finite(), moduleMm: z.number().positive().finite(),
        symbolBounds: boundsSchema, moduleBounds: boundsSchema, artboardBounds: boundsSchema, withinArtboard: z.boolean(),
    }),
    items: z.strictObject({ rectangles: z.number().int().positive(), darkModules: z.number().int().positive(), compoundPaths: z.literal(1), backgroundRectangle: z.boolean() }),
    colors: z.strictObject({ space: z.enum(['CMYK', 'RGB']), foreground: colorSchema, background: colorSchema.nullable() }),
    targetLayer: z.strictObject({
        path: layerPathSchema, name: z.string(), visible: z.boolean(), locked: z.boolean(), effectiveVisible: z.boolean(), effectiveLocked: z.boolean(), itemCount: z.number().int().nonnegative(),
    }),
    layerSafetyReasonCodes: z.array(layerStructuralReasonSchema),
    applyBlockedReasonCodes: z.array(z.enum(['layer_hidden', 'ancestor_hidden', 'layer_locked', 'ancestor_locked', 'document_mutation_not_allowed'])),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    if (plan.applyAllowed !== (plan.applyBlockedReasonCodes.length === 0))
        context.addIssue({ code: 'custom', message: 'QR applyAllowed must require no blockers.', path: ['applyAllowed'] });
    if (plan.items.backgroundRectangle !== (plan.background === 'white') || (plan.colors.background === null) !== (plan.background === 'transparent')) {
        context.addIssue({ code: 'custom', message: 'QR background rectangle and colour must follow the background setting.' });
    }
    if (plan.symbol.modules !== 17 + 4 * plan.symbol.version)
        context.addIssue({ code: 'custom', message: 'QR module count must follow the version.' });
});
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']),
    reasonCode: z.enum(['apply_failed', 'verify_mismatch']),
    message: z.string().min(1).max(500),
}).superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed'))
        context.addIssue({ code: 'custom', message: 'QR failure phase and reason code must match.' });
});
const indeterminateFailureSchema = z.strictObject({ phase: z.literal('apply'), reasonCode: z.literal('apply_indeterminate'), message: z.string().min(1).max(500) });
const rollbackEvidence = { createdUuid: uuidSchema.nullable(), restoredItemCount: z.number().int().nonnegative().nullable() };
const transactionSchema = z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('planned'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('verified'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('apply_failed'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('not_required') }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('rolled_back'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('verified'), ...rollbackEvidence }), audit: mutationAuditSchema }),
    z.strictObject({
        state: z.literal('rollback_failed'), failure: failureSchema,
        rollback: z.strictObject({ status: z.literal('failed'), reasonCode: z.literal('rollback_failed'), message: z.string().min(1).max(500), ...rollbackEvidence }), audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('apply_indeterminate'), failure: indeterminateFailureSchema,
        rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('created_state_unknown'), message: z.string().min(1).max(500), createdUuid: z.null(), restoredItemCount: z.null() }), audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rollback_indeterminate'), failure: failureSchema,
        rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('rollback_indeterminate'), message: z.string().min(1).max(500), ...rollbackEvidence }), audit: mutationAuditSchema,
    }),
]).superRefine((transaction, context) => {
    const prefix = ['preflight:started:', 'preflight:succeeded:', 'plan:started:', 'plan:succeeded:'];
    let expected;
    if (transaction.state === 'planned') {
        expected = [...prefix, 'apply:skipped:not_requested', 'verify:skipped:not_requested', 'rollback:skipped:not_requested'];
    }
    else if (transaction.state === 'verified') {
        expected = [...prefix, 'apply:started:', 'apply:attempted:', 'apply:succeeded:', 'verify:started:', 'verify:succeeded:', 'rollback:skipped:not_required'];
    }
    else if (transaction.state === 'apply_failed') {
        expected = [...prefix, 'apply:started:', 'apply:failed:apply_failed', 'verify:skipped:not_required', 'rollback:skipped:not_required'];
    }
    else if (transaction.state === 'apply_indeterminate') {
        expected = [...prefix, 'apply:started:', 'apply:attempted:', 'apply:failed:apply_indeterminate'];
    }
    else {
        const failure = transaction.failure.phase === 'apply'
            ? ['apply:started:', 'apply:attempted:', 'apply:failed:apply_failed', 'verify:skipped:not_required']
            : ['apply:started:', 'apply:attempted:', 'apply:succeeded:', 'verify:started:', 'verify:failed:verify_mismatch'];
        expected = [...prefix, ...failure, 'rollback:started:', transaction.state === 'rolled_back' ? 'rollback:succeeded:'
                : `rollback:failed:${transaction.state === 'rollback_failed' ? 'rollback_failed' : 'rollback_indeterminate'}`];
    }
    const actual = transaction.audit.map((event) => `${event.phase}:${event.event}:${'reasonCode' in event ? event.reasonCode : ''}`);
    if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index]))
        context.addIssue({ code: 'custom', message: 'QR audit sequence does not match transaction state.' });
    transaction.audit.forEach((event, index) => { if (event.sequence !== index)
        context.addIssue({ code: 'custom', message: 'QR audit sequence must be contiguous.' }); });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' && event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode && event.message === transaction.failure.message);
        if (matches.length !== 1)
            context.addIssue({ code: 'custom', message: 'QR failure must match one audit event.' });
    }
});
const createdSchema = z.strictObject({
    uuid: uuidSchema, name: z.string().max(255), bounds: boundsSchema, moduleBounds: boundsSchema, rectangleCount: z.number().int().positive(),
    backgroundRectangle: z.boolean(), containerUuid: uuidSchema, selectionBefore: z.number().int().nonnegative(), selectionAfter: z.number().int().nonnegative(),
});
export const createQrCodeResultSchema = z.union([
    z.strictObject({ operation: z.literal(CREATE_QR_CODE_OPERATION), applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ operation: z.literal(CREATE_QR_CODE_OPERATION), applied: z.literal(true), document: documentContextSchema, plan: planSchema, created: createdSchema, transaction: transactionSchema }),
]).superRefine((result, context) => {
    if (result.transaction.state === 'planned') {
        const blockers = [...result.plan.layerSafetyReasonCodes, ...(result.document.mutationAllowed ? [] : ['document_mutation_not_allowed'])];
        if (canonicalSha256(result.plan.applyBlockedReasonCodes) !== canonicalSha256(blockers)) {
            context.addIssue({ code: 'custom', message: 'Planned QR creation must expose exact blockers.' });
        }
    }
    else if (result.plan.applyBlockedReasonCodes.length !== 0 || !result.plan.applyAllowed) {
        context.addIssue({ code: 'custom', message: 'Applied QR creation must derive from an allowed plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified')
            context.addIssue({ code: 'custom', message: 'A created QR code must come from a verified transaction.' });
        if (result.created.rectangleCount !== result.plan.items.rectangles || result.created.backgroundRectangle !== result.plan.items.backgroundRectangle || result.created.uuid === result.created.containerUuid) {
            context.addIssue({ code: 'custom', message: 'A created QR code must match the planned rectangles and have distinct UUIDs.' });
        }
    }
    else if (result.transaction.state === 'verified')
        context.addIssue({ code: 'custom', message: 'A verified QR creation must report the created item.' });
});
export const createQrCodeResponseSchema = z.strictObject({
    outcome: createQrCodeResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
const contentSchema = z.string().min(1).max(QR_MAX_CONTENT_LENGTH);
const quietZoneMessage = `QR_QUIET_ZONE_TOO_SMALL: quiet_zone_modules must be an integer from ${QR_MIN_QUIET_ZONE_MODULES} to ${QR_MAX_QUIET_ZONE_MODULES}; fewer than ${QR_MIN_QUIET_ZONE_MODULES} modules is refused.`;
const canonicalNumberSchema = z.number().finite().transform((value) => Object.is(value, -0) ? 0 : value);
const commonInternal = {
    expectedDocumentKey: z.string().min(1).max(16_384), expectedLayerPath: layerPathSchema, artboardIndex: z.number().int().safe().nonnegative(),
    x: canonicalNumberSchema, y: canonicalNumberSchema, sizePt: canonicalNumberSchema.pipe(z.number().positive()),
    content: contentSchema, errorCorrection: z.enum(QR_ERROR_CORRECTION_LEVELS),
    version: z.union([z.literal('auto'), z.number().int().min(QR_MIN_VERSION).max(QR_MAX_VERSION)]),
    quietZoneModules: z.number().int().min(QR_MIN_QUIET_ZONE_MODULES, quietZoneMessage).max(QR_MAX_QUIET_ZONE_MODULES, quietZoneMessage),
    background: z.enum(QR_BACKGROUNDS),
    encoder: z.literal(QR_ENCODER_IDENTITY),
    contentSha256: sha256Schema, contentBytes: z.number().int().positive(),
    matrix: z.strictObject({ hex: z.string().regex(/^[0-9a-f]+$/u), modules: z.number().int().positive(), version: z.number().int().min(QR_MIN_VERSION).max(QR_MAX_VERSION),
        mask: z.number().int().min(0).max(7), runCount: z.number().int().positive(), darkModules: z.number().int().positive() }),
};
function derivedFacts(request) {
    const resolved = resolveForRequest(request);
    return { contentSha256: resolved.contentSha256, contentBytes: resolved.contentBytes,
        matrix: { hex: resolved.matrixHex, modules: resolved.matrix.modules, version: resolved.matrix.version, mask: resolved.matrix.mask, runCount: resolved.runs.length, darkModules: resolved.darkModules } };
}
function checkDerived(request, context) {
    let expected;
    try {
        expected = derivedFacts(request);
    }
    catch (error) {
        context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) });
        return;
    }
    if (canonicalSha256({ a: expected.contentSha256, b: expected.contentBytes, c: expected.matrix }) !==
        canonicalSha256({ a: request.contentSha256, b: request.contentBytes, c: request.matrix })) {
        context.addIssue({ code: 'custom', message: 'The module matrix, content digest and byte count must be derived from the content.' });
    }
}
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }).superRefine((request, context) => checkDerived(request, context)),
    z.strictObject({ ...commonInternal, apply: z.literal(true), commandId: canonicalCommandIdSchema }).superRefine((request, context) => checkDerived(request, context)),
]);
const commonPublic = {
    expected_document_key: z.string().min(1).max(16_384), expected_layer_path: layerPathSchema, artboard_index: z.number().int().safe().nonnegative(),
    x: z.number().finite().describe('Left edge of the whole symbol, quiet zone included, from the artboard left (pt).'),
    y: z.number().finite().describe('Top edge of the whole symbol from the artboard top (pt).'),
    size_pt: z.number().positive().finite().describe('Side of the whole square, quiet zone included (pt).'),
    content: contentSchema.describe('UTF-8 text or URL to encode.'),
    error_correction: z.enum(QR_ERROR_CORRECTION_LEVELS).default('M'),
    version: z.union([z.literal('auto'), z.number().int().min(QR_MIN_VERSION).max(QR_MAX_VERSION)]).default('auto'),
    quiet_zone_modules: z.number().int().min(QR_MIN_QUIET_ZONE_MODULES, quietZoneMessage).max(QR_MAX_QUIET_ZONE_MODULES, quietZoneMessage).default(QR_MIN_QUIET_ZONE_MODULES),
    background: z.enum(QR_BACKGROUNDS).default('white').describe('white draws a white rectangle over the quiet zone; transparent draws none (the zone is still reserved).'),
};
export const createQrCodePublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({ ...commonPublic, apply: z.literal(true), command_id: applyCommandIdSchema }),
]);
const inputSchema = z.strictObject({ ...commonPublic, apply: z.boolean().default(false), command_id: applyCommandIdSchema.optional() });
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(createQrCodePublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = createQrCodePublicInputSchema.parse(input);
    const common = {
        expectedDocumentKey: value.expected_document_key, expectedLayerPath: value.expected_layer_path, artboardIndex: value.artboard_index,
        x: value.x, y: value.y, sizePt: value.size_pt, content: value.content, errorCorrection: value.error_correction, version: value.version,
        quietZoneModules: value.quiet_zone_modules, background: value.background, encoder: QR_ENCODER_IDENTITY,
    };
    const derived = derivedFacts(common);
    return value.apply ? { ...common, ...derived, apply: true, commandId: value.command_id } : { ...common, ...derived, apply: false };
}
function resolveForRequest(request) {
    try {
        return resolveQr(request);
    }
    catch (error) {
        if (error instanceof QrMatrixError)
            throw new Error(`${error.code}: ${error.message}`);
        throw error;
    }
}
export const CREATE_QR_CODE_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: CREATE_QR_CODE_OPERATION,
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
export const CREATE_QR_CODE_SAFETY_IDENTITY = canonicalDigest(CREATE_QR_CODE_SAFETY);
function safetyPlan(result, requestDigest, documentKey = result.document.key) {
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'create', operationId: CREATE_QR_CODE_OPERATION, canonicalRequestDigest: requestDigest,
        evidence: { documentKey, targetLocator: `layer:${result.plan.targetLayer.path.join('.')};artboard:${result.plan.artboardIndex}` },
        preconditions: { status: result.plan.applyBlockedReasonCodes.length === 0 ? 'satisfied' : 'blocked', targetsValidated: result.plan.layerSafetyReasonCodes.length === 0 },
        confirmation: { kind: 'risk_scoped', status: 'not_required' },
        applyAllowed: result.plan.applyAllowed,
    });
}
function safetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' || transaction.state === 'rollback_indeterminate') {
        throw new Error('Indeterminate QR creation cannot be terminal.');
    }
    const common = { policyVersion: 1, operationClass: 'create', operationId: CREATE_QR_CODE_OPERATION, canonicalRequestDigest: requestDigest, planDigest: plan.planDigest, attestation };
    const replay = { status: 'durable_terminal', action: 'return_attested_result', reapply: false };
    if (result.applied && transaction.state === 'verified') {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { nativeUuid: result.created.uuid, ownership: 'self_created_only', postconditionVerified: true, outstandingEffect: null },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'succeeded', terminal: true, recovery: 'not_required', proof: { kind: 'verified_postcondition' }, replay } });
    }
    if (transaction.state === 'rolled_back') {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { nativeUuid: transaction.rollback.createdUuid, ownership: 'self_created_only', postconditionVerified: false, outstandingEffect: null },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'recovered', terminal: true, recovery: 'verified', proof: { kind: 'verified_recovery' }, replay } });
    }
    if (transaction.state === 'rollback_failed') {
        const nativeUuid = transaction.rollback.createdUuid;
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { nativeUuid, ownership: 'self_created_only', postconditionVerified: false, outstandingEffect: nativeUuid === null ? null : { kind: 'native_uuid_still_present', nativeUuid } },
            executionEvidence: { outcome: 'recovery_failed' },
            resolution: { status: 'recovery_failed', terminal: true, recovery: 'failed', outstandingEffect: 'known_effect_present', proof: { kind: 'verified_outstanding_effect' }, replay } });
    }
    return operationSafetyResultSchema.parse({ ...common,
        evidence: { nativeUuid: null, ownership: 'self_created_only', postconditionVerified: false, outstandingEffect: null },
        executionEvidence: { outcome: 'proven_pre_apply' },
        resolution: { status: 'failed', terminal: true, recovery: 'not_required', proof: { kind: 'proven_pre_apply', mutationAttempted: false }, replay } });
}
async function assertSafety(value, requestDigest, attestation, resolver) {
    const result = createQrCodeResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null)
        throw new Error('QR creation terminal result requires attestation.');
    await assertOperationSafetyAdapterConformance({ registration: CREATE_QR_CODE_SAFETY, plan, result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
export const CREATE_QR_CODE_MODULE_SCRIPT = `var QR_TOLERANCE_PT = ${QR_COORDINATE_TOLERANCE_PT};
var QR_GROUP_NAME = ${JSON.stringify(QR_GROUP_NAME)};
var QR_MODULES_NAME = ${JSON.stringify(QR_MODULES_NAME)};
var QR_BACKGROUND_NAME = ${JSON.stringify(QR_BACKGROUND_NAME)};

function qrFix(value) { return Math.round(value * 1000) / 1000; }
function qrBounds(item) { var b = item.geometricBounds; return [mutationFiniteNumber(b[0], "bounds[0]"), mutationFiniteNumber(b[1], "bounds[1]"), mutationFiniteNumber(b[2], "bounds[2]"), mutationFiniteNumber(b[3], "bounds[3]")]; }
function qrSameBounds(left, right) {
  for (var i = 0; i < 4; i++) if (Math.abs(left[i] - right[i]) > QR_TOLERANCE_PT) return false;
  return true;
}
function qrColors(document) {
  var space = String(document.documentColorSpace);
  if (space === String(DocumentColorSpace.CMYK)) return { space: "CMYK", dark: { model: "CMYK", values: [0, 0, 0, 100] }, light: { model: "CMYK", values: [0, 0, 0, 0] } };
  if (space === String(DocumentColorSpace.RGB)) return { space: "RGB", dark: { model: "RGB", values: [0, 0, 0] }, light: { model: "RGB", values: [255, 255, 255] } };
  throw mutationError("preflight_failed", "The document colour space is neither CMYK nor RGB.");
}
function qrMakeColor(spec) {
  var color;
  if (spec.model === "CMYK") { color = new CMYKColor(); color.cyan = spec.values[0]; color.magenta = spec.values[1]; color.yellow = spec.values[2]; color.black = spec.values[3]; }
  else { color = new RGBColor(); color.red = spec.values[0]; color.green = spec.values[1]; color.blue = spec.values[2]; }
  return color;
}
function qrSameColor(color, spec) {
  var type = String(color.typename);
  var values;
  if (spec.model === "CMYK") { if (type !== "CMYKColor") return false; values = [color.cyan, color.magenta, color.yellow, color.black]; }
  else { if (type !== "RGBColor") return false; values = [color.red, color.green, color.blue]; }
  for (var i = 0; i < spec.values.length; i++) if (Math.abs(values[i] - spec.values[i]) > 0.01) return false;
  return true;
}
/** Row-major bits, most significant bit first (the TypeScript qrMatrixHex); runs are the maximal horizontal runs of dark modules. */
function qrRuns() {
  var hex = params.matrix.hex; var modules = params.matrix.modules; var runs = [];
  if (typeof hex !== "string" || hex.length !== Math.ceil(modules * modules / 8) * 2) throw mutationError("preflight_failed", "The module matrix does not match its size.");
  for (var y = 0; y < modules; y++) {
    var start = -1;
    for (var x = 0; x <= modules; x++) {
      var dark = false;
      if (x < modules) { var index = y * modules + x; dark = ((parseInt(hex.substr((index >> 3) * 2, 2), 16) >> (7 - (index & 7))) & 1) === 1; }
      if (dark && start < 0) start = x;
      if (!dark && start >= 0) { runs.push([start, y, x - start]); start = -1; }
    }
  }
  if (runs.length !== params.matrix.runCount) throw mutationError("preflight_failed", "The module matrix does not produce the planned rectangle count.");
  return runs;
}

function qrResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var doc = app.activeDocument;
  mutationFiniteNumber(params.x, "x"); mutationFiniteNumber(params.y, "y"); mutationPositiveNumber(params.sizePt, "size_pt");
  if (typeof params.artboardIndex !== "number" || !(params.artboardIndex >= 0) || Math.floor(params.artboardIndex) !== params.artboardIndex || params.artboardIndex >= doc.artboards.length) {
    throw mutationError("preflight_failed", "Invalid artboard index.");
  }
  if (params.quietZoneModules < ${QR_MIN_QUIET_ZONE_MODULES}) throw mutationError("preflight_failed", "QR_QUIET_ZONE_TOO_SMALL: the quiet zone is at least ${QR_MIN_QUIET_ZONE_MODULES} modules.");
  var colors = qrColors(doc);
  var runs = qrRuns();
  var layerChain = mutationResolveLayerPath(doc, params.expectedLayerPath);
  var layerInspection = mutationInspectLayerChain(layerChain);
  var blockers = layerInspection.reasonCodes.slice(0);
  if (!context.mutationAllowed) blockers.push("document_mutation_not_allowed");
  var artboardRect = doc.artboards[params.artboardIndex].artboardRect; var artboardBounds = [];
  for (var i = 0; i < 4; i++) artboardBounds.push(mutationFiniteNumber(artboardRect[i], "artboardBounds[" + i + "]"));
  if (!(artboardBounds[0] < artboardBounds[2]) || !(artboardBounds[1] > artboardBounds[3])) throw mutationError("preflight_failed", "The selected artboard has degenerate bounds.");
  var total = params.matrix.modules + 2 * params.quietZoneModules;
  var modulePt = params.sizePt / total;
  var left = artboardBounds[0] + params.x; var top = artboardBounds[1] - params.y;
  var symbolBounds = [left, top, left + params.sizePt, top - params.sizePt];
  var inset = params.quietZoneModules * modulePt;
  var moduleBounds = [symbolBounds[0] + inset, symbolBounds[1] - inset, symbolBounds[2] - inset, symbolBounds[3] + inset];
  for (var b = 0; b < 4; b++) { mutationFiniteNumber(symbolBounds[b], "symbolBounds"); mutationFiniteNumber(moduleBounds[b], "moduleBounds"); }
  if (forApply && blockers.length > 0) throw mutationBeforeSideEffectError(stringifyJson({ code: "CREATE_QR_CODE_APPLY_BLOCKED", reasonCodes: blockers }));
  return { context: context, doc: doc, colors: colors, runs: runs, modulePt: modulePt, artboardBounds: artboardBounds, symbolBounds: symbolBounds, moduleBounds: moduleBounds,
    targetLayer: layerChain[layerChain.length - 1], layerInspection: layerInspection, blockers: blockers, itemCount: layerChain[layerChain.length - 1].pageItems.length };
}

function qrPlan(preflight) {
  var white = params.background === "white";
  return {
    operation: "create_qr_code", documentKey: preflight.context.key, coordinateSpace: "artboard_top_left", unit: "pt", artboardIndex: params.artboardIndex,
    symbol: { contentSha256: params.contentSha256, contentBytes: params.contentBytes, version: params.matrix.version, modules: params.matrix.modules,
      errorCorrection: params.errorCorrection, mask: params.matrix.mask, encoder: params.encoder },
    quietZoneModules: params.quietZoneModules, background: params.background,
    geometry: { sizePt: params.sizePt, modulePt: preflight.modulePt, moduleMm: preflight.modulePt * 25.4 / 72, symbolBounds: preflight.symbolBounds, moduleBounds: preflight.moduleBounds,
      artboardBounds: preflight.artboardBounds, withinArtboard: rectangleWithinArtboard(preflight.symbolBounds, preflight.artboardBounds) },
    items: { rectangles: preflight.runs.length, darkModules: params.matrix.darkModules, compoundPaths: 1, backgroundRectangle: white },
    colors: { space: preflight.colors.space, foreground: preflight.colors.dark, background: white ? preflight.colors.light : null },
    targetLayer: { path: params.expectedLayerPath, name: preflight.targetLayer.name || "", visible: preflight.layerInspection.targetVisible, locked: preflight.layerInspection.targetLocked,
      effectiveVisible: preflight.layerInspection.ancestorVisible && preflight.layerInspection.targetVisible, effectiveLocked: preflight.layerInspection.ancestorLocked || preflight.layerInspection.targetLocked,
      itemCount: preflight.itemCount },
    layerSafetyReasonCodes: preflight.layerInspection.reasonCodes, applyBlockedReasonCodes: preflight.blockers, applyAllowed: preflight.blockers.length === 0
  };
}

function qrRevalidate(preflight, plan) {
  var current;
  try { current = qrResolve(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "QR code preconditions changed before apply.")); }
  if (current.doc !== preflight.doc || current.targetLayer !== preflight.targetLayer || current.itemCount !== plan.targetLayer.itemCount ||
      !qrSameBounds(current.symbolBounds, plan.geometry.symbolBounds) || current.runs.length !== plan.items.rectangles || current.colors.space !== plan.colors.space) {
    throw mutationBeforeSideEffectError("The QR code target layer, artboard or document colour space changed before apply.");
  }
  if (current.blockers.length > 0) throw mutationBeforeSideEffectError("QR code apply is blocked: " + current.blockers.join(", "));
}

function qrApply(preflight, plan, state) {
  var operationState = state.operationState;
  operationState.mutationStarted = true;
  operationState.selectionBefore = preflight.doc.selection.length;
  var layer = preflight.targetLayer;
  var outer = layer.groupItems.add();
  operationState.createdObject = outer;
  if (typeof outer.uuid !== "string" || outer.uuid.length === 0) throw mutationError("apply_failed", "Illustrator did not return a valid native UUID.");
  operationState.createdUuid = outer.uuid;
  outer.name = QR_GROUP_NAME;
  var white = params.background === "white";
  var size = params.sizePt; var bounds = preflight.symbolBounds;
  if (white) {
    var background = outer.pathItems.rectangle(bounds[1], bounds[0], size, size);
    background.filled = true; background.fillColor = qrMakeColor(preflight.colors.light); background.stroked = false; background.name = QR_BACKGROUND_NAME;
    operationState.background = background;
  }
  var container = outer.compoundPathItems.add();
  container.name = QR_MODULES_NAME;
  operationState.container = container;
  if (typeof container.uuid !== "string" || container.uuid.length === 0) throw mutationError("apply_failed", "Illustrator did not return a native UUID for the module path.");
  var members = container.pathItems; var modulePt = preflight.modulePt; var quiet = params.quietZoneModules; var runs = preflight.runs;
  var darkColor = qrMakeColor(preflight.colors.dark);
  for (var i = 0; i < runs.length; i++) {
    var left = bounds[0] + (quiet + runs[i][0]) * modulePt; var top = bounds[1] - (quiet + runs[i][1]) * modulePt;
    var member = members.rectangle(top, left, runs[i][2] * modulePt, modulePt);
    // Every rectangle is painted itself (measured on 30.8.2: cheap, 7,842 of them in about 0.3 s); nothing relies on compound members sharing one member's paint.
    member.fillColor = darkColor; member.stroked = false;
  }
  operationState.selectionAfter = preflight.doc.selection.length;
  return outer;
}

function qrDescribeColor(color) {
  var type = String(color.typename); var values = [];
  if (type === "CMYKColor") values = [color.cyan, color.magenta, color.yellow, color.black];
  else if (type === "RGBColor") values = [color.red, color.green, color.blue];
  else if (type === "GrayColor") values = [color.gray];
  for (var i = 0; i < values.length; i++) values[i] = qrFix(values[i]);
  return type + " " + values.join(",");
}
function qrDescribeSpec(spec) { return (spec.model === "CMYK" ? "CMYKColor " : "RGBColor ") + spec.values.join(","); }

/** Each created rectangle must be one planned run (the matched set), exactly once, on the module grid, painted with the foreground. A failure names the member and the values read. */
function qrVerifyMembers(members, runs, preflight) {
  var modulePt = preflight.modulePt; var quiet = params.quietZoneModules; var originX = preflight.symbolBounds[0]; var originY = preflight.symbolBounds[1];
  var tolerance = QR_TOLERANCE_PT;
  var wanted = {};
  for (var i = 0; i < runs.length; i++) wanted[runs[i][0] + "," + runs[i][1] + "," + runs[i][2]] = 1;
  var seen = 0; var paintBad = 0; var firstBad = null;
  for (var m = 0; m < members.length; m++) {
    var item = members[m]; var b = item.geometricBounds;
    var gx = (b[0] - originX) / modulePt - quiet; var gy = (originY - b[1]) / modulePt - quiet; var gw = (b[2] - b[0]) / modulePt;
    var rx = Math.round(gx); var ry = Math.round(gy); var rw = Math.round(gw);
    var where = "member " + m + " of " + members.length;
    if (Math.abs(gx - rx) * modulePt > tolerance || Math.abs(gy - ry) * modulePt > tolerance || Math.abs(gw - rw) * modulePt > tolerance || Math.abs((b[1] - b[3]) - modulePt) > tolerance) {
      throw mutationError("verify_mismatch", "A created rectangle is not on the module grid (" + where + ", bounds " + qrFix(b[0]) + "," + qrFix(b[1]) + "," + qrFix(b[2]) + "," + qrFix(b[3]) + ").");
    }
    var key = rx + "," + ry + "," + rw;
    if (wanted[key] !== 1) throw mutationError("verify_mismatch", "A created rectangle is not a planned dark-module run, or appears twice (" + where + ", run " + key + ").");
    wanted[key] = 0; seen++;
    var fill = item.fillColor; var filled = item.filled; var stroked = item.stroked;
    if (!qrSameColor(fill, preflight.colors.dark) || filled !== true || stroked !== false) {
      paintBad++;
      if (firstBad === null) firstBad = where + ", run " + key + ": fill " + qrDescribeColor(fill) + ", filled " + String(filled) + ", stroked " + String(stroked);
    }
  }
  if (paintBad > 0) throw mutationError("verify_mismatch", "A created rectangle is not filled with the foreground colour and unstroked (" + paintBad + " of " + members.length + "; first: " + firstBad + "; expected " + qrDescribeSpec(preflight.colors.dark) + ", filled true, stroked false).");
  if (seen !== runs.length) throw mutationError("verify_mismatch", "The created rectangles do not cover every planned run (" + seen + " of " + runs.length + ").");
}

function qrVerify(preflight, plan, state) {
  var doc = mutationRequireSameDocument(preflight.doc);
  var layerInspection = mutationRequireSameLayer(doc, params.expectedLayerPath, preflight.targetLayer);
  if (layerInspection.reasonCodes.length > 0) throw mutationError("verify_mismatch", "The target layer or an ancestor became unsafe during verification.");
  var operationState = state.operationState; var outer = operationState.createdObject; var container = operationState.container;
  var uuid = operationState.createdUuid;
  var found = mutationFindPageItemByUuid(doc, uuid);
  if (found === null || found !== outer || outer.uuid !== uuid) throw mutationError("verify_mismatch", "The created native UUID could not be resolved to the created group.");
  if (String(outer.typename) !== "GroupItem" || outer.layer !== preflight.targetLayer || outer.parent !== preflight.targetLayer) throw mutationError("verify_mismatch", "The created group has an unexpected type or layer.");
  if (preflight.targetLayer.pageItems.length !== plan.targetLayer.itemCount + 1) throw mutationError("verify_mismatch", "The created group is not the only new item of its layer.");
  if (outer.locked !== false || outer.hidden !== false || outer.editable !== true) throw mutationError("verify_mismatch", "The created group is not verifiably editable.");
  var white = params.background === "white";
  if (outer.pageItems.length !== (white ? 2 : 1)) throw mutationError("verify_mismatch", "The created group does not hold exactly the planned items.");
  if (String(container.typename) !== "CompoundPathItem" || container.parent !== outer || String(container.name) !== QR_MODULES_NAME) throw mutationError("verify_mismatch", "The module path is not the compound path of the created group.");
  var members = container.pathItems;
  if (members.length !== preflight.runs.length) throw mutationError("verify_mismatch", "The module path does not hold the planned rectangle count.");
  qrVerifyMembers(members, preflight.runs, preflight);
  var containerBounds = qrBounds(container);
  if (!qrSameBounds(containerBounds, preflight.moduleBounds)) throw mutationError("verify_mismatch", "The module path bounds do not match the plan.");
  var outerBounds = qrBounds(outer);
  if (white) {
    var background = operationState.background;
    if (String(background.typename) !== "PathItem" || background.parent !== outer || !qrSameBounds(qrBounds(background), preflight.symbolBounds) ||
        !qrSameColor(background.fillColor, preflight.colors.light) || background.filled !== true || background.stroked !== false) {
      throw mutationError("verify_mismatch", "The background rectangle does not match the plan.");
    }
    if (!qrSameBounds(outerBounds, preflight.symbolBounds)) throw mutationError("verify_mismatch", "The group bounds do not match the symbol square.");
  } else if (!qrSameBounds(outerBounds, preflight.moduleBounds)) throw mutationError("verify_mismatch", "The group bounds do not match the module area.");
  if (typeof container.uuid !== "string" || container.uuid.length === 0 || container.uuid === uuid) throw mutationError("verify_mismatch", "The module path has no distinct native UUID.");
  return { uuid: uuid, name: String(outer.name), bounds: outerBounds, moduleBounds: containerBounds, rectangleCount: members.length, backgroundRectangle: white, containerUuid: container.uuid,
    selectionBefore: operationState.selectionBefore, selectionAfter: doc.selection.length };
}

function qrRollback(state) {
  var preflight = state.preflight; var operationState = state.operationState;
  var doc = preflight ? preflight.doc : null;
  try {
    if (!preflight || app.documents.length === 0 || app.activeDocument !== doc) return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
    mutationRequireSameLayer(doc, params.expectedLayerPath, preflight.targetLayer);
  } catch (lookupError) { return { status: "indeterminate", message: "Rollback target lookup is indeterminate." }; }
  var layer = preflight.targetLayer; var baseline = preflight.itemCount; var outer = operationState.createdObject; var uuid = operationState.createdUuid;
  operationState.rollbackEvidence.createdUuid = typeof uuid === "string" && uuid.length > 0 ? uuid : null;
  var count;
  try { count = layer.pageItems.length; } catch (countError) { return { status: "indeterminate", message: "Rollback layer item count is indeterminate." }; }
  if (!outer) {
    if (count !== baseline) return { status: "indeterminate", message: "Rollback cannot prove which item was created." };
    operationState.rollbackEvidence.restoredItemCount = count;
    return { status: "verified" };
  }
  if (typeof uuid !== "string" || uuid.length === 0) return { status: "indeterminate", message: "Rollback cannot identify the created group." };
  var referenceState;
  try { referenceState = mutationCreatedObjectReferenceState(outer, uuid); } catch (identityError) { return { status: "indeterminate", message: "Rollback object-identity lookup is indeterminate." }; }
  if (referenceState === "invalid") {
    var absence = mutationCreatedObjectAbsence(doc, uuid);
    if (absence.status === "verified") {
      try { count = layer.pageItems.length; } catch (afterAbsent) { return { status: "indeterminate", message: "Rollback layer item count is indeterminate." }; }
      operationState.rollbackEvidence.restoredItemCount = count;
      if (count !== baseline) return { status: "indeterminate", message: "Rollback found the group absent but the layer does not match the baseline." };
    }
    return absence;
  }
  if (referenceState !== "present") return { status: "indeterminate", message: "Rollback UUID changed while the created object reference remains valid." };
  try {
    if (String(outer.typename) !== "GroupItem" || outer.parent !== layer || count !== baseline + 1) return { status: "indeterminate", message: "Rollback refused because the layer is neither the baseline nor the created state." };
  } catch (shapeError) { return { status: "indeterminate", message: "Rollback object identity is indeterminate." }; }
  try { outer.remove(); } catch (removeError) { return { status: "indeterminate", message: "Rollback removal is indeterminate." }; }
  var remaining;
  try {
    if (app.documents.length === 0 || app.activeDocument !== doc) return { status: "indeterminate", message: "Rollback document identity changed after removal was attempted." };
    remaining = mutationFindPageItemByUuid(doc, uuid);
    count = layer.pageItems.length;
  } catch (postError) { return { status: "indeterminate", message: "Rollback result lookup is indeterminate." }; }
  operationState.rollbackEvidence.restoredItemCount = count;
  if (remaining !== null) return { status: "failed", message: "Rollback did not remove the created group." };
  var proved = mutationCreatedObjectAbsence(doc, uuid);
  if (proved.status !== "verified") return proved;
  return count === baseline ? { status: "verified" } : { status: "failed", message: "Rollback did not restore the exact baseline layer item count." };
}

`;
export const CREATE_QR_CODE_RUNNER_SCRIPT = `var qrExecution = runMutationTransaction({
  apply: params.apply === true,
  initialOperationState: function () {
    return { mutationStarted: false, createdObject: null, createdUuid: null, container: null, background: null, selectionBefore: 0, selectionAfter: 0,
      rollbackEvidence: { createdUuid: null, restoredItemCount: null } };
  },
  preflight: qrResolve,
  plan: qrPlan,
  revalidate: qrRevalidate,
  applyMutation: qrApply,
  verify: qrVerify,
  rollback: qrRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () {
    return { reasonCode: "created_state_unknown", message: "QR code creation outcome is indeterminate.", evidence: { createdUuid: null, restoredItemCount: null } };
  },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});
var qrDocument = qrExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === qrExecution.preflight.doc) qrDocument = getDocumentContext();
var result = { operation: "create_qr_code", applied: qrExecution.transaction.state === "verified", document: qrDocument, plan: qrExecution.plan, transaction: qrExecution.transaction };
if (qrExecution.transaction.state === "verified") result.created = qrExecution.value;
`;
export const CREATE_QR_CODE_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${CREATION_APPEARANCE_MODULE_SCRIPT}${CREATE_RECTANGLE_MODULE_SCRIPT}${CREATE_QR_CODE_MODULE_SCRIPT}${CREATE_QR_CODE_RUNNER_SCRIPT}`;
export const CREATE_QR_CODE_HOST_SCRIPT_DIGEST = canonicalSha256(CREATE_QR_CODE_SCRIPT);
export const CREATE_QR_CODE_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: CREATE_QR_CODE_OPERATION, validator: CREATE_QR_CODE_VALIDATOR, canonicalContractVersion: CANONICAL_VERSION,
    resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION, safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: CREATE_QR_CODE_SAFETY_IDENTITY, hostScriptDigest: CREATE_QR_CODE_HOST_SCRIPT_DIGEST, mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    const digestRequest = 'commandId' in request ? (({ commandId: _commandId, ...rest }) => rest)(request) : request;
    const digest = canonicalSha256({ operation: CREATE_QR_CODE_OPERATION, validator: CREATE_QR_CODE_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: 'commandId' in request ? request.commandId : null, documentKey: request.expectedDocumentKey, digest };
}
export const createQrCodeToolContract = {
    name: 'illustrator_create_qr_code',
    title: 'Plan or Create a QR Code',
    description: 'Plan or draw a QR Code Model 2 symbol (Version 1-40, error correction L/M/Q/H, UTF-8 content) as editable vector artwork on an explicit layer path, bound by explicit document key. '
        + 'x, y and size_pt place the whole square, quiet zone included, from the artboard top-left; quiet_zone_modules is at least 4. The foreground is black (CMYK K100 or RGB 0,0,0); background is a white rectangle or none. '
        + 'The dark modules become one compound path (horizontal runs merged), grouped with the optional white rectangle. The plan returns the version, module count, rectangle count and physical module size (small sizes are your check; no minimum is asserted) and a software decode of the planned rectangles (zbarimg; not_run when it is missing). '
        + 'Apply revalidates in the same host call, reads back every rectangle and paint, and rolls back only its own group. After a verified apply a separate read renders the group in a throwaway document and decodes it: decode is match, mismatch (returned as an error naming the group; the symbol is not a success) or not_run. '
        + 'This is standard Model 2 only: no styling, logo, GS1 conformance or other colours. The encoded content is yours to license and use lawfully. Created UUIDs are not durable across a later save. Not available inside an edit session.',
    inputSchema,
    publicInputSchema: createQrCodePublicInputSchema,
    outputSchema: createQrCodeResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(CREATE_QR_CODE_SAFETY.policy),
    normalizePublicInput,
};
export function createCreateQrCodeAdapter() {
    return {
        version: 1, operation: CREATE_QR_CODE_OPERATION, validator: CREATE_QR_CODE_VALIDATOR, safety: CREATE_QR_CODE_SAFETY, safetyRegistrationIdentity: CREATE_QR_CODE_SAFETY_IDENTITY,
        adapterIdentity: CREATE_QR_CODE_ADAPTER_IDENTITY, tool: createQrCodeToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: createQrCodeResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
        safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: CREATE_QR_CODE_HOST_SCRIPT_DIGEST,
        mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...request } = normalized.request;
            const params = request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: CREATE_QR_CODE_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: CREATE_QR_CODE_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: CREATE_QR_CODE_OPERATION, documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: CREATE_QR_CODE_ADAPTER_IDENTITY, mutationHostApplicationMode: 'foreground', script: CREATE_QR_CODE_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = createQrCodeResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back' || state === 'rollback_failed')
                return { state };
            if (state === 'planned')
                throw new Error('A QR code plan is not a terminal mutation result.');
            throw new Error('Unverified QR code creation must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error, detail) {
            if (detail?.code === 'CREATE_QR_CODE_APPLY_BLOCKED')
                return new Error(`QR code creation is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}.`);
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
