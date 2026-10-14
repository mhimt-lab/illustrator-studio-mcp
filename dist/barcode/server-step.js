import { z } from 'zod';
import { RASTER_DOCUMENT_CHANGED, readRasterAfterApply, rasterMismatchReport } from '../raster-post-step.js';
import { resolveBarcode } from './plan.js';
import { decodePlannedBarcode } from './raster-decode.js';
const verifiedBarcodeResponseSchema = z.object({
    outcome: z.object({
        applied: z.literal(true),
        document: z.object({ key: z.string() }),
        plan: z.object({ targetBounds: z.array(z.number()).length(4) }),
        item: z.object({ uuid: z.string(), name: z.string() }),
    }),
    delivery: z.object({ mode: z.enum(['original', 'replay']) }),
});
export class BarcodePlanDecodeError extends Error {
    constructor(detail) {
        super(`BARCODE_PLAN_DECODE_MISMATCH: the planned bars do not decode to the requested GTIN (${detail}); nothing was drawn.`);
        this.name = 'BarcodePlanDecodeError';
    }
}
export async function barcodePreStep(internal) {
    const resolved = resolveBarcode(internal);
    const plan = await decodePlannedBarcode(resolved);
    if (plan.status === 'mismatch')
        throw new BarcodePlanDecodeError(plan.detail);
    return { resolved, plan };
}
export async function barcodePostStep(operations, pre, response) {
    const base = { plan: pre.plan };
    const verified = verifiedBarcodeResponseSchema.safeParse(response);
    if (!verified.success)
        return { decode: base, mismatch: null };
    const { outcome } = verified.data;
    const [left, top] = outcome.plan.targetBounds;
    const group = {
        documentKey: outcome.document.key, groupUuid: outcome.item.uuid, groupName: outcome.item.name,
        readInput: { documentKey: outcome.document.key, groupUuid: outcome.item.uuid, resolved: pre.resolved, origin: { left, top } },
    };
    const raster = await readRasterAfterApply(group, (input) => operations.decodeBarcodeRaster(input), RASTER_DOCUMENT_CHANGED);
    const decode = { ...base, raster };
    if (raster.status !== 'mismatch')
        return { decode, mismatch: null };
    return {
        decode,
        mismatch: rasterMismatchReport({
            code: 'BARCODE_DECODE_MISMATCH', group, raster,
            message: `The symbol was drawn and its geometry verified, but a raster of it ${raster.reason === 'glyphs' ? 'shows numerals that differ from their planned shapes' : 'does not decode to the requested GTIN'} (${raster.detail}). It is NOT a success: remove the group before using the document.`,
        }),
    };
}
