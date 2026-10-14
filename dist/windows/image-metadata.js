import { inflateSync } from 'node:zlib';
export const WINDOWS_MEASURED_IMAGE_FORMATS = new Set(['png', 'jpeg', 'tiff']);
export const MAX_ICC_PROFILE_BYTES = 16 * 1024 * 1024;
const MAX_PNG_CHUNKS = 10_000;
const MAX_JPEG_SEGMENTS = 10_000;
const MAX_TIFF_ENTRIES = 4_096;
const MAX_PSD_RESOURCE_BLOCKS = 4_096;
const ppiMissing = (message) => ({ status: 'unavailable', reason: 'native_ppi_missing', message });
const pixelsMissing = (message) => ({ status: 'unavailable', reason: 'pixel_dimensions_missing', message });
const colorUnsupported = (message) => ({ status: 'unavailable', reason: 'color_space_unsupported', message });
const colorMissing = (message) => ({ status: 'unavailable', reason: 'color_space_missing', message });
const iccMissing = (message) => ({ status: 'unavailable', reason: 'icc_metadata_missing', message });
function pixelsOf(width, height) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
        return { status: 'unavailable', reason: 'pixel_dimensions_invalid_zero', message: 'Source pixel dimensions are zero, negative, or invalid.' };
    }
    return { status: 'available', value: { width, height } };
}
function ppiOf(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) {
        return { status: 'unavailable', reason: 'native_ppi_invalid_zero', message: 'Native PPI is zero, negative, or invalid.' };
    }
    return { status: 'available', value: { x, y } };
}
async function readExact(source, position, length) {
    if (position < 0 || length < 0 || position + length > source.size)
        return null;
    const bytes = await source.read(position, length);
    return bytes.length === length ? bytes : null;
}
function truncate(value, limit) {
    return value.length <= limit ? value : value.slice(0, limit);
}
export function iccProfileName(profile) {
    if (profile.length < 132 || profile.toString('ascii', 36, 40) !== 'acsp')
        return null;
    const tagCount = profile.readUInt32BE(128);
    if (tagCount > 1_000 || 132 + tagCount * 12 > profile.length)
        return null;
    for (let index = 0; index < tagCount; index++) {
        const entry = 132 + index * 12;
        if (profile.toString('ascii', entry, entry + 4) !== 'desc')
            continue;
        const offset = profile.readUInt32BE(entry + 4);
        const size = profile.readUInt32BE(entry + 8);
        if (size < 12 || offset + size > profile.length)
            return null;
        const type = profile.toString('ascii', offset, offset + 4);
        if (type === 'desc') {
            const count = profile.readUInt32BE(offset + 8);
            if (count < 1 || 12 + count > size)
                return null;
            const text = profile.toString('latin1', offset + 12, offset + 12 + count).replace(/\0.*$/su, '');
            return text.length > 0 ? truncate(text, 500) : null;
        }
        if (type === 'mluc') {
            const records = profile.readUInt32BE(offset + 8);
            const recordSize = profile.readUInt32BE(offset + 12);
            if (records < 1 || recordSize < 12 || 16 + records * recordSize > size)
                return null;
            let chosen = 0;
            for (let record = 0; record < records; record++) {
                const base = offset + 16 + record * recordSize;
                if (profile.toString('ascii', base, base + 4) === 'enUS') {
                    chosen = record;
                    break;
                }
            }
            const base = offset + 16 + chosen * recordSize;
            const length = profile.readUInt32BE(base + 4);
            const start = profile.readUInt32BE(base + 8);
            if (length < 2 || length % 2 !== 0 || start + length > size)
                return null;
            const bytes = Buffer.from(profile.subarray(offset + start, offset + start + length));
            bytes.swap16();
            const text = bytes.toString('utf16le').replace(/\0.*$/su, '');
            return text.length > 0 ? truncate(text, 500) : null;
        }
        return null;
    }
    return null;
}
function iccFromProfile(profile) {
    if (profile === null)
        return { status: 'available', value: { present: false, name: null } };
    return { status: 'available', value: { present: true, name: iccProfileName(profile) } };
}
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
async function readPng(source) {
    const header = await readExact(source, 0, 33);
    if (header === null || header.readUInt32BE(8) !== 13 || header.toString('ascii', 12, 16) !== 'IHDR')
        return null;
    const width = header.readUInt32BE(16);
    const height = header.readUInt32BE(20);
    const colorType = header[25];
    let ppi = ppiMissing('The PNG has no pHYs chunk.');
    let profile = null;
    let iccFailure = null;
    let position = 33;
    for (let count = 0; count < MAX_PNG_CHUNKS; count++) {
        const chunkHeader = await readExact(source, position, 8);
        if (chunkHeader === null)
            break;
        const length = chunkHeader.readUInt32BE(0);
        const type = chunkHeader.toString('ascii', 4, 8);
        if (type === 'IDAT' || type === 'IEND')
            break;
        if (position + 12 + length > source.size)
            break;
        if (type === 'pHYs' && length === 9) {
            const body = await readExact(source, position + 8, 9);
            if (body !== null) {
                if (body[8] === 1)
                    ppi = ppiOf(body.readUInt32BE(0) * 0.0254, body.readUInt32BE(4) * 0.0254);
                else
                    ppi = ppiMissing('The PNG pHYs chunk states only an aspect ratio, not a density.');
            }
        }
        else if (type === 'iCCP' && profile === null && iccFailure === null) {
            if (length > MAX_ICC_PROFILE_BYTES)
                iccFailure = iccMissing('The PNG iCCP chunk is larger than the supported limit.');
            else {
                const body = await readExact(source, position + 8, length);
                const nameEnd = body === null ? -1 : body.indexOf(0);
                if (body === null || nameEnd < 1 || nameEnd + 2 > body.length || body[nameEnd + 1] !== 0) {
                    iccFailure = iccMissing('The PNG iCCP chunk is malformed.');
                }
                else {
                    try {
                        profile = inflateSync(body.subarray(nameEnd + 2), { maxOutputLength: MAX_ICC_PROFILE_BYTES });
                    }
                    catch {
                        iccFailure = iccMissing('The PNG iCCP profile could not be decompressed.');
                    }
                }
            }
        }
        position += 12 + length;
    }
    const colorSpace = { 0: 'Gray', 2: 'RGB', 3: 'Indexed', 4: 'Gray', 6: 'RGB' };
    const mapped = colorSpace[colorType];
    return {
        format: { status: 'available', value: 'png' },
        pixels: pixelsOf(width, height),
        nativePpi: ppi,
        colorSpace: mapped === undefined ? colorUnsupported(`PNG color type ${colorType} is not recognized.`) : { status: 'available', value: mapped },
        icc: iccFailure ?? iccFromProfile(profile),
    };
}
async function readJpeg(source) {
    const start = await readExact(source, 0, 3);
    if (start === null || start[0] !== 0xff || start[1] !== 0xd8 || start[2] !== 0xff)
        return null;
    let position = 2;
    let width = 0;
    let height = 0;
    let components = 0;
    let adobeTransform = null;
    let jfif = null;
    let exif = null;
    const iccParts = new Map();
    let iccTotal = 0;
    let iccBytes = 0;
    let iccFailure = null;
    let sawFrame = false;
    for (let count = 0; count < MAX_JPEG_SEGMENTS; count++) {
        const marker = await readExact(source, position, 4);
        if (marker === null || marker[0] !== 0xff)
            break;
        const code = marker[1];
        if (code === 0xff) {
            position += 1;
            continue;
        }
        if (code === 0xd8 || code === 0x01 || (code >= 0xd0 && code <= 0xd7)) {
            position += 2;
            continue;
        }
        if (code === 0xd9 || code === 0xda)
            break;
        const length = marker.readUInt16BE(2);
        if (length < 2)
            break;
        const bodyLength = length - 2;
        const bodyPosition = position + 4;
        if (code >= 0xc0 && code <= 0xcf && code !== 0xc4 && code !== 0xc8 && code !== 0xcc) {
            const frame = await readExact(source, bodyPosition, Math.min(bodyLength, 6));
            if (frame !== null && frame.length >= 6) {
                height = frame.readUInt16BE(1);
                width = frame.readUInt16BE(3);
                components = frame[5];
                sawFrame = true;
            }
        }
        else if (code === 0xe0 && bodyLength >= 14) {
            const body = await readExact(source, bodyPosition, 12);
            if (body !== null && body.toString('latin1', 0, 5) === 'JFIF\0') {
                const unit = body[7];
                const xd = body.readUInt16BE(8);
                const yd = body.readUInt16BE(10);
                if (unit === 1)
                    jfif = ppiOf(xd, yd);
                else if (unit === 2)
                    jfif = ppiOf(xd * 2.54, yd * 2.54);
                else
                    jfif = ppiMissing('The JPEG JFIF density states only an aspect ratio.');
            }
        }
        else if (code === 0xe1 && bodyLength >= 14 && bodyLength <= 65_533) {
            const body = await readExact(source, bodyPosition, bodyLength);
            if (body !== null && body.toString('latin1', 0, 6) === 'Exif\0\0')
                exif = readTiffDensity(body.subarray(6));
        }
        else if (code === 0xe2 && bodyLength >= 14) {
            const body = await readExact(source, bodyPosition, bodyLength);
            if (body !== null && body.toString('latin1', 0, 12) === 'ICC_PROFILE\0') {
                const sequence = body[12];
                const total = body[13];
                if (sequence < 1 || total < 1 || sequence > total || (iccTotal !== 0 && iccTotal !== total) || iccParts.has(sequence)) {
                    iccFailure = iccMissing('The JPEG ICC_PROFILE segments are inconsistent.');
                }
                else {
                    iccTotal = total;
                    iccBytes += body.length - 14;
                    if (iccBytes > MAX_ICC_PROFILE_BYTES)
                        iccFailure = iccMissing('The JPEG ICC profile is larger than the supported limit.');
                    else
                        iccParts.set(sequence, Buffer.from(body.subarray(14)));
                }
            }
        }
        else if (code === 0xee && bodyLength >= 12) {
            const body = await readExact(source, bodyPosition, 12);
            if (body !== null && body.toString('latin1', 0, 5) === 'Adobe')
                adobeTransform = body[11];
        }
        position = bodyPosition + bodyLength;
    }
    let icc;
    if (iccFailure !== null)
        icc = iccFailure;
    else if (iccParts.size === 0)
        icc = iccFromProfile(null);
    else if (iccParts.size !== iccTotal)
        icc = iccMissing('The JPEG ICC_PROFILE segments are incomplete.');
    else
        icc = iccFromProfile(Buffer.concat([...iccParts.entries()].sort((a, b) => a[0] - b[0]).map(([, part]) => part)));
    let ppi;
    const exifPpi = exif === null ? null : ppiOf(exif.x, exif.y);
    if (jfif !== null && jfif.status === 'available' && exifPpi !== null && exifPpi.status === 'available' &&
        (jfif.value.x !== exifPpi.value.x || jfif.value.y !== exifPpi.value.y)) {
        ppi = { status: 'unavailable', reason: 'native_ppi_untrusted_format', message: 'The JPEG JFIF and EXIF densities disagree, so neither is trusted.' };
    }
    else if (jfif !== null && jfif.status === 'available')
        ppi = jfif;
    else if (exifPpi !== null && exifPpi.status === 'available')
        ppi = exifPpi;
    else
        ppi = jfif ?? exifPpi ?? ppiMissing('The JPEG states no JFIF or EXIF density.');
    let colorSpace;
    if (!sawFrame)
        colorSpace = colorMissing('The JPEG has no frame header.');
    else if (components === 1)
        colorSpace = { status: 'available', value: 'Gray' };
    else if (components === 3)
        colorSpace = { status: 'available', value: 'RGB' };
    else if (components === 4 && adobeTransform !== null && adobeTransform <= 2)
        colorSpace = { status: 'available', value: 'CMYK' };
    else
        colorSpace = colorUnsupported(`The JPEG has ${components} components${components === 4 ? ' without an Adobe marker' : ''}.`);
    return {
        format: { status: 'available', value: 'jpeg' },
        pixels: sawFrame ? pixelsOf(width, height) : pixelsMissing('The JPEG has no frame header.'),
        nativePpi: ppi,
        colorSpace,
        icc,
    };
}
function tiffByteOrder(bytes) {
    if (bytes.length < 8)
        return null;
    const marker = bytes.toString('ascii', 0, 2);
    if (marker !== 'II' && marker !== 'MM')
        return null;
    const little = marker === 'II';
    return (little ? bytes.readUInt16LE(2) : bytes.readUInt16BE(2)) === 42 ? little : null;
}
function readTiffDensity(bytes) {
    const little = tiffByteOrder(bytes);
    if (little === null)
        return null;
    const u16 = (offset) => (little ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset));
    const u32 = (offset) => (little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset));
    const ifd = u32(4);
    if (ifd + 2 > bytes.length)
        return null;
    const entries = u16(ifd);
    if (entries > MAX_TIFF_ENTRIES || ifd + 2 + entries * 12 > bytes.length)
        return null;
    let x = null;
    let y = null;
    let unit = 2;
    for (let index = 0; index < entries; index++) {
        const base = ifd + 2 + index * 12;
        const tag = u16(base);
        const rational = (position) => {
            const at = u32(position);
            if (at + 8 > bytes.length)
                return null;
            const denominator = u32(at + 4);
            return denominator === 0 ? null : u32(at) / denominator;
        };
        if (tag === 282 && u16(base + 2) === 5)
            x = rational(base + 8);
        else if (tag === 283 && u16(base + 2) === 5)
            y = rational(base + 8);
        else if (tag === 296 && u16(base + 2) === 3)
            unit = u16(base + 8);
    }
    if (x === null || y === null)
        return null;
    if (unit === 2)
        return { x, y };
    if (unit === 3)
        return { x: x * 2.54, y: y * 2.54 };
    return null;
}
async function readTiff(source) {
    const head = await readExact(source, 0, 8);
    if (head === null)
        return null;
    const little = tiffByteOrder(head);
    if (little === null)
        return null;
    const u16 = (bytes, offset) => (little ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset));
    const u32 = (bytes, offset) => (little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset));
    const ifd = u32(head, 4);
    const countBytes = await readExact(source, ifd, 2);
    if (countBytes === null)
        return null;
    const count = u16(countBytes, 0);
    if (count > MAX_TIFF_ENTRIES)
        return null;
    const table = await readExact(source, ifd + 2, count * 12);
    if (table === null)
        return null;
    const entries = new Map();
    for (let index = 0; index < count; index++) {
        const base = index * 12;
        entries.set(u16(table, base), {
            tag: u16(table, base), type: u16(table, base + 2), count: u32(table, base + 4),
            valueOffset: u32(table, base + 8), inline: table.subarray(base + 8, base + 12),
        });
    }
    const scalar = (entry) => {
        if (entry === undefined || entry.count !== 1)
            return null;
        if (entry.type === 3)
            return u16(entry.inline, 0);
        if (entry.type === 4)
            return u32(entry.inline, 0);
        return null;
    };
    const rational = async (entry) => {
        if (entry === undefined || entry.type !== 5 || entry.count !== 1)
            return null;
        const bytes = await readExact(source, entry.valueOffset, 8);
        if (bytes === null)
            return null;
        const denominator = u32(bytes, 4);
        return denominator === 0 ? null : u32(bytes, 0) / denominator;
    };
    const width = scalar(entries.get(256));
    const height = scalar(entries.get(257));
    const photometric = scalar(entries.get(262));
    const resolutionX = await rational(entries.get(282));
    const resolutionY = await rational(entries.get(283));
    const unit = entries.has(296) ? scalar(entries.get(296)) : 2;
    let ppi;
    if (resolutionX === null || resolutionY === null)
        ppi = ppiMissing('The TIFF has no XResolution/YResolution.');
    else if (unit === 2)
        ppi = ppiOf(resolutionX, resolutionY);
    else if (unit === 3)
        ppi = ppiOf(resolutionX * 2.54, resolutionY * 2.54);
    else
        ppi = ppiMissing('The TIFF ResolutionUnit is not inch or centimeter.');
    let colorSpace;
    const photometricMap = { 0: 'Gray', 1: 'Gray', 2: 'RGB', 3: 'Indexed', 5: 'CMYK', 8: 'Lab' };
    if (photometric === null)
        colorSpace = colorMissing('The TIFF has no PhotometricInterpretation.');
    else if (photometricMap[photometric] === undefined)
        colorSpace = colorUnsupported(`TIFF PhotometricInterpretation ${photometric} is not recognized.`);
    else
        colorSpace = { status: 'available', value: photometricMap[photometric] };
    let icc;
    const iccEntry = entries.get(34675);
    if (iccEntry === undefined)
        icc = iccFromProfile(null);
    else if (iccEntry.type !== 7 || iccEntry.count < 132 || iccEntry.count > MAX_ICC_PROFILE_BYTES)
        icc = iccMissing('The TIFF ICC profile tag is malformed or too large.');
    else {
        const profile = iccEntry.count <= 4 ? null : await readExact(source, iccEntry.valueOffset, iccEntry.count);
        icc = profile === null ? iccMissing('The TIFF ICC profile bytes are outside the file.') : iccFromProfile(profile);
    }
    return {
        format: { status: 'available', value: 'tiff' },
        pixels: width === null || height === null ? pixelsMissing('The TIFF has no ImageWidth/ImageLength.') : pixelsOf(width, height),
        nativePpi: ppi, colorSpace, icc,
    };
}
async function readPsd(source) {
    const header = await readExact(source, 0, 26);
    if (header === null || header.toString('ascii', 0, 4) !== '8BPS' || header.readUInt16BE(4) !== 1)
        return null;
    const height = header.readUInt32BE(14);
    const width = header.readUInt32BE(18);
    const mode = header.readUInt16BE(24);
    const modeMap = { 1: 'Gray', 2: 'Indexed', 3: 'RGB', 4: 'CMYK', 9: 'Lab' };
    const mapped = modeMap[mode];
    let icc = iccMissing('The PSD image resources could not be read.');
    let position = 26;
    const modeLength = await readExact(source, position, 4);
    if (modeLength !== null) {
        position += 4 + modeLength.readUInt32BE(0);
        const resourcesLength = await readExact(source, position, 4);
        if (resourcesLength !== null) {
            position += 4;
            const end = position + resourcesLength.readUInt32BE(0);
            icc = iccFromProfile(null);
            for (let block = 0; block < MAX_PSD_RESOURCE_BLOCKS && position + 12 <= end; block++) {
                const resource = await readExact(source, position, 7);
                if (resource === null || resource.toString('ascii', 0, 4) !== '8BIM') {
                    icc = iccMissing('The PSD image resource block is malformed.');
                    break;
                }
                const id = resource.readUInt16BE(4);
                const nameLength = resource[6];
                const namePadded = (1 + nameLength) % 2 === 0 ? 1 + nameLength : 2 + nameLength;
                const sizeBytes = await readExact(source, position + 6 + namePadded, 4);
                if (sizeBytes === null) {
                    icc = iccMissing('The PSD image resource block is truncated.');
                    break;
                }
                const size = sizeBytes.readUInt32BE(0);
                const dataPosition = position + 10 + namePadded;
                if (id === 1039) {
                    if (size > MAX_ICC_PROFILE_BYTES || dataPosition + size > source.size) {
                        icc = iccMissing('The PSD ICC resource is malformed or too large.');
                        break;
                    }
                    const profile = await readExact(source, dataPosition, size);
                    icc = profile === null ? iccMissing('The PSD ICC resource is truncated.') : iccFromProfile(profile);
                    break;
                }
                position = dataPosition + size + (size % 2);
            }
        }
    }
    return {
        format: { status: 'available', value: 'psd' },
        pixels: pixelsOf(width, height),
        nativePpi: { status: 'unavailable', reason: 'native_ppi_untrusted_format', message: 'Native PPI is not trusted for PSD: no Windows measurement exists and the macOS reader mis-reported a 300 ppi file as 72 ppi.' },
        colorSpace: mapped === undefined ? colorUnsupported(`PSD color mode ${mode} is not supported.`) : { status: 'available', value: mapped },
        icc,
    };
}
export async function readImageSourceMetadata(source, admitted = WINDOWS_MEASURED_IMAGE_FORMATS) {
    const signature = await source.read(0, 8);
    const ascii4 = signature.toString('ascii', 0, 4);
    let named = true;
    let parsed = null;
    if (signature.length >= 8 && signature.subarray(0, 8).equals(PNG_SIGNATURE) && admitted.has('png'))
        parsed = await readPng(source);
    else if (signature.length >= 3 && signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff && admitted.has('jpeg'))
        parsed = await readJpeg(source);
    else if ((ascii4 === 'II*\0' || ascii4 === 'MM\0*') && admitted.has('tiff'))
        parsed = await readTiff(source);
    else if (ascii4 === '8BPS' && admitted.has('psd'))
        parsed = await readPsd(source);
    else
        named = false;
    if (parsed !== null)
        return parsed;
    if (named) {
        const failed = { status: 'unavailable', reason: 'metadata_reader_failed', message: 'The file signature is a measured image format but its header could not be read.' };
        return { format: failed, pixels: failed, nativePpi: failed, colorSpace: failed, icc: failed };
    }
    const format = signature.length === 0
        ? { status: 'unavailable', reason: 'source_format_missing', message: 'The source image format is missing.' }
        : { status: 'unavailable', reason: 'source_format_unsupported', message: 'The file signature is not a Windows-measured PNG, JPEG, or TIFF image.' };
    const message = format.message;
    return {
        format,
        pixels: { status: 'unavailable', reason: 'source_format_unsupported', message },
        nativePpi: { status: 'unavailable', reason: 'source_format_unsupported', message },
        colorSpace: { status: 'unavailable', reason: 'source_format_unsupported', message },
        icc: { status: 'unavailable', reason: 'source_format_unsupported', message },
    };
}
