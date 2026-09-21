export const RECTANGLE_BOUNDS_TOLERANCE_PT = 0.01;
export const RECTANGLE_BOUNDS_PRECISION_DIGITS = 12;
export class RectangleTargetError extends Error {
    code;
    reasonCodes;
    constructor(code, reasonCodes, message) {
        super(message);
        this.code = code;
        this.reasonCodes = reasonCodes;
        this.name = 'RectangleTargetError';
    }
}
