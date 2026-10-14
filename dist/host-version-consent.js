import { z } from 'zod';
import { deleteBackupFactsSchema } from './delete-shared.js';
export const HOST_VERSION_SCOPE_NOTE = 'Unmeasured stable versions are admitted and reported as host_version; a saved file on one needs backup_id.';
export const hostVersionPublicFields = {
    accept_unmeasured_host_version: z.string().max(64).optional(),
    backup_id: z.uuid().optional(),
};
export const hostVersionInternalFields = {
    backupId: z.uuid().optional(),
    hostVersionBackup: deleteBackupFactsSchema.optional(),
    hostVersionChannel: z.enum(['stable', 'beta', 'unknown']).optional(),
};
export function normalizeHostVersionConsent(input) {
    return input.backup_id === undefined ? {} : { backupId: input.backup_id };
}
export function hostVersionRequestFields(input) {
    return Object.fromEntries(Object.keys(hostVersionInternalFields).filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
}
