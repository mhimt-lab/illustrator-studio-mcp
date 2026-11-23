import { createCanonicalMutationOperationRegistry } from '../default-mutation-operation-adapters.js';
import { createReplaceAreaTextRangeAdapter } from '../adapters/replace-area-text-range-adapter.js';
import { createMutateBatchAdapter } from '../adapters/mutate-batch-adapter.js';
import { createDuplicateObjectAdapter } from '../adapters/duplicate-object-adapter.js';
import { createWindowsPlaceImageAdapter } from './place-image.js';
import { createWindowsRelinkImageAdapter } from './relink-image.js';
import { createWindowsSetStrokeStyleAdapter } from './set-stroke-style.js';
import { createWindowsCreateLayerAdapter } from './create-layer.js';
import { createWindowsDuplicateObjectAdapter } from './duplicate-object.js';
function withoutHostVersionPolicy(adapter) {
    const { hostVersionOperation: _policyRow, ...withoutRow } = adapter;
    return withoutRow;
}
export function createWindowsMutationOperationRegistry(options = {}) {
    return createCanonicalMutationOperationRegistry({
        duplicateObject: () => options.duplicateColourProfile ? createWindowsDuplicateObjectAdapter(options) : withoutHostVersionPolicy(createDuplicateObjectAdapter()),
        replaceAreaTextRange: () => withoutHostVersionPolicy(createReplaceAreaTextRangeAdapter()),
        mutateBatch: () => withoutHostVersionPolicy(createMutateBatchAdapter()),
        createLayer: () => createWindowsCreateLayerAdapter(),
        placeImage: () => createWindowsPlaceImageAdapter(options),
        relinkImage: () => createWindowsRelinkImageAdapter(options),
        setStrokeStyle: () => createWindowsSetStrokeStyleAdapter(options),
    });
}
