import { z } from 'zod';
import { OsascriptHostProfileProbe } from '../host-profile.js';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
export const SET_STROKE_STYLE_OPERATION = 'set_stroke_style';
export const SET_STROKE_STYLE_VALIDATOR = { kind: SET_STROKE_STYLE_OPERATION, version: 1 };
const CANONICAL_VERSION = 1;
const RESULT_SCHEMA_VERSION = 1;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
export const STROKE_SCENE_MAX_CHARS = 65_536;
const uuidSchema = z.string().min(1).max(255);
const documentKeySchema = z.string().min(1).max(16_384);
const styleShape = {
    dashes: z.array(z.number().finite().min(0).max(10_000)).max(2),
    dash_offset: z.number().finite().min(-10_000).max(10_000),
    cap: z.enum(['butt', 'round', 'projecting']),
    join: z.enum(['miter', 'round', 'bevel']),
    miter_limit: z.number().finite().min(1).max(500),
};
export const strokeStyleStateSchema = z.strictObject(styleShape);
export function isMeasuredStrokeStyle(style) {
    if (style.dashes.length === 2) {
        return style.dashes[1] > 0 && style.join === 'miter' && style.miter_limit === 4 &&
            (style.dashes[0] === 0 ? style.cap === 'round' && style.dash_offset === 0 : style.cap === 'butt');
    }
    return style.dashes.length === 0 && style.dash_offset === 0 &&
        (style.cap === 'butt' || style.join === 'miter') &&
        (style.cap === 'butt' && style.join === 'miter' || style.miter_limit === 4);
}
export const strokeStyleSchema = z.strictObject(styleShape).superRefine((style, context) => {
    if (!isMeasuredStrokeStyle(style))
        context.addIssue({ code: 'custom', message: 'Unmeasured stroke style combination.' });
}).describe('All five fields together. [] is solid; [0, gap>0] with cap round, join miter, miter_limit 4, dash_offset 0 makes round dots; [dash>=0, gap>0] with cap butt, join miter, miter_limit 4 makes dashes. Solid: dash_offset 0, and cap butt with join miter, or a non-default cap or join with join miter or cap butt, miter_limit 4 unless both are butt/miter.');
const sceneSchema = z.string().min(1).max(STROKE_SCENE_MAX_CHARS)
    .describe('plan.strokeScene, unchanged: the complete ordered scene is compared at the existing JSON wire boundary.');
const commonInternal = { expectedDocumentKey: documentKeySchema, targetUuid: uuidSchema, style: strokeStyleSchema };
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({
        ...commonInternal, expectedBefore: strokeStyleStateSchema, confirmedAfter: strokeStyleStateSchema,
        expectedStrokeScene: z.string().min(1).max(STROKE_SCENE_MAX_CHARS), apply: z.literal(true), commandId: canonicalCommandIdSchema,
    }),
]);
const commonPublic = {
    expected_document_key: documentKeySchema,
    target_uuid: z.string().min(1).max(255).describe('Native PageItem.uuid of the open three-point straight PathItem.'),
    style: strokeStyleSchema,
};
export const setStrokeStylePublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({
        ...commonPublic, expected_before: strokeStyleStateSchema, confirmed_after: strokeStyleStateSchema,
        expected_stroke_scene: sceneSchema, apply: z.literal(true), command_id: applyCommandIdSchema,
    }),
]);
const inputSchema = z.strictObject({
    ...commonPublic, expected_before: strokeStyleStateSchema.optional(), confirmed_after: strokeStyleStateSchema.optional(),
    expected_stroke_scene: sceneSchema.optional(), apply: z.boolean().default(false), command_id: applyCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(setStrokeStylePublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = setStrokeStylePublicInputSchema.parse(input);
    const common = { expectedDocumentKey: value.expected_document_key, targetUuid: value.target_uuid, style: value.style };
    return value.apply
        ? { ...common, expectedBefore: value.expected_before, confirmedAfter: value.confirmed_after, expectedStrokeScene: value.expected_stroke_scene, apply: true, commandId: value.command_id }
        : { ...common, apply: false };
}
export const STROKE_STYLE_BLOCKERS = [
    'document_mutation_not_allowed', 'target_locked', 'target_hidden', 'target_not_editable', 'layer_hidden', 'layer_locked',
    'value_unchanged', 'stroke_saved_document_unmeasured', 'stroke_document_scope_unmeasured', 'stroke_target_shape_unmeasured',
    'stroke_paint_unmeasured', 'stroke_style_unmeasured',
];
const blockerSchema = z.enum(STROKE_STYLE_BLOCKERS);
const planSchema = z.strictObject({
    operation: z.literal(SET_STROKE_STYLE_OPERATION),
    documentKey: documentKeySchema,
    targetUuid: uuidSchema,
    before: strokeStyleStateSchema,
    after: strokeStyleStateSchema,
    strokeScene: z.string().min(1).max(STROKE_SCENE_MAX_CHARS).optional(),
    applyBlockedReasonCodes: z.array(blockerSchema).max(STROKE_STYLE_BLOCKERS.length),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    const allowed = plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0 && plan.strokeScene !== undefined;
    if (plan.applyAllowed !== allowed)
        context.addIssue({ code: 'custom', message: 'Stroke style applyAllowed must require confirmation, no blockers and the planned scene.' });
    if (new Set(plan.applyBlockedReasonCodes).size !== plan.applyBlockedReasonCodes.length)
        context.addIssue({ code: 'custom', message: 'Stroke style blockers must be unique.' });
});
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']), reasonCode: z.enum(['apply_failed', 'verify_mismatch']), message: z.string().min(1).max(500),
}).superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed'))
        context.addIssue({ code: 'custom', message: 'Stroke style failure phase and reason code must match.' });
});
const indeterminateFailureSchema = z.strictObject({ phase: z.literal('apply'), reasonCode: z.literal('apply_indeterminate'), message: z.string().min(1).max(500) });
const rollbackEvidence = { targetUuid: uuidSchema, restoredStyle: strokeStyleStateSchema.nullable() };
const transactionSchema = z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('planned'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('verified'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('apply_failed'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('not_required') }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('rolled_back'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('verified'), ...rollbackEvidence }), audit: mutationAuditSchema }),
    z.strictObject({
        state: z.literal('rollback_failed'), failure: failureSchema,
        rollback: z.strictObject({ status: z.literal('failed'), reasonCode: z.literal('rollback_failed'), message: z.string().min(1).max(500), ...rollbackEvidence }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('apply_indeterminate'), failure: indeterminateFailureSchema,
        rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.string().min(1).max(100), message: z.string().min(1).max(500), targetUuid: uuidSchema, restoredStyle: z.null() }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rollback_indeterminate'), failure: failureSchema,
        rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('rollback_indeterminate'), message: z.string().min(1).max(500), ...rollbackEvidence }),
        audit: mutationAuditSchema,
    }),
]).superRefine((transaction, context) => {
    const prefix = ['preflight:started:', 'preflight:succeeded:', 'plan:started:', 'plan:succeeded:'];
    let expected;
    if (transaction.state === 'planned')
        expected = [...prefix, 'apply:skipped:not_requested', 'verify:skipped:not_requested', 'rollback:skipped:not_requested'];
    else if (transaction.state === 'verified')
        expected = [...prefix, 'apply:started:', 'apply:attempted:', 'apply:succeeded:', 'verify:started:', 'verify:succeeded:', 'rollback:skipped:not_required'];
    else if (transaction.state === 'apply_failed')
        expected = [...prefix, 'apply:started:', 'apply:failed:apply_failed', 'verify:skipped:not_required', 'rollback:skipped:not_required'];
    else if (transaction.state === 'apply_indeterminate')
        expected = [...prefix, 'apply:started:', 'apply:attempted:', 'apply:failed:apply_indeterminate'];
    else {
        const failure = transaction.failure.phase === 'apply'
            ? ['apply:started:', 'apply:attempted:', 'apply:failed:apply_failed', 'verify:skipped:not_required']
            : ['apply:started:', 'apply:attempted:', 'apply:succeeded:', 'verify:started:', 'verify:failed:verify_mismatch'];
        expected = [...prefix, ...failure, 'rollback:started:',
            transaction.state === 'rolled_back' ? 'rollback:succeeded:' : `rollback:failed:${transaction.state === 'rollback_failed' ? 'rollback_failed' : 'rollback_indeterminate'}`];
    }
    const actual = transaction.audit.map((event) => `${event.phase}:${event.event}:${'reasonCode' in event ? event.reasonCode : ''}`);
    if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index]))
        context.addIssue({ code: 'custom', message: 'Stroke style audit sequence does not match transaction state.' });
    transaction.audit.forEach((event, index) => { if (event.sequence !== index)
        context.addIssue({ code: 'custom', message: 'Stroke style audit sequence must be contiguous.' }); });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' && event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode && event.message === transaction.failure.message);
        if (matches.length !== 1)
            context.addIssue({ code: 'custom', message: 'Stroke style failure must match one audit event.' });
    }
});
const postconditionSchema = z.strictObject({ targetUuid: uuidSchema, style: strokeStyleStateSchema });
function sameCanonical(left, right) {
    return canonicalSha256(left) === canonicalSha256(right);
}
export const setStrokeStyleResultSchema = z.union([
    z.strictObject({ operation: z.literal(SET_STROKE_STYLE_OPERATION), applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ operation: z.literal(SET_STROKE_STYLE_OPERATION), applied: z.literal(true), document: documentContextSchema, plan: planSchema, postcondition: postconditionSchema, transaction: transactionSchema }),
]).superRefine((result, context) => {
    if (result.applied) {
        if (result.transaction.state !== 'verified')
            context.addIssue({ code: 'custom', message: 'Applied stroke style requires a verified transaction.' });
        if (result.postcondition.targetUuid !== result.plan.targetUuid || !sameCanonical(result.postcondition.style, result.plan.after)) {
            context.addIssue({ code: 'custom', message: 'Stroke style postcondition must exactly match the planned UUID and style.', path: ['postcondition'] });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified stroke style transaction must be applied.' });
    }
    if (result.transaction.state !== 'planned' && !result.plan.applyAllowed) {
        context.addIssue({ code: 'custom', message: 'An applied stroke style attempt must derive from an allowed confirmed plan.' });
    }
    if (result.transaction.state === 'rolled_back' && !sameCanonical(result.transaction.rollback.restoredStyle, result.plan.before)) {
        context.addIssue({ code: 'custom', message: 'A rolled-back stroke style must prove the exact before style.' });
    }
});
export const setStrokeStyleResponseSchema = z.strictObject({
    outcome: setStrokeStyleResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
export const SET_STROKE_STYLE_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: SET_STROKE_STYLE_OPERATION,
    policy: {
        version: 1, class: 'update_existing', destructive: false,
        evidence: { identity: 'target_native_uuid', beforeState: 'before_state_hash', postcondition: 'updated_state_matches_plan' },
        preconditions: { documentBinding: 'explicit_document_key', compareAndSet: 'before_state_hash_match' },
        confirmation: 'exact_change_set',
        recovery: { mode: 'verified_inverse', verification: 'restored_state_matches_before_hash', partialRecovery: 'indeterminate' },
        terminal: { success: 'verified', failure: 'proven_pre_apply_or_verified_recovery', partialSuccess: 'nonterminal_until_reconciled' },
        replay: { requestBinding: 'canonical_request_digest', retry: 'return_attested_terminal_result', beforeTerminal: 'reconcile_required', reapplyOnRetry: false },
    },
    capabilities: {
        class: 'update_existing', explicitDocumentBinding: true, bindTargetNativeUuid: true, captureBeforeStateHash: true, compareAndSetBeforeApply: true,
        verifyUpdatedState: true, recoveryMode: 'verified_inverse', verifyRestoredBeforeState: true, reconcileIndeterminate: true, durableTerminalReplay: true, trustedTerminalAttestationResolver: true,
    },
});
export const SET_STROKE_STYLE_SAFETY_IDENTITY = canonicalDigest(SET_STROKE_STYLE_SAFETY);
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    const beforeStateHash = canonicalDigest(result.plan.before);
    const afterStateHash = canonicalDigest(result.plan.after);
    const changeSetHash = canonicalDigest({ targetUuid: result.plan.targetUuid, before: result.plan.before, after: result.plan.after });
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'update_existing', operationId: SET_STROKE_STYLE_OPERATION, canonicalRequestDigest: requestDigest,
        evidence: { documentKey: admissionDocumentKey, targetUuid: result.plan.targetUuid, beforeStateHash, plannedAfterStateHash: afterStateHash, plannedChangeSetDigest: changeSetHash },
        preconditions: { status: result.plan.applyAllowed ? 'satisfied' : 'blocked', compareAndSetMatched: result.plan.applyAllowed },
        confirmation: { kind: 'exact_change_set', canonicalRequestDigest: requestDigest, changeSetHash, status: result.plan.confirmationStatus },
        applyAllowed: result.plan.applyAllowed,
    });
}
function safetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' || transaction.state === 'rollback_indeterminate' || transaction.state === 'rollback_failed') {
        throw new Error('Indeterminate or failed recovery cannot be represented as a terminal stroke style result.');
    }
    const common = { policyVersion: 1, operationClass: 'update_existing', operationId: SET_STROKE_STYLE_OPERATION, canonicalRequestDigest: requestDigest, planDigest: plan.planDigest, attestation };
    const beforeStateHash = canonicalDigest(result.plan.before);
    const replay = { status: 'durable_terminal', action: 'return_attested_result', reapply: false };
    if (transaction.state === 'verified' && result.applied) {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { targetUuid: result.plan.targetUuid, beforeStateHash, afterStateHash: canonicalDigest(result.postcondition.style), restoredStateHash: null, restoredBeforeStateVerified: false },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'succeeded', terminal: true, recovery: 'not_required', proof: { kind: 'verified_postcondition' }, replay } });
    }
    if (transaction.state === 'rolled_back') {
        const restoredStateHash = canonicalDigest(transaction.rollback.restoredStyle);
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { targetUuid: result.plan.targetUuid, beforeStateHash, afterStateHash: null, restoredStateHash, restoredBeforeStateVerified: restoredStateHash === beforeStateHash },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'recovered', terminal: true, recovery: 'verified', proof: { kind: 'verified_recovery' }, replay } });
    }
    return operationSafetyResultSchema.parse({ ...common,
        evidence: { targetUuid: result.plan.targetUuid, beforeStateHash, afterStateHash: null, restoredStateHash: null, restoredBeforeStateVerified: false },
        executionEvidence: { outcome: 'proven_pre_apply' },
        resolution: { status: 'failed', terminal: true, recovery: 'not_required', proof: { kind: 'proven_pre_apply', mutationAttempted: false }, replay } });
}
async function assertSafety(value, requestDigest, attestation, resolver) {
    const result = setStrokeStyleResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null)
        throw new Error('Stroke style terminal result requires a durable attestation resolver.');
    await assertOperationSafetyAdapterConformance({ registration: SET_STROKE_STYLE_SAFETY, plan, result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
export async function assertStrokeStyleHostProfile(_input, services) {
    if (!services.applicationBundleId)
        throw new Error('Stroke style requires a resolved Illustrator bundle identity.');
    const observation = await new OsascriptHostProfileProbe(services.applicationBundleId).observeForEditSession();
    if (observation.profile !== 'foreground' || observation.lockState !== 'unlocked') {
        throw new Error('Stroke style requires the measured foreground and unlocked profile; no activation is performed.');
    }
}
export const SET_STROKE_STYLE_MODULE_SCRIPT = `
var STROKE_STYLE_SCENE_MAX_CHARS = ${STROKE_SCENE_MAX_CHARS};
var STROKE_STYLE_MAX_ITEMS = 32;

function strokeStyleNumber(value, name, minimum, maximum) {
  var number = mutationFiniteNumber(value, name);
  if (number < minimum || number > maximum) throw mutationError("preflight_failed", name + " is outside the supported range.");
  return Number(number);
}
function strokeStyleNums(values) {
  if (!values || typeof values.length !== "number" || values.length < 0 || values.length > 32 || Math.floor(values.length) !== values.length)
    throw mutationError("preflight_failed", "Unreadable stroke vector.");
  var out = [];
  for (var i = 0; i < values.length; i++) out.push(mutationFiniteNumber(values[i], "stroke vector"));
  return out;
}
function strokeStyleFields(value) {
  return { dashes: value.dashes, dash_offset: value.dash_offset, cap: value.cap, join: value.join, miter_limit: value.miter_limit };
}
/** The measured tuples only: the same predicate as isMeasuredStrokeStyle. */
function strokeStyleAdmitted(style) {
  if (style.dashes.length === 2) return style.dashes[1] > 0 && style.join === "miter" && style.miter_limit === 4 &&
    (style.dashes[0] === 0 ? style.cap === "round" && style.dash_offset === 0 : style.cap === "butt");
  return style.dashes.length === 0 && style.dash_offset === 0 && (style.cap === "butt" || style.join === "miter") &&
    ((style.cap === "butt" && style.join === "miter") || style.miter_limit === 4);
}
function strokeStyleValidateRequested(style) {
  if (!style || !(style.dashes instanceof Array) || (style.dashes.length !== 0 && style.dashes.length !== 2))
    throw mutationError("preflight_failed", "Stroke dashes must be [] or one dash/gap pair.");
  for (var i = 0; i < style.dashes.length; i++) strokeStyleNumber(style.dashes[i], "stroke.dashes", 0, 10000);
  strokeStyleNumber(style.dash_offset, "stroke.dash_offset", -10000, 10000);
  strokeStyleNumber(style.miter_limit, "stroke.miter_limit", 1, 500);
  if ((style.cap !== "butt" && style.cap !== "round" && style.cap !== "projecting") ||
      (style.join !== "miter" && style.join !== "round" && style.join !== "bevel"))
    throw mutationError("preflight_failed", "Unsupported stroke cap or join.");
  if (!strokeStyleAdmitted(style)) throw mutationError("preflight_failed", "Unmeasured stroke style combination.");
}
function strokeStyleRead(item) {
  var cap = null, join = null;
  if (String(item.strokeCap) === String(StrokeCap.BUTTENDCAP)) cap = "butt";
  else if (String(item.strokeCap) === String(StrokeCap.ROUNDENDCAP)) cap = "round";
  else if (String(item.strokeCap) === String(StrokeCap.PROJECTINGENDCAP)) cap = "projecting";
  if (String(item.strokeJoin) === String(StrokeJoin.MITERENDJOIN)) join = "miter";
  else if (String(item.strokeJoin) === String(StrokeJoin.ROUNDENDJOIN)) join = "round";
  else if (String(item.strokeJoin) === String(StrokeJoin.BEVELENDJOIN)) join = "bevel";
  if (cap === null || join === null) throw mutationError("preflight_failed", "Unreadable native stroke enum.");
  return { dashes: strokeStyleNums(item.strokeDashes), dash_offset: mutationFiniteNumber(item.strokeDashOffset, "dash offset"),
    cap: cap, join: join, miter_limit: mutationFiniteNumber(item.strokeMiterLimit, "miter limit") };
}
function strokeStyleWrite(item, style) {
  strokeStyleValidateRequested(style);
  var caps = { butt: StrokeCap.BUTTENDCAP, round: StrokeCap.ROUNDENDCAP, projecting: StrokeCap.PROJECTINGENDCAP };
  var joins = { miter: StrokeJoin.MITERENDJOIN, round: StrokeJoin.ROUNDENDJOIN, bevel: StrokeJoin.BEVELENDJOIN };
  item.strokeDashes = style.dashes.slice(0); item.strokeDashOffset = style.dash_offset;
  item.strokeCap = caps[style.cap]; item.strokeJoin = joins[style.join]; item.strokeMiterLimit = style.miter_limit;
}

// Expected crosses stringifyJson/parseJsonValue exactly once. Only live numeric leaves cross the same wire
// on comparison. Object key order is irrelevant, arrays are ordered, and no fields or epsilon are discarded.
function strokeStyleDifference(actual, expected, path) {
  var type = typeof actual, k, keys = [], difference;
  if (type !== typeof expected || (actual === null) !== (expected === null) ||
      (actual instanceof Array) !== (expected instanceof Array)) return path;
  if (type === "number") return parseJsonValue(stringifyJson(actual)) === expected ? null : path;
  if (actual === expected) return null;
  if (actual === null || type !== "object") return path;
  if (actual instanceof Array && actual.length !== expected.length) return path + ".length";
  for (k in actual) if (actual.hasOwnProperty(k)) keys.push(k);
  for (k in expected) if (expected.hasOwnProperty(k) && !actual.hasOwnProperty(k)) keys.push(k);
  keys.sort();
  for (var i = 0; i < keys.length; i++) {
    k = keys[i];
    if (!actual.hasOwnProperty(k) || !expected.hasOwnProperty(k)) return path + "." + k;
    difference = strokeStyleDifference(actual[k], expected[k], path + "." + k);
    if (difference !== null) return difference;
  }
  return null;
}
function strokeStyleEqual(left, right) {
  if (!left || !right) return false;
  return strokeStyleDifference(strokeStyleFields(left), parseJsonValue(stringifyJson(strokeStyleFields(right))), "style") === null;
}
function strokeStyleRequireWire(actual, expected, reason) {
  var difference = strokeStyleDifference(actual, expected, "scene");
  if (difference !== null) throw mutationError(reason, "Stroke scene mismatch at " + difference.substring(0, 256) + ".");
}

function strokeStylePaint(color) {
  if (color.typename === "CMYKColor") return { model: "cmyk", cyan: mutationFiniteNumber(color.cyan, "cyan"), magenta: mutationFiniteNumber(color.magenta, "magenta"), yellow: mutationFiniteNumber(color.yellow, "yellow"), black: mutationFiniteNumber(color.black, "black") };
  if (color.typename === "RGBColor") return { model: "rgb", red: mutationFiniteNumber(color.red, "red"), green: mutationFiniteNumber(color.green, "green"), blue: mutationFiniteNumber(color.blue, "blue") };
  if (color.typename === "GrayColor") return { model: "gray", gray: mutationFiniteNumber(color.gray, "gray") };
  if (color.typename === "NoColor") return { model: "none" };
  throw mutationError("preflight_failed", "Unreadable or unmeasured stroke scene paint.");
}
function strokeStyleRow(p) {
  var booleanFields = ["closed", "filled", "stroked", "fillOverprint", "strokeOverprint", "locked", "hidden", "editable", "clipping", "guides", "evenodd", "pixelAligned", "wrapped", "isIsolated", "sliced"];
  for (var b = 0; b < booleanFields.length; b++) if (typeof p[booleanFields[b]] !== "boolean")
    throw mutationError("preflight_failed", "Unreadable stroke protected flag: " + booleanFields[b] + ".");
  if (typeof p.uuid !== "string" || typeof p.name !== "string" || typeof p.note !== "string" || typeof p.uRL !== "string" ||
      p.blendingMode === undefined || p.blendingMode === null || p.artworkKnockout === undefined || p.artworkKnockout === null ||
      p.polarity === undefined || p.polarity === null) throw mutationError("preflight_failed", "Unreadable stroke protected identity or metadata.");
  var points = [], q;
  for (var i = 0; i < p.pathPoints.length; i++) {
    q = p.pathPoints[i]; points.push({ anchor: strokeStyleNums(q.anchor), left: strokeStyleNums(q.leftDirection), right: strokeStyleNums(q.rightDirection), type: String(q.pointType) });
  }
  return { uuid: String(p.uuid), type: p.typename, name: String(p.name), parent: String(p.parent.name),
    geometric: strokeStyleNums(p.geometricBounds), visible: strokeStyleNums(p.visibleBounds), control: strokeStyleNums(p.controlBounds),
    position: strokeStyleNums(p.position), width: mutationFiniteNumber(p.width, "width"), height: mutationFiniteNumber(p.height, "height"), points: points, closed: p.closed,
    filled: p.filled, stroked: p.stroked, fill: strokeStylePaint(p.fillColor), stroke: strokeStylePaint(p.strokeColor), strokeWidth: mutationFiniteNumber(p.strokeWidth, "strokeWidth"),
    style: strokeStyleRead(p), opacity: mutationFiniteNumber(p.opacity, "opacity"), blend: String(p.blendingMode), knockout: String(p.artworkKnockout), polarity: String(p.polarity),
    fillOverprint: p.fillOverprint, strokeOverprint: p.strokeOverprint, locked: p.locked, hidden: p.hidden, editable: p.editable,
    clipping: p.clipping, guides: p.guides, evenodd: p.evenodd, pixelAligned: p.pixelAligned, resolution: mutationFiniteNumber(p.resolution, "resolution"),
    wrapped: p.wrapped, isIsolated: p.isIsolated, sliced: p.sliced, visibilityVariable: p.visibilityVariable === null,
    note: String(p.note), url: String(p.uRL), tags: p.tags.length };
}
function strokeStyleScene(document) {
  var rows = [], selection = [], boards = [], layer = document.layers[0], i;
  for (i = 0; i < document.pageItems.length; i++) rows.push(strokeStyleRow(document.pageItems[i]));
  if (document.selection) for (i = 0; i < document.selection.length; i++) selection.push(String(document.selection[i].uuid));
  for (i = 0; i < document.artboards.length; i++) boards.push({ name: String(document.artboards[i].name), rect: strokeStyleNums(document.artboards[i].artboardRect) });
  return { document: { name: String(document.name), colorSpace: String(document.documentColorSpace), saved: document.saved,
    layers: document.layers.length, layer: { name: String(layer.name), locked: layer.locked, visible: layer.visible }, boards: boards,
    activeBoard: document.artboards.getActiveArtboardIndex(), selection: selection, swatches: document.swatches.length, spots: document.spots.length, gradients: document.gradients.length }, items: rows };
}
function strokeStyleClone(value) {
  if (value === null || typeof value !== "object") return value;
  var out = {}; if (value instanceof Array) out = [];
  for (var k in value) if (value.hasOwnProperty(k)) out[k] = strokeStyleClone(value[k]);
  return out;
}

/** True when the document is the measured one-layer CMYK scene of direct, plain PathItems; never throws on an unreadable item. */
function strokeStyleDocumentInScope(document) {
  try {
    if (String(document.documentColorSpace) !== String(DocumentColorSpace.CMYK) || document.layers.length !== 1 ||
        document.layers[0].layers.length !== 0 || document.pageItems.length > STROKE_STYLE_MAX_ITEMS) return false;
    var layer = document.layers[0];
    for (var i = 0; i < document.pageItems.length; i++) {
      var item = document.pageItems[i];
      // Nontargets are read and protected, never styled; their readable attributes need not be defaults.
      if (item.typename !== "PathItem" || item.parent !== layer || item.tags.length !== 0 || item.visibilityVariable !== null ||
          typeof item.uuid !== "string" || item.uuid.length === 0) return false;
    }
    return true;
  } catch (error) { return false; }
}
function strokeStyleShapeInScope(target, layer) {
  try {
    if (target.parent !== layer || target.closed !== false || target.clipping !== false || target.guides !== false || target.pathPoints.length !== 3) return false;
    for (var j = 0; j < 3; j++) {
      var q = target.pathPoints[j];
      if (String(q.pointType) !== String(PointType.CORNER) || !mutationSameSequence(q.anchor, q.leftDirection) || !mutationSameSequence(q.anchor, q.rightDirection)) return false;
    }
    var a = target.pathPoints[0].anchor, b = target.pathPoints[1].anchor, c = target.pathPoints[2].anchor;
    // Two-point and collinear straight routes are unmeasured.
    return (b[0] - a[0]) * (c[1] - b[1]) !== (b[1] - a[1]) * (c[0] - b[0]);
  } catch (error) { return false; }
}
function strokeStylePaintInScope(target) {
  try {
    return target.stroked === true && target.filled === true && target.fillColor.typename === "CMYKColor" && target.strokeColor.typename === "CMYKColor";
  } catch (error) { return false; }
}

function strokeStyleResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var doc = app.activeDocument;
  if (typeof params.targetUuid !== "string" || params.targetUuid.length === 0) throw mutationError("preflight_failed", "target_uuid is required.");
  strokeStyleValidateRequested(params.style);
  var resolved = resolvePageItem(doc, params.targetUuid);
  if (resolved === null) throw new Error("MCP_ERROR:" + stringifyJson({ code: "OBJECT_NOT_FOUND", uuid: params.targetUuid }));
  var target = resolved.item;
  if (resolved.typename !== "PathItem") throw new Error("MCP_ERROR:" + stringifyJson({ code: "OBJECT_TYPE_MISMATCH", uuid: params.targetUuid, expected: "PathItem", actual: resolved.typename }));
  if (typeof target.uuid !== "string" || target.uuid !== params.targetUuid) throw mutationError("preflight_failed", "Target native UUID is unavailable or changed.");
  var before = strokeStyleRead(target);
  var after = strokeStyleClone(strokeStyleFields(params.style));
  var blockers = [];
  function add(code) { for (var i = 0; i < blockers.length; i++) if (blockers[i] === code) return; blockers.push(code); }
  if (context.mutationAllowed !== true) add("document_mutation_not_allowed");
  if (context.mutationProfile !== "unsaved_document" || doc.saved !== false) add("stroke_saved_document_unmeasured");
  if (typeof target.locked !== "boolean" || typeof target.hidden !== "boolean" || typeof target.editable !== "boolean")
    throw mutationError("preflight_failed", "Target safety state is unavailable.");
  if (target.locked) add("target_locked");
  if (target.hidden) add("target_hidden");
  if (!target.locked && !target.hidden && !target.editable) add("target_not_editable");
  var sceneText = null;
  if (strokeStyleDocumentInScope(doc)) {
    var layer = doc.layers[0];
    if (typeof layer.locked !== "boolean" || typeof layer.visible !== "boolean") throw mutationError("preflight_failed", "Layer safety state is unavailable.");
    if (!layer.visible) add("layer_hidden");
    if (layer.locked) add("layer_locked");
    if (!strokeStyleShapeInScope(target, layer)) add("stroke_target_shape_unmeasured");
    if (!strokeStylePaintInScope(target)) add("stroke_paint_unmeasured");
    try {
      sceneText = stringifyJson(strokeStyleScene(doc));
      if (sceneText.length > STROKE_STYLE_SCENE_MAX_CHARS) { sceneText = null; add("stroke_document_scope_unmeasured"); }
    } catch (error) { sceneText = null; add("stroke_document_scope_unmeasured"); }
  } else add("stroke_document_scope_unmeasured");
  // A before tuple must also have a measured inverse route.
  if (!strokeStyleAdmitted(before)) add("stroke_style_unmeasured");
  if (strokeStyleEqual(before, after)) add("value_unchanged");
  if (forApply) {
    if (blockers.length > 0) throw new Error("MCP_ERROR:" + stringifyJson({ code: "STROKE_STYLE_APPLY_BLOCKED", reasonCodes: blockers, uuid: params.targetUuid }));
    if (!params.expectedBefore || !strokeStyleEqual(before, params.expectedBefore)) throw mutationError("preflight_failed", "Target stroke style does not match expected_before.");
    if (!params.confirmedAfter || !strokeStyleEqual(after, params.confirmedAfter)) throw mutationError("preflight_failed", "confirmed_after does not match the requested stroke style.");
    if (typeof params.expectedStrokeScene !== "string") throw mutationError("preflight_failed", "Copy plan.strokeScene into expected_stroke_scene.");
    strokeStyleRequireWire(parseJsonValue(sceneText), parseJsonValue(params.expectedStrokeScene), "preflight_failed");
  }
  return { context: context, document: doc, target: target, before: before, after: after, blockers: blockers,
    strokeScene: sceneText, strokeBefore: sceneText === null ? null : parseJsonValue(sceneText) };
}

function strokeStylePlan(preflight) {
  var plan = { operation: "set_stroke_style", documentKey: preflight.context.key, targetUuid: params.targetUuid,
    before: preflight.before, after: preflight.after, applyBlockedReasonCodes: preflight.blockers,
    confirmationStatus: params.apply === true ? "confirmed" : "required",
    applyAllowed: params.apply === true && preflight.blockers.length === 0 && preflight.strokeScene !== null };
  if (preflight.strokeScene !== null) plan.strokeScene = preflight.strokeScene;
  return plan;
}

function strokeStyleRevalidate(preflight, plan) {
  var current;
  try { current = strokeStyleResolve(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Stroke style preconditions changed before apply.")); }
  if (current.document !== preflight.document || current.target !== preflight.target || current.target.uuid !== plan.targetUuid ||
      !strokeStyleEqual(current.before, plan.before)) {
    throw mutationBeforeSideEffectError("Stroke style target or before-state changed before apply.");
  }
  try { strokeStyleRequireWire(strokeStyleScene(preflight.document), preflight.strokeBefore, "preflight_failed"); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Stroke scene changed before apply.")); }
}

function strokeStyleApply(preflight, plan, state) {
  state.operationState.mutationStarted = true;
  strokeStyleWrite(preflight.target, plan.after);
  return preflight.target;
}

function strokeStyleVerify(preflight, plan) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) throw mutationError("verify_mismatch", "Active document changed during stroke style verification.");
  var target = resolvePageItem(preflight.document, plan.targetUuid);
  if (target === null || target.item !== preflight.target || target.typename !== "PathItem") throw mutationError("verify_mismatch", "Stroke style target native identity does not match the plan.");
  var actual = strokeStyleRead(preflight.target);
  if (!strokeStyleEqual(actual, plan.after)) throw mutationError("verify_mismatch", "Stroke style read-back does not match the planned style.");
  // These are the measured forward changes. The full inverse in rollback includes visible and control bounds as well.
  var current = strokeStyleScene(preflight.document), expected = strokeStyleClone(preflight.strokeBefore);
  for (var i = 0; i < expected.items.length; i++) if (expected.items[i].uuid === plan.targetUuid) {
    expected.items[i].style = strokeStyleFields(plan.after);
    expected.items[i].visible = current.items[i].visible; expected.items[i].control = current.items[i].control;
  }
  strokeStyleRequireWire(current, expected, "verify_mismatch");
  return { targetUuid: plan.targetUuid, style: actual };
}

function strokeStyleRollback(state) {
  var preflight = state.preflight;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
  var found;
  try { found = resolvePageItem(preflight.document, params.targetUuid); }
  catch (error) { return { status: "indeterminate", message: "Rollback target lookup is indeterminate." }; }
  if (found === null || found.item !== preflight.target) return { status: "indeterminate", message: "Rollback target identity is indeterminate." };
  try { strokeStyleWrite(preflight.target, preflight.before); }
  catch (error) { return { status: "indeterminate", message: "Rollback write outcome is indeterminate." }; }
  var restored;
  try { restored = strokeStyleRead(preflight.target); }
  catch (error) { return { status: "indeterminate", message: "Rollback verification is indeterminate." }; }
  state.operationState.rollbackEvidence.restoredStyle = restored;
  try { strokeStyleRequireWire(strokeStyleScene(preflight.document), preflight.strokeBefore, "verify_mismatch"); }
  catch (error) { return { status: "indeterminate", message: "Rollback stroke scene is not completely restored." }; }
  return strokeStyleEqual(restored, preflight.before)
    ? { status: "verified" }
    : { status: "failed", message: "Rollback did not restore the exact before stroke style." };
}
`;
const SET_STROKE_STYLE_RUNNER_SCRIPT = `
var strokeStyleExecution = runMutationTransaction({
  apply: params.apply === true,
  initialOperationState: function () { return { mutationStarted: false, rollbackEvidence: { targetUuid: params.targetUuid, restoredStyle: null } }; },
  preflight: strokeStyleResolve,
  plan: strokeStylePlan,
  revalidate: strokeStyleRevalidate,
  applyMutation: strokeStyleApply,
  verify: strokeStyleVerify,
  rollback: strokeStyleRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () { return { reasonCode: "stroke_style_state_unknown", message: "Stroke style apply outcome is indeterminate.", evidence: { targetUuid: params.targetUuid, restoredStyle: null } }; },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var strokeStyleDocument = strokeStyleExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === strokeStyleExecution.preflight.document) strokeStyleDocument = getDocumentContext();
var result = {
  operation: "set_stroke_style",
  applied: strokeStyleExecution.transaction.state === "verified",
  document: strokeStyleDocument,
  plan: strokeStyleExecution.plan,
  transaction: strokeStyleExecution.transaction
};
if (strokeStyleExecution.transaction.state === "verified") result.postcondition = strokeStyleExecution.value;
`;
export const SET_STROKE_STYLE_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}${SET_STROKE_STYLE_MODULE_SCRIPT}${SET_STROKE_STYLE_RUNNER_SCRIPT}`;
export const SET_STROKE_STYLE_HOST_SCRIPT_DIGEST = canonicalSha256(SET_STROKE_STYLE_SCRIPT);
export const SET_STROKE_STYLE_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: SET_STROKE_STYLE_OPERATION, validator: SET_STROKE_STYLE_VALIDATOR,
    canonicalContractVersion: CANONICAL_VERSION, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: SET_STROKE_STYLE_SAFETY_IDENTITY, hostScriptDigest: SET_STROKE_STYLE_HOST_SCRIPT_DIGEST,
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    const digestRequest = 'commandId' in request ? (({ commandId: _commandId, ...rest }) => rest)(request) : request;
    const digest = canonicalSha256({ operation: SET_STROKE_STYLE_OPERATION, validator: SET_STROKE_STYLE_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: 'commandId' in request ? request.commandId : null, documentKey: request.expectedDocumentKey, digest };
}
export const setStrokeStyleToolContract = {
    name: 'illustrator_set_stroke_style',
    title: 'Plan or Set Stroke Style',
    description: 'Plan or apply a complete stroke style (dashes, dash_offset, cap, join, miter_limit together) on one open three-point straight PathItem bound by document key and native UUID: solid, dashed, round dots, or another cap, join or miter limit. Only these five style properties are written; fill, stroke color, width, opacity, geometry and every other object are compared before and after and must stay unchanged, otherwise the change is rolled back. Works in a never-saved one-layer CMYK document with enabled CMYK fill and stroke, with Illustrator in front and the screen unlocked. The plan returns before, after and strokeScene; apply sends them back as expected_before, confirmed_after and expected_stroke_scene (next_call fills them). Other documents, shapes and combinations are returned as blockers.',
    inputSchema,
    publicInputSchema: setStrokeStylePublicInputSchema,
    outputSchema: setStrokeStyleResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(SET_STROKE_STYLE_SAFETY.policy),
    normalizePublicInput,
};
export function createSetStrokeStyleAdapter() {
    return {
        version: 1, operation: SET_STROKE_STYLE_OPERATION, validator: SET_STROKE_STYLE_VALIDATOR,
        safety: SET_STROKE_STYLE_SAFETY, safetyRegistrationIdentity: SET_STROKE_STYLE_SAFETY_IDENTITY,
        adapterIdentity: SET_STROKE_STYLE_ADAPTER_IDENTITY, tool: setStrokeStyleToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: setStrokeStyleResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
        safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: SET_STROKE_STYLE_HOST_SCRIPT_DIGEST,
        beforeHost: assertStrokeStyleHostProfile,
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: SET_STROKE_STYLE_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: SET_STROKE_STYLE_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: SET_STROKE_STYLE_OPERATION, documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: SET_STROKE_STYLE_ADAPTER_IDENTITY, script: SET_STROKE_STYLE_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = setStrokeStyleResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back')
                return { state };
            if (state === 'planned')
                throw new Error('Stroke style plan is not a terminal mutation result.');
            throw new Error('Unverified stroke style recovery must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error, detail) {
            if (detail?.code === 'OBJECT_NOT_FOUND')
                return new Error(`No PageItem with UUID ${JSON.stringify(detail.uuid ?? '')} exists in the bound document.`);
            if (detail?.code === 'OBJECT_TYPE_MISMATCH')
                return new Error(`The item with UUID ${JSON.stringify(detail.uuid ?? '')} is a ${detail.actual ?? 'different type'}, not a PathItem.`);
            if (detail?.code === 'STROKE_STYLE_APPLY_BLOCKED')
                return new Error(`Stroke style change is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}.`);
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
