import { z } from 'zod';
import { canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { FONT_LOOKUP_HOST_SCRIPT, fontDescriptorSchema, fontPostScriptNameSchema } from '../font-lookup.js';
export const REPLACE_FONT_OPERATION = 'replace_font';
export const REPLACE_FONT_VALIDATOR = { kind: REPLACE_FONT_OPERATION, version: 1 };
const CANONICAL_VERSION = 1;
const RESULT_SCHEMA_VERSION = 1;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
const POLICY_VERSION = 1;
export const REPLACE_FONT_MAX_FRAMES = 128;
export const REPLACE_FONT_MAX_CHARACTERS = 4_096;
const uuidSchema = z.string().min(1).max(255);
const rangeSchema = z.tuple([
    z.number().int().nonnegative().max(REPLACE_FONT_MAX_CHARACTERS),
    z.number().int().positive().max(REPLACE_FONT_MAX_CHARACTERS),
]);
const rangesSchema = z.array(rangeSchema).min(1).max(REPLACE_FONT_MAX_CHARACTERS).superRefine((ranges, context) => {
    let previousEnd = -1;
    for (const [start, end] of ranges) {
        if (start >= end || start <= previousEnd) {
            context.addIssue({ code: 'custom', message: 'Font ranges must be ascending, non-empty and non-adjacent runs.' });
            return;
        }
        previousEnd = end;
    }
});
function rangeLength(ranges) {
    return ranges.reduce((sum, [start, end]) => sum + end - start, 0);
}
export const expectedTargetSchema = z.strictObject({ uuid: uuidSchema, ranges: rangesSchema });
const usageFrameSchema = z.strictObject({
    uuid: uuidSchema,
    kind: z.string().min(1).max(64),
    characters: z.number().int().positive().max(REPLACE_FONT_MAX_CHARACTERS),
    ranges: rangesSchema,
});
const usageSchema = z.discriminatedUnion('complete', [
    z.strictObject({
        complete: z.literal(true),
        characters: z.number().int().nonnegative().max(REPLACE_FONT_MAX_CHARACTERS),
        frames: z.number().int().nonnegative().max(REPLACE_FONT_MAX_FRAMES),
        frameList: z.array(usageFrameSchema).max(REPLACE_FONT_MAX_FRAMES),
    }),
    z.strictObject({
        complete: z.literal(false),
        characters: z.literal(0),
        frames: z.literal(0),
        frameList: z.array(usageFrameSchema).max(0),
    }),
]).superRefine((usage, context) => {
    if (usage.frames !== usage.frameList.length ||
        usage.characters !== usage.frameList.reduce((sum, frame) => sum + frame.characters, 0) ||
        usage.frameList.some((frame) => frame.characters !== rangeLength(frame.ranges)) ||
        new Set(usage.frameList.map((frame) => frame.uuid)).size !== usage.frameList.length) {
        context.addIssue({ code: 'custom', message: 'Font usage counts must equal the reported frame ranges.' });
    }
});
export const expectedUsageSchema = z.strictObject({
    characters: z.number().int().nonnegative().max(REPLACE_FONT_MAX_CHARACTERS),
    frames: z.number().int().nonnegative().max(REPLACE_FONT_MAX_FRAMES),
});
const checksSchema = z.strictObject({
    sourceInstalled: z.boolean(),
    replacementInstalled: z.boolean(),
    fontsReadable: z.boolean(),
    targetFramesUnlocked: z.boolean(),
    targetFramesVisible: z.boolean(),
    targetFramesSupported: z.boolean(),
});
const blockerSchema = z.enum([
    'document_mutation_not_allowed',
    'source_font_not_installed',
    'replacement_font_not_installed',
    'usage_scan_limit_exceeded',
    'character_font_unreadable',
    'source_font_not_used',
    'target_frame_locked',
    'target_frame_hidden',
    'target_frame_unsupported',
]);
function expectedBlockers(plan, mutationAllowed) {
    const blockers = [];
    if (!mutationAllowed)
        blockers.push('document_mutation_not_allowed');
    if (!plan.checks.sourceInstalled)
        blockers.push('source_font_not_installed');
    if (!plan.checks.replacementInstalled)
        blockers.push('replacement_font_not_installed');
    if (!plan.usage.complete)
        blockers.push('usage_scan_limit_exceeded');
    if (!plan.checks.fontsReadable)
        blockers.push('character_font_unreadable');
    if (plan.usage.complete && plan.usage.characters === 0)
        blockers.push('source_font_not_used');
    if (!plan.checks.targetFramesUnlocked)
        blockers.push('target_frame_locked');
    if (!plan.checks.targetFramesVisible)
        blockers.push('target_frame_hidden');
    if (!plan.checks.targetFramesSupported)
        blockers.push('target_frame_unsupported');
    return blockers;
}
export const replaceFontPlanSchema = z.strictObject({
    operation: z.literal(REPLACE_FONT_OPERATION),
    documentKey: z.string().min(1).max(16_384),
    sourcePostScriptName: fontPostScriptNameSchema,
    replacementPostScriptName: fontPostScriptNameSchema,
    source: fontDescriptorSchema.nullable(),
    replacement: fontDescriptorSchema.nullable(),
    usage: usageSchema,
    checks: checksSchema,
    applyBlockedReasonCodes: z.array(blockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    if (plan.sourcePostScriptName === plan.replacementPostScriptName) {
        context.addIssue({ code: 'custom', message: 'A font replacement must name two different fonts.' });
    }
    if ((plan.source !== null) !== plan.checks.sourceInstalled ||
        (plan.source !== null && plan.source.postScriptName !== plan.sourcePostScriptName) ||
        (plan.replacement !== null) !== plan.checks.replacementInstalled ||
        (plan.replacement !== null && plan.replacement.postScriptName !== plan.replacementPostScriptName)) {
        context.addIssue({ code: 'custom', message: 'A font replacement plan must report exactly the requested installed fonts.' });
    }
    const allowed = plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0;
    if (plan.applyAllowed !== allowed) {
        context.addIssue({ code: 'custom', message: 'Font replacement applyAllowed must require confirmation and no blockers.' });
    }
});
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']),
    reasonCode: z.enum(['apply_failed', 'verify_mismatch']),
    message: z.string().min(1).max(500),
}).superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed')) {
        context.addIssue({ code: 'custom', message: 'Font replacement failure phase and reason code must match.' });
    }
});
const indeterminateFailureSchema = z.strictObject({
    phase: z.literal('apply'),
    reasonCode: z.literal('apply_indeterminate'),
    message: z.string().min(1).max(500),
});
const rollbackEvidence = { restoredExactly: z.boolean() };
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
            status: z.literal('indeterminate'), reasonCode: z.literal('font_state_unknown'),
            message: z.string().min(1).max(500), restoredExactly: z.literal(false),
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
        context.addIssue({ code: 'custom', message: 'Font replacement audit sequence does not match transaction state.' });
    }
    transaction.audit.forEach((event, index) => {
        if (event.sequence !== index) {
            context.addIssue({ code: 'custom', message: 'Font replacement audit sequence must be contiguous.' });
        }
    });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' &&
            event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode &&
            event.message === transaction.failure.message);
        if (matches.length !== 1) {
            context.addIssue({ code: 'custom', message: 'Font replacement failure must match one audit event.' });
        }
    }
});
const boundsSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
const frameGeometrySchema = z.strictObject({
    geometricBounds: boundsSchema,
    visibleBounds: boundsSchema,
    lineCount: z.number().int().nonnegative(),
});
const postconditionSchema = z.strictObject({
    replacedCharacters: z.number().int().positive().max(REPLACE_FONT_MAX_CHARACTERS),
    frames: z.array(z.strictObject({
        uuid: uuidSchema,
        before: frameGeometrySchema,
        after: frameGeometrySchema,
    })).min(1).max(REPLACE_FONT_MAX_FRAMES),
});
export const replaceFontResultSchema = z.union([
    z.strictObject({
        operation: z.literal(REPLACE_FONT_OPERATION), applied: z.literal(false),
        document: documentContextSchema, plan: replaceFontPlanSchema, transaction: transactionSchema,
    }),
    z.strictObject({
        operation: z.literal(REPLACE_FONT_OPERATION), applied: z.literal(true),
        document: documentContextSchema, plan: replaceFontPlanSchema,
        postcondition: postconditionSchema, transaction: transactionSchema,
    }),
]).superRefine((result, context) => {
    if (result.transaction.state === 'planned') {
        if (result.plan.confirmationStatus !== 'required' ||
            canonicalSha256(result.plan.applyBlockedReasonCodes) !==
                canonicalSha256(expectedBlockers(result.plan, result.document.mutationAllowed))) {
            context.addIssue({ code: 'custom', message: 'A planned font replacement must expose exact blockers.' });
        }
    }
    else if (result.plan.confirmationStatus !== 'confirmed' ||
        result.plan.applyBlockedReasonCodes.length !== 0 || !result.plan.applyAllowed) {
        context.addIssue({ code: 'custom', message: 'A font replacement must derive from an allowed confirmed plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified') {
            context.addIssue({ code: 'custom', message: 'A replaced font must come from a verified transaction.' });
        }
        const planned = result.plan.usage.frameList.map((frame) => frame.uuid);
        if (result.postcondition.replacedCharacters !== result.plan.usage.characters ||
            result.postcondition.frames.length !== planned.length ||
            result.postcondition.frames.some((frame, index) => frame.uuid !== planned[index])) {
            context.addIssue({ code: 'custom', message: 'A font replacement postcondition must cover exactly the planned frames.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified font replacement must report its postcondition.' });
    }
    if (result.transaction.state === 'rolled_back' && !result.transaction.rollback.restoredExactly) {
        context.addIssue({ code: 'custom', message: 'A rolled-back font replacement must prove the exact before state.' });
    }
});
export const replaceFontResponseSchema = z.strictObject({
    outcome: replaceFontResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
const commonInternal = {
    expectedDocumentKey: z.string().min(1).max(16_384),
    sourcePostScriptName: fontPostScriptNameSchema,
    replacementPostScriptName: fontPostScriptNameSchema,
};
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({
        ...commonInternal,
        expectedUsage: expectedUsageSchema,
        expectedTargets: z.array(expectedTargetSchema).min(1).max(REPLACE_FONT_MAX_FRAMES),
        apply: z.literal(true),
        commandId: canonicalCommandIdSchema,
    }),
]);
const commonPublic = {
    expected_document_key: z.string().min(1).max(16_384),
    source_post_script_name: fontPostScriptNameSchema,
    replacement_post_script_name: fontPostScriptNameSchema,
};
export const replaceFontPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({
        ...commonPublic,
        expected_usage: expectedUsageSchema,
        expected_targets: z.array(expectedTargetSchema).min(1).max(REPLACE_FONT_MAX_FRAMES),
        apply: z.literal(true),
        command_id: canonicalCommandIdSchema,
    }),
]);
const inputSchema = z.strictObject({
    ...commonPublic,
    expected_usage: expectedUsageSchema.optional(),
    expected_targets: z.array(expectedTargetSchema).min(1).max(REPLACE_FONT_MAX_FRAMES).optional(),
    apply: z.boolean().default(false),
    command_id: canonicalCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(replaceFontPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function assertDistinctFonts(source, replacement) {
    if (source === replacement)
        throw new Error('A font replacement must name two different fonts.');
}
function assertExpectedTargets(usage, targets) {
    if (targets.length !== usage.frames || rangeLength(targets.flatMap((target) => target.ranges)) !== usage.characters ||
        new Set(targets.map((target) => target.uuid)).size !== targets.length) {
        throw new Error('expected_targets must list exactly expected_usage.frames frames holding expected_usage.characters characters.');
    }
}
function normalizePublicInput(input) {
    const value = replaceFontPublicInputSchema.parse(input);
    assertDistinctFonts(value.source_post_script_name, value.replacement_post_script_name);
    const common = {
        expectedDocumentKey: value.expected_document_key,
        sourcePostScriptName: value.source_post_script_name,
        replacementPostScriptName: value.replacement_post_script_name,
    };
    if (!value.apply)
        return { ...common, apply: false };
    assertExpectedTargets(value.expected_usage, value.expected_targets);
    return { ...common, expectedUsage: value.expected_usage, expectedTargets: value.expected_targets,
        apply: true, commandId: value.command_id };
}
export const REPLACE_FONT_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: REPLACE_FONT_OPERATION,
    policy: {
        version: POLICY_VERSION, class: 'update_existing', destructive: false,
        evidence: { identity: 'target_native_uuid_set', beforeState: 'before_state_hash',
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
export const REPLACE_FONT_SAFETY_IDENTITY = canonicalDigest(REPLACE_FONT_SAFETY);
function targetEvidence(result) {
    const targetUuids = result.plan.usage.frameList.map((frame) => frame.uuid);
    return { targetUuids, targetSetHash: canonicalDigest(targetUuids) };
}
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    const plan = result.plan;
    const beforeStateHash = canonicalDigest({ font: plan.sourcePostScriptName, usage: plan.usage });
    const afterStateHash = canonicalDigest({ font: plan.replacementPostScriptName, usage: plan.usage });
    const changeSetHash = canonicalDigest({ source: plan.sourcePostScriptName,
        replacement: plan.replacementPostScriptName, beforeStateHash, afterStateHash });
    return bindOperationSafetyPlan({
        policyVersion: POLICY_VERSION, operationClass: 'update_existing', operationId: REPLACE_FONT_OPERATION,
        canonicalRequestDigest: requestDigest,
        evidence: { documentKey: admissionDocumentKey, ...targetEvidence(result),
            beforeStateHash, plannedAfterStateHash: afterStateHash, plannedChangeSetDigest: changeSetHash },
        preconditions: { status: plan.applyBlockedReasonCodes.length === 0 ? 'satisfied' : 'blocked',
            compareAndSetMatched: plan.applyBlockedReasonCodes.length === 0 },
        confirmation: { kind: 'exact_change_set', canonicalRequestDigest: requestDigest, changeSetHash,
            status: plan.confirmationStatus },
        applyAllowed: plan.applyAllowed,
    });
}
function safetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' ||
        transaction.state === 'rollback_indeterminate' || transaction.state === 'rollback_failed') {
        throw new Error('Indeterminate or failed font replacement recovery cannot be terminal.');
    }
    const common = { policyVersion: POLICY_VERSION, operationClass: 'update_existing',
        operationId: REPLACE_FONT_OPERATION, canonicalRequestDigest: requestDigest,
        planDigest: plan.planDigest, attestation };
    const boundPlan = plan;
    const beforeStateHash = boundPlan.evidence.beforeStateHash;
    const target = targetEvidence(result);
    if (transaction.state === 'verified' && result.applied) {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { ...target, beforeStateHash, afterStateHash: boundPlan.evidence.plannedAfterStateHash,
                restoredStateHash: null, restoredBeforeStateVerified: false },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'succeeded', terminal: true, recovery: 'not_required',
                proof: { kind: 'verified_postcondition' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    if (transaction.state === 'rolled_back') {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { ...target, beforeStateHash, afterStateHash: null,
                restoredStateHash: beforeStateHash, restoredBeforeStateVerified: true },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'recovered', terminal: true, recovery: 'verified',
                proof: { kind: 'verified_recovery' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    return operationSafetyResultSchema.parse({ ...common,
        evidence: { ...target, beforeStateHash, afterStateHash: null,
            restoredStateHash: null, restoredBeforeStateVerified: false },
        executionEvidence: { outcome: 'proven_pre_apply' },
        resolution: { status: 'failed', terminal: true, recovery: 'not_required',
            proof: { kind: 'proven_pre_apply', mutationAttempted: false },
            replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
}
async function assertSafety(value, requestDigest, attestation, resolver) {
    const result = replaceFontResultSchema.parse(value);
    if (result.transaction.state === 'planned')
        return;
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (attestation === null || resolver === null) {
        throw new Error('Font replacement terminal result requires attestation.');
    }
    await assertOperationSafetyAdapterConformance({ registration: REPLACE_FONT_SAFETY, plan,
        result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
export const REPLACE_FONT_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${FONT_LOOKUP_HOST_SCRIPT}
var RPL_FONT_MAX_FRAMES = ${REPLACE_FONT_MAX_FRAMES};
var RPL_FONT_MAX_CHARACTERS = ${REPLACE_FONT_MAX_CHARACTERS};

/** Key-order-independent JSON, so an echoed object compares equal whatever order its keys arrive in. */
function rplFontCanonicalJson(value) {
  if (value === null || typeof value !== "object") return stringifyJson(value);
  if (value instanceof Array) {
    var items = [];
    for (var index = 0; index < value.length; index++) items.push(rplFontCanonicalJson(value[index]));
    return "[" + items.join(",") + "]";
  }
  var keys = [];
  for (var key in value) if (value.hasOwnProperty(key)) keys.push(key);
  keys.sort();
  var fields = [];
  for (var keyIndex = 0; keyIndex < keys.length; keyIndex++) {
    fields.push(stringifyJson(keys[keyIndex]) + ":" + rplFontCanonicalJson(value[keys[keyIndex]]));
  }
  return "{" + fields.join(",") + "}";
}

function rplFontSame(left, right) {
  return left !== null && left !== undefined && right !== null && right !== undefined &&
    rplFontCanonicalJson(left) === rplFontCanonicalJson(right);
}

function rplFontBounds(bounds) {
  return [Number(bounds[0]), Number(bounds[1]), Number(bounds[2]), Number(bounds[3])];
}

function rplFontLineText(frame) {
  var lines = frame.lines;
  var parts = [];
  for (var index = 0; index < lines.length; index++) parts.push(String(lines[index].contents));
  return { count: lines.length, text: parts.join("") };
}

/** A replaced frame's observable geometry: bounds and line breaks. */
function rplFontGeometry(frame) {
  var lines = frame.lines;
  var parts = [];
  for (var index = 0; index < lines.length; index++) parts.push(String(lines[index].contents));
  return { geometricBounds: rplFontBounds(frame.geometricBounds), visibleBounds: rplFontBounds(frame.visibleBounds),
    lineCount: lines.length, lineText: parts.join("/") };
}

function rplFontAncestryState(frame) {
  var hidden = false;
  var locked = false;
  for (var node = frame.layer; node && node.typename === "Layer"; node = node.parent) {
    if (node.visible !== true) hidden = true;
    if (node.locked === true) locked = true;
  }
  return { hidden: hidden, locked: locked };
}

/** The measured shapes (measured operation): unthreaded point text, or area text that does not overflow; one paragraph. */
function rplFontFrameSupported(frame) {
  var isPoint = frame.kind === TextType.POINTTEXT;
  var isArea = frame.kind === TextType.AREATEXT;
  if (!isPoint && !isArea) return false;
  if (!frame.story || !frame.story.textFrames || frame.story.textFrames.length !== 1) return false;
  var contents = String(frame.contents);
  if (contents.indexOf("\\r") >= 0 || contents.indexOf("\\n") >= 0 || contents.indexOf("\\u0003") >= 0) return false;
  if (isArea && rplFontLineText(frame).text !== contents) return false;
  return true;
}

/**
 * One character's font name plus the attributes a font change must not move, as one string. The font name is
 * the first field so a planned row can be predicted by swapping it alone.
 */
function rplFontRow(character) {
  var attributes = character.characterAttributes;
  var name;
  try {
    var font = attributes.textFont;
    if (!font || typeof font.name !== "string" || !font.name) return null;
    name = font.name;
  } catch (fontError) { return null; }
  return [name, String(attributes.size), String(attributes.leading), String(attributes.tracking),
    String(attributes.horizontalScale), String(attributes.verticalScale), String(attributes.baselineShift)].join("|");
}

function rplFontRowName(row) {
  return row === null ? null : row.substring(0, row.indexOf("|"));
}

function rplFontSwapName(row, name) {
  return name + row.substring(row.indexOf("|"));
}

/** Maximal runs of planned characters as [start, end) ranges. */
function rplFontRanges(planned) {
  var ranges = [];
  var start = -1;
  for (var index = 0; index <= planned.length; index++) {
    var inside = index < planned.length && planned[index] === true;
    if (inside && start < 0) start = index;
    if (!inside && start >= 0) { ranges.push([start, index]); start = -1; }
  }
  return ranges;
}

/**
 * One bounded pass over every text frame and character: each character's row, which characters use the
 * source font, every frame's geometric bounds, and the support facts and full geometry of each target frame.
 */
function rplFontScan(document) {
  var frames = document.textFrames;
  if (!frames || typeof frames.length !== "number") {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "FONT_SCAN_UNREADABLE" }));
  }
  var scan = { complete: true, records: [], handles: [],
    usage: { characters: 0, frames: 0, frameList: [] },
    fontsReadable: true, framesUnlocked: true, framesVisible: true, framesSupported: true };
  if (frames.length > RPL_FONT_MAX_FRAMES) { scan.complete = false; return scan; }
  var total = 0;
  for (var frameIndex = 0; frameIndex < frames.length; frameIndex++) {
    var frame = frames[frameIndex];
    var characters = frame.characters;
    var count = Number(characters.length);
    total += count;
    if (total > RPL_FONT_MAX_CHARACTERS) { scan.complete = false; return scan; }
    var record = { uuid: String(frame.uuid), rows: [], planned: [], plannedCount: 0,
      bounds: rplFontBounds(frame.geometricBounds), geometry: null };
    for (var characterIndex = 0; characterIndex < count; characterIndex++) {
      // Held character, then its attributes: a temporary is released (9503).
      var character = characters[characterIndex];
      var row = rplFontRow(character);
      if (row === null) scan.fontsReadable = false;
      var planned = row !== null && rplFontRowName(row) === params.sourcePostScriptName;
      record.rows.push(row);
      record.planned.push(planned);
      if (planned) record.plannedCount++;
    }
    if (record.plannedCount > 0) {
      var ancestry = rplFontAncestryState(frame);
      if (frame.locked === true || frame.editable !== true || ancestry.locked) scan.framesUnlocked = false;
      if (frame.hidden === true || ancestry.hidden) scan.framesVisible = false;
      if (!rplFontFrameSupported(frame)) scan.framesSupported = false;
      record.geometry = rplFontGeometry(frame);
      scan.usage.characters += record.plannedCount;
      scan.usage.frames++;
      scan.usage.frameList.push({ uuid: record.uuid, kind: String(frame.kind), characters: record.plannedCount,
        ranges: rplFontRanges(record.planned) });
    }
    scan.records.push(record);
    scan.handles.push(frame);
  }
  return scan;
}

function rplFontPublicUsage(scan) {
  return scan.complete
    ? { complete: true, characters: scan.usage.characters, frames: scan.usage.frames, frameList: scan.usage.frameList }
    : { complete: false, characters: 0, frames: 0, frameList: [] };
}

function rplFontBlockers(context, source, replacement, scan) {
  var blockers = [];
  if (!context.mutationAllowed) blockers.push("document_mutation_not_allowed");
  if (source === null) blockers.push("source_font_not_installed");
  if (replacement === null) blockers.push("replacement_font_not_installed");
  if (!scan.complete) blockers.push("usage_scan_limit_exceeded");
  if (!scan.fontsReadable) blockers.push("character_font_unreadable");
  if (scan.complete && scan.usage.characters === 0) blockers.push("source_font_not_used");
  if (!scan.framesUnlocked) blockers.push("target_frame_locked");
  if (!scan.framesVisible) blockers.push("target_frame_hidden");
  if (!scan.framesSupported) blockers.push("target_frame_unsupported");
  return blockers;
}

function rplFontResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  var source = fontExact(params.sourcePostScriptName);
  var replacement = fontExact(params.replacementPostScriptName);
  var scan = rplFontScan(document);
  var blockers = rplFontBlockers(context, source, replacement, scan);
  if (forApply && blockers.length > 0) {
    throw mutationBeforeSideEffectError(stringifyJson({ code: "FONT_REPLACE_BLOCKED", reasonCodes: blockers }));
  }
  return { context: context, document: document, source: source, replacement: replacement, scan: scan,
    blockers: blockers };
}

function rplFontPreflight(forApply) {
  var resolved = rplFontResolve(forApply);
  if (forApply) {
    var usage = rplFontPublicUsage(resolved.scan);
    if (usage.characters !== params.expectedUsage.characters || usage.frames !== params.expectedUsage.frames) {
      throw mutationError("preflight_failed", stringifyJson({ code: "FONT_REPLACE_USAGE_MISMATCH",
        expected: params.expectedUsage, actual: { characters: usage.characters, frames: usage.frames } }));
    }
    var targets = [];
    for (var index = 0; index < usage.frameList.length; index++) {
      targets.push({ uuid: usage.frameList[index].uuid, ranges: usage.frameList[index].ranges });
    }
    if (!rplFontSame(targets, params.expectedTargets)) {
      throw mutationError("preflight_failed", stringifyJson({ code: "FONT_REPLACE_STALE", field: "expected_targets" }));
    }
  }
  return resolved;
}

function rplFontPlan(preflight) {
  return {
    operation: "replace_font", documentKey: preflight.context.key,
    sourcePostScriptName: params.sourcePostScriptName, replacementPostScriptName: params.replacementPostScriptName,
    source: preflight.source === null ? null : fontDescriptor(preflight.source),
    replacement: preflight.replacement === null ? null : fontDescriptor(preflight.replacement),
    usage: rplFontPublicUsage(preflight.scan),
    checks: { sourceInstalled: preflight.source !== null, replacementInstalled: preflight.replacement !== null,
      fontsReadable: preflight.scan.fontsReadable, targetFramesUnlocked: preflight.scan.framesUnlocked,
      targetFramesVisible: preflight.scan.framesVisible, targetFramesSupported: preflight.scan.framesSupported },
    applyBlockedReasonCodes: preflight.blockers,
    confirmationStatus: params.apply === true ? "confirmed" : "required",
    applyAllowed: params.apply === true && preflight.blockers.length === 0
  };
}

function rplFontRevalidate(preflight, plan) {
  var current;
  try { current = rplFontResolve(true); }
  catch (error) {
    throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Font replacement preconditions changed before apply."));
  }
  if (current.document !== preflight.document || current.source === null || current.replacement === null ||
      !rplFontSame(fontDescriptor(current.source), plan.source) ||
      !rplFontSame(fontDescriptor(current.replacement), plan.replacement) ||
      !rplFontSame(current.scan.records, preflight.scan.records)) {
    throw mutationBeforeSideEffectError("The fonts or the text using the source font changed before apply.");
  }
}

/** Measured primitive (measured operation): hold each planned character, then set its textFont. */
function rplFontWrite(scan, font, onlyIfName) {
  for (var frameIndex = 0; frameIndex < scan.records.length; frameIndex++) {
    var record = scan.records[frameIndex];
    if (record.plannedCount === 0) continue;
    var characters = scan.handles[frameIndex].characters;
    for (var index = 0; index < record.planned.length; index++) {
      if (!record.planned[index]) continue;
      var character = characters[index];
      var attributes = character.characterAttributes;
      if (onlyIfName !== null && String(attributes.textFont.name) !== onlyIfName) continue;
      attributes.textFont = font;
    }
  }
}

function rplFontApply(preflight, plan, state) {
  state.operationState.mutationStarted = true;
  rplFontWrite(preflight.scan, preflight.replacement, null);
  return preflight.document;
}

/**
 * The scan after the replacement matches the plan: the same frames and characters; each planned row is its
 * before row with only the font name swapped; every other row and every untouched frame's bounds is unchanged.
 */
function rplFontScanMatchesReplacement(before, after) {
  if (!after.complete || after.records.length !== before.records.length) return false;
  for (var frameIndex = 0; frameIndex < before.records.length; frameIndex++) {
    var was = before.records[frameIndex];
    var now = after.records[frameIndex];
    if (now.uuid !== was.uuid || now.rows.length !== was.rows.length) return false;
    if (was.plannedCount === 0 && !rplFontSame(now.bounds, was.bounds)) return false;
    for (var index = 0; index < was.rows.length; index++) {
      var expected = was.planned[index] ? rplFontSwapName(was.rows[index], params.replacementPostScriptName) : was.rows[index];
      if (now.rows[index] !== expected) return false;
    }
  }
  return true;
}

function rplFontVerify(preflight, plan) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) {
    throw mutationError("verify_mismatch", "Active document changed during font replacement verification.");
  }
  var scan = rplFontScan(preflight.document);
  if (!rplFontScanMatchesReplacement(preflight.scan, scan)) {
    throw mutationError("verify_mismatch", "The characters that changed are not exactly the planned font replacement.");
  }
  var frames = [];
  for (var frameIndex = 0; frameIndex < preflight.scan.records.length; frameIndex++) {
    var record = preflight.scan.records[frameIndex];
    if (record.plannedCount === 0) continue;
    var frame = scan.handles[frameIndex];
    // Overflow after the replacement is outside the measured profile.
    if (frame.kind === TextType.AREATEXT && rplFontLineText(frame).text !== String(frame.contents)) {
      throw mutationError("verify_mismatch", "Area text overflows after the font replacement.");
    }
    var after = rplFontGeometry(frame);
    frames.push({ uuid: record.uuid,
      before: { geometricBounds: record.geometry.geometricBounds, visibleBounds: record.geometry.visibleBounds,
        lineCount: record.geometry.lineCount },
      after: { geometricBounds: after.geometricBounds, visibleBounds: after.visibleBounds, lineCount: after.lineCount } });
  }
  return { replacedCharacters: preflight.scan.usage.characters, frames: frames };
}

/**
 * The measured inverse (measured operation): write the source font back on the planned characters that carry the
 * replacement, then require every row, every frame's bounds and every replaced frame's geometry to be exactly
 * the before state. A character that is neither its before nor its planned state is not ours to repair.
 */
function rplFontRollback(state) {
  var preflight = state.preflight;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) {
    return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
  }
  var before = preflight.scan;
  var current;
  try { current = rplFontScan(preflight.document); }
  catch (readError) { return { status: "indeterminate", message: "Rollback font state is indeterminate." }; }
  if (!current.complete || current.records.length !== before.records.length) {
    return { status: "indeterminate", message: "Rollback refused because the text frames changed." };
  }
  for (var frameIndex = 0; frameIndex < before.records.length; frameIndex++) {
    var was = before.records[frameIndex];
    var now = current.records[frameIndex];
    if (now.uuid !== was.uuid || now.rows.length !== was.rows.length) {
      return { status: "indeterminate", message: "Rollback refused because the text frames changed." };
    }
    for (var index = 0; index < was.rows.length; index++) {
      var ours = was.planned[index] && now.rows[index] === rplFontSwapName(was.rows[index], params.replacementPostScriptName);
      if (now.rows[index] !== was.rows[index] && !ours) {
        return { status: "indeterminate", message: "Rollback refused because a character is neither before nor planned." };
      }
    }
  }
  try { rplFontWrite(before, preflight.source, params.replacementPostScriptName); }
  catch (writeError) { return { status: "indeterminate", message: "Rollback font write is indeterminate." }; }
  var restored;
  try { restored = rplFontScan(preflight.document); }
  catch (verifyError) { return { status: "indeterminate", message: "Rollback verification is indeterminate." }; }
  var exact = rplFontSame(restored.records, before.records);
  state.operationState.rollbackEvidence.restoredExactly = exact;
  return exact ? { status: "verified" }
    : { status: "failed", message: "Rollback did not restore the exact before font and text state." };
}

var rplFontExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionAffected: function () { var uuids = []; for (var i = 0; i < params.expectedTargets.length; i++) uuids.push(params.expectedTargets[i].uuid); return uuids; },
  initialOperationState: function () {
    return { mutationStarted: false, rollbackEvidence: { restoredExactly: false } };
  },
  preflight: rplFontPreflight,
  plan: rplFontPlan,
  revalidate: rplFontRevalidate,
  applyMutation: rplFontApply,
  verify: rplFontVerify,
  rollback: rplFontRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () {
    return { reasonCode: "font_state_unknown",
      message: "Font replacement outcome is indeterminate.",
      evidence: { restoredExactly: false } };
  },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var rplFontDocument = rplFontExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === rplFontExecution.preflight.document) {
  rplFontDocument = getDocumentContext();
}
var result = { operation: "replace_font",
  applied: rplFontExecution.transaction.state === "verified",
  document: rplFontDocument, plan: rplFontExecution.plan, transaction: rplFontExecution.transaction };
if (rplFontExecution.transaction.state === "verified") result.postcondition = rplFontExecution.value;
`;
export const REPLACE_FONT_HOST_SCRIPT_DIGEST = canonicalSha256(REPLACE_FONT_SCRIPT);
export const REPLACE_FONT_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: REPLACE_FONT_OPERATION,
    validator: REPLACE_FONT_VALIDATOR, canonicalContractVersion: CANONICAL_VERSION,
    resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: REPLACE_FONT_SAFETY_IDENTITY,
    hostScriptDigest: REPLACE_FONT_HOST_SCRIPT_DIGEST,
    mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    assertDistinctFonts(request.sourcePostScriptName, request.replacementPostScriptName);
    if (request.apply)
        assertExpectedTargets(request.expectedUsage, request.expectedTargets);
    const digestRequest = 'commandId' in request
        ? (({ commandId: _commandId, ...rest }) => rest)(request)
        : request;
    const digest = canonicalSha256({ operation: REPLACE_FONT_OPERATION,
        validator: REPLACE_FONT_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request,
        commandId: 'commandId' in request ? request.commandId : null,
        documentKey: request.expectedDocumentKey, digest };
}
export const replaceFontToolContract = {
    name: 'illustrator_replace_font',
    title: 'Plan or Replace a Font Throughout a Document',
    description: 'Plan or replace one installed font with another on every character of the bound document that '
        + 'uses it, both named by exact PostScript name (see illustrator_find_fonts; no fallback). The plan lists '
        + 'every frame and character range that uses the source font; apply requires echoing the count as '
        + '`expected_usage` and the ranges as `expected_targets` exactly as planned. Only the font changes: '
        + 'verification requires the planned characters to carry the replacement with size, leading, tracking, '
        + 'scales and baseline shift unchanged, every other character unchanged, and the bounds of every untouched '
        + 'frame unchanged; the result reports each replaced frame\'s bounds before and after. Refused: a source or '
        + 'replacement font that is not installed (so a missing font cannot be replaced), the same font twice, an '
        + 'unused source font, characters whose font cannot be read, target frames that are locked, hidden, '
        + 'threaded, multi-paragraph, overflowing or not point/area text, area text that would overflow after the '
        + 'change, and documents beyond 128 text frames or 4096 characters. Composite fonts are unsupported. Only a '
        + 'replacement with glyphs for every target character is measured; otherwise the host may move other '
        + 'attributes, which verification refuses and rolls back. '
        + 'Rollback writes the source font back and proves the exact before state.',
    inputSchema,
    publicInputSchema: replaceFontPublicInputSchema,
    outputSchema: replaceFontResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(REPLACE_FONT_SAFETY.policy),
    normalizePublicInput,
};
export function createReplaceFontAdapter() {
    return {
        version: 1, operation: REPLACE_FONT_OPERATION, validator: REPLACE_FONT_VALIDATOR,
        safety: REPLACE_FONT_SAFETY, safetyRegistrationIdentity: REPLACE_FONT_SAFETY_IDENTITY,
        adapterIdentity: REPLACE_FONT_ADAPTER_IDENTITY, tool: replaceFontToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest,
            safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: replaceFontResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: CLASSIFIER_VERSION, safetyConformanceVersion: CONFORMANCE_VERSION,
        errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: REPLACE_FONT_HOST_SCRIPT_DIGEST,
        mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: REPLACE_FONT_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: REPLACE_FONT_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: REPLACE_FONT_OPERATION,
                    documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: REPLACE_FONT_ADAPTER_IDENTITY,
                mutationHostApplicationMode: 'foreground', script: REPLACE_FONT_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = replaceFontResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back')
                return { state };
            if (state === 'planned')
                throw new Error('A font replacement plan is not a terminal mutation result.');
            throw new Error('Unverified font replacement recovery must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error, detail) {
            if (detail?.code === 'FONT_REPLACE_BLOCKED') {
                return new Error(`Replacing the font is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}.`);
            }
            if (detail?.code === 'FONT_REPLACE_USAGE_MISMATCH') {
                return new Error(`The source font usage changed: expected_usage ${JSON.stringify(detail.expected ?? null)} `
                    + `does not match ${JSON.stringify(detail.actual ?? null)}; plan again.`);
            }
            if (detail?.code === 'FONT_REPLACE_STALE') {
                return new Error(`The text using the source font changed since the plan (${detail.field ?? 'state'}); plan again.`);
            }
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
