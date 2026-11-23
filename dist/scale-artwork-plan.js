import { z } from 'zod';
export const SCALE_ARTWORK_OPERATION = 'scale_artwork';
export const SCALE_ARTWORK_MAX_ROOTS = 700;
export const SCALE_ARTWORK_MAX_NODES = 5_500;
export const SCALE_ARTWORK_SAMPLE_ROOTS = 48;
export const SCALE_ARTWORK_SAMPLE_NODES = 400;
export const SCALE_ARTWORK_SCAN_DEADLINE_MS = 3_000;
export const SCALE_ARTWORK_CANVAS_LIMIT = 8_191;
export const SCALE_ARTWORK_TOLERANCE_PT = 0.01;
export const SCALE_ARTWORK_MAX_LISTED = 50;
export const SCALE_ARTWORK_MIN_PERCENT = 1;
export const SCALE_ARTWORK_MAX_PERCENT = 10_000;
const LINE_WIDTHS = ['keep', 'scale'];
export const scalePercentSchema = z.number().finite().min(SCALE_ARTWORK_MIN_PERCENT).max(SCALE_ARTWORK_MAX_PERCENT);
const uuidSchema = z.string().min(1).max(256);
const layerRefSchema = z.union([z.string().min(1).max(1024), z.number().int().min(0).max(10_000)]);
export const scaleScopeSchema = z.strictObject({
    layers: z.array(layerRefSchema).min(1).max(16).optional(),
    target_uuids: z.array(uuidSchema).min(1).max(SCALE_ARTWORK_MAX_ROOTS).optional(),
});
export function checkScaleRequest(r) {
    if (r.scalePercent === 100)
        throw new Error('scale_percent must differ from 100.');
    if (Math.abs(Math.round(r.scalePercent * 1e6) / 1e6 - r.scalePercent) >= 1e-9)
        throw new Error('scale_percent has at most 6 decimals.');
    if ((r.layers === undefined) === (r.targetUuids === undefined))
        throw new Error('scope needs exactly one of layers or target_uuids.');
    if (r.layers !== undefined && new Set(r.layers).size !== r.layers.length)
        throw new Error('scope.layers must be distinct.');
    if (r.targetUuids !== undefined && new Set(r.targetUuids).size !== r.targetUuids.length)
        throw new Error('scope.target_uuids must be distinct.');
}
const coordinate = z.number().finite().min(-100_000).max(100_000);
export const scaleOriginSchema = z.union([z.literal('selection_center'), z.strictObject({ x: coordinate, y: coordinate })]);
export const scaleReferenceCheckSchema = z.strictObject({ path_uuid: uuidSchema, actual_mm: z.number().finite().positive().max(1_000_000) });
export const scaleLineWidthSchema = z.enum(LINE_WIDTHS);
export const scalePoint = (p, origin, percent) => {
    const f = percent / 100;
    return [origin[0] + f * (p[0] - origin[0]), origin[1] + f * (p[1] - origin[1])];
};
export const scaleRect = (r, origin, percent) => {
    const a = scalePoint([r[0], r[1]], origin, percent), b = scalePoint([r[2], r[3]], origin, percent);
    return [a[0], a[1], b[0], b[1]];
};
export const unionRect = (rects) => {
    if (rects.length === 0)
        return null;
    return [Math.min(...rects.map((r) => r[0])), Math.max(...rects.map((r) => r[1])), Math.max(...rects.map((r) => r[2])), Math.min(...rects.map((r) => r[3]))];
};
export const rectCenter = (r) => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
export const SCALE_ECHO_TOLERANCE = 2e-6;
export const sameNumber = (a, b) => Math.abs(a - b) <= SCALE_ECHO_TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b));
export const sameNumbers = (a, b) => (a === null || b === null) ? a === b : a.length === b.length && a.every((v, i) => sameNumber(v, b[i]));
export const SCALE_ARTWORK_BLOCKERS = ['document_mutation_not_allowed', 'layer_has_sublayers', 'scale_set_too_large', 'scan_deadline', 'nothing_to_scale', 'items_blocked', 'result_out_of_canvas', 'reference_invalid'];
export const scaleArtworkBeforeSchema = z.strictObject({
    layers: z.array(z.strictObject({ index: z.number().int().min(0), name: z.string().max(1024), roots: z.number().int().min(0), nodes: z.number().int().min(0) })).max(16),
    roots: z.number().int().min(0).max(100_000), nodes: z.number().int().min(0).max(1_000_000),
    types: z.record(z.string().max(64), z.number().int().min(1)),
    boundsUnion: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
    origin: z.tuple([z.number(), z.number()]).nullable(),
    rootsDigest: z.string().regex(/^[0-9a-f]{24}$/), nodesDigest: z.string().regex(/^[0-9a-f]{24}$/),
    sample: z.strictObject({ roots: z.number().int().min(0).max(SCALE_ARTWORK_SAMPLE_ROOTS), nodes: z.number().int().min(0).max(SCALE_ARTWORK_SAMPLE_NODES) }),
    reference: z.strictObject({ pathUuid: uuidSchema, lengthPt: z.number().positive() }).nullable(),
});
export const scaleArtworkAfterSchema = z.strictObject({
    scalePercent: scalePercentSchema, lineWidth: scaleLineWidthSchema,
    origin: z.tuple([z.number(), z.number()]).nullable(), boundsUnion: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
    reference: z.strictObject({ pathUuid: uuidSchema, actualMm: z.number().positive(), expectedLengthPt: z.number().positive() }).nullable(),
});
export function deriveScaleArtworkAfter(before, request) {
    const origin = before.origin;
    return {
        scalePercent: request.scalePercent, lineWidth: request.lineWidth, origin,
        boundsUnion: before.boundsUnion === null || origin === null ? null : scaleRect(before.boundsUnion, origin, request.scalePercent),
        reference: request.verifyReference === null || before.reference === null ? null
            : { pathUuid: request.verifyReference.pathUuid, actualMm: request.verifyReference.actualMm, expectedLengthPt: before.reference.lengthPt * request.scalePercent / 100 },
    };
}
export function scaleArtworkAfterMatches(derived, after) {
    return derived.scalePercent === after.scalePercent && derived.lineWidth === after.lineWidth && sameNumbers(derived.origin, after.origin) && sameNumbers(derived.boundsUnion, after.boundsUnion)
        && ((derived.reference === null) === (after.reference === null))
        && (derived.reference === null || (derived.reference.pathUuid === after.reference.pathUuid && derived.reference.actualMm === after.reference.actualMm && sameNumber(derived.reference.expectedLengthPt, after.reference.expectedLengthPt)));
}
export const outsideCanvas = (r) => r !== null && r.some((v) => Math.abs(v) > SCALE_ARTWORK_CANVAS_LIMIT);
export function scaleArtworkExpectedBlockers(e, before, after) {
    const out = [];
    if (!e.documentAdmitted)
        out.push('document_mutation_not_allowed');
    if (e.layerHasSublayers)
        out.push('layer_has_sublayers');
    if (e.tooLarge)
        out.push('scale_set_too_large');
    if (e.scanDeadline)
        out.push('scan_deadline');
    if (!e.tooLarge && !e.scanDeadline && before.roots === 0)
        out.push('nothing_to_scale');
    if (e.blockedCount > 0)
        out.push('items_blocked');
    if (outsideCanvas(after.boundsUnion))
        out.push('result_out_of_canvas');
    if (e.referenceInvalid)
        out.push('reference_invalid');
    return out;
}
export const SCALE_ARTWORK_NOTES = [
    'Every node below a scaled item moves by the same map about origin; the artboards are not changed (update_artboard does that).',
    'line_width keep leaves stroke widths and dashes unchanged; scale multiplies them by the factor, and the margin of live effects (offset path, shadow) scales with it.',
    'The tool keeps no state between calls: when a drawing is split into several calls pass the first plan\'s origin each time, and do not apply the same scope twice.',
    'The verification reads every node (UUID, type, parent, order, lock, visibility, bounds, stroke width); the attributes of a sample of items are read in full.',
];
export const predictBounds = (before, origin, percent) => scaleRect(before, origin, percent);
