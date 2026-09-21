const LEGACY_STATE_VERSION = 1;
const LEGACY_OPERATION = 'create_rectangle';
const LEGACY_VALIDATOR_VERSION = 1;
const LEGACY_ADAPTER_IDENTITY = '801ea55de9d05b649995e9b2e9b1b86b3264ce156ec4f7922249fbea53374c43';
const CANONICAL_ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
function hasCanonicalDigest(value) {
    return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
function hasDocumentKey(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 16_384;
}
function hasTimestamp(value) {
    return typeof value === 'string' && CANONICAL_ISO_TIMESTAMP.test(value) && Number.isFinite(Date.parse(value));
}
export function legacyCommandMetadata(value, commandId) {
    if (value.version !== LEGACY_STATE_VERSION || value.commandId !== commandId ||
        typeof value.createdAt !== 'string' || value.createdAt.length === 0)
        return null;
    if (value.kind === 'read') {
        return Object.keys(value).sort().join(',') === 'commandId,createdAt,kind,version'
            ? value
            : null;
    }
    const validator = value.mutationValidator;
    const keys = Object.keys(value).sort().join(',');
    const baseKeys = 'commandId,createdAt,documentKey,kind,mutationValidator,operation,requestDigest,version';
    const preV2Keys = 'adapterIdentity,commandId,createdAt,documentKey,kind,mutationValidator,operation,requestDigest,version';
    if (value.kind !== 'mutation' || (keys !== baseKeys && keys !== preV2Keys) ||
        (keys === preV2Keys && value.adapterIdentity !== LEGACY_ADAPTER_IDENTITY) ||
        value.operation !== LEGACY_OPERATION || !hasDocumentKey(value.documentKey) ||
        !hasCanonicalDigest(value.requestDigest) || typeof validator !== 'object' || validator === null ||
        Object.keys(validator).sort().join(',') !== 'kind,version' ||
        validator.kind !== LEGACY_OPERATION ||
        validator.version !== LEGACY_VALIDATOR_VERSION)
        return null;
    return value;
}
export function legacyFinalization(value, commandId) {
    const keys = Object.keys(value).sort().join(',');
    const baseKeys = 'commandId,documentKey,finalizedAt,operation,requestDigest,resultDigest,resultDigestAlgorithm,terminalState,validatorKind,validatorVersion,version';
    const preV2Keys = 'adapterIdentity,commandId,documentKey,finalizedAt,operation,requestDigest,resultDigest,resultDigestAlgorithm,terminalState,validatorKind,validatorVersion,version';
    if ((keys !== baseKeys && keys !== preV2Keys) ||
        (keys === preV2Keys && value.adapterIdentity !== LEGACY_ADAPTER_IDENTITY) ||
        value.version !== LEGACY_STATE_VERSION || value.commandId !== commandId || value.operation !== LEGACY_OPERATION ||
        !hasDocumentKey(value.documentKey) || !hasCanonicalDigest(value.requestDigest) ||
        value.validatorKind !== LEGACY_OPERATION || value.validatorVersion !== LEGACY_VALIDATOR_VERSION ||
        value.resultDigestAlgorithm !== 'sha256' || !hasCanonicalDigest(value.resultDigest) ||
        !hasTimestamp(value.finalizedAt) ||
        (value.terminalState !== 'verified' && value.terminalState !== 'apply_failed' &&
            value.terminalState !== 'rolled_back' && value.terminalState !== 'rollback_failed'))
        return null;
    return value;
}
export function legacyCompactIdempotency(value, commandId) {
    const commonKeys = [
        'commandId', 'documentKey', 'finalizedAt', 'kind', 'operation', 'requestDigest', 'terminalState',
        'validatorKind', 'validatorVersion', 'version',
    ];
    const replay = value.kind === 'replay_bundle';
    const expectedBaseKeys = replay
        ? [...commonKeys, 'resultDigest', 'resultDigestAlgorithm'].sort().join(',')
        : commonKeys.sort().join(',');
    const expectedPreV2Keys = [...commonKeys, 'adapterIdentity',
        ...(replay ? ['resultDigest', 'resultDigestAlgorithm'] : [])].sort().join(',');
    const keys = Object.keys(value).sort().join(',');
    if ((keys !== expectedBaseKeys && keys !== expectedPreV2Keys) ||
        (keys === expectedPreV2Keys && value.adapterIdentity !== LEGACY_ADAPTER_IDENTITY) ||
        value.version !== LEGACY_STATE_VERSION || value.commandId !== commandId || value.operation !== LEGACY_OPERATION ||
        !hasDocumentKey(value.documentKey) || !hasCanonicalDigest(value.requestDigest) ||
        value.validatorKind !== LEGACY_OPERATION || value.validatorVersion !== LEGACY_VALIDATOR_VERSION ||
        !hasTimestamp(value.finalizedAt) || (value.kind !== 'replay_bundle' && value.kind !== 'tombstone'))
        return null;
    if (replay) {
        if ((value.terminalState !== 'verified' && value.terminalState !== 'apply_failed' &&
            value.terminalState !== 'rolled_back' && value.terminalState !== 'rollback_failed') ||
            value.resultDigestAlgorithm !== 'sha256' || !hasCanonicalDigest(value.resultDigest))
            return null;
    }
    else if (value.terminalState !== 'failed')
        return null;
    return value;
}
