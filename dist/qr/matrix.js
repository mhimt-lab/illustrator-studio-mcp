import { createHash } from 'node:crypto';
import qrcodegen from '../vendor/qrcodegen.js';
export const QR_ERROR_CORRECTION_LEVELS = ['L', 'M', 'Q', 'H'];
export const QR_MIN_VERSION = 1;
export const QR_MAX_VERSION = 40;
export const QR_MIN_QUIET_ZONE_MODULES = 4;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const ECC = {
    L: qrcodegen.QrCode.Ecc.LOW,
    M: qrcodegen.QrCode.Ecc.MEDIUM,
    Q: qrcodegen.QrCode.Ecc.QUARTILE,
    H: qrcodegen.QrCode.Ecc.HIGH,
};
export class QrMatrixError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'QrMatrixError';
    }
}
export function qrContentBytes(content) {
    if (content.length === 0)
        throw new QrMatrixError('QR_CONTENT_EMPTY', 'content must not be empty.');
    if (LONE_SURROGATE.test(content))
        throw new QrMatrixError('QR_CONTENT_INVALID', 'content contains an unpaired surrogate and is not valid Unicode text.');
    return Buffer.from(content, 'utf8');
}
export function qrContentDigest(content) {
    return createHash('sha256').update(qrContentBytes(content)).digest('hex');
}
export function encodeQrMatrix(content, errorCorrection, version) {
    qrContentBytes(content);
    if (version !== 'auto' && (!Number.isInteger(version) || version < QR_MIN_VERSION || version > QR_MAX_VERSION)) {
        throw new RangeError('version must be "auto" or an integer from 1 to 40.');
    }
    const minVersion = version === 'auto' ? QR_MIN_VERSION : version;
    const maxVersion = version === 'auto' ? QR_MAX_VERSION : version;
    let code;
    try {
        code = qrcodegen.QrCode.encodeSegments(qrcodegen.QrSegment.makeSegments(content), ECC[errorCorrection], minVersion, maxVersion, -1, false);
    }
    catch (error) {
        if (error instanceof RangeError && error.message === 'Data too long') {
            throw new QrMatrixError('QR_CONTENT_TOO_LARGE', version === 'auto'
                ? `content does not fit any QR Code version at error correction ${errorCorrection}.`
                : `content does not fit version ${String(version)} at error correction ${errorCorrection}.`);
        }
        throw error;
    }
    const rows = [];
    for (let y = 0; y < code.size; y += 1) {
        const row = [];
        for (let x = 0; x < code.size; x += 1)
            row.push(code.getModule(x, y));
        rows.push(row);
    }
    return { version: code.version, modules: code.size, errorCorrection, mask: code.mask, rows };
}
