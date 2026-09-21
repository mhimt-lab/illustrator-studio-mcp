import { createHash } from 'node:crypto';
export const DOCUMENT_KEY_SHORT_HEX_LENGTH = 16;
export const DOCUMENT_KEY_SHORT_PATTERN = /^[0-9a-f]{16}$/;
export function shortDocumentKey(fullKey) {
    return createHash('sha256').update(fullKey, 'utf8').digest('hex').slice(0, DOCUMENT_KEY_SHORT_HEX_LENGTH);
}
export function isShortDocumentKey(key) {
    return DOCUMENT_KEY_SHORT_PATTERN.test(key);
}
export function documentKeyMatches(expected, actualFullKey) {
    if (expected === actualFullKey)
        return true;
    return isShortDocumentKey(expected) && shortDocumentKey(actualFullKey) === expected;
}
