import { SaxesParser } from 'saxes';
import { svgLengthSchema } from './svg-export-records.js';
const IDENTITY = [1, 0, 0, 1, 0, 0];
export const SVG_EXPORT_LIMITS = { bytes: 8 * 1024 * 1024, elements: 50_000, coordinates: 500_000, depth: 64, coordinate: 500_000 };
export class SvgArtifactError extends Error {
    reason;
    constructor(reason, message) {
        super(message);
        this.reason = reason;
        this.name = 'SvgArtifactError';
    }
}
function refuse(reason, message) { throw new SvgArtifactError(reason, message); }
const invalidNumber = () => refuse('svg_number_invalid', 'An SVG number is malformed, non-finite or outside the coordinate ceiling.');
const finite = (value) => Number.isFinite(value) && Math.abs(value) <= SVG_EXPORT_LIMITS.coordinate ? value : invalidNumber();
const digit = (value) => value !== undefined && value >= '0' && value <= '9';
const space = (value) => value === ' ' || value === '\t' || value === '\r' || value === '\n';
class Numbers {
    source;
    count;
    offset = 0;
    constructor(source, count) {
        this.source = source;
        this.count = count;
    }
    whitespace() { while (space(this.source[this.offset]))
        this.offset++; }
    separator() { this.whitespace(); if (this.source[this.offset] === ',') {
        this.offset++;
        this.whitespace();
    } }
    number() {
        this.whitespace();
        const start = this.offset;
        if (this.source[this.offset] === '+' || this.source[this.offset] === '-')
            this.offset++;
        let digits = 0;
        while (digit(this.source[this.offset])) {
            this.offset++;
            digits++;
        }
        if (this.source[this.offset] === '.') {
            this.offset++;
            while (digit(this.source[this.offset])) {
                this.offset++;
                digits++;
            }
        }
        if (digits === 0)
            invalidNumber();
        if (this.source[this.offset] === 'e' || this.source[this.offset] === 'E') {
            this.offset++;
            if (this.source[this.offset] === '+' || this.source[this.offset] === '-')
                this.offset++;
            const exponent = this.offset;
            while (digit(this.source[this.offset]))
                this.offset++;
            if (this.offset === exponent)
                invalidNumber();
        }
        this.count();
        return finite(Number(this.source.slice(start, this.offset)));
    }
    list() {
        const values = [];
        this.whitespace();
        while (this.offset < this.source.length) {
            values.push(this.number());
            this.whitespace();
            if (this.offset === this.source.length)
                break;
            this.separator();
            if (this.offset === this.source.length)
                invalidNumber();
        }
        return values;
    }
}
const multiply = (a, b) => [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];
const point = (m, p) => [finite(m[0] * p[0] + m[2] * p[1] + m[4]), finite(m[1] * p[0] + m[3] * p[1] + m[5])];
function transform(source, count) {
    const input = new Numbers(source, count);
    let matrix = IDENTITY;
    input.whitespace();
    while (input.offset < source.length) {
        const start = input.offset;
        while (/[a-zA-Z]/u.test(source[input.offset] ?? ''))
            input.offset++;
        const name = source.slice(start, input.offset);
        input.whitespace();
        if (source[input.offset++] !== '(')
            refuse('svg_transform_unmeasured', 'Malformed SVG transform.');
        const args = [];
        input.whitespace();
        while (input.offset < source.length && source[input.offset] !== ')') {
            args.push(input.number());
            input.whitespace();
            if (source[input.offset] === ')')
                break;
            input.separator();
            if (source[input.offset] === ')')
                refuse('svg_transform_unmeasured', 'Trailing transform comma.');
        }
        if (source[input.offset++] !== ')')
            refuse('svg_transform_unmeasured', 'Unclosed SVG transform.');
        let next;
        if (name === 'matrix' && args.length === 6)
            next = args;
        else if (name === 'translate' && (args.length === 1 || args.length === 2))
            next = [1, 0, 0, 1, args[0], args[1] ?? 0];
        else if (name === 'scale' && (args.length === 1 || args.length === 2))
            next = [args[0], 0, 0, args[1] ?? args[0], 0, 0];
        else
            refuse('svg_transform_unmeasured', `Unmeasured SVG transform ${name}.`);
        matrix = multiply(matrix, next);
        if (matrix.some((v) => !Number.isFinite(v)) || Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]) < 1e-6)
            refuse('svg_transform_unmeasured', 'Singular or non-finite SVG transform.');
        input.whitespace();
        if (source[input.offset] === ',') {
            input.offset++;
            input.whitespace();
            if (input.offset === source.length)
                refuse('svg_transform_unmeasured', 'Trailing transform comma.');
        }
    }
    return matrix;
}
function union(bounds, p) {
    return bounds === null ? [p[0], p[1], p[0], p[1]] : [Math.min(bounds[0], p[0]), Math.min(bounds[1], p[1]), Math.max(bounds[2], p[0]), Math.max(bounds[3], p[1])];
}
function merge(a, b) { return union(union(a, [b[0], b[1]]), [b[2], b[3]]); }
function roots(a, b, c) {
    const epsilon = Number.EPSILON * 32 * Math.max(1, Math.abs(a), Math.abs(b), Math.abs(c));
    if (Math.abs(a) <= epsilon)
        return Math.abs(b) <= epsilon ? [] : [-c / b];
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0)
        return [];
    const q = -0.5 * (b + (b < 0 ? -1 : 1) * Math.sqrt(discriminant));
    return q === 0 ? [-b / (2 * a)] : [q / a, c / q];
}
function curve(points) {
    const first = points[0], last = points[points.length - 1];
    let bounds = union(union(null, first), last);
    if (points.length === 2)
        return bounds;
    const value = (t) => {
        let row = points;
        while (row.length > 1)
            row = row.slice(1).map((p, i) => [row[i][0] * (1 - t) + p[0] * t, row[i][1] * (1 - t) + p[1] * t]);
        return row[0];
    };
    for (const axis of [0, 1]) {
        const p = points.map((v) => v[axis]);
        const candidates = p.length === 3 ? roots(0, p[0] - 2 * p[1] + p[2], p[1] - p[0])
            : roots(-p[0] + 3 * p[1] - 3 * p[2] + p[3], 2 * (p[0] - 2 * p[1] + p[2]), p[1] - p[0]);
        for (const t of candidates)
            if (Number.isFinite(t) && t > 0 && t < 1)
                bounds = union(bounds, value(t));
    }
    return bounds;
}
function pathBounds(source, matrix, count) {
    const input = new Numbers(source, count);
    let current = [0, 0], start = [0, 0], control = [0, 0];
    let previous = '', command = '', bounds = null;
    input.whitespace();
    while (input.offset < source.length) {
        const letter = source[input.offset];
        if (/[a-zA-Z]/u.test(letter)) {
            command = letter;
            input.offset++;
        }
        else if (command === '')
            invalidNumber();
        const upper = command.toUpperCase(), relative = command !== upper;
        if (upper === 'A')
            refuse('svg_path_command_unmeasured', 'SVG arc commands are unmeasured.');
        if (!'MLHVCSQTZ'.includes(upper))
            refuse('svg_path_command_unmeasured', `Unmeasured path command ${command}.`);
        if (previous === '' && upper !== 'M')
            invalidNumber();
        if (upper === 'Z') {
            bounds = merge(bounds, curve([point(matrix, current), point(matrix, start)]));
            current = start;
            control = current;
            previous = 'Z';
            command = '';
            input.whitespace();
            continue;
        }
        const arity = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2 }[upper];
        const args = [];
        for (let i = 0; i < arity; i++) {
            if (i > 0)
                input.separator();
            args.push(input.number());
        }
        const p = (i) => [finite(args[i] + (relative ? current[0] : 0)), finite(args[i + 1] + (relative ? current[1] : 0))];
        const reflected = () => [finite(2 * current[0] - control[0]), finite(2 * current[1] - control[1])];
        let end, vertices;
        if (upper === 'M') {
            current = p(0);
            start = current;
            control = current;
            previous = 'M';
            command = relative ? 'l' : 'L';
            input.whitespace();
            if (source[input.offset] === ',') {
                input.offset++;
                input.whitespace();
                if (input.offset === source.length)
                    invalidNumber();
            }
            continue;
        }
        if (upper === 'C') {
            end = p(4);
            control = p(2);
            vertices = [current, p(0), control, end];
        }
        else if (upper === 'S') {
            end = p(2);
            const first = previous === 'C' || previous === 'S' ? reflected() : current;
            control = p(0);
            vertices = [current, first, control, end];
        }
        else if (upper === 'Q') {
            end = p(2);
            control = p(0);
            vertices = [current, control, end];
        }
        else if (upper === 'T') {
            end = p(0);
            control = previous === 'Q' || previous === 'T' ? reflected() : current;
            vertices = [current, control, end];
        }
        else {
            end = upper === 'H' ? [finite(args[0] + (relative ? current[0] : 0)), current[1]] : upper === 'V' ? [current[0], finite(args[0] + (relative ? current[1] : 0))] : p(0);
            control = end;
            vertices = [current, end];
        }
        bounds = merge(bounds, curve(vertices.map((v) => point(matrix, v))));
        current = end;
        previous = upper;
        input.whitespace();
        if (source[input.offset] === ',') {
            input.offset++;
            input.whitespace();
            if (input.offset === source.length || /[a-zA-Z]/u.test(source[input.offset]))
                invalidNumber();
        }
    }
    return bounds;
}
const elements = new Set(['svg', 'g', 'defs', 'title', 'desc', 'metadata', 'style', 'linearGradient', 'radialGradient', 'stop', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path']);
const primitives = new Set(['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path']);
const paint = new Set(['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'stop-color', 'stop-opacity']);
const attributes = new Set(['id', 'class', 'style', 'transform', ...paint]);
const geometry = {
    svg: ['xmlns', 'xmlns:xlink', 'version', 'viewBox', 'width', 'height', 'xml:space', 'data-name', 'x', 'y', 'enable-background'],
    g: ['data-name'], rect: ['x', 'y', 'width', 'height', 'rx', 'ry'], circle: ['cx', 'cy', 'r'], ellipse: ['cx', 'cy', 'rx', 'ry'],
    line: ['x1', 'y1', 'x2', 'y2'], polyline: ['points'], polygon: ['points'], path: ['d'],
    linearGradient: ['gradientUnits', 'gradientTransform', 'x1', 'y1', 'x2', 'y2', 'href', 'xlink:href'],
    radialGradient: ['gradientUnits', 'gradientTransform', 'cx', 'cy', 'r', 'fx', 'fy', 'href', 'xlink:href'], stop: ['offset'],
};
function declarations(source) {
    if (/@|url\s*\(|\\|[{}<>]/iu.test(source))
        refuse('svg_style_unmeasured', 'Unmeasured SVG paint declaration.');
    for (const declaration of source.split(';')) {
        if (declaration.trim() === '')
            continue;
        const colon = declaration.indexOf(':');
        if (colon < 1 || !paint.has(declaration.slice(0, colon).trim()) || declaration.slice(colon + 1).trim() === '')
            refuse('svg_style_unmeasured', 'Only explicit paint properties are admitted.');
    }
}
function stylesheet(source) {
    let offset = 0;
    while (offset < source.length) {
        while (space(source[offset]))
            offset++;
        if (offset === source.length)
            return;
        const brace = source.indexOf('{', offset), close = source.indexOf('}', offset);
        if (brace < 0 || close < brace || !/^\.[a-zA-Z_][\w-]*\s*$/u.test(source.slice(offset, brace)))
            refuse('svg_style_unmeasured', 'Only single class selectors are admitted.');
        declarations(source.slice(brace + 1, close));
        offset = close + 1;
    }
}
function rootLength(source, expected) {
    if (source === undefined || !/^\d+(?:\.\d{1,6})?$/u.test(source))
        refuse('svg_dimension_mismatch', 'SVG root lengths must be unitless decimals with at most six decimal places.');
    const value = Number(source), decimals = source.includes('.') ? source.length - source.indexOf('.') - 1 : 0;
    const difference = Math.abs(value - expected);
    if (!svgLengthSchema.safeParse(value).success || difference > 0.5 * 10 ** -decimals + 1e-9 || difference > 0.0005 + 1e-9)
        refuse('svg_dimension_mismatch', 'SVG dimensions must satisfy both declared precision and the v4 dimension contract.');
    return value;
}
const intersects = (a, b) => a[0] <= b[2] + 0.5 && a[2] >= b[0] - 0.5 && a[1] <= b[3] + 0.5 && a[3] >= b[1] - 0.5;
const contains = (a, b) => b[0] >= a[0] - 0.5 && b[1] >= a[1] - 0.5 && b[2] <= a[2] + 0.5 && b[3] <= a[3] + 0.5;
export function svgArtboardNameMeasured(raw) {
    const name = raw.normalize('NFC');
    return name.length > 0 && name.trim() === name && /^[A-Za-z0-9\u30a1-\u30fa\u30fc\u4e00-\u9fff ]+$/u.test(name) && !/^Artboard \d+$/u.test(name);
}
export function verifySvgArtifact(source, input) {
    if (Buffer.byteLength(source, 'utf8') > SVG_EXPORT_LIMITS.bytes)
        refuse('svg_limit', 'SVG exceeds 8 MiB.');
    const targetName = input.artboardName.normalize('NFC'), outputName = input.name.normalize('NFC');
    const numeric = /^artifact-(\d{1,4})\.svg$/u.exec(outputName);
    const matches = targetName === `アートボード ${input.artboardIndex + 1}`
        ? numeric !== null && Number(numeric[1]) === input.artboardIndex + 1
        : outputName === `artifact_${targetName}.svg`;
    if (!Number.isInteger(input.artboardIndex) || input.artboardIndex < 0 || !svgArtboardNameMeasured(targetName) || !matches)
        refuse('svg_output_index_mismatch', 'SVG output name does not bind the target artboard.');
    const { width, height } = input.expected;
    if (![width, height].every((v) => svgLengthSchema.safeParse(v).success) || input.expectedBounds.length > 2000 || input.expectedBounds.some((b) => b.some((v) => !Number.isFinite(v)) || b[2] < b[0] || b[3] < b[1]))
        refuse('svg_number_invalid', 'Invalid SVG expectation.');
    const parser = new SaxesParser({ xmlns: true });
    const stack = [];
    const primitiveBounds = [], ids = new Set(), references = [];
    let elementsSeen = 0, coordinates = 0, viewBox = '', rootsSeen = 0, actualWidth = 0, actualHeight = 0, bounds = null;
    const count = () => { if (++coordinates > SVG_EXPORT_LIMITS.coordinates)
        refuse('svg_limit', 'SVG coordinate count exceeded.'); };
    const numbers = (value) => new Numbers(value, count).list();
    parser.on('doctype', () => refuse('svg_doctype_forbidden', 'SVG DOCTYPE is forbidden.'));
    parser.on('processinginstruction', () => refuse('svg_attribute_unmeasured', 'SVG processing instructions are unmeasured.'));
    parser.on('error', (error) => { throw error; });
    parser.on('opentag', (tag) => {
        if (++elementsSeen > SVG_EXPORT_LIMITS.elements || stack.length >= SVG_EXPORT_LIMITS.depth)
            refuse('svg_limit', 'SVG element count or depth exceeded.');
        if (tag.uri !== 'http://www.w3.org/2000/svg' || !elements.has(tag.local) || (tag.local === 'svg' && stack.length !== 0))
            refuse('svg_element_unmeasured', `Unmeasured SVG element ${tag.name}.`);
        if (stack.length === 0 && (tag.local !== 'svg' || ++rootsSeen !== 1))
            refuse('svg_element_unmeasured', 'SVG must have one SVG root.');
        const a = {};
        for (const attr of Object.values(tag.attributes)) {
            if (!attributes.has(attr.name) && !(geometry[tag.local] ?? []).includes(attr.name))
                refuse('svg_attribute_unmeasured', `Unmeasured SVG attribute ${attr.name}.`);
            if (attr.prefix !== '' && !['xmlns', 'xml', 'xlink'].includes(attr.prefix))
                refuse('svg_attribute_unmeasured', 'Unmeasured attribute namespace.');
            if ((attr.name === 'xmlns' && attr.value !== 'http://www.w3.org/2000/svg') ||
                (attr.name === 'xmlns:xlink' && attr.value !== 'http://www.w3.org/1999/xlink') ||
                (attr.prefix === 'xlink' && attr.uri !== 'http://www.w3.org/1999/xlink'))
                refuse('svg_attribute_unmeasured', 'Unmeasured namespace binding.');
            a[attr.name] = attr.value;
            if (attr.name === 'style')
                declarations(attr.value);
            if (attr.name === 'href' || attr.name === 'xlink:href') {
                if (!/^#[a-zA-Z_][\w.-]*$/u.test(attr.value))
                    refuse('svg_attribute_unmeasured', 'External SVG references are forbidden.');
                references.push(attr.value.slice(1));
            }
            if (/url\s*\(/iu.test(attr.value)) {
                const local = /^url\(#[a-zA-Z_][\w.-]*\)$/u.exec(attr.value);
                if ((attr.name !== 'fill' && attr.name !== 'stroke') || local === null)
                    refuse('svg_attribute_unmeasured', 'Unmeasured SVG URL.');
                references.push(attr.value.slice(5, -1));
            }
            if (attr.value.includes('\\'))
                refuse('svg_attribute_unmeasured', 'SVG escapes are unmeasured.');
        }
        if (a.id !== undefined) {
            if (ids.has(a.id))
                refuse('svg_attribute_unmeasured', 'Duplicate SVG id.');
            ids.add(a.id);
        }
        const parent = stack[stack.length - 1];
        const matrix = multiply(parent?.matrix ?? IDENTITY, a.transform === undefined ? IDENTITY : transform(a.transform, count));
        if (matrix.some((v) => !Number.isFinite(v)) || Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]) < 1e-6)
            refuse('svg_transform_unmeasured', 'Singular composed transform.');
        if (a.gradientTransform !== undefined)
            transform(a.gradientTransform, count);
        const definition = (parent?.definition ?? false) || ['defs', 'linearGradient', 'radialGradient', 'metadata', 'title', 'desc', 'style'].includes(tag.local);
        stack.push({ name: tag.local, matrix, definition, text: [] });
        if (tag.local === 'svg') {
            actualWidth = rootLength(a.width, width);
            actualHeight = rootLength(a.height, height);
            const values = a.viewBox?.trim().split(/[\s,]+/u);
            if (values?.length !== 4 || Number(values[0]) !== 0 || Number(values[1]) !== 0)
                refuse('svg_dimension_mismatch', 'SVG viewBox must start at 0 0.');
            const vw = rootLength(values[2], width), vh = rootLength(values[3], height);
            if (actualWidth !== vw || actualHeight !== vh)
                refuse('svg_dimension_mismatch', 'SVG root and viewBox dimensions must be numerically identical.');
            viewBox = `0 0 ${vw} ${vh}`;
            if ((a.x !== undefined && numbers(a.x).some((v) => v !== 0)) || (a.y !== undefined && numbers(a.y).some((v) => v !== 0)))
                refuse('svg_attribute_unmeasured', 'A nonzero root offset is unmeasured.');
        }
        if (!primitives.has(tag.local))
            return;
        const n = (key, fallback = 0) => { const values = numbers(a[key] ?? String(fallback)); if (values.length !== 1)
            invalidNumber(); return values[0]; };
        let shape = null;
        if (tag.local === 'path')
            shape = pathBounds(a.d ?? '', matrix, count);
        else if (tag.local === 'circle' || tag.local === 'ellipse') {
            const cx = n('cx'), cy = n('cy'), rx = tag.local === 'circle' ? n('r') : n('rx'), ry = tag.local === 'circle' ? rx : n('ry');
            if (rx < 0 || ry < 0)
                invalidNumber();
            const center = point(matrix, [cx, cy]), dx = Math.hypot(matrix[0] * rx, matrix[2] * ry), dy = Math.hypot(matrix[1] * rx, matrix[3] * ry);
            shape = [finite(center[0] - dx), finite(center[1] - dy), finite(center[0] + dx), finite(center[1] + dy)];
        }
        else if (tag.local === 'rect') {
            const x = n('x'), y = n('y'), w = n('width'), h = n('height'), rx = n('rx', a.ry === undefined ? 0 : n('ry')), ry = n('ry', rx);
            if (w < 0 || h < 0 || rx < 0 || ry < 0)
                invalidNumber();
            const r = Math.min(rx, w / 2), s = Math.min(ry, h / 2);
            if (r === 0 || s === 0)
                for (const p of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]])
                    shape = union(shape, point(matrix, p));
            else
                for (let quarter = 0; quarter < 4; quarter++) {
                    const center = [quarter < 2 ? x + w - r : x + r, quarter === 0 || quarter === 3 ? y + s : y + h - s];
                    const from = -Math.PI / 2 + quarter * Math.PI / 2, to = from + Math.PI / 2;
                    const candidates = [from, to];
                    for (const axis of [0, 1]) {
                        const t = Math.atan2(matrix[axis + 2] * s, matrix[axis] * r);
                        for (let k = -2; k <= 2; k++) {
                            const angle = t + k * Math.PI;
                            if (angle > from && angle < to)
                                candidates.push(angle);
                        }
                    }
                    for (const t of candidates)
                        shape = union(shape, point(matrix, [center[0] + r * Math.cos(t), center[1] + s * Math.sin(t)]));
                }
        }
        else {
            const values = tag.local === 'line' ? [n('x1'), n('y1'), n('x2'), n('y2')] : numbers(a.points ?? '');
            if (values.length % 2 !== 0)
                invalidNumber();
            for (let i = 0; i < values.length; i += 2)
                shape = union(shape, point(matrix, [values[i], values[i + 1]]));
        }
        if (shape !== null && !definition) {
            primitiveBounds.push(shape);
            bounds = merge(bounds, shape);
        }
    });
    const text = (value) => {
        const entry = stack[stack.length - 1];
        if (entry?.name === 'style')
            entry.text.push(value);
        else if (value.trim() !== '' && (entry === undefined || !['metadata', 'title', 'desc'].includes(entry.name)))
            refuse('svg_element_unmeasured', 'Rendered SVG text is unmeasured.');
    };
    parser.on('text', text);
    parser.on('cdata', text);
    parser.on('closetag', () => { const entry = stack.pop(); if (entry.name === 'style')
        stylesheet(entry.text.join('')); });
    try {
        parser.write(source).close();
    }
    catch (error) {
        if (error instanceof SvgArtifactError)
            throw error;
        refuse('svg_xml_invalid', `Malformed SVG XML: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (rootsSeen !== 1 || references.some((id) => !ids.has(id)))
        refuse('svg_attribute_unmeasured', 'Missing SVG root or unresolved local reference.');
    if (bounds !== null && !contains([0, 0, width, height], bounds))
        refuse('svg_foreign_geometry', 'SVG geometry crosses the target artboard.');
    let expectedUnion = null;
    for (const expected of input.expectedBounds) {
        expectedUnion = merge(expectedUnion, expected);
        if (!primitiveBounds.some((actual) => intersects(expected, actual)))
            refuse('svg_item_correspondence_failed', 'A planned item has no corresponding SVG geometry.');
    }
    if ((bounds !== null && (expectedUnion === null || !contains(expectedUnion, bounds))) || (bounds === null && expectedUnion !== null))
        refuse('svg_foreign_geometry', 'SVG geometry differs from the planned item union.');
    return { width: actualWidth, height: actualHeight, viewBox, bounds, primitiveCount: primitiveBounds.length };
}
