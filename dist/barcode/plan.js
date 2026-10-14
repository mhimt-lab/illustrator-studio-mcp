import { encodeEan } from './ean.js';
import { BarcodeInputError, resolveGtin, resolveGtin14 } from './gtin.js';
import { EAN_SPECS } from './ean.js';
import { placeNumeral } from './digit-outlines.js';
import { encodeItf14, ITF14_WIDE_NARROW_RATIO } from './itf14.js';
import { layoutItf14, layoutSymbol, mmToPt, ptToMm, resolveItf14Scale, resolveScale, } from './layout.js';
export const BARCODE_SYMBOLOGIES = ['ean13', 'ean8', 'itf14'];
export const BARCODE_BACKGROUNDS = ['white', 'none'];
export function barcodeWarnings(input) {
    const warnings = [{
            code: 'gtin_assignment_unverified',
            message: 'Whether this GTIN is assigned to you (and not to another product) cannot be checked here; use a number from your own GS1 company prefix.',
        }];
    if (input.symbology === 'itf14') {
        warnings.push({
            code: 'PRINT_QUALITY_NOT_VERIFIED',
            message: 'Structure, geometry and a decode of the drawn symbol are checked; print quality (ISO/IEC 15416 grade), substrate, ink spread and GS1 conformance are not verified.',
        }, {
            code: 'PLACEMENT_REQUIRES_PACKAGE_CONTEXT',
            message: 'Placement on the case is not checked or enforced: GS1 Japan advises the bar bottom (inside the bearer bar) about 32 mm +/- 3 mm above the case bottom and the bearer bar at least 19 mm from a corner.',
        });
        if (input.zeroPadded === true) {
            warnings.push({ code: 'gtin13_zero_padded', message: 'The GTIN-13 was padded with a leading 0 to 14 digits as requested; the plan data is the padded number.' });
        }
    }
    else {
        warnings.push({
            code: 'not_print_verified',
            message: 'Geometry and a decode of the drawn symbol are checked; print quality (ISO/IEC 15416 grade) and GS1 conformance are not verified.',
        });
        if (input.scale.magnification !== null && input.scale.magnification < 1) {
            warnings.push({ code: 'magnification_below_1', message: 'GS1 Japan advises magnification 1.0 or more whenever the space allows; 0.8 is the permitted minimum.' });
        }
    }
    if (input.background === 'none') {
        warnings.push({ code: 'background_none', message: 'Without a white background the Quiet Zones are whatever lies behind the symbol; scanning is not guaranteed.' });
    }
    return warnings;
}
function refuseOption(option, symbology) {
    throw new BarcodeInputError('BARCODE_OPTION_NOT_APPLICABLE', `${option} does not apply to ${symbology}.`);
}
export function resolveBarcode(fields, scaleOverride) {
    const symbology = fields.symbology;
    if (symbology === 'itf14') {
        if (fields.magnification !== undefined)
            refuseOption('magnification', symbology);
        if (fields.bearerBar === undefined) {
            throw new BarcodeInputError('BARCODE_BEARER_BAR_REQUIRED', 'itf14 needs bearer_bar {mode}: "plate" (4.83 mm frame around the Quiet Zones, for printing-plate processes) or "non_plate" (top and bottom bars of at least 2X). The tool does not choose the print process.');
        }
        const gtin = resolveGtin14(fields.data, fields.checkDigit, fields.normalizeGtin13 ?? 'reject');
        const scale = scaleOverride ?? resolveItf14Scale(fields.xDimensionMm);
        const encoding = encodeItf14(gtin.digits);
        const layout = layoutItf14(encoding, scale.xDimensionMm, fields.bearerBar);
        const bearer = layout.bearer;
        return {
            symbology, gtin, scale, encoding, layout, background: fields.background,
            itf14: {
                wideNarrowRatio: ITF14_WIDE_NARROW_RATIO, barHeightMm: ptToMm(layout.barHeightPt), symbolWidthMm: ptToMm(encoding.symbolUnits * layout.modulePt),
                bearerBar: { mode: bearer.mode, thicknessMm: ptToMm(bearer.thicknessPt) }, normalization: gtin.normalization,
            },
            hri: { mode: 'outline_paths' },
            warnings: barcodeWarnings({ symbology, scale, background: fields.background, zeroPadded: gtin.normalization !== null }),
        };
    }
    if (fields.normalizeGtin13 !== undefined)
        refuseOption('normalize_gtin13', symbology);
    if (fields.bearerBar !== undefined)
        refuseOption('bearer_bar', symbology);
    const gtin = resolveGtin(EAN_SPECS[symbology].digits, fields.data, fields.checkDigit);
    const scale = scaleOverride ?? resolveScale({ magnification: fields.magnification, xDimensionMm: fields.xDimensionMm });
    const encoding = encodeEan(symbology, gtin.digits);
    const layout = layoutSymbol(encoding, { magnification: scale.magnification, xDimensionMm: scale.xDimensionMm });
    return {
        symbology, gtin, scale, encoding, layout, itf14: null, background: fields.background,
        hri: { mode: 'outline_paths' },
        warnings: barcodeWarnings({ symbology, scale, background: fields.background }),
    };
}
export function hostLayout(resolved) {
    const { layout } = resolved;
    return {
        widthPt: layout.widthPt, heightPt: layout.heightPt, barTopPt: layout.barTopPt,
        frame: layout.frame.map((rect) => [rect.name, rect.xPt, rect.yPt, rect.widthPt, rect.heightPt]),
        bars: layout.bars.map((bar) => [bar.xPt, bar.widthPt, bar.heightPt]),
        digits: layout.hri.map((slot) => [slot.digit, slot.centerXPt, placeNumeral(slot.digit, layout.hriHeightPt, slot.centerXPt, layout.heightPt)]),
    };
}
export function symbolSummary(resolved) {
    const { layout } = resolved;
    return {
        widthPt: layout.widthPt, heightPt: layout.heightPt,
        widthMm: ptToMm(layout.widthPt), heightMm: ptToMm(layout.heightPt),
        quietZoneMm: { left: ptToMm(layout.quietLeftPt), right: ptToMm(layout.quietRightPt) },
        rectangleCount: layout.bars.length + layout.frame.length + (resolved.background === 'white' ? 1 : 0),
        digitCount: layout.hri.length,
    };
}
export { mmToPt };
