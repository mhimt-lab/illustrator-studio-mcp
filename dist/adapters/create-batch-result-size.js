import { SNAPSHOT_RESULT_ADMISSION_BYTES, SNAPSHOT_RESULT_SIZE_SCRIPT } from './snapshot-result-size.js';
const SOURCE = String.raw `
var CREATE_BATCH_RESULT_FIXED_BYTES = 4096;
var CREATE_BATCH_UUID_MIN_BYTES = 36;
var CREATE_BATCH_CREATED_POINT_TEXT_BYTES = 1020;
var CREATE_BATCH_CREATED_RECTANGLE_BYTES = 110;
var CREATE_BATCH_CREATED_SHAPE_BYTES = 150;
var CREATE_BATCH_CREATED_ANCHOR_BYTES = 110;
var CREATE_BATCH_CREATED_APPEARANCE_BYTES = 280;
var CREATE_BATCH_ROLLBACK_STEP_BYTES = 72;
var CREATE_BATCH_ROLLBACK_FIXED_BYTES = 500;
function createBatchResultBytes(plan) {
  var uuidBytes = CREATE_BATCH_UUID_MIN_BYTES;
  var layerUuidEntries = 0, baselineEntries = 0;
  for (var l = 0; l < plan.layers.length; l++) {
    var layer = plan.layers[l];
    for (var u = 0; u < layer.itemUuids.length; u++) uuidBytes = Math.max(uuidBytes, snapshotJsonBytes(layer.itemUuids[u]) - 2);
    baselineEntries += layer.itemUuids.length;
    layerUuidEntries += layer.itemUuids.length + layer.createdCount;
  }
  var entryBytes = uuidBytes + 3;
  var created = 0;
  for (var s = 0; s < plan.steps.length; s++) {
    var step = plan.steps[s];
    var item = uuidBytes;
    if (step.operation === "create_point_text") {
      item += CREATE_BATCH_CREATED_POINT_TEXT_BYTES + uuidBytes + snapshotJsonBytes(step.contents) +
        snapshotJsonBytes(step.requestedStyle.fontPostScriptName) + snapshotJsonBytes(plan.layers[step.layerIndex].path) +
        snapshotJsonBytes(plan.layers[step.layerIndex].ancestry);
    } else if (step.operation === "create_rectangle") {
      item += CREATE_BATCH_CREATED_RECTANGLE_BYTES + snapshotJsonBytes(step.name === null ? "" : step.name);
    } else {
      item += CREATE_BATCH_CREATED_SHAPE_BYTES + snapshotJsonBytes(step.name === null ? "" : step.name) +
        CREATE_BATCH_CREATED_ANCHOR_BYTES * step.geometry.anchors.length;
    }
    if (step.operation !== "create_point_text" && step.appearance !== undefined) item += CREATE_BATCH_CREATED_APPEARANCE_BYTES;
    created += item;
  }
  var verifiedExtra = created + layerUuidEntries * entryBytes;
  var rollbackExtra = plan.steps.length * (CREATE_BATCH_ROLLBACK_STEP_BYTES + uuidBytes) + baselineEntries * entryBytes +
    CREATE_BATCH_ROLLBACK_FIXED_BYTES;
  return CREATE_BATCH_RESULT_FIXED_BYTES + 2 * snapshotJsonBytes(plan.documentKey) + snapshotJsonBytes(plan.layers) +
    snapshotJsonBytes(plan.steps) + Math.max(verifiedExtra, rollbackExtra);
}
`;
export const createBatchResultBytes = new Function(`${SNAPSHOT_RESULT_SIZE_SCRIPT}\n${SOURCE}\nreturn createBatchResultBytes;`)();
export const CREATE_BATCH_RESULT_ADMISSION_BYTES = SNAPSHOT_RESULT_ADMISSION_BYTES;
export const CREATE_BATCH_RESULT_SIZE_SCRIPT = `${SOURCE}var CREATE_BATCH_RESULT_ADMISSION_BYTES = ${CREATE_BATCH_RESULT_ADMISSION_BYTES};\n`;
