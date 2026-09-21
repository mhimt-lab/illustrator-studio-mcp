import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicCreatePrivateRecord, PRIVATE_RECORD_LIMITS, readSecurePrivateRecord, } from './private-record.js';
import { ensurePrivateDirectory, isMissingPath, validatePrivateDirectory, withPrivateDirectoryScope, } from './private-state.js';
import { canonicalRecipeDefinition, recipeHash, recipeIdSchema, recipeVersionSchema, } from './recipe-schema.js';
export const RECIPE_RECORD_VERSION = 1;
const RECIPES_DIRECTORY = 'recipes';
const MAX_RECIPE_RECORD_BYTES = PRIVATE_RECORD_LIMITS.result;
const RECORD_FILE_NAME = /^([a-z][a-z0-9_-]{0,63})@([1-9][0-9]{0,6})\.json$/u;
function codedError(message, code) {
    return Object.assign(new Error(message), { code });
}
function hasCode(error, code) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
export function recipeRecordFileName(recipeId, recipeVersion) {
    recipeIdSchema.parse(recipeId);
    recipeVersionSchema.parse(recipeVersion);
    return `${recipeId}@${recipeVersion}.json`;
}
function parseStoredRecord(text, expected) {
    let value;
    try {
        value = JSON.parse(text);
    }
    catch (_error) {
        return { reason: 'invalid_record_json' };
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return { reason: 'invalid_record_shape' };
    const record = value;
    if (Object.keys(record).sort().join(',') !== 'recipe,recipe_hash,record_version' ||
        record.record_version !== RECIPE_RECORD_VERSION || typeof record.recipe_hash !== 'string') {
        return { reason: 'invalid_record_shape' };
    }
    let recipe;
    try {
        recipe = canonicalRecipeDefinition(record.recipe);
    }
    catch (_error) {
        return { reason: 'invalid_recipe_definition' };
    }
    if (recipeHash(recipe) !== record.recipe_hash)
        return { reason: 'recipe_hash_mismatch' };
    if (recipe.recipe_id !== expected.recipeId || recipe.recipe_version !== expected.recipeVersion)
        return { reason: 'record_name_mismatch' };
    return { record_version: RECIPE_RECORD_VERSION, recipe_hash: record.recipe_hash, recipe };
}
export class RecipeStore {
    root;
    recipesRoot;
    constructor(root) {
        this.root = root;
        this.recipesRoot = join(root, RECIPES_DIRECTORY);
    }
    async initialize() {
        await ensurePrivateDirectory(this.root, 'state root');
        await ensurePrivateDirectory(this.recipesRoot, 'recipes directory');
    }
    recipePath(recipeId, recipeVersion) {
        return join(this.recipesRoot, recipeRecordFileName(recipeId, recipeVersion));
    }
    async save(definition) {
        const recipe = canonicalRecipeDefinition(definition);
        const hash = recipeHash(recipe);
        const record = { record_version: RECIPE_RECORD_VERSION, recipe_hash: hash, recipe };
        const text = JSON.stringify(record);
        if (Buffer.byteLength(text, 'utf8') > MAX_RECIPE_RECORD_BYTES) {
            throw codedError(`Recipe record exceeds ${MAX_RECIPE_RECORD_BYTES} bytes.`, 'RECIPE_RECORD_OVERSIZE');
        }
        await this.initialize();
        const path = this.recipePath(recipe.recipe_id, recipe.recipe_version);
        try {
            await this.withScope(async (scope) => {
                await atomicCreatePrivateRecord(path, text, { scope });
            });
            return { created: true, recipeHash: hash, path, recipe };
        }
        catch (error) {
            if (!hasCode(error, 'EEXIST'))
                throw error;
        }
        const existing = await this.get(recipe.recipe_id, recipe.recipe_version);
        if (existing.state !== 'valid') {
            throw codedError(`Recipe ${recipe.recipe_id}@${recipe.recipe_version} exists but is not a valid record (${existing.state === 'invalid' ? existing.reason : 'missing'}).`, 'RECIPE_STORE_INDETERMINATE');
        }
        if (existing.record.recipe_hash !== hash) {
            throw codedError(`Recipe ${recipe.recipe_id}@${recipe.recipe_version} already exists with a different content hash; bump recipe_version instead of overwriting.`, 'RECIPE_CONFLICT');
        }
        return { created: false, recipeHash: hash, path, recipe: existing.record.recipe };
    }
    async get(recipeId, recipeVersion) {
        const path = this.recipePath(recipeId, recipeVersion);
        try {
            await validatePrivateDirectory(this.root, 0o700, 'state root');
            await validatePrivateDirectory(this.recipesRoot, 0o700, 'recipes directory');
        }
        catch (error) {
            if (isMissingPath(error))
                return { state: 'missing' };
            return { state: 'invalid', reason: 'unsafe_recipes_root' };
        }
        return await this.withScope(async (scope) => await this.readOne(path, { recipeId, recipeVersion }, scope));
    }
    async list() {
        try {
            await validatePrivateDirectory(this.root, 0o700, 'state root');
            await validatePrivateDirectory(this.recipesRoot, 0o700, 'recipes directory');
        }
        catch (error) {
            if (isMissingPath(error))
                return { recipes: [], invalid_entries: [] };
            throw error;
        }
        return await this.withScope(async (scope) => {
            const listing = { recipes: [], invalid_entries: [] };
            for (const name of (await readdir(this.recipesRoot)).sort()) {
                const match = RECORD_FILE_NAME.exec(name);
                if (match === null) {
                    listing.invalid_entries.push({ name, reason: 'unexpected_entry' });
                    continue;
                }
                const stored = await this.readOne(join(this.recipesRoot, name), { recipeId: match[1], recipeVersion: Number(match[2]) }, scope);
                if (stored.state !== 'valid') {
                    listing.invalid_entries.push({ name, reason: stored.state === 'invalid' ? stored.reason : 'missing' });
                    continue;
                }
                const recipe = stored.record.recipe;
                listing.recipes.push({
                    recipe_id: recipe.recipe_id, recipe_version: recipe.recipe_version, recipe_hash: stored.record.recipe_hash,
                    ...(recipe.description === undefined ? {} : { description: recipe.description }),
                    input_names: Object.keys(recipe.inputs), step_count: recipe.steps.length,
                });
            }
            return listing;
        });
    }
    async readOne(path, expected, scope) {
        const raw = await readSecurePrivateRecord(path, MAX_RECIPE_RECORD_BYTES, { scope });
        if (raw.state === 'missing')
            return { state: 'missing' };
        if (raw.state === 'invalid')
            return { state: 'invalid', reason: `unsafe_record_${raw.reason}` };
        const parsed = parseStoredRecord(raw.text, expected);
        if ('reason' in parsed)
            return { state: 'invalid', reason: parsed.reason };
        return { state: 'valid', record: parsed, path };
    }
    async withScope(operation) {
        return await withPrivateDirectoryScope([
            { path: this.root, description: 'state root' },
            { path: this.recipesRoot, description: 'recipes directory' },
        ], operation);
    }
}
