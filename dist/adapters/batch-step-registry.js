import { replacePointTextBatchStep } from './replace-point-text-adapter.js';
import { applyCharacterStyleBatchStep } from './batch-charstyle.js';
import { setLayerStateBatchStep } from './batch-layer-state.js';
import { moveObjectToLayerBatchStep } from './batch-move.js';
import { setObjectStateBatchStep } from './set-object-state-adapter.js';
import { setPathAppearanceBatchStep } from './set-path-appearance-adapter.js';
import { setTextStyleBatchStep } from './set-text-style-adapter.js';
import { transformObjectBatchStep } from './transform-object-adapter.js';
export const BATCH_STEPS = Object.freeze({
    replace_point_text: replacePointTextBatchStep,
    set_text_style: setTextStyleBatchStep,
    transform_object: transformObjectBatchStep,
    set_path_appearance: setPathAppearanceBatchStep,
    set_object_state: setObjectStateBatchStep,
    set_layer_state: setLayerStateBatchStep,
    move_object_to_layer: moveObjectToLayerBatchStep,
    apply_character_style: applyCharacterStyleBatchStep,
});
export const BATCH_STEP_REGISTRY = Object.freeze(Object.values(BATCH_STEPS));
const byOperation = new Map();
for (const [key, step] of Object.entries(BATCH_STEPS)) {
    if (key !== step.operation)
        throw new Error(`Batch step registered as ${key} discriminates on ${step.operation}.`);
}
for (const step of BATCH_STEP_REGISTRY) {
    if (byOperation.has(step.operation))
        throw new Error(`Duplicate batch step: ${step.operation}.`);
    byOperation.set(step.operation, step);
}
export function registeredBatchStep(operation) {
    return byOperation.get(operation);
}
export function requireBatchStep(operation) {
    const step = byOperation.get(operation);
    if (step === undefined)
        throw new Error(`Batch step ${operation} is not registered.`);
    return step;
}
