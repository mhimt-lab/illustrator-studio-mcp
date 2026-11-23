import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema } from '../mutation-result-schema-core.js';
import { canonicalDigest, operationSafetyPolicyToMcpAnnotations } from '../operation-safety-policy-core.js';
import { AREA_TEXT_SNAPSHOT_SCRIPT } from './area-text-host-script.js';
import { GuidedRefusalError } from '../blocked-guidance.js';
import { assertSnapshotResultFits, snapshotResultBytes, SNAPSHOT_RESULT_ADMISSION_BYTES, SNAPSHOT_RESULT_SIZE_SCRIPT } from './snapshot-result-size.js';
import { validateClusterRange } from './point-text-cluster.js';
import { POINT_TEXT_BLOCKERS_SCRIPT, POINT_TEXT_SNAPSHOT_SCRIPT, pointTextApplyBlockers } from './point-text-host-script.js';
import { classifyTextLayoutTerminal, mapTextLayoutError, sameCanonical, textLayoutBlockerSchema, textLayoutSafetyAsserter, textLayoutSafetyRegistration, textLayoutTransactionSchema, } from './text-layout-shared.js';
import { COMPOSITION_EXTRA_BLOCKERS, COMPOSITION_ROUTES, compositionLayoutSchema, compositionMayBlockInverse, compositionResultPairs, kinsokuRequestSchema, mojikumiRequestSchema, justificationSchema, paragraphLeadingSpan, predictCompositionParagraphs, compositionSnapshotInputSchema, compositionSnapshotSchema, kerningMethodSchema, predictCompositionCharacterRuns, isTrackingScaleOnly, HORIZONTAL_SCALE_DECIMALS, TEXT_COMPOSITION_MODULE_SCRIPT, TEXT_COMPOSITION_PROFILE_NAME, } from './text-composition-profile.js';
export const SET_TEXT_COMPOSITION_OPERATION = 'set_text_composition';
export const SET_TEXT_COMPOSITION_VALIDATOR = { kind: SET_TEXT_COMPOSITION_OPERATION, version: 1 };
const CANONICAL_VERSION = 2;
const RESULT_SCHEMA_VERSION = 2;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
const blockerSchema = z.enum([...textLayoutBlockerSchema.options, ...COMPOSITION_EXTRA_BLOCKERS, 'result_too_large']);
function compositionOversized(plan) {
    return snapshotResultBytes(plan.documentKey ?? '', compositionResultPairs(plan), plan.before.contents.length) > SNAPSHOT_RESULT_ADMISSION_BYTES;
}
const snapshotSchema = compositionSnapshotSchema;
const snapshotInputSchema = compositionSnapshotInputSchema;
const rangeFields = {
    start: z.number().int().safe().nonnegative(),
    end: z.number().int().safe().nonnegative(),
};
const trackingSchema = z.number().int().min(-1_000).max(1_000);
const horizontalScaleSchema = z.number().min(1).max(1_000);
const charactersPublicSchema = z.strictObject({
    ...rangeFields,
    proportional_metrics: z.boolean().optional(),
    kerning_method: kerningMethodSchema.optional(),
    tracking: trackingSchema.optional(),
    horizontal_scale: horizontalScaleSchema.optional(),
});
const charactersInternalSchema = z.strictObject({
    ...rangeFields,
    proportionalMetrics: z.boolean().optional(),
    kerningMethod: kerningMethodSchema.optional(),
    tracking: trackingSchema.optional(),
    horizontalScale: horizontalScaleSchema.optional(),
});
const planCharactersSchema = z.strictObject({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    proportionalMetrics: z.boolean().optional(),
    kerningMethod: kerningMethodSchema.optional(),
    tracking: trackingSchema.optional(),
    horizontalScale: horizontalScaleSchema.optional(),
});
const LEADING_SCALE = 100_000;
const leadingRequestSchema = z.union([z.literal('auto'), z.number().finite().positive().max(1_296)]);
const paragraphRequestSchema = z.strictObject({
    index: z.number().int().safe().nonnegative(),
    mojikumi: mojikumiRequestSchema.optional(),
    kinsoku: kinsokuRequestSchema.optional(),
    justification: justificationSchema.optional(),
    leading: leadingRequestSchema.optional(),
});
const akiValueRequestSchema = z.union([z.literal('auto'), z.literal(0), z.literal(0.125), z.literal(0.25), z.literal(0.5), z.literal(0.75), z.literal(1)]);
const akiRequestSchema = z.array(z.strictObject({
    start: z.number().int().safe().nonnegative(),
    end: z.number().int().safe().positive(),
    left: akiValueRequestSchema.optional(),
    right: akiValueRequestSchema.optional(),
})).min(1).max(500);
const paragraphsRequestSchema = z.array(paragraphRequestSchema).min(1).max(1_000);
const layoutSchema = compositionLayoutSchema;
const routeSchema = z.strictObject({ index: z.number().int().nonnegative(), route: z.enum(COMPOSITION_ROUTES) });
export const setTextCompositionPlanSchema = z.strictObject({
    operation: z.literal(SET_TEXT_COMPOSITION_OPERATION),
    documentKey: z.string().min(1).max(16_384),
    targetUuid: z.string().min(1).max(255),
    characters: planCharactersSchema.optional(),
    paragraphs: paragraphsRequestSchema.optional(),
    aki: akiRequestSchema.optional(),
    before: snapshotSchema,
    after: snapshotSchema,
    layoutBefore: layoutSchema,
    applyBlockedReasonCodes: z.array(blockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    if (plan.targetUuid !== plan.before.uuid || plan.before.uuid !== plan.after.uuid) {
        context.addIssue({ code: 'custom', message: 'A text-composition plan must bind one target UUID.' });
    }
    if (plan.characters === undefined && plan.paragraphs === undefined && plan.aki === undefined) {
        context.addIssue({ code: 'custom', message: 'A text-composition plan must change at least one attribute.' });
    }
    else {
        let valid = true;
        if (plan.characters !== undefined) {
            const { start, end } = plan.characters;
            if (start >= end || end > plan.before.contents.length) {
                valid = false;
                context.addIssue({ code: 'custom', message: 'A character range must be a non-empty span inside the target.' });
            }
            else if (plan.before.contents.substring(start, end).includes('\r') && !isTrackingScaleOnly(plan.characters)) {
                valid = false;
                context.addIssue({ code: 'custom', message: 'A character range must not contain a paragraph break.' });
            }
        }
        if (plan.paragraphs !== undefined) {
            const indexes = plan.paragraphs.map((item) => item.index);
            if (new Set(indexes).size !== indexes.length || indexes.some((index) => index >= plan.before.paragraphs.length) ||
                plan.paragraphs.some((item) => !paragraphNamesSomething(item))) {
                valid = false;
                context.addIssue({ code: 'custom', message: 'Requested paragraphs must be distinct, inside the target and name a set to write.' });
            }
        }
        if (plan.aki !== undefined && akiShapeError(plan.before.contents, plan.aki) !== null) {
            valid = false;
            context.addIssue({ code: 'custom', message: 'Aki ranges must be sorted, disjoint, non-empty spans inside the target without a paragraph break.' });
        }
        if (valid && !sameCanonical(predictedAfter(plan.before, plan.characters, plan.paragraphs, plan.aki), plan.after)) {
            context.addIssue({ code: 'custom', message: 'A text-composition plan may move only the requested attributes.' });
        }
    }
    const allowed = plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0;
    if (plan.applyAllowed !== allowed) {
        context.addIssue({ code: 'custom', message: 'Text-composition applyAllowed must require confirmation and no blockers.' });
    }
});
function paragraphNamesSomething(item) {
    return item.mojikumi !== undefined || item.kinsoku !== undefined || item.justification !== undefined || item.leading !== undefined;
}
function akiShapeError(contents, aki) {
    let last = 0;
    for (const entry of aki) {
        if (entry.left === undefined && entry.right === undefined)
            return 'each aki range needs left or right';
        if (entry.start < last || entry.end <= entry.start)
            return 'aki ranges must be sorted, non-empty and must not overlap';
        if (entry.end > contents.length)
            return 'an aki range is outside the target contents';
        if (contents.substring(entry.start, entry.end).includes('\r'))
            return 'an aki range contains a paragraph break';
        const rejection = validateClusterRange(contents, entry.start, entry.end);
        if (rejection !== null)
            return rejection.reason;
        last = entry.end;
    }
    return null;
}
export function predictedAfter(before, characters, paragraphs = undefined, aki = undefined) {
    const leading = (paragraphs ?? []).flatMap((item) => (item.leading === undefined ? [] : [{ span: paragraphLeadingSpan(before.contents, item.index), value: item.leading }]));
    const runs = characters !== undefined || leading.length > 0 || aki !== undefined;
    const refit = before.fit?.status === 'overflows' && paragraphs === undefined && aki === undefined && isTrackingScaleOnly(characters);
    return {
        ...before,
        ...(refit ? { fit: { status: 'fits', visibleCharacterCount: before.contents.replace(/[\r\n\u0003]/gu, '').length } } : {}),
        ...(runs ? { characterRuns: predictCompositionCharacterRuns(before.characterRuns, characters, aki ?? [], leading) } : {}),
        ...(paragraphs === undefined ? {} : { paragraphs: predictCompositionParagraphs(before.paragraphs, paragraphs) }),
    };
}
const transactionSchema = textLayoutTransactionSchema('Text-composition', snapshotSchema);
export const setTextCompositionResultSchema = z.union([
    z.strictObject({
        operation: z.literal(SET_TEXT_COMPOSITION_OPERATION), applied: z.literal(false),
        document: documentContextSchema, plan: setTextCompositionPlanSchema, transaction: transactionSchema,
    }),
    z.strictObject({
        operation: z.literal(SET_TEXT_COMPOSITION_OPERATION), applied: z.literal(true),
        document: documentContextSchema, plan: setTextCompositionPlanSchema,
        postcondition: snapshotSchema, transaction: transactionSchema,
        layout: z.strictObject({ before: layoutSchema, after: layoutSchema }),
        routes: z.array(routeSchema).optional(),
        akiRoutes: z.array(routeSchema).optional(),
        trackingRoutes: z.array(routeSchema).optional(),
    }),
]).superRefine((result, context) => {
    if (result.transaction.state === 'planned') {
        const blockers = [...pointTextApplyBlockers(result.document.mutationAllowed, result.plan.before)];
        const reported = result.plan.applyBlockedReasonCodes;
        const size = compositionOversized(result.plan) ? ['result_too_large'] : [];
        const withExtra = [...blockers, ...COMPOSITION_EXTRA_BLOCKERS, ...size];
        const reportedMatches = sameCanonical(reported, [...blockers, ...size]) ||
            (compositionMayBlockInverse(result.plan.before.paragraphs, result.plan.paragraphs, result.plan.before.characterRuns, result.plan.aki, result.plan.characters) && sameCanonical(reported, withExtra));
        if (result.plan.confirmationStatus !== 'required' || !reportedMatches) {
            context.addIssue({ code: 'custom', message: 'A planned text-composition change must expose exact blockers.' });
        }
    }
    else if (result.plan.confirmationStatus !== 'confirmed' || result.plan.applyBlockedReasonCodes.length !== 0 || !result.plan.applyAllowed) {
        context.addIssue({ code: 'custom', message: 'An applied text-composition change must derive from an allowed confirmed plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified' || !sameCanonical(result.postcondition, result.plan.after)) {
            context.addIssue({ code: 'custom', message: 'A verified text-composition change must match the exact after snapshot.' });
        }
        if (!sameCanonical(result.layout.before, result.plan.layoutBefore)) {
            context.addIssue({ code: 'custom', message: 'A verified text-composition change must report the line layout it planned from.' });
        }
        const requested = result.plan.paragraphs?.map((item) => item.index) ?? null;
        if ((requested === null) !== (result.routes === undefined) || (requested !== null && !sameCanonical(result.routes.map((entry) => entry.index), requested))) {
            context.addIssue({ code: 'custom', message: 'A verified text-composition change reports the route of exactly the requested paragraphs.' });
        }
        if ((result.plan.aki === undefined) !== (result.akiRoutes === undefined)) {
            context.addIssue({ code: 'custom', message: 'A verified text-composition change reports aki routes exactly when aki was requested.' });
        }
        if ((result.plan.characters?.tracking === undefined) !== (result.trackingRoutes === undefined)) {
            context.addIssue({ code: 'custom', message: 'A verified text-composition change reports tracking routes exactly when tracking was requested.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified text-composition transaction must be applied.' });
    }
    if (result.transaction.state === 'rolled_back' && !sameCanonical(result.transaction.rollback.restoredSnapshot, result.plan.before)) {
        context.addIssue({ code: 'custom', message: 'A rolled-back text-composition change must prove exact before restoration.' });
    }
});
export const setTextCompositionResponseSchema = z.strictObject({
    outcome: setTextCompositionResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
const commonInternal = {
    expectedDocumentKey: z.string().min(1).max(16_384),
    targetUuid: z.string().min(1).max(255),
    characters: charactersInternalSchema.optional(),
    paragraphs: paragraphsRequestSchema.optional(),
    aki: akiRequestSchema.optional(),
};
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({
        ...commonInternal,
        expectedBefore: snapshotInputSchema,
        confirmedAfter: snapshotInputSchema,
        apply: z.literal(true),
        commandId: canonicalCommandIdSchema,
    }),
]);
const commonPublic = {
    expected_document_key: z.string().min(1).max(16_384),
    target_uuid: z.string().min(1).max(255),
    characters: charactersPublicSchema.optional(),
    paragraphs: paragraphsRequestSchema.optional(),
    aki: akiRequestSchema.optional(),
};
export const setTextCompositionPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({
        ...commonPublic,
        expected_before: snapshotInputSchema,
        confirmed_after: snapshotInputSchema,
        apply: z.literal(true),
        command_id: applyCommandIdSchema,
    }),
]);
const inputSchema = z.strictObject({
    ...commonPublic,
    expected_before: snapshotInputSchema.optional(),
    confirmed_after: snapshotInputSchema.optional(),
    apply: z.boolean().default(false),
    command_id: applyCommandIdSchema.optional(),
});
const echoPublished = z.record(z.string(), z.unknown()).describe("Copy of the plan's before / after snapshot, exactly as the plan returned it (use the plan's next_call).");
const publishedPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({ ...commonPublic, expected_before: echoPublished, confirmed_after: echoPublished, apply: z.literal(true), command_id: applyCommandIdSchema }),
]);
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(publishedPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function requestCharacters(value) {
    if (value === undefined)
        return undefined;
    const { proportional_metrics: proportionalMetrics, kerning_method: kerningMethod, horizontal_scale: horizontalScale, tracking, ...range } = value;
    return { ...range, ...(proportionalMetrics === undefined ? {} : { proportionalMetrics }), ...(kerningMethod === undefined ? {} : { kerningMethod }),
        ...(tracking === undefined ? {} : { tracking }), ...(horizontalScale === undefined ? {} : { horizontalScale }) };
}
function assertRequestShape(characters, paragraphs, aki = undefined) {
    if (characters === undefined && paragraphs === undefined && aki === undefined)
        throw new Error('A text-composition request needs at least one of: characters, paragraphs, aki.');
    if (aki !== undefined) {
        const shape = akiShapeError('\u0000'.repeat(Math.max(...aki.map((entry) => entry.end))), aki);
        if (shape !== null)
            throw new Error(`Text-composition request is unsupported: ${shape}.`);
    }
    if (characters !== undefined) {
        if (characters.proportionalMetrics === undefined && characters.kerningMethod === undefined && characters.tracking === undefined && characters.horizontalScale === undefined) {
            throw new Error('characters needs proportional_metrics, kerning_method, tracking or horizontal_scale.');
        }
        if (characters.horizontalScale !== undefined && Math.round(characters.horizontalScale * 10 ** HORIZONTAL_SCALE_DECIMALS) / 10 ** HORIZONTAL_SCALE_DECIMALS !== characters.horizontalScale) {
            throw new Error(`horizontal_scale must be a percent of at most ${HORIZONTAL_SCALE_DECIMALS} decimals; Illustrator keeps it as a single-precision fraction, so a longer number would not read back as written.`);
        }
        if (characters.start >= characters.end)
            throw new Error('characters.start must be less than characters.end.');
    }
    if (paragraphs !== undefined) {
        if (paragraphs.some((item) => !paragraphNamesSomething(item)))
            throw new Error('Each paragraphs entry needs mojikumi, kinsoku, justification or leading.');
        if (paragraphs.some((item) => typeof item.leading === 'number' && Math.round(item.leading * LEADING_SCALE) / LEADING_SCALE !== item.leading)) {
            throw new Error('leading must be positive points with at most five decimals, or auto.');
        }
        if (new Set(paragraphs.map((item) => item.index)).size !== paragraphs.length)
            throw new Error('paragraphs must name each paragraph index once.');
    }
}
function normalizePublicInput(input) {
    const value = setTextCompositionPublicInputSchema.parse(input);
    const characters = requestCharacters(value.characters);
    assertRequestShape(characters, value.paragraphs, value.aki);
    const common = { expectedDocumentKey: value.expected_document_key, targetUuid: value.target_uuid, ...(characters === undefined ? {} : { characters }),
        ...(value.paragraphs === undefined ? {} : { paragraphs: value.paragraphs }), ...(value.aki === undefined ? {} : { aki: value.aki }) };
    return value.apply
        ? { ...common, expectedBefore: value.expected_before, confirmedAfter: value.confirmed_after, apply: true, commandId: value.command_id }
        : { ...common, apply: false };
}
export const SET_TEXT_COMPOSITION_SAFETY = textLayoutSafetyRegistration(SET_TEXT_COMPOSITION_OPERATION);
export const SET_TEXT_COMPOSITION_SAFETY_IDENTITY = canonicalDigest(SET_TEXT_COMPOSITION_SAFETY);
export const SET_TEXT_COMPOSITION_RUNNER_SCRIPT = `var tcExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionAffected: function () { return [params.targetUuid]; },
  initialOperationState: function () {
    return { mutationStarted: false, rollbackEvidence: { targetUuid: params.targetUuid, restoredSnapshot: null } };
  },
  preflight: tcPreflight,
  plan: tcPlan,
  revalidate: tcRevalidate,
  applyMutation: tcApply,
  verify: tcVerify,
  rollback: tcRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () {
    return { reasonCode: "text_state_unknown", message: "Text-composition apply outcome is indeterminate.",
      evidence: { targetUuid: params.targetUuid, restoredSnapshot: null } };
  },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var tcDocument = tcExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === tcExecution.preflight.document) {
  tcDocument = getDocumentContext();
}
var result = { operation: "set_text_composition",
  applied: tcExecution.transaction.state === "verified",
  document: tcDocument, plan: tcExecution.plan, transaction: tcExecution.transaction };
if (tcExecution.transaction.state === "verified") {
  result.postcondition = tcExecution.value;
  result.layout = { before: tcExecution.preflight.layoutBefore, after: tcExecution.preflight.layoutAfter };
  if (params.paragraphs) result.routes = TC_STATE.routes;
  if (params.aki) result.akiRoutes = TC_STATE.akiRoutes;
  if (params.characters && params.characters.tracking !== undefined) result.trackingRoutes = TC_STATE.trackingRoutes;
}
`;
export const SET_TEXT_COMPOSITION_SCRIPT = `${SNAPSHOT_RESULT_SIZE_SCRIPT}
${MUTATION_TRANSACTION_SCRIPT}
${POINT_TEXT_SNAPSHOT_SCRIPT}
${POINT_TEXT_BLOCKERS_SCRIPT}
${AREA_TEXT_SNAPSHOT_SCRIPT}
${TEXT_COMPOSITION_MODULE_SCRIPT}${SET_TEXT_COMPOSITION_RUNNER_SCRIPT}`;
export const SET_TEXT_COMPOSITION_HOST_SCRIPT_DIGEST = canonicalSha256(SET_TEXT_COMPOSITION_SCRIPT);
export const SET_TEXT_COMPOSITION_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: SET_TEXT_COMPOSITION_OPERATION,
    validator: SET_TEXT_COMPOSITION_VALIDATOR, canonicalContractVersion: CANONICAL_VERSION,
    resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: SET_TEXT_COMPOSITION_SAFETY_IDENTITY, hostScriptDigest: SET_TEXT_COMPOSITION_HOST_SCRIPT_DIGEST,
    mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    assertRequestShape(request.characters, request.paragraphs, request.aki);
    if (request.apply && request.aki !== undefined) {
        const shape = akiShapeError(request.expectedBefore.contents, request.aki);
        if (shape !== null)
            throw new Error(`Text-composition request is unsupported: ${shape}.`);
    }
    if (request.apply && request.paragraphs !== undefined && request.paragraphs.some((item) => item.index >= request.expectedBefore.paragraphs.length)) {
        throw new Error('A requested paragraph index is outside the target contents.');
    }
    if (request.apply && request.characters !== undefined) {
        const contents = request.expectedBefore.contents;
        if (request.characters.end > contents.length)
            throw new Error('characters.end is outside the target contents.');
        if (contents.substring(request.characters.start, request.characters.end).includes('\r') && !isTrackingScaleOnly(request.characters)) {
            throw new Error('Text-composition request is unsupported: the character range contains a paragraph break; write each paragraph with its own call.');
        }
        const rejection = validateClusterRange(contents, request.characters.start, request.characters.end);
        if (rejection !== null)
            throw new Error(`Text-composition request is unsupported: ${rejection.reason}.`);
    }
    if (request.apply) {
        assertSnapshotResultFits(request.expectedDocumentKey, compositionResultPairs({ targetUuid: request.targetUuid, before: request.expectedBefore,
            after: request.confirmedAfter, characters: request.characters, paragraphs: request.paragraphs, aki: request.aki }), request.expectedBefore.contents.length);
    }
    const digestRequest = 'commandId' in request ? (({ commandId: _commandId, ...rest }) => rest)(request) : request;
    const digest = canonicalSha256({ operation: SET_TEXT_COMPOSITION_OPERATION, validator: SET_TEXT_COMPOSITION_VALIDATOR,
        request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: 'commandId' in request ? request.commandId : null,
        documentKey: request.expectedDocumentKey, digest };
}
export const setTextCompositionToolContract = {
    name: 'illustrator_set_text_composition',
    title: 'Plan or Set Text Composition (palt, kerning, tracking, horizontal scale, mojikumi, kinsoku)',
    description: 'Plan or apply, on one layer-direct, unthreaded, horizontal point-text or area-text frame (area: 1 to 20 columns, one row, whole text visible): palt (proportional_metrics) and kerning_method (none, auto, optical, metrics_roman_only) over a range inside ONE paragraph; tracking (integer) and horizontal_scale (percent, 1 to 1000, up to 4 decimals) over any range, paragraph breaks included (the next_call of illustrator_plan_text_fit), also on an overflowing frame: kept only if the whole text is then shown, else undone; per named paragraph mojikumi / kinsoku sets (or none), justification (area text only) and leading (points, or auto; every character of the paragraph and its paragraph mark); and aki: sorted ranges with left / right aki in em (auto, 0, 0.125, 0.25, 0.5, 0.75, 1), e.g. the kana or kanji next to figures. Bound by expected_document_key and native UUID. Everything else is recorded and must read the same afterwards. Ranges that split a character or (palt, kerning_method) contain a paragraph break, vertical text, overflowing frames, frames with an empty paragraph (an empty line: use space before / after) and manual pair kerning are refused; a change that makes area text overflow is rolled back; a tracking / scale range over 1,500 characters must be the whole frame or one whole paragraph. Illustrator ignores a write of a default value that would remove the last override (measured): the tool then resets that paragraph with the standard paragraph style and writes every changed attribute back (result.routes / akiRoutes: direct or compound_reset; custom styles, tab stops and list styles are refused for the reset). Lines and bounds are returned before and after (observation). A request whose stored result would be too large is blocked (result_too_large): split the frame\'s changes over several calls or use a smaller frame. Apply uses compare-and-set with a verified inverse.',
    inputSchema,
    publicInputSchema: setTextCompositionPublicInputSchema,
    outputSchema: setTextCompositionResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(SET_TEXT_COMPOSITION_SAFETY.policy),
    normalizePublicInput,
};
function safetyView(value) {
    const result = setTextCompositionResultSchema.parse(value);
    return {
        operationId: SET_TEXT_COMPOSITION_OPERATION, documentKey: result.document.key, targetUuid: result.plan.targetUuid,
        before: result.plan.before, after: result.plan.after,
        changeSet: { characters: result.plan.characters ?? null, paragraphs: result.plan.paragraphs ?? null, aki: result.plan.aki ?? null },
        blocked: result.plan.applyBlockedReasonCodes.length > 0,
        confirmationStatus: result.plan.confirmationStatus, applyAllowed: result.plan.applyAllowed,
        transactionState: result.transaction.state, applied: result.applied,
    };
}
export function createSetTextCompositionAdapter() {
    return {
        version: 1, operation: SET_TEXT_COMPOSITION_OPERATION, validator: SET_TEXT_COMPOSITION_VALIDATOR,
        safety: SET_TEXT_COMPOSITION_SAFETY, safetyRegistrationIdentity: SET_TEXT_COMPOSITION_SAFETY_IDENTITY,
        adapterIdentity: SET_TEXT_COMPOSITION_ADAPTER_IDENTITY, tool: setTextCompositionToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: setTextCompositionResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: CLASSIFIER_VERSION, safetyConformanceVersion: CONFORMANCE_VERSION,
        errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: SET_TEXT_COMPOSITION_HOST_SCRIPT_DIGEST,
        mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: SET_TEXT_COMPOSITION_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: SET_TEXT_COMPOSITION_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: SET_TEXT_COMPOSITION_OPERATION,
                    documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: SET_TEXT_COMPOSITION_ADAPTER_IDENTITY,
                mutationHostApplicationMode: 'foreground', script: SET_TEXT_COMPOSITION_SCRIPT, params };
        },
        classifyTerminal(value) { return classifyTextLayoutTerminal(setTextCompositionResultSchema.parse(value).transaction.state, 'Text-composition'); },
        assertSafetyConformance: textLayoutSafetyAsserter(SET_TEXT_COMPOSITION_SAFETY, safetyView),
        mapExecutionError(error, detail) {
            if (detail?.code === 'COMPOSITION_REFUSED')
                return new GuidedRefusalError(detail.reason ?? 'unsupported', detail.message ?? 'The text-composition request is refused.');
            return mapTextLayoutError('Text-composition change', error, detail);
        },
    };
}
export { TEXT_COMPOSITION_PROFILE_NAME };
