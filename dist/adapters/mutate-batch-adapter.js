import { assertSnapshotResultFits, mixedSnapshotResultPairs, snapshotResultBytes, SNAPSHOT_RESULT_ADMISSION_BYTES, SNAPSHOT_RESULT_SIZE_SCRIPT } from './snapshot-result-size.js';
import { z } from 'zod';
import { nestedTranslateRows, translateNestedEvidence } from './transform-nested-snapshot.js';
import { TRANSFORM_GROUP_SCRIPT } from './transform-group-snapshot.js';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { SNAPSHOT_SHA256_PATTERN } from '../snapshot-ref-cache.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { POINT_TEXT_APPLY_BLOCKERS, POINT_TEXT_BLOCKERS_SCRIPT, POINT_TEXT_CHARACTER_SCRIPT, POINT_TEXT_GROUP_SCRIPT, POINT_TEXT_SNAPSHOT_SCRIPT, } from './point-text-host-script.js';
import { REPLACE_POINT_TEXT_MODULE_SCRIPT, REPLACE_POINT_TEXT_OPERATION, } from './replace-point-text-adapter.js';
import { assembleHostFragments, emitBatchHostDispatchRow, emitBatchHostParamsBranch, inPinnedOrder, reportedStepBlockers, stepPlanBinding, stepSnapshotUuid } from './batch-step-contract.js';
import { BATCH_STEP_REGISTRY, BATCH_STEPS, registeredBatchStep, requireBatchStep } from './batch-step-registry.js';
import { SET_TEXT_STYLE_BATCH_MODULE_SCRIPT, SET_TEXT_STYLE_OPERATION, } from './set-text-style-adapter.js';
import { SET_PATH_APPEARANCE_MODULE_SCRIPT, SET_PATH_APPEARANCE_OPERATION, } from './set-path-appearance-adapter.js';
import { TRANSFORM_OBJECT_MODULE_SCRIPT, TRANSFORM_OBJECT_OPERATION, } from './transform-object-adapter.js';
import { TRANSFORM_TEXT_SCRIPT } from './transform-text-snapshot.js';
import { SET_OBJECT_STATE_BATCH_SCRIPT, SET_OBJECT_STATE_MODULE_SCRIPT, SET_OBJECT_STATE_OPERATION } from './set-object-state-adapter.js';
import { SET_LAYER_STATE_OPERATION } from './set-layer-state-adapter.js';
import { LAYER_OPS_HOST_SCRIPT } from './layer-ops-host-script.js';
import { BATCH_LAYER_STATE_SCRIPT, deriveBatchLayerSnapshot, measuredLayerOrder } from './batch-layer-state.js';
import { SUPPORTED_PATH_ITEM_HOST_SCRIPT } from './supported-path-item-host-script.js';
import { MOVE_OBJECT_TO_LAYER_MODULE_SCRIPT } from './move-object-to-layer-adapter.js';
import { APPLY_CHARACTER_STYLE_MODULE_SCRIPT, characterStyleSnapshotSchema } from './apply-character-style-adapter.js';
import { TEXT_STYLE_RESOURCE_SCRIPT } from '../text-style-resources.js';
import { BATCH_CHARSTYLE_MAX_CHARACTERS, BATCH_CHARSTYLE_OPERATION, BATCH_CHARSTYLE_SCRIPT, BATCH_CHARSTYLE_STEP_COUNT, batchCharStylePlanIssue } from './batch-charstyle.js';
import { validateClusterRange } from './point-text-cluster.js';
import { BATCH_MOVE_BLOCKERS, BATCH_MOVE_OPERATION, BATCH_MOVE_SCRIPT, BATCH_MOVE_STEP_COUNT, batchMovePlanIssue, simulateMovePlans } from './batch-move.js';
export const MUTATE_BATCH_OPERATION = 'mutate_batch';
export const MUTATE_BATCH_VALIDATOR = { kind: MUTATE_BATCH_OPERATION, version: 1 };
export const MIXED_BATCH_MIN_STEPS = 2;
export const MIXED_BATCH_MAX_STEPS = 16;
export const OBJECT_STATE_BATCH_MAX_STEPS = 3;
export const MIXED_BATCH_MAX_TEXT_CODE_UNITS = 4_000;
export const MIXED_BATCH_MAX_STYLE_CHARACTERS = 200;
export const MIXED_BATCH_MAX_TRANSFORM_TEXT_EVIDENCE_UNITS = 4_096;
const CANONICAL_VERSION = 11;
const RESULT_SCHEMA_VERSION = 12;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
const uuidSchema = z.string().min(1).max(255);
const documentKeySchema = z.string().min(1).max(16_384);
const MIXED_OPERATIONS = BATCH_STEP_REGISTRY.map((step) => step.operation);
function sameCanonical(left, right) {
    return canonicalSha256(left) === canonicalSha256(right);
}
function definedFields(value) {
    return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined));
}
function sameCanonicalKey(value) {
    return canonicalSha256(value);
}
const styleStep = BATCH_STEPS[SET_TEXT_STYLE_OPERATION];
const registeredBatchTextStyle = styleStep.internalPlan.shape.style;
function stepOptions(pick) {
    return Object.values(BATCH_STEPS).map(pick);
}
const internalPlanStepSchema = z.discriminatedUnion('operation', stepOptions((step) => step.internalPlan));
const internalApplyStepSchema = z.discriminatedUnion('operation', stepOptions((step) => step.internalApply));
function refineSteps(steps, context) {
    const uuids = steps.map((step) => step.targetUuid);
    if (new Set(uuids).size !== uuids.length) {
        context.addIssue({ code: 'custom', message: 'Mixed batch steps must target distinct native UUIDs.' });
    }
    const layers = steps.filter(step => step.operation === SET_LAYER_STATE_OPERATION);
    if (layers.length > 0 && (layers.length !== steps.length || layers.length !== 2 || !measuredLayerOrder(layers.map(step => step.layerPath)))) {
        context.addIssue({ code: 'custom', message: 'set_layer_state admits exactly two homogeneous steps on distinct measured layer paths.' });
    }
    const moves = steps.filter((step) => step.operation === BATCH_MOVE_OPERATION);
    if (moves.length > 0) {
        const paths = new Set(moves.map((step) => JSON.stringify(step.destinationLayerPath)));
        if (moves.length !== steps.length || moves.length !== BATCH_MOVE_STEP_COUNT || paths.size !== 1) {
            context.addIssue({ code: 'custom', message: 'move_object_to_layer admits exactly two homogeneous steps that share one destination layer path.' });
        }
        const confirmed = moves.filter((step) => 'expectedBefore' in step);
        const key = (step, field) => JSON.stringify(field in step ? step[field] : null);
        if (confirmed.length > 0 && (confirmed.length !== moves.length ||
            new Set(confirmed.map((step) => key(step, 'expectedSourceOrder'))).size !== 1 ||
            new Set(confirmed.map((step) => key(step, 'expectedDestinationOrder'))).size !== 1 ||
            new Set(confirmed.map((step) => JSON.stringify('expectedBefore' in step ? step.expectedBefore.layerPath : null))).size !== 1)) {
            context.addIssue({ code: 'custom', message: 'move_object_to_layer steps must confirm one shared source layer and one baseline for both complete orders.' });
        }
    }
    const states = steps.filter((step) => step.operation === SET_OBJECT_STATE_OPERATION);
    if (states.length > 0 && (states.length !== steps.length || steps.length > OBJECT_STATE_BATCH_MAX_STEPS)) {
        context.addIssue({ code: 'custom', message: 'set_object_state admits only homogeneous batches of two or three PathItems.' });
    }
    const charStyles = steps.filter((step) => step.operation === BATCH_CHARSTYLE_OPERATION);
    if (charStyles.length > 0) {
        if (charStyles.length !== steps.length || charStyles.length !== BATCH_CHARSTYLE_STEP_COUNT ||
            new Set(charStyles.map((step) => step.styleName)).size !== 1) {
            context.addIssue({ code: 'custom', message: 'apply_character_style admits exactly two homogeneous steps that apply one named style.' });
        }
        const confirmed = charStyles.filter((step) => 'expectedBefore' in step);
        if (confirmed.length > 0 && (confirmed.length !== charStyles.length ||
            new Set(confirmed.map((step) => sameCanonicalKey('expectedStyle' in step ? step.expectedStyle : null))).size !== 1)) {
            context.addIssue({ code: 'custom', message: 'apply_character_style steps must confirm one shared style resource definition.' });
        }
        for (const step of charStyles) {
            if (step.start >= step.end)
                context.addIssue({ code: 'custom', message: 'An apply_character_style step needs a non-empty range.' });
            else if ('expectedBefore' in step) {
                const rejection = validateClusterRange(step.expectedBefore.contents, step.start, step.end);
                if (rejection !== null)
                    context.addIssue({ code: 'custom', message: `Character-style request is unsupported: ${rejection.reason}.` });
            }
        }
    }
    let textUnits = 0;
    let styleCharacters = 0;
    let transformTextBytes = 0;
    for (const step of steps) {
        if (step.operation === REPLACE_POINT_TEXT_OPERATION)
            textUnits += step.replacement.length;
        if (step.operation === TRANSFORM_OBJECT_OPERATION && 'expectedBefore' in step) {
            transformTextBytes += step.expectedBefore.textFrame?.attributes.length ?? 0;
        }
        if (step.operation === SET_TEXT_STYLE_OPERATION) {
            if (step.start >= step.end) {
                context.addIssue({ code: 'custom', message: 'A set_text_style step needs a non-empty range.' });
            }
            if ('expectedBefore' in step)
                styleCharacters += step.expectedBefore.characters.length;
        }
        if (step.operation === BATCH_CHARSTYLE_OPERATION && 'expectedBefore' in step)
            styleCharacters += step.expectedBefore.characters.length;
    }
    if (charStyles.length > 0 && styleCharacters > BATCH_CHARSTYLE_MAX_CHARACTERS) {
        context.addIssue({ code: 'custom', message: `Mixed batch apply_character_style targets must total at most ${BATCH_CHARSTYLE_MAX_CHARACTERS} characters.` });
    }
    if (textUnits > MIXED_BATCH_MAX_TEXT_CODE_UNITS) {
        context.addIssue({ code: 'custom', message: `Mixed batch replacement contents must total at most ${MIXED_BATCH_MAX_TEXT_CODE_UNITS} UTF-16 code units.` });
    }
    if (styleCharacters > MIXED_BATCH_MAX_STYLE_CHARACTERS) {
        context.addIssue({ code: 'custom', message: `Mixed batch character-snapshot targets must total at most ${MIXED_BATCH_MAX_STYLE_CHARACTERS} characters.` });
    }
    if (transformTextBytes > MIXED_BATCH_MAX_TRANSFORM_TEXT_EVIDENCE_UNITS) {
        context.addIssue({ code: 'custom', message: `Mixed batch text-frame translation evidence must total at most ${MIXED_BATCH_MAX_TRANSFORM_TEXT_EVIDENCE_UNITS} UTF-16 code units.` });
    }
}
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({
        expectedDocumentKey: documentKeySchema,
        steps: z.array(internalPlanStepSchema).min(MIXED_BATCH_MIN_STEPS).max(MIXED_BATCH_MAX_STEPS).superRefine(refineSteps),
        apply: z.literal(false),
    }),
    z.strictObject({
        expectedDocumentKey: documentKeySchema,
        steps: z.array(internalApplyStepSchema).min(MIXED_BATCH_MIN_STEPS).max(MIXED_BATCH_MAX_STEPS).superRefine(refineSteps),
        apply: z.literal(true),
        commandId: canonicalCommandIdSchema,
    }),
]);
const publicPlanStepSchema = z.discriminatedUnion('operation', stepOptions((step) => step.publicPlan));
const publicApplyStepSchema = z.discriminatedUnion('operation', stepOptions((step) => step.publicApply));
const snapshotRefSchema = z.string().regex(SNAPSHOT_SHA256_PATTERN);
const publicApplyStepWithRefsSchema = z.discriminatedUnion('operation', publicApplyStepSchema.options.map((option) => z.strictObject({
    ...option.shape,
    expected_before: option.shape.expected_before.optional(), confirmed_after: option.shape.confirmed_after.optional(),
    expected_before_sha256: snapshotRefSchema.optional(), confirmed_after_sha256: snapshotRefSchema.optional(),
})));
export const SNAPSHOT_ECHO_FIELDS = [['expected_before', 'expected_before_sha256'], ['confirmed_after', 'confirmed_after_sha256']];
function refineSnapshotEchoes(steps, context) {
    steps.forEach((step, index) => {
        for (const [full, reference] of SNAPSHOT_ECHO_FIELDS) {
            if ((step[full] === undefined) === (step[reference] === undefined)) {
                context.addIssue({ code: 'custom', path: [index, full], message: `Step ${index + 1} needs exactly one of ${full} and ${reference}.` });
            }
        }
    });
}
function normalizeStep(step) {
    return requireBatchStep(step.operation).normalize(step);
}
const PUBLIC_ONLY_OPERATIONS = BATCH_STEP_REGISTRY.filter((step) => !step.recipeAllowed).map((step) => step.operation);
function createPublicInputSchema(includeLayerState, snapshotRefs = false) {
    const planSteps = includeLayerState ? publicPlanStepSchema : z.discriminatedUnion('operation', [publicPlanStepSchema.options[0], ...publicPlanStepSchema.options.slice(1).filter(step => !PUBLIC_ONLY_OPERATIONS.includes(step.shape.operation.value))]);
    const applySteps = snapshotRefs ? publicApplyStepWithRefsSchema : includeLayerState ? publicApplyStepSchema : z.discriminatedUnion('operation', [publicApplyStepSchema.options[0], ...publicApplyStepSchema.options.slice(1).filter(step => !PUBLIC_ONLY_OPERATIONS.includes(step.shape.operation.value))]);
    return z.discriminatedUnion('apply', [
        z.strictObject({
            expected_document_key: documentKeySchema,
            steps: z.array(planSteps).min(MIXED_BATCH_MIN_STEPS).max(MIXED_BATCH_MAX_STEPS)
                .superRefine((steps, context) => refineSteps(steps.map(normalizeStep), context)),
            apply: z.literal(false).default(false),
        }),
        z.strictObject({
            expected_document_key: documentKeySchema,
            steps: z.array(applySteps).min(MIXED_BATCH_MIN_STEPS).max(MIXED_BATCH_MAX_STEPS)
                .superRefine((steps, context) => {
                refineSnapshotEchoes(steps, context);
                refineSteps(steps.map((step) => normalizeStep(step)), context);
            }),
            apply: z.literal(true),
            command_id: applyCommandIdSchema,
        }),
    ]);
}
export const mutateBatchPublicInputSchema = createPublicInputSchema(true, true);
export const mutateBatchRecipeInputSchema = createPublicInputSchema(false);
function looseStepFields() {
    const fields = new Map();
    for (const step of BATCH_STEP_REGISTRY) {
        for (const [key, schema] of Object.entries(step.publicApply.shape)) {
            if (key === 'operation' || key === 'target_uuid')
                continue;
            const schemas = fields.get(key) ?? [];
            if (!schemas.includes(schema))
                schemas.push(schema);
            fields.set(key, schemas);
        }
    }
    return Object.fromEntries([...fields].map(([key, schemas]) => [key, (schemas.length === 1 ? schemas[0] : z.union(schemas)).optional()]));
}
const inputSchema = z.strictObject({
    expected_document_key: documentKeySchema,
    steps: z.array(z.strictObject({
        operation: z.enum(MIXED_OPERATIONS),
        target_uuid: uuidSchema,
        ...looseStepFields(),
        expected_before_sha256: snapshotRefSchema.optional(),
        confirmed_after_sha256: snapshotRefSchema.optional(),
    })).min(MIXED_BATCH_MIN_STEPS).max(MIXED_BATCH_MAX_STEPS),
    apply: z.boolean().default(false),
    command_id: applyCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(mutateBatchPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = mutateBatchPublicInputSchema.parse(input);
    if (value.steps.some((step) => SNAPSHOT_ECHO_FIELDS.some(([, reference]) => step[reference] !== undefined))) {
        throw new Error('Snapshot references must be expanded to the planned snapshots before normalization.');
    }
    const steps = value.steps.map(normalizeStep);
    return value.apply
        ? { expectedDocumentKey: value.expected_document_key, steps, apply: true, commandId: value.command_id }
        : { expectedDocumentKey: value.expected_document_key, steps, apply: false };
}
const LEGACY_BLOCKERS = [...POINT_TEXT_APPLY_BLOCKERS, 'ancestor_hidden', 'ancestor_locked', 'result_too_large'];
const MIXED_BLOCKERS = [...LEGACY_BLOCKERS, ...BATCH_MOVE_BLOCKERS];
const blockerSchema = z.enum(MIXED_BLOCKERS);
const legacyBlockerSchema = z.enum(LEGACY_BLOCKERS);
function unionBlockers(perStep) {
    const present = new Set();
    for (const blockers of perStep)
        for (const blocker of blockers)
            present.add(blocker);
    return MIXED_BLOCKERS.filter((blocker) => present.has(blocker));
}
const RESULT_STEP_ORDER = [SET_OBJECT_STATE_OPERATION, REPLACE_POINT_TEXT_OPERATION, SET_TEXT_STYLE_OPERATION, TRANSFORM_OBJECT_OPERATION,
    SET_PATH_APPEARANCE_OPERATION, SET_LAYER_STATE_OPERATION, BATCH_MOVE_OPERATION, BATCH_CHARSTYLE_OPERATION];
function planStepOption(operation) {
    return z.strictObject({ operation: z.literal(operation), targetUuid: uuidSchema,
        plan: BATCH_STEPS[operation].planSchema });
}
const rollbackOutcomeSchema = z.enum(['not_written', 'restored', 'outstanding', 'indeterminate']);
function rollbackStepOption(operation) {
    const snapshot = BATCH_STEPS[operation].snapshotSchema;
    return z.strictObject({ operation: z.literal(operation), targetUuid: uuidSchema, outcome: rollbackOutcomeSchema,
        restoredSnapshot: z.nullable(snapshot), observedSnapshot: z.nullable(snapshot) });
}
const resultStepKeys = inPinnedOrder(BATCH_STEP_REGISTRY, RESULT_STEP_ORDER).map((step) => step.operation);
const planStepSchema = z.discriminatedUnion('operation', resultStepKeys.map(planStepOption));
function planStepBlockers(step) {
    return [...reportedStepBlockers(requireBatchStep(step.operation), step.plan)];
}
function derivedStepBlockers(step, mutationAllowed, stepCount) {
    return requireBatchStep(step.operation).planBlockers(mutationAllowed, step.plan, stepCount);
}
function stepRequest(step) {
    return requireBatchStep(step.operation).request(step.plan);
}
function stepSame(step, left, right) {
    return requireBatchStep(step.operation).same(left, right);
}
function nestedBatchSnapshot(steps, index, after, final = false) {
    const step = steps[index];
    if (step.operation === BATCH_MOVE_OPERATION) {
        const plans = steps.flatMap((other) => other.operation === BATCH_MOVE_OPERATION ? [other.plan] : []);
        const simulated = simulateMovePlans(plans);
        const prefix = simulated.prefixes[index];
        if (!after)
            return { target: step.plan.before, sourceOrder: prefix.sourceBefore, destinationOrder: prefix.destinationBefore };
        return final ? { target: step.plan.after, sourceOrder: simulated.finalSource, destinationOrder: simulated.finalDestination }
            : { target: step.plan.after, sourceOrder: prefix.sourceAfter, destinationOrder: prefix.destinationAfter };
    }
    if (step.operation === SET_LAYER_STATE_OPERATION) {
        return deriveBatchLayerSnapshot(step.plan.before, steps.slice(0, final ? steps.length : index + (after ? 1 : 0)).flatMap(other => other.operation === SET_LAYER_STATE_OPERATION ? [{ layerPath: other.plan.layerPath, after: other.plan.requested }] : []));
    }
    if (step.operation !== TRANSFORM_OBJECT_OPERATION)
        return after ? step.plan.after : step.plan.before;
    const base = after ? step.plan.after : step.plan.before;
    if (!step.plan.before.nestedGroup)
        return base;
    let evidence = step.plan.before.nestedGroup;
    const parent = nestedTranslateRows(evidence)[0].uuid;
    for (const other of steps.slice(0, final ? steps.length : index + (after ? 1 : 0))) {
        if (other.operation === TRANSFORM_OBJECT_OPERATION && other.plan.before.nestedGroup &&
            nestedTranslateRows(other.plan.before.nestedGroup)[0].uuid === parent && other.plan.transform.type === 'translate') {
            evidence = translateNestedEvidence(evidence, other.targetUuid, other.plan.transform.deltaX, other.plan.transform.deltaY);
        }
    }
    return { ...base, nestedGroup: evidence };
}
const planSchema = z.strictObject({
    operation: z.literal(MUTATE_BATCH_OPERATION),
    documentKey: documentKeySchema,
    steps: z.array(planStepSchema).min(MIXED_BATCH_MIN_STEPS).max(MIXED_BATCH_MAX_STEPS),
    applyBlockedReasonCodes: z.array(blockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    const layers = plan.steps.filter(step => step.operation === SET_LAYER_STATE_OPERATION);
    if (layers.length > 0 && (layers.length !== plan.steps.length || layers.length !== 2 ||
        !measuredLayerOrder(layers.map(step => step.plan.layerPath)) ||
        layers.some(step => step.plan.before.evidence !== layers[0].plan.before.evidence))) {
        context.addIssue({ code: 'custom', message: 'Layer batch must bind one complete common baseline and two distinct paths.' });
    }
    if (layers.length === 2) {
        try {
            if (deriveBatchLayerSnapshot(layers[0].plan.before, layers.map(step => ({ layerPath: step.plan.layerPath, after: step.plan.requested }))).evidence.length > 8192) {
                context.addIssue({ code: 'custom', message: 'Combined layer evidence exceeds 8192 units.' });
            }
        }
        catch {
            context.addIssue({ code: 'custom', message: 'Invalid combined layer evidence.' });
        }
    }
    const moves = plan.steps.flatMap((step) => step.operation === BATCH_MOVE_OPERATION ? [step.plan] : []);
    if (moves.length > 0) {
        const issue = moves.length !== plan.steps.length ? 'Layer-move plan must be homogeneous.' : batchMovePlanIssue(moves);
        if (issue !== null)
            context.addIssue({ code: 'custom', message: issue });
    }
    const charStyles = plan.steps.flatMap((step) => step.operation === BATCH_CHARSTYLE_OPERATION ? [step.plan] : []);
    if (charStyles.length > 0) {
        const issue = charStyles.length !== plan.steps.length ? 'Character-style plan must be homogeneous.' : batchCharStylePlanIssue(charStyles);
        if (issue !== null)
            context.addIssue({ code: 'custom', message: issue });
    }
    const states = plan.steps.filter((step) => step.operation === SET_OBJECT_STATE_OPERATION);
    if (states.length > 0 && (states.length !== plan.steps.length || states.length > OBJECT_STATE_BATCH_MAX_STEPS)) {
        context.addIssue({ code: 'custom', message: 'Object-state plan must be homogeneous with at most three steps.' });
    }
    const uuids = plan.steps.map((step) => step.targetUuid);
    if (new Set(uuids).size !== uuids.length) {
        context.addIssue({ code: 'custom', message: 'Mixed batch plan steps must target distinct UUIDs.' });
    }
    for (const step of plan.steps) {
        const binding = stepPlanBinding(requireBatchStep(step.operation), step.plan);
        const identityMatches = step.targetUuid === binding.targetUuid && (binding.documentKey === null || binding.documentKey === plan.documentKey);
        if (!identityMatches || (binding.confirmationStatus !== null && binding.confirmationStatus !== plan.confirmationStatus)) {
            context.addIssue({ code: 'custom', message: 'Mixed batch step plan must bind its own target and the batch document and confirmation.' });
        }
        if (step.operation === SET_TEXT_STYLE_OPERATION && !registeredBatchTextStyle.safeParse(definedFields(step.plan.style)).success) {
            context.addIssue({ code: 'custom', message: 'Mixed batch set_text_style steps admit exactly one attribute the batch step registers.' });
        }
        if (step.operation === TRANSFORM_OBJECT_OPERATION && step.plan.transform.type !== 'translate') {
            context.addIssue({ code: 'custom', message: 'Mixed batch transform_object steps admit translate only.' });
        }
    }
    const textBefore = plan.steps.reduce((sum, step) => sum + (step.operation === REPLACE_POINT_TEXT_OPERATION ? step.plan.before.contents.length : 0), 0);
    const textAfter = plan.steps.reduce((sum, step) => sum + (step.operation === REPLACE_POINT_TEXT_OPERATION ? step.plan.after.contents.length : 0), 0);
    const styleCharacters = plan.steps.reduce((sum, step) => sum +
        (step.operation === SET_TEXT_STYLE_OPERATION || step.operation === BATCH_CHARSTYLE_OPERATION ? step.plan.before.characters.length : 0), 0);
    const transformTextBytes = plan.steps.reduce((sum, step) => sum +
        (step.operation === TRANSFORM_OBJECT_OPERATION ? step.plan.before.textFrame?.attributes.length ?? 0 : 0), 0);
    const nestedBytes = plan.steps.reduce((sum, step) => sum +
        (step.operation === TRANSFORM_OBJECT_OPERATION ? step.plan.before.nestedGroup?.length ?? 0 : 0), 0);
    if (nestedBytes > 8192)
        context.addIssue({ code: 'custom', message: 'Nested batch evidence exceeds 8192 UTF-16 units.' });
    if (textBefore > MIXED_BATCH_MAX_TEXT_CODE_UNITS || textAfter > MIXED_BATCH_MAX_TEXT_CODE_UNITS ||
        styleCharacters > MIXED_BATCH_MAX_STYLE_CHARACTERS || transformTextBytes > MIXED_BATCH_MAX_TRANSFORM_TEXT_EVIDENCE_UNITS) {
        context.addIssue({ code: 'custom', message: 'Mixed batch plan exceeds a measured operation budget.' });
    }
    const blockers = unionBlockers(plan.steps.map(planStepBlockers));
    if (snapshotResultBytes(plan.documentKey, mixedSnapshotResultPairs(plan.documentKey, plan.steps)) > SNAPSHOT_RESULT_ADMISSION_BYTES)
        blockers.push('result_too_large');
    if (!sameCanonical(plan.applyBlockedReasonCodes, blockers)) {
        context.addIssue({ code: 'custom', message: 'Mixed batch blockers must be the ordered union of every step blocker.' });
    }
    const allowed = plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0;
    if (plan.applyAllowed !== allowed) {
        context.addIssue({ code: 'custom', message: 'Mixed batch applyAllowed must require confirmation and no blockers.' });
    }
});
const anySnapshotSchema = z.union(stepOptions((step) => step.snapshotSchema));
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']),
    reasonCode: z.enum(['apply_failed', 'verify_mismatch']),
    message: z.string().min(1).max(500),
}).superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed')) {
        context.addIssue({ code: 'custom', message: 'Mixed batch failure phase and reason code must match.' });
    }
});
const indeterminateFailureSchema = z.strictObject({
    phase: z.literal('apply'), reasonCode: z.literal('apply_indeterminate'), message: z.string().min(1).max(500),
});
const rollbackStepSchema = z.discriminatedUnion('operation', resultStepKeys.map(rollbackStepOption));
function createTransactionSchema(steps = rollbackStepSchema) {
    const rollbackEvidence = {
        attemptedCount: z.number().int().min(0).max(MIXED_BATCH_MAX_STEPS),
        steps: z.array(steps).min(MIXED_BATCH_MIN_STEPS).max(MIXED_BATCH_MAX_STEPS),
    };
    return z.discriminatedUnion('state', [
        z.strictObject({ state: z.literal('planned'), audit: mutationAuditSchema }),
        z.strictObject({ state: z.literal('verified'), audit: mutationAuditSchema }),
        z.strictObject({ state: z.literal('apply_failed'), failure: failureSchema,
            rollback: z.strictObject({ status: z.literal('not_required') }), audit: mutationAuditSchema }),
        z.strictObject({ state: z.literal('rolled_back'), failure: failureSchema,
            rollback: z.strictObject({ status: z.literal('verified'), ...rollbackEvidence }), audit: mutationAuditSchema }),
        z.strictObject({ state: z.literal('rollback_failed'), failure: failureSchema,
            rollback: z.strictObject({ status: z.literal('failed'), reasonCode: z.literal('rollback_failed'),
                message: z.string().min(1).max(500), ...rollbackEvidence }), audit: mutationAuditSchema }),
        z.strictObject({ state: z.literal('apply_indeterminate'), failure: indeterminateFailureSchema,
            rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('mixed_state_unknown'),
                message: z.string().min(1).max(500), ...rollbackEvidence }), audit: mutationAuditSchema }),
        z.strictObject({ state: z.literal('rollback_indeterminate'), failure: failureSchema,
            rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('rollback_indeterminate'),
                message: z.string().min(1).max(500), ...rollbackEvidence }), audit: mutationAuditSchema }),
    ]).superRefine((transaction, context) => {
        const prefix = ['preflight:started:', 'preflight:succeeded:', 'plan:started:', 'plan:succeeded:'];
        let expected;
        if (transaction.state === 'planned') {
            expected = [...prefix, 'apply:skipped:not_requested', 'verify:skipped:not_requested', 'rollback:skipped:not_requested'];
        }
        else if (transaction.state === 'verified') {
            expected = [...prefix, 'apply:started:', 'apply:attempted:', 'apply:succeeded:', 'verify:started:', 'verify:succeeded:', 'rollback:skipped:not_required'];
        }
        else if (transaction.state === 'apply_failed') {
            expected = [...prefix, 'apply:started:', 'apply:failed:apply_failed', 'verify:skipped:not_required', 'rollback:skipped:not_required'];
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
            context.addIssue({ code: 'custom', message: 'Mixed batch audit sequence does not match transaction state.' });
        }
        transaction.audit.forEach((event, index) => {
            if (event.sequence !== index)
                context.addIssue({ code: 'custom', message: 'Mixed batch audit sequence must be contiguous.' });
        });
        if ('failure' in transaction) {
            const matches = transaction.audit.filter((event) => event.event === 'failed' && event.phase === transaction.failure.phase &&
                event.reasonCode === transaction.failure.reasonCode && event.message === transaction.failure.message);
            if (matches.length !== 1)
                context.addIssue({ code: 'custom', message: 'Mixed batch failure must match one audit event.' });
        }
        if ('rollback' in transaction && 'steps' in transaction.rollback) {
            const steps = transaction.rollback.steps;
            const attempted = transaction.rollback.attemptedCount;
            if (attempted > steps.length || steps.some((step, index) => (step.outcome === 'not_written') !== (index >= attempted))) {
                context.addIssue({ code: 'custom', message: 'Mixed batch rollback evidence must mark exactly the unattempted steps as not written.' });
            }
            if (transaction.state !== 'apply_indeterminate' && 'failure' in transaction && transaction.failure.phase === 'verify' &&
                attempted !== steps.length) {
                context.addIssue({ code: 'custom', message: 'A verify failure implies every mixed batch step was attempted.' });
            }
            if (transaction.state === 'rolled_back' &&
                (attempted === 0 || steps.some((step, index) => index < attempted && step.outcome !== 'restored'))) {
                context.addIssue({ code: 'custom', message: 'A rolled-back mixed batch must prove every attempted step restored.' });
            }
            if (transaction.state === 'rollback_failed' &&
                (steps.some((step) => step.outcome === 'indeterminate') || !steps.some((step) => step.outcome === 'outstanding'))) {
                context.addIssue({ code: 'custom', message: 'A failed mixed batch rollback must name an outstanding step and prove the rest.' });
            }
            for (const step of steps) {
                if ((step.outcome === 'restored') !== (step.restoredSnapshot !== null) ||
                    (step.outcome === 'outstanding') !== (step.observedSnapshot !== null) ||
                    [step.restoredSnapshot, step.observedSnapshot].some((snapshot) => snapshot !== null &&
                        (stepSnapshotUuid(requireBatchStep(step.operation), snapshot) ?? step.targetUuid) !== step.targetUuid)) {
                    context.addIssue({ code: 'custom', message: 'Mixed batch rollback step snapshots must match their outcome and target.' });
                }
            }
        }
    });
}
const transactionSchema = createTransactionSchema();
const PUBLIC_ONLY_SNAPSHOTS = BATCH_STEP_REGISTRY.filter((step) => !step.recipeAllowed).map((step) => step.snapshotSchema);
function createBatchResultSchema(includeLayerState) {
    const resultPlan = includeLayerState ? planSchema : planSchema.safeExtend({
        applyBlockedReasonCodes: z.array(legacyBlockerSchema),
        steps: z.array(z.discriminatedUnion('operation', [planStepSchema.options[0], ...planStepSchema.options.slice(1).filter(step => !PUBLIC_ONLY_OPERATIONS.includes(step.shape.operation.value))])).min(MIXED_BATCH_MIN_STEPS).max(MIXED_BATCH_MAX_STEPS),
    });
    const resultSnapshots = includeLayerState ? anySnapshotSchema : z.union([anySnapshotSchema.options[0], ...anySnapshotSchema.options.slice(1).filter(snapshot => !PUBLIC_ONLY_SNAPSHOTS.includes(snapshot))]);
    const resultTransaction = includeLayerState ? transactionSchema : createTransactionSchema(z.discriminatedUnion('operation', [rollbackStepSchema.options[0], ...rollbackStepSchema.options.slice(1).filter(step => !PUBLIC_ONLY_OPERATIONS.includes(step.shape.operation.value))]));
    return z.union([
        z.strictObject({ operation: z.literal(MUTATE_BATCH_OPERATION), applied: z.literal(false),
            document: documentContextSchema, plan: resultPlan, transaction: resultTransaction }),
        z.strictObject({ operation: z.literal(MUTATE_BATCH_OPERATION), applied: z.literal(true),
            document: documentContextSchema, plan: resultPlan,
            postcondition: z.array(resultSnapshots).min(MIXED_BATCH_MIN_STEPS).max(MIXED_BATCH_MAX_STEPS),
            transaction: resultTransaction }),
    ]).superRefine((result, context) => {
        if (context.issues.length !== 0)
            return;
        if (result.transaction.state === 'planned') {
            const exact = result.plan.steps.every((step) => sameCanonical(planStepBlockers(step), derivedStepBlockers(step, result.document.mutationAllowed, result.plan.steps.length)));
            if (result.plan.confirmationStatus !== 'required' || !exact) {
                context.addIssue({ code: 'custom', message: 'Planned mixed batch must expose exact blockers for every step.' });
            }
        }
        else if (result.plan.confirmationStatus !== 'confirmed' || result.plan.applyBlockedReasonCodes.length !== 0 ||
            !result.plan.applyAllowed || result.plan.steps.some((step) => planStepBlockers(step).length !== 0) ||
            result.plan.steps.some((step) => derivedStepBlockers(step, true, result.plan.steps.length).length !== 0)) {
            context.addIssue({ code: 'custom', message: 'Applied mixed batch attempt must derive from an allowed confirmed plan.' });
        }
        const isCharStyleSnapshot = (value) => characterStyleSnapshotSchema.safeParse(value).success;
        if (result.plan.steps.some((step) => step.operation === BATCH_CHARSTYLE_OPERATION) && result.document.colorSpace !== 'RGB') {
            context.addIssue({ code: 'custom', message: 'A character-style batch is measured in an RGB document only.' });
        }
        if (result.applied) {
            const matches = result.transaction.state === 'verified' && result.postcondition.length === result.plan.steps.length &&
                result.plan.steps.every((step, index) => (step.operation !== BATCH_CHARSTYLE_OPERATION || isCharStyleSnapshot(result.postcondition[index])) &&
                    stepSame(step, result.postcondition[index], nestedBatchSnapshot(result.plan.steps, index, true, true)));
            if (!matches)
                context.addIssue({ code: 'custom', message: 'Verified mixed batch must match every planned after snapshot in order.' });
        }
        else if (result.transaction.state === 'verified') {
            context.addIssue({ code: 'custom', message: 'A verified mixed batch transaction must be applied.' });
        }
        if ('rollback' in result.transaction && 'steps' in result.transaction.rollback) {
            const rollbackSteps = result.transaction.rollback.steps;
            if (rollbackSteps.length !== result.plan.steps.length || rollbackSteps.some((step, index) => step.targetUuid !== result.plan.steps[index].targetUuid || step.operation !== result.plan.steps[index].operation)) {
                context.addIssue({ code: 'custom', message: 'Mixed batch rollback evidence must cover every plan step in order.' });
            }
            else if (rollbackSteps.some((step, index) => step.outcome === 'restored' && (!stepSame(result.plan.steps[index], step.restoredSnapshot, nestedBatchSnapshot(result.plan.steps, index, false)) ||
                (step.operation === BATCH_CHARSTYLE_OPERATION && !isCharStyleSnapshot(step.restoredSnapshot))))) {
                context.addIssue({ code: 'custom', message: 'Restored mixed batch steps must prove exact before restoration.' });
            }
        }
    });
}
export const mutateBatchResultSchema = createBatchResultSchema(true);
export const mutateBatchResponseSchema = z.strictObject({
    outcome: mutateBatchResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
export const mutateBatchRecipeResponseSchema = mutateBatchResponseSchema.extend({ outcome: createBatchResultSchema(false) });
export const MUTATE_BATCH_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: MUTATE_BATCH_OPERATION,
    policy: {
        version: 1, class: 'update_existing', destructive: false,
        evidence: { identity: 'target_native_uuid_set', beforeState: 'before_state_hash', postcondition: 'updated_state_matches_plan' },
        preconditions: { documentBinding: 'explicit_document_key', compareAndSet: 'before_state_hash_match' },
        confirmation: 'exact_change_set',
        recovery: { mode: 'verified_inverse', verification: 'restored_state_matches_before_hash', partialRecovery: 'indeterminate' },
        terminal: { success: 'verified', failure: 'proven_pre_apply_or_verified_recovery', partialSuccess: 'nonterminal_until_reconciled' },
        replay: { requestBinding: 'canonical_request_digest', retry: 'return_attested_terminal_result', beforeTerminal: 'reconcile_required', reapplyOnRetry: false },
    },
    capabilities: {
        class: 'update_existing', explicitDocumentBinding: true, bindTargetNativeUuid: true, captureBeforeStateHash: true,
        compareAndSetBeforeApply: true, verifyUpdatedState: true, recoveryMode: 'verified_inverse', verifyRestoredBeforeState: true,
        reconcileIndeterminate: true, durableTerminalReplay: true, trustedTerminalAttestationResolver: true,
    },
});
export const MUTATE_BATCH_SAFETY_IDENTITY = canonicalDigest(MUTATE_BATCH_SAFETY);
function targetEvidence(result) {
    const targetUuids = result.plan.steps.map((step) => step.targetUuid);
    return { targetUuids, targetSetHash: canonicalDigest(targetUuids) };
}
function stepBeforeState(step) {
    return step.operation === BATCH_MOVE_OPERATION
        ? { target: step.plan.before, sourceOrder: step.plan.sourceOrderBefore, destinationOrder: step.plan.destinationOrderBefore }
        : step.plan.before;
}
function stepAfterState(steps, index) {
    const step = steps[index];
    return step.operation === BATCH_MOVE_OPERATION ? nestedBatchSnapshot(steps, index, true, true) : step.plan.after;
}
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    const beforeStateHash = canonicalDigest(result.plan.steps.map(stepBeforeState));
    const afterStateHash = canonicalDigest(result.plan.steps.map((_step, index) => stepAfterState(result.plan.steps, index)));
    const changeSetHash = canonicalDigest({
        steps: result.plan.steps.map((step, index) => ({ operation: step.operation, targetUuid: step.targetUuid, request: stepRequest(step),
            beforeStateHash: canonicalDigest(stepBeforeState(step)), afterStateHash: canonicalDigest(stepAfterState(result.plan.steps, index)) })),
        beforeStateHash, afterStateHash,
    });
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'update_existing', operationId: MUTATE_BATCH_OPERATION, canonicalRequestDigest: requestDigest,
        evidence: { documentKey: admissionDocumentKey, ...targetEvidence(result), beforeStateHash,
            plannedAfterStateHash: afterStateHash, plannedChangeSetDigest: changeSetHash },
        preconditions: { status: result.plan.applyBlockedReasonCodes.length === 0 ? 'satisfied' : 'blocked',
            compareAndSetMatched: result.plan.applyBlockedReasonCodes.length === 0 },
        confirmation: { kind: 'exact_change_set', canonicalRequestDigest: requestDigest, changeSetHash, status: result.plan.confirmationStatus },
        applyAllowed: result.plan.applyAllowed,
    });
}
function safetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' ||
        transaction.state === 'rollback_indeterminate' || transaction.state === 'rollback_failed') {
        throw new Error('Indeterminate or failed mixed batch recovery cannot be terminal.');
    }
    const common = { policyVersion: 1, operationClass: 'update_existing', operationId: MUTATE_BATCH_OPERATION,
        canonicalRequestDigest: requestDigest, planDigest: plan.planDigest, attestation };
    const boundPlan = plan;
    const beforeStateHash = boundPlan.evidence.beforeStateHash;
    const evidence = targetEvidence(result);
    if (transaction.state === 'verified' && result.applied) {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { ...evidence, beforeStateHash, afterStateHash: boundPlan.evidence.plannedAfterStateHash, restoredStateHash: null, restoredBeforeStateVerified: false },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'succeeded', terminal: true, recovery: 'not_required', proof: { kind: 'verified_postcondition' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    if (transaction.state === 'rolled_back') {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { ...evidence, beforeStateHash, afterStateHash: null, restoredStateHash: beforeStateHash, restoredBeforeStateVerified: true },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'recovered', terminal: true, recovery: 'verified', proof: { kind: 'verified_recovery' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    return operationSafetyResultSchema.parse({ ...common,
        evidence: { ...evidence, beforeStateHash, afterStateHash: null, restoredStateHash: null, restoredBeforeStateVerified: false },
        executionEvidence: { outcome: 'proven_pre_apply' },
        resolution: { status: 'failed', terminal: true, recovery: 'not_required', proof: { kind: 'proven_pre_apply', mutationAttempted: false },
            replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
}
async function assertSafety(value, requestDigest, attestation, resolver) {
    const result = mutateBatchResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null)
        throw new Error('Mixed batch terminal result requires attestation.');
    await assertOperationSafetyAdapterConformance({ registration: MUTATE_BATCH_SAFETY, plan,
        result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
const MUTATE_BATCH_HOST_FRAGMENTS = [
    { id: 'mutation-transaction', source: MUTATION_TRANSACTION_SCRIPT },
    { id: 'point-text.snapshot', source: POINT_TEXT_SNAPSHOT_SCRIPT },
    { id: 'point-text.group', source: POINT_TEXT_GROUP_SCRIPT },
    { id: 'point-text.blockers', source: POINT_TEXT_BLOCKERS_SCRIPT },
    { id: 'point-text.character', source: POINT_TEXT_CHARACTER_SCRIPT },
    { id: 'text-style.resource', source: TEXT_STYLE_RESOURCE_SCRIPT },
    { id: 'replace-point-text.module', source: REPLACE_POINT_TEXT_MODULE_SCRIPT },
    { id: 'set-text-style.batch-module', source: SET_TEXT_STYLE_BATCH_MODULE_SCRIPT },
    { id: 'transform-object.module', source: TRANSFORM_OBJECT_MODULE_SCRIPT },
    { id: 'transform.text', source: TRANSFORM_TEXT_SCRIPT },
    { id: 'transform.group', source: TRANSFORM_GROUP_SCRIPT },
    { id: 'set-path-appearance.module', source: SET_PATH_APPEARANCE_MODULE_SCRIPT },
    { id: 'supported-path-item', source: SUPPORTED_PATH_ITEM_HOST_SCRIPT },
    { id: 'set-object-state.module', source: SET_OBJECT_STATE_MODULE_SCRIPT },
    { id: 'layer-ops', source: LAYER_OPS_HOST_SCRIPT },
    { id: 'batch-layer-state', source: BATCH_LAYER_STATE_SCRIPT },
    { id: 'move-object-to-layer.module', source: MOVE_OBJECT_TO_LAYER_MODULE_SCRIPT },
    { id: 'batch-move', source: BATCH_MOVE_SCRIPT },
    { id: 'apply-character-style.module', source: APPLY_CHARACTER_STYLE_MODULE_SCRIPT },
    { id: 'batch-charstyle', source: BATCH_CHARSTYLE_SCRIPT },
];
const HOST_DISPATCH_ORDER = [BATCH_CHARSTYLE_OPERATION, BATCH_MOVE_OPERATION, SET_LAYER_STATE_OPERATION, SET_OBJECT_STATE_OPERATION,
    REPLACE_POINT_TEXT_OPERATION, SET_TEXT_STYLE_OPERATION, TRANSFORM_OBJECT_OPERATION, SET_PATH_APPEARANCE_OPERATION];
const HOST_PARAMS_ORDER = [REPLACE_POINT_TEXT_OPERATION, SET_TEXT_STYLE_OPERATION, TRANSFORM_OBJECT_OPERATION, SET_PATH_APPEARANCE_OPERATION,
    SET_LAYER_STATE_OPERATION, SET_OBJECT_STATE_OPERATION, BATCH_MOVE_OPERATION, BATCH_CHARSTYLE_OPERATION];
const MUTATE_BATCH_RUNNER_FRAGMENTS = [{ id: 'set-object-state.batch', source: SET_OBJECT_STATE_BATCH_SCRIPT }];
const MUTATE_BATCH_HOST_REGIONS = assembleHostFragments([MUTATE_BATCH_HOST_FRAGMENTS, MUTATE_BATCH_RUNNER_FRAGMENTS], BATCH_STEP_REGISTRY);
export const MUTATE_BATCH_SCRIPT = `${SNAPSHOT_RESULT_SIZE_SCRIPT}
${MUTATE_BATCH_HOST_REGIONS[0]}
var OBJECT_STATE_BATCH_MAX_STEPS = ${OBJECT_STATE_BATCH_MAX_STEPS};
var MIXED_BATCH_MIN_STEPS = ${MIXED_BATCH_MIN_STEPS};
var MIXED_BATCH_MAX_STEPS = ${MIXED_BATCH_MAX_STEPS};
var MIXED_BATCH_MAX_TEXT_CODE_UNITS = ${MIXED_BATCH_MAX_TEXT_CODE_UNITS};
var MIXED_BATCH_MAX_STYLE_CHARACTERS = ${MIXED_BATCH_MAX_STYLE_CHARACTERS};
var MIXED_BATCH_MAX_TRANSFORM_TEXT_EVIDENCE_UNITS = ${MIXED_BATCH_MAX_TRANSFORM_TEXT_EVIDENCE_UNITS};
var MIXED_BLOCKER_ORDER = ${JSON.stringify(MIXED_BLOCKERS)};

/**
 * The operation modules read the implicit \`params\`. Each step gets a complete synthetic \`params\` in the
 * exact shape that operation's runner would have read, and every module call runs through
 * withStepParams, which restores the batch params in finally even when the module throws.
 */
${MUTATE_BATCH_HOST_REGIONS[1]}var MIXED_OPERATIONS = {
${inPinnedOrder(BATCH_STEP_REGISTRY, HOST_DISPATCH_ORDER).map(emitBatchHostDispatchRow).join(',\n')}
};

function mixedStepParams(batchParams, request, index) {
  var step = { expectedDocumentKey: batchParams.expectedDocumentKey, apply: batchParams.apply === true,
    targetUuid: request.targetUuid };
  ${inPinnedOrder(BATCH_STEP_REGISTRY, HOST_PARAMS_ORDER).map((step, index) => emitBatchHostParamsBranch(step, index === 0)).join('\n  ')}
  else throw mutationError("preflight_failed", "Step " + (index + 1) + ": unsupported operation " + String(request.operation) + ".");
  if (request.expectedBefore !== undefined) step.expectedBefore = request.expectedBefore;
  if (request.confirmedAfter !== undefined) step.confirmedAfter = request.confirmedAfter;
  if (request.expectedStyle !== undefined) step.expectedStyle = request.expectedStyle;
  return step;
}

function withStepParams(step, fn) {
  var saved = params;
  params = step.params;
  try { return fn(); }
  finally { params = saved; }
}

function mixedStepLabel(step) {
  return "Step " + (step.index + 1) + " (" + step.request.operation + ", " + step.request.targetUuid + ")";
}

/** Re-raises a mutation error with the step named; other errors (MCP_ERROR payloads) pass through. */
function mixedStepError(step, error) {
  if (error && typeof error.mutationPublicMessage === "string" && error.mutationPublicMessage.length > 0) {
    var named = mutationError(error.mutationReasonCode || "preflight_failed", mixedStepLabel(step) + ": " + error.mutationPublicMessage);
    if (error.mutationBeforeSideEffect === true) named.mutationBeforeSideEffect = true;
    return named;
  }
  return error;
}

function mixedUnionBlockers(perStep) {
  var present = {};
  for (var stepIndex = 0; stepIndex < perStep.length; stepIndex++) {
    for (var blockerIndex = 0; blockerIndex < perStep[stepIndex].length; blockerIndex++) present[perStep[stepIndex][blockerIndex]] = true;
  }
  var union = [];
  for (var orderIndex = 0; orderIndex < MIXED_BLOCKER_ORDER.length; orderIndex++) {
    if (present[MIXED_BLOCKER_ORDER[orderIndex]]) union.push(MIXED_BLOCKER_ORDER[orderIndex]);
  }
  return union;
}

/**
 * Resolves the document exactly once, then every step through its module, before any write. Called from
 * preflight and again from revalidate.
 */
function mixedResolve(forApply) {
  var batchParams = params;
  var context = forApply ? requireDocument(batchParams.expectedDocumentKey) : requireDocumentForRead(batchParams.expectedDocumentKey);
  var document = app.activeDocument;
  var requested = batchParams.steps;
  if (!requested || typeof requested.length !== "number" ||
      requested.length < MIXED_BATCH_MIN_STEPS || requested.length > MIXED_BATCH_MAX_STEPS) {
    throw mutationError("preflight_failed", "Mixed batch requires " + MIXED_BATCH_MIN_STEPS + " to " + MIXED_BATCH_MAX_STEPS + " steps.");
  }
  var layerCount = 0, layerPaths = {};
  for (var layerIndex = 0; layerIndex < requested.length; layerIndex++) if (requested[layerIndex].operation === "set_layer_state") {
    layerCount++;var layerPath=stringifyJson(requested[layerIndex].layerPath);
    if(layerPaths[layerPath]===true)throw mutationError("preflight_failed","Duplicate layer path.");layerPaths[layerPath]=true;
  }
  if(layerCount>0 && (layerCount!==requested.length || layerCount!==2))throw mutationError("preflight_failed","Layer batch requires exactly two homogeneous steps.");
  if(layerCount===2){var layerOrder=stringifyJson([requested[0].layerPath,requested[1].layerPath]);if(layerOrder!=="[[0],[1]]"&&layerOrder!=="[[1,0],[1]]"&&layerOrder!=="[[1],[1,0]]")throw mutationError("preflight_failed","Unmeasured layer order.");}
  var stateCount = 0;
  for (var countIndex = 0; countIndex < requested.length; countIndex++) {
    if (requested[countIndex].operation === "set_object_state") {
      stateCount++;
      if (requested[countIndex].targetType !== "PathItem") throw mutationError("preflight_failed", "Object-state batch admits PathItem only.");
      var after = requested[countIndex].after;
      if (!after || typeof after !== "object") throw mutationError("preflight_failed", "Object-state batch requires after.");
      for (var stateProperty in after) {
        if (after.hasOwnProperty(stateProperty) && stateProperty !== "name" && stateProperty !== "opacity" && stateProperty !== "hidden" && stateProperty !== "locked") {
          throw mutationError("preflight_failed", "Object-state batch property is unmeasured: " + stateProperty);
        }
      }
    }
  }
  if (stateCount > 0) {
    if (stateCount !== requested.length || stateCount > OBJECT_STATE_BATCH_MAX_STEPS) {
      throw mutationError("preflight_failed", "Object-state batch requires two or three homogeneous steps.");
    }
    mixedObjectStateProfile(document, context);
  }
  var moveCount = 0;
  for (var moveIndex = 0; moveIndex < requested.length; moveIndex++) if (requested[moveIndex].operation === "move_object_to_layer") moveCount++;
  if (moveCount > 0) {
    if (moveCount !== requested.length || moveCount !== BATCH_MOVE_STEP_COUNT) throw mutationError("preflight_failed", "Layer-move batch requires exactly two homogeneous steps.");
    batchMoveProfile(document, context);
  }
  var charStyleCount = 0;
  for (var charStyleIndex = 0; charStyleIndex < requested.length; charStyleIndex++) if (requested[charStyleIndex].operation === "apply_character_style") charStyleCount++;
  if (charStyleCount > 0) {
    if (charStyleCount !== requested.length || charStyleCount !== BATCH_CHARSTYLE_STEP_COUNT) throw mutationError("preflight_failed", "Character-style batch requires exactly two homogeneous steps.");
    batchCharStyleProfile(document, context);
  }
  var seen = {};
  var entries = [];
  var perStepBlockers = [];
  var textBefore = 0;
  var textAfter = 0;
  var styleCharacters = 0;
  var transformTextBytes = 0;
  var nestedBytes = 0;
  for (var index = 0; index < requested.length; index++) {
    var request = requested[index];
    if (typeof request.targetUuid !== "string" || request.targetUuid.length === 0 || seen["u:" + request.targetUuid] === true) {
      throw mutationError("preflight_failed", "Mixed batch steps must target distinct non-empty native UUIDs.");
    }
    seen["u:" + request.targetUuid] = true;
    var operation = MIXED_OPERATIONS[request.operation];
    var step = { index: index, request: request, params: mixedStepParams(batchParams, request, index) };
    if (!operation) throw mutationError("preflight_failed", mixedStepLabel(step) + ": unsupported operation.");
    var resolved;
    var plan;
    try {
      resolved = withStepParams(step, function () { return operation.resolve(); });
      if (resolved.document !== document) {
        throw mutationError("preflight_failed", "resolved a different document than the batch holds.");
      }
      plan = withStepParams(step, function () { return operation.plan(resolved); });
    } catch (stepError) { throw mixedStepError(step, stepError); }
    if (request.operation === "replace_point_text") { textBefore += plan.before.contents.length; textAfter += plan.after.contents.length; }
    if (request.operation === "set_text_style" || request.operation === "apply_character_style") styleCharacters += plan.before.characters.length;
    if (request.operation === "transform_object" && plan.before.textFrame) transformTextBytes += plan.before.textFrame.attributes.length;
    if (request.operation === "transform_object" && plan.before.nestedGroup) {
      nestedBytes += plan.before.nestedGroup.length;
      var nestedRows=transformNestedRows(plan.before.nestedGroup);
      for(var otherIndex=0;otherIndex<requested.length;otherIndex++){
        for(var childIndex=1;childIndex<nestedRows.length;childIndex++)if(requested[otherIndex].targetUuid===nestedRows[childIndex].uuid && requested[otherIndex].operation!=="transform_object")
          throw mutationError("preflight_failed","Nested translation siblings may only participate in translation steps.");
      }
    }
    if (forApply) {
      if (!operation.same(plan.before, request.expectedBefore)) {
        throw mutationError("preflight_failed", mixedStepLabel(step) + ": state does not match expected_before.");
      }
      if (!operation.same(plan.after, request.confirmedAfter)) {
        throw mutationError("preflight_failed", mixedStepLabel(step) + ": confirmed_after does not match the derived state.");
      }
      if (operation.checkExpected) {
        try { withStepParams(step, function () { operation.checkExpected(plan, request); }); }
        catch (expectedError) { throw mixedStepError(step, expectedError); }
      }
    }
    perStepBlockers.push(plan.applyBlockedReasonCodes || []);
    entries.push({ step: step, resolved: resolved, plan: plan });
  }
  if (textBefore > MIXED_BATCH_MAX_TEXT_CODE_UNITS || textAfter > MIXED_BATCH_MAX_TEXT_CODE_UNITS) {
    throw mutationError("preflight_failed", "Mixed batch point-text contents exceed " + MIXED_BATCH_MAX_TEXT_CODE_UNITS + " UTF-16 code units in total.");
  }
  if (styleCharacters > MIXED_BATCH_MAX_STYLE_CHARACTERS) {
    throw mutationError("preflight_failed", "Mixed batch character-snapshot targets (set_text_style and apply_character_style together) exceed " + MIXED_BATCH_MAX_STYLE_CHARACTERS + " characters in total.");
  }
  if (transformTextBytes > MIXED_BATCH_MAX_TRANSFORM_TEXT_EVIDENCE_UNITS) {
    throw mutationError("preflight_failed", "Mixed batch text-frame translation evidence exceeds " + MIXED_BATCH_MAX_TRANSFORM_TEXT_EVIDENCE_UNITS + " UTF-16 code units in total.");
  }
  if (nestedBytes > 8192) throw mutationError("preflight_failed", "Nested batch evidence exceeds 8192 UTF-16 units.");
  if (charStyleCount > 0) {
    try { batchCharStyleCommon(entries); }
    catch (charStyleCommonError) { throw mixedStepError(entries[charStyleCommonError.charStyleStepIndex || 0].step, charStyleCommonError); }
  }
  var moveSimulated = null;
  if (moveCount > 0) {
    try { moveSimulated = batchMoveCommon(entries); }
    catch (commonError) { throw mixedStepError(entries[0].step, commonError); }
    perStepBlockers = [];
    for (var commonIndex = 0; commonIndex < entries.length; commonIndex++) perStepBlockers.push(entries[commonIndex].plan.applyBlockedReasonCodes);
  }
  if(layerCount===2)batchLayerDerive(entries[0].plan.before,[{layerPath:entries[0].plan.layerPath,after:entries[0].plan.requested},{layerPath:entries[1].plan.layerPath,after:entries[1].plan.requested}]);
  var union = mixedUnionBlockers(perStepBlockers);
  if (forApply && union.length > 0) {
    var blockedUuids = [];
    for (var blockedIndex = 0; blockedIndex < entries.length; blockedIndex++) {
      if (perStepBlockers[blockedIndex].length > 0) blockedUuids.push(entries[blockedIndex].step.request.targetUuid);
    }
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "MUTATE_BATCH_APPLY_BLOCKED", reasonCodes: union, uuids: blockedUuids }));
  }
  return { context: context, document: document, entries: entries, blockers: union, moveSimulated: moveSimulated };
}

function mixedPreflight(forApply) { return mixedResolve(forApply); }

function mixedPlan(preflight) {
  var steps = [];
  for (var index = 0; index < preflight.entries.length; index++) {
    var entry = preflight.entries[index];
    steps.push({ operation: entry.step.request.operation, targetUuid: entry.step.request.targetUuid, plan: entry.plan });
  }
  var plan = {
    operation: "mutate_batch", documentKey: preflight.context.key, steps: steps,
    applyBlockedReasonCodes: preflight.blockers,
    confirmationStatus: params.apply === true ? "confirmed" : "required",
    applyAllowed: params.apply === true && preflight.blockers.length === 0
  };
  var pairs = mixedSnapshotResultPairs(plan.documentKey, steps, false);
  return snapshotResultAdmitPlan(plan, pairs);
}

function mixedRevalidate(preflight, plan) {
  var current;
  // The recorded text profile re-reads only a step's explicit fields here; its recorded part is compared at verification (#681).
  try { STYLE_V3_STATE.revalidating = true; try { current = mixedResolve(true); } finally { STYLE_V3_STATE.revalidating = false; } }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Mixed batch preconditions changed before apply.")); }
  if (current.document !== preflight.document || current.entries.length !== preflight.entries.length) {
    throw mutationBeforeSideEffectError("Mixed batch document or step count changed before apply.");
  }
  for (var index = 0; index < current.entries.length; index++) {
    var operation = MIXED_OPERATIONS[preflight.entries[index].step.request.operation];
    var originalEntry=preflight.entries[index],isTransform=originalEntry.step.request.operation==="transform_object";
    if ((isTransform ? !transformSameTarget(current.entries[index].resolved.target,originalEntry.resolved.target,originalEntry.plan.before) : current.entries[index].resolved.target !== originalEntry.resolved.target) ||
        !operation.same(current.entries[index].plan.before, plan.steps[index].plan.before) ||
        !operation.same(current.entries[index].plan.after, plan.steps[index].plan.after)) {
      throw mutationBeforeSideEffectError(mixedStepLabel(preflight.entries[index].step) + ": target or state changed before apply.");
    }
    if (operation.revalidate) operation.revalidate(current.entries[index], originalEntry, plan.steps[index].plan);
  }
}

function mixedNestedSnapshot(entries,index,after,includeAll) {
  var entry=entries[index],base=after?entry.plan.after:entry.plan.before;
  if(entry.step.request.operation==="set_layer_state"){
    var changes=[];for(var layerIndex=0;layerIndex<(includeAll?entries.length:index+(after?1:0));layerIndex++)changes.push({layerPath:entries[layerIndex].plan.layerPath,after:entries[layerIndex].plan.requested});
    return batchLayerDerive(entry.plan.before,changes);
  }
  if(entry.step.request.operation!=="transform_object" || !entry.plan.before.nestedGroup)return base;
  var evidence=entry.plan.before.nestedGroup,parent=transformNestedRows(evidence)[0].uuid;
  var limit=includeAll?entries.length:index+(after?1:0);
  for(var i=0;i<limit;i++){var other=entries[i];if(other.step.request.operation==="transform_object" && other.plan.before.nestedGroup &&
    transformNestedRows(other.plan.before.nestedGroup)[0].uuid===parent)evidence=transformNestedTranslate(evidence,other.step.request.targetUuid,other.plan.transform.deltaX,other.plan.transform.deltaY);}
  var out={};for(var key in base)if(base.hasOwnProperty(key))out[key]=base[key];out.nestedGroup=evidence;return out;
}
function mixedStepState(entry,entries,index) {
  if (entry.step.request.operation === "move_object_to_layer") {
    var simulated = batchMoveSimulate(entries);
    return { preflight: batchMoveStepPreflight(entry, simulated, index), plan: entry.plan,
      operationState: { mutationStarted: false, written: [], prefix: simulated.prefixes[index],
        finalOrders: { source: simulated.finalSource, destination: simulated.finalDestination },
        rollbackEvidence: { targetUuid: entry.step.request.targetUuid, restoredTarget: null, restoredSourceOrder: null,
          restoredDestinationOrder: null, restoredSnapshot: null } } };
  }
  var rollbackEvidence = entry.step.request.operation === "set_path_appearance"
    ? { targetUuid: entry.step.request.targetUuid, restoredAppearance: null, restoredSnapshot: null }
    : { targetUuid: entry.step.request.targetUuid, restoredSnapshot: null };
  var resolved=entry.resolved;
  if(entry.step.request.operation==="set_layer_state" || (entry.step.request.operation==="transform_object" && entry.plan.before.nestedGroup)){
    resolved={};for(var key in entry.resolved)if(entry.resolved.hasOwnProperty(key))resolved[key]=entry.resolved[key];
    resolved.before=mixedNestedSnapshot(entries,index,false,false);resolved.after=mixedNestedSnapshot(entries,index,true,false);
  }
  return { preflight: resolved, plan: entry.plan,
    operationState: { mutationStarted: false, written: [], rollbackEvidence: rollbackEvidence } };
}

function mixedApply(preflight, plan, state) {
  state.operationState.mutationStarted = true;
  state.operationState.stepStates = [];
  for (var index = 0; index < preflight.entries.length; index++) {
    state.operationState.stepStates.push(mixedStepState(preflight.entries[index],preflight.entries,index));
  }
  for (var applyIndex = 0; applyIndex < preflight.entries.length; applyIndex++) {
    var entry = preflight.entries[applyIndex];
    var operation = MIXED_OPERATIONS[entry.step.request.operation];
    var stepState = state.operationState.stepStates[applyIndex];
    // Recorded before the write: a throw mid-write still counts this step as attempted.
    state.operationState.attemptedCount = applyIndex + 1;
    state.operationState.rollbackEvidence.attemptedCount = applyIndex + 1;
    withStepParams(entry.step, function () { return operation.apply(entry.resolved, entry.plan, stepState); });
  }
  return preflight.entries.length;
}

function mixedVerify(preflight, plan, state) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) {
    throw mutationError("verify_mismatch", "Active document changed during mixed batch verification.");
  }
  var actual = [];
  for (var index = 0; index < preflight.entries.length; index++) {
    var entry = preflight.entries[index];
    var operation = MIXED_OPERATIONS[entry.step.request.operation];
    var snapshot;
    var verifyPlan=entry.plan;
    if(entry.step.request.operation==="set_layer_state" || (entry.step.request.operation==="transform_object" && entry.plan.before.nestedGroup)){
      verifyPlan={};for(var key in entry.plan)if(entry.plan.hasOwnProperty(key))verifyPlan[key]=entry.plan[key];
      verifyPlan.after=mixedNestedSnapshot(preflight.entries,index,true,true);
    }
    try { snapshot = withStepParams(entry.step, function () { return operation.verify(entry.resolved, verifyPlan, state.operationState.stepStates[index]); }); }
    catch (verifyError) { throw mixedStepError(entry.step, verifyError); }
    actual.push(snapshot);
  }
  return actual;
}

function mixedInitialRollbackEvidence() {
  var steps = [];
  for (var index = 0; index < params.steps.length; index++) {
    steps.push({ operation: params.steps[index].operation, targetUuid: params.steps[index].targetUuid,
      outcome: "not_written", restoredSnapshot: null, observedSnapshot: null });
  }
  return { attemptedCount: 0, steps: steps };
}

function mixedMarkIndeterminate(evidence, count) {
  for (var index = 0; index < count; index++) {
    evidence[index].outcome = "indeterminate";
    evidence[index].restoredSnapshot = null;
    evidence[index].observedSnapshot = null;
  }
}

/** Walks the attempted steps in reverse request order through each operation's own rollback. */
function mixedRollback(state) {
  var preflight = state.preflight;
  var evidence = state.operationState.rollbackEvidence.steps;
  var attempted = state.operationState.attemptedCount || 0;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) {
    mixedMarkIndeterminate(evidence, attempted);
    return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
  }
  var firstIndeterminate = null;
  var firstOutstanding = null;
  for (var index = attempted - 1; index >= 0; index--) {
    var entry = preflight.entries[index];
    var operation = MIXED_OPERATIONS[entry.step.request.operation];
    var stepState = state.operationState.stepStates[index];
    var outcome;
    try { outcome = withStepParams(entry.step, function () { return operation.rollback(stepState); }); }
    catch (rollbackError) { outcome = { status: "indeterminate", message: mutationPublicMessage(rollbackError, "operation rollback threw") }; }
    if (!outcome || (outcome.status !== "verified" && outcome.status !== "failed" && outcome.status !== "indeterminate")) {
      outcome = { status: "indeterminate", message: "operation rollback returned an invalid outcome" };
    }
    var observed = stepState.operationState.rollbackEvidence.restoredSnapshot;
    if (outcome.status === "verified") {
      evidence[index].outcome = "restored"; evidence[index].restoredSnapshot = observed; evidence[index].observedSnapshot = null;
    } else if (outcome.status === "failed") {
      evidence[index].outcome = "outstanding"; evidence[index].restoredSnapshot = null; evidence[index].observedSnapshot = observed;
      if (firstOutstanding === null) firstOutstanding = mixedStepLabel(entry.step) + ": " + (outcome.message || "restore did not take effect");
      if (entry.step.request.operation === "move_object_to_layer" && index > 0) {
        // Earlier moves depend on this step's shared orders; do not invert them blindly.
        mixedMarkIndeterminate(evidence, index);
        if (firstIndeterminate === null) firstIndeterminate = "earlier layer moves were not inverted after " + mixedStepLabel(entry.step);
        break;
      }
    } else {
      evidence[index].outcome = "indeterminate"; evidence[index].restoredSnapshot = null; evidence[index].observedSnapshot = null;
      if (firstIndeterminate === null) firstIndeterminate = mixedStepLabel(entry.step) + ": " + (outcome.message || "state is indeterminate");
      if(entry.step.request.operation==="set_layer_state" || entry.step.request.operation==="move_object_to_layer"){mixedMarkIndeterminate(evidence,index);break;}
    }
  }
  if (firstIndeterminate !== null) return { status: "indeterminate", message: "Rollback is indeterminate. " + firstIndeterminate };
  if (firstOutstanding !== null) return { status: "failed", message: "Rollback did not restore every attempted step. " + firstOutstanding };
  if (preflight.entries[0].step.request.operation === "move_object_to_layer" && !batchMoveBaselineRestored(preflight.entries)) {
    return { status: "indeterminate", message: "Layer-move rollback did not read back the complete baseline orders and both targets." };
  }
  if (preflight.entries[0].step.request.operation === "apply_character_style" && !batchCharStyleBaselineRestored(preflight.entries)) {
    return { status: "indeterminate", message: "Character-style rollback did not read back both frames and the style resource as the baseline." };
  }
  return { status: "verified" };
}

var mixedExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionLayers: function (phase, preflight) { return preflight ? batchMoveLayers(preflight.entries) : []; },
  editSessionAffected: function (phase, preflight) {
    var uuids=[],seen={};function add(id){if(!seen.hasOwnProperty(id)){seen[id]=true;uuids.push(id);}}
    for(var i=0;i<params.steps.length;i++)add(params.steps[i].targetUuid);
    if(preflight)for(var j=0;j<preflight.entries.length;j++){var before=preflight.entries[j].plan.before;if(before && before.nestedGroup)add(transformNestedRows(before.nestedGroup)[0].uuid);
      if(preflight.entries[j].step.request.operation==="set_layer_state"){var layerEvidence=parseJsonValue(before.evidence);for(var k=0;k<3;k++)add(layerEvidence.items[k].uuid);}}
    return uuids;
  },
  initialOperationState: function () { return { mutationStarted: false, attemptedCount: 0, stepStates: [],
    rollbackEvidence: mixedInitialRollbackEvidence() }; },
  preflight: mixedPreflight,
  plan: mixedPlan,
  revalidate: mixedRevalidate,
  applyMutation: mixedApply,
  verify: mixedVerify,
  rollback: mixedRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function (state) {
    var steps = state.operationState.rollbackEvidence.steps;
    mixedMarkIndeterminate(steps, steps.length);
    return { reasonCode: "mixed_state_unknown", message: "Mixed batch apply outcome is indeterminate.",
      evidence: { attemptedCount: steps.length, steps: steps } };
  },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var mixedDocument = mixedExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === mixedExecution.preflight.document) mixedDocument = getDocumentContext();
var result = { operation: "mutate_batch", applied: mixedExecution.transaction.state === "verified",
  document: mixedDocument, plan: mixedExecution.plan, transaction: mixedExecution.transaction };
if (mixedExecution.transaction.state === "verified") result.postcondition = mixedExecution.value;
`;
export const MUTATE_BATCH_HOST_SCRIPT_DIGEST = canonicalSha256(MUTATE_BATCH_SCRIPT);
export const MUTATE_BATCH_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: MUTATE_BATCH_OPERATION, validator: MUTATE_BATCH_VALIDATOR,
    canonicalContractVersion: CANONICAL_VERSION, resultSchemaVersion: RESULT_SCHEMA_VERSION,
    terminalClassifierVersion: CLASSIFIER_VERSION, safetyConformanceVersion: CONFORMANCE_VERSION,
    errorMappingVersion: ERROR_MAPPING_VERSION, safetyIdentity: MUTATE_BATCH_SAFETY_IDENTITY,
    hostScriptDigest: MUTATE_BATCH_HOST_SCRIPT_DIGEST, mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    if (request.apply)
        assertSnapshotResultFits(request.expectedDocumentKey, mixedSnapshotResultPairs(request.expectedDocumentKey, request.steps, true));
    for (const step of request.steps)
        registeredBatchStep(step.operation)?.checkInternal?.(step);
    const digestRequest = 'commandId' in request ? (({ commandId: _commandId, ...rest }) => rest)(request) : request;
    const digest = canonicalSha256({ operation: MUTATE_BATCH_OPERATION, validator: MUTATE_BATCH_VALIDATOR,
        request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: 'commandId' in request ? request.commandId : null,
        documentKey: request.expectedDocumentKey, digest };
}
export const mutateBatchToolContract = {
    name: 'illustrator_mutate_batch',
    title: 'Plan or Apply a Mixed Mutation Batch',
    description: `2-16 distinct-UUID edits, one command/host call: all-step preflight, CAS, verify, reverse inverse, attestation. Mixed: point text<=4000 units, one style attribute per step (size, tracking, horizontal/vertical scale or RGB fill; tracking/scales F0 pending)<=200 chars, PathItem/TextFrame translate, appearance. Nested/object-state profiles: docs/tools.md; effects unmeasured. Layer-state: exactly2 paths [0]/[1]/[1,0], RGB root2+child1, direct rectangle each, initially visible/unlocked; name/visible/locked only; target_uuid=sentinel native UUID. Full tree/prefix/effective evidence<=8192 units. Measured orders only; no mixing. Layer F0 passed, public P0 pending. Layer move: exactly 2 steps, root layers, front/back; F0/P0 passed. Char style: exactly 2 steps, one size+tracking style, RGB black layer-direct KozGoPr6N POINTTEXT; F0/P0 passed. Stored result estimate<=209715 UTF-8 bytes including group child lists; result_too_large requires a smaller batch or group evidence. Full contracts: docs/tools.md.`,
    inputSchema,
    publicInputSchema: mutateBatchPublicInputSchema,
    outputSchema: mutateBatchResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(MUTATE_BATCH_SAFETY.policy),
    normalizePublicInput,
};
export function createMutateBatchAdapter() {
    return {
        version: 1, operation: MUTATE_BATCH_OPERATION, validator: MUTATE_BATCH_VALIDATOR,
        safety: MUTATE_BATCH_SAFETY, safetyRegistrationIdentity: MUTATE_BATCH_SAFETY_IDENTITY,
        adapterIdentity: MUTATE_BATCH_ADAPTER_IDENTITY, tool: mutateBatchToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: mutateBatchResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: CLASSIFIER_VERSION, safetyConformanceVersion: CONFORMANCE_VERSION,
        errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: MUTATE_BATCH_HOST_SCRIPT_DIGEST,
        mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: MUTATE_BATCH_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: MUTATE_BATCH_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: MUTATE_BATCH_OPERATION,
                    documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: MUTATE_BATCH_ADAPTER_IDENTITY, mutationHostApplicationMode: 'foreground',
                script: MUTATE_BATCH_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = mutateBatchResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back')
                return { state };
            if (state === 'planned')
                throw new Error('Mixed batch plan is not a terminal mutation result.');
            throw new Error('Unverified mixed batch recovery must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error, detail) {
            if (detail?.code === 'OBJECT_NOT_FOUND') {
                return new Error(`No PageItem with UUID ${JSON.stringify(detail.uuid ?? '')} exists in the bound document.`);
            }
            if (detail?.code === 'LAYER_PATH_INVALID')
                return new Error('Destination layer path is invalid.');
            if (detail?.code === 'LAYER_PATH_NOT_FOUND')
                return new Error('Destination layer path does not exist.');
            if (detail?.code === 'MOVE_SAME_LAYER')
                return new Error('Source and destination layers must be different.');
            if (detail?.code === 'MUTATE_BATCH_APPLY_BLOCKED') {
                const uuids = detail.uuids ?? [];
                return new Error(`Mixed batch is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}` +
                    `${uuids.length > 0 ? ` (targets ${uuids.map((uuid) => JSON.stringify(uuid)).join(', ')})` : ''}.`);
            }
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
export function mutateBatchStepRequest(step) {
    return stepRequest(step);
}
export function mutateBatchComparedState(steps, index, after) {
    return nestedBatchSnapshot(steps, index, after, after);
}
