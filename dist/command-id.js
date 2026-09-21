import { z } from 'zod';
const CANONICAL_COMMAND_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const CANONICAL_COMMAND_ID_MESSAGE = 'Command ID must be a canonical lowercase UUID v4.';
export const canonicalCommandIdSchema = z.string().regex(CANONICAL_COMMAND_ID_PATTERN, CANONICAL_COMMAND_ID_MESSAGE);
export function isCanonicalCommandId(value) {
    return typeof value === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}
