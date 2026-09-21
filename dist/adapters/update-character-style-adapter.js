import { z } from 'zod';
import { canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, TEXT_STYLE_RESOURCE_NAME_MAX, } from '../operation-safety-policy-core.js';
import { PLAIN_POINT_TEXT_V1 } from './point-text-host-script.js';
import { sameCanonicalNumber } from './create-character-style-adapter.js';
import { characterStyleEntrySchema, TEXT_STYLE_MAX_STYLES, TEXT_STYLE_RESOURCE_SCRIPT, } from '../text-style-resources.js';
export const UPDATE_CHARACTER_STYLE_OPERATION = 'update_character_style';
export const UPDATE_CHARACTER_STYLE_VALIDATOR = { kind: UPDATE_CHARACTER_STYLE_OPERATION, version: 1 };
const CANONICAL_VERSION = 1;
const RESULT_SCHEMA_VERSION = 1;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
const POLICY_VERSION = 1;
export const UPDATE_CHARACTER_STYLE_MAX_FRAMES = 128;
export const UPDATE_CHARACTER_STYLE_MAX_CHARACTERS = 4_096;
export const UPDATE_CHARACTER_STYLE_ATTRIBUTES = ['tracking', 'horizontalScale'];
const styleNameSchema = z.string().min(1).max(TEXT_STYLE_RESOURCE_NAME_MAX);
const requestedAttributesSchema = z.strictObject({
    tracking: z.number().finite().optional(),
    horizontalScale: z.number().finite().positive().optional(),
});
const publicAttributesSchema = z.strictObject({
    tracking: z.number().finite().optional(),
    horizontal_scale: z.number().finite().positive().optional(),
});
function requestedAttributes(attributes) {
    return UPDATE_CHARACTER_STYLE_ATTRIBUTES.filter((name) => attributes[name] !== undefined);
}
function assertRequestsAnAttribute(attributes) {
    if (requestedAttributes(attributes).length === 0) {
        throw new Error('Updating a character style must request at least one attribute.');
    }
}
const collectionsSnapshotSchema = z.strictObject({
    complete: z.literal(true),
    characterStyles: z.array(styleNameSchema).max(TEXT_STYLE_MAX_STYLES),
    paragraphStyles: z.array(styleNameSchema).max(TEXT_STYLE_MAX_STYLES),
});
const usageFrameSchema = z.strictObject({
    uuid: z.string().min(1).max(255),
    kind: z.string().min(1).max(64),
    dependentCharacters: z.number().int().positive().max(UPDATE_CHARACTER_STYLE_MAX_CHARACTERS),
});
const usageSchema = z.discriminatedUnion('complete', [
    z.strictObject({
        complete: z.literal(true),
        characters: z.number().int().nonnegative().max(UPDATE_CHARACTER_STYLE_MAX_CHARACTERS),
        frames: z.number().int().nonnegative().max(UPDATE_CHARACTER_STYLE_MAX_FRAMES),
        frameList: z.array(usageFrameSchema).max(UPDATE_CHARACTER_STYLE_MAX_FRAMES),
    }),
    z.strictObject({
        complete: z.literal(false),
        characters: z.literal(0),
        frames: z.literal(0),
        frameList: z.array(usageFrameSchema).max(0),
    }),
]).superRefine((usage, context) => {
    const characters = usage.frameList.reduce((sum, frame) => sum + frame.dependentCharacters, 0);
    if (usage.frames !== usage.frameList.length || usage.characters !== characters ||
        new Set(usage.frameList.map((frame) => frame.uuid)).size !== usage.frameList.length) {
        context.addIssue({ code: 'custom', message: 'Character-style usage counts must equal the reported dependent frames.' });
    }
});
export const expectedUsageSchema = z.strictObject({
    characters: z.number().int().nonnegative().max(UPDATE_CHARACTER_STYLE_MAX_CHARACTERS),
    frames: z.number().int().nonnegative().max(UPDATE_CHARACTER_STYLE_MAX_FRAMES),
});
const checksSchema = z.strictObject({
    defaultStylesCanonical: z.boolean(),
    appliedStylesReadable: z.boolean(),
    dependentOverridesAbsent: z.boolean(),
    dependentFramesUnlocked: z.boolean(),
    dependentFramesVisible: z.boolean(),
    dependentFramesSupported: z.boolean(),
});
const blockerSchema = z.enum([
    'document_mutation_not_allowed',
    'default_styles_not_canonical',
    'target_is_default_style',
    'attribute_not_defined_on_style',
    'attribute_value_unreadable',
    'value_unchanged',
    'usage_scan_limit_exceeded',
    'applied_style_unreadable',
    'dependent_overrides_present',
    'dependent_frame_locked',
    'dependent_frame_hidden',
    'dependent_frame_unsupported',
]);
function definedValue(entry, attribute) {
    const reading = entry.attributes[attribute];
    return reading !== undefined && reading.status === 'defined' ? reading.value : null;
}
function expectedBlockers(plan, mutationAllowed) {
    const blockers = [];
    const requested = requestedAttributes(plan.attributes);
    if (!mutationAllowed)
        blockers.push('document_mutation_not_allowed');
    if (!plan.checks.defaultStylesCanonical)
        blockers.push('default_styles_not_canonical');
    if (plan.style.index === 0)
        blockers.push('target_is_default_style');
    if (requested.some((name) => definedValue(plan.style, name) === null))
        blockers.push('attribute_not_defined_on_style');
    if (requested.some((name) => {
        const value = definedValue(plan.style, name);
        return value !== null && !Number.isFinite(Number(value));
    }))
        blockers.push('attribute_value_unreadable');
    if (requested.some((name) => {
        const value = definedValue(plan.style, name);
        return value !== null && sameCanonicalNumber(value, plan.attributes[name]);
    }))
        blockers.push('value_unchanged');
    if (!plan.usage.complete)
        blockers.push('usage_scan_limit_exceeded');
    if (!plan.checks.appliedStylesReadable)
        blockers.push('applied_style_unreadable');
    if (!plan.checks.dependentOverridesAbsent)
        blockers.push('dependent_overrides_present');
    if (!plan.checks.dependentFramesUnlocked)
        blockers.push('dependent_frame_locked');
    if (!plan.checks.dependentFramesVisible)
        blockers.push('dependent_frame_hidden');
    if (!plan.checks.dependentFramesSupported)
        blockers.push('dependent_frame_unsupported');
    return blockers;
}
export const updateCharacterStylePlanSchema = z.strictObject({
    operation: z.literal(UPDATE_CHARACTER_STYLE_OPERATION),
    documentKey: z.string().min(1).max(16_384),
    styleName: styleNameSchema,
    attributes: requestedAttributesSchema,
    style: characterStyleEntrySchema,
    collections: collectionsSnapshotSchema,
    usage: usageSchema,
    checks: checksSchema,
    applyBlockedReasonCodes: z.array(blockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    if (plan.style.name !== plan.styleName || plan.style.duplicateName ||
        plan.collections.characterStyles[plan.style.index] !== plan.styleName ||
        plan.collections.characterStyles.filter((name) => name === plan.styleName).length !== 1) {
        context.addIssue({ code: 'custom', message: 'A character-style update plan must bind one uniquely named style at its collection index.' });
    }
    if (requestedAttributes(plan.attributes).length === 0) {
        context.addIssue({ code: 'custom', message: 'A character-style update plan must request at least one attribute.' });
    }
    const allowed = plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0;
    if (plan.applyAllowed !== allowed) {
        context.addIssue({ code: 'custom', message: 'Character-style update applyAllowed must require confirmation and no blockers.' });
    }
});
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']),
    reasonCode: z.enum(['apply_failed', 'verify_mismatch']),
    message: z.string().min(1).max(500),
}).superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed')) {
        context.addIssue({ code: 'custom', message: 'Character-style update failure phase and reason code must match.' });
    }
});
const indeterminateFailureSchema = z.strictObject({
    phase: z.literal('apply'),
    reasonCode: z.literal('apply_indeterminate'),
    message: z.string().min(1).max(500),
});
const rollbackEvidence = { restoredStyle: characterStyleEntrySchema.nullable() };
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
            status: z.literal('indeterminate'), reasonCode: z.literal('style_state_unknown'),
            message: z.string().min(1).max(500), restoredStyle: z.null(),
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
        context.addIssue({ code: 'custom', message: 'Character-style update audit sequence does not match transaction state.' });
    }
    transaction.audit.forEach((event, index) => {
        if (event.sequence !== index) {
            context.addIssue({ code: 'custom', message: 'Character-style update audit sequence must be contiguous.' });
        }
    });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' &&
            event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode &&
            event.message === transaction.failure.message);
        if (matches.length !== 1) {
            context.addIssue({ code: 'custom', message: 'Character-style update failure must match one audit event.' });
        }
    }
});
const postconditionSchema = z.strictObject({
    style: characterStyleEntrySchema,
    collections: collectionsSnapshotSchema,
});
function sameEntry(left, right) {
    return canonicalSha256(left) === canonicalSha256(right);
}
export const updateCharacterStyleResultSchema = z.union([
    z.strictObject({
        operation: z.literal(UPDATE_CHARACTER_STYLE_OPERATION), applied: z.literal(false),
        document: documentContextSchema, plan: updateCharacterStylePlanSchema, transaction: transactionSchema,
    }),
    z.strictObject({
        operation: z.literal(UPDATE_CHARACTER_STYLE_OPERATION), applied: z.literal(true),
        document: documentContextSchema, plan: updateCharacterStylePlanSchema,
        postcondition: postconditionSchema, transaction: transactionSchema,
    }),
]).superRefine((result, context) => {
    if (result.transaction.state === 'planned') {
        if (result.plan.confirmationStatus !== 'required' ||
            canonicalSha256(result.plan.applyBlockedReasonCodes) !==
                canonicalSha256(expectedBlockers(result.plan, result.document.mutationAllowed))) {
            context.addIssue({ code: 'custom', message: 'A planned character-style update must expose exact blockers.' });
        }
    }
    else if (result.plan.confirmationStatus !== 'confirmed' ||
        result.plan.applyBlockedReasonCodes.length !== 0 || !result.plan.applyAllowed) {
        context.addIssue({ code: 'custom', message: 'An updated character style must derive from an allowed confirmed plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified') {
            context.addIssue({ code: 'custom', message: 'An updated character style must come from a verified transaction.' });
        }
        const before = result.plan.style;
        const after = result.postcondition.style;
        if (after.name !== before.name || after.index !== before.index || after.duplicateName ||
            canonicalSha256(result.postcondition.collections) !==
                canonicalSha256(result.plan.collections)) {
            context.addIssue({ code: 'custom', message: 'An updated character style must stay the same style in unchanged collections.' });
        }
        const requested = new Set(requestedAttributes(result.plan.attributes));
        for (const [field, reading] of Object.entries(before.attributes)) {
            const updated = after.attributes[field];
            if (requested.has(field)) {
                const value = result.plan.attributes[field];
                if (updated === undefined || updated.status !== 'defined' || !sameCanonicalNumber(updated.value, value)) {
                    context.addIssue({ code: 'custom', message: `An updated character style must define ${field} with the requested value.` });
                }
            }
            else if (canonicalSha256(updated) !== canonicalSha256(reading)) {
                context.addIssue({ code: 'custom', message: `Updating a character style must leave ${field} unchanged.` });
            }
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified character-style update must report its postcondition.' });
    }
    if (result.transaction.state === 'rolled_back') {
        const restored = result.transaction.rollback.restoredStyle;
        if (restored === null || !sameEntry(restored, result.plan.style)) {
            context.addIssue({ code: 'custom', message: 'A rolled-back character-style update must prove the exact before style.' });
        }
    }
});
export const updateCharacterStyleResponseSchema = z.strictObject({
    outcome: updateCharacterStyleResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
const commonInternal = {
    expectedDocumentKey: z.string().min(1).max(16_384),
    styleName: styleNameSchema,
    attributes: requestedAttributesSchema,
};
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({
        ...commonInternal,
        expectedStyle: characterStyleEntrySchema,
        expectedCollections: collectionsSnapshotSchema,
        expectedUsage: expectedUsageSchema,
        apply: z.literal(true),
        commandId: canonicalCommandIdSchema,
    }),
]);
const commonPublic = {
    expected_document_key: z.string().min(1).max(16_384),
    style_name: styleNameSchema,
    attributes: publicAttributesSchema,
};
export const updateCharacterStylePublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({
        ...commonPublic,
        expected_style: characterStyleEntrySchema,
        expected_collections: collectionsSnapshotSchema,
        expected_usage: expectedUsageSchema,
        apply: z.literal(true),
        command_id: canonicalCommandIdSchema,
    }),
]);
const inputSchema = z.strictObject({
    ...commonPublic,
    expected_style: characterStyleEntrySchema.optional(),
    expected_collections: collectionsSnapshotSchema.optional(),
    expected_usage: expectedUsageSchema.optional(),
    apply: z.boolean().default(false),
    command_id: canonicalCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(updateCharacterStylePublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = updateCharacterStylePublicInputSchema.parse(input);
    const attributes = {
        ...(value.attributes.tracking === undefined ? {} : { tracking: value.attributes.tracking }),
        ...(value.attributes.horizontal_scale === undefined ? {} : { horizontalScale: value.attributes.horizontal_scale }),
    };
    assertRequestsAnAttribute(attributes);
    const common = {
        expectedDocumentKey: value.expected_document_key,
        styleName: value.style_name,
        attributes,
    };
    return value.apply
        ? { ...common, expectedStyle: value.expected_style, expectedCollections: value.expected_collections,
            expectedUsage: value.expected_usage, apply: true, commandId: value.command_id }
        : { ...common, apply: false };
}
export const UPDATE_CHARACTER_STYLE_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: UPDATE_CHARACTER_STYLE_OPERATION,
    policy: {
        version: POLICY_VERSION, class: 'update_existing', destructive: false,
        evidence: { identity: 'target_text_style_identity', beforeState: 'before_state_hash',
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
export const UPDATE_CHARACTER_STYLE_SAFETY_IDENTITY = canonicalDigest(UPDATE_CHARACTER_STYLE_SAFETY);
function targetTextStyle(plan) {
    return { collectionKind: 'characterStyles', collectionIndex: plan.style.index, name: plan.styleName };
}
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    const plan = result.plan;
    const beforeStateHash = canonicalDigest({ style: plan.style, collections: plan.collections, usage: plan.usage });
    const afterStateHash = canonicalDigest({ styleName: plan.styleName, index: plan.style.index,
        attributes: plan.attributes, collections: plan.collections, usage: plan.usage });
    const changeSetHash = canonicalDigest({ target: targetTextStyle(plan), attributes: plan.attributes,
        beforeStateHash, afterStateHash });
    return bindOperationSafetyPlan({
        policyVersion: POLICY_VERSION, operationClass: 'update_existing', operationId: UPDATE_CHARACTER_STYLE_OPERATION,
        canonicalRequestDigest: requestDigest,
        evidence: { documentKey: admissionDocumentKey, targetTextStyle: targetTextStyle(plan),
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
        throw new Error('Indeterminate or failed character-style update recovery cannot be terminal.');
    }
    const common = { policyVersion: POLICY_VERSION, operationClass: 'update_existing',
        operationId: UPDATE_CHARACTER_STYLE_OPERATION, canonicalRequestDigest: requestDigest,
        planDigest: plan.planDigest, attestation };
    const boundPlan = plan;
    const beforeStateHash = boundPlan.evidence.beforeStateHash;
    const target = { targetTextStyle: targetTextStyle(result.plan) };
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
    const result = updateCharacterStyleResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null) {
        throw new Error('Character-style update terminal result requires attestation.');
    }
    await assertOperationSafetyAdapterConformance({ registration: UPDATE_CHARACTER_STYLE_SAFETY, plan,
        result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
export const UPDATE_CHARACTER_STYLE_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${TEXT_STYLE_RESOURCE_SCRIPT}
var UPD_STYLE_MAX_FRAMES = ${UPDATE_CHARACTER_STYLE_MAX_FRAMES};
var UPD_STYLE_MAX_CHARACTERS = ${UPDATE_CHARACTER_STYLE_MAX_CHARACTERS};
var UPD_STYLE_ATTRIBUTES = ${JSON.stringify(UPDATE_CHARACTER_STYLE_ATTRIBUTES)};
var UPD_STYLE_CANONICAL_DEFAULTS = ${JSON.stringify({
    character: PLAIN_POINT_TEXT_V1.character, paragraph: PLAIN_POINT_TEXT_V1.paragraph,
})};

function updStyleRequested() {
  var names = [];
  for (var index = 0; index < UPD_STYLE_ATTRIBUTES.length; index++) {
    if (params.attributes[UPD_STYLE_ATTRIBUTES[index]] !== undefined) names.push(UPD_STYLE_ATTRIBUTES[index]);
  }
  return names;
}

/**
 * Key-order-independent JSON: an echoed \`expected_*\` object arrives in the published schema's key order,
 * not the order this script built it in, so an order-sensitive comparison would refuse every apply.
 */
function updStyleCanonicalJson(value) {
  if (value === null || typeof value !== "object") return stringifyJson(value);
  if (value instanceof Array) {
    var items = [];
    for (var index = 0; index < value.length; index++) items.push(updStyleCanonicalJson(value[index]));
    return "[" + items.join(",") + "]";
  }
  var keys = [];
  for (var key in value) if (value.hasOwnProperty(key)) keys.push(key);
  keys.sort();
  var fields = [];
  for (var keyIndex = 0; keyIndex < keys.length; keyIndex++) {
    fields.push(stringifyJson(keys[keyIndex]) + ":" + updStyleCanonicalJson(value[keys[keyIndex]]));
  }
  return "{" + fields.join(",") + "}";
}

function updStyleSame(left, right) {
  return left !== null && left !== undefined && right !== null && right !== undefined &&
    updStyleCanonicalJson(left) === updStyleCanonicalJson(right);
}

/** Five-decimal canonical rounding, the twin of sameCanonicalNumber (the scales quantize, measured operation). */
function updStyleCanonicalNumber(value) {
  var parsed = Number(value);
  if (!isFinite(parsed)) return "nonfinite";
  var rounded = Math.round(parsed * 100000) / 100000;
  return String(rounded === 0 ? 0 : rounded);
}

function updStyleCollections(document) {
  return { complete: true, characterStyles: textStyleNames(textStyleCollection(document, "character")),
    paragraphStyles: textStyleNames(textStyleCollection(document, "paragraph")) };
}

/** The encoding the T116-02 proof was measured with (the twin of pointTextCanonicalValue). */
function updStyleProofValue(value) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  var type = typeof value;
  if (type === "number") return isFinite(value) ? String(value) : "nonfinite";
  if (type === "boolean") return value ? "true" : "false";
  if (type === "string") return "s:" + value;
  if (type === "function") return "function";
  return "o:" + String(value);
}

/**
 * The default styles must still be the canonical proof (T116-02): every pinned field readable and equal.
 * A document whose defaults differ is refused, never repaired (T116-03).
 */
function updStyleDefaultsCanonical(document) {
  var kinds = ["character", "paragraph"];
  for (var kindIndex = 0; kindIndex < kinds.length; kindIndex++) {
    var kind = kinds[kindIndex];
    var collection = textStyleCollection(document, kind);
    if (collection.length < 1) return false;
    var attributes = textStyleAttributesOf(collection[0], kind);
    var expected = UPD_STYLE_CANONICAL_DEFAULTS[kind];
    for (var field in expected) {
      if (!expected.hasOwnProperty(field)) continue;
      var value;
      try { value = attributes[field]; } catch (readError) { return false; }
      if (updStyleProofValue(value) !== expected[field]) return false;
    }
  }
  return true;
}

/** Which style a character reports. Unmeasured: anything but exactly one readable name is "unreadable". */
function updStyleAppliedName(character) {
  try {
    var applied = character.characterStyles;
    if (!applied || typeof applied.length !== "number") return { status: "unreadable" };
    if (applied.length === 0) return { status: "none" };
    if (applied.length !== 1) return { status: "unreadable" };
    return { status: "read", name: String(applied[0].name) };
  } catch (appliedError) { return { status: "unreadable" }; }
}

function updStyleContentsSingleParagraph(frame) {
  var contents = String(frame.contents);
  return contents.indexOf("\\r") < 0 && contents.indexOf("\\n") < 0 && contents.indexOf("\\u0003") < 0;
}

/** Every line's contents, joined: equal to the frame contents exactly when nothing overflows (measured operation). */
function updStyleLineText(frame) {
  var lines = frame.lines;
  var parts = [];
  for (var index = 0; index < lines.length; index++) parts.push(String(lines[index].contents));
  return { count: lines.length, text: parts.join("") };
}

function updStyleBoundsText(bounds) {
  return [bounds[0], bounds[1], bounds[2], bounds[3]].join(",");
}

/** The observable geometry a dependent frame's inverse must restore exactly (measured operation). */
function updStyleGeometry(frame) {
  var lines = frame.lines;
  var parts = [];
  for (var index = 0; index < lines.length; index++) parts.push(String(lines[index].contents));
  return { geometricBounds: updStyleBoundsText(frame.geometricBounds),
    visibleBounds: updStyleBoundsText(frame.visibleBounds), lines: lines.length + ":" + parts.join("/") };
}

function updStyleAncestryState(frame) {
  var hidden = false;
  var locked = false;
  for (var node = frame.layer; node && node.typename === "Layer"; node = node.parent) {
    if (node.visible !== true) hidden = true;
    if (node.locked === true) locked = true;
  }
  return { hidden: hidden, locked: locked };
}

/** A dependent frame must be one of the measured shapes: unthreaded point or non-overflowing area text. */
function updStyleFrameSupported(frame) {
  var isPoint = frame.kind === TextType.POINTTEXT;
  var isArea = frame.kind === TextType.AREATEXT;
  if (!isPoint && !isArea) return false;
  if (!frame.story || !frame.story.textFrames || frame.story.textFrames.length !== 1) return false;
  if (!updStyleContentsSingleParagraph(frame)) return false;
  if (isArea && updStyleLineText(frame).text !== String(frame.contents)) return false;
  return true;
}

/**
 * The fields a dependent character must resolve to the style's own value. A fill or stroke the style reports
 * as \`none\` is skipped: a style that never defined a fill reads NoColor (measured operation), so \`none\` cannot tell
 * "undefined" from "defined as none".
 */
function updStyleOverrideFields(entry) {
  var fields = [];
  for (var field in entry.attributes) {
    if (!entry.attributes.hasOwnProperty(field)) continue;
    var reading = entry.attributes[field];
    if (reading.status !== "defined") continue;
    if ((field === "fillColor" || field === "strokeColor") && reading.value === "none") continue;
    fields.push(field);
  }
  return fields;
}

/**
 * One bounded pass over every text frame and character: which characters report the style, the reading of
 * every requested attribute on every character, and the support facts of every frame that has a dependent.
 */
function updStyleScan(document, entry, withOverrides) {
  var frames = document.textFrames;
  if (!frames || typeof frames.length !== "number") {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "CHARACTER_STYLE_SCAN_UNREADABLE" }));
  }
  var requested = updStyleRequested();
  var overrideFields = withOverrides ? updStyleOverrideFields(entry) : [];
  var scan = { complete: true, records: [], usage: { characters: 0, frames: 0, frameList: [] },
    appliedReadable: true, overridesAbsent: true, framesUnlocked: true, framesVisible: true, framesSupported: true };
  if (frames.length > UPD_STYLE_MAX_FRAMES) { scan.complete = false; return scan; }
  var total = 0;
  for (var frameIndex = 0; frameIndex < frames.length; frameIndex++) {
    var frame = frames[frameIndex];
    var characters = frame.characters;
    var count = Number(characters.length);
    total += count;
    if (total > UPD_STYLE_MAX_CHARACTERS) { scan.complete = false; return scan; }
    var record = { uuid: String(frame.uuid), dependent: [], values: [], dependentCount: 0, geometry: null };
    for (var characterIndex = 0; characterIndex < count; characterIndex++) {
      // Held character, then its attributes: a temporary is released (9503).
      var character = characters[characterIndex];
      var applied = updStyleAppliedName(character);
      if (applied.status === "unreadable") scan.appliedReadable = false;
      var dependent = applied.status === "read" && applied.name === params.styleName;
      var attributes = character.characterAttributes;
      var readings = {};
      for (var requestedIndex = 0; requestedIndex < requested.length; requestedIndex++) {
        readings[requested[requestedIndex]] = textStyleReading(attributes, requested[requestedIndex]);
      }
      record.dependent.push(dependent);
      record.values.push(readings);
      if (!dependent) continue;
      record.dependentCount++;
      for (var fieldIndex = 0; fieldIndex < overrideFields.length; fieldIndex++) {
        var field = overrideFields[fieldIndex];
        var resolved = textStyleReading(attributes, field);
        if (resolved.status !== "defined" || resolved.value !== entry.attributes[field].value) scan.overridesAbsent = false;
      }
    }
    if (record.dependentCount > 0) {
      var ancestry = updStyleAncestryState(frame);
      if (frame.locked === true || frame.editable !== true || ancestry.locked) scan.framesUnlocked = false;
      if (frame.hidden === true || ancestry.hidden) scan.framesVisible = false;
      if (!updStyleFrameSupported(frame)) scan.framesSupported = false;
      record.geometry = updStyleGeometry(frame);
      scan.usage.characters += record.dependentCount;
      scan.usage.frames++;
      scan.usage.frameList.push({ uuid: record.uuid, kind: String(frame.kind), dependentCharacters: record.dependentCount });
    }
    scan.records.push(record);
  }
  return scan;
}

function updStylePublicUsage(scan) {
  return scan.complete
    ? { complete: true, characters: scan.usage.characters, frames: scan.usage.frames, frameList: scan.usage.frameList }
    : { complete: false, characters: 0, frames: 0, frameList: [] };
}

function updStyleBlockers(context, entry, scan, defaultsCanonical) {
  var requested = updStyleRequested();
  var blockers = [];
  var undefinedAttribute = false;
  var unreadableValue = false;
  var unchanged = false;
  for (var index = 0; index < requested.length; index++) {
    var reading = entry.attributes[requested[index]];
    if (!reading || reading.status !== "defined") { undefinedAttribute = true; continue; }
    if (!isFinite(Number(reading.value))) { unreadableValue = true; continue; }
    if (updStyleCanonicalNumber(reading.value) === updStyleCanonicalNumber(params.attributes[requested[index]])) unchanged = true;
  }
  if (!context.mutationAllowed) blockers.push("document_mutation_not_allowed");
  if (!defaultsCanonical) blockers.push("default_styles_not_canonical");
  if (entry.index === 0) blockers.push("target_is_default_style");
  if (undefinedAttribute) blockers.push("attribute_not_defined_on_style");
  if (unreadableValue) blockers.push("attribute_value_unreadable");
  if (unchanged) blockers.push("value_unchanged");
  if (!scan.complete) blockers.push("usage_scan_limit_exceeded");
  if (!scan.appliedReadable) blockers.push("applied_style_unreadable");
  if (!scan.overridesAbsent) blockers.push("dependent_overrides_present");
  if (!scan.framesUnlocked) blockers.push("dependent_frame_locked");
  if (!scan.framesVisible) blockers.push("dependent_frame_hidden");
  if (!scan.framesSupported) blockers.push("dependent_frame_unsupported");
  return blockers;
}

function updStyleResolveTarget(document) {
  var resolved = textStyleResolveNamed(document, "character", params.styleName);
  if (resolved.status !== "resolved") {
    throw mutationError("preflight_failed", stringifyJson({ code: resolved.code, name: resolved.name, total: resolved.count }));
  }
  return resolved;
}

function updStyleResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  var collections = updStyleCollections(document);
  var resolved = updStyleResolveTarget(document);
  var defaultsCanonical = updStyleDefaultsCanonical(document);
  var scan = updStyleScan(document, resolved.entry, true);
  var blockers = updStyleBlockers(context, resolved.entry, scan, defaultsCanonical);
  if (forApply && blockers.length > 0) {
    throw mutationBeforeSideEffectError(stringifyJson({ code: "CHARACTER_STYLE_UPDATE_BLOCKED",
      reasonCodes: blockers, name: params.styleName }));
  }
  return { context: context, document: document, collections: collections, style: resolved.style,
    entry: resolved.entry, defaultsCanonical: defaultsCanonical, scan: scan, blockers: blockers };
}

function updStylePreflight(forApply) {
  var resolved = updStyleResolve(forApply);
  if (forApply) {
    if (!updStyleSame(resolved.entry, params.expectedStyle)) {
      throw mutationError("preflight_failed", stringifyJson({ code: "CHARACTER_STYLE_STALE", field: "expected_style",
        name: params.styleName }));
    }
    if (!updStyleSame(resolved.collections, params.expectedCollections)) {
      throw mutationError("preflight_failed", stringifyJson({ code: "CHARACTER_STYLE_STALE", field: "expected_collections",
        name: params.styleName }));
    }
    var usage = updStylePublicUsage(resolved.scan);
    if (usage.characters !== params.expectedUsage.characters || usage.frames !== params.expectedUsage.frames) {
      throw mutationError("preflight_failed", stringifyJson({ code: "CHARACTER_STYLE_USAGE_MISMATCH",
        name: params.styleName, expected: params.expectedUsage,
        actual: { characters: usage.characters, frames: usage.frames } }));
    }
  }
  return resolved;
}

function updStylePlan(preflight) {
  return {
    operation: "update_character_style", documentKey: preflight.context.key, styleName: params.styleName,
    attributes: params.attributes, style: preflight.entry, collections: preflight.collections,
    usage: updStylePublicUsage(preflight.scan),
    checks: { defaultStylesCanonical: preflight.defaultsCanonical,
      appliedStylesReadable: preflight.scan.appliedReadable, dependentOverridesAbsent: preflight.scan.overridesAbsent,
      dependentFramesUnlocked: preflight.scan.framesUnlocked, dependentFramesVisible: preflight.scan.framesVisible,
      dependentFramesSupported: preflight.scan.framesSupported },
    applyBlockedReasonCodes: preflight.blockers,
    confirmationStatus: params.apply === true ? "confirmed" : "required",
    applyAllowed: params.apply === true && preflight.blockers.length === 0
  };
}

function updStyleRevalidate(preflight, plan) {
  var current;
  try { current = updStyleResolve(true); }
  catch (error) {
    throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Character-style update preconditions changed before apply."));
  }
  if (current.document !== preflight.document || !updStyleSame(current.entry, plan.style) ||
      !updStyleSame(current.collections, plan.collections) ||
      !updStyleSame(current.scan.records, preflight.scan.records)) {
    throw mutationBeforeSideEffectError("The character style, the style collections or the text using the style changed before apply.");
  }
}

/** Measured primitive (measured operation): hold the style's attributes, then write each requested value. */
function updStyleApply(preflight, plan, state) {
  var requested = updStyleRequested();
  var attributes = preflight.style.characterAttributes;
  state.operationState.mutationStarted = true;
  for (var index = 0; index < requested.length; index++) {
    attributes[requested[index]] = params.attributes[requested[index]];
  }
  return preflight.style;
}

function updStyleEntryMatchesUpdate(before, after) {
  if (!after || after.name !== before.name || after.index !== before.index || after.duplicateName) return false;
  var requested = updStyleRequested();
  var changed = {};
  for (var index = 0; index < requested.length; index++) changed[requested[index]] = true;
  for (var field in before.attributes) {
    if (!before.attributes.hasOwnProperty(field)) continue;
    var reading = after.attributes[field];
    if (changed[field] === true) {
      if (!reading || reading.status !== "defined" ||
          updStyleCanonicalNumber(reading.value) !== updStyleCanonicalNumber(params.attributes[field])) return false;
    } else if (!updStyleSame(reading, before.attributes[field])) return false;
  }
  return true;
}

/**
 * Exactly the characters the plan reported as dependent carry the new value; every other character keeps
 * its exact reading. This is what makes the unmeasured applied-style read safe to rely on.
 */
function updStyleScanMatchesUpdate(before, after) {
  if (!after.complete || after.records.length !== before.records.length) return false;
  var requested = updStyleRequested();
  for (var frameIndex = 0; frameIndex < before.records.length; frameIndex++) {
    var was = before.records[frameIndex];
    var now = after.records[frameIndex];
    if (now.uuid !== was.uuid || !updStyleSame(now.dependent, was.dependent)) return false;
    for (var characterIndex = 0; characterIndex < was.values.length; characterIndex++) {
      for (var index = 0; index < requested.length; index++) {
        var name = requested[index];
        var reading = now.values[characterIndex][name];
        if (was.dependent[characterIndex]) {
          if (!reading || reading.status !== "defined" ||
              updStyleCanonicalNumber(reading.value) !== updStyleCanonicalNumber(params.attributes[name])) return false;
        } else if (!updStyleSame(reading, was.values[characterIndex][name])) return false;
      }
    }
  }
  return true;
}

function updStyleVerify(preflight, plan) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) {
    throw mutationError("verify_mismatch", "Active document changed during character-style update verification.");
  }
  var collections = updStyleCollections(preflight.document);
  if (!updStyleSame(collections, plan.collections)) {
    throw mutationError("verify_mismatch", "The style collections changed during the character-style update.");
  }
  var resolved = textStyleResolveNamed(preflight.document, "character", params.styleName);
  if (resolved.status !== "resolved" || !updStyleEntryMatchesUpdate(plan.style, resolved.entry)) {
    throw mutationError("verify_mismatch", "The character style does not carry exactly the requested update.");
  }
  var scan = updStyleScan(preflight.document, resolved.entry, false);
  if (!updStyleScanMatchesUpdate(preflight.scan, scan)) {
    throw mutationError("verify_mismatch", "The characters that moved are not exactly the style's reported dependents.");
  }
  for (var frameIndex = 0; frameIndex < preflight.scan.records.length; frameIndex++) {
    if (preflight.scan.records[frameIndex].dependentCount === 0) continue;
    var frame = preflight.document.getPageItemFromUuid(preflight.scan.records[frameIndex].uuid);
    // Overflow after the update is outside the measured profile (measured operation never overflowed).
    if (frame.kind === TextType.AREATEXT && updStyleLineText(frame).text !== String(frame.contents)) {
      throw mutationError("verify_mismatch", "Area text using the style overflows after the update.");
    }
  }
  return { style: resolved.entry, collections: collections };
}

/**
 * The measured inverse (measured operation): write back the raw value read before the update, then require the style
 * entry, the collections, every character's reading and every dependent frame's geometry to be exactly the
 * before state. Anything that is not our own update stays indeterminate for reconciliation.
 */
function updStyleRollback(state) {
  var preflight = state.preflight;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) {
    return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
  }
  var before = preflight.entry;
  var resolved;
  try {
    if (!updStyleSame(updStyleCollections(preflight.document), preflight.collections)) {
      return { status: "indeterminate", message: "Rollback refused because the style collections changed." };
    }
    resolved = textStyleResolveNamed(preflight.document, "character", params.styleName);
  } catch (readError) { return { status: "indeterminate", message: "Rollback style state is indeterminate." }; }
  if (resolved.status !== "resolved" || resolved.entry.index !== before.index || resolved.style !== preflight.style) {
    return { status: "indeterminate", message: "Rollback style identity is indeterminate." };
  }
  var requested = updStyleRequested();
  var touched = {};
  for (var requestedIndex = 0; requestedIndex < requested.length; requestedIndex++) touched[requested[requestedIndex]] = true;
  for (var field in before.attributes) {
    if (!before.attributes.hasOwnProperty(field) || touched[field] === true) continue;
    if (!updStyleSame(resolved.entry.attributes[field], before.attributes[field])) {
      return { status: "indeterminate", message: "Rollback refused because the style changed outside the requested attributes." };
    }
  }
  if (!updStyleSame(resolved.entry, before)) {
    try {
      var attributes = preflight.style.characterAttributes;
      for (var index = 0; index < requested.length; index++) {
        attributes[requested[index]] = Number(before.attributes[requested[index]].value);
      }
    } catch (writeError) { return { status: "indeterminate", message: "Rollback style write is indeterminate." }; }
  }
  var restored;
  var scan;
  try {
    restored = textStyleResolveNamed(preflight.document, "character", params.styleName);
    scan = updStyleScan(preflight.document, before, false);
  } catch (verifyError) { return { status: "indeterminate", message: "Rollback verification is indeterminate." }; }
  state.operationState.rollbackEvidence.restoredStyle = restored.status === "resolved" ? restored.entry : null;
  if (restored.status !== "resolved" || !updStyleSame(restored.entry, before) ||
      !updStyleSame(updStyleCollections(preflight.document), preflight.collections) ||
      !updStyleSame(scan.records, preflight.scan.records)) {
    return { status: "failed", message: "Rollback did not restore the exact before style and text state." };
  }
  return { status: "verified" };
}

var updStyleExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionAffected: function (phase, preflight) { var uuids = []; var frames = preflight.scan.usage.frameList; for (var i = 0; i < frames.length; i++) uuids.push(frames[i].uuid); return uuids; },
  initialOperationState: function () {
    return { mutationStarted: false, rollbackEvidence: { restoredStyle: null } };
  },
  preflight: updStylePreflight,
  plan: updStylePlan,
  revalidate: updStyleRevalidate,
  applyMutation: updStyleApply,
  verify: updStyleVerify,
  rollback: updStyleRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () {
    return { reasonCode: "style_state_unknown",
      message: "Character-style update outcome is indeterminate.",
      evidence: { restoredStyle: null } };
  },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var updStyleDocument = updStyleExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === updStyleExecution.preflight.document) {
  updStyleDocument = getDocumentContext();
}
var result = { operation: "update_character_style",
  applied: updStyleExecution.transaction.state === "verified",
  document: updStyleDocument, plan: updStyleExecution.plan, transaction: updStyleExecution.transaction };
if (updStyleExecution.transaction.state === "verified") result.postcondition = updStyleExecution.value;
`;
export const UPDATE_CHARACTER_STYLE_HOST_SCRIPT_DIGEST = canonicalSha256(UPDATE_CHARACTER_STYLE_SCRIPT);
export const UPDATE_CHARACTER_STYLE_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: UPDATE_CHARACTER_STYLE_OPERATION,
    validator: UPDATE_CHARACTER_STYLE_VALIDATOR, canonicalContractVersion: CANONICAL_VERSION,
    resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: UPDATE_CHARACTER_STYLE_SAFETY_IDENTITY,
    hostScriptDigest: UPDATE_CHARACTER_STYLE_HOST_SCRIPT_DIGEST,
    mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    assertRequestsAnAttribute(request.attributes);
    const digestRequest = 'commandId' in request
        ? (({ commandId: _commandId, ...rest }) => rest)(request)
        : request;
    const digest = canonicalSha256({ operation: UPDATE_CHARACTER_STYLE_OPERATION,
        validator: UPDATE_CHARACTER_STYLE_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request,
        commandId: 'commandId' in request ? request.commandId : null,
        documentKey: request.expectedDocumentKey, digest };
}
export const updateCharacterStyleToolContract = {
    name: 'illustrator_update_character_style',
    title: 'Plan or Update a Named Character Style in Use',
    description: 'Plan or update `tracking`, `horizontal_scale`, or both on one existing named character style, '
        + 'which changes every character that uses the style anywhere in the bound document. Those are the only '
        + 'attributes whose in-use inverse is measured; everything else is refused. The plan reports how many '
        + 'characters and frames currently use the style; apply requires echoing that count as `expected_usage`, '
        + 'plus `expected_style` and `expected_collections` exactly as planned. Refused: a name that does not '
        + 'resolve to exactly one style, the default style, an attribute the style does not define, an unchanged '
        + 'value, a document whose default styles are not the canonical profile, text whose applied style cannot '
        + 'be read, dependent characters with local overrides, dependent frames that are locked, hidden, threaded, '
        + 'multi-paragraph, overflowing or not point/area text, and documents beyond 128 text frames or 4096 '
        + 'characters. The style is never renamed or removed. Verification requires exactly the reported '
        + 'dependents to take the new value and every other character to stay unchanged; rollback writes back '
        + 'the value read before the update and proves the exact before state.',
    inputSchema,
    publicInputSchema: updateCharacterStylePublicInputSchema,
    outputSchema: updateCharacterStyleResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(UPDATE_CHARACTER_STYLE_SAFETY.policy),
    normalizePublicInput,
};
export function createUpdateCharacterStyleAdapter() {
    return {
        version: 1, operation: UPDATE_CHARACTER_STYLE_OPERATION, validator: UPDATE_CHARACTER_STYLE_VALIDATOR,
        safety: UPDATE_CHARACTER_STYLE_SAFETY, safetyRegistrationIdentity: UPDATE_CHARACTER_STYLE_SAFETY_IDENTITY,
        adapterIdentity: UPDATE_CHARACTER_STYLE_ADAPTER_IDENTITY, tool: updateCharacterStyleToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest,
            safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: updateCharacterStyleResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: CLASSIFIER_VERSION, safetyConformanceVersion: CONFORMANCE_VERSION,
        errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: UPDATE_CHARACTER_STYLE_HOST_SCRIPT_DIGEST,
        mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: UPDATE_CHARACTER_STYLE_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: UPDATE_CHARACTER_STYLE_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: UPDATE_CHARACTER_STYLE_OPERATION,
                    documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: UPDATE_CHARACTER_STYLE_ADAPTER_IDENTITY,
                mutationHostApplicationMode: 'foreground', script: UPDATE_CHARACTER_STYLE_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = updateCharacterStyleResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back')
                return { state };
            if (state === 'planned')
                throw new Error('A character-style update plan is not a terminal mutation result.');
            throw new Error('Unverified character-style update recovery must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error, detail) {
            if (detail?.code === 'CHARACTER_STYLE_UPDATE_BLOCKED') {
                return new Error(`Updating the character style is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}.`);
            }
            if (detail?.code === 'CHARACTER_STYLE_USAGE_MISMATCH') {
                return new Error(`The character style ${JSON.stringify(detail.name ?? '')} usage changed: expected_usage `
                    + `${JSON.stringify(detail.expected ?? null)} does not match ${JSON.stringify(detail.actual ?? null)}; plan again.`);
            }
            if (detail?.code === 'CHARACTER_STYLE_STALE') {
                return new Error(`The character style ${JSON.stringify(detail.name ?? '')} changed since the plan `
                    + `(${detail.field ?? 'state'}); plan again.`);
            }
            if (detail?.code === 'TEXT_STYLE_NOT_FOUND') {
                return new Error(`No character style named ${JSON.stringify(detail.name ?? '')} exists in the bound document.`);
            }
            if (detail?.code === 'TEXT_STYLE_NAME_CONFLICT') {
                return new Error(`The character style name ${JSON.stringify(detail.name ?? '')} resolves to ${detail.total ?? 'several'} styles; `
                    + 'rename them so the target is unambiguous.');
            }
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
