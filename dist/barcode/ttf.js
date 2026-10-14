export class TtfError extends Error {
    constructor(message) {
        super(`TTF: ${message}`);
        this.name = 'TtfError';
    }
}
const MAX_COMPOSITE_DEPTH = 6;
const MAX_POINTS_PER_GLYPH = 4_000;
class Reader {
    bytes;
    view;
    constructor(bytes) {
        this.bytes = bytes;
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    check(offset, length) {
        if (!Number.isInteger(offset) || offset < 0 || length < 0 || offset + length > this.bytes.length)
            throw new TtfError(`a read of ${length} bytes at ${offset} leaves the file (${this.bytes.length} bytes)`);
    }
    u8(offset) { this.check(offset, 1); return this.view.getUint8(offset); }
    i8(offset) { this.check(offset, 1); return this.view.getInt8(offset); }
    u16(offset) { this.check(offset, 2); return this.view.getUint16(offset); }
    i16(offset) { this.check(offset, 2); return this.view.getInt16(offset); }
    u32(offset) { this.check(offset, 4); return this.view.getUint32(offset); }
    tag(offset) { this.check(offset, 4); return String.fromCharCode(this.u8(offset), this.u8(offset + 1), this.u8(offset + 2), this.u8(offset + 3)); }
}
function f2dot14(value) { return value / 16384; }
export function parseTtf(bytes) {
    const r = new Reader(bytes);
    const version = r.u32(0);
    if (version !== 0x00010000 && r.tag(0) !== 'true')
        throw new TtfError(r.tag(0) === 'OTTO' ? 'OpenType/CFF outlines are not supported' : r.tag(0) === 'ttcf' ? 'font collections are not supported' : 'not a TrueType font');
    const tableCount = r.u16(4);
    const tables = new Map();
    for (let index = 0; index < tableCount; index += 1) {
        const base = 12 + index * 16;
        const table = { offset: r.u32(base + 8), length: r.u32(base + 12) };
        if (table.offset + table.length > bytes.length)
            throw new TtfError(`table ${r.tag(base)} leaves the file`);
        tables.set(r.tag(base), table);
    }
    const need = (name) => { const table = tables.get(name); if (table === undefined)
        throw new TtfError(`missing table ${name}`); return table; };
    const head = need('head');
    const maxp = need('maxp');
    const hhea = need('hhea');
    const hmtx = need('hmtx');
    const cmap = need('cmap');
    const loca = need('loca');
    const glyf = need('glyf');
    const unitsPerEm = r.u16(head.offset + 18);
    if (unitsPerEm < 16 || unitsPerEm > 16_384)
        throw new TtfError('unitsPerEm is out of range');
    const longLoca = r.i16(head.offset + 50);
    if (longLoca !== 0 && longLoca !== 1)
        throw new TtfError('indexToLocFormat is invalid');
    const glyphCount = r.u16(maxp.offset + 4);
    const metricCount = r.u16(hhea.offset + 34);
    if (metricCount < 1 || metricCount > glyphCount)
        throw new TtfError('hhea numberOfHMetrics is invalid');
    const advanceOf = (glyphId) => r.u16(hmtx.offset + 4 * Math.min(glyphId, metricCount - 1));
    const glyphRange = (glyphId) => {
        if (!Number.isInteger(glyphId) || glyphId < 0 || glyphId >= glyphCount)
            throw new TtfError(`glyph ${glyphId} does not exist`);
        const start = longLoca === 1 ? r.u32(loca.offset + 4 * glyphId) : r.u16(loca.offset + 2 * glyphId) * 2;
        const end = longLoca === 1 ? r.u32(loca.offset + 4 * glyphId + 4) : r.u16(loca.offset + 2 * glyphId + 2) * 2;
        if (end < start || end > glyf.length)
            throw new TtfError(`glyph ${glyphId} has an invalid location`);
        return { start, end };
    };
    function readSimple(base, contourCount) {
        const endPoints = [];
        for (let index = 0; index < contourCount; index += 1)
            endPoints.push(r.u16(base + 10 + 2 * index));
        const pointCount = contourCount === 0 ? 0 : endPoints[contourCount - 1] + 1;
        if (pointCount > MAX_POINTS_PER_GLYPH)
            throw new TtfError('a glyph has too many points');
        for (let index = 1; index < endPoints.length; index += 1)
            if (endPoints[index] <= endPoints[index - 1])
                throw new TtfError('contour end points are not increasing');
        let cursor = base + 10 + 2 * contourCount;
        cursor += 2 + r.u16(cursor);
        const flags = [];
        while (flags.length < pointCount) {
            const flag = r.u8(cursor);
            cursor += 1;
            flags.push(flag);
            if (flag & 0x08) {
                const repeat = r.u8(cursor);
                cursor += 1;
                for (let n = 0; n < repeat && flags.length < pointCount; n += 1)
                    flags.push(flag);
            }
        }
        const xs = [];
        let x = 0;
        for (const flag of flags) {
            if (flag & 0x02) {
                const delta = r.u8(cursor);
                cursor += 1;
                x += flag & 0x10 ? delta : -delta;
            }
            else if (!(flag & 0x10)) {
                x += r.i16(cursor);
                cursor += 2;
            }
            xs.push(x);
        }
        const ys = [];
        let y = 0;
        for (const flag of flags) {
            if (flag & 0x04) {
                const delta = r.u8(cursor);
                cursor += 1;
                y += flag & 0x20 ? delta : -delta;
            }
            else if (!(flag & 0x20)) {
                y += r.i16(cursor);
                cursor += 2;
            }
            ys.push(y);
        }
        const contours = [];
        let first = 0;
        for (const last of endPoints) {
            const contour = [];
            for (let index = first; index <= last; index += 1)
                contour.push({ x: xs[index], y: ys[index], onCurve: (flags[index] & 0x01) !== 0 });
            contours.push(contour);
            first = last + 1;
        }
        return contours;
    }
    function readGlyph(glyphId, depth) {
        if (depth > MAX_COMPOSITE_DEPTH)
            throw new TtfError('composite glyphs are nested too deeply');
        const { start, end } = glyphRange(glyphId);
        if (end === start)
            return [];
        const base = glyf.offset + start;
        const contourCount = r.i16(base);
        if (contourCount >= 0)
            return readSimple(base, contourCount);
        const contours = [];
        let cursor = base + 10;
        for (;;) {
            const flags = r.u16(cursor);
            const component = r.u16(cursor + 2);
            cursor += 4;
            if (!(flags & 0x0002))
                throw new TtfError('a composite glyph positioned by point matching is not supported');
            let dx;
            let dy;
            if (flags & 0x0001) {
                dx = r.i16(cursor);
                dy = r.i16(cursor + 2);
                cursor += 4;
            }
            else {
                dx = r.i8(cursor);
                dy = r.i8(cursor + 1);
                cursor += 2;
            }
            let a = 1;
            let b = 0;
            let c = 0;
            let d = 1;
            if (flags & 0x0008) {
                a = d = f2dot14(r.i16(cursor));
                cursor += 2;
            }
            else if (flags & 0x0040) {
                a = f2dot14(r.i16(cursor));
                d = f2dot14(r.i16(cursor + 2));
                cursor += 4;
            }
            else if (flags & 0x0080) {
                a = f2dot14(r.i16(cursor));
                b = f2dot14(r.i16(cursor + 2));
                c = f2dot14(r.i16(cursor + 4));
                d = f2dot14(r.i16(cursor + 6));
                cursor += 8;
            }
            for (const contour of readGlyph(component, depth + 1)) {
                contours.push(contour.map((point) => ({ x: a * point.x + c * point.y + dx, y: b * point.x + d * point.y + dy, onCurve: point.onCurve })));
            }
            if (!(flags & 0x0020))
                break;
        }
        return contours;
    }
    const subtables = [];
    const subtableCount = r.u16(cmap.offset + 2);
    for (let index = 0; index < subtableCount; index += 1) {
        const platform = r.u16(cmap.offset + 4 + 8 * index);
        const encoding = r.u16(cmap.offset + 6 + 8 * index);
        if (platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10)))
            subtables.push(cmap.offset + r.u32(cmap.offset + 8 + 8 * index));
    }
    function lookup(subtable, codePoint) {
        const format = r.u16(subtable);
        if (format === 4) {
            if (codePoint > 0xffff)
                return 0;
            const segments = r.u16(subtable + 6) / 2;
            const ends = subtable + 14;
            const starts = ends + 2 * segments + 2;
            const deltas = starts + 2 * segments;
            const offsets = deltas + 2 * segments;
            for (let index = 0; index < segments; index += 1) {
                if (codePoint > r.u16(ends + 2 * index))
                    continue;
                if (codePoint < r.u16(starts + 2 * index))
                    return 0;
                const rangeOffset = r.u16(offsets + 2 * index);
                if (rangeOffset === 0)
                    return (codePoint + r.i16(deltas + 2 * index)) & 0xffff;
                const glyph = r.u16(offsets + 2 * index + rangeOffset + 2 * (codePoint - r.u16(starts + 2 * index)));
                return glyph === 0 ? 0 : (glyph + r.i16(deltas + 2 * index)) & 0xffff;
            }
            return 0;
        }
        if (format === 12) {
            const groups = r.u32(subtable + 12);
            for (let index = 0; index < groups; index += 1) {
                const group = subtable + 16 + 12 * index;
                const first = r.u32(group);
                const last = r.u32(group + 4);
                if (codePoint >= first && codePoint <= last)
                    return r.u32(group + 8) + (codePoint - first);
            }
            return 0;
        }
        return 0;
    }
    return {
        unitsPerEm, glyphCount,
        glyphIdForCodePoint(codePoint) {
            for (const subtable of subtables) {
                const id = lookup(subtable, codePoint);
                if (id !== 0)
                    return id;
            }
            return 0;
        },
        glyph(glyphId) { return { glyphId, contours: readGlyph(glyphId, 0), advance: advanceOf(glyphId) }; },
    };
}
