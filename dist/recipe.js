import { createRequire } from 'node:module';
import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from './command-id.js';
import { canonicalSha256 } from './mutation-canonical.js';
import { MUTATE_BATCH_ADAPTER_IDENTITY, MUTATE_BATCH_OPERATION, mutateBatchResponseSchema, mutateBatchToolContract, } from './adapters/mutate-batch-adapter.js';
import { bindRecipeInputs, buildRecipeBatchPlanRequest, recipeDefinitionSchema, recipeIdSchema, recipeInputValuesSchema, recipeVersionSchema, validateRecipeBindsStructurally, RECIPE_MAX_STEPS, RECIPE_MIN_STEPS, } from './recipe-schema.js';
import { PUBLISHED_DEPTH_KEY } from './published-tool-schema.js';
export const RECIPE_TOOL_VERSION = createRequire(import.meta.url)('../package.json').version;
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const documentKeySchema = z.string().min(1).max(16_384);
export const saveRecipeInputSchema = z.strictObject({ recipe: recipeDefinitionSchema });
export const saveRecipeResultSchema = z.strictObject({
    recipe_id: recipeIdSchema,
    recipe_version: recipeVersionSchema,
    recipe_hash: hashSchema,
    created: z.boolean(),
    path: z.string().min(1),
    tool_version: z.string().min(1),
    structural_plan_check: z.strictObject({ step_count: z.number().int().min(RECIPE_MIN_STEPS).max(RECIPE_MAX_STEPS) }),
});
export async function saveRecipe(input, dependencies) {
    const recipe = recipeDefinitionSchema.parse(input.recipe);
    const structural = validateRecipeBindsStructurally(recipe);
    const saved = await dependencies.store.save(recipe);
    return saveRecipeResultSchema.parse({
        recipe_id: saved.recipe.recipe_id,
        recipe_version: saved.recipe.recipe_version,
        recipe_hash: saved.recipeHash,
        created: saved.created,
        path: saved.path,
        tool_version: RECIPE_TOOL_VERSION,
        structural_plan_check: { step_count: structural.steps.length },
    });
}
export const listRecipesResultSchema = z.strictObject({
    recipes: z.array(z.strictObject({
        recipe_id: recipeIdSchema,
        recipe_version: recipeVersionSchema,
        recipe_hash: hashSchema,
        description: z.string().max(500).optional(),
        input_names: z.array(z.string().min(1)),
        step_count: z.number().int().min(RECIPE_MIN_STEPS).max(RECIPE_MAX_STEPS),
    })),
    invalid_entries: z.array(z.strictObject({ name: z.string().min(1), reason: z.string().min(1) })),
});
export async function listRecipes(dependencies) {
    return listRecipesResultSchema.parse(await dependencies.store.list());
}
export const planRecipeInputSchema = z.strictObject({
    recipe_id: recipeIdSchema,
    recipe_version: recipeVersionSchema,
    expected_document_key: documentKeySchema,
    inputs: recipeInputValuesSchema.default({}),
});
export const planRecipeResultSchema = z.strictObject({
    recipe_id: recipeIdSchema,
    recipe_version: recipeVersionSchema,
    recipe_hash: hashSchema,
    tool_version: z.string().min(1),
    batch: z.strictObject({ operation: z.literal(MUTATE_BATCH_OPERATION), adapter_identity: hashSchema }),
    bound_inputs: z.record(z.string(), z.union([z.string(), z.number()])),
    batch_request: mutateBatchToolContract.publicInputSchema,
    plan: mutateBatchResponseSchema,
}).superRefine((result, context) => {
    if (result.batch_request.apply !== false || result.plan.outcome.applied !== false || result.plan.outcome.transaction.state !== 'planned') {
        context.addIssue({ code: 'custom', message: 'A recipe plan must be plan-only.' });
    }
});
export class RecipeNotFoundError extends Error {
    code = 'RECIPE_NOT_FOUND';
    constructor(recipeId, recipeVersion, detail) {
        super(`Recipe ${recipeId}@${recipeVersion} is not available (${detail}).`);
        this.name = 'RecipeNotFoundError';
    }
}
export async function planRecipe(input, dependencies) {
    const request = planRecipeInputSchema.parse(input);
    const stored = await dependencies.store.get(request.recipe_id, request.recipe_version);
    if (stored.state !== 'valid') {
        throw new RecipeNotFoundError(request.recipe_id, request.recipe_version, stored.state === 'invalid' ? stored.reason : 'missing');
    }
    const recipe = stored.record.recipe;
    const bound = bindRecipeInputs(recipe, request.inputs);
    const batchRequest = buildRecipeBatchPlanRequest(recipe, bound, request.expected_document_key);
    const plan = await dependencies.executeBatch(MUTATE_BATCH_OPERATION, mutateBatchToolContract.normalizePublicInput(batchRequest));
    return planRecipeResultSchema.parse({
        recipe_id: recipe.recipe_id,
        recipe_version: recipe.recipe_version,
        recipe_hash: stored.record.recipe_hash,
        tool_version: RECIPE_TOOL_VERSION,
        batch: { operation: MUTATE_BATCH_OPERATION, adapter_identity: MUTATE_BATCH_ADAPTER_IDENTITY },
        bound_inputs: bound,
        batch_request: batchRequest,
        plan,
    });
}
const approvedPlanSchema = planRecipeResultSchema.meta({
    description: 'The unchanged result of illustrator_plan_recipe for this recipe, inputs, and document.',
    [PUBLISHED_DEPTH_KEY]: 1,
});
const batchApplyRequestSchema = mutateBatchToolContract.publicInputSchema;
export const runRecipeResultSchema = z.strictObject({
    recipe_id: recipeIdSchema,
    recipe_version: recipeVersionSchema,
    recipe_hash: hashSchema,
    tool_version: z.string().min(1),
    bound_inputs: z.record(z.string(), z.union([z.string(), z.number()])),
    command_id: canonicalCommandIdSchema,
    execution_digest: hashSchema,
    authority_state: z.enum(['closed_completed', 'closed_failed_pre_apply']),
    status: z.enum(['succeeded', 'recovered', 'failed']),
    batch_request: batchApplyRequestSchema,
    batch: mutateBatchResponseSchema,
}).superRefine((result, context) => {
    if (result.batch_request.apply !== true || result.batch.delivery.mode !== 'original' && result.batch.delivery.mode !== 'replay') {
        context.addIssue({ code: 'custom', message: 'Recipe run must contain an apply batch request and a batch delivery.' });
    }
    const state = result.batch.outcome.transaction.state;
    const expected = state === 'verified' ? 'succeeded' : state === 'rolled_back' ? 'recovered' : state === 'apply_failed' ? 'failed' : null;
    if (expected === null || result.status !== expected ||
        (state === 'apply_failed' ? result.authority_state !== 'closed_failed_pre_apply' : result.authority_state !== 'closed_completed')) {
        context.addIssue({ code: 'custom', message: 'Recipe run status and authority state must match the batch terminal result.' });
    }
});
export const runRecipeInputSchema = z.strictObject({
    recipe_id: recipeIdSchema,
    recipe_version: recipeVersionSchema,
    recipe_hash: hashSchema,
    expected_document_key: documentKeySchema,
    inputs: recipeInputValuesSchema.default({}),
    approved_plan: approvedPlanSchema,
    command_id: applyCommandIdSchema,
    apply: z.literal(true),
});
export class RecipeApprovalMismatchError extends Error {
    code = 'RECIPE_APPROVAL_MISMATCH';
    constructor(message) {
        super(message);
        this.name = 'RecipeApprovalMismatchError';
    }
}
export class RecipeApplyBlockedError extends Error {
    code = 'RECIPE_APPLY_BLOCKED';
    constructor() {
        super('The current recipe plan is blocked or lacks an apply approval.');
        this.name = 'RecipeApplyBlockedError';
    }
}
function approvalBinding(plan) {
    return {
        recipe_id: plan.recipe_id,
        recipe_version: plan.recipe_version,
        recipe_hash: plan.recipe_hash,
        tool_version: plan.tool_version,
        batch: plan.batch,
        bound_inputs: plan.bound_inputs,
        batch_request: plan.batch_request,
        plan: plan.plan.outcome,
    };
}
function approvedBinding(input) {
    return approvalBinding(input.approved_plan);
}
function buildBatchApplyRequest(plan, commandId) {
    const outcome = plan.plan.outcome;
    if (outcome.transaction.state !== 'planned' || outcome.plan.applyBlockedReasonCodes.length !== 0) {
        throw new RecipeApplyBlockedError();
    }
    const steps = plan.batch_request.steps.map((step, index) => {
        const planned = outcome.plan.steps[index];
        if (planned === undefined || planned.operation !== step.operation || planned.targetUuid !== step.target_uuid) {
            throw new RecipeApprovalMismatchError('The current batch plan does not match the stored recipe request.');
        }
        return { ...step, expected_before: planned.plan.before, confirmed_after: planned.plan.after };
    });
    return batchApplyRequestSchema.parse({
        expected_document_key: plan.batch_request.expected_document_key,
        steps,
        apply: true,
        command_id: commandId,
    });
}
function isTerminalBatch(value) {
    const parsed = mutateBatchResponseSchema.safeParse(value);
    if (!parsed.success || !parsed.data.outcome.applied)
        return false;
    const state = parsed.data.outcome.transaction.state;
    return state === 'verified' || state === 'rolled_back' || state === 'apply_failed';
}
function terminalResult(plan, commandId, executionDigest, batchRequest, batch) {
    const state = batch.outcome.transaction.state;
    const status = state === 'verified' ? 'succeeded' : state === 'rolled_back' ? 'recovered' : 'failed';
    const authorityState = state === 'apply_failed' ? 'closed_failed_pre_apply' : 'closed_completed';
    return runRecipeResultSchema.parse({
        recipe_id: plan.recipe_id,
        recipe_version: plan.recipe_version,
        recipe_hash: plan.recipe_hash,
        tool_version: plan.tool_version,
        bound_inputs: plan.bound_inputs,
        command_id: commandId,
        execution_digest: executionDigest,
        authority_state: authorityState,
        status,
        batch_request: batchRequest,
        batch,
    });
}
function boundRecipeExecution(request) {
    const batchRequest = buildBatchApplyRequest(request.approved_plan, request.command_id);
    const binding = {
        request: {
            recipe_id: request.recipe_id,
            recipe_version: request.recipe_version,
            recipe_hash: request.recipe_hash,
            expected_document_key: request.expected_document_key,
            inputs: request.inputs,
            command_id: request.command_id,
            apply: request.apply,
        },
        approval: approvalBinding(request.approved_plan),
        batch_apply_request: batchRequest,
    };
    return { binding, batchRequest, executionDigest: canonicalSha256(binding) };
}
function requireBoundAuthority(inspection, execution) {
    if (inspection.state !== 'valid') {
        throw Object.assign(new Error('Recipe execution authority does not match the approved execution binding.'), {
            code: 'RECIPE_EXECUTION_INDETERMINATE',
        });
    }
    if (inspection.records[0]?.executionDigest !== execution.executionDigest ||
        canonicalSha256(inspection.records[0]?.evidence ?? null) !== canonicalSha256(execution.binding)) {
        throw new RecipeApprovalMismatchError('The request does not match the existing recipe execution binding.');
    }
}
function storedBatchRequest(inspection, execution) {
    requireBoundAuthority(inspection, execution);
    const evidence = inspection.records[0]?.evidence;
    const candidate = typeof evidence === 'object' && evidence !== null && !Array.isArray(evidence)
        ? evidence.batch_apply_request
        : undefined;
    const parsed = batchApplyRequestSchema.safeParse(candidate);
    if (!parsed.success || canonicalSha256(parsed.data) !== canonicalSha256(execution.batchRequest)) {
        throw Object.assign(new Error('Recipe execution authority lacks the exact stored batch request.'), {
            code: 'RECIPE_EXECUTION_INDETERMINATE',
        });
    }
    return parsed.data;
}
function requireFreshApproval(request, plan) {
    if (plan.recipe_id !== request.recipe_id || plan.recipe_version !== request.recipe_version ||
        plan.recipe_hash !== request.recipe_hash || plan.batch_request.expected_document_key !== request.expected_document_key ||
        canonicalSha256(approvedBinding(request)) !== canonicalSha256(approvalBinding(plan))) {
        throw new RecipeApprovalMismatchError('The approved recipe, inputs, document, or plan no longer matches the current plan.');
    }
}
async function executeBoundRecipe(request, dependencies, inspection, execution) {
    const batchRequest = storedBatchRequest(inspection, execution);
    const terminal = inspection.records.at(-1);
    if (terminal?.state === 'open') {
        await dependencies.authorityStore.append(request.command_id, execution.executionDigest, 'writing_batch', {
            batch_apply_request_digest: canonicalSha256(batchRequest),
        });
    }
    const batch = await dependencies.executeBatch(MUTATE_BATCH_OPERATION, mutateBatchToolContract.normalizePublicInput(batchRequest));
    if (!isTerminalBatch(batch)) {
        throw Object.assign(new Error('The batch did not return an attested terminal result; reconciliation is required.'), {
            code: 'RECIPE_EXECUTION_INDETERMINATE',
        });
    }
    const result = terminalResult(request.approved_plan, request.command_id, execution.executionDigest, batchRequest, batch);
    await dependencies.authorityStore.append(request.command_id, execution.executionDigest, result.authority_state, {
        batch_result_digest: canonicalSha256(batch.outcome),
        status: result.status,
    });
    return result;
}
export async function runRecipe(input, dependencies) {
    const request = runRecipeInputSchema.parse(input);
    const execution = boundRecipeExecution(request);
    const existing = await dependencies.authorityStore.inspect(request.command_id);
    if (existing.state === 'valid') {
        return await executeBoundRecipe(request, dependencies, existing, execution);
    }
    if (existing.state === 'invalid') {
        throw Object.assign(new Error(`Recipe execution authority is unsafe (${existing.reason ?? 'unknown'}).`), {
            code: 'RECIPE_EXECUTION_INDETERMINATE',
        });
    }
    const freshPlan = await planRecipe({
        recipe_id: request.recipe_id,
        recipe_version: request.recipe_version,
        expected_document_key: request.expected_document_key,
        inputs: request.inputs,
    }, dependencies);
    requireFreshApproval(request, freshPlan);
    const inspection = await dependencies.authorityStore.begin({
        commandId: request.command_id,
        executionDigest: execution.executionDigest,
        binding: execution.binding,
    });
    return await executeBoundRecipe(request, dependencies, inspection, execution);
}
const STATE_ONLY = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export const recipeToolContracts = {
    save: {
        name: 'illustrator_save_recipe',
        title: 'Save a Declarative Illustrator Recipe',
        description: `Validate and store a versioned declarative recipe (schema_version 1): ${RECIPE_MIN_STEPS} to ${RECIPE_MAX_STEPS} steps drawn only from the operations illustrator_mutate_batch admits (replace_point_text, set_text_style size or RGB fill, transform_object translate-only, set_path_appearance), typed inputs with optional defaults, and {{inputs.<name>}} substitution only. Arbitrary ExtendScript, JSX, expressions, and unknown step kinds are rejected. The recipe is stored create-once under the private state root as <recipe_id>@<recipe_version>.json with its canonical SHA-256; re-saving identical content is a no-op and different content for the same id@version is refused. Touches no Illustrator document.`,
        inputSchema: saveRecipeInputSchema.shape,
        outputSchema: saveRecipeResultSchema,
        annotations: STATE_ONLY,
    },
    list: {
        name: 'illustrator_list_recipes',
        title: 'List Stored Illustrator Recipes',
        description: 'List every stored recipe version with its hash, declared input names, and step count. Entries that fail record validation are reported separately, never repaired or removed. Touches no Illustrator document.',
        inputSchema: {},
        outputSchema: listRecipesResultSchema,
        annotations: READ_ONLY,
    },
    plan: {
        name: 'illustrator_plan_recipe',
        title: 'Plan a Stored Illustrator Recipe',
        description: 'Bind inputs to a stored recipe and plan the resulting illustrator_mutate_batch against the bound document: document-key validation, every step preflighted, nothing written. Unknown or missing inputs, type mismatches, a stale document key, and any step the batch rejects fail before or during planning. The result carries the recipe hash, tool version, batch adapter identity, bound inputs, the exact batch request, and the batch plan. Applying a recipe is not available in this slice.',
        inputSchema: planRecipeInputSchema.shape,
        outputSchema: planRecipeResultSchema,
        annotations: READ_ONLY,
    },
    run: {
        name: 'illustrator_run_recipe',
        title: 'Run an Approved Declarative Illustrator Recipe',
        description: 'Re-plan a stored declarative recipe, compare it to an explicit approved plan, then apply only the exact resulting illustrator_mutate_batch change set under the caller command_id. Recipe hash, inputs, document key, targets, before/after snapshots, and blockers must still match. The existing batch durable command remains the replay and reconciliation authority; arbitrary code, caller-supplied steps, and unapproved changes are rejected.',
        inputSchema: runRecipeInputSchema.shape,
        outputSchema: runRecipeResultSchema,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
};
