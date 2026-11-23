import { z } from 'zod';
import { canonicalSha256 } from '../mutation-canonical.js';
import { PUBLISHED_AS_KEY, PUBLISHED_DEPTH_KEY } from '../published-tool-schema.js';
import { characterStyleEntrySchema, TEXT_STYLE_MAX_NAME_LENGTH, TEXT_STYLE_RESOURCE_SCRIPT } from '../text-style-resources.js';
import { defineBatchStep } from './batch-step-contract.js';
import { APPLY_CHARACTER_STYLE_BATCH_NEXT_CALL } from './batch-step-next-call.js';
import { POINT_TEXT_CHARACTER_SCRIPT, POINT_TEXT_SNAPSHOT_SCRIPT, pointTextApplyBlockers } from './point-text-host-script.js';
import { SUPPORTED_PATH_ITEM_HOST_SCRIPT } from './supported-path-item-host-script.js';
import { APPLY_CHARACTER_STYLE_MODULE_SCRIPT, APPLY_CHARACTER_STYLE_OPERATION, applyCharacterStylePlanSchema, characterStyleSnapshotSchema, } from './apply-character-style-adapter.js';
import { validateClusterRange } from './point-text-cluster.js';
export const BATCH_CHARSTYLE_OPERATION = APPLY_CHARACTER_STYLE_OPERATION;
export const BATCH_CHARSTYLE_STEP_COUNT = 2;
export const BATCH_CHARSTYLE_FONT = 'KozGoPr6N-Regular';
export const BATCH_CHARSTYLE_MAX_CHARACTERS = 64;
export const BATCH_CHARSTYLE_MAX_DOCUMENT_STYLES = 3;
export const BATCH_CHARSTYLE_RESULT_BUDGET_BYTES = 150_000;
const styleNameSchema = z.string().min(1).max(TEXT_STYLE_MAX_NAME_LENGTH);
const rangeBound = z.number().int().safe().nonnegative();
const stepShape = { operation: z.literal(BATCH_CHARSTYLE_OPERATION), start: rangeBound, end: rangeBound };
export const internalCharStyleStepShape = { ...stepShape, styleName: styleNameSchema };
export const publicCharStyleStepShape = { ...stepShape, style_name: styleNameSchema };
const echoedSnapshotSchema = z.union([characterStyleSnapshotSchema]).meta({ [PUBLISHED_DEPTH_KEY]: 0 });
const echoedStyleSchema = z.union([characterStyleEntrySchema]).meta({ [PUBLISHED_DEPTH_KEY]: 0 });
export const internalCharStyleApplyShape = {
    expectedBefore: echoedSnapshotSchema, expectedStyle: echoedStyleSchema, confirmedAfter: echoedSnapshotSchema,
};
export const publicCharStyleApplyShape = {
    expected_before: echoedSnapshotSchema, expected_style: echoedStyleSchema, confirmed_after: echoedSnapshotSchema,
};
export { echoedSnapshotSchema as batchCharStyleSnapshotSchema, echoedStyleSchema as batchCharStyleEntrySchema, styleNameSchema as batchCharStyleNameSchema };
const PUBLISHED_OBJECT = { type: 'object' };
export const batchCharStylePlanSchema = z.union([applyCharacterStylePlanSchema]).meta({ [PUBLISHED_AS_KEY]: PUBLISHED_OBJECT });
export const batchCharStyleEvidenceSchema = z.union([characterStyleSnapshotSchema]).meta({ [PUBLISHED_AS_KEY]: PUBLISHED_OBJECT });
export function measuredStyleShapeIssue(style) {
    for (const [attribute, reading] of Object.entries(style.attributes)) {
        const expectedDefined = attribute === 'size' || attribute === 'tracking' || attribute === 'fillColor' || attribute === 'strokeColor';
        if (reading.status !== (expectedDefined ? 'defined' : 'undefined'))
            return `A character-style batch measured a style that defines only size and tracking; ${attribute} differs.`;
        if ((attribute === 'fillColor' || attribute === 'strokeColor') && reading.status === 'defined' && reading.value !== 'none') {
            return `A character-style batch measured a style with no paint; ${attribute} is defined.`;
        }
    }
    return null;
}
const isBlack = (fill) => fill.model === 'rgb' && fill.red === 0 && fill.green === 0 && fill.blue === 0;
const canonical = (value) => canonicalSha256(value);
const jsonBytes = (value) => Buffer.byteLength(JSON.stringify(value));
function envelopeBytes(snapshot, styleName) {
    const names = snapshot.appliedCharacterStyles;
    const longest = Math.max(jsonBytes(styleName), ...names.map(jsonBytes));
    return jsonBytes(snapshot) - names.reduce((sum, name) => sum + jsonBytes(name), 0) + names.length * longest;
}
export function batchCharStyleResultBytes(plans) {
    let planBytes = 0;
    let evidenceBytes = 0;
    for (const plan of plans) {
        planBytes += jsonBytes(plan.before) + jsonBytes(plan.after) + jsonBytes(plan.style);
        evidenceBytes += Math.max(envelopeBytes(plan.before, plan.styleName), envelopeBytes(plan.after, plan.styleName));
    }
    return planBytes + evidenceBytes;
}
export function batchCharStylePlanIssue(plans) {
    if (plans.length !== BATCH_CHARSTYLE_STEP_COUNT)
        return `A character-style batch has exactly ${BATCH_CHARSTYLE_STEP_COUNT} steps.`;
    const first = plans[0];
    let characters = 0;
    for (const plan of plans) {
        if (plan.defaultStyleFill !== null)
            return 'A character-style batch supports black RGB text only, not a default-style fill basis.';
        if (plan.before.layerPath.length !== 1)
            return 'A character-style batch supports root-layer targets only.';
        const styleIssue = measuredStyleShapeIssue(plan.style);
        if (styleIssue !== null)
            return styleIssue;
        if (plan.before.characters.some((character) => character.font.postScriptName !== BATCH_CHARSTYLE_FONT)) {
            return `A character-style batch measured ${BATCH_CHARSTYLE_FONT} text only.`;
        }
        if (plan.before.characters.some((character) => !isBlack(character.fillColor))) {
            return 'A character-style batch measured rgb(0,0,0) text only, in the whole frame.';
        }
        if (plan.styleName !== first.styleName || canonical(plan.style) !== canonical(first.style)) {
            return 'Character-style batch steps must use one named character style with one resource definition.';
        }
        const rejection = validateClusterRange(plan.before.contents, plan.start, plan.end);
        if (rejection !== null)
            return `A character-style batch range is unsupported: ${rejection.reason}.`;
        characters += plan.before.characters.length;
    }
    if (new Set(plans.map((plan) => plan.targetUuid)).size !== plans.length)
        return 'Character-style batch targets must be distinct.';
    if (characters > BATCH_CHARSTYLE_MAX_CHARACTERS) {
        return `A character-style batch targets at most ${BATCH_CHARSTYLE_MAX_CHARACTERS} characters in total.`;
    }
    if (batchCharStyleResultBytes(plans) > BATCH_CHARSTYLE_RESULT_BUDGET_BYTES) {
        return `A character-style batch result may carry at most ${BATCH_CHARSTYLE_RESULT_BUDGET_BYTES} bytes of snapshot evidence.`;
    }
    return null;
}
export const BATCH_CHARSTYLE_SCRIPT = `
var BATCH_CHARSTYLE_STEP_COUNT = ${BATCH_CHARSTYLE_STEP_COUNT};
var BATCH_CHARSTYLE_FONT = ${JSON.stringify(BATCH_CHARSTYLE_FONT)};
var BATCH_CHARSTYLE_MAX_CHARACTERS = ${BATCH_CHARSTYLE_MAX_CHARACTERS};
var BATCH_CHARSTYLE_MAX_DOCUMENT_STYLES = ${BATCH_CHARSTYLE_MAX_DOCUMENT_STYLES};
var BATCH_CHARSTYLE_RESULT_BUDGET_BYTES = ${BATCH_CHARSTYLE_RESULT_BUDGET_BYTES};

/** The F0 fixture structure: RGB, one root layer without sub-layers, one artboard, and nothing but the two target frames. */
function batchCharStyleProfile(document, context) {
  if (context.colorSpace !== "RGB" || document.documentColorSpace !== DocumentColorSpace.RGB) {
    throw mutationError("preflight_failed", "Character-style batch supports RGB documents only.");
  }
  if (document.layers.length !== 1 || document.layers[0].layers.length !== 0 || document.artboards.length !== 1 ||
      document.pageItems.length !== BATCH_CHARSTYLE_STEP_COUNT) {
    throw mutationError("preflight_failed", "Character-style batch supports one root layer without sub-layers, one artboard and exactly the two target frames only.");
  }
  if (document.characterStyles.length > BATCH_CHARSTYLE_MAX_DOCUMENT_STYLES) {
    throw mutationError("preflight_failed", "Character-style batch supports at most " + BATCH_CHARSTYLE_MAX_DOCUMENT_STYLES + " character style resources.");
  }
}
function batchCharStyleResolve() {
  var resolved = charStyleResolve(false);
  if (resolved.defaultStyleFill !== null) {
    throw mutationError("preflight_failed", "Character-style batch supports black RGB text only.");
  }
  if (resolved.before.layerPath.length !== 1) {
    throw mutationError("preflight_failed", "Character-style batch supports root-layer targets only.");
  }
  for (var attribute in resolved.entry.attributes) {
    if (!resolved.entry.attributes.hasOwnProperty(attribute)) continue;
    var reading = resolved.entry.attributes[attribute];
    var paint = attribute === "fillColor" || attribute === "strokeColor";
    var expectedDefined = paint || attribute === "size" || attribute === "tracking";
    if (reading.status !== (expectedDefined ? "defined" : "undefined") || (paint && reading.value !== "none")) {
      throw mutationError("preflight_failed", "Character-style batch measured a style that defines only size and tracking and no paint; " + attribute + " differs.");
    }
  }
  for (var characterIndex = 0; characterIndex < resolved.before.characters.length; characterIndex++) {
    var character = resolved.before.characters[characterIndex];
    if (character.font.postScriptName !== BATCH_CHARSTYLE_FONT) {
      throw mutationError("preflight_failed", "Character-style batch measured " + BATCH_CHARSTYLE_FONT + " text only.");
    }
    // Every character of the frame, in the range or not: the F0 fixtures are black throughout.
    if (character.fillColor.model !== "rgb" || character.fillColor.red !== 0 || character.fillColor.green !== 0 || character.fillColor.blue !== 0) {
      throw mutationError("preflight_failed", "Character-style batch measured rgb(0,0,0) text only, in the whole frame.");
    }
  }
  return resolved;
}
/** The resource definition as the plan reported it, compared by value (never by reference). */
function batchCharStyleCheckExpected(plan, request) {
  if (!charStyleSame(plan.style, request.expectedStyle)) {
    throw mutationError("preflight_failed", "The named character style does not match expected_style.");
  }
}
function batchCharStyleRevalidate(current, original, plan) {
  if (!charStyleSame(current.plan.style, plan.style) ||
      stringifyJson(current.plan.defaultStyleFill) !== stringifyJson(plan.defaultStyleFill)) {
    throw mutationBeforeSideEffectError("Character-style resource or default fill changed before apply.");
  }
}
/**
 * After every attempted inverse: both frames are read again (the complete snapshot, applied style names included) and the style
 * resource is resolved again; all must equal the baseline the plan bound, whatever each step's own rollback reported.
 */
function batchCharStyleBaselineRestored(entries) {
  try {
    for (var index = 0; index < entries.length; index++) {
      var entry = entries[index];
      var request = entry.step.request;
      var restored = withStepParams(entry.step, function () {
        var snapshot = charStyleSnapshot(entry.resolved.document, entry.resolved.target, request.targetUuid);
        var resolved = textStyleResolveNamed(entry.resolved.document, "character", request.styleName);
        return charStyleSame(snapshot, entry.plan.before) && resolved.status === "resolved" && charStyleSame(resolved.entry, entry.plan.style);
      });
      if (!restored) return false;
    }
    return true;
  } catch (error) { return false; }
}
function batchCharStyleBytes(value) { return supportedPathUtf8ByteLength(stringifyJson(value)); }
/** The snapshot's size if every character reported the longest style name that can appear in it (see the TypeScript twin). */
function batchCharStyleEnvelope(snapshot, styleName) {
  var names = snapshot.appliedCharacterStyles;
  var longest = batchCharStyleBytes(styleName);
  var total = 0;
  for (var index = 0; index < names.length; index++) {
    var length = batchCharStyleBytes(names[index]);
    total += length;
    if (length > longest) longest = length;
  }
  return batchCharStyleBytes(snapshot) - total + names.length * longest;
}
/** Called once with every resolved step, before any write: one shared style definition, character and result budgets. */
function batchCharStyleCommon(entries) {
  if (entries.length !== BATCH_CHARSTYLE_STEP_COUNT) {
    throw mutationError("preflight_failed", "Character-style batch requires exactly " + BATCH_CHARSTYLE_STEP_COUNT + " steps.");
  }
  var first = entries[0];
  var characters = 0;
  var planBytes = 0;
  var evidenceBytes = 0;
  for (var index = 0; index < entries.length; index++) {
    var entry = entries[index];
    if (entry.step.request.styleName !== first.step.request.styleName || !charStyleSame(entry.plan.style, first.plan.style)) {
      var mismatch = mutationError("preflight_failed", "Character-style batch steps must use one named character style with one resource definition.");
      mismatch.charStyleStepIndex = index;
      throw mismatch;
    }
    characters += entry.plan.before.characters.length;
    planBytes += batchCharStyleBytes(entry.plan.before) + batchCharStyleBytes(entry.plan.after) + batchCharStyleBytes(entry.plan.style);
    evidenceBytes += Math.max(batchCharStyleEnvelope(entry.plan.before, entry.step.request.styleName),
      batchCharStyleEnvelope(entry.plan.after, entry.step.request.styleName));
  }
  if (characters > BATCH_CHARSTYLE_MAX_CHARACTERS) {
    throw mutationError("preflight_failed", "Character-style batch targets at most " + BATCH_CHARSTYLE_MAX_CHARACTERS + " characters in total.");
  }
  if (planBytes + evidenceBytes > BATCH_CHARSTYLE_RESULT_BUDGET_BYTES) {
    throw mutationError("preflight_failed", "Character-style batch result would exceed " + BATCH_CHARSTYLE_RESULT_BUDGET_BYTES + " bytes of snapshot evidence.");
  }
}
`;
const batchCharStyleUuidSchema = z.string().min(1).max(255);
const batchPublicCharStylePlan = z.strictObject({ target_uuid: batchCharStyleUuidSchema, ...publicCharStyleStepShape });
const batchInternalCharStylePlan = z.strictObject({ targetUuid: batchCharStyleUuidSchema, ...internalCharStyleStepShape });
export const applyCharacterStyleBatchStep = defineBatchStep({
    operation: BATCH_CHARSTYLE_OPERATION,
    admittedProfile: 'mixed_batch_character_style_two_frames_30_8_2',
    recipeAllowed: false,
    publicPlan: batchPublicCharStylePlan,
    publicApply: z.strictObject({ ...batchPublicCharStylePlan.shape, ...publicCharStyleApplyShape }),
    internalPlan: batchInternalCharStylePlan,
    internalApply: z.strictObject({ ...batchInternalCharStylePlan.shape, ...internalCharStyleApplyShape }),
    planSchema: batchCharStylePlanSchema,
    snapshotSchema: batchCharStyleEvidenceSchema,
    normalize: (step) => ({ operation: BATCH_CHARSTYLE_OPERATION, targetUuid: step.target_uuid,
        start: step.start, end: step.end, styleName: step.style_name,
        ...('expected_before' in step ? { expectedBefore: step.expected_before, expectedStyle: step.expected_style,
            confirmedAfter: step.confirmed_after } : {}) }),
    request: (plan) => ({ start: plan.start, end: plan.end, styleName: plan.styleName, style: plan.style }),
    same: (left, right) => canonicalSha256(left) === canonicalSha256(right),
    planBlockers: (mutationAllowed, plan) => pointTextApplyBlockers(mutationAllowed, plan.before),
    nextCall: APPLY_CHARACTER_STYLE_BATCH_NEXT_CALL,
    host: {
        fragments: [
            { id: 'point-text.snapshot', source: POINT_TEXT_SNAPSHOT_SCRIPT },
            { id: 'point-text.character', source: POINT_TEXT_CHARACTER_SCRIPT },
            { id: 'text-style.resource', source: TEXT_STYLE_RESOURCE_SCRIPT },
            { id: 'supported-path-item', source: SUPPORTED_PATH_ITEM_HOST_SCRIPT },
            { id: 'apply-character-style.module', source: APPLY_CHARACTER_STYLE_MODULE_SCRIPT },
            { id: 'batch-charstyle', source: BATCH_CHARSTYLE_SCRIPT },
        ],
        hooks: { resolve: 'batchCharStyleResolve', plan: 'charStylePlan', same: 'charStyleSame', apply: 'charStyleApply', verify: 'charStyleVerify',
            rollback: 'charStyleRollback', checkExpected: 'batchCharStyleCheckExpected', revalidate: 'batchCharStyleRevalidate' },
        paramFields: ['start', 'end', 'styleName'],
        dispatchLayout: `  apply_character_style: { resolve: batchCharStyleResolve, plan: charStylePlan, same: charStyleSame, apply: charStyleApply, verify: charStyleVerify,
    rollback: charStyleRollback, checkExpected: batchCharStyleCheckExpected, revalidate: batchCharStyleRevalidate }`,
    },
});
