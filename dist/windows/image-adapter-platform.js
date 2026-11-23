import { z } from 'zod';
import { PLACE_IMAGE_MAX_PATH_LENGTH } from '../adapters/place-image-adapter.js';
import { sameWindowsPath, WINDOWS_CURRENT_LINK_REFUSAL_CODES, WINDOWS_IMAGE_FORMATS, WINDOWS_SOURCE_REFUSAL_CODES } from './image-source-admission.js';
export const WINDOWS_IMAGE_ABSOLUTE_PATH_SCHEMA = z.string().min(3).max(PLACE_IMAGE_MAX_PATH_LENGTH)
    .regex(/^[A-Za-z]:\\(?!(?:.*\\)?\.\.(?:\\|$))[^\0]*$/u, 'Path must be an absolute drive-letter path (X:\\...) without NUL or parent-directory segments.');
export const WINDOWS_IMAGE_REQUEST_PATH_SCHEMA = z.string().min(1).max(PLACE_IMAGE_MAX_PATH_LENGTH)
    .regex(/^[^\0]*$/u, 'Path must not contain NUL.');
export const WINDOWS_HOST_PATH_HELPERS = String.raw `
function hostFilePathMatches(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string") return false;
  return actual.replace(/\//g, "\\").toLowerCase() === expected.replace(/\//g, "\\").toLowerCase();
}
`;
export const WINDOWS_IMAGE_HOST_PATH_SCRIPT = Object.freeze({
    pathHelpers: WINDOWS_HOST_PATH_HELPERS,
    sourcePathInvalid: String.raw `!/^[A-Za-z]:\\/.test(source.path)`,
    resolvedPathInvalid: String.raw `!/^[A-Za-z]:\\/.test(admission.resolvedPath)`,
});
export const WINDOWS_PLACE_IMAGE_PLATFORM = Object.freeze({
    id: 'windows',
    requestPathSchema: WINDOWS_IMAGE_REQUEST_PATH_SCHEMA,
    absolutePathSchema: WINDOWS_IMAGE_ABSOLUTE_PATH_SCHEMA,
    formatSchema: z.enum(WINDOWS_IMAGE_FORMATS),
    sourceBlockerSchema: z.enum(WINDOWS_SOURCE_REFUSAL_CODES),
    samePath: sameWindowsPath,
    host: WINDOWS_IMAGE_HOST_PATH_SCRIPT,
});
export const WINDOWS_RELINK_IMAGE_PLATFORM = Object.freeze({
    ...WINDOWS_PLACE_IMAGE_PLATFORM,
    unavailableLinkPath: String.raw `"C:\\unavailable"`,
    currentLinkBlockerSchema: z.enum(WINDOWS_CURRENT_LINK_REFUSAL_CODES),
});
