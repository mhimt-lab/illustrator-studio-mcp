import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, layerPathSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { normalizePointTextPublicFillColor, POINT_TEXT_JUSTIFICATIONS, POINT_TEXT_MAX_LAYER_DEPTH_LIMIT, POINT_TEXT_PROFILE_NAME, POINT_TEXT_SNAPSHOT_SCRIPT, pointTextFillColorRequestSchema, pointTextFillColorSchema, pointTextPublicFillColorSchema, pointTextSingleLineSchema, pointTextSnapshotSchema, } from './point-text-host-script.js';
export const CREATE_POINT_TEXT_OPERATION = 'create_point_text';
export const CREATE_POINT_TEXT_VALIDATOR = { kind: CREATE_POINT_TEXT_OPERATION, version: 1 };
export const CREATE_POINT_TEXT_MAX_DIRECT_ITEMS = 128;
const CANONICAL_VERSION = 3;
const RESULT_SCHEMA_VERSION = 3;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
const canonicalNumberSchema = z.number().finite().transform((value) => Object.is(value, -0) ? 0 : value);
const requestedStyleSchema = z.strictObject({
    fontPostScriptName: z.string().min(1).max(255),
    size: z.number().finite().positive(),
    tracking: z.number().finite(),
    justification: z.enum(POINT_TEXT_JUSTIFICATIONS),
    fillColor: pointTextFillColorSchema,
});
const requestedStyleRequestSchema = z.strictObject({
    fontPostScriptName: z.string().min(1).max(255),
    size: canonicalNumberSchema.pipe(z.number().positive()),
    tracking: canonicalNumberSchema,
    justification: z.enum(POINT_TEXT_JUSTIFICATIONS),
    fillColor: pointTextFillColorRequestSchema,
});
const publicStyleSchema = z.strictObject({
    font_post_script_name: z.string().min(1).max(255),
    size: z.number().finite().positive(),
    tracking: z.number().finite(),
    justification: z.enum(POINT_TEXT_JUSTIFICATIONS).optional(),
    fill_color: pointTextPublicFillColorSchema,
});
const anchorSchema = z.tuple([z.number().finite(), z.number().finite()]);
const anchorRequestSchema = z.tuple([canonicalNumberSchema, canonicalNumberSchema]);
const publicAnchorSchema = anchorSchema;
export const createPointTextLayerStateSchema = z.strictObject({
    path: layerPathSchema,
    name: z.string().max(255),
    visible: z.boolean(),
    locked: z.boolean(),
    itemUuids: z.array(z.string().min(1).max(255)).max(CREATE_POINT_TEXT_MAX_DIRECT_ITEMS),
    ancestry: z.array(z.strictObject({
        name: z.string().max(255),
        visible: z.boolean(),
        locked: z.boolean(),
    })).min(1).max(POINT_TEXT_MAX_LAYER_DEPTH_LIMIT),
});
const blockerSchema = z.enum([
    'document_mutation_not_allowed',
    'layer_hidden',
    'layer_locked',
    'layer_item_capacity_exceeded',
]);
const planSchema = z.strictObject({
    operation: z.literal(CREATE_POINT_TEXT_OPERATION),
    documentKey: z.string().min(1).max(16_384),
    artboardIndex: z.number().int().nonnegative(),
    anchor: anchorSchema,
    contents: pointTextSingleLineSchema,
    requestedStyle: requestedStyleSchema,
    profile: z.literal(POINT_TEXT_PROFILE_NAME),
    layer: createPointTextLayerStateSchema,
    applyBlockedReasonCodes: z.array(blockerSchema),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    if (plan.applyAllowed !== (plan.applyBlockedReasonCodes.length === 0)) {
        context.addIssue({ code: 'custom', message: 'Point-text creation applyAllowed must require no blockers.' });
    }
});
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']),
    reasonCode: z.enum(['apply_failed', 'verify_mismatch']),
    message: z.string().min(1).max(500),
}).superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed')) {
        context.addIssue({ code: 'custom', message: 'Point-text creation failure phase and reason code must match.' });
    }
});
const indeterminateFailureSchema = z.strictObject({
    phase: z.literal('apply'),
    reasonCode: z.literal('apply_indeterminate'),
    message: z.string().min(1).max(500),
});
const rollbackEvidence = {
    createdUuid: z.string().min(1).max(255).nullable(),
    restoredItemUuids: z.array(z.string().min(1).max(255)).nullable(),
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
            status: z.literal('indeterminate'), reasonCode: z.literal('created_state_unknown'),
            message: z.string().min(1).max(500), createdUuid: z.null(), restoredItemUuids: z.null(),
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
        context.addIssue({ code: 'custom', message: 'Point-text creation audit sequence does not match transaction state.' });
    }
    transaction.audit.forEach((event, index) => {
        if (event.sequence !== index) {
            context.addIssue({ code: 'custom', message: 'Point-text creation audit sequence must be contiguous.' });
        }
    });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' &&
            event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode &&
            event.message === transaction.failure.message);
        if (matches.length !== 1) {
            context.addIssue({ code: 'custom', message: 'Point-text creation failure must match one audit event.' });
        }
    }
});
export const createPointTextResultSchema = z.union([
    z.strictObject({
        operation: z.literal(CREATE_POINT_TEXT_OPERATION), applied: z.literal(false),
        document: documentContextSchema, plan: planSchema, transaction: transactionSchema,
    }),
    z.strictObject({
        operation: z.literal(CREATE_POINT_TEXT_OPERATION), applied: z.literal(true),
        document: documentContextSchema, plan: planSchema,
        created: z.strictObject({
            uuid: z.string().min(1).max(255),
            snapshot: pointTextSnapshotSchema,
            layerItemUuids: z.array(z.string().min(1).max(255)).min(1).max(CREATE_POINT_TEXT_MAX_DIRECT_ITEMS + 1),
        }),
        transaction: transactionSchema,
    }),
]).superRefine((result, context) => {
    if (result.transaction.state === 'planned') {
        const blockers = [];
        if (!result.document.mutationAllowed)
            blockers.push('document_mutation_not_allowed');
        if (result.plan.layer.ancestry.some((ancestor) => !ancestor.visible))
            blockers.push('layer_hidden');
        if (result.plan.layer.ancestry.some((ancestor) => ancestor.locked))
            blockers.push('layer_locked');
        if (result.plan.layer.itemUuids.length >= CREATE_POINT_TEXT_MAX_DIRECT_ITEMS) {
            blockers.push('layer_item_capacity_exceeded');
        }
        if (canonicalSha256(result.plan.applyBlockedReasonCodes) !==
            canonicalSha256(blockers)) {
            context.addIssue({ code: 'custom', message: 'Planned point-text creation must expose exact blockers.' });
        }
    }
    else if (result.plan.applyBlockedReasonCodes.length !== 0 || !result.plan.applyAllowed) {
        context.addIssue({ code: 'custom', message: 'Applied point-text creation must derive from an allowed plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified') {
            context.addIssue({ code: 'custom', message: 'A created point text must come from a verified transaction.' });
        }
        if (result.created.snapshot.uuid !== result.created.uuid ||
            result.created.layerItemUuids[0] !== result.created.uuid ||
            result.created.layerItemUuids.length !== result.plan.layer.itemUuids.length + 1 ||
            result.created.layerItemUuids.slice(1).some((uuid, index) => uuid !== result.plan.layer.itemUuids[index])) {
            context.addIssue({ code: 'custom', message: 'A created point text must be the only new item, at the front, with the prior order intact.' });
        }
        if (result.created.snapshot.contents !== result.plan.contents ||
            result.created.snapshot.profile !== POINT_TEXT_PROFILE_NAME ||
            canonicalSha256(result.created.snapshot.layerPath) !==
                canonicalSha256(result.plan.layer.path)) {
            context.addIssue({ code: 'custom', message: 'A created point text must match the planned contents, profile and layer.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified point-text creation must report the created item.' });
    }
});
export const createPointTextResponseSchema = z.strictObject({
    outcome: createPointTextResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
const commonInternal = {
    expectedDocumentKey: z.string().min(1).max(16_384),
    expectedLayerPath: layerPathSchema,
    artboardIndex: z.number().int().safe().nonnegative(),
    anchor: anchorRequestSchema,
    contents: pointTextSingleLineSchema,
    style: requestedStyleRequestSchema,
};
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({ ...commonInternal, apply: z.literal(true), commandId: canonicalCommandIdSchema }),
]);
const commonPublic = {
    expected_document_key: z.string().min(1).max(16_384),
    expected_layer_path: layerPathSchema,
    artboard_index: z.number().int().safe().nonnegative(),
    anchor: publicAnchorSchema,
    contents: pointTextSingleLineSchema,
    style: publicStyleSchema,
};
export const createPointTextPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({ ...commonPublic, apply: z.literal(true), command_id: applyCommandIdSchema }),
]);
const inputSchema = z.strictObject({
    ...commonPublic,
    apply: z.boolean().default(false),
    command_id: applyCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(createPointTextPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = createPointTextPublicInputSchema.parse(input);
    const common = {
        expectedDocumentKey: value.expected_document_key,
        expectedLayerPath: value.expected_layer_path,
        artboardIndex: value.artboard_index,
        anchor: value.anchor,
        contents: value.contents,
        style: {
            fontPostScriptName: value.style.font_post_script_name,
            size: value.style.size,
            tracking: value.style.tracking,
            justification: value.style.justification ?? 'Justification.LEFT',
            fillColor: normalizePointTextPublicFillColor(value.style.fill_color),
        },
    };
    return value.apply
        ? { ...common, apply: true, commandId: value.command_id }
        : { ...common, apply: false };
}
export const CREATE_POINT_TEXT_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: CREATE_POINT_TEXT_OPERATION,
    policy: {
        version: 1, class: 'create', destructive: false,
        evidence: { identity: 'native_uuid', ownership: 'self_created_only',
            postcondition: 'created_state_matches_plan' },
        preconditions: { documentBinding: 'explicit_document_key',
            targetValidation: 'same_execution_before_apply' },
        confirmation: 'risk_scoped',
        recovery: { mode: 'remove_self_created_uuid', verification: 'native_uuid_absent',
            unknownIdentity: 'indeterminate' },
        terminal: { success: 'verified', failure: 'proven_pre_apply_or_verified_recovery',
            partialSuccess: 'nonterminal_until_reconciled' },
        replay: { requestBinding: 'canonical_request_digest', retry: 'return_attested_terminal_result',
            beforeTerminal: 'reconcile_required', reapplyOnRetry: false },
    },
    capabilities: {
        class: 'create', explicitDocumentBinding: true, validateTargetsBeforeApply: true,
        captureNativeUuid: true, verifyCreatedState: true, rollbackSelfCreatedUuidOnly: true,
        verifyRollbackAbsence: true, reconcileIndeterminate: true, durableTerminalReplay: true,
        trustedTerminalAttestationResolver: true,
    },
});
export const CREATE_POINT_TEXT_SAFETY_IDENTITY = canonicalDigest(CREATE_POINT_TEXT_SAFETY);
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'create', operationId: CREATE_POINT_TEXT_OPERATION,
        canonicalRequestDigest: requestDigest,
        evidence: {
            documentKey: admissionDocumentKey,
            targetLocator: `layer:${result.plan.layer.path.join('.')};artboard:${result.plan.artboardIndex}`,
        },
        preconditions: {
            status: result.plan.applyBlockedReasonCodes.length === 0 ? 'satisfied' : 'blocked',
            targetsValidated: result.plan.applyBlockedReasonCodes.length === 0,
        },
        confirmation: { kind: 'risk_scoped', status: 'not_required' },
        applyAllowed: result.plan.applyAllowed,
    });
}
function safetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' ||
        transaction.state === 'rollback_indeterminate') {
        throw new Error('Indeterminate point-text creation cannot be terminal.');
    }
    const common = { policyVersion: 1, operationClass: 'create',
        operationId: CREATE_POINT_TEXT_OPERATION, canonicalRequestDigest: requestDigest,
        planDigest: plan.planDigest, attestation };
    if (result.applied && transaction.state === 'verified') {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { nativeUuid: result.created.uuid, ownership: 'self_created_only',
                postconditionVerified: true, outstandingEffect: null },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'succeeded', terminal: true, recovery: 'not_required',
                proof: { kind: 'verified_postcondition' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    if (transaction.state === 'rolled_back') {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { nativeUuid: transaction.rollback.createdUuid, ownership: 'self_created_only',
                postconditionVerified: false, outstandingEffect: null },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'recovered', terminal: true, recovery: 'verified',
                proof: { kind: 'verified_recovery' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    if (transaction.state === 'rollback_failed') {
        const nativeUuid = transaction.rollback.createdUuid;
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { nativeUuid, ownership: 'self_created_only', postconditionVerified: false,
                outstandingEffect: nativeUuid === null
                    ? null
                    : { kind: 'native_uuid_still_present', nativeUuid } },
            executionEvidence: { outcome: 'recovery_failed' },
            resolution: { status: 'recovery_failed', terminal: true, recovery: 'failed',
                outstandingEffect: 'known_effect_present',
                proof: { kind: 'verified_outstanding_effect' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    return operationSafetyResultSchema.parse({ ...common,
        evidence: { nativeUuid: null, ownership: 'self_created_only', postconditionVerified: false,
            outstandingEffect: null },
        executionEvidence: { outcome: 'proven_pre_apply' },
        resolution: { status: 'failed', terminal: true, recovery: 'not_required',
            proof: { kind: 'proven_pre_apply', mutationAttempted: false },
            replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
}
async function assertSafety(value, requestDigest, attestation, resolver) {
    const result = createPointTextResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null) {
        throw new Error('Point-text creation terminal result requires attestation.');
    }
    await assertOperationSafetyAdapterConformance({ registration: CREATE_POINT_TEXT_SAFETY, plan,
        result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
export const CREATE_POINT_TEXT_MODULE_SCRIPT = `var CREATE_POINT_TEXT_MAX_DIRECT_ITEMS = ${CREATE_POINT_TEXT_MAX_DIRECT_ITEMS};

function createPointTextResolveLayer(document, path) {
  var container = document;
  for (var index = 0; index < path.length; index++) {
    var layers = container.layers;
    if (!layers || typeof layers.length !== "number" || path[index] >= layers.length) {
      throw mutationError("preflight_failed", "The requested layer path does not exist in the bound document.");
    }
    container = layers[path[index]];
  }
  if (!container || String(container.typename) !== "Layer") {
    throw mutationError("preflight_failed", "The requested layer path does not resolve to a layer.");
  }
  return container;
}

function createPointTextLayerOrder(layer) {
  var order = [];
  for (var index = 0; index < layer.pageItems.length; index++) {
    var uuid = layer.pageItems[index].uuid;
    if (typeof uuid !== "string" || uuid.length === 0) {
      throw mutationError("preflight_failed", "A layer item native UUID is unavailable.");
    }
    order.push(uuid);
  }
  return order;
}

/**
 * The ancestry of the layer itself, nearest first. Creation is blocked by a hidden or locked ancestor
 * exactly as replacement is, because the immediate layer never reports an ancestor's state.
 */
function createPointTextLayerAncestry(layer) {
  var chain = [];
  var node = layer;
  while (chain.length <= POINT_TEXT_MAX_LAYER_DEPTH) {
    if (node === null || node === undefined) {
      throw mutationError("preflight_failed", "Target layer ancestry does not terminate at the document.");
    }
    var typename;
    try { typename = String(node.typename); }
    catch (typenameError) { throw mutationError("preflight_failed", "Target layer ancestry is unavailable."); }
    if (typename === "Document") return chain;
    if (typename !== "Layer") {
      throw mutationError("preflight_failed", "Point-text creation supports layer ancestry only.");
    }
    if (typeof node.name !== "string" || typeof node.visible !== "boolean" || typeof node.locked !== "boolean") {
      throw mutationError("preflight_failed", "Target layer ancestry state is unavailable.");
    }
    chain.push({ name: node.name, visible: node.visible, locked: node.locked });
    try { node = node.parent; }
    catch (nextError) { throw mutationError("preflight_failed", "Target layer ancestry is unavailable."); }
  }
  throw mutationError("preflight_failed", "Target layer ancestry exceeds the supported depth.");
}

function createPointTextArtboardRect(document, artboardIndex) {
  if (!document.artboards || typeof document.artboards.length !== "number" ||
      artboardIndex >= document.artboards.length) {
    throw mutationError("preflight_failed", "The requested artboard does not exist in the bound document.");
  }
  var rect = document.artboards[artboardIndex].artboardRect;
  if (!rect || rect.length !== 4) {
    throw mutationError("preflight_failed", "The requested artboard rectangle is unavailable.");
  }
  return [mutationFiniteNumber(rect[0], "artboardRect[0]"), mutationFiniteNumber(rect[1], "artboardRect[1]"),
    mutationFiniteNumber(rect[2], "artboardRect[2]"), mutationFiniteNumber(rect[3], "artboardRect[3]")];
}

/** Artboard-relative anchor, converted to the document coordinates pointText() expects. */
function createPointTextAnchor(rect) {
  var x = mutationFiniteNumber(params.anchor[0], "anchor[0]");
  var y = mutationFiniteNumber(params.anchor[1], "anchor[1]");
  if (x < 0 || y < 0 || x > rect[2] - rect[0] || y > rect[1] - rect[3]) {
    throw mutationError("preflight_failed", "The requested anchor is outside the bound artboard.");
  }
  return [rect[0] + x, rect[1] - y];
}

function createPointTextFont() {
  var font;
  try { font = app.textFonts.getByName(params.style.fontPostScriptName); }
  catch (fontError) { font = null; }
  if (font === null || font === undefined) {
    throw mutationError("preflight_failed", "The requested font is not installed.");
  }
  return font;
}

function createPointTextResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  var layer = createPointTextResolveLayer(document, params.expectedLayerPath);
  var ancestry = createPointTextLayerAncestry(layer);
  var order = createPointTextLayerOrder(layer);
  var rect = createPointTextArtboardRect(document, params.artboardIndex);
  var anchor = createPointTextAnchor(rect);
  var font = createPointTextFont();
  pointTextValidateContents(params.contents, "contents");
  // The requested fill must belong to this document's color space; nothing is implicitly converted.
  pointTextAssertFillCompatible(params.style.fillColor, pointTextDocumentColorSpace(document));
  var blockers = [];
  if (!context.mutationAllowed) blockers.push("document_mutation_not_allowed");
  var ancestorHidden = false;
  var ancestorLocked = false;
  for (var index = 0; index < ancestry.length; index++) {
    if (!ancestry[index].visible) ancestorHidden = true;
    if (ancestry[index].locked) ancestorLocked = true;
  }
  if (ancestorHidden) blockers.push("layer_hidden");
  if (ancestorLocked) blockers.push("layer_locked");
  if (order.length >= CREATE_POINT_TEXT_MAX_DIRECT_ITEMS) blockers.push("layer_item_capacity_exceeded");
  if (forApply && blockers.length > 0) {
    throw mutationBeforeSideEffectError(stringifyJson({ code: "CREATE_POINT_TEXT_APPLY_BLOCKED",
      reasonCodes: blockers }));
  }
  return { context: context, document: document, layer: layer, ancestry: ancestry, order: order,
    anchor: anchor, font: font, blockers: blockers };
}

function createPointTextPlanState(preflight) {
  return {
    operation: "create_point_text",
    documentKey: preflight.context.key,
    artboardIndex: params.artboardIndex,
    anchor: [params.anchor[0], params.anchor[1]],
    contents: params.contents,
    requestedStyle: params.style,
    profile: POINT_TEXT_PROFILE,
    layer: { path: params.expectedLayerPath, name: preflight.layer.name,
      visible: preflight.layer.visible, locked: preflight.layer.locked,
      itemUuids: preflight.order, ancestry: preflight.ancestry },
    applyBlockedReasonCodes: preflight.blockers,
    applyAllowed: preflight.blockers.length === 0
  };
}

function createPointTextRevalidate(preflight, plan) {
  var current;
  try { current = createPointTextResolve(true); }
  catch (error) {
    throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Point-text creation preconditions changed before apply."));
  }
  if (current.document !== preflight.document || current.layer !== preflight.layer ||
      !mutationSameSequence(current.order, plan.layer.itemUuids) ||
      stringifyJson(current.ancestry) !== stringifyJson(plan.layer.ancestry) ||
      !mutationSameSequence(current.anchor, preflight.anchor) || current.font !== preflight.font) {
    throw mutationBeforeSideEffectError("Point-text creation target or layer changed before apply.");
  }
}

/**
 * Writes every pinned profile field explicitly. Creation never relies on what a document happens to
 * inherit: a document whose composition defaults differ must produce a canonical frame or fail closed.
 */
function createPointTextApplyProfile(frame) {
  var range = frame.textRange;
  var attributes = range.characterAttributes;
  var paragraph = range.paragraphAttributes;
  attributes.textFont = createPointTextFont();
  attributes.size = params.style.size;
  attributes.tracking = params.style.tracking;
  attributes.horizontalScale = 100;
  attributes.verticalScale = 100;
  attributes.fillColor = pointTextNativeFillColor(params.style.fillColor);
  var requestedJustification = params.style.justification;
  var justificationDot = requestedJustification.indexOf(".");
  paragraph.justification = $.global[requestedJustification.substring(0, justificationDot)]
    [requestedJustification.substring(justificationDot + 1)];
  createPointTextWritePinned(attributes, POINT_TEXT_PINNED.character);
  createPointTextWritePinned(paragraph, POINT_TEXT_PINNED.paragraph);
  createPointTextWritePinned(frame, POINT_TEXT_PINNED.frame);
  // Stroke pins after NoColor enable latent paint. Clear it last, including after save/reopen.
  attributes.strokeColor = new NoColor();
}

function createPointTextWritePinned(host, table) {
  for (var name in table) {
    if (!table.hasOwnProperty(name)) continue;
    var resolved = createPointTextResolveCanonical(table[name]);
    if (resolved.status !== "value") {
      throw mutationError("apply_failed", "The canonical profile value for " + name + " cannot be resolved.");
    }
    try { host[name] = resolved.value; }
    catch (writeError) {
      throw mutationError("apply_failed", "The canonical profile value for " + name + " cannot be written.");
    }
  }
}

/** Inverse of pointTextCanonicalValue, so the written value is exactly what the profile pins. */
function createPointTextResolveCanonical(encoded) {
  if (encoded === "undefined") return { status: "value", value: undefined };
  if (encoded === "null") return { status: "value", value: null };
  if (encoded === "true") return { status: "value", value: true };
  if (encoded === "false") return { status: "value", value: false };
  if (encoded.substring(0, 2) === "s:") return { status: "value", value: encoded.substring(2) };
  if (encoded.substring(0, 2) === "o:") {
    var text = encoded.substring(2);
    var dot = text.indexOf(".");
    if (dot < 0) return { status: "unresolved" };
    var holder = $.global[text.substring(0, dot)];
    if (holder === undefined || holder === null) return { status: "unresolved" };
    var member = holder[text.substring(dot + 1)];
    if (member === undefined) return { status: "unresolved" };
    return { status: "value", value: member };
  }
  return { status: "value", value: Number(encoded) };
}

function createPointTextApply(preflight, plan, state) {
  state.operationState.mutationStarted = true;
  var frame = preflight.layer.textFrames.pointText(preflight.anchor);
  state.operationState.createdUuid = String(frame.uuid);
  frame.contents = params.contents;
  createPointTextApplyProfile(frame);
  return frame;
}

function createPointTextVerify(preflight, plan, state) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) {
    throw mutationError("verify_mismatch", "Active document changed during point-text creation verification.");
  }
  var createdUuid = state.operationState.createdUuid;
  if (typeof createdUuid !== "string" || createdUuid.length === 0) {
    throw mutationError("verify_mismatch", "The created point text has no captured native UUID.");
  }
  var target = pointTextFind(preflight.document, createdUuid);
  if (target === null) {
    throw mutationError("verify_mismatch", "The created native UUID no longer resolves in the bound document.");
  }
  var order = createPointTextLayerOrder(preflight.layer);
  if (order.length !== plan.layer.itemUuids.length + 1 || order[0] !== createdUuid ||
      !mutationSameSequence(order.slice(1), plan.layer.itemUuids)) {
    throw mutationError("verify_mismatch", "The created point text is not the only new front item of its layer.");
  }
  var snapshot = pointTextSnapshot(preflight.document, target, createdUuid);
  if (snapshot.contents !== params.contents || snapshot.profile !== POINT_TEXT_PROFILE ||
      !mutationSameSequence(snapshot.layerPath, plan.layer.path)) {
    throw mutationError("verify_mismatch", "The created point text does not match the planned state.");
  }
  return { uuid: createdUuid, snapshot: snapshot, layerItemUuids: order };
}

function createPointTextRollback(state) {
  var preflight = state.preflight;
  var createdUuid = state.operationState.createdUuid;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) {
    return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
  }
  if (typeof createdUuid !== "string" || createdUuid.length === 0) {
    // The creation call itself failed, so no UUID was ever captured. The layer order is still positive
    // evidence: if it equals the baseline exactly, nothing was created and there is nothing to undo.
    var uncreatedOrder;
    try { uncreatedOrder = createPointTextLayerOrder(preflight.layer); }
    catch (uncreatedError) { return { status: "indeterminate", message: "Rollback layer order is indeterminate." }; }
    if (!mutationSameSequence(uncreatedOrder, preflight.order)) {
      return { status: "indeterminate", message: "Rollback cannot prove which item was created." };
    }
    state.operationState.rollbackEvidence.restoredItemUuids = uncreatedOrder;
    return { status: "verified" };
  }
  state.operationState.rollbackEvidence.createdUuid = createdUuid;
  var target;
  try { target = pointTextFind(preflight.document, createdUuid); }
  catch (findError) { return { status: "indeterminate", message: "Rollback target identity is indeterminate." }; }
  if (target === null) {
    // Nothing of ours is present; the baseline order must already be exact for this to be a recovery.
    var absentOrder;
    try { absentOrder = createPointTextLayerOrder(preflight.layer); }
    catch (orderError) { return { status: "indeterminate", message: "Rollback layer order is indeterminate." }; }
    if (!mutationSameSequence(absentOrder, preflight.order)) {
      return { status: "indeterminate", message: "Rollback refused because the layer no longer matches the baseline." };
    }
    state.operationState.rollbackEvidence.restoredItemUuids = absentOrder;
    return { status: "verified" };
  }
  var currentOrder;
  try { currentOrder = createPointTextLayerOrder(preflight.layer); }
  catch (orderError) { return { status: "indeterminate", message: "Rollback layer order is indeterminate." }; }
  // Only remove while the layer is exactly the baseline plus our own item at the front.
  if (currentOrder.length !== preflight.order.length + 1 || currentOrder[0] !== createdUuid ||
      !mutationSameSequence(currentOrder.slice(1), preflight.order)) {
    return { status: "indeterminate", message: "Rollback refused because the layer is neither the baseline nor the created state." };
  }
  try { target.remove(); }
  catch (removeError) { return { status: "indeterminate", message: "Rollback removal is indeterminate." }; }
  var restored;
  try { restored = createPointTextLayerOrder(preflight.layer); }
  catch (verifyError) { return { status: "indeterminate", message: "Rollback verification is indeterminate." }; }
  state.operationState.rollbackEvidence.restoredItemUuids = restored;
  if (pointTextFind(preflight.document, createdUuid) !== null) {
    return { status: "failed", message: "Rollback did not remove the created native UUID." };
  }
  return mutationSameSequence(restored, preflight.order)
    ? { status: "verified" }
    : { status: "failed", message: "Rollback did not restore the exact baseline layer order." };
}

`;
export const CREATE_POINT_TEXT_RUNNER_SCRIPT = `var createPointTextExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionLayers: function (phase, preflight) { return [preflight.layer]; },
  // the items this change reads and writes, so an edit session can advance its item aggregate.
  editSessionAffected: function (phase, preflight, plan, state) { return phase === "after" ? [state.operationState.createdUuid] : []; },
  initialOperationState: function () {
    return { mutationStarted: false, createdUuid: null,
      rollbackEvidence: { createdUuid: null, restoredItemUuids: null } };
  },
  preflight: function (forApply) {
    var resolved = createPointTextResolve(forApply);
    return resolved;
  },
  plan: createPointTextPlanState,
  revalidate: createPointTextRevalidate,
  applyMutation: createPointTextApply,
  verify: createPointTextVerify,
  rollback: createPointTextRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () {
    return { reasonCode: "created_state_unknown",
      message: "Point-text creation outcome is indeterminate.",
      evidence: { createdUuid: null, restoredItemUuids: null } };
  },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var createPointTextDocument = createPointTextExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === createPointTextExecution.preflight.document) {
  createPointTextDocument = getDocumentContext();
}
var result = { operation: "create_point_text",
  applied: createPointTextExecution.transaction.state === "verified",
  document: createPointTextDocument, plan: createPointTextExecution.plan,
  transaction: createPointTextExecution.transaction };
if (createPointTextExecution.transaction.state === "verified") {
  result.created = createPointTextExecution.value;
}
`;
export const CREATE_POINT_TEXT_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${POINT_TEXT_SNAPSHOT_SCRIPT}
${CREATE_POINT_TEXT_MODULE_SCRIPT}${CREATE_POINT_TEXT_RUNNER_SCRIPT}`;
export const CREATE_POINT_TEXT_HOST_SCRIPT_DIGEST = canonicalSha256(CREATE_POINT_TEXT_SCRIPT);
export const CREATE_POINT_TEXT_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: CREATE_POINT_TEXT_OPERATION,
    validator: CREATE_POINT_TEXT_VALIDATOR, canonicalContractVersion: CANONICAL_VERSION,
    resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: CREATE_POINT_TEXT_SAFETY_IDENTITY, hostScriptDigest: CREATE_POINT_TEXT_HOST_SCRIPT_DIGEST,
    mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    const digestRequest = 'commandId' in request
        ? (({ commandId: _commandId, ...rest }) => rest)(request)
        : request;
    const digest = canonicalSha256({ operation: CREATE_POINT_TEXT_OPERATION,
        validator: CREATE_POINT_TEXT_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request,
        commandId: 'commandId' in request ? request.commandId : null,
        documentKey: request.expectedDocumentKey, digest };
}
export const createPointTextToolContract = {
    name: 'illustrator_create_point_text',
    title: 'Plan or Create Point Text',
    description: 'Plan or create one single-line POINTTEXT frame at an artboard-relative anchor on an explicit layer path, '
        + 'bound by explicit document key. `style.fill_color` is RGB (`{red, green, blue}`, optionally tagged '
        + '`model: "rgb"`), CMYK (`{model: "cmyk", cyan, magenta, yellow, black}`) or Gray '
        + '(`{model: "gray", gray}`); RGB is accepted only in an RGB document and CMYK only in a CMYK document, '
        + 'Gray in either, and a mismatch is refused instead of implicitly converted. Every character, paragraph '
        + 'and frame property outside the requested font, size, tracking and fill is written from the measured '
        + 'plain_point_text_v2 profile rather than inherited. Apply '
        + 'revalidates the exact layer order in the same host call, verifies the complete created snapshot by native UUID, '
        + 'and rolls back only its own created item. The returned native UUID identifies the item until the document is '
        + 'next saved; Illustrator renumbers UUIDs across that save.',
    inputSchema,
    publicInputSchema: createPointTextPublicInputSchema,
    outputSchema: createPointTextResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(CREATE_POINT_TEXT_SAFETY.policy),
    normalizePublicInput,
};
export function createPointTextAdapter() {
    return {
        version: 1, operation: CREATE_POINT_TEXT_OPERATION, validator: CREATE_POINT_TEXT_VALIDATOR,
        safety: CREATE_POINT_TEXT_SAFETY, safetyRegistrationIdentity: CREATE_POINT_TEXT_SAFETY_IDENTITY,
        adapterIdentity: CREATE_POINT_TEXT_ADAPTER_IDENTITY, tool: createPointTextToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest,
            safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: createPointTextResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: CLASSIFIER_VERSION, safetyConformanceVersion: CONFORMANCE_VERSION,
        errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: CREATE_POINT_TEXT_HOST_SCRIPT_DIGEST,
        mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: CREATE_POINT_TEXT_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: CREATE_POINT_TEXT_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: CREATE_POINT_TEXT_OPERATION,
                    documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: CREATE_POINT_TEXT_ADAPTER_IDENTITY,
                mutationHostApplicationMode: 'foreground', script: CREATE_POINT_TEXT_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = createPointTextResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back' ||
                state === 'rollback_failed')
                return { state };
            if (state === 'planned')
                throw new Error('Point-text creation plan is not a terminal mutation result.');
            throw new Error('Unverified point-text creation must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error, detail) {
            if (detail?.code === 'CREATE_POINT_TEXT_APPLY_BLOCKED') {
                return new Error(`Point-text creation is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}.`);
            }
            if (detail?.code === 'POINT_TEXT_COLOR_SPACE_MISMATCH') {
                return new Error(`A ${detail.requestedModel ?? 'unknown'} fill cannot be written to a `
                    + `${detail.documentColorSpace ?? 'unknown'} document; implicit color-space conversion is refused.`);
            }
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
