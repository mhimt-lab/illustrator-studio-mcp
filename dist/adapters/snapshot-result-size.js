import { PRIVATE_RECORD_LIMITS } from '../private-record.js';
import { AREA_TEXT_MAX_LINES } from './area-text-host-script.js';
export const SNAPSHOT_RESULT_ADMISSION_BYTES = Math.floor(PRIVATE_RECORD_LIMITS.result * 0.8);
const FIXED_BYTES = 32_768;
const COUNTERS = String.raw `
function snapshotJsonBytes(value) {
  if (value === null || value === undefined) return 4;
  if (typeof value === "string") {
    var size = 2;
    for (var i = 0; i < value.length; i++) {
      var c = value.charCodeAt(i);
      if (c < 32 || (c >= 55296 && c <= 57343)) size += 6;
      else if (c === 34 || c === 92) size += 2;
      else if (c < 128) size++;
      else if (c < 2048) size += 2;
      else size += 3;
    }
    return size;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value).length;
  var bytes = 2, index = 0, key = "";
  if (Object.prototype.toString.call(value) === "[object Array]") {
    bytes += Math.max(0, value.length - 1);
    for (index = 0; index < value.length; index++) bytes += snapshotJsonBytes(value[index]);
  } else {
    for (key in value) if (Object.prototype.hasOwnProperty.call(value, key)) {
      if (bytes > 2) bytes++;
      bytes += snapshotJsonBytes(key) + 1 + snapshotJsonBytes(value[key]);
    }
  }
  return bytes;
}
function snapshotResultBytes(documentKey, pairs, layoutUnits) {
  var bytes = SNAPSHOT_RESULT_FIXED_BYTES + 2 * snapshotJsonBytes(documentKey);
  for (var i = 0; i < pairs.length; i++) {
    var before = snapshotJsonBytes(pairs[i].before), after = snapshotJsonBytes(pairs[i].after);
    // Snapshots plus the operation-specific terminal envelope (one observed/restored snapshot per step).
    bytes += before + after + (pairs[i].terminalBytes === undefined ? Math.max(before, after) : pairs[i].terminalBytes);
    var variable = {}, fields = ["replacement", "start", "end", "noBreak", "metadata"];
    for (var f = 0; f < fields.length; f++) if (pairs[i][fields[f]] !== undefined) variable[fields[f]] = pairs[i][fields[f]];
    bytes += snapshotJsonBytes(variable);
    // UUID appears outside the snapshots in the plan and rollback wrappers (twice in a mixed plan).
    if (pairs[i].targetUuid !== undefined) bytes += 3 * snapshotJsonBytes(pairs[i].targetUuid);
  }
  // Area no-break has three observed line tables (plan before, result before and result after).
  // The future wrapping is not predicted: bound 6 B per UTF-16 unit, the allowed extra line breaks,
  // quotes/commas for every line, and fixed fit/count keys. The same bound is available from apply echoes.
  if (layoutUnits !== undefined && layoutUnits !== null) {
    bytes += 3 * (6 * (layoutUnits + SNAPSHOT_RESULT_MAX_LINES) + 3 * SNAPSHOT_RESULT_MAX_LINES + 512);
  }
  return bytes;
}
// Canonical variable payload available identically from a step plan and its validated apply echoes.
// Bounded enums/booleans/numbers and field names stay in the fixed reserve; no variable strings do.
function mixedSnapshotResultPairs(documentKey, steps, fromApply) {
  var pairs = [], moveGrowth = 0;
  for (var m = 0; m < steps.length; m++) if (steps[m].operation === "move_object_to_layer") moveGrowth += snapshotJsonBytes(steps[m].targetUuid) + 1;
  for (var i = 0; i < steps.length; i++) {
    var step = steps[i], p = fromApply ? step : step.plan;
    var before = fromApply ? p.expectedBefore : p.before, after = fromApply ? p.confirmedAfter : p.after;
    // Counting a key even for layer/appearance plans (which omit it) is conservative.
    var metadata = { documentKey: documentKey }, terminal = Math.max(snapshotJsonBytes(before), snapshotJsonBytes(after));
    var pair = { before: before, after: after, targetUuid: step.targetUuid, metadata: metadata };
    if (step.operation === "replace_point_text") pair.replacement = p.replacement;
    else if (step.operation === "set_text_style") { metadata.start = p.start; metadata.end = p.end; metadata.style = p.style; }
    else if (step.operation === "transform_object") {
      metadata.transform = p.transform;
      // A combined translation changes the embedded JSON numbers. Its enforced wire cap is 4096 UTF-16 units.
      if (before.nestedGroup) terminal += 6 * 4096 + 2 - Math.min(snapshotJsonBytes(before.nestedGroup), snapshotJsonBytes(after.nestedGroup));
    } else if (step.operation === "set_object_state") {
      metadata.targetType = p.targetType; metadata.requested = fromApply ? p.after : p.requested;
      // changes[] repeats the requested before/after scalar values, including the requested name.
      metadata.changeValues = [];
      for (var key in metadata.requested) if (Object.prototype.hasOwnProperty.call(metadata.requested, key)) metadata.changeValues.push([before[key], after[key]]);
    } else if (step.operation === "set_layer_state") {
      metadata.layerPath = p.layerPath; metadata.requested = fromApply ? p.after : p.requested;
      // Prefix/final trees combine both edits; bound their embedded JSON by the enforced 8192-unit cap.
      terminal = snapshotJsonBytes({ uuid: step.targetUuid, evidence: "" }) + 6 * 8192;
    } else if (step.operation === "move_object_to_layer") {
      metadata.placement = p.placement;
      metadata.sourceOrderBefore = fromApply ? p.expectedSourceOrder : p.sourceOrderBefore;
      metadata.destinationOrderBefore = fromApply ? p.expectedDestinationOrder : p.destinationOrderBefore;
      // Destination layer name and rollback anchor UUID are not echoed. Both have enforced 255-unit caps.
      terminal += snapshotJsonBytes(metadata.sourceOrderBefore) + snapshotJsonBytes(metadata.destinationOrderBefore) + moveGrowth;
      // Account the two bounded strings explicitly, separately from the fixed reserve and the order payload.
      terminal += 2 * (6 * 255 + 2);
    } else if (step.operation === "apply_character_style") {
      metadata.start = p.start; metadata.end = p.end; metadata.styleName = p.styleName;
      metadata.style = fromApply ? p.expectedStyle : p.style;
      // A partial inverse can mix prior and applied style names on individual characters.
      var longest = snapshotJsonBytes(p.styleName), states = [before, after];
      for (var st = 0; st < states.length; st++) for (var n = 0; n < states[st].appliedCharacterStyles.length; n++) longest = Math.max(longest, snapshotJsonBytes(states[st].appliedCharacterStyles[n]));
      terminal = 0;
      for (var t = 0; t < states.length; t++) {
        var envelope = snapshotJsonBytes(states[t]);
        for (var j = 0; j < states[t].appliedCharacterStyles.length; j++) envelope += longest - snapshotJsonBytes(states[t].appliedCharacterStyles[j]);
        terminal = Math.max(terminal, envelope);
      }
    }
    pair.terminalBytes = terminal;
    pairs.push(pair);
  }
  return pairs;
}

`;
const count = new Function('SNAPSHOT_RESULT_FIXED_BYTES', 'SNAPSHOT_RESULT_MAX_LINES', COUNTERS
    + '\nreturn { json: snapshotJsonBytes, result: snapshotResultBytes, mixed: mixedSnapshotResultPairs };')(FIXED_BYTES, AREA_TEXT_MAX_LINES);
export const snapshotJsonBytes = count.json;
export const snapshotResultBytes = count.result;
export const mixedSnapshotResultPairs = count.mixed;
export function assertSnapshotResultFits(documentKey, pairs, layoutUnits) {
    const bytes = snapshotResultBytes(documentKey, pairs, layoutUnits);
    if (bytes > SNAPSHOT_RESULT_ADMISSION_BYTES) {
        throw new Error(`result_too_large: estimated ${bytes} UTF-8 bytes; limit ${SNAPSHOT_RESULT_ADMISSION_BYTES}. Choose a smaller request with the user, then create a new plan.`);
    }
}
export const SNAPSHOT_RESULT_SIZE_SCRIPT = `
var SNAPSHOT_RESULT_FIXED_BYTES = ${FIXED_BYTES};
var SNAPSHOT_RESULT_MAX_LINES = ${AREA_TEXT_MAX_LINES};
var SNAPSHOT_RESULT_ADMISSION_BYTES = ${SNAPSHOT_RESULT_ADMISSION_BYTES};
${COUNTERS}
function snapshotResultAdmitPlan(plan, pairs, layoutUnits) {
  var bytes = snapshotResultBytes(plan.documentKey, pairs, layoutUnits);
  if (bytes > SNAPSHOT_RESULT_ADMISSION_BYTES) {
    plan.applyBlockedReasonCodes.push("result_too_large");
    plan.applyAllowed = false;
    if (params.apply === true) throw new Error("result_too_large: estimated " + bytes + " UTF-8 bytes; limit " + SNAPSHOT_RESULT_ADMISSION_BYTES + ". Choose a smaller request with the user, then create a new plan.");
  }
  return plan;
}
`;
