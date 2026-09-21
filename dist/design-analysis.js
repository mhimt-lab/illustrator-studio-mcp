export const DESIGN_ANALYSIS_LIMITS = {
    textFrameDetailReads: 200,
    lineHeightLines: 100,
    lineHeightParagraphs: 100,
    lineHeightCharacters: 500,
    colors: 500,
    fonts: 200,
    fontSizes: 200,
    strokeWidths: 200,
    findings: 500,
    variantForms: 20,
    contrastPairs: 100,
    channelDigits: 3,
};
function roundChannel(value) {
    const factor = 10 ** DESIGN_ANALYSIS_LIMITS.channelDigits;
    const rounded = Math.round(value * factor) / factor;
    return Object.is(rounded, -0) ? 0 : rounded;
}
function channelKey(value) {
    return String(roundChannel(value));
}
export function slugify(value) {
    const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return slug === '' ? 'unnamed' : slug;
}
function toHexByte(value) {
    const clamped = Math.min(255, Math.max(0, Math.round(value)));
    return clamped.toString(16).padStart(2, '0');
}
function rgbHex(red, green, blue) {
    return `#${toHexByte(red)}${toHexByte(green)}${toHexByte(blue)}`;
}
function grayHex(gray) {
    const value = 255 * (1 - gray / 100);
    return rgbHex(value, value, value);
}
function cmykCss(cyan, magenta, yellow, black) {
    return `device-cmyk(${channelKey(cyan)}% ${channelKey(magenta)}% ${channelKey(yellow)}% ${channelKey(black)}%)`;
}
function labCss(lightness, a, b) {
    return `lab(${channelKey(lightness)}% ${channelKey(a)} ${channelKey(b)})`;
}
export function colorTokenKey(color) {
    switch (color.model) {
        case 'none': return 'none';
        case 'gray': return `gray-${channelKey(color.gray)}`;
        case 'rgb': return `rgb-${channelKey(color.red)}-${channelKey(color.green)}-${channelKey(color.blue)}`;
        case 'cmyk':
            return `cmyk-${channelKey(color.cyan)}-${channelKey(color.magenta)}-${channelKey(color.yellow)}-${channelKey(color.black)}`;
        case 'lab': return `lab-${channelKey(color.lightness)}-${channelKey(color.a)}-${channelKey(color.b)}`;
        case 'spot': return `spot-${JSON.stringify(color.name)}-${channelKey(color.tint)}`;
        case 'gradient': return `gradient-${JSON.stringify(color.name)}`;
        case 'pattern': return `pattern-${JSON.stringify(color.name)}`;
        case 'unknown': return `unknown-${JSON.stringify(color.typename)}`;
    }
}
function colorTokenId(color) {
    switch (color.model) {
        case 'none': return 'none';
        case 'gray': return `gray-${slugify(channelKey(color.gray))}`;
        case 'rgb': return `rgb-${rgbHex(color.red, color.green, color.blue).slice(1)}`;
        case 'cmyk':
            return `cmyk-${[color.cyan, color.magenta, color.yellow, color.black].map((value) => slugify(channelKey(value))).join('-')}`;
        case 'lab': return `lab-${[color.lightness, color.a, color.b].map((value) => slugify(channelKey(value))).join('-')}`;
        case 'spot': return `spot-${slugify(color.name)}-${slugify(channelKey(color.tint))}`;
        case 'gradient': return `gradient-${slugify(color.name)}`;
        case 'pattern': return `pattern-${slugify(color.name)}`;
        case 'unknown': return `unknown-${slugify(color.typename)}`;
    }
}
function processColorCss(color) {
    switch (color.model) {
        case 'gray': return grayHex(color.gray);
        case 'rgb': return rgbHex(color.red, color.green, color.blue);
        case 'cmyk': return cmykCss(color.cyan, color.magenta, color.yellow, color.black);
        case 'lab': return labCss(color.lightness, color.a, color.b);
        case 'spot': return processColorCss(color.baseColor);
        case 'gradient': {
            if (!('stops' in color))
                return null;
            const stops = color.stops.map((stop) => {
                const css = processColorCss(stop.color);
                return css === null ? null : `${css} ${channelKey(stop.rampPoint)}%`;
            });
            if (stops.some((stop) => stop === null))
                return null;
            return `${color.type}-gradient(${stops.join(', ')})`;
        }
        case 'none':
        case 'pattern':
        case 'unknown':
            return null;
    }
}
function isTokenizableColor(color) {
    return color.model !== 'none';
}
function createDesignTokensAccumulator() {
    const colors = new Map();
    let order = 0;
    const addColor = (color, kind) => {
        if (!isTokenizableColor(color))
            return;
        const key = colorTokenKey(color);
        let entry = colors.get(key);
        if (entry === undefined) {
            entry = { color, usage: { fill: 0, stroke: 0, text: 0, total: 0 }, order: order++ };
            colors.set(key, entry);
        }
        entry.usage[kind] += 1;
        entry.usage.total += 1;
    };
    return { colors, addColor };
}
function compareNumbers(a, b) {
    return a - b;
}
function compareStrings(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}
export function createDesignTokens(input) {
    const { snapshot, swatches, textDetails, format } = input;
    const incomplete = new Set();
    const { colors, addColor } = createDesignTokensAccumulator();
    const fonts = new Map();
    const missingFonts = new Map();
    const fontSizes = new Map();
    const strokeWidths = new Map();
    let unavailableAttributes = 0;
    let textFrames = 0;
    let textFramesDetailed = 0;
    const lineHeights = [];
    const lineHeight = (uuid) => {
        const unavailable = (reason) => ({ textFrameUuid: uuid, status: 'unavailable', reason,
            observationScope: null, sampledVisibleLines: null,
            nativeLeadingPt: null, autoLeading: null, paragraphAutoLeadingAmounts: null, cssResolvedLineHeightPt: null,
            cssUnavailableReason: 'render_oracle_fixture_specific' });
        if (!input.lineHeightForeground)
            return unavailable(input.lineHeightUnavailableReason ?? 'foreground_profile_required');
        const read = input.lineHeightReads?.get(uuid);
        if (!read)
            return unavailable('native_property_unavailable');
        if (read.status === 'unavailable')
            return unavailable(read.reason);
        const exactLeadings = read.lines.map((line) => line.leadingPt);
        const exactSizes = read.lines.map((line) => line.sizePt);
        const exactAutos = read.lines.map((line) => line.autoLeading);
        const exactAmounts = read.paragraphAutoLeadingAmounts;
        if (exactLeadings.length === 0 || exactAmounts.length === 0)
            return unavailable('native_property_unavailable');
        if (new Set(exactLeadings).size !== 1 || new Set(exactSizes).size !== 1 || new Set(exactAutos).size !== 1 || new Set(exactAmounts).size !== 1) {
            return { ...unavailable('mixed_frame_single_token_unavailable'), observationScope: read.observationScope,
                sampledVisibleLines: read.lines.length };
        }
        return { textFrameUuid: uuid, status: 'available', reason: 'native_leading_sample_observed',
            observationScope: read.observationScope, sampledVisibleLines: read.lines.length,
            nativeLeadingPt: exactLeadings[0], autoLeading: exactAutos[0],
            paragraphAutoLeadingAmounts: exactAmounts, cssResolvedLineHeightPt: null,
            cssUnavailableReason: 'render_oracle_fixture_specific' };
    };
    const addStrokeWidth = (width) => {
        const key = roundChannel(width);
        const entry = strokeWidths.get(key) ?? { widthPt: key, usage: 0 };
        entry.usage += 1;
        strokeWidths.set(key, entry);
    };
    const addItemAppearance = (item, textKind) => {
        const { appearance } = item;
        if (appearance.opacity.status === 'unavailable')
            unavailableAttributes += 1;
        if (appearance.fill.status === 'available') {
            addColor(appearance.fill.value, textKind ? 'text' : 'fill');
        }
        else if (appearance.fill.status === 'unavailable') {
            unavailableAttributes += 1;
        }
        if (appearance.stroke.status === 'available') {
            if (appearance.stroke.value.color.model !== 'none') {
                addColor(appearance.stroke.value.color, textKind ? 'text' : 'stroke');
                addStrokeWidth(appearance.stroke.value.width);
            }
        }
        else if (appearance.stroke.status === 'unavailable') {
            unavailableAttributes += 1;
        }
    };
    const addTextDetails = (details) => {
        if (details.content.status === 'truncated')
            incomplete.add('text_content_truncated');
        if (details.styleRuns.status === 'truncated' || details.fonts.status === 'truncated' ||
            details.missingFonts.status === 'truncated') {
            incomplete.add('text_style_scan_truncated');
        }
        const framesSeen = new Set();
        const missingSeen = new Set();
        for (const run of details.styleRuns.items) {
            if (run.fill.status === 'available')
                addColor(run.fill.value, 'text');
            else if (run.fill.status === 'unavailable')
                unavailableAttributes += 1;
            if (run.stroke.status === 'available') {
                if (run.stroke.value.model !== 'none')
                    addColor(run.stroke.value, 'text');
            }
            else if (run.stroke.status === 'unavailable') {
                unavailableAttributes += 1;
            }
            let sizePt = null;
            if (run.size.status === 'available') {
                sizePt = roundChannel(run.size.value);
                const sizeEntry = fontSizes.get(sizePt) ?? { sizePt, characterCount: 0, runCount: 0 };
                sizeEntry.characterCount += run.length;
                sizeEntry.runCount += 1;
                fontSizes.set(sizePt, sizeEntry);
            }
            else {
                unavailableAttributes += 1;
            }
            if (run.font.status === 'available') {
                const { postScriptName, family, style } = run.font.value;
                const entry = fonts.get(postScriptName) ??
                    { postScriptName, family, style, characterCount: 0, runCount: 0, textFrameCount: 0, sizesPt: [], sizes: new Set() };
                entry.characterCount += run.length;
                entry.runCount += 1;
                if (!framesSeen.has(postScriptName)) {
                    framesSeen.add(postScriptName);
                    entry.textFrameCount += 1;
                }
                if (sizePt !== null)
                    entry.sizes.add(sizePt);
                fonts.set(postScriptName, entry);
            }
            else {
                const key = `${run.font.reason}|${run.font.fontName ?? ''}`;
                const entry = missingFonts.get(key) ??
                    { fontName: run.font.fontName, reason: run.font.reason, characterCount: 0, textFrameCount: 0 };
                entry.characterCount += run.length;
                if (!missingSeen.has(key)) {
                    missingSeen.add(key);
                    entry.textFrameCount += 1;
                }
                missingFonts.set(key, entry);
            }
        }
    };
    for (const item of snapshot.items) {
        if (item.type === 'TextFrame') {
            textFrames += 1;
            const details = textDetails.get(item.uuid);
            if (details === undefined) {
                addItemAppearance(item, true);
                continue;
            }
            textFramesDetailed += 1;
            lineHeights.push(lineHeight(item.uuid));
            if (item.appearance.opacity.status === 'unavailable')
                unavailableAttributes += 1;
            if (item.appearance.stroke.status === 'available' && item.appearance.stroke.value.color.model !== 'none') {
                addStrokeWidth(item.appearance.stroke.value.width);
            }
            addTextDetails(details);
            continue;
        }
        addItemAppearance(item, false);
    }
    if (textFrames > textFramesDetailed)
        incomplete.add('text_frame_detail_limit');
    if (unavailableAttributes > 0)
        incomplete.add('attribute_unavailable');
    const swatchNamesByKey = new Map();
    const swatchDefinitionByKey = new Map();
    for (const swatch of swatches.swatches) {
        if (swatch.color.status !== 'available') {
            unavailableAttributes += 1;
            incomplete.add('attribute_unavailable');
            continue;
        }
        const value = swatch.color.value;
        if (value.model === 'none')
            continue;
        const key = colorTokenKey(value);
        const names = swatchNamesByKey.get(key) ?? [];
        names.push(swatch.name);
        swatchNamesByKey.set(key, names);
        if (value.model === 'gradient')
            swatchDefinitionByKey.set(key, value);
    }
    const colorTokens = [...colors.entries()]
        .sort(([keyA, a], [keyB, b]) => b.usage.total - a.usage.total || a.order - b.order || compareStrings(keyA, keyB))
        .map(([key, entry]) => {
        const color = swatchDefinitionByKey.get(key) ?? entry.color;
        return {
            id: colorTokenId(color),
            color,
            swatchNames: [...(swatchNamesByKey.get(key) ?? [])].sort(compareStrings),
            usage: entry.usage,
            css: processColorCss(color),
        };
    });
    const uniqueIds = new Map();
    for (const token of colorTokens) {
        const seen = uniqueIds.get(token.id) ?? 0;
        uniqueIds.set(token.id, seen + 1);
        if (seen > 0)
            token.id = `${token.id}-${seen + 1}`;
    }
    if (colorTokens.length > DESIGN_ANALYSIS_LIMITS.colors)
        incomplete.add('colors_truncated');
    const fontTokens = [...fonts.values()]
        .map(({ sizes, ...token }) => ({ ...token, sizesPt: [...sizes].sort(compareNumbers) }))
        .sort((a, b) => b.characterCount - a.characterCount || compareStrings(a.postScriptName, b.postScriptName));
    if (fontTokens.length > DESIGN_ANALYSIS_LIMITS.fonts)
        incomplete.add('fonts_truncated');
    const fontSizeTokens = [...fontSizes.values()].sort((a, b) => compareNumbers(a.sizePt, b.sizePt));
    if (fontSizeTokens.length > DESIGN_ANALYSIS_LIMITS.fontSizes)
        incomplete.add('font_sizes_truncated');
    const strokeWidthTokens = [...strokeWidths.values()].sort((a, b) => compareNumbers(a.widthPt, b.widthPt));
    if (strokeWidthTokens.length > DESIGN_ANALYSIS_LIMITS.strokeWidths)
        incomplete.add('stroke_widths_truncated');
    const limitations = ['line_height_css_value_unavailable'];
    if (colorTokens.some((token) => token.color.model === 'cmyk' || token.color.model === 'spot' || token.color.model === 'gradient')) {
        limitations.push('cmyk_css_not_color_managed');
    }
    const result = {
        document: snapshot.document,
        format,
        colors: colorTokens.slice(0, DESIGN_ANALYSIS_LIMITS.colors),
        fonts: fontTokens.slice(0, DESIGN_ANALYSIS_LIMITS.fonts),
        missingFonts: [...missingFonts.values()]
            .sort((a, b) => b.characterCount - a.characterCount || compareStrings(a.fontName ?? '', b.fontName ?? '')),
        fontSizes: fontSizeTokens.slice(0, DESIGN_ANALYSIS_LIMITS.fontSizes),
        strokeWidths: strokeWidthTokens.slice(0, DESIGN_ANALYSIS_LIMITS.strokeWidths),
        lineHeights,
        coverage: {
            pageItems: snapshot.items.length,
            textFrames,
            textFramesDetailed,
            swatches: swatches.swatchCount,
            unavailableAttributes,
        },
        complete: incomplete.size === 0,
        incompleteReasons: [...incomplete].sort(compareStrings),
        limitations,
        css: null,
    };
    if (format === 'css')
        result.css = renderDesignTokensCss(result);
    return result;
}
function cssComment(text) {
    return `/* ${text.replace(/\*\//g, '* /')} */`;
}
function formatPt(value) {
    return `${channelKey(value)}pt`;
}
export function renderDesignTokensCss(result) {
    const lines = [];
    lines.push(cssComment(`Design tokens extracted from ${result.document.name} (${result.document.colorSpace})`));
    lines.push(cssComment(result.complete ? 'coverage: complete' : `coverage: incomplete (${result.incompleteReasons.join(', ')})`));
    for (const limitation of result.limitations)
        lines.push(cssComment(`limitation: ${limitation}`));
    lines.push(':root {');
    for (const token of result.colors) {
        const usage = `usage ${token.usage.total} (fill ${token.usage.fill}, stroke ${token.usage.stroke}, text ${token.usage.text})`;
        const swatchNote = token.swatchNames.length === 0 ? '' : `; swatch ${token.swatchNames.map((name) => JSON.stringify(name)).join(', ')}`;
        const prefix = token.color.model === 'gradient' ? '--gradient-' : '--color-';
        const name = token.color.model === 'gradient' ? token.id.replace(/^gradient-/, '') : token.id;
        if (token.css === null) {
            lines.push(`  ${cssComment(`${prefix}${name}: no CSS representation (${token.color.model}); ${usage}${swatchNote}`)}`);
            continue;
        }
        const spotNote = token.color.model === 'spot'
            ? `; spot ${JSON.stringify(token.color.name)} tint ${channelKey(token.color.tint)}`
            : '';
        lines.push(`  ${prefix}${name}: ${token.css}; ${cssComment(`${usage}${spotNote}${swatchNote}`)}`);
    }
    const families = new Map();
    for (const font of result.fonts) {
        const entry = families.get(font.family) ?? [];
        entry.push(font);
        families.set(font.family, entry);
    }
    const familyIds = new Map();
    for (const [family, fontsInFamily] of families) {
        let id = `--font-family-${slugify(family)}`;
        const seen = familyIds.get(id) ?? 0;
        familyIds.set(id, seen + 1);
        if (seen > 0)
            id = `${id}-${seen + 1}`;
        const styles = fontsInFamily.map((font) => `${font.postScriptName} (${font.style}, ${font.characterCount} chars)`).join(', ');
        lines.push(`  ${id}: ${JSON.stringify(family)}; ${cssComment(styles)}`);
    }
    for (const missing of result.missingFonts) {
        lines.push(`  ${cssComment(`missing font ${missing.fontName === null ? 'unknown' : JSON.stringify(missing.fontName)}: ${missing.reason}, ${missing.characterCount} chars`)}`);
    }
    result.fontSizes.forEach((size, index) => {
        lines.push(`  --font-size-${index + 1}: ${formatPt(size.sizePt)}; ${cssComment(`${size.characterCount} chars, ${size.runCount} runs`)}`);
    });
    result.strokeWidths.forEach((stroke, index) => {
        lines.push(`  --stroke-width-${index + 1}: ${formatPt(stroke.widthPt)}; ${cssComment(`usage ${stroke.usage}`)}`);
    });
    lines.push('}');
    return `${lines.join('\n')}\n`;
}
export const PLACEHOLDER_PATTERNS = [
    { pattern: 'lorem ipsum', mode: 'substring' },
    { pattern: 'dolor sit amet', mode: 'substring' },
    { pattern: 'consectetur adipiscing', mode: 'substring' },
    { pattern: 'placeholder', mode: 'word' },
    { pattern: 'tbd', mode: 'word' },
    { pattern: 'todo', mode: 'word' },
    { pattern: 'xxx', mode: 'word' },
    { pattern: 'ダミーテキスト', mode: 'substring' },
    { pattern: 'ダミー文章', mode: 'substring' },
    { pattern: 'テキストが入ります', mode: 'substring' },
    { pattern: 'サンプルテキスト', mode: 'substring' },
    { pattern: 'テキストテキスト', mode: 'substring' },
    { pattern: 'あああ', mode: 'substring' },
    { pattern: '〇〇', mode: 'substring' },
    { pattern: '○○', mode: 'substring' },
];
const EXCERPT_LIMIT = 80;
const HORIZONTAL_WHITESPACE = '[ \\t\\u3000]';
const CONSECUTIVE_WHITESPACE = new RegExp(`${HORIZONTAL_WHITESPACE}{2,}`);
const TRAILING_WHITESPACE = new RegExp(`${HORIZONTAL_WHITESPACE}+$`);
const LINE_BREAK = /\r\n|\r|\n|\u0003|\u2028|\u2029/;
const WORD_TOKEN = /[\p{L}\p{N}]+/gu;
const LATIN_WORD = /^[A-Za-z][A-Za-z0-9]*$/;
function excerpt(text) {
    if (text.length <= EXCERPT_LIMIT)
        return text;
    let cut = EXCERPT_LIMIT;
    const code = text.charCodeAt(cut - 1);
    if (code >= 0xd800 && code <= 0xdbff)
        cut -= 1;
    return `${text.slice(0, cut)}…`;
}
function findPlaceholder(text) {
    const lower = text.toLowerCase();
    for (const { pattern, mode } of PLACEHOLDER_PATTERNS) {
        if (mode === 'substring') {
            const index = lower.indexOf(pattern.toLowerCase());
            if (index >= 0)
                return { pattern, excerpt: excerpt(text.slice(index)) };
            continue;
        }
        const match = new RegExp(`(?<![A-Za-z0-9])${pattern}(?![A-Za-z0-9])`, 'i').exec(text);
        if (match)
            return { pattern, excerpt: excerpt(text.slice(match.index)) };
    }
    return null;
}
function targetOf(item) {
    return {
        uuid: item.uuid,
        name: item.name,
        hidden: item.hidden.status === 'available' ? item.hidden.value : null,
    };
}
export function checkTextConsistency(snapshot) {
    const incomplete = new Set();
    const findings = [];
    const variants = new Map();
    let textFrames = 0;
    let scannedTextFrames = 0;
    for (const item of snapshot.items) {
        if (item.type !== 'TextFrame')
            continue;
        textFrames += 1;
        if (item.text === null || item.text.status !== 'available') {
            incomplete.add('text_unavailable');
            continue;
        }
        scannedTextFrames += 1;
        if (item.text.value.truncated)
            incomplete.add('text_content_truncated');
        const text = item.text.value.text;
        const target = targetOf(item);
        const placeholder = findPlaceholder(text);
        if (placeholder) {
            findings.push({
                rule: 'placeholder_text',
                severity: 'warning',
                message: `Text frame contains the placeholder pattern ${JSON.stringify(placeholder.pattern)}.`,
                target,
                evidence: placeholder,
            });
        }
        const lines = text.split(LINE_BREAK);
        lines.forEach((line, lineIndex) => {
            if (TRAILING_WHITESPACE.test(line)) {
                findings.push({
                    rule: 'trailing_whitespace',
                    severity: 'warning',
                    message: `Line ${lineIndex + 1} ends with whitespace.`,
                    target,
                    evidence: { lineIndex, excerpt: excerpt(line) },
                });
            }
            const consecutive = CONSECUTIVE_WHITESPACE.exec(line);
            if (consecutive) {
                findings.push({
                    rule: 'consecutive_whitespace',
                    severity: 'warning',
                    message: `Line ${lineIndex + 1} contains ${consecutive[0].length} consecutive whitespace characters.`,
                    target,
                    evidence: { lineIndex, excerpt: excerpt(line.slice(Math.max(0, consecutive.index - 20))) },
                });
            }
        });
        let previousWord = null;
        let previousEnd = -1;
        for (const match of text.matchAll(WORD_TOKEN)) {
            const word = match[0];
            const start = match.index;
            if (previousWord !== null && LATIN_WORD.test(word) && word === previousWord &&
                /^[ \t　]+$/.test(text.slice(previousEnd, start))) {
                findings.push({
                    rule: 'duplicate_word',
                    severity: 'warning',
                    message: `The word ${JSON.stringify(word)} is repeated consecutively.`,
                    target,
                    evidence: { word, excerpt: excerpt(text.slice(Math.max(0, start - previousWord.length - 20))) },
                });
            }
            previousWord = word;
            previousEnd = start + word.length;
            const key = word.normalize('NFKC').toLowerCase();
            if (key.length < 2)
                continue;
            const forms = variants.get(key) ?? new Map();
            const form = forms.get(word) ?? { count: 0, targets: new Map() };
            form.count += 1;
            form.targets.set(target.uuid, target);
            forms.set(word, form);
            variants.set(key, forms);
        }
    }
    const variantFindings = [];
    for (const [key, forms] of [...variants.entries()].sort(([a], [b]) => compareStrings(a, b))) {
        if (forms.size < 2)
            continue;
        const formList = [...forms.keys()];
        const first = formList[0];
        const caseOnly = formList.every((form) => form.toLowerCase() === first.toLowerCase());
        const widthOnly = !caseOnly && formList.every((form) => form.normalize('NFKC') === first.normalize('NFKC'));
        const rule = caseOnly ? 'case_variant' : widthOnly ? 'width_variant' : 'mixed_variant';
        const sortedForms = [...forms.entries()]
            .sort(([formA, a], [formB, b]) => b.count - a.count || compareStrings(formA, formB))
            .slice(0, DESIGN_ANALYSIS_LIMITS.variantForms)
            .map(([form, entry]) => ({
            form,
            count: entry.count,
            targets: [...entry.targets.values()].sort((a, b) => compareStrings(a.uuid, b.uuid)),
        }));
        variantFindings.push({
            rule,
            severity: 'info',
            message: `${formList.length} spellings of ${JSON.stringify(key)} appear: ${sortedForms.map((form) => JSON.stringify(form.form)).join(', ')}.`,
            evidence: { key, forms: sortedForms },
        });
    }
    findings.push(...variantFindings);
    const findingCount = findings.length;
    if (findingCount > DESIGN_ANALYSIS_LIMITS.findings)
        incomplete.add('findings_truncated');
    return {
        document: snapshot.document,
        textFrames,
        scannedTextFrames,
        findings: findings.slice(0, DESIGN_ANALYSIS_LIMITS.findings),
        findingCount,
        complete: incomplete.size === 0,
        incompleteReasons: [...incomplete].sort(compareStrings),
    };
}
export const CONTRAST_THRESHOLDS = { aaNormal: 4.5, aaLarge: 3, aaaNormal: 7, aaaLarge: 4.5 };
export const CONTRAST_LARGE_TEXT = { minimumSizePt: 18, minimumBoldSizePt: 14 };
const HEX_COLOR = /^#?([0-9a-fA-F]{6})$/;
function clampChannel(value) {
    return Math.min(255, Math.max(0, Math.round(value)));
}
export function resolveContrastColor(input) {
    let srgb;
    let conversion;
    switch (input.model) {
        case 'rgb':
            srgb = { red: clampChannel(input.red), green: clampChannel(input.green), blue: clampChannel(input.blue) };
            conversion = 'srgb_exact';
            break;
        case 'hex': {
            const match = HEX_COLOR.exec(input.value);
            if (!match)
                throw new Error(`Invalid hex color ${JSON.stringify(input.value)}.`);
            const hex = match[1];
            srgb = {
                red: Number.parseInt(hex.slice(0, 2), 16),
                green: Number.parseInt(hex.slice(2, 4), 16),
                blue: Number.parseInt(hex.slice(4, 6), 16),
            };
            conversion = 'srgb_exact';
            break;
        }
        case 'gray': {
            const value = clampChannel(255 * (1 - input.gray / 100));
            srgb = { red: value, green: value, blue: value };
            conversion = 'gray_ink_coverage';
            break;
        }
        case 'cmyk': {
            const k = 1 - input.black / 100;
            srgb = {
                red: clampChannel(255 * (1 - input.cyan / 100) * k),
                green: clampChannel(255 * (1 - input.magenta / 100) * k),
                blue: clampChannel(255 * (1 - input.yellow / 100) * k),
            };
            conversion = 'cmyk_naive';
            break;
        }
    }
    return { input, srgb, conversion, relativeLuminance: relativeLuminance(srgb) };
}
function linearizeChannel(value) {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
export function relativeLuminance(srgb) {
    return 0.2126 * linearizeChannel(srgb.red) + 0.7152 * linearizeChannel(srgb.green) + 0.0722 * linearizeChannel(srgb.blue);
}
export function contrastRatio(a, b) {
    const lighter = Math.max(a, b);
    const darker = Math.min(a, b);
    return (lighter + 0.05) / (darker + 0.05);
}
export function isLargeText(text) {
    return text.sizePt >= CONTRAST_LARGE_TEXT.minimumSizePt ||
        (text.bold && text.sizePt >= CONTRAST_LARGE_TEXT.minimumBoldSizePt);
}
export function computeContrastPairs(documentKey, pairs) {
    return {
        mode: 'pairs',
        documentKey,
        hostRead: false,
        formula: 'wcag-2.x-relative-luminance',
        thresholds: CONTRAST_THRESHOLDS,
        largeText: CONTRAST_LARGE_TEXT,
        pairs: pairs.map((pair, index) => {
            const foreground = resolveContrastColor(pair.foreground);
            const background = resolveContrastColor(pair.background);
            const exactRatio = contrastRatio(foreground.relativeLuminance, background.relativeLuminance);
            const levels = {
                aa: { normal: exactRatio >= CONTRAST_THRESHOLDS.aaNormal, large: exactRatio >= CONTRAST_THRESHOLDS.aaLarge },
                aaa: { normal: exactRatio >= CONTRAST_THRESHOLDS.aaaNormal, large: exactRatio >= CONTRAST_THRESHOLDS.aaaLarge },
            };
            let text = null;
            if (pair.text !== null) {
                const large = isLargeText(pair.text);
                text = {
                    sizePt: pair.text.sizePt,
                    bold: pair.text.bold,
                    large,
                    aa: large ? levels.aa.large : levels.aa.normal,
                    aaa: large ? levels.aaa.large : levels.aaa.normal,
                };
            }
            return {
                index,
                id: pair.id,
                foreground,
                background,
                ratio: Math.round(exactRatio * 100) / 100,
                levels,
                text,
            };
        }),
        complete: true,
    };
}
export const CONTRAST_OVERLAP_LIMITATIONS = [
    'profile_foreground_only',
    'background_finder_close_indeterminate',
    'locked_unmeasured',
    'frame_level_text_fill_only',
    'text_size_not_read',
    'stroke_and_effects_ignored',
    'path_backgrounds_only',
    'cmyk_conversion_naive',
];
export function contrastAutoDetectUnsupportedProfile(documentKey, observed, hostRead) {
    return {
        mode: 'auto_detect',
        documentKey,
        hostRead,
        outcome: 'unsupported',
        reason: 'auto_detect_unsupported_profile',
        observed,
        message: `auto_detect is supported only with the screen unlocked and ${observed.expectedBundleId} frontmost ` +
            `(measured F0 profile, the supported foreground/unlocked constraints); observed profile "${observed.profile}" ` +
            `(lock ${observed.lockState}, frontmost ${observed.frontmostBundleId ?? 'unknown'}). ` +
            'The Finder-background close step was indeterminate and the locked profile is unmeasured. ' +
            'Use mode "pairs" or bring Illustrator to the front.',
    };
}
const ANCESTOR_DEPTH_LIMIT = 64;
function intersectBounds(a, b) {
    const left = Math.max(a[0], b[0]);
    const top = Math.min(a[1], b[1]);
    const right = Math.min(a[2], b[2]);
    const bottom = Math.max(a[3], b[3]);
    if (left >= right || bottom >= top)
        return null;
    return [left, top, right, bottom];
}
function layerVisibility(layers) {
    const map = new Map();
    const walk = (nodes) => {
        for (const node of nodes) {
            map.set(node.path.join('/'), node.effectiveVisible);
            walk(node.layers);
        }
    };
    walk(layers.layers);
    return map;
}
function appearanceToContrastInput(color) {
    switch (color.model) {
        case 'rgb': return { model: 'rgb', red: color.red, green: color.green, blue: color.blue };
        case 'gray': return { model: 'gray', gray: color.gray };
        case 'cmyk': return { model: 'cmyk', cyan: color.cyan, magenta: color.magenta, yellow: color.yellow, black: color.black };
        case 'spot': return appearanceToContrastInput(color.baseColor);
        default: return null;
    }
}
export function detectContrastOverlaps(input) {
    const { snapshot, layers, clipFlags, observed } = input;
    const incomplete = new Set();
    const byUuid = new Map();
    for (const item of snapshot.items)
        byUuid.set(item.uuid, item);
    const flags = new Map();
    for (const flag of clipFlags.items)
        flags.set(flag.uuid, flag);
    const visibleLayers = layerVisibility(layers);
    const resolvedCache = new Map();
    const clipPathOf = (group) => {
        let found = null;
        for (const child of snapshot.items) {
            if (child.parent.status !== 'available' || child.parent.value.kind !== 'page_item' || child.parent.value.uuid !== group.uuid)
                continue;
            if (child.type !== 'PathItem')
                continue;
            const flag = flags.get(child.uuid);
            if (flag?.clipping?.status === 'available' && flag.clipping.value && (found === null || child.documentIndex < found.documentIndex)) {
                found = child;
            }
        }
        return found;
    };
    const resolve = (item) => {
        const cached = resolvedCache.get(item.uuid);
        if (cached)
            return cached;
        const ancestors = [];
        let hidden = false;
        let region = item.bounds;
        let current = item;
        let result = null;
        const layerVisible = visibleLayers.get(item.layer.path.join('/'));
        if (layerVisible === false)
            hidden = true;
        for (let depth = 0; depth <= ANCESTOR_DEPTH_LIMIT; depth++) {
            if (current.hidden.status !== 'available') {
                incomplete.add('attribute_unavailable');
                result = { status: 'indeterminate', reason: 'visibility_unavailable', ancestors };
                break;
            }
            if (current.hidden.value)
                hidden = true;
            if (current !== item) {
                const flag = flags.get(current.uuid);
                if (current.type === 'GroupItem') {
                    if (flag?.clipped === null || flag?.clipped === undefined || flag.clipped.status !== 'available') {
                        incomplete.add('attribute_unavailable');
                        result = { status: 'indeterminate', reason: 'clip_unresolved', ancestors };
                        break;
                    }
                    if (flag.clipped.value) {
                        const clipPath = clipPathOf(current);
                        if (clipPath === null) {
                            result = { status: 'indeterminate', reason: 'clip_unresolved', ancestors };
                            break;
                        }
                        region = region === null ? null : intersectBounds(region, clipPath.bounds);
                    }
                }
            }
            if (current.parent.status !== 'available') {
                incomplete.add('attribute_unavailable');
                result = { status: 'indeterminate', reason: 'parent_unavailable', ancestors };
                break;
            }
            if (current.parent.value.kind === 'layer')
                break;
            const parent = byUuid.get(current.parent.value.uuid);
            if (parent === undefined || ancestors.includes(parent.uuid) || depth === ANCESTOR_DEPTH_LIMIT) {
                result = { status: 'indeterminate', reason: 'parent_unavailable', ancestors };
                break;
            }
            ancestors.push(parent.uuid);
            current = parent;
        }
        if (result === null) {
            const ownFlag = flags.get(item.uuid);
            const isClipPath = item.type === 'PathItem' && ownFlag?.clipping?.status === 'available' && ownFlag.clipping.value;
            result = { status: 'ok', hidden, region, ancestors, isClipPath };
        }
        resolvedCache.set(item.uuid, result);
        return result;
    };
    const reference = (item, region) => ({
        uuid: item.uuid, name: item.name, type: item.type, bounds: item.bounds, visibleRegion: region,
    });
    const entries = [];
    let textFrames = 0;
    let hiddenTextFrames = 0;
    let clippedAwayTextFrames = 0;
    for (const text of snapshot.items) {
        if (text.type !== 'TextFrame')
            continue;
        textFrames += 1;
        const resolved = resolve(text);
        if (resolved.status === 'indeterminate') {
            entries.push({
                text: reference(text, text.bounds), background: null, candidateCount: 0,
                outcome: { status: 'indeterminate', reason: resolved.reason },
            });
            continue;
        }
        if (resolved.hidden) {
            hiddenTextFrames += 1;
            continue;
        }
        if (resolved.region === null) {
            clippedAwayTextFrames += 1;
            continue;
        }
        const textRegion = resolved.region;
        let nearest = null;
        let candidateCount = 0;
        let candidateIndeterminate = null;
        for (const candidate of snapshot.items) {
            if (candidate.type !== 'PathItem' || candidate.documentIndex <= text.documentIndex)
                continue;
            if (resolved.ancestors.includes(candidate.uuid))
                continue;
            if (candidate.appearance.fill.status === 'not_applicable')
                continue;
            if (candidate.appearance.fill.status === 'available' && candidate.appearance.fill.value.model === 'none')
                continue;
            const candidateFlag = flags.get(candidate.uuid);
            if (candidateFlag?.clipping?.status === 'available' && candidateFlag.clipping.value)
                continue;
            const candidateResolved = resolve(candidate);
            if (candidateResolved.status === 'indeterminate') {
                if (intersectBounds(candidate.bounds, textRegion) !== null)
                    candidateIndeterminate ??= candidateResolved.reason;
                continue;
            }
            if (candidateResolved.hidden || candidateResolved.region === null)
                continue;
            const overlap = intersectBounds(candidateResolved.region, textRegion);
            if (overlap === null)
                continue;
            candidateCount += 1;
            if (nearest === null || candidate.documentIndex < nearest.item.documentIndex) {
                nearest = { item: candidate, region: candidateResolved.region };
            }
        }
        if (nearest === null) {
            entries.push({
                text: reference(text, textRegion), background: null, candidateCount,
                outcome: candidateIndeterminate === null ? { status: 'no_background' } : { status: 'indeterminate', reason: candidateIndeterminate },
            });
            continue;
        }
        if (candidateIndeterminate !== null) {
            entries.push({
                text: reference(text, textRegion), background: reference(nearest.item, nearest.region), candidateCount,
                outcome: { status: 'indeterminate', reason: candidateIndeterminate },
            });
            continue;
        }
        const entryBase = { text: reference(text, textRegion), background: reference(nearest.item, nearest.region), candidateCount };
        const indeterminate = (reason) => ({ ...entryBase, outcome: { status: 'indeterminate', reason } });
        if (text.appearance.opacity.status !== 'available' || nearest.item.appearance.opacity.status !== 'available') {
            incomplete.add('attribute_unavailable');
            entries.push(indeterminate('opacity_unavailable'));
            continue;
        }
        if (text.appearance.opacity.value !== 100 || nearest.item.appearance.opacity.value !== 100) {
            entries.push(indeterminate('opacity_not_opaque'));
            continue;
        }
        if (text.appearance.fill.status !== 'available') {
            incomplete.add('attribute_unavailable');
            entries.push(indeterminate('text_fill_unavailable'));
            continue;
        }
        if (nearest.item.appearance.fill.status !== 'available') {
            incomplete.add('attribute_unavailable');
            entries.push(indeterminate('background_fill_unavailable'));
            continue;
        }
        const foregroundInput = appearanceToContrastInput(text.appearance.fill.value);
        if (foregroundInput === null) {
            entries.push(indeterminate('text_fill_unsupported_model'));
            continue;
        }
        const backgroundInput = appearanceToContrastInput(nearest.item.appearance.fill.value);
        if (backgroundInput === null) {
            entries.push(indeterminate('background_fill_unsupported_model'));
            continue;
        }
        const foreground = resolveContrastColor(foregroundInput);
        const background = resolveContrastColor(backgroundInput);
        const exactRatio = contrastRatio(foreground.relativeLuminance, background.relativeLuminance);
        entries.push({
            ...entryBase,
            outcome: {
                status: 'evaluated',
                foreground,
                background,
                ratio: Math.round(exactRatio * 100) / 100,
                levels: {
                    aa: { normal: exactRatio >= CONTRAST_THRESHOLDS.aaNormal, large: exactRatio >= CONTRAST_THRESHOLDS.aaLarge },
                    aaa: { normal: exactRatio >= CONTRAST_THRESHOLDS.aaaNormal, large: exactRatio >= CONTRAST_THRESHOLDS.aaaLarge },
                },
            },
        });
    }
    const entryCount = entries.length;
    if (entryCount > DESIGN_ANALYSIS_LIMITS.findings)
        incomplete.add('entries_truncated');
    const kept = entries.slice(0, DESIGN_ANALYSIS_LIMITS.findings);
    return {
        mode: 'auto_detect',
        document: snapshot.document,
        hostRead: true,
        profile: 'foreground',
        observed,
        formula: 'wcag-2.x-relative-luminance',
        thresholds: CONTRAST_THRESHOLDS,
        largeText: CONTRAST_LARGE_TEXT,
        entries: kept,
        summary: {
            textFrames,
            hiddenTextFrames,
            clippedAwayTextFrames,
            evaluated: entries.filter((entry) => entry.outcome.status === 'evaluated').length,
            noBackground: entries.filter((entry) => entry.outcome.status === 'no_background').length,
            indeterminate: entries.filter((entry) => entry.outcome.status === 'indeterminate').length,
            entryCount,
        },
        complete: incomplete.size === 0,
        incompleteReasons: [...incomplete].sort(compareStrings),
        limitations: CONTRAST_OVERLAP_LIMITATIONS,
    };
}
