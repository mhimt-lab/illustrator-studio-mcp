import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseTtf } from './ttf.js';
export const OCRB_FONT_SHA256 = '367d876cca948ecd4900851f6e85687cbb6e71de9d0d2f36348edec5655526af';
export const OCRB_FONT_URL = new URL('../../assets/fonts/ocr-b/OCR-B.ttf', import.meta.url);
export class NumeralFontError extends Error {
    constructor(message) {
        super(`BARCODE_NUMERAL_FONT_INVALID: ${message}`);
        this.name = 'NumeralFontError';
    }
}
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export function contourToBezier(contour) {
    let points = [...contour];
    if (points.length < 3)
        return [];
    if (!points[0].onCurve) {
        if (points[points.length - 1].onCurve)
            points = [points[points.length - 1], ...points.slice(0, -1)];
        else {
            const m = mid([points[0].x, points[0].y], [points[points.length - 1].x, points[points.length - 1].y]);
            points = [{ x: m[0], y: m[1], onCurve: true }, ...points];
        }
    }
    const start = [points[0].x, points[0].y];
    const segments = [];
    const quad = (p0, q, p1) => ({ from: p0, c1: lerp(p0, q, 2 / 3), c2: lerp(p1, q, 2 / 3), to: p1 });
    let current = start;
    let pending = null;
    for (const point of points.slice(1)) {
        const here = [point.x, point.y];
        if (point.onCurve) {
            segments.push(pending === null ? { from: current, c1: null, c2: null, to: here } : quad(current, pending, here));
            current = here;
            pending = null;
        }
        else if (pending === null)
            pending = here;
        else {
            const m = mid(pending, here);
            segments.push(quad(current, pending, m));
            current = m;
            pending = here;
        }
    }
    segments.push(pending === null ? { from: current, c1: null, c2: null, to: start } : quad(current, pending, start));
    const kept = segments.filter((segment) => !(segment.c1 === null && segment.from[0] === segment.to[0] && segment.from[1] === segment.to[1]));
    return kept.map((segment, index) => {
        const before = kept[(index + kept.length - 1) % kept.length];
        return { anchor: segment.from, right: segment.c1 ?? segment.from, left: before.c2 ?? segment.from };
    });
}
let cached = null;
export function parseNumeralFont(bytes, expectedSha256 = OCRB_FONT_SHA256) {
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (sha !== expectedSha256)
        throw new NumeralFontError(`the font file differs from the pinned one (sha256 ${sha}); it must stay byte for byte as obtained`);
    const font = parseTtf(bytes);
    const digits = {};
    let inkBottom = Infinity;
    let inkTop = -Infinity;
    for (const digit of '0123456789') {
        const glyphId = font.glyphIdForCodePoint(digit.charCodeAt(0));
        if (glyphId === 0)
            throw new NumeralFontError(`the font has no glyph for "${digit}"`);
        const glyph = font.glyph(glyphId);
        const contours = glyph.contours.map(contourToBezier).filter((contour) => contour.length >= 3);
        if (contours.length === 0)
            throw new NumeralFontError(`the glyph for "${digit}" has no outline`);
        for (const contour of contours)
            for (const point of contour)
                for (const [, y] of [point.anchor, point.left, point.right]) {
                    inkBottom = Math.min(inkBottom, y);
                    inkTop = Math.max(inkTop, y);
                }
        digits[digit] = { digit, contours, advance: glyph.advance };
    }
    return { digits, inkBottom, inkTop };
}
export function numeralFont() {
    if (cached === null)
        cached = parseNumeralFont(readFileSync(fileURLToPath(OCRB_FONT_URL)));
    return cached;
}
export function placeNumeral(digit, heightPt, centerXPt, baselineYPt) {
    const font = numeralFont();
    const outline = font.digits[digit];
    if (outline === undefined)
        throw new NumeralFontError(`no outline for "${digit}"`);
    const scale = heightPt / (font.inkTop - font.inkBottom);
    const map = (p) => [centerXPt + (p[0] - outline.advance / 2) * scale, baselineYPt - (p[1] - font.inkBottom) * scale];
    return outline.contours.map((contour) => contour.map((point) => [...map(point.anchor), ...map(point.left), ...map(point.right)]));
}
