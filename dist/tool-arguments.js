import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
function editDistance(left, right) {
    let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let row = 1; row <= left.length; row += 1) {
        const current = [row];
        for (let column = 1; column <= right.length; column += 1) {
            current[column] = Math.min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1));
        }
        previous = current;
    }
    return previous[right.length];
}
export function suggestArgumentName(unknown, known) {
    const lower = unknown.toLowerCase();
    const prefixed = known.find((name) => name === `expected_${lower}` || name === `confirmed_${lower}`);
    if (prefixed !== undefined)
        return prefixed;
    let best;
    for (const name of known) {
        const distance = editDistance(lower, name);
        if (distance <= 2 && (best === undefined || distance < best.distance))
            best = { name, distance };
    }
    return best?.name;
}
export const toolArgumentIssueMessage = (raw) => {
    const issue = raw;
    if (issue.code === 'unrecognized_keys' && issue.keys !== undefined) {
        const known = Object.keys(issue.inst?._zod?.def?.shape ?? {});
        const names = issue.keys.map((key) => {
            const suggestion = suggestArgumentName(key, known);
            return suggestion === undefined ? JSON.stringify(key) : `${JSON.stringify(key)} (did you mean ${JSON.stringify(suggestion)}?)`;
        });
        return `Unknown argument${names.length === 1 ? '' : 's'} ${names.join(', ')}.`;
    }
    if (issue.code === 'invalid_type' && issue.input === undefined) {
        if (issue.path?.at(-1) === 'command_id') {
            return 'Missing required argument: a lowercase UUID v4 for this apply, such as the plan\'s next_call.arguments.command_id.';
        }
        return 'Missing required argument.';
    }
    return undefined;
};
export function formatToolArgumentError(toolName, issues) {
    const formatted = issues.map((issue) => (issue.path === undefined || issue.path.length === 0
        ? issue.message
        : `${issue.path.map(String).join('.')}: ${issue.message}`));
    return `Input validation error: Invalid arguments for tool ${toolName}: ${formatted.join(', ')}`;
}
export const NEXT_CALL_PLAN_ECHOES = Object.freeze({
    illustrator_create_rectangle: {},
    illustrator_create_swatch_resource: {},
    illustrator_create_point_text: {},
    illustrator_create_area_text: {},
    illustrator_create_character_style: {},
    illustrator_create_batch: {},
    illustrator_create_shape: {},
    illustrator_place_image: {},
    illustrator_set_path_appearance: { expected_before: 'before', confirmed_after: 'after' },
    illustrator_transform_object: { expected_before: 'before', confirmed_after: 'after' },
    illustrator_replace_point_text: { expected_before: 'before', confirmed_after: 'after' },
    illustrator_replace_text_range: { expected_before: 'before', confirmed_after: 'after' },
    illustrator_set_text_style: { expected_before: 'before', confirmed_after: 'after' },
    illustrator_set_text_orientation: { expected_before: 'before', confirmed_after: 'after' },
    illustrator_set_no_break: { expected_before: 'before', confirmed_after: 'after' },
    illustrator_relink_image: { expected_before: 'before', confirmed_after: 'after' },
    illustrator_set_area_text_columns: { expected_before: 'before', confirmed_after: 'after' },
    illustrator_update_artboard: { expected_before: 'before', confirmed_after: 'after' },
    illustrator_set_object_state: { expected_before: 'before' },
    illustrator_duplicate_object: { expected_before: 'sourceBefore', expected_parent_order: 'parentOrderBefore' },
    illustrator_group_objects: { expected_targets_before: 'targetsBefore', expected_parent_order: 'parentOrderBefore' },
    illustrator_set_stacking_order: { expected_targets_before: 'targetsBefore', expected_parent_order: 'parentOrderBefore' },
    illustrator_make_compound_path: { expected_sources_before: 'sourcesBefore', expected_parent_order: 'parentOrderBefore' },
    illustrator_apply_pathfinder: { expected_sources_before: 'sourcesBefore', expected_parent_order: 'parentOrderBefore' },
    illustrator_release_clipping_mask: { expected_group_before: 'groupBefore', expected_parent_order: 'parentOrderBefore' },
    illustrator_create_clipping_mask: { expected_mask_before: 'maskBefore', expected_content_before: 'contentBefore', expected_parent_order: 'parentOrderBefore' },
    illustrator_create_layer: { expected_container_before: 'containerBefore', expected_sibling_order: 'siblingOrderBefore' },
    illustrator_set_layer_state: { expected_before: 'targetBefore', expected_sibling_order: 'siblingOrderBefore' },
    illustrator_reorder_layer: { expected_before: 'targetBefore', expected_sibling_order: 'siblingOrderBefore' },
    illustrator_move_object_to_layer: { expected_before: 'before', expected_after: 'after', expected_source_order: 'sourceOrderBefore', expected_destination_order: 'destinationOrderBefore' },
    illustrator_apply_character_style: { expected_before: 'before', expected_style: 'style', confirmed_after: 'after' },
    illustrator_embed_image: { expected_before: 'before', confirmed_after: 'after' },
    illustrator_delete_objects: { confirm_target_set_hash: 'targetSetHash', confirm_removed_count: 'removedCount' },
});
function copyEchoes(echoes) {
    return (input, plan) => {
        const args = { ...input };
        for (const [argument, field] of Object.entries(echoes)) {
            if (!(field in plan))
                return undefined;
            args[argument] = plan[field];
        }
        return args;
    };
}
function batchTargets(input, plan, field, matches) {
    const requests = input[field];
    const targets = plan[field];
    if (!Array.isArray(requests) || !Array.isArray(targets) || requests.length !== targets.length)
        return undefined;
    const byUuid = new Map();
    for (const target of targets) {
        if (!isRecord(target) || typeof target.targetUuid !== 'string' || byUuid.has(target.targetUuid))
            return undefined;
        byUuid.set(target.targetUuid, target);
    }
    const mapped = [];
    for (const request of requests) {
        if (!isRecord(request) || typeof request.target_uuid !== 'string')
            return undefined;
        const target = byUuid.get(request.target_uuid);
        if (target === undefined || !matches(request, target))
            return undefined;
        const snapshot = field === 'steps' ? target.plan : target;
        if (!isRecord(snapshot) || !('before' in snapshot) || !('after' in snapshot))
            return undefined;
        if (isRecord(snapshot.before) && 'uuid' in snapshot.before && snapshot.before.uuid !== request.target_uuid)
            return undefined;
        if (isRecord(snapshot.after) && 'uuid' in snapshot.after && snapshot.after.uuid !== request.target_uuid)
            return undefined;
        mapped.push({ ...request, expected_before: snapshot.before, confirmed_after: snapshot.after });
        byUuid.delete(request.target_uuid);
    }
    return { ...input, [field]: mapped };
}
function mixedStepMatches(request, target) {
    if (request.operation !== target.operation || !isRecord(target.plan))
        return false;
    const plan = target.plan;
    if (request.operation === 'replace_point_text')
        return request.replacement === plan.replacement;
    if (request.operation === 'set_text_style' && isRecord(request.style)) {
        const style = 'fill_color' in request.style && isRecord(request.style.fill_color)
            ? { fillColor: { model: 'rgb', ...request.style.fill_color } } : { size: request.style.size };
        return request.start === plan.start && request.end === plan.end && isDeepStrictEqual(style, plan.style);
    }
    if (request.operation === 'transform_object' && isRecord(request.transform)) {
        return isDeepStrictEqual({ type: request.transform.type, deltaX: request.transform.delta_x, deltaY: request.transform.delta_y }, plan.transform);
    }
    if (request.operation === 'set_path_appearance' && isRecord(request.appearance) && isRecord(plan.after)) {
        const { fill, stroke, opacity } = plan.after;
        if (!isRecord(fill) || !isRecord(stroke))
            return false;
        return plan.targetUuid === request.target_uuid && isDeepStrictEqual(request.appearance, {
            opacity,
            fill: fill.kind === 'none' ? { kind: 'none' } : fill,
            stroke: stroke.kind === 'none' ? { kind: 'none' } : stroke,
        });
    }
    return false;
}
export const NEXT_CALL_BUILDERS = Object.freeze({
    ...Object.fromEntries(Object.entries(NEXT_CALL_PLAN_ECHOES).map(([tool, echoes]) => [tool, copyEchoes(echoes)])),
    illustrator_update_character_style: (input, plan) => {
        if (!isRecord(plan.usage) || plan.usage.complete !== true)
            return undefined;
        return { ...input, expected_style: plan.style, expected_collections: plan.collections,
            expected_usage: { characters: plan.usage.characters, frames: plan.usage.frames } };
    },
    illustrator_replace_font: (input, plan) => {
        if (!isRecord(plan.usage) || plan.usage.complete !== true || !Array.isArray(plan.usage.frameList))
            return undefined;
        const targets = [];
        for (const frame of plan.usage.frameList) {
            if (!isRecord(frame))
                return undefined;
            targets.push({ uuid: frame.uuid, ranges: frame.ranges });
        }
        return { ...input, expected_usage: { characters: plan.usage.characters, frames: plan.usage.frames }, expected_targets: targets };
    },
    illustrator_edit_path_points: (input, plan) => isRecord(plan.after)
        ? { ...input, confirmed_after: plan.after.path } : undefined,
    illustrator_import_vector_artwork: (input, plan) => isRecord(plan.layer)
        ? { ...input, expected_layer_item_uuids: plan.layer.itemUuids } : undefined,
    illustrator_replace_point_text_batch: (input, plan) => batchTargets(input, plan, 'targets', (request, target) => request.replacement === target.replacement),
    illustrator_mutate_batch: (input, plan) => batchTargets(input, plan, 'steps', mixedStepMatches),
    illustrator_align_objects: (input, plan) => {
        if (!isRecord(input.layout))
            return undefined;
        const { artboard_index: artboardIndex, ...layout } = input.layout;
        if (!isDeepStrictEqual({ ...layout, ...(artboardIndex === undefined ? {} : { artboardIndex }) }, plan.layout))
            return undefined;
        return batchTargets(input, plan, 'targets', () => true);
    },
});
export const NEXT_CALL_NOTE = 'To apply this plan, call the tool with these arguments unchanged. command_id is a fresh '
    + 'candidate: resend the same command_id to retry this same apply (also after a timeout and illustrator_reconcile); '
    + 'if you plan again, use that plan\'s next_call instead.';
export const nextCallSchema = z.strictObject({
    tool: z.string().min(1),
    arguments: z.record(z.string(), z.unknown()),
    note: z.string(),
});
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export const NEXT_CALL_PLANS_WITHOUT_BLOCKER_LIST = new Set(['illustrator_set_path_appearance']);
function planHasNoBlockers(toolName, outcome) {
    const plan = outcome.plan;
    const blockers = plan.applyBlockedReasonCodes ?? (plan.operation === 'delete_objects' ? plan.blockers : undefined);
    if (Array.isArray(blockers))
        return blockers.length === 0;
    if (NEXT_CALL_PLANS_WITHOUT_BLOCKER_LIST.has(toolName))
        return isRecord(outcome.document) && outcome.document.mutationAllowed === true;
    return plan.applyAllowed === true;
}
export function buildNextCall(tool, planArguments, response) {
    const builder = NEXT_CALL_BUILDERS[tool.name];
    if (builder === undefined || planArguments.apply === true || !isRecord(response) || !isRecord(response.outcome))
        return undefined;
    const { outcome } = response;
    if (outcome.applied !== false || !isRecord(outcome.plan) || !planHasNoBlockers(tool.name, outcome))
        return undefined;
    const { apply: _apply, command_id: _commandId, ...shared } = planArguments;
    const args = builder(shared, outcome.plan);
    if (args === undefined)
        return undefined;
    args.apply = true;
    args.command_id = randomUUID();
    if (!tool.publicInputSchema.safeParse(args).success)
        return undefined;
    return { tool: tool.name, arguments: args, note: NEXT_CALL_NOTE };
}
