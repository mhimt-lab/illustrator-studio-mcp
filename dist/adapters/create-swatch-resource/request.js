import { z } from 'zod';
import { canonicalCommandIdSchema } from '../../command-id.js';
import { canonicalSha256 } from '../../mutation-canonical.js';
import { CREATE_SWATCH_RESOURCE_MUTATION_VALIDATOR } from './identity.js';
const channelSchema = z.number().int().min(0).max(255);
const rgbSchema = z.strictObject({
    model: z.literal('rgb'), red: channelSchema, green: channelSchema, blue: channelSchema,
});
const percentSchema = z.number().finite().min(0).max(100).overwrite((value) => Math.round(value * 100000) / 100000);
export const cmykResourceColorSchema = z.strictObject({
    model: z.literal('cmyk'), cyan: percentSchema, magenta: percentSchema, yellow: percentSchema, black: percentSchema,
});
const resourceNameSchema = z.string().min(1).max(31);
const processSchema = z.strictObject({
    kind: z.literal('process'), name: resourceNameSchema, color: z.union([rgbSchema, cmykResourceColorSchema]),
});
const gradientSchema = z.strictObject({
    kind: z.literal('gradient'), name: resourceNameSchema, type: z.literal('linear'),
    stops: z.tuple([
        z.strictObject({ rampPoint: z.literal(0), midPoint: z.literal(50), opacity: z.literal(100), color: rgbSchema }),
        z.strictObject({ rampPoint: z.literal(100), midPoint: z.literal(50), opacity: z.literal(100), color: rgbSchema }),
    ]),
});
const spotSchema = z.strictObject({
    kind: z.literal('spot'), name: resourceNameSchema, color: rgbSchema,
});
export const swatchResourceDefinitionSchema = z.discriminatedUnion('kind', [processSchema, gradientSchema, spotSchema]);
const fields = {
    expectedDocumentKey: z.string().min(1).max(16_384),
    resource: swatchResourceDefinitionSchema,
};
export const createSwatchResourceMutationRequestSchema = z.strictObject({
    commandId: canonicalCommandIdSchema,
    ...fields,
    apply: z.literal(true),
});
const planningSchema = z.strictObject({ ...fields, apply: z.literal(false) });
function digest(request) {
    return canonicalSha256({
        operation: 'create_swatch_resource',
        validator: CREATE_SWATCH_RESOURCE_MUTATION_VALIDATOR,
        request: {
            expectedDocumentKey: request.expectedDocumentKey,
            resource: request.resource,
            apply: request.apply,
        },
    });
}
export function normalizeCreateSwatchResourceRequest(input) {
    if (typeof input === 'object' && input !== null && 'apply' in input && input.apply === true) {
        const request = createSwatchResourceMutationRequestSchema.parse(input);
        return { intent: 'apply', request, commandId: request.commandId,
            documentKey: request.expectedDocumentKey, digest: digest(request) };
    }
    const request = planningSchema.parse(input);
    return { intent: 'plan', request, commandId: null,
        documentKey: request.expectedDocumentKey, digest: digest(request) };
}
export function createSwatchResourceRequestDigest(input) {
    const normalized = normalizeCreateSwatchResourceRequest(input);
    if (normalized.intent !== 'apply')
        throw new Error('A mutation request digest requires apply intent.');
    return { request: normalized.request, digest: normalized.digest };
}
export function createSwatchResourceSafetyRequestDigest(input) {
    return normalizeCreateSwatchResourceRequest(input).digest;
}
