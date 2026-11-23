import { z } from 'zod';
import { RASTER_EXPORT_RECORD_SCHEMAS, RASTER_EXACT_RECORD_SCHEMAS } from './raster-export-records.js';
import { SVG_EXPORT_RECORD_SCHEMAS } from './svg-export-records.js';
import { expectedOutputSchema, replacementSummarySchema } from './output-replacement.js';
const common = { version: z.literal(5), expectedOutput: expectedOutputSchema, requestDigest: z.string().regex(/^[a-f0-9]{64}$/u) };
function schema(type) {
    const variants = [RASTER_EXPORT_RECORD_SCHEMAS, RASTER_EXACT_RECORD_SCHEMAS, SVG_EXPORT_RECORD_SCHEMAS].map((family, index) => family[type].safeExtend({ ...common, renderVersion: z.literal(index + 2),
        ...(type === 'published' || type === 'failed' ? { replacement: replacementSummarySchema } : {}) }));
    return z.union(variants);
}
export const OVERWRITE_RECORD_SCHEMAS = {
    prepare: schema('prepare'), session: schema('session'), host_open: schema('host_open'), artifact_binding: schema('artifact_binding'),
    host_terminal: schema('host_terminal'), published: schema('published'), failed: schema('failed'), cleanup: schema('cleanup'), quarantine: schema('quarantine'),
};
