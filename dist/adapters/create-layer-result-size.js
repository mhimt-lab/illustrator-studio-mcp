import { SNAPSHOT_JSON_BYTES_SCRIPT, SNAPSHOT_RESULT_ADMISSION_BYTES, SNAPSHOT_RESULT_FIXED_BYTES, snapshotJsonBytes } from './snapshot-result-size.js';
const RESULT_BYTES_FUNCTION = String.raw `
function createLayerResultBytes(fixedBytes, documentKey, before, names) {
  var beforeBytes = 0, newBytes = 0, namesBytes = 0, index = 0;
  for (index = 0; index < before.length; index++) beforeBytes += snapshotJsonBytes(before[index]) + 1;
  for (index = 0; index < names.length; index++) {
    newBytes += snapshotJsonBytes({ name: names[index], visible: true, locked: false, printable: true, childLayerCount: 0, pageItemCount: 0 }) + 1;
    namesBytes += snapshotJsonBytes(names[index]) + 1;
  }
  // A created layer path is at most 65 indices of at most 3 digits plus separators; it appears in the plan and in the postcondition.
  var pathBytes = 2 * names.length * 262;
  // plan: before + after + created; postcondition: after + created; the names are echoed once; the document key appears in the context and in the plan.
  return fixedBytes + 2 * snapshotJsonBytes(documentKey) + beforeBytes + 2 * (beforeBytes + newBytes) + 2 * newBytes + namesBytes + pathBytes;
}
`;
export const CREATE_LAYER_RESULT_SIZE_SCRIPT = `${SNAPSHOT_JSON_BYTES_SCRIPT}${RESULT_BYTES_FUNCTION}`;
const compiled = new Function('snapshotJsonBytes', `${RESULT_BYTES_FUNCTION}\nreturn createLayerResultBytes;`)(snapshotJsonBytes);
export function createLayerResultBytes(documentKey, before, names) {
    return compiled(SNAPSHOT_RESULT_FIXED_BYTES, documentKey, before, names);
}
export const CREATE_LAYER_RESULT_ADMISSION = Object.freeze({ limit: SNAPSHOT_RESULT_ADMISSION_BYTES, fixed: SNAPSHOT_RESULT_FIXED_BYTES });
export function createLayerResultTooLarge(documentKey, before, names) {
    return createLayerResultBytes(documentKey, before, names) > SNAPSHOT_RESULT_ADMISSION_BYTES;
}
export function createLayerResultSizeMessage(documentKey, before, names) {
    return `result_too_large: estimated ${createLayerResultBytes(documentKey, before, names)} UTF-8 bytes; limit ${SNAPSHOT_RESULT_ADMISSION_BYTES}. Shorten the layer names, create fewer layers per call, or create them under a layer with fewer siblings, then create a new plan.`;
}
