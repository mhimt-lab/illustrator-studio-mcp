import { createUpdateArtboardAdapter } from './adapters/update-artboard-adapter.js';
import { createDuplicateArtboardAdapter } from './adapters/duplicate-artboard-adapter.js';
import { createInsertVerticalSpaceAdapter } from './adapters/insert-vertical-space-adapter.js';
import { createScaleArtworkAdapter } from './adapters/scale-artwork-adapter.js';
import { createApplyDatasetAdapter } from './adapters/apply-dataset-adapter.js';
import { createBindVariableAdapter } from './adapters/bind-variable-adapter.js';
import { createCreateDatasetAdapter } from './adapters/create-dataset-adapter.js';
import { createUpdateDatasetAdapter } from './adapters/update-dataset-adapter.js';
import { MutationOperationAdapterRegistry } from './mutation-operation-adapter.js';
import { createRectangleAdapter } from './adapters/create-rectangle-adapter.js';
import { createSetPathAppearanceAdapter } from './adapters/set-path-appearance-adapter.js';
import { createSwatchResourceAdapter } from './adapters/create-swatch-resource-adapter.js';
import { createTransformObjectAdapter } from './adapters/transform-object-adapter.js';
import { createDuplicateObjectAdapter } from './adapters/duplicate-object-adapter.js';
import { createGroupObjectsAdapter } from './adapters/group-objects-adapter.js';
import { createMoveObjectToLayerAdapter } from './adapters/move-object-to-layer-adapter.js';
import { createReplacePointTextAdapter } from './adapters/replace-point-text-adapter.js';
import { createReplacePointTextBatchAdapter } from './adapters/replace-point-text-batch-adapter.js';
import { createMutateBatchAdapter } from './adapters/mutate-batch-adapter.js';
import { createCreateBatchAdapter } from './adapters/create-batch-adapter.js';
import { createShapeAdapter } from './adapters/create-shape-adapter.js';
import { createAlignObjectsAdapter } from './adapters/align-objects-adapter.js';
import { createSetStackingOrderAdapter } from './adapters/set-stacking-order-adapter.js';
import { createPointTextAdapter } from './adapters/create-point-text-adapter.js';
import { createAreaTextAdapter } from './adapters/create-area-text-adapter.js';
import { createReplaceAreaTextRangeAdapter } from './adapters/replace-area-text-range-adapter.js';
import { createReplaceTextRangeAdapter } from './adapters/replace-text-range-adapter.js';
import { createSetTextStyleAdapter } from './adapters/set-text-style-adapter.js';
import { createSetTextOrientationAdapter } from './adapters/set-text-orientation-adapter.js';
import { createSetNoBreakAdapter } from './adapters/set-no-break-adapter.js';
import { createApplyCharacterStyleAdapter } from './adapters/apply-character-style-adapter.js';
import { createCharacterStyleAdapter } from './adapters/create-character-style-adapter.js';
import { createUpdateCharacterStyleAdapter } from './adapters/update-character-style-adapter.js';
import { createReplaceFontAdapter } from './adapters/replace-font-adapter.js';
import { createPlaceImageAdapter } from './adapters/place-image-adapter.js';
import { createRelinkImageAdapter } from './adapters/relink-image-adapter.js';
import { createEmbedImageAdapter } from './adapters/embed-image-adapter.js';
import { createSetObjectStateAdapter } from './adapters/set-object-state-adapter.js';
import { createCreateLayerAdapter } from './adapters/create-layer-adapter.js';
import { createCreateBarcodeAdapter } from './adapters/create-barcode-adapter.js';
import { createCreateTrimMarksAdapter } from './adapters/create-trim-marks-adapter.js';
import { createCreateQrCodeAdapter } from './adapters/create-qr-code-adapter.js';
import { createSetLayerStateAdapter } from './adapters/set-layer-state-adapter.js';
import { createReorderLayerAdapter } from './adapters/reorder-layer-adapter.js';
import { createEditPathPointsAdapter } from './adapters/edit-path-points-adapter.js';
import { createTransformPathAnchorsAdapter } from './adapters/transform-path-anchors-adapter.js';
import { createCreateClippingMaskAdapter } from './adapters/create-clipping-mask-adapter.js';
import { createReleaseClippingMaskAdapter } from './adapters/release-clipping-mask-adapter.js';
import { createMakeCompoundPathAdapter } from './adapters/make-compound-path-adapter.js';
import { createSetAreaTextColumnsAdapter } from './adapters/set-area-text-columns-adapter.js';
import { createApplyPathfinderAdapter } from './adapters/apply-pathfinder-adapter.js';
import { createDeleteObjectsAdapter } from './adapters/delete-objects-adapter.js';
import { createImportVectorArtworkAdapter } from './adapters/import-vector-artwork-adapter.js';
import { createNormalizeStrokeWidthsAdapter } from './adapters/normalize-stroke-widths-adapter.js';
import { createReplaceRgbBlackAdapter } from './adapters/replace-rgb-black-adapter.js';
import { createSetStrokeStyleAdapter } from './adapters/set-stroke-style-adapter.js';
import { createSetTextCompositionAdapter } from './adapters/set-text-composition-adapter.js';
export function createCanonicalMutationOperationRegistry(variants = {}) {
    return new MutationOperationAdapterRegistry()
        .register(createUpdateArtboardAdapter())
        .register(createRectangleAdapter())
        .register(createSwatchResourceAdapter())
        .register(createSetPathAppearanceAdapter())
        .register(createNormalizeStrokeWidthsAdapter())
        .register(createReplaceRgbBlackAdapter())
        .register(createTransformObjectAdapter())
        .register(variants.duplicateObject?.() ?? createDuplicateObjectAdapter())
        .register(createGroupObjectsAdapter())
        .register(createMoveObjectToLayerAdapter())
        .register(createReplacePointTextAdapter())
        .register(createPointTextAdapter())
        .register(createAreaTextAdapter())
        .register(createReplaceTextRangeAdapter())
        .register((variants.replaceAreaTextRange ?? createReplaceAreaTextRangeAdapter)())
        .register(createSetTextStyleAdapter())
        .register(createSetTextOrientationAdapter())
        .register(createSetNoBreakAdapter())
        .register(createApplyCharacterStyleAdapter())
        .register(createCharacterStyleAdapter())
        .register(createUpdateCharacterStyleAdapter())
        .register(createReplaceFontAdapter())
        .register(createReplacePointTextBatchAdapter())
        .register((variants.mutateBatch ?? createMutateBatchAdapter)())
        .register(createCreateBatchAdapter())
        .register(createShapeAdapter())
        .register(createAlignObjectsAdapter())
        .register(createSetStackingOrderAdapter())
        .register((variants.placeImage ?? createPlaceImageAdapter)())
        .register((variants.relinkImage ?? createRelinkImageAdapter)())
        .register(createEmbedImageAdapter())
        .register(createSetObjectStateAdapter())
        .register(variants.createLayer?.() ?? createCreateLayerAdapter())
        .register(createSetLayerStateAdapter())
        .register(createReorderLayerAdapter())
        .register(createEditPathPointsAdapter())
        .register(createTransformPathAnchorsAdapter())
        .register(createCreateClippingMaskAdapter())
        .register(createReleaseClippingMaskAdapter())
        .register(createMakeCompoundPathAdapter())
        .register(createSetAreaTextColumnsAdapter())
        .register(createApplyPathfinderAdapter())
        .register(createDeleteObjectsAdapter())
        .register(createImportVectorArtworkAdapter())
        .register(createCreateTrimMarksAdapter())
        .register(createCreateBarcodeAdapter())
        .register(createCreateQrCodeAdapter())
        .register((variants.setStrokeStyle ?? createSetStrokeStyleAdapter)())
        .register(createSetTextCompositionAdapter())
        .register(createDuplicateArtboardAdapter())
        .register(createInsertVerticalSpaceAdapter())
        .register(createScaleArtworkAdapter())
        .register(createApplyDatasetAdapter())
        .register(createBindVariableAdapter())
        .register(createCreateDatasetAdapter())
        .register(createUpdateDatasetAdapter())
        .seal();
}
export function defaultMutationOperationRegistry() {
    return createCanonicalMutationOperationRegistry();
}
