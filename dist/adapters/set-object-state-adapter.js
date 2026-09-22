import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { boundsSchema, documentContextSchema, layerPathSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { SUPPORTED_PATH_ITEM_HOST_SCRIPT } from './supported-path-item-host-script.js';
export const SET_OBJECT_STATE_OPERATION = 'set_object_state';
export const SET_OBJECT_STATE_VALIDATOR = { kind: SET_OBJECT_STATE_OPERATION, version: 1 };
export const OBJECT_STATE_TARGET_TYPES = ['PathItem', 'GroupItem', 'TextFrame', 'PlacedItem', 'CompoundPathItem'];
export const OBJECT_STATE_PROPERTIES = ['locked', 'hidden', 'name', 'note', 'opacity', 'blendingMode'];
export const OBJECT_STATE_NAME_MAX = 1024;
export const OBJECT_STATE_NOTE_MAX = 4096;
export const OBJECT_STATE_OPACITY_TOLERANCE = 0.01;
export const OBJECT_STATE_MAX_ANCESTORS = 32;
export const BLEND_MODE_NAMES = {
    normal: 'BlendModes.NORMAL', multiply: 'BlendModes.MULTIPLY', screen: 'BlendModes.SCREEN', overlay: 'BlendModes.OVERLAY',
    soft_light: 'BlendModes.SOFTLIGHT', hard_light: 'BlendModes.HARDLIGHT', color_dodge: 'BlendModes.COLORDODGE', color_burn: 'BlendModes.COLORBURN',
    darken: 'BlendModes.DARKEN', lighten: 'BlendModes.LIGHTEN', difference: 'BlendModes.DIFFERENCE', exclusion: 'BlendModes.EXCLUSION',
    hue: 'BlendModes.HUE', saturation: 'BlendModes.SATURATIONBLEND', color: 'BlendModes.COLORBLEND', luminosity: 'BlendModes.LUMINOSITY',
};
export const BLEND_MODE_ENUMS = Object.values(BLEND_MODE_NAMES);
const CANONICAL_VERSION = 1;
const RESULT_SCHEMA_VERSION = 1;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
const uuidSchema = z.string().min(1).max(255);
const documentKeySchema = z.string().min(1).max(16_384);
const targetTypeSchema = z.enum(OBJECT_STATE_TARGET_TYPES);
const blendModeEnumSchema = z.enum(BLEND_MODE_ENUMS);
const opacitySchema = z.number().finite().min(0).max(100);
const nameSchema = z.string().max(OBJECT_STATE_NAME_MAX);
const noteSchema = z.string().max(OBJECT_STATE_NOTE_MAX);
export const objectStateSnapshotSchema = z.strictObject({
    uuid: uuidSchema,
    type: targetTypeSchema,
    name: nameSchema,
    hidden: z.boolean(),
    locked: z.boolean(),
    editable: z.boolean(),
    opacity: opacitySchema,
    blendingMode: blendModeEnumSchema,
    note: noteSchema,
    layerPath: layerPathSchema,
    layerVisible: z.boolean(),
    layerLocked: z.boolean(),
    effectiveLayerVisible: z.boolean(),
    effectiveLayerLocked: z.boolean(),
    parentType: z.enum(['Layer', 'GroupItem', 'CompoundPathItem']),
    ancestorGroupLocked: z.boolean(),
    ancestorGroupHidden: z.boolean(),
    geometricBounds: boundsSchema,
});
const requestedStateSchema = z.strictObject({
    name: nameSchema.optional(),
    hidden: z.boolean().optional(),
    locked: z.boolean().optional(),
    opacity: opacitySchema.optional(),
    blendingMode: blendModeEnumSchema.optional(),
    note: noteSchema.optional(),
}).superRefine((value, context) => {
    if (OBJECT_STATE_PROPERTIES.every((property) => value[property] === undefined)) {
        context.addIssue({ code: 'custom', message: 'after must request at least one property.' });
    }
});
const publicRequestedStateSchema = z.strictObject({
    name: nameSchema.optional().describe(`Object name (at most ${OBJECT_STATE_NAME_MAX} characters; "" clears it).`),
    hidden: z.boolean().optional(),
    locked: z.boolean().optional(),
    opacity: opacitySchema.optional().describe('Opacity in percent, 0-100.'),
    blending_mode: z.enum(Object.keys(BLEND_MODE_NAMES)).optional(),
    note: noteSchema.optional().describe(`Caller-supplied note text (at most ${OBJECT_STATE_NOTE_MAX} characters; "" clears it). Never used for server metadata.`),
}).superRefine((value, context) => {
    if (value.name === undefined && value.hidden === undefined && value.locked === undefined && value.opacity === undefined &&
        value.blending_mode === undefined && value.note === undefined) {
        context.addIssue({ code: 'custom', message: 'after must request at least one property.' });
    }
});
function sameCanonical(left, right) {
    return canonicalSha256(left) === canonicalSha256(right);
}
function sameNumber(left, right, tolerance) {
    return Math.abs(left - right) <= tolerance;
}
export function sameObjectState(left, right) {
    const { opacity: leftOpacity, geometricBounds: leftBounds, ...leftRest } = left;
    const { opacity: rightOpacity, geometricBounds: rightBounds, ...rightRest } = right;
    return sameCanonical(leftRest, rightRest) && sameNumber(leftOpacity, rightOpacity, OBJECT_STATE_OPACITY_TOLERANCE) &&
        leftBounds.every((value, index) => sameNumber(value, rightBounds[index], OBJECT_STATE_OPACITY_TOLERANCE));
}
function sameProperty(property, left, right) {
    if (property === 'opacity')
        return typeof left === 'number' && typeof right === 'number' && sameNumber(left, right, OBJECT_STATE_OPACITY_TOLERANCE);
    return left === right;
}
function deriveEditable(snapshot) {
    return !snapshot.locked && !snapshot.hidden && !snapshot.ancestorGroupLocked && !snapshot.ancestorGroupHidden && snapshot.effectiveLayerVisible && !snapshot.effectiveLayerLocked;
}
export function deriveObjectState(before, requested) {
    const after = { ...before };
    const changes = [];
    for (const property of OBJECT_STATE_PROPERTIES) {
        const value = requested[property];
        if (value === undefined || sameProperty(property, before[property], value))
            continue;
        after[property] = value;
        changes.push({ property, before: before[property], after: value });
    }
    after.editable = deriveEditable(after);
    return { after, changes };
}
const commonInternal = { expectedDocumentKey: documentKeySchema, targetUuid: uuidSchema, targetType: targetTypeSchema, after: requestedStateSchema };
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({ ...commonInternal, expectedBefore: objectStateSnapshotSchema, apply: z.literal(true), commandId: canonicalCommandIdSchema }),
]);
const commonPublic = {
    expected_document_key: documentKeySchema,
    target_uuid: uuidSchema.describe('Native PageItem.uuid of the target.'),
    target_type: targetTypeSchema.describe('Declared typename of the target; the target is resolved in that typed collection only.'),
    after: publicRequestedStateSchema,
};
export const setObjectStatePublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({ ...commonPublic, expected_before: objectStateSnapshotSchema, apply: z.literal(true), command_id: applyCommandIdSchema }),
]);
const inputSchema = z.strictObject({ ...commonPublic, expected_before: objectStateSnapshotSchema.optional(), apply: z.boolean().default(false), command_id: applyCommandIdSchema.optional() });
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(setObjectStatePublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizeRequested(value) {
    const after = {};
    if (value.locked !== undefined)
        after.locked = value.locked;
    if (value.hidden !== undefined)
        after.hidden = value.hidden;
    if (value.name !== undefined)
        after.name = value.name;
    if (value.note !== undefined)
        after.note = value.note;
    if (value.opacity !== undefined)
        after.opacity = value.opacity;
    if (value.blending_mode !== undefined)
        after.blendingMode = BLEND_MODE_NAMES[value.blending_mode];
    return after;
}
function normalizePublicInput(input) {
    const value = setObjectStatePublicInputSchema.parse(input);
    const common = { expectedDocumentKey: value.expected_document_key, targetUuid: value.target_uuid, targetType: value.target_type, after: normalizeRequested(value.after) };
    return value.apply ? { ...common, expectedBefore: value.expected_before, apply: true, commandId: value.command_id } : { ...common, apply: false };
}
const blockerSchema = z.enum(['document_mutation_not_allowed', 'target_locked', 'target_hidden', 'target_not_editable',
    'layer_hidden', 'ancestor_hidden', 'layer_locked', 'ancestor_locked', 'ancestor_group_locked', 'ancestor_group_hidden']);
export function objectStateBlockers(mutationAllowed, before, requested) {
    const blockers = [];
    const add = (blocker) => { if (!blockers.includes(blocker))
        blockers.push(blocker); };
    if (!mutationAllowed)
        add('document_mutation_not_allowed');
    if (before.locked && requested.locked !== false)
        add('target_locked');
    if (before.hidden && requested.hidden !== false)
        add('target_hidden');
    if (!before.layerVisible)
        add('layer_hidden');
    if (!before.effectiveLayerVisible && before.layerVisible)
        add('ancestor_hidden');
    if (before.layerLocked)
        add('layer_locked');
    if (before.effectiveLayerLocked && !before.layerLocked)
        add('ancestor_locked');
    if (before.ancestorGroupLocked)
        add('ancestor_group_locked');
    if (before.ancestorGroupHidden)
        add('ancestor_group_hidden');
    if (!before.editable && !before.locked && !before.hidden && !before.ancestorGroupLocked && !before.ancestorGroupHidden &&
        before.effectiveLayerVisible && !before.effectiveLayerLocked)
        add('target_not_editable');
    return blockers;
}
const changeSchema = z.strictObject({ property: z.enum(OBJECT_STATE_PROPERTIES), before: z.union([z.string(), z.number(), z.boolean()]), after: z.union([z.string(), z.number(), z.boolean()]) });
const propertyListSchema = z.array(z.enum(OBJECT_STATE_PROPERTIES)).max(OBJECT_STATE_PROPERTIES.length).superRefine((list, context) => {
    if (new Set(list).size !== list.length)
        context.addIssue({ code: 'custom', message: 'Property list must be unique.' });
});
const planSchema = z.strictObject({
    operation: z.literal(SET_OBJECT_STATE_OPERATION),
    documentKey: documentKeySchema,
    targetUuid: uuidSchema,
    targetType: targetTypeSchema,
    requested: requestedStateSchema,
    before: objectStateSnapshotSchema,
    after: objectStateSnapshotSchema,
    changes: z.array(changeSchema).max(OBJECT_STATE_PROPERTIES.length),
    noOp: z.boolean(),
    applyBlockedReasonCodes: z.array(blockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    if (plan.before.uuid !== plan.targetUuid || plan.before.type !== plan.targetType)
        context.addIssue({ code: 'custom', message: 'Object-state plan must bind the target UUID and type.' });
    const derived = deriveObjectState(plan.before, plan.requested);
    if (!sameCanonical(derived.after, plan.after) || !sameCanonical(derived.changes, plan.changes) || plan.noOp !== (plan.changes.length === 0)) {
        context.addIssue({ code: 'custom', message: 'Object-state plan after state and changes must be derived from the before state and the request.' });
    }
    if (plan.applyAllowed !== (plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0)) {
        context.addIssue({ code: 'custom', message: 'Object-state applyAllowed must require confirmation and no blockers.' });
    }
});
const failureSchema = z.strictObject({ phase: z.enum(['apply', 'verify']), reasonCode: z.enum(['apply_failed', 'verify_mismatch']), message: z.string().min(1).max(500) })
    .superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed'))
        context.addIssue({ code: 'custom', message: 'Object-state failure phase and reason code must match.' });
});
const indeterminateFailureSchema = z.strictObject({ phase: z.literal('apply'), reasonCode: z.literal('apply_indeterminate'), message: z.string().min(1).max(500) });
const rollbackEvidence = { restoredState: objectStateSnapshotSchema.nullable(), restoredProperties: propertyListSchema.nullable(), savedAfterRollback: z.boolean().nullable() };
const transactionSchema = z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('planned'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('verified'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('apply_failed'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('not_required') }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('rolled_back'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('verified'), ...rollbackEvidence }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('rollback_failed'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('failed'), reasonCode: z.literal('rollback_failed'), message: z.string().min(1).max(500), ...rollbackEvidence }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('apply_indeterminate'), failure: indeterminateFailureSchema, rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('object_state_unknown'), message: z.string().min(1).max(500), restoredState: z.null(), restoredProperties: z.null(), savedAfterRollback: z.null() }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('rollback_indeterminate'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('rollback_indeterminate'), message: z.string().min(1).max(500), ...rollbackEvidence }), audit: mutationAuditSchema }),
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
        expected = [...prefix, ...failure, 'rollback:started:', transaction.state === 'rolled_back' ? 'rollback:succeeded:' : `rollback:failed:${transaction.state === 'rollback_failed' ? 'rollback_failed' : 'rollback_indeterminate'}`];
    }
    const actual = transaction.audit.map((event) => `${event.phase}:${event.event}:${'reasonCode' in event ? event.reasonCode : ''}`);
    if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index]))
        context.addIssue({ code: 'custom', message: 'Object-state audit sequence does not match transaction state.' });
    transaction.audit.forEach((event, index) => { if (event.sequence !== index)
        context.addIssue({ code: 'custom', message: 'Object-state audit sequence must be contiguous.' }); });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' && event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode && event.message === transaction.failure.message);
        if (matches.length !== 1)
            context.addIssue({ code: 'custom', message: 'Object-state failure must match one audit event.' });
    }
    if (transaction.state === 'rolled_back' && (transaction.rollback.restoredState === null || transaction.rollback.restoredProperties === null || transaction.rollback.savedAfterRollback === null)) {
        context.addIssue({ code: 'custom', message: 'A rolled-back object-state change must carry the restored snapshot, property list, and saved flag.' });
    }
    if (transaction.state === 'rollback_failed' || transaction.state === 'rollback_indeterminate' || transaction.state === 'apply_indeterminate') {
        const rollbackEvent = transaction.audit.find((event) => event.event === 'failed' && event.phase === (transaction.state === 'apply_indeterminate' ? 'apply' : 'rollback'));
        if (rollbackEvent === undefined || !('message' in rollbackEvent) || rollbackEvent.message !== transaction.rollback.message) {
            context.addIssue({ code: 'custom', message: 'Object-state rollback summary must match its audit event.' });
        }
    }
    if (transaction.state === 'rollback_failed' && transaction.rollback.restoredState === null) {
        context.addIssue({ code: 'custom', message: 'A failed object-state rollback must report the snapshot it observed.' });
    }
});
const postconditionSchema = z.strictObject({ state: objectStateSnapshotSchema, writtenProperties: propertyListSchema, saved: z.boolean() });
export const setObjectStateResultSchema = z.union([
    z.strictObject({ operation: z.literal(SET_OBJECT_STATE_OPERATION), applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ operation: z.literal(SET_OBJECT_STATE_OPERATION), applied: z.literal(true), document: documentContextSchema, plan: planSchema, postcondition: postconditionSchema, transaction: transactionSchema }),
]).superRefine((result, context) => {
    if (result.transaction.state === 'planned') {
        if (result.plan.confirmationStatus !== 'required' || !sameCanonical(result.plan.applyBlockedReasonCodes, objectStateBlockers(result.document.mutationAllowed, result.plan.before, result.plan.requested))) {
            context.addIssue({ code: 'custom', message: 'Planned object-state change must expose exact blockers.' });
        }
    }
    else if (result.plan.confirmationStatus !== 'confirmed' || result.plan.applyBlockedReasonCodes.length !== 0 || !result.plan.applyAllowed || objectStateBlockers(true, result.plan.before, result.plan.requested).length !== 0) {
        context.addIssue({ code: 'custom', message: 'Applied object-state attempt must derive from an allowed confirmed plan.' });
    }
    if (result.applied) {
        const expectedWritten = result.plan.changes.map((change) => change.property);
        if (result.transaction.state !== 'verified' || !sameObjectState(result.postcondition.state, result.plan.after) || !sameCanonical(result.postcondition.writtenProperties, expectedWritten)) {
            context.addIssue({ code: 'custom', message: 'Verified object-state change must match the planned after state and the planned property list.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified object-state transaction must be applied.' });
    }
    if (result.transaction.state === 'rolled_back' && !sameObjectState(result.transaction.rollback.restoredState, result.plan.before)) {
        context.addIssue({ code: 'custom', message: 'Rolled-back object-state change must prove the exact before snapshot.' });
    }
});
export const setObjectStateResponseSchema = z.strictObject({
    outcome: setObjectStateResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
export const SET_OBJECT_STATE_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: SET_OBJECT_STATE_OPERATION,
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
export const SET_OBJECT_STATE_SAFETY_IDENTITY = canonicalDigest(SET_OBJECT_STATE_SAFETY);
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    const beforeStateHash = canonicalDigest(result.plan.before);
    const afterStateHash = canonicalDigest(result.plan.after);
    const changeSetHash = canonicalDigest({ targetUuid: result.plan.targetUuid, targetType: result.plan.targetType, changes: result.plan.changes, beforeStateHash, afterStateHash });
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'update_existing', operationId: SET_OBJECT_STATE_OPERATION, canonicalRequestDigest: requestDigest,
        evidence: { documentKey: admissionDocumentKey, targetUuid: result.plan.targetUuid, beforeStateHash, plannedAfterStateHash: afterStateHash, plannedChangeSetDigest: changeSetHash },
        preconditions: { status: result.plan.applyBlockedReasonCodes.length === 0 ? 'satisfied' : 'blocked', compareAndSetMatched: result.plan.applyBlockedReasonCodes.length === 0 },
        confirmation: { kind: 'exact_change_set', canonicalRequestDigest: requestDigest, changeSetHash, status: result.plan.confirmationStatus },
        applyAllowed: result.plan.applyAllowed,
    });
}
function safetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' || transaction.state === 'rollback_indeterminate' || transaction.state === 'rollback_failed') {
        throw new Error('Indeterminate or failed object-state recovery cannot be terminal.');
    }
    const common = { policyVersion: 1, operationClass: 'update_existing', operationId: SET_OBJECT_STATE_OPERATION, canonicalRequestDigest: requestDigest, planDigest: plan.planDigest, attestation };
    const boundPlan = plan;
    const beforeStateHash = boundPlan.evidence.beforeStateHash;
    const evidence = { targetUuid: result.plan.targetUuid };
    if (transaction.state === 'verified' && result.applied) {
        return operationSafetyResultSchema.parse({ ...common, evidence: { ...evidence, beforeStateHash, afterStateHash: boundPlan.evidence.plannedAfterStateHash, restoredStateHash: null, restoredBeforeStateVerified: false },
            executionEvidence: { outcome: 'completed' }, resolution: { status: 'succeeded', terminal: true, recovery: 'not_required', proof: { kind: 'verified_postcondition' }, replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    if (transaction.state === 'rolled_back') {
        return operationSafetyResultSchema.parse({ ...common, evidence: { ...evidence, beforeStateHash, afterStateHash: null, restoredStateHash: beforeStateHash, restoredBeforeStateVerified: true },
            executionEvidence: { outcome: 'completed' }, resolution: { status: 'recovered', terminal: true, recovery: 'verified', proof: { kind: 'verified_recovery' }, replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    return operationSafetyResultSchema.parse({ ...common, evidence: { ...evidence, beforeStateHash, afterStateHash: null, restoredStateHash: null, restoredBeforeStateVerified: false },
        executionEvidence: { outcome: 'proven_pre_apply' }, resolution: { status: 'failed', terminal: true, recovery: 'not_required', proof: { kind: 'proven_pre_apply', mutationAttempted: false }, replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
}
async function assertSafety(value, requestDigest, attestation, resolver) {
    const result = setObjectStateResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null)
        throw new Error('Object-state terminal result requires attestation.');
    await assertOperationSafetyAdapterConformance({ registration: SET_OBJECT_STATE_SAFETY, plan, result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
export const SET_OBJECT_STATE_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${SUPPORTED_PATH_ITEM_HOST_SCRIPT}
var OBJECT_STATE_PROPERTIES = ${JSON.stringify(OBJECT_STATE_PROPERTIES)};
var OBJECT_STATE_TARGET_TYPES = ${JSON.stringify(OBJECT_STATE_TARGET_TYPES)};
var OBJECT_STATE_BLEND_MODES = ${JSON.stringify(BLEND_MODE_ENUMS)};
var OBJECT_STATE_NAME_MAX = ${OBJECT_STATE_NAME_MAX};
var OBJECT_STATE_NOTE_MAX = ${OBJECT_STATE_NOTE_MAX};
var OBJECT_STATE_OPACITY_TOLERANCE = ${OBJECT_STATE_OPACITY_TOLERANCE};
var OBJECT_STATE_MAX_ANCESTORS = ${OBJECT_STATE_MAX_ANCESTORS};

function objectStateIndexOf(list, value) { for (var i = 0; i < list.length; i++) if (list[i] === value) return i; return -1; }
/** Typed native collection for the declared type (measured route; getPageItemFromUuid misreports the typename of PlacedItem / CompoundPathItem). */
function objectStateCollection(document, type) {
  if (type === "PathItem") return document.pathItems;
  if (type === "GroupItem") return document.groupItems;
  if (type === "TextFrame") return document.textFrames;
  if (type === "PlacedItem") return document.placedItems;
  if (type === "CompoundPathItem") return document.compoundPathItems;
  throw mutationError("preflight_failed", "Unsupported object-state target type.");
}
function objectStateFind(document, type, uuid) {
  var collection = objectStateCollection(document, type);
  if (!collection || typeof collection.length !== "number") throw mutationError("preflight_failed", "The document collection for the declared type is unavailable.");
  var found = null;
  var matches = 0;
  for (var index = 0; index < collection.length; index++) {
    var candidate = collection[index];
    if (String(candidate.uuid) === uuid) { matches++; if (found === null) found = candidate; }
  }
  if (matches > 1) throw mutationError("preflight_failed", "The declared collection holds more than one item with the target UUID.");
  if (found !== null && String(found.typename) !== type) throw mutationError("preflight_failed", "The resolved item does not report the declared type.");
  return found;
}
/** Only for the not-found error: report the typename the document-wide collection carries for that UUID, if any. */
function objectStateOtherTypename(document, uuid) {
  try {
    for (var index = 0; index < document.pageItems.length; index++) {
      var item = document.pageItems[index];
      if (String(item.uuid) === uuid) return String(item.typename);
    }
  } catch (_scanError) {}
  return null;
}
function objectStateAncestors(target) {
  var locked = false, hidden = false, depth = 0, parentType = null, node = target.parent;
  while (node !== null && node !== undefined && String(node.typename) !== "Layer") {
    var typename = String(node.typename);
    if (typename !== "GroupItem" && typename !== "CompoundPathItem") throw mutationError("preflight_failed", "Object-state target has an unsupported ancestor type.");
    if (parentType === null) parentType = typename;
    if (typeof node.locked !== "boolean" || typeof node.hidden !== "boolean") throw mutationError("preflight_failed", "Ancestor safety state is unavailable.");
    if (node.locked) locked = true;
    if (node.hidden) hidden = true;
    depth++;
    if (depth > OBJECT_STATE_MAX_ANCESTORS) throw mutationError("preflight_failed", "Object-state target is nested deeper than " + OBJECT_STATE_MAX_ANCESTORS + " ancestors.");
    node = node.parent;
  }
  if (node === null || node === undefined) throw mutationError("preflight_failed", "Object-state target layer is unavailable.");
  return { parentType: parentType === null ? "Layer" : parentType, locked: locked, hidden: hidden, layer: node };
}
function objectStateText(value, label, max) {
  if (typeof value !== "string") throw mutationError("preflight_failed", label + " is unavailable.");
  if (value.length > max) throw mutationError("preflight_failed", label + " exceeds " + max + " characters and is unsupported.");
  return value;
}
function objectStateSnapshot(document, target, type, uuid) {
  if (!target || String(target.typename) !== type) throw mutationError("preflight_failed", "Object-state target type changed.");
  if (typeof target.uuid !== "string" || target.uuid.length === 0 || target.uuid !== uuid) throw mutationError("preflight_failed", "Target native UUID is unavailable or changed.");
  var ancestors = objectStateAncestors(target);
  if (target.layer !== ancestors.layer) throw mutationError("preflight_failed", "Target layer identity is inconsistent.");
  var layerInfo = supportedPathLayerChain(document, target.layer);
  if (layerInfo === null) throw mutationError("preflight_failed", "Target layer path is unavailable.");
  var effectiveVisible = true, effectiveLocked = false;
  for (var layerIndex = 0; layerIndex < layerInfo.chain.length; layerIndex++) {
    var layer = layerInfo.chain[layerIndex];
    if (typeof layer.visible !== "boolean" || typeof layer.locked !== "boolean") throw mutationError("preflight_failed", "Layer safety state is unavailable.");
    if (!layer.visible) effectiveVisible = false;
    if (layer.locked) effectiveLocked = true;
  }
  if (typeof target.locked !== "boolean" || typeof target.hidden !== "boolean" || typeof target.editable !== "boolean") throw mutationError("preflight_failed", "Target safety state is unavailable.");
  var blendingMode = String(target.blendingMode);
  if (objectStateIndexOf(OBJECT_STATE_BLEND_MODES, blendingMode) < 0) throw mutationError("preflight_failed", "Target blending mode is unsupported.");
  var opacity = supportedPathNumber(target.opacity, "opacity");
  if (opacity < 0 || opacity > 100) throw mutationError("preflight_failed", "Target opacity is out of range.");
  return {
    uuid: target.uuid, type: type,
    name: objectStateText(target.name, "name", OBJECT_STATE_NAME_MAX),
    hidden: target.hidden, locked: target.locked, editable: target.editable,
    opacity: opacity, blendingMode: blendingMode,
    note: objectStateText(target.note, "note", OBJECT_STATE_NOTE_MAX),
    layerPath: layerInfo.path, layerVisible: target.layer.visible, layerLocked: target.layer.locked,
    effectiveLayerVisible: effectiveVisible, effectiveLayerLocked: effectiveLocked,
    parentType: ancestors.parentType, ancestorGroupLocked: ancestors.locked, ancestorGroupHidden: ancestors.hidden,
    geometricBounds: supportedPathBounds(target.geometricBounds, "geometricBounds")
  };
}
function objectStateSameProperty(property, left, right) {
  if (property === "opacity") return Math.abs(left - right) <= OBJECT_STATE_OPACITY_TOLERANCE;
  return left === right;
}
function objectStateSame(left, right) {
  for (var key in left) {
    if (!left.hasOwnProperty(key)) continue;
    if (!right.hasOwnProperty(key)) return false;
    if (key === "opacity") { if (!objectStateSameProperty("opacity", left[key], right[key])) return false; }
    else if (key === "geometricBounds" || key === "layerPath") { if (key === "layerPath" ? !mutationSameSequence(left[key], right[key]) : !objectStateSameBounds(left[key], right[key])) return false; }
    else if (left[key] !== right[key]) return false;
  }
  for (var rightKey in right) if (right.hasOwnProperty(rightKey) && !left.hasOwnProperty(rightKey)) return false;
  return true;
}
function objectStateSameBounds(left, right) {
  if (!left || !right || left.length !== 4 || right.length !== 4) return false;
  for (var i = 0; i < 4; i++) if (Math.abs(left[i] - right[i]) > OBJECT_STATE_OPACITY_TOLERANCE) return false;
  return true;
}
function objectStateDeriveEditable(snapshot) {
  return !snapshot.locked && !snapshot.hidden && !snapshot.ancestorGroupLocked && !snapshot.ancestorGroupHidden && snapshot.effectiveLayerVisible && !snapshot.effectiveLayerLocked;
}
/** Identical to the TypeScript derivation: only differing requested properties are changes, in the fixed write order. */
function objectStateDerive(before, requested) {
  var after = {};
  for (var key in before) if (before.hasOwnProperty(key)) after[key] = before[key];
  var changes = [];
  for (var p = 0; p < OBJECT_STATE_PROPERTIES.length; p++) {
    var property = OBJECT_STATE_PROPERTIES[p];
    if (!requested.hasOwnProperty(property) || requested[property] === undefined || objectStateSameProperty(property, before[property], requested[property])) continue;
    after[property] = requested[property];
    changes.push({ property: property, before: before[property], after: requested[property] });
  }
  after.editable = objectStateDeriveEditable(after);
  return { after: after, changes: changes };
}
function objectStateBlockers(context, before, requested) {
  var blockers = [];
  function add(code) { if (objectStateIndexOf(blockers, code) < 0) blockers.push(code); }
  if (!context.mutationAllowed) add("document_mutation_not_allowed");
  if (before.locked && requested.locked !== false) add("target_locked");
  if (before.hidden && requested.hidden !== false) add("target_hidden");
  if (!before.layerVisible) add("layer_hidden");
  if (!before.effectiveLayerVisible && before.layerVisible) add("ancestor_hidden");
  if (before.layerLocked) add("layer_locked");
  if (before.effectiveLayerLocked && !before.layerLocked) add("ancestor_locked");
  if (before.ancestorGroupLocked) add("ancestor_group_locked");
  if (before.ancestorGroupHidden) add("ancestor_group_hidden");
  if (!before.editable && !before.locked && !before.hidden && !before.ancestorGroupLocked && !before.ancestorGroupHidden &&
      before.effectiveLayerVisible && !before.effectiveLayerLocked) add("target_not_editable");
  return blockers;
}
function objectStateValidateRequested(requested) {
  if (!requested || typeof requested !== "object") throw mutationError("preflight_failed", "after is required.");
  var count = 0;
  for (var p = 0; p < OBJECT_STATE_PROPERTIES.length; p++) {
    var property = OBJECT_STATE_PROPERTIES[p];
    if (!requested.hasOwnProperty(property) || requested[property] === undefined) continue;
    var value = requested[property];
    count++;
    if ((property === "locked" || property === "hidden") && typeof value !== "boolean") throw mutationError("preflight_failed", property + " must be a boolean.");
    if (property === "name" && (typeof value !== "string" || value.length > OBJECT_STATE_NAME_MAX)) throw mutationError("preflight_failed", "name must be a string of at most " + OBJECT_STATE_NAME_MAX + " characters.");
    if (property === "note" && (typeof value !== "string" || value.length > OBJECT_STATE_NOTE_MAX)) throw mutationError("preflight_failed", "note must be a string of at most " + OBJECT_STATE_NOTE_MAX + " characters.");
    if (property === "opacity") { mutationFiniteNumber(value, "opacity"); if (value < 0 || value > 100) throw mutationError("preflight_failed", "opacity must be between 0 and 100."); }
    if (property === "blendingMode" && objectStateIndexOf(OBJECT_STATE_BLEND_MODES, value) < 0) throw mutationError("preflight_failed", "blendingMode is unsupported.");
  }
  if (count === 0) throw mutationError("preflight_failed", "after must request at least one property.");
}
function objectStateBlendEnum(value) {
  var name = value.substring("BlendModes.".length);
  var enumeration = BlendModes[name];
  if (enumeration === undefined || enumeration === null) throw mutationError("apply_failed", "Blending mode enumeration is unavailable on this host.");
  return enumeration;
}
function objectStateWrite(target, property, value) {
  if (property === "blendingMode") target.blendingMode = objectStateBlendEnum(value);
  else if (property === "opacity") target.opacity = value;
  else if (property === "name") target.name = value;
  else if (property === "note") target.note = value;
  else if (property === "hidden") target.hidden = value;
  else if (property === "locked") target.locked = value;
  else throw mutationError("apply_failed", "Unsupported object-state property.");
}

function objectStateResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  if (typeof params.targetUuid !== "string" || params.targetUuid.length === 0) throw mutationError("preflight_failed", "target_uuid is required.");
  if (objectStateIndexOf(OBJECT_STATE_TARGET_TYPES, params.targetType) < 0) throw mutationError("preflight_failed", "target_type is unsupported.");
  objectStateValidateRequested(params.after);
  var target = objectStateFind(document, params.targetType, params.targetUuid);
  if (target === null) {
    var other = objectStateOtherTypename(document, params.targetUuid);
    if (other !== null) throw new Error("MCP_ERROR:" + stringifyJson({ code: "OBJECT_TYPE_MISMATCH", uuid: params.targetUuid, expected: params.targetType, actual: other }));
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "OBJECT_NOT_FOUND", uuid: params.targetUuid }));
  }
  var before = objectStateSnapshot(document, target, params.targetType, params.targetUuid);
  var derived = objectStateDerive(before, params.after);
  var blockers = objectStateBlockers(context, before, params.after);
  if (forApply) {
    if (!params.expectedBefore || typeof params.expectedBefore !== "object" || !objectStateSame(before, params.expectedBefore)) {
      throw mutationError("preflight_failed", "Target state does not match expected_before.");
    }
    if (blockers.length > 0) throw new Error("MCP_ERROR:" + stringifyJson({ code: "OBJECT_STATE_APPLY_BLOCKED", reasonCodes: blockers, uuid: params.targetUuid }));
  }
  return { context: context, document: document, target: target, before: before, after: derived.after, changes: derived.changes, blockers: blockers };
}

function objectStatePlan(preflight) {
  return { operation: "set_object_state", documentKey: preflight.context.key, targetUuid: params.targetUuid, targetType: params.targetType,
    requested: params.after, before: preflight.before, after: preflight.after, changes: preflight.changes, noOp: preflight.changes.length === 0,
    applyBlockedReasonCodes: preflight.blockers, confirmationStatus: params.apply === true ? "confirmed" : "required",
    applyAllowed: params.apply === true && preflight.blockers.length === 0 };
}

function objectStateRevalidate(preflight, plan) {
  var current;
  try { current = objectStateResolve(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Object-state preconditions changed before apply.")); }
  if (current.document !== preflight.document || current.target !== preflight.target) throw mutationBeforeSideEffectError("Object-state target native identity changed before apply.");
  if (stringifyJson(current.before) !== stringifyJson(plan.before)) throw mutationBeforeSideEffectError("Object-state target changed before apply.");
}

function objectStateApply(preflight, plan, state) {
  state.operationState.mutationStarted = true;
  var target = preflight.target;
  for (var index = 0; index < plan.changes.length; index++) {
    var change = plan.changes[index];
    objectStateWrite(target, change.property, change.after);
    state.operationState.written.push(change.property);
  }
  return state.operationState.written.length;
}

function objectStateVerify(preflight, plan, state) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) throw mutationError("verify_mismatch", "Active document changed during object-state verification.");
  var target = objectStateFind(preflight.document, params.targetType, params.targetUuid);
  if (target === null || target !== preflight.target) throw mutationError("verify_mismatch", "Object-state target native identity does not match the plan.");
  var snapshot = objectStateSnapshot(preflight.document, target, params.targetType, params.targetUuid);
  if (!objectStateSame(snapshot, plan.after)) throw mutationError("verify_mismatch", "Object-state read-back does not match the planned after state.");
  return { state: snapshot, writtenProperties: state.operationState.written.slice(0), saved: preflight.document.saved === true };
}

/** Rewrites only the properties this command wrote, in reverse order, then proves the exact before snapshot. */
function objectStateRollback(state) {
  var preflight = state.preflight;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
  var target;
  try { target = objectStateFind(preflight.document, params.targetType, params.targetUuid); }
  catch (e) { return { status: "indeterminate", message: "Rollback target lookup is indeterminate." }; }
  if (target === null || target !== preflight.target) return { status: "indeterminate", message: "Rollback target identity changed." };
  var written = state.operationState.written;
  var restored = [];
  try {
    for (var index = written.length - 1; index >= 0; index--) {
      objectStateWrite(target, written[index], preflight.before[written[index]]);
      restored.push(written[index]);
    }
  } catch (writeError) {
    state.operationState.rollbackEvidence.restoredProperties = restored;
    return { status: "indeterminate", message: "Rollback write is indeterminate." };
  }
  var snapshot;
  try { snapshot = objectStateSnapshot(preflight.document, target, params.targetType, params.targetUuid); }
  catch (e) { state.operationState.rollbackEvidence.restoredProperties = restored; return { status: "indeterminate", message: "Rollback verification is indeterminate." }; }
  state.operationState.rollbackEvidence.restoredState = snapshot;
  state.operationState.rollbackEvidence.restoredProperties = restored;
  state.operationState.rollbackEvidence.savedAfterRollback = preflight.document.saved === true;
  if (!objectStateSame(snapshot, preflight.before)) return { status: "failed", message: "Rollback did not restore the exact before state." };
  return { status: "verified" };
}

var objectStateExecution = runMutationTransaction({
  apply: params.apply === true,
  // the items this change reads and writes, so an edit session can advance its item aggregate.
  editSessionAffected: function () { return [params.targetUuid]; },
  initialOperationState: function () { return { mutationStarted: false, written: [], rollbackEvidence: { restoredState: null, restoredProperties: null, savedAfterRollback: null } }; },
  preflight: objectStateResolve,
  plan: objectStatePlan,
  revalidate: objectStateRevalidate,
  applyMutation: objectStateApply,
  verify: objectStateVerify,
  rollback: objectStateRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () { return { reasonCode: "object_state_unknown", message: "Object-state apply outcome is indeterminate.", evidence: { restoredState: null, restoredProperties: null, savedAfterRollback: null } }; },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var objectStateDocument = objectStateExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === objectStateExecution.preflight.document) objectStateDocument = getDocumentContext();
var result = { operation: "set_object_state", applied: objectStateExecution.transaction.state === "verified", document: objectStateDocument, plan: objectStateExecution.plan, transaction: objectStateExecution.transaction };
if (objectStateExecution.transaction.state === "verified") result.postcondition = objectStateExecution.value;
`;
export const SET_OBJECT_STATE_HOST_SCRIPT_DIGEST = canonicalSha256(SET_OBJECT_STATE_SCRIPT);
export const SET_OBJECT_STATE_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: SET_OBJECT_STATE_OPERATION, validator: SET_OBJECT_STATE_VALIDATOR,
    canonicalContractVersion: CANONICAL_VERSION, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: SET_OBJECT_STATE_SAFETY_IDENTITY, hostScriptDigest: SET_OBJECT_STATE_HOST_SCRIPT_DIGEST,
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    const digestRequest = 'commandId' in request ? (({ commandId: _commandId, ...rest }) => rest)(request) : request;
    const digest = canonicalSha256({ operation: SET_OBJECT_STATE_OPERATION, validator: SET_OBJECT_STATE_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: 'commandId' in request ? request.commandId : null, documentKey: request.expectedDocumentKey, digest };
}
export const setObjectStateToolContract = {
    name: 'illustrator_set_object_state',
    title: 'Plan or Set Object State',
    description: `Plan or apply any subset of name, hidden, locked, opacity (0-100), blending_mode, and note on one PathItem, GroupItem, TextFrame, PlacedItem, or CompoundPathItem resolved by native UUID in its declared typed collection. The plan binds the full before state (identity, the six properties, editable, layer chain, ancestor-group lock/hidden state, bounds), lists only the properties that actually change, and exposes blockers: targets under a locked or hidden layer or group are refused; a locked target is accepted only when the request unlocks it and a hidden one only when it shows it. Apply performs compare-and-set on expected_before, writes the changed properties in a fixed order (locked, hidden, name, note, opacity, blending_mode) without touching no-op properties, verifies by native read-back, and on failure rewrites only the properties it wrote, in reverse order, and proves the before state. Document saved is reported as observed and is not restored by rollback. note is a caller-supplied string only.`,
    inputSchema,
    publicInputSchema: setObjectStatePublicInputSchema,
    outputSchema: setObjectStateResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(SET_OBJECT_STATE_SAFETY.policy),
    normalizePublicInput,
};
export function createSetObjectStateAdapter() {
    return {
        version: 1, operation: SET_OBJECT_STATE_OPERATION, validator: SET_OBJECT_STATE_VALIDATOR,
        safety: SET_OBJECT_STATE_SAFETY, safetyRegistrationIdentity: SET_OBJECT_STATE_SAFETY_IDENTITY,
        adapterIdentity: SET_OBJECT_STATE_ADAPTER_IDENTITY, tool: setObjectStateToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: setObjectStateResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
        safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: SET_OBJECT_STATE_HOST_SCRIPT_DIGEST,
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: SET_OBJECT_STATE_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: SET_OBJECT_STATE_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: SET_OBJECT_STATE_OPERATION, documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: SET_OBJECT_STATE_ADAPTER_IDENTITY, script: SET_OBJECT_STATE_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = setObjectStateResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back')
                return { state };
            if (state === 'planned')
                throw new Error('Object-state plan is not a terminal mutation result.');
            throw new Error('Unverified object-state recovery must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error, detail) {
            if (detail?.code === 'OBJECT_NOT_FOUND')
                return new Error(`No item with UUID ${JSON.stringify(detail.uuid ?? '')} exists in the declared typed collection of the bound document.`);
            if (detail?.code === 'OBJECT_TYPE_MISMATCH')
                return new Error(`The item with UUID ${JSON.stringify(detail.uuid ?? '')} is a ${detail.actual ?? 'different type'}, not the declared ${detail.expected ?? 'target_type'}.`);
            if (detail?.code === 'OBJECT_STATE_APPLY_BLOCKED')
                return new Error(`Object-state change is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}.`);
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
