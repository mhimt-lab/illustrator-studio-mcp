export const ITF14_DIGITS = 14;
export const ITF14_WIDE_NARROW_RATIO = 2.5;
export const ITF14_UNITS_PER_X = 2;
export const ITF14_NARROW_UNITS = 1 * ITF14_UNITS_PER_X;
export const ITF14_WIDE_UNITS = ITF14_WIDE_NARROW_RATIO * ITF14_UNITS_PER_X;
const PATTERNS = ['NNWWN', 'WNNNW', 'NWNNW', 'WWNNN', 'NNWNW', 'WNWNN', 'NWWNN', 'NNNWW', 'WNNWN', 'NWNWN'];
export const ITF14_QUIET_ZONE_X = 10;
export const ITF14_ELEMENT_COUNT = 4 + 7 * 10 + 3;
export const ITF14_SYMBOL_UNITS = 4 * ITF14_NARROW_UNITS + 7 * (4 * ITF14_WIDE_UNITS + 6 * ITF14_NARROW_UNITS) + (ITF14_WIDE_UNITS + 2 * ITF14_NARROW_UNITS);
export function encodeItf14(digits) {
    if (digits.length !== ITF14_DIGITS || !/^[0-9]+$/u.test(digits))
        throw new Error(`encodeItf14 needs exactly ${ITF14_DIGITS} digits.`);
    const elements = [];
    let unit = 0;
    const push = (dark, wide) => {
        const units = wide ? ITF14_WIDE_UNITS : ITF14_NARROW_UNITS;
        elements.push({ dark, wide, startUnit: unit, units });
        unit += units;
    };
    push(true, false);
    push(false, false);
    push(true, false);
    push(false, false);
    for (let pair = 0; pair < ITF14_DIGITS; pair += 2) {
        const barPattern = PATTERNS[Number(digits[pair])];
        const spacePattern = PATTERNS[Number(digits[pair + 1])];
        for (let position = 0; position < 5; position += 1) {
            push(true, barPattern[position] === 'W');
            push(false, spacePattern[position] === 'W');
        }
    }
    push(true, true);
    push(false, false);
    push(true, false);
    if (elements.length !== ITF14_ELEMENT_COUNT || unit !== ITF14_SYMBOL_UNITS)
        throw new Error('ITF-14 encoding produced an unexpected element count or width.');
    return { digits, elements, symbolUnits: unit };
}
export function itf14Bars(encoding) {
    return encoding.elements.filter((element) => element.dark);
}
export function decodeItf14Elements(widthsInUnits) {
    if (widthsInUnits.length !== ITF14_ELEMENT_COUNT)
        return null;
    const isWide = (units) => units === ITF14_WIDE_UNITS ? true : units === ITF14_NARROW_UNITS ? false : null;
    const kinds = widthsInUnits.map(isWide);
    if (kinds.some((kind) => kind === null))
        return null;
    const wide = kinds;
    if (wide.slice(0, 4).some(Boolean) || !wide[ITF14_ELEMENT_COUNT - 3] || wide[ITF14_ELEMENT_COUNT - 2] || wide[ITF14_ELEMENT_COUNT - 1])
        return null;
    let out = '';
    for (let pair = 0; pair < 7; pair += 1) {
        let bar = '';
        let space = '';
        for (let position = 0; position < 5; position += 1) {
            bar += wide[4 + pair * 10 + position * 2] ? 'W' : 'N';
            space += wide[4 + pair * 10 + position * 2 + 1] ? 'W' : 'N';
        }
        const first = PATTERNS.indexOf(bar);
        const second = PATTERNS.indexOf(space);
        if (first < 0 || second < 0)
            return null;
        out += `${first}${second}`;
    }
    return out;
}
