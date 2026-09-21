import { z } from 'zod';
import { canonicalCommandIdSchema } from '../../command-id.js';
import { canonicalSha256 } from '../../mutation-canonical.js';
import { CREATE_RECTANGLE_MUTATION_VALIDATOR } from './identity.js';
const canonicalNumberSchema = z.number().finite().transform((value) => Object.is(value, -0) ? 0 : value);
const positiveCanonicalNumberSchema = canonicalNumberSchema.pipe(z.number().positive());
const riskConfirmationSchema = z.strictObject({ reasonCode: z.literal('template_state_unknown'), operation: z.literal('create_rectangle'), expectedLayerPath: z.array(z.number().int().safe().nonnegative()).min(1).max(64), decision: z.literal('proceed_despite_unknown_template_state') });
const fields = { expectedDocumentKey: z.string().min(1).max(16_384), expectedLayerPath: z.array(z.number().int().safe().nonnegative()).min(1).max(64), artboardIndex: z.number().int().safe().nonnegative(), x: canonicalNumberSchema, y: canonicalNumberSchema, width: positiveCanonicalNumberSchema, height: positiveCanonicalNumberSchema, name: z.string().max(255).optional(), templateStateRiskConfirmation: riskConfirmationSchema.optional() };
export const createRectangleMutationRequestSchema = z.strictObject({ commandId: canonicalCommandIdSchema, ...fields, apply: z.literal(true) });
const planningSchema = z.strictObject({ ...fields, apply: z.literal(false) });
function requestFields(request) {
    return { expectedDocumentKey: request.expectedDocumentKey, expectedLayerPath: request.expectedLayerPath, artboardIndex: request.artboardIndex, x: request.x, y: request.y, width: request.width, height: request.height, ...(request.name === undefined ? {} : { name: request.name }), ...(request.templateStateRiskConfirmation === undefined ? {} : { templateStateRiskConfirmation: request.templateStateRiskConfirmation }), apply: request.apply };
}
function digest(request) {
    return canonicalSha256({ operation: 'create_rectangle', validator: CREATE_RECTANGLE_MUTATION_VALIDATOR, request: requestFields(request) });
}
export function normalizeCreateRectangleRequest(input) {
    if (typeof input === 'object' && input !== null && 'apply' in input && input.apply === true) {
        const request = createRectangleMutationRequestSchema.parse(input);
        return {
            intent: 'apply',
            request,
            commandId: request.commandId,
            documentKey: request.expectedDocumentKey,
            digest: digest(request),
        };
    }
    const request = planningSchema.parse(input);
    return {
        intent: 'plan',
        request,
        commandId: null,
        documentKey: request.expectedDocumentKey,
        digest: digest(request),
    };
}
export function createRectangleRequestDigest(input) {
    const normalized = normalizeCreateRectangleRequest(input);
    if (normalized.intent !== 'apply')
        throw new Error('A mutation request digest requires apply intent.');
    return { request: normalized.request, digest: normalized.digest };
}
export function createRectangleSafetyRequestDigest(input) {
    return normalizeCreateRectangleRequest(input).digest;
}
