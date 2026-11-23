import { createCreateLayerAdapter } from '../adapters/create-layer-adapter.js';
export const WINDOWS_CREATE_LAYER_NAMES_REFUSAL = 'illustrator_create_layer: names is not available on Windows yet (#956: creating several layers in one call is not measured there). Create the layers one at a time with name. Nothing was changed.';
export const WINDOWS_CREATE_LAYER_NAMES_NOTE = ' On Windows, names (several layers in one call) is refused before any change because it is not measured there yet; create the layers one at a time with name.';
function refuseNames(input) {
    if (typeof input === 'object' && input !== null && Object.hasOwn(input, 'names') && input.names !== undefined) {
        throw new Error(WINDOWS_CREATE_LAYER_NAMES_REFUSAL);
    }
}
export function createWindowsCreateLayerAdapter() {
    const base = createCreateLayerAdapter();
    return {
        ...base,
        tool: { ...base.tool,
            normalizePublicInput(input) { refuseNames(input); return base.tool.normalizePublicInput(input); } },
        canonical: { ...base.canonical,
            normalize(input) { refuseNames(input); return base.canonical.normalize(input); },
            safetyDigest(input) { refuseNames(input); return base.canonical.safetyDigest(input); } },
        admit: async (input, services) => { refuseNames(input); return await base.admit(input, services); },
        buildCommand(input) { refuseNames(input); return base.buildCommand(input); },
    };
}
