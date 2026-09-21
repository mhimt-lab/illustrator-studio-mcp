import { z } from 'zod';
import { cmykResourceColorSchema } from './request.js';
import { canonicalCommandIdSchema } from '../../command-id.js';
import { swatchResourceResponseSchema } from './result-schema.js';
const channelSchema = z.number().int().min(0).max(255);
const publicRgbSchema = z.strictObject({
    model: z.literal('rgb'), red: channelSchema, green: channelSchema, blue: channelSchema,
});
const resourceNameSchema = z.string().min(1).max(31);
const publicResourceSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('process'), name: resourceNameSchema, color: z.union([publicRgbSchema, cmykResourceColorSchema]) }),
    z.strictObject({ kind: z.literal('spot'), name: resourceNameSchema, color: publicRgbSchema }),
    z.strictObject({
        kind: z.literal('gradient'), name: resourceNameSchema, type: z.literal('linear'),
        stops: z.tuple([
            z.strictObject({ ramp_point: z.literal(0), mid_point: z.literal(50), opacity: z.literal(100), color: publicRgbSchema }),
            z.strictObject({ ramp_point: z.literal(100), mid_point: z.literal(50), opacity: z.literal(100), color: publicRgbSchema }),
        ]),
    }),
]);
const common = {
    expected_document_key: z.string().min(1).max(16_384),
    resource: publicResourceSchema,
};
export const createSwatchResourcePublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...common, apply: z.literal(false).default(false) }),
    z.strictObject({ ...common, apply: z.literal(true), command_id: canonicalCommandIdSchema }),
]);
export const createSwatchResourceInputSchema = z.strictObject({
    ...common,
    apply: z.boolean().default(false),
    command_id: canonicalCommandIdSchema.optional(),
});
const { $schema: _dialect, ...published } = z.toJSONSchema(createSwatchResourcePublicInputSchema, { io: 'input' });
createSwatchResourceInputSchema._zod.toJSONSchema = () => ({ type: 'object', ...published });
export function normalizeCreateSwatchResourcePublicInput(input) {
    const params = createSwatchResourcePublicInputSchema.parse(input);
    const resource = params.resource.kind !== 'gradient'
        ? params.resource
        : {
            kind: params.resource.kind,
            name: params.resource.name,
            type: params.resource.type,
            stops: params.resource.stops.map((stop) => ({
                rampPoint: stop.ramp_point,
                midPoint: stop.mid_point,
                opacity: stop.opacity,
                color: stop.color,
            })),
        };
    const commonInput = { expectedDocumentKey: params.expected_document_key, resource };
    return params.apply
        ? { ...commonInput, apply: true, commandId: params.command_id }
        : { ...commonInput, apply: false };
}
export const createSwatchResourceToolContract = {
    name: 'illustrator_create_swatch_resource',
    title: 'Plan or Create Swatch Resource',
    description: 'Plan or create one unreferenced process swatch matching the bound RGB/CMYK document, or an RGB-only linear Gradient or ordinary RGB-base Spot in an RGB document. CMYK process channels use five-decimal canonical percentages. Spot creation is allowed only on measured Illustrator versions (currently 30.8.1) and is otherwise blocked before any host effect. Apply verifies the exact native resource identity and complete resource-collection delta; rollback removes only the captured self-created resource.',
    inputSchema: createSwatchResourceInputSchema,
    publicInputSchema: createSwatchResourcePublicInputSchema,
    outputSchema: swatchResourceResponseSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    normalizePublicInput: normalizeCreateSwatchResourcePublicInput,
};
