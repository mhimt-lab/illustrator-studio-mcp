import { z } from 'zod';
import { MIXED_BATCH_MAX_STEPS, MIXED_BATCH_MIN_STEPS, mutateBatchPublicInputSchema, } from './adapters/mutate-batch-adapter.js';
import { canonicalSha256 } from './mutation-canonical.js';
import { pathAppearanceMutationSchema } from './adapters/set-path-appearance-adapter.js';
export const RECIPE_SCHEMA_VERSION = 1;
export const RECIPE_MAX_INPUTS = 32;
export const RECIPE_MIN_STEPS = MIXED_BATCH_MIN_STEPS;
export const RECIPE_MAX_STEPS = MIXED_BATCH_MAX_STEPS;
export const RECIPE_STEP_OPERATIONS = ['replace_point_text', 'set_text_style', 'transform_object', 'set_path_appearance'];
export const RECIPE_INPUT_TYPES = ['string', 'number'];
export const recipeIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/u, 'recipe_id must be lowercase [a-z0-9_-], at most 64 characters, and start with a letter.');
export const recipeVersionSchema = z.number().int().min(1).max(1_000_000);
const inputNameSchema = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/u, 'Input names are lowercase [a-z0-9_], at most 32 characters, and start with a letter.');
const TEMPLATE_OPEN = '{{';
const TEMPLATE_REFERENCE = /^\{\{\s*inputs\.([a-z][a-z0-9_]{0,31})\s*\}\}/u;
const MAX_TEMPLATE_LENGTH = 4_000;
export function parseTemplate(text) {
    const parts = [];
    let cursor = 0;
    for (;;) {
        const open = text.indexOf(TEMPLATE_OPEN, cursor);
        if (open === -1)
            break;
        if (open > cursor)
            parts.push({ kind: 'literal', value: text.slice(cursor, open) });
        const match = TEMPLATE_REFERENCE.exec(text.slice(open));
        if (match === null) {
            throw new Error(`Unsupported template at offset ${open}: only {{inputs.<name>}} substitution is allowed.`);
        }
        parts.push({ kind: 'reference', value: match[1] });
        cursor = open + match[0].length;
    }
    if (cursor < text.length)
        parts.push({ kind: 'literal', value: text.slice(cursor) });
    return parts;
}
function isWholeReference(parts) {
    return parts.length === 1 && parts[0].kind === 'reference';
}
const templateStringSchema = z.string().min(1).max(MAX_TEMPLATE_LENGTH).superRefine((text, context) => {
    try {
        parseTemplate(text);
    }
    catch (error) {
        context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) });
    }
});
const referenceOnlySchema = z.string().max(MAX_TEMPLATE_LENGTH).superRefine((text, context) => {
    let parts;
    try {
        parts = parseTemplate(text);
    }
    catch (error) {
        context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) });
        return;
    }
    if (!isWholeReference(parts)) {
        context.addIssue({ code: 'custom', message: 'A numeric slot accepts a number or exactly one {{inputs.<name>}} reference.' });
    }
});
const numberOrReferenceSchema = z.union([z.number().finite(), referenceOnlySchema]);
const nonnegativeIntegerOrReferenceSchema = z.union([z.number().int().safe().nonnegative(), referenceOnlySchema]);
const inputSpecCommon = {
    description: z.string().max(500).optional(),
    required: z.boolean().optional(),
};
export const recipeInputSpecSchema = z.discriminatedUnion('type', [
    z.strictObject({ ...inputSpecCommon, type: z.literal('string'), default: z.string().max(MAX_TEMPLATE_LENGTH).optional() }),
    z.strictObject({ ...inputSpecCommon, type: z.literal('number'), default: z.number().finite().optional() }),
]).superRefine((spec, context) => {
    if (spec.required === true && spec.default !== undefined) {
        context.addIssue({ code: 'custom', message: 'A required input cannot also declare a default.' });
    }
    if (spec.required === false && spec.default === undefined) {
        context.addIssue({ code: 'custom', message: 'An optional input must declare a default.' });
    }
});
const stepCommon = { target_uuid: templateStringSchema };
export const recipeStepSchema = z.discriminatedUnion('operation', [
    z.strictObject({ ...stepCommon, operation: z.literal('replace_point_text'), replacement: templateStringSchema }),
    z.strictObject({
        ...stepCommon,
        operation: z.literal('set_text_style'),
        start: nonnegativeIntegerOrReferenceSchema,
        end: nonnegativeIntegerOrReferenceSchema,
        style: z.union([
            z.strictObject({ size: numberOrReferenceSchema }),
            z.strictObject({ fill_color: z.strictObject({ red: numberOrReferenceSchema, green: numberOrReferenceSchema, blue: numberOrReferenceSchema }) }),
        ]),
    }),
    z.strictObject({
        ...stepCommon,
        operation: z.literal('transform_object'),
        transform: z.strictObject({
            type: z.literal('translate'),
            delta_x: numberOrReferenceSchema,
            delta_y: numberOrReferenceSchema,
        }),
    }),
    z.strictObject({ ...stepCommon, operation: z.literal('set_path_appearance'), appearance: pathAppearanceMutationSchema }),
]);
function stepSlots(step) {
    const slots = [
        { path: 'target_uuid', value: step.target_uuid, expects: 'string' },
    ];
    if (step.operation === 'replace_point_text') {
        slots.push({ path: 'replacement', value: step.replacement, expects: 'string' });
    }
    else if (step.operation === 'set_text_style') {
        slots.push({ path: 'start', value: step.start, expects: 'number' });
        slots.push({ path: 'end', value: step.end, expects: 'number' });
        if ('size' in step.style)
            slots.push({ path: 'style.size', value: step.style.size, expects: 'number' });
        else {
            slots.push({ path: 'style.fill_color.red', value: step.style.fill_color.red, expects: 'number' });
            slots.push({ path: 'style.fill_color.green', value: step.style.fill_color.green, expects: 'number' });
            slots.push({ path: 'style.fill_color.blue', value: step.style.fill_color.blue, expects: 'number' });
        }
    }
    else if (step.operation === 'transform_object') {
        slots.push({ path: 'transform.delta_x', value: step.transform.delta_x, expects: 'number' });
        slots.push({ path: 'transform.delta_y', value: step.transform.delta_y, expects: 'number' });
    }
    return slots;
}
export const recipeDefinitionSchema = z.strictObject({
    schema_version: z.literal(RECIPE_SCHEMA_VERSION),
    recipe_id: recipeIdSchema,
    recipe_version: recipeVersionSchema,
    description: z.string().max(500).optional(),
    inputs: z.record(inputNameSchema, recipeInputSpecSchema).refine((inputs) => Object.keys(inputs).length <= RECIPE_MAX_INPUTS, { message: `A recipe declares at most ${RECIPE_MAX_INPUTS} inputs.` }),
    steps: z.array(recipeStepSchema).min(RECIPE_MIN_STEPS).max(RECIPE_MAX_STEPS),
}).superRefine((recipe, context) => {
    recipe.steps.forEach((step, index) => {
        for (const slot of stepSlots(step)) {
            if (typeof slot.value !== 'string')
                continue;
            let parts;
            try {
                parts = parseTemplate(slot.value);
            }
            catch (_error) {
                continue;
            }
            for (const part of parts) {
                if (part.kind !== 'reference')
                    continue;
                const spec = Object.hasOwn(recipe.inputs, part.value) ? recipe.inputs[part.value] : undefined;
                if (spec === undefined) {
                    context.addIssue({ code: 'custom', path: ['steps', index, ...slot.path.split('.')],
                        message: `Step ${index + 1} references undeclared input "${part.value}".` });
                    continue;
                }
                if (spec.type !== slot.expects) {
                    context.addIssue({ code: 'custom', path: ['steps', index, ...slot.path.split('.')],
                        message: `Step ${index + 1} binds input "${part.value}" (${spec.type}) into a ${slot.expects} slot.` });
                }
            }
        }
    });
});
export function canonicalRecipeDefinition(value) {
    const recipe = recipeDefinitionSchema.parse(value);
    const inputs = {};
    for (const name of Object.keys(recipe.inputs).sort()) {
        const spec = recipe.inputs[name];
        inputs[name] = { ...spec, required: spec.required ?? spec.default === undefined };
    }
    return { ...recipe, inputs };
}
export function recipeHash(recipe) {
    return canonicalSha256(recipe);
}
export class RecipeBindingError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'RecipeBindingError';
    }
}
export const recipeInputValuesSchema = z.record(inputNameSchema, z.union([z.string().max(MAX_TEMPLATE_LENGTH), z.number().finite()]));
export function bindRecipeInputs(recipe, values) {
    for (const name of Object.keys(values)) {
        if (!Object.hasOwn(recipe.inputs, name))
            throw new RecipeBindingError('RECIPE_INPUT_UNKNOWN', `Input "${name}" is not declared by the recipe.`);
    }
    const bound = {};
    for (const name of Object.keys(recipe.inputs).sort()) {
        const spec = recipe.inputs[name];
        const provided = Object.hasOwn(values, name) ? values[name] : undefined;
        if (provided === undefined) {
            if (spec.default === undefined)
                throw new RecipeBindingError('RECIPE_INPUT_MISSING', `Input "${name}" is required.`);
            bound[name] = spec.default;
            continue;
        }
        if (typeof provided !== spec.type || (typeof provided === 'number' && !Number.isFinite(provided))) {
            throw new RecipeBindingError('RECIPE_INPUT_TYPE_MISMATCH', `Input "${name}" must be a ${spec.type}.`);
        }
        bound[name] = provided;
    }
    return bound;
}
function substituteString(template, bound) {
    return parseTemplate(template).map((part) => {
        if (part.kind === 'literal')
            return part.value;
        const value = bound[part.value];
        if (typeof value !== 'string')
            throw new RecipeBindingError('RECIPE_INPUT_TYPE_MISMATCH', `Input "${part.value}" must be a string here.`);
        return value;
    }).join('');
}
function substituteNumber(slot, bound) {
    if (typeof slot === 'number')
        return slot;
    const parts = parseTemplate(slot);
    if (!isWholeReference(parts))
        throw new RecipeBindingError('RECIPE_BATCH_REJECTED', 'A numeric slot must be one reference.');
    const value = bound[parts[0].value];
    if (typeof value !== 'number')
        throw new RecipeBindingError('RECIPE_INPUT_TYPE_MISMATCH', `Input "${parts[0].value}" must be a number here.`);
    return value;
}
export function buildRecipeBatchPlanRequest(recipe, bound, expectedDocumentKey) {
    const steps = recipe.steps.map((step) => {
        const targetUuid = substituteString(step.target_uuid, bound);
        if (step.operation === 'replace_point_text') {
            return { operation: step.operation, target_uuid: targetUuid, replacement: substituteString(step.replacement, bound) };
        }
        if (step.operation === 'set_text_style') {
            const style = 'size' in step.style
                ? { size: substituteNumber(step.style.size, bound) }
                : { fill_color: { red: substituteNumber(step.style.fill_color.red, bound),
                        green: substituteNumber(step.style.fill_color.green, bound), blue: substituteNumber(step.style.fill_color.blue, bound) } };
            return { operation: step.operation, target_uuid: targetUuid, start: substituteNumber(step.start, bound),
                end: substituteNumber(step.end, bound), style };
        }
        if (step.operation === 'transform_object')
            return { operation: step.operation, target_uuid: targetUuid,
                transform: { type: 'translate', delta_x: substituteNumber(step.transform.delta_x, bound),
                    delta_y: substituteNumber(step.transform.delta_y, bound) } };
        return { operation: step.operation, target_uuid: targetUuid, appearance: step.appearance };
    });
    const parsed = mutateBatchPublicInputSchema.safeParse({ expected_document_key: expectedDocumentKey, steps, apply: false });
    if (!parsed.success) {
        throw new RecipeBindingError('RECIPE_BATCH_REJECTED', `Bound steps are not a valid mutate_batch plan: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
    }
    if (parsed.data.apply !== false)
        throw new RecipeBindingError('RECIPE_BATCH_REJECTED', 'Recipe binding must produce a plan-only request.');
    return parsed.data;
}
export function validateRecipeBindsStructurally(recipe) {
    const placeholders = {};
    for (const [name, spec] of Object.entries(recipe.inputs)) {
        if (spec.default !== undefined)
            continue;
        placeholders[name] = spec.type === 'string' ? `placeholder:${name}` : 1;
    }
    return buildRecipeBatchPlanRequest(recipe, bindRecipeInputs(recipe, placeholders), 'placeholder-document-key');
}
