import { z } from 'zod';
import { canonicalSha256 } from '../mutation-canonical.js';
import { sameCanonical, TEXT_LAYOUT_MAX_CODE_UNITS, textLayoutCharacterSchema, textLayoutSnapshotSchemasFor, } from './text-layout-shared.js';
export const textLayoutRunSchema = textLayoutCharacterSchema.omit({ contents: true }).extend({
    length: z.number().int().positive().max(TEXT_LAYOUT_MAX_CODE_UNITS),
});
export function textLayoutRunSchemasFor(justifications, label) {
    const input = textLayoutSnapshotSchemasFor(justifications).input.omit({ characters: true }).extend({
        runs: z.array(textLayoutRunSchema).min(1).max(TEXT_LAYOUT_MAX_CODE_UNITS),
    });
    const snapshot = input.superRefine((wire, context) => {
        const point = wire.kind === 'TextType.POINTTEXT';
        if (point !== (wire.frameShape === 'point_text_unthreaded') || point !== (wire.fit === null) ||
            point !== (wire.frame.anchor !== null) || point === (wire.frame.geometricBounds !== null)) {
            context.addIssue({ code: 'custom', message: 'A text-layout snapshot must be consistently point text or area text.' });
        }
        if (wire.runs.reduce((total, run) => total + run.length, 0) !== wire.contents.length) {
            context.addIssue({ code: 'custom', message: `A ${label} snapshot must carry runs that cover exactly its contents.` });
            return;
        }
        if (!sameCanonical(encodeTextLayoutRuns(decodeTextLayoutRuns(wire)), wire)) {
            context.addIssue({ code: 'custom', message: `A ${label} snapshot must carry maximal runs.` });
        }
    });
    return { input, snapshot };
}
export function decodeTextLayoutRuns(wire) {
    const { runs, ...rest } = wire;
    const characters = [];
    for (const { length, ...attributes } of runs) {
        for (let count = 0; count < length; count++) {
            characters.push({ contents: wire.contents.charAt(characters.length), ...attributes });
        }
    }
    return { ...rest, characters };
}
export function encodeTextLayoutRuns(snapshot) {
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
export const TEXT_LAYOUT_RUNS_SCRIPT = `
function textLayoutRunsEncode(snapshot) {
  var wire = {};
  for (var key in snapshot) if (snapshot.hasOwnProperty(key) && key !== "characters") wire[key] = snapshot[key];
  var runs = [];
  var lastKey = null;
  for (var index = 0; index < snapshot.characters.length; index++) {
    var attributes = {};
    for (var field in snapshot.characters[index]) {
      if (snapshot.characters[index].hasOwnProperty(field) && field !== "contents") attributes[field] = snapshot.characters[index][field];
    }
    var attributeKey = textLayoutCanonicalJson(attributes);
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

function textLayoutRunsDecode(wire, name) {
  var full = {};
  for (var key in wire) if (wire.hasOwnProperty(key) && key !== "runs") full[key] = wire[key];
  full.characters = [];
  for (var runIndex = 0; runIndex < wire.runs.length; runIndex++) {
    var run = wire.runs[runIndex];
    for (var count = 0; count < run.length; count++) {
      var character = { contents: wire.contents.charAt(full.characters.length) };
      for (var field in run) if (run.hasOwnProperty(field) && field !== "length") character[field] = run[field];
      full.characters.push(character);
      if (full.characters.length > wire.contents.length) {
        throw mutationError("preflight_failed", name + " runs cover more than its contents.");
      }
    }
  }
  if (full.characters.length !== wire.contents.length) {
    throw mutationError("preflight_failed", name + " runs do not cover its contents.");
  }
  return full;
}

/** A plan with both snapshots in wire form; every other field is shared with the full plan. */
function textLayoutRunsPlan(plan) {
  var wire = {};
  for (var key in plan) if (plan.hasOwnProperty(key)) wire[key] = plan[key];
  wire.before = textLayoutRunsEncode(plan.before);
  wire.after = textLayoutRunsEncode(plan.after);
  return wire;
}
`;
