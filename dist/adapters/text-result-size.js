import { PRIVATE_RECORD_LIMITS } from '../private-record.js';
export const TEXT_RESULT_ADMISSION_BYTES = Math.floor(PRIVATE_RECORD_LIMITS.result * 0.8);
export const TEXT_RESULT_FIXED_BYTES = 32_768;
const COUNT_FUNCTIONS = String.raw `
function textResultJsonBytes(value) {
  var size = 0, index = 0, code = 0, key = '';
  if (value === null || value === undefined) return 4;
  if (typeof value === 'string') {
    size = 2;
    for (index = 0; index < value.length; index++) {
      code = value.charCodeAt(index);
      // #749: the durable writer (stringifyJson -> jsonFileTextWithBytes) stores each surrogate unit, paired or
      // not, as a 6-byte ASCII escape (backslash, u, 4 hex digits), the same as snapshotJsonBytes.
      if (code < 32 || (code >= 55296 && code <= 57343)) size += 6;
      else if (code === 34 || code === 92) size += 2;
      else if (code < 128) size++;
      else if (code < 2048) size += 2;
      else size += 3;
    }
    return size;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).length;
  if (Object.prototype.toString.call(value) === '[object Array]') {
    var array = value;
    size = 2 + Math.max(0, array.length - 1);
    for (index = 0; index < array.length; index++) size += textResultJsonBytes(array[index]);
    return size;
  }
  size = 2;
  for (key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      if (size > 2) size++;
      size += textResultJsonBytes(key) + 1 + textResultJsonBytes(value[key]);
    }
  }
  return size;
}

/** Count the full plan (both tables), one additional table, and fixed execution overhead. */
function textResultBytes(plan) {
  var normalized = {}, key = '';
  for (key in plan) if (Object.prototype.hasOwnProperty.call(plan, key)) normalized[key] = plan[key];
  // The same estimate at plan and apply, independent of confirmation/blockers.
  normalized.applyBlockedReasonCodes = [];
  normalized.confirmationStatus = 'confirmed';
  normalized.applyAllowed = true;
  return textResultJsonBytes(normalized) + Math.max(textResultJsonBytes(plan.before),
    textResultJsonBytes(plan.after)) + TEXT_RESULT_FIXED_BYTES;
}

`;
const counters = new Function('TEXT_RESULT_FIXED_BYTES', COUNT_FUNCTIONS
    + '\nreturn { bytes: textResultJsonBytes, result: textResultBytes };')(TEXT_RESULT_FIXED_BYTES);
export const textResultJsonBytes = counters.bytes;
export const textResultBytes = counters.result;
export const recordedTextJsonBytes = textResultJsonBytes;
export const recordedTextResultBytes = textResultBytes;
export function textResultSizeMessage(plan, estimate = textResultBytes(plan)) {
    const groups = plan.before.groupAncestry?.length ?? 0;
    const where = groups === 0 ? '' : ` in ${groups} enclosing group${groups === 1 ? '' : 's'}, whose child lists are part of the evidence`;
    return `result_too_large: estimated ${estimate} UTF-8 bytes for ${Math.max(plan.before.contents.length, plan.after.contents.length)} UTF-16 units${where}; limit ${TEXT_RESULT_ADMISSION_BYTES} bytes (80% of ${PRIVATE_RECORD_LIMITS.result}). Split the range or frame`
        + (groups === 0 ? '. 範囲を分けるか、枠を分けてください。' : ', or edit the frame outside groups with many children. 範囲や枠を分けるか、子の多いグループの外で編集してください。');
}
export const TEXT_RESULT_SIZE_SCRIPT = `
var TEXT_RESULT_FIXED_BYTES = ${TEXT_RESULT_FIXED_BYTES};
var TEXT_RESULT_ADMISSION_BYTES = ${TEXT_RESULT_ADMISSION_BYTES};
${COUNT_FUNCTIONS}
function textResultAdmitPlan(plan) {
  var bytes = textResultBytes(plan);
  if (bytes > TEXT_RESULT_ADMISSION_BYTES) {
    plan.applyBlockedReasonCodes.push("result_too_large");
    plan.applyAllowed = false;
    if (params.apply === true) throw new Error("result_too_large: estimated " + bytes + " UTF-8 bytes; limit " + TEXT_RESULT_ADMISSION_BYTES + ". Split the range or frame.");
  }
  return plan;
}
`;
