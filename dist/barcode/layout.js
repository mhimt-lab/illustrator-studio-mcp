import { darkRuns, EAN_SPECS } from './ean.js';
import { numeralFont } from './digit-outlines.js';
import { ITF14_QUIET_ZONE_X, ITF14_UNITS_PER_X, itf14Bars } from './itf14.js';
export const MM_PER_INCH = 25.4;
export const PT_PER_INCH = 72;
export const mmToPt = (mm) => (mm * PT_PER_INCH) / MM_PER_INCH;
export const ptToMm = (pt) => (pt * MM_PER_INCH) / PT_PER_INCH;
export const NOMINAL_X_DIMENSION_MM = 0.33;
export const MAGNIFICATION_MIN = 0.8;
export const MAGNIFICATION_MAX = 2.0;
export const X_DIMENSION_MIN_MM = 0.264;
export const X_DIMENSION_MAX_MM = 0.66;
const SCALE_EPSILON = 1e-9;
export const EAN_NOMINAL = {
    ean13: { barHeightMm: 22.85, symbolHeightMm: 25.93 },
    ean8: { barHeightMm: 18.23, symbolHeightMm: 21.31 },
};
export const GUARD_EXTENSION_MODULES = 5;
export const HRI_GAP_MODULES = 1;
export const HRI_NOMINAL_HEIGHT_MM = 2.75;
export class BarcodeScaleError extends Error {
    code;
    constructor(code, message) {
        super(`${code}: ${message}`);
        this.code = code;
        this.name = 'BarcodeScaleError';
    }
}
export const ITF14_X_DIMENSION_MIN_MM = 0.635;
export const ITF14_X_DIMENSION_MAX_MM = 1.016;
export const ITF14_X_DIMENSION_DEFAULT_MM = 1.016;
export const ITF14_BAR_HEIGHT_NOMINAL_MM = 31.8;
export const ITF14_BAR_HEIGHT_MIN_MM = 31.75;
export const ITF14_PLATE_BEARER_MM = 4.8;
export const ITF14_NON_PLATE_BEARER_X = 2;
export const ITF14_QUIET_ZONE_NOMINAL_MM = 10.9;
export const ITF14_HRI_HEIGHT_NOMINAL_MM = 6.2;
export const ITF14_HRI_GAP_NOMINAL_MM = 1.2;
export const ITF14_HRI_GROUPS = [3, 5, 5, 1];
export const ITF14_HRI_GROUP_SPACE_ADVANCES = 0.5;
export const BEARER_BAR_MODES = ['plate', 'non_plate'];
export function resolveItf14Scale(xDimensionMm) {
    const x = xDimensionMm ?? ITF14_X_DIMENSION_DEFAULT_MM;
    if (!Number.isFinite(x) || x < ITF14_X_DIMENSION_MIN_MM - SCALE_EPSILON || x > ITF14_X_DIMENSION_MAX_MM + SCALE_EPSILON) {
        throw new BarcodeScaleError('BARCODE_SCALE_OUT_OF_RANGE', `x_dimension_mm for itf14 must be ${ITF14_X_DIMENSION_MIN_MM}-${ITF14_X_DIMENSION_MAX_MM} mm; received ${x} mm.`);
    }
    return { magnification: null, xDimensionMm: Math.min(ITF14_X_DIMENSION_MAX_MM, Math.max(ITF14_X_DIMENSION_MIN_MM, x)) };
}
export function resolveScale(input) {
    if (input.magnification !== undefined && input.xDimensionMm !== undefined) {
        throw new BarcodeScaleError('BARCODE_SCALE_CONFLICT', 'Pass either magnification or x_dimension_mm, not both.');
    }
    let magnification;
    let xDimensionMm;
    if (input.xDimensionMm !== undefined) {
        xDimensionMm = input.xDimensionMm;
        magnification = xDimensionMm / NOMINAL_X_DIMENSION_MM;
    }
    else {
        magnification = input.magnification ?? 1;
        xDimensionMm = magnification * NOMINAL_X_DIMENSION_MM;
    }
    if (!Number.isFinite(magnification) || !Number.isFinite(xDimensionMm)
        || xDimensionMm < X_DIMENSION_MIN_MM - SCALE_EPSILON || xDimensionMm > X_DIMENSION_MAX_MM + SCALE_EPSILON) {
        throw new BarcodeScaleError('BARCODE_SCALE_OUT_OF_RANGE', `X-dimension must be ${X_DIMENSION_MIN_MM}-${X_DIMENSION_MAX_MM} mm (magnification ${MAGNIFICATION_MIN}-${MAGNIFICATION_MAX}); received ${xDimensionMm} mm.`);
    }
    const clampedX = Math.min(X_DIMENSION_MAX_MM, Math.max(X_DIMENSION_MIN_MM, xDimensionMm));
    return { magnification: clampedX / NOMINAL_X_DIMENSION_MM, xDimensionMm: clampedX };
}
export const LEADING_DIGIT_CENTER_MODULES = 4.5;
export function layoutSymbol(encoding, scale) {
    const modulePt = mmToPt(scale.xDimensionMm);
    const nominal = EAN_NOMINAL[encoding.symbology];
    const spec = EAN_SPECS[encoding.symbology];
    const barHeightPt = mmToPt(nominal.barHeightMm * scale.magnification);
    const guardHeightPt = barHeightPt + GUARD_EXTENSION_MODULES * modulePt;
    const hriGapPt = HRI_GAP_MODULES * modulePt;
    const hriHeightPt = mmToPt(HRI_NOMINAL_HEIGHT_MM * scale.magnification);
    const originXPt = encoding.quietZone.left * modulePt;
    const bars = darkRuns(encoding).map((run) => ({
        xPt: (encoding.quietZone.left + run.start) * modulePt,
        widthPt: run.length * modulePt,
        heightPt: run.role === 'guard' ? guardHeightPt : barHeightPt,
        role: run.role,
        startModule: run.start,
        lengthModules: run.length,
    }));
    const hri = encoding.slots.map((slot) => ({
        digitIndex: slot.digitIndex,
        digit: String(slot.digit),
        centerXPt: slot.moduleRange === null
            ? (encoding.quietZone.left - LEADING_DIGIT_CENTER_MODULES) * modulePt
            : (encoding.quietZone.left + (slot.moduleRange[0] + slot.moduleRange[1]) / 2) * modulePt,
    }));
    return {
        symbology: encoding.symbology, digits: encoding.digits, scale, modulePt,
        widthPt: (spec.quietLeft + spec.symbolModules + spec.quietRight) * modulePt,
        heightPt: barHeightPt + hriGapPt + hriHeightPt,
        quietLeftPt: encoding.quietZone.left * modulePt,
        quietRightPt: encoding.quietZone.right * modulePt,
        barHeightPt, guardHeightPt, hriGapPt, hriHeightPt, originXPt, barTopPt: 0, frame: [], bearer: null, bars, hri,
    };
}
export function layoutItf14(encoding, xDimensionMm, mode) {
    const unitPt = mmToPt(xDimensionMm) / ITF14_UNITS_PER_X;
    const xPt = mmToPt(xDimensionMm);
    const k = xDimensionMm / ITF14_X_DIMENSION_MAX_MM;
    const quietPt = Math.max(mmToPt(ITF14_QUIET_ZONE_NOMINAL_MM * k), ITF14_QUIET_ZONE_X * xPt);
    const symbolPt = encoding.symbolUnits * unitPt;
    const innerWidthPt = quietPt + symbolPt + quietPt;
    const thicknessPt = mode === 'plate' ? mmToPt(ITF14_PLATE_BEARER_MM) : ITF14_NON_PLATE_BEARER_X * xPt;
    const sideBearerPt = mode === 'plate' ? thicknessPt : 0;
    const widthPt = sideBearerPt + innerWidthPt + sideBearerPt;
    const barHeightPt = mmToPt(Math.max(ITF14_BAR_HEIGHT_MIN_MM, ITF14_BAR_HEIGHT_NOMINAL_MM * k));
    const frameHeightPt = thicknessPt + barHeightPt + thicknessPt;
    const hriGapPt = mmToPt(ITF14_HRI_GAP_NOMINAL_MM * k);
    const hriHeightPt = mmToPt(ITF14_HRI_HEIGHT_NOMINAL_MM * k);
    const originXPt = sideBearerPt + quietPt;
    const bars = itf14Bars(encoding).map((element) => ({
        xPt: originXPt + element.startUnit * unitPt, widthPt: element.units * unitPt, heightPt: barHeightPt, role: 'data', startModule: element.startUnit, lengthModules: element.units,
    }));
    const frame = [
        { name: 'bearer-top', xPt: 0, yPt: 0, widthPt, heightPt: thicknessPt },
        { name: 'bearer-bottom', xPt: 0, yPt: thicknessPt + barHeightPt, widthPt, heightPt: thicknessPt },
        ...(mode === 'plate' ? [
            { name: 'bearer-left', xPt: 0, yPt: thicknessPt, widthPt: sideBearerPt, heightPt: barHeightPt },
            { name: 'bearer-right', xPt: sideBearerPt + innerWidthPt, yPt: thicknessPt, widthPt: sideBearerPt, heightPt: barHeightPt },
        ] : []),
    ];
    const font = numeralFont();
    const fontScale = hriHeightPt / (font.inkTop - font.inkBottom);
    const advancePt = (digit) => font.digits[digit].advance * fontScale;
    const groupSpacePt = ITF14_HRI_GROUP_SPACE_ADVANCES * font.digits['0'].advance * fontScale;
    const runPt = [...encoding.digits].reduce((total, digit) => total + advancePt(digit), 0) + (ITF14_HRI_GROUPS.length - 1) * groupSpacePt;
    let cursor = widthPt / 2 - runPt / 2;
    const groupStarts = new Set(ITF14_HRI_GROUPS.map((_, index) => ITF14_HRI_GROUPS.slice(0, index).reduce((a, b) => a + b, 0)));
    const hri = [...encoding.digits].map((digit, index) => {
        if (index > 0 && groupStarts.has(index))
            cursor += groupSpacePt;
        const centerXPt = cursor + advancePt(digit) / 2;
        cursor += advancePt(digit);
        return { digitIndex: index, digit, centerXPt };
    });
    return {
        symbology: 'itf14', digits: encoding.digits, scale: { magnification: null, xDimensionMm }, modulePt: unitPt,
        widthPt, heightPt: frameHeightPt + hriGapPt + hriHeightPt, quietLeftPt: quietPt, quietRightPt: quietPt,
        barHeightPt, guardHeightPt: barHeightPt, hriGapPt, hriHeightPt, originXPt, barTopPt: thicknessPt, frame, bearer: { mode, thicknessPt }, bars, hri,
    };
}
