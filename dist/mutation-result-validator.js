import { createHash } from 'node:crypto';
export { CREATE_RECTANGLE_MUTATION_VALIDATOR } from './adapters/create-rectangle/identity.js';
export function parseCompletedResultEnvelope(rawResult, expectedCommandId) {
    let parsed;
    try {
        parsed = JSON.parse(rawResult);
    }
    catch (_error) {
        throw new Error('Illustrator command result is not valid JSON.');
    }
    if (typeof parsed !== 'object' || parsed === null ||
        parsed.commandId !== expectedCommandId ||
        parsed.state !== 'completed' || !('data' in parsed)) {
        throw new Error('Illustrator completed result envelope is structurally invalid.');
    }
    return parsed;
}
export function validateMutationResult(registry, operation, ref, adapterIdentity, value) {
    return registry.resolveIdentity(operation, ref, adapterIdentity).resultSchema.parse(value);
}
function classifyValidatedMutationResult(registry, context, value) {
    if (context.intent !== 'apply') {
        throw new Error('Mutation result artifact context does not identify the matching apply operation.');
    }
    return registry.resolveIdentity(context.operation, context.validator, context.adapterIdentity).classifyTerminal(value);
}
export function resultArtifactDigest(rawResult) {
    return createHash('sha256').update(rawResult).digest('hex');
}
export function validateMutationResultArtifact(registry, context, rawResult) {
    const envelope = parseCompletedResultEnvelope(typeof rawResult === 'string' ? rawResult : rawResult.toString('utf8'), context.commandId);
    const data = validateMutationResult(registry, context.operation, context.validator, context.adapterIdentity, envelope.data);
    return {
        envelope,
        data,
        classification: classifyValidatedMutationResult(registry, context, data),
        digest: resultArtifactDigest(rawResult),
    };
}
