import { OperationSafetyRegistry, operationSafetyPolicyToMcpAnnotations } from './operation-safety-policy-core.js';
import { canonicalSha256 } from './mutation-canonical.js';
export const MUTATION_OPERATION_ADAPTER_VERSION = 1;
export function mutationAdapterIdentity(contract) {
    return canonicalSha256(contract);
}
function canonicalJsonDigest(value) {
    const serialized = JSON.stringify(value);
    if (serialized === undefined)
        throw new Error('Mutation adapter command parameters are not JSON serializable.');
    return canonicalSha256(JSON.parse(serialized));
}
const ZOD_LAZY_METHODS = [
    'optional', 'nullable', 'nullish', 'array', 'or', 'and', 'transform',
    'default', 'prefault', 'catch', 'pipe', 'readonly', 'describe', 'meta',
    'brand', 'register', 'check', 'refine', 'superRefine', 'overwrite',
];
const SEALED_ZOD_DEFINITION_GUARDS = new WeakMap();
const SEALED_ZOD_MUTABLE_AUTHORITY_GUARDS = new Set();
const ACTIVE_ZOD_PARSE_CONTEXTS = new WeakSet();
const ZOD_MATERIALIZATION_PASS_LIMIT = 4;
function guardedZodAuthorityCount(context) {
    return context.pendingFreeze.size + context.mutableAuthorities.size;
}
function sealZodDefinitionGraph(value, context) {
    if (typeof value !== 'object' || value === null || context.visited.has(value))
        return;
    const candidate = value;
    if (candidate._zod !== undefined) {
        sealZodAuthority(candidate, context);
        return;
    }
    if (value instanceof Set) {
        context.visited.add(value);
        context.mutableAuthorities.add(value);
        for (const child of Set.prototype.values.call(value)) {
            sealZodDefinitionGraph(child, context);
        }
        return;
    }
    if (value instanceof Map) {
        context.visited.add(value);
        context.mutableAuthorities.add(value);
        for (const [key, child] of Map.prototype.entries.call(value)) {
            sealZodDefinitionGraph(key, context);
            sealZodDefinitionGraph(child, context);
        }
        return;
    }
    if (value instanceof RegExp || value instanceof Date) {
        context.visited.add(value);
        context.mutableAuthorities.add(value);
        return;
    }
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
        return;
    context.visited.add(value);
    if (!Object.isFrozen(value))
        context.pendingDefinitions.add(value);
    for (const key of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined)
            continue;
        const child = 'value' in descriptor ? descriptor.value : Reflect.get(value, key);
        sealZodDefinitionGraph(child, context);
    }
}
function sealZodAuthority(value, context) {
    if (context.visited.has(value))
        return value;
    const candidate = value;
    if (Object.isFrozen(candidate) && Object.isFrozen(candidate._zod)) {
        const guard = SEALED_ZOD_DEFINITION_GUARDS.get(candidate);
        if (guard === undefined) {
            throw new Error('Pre-frozen Zod schema authority was not sealed by this registry.');
        }
        guard();
        return candidate;
    }
    context.visited.add(candidate);
    context.pendingFreeze.add(candidate);
    context.zodSchemas.add(candidate);
    for (const method of ZOD_LAZY_METHODS)
        void candidate[method];
    const internalChildren = [];
    for (const key of Reflect.ownKeys(candidate._zod)) {
        const descriptor = Object.getOwnPropertyDescriptor(candidate._zod, key);
        if (descriptor === undefined)
            continue;
        internalChildren.push('value' in descriptor ? descriptor.value : Reflect.get(candidate._zod, key));
    }
    for (const child of internalChildren)
        sealZodDefinitionGraph(child, context);
    const definition = candidate._zod.def;
    if (typeof definition === 'object' && definition !== null) {
        if (Reflect.get(definition, 'type') === 'custom') {
            throw new Error('Zod custom definitions are not supported by sealed mutation adapters.');
        }
        context.zodDefinitions.add(definition);
    }
    sealZodDefinitionGraph(definition, context);
    sealZodDefinitionGraph(candidate._zod.bag, context);
    sealZodDefinitionGraph(candidate._zod.deferred, context);
    context.pendingFreeze.add(candidate._zod);
    return candidate;
}
function materializeZodAuthorityGraph(context) {
    for (let pass = 0; pass < ZOD_MATERIALIZATION_PASS_LIMIT; pass++) {
        const countBeforePass = guardedZodAuthorityCount(context);
        for (const authority of context.pendingFreeze) {
            for (const key of Reflect.ownKeys(authority)) {
                const before = Object.getOwnPropertyDescriptor(authority, key);
                if (before?.get === undefined)
                    continue;
                const child = Reflect.get(authority, key);
                sealZodDefinitionGraph(child, context);
            }
        }
        if (guardedZodAuthorityCount(context) === countBeforePass)
            return;
    }
    throw new Error(`Zod authority graph did not converge within ${ZOD_MATERIALIZATION_PASS_LIMIT} passes.`);
}
function materializeZodDefinitionCaches(context) {
    for (const definition of context.pendingDefinitions) {
        for (const key of Reflect.ownKeys(definition)) {
            const descriptor = Object.getOwnPropertyDescriptor(definition, key);
            if (descriptor?.get === undefined)
                continue;
            sealZodDefinitionGraph(Reflect.get(definition, key), context);
        }
    }
}
function samePropertyKeys(left, right) {
    return left.length === right.length && left.every((key, index) => key === right[index]);
}
function sameIdentitySequence(left, right) {
    return left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
}
function snapshotMutableZodAuthority(authority) {
    if (authority instanceof Set) {
        const values = [...Set.prototype.values.call(authority)];
        return () => {
            const current = [...Set.prototype.values.call(authority)];
            if (!sameIdentitySequence(current, values))
                throw new Error('Zod mutable authority changed after registry seal.');
        };
    }
    if (authority instanceof Map) {
        const entries = [...Map.prototype.entries.call(authority)];
        return () => {
            const current = [...Map.prototype.entries.call(authority)];
            if (current.length !== entries.length || current.some(([key, value], index) => !Object.is(key, entries[index][0]) || !Object.is(value, entries[index][1]))) {
                throw new Error('Zod mutable authority changed after registry seal.');
            }
        };
    }
    if (authority instanceof RegExp) {
        const source = Object.getOwnPropertyDescriptor(RegExp.prototype, 'source').get.call(authority);
        const flags = Object.getOwnPropertyDescriptor(RegExp.prototype, 'flags').get.call(authority);
        return () => {
            const currentSource = Object.getOwnPropertyDescriptor(RegExp.prototype, 'source').get.call(authority);
            const currentFlags = Object.getOwnPropertyDescriptor(RegExp.prototype, 'flags').get.call(authority);
            if (currentSource !== source || currentFlags !== flags) {
                throw new Error('Zod mutable authority changed after registry seal.');
            }
        };
    }
    const timestamp = Date.prototype.getTime.call(authority);
    return () => {
        if (Date.prototype.getTime.call(authority) !== timestamp) {
            throw new Error('Zod mutable authority changed after registry seal.');
        }
    };
}
function assertZodMutableAuthorities() {
    for (const assertAuthority of SEALED_ZOD_MUTABLE_AUTHORITY_GUARDS)
        assertAuthority();
}
function runWithZodMutableAuthorityGuards(runtimeContext, run) {
    if (typeof runtimeContext !== 'object' || runtimeContext === null) {
        assertZodMutableAuthorities();
        return run();
    }
    if (ACTIVE_ZOD_PARSE_CONTEXTS.has(runtimeContext))
        return run();
    ACTIVE_ZOD_PARSE_CONTEXTS.add(runtimeContext);
    try {
        assertZodMutableAuthorities();
        return run();
    }
    finally {
        ACTIVE_ZOD_PARSE_CONTEXTS.delete(runtimeContext);
    }
}
function installZodDefinitionGuards(context) {
    for (const authority of context.mutableAuthorities) {
        SEALED_ZOD_MUTABLE_AUTHORITY_GUARDS.add(snapshotMutableZodAuthority(authority));
    }
    for (const schema of context.zodSchemas) {
        const candidate = schema;
        const definition = candidate._zod.def;
        const run = candidate._zod.run;
        if (typeof definition !== 'object' || definition === null || typeof run !== 'function')
            continue;
        const keys = Reflect.ownKeys(definition);
        const snapshots = keys.map((key) => {
            const value = Reflect.get(definition, key);
            if (key === 'shape' && typeof value === 'object' && value !== null) {
                const shapeKeys = Reflect.ownKeys(value);
                return { key, value, shapeKeys, shapeValues: shapeKeys.map((shapeKey) => Reflect.get(value, shapeKey)) };
            }
            return { key, value, shapeKeys: null, shapeValues: null };
        });
        const assertDefinition = () => {
            if (candidate._zod.def !== definition || !samePropertyKeys(Reflect.ownKeys(definition), keys)) {
                throw new Error('Zod validation definition changed after registry seal.');
            }
            for (const snapshot of snapshots) {
                const current = Reflect.get(definition, snapshot.key);
                if (snapshot.shapeKeys === null || snapshot.shapeValues === null) {
                    if (current !== snapshot.value)
                        throw new Error('Zod validation definition changed after registry seal.');
                    continue;
                }
                if (typeof current !== 'object' || current === null) {
                    throw new Error('Zod validation definition changed after registry seal.');
                }
                const currentKeys = Reflect.ownKeys(current);
                if (!samePropertyKeys(currentKeys, snapshot.shapeKeys) ||
                    snapshot.shapeKeys.some((key, index) => Reflect.get(current, key) !== snapshot.shapeValues[index])) {
                    throw new Error('Zod validation definition changed after registry seal.');
                }
            }
        };
        candidate._zod.run = (payload, runtimeContext) => {
            assertDefinition();
            return runWithZodMutableAuthorityGuards(runtimeContext, () => run(payload, runtimeContext));
        };
        SEALED_ZOD_DEFINITION_GUARDS.set(schema, assertDefinition);
    }
}
function cloneAndFreezePlainGraph(value, zodContext) {
    if (Array.isArray(value)) {
        return Object.freeze(value.map((item) => cloneAndFreezePlainGraph(item, zodContext)));
    }
    if (typeof value !== 'object' || value === null)
        return value;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        const candidate = value;
        return candidate._zod === undefined ? Object.freeze(value) : sealZodAuthority(value, zodContext);
    }
    const clone = {};
    for (const [key, item] of Object.entries(value))
        clone[key] = cloneAndFreezePlainGraph(item, zodContext);
    return Object.freeze(clone);
}
function detached(adapter) {
    assertZodMutableAuthorities();
    const zodContext = {
        visited: new WeakSet(),
        pendingFreeze: new Set(),
        pendingDefinitions: new Set(),
        mutableAuthorities: new Set(),
        zodDefinitions: new Set(),
        zodSchemas: new Set(),
    };
    const stored = cloneAndFreezePlainGraph({
        ...adapter,
        validator: adapter.validator,
        safety: adapter.safety,
        tool: adapter.tool,
        canonical: adapter.canonical,
        resultSchema: adapter.resultSchema,
    }, zodContext);
    for (let pass = 0; pass < ZOD_MATERIALIZATION_PASS_LIMIT; pass++) {
        const countBeforePass = guardedZodAuthorityCount(zodContext);
        materializeZodAuthorityGraph(zodContext);
        materializeZodDefinitionCaches(zodContext);
        if (guardedZodAuthorityCount(zodContext) === countBeforePass)
            break;
        if (pass === ZOD_MATERIALIZATION_PASS_LIMIT - 1) {
            throw new Error(`Zod seal graph did not converge within ${ZOD_MATERIALIZATION_PASS_LIMIT} passes.`);
        }
    }
    for (const definition of zodContext.pendingDefinitions) {
        if (!zodContext.zodDefinitions.has(definition))
            Object.freeze(definition);
    }
    installZodDefinitionGuards(zodContext);
    for (const authority of zodContext.pendingFreeze)
        Object.freeze(authority);
    return stored;
}
function expectedAdapterIdentity(adapter) {
    const contract = {
        version: 2,
        contractVersion: adapter.version,
        operation: adapter.operation,
        validator: adapter.validator,
        canonicalContractVersion: adapter.canonical.version,
        resultSchemaVersion: adapter.resultSchemaVersion,
        terminalClassifierVersion: adapter.terminalClassifierVersion,
        safetyConformanceVersion: adapter.safetyConformanceVersion,
        errorMappingVersion: adapter.errorMappingVersion,
        safetyIdentity: adapter.safetyRegistrationIdentity,
        hostScriptDigest: adapter.hostScriptDigest,
        ...(adapter.mutationHostApplicationMode === undefined
            ? {}
            : { mutationHostApplicationMode: adapter.mutationHostApplicationMode }),
    };
    return mutationAdapterIdentity(contract);
}
export class MutationOperationAdapterRegistry {
    #byOperation = new Map();
    #byValidator = new Map();
    #byTool = new Map();
    #sealed = false;
    register(adapter) {
        if (this.#sealed)
            throw new Error('Mutation operation adapter registry is sealed.');
        const value = detached(adapter);
        if (value.version !== MUTATION_OPERATION_ADAPTER_VERSION)
            throw new Error('Unsupported mutation operation adapter contract version.');
        if (!/^[a-z][a-z0-9_]*$/.test(value.operation) || !/^[a-z][a-z0-9_]*$/.test(value.validator.kind) ||
            !Number.isSafeInteger(value.validator.version) || value.validator.version < 1) {
            throw new Error('Mutation adapter operation and validator identity are invalid.');
        }
        if (value.safety.operationId !== value.operation || value.safety.policy.version !== value.validator.version ||
            !value.safetyRegistrationIdentity || value.tool.name.length === 0) {
            throw new Error('Mutation adapter safety registration does not bind to its operation identity.');
        }
        if (!Number.isSafeInteger(value.canonical.version) || value.canonical.version < 1 ||
            !Number.isSafeInteger(value.resultSchemaVersion) || value.resultSchemaVersion < 1 ||
            !Number.isSafeInteger(value.terminalClassifierVersion) || value.terminalClassifierVersion < 1 ||
            !Number.isSafeInteger(value.safetyConformanceVersion) || value.safetyConformanceVersion < 1 ||
            !Number.isSafeInteger(value.errorMappingVersion) || value.errorMappingVersion < 1 ||
            !/^[0-9a-f]{64}$/.test(value.hostScriptDigest) ||
            (value.mutationHostApplicationMode !== undefined && value.mutationHostApplicationMode !== 'foreground') ||
            !/^[0-9a-f]{64}$/.test(value.adapterIdentity) || value.adapterIdentity !== expectedAdapterIdentity(value)) {
            throw new Error('Mutation adapter durable identity does not match its versioned contracts.');
        }
        const safety = new OperationSafetyRegistry();
        safety.register(value.safety);
        safety.assertApplyReady(value.operation, {
            class: value.safety.policy.class,
            version: value.safety.policy.version,
            registrationIdentity: value.safetyRegistrationIdentity,
        });
        if (canonicalSha256(value.tool.annotations) !==
            canonicalSha256(operationSafetyPolicyToMcpAnnotations(value.safety.policy))) {
            throw new Error('Mutation adapter tool annotations do not match its safety policy.');
        }
        const key = `${value.operation}\u0000${value.validator.kind}\u0000${value.validator.version}`;
        if (this.#byOperation.has(value.operation) || this.#byValidator.has(key) || this.#byTool.has(value.tool.name)) {
            throw new Error('Duplicate mutation operation, validator, or tool registration.');
        }
        this.#byOperation.set(value.operation, value);
        this.#byValidator.set(key, value);
        this.#byTool.set(value.tool.name, value);
        return this;
    }
    seal() { this.#sealed = true; return this; }
    isSealed() { return this.#sealed; }
    resolve(operation, validator) {
        const adapter = this.#byValidator.get(`${operation}\u0000${validator.kind}\u0000${validator.version}`);
        if (!adapter || adapter.operation !== operation)
            throw new Error(`Unknown or mismatched mutation adapter ${operation}/${validator.kind}@${validator.version}.`);
        return adapter;
    }
    resolveIdentity(operation, validator, adapterIdentity) {
        const adapter = this.resolve(operation, validator);
        if (adapter.adapterIdentity !== adapterIdentity) {
            throw new Error(`Mismatched durable mutation adapter identity for ${operation}/${validator.kind}@${validator.version}.`);
        }
        return adapter;
    }
    resolveOperation(operation) {
        const adapter = this.#byOperation.get(operation);
        if (!adapter)
            throw new Error(`Unknown mutation operation ${operation}.`);
        return adapter;
    }
    list() { return Object.freeze([...this.#byOperation.values()]); }
    prepare(operation, input) {
        const adapter = this.resolveOperation(operation);
        const canonical = adapter.canonical.normalize(input);
        if (!/^[0-9a-f]{64}$/.test(canonical.digest) || adapter.canonical.safetyDigest(input) !== canonical.digest) {
            throw new Error('Mutation adapter canonical request digest contract mismatch.');
        }
        const command = adapter.buildCommand(input);
        if (canonicalSha256(command.script) !== adapter.hostScriptDigest) {
            throw new Error('Mutation adapter command host script does not match its durable identity.');
        }
        if ((canonical.intent === 'apply') !== (command.kind === 'mutation')) {
            throw new Error('Mutation adapter request schema and command intent mismatch.');
        }
        if (command.kind === 'mutation') {
            this.resolve(command.idempotency.operation, command.mutationValidator);
            if (command.idempotency.operation !== adapter.operation ||
                command.mutationValidator.kind !== adapter.validator.kind ||
                command.mutationValidator.version !== adapter.validator.version ||
                command.adapterIdentity !== adapter.adapterIdentity ||
                command.mutationHostApplicationMode !== adapter.mutationHostApplicationMode ||
                command.idempotency.commandId !== canonical.commandId ||
                command.idempotency.documentKey !== canonical.documentKey ||
                command.idempotency.requestDigest !== canonical.digest ||
                command.idempotency.documentKey.length === 0 || command.idempotency.documentKey.length > 16_384) {
                throw new Error('Mutation adapter command identity or canonical digest mismatch.');
            }
        }
        const { commandId: _commandId, ...canonicalParams } = canonical.request;
        if (canonicalJsonDigest(command.params ?? {}) !== canonicalJsonDigest(canonicalParams)) {
            throw new Error('Mutation adapter request schema and command parameters mismatch.');
        }
        return { adapter, command, canonicalRequestDigest: canonical.digest };
    }
}
export function assertAdapterSafetyIdentity(adapter) {
    if (adapter.safety.operationId !== adapter.operation || !adapter.safetyRegistrationIdentity) {
        throw new Error('Mutation adapter safety registration identity is invalid.');
    }
}
