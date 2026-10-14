import { CREATE_RECTANGLE_ADAPTER_IDENTITY } from '../adapters/create-rectangle-adapter.js';
export const WINDOWS_CANDIDATE_MUTATIONS_ENV = 'ILLUSTRATOR_STUDIO_MCP_WINDOWS_CANDIDATE_MUTATIONS';
const CANDIDATES = Object.freeze({
    create_rectangle: Object.freeze({ tool: 'illustrator_create_rectangle', adapterIdentity: CREATE_RECTANGLE_ADAPTER_IDENTITY }),
});
export const WINDOWS_NO_CANDIDATE_MUTATIONS = Object.freeze({
    operations: Object.freeze([]), tools: new Set(), adapterIdentities: Object.freeze([]),
});
export function parseWindowsCandidateMutations(env) {
    const raw = env[WINDOWS_CANDIDATE_MUTATIONS_ENV]?.trim();
    if (!raw)
        return WINDOWS_NO_CANDIDATE_MUTATIONS;
    const operations = [...new Set(raw.split(',').map((name) => name.trim()))];
    for (const name of operations) {
        if (!Object.hasOwn(CANDIDATES, name)) {
            throw new Error(`${WINDOWS_CANDIDATE_MUTATIONS_ENV} names unknown candidate "${name}"; allowed: ${Object.keys(CANDIDATES).join(', ')}.`);
        }
    }
    const chosen = operations.map((name) => CANDIDATES[name]);
    return Object.freeze({
        operations: Object.freeze(operations), tools: new Set(chosen.map((entry) => entry.tool)),
        adapterIdentities: Object.freeze(chosen.map((entry) => entry.adapterIdentity)),
    });
}
