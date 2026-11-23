import { z } from 'zod';
import { applyCommandIdSchema } from './command-id.js';
import { pdfExportResultSchema } from './pdf-export.js';
import { exportOutlinedResultSchema, exportRecordSchema, exportStageSchema } from './document-export.js';
import { documentContextSchema } from './mutation-result-schema-core.js';
import { hostVersionNoteSchema } from './host-version-admission.js';
import { expectedOutputSchema, replacementSummarySchema } from './output-replacement.js';
export const workCopyOverwriteFields = { overwrite: z.boolean().optional(), expected_output: expectedOutputSchema.optional(), command_id: applyCommandIdSchema.optional() };
export const workCopyOverwriteRejectionSchema = z.enum([
    ...pdfExportResultSchema.options[2].shape.reason.options, 'output_changed_since_plan', 'output_previous_unsafe', 'output_previous_size_unmeasured',
    'output_changed', 'replacement_unresolved', 'replacement_terminal_invalid', 'overwrite_not_supported_on_platform', 'host_not_foreground', 'host_screen_locked',
    'host_profile_unknown', 'host_version_unmeasured', 'command_id_conflict', 'export_records_invalid',
]);
const timing = z.strictObject({ totalMs: z.number().nonnegative(), hostMs: z.number().nonnegative(), archiveMs: z.number().nonnegative(), recordMs: z.number().nonnegative(), recordCount: z.number().int().nonnegative(), recordFsyncCount: z.number().int().nonnegative() });
const extra = { copyObservation: z.strictObject({ path: z.string(), key: z.string(), saved: z.boolean(), matchesMeasuredProfile: z.boolean() }).optional(), timing: timing.optional(), exportId: z.uuid(), delivery: z.enum(['original', 'replay']), replacement: replacementSummarySchema };
export const outlinedOverwriteRecordSchema = exportRecordSchema.extend({ version: z.literal(6) });
export const workCopyOverwriteResultSchema = z.union([
    pdfExportResultSchema.options[0].extend({ plan: pdfExportResultSchema.options[0].shape.plan.extend({ expectedOutput: expectedOutputSchema }), host_version: hostVersionNoteSchema.optional() }),
    z.strictObject({ outcome: z.literal('planned'), document: documentContextSchema, plan: z.strictObject({ format: z.enum(['ai', 'pdf']), pdfPreset: z.string().nullable(), outputPath: z.string(), planDigest: z.string(), expectedOutput: expectedOutputSchema }), host_version: hostVersionNoteSchema.optional(), nextCall: z.record(z.string(), z.unknown()), hostCalls: z.number().int().nonnegative(), durationMs: z.number().nonnegative() }),
    pdfExportResultSchema.options[1].extend(extra),
    exportOutlinedResultSchema.options[0].extend({ ...extra, record: outlinedOverwriteRecordSchema }),
    z.strictObject({ outcome: z.literal('rejected'), reason: workCopyOverwriteRejectionSchema, message: z.string(), document: documentContextSchema.nullable(), availablePresets: z.array(z.string()).nullable() }),
    z.strictObject({ outcome: z.literal('failed'), ...extra, stage: z.string(), reason: z.string(), message: z.string(), files: z.strictObject({ workCopyPath: z.string().nullable(), stagedPath: z.string().nullable(), outputPath: z.string().nullable() }) }),
    z.strictObject({ outcome: z.literal('indeterminate'), stage: exportStageSchema, message: z.string(), commandId: z.string().nullable(), sessionId: z.string().nullable(), files: z.strictObject({ workCopyPath: z.string().nullable(), stagedPath: z.string().nullable(), outputPath: z.string().nullable() }) }),
]);
export const workCopyPdfResultSchema = z.union([workCopyOverwriteResultSchema.options[0], workCopyOverwriteResultSchema.options[2], ...workCopyOverwriteResultSchema.options.slice(4)]);
export const workCopyOutlinedResultSchema = z.union([workCopyOverwriteResultSchema.options[1], workCopyOverwriteResultSchema.options[3], ...workCopyOverwriteResultSchema.options.slice(4)]);
export function validateWorkCopyOverwriteInput(input) {
    if (input.overwrite !== true) {
        if (input.expectedOutput !== undefined || input.commandId !== undefined)
            throw new Error('Overwrite confirmation fields require overwrite=true.');
        return;
    }
    if (!input.apply) {
        if (input.expectedOutput !== undefined || input.expectedPlanDigest !== undefined || input.commandId !== undefined)
            throw new Error('Overwrite plans do not accept apply confirmation fields.');
    }
    else if (input.expectedOutput === undefined || input.expectedPlanDigest === undefined || input.commandId === undefined) {
        throw new Error('Overwrite apply requires expected_output, expected_plan_digest and command_id from nextCall.');
    }
    if (input.commandId !== undefined)
        applyCommandIdSchema.parse(input.commandId);
    if (input.expectedOutput !== undefined)
        expectedOutputSchema.parse(input.expectedOutput);
}
