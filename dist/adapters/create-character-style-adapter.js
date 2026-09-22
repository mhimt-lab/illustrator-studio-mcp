import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, TEXT_STYLE_RESOURCE_NAME_MAX, } from '../operation-safety-policy-core.js';
import { characterStyleEntrySchema, TEXT_STYLE_MAX_STYLES, TEXT_STYLE_RESOURCE_SCRIPT, } from '../text-style-resources.js';
export const CREATE_CHARACTER_STYLE_OPERATION = 'create_character_style';
export const CREATE_CHARACTER_STYLE_VALIDATOR = { kind: CREATE_CHARACTER_STYLE_OPERATION, version: 3 };
const CANONICAL_VERSION = 1;
const RESULT_SCHEMA_VERSION = 1;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
const POLICY_VERSION = 3;
const styleNameSchema = z.string().min(1).max(TEXT_STYLE_RESOURCE_NAME_MAX);
const requestedAttributesSchema = z.strictObject({
    size: z.number().finite().positive().optional(),
    tracking: z.number().finite().optional(),
});
const publicAttributesSchema = requestedAttributesSchema;
export function sameCanonicalNumber(reading, requested) {
    const read = Number(reading);
    if (!Number.isFinite(read))
        return false;
    const canonical = (value) => {
        const rounded = Math.round(value * 100_000) / 100_000;
        return Object.is(rounded, -0) ? 0 : rounded;
    };
    return canonical(read) === canonical(requested);
}
function assertRequestsAnAttribute(attributes) {
    if (!Object.values(attributes).some((value) => value !== undefined)) {
        throw new Error('Creating a character style must request at least one attribute.');
    }
}
const collectionsSnapshotSchema = z.strictObject({
    complete: z.literal(true),
    characterStyles: z.array(styleNameSchema).max(TEXT_STYLE_MAX_STYLES),
    paragraphStyles: z.array(styleNameSchema).max(TEXT_STYLE_MAX_STYLES),
});
const blockerSchema = z.enum([
    'document_mutation_not_allowed',
    'resource_name_already_exists',
    'resource_collection_capacity_exceeded',
    'result_size_limit_exceeded',
]);
export const createCharacterStylePlanSchema = z.strictObject({
    operation: z.literal(CREATE_CHARACTER_STYLE_OPERATION),
    documentKey: z.string().min(1).max(16_384),
    styleName: styleNameSchema,
    attributes: requestedAttributesSchema,
    beforeSnapshot: collectionsSnapshotSchema,
    nameAbsent: z.boolean(),
    collectionCapacityWithinLimit: z.boolean(),
    resultSizeWithinLimit: z.boolean(),
    applyBlockedReasonCodes: z.array(blockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    if (plan.nameAbsent !== !plan.beforeSnapshot.characterStyles.includes(plan.styleName)) {
        context.addIssue({ code: 'custom', message: 'A character-style creation plan must derive nameAbsent from the captured collection.' });
    }
    const allowed = plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0;
    if (plan.applyAllowed !== allowed) {
        context.addIssue({ code: 'custom', message: 'Character-style creation applyAllowed must require confirmation and no blockers.' });
    }
});
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']),
    reasonCode: z.enum(['apply_failed', 'verify_mismatch']),
    message: z.string().min(1).max(500),
}).superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed')) {
        context.addIssue({ code: 'custom', message: 'Character-style creation failure phase and reason code must match.' });
    }
});
const indeterminateFailureSchema = z.strictObject({
    phase: z.literal('apply'),
    reasonCode: z.literal('apply_indeterminate'),
    message: z.string().min(1).max(500),
});
const createdResourceSchema = z.strictObject({
    collectionKind: z.literal('characterStyles'),
    collectionIndex: z.number().int().nonnegative().max(511),
    name: styleNameSchema,
    resourceType: z.literal('named_character_style'),
    entry: characterStyleEntrySchema,
    afterSnapshot: collectionsSnapshotSchema,
});
const rollbackEvidence = {
    createdResource: createdResourceSchema.nullable(),
    restoredSnapshot: collectionsSnapshotSchema.nullable(),
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
            status: z.literal('indeterminate'), reasonCode: z.literal('resource_state_unknown'),
            message: z.string().min(1).max(500), createdResource: z.null(), restoredSnapshot: z.null(),
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
        context.addIssue({ code: 'custom', message: 'Character-style creation audit sequence does not match transaction state.' });
    }
    transaction.audit.forEach((event, index) => {
        if (event.sequence !== index) {
            context.addIssue({ code: 'custom', message: 'Character-style creation audit sequence must be contiguous.' });
        }
    });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' &&
            event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode &&
            event.message === transaction.failure.message);
        if (matches.length !== 1) {
            context.addIssue({ code: 'custom', message: 'Character-style creation failure must match one audit event.' });
        }
    }
});
export const createCharacterStyleResultSchema = z.union([
    z.strictObject({
        operation: z.literal(CREATE_CHARACTER_STYLE_OPERATION), applied: z.literal(false),
        document: documentContextSchema, plan: createCharacterStylePlanSchema, transaction: transactionSchema,
    }),
    z.strictObject({
        operation: z.literal(CREATE_CHARACTER_STYLE_OPERATION), applied: z.literal(true),
        document: documentContextSchema, plan: createCharacterStylePlanSchema,
        resource: createdResourceSchema, transaction: transactionSchema,
    }),
]).superRefine((result, context) => {
    if (result.transaction.state === 'planned') {
        const blockers = [];
        if (!result.document.mutationAllowed)
            blockers.push('document_mutation_not_allowed');
        if (!result.plan.nameAbsent)
            blockers.push('resource_name_already_exists');
        if (!result.plan.collectionCapacityWithinLimit)
            blockers.push('resource_collection_capacity_exceeded');
        if (!result.plan.resultSizeWithinLimit)
            blockers.push('result_size_limit_exceeded');
        if (result.plan.confirmationStatus !== 'required' ||
            canonicalSha256(result.plan.applyBlockedReasonCodes) !==
                canonicalSha256(blockers)) {
            context.addIssue({ code: 'custom', message: 'A planned character-style creation must expose exact blockers.' });
        }
    }
    else if (result.plan.confirmationStatus !== 'confirmed' ||
        result.plan.applyBlockedReasonCodes.length !== 0 || !result.plan.applyAllowed) {
        context.addIssue({ code: 'custom', message: 'A created character style must derive from an allowed confirmed plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified') {
            context.addIssue({ code: 'custom', message: 'A created character style must come from a verified transaction.' });
        }
        const before = result.plan.beforeSnapshot;
        const after = result.resource.afterSnapshot;
        const expectedAfter = [...before.characterStyles];
        expectedAfter.splice(result.resource.collectionIndex, 0, result.resource.name);
        if (result.resource.name !== result.plan.styleName ||
            result.resource.entry.name !== result.plan.styleName || result.resource.entry.duplicateName ||
            result.resource.entry.index !== result.resource.collectionIndex ||
            canonicalSha256(after.characterStyles) !==
                canonicalSha256(expectedAfter) ||
            canonicalSha256(after.paragraphStyles) !==
                canonicalSha256(before.paragraphStyles)) {
            context.addIssue({ code: 'custom', message: 'A created character style must be the only new style, at its reported index, leaving every other style unchanged.' });
        }
        for (const [attribute, value] of Object.entries(result.plan.attributes)) {
            if (value === undefined)
                continue;
            const reading = result.resource.entry.attributes[attribute];
            if (reading === undefined || reading.status !== 'defined' ||
                !sameCanonicalNumber(reading.value, value)) {
                context.addIssue({ code: 'custom', message: `A created character style must define ${attribute} with the requested value.` });
            }
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified character-style creation must report the created style.' });
    }
    if (result.transaction.state === 'rolled_back' &&
        canonicalSha256(result.transaction.rollback.restoredSnapshot) !==
            canonicalSha256(result.plan.beforeSnapshot)) {
        context.addIssue({ code: 'custom', message: 'A rolled-back character-style creation must prove the exact before collections.' });
    }
});
export const createCharacterStyleResponseSchema = z.strictObject({
    outcome: createCharacterStyleResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
const commonInternal = {
    expectedDocumentKey: z.string().min(1).max(16_384),
    styleName: styleNameSchema,
    attributes: requestedAttributesSchema,
};
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({ ...commonInternal, apply: z.literal(true), commandId: canonicalCommandIdSchema }),
]);
const commonPublic = {
    expected_document_key: z.string().min(1).max(16_384),
    style_name: styleNameSchema,
    attributes: publicAttributesSchema,
};
export const createCharacterStylePublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({ ...commonPublic, apply: z.literal(true), command_id: applyCommandIdSchema }),
]);
const inputSchema = z.strictObject({
    ...commonPublic,
    apply: z.boolean().default(false),
    command_id: applyCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(createCharacterStylePublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = createCharacterStylePublicInputSchema.parse(input);
    assertRequestsAnAttribute(value.attributes);
    const common = {
        expectedDocumentKey: value.expected_document_key,
        styleName: value.style_name,
        attributes: {
            ...(value.attributes.size === undefined ? {} : { size: value.attributes.size }),
            ...(value.attributes.tracking === undefined ? {} : { tracking: value.attributes.tracking }),
        },
    };
    return value.apply ? { ...common, apply: true, commandId: value.command_id } : { ...common, apply: false };
}
export const CREATE_CHARACTER_STYLE_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: CREATE_CHARACTER_STYLE_OPERATION,
    policy: {
        version: POLICY_VERSION, class: 'create_resource', destructive: false,
        evidence: {
            identity: 'native_resource_identity_v2',
            ownership: 'self_created_unreferenced_resource_only',
            beforeSnapshot: 'complete_ordered_resource_collections_digest',
            postcondition: 'created_resource_and_collection_delta_match_plan',
        },
        preconditions: {
            documentBinding: 'explicit_document_key',
            collectionSnapshot: 'same_execution_complete_before_apply',
            nameValidation: 'exact_absence_before_add',
            collectionCapacity: 'predicted_after_within_complete_limit',
            resultSizeAdmission: 'bounded_before_add',
            hostVersionGate: 'not_applicable',
        },
        confirmation: 'risk_scoped',
        recovery: {
            mode: 'remove_captured_self_created_resource',
            verification: 'complete_ordered_resource_collections_match_before_digest',
            unknownIdentity: 'indeterminate',
        },
        terminal: {
            success: 'verified', failure: 'proven_pre_apply_or_verified_recovery',
            partialSuccess: 'nonterminal_until_reconciled',
        },
        replay: {
            requestBinding: 'canonical_request_digest', retry: 'return_attested_terminal_result',
            beforeTerminal: 'reconcile_required', reapplyOnRetry: false,
        },
    },
    capabilities: {
        class: 'create_resource',
        explicitDocumentBinding: true,
        captureCompleteBeforeSnapshot: true,
        validatePredictedCollectionCapacity: true,
        boundDurableResultSizeBeforeAdd: true,
        revalidateSnapshotAndNameBeforeAdd: true,
        captureNativeResourceIdentity: true,
        verifyCreatedResourceAndCollectionDelta: true,
        rollbackCapturedSelfCreatedResourceOnly: true,
        verifyCompleteRollbackSnapshot: true,
        reconcileIndeterminate: true,
        durableTerminalReplay: true,
        trustedTerminalAttestationResolver: true,
    },
});
export const CREATE_CHARACTER_STYLE_SAFETY_IDENTITY = canonicalDigest(CREATE_CHARACTER_STYLE_SAFETY);
function snapshotCounts(snapshot) {
    return { characterStyles: snapshot.characterStyles.length, paragraphStyles: snapshot.paragraphStyles.length };
}
function definitionDigest(plan) {
    return canonicalDigest({ name: plan.styleName, attributes: plan.attributes });
}
function nativeIdentity(result, resource) {
    return {
        version: 1,
        documentKey: result.plan.documentKey,
        collectionKind: 'characterStyles',
        collectionIndex: resource.collectionIndex,
        name: resource.name,
        resourceType: 'named_character_style',
        definitionDigest: definitionDigest(result.plan),
        beforeSnapshotDigest: canonicalDigest(result.plan.beforeSnapshot),
        beforeSnapshotCounts: snapshotCounts(result.plan.beforeSnapshot),
    };
}
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    return bindOperationSafetyPlan({
        policyVersion: POLICY_VERSION, operationClass: 'create_resource',
        operationId: CREATE_CHARACTER_STYLE_OPERATION, canonicalRequestDigest: requestDigest,
        evidence: {
            documentKey: admissionDocumentKey,
            collectionKind: 'characterStyles',
            requestedName: result.plan.styleName,
            resourceType: 'named_character_style',
            plannedDefinitionDigest: definitionDigest(result.plan),
            beforeSnapshotDigest: canonicalDigest(result.plan.beforeSnapshot),
            beforeSnapshotCounts: snapshotCounts(result.plan.beforeSnapshot),
        },
        preconditions: {
            status: result.plan.applyAllowed ? 'satisfied' : 'blocked',
            snapshotComplete: result.plan.beforeSnapshot.complete,
            nameAbsent: result.plan.nameAbsent,
            collectionCapacityWithinLimit: result.plan.collectionCapacityWithinLimit,
            resultSizeWithinLimit: result.plan.resultSizeWithinLimit,
            hostVersionVerified: true,
        },
        confirmation: { kind: 'risk_scoped', status: 'not_required' },
        applyAllowed: result.plan.applyAllowed,
    });
}
function safetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' ||
        transaction.state === 'rollback_indeterminate') {
        throw new Error('Indeterminate character-style creation cannot be terminal.');
    }
    const common = { policyVersion: POLICY_VERSION, operationClass: 'create_resource',
        operationId: CREATE_CHARACTER_STYLE_OPERATION, canonicalRequestDigest: requestDigest,
        planDigest: plan.planDigest, attestation };
    const beforeSnapshotDigest = canonicalDigest(result.plan.beforeSnapshot);
    if (transaction.state === 'verified') {
        if (!result.applied)
            throw new Error('A verified character-style creation must report the created style.');
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { resourceIdentity: nativeIdentity(result, result.resource),
                ownership: 'self_created_unreferenced_resource_only', postconditionVerified: true,
                rollbackSnapshotDigest: null, rollbackSnapshotVerified: false, outstandingEffect: null },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'succeeded', terminal: true, recovery: 'not_required',
                proof: { kind: 'verified_postcondition' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    if (transaction.state === 'apply_failed') {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { resourceIdentity: null, ownership: 'self_created_unreferenced_resource_only',
                postconditionVerified: false, rollbackSnapshotDigest: null, rollbackSnapshotVerified: false,
                outstandingEffect: null },
            executionEvidence: { outcome: 'proven_pre_apply' },
            resolution: { status: 'failed', terminal: true, recovery: 'not_required',
                proof: { kind: 'proven_pre_apply', mutationAttempted: false },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    const created = transaction.rollback.createdResource;
    if (created === null)
        throw new Error('A recovered character-style creation must report the resource it created.');
    const identity = nativeIdentity(result, created);
    if (transaction.state === 'rolled_back') {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { resourceIdentity: identity, ownership: 'self_created_unreferenced_resource_only',
                postconditionVerified: false, rollbackSnapshotDigest: beforeSnapshotDigest,
                rollbackSnapshotVerified: true, outstandingEffect: null },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'recovered', terminal: true, recovery: 'verified',
                proof: { kind: 'verified_recovery' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    const restored = transaction.rollback.restoredSnapshot;
    return operationSafetyResultSchema.parse({ ...common,
        evidence: { resourceIdentity: identity, ownership: 'self_created_unreferenced_resource_only',
            postconditionVerified: false,
            rollbackSnapshotDigest: restored === null ? canonicalDigest({ unrestored: identity.name }) : canonicalDigest(restored),
            rollbackSnapshotVerified: false,
            outstandingEffect: { kind: 'captured_native_resource_still_present', resourceIdentity: identity } },
        executionEvidence: { outcome: 'recovery_failed' },
        resolution: { status: 'recovery_failed', terminal: true, recovery: 'failed',
            outstandingEffect: 'known_effect_present',
            proof: { kind: 'verified_outstanding_effect' },
            replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
}
async function assertSafety(value, requestDigest, attestation, resolver) {
    const result = createCharacterStyleResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null) {
        throw new Error('Character-style creation terminal result requires attestation.');
    }
    await assertOperationSafetyAdapterConformance({ registration: CREATE_CHARACTER_STYLE_SAFETY, plan,
        result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
export const CREATE_CHARACTER_STYLE_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${TEXT_STYLE_RESOURCE_SCRIPT}
var CREATE_CHARACTER_STYLE_MAX_STYLES = ${TEXT_STYLE_MAX_STYLES};
var CREATE_CHARACTER_STYLE_NAME_MAX = ${TEXT_STYLE_RESOURCE_NAME_MAX};

/** The complete ordered style collections, the before state the rollback restores. */
function styleResCollections(document) {
  return { complete: true, characterStyles: textStyleNames(textStyleCollection(document, "character")),
    paragraphStyles: textStyleNames(textStyleCollection(document, "paragraph")) };
}

/** Five-decimal canonical rounding, the twin of sameCanonicalNumber above. */
function styleResCanonicalNumber(value) {
  var parsed = Number(value);
  if (!isFinite(parsed)) return "nonfinite";
  var rounded = Math.round(parsed * 100000) / 100000;
  return String(rounded === 0 ? 0 : rounded);
}

function styleResSame(left, right) {
  return left && right && stringifyJson(left) === stringifyJson(right);
}

function styleResNameCount(names, name) {
  var count = 0;
  for (var index = 0; index < names.length; index++) if (names[index] === name) count++;
  return count;
}

function styleResBoundedNames(snapshot) {
  var groups = [snapshot.characterStyles, snapshot.paragraphStyles];
  for (var groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    for (var index = 0; index < groups[groupIndex].length; index++) {
      if (groups[groupIndex][index].length > CREATE_CHARACTER_STYLE_NAME_MAX) return false;
    }
  }
  return String(params.styleName).length <= CREATE_CHARACTER_STYLE_NAME_MAX;
}

function styleResResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  var before = styleResCollections(document);
  var nameAbsent = styleResNameCount(before.characterStyles, params.styleName) === 0;
  var capacityWithinLimit = before.characterStyles.length + 1 <= CREATE_CHARACTER_STYLE_MAX_STYLES;
  var resultSizeWithinLimit = styleResBoundedNames(before);
  var blockers = [];
  if (!context.mutationAllowed) blockers.push("document_mutation_not_allowed");
  if (!nameAbsent) blockers.push("resource_name_already_exists");
  if (!capacityWithinLimit) blockers.push("resource_collection_capacity_exceeded");
  if (!resultSizeWithinLimit) blockers.push("result_size_limit_exceeded");
  if (forApply && blockers.length > 0) {
    throw mutationBeforeSideEffectError(stringifyJson({ code: "CREATE_CHARACTER_STYLE_BLOCKED",
      reasonCodes: blockers, name: params.styleName }));
  }
  return { context: context, document: document, before: before, nameAbsent: nameAbsent,
    collectionCapacityWithinLimit: capacityWithinLimit, resultSizeWithinLimit: resultSizeWithinLimit,
    blockers: blockers };
}

function styleResPlan(preflight) {
  return {
    operation: "create_character_style", documentKey: preflight.context.key, styleName: params.styleName,
    attributes: params.attributes, beforeSnapshot: preflight.before, nameAbsent: preflight.nameAbsent,
    collectionCapacityWithinLimit: preflight.collectionCapacityWithinLimit,
    resultSizeWithinLimit: preflight.resultSizeWithinLimit,
    applyBlockedReasonCodes: preflight.blockers,
    confirmationStatus: params.apply === true ? "confirmed" : "required",
    applyAllowed: params.apply === true && preflight.blockers.length === 0
  };
}

function styleResRevalidate(preflight, plan) {
  var current;
  try { current = styleResResolve(true); }
  catch (error) {
    throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Character-style creation preconditions changed before apply."));
  }
  if (current.document !== preflight.document || !styleResSame(current.before, plan.beforeSnapshot) ||
      !current.nameAbsent) {
    throw mutationBeforeSideEffectError("The style collections or the requested name changed before apply.");
  }
}

/** Measured: add(name), then write the admitted attributes onto the created style. */
function styleResApply(preflight, plan, state) {
  state.operationState.mutationStarted = true;
  var created = preflight.document.characterStyles.add(params.styleName);
  state.operationState.createdName = params.styleName;
  if (params.attributes.size !== undefined) created.characterAttributes.size = params.attributes.size;
  if (params.attributes.tracking !== undefined) created.characterAttributes.tracking = params.attributes.tracking;
  return created;
}

function styleResVerify(preflight, plan, state) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) {
    throw mutationError("verify_mismatch", "Active document changed during character-style creation verification.");
  }
  var resolved = textStyleResolveNamed(preflight.document, "character", params.styleName);
  if (resolved.status !== "resolved") {
    throw mutationError("verify_mismatch", "The created character style does not resolve to exactly one style.");
  }
  var after = styleResCollections(preflight.document);
  var expected = [];
  for (var index = 0; index < plan.beforeSnapshot.characterStyles.length; index++) {
    expected.push(plan.beforeSnapshot.characterStyles[index]);
  }
  expected.splice(resolved.entry.index, 0, params.styleName);
  if (stringifyJson(after.characterStyles) !== stringifyJson(expected) ||
      stringifyJson(after.paragraphStyles) !== stringifyJson(plan.beforeSnapshot.paragraphStyles)) {
    throw mutationError("verify_mismatch", "The created character style is not the only collection change.");
  }
  var requested = ["size", "tracking"];
  for (var attributeIndex = 0; attributeIndex < requested.length; attributeIndex++) {
    var name = requested[attributeIndex];
    if (params.attributes[name] === undefined) continue;
    var reading = resolved.entry.attributes[name];
    // Compared at five decimals: Illustrator quantizes some style attributes (measured profile).
    if (!reading || reading.status !== "defined" ||
        styleResCanonicalNumber(reading.value) !== styleResCanonicalNumber(params.attributes[name])) {
      throw mutationError("verify_mismatch", "The created character style does not carry the requested " + name + ".");
    }
  }
  return { collectionKind: "characterStyles", collectionIndex: resolved.entry.index, name: params.styleName,
    resourceType: "named_character_style", entry: resolved.entry, afterSnapshot: after };
}

/**
 * Rollback removes only the style this transaction created, and only while the collections are exactly
 * the baseline plus that one name. Nothing can reference it: it was created in this transaction and
 * never applied.
 */
function styleResRollback(state) {
  var preflight = state.preflight;
  var createdName = state.operationState.createdName;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) {
    return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
  }
  var current;
  try { current = styleResCollections(preflight.document); }
  catch (readError) { return { status: "indeterminate", message: "Rollback collection state is indeterminate." }; }
  if (typeof createdName !== "string" || createdName.length === 0) {
    // The add itself failed, so nothing of ours exists; the baseline is the proof.
    if (!styleResSame(current, preflight.before)) {
      return { status: "indeterminate", message: "Rollback cannot prove which style was created." };
    }
    state.operationState.rollbackEvidence.restoredSnapshot = current;
    return { status: "verified" };
  }
  var resolved;
  try { resolved = textStyleResolveNamed(preflight.document, "character", createdName); }
  catch (resolveError) { return { status: "indeterminate", message: "Rollback resource identity is indeterminate." }; }
  if (resolved.status === "missing") {
    if (!styleResSame(current, preflight.before)) {
      return { status: "indeterminate", message: "Rollback refused because the collections no longer match the baseline." };
    }
    state.operationState.rollbackEvidence.restoredSnapshot = current;
    return { status: "verified" };
  }
  if (resolved.status !== "resolved") {
    return { status: "indeterminate", message: "Rollback refused because the created name is ambiguous." };
  }
  state.operationState.rollbackEvidence.createdResource = { collectionKind: "characterStyles",
    collectionIndex: resolved.entry.index, name: createdName, resourceType: "named_character_style",
    entry: resolved.entry, afterSnapshot: current };
  var expected = [];
  for (var index = 0; index < preflight.before.characterStyles.length; index++) {
    expected.push(preflight.before.characterStyles[index]);
  }
  expected.splice(resolved.entry.index, 0, createdName);
  if (stringifyJson(current.characterStyles) !== stringifyJson(expected) ||
      stringifyJson(current.paragraphStyles) !== stringifyJson(preflight.before.paragraphStyles)) {
    return { status: "indeterminate", message: "Rollback refused because the collections are neither the baseline nor the created state." };
  }
  try { resolved.style.remove(); }
  catch (removeError) { return { status: "indeterminate", message: "Rollback removal is indeterminate." }; }
  var restored;
  try { restored = styleResCollections(preflight.document); }
  catch (verifyError) { return { status: "indeterminate", message: "Rollback verification is indeterminate." }; }
  state.operationState.rollbackEvidence.restoredSnapshot = restored;
  return styleResSame(restored, preflight.before)
    ? { status: "verified" }
    : { status: "failed", message: "Rollback did not restore the exact before style collections." };
}

var styleResExecution = runMutationTransaction({
  apply: params.apply === true,
  // the items this change reads and writes, so an edit session can advance its item aggregate.
  editSessionAffected: function () { return []; },
  initialOperationState: function () {
    return { mutationStarted: false, createdName: null,
      rollbackEvidence: { createdResource: null, restoredSnapshot: null } };
  },
  preflight: styleResResolve,
  plan: styleResPlan,
  revalidate: styleResRevalidate,
  applyMutation: styleResApply,
  verify: styleResVerify,
  rollback: styleResRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () {
    return { reasonCode: "resource_state_unknown",
      message: "Character-style creation outcome is indeterminate.",
      evidence: { createdResource: null, restoredSnapshot: null } };
  },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var styleResDocument = styleResExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === styleResExecution.preflight.document) {
  styleResDocument = getDocumentContext();
}
var result = { operation: "create_character_style",
  applied: styleResExecution.transaction.state === "verified",
  document: styleResDocument, plan: styleResExecution.plan, transaction: styleResExecution.transaction };
if (styleResExecution.transaction.state === "verified") result.resource = styleResExecution.value;
`;
export const CREATE_CHARACTER_STYLE_HOST_SCRIPT_DIGEST = canonicalSha256(CREATE_CHARACTER_STYLE_SCRIPT);
export const CREATE_CHARACTER_STYLE_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: CREATE_CHARACTER_STYLE_OPERATION,
    validator: CREATE_CHARACTER_STYLE_VALIDATOR, canonicalContractVersion: CANONICAL_VERSION,
    resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: CREATE_CHARACTER_STYLE_SAFETY_IDENTITY,
    hostScriptDigest: CREATE_CHARACTER_STYLE_HOST_SCRIPT_DIGEST,
    mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    assertRequestsAnAttribute(request.attributes);
    const digestRequest = 'commandId' in request
        ? (({ commandId: _commandId, ...rest }) => rest)(request)
        : request;
    const digest = canonicalSha256({ operation: CREATE_CHARACTER_STYLE_OPERATION,
        validator: CREATE_CHARACTER_STYLE_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request,
        commandId: 'commandId' in request ? request.commandId : null,
        documentKey: request.expectedDocumentKey, digest };
}
export const createCharacterStyleToolContract = {
    name: 'illustrator_create_character_style',
    title: 'Plan or Create a Named Character Style',
    description: 'Plan or create one named character style in the bound document, defining `size`, `tracking`, or both. '
        + 'Those are the only attributes measured as writable on a style resource; `font`, horizontal and vertical scale '
        + 'and fill are refused here and remain available through `illustrator_set_text_style`, which applies them '
        + 'directly to text. A name that already exists is refused rather than merged or renamed, and no existing style '
        + 'is ever modified or removed. Apply captures the complete ordered style collections before the add, '
        + 'revalidates them and the name absence in the same host call, verifies the created style plus the exact '
        + 'collection delta, and rolls back by removing only the style it created.',
    inputSchema,
    publicInputSchema: createCharacterStylePublicInputSchema,
    outputSchema: createCharacterStyleResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(CREATE_CHARACTER_STYLE_SAFETY.policy),
    normalizePublicInput,
};
export function createCharacterStyleAdapter() {
    return {
        version: 1, operation: CREATE_CHARACTER_STYLE_OPERATION, validator: CREATE_CHARACTER_STYLE_VALIDATOR,
        safety: CREATE_CHARACTER_STYLE_SAFETY, safetyRegistrationIdentity: CREATE_CHARACTER_STYLE_SAFETY_IDENTITY,
        adapterIdentity: CREATE_CHARACTER_STYLE_ADAPTER_IDENTITY, tool: createCharacterStyleToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest,
            safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: createCharacterStyleResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: CLASSIFIER_VERSION, safetyConformanceVersion: CONFORMANCE_VERSION,
        errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: CREATE_CHARACTER_STYLE_HOST_SCRIPT_DIGEST,
        mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: CREATE_CHARACTER_STYLE_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: CREATE_CHARACTER_STYLE_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: CREATE_CHARACTER_STYLE_OPERATION,
                    documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: CREATE_CHARACTER_STYLE_ADAPTER_IDENTITY,
                mutationHostApplicationMode: 'foreground', script: CREATE_CHARACTER_STYLE_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = createCharacterStyleResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back' ||
                state === 'rollback_failed')
                return { state };
            if (state === 'planned')
                throw new Error('A character-style creation plan is not a terminal mutation result.');
            throw new Error('Unverified character-style creation must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error, detail) {
            if (detail?.code === 'CREATE_CHARACTER_STYLE_BLOCKED') {
                return new Error(`Creating the character style is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}.`);
            }
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
