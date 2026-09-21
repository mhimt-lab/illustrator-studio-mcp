import { z } from 'zod';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
export const LAYER_OPS_MAX_SIBLINGS = 256;
export const LAYER_OPS_MAX_DEPTH = 64;
export const LAYER_NAME_MAX_LENGTH = 255;
const LAYER_NAME_CONTROL = /[\u0000-\u001F\u007F]/u;
export function isValidLayerName(name) {
    return typeof name === 'string' && name.length >= 1 && name.length <= LAYER_NAME_MAX_LENGTH && name === name.trim() && !LAYER_NAME_CONTROL.test(name);
}
export const layerNameSchema = z.string().min(1).max(LAYER_NAME_MAX_LENGTH).superRefine((name, context) => {
    if (!isValidLayerName(name))
        context.addIssue({ code: 'custom', message: 'A layer name must not be empty, padded with whitespace, or contain control characters.' });
});
export const layerDocumentKeySchema = z.string().min(1).max(16_384);
export const layerPathSchema = z.array(z.number().int().nonnegative()).min(1).max(LAYER_OPS_MAX_DEPTH);
export const containerPathSchema = z.array(z.number().int().nonnegative()).max(LAYER_OPS_MAX_DEPTH);
export const siblingEntrySchema = z.strictObject({
    name: z.string().max(1024),
    visible: z.boolean(),
    locked: z.boolean(),
    printable: z.boolean(),
    childLayerCount: z.number().int().nonnegative(),
    pageItemCount: z.number().int().nonnegative(),
});
export const siblingOrderSchema = z.array(siblingEntrySchema).max(LAYER_OPS_MAX_SIBLINGS);
const targetCommon = {
    visible: z.boolean(),
    locked: z.boolean(),
    printable: z.boolean(),
    childLayerCount: z.number().int().nonnegative(),
    ancestorVisible: z.boolean(),
    ancestorLocked: z.boolean(),
};
export const layerTargetSchema = z.strictObject({ path: layerPathSchema, name: z.string().max(1024), pageItemCount: z.number().int().nonnegative(), ...targetCommon });
export const containerTargetSchema = z.strictObject({ path: containerPathSchema, name: z.string().max(1024).nullable(), pageItemCount: z.number().int().nonnegative().nullable(), ...targetCommon })
    .superRefine((container, context) => {
    if ((container.path.length === 0) !== (container.name === null) || (container.path.length === 0) !== (container.pageItemCount === null)) {
        context.addIssue({ code: 'custom', message: 'The document root container has a null name and page item count; a layer container has both.' });
    }
});
export function sameCanonical(left, right) {
    return canonicalSha256(left) === canonicalSha256(right);
}
export function entryOf(target) {
    return { name: target.name ?? '', visible: target.visible, locked: target.locked, printable: target.printable, childLayerCount: target.childLayerCount, pageItemCount: target.pageItemCount ?? 0 };
}
export function layerIdentityToken(target, siblingOrder) {
    return `layer:${canonicalDigest({ path: target.path, name: target.name, siblingNames: siblingOrder.map((entry) => entry.name), childLayerCount: target.childLayerCount, pageItemCount: target.pageItemCount })}`;
}
export function insertSibling(order, index, entry) {
    if (!Number.isInteger(index) || index < 0 || index > order.length)
        throw new Error('Layer insertion index is out of range.');
    return [...order.slice(0, index), entry, ...order.slice(index)];
}
export function reorderSibling(order, fromIndex, toIndex) {
    if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= order.length)
        throw new Error('Layer source index is out of range.');
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= order.length)
        throw new Error('Layer destination index is out of range.');
    const entry = order[fromIndex];
    const rest = order.filter((_entry, index) => index !== fromIndex);
    return [...rest.slice(0, toIndex), entry, ...rest.slice(toIndex)];
}
export function replaceSibling(order, index, entry) {
    if (!Number.isInteger(index) || index < 0 || index >= order.length)
        throw new Error('Layer index is out of range.');
    return order.map((current, position) => (position === index ? entry : current));
}
export const NEW_LAYER_DEFAULTS = Object.freeze({ visible: true, locked: false, printable: true, childLayerCount: 0, pageItemCount: 0 });
export const layerBlockerSchema = z.enum(['document_mutation_not_allowed', 'layer_hidden', 'layer_locked', 'ancestor_hidden', 'ancestor_locked']);
export function layerBlockers(mutationAllowed, target, options) {
    const blockers = [];
    if (!mutationAllowed)
        blockers.push('document_mutation_not_allowed');
    if (options.targetIsAncestor) {
        if (!target.visible || !target.ancestorVisible)
            blockers.push('ancestor_hidden');
        if (target.locked || target.ancestorLocked)
            blockers.push('ancestor_locked');
        return blockers;
    }
    if (options.targetStateBlocks && !target.visible)
        blockers.push('layer_hidden');
    if (options.targetStateBlocks && target.locked)
        blockers.push('layer_locked');
    if (!target.ancestorVisible)
        blockers.push('ancestor_hidden');
    if (target.ancestorLocked)
        blockers.push('ancestor_locked');
    return blockers;
}
const failureSchema = z.strictObject({ phase: z.enum(['apply', 'verify']), reasonCode: z.enum(['apply_failed', 'verify_mismatch']), message: z.string().min(1).max(500) })
    .superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed'))
        context.addIssue({ code: 'custom', message: 'Layer failure phase and reason code must match.' });
});
const indeterminateFailureSchema = z.strictObject({ phase: z.literal('apply'), reasonCode: z.literal('apply_indeterminate'), message: z.string().min(1).max(500) });
export function layerTransactionSchema(label, rollbackEvidence, nullEvidence, verifiedRequires) {
    return z.discriminatedUnion('state', [
        z.strictObject({ state: z.literal('planned'), audit: mutationAuditSchema }),
        z.strictObject({ state: z.literal('verified'), audit: mutationAuditSchema }),
        z.strictObject({ state: z.literal('apply_failed'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('not_required') }), audit: mutationAuditSchema }),
        z.strictObject({ state: z.literal('rolled_back'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('verified'), ...rollbackEvidence }), audit: mutationAuditSchema }),
        z.strictObject({ state: z.literal('rollback_failed'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('failed'), reasonCode: z.literal('rollback_failed'), message: z.string().min(1).max(500), ...rollbackEvidence }), audit: mutationAuditSchema }),
        z.strictObject({ state: z.literal('apply_indeterminate'), failure: indeterminateFailureSchema, rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('layer_state_unknown'), message: z.string().min(1).max(500), ...rollbackEvidence }), audit: mutationAuditSchema })
            .superRefine((transaction, context) => {
            if (!sameCanonical(Object.fromEntries(Object.keys(rollbackEvidence).map((key) => [key, transaction.rollback[key]])), nullEvidence)) {
                context.addIssue({ code: 'custom', message: `${label}: an indeterminate apply carries no rollback evidence.` });
            }
        }),
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
            context.addIssue({ code: 'custom', message: `${label}: audit sequence does not match the transaction state.` });
        transaction.audit.forEach((event, index) => { if (event.sequence !== index)
            context.addIssue({ code: 'custom', message: `${label}: audit sequence must be contiguous.` }); });
        if ('failure' in transaction) {
            const matches = transaction.audit.filter((event) => event.event === 'failed' && event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode && event.message === transaction.failure.message);
            if (matches.length !== 1)
                context.addIssue({ code: 'custom', message: `${label}: failure must match one audit event.` });
        }
        if (transaction.state === 'rolled_back' && !verifiedRequires(transaction.rollback)) {
            context.addIssue({ code: 'custom', message: `${label}: a rolled-back change must carry complete restored evidence.` });
        }
        if (transaction.state === 'rollback_failed' || transaction.state === 'rollback_indeterminate' || transaction.state === 'apply_indeterminate') {
            const rollbackEvent = transaction.audit.find((event) => event.event === 'failed' && event.phase === (transaction.state === 'apply_indeterminate' ? 'apply' : 'rollback'));
            const summary = transaction.rollback.message;
            if (rollbackEvent === undefined || !('message' in rollbackEvent) || rollbackEvent.message !== summary) {
                context.addIssue({ code: 'custom', message: `${label}: rollback summary must match its audit event.` });
            }
        }
    });
}
export function layerSafetyRegistration(operationId) {
    return operationSafetyRegistrationSchema.parse({
        operationId,
        policy: {
            version: 1, class: 'update_existing', destructive: false,
            evidence: { identity: 'target_layer_identity', beforeState: 'before_state_hash', postcondition: 'updated_state_matches_plan' },
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
}
export function layerSafetyPlan(view, requestDigest, admissionDocumentKey = view.documentKey) {
    const beforeStateHash = canonicalDigest(view.beforeState);
    const afterStateHash = canonicalDigest(view.afterState);
    const changeSetHash = canonicalDigest({ changeSet: view.changeSet, beforeStateHash, afterStateHash });
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'update_existing', operationId: view.operationId, canonicalRequestDigest: requestDigest,
        evidence: { documentKey: admissionDocumentKey, targetLayerIdentity: view.identityToken, beforeStateHash, plannedAfterStateHash: afterStateHash, plannedChangeSetDigest: changeSetHash },
        preconditions: { status: view.blocked ? 'blocked' : 'satisfied', compareAndSetMatched: !view.blocked },
        confirmation: { kind: 'exact_change_set', canonicalRequestDigest: requestDigest, changeSetHash, status: view.confirmationStatus },
        applyAllowed: view.applyAllowed,
    });
}
export function layerSafetyResult(view, requestDigest, attestation, plan) {
    const state = view.transactionState;
    if (state === 'planned' || state === 'apply_indeterminate' || state === 'rollback_indeterminate' || state === 'rollback_failed') {
        throw new Error('Indeterminate or failed layer recovery cannot be terminal.');
    }
    const common = { policyVersion: 1, operationClass: 'update_existing', operationId: view.operationId, canonicalRequestDigest: requestDigest, planDigest: plan.planDigest, attestation };
    const boundPlan = plan;
    const beforeStateHash = boundPlan.evidence.beforeStateHash;
    const evidence = { targetLayerIdentity: view.identityToken };
    if (state === 'verified' && view.applied) {
        return operationSafetyResultSchema.parse({ ...common, evidence: { ...evidence, beforeStateHash, afterStateHash: boundPlan.evidence.plannedAfterStateHash, restoredStateHash: null, restoredBeforeStateVerified: false },
            executionEvidence: { outcome: 'completed' }, resolution: { status: 'succeeded', terminal: true, recovery: 'not_required', proof: { kind: 'verified_postcondition' }, replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    if (state === 'rolled_back') {
        return operationSafetyResultSchema.parse({ ...common, evidence: { ...evidence, beforeStateHash, afterStateHash: null, restoredStateHash: beforeStateHash, restoredBeforeStateVerified: true },
            executionEvidence: { outcome: 'completed' }, resolution: { status: 'recovered', terminal: true, recovery: 'verified', proof: { kind: 'verified_recovery' }, replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    return operationSafetyResultSchema.parse({ ...common, evidence: { ...evidence, beforeStateHash, afterStateHash: null, restoredStateHash: null, restoredBeforeStateVerified: false },
        executionEvidence: { outcome: 'proven_pre_apply' }, resolution: { status: 'failed', terminal: true, recovery: 'not_required', proof: { kind: 'proven_pre_apply', mutationAttempted: false }, replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
}
export function layerSafetyAsserter(registration, view) {
    return async (value, requestDigest, attestation, resolver) => {
        const current = view(value);
        const plan = layerSafetyPlan(current, requestDigest, attestation?.documentKey);
        if (current.transactionState === 'planned')
            return;
        if (attestation === null || resolver === null)
            throw new Error('Layer terminal result requires attestation.');
        await assertOperationSafetyAdapterConformance({ registration, plan, result: layerSafetyResult(current, requestDigest, attestation, plan) }, resolver);
    };
}
export function classifyLayerTerminal(state, label) {
    if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back')
        return { state };
    if (state === 'planned')
        throw new Error(`${label} plan is not a terminal mutation result.`);
    throw new Error(`Unverified ${label} recovery must remain indeterminate and retain its lock.`);
}
