import { z } from 'zod';
import { applyCommandIdSchema } from '../../command-id.js';
import { layerPathSchema } from '../../mutation-result-schema-core.js';
import { rectangleResponseSchema } from './result-schema.js';
import { creationAppearanceSchema } from '../create-appearance.js';
const confirmationSchema = z.strictObject({
    reason_code: z.literal('template_state_unknown'),
    operation: z.literal('create_rectangle'),
    expected_layer_path: layerPathSchema,
    decision: z.literal('proceed_despite_unknown_template_state'),
});
const common = {
    expected_document_key: z.string().min(1).max(16_384), expected_layer_path: layerPathSchema,
    artboard_index: z.number().int().safe().nonnegative(), x: z.number().finite(), y: z.number().finite(),
    width: z.number().positive().finite(), height: z.number().positive().finite(), name: z.string().max(255).optional(),
    template_state_risk_confirmation: confirmationSchema.optional()
        .describe('Optional. Template state is assumed non_template by default; when supplied it must match exactly or apply is blocked.'),
    appearance: creationAppearanceSchema.optional(),
};
export const createRectanglePublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...common, apply: z.literal(false).default(false) }),
    z.strictObject({ ...common, apply: z.literal(true), command_id: applyCommandIdSchema }),
]);
export const createRectangleInputSchema = z.strictObject({ ...common, apply: z.boolean().default(false), command_id: applyCommandIdSchema.optional() });
const { $schema: _dialect, ...published } = z.toJSONSchema(createRectanglePublicInputSchema, { io: 'input' });
createRectangleInputSchema._zod.toJSONSchema = () => ({ type: 'object', ...published });
export function normalizeCreateRectanglePublicInput(input) {
    const params = createRectanglePublicInputSchema.parse(input);
    const commonInput = {
        expectedDocumentKey: params.expected_document_key, expectedLayerPath: params.expected_layer_path,
        artboardIndex: params.artboard_index, x: params.x, y: params.y, width: params.width, height: params.height,
        ...(params.name === undefined ? {} : { name: params.name }),
        ...(params.template_state_risk_confirmation === undefined ? {} : { templateStateRiskConfirmation: {
                reasonCode: params.template_state_risk_confirmation.reason_code,
                operation: params.template_state_risk_confirmation.operation,
                expectedLayerPath: params.template_state_risk_confirmation.expected_layer_path,
                decision: params.template_state_risk_confirmation.decision,
            } }),
        ...(params.appearance === undefined ? {} : { appearance: params.appearance }),
    };
    return params.apply ? { ...commonInput, apply: true, commandId: params.command_id } : { ...commonInput, apply: false };
}
export const createRectangleToolContract = {
    name: 'illustrator_create_rectangle', title: 'Plan or Create Rectangle',
    description: 'Run a plan-first mutation transaction for an explicit layer path. Apply revalidates in the same JSX call, verifies by native UUID, and rolls back only its own created object. Optional appearance (opacity, fill, stroke) is set and read back in the same apply. expected_document_key accepts the full key or keyShort; unsaved documents are mutable (mutationProfile unsaved_document).',
    inputSchema: createRectangleInputSchema, publicInputSchema: createRectanglePublicInputSchema,
    outputSchema: rectangleResponseSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    normalizePublicInput: normalizeCreateRectanglePublicInput,
};
