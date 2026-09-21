const EXTENDING_RANGES = [
    [0x0300, 0x036f],
    [0x0483, 0x0489],
    [0x0591, 0x05bd], [0x05bf, 0x05bf], [0x05c1, 0x05c2], [0x05c4, 0x05c5], [0x05c7, 0x05c7],
    [0x0610, 0x061a], [0x064b, 0x065f], [0x0670, 0x0670], [0x06d6, 0x06dc],
    [0x06df, 0x06e4], [0x06e7, 0x06e8], [0x06ea, 0x06ed],
    [0x0711, 0x0711], [0x0730, 0x074a],
    [0x07a6, 0x07b0], [0x07eb, 0x07f3],
    [0x0816, 0x082d], [0x0859, 0x085b],
    [0x1ab0, 0x1aff],
    [0x1dc0, 0x1dff],
    [0x20d0, 0x20f0],
    [0x2cef, 0x2cf1], [0x2d7f, 0x2d7f],
    [0x302a, 0x302f],
    [0x3099, 0x309a],
    [0xa66f, 0xa672], [0xa674, 0xa67d], [0xa69e, 0xa69f],
    [0xfe00, 0xfe0f],
    [0xfe20, 0xfe2f],
    [0x101fd, 0x101fd],
    [0x1f3fb, 0x1f3ff],
    [0xe0100, 0xe01ef],
];
const ZERO_WIDTH_JOINER = 0x200d;
const REGIONAL_INDICATOR = [0x1f1e6, 0x1f1ff];
const UNMEASURED_SCRIPT_RANGES = [
    [0x0900, 0x0dff],
    [0x0e00, 0x0fff],
    [0x1000, 0x109f],
    [0x1780, 0x17ff],
    [0x1a20, 0x1aaf],
    [0xaa60, 0xaa7f],
];
function inRanges(codePoint, ranges) {
    for (const [low, high] of ranges) {
        if (codePoint >= low && codePoint <= high)
            return true;
    }
    return false;
}
function isHighSurrogate(unit) {
    return unit >= 0xd800 && unit <= 0xdbff;
}
function isLowSurrogate(unit) {
    return unit >= 0xdc00 && unit <= 0xdfff;
}
function codePointAt(text, offset) {
    const unit = text.charCodeAt(offset);
    if (Number.isNaN(unit))
        return null;
    if (isLowSurrogate(unit))
        return null;
    if (isHighSurrogate(unit) && offset + 1 < text.length && isLowSurrogate(text.charCodeAt(offset + 1))) {
        return (unit - 0xd800) * 0x400 + (text.charCodeAt(offset + 1) - 0xdc00) + 0x10000;
    }
    return unit;
}
function codePointBefore(text, offset) {
    if (offset <= 0)
        return null;
    const previous = text.charCodeAt(offset - 1);
    if (isLowSurrogate(previous) && offset >= 2 && isHighSurrogate(text.charCodeAt(offset - 2))) {
        return (text.charCodeAt(offset - 2) - 0xd800) * 0x400 + (previous - 0xdc00) + 0x10000;
    }
    return previous;
}
export function hasNonTransportableJoiner(text) {
    return text.indexOf('\u200D') >= 0;
}
export function isClusterBoundary(text, offset) {
    if (offset <= 0 || offset >= text.length)
        return offset === 0 || offset === text.length;
    if (isLowSurrogate(text.charCodeAt(offset)))
        return false;
    const following = codePointAt(text, offset);
    if (following === null)
        return false;
    if (inRanges(following, EXTENDING_RANGES))
        return false;
    if (following === ZERO_WIDTH_JOINER)
        return false;
    const preceding = codePointBefore(text, offset);
    if (preceding === ZERO_WIDTH_JOINER)
        return false;
    if (preceding !== null &&
        preceding >= REGIONAL_INDICATOR[0] && preceding <= REGIONAL_INDICATOR[1] &&
        following >= REGIONAL_INDICATOR[0] && following <= REGIONAL_INDICATOR[1]) {
        return false;
    }
    return true;
}
export function hasUnmeasuredScript(text) {
    for (let offset = 0; offset < text.length;) {
        const codePoint = codePointAt(text, offset);
        if (codePoint === null) {
            offset += 1;
            continue;
        }
        if (inRanges(codePoint, UNMEASURED_SCRIPT_RANGES))
            return true;
        offset += codePoint > 0xffff ? 2 : 1;
    }
    return false;
}
export function validateClusterRange(text, start, end) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
        start < 0 || end > text.length || start >= end) {
        return { reason: 'offset_out_of_range' };
    }
    if (hasNonTransportableJoiner(text))
        return { reason: 'joiner_not_transportable' };
    if (hasUnmeasuredScript(text))
        return { reason: 'unmeasured_script' };
    if (!isClusterBoundary(text, start) || !isClusterBoundary(text, end)) {
        return { reason: 'range_splits_character' };
    }
    return null;
}
