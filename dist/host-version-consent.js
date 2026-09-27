import { z } from 'zod';
import { HOST_VERSION_PATTERN } from './host-version-policy.js';
import { deleteBackupFactsSchema } from './delete-shared.js';
export const HOST_VERSION_CONSENT_DESCRIPTION = 'For an unmeasured stable version, ask the user first; never decide consent for them. Pass their accepted exact host version to plan and apply. File-backed changes also require backup_id.';
export const hostVersionPublicFields = {
    accept_unmeasured_host_version: z.string().max(64).regex(HOST_VERSION_PATTERN).optional(),
    backup_id: z.uuid().optional(),
};
export const hostVersionInternalFields = {
    acceptUnmeasuredHostVersion: z.string().max(64).regex(HOST_VERSION_PATTERN).optional(),
    backupId: z.uuid().optional(),
    hostVersionChannel: z.enum(['stable', 'beta', 'unknown']).optional(),
    hostVersionBackup: deleteBackupFactsSchema.optional(),
};
export const hostVersionConsentSchema = z.strictObject({
    acceptUnmeasuredHostVersion: z.string().max(64).regex(HOST_VERSION_PATTERN),
    hostVersionChannel: z.enum(['stable', 'beta', 'unknown']),
}).optional();
export function normalizeHostVersionConsent(input) {
    return {
        ...(input.accept_unmeasured_host_version === undefined ? {} : { acceptUnmeasuredHostVersion: input.accept_unmeasured_host_version }),
        ...(input.backup_id === undefined ? {} : { backupId: input.backup_id }),
    };
}
export function hostVersionRequestFields(input) {
    return Object.fromEntries(Object.keys(hostVersionInternalFields).filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
}
