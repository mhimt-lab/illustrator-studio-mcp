import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity } from '../mutation-operation-adapter.js';
import { CREATE_SWATCH_RESOURCE_SCRIPT } from './create-swatch-resource/jsx.js';
import { CREATE_SWATCH_RESOURCE_MUTATION_VALIDATOR } from './create-swatch-resource/identity.js';
import { createSwatchResourceRequestDigest, createSwatchResourceSafetyRequestDigest, normalizeCreateSwatchResourceRequest, } from './create-swatch-resource/request.js';
import { createSwatchResourceToolContract } from './create-swatch-resource/public.js';
import { swatchResourceResultSchema } from './create-swatch-resource/result-schema.js';
import { assertSwatchResourceSafetyConformance, CREATE_SWATCH_RESOURCE_OPERATION_SAFETY, CREATE_SWATCH_RESOURCE_OPERATION_SAFETY_IDENTITY, } from './create-swatch-resource/safety.js';
const CANONICAL_CONTRACT_VERSION = 2;
const RESULT_SCHEMA_VERSION = 2;
const TERMINAL_CLASSIFIER_VERSION = 1;
const SAFETY_CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
export const CREATE_SWATCH_RESOURCE_HOST_SCRIPT_DIGEST = canonicalSha256(CREATE_SWATCH_RESOURCE_SCRIPT);
export const CREATE_SWATCH_RESOURCE_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2,
    contractVersion: 1,
    operation: 'create_swatch_resource',
    validator: CREATE_SWATCH_RESOURCE_MUTATION_VALIDATOR,
    canonicalContractVersion: CANONICAL_CONTRACT_VERSION,
    resultSchemaVersion: RESULT_SCHEMA_VERSION,
    terminalClassifierVersion: TERMINAL_CLASSIFIER_VERSION,
    safetyConformanceVersion: SAFETY_CONFORMANCE_VERSION,
    errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: CREATE_SWATCH_RESOURCE_OPERATION_SAFETY_IDENTITY,
    hostScriptDigest: CREATE_SWATCH_RESOURCE_HOST_SCRIPT_DIGEST,
});
export function createSwatchResourceAdapter() {
    return {
        version: 1,
        operation: 'create_swatch_resource',
        validator: CREATE_SWATCH_RESOURCE_MUTATION_VALIDATOR,
        safety: CREATE_SWATCH_RESOURCE_OPERATION_SAFETY,
        safetyRegistrationIdentity: CREATE_SWATCH_RESOURCE_OPERATION_SAFETY_IDENTITY,
        adapterIdentity: CREATE_SWATCH_RESOURCE_ADAPTER_IDENTITY,
        tool: createSwatchResourceToolContract,
        canonical: {
            version: CANONICAL_CONTRACT_VERSION,
            normalize: normalizeCreateSwatchResourceRequest,
            safetyDigest: createSwatchResourceSafetyRequestDigest,
        },
        resultSchema: swatchResourceResultSchema,
        resultSchemaVersion: RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: TERMINAL_CLASSIFIER_VERSION,
        safetyConformanceVersion: SAFETY_CONFORMANCE_VERSION,
        errorMappingVersion: ERROR_MAPPING_VERSION,
        hostScriptDigest: CREATE_SWATCH_RESOURCE_HOST_SCRIPT_DIGEST,
        buildCommand: (input) => {
            const value = input;
            if (!value.apply)
                return { kind: 'read', script: CREATE_SWATCH_RESOURCE_SCRIPT, params: input };
            const { request, digest } = createSwatchResourceRequestDigest(input);
            const { commandId, ...params } = request;
            return {
                kind: 'mutation',
                mutationValidator: CREATE_SWATCH_RESOURCE_MUTATION_VALIDATOR,
                idempotency: {
                    commandId,
                    operation: 'create_swatch_resource',
                    documentKey: request.expectedDocumentKey,
                    requestDigest: digest,
                },
                adapterIdentity: CREATE_SWATCH_RESOURCE_ADAPTER_IDENTITY,
                script: CREATE_SWATCH_RESOURCE_SCRIPT,
                params,
            };
        },
        classifyTerminal: (value) => {
            const state = swatchResourceResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back' || state === 'rollback_failed') {
                return { state };
            }
            throw new Error('A planned resource result cannot be classified as an apply terminal state.');
        },
        assertSafetyConformance: (value, digest, attestation, resolver) => assertSwatchResourceSafetyConformance(swatchResourceResultSchema.parse(value), digest, attestation, resolver),
        mapExecutionError: (error) => error instanceof Error ? error : new Error(String(error)),
    };
}
