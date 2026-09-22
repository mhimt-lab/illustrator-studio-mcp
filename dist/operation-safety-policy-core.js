import { z } from 'zod';
import { documentKeyMatches } from './document-key.js';
import { canonicalCommandIdSchema } from './command-id.js';
import { canonicalSha256 } from './mutation-canonical.js';
export const OPERATION_SAFETY_POLICY_VERSION = 1;
export const RESOURCE_CREATE_OPERATION_SAFETY_POLICY_VERSION = 3;
const identifierSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);
const nonemptyBoundedStringSchema = z.string().min(1).max(16_384);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const confirmationStatusSchema = z.enum(['not_required', 'confirmed', 'required', 'mismatch']);
const canonicalTimestampSchema = z.string().datetime({ offset: true });
export const terminalAttestationReferenceSchema = z.strictObject({
    version: z.literal(1),
    commandId: canonicalCommandIdSchema,
    operationId: identifierSchema,
    documentKey: nonemptyBoundedStringSchema,
    validatorIdentity: identifierSchema,
    validatorVersion: z.number().int().positive(),
    canonicalRequestDigest: digestSchema,
    resultDigestAlgorithm: z.literal('sha256'),
    durableResultArtifactDigest: digestSchema,
    terminalState: z.enum(['verified', 'apply_failed', 'rolled_back', 'rollback_failed']),
    finalizedAt: canonicalTimestampSchema,
});
export function canonicalDigest(value) {
    return canonicalSha256(value);
}
export function operationSafetyEvidenceDigest(value) {
    return canonicalDigest(value);
}
function safetyPlanDigest(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return '';
    const { planDigest: _planDigest, ...digestible } = value;
    return canonicalDigest(digestible);
}
const safetyPlanBindingFields = {
    canonicalRequestDigest: digestSchema,
    planDigest: digestSchema,
};
const commonReplayPolicyFields = {
    replay: z.strictObject({
        requestBinding: z.literal('canonical_request_digest'),
        retry: z.literal('return_attested_terminal_result'),
        beforeTerminal: z.literal('reconcile_required'),
        reapplyOnRetry: z.literal(false),
    }),
};
const commonPolicyFields = {
    version: z.literal(OPERATION_SAFETY_POLICY_VERSION),
    ...commonReplayPolicyFields,
};
const createPolicySchema = z.strictObject({
    ...commonPolicyFields,
    class: z.literal('create'),
    destructive: z.literal(false),
    evidence: z.strictObject({
        identity: z.literal('native_uuid'),
        ownership: z.literal('self_created_only'),
        postcondition: z.literal('created_state_matches_plan'),
    }),
    preconditions: z.strictObject({
        documentBinding: z.literal('explicit_document_key'),
        targetValidation: z.literal('same_execution_before_apply'),
    }),
    confirmation: z.literal('risk_scoped'),
    recovery: z.strictObject({
        mode: z.literal('remove_self_created_uuid'),
        verification: z.literal('native_uuid_absent'),
        unknownIdentity: z.literal('indeterminate'),
    }),
    terminal: z.strictObject({
        success: z.literal('verified'),
        failure: z.literal('proven_pre_apply_or_verified_recovery'),
        partialSuccess: z.literal('nonterminal_until_reconciled'),
    }),
});
const createResourcePolicySchema = z.strictObject({
    version: z.literal(RESOURCE_CREATE_OPERATION_SAFETY_POLICY_VERSION),
    ...commonReplayPolicyFields,
    class: z.literal('create_resource'),
    destructive: z.literal(false),
    evidence: z.strictObject({
        identity: z.literal('native_resource_identity_v2'),
        ownership: z.literal('self_created_unreferenced_resource_only'),
        beforeSnapshot: z.literal('complete_ordered_resource_collections_digest'),
        postcondition: z.literal('created_resource_and_collection_delta_match_plan'),
    }),
    preconditions: z.strictObject({
        documentBinding: z.literal('explicit_document_key'),
        collectionSnapshot: z.literal('same_execution_complete_before_apply'),
        nameValidation: z.literal('exact_absence_before_add'),
        collectionCapacity: z.literal('predicted_after_within_complete_limit'),
        resultSizeAdmission: z.literal('bounded_before_add'),
        hostVersionGate: z.enum(['measured_application_version_allowlist_for_spot', 'not_applicable']),
    }),
    confirmation: z.literal('risk_scoped'),
    recovery: z.strictObject({
        mode: z.literal('remove_captured_self_created_resource'),
        verification: z.literal('complete_ordered_resource_collections_match_before_digest'),
        unknownIdentity: z.literal('indeterminate'),
    }),
    terminal: z.strictObject({
        success: z.literal('verified'),
        failure: z.literal('proven_pre_apply_or_verified_recovery'),
        partialSuccess: z.literal('nonterminal_until_reconciled'),
    }),
});
const updateExistingPolicySchema = z.strictObject({
    ...commonPolicyFields,
    class: z.literal('update_existing'),
    destructive: z.literal(false),
    evidence: z.strictObject({
        identity: z.enum(['target_native_uuid', 'target_native_uuid_set', 'target_layer_identity', 'target_text_style_identity', 'ordered_artboard_collection_v1']),
        beforeState: z.literal('before_state_hash'),
        postcondition: z.literal('updated_state_matches_plan'),
    }),
    preconditions: z.strictObject({
        documentBinding: z.literal('explicit_document_key'),
        compareAndSet: z.literal('before_state_hash_match'),
    }),
    confirmation: z.literal('exact_change_set'),
    recovery: z.strictObject({
        mode: z.enum(['verified_inverse', 'verified_backup_restore']),
        verification: z.literal('restored_state_matches_before_hash'),
        partialRecovery: z.literal('indeterminate'),
    }),
    terminal: z.strictObject({
        success: z.literal('verified'),
        failure: z.literal('proven_pre_apply_or_verified_recovery'),
        partialSuccess: z.literal('nonterminal_until_reconciled'),
    }),
});
const deletePolicySchema = z.strictObject({
    ...commonPolicyFields,
    class: z.literal('delete'),
    destructive: z.literal(true),
    evidence: z.strictObject({
        identity: z.literal('complete_target_set_hash'),
        backup: z.literal('restore_verified_backup_handle'),
        postcondition: z.literal('all_targets_absent'),
    }),
    preconditions: z.strictObject({
        documentBinding: z.literal('explicit_document_key'),
        backupValidation: z.literal('required_before_apply'),
    }),
    confirmation: z.literal('exact_target_set_and_backup'),
    recovery: z.strictObject({
        mode: z.literal('restore_verified_backup'),
        verification: z.literal('complete_target_set_restored'),
        partialRecovery: z.literal('indeterminate'),
    }),
    terminal: z.strictObject({
        success: z.literal('verified_absence'),
        failure: z.literal('proven_pre_apply_or_verified_recovery'),
        partialSuccess: z.literal('nonterminal_until_reconciled'),
    }),
});
const exportPolicySchema = z.strictObject({
    ...commonPolicyFields,
    class: z.literal('export'),
    destructive: z.literal(false),
    evidence: z.strictObject({
        staging: z.literal('staging_path'),
        artifact: z.literal('hash_size_format'),
        publication: z.literal('atomic_publish'),
        filesystemIdentity: z.literal('canonical_realpath_device_inode'),
    }),
    preconditions: z.strictObject({
        documentBinding: z.literal('explicit_document_key'),
        destination: z.literal('non_overwrite_default'),
        atomicRenameDomain: z.literal('sibling_same_device_distinct_identity'),
    }),
    confirmation: z.literal('explicit_overwrite_only'),
    recovery: z.strictObject({
        mode: z.literal('remove_unpublished_staging'),
        documentChanges: z.literal('separate_transaction'),
        partialPublication: z.literal('indeterminate'),
    }),
    terminal: z.strictObject({
        success: z.literal('verified_artifact_published'),
        failure: z.literal('proven_unpublished_or_verified_cleanup'),
        partialSuccess: z.literal('nonterminal_until_reconciled'),
    }),
});
export const operationSafetyPolicySchema = z.discriminatedUnion('class', [
    createPolicySchema,
    createResourcePolicySchema,
    updateExistingPolicySchema,
    deletePolicySchema,
    exportPolicySchema,
]);
const createCapabilitiesSchema = z.strictObject({
    class: z.literal('create'),
    explicitDocumentBinding: z.literal(true),
    validateTargetsBeforeApply: z.literal(true),
    captureNativeUuid: z.literal(true),
    verifyCreatedState: z.literal(true),
    rollbackSelfCreatedUuidOnly: z.literal(true),
    verifyRollbackAbsence: z.literal(true),
    reconcileIndeterminate: z.literal(true),
    durableTerminalReplay: z.literal(true),
    trustedTerminalAttestationResolver: z.literal(true),
});
const createResourceCapabilitiesSchema = z.strictObject({
    class: z.literal('create_resource'),
    explicitDocumentBinding: z.literal(true),
    captureCompleteBeforeSnapshot: z.literal(true),
    validatePredictedCollectionCapacity: z.literal(true),
    boundDurableResultSizeBeforeAdd: z.literal(true),
    revalidateSnapshotAndNameBeforeAdd: z.literal(true),
    captureNativeResourceIdentity: z.literal(true),
    verifyCreatedResourceAndCollectionDelta: z.literal(true),
    rollbackCapturedSelfCreatedResourceOnly: z.literal(true),
    verifyCompleteRollbackSnapshot: z.literal(true),
    reconcileIndeterminate: z.literal(true),
    durableTerminalReplay: z.literal(true),
    trustedTerminalAttestationResolver: z.literal(true),
});
const updateExistingCapabilitiesSchema = z.strictObject({
    class: z.literal('update_existing'),
    explicitDocumentBinding: z.literal(true),
    bindTargetNativeUuid: z.literal(true),
    captureBeforeStateHash: z.literal(true),
    compareAndSetBeforeApply: z.literal(true),
    verifyUpdatedState: z.literal(true),
    recoveryMode: z.enum(['verified_inverse', 'verified_backup_restore']),
    verifyRestoredBeforeState: z.literal(true),
    reconcileIndeterminate: z.literal(true),
    durableTerminalReplay: z.literal(true),
    trustedTerminalAttestationResolver: z.literal(true),
});
const deleteCapabilitiesSchema = z.strictObject({
    class: z.literal('delete'),
    explicitDocumentBinding: z.literal(true),
    bindCompleteTargetSetHash: z.literal(true),
    requireRestoreVerifiedBackup: z.literal(true),
    requireExactConfirmation: z.literal(true),
    verifyAllTargetsAbsent: z.literal(true),
    recoverPartialDeletion: z.literal(true),
    verifyRestoredTargetSet: z.literal(true),
    reconcileIndeterminate: z.literal(true),
    durableTerminalReplay: z.literal(true),
    trustedTerminalAttestationResolver: z.literal(true),
});
const exportCapabilitiesSchema = z.strictObject({
    class: z.literal('export'),
    explicitDocumentBinding: z.literal(true),
    nonOverwriteDefault: z.literal(true),
    requireExplicitOverwriteConfirmation: z.literal(true),
    stageOutput: z.literal(true),
    verifyArtifactHashSizeFormat: z.literal(true),
    atomicPublish: z.literal(true),
    resolveCanonicalFilesystemIdentity: z.literal(true),
    requireSiblingStagingSameDevice: z.literal(true),
    trustedFilesystemIdentityResolver: z.literal(true),
    revalidateFilesystemIdentityBeforePublish: z.literal(true),
    isolateDocumentChanges: z.literal(true),
    cleanupUnpublishedStaging: z.literal(true),
    reconcileIndeterminate: z.literal(true),
    durableTerminalReplay: z.literal(true),
    trustedTerminalAttestationResolver: z.literal(true),
});
export const operationSafetyCapabilitiesSchema = z.discriminatedUnion('class', [
    createCapabilitiesSchema,
    createResourceCapabilitiesSchema,
    updateExistingCapabilitiesSchema,
    deleteCapabilitiesSchema,
    exportCapabilitiesSchema,
]);
export const operationSafetyRegistrationSchema = z.strictObject({
    operationId: identifierSchema,
    policy: operationSafetyPolicySchema,
    capabilities: operationSafetyCapabilitiesSchema,
}).superRefine((registration, context) => {
    if (registration.policy.class !== registration.capabilities.class) {
        context.addIssue({
            code: 'custom',
            message: 'Operation safety policy and capabilities must use the same operation class.',
            path: ['capabilities', 'class'],
        });
    }
    if (registration.policy.class === 'update_existing' && registration.capabilities.class === 'update_existing' &&
        registration.policy.recovery.mode !== registration.capabilities.recoveryMode) {
        context.addIssue({
            code: 'custom',
            message: 'Update recovery capability must match the declared policy recovery mode.',
            path: ['capabilities', 'recoveryMode'],
        });
    }
});
const createPlanSchema = z.strictObject({
    policyVersion: z.literal(OPERATION_SAFETY_POLICY_VERSION),
    operationClass: z.literal('create'),
    operationId: identifierSchema,
    ...safetyPlanBindingFields,
    evidence: z.strictObject({
        documentKey: nonemptyBoundedStringSchema,
        targetLocator: nonemptyBoundedStringSchema,
    }),
    preconditions: z.strictObject({
        status: z.enum(['satisfied', 'blocked']),
        targetsValidated: z.boolean(),
    }),
    confirmation: z.strictObject({ kind: z.literal('risk_scoped'), status: confirmationStatusSchema }),
    applyAllowed: z.boolean(),
});
const nativeResourceCollectionKindSchema = z.enum(['swatches', 'gradients', 'spots']);
const nativeResourceTypeSchema = z.enum(['process_rgb', 'process_cmyk', 'linear_rgb_gradient', 'spot_rgb']);
const resourceCollectionCountsSchema = z.strictObject({
    swatches: z.number().int().nonnegative().max(512),
    gradients: z.number().int().nonnegative().max(512),
    spots: z.number().int().nonnegative().max(512),
});
const swatchResourceIdentitySchema = z.strictObject({
    version: z.literal(2),
    documentKey: nonemptyBoundedStringSchema,
    collectionKind: nativeResourceCollectionKindSchema,
    collectionIndex: z.number().int().nonnegative().max(511),
    swatchIndex: z.number().int().nonnegative().max(511),
    name: z.string().min(1).max(31),
    resourceType: nativeResourceTypeSchema,
    definitionDigest: digestSchema,
    beforeSnapshotDigest: digestSchema,
    beforeSnapshotCounts: resourceCollectionCountsSchema,
});
export const TEXT_STYLE_RESOURCE_NAME_MAX = 1_024;
const textStyleResourceCollectionKindSchema = z.enum(['characterStyles', 'paragraphStyles']);
const textStyleResourceTypeSchema = z.enum(['named_character_style']);
const textStyleCollectionCountsSchema = z.strictObject({
    characterStyles: z.number().int().nonnegative().max(512),
    paragraphStyles: z.number().int().nonnegative().max(512),
});
const textStyleResourceIdentitySchema = z.strictObject({
    version: z.literal(1),
    documentKey: nonemptyBoundedStringSchema,
    collectionKind: textStyleResourceCollectionKindSchema,
    collectionIndex: z.number().int().nonnegative().max(511),
    name: z.string().min(1).max(TEXT_STYLE_RESOURCE_NAME_MAX),
    resourceType: textStyleResourceTypeSchema,
    definitionDigest: digestSchema,
    beforeSnapshotDigest: digestSchema,
    beforeSnapshotCounts: textStyleCollectionCountsSchema,
});
export const nativeResourceIdentitySchema = z.discriminatedUnion('version', [
    swatchResourceIdentitySchema,
    textStyleResourceIdentitySchema,
]);
const createResourcePlanSchema = z.strictObject({
    policyVersion: z.literal(RESOURCE_CREATE_OPERATION_SAFETY_POLICY_VERSION),
    operationClass: z.literal('create_resource'),
    operationId: identifierSchema,
    ...safetyPlanBindingFields,
    evidence: z.union([
        z.strictObject({
            documentKey: nonemptyBoundedStringSchema,
            collectionKind: nativeResourceCollectionKindSchema,
            requestedName: z.string().min(1).max(31),
            resourceType: nativeResourceTypeSchema,
            plannedDefinitionDigest: digestSchema,
            beforeSnapshotDigest: digestSchema,
            beforeSnapshotCounts: resourceCollectionCountsSchema,
        }),
        z.strictObject({
            documentKey: nonemptyBoundedStringSchema,
            collectionKind: textStyleResourceCollectionKindSchema,
            requestedName: z.string().min(1).max(TEXT_STYLE_RESOURCE_NAME_MAX),
            resourceType: textStyleResourceTypeSchema,
            plannedDefinitionDigest: digestSchema,
            beforeSnapshotDigest: digestSchema,
            beforeSnapshotCounts: textStyleCollectionCountsSchema,
        }),
    ]),
    preconditions: z.strictObject({
        status: z.enum(['satisfied', 'blocked']),
        snapshotComplete: z.boolean(),
        nameAbsent: z.boolean(),
        collectionCapacityWithinLimit: z.boolean(),
        resultSizeWithinLimit: z.boolean(),
        hostVersionVerified: z.boolean(),
    }),
    confirmation: z.strictObject({ kind: z.literal('risk_scoped'), status: confirmationStatusSchema }),
    applyAllowed: z.boolean(),
});
export const UPDATE_TARGET_SET_MAX_UUIDS = 256;
const updateTargetUuidSetSchema = z.array(nonemptyBoundedStringSchema).min(1).max(UPDATE_TARGET_SET_MAX_UUIDS)
    .superRefine((uuids, context) => {
    if (new Set(uuids).size !== uuids.length) {
        context.addIssue({ code: 'custom', message: 'Update target UUID set must not contain duplicates.' });
    }
});
function assertUpdateTargetSetHash(evidence, context) {
    if (evidence.targetSetHash !== canonicalDigest(evidence.targetUuids)) {
        context.addIssue({ code: 'custom', message: 'Update target set hash must be the digest of the ordered UUIDs.' });
    }
}
export const LAYER_IDENTITY_TOKEN_PATTERN = /^layer:[a-f0-9]{64}$/;
const layerIdentityTokenSchema = z.string().regex(LAYER_IDENTITY_TOKEN_PATTERN);
const textStyleUpdateTargetSchema = z.strictObject({
    collectionKind: textStyleResourceCollectionKindSchema,
    collectionIndex: z.number().int().nonnegative().max(511),
    name: z.string().min(1).max(TEXT_STYLE_RESOURCE_NAME_MAX),
});
const artboardIdentityTokenSchema = z.string().regex(/^artboard-update-v1:[a-f0-9]{64}$/);
function sameUpdateTarget(left, right) {
    if ('targetUuid' in left)
        return 'targetUuid' in right && left.targetUuid === right.targetUuid;
    if ('targetLayerIdentity' in left)
        return 'targetLayerIdentity' in right && left.targetLayerIdentity === right.targetLayerIdentity;
    if ('targetArtboardIdentityV1' in left)
        return 'targetArtboardIdentityV1' in right && left.targetArtboardIdentityV1 === right.targetArtboardIdentityV1;
    if ('targetTextStyle' in left) {
        return 'targetTextStyle' in right && canonicalDigest(left.targetTextStyle) === canonicalDigest(right.targetTextStyle);
    }
    return 'targetUuids' in right && left.targetSetHash === right.targetSetHash &&
        left.targetUuids.length === right.targetUuids.length &&
        left.targetUuids.every((uuid, index) => uuid === right.targetUuids[index]);
}
function updateTargetIdentity(evidence) {
    if ('targetUuid' in evidence)
        return 'target_native_uuid';
    if ('targetLayerIdentity' in evidence)
        return 'target_layer_identity';
    if ('targetArtboardIdentityV1' in evidence)
        return 'ordered_artboard_collection_v1';
    if ('targetTextStyle' in evidence)
        return 'target_text_style_identity';
    return 'target_native_uuid_set';
}
const updateExistingPlanSchema = z.strictObject({
    policyVersion: z.literal(OPERATION_SAFETY_POLICY_VERSION),
    operationClass: z.literal('update_existing'),
    operationId: identifierSchema,
    ...safetyPlanBindingFields,
    evidence: z.union([
        z.strictObject({
            documentKey: nonemptyBoundedStringSchema,
            targetUuid: nonemptyBoundedStringSchema,
            beforeStateHash: digestSchema,
            plannedAfterStateHash: digestSchema,
            plannedChangeSetDigest: digestSchema,
        }),
        z.strictObject({
            documentKey: nonemptyBoundedStringSchema,
            targetUuids: updateTargetUuidSetSchema,
            targetSetHash: digestSchema,
            beforeStateHash: digestSchema,
            plannedAfterStateHash: digestSchema,
            plannedChangeSetDigest: digestSchema,
        }).superRefine(assertUpdateTargetSetHash),
        z.strictObject({
            documentKey: nonemptyBoundedStringSchema,
            targetLayerIdentity: layerIdentityTokenSchema,
            beforeStateHash: digestSchema,
            plannedAfterStateHash: digestSchema,
            plannedChangeSetDigest: digestSchema,
        }),
        z.strictObject({
            documentKey: nonemptyBoundedStringSchema,
            targetArtboardIdentityV1: artboardIdentityTokenSchema,
            beforeStateHash: digestSchema,
            plannedAfterStateHash: digestSchema,
            plannedChangeSetDigest: digestSchema,
        }),
        z.strictObject({
            documentKey: nonemptyBoundedStringSchema,
            targetTextStyle: textStyleUpdateTargetSchema,
            beforeStateHash: digestSchema,
            plannedAfterStateHash: digestSchema,
            plannedChangeSetDigest: digestSchema,
        }),
    ]),
    preconditions: z.strictObject({ status: z.enum(['satisfied', 'blocked']), compareAndSetMatched: z.boolean() }),
    confirmation: z.strictObject({
        kind: z.literal('exact_change_set'),
        canonicalRequestDigest: digestSchema,
        changeSetHash: digestSchema,
        status: confirmationStatusSchema,
    }),
    applyAllowed: z.boolean(),
});
const deletePlanSchema = z.strictObject({
    policyVersion: z.literal(OPERATION_SAFETY_POLICY_VERSION),
    operationClass: z.literal('delete'),
    operationId: identifierSchema,
    ...safetyPlanBindingFields,
    evidence: z.strictObject({
        documentKey: nonemptyBoundedStringSchema,
        targetSetHash: digestSchema,
        backupHandle: nonemptyBoundedStringSchema,
        backupRestoreVerified: z.boolean(),
    }),
    preconditions: z.strictObject({ status: z.enum(['satisfied', 'blocked']), completeTargetSetValidated: z.boolean() }),
    confirmation: z.strictObject({
        kind: z.literal('exact_target_set_and_backup'),
        canonicalRequestDigest: digestSchema,
        targetSetHash: digestSchema,
        backupHandle: nonemptyBoundedStringSchema,
        status: confirmationStatusSchema,
    }),
    applyAllowed: z.boolean(),
});
const filesystemObjectIdentitySchema = z.strictObject({
    canonicalPath: nonemptyBoundedStringSchema,
    deviceId: z.string().regex(/^[0-9]+$/),
    inodeId: z.string().regex(/^[0-9]+$/),
});
export const exportFilesystemIdentitySchema = z.strictObject({
    resolution: z.literal('trusted_realpath_lstat'),
    destinationDirectory: filesystemObjectIdentitySchema,
    destination: z.discriminatedUnion('exists', [
        z.strictObject({
            exists: z.literal(false),
            canonicalPath: nonemptyBoundedStringSchema,
            parentDirectoryCanonicalPath: nonemptyBoundedStringSchema,
        }),
        z.strictObject({
            exists: z.literal(true),
            ...filesystemObjectIdentitySchema.shape,
            parentDirectoryCanonicalPath: nonemptyBoundedStringSchema,
        }),
    ]),
    staging: z.strictObject({
        ...filesystemObjectIdentitySchema.shape,
        parentDirectoryCanonicalPath: nonemptyBoundedStringSchema,
    }),
});
export const exportPublishAttestationSchema = z.strictObject({
    version: z.literal(1),
    attestationId: nonemptyBoundedStringSchema,
    operationId: identifierSchema,
    planDigest: digestSchema,
    canonicalRequestDigest: digestSchema,
    filesystemIdentityDigest: digestSchema,
    destinationPath: nonemptyBoundedStringSchema,
    stagingPath: nonemptyBoundedStringSchema,
    checkedPhase: z.literal('pre_publish'),
});
const exportPlanSchema = z.strictObject({
    policyVersion: z.literal(OPERATION_SAFETY_POLICY_VERSION),
    operationClass: z.literal('export'),
    operationId: identifierSchema,
    ...safetyPlanBindingFields,
    evidence: z.strictObject({
        documentKey: nonemptyBoundedStringSchema,
        destinationPath: nonemptyBoundedStringSchema,
        stagingPath: nonemptyBoundedStringSchema,
        destinationExists: z.boolean(),
        existingArtifactHash: digestSchema.nullable(),
        filesystemIdentity: exportFilesystemIdentitySchema,
        documentTransaction: z.discriminatedUnion('required', [
            z.strictObject({ required: z.literal(false) }),
            z.strictObject({
                required: z.literal(true),
                transactionId: nonemptyBoundedStringSchema,
                documentKey: nonemptyBoundedStringSchema,
                expectedOperationId: identifierSchema,
                intendedCanonicalRequestDigest: digestSchema,
                attestation: terminalAttestationReferenceSchema,
            }),
        ]),
    }),
    preconditions: z.strictObject({ status: z.enum(['satisfied', 'blocked']), stagingValidated: z.boolean() }),
    confirmation: z.strictObject({
        kind: z.literal('explicit_overwrite_only'),
        status: confirmationStatusSchema,
        canonicalRequestDigest: digestSchema,
        destinationPath: nonemptyBoundedStringSchema,
        existingArtifactHash: digestSchema.nullable(),
    }),
    applyAllowed: z.boolean(),
});
export const operationSafetyPlanSchema = z.discriminatedUnion('operationClass', [
    createPlanSchema,
    createResourcePlanSchema,
    updateExistingPlanSchema,
    deletePlanSchema,
    exportPlanSchema,
]).superRefine((plan, context) => {
    const confirmationAllowsApply = plan.operationClass === 'create' || plan.operationClass === 'create_resource'
        ? plan.confirmation.status === 'not_required' || plan.confirmation.status === 'confirmed'
        : plan.operationClass === 'update_existing' || plan.operationClass === 'delete'
            ? plan.confirmation.status === 'confirmed'
            : !plan.evidence.destinationExists
                ? plan.confirmation.status === 'not_required' || plan.confirmation.status === 'confirmed'
                : plan.confirmation.status === 'confirmed';
    const classEvidenceSatisfied = plan.operationClass === 'create'
        ? plan.preconditions.targetsValidated
        : plan.operationClass === 'create_resource'
            ? plan.preconditions.snapshotComplete && plan.preconditions.nameAbsent &&
                plan.preconditions.collectionCapacityWithinLimit && plan.preconditions.resultSizeWithinLimit &&
                plan.preconditions.hostVersionVerified
            : plan.operationClass === 'update_existing'
                ? plan.preconditions.compareAndSetMatched &&
                    plan.confirmation.canonicalRequestDigest === plan.canonicalRequestDigest &&
                    plan.confirmation.changeSetHash === plan.evidence.plannedChangeSetDigest
                : plan.operationClass === 'delete'
                    ? plan.preconditions.completeTargetSetValidated && plan.evidence.backupRestoreVerified &&
                        plan.confirmation.canonicalRequestDigest === plan.canonicalRequestDigest &&
                        plan.confirmation.targetSetHash === plan.evidence.targetSetHash &&
                        plan.confirmation.backupHandle === plan.evidence.backupHandle
                    : plan.preconditions.stagingValidated &&
                        plan.evidence.filesystemIdentity.staging.canonicalPath !==
                            plan.evidence.filesystemIdentity.destination.canonicalPath &&
                        plan.evidence.stagingPath === plan.evidence.filesystemIdentity.staging.canonicalPath &&
                        plan.evidence.destinationPath === plan.evidence.filesystemIdentity.destination.canonicalPath &&
                        plan.evidence.destinationExists === plan.evidence.filesystemIdentity.destination.exists &&
                        plan.evidence.filesystemIdentity.staging.parentDirectoryCanonicalPath ===
                            plan.evidence.filesystemIdentity.destinationDirectory.canonicalPath &&
                        plan.evidence.filesystemIdentity.destination.parentDirectoryCanonicalPath ===
                            plan.evidence.filesystemIdentity.destinationDirectory.canonicalPath &&
                        plan.evidence.filesystemIdentity.staging.deviceId ===
                            plan.evidence.filesystemIdentity.destinationDirectory.deviceId &&
                        (!plan.evidence.filesystemIdentity.destination.exists ||
                            (plan.evidence.filesystemIdentity.destination.deviceId ===
                                plan.evidence.filesystemIdentity.destinationDirectory.deviceId &&
                                plan.evidence.filesystemIdentity.destination.inodeId !==
                                    plan.evidence.filesystemIdentity.staging.inodeId)) &&
                        plan.confirmation.canonicalRequestDigest === plan.canonicalRequestDigest &&
                        plan.confirmation.destinationPath === plan.evidence.filesystemIdentity.destination.canonicalPath &&
                        plan.confirmation.existingArtifactHash === plan.evidence.existingArtifactHash &&
                        (plan.evidence.destinationExists
                            ? plan.evidence.existingArtifactHash !== null
                            : plan.evidence.existingArtifactHash === null);
    const expectedApplyAllowed = plan.preconditions.status === 'satisfied' && confirmationAllowsApply && classEvidenceSatisfied;
    if (plan.applyAllowed !== expectedApplyAllowed) {
        context.addIssue({
            code: 'custom',
            message: 'applyAllowed must match class-specific preconditions, evidence, and confirmation.',
            path: ['applyAllowed'],
        });
    }
    if (plan.operationClass === 'update_existing' && plan.confirmation.status === 'confirmed' &&
        (plan.confirmation.canonicalRequestDigest !== plan.canonicalRequestDigest ||
            plan.confirmation.changeSetHash !== plan.evidence.plannedChangeSetDigest)) {
        context.addIssue({ code: 'custom', message: 'Confirmed update must match the canonical request and planned change set.', path: ['confirmation'] });
    }
    if (plan.operationClass === 'delete' && plan.confirmation.status === 'confirmed' &&
        (plan.confirmation.canonicalRequestDigest !== plan.canonicalRequestDigest ||
            plan.confirmation.targetSetHash !== plan.evidence.targetSetHash ||
            plan.confirmation.backupHandle !== plan.evidence.backupHandle)) {
        context.addIssue({ code: 'custom', message: 'Confirmed deletion must match the canonical request, target set, and backup.', path: ['confirmation'] });
    }
    if (plan.operationClass === 'export') {
        const filesystem = plan.evidence.filesystemIdentity;
        const invalidFilesystemIdentity = filesystem.staging.canonicalPath === filesystem.destination.canonicalPath ||
            plan.evidence.stagingPath !== filesystem.staging.canonicalPath ||
            plan.evidence.destinationPath !== filesystem.destination.canonicalPath ||
            plan.evidence.destinationExists !== filesystem.destination.exists ||
            filesystem.staging.parentDirectoryCanonicalPath !== filesystem.destinationDirectory.canonicalPath ||
            filesystem.destination.parentDirectoryCanonicalPath !== filesystem.destinationDirectory.canonicalPath ||
            filesystem.staging.deviceId !== filesystem.destinationDirectory.deviceId ||
            (filesystem.destination.exists &&
                (filesystem.destination.deviceId !== filesystem.destinationDirectory.deviceId ||
                    filesystem.destination.inodeId === filesystem.staging.inodeId));
        if (invalidFilesystemIdentity) {
            context.addIssue({ code: 'custom', message: 'Export requires distinct sibling filesystem identities on one device.', path: ['evidence', 'filesystemIdentity'] });
        }
        if (plan.evidence.documentTransaction.required &&
            (plan.evidence.documentTransaction.transactionId !== plan.evidence.documentTransaction.attestation.commandId ||
                plan.evidence.documentTransaction.documentKey !== plan.evidence.documentKey ||
                plan.evidence.documentTransaction.documentKey !== plan.evidence.documentTransaction.attestation.documentKey ||
                plan.evidence.documentTransaction.expectedOperationId !== plan.evidence.documentTransaction.attestation.operationId ||
                plan.evidence.documentTransaction.intendedCanonicalRequestDigest !==
                    plan.evidence.documentTransaction.attestation.canonicalRequestDigest ||
                plan.evidence.documentTransaction.attestation.terminalState !== 'verified')) {
            context.addIssue({ code: 'custom', message: 'Export document transaction must match its document, operation, intent, and attested command.', path: ['evidence', 'documentTransaction'] });
        }
        if (plan.evidence.destinationExists !== (plan.evidence.existingArtifactHash !== null)) {
            context.addIssue({ code: 'custom', message: 'Destination existence must match the existing artifact evidence.', path: ['evidence', 'existingArtifactHash'] });
        }
        if (plan.confirmation.status === 'confirmed' &&
            (plan.confirmation.canonicalRequestDigest !== plan.canonicalRequestDigest ||
                plan.confirmation.destinationPath !== filesystem.destination.canonicalPath ||
                plan.confirmation.existingArtifactHash !== plan.evidence.existingArtifactHash)) {
            context.addIssue({ code: 'custom', message: 'Confirmed overwrite must match the canonical request, destination, and existing artifact.', path: ['confirmation'] });
        }
    }
    if (plan.planDigest !== safetyPlanDigest(plan)) {
        context.addIssue({
            code: 'custom',
            message: 'planDigest must attest the complete canonical safety plan.',
            path: ['planDigest'],
        });
    }
});
export function bindOperationSafetyPlan(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('Operation safety plan must be an object.');
    }
    return operationSafetyPlanSchema.parse({ ...value, planDigest: canonicalDigest(value) });
}
const terminalResolutionSchema = z.union([
    z.strictObject({
        status: z.literal('succeeded'), terminal: z.literal(true), recovery: z.literal('not_required'),
        proof: z.strictObject({ kind: z.literal('verified_postcondition') }),
        replay: z.strictObject({ status: z.literal('durable_terminal'), action: z.literal('return_attested_result'), reapply: z.literal(false) }),
    }),
    z.strictObject({
        status: z.literal('failed'), terminal: z.literal(true), recovery: z.literal('not_required'),
        proof: z.strictObject({ kind: z.literal('proven_pre_apply'), mutationAttempted: z.literal(false) }),
        replay: z.strictObject({ status: z.literal('durable_terminal'), action: z.literal('return_attested_result'), reapply: z.literal(false) }),
    }),
    z.strictObject({
        status: z.literal('recovered'), terminal: z.literal(true), recovery: z.literal('verified'),
        proof: z.strictObject({ kind: z.literal('verified_recovery') }),
        replay: z.strictObject({ status: z.literal('durable_terminal'), action: z.literal('return_attested_result'), reapply: z.literal(false) }),
    }),
    z.strictObject({
        status: z.literal('recovery_failed'), terminal: z.literal(true), recovery: z.literal('failed'),
        outstandingEffect: z.literal('known_effect_present'),
        proof: z.strictObject({ kind: z.literal('verified_outstanding_effect') }),
        replay: z.strictObject({ status: z.literal('durable_terminal'), action: z.literal('return_attested_result'), reapply: z.literal(false) }),
    }),
    z.strictObject({
        status: z.literal('recovery_failed'), terminal: z.literal(false), recovery: z.literal('failed'),
        outstandingEffect: z.literal('unverified'),
        proof: z.strictObject({ kind: z.literal('reconciliation_required') }),
        replay: z.strictObject({ status: z.literal('blocked'), action: z.literal('reconcile'), reapply: z.literal(false) }),
    }),
    z.strictObject({
        status: z.literal('indeterminate'),
        cause: z.enum(['timeout', 'partial_success', 'response_loss', 'recovery_indeterminate', 'recovery_unknown']),
        terminal: z.literal(false),
        recovery: z.enum(['not_started', 'indeterminate']),
        proof: z.strictObject({ kind: z.literal('reconciliation_required') }),
        replay: z.strictObject({ status: z.literal('blocked'), action: z.literal('reconcile'), reapply: z.literal(false) }),
    }),
]);
const resultCommonFields = {
    operationId: identifierSchema,
    canonicalRequestDigest: digestSchema,
    planDigest: digestSchema,
    attestation: terminalAttestationReferenceSchema.nullable(),
    executionEvidence: z.strictObject({
        outcome: z.enum([
            'completed', 'proven_pre_apply', 'timeout', 'partial_success', 'response_loss',
            'recovery_indeterminate', 'recovery_unknown', 'recovery_failed',
        ]),
    }),
    resolution: terminalResolutionSchema,
};
const resultCommon = {
    policyVersion: z.literal(OPERATION_SAFETY_POLICY_VERSION),
    ...resultCommonFields,
};
export const operationSafetyResultSchema = z.discriminatedUnion('operationClass', [
    z.strictObject({
        ...resultCommon,
        operationClass: z.literal('create'),
        evidence: z.strictObject({
            nativeUuid: nonemptyBoundedStringSchema.nullable(),
            ownership: z.literal('self_created_only'),
            postconditionVerified: z.boolean(),
            outstandingEffect: z.union([
                z.null(),
                z.strictObject({ kind: z.literal('native_uuid_still_present'), nativeUuid: nonemptyBoundedStringSchema }),
            ]),
        }),
    }),
    z.strictObject({
        policyVersion: z.literal(RESOURCE_CREATE_OPERATION_SAFETY_POLICY_VERSION),
        ...resultCommonFields,
        operationClass: z.literal('create_resource'),
        evidence: z.strictObject({
            resourceIdentity: nativeResourceIdentitySchema.nullable(),
            ownership: z.literal('self_created_unreferenced_resource_only'),
            postconditionVerified: z.boolean(),
            rollbackSnapshotDigest: digestSchema.nullable(),
            rollbackSnapshotVerified: z.boolean(),
            outstandingEffect: z.union([
                z.null(),
                z.strictObject({
                    kind: z.literal('captured_native_resource_still_present'),
                    resourceIdentity: nativeResourceIdentitySchema,
                }),
            ]),
        }),
    }),
    z.strictObject({
        ...resultCommon,
        operationClass: z.literal('update_existing'),
        evidence: z.union([
            z.strictObject({
                targetUuid: nonemptyBoundedStringSchema,
                beforeStateHash: digestSchema,
                afterStateHash: digestSchema.nullable(),
                restoredStateHash: digestSchema.nullable(),
                restoredBeforeStateVerified: z.boolean(),
            }),
            z.strictObject({
                targetUuids: updateTargetUuidSetSchema,
                targetSetHash: digestSchema,
                beforeStateHash: digestSchema,
                afterStateHash: digestSchema.nullable(),
                restoredStateHash: digestSchema.nullable(),
                restoredBeforeStateVerified: z.boolean(),
            }).superRefine(assertUpdateTargetSetHash),
            z.strictObject({
                targetLayerIdentity: layerIdentityTokenSchema,
                beforeStateHash: digestSchema,
                afterStateHash: digestSchema.nullable(),
                restoredStateHash: digestSchema.nullable(),
                restoredBeforeStateVerified: z.boolean(),
            }),
            z.strictObject({
                targetArtboardIdentityV1: artboardIdentityTokenSchema,
                beforeStateHash: digestSchema,
                afterStateHash: digestSchema.nullable(),
                restoredStateHash: digestSchema.nullable(),
                restoredBeforeStateVerified: z.boolean(),
            }),
            z.strictObject({
                targetTextStyle: textStyleUpdateTargetSchema,
                beforeStateHash: digestSchema,
                afterStateHash: digestSchema.nullable(),
                restoredStateHash: digestSchema.nullable(),
                restoredBeforeStateVerified: z.boolean(),
            }),
        ]),
    }),
    z.strictObject({
        ...resultCommon,
        operationClass: z.literal('delete'),
        evidence: z.strictObject({ backupHandle: nonemptyBoundedStringSchema, targetSetHash: digestSchema, absenceVerified: z.boolean(), restoredTargetSetVerified: z.boolean() }),
    }),
    z.strictObject({
        ...resultCommon,
        operationClass: z.literal('export'),
        evidence: z.strictObject({
            stagingPath: nonemptyBoundedStringSchema,
            destinationPath: nonemptyBoundedStringSchema,
            publishedPath: nonemptyBoundedStringSchema.nullable(),
            artifactHash: digestSchema.nullable(),
            artifactSize: z.number().int().nonnegative().nullable(),
            format: z.string().min(1).max(64).nullable(),
            publishedAtomically: z.boolean(),
            publishAttestation: exportPublishAttestationSchema.nullable(),
            unpublishedStagingCleanupVerified: z.boolean(),
            documentTransaction: z.discriminatedUnion('required', [
                z.strictObject({ required: z.literal(false) }),
                z.strictObject({
                    required: z.literal(true),
                    transactionId: nonemptyBoundedStringSchema,
                    documentKey: nonemptyBoundedStringSchema,
                    expectedOperationId: identifierSchema,
                    intendedCanonicalRequestDigest: digestSchema,
                    attestation: terminalAttestationReferenceSchema,
                }),
            ]),
        }),
    }),
]).superRefine((result, context) => {
    const status = result.resolution.status;
    let evidenceValid = true;
    let executionValid = true;
    const executionOutcome = result.executionEvidence.outcome;
    const nonterminalOutcomes = new Set([
        'timeout', 'partial_success', 'response_loss', 'recovery_indeterminate', 'recovery_unknown',
    ]);
    if (nonterminalOutcomes.has(executionOutcome) && result.resolution.terminal)
        executionValid = false;
    if (status === 'indeterminate' && result.resolution.cause !== executionOutcome)
        executionValid = false;
    if (status === 'recovery_failed' && executionOutcome !== 'recovery_failed')
        executionValid = false;
    if (status === 'failed' && executionOutcome !== 'proven_pre_apply') {
        executionValid = false;
    }
    if ((status === 'succeeded' || status === 'recovered') && executionOutcome !== 'completed')
        executionValid = false;
    if (result.resolution.terminal !== (result.attestation !== null))
        executionValid = false;
    if (result.attestation !== null && result.attestation.canonicalRequestDigest !== result.canonicalRequestDigest) {
        executionValid = false;
    }
    if (result.attestation !== null) {
        const expectedTerminalState = status === 'succeeded'
            ? 'verified'
            : status === 'recovered'
                ? 'rolled_back'
                : status === 'recovery_failed'
                    ? 'rollback_failed'
                    : 'apply_failed';
        if (result.attestation.terminalState !== expectedTerminalState)
            executionValid = false;
    }
    switch (result.operationClass) {
        case 'create':
            if (status === 'succeeded') {
                evidenceValid = result.evidence.nativeUuid !== null && result.evidence.postconditionVerified &&
                    result.evidence.outstandingEffect === null;
            }
            else if (status === 'recovered') {
                evidenceValid = result.evidence.nativeUuid !== null && !result.evidence.postconditionVerified &&
                    result.evidence.outstandingEffect === null;
            }
            else if (status === 'recovery_failed') {
                evidenceValid = result.evidence.nativeUuid !== null && !result.evidence.postconditionVerified &&
                    (result.resolution.terminal
                        ? result.resolution.outstandingEffect === 'known_effect_present' &&
                            result.evidence.outstandingEffect?.kind === 'native_uuid_still_present' &&
                            result.evidence.outstandingEffect.nativeUuid === result.evidence.nativeUuid
                        : result.resolution.outstandingEffect === 'unverified' && result.evidence.nativeUuid === null &&
                            result.evidence.outstandingEffect === null);
            }
            else if (status === 'failed') {
                evidenceValid = result.evidence.nativeUuid === null && !result.evidence.postconditionVerified &&
                    result.evidence.outstandingEffect === null;
            }
            break;
        case 'create_resource':
            if (status === 'succeeded') {
                evidenceValid = result.evidence.resourceIdentity !== null && result.evidence.postconditionVerified &&
                    result.evidence.rollbackSnapshotDigest === null && !result.evidence.rollbackSnapshotVerified &&
                    result.evidence.outstandingEffect === null;
            }
            else if (status === 'recovered') {
                evidenceValid = result.evidence.resourceIdentity !== null && !result.evidence.postconditionVerified &&
                    result.evidence.rollbackSnapshotDigest === result.evidence.resourceIdentity.beforeSnapshotDigest &&
                    result.evidence.rollbackSnapshotVerified && result.evidence.outstandingEffect === null;
            }
            else if (status === 'recovery_failed') {
                evidenceValid = result.evidence.resourceIdentity !== null && !result.evidence.postconditionVerified &&
                    result.evidence.rollbackSnapshotDigest !== null &&
                    result.evidence.rollbackSnapshotDigest !== result.evidence.resourceIdentity.beforeSnapshotDigest &&
                    !result.evidence.rollbackSnapshotVerified &&
                    (result.resolution.terminal
                        ? result.resolution.outstandingEffect === 'known_effect_present' &&
                            result.evidence.outstandingEffect?.kind === 'captured_native_resource_still_present' &&
                            canonicalDigest(result.evidence.outstandingEffect.resourceIdentity) ===
                                canonicalDigest(result.evidence.resourceIdentity)
                        : result.resolution.outstandingEffect === 'unverified' && result.evidence.outstandingEffect === null);
            }
            else if (status === 'failed') {
                evidenceValid = result.evidence.resourceIdentity === null && !result.evidence.postconditionVerified &&
                    result.evidence.rollbackSnapshotDigest === null && !result.evidence.rollbackSnapshotVerified &&
                    result.evidence.outstandingEffect === null;
            }
            break;
        case 'update_existing':
            if (status === 'succeeded') {
                evidenceValid = result.evidence.afterStateHash !== null && result.evidence.restoredStateHash === null &&
                    !result.evidence.restoredBeforeStateVerified;
            }
            else if (status === 'recovered') {
                evidenceValid = result.evidence.restoredStateHash !== null && result.evidence.restoredBeforeStateVerified;
            }
            else if (status === 'failed') {
                evidenceValid = result.evidence.afterStateHash === null && result.evidence.restoredStateHash === null &&
                    !result.evidence.restoredBeforeStateVerified;
            }
            else if (status === 'recovery_failed') {
                evidenceValid = !result.resolution.terminal && !result.evidence.restoredBeforeStateVerified;
            }
            break;
        case 'delete':
            if (status === 'succeeded')
                evidenceValid = result.evidence.absenceVerified && !result.evidence.restoredTargetSetVerified;
            else if (status === 'recovered')
                evidenceValid = result.evidence.restoredTargetSetVerified;
            else if (status === 'failed')
                evidenceValid = !result.evidence.absenceVerified && !result.evidence.restoredTargetSetVerified;
            else if (status === 'recovery_failed') {
                evidenceValid = !result.resolution.terminal && !result.evidence.restoredTargetSetVerified;
            }
            break;
        case 'export':
            if (result.evidence.stagingPath === result.evidence.destinationPath)
                evidenceValid = false;
            if (status === 'succeeded') {
                evidenceValid = evidenceValid && result.evidence.publishedPath !== null && result.evidence.artifactHash !== null &&
                    result.evidence.artifactSize !== null && result.evidence.format !== null && result.evidence.publishedAtomically &&
                    result.evidence.publishAttestation !== null &&
                    result.evidence.publishedPath === result.evidence.destinationPath;
            }
            else if (status === 'failed') {
                evidenceValid = evidenceValid && result.evidence.publishedPath === null && !result.evidence.publishedAtomically &&
                    result.evidence.publishAttestation === null && !result.evidence.unpublishedStagingCleanupVerified;
            }
            else if (status === 'recovered') {
                evidenceValid = evidenceValid && result.evidence.publishedPath === null && !result.evidence.publishedAtomically &&
                    result.evidence.publishAttestation === null && result.evidence.unpublishedStagingCleanupVerified;
            }
            else if (status === 'recovery_failed') {
                evidenceValid = evidenceValid && !result.resolution.terminal && result.evidence.publishAttestation === null;
            }
            else {
                evidenceValid = evidenceValid && result.evidence.publishAttestation === null;
            }
            break;
    }
    if (!evidenceValid || !executionValid) {
        context.addIssue({
            code: 'custom',
            message: 'Operation evidence is inconsistent with the class-specific resolution.',
            path: ['evidence'],
        });
    }
});
export function assertOperationSafetyResultMatchesPlan(planValue, resultValue) {
    const plan = operationSafetyPlanSchema.parse(planValue);
    const result = operationSafetyResultSchema.parse(resultValue);
    if (result.policyVersion !== plan.policyVersion || result.operationClass !== plan.operationClass ||
        result.operationId !== plan.operationId || result.canonicalRequestDigest !== plan.canonicalRequestDigest ||
        result.planDigest !== plan.planDigest) {
        throw new Error('Operation safety result does not match its canonical request and approved plan.');
    }
    if (plan.operationClass === 'export' && result.operationClass === 'export') {
        if (result.evidence.stagingPath !== plan.evidence.filesystemIdentity.staging.canonicalPath ||
            result.evidence.destinationPath !== plan.evidence.filesystemIdentity.destination.canonicalPath ||
            canonicalDigest(result.evidence.documentTransaction) !== canonicalDigest(plan.evidence.documentTransaction)) {
            throw new Error('Export result does not match the approved paths and document transaction binding.');
        }
        if (result.resolution.status === 'succeeded') {
            assertExportPublishAttestationBinding(plan, result.evidence.publishAttestation);
        }
        else if (result.evidence.publishAttestation !== null) {
            throw new Error('Export result cannot carry a publish attestation without a succeeded publication.');
        }
    }
    else if (plan.operationClass === 'update_existing' && result.operationClass === 'update_existing') {
        if (!sameUpdateTarget(plan.evidence, result.evidence) ||
            result.evidence.beforeStateHash !== plan.evidence.beforeStateHash ||
            (result.resolution.status === 'succeeded' &&
                result.evidence.afterStateHash !== plan.evidence.plannedAfterStateHash) ||
            (result.resolution.status === 'recovered' &&
                result.evidence.restoredStateHash !== plan.evidence.beforeStateHash)) {
            throw new Error('Update result does not match the approved target, after-state, or restored before-state.');
        }
    }
    else if (plan.operationClass === 'create_resource' && result.operationClass === 'create_resource') {
        const identity = result.evidence.resourceIdentity;
        if (identity !== null &&
            (!documentKeyMatches(plan.evidence.documentKey, identity.documentKey) ||
                identity.collectionKind !== plan.evidence.collectionKind ||
                identity.name !== plan.evidence.requestedName ||
                identity.resourceType !== plan.evidence.resourceType ||
                identity.definitionDigest !== plan.evidence.plannedDefinitionDigest ||
                identity.beforeSnapshotDigest !== plan.evidence.beforeSnapshotDigest ||
                canonicalDigest(identity.beforeSnapshotCounts) !== canonicalDigest(plan.evidence.beforeSnapshotCounts))) {
            throw new Error('Resource-create result does not match the approved document, resource, definition, or before snapshot. The resource may or may not have been created; list the document\'s resources (for example with illustrator_list_text_styles) before retrying.');
        }
    }
    else if (plan.operationClass === 'delete' && result.operationClass === 'delete') {
        if (result.evidence.targetSetHash !== plan.evidence.targetSetHash ||
            result.evidence.backupHandle !== plan.evidence.backupHandle) {
            throw new Error('Delete result does not match the approved target set and backup.');
        }
    }
    return { plan, result };
}
export async function assertOperationSafetyAdapterConformance(value, resolver, filesystemResolver) {
    const registration = operationSafetyRegistrationSchema.parse(value.registration);
    const plan = operationSafetyPlanSchema.parse(value.plan);
    if (registration.operationId !== plan.operationId || registration.policy.version !== plan.policyVersion ||
        registration.policy.class !== plan.operationClass || registration.capabilities.class !== plan.operationClass) {
        throw new Error('Operation safety adapter registration and plan do not describe the same policy.');
    }
    if (registration.policy.class === 'update_existing' && plan.operationClass === 'update_existing' &&
        registration.policy.evidence.identity !== updateTargetIdentity(plan.evidence)) {
        throw new Error('Update plan evidence shape does not match the registered target identity.');
    }
    if (plan.operationClass === 'export') {
        if (filesystemResolver === undefined) {
            throw new Error('Export safety conformance requires a trusted filesystem identity resolver.');
        }
        if (value.result === undefined) {
            await assertExportFilesystemIdentityPreflight(plan, filesystemResolver);
        }
    }
    if (plan.operationClass === 'export' && plan.evidence.documentTransaction.required) {
        const resolved = await resolver.resolve(plan.evidence.documentTransaction.attestation);
        const verified = terminalAttestationReferenceSchema.safeParse(resolved);
        if (!verified.success ||
            canonicalDigest(verified.data) !== canonicalDigest(plan.evidence.documentTransaction.attestation)) {
            throw new Error('Export document transaction attestation could not be durably resolved and verified.');
        }
    }
    if (value.result !== undefined) {
        const { result } = assertOperationSafetyResultMatchesPlan(plan, value.result);
        if (plan.operationClass === 'export' && result.operationClass === 'export' &&
            result.resolution.status === 'succeeded') {
            await assertExportPublishAttestationResolution(plan, result.evidence.publishAttestation, filesystemResolver);
        }
        if (!plan.applyAllowed && (result.resolution.status !== 'failed' ||
            result.resolution.proof.kind !== 'proven_pre_apply')) {
            throw new Error('A blocked safety plan can only produce a proven pre-apply failure.');
        }
        if (result.resolution.terminal) {
            if (result.attestation === null)
                throw new Error('Terminal operation result requires a durable attestation reference.');
            if (result.attestation.validatorIdentity !== registration.operationId ||
                result.attestation.operationId !== registration.operationId ||
                result.attestation.validatorVersion !== registration.policy.version ||
                !documentKeyMatches(result.attestation.documentKey, plan.evidence.documentKey)) {
                throw new Error('Terminal operation result attestation does not match the registered validator or approved document.');
            }
            const resolved = await resolver.resolve(result.attestation);
            const verified = terminalAttestationReferenceSchema.safeParse(resolved);
            if (!verified.success || canonicalDigest(verified.data) !== canonicalDigest(result.attestation)) {
                throw new Error('Terminal operation result attestation could not be durably resolved and verified.');
            }
        }
    }
}
async function assertExportFilesystemIdentityPreflight(plan, resolver) {
    const resolved = await resolver.resolvePreflight({
        destinationPath: plan.evidence.destinationPath,
        stagingPath: plan.evidence.stagingPath,
    });
    const verified = exportFilesystemIdentitySchema.safeParse(resolved);
    if (!verified.success || canonicalDigest(verified.data) !== canonicalDigest(plan.evidence.filesystemIdentity)) {
        throw new Error('Export preflight filesystem identity could not be trusted or changed before publish.');
    }
}
function assertExportPublishAttestationBinding(plan, value) {
    const verified = exportPublishAttestationSchema.safeParse(value);
    if (!verified.success) {
        throw new Error('Export publish attestation is missing or schema-invalid.');
    }
    const expectedFilesystemIdentityDigest = canonicalDigest(plan.evidence.filesystemIdentity);
    if (verified.data.operationId !== plan.operationId ||
        verified.data.planDigest !== plan.planDigest ||
        verified.data.canonicalRequestDigest !== plan.canonicalRequestDigest ||
        verified.data.filesystemIdentityDigest !== expectedFilesystemIdentityDigest ||
        verified.data.destinationPath !== plan.evidence.filesystemIdentity.destination.canonicalPath ||
        verified.data.stagingPath !== plan.evidence.filesystemIdentity.staging.canonicalPath ||
        verified.data.checkedPhase !== 'pre_publish') {
        throw new Error('Export publish attestation does not match the approved operation, plan, request, filesystem snapshot, or paths.');
    }
    return verified.data;
}
async function assertExportPublishAttestationResolution(plan, value, resolver) {
    const expected = assertExportPublishAttestationBinding(plan, value);
    const resolved = await resolver.resolvePublishAttestation(expected);
    const verified = exportPublishAttestationSchema.safeParse(resolved);
    if (!verified.success || canonicalDigest(verified.data) !== canonicalDigest(expected)) {
        throw new Error('Export publish attestation could not be durably resolved and verified.');
    }
}
export async function assertExportFilesystemIdentityReadyForPublish(planValue, resolver) {
    const plan = operationSafetyPlanSchema.parse(planValue);
    if (plan.operationClass !== 'export')
        throw new Error('Filesystem publication verification requires an export plan.');
    if (!plan.applyAllowed)
        throw new Error('Filesystem publication verification requires an apply-allowed export plan.');
    const attestation = await resolver.revalidateAndIssuePublishAttestation({
        operationId: plan.operationId,
        planDigest: plan.planDigest,
        canonicalRequestDigest: plan.canonicalRequestDigest,
        destinationPath: plan.evidence.destinationPath,
        stagingPath: plan.evidence.stagingPath,
        approvedFilesystemIdentity: plan.evidence.filesystemIdentity,
    });
    if (attestation === null) {
        throw new Error('Export pre_publish filesystem identity changed before publish or attestation issuance failed.');
    }
    return assertExportPublishAttestationBinding(plan, attestation);
}
export function operationSafetyPolicyToMcpAnnotations(policy) {
    switch (policy.class) {
        case 'create':
        case 'create_resource':
        case 'update_existing':
            return { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
        case 'delete':
            return { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
        case 'export':
            return { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
    }
}
export class OperationSafetyRegistry {
    #registrations = new Map();
    register(value) {
        const registration = structuredClone(operationSafetyRegistrationSchema.parse(value));
        if (this.#registrations.has(registration.operationId)) {
            throw new Error(`Operation safety policy is already registered for ${registration.operationId}.`);
        }
        const identity = canonicalDigest(registration);
        this.#registrations.set(registration.operationId, { registration, identity });
        return { registration: structuredClone(registration), registrationIdentity: identity };
    }
    assertApplyReady(operationId, expected) {
        const stored = this.#registrations.get(operationId);
        if (!stored)
            throw new Error(`Operation safety policy is not registered for ${operationId}.`);
        const registration = operationSafetyRegistrationSchema.parse(stored.registration);
        const currentIdentity = canonicalDigest(registration);
        if (registration.policy.version !== expected.version) {
            throw new Error(`Unsupported operation safety policy version for ${operationId}.`);
        }
        if (registration.policy.class !== expected.class) {
            throw new Error(`Unexpected operation safety class for ${operationId}.`);
        }
        if (stored.identity !== currentIdentity || expected.registrationIdentity !== currentIdentity) {
            throw new Error(`Operation safety registration identity mismatch for ${operationId}.`);
        }
        return structuredClone(registration);
    }
}
