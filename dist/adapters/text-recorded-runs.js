import { z } from 'zod';
import { canonicalSha256 } from '../mutation-canonical.js';
import { POINT_TEXT_MAX_CODE_UNITS } from './point-text-host-script.js';
import { pointTextAlignedCharacterSchema } from './text-alignment-profile.js';
import { RECORDED_PROFILE_NAME } from './text-recorded-profile.js';
import { textResultBytes, textResultJsonBytes } from './text-result-size.js';
export const recordedRunSchema = pointTextAlignedCharacterSchema.omit({ contents: true }).extend({
    length: z.number().int().positive().max(POINT_TEXT_MAX_CODE_UNITS),
});
export function isRunsSnapshot(value) {
    return typeof value === 'object' && value !== null && Array.isArray(value.runs);
}
export function decodeRecordedRuns(snapshot) {
    if (!isRunsSnapshot(snapshot))
        return snapshot;
    const { runs, ...rest } = snapshot;
    const characters = [];
    for (const { length, ...attributes } of runs) {
        for (let count = 0; count < length; count += 1) {
            characters.push({ contents: rest.contents.charAt(characters.length), ...attributes });
        }
    }
    return { ...rest, characters };
}
export function encodeRecordedRuns(snapshot) {
    if (snapshot.profile !== RECORDED_PROFILE_NAME)
        return snapshot;
    const { characters, ...rest } = snapshot;
    const runs = [];
    let lastKey = '';
    for (const { contents: _contents, ...attributes } of characters) {
        const key = canonicalSha256(attributes);
        const last = runs[runs.length - 1];
        if (last !== undefined && key === lastKey)
            last.length += 1;
        else
            runs.push({ ...attributes, length: 1 });
        lastKey = key;
    }
    return { ...rest, runs };
}
export function snapshotUnitCount(snapshot) {
    if (snapshot.characters !== undefined)
        return snapshot.characters.length;
    return (snapshot.runs ?? []).reduce((total, run) => total + run.length, 0);
}
export function recordedRunsWireSchema(full, label) {
    const { characters: _characters, ...shape } = full.shape;
    const runs = z.strictObject({
        ...shape,
        profile: z.literal(RECORDED_PROFILE_NAME),
        runs: z.array(recordedRunSchema).min(1).max(POINT_TEXT_MAX_CODE_UNITS),
    }).superRefine((wire, context) => {
        const total = wire.runs.reduce((sum, run) => sum + run.length, 0);
        if (total !== wire.contents.length) {
            context.addIssue({ code: 'custom', message: `A ${label} snapshot must carry runs that cover exactly its contents.` });
            return;
        }
        const decoded = decodeRecordedRuns(wire);
        if (canonicalSha256(encodeRecordedRuns(decoded)) !== canonicalSha256(wire)) {
            context.addIssue({ code: 'custom', message: `A ${label} snapshot must carry maximal runs.` });
            return;
        }
        const checked = full.safeParse(decoded);
        if (!checked.success)
            for (const issue of checked.error.issues)
                context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    });
    const perCharacter = full.superRefine((snapshot, context) => {
        if (snapshot.profile === RECORDED_PROFILE_NAME) {
            context.addIssue({ code: 'custom', message: `A recorded-profile ${label} snapshot must carry runs, not characters.` });
        }
    });
    return z.union([perCharacter, runs]);
}
export function recordedRunsTextResultBytes(plan) {
    const before = plan.before, after = plan.after;
    if (!isRunsSnapshot(before) || !isRunsSnapshot(after) || before.profile !== RECORDED_PROFILE_NAME || after.profile !== RECORDED_PROFILE_NAME) {
        return textResultBytes(plan);
    }
    const wire = Math.max(textResultJsonBytes(before), textResultJsonBytes(after));
    const full = Math.max(textResultJsonBytes(decodeRecordedRuns(before)), textResultJsonBytes(decodeRecordedRuns(after)));
    return textResultBytes(plan) - wire + full;
}
export const TEXT_RECORDED_RUNS_SCRIPT = String.raw `
function styleRunsCanonical(value) {
  var parts = [], index, key, keys;
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return stringifyJson(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Object.prototype.toString.call(value) === "[object Array]") {
    for (index = 0; index < value.length; index++) parts.push(styleRunsCanonical(value[index]));
    return "[" + parts.join(",") + "]";
  }
  keys = [];
  for (key in value) if (value.hasOwnProperty(key)) keys.push(key);
  keys.sort();
  for (index = 0; index < keys.length; index++) parts.push(stringifyJson(keys[index]) + ":" + styleRunsCanonical(value[keys[index]]));
  return "{" + parts.join(",") + "}";
}

function styleRunsEncode(snapshot) {
  if (!snapshot || snapshot.profile !== STYLE_V3_PROFILE || !snapshot.characters) return snapshot;
  var wire = {}, key, runs = [], lastKey = null, index, field, attributes, attributeKey;
  for (key in snapshot) if (snapshot.hasOwnProperty(key) && key !== "characters") wire[key] = snapshot[key];
  for (index = 0; index < snapshot.characters.length; index++) {
    attributes = {};
    for (field in snapshot.characters[index]) {
      if (snapshot.characters[index].hasOwnProperty(field) && field !== "contents") attributes[field] = snapshot.characters[index][field];
    }
    attributeKey = styleRunsCanonical(attributes);
    if (runs.length > 0 && attributeKey === lastKey) {
      runs[runs.length - 1].length += 1;
    } else {
      attributes.length = 1;
      runs.push(attributes);
    }
    lastKey = attributeKey;
  }
  wire.runs = runs;
  return wire;
}

function styleRunsDecode(wire) {
  if (!wire || !wire.runs) return wire;
  var full = {}, key, runIndex, count, run, character, field;
  for (key in wire) if (wire.hasOwnProperty(key) && key !== "runs") full[key] = wire[key];
  full.characters = [];
  for (runIndex = 0; runIndex < wire.runs.length; runIndex++) {
    run = wire.runs[runIndex];
    for (count = 0; count < run.length; count++) {
      character = { contents: String(wire.contents).charAt(full.characters.length) };
      for (field in run) if (run.hasOwnProperty(field) && field !== "length") character[field] = run[field];
      full.characters.push(character);
      if (full.characters.length > String(wire.contents).length) {
        throw mutationError("preflight_failed", "A recorded snapshot's runs cover more than its contents.");
      }
    }
  }
  if (full.characters.length !== String(wire.contents).length) {
    throw mutationError("preflight_failed", "A recorded snapshot's runs do not cover its contents.");
  }
  return full;
}

/** A plan with both snapshots in wire form; every other field is shared with the full plan. */
function styleRunsPlan(plan) {
  var wire = {}, key;
  for (key in plan) if (plan.hasOwnProperty(key)) wire[key] = plan[key];
  wire.before = styleRunsEncode(plan.before);
  wire.after = styleRunsEncode(plan.after);
  return wire;
}
`;
