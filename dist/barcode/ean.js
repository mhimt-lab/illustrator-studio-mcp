const SET_A = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const complement = (pattern) => [...pattern].map((bit) => (bit === '1' ? '0' : '1')).join('');
const reverse = (pattern) => [...pattern].reverse().join('');
const SET_C = SET_A.map(complement);
const SET_B = SET_C.map(reverse);
const LEADING_DIGIT_PARITY = ['AAAAAA', 'AABABB', 'AABBAB', 'AABBBA', 'ABAABB', 'ABBAAB', 'ABBBAA', 'ABABAB', 'ABABBA', 'ABBABA'];
const START_END_GUARD = '101';
const CENTRE_GUARD = '01010';
export const EAN_SPECS = {
    ean13: { digits: 13, quietLeft: 11, quietRight: 7, symbolModules: 95 },
    ean8: { digits: 8, quietLeft: 7, quietRight: 7, symbolModules: 67 },
};
function pushPattern(modules, roles, pattern, role) {
    const start = modules.length;
    for (const bit of pattern) {
        modules.push(bit === '1' ? 1 : 0);
        roles.push(role);
    }
    return start;
}
export function encodeEan(symbology, digits) {
    const spec = EAN_SPECS[symbology];
    if (digits.length !== spec.digits || !/^[0-9]+$/u.test(digits))
        throw new Error(`encodeEan(${symbology}) needs exactly ${spec.digits} digits.`);
    const modules = [];
    const roles = [];
    const slots = [];
    const digitAt = (index) => Number(digits[index]);
    pushPattern(modules, roles, START_END_GUARD, 'guard');
    let leftSets;
    let leftDigits;
    let rightDigits;
    if (symbology === 'ean13') {
        leftSets = LEADING_DIGIT_PARITY[digitAt(0)];
        leftDigits = [1, 2, 3, 4, 5, 6];
        rightDigits = [7, 8, 9, 10, 11, 12];
        slots.push({ digitIndex: 0, digit: digitAt(0), moduleRange: null });
    }
    else {
        leftSets = 'AAAA';
        leftDigits = [0, 1, 2, 3];
        rightDigits = [4, 5, 6, 7];
    }
    leftDigits.forEach((digitIndex, position) => {
        const set = leftSets[position] === 'B' ? SET_B : SET_A;
        const start = pushPattern(modules, roles, set[digitAt(digitIndex)], 'data');
        slots.push({ digitIndex, digit: digitAt(digitIndex), moduleRange: [start, start + 7] });
    });
    pushPattern(modules, roles, CENTRE_GUARD, 'guard');
    for (const digitIndex of rightDigits) {
        const start = pushPattern(modules, roles, SET_C[digitAt(digitIndex)], 'data');
        slots.push({ digitIndex, digit: digitAt(digitIndex), moduleRange: [start, start + 7] });
    }
    pushPattern(modules, roles, START_END_GUARD, 'guard');
    if (modules.length !== spec.symbolModules)
        throw new Error('EAN encoding produced an unexpected module count.');
    return {
        symbology, digits, modules, roles, slots,
        quietZone: { left: spec.quietLeft, right: spec.quietRight },
        leadingDigitOutside: symbology === 'ean13',
    };
}
export function darkRuns(encoding) {
    const runs = [];
    let index = 0;
    while (index < encoding.modules.length) {
        if (encoding.modules[index] !== 1) {
            index += 1;
            continue;
        }
        const start = index;
        const role = encoding.roles[index];
        while (index < encoding.modules.length && encoding.modules[index] === 1) {
            if (encoding.roles[index] !== role)
                throw new Error('A dark run mixes guard and data modules.');
            index += 1;
        }
        runs.push({ start, length: index - start, role });
    }
    return runs;
}
