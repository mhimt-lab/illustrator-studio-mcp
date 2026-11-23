import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, layerPathSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { FONT_LOOKUP_HOST_SCRIPT, fontDescriptorSchema, fontPostScriptNameSchema } from '../font-lookup.js';
export const REPLACE_FONT_OPERATION = 'replace_font';
export const REPLACE_FONT_VALIDATOR = { kind: REPLACE_FONT_OPERATION, version: 1 };
const CANONICAL_VERSION = 3;
const RESULT_SCHEMA_VERSION = 3;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 3;
const POLICY_VERSION = 1;
export const REPLACE_FONT_MAX_FRAMES = 512;
export const REPLACE_FONT_MAX_CHARACTERS = 40_000;
export const REPLACE_FONT_MAX_SCAN_CHARACTERS = 100_000;
export const REPLACE_FONT_MAX_RUNS = 1_000;
export const REPLACE_FONT_MAX_SCAN_RUNS = 5_000;
export const REPLACE_FONT_MAX_DOCUMENT_FRAMES = 2_000;
export const REPLACE_FONT_MAX_BLOCKED_FRAMES = 64;
export const REPLACE_FONT_MAX_MAPPINGS = 16;
const uuidSchema = z.string().min(1).max(255);
const rangeSchema = z.tuple([
    z.number().int().nonnegative().max(REPLACE_FONT_MAX_CHARACTERS),
    z.number().int().positive().max(REPLACE_FONT_MAX_CHARACTERS),
]);
const rangesSchema = z.array(rangeSchema).min(1).max(REPLACE_FONT_MAX_CHARACTERS);
const mappingIndexSchema = z.number().int().nonnegative().max(REPLACE_FONT_MAX_MAPPINGS - 1);
function storyRangesValid(ranges, mappings) {
    if (mappings.length !== ranges.length)
        return false;
    let previousEnd = -1;
    for (let index = 0; index < ranges.length; index += 1) {
        const [start, end] = ranges[index];
        if (start >= end || start < previousEnd)
            return false;
        if (start === previousEnd && mappings[index] === mappings[index - 1])
            return false;
        previousEnd = end;
    }
    return true;
}
function rangeMappings(target) {
    return target.mappings === undefined ? target.ranges.map(() => 0) : [...target.mappings];
}
function rangeLength(ranges) {
    return ranges.reduce((sum, [start, end]) => sum + end - start, 0);
}
export const expectedTargetSchema = z.strictObject({
    uuid: uuidSchema, ranges: rangesSchema, mappings: z.array(mappingIndexSchema).max(REPLACE_FONT_MAX_CHARACTERS).optional(),
}).superRefine((target, context) => {
    if (!storyRangesValid(target.ranges, rangeMappings(target))) {
        context.addIssue({ code: 'custom', message: 'Font ranges must be ascending, non-empty runs with one pair index each; runs of one pair must not touch.' });
    }
});
const usageStorySchema = z.strictObject({
    uuid: uuidSchema,
    frames: z.array(uuidSchema).min(1).max(REPLACE_FONT_MAX_FRAMES),
    kind: z.string().min(1).max(64),
    characters: z.number().int().positive().max(REPLACE_FONT_MAX_CHARACTERS),
    ranges: rangesSchema,
    mappings: z.array(mappingIndexSchema).max(REPLACE_FONT_MAX_CHARACTERS),
}).superRefine((entry, context) => {
    if (!storyRangesValid(entry.ranges, entry.mappings)) {
        context.addIssue({ code: 'custom', message: 'Font ranges must be ascending, non-empty runs with one pair index each; runs of one pair must not touch.' });
    }
});
const usageSchema = z.discriminatedUnion('complete', [
    z.strictObject({
        complete: z.literal(true),
        characters: z.number().int().nonnegative().max(REPLACE_FONT_MAX_CHARACTERS),
        stories: z.number().int().nonnegative().max(REPLACE_FONT_MAX_FRAMES),
        storyList: z.array(usageStorySchema).max(REPLACE_FONT_MAX_FRAMES),
    }),
    z.strictObject({
        complete: z.literal(false),
        characters: z.literal(0),
        stories: z.literal(0),
        storyList: z.array(usageStorySchema).max(0),
    }),
]).superRefine((usage, context) => {
    const allFrames = usage.storyList.flatMap((entry) => entry.frames);
    if (usage.stories !== usage.storyList.length ||
        usage.characters !== usage.storyList.reduce((sum, entry) => sum + entry.characters, 0) ||
        usage.storyList.some((entry) => entry.characters !== rangeLength(entry.ranges) || entry.frames[0] !== entry.uuid) ||
        new Set(allFrames).size !== allFrames.length || allFrames.length > REPLACE_FONT_MAX_FRAMES) {
        context.addIssue({ code: 'custom', message: 'Font usage counts must equal the reported story ranges.' });
    }
});
export const expectedUsageSchema = z.strictObject({
    characters: z.number().int().nonnegative().max(REPLACE_FONT_MAX_CHARACTERS),
    stories: z.number().int().nonnegative().max(REPLACE_FONT_MAX_FRAMES),
});
const checksSchema = z.strictObject({
    sourceInstalled: z.boolean(),
    replacementInstalled: z.boolean(),
    sourceVerified: z.boolean(),
    replacementVerified: z.boolean(),
    mappingsFitOneApply: z.boolean(),
    fontsReadable: z.boolean(),
    targetFramesUnlocked: z.boolean(),
    targetFramesVisible: z.boolean(),
    targetFramesSupported: z.boolean(),
});
const scopeKindSchema = z.enum(['document', 'artboard', 'layer', 'selection', 'target_uuids']);
const planScopeSchema = z.strictObject({
    kind: scopeKindSchema,
    stories: z.number().int().nonnegative(),
    outsideFrames: z.number().int().nonnegative(),
    ignoredItems: z.number().int().nonnegative(),
});
const remainingSchema = z.strictObject({
    stories: z.number().int().nonnegative(),
    characters: z.number().int().nonnegative(),
});
const blockedReasonSchema = z.enum(['locked', 'hidden', 'unreadable', 'unsupported']);
const blockedFramesSchema = z.strictObject({
    total: z.number().int().nonnegative(),
    frames: z.array(z.strictObject({
        uuid: uuidSchema,
        reasons: z.array(blockedReasonSchema).min(1).max(4),
        layerPath: layerPathSchema.nullable(),
    })).max(REPLACE_FONT_MAX_BLOCKED_FRAMES),
}).superRefine((blocked, context) => {
    if (blocked.frames.length !== Math.min(blocked.total, REPLACE_FONT_MAX_BLOCKED_FRAMES)) {
        context.addIssue({ code: 'custom', message: 'blockedFrames must list every blocked frame up to its limit.' });
    }
});
const blockerSchema = z.enum([
    'document_mutation_not_allowed',
    'source_font_not_installed',
    'replacement_font_not_installed',
    'source_font_not_verifiable',
    'replacement_font_not_verifiable',
    'mapping_scope_exceeds_limit',
    'usage_scan_limit_exceeded',
    'character_font_unreadable',
    'source_font_not_used',
    'target_frame_locked',
    'target_frame_hidden',
    'target_frame_unsupported',
]);
function expectedBlockers(plan, mutationAllowed) {
    const blockers = [];
    const nothingPlanned = plan.usage.complete && plan.usage.stories === 0;
    if (!mutationAllowed)
        blockers.push('document_mutation_not_allowed');
    if (!plan.checks.sourceInstalled)
        blockers.push('source_font_not_installed');
    if (!plan.checks.replacementInstalled)
        blockers.push('replacement_font_not_installed');
    if (!plan.checks.sourceVerified)
        blockers.push('source_font_not_verifiable');
    if (!plan.checks.replacementVerified)
        blockers.push('replacement_font_not_verifiable');
    if (!plan.checks.mappingsFitOneApply)
        blockers.push('mapping_scope_exceeds_limit');
    if (!plan.usage.complete)
        blockers.push('usage_scan_limit_exceeded');
    if (!plan.checks.fontsReadable)
        blockers.push('character_font_unreadable');
    if (nothingPlanned && plan.remaining.stories === 0 && plan.blockedFrames.total === 0)
        blockers.push('source_font_not_used');
    if (!plan.checks.targetFramesUnlocked)
        blockers.push('target_frame_locked');
    if (!plan.checks.targetFramesVisible)
        blockers.push('target_frame_hidden');
    if (!plan.checks.targetFramesSupported)
        blockers.push('target_frame_unsupported');
    return blockers;
}
const planMappingSchema = z.strictObject({
    sourcePostScriptName: fontPostScriptNameSchema,
    replacementPostScriptName: fontPostScriptNameSchema,
    source: fontDescriptorSchema.nullable(),
    replacement: fontDescriptorSchema.nullable(),
    sourceVerified: z.boolean(),
    replacementVerified: z.boolean(),
    characters: z.number().int().nonnegative().max(REPLACE_FONT_MAX_CHARACTERS),
    stories: z.number().int().nonnegative().max(REPLACE_FONT_MAX_FRAMES),
    ranges: z.number().int().nonnegative().max(REPLACE_FONT_MAX_CHARACTERS),
});
export const replaceFontPlanSchema = z.strictObject({
    operation: z.literal(REPLACE_FONT_OPERATION),
    documentKey: z.string().min(1).max(16_384),
    mappings: z.array(planMappingSchema).min(1).max(REPLACE_FONT_MAX_MAPPINGS),
    scope: planScopeSchema,
    usage: usageSchema,
    remaining: remainingSchema,
    blockedFrames: blockedFramesSchema,
    checks: checksSchema,
    applyBlockedReasonCodes: z.array(blockerSchema),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    const mappingProblem = mappingSetProblem(plan.mappings.map((mapping) => ({ source: mapping.sourcePostScriptName, replacement: mapping.replacementPostScriptName })));
    if (mappingProblem !== null)
        context.addIssue({ code: 'custom', message: mappingProblem });
    const every = (test) => plan.mappings.every(test);
    if (!every((mapping) => (mapping.source === null || mapping.source.postScriptName === mapping.sourcePostScriptName) &&
        (mapping.replacement === null || mapping.replacement.postScriptName === mapping.replacementPostScriptName) &&
        (!mapping.sourceVerified || mapping.source !== null) && (!mapping.replacementVerified || mapping.replacement !== null)) ||
        plan.checks.sourceInstalled !== every((mapping) => mapping.source !== null) ||
        plan.checks.replacementInstalled !== every((mapping) => mapping.replacement !== null) ||
        plan.checks.sourceVerified !== every((mapping) => mapping.source === null || mapping.sourceVerified) ||
        plan.checks.replacementVerified !== every((mapping) => mapping.replacement === null || mapping.replacementVerified)) {
        context.addIssue({ code: 'custom', message: 'A font replacement plan must report exactly the requested installed and verified fonts.' });
    }
    const perMapping = plan.mappings.map(() => ({ characters: 0, stories: 0, ranges: 0 }));
    for (const story of plan.usage.storyList) {
        const seen = new Set();
        story.mappings.forEach((index, position) => {
            const counts = perMapping[index];
            if (counts === undefined)
                return;
            const [start, end] = story.ranges[position];
            counts.characters += end - start;
            counts.ranges += 1;
            if (!seen.has(index)) {
                seen.add(index);
                counts.stories += 1;
            }
        });
        if (story.mappings.some((index) => index >= plan.mappings.length)) {
            context.addIssue({ code: 'custom', message: 'A font range must name a pair of the plan.' });
        }
    }
    if (plan.mappings.some((mapping, index) => mapping.characters !== perMapping[index].characters ||
        mapping.stories !== perMapping[index].stories || mapping.ranges !== perMapping[index].ranges)) {
        context.addIssue({ code: 'custom', message: 'Each pair must count exactly its planned ranges.' });
    }
    if (plan.checks.mappingsFitOneApply !== (plan.mappings.length === 1 || plan.remaining.stories === 0)) {
        context.addIssue({ code: 'custom', message: 'Several pairs must fit one apply.' });
    }
    if (!plan.usage.complete && (plan.remaining.stories !== 0 || plan.remaining.characters !== 0 || plan.blockedFrames.total !== 0)) {
        context.addIssue({ code: 'custom', message: 'An incomplete font scan reports no remaining or blocked frames.' });
    }
    if (plan.remaining.stories > 0 && plan.usage.stories === 0) {
        context.addIssue({ code: 'custom', message: 'Remaining font usage requires a planned chunk.' });
    }
    if ((plan.remaining.stories === 0) !== (plan.remaining.characters === 0)) {
        context.addIssue({ code: 'custom', message: 'Remaining font usage must count stories and characters together.' });
    }
    if (plan.blockedFrames.total <= REPLACE_FONT_MAX_BLOCKED_FRAMES) {
        const listed = (reason) => plan.blockedFrames.frames.some((frame) => frame.reasons.includes(reason));
        if (plan.checks.targetFramesUnlocked === listed('locked') || plan.checks.targetFramesVisible === listed('hidden') ||
            plan.checks.fontsReadable === listed('unreadable') || plan.checks.targetFramesSupported === listed('unsupported')) {
            context.addIssue({ code: 'custom', message: 'blockedFrames reasons must match the target frame checks.' });
        }
    }
    const allowed = plan.confirmationStatus === 'confirmed' && plan.applyBlockedReasonCodes.length === 0;
    if (plan.applyAllowed !== allowed) {
        context.addIssue({ code: 'custom', message: 'Font replacement applyAllowed must require confirmation and no blockers.' });
    }
});
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']),
    reasonCode: z.enum(['apply_failed', 'verify_mismatch']),
    message: z.string().min(1).max(500),
}).superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed')) {
        context.addIssue({ code: 'custom', message: 'Font replacement failure phase and reason code must match.' });
    }
});
const indeterminateFailureSchema = z.strictObject({
    phase: z.literal('apply'),
    reasonCode: z.literal('apply_indeterminate'),
    message: z.string().min(1).max(500),
});
const rollbackEvidence = { restoredExactly: z.boolean() };
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
            status: z.literal('indeterminate'), reasonCode: z.literal('font_state_unknown'),
            message: z.string().min(1).max(500), restoredExactly: z.literal(false),
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
        context.addIssue({ code: 'custom', message: 'Font replacement audit sequence does not match transaction state.' });
    }
    transaction.audit.forEach((event, index) => {
        if (event.sequence !== index) {
            context.addIssue({ code: 'custom', message: 'Font replacement audit sequence must be contiguous.' });
        }
    });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' &&
            event.phase === transaction.failure.phase && event.reasonCode === transaction.failure.reasonCode &&
            event.message === transaction.failure.message);
        if (matches.length !== 1) {
            context.addIssue({ code: 'custom', message: 'Font replacement failure must match one audit event.' });
        }
    }
});
const boundsSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
const frameGeometrySchema = z.strictObject({
    geometricBounds: boundsSchema,
    visibleBounds: boundsSchema,
    lineCount: z.number().int().nonnegative(),
});
const postconditionSchema = z.strictObject({
    replacedCharacters: z.number().int().positive().max(REPLACE_FONT_MAX_CHARACTERS),
    frames: z.array(z.strictObject({
        uuid: uuidSchema,
        before: frameGeometrySchema,
        after: frameGeometrySchema,
    })).min(1).max(REPLACE_FONT_MAX_FRAMES),
});
export const replaceFontResultSchema = z.union([
    z.strictObject({
        operation: z.literal(REPLACE_FONT_OPERATION), applied: z.literal(false),
        document: documentContextSchema, plan: replaceFontPlanSchema, transaction: transactionSchema,
    }),
    z.strictObject({
        operation: z.literal(REPLACE_FONT_OPERATION), applied: z.literal(true),
        document: documentContextSchema, plan: replaceFontPlanSchema,
        postcondition: postconditionSchema, transaction: transactionSchema,
    }),
]).superRefine((result, context) => {
    if (result.transaction.state === 'planned') {
        if (result.plan.confirmationStatus !== 'required' ||
            canonicalSha256(result.plan.applyBlockedReasonCodes) !==
                canonicalSha256(expectedBlockers(result.plan, result.document.mutationAllowed))) {
            context.addIssue({ code: 'custom', message: 'A planned font replacement must expose exact blockers.' });
        }
    }
    else if (result.plan.confirmationStatus !== 'confirmed' ||
        result.plan.applyBlockedReasonCodes.length !== 0 || !result.plan.applyAllowed) {
        context.addIssue({ code: 'custom', message: 'A font replacement must derive from an allowed confirmed plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified') {
            context.addIssue({ code: 'custom', message: 'A replaced font must come from a verified transaction.' });
        }
        const planned = result.plan.usage.storyList.flatMap((entry) => entry.frames);
        if (result.postcondition.replacedCharacters !== result.plan.usage.characters ||
            result.postcondition.frames.length !== planned.length ||
            result.postcondition.frames.some((frame, index) => frame.uuid !== planned[index])) {
            context.addIssue({ code: 'custom', message: 'A font replacement postcondition must cover exactly the planned frames.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified font replacement must report its postcondition.' });
    }
    if (result.transaction.state === 'rolled_back' && !result.transaction.rollback.restoredExactly) {
        context.addIssue({ code: 'custom', message: 'A rolled-back font replacement must prove the exact before state.' });
    }
});
export const replaceFontResponseSchema = z.strictObject({
    outcome: replaceFontResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
export const replaceFontScopeSchema = z.union([
    z.strictObject({ artboard_index: z.number().int().nonnegative().max(999) }),
    z.strictObject({ layer_path: layerPathSchema }),
    z.strictObject({ selection: z.literal(true) }),
    z.strictObject({ target_uuids: z.array(uuidSchema).min(1).max(REPLACE_FONT_MAX_FRAMES) }),
]);
const internalScopeSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('artboard'), artboardIndex: z.number().int().nonnegative().max(999) }),
    z.strictObject({ kind: z.literal('layer'), layerPath: layerPathSchema }),
    z.strictObject({ kind: z.literal('selection') }),
    z.strictObject({ kind: z.literal('target_uuids'), uuids: z.array(uuidSchema).min(1).max(REPLACE_FONT_MAX_FRAMES) }),
]);
function internalScope(scope) {
    if ('artboard_index' in scope)
        return { kind: 'artboard', artboardIndex: scope.artboard_index };
    if ('layer_path' in scope)
        return { kind: 'layer', layerPath: scope.layer_path };
    if ('selection' in scope)
        return { kind: 'selection' };
    if (new Set(scope.target_uuids).size !== scope.target_uuids.length)
        throw new Error('scope.target_uuids must not repeat a UUID.');
    return { kind: 'target_uuids', uuids: scope.target_uuids };
}
const internalMappingSchema = z.strictObject({
    sourcePostScriptName: fontPostScriptNameSchema,
    replacementPostScriptName: fontPostScriptNameSchema,
});
const commonInternal = {
    expectedDocumentKey: z.string().min(1).max(16_384),
    mappings: z.array(internalMappingSchema).min(1).max(REPLACE_FONT_MAX_MAPPINGS),
    fontVerification: z.record(fontPostScriptNameSchema, z.boolean()).optional(),
    scope: internalScopeSchema.optional(),
};
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({
        ...commonInternal,
        expectedUsage: expectedUsageSchema,
        expectedTargets: z.array(expectedTargetSchema).min(1).max(REPLACE_FONT_MAX_FRAMES),
        apply: z.literal(true),
        commandId: canonicalCommandIdSchema,
    }),
]);
const publicMappingSchema = z.strictObject({ from: fontPostScriptNameSchema, to: fontPostScriptNameSchema });
const commonPublic = {
    expected_document_key: z.string().min(1).max(16_384),
    source_post_script_name: fontPostScriptNameSchema.optional(),
    replacement_post_script_name: fontPostScriptNameSchema.optional(),
    mappings: z.array(publicMappingSchema).min(1).max(REPLACE_FONT_MAX_MAPPINGS).optional(),
    scope: replaceFontScopeSchema.optional(),
};
export const replaceFontPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({
        ...commonPublic,
        expected_usage: expectedUsageSchema,
        expected_targets: z.array(expectedTargetSchema).min(1).max(REPLACE_FONT_MAX_FRAMES),
        apply: z.literal(true),
        command_id: applyCommandIdSchema,
    }),
]);
const inputSchema = z.strictObject({
    ...commonPublic,
    expected_usage: expectedUsageSchema.optional(),
    expected_targets: z.array(expectedTargetSchema).min(1).max(REPLACE_FONT_MAX_FRAMES).optional(),
    apply: z.boolean().default(false),
    command_id: applyCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(replaceFontPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
export function mappingSetProblem(mappings) {
    if (mappings.some((mapping) => mapping.source === mapping.replacement))
        return 'A font replacement must name two different fonts.';
    const sources = mappings.map((mapping) => mapping.source);
    if (new Set(sources).size !== sources.length)
        return 'Each source font may appear in only one pair.';
    const sourceSet = new Set(sources);
    if (mappings.some((mapping) => sourceSet.has(mapping.replacement))) {
        return 'A font may not be both a source and a replacement (no chains or cycles): replace in separate calls instead.';
    }
    return null;
}
function assertMappings(mappings) {
    const problem = mappingSetProblem(mappings.map((mapping) => ({ source: mapping.sourcePostScriptName, replacement: mapping.replacementPostScriptName })));
    if (problem !== null)
        throw new Error(problem);
}
function assertExpectedTargets(usage, targets, mappingCount) {
    if (targets.length !== usage.stories || rangeLength(targets.flatMap((target) => target.ranges)) !== usage.characters ||
        new Set(targets.map((target) => target.uuid)).size !== targets.length) {
        throw new Error('expected_targets must list exactly expected_usage.stories stories holding expected_usage.characters characters.');
    }
    if (targets.some((target) => (target.mappings === undefined ? mappingCount !== 1 : target.mappings.some((index) => index >= mappingCount)))) {
        throw new Error('expected_targets.mappings must give each range the index of one of the pairs (required with several pairs).');
    }
}
function canonicalTargets(targets) {
    return targets.map((target) => ({ uuid: target.uuid, ranges: target.ranges, mappings: rangeMappings(target) }));
}
function normalizePublicInput(input) {
    const value = replaceFontPublicInputSchema.parse(input);
    const pairForm = value.source_post_script_name !== undefined || value.replacement_post_script_name !== undefined;
    let mappings;
    if (value.mappings !== undefined) {
        if (pairForm)
            throw new Error('Use either source_post_script_name with replacement_post_script_name, or mappings, not both.');
        mappings = value.mappings.map((mapping) => ({ sourcePostScriptName: mapping.from, replacementPostScriptName: mapping.to }));
    }
    else {
        if (value.source_post_script_name === undefined || value.replacement_post_script_name === undefined) {
            throw new Error('Name the fonts: source_post_script_name and replacement_post_script_name, or mappings: [{ from, to }].');
        }
        mappings = [{ sourcePostScriptName: value.source_post_script_name, replacementPostScriptName: value.replacement_post_script_name }];
    }
    assertMappings(mappings);
    const common = {
        expectedDocumentKey: value.expected_document_key,
        mappings,
        ...(value.scope === undefined ? {} : { scope: internalScope(value.scope) }),
    };
    if (!value.apply)
        return { ...common, apply: false };
    assertExpectedTargets(value.expected_usage, value.expected_targets, mappings.length);
    return { ...common, expectedUsage: value.expected_usage, expectedTargets: canonicalTargets(value.expected_targets),
        apply: true, commandId: value.command_id };
}
function requestFontNames(mappings) {
    return [...new Set(mappings.flatMap((mapping) => [mapping.sourcePostScriptName, mapping.replacementPostScriptName]))];
}
async function admit(input, services) {
    const request = input;
    const { fontVerification: _ignored, ...rest } = request;
    const mappings = z.array(internalMappingSchema).min(1).max(REPLACE_FONT_MAX_MAPPINGS).parse(request.mappings);
    const names = requestFontNames(mappings);
    const verification = services.fontVerifier === undefined ? {}
        : await services.fontVerifier.verify(names, services.applicationBundleId ?? null);
    return { ...rest, fontVerification: Object.fromEntries(names.map((name) => [name, verification[name] != null])) };
}
export const REPLACE_FONT_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: REPLACE_FONT_OPERATION,
    policy: {
        version: POLICY_VERSION, class: 'update_existing', destructive: false,
        evidence: { identity: 'target_native_uuid_set', beforeState: 'before_state_hash',
            postcondition: 'updated_state_matches_plan' },
        preconditions: { documentBinding: 'explicit_document_key', compareAndSet: 'before_state_hash_match' },
        confirmation: 'exact_change_set',
        recovery: { mode: 'verified_inverse', verification: 'restored_state_matches_before_hash',
            partialRecovery: 'indeterminate' },
        terminal: { success: 'verified', failure: 'proven_pre_apply_or_verified_recovery',
            partialSuccess: 'nonterminal_until_reconciled' },
        replay: { requestBinding: 'canonical_request_digest', retry: 'return_attested_terminal_result',
            beforeTerminal: 'reconcile_required', reapplyOnRetry: false },
    },
    capabilities: {
        class: 'update_existing', explicitDocumentBinding: true, bindTargetNativeUuid: true,
        captureBeforeStateHash: true, compareAndSetBeforeApply: true, verifyUpdatedState: true,
        recoveryMode: 'verified_inverse', verifyRestoredBeforeState: true, reconcileIndeterminate: true,
        durableTerminalReplay: true, trustedTerminalAttestationResolver: true,
    },
});
export const REPLACE_FONT_SAFETY_IDENTITY = canonicalDigest(REPLACE_FONT_SAFETY);
function targetEvidence(result) {
    const targetUuids = result.plan.usage.storyList.flatMap((entry) => entry.frames);
    return { targetUuids, targetSetHash: canonicalDigest(targetUuids) };
}
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    const plan = result.plan;
    const sources = plan.mappings.map((mapping) => mapping.sourcePostScriptName);
    const replacements = plan.mappings.map((mapping) => mapping.replacementPostScriptName);
    const beforeStateHash = canonicalDigest({ fonts: sources, usage: plan.usage });
    const afterStateHash = canonicalDigest({ fonts: replacements, usage: plan.usage });
    const changeSetHash = canonicalDigest({ sources, replacements, beforeStateHash, afterStateHash });
    return bindOperationSafetyPlan({
        policyVersion: POLICY_VERSION, operationClass: 'update_existing', operationId: REPLACE_FONT_OPERATION,
        canonicalRequestDigest: requestDigest,
        evidence: { documentKey: admissionDocumentKey, ...targetEvidence(result),
            beforeStateHash, plannedAfterStateHash: afterStateHash, plannedChangeSetDigest: changeSetHash },
        preconditions: { status: plan.applyBlockedReasonCodes.length === 0 ? 'satisfied' : 'blocked',
            compareAndSetMatched: plan.applyBlockedReasonCodes.length === 0 },
        confirmation: { kind: 'exact_change_set', canonicalRequestDigest: requestDigest, changeSetHash,
            status: plan.confirmationStatus },
        applyAllowed: plan.applyAllowed,
    });
}
function safetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' ||
        transaction.state === 'rollback_indeterminate' || transaction.state === 'rollback_failed') {
        throw new Error('Indeterminate or failed font replacement recovery cannot be terminal.');
    }
    const common = { policyVersion: POLICY_VERSION, operationClass: 'update_existing',
        operationId: REPLACE_FONT_OPERATION, canonicalRequestDigest: requestDigest,
        planDigest: plan.planDigest, attestation };
    const boundPlan = plan;
    const beforeStateHash = boundPlan.evidence.beforeStateHash;
    const target = targetEvidence(result);
    if (transaction.state === 'verified' && result.applied) {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { ...target, beforeStateHash, afterStateHash: boundPlan.evidence.plannedAfterStateHash,
                restoredStateHash: null, restoredBeforeStateVerified: false },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'succeeded', terminal: true, recovery: 'not_required',
                proof: { kind: 'verified_postcondition' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    if (transaction.state === 'rolled_back') {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { ...target, beforeStateHash, afterStateHash: null,
                restoredStateHash: beforeStateHash, restoredBeforeStateVerified: true },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'recovered', terminal: true, recovery: 'verified',
                proof: { kind: 'verified_recovery' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    return operationSafetyResultSchema.parse({ ...common,
        evidence: { ...target, beforeStateHash, afterStateHash: null,
            restoredStateHash: null, restoredBeforeStateVerified: false },
        executionEvidence: { outcome: 'proven_pre_apply' },
        resolution: { status: 'failed', terminal: true, recovery: 'not_required',
            proof: { kind: 'proven_pre_apply', mutationAttempted: false },
            replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
}
async function assertSafety(value, requestDigest, attestation, resolver) {
    const result = replaceFontResultSchema.parse(value);
    if (result.transaction.state === 'planned')
        return;
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (attestation === null || resolver === null) {
        throw new Error('Font replacement terminal result requires attestation.');
    }
    await assertOperationSafetyAdapterConformance({ registration: REPLACE_FONT_SAFETY, plan,
        result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
export const REPLACE_FONT_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${FONT_LOOKUP_HOST_SCRIPT}
var RPL_FONT_MAX_FRAMES = ${REPLACE_FONT_MAX_FRAMES};
var RPL_FONT_MAX_CHARACTERS = ${REPLACE_FONT_MAX_CHARACTERS};
var RPL_FONT_MAX_SCAN_CHARACTERS = ${REPLACE_FONT_MAX_SCAN_CHARACTERS};
var RPL_FONT_MAX_RUNS = ${REPLACE_FONT_MAX_RUNS};
var RPL_FONT_MAX_SCAN_RUNS = ${REPLACE_FONT_MAX_SCAN_RUNS};
var RPL_FONT_MAX_DOCUMENT_FRAMES = ${REPLACE_FONT_MAX_DOCUMENT_FRAMES};
var RPL_FONT_MAX_BLOCKED_FRAMES = ${REPLACE_FONT_MAX_BLOCKED_FRAMES};

/**
 * The pairs, and source font name -> pair index (keys prefixed so no font name meets an Object property). Read
 * defensively here so the document admission, not a missing field, answers a malformed request first.
 */
var RPL_FONT_MAPPINGS = params.mappings instanceof Array ? params.mappings : [];
var RPL_FONT_PAIRS = {};
for (var rplPair = 0; rplPair < RPL_FONT_MAPPINGS.length; rplPair++) RPL_FONT_PAIRS["f:" + RPL_FONT_MAPPINGS[rplPair].sourcePostScriptName] = rplPair;

/** The pair whose source a row's font is, or -1. */
function rplFontPairOf(row) {
  if (row === null) return -1;
  var pair = RPL_FONT_PAIRS["f:" + rplFontRowName(row)];
  return typeof pair === "number" ? pair : -1;
}

/** A name verified by an external source or clean Illustrator inventory by the Node admission (#440); anything else is unverified. */
function rplFontVerified(fontName) {
  var verification = params.fontVerification;
  return verification !== null && verification !== undefined && verification.hasOwnProperty(fontName) && verification[fontName] === true;
}

/** Key-order-independent JSON, so an echoed object compares equal whatever order its keys arrive in. */
function rplFontCanonicalJson(value) {
  if (value === null || typeof value !== "object") return stringifyJson(value);
  if (value instanceof Array) {
    var items = [];
    for (var index = 0; index < value.length; index++) items.push(rplFontCanonicalJson(value[index]));
    return "[" + items.join(",") + "]";
  }
  var keys = [];
  for (var key in value) if (value.hasOwnProperty(key)) keys.push(key);
  keys.sort();
  var fields = [];
  for (var keyIndex = 0; keyIndex < keys.length; keyIndex++) {
    fields.push(stringifyJson(keys[keyIndex]) + ":" + rplFontCanonicalJson(value[keys[keyIndex]]));
  }
  return "{" + fields.join(",") + "}";
}

function rplFontSame(left, right) {
  return left !== null && left !== undefined && right !== null && right !== undefined &&
    rplFontCanonicalJson(left) === rplFontCanonicalJson(right);
}

function rplFontBounds(bounds) {
  return [Number(bounds[0]), Number(bounds[1]), Number(bounds[2]), Number(bounds[3])];
}

function rplFontScopeError(field, reason) {
  return new Error("MCP_ERROR:" + stringifyJson({ code: "FONT_SCOPE_INVALID", field: field, reason: reason }));
}

/** A UUID lookup that answers null for the measured unknown-UUID error (MRAP 1200) and rethrows every other error. */
function rplFontFind(document, uuid) {
  try {
    var item = document.getPageItemFromUuid(uuid);
    return item === null || item === undefined ? null : item;
  } catch (lookupError) {
    var message = lookupError && lookupError.message ? String(lookupError.message) : "";
    if (lookupError && lookupError.number === 1200 && message === "an Illustrator error occurred: 1346458189 ('MRAP')") return null;
    throw lookupError;
  }
}

/** The scope as a frame predicate's data; invalid references are errors, not blockers. */
function rplFontScope(document) {
  var scope = params.scope;
  if (scope === null || scope === undefined) return { kind: "document", ignoredItems: 0 };
  if (scope.kind === "artboard") {
    if (scope.artboardIndex >= document.artboards.length) throw rplFontScopeError("artboard_index", "out_of_range");
    return { kind: "artboard", rect: rplFontBounds(document.artboards[scope.artboardIndex].artboardRect), ignoredItems: 0 };
  }
  if (scope.kind === "layer") {
    var layers = document.layers;
    var layer = null;
    for (var depth = 0; depth < scope.layerPath.length; depth++) {
      if (!layers || scope.layerPath[depth] >= layers.length) throw rplFontScopeError("layer_path", "not_found");
      layer = layers[scope.layerPath[depth]];
      layers = layer.layers;
    }
    return { kind: "layer", layer: layer, ignoredItems: 0 };
  }
  var uuids = {};
  var ignored = 0;
  if (scope.kind === "selection") {
    var selection = document.selection;
    if (selection === null || selection === undefined) selection = [];
    if (typeof selection !== "object" || selection.typename !== undefined || typeof selection.length !== "number") {
      throw rplFontScopeError("selection", "not_objects");
    }
    for (var index = 0; index < selection.length; index++) {
      var item = selection[index];
      if (item && item.typename === "TextFrame") uuids[String(item.uuid)] = true;
      else ignored++;
    }
    return { kind: "selection", uuids: uuids, ignoredItems: ignored };
  }
  for (var target = 0; target < scope.uuids.length; target++) {
    var found = rplFontFind(document, scope.uuids[target]);
    if (found === null) throw rplFontScopeError("target_uuids", "not_found");
    if (found.typename !== "TextFrame") throw rplFontScopeError("target_uuids", "not_text_frame");
    uuids[scope.uuids[target]] = true;
  }
  return { kind: "target_uuids", uuids: uuids, ignoredItems: 0 };
}

/** Frame membership: its UUID, the centre of its geometric bounds, or a layer among its ancestors. */
function rplFontInScope(scope, frame, uuid, bounds) {
  if (scope.kind === "document") return true;
  if (scope.uuids) return scope.uuids[uuid] === true;
  if (scope.kind === "artboard") {
    var x = (bounds[0] + bounds[2]) / 2;
    var y = (bounds[1] + bounds[3]) / 2;
    return x >= scope.rect[0] && x <= scope.rect[2] && y <= scope.rect[1] && y >= scope.rect[3];
  }
  for (var node = frame.layer; node && node.typename === "Layer"; node = node.parent) {
    if (node === scope.layer) return true;
  }
  return false;
}

function rplFontLayerPath(document, targetLayer) {
  function visit(layers, prefix) {
    for (var index = 0; index < layers.length; index++) {
      var layer = layers[index];
      var path = prefix.concat([index]);
      if (layer === targetLayer) return path;
      if (path.length < 64 && layer.layers && layer.layers.length > 0) {
        var nested = visit(layer.layers, path);
        if (nested !== null) return nested;
      }
    }
    return null;
  }
  return visit(document.layers, []);
}

function rplFontAttempt(read) {
  try { return String(read()); }
  catch (error) { return "E" + (error && error.number !== undefined ? error.number : "?"); }
}

function rplFontPaint(color) {
  var type = String(color.typename);
  if (type === "CMYKColor") return "C" + [color.cyan, color.magenta, color.yellow, color.black].join(",");
  if (type === "RGBColor") return "R" + [color.red, color.green, color.blue].join(",");
  if (type === "GrayColor") return "G" + color.gray;
  return type;
}

/**
 * One style run's font name plus the attributes a font change must not move, as one string (the attributes the
 * booklet measurement read unchanged across the write and the inverse). The font name is the first field so a
 * planned row can be predicted by swapping it alone.
 */
function rplFontRow(range) {
  var a = range.characterAttributes;
  var name;
  try {
    var font = a.textFont;
    if (!font || typeof font.name !== "string" || !font.name) return null;
    name = font.name;
  } catch (fontError) { return null; }
  return [name, String(a.size), String(a.leading), String(a.tracking), String(a.horizontalScale),
    String(a.verticalScale), String(a.baselineShift),
    rplFontAttempt(function () { return a.autoLeading; }), rplFontAttempt(function () { return a.proportionalMetrics; }),
    rplFontAttempt(function () { return a.Tsume; }), rplFontAttempt(function () { return a.akiLeft; }),
    rplFontAttempt(function () { return a.akiRight; }), rplFontAttempt(function () { return a.kerningMethod; }),
    rplFontAttempt(function () { return a.alternateGlyphs; }), rplFontAttempt(function () { return a.baselineDirection; }),
    rplFontAttempt(function () { return a.language; }), rplFontAttempt(function () { return a.rotation; }),
    rplFontAttempt(function () { return a.noBreak; }), rplFontAttempt(function () { return a.wariChuEnabled; }),
    rplFontAttempt(function () { return a.tateChuYokoHorizontal; }),
    rplFontAttempt(function () { return rplFontPaint(a.fillColor); })].join("|");
}

function rplFontRowName(row) {
  return row === null ? null : row.substring(0, row.indexOf("|"));
}

function rplFontSwapName(row, name) {
  return name + row.substring(row.indexOf("|"));
}

function rplFontPushRun(runs, row, length) {
  if (runs.length > 0 && runs[runs.length - 1][0] === row) runs[runs.length - 1][1] += length;
  else runs.push([row, length]);
}

/**
 * The story's style runs (measured: \`start\`, then \`end\`, then \`getTextRunLength()\` returns the absolute end of the
 * native run that contains \`start\`), as [row, length] pairs with equal neighbours merged. The cost is one read per
 * native run, so \`budget.runs\` bounds it; null when the budget runs out.
 */
function rplFontStoryRuns(story, length, budget) {
  var range = story.textRange;
  var runs = [];
  var position = 0;
  var reads = 0;
  while (position < length) {
    if (--budget.runs < 0) return null;
    reads++;
    range.start = position;
    range.end = length;
    var runEnd = Number(range.getTextRunLength());
    if (!(runEnd > position) || runEnd % 1 !== 0) {
      throw new Error("MCP_ERROR:" + stringifyJson({ code: "FONT_SCAN_UNREADABLE" }));
    }
    if (runEnd > length) runEnd = length;
    range.end = runEnd;
    rplFontPushRun(runs, rplFontRow(range), runEnd - position);
    position = runEnd;
  }
  return { runs: runs, reads: reads };
}

function rplFontLastLineEnd(frame) {
  var lines = frame.lines;
  return lines.length > 0 ? Number(lines[lines.length - 1].end) : -1;
}

/**
 * The measured story shapes: point or area frames only, and not overset (the last visible line of the story reaches
 * its end; a trailing paragraph return has no line of its own).
 */
function rplFontStorySupported(frames, story, length) {
  var lastEnd = -1;
  for (var index = 0; index < frames.length; index++) {
    var kind = frames[index].kind;
    if (kind !== TextType.POINTTEXT && kind !== TextType.AREATEXT) return false;
    var end = rplFontLastLineEnd(frames[index]);
    if (end > lastEnd) lastEnd = end;
  }
  var contents = String(story.textRange.contents);
  var trailing = contents.length > 0 && contents.charAt(contents.length - 1) === "\\r" ? 1 : 0;
  return lastEnd >= length - trailing;
}

function rplFontGeometry(frame) {
  return { geometricBounds: rplFontBounds(frame.geometricBounds), visibleBounds: rplFontBounds(frame.visibleBounds),
    lineCount: frame.lines.length };
}

function rplFontFrameState(frame) {
  var hidden = frame.hidden === true;
  var locked = frame.locked === true || frame.editable !== true;
  for (var node = frame.parent; node && node.typename !== "Document"; node = node.parent) {
    if (node.typename === "Layer") {
      if (node.visible !== true) hidden = true;
      if (node.locked === true) locked = true;
    } else {
      if (node.hidden === true) hidden = true;
      if (node.locked === true) locked = true;
    }
  }
  return { hidden: hidden, locked: locked };
}

/** Every text frame's UUID, story and bounds in document order, and the stories with a frame in the scope. */
function rplFontCollect(document, scope) {
  var frames = document.textFrames;
  if (!frames || typeof frames.length !== "number") {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "FONT_SCAN_UNREADABLE" }));
  }
  var collected = { complete: true, frames: [], stories: [], byKey: {}, frameInScope: {} };
  if (frames.length > RPL_FONT_MAX_DOCUMENT_FRAMES) { collected.complete = false; return collected; }
  for (var index = 0; index < frames.length; index++) {
    var frame = frames[index];
    var uuid = String(frame.uuid);
    var bounds = rplFontBounds(frame.geometricBounds);
    var story = frame.story;
    var members = story.textFrames;
    var key = String(members[0].uuid);
    collected.frames.push({ uuid: uuid, story: key, bounds: bounds });
    var entry = collected.byKey[key];
    if (entry === undefined) {
      var uuids = [];
      var handles = [];
      for (var member = 0; member < members.length; member++) {
        uuids.push(String(members[member].uuid));
        handles.push(members[member]);
      }
      entry = { key: key, story: story, frames: uuids, handles: handles, inScope: false };
      collected.byKey[key] = entry;
      collected.stories.push(entry);
    }
    if (rplFontInScope(scope, frame, uuid, bounds)) {
      collected.frameInScope[uuid] = true;
      entry.inScope = true;
    }
  }
  return collected;
}

/**
 * The runs of the given stories; null when they exceed \`limits\` (characters and native run reads). An apply scans at
 * most one chunk, a plan or a re-read at most the scan limits, so no host call outgrows its measured time.
 */
function rplFontReadStories(entries, limits) {
  var scanned = 0;
  var budget = { runs: limits.runs };
  var out = {};
  for (var index = 0; index < entries.length; index++) {
    var entry = entries[index];
    var length = Number(entry.story.textRange.length);
    scanned += length;
    if (scanned > limits.characters) return null;
    var read = rplFontStoryRuns(entry.story, length, budget);
    if (read === null) return null;
    out[entry.key] = { length: length, runs: read.runs, reads: read.reads };
  }
  return out;
}

var RPL_FONT_SCAN_LIMITS = { characters: RPL_FONT_MAX_SCAN_CHARACTERS, runs: RPL_FONT_MAX_SCAN_RUNS };
var RPL_FONT_APPLY_LIMITS = { characters: RPL_FONT_MAX_CHARACTERS, runs: RPL_FONT_MAX_RUNS };

/**
 * One bounded pass: every frame's bounds, every in-scope story's runs, which of them use the source font, the
 * frames that block the replacement, and the chunk of whole stories this apply may change.
 */
function rplFontScan(document, scope) {
  var scan = { complete: true, collected: null, inScope: [], outsideFrames: 0, texts: null, stories: [], targets: [],
    usage: { characters: 0, stories: 0, storyList: [] }, remaining: { stories: 0, characters: 0 },
    blocked: { total: 0, frames: [] }, fontsReadable: true, framesUnlocked: true, framesVisible: true,
    framesSupported: true };
  var collected = rplFontCollect(document, scope);
  scan.collected = collected;
  if (!collected.complete) { scan.complete = false; return scan; }
  for (var index = 0; index < collected.stories.length; index++) {
    var candidate = collected.stories[index];
    if (!candidate.inScope) continue;
    scan.inScope.push(candidate);
    for (var member = 0; member < candidate.frames.length; member++) {
      if (collected.frameInScope[candidate.frames[member]] !== true) scan.outsideFrames++;
    }
  }
  scan.texts = rplFontReadStories(scan.inScope, params.apply === true ? RPL_FONT_APPLY_LIMITS : RPL_FONT_SCAN_LIMITS);
  if (scan.texts === null) { scan.complete = false; return scan; }
  var chunkFrames = 0;
  var chunkCharacters = 0;
  var chunkRuns = 0;
  var chunkClosed = false;
  for (var storyIndex = 0; storyIndex < scan.inScope.length; storyIndex++) {
    var entry = scan.inScope[storyIndex];
    var text = scan.texts[entry.key];
    var ranges = [];
    var rangePairs = [];
    var planned = 0;
    var position = 0;
    var unreadable = false;
    for (var run = 0; run < text.runs.length; run++) {
      var row = text.runs[run][0];
      var count = text.runs[run][1];
      if (row === null) { unreadable = true; scan.fontsReadable = false; }
      var pair = rplFontPairOf(row);
      if (pair >= 0) {
        var last = ranges.length - 1;
        if (last >= 0 && ranges[last][1] === position && rangePairs[last] === pair) ranges[last][1] += count;
        else { ranges.push([position, position + count]); rangePairs.push(pair); }
        planned += count;
      }
      position += count;
    }
    var record = { key: entry.key, frames: entry.frames, handles: entry.handles, story: entry.story,
      ranges: ranges, pairs: rangePairs, planned: planned, target: false, geometry: null };
    scan.stories.push(record);
    // A story whose font cannot be read blocks the scope whatever it uses, so the plan names it.
    if (planned === 0 && !unreadable) continue;
    var blocked = [];
    for (var frameIndex = 0; frameIndex < entry.handles.length; frameIndex++) {
      var reasons = [];
      if (planned > 0) {
        var state = rplFontFrameState(entry.handles[frameIndex]);
        if (state.locked) { reasons.push("locked"); scan.framesUnlocked = false; }
        if (state.hidden) { reasons.push("hidden"); scan.framesVisible = false; }
      }
      blocked.push(reasons);
    }
    if (unreadable) blocked[0].push("unreadable");
    // A story larger than one apply cannot be split: it is outside the supported shapes.
    if (planned > 0 && (text.length > RPL_FONT_MAX_CHARACTERS || text.reads > RPL_FONT_MAX_RUNS ||
        entry.frames.length > RPL_FONT_MAX_FRAMES || !rplFontStorySupported(entry.handles, entry.story, text.length))) {
      blocked[0].push("unsupported");
      scan.framesSupported = false;
    }
    var isBlocked = false;
    for (var listed = 0; listed < blocked.length; listed++) {
      if (blocked[listed].length === 0) continue;
      isBlocked = true;
      scan.blocked.total++;
      if (scan.blocked.frames.length < RPL_FONT_MAX_BLOCKED_FRAMES) {
        scan.blocked.frames.push({ uuid: entry.frames[listed], reasons: blocked[listed],
          layerPath: rplFontLayerPath(document, entry.handles[listed].layer) });
      }
    }
    if (isBlocked) continue;
    if (!chunkClosed && chunkFrames + entry.frames.length <= RPL_FONT_MAX_FRAMES &&
        chunkCharacters + text.length <= RPL_FONT_MAX_CHARACTERS && chunkRuns + text.reads <= RPL_FONT_MAX_RUNS) {
      chunkFrames += entry.frames.length;
      chunkCharacters += text.length;
      chunkRuns += text.reads;
      record.target = true;
      record.geometry = [];
      for (var geometryIndex = 0; geometryIndex < entry.handles.length; geometryIndex++) {
        record.geometry.push(rplFontGeometry(entry.handles[geometryIndex]));
      }
      scan.targets.push(record);
      scan.usage.characters += planned;
      scan.usage.stories++;
      scan.usage.storyList.push({ uuid: entry.key, frames: entry.frames, kind: String(entry.handles[0].kind),
        characters: planned, ranges: ranges, mappings: rangePairs });
    } else {
      chunkClosed = true;
      scan.remaining.stories++;
      scan.remaining.characters += planned;
    }
  }
  return scan;
}

function rplFontPublicUsage(scan) {
  return scan.complete
    ? { complete: true, characters: scan.usage.characters, stories: scan.usage.stories, storyList: scan.usage.storyList }
    : { complete: false, characters: 0, stories: 0, storyList: [] };
}

/** Each pair's fonts as resolved (null when not installed) and whether Node verified the name (#440). */
function rplFontResolvePairs() {
  var pairs = [];
  for (var index = 0; index < RPL_FONT_MAPPINGS.length; index++) {
    var mapping = RPL_FONT_MAPPINGS[index];
    var source = fontExact(mapping.sourcePostScriptName);
    var replacement = fontExact(mapping.replacementPostScriptName);
    pairs.push({ source: source, replacement: replacement,
      sourceVerified: source !== null && rplFontVerified(mapping.sourcePostScriptName),
      replacementVerified: replacement !== null && rplFontVerified(mapping.replacementPostScriptName) });
  }
  return pairs;
}

function rplFontPairChecks(pairs, scan) {
  var checks = { sourceInstalled: true, replacementInstalled: true, sourceVerified: true, replacementVerified: true,
    mappingsFitOneApply: RPL_FONT_MAPPINGS.length === 1 || !scan.complete || scan.remaining.stories === 0 };
  for (var index = 0; index < pairs.length; index++) {
    if (pairs[index].source === null) checks.sourceInstalled = false;
    else if (!pairs[index].sourceVerified) checks.sourceVerified = false;
    if (pairs[index].replacement === null) checks.replacementInstalled = false;
    else if (!pairs[index].replacementVerified) checks.replacementVerified = false;
  }
  return checks;
}

function rplFontBlockers(context, pairs, scan) {
  var blockers = [];
  var checks = rplFontPairChecks(pairs, scan);
  var nothingPlanned = scan.complete && scan.usage.stories === 0;
  if (!context.mutationAllowed) blockers.push("document_mutation_not_allowed");
  if (!checks.sourceInstalled) blockers.push("source_font_not_installed");
  if (!checks.replacementInstalled) blockers.push("replacement_font_not_installed");
  if (!checks.sourceVerified) blockers.push("source_font_not_verifiable");
  if (!checks.replacementVerified) blockers.push("replacement_font_not_verifiable");
  if (!checks.mappingsFitOneApply) blockers.push("mapping_scope_exceeds_limit");
  if (!scan.complete) blockers.push("usage_scan_limit_exceeded");
  if (!scan.fontsReadable) blockers.push("character_font_unreadable");
  if (nothingPlanned && scan.remaining.stories === 0 && scan.blocked.total === 0) blockers.push("source_font_not_used");
  if (!scan.framesUnlocked) blockers.push("target_frame_locked");
  if (!scan.framesVisible) blockers.push("target_frame_hidden");
  if (!scan.framesSupported) blockers.push("target_frame_unsupported");
  return blockers;
}

function rplFontResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  var pairs = rplFontResolvePairs();
  var scope = rplFontScope(document);
  var scan = rplFontScan(document, scope);
  var blockers = rplFontBlockers(context, pairs, scan);
  if (forApply && blockers.length > 0) {
    throw mutationBeforeSideEffectError(stringifyJson({ code: "FONT_REPLACE_BLOCKED", reasonCodes: blockers }));
  }
  return { context: context, document: document, pairs: pairs, scope: scope, scan: scan, blockers: blockers };
}

function rplFontPreflight(forApply) {
  var resolved = rplFontResolve(forApply);
  if (forApply) {
    var usage = rplFontPublicUsage(resolved.scan);
    if (usage.characters !== params.expectedUsage.characters || usage.stories !== params.expectedUsage.stories) {
      throw mutationError("preflight_failed", stringifyJson({ code: "FONT_REPLACE_USAGE_MISMATCH",
        expected: params.expectedUsage, actual: { characters: usage.characters, stories: usage.stories } }));
    }
    var targets = [];
    for (var index = 0; index < usage.storyList.length; index++) {
      targets.push({ uuid: usage.storyList[index].uuid, ranges: usage.storyList[index].ranges,
        mappings: usage.storyList[index].mappings });
    }
    if (!rplFontSame(targets, params.expectedTargets)) {
      throw mutationError("preflight_failed", stringifyJson({ code: "FONT_REPLACE_STALE", field: "expected_targets" }));
    }
  }
  return resolved;
}

/** Each pair with its resolved fonts and what it changes in this apply (characters, stories, ranges). */
function rplFontPlanMappings(preflight) {
  var out = [];
  for (var index = 0; index < RPL_FONT_MAPPINGS.length; index++) {
    var pair = preflight.pairs[index];
    out.push({ sourcePostScriptName: RPL_FONT_MAPPINGS[index].sourcePostScriptName,
      replacementPostScriptName: RPL_FONT_MAPPINGS[index].replacementPostScriptName,
      source: pair.source === null ? null : fontDescriptor(pair.source),
      replacement: pair.replacement === null ? null : fontDescriptor(pair.replacement),
      sourceVerified: pair.sourceVerified, replacementVerified: pair.replacementVerified,
      characters: 0, stories: 0, ranges: 0 });
  }
  var list = rplFontPublicUsage(preflight.scan).storyList;
  for (var story = 0; story < list.length; story++) {
    var seen = {};
    for (var range = 0; range < list[story].ranges.length; range++) {
      var entry = out[list[story].mappings[range]];
      entry.characters += list[story].ranges[range][1] - list[story].ranges[range][0];
      entry.ranges += 1;
      if (seen["p" + list[story].mappings[range]] !== true) { seen["p" + list[story].mappings[range]] = true; entry.stories += 1; }
    }
  }
  return out;
}

function rplFontPlan(preflight) {
  var scan = preflight.scan;
  var checks = rplFontPairChecks(preflight.pairs, scan);
  return {
    operation: "replace_font", documentKey: preflight.context.key,
    mappings: rplFontPlanMappings(preflight),
    scope: { kind: preflight.scope.kind, stories: scan.inScope.length, outsideFrames: scan.outsideFrames,
      ignoredItems: preflight.scope.ignoredItems },
    usage: rplFontPublicUsage(scan),
    remaining: scan.complete ? scan.remaining : { stories: 0, characters: 0 },
    blockedFrames: scan.complete ? scan.blocked : { total: 0, frames: [] },
    checks: { sourceInstalled: checks.sourceInstalled, replacementInstalled: checks.replacementInstalled,
      sourceVerified: checks.sourceVerified, replacementVerified: checks.replacementVerified,
      mappingsFitOneApply: checks.mappingsFitOneApply, fontsReadable: scan.fontsReadable, targetFramesUnlocked: scan.framesUnlocked,
      targetFramesVisible: scan.framesVisible, targetFramesSupported: scan.framesSupported },
    applyBlockedReasonCodes: preflight.blockers,
    confirmationStatus: params.apply === true ? "confirmed" : "required",
    applyAllowed: params.apply === true && preflight.blockers.length === 0
  };
}

/** What a later read must reproduce: every frame's UUID, story and bounds, and every in-scope story's runs. */
function rplFontSnapshot(scan) {
  var texts = {};
  for (var key in scan.texts) {
    if (scan.texts.hasOwnProperty(key)) texts[key] = { length: scan.texts[key].length, runs: scan.texts[key].runs };
  }
  return { frames: scan.collected.frames, texts: texts };
}

function rplFontRevalidate(preflight, plan) {
  var current;
  try { current = rplFontResolve(true); }
  catch (error) {
    throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Font replacement preconditions changed before apply."));
  }
  if (current.document !== preflight.document || !rplFontSame(rplFontPlanMappings(current), plan.mappings) ||
      !rplFontSame(rplFontSnapshot(current.scan), rplFontSnapshot(preflight.scan))) {
    throw mutationBeforeSideEffectError("The fonts or the text using the source font changed before apply.");
  }
}

/** Measured primitive: a fresh story range per planned range, \`start\` then \`end\`, then its textFont. */
function rplFontWriteRanges(story, ranges, font) {
  for (var index = 0; index < ranges.length; index++) {
    var range = story.textRange;
    range.start = ranges[index][0];
    range.end = ranges[index][1];
    var attributes = range.characterAttributes;
    attributes.textFont = font;
  }
}

/** The ranges of one pair. */
function rplFontPairRanges(ranges, pairs, pair) {
  var out = [];
  for (var index = 0; index < ranges.length; index++) if (pairs[index] === pair) out.push(ranges[index]);
  return out;
}

function rplFontApply(preflight, plan, state) {
  state.operationState.mutationStarted = true;
  for (var index = 0; index < preflight.scan.targets.length; index++) {
    var target = preflight.scan.targets[index];
    for (var pair = 0; pair < preflight.pairs.length; pair++) {
      rplFontWriteRanges(target.story, rplFontPairRanges(target.ranges, target.pairs, pair), preflight.pairs[pair].replacement);
    }
  }
  return preflight.document;
}

/** A row after the replacement: a source font's row carries its pair's replacement; any other row is unchanged. */
function rplFontSwapped(row) {
  var pair = rplFontPairOf(row);
  return pair < 0 ? row : rplFontSwapName(row, RPL_FONT_MAPPINGS[pair].replacementPostScriptName);
}

/** A target story's runs after the replacement: every source-font run carries its replacement, neighbours merged. */
function rplFontSwappedRuns(runs) {
  var out = [];
  for (var index = 0; index < runs.length; index++) rplFontPushRun(out, rplFontSwapped(runs[index][0]), runs[index][1]);
  return out;
}

/** Re-read the frames and the before scan's in-scope stories; null when the frames or stories changed shape. */
function rplFontReread(document, before) {
  var collected = rplFontCollect(document, { kind: "document", ignoredItems: 0 });
  if (!collected.complete || collected.frames.length !== before.collected.frames.length) return null;
  for (var index = 0; index < collected.frames.length; index++) {
    var now = collected.frames[index];
    var was = before.collected.frames[index];
    if (now.uuid !== was.uuid || now.story !== was.story) return null;
  }
  var entries = [];
  for (var storyIndex = 0; storyIndex < before.inScope.length; storyIndex++) {
    var entry = collected.byKey[before.inScope[storyIndex].key];
    if (!entry || !rplFontSame(entry.frames, before.inScope[storyIndex].frames)) return null;
    entries.push(entry);
  }
  var texts = rplFontReadStories(entries, RPL_FONT_SCAN_LIMITS);
  return texts === null ? null : { collected: collected, texts: texts, entries: entries };
}

function rplFontTargetKeys(scan) {
  var keys = {};
  for (var index = 0; index < scan.targets.length; index++) keys[scan.targets[index].key] = true;
  return keys;
}

/**
 * After the replacement: each target story's runs are its before runs with the source font swapped, every other
 * in-scope story's runs and every frame outside the target stories' bounds are unchanged.
 */
function rplFontMatchesReplacement(before, after) {
  var keys = rplFontTargetKeys(before);
  for (var index = 0; index < before.collected.frames.length; index++) {
    var was = before.collected.frames[index];
    if (!keys[was.story] && !rplFontSame(after.collected.frames[index].bounds, was.bounds)) return false;
  }
  for (var storyIndex = 0; storyIndex < before.inScope.length; storyIndex++) {
    var key = before.inScope[storyIndex].key;
    var wasText = before.texts[key];
    var nowText = after.texts[key];
    if (nowText.length !== wasText.length) return false;
    if (!rplFontSame(nowText.runs, keys[key] ? rplFontSwappedRuns(wasText.runs) : wasText.runs)) return false;
  }
  return true;
}

function rplFontVerify(preflight, plan) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) {
    throw mutationError("verify_mismatch", "Active document changed during font replacement verification.");
  }
  var after = rplFontReread(preflight.document, preflight.scan);
  if (after === null || !rplFontMatchesReplacement(preflight.scan, after)) {
    throw mutationError("verify_mismatch", "The characters that changed are not exactly the planned font replacement.");
  }
  var frames = [];
  for (var index = 0; index < preflight.scan.targets.length; index++) {
    var target = preflight.scan.targets[index];
    var entry = after.collected.byKey[target.key];
    // Overflow after the replacement is outside the measured profile.
    if (!rplFontStorySupported(entry.handles, entry.story, after.texts[target.key].length)) {
      throw mutationError("verify_mismatch", "Text overflows after the font replacement.");
    }
    for (var frameIndex = 0; frameIndex < entry.handles.length; frameIndex++) {
      var geometry = target.geometry[frameIndex];
      var now = rplFontGeometry(entry.handles[frameIndex]);
      frames.push({ uuid: target.frames[frameIndex], before: geometry, after: now });
    }
  }
  return { replacedCharacters: preflight.scan.usage.characters, frames: frames };
}

/** Expand runs to one row per character (bounded by the scan limit). */
function rplFontExpand(runs) {
  var rows = [];
  for (var index = 0; index < runs.length; index++) {
    for (var count = 0; count < runs[index][1]; count++) rows.push(runs[index][0]);
  }
  return rows;
}

/** The sub-ranges of the planned ranges whose characters now carry the given replacement font. */
function rplFontReplacedRanges(ranges, runs, replacementName) {
  var out = [];
  var position = 0;
  for (var run = 0; run < runs.length; run++) {
    var start = position;
    var end = position + runs[run][1];
    position = end;
    if (runs[run][0] === null || rplFontRowName(runs[run][0]) !== replacementName) continue;
    for (var index = 0; index < ranges.length; index++) {
      var from = Math.max(start, ranges[index][0]);
      var to = Math.min(end, ranges[index][1]);
      if (from < to) out.push([from, to]);
    }
  }
  return out;
}

/**
 * The measured inverse: write the source font back on the planned characters that carry the replacement, then
 * require every in-scope story's runs and every frame's bounds to be exactly the before state. A character that is
 * neither its before nor its planned state is not ours to repair.
 */
function rplFontRollback(state) {
  var preflight = state.preflight;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) {
    return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
  }
  var before = preflight.scan;
  var keys = rplFontTargetKeys(before);
  var current;
  try { current = rplFontReread(preflight.document, before); }
  catch (readError) { return { status: "indeterminate", message: "Rollback font state is indeterminate." }; }
  if (current === null) return { status: "indeterminate", message: "Rollback refused because the text frames changed." };
  for (var storyIndex = 0; storyIndex < before.inScope.length; storyIndex++) {
    var key = before.inScope[storyIndex].key;
    var was = rplFontExpand(before.texts[key].runs);
    var now = rplFontExpand(current.texts[key].runs);
    if (now.length !== was.length) {
      return { status: "indeterminate", message: "Rollback refused because the text frames changed." };
    }
    for (var index = 0; index < was.length; index++) {
      var ours = keys[key] && rplFontPairOf(was[index]) >= 0 && now[index] === rplFontSwapped(was[index]);
      if (now[index] !== was[index] && !ours) {
        return { status: "indeterminate", message: "Rollback refused because a character is neither before nor planned." };
      }
    }
  }
  try {
    for (var targetIndex = 0; targetIndex < before.targets.length; targetIndex++) {
      var target = before.targets[targetIndex];
      var entry = current.collected.byKey[target.key];
      for (var pair = 0; pair < preflight.pairs.length; pair++) {
        rplFontWriteRanges(entry.story, rplFontReplacedRanges(rplFontPairRanges(target.ranges, target.pairs, pair),
          current.texts[target.key].runs, RPL_FONT_MAPPINGS[pair].replacementPostScriptName), preflight.pairs[pair].source);
      }
    }
  } catch (writeError) { return { status: "indeterminate", message: "Rollback font write is indeterminate." }; }
  var restored;
  try { restored = rplFontReread(preflight.document, before); }
  catch (verifyError) { return { status: "indeterminate", message: "Rollback verification is indeterminate." }; }
  var exact = restored !== null && rplFontSame(rplFontSnapshot(restored), rplFontSnapshot(before));
  state.operationState.rollbackEvidence.restoredExactly = exact;
  return exact ? { status: "verified" }
    : { status: "failed", message: "Rollback did not restore the exact before font and text state." };
}

var rplFontExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionAffected: function (phase, preflight) {
    var uuids = [];
    for (var index = 0; index < preflight.scan.targets.length; index++) {
      var frames = preflight.scan.targets[index].frames;
      for (var frameIndex = 0; frameIndex < frames.length; frameIndex++) uuids.push(frames[frameIndex]);
    }
    return uuids;
  },
  initialOperationState: function () {
    return { mutationStarted: false, rollbackEvidence: { restoredExactly: false } };
  },
  preflight: rplFontPreflight,
  plan: rplFontPlan,
  revalidate: rplFontRevalidate,
  applyMutation: rplFontApply,
  verify: rplFontVerify,
  rollback: rplFontRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () {
    return { reasonCode: "font_state_unknown",
      message: "Font replacement outcome is indeterminate.",
      evidence: { restoredExactly: false } };
  },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var rplFontDocument = rplFontExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === rplFontExecution.preflight.document) {
  rplFontDocument = getDocumentContext();
}
var result = { operation: "replace_font",
  applied: rplFontExecution.transaction.state === "verified",
  document: rplFontDocument, plan: rplFontExecution.plan, transaction: rplFontExecution.transaction };
if (rplFontExecution.transaction.state === "verified") result.postcondition = rplFontExecution.value;
`;
export const REPLACE_FONT_HOST_SCRIPT_DIGEST = canonicalSha256(REPLACE_FONT_SCRIPT);
export const REPLACE_FONT_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: REPLACE_FONT_OPERATION,
    validator: REPLACE_FONT_VALIDATOR, canonicalContractVersion: CANONICAL_VERSION,
    resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: REPLACE_FONT_SAFETY_IDENTITY,
    hostScriptDigest: REPLACE_FONT_HOST_SCRIPT_DIGEST,
    mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    assertMappings(request.mappings);
    if (request.apply) {
        assertExpectedTargets(request.expectedUsage, request.expectedTargets, request.mappings.length);
        if (request.expectedTargets.some((target) => target.mappings === undefined)) {
            throw new Error('Internal expectedTargets must carry the pair index of every range.');
        }
    }
    const digestRequest = 'commandId' in request
        ? (({ commandId: _commandId, ...rest }) => rest)(request)
        : request;
    const digest = canonicalSha256({ operation: REPLACE_FONT_OPERATION,
        validator: REPLACE_FONT_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request,
        commandId: 'commandId' in request ? request.commandId : null,
        documentKey: request.expectedDocumentKey, digest };
}
export const replaceFontToolContract = {
    name: 'illustrator_replace_font',
    title: 'Plan or Replace a Font Throughout a Document',
    description: 'Plan or replace one installed font with another (exact PostScript names; see illustrator_find_fonts) on every character that uses it, or several pairs with `mappings: [{from, to}]` (up to 16, all or nothing; no font both a source and a replacement). Scope is the bound document, or `scope`: artboard_index, layer_path (illustrator_list_layers), selection: true (selected text frames, not text inside groups), or target_uuids. A threaded story changes whole. Point and area text are supported; composite fonts are not. A larger scope is planned in chunks (`remaining`): apply, then plan again with the same scope; with several pairs, narrow `scope` instead. Only the planned characters change font; other text and frames stay unchanged. Frames blocked by lock, hide, path text, overset, size or unreadable stories are listed in `blockedFrames`. When blocked, tell the user the reason and follow next_steps (a script outside this server only for a custom_script refusal).',
    inputSchema,
    publicInputSchema: replaceFontPublicInputSchema,
    outputSchema: replaceFontResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(REPLACE_FONT_SAFETY.policy),
    normalizePublicInput,
};
export function createReplaceFontAdapter() {
    return {
        version: 1, operation: REPLACE_FONT_OPERATION, validator: REPLACE_FONT_VALIDATOR,
        safety: REPLACE_FONT_SAFETY, safetyRegistrationIdentity: REPLACE_FONT_SAFETY_IDENTITY,
        adapterIdentity: REPLACE_FONT_ADAPTER_IDENTITY, tool: replaceFontToolContract,
        admit,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest,
            safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: replaceFontResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: CLASSIFIER_VERSION, safetyConformanceVersion: CONFORMANCE_VERSION,
        errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: REPLACE_FONT_HOST_SCRIPT_DIGEST,
        mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: REPLACE_FONT_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: REPLACE_FONT_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: REPLACE_FONT_OPERATION,
                    documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: REPLACE_FONT_ADAPTER_IDENTITY,
                mutationHostApplicationMode: 'foreground', script: REPLACE_FONT_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = replaceFontResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back')
                return { state };
            if (state === 'planned')
                throw new Error('A font replacement plan is not a terminal mutation result.');
            throw new Error('Unverified font replacement recovery must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error, detail) {
            if (detail?.code === 'FONT_REPLACE_BLOCKED') {
                return new Error(`Replacing the font is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}.`);
            }
            if (detail?.code === 'FONT_REPLACE_USAGE_MISMATCH') {
                return new Error(`The source font usage changed: expected_usage ${JSON.stringify(detail.expected ?? null)} `
                    + `does not match ${JSON.stringify(detail.actual ?? null)}; plan again.`);
            }
            if (detail?.code === 'FONT_REPLACE_STALE') {
                return new Error(`The text using the source font changed since the plan (${detail.field ?? 'state'}); plan again.`);
            }
            if (detail?.code === 'FONT_SCOPE_INVALID') {
                return new Error(`scope.${detail.field ?? 'scope'} is invalid (${detail.reason ?? 'unknown'}): `
                    + 'use an existing artboard index, a layer path from illustrator_list_layers, a selection of text frames, '
                    + 'or UUIDs of existing text frames.');
            }
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
