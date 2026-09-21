import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../../operation-safety-policy-core.js';
export const CREATE_SWATCH_RESOURCE_OPERATION_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: 'create_swatch_resource',
    policy: {
        version: 3,
        class: 'create_resource',
        destructive: false,
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
            hostVersionGate: 'measured_application_version_allowlist_for_spot',
        },
        confirmation: 'risk_scoped',
        recovery: {
            mode: 'remove_captured_self_created_resource',
            verification: 'complete_ordered_resource_collections_match_before_digest',
            unknownIdentity: 'indeterminate',
        },
        terminal: {
            success: 'verified',
            failure: 'proven_pre_apply_or_verified_recovery',
            partialSuccess: 'nonterminal_until_reconciled',
        },
        replay: {
            requestBinding: 'canonical_request_digest',
            retry: 'return_attested_terminal_result',
            beforeTerminal: 'reconcile_required',
            reapplyOnRetry: false,
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
export const CREATE_SWATCH_RESOURCE_OPERATION_SAFETY_IDENTITY = canonicalDigest(CREATE_SWATCH_RESOURCE_OPERATION_SAFETY);
export function resourceType(definition) {
    if (definition.kind === 'process')
        return definition.color.model === 'cmyk' ? 'process_cmyk' : 'process_rgb';
    if (definition.kind === 'gradient')
        return 'linear_rgb_gradient';
    return 'spot_rgb';
}
function snapshotCounts(snapshot) {
    return {
        swatches: snapshot.swatches.length,
        gradients: snapshot.gradients.length,
        spots: snapshot.spots.length,
    };
}
function nativeIdentity(documentKey, identity) {
    return {
        version: 2,
        documentKey,
        collectionKind: identity.collectionKind,
        collectionIndex: identity.collectionIndex,
        swatchIndex: identity.swatchIndex,
        name: identity.name,
        resourceType: identity.resourceType,
        definitionDigest: canonicalDigest(identity.definition),
        beforeSnapshotDigest: canonicalDigest(identity.beforeSnapshot),
        beforeSnapshotCounts: snapshotCounts(identity.beforeSnapshot),
    };
}
export function swatchResourceSafetyPlan(result, canonicalRequestDigest) {
    return bindOperationSafetyPlan({
        policyVersion: 3,
        operationClass: 'create_resource',
        operationId: 'create_swatch_resource',
        canonicalRequestDigest,
        evidence: {
            documentKey: result.plan.documentKey,
            collectionKind: result.plan.collectionKind,
            requestedName: result.plan.resource.name,
            resourceType: resourceType(result.plan.resource),
            plannedDefinitionDigest: canonicalDigest(result.plan.resource),
            beforeSnapshotDigest: canonicalDigest(result.plan.beforeSnapshot),
            beforeSnapshotCounts: snapshotCounts(result.plan.beforeSnapshot),
        },
        preconditions: {
            status: result.plan.applyAllowed ? 'satisfied' : 'blocked',
            snapshotComplete: result.plan.beforeSnapshot.complete,
            nameAbsent: result.plan.nameAbsent,
            collectionCapacityWithinLimit: result.plan.collectionCapacityWithinLimit,
            resultSizeWithinLimit: result.plan.resultSizeWithinLimit,
            hostVersionVerified: result.plan.hostVersionVerified,
        },
        confirmation: { kind: 'risk_scoped', status: 'not_required' },
        applyAllowed: result.plan.applyAllowed,
    });
}
export function swatchResourceSafetyResult(result, canonicalRequestDigest, attestation) {
    const plan = swatchResourceSafetyPlan(result, canonicalRequestDigest);
    const transaction = result.transaction;
    if (transaction.state === 'planned')
        throw new Error('A planned resource creation has no terminal safety result.');
    if (transaction.state === 'verified') {
        if (!result.applied)
            throw new Error('A verified resource transaction must include its created resource.');
        return operationSafetyResultSchema.parse({
            policyVersion: 3,
            operationClass: 'create_resource',
            operationId: 'create_swatch_resource',
            canonicalRequestDigest,
            planDigest: plan.planDigest,
            attestation,
            evidence: {
                resourceIdentity: nativeIdentity(result.plan.documentKey, result.resource),
                ownership: 'self_created_unreferenced_resource_only',
                postconditionVerified: true,
                rollbackSnapshotDigest: null,
                rollbackSnapshotVerified: false,
                outstandingEffect: null,
            },
            executionEvidence: { outcome: 'completed' },
            resolution: {
                status: 'succeeded', terminal: true, recovery: 'not_required',
                proof: { kind: 'verified_postcondition' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false },
            },
        });
    }
    if (transaction.state === 'apply_failed') {
        return operationSafetyResultSchema.parse({
            policyVersion: 3,
            operationClass: 'create_resource',
            operationId: 'create_swatch_resource',
            canonicalRequestDigest,
            planDigest: plan.planDigest,
            attestation,
            evidence: {
                resourceIdentity: null,
                ownership: 'self_created_unreferenced_resource_only',
                postconditionVerified: false,
                rollbackSnapshotDigest: null,
                rollbackSnapshotVerified: false,
                outstandingEffect: null,
            },
            executionEvidence: { outcome: 'proven_pre_apply' },
            resolution: {
                status: 'failed', terminal: true, recovery: 'not_required',
                proof: { kind: 'proven_pre_apply', mutationAttempted: false },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false },
            },
        });
    }
    const hostIdentity = transaction.rollback.resourceIdentity;
    const identity = nativeIdentity(result.plan.documentKey, hostIdentity);
    if (transaction.state === 'rolled_back') {
        return operationSafetyResultSchema.parse({
            policyVersion: 3,
            operationClass: 'create_resource',
            operationId: 'create_swatch_resource',
            canonicalRequestDigest,
            planDigest: plan.planDigest,
            attestation,
            evidence: {
                resourceIdentity: identity,
                ownership: 'self_created_unreferenced_resource_only',
                postconditionVerified: false,
                rollbackSnapshotDigest: canonicalDigest(transaction.rollback.restoredSnapshot),
                rollbackSnapshotVerified: canonicalDigest(transaction.rollback.restoredSnapshot) === identity.beforeSnapshotDigest,
                outstandingEffect: null,
            },
            executionEvidence: { outcome: 'completed' },
            resolution: {
                status: 'recovered', terminal: true, recovery: 'verified',
                proof: { kind: 'verified_recovery' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false },
            },
        });
    }
    return operationSafetyResultSchema.parse({
        policyVersion: 3,
        operationClass: 'create_resource',
        operationId: 'create_swatch_resource',
        canonicalRequestDigest,
        planDigest: plan.planDigest,
        attestation,
        evidence: {
            resourceIdentity: identity,
            ownership: 'self_created_unreferenced_resource_only',
            postconditionVerified: false,
            rollbackSnapshotDigest: canonicalDigest(transaction.rollback.restoredSnapshot),
            rollbackSnapshotVerified: false,
            outstandingEffect: {
                kind: 'captured_native_resource_still_present',
                resourceIdentity: identity,
            },
        },
        executionEvidence: { outcome: 'recovery_failed' },
        resolution: {
            status: 'recovery_failed', terminal: true, recovery: 'failed',
            outstandingEffect: 'known_effect_present',
            proof: { kind: 'verified_outstanding_effect' },
            replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false },
        },
    });
}
export async function assertSwatchResourceSafetyConformance(result, canonicalRequestDigest, attestation, resolver) {
    const plan = swatchResourceSafetyPlan(result, canonicalRequestDigest);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null) {
        throw new Error('Resource-create terminal result requires a durable attestation resolver.');
    }
    await assertOperationSafetyAdapterConformance({
        registration: CREATE_SWATCH_RESOURCE_OPERATION_SAFETY,
        plan,
        result: swatchResourceSafetyResult(result, canonicalRequestDigest, attestation),
    }, resolver);
}
