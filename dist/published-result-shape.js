export const OUTCOME_PUBLISHED_FIELDS = {
    scalars: true,
    fields: {
        document: { fields: { key: true, keyShort: true, saved: true } },
        plan: { fields: { operation: true, noOp: true, applyAllowed: true, applyBlockedReasonCodes: true, confirmationStatus: true } },
        postcondition: { fields: { saved: true } },
        transaction: { fields: { state: true, failure: { fields: { reasonCode: true } }, rollback: { fields: { status: true } } } },
        created: { scalars: true },
    },
};
export const COMPLETE_RESULT_DEPTH = 64;
export const RESULT_PUBLISHED_DEPTH = 2;
const SCALAR_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null']);
const LOCAL_REF = /^#\/(?:\$defs|definitions)\/([^/~]+)$/;
function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function makeResolver(root) {
    const table = (isObject(root.$defs) ? root.$defs : isObject(root.definitions) ? root.definitions : {});
    return (node) => {
        const seen = new Set();
        let current = node;
        while (typeof current.$ref === 'string') {
            const match = LOCAL_REF.exec(current.$ref);
            if (match === null || seen.has(match[1]))
                return undefined;
            seen.add(match[1]);
            const next = table[match[1]];
            if (!isObject(next))
                return undefined;
            current = next;
        }
        return current;
    };
}
function isScalarSchema(node, resolve) {
    const resolved = resolve(node);
    if (resolved === undefined)
        return false;
    const alternatives = (resolved.anyOf ?? resolved.oneOf);
    if (Array.isArray(alternatives))
        return alternatives.every((alternative) => isObject(alternative) && isScalarSchema(alternative, resolve));
    if (resolved.const !== undefined || Array.isArray(resolved.enum))
        return true;
    return typeof resolved.type === 'string' && SCALAR_TYPES.has(resolved.type);
}
function objectBranches(node, resolve) {
    const resolved = resolve(node);
    if (resolved === undefined)
        return null;
    const alternatives = (resolved.anyOf ?? resolved.oneOf);
    if (Array.isArray(alternatives)) {
        if (resolved.type !== undefined && resolved.type !== 'object')
            return null;
        const branches = [];
        for (const alternative of alternatives) {
            if (!isObject(alternative))
                return null;
            const nested = objectBranches(alternative, resolve);
            if (nested === null)
                return null;
            branches.push(...nested);
        }
        return branches;
    }
    if (resolved.type !== 'object' || !isObject(resolved.properties))
        return null;
    return [resolved];
}
function sameJson(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}
function plainValues(schema) {
    const keys = Object.keys(schema);
    if (keys.length !== 2 || typeof schema.type !== 'string')
        return null;
    if ('const' in schema)
        return { type: schema.type, values: [schema.const] };
    if (Array.isArray(schema.enum))
        return { type: schema.type, values: schema.enum };
    return null;
}
function mergeAlternatives(schemas) {
    const unique = [];
    for (const schema of schemas)
        if (!unique.some((existing) => sameJson(existing, schema)))
            unique.push(schema);
    const plain = unique.map(plainValues);
    const first = plain[0];
    if (unique.length > 1 && first !== null && first !== undefined && plain.every((entry) => entry !== null && entry.type === first.type)) {
        const values = [];
        for (const entry of plain)
            for (const value of entry.values)
                if (!values.some((existing) => sameJson(existing, value)))
                    values.push(value);
        return { type: first.type, enum: values };
    }
    if (unique.length === 1)
        return unique[0];
    return { anyOf: unique };
}
export function publishFields(node, fields, root) {
    if (fields === true)
        return node;
    const resolve = makeResolver(root);
    const shallow = (current, selection) => {
        const branches = objectBranches(current, resolve);
        if (branches === null || branches.length === 0)
            return current;
        const names = new Set(branches.flatMap((branch) => Object.keys(branch.properties)));
        const properties = {};
        for (const name of names) {
            const declaring = branches.filter((branch) => name in branch.properties);
            if (declaring.length !== branches.length && branches.some((branch) => !(name in branch.properties) && branch.additionalProperties !== false))
                continue;
            const schemas = declaring.map((branch) => branch.properties[name]).filter(isObject);
            const named = selection.fields?.[name];
            const scalar = selection.scalars === true && schemas.every((schema) => isScalarSchema(schema, resolve));
            const chosen = named ?? (scalar ? true : undefined);
            if (chosen === undefined)
                continue;
            if (chosen === true) {
                properties[name] = mergeAlternatives(schemas);
                continue;
            }
            const united = shallow({ anyOf: schemas }, chosen);
            properties[name] = united.anyOf === undefined ? united : mergeAlternatives(schemas.map((schema) => shallow(schema, chosen)));
        }
        const required = branches
            .map((branch) => new Set(Array.isArray(branch.required) ? branch.required : []))
            .reduce((common, next) => new Set([...common].filter((name) => next.has(name))));
        const result = { type: 'object' };
        if (Object.keys(properties).length > 0) {
            result.properties = properties;
            const requiredNames = [...required].filter((name) => name in properties);
            if (requiredNames.length > 0)
                result.required = requiredNames;
        }
        return result;
    };
    return shallow(node, fields);
}
function publishOutcomes(node, root, resolve) {
    const resolved = resolve(node);
    if (resolved === undefined)
        return undefined;
    const alternatives = (resolved.anyOf ?? resolved.oneOf);
    if (Array.isArray(alternatives)) {
        let changed = false;
        const published = alternatives.map((alternative) => {
            const next = isObject(alternative) ? publishOutcomes(alternative, root, resolve) : undefined;
            if (next === undefined)
                return alternative;
            changed = true;
            return next;
        });
        if (!changed)
            return undefined;
        const keyword = resolved.anyOf === undefined ? 'oneOf' : 'anyOf';
        return { ...structuredClone(resolved), [keyword]: published };
    }
    const properties = resolved.properties;
    if (!isObject(properties) || !isObject(properties.outcome))
        return undefined;
    const outcome = publishFields(properties.outcome, OUTCOME_PUBLISHED_FIELDS, root);
    if (outcome === properties.outcome)
        return undefined;
    const copy = structuredClone(resolved);
    copy.properties.outcome = outcome;
    return copy;
}
export function publishResultShape(output, depthKey) {
    const properties = output.properties;
    if (!isObject(properties) || !isObject(properties.result))
        return output;
    const resolve = makeResolver(output);
    const result = resolve(properties.result);
    if (result === undefined)
        return output;
    const copy = structuredClone(output);
    if (result[depthKey] !== undefined)
        return output;
    const published = publishOutcomes(result, output, resolve) ?? { ...structuredClone(result), [depthKey]: RESULT_PUBLISHED_DEPTH };
    copy.properties.result = published;
    return copy;
}
