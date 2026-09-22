import { z } from 'zod';
const CANONICAL_COMMAND_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const CANONICAL_COMMAND_ID_MESSAGE = 'Command ID must be a canonical lowercase UUID v4.';
const QUOTED_VALUE_LIMIT = 64;
function quoted(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
    return JSON.stringify(text.length > QUOTED_VALUE_LIMIT ? `${text.slice(0, QUOTED_VALUE_LIMIT)}…` : text);
}
export const canonicalCommandIdSchema = z.string().regex(CANONICAL_COMMAND_ID_PATTERN, {
    error: (issue) => `Command ID must be a canonical lowercase UUID v4 (xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx, `
        + `lowercase hex), such as the plan's next_call.arguments.command_id or the output of "uuidgen | tr A-Z a-z"; got ${quoted(issue.input)}.`,
});
export const APPLY_COMMAND_ID_GUIDANCE = 'Lowercase UUID v4 for this change, e.g. the plan\'s next_call.arguments.command_id. '
    + 'Resend the same value to retry the same apply (also after a timeout and reconcile); after a new plan, use its new value.';
export const applyCommandIdSchema = canonicalCommandIdSchema.describe(APPLY_COMMAND_ID_GUIDANCE);
export function isCanonicalCommandId(value) {
    return typeof value === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}
