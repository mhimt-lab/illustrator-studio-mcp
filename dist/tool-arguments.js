import { randomUUID } from 'node:crypto';
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
    illustrator_set_object_state: { expected_before: 'before' },
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
function planHasNoBlockers(plan) {
    const blockers = plan.applyBlockedReasonCodes;
    return Array.isArray(blockers) ? blockers.length === 0 : plan.applyAllowed === true;
}
export function buildNextCall(tool, planArguments, response) {
    const echoes = NEXT_CALL_PLAN_ECHOES[tool.name];
    if (echoes === undefined || planArguments.apply === true || !isRecord(response) || !isRecord(response.outcome))
        return undefined;
    const { outcome } = response;
    if (outcome.applied !== false || !isRecord(outcome.plan) || !planHasNoBlockers(outcome.plan))
        return undefined;
    const { apply: _apply, command_id: _commandId, ...shared } = planArguments;
    const args = { ...shared };
    for (const [argument, field] of Object.entries(echoes)) {
        if (!(field in outcome.plan))
            return undefined;
        args[argument] = outcome.plan[field];
    }
    args.apply = true;
    args.command_id = randomUUID();
    if (!tool.publicInputSchema.safeParse(args).success)
        return undefined;
    return { tool: tool.name, arguments: args, note: NEXT_CALL_NOTE };
}
