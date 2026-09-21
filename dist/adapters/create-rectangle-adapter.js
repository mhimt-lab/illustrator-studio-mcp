import { createRectangleRequestDigest, createRectangleSafetyRequestDigest, normalizeCreateRectangleRequest } from './create-rectangle/request.js';
import { CREATE_RECTANGLE_MUTATION_VALIDATOR } from './create-rectangle/identity.js';
import { assertRectangleSafetyConformance, CREATE_RECTANGLE_OPERATION_SAFETY, CREATE_RECTANGLE_OPERATION_SAFETY_IDENTITY, } from './create-rectangle/safety.js';
import { mutationAdapterIdentity } from '../mutation-operation-adapter.js';
import { rectangleResultSchema } from './create-rectangle/result-schema.js';
import { CREATE_RECTANGLE_SCRIPT } from './create-rectangle/jsx.js';
import { createRectangleToolContract } from './create-rectangle/public.js';
import { RectangleTargetError } from './create-rectangle/domain.js';
import { canonicalSha256 } from '../mutation-canonical.js';
const CREATE_RECTANGLE_CANONICAL_CONTRACT_VERSION = 1;
const CREATE_RECTANGLE_RESULT_SCHEMA_VERSION = 3;
const CREATE_RECTANGLE_TERMINAL_CLASSIFIER_VERSION = 1;
const CREATE_RECTANGLE_SAFETY_CONFORMANCE_VERSION = 3;
const CREATE_RECTANGLE_ERROR_MAPPING_VERSION = 1;
export const CREATE_RECTANGLE_HOST_SCRIPT_DIGEST = canonicalSha256(CREATE_RECTANGLE_SCRIPT);
export const CREATE_RECTANGLE_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2,
    contractVersion: 1,
    operation: 'create_rectangle',
    validator: CREATE_RECTANGLE_MUTATION_VALIDATOR,
    canonicalContractVersion: CREATE_RECTANGLE_CANONICAL_CONTRACT_VERSION,
    resultSchemaVersion: CREATE_RECTANGLE_RESULT_SCHEMA_VERSION,
    terminalClassifierVersion: CREATE_RECTANGLE_TERMINAL_CLASSIFIER_VERSION,
    safetyConformanceVersion: CREATE_RECTANGLE_SAFETY_CONFORMANCE_VERSION,
    errorMappingVersion: CREATE_RECTANGLE_ERROR_MAPPING_VERSION,
    safetyIdentity: CREATE_RECTANGLE_OPERATION_SAFETY_IDENTITY,
    hostScriptDigest: CREATE_RECTANGLE_HOST_SCRIPT_DIGEST,
});
export function createRectangleAdapter() {
    return {
        version: 1,
        operation: 'create_rectangle',
        validator: CREATE_RECTANGLE_MUTATION_VALIDATOR,
        safety: CREATE_RECTANGLE_OPERATION_SAFETY,
        safetyRegistrationIdentity: CREATE_RECTANGLE_OPERATION_SAFETY_IDENTITY,
        adapterIdentity: CREATE_RECTANGLE_ADAPTER_IDENTITY,
        tool: createRectangleToolContract,
        canonical: {
            version: CREATE_RECTANGLE_CANONICAL_CONTRACT_VERSION,
            normalize: normalizeCreateRectangleRequest,
            safetyDigest: createRectangleSafetyRequestDigest,
        },
        resultSchema: rectangleResultSchema,
        resultSchemaVersion: CREATE_RECTANGLE_RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: CREATE_RECTANGLE_TERMINAL_CLASSIFIER_VERSION,
        safetyConformanceVersion: CREATE_RECTANGLE_SAFETY_CONFORMANCE_VERSION,
        errorMappingVersion: CREATE_RECTANGLE_ERROR_MAPPING_VERSION,
        hostScriptDigest: CREATE_RECTANGLE_HOST_SCRIPT_DIGEST,
        buildCommand: (input) => {
            const value = input;
            if (!value.apply)
                return { kind: 'read', script: CREATE_RECTANGLE_SCRIPT, params: input };
            const { request, digest } = createRectangleRequestDigest(input);
            const { commandId, ...params } = request;
            return { kind: 'mutation', mutationValidator: CREATE_RECTANGLE_MUTATION_VALIDATOR,
                idempotency: { commandId, operation: 'create_rectangle', documentKey: request.expectedDocumentKey, requestDigest: digest },
                adapterIdentity: CREATE_RECTANGLE_ADAPTER_IDENTITY,
                script: CREATE_RECTANGLE_SCRIPT, params };
        },
        classifyTerminal: (value) => {
            const state = rectangleResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back' || state === 'rollback_failed')
                return { state };
            if (state === 'planned')
                throw new Error('An apply mutation result artifact cannot have transaction state planned.');
            throw new Error('Indeterminate mutation results cannot be compacted as terminal state.');
        },
        assertSafetyConformance: (value, digest, attestation, resolver) => assertRectangleSafetyConformance(rectangleResultSchema.parse(value), digest, attestation, resolver),
        mapExecutionError: (error, detail) => {
            if (detail?.code?.startsWith('LAYER_') || detail?.code === 'RECTANGLE_APPLY_BLOCKED') {
                return new RectangleTargetError(detail.code, detail.reasonCodes ?? [], error instanceof Error ? error.message : String(error));
            }
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
