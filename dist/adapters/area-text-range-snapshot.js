import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { layerPathSchema } from '../mutation-result-schema-core.js';
import { PLAIN_POINT_TEXT_V1 } from './point-text-host-script.js';
import { PLAIN_AREA_TEXT_V1, AREA_TEXT_MAX_CODE_UNITS } from './area-text-host-script.js';
import { composedAreaLayoutSchema } from './area-text-layout.js';
import { validateClusterRange, isClusterBoundary } from './point-text-cluster.js';
export const AREA_RANGE_CHARACTER_KEYS = Object.freeze([...new Set([...Object.keys(PLAIN_POINT_TEXT_V1.character),
        'size', 'tracking', 'horizontalScale', 'verticalScale', 'leading'])].sort());
export const AREA_RANGE_CORE_KEYS = Object.freeze(['size', 'tracking', 'horizontalScale', 'verticalScale', 'baselineShift',
    'akiLeft', 'akiRight', 'noBreak', 'leading', 'kerningMethod', 'alignment', 'proportionalMetrics', 'Tsume']);
export const AREA_RANGE_COMMON_KEYS = Object.freeze(AREA_RANGE_CHARACTER_KEYS.filter(key => !AREA_RANGE_CORE_KEYS.includes(key)));
export const AREA_RANGE_PARAGRAPH_KEYS = Object.freeze([...Object.keys(PLAIN_POINT_TEXT_V1.paragraph), 'justification'].sort());
export const AREA_RANGE_FRAME_KEYS = Object.freeze(Object.keys(PLAIN_AREA_TEXT_V1.frame).sort());
const encoded = z.string().max(255).regex(/^(?:number:|boolean:|string:|object:|undefined$|null$)/u);
const attributes = (keys) => z.array(encoded).length(keys.length);
const channel = z.number().finite();
const color = z.discriminatedUnion('model', [
    z.strictObject({ model: z.literal('NoColor') }),
    z.strictObject({ model: z.literal('CMYKColor'), cyan: channel, magenta: channel, yellow: channel, black: channel }),
    z.strictObject({ model: z.literal('RGBColor'), red: channel, green: channel, blue: channel }),
    z.strictObject({ model: z.literal('GrayColor'), gray: channel }),
]);
const style = z.strictObject({ values: attributes(AREA_RANGE_CORE_KEYS),
    font: z.strictObject({ postScriptName: z.string().min(1).max(255), family: z.string().min(1).max(255), style: z.string().min(1).max(255) }),
    fillColor: color, strokeColor: color,
});
const semanticInput = z.strictObject({
    uuid: z.string().min(1).max(255), kind: z.literal('TextType.AREATEXT'), profile: z.literal('area_text_range_v1'),
    contents: z.string().min(1).max(AREA_TEXT_MAX_CODE_UNITS).regex(/^[^\r\n\u0003\ud800-\udfff]+$/),
    manualKerning: z.literal('none'), commonCharacterState: attributes(AREA_RANGE_COMMON_KEYS),
    styleRuns: z.array(z.strictObject({ start: z.number().int().nonnegative(), end: z.number().int().positive(), style })).min(1).max(AREA_TEXT_MAX_CODE_UNITS),
    paragraph: z.strictObject({ values: attributes(AREA_RANGE_PARAGRAPH_KEYS), tabStops: z.array(z.never()).max(0), listStyle: z.literal('unbound:9570') }),
    frame: attributes(AREA_RANGE_FRAME_KEYS), bounds: z.tuple([channel, channel, channel, channel]),
    matrix: z.tuple([channel, channel, channel, channel, channel, channel]),
    paragraphs: z.literal(1), storyFrames: z.literal(1), layerDirect: z.literal(true),
    layerPath: layerPathSchema,
    layerAncestry: z.array(z.strictObject({ name: z.string().max(255), visible: z.boolean(), locked: z.boolean() })).min(1).max(16),
    locked: z.boolean(), hidden: z.boolean(), editable: z.boolean(), layerVisible: z.boolean(), layerLocked: z.boolean(),
});
export const areaRangeSemanticSchema = semanticInput.superRefine((value, context) => {
    let end = 0;
    let previous;
    for (const run of value.styleRuns) {
        if (run.start !== end || run.end <= run.start || run.end > value.contents.length || isDeepStrictEqual(previous, run.style)) {
            context.addIssue({ code: 'custom', message: 'Style runs must be a maximal, exact partition of the UTF-16 contents.' });
        }
        end = run.end;
        previous = run.style;
    }
    if (end !== value.contents.length)
        context.addIssue({ code: 'custom', message: 'Style runs must cover the complete contents.' });
    if (value.frame[AREA_RANGE_FRAME_KEYS.indexOf('orientation')] !== 'object:TextOrientation.HORIZONTAL' || value.frame[AREA_RANGE_FRAME_KEYS.indexOf('columnCount')] !== 'number:1' || value.frame[AREA_RANGE_FRAME_KEYS.indexOf('rowCount')] !== 'number:1' || value.frame[AREA_RANGE_FRAME_KEYS.indexOf('flowLinksHorizontally')] !== 'boolean:true') {
        context.addIssue({ code: 'custom', message: 'Only horizontal one-column, one-row area text is measured.' });
    }
    if (!['object:Justification.FULLJUSTIFYLASTLINELEFT'].includes(value.paragraph.values[AREA_RANGE_PARAGRAPH_KEYS.indexOf('justification')])) {
        context.addIssue({ code: 'custom', message: 'This area-text justification is unmeasured.' });
    }
});
export const areaRangeBeforeSchema = z.strictObject({ semantic: areaRangeSemanticSchema, layout: composedAreaLayoutSchema })
    .superRefine((value, context) => {
    if (value.layout.fit.requestedCharacterCount !== value.semantic.contents.length ||
        value.layout.fit.visibleCharacterCount !== value.semantic.contents.length ||
        value.layout.lines.join('').replace(/[\r\n\u0003]/gu, '') !== value.semantic.contents) {
        context.addIssue({ code: 'custom', message: 'The actual lines must prove the complete semantic contents visible.' });
    }
});
export function predictAreaTextRange(before, start, end, replacement) {
    if (/[\ud800-\udfff]/.test(before.contents) || /[\ud800-\udfff]/.test(replacement))
        throw new Error('surrogate_contents_unmeasured');
    if (/[\r\n\u0003]/u.test(replacement))
        throw new Error('replacement_not_single_paragraph');
    areaRangeSemanticSchema.parse(before);
    const rejected = validateClusterRange(before.contents, start, end);
    if (rejected !== null)
        throw new Error(rejected.reason);
    if (replacement.length > 0) {
        const replacementRejection = validateClusterRange(`x${replacement}x`, 1, replacement.length + 1);
        if (replacementRejection !== null)
            throw new Error(replacementRejection.reason);
    }
    const contents = before.contents.slice(0, start) + replacement + before.contents.slice(end);
    if (contents.length === 0)
        throw new Error('result_empty');
    if (contents.length > AREA_TEXT_MAX_CODE_UNITS)
        throw new Error('result_too_long');
    const resultRejection = validateClusterRange(contents, 0, contents.length);
    if (resultRejection !== null)
        throw new Error(resultRejection.reason);
    if (!isClusterBoundary(contents, start) || !isClusterBoundary(contents, start + replacement.length))
        throw new Error('range_splits_character');
    const inherited = before.styleRuns.find(run => run.start <= start && run.end >= end);
    if (inherited === undefined)
        throw new Error('range_style_not_uniform');
    if ((start > 0 && inherited.start === start) || (end < before.contents.length && inherited.end === end)) {
        throw new Error('range_style_edge_unmeasured');
    }
    const delta = replacement.length - (end - start);
    const runs = [];
    const append = (s, e, attributes) => {
        if (s >= e)
            return;
        const previous = runs.at(-1);
        if (previous !== undefined && previous.end === s && isDeepStrictEqual(previous.style, attributes))
            previous.end = e;
        else
            runs.push({ start: s, end: e, style: structuredClone(attributes) });
    };
    for (const run of before.styleRuns)
        append(run.start, Math.min(run.end, start), run.style);
    append(start, start + replacement.length, inherited.style);
    for (const run of before.styleRuns)
        append(Math.max(run.start, end) + delta, run.end + delta, run.style);
    return areaRangeSemanticSchema.parse({ ...before, contents, styleRuns: runs });
}
export function changedAreaLineIndexes(before, after) {
    return Array.from({ length: Math.max(before.length, after.length) }, (_, index) => index)
        .filter(index => before[index] !== after[index]);
}
