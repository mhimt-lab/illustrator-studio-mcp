import { z } from 'zod';
export const RGB_BLACK_MAX_TARGETS = 256;
export const RGB_BLACK_SAMPLE_UUIDS = 5;
export const DEFAULT_RGB_BLACK_REPLACEMENT = Object.freeze({ cyan: 0, magenta: 0, yellow: 0, black: 100 });
export function inkRound(value) {
    return Math.round(value * 1_000_000) / 1_000_000;
}
export function classifyBlack(color) {
    const cyan = inkRound(color.cyan);
    const magenta = inkRound(color.magenta);
    const yellow = inkRound(color.yellow);
    const black = inkRound(color.black);
    const cmySum = inkRound(cyan + magenta + yellow);
    const cmyMax = Math.max(cyan, magenta, yellow);
    const cmyMin = Math.min(cyan, magenta, yellow);
    if (cyan === 100 && magenta === 100 && yellow === 100 && black === 100)
        return 'four_color_solid_black';
    if (black >= 60 && black < 100 && cyan >= 60 && magenta >= 60 && yellow >= 60 && cmyMax - cmyMin <= 15)
        return 'rgb_converted_black';
    if (black === 100 && cmySum > 0 && cmySum <= 5)
        return 'overprint_avoidance_black';
    if (black === 100 && cmySum > 5)
        return 'rich_black_used';
    return null;
}
export function replacementProblem(color) {
    const code = classifyBlack(color);
    if (code === 'rgb_converted_black' || code === 'four_color_solid_black') {
        return `The replacement C${color.cyan} M${color.magenta} Y${color.yellow} K${color.black} is itself classified ${code}, so the preflight would flag it again.`;
    }
    return null;
}
export const cmykPercentSchema = z.number().finite().min(0).max(100);
export const rgbBlackReplacementSchema = z.strictObject({
    cyan: cmykPercentSchema, magenta: cmykPercentSchema, yellow: cmykPercentSchema, black: cmykPercentSchema,
}).superRefine((color, context) => {
    const problem = replacementProblem(color);
    if (problem !== null)
        context.addIssue({ code: 'custom', message: problem });
});
export const RGB_BLACK_EXCLUSION_REASONS = [
    'target_locked', 'target_hidden', 'layer_locked_or_hidden', 'paint_unreadable', 'clipping_path',
    'compound_siblings_incomplete', 'compound_exceeds_batch', 'document_not_cmyk',
];
export const RGB_BLACK_OUT_OF_SCOPE = ['text_frame_out_of_scope', 'gradient_stop_out_of_scope'];
const slotSchema = z.enum(['fill', 'stroke']);
export const rgbBlackSelectionSchema = z.strictObject({
    eligible_total: z.number().int().nonnegative(),
    selected: z.number().int().nonnegative().max(RGB_BLACK_MAX_TARGETS),
    remaining_eligible: z.number().int().nonnegative(),
    by_value: z.array(z.strictObject({
        cyan: z.number(), magenta: z.number(), yellow: z.number(), black: z.number(),
        fill_slots: z.number().int().nonnegative(), stroke_slots: z.number().int().nonnegative(), paths: z.number().int().positive(),
    })).max(500),
    excluded: z.array(z.strictObject({
        reason: z.enum(RGB_BLACK_EXCLUSION_REASONS), paths: z.number().int().positive(), sample_uuids: z.array(z.string().min(1).max(255)).max(RGB_BLACK_SAMPLE_UUIDS),
    })),
    out_of_scope: z.array(z.strictObject({ reason: z.enum(RGB_BLACK_OUT_OF_SCOPE), objects: z.number().int().positive() })),
    scope_note: z.string().min(1).max(500),
});
function cmykOf(color) {
    if (typeof color !== 'object' || color === null)
        return null;
    const value = color;
    if (value.model !== 'cmyk')
        return null;
    const { cyan, magenta, yellow, black } = value;
    if (typeof cyan !== 'number' || typeof magenta !== 'number' || typeof yellow !== 'number' || typeof black !== 'number')
        return null;
    return { cyan, magenta, yellow, black };
}
function gradientStopMatches(color) {
    if (typeof color !== 'object' || color === null)
        return 0;
    const value = color;
    if (value.model !== 'gradient' || !Array.isArray(value.stops))
        return 0;
    return value.stops.filter((stop) => {
        const cmyk = typeof stop === 'object' && stop !== null ? cmykOf(stop.color) : null;
        return cmyk !== null && classifyBlack(cmyk) === 'rgb_converted_black';
    }).length;
}
const layerKey = (path) => path.join('.');
function layerStates(layers) {
    const states = new Map();
    const visit = (nodes) => {
        for (const node of nodes) {
            states.set(layerKey(node.path), node.editable);
            visit(node.layers);
        }
    };
    visit(layers);
    return states;
}
export function selectRgbBlackTargets(snapshot, layers, limit = RGB_BLACK_MAX_TARGETS, clipFlags = null) {
    const editableLayers = layerStates(layers);
    const clippingByUuid = new Map();
    for (const flag of clipFlags?.items ?? []) {
        if (flag.type === 'PathItem')
            clippingByUuid.set(flag.uuid, flag.clipping !== null && flag.clipping.status === 'available' ? flag.clipping.value : null);
    }
    const outOfScope = new Map();
    const bump = (reason, by = 1) => outOfScope.set(reason, (outOfScope.get(reason) ?? 0) + by);
    const documentIsCmyk = snapshot.document.colorSpace === 'CMYK';
    const lockedGroups = new Set();
    for (const item of snapshot.items) {
        if (item.type !== 'GroupItem' && item.type !== 'CompoundPathItem')
            continue;
        if ((item.locked.status === 'available' && item.locked.value) || (item.hidden.status === 'available' && item.hidden.value))
            lockedGroups.add(item.uuid);
    }
    const candidates = [];
    for (const item of snapshot.items) {
        const appearance = item.appearance;
        if (item.type === 'TextFrame') {
            const fill = cmykOf(appearance.fill?.status === 'available' ? appearance.fill.value : null);
            const stroke = cmykOf(appearance.stroke?.status === 'available' ? appearance.stroke.value?.color : null);
            if ((fill !== null && classifyBlack(fill) === 'rgb_converted_black') || (stroke !== null && classifyBlack(stroke) === 'rgb_converted_black'))
                bump('text_frame_out_of_scope');
            continue;
        }
        if (item.type !== 'PathItem')
            continue;
        const stops = gradientStopMatches(appearance.fill?.status === 'available' ? appearance.fill.value : null)
            + gradientStopMatches(appearance.stroke?.status === 'available' ? appearance.stroke.value?.color : null);
        if (stops > 0)
            bump('gradient_stop_out_of_scope', stops);
        const values = [];
        const fill = cmykOf(appearance.fill?.status === 'available' ? appearance.fill.value : null);
        const stroke = cmykOf(appearance.stroke?.status === 'available' ? appearance.stroke.value?.color : null);
        if (fill !== null && classifyBlack(fill) === 'rgb_converted_black')
            values.push({ slot: 'fill', color: fill });
        if (stroke !== null && classifyBlack(stroke) === 'rgb_converted_black')
            values.push({ slot: 'stroke', color: stroke });
        if (values.length === 0)
            continue;
        const parent = item.parent.status === 'available' ? item.parent.value : null;
        const compound = parent !== null && parent.kind === 'page_item' && parent.type === 'CompoundPathItem' ? parent.uuid : null;
        let reason = null;
        if (!documentIsCmyk)
            reason = 'document_not_cmyk';
        else if (item.locked.status !== 'available' || item.hidden.status !== 'available')
            reason = 'paint_unreadable';
        else if (clipFlags !== null && (clippingByUuid.get(item.uuid) ?? null) === null)
            reason = 'paint_unreadable';
        else if (clippingByUuid.get(item.uuid) === true)
            reason = 'clipping_path';
        else if (item.locked.value)
            reason = 'target_locked';
        else if (item.hidden.value)
            reason = 'target_hidden';
        else if (editableLayers.get(layerKey(item.layer.path)) !== true)
            reason = 'layer_locked_or_hidden';
        else if (parent !== null && parent.kind === 'page_item' && lockedGroups.has(parent.uuid))
            reason = 'target_locked';
        candidates.push({ item, slots: values.map((entry) => entry.slot), values, compound, reason });
    }
    const compoundMembers = new Map();
    for (const item of snapshot.items) {
        const parent = item.type === 'PathItem' && item.parent.status === 'available' ? item.parent.value : null;
        if (parent !== null && parent.kind === 'page_item' && parent.type === 'CompoundPathItem')
            compoundMembers.set(parent.uuid, (compoundMembers.get(parent.uuid) ?? 0) + 1);
    }
    const compoundGroups = new Map();
    for (const candidate of candidates) {
        if (candidate.compound === null)
            continue;
        const list = compoundGroups.get(candidate.compound) ?? [];
        list.push(candidate);
        compoundGroups.set(candidate.compound, list);
    }
    for (const [uuid, members] of compoundGroups) {
        const total = compoundMembers.get(uuid) ?? 0;
        const sameSlots = members.every((member) => member.slots.join() === members[0].slots.join());
        const blocked = members.find((member) => member.reason !== null);
        if (blocked !== undefined) {
            for (const member of members)
                member.reason ??= blocked.reason;
        }
        else if (members.length !== total || !sameSlots)
            for (const member of members)
                member.reason = 'compound_siblings_incomplete';
        else if (members.length > limit)
            for (const member of members)
                member.reason = 'compound_exceeds_batch';
    }
    const excludedByReason = new Map();
    const byValue = new Map();
    const eligible = [];
    for (const candidate of candidates) {
        if (candidate.reason !== null) {
            const list = excludedByReason.get(candidate.reason) ?? [];
            list.push(candidate.item.uuid);
            excludedByReason.set(candidate.reason, list);
            continue;
        }
        eligible.push(candidate);
        const seen = new Set();
        for (const { slot, color } of candidate.values) {
            const key = [color.cyan, color.magenta, color.yellow, color.black].map(inkRound).join(',');
            const entry = byValue.get(key) ?? { color: { cyan: inkRound(color.cyan), magenta: inkRound(color.magenta), yellow: inkRound(color.yellow), black: inkRound(color.black) }, fill: 0, stroke: 0, paths: 0 };
            if (slot === 'fill')
                entry.fill += 1;
            else
                entry.stroke += 1;
            if (!seen.has(key)) {
                entry.paths += 1;
                seen.add(key);
            }
            byValue.set(key, entry);
        }
    }
    const units = [];
    const placed = new Set();
    for (const candidate of eligible) {
        if (candidate.compound === null) {
            units.push([candidate]);
            continue;
        }
        if (placed.has(candidate.compound))
            continue;
        placed.add(candidate.compound);
        units.push(eligible.filter((other) => other.compound === candidate.compound));
    }
    const targets = [];
    for (const unit of units) {
        if (targets.length + unit.length > limit)
            break;
        for (const member of unit)
            targets.push({ uuid: member.item.uuid, slots: member.slots });
    }
    const summary = {
        eligible_total: eligible.length,
        selected: targets.length,
        remaining_eligible: eligible.length - targets.length,
        by_value: [...byValue.values()]
            .sort((left, right) => right.paths - left.paths || left.color.black - right.color.black || left.color.cyan - right.color.cyan)
            .slice(0, 500)
            .map((entry) => ({ ...entry.color, fill_slots: entry.fill, stroke_slots: entry.stroke, paths: entry.paths })),
        excluded: RGB_BLACK_EXCLUSION_REASONS.filter((reason) => excludedByReason.has(reason)).map((reason) => {
            const uuids = excludedByReason.get(reason);
            return { reason, paths: uuids.length, sample_uuids: uuids.slice(0, RGB_BLACK_SAMPLE_UUIDS) };
        }),
        out_of_scope: RGB_BLACK_OUT_OF_SCOPE.filter((reason) => outOfScope.has(reason)).map((reason) => ({ reason, objects: outOfScope.get(reason) })),
        scope_note: 'Counts are paths whose fill or stroke the print preflight classifies rgb_converted_black. Text paint (#797) and gradient stops are outside this tool and are only counted. remaining_eligible is writable matches beyond this batch of at most 256 paths; excluded paths cannot be written and are not in it.',
    };
    return { targets, summary };
}
