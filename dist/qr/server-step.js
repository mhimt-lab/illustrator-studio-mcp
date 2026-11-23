import { z } from 'zod';
import { appliedInEditSession, RASTER_DOCUMENT_CHANGED, readRasterAfterApply, rasterMismatchReport } from '../raster-post-step.js';
import { decodePlannedQr, QrPlanDecodeError, resolveQr } from './plan.js';
const verifiedResponseSchema = z.object({
    outcome: z.object({
        applied: z.literal(true),
        document: z.object({ key: z.string(), mutationProfile: z.string().nullable().optional() }),
        plan: z.object({ geometry: z.object({ modulePt: z.number() }) }),
        created: z.object({ uuid: z.string(), name: z.string() }),
    }),
    delivery: z.object({ mode: z.enum(['original', 'replay']) }),
});
export async function qrPreStep(internal) {
    const fields = internal;
    const resolved = resolveQr(fields);
    const plan = await decodePlannedQr(resolved, fields.content);
    return { fields, plan, background: fields.background, quietZoneModules: fields.quietZoneModules };
}
export { QrPlanDecodeError };
export async function qrPostStep(operations, pre, response) {
    const base = { plan: pre.plan };
    const verified = verifiedResponseSchema.safeParse(response);
    if (!verified.success)
        return { decode: base, mismatch: null };
    const { outcome } = verified.data;
    const group = {
        documentKey: outcome.document.key, groupUuid: outcome.created.uuid, groupName: outcome.created.name,
        readInput: { documentKey: outcome.document.key, groupUuid: outcome.created.uuid, content: pre.fields.content, modulePt: outcome.plan.geometry.modulePt, quietZoneModules: pre.quietZoneModules, background: pre.background },
    };
    const raster = await readRasterAfterApply(group, (input) => operations.decodeQrRaster(input), RASTER_DOCUMENT_CHANGED);
    const decode = { ...base, raster };
    if (raster.status !== 'mismatch')
        return { decode, mismatch: null };
    return {
        decode,
        mismatch: rasterMismatchReport({
            code: 'QR_DECODE_VERIFICATION_FAILED', group, raster, inEditSession: appliedInEditSession(outcome.document.mutationProfile),
            message: `The symbol was drawn and its geometry verified, but a render of it ${raster.reason === 'no_symbol' ? 'could not be read' : 'does not decode to the requested content'} (${raster.detail}). It is NOT a success: remove the group before using the document.`,
        }),
    };
}
