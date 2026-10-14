import { deflateSync } from 'node:zlib';
const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1)
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();
function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes)
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
}
export function encodeGreyPng(width, height, pixels) {
    const rows = [];
    for (let y = 0; y < height; y += 1) {
        rows.push(Buffer.from([0]), Buffer.from(pixels.subarray(y * width, (y + 1) * width)));
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 0;
    header[10] = 0;
    header[11] = 0;
    header[12] = 0;
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(Buffer.concat(rows))),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}
export function renderLayoutPng(layout, pixelsPerModule = 4) {
    const pxPerPt = pixelsPerModule / layout.modulePt;
    const width = Math.round(layout.widthPt * pxPerPt);
    const height = Math.round(layout.heightPt * pxPerPt);
    const pixels = new Uint8Array(width * height).fill(255);
    const fill = (xPt, yPt, widthPt, heightPt) => {
        const left = Math.round(xPt * pxPerPt);
        const right = Math.round((xPt + widthPt) * pxPerPt);
        const top = Math.round(yPt * pxPerPt);
        const bottom = Math.round((yPt + heightPt) * pxPerPt);
        for (let y = top; y < bottom; y += 1)
            for (let x = left; x < right; x += 1)
                pixels[y * width + x] = 0;
    };
    for (const bar of layout.bars)
        fill(bar.xPt, layout.barTopPt, bar.widthPt, bar.heightPt);
    for (const rect of layout.frame)
        fill(rect.xPt, rect.yPt, rect.widthPt, rect.heightPt);
    return { png: encodeGreyPng(width, height, pixels), width, height };
}
