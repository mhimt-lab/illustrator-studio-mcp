export class BarcodeInputError extends Error {
    code;
    constructor(code, message) {
        super(`${code}: ${message}`);
        this.code = code;
        this.name = 'BarcodeInputError';
    }
}
export function gtinCheckDigit(body) {
    if (!/^[0-9]+$/u.test(body))
        throw new BarcodeInputError('BARCODE_NON_NUMERIC_DATA', 'The GTIN body must be digits only.');
    let sum = 0;
    for (let index = 0; index < body.length; index += 1) {
        const weight = (body.length - index) % 2 === 1 ? 3 : 1;
        sum += Number(body[index]) * weight;
    }
    return (10 - (sum % 10)) % 10;
}
export function resolveGtin(fullLength, data, mode) {
    if (typeof data !== 'string')
        throw new BarcodeInputError('BARCODE_NON_NUMERIC_DATA', 'data must be a JSON string of digits (a number may have lost digits).');
    if (!/^[0-9]*$/u.test(data) || data.length === 0) {
        throw new BarcodeInputError('BARCODE_NON_NUMERIC_DATA', 'data must contain digits 0-9 only; spaces, hyphens and other characters are not removed.');
    }
    const bodyLength = fullLength - 1;
    if (mode === 'calculate') {
        if (data.length !== bodyLength) {
            throw new BarcodeInputError('BARCODE_INVALID_LENGTH', `check_digit "calculate" needs exactly ${bodyLength} digits (without the check digit); received ${data.length}.`);
        }
        const checkDigit = gtinCheckDigit(data);
        return { digits: `${data}${checkDigit}`, checkDigit, checkDigitStatus: 'calculated' };
    }
    if (data.length === bodyLength) {
        throw new BarcodeInputError('BARCODE_CHECK_DIGIT_REQUIRED', `${bodyLength} digits have no check digit; pass the complete ${fullLength} digits, or set check_digit to "calculate" to have it appended.`);
    }
    if (data.length !== fullLength) {
        throw new BarcodeInputError('BARCODE_INVALID_LENGTH', `data must be exactly ${fullLength} digits; received ${data.length}.`);
    }
    const expected = gtinCheckDigit(data.slice(0, bodyLength));
    const actual = Number(data[bodyLength]);
    if (expected !== actual) {
        throw new BarcodeInputError('BARCODE_INVALID_CHECK_DIGIT', `The check digit is ${actual}; the other digits require ${expected}.`);
    }
    return { digits: data, checkDigit: actual, checkDigitStatus: 'valid' };
}
export function resolveGtin14(data, mode, normalize) {
    if (typeof data !== 'string')
        throw new BarcodeInputError('BARCODE_NON_NUMERIC_DATA', 'data must be a JSON string of digits (a number may have lost digits).');
    if (!/^[0-9]*$/u.test(data) || data.length === 0) {
        throw new BarcodeInputError('BARCODE_NON_NUMERIC_DATA', 'data must contain digits 0-9 only; spaces, hyphens and other characters are not removed.');
    }
    if (normalize === 'prefix_zero') {
        if (mode === 'calculate') {
            throw new BarcodeInputError('BARCODE_OPTION_CONFLICT', 'normalize_gtin13 "prefix_zero" pads a complete GTIN-13 and cannot be combined with check_digit "calculate" (which takes the 13-digit body of a GTIN-14).');
        }
        if (data.length !== 13) {
            throw new BarcodeInputError('BARCODE_INVALID_LENGTH', `normalize_gtin13 "prefix_zero" applies only to a complete 13-digit GTIN; received ${data.length} digits.`);
        }
        return { ...resolveGtin(14, `0${data}`, 'validate'), normalization: { rule: 'prefix_zero', input: data } };
    }
    if (mode === 'validate' && data.length === 13) {
        throw new BarcodeInputError('BARCODE_GTIN_NORMALIZATION_REQUIRED', '13 digits are not an ITF-14 number: a GTIN-13 is carried as 14 digits with a leading 0 only when normalize_gtin13 is "prefix_zero" (the plan shows the padded value); a 13-digit body of a GTIN-14 needs check_digit "calculate".');
    }
    return { ...resolveGtin(14, data, mode), normalization: null };
}
