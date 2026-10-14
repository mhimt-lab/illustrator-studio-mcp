import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { POINT_TEXT_SNAPSHOT_SCRIPT } from './point-text-host-script.js';
import { AREA_TEXT_MAX_CODE_UNITS, AREA_TEXT_MAX_LINES, AREA_TEXT_SNAPSHOT_SCRIPT } from './area-text-host-script.js';
import { COMPOSED_AREA_LAYOUT_SCRIPT } from './area-text-layout.js';
import { areaRangeSemanticSchema, areaRangeBeforeSchema, predictAreaTextRange, changedAreaLineIndexes, AREA_RANGE_CHARACTER_KEYS, AREA_RANGE_COMMON_KEYS, AREA_RANGE_CORE_KEYS, AREA_RANGE_PARAGRAPH_KEYS, AREA_RANGE_FRAME_KEYS } from './area-text-range-snapshot.js';
import { textLookupFailureError } from './text-lookup-error.js';
export const REPLACE_AREA_TEXT_RANGE_OPERATION = 'replace_area_text_range';
export const REPLACE_AREA_TEXT_RANGE_VALIDATOR = { kind: REPLACE_AREA_TEXT_RANGE_OPERATION, version: 1 };
const CANONICAL_VERSION = 2;
const RESULT_SCHEMA_VERSION = 3;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 2;
const replacementSchema = z.string().max(AREA_TEXT_MAX_CODE_UNITS)
    .regex(/^[^\r\n]*$/u, 'A area-text range replacement must not contain a line break.');
const blockerSchema = z.enum([
    'document_mutation_not_allowed',
    'target_locked',
    'target_hidden',
    'target_not_editable',
    'layer_hidden',
    'layer_locked',
]);
export const areaTextRangePlanSchema = z.strictObject({
    operation: z.literal(REPLACE_AREA_TEXT_RANGE_OPERATION),
    documentKey: z.string().min(1).max(16_384), targetUuid: z.string().min(1).max(255),
    start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), replacement: replacementSchema,
    removed: z.string().min(1).max(AREA_TEXT_MAX_CODE_UNITS),
    before: areaRangeBeforeSchema, predictedAfter: areaRangeSemanticSchema,
    applyBlockedReasonCodes: z.array(blockerSchema), confirmationStatus: z.enum(['required', 'confirmed']), applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    try {
        const expected = predictAreaTextRange(plan.before.semantic, plan.start, plan.end, plan.replacement);
        if (canonicalSha256(expected) !== canonicalSha256(plan.predictedAfter) ||
            plan.removed !== plan.before.semantic.contents.slice(plan.start, plan.end) || plan.targetUuid !== plan.before.semantic.uuid ||
            plan.applyAllowed !== (plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0)) {
            context.addIssue({ code: 'custom', message: 'Area range plan must match the pure semantic oracle and exact admission state.' });
        }
    }
    catch (error) {
        context.addIssue({ code: 'custom', message: String(error) });
    }
});
const planSchema = areaTextRangePlanSchema;
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']),
    reasonCode: z.enum(['apply_failed', 'verify_mismatch']),
    message: z.string().min(1).max(500),
}).superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed')) {
        context.addIssue({ code: 'custom', message: 'Area-text range failure phase and reason code must match.' });
    }
});
const indeterminateFailureSchema = z.strictObject({
    phase: z.literal('apply'),
    reasonCode: z.literal('apply_indeterminate'),
    message: z.string().min(1).max(500),
});
const rollbackEvidence = {
    targetUuid: z.string().min(1).max(255),
    restoredSnapshot: areaRangeBeforeSchema.nullable(),
};
const transactionSchema = z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('planned'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('verified'), audit: mutationAuditSchema }),
    z.strictObject({
        state: z.literal('apply_failed'), failure: failureSchema,
        rollback: z.strictObject({ status: z.literal('not_required') }), audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rolled_back'), failure: failureSchema,
        rollback: z.strictObject({ status: z.literal('verified'), ...rollbackEvidence }), audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rollback_failed'), failure: failureSchema,
        rollback: z.strictObject({
            status: z.literal('failed'), reasonCode: z.literal('rollback_failed'),
            message: z.string().min(1).max(500), ...rollbackEvidence,
        }), audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('apply_indeterminate'), failure: indeterminateFailureSchema,
        rollback: z.strictObject({
            status: z.literal('indeterminate'), reasonCode: z.literal('text_state_unknown'),
            message: z.string().min(1).max(500), targetUuid: z.string().min(1).max(255),
            restoredSnapshot: z.null(),
        }), audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rollback_indeterminate'), failure: failureSchema,
        rollback: z.strictObject({
            status: z.literal('indeterminate'), reasonCode: z.literal('rollback_indeterminate'),
            message: z.string().min(1).max(500), ...rollbackEvidence,
        }), audit: mutationAuditSchema,
    }),
]).superRefine((transaction, context) => {
    const prefix = ['preflight:started:', 'preflight:succeeded:', 'plan:started:', 'plan:succeeded:'];
    let expected;
    if (transaction.state === 'planned') {
        expected = [...prefix, 'apply:skipped:not_requested', 'verify:skipped:not_requested', 'rollback:skipped:not_requested'];
    }
    else if (transaction.state === 'verified') {
        expected = [...prefix, 'apply:started:', 'apply:attempted:', 'apply:succeeded:',
            'verify:started:', 'verify:succeeded:', 'rollback:skipped:not_required'];
    }
    else if (transaction.state === 'apply_failed') {
        expected = [...prefix, 'apply:started:', 'apply:failed:apply_failed',
            'verify:skipped:not_required', 'rollback:skipped:not_required'];
    }
    else if (transaction.state === 'apply_indeterminate') {
        expected = [...prefix, 'apply:started:', 'apply:attempted:', 'apply:failed:apply_indeterminate'];
    }
    else {
        const failure = transaction.failure.phase === 'apply'
            ? ['apply:started:', 'apply:attempted:', 'apply:failed:apply_failed', 'verify:skipped:not_required']
            : ['apply:started:', 'apply:attempted:', 'apply:succeeded:', 'verify:started:', 'verify:failed:verify_mismatch'];
        expected = [...prefix, ...failure, 'rollback:started:', transaction.state === 'rolled_back'
                ? 'rollback:succeeded:'
                : `rollback:failed:${transaction.state === 'rollback_failed' ? 'rollback_failed' : 'rollback_indeterminate'}`];
    }
    const actual = transaction.audit.map((event) => `${event.phase}:${event.event}:${'reasonCode' in event ? event.reasonCode : ''}`);
    if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
        context.addIssue({ code: 'custom', message: 'Area-text range audit sequence does not match transaction state.' });
    }
    transaction.audit.forEach((event, index) => {
        if (event.sequence !== index) {
            context.addIssue({ code: 'custom', message: 'Area-text range audit sequence must be contiguous.' });
        }
    });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' &&
            event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode &&
            event.message === transaction.failure.message);
        if (matches.length !== 1) {
            context.addIssue({ code: 'custom', message: 'Area-text range failure must match one audit event.' });
        }
    }
});
const areaRangeResultContract = z.union([
    z.strictObject({
        operation: z.literal(REPLACE_AREA_TEXT_RANGE_OPERATION), applied: z.literal(false),
        document: documentContextSchema, plan: planSchema, transaction: transactionSchema,
    }),
    z.strictObject({
        operation: z.literal(REPLACE_AREA_TEXT_RANGE_OPERATION), applied: z.literal(true),
        document: documentContextSchema, plan: planSchema,
        postcondition: areaRangeBeforeSchema, changedLineIndexes: z.array(z.number().int().nonnegative().max(AREA_TEXT_MAX_LINES)), transaction: transactionSchema,
    }),
]).superRefine((result, context) => {
    if (result.transaction.state === 'planned') {
        const before = result.plan.before.semantic;
        const blockers = [];
        if (!result.document.mutationAllowed)
            blockers.push('document_mutation_not_allowed');
        if (before.locked)
            blockers.push('target_locked');
        if (before.hidden)
            blockers.push('target_hidden');
        if (!before.editable)
            blockers.push('target_not_editable');
        if (before.layerAncestry.some((ancestor) => !ancestor.visible))
            blockers.push('layer_hidden');
        if (before.layerAncestry.some((ancestor) => ancestor.locked))
            blockers.push('layer_locked');
        if (result.plan.confirmationStatus !== 'required' ||
            canonicalSha256(result.plan.applyBlockedReasonCodes) !==
                canonicalSha256(blockers)) {
            context.addIssue({ code: 'custom', message: 'Planned area-text range edit must expose exact blockers.' });
        }
    }
    else if (result.plan.confirmationStatus !== 'confirmed' ||
        result.plan.applyBlockedReasonCodes.length !== 0 || !result.plan.applyAllowed) {
        context.addIssue({ code: 'custom', message: 'Applied area-text range edit must derive from an allowed confirmed plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified' ||
            canonicalSha256(result.postcondition.semantic) !==
                canonicalSha256(result.plan.predictedAfter)) {
            context.addIssue({ code: 'custom', message: 'A verified area-text range edit must match the exact after snapshot.' });
        }
        if (canonicalSha256(result.changedLineIndexes) !==
            canonicalSha256(changedAreaLineIndexes(result.plan.before.layout.lines, result.postcondition.layout.lines))) {
            context.addIssue({ code: 'custom', message: 'Changed line indexes must be derived from actual before/after line reads.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified area-text range transaction must be applied.' });
    }
    if (result.transaction.state === 'rolled_back' &&
        canonicalSha256(result.transaction.rollback.restoredSnapshot) !==
            canonicalSha256(result.plan.before)) {
        context.addIssue({ code: 'custom', message: 'A rolled-back area-text range edit must prove exact before restoration.' });
    }
});
export const replaceAreaTextRangeResultSchema = z.preprocess((value, context) => {
    if (value !== null && typeof value === 'object' && 'transaction' in value && 'plan' in value) {
        const candidate = value;
        if (candidate.transaction?.state === 'planned' && candidate.plan !== undefined && candidate.plan.predictedAfter === undefined) {
            const observed = candidate.plan;
            try {
                const before = areaRangeBeforeSchema.parse(observed.before);
                return { ...value, plan: { ...observed, predictedAfter: predictAreaTextRange(before.semantic, Number(observed.start), Number(observed.end), String(observed.replacement)) } };
            }
            catch (error) {
                context.addIssue({ code: 'custom', message: String(error) });
                return z.NEVER;
            }
        }
    }
    return value;
}, areaRangeResultContract);
export const replaceAreaTextRangeResponseSchema = z.strictObject({
    outcome: replaceAreaTextRangeResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
const commonInternal = {
    expectedDocumentKey: z.string().min(1).max(16_384),
    targetUuid: z.string().min(1).max(255),
    start: z.number().int().safe().nonnegative(),
    end: z.number().int().safe().nonnegative(),
    replacement: replacementSchema,
};
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({
        ...commonInternal,
        expectedBefore: areaRangeBeforeSchema,
        confirmedAfter: areaRangeSemanticSchema,
        apply: z.literal(true),
        commandId: canonicalCommandIdSchema,
    }),
]);
const commonPublic = {
    expected_document_key: z.string().min(1).max(16_384),
    target_uuid: z.string().min(1).max(255),
    start: z.number().int().safe().nonnegative(),
    end: z.number().int().safe().nonnegative(),
    replacement: replacementSchema,
};
export const replaceAreaTextRangePublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({
        ...commonPublic,
        expected_before: areaRangeBeforeSchema,
        confirmed_after: areaRangeSemanticSchema,
        apply: z.literal(true),
        command_id: applyCommandIdSchema,
    }),
]);
const inputSchema = z.strictObject({
    ...commonPublic,
    expected_before: areaRangeBeforeSchema.optional(),
    confirmed_after: areaRangeSemanticSchema.optional(),
    apply: z.boolean().default(false),
    command_id: applyCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(replaceAreaTextRangePublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = replaceAreaTextRangePublicInputSchema.parse(input);
    const common = {
        expectedDocumentKey: value.expected_document_key,
        targetUuid: value.target_uuid,
        start: value.start,
        end: value.end,
        replacement: value.replacement,
    };
    return value.apply
        ? { ...common, expectedBefore: value.expected_before, confirmedAfter: value.confirmed_after,
            apply: true, commandId: value.command_id }
        : { ...common, apply: false };
}
const REPLACE_AREA_TEXT_RANGE_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: REPLACE_AREA_TEXT_RANGE_OPERATION,
    policy: {
        version: 1, class: 'update_existing', destructive: false,
        evidence: { identity: 'target_native_uuid', beforeState: 'before_state_hash',
            postcondition: 'updated_state_matches_plan' },
        preconditions: { documentBinding: 'explicit_document_key', compareAndSet: 'before_state_hash_match' },
        confirmation: 'exact_change_set',
        recovery: { mode: 'verified_inverse', verification: 'restored_state_matches_before_hash',
            partialRecovery: 'indeterminate' },
        terminal: { success: 'verified', failure: 'proven_pre_apply_or_verified_recovery',
            partialSuccess: 'nonterminal_until_reconciled' },
        replay: { requestBinding: 'canonical_request_digest', retry: 'return_attested_terminal_result',
            beforeTerminal: 'reconcile_required', reapplyOnRetry: false },
    },
    capabilities: {
        class: 'update_existing', explicitDocumentBinding: true, bindTargetNativeUuid: true,
        captureBeforeStateHash: true, compareAndSetBeforeApply: true, verifyUpdatedState: true,
        recoveryMode: 'verified_inverse', verifyRestoredBeforeState: true, reconcileIndeterminate: true,
        durableTerminalReplay: true, trustedTerminalAttestationResolver: true,
    },
});
export const REPLACE_AREA_TEXT_RANGE_SAFETY_IDENTITY = canonicalDigest(REPLACE_AREA_TEXT_RANGE_SAFETY);
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    const beforeStateHash = canonicalDigest(result.plan.before);
    const afterStateHash = canonicalDigest(result.plan.predictedAfter);
    const changeSetHash = canonicalDigest({ targetUuid: result.plan.targetUuid, start: result.plan.start,
        end: result.plan.end, replacement: result.plan.replacement, beforeStateHash, afterStateHash });
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'update_existing', operationId: REPLACE_AREA_TEXT_RANGE_OPERATION,
        canonicalRequestDigest: requestDigest,
        evidence: { documentKey: admissionDocumentKey, targetUuid: result.plan.targetUuid,
            beforeStateHash, plannedAfterStateHash: afterStateHash, plannedChangeSetDigest: changeSetHash },
        preconditions: { status: result.plan.applyBlockedReasonCodes.length === 0 ? 'satisfied' : 'blocked',
            compareAndSetMatched: result.plan.applyBlockedReasonCodes.length === 0 },
        confirmation: { kind: 'exact_change_set', canonicalRequestDigest: requestDigest, changeSetHash,
            status: result.plan.confirmationStatus },
        applyAllowed: result.plan.applyAllowed,
    });
}
function safetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' ||
        transaction.state === 'rollback_indeterminate' || transaction.state === 'rollback_failed') {
        throw new Error('Indeterminate or failed area-text range recovery cannot be terminal.');
    }
    const common = { policyVersion: 1, operationClass: 'update_existing',
        operationId: REPLACE_AREA_TEXT_RANGE_OPERATION, canonicalRequestDigest: requestDigest,
        planDigest: plan.planDigest, attestation };
    const boundPlan = plan;
    const beforeStateHash = boundPlan.evidence.beforeStateHash;
    if (transaction.state === 'verified' && result.applied) {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { targetUuid: result.plan.targetUuid, beforeStateHash,
                afterStateHash: boundPlan.evidence.plannedAfterStateHash,
                restoredStateHash: null, restoredBeforeStateVerified: false },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'succeeded', terminal: true, recovery: 'not_required',
                proof: { kind: 'verified_postcondition' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    if (transaction.state === 'rolled_back') {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { targetUuid: result.plan.targetUuid, beforeStateHash, afterStateHash: null,
                restoredStateHash: beforeStateHash, restoredBeforeStateVerified: true },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'recovered', terminal: true, recovery: 'verified',
                proof: { kind: 'verified_recovery' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    return operationSafetyResultSchema.parse({ ...common,
        evidence: { targetUuid: result.plan.targetUuid, beforeStateHash, afterStateHash: null,
            restoredStateHash: null, restoredBeforeStateVerified: false },
        executionEvidence: { outcome: 'proven_pre_apply' },
        resolution: { status: 'failed', terminal: true, recovery: 'not_required',
            proof: { kind: 'proven_pre_apply', mutationAttempted: false },
            replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
}
async function assertSafety(value, requestDigest, attestation, resolver) {
    const result = replaceAreaTextRangeResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null) {
        throw new Error('Area-text range terminal result requires attestation.');
    }
    await assertOperationSafetyAdapterConformance({ registration: REPLACE_AREA_TEXT_RANGE_SAFETY, plan,
        result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
export const REPLACE_AREA_TEXT_RANGE_SCRIPT = `
${MUTATION_TRANSACTION_SCRIPT}
${POINT_TEXT_SNAPSHOT_SCRIPT}
${AREA_TEXT_SNAPSHOT_SCRIPT}
${COMPOSED_AREA_LAYOUT_SCRIPT}
function need(value, reason) { if (!value) throw mutationError("preflight_failed", reason); }
function rangeSame(a,b) {
  if(a===b)return true;
  if(a===null||b===null||typeof a!=="object"||typeof b!=="object")return false;
  var ak=[],bk=[],k,i;
  for(k in a)if(Object.prototype.hasOwnProperty.call(a,k))ak.push(k);
  for(k in b)if(Object.prototype.hasOwnProperty.call(b,k))bk.push(k);
  ak.sort();bk.sort();if(ak.length!==bk.length)return false;
  for(i=0;i<ak.length;i++)if(ak[i]!==bk[i]||!rangeSame(a[ak[i]],b[bk[i]]))return false;
  return true;
}
function rangeValue(v) {
  if(v===undefined)return "undefined";if(v===null)return "null";
  need(typeof v!=="number"||isFinite(v),"attribute_not_finite");
  return typeof v+":"+String(v);
}
function rangeProps(a,keys) {
  var out={},i,v;
  for(i=0;i<keys.length;i++) {
    v=a[keys[i]];need(v!==undefined||keys[i]==="contentVariable","attribute_unreadable:"+keys[i]);
    out[keys[i]]=rangeValue(v);
  }
  return out;
}
function rangeEncoded(a,keys) {
  var values=[],props=rangeProps(a,keys);
  for(var i=0;i<keys.length;i++)values.push(props[keys[i]]);
  return values;
}
function rangeColor(c) {
  var t=String(c.typename);
  if(t==="NoColor")return {model:t};
  if(t==="CMYKColor")return {model:t,cyan:c.cyan,magenta:c.magenta,yellow:c.yellow,black:c.black};
  if(t==="RGBColor")return {model:t,red:c.red,green:c.green,blue:c.blue};
  if(t==="GrayColor")return {model:t,gray:c.gray};
  throw mutationError("preflight_failed","unmeasured_color:"+t);
}
function rangeSnapshot(document,f,uuid) {
  need(String(app.version)==="30.8.2","host_version_unmeasured");
  need(f.typename==="TextFrame"&&f.kind===TextType.AREATEXT&&String(f.uuid)===uuid,"target_not_area_text");
  need(f.parent===f.layer&&f.story.textFrames.length===1&&f.story.textFrames[0]===f&&f.paragraphs.length===1,"area_shape_unmeasured");
  need(f.orientation===TextOrientation.HORIZONTAL&&f.columnCount===1&&f.rowCount===1&&f.flowLinksHorizontally===true,"area_shape_unmeasured");
  need(document.characterStyles.length===1,"named_style_catalog_unmeasured");
  var contents=String(f.contents);
  // Check before transporting any text or per-character data (B-setup could not return parseable JSON).
  need(!/[\\ud800-\\udfff]/.test(contents),"surrogate_contents_unmeasured");
  need(contents.length>=1&&contents.length<=5000&&!/[\\r\\n\\u0003]/.test(contents),"contents_not_single_paragraph");
  var cs=f.characters,n=cs.length,runs=[],shared=null,i,ch,a,extras,st;
  need(n===contents.length,"utf16_character_count");
  for(i=0;i<n;i++) {
    ch=cs[i];need(String(ch.contents)===contents.charAt(i),"character_contents_mismatch");a=ch.characterAttributes;
    // Read every measured attribute, not just the ones explicitly changed in the fixture.
    var all=rangeProps(a,${JSON.stringify(AREA_RANGE_CHARACTER_KEYS)});
    extras=[];st={values:[]};
    var commonKeys=${JSON.stringify(AREA_RANGE_COMMON_KEYS)},coreKeys=${JSON.stringify(AREA_RANGE_CORE_KEYS)},j;
    for(j=0;j<commonKeys.length;j++)extras.push(all[commonKeys[j]]);
    for(j=0;j<coreKeys.length;j++)st.values.push(all[coreKeys[j]]);
    if(shared===null)shared=extras;else need(rangeSame(shared,extras),"nonuniform_extra_character_state_unmeasured");
    st.font={postScriptName:String(a.textFont.name),family:String(a.textFont.family),style:String(a.textFont.style)};
    st.fillColor=rangeColor(a.fillColor);st.strokeColor=rangeColor(a.strokeColor);
    try {var kern=ch.kerning;throw new Error("manual_kerning_unmeasured:"+kern);}
    catch(e) {if(Number(e.number)!==9551)throw e;}
    if(runs.length>0&&rangeSame(runs[runs.length-1].style,st))runs[runs.length-1].end=i+1;
    else runs.push({start:i,end:i+1,style:st});
  }
  var p=f.paragraphs[0].paragraphAttributes,paragraph={values:rangeEncoded(p,${JSON.stringify(AREA_RANGE_PARAGRAPH_KEYS)})};
  need(p.justification===Justification.FULLJUSTIFYLASTLINELEFT,"justification_unmeasured");
  need(p.tabStops.length===0,"tab_stops_unmeasured");paragraph.tabStops=[];
  try {var list=p.listStyle.name;throw new Error("list_style_unmeasured:"+list);}
  catch(e) {need(Number(e.number)===9570,"list_style_unreadable");paragraph.listStyle="unbound:9570";}
  var b=f.geometricBounds,m=f.matrix,path=pointTextLayerPath(document,f.layer);
  need(path!==null,"layer_path_unreadable");
  return {uuid:String(f.uuid),kind:String(f.kind),profile:"area_text_range_v1",contents:contents,manualKerning:"none",
    commonCharacterState:shared,styleRuns:runs,paragraph:paragraph,frame:rangeEncoded(f,${JSON.stringify(AREA_RANGE_FRAME_KEYS)}),
    bounds:[b[0],b[1],b[2],b[3]],matrix:[m.mValueA,m.mValueB,m.mValueC,m.mValueD,m.mValueTX,m.mValueTY],
    paragraphs:1,storyFrames:1,layerDirect:true,layerPath:path,layerAncestry:pointTextAncestry(f),
    locked:f.locked,hidden:f.hidden,editable:f.editable,layerVisible:f.layer.visible,layerLocked:f.layer.locked};
}
function rangeRead(document,target,uuid) {
  var semantic=rangeSnapshot(document,target,uuid),layout=composedAreaLayout(target,semantic.contents);
  need(layout!==null&&layout.fit.status==="fits","area_text_not_fully_visible");
  return {semantic:semantic,layout:layout};
}
function rangeFind(document,uuid) {
  var item;
  try {item=document.getPageItemFromUuid(uuid);}catch(e){return null;}
  return item;
}
function rangeResolve(forApply) {
  var context=forApply?requireDocument(params.expectedDocumentKey):requireDocumentForRead(params.expectedDocumentKey);
  var document=app.activeDocument,target=rangeFind(document,params.targetUuid);
  need(target!==null,"object_not_found");
  var before=rangeRead(document,target,params.targetUuid),s=before.semantic,blockers=[];
  if(!context.mutationAllowed)blockers.push("document_mutation_not_allowed");
  if(s.locked)blockers.push("target_locked");if(s.hidden)blockers.push("target_hidden");if(!s.editable)blockers.push("target_not_editable");
  var hidden=false,locked=false,i;
  for(i=0;i<s.layerAncestry.length;i++){if(!s.layerAncestry[i].visible)hidden=true;if(s.layerAncestry[i].locked)locked=true;}
  if(hidden)blockers.push("layer_hidden");if(locked)blockers.push("layer_locked");
  if(forApply&&blockers.length>0)throw mutationBeforeSideEffectError("Area range apply blocked: "+blockers.join(","));
  return {context:context,document:document,target:target,before:before,blockers:blockers};
}
function rangeAdmit(before) {
  var s=params.start,e=params.end,t=params.replacement,runs=before.styleRuns,inherited=null,i;
  need(s>=0&&s<e&&e<=before.contents.length,"offset_out_of_range");
  need(!/[\\ud800-\\udfff]/.test(t),"surrogate_contents_unmeasured");
  need(!/[\\r\\n\\u0003]/.test(t),"replacement_not_single_paragraph");
  var length=before.contents.length+t.length-(e-s);
  need(length>=1&&length<=5000,"result_length_unsupported");
  for(i=0;i<runs.length;i++)if(runs[i].start<=s&&runs[i].end>=e)inherited=runs[i];
  need(inherited!==null,"range_style_not_uniform");
  need(!(s>0&&inherited.start===s)&&!(e<before.contents.length&&inherited.end===e),"range_style_edge_unmeasured");
}
function rangePreflight(forApply) {
  var p=rangeResolve(forApply);rangeAdmit(p.before.semantic);
  if(forApply) {
    need(rangeSame(p.before,params.expectedBefore),"stale_expected_before");
  }
  return p;
}
function rangeUtf8Bytes(text) {
  var bytes=0,c;
  for(var i=0;i<text.length;i++){c=text.charCodeAt(i);if(c<128)bytes+=1;else if(c<2048)bytes+=2;else bytes+=3;}
  return bytes;
}
function rangePlan(p) {
  var plan={operation:"replace_area_text_range",documentKey:p.context.key,targetUuid:params.targetUuid,
    start:params.start,end:params.end,replacement:params.replacement,removed:p.before.semantic.contents.substring(params.start,params.end),
    before:p.before,applyBlockedReasonCodes:p.blockers,
    confirmationStatus:params.apply===true?"confirmed":"required",applyAllowed:params.apply===true&&p.blockers.length===0};
  if(params.apply===true)plan.predictedAfter=params.confirmedAfter;
  need(rangeUtf8Bytes(stringifyJson(plan))<=60000,"snapshot_transport_budget_exceeded");
  return plan;
}
function rangeRevalidate(p,plan) {
  var current;
  try {current=rangeResolve(true);}catch(e){throw mutationBeforeSideEffectError(mutationPublicMessage(e,"Area range preconditions changed."));}
  if(current.document!==p.document||current.target!==p.target||!rangeSame(current.before,plan.before)) {
    throw mutationBeforeSideEffectError("Area range target or exact semantic/layout state changed before apply.");
  }
}
// F0's measured primitive. Empty inverse gaps only insert; never replace full frame contents.
function rangeWrite(target,start,end,text) {
  var i;
  if(text.length>0)target.insertionPoints[start].characters.add(text);
  for(i=start;i<end;i++)target.characters[start+text.length].remove();
}
function rangeApply(p,plan,state) {
  state.operationState.mutationStarted=true;
  rangeWrite(p.target,params.start,params.end,params.replacement);
  return p.target;
}
function rangeVerify(p,plan) {
  if(app.documents.length===0||app.activeDocument!==p.document||rangeFind(p.document,params.targetUuid)!==p.target) {
    throw mutationError("verify_mismatch","Area range target identity changed.");
  }
  var actual=rangeRead(p.document,p.target,params.targetUuid);
  if(!rangeSame(actual.semantic,plan.predictedAfter))throw mutationError("verify_mismatch","Area range semantic postcondition differs.");
  return actual;
}
function rangeRollback(state) {
  var p=state.preflight,current,target;
  if(!p||app.documents.length===0||app.activeDocument!==p.document)return {status:"indeterminate",message:"Rollback document identity is unknown."};
  try {
    target=rangeFind(p.document,params.targetUuid);
    if(target!==p.target)return {status:"indeterminate",message:"Rollback target identity is unknown."};
    current=rangeSnapshot(p.document,target,params.targetUuid);
  }catch(e){return {status:"indeterminate",message:"Rollback semantic read is unknown."};}
  if(!rangeSame(current,p.before.semantic)) {
    if(!rangeSame(current,params.confirmedAfter))return {status:"indeterminate",message:"Partial/unknown text state; inverse refused."};
    try {rangeWrite(target,params.start,params.start+params.replacement.length,p.before.semantic.contents.substring(params.start,params.end));}
    catch(e){return {status:"indeterminate",message:"Inverse write outcome is unknown."};}
  }
  var restored;
  try {restored=rangeRead(p.document,target,params.targetUuid);}catch(e){return {status:"indeterminate",message:"Inverse layout verification is unknown."};}
  state.operationState.rollbackEvidence.restoredSnapshot=restored;
  return rangeSame(restored,p.before)?{status:"verified"}:{status:"failed",message:"Inverse did not restore exact semantic and line layout."};
}
var rangeExecution=runMutationTransaction({
  apply:params.apply===true,editSessionAffected: function(){return [params.targetUuid];},
  initialOperationState:function(){return {mutationStarted:false,rollbackEvidence:{targetUuid:params.targetUuid,restoredSnapshot:null}};},
  preflight:rangePreflight,plan:rangePlan,revalidate:rangeRevalidate,applyMutation:rangeApply,verify:rangeVerify,rollback:rangeRollback,
  hasMutationEvidence:function(state){return state.operationState.mutationStarted===true;},
  applyIndeterminate:function(){return {reasonCode:"text_state_unknown",message:"Area range outcome is indeterminate.",evidence:{targetUuid:params.targetUuid,restoredSnapshot:null}};},
  rollbackEvidence:function(state){return state.operationState.rollbackEvidence;}
});
var rangeDocument=rangeExecution.preflight.context;
if(app.documents.length>0&&app.activeDocument===rangeExecution.preflight.document)rangeDocument=getDocumentContext();
var result={operation:"replace_area_text_range",applied:rangeExecution.transaction.state==="verified",document:rangeDocument,
  plan:rangeExecution.plan,transaction:rangeExecution.transaction};
if(result.applied) {
  result.postcondition=rangeExecution.value;
  var beforeLines=result.plan.before.layout.lines,afterLines=result.postcondition.layout.lines,changed=[];
  for(var li=0;li<Math.max(beforeLines.length,afterLines.length);li++)if(beforeLines[li]!==afterLines[li])changed.push(li);
  result.changedLineIndexes=changed;
}

`;
export const REPLACE_AREA_TEXT_RANGE_HOST_SCRIPT_DIGEST = canonicalSha256(REPLACE_AREA_TEXT_RANGE_SCRIPT);
export const REPLACE_AREA_TEXT_RANGE_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: REPLACE_AREA_TEXT_RANGE_OPERATION,
    validator: REPLACE_AREA_TEXT_RANGE_VALIDATOR, canonicalContractVersion: CANONICAL_VERSION,
    resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: REPLACE_AREA_TEXT_RANGE_SAFETY_IDENTITY,
    hostScriptDigest: REPLACE_AREA_TEXT_RANGE_HOST_SCRIPT_DIGEST,
    mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    if (request.apply) {
        const predicted = predictAreaTextRange(request.expectedBefore.semantic, request.start, request.end, request.replacement);
        if (canonicalSha256(predicted) !== canonicalSha256(request.confirmedAfter)) {
            throw new Error('confirmed_after does not match the pure area-range semantic oracle.');
        }
    }
    if (Buffer.byteLength(JSON.stringify(request)) > 60000)
        throw new Error('snapshot_transport_budget_exceeded');
    const digestRequest = 'commandId' in request
        ? (({ commandId: _commandId, ...rest }) => rest)(request)
        : request;
    const digest = canonicalSha256({ operation: REPLACE_AREA_TEXT_RANGE_OPERATION,
        validator: REPLACE_AREA_TEXT_RANGE_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request,
        commandId: 'commandId' in request ? request.commandId : null,
        documentKey: request.expectedDocumentKey, digest };
}
export const replaceAreaTextRangeToolContract = {
    name: 'illustrator_replace_area_text_range',
    title: 'Plan or Replace an Area-Text Range',
    description: 'On Illustrator 30.8.2, plan or replace one non-empty UTF-16 range in a horizontal, unthreaded, layer-direct AREATEXT frame: one paragraph, one column/row, 1–5000 units, initially fully visible. FULLJUSTIFYLASTLINELEFT is measured. Other justifications are refused. Replacement may be empty and cannot contain line breaks. Surrogate-containing contents/replacements, unmeasured clusters, manual kerning, tab/list styles, mixed styles inside the range, and unmeasured style-run edges are refused. Mixed styles outside the range are preserved. Plan returns run-compressed preserve-only semantic state, actual composed lines and a pure semantic prediction. Apply requires exact expected_before (semantic and layout) and confirmed_after (semantic only), inserts at the native insertion point then removes the original span, verifies every preserved attribute and actual lines, and attempts an exact inverse on overset or mismatch. Unknown outcomes remain indeterminate. Line wrapping is read from Illustrator, never predicted.',
    inputSchema,
    publicInputSchema: replaceAreaTextRangePublicInputSchema,
    outputSchema: replaceAreaTextRangeResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(REPLACE_AREA_TEXT_RANGE_SAFETY.policy),
    normalizePublicInput,
};
export function createReplaceAreaTextRangeAdapter() {
    return {
        version: 1, operation: REPLACE_AREA_TEXT_RANGE_OPERATION, validator: REPLACE_AREA_TEXT_RANGE_VALIDATOR,
        safety: REPLACE_AREA_TEXT_RANGE_SAFETY, safetyRegistrationIdentity: REPLACE_AREA_TEXT_RANGE_SAFETY_IDENTITY,
        adapterIdentity: REPLACE_AREA_TEXT_RANGE_ADAPTER_IDENTITY, tool: replaceAreaTextRangeToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest,
            safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: replaceAreaTextRangeResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: CLASSIFIER_VERSION, safetyConformanceVersion: CONFORMANCE_VERSION,
        errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: REPLACE_AREA_TEXT_RANGE_HOST_SCRIPT_DIGEST,
        mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: REPLACE_AREA_TEXT_RANGE_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: REPLACE_AREA_TEXT_RANGE_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: REPLACE_AREA_TEXT_RANGE_OPERATION,
                    documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: REPLACE_AREA_TEXT_RANGE_ADAPTER_IDENTITY,
                mutationHostApplicationMode: 'foreground', script: REPLACE_AREA_TEXT_RANGE_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = replaceAreaTextRangeResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back')
                return { state };
            if (state === 'planned')
                throw new Error('Area-text range plan is not a terminal mutation result.');
            throw new Error('Unverified area-text range recovery must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error, detail) {
            const lookupFailure = textLookupFailureError(error, detail);
            if (lookupFailure !== null)
                return lookupFailure;
            if (detail?.code === 'OBJECT_NOT_FOUND') {
                return new Error(`No PageItem with UUID ${JSON.stringify(detail.uuid ?? '')} exists in the bound document.`);
            }
            if (detail?.code === 'TEXT_RANGE_APPLY_BLOCKED') {
                return new Error(`Area-text range replacement is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}.`);
            }
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
