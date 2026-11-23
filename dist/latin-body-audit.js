import { z } from 'zod';
import { clusterAt, clusterBefore, countCharacters, isBreakUnit, isJapanese } from './typography-text.js';
export const LATIN_RULES = ['LAT_STRAIGHT_QUOTE', 'LAT_TYPEWRITER_DASH', 'LAT_THREE_PERIODS', 'LAT_NUMERIC_RANGE_HYPHEN',
    'MIX_ASCII_SPACE_AROUND_LATIN', 'LAT_BREAK_BETWEEN_NUMBER_AND_UNIT', 'LAT_PROTECTED_TERM_SPLIT', 'MIX_LATIN_WORD_SPLIT',
    'LAT_EMERGENCY_WORD_BREAK', 'LAT_HYPHEN_LADDER', 'LAT_RUNT', 'LAT_JUSTIFY_ALL_LINES', 'LAT_JUSTIFIED_WITHOUT_HYPHENATION'];
export const LATIN_DEFERRED_RULES = ['LAT_QUOTE_LANGUAGE_MISMATCH', 'LAT_SPACE_BEFORE_PUNCTUATION', 'LAT_LANGUAGE_MIXED',
    'LAT_FIGURE_STYLE_MIXED', 'LAT_DISCRETIONARY_LIGATURES_IN_BODY', 'LAT_LIGATURES_OFF', 'LAT_HYPHENATED_URL_OR_CODE',
    'LAT_SPACING_RANGE', 'LAT_SINGLE_LINE_COMPOSER_JUSTIFIED'];
export const LATIN_FINDING_RULES = [...LATIN_RULES, 'LAT_PRIME_CANDIDATE'];
export const LATIN_SKIP_REASONS = ['language_not_read', 'character_attributes_not_read', 'not_implemented', 'vertical_text_not_measured',
    'lines_unreadable', 'paragraph_attribute_unreadable'];
export const LATIN_DEFERRED_REASON = {
    LAT_QUOTE_LANGUAGE_MISMATCH: 'language_not_read',
    LAT_SPACE_BEFORE_PUNCTUATION: 'language_not_read',
    LAT_LANGUAGE_MIXED: 'language_not_read',
    LAT_FIGURE_STYLE_MIXED: 'character_attributes_not_read',
    LAT_DISCRETIONARY_LIGATURES_IN_BODY: 'character_attributes_not_read',
    LAT_LIGATURES_OFF: 'character_attributes_not_read',
    LAT_HYPHENATED_URL_OR_CODE: 'not_implemented',
    LAT_SPACING_RANGE: 'not_implemented',
    LAT_SINGLE_LINE_COMPOSER_JUSTIFIED: 'not_implemented',
};
const termSchema = z.string().min(1).max(32).regex(/^\S+$/u);
export const latinBodySchema = z.strictObject({
    rules: z.array(z.enum([...LATIN_RULES, ...LATIN_DEFERRED_RULES])).min(1).max(LATIN_RULES.length + LATIN_DEFERRED_RULES.length),
    units: z.array(termSchema).max(64).optional(),
    references: z.array(termSchema).max(64).optional(),
    runt_min_characters: z.number().int().min(2).max(100).optional(),
    max_consecutive_hyphens: z.number().int().min(1).max(20).optional(),
});
export function latinBodyPolicyError(latinBody, protectedTermCount) {
    if (latinBody === undefined)
        return 'policy latin_body_v1 needs latin_body with rules; no rule is assumed.';
    const rules = new Set(latinBody.rules);
    if (rules.size !== latinBody.rules.length)
        return 'latin_body.rules must not repeat a rule.';
    const wantsUnit = rules.has('LAT_BREAK_BETWEEN_NUMBER_AND_UNIT');
    const hasTerms = (latinBody.units?.length ?? 0) + (latinBody.references?.length ?? 0) > 0;
    if (wantsUnit && !hasTerms) {
        return 'LAT_BREAK_BETWEEN_NUMBER_AND_UNIT needs latin_body.units or latin_body.references; no unit list is assumed.';
    }
    if (!wantsUnit && (latinBody.units !== undefined || latinBody.references !== undefined)) {
        return 'latin_body.units and latin_body.references are used only with LAT_BREAK_BETWEEN_NUMBER_AND_UNIT.';
    }
    for (const [name, list] of [['units', latinBody.units], ['references', latinBody.references]]) {
        if (list !== undefined && new Set(list).size !== list.length)
            return `latin_body.${name} must not repeat an entry.`;
    }
    if (rules.has('LAT_RUNT') !== (latinBody.runt_min_characters !== undefined)) {
        return 'latin_body.runt_min_characters is required by, and used only with, LAT_RUNT; no threshold is assumed.';
    }
    if (rules.has('LAT_HYPHEN_LADDER') !== (latinBody.max_consecutive_hyphens !== undefined)) {
        return 'latin_body.max_consecutive_hyphens is required by, and used only with, LAT_HYPHEN_LADDER; no limit is assumed.';
    }
    if (rules.has('LAT_PROTECTED_TERM_SPLIT') && protectedTermCount === 0) {
        return 'LAT_PROTECTED_TERM_SPLIT needs protected_terms; no term is assumed.';
    }
    return null;
}
export function latinBodyNeeds(rules) {
    const wants = (rule) => rules.includes(rule);
    return {
        justification: wants('LAT_JUSTIFY_ALL_LINES') || wants('LAT_JUSTIFIED_WITHOUT_HYPHENATION'),
        hyphenation: wants('LAT_JUSTIFIED_WITHOUT_HYPHENATION') || wants('LAT_EMERGENCY_WORD_BREAK') || wants('LAT_HYPHEN_LADDER'),
    };
}
export const latinBodyResultSchema = z.strictObject({
    rules_run: z.array(z.enum(LATIN_RULES)),
    rules_skipped: z.array(z.strictObject({
        rule_id: z.string(),
        reason: z.enum(LATIN_SKIP_REASONS),
        frames: z.number().int().nonnegative().nullable(),
    })),
});
export const LATIN_RULE_META = {
    LAT_STRAIGHT_QUOTE: { severity: 'warning', determinism: 'deterministic', source_class: 'convention',
        source_ref: 'straight quotation mark or apostrophe in Latin text',
        recommendation: 'Replace the straight quote with a typographic quotation mark or apostrophe (U+2018 U+2019 U+201C U+201D) that matches the paragraph language.' },
    LAT_PRIME_CANDIDATE: { severity: 'info', determinism: 'heuristic', source_class: 'convention',
        source_ref: 'straight quote directly after a digit',
        recommendation: 'A straight quote directly after a digit may be a prime mark (feet, inches, minutes) and should stay as such; if it is a quotation mark or apostrophe, replace it.' },
    LAT_TYPEWRITER_DASH: { severity: 'warning', determinism: 'deterministic', source_class: 'convention',
        source_ref: 'two or three hyphens used as a dash',
        recommendation: 'Replace the hyphens with an en dash (two) or an em dash (three), as the house style requires.' },
    LAT_THREE_PERIODS: { severity: 'warning', determinism: 'deterministic', source_class: 'convention',
        source_ref: 'three periods used as an ellipsis',
        recommendation: 'Replace the three periods with the ellipsis character U+2026 if the house style uses it.' },
    LAT_NUMERIC_RANGE_HYPHEN: { severity: 'info', determinism: 'heuristic', source_class: 'convention',
        source_ref: 'hyphen between two numbers (possible range)',
        recommendation: 'If this is a range, an en dash is the usual mark; leave it if it is a part number, a code or a phone number.' },
    MIX_ASCII_SPACE_AROUND_LATIN: { severity: 'warning', determinism: 'deterministic', source_class: 'house_rule',
        source_ref: 'ASCII space between Japanese and Latin letters or digits',
        recommendation: 'Remove the ASCII space and let the mixed-text spacing of the paragraph set the gap, or use the spacing the house style names.' },
    LAT_BREAK_BETWEEN_NUMBER_AND_UNIT: { severity: 'warning', determinism: 'deterministic', source_class: 'house_rule',
        source_ref: 'latin_body.units / latin_body.references',
        recommendation: 'A number and its unit (or a reference mark and its number) are split across lines. Join them with a no-break space or no-break, then audit again because the following line breaks can move.' },
    LAT_PROTECTED_TERM_SPLIT: { severity: 'error', determinism: 'deterministic', source_class: 'house_rule', source_ref: 'protected_terms',
        recommendation: 'A protected term is split across lines. Keep it on one line, then audit again because the following line breaks can move.' },
    MIX_LATIN_WORD_SPLIT: { severity: 'error', determinism: 'deterministic', source_class: 'jlreq', source_ref: 'JLReq 3.2.6',
        recommendation: 'A Latin word inside Japanese text is broken across lines. Change the frame width, tracking or text so the word stays whole; an automatic hyphen would not appear in the story contents.' },
    LAT_EMERGENCY_WORD_BREAK: { severity: 'warning', determinism: 'deterministic', source_class: 'adobe',
        source_ref: 'paragraph hyphenation off, word broken across lines',
        recommendation: 'A word is broken across lines although the paragraph has hyphenation off (the word is longer than the line). Widen the frame, reduce the size or turn hyphenation on; the break position is Illustrator\'s.' },
    LAT_HYPHEN_LADDER: { severity: 'warning', determinism: 'deterministic', source_class: 'house_rule', source_ref: 'latin_body.max_consecutive_hyphens',
        recommendation: 'More consecutive lines end inside a word than the limit allows (the story contents do not show automatic hyphens). Adjust the paragraph\'s consecutive-hyphen limit, the frame width or the text.' },
    LAT_RUNT: { severity: 'warning', determinism: 'deterministic', source_class: 'house_rule', source_ref: 'latin_body.runt_min_characters',
        recommendation: 'The last line of the paragraph is a single short word. Adjust tracking, frame width or text, then audit again because the line breaks move.' },
    LAT_JUSTIFY_ALL_LINES: { severity: 'warning', determinism: 'deterministic', source_class: 'adobe', source_ref: 'paragraph justification FULLJUSTIFY',
        recommendation: 'Every line of the paragraph, the last one included, is stretched. Use a justification value that keeps the last line unstretched unless the house style asks for this.' },
    LAT_JUSTIFIED_WITHOUT_HYPHENATION: { severity: 'warning', determinism: 'deterministic', source_class: 'adobe',
        source_ref: 'justified paragraph with hyphenation off',
        recommendation: 'A justified paragraph has hyphenation off, which tends to give loose lines. Turn hyphenation on or use another alignment if the house style requires it; the effect on spacing is a judgement.' },
};
const isAsciiDigit = (codePoint) => codePoint >= 0x30 && codePoint <= 0x39;
const isLatinLetter = (codePoint) => (codePoint >= 0x41 && codePoint <= 0x5A) || (codePoint >= 0x61 && codePoint <= 0x7A) ||
    (codePoint >= 0xC0 && codePoint <= 0x24F && codePoint !== 0xD7 && codePoint !== 0xF7);
const isLatinAlnum = (codePoint) => isLatinLetter(codePoint) || isAsciiDigit(codePoint);
function isJapaneseLetter(codePoint) {
    return (codePoint >= 0x3041 && codePoint <= 0x30FF) || (codePoint >= 0x31F0 && codePoint <= 0x31FF) ||
        (codePoint >= 0x3400 && codePoint <= 0x4DBF) || (codePoint >= 0x4E00 && codePoint <= 0x9FFF) ||
        (codePoint >= 0xF900 && codePoint <= 0xFAFF) || (codePoint >= 0xFF66 && codePoint <= 0xFF9F) ||
        (codePoint >= 0x20000 && codePoint <= 0x3FFFF) || (codePoint >= 0x3005 && codePoint <= 0x3007);
}
const SPACE_LIKE = new Set([0x20, 0x09, 0xA0, 0x2009, 0x202F]);
const WRAPPING = new Set([0x22, 0x27, 0x28, 0x29, 0x5B, 0x5D, 0x7B, 0x7D, 0x2018, 0x2019, 0x201C, 0x201D]);
const WHITESPACE_RUN = /[ \t  -  　]+/u;
function codePointBefore(contents, end) {
    if (end <= 0 || isBreakUnit(contents, end - 1))
        return null;
    return clusterBefore(contents, end)?.codePoint ?? null;
}
function codePointAt(contents, start) {
    if (start >= contents.length || isBreakUnit(contents, start))
        return null;
    return clusterAt(contents, start)?.codePoint ?? null;
}
const skippable = (unit) => SPACE_LIKE.has(unit) || WRAPPING.has(unit);
function nonSpaceBefore(contents, start) {
    let index = start;
    while (index > 0 && skippable(contents.charCodeAt(index - 1)))
        index -= 1;
    return codePointBefore(contents, index);
}
function nonSpaceAfter(contents, end) {
    let index = end;
    while (index < contents.length && skippable(contents.charCodeAt(index)))
        index += 1;
    return codePointAt(contents, index);
}
function inLatinText(contents, start, end) {
    const before = nonSpaceBefore(contents, start);
    const after = nonSpaceAfter(contents, end);
    return (before !== null && isLatinAlnum(before)) || (after !== null && isLatinAlnum(after));
}
const EXCERPT_RADIUS = 20;
function excerptAround(contents, start, end) {
    let from = Math.max(0, start - EXCERPT_RADIUS);
    let to = Math.min(contents.length, end + EXCERPT_RADIUS);
    const low = (unit) => unit >= 0xDC00 && unit <= 0xDFFF;
    const high = (unit) => unit >= 0xD800 && unit <= 0xDBFF;
    if (from < start && low(contents.charCodeAt(from)))
        from += 1;
    if (to > end && high(contents.charCodeAt(to - 1)))
        to -= 1;
    return contents.substring(from, to).replace(/[\r\n\u0003]/gu, '↵');
}
function hasLatinLetter(text) {
    for (let index = 0; index < text.length;) {
        const codePoint = text.codePointAt(index);
        if (isLatinLetter(codePoint))
            return true;
        index += codePoint > 0xFFFF ? 2 : 1;
    }
    return false;
}
function hasJapanese(text) {
    for (let index = 0; index < text.length;) {
        const codePoint = text.codePointAt(index);
        if (isJapanese(codePoint))
            return true;
        index += codePoint > 0xFFFF ? 2 : 1;
    }
    return false;
}
const LINE_RULES = ['LAT_BREAK_BETWEEN_NUMBER_AND_UNIT', 'LAT_PROTECTED_TERM_SPLIT', 'MIX_LATIN_WORD_SPLIT',
    'LAT_EMERGENCY_WORD_BREAK', 'LAT_HYPHEN_LADDER', 'LAT_RUNT'];
const JUSTIFIED_VALUES = new Set(['FULLJUSTIFY', 'FULLJUSTIFYLASTLINELEFT', 'FULLJUSTIFYLASTLINECENTER',
    'FULLJUSTIFYLASTLINERIGHT']);
function wordAround(contents, offset) {
    let start = offset;
    for (let cp = codePointBefore(contents, start); cp !== null && isLatinAlnum(cp); cp = codePointBefore(contents, start)) {
        start = clusterBefore(contents, start).start;
    }
    let end = offset;
    for (let cp = codePointAt(contents, end); cp !== null && isLatinAlnum(cp); cp = codePointAt(contents, end)) {
        end = clusterAt(contents, end).end;
    }
    return { start, end };
}
function inJapaneseText(contents, word) {
    const before = nonSpaceBefore(contents, word.start);
    const after = nonSpaceAfter(contents, word.end);
    return (before !== null && isJapanese(before)) || (after !== null && isJapanese(after));
}
function scanContents(contents, requested, lineOf, out) {
    const push = (rule, start, end) => {
        out.push({ rule, anchor: start, range: { start, end }, lineIndex: lineOf(start),
            evidence: { character: contents.substring(start, end), excerpt: excerptAround(contents, start, end) } });
    };
    const wantsQuote = requested.has('LAT_STRAIGHT_QUOTE');
    const wantsDash = requested.has('LAT_TYPEWRITER_DASH');
    const wantsPeriods = requested.has('LAT_THREE_PERIODS');
    const wantsRange = requested.has('LAT_NUMERIC_RANGE_HYPHEN');
    const wantsSpace = requested.has('MIX_ASCII_SPACE_AROUND_LATIN');
    for (let index = 0; index < contents.length;) {
        const unit = contents.charCodeAt(index);
        if (unit === 0x22 || unit === 0x27) {
            if (wantsQuote) {
                const previous = index > 0 ? contents.charCodeAt(index - 1) : -1;
                if (isAsciiDigit(previous))
                    push('LAT_PRIME_CANDIDATE', index, index + 1);
                else if (inLatinText(contents, index, index + 1))
                    push('LAT_STRAIGHT_QUOTE', index, index + 1);
            }
            index += 1;
        }
        else if (unit === 0x2D || unit === 0x2E || unit === 0x20) {
            let end = index;
            while (end < contents.length && contents.charCodeAt(end) === unit)
                end += 1;
            const length = end - index;
            if (unit === 0x2D) {
                if (wantsDash && (length === 2 || length === 3) && inLatinText(contents, index, end))
                    push('LAT_TYPEWRITER_DASH', index, end);
                if (wantsRange && length === 1 && isNumericRange(contents, index))
                    push('LAT_NUMERIC_RANGE_HYPHEN', index, end);
            }
            else if (unit === 0x2E) {
                if (wantsPeriods && length === 3 && inLatinText(contents, index, end))
                    push('LAT_THREE_PERIODS', index, end);
            }
            else if (wantsSpace) {
                const before = codePointBefore(contents, index);
                const after = codePointAt(contents, end);
                if (before !== null && after !== null &&
                    ((isJapaneseLetter(before) && isLatinAlnum(after)) || (isLatinAlnum(before) && isJapaneseLetter(after)))) {
                    push('MIX_ASCII_SPACE_AROUND_LATIN', index, end);
                }
            }
            index = end;
        }
        else {
            index += 1;
        }
    }
}
function isNumericRange(contents, hyphen) {
    const digitBefore = hyphen > 0 && isAsciiDigit(contents.charCodeAt(hyphen - 1));
    const digitAfter = hyphen + 1 < contents.length && isAsciiDigit(contents.charCodeAt(hyphen + 1));
    if (!digitBefore || !digitAfter)
        return false;
    let start = hyphen;
    while (start > 0 && (isAsciiDigit(contents.charCodeAt(start - 1)) || contents.charCodeAt(start - 1) === 0x2D))
        start -= 1;
    let end = hyphen + 1;
    while (end < contents.length && (isAsciiDigit(contents.charCodeAt(end)) || contents.charCodeAt(end) === 0x2D))
        end += 1;
    if (contents.substring(start, end).split('-').length !== 2)
        return false;
    const attached = (codePoint) => codePoint !== null && (isLatinLetter(codePoint) || codePoint === 0x5F);
    return !attached(codePointBefore(contents, start)) && !attached(codePointAt(contents, end));
}
const compareLongestFirst = (left, right) => right.length - left.length || (left < right ? -1 : left > right ? 1 : 0);
export function evaluateLatinBodyFrame(settings, frame) {
    const requested = new Set(settings.input.rules);
    const findings = [];
    const skipped = [];
    const incomplete = new Set();
    const { contents } = frame;
    const lineOf = (offset) => {
        if (!frame.linesReadable)
            return null;
        const index = frame.lines.findIndex((line) => line !== null && line.start <= offset && offset < line.end);
        return index < 0 ? null : index;
    };
    const skip = (rule, reason) => {
        if (!skipped.some((entry) => entry.rule === rule && entry.reason === reason))
            skipped.push({ rule, reason });
    };
    scanContents(contents, requested, lineOf, findings);
    const wantedLineRules = LINE_RULES.filter((rule) => requested.has(rule));
    const lineSkip = frame.orientation === 'vertical' ? 'vertical_text_not_measured'
        : frame.linesReadable ? null : 'lines_unreadable';
    if (lineSkip !== null)
        for (const rule of wantedLineRules)
            skip(rule, lineSkip);
    const lineRule = (rule) => lineSkip === null && requested.has(rule);
    const paragraphOf = (offset) => frame.paragraphs.find((paragraph) => paragraph.start <= offset - 1 && offset - 1 < paragraph.end) ?? null;
    const needHyphenation = (rule, paragraph) => {
        if (paragraph === null || paragraph.hyphenation === null) {
            skip(rule, 'paragraph_attribute_unreadable');
            incomplete.add('unreadable_paragraph_attribute');
            return null;
        }
        return paragraph.hyphenation;
    };
    const wordBreaks = [];
    if (lineSkip === null) {
        for (const { offset, prevLine } of frame.softWraps) {
            const tail = clusterBefore(contents, offset);
            const head = clusterAt(contents, offset);
            if (tail === null || head === null || !isLatinLetter(tail.codePoint) || !isLatinLetter(head.codePoint))
                continue;
            const word = wordAround(contents, offset);
            wordBreaks.push({ offset, prevLine, word, japanese: inJapaneseText(contents, word), tail: tail.text, head: head.text });
        }
    }
    if (lineRule('MIX_LATIN_WORD_SPLIT')) {
        for (const brk of wordBreaks.filter((entry) => entry.japanese)) {
            findings.push({ rule: 'MIX_LATIN_WORD_SPLIT', anchor: brk.offset, range: brk.word, lineIndex: brk.prevLine,
                evidence: { character: contents.substring(brk.word.start, brk.word.end), prev_line_tail: brk.tail, next_line_head: brk.head } });
        }
    }
    if (lineRule('LAT_EMERGENCY_WORD_BREAK')) {
        for (const brk of wordBreaks.filter((entry) => !entry.japanese)) {
            const hyphenation = needHyphenation('LAT_EMERGENCY_WORD_BREAK', paragraphOf(brk.offset));
            if (hyphenation !== false)
                continue;
            findings.push({ rule: 'LAT_EMERGENCY_WORD_BREAK', anchor: brk.offset, range: brk.word, lineIndex: brk.prevLine,
                evidence: { character: contents.substring(brk.word.start, brk.word.end), prev_line_tail: brk.tail, next_line_head: brk.head,
                    hyphenation: false } });
        }
    }
    if (lineRule('LAT_HYPHEN_LADDER')) {
        const limit = settings.input.max_consecutive_hyphens;
        const hyphenated = new Set();
        for (const brk of wordBreaks.filter((entry) => !entry.japanese)) {
            if (needHyphenation('LAT_HYPHEN_LADDER', paragraphOf(brk.offset)) === true)
                hyphenated.add(brk.prevLine);
        }
        const ordered = [...hyphenated].sort((left, right) => left - right);
        for (let index = 0; index < ordered.length;) {
            let last = index;
            while (last + 1 < ordered.length && ordered[last + 1] === ordered[last] + 1)
                last += 1;
            const count = last - index + 1;
            const first = frame.lines[ordered[index]];
            const end = frame.lines[ordered[last]];
            if (count > limit) {
                findings.push({ rule: 'LAT_HYPHEN_LADDER', anchor: first.start, range: { start: first.start, end: end.end }, lineIndex: ordered[index],
                    evidence: { consecutive_hyphen_lines: count, max_consecutive_hyphens: limit, hyphenation: true } });
            }
            index = last + 1;
        }
    }
    if (lineRule('LAT_PROTECTED_TERM_SPLIT')) {
        for (const term of settings.protectedTerms) {
            for (let from = contents.indexOf(term); from >= 0; from = contents.indexOf(term, from + 1)) {
                const end = from + term.length;
                const crossing = frame.softWraps.find((wrap) => from < wrap.offset && wrap.offset < end);
                if (crossing === undefined)
                    continue;
                findings.push({ rule: 'LAT_PROTECTED_TERM_SPLIT', anchor: crossing.offset, range: { start: from, end }, lineIndex: crossing.prevLine,
                    evidence: { term, character: term, prev_line_tail: clusterBefore(contents, crossing.offset)?.text ?? null,
                        next_line_head: clusterAt(contents, crossing.offset)?.text ?? null } });
            }
        }
    }
    if (lineRule('LAT_BREAK_BETWEEN_NUMBER_AND_UNIT')) {
        const units = [...(settings.input.units ?? [])].sort(compareLongestFirst);
        const references = [...(settings.input.references ?? [])].sort(compareLongestFirst);
        for (const { offset, prevLine } of frame.softWraps) {
            let tailEnd = offset;
            while (tailEnd > 0 && contents.charCodeAt(tailEnd - 1) === 0x20)
                tailEnd -= 1;
            if (tailEnd === offset || tailEnd === 0)
                continue;
            const found = numberThenUnit(contents, tailEnd, offset, units) ?? referenceThenNumber(contents, tailEnd, offset, references);
            if (found === null)
                continue;
            findings.push({ rule: 'LAT_BREAK_BETWEEN_NUMBER_AND_UNIT', anchor: offset, range: { start: found.start, end: found.end },
                lineIndex: prevLine, evidence: { term: found.term, character: contents.substring(found.start, found.end),
                    prev_line_tail: clusterBefore(contents, offset)?.text ?? null, next_line_head: clusterAt(contents, offset)?.text ?? null } });
        }
    }
    if (lineRule('LAT_RUNT')) {
        const minimum = settings.input.runt_min_characters;
        for (const paragraph of frame.paragraphs) {
            const own = frame.lines.map((line, index) => ({ line, index }))
                .filter((entry) => entry.line !== null && paragraph.start <= entry.line.start && entry.line.start < paragraph.end);
            const last = own.length === 0 ? null : own[own.length - 1];
            if (last === null || last.line.end < paragraph.end) {
                incomplete.add('overset_paragraph');
                continue;
            }
            if (own.length < 2)
                continue;
            const text = contents.substring(last.line.start, last.line.end);
            const words = text.split(WHITESPACE_RUN).filter((word) => word.length > 0);
            if (words.length !== 1 || hasJapanese(text) || !hasLatinLetter(text))
                continue;
            const characters = countCharacters(words[0]);
            if (characters === null) {
                incomplete.add('unreadable_line');
                continue;
            }
            if (characters < minimum) {
                findings.push({ rule: 'LAT_RUNT', anchor: last.line.start, range: { start: last.line.start, end: last.line.end }, lineIndex: last.index,
                    evidence: { last_line_characters: characters, min_characters: minimum, character: words[0] } });
            }
        }
    }
    const wantsFull = requested.has('LAT_JUSTIFY_ALL_LINES');
    const wantsLoose = requested.has('LAT_JUSTIFIED_WITHOUT_HYPHENATION');
    if (wantsFull || wantsLoose) {
        for (const paragraph of frame.paragraphs) {
            if (!hasLatinLetter(contents.substring(paragraph.start, paragraph.end)))
                continue;
            const lastLine = frame.linesReadable
                ? frame.lines.map((line, index) => ({ line, index })).filter((entry) => entry.line !== null && paragraph.start <= entry.line.start &&
                    entry.line.start < paragraph.end).pop() ?? null
                : null;
            if (paragraph.justification === null) {
                if (wantsFull)
                    skip('LAT_JUSTIFY_ALL_LINES', 'paragraph_attribute_unreadable');
                if (wantsLoose)
                    skip('LAT_JUSTIFIED_WITHOUT_HYPHENATION', 'paragraph_attribute_unreadable');
                incomplete.add('unreadable_paragraph_attribute');
                continue;
            }
            const range = { start: paragraph.start, end: paragraph.end };
            if (wantsFull && paragraph.justification === 'FULLJUSTIFY') {
                findings.push({ rule: 'LAT_JUSTIFY_ALL_LINES', anchor: paragraph.start, range, lineIndex: lastLine?.index ?? null,
                    evidence: { justification: paragraph.justification } });
            }
            if (wantsLoose && JUSTIFIED_VALUES.has(paragraph.justification)) {
                const hyphenation = needHyphenation('LAT_JUSTIFIED_WITHOUT_HYPHENATION', paragraph);
                if (hyphenation === false) {
                    findings.push({ rule: 'LAT_JUSTIFIED_WITHOUT_HYPHENATION', anchor: paragraph.start, range, lineIndex: lastLine?.index ?? null,
                        evidence: { justification: paragraph.justification, hyphenation: false } });
                }
            }
        }
    }
    return { findings, skipped, incomplete: [...incomplete] };
}
function numberThenUnit(contents, tailEnd, offset, units) {
    if (!isAsciiDigit(contents.charCodeAt(tailEnd - 1)))
        return null;
    let start = tailEnd;
    while (start > 0) {
        const unit = contents.charCodeAt(start - 1);
        const separator = (unit === 0x2E || unit === 0x2C) && start >= 2 && isAsciiDigit(contents.charCodeAt(start - 2)) &&
            start < tailEnd && isAsciiDigit(contents.charCodeAt(start));
        if (!isAsciiDigit(unit) && !separator)
            break;
        start -= 1;
    }
    for (const term of units) {
        if (!contents.startsWith(term, offset))
            continue;
        const after = codePointAt(contents, offset + term.length);
        if (after !== null && isLatinAlnum(after))
            continue;
        return { start, end: offset + term.length, term };
    }
    return null;
}
function referenceThenNumber(contents, tailEnd, offset, references) {
    if (!isAsciiDigit(contents.charCodeAt(offset)))
        return null;
    for (const term of references) {
        const start = tailEnd - term.length;
        if (start < 0 || contents.substring(start, tailEnd) !== term)
            continue;
        const before = codePointBefore(contents, start);
        if (before !== null && isLatinAlnum(before))
            continue;
        let end = offset;
        while (end < contents.length) {
            const unit = contents.charCodeAt(end);
            const separator = (unit === 0x2E || unit === 0x2C) && end + 1 < contents.length && isAsciiDigit(contents.charCodeAt(end + 1));
            if (!isAsciiDigit(unit) && !separator)
                break;
            end += 1;
        }
        return { start, end, term };
    }
    return null;
}
