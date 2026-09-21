import { z } from 'zod';
import { canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
export const SET_PATH_APPEARANCE_OPERATION = 'set_path_appearance';
export const SET_PATH_APPEARANCE_VALIDATOR = { kind: SET_PATH_APPEARANCE_OPERATION, version: 1 };
const SET_PATH_APPEARANCE_CANONICAL_VERSION = 6;
const SET_PATH_APPEARANCE_RESULT_SCHEMA_VERSION = 7;
const SET_PATH_APPEARANCE_CLASSIFIER_VERSION = 1;
const SET_PATH_APPEARANCE_CONFORMANCE_VERSION = 1;
const SET_PATH_APPEARANCE_ERROR_MAPPING_VERSION = 1;
const canonicalFiveDecimals = (value) => {
    const rounded = Math.round(value * 100_000) / 100_000;
    return Object.is(rounded, -0) ? 0 : rounded;
};
const rgbColorSchema = z.strictObject({
    model: z.literal('rgb'),
    red: z.number().finite().min(0).max(255).overwrite(canonicalFiveDecimals),
    green: z.number().finite().min(0).max(255).overwrite(canonicalFiveDecimals),
    blue: z.number().finite().min(0).max(255).overwrite(canonicalFiveDecimals),
});
const cmykColorSchema = z.strictObject({
    model: z.literal('cmyk'),
    cyan: z.number().finite().min(0).max(100).overwrite(canonicalFiveDecimals),
    magenta: z.number().finite().min(0).max(100).overwrite(canonicalFiveDecimals),
    yellow: z.number().finite().min(0).max(100).overwrite(canonicalFiveDecimals),
    black: z.number().finite().min(0).max(100).overwrite(canonicalFiveDecimals),
});
const grayColorSchema = z.strictObject({
    model: z.literal('gray'),
    gray: z.number().finite().min(0).max(100).overwrite(canonicalFiveDecimals),
});
const explicitProcessColorSchema = z.discriminatedUnion('model', [
    rgbColorSchema,
    cmykColorSchema,
    grayColorSchema,
]);
const spotTintSchema = z.number().finite().min(0).max(100)
    .overwrite(canonicalFiveDecimals);
const spotColorSchema = z.strictObject({
    model: z.literal('spot'),
    name: z.string().min(1).max(255),
    tint: spotTintSchema,
    baseColor: explicitProcessColorSchema,
});
const gradientAngleSchema = z.number().finite().min(-180).max(180).overwrite((value) => {
    const normalized = ((value + 180) % 360 + 360) % 360 - 180;
    const rounded = Math.round(normalized * 100_000) / 100_000;
    return Object.is(rounded, -0) ? 0 : rounded;
});
const gradientStopColorSchema = z.discriminatedUnion('model', [
    rgbColorSchema,
    cmykColorSchema,
    grayColorSchema,
    spotColorSchema,
]);
const gradientStopSchema = z.strictObject({
    rampPoint: z.number().finite().min(0).max(100).overwrite(canonicalFiveDecimals),
    midPoint: z.number().finite().min(13).max(87).overwrite(canonicalFiveDecimals),
    opacity: z.number().finite().min(0).max(100).overwrite(canonicalFiveDecimals),
    color: gradientStopColorSchema,
});
const gradientColorSchema = z.strictObject({
    model: z.literal('gradient'),
    name: z.string().min(1).max(255),
    type: z.literal('linear'),
    angle: gradientAngleSchema,
    stops: z.array(gradientStopSchema).min(2).max(32),
});
export const explicitAppearanceColorSchema = z.discriminatedUnion('model', [
    rgbColorSchema,
    cmykColorSchema,
    grayColorSchema,
    spotColorSchema,
    gradientColorSchema,
]);
const appearanceStateColorSchema = z.discriminatedUnion('model', [
    z.strictObject({ model: z.literal('none') }),
    rgbColorSchema,
    cmykColorSchema,
    grayColorSchema,
    spotColorSchema,
    gradientColorSchema,
]);
export const pathAppearanceMutationSchema = z.strictObject({
    opacity: z.number().finite().min(0).max(100),
    fill: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('none') }),
        z.strictObject({ kind: z.literal('solid'), color: explicitAppearanceColorSchema }),
    ]),
    stroke: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('none') }),
        z.strictObject({
            kind: z.literal('solid'),
            color: explicitAppearanceColorSchema,
            width: z.number().finite().positive().max(10_000),
        }),
    ]),
});
export const pathAppearanceStateSchema = z.strictObject({
    opacity: z.number().finite().min(0).max(100),
    fill: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('none'), color: appearanceStateColorSchema }),
        z.strictObject({ kind: z.literal('solid'), color: explicitAppearanceColorSchema }),
    ]),
    stroke: z.discriminatedUnion('kind', [
        z.strictObject({
            kind: z.literal('none'),
            color: appearanceStateColorSchema,
            width: z.number().finite().min(0).max(10_000),
        }),
        z.strictObject({
            kind: z.literal('solid'),
            color: explicitAppearanceColorSchema,
            width: z.number().finite().positive().max(10_000),
        }),
    ]),
});
const commonInternalFields = {
    expectedDocumentKey: z.string().min(1).max(16_384),
    targetUuid: z.string().min(1).max(255),
    appearance: pathAppearanceMutationSchema,
};
const boundPreviewRequestSchema = z.strictObject({
    expectedDocumentBindingKey: z.string().min(1).max(16_384),
    artboardIndex: z.number().int().nonnegative(),
    scalePercent: z.number().finite().min(1).max(100),
    stagingBasePath: z.string().min(1).max(16_384),
    stagingPath: z.string().min(1).max(16_384),
});
const setPathAppearanceInternalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternalFields, apply: z.literal(false) }),
    z.strictObject({
        ...commonInternalFields,
        expectedBefore: pathAppearanceStateSchema,
        confirmedAfter: pathAppearanceStateSchema,
        apply: z.literal(true),
        commandId: canonicalCommandIdSchema,
        boundPreview: boundPreviewRequestSchema.optional(),
    }),
]);
const commonPublicFields = {
    expected_document_key: z.string().min(1).max(16_384),
    target_uuid: z.string().min(1).max(255),
    appearance: pathAppearanceMutationSchema,
};
export const setPathAppearancePublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublicFields, apply: z.literal(false).default(false) }),
    z.strictObject({
        ...commonPublicFields,
        expected_before: pathAppearanceStateSchema,
        confirmed_after: pathAppearanceStateSchema,
        apply: z.literal(true),
        command_id: canonicalCommandIdSchema,
    }),
]);
const setPathAppearanceInputSchema = z.strictObject({
    ...commonPublicFields,
    expected_before: pathAppearanceStateSchema.optional(),
    confirmed_after: pathAppearanceStateSchema.optional(),
    apply: z.boolean().default(false),
    command_id: canonicalCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(setPathAppearancePublicInputSchema, { io: 'input' });
setPathAppearanceInputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = setPathAppearancePublicInputSchema.parse(input);
    const common = {
        expectedDocumentKey: value.expected_document_key,
        targetUuid: value.target_uuid,
        appearance: value.appearance,
    };
    return value.apply
        ? {
            ...common,
            expectedBefore: value.expected_before,
            confirmedAfter: value.confirmed_after,
            apply: true,
            commandId: value.command_id,
        }
        : { ...common, apply: false };
}
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']),
    reasonCode: z.enum(['apply_failed', 'verify_mismatch']),
    message: z.string().min(1).max(500),
});
const indeterminateFailureSchema = z.strictObject({
    phase: z.literal('apply'),
    reasonCode: z.literal('apply_indeterminate'),
    message: z.string().min(1).max(500),
});
const rollbackEvidenceFields = {
    targetUuid: z.string().min(1).max(255),
    restoredAppearance: pathAppearanceStateSchema.nullable(),
};
const appearanceTransactionSchema = z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('planned'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('verified'), audit: mutationAuditSchema }),
    z.strictObject({
        state: z.literal('apply_failed'),
        failure: failureSchema,
        rollback: z.strictObject({ status: z.literal('not_required') }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rolled_back'),
        failure: failureSchema,
        rollback: z.strictObject({ status: z.literal('verified'), ...rollbackEvidenceFields }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rollback_failed'),
        failure: failureSchema,
        rollback: z.strictObject({
            status: z.literal('failed'),
            reasonCode: z.literal('rollback_failed'),
            message: z.string().min(1).max(500),
            ...rollbackEvidenceFields,
        }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('apply_indeterminate'),
        failure: indeterminateFailureSchema,
        rollback: z.strictObject({
            status: z.literal('indeterminate'),
            reasonCode: z.string().min(1).max(100),
            message: z.string().min(1).max(500),
            targetUuid: z.string().min(1).max(255),
            restoredAppearance: z.null(),
        }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rollback_indeterminate'),
        failure: failureSchema,
        rollback: z.strictObject({
            status: z.literal('indeterminate'),
            reasonCode: z.literal('rollback_indeterminate'),
            message: z.string().min(1).max(500),
            ...rollbackEvidenceFields,
        }),
        audit: mutationAuditSchema,
    }),
]).superRefine((transaction, context) => {
    const compact = transaction.audit.map((event) => [
        event.phase,
        event.event,
        'reasonCode' in event ? event.reasonCode : null,
    ]);
    const prefix = [
        ['preflight', 'started', null],
        ['preflight', 'succeeded', null],
        ['plan', 'started', null],
        ['plan', 'succeeded', null],
    ];
    let expected;
    if (transaction.state === 'planned') {
        expected = [...prefix,
            ['apply', 'skipped', 'not_requested'],
            ['verify', 'skipped', 'not_requested'],
            ['rollback', 'skipped', 'not_requested']];
    }
    else if (transaction.state === 'verified') {
        expected = [...prefix,
            ['apply', 'started', null], ['apply', 'attempted', null], ['apply', 'succeeded', null],
            ['verify', 'started', null], ['verify', 'succeeded', null],
            ['rollback', 'skipped', 'not_required']];
    }
    else if (transaction.state === 'apply_failed') {
        expected = [...prefix,
            ['apply', 'started', null], ['apply', 'failed', 'apply_failed'],
            ['verify', 'skipped', 'not_required'], ['rollback', 'skipped', 'not_required']];
    }
    else if (transaction.state === 'apply_indeterminate') {
        expected = [...prefix,
            ['apply', 'started', null], ['apply', 'attempted', null], ['apply', 'failed', 'apply_indeterminate']];
    }
    else {
        const failurePath = transaction.failure.phase === 'apply'
            ? [
                ['apply', 'started', null], ['apply', 'attempted', null], ['apply', 'failed', 'apply_failed'],
                ['verify', 'skipped', 'not_required'],
            ]
            : [
                ['apply', 'started', null], ['apply', 'attempted', null], ['apply', 'succeeded', null],
                ['verify', 'started', null], ['verify', 'failed', 'verify_mismatch'],
            ];
        expected = [...prefix, ...failurePath, ['rollback', 'started', null],
            transaction.state === 'rolled_back'
                ? ['rollback', 'succeeded', null]
                : ['rollback', 'failed', transaction.state === 'rollback_failed' ? 'rollback_failed' : 'rollback_indeterminate']];
    }
    if (compact.length !== expected.length || compact.some((event, index) => event[0] !== expected[index]?.[0] || event[1] !== expected[index]?.[1] || event[2] !== expected[index]?.[2])) {
        context.addIssue({ code: 'custom', message: 'Appearance transaction audit does not match its state.', path: ['audit'] });
    }
    for (let index = 0; index < transaction.audit.length; index++) {
        if (transaction.audit[index]?.sequence !== index) {
            context.addIssue({ code: 'custom', message: 'Appearance audit sequence must be contiguous.', path: ['audit', index] });
        }
    }
    if ('failure' in transaction) {
        const failure = transaction.audit.filter((event) => event.event === 'failed' &&
            event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode);
        if (failure.length !== 1 || failure[0]?.event !== 'failed' || failure[0].message !== transaction.failure.message) {
            context.addIssue({ code: 'custom', message: 'Appearance failure summary must match its audit event.', path: ['failure'] });
        }
    }
});
const appearancePlanSchema = z.strictObject({
    targetUuid: z.string().min(1).max(255),
    before: pathAppearanceStateSchema,
    after: pathAppearanceStateSchema,
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
});
const appearancePostconditionSchema = z.strictObject({
    targetUuid: z.string().min(1).max(255),
    appearance: pathAppearanceStateSchema,
});
export const boundAppearancePreviewResultSchema = z.strictObject({
    binding: z.strictObject({
        kind: z.literal('same_bridge_execution_native_reference_v1'),
        targetUuid: z.string().min(1).max(255),
        documentReferenceStable: z.literal(true),
        pageItemReferenceStable: z.literal(true),
    }),
    documentBefore: documentContextSchema,
    documentAfter: documentContextSchema,
    appearanceBefore: appearancePostconditionSchema,
    appearanceAfter: appearancePostconditionSchema,
    artboardIndex: z.number().int().nonnegative(),
    scalePercent: z.number().finite().min(1).max(100),
    stagingPath: z.string().min(1).max(16_384),
    size: z.number().int().positive(),
}).superRefine((value, context) => {
    const documentBinding = (document) => ({
        keyVersion: document.keyVersion,
        bindingKey: document.key.replace(/\|saved=(?:true|false)\|/, '|saved=*|'),
        name: document.name,
        path: document.path,
        fileRevision: document.fileRevision,
        colorSpace: document.colorSpace,
        activeArtboardIndex: document.activeArtboardIndex,
        activeArtboardBounds: document.activeArtboardBounds,
        artboardCount: document.artboardCount,
        appVersion: document.appVersion,
    });
    if (canonicalSha256(documentBinding(value.documentBefore)) !==
        canonicalSha256(documentBinding(value.documentAfter))) {
        context.addIssue({ code: 'custom', message: 'Bound preview must preserve the nonvolatile document binding.' });
    }
    if (canonicalSha256(value.appearanceBefore) !==
        canonicalSha256(value.appearanceAfter)) {
        context.addIssue({ code: 'custom', message: 'Bound preview must preserve the verified appearance.' });
    }
});
export const setPathAppearanceResultSchema = z.union([
    z.strictObject({
        operation: z.literal(SET_PATH_APPEARANCE_OPERATION),
        applied: z.literal(false),
        document: documentContextSchema,
        plan: appearancePlanSchema,
        transaction: appearanceTransactionSchema,
    }),
    z.strictObject({
        operation: z.literal(SET_PATH_APPEARANCE_OPERATION),
        applied: z.literal(true),
        document: documentContextSchema,
        plan: appearancePlanSchema,
        postcondition: appearancePostconditionSchema,
        boundPreview: boundAppearancePreviewResultSchema.optional(),
        transaction: appearanceTransactionSchema,
    }),
]).superRefine((result, context) => {
    if (result.applied) {
        if (result.transaction.state !== 'verified') {
            context.addIssue({ code: 'custom', message: 'Applied appearance requires a verified transaction.' });
        }
        if (result.postcondition.targetUuid !== result.plan.targetUuid ||
            canonicalSha256(result.postcondition.appearance) !==
                canonicalSha256(result.plan.after)) {
            context.addIssue({
                code: 'custom',
                message: 'Appearance postcondition must exactly match the planned UUID and appearance.',
                path: ['postcondition'],
            });
        }
        if (result.boundPreview !== undefined) {
            const postconditionDigest = canonicalSha256(result.postcondition);
            if (result.boundPreview.binding.targetUuid !== result.plan.targetUuid ||
                canonicalSha256(result.boundPreview.appearanceBefore) !== postconditionDigest ||
                canonicalSha256(result.boundPreview.appearanceAfter) !== postconditionDigest) {
                context.addIssue({
                    code: 'custom',
                    message: 'Bound preview appearance evidence must exactly match the verified plan and postcondition.',
                    path: ['boundPreview'],
                });
            }
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified appearance transaction must be applied.' });
    }
});
const finalizedAtSchema = z.string().datetime({ offset: true });
export const setPathAppearanceResponseSchema = z.strictObject({
    outcome: setPathAppearanceResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: finalizedAtSchema }),
});
export const SET_PATH_APPEARANCE_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: SET_PATH_APPEARANCE_OPERATION,
    policy: {
        version: 1,
        class: 'update_existing',
        destructive: false,
        evidence: {
            identity: 'target_native_uuid',
            beforeState: 'before_state_hash',
            postcondition: 'updated_state_matches_plan',
        },
        preconditions: {
            documentBinding: 'explicit_document_key',
            compareAndSet: 'before_state_hash_match',
        },
        confirmation: 'exact_change_set',
        recovery: {
            mode: 'verified_inverse',
            verification: 'restored_state_matches_before_hash',
            partialRecovery: 'indeterminate',
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
        class: 'update_existing',
        explicitDocumentBinding: true,
        bindTargetNativeUuid: true,
        captureBeforeStateHash: true,
        compareAndSetBeforeApply: true,
        verifyUpdatedState: true,
        recoveryMode: 'verified_inverse',
        verifyRestoredBeforeState: true,
        reconcileIndeterminate: true,
        durableTerminalReplay: true,
        trustedTerminalAttestationResolver: true,
    },
});
export const SET_PATH_APPEARANCE_SAFETY_IDENTITY = canonicalDigest(SET_PATH_APPEARANCE_SAFETY);
function appearanceSafetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    const beforeStateHash = canonicalDigest(result.plan.before);
    const afterStateHash = canonicalDigest(result.plan.after);
    const changeSetHash = canonicalDigest({
        targetUuid: result.plan.targetUuid,
        before: result.plan.before,
        after: result.plan.after,
    });
    return bindOperationSafetyPlan({
        policyVersion: 1,
        operationClass: 'update_existing',
        operationId: SET_PATH_APPEARANCE_OPERATION,
        canonicalRequestDigest: requestDigest,
        evidence: {
            documentKey: admissionDocumentKey,
            targetUuid: result.plan.targetUuid,
            beforeStateHash,
            plannedAfterStateHash: afterStateHash,
            plannedChangeSetDigest: changeSetHash,
        },
        preconditions: {
            status: result.plan.applyAllowed ? 'satisfied' : 'blocked',
            compareAndSetMatched: result.plan.applyAllowed,
        },
        confirmation: {
            kind: 'exact_change_set',
            canonicalRequestDigest: requestDigest,
            changeSetHash,
            status: result.plan.confirmationStatus,
        },
        applyAllowed: result.plan.applyAllowed,
    });
}
function appearanceSafetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' ||
        transaction.state === 'rollback_indeterminate' || transaction.state === 'rollback_failed') {
        throw new Error('Indeterminate or failed recovery cannot be represented as a terminal appearance result.');
    }
    const common = {
        policyVersion: 1,
        operationClass: 'update_existing',
        operationId: SET_PATH_APPEARANCE_OPERATION,
        canonicalRequestDigest: requestDigest,
        planDigest: plan.planDigest,
        attestation,
    };
    const beforeStateHash = canonicalDigest(result.plan.before);
    if (transaction.state === 'verified' && result.applied) {
        return operationSafetyResultSchema.parse({
            ...common,
            evidence: {
                targetUuid: result.plan.targetUuid,
                beforeStateHash,
                afterStateHash: canonicalDigest(result.postcondition.appearance),
                restoredStateHash: null,
                restoredBeforeStateVerified: false,
            },
            executionEvidence: { outcome: 'completed' },
            resolution: {
                status: 'succeeded', terminal: true, recovery: 'not_required',
                proof: { kind: 'verified_postcondition' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false },
            },
        });
    }
    if (transaction.state === 'rolled_back') {
        return operationSafetyResultSchema.parse({
            ...common,
            evidence: {
                targetUuid: result.plan.targetUuid,
                beforeStateHash,
                afterStateHash: null,
                restoredStateHash: canonicalDigest(transaction.rollback.restoredAppearance),
                restoredBeforeStateVerified: canonicalDigest(transaction.rollback.restoredAppearance) === beforeStateHash,
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
        ...common,
        evidence: {
            targetUuid: result.plan.targetUuid,
            beforeStateHash,
            afterStateHash: null,
            restoredStateHash: null,
            restoredBeforeStateVerified: false,
        },
        executionEvidence: { outcome: 'proven_pre_apply' },
        resolution: {
            status: 'failed', terminal: true, recovery: 'not_required',
            proof: { kind: 'proven_pre_apply', mutationAttempted: false },
            replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false },
        },
    });
}
async function assertAppearanceSafetyConformance(value, requestDigest, attestation, resolver) {
    const result = setPathAppearanceResultSchema.parse(value);
    const plan = appearanceSafetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null) {
        throw new Error('Appearance terminal result requires a durable attestation resolver.');
    }
    await assertOperationSafetyAdapterConformance({
        registration: SET_PATH_APPEARANCE_SAFETY,
        plan,
        result: appearanceSafetyResult(result, requestDigest, attestation, plan),
    }, resolver);
}
export const SET_PATH_APPEARANCE_MODULE_SCRIPT = `
function appearanceFindTarget(document, uuid) {
  for (var index = 0; index < document.pageItems.length; index++) {
    var candidate = document.pageItems[index];
    if (typeof candidate.uuid === "string" && candidate.uuid === uuid) return candidate;
  }
  return null;
}

function appearanceNumber(value, name, minimum, maximum) {
  var number = mutationFiniteNumber(value, name);
  if (number < minimum || number > maximum) throw mutationError("preflight_failed", name + " is outside the supported range.");
  return Number(number);
}

function appearanceCanonicalColorNumber(value, name, minimum, maximum) {
  var rounded = Math.round(appearanceNumber(value, name, minimum, maximum) * 100000) / 100000;
  return rounded === 0 ? 0 : rounded;
}

function appearanceCanonicalTint(value) {
  return appearanceCanonicalColorNumber(value, "tint", 0, 100);
}

function appearanceCanonicalAngle(value) {
  var angle = appearanceNumber(value, "gradient.angle", -180, 180);
  var normalized = ((angle + 180) % 360 + 360) % 360 - 180;
  var rounded = Math.round(normalized * 100000) / 100000;
  return rounded === 0 ? 0 : rounded;
}

function appearanceReadProcessColor(color) {
  if (!color || typeof color.typename !== "string") throw mutationError("preflight_failed", "Target color is unavailable.");
  if (color.typename === "RGBColor") return {
    model: "rgb", red: appearanceCanonicalColorNumber(color.red, "red", 0, 255),
    green: appearanceCanonicalColorNumber(color.green, "green", 0, 255),
    blue: appearanceCanonicalColorNumber(color.blue, "blue", 0, 255)
  };
  if (color.typename === "CMYKColor") return {
    model: "cmyk", cyan: appearanceCanonicalColorNumber(color.cyan, "cyan", 0, 100),
    magenta: appearanceCanonicalColorNumber(color.magenta, "magenta", 0, 100),
    yellow: appearanceCanonicalColorNumber(color.yellow, "yellow", 0, 100),
    black: appearanceCanonicalColorNumber(color.black, "black", 0, 100)
  };
  if (color.typename === "GrayColor") return {
    model: "gray", gray: appearanceCanonicalColorNumber(color.gray, "gray", 0, 100)
  };
  throw mutationError("preflight_failed", "Spot base color must be explicit RGB, CMYK, or Gray.");
}

function appearanceReadExplicitColor(color) {
  if (!color || typeof color.typename !== "string") throw mutationError("preflight_failed", "Target color is unavailable.");
  if (color.typename === "RGBColor" || color.typename === "CMYKColor" || color.typename === "GrayColor") {
    return appearanceReadProcessColor(color);
  }
  if (color.typename === "SpotColor") {
    if (!color.spot || color.spot.typename !== "Spot" || String(color.spot.colorType) !== "ColorModel.SPOT") {
      throw mutationError("preflight_failed", "Only an existing ColorModel.SPOT resource is supported.");
    }
    return {
      model: "spot",
      name: String(color.spot.name),
      tint: appearanceCanonicalTint(color.tint),
      baseColor: appearanceReadProcessColor(color.spot.color)
    };
  }
  throw mutationError("preflight_failed", "Gradient stops support only explicit RGB, CMYK, Gray, and existing Spot colors.");
}

function appearanceReadGradientDefinition(gradient) {
  if (!gradient || gradient.typename !== "Gradient" || typeof gradient.name !== "string" || gradient.name.length === 0) {
    throw mutationError("preflight_failed", "Gradient resource identity is unavailable.");
  }
  if (String(gradient.type) !== "GradientType.LINEAR") {
    throw mutationError("preflight_failed", "Only existing linear Gradient resources are supported.");
  }
  if (!gradient.gradientStops || gradient.gradientStops.length < 2 || gradient.gradientStops.length > 32) {
    throw mutationError("preflight_failed", "Gradient stop count is outside the supported range.");
  }
  var stops = [];
  for (var index = 0; index < gradient.gradientStops.length; index++) {
    var stop = gradient.gradientStops[index];
    stops.push({
      rampPoint: appearanceCanonicalColorNumber(stop.rampPoint, "gradient.stop.rampPoint", 0, 100),
      midPoint: appearanceCanonicalColorNumber(stop.midPoint, "gradient.stop.midPoint", 13, 87),
      opacity: appearanceCanonicalColorNumber(stop.opacity, "gradient.stop.opacity", 0, 100),
      color: appearanceReadExplicitColor(stop.color)
    });
  }
  return { name: String(gradient.name), type: "linear", stops: stops };
}

function appearanceReadGradientAngle(color) {
  if (!color.matrix) throw mutationError("preflight_failed", "Gradient matrix is unavailable.");
  var a = mutationFiniteNumber(color.matrix.mValueA, "gradient.matrix.a");
  var b = mutationFiniteNumber(color.matrix.mValueB, "gradient.matrix.b");
  if (a === 0 && b === 0) throw mutationError("preflight_failed", "Gradient matrix angle is indeterminate.");
  return appearanceCanonicalAngle(Math.atan2(b, a) * 180 / Math.PI);
}

function appearanceReadColor(color) {
  if (!color || typeof color.typename !== "string") throw mutationError("preflight_failed", "Target color is unavailable.");
  if (color.typename === "NoColor") return { model: "none" };
  if (color.typename === "RGBColor" || color.typename === "CMYKColor" || color.typename === "GrayColor" ||
      color.typename === "SpotColor") return appearanceReadExplicitColor(color);
  if (color.typename === "GradientColor") {
    var definition = appearanceReadGradientDefinition(color.gradient);
    return {
      model: "gradient", name: definition.name, type: definition.type,
      angle: appearanceReadGradientAngle(color), stops: definition.stops
    };
  }
  throw mutationError("preflight_failed", "Only explicit RGB, CMYK, Gray, existing Spot, and existing linear Gradient colors are supported by this recipe version.");
}

function appearanceRead(item) {
  if (typeof item.filled !== "boolean" || typeof item.stroked !== "boolean") {
    throw mutationError("preflight_failed", "Path paint enablement is unavailable.");
  }
  return {
    opacity: appearanceNumber(item.opacity, "opacity", 0, 100),
    fill: item.filled
      ? { kind: "solid", color: appearanceReadColor(item.fillColor) }
      : { kind: "none", color: appearanceReadColor(item.fillColor) },
    stroke: item.stroked ? {
      kind: "solid", color: appearanceReadColor(item.strokeColor),
      width: appearanceNumber(item.strokeWidth, "strokeWidth", 0.000001, 10000)
    } : {
      kind: "none", color: appearanceReadColor(item.strokeColor),
      width: appearanceNumber(item.strokeWidth, "strokeWidth", 0, 10000)
    }
  };
}

function appearanceColorMismatch(left, right, path) {
  if (!left || !right) return path;
  if (left.model !== right.model) return path + ".model";
  if (left.model === "none") return null;
  if (left.model === "rgb") {
    if (appearanceCanonicalColorNumber(left.red, path + ".red", 0, 255) !==
        appearanceCanonicalColorNumber(right.red, path + ".red", 0, 255)) return path + ".red";
    if (appearanceCanonicalColorNumber(left.green, path + ".green", 0, 255) !==
        appearanceCanonicalColorNumber(right.green, path + ".green", 0, 255)) return path + ".green";
    if (appearanceCanonicalColorNumber(left.blue, path + ".blue", 0, 255) !==
        appearanceCanonicalColorNumber(right.blue, path + ".blue", 0, 255)) return path + ".blue";
    return null;
  }
  if (left.model === "cmyk") {
    if (appearanceCanonicalColorNumber(left.cyan, path + ".cyan", 0, 100) !==
        appearanceCanonicalColorNumber(right.cyan, path + ".cyan", 0, 100)) return path + ".cyan";
    if (appearanceCanonicalColorNumber(left.magenta, path + ".magenta", 0, 100) !==
        appearanceCanonicalColorNumber(right.magenta, path + ".magenta", 0, 100)) return path + ".magenta";
    if (appearanceCanonicalColorNumber(left.yellow, path + ".yellow", 0, 100) !==
        appearanceCanonicalColorNumber(right.yellow, path + ".yellow", 0, 100)) return path + ".yellow";
    if (appearanceCanonicalColorNumber(left.black, path + ".black", 0, 100) !==
        appearanceCanonicalColorNumber(right.black, path + ".black", 0, 100)) return path + ".black";
    return null;
  }
  if (left.model === "gray") return appearanceCanonicalColorNumber(left.gray, path + ".gray", 0, 100) ===
    appearanceCanonicalColorNumber(right.gray, path + ".gray", 0, 100) ? null : path + ".gray";
  if (left.model === "spot") {
    if (left.name !== right.name) return path + ".name";
    if (appearanceCanonicalTint(left.tint) !== appearanceCanonicalTint(right.tint)) return path + ".tint";
    return appearanceColorMismatch(left.baseColor, right.baseColor, path + ".baseColor");
  }
  if (left.model === "gradient") {
    if (left.name !== right.name) return path + ".name";
    if (left.type !== right.type) return path + ".type";
    if (appearanceCanonicalAngle(left.angle) !== appearanceCanonicalAngle(right.angle)) return path + ".angle";
    if (!left.stops || !right.stops) return path + ".stops";
    if (left.stops.length !== right.stops.length) return path + ".stops.length";
    for (var index = 0; index < left.stops.length; index++) {
      var leftStop = left.stops[index];
      var rightStop = right.stops[index];
      var stopPath = path + ".stops[" + index + "]";
      if (!leftStop || !rightStop) return stopPath;
      if (appearanceCanonicalColorNumber(leftStop.rampPoint, stopPath + ".rampPoint", 0, 100) !==
          appearanceCanonicalColorNumber(rightStop.rampPoint, stopPath + ".rampPoint", 0, 100)) return stopPath + ".rampPoint";
      if (appearanceCanonicalColorNumber(leftStop.midPoint, stopPath + ".midPoint", 13, 87) !==
          appearanceCanonicalColorNumber(rightStop.midPoint, stopPath + ".midPoint", 13, 87)) return stopPath + ".midPoint";
      if (appearanceCanonicalColorNumber(leftStop.opacity, stopPath + ".opacity", 0, 100) !==
          appearanceCanonicalColorNumber(rightStop.opacity, stopPath + ".opacity", 0, 100)) return stopPath + ".opacity";
      var colorMismatch = appearanceColorMismatch(leftStop.color, rightStop.color, stopPath + ".color");
      if (colorMismatch !== null) return colorMismatch;
    }
    return null;
  }
  return path + ".model";
}

function appearanceColorEqual(left, right) {
  return appearanceColorMismatch(left, right, "color") === null;
}

function appearancePaintEqual(left, right, stroke) {
  if (!left || !right || left.kind !== right.kind) return false;
  if (!appearanceColorEqual(left.color, right.color)) return false;
  return !stroke || left.width === right.width;
}

function appearanceEqual(left, right) {
  return !!left && !!right && left.opacity === right.opacity &&
    appearancePaintEqual(left.fill, right.fill, false) && appearancePaintEqual(left.stroke, right.stroke, true);
}

/** The first differing field, so a verification failure names what moved (the comparison is appearanceEqual). */
function appearanceMismatch(left, right) {
  if (!left || !right) return "appearance";
  if (left.opacity !== right.opacity) return "opacity";
  var parts = ["fill", "stroke"];
  for (var index = 0; index < parts.length; index++) {
    var name = parts[index];
    if (!left[name] || !right[name]) return name;
    if (left[name].kind !== right[name].kind) return name + ".kind";
    var colorMismatch = appearanceColorMismatch(left[name].color, right[name].color, name + ".color");
    if (colorMismatch !== null) return colorMismatch;
    if (name === "stroke" && left.stroke.width !== right.stroke.width) return "stroke.width";
  }
  return null;
}

function appearanceAssertColorCompatible(color, documentColorSpace) {
  if (color.model === "gradient") {
    for (var index = 0; index < color.stops.length; index++) {
      appearanceAssertColorCompatible(color.stops[index].color, documentColorSpace);
    }
    return;
  }
  if (color.model === "spot") {
    if (color.baseColor.model === "gray") {
      throw mutationError("preflight_failed", "Gray-base Spot is outside the measured compatibility profile.");
    }
    appearanceAssertColorCompatible(color.baseColor, documentColorSpace);
    return;
  }
  if (color.model === "gray") return;
  if (color.model === "rgb" && documentColorSpace === "RGB") return;
  if (color.model === "cmyk" && documentColorSpace === "CMYK") return;
  throw mutationError("preflight_failed", "Explicit color model does not match the document color space; implicit conversion is forbidden.");
}

function appearanceFindSpot(document, name) {
  var match = null;
  for (var index = 0; index < document.spots.length; index++) {
    var candidate = document.spots[index];
    var candidateName = null;
    try { candidateName = String(candidate.name); } catch (error) { continue; }
    if (candidateName !== name) continue;
    if (match !== null) throw mutationError("preflight_failed", "Spot name does not resolve uniquely.");
    match = candidate;
  }
  return match;
}

function appearanceResolveSpot(document, value, phase) {
  if (!value || value.model !== "spot" || typeof value.name !== "string" || value.name.length === 0) {
    throw mutationError(phase, "Spot identity is incomplete.");
  }
  appearanceCanonicalTint(value.tint);
  appearanceAssertColorCompatible(value.baseColor, document.documentColorSpace === DocumentColorSpace.RGB ? "RGB" : "CMYK");
  var spot = appearanceFindSpot(document, value.name);
  if (spot === null || spot.typename !== "Spot" || String(spot.colorType) !== "ColorModel.SPOT") {
    throw mutationError(phase, "Requested existing ColorModel.SPOT resource was not found.");
  }
  var actualBaseColor = appearanceReadProcessColor(spot.color);
  if (!appearanceColorEqual(actualBaseColor, value.baseColor)) {
    throw mutationError(phase, "Existing Spot base color does not match the explicit request.");
  }
  return spot;
}

function appearanceFindGradient(document, name) {
  var match = null;
  for (var index = 0; index < document.gradients.length; index++) {
    var candidate = document.gradients[index];
    var candidateName = null;
    try { candidateName = String(candidate.name); } catch (error) { continue; }
    if (candidateName !== name) continue;
    if (match !== null) throw mutationError("preflight_failed", "Gradient name does not resolve uniquely.");
    match = candidate;
  }
  return match;
}

function appearanceValidateGradientStopColor(document, color, documentColorSpace, phase) {
  appearanceAssertColorCompatible(color, documentColorSpace);
  if (color.model === "spot") appearanceResolveSpot(document, color, phase);
}

function appearanceResolveGradient(document, value, documentColorSpace, phase) {
  if (!value || value.model !== "gradient" || typeof value.name !== "string" || value.name.length === 0 ||
      value.type !== "linear" || !value.stops || value.stops.length < 2 || value.stops.length > 32) {
    throw mutationError(phase, "Gradient identity or definition is incomplete.");
  }
  appearanceCanonicalAngle(value.angle);
  for (var index = 0; index < value.stops.length; index++) {
    appearanceValidateGradientStopColor(document, value.stops[index].color, documentColorSpace, phase);
  }
  var gradient = appearanceFindGradient(document, value.name);
  if (gradient === null) throw mutationError(phase, "Requested existing linear Gradient resource was not found.");
  var actual = appearanceReadGradientDefinition(gradient);
  var requested = { model: "gradient", name: value.name, type: value.type, angle: 0, stops: value.stops };
  var observed = { model: "gradient", name: actual.name, type: actual.type, angle: 0, stops: actual.stops };
  var mismatch = appearanceColorMismatch(observed, requested, "gradient");
  if (mismatch !== null) {
    throw mutationError(phase, "Existing Gradient definition does not match the explicit request at " + mismatch + ".");
  }
  return gradient;
}

function appearanceValidateColor(document, color, documentColorSpace) {
  appearanceAssertColorCompatible(color, documentColorSpace);
  if (color.model === "spot") appearanceResolveSpot(document, color, "preflight_failed");
  if (color.model === "gradient") appearanceResolveGradient(document, color, documentColorSpace, "preflight_failed");
}

function appearanceGradientAngle(value) {
  var angle = null;
  if (value.fill.kind === "solid" && value.fill.color.model === "gradient") angle = appearanceCanonicalAngle(value.fill.color.angle);
  if (value.stroke.kind === "solid" && value.stroke.color.model === "gradient") {
    var strokeAngle = appearanceCanonicalAngle(value.stroke.color.angle);
    if (angle !== null && angle !== strokeAngle) {
      throw mutationError("preflight_failed", "Fill and stroke Gradients must use the same semantic angle.");
    }
    angle = strokeAngle;
  }
  return angle;
}

function appearanceValidateDesired(value, documentColorSpace, document) {
  if (!value || !value.fill || !value.stroke) throw mutationError("preflight_failed", "Appearance request is incomplete.");
  appearanceNumber(value.opacity, "opacity", 0, 100);
  if (value.fill.kind === "solid") appearanceValidateColor(document, value.fill.color, documentColorSpace);
  else if (value.fill.kind !== "none") throw mutationError("preflight_failed", "Unsupported fill kind.");
  if (value.stroke.kind === "solid") {
    appearanceValidateColor(document, value.stroke.color, documentColorSpace);
    appearanceNumber(value.stroke.width, "stroke.width", 0.000001, 10000);
  } else if (value.stroke.kind !== "none") throw mutationError("preflight_failed", "Unsupported stroke kind.");
  appearanceGradientAngle(value);
}

function appearanceNativeColor(document, value) {
  var color;
  if (value.model === "none") return new NoColor();
  if (value.model === "rgb") {
    color = new RGBColor(); color.red = value.red; color.green = value.green; color.blue = value.blue; return color;
  }
  if (value.model === "cmyk") {
    color = new CMYKColor(); color.cyan = value.cyan; color.magenta = value.magenta;
    color.yellow = value.yellow; color.black = value.black; return color;
  }
  if (value.model === "gray") { color = new GrayColor(); color.gray = value.gray; return color; }
  if (value.model === "spot") {
    color = new SpotColor();
    color.spot = appearanceResolveSpot(document, value, "apply_failed");
    color.tint = appearanceCanonicalTint(value.tint);
    return color;
  }
  if (value.model === "gradient") {
    color = new GradientColor();
    color.gradient = appearanceResolveGradient(
      document,
      value,
      document.documentColorSpace === DocumentColorSpace.RGB ? "RGB" : "CMYK",
      "apply_failed"
    );
    return color;
  }
  throw mutationError("apply_failed", "Unsupported explicit color model.");
}

function appearanceWrite(document, item, value) {
  var fillColor = appearanceNativeColor(document, value.fill.color);
  var strokeColor = appearanceNativeColor(document, value.stroke.color);
  item.opacity = value.opacity;
  item.fillColor = fillColor;
  item.filled = value.fill.kind === "solid";
  item.strokeColor = strokeColor;
  item.strokeWidth = value.stroke.width;
  item.stroked = value.stroke.kind === "solid";
}

function appearanceCanonicalColorState(color) {
  if (color.model === "spot") return {
    model: "spot", name: color.name, tint: appearanceCanonicalTint(color.tint), baseColor: color.baseColor
  };
  if (color.model === "gradient") return {
    model: "gradient", name: color.name, type: color.type,
    angle: appearanceCanonicalAngle(color.angle), stops: color.stops
  };
  return color;
}

/**
 * A stroke turned off reads NoColor afterwards and keeps its width (cells STROKE-CMYK / STROKE-RGB, same and
 * next call), so the planned none stroke carries no colour and the before width. The fill is left as it was: what
 * \`filled = false\` does to fillColor is unmeasured.
 */
function appearanceDesiredState(desired, before) {
  return {
    opacity: desired.opacity,
    fill: desired.fill.kind === "solid"
      ? { kind: "solid", color: appearanceCanonicalColorState(desired.fill.color) }
      : { kind: "none", color: before.fill.color },
    stroke: desired.stroke.kind === "solid"
      ? { kind: "solid", color: appearanceCanonicalColorState(desired.stroke.color), width: desired.stroke.width }
      : { kind: "none", color: { model: "none" }, width: before.stroke.width }
  };
}

function appearanceBounds(item) {
  if (!item.geometricBounds || item.geometricBounds.length !== 4) {
    throw mutationError("preflight_failed", "Target geometric bounds are unavailable.");
  }
  return [
    mutationFiniteNumber(item.geometricBounds[0], "geometricBounds[0]"),
    mutationFiniteNumber(item.geometricBounds[1], "geometricBounds[1]"),
    mutationFiniteNumber(item.geometricBounds[2], "geometricBounds[2]"),
    mutationFiniteNumber(item.geometricBounds[3], "geometricBounds[3]")
  ];
}

function appearanceSameBounds(left, right) {
  return left && right && left.length === 4 && right.length === 4 &&
    left[0] === right[0] && left[1] === right[1] && left[2] === right[2] && left[3] === right[3];
}

function appearanceContainsGradient(value) {
  return value.fill.color.model === "gradient" || value.stroke.color.model === "gradient";
}

function appearanceDocumentBindingKey(documentKey) {
  return documentKey.replace(/[|]saved=(?:true|false)[|]/, "|saved=*|");
}

function appearanceBoundedBindingKey(documentKey) {
  var text = String(documentKey);
  return text.length <= 180 ? text : text.substring(0, 177) + "...";
}

function appearanceDocumentBinding(context) {
  return {
    keyVersion: context.keyVersion,
    bindingKey: appearanceDocumentBindingKey(context.key),
    name: context.name,
    path: context.path,
    fileRevision: context.fileRevision,
    colorSpace: context.colorSpace,
    activeArtboardIndex: context.activeArtboardIndex,
    activeArtboardBounds: context.activeArtboardBounds,
    artboardCount: context.artboardCount,
    appVersion: context.appVersion
  };
}

function appearanceResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var doc = app.activeDocument;
  var target = appearanceFindTarget(doc, params.targetUuid);
  if (target === null) throw new Error("MCP_ERROR:" + stringifyJson({ code: "OBJECT_NOT_FOUND", uuid: params.targetUuid }));
  if (target.typename !== "PathItem") throw mutationError("preflight_failed", "Appearance P0 supports PathItem targets only.");
  if (typeof target.uuid !== "string" || target.uuid !== params.targetUuid) throw mutationError("preflight_failed", "Target native UUID is unavailable or changed.");
  if (typeof target.locked !== "boolean" || typeof target.hidden !== "boolean" || typeof target.editable !== "boolean" ||
      target.locked || target.hidden || !target.editable) throw mutationError("preflight_failed", "Target is not verifiably editable.");
  if (forApply && context.mutationAllowed !== true) throw mutationError("preflight_failed", "Document mutation is not allowed.");
  appearanceValidateDesired(params.appearance, context.colorSpace, doc);
  var before = appearanceRead(target);
  if (before.fill.color.model !== "none") appearanceAssertColorCompatible(before.fill.color, context.colorSpace);
  if (before.stroke.color.model !== "none") appearanceAssertColorCompatible(before.stroke.color, context.colorSpace);
  if (appearanceContainsGradient(before)) {
    throw mutationError("preflight_failed", "P3 cannot replace a target that already carries Gradient geometry.");
  }
  return { context: context, doc: doc, target: target, before: before, bounds: appearanceBounds(target) };
}

function appearancePreflight(forApply) {
  var resolved = appearanceResolve(forApply);
  resolved.after = appearanceDesiredState(params.appearance, resolved.before);
  if (forApply) {
    if (!appearanceEqual(resolved.before, params.expectedBefore)) throw mutationError("preflight_failed", "Target appearance does not match expected_before.");
    if (!appearanceEqual(resolved.after, params.confirmedAfter)) throw mutationError("preflight_failed", "confirmed_after does not match the planned appearance state.");
  }
  return resolved;
}

function appearancePlan(preflight) {
  return {
    targetUuid: params.targetUuid,
    before: preflight.before,
    after: preflight.after,
    confirmationStatus: params.apply === true ? "confirmed" : "required",
    applyAllowed: params.apply === true && appearanceEqual(preflight.before, params.expectedBefore) && appearanceEqual(preflight.after, params.confirmedAfter)
  };
}

function appearanceRevalidate(preflight, plan) {
  var current;
  try { current = appearanceResolve(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Appearance preconditions changed before apply.")); }
  if (current.doc !== preflight.doc || current.target !== preflight.target || current.target.uuid !== plan.targetUuid ||
      !appearanceEqual(current.before, plan.before) || !appearanceSameBounds(current.bounds, preflight.bounds)) {
    throw mutationBeforeSideEffectError("Appearance target, bounds, or before-state changed before apply.");
  }
}

function appearanceApply(preflight, plan, state) {
  state.operationState.mutationStarted = true;
  appearanceWrite(preflight.doc, preflight.target, plan.after);
  var gradientAngle = appearanceGradientAngle(plan.after);
  if (gradientAngle !== null && gradientAngle !== 0) {
    preflight.target.rotate(gradientAngle, false, false, true, false, Transformation.CENTER);
  }
  if (!appearanceSameBounds(appearanceBounds(preflight.target), preflight.bounds)) {
    throw mutationError("apply_failed", "Gradient-only rotation changed target geometry.");
  }
  return preflight.target;
}

function appearanceVerifyBoundPreview(preflight, plan, target) {
  if (!params.boundPreview) return null;
  var preview = params.boundPreview;
  var documentBefore = getDocumentContext();
  if (app.documents.length === 0 || app.activeDocument !== preflight.doc) throw mutationError("verify_mismatch", "Active document changed before bound preview export.");
  var actualDocumentBindingKey = appearanceDocumentBindingKey(documentBefore.key);
  if (actualDocumentBindingKey !== preview.expectedDocumentBindingKey) throw mutationError(
    "verify_mismatch",
    "Bound preview document key mismatch; expected=" + appearanceBoundedBindingKey(preview.expectedDocumentBindingKey) +
      "; actual=" + appearanceBoundedBindingKey(actualDocumentBindingKey) + "."
  );
  if (documentBefore.activeArtboardIndex !== preview.artboardIndex) throw mutationError("verify_mismatch", "Requested preview artboard must already be active.");
  appearanceNumber(preview.scalePercent, "preview.scalePercent", 1, 100);
  var previewBase = new File(preview.stagingBasePath);
  var previewArtifact = new File(preview.stagingPath);
  if (previewBase.exists || previewArtifact.exists) throw mutationError("verify_mismatch", "Preview staging target already exists; overwrite is forbidden.");
  var appearanceBefore = { targetUuid: plan.targetUuid, appearance: appearanceRead(target) };
  var previewOptions = new ExportOptionsPNG24();
  previewOptions.antiAliasing = true;
  previewOptions.artBoardClipping = true;
  previewOptions.horizontalScale = preview.scalePercent;
  previewOptions.verticalScale = preview.scalePercent;
  previewOptions.transparency = true;
  previewOptions.matte = false;
  previewOptions.saveAsHTML = false;
  preflight.doc.exportFile(previewBase, ExportType.PNG24, previewOptions);
  if (!previewArtifact.exists || typeof previewArtifact.length !== "number" || previewArtifact.length <= 0) throw mutationError("verify_mismatch", "Illustrator did not produce a non-empty PNG staging artifact.");
  if (app.documents.length === 0 || app.activeDocument !== preflight.doc) throw mutationError("verify_mismatch", "Native document reference changed during preview export.");
  var documentAfter = getDocumentContext();
  if (stringifyJson(appearanceDocumentBinding(documentBefore)) !== stringifyJson(appearanceDocumentBinding(documentAfter))) throw mutationError("verify_mismatch", "Nonvolatile document binding changed during preview export.");
  var targetAfter = appearanceFindTarget(preflight.doc, plan.targetUuid);
  if (targetAfter === null || targetAfter !== preflight.target || targetAfter !== target || targetAfter.uuid !== plan.targetUuid) throw mutationError("verify_mismatch", "Native PageItem reference changed during preview export.");
  if (!appearanceSameBounds(appearanceBounds(targetAfter), preflight.bounds)) throw mutationError("verify_mismatch", "Target bounds changed during preview export.");
  var appearanceAfter = { targetUuid: plan.targetUuid, appearance: appearanceRead(targetAfter) };
  if (!appearanceEqual(appearanceBefore.appearance, appearanceAfter.appearance)) throw mutationError("verify_mismatch", "Target appearance changed during preview export.");
  return {
    binding: {
      kind: "same_bridge_execution_native_reference_v1",
      targetUuid: plan.targetUuid,
      documentReferenceStable: true,
      pageItemReferenceStable: true
    },
    documentBefore: documentBefore,
    documentAfter: documentAfter,
    appearanceBefore: appearanceBefore,
    appearanceAfter: appearanceAfter,
    artboardIndex: preview.artboardIndex,
    scalePercent: preview.scalePercent,
    stagingPath: previewArtifact.fsName,
    size: previewArtifact.length
  };
}

function appearanceVerify(preflight, plan) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.doc) throw mutationError("verify_mismatch", "Active document changed during appearance verification.");
  var target = appearanceFindTarget(preflight.doc, plan.targetUuid);
  if (target === null || target !== preflight.target || target.uuid !== plan.targetUuid) throw mutationError("verify_mismatch", "Target native UUID no longer resolves to the same PageItem.");
  if (!appearanceSameBounds(appearanceBounds(target), preflight.bounds)) throw mutationError("verify_mismatch", "Target bounds changed during appearance apply.");
  var actual = appearanceRead(target);
  if (!appearanceEqual(actual, plan.after)) {
    throw mutationError("verify_mismatch", "Appearance postcondition does not match the plan at " +
      String(appearanceMismatch(actual, plan.after)) + ".");
  }
  return {
    postcondition: { targetUuid: plan.targetUuid, appearance: actual },
    boundPreview: appearanceVerifyBoundPreview(preflight, plan, target)
  };
}

function appearanceRollback(state) {
  var preflight = state.preflight;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.doc) return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
  var target = appearanceFindTarget(preflight.doc, params.targetUuid);
  if (target === null || target !== preflight.target || target.uuid !== params.targetUuid) return { status: "indeterminate", message: "Rollback target identity is indeterminate." };
  try { appearanceWrite(preflight.doc, target, preflight.before); }
  catch (error) { return { status: "indeterminate", message: "Rollback write outcome is indeterminate." }; }
  var restored;
  try { restored = appearanceRead(target); }
  catch (error) { return { status: "indeterminate", message: "Rollback verification is indeterminate." }; }
  state.operationState.rollbackEvidence.restoredAppearance = restored;
  if (!appearanceSameBounds(appearanceBounds(target), preflight.bounds)) {
    return { status: "indeterminate", message: "Rollback target bounds are not exactly restored." };
  }
  return appearanceEqual(restored, preflight.before)
    ? { status: "verified" }
    : { status: "failed", message: "Rollback did not restore the exact before appearance." };
}
`;
const SET_PATH_APPEARANCE_RUNNER_SCRIPT = `
var appearanceExecution = runMutationTransaction({
  apply: params.apply === true,
  // the items this change reads and writes, so an edit session can advance its item aggregate.
  editSessionAffected: function () { return [params.targetUuid]; },
  initialOperationState: function () { return { mutationStarted: false, rollbackEvidence: { targetUuid: params.targetUuid, restoredAppearance: null } }; },
  preflight: appearancePreflight,
  plan: appearancePlan,
  revalidate: appearanceRevalidate,
  applyMutation: appearanceApply,
  verify: appearanceVerify,
  rollback: appearanceRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () { return { reasonCode: "appearance_state_unknown", message: "Appearance apply outcome is indeterminate.", evidence: { targetUuid: params.targetUuid, restoredAppearance: null } }; },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var appearanceDocument = appearanceExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === appearanceExecution.preflight.doc) appearanceDocument = getDocumentContext();
var result = {
  operation: "set_path_appearance",
  applied: appearanceExecution.transaction.state === "verified",
  document: appearanceDocument,
  plan: appearanceExecution.plan,
  transaction: appearanceExecution.transaction
};
if (appearanceExecution.transaction.state === "verified") {
  result.postcondition = appearanceExecution.value.postcondition;
  if (appearanceExecution.value.boundPreview !== null) result.boundPreview = appearanceExecution.value.boundPreview;
}
`;
export const SET_PATH_APPEARANCE_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}${SET_PATH_APPEARANCE_MODULE_SCRIPT}${SET_PATH_APPEARANCE_RUNNER_SCRIPT}`;
export const SET_PATH_APPEARANCE_HOST_SCRIPT_DIGEST = canonicalSha256(SET_PATH_APPEARANCE_SCRIPT);
export const SET_PATH_APPEARANCE_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2,
    contractVersion: 1,
    operation: SET_PATH_APPEARANCE_OPERATION,
    validator: SET_PATH_APPEARANCE_VALIDATOR,
    canonicalContractVersion: SET_PATH_APPEARANCE_CANONICAL_VERSION,
    resultSchemaVersion: SET_PATH_APPEARANCE_RESULT_SCHEMA_VERSION,
    terminalClassifierVersion: SET_PATH_APPEARANCE_CLASSIFIER_VERSION,
    safetyConformanceVersion: SET_PATH_APPEARANCE_CONFORMANCE_VERSION,
    errorMappingVersion: SET_PATH_APPEARANCE_ERROR_MAPPING_VERSION,
    safetyIdentity: SET_PATH_APPEARANCE_SAFETY_IDENTITY,
    hostScriptDigest: SET_PATH_APPEARANCE_HOST_SCRIPT_DIGEST,
});
function normalizedRequest(input) {
    const request = setPathAppearanceInternalInputSchema.parse(input);
    const digestRequest = 'commandId' in request
        ? (({ commandId: _commandId, ...rest }) => rest)(request)
        : request;
    const digest = canonicalSha256({
        operation: SET_PATH_APPEARANCE_OPERATION,
        validator: SET_PATH_APPEARANCE_VALIDATOR,
        request: digestRequest,
    });
    return {
        intent: request.apply ? 'apply' : 'plan',
        request,
        commandId: 'commandId' in request ? request.commandId : null,
        documentKey: request.expectedDocumentKey,
        digest,
    };
}
export const setPathAppearanceToolContract = {
    name: 'illustrator_set_path_appearance',
    title: 'Plan or Set Path Appearance',
    description: 'Plan or apply explicit opacity/fill/stroke state to one PathItem bound by document key and native UUID. RGB is limited to RGB documents, CMYK to CMYK documents, Gray to either; existing exact non-Gray Spot and bounded existing linear Gradient paints follow the same recursive measured profile and are never implicitly converted.',
    inputSchema: setPathAppearanceInputSchema,
    publicInputSchema: setPathAppearancePublicInputSchema,
    outputSchema: setPathAppearanceResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(SET_PATH_APPEARANCE_SAFETY.policy),
    normalizePublicInput,
};
export function createSetPathAppearanceAdapter() {
    return {
        version: 1,
        operation: SET_PATH_APPEARANCE_OPERATION,
        validator: SET_PATH_APPEARANCE_VALIDATOR,
        safety: SET_PATH_APPEARANCE_SAFETY,
        safetyRegistrationIdentity: SET_PATH_APPEARANCE_SAFETY_IDENTITY,
        adapterIdentity: SET_PATH_APPEARANCE_ADAPTER_IDENTITY,
        tool: setPathAppearanceToolContract,
        canonical: {
            version: SET_PATH_APPEARANCE_CANONICAL_VERSION,
            normalize: normalizedRequest,
            safetyDigest: (input) => normalizedRequest(input).digest,
        },
        resultSchema: setPathAppearanceResultSchema,
        resultSchemaVersion: SET_PATH_APPEARANCE_RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: SET_PATH_APPEARANCE_CLASSIFIER_VERSION,
        safetyConformanceVersion: SET_PATH_APPEARANCE_CONFORMANCE_VERSION,
        errorMappingVersion: SET_PATH_APPEARANCE_ERROR_MAPPING_VERSION,
        hostScriptDigest: SET_PATH_APPEARANCE_HOST_SCRIPT_DIGEST,
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan') {
                return { kind: 'read', script: SET_PATH_APPEARANCE_SCRIPT, params };
            }
            return {
                kind: 'mutation',
                mutationValidator: SET_PATH_APPEARANCE_VALIDATOR,
                idempotency: {
                    commandId: normalized.commandId,
                    operation: SET_PATH_APPEARANCE_OPERATION,
                    documentKey: normalized.documentKey,
                    requestDigest: normalized.digest,
                },
                adapterIdentity: SET_PATH_APPEARANCE_ADAPTER_IDENTITY,
                script: SET_PATH_APPEARANCE_SCRIPT,
                params,
            };
        },
        classifyTerminal(value) {
            const state = setPathAppearanceResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back')
                return { state };
            if (state === 'planned')
                throw new Error('Appearance plan is not a terminal mutation result.');
            throw new Error('Unverified appearance recovery must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertAppearanceSafetyConformance,
        mapExecutionError(error, detail) {
            if (detail?.code === 'OBJECT_NOT_FOUND') {
                return new Error(`No PageItem with UUID ${JSON.stringify(detail.uuid ?? '')} exists in the bound document.`);
            }
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
