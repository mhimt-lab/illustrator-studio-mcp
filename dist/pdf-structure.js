import { open } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { noFollowReadFlags } from './platform-primitives.js';
export class PdfStructureError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'PdfStructureError';
    }
}
export const PDF_STRUCTURE_LIMITS = Object.freeze({
    maxFileBytes: 4 * 1024 * 1024 * 1024,
    maxObjectBytes: 16 * 1024 * 1024,
    maxDecodedStreamBytes: 64 * 1024 * 1024,
    maxPages: 10_000,
    maxXrefSections: 256,
});
export function bufferSource(bytes) {
    return { size: bytes.length, read: async (offset, length) => bytes.subarray(offset, Math.min(bytes.length, offset + length)) };
}
function fileSource(handle, size) {
    return {
        size,
        async read(offset, length) {
            const wanted = Math.max(0, Math.min(length, size - offset));
            const buffer = Buffer.alloc(wanted);
            let filled = 0;
            while (filled < wanted) {
                const { bytesRead } = await handle.read(buffer, filled, wanted - filled, offset + filled);
                if (bytesRead === 0)
                    break;
                filled += bytesRead;
            }
            return buffer.subarray(0, filled);
        },
    };
}
const fail = (code, message) => { throw new PdfStructureError(code, message); };
class NeedMoreBytes extends Error {
}
const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITERS = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);
class Lexer {
    text;
    complete;
    position;
    constructor(text, start = 0, complete = false) {
        this.text = text;
        this.complete = complete;
        this.position = start;
    }
    code(at) {
        if (at >= this.text.length) {
            if (this.complete)
                return -1;
            throw new NeedMoreBytes();
        }
        return this.text.charCodeAt(at);
    }
    skipWhitespace() {
        for (;;) {
            const code = this.code(this.position);
            if (code === -1)
                return;
            if (WHITESPACE.has(code)) {
                this.position += 1;
                continue;
            }
            if (code === 0x25) {
                while (this.code(this.position) !== 0x0a && this.code(this.position) !== 0x0d && this.code(this.position) !== -1)
                    this.position += 1;
                continue;
            }
            return;
        }
    }
    word() {
        this.skipWhitespace();
        const start = this.position;
        for (;;) {
            const code = this.code(this.position);
            if (code === -1 || WHITESPACE.has(code) || DELIMITERS.has(code))
                break;
            this.position += 1;
        }
        return this.text.slice(start, this.position);
    }
    expectWord(expected) {
        const found = this.word();
        if (found !== expected)
            fail('syntax', `Expected "${expected}" but found "${found.slice(0, 32)}".`);
    }
    value(depth = 0) {
        if (depth > 64)
            fail('syntax', 'PDF object nesting is too deep.');
        this.skipWhitespace();
        const code = this.code(this.position);
        if (code === -1)
            fail('syntax', 'Unexpected end of object.');
        if (code === 0x2f)
            return { name: this.name() };
        if (code === 0x28)
            return { string: this.literalString() };
        if (code === 0x3c) {
            if (this.code(this.position + 1) === 0x3c)
                return this.dictionary(depth);
            return { string: this.hexString() };
        }
        if (code === 0x5b) {
            this.position += 1;
            const items = [];
            for (;;) {
                this.skipWhitespace();
                if (this.code(this.position) === 0x5d) {
                    this.position += 1;
                    return items;
                }
                items.push(this.valueOrReference(depth + 1));
            }
        }
        const word = this.word();
        if (word === 'true')
            return true;
        if (word === 'false')
            return false;
        if (word === 'null')
            return null;
        if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word))
            return Number(word);
        return fail('syntax', `Unexpected token "${word.slice(0, 32)}".`);
    }
    valueOrReference(depth = 0) {
        const value = this.value(depth);
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
            return value;
        const saved = this.position;
        try {
            const generation = this.word();
            if (/^\d+$/.test(generation)) {
                const keyword = this.word();
                if (keyword === 'R')
                    return { ref: [value, Number(generation)] };
            }
        }
        catch (error) {
            if (!(error instanceof PdfStructureError))
                throw error;
        }
        this.position = saved;
        return value;
    }
    name() {
        this.position += 1;
        let name = '';
        for (;;) {
            const code = this.code(this.position);
            if (code === -1 || WHITESPACE.has(code) || DELIMITERS.has(code))
                break;
            if (code === 0x23) {
                const hex = this.text.slice(this.position + 1, this.position + 3);
                if (hex.length < 2 && !this.complete)
                    throw new NeedMoreBytes();
                if (!/^[0-9a-fA-F]{2}$/.test(hex))
                    fail('syntax', 'Invalid #xx escape in a name.');
                name += String.fromCharCode(parseInt(hex, 16));
                this.position += 3;
                continue;
            }
            name += this.text[this.position];
            this.position += 1;
        }
        return name;
    }
    literalString() {
        this.position += 1;
        let depth = 1;
        let out = '';
        for (;;) {
            const code = this.code(this.position);
            if (code === -1)
                fail('syntax', 'Unterminated string.');
            this.position += 1;
            if (code === 0x5c) {
                const next = this.code(this.position);
                this.position += 1;
                const simple = { 0x6e: '\n', 0x72: '\r', 0x74: '\t', 0x62: '\b', 0x66: '\f', 0x28: '(', 0x29: ')', 0x5c: '\\' };
                if (simple[next] !== undefined) {
                    out += simple[next];
                    continue;
                }
                if (next >= 0x30 && next <= 0x37) {
                    let octal = String.fromCharCode(next);
                    while (octal.length < 3 && this.code(this.position) >= 0x30 && this.code(this.position) <= 0x37) {
                        octal += this.text[this.position];
                        this.position += 1;
                    }
                    out += String.fromCharCode(parseInt(octal, 8) & 0xff);
                    continue;
                }
                if (next === 0x0d) {
                    if (this.code(this.position) === 0x0a)
                        this.position += 1;
                    continue;
                }
                if (next === 0x0a)
                    continue;
                out += String.fromCharCode(next);
                continue;
            }
            if (code === 0x28)
                depth += 1;
            if (code === 0x29) {
                depth -= 1;
                if (depth === 0)
                    return out;
            }
            out += String.fromCharCode(code);
        }
    }
    hexString() {
        this.position += 1;
        let digits = '';
        for (;;) {
            const code = this.code(this.position);
            if (code === -1)
                fail('syntax', 'Unterminated hex string.');
            this.position += 1;
            if (code === 0x3e)
                break;
            if (WHITESPACE.has(code))
                continue;
            const char = String.fromCharCode(code);
            if (!/[0-9a-fA-F]/.test(char))
                fail('syntax', 'Invalid hex string digit.');
            digits += char;
        }
        if (digits.length % 2 === 1)
            digits += '0';
        let out = '';
        for (let index = 0; index < digits.length; index += 2)
            out += String.fromCharCode(parseInt(digits.slice(index, index + 2), 16));
        return out;
    }
    dictionary(depth) {
        this.position += 2;
        const dict = new Map();
        for (;;) {
            this.skipWhitespace();
            const code = this.code(this.position);
            if (code === 0x3e) {
                if (this.code(this.position + 1) !== 0x3e)
                    fail('syntax', 'Invalid dictionary end.');
                this.position += 2;
                return dict;
            }
            if (code !== 0x2f)
                fail('syntax', 'Dictionary key is not a name.');
            const key = this.name();
            dict.set(key, this.valueOrReference(depth + 1));
        }
    }
}
function isDict(value) {
    return value instanceof Map;
}
function isRef(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Map) && 'ref' in value;
}
function nameOf(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Map) && 'name' in value ? value.name : null;
}
function stringOf(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Map) && 'string' in value ? value.string : null;
}
function filtersOf(dict) {
    const filter = dict.get('Filter');
    if (filter === undefined || filter === null)
        return [];
    if (Array.isArray(filter))
        return filter.map((entry) => nameOf(entry) ?? fail('unsupported_filter', 'A stream filter is not a name.'));
    return [nameOf(filter) ?? fail('unsupported_filter', 'A stream filter is not a name.')];
}
function numberParam(dict, key, fallback) {
    const value = dict?.get(key);
    if (value === undefined)
        return fallback;
    if (typeof value !== 'number' || !Number.isInteger(value))
        fail('syntax', `/${key} must be an integer.`);
    return value;
}
function unpredict(data, parms) {
    const predictor = numberParam(parms, 'Predictor', 1);
    if (predictor === 1)
        return data;
    if (predictor < 10 || predictor > 15)
        fail('unsupported_predictor', `Stream predictor ${predictor} is not supported.`);
    const colors = numberParam(parms, 'Colors', 1);
    const bits = numberParam(parms, 'BitsPerComponent', 8);
    const columns = numberParam(parms, 'Columns', 1);
    const bytesPerPixel = Math.max(1, Math.ceil((colors * bits) / 8));
    const rowBytes = Math.ceil((colors * bits * columns) / 8);
    if (rowBytes <= 0 || data.length % (rowBytes + 1) !== 0)
        fail('corrupt_stream', 'Predicted stream length does not match its row size.');
    const rows = data.length / (rowBytes + 1);
    const out = Buffer.alloc(rows * rowBytes);
    for (let row = 0; row < rows; row += 1) {
        const type = data[row * (rowBytes + 1)];
        const input = row * (rowBytes + 1) + 1;
        const base = row * rowBytes;
        for (let index = 0; index < rowBytes; index += 1) {
            const raw = data[input + index];
            const left = index >= bytesPerPixel ? out[base + index - bytesPerPixel] : 0;
            const up = row > 0 ? out[base - rowBytes + index] : 0;
            const upLeft = row > 0 && index >= bytesPerPixel ? out[base - rowBytes + index - bytesPerPixel] : 0;
            let value;
            switch (type) {
                case 0:
                    value = raw;
                    break;
                case 1:
                    value = raw + left;
                    break;
                case 2:
                    value = raw + up;
                    break;
                case 3:
                    value = raw + Math.floor((left + up) / 2);
                    break;
                case 4: {
                    const estimate = left + up - upLeft;
                    const pa = Math.abs(estimate - left);
                    const pb = Math.abs(estimate - up);
                    const pc = Math.abs(estimate - upLeft);
                    value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
                    break;
                }
                default: return fail('corrupt_stream', `Unknown PNG predictor row type ${type}.`);
            }
            out[base + index] = value & 0xff;
        }
    }
    return out;
}
function decodeStream(dict, raw, limits) {
    const filters = filtersOf(dict);
    if (filters.length === 0)
        return raw;
    if (filters.length !== 1 || filters[0] !== 'FlateDecode')
        fail('unsupported_filter', `Stream filter ${filters.join(',')} is not supported.`);
    let inflated;
    try {
        inflated = inflateSync(raw, { maxOutputLength: limits.maxDecodedStreamBytes });
    }
    catch (error) {
        return fail('corrupt_stream', `A FlateDecode stream could not be inflated: ${error instanceof Error ? error.message : String(error)}`);
    }
    const parms = dict.get('DecodeParms');
    const parmsDict = Array.isArray(parms) ? (isDict(parms[0]) ? parms[0] : null) : isDict(parms) ? parms : null;
    return unpredict(inflated, parmsDict);
}
class PdfReader {
    source;
    limits;
    xref = new Map();
    objectCache = new Map();
    objectStreamCache = new Map();
    resolving = new Set();
    encrypted = false;
    objectStreamCount = 0;
    constructor(source, limits) {
        this.source = source;
        this.limits = limits;
    }
    async objectAt(offset, expected) {
        if (!Number.isSafeInteger(offset) || offset < 0 || offset >= this.source.size)
            fail('bad_offset', `Object offset ${offset} is outside the file.`);
        for (let window = 4096;; window *= 4) {
            const chunk = await this.source.read(offset, Math.min(window, this.limits.maxObjectBytes));
            const complete = offset + chunk.length >= this.source.size || chunk.length >= this.limits.maxObjectBytes;
            const lexer = new Lexer(chunk.toString('latin1'), 0, complete);
            try {
                const number = lexer.word();
                const generation = lexer.word();
                lexer.expectWord('obj');
                if (!/^\d+$/.test(number) || !/^\d+$/.test(generation))
                    fail('bad_offset', `No object header at offset ${offset}.`);
                if (expected !== undefined && (Number(number) !== expected[0] || Number(generation) !== expected[1])) {
                    fail('bad_offset', `Offset ${offset} holds object ${number} ${generation}, not ${expected[0]} ${expected[1]}.`);
                }
                const value = lexer.valueOrReference();
                lexer.skipWhitespace();
                const next = lexer.word();
                if (next === 'endobj')
                    return { value, stream: null };
                if (next !== 'stream' || !isDict(value))
                    return fail('syntax', `Object ${number} ${generation} is not terminated by endobj.`);
                let dataStart = lexer.position;
                if (dataStart + 2 > chunk.length && !complete)
                    throw new NeedMoreBytes();
                if (chunk[dataStart] === 0x0d)
                    dataStart += 1;
                if (chunk[dataStart] !== 0x0a && chunk[dataStart - 1] !== 0x0d)
                    fail('syntax', 'Stream keyword is not followed by an end of line.');
                if (chunk[dataStart] === 0x0a)
                    dataStart += 1;
                const lengthValue = value.get('Length');
                const length = isRef(lengthValue) ? await this.resolveNumber(lengthValue) : lengthValue;
                if (typeof length !== 'number' || !Number.isInteger(length) || length < 0)
                    return fail('syntax', 'Stream /Length is not a non-negative integer.');
                if (length > this.limits.maxDecodedStreamBytes)
                    fail('too_large', 'A structural stream exceeds the size limit.');
                const data = await this.source.read(offset + dataStart, length);
                if (data.length !== length)
                    fail('truncated', 'A stream ends past the end of the file.');
                const tail = (await this.source.read(offset + dataStart + length, 32)).toString('latin1');
                if (!/^\s*endstream/.test(tail))
                    fail('syntax', 'Stream data is not followed by endstream.');
                return { value, stream: data };
            }
            catch (error) {
                if (error instanceof NeedMoreBytes && !complete)
                    continue;
                if (error instanceof NeedMoreBytes)
                    return fail('truncated', `Object at offset ${offset} is incomplete.`);
                throw error;
            }
        }
    }
    async resolveNumber(ref) {
        const resolved = await this.resolve(ref);
        if (typeof resolved !== 'number')
            fail('syntax', 'An indirect /Length is not a number.');
        return resolved;
    }
    async resolve(value) {
        if (!isRef(value))
            return value;
        return (await this.indirect(value.ref[0], value.ref[1])).value;
    }
    async indirect(number, generation) {
        const cached = this.objectCache.get(number);
        if (cached !== undefined)
            return cached;
        if (this.resolving.has(number))
            fail('cycle', `Object ${number} refers to itself while resolving.`);
        this.resolving.add(number);
        try {
            const entry = this.xref.get(number);
            let object;
            if (entry === undefined || entry.type === 0) {
                object = { value: null, stream: null };
            }
            else if (entry.type === 1) {
                if (entry.generation !== generation)
                    fail('bad_offset', `Object ${number} has generation ${entry.generation}, not ${generation}.`);
                object = await this.objectAt(entry.offset, [number, generation]);
            }
            else {
                if (generation !== 0)
                    fail('bad_offset', `Compressed object ${number} must have generation 0.`);
                object = { value: await this.compressedObject(entry.stream, entry.index, number), stream: null };
            }
            this.objectCache.set(number, object);
            return object;
        }
        finally {
            this.resolving.delete(number);
        }
    }
    async compressedObject(streamNumber, index, number) {
        if (this.encrypted)
            fail('encrypted', 'Objects inside object streams of an encrypted PDF cannot be read.');
        let objectStream = this.objectStreamCache.get(streamNumber);
        if (objectStream === undefined) {
            const container = await this.indirect(streamNumber, 0);
            if (!isDict(container.value) || container.stream === null || nameOf(container.value.get('Type')) !== 'ObjStm') {
                return fail('syntax', `Object ${streamNumber} is not an object stream.`);
            }
            const decoded = decodeStream(container.value, container.stream, this.limits);
            const count = numberParam(container.value, 'N', -1);
            const first = numberParam(container.value, 'First', -1);
            if (count < 0 || first < 0 || first > decoded.length)
                fail('syntax', 'Object stream /N or /First is invalid.');
            const text = decoded.toString('latin1');
            const header = new Lexer(text.slice(0, first), 0, true);
            const offsets = new Map();
            for (let cursor = 0; cursor < count; cursor += 1) {
                const objectNumber = Number(header.word());
                const objectOffset = Number(header.word());
                if (!Number.isInteger(objectNumber) || !Number.isInteger(objectOffset))
                    fail('syntax', 'Object stream header is invalid.');
                offsets.set(objectNumber, objectOffset);
            }
            objectStream = { offsets, text, first };
            this.objectStreamCache.set(streamNumber, objectStream);
            this.objectStreamCount += 1;
        }
        const relative = objectStream.offsets.get(number);
        if (relative === undefined)
            return fail('bad_offset', `Object ${number} is not in object stream ${streamNumber} (index ${index}).`);
        const lexer = new Lexer(objectStream.text, objectStream.first + relative, true);
        return lexer.valueOrReference();
    }
    async xrefSection(offset) {
        const probe = (await this.source.read(offset, 16)).toString('latin1');
        if (/^\s*xref/.test(probe))
            return { trailer: await this.xrefTable(offset), kind: 'table' };
        let object;
        try {
            object = await this.objectAt(offset);
        }
        catch (error) {
            if (!(error instanceof PdfStructureError))
                throw error;
            return fail('bad_xref', `startxref/Prev offset ${offset} does not hold an xref section (${error.message})`);
        }
        if (!isDict(object.value) || object.stream === null || nameOf(object.value.get('Type')) !== 'XRef') {
            return fail('bad_xref', `startxref/Prev offset ${offset} is neither an xref table nor an xref stream.`);
        }
        this.readXrefStream(object.value, decodeStream(object.value, object.stream, this.limits));
        return { trailer: object.value, kind: 'stream' };
    }
    async xrefTable(offset) {
        for (let window = 64 * 1024;; window *= 4) {
            const chunk = await this.source.read(offset, Math.min(window, this.limits.maxObjectBytes * 4));
            const complete = offset + chunk.length >= this.source.size || chunk.length >= this.limits.maxObjectBytes * 4;
            const lexer = new Lexer(chunk.toString('latin1'), 0, complete);
            try {
                lexer.expectWord('xref');
                const entries = [];
                for (;;) {
                    const word = lexer.word();
                    if (word === 'trailer')
                        break;
                    const count = Number(lexer.word());
                    const start = Number(word);
                    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || start < 0 || count < 0)
                        fail('bad_xref', 'Invalid xref subsection header.');
                    for (let index = 0; index < count; index += 1) {
                        const entryOffset = Number(lexer.word());
                        const generation = Number(lexer.word());
                        const kind = lexer.word();
                        if (!Number.isSafeInteger(entryOffset) || !Number.isSafeInteger(generation) || (kind !== 'n' && kind !== 'f'))
                            fail('bad_xref', 'Invalid xref entry.');
                        entries.push([start + index, kind === 'n' ? { type: 1, offset: entryOffset, generation } : { type: 0 }]);
                    }
                }
                const trailer = lexer.valueOrReference();
                if (!isDict(trailer))
                    return fail('bad_xref', 'The trailer is not a dictionary.');
                for (const [number, entry] of entries)
                    if (!this.xref.has(number))
                        this.xref.set(number, entry);
                return trailer;
            }
            catch (error) {
                if (error instanceof NeedMoreBytes && !complete)
                    continue;
                if (error instanceof NeedMoreBytes)
                    return fail('truncated', 'The xref table is incomplete.');
                throw error;
            }
        }
    }
    readXrefStream(dict, data) {
        const widths = dict.get('W');
        if (!Array.isArray(widths) || widths.length !== 3 || !widths.every((width) => typeof width === 'number' && Number.isInteger(width) && width >= 0 && width <= 8)) {
            fail('bad_xref', 'Invalid xref stream /W.');
        }
        const [w0, w1, w2] = widths;
        const rowBytes = w0 + w1 + w2;
        const size = numberParam(dict, 'Size', -1);
        const index = dict.get('Index');
        const ranges = index === undefined ? [0, size] : index;
        if (!Array.isArray(ranges) || ranges.length % 2 !== 0 || !ranges.every((value) => typeof value === 'number' && Number.isInteger(value) && value >= 0)) {
            fail('bad_xref', 'Invalid xref stream /Index.');
        }
        const field = (at, width, fallback) => {
            if (width === 0)
                return fallback;
            let value = 0;
            for (let cursor = 0; cursor < width; cursor += 1)
                value = value * 256 + data[at + cursor];
            return value;
        };
        let cursor = 0;
        for (let range = 0; range < ranges.length; range += 2) {
            const start = ranges[range];
            const count = ranges[range + 1];
            for (let entry = 0; entry < count; entry += 1) {
                if (cursor + rowBytes > data.length)
                    fail('bad_xref', 'The xref stream is shorter than its /Index.');
                const type = field(cursor, w0, 1);
                const second = field(cursor + w0, w1, 0);
                const third = field(cursor + w0 + w1, w2, 0);
                cursor += rowBytes;
                const number = start + entry;
                if (this.xref.has(number))
                    continue;
                if (type === 0)
                    this.xref.set(number, { type: 0 });
                else if (type === 1)
                    this.xref.set(number, { type: 1, offset: second, generation: third });
                else if (type === 2)
                    this.xref.set(number, { type: 2, stream: second, index: third });
            }
        }
    }
}
async function readTail(source) {
    const length = Math.min(source.size, 2048);
    const tail = (await source.read(source.size - length, length)).toString('latin1');
    const eof = tail.lastIndexOf('%%EOF');
    if (eof < 0)
        fail('truncated', 'The file does not end with %%EOF.');
    if (!/^[\s\0]*$/.test(tail.slice(eof + 5)))
        fail('trailing_bytes', 'Bytes other than whitespace follow the last %%EOF.');
    const match = /startxref\s+(\d+)\s+$/.exec(tail.slice(0, eof));
    if (match === null)
        fail('truncated', 'No startxref precedes the final %%EOF.');
    return { startxref: Number(match[1]) };
}
function normalizeBox(value, label) {
    if (value === undefined || value === null)
        return null;
    if (!Array.isArray(value) || value.length !== 4 || !value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
        return fail('bad_page', `${label} is not an array of four numbers.`);
    }
    const [x1, y1, x2, y2] = value;
    return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
}
function clip(box, to) {
    return [Math.max(box[0], to[0]), Math.max(box[1], to[1]), Math.min(box[2], to[2]), Math.min(box[3], to[3])];
}
export async function readPdfStructure(source, limits = PDF_STRUCTURE_LIMITS) {
    if (source.size > limits.maxFileBytes)
        fail('too_large', 'The PDF exceeds the size limit for structure verification.');
    const head = (await source.read(0, 16)).toString('latin1');
    const header = /^%PDF-(\d\.\d)/.exec(head);
    if (header === null)
        fail('not_pdf', 'The file does not start with a %PDF-x.y header.');
    const { startxref } = await readTail(source);
    const reader = new PdfReader(source, limits);
    let trailer = null;
    const kinds = new Set();
    const visited = new Set();
    let sections = 0;
    for (let offset = startxref; offset !== null;) {
        if (visited.has(offset))
            fail('cycle', 'The xref /Prev chain loops.');
        if (++sections > limits.maxXrefSections)
            fail('too_large', 'Too many xref sections.');
        visited.add(offset);
        const section = await reader.xrefSection(offset);
        kinds.add(section.kind);
        const hybrid = section.trailer.get('XRefStm');
        if (typeof hybrid === 'number' && !visited.has(hybrid)) {
            visited.add(hybrid);
            const extra = await reader.xrefSection(hybrid);
            kinds.add(extra.kind);
        }
        trailer ??= section.trailer;
        const previous = section.trailer.get('Prev');
        offset = typeof previous === 'number' ? previous : null;
    }
    const newest = trailer;
    if (newest.has('Encrypt'))
        reader.encrypted = true;
    const root = await reader.resolve(newest.get('Root'));
    if (!isDict(root) || nameOf(root.get('Type')) !== 'Catalog')
        fail('bad_catalog', 'The trailer /Root is not a catalog.');
    const catalog = root;
    const pagesRoot = await reader.resolve(catalog.get('Pages'));
    if (!isDict(pagesRoot) || nameOf(pagesRoot.get('Type')) !== 'Pages')
        fail('bad_page', 'The catalog /Pages is not a page tree node.');
    const pagesNode = pagesRoot;
    const pages = [];
    const seen = new Set();
    const walk = async (nodeRef, inherited, depth) => {
        if (depth > 64)
            fail('bad_page', 'The page tree is too deep.');
        if (isRef(nodeRef)) {
            const key = nodeRef.ref.join(' ');
            if (seen.has(key))
                fail('cycle', 'The page tree visits a node twice.');
            seen.add(key);
        }
        const node = await reader.resolve(nodeRef);
        if (!isDict(node))
            return fail('bad_page', 'A page tree node is not a dictionary.');
        const mediaBox = normalizeBox(await reader.resolve(node.get('MediaBox')), 'MediaBox') ?? inherited.mediaBox;
        const cropBox = normalizeBox(await reader.resolve(node.get('CropBox')), 'CropBox') ?? inherited.cropBox;
        const rotateValue = await reader.resolve(node.get('Rotate'));
        const rotate = typeof rotateValue === 'number' ? rotateValue : inherited.rotate;
        const type = nameOf(node.get('Type'));
        if (type === 'Pages') {
            const kids = await reader.resolve(node.get('Kids'));
            if (!Array.isArray(kids))
                return fail('bad_page', 'A /Pages node has no /Kids array.');
            for (const kid of kids)
                await walk(kid, { mediaBox, cropBox, rotate }, depth + 1);
            return;
        }
        if (type !== 'Page')
            return fail('bad_page', `A page tree leaf has /Type ${type ?? 'none'}.`);
        if (pages.length >= limits.maxPages)
            fail('too_large', 'The PDF has more pages than the verification limit.');
        if (mediaBox === null)
            return fail('bad_page', `Page ${pages.length + 1} has no MediaBox.`);
        const crop = clip(cropBox ?? mediaBox, mediaBox);
        const own = async (key) => normalizeBox(await reader.resolve(node.get(key)), key);
        const bleed = await own('BleedBox');
        const trim = await own('TrimBox');
        const art = await own('ArtBox');
        pages.push({
            page: pages.length + 1,
            mediaBox,
            cropBox: crop,
            bleedBox: bleed === null ? crop : clip(bleed, crop),
            trimBox: trim === null ? crop : clip(trim, crop),
            artBox: art === null ? crop : clip(art, crop),
            explicit: { cropBox: cropBox !== null, bleedBox: bleed !== null, trimBox: trim !== null, artBox: art !== null },
            rotate,
        });
    };
    await walk(catalog.get('Pages'), { mediaBox: null, cropBox: null, rotate: 0 }, 0);
    const declared = await reader.resolve(pagesNode.get('Count'));
    if (declared !== pages.length)
        fail('page_count_mismatch', `The page tree declares ${String(declared)} page(s) but holds ${pages.length}.`);
    const outputIntents = [];
    const intents = await reader.resolve(catalog.get('OutputIntents'));
    if (Array.isArray(intents)) {
        for (const intentRef of intents) {
            const intent = await reader.resolve(intentRef);
            if (!isDict(intent))
                continue;
            outputIntents.push({
                subtype: nameOf(intent.get('S')),
                outputConditionIdentifier: reader.encrypted ? null : stringOf(await reader.resolve(intent.get('OutputConditionIdentifier'))),
                outputCondition: reader.encrypted ? null : stringOf(await reader.resolve(intent.get('OutputCondition'))),
                registryName: reader.encrypted ? null : stringOf(await reader.resolve(intent.get('RegistryName'))),
            });
        }
    }
    let pdfxVersion = null;
    const info = await reader.resolve(newest.get('Info'));
    if (isDict(info) && !reader.encrypted)
        pdfxVersion = stringOf(await reader.resolve(info.get('GTS_PDFXVersion')));
    const xmp = await readXmpPdfx(reader, catalog.get('Metadata'));
    return {
        headerVersion: header[1],
        catalogVersion: nameOf(catalog.get('Version')),
        bytes: source.size,
        xref: kinds.size === 2 ? 'hybrid' : kinds.has('stream') ? 'stream' : 'table',
        xrefSections: sections,
        objectStreams: reader.objectStreamCount,
        encrypted: reader.encrypted,
        pageCount: pages.length,
        pages,
        outputIntents,
        pdfxVersion,
        xmp,
    };
}
function xmpField(packet, name) {
    const element = new RegExp(`<${name}>([^<]*)</${name}>`).exec(packet);
    const attribute = new RegExp(`${name}="([^"]*)"`).exec(packet);
    return element?.[1] ?? attribute?.[1] ?? null;
}
async function readXmpPdfx(reader, metadata) {
    const unreadable = { readable: false, pdfxidVersion: null, pdfxVersion: null };
    if (reader.encrypted || !isRef(metadata))
        return unreadable;
    try {
        const object = await reader.indirect(metadata.ref[0], metadata.ref[1]);
        if (!isDict(object.value) || object.stream === null)
            return unreadable;
        const packet = decodeStream(object.value, object.stream, reader.limits).toString('utf8');
        return { readable: true, pdfxidVersion: xmpField(packet, 'pdfxid:GTS_PDFXVersion'), pdfxVersion: xmpField(packet, 'pdfx:GTS_PDFXVersion') };
    }
    catch (error) {
        if (error instanceof PdfStructureError)
            return unreadable;
        throw error;
    }
}
export async function readPdfFileStructure(path, limits = PDF_STRUCTURE_LIMITS) {
    const handle = await open(path, noFollowReadFlags());
    try {
        const stat = await handle.stat();
        if (!stat.isFile())
            fail('not_pdf', `${path} is not a regular file.`);
        return await readPdfStructure(fileSource(handle, stat.size), limits);
    }
    finally {
        await handle.close();
    }
}
