import { z } from 'zod';
import { OsascriptHostProfileProbe } from '../host-profile.js';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { DEFAULT_RGB_BLACK_REPLACEMENT, RGB_BLACK_MAX_TARGETS, rgbBlackReplacementSchema } from '../rgb-black.js';
export const REPLACE_RGB_BLACK_OPERATION = 'replace_rgb_converted_black';
export const REPLACE_RGB_BLACK_VALIDATOR = { kind: REPLACE_RGB_BLACK_OPERATION, version: 1 };
const CANONICAL_VERSION = 1;
const RESULT_SCHEMA_VERSION = 1;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
export const RGB_BLACK_RECORD_LIMIT_BYTES = 262_144;
export const RGB_BLACK_RECORD_RESERVE_BYTES = 4_096;
export const RGB_BLACK_FIXED_BOUND_BYTES = 11 * 3_800 + 2 * 2 * 3_200 + 3_000;
const uuidSchema = z.string().min(1).max(255);
const documentKeySchema = z.string().min(1).max(16_384);
const channelSchema = z.number().finite().min(0).max(100);
const cmykRowSchema = z.tuple([channelSchema, channelSchema, channelSchema, channelSchema]);
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
export const rgbBlackRowSchema = z.strictObject({ uuid: uuidSchema, fill: cmykRowSchema.nullable(), stroke: cmykRowSchema.nullable(), rest: sha256Schema });
export const rgbBlackFactsSchema = z.strictObject({
    documents: z.number().int().nonnegative(), layers: z.number().int().nonnegative(), pageItems: z.number().int().nonnegative(),
    artboards: z.number().int().nonnegative(), selection: z.number().int().nonnegative(), activeLayer: z.string(),
});
export const rgbBlackStateSchema = z.strictObject({ rows: z.array(rgbBlackRowSchema).min(1).max(RGB_BLACK_MAX_TARGETS), facts: rgbBlackFactsSchema });
const targetsSchema = z.array(uuidSchema).min(1).max(RGB_BLACK_MAX_TARGETS).superRefine((ids, ctx) => {
    if (new Set(ids).size !== ids.length)
        ctx.addIssue({ code: 'custom', message: 'UUIDs must be distinct.' });
});
const replacementInputSchema = rgbBlackReplacementSchema;
const commonInternal = { expectedDocumentKey: documentKeySchema, targetUuid: uuidSchema, targetUuids: targetsSchema, replacement: replacementInputSchema };
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({
        ...commonInternal, expectedBefore: rgbBlackStateSchema, confirmedAfter: rgbBlackStateSchema, apply: z.literal(true), commandId: canonicalCommandIdSchema,
    }),
]);
const replacementField = replacementInputSchema.optional()
    .describe('CMYK to paint with, percent 0-100. Default C0 M0 Y0 K100. A value the preflight would itself call rgb_converted_black or four_color_solid_black is refused.');
const commonPublic = {
    expected_document_key: documentKeySchema,
    replacement: replacementField,
};
export const replaceRgbBlackPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({
        ...commonPublic, apply: z.literal(false).default(false),
        target_uuids: targetsSchema.optional().describe('Omit to let the server pick the first writable paths (at most 256, document order). Give the UUIDs of an earlier plan only to plan exactly those.'),
    }),
    z.strictObject({
        ...commonPublic, target_uuids: targetsSchema.describe('The plan\'s target_uuids, unchanged.'),
        expected_before: rgbBlackStateSchema, confirmed_after: rgbBlackStateSchema, apply: z.literal(true), command_id: applyCommandIdSchema,
    }),
]);
const inputSchema = z.strictObject({
    ...commonPublic, target_uuids: targetsSchema.optional(), expected_before: rgbBlackStateSchema.optional(), confirmed_after: rgbBlackStateSchema.optional(),
    apply: z.boolean().default(false), command_id: applyCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...fullInputSchema } = z.toJSONSchema(replaceRgbBlackPublicInputSchema, { io: 'input' });
function slimEchoes(node) {
    if (Array.isArray(node))
        return node.map(slimEchoes);
    if (typeof node !== 'object' || node === null)
        return node;
    const record = node;
    const out = {};
    for (const [key, value] of Object.entries(record)) {
        if (key === 'properties' && typeof value === 'object' && value !== null) {
            const properties = {};
            for (const [name, property] of Object.entries(value)) {
                properties[name] = name === 'expected_before' ? { type: 'object', description: "The plan's before, unchanged." }
                    : name === 'confirmed_after' ? { type: 'object', description: "The plan's after, unchanged." } : slimEchoes(property);
            }
            out[key] = properties;
        }
        else
            out[key] = slimEchoes(value);
    }
    return out;
}
const publishedInputSchema = slimEchoes(fullInputSchema);
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = replaceRgbBlackPublicInputSchema.parse(input);
    if (value.target_uuids === undefined)
        throw new Error('target_uuids are missing: the server picks them before the request is normalized.');
    const common = { expectedDocumentKey: value.expected_document_key, targetUuid: value.target_uuids[0], targetUuids: value.target_uuids, replacement: value.replacement ?? { ...DEFAULT_RGB_BLACK_REPLACEMENT } };
    return value.apply
        ? { ...common, expectedBefore: value.expected_before, confirmedAfter: value.confirmed_after, apply: true, commandId: value.command_id }
        : { ...common, apply: false };
}
export const REPLACE_RGB_BLACK_BLOCKERS = ['document_mutation_not_allowed', 'target_not_editable', 'nothing_to_replace'];
const blockerSchema = z.enum(REPLACE_RGB_BLACK_BLOCKERS);
const planSchema = z.strictObject({
    operation: z.literal(REPLACE_RGB_BLACK_OPERATION),
    documentKey: documentKeySchema,
    targetUuid: uuidSchema,
    scope: z.literal('explicit_target_uuids'),
    targetCount: z.number().int().positive().max(RGB_BLACK_MAX_TARGETS),
    changedCount: z.number().int().nonnegative().max(RGB_BLACK_MAX_TARGETS),
    replacement: rgbBlackReplacementSchema,
    before: rgbBlackStateSchema,
    after: rgbBlackStateSchema,
    changes: z.array(z.strictObject({ uuid: uuidSchema, slots: z.array(z.enum(['fill', 'stroke'])).min(1).max(2) })).max(RGB_BLACK_MAX_TARGETS),
    excluded: z.array(z.strictObject({ uuid: uuidSchema, reason: z.literal('not_rgb_converted_black') })).max(RGB_BLACK_MAX_TARGETS),
    applyBlockedReasonCodes: z.array(blockerSchema).max(REPLACE_RGB_BLACK_BLOCKERS.length),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    const allowed = plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0;
    if (plan.applyAllowed !== allowed)
        context.addIssue({ code: 'custom', message: 'RGB-black applyAllowed must require confirmation and no blockers.' });
    if (plan.targetCount !== plan.before.rows.length || plan.after.rows.length !== plan.before.rows.length || plan.changedCount !== plan.changes.length ||
        plan.targetUuid !== plan.before.rows[0]?.uuid || plan.before.rows.some((row, index) => row.uuid !== plan.after.rows[index]?.uuid) ||
        new Set(plan.before.rows.map((row) => row.uuid)).size !== plan.before.rows.length) {
        context.addIssue({ code: 'custom', message: 'RGB-black plan target identity/count mismatch.' });
    }
    if (new Set(plan.applyBlockedReasonCodes).size !== plan.applyBlockedReasonCodes.length)
        context.addIssue({ code: 'custom', message: 'RGB-black blockers must be unique.' });
});
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']), reasonCode: z.enum(['apply_failed', 'verify_mismatch']), message: z.string().min(1).max(500),
}).superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed'))
        context.addIssue({ code: 'custom', message: 'RGB-black failure phase and reason code must match.' });
});
const indeterminateFailureSchema = z.strictObject({ phase: z.literal('apply'), reasonCode: z.literal('apply_indeterminate'), message: z.string().min(1).max(500) });
const rollbackEvidence = { targetUuid: uuidSchema, restored: rgbBlackStateSchema.nullable() };
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
        rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.string().min(1).max(100), message: z.string().min(1).max(500), targetUuid: uuidSchema, restored: z.null() }),
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
        context.addIssue({ code: 'custom', message: 'RGB-black audit sequence does not match transaction state.' });
    transaction.audit.forEach((event, index) => { if (event.sequence !== index)
        context.addIssue({ code: 'custom', message: 'RGB-black audit sequence must be contiguous.' }); });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' && event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode && event.message === transaction.failure.message);
        if (matches.length !== 1)
            context.addIssue({ code: 'custom', message: 'RGB-black failure must match one audit event.' });
    }
});
const postconditionSchema = z.strictObject({ targetUuid: uuidSchema, state: rgbBlackStateSchema });
function sameCanonical(left, right) {
    return canonicalSha256(left) === canonicalSha256(right);
}
export const replaceRgbBlackResultSchema = z.union([
    z.strictObject({ operation: z.literal(REPLACE_RGB_BLACK_OPERATION), applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ operation: z.literal(REPLACE_RGB_BLACK_OPERATION), applied: z.literal(true), document: documentContextSchema, plan: planSchema, postcondition: postconditionSchema, transaction: transactionSchema }),
]).superRefine((result, context) => {
    if (result.applied) {
        if (result.transaction.state !== 'verified')
            context.addIssue({ code: 'custom', message: 'Applied RGB-black replacement requires a verified transaction.' });
        if (result.postcondition.targetUuid !== result.plan.targetUuid || !sameCanonical(result.postcondition.state, result.plan.after)) {
            context.addIssue({ code: 'custom', message: 'RGB-black postcondition must exactly match the planned UUIDs and state.', path: ['postcondition'] });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified RGB-black transaction must be applied.' });
    }
    if (result.transaction.state !== 'planned' && !result.plan.applyAllowed) {
        context.addIssue({ code: 'custom', message: 'An applied RGB-black attempt must derive from an allowed confirmed plan.' });
    }
    if (result.transaction.state === 'rolled_back' && !sameCanonical(result.transaction.rollback.restored, result.plan.before)) {
        context.addIssue({ code: 'custom', message: 'A rolled-back RGB-black replacement must prove the exact before state.' });
    }
});
export const replaceRgbBlackResponseSchema = z.strictObject({
    outcome: replaceRgbBlackResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
export const REPLACE_RGB_BLACK_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: REPLACE_RGB_BLACK_OPERATION,
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
export const REPLACE_RGB_BLACK_SAFETY_IDENTITY = canonicalDigest(REPLACE_RGB_BLACK_SAFETY);
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    const beforeStateHash = canonicalDigest(result.plan.before);
    const afterStateHash = canonicalDigest(result.plan.after);
    const changeSetHash = canonicalDigest({ targetUuid: result.plan.targetUuid, replacement: result.plan.replacement, before: result.plan.before, after: result.plan.after });
    const targetUuids = result.plan.before.rows.map((row) => row.uuid);
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'update_existing', operationId: REPLACE_RGB_BLACK_OPERATION, canonicalRequestDigest: requestDigest,
        evidence: { documentKey: admissionDocumentKey, targetUuids, targetSetHash: canonicalDigest(targetUuids), beforeStateHash, plannedAfterStateHash: afterStateHash, plannedChangeSetDigest: changeSetHash },
        preconditions: { status: result.plan.applyAllowed ? 'satisfied' : 'blocked', compareAndSetMatched: result.plan.applyAllowed },
        confirmation: { kind: 'exact_change_set', canonicalRequestDigest: requestDigest, changeSetHash, status: result.plan.confirmationStatus },
        applyAllowed: result.plan.applyAllowed,
    });
}
function safetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' || transaction.state === 'rollback_indeterminate' || transaction.state === 'rollback_failed') {
        throw new Error('Indeterminate or failed recovery cannot be represented as a terminal RGB-black result.');
    }
    const common = { policyVersion: 1, operationClass: 'update_existing', operationId: REPLACE_RGB_BLACK_OPERATION, canonicalRequestDigest: requestDigest, planDigest: plan.planDigest, attestation };
    const targetUuids = result.plan.before.rows.map((row) => row.uuid);
    const targetSetHash = canonicalDigest(targetUuids);
    const beforeStateHash = canonicalDigest(result.plan.before);
    const replay = { status: 'durable_terminal', action: 'return_attested_result', reapply: false };
    if (transaction.state === 'verified' && result.applied) {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { targetUuids, targetSetHash, beforeStateHash, afterStateHash: canonicalDigest(result.postcondition.state), restoredStateHash: null, restoredBeforeStateVerified: false },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'succeeded', terminal: true, recovery: 'not_required', proof: { kind: 'verified_postcondition' }, replay } });
    }
    if (transaction.state === 'rolled_back') {
        const restoredStateHash = canonicalDigest(transaction.rollback.restored);
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { targetUuids, targetSetHash, beforeStateHash, afterStateHash: null, restoredStateHash, restoredBeforeStateVerified: restoredStateHash === beforeStateHash },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'recovered', terminal: true, recovery: 'verified', proof: { kind: 'verified_recovery' }, replay } });
    }
    return operationSafetyResultSchema.parse({ ...common,
        evidence: { targetUuids, targetSetHash, beforeStateHash, afterStateHash: null, restoredStateHash: null, restoredBeforeStateVerified: false },
        executionEvidence: { outcome: 'proven_pre_apply' },
        resolution: { status: 'failed', terminal: true, recovery: 'not_required', proof: { kind: 'proven_pre_apply', mutationAttempted: false }, replay } });
}
async function assertSafety(value, requestDigest, attestation, resolver) {
    const result = replaceRgbBlackResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null)
        throw new Error('RGB-black terminal result requires a durable attestation resolver.');
    await assertOperationSafetyAdapterConformance({ registration: REPLACE_RGB_BLACK_SAFETY, plan, result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
export async function assertRgbBlackHostProfile(_input, services) {
    if (!services.applicationBundleId)
        throw new Error('RGB-black replacement requires a resolved Illustrator bundle identity.');
    const observation = await new OsascriptHostProfileProbe(services.applicationBundleId).observeForEditSession();
    if (observation.profile !== 'foreground' || observation.lockState !== 'unlocked') {
        throw new Error('RGB-black replacement requires the measured foreground and unlocked profile; no activation is performed.');
    }
}
export const RGB_BLACK_COMPOUND_RULE = 'all';
export const REPLACE_RGB_BLACK_MODULE_SCRIPT = `
var RGB_BLACK_COMPOUND_RULE = ${JSON.stringify(RGB_BLACK_COMPOUND_RULE)};
var RGB_BLACK_RECORD_LIMIT = ${RGB_BLACK_RECORD_LIMIT_BYTES};
var RGB_BLACK_RECORD_RESERVE = ${RGB_BLACK_RECORD_RESERVE_BYTES};
// 11 audit rows (500-unit message + 100-unit reason of six-byte escapes + keys), the failure and rollback messages, the plan scalars, the replacement and the result's own keys.
var RGB_BLACK_FIXED_BOUND = ${RGB_BLACK_FIXED_BOUND_BYTES};
// Direct comparison of two states (no stringify/parse/clone): numbers compare as String(), so a plan echoed at 15 significant digits (#920) still equals a fresh read.
function rgbBlackSameNums(a,b){var i;if(a===null||b===null)return a===b;if(a.length!==b.length)return false;for(i=0;i<a.length;i++)if(String(a[i])!==String(b[i]))return false;return true;}
function rgbBlackSameState(a,b){
 var i,x,y,f,g;
 if(!a||!b||!(a.rows instanceof Array)||!(b.rows instanceof Array)||a.rows.length!==b.rows.length)return false;
 f=a.facts;g=b.facts;
 if(!f||!g||f.documents!==g.documents||f.layers!==g.layers||f.pageItems!==g.pageItems||f.artboards!==g.artboards||f.selection!==g.selection||f.activeLayer!==g.activeLayer)return false;
 for(i=0;i<a.rows.length;i++){x=a.rows[i];y=b.rows[i];
  if(!x||!y||x.uuid!==y.uuid||x.rest!==y.rest||!rgbBlackSameNums(x.fill,y.fill)||!rgbBlackSameNums(x.stroke,y.stroke))return false;}
 return true;
}
function rgbBlackInkRound(value){return Math.round(value*1000000)/1000000;}
// The preflight's rgb_converted_black rule (printBlackClass), on the same raw native values.
function rgbBlackIsConverted(c){
 var cy=rgbBlackInkRound(c[0]),m=rgbBlackInkRound(c[1]),y=rgbBlackInkRound(c[2]),k=rgbBlackInkRound(c[3]),mx=Math.max(cy,m,y),mn=Math.min(cy,m,y);
 return k>=60&&k<100&&cy>=60&&m>=60&&y>=60&&mx-mn<=15;
}
function rgbBlackCanon(v){var r=Math.round(v*100000)/100000;return r===0?0:r;}
function rgbBlackCmyk(c){
 if(!c||String(c.typename)!=="CMYKColor")return null;
 return [mutationFiniteNumber(c.cyan,"cyan"),mutationFiniteNumber(c.magenta,"magenta"),mutationFiniteNumber(c.yellow,"yellow"),mutationFiniteNumber(c.black,"black")];
}
function rgbBlackNums(x){var a=[],i;if(!x||x.length>256)throw mutationError("preflight_failed","Unreadable vector");for(i=0;i<x.length;i++)a.push(mutationFiniteNumber(x[i],"vector"));return a;}
function rgbBlackPaint(c){
 var t=String(c.typename);
 if(t==="NoColor")return ["none"];
 if(t==="CMYKColor")return ["cmyk",c.cyan,c.magenta,c.yellow,c.black];
 if(t==="RGBColor")return ["rgb",c.red,c.green,c.blue];
 if(t==="GrayColor")return ["gray",c.gray];
 if(t==="SpotColor")return ["spot",String(c.spot.name),c.tint];
 if(t==="GradientColor")return ["gradient",String(c.gradient.name)];
 if(t==="PatternColor")return ["pattern",String(c.pattern.name)];
 return [t];
}
function rgbBlackLayerKey(l){var out=[],par,index,k;while(l&&String(l.typename)==="Layer"){par=l.parent;index=-1;for(k=0;k<par.layers.length;k++)if(par.layers[k]===l)index=k;out.unshift(index);l=par;}return out.join("/");}
// Every DOM-visible value of one target except the colors of the slots this call writes. #30: a compound member's .wrapped is MRAP, so it is never read.
function rgbBlackRest(p,skipFill,skipStroke){
 // Length-prefixed fields ("<length>:<text>;"), so no element can run into the next one; arrays are joined with "," inside their own field.
 var par=[String(p.parent.typename),String(p.parent.name)];if(String(p.parent.typename)!=="Layer")par.push(String(p.parent.uuid));
 var fields=[String(p.uuid),String(p.name),par.length+"/"+par.join("\u0001"),rgbBlackLayerKey(p.layer)+":"+String(p.layer.name),p.fillOverprint,p.strokeOverprint,String(p.blendingMode),p.locked,p.hidden,p.editable,p.filled,p.stroked,mutationFiniteNumber(p.strokeWidth,"width"),rgbBlackNums(p.strokeDashes).join(","),p.strokeDashOffset,String(p.strokeCap),String(p.strokeJoin),p.strokeMiterLimit,p.opacity,p.closed,p.clipping,p.evenodd,rgbBlackNums(p.geometricBounds).join(","),p.pathPoints.length,skipFill?"-":rgbBlackPaint(p.fillColor).join("\u0001"),skipStroke?"-":rgbBlackPaint(p.strokeColor).join("\u0001")];
 var text="",i,f;
 for(i=0;i<fields.length;i++){f=String(fields[i]);text+=f.length+":"+f+";";}
 return documentKeySha256Hex(text);
}
function rgbBlackFacts(d){var s=d.selection;return {documents:app.documents.length,layers:d.layers.length,pageItems:d.pageItems.length,artboards:d.artboards.length,selection:(s&&s.length)?s.length:0,activeLayer:String(d.activeLayer.name)};}
// Upper bound of the UTF-8 length of the JSON text of a string: a control character costs 6 bytes (\\u00XX), a quote or backslash 2, any non-ASCII code unit is counted as 6 (\\uXXXX
// or up to 4 raw bytes), the rest 1. Only short strings go through it (UUIDs, the layer name, the document context), never the whole record.
function rgbBlackEscBound(text){var n=0,i,c;for(i=0;i<text.length;i++){c=text.charCodeAt(i);if(c<32)n+=6;else if(c===34||c===92)n+=2;else if(c<128)n+=1;else n+=6;}return n;}
function rgbBlackNumsBound(a){var n=2,i;if(a===null)return 4;for(i=0;i<a.length;i++)n+=String(a[i]).length+1;return n;}
// A state row: {"uuid":"..","fill":[..],"stroke":[..],"rest":".."} (44 bytes of keys and punctuation, rest is 64 hex characters).
function rgbBlackRowBound(row,uuidBound){return uuidBound+rgbBlackNumsBound(row.fill)+rgbBlackNumsBound(row.stroke)+64+44;}
// An upper bound of the stored private record, from sizes only (no stringify of the record, no per-character loop over it): every row sits in before, after, the
// postcondition and the rollback evidence, plus its change or excluded entry; the document context and key are counted at their escaped length; and all 11 audit rows
// allowed by the exact transaction sequences carry a 500-code-unit message and a 100-code-unit reason of six-byte escapes. The 4096-byte wrapper reserve is added.
function rgbBlackBudget(context,targetUuid,before,after,changes,excluded,replacement){
 var bytes=RGB_BLACK_RECORD_RESERVE+RGB_BLACK_FIXED_BOUND,i,ub;
 bytes+=rgbBlackEscBound(stringifyJson(context))+rgbBlackEscBound(String(context.key))+2;
 bytes+=2*rgbBlackEscBound(String(targetUuid))+4;
 bytes+=4*(rgbBlackEscBound(String(before.facts.activeLayer))+2+160);
 for(i=0;i<before.rows.length;i++){
  ub=rgbBlackEscBound(before.rows[i].uuid)+2;
  bytes+=2*rgbBlackRowBound(before.rows[i],ub)+2*rgbBlackRowBound(after.rows[i],ub)+ub+90;
 }
 return bytes;
}
function rgbBlackResolve(forApply){
 var uuids=params.targetUuids;
 if(!(uuids instanceof Array)||uuids.length<1||uuids.length>${RGB_BLACK_MAX_TARGETS})throw mutationError("preflight_failed","Explicit target scope must contain 1..${RGB_BLACK_MAX_TARGETS} UUIDs");
 var context=forApply?requireDocument(params.expectedDocumentKey):requireDocumentForRead(params.expectedDocumentKey),d=app.activeDocument;
 if(String(d.documentColorSpace)!==String(DocumentColorSpace.CMYK))throw mutationError("preflight_failed","CMYK document required");
 var replacement=params.replacement,desired=[rgbBlackCanon(replacement.cyan),rgbBlackCanon(replacement.magenta),rgbBlackCanon(replacement.yellow),rgbBlackCanon(replacement.black)];
 var facts=rgbBlackFacts(d),targets=[],before={rows:[],facts:facts},after={rows:[],facts:facts},changes=[],excluded=[],blockers=[],signature=[],index={},i,j,p,uid,fillRaw,strokeRaw,fillMatch,strokeMatch,slots,ancestor;
 if(context.mutationAllowed!==true)blockers.push("document_mutation_not_allowed");
 for(i=0;i<uuids.length;i++){
  uid=uuids[i];
  p=d.getPageItemFromUuid(uid);
  if(!p||String(p.uuid)!==uid)throw mutationError("preflight_failed","Target UUID changed");
  if(String(p.typename)!=="PathItem")throw mutationError("preflight_failed","Target is not a PathItem");
  targets.push(p);index["u:"+uid]=i;
  if(p.locked||p.hidden||!p.editable||p.clipping)blockers.push("target_not_editable");
  ancestor=p.parent;while(ancestor&&ancestor!==d){if(ancestor.locked||ancestor.hidden||ancestor.visible===false)blockers.push("target_not_editable");ancestor=ancestor.parent;}
  fillRaw=p.filled?rgbBlackCmyk(p.fillColor):null;strokeRaw=p.stroked?rgbBlackCmyk(p.strokeColor):null;
  fillMatch=fillRaw!==null&&rgbBlackIsConverted(fillRaw);strokeMatch=strokeRaw!==null&&rgbBlackIsConverted(strokeRaw);
  slots=[];if(fillMatch)slots.push("fill");if(strokeMatch)slots.push("stroke");signature.push(slots.join("+"));
  var rest=rgbBlackRest(p,fillMatch,strokeMatch);
  before.rows.push({uuid:uid,fill:fillMatch?fillRaw:null,stroke:strokeMatch?strokeRaw:null,rest:rest});
  after.rows.push({uuid:uid,fill:fillMatch?desired:null,stroke:strokeMatch?desired:null,rest:rest});
  if(slots.length>0)changes.push({uuid:uid,slots:slots});else excluded.push({uuid:uid,reason:"not_rgb_converted_black"});
 }
 // A compound path is taken whole: every member is a target with the same matched slots. Each compound is read once; its members' UUIDs become plain strings first.
 var checked={};
 if(RGB_BLACK_COMPOUND_RULE==="all")for(i=0;i<targets.length;i++){
  if(String(targets[i].parent.typename)!=="CompoundPathItem")continue;
  var compound=targets[i].parent,ckey="u:"+String(compound.uuid);
  if(checked[ckey]===true)continue;checked[ckey]=true;
  var members=compound.pathItems,count=members.length,names=[];
  for(j=0;j<count;j++)names.push("u:"+String(members[j].uuid));
  for(j=0;j<count;j++){var pos=index[names[j]];if(pos===undefined||signature[pos]!==signature[i])throw mutationError("preflight_failed","Every member of a compound path must be a target with the same matched slots");}
 }
 if(changes.length===0)blockers.push("nothing_to_replace");
 var unique=[];for(i=0;i<blockers.length;i++){var found=false;for(j=0;j<unique.length;j++)if(unique[j]===blockers[i])found=true;if(!found)unique.push(blockers[i]);}blockers=unique;
 var budget=rgbBlackBudget(context,params.targetUuid,before,after,changes,excluded,replacement);
 if(budget>RGB_BLACK_RECORD_LIMIT)throw mutationError("preflight_failed","RGB-black JSON result evidence exceeds the durable record budget");
 if(forApply){
  if(blockers.length)throw mutationError("preflight_failed","RGB-black apply blocked: "+blockers.join(","));
  if(!rgbBlackSameState(before,params.expectedBefore)||!rgbBlackSameState(after,params.confirmedAfter))throw mutationError("preflight_failed","RGB-black CAS or confirmation mismatch");
 }
 return {context:context,document:d,target:targets[0],targets:targets,before:before,after:after,blockers:blockers,changes:changes,excluded:excluded,desired:desired};
}
function rgbBlackPlan(p){return {operation:"replace_rgb_converted_black",documentKey:p.context.key,targetUuid:params.targetUuid,scope:"explicit_target_uuids",targetCount:p.targets.length,changedCount:p.changes.length,replacement:params.replacement,before:p.before,after:p.after,changes:p.changes,excluded:p.excluded,applyBlockedReasonCodes:p.blockers,confirmationStatus:params.apply?"confirmed":"required",applyAllowed:params.apply===true&&p.blockers.length===0};}
function rgbBlackRevalidate(p,plan){var now;try{now=rgbBlackResolve(true);}catch(e){throw mutationBeforeSideEffectError(mutationPublicMessage(e,"RGB-black preconditions changed"));}if(now.document!==p.document||!rgbBlackSameState(now.before,p.before))throw mutationBeforeSideEffectError("RGB-black target identity changed");}
function rgbBlackColor(a){var v=new CMYKColor();v.cyan=a[0];v.magenta=a[1];v.yellow=a[2];v.black=a[3];return v;}
function rgbBlackApply(p,plan,state){
 state.operationState.mutationStarted=true;
 for(var i=0;i<p.targets.length;i++){var row=plan.after.rows[i];if(row.fill!==null)p.targets[i].fillColor=rgbBlackColor(row.fill);if(row.stroke!==null)p.targets[i].strokeColor=rgbBlackColor(row.stroke);}
 return p.targets;
}
// Read back each target the same way the plan read it. Written slots are compared at the five-decimal write precision; everything else must be identical.
function rgbBlackReadState(p,rowsPlan,written){
 var rows=[],i,t,row,fill,stroke,rest;
 if(app.activeDocument!==p.document)throw mutationError("verify_mismatch","Document changed");
 for(i=0;i<p.targets.length;i++){
  t=p.document.getPageItemFromUuid(rowsPlan[i].uuid);
  if(t!==p.targets[i])throw mutationError("verify_mismatch","Target identity changed");
  row=rowsPlan[i];
  fill=row.fill===null?null:rgbBlackCmyk(t.fillColor);stroke=row.stroke===null?null:rgbBlackCmyk(t.strokeColor);
  if((row.fill!==null&&fill===null)||(row.stroke!==null&&stroke===null))throw mutationError("verify_mismatch","A written slot no longer reads as CMYK");
  rest=rgbBlackRest(t,row.fill!==null,row.stroke!==null);
  rows.push({uuid:String(t.uuid),fill:fill===null?null:(written?[rgbBlackCanon(fill[0]),rgbBlackCanon(fill[1]),rgbBlackCanon(fill[2]),rgbBlackCanon(fill[3])]:fill),stroke:stroke===null?null:(written?[rgbBlackCanon(stroke[0]),rgbBlackCanon(stroke[1]),rgbBlackCanon(stroke[2]),rgbBlackCanon(stroke[3])]:stroke),rest:rest});
 }
 return {rows:rows,facts:rgbBlackFacts(p.document)};
}
function rgbBlackVerify(p,plan){
 var now=rgbBlackReadState(p,plan.after.rows,true);
 if(!rgbBlackSameState(now,plan.after))throw mutationError("verify_mismatch","Replaced colors or protected state mismatch");
 return {targetUuid:params.targetUuid,state:now};
}
function rgbBlackRollback(state){
 var p=state.preflight,i,t,row,restored;
 if(!p||app.activeDocument!==p.document)return {status:"indeterminate",message:"Rollback document changed"};
 try{
  for(i=0;i<p.targets.length;i++){t=p.document.getPageItemFromUuid(p.before.rows[i].uuid);if(t!==p.targets[i])return {status:"indeterminate",message:"Rollback identity changed"};}
  for(i=0;i<p.targets.length;i++){row=p.before.rows[i];if(row.fill!==null)p.targets[i].fillColor=rgbBlackColor(row.fill);if(row.stroke!==null)p.targets[i].strokeColor=rgbBlackColor(row.stroke);}
  restored=rgbBlackReadState(p,p.before.rows,false);
  state.operationState.rollbackEvidence.restored=restored;
  if(!rgbBlackSameState(restored,p.before))return {status:"indeterminate",message:"Rollback exact state mismatch"};
  return {status:"verified"};
 }catch(e){return {status:"indeterminate",message:"Rollback outcome unknown"};}
}
`;
const REPLACE_RGB_BLACK_RUNNER_SCRIPT = `
var rgbBlackExecution = runMutationTransaction({
  apply: params.apply === true,
  initialOperationState: function () { return { mutationStarted: false, rollbackEvidence: { targetUuid: params.targetUuid, restored: null } }; },
  preflight: rgbBlackResolve,
  plan: rgbBlackPlan,
  revalidate: rgbBlackRevalidate,
  applyMutation: rgbBlackApply,
  verify: rgbBlackVerify,
  rollback: rgbBlackRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () { return { reasonCode: "rgb_black_state_unknown", message: "RGB-black apply outcome is indeterminate.", evidence: { targetUuid: params.targetUuid, restored: null } }; },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var rgbBlackDocument = rgbBlackExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === rgbBlackExecution.preflight.document) rgbBlackDocument = getDocumentContext();
var result = {
  operation: "replace_rgb_converted_black",
  applied: rgbBlackExecution.transaction.state === "verified",
  document: rgbBlackDocument,
  plan: rgbBlackExecution.plan,
  transaction: rgbBlackExecution.transaction
};
if (rgbBlackExecution.transaction.state === "verified") result.postcondition = rgbBlackExecution.value;
`;
export const REPLACE_RGB_BLACK_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}${REPLACE_RGB_BLACK_MODULE_SCRIPT}${REPLACE_RGB_BLACK_RUNNER_SCRIPT}`;
export const REPLACE_RGB_BLACK_HOST_SCRIPT_DIGEST = canonicalSha256(REPLACE_RGB_BLACK_SCRIPT);
export const REPLACE_RGB_BLACK_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: REPLACE_RGB_BLACK_OPERATION, validator: REPLACE_RGB_BLACK_VALIDATOR,
    canonicalContractVersion: CANONICAL_VERSION, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: REPLACE_RGB_BLACK_SAFETY_IDENTITY, hostScriptDigest: REPLACE_RGB_BLACK_HOST_SCRIPT_DIGEST,
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    const digestRequest = 'commandId' in request ? (({ commandId: _commandId, ...rest }) => rest)(request) : request;
    const digest = canonicalSha256({ operation: REPLACE_RGB_BLACK_OPERATION, validator: REPLACE_RGB_BLACK_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: 'commandId' in request ? request.commandId : null, documentKey: request.expectedDocumentKey, digest };
}
export const replaceRgbBlackNoTargetsSchema = z.strictObject({
    outcome: z.strictObject({ operation: z.literal(REPLACE_RGB_BLACK_OPERATION), applied: z.literal(false), no_eligible_targets: z.literal(true), document: documentContextSchema }),
});
const toolOutputSchema = z.union([replaceRgbBlackResponseSchema, replaceRgbBlackNoTargetsSchema]);
export const replaceRgbBlackToolContract = {
    name: 'illustrator_replace_rgb_converted_black',
    title: 'Replace RGB-Converted Black With K100',
    description: 'Paints the fill/stroke of PathItems that illustrator_preflight_print calls rgb_converted_black (K 60-99 with C, M, Y at 60% or more within 15 points) with one CMYK replacement, K100 by default, in a CMYK document. Plan: omit target_uuids and the server picks up to 256 writable paths in document order and returns selection {eligible_total, remaining_eligible, by_value, excluded with reasons, out_of_scope}; call plan again after each apply until remaining_eligible is 0. Only the matched fill/stroke colors are written; every other DOM-visible value of each path is bound by a digest and must read back unchanged, and a failed apply is inverted exactly. Intended blacks (K100, rich black, overprint-avoidance black), text paint (#797) and gradient stops are never touched. Foreground and unlocked only. Apply with the plan\'s next_call.',
    inputSchema,
    publicInputSchema: replaceRgbBlackPublicInputSchema,
    outputSchema: toolOutputSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(REPLACE_RGB_BLACK_SAFETY.policy),
    normalizePublicInput,
};
export function createReplaceRgbBlackAdapter() {
    return {
        version: 1, operation: REPLACE_RGB_BLACK_OPERATION, validator: REPLACE_RGB_BLACK_VALIDATOR,
        safety: REPLACE_RGB_BLACK_SAFETY, safetyRegistrationIdentity: REPLACE_RGB_BLACK_SAFETY_IDENTITY,
        adapterIdentity: REPLACE_RGB_BLACK_ADAPTER_IDENTITY, tool: replaceRgbBlackToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: replaceRgbBlackResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
        safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: REPLACE_RGB_BLACK_HOST_SCRIPT_DIGEST,
        beforeHost: assertRgbBlackHostProfile,
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: REPLACE_RGB_BLACK_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: REPLACE_RGB_BLACK_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: REPLACE_RGB_BLACK_OPERATION, documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: REPLACE_RGB_BLACK_ADAPTER_IDENTITY, script: REPLACE_RGB_BLACK_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = replaceRgbBlackResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back')
                return { state };
            if (state === 'planned')
                throw new Error('RGB-black plan is not a terminal mutation result.');
            throw new Error('Unverified RGB-black recovery must remain indeterminate and retain its lock.');
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
