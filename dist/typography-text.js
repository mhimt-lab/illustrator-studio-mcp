export function isJapanese(codePoint) {
    return (codePoint >= 0x3000 && codePoint <= 0x30FF) || (codePoint >= 0x31F0 && codePoint <= 0x31FF) ||
        (codePoint >= 0x3400 && codePoint <= 0x4DBF) || (codePoint >= 0x4E00 && codePoint <= 0x9FFF) ||
        (codePoint >= 0xF900 && codePoint <= 0xFAFF) || (codePoint >= 0xFF01 && codePoint <= 0xFF60) ||
        (codePoint >= 0xFF66 && codePoint <= 0xFF9F) || (codePoint >= 0x20000 && codePoint <= 0x3FFFF);
}
export const isHigh = (unit) => unit >= 0xD800 && unit <= 0xDBFF;
export const isLow = (unit) => unit >= 0xDC00 && unit <= 0xDFFF;
export function continuationLengthAt(text, index) {
    const unit = text.charCodeAt(index);
    if ((unit >= 0xFE00 && unit <= 0xFE0F) || unit === 0x3099 || unit === 0x309A)
        return 1;
    if (unit === 0xDB40) {
        const next = text.charCodeAt(index + 1);
        if (next >= 0xDD00 && next <= 0xDDEF)
            return 2;
    }
    return 0;
}
export function continuationLengthBefore(text, end) {
    if (end >= 1) {
        const unit = text.charCodeAt(end - 1);
        if ((unit >= 0xFE00 && unit <= 0xFE0F) || unit === 0x3099 || unit === 0x309A)
            return 1;
        if (end >= 2 && unit >= 0xDD00 && unit <= 0xDDEF && text.charCodeAt(end - 2) === 0xDB40)
            return 2;
    }
    return 0;
}
export function clusterBefore(text, end) {
    let baseEnd = end;
    for (let unit = continuationLengthBefore(text, baseEnd); unit > 0; unit = continuationLengthBefore(text, baseEnd))
        baseEnd -= unit;
    if (baseEnd <= 0)
        return null;
    const last = text.charCodeAt(baseEnd - 1);
    if (isHigh(last))
        return null;
    if (isLow(last)) {
        if (baseEnd < 2 || !isHigh(text.charCodeAt(baseEnd - 2)))
            return null;
        return { start: baseEnd - 2, end, codePoint: text.codePointAt(baseEnd - 2), text: text.slice(baseEnd - 2, end) };
    }
    return { start: baseEnd - 1, end, codePoint: last, text: text.slice(baseEnd - 1, end) };
}
export function clusterAt(text, start) {
    if (start >= text.length)
        return null;
    const first = text.charCodeAt(start);
    if (isLow(first) || continuationLengthAt(text, start) > 0)
        return null;
    let end = start + 1;
    if (isHigh(first)) {
        if (!isLow(text.charCodeAt(start + 1)))
            return null;
        end = start + 2;
    }
    for (let unit = continuationLengthAt(text, end); unit > 0; unit = continuationLengthAt(text, end))
        end += unit;
    return { start, end, codePoint: text.codePointAt(start), text: text.slice(start, end) };
}
export function breaksCluster(text, offset) {
    if (offset <= 0 || offset >= text.length)
        return false;
    return (isHigh(text.charCodeAt(offset - 1)) && isLow(text.charCodeAt(offset))) || continuationLengthAt(text, offset) > 0;
}
export function isBreakUnit(text, index) {
    const unit = text.charCodeAt(index);
    return unit === 0x0D || unit === 0x0A || unit === 0x03;
}
export function countCharacters(text) {
    let count = 0;
    for (let index = 0; index < text.length;) {
        if (isBreakUnit(text, index)) {
            index += 1;
            continue;
        }
        const cluster = clusterAt(text, index);
        if (cluster === null)
            return null;
        count += 1;
        index = cluster.end;
    }
    return count;
}
