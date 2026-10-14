import { barcodePostStep, barcodePreStep } from './barcode/server-step.js';
import { barcodeDecodeSchema } from './barcode/raster-decode.js';
import { qrPostStep, qrPreStep } from './qr/server-step.js';
import { qrDecodeSchema } from './qr/raster-decode.js';
export const RASTER_TOOL_STEPS = [
    { operation: 'create_barcode', decodeSchema: barcodeDecodeSchema, pre: barcodePreStep, post: (operations, pre, response) => barcodePostStep(operations, pre, response) },
    { operation: 'create_qr_code', decodeSchema: qrDecodeSchema, pre: qrPreStep, post: (operations, pre, response) => qrPostStep(operations, pre, response) },
];
export function rasterToolStep(operation) {
    return RASTER_TOOL_STEPS.find((step) => step.operation === operation);
}
