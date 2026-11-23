import { z } from 'zod';
import { OsascriptHostProfileProbe } from '../host-profile.js';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
export const NORMALIZE_STROKE_WIDTHS_OPERATION = 'normalize_stroke_widths';
export const NORMALIZE_STROKE_WIDTHS_VALIDATOR = { kind: NORMALIZE_STROKE_WIDTHS_OPERATION, version: 1 };
const CANONICAL_VERSION = 1;
const RESULT_SCHEMA_VERSION = 1;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
export const STROKE_SCENE_MAX_CHARS = 180_000;
const uuidSchema = z.string().min(1).max(255);
const documentKeySchema = z.string().min(1).max(16_384);
export const MEASURED_STROKE_WIDTHS = [
    { requested: 0.6, effective: 0.60000002384186 }, { requested: 0.67, effective: 0.6700000166893 },
    { requested: 0.74, effective: 0.74000000953674 }, { requested: 0.81, effective: 0.81000000238419 },
    { requested: 1.33, effective: 1.33000004291534 },
    { requested: 0.1 * 72 / 25.4, effective: 0.28346458077431 },
    { requested: 0.25 * 72 / 25.4, effective: 0.70866143703461 },
];
const widthRowSchema = z.strictObject({ uuid: uuidSchema, width: z.number().finite().nonnegative() });
export const strokeWidthsStateSchema = z.strictObject({ rows: z.array(widthRowSchema).min(1).max(256) });
const ruleSchema = z.strictObject({ min_pt: z.number().finite().nonnegative(), max_pt: z.number().finite().positive(),
    to_pt: z.number().finite().superRefine((value, ctx) => { if (!MEASURED_STROKE_WIDTHS.some(row => row.requested === value))
        ctx.addIssue({ code: 'custom', message: 'Choose one of the seven measured widths (pt).' }); }) });
export const strokeWidthsSchema = z.array(ruleSchema).max(7).superRefine((rules, ctx) => {
    for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        if (rule.min_pt >= rule.max_pt)
            ctx.addIssue({ code: 'custom', message: 'Intervals must have min_pt < max_pt.' });
        for (const prior of rules.slice(0, i))
            if (rule.min_pt < prior.max_pt && prior.min_pt < rule.max_pt)
                ctx.addIssue({ code: 'custom', message: 'Half-open intervals must not overlap.' });
    }
});
const targetsSchema = z.array(uuidSchema).min(1).max(256).superRefine((ids, ctx) => { if (new Set(ids).size !== ids.length)
    ctx.addIssue({ code: 'custom', message: 'UUIDs must be distinct.' }); });
const sceneSchema = z.string().min(1).max(STROKE_SCENE_MAX_CHARS)
    .describe('plan.strokeScene, unchanged: the complete ordered scene is compared at the existing JSON wire boundary.');
const commonInternal = { expectedDocumentKey: documentKeySchema, targetUuid: uuidSchema, targetUuids: targetsSchema, style: strokeWidthsSchema };
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({
        ...commonInternal, expectedBefore: strokeWidthsStateSchema, confirmedAfter: strokeWidthsStateSchema,
        expectedStrokeScene: z.string().min(1).max(STROKE_SCENE_MAX_CHARS), apply: z.literal(true), commandId: canonicalCommandIdSchema,
    }),
]);
const commonPublic = {
    expected_document_key: documentKeySchema,
    target_uuids: targetsSchema.describe('Complete explicit native PathItem UUID scope, at most 256. Include every compound sibling.'),
    mapping: strokeWidthsSchema.describe('[] reads the distribution only. Half-open [min_pt,max_pt) intervals. to_pt is one of 0.6,0.67,0.74,0.81,1.33,0.1*72/25.4,0.25*72/25.4; no guessed rounding.'),
};
export const normalizeStrokeWidthsPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({
        ...commonPublic, expected_before: strokeWidthsStateSchema, confirmed_after: strokeWidthsStateSchema,
        expected_stroke_scene: sceneSchema, apply: z.literal(true), command_id: applyCommandIdSchema,
    }),
]);
const inputSchema = z.strictObject({
    ...commonPublic, expected_before: strokeWidthsStateSchema.optional(), confirmed_after: strokeWidthsStateSchema.optional(),
    expected_stroke_scene: sceneSchema.optional(), apply: z.boolean().default(false), command_id: applyCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(normalizeStrokeWidthsPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = normalizeStrokeWidthsPublicInputSchema.parse(input);
    const common = { expectedDocumentKey: value.expected_document_key, targetUuid: value.target_uuids[0], targetUuids: value.target_uuids, style: value.mapping };
    return value.apply
        ? { ...common, expectedBefore: value.expected_before, confirmedAfter: value.confirmed_after, expectedStrokeScene: value.expected_stroke_scene, apply: true, commandId: value.command_id }
        : { ...common, apply: false };
}
export const STROKE_WIDTHS_BLOCKERS = ['document_mutation_not_allowed', 'target_not_editable', 'value_unchanged', 'stroke_saved_document_unmeasured'];
const blockerSchema = z.enum(STROKE_WIDTHS_BLOCKERS);
const planSchema = z.strictObject({
    operation: z.literal(NORMALIZE_STROKE_WIDTHS_OPERATION),
    documentKey: documentKeySchema,
    targetUuid: uuidSchema,
    scope: z.literal('explicit_target_uuids'),
    targetCount: z.number().int().positive().max(256),
    changedCount: z.number().int().nonnegative().max(256),
    before: strokeWidthsStateSchema,
    after: strokeWidthsStateSchema,
    distribution: z.array(z.strictObject({ width: z.number(), count: z.number().int(), color: z.string(), layer: z.string() })),
    changes: z.array(z.strictObject({ uuid: uuidSchema, before: z.number(), requested: z.number(), effectiveAfter: z.number() })),
    excluded: z.array(z.strictObject({ uuid: uuidSchema, reason: z.string() })),
    strokeScene: z.string().min(1).max(STROKE_SCENE_MAX_CHARS).optional(),
    applyBlockedReasonCodes: z.array(blockerSchema).max(STROKE_WIDTHS_BLOCKERS.length),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    const allowed = plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0 && plan.strokeScene !== undefined;
    if (plan.applyAllowed !== allowed)
        context.addIssue({ code: 'custom', message: 'Stroke widths applyAllowed must require confirmation, no blockers and the planned scene.' });
    if (plan.targetCount !== plan.before.rows.length || plan.changedCount !== plan.changes.length || plan.targetUuid !== plan.before.rows[0]?.uuid ||
        plan.after.rows.length !== plan.before.rows.length || plan.before.rows.some((row, index) => row.uuid !== plan.after.rows[index]?.uuid) ||
        new Set(plan.before.rows.map(row => row.uuid)).size !== plan.before.rows.length)
        context.addIssue({ code: 'custom', message: 'Width plan target identity/count mismatch.' });
    if (new Set(plan.applyBlockedReasonCodes).size !== plan.applyBlockedReasonCodes.length)
        context.addIssue({ code: 'custom', message: 'Stroke widths blockers must be unique.' });
});
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']), reasonCode: z.enum(['apply_failed', 'verify_mismatch']), message: z.string().min(1).max(500),
}).superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed'))
        context.addIssue({ code: 'custom', message: 'Stroke widths failure phase and reason code must match.' });
});
const indeterminateFailureSchema = z.strictObject({ phase: z.literal('apply'), reasonCode: z.literal('apply_indeterminate'), message: z.string().min(1).max(500) });
const rollbackEvidence = { targetUuid: uuidSchema, restoredStyle: strokeWidthsStateSchema.nullable() };
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
        context.addIssue({ code: 'custom', message: 'Stroke widths audit sequence does not match transaction state.' });
    transaction.audit.forEach((event, index) => { if (event.sequence !== index)
        context.addIssue({ code: 'custom', message: 'Stroke widths audit sequence must be contiguous.' }); });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' && event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode && event.message === transaction.failure.message);
        if (matches.length !== 1)
            context.addIssue({ code: 'custom', message: 'Stroke widths failure must match one audit event.' });
    }
});
const postconditionSchema = z.strictObject({ targetUuid: uuidSchema, style: strokeWidthsStateSchema, distribution: z.array(z.strictObject({ width: z.number(), count: z.number().int(), color: z.string(), layer: z.string() })) });
function sameCanonical(left, right) {
    return canonicalSha256(left) === canonicalSha256(right);
}
export const normalizeStrokeWidthsResultSchema = z.union([
    z.strictObject({ operation: z.literal(NORMALIZE_STROKE_WIDTHS_OPERATION), applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ operation: z.literal(NORMALIZE_STROKE_WIDTHS_OPERATION), applied: z.literal(true), document: documentContextSchema, plan: planSchema, postcondition: postconditionSchema, transaction: transactionSchema }),
]).superRefine((result, context) => {
    if (result.applied) {
        if (result.transaction.state !== 'verified')
            context.addIssue({ code: 'custom', message: 'Applied stroke widths requires a verified transaction.' });
        if (result.postcondition.targetUuid !== result.plan.targetUuid || !sameCanonical(result.postcondition.style, result.plan.after)) {
            context.addIssue({ code: 'custom', message: 'Stroke widths postcondition must exactly match the planned UUID and style.', path: ['postcondition'] });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified stroke widths transaction must be applied.' });
    }
    if (result.transaction.state !== 'planned' && !result.plan.applyAllowed) {
        context.addIssue({ code: 'custom', message: 'An applied stroke widths attempt must derive from an allowed confirmed plan.' });
    }
    if (result.transaction.state === 'rolled_back' && !sameCanonical(result.transaction.rollback.restoredStyle, result.plan.before)) {
        context.addIssue({ code: 'custom', message: 'A rolled-back stroke widths must prove the exact before style.' });
    }
});
export const normalizeStrokeWidthsResponseSchema = z.strictObject({
    outcome: normalizeStrokeWidthsResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
export const NORMALIZE_STROKE_WIDTHS_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: NORMALIZE_STROKE_WIDTHS_OPERATION,
    policy: {
        version: 1, class: 'update_existing', destructive: false,
        evidence: { identity: 'target_native_uuid_set', beforeState: 'before_state_hash', postcondition: 'updated_state_matches_plan' },
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
export const NORMALIZE_STROKE_WIDTHS_SAFETY_IDENTITY = canonicalDigest(NORMALIZE_STROKE_WIDTHS_SAFETY);
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    const beforeStateHash = canonicalDigest(result.plan.before);
    const afterStateHash = canonicalDigest(result.plan.after);
    const changeSetHash = canonicalDigest({ targetUuid: result.plan.targetUuid, before: result.plan.before, after: result.plan.after });
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'update_existing', operationId: NORMALIZE_STROKE_WIDTHS_OPERATION, canonicalRequestDigest: requestDigest,
        evidence: { documentKey: admissionDocumentKey, targetUuids: result.plan.before.rows.map(row => row.uuid), targetSetHash: canonicalDigest(result.plan.before.rows.map(row => row.uuid)), beforeStateHash, plannedAfterStateHash: afterStateHash, plannedChangeSetDigest: changeSetHash },
        preconditions: { status: result.plan.applyAllowed ? 'satisfied' : 'blocked', compareAndSetMatched: result.plan.applyAllowed },
        confirmation: { kind: 'exact_change_set', canonicalRequestDigest: requestDigest, changeSetHash, status: result.plan.confirmationStatus },
        applyAllowed: result.plan.applyAllowed,
    });
}
function safetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' || transaction.state === 'rollback_indeterminate' || transaction.state === 'rollback_failed') {
        throw new Error('Indeterminate or failed recovery cannot be represented as a terminal stroke widths result.');
    }
    const common = { policyVersion: 1, operationClass: 'update_existing', operationId: NORMALIZE_STROKE_WIDTHS_OPERATION, canonicalRequestDigest: requestDigest, planDigest: plan.planDigest, attestation };
    const beforeStateHash = canonicalDigest(result.plan.before);
    const replay = { status: 'durable_terminal', action: 'return_attested_result', reapply: false };
    if (transaction.state === 'verified' && result.applied) {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { targetUuids: result.plan.before.rows.map(row => row.uuid), targetSetHash: canonicalDigest(result.plan.before.rows.map(row => row.uuid)), beforeStateHash, afterStateHash: canonicalDigest(result.postcondition.style), restoredStateHash: null, restoredBeforeStateVerified: false },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'succeeded', terminal: true, recovery: 'not_required', proof: { kind: 'verified_postcondition' }, replay } });
    }
    if (transaction.state === 'rolled_back') {
        const restoredStateHash = canonicalDigest(transaction.rollback.restoredStyle);
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { targetUuids: result.plan.before.rows.map(row => row.uuid), targetSetHash: canonicalDigest(result.plan.before.rows.map(row => row.uuid)), beforeStateHash, afterStateHash: null, restoredStateHash, restoredBeforeStateVerified: restoredStateHash === beforeStateHash },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'recovered', terminal: true, recovery: 'verified', proof: { kind: 'verified_recovery' }, replay } });
    }
    return operationSafetyResultSchema.parse({ ...common,
        evidence: { targetUuids: result.plan.before.rows.map(row => row.uuid), targetSetHash: canonicalDigest(result.plan.before.rows.map(row => row.uuid)), beforeStateHash, afterStateHash: null, restoredStateHash: null, restoredBeforeStateVerified: false },
        executionEvidence: { outcome: 'proven_pre_apply' },
        resolution: { status: 'failed', terminal: true, recovery: 'not_required', proof: { kind: 'proven_pre_apply', mutationAttempted: false }, replay } });
}
async function assertSafety(value, requestDigest, attestation, resolver) {
    const result = normalizeStrokeWidthsResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null)
        throw new Error('Stroke widths terminal result requires a durable attestation resolver.');
    await assertOperationSafetyAdapterConformance({ registration: NORMALIZE_STROKE_WIDTHS_SAFETY, plan, result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
export async function assertStrokeWidthsHostProfile(_input, services) {
    if (!services.applicationBundleId)
        throw new Error('Stroke widths requires a resolved Illustrator bundle identity.');
    const observation = await new OsascriptHostProfileProbe(services.applicationBundleId).observeForEditSession();
    if (observation.profile !== 'foreground' || observation.lockState !== 'unlocked') {
        throw new Error('Stroke widths requires the measured foreground and unlocked profile; no activation is performed.');
    }
}
export const NORMALIZE_STROKE_WIDTHS_MODULE_SCRIPT = `
var WIDTHS983 = [[0.6,0.60000002384186],[0.67,0.6700000166893],[0.74,0.74000000953674],[0.81,0.81000000238419],[1.33,1.33000004291534],[0.1*72/25.4,0.28346458077431],[0.25*72/25.4,0.70866143703461]];
// Plain data only: stringifyJson is idempotent over a parse round trip, so no stringify -> parse -> stringify clone before comparing.
function strokeWidthsDifference(a,b){return stringifyJson(a)===stringifyJson(b);}
function strokeWidthsEqual(a,b){return !!a&&!!b&&strokeWidthsDifference(a,b);}
// Byte sizes by native regex counts; same values as documentKeyUtf8Bytes(stringifyJson(x)).length without a per-character loop or a byte array (P0 stop 3: ~170k-element arrays).
function strokeWidthsUtf8Length(text){
 if(!/[^\\x00-\\x7f]/.test(text))return text.length;
 var rest=text.replace(/[\\uD800-\\uDBFF][\\uDC00-\\uDFFF]/g,""),two=rest.length-rest.replace(/[\\u0080-\\u07FF]/g,"").length,three=rest.length-rest.replace(/[^\\x00-\\u07FF]/g,"").length;
 return (text.length-rest.length)*2+rest.length+two+2*three;
}
function strokeWidthsJsonStringBytes(s){var n=strokeWidthsUtf8Length(s)+2;if(/["\\\\\\x00-\\x1f]/.test(s))n+=(s.length-s.replace(/["\\\\]/g,"").length)+5*(s.length-s.replace(/[\\x00-\\x1f]/g,"").length);return n;}
function strokeWidthsJsonBytes(v){
 var n=2,count=0,i,key;
 if(v===null||v===undefined)return 4;
 if(typeof v==="number"||typeof v==="boolean")return String(v).length;
 if(typeof v==="string")return strokeWidthsJsonStringBytes(v);
 if(v instanceof Array){for(i=0;i<v.length;i++){n+=strokeWidthsJsonBytes(v[i]);count++;}}
 else for(key in v)if(v.hasOwnProperty(key)){n+=strokeWidthsJsonStringBytes(key)+1+strokeWidthsJsonBytes(v[key]);count++;}
 return count>0?n+count-1:n;
}
function strokeWidthsNums(x){var a=[],i;if(!x||x.length>256)throw mutationError("preflight_failed","Unreadable vector");for(i=0;i<x.length;i++)a.push(mutationFiniteNumber(x[i],"vector"));return a;}
function strokeWidthsPaint(c){if(String(c.typename)==="NoColor")return ["none"];if(String(c.typename)!=="CMYKColor")throw mutationError("preflight_failed","CMYK solid or no paint only");return ["cmyk",mutationFiniteNumber(c.cyan,"cyan"),mutationFiniteNumber(c.magenta,"magenta"),mutationFiniteNumber(c.yellow,"yellow"),mutationFiniteNumber(c.black,"black")];}
function strokeWidthsLayerKey(l){var out=[],par,index;while(l&&String(l.typename)==="Layer"){par=l.parent;index=-1;for(var k=0;k<par.layers.length;k++)if(par.layers[k]===l)index=k;out.unshift(index);l=par;}return out.join("/");}
// #30 native member.wrapped throws MRAP; retain an explicit not-read marker, never a fabricated false.
function strokeWidthsRow(p){
 var pts=[],i,q;for(i=0;i<p.pathPoints.length;i++){q=p.pathPoints[i];pts.push([strokeWidthsNums(q.anchor),strokeWidthsNums(q.leftDirection),strokeWidthsNums(q.rightDirection),String(q.pointType)]);}
 var parent=[String(p.parent.typename),String(p.parent.name)];if(String(p.parent.typename)!=="Layer")parent.push(String(p.parent.uuid));
 var row = [String(p.uuid),p.strokeWidth,String(p.name),parent,strokeWidthsLayerKey(p.layer)+":"+String(p.layer.name),p.filled,strokeWidthsPaint(p.fillColor),p.stroked,strokeWidthsPaint(p.strokeColor),strokeWidthsNums(p.strokeDashes),p.strokeDashOffset,String(p.strokeCap),String(p.strokeJoin),p.strokeMiterLimit,p.opacity,p.closed,p.clipping,p.evenodd,strokeWidthsNums(p.geometricBounds),pts,p.fillOverprint,p.strokeOverprint,String(p.blendingMode),p.locked,p.hidden,p.editable,String(p.note),String(p.uRL),p.tags.length,String(p.artworkKnockout),String(p.polarity),p.guides,p.sliced,String(p.parent.typename)==="CompoundPathItem"?{status:"not_read",reason:"compound_member_wrapped"}:{status:"read",value:p.wrapped},p.visibilityVariable===null,p.isIsolated];return [row[0],row[1],documentKeySha256Hex(stringifyJson(row.slice(2)))];
}
function strokeWidthsScene(d){
 var paths=[],containers=[],layers=[],boards=[],selection=[],seen={},n=0;
 function walk(c){var items=c.pageItems,i,p,t;for(i=0;i<items.length;i++){p=items[i];if(p.parent!==c)continue;t=String(p.typename);if(++n>1000)throw mutationError("preflight_failed","Scene exceeds 1000 items");if(t==="PathItem"){if(seen[String(p.uuid)])throw mutationError("preflight_failed","Duplicate UUID");seen[String(p.uuid)]=true;paths.push(strokeWidthsRow(p));}else if(t==="GroupItem"){containers.push([String(p.uuid),t,String(p.name),p.locked,p.hidden,p.opacity,String(p.blendingMode),p.clipped]);walk(p);}else if(t==="CompoundPathItem"){containers.push([String(p.uuid),t,String(p.name),p.locked,p.hidden,p.opacity,String(p.blendingMode)]);for(var j=0;j<p.pathItems.length;j++){var child=p.pathItems[j];if(seen[String(child.uuid)])throw mutationError("preflight_failed","Duplicate compound UUID");seen[String(child.uuid)]=true;paths.push(strokeWidthsRow(child));}}else throw mutationError("preflight_failed","Scene contains unsupported item type");}}
 function layerList(ls){for(var i=0;i<ls.length;i++){var l=ls[i];layers.push([String(l.name),l.locked,l.visible]);walk(l);layerList(l.layers);}}
 layerList(d.layers);for(var i=0;i<d.artboards.length;i++)boards.push([String(d.artboards[i].name),strokeWidthsNums(d.artboards[i].artboardRect)]);
 if(d.selection)for(i=0;i<d.selection.length;i++)selection.push(String(d.selection[i].uuid));
 return {paths:paths,containers:containers,layers:layers,boards:boards,selection:selection,resources:[d.swatches.length,d.spots.length,d.gradients.length],active:d.artboards.getActiveArtboardIndex()};
}
function strokeWidthsResolve(forApply){
 if(!(params.targetUuids instanceof Array)||params.targetUuids.length<1||params.targetUuids.length>256)throw mutationError("preflight_failed","Explicit target scope must contain 1..256 UUIDs");
 var context=forApply?requireDocument(params.expectedDocumentKey):requireDocumentForRead(params.expectedDocumentKey),d=app.activeDocument,scene=strokeWidthsScene(d),text=stringifyJson(scene),before={rows:[]},after={rows:[]},targets=[],changes=[],excluded=[],distribution=[],blockers=[],uidIndex={},i,j,p,w,desired,requested,rule,match,layer,uid;
 if(String(d.documentColorSpace)!==String(DocumentColorSpace.CMYK))throw mutationError("preflight_failed","CMYK document required");
 if(strokeWidthsUtf8Length(text)>${STROKE_SCENE_MAX_CHARS})throw mutationError("preflight_failed","Scene evidence exceeds supported result size");
 if(context.mutationAllowed!==true)blockers.push("document_mutation_not_allowed");
 if(context.mutationProfile!=="unsaved_document")blockers.push("stroke_saved_document_unmeasured");
 var sceneUuidCount={},bucketIndex={};for(j=0;j<scene.paths.length;j++)sceneUuidCount["u:"+scene.paths[j][0]]=(sceneUuidCount["u:"+scene.paths[j][0]]||0)+1;
 for(i=0;i<params.targetUuids.length;i++){
  p=d.getPageItemFromUuid(params.targetUuids[i]);if(!p||String(p.typename)!=="PathItem"||String(p.uuid)!==params.targetUuids[i])throw mutationError("preflight_failed","Target UUID/type changed");uid=params.targetUuids[i];targets.push(p);w=mutationFiniteNumber(p.strokeWidth,"width");desired=w;requested=null;
  if(p.locked||p.hidden||!p.editable)blockers.push("target_not_editable");var ancestor=p.parent;while(ancestor&&ancestor!==d){if(ancestor.locked||ancestor.hidden||ancestor.visible===false)blockers.push("target_not_editable");ancestor=ancestor.parent;}
  if(p.stroked){
   var color=stringifyJson(strokeWidthsPaint(p.strokeColor)),lname=strokeWidthsLayerKey(p.layer)+":"+String(p.layer.name),bucket=null;
   var bucketKey="b:"+String(w)+"\\n"+color+"\\n"+lname;bucket=bucketIndex[bucketKey]||null;
   if(bucket===null){bucket={width:w,count:0,color:color,layer:lname};distribution.push(bucket);bucketIndex[bucketKey]=bucket;}bucket.count++;
   for(j=0;j<params.style.length;j++){rule=params.style[j];if(w>=rule.min_pt&&w<rule.max_pt){requested=rule.to_pt;break;}}
   if(requested!==null){match=false;for(j=0;j<WIDTHS983.length;j++)if(requested===WIDTHS983[j][0]){desired=WIDTHS983[j][1];match=true;}if(!match)throw mutationError("preflight_failed","Unmeasured destination width");}
  }
  if(requested===null)excluded.push({uuid:uid,reason:p.stroked?"outside_intervals":"not_stroked"});
  else if(String(w)===String(desired))excluded.push({uuid:uid,reason:"value_unchanged"});
  else changes.push({uuid:uid,before:w,requested:requested,effectiveAfter:desired});
  if(sceneUuidCount["u:"+uid]!==1)throw mutationError("preflight_failed","Native UUID is not represented exactly once in scene evidence");uidIndex["u:"+uid]=i;before.rows.push({uuid:uid,width:w});after.rows.push({uuid:uid,width:desired});
 }
 // All compound children must belong to the scope and map to one identical effective width.
 // Each compound is walked once (all its siblings are scope members, so comparing with its first target covers every target); native UUIDs are read once, never inside a row loop.
 var checkedCompounds={};
 for(i=0;i<targets.length;i++)if(params.style.length>0&&String(targets[i].parent.typename)==="CompoundPathItem"){
  var compound=targets[i].parent,compoundKey="u:"+String(compound.uuid);
  if(checkedCompounds[compoundKey]===true)continue;checkedCompounds[compoundKey]=true;
  var siblings=compound.pathItems,siblingCount=siblings.length;
  for(j=0;j<siblingCount;j++){var pos=uidIndex["u:"+String(siblings[j].uuid)];
   if(pos===undefined||String(after.rows[pos].width)!==String(after.rows[i].width))throw mutationError("preflight_failed","Compound siblings must all be included with an identical effective width");}
 }
 if(changes.length===0)blockers.push("value_unchanged");var unique=[];for(i=0;i<blockers.length;i++){var found=false;for(j=0;j<unique.length;j++)if(unique[j]===blockers[i])found=true;if(!found)unique.push(blockers[i]);}blockers=unique;
 // Size the JSON record that is actually stored, including the second encoding of strokeScene.
 // A superset envelope bounds both success and rollback: every target may form its own after bucket,
 // before/after/postcondition/restored widths coexist here, and all 11 audit rows permitted by this adapter's exact transaction-state sequences carry
 // maximum 500-code-unit messages encoded as six-byte JSON escapes. Neither table size nor timing
 // is evidence that a durable record fits. Keep 4096 bytes for the private wrapper/final context.
 var auditBudget=[],maxMessage="",maxCode="",afterDistributionBudget=[];
 for(i=0;i<500;i++)maxMessage+="\\u0001";
 for(i=0;i<100;i++)maxCode+="\\u0001";
 for(i=0;i<11;i++)auditBudget.push({sequence:i,phase:"preflight",event:"failed",reasonCode:maxCode,message:maxMessage});
 for(i=0;i<targets.length;i++)afterDistributionBudget.push({width:after.rows[i].width,count:1,color:stringifyJson(strokeWidthsPaint(targets[i].strokeColor)),layer:strokeWidthsLayerKey(targets[i].layer)+":"+String(targets[i].layer.name)});
 var budgetPlan={operation:"normalize_stroke_widths",documentKey:context.key,targetUuid:params.targetUuid,scope:"explicit_target_uuids",targetCount:targets.length,changedCount:changes.length,before:before,after:after,distribution:distribution,changes:changes,excluded:excluded,strokeScene:text,applyBlockedReasonCodes:blockers,confirmationStatus:"confirmed",applyAllowed:true};
 var budgetRecord={commandId:"00000000-0000-4000-8000-000000000000",state:"completed",data:{operation:"normalize_stroke_widths",applied:true,document:context,plan:budgetPlan,postcondition:{targetUuid:params.targetUuid,style:after,distribution:afterDistributionBudget},transaction:{state:"rollback_indeterminate",audit:auditBudget,failure:{phase:"verify",reasonCode:"verify_mismatch",message:maxMessage},rollback:{status:"indeterminate",reasonCode:maxCode,message:maxMessage,targetUuid:params.targetUuid,restoredStyle:before}}}};
 if(strokeWidthsJsonBytes(budgetRecord)+4096>262144)throw mutationError("preflight_failed","Stroke width JSON result evidence exceeds durable record budget");

 if(forApply){if(blockers.length)throw mutationError("preflight_failed","Stroke width apply blocked: "+blockers.join(","));if(!strokeWidthsEqual(before,params.expectedBefore)||!strokeWidthsEqual(after,params.confirmedAfter)||text!==params.expectedStrokeScene)throw mutationError("preflight_failed","Stroke width CAS or confirmation mismatch");}
 return {context:context,document:d,target:targets[0],targets:targets,before:before,after:after,blockers:blockers,strokeScene:text,strokeBeforeText:text,distribution:distribution,changes:changes,excluded:excluded};
}
function strokeWidthsPlan(p){return {operation:"normalize_stroke_widths",documentKey:p.context.key,targetUuid:params.targetUuid,scope:"explicit_target_uuids",targetCount:p.targets.length,changedCount:p.changes.length,before:p.before,after:p.after,distribution:p.distribution,changes:p.changes,excluded:p.excluded,strokeScene:p.strokeScene,applyBlockedReasonCodes:p.blockers,confirmationStatus:params.apply?"confirmed":"required",applyAllowed:params.apply===true&&p.blockers.length===0};}
function strokeWidthsRevalidate(p,plan){var now;try{now=strokeWidthsResolve(true);}catch(e){throw mutationBeforeSideEffectError(mutationPublicMessage(e,"Stroke width preconditions changed"));}if(now.document!==p.document||!strokeWidthsEqual(now.before,p.before))throw mutationBeforeSideEffectError("Stroke width identity changed");}
function strokeWidthsApply(p,plan,state){state.operationState.mutationStarted=true;var requestedByUuid={};for(var k=0;k<p.changes.length;k++)requestedByUuid["u:"+p.changes[k].uuid]=p.changes[k].requested;for(var i=0;i<p.targets.length;i++){var row=plan.after.rows[i];if(String(plan.before.rows[i].width)!==String(row.width)){var requested=requestedByUuid["u:"+row.uuid];if(requested===undefined)throw mutationError("apply_failed","Missing requested width");p.targets[i].strokeWidth=requested;}}return p.targets;}
function strokeWidthsVerify(p,plan){
 if(app.activeDocument!==p.document)throw mutationError("verify_mismatch","Document changed");var expected=parseJsonValue(p.strokeBeforeText),now=strokeWidthsScene(p.document),rows=[],expectedAt={},i,j;for(j=0;j<expected.paths.length;j++)expectedAt["u:"+expected.paths[j][0]]=j;
 for(i=0;i<p.targets.length;i++){var target=p.document.getPageItemFromUuid(plan.after.rows[i].uuid);if(target!==p.targets[i])throw mutationError("verify_mismatch","Target identity changed");rows.push({uuid:String(target.uuid),width:target.strokeWidth});j=expectedAt["u:"+plan.after.rows[i].uuid];if(j!==undefined)expected.paths[j][1]=plan.after.rows[i].width;}
 if(!strokeWidthsEqual({rows:rows},plan.after)||!strokeWidthsDifference(now,expected))throw mutationError("verify_mismatch","Stroke width or protected scene mismatch");var distribution=[],bucketIndex={};for(i=0;i<p.targets.length;i++){var item=p.targets[i];if(!item.stroked)continue;var color=stringifyJson(strokeWidthsPaint(item.strokeColor)),layer=strokeWidthsLayerKey(item.layer)+":"+String(item.layer.name),bucketKey="b:"+String(item.strokeWidth)+"\\n"+color+"\\n"+layer,bucket=bucketIndex[bucketKey]||null;if(bucket===null){bucket={width:item.strokeWidth,count:0,color:color,layer:layer};distribution.push(bucket);bucketIndex[bucketKey]=bucket;}bucket.count++;}return {targetUuid:params.targetUuid,style:{rows:rows},distribution:distribution};
}
function strokeWidthsRollback(state){var p=state.preflight,i,target;if(!p||app.activeDocument!==p.document)return {status:"indeterminate",message:"Rollback document changed"};try{for(i=0;i<p.targets.length;i++){target=p.document.getPageItemFromUuid(p.before.rows[i].uuid);if(target!==p.targets[i])return {status:"indeterminate",message:"Rollback identity changed"};}for(i=0;i<p.targets.length;i++)p.targets[i].strokeWidth=p.before.rows[i].width;var restored={rows:[]};for(i=0;i<p.targets.length;i++)restored.rows.push({uuid:String(p.targets[i].uuid),width:p.targets[i].strokeWidth});state.operationState.rollbackEvidence.restoredStyle=restored;if(!strokeWidthsEqual(restored,p.before)||stringifyJson(strokeWidthsScene(p.document))!==p.strokeBeforeText)return {status:"indeterminate",message:"Rollback exact scene mismatch"};return {status:"verified"};}catch(e){return {status:"indeterminate",message:"Rollback outcome unknown"};}}

`;
const NORMALIZE_STROKE_WIDTHS_RUNNER_SCRIPT = `
var strokeWidthsExecution = runMutationTransaction({
  apply: params.apply === true,
  initialOperationState: function () { return { mutationStarted: false, rollbackEvidence: { targetUuid: params.targetUuid, restoredStyle: null } }; },
  preflight: strokeWidthsResolve,
  plan: strokeWidthsPlan,
  revalidate: strokeWidthsRevalidate,
  applyMutation: strokeWidthsApply,
  verify: strokeWidthsVerify,
  rollback: strokeWidthsRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () { return { reasonCode: "stroke_widths_state_unknown", message: "Stroke widths apply outcome is indeterminate.", evidence: { targetUuid: params.targetUuid, restoredStyle: null } }; },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var strokeWidthsDocument = strokeWidthsExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === strokeWidthsExecution.preflight.document) strokeWidthsDocument = getDocumentContext();
var result = {
  operation: "normalize_stroke_widths",
  applied: strokeWidthsExecution.transaction.state === "verified",
  document: strokeWidthsDocument,
  plan: strokeWidthsExecution.plan,
  transaction: strokeWidthsExecution.transaction
};
if (strokeWidthsExecution.transaction.state === "verified") result.postcondition = strokeWidthsExecution.value;
`;
export const NORMALIZE_STROKE_WIDTHS_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}${NORMALIZE_STROKE_WIDTHS_MODULE_SCRIPT}${NORMALIZE_STROKE_WIDTHS_RUNNER_SCRIPT}`;
export const NORMALIZE_STROKE_WIDTHS_HOST_SCRIPT_DIGEST = canonicalSha256(NORMALIZE_STROKE_WIDTHS_SCRIPT);
export const NORMALIZE_STROKE_WIDTHS_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: NORMALIZE_STROKE_WIDTHS_OPERATION, validator: NORMALIZE_STROKE_WIDTHS_VALIDATOR,
    canonicalContractVersion: CANONICAL_VERSION, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: NORMALIZE_STROKE_WIDTHS_SAFETY_IDENTITY, hostScriptDigest: NORMALIZE_STROKE_WIDTHS_HOST_SCRIPT_DIGEST,
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    const digestRequest = 'commandId' in request ? (({ commandId: _commandId, ...rest }) => rest)(request) : request;
    const digest = canonicalSha256({ operation: NORMALIZE_STROKE_WIDTHS_OPERATION, validator: NORMALIZE_STROKE_WIDTHS_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: 'commandId' in request ? request.commandId : null, documentKey: request.expectedDocumentKey, digest };
}
export const normalizeStrokeWidthsToolContract = {
    name: 'illustrator_normalize_stroke_widths',
    title: 'Read or Normalize Stroke Widths',
    description: 'Read raw stroke-width distributions with color/layer counts, or plan/apply half-open interval mappings over 1..256 explicit native PathItem UUIDs in an unsaved CMYK document. Empty mapping reads only. Seven measured destination widths only; the plan exposes requested and effectiveAfter without epsilon verification. Only strokeWidth is written. Every compound sibling must be included and receive the same width. DOM-visible paint, dashes, geometry and other attributes are preserved and exactly inverted on failure. Unmatched or unstroked paths are listed as excluded. Unobserved live effects are not certified. Foreground and unlocked only. Return before/after/strokeScene as expected_before/confirmed_after/expected_stroke_scene',
    inputSchema,
    publicInputSchema: normalizeStrokeWidthsPublicInputSchema,
    outputSchema: normalizeStrokeWidthsResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(NORMALIZE_STROKE_WIDTHS_SAFETY.policy),
    normalizePublicInput,
};
export function createNormalizeStrokeWidthsAdapter() {
    return {
        version: 1, operation: NORMALIZE_STROKE_WIDTHS_OPERATION, validator: NORMALIZE_STROKE_WIDTHS_VALIDATOR,
        safety: NORMALIZE_STROKE_WIDTHS_SAFETY, safetyRegistrationIdentity: NORMALIZE_STROKE_WIDTHS_SAFETY_IDENTITY,
        adapterIdentity: NORMALIZE_STROKE_WIDTHS_ADAPTER_IDENTITY, tool: normalizeStrokeWidthsToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: normalizeStrokeWidthsResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
        safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: NORMALIZE_STROKE_WIDTHS_HOST_SCRIPT_DIGEST,
        beforeHost: assertStrokeWidthsHostProfile,
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: NORMALIZE_STROKE_WIDTHS_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: NORMALIZE_STROKE_WIDTHS_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: NORMALIZE_STROKE_WIDTHS_OPERATION, documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: NORMALIZE_STROKE_WIDTHS_ADAPTER_IDENTITY, script: NORMALIZE_STROKE_WIDTHS_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = normalizeStrokeWidthsResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back')
                return { state };
            if (state === 'planned')
                throw new Error('Stroke widths plan is not a terminal mutation result.');
            throw new Error('Unverified stroke widths recovery must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error, detail) {
            if (detail?.code === 'OBJECT_NOT_FOUND')
                return new Error(`No PageItem with UUID ${JSON.stringify(detail.uuid ?? '')} exists in the bound document.`);
            if (detail?.code === 'OBJECT_TYPE_MISMATCH')
                return new Error(`The item with UUID ${JSON.stringify(detail.uuid ?? '')} is a ${detail.actual ?? 'different type'}, not a PathItem.`);
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
