import { z } from 'zod';
export const PLAN_TEXT_INCREMENT_LIMITS = { items: 64, days: 36_500, delta: 1_000_000_000, digits: 9 };
export const textIncrementRuleSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('date_shift'), days: z.number().int().min(-PLAN_TEXT_INCREMENT_LIMITS.days).max(PLAN_TEXT_INCREMENT_LIMITS.days) }),
    z.strictObject({ kind: z.literal('date_set'), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    z.strictObject({
        kind: z.literal('number_add'),
        delta: z.number().int().min(-PLAN_TEXT_INCREMENT_LIMITS.delta).max(PLAN_TEXT_INCREMENT_LIMITS.delta),
        occurrence: z.number().int().min(0).max(PLAN_TEXT_INCREMENT_LIMITS.items).optional(),
    }),
]);
const editSchema = z.object({ start: z.number().int(), end: z.number().int(), before: z.string(), after: z.string() });
const issueSchema = z.object({ code: z.string(), message: z.string(), start: z.number().int().optional(), end: z.number().int().optional() });
const itemSchema = z.object({
    kind: z.enum(['date', 'number']),
    start: z.number().int(),
    end: z.number().int(),
    before: z.string(),
    after: z.string(),
    date: z.object({ from: z.string(), to: z.string() }).optional(),
    weekday: z.object({ found: z.string(), expected: z.string() }).optional(),
    edits: z.array(editSchema),
});
export const planTextIncrementResultSchema = z.object({
    document_key: z.string().min(1),
    target_uuid: z.string().min(1),
    status: z.enum(['ready', 'blocked', 'nothing_to_change']),
    text_length: z.number().int().nonnegative(),
    items: z.array(itemSchema),
    refusals: z.array(issueSchema),
    warnings: z.array(issueSchema),
    next_calls: z.array(z.object({ tool: z.string(), arguments: z.record(z.string(), z.unknown()), note: z.string() })),
});
const WEEKDAYS = '日月火水木金土';
const FULL_DIGITS = '０１２３４５６７８９';
const DAY_MS = 86_400_000;
function normalizeDigits(raw) {
    let out = '';
    for (const ch of raw) {
        const index = FULL_DIGITS.indexOf(ch);
        out += index >= 0 ? String(index) : ch;
    }
    return out;
}
function toFullWidth(digits) {
    return [...digits].map((ch) => FULL_DIGITS[Number(ch)] ?? ch).join('');
}
function isFullWidthDigit(ch) {
    return ch !== undefined && FULL_DIGITS.includes(ch);
}
function isRealDate({ year, month, day }) {
    if (month < 1 || month > 12 || day < 1 || year < 1900 || year > 2200)
        return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
function addDays(value, days) {
    const date = new Date(Date.UTC(value.year, value.month - 1, value.day) + days * DAY_MS);
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}
function weekdayOf(value) {
    return WEEKDAYS[new Date(Date.UTC(value.year, value.month - 1, value.day)).getUTCDay()];
}
function isoOf(value) {
    return `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
}
export function parseIsoDate(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (match === null)
        return null;
    const value = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
    return isRealDate(value) ? value : null;
}
function formatLike(original, value, minLength = 1) {
    let digits = String(value);
    const padded = original.length >= 2 && (original[0] === '0' || original[0] === '０');
    if (padded)
        digits = digits.padStart(original.length, '0');
    digits = digits.padStart(minLength, '0');
    return isFullWidthDigit(original[0]) ? toFullWidth(digits) : digits;
}
function formatNumberLike(raw, value) {
    const comma = /[,，]/.exec(raw)?.[0] ?? null;
    const digitCount = normalizeDigits(raw).replace(/[,，]/g, '').length;
    let digits = String(value);
    if (digitCount >= 2 && /^[0０]/.test(raw))
        digits = digits.padStart(digitCount, '0');
    if (comma !== null)
        digits = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const wide = isFullWidthDigit(raw.replace(/[,，]/g, '')[0]);
    const converted = wide ? toFullWidth(digits) : digits;
    return comma === null ? converted : converted.replace(/,/g, comma);
}
export function minimalEdit(before, after, offset) {
    if (before === after)
        return null;
    let prefix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix])
        prefix++;
    let suffix = 0;
    while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix])
        suffix++;
    while ((prefix + suffix >= before.length || prefix + suffix >= after.length) && suffix > 0)
        suffix--;
    while ((prefix >= before.length || prefix >= after.length) && prefix > 0)
        prefix--;
    return {
        start: offset + prefix,
        end: offset + before.length - suffix,
        before: before.slice(prefix, before.length - suffix),
        after: after.slice(prefix, after.length - suffix),
    };
}
function applyEdits(text, edits) {
    let out = text;
    for (const edit of [...edits].sort((a, b) => b.start - a.start))
        out = out.slice(0, edit.start) + edit.after + out.slice(edit.end);
    return out;
}
const D = '[0-9０-９]';
const WEEKDAY_CHARS = '月火水木金土日';
const WEEKDAY_BRACKET = `[（(]([${WEEKDAY_CHARS}])[）)]`;
const SLASH = '[/／]';
function scan(text, wantNumbers) {
    const consumed = new Array(text.length).fill(false);
    const free = (start, end) => {
        for (let index = start; index < end; index++)
            if (consumed[index])
                return false;
        return true;
    };
    const take = (start, end) => { for (let index = start; index < end; index++)
        consumed[index] = true; };
    const result = { dates: [], numbers: [], unresolved: [] };
    const matches = (pattern) => [...text.matchAll(new RegExp(pattern, 'gd'))];
    const unresolve = (scope, code, message, start, end) => {
        result.unresolved.push({ code, message, start, end, scope });
    };
    const group = (match, index) => {
        const [start, end] = match.indices[index];
        return { raw: match[index], span: { start, end } };
    };
    for (const match of matches(`(令和|平成|昭和|大正|明治)\\s?(${D}{1,4}|元)年`)) {
        const start = match.index, end = start + match[0].length;
        if (!free(start, end))
            continue;
        take(start, end);
        unresolve('date', 'japanese_era_unsupported', 'A Japanese-era year is not supported: the year of the era cannot be moved with the date.', start, end);
    }
    for (const match of matches(`(?<![0-9０-９:：])${D}{1,2}[:：]${D}{2}(?!${D})`)) {
        const start = match.index, end = start + match[0].length;
        if (free(start, end))
            take(start, end);
    }
    const takeBracket = (at) => {
        const bracket = new RegExp(`^${WEEKDAY_BRACKET}`).exec(text.slice(at));
        return bracket !== null && free(at, at + bracket[0].length) ? bracket[0].length : 0;
    };
    const dateFrom = (start, year, month, day, dateEnd) => {
        const rawEnd = dateEnd;
        if (!free(start, rawEnd))
            return;
        const token = { start, end: rawEnd, explicitYear: year !== null, year, month, day, weekday: null, dateEnd: rawEnd };
        const rest = text.slice(rawEnd);
        const bracket = new RegExp(`^${WEEKDAY_BRACKET}`).exec(rest);
        if (bracket !== null && free(rawEnd, rawEnd + bracket[0].length)) {
            const kanjiStart = rawEnd + bracket[0].indexOf(bracket[1]);
            token.weekday = { raw: bracket[1], span: { start: kanjiStart, end: kanjiStart + 1 } };
            token.end = rawEnd + bracket[0].length;
        }
        else if (/^[（(](?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\.?[）)]/i.test(rest)) {
            const length = rest.indexOf(rest.includes('）') ? '）' : ')') + 1;
            take(rawEnd, rawEnd + length);
            unresolve('date', 'english_weekday_unsupported', 'An English weekday is not supported; the weekday is not guessed.', rawEnd, rawEnd + length);
        }
        else if (new RegExp(`^[（(][${WEEKDAY_CHARS}]曜日?[）)]`).test(rest)) {
            const length = rest.search(/[）)]/) + 1;
            take(rawEnd, rawEnd + length);
            unresolve('date', 'weekday_notation_unsupported', 'Only a single weekday character in brackets, such as （火） or (火), is supported.', rawEnd, rawEnd + length);
        }
        take(start, token.end);
        result.dates.push(token);
    };
    for (const match of matches(`(${D}{4})年(${D}{1,2})月(${D}{1,2})日`)) {
        dateFrom(match.index, group(match, 1), group(match, 2), group(match, 3), match.index + match[0].length);
    }
    for (const match of matches(`(?<![0-9０-９/／])(${D}{4})${SLASH}(${D}{1,2})${SLASH}(${D}{1,2})(?!${D})`)) {
        dateFrom(match.index, group(match, 1), group(match, 2), group(match, 3), match.index + match[0].length);
    }
    for (const match of matches(`(?<![0-9０-９/／])${D}{1,4}${SLASH}${D}{1,4}${SLASH}${D}{1,4}`)) {
        const start = match.index, end = start + match[0].length;
        if (!free(start, end))
            continue;
        take(start, end);
        unresolve('date', 'ambiguous_slash_date', 'A date with two slashes that does not start with a four-digit year can be read in two ways (month/day/year or year/month/day).', start, end);
    }
    for (const match of matches(`(?<!${D})(${D}{1,2})月(${D}{1,2})日`)) {
        dateFrom(match.index, null, group(match, 1), group(match, 2), match.index + match[0].length);
    }
    for (const match of matches(`(?<![0-9０-９/／])(${D}{1,2})${SLASH}(${D}{1,2})(?![0-9０-９/／])`)) {
        dateFrom(match.index, null, group(match, 1), group(match, 2), match.index + match[0].length);
    }
    for (const match of matches(`(?<![0-9０-９.．])(${D}{1,2})[.．](${D}{1,2})(?![0-9０-９.．])(?=${WEEKDAY_BRACKET})`)) {
        dateFrom(match.index, null, group(match, 1), group(match, 2), match.index + match[0].length);
    }
    if (!wantNumbers) {
        for (const match of matches(`(?<![0-9０-９.．])(${D}{1,2})[.．](${D}{1,2})(?![0-9０-９.．])`)) {
            const start = match.index, end = start + match[0].length;
            const month = Number(normalizeDigits(match[1])), day = Number(normalizeDigits(match[2]));
            if (!free(start, end) || month < 1 || month > 12 || day < 1 || day > 31)
                continue;
            take(start, end);
            unresolve('date', 'dot_date_unsupported', 'A dot date without a bracketed weekday right after it (8.24) cannot be told from a decimal number.', start, end);
        }
    }
    for (const match of matches(`(?<![0-9０-９月/／.．])${D}{1,2}日(?=${WEEKDAY_BRACKET})`)) {
        const start = match.index, end = start + match[0].length;
        if (!free(start, end))
            continue;
        take(start, end + takeBracket(end));
        unresolve('date', 'day_only_date_unsupported', 'A day without its month (11日) needs the month of an earlier date; it is not guessed.', start, end);
    }
    for (const match of matches('[（(](?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\\.?[）)]')) {
        const start = match.index, end = start + match[0].length;
        if (!free(start, end))
            continue;
        take(start, end);
        unresolve('date', 'english_weekday_unsupported', 'An English weekday is not supported; the weekday is not guessed.', start, end);
    }
    for (const match of matches(WEEKDAY_BRACKET)) {
        const start = match.index, end = start + match[0].length;
        if (!free(start, end))
            continue;
        take(start, end);
        unresolve('date', 'weekday_without_date', 'A bracketed weekday that does not directly follow a supported date cannot be recalculated.', start, end);
    }
    if (wantNumbers) {
        const numberPattern = `(?<!${D})(?:${D}{1,3}(?:[,，]${D}{3})+|${D}+)(?!${D})`;
        for (const match of matches(numberPattern)) {
            const start = match.index, end = start + match[0].length;
            if (!free(start, end))
                continue;
            take(start, end);
            const before = text[start - 1] ?? '', after = text[end] ?? '';
            const beforeDigit = text[start - 2] ?? '';
            if ((/[.．]/.test(before) && new RegExp(D).test(beforeDigit)) || (/[.．]/.test(after) && new RegExp(D).test(text[end + 1] ?? ''))) {
                unresolve('number', 'decimal_unsupported', 'A number with a decimal point is not supported.', start, end);
            }
            else if (/[A-Za-z]/.test(before) || /[A-Za-z]/.test(after)) {
                unresolve('number', 'number_attached_to_letters', 'A number written together with Latin letters (A4, 3D) may be a code rather than a count.', start, end);
            }
            else if (normalizeDigits(match[0]).replace(/[,，]/g, '').length > PLAN_TEXT_INCREMENT_LIMITS.digits) {
                unresolve('number', 'number_too_long', `A number of more than ${PLAN_TEXT_INCREMENT_LIMITS.digits} digits looks like a code (a JAN or phone number) and is not changed.`, start, end);
            }
            else {
                result.numbers.push({ start, end, raw: match[0] });
            }
        }
    }
    return result;
}
function dateOfToken(token, year) {
    return {
        year: token.year === null ? year : Number(normalizeDigits(token.year.raw)),
        month: Number(normalizeDigits(token.month.raw)),
        day: Number(normalizeDigits(token.day.raw)),
    };
}
export function planTextIncrement(text, year, rule) {
    const numberRule = rule.kind === 'number_add';
    const found = scan(text, numberRule);
    const scope = numberRule ? 'number' : 'date';
    const refusals = found.unresolved.filter((entry) => entry.scope === scope).map(({ scope: _scope, ...issue }) => issue);
    const warnings = [];
    const items = [];
    if (numberRule) {
        let numbers = found.numbers;
        if (rule.occurrence !== undefined) {
            const all = [
                ...found.numbers.map((token) => ({ start: token.start, token })),
                ...found.unresolved.filter((entry) => entry.scope === 'number').map((entry) => ({ start: entry.start ?? 0, token: null })),
            ].sort((a, b) => a.start - b.start);
            const chosen = all[rule.occurrence];
            if (chosen === undefined) {
                refusals.length = 0;
                refusals.push({ code: 'occurrence_out_of_range', message: `occurrence ${rule.occurrence} is outside the ${all.length} number(s) found (0-based).` });
                numbers = [];
            }
            else {
                const issue = chosen.token === null ? refusals.find((entry) => entry.start === chosen.start) : undefined;
                refusals.length = 0;
                if (issue !== undefined)
                    refusals.push(issue);
                numbers = chosen.token === null ? [] : [chosen.token];
            }
        }
        for (const token of numbers) {
            const original = Number(normalizeDigits(token.raw).replace(/[,，]/g, ''));
            const value = original + rule.delta;
            if (value < 0) {
                refusals.push({ code: 'negative_result', message: `${token.raw} ${rule.delta < 0 ? '-' : '+'} ${Math.abs(rule.delta)} is negative.`, start: token.start, end: token.end });
                continue;
            }
            const after = formatNumberLike(token.raw, value);
            const edit = minimalEdit(token.raw, after, token.start);
            items.push({ kind: 'number', start: token.start, end: token.end, before: token.raw, after, edits: edit === null ? [] : [edit] });
        }
    }
    else {
        const targetDate = rule.kind === 'date_set' ? parseIsoDate(rule.to) : null;
        if (rule.kind === 'date_set') {
            const dateLike = found.dates.length + found.unresolved.filter((entry) => entry.scope === 'date' && entry.code !== 'weekday_without_date' && entry.code !== 'english_weekday_unsupported' && entry.code !== 'weekday_notation_unsupported').length;
            if (targetDate === null) {
                refusals.push({ code: 'invalid_target_date', message: `${rule.to} is not a real calendar date between 1900 and 2200.` });
            }
            else if (dateLike >= 2) {
                refusals.push({ code: 'date_set_needs_exactly_one_date', message: `date_set needs exactly one date in the text; ${dateLike} were found. Use date_shift to move several dates.` });
            }
        }
        let baseYear = year;
        let previousMonth = 0;
        for (const token of [...found.dates].sort((a, b) => a.start - b.start)) {
            let tokenYear = baseYear;
            if (token.year === null) {
                const month = Number(normalizeDigits(token.month.raw));
                const day = Number(normalizeDigits(token.day.raw));
                if (month < previousMonth) {
                    const weekdayFits = (y) => token.weekday !== null && isRealDate({ year: y, month, day }) && weekdayOf({ year: y, month, day }) === token.weekday.raw;
                    if (weekdayFits(baseYear)) {
                        tokenYear = baseYear;
                    }
                    else if (weekdayFits(baseYear + 1)) {
                        tokenYear = baseYear + 1;
                        baseYear = tokenYear;
                        warnings.push({ code: 'year_rollover_from_weekday', message: `${text.slice(token.start, token.dateEnd)} comes after a later month and its weekday fits ${tokenYear}, not ${tokenYear - 1}; it is calculated as ${tokenYear}.`, start: token.start, end: token.end });
                    }
                    else {
                        refusals.push({ code: 'year_rollover_ambiguous', message: `${text.slice(token.start, token.dateEnd)} comes after a later month, so it may be in ${baseYear + 1}; ${token.weekday === null ? 'it has no weekday' : `its weekday does not fit ${baseYear + 1}`} to decide, and the year is not guessed.`, start: token.start, end: token.end });
                        continue;
                    }
                }
                previousMonth = month;
            }
            const from = dateOfToken(token, tokenYear);
            if (!isRealDate(from)) {
                refusals.push({ code: 'invalid_date', message: `${text.slice(token.start, token.dateEnd)} is not a real date in ${from.year}.`, start: token.start, end: token.dateEnd });
                continue;
            }
            const to = rule.kind === 'date_shift' ? addDays(from, rule.days) : targetDate ?? from;
            if (!isRealDate(to)) {
                refusals.push({ code: 'result_out_of_range', message: `${text.slice(token.start, token.dateEnd)} moves outside 1900-2200.`, start: token.start, end: token.dateEnd });
                continue;
            }
            if (!token.explicitYear && to.year !== from.year) {
                warnings.push({ code: 'year_changed', message: `${isoOf(to)} is in ${to.year}, not ${from.year}; its weekday is calculated for ${to.year}. The year is not written (the text has none).`, start: token.start, end: token.dateEnd });
            }
            const edits = [];
            const push = (edit) => { if (edit !== null)
                edits.push(edit); };
            if (token.year !== null)
                push(minimalEdit(token.year.raw, formatLike(token.year.raw, to.year, 4), token.year.span.start));
            push(minimalEdit(token.month.raw, formatLike(token.month.raw, to.month), token.month.span.start));
            push(minimalEdit(token.day.raw, formatLike(token.day.raw, to.day), token.day.span.start));
            let weekday;
            if (token.weekday !== null) {
                const expectedBefore = weekdayOf(from);
                const expectedAfter = weekdayOf(to);
                if (token.weekday.raw !== expectedBefore) {
                    warnings.push({ code: 'weekday_mismatch', message: `${token.weekday.raw} does not match ${isoOf(from)}, which is ${expectedBefore}; the weekday is recalculated from the date.`, start: token.weekday.span.start, end: token.weekday.span.end });
                }
                push(minimalEdit(token.weekday.raw, expectedAfter, token.weekday.span.start));
                weekday = { found: token.weekday.raw, expected: expectedAfter };
            }
            const before = text.slice(token.start, token.end);
            const sorted = edits.sort((a, b) => a.start - b.start);
            const after = applyEdits(before, sorted.map((edit) => ({ ...edit, start: edit.start - token.start, end: edit.end - token.start })));
            items.push({ kind: 'date', start: token.start, end: token.end, before, after, date: { from: isoOf(from), to: isoOf(to) }, ...(weekday === undefined ? {} : { weekday }), edits: sorted });
        }
    }
    items.sort((a, b) => a.start - b.start);
    if (items.length > PLAN_TEXT_INCREMENT_LIMITS.items) {
        refusals.push({ code: 'too_many_items', message: `More than ${PLAN_TEXT_INCREMENT_LIMITS.items} items were found; split the text.` });
    }
    const edits = items.flatMap((item) => item.edits).sort((a, b) => b.start - a.start);
    if (items.length === 0 && refusals.length === 0) {
        warnings.push({ code: 'no_target_found', message: numberRule ? 'No number was found in the text.' : 'No supported date was found in the text.' });
    }
    const status = refusals.length > 0 ? 'blocked' : edits.length === 0 ? 'nothing_to_change' : 'ready';
    return { status, items, refusals, warnings, edits };
}
export { applyEdits as applyTextIncrementEdits };
export function buildPlanTextIncrementResult(request, text, unreadable = null) {
    const base = { document_key: request.documentKey, target_uuid: request.targetUuid, text_length: text.length };
    if (unreadable !== null) {
        return planTextIncrementResultSchema.parse({ ...base, status: 'blocked', items: [], refusals: [unreadable], warnings: [], next_calls: [] });
    }
    const plan = planTextIncrement(text, request.year, request.rule);
    const nextCalls = plan.status !== 'ready' ? [] : plan.edits.map((edit, index) => ({
        tool: 'illustrator_replace_text_range',
        arguments: {
            expected_document_key: request.documentKey, target_uuid: request.targetUuid,
            start: edit.start, end: edit.end, replacement: edit.after, apply: false,
        },
        note: `Edit ${index + 1} of ${plan.edits.length} (back to front): plan it, then apply that plan's next_call before the next edit.`,
    }));
    return planTextIncrementResultSchema.parse({ ...base, status: plan.status, items: plan.items, refusals: plan.refusals, warnings: plan.warnings, next_calls: nextCalls });
}
