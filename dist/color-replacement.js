import { z } from 'zod';
import { canonicalSha256 } from './mutation-canonical.js';
import { pathAppearanceMutationSchema } from './adapters/set-path-appearance-adapter.js';
import { documentContextSchema } from './mutation-result-schema-core.js';
const finite = z.number().finite();
const rgbSchema = z.strictObject({ model: z.literal('rgb'), red: finite.min(0).max(255), green: finite.min(0).max(255), blue: finite.min(0).max(255) });
const cmykSchema = z.strictObject({ model: z.literal('cmyk'), cyan: finite.min(0).max(100), magenta: finite.min(0).max(100), yellow: finite.min(0).max(100), black: finite.min(0).max(100) });
const graySchema = z.strictObject({ model: z.literal('gray'), gray: finite.min(0).max(100) });
const labSchema = z.strictObject({ model: z.literal('lab'), lightness: finite.min(-128).max(128), a: finite.min(-128).max(128), b: finite.min(-128).max(128) });
const spotSchema = z.strictObject({ model: z.literal('spot'), name: z.string().min(1).max(255), tint: finite.min(0).max(100) });
export const searchableColorSchema = z.discriminatedUnion('model', [rgbSchema, cmykSchema, graySchema, labSchema, spotSchema]);
export const colorMatchSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('swatch_name'), name: z.string().min(1).max(255) }),
    z.strictObject({ kind: z.literal('color'), color: searchableColorSchema, tolerance: z.discriminatedUnion('mode', [
            z.strictObject({ mode: z.literal('channels'), maximum_difference: finite.nonnegative().max(255) }),
            z.strictObject({ mode: z.literal('delta_e_76'), maximum_delta_e: finite.nonnegative().max(200) }),
        ]) }),
]);
export const replacementColorSchema = z.discriminatedUnion('model', [
    rgbSchema, cmykSchema, graySchema,
    z.strictObject({ model: z.literal('spot'), name: z.string().min(1).max(255), tint: finite.min(0).max(100),
        baseColor: z.discriminatedUnion('model', [rgbSchema, cmykSchema, graySchema]) }),
]);
export const colorUsageSchema = z.strictObject({
    usage_id: z.string().min(1).max(1024),
    kind: z.enum(['path_fill', 'path_stroke', 'text_fill', 'text_stroke', 'gradient_stop', 'swatch']),
    paint_slot: z.enum(['fill', 'stroke']).nullable(),
    target_uuid: z.string().min(1).max(255).nullable(),
    target_type: z.string().min(1).max(255).nullable(),
    swatch_name: z.string().min(1).max(255).nullable(),
    swatch_index: z.number().int().nonnegative().nullable(),
    gradient_name: z.string().min(1).max(255).nullable(),
    stop_index: z.number().int().nonnegative().nullable(),
    text_range: z.strictObject({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).nullable(),
    color: z.unknown(),
});
const pageFields = {
    limit: z.number().int().positive(),
    usages: z.array(colorUsageSchema),
    matched_usage_count: z.number().int().nonnegative(),
};
export const colorUsagePageSchema = z.discriminatedUnion('has_more', [
    z.strictObject({ document: documentContextSchema, ...pageFields, has_more: z.literal(true), next_cursor: z.string().min(1), complete: z.literal(false), absence_conclusive: z.literal(false) }),
    z.strictObject({ document: documentContextSchema, ...pageFields, has_more: z.literal(false), next_cursor: z.null(), complete: z.literal(true), absence_conclusive: z.literal(true) }),
]);
export const unsupportedReplacementSchema = z.strictObject({
    usage_id: z.string().min(1).max(1024),
    reason: z.enum([
        'gradient_resource_adapter_unavailable', 'swatch_resource_adapter_unavailable',
        'text_style_scan_incomplete', 'text_fill_requires_complete_uniform_frame',
        'text_stroke_adapter_unavailable', 'replacement_color_space_mismatch',
        'replacement_model_not_supported_by_target', 'path_appearance_unavailable',
    ]),
});
export const colorReplacementPlanSchema = z.strictObject({
    document: documentContextSchema,
    matched_usage_count: z.number().int().nonnegative(),
    page_offset: z.number().int().nonnegative(),
    page_entry_count: z.number().int().nonnegative(),
    has_more: z.boolean(),
    next_cursor: z.string().nullable(),
    batch_request: z.unknown().nullable(),
    supported_step_count: z.number().int().nonnegative(),
    unsupported: z.array(unsupportedReplacementSchema),
    notes: z.array(z.string().min(1)),
});
function channels(color) {
    if (color.model === 'rgb')
        return [Number(color.red), Number(color.green), Number(color.blue)];
    if (color.model === 'cmyk')
        return [Number(color.cyan), Number(color.magenta), Number(color.yellow), Number(color.black)];
    if (color.model === 'gray')
        return [Number(color.gray)];
    if (color.model === 'lab')
        return [Number(color.lightness), Number(color.a), Number(color.b)];
    return null;
}
function rgbToLab(color) {
    const linear = (value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    };
    const r = linear(Number(color.red));
    const g = linear(Number(color.green));
    const b = linear(Number(color.blue));
    const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
    const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
    const zValue = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
    const f = (value) => value > 216 / 24389 ? Math.cbrt(value) : (24389 / 27 * value + 16) / 116;
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(zValue))];
}
function lab(color) {
    if (color.model === 'rgb')
        return rgbToLab(color);
    if (color.model === 'lab')
        return [Number(color.lightness), Number(color.a), Number(color.b)];
    if (color.model === 'gray')
        return [Number(color.gray), 0, 0];
    return null;
}
function sameColorSpace(left, right) {
    return left.model === right.model;
}
function matchesColor(actual, query, tolerance) {
    if (!sameColorSpace(actual, query))
        return false;
    if (query.model === 'spot') {
        if (actual.name !== query.name)
            return false;
        return tolerance.mode === 'channels' && Math.abs(Number(actual.tint) - query.tint) <= tolerance.maximum_difference;
    }
    if (tolerance.mode === 'channels') {
        const left = channels(actual);
        const right = channels(query);
        return left !== null && right !== null && left.length === right.length && left.every((value, index) => Math.abs(value - right[index]) <= tolerance.maximum_difference);
    }
    const left = lab(actual);
    const right = lab(query);
    return left !== null && right !== null && Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]) <= tolerance.maximum_delta_e;
}
function resolvedSwatchColor(match, swatches) {
    if (match.kind !== 'swatch_name')
        return null;
    const candidates = swatches.swatches.filter((swatch) => swatch.name === match.name);
    if (candidates.length !== 1 || candidates[0].color.status !== 'available') {
        throw new Error(`Swatch name ${JSON.stringify(match.name)} must resolve to exactly one available swatch.`);
    }
    return candidates[0].color.value;
}
function colorMatches(actual, match, swatches) {
    if (typeof actual !== 'object' || actual === null || !('model' in actual))
        return false;
    const color = actual;
    if (match.kind === 'color')
        return matchesColor(color, match.color, match.tolerance);
    const resolved = resolvedSwatchColor(match, swatches);
    if (resolved === null)
        return false;
    if (resolved.model === 'spot')
        return color.model === 'spot' && color.name === resolved.name;
    if (resolved.model === 'gradient')
        return color.model === 'gradient' && color.name === resolved.name;
    if (resolved.model === 'pattern')
        return color.model === 'pattern' && color.name === resolved.name;
    return canonicalSha256(color) === canonicalSha256(resolved);
}
function usage(base) {
    const location = [base.kind, base.paint_slot ?? '-', base.target_uuid ?? '-', base.swatch_index ?? '-', base.gradient_name ?? '-',
        base.stop_index ?? '-', base.text_range === null ? '-' : `${base.text_range.start}-${base.text_range.end}`].join(':');
    return { usage_id: location, ...base };
}
function scanPaint(item, kind, color, match, swatches, output) {
    if (typeof color !== 'object' || color === null || !('model' in color))
        return;
    const typed = color;
    if (typed.model === 'gradient') {
        const stops = Array.isArray(typed.stops) ? typed.stops : [];
        stops.forEach((stop, index) => {
            const stopColor = typeof stop === 'object' && stop !== null && 'color' in stop ? stop.color : null;
            if (colorMatches(stopColor, match, swatches))
                output.push(usage({ kind: 'gradient_stop', target_uuid: item.uuid,
                    paint_slot: kind.endsWith('fill') ? 'fill' : 'stroke', target_type: item.type, swatch_name: null, swatch_index: null, gradient_name: String(typed.name), stop_index: index,
                    text_range: null, color: stopColor }));
        });
        if (colorMatches(typed, match, swatches))
            output.push(usage({ kind, target_uuid: item.uuid, target_type: item.type,
                paint_slot: kind.endsWith('fill') ? 'fill' : 'stroke', swatch_name: null, swatch_index: null, gradient_name: String(typed.name), stop_index: null, text_range: null, color: typed }));
        return;
    }
    if (colorMatches(typed, match, swatches))
        output.push(usage({ kind, target_uuid: item.uuid, target_type: item.type,
            paint_slot: kind.endsWith('fill') ? 'fill' : 'stroke', swatch_name: null, swatch_index: null, gradient_name: null, stop_index: null, text_range: null, color: typed }));
}
export function validateColorMatch(match) {
    if (match.kind === 'color' && match.tolerance.mode === 'delta_e_76' &&
        (match.color.model === 'cmyk' || match.color.model === 'spot')) {
        throw new Error(`delta_e_76 is unsupported for ${match.color.model}; use same-space channel tolerance. No implicit color conversion is performed.`);
    }
}
export function findColorUsages(snapshot, swatches, match, textDetails = null) {
    validateColorMatch(match);
    resolvedSwatchColor(match, swatches);
    const output = [];
    for (const item of snapshot.items) {
        const appearance = item.appearance;
        if (appearance.fill?.status === 'available')
            scanPaint(item, item.type === 'TextFrame' ? 'text_fill' : 'path_fill', appearance.fill.value, match, swatches, output);
        if (appearance.stroke?.status === 'available')
            scanPaint(item, item.type === 'TextFrame' ? 'text_stroke' : 'path_stroke', appearance.stroke.value?.color, match, swatches, output);
    }
    if (textDetails !== null) {
        const coarse = output.filter((entry) => (entry.kind === 'text_fill' || entry.kind === 'text_stroke') && entry.target_uuid !== null);
        for (const found of coarse) {
            const details = textDetails.get(found.target_uuid);
            if (details === undefined || details.styleRuns.status !== 'complete')
                continue;
            const index = output.indexOf(found);
            if (index >= 0)
                output.splice(index, 1);
            const slot = found.kind === 'text_fill' ? 'fill' : 'stroke';
            const { usage_id: _usageId, ...base } = found;
            for (const run of details.styleRuns.items) {
                const paint = run[slot];
                if (paint.status !== 'available' || !colorMatches(paint.value, match, swatches))
                    continue;
                output.push(usage({ ...base, paint_slot: slot, text_range: { start: run.start, end: run.start + run.length }, color: paint.value }));
            }
        }
    }
    for (const swatch of swatches.swatches) {
        if (swatch.color.status !== 'available')
            continue;
        const value = swatch.color.value;
        if (value.model === 'gradient' && Array.isArray(value.stops)) {
            value.stops.forEach((stop, index) => {
                const stopColor = stop.color;
                if (colorMatches(stopColor, match, swatches))
                    output.push(usage({ kind: 'gradient_stop', target_uuid: null,
                        paint_slot: null, target_type: null, swatch_name: swatch.name, swatch_index: swatch.index, gradient_name: String(value.name), stop_index: index,
                        text_range: null, color: stopColor }));
            });
        }
        if (colorMatches(value, match, swatches))
            output.push(usage({ kind: 'swatch', target_uuid: null, target_type: null,
                paint_slot: null, swatch_name: swatch.name, swatch_index: swatch.index, gradient_name: value.model === 'gradient' ? String(value.name) : null,
                stop_index: null, text_range: null, color: value }));
    }
    return output;
}
function sourceModel(match, swatches) {
    return match.kind === 'color' ? match.color.model : resolvedSwatchColor(match, swatches).model;
}
function pathMutation(item, matched, replacement) {
    const appearance = item.appearance;
    if (appearance.opacity?.status !== 'available' || !appearance.fill || !appearance.stroke)
        return null;
    const replaceFill = matched.some((entry) => entry.kind === 'path_fill');
    const replaceStroke = matched.some((entry) => entry.kind === 'path_stroke');
    const fill = appearance.fill.status === 'available'
        ? { kind: 'solid', color: replaceFill ? replacement : appearance.fill.value }
        : appearance.fill.status === 'not_applicable' ? { kind: 'none' } : null;
    const stroke = appearance.stroke.status === 'available'
        ? { kind: 'solid', color: replaceStroke ? replacement : appearance.stroke.value.color, width: appearance.stroke.value.width }
        : appearance.stroke.status === 'not_applicable' ? { kind: 'none' } : null;
    if (fill === null || stroke === null)
        return null;
    const candidate = { opacity: appearance.opacity.value, fill, stroke };
    return pathAppearanceMutationSchema.safeParse(candidate).success ? candidate : null;
}
export function buildReplacementPlanEntries(snapshot, swatches, match, replacement, usages, textDetails) {
    const byTarget = new Map();
    const resourceEntries = [];
    for (const found of usages) {
        if (found.kind === 'gradient_stop' || found.kind === 'swatch' || found.target_uuid === null) {
            resourceEntries.push({ key: found.usage_id, step: null, unsupported: [{ usage_id: found.usage_id,
                        reason: found.kind === 'gradient_stop' ? 'gradient_resource_adapter_unavailable' : 'swatch_resource_adapter_unavailable' }] });
            continue;
        }
        const list = byTarget.get(found.target_uuid) ?? [];
        list.push(found);
        byTarget.set(found.target_uuid, list);
    }
    const entries = [];
    const expectedModel = sourceModel(match, swatches);
    for (const [uuid, targetUsages] of byTarget) {
        const modelMismatch = expectedModel !== replacement.model;
        if (modelMismatch) {
            entries.push({ key: uuid, step: null, unsupported: targetUsages.map((found) => ({ usage_id: found.usage_id, reason: 'replacement_color_space_mismatch' })) });
            continue;
        }
        const item = snapshot.items.find((candidate) => candidate.uuid === uuid);
        if (item.type === 'PathItem') {
            const mutation = pathMutation(item, targetUsages, replacement);
            entries.push(mutation === null
                ? { key: uuid, step: null, unsupported: targetUsages.map((found) => ({ usage_id: found.usage_id, reason: 'path_appearance_unavailable' })) }
                : { key: uuid, step: { operation: 'set_path_appearance', target_uuid: uuid, appearance: mutation }, unsupported: [] });
            continue;
        }
        const strokes = targetUsages.filter((found) => found.kind === 'text_stroke');
        const fills = targetUsages.filter((found) => found.kind === 'text_fill');
        const unsupported = strokes.map((found) => ({ usage_id: found.usage_id, reason: 'text_stroke_adapter_unavailable' }));
        if (fills.length === 0) {
            entries.push({ key: uuid, step: null, unsupported });
            continue;
        }
        if (replacement.model !== 'rgb') {
            unsupported.push(...fills.map((found) => ({ usage_id: found.usage_id, reason: 'replacement_model_not_supported_by_target' })));
            entries.push({ key: uuid, step: null, unsupported });
            continue;
        }
        const details = textDetails.get(uuid);
        if (details === undefined || details.styleRuns.status !== 'complete') {
            unsupported.push(...fills.map((found) => ({ usage_id: found.usage_id, reason: 'text_style_scan_incomplete' })));
            entries.push({ key: uuid, step: null, unsupported });
            continue;
        }
        const runs = details.styleRuns.items;
        const completeLength = details.content.status === 'complete' ? details.content.text.length : -1;
        const allMatch = completeLength >= 1 && runs.length >= 1 && runs[0].start === 0 &&
            runs.reduce((end, run) => end === run.start ? run.start + run.length : -1, 0) === completeLength &&
            runs.every((run) => run.fill.status === 'available' && colorMatches(run.fill.value, match, swatches));
        if (!allMatch) {
            unsupported.push(...fills.map((found) => ({ usage_id: found.usage_id, reason: 'text_fill_requires_complete_uniform_frame' })));
            entries.push({ key: uuid, step: null, unsupported });
            continue;
        }
        entries.push({ key: uuid, step: { operation: 'set_text_style', target_uuid: uuid, start: 0, end: completeLength,
                style: { fill_color: { red: replacement.red, green: replacement.green, blue: replacement.blue } } }, unsupported });
    }
    return [...entries, ...resourceEntries];
}
export function colorReplacementSnapshotDigest(snapshot, swatches) {
    return canonicalSha256({ structure: snapshot.scan.snapshotDigest, swatches: swatches.swatches });
}
export function assertConsistentColorRead(first, final, firstSwatches, finalSwatches) {
    if (first.document.key !== final.document.key || first.scan.snapshotDigest !== final.scan.snapshotDigest ||
        canonicalSha256(firstSwatches.swatches) !== canonicalSha256(finalSwatches.swatches)) {
        throw new Error('The Illustrator document or swatch collection changed during color-usage inspection.');
    }
}
