import { open } from 'node:fs/promises';
const UNAVAILABLE = { status: 'unavailable', bitsPerChannel: null, channels: null, layers: null };
const TIFF_MAX_ENTRIES = 256;
const TIFF_TAG_BITS_PER_SAMPLE = 258;
const TIFF_TAG_SAMPLES_PER_PIXEL = 277;
const TIFF_TAG_IMAGE_SOURCE_DATA = 37724;
export async function inspectEmbedSourceStructure(path, format) {
    let handle;
    try {
        handle = await open(path, 'r');
        const size = (await handle.stat()).size;
        const read = async (offset, length) => {
            if (offset < 0 || length < 0 || offset + length > size)
                return null;
            const buffer = Buffer.alloc(length);
            const { bytesRead } = await handle.read(buffer, 0, length, offset);
            return bytesRead === length ? buffer : null;
        };
        return format === 'psd' ? await inspectPsd(read) : await inspectTiff(read);
    }
    catch {
        return UNAVAILABLE;
    }
    finally {
        await handle?.close().catch(() => undefined);
    }
}
async function inspectPsd(read) {
    const header = await read(0, 26);
    if (header === null || header.subarray(0, 4).toString('latin1') !== '8BPS')
        return UNAVAILABLE;
    if (header.readUInt16BE(4) !== 1)
        return { status: 'unsupported', bitsPerChannel: null, channels: null, layers: null };
    const channels = header.readUInt16BE(12);
    const depth = header.readUInt16BE(22);
    let offset = 26;
    for (let section = 0; section < 2; section += 1) {
        const length = await read(offset, 4);
        if (length === null)
            return UNAVAILABLE;
        offset += 4 + length.readUInt32BE(0);
    }
    const mask = await read(offset, 4);
    if (mask === null)
        return UNAVAILABLE;
    let layers = 0;
    if (mask.readUInt32BE(0) > 0) {
        const info = await read(offset + 4, 4);
        if (info === null)
            return UNAVAILABLE;
        if (info.readUInt32BE(0) > 0) {
            const count = await read(offset + 8, 2);
            if (count === null)
                return UNAVAILABLE;
            layers = Math.abs(count.readInt16BE(0));
        }
    }
    if (layers > 1)
        return { status: 'layered', bitsPerChannel: depth, channels, layers };
    if (depth !== 8)
        return { status: 'unsupported', bitsPerChannel: depth, channels, layers };
    return { status: 'flat', bitsPerChannel: 8, channels, layers };
}
async function inspectTiff(read) {
    const header = await read(0, 8);
    if (header === null)
        return UNAVAILABLE;
    const mark = header.subarray(0, 2).toString('latin1');
    if (mark !== 'II' && mark !== 'MM')
        return UNAVAILABLE;
    const little = mark === 'II';
    const u16 = (buffer, at) => (little ? buffer.readUInt16LE(at) : buffer.readUInt16BE(at));
    const u32 = (buffer, at) => (little ? buffer.readUInt32LE(at) : buffer.readUInt32BE(at));
    if (u16(header, 2) !== 42)
        return { status: 'unsupported', bitsPerChannel: null, channels: null, layers: null };
    const ifd = u32(header, 4);
    const countBuffer = await read(ifd, 2);
    if (countBuffer === null)
        return UNAVAILABLE;
    const entries = u16(countBuffer, 0);
    if (entries === 0 || entries > TIFF_MAX_ENTRIES)
        return UNAVAILABLE;
    const table = await read(ifd + 2, entries * 12 + 4);
    if (table === null)
        return UNAVAILABLE;
    let samples = null;
    let bits = null;
    let layered = false;
    for (let index = 0; index < entries; index += 1) {
        const at = index * 12;
        const tag = u16(table, at);
        const type = u16(table, at + 2);
        const count = u32(table, at + 4);
        if (tag === TIFF_TAG_IMAGE_SOURCE_DATA)
            layered = true;
        if (tag === TIFF_TAG_SAMPLES_PER_PIXEL && type === 3 && count === 1)
            samples = u16(table, at + 8);
        if (tag === TIFF_TAG_BITS_PER_SAMPLE && type === 3 && count >= 1 && count <= 16) {
            const bytes = count * 2;
            const values = bytes <= 4 ? table.subarray(at + 8, at + 8 + bytes) : await read(u32(table, at + 8), bytes);
            if (values === null)
                return UNAVAILABLE;
            bits = Array.from({ length: count }, (_, i) => u16(values, i * 2));
        }
    }
    const next = u32(table, entries * 12);
    const depth = bits === null ? null : bits.every((value) => value === bits[0]) ? bits[0] : -1;
    if (next !== 0)
        return { status: 'multi_page', bitsPerChannel: depth, channels: samples, layers: null };
    if (layered)
        return { status: 'layered', bitsPerChannel: depth, channels: samples, layers: null };
    if (samples === null || depth === null)
        return UNAVAILABLE;
    if (depth !== 8)
        return { status: 'unsupported', bitsPerChannel: depth, channels: samples, layers: null };
    return { status: 'flat', bitsPerChannel: 8, channels: samples, layers: 0 };
}
