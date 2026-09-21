import { canonicalDigest, operationSafetyRegistrationSchema, bindOperationSafetyPlan, operationSafetyResultSchema, assertOperationSafetyAdapterConformance } from '../../operation-safety-policy-core.js';
export const CREATE_RECTANGLE_OPERATION_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: 'create_rectangle',
    policy: {
        version: 1,
        class: 'create',
        destructive: false,
        evidence: { identity: 'native_uuid', ownership: 'self_created_only', postcondition: 'created_state_matches_plan' },
        preconditions: { documentBinding: 'explicit_document_key', targetValidation: 'same_execution_before_apply' },
        confirmation: 'risk_scoped',
        recovery: { mode: 'remove_self_created_uuid', verification: 'native_uuid_absent', unknownIdentity: 'indeterminate' },
        terminal: { success: 'verified', failure: 'proven_pre_apply_or_verified_recovery', partialSuccess: 'nonterminal_until_reconciled' },
        replay: { requestBinding: 'canonical_request_digest', retry: 'return_attested_terminal_result', beforeTerminal: 'reconcile_required', reapplyOnRetry: false },
    },
    capabilities: {
        class: 'create',
        explicitDocumentBinding: true,
        validateTargetsBeforeApply: true,
        captureNativeUuid: true,
        verifyCreatedState: true,
        rollbackSelfCreatedUuidOnly: true,
        verifyRollbackAbsence: true,
        reconcileIndeterminate: true,
        durableTerminalReplay: true,
        trustedTerminalAttestationResolver: true,
    },
});
export const CREATE_RECTANGLE_OPERATION_SAFETY_IDENTITY = canonicalDigest(CREATE_RECTANGLE_OPERATION_SAFETY);
function rectangleConfirmationPolicyStatus(status) {
    return status === 'assumed' ? 'not_required' : status;
}
export function rectangleSafetyPlan(result, canonicalRequestDigest) {
    const confirmationStatus = rectangleConfirmationPolicyStatus(result.plan.templateRisk.confirmationStatus);
    return bindOperationSafetyPlan({
        policyVersion: 1,
        operationClass: 'create',
        operationId: 'create_rectangle',
        canonicalRequestDigest,
        evidence: {
            documentKey: result.plan.documentKey,
            targetLocator: `layer:${result.plan.targetLayer.path.join('.')};artboard:${result.plan.artboardIndex}`,
        },
        preconditions: {
            status: result.plan.applyBlockedReasonCodes.length === 0 ? 'satisfied' : 'blocked',
            targetsValidated: result.plan.layerSafetyReasonCodes.length === 0,
        },
        confirmation: { kind: 'risk_scoped', status: confirmationStatus },
        applyAllowed: result.plan.applyAllowed,
    });
}
export function rectangleSafetyResult(result, canonicalRequestDigest, attestation) {
    const transaction = result.transaction;
    if (transaction.state === 'planned')
        throw new Error('A planned rectangle has no terminal operation safety result.');
    const plan = rectangleSafetyPlan(result, canonicalRequestDigest);
    if (result.applied && transaction.state === 'verified') {
        const evidence = {
            nativeUuid: result.item.uuid,
            ownership: 'self_created_only',
            postconditionVerified: true,
            outstandingEffect: null,
        };
        return operationSafetyResultSchema.parse({
            policyVersion: 1,
            operationClass: 'create',
            operationId: 'create_rectangle',
            canonicalRequestDigest,
            planDigest: plan.planDigest,
            attestation,
            evidence,
            executionEvidence: { outcome: 'completed' },
            resolution: {
                status: 'succeeded', terminal: true, recovery: 'not_required',
                proof: { kind: 'verified_postcondition' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false },
            },
        });
    }
    const nativeUuid = transaction.state === 'rolled_back' || transaction.state === 'rollback_failed'
        ? transaction.rollback.itemUuid
        : null;
    const status = transaction.state === 'rolled_back'
        ? 'recovered'
        : transaction.state === 'rollback_failed' ? 'recovery_failed' : 'failed';
    const recovery = transaction.state === 'rolled_back'
        ? 'verified'
        : transaction.state === 'rollback_failed' ? 'failed' : 'not_required';
    const evidence = {
        nativeUuid,
        ownership: 'self_created_only',
        postconditionVerified: false,
        outstandingEffect: status === 'recovery_failed' && nativeUuid !== null
            ? { kind: 'native_uuid_still_present', nativeUuid }
            : null,
    };
    const proof = status === 'recovered'
        ? { kind: 'verified_recovery' }
        : status === 'recovery_failed'
            ? { kind: 'verified_outstanding_effect' }
            : {
                kind: 'proven_pre_apply',
                mutationAttempted: false,
            };
    return operationSafetyResultSchema.parse({
        policyVersion: 1,
        operationClass: 'create',
        operationId: 'create_rectangle',
        canonicalRequestDigest,
        planDigest: plan.planDigest,
        attestation,
        evidence,
        executionEvidence: {
            outcome: status === 'recovery_failed' ? 'recovery_failed' : status === 'failed' ? 'proven_pre_apply' : 'completed',
        },
        resolution: {
            status,
            terminal: true,
            recovery,
            ...(status === 'recovery_failed' ? { outstandingEffect: 'known_effect_present' } : {}),
            proof,
            replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false },
        },
    });
}
export async function assertRectangleSafetyConformance(result, canonicalRequestDigest, attestation, resolver) {
    const plan = rectangleSafetyPlan(result, canonicalRequestDigest);
    if (result.transaction.state !== 'planned') {
        if (attestation === null)
            throw new Error('Rectangle terminal result requires a durable attestation reference.');
        if (resolver === null)
            throw new Error('Rectangle terminal result requires a trusted attestation resolver.');
        await assertOperationSafetyAdapterConformance({
            registration: CREATE_RECTANGLE_OPERATION_SAFETY,
            plan,
            result: rectangleSafetyResult(result, canonicalRequestDigest, attestation),
        }, resolver);
    }
}
