import { z } from 'zod';
const SCHEMA_KEYWORDS = new Set(['items', 'additionalItems', 'additionalProperties', 'not', 'if', 'then', 'else', 'contains', 'propertyNames']);
const SCHEMA_ARRAY_KEYWORDS = new Set(['anyOf', 'oneOf', 'allOf', 'prefixItems', 'items']);
const SCHEMA_MAP_KEYWORDS = new Set(['properties', 'patternProperties', 'definitions', '$defs', 'dependencies', 'dependentSchemas']);
export const MIN_DEDUPLICATED_SCHEMA_BYTES = 48;
const DEFINITION_PREFIX = 'S';
const LOCAL_DEFINITION_REF = /^#\/(?:definitions|\$defs)\/[^/~]+$/;
const DIALECT_2020_12 = 'https://json-schema.org/draft/2020-12/schema';
function definitionsKeyword(schema) {
    if ('$defs' in schema)
        return '$defs';
    if ('definitions' in schema)
        return 'definitions';
    return schema.$schema === DIALECT_2020_12 ? '$defs' : 'definitions';
}
function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function forEachSchemaChild(schema, visit) {
    for (const [keyword, value] of Object.entries(schema)) {
        if (SCHEMA_MAP_KEYWORDS.has(keyword) && isObject(value)) {
            for (const [name, child] of Object.entries(value)) {
                if (isObject(child))
                    visit(child, (next) => { value[name] = next; });
            }
        }
        else if (SCHEMA_ARRAY_KEYWORDS.has(keyword) && Array.isArray(value)) {
            value.forEach((child, index) => {
                if (isObject(child))
                    visit(child, (next) => { value[index] = next; });
            });
        }
        else if (SCHEMA_KEYWORDS.has(keyword) && isObject(value)) {
            visit(value, (next) => { schema[keyword] = next; });
        }
    }
}
function collectRefs(schema, refs) {
    if (typeof schema.$ref === 'string')
        refs.push(schema.$ref);
    forEachSchemaChild(schema, (child) => { collectRefs(child, refs); });
}
export function deduplicateJsonSchema(schema) {
    const root = structuredClone(schema);
    const keyword = definitionsKeyword(root);
    const refPrefix = `#/${keyword}/`;
    const existingRefs = [];
    collectRefs(root, existingRefs);
    if (existingRefs.some((ref) => !ref.startsWith(refPrefix) || !LOCAL_DEFINITION_REF.test(ref)))
        return root;
    if (('$defs' in root && 'definitions' in root) || (keyword in root && !isObject(root[keyword])))
        return root;
    const existingDefinitions = isObject(root[keyword]) ? root[keyword] : {};
    const ids = new Map();
    const nodeId = new Map();
    const nodeBytes = new Map();
    const occurrences = new Map();
    const intern = (node) => {
        forEachSchemaChild(node, (child) => { intern(child); });
        const key = JSON.stringify(node, (name, value) => {
            if (name !== '' && isObject(value) && nodeId.has(value))
                return `\u0000${nodeId.get(value)}`;
            return value;
        });
        let id = ids.get(key);
        if (id === undefined) {
            id = ids.size;
            ids.set(key, id);
            nodeBytes.set(id, Buffer.byteLength(JSON.stringify(node)));
        }
        nodeId.set(node, id);
        occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
        return id;
    };
    intern(root);
    const definitionNames = new Map();
    const definitions = {};
    const usedNames = new Set(Object.keys(existingDefinitions));
    const nextName = (() => {
        let counter = 0;
        return () => {
            let name;
            do {
                counter += 1;
                name = `${DEFINITION_PREFIX}${counter}`;
            } while (usedNames.has(name));
            usedNames.add(name);
            return name;
        };
    })();
    const rewrite = (node, isRoot) => {
        const id = nodeId.get(node);
        if (!isRoot && definitionNames.has(id))
            return { $ref: `${refPrefix}${definitionNames.get(id)}` };
        forEachSchemaChild(node, (child, replace) => { replace(rewrite(child, false)); });
        if (isRoot || (occurrences.get(id) ?? 0) < 2 || (nodeBytes.get(id) ?? 0) < MIN_DEDUPLICATED_SCHEMA_BYTES)
            return node;
        const name = nextName();
        definitionNames.set(id, name);
        definitions[name] = node;
        return { $ref: `${refPrefix}${name}` };
    };
    if (isObject(root[keyword]))
        delete root[keyword];
    const rewritten = rewrite(root, true);
    for (const [name, body] of Object.entries(existingDefinitions)) {
        if (isObject(body))
            existingDefinitions[name] = rewrite(body, false);
    }
    inlineSingleUseDefinitions(rewritten, definitions, existingDefinitions, refPrefix);
    const table = { ...existingDefinitions, ...definitions };
    if (Object.keys(table).length === 0)
        return rewritten;
    return { ...rewritten, [keyword]: table };
}
function inlineSingleUseDefinitions(root, definitions, existing, refPrefix) {
    for (;;) {
        const refs = [];
        collectRefs(root, refs);
        for (const body of Object.values(existing))
            if (isObject(body))
                collectRefs(body, refs);
        for (const body of Object.values(definitions))
            if (isObject(body))
                collectRefs(body, refs);
        const counts = new Map();
        for (const ref of refs)
            counts.set(ref, (counts.get(ref) ?? 0) + 1);
        const single = Object.keys(definitions).filter((name) => (counts.get(`${refPrefix}${name}`) ?? 0) <= 1);
        if (single.length === 0)
            return;
        const bodies = new Map(single.map((name) => [`${refPrefix}${name}`, definitions[name]]));
        for (const name of single)
            delete definitions[name];
        const substitute = (node) => {
            if (typeof node.$ref === 'string' && Object.keys(node).length === 1 && bodies.has(node.$ref)) {
                return substitute(bodies.get(node.$ref));
            }
            forEachSchemaChild(node, (child, replace) => { replace(substitute(child)); });
            return node;
        };
        substitute(root);
        for (const table of [existing, definitions]) {
            for (const [name, body] of Object.entries(table))
                if (isObject(body))
                    table[name] = substitute(body);
        }
    }
}
export const PUBLISHED_DEPTH_KEY = 'x-published-depth';
const SUMMARY_KEYWORDS = ['type', 'const', 'enum', 'description'];
const CONDITIONAL_KEYWORDS = ['if', 'then', 'else'];
export function truncateJsonSchema(schema, maxDepth) {
    const tableKeyword = definitionsKeyword(schema);
    const refPrefix = `#/${tableKeyword}/`;
    const table = schema[tableKeyword];
    const definitions = isObject(table) ? table : {};
    const visit = (node, depth, expanding, limit) => {
        let recursive = false;
        if (typeof node.$ref === 'string' && node.$ref.startsWith(refPrefix) && LOCAL_DEFINITION_REF.test(node.$ref)) {
            const target = definitions[node.$ref.slice(refPrefix.length)];
            if (!isObject(target))
                throw new Error(`Cannot publish a schema with the unresolvable reference ${node.$ref}.`);
            if (!expanding.has(node.$ref))
                return visit(target, depth, new Set([...expanding, node.$ref]), limit);
            node = target;
            recursive = true;
        }
        if (typeof node[PUBLISHED_DEPTH_KEY] === 'number')
            limit = Math.min(limit, depth + node[PUBLISHED_DEPTH_KEY]);
        if (recursive || depth > limit) {
            const summary = {};
            for (const keyword of SUMMARY_KEYWORDS)
                if (node[keyword] !== undefined)
                    summary[keyword] = node[keyword];
            return { schema: summary, loosened: Object.keys(summary).length !== Object.keys(node).length };
        }
        const copy = {};
        for (const [keyword, value] of Object.entries(node)) {
            if (keyword === PUBLISHED_DEPTH_KEY || (depth === 0 && (keyword === 'definitions' || keyword === '$defs')))
                continue;
            if (SCHEMA_MAP_KEYWORDS.has(keyword) && isObject(value))
                copy[keyword] = { ...value };
            else if (SCHEMA_ARRAY_KEYWORDS.has(keyword) && Array.isArray(value))
                copy[keyword] = [...value];
            else
                copy[keyword] = value;
        }
        let loosened = false;
        const loosenedKeywords = new Set();
        for (const [keyword, value] of Object.entries(copy)) {
            const children = [];
            if (SCHEMA_MAP_KEYWORDS.has(keyword) && isObject(value)) {
                for (const [name, child] of Object.entries(value))
                    if (isObject(child))
                        children.push([child, (next) => { value[name] = next; }]);
            }
            else if (SCHEMA_ARRAY_KEYWORDS.has(keyword) && Array.isArray(value)) {
                value.forEach((child, index) => { if (isObject(child))
                    children.push([child, (next) => { value[index] = next; }]); });
            }
            else if (SCHEMA_KEYWORDS.has(keyword) && isObject(value)) {
                children.push([value, (next) => { copy[keyword] = next; }]);
            }
            for (const [child, replace] of children) {
                const visited = visit(child, depth + 1, expanding, limit);
                replace(visited.schema);
                if (visited.loosened) {
                    loosened = true;
                    loosenedKeywords.add(keyword);
                }
            }
        }
        if (loosenedKeywords.has('not'))
            delete copy.not;
        if (CONDITIONAL_KEYWORDS.some((keyword) => loosenedKeywords.has(keyword))) {
            for (const keyword of CONDITIONAL_KEYWORDS)
                delete copy[keyword];
        }
        if (loosenedKeywords.has('oneOf')) {
            const branches = copy.oneOf;
            delete copy.oneOf;
            if (copy.anyOf === undefined)
                copy.anyOf = branches;
            else
                copy.allOf = [...(Array.isArray(copy.allOf) ? copy.allOf : []), { anyOf: branches }];
        }
        return { schema: copy, loosened };
    };
    return visit(schema, 0, new Set(), maxDepth).schema;
}
function hasPublishedDepthMarker(schema) {
    return JSON.stringify(schema).includes(`"${PUBLISHED_DEPTH_KEY}"`);
}
export function publishToolDefinition(tool) {
    let inputSchema = tool.inputSchema;
    if (hasPublishedDepthMarker(inputSchema))
        inputSchema = truncateJsonSchema(inputSchema, Number.POSITIVE_INFINITY);
    const published = { ...tool, inputSchema: deduplicateJsonSchema(inputSchema) };
    if (tool.outputSchema !== undefined) {
        published.outputSchema = deduplicateJsonSchema(tool.outputSchema);
    }
    return published;
}
const cachedToolLists = new WeakMap();
export function installPublishedToolList(server, cacheKey) {
    const protocol = server.server;
    const sdkHandler = protocol._requestHandlers?.get('tools/list');
    const registered = server._registeredTools;
    if (sdkHandler === undefined || registered === undefined) {
        throw new Error('The MCP SDK tools/list handler or tool registry is not where this server version expects it.');
    }
    const signature = () => Object.entries(registered)
        .filter(([, tool]) => tool.enabled)
        .map(([name]) => name)
        .join('\n');
    server.server.setRequestHandler('tools/list', async (request, ctx) => {
        const current = signature();
        const cached = cachedToolLists.get(cacheKey);
        if (cached !== undefined && cached.signature === current)
            return cached.result;
        const listed = await sdkHandler(request, ctx);
        const result = { ...listed, tools: listed.tools.map((tool) => publishToolDefinition(tool)) };
        cachedToolLists.set(cacheKey, { signature: current, result });
        return result;
    });
}
const sharedToolSchemas = new WeakMap();
function withMemoizedJsonSchema(schema) {
    if (schema === undefined)
        return undefined;
    const standard = typeof schema === 'object' && schema !== null && '~standard' in schema
        ? schema
        : z.object(schema);
    const original = standard['~standard'];
    const converted = new Map();
    const memoized = (io) => (options) => {
        const key = `${io}\u0000${options.target}`;
        let json = converted.get(key);
        if (json === undefined) {
            json = original.jsonSchema[io](options);
            if (io === 'input')
                json = deduplicateJsonSchema(json);
            converted.set(key, json);
        }
        return json;
    };
    return {
        '~standard': {
            version: original.version,
            vendor: original.vendor,
            validate: (value) => original.validate(value),
            jsonSchema: { input: memoized('input'), output: memoized('output') },
        },
    };
}
export function installSharedToolSchemas(server, cacheKey) {
    let shared = sharedToolSchemas.get(cacheKey);
    if (shared === undefined) {
        shared = new Map();
        sharedToolSchemas.set(cacheKey, shared);
    }
    const schemas = shared;
    const register = server.registerTool.bind(server);
    server.registerTool = ((name, config, callback) => {
        let entry = schemas.get(name);
        if (entry === undefined) {
            entry = { inputSchema: withMemoizedJsonSchema(config.inputSchema), outputSchema: withMemoizedJsonSchema(config.outputSchema) };
            schemas.set(name, entry);
        }
        return register(name, { ...config, inputSchema: entry.inputSchema, outputSchema: entry.outputSchema }, callback);
    });
}
