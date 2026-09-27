import { SaxesParser } from 'saxes';
import { z } from 'zod';
export const SVG_TEXT_MAX_UNITS = 32_768;
export const SVG_TEXT_MAX_DISTINCT = 2_048;
export const SVG_FONT_READ_LIMIT = 1_024;
export const SVG_TEXT_DIFFERENCE_LIMIT = 8;
export const SVG_FONT_WARNING_LIMIT = 16;
export const svgCodePointCountsSchema = z.array(z.tuple([
    z.number().int().min(0).max(0x10ffff), z.number().int().positive().max(SVG_TEXT_MAX_UNITS),
])).max(SVG_TEXT_MAX_DISTINCT).superRefine((entries, context) => {
    let previous = -1;
    let total = 0;
    for (const [point, count] of entries) {
        if (point <= previous || (point >= 0xd800 && point <= 0xdfff) || [9, 10, 13, 32].includes(point)) {
            context.addIssue({ code: 'custom', message: 'Text counts must contain sorted unique non-whitespace Unicode scalar values.' });
        }
        total += count;
        previous = point;
    }
    if (total > SVG_TEXT_MAX_UNITS)
        context.addIssue({ code: 'custom', message: 'Text count limit exceeded.' });
});
export const svgTextExpectationSchema = z.strictObject({
    counts: svgCodePointCountsSchema,
    hasRenderedText: z.boolean(),
    fontFamilies: z.array(z.string().min(1).max(255)).max(64),
    fontsDeclared: z.boolean(),
});
export function svgTextCounts(text) {
    if (text.length > SVG_TEXT_MAX_UNITS)
        throw new Error('SVG text exceeds the supported character limit.');
    const counts = new Map();
    for (const character of text) {
        const point = character.codePointAt(0);
        if ([9, 10, 13, 32].includes(point))
            continue;
        if (point >= 0xd800 && point <= 0xdfff)
            throw new Error('SVG text contains an unpaired surrogate.');
        counts.set(point, (counts.get(point) ?? 0) + 1);
    }
    return svgCodePointCountsSchema.parse([...counts].sort(([a], [b]) => a - b));
}
export class SvgNestedGroupError extends Error {
    constructor() { super('SVG tspans and nested groups create nested GroupItems, which this import does not support. Use a source with one root group and flat text frames; nested editable import is not yet supported.'); }
}
const excluded = new Set(['defs', 'title', 'desc', 'metadata', 'symbol', 'clipPath', 'mask', 'marker', 'pattern', 'linearGradient', 'radialGradient']);
const elements = new Set(['svg', 'g', 'text', 'tspan', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const styleProperties = new Set([
    'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'font-stretch',
    'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
    'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'display', 'visibility',
    'text-anchor', 'writing-mode', 'letter-spacing', 'word-spacing', 'baseline-shift', 'dominant-baseline',
    'alignment-baseline', 'text-rendering', 'shape-rendering', 'color', 'marker-start', 'marker-mid', 'marker-end',
]);
const uncertainAttributes = new Set(['class', 'text-transform', 'textLength', 'lengthAdjust', 'clip-path', 'mask', 'filter',
    'requiredFeatures', 'requiredExtensions', 'systemLanguage', 'externalResourcesRequired']);
function families(value) {
    if (/\\|[;{}()\r\n]/u.test(value))
        throw new Error('Escaped or computed font-family values cannot be checked.');
    const result = value.split(',').map((part) => {
        const name = part.trim().replace(/^(['"])(.*)\1$/u, '$2').trim();
        if (!name || /['"]/u.test(name) || name.length > 255)
            throw new Error('Unsupported font-family syntax.');
        return name.toLowerCase();
    });
    if (result.some((name) => ['inherit', 'initial', 'unset', 'revert'].includes(name)))
        throw new Error('Computed font-family values cannot be checked.');
    return result;
}
function svgTextScope(source) {
    const parser = new SaxesParser({ xmlns: true });
    const stack = [];
    const ancestors = new Set();
    let index = 0;
    let definitionText = false;
    let reference = false;
    parser.on('doctype', () => { throw new Error('SVG text verification does not accept document types or custom entities.'); });
    parser.on('opentag', (tag) => {
        const parent = stack.at(-1);
        const attributes = Object.values(tag.attributes);
        const attribute = (name) => attributes.find((value) => value.name === name)?.value;
        let display = attribute('display');
        for (const declaration of (attribute('style') ?? '').split(';')) {
            const match = /^\s*display\s*:\s*(.*?)\s*$/u.exec(declaration);
            if (match)
                display = match[1];
        }
        const definition = parent?.definition === true || ['defs', 'symbol', 'marker', 'pattern'].includes(tag.local);
        const ignored = parent?.excluded === true || excluded.has(tag.local) || display === 'none';
        const entry = { index: index++, excluded: ignored, definition };
        stack.push(entry);
        if (tag.local === 'text') {
            if (definition)
                definitionText = true;
            if (!ignored)
                for (const ancestor of stack)
                    ancestors.add(ancestor.index);
        }
        if (!ignored && attributes.some((value) => value.local === 'href' || /url\s*\(/iu.test(value.value)))
            reference = true;
    });
    parser.on('closetag', () => { stack.pop(); });
    parser.write(source).close();
    return { ancestors, referencedText: definitionText && reference };
}
export function extractSvgTextExpectation(source) {
    const scope = svgTextScope(source);
    const hasRenderedText = scope.ancestors.size > 0;
    if (!hasRenderedText && !scope.referencedText) {
        return { counts: [], hasRenderedText: false, fontFamilies: [], fontsDeclared: true };
    }
    let elementIndex = 0;
    const parser = new SaxesParser({ xmlns: true });
    const stack = [];
    const allFonts = new Set();
    let text = '';
    let fontsDeclared = true;
    let definitionText = false;
    let reference = false;
    let rootSeen = false;
    const refuse = (message) => { throw new Error(message); };
    parser.on('doctype', () => refuse('SVG text verification does not accept document types or custom entities.'));
    parser.on('processinginstruction', () => refuse('SVG processing instructions cannot be checked.'));
    parser.on('xmldecl', (decl) => {
        if (decl.encoding && !/^utf-?8$/iu.test(decl.encoding))
            refuse('Only UTF-8 SVG is supported.');
    });
    parser.on('opentag', (tag) => {
        const affectsText = scope.ancestors.has(elementIndex++);
        if (stack.length >= 64)
            refuse('SVG nesting exceeds the supported limit.');
        const parent = stack.at(-1);
        if (!rootSeen) {
            if (tag.local !== 'svg')
                refuse('SVG root is required.');
            rootSeen = true;
        }
        if (['style', 'script', 'animate', 'set', 'animateTransform'].includes(tag.local))
            refuse('Dynamic or stylesheet rendering cannot be checked.');
        const ignored = parent?.excluded === true || excluded.has(tag.local);
        if (ignored) {
            if (tag.local === 'text')
                definitionText = true;
            stack.push({ excluded: true, text: false, fonts: [] });
            return;
        }
        if ((tag.uri !== '' && tag.uri !== 'http://www.w3.org/2000/svg') || !elements.has(tag.local)) {
            refuse(`SVG element ${tag.name} has unverified text rendering.`);
        }
        if (tag.local === 'tspan' || (tag.local === 'g' && stack.length > 1))
            throw new SvgNestedGroupError();
        if (tag.local === 'svg' && stack.length > 0)
            refuse('Nested SVG viewports cannot be checked.');
        if (tag.local === 'text' && parent?.text)
            refuse('Nested SVG text elements cannot be checked.');
        if (parent?.text && tag.local !== 'tspan')
            refuse('Unsupported content inside SVG text.');
        const attributes = Object.create(null);
        for (const attribute of Object.values(tag.attributes)) {
            if (attribute.prefix === 'xmlns' || attribute.name === 'xmlns')
                continue;
            if (attribute.uri && attribute.uri !== 'http://www.w3.org/XML/1998/namespace')
                refuse('Namespaced rendering attributes cannot be checked.');
            if (uncertainAttributes.has(attribute.local) || /^on/iu.test(attribute.local))
                refuse(`SVG attribute ${attribute.name} has unverified text rendering.`);
            if (/url\s*\(/iu.test(attribute.value) || attribute.local === 'href')
                reference = true;
            attributes[attribute.name] = attribute.value;
        }
        if (attributes.style !== undefined) {
            for (const declaration of attributes.style.split(';').filter((part) => part.trim())) {
                const match = /^\s*([a-z-]+)\s*:\s*([^{}!\\]+)\s*$/u.exec(declaration);
                if (!match)
                    throw new Error('SVG inline style has unverified text rendering.');
                if (!styleProperties.has(match[1]))
                    refuse('SVG inline style has unverified text rendering.');
                attributes[match[1]] = match[2].trim();
            }
        }
        if (affectsText && attributes.visibility && attributes.visibility !== 'visible')
            refuse('SVG visibility changes cannot be checked.');
        if (affectsText && attributes.opacity && Number(attributes.opacity) !== 1)
            refuse('SVG opacity changes cannot be checked.');
        if (affectsText && attributes.display && !['inline', 'none'].includes(attributes.display))
            refuse('SVG display mode cannot be checked.');
        const inherited = parent?.fonts ?? [];
        const currentFonts = attributes['font-family'] === undefined ? inherited : families(attributes['font-family']);
        stack.push({ excluded: attributes.display === 'none', text: tag.local === 'text' || parent?.text === true, fonts: currentFonts });
    });
    parser.on('closetag', () => { stack.pop(); });
    const collect = (value) => {
        const current = stack.at(-1);
        if (!current?.text || current.excluded)
            return;
        text += value;
        if (text.length > SVG_TEXT_MAX_UNITS)
            refuse('SVG text exceeds the supported character limit.');
        if (value.replace(/[\t\n\r ]/gu, '').length > 0) {
            if (current.fonts.length === 0)
                fontsDeclared = false;
            for (const font of current.fonts)
                allFonts.add(font);
            if (allFonts.size > 64)
                refuse('SVG font-family limit exceeded.');
        }
    };
    parser.on('text', collect);
    parser.on('cdata', collect);
    parser.write(source).close();
    if (definitionText && reference)
        refuse('Referenced SVG definitions contain text with unverified rendering.');
    return svgTextExpectationSchema.parse({ counts: svgTextCounts(text), hasRenderedText, fontFamilies: [...allFonts].sort(), fontsDeclared });
}
export const SVG_TEXT_VERIFICATION_SCRIPT = String.raw `
function viVerifyText(copy, admission) {
  var warning = { status: "not_svg", entries: [], truncated: false, checkedCharacters: 0, totalCodeUnits: 0, ms: 0 };
  if (admission.format !== "svg") return warning;
  var expectation = admission.svgText;
  if (!expectation || !expectation.counts) throw mutationError("verify_mismatch", "SVG text expectations are missing.");
  var counts = {}; var points = []; var frames = []; var units = 0;
  for (var i = 0; i < copy.pageItems.length; i++) {
    var item = copy.pageItems[i];
    if (String(item.typename) !== "TextFrame") continue;
    var contents = item.contents;
    if (typeof contents !== "string") throw mutationError("verify_mismatch", "Imported text contents are unreadable.");
    units += contents.length;
    if (units > VI_TEXT_MAX_UNITS) throw mutationError("verify_mismatch", "Imported text exceeds the character limit.");
    frames.push(item);
    for (var j = 0; j < contents.length; j++) {
      var point = contents.charCodeAt(j);
      if (point === 9 || point === 10 || point === 13 || point === 32) continue;
      if (point >= 55296 && point <= 56319) {
        var low = contents.charCodeAt(j + 1);
        if (!(low >= 56320 && low <= 57343)) throw mutationError("verify_mismatch", "Imported text contains an unpaired surrogate.");
        point = 65536 + (point - 55296) * 1024 + low - 56320; j++;
      } else if (point >= 56320 && point <= 57343) throw mutationError("verify_mismatch", "Imported text contains an unpaired surrogate.");
      var key = "p" + point;
      if (counts[key] === undefined) { counts[key] = 0; points.push(point); }
      counts[key]++;
    }
  }
  if (points.length > VI_TEXT_MAX_DISTINCT) throw mutationError("verify_mismatch", "Imported text exceeds the distinct-character limit.");
  points.sort(function (a, b) { return a - b; });
  var actual = []; var expected = {}; var missing = []; var extra = [];
  for (var i = 0; i < points.length; i++) actual.push([points[i], counts["p" + points[i]]]);
  for (var i = 0; i < expectation.counts.length; i++) {
    var pair = expectation.counts[i]; expected["p" + pair[0]] = pair[1];
    var found = counts["p" + pair[0]] || 0;
    if (pair[1] > found) missing.push([pair[0], pair[1] - found]);
  }
  for (var i = 0; i < actual.length; i++) {
    var pair = actual[i]; var wanted = expected["p" + pair[0]] || 0;
    if (pair[1] > wanted) extra.push([pair[0], pair[1] - wanted]);
  }
  var mismatch = missing.length > 0 || extra.length > 0;
  viTextVerification = { status: "matched", reasonCode: null, actualCounts: actual,
    missing: missing.slice(0, VI_DIFFERENCE_LIMIT), extra: extra.slice(0, VI_DIFFERENCE_LIMIT),
    truncated: missing.length > VI_DIFFERENCE_LIMIT || extra.length > VI_DIFFERENCE_LIMIT };
  if (mismatch) {
    viTextVerification.status = "mismatch"; viTextVerification.reasonCode = "text_content_mismatch";
    throw mutationError("verify_mismatch", "text_content_mismatch: missing " + stringifyJson(viTextVerification.missing) +
      "; extra " + stringifyJson(viTextVerification.extra) + "; truncated=" + String(viTextVerification.truncated));
  }
  if (!expectation.hasRenderedText && frames.length !== 0) {
    throw mutationError("verify_mismatch", "The source has no rendered text but imported TextFrames are present.");
  }
  warning.totalCodeUnits = units;
  if (units > VI_FONT_READ_LIMIT) { warning.status = "skipped_limit"; return warning; }
  if (!expectation.fontsDeclared || expectation.fontFamilies.length === 0) { warning.status = "unspecified_fonts"; return warning; }
  warning.status = "checked";
  var start = viNow(); var substitutions = {}; var names = [];
  for (var i = 0; i < frames.length; i++) {
    var characters = frames[i].characters; var initial = characters.length;
    if (warning.checkedCharacters + initial > VI_FONT_READ_LIMIT) throw mutationError("verify_mismatch", "Imported character collection exceeds its limit.");
    for (var j = 0; j < initial; j++) {
      var font = characters[j].characterAttributes.textFont;
      if (!font || typeof font.name !== "string" || typeof font.family !== "string" || font.name.length === 0 || font.name.length > 255) {
        throw mutationError("verify_mismatch", "Imported character font is unreadable.");
      }
      var matched = false; var ps = font.name.toLowerCase(); var family = font.family.toLowerCase();
      for (var k = 0; k < expectation.fontFamilies.length; k++) {
        if (expectation.fontFamilies[k] === ps || expectation.fontFamilies[k] === family) { matched = true; break; }
      }
      warning.checkedCharacters++;
      if (!matched) {
        var key = "f" + font.name;
        if (substitutions[key] === undefined) { substitutions[key] = 0; names.push(font.name); }
        substitutions[key]++;
      }
    }
    if (characters.length !== initial) throw mutationError("verify_mismatch", "Imported character collection changed during verification.");
  }
  names.sort(); warning.truncated = names.length > VI_FONT_WARNING_LIMIT;
  for (var i = 0; i < names.length && i < VI_FONT_WARNING_LIMIT; i++) warning.entries.push({ font: names[i], characters: substitutions["f" + names[i]] });
  warning.ms = viElapsed(start);
  return warning;
}
`;
