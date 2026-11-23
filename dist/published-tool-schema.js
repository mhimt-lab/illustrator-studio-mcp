import { z } from 'zod';
import { publishResultShape } from './published-result-shape.js';
import { toolArgumentIssueMessage } from './tool-arguments.js';
const SCHEMA_KEYWORDS = new Set(['items', 'additionalItems', 'additionalProperties', 'not', 'if', 'then', 'else', 'contains', 'propertyNames']);
const SCHEMA_ARRAY_KEYWORDS = new Set(['anyOf', 'oneOf', 'allOf', 'prefixItems', 'items']);
const SCHEMA_MAP_KEYWORDS = new Set(['properties', 'patternProperties', 'definitions', '$defs', 'dependencies', 'dependentSchemas']);
export const MIN_DEDUPLICATED_SCHEMA_BYTES = 48;
const DEFINITION_PREFIX = '';
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
export function deduplicateJsonSchema(schema, minimumBytes = MIN_DEDUPLICATED_SCHEMA_BYTES) {
    const root = structuredClone(schema);
    const keyword = definitionsKeyword(root);
    const refPrefix = `#/${keyword}/`;
    const shortestRefBytes = Buffer.byteLength(JSON.stringify({ $ref: `${refPrefix}${DEFINITION_PREFIX}1` }));
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
                name = `${DEFINITION_PREFIX}${counter.toString(36)}`;
            } while (usedNames.has(name));
            usedNames.add(name);
            return name;
        };
    })();
    const rewrite = (node, isRoot) => {
        const id = nodeId.get(node);
        if (!isRoot && definitionNames.has(id))
            return { $ref: `${refPrefix}${definitionNames.get(id)}` };
        if (minimumBytes < MIN_DEDUPLICATED_SCHEMA_BYTES && (nodeBytes.get(id) ?? 0) <= shortestRefBytes)
            return node;
        forEachSchemaChild(node, (child, replace) => { replace(rewrite(child, false)); });
        if (isRoot || (occurrences.get(id) ?? 0) < 2 || (nodeBytes.get(id) ?? 0) < minimumBytes)
            return node;
        if (minimumBytes < MIN_DEDUPLICATED_SCHEMA_BYTES) {
            const bodyBytes = Buffer.byteLength(JSON.stringify(node));
            if ((occurrences.get(id) ?? 0) * (bodyBytes - shortestRefBytes) <= bodyBytes + 6)
                return node;
        }
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
    inlineUnprofitableDefinitions(rewritten, definitions, existingDefinitions, refPrefix, minimumBytes < MIN_DEDUPLICATED_SCHEMA_BYTES);
    const table = { ...existingDefinitions, ...definitions };
    if (Object.keys(table).length === 0)
        return rewritten;
    return { ...rewritten, [keyword]: table };
}
function inlineUnprofitableDefinitions(root, definitions, existing, refPrefix, checkSize) {
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
        const inline = Object.keys(definitions).filter((name) => {
            const ref = `${refPrefix}${name}`;
            const count = counts.get(ref) ?? 0;
            if (count <= 1)
                return true;
            if (!checkSize)
                return false;
            const bodyBytes = Buffer.byteLength(JSON.stringify(definitions[name]));
            const refBytes = Buffer.byteLength(JSON.stringify({ $ref: ref }));
            const entryBytes = Buffer.byteLength(JSON.stringify({ [name]: definitions[name] })) - 1;
            return count * (bodyBytes - refBytes) <= entryBytes;
        });
        if (inline.length === 0)
            return;
        const bodies = new Map(inline.map((name) => [`${refPrefix}${name}`, definitions[name]]));
        for (const name of inline)
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
export const PUBLISHED_AS_KEY = 'x-published-as';
const SUMMARY_KEYWORDS = ['type', 'const', 'enum', 'description'];
const CONDITIONAL_KEYWORDS = ['if', 'then', 'else'];
export function truncateJsonSchema(schema, maxDepth, options = {}) {
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
            if (options.scalarItems === true && isObject(node.items)) {
                const items = typeof node.items.$ref === 'string' && node.items.$ref.startsWith(refPrefix) ? definitions[node.items.$ref.slice(refPrefix.length)] : node.items;
                if (isObject(items) && (items.enum !== undefined || items.const !== undefined)) {
                    const itemSummary = {};
                    for (const keyword of SUMMARY_KEYWORDS)
                        if (items[keyword] !== undefined && keyword !== 'description')
                            itemSummary[keyword] = items[keyword];
                    summary.items = itemSummary;
                }
            }
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
export function withoutDescriptions(schema) {
    delete schema.description;
    forEachSchemaChild(schema, (child) => { withoutDescriptions(child); });
    return schema;
}
export const COMPACT_DATE_TIME_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:\\d{2})$';
export function compactDateTimePatterns(schema) {
    if (schema.format === 'date-time' && typeof schema.pattern === 'string')
        schema.pattern = COMPACT_DATE_TIME_PATTERN;
    forEachSchemaChild(schema, (child) => { compactDateTimePatterns(child); });
    return schema;
}
function hasPublishedDepthMarker(schema) {
    return JSON.stringify(schema).includes(`"${PUBLISHED_DEPTH_KEY}"`);
}
export function applyPublishedAs(schema) {
    if (!JSON.stringify(schema).includes(`"${PUBLISHED_AS_KEY}"`))
        return schema;
    const replace = (node) => {
        const replacement = node[PUBLISHED_AS_KEY];
        if (replacement !== undefined) {
            if (!isObject(replacement))
                throw new Error(`${PUBLISHED_AS_KEY} must be a JSON Schema object.`);
            return structuredClone(replacement);
        }
        forEachSchemaChild(node, (child, swap) => { swap(replace(child)); });
        return node;
    };
    return replace(structuredClone(schema));
}
const TOP_LEVEL_BRANCH_KEYWORDS = ['oneOf', 'anyOf'];
const TOP_LEVEL_UNMERGEABLE_KEYWORDS = ['allOf', 'not', 'if', 'then', 'else'];
const MERGEABLE_BRANCH_KEYWORDS = new Set(['type', 'properties', 'required', 'additionalProperties', 'description', '$schema']);
const SCALAR_ALTERNATIVE_KEYWORDS = new Set(['type', 'const', 'default', 'description']);
function stableKey(value) {
    if (Array.isArray(value))
        return `[${value.map(stableKey).join(',')}]`;
    if (isObject(value))
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableKey(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
}
function localDefinitions(root) {
    return isObject(root.$defs) ? root.$defs : isObject(root.definitions) ? root.definitions : {};
}
function resolveLocalSchema(node, root) {
    const seen = new Set();
    let current = node;
    while (typeof current.$ref === 'string') {
        const ref = current.$ref;
        const target = LOCAL_DEFINITION_REF.test(ref) ? localDefinitions(root)[ref.slice(ref.lastIndexOf('/') + 1)] : undefined;
        if (seen.has(ref) || !isObject(target))
            throw new Error(`Cannot publish a flat input schema with the unresolvable reference ${ref}.`);
        seen.add(ref);
        current = target;
    }
    return current;
}
function mergePropertyVariants(variants, root) {
    const resolved = variants.map((variant) => resolveLocalSchema(variant, root));
    const type = resolved[0]?.type;
    const scalar = typeof type === 'string'
        && resolved.every((variant) => variant.type === type && Object.keys(variant).every((key) => SCALAR_ALTERNATIVE_KEYWORDS.has(key)));
    if (!scalar)
        return { anyOf: variants };
    const merged = { type };
    if (resolved.every((variant) => variant.const !== undefined)) {
        const values = new Map(resolved.map((variant) => [stableKey(variant.const), variant.const]));
        if (!(type === 'boolean' && values.size === 2))
            merged.enum = [...values.values()];
    }
    const withDefault = resolved.find((variant) => variant.default !== undefined);
    if (withDefault !== undefined)
        merged.default = withDefault.default;
    const descriptions = new Set(resolved.map((variant) => variant.description).filter((description) => description !== undefined));
    if (descriptions.size === 1)
        merged.description = [...descriptions][0];
    return merged;
}
function branchForm(branch, root) {
    const apply = branch.properties.apply;
    if (!isObject(apply))
        return undefined;
    const constant = resolveLocalSchema(apply, root).const;
    if (constant === true)
        return 'apply';
    if (constant === false)
        return 'plan';
    return undefined;
}
function withPropertyNote(property, note, root) {
    const target = structuredClone(resolveLocalSchema(property, root));
    const existing = typeof target.description === 'string' ? target.description : undefined;
    target.description = existing === undefined ? note : `${note} ${existing}`;
    return target;
}
export function flattenTopLevelComposition(schema) {
    const branchKeywords = TOP_LEVEL_BRANCH_KEYWORDS.filter((candidate) => candidate in schema);
    const unmergeable = TOP_LEVEL_UNMERGEABLE_KEYWORDS.find((candidate) => candidate in schema);
    if (branchKeywords.length === 0 && unmergeable === undefined)
        return schema;
    if (unmergeable !== undefined || branchKeywords.length !== 1) {
        throw new Error(`Cannot publish a flat input schema: the top level has ${unmergeable ?? 'both oneOf and anyOf'}.`);
    }
    const keyword = branchKeywords[0];
    if ('properties' in schema || 'required' in schema || 'additionalProperties' in schema) {
        throw new Error(`Cannot publish a flat input schema: the top level has ${keyword} next to its own properties.`);
    }
    const rawBranches = schema[keyword];
    if (!Array.isArray(rawBranches) || rawBranches.length === 0 || !rawBranches.every(isObject)) {
        throw new Error(`Cannot publish a flat input schema: the top-level ${keyword} is not a list of schemas.`);
    }
    const branches = rawBranches.map((branch) => resolveLocalSchema(branch, schema));
    for (const branch of branches) {
        const unsupported = Object.keys(branch).find((key) => !MERGEABLE_BRANCH_KEYWORDS.has(key));
        if (branch.type !== 'object' || !isObject(branch.properties) || unsupported !== undefined) {
            throw new Error(`Cannot publish a flat input schema: a ${keyword} branch is not a plain object schema${unsupported === undefined ? '' : ` (${unsupported})`}.`);
        }
    }
    const forms = branches.map((branch) => branchForm(branch, schema));
    const names = [...new Set(branches.flatMap((branch) => Object.keys(branch.properties)))];
    const properties = {};
    for (const name of names) {
        const present = branches.flatMap((branch, index) => {
            const property = branch.properties[name];
            return isObject(property) ? [{ property, form: forms[index] }] : [];
        });
        const distinct = new Map(present.map(({ property }) => [stableKey(property), property]));
        let merged = distinct.size === 1 ? [...distinct.values()][0] : mergePropertyVariants([...distinct.values()], schema);
        if (present.length < branches.length) {
            const presentForms = new Set(present.map(({ form }) => form));
            const missingForms = new Set(branches.flatMap((branch, index) => (isObject(branch.properties[name]) ? [] : [forms[index]])));
            if (presentForms.size === 1 && !presentForms.has(undefined) && missingForms.size > 0 && !missingForms.has(undefined) && !missingForms.has([...presentForms][0])) {
                merged = withPropertyNote(merged, [...presentForms][0] === 'apply' ? 'Apply only.' : 'Plan only.', schema);
            }
        }
        properties[name] = merged;
    }
    const requiredLists = branches.map((branch) => (Array.isArray(branch.required) ? branch.required : []));
    const required = requiredLists[0].filter((name) => requiredLists.every((list) => list.includes(name)));
    const flat = {};
    for (const [key, value] of Object.entries(schema)) {
        if (key === keyword) {
            flat.properties = properties;
            if (required.length > 0)
                flat.required = required;
            if (branches.every((branch) => branch.additionalProperties === false))
                flat.additionalProperties = false;
        }
        else
            flat[key] = value;
    }
    return withoutUnreferencedDefinitions(flat);
}
function withoutUnreferencedDefinitions(schema) {
    const tableKeyword = isObject(schema.$defs) ? '$defs' : isObject(schema.definitions) ? 'definitions' : undefined;
    if (tableKeyword === undefined)
        return schema;
    const table = schema[tableKeyword];
    const { [tableKeyword]: _table, ...body } = schema;
    const reachable = new Set();
    const pending = [];
    const visit = (node) => {
        const refs = [];
        collectRefs(node, refs);
        for (const ref of refs) {
            const name = LOCAL_DEFINITION_REF.test(ref) ? ref.slice(ref.lastIndexOf('/') + 1) : undefined;
            if (name !== undefined && !reachable.has(name) && name in table) {
                reachable.add(name);
                pending.push(name);
            }
        }
    };
    visit(body);
    for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
        const definition = table[name];
        if (isObject(definition))
            visit(definition);
    }
    const kept = Object.fromEntries(Object.entries(table).filter(([name]) => reachable.has(name)));
    return Object.keys(kept).length === 0 ? body : { ...body, [tableKeyword]: kept };
}
export function publishToolDefinition(tool) {
    let inputSchema = applyPublishedAs(tool.inputSchema);
    if (hasPublishedDepthMarker(inputSchema))
        inputSchema = truncateJsonSchema(inputSchema, Number.POSITIVE_INFINITY);
    inputSchema = flattenTopLevelComposition(inputSchema);
    const originalInput = deduplicateJsonSchema(inputSchema);
    const compactInput = deduplicateJsonSchema(inputSchema, 0);
    const published = { ...tool, inputSchema: Buffer.byteLength(JSON.stringify(compactInput)) < Buffer.byteLength(JSON.stringify(originalInput))
            ? compactInput : originalInput };
    if (tool.outputSchema !== undefined) {
        let resultShape = publishResultShape(applyPublishedAs(tool.outputSchema), PUBLISHED_DEPTH_KEY);
        if (hasPublishedDepthMarker(resultShape) || resultShape !== tool.outputSchema)
            resultShape = truncateJsonSchema(resultShape, Number.POSITIVE_INFINITY, { scalarItems: true });
        const outputSchema = compactDateTimePatterns(structuredClone(resultShape));
        const originalOutput = withoutDescriptions(deduplicateJsonSchema(outputSchema));
        const compactOutput = deduplicateJsonSchema(withoutDescriptions(structuredClone(outputSchema)), 0);
        published.outputSchema = Buffer.byteLength(JSON.stringify(compactOutput)) < Buffer.byteLength(JSON.stringify(originalOutput))
            ? compactOutput : originalOutput;
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
function isZodSchema(schema) {
    return schema instanceof z.ZodType;
}
function withMemoizedJsonSchema(schema, validateWithHints = false) {
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
            validate: isZodSchema(standard) && validateWithHints
                ? async (value) => {
                    const parsed = await standard.safeParseAsync(value, { error: toolArgumentIssueMessage });
                    return parsed.success ? { value: parsed.data } : { issues: parsed.error.issues };
                }
                : (value) => original.validate(value),
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
            entry = { inputSchema: withMemoizedJsonSchema(config.inputSchema, true), outputSchema: withMemoizedJsonSchema(config.outputSchema) };
            schemas.set(name, entry);
        }
        return register(name, { ...config, inputSchema: entry.inputSchema, outputSchema: entry.outputSchema }, callback);
    });
}
