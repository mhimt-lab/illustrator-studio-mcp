import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema } from '../mutation-result-schema-core.js';
import { canonicalDigest, operationSafetyPolicyToMcpAnnotations } from '../operation-safety-policy-core.js';
import { SUPPORTED_PATH_ITEM_MAX_PATH_POINTS, SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS } from './supported-path-item-host-script.js';
import { artboardSafetyAsserter, artboardSafetyRegistration, artboardTransactionSchema, classifyArtboardTerminal } from './artboard-update-safety.js';
export const UPDATE_ARTBOARD_OPERATION = 'update_artboard';
export const UPDATE_ARTBOARD_VALIDATOR = { kind: UPDATE_ARTBOARD_OPERATION, version: 1 };
export const ARTBOARD_MAX_COUNT = 256;
export const ARTBOARD_MAX_ITEMS = SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS;
export const ARTBOARD_MAX_POINTS = SUPPORTED_PATH_ITEM_MAX_PATH_POINTS;
const keySchema = z.string().min(1).max(16_384);
const coordinate = z.number().finite().min(-32_768).max(32_768);
const pair = z.tuple([coordinate, coordinate]);
const rect = z.tuple([coordinate, coordinate, coordinate, coordinate]).superRefine((r, ctx) => { if (r[0] >= r[2] || r[1] <= r[3])
    ctx.addIssue({ code: 'custom', message: 'Rect must have positive width and height.' }); });
const integerRect = rect.superRefine((r, ctx) => { if (!r.every(Number.isInteger))
    ctx.addIssue({ code: 'custom', message: 'Only integer-point rects are supported.' }); });
const nameSchema = z.string().min(1).max(255).superRefine((v, ctx) => { if (v !== v.trim() || /[\u0000-\u001f\u007f]/u.test(v))
    ctx.addIssue({ code: 'custom', message: 'Names must not be padded or contain control characters.' }); });
const boardSchema = z.strictObject({ index: z.number().int().nonnegative(), name: z.string().max(1024), rect: integerRect, rulerOrigin: pair });
const pointSchema = z.strictObject({ anchor: pair, left: pair, right: pair });
const artworkSchema = z.strictObject({ uuid: z.string().min(1).max(256), bounds: z.tuple([coordinate, coordinate, coordinate, coordinate]), closed: z.boolean(), points: z.array(pointSchema).min(1).max(ARTBOARD_MAX_POINTS) });
export const artboardSnapshotSchema = z.strictObject({
    boards: z.array(boardSchema).min(1).max(ARTBOARD_MAX_COUNT), active: z.number().int().nonnegative(),
    rulerOrigin: pair, rulerUnits: z.string().min(1).max(128), colorSpace: z.literal('RGB'),
    artwork: z.array(artworkSchema).max(ARTBOARD_MAX_ITEMS),
}).superRefine((s, ctx) => {
    if (s.active >= s.boards.length || s.boards.some((b, i) => b.index !== i))
        ctx.addIssue({ code: 'custom', message: 'The full ordered collection must bind its ordinal and active index.' });
    if (![...s.rulerOrigin, ...s.boards.flatMap((b) => b.rulerOrigin)].every(Number.isInteger))
        ctx.addIssue({ code: 'custom', message: 'Fractional ruler origins are unsupported.' });
    if (new Set(s.artwork.map((a) => a.uuid)).size !== s.artwork.length || s.artwork.reduce((n, a) => n + a.points.length, 0) > ARTBOARD_MAX_POINTS)
        ctx.addIssue({ code: 'custom', message: 'Artwork must have unique native UUIDs and a complete bounded point collection.' });
});
export const artboardChangeSchema = z.union([
    z.strictObject({ name: nameSchema }), z.strictObject({ rect: integerRect }),
    z.strictObject({ active: z.literal(true) }), z.strictObject({ add: z.strictObject({ name: nameSchema, rect: integerRect }) }),
]);
const same = (a, b) => canonicalSha256(a) === canonicalSha256(b);
const implicitOrigin = (rect) => [0 - rect[0], 0 - rect[3]];
export function artboardOriginIsImplicit(s) {
    return s.boards.every((b) => b.rulerOrigin[0] === 0 && b.rulerOrigin[1] === 0) && same(s.rulerOrigin, implicitOrigin(s.boards[s.active].rect));
}
export function artboardOriginBlocked(before, index, change) {
    return ('add' in change || ('active' in change && index !== before.active)) && !artboardOriginIsImplicit(before);
}
export function deriveArtboardAfter(before, index, change) {
    if ('add' in change) {
        if (index !== before.boards.length)
            throw new Error('An added artboard must use the next ordinal.');
        if (before.boards.length >= ARTBOARD_MAX_COUNT)
            throw new Error('Complete artboard collection exceeds the supported limit.');
        return { ...before, boards: [...before.boards, { index, name: change.add.name, rect: change.add.rect, rulerOrigin: [0, 0] }], active: index, rulerOrigin: implicitOrigin(change.add.rect) };
    }
    if (!Number.isInteger(index) || index < 0 || index >= before.boards.length)
        throw new Error('Artboard index is outside the complete collection.');
    if ('active' in change)
        return index === before.active ? before : { ...before, active: index, rulerOrigin: implicitOrigin(before.boards[index].rect) };
    if ('rect' in change && index === before.active)
        throw new Error('Updating the active artboard rect is unsupported.');
    return { ...before, boards: before.boards.map((b, i) => i === index ? { ...b, ...change } : b) };
}
const common = { expectedDocumentKey: keySchema, artboardIndex: z.number().int().min(0).max(ARTBOARD_MAX_COUNT - 1), change: artboardChangeSchema };
const internalSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...common, apply: z.literal(false) }),
    z.strictObject({ ...common, apply: z.literal(true), expectedBefore: artboardSnapshotSchema, confirmedAfter: artboardSnapshotSchema, commandId: canonicalCommandIdSchema }),
]);
const publicCommon = { expected_document_key: keySchema, artboard_index: common.artboardIndex, change: artboardChangeSchema };
export const updateArtboardPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...publicCommon, apply: z.literal(false).default(false) }),
    z.strictObject({ ...publicCommon, apply: z.literal(true), expected_before: artboardSnapshotSchema, confirmed_after: artboardSnapshotSchema, command_id: applyCommandIdSchema }),
]);
const inputSchema = z.strictObject({ ...publicCommon, apply: z.boolean().default(false), expected_before: artboardSnapshotSchema.optional(), confirmed_after: artboardSnapshotSchema.optional(), command_id: applyCommandIdSchema.optional() });
const { $schema: _schemaDialect, ...publishedSchema } = z.toJSONSchema(updateArtboardPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedSchema });
function normalizePublicInput(input) {
    const v = updateArtboardPublicInputSchema.parse(input);
    const base = { expectedDocumentKey: v.expected_document_key, artboardIndex: v.artboard_index, change: v.change };
    return v.apply ? { ...base, apply: true, expectedBefore: v.expected_before, confirmedAfter: v.confirmed_after, commandId: v.command_id } : { ...base, apply: false };
}
const blockerSchema = z.enum(['saved_rgb_profile_required', 'unmeasured_app_version', 'unmeasured_ruler_origin']);
const planSchema = z.strictObject({
    operation: z.literal(UPDATE_ARTBOARD_OPERATION), profile: z.literal('integer_pt_v1'), documentKey: keySchema, documentBefore: documentContextSchema,
    artboardIndex: common.artboardIndex, change: artboardChangeSchema, before: artboardSnapshotSchema, after: artboardSnapshotSchema,
    changesState: z.boolean(), applyBlockedReasonCodes: z.array(blockerSchema), confirmationStatus: z.enum(['required', 'confirmed']), applyAllowed: z.boolean(),
}).superRefine((p, ctx) => {
    if (p.documentKey !== p.documentBefore.key || p.documentBefore.artboardCount !== p.before.boards.length || p.documentBefore.activeArtboardIndex !== p.before.active || !same(p.documentBefore.activeArtboardBounds, p.before.boards[p.before.active]?.rect))
        ctx.addIssue({ code: 'custom', message: 'Plan must bind the native document context to its before collection.' });
    try {
        if (!same(deriveArtboardAfter(p.before, p.artboardIndex, p.change), p.after))
            throw new Error();
    }
    catch {
        ctx.addIssue({ code: 'custom', message: 'Artboard after must be derived from the full before and the supported change.' });
    }
    if (p.changesState === same(p.before, p.after) || p.applyAllowed !== (p.confirmationStatus === 'confirmed' && p.applyBlockedReasonCodes.length === 0))
        ctx.addIssue({ code: 'custom', message: 'Invalid change or admission flags.' });
});
const transactionSchema = artboardTransactionSchema('update_artboard', { restoredSnapshot: artboardSnapshotSchema.nullable() }, { restoredSnapshot: null }, (v) => v.restoredSnapshot !== null);
export const updateArtboardResultSchema = z.union([
    z.strictObject({ operation: z.literal(UPDATE_ARTBOARD_OPERATION), applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ operation: z.literal(UPDATE_ARTBOARD_OPERATION), applied: z.literal(true), document: documentContextSchema, plan: planSchema, postcondition: artboardSnapshotSchema, transaction: transactionSchema }),
]).superRefine((r, ctx) => {
    const planned = r.transaction.state === 'planned';
    const baseline = r.plan.documentBefore;
    if (r.document.path !== baseline.path || r.document.fileRevision !== baseline.fileRevision || r.document.name !== baseline.name || r.document.appVersion !== baseline.appVersion || r.document.colorSpace !== baseline.colorSpace)
        ctx.addIssue({ code: 'custom', message: 'Result document must preserve the admitted file identity and profile.' });
    if (!planned && (baseline.mutationProfile !== 'saved_file' || !baseline.saved || baseline.colorSpace !== 'RGB' || baseline.appVersion !== '30.8.1'))
        ctx.addIssue({ code: 'custom', message: 'Applied artboard result requires the measured saved RGB profile.' });
    if (r.applied && (r.document.artboardCount !== r.postcondition.boards.length || r.document.activeArtboardIndex !== r.postcondition.active || !same(r.document.activeArtboardBounds, r.postcondition.boards[r.postcondition.active]?.rect)))
        ctx.addIssue({ code: 'custom', message: 'Result document context must agree with the native postcondition.' });
    if (r.plan.confirmationStatus !== (planned ? 'required' : 'confirmed') || (!planned && (!r.plan.applyAllowed || r.plan.applyBlockedReasonCodes.length !== 0)))
        ctx.addIssue({ code: 'custom', message: 'Transaction requires the exact confirmed, unblocked plan.' });
    if (planned) {
        const blockers = [];
        if (r.document.mutationProfile !== 'saved_file' || r.document.colorSpace !== 'RGB' || !r.document.saved)
            blockers.push('saved_rgb_profile_required');
        if (r.document.appVersion !== '30.8.1')
            blockers.push('unmeasured_app_version');
        if (artboardOriginBlocked(r.plan.before, r.plan.artboardIndex, r.plan.change))
            blockers.push('unmeasured_ruler_origin');
        if (!same(blockers, r.plan.applyBlockedReasonCodes) || r.document.key !== r.plan.documentKey)
            ctx.addIssue({ code: 'custom', message: 'Plan must expose exact profile blockers and document binding.' });
    }
    if (r.applied !== (r.transaction.state === 'verified') || (r.applied && !same(r.postcondition, r.plan.after)))
        ctx.addIssue({ code: 'custom', message: 'Verified result must match the complete planned after.' });
    if (r.transaction.state === 'rolled_back' && !same(r.transaction.rollback.restoredSnapshot, r.plan.before))
        ctx.addIssue({ code: 'custom', message: 'Recovery must prove the complete baseline.' });
});
const responseSchema = z.strictObject({ outcome: updateArtboardResultSchema, delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }) });
export const UPDATE_ARTBOARD_SAFETY = artboardSafetyRegistration(UPDATE_ARTBOARD_OPERATION);
export const UPDATE_ARTBOARD_SAFETY_IDENTITY = canonicalDigest(UPDATE_ARTBOARD_SAFETY);
const assertSafety = artboardSafetyAsserter(UPDATE_ARTBOARD_SAFETY, (value) => {
    const r = updateArtboardResultSchema.parse(value);
    return { operationId: UPDATE_ARTBOARD_OPERATION, documentKey: r.plan.documentKey,
        identityToken: `artboard-update-v1:${canonicalDigest({ index: r.plan.artboardIndex, before: r.plan.before })}`,
        beforeState: { path: r.plan.documentBefore.path, fileRevision: r.plan.documentBefore.fileRevision, snapshot: r.plan.before }, afterState: r.plan.after, changeSet: { index: r.plan.artboardIndex, change: r.plan.change, profile: r.plan.profile },
        blocked: r.plan.applyBlockedReasonCodes.length > 0, confirmationStatus: r.plan.confirmationStatus, applyAllowed: r.plan.applyAllowed,
        transactionState: r.transaction.state, applied: r.applied };
});
export const UPDATE_ARTBOARD_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
function abFail(message) { throw mutationError("preflight_failed", message); }
function abSame(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if ((a instanceof Array) !== (b instanceof Array)) return false;
  var k, count = 0, other = 0;
  for (k in a) if (a.hasOwnProperty(k)) { count++; if (!b.hasOwnProperty(k) || !abSame(a[k], b[k])) return false; }
  for (k in b) if (b.hasOwnProperty(k)) other++;
  return count === other;
}
function abNumbers(value, length, integer) {
  if (!value || value.length !== length) abFail("Artboard geometry is unavailable.");
  var out = [];
  for (var i = 0; i < length; i++) {
    var v = mutationFiniteNumber(value[i], "coordinate");
    if (Math.abs(v) > 32768 || (integer && v % 1 !== 0)) abFail("Geometry is outside the integer-point artboard profile.");
    out.push(v);
  }
  return out;
}
function abSnapshot(doc) {
  if (doc.documentColorSpace !== DocumentColorSpace.RGB) abFail("Only RGB documents are supported.");
  if (doc.artboards.length < 1 || doc.artboards.length > ${ARTBOARD_MAX_COUNT}) abFail("Complete artboard collection exceeds the supported limit.");
  var boards = [], items = [], uuids = {}, totalPoints = 0;
  for (var i = 0; i < doc.artboards.length; i++) {
    var board = doc.artboards[i], rect = abNumbers(board.artboardRect, 4, true), name = String(board.name);
    if (rect[0] >= rect[2] || rect[1] <= rect[3] || name.length > 1024) abFail("Unsupported artboard state.");
    boards.push({ index: i, name: name, rect: rect, rulerOrigin: abNumbers(board.rulerOrigin, 2, true) });
  }
  if (doc.pageItems.length > ${ARTBOARD_MAX_ITEMS}) abFail("Complete artwork collection exceeds the supported limit.");
  for (var j = 0; j < doc.pageItems.length; j++) {
    var item = doc.pageItems[j];
    if (item.typename !== "PathItem" || !item.parent || item.parent.typename !== "Layer" || item.clipping || item.guides) abFail("Only direct ordinary PathItems are supported by this artboard slice.");
    var uuid = item.uuid;
    if (typeof uuid !== "string" || uuid.length < 1 || uuid.length > 256 || uuids["u:" + uuid]) abFail("Complete native artwork identity is unavailable.");
    uuids["u:" + uuid] = true;
    if (item.pathPoints.length < 1) abFail("Empty path is unsupported.");
    totalPoints += item.pathPoints.length;
    if (totalPoints > ${ARTBOARD_MAX_POINTS}) abFail("Complete artwork point collection exceeds the supported limit.");
    var points = [];
    for (var k = 0; k < item.pathPoints.length; k++) {
      var point = item.pathPoints[k];
      points.push({ anchor: abNumbers(point.anchor, 2, false), left: abNumbers(point.leftDirection, 2, false), right: abNumbers(point.rightDirection, 2, false) });
    }
    if (typeof item.closed !== "boolean") abFail("Path closed state is unavailable.");
    items.push({ uuid: uuid, bounds: abNumbers(item.geometricBounds, 4, false), closed: item.closed, points: points });
  }
  var active = doc.artboards.getActiveArtboardIndex();
  if (typeof active !== "number" || active % 1 !== 0 || active < 0 || active >= boards.length) abFail("Active artboard is unavailable.");
  return { boards: boards, active: active, rulerOrigin: abNumbers(doc.rulerOrigin, 2, true), rulerUnits: String(doc.rulerUnits), colorSpace: "RGB", artwork: items };
}
function abName(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 255 || /^\\s|\\s$|[\\x00-\\x1f\\x7f]/.test(value)) abFail("Unsupported artboard name.");
  return value;
}
function abPositiveRect(value) {
  var rect = abNumbers(value, 4, true);
  if (rect[0] >= rect[2] || rect[1] <= rect[3]) abFail("Rect must have positive width and height.");
  return rect;
}
function abKeys(value) { var n = 0, key; for (key in value) if (value.hasOwnProperty(key)) n++; return n; }
function abImplicitOrigin(rect) { return [0 - rect[0], 0 - rect[3]]; }
function abOriginImplicit(s) {
  for (var i = 0; i < s.boards.length; i++) if (s.boards[i].rulerOrigin[0] !== 0 || s.boards[i].rulerOrigin[1] !== 0) return false;
  return abSame(s.rulerOrigin, abImplicitOrigin(s.boards[s.active].rect));
}
function abIsAdd() { return params.change.add !== undefined; }
function abIsActive() { return params.change.active !== undefined; }
function abDerive(before) {
  var index = params.artboardIndex, change = params.change;
  if (typeof index !== "number" || index % 1 !== 0 || index < 0) abFail("Artboard index is outside the complete collection.");
  if (!change || typeof change !== "object" || change instanceof Array) abFail("Artboard change is required.");
  if (abKeys(change) !== 1) abFail("Change must contain exactly one name, rect, active or add.");
  var boards = [], i;
  for (i = 0; i < before.boards.length; i++) boards.push({ index: i, name: before.boards[i].name, rect: before.boards[i].rect, rulerOrigin: before.boards[i].rulerOrigin });
  var after = { boards: boards, active: before.active, rulerOrigin: before.rulerOrigin, rulerUnits: before.rulerUnits, colorSpace: before.colorSpace, artwork: before.artwork };
  if (change.add !== undefined) {
    var add = change.add;
    if (!add || typeof add !== "object" || add instanceof Array || abKeys(add) !== 2 || add.name === undefined || add.rect === undefined) abFail("add requires exactly name and rect.");
    if (index !== before.boards.length) abFail("An added artboard must use the next ordinal.");
    if (before.boards.length >= ${ARTBOARD_MAX_COUNT}) abFail("Complete artboard collection exceeds the supported limit.");
    var addRect = abPositiveRect(add.rect);
    boards.push({ index: index, name: abName(add.name), rect: addRect, rulerOrigin: [0, 0] });
    after.active = index;
    after.rulerOrigin = abImplicitOrigin(addRect);
    return after;
  }
  if (index >= before.boards.length) abFail("Artboard index is outside the complete collection.");
  if (change.active !== undefined) {
    if (change.active !== true) abFail("active must be true.");
    if (index !== before.active) { after.active = index; after.rulerOrigin = abImplicitOrigin(before.boards[index].rect); }
    return after;
  }
  if (change.name !== undefined) boards[index].name = abName(change.name);
  else if (change.rect !== undefined) {
    var rect = abPositiveRect(change.rect);
    if (index === before.active) abFail("Updating the active artboard rect is unsupported.");
    boards[index].rect = rect;
  } else abFail("Change must contain exactly one name, rect, active or add.");
  return after;
}
function abResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var doc = app.activeDocument, before = abSnapshot(doc), after = abDerive(before), blockers = [];
  if (context.mutationProfile !== "saved_file" || context.colorSpace !== "RGB" || !context.saved) blockers.push("saved_rgb_profile_required");
  if (context.appVersion !== "30.8.1") blockers.push("unmeasured_app_version");
  // The predicted origin of add and a real active switch is measured only from the implicit origin state.
  if ((abIsAdd() || (abIsActive() && params.artboardIndex !== before.active)) && !abOriginImplicit(before)) blockers.push("unmeasured_ruler_origin");
  if (forApply) {
    if (!abSame(before, params.expectedBefore)) abFail("expected_before does not match the complete artboard and artwork state.");
    if (!abSame(after, params.confirmedAfter)) abFail("confirmed_after does not match the derived plan.");
    if (blockers.length > 0) abFail("Artboard profile is unsupported.");
  }
  var target = params.artboardIndex < doc.artboards.length ? doc.artboards[params.artboardIndex] : null;
  return { context: context, document: doc, target: target, added: null, before: before, after: after, blockers: blockers };
}
function abPlan(p) { return { operation: "update_artboard", profile: "integer_pt_v1", documentKey: p.context.key, documentBefore: p.context, artboardIndex: params.artboardIndex,
  change: params.change, before: p.before, after: p.after, changesState: !abSame(p.before, p.after), applyBlockedReasonCodes: p.blockers,
  confirmationStatus: params.apply === true ? "confirmed" : "required", applyAllowed: params.apply === true && p.blockers.length === 0 }; }
function abRevalidate(p) {
  try {
    var current = abResolve(true);
    if (current.document !== p.document || current.target !== p.target || !abSame(current.before, p.before)) abFail("Artboard identity changed before apply.");
  } catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Artboard state changed before apply.")); }
}
function abWrite(target, snapshot) {
  if (params.change.name !== undefined) target.name = snapshot.boards[params.artboardIndex].name;
  else target.artboardRect = snapshot.boards[params.artboardIndex].rect;
}
function abApply(p, plan, state) {
  if (!plan.changesState) return;
  state.operationState.mutationStarted = true;
  var index = params.artboardIndex;
  if (abIsAdd()) {
    // The reference returned by add in this call is the only identity of the self-created board.
    p.added = p.document.artboards.add(plan.after.boards[index].rect);
    p.added.name = plan.after.boards[index].name;
  } else if (abIsActive()) p.document.artboards.setActiveArtboardIndex(index);
  else abWrite(p.target, plan.after);
}
function abReadCurrent(p) {
  if (app.documents.length === 0 || app.activeDocument !== p.document) abFail("Artboard document reference changed.");
  if (!abIsAdd() && p.document.artboards[params.artboardIndex] !== p.target) abFail("Artboard target reference changed.");
  var currentContext = getDocumentContext();
  if (currentContext.path !== p.context.path || currentContext.fileRevision !== p.context.fileRevision || currentContext.name !== p.context.name || currentContext.appVersion !== p.context.appVersion) abFail("Artboard file identity changed after apply.");
  return abSnapshot(p.document);
}
function abOwnsAdded(p) {
  var n = p.before.boards.length;
  return p.added !== null && p.document.artboards.length === n + 1 && p.document.artboards[n] === p.added;
}
function abVerify(p, plan) {
  var after = abReadCurrent(p);
  if (abIsAdd() && !abOwnsAdded(p)) throw mutationError("verify_mismatch", "The added artboard is not the self-created board.");
  if (!abSame(after, plan.after)) throw mutationError("verify_mismatch", "Artboard or artwork read-back differs from the complete planned after.");
  return after;
}
function abRollback(state) {
  var p = state.preflight;
  try {
    var current = abReadCurrent(p);
    // A no-effect write needs no inverse. Otherwise require the EXACT captured after, never a name/ordinal alone.
    if (!abSame(current, p.before)) {
      if (abIsAdd()) {
        // Remove only the board this call created, and only when everything else is still the baseline.
        var n = p.before.boards.length, kept = current.boards.slice(0, n);
        if (!abOwnsAdded(p) || !abSame(kept, p.before.boards) || !abSame(current.artwork, p.before.artwork)) return { status: "indeterminate", message: "Artboard recovery refused because the self-created board or baseline is not proven." };
        p.added.remove();
        // Removing the board does not restore active or the document origin; restore active explicitly.
        p.document.artboards.setActiveArtboardIndex(p.before.active);
      } else {
        if (!abSame(current, p.after)) return { status: "indeterminate", message: "Artboard recovery refused because the full after identity differs." };
        if (abIsActive()) p.document.artboards.setActiveArtboardIndex(p.before.active);
        else abWrite(p.target, p.before);
      }
    }
    var restored = abReadCurrent(p);
    state.operationState.rollbackEvidence.restoredSnapshot = restored;
    if (!abSame(restored, p.before)) return { status: "indeterminate", message: "Artboard recovery did not restore the full baseline." };
    return { status: "verified" };
  } catch (error) { return { status: "indeterminate", message: "Artboard recovery could not prove the full baseline." }; }
}
var abExecution = runMutationTransaction({
  apply: params.apply === true,
  initialOperationState: function () { return { mutationStarted: false, rollbackEvidence: { restoredSnapshot: null } }; },
  preflight: abResolve, plan: abPlan, revalidate: abRevalidate, applyMutation: abApply, verify: abVerify, rollback: abRollback,
  hasMutationEvidence: function (s) { return s.operationState.mutationStarted === true; },
  applyIndeterminate: function () { return { reasonCode: "artboard_state_unknown", message: "Artboard apply outcome is indeterminate.", evidence: { restoredSnapshot: null } }; },
  rollbackEvidence: function (s) { return s.operationState.rollbackEvidence; }
});
var result = { operation: "update_artboard", applied: abExecution.transaction.state === "verified", document: getDocumentContext(), plan: abExecution.plan, transaction: abExecution.transaction };
if (result.applied) result.postcondition = abExecution.value;
`;
export const UPDATE_ARTBOARD_HOST_SCRIPT_DIGEST = canonicalSha256(UPDATE_ARTBOARD_SCRIPT);
export const UPDATE_ARTBOARD_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: UPDATE_ARTBOARD_OPERATION, validator: UPDATE_ARTBOARD_VALIDATOR,
    canonicalContractVersion: 1, resultSchemaVersion: 1, terminalClassifierVersion: 1, safetyConformanceVersion: 1, errorMappingVersion: 1,
    safetyIdentity: UPDATE_ARTBOARD_SAFETY_IDENTITY, hostScriptDigest: UPDATE_ARTBOARD_HOST_SCRIPT_DIGEST, mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalSchema.parse(input);
    const { commandId: _commandId, ...bound } = request;
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: request.apply ? request.commandId : null, documentKey: request.expectedDocumentKey,
        digest: canonicalSha256({ operation: UPDATE_ARTBOARD_OPERATION, validator: UPDATE_ARTBOARD_VALIDATOR, request: bound }) };
}
export const updateArtboardToolContract = {
    name: 'illustrator_update_artboard', title: 'Plan or Update Artboards',
    description: 'Plan then apply one artboard change: rename, integer-point rect of an inactive board, make a board active ({active:true}), or append a named integer-point board ({add:{name,rect}}, artboard_index = current board count). Apply echoes the complete plan.before as expected_before and plan.after as confirmed_after. plan.after predicts active and the document ruler origin: add makes the new board active, and add or an active switch sets the origin to [-left,-bottom] of the active board; this is admitted only when every board origin is [0,0] and the document origin already follows that rule, otherwise the plan is blocked with unmeasured_ruler_origin. There is no way to remove an added artboard with this server; deletion is a destructive operation left to a separate design. Duplicate names are allowed; the full ordered collection, active index, ruler origins and native artwork geometry establish identity. Requires a saved RGB document, Illustrator 30.8.1 and unlocked foreground for apply. Only direct ordinary paths (128 items, 256 total points) and up to 256 integer artboards are admitted; fractional origins, edit sessions, active-board rect updates and Web pixel profiles are unsupported. Plans never change origins or artwork. Any unproven postcondition/recovery remains indeterminate. Use the returned document key after apply: rename, rect and add leave the document unsaved, so save before the next change; an active switch keeps a saved document saved and its key unchanged (measured on 30.8.1).',
    inputSchema, publicInputSchema: updateArtboardPublicInputSchema, outputSchema: responseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(UPDATE_ARTBOARD_SAFETY.policy), normalizePublicInput,
};
export function createUpdateArtboardAdapter() {
    return {
        version: 1, operation: UPDATE_ARTBOARD_OPERATION, validator: UPDATE_ARTBOARD_VALIDATOR,
        safety: UPDATE_ARTBOARD_SAFETY, safetyRegistrationIdentity: UPDATE_ARTBOARD_SAFETY_IDENTITY, adapterIdentity: UPDATE_ARTBOARD_ADAPTER_IDENTITY,
        tool: updateArtboardToolContract, canonical: { version: 1, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: updateArtboardResultSchema, resultSchemaVersion: 1, terminalClassifierVersion: 1, safetyConformanceVersion: 1, errorMappingVersion: 1,
        hostScriptDigest: UPDATE_ARTBOARD_HOST_SCRIPT_DIGEST, mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const n = normalizedRequest(input), { commandId: _commandId, ...params } = n.request;
            if (n.intent === 'plan')
                return { kind: 'read', script: UPDATE_ARTBOARD_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: UPDATE_ARTBOARD_VALIDATOR, idempotency: { commandId: n.commandId, operation: UPDATE_ARTBOARD_OPERATION, documentKey: n.documentKey, requestDigest: n.digest },
                adapterIdentity: UPDATE_ARTBOARD_ADAPTER_IDENTITY, mutationHostApplicationMode: 'foreground', script: UPDATE_ARTBOARD_SCRIPT, params };
        },
        classifyTerminal(value) { return classifyArtboardTerminal(updateArtboardResultSchema.parse(value).transaction.state, 'Artboard'); },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error) { return error instanceof Error ? error : new Error(String(error)); },
    };
}
