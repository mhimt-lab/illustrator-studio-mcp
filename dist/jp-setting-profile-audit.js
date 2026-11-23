import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { LOOSE_LINE_LIMITS } from './jp-loose-line-audit.js';
export const SETTING_PROFILE_KERNING_METHODS = ['none', 'auto', 'optical', 'metrics_roman_only'];
const KERNING_METHOD_OF = { 'AutoKernType.NOAUTOKERN': 'none', 'AutoKernType.AUTO': 'auto',
    'AutoKernType.OPTICAL': 'optical', 'AutoKernType.METRICSROMANONLY': 'metrics_roman_only' };
export const SETTING_PROFILE_NONE = 'none';
export const SETTING_PROFILE_RULES = ['JP_SETTING_PROFILE_MISMATCH', 'JP_BETA_FRAME_EXTENT'];
export const SETTING_PROFILE_ATTRIBUTES = ['kerning_method', 'proportional_metrics', 'tracking', 'tsume', 'horizontal_scale',
    'vertical_scale', 'kinsoku', 'mojikumi'];
const CHARACTER_ATTRIBUTES = SETTING_PROFILE_ATTRIBUTES.slice(0, 6);
const PARAGRAPH_ATTRIBUTES = SETTING_PROFILE_ATTRIBUTES.slice(6);
export const SETTING_PROFILE_PRESETS = ['adobe_beta_gumi_2025_10', 'adobe_tsume_gumi_metrics_2025_10', 'adobe_tsume_gumi_optical_2025_10'];
const MANUAL = 'Adobe mojikumi manual ver 1';
export const SETTING_PROFILE_PRESET_DEFINITIONS = {
    adobe_beta_gumi_2025_10: { version: '2025-10', sourceRef: `${MANUAL} p.07`, values: { kerning_method: 'metrics_roman_only',
            proportional_metrics: false, kinsoku: 'Soft', mojikumi: 'GyomatsuYakumonoZenkakuOrHankaku', tracking: 0, tsume: 0 } },
    adobe_tsume_gumi_metrics_2025_10: { version: '2025-10', sourceRef: `${MANUAL} p.09`, values: { kerning_method: 'auto',
            proportional_metrics: true, kinsoku: 'Soft', mojikumi: 'TsumeGumi' } },
    adobe_tsume_gumi_optical_2025_10: { version: '2025-10', sourceRef: `${MANUAL} p.10`, values: { kerning_method: 'optical',
            kinsoku: 'Soft', mojikumi: 'TsumeGumi' } },
};
export const SETTING_PROFILE_SKIP_REASONS = ['not_read', 'unreadable_frame', 'scan_limit', 'frame_changed', 'unreadable_paragraph',
    'attributes_unreadable', 'unknown_value', 'point_text', 'multi_column', 'transformed', 'not_rectangle', 'invalid_extent',
    'scaled_vertical', 'nominal_pitch_not_applicable', 'indent_varies', 'too_large'];
const nameSchema = z.string().min(1).max(255);
export const jpAuditSettingProfileSchema = z.strictObject({
    preset: z.enum(SETTING_PROFILE_PRESETS).optional(),
    expected: z.strictObject({
        kerning_method: z.enum(SETTING_PROFILE_KERNING_METHODS).optional(),
        proportional_metrics: z.boolean().optional(),
        tracking: z.number().int().min(-1000).max(10_000).optional(),
        tsume: z.number().min(0).max(100).optional(),
        horizontal_scale: z.number().gt(0).max(10_000).optional(),
        vertical_scale: z.number().gt(0).max(10_000).optional(),
        kinsoku: nameSchema.optional(),
        mojikumi: nameSchema.optional(),
    }).optional(),
    frame_extent: z.strictObject({ tolerance_em: z.number().gt(0).max(0.5) }).optional(),
});
function wantedSettings(profile) {
    const expected = profile.expected ?? {};
    const preset = profile.preset === undefined ? {} : SETTING_PROFILE_PRESET_DEFINITIONS[profile.preset].values;
    const out = [];
    for (const attribute of SETTING_PROFILE_ATTRIBUTES) {
        const own = expected[attribute];
        const fromPreset = preset[attribute];
        if (own !== undefined)
            out.push({ attribute, value: own, origin: 'expected' });
        else if (fromPreset !== undefined)
            out.push({ attribute, value: fromPreset, origin: 'preset' });
    }
    return out;
}
const expectedKeys = (profile) => wantedSettings(profile).map((entry) => entry.attribute);
export function settingProfileRulesRun(profile) {
    return [...(expectedKeys(profile).length === 0 ? [] : ['JP_SETTING_PROFILE_MISMATCH']),
        ...(profile.frame_extent === undefined ? [] : ['JP_BETA_FRAME_EXTENT'])];
}
export function settingProfilePresetReport(profile) {
    if (profile.preset === undefined)
        return undefined;
    const definition = SETTING_PROFILE_PRESET_DEFINITIONS[profile.preset];
    return { name: profile.preset, version: definition.version, source_ref: definition.sourceRef };
}
export function settingProfilePolicyError(requested, profile) {
    if (!requested)
        return profile === undefined ? null : 'setting_profile is used only with policy jp_setting_profile_v1.';
    if (profile === undefined || (expectedKeys(profile).length === 0 && profile.frame_extent === undefined)) {
        return 'policy jp_setting_profile_v1 needs setting_profile with a preset, at least one expected attribute or frame_extent; no expected value or tolerance is assumed.';
    }
    return null;
}
export function settingProfileHostParams(profile, shapeNeedsRuns) {
    const keys = expectedKeys(profile);
    return { runs: profile.frame_extent !== undefined || keys.some((key) => CHARACTER_ATTRIBUTES.includes(key)),
        kinsoku: keys.includes('kinsoku'), extent: profile.frame_extent !== undefined, justifiedRuns: shapeNeedsRuns };
}
const scalar = z.union([z.string(), z.number(), z.boolean()]);
export const settingMismatchEvidenceSchema = z.strictObject({
    attribute: z.enum(SETTING_PROFILE_ATTRIBUTES),
    expected: scalar,
    current: scalar,
    current_raw: z.string(),
});
export const frameExtentEvidenceSchema = z.strictObject({
    orientation: z.enum(['horizontal', 'vertical']),
    inner_extent_pt: z.number(),
    inset_pt: z.number(),
    indent_pt: z.number(),
    pitch_pt: z.number(),
    characters_per_line: z.number(),
    candidates: z.array(z.strictObject({ characters: z.number().int().positive(), frame_extent_pt: z.number() })).min(1).max(2),
});
export const settingProfileSkipSchema = z.strictObject({
    rule: z.enum(SETTING_PROFILE_RULES),
    uuid: z.string().max(255),
    name: z.string().max(255),
    reason: z.enum(SETTING_PROFILE_SKIP_REASONS),
    attribute: z.enum(SETTING_PROFILE_ATTRIBUTES).nullable(),
});
export const settingProfilePresetSchema = z.strictObject({
    name: z.enum(SETTING_PROFILE_PRESETS),
    version: z.string().max(16),
    source_ref: z.string().max(255),
});
export const frameHeightEvidenceSchema = z.strictObject({
    leading_pt: z.number(),
    lines_shown: z.number().int().positive(),
    height_for_lines_pt: z.number(),
    inner_height_pt: z.number(),
    difference_pt: z.number(),
});
export const settingProfileFrameHeightSchema = z.strictObject({
    uuid: z.string().max(255),
    name: z.string().max(255),
    height: frameHeightEvidenceSchema.nullable(),
});
export const settingProfileResultSchema = z.strictObject({
    rules_run: z.array(z.enum(SETTING_PROFILE_RULES)),
    preset: settingProfilePresetSchema.optional(),
    frames_measured: z.number().int().nonnegative(),
    skipped: z.array(settingProfileSkipSchema).max(2_000),
    frame_heights: z.array(settingProfileFrameHeightSchema).max(200).optional(),
});
const round4 = (value) => Math.round(value * 10_000) / 10_000;
const finiteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const wholeNumber = (value) => typeof value === 'number' && Number.isInteger(value);
const sameNumber = (left, right) => Math.abs(left - right) < 1e-3;
const nfc = (value) => value.normalize('NFC');
function readStyleRuns(facts, length) {
    const raw = facts.runs;
    if (raw === null || raw === undefined || !Array.isArray(raw) || raw.length === 0)
        return null;
    const out = [];
    let cursor = 0;
    for (const run of raw) {
        if (!wholeNumber(run.start) || !wholeNumber(run.end) || run.start !== cursor || run.end <= run.start)
            return null;
        if (!finiteNumber(run.size) || run.size <= 0 || !finiteNumber(run.tracking) || !finiteNumber(run.horizontalScale) || run.horizontalScale <= 0 ||
            !finiteNumber(run.verticalScale) || run.verticalScale <= 0 || !finiteNumber(run.tsume) || !finiteNumber(run.akiLeft) ||
            !finiteNumber(run.akiRight) || typeof run.palt !== 'boolean' || !(run.kerning === null || finiteNumber(run.kerning)))
            return null;
        out.push({ start: run.start, end: run.end, size: run.size, tracking: run.tracking, horizontalScale: run.horizontalScale,
            verticalScale: run.verticalScale, tsume: run.tsume, akiLeft: run.akiLeft, akiRight: run.akiRight, kerning: run.kerning,
            method: run.method, palt: run.palt, autoLeading: typeof run.autoLeading === 'boolean' ? run.autoLeading : null,
            leading: finiteNumber(run.leading) ? run.leading : null });
        cursor = run.end;
    }
    return cursor === length ? out : null;
}
function readParagraphs(facts, contents) {
    const paragraphs = facts.paragraphs;
    if (paragraphs === null)
        return 'unreadable';
    const out = [];
    for (let index = 0; index < paragraphs.length; index += 1) {
        const paragraph = paragraphs[index];
        if ('error' in paragraph)
            return 'unreadable';
        if ('trailingEmpty' in paragraph) {
            if (index !== paragraphs.length - 1 || !contents.endsWith('\r'))
                return 'unreadable';
            continue;
        }
        if (!wholeNumber(paragraph.start) || !wholeNumber(paragraph.end) || paragraph.end < paragraph.start || paragraph.end > contents.length)
            return 'unreadable';
        if ('empty' in paragraph)
            continue;
        if (paragraph.end === paragraph.start)
            continue;
        out.push({ start: paragraph.start, end: paragraph.end, mojikumi: paragraph.mojikumi, kinsoku: paragraph.kinsoku ?? null,
            indent: finiteNumber(paragraph.leftIndent) && finiteNumber(paragraph.rightIndent) ? paragraph.leftIndent + paragraph.rightIndent : null });
    }
    return out;
}
function characterValue(attribute, run) {
    switch (attribute) {
        case 'kerning_method': {
            const method = KERNING_METHOD_OF[run.method];
            return method === undefined ? null : { value: method, raw: run.method };
        }
        case 'proportional_metrics': return { value: run.palt, raw: String(run.palt) };
        case 'tracking': return { value: round4(run.tracking), raw: String(run.tracking) };
        case 'tsume': return { value: round4(run.tsume), raw: String(run.tsume) };
        case 'horizontal_scale': return { value: round4(run.horizontalScale), raw: String(run.horizontalScale) };
        default: return { value: round4(run.verticalScale), raw: String(run.verticalScale) };
    }
}
function matchesExpected(current, expected) {
    if (typeof current === 'number' && typeof expected === 'number')
        return sameNumber(current, expected);
    return current === expected;
}
const pair = (value) => Array.isArray(value) && value.length === 2 && finiteNumber(value[0]) && finiteNumber(value[1]) ? [value[0], value[1]] : null;
function rectangleExtent(points) {
    if (points.length !== 4)
        return null;
    const anchors = [];
    for (const point of points) {
        const anchor = pair(point.anchor);
        const left = pair(point.left);
        const right = pair(point.right);
        if (anchor === null || left === null || right === null)
            return null;
        if (!sameNumber(left[0], anchor[0]) || !sameNumber(left[1], anchor[1]) || !sameNumber(right[0], anchor[0]) || !sameNumber(right[1], anchor[1]))
            return null;
        anchors.push(anchor);
    }
    const cluster = (values) => {
        const distinct = [];
        for (const value of values)
            if (!distinct.some((known) => sameNumber(known, value)))
                distinct.push(value);
        return distinct.length === 2 ? distinct.sort((a, b) => a - b) : null;
    };
    const xs = cluster(anchors.map((anchor) => anchor[0]));
    const ys = cluster(anchors.map((anchor) => anchor[1]));
    if (xs === null || ys === null)
        return null;
    const corner = anchors.map(([x, y]) => [sameNumber(x, xs[0]) ? 0 : 1, sameNumber(y, ys[0]) ? 0 : 1]);
    if (new Set(corner.map(([x, y]) => x * 2 + y)).size !== 4)
        return null;
    for (let index = 0; index < 4; index += 1) {
        const here = corner[index];
        const next = corner[(index + 1) % 4];
        if ((here[0] === next[0]) === (here[1] === next[1]))
            return null;
    }
    return { width: xs[1] - xs[0], height: ys[1] - ys[0] };
}
function skipOf(rule, frame, reason, attribute = null) {
    return { rule, uuid: frame.uuid, name: frame.name, reason, attribute };
}
export function judgeSettingProfileFrame(frame, record, profile) {
    const settings = wantedSettings(profile);
    const wanted = settings.map((entry) => entry.attribute);
    const settingOf = (attribute) => settings.find((entry) => entry.attribute === attribute);
    const sourceOf = (setting) => (setting.origin === 'preset' && profile.preset !== undefined
        ? { source: { source_class: 'adobe', source_ref: `${profile.preset} (${SETTING_PROFILE_PRESET_DEFINITIONS[profile.preset].sourceRef})` } } : {});
    const rules = settingProfileRulesRun(profile);
    const outcome = { findings: [], skipped: [], measured: false, heights: [] };
    const known = new Set();
    const skip = (rule, reason, attribute = null) => {
        const key = `${rule}:${reason}:${attribute ?? ''}`;
        if (known.has(key))
            return;
        known.add(key);
        outcome.skipped.push(skipOf(rule, frame, reason, attribute));
    };
    const skipAll = (reason) => {
        for (const rule of rules) {
            if (rule === 'JP_SETTING_PROFILE_MISMATCH')
                for (const attribute of wanted)
                    skip(rule, reason, attribute);
            else
                skip(rule, reason);
        }
        return outcome;
    };
    if (record === undefined)
        return skipAll('not_read');
    if (record.status === 'skipped')
        return skipAll(record.reason === 'scan_limit' && frame.contents.length > LOOSE_LINE_LIMITS.attributeCharacters ? 'too_large' : record.reason);
    const facts = record.facts;
    if (facts === null)
        return skipAll('unreadable_frame');
    if (facts.contents !== frame.contents || (facts.lines !== null && frame.rawLines !== null && !isDeepStrictEqual(facts.lines, frame.rawLines))) {
        return skipAll('frame_changed');
    }
    let judged = false;
    const runs = readStyleRuns(facts, frame.contents.length);
    for (const attribute of wanted.filter((key) => CHARACTER_ATTRIBUTES.includes(key))) {
        if (runs === null) {
            skip('JP_SETTING_PROFILE_MISMATCH', 'attributes_unreadable', attribute);
            continue;
        }
        const measured = runs.map((run) => characterValue(attribute, run));
        if (measured.some((entry) => entry === null)) {
            skip('JP_SETTING_PROFILE_MISMATCH', 'unknown_value', attribute);
            continue;
        }
        judged = true;
        const setting = settingOf(attribute);
        const expectedValue = setting.value;
        let open = null;
        const flush = () => {
            if (open === null)
                return;
            outcome.findings.push({ rule: 'JP_SETTING_PROFILE_MISMATCH', ...sourceOf(setting), anchor: open.start, range: { start: open.start, end: open.end }, stateOffset: open.start,
                evidence: { setting_mismatch: { attribute, expected: expectedValue, current: open.value, current_raw: open.raw } } });
            open = null;
        };
        runs.forEach((run, index) => {
            const entry = measured[index];
            if (matchesExpected(entry.value, expectedValue)) {
                flush();
                return;
            }
            if (open !== null && open.end === run.start && open.value === entry.value) {
                open.end = run.end;
                return;
            }
            flush();
            open = { start: run.start, end: run.end, value: entry.value, raw: entry.raw };
        });
        flush();
    }
    const paragraphWanted = wanted.filter((key) => PARAGRAPH_ATTRIBUTES.includes(key));
    if (paragraphWanted.length > 0) {
        const paragraphs = readParagraphs(facts, frame.contents);
        if (paragraphs === 'unreadable')
            for (const attribute of paragraphWanted)
                skip('JP_SETTING_PROFILE_MISMATCH', 'unreadable_paragraph', attribute);
        else {
            for (const paragraph of paragraphs) {
                for (const attribute of paragraphWanted) {
                    const raw = attribute === 'kinsoku' ? paragraph.kinsoku : paragraph.mojikumi;
                    if (raw === null) {
                        skip('JP_SETTING_PROFILE_MISMATCH', 'attributes_unreadable', attribute);
                        continue;
                    }
                    judged = true;
                    const setting = settingOf(attribute);
                    const expectedName = String(setting.value);
                    if (nfc(raw) === nfc(expectedName))
                        continue;
                    outcome.findings.push({ rule: 'JP_SETTING_PROFILE_MISMATCH', ...sourceOf(setting), anchor: paragraph.start, range: { start: paragraph.start, end: paragraph.end },
                        stateOffset: paragraph.start, evidence: { setting_mismatch: { attribute, expected: expectedName, current: nfc(raw), current_raw: raw } } });
                }
            }
        }
    }
    if (profile.frame_extent !== undefined && judgeExtent(frame, facts, runs, profile.frame_extent.tolerance_em, outcome, skip))
        judged = true;
    outcome.measured = judged;
    return outcome;
}
function frameHeight(facts, runs, pathHeight, inset, size) {
    if (runs.some((run) => run.autoLeading !== false || run.leading === null || !(run.leading > 0)))
        return null;
    const leading = runs[0].leading;
    if (runs.some((run) => !sameNumber(run.leading, leading)))
        return null;
    const lines = facts.lines;
    if (lines === null || lines === undefined || lines.length === 0 || lines.some((line) => 'error' in line))
        return null;
    const forLines = leading * (lines.length - 1) + size;
    const innerHeight = pathHeight - 2 * inset;
    return { leading_pt: round4(leading), lines_shown: lines.length, height_for_lines_pt: round4(forLines), inner_height_pt: round4(innerHeight),
        difference_pt: round4(innerHeight - forLines) };
}
function judgeExtent(frame, facts, runs, tolerance, outcome, skip) {
    const refuse = (reason) => { skip('JP_BETA_FRAME_EXTENT', reason); return false; };
    if (frame.kind !== 'area')
        return refuse('point_text');
    if (facts.transformed === null)
        return refuse('unreadable_frame');
    if (facts.transformed)
        return refuse('transformed');
    const columns = facts.columns;
    if (columns === null || columns === undefined || 'error' in columns || !wholeNumber(columns.count) || !wholeNumber(columns.rows))
        return refuse('unreadable_frame');
    if (columns.count !== 1 || columns.rows !== 1)
        return refuse('multi_column');
    const extent = facts.extent;
    if (extent === null || extent === undefined || 'error' in extent || !finiteNumber(extent.spacing) || extent.spacing < 0)
        return refuse('unreadable_frame');
    if (extent.points === null)
        return refuse('not_rectangle');
    const rectangle = rectangleExtent(extent.points);
    if (rectangle === null)
        return refuse('not_rectangle');
    if (runs === null)
        return refuse('attributes_unreadable');
    const paragraphs = readParagraphs(facts, frame.contents);
    if (paragraphs === 'unreadable' || paragraphs.some((paragraph) => paragraph.indent === null))
        return refuse('unreadable_paragraph');
    const indent = paragraphs.length === 0 ? 0 : paragraphs[0].indent;
    if (paragraphs.some((paragraph) => !sameNumber(paragraph.indent, indent)))
        return refuse('indent_varies');
    const vertical = frame.orientation === 'vertical';
    const first = runs[0];
    if (vertical && runs.some((run) => !sameNumber(run.horizontalScale, 100) || !sameNumber(run.verticalScale, 100)))
        return refuse('scaled_vertical');
    const uniform = runs.every((run) => sameNumber(run.size, first.size) && sameNumber(run.tracking, first.tracking) &&
        sameNumber(run.horizontalScale, first.horizontalScale));
    const natural = runs.every((run) => !run.palt && (run.method === 'AutoKernType.NOAUTOKERN' || run.method === 'AutoKernType.METRICSROMANONLY') &&
        run.tsume === 0 && (run.akiLeft === -1 || run.akiLeft === 0) && (run.akiRight === -1 || run.akiRight === 0) && (run.kerning === null || run.kerning === 0));
    if (!uniform || !natural)
        return refuse('nominal_pitch_not_applicable');
    const inset = extent.spacing;
    const inner = (vertical ? rectangle.height : rectangle.width) - 2 * inset - indent;
    const pitch = first.size * (vertical ? 1 : first.horizontalScale / 100) * (1 + first.tracking / 1000);
    if (!(inner > 0) || !(pitch > 0))
        return refuse('invalid_extent');
    outcome.heights.push({ uuid: frame.uuid, name: frame.name,
        height: vertical ? null : frameHeight(facts, runs, rectangle.height, inset, first.size) });
    const characters = inner / pitch;
    const nearest = Math.round(characters);
    if (Math.round(Math.abs(characters - nearest) * 1e9) / 1e9 <= tolerance)
        return true;
    const below = Math.floor(characters);
    const candidates = [below, below + 1].filter((count) => count >= 1)
        .map((count) => ({ characters: count, frame_extent_pt: round4(count * pitch + 2 * inset + indent) }));
    outcome.findings.push({ rule: 'JP_BETA_FRAME_EXTENT', anchor: 0, range: { start: 0, end: frame.contents.length }, stateOffset: 0,
        evidence: { frame_extent: { orientation: frame.orientation, inner_extent_pt: round4(inner), inset_pt: round4(inset), indent_pt: round4(indent), pitch_pt: round4(pitch),
                characters_per_line: round4(characters), candidates } } });
    return true;
}
