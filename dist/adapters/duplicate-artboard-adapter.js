import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema } from '../mutation-result-schema-core.js';
import { canonicalDigest, operationSafetyPolicyToMcpAnnotations } from '../operation-safety-policy-core.js';
import { OBJECT_WALK_HELPERS, OBJECT_WITNESS_HELPERS, READ_PAGE_ITEM_AT_HELPER } from '../page-item-walk.js';
import { ARTBOARD_INTEGER_TOLERANCE, readIntegerWithinTolerance } from '../artboard-integer.js';
import { artboardSafetyAsserter, artboardSafetyRegistration, artboardTransactionSchema, classifyArtboardTerminal } from './artboard-update-safety.js';
import { ARTBOARD_ARTWORK_MAX_ITEMS, ARTBOARD_ARTWORK_SCAN_DEADLINE_MS, ARTBOARD_MAX_COUNT } from './update-artboard-adapter.js';
import { ARTBOARD_CONTENT_SIGNATURE_SCRIPT, ARTBOARD_COPY_GEOMETRY_TOLERANCE, ARTBOARD_COPY_MAX_NODES, ARTBOARD_COPY_MAX_ROOTS, ARTBOARD_COPY_TYPES, } from './artboard-content-signature.js';
export const DUPLICATE_ARTBOARD_OPERATION = 'duplicate_artboard';
export const DUPLICATE_ARTBOARD_VALIDATOR = { kind: DUPLICATE_ARTBOARD_OPERATION, version: 1 };
export { ARTBOARD_COPY_GEOMETRY_TOLERANCE as DUPLICATE_ARTBOARD_GEOMETRY_TOLERANCE };
const keySchema = z.string().min(1).max(16_384);
const coordinate = z.number().finite().min(-32_768).max(32_768);
const pair = z.tuple([coordinate, coordinate]);
const integerRect = z.tuple([coordinate, coordinate, coordinate, coordinate])
    .superRefine((r, ctx) => {
    if (r[0] >= r[2] || r[1] <= r[3])
        ctx.addIssue({ code: 'custom', message: 'Rect must have positive width and height.' });
    if (!r.every(Number.isInteger))
        ctx.addIssue({ code: 'custom', message: 'Only integer-point rects are supported.' });
});
const nameSchema = z.string().min(1).max(255).superRefine((v, ctx) => { if (v !== v.trim() || /[\u0000-\u001f\u007f]/u.test(v))
    ctx.addIssue({ code: 'custom', message: 'Names must not be padded or contain control characters.' }); });
const offsetSchema = z.tuple([z.number().int().min(-32_768).max(32_768), z.number().int().min(-32_768).max(32_768)])
    .superRefine((o, ctx) => { if (o[0] === 0 && o[1] === 0)
    ctx.addIssue({ code: 'custom', message: 'The offset must move the copy.' }); });
const hex24 = z.string().regex(/^[0-9a-f]{24}$/u);
const boardSchema = z.strictObject({
    index: z.number().int().nonnegative(), name: z.string().max(1024), rect: integerRect, rulerOrigin: pair,
    presentation: z.tuple([z.number().finite().min(0.1).max(10), z.boolean(), z.boolean(), z.boolean()]),
});
const rootSchema = z.strictObject({
    uuid: z.string().min(1).max(256), type: z.enum(ARTBOARD_COPY_TYPES), name: z.string().max(1024),
    layer: z.number().int().nonnegative().max(1023), order: z.number().int().nonnegative(), nodes: z.number().int().min(1).max(ARTBOARD_COPY_MAX_NODES), digest: hex24,
});
const blockedRootSchema = z.strictObject({ uuid: z.string().min(1).max(256), type: z.string().max(64), name: z.string().max(1024), reasons: z.array(z.string().min(1).max(160)).min(1).max(6) });
const obstacleSchema = z.strictObject({ uuid: z.string().min(1).max(256), type: z.string().max(64), name: z.string().max(1024) });
const artworkSchema = z.strictObject({
    count: z.number().int().nonnegative().max(ARTBOARD_ARTWORK_MAX_ITEMS), witness: hex24,
    topLevelCount: z.number().int().nonnegative().max(ARTBOARD_ARTWORK_MAX_ITEMS), topLevelBoundsWitness: hex24,
});
const frame = {
    active: z.number().int().nonnegative().max(ARTBOARD_MAX_COUNT - 1), rulerOrigin: pair, rulerUnits: z.string().max(64), colorSpace: z.enum(['RGB', 'CMYK']),
};
export const duplicateArtboardBeforeSchema = z.strictObject({
    boards: z.array(boardSchema).min(1).max(ARTBOARD_MAX_COUNT), ...frame,
    source: z.strictObject({ index: z.number().int().nonnegative().max(ARTBOARD_MAX_COUNT - 1), rect: integerRect }),
    roots: z.array(rootSchema).max(ARTBOARD_COPY_MAX_ROOTS), artwork: artworkSchema,
}).superRefine((s, ctx) => {
    if (s.boards.some((b, i) => b.index !== i) || s.active >= s.boards.length || s.source.index >= s.boards.length || !same(s.boards[s.source.index].rect, s.source.rect)) {
        ctx.addIssue({ code: 'custom', message: 'Boards must be in order and bind the active and source boards.' });
    }
});
const newBoardSchema = z.strictObject({ index: z.number().int().nonnegative().max(ARTBOARD_MAX_COUNT - 1), name: nameSchema, rect: integerRect });
export const duplicateArtboardAfterSchema = z.strictObject({
    boards: z.array(boardSchema).min(2).max(ARTBOARD_MAX_COUNT), ...frame, newBoard: newBoardSchema, artworkCount: z.number().int().positive(),
});
function same(a, b) { return canonicalSha256(a) === canonicalSha256(b); }
const implicitOrigin = (rect) => [0 - rect[0], 0 - rect[3]];
const readInt = (rect) => rect.map(readIntegerWithinTolerance);
export function duplicateArtboardOriginIsImplicit(s) {
    return s.boards.every((b) => b.rulerOrigin[0] === 0 && b.rulerOrigin[1] === 0) && same(s.rulerOrigin, implicitOrigin(s.boards[s.active].rect));
}
export function duplicateArtboardOverlapIndex(before, rect) {
    for (const b of before.boards)
        if (rect[0] <= b.rect[2] && rect[2] >= b.rect[0] && rect[3] <= b.rect[1] && rect[1] >= b.rect[3])
            return b.index;
    return null;
}
const overlapMessage = (index) => `The copy would overlap or touch artboard ${index}. Choose an offset that leaves a gap from every other artboard.`;
export function deriveDuplicateArtboardAfter(before, name, offset) {
    const r = before.source.rect, rect = [r[0] + offset[0], r[1] + offset[1], r[2] + offset[0], r[3] + offset[1]];
    const n = before.boards.length, nodes = before.roots.reduce((sum, root) => sum + root.nodes, 0);
    const board = { index: n, name, rect, rulerOrigin: [0, 0], presentation: [1, false, false, false] };
    return { boards: [...before.boards, board], active: n, rulerOrigin: implicitOrigin(rect), rulerUnits: before.rulerUnits, colorSpace: before.colorSpace,
        newBoard: { index: n, name, rect }, artworkCount: before.artwork.count + nodes };
}
const common = { expectedDocumentKey: keySchema, sourceIndex: z.number().int().min(0).max(ARTBOARD_MAX_COUNT - 1), name: nameSchema, offset: offsetSchema };
const internalSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...common, apply: z.literal(false) }),
    z.strictObject({ ...common, apply: z.literal(true), expectedBefore: duplicateArtboardBeforeSchema, confirmedAfter: duplicateArtboardAfterSchema, commandId: canonicalCommandIdSchema }),
]);
const publicCommon = { expected_document_key: keySchema, source_artboard_index: common.sourceIndex, name: nameSchema, offset: offsetSchema };
export const duplicateArtboardPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...publicCommon, apply: z.literal(false).default(false) }),
    z.strictObject({ ...publicCommon, apply: z.literal(true), expected_before: duplicateArtboardBeforeSchema, confirmed_after: duplicateArtboardAfterSchema, command_id: applyCommandIdSchema }),
]);
const inputSchema = z.strictObject({ ...publicCommon, apply: z.boolean().default(false), expected_before: duplicateArtboardBeforeSchema.optional(), confirmed_after: duplicateArtboardAfterSchema.optional(), command_id: applyCommandIdSchema.optional() });
const echoPublished = z.record(z.string(), z.unknown()).describe("Copy of the plan's before / after, exactly as the plan returned it (use the plan's next_call).");
const publishedPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...publicCommon, apply: z.literal(false).default(false) }),
    z.strictObject({ ...publicCommon, apply: z.literal(true), expected_before: echoPublished, confirmed_after: echoPublished, command_id: applyCommandIdSchema }),
]);
const { $schema: _schemaDialect, ...publishedSchema } = z.toJSONSchema(publishedPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedSchema });
function normalizePublicInput(input) {
    const v = duplicateArtboardPublicInputSchema.parse(input);
    const base = { expectedDocumentKey: v.expected_document_key, sourceIndex: v.source_artboard_index, name: v.name, offset: v.offset };
    return v.apply ? { ...base, apply: true, expectedBefore: v.expected_before, confirmedAfter: v.confirmed_after, commandId: v.command_id } : { ...base, apply: false };
}
export const DUPLICATE_ARTBOARD_BLOCKERS = ['document_mutation_not_allowed', 'source_artboard_empty', 'source_has_blocked_items', 'destination_not_empty', 'artboard_overlap', 'unmeasured_ruler_origin'];
const blockerSchema = z.enum(DUPLICATE_ARTBOARD_BLOCKERS);
const planSchema = z.strictObject({
    operation: z.literal(DUPLICATE_ARTBOARD_OPERATION), profile: z.literal('artboard_content_v1'), documentKey: keySchema, documentBefore: documentContextSchema,
    sourceIndex: common.sourceIndex, name: nameSchema, offset: offsetSchema, before: duplicateArtboardBeforeSchema, after: duplicateArtboardAfterSchema,
    blockedRoots: z.array(blockedRootSchema).max(ARTBOARD_COPY_MAX_ROOTS), destinationObstacles: z.array(obstacleSchema).max(20),
    changesState: z.literal(true), applyBlockedReasonCodes: z.array(blockerSchema), applyBlockedMessage: z.string().min(1).max(500).optional(),
    confirmationStatus: z.enum(['required', 'confirmed']), applyAllowed: z.boolean(),
}).superRefine((p, ctx) => {
    if (p.documentKey !== p.documentBefore.key || p.documentBefore.artboardCount !== p.before.boards.length || p.documentBefore.activeArtboardIndex !== p.before.active
        || !same(readInt(p.documentBefore.activeArtboardBounds), p.before.boards[p.before.active]?.rect))
        ctx.addIssue({ code: 'custom', message: 'Plan must bind the native document context to its before collection.' });
    if (p.before.colorSpace !== p.documentBefore.colorSpace)
        ctx.addIssue({ code: 'custom', message: 'Plan must bind the native document colour space to its before collection.' });
    if (p.before.source.index !== p.sourceIndex)
        ctx.addIssue({ code: 'custom', message: 'Plan must bind the requested source artboard.' });
    try {
        if (!same(deriveDuplicateArtboardAfter(p.before, p.name, p.offset), p.after))
            throw new Error();
    }
    catch {
        ctx.addIssue({ code: 'custom', message: 'Artboard after must be derived from the full before, the name and the offset.' });
    }
    const overlap = duplicateArtboardOverlapIndex(p.before, p.after.newBoard.rect);
    const expected = [];
    if (!p.documentBefore.mutationAllowed || (p.documentBefore.mutationProfile !== 'saved_file' && p.documentBefore.mutationProfile !== 'unsaved_document'))
        expected.push('document_mutation_not_allowed');
    if (p.before.roots.length === 0 && p.blockedRoots.length === 0)
        expected.push('source_artboard_empty');
    if (p.blockedRoots.length > 0)
        expected.push('source_has_blocked_items');
    if (p.destinationObstacles.length > 0)
        expected.push('destination_not_empty');
    if (overlap !== null)
        expected.push('artboard_overlap');
    if (!duplicateArtboardOriginIsImplicit(p.before))
        expected.push('unmeasured_ruler_origin');
    if (!same(expected, p.applyBlockedReasonCodes) || p.applyBlockedMessage !== (overlap === null ? undefined : overlapMessage(overlap)))
        ctx.addIssue({ code: 'custom', message: 'Plan must expose exactly the blockers of its evidence.' });
    if (p.applyAllowed !== (p.confirmationStatus === 'confirmed' && p.applyBlockedReasonCodes.length === 0))
        ctx.addIssue({ code: 'custom', message: 'Invalid admission flags.' });
});
const copySchema = z.strictObject({
    sourceUuid: z.string().min(1).max(256), copyUuid: z.string().min(1).max(256), type: z.enum(ARTBOARD_COPY_TYPES), name: z.string().max(1024),
    nodes: z.number().int().min(1).max(ARTBOARD_COPY_MAX_NODES), maxResidual: z.number().finite().nonnegative(), nonzeroResiduals: z.number().int().nonnegative(),
});
const postconditionSchema = z.strictObject({
    boards: z.array(boardSchema).min(2).max(ARTBOARD_MAX_COUNT), ...frame, newBoard: newBoardSchema, artworkCount: z.number().int().positive(),
    copies: z.array(copySchema).min(1).max(ARTBOARD_COPY_MAX_ROOTS), geometryTolerance: z.literal(ARTBOARD_COPY_GEOMETRY_TOLERANCE), maxResidual: z.number().finite().nonnegative(),
});
const transactionSchema = artboardTransactionSchema(DUPLICATE_ARTBOARD_OPERATION, { restoredSnapshot: duplicateArtboardBeforeSchema.nullable() }, { restoredSnapshot: null }, (v) => v.restoredSnapshot !== null);
const scanMsSchema = z.array(z.number().int().nonnegative()).max(16).optional();
export const duplicateArtboardResultSchema = z.union([
    z.strictObject({ scanMs: scanMsSchema, operation: z.literal(DUPLICATE_ARTBOARD_OPERATION), applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ scanMs: scanMsSchema, operation: z.literal(DUPLICATE_ARTBOARD_OPERATION), applied: z.literal(true), document: documentContextSchema, plan: planSchema, postcondition: postconditionSchema, transaction: transactionSchema }),
]).superRefine((r, ctx) => {
    const planned = r.transaction.state === 'planned';
    const b = r.plan.documentBefore;
    if (r.document.path !== b.path || r.document.fileRevision !== b.fileRevision || r.document.name !== b.name || r.document.appVersion !== b.appVersion || r.document.colorSpace !== b.colorSpace)
        ctx.addIssue({ code: 'custom', message: 'Result document must preserve the admitted file identity and profile.' });
    if (r.plan.confirmationStatus !== (planned ? 'required' : 'confirmed') || (!planned && (!r.plan.applyAllowed || r.plan.applyBlockedReasonCodes.length !== 0)))
        ctx.addIssue({ code: 'custom', message: 'Transaction requires the exact confirmed, unblocked plan.' });
    if (r.applied !== (r.transaction.state === 'verified'))
        ctx.addIssue({ code: 'custom', message: 'Only a verified transaction is applied.' });
    if (r.applied) {
        const p = r.postcondition, a = r.plan.after;
        if (!same({ boards: p.boards, active: p.active, rulerOrigin: p.rulerOrigin, rulerUnits: p.rulerUnits, colorSpace: p.colorSpace, newBoard: p.newBoard, artworkCount: p.artworkCount }, { boards: a.boards, active: a.active, rulerOrigin: a.rulerOrigin, rulerUnits: a.rulerUnits, colorSpace: a.colorSpace, newBoard: a.newBoard, artworkCount: a.artworkCount }))
            ctx.addIssue({ code: 'custom', message: 'Verified result must match the complete planned after.' });
        const roots = r.plan.before.roots;
        if (p.copies.length !== roots.length || p.copies.some((c, i) => c.sourceUuid !== roots[i].uuid || c.type !== roots[i].type || c.nodes !== roots[i].nodes || c.copyUuid === c.sourceUuid)
            || p.maxResidual !== Math.max(0, ...p.copies.map((c) => c.maxResidual)) || p.maxResidual > ARTBOARD_COPY_GEOMETRY_TOLERANCE)
            ctx.addIssue({ code: 'custom', message: 'Every planned root needs one copy within the geometry tolerance.' });
        if (r.document.artboardCount !== p.boards.length || r.document.activeArtboardIndex !== p.active)
            ctx.addIssue({ code: 'custom', message: 'Result document context must agree with the native postcondition.' });
    }
    if (r.transaction.state === 'rolled_back' && !same(r.transaction.rollback.restoredSnapshot, r.plan.before))
        ctx.addIssue({ code: 'custom', message: 'Recovery must prove the complete baseline.' });
});
const responseSchema = z.strictObject({ outcome: duplicateArtboardResultSchema, delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }) });
export const DUPLICATE_ARTBOARD_SAFETY = artboardSafetyRegistration(DUPLICATE_ARTBOARD_OPERATION);
export const DUPLICATE_ARTBOARD_SAFETY_IDENTITY = canonicalDigest(DUPLICATE_ARTBOARD_SAFETY);
const assertSafety = artboardSafetyAsserter(DUPLICATE_ARTBOARD_SAFETY, (value) => {
    const r = duplicateArtboardResultSchema.parse(value);
    return { operationId: DUPLICATE_ARTBOARD_OPERATION, documentKey: r.plan.documentKey,
        identityToken: `artboard-update-v1:${canonicalDigest({ operation: DUPLICATE_ARTBOARD_OPERATION, index: r.plan.sourceIndex, before: r.plan.before })}`,
        beforeState: { path: r.plan.documentBefore.path, fileRevision: r.plan.documentBefore.fileRevision, snapshot: r.plan.before }, afterState: r.plan.after,
        changeSet: { sourceIndex: r.plan.sourceIndex, name: r.plan.name, offset: r.plan.offset, profile: r.plan.profile },
        blocked: r.plan.applyBlockedReasonCodes.length > 0, confirmationStatus: r.plan.confirmationStatus, applyAllowed: r.plan.applyAllowed,
        transactionState: r.transaction.state, applied: r.applied };
});
export const DUPLICATE_ARTBOARD_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}${READ_PAGE_ITEM_AT_HELPER}${OBJECT_WITNESS_HELPERS}${OBJECT_WALK_HELPERS}${ARTBOARD_CONTENT_SIGNATURE_SCRIPT}
var scanStartedAt = 0, scanTotal = 0, scanVisited = 0, scanTicks = 0, dsScanMs = [];
var DS_MAX_BOARDS = ${ARTBOARD_MAX_COUNT}, DS_MAX_ROOTS = ${ARTBOARD_COPY_MAX_ROOTS}, DS_MAX_TOP_ITEMS = 5000;
function dsFail(message) { throw mutationError("preflight_failed", message); }
// Numbers compare in the form the host prints them: ExtendScript's String(number) keeps 15 significant digits, so a
// plan read back from the output (expected_before, confirmed_after) equals a fresh read only at that precision.
function dsSame(a, b) {
  if (typeof a === "number" && typeof b === "number") return String(a) === String(b);
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if ((a instanceof Array) !== (b instanceof Array)) return false;
  var k, count = 0, other = 0;
  for (k in a) if (a.hasOwnProperty(k)) { count++; if (!b.hasOwnProperty(k) || !dsSame(a[k], b[k])) return false; }
  for (k in b) if (b.hasOwnProperty(k)) other++;
  return count === other;
}
function dsNumbers(value, length, integer, label) {
  if (!value || value.length !== length) dsFail("Artboard geometry is unavailable at " + label + ".");
  var out = [], i, v, whole;
  for (i = 0; i < length; i++) {
    v = mutationFiniteNumber(value[i], label + "[" + i + "]");
    if (Math.abs(v) > 32768) dsFail("Geometry is outside the integer-point artboard profile: " + label + "[" + i + "] = " + v + " is beyond +/-32768.");
    if (integer) {
      whole = Math.round(v);
      if (Math.abs(v - whole) > ${ARTBOARD_INTEGER_TOLERANCE}) dsFail("Geometry is outside the integer-point artboard profile: " + label + "[" + i + "] = " + v + " is fractional but must be an integer.");
      v = whole + 0;
    }
    out.push(v);
  }
  return out;
}
function dsImplicitOrigin(rect) { return [0 - rect[0], 0 - rect[3]]; }
function dsBoards(doc) {
  var space = doc.documentColorSpace === DocumentColorSpace.RGB ? "RGB" : (doc.documentColorSpace === DocumentColorSpace.CMYK ? "CMYK" : null);
  if (space === null) dsFail("Only RGB and CMYK documents are supported.");
  if (doc.artboards.length < 1 || doc.artboards.length > DS_MAX_BOARDS) dsFail("Complete artboard collection exceeds the supported limit.");
  var boards = [], i, board, rect, par;
  for (i = 0; i < doc.artboards.length; i++) {
    board = doc.artboards[i]; rect = dsNumbers(board.artboardRect, 4, true, "artboard[" + i + "].rect");
    if (rect[0] >= rect[2] || rect[1] <= rect[3] || String(board.name).length > 1024) dsFail("Unsupported artboard state.");
    par = mutationFiniteNumber(board.rulerPAR, "artboard.rulerPAR");
    if (par < 0.1 || par > 10 || typeof board.showCenter !== "boolean" || typeof board.showCrossHairs !== "boolean" || typeof board.showSafeAreas !== "boolean") dsFail("Artboard presentation is unavailable.");
    boards.push({ index: i, name: String(board.name), rect: rect, rulerOrigin: dsNumbers(board.rulerOrigin, 2, true, "artboard[" + i + "].rulerOrigin"), presentation: [par, board.showCenter, board.showCrossHairs, board.showSafeAreas] });
  }
  var active = doc.artboards.getActiveArtboardIndex();
  if (typeof active !== "number" || active % 1 !== 0 || active < 0 || active >= boards.length) dsFail("Active artboard is unavailable.");
  return { boards: boards, active: active, rulerOrigin: dsNumbers(doc.rulerOrigin, 2, true, "document.rulerOrigin"), rulerUnits: String(doc.rulerUnits), colorSpace: space };
}
function dsAddLane(lanes, text) {
  var hashed = witnessText(text);
  lanes[0] = (lanes[0] + hashed[0]) >>> 0; lanes[1] = (lanes[1] + hashed[1]) >>> 0; lanes[2] = (lanes[2] + ((hashed[0] ^ hashed[1]) >>> 0)) >>> 0;
}
function dsLaneHex(lanes) { return witnessHex(lanes[0]) + witnessHex(lanes[1]) + witnessHex(lanes[2]); }
function dsBoundsText(uuid, bounds) {
  var text = uuid, i;
  for (i = 0; i < 4; i++) text += "|" + String(mutationFiniteNumber(bounds[i], "top-level geometricBounds"));
  return text;
}
// The whole-document witness: item count, the UUID set and each top-level item's exact bounds. Additive, so a predicted copy can be added to it.
// doc.pageItems.length is a MEASUREMENT, not the oracle (#971, 30.8.2): after group.duplicate(layer, PLACEATEND) it did not count the copy and its children, in the duplicating call
// and in the calls after it, while the layer collections, the whole-document walk and the uuid lookup did. The walk's own visits are the evidence and the length is a lower bound that
// the walk must reach. The long walk (visited > length) is the lag, and it is accepted only when the walk visited no compound path: the known blind route of the walk is a group inside a compound
// path, found only through doc.groupItems, which lags the same way and has no independent enumeration, so a missed one could hide inside the lag (N - k against N - m with m < k). With a compound
// path a long walk is refused as unproven (compound_route_unproven). That is scoped to this known route; it does not claim that nothing else was missed, and no other route is known or measured. An EQUAL count (visited == length) is the
// behaviour from before #971 and is not tightened here: it also reads as complete at m = k, which no count can tell apart (test/issue-971-walk-completeness.test.ts). A lagging length is never read
// as a missing or extra item: the verification compares the walk with the baseline PLUS the copies the call recorded (count and the additive UUID/bounds lanes), so a copy that is missing, an item
// nobody asked for and a copy that differs still fail.
function dsWitness(doc) {
  params.deadlineMs = ${ARTBOARD_ARTWORK_SCAN_DEADLINE_MS};
  scanStartedAt = new Date().getTime(); scanTotal = doc.pageItems.length; scanVisited = 0; scanTicks = 0;
  if (scanTotal > ${ARTBOARD_ARTWORK_MAX_ITEMS}) dsFail("Artwork count " + scanTotal + " exceeds the ${ARTBOARD_ARTWORK_MAX_ITEMS}-item limit.");
  var lanes = [0, 0, 0], boundsLanes = [0, 0, 0], count = 0, roots = 0, compounds = 0, seen = {};
  try {
    walkDocumentTree(doc, function (item, typeName) {
      var uuid = item.uuid;
      if (typeof uuid !== "string" || uuid.length < 1 || uuid.length > 256 || seen["u:" + uuid]) dsFail("Complete native artwork identity is unavailable.");
      if (typeName === "CompoundPathItem") compounds++;
      seen["u:" + uuid] = true; count++; dsAddLane(lanes, uuid);
      if (item.parent && item.parent.typename === "Layer") { roots++; dsAddLane(boundsLanes, dsBoundsText(uuid, item.geometricBounds)); }
    });
  } catch (walkError) {
    if (String(walkError && walkError.message).indexOf("READ_SCAN_DEADLINE") >= 0) dsFail("The artwork scan exceeded ${ARTBOARD_ARTWORK_SCAN_DEADLINE_MS} ms; no complete witness is available.");
    throw walkError;
  }
  var proofGap = scanVisited < scanTotal ? "count_mismatch" : (scanVisited > scanTotal && compounds > 0 ? "compound_route_unproven" : null);
  if (proofGap !== null || count !== scanVisited) dsFail("The artwork walk reached " + scanVisited + " of " + scanTotal + " page items (" + (proofGap === null ? "visit_count_differs" : proofGap) + "), so the identity is incomplete.");
  if (count > ${ARTBOARD_ARTWORK_MAX_ITEMS}) dsFail("Artwork count " + count + " exceeds the ${ARTBOARD_ARTWORK_MAX_ITEMS}-item limit.");
  dsScanMs.push(new Date().getTime() - scanStartedAt);
  return { count: count, lanes: lanes, boundsLanes: boundsLanes, topLevelCount: roots };
}
function dsArtwork(w) { return { count: w.count, witness: dsLaneHex(w.lanes), topLevelCount: w.topLevelCount, topLevelBoundsWitness: dsLaneHex(w.boundsLanes) }; }
function dsContains(r, b) { return b[0] >= r[0] && b[1] <= r[1] && b[2] <= r[2] && b[3] >= r[3]; }
function dsIntersects(r, b) { return b[2] > r[0] && b[0] < r[2] && b[1] > r[3] && b[3] < r[1]; }
function dsLayerOrder(layer) {
  var out = [], i;
  for (i = 0; i < layer.pageItems.length; i++) out.push(String(layer.pageItems[i].uuid));
  return out;
}
function dsName(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 255 || /^\\s|\\s$|[\\x00-\\x1f\\x7f]/.test(value)) dsFail("Unsupported artboard name.");
  return value;
}
function dsOffset() {
  var o = params.offset;
  if (!(o instanceof Array) || o.length !== 2 || typeof o[0] !== "number" || typeof o[1] !== "number" || o[0] % 1 !== 0 || o[1] % 1 !== 0 || (o[0] === 0 && o[1] === 0)) dsFail("offset requires two integers that are not both zero.");
  return o;
}
// The content of the source artboard: the roots to copy, the items that block, and what already lies where the copy would go.
function dsScan(doc, boards, sourceRect, targetRect) {
  var roots = [], blocked = [], obstacles = [], rootItems = [], layerOrders = {}, nodes = 0, li, layer, j, item, bounds, reasons, sig, type, record, layerOk, top = 0;
  for (li = 0; li < doc.layers.length; li++) {
    layer = doc.layers[li];
    if (layer.layers.length !== 0) dsFail("Sublayers are unmeasured.");
    layerOk = layer.visible === true && layer.locked !== true;
    for (j = 0; j < layer.pageItems.length; j++) {
      if (++top > DS_MAX_TOP_ITEMS) dsFail("The document has more than " + DS_MAX_TOP_ITEMS + " top-level page items.");
      item = layer.pageItems[j]; type = String(item.typename);
      bounds = dsNumbers(item.visibleBounds, 4, false, "visibleBounds");
      if (!dsIntersects(sourceRect, bounds)) {
        if (dsIntersects(targetRect, bounds) && obstacles.length < 20) obstacles.push({ uuid: String(item.uuid), type: type, name: String(item.name) });
        else if (dsIntersects(targetRect, bounds)) obstacles.push(null);
        continue;
      }
      reasons = [];
      if (item.locked === true) reasons.push("locked_item");
      if (item.hidden === true) reasons.push("hidden_item");
      if (layer.locked === true) reasons.push("locked_layer");
      if (layer.visible !== true) reasons.push("hidden_layer");
      if (!dsContains(sourceRect, bounds)) reasons.push("crosses_source_artboard");
      sig = null;
      if (reasons.length === 0) {
        sig = daSignature(item);
        if (sig.refusal !== null) reasons.push(sig.refusal);
        else {
          nodes += sig.nodes;
          if (nodes > DA_MAX_NODES) dsFail("The artboard content has more than " + DA_MAX_NODES + " page items.");
        }
      }
      if (reasons.length > 0) { if (blocked.length < DS_MAX_ROOTS) blocked.push({ uuid: String(item.uuid), type: type, name: String(item.name), reasons: reasons }); else dsFail("More than " + DS_MAX_ROOTS + " items block the copy."); continue; }
      if (roots.length >= DS_MAX_ROOTS) dsFail("The artboard has more than " + DS_MAX_ROOTS + " top-level items to copy.");
      record = { uuid: sig.uuids[0], type: type, name: String(item.name), layer: li, order: j, nodes: sig.nodes, digest: daDigest(sig) };
      roots.push(record); rootItems.push({ item: item, layer: layer, record: record, sig: sig });
      if (!layerOrders.hasOwnProperty("l" + li)) layerOrders["l" + li] = dsLayerOrder(layer);
    }
  }
  var realObstacles = [], k;
  for (k = 0; k < obstacles.length; k++) if (obstacles[k] !== null) realObstacles.push(obstacles[k]);
  return { roots: roots, blocked: blocked, obstacles: realObstacles, obstacleOverflow: obstacles.length > realObstacles.length, rootItems: rootItems, layerOrders: layerOrders };
}
function dsOverlapIndex(boards, rect) {
  var i, r;
  for (i = 0; i < boards.length; i++) {
    r = boards[i].rect;
    if (rect[0] <= r[2] && rect[2] >= r[0] && rect[3] <= r[1] && rect[1] >= r[3]) return i;
  }
  return null;
}
function dsOriginImplicit(s) {
  var i;
  for (i = 0; i < s.boards.length; i++) if (s.boards[i].rulerOrigin[0] !== 0 || s.boards[i].rulerOrigin[1] !== 0) return false;
  return dsSame(s.rulerOrigin, dsImplicitOrigin(s.boards[s.active].rect));
}
function dsDerive(before, name, offset) {
  var r = before.source.rect, rect = [r[0] + offset[0], r[1] + offset[1], r[2] + offset[0], r[3] + offset[1]], n = before.boards.length, nodes = 0, i;
  if (n >= DS_MAX_BOARDS) dsFail("Complete artboard collection exceeds the supported limit.");
  for (i = 0; i < rect.length; i++) if (Math.abs(rect[i]) > 32768) dsFail("The copy would lie beyond +/-32768 pt.");
  for (i = 0; i < before.roots.length; i++) nodes += before.roots[i].nodes;
  var boards = [];
  for (i = 0; i < n; i++) boards.push(before.boards[i]);
  boards.push({ index: n, name: name, rect: rect, rulerOrigin: [0, 0], presentation: [1, false, false, false] });
  return { boards: boards, active: n, rulerOrigin: dsImplicitOrigin(rect), rulerUnits: before.rulerUnits, colorSpace: before.colorSpace, newBoard: { index: n, name: name, rect: rect }, artworkCount: before.artwork.count + nodes };
}
function dsExact(value) { var i; for (i = 0; i < value.length; i++) if (!(Math.abs(value[i] - Math.round(value[i])) <= ${ARTBOARD_INTEGER_TOLERANCE})) return false; return true; }
function dsResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var doc = app.activeDocument, name = dsName(params.name), offset = dsOffset(), index = params.sourceIndex;
  var snapshot = dsBoards(doc);
  if (typeof index !== "number" || index % 1 !== 0 || index < 0 || index >= snapshot.boards.length) dsFail("Source artboard index is outside the complete collection.");
  if (!dsExact(doc.rulerOrigin)) dsFail("document.rulerOrigin is not integral within the tolerance, so the origin the host recomputes could not be restored.");
  var sourceRect = snapshot.boards[index].rect, scan;
  var targetRect = [sourceRect[0] + offset[0], sourceRect[1] + offset[1], sourceRect[2] + offset[0], sourceRect[3] + offset[1]];
  scan = dsScan(doc, snapshot.boards, sourceRect, targetRect);
  var witness = dsWitness(doc);
  var before = { boards: snapshot.boards, active: snapshot.active, rulerOrigin: snapshot.rulerOrigin, rulerUnits: snapshot.rulerUnits, colorSpace: snapshot.colorSpace, source: { index: index, rect: sourceRect }, roots: scan.roots, artwork: dsArtwork(witness) };
  var after = dsDerive(before, name, offset), blockers = [], overlap = dsOverlapIndex(before.boards, after.newBoard.rect), message = null;
  if (!context.mutationAllowed || (context.mutationProfile !== "saved_file" && context.mutationProfile !== "unsaved_document")) blockers.push("document_mutation_not_allowed");
  if (scan.roots.length === 0 && scan.blocked.length === 0) blockers.push("source_artboard_empty");
  if (scan.blocked.length > 0) blockers.push("source_has_blocked_items");
  if (scan.obstacles.length > 0 || scan.obstacleOverflow) blockers.push("destination_not_empty");
  if (overlap !== null) { blockers.push("artboard_overlap"); message = "The copy would overlap or touch artboard " + overlap + ". Choose an offset that leaves a gap from every other artboard."; }
  if (!dsOriginImplicit(before)) blockers.push("unmeasured_ruler_origin");
  if (forApply) {
    if (!dsSame(before, params.expectedBefore)) dsFail("expected_before does not match the complete artboard and content state.");
    if (!dsSame(after, params.confirmedAfter)) dsFail("confirmed_after does not match the derived plan.");
    if (blockers.length > 0) dsFail(message || "The artboard copy is blocked: " + blockers.join(", ") + ".");
  }
  return { context: context, document: doc, before: before, after: after, blockers: blockers, message: message, blocked: scan.blocked, obstacles: scan.obstacles, rootItems: scan.rootItems,
    layerOrders: scan.layerOrders, witness: witness, name: name, offset: offset, board: null };
}
function dsPlan(p) {
  var plan = { operation: "duplicate_artboard", profile: "artboard_content_v1", documentKey: p.context.key, documentBefore: p.context, sourceIndex: params.sourceIndex, name: p.name, offset: p.offset,
    before: p.before, after: p.after, blockedRoots: p.blocked, destinationObstacles: p.obstacles, changesState: true, applyBlockedReasonCodes: p.blockers };
  if (p.message !== null) plan.applyBlockedMessage = p.message;
  plan.confirmationStatus = params.apply === true ? "confirmed" : "required";
  plan.applyAllowed = params.apply === true && p.blockers.length === 0;
  return plan;
}
function dsRevalidate(p) {
  try {
    var current = dsResolve(true);
    if (current.document !== p.document || !dsSame(current.before, p.before) || !dsSame(current.layerOrders, p.layerOrders)) dsFail("The artboard or its content changed before apply.");
    var i;
    for (i = 0; i < current.rootItems.length; i++) if (current.rootItems[i].item.uuid !== p.rootItems[i].record.uuid) dsFail("The artboard content identity changed before apply.");
  } catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "The artboard or its content changed before apply.")); }
}
function dsApply(p, plan, state) {
  state.operationState.mutationStarted = true;
  var dx = p.offset[0], dy = p.offset[1], i, entry, copy, board;
  for (i = 0; i < p.rootItems.length; i++) {
    try { copy = p.rootItems[i].item.duplicate(p.rootItems[i].layer, ElementPlacement.PLACEATEND); } catch (error) { mutationNativeFailure("duplicate", error); }
    entry = { sourceUuid: p.rootItems[i].record.uuid, copy: copy, copyUuid: null, layer: p.rootItems[i].record.layer };
    state.operationState.created.push(entry);
    if (!copy || typeof copy.uuid !== "string" || copy.uuid.length === 0 || copy.uuid === entry.sourceUuid) throw mutationError("apply_failed", "Illustrator did not return a distinct native UUID for the copy.");
    entry.copyUuid = copy.uuid;
    try { copy.translate(dx, dy, true, false, false, false); } catch (error) { mutationNativeFailure("translate", error); }
  }
  try { board = p.document.artboards.add(plan.after.newBoard.rect); } catch (error) { mutationNativeFailure("artboards.add", error); }
  state.operationState.board = board;
  try { board.name = plan.after.newBoard.name; } catch (error) { mutationNativeFailure("Artboard.name", error); }
}
function dsRead(p) {
  if (app.documents.length === 0 || app.activeDocument !== p.document) dsFail("Artboard document reference changed.");
  var current = getDocumentContext();
  if (current.path !== p.context.path || current.fileRevision !== p.context.fileRevision || current.name !== p.context.name || current.appVersion !== p.context.appVersion) dsFail("The document file identity changed after apply.");
  return dsBoards(p.document);
}
function dsVerify(p, plan, state) {
  var boards = dsRead(p), a = plan.after, i, j, entry, source, copySig, cmp, copies = [], maxResidual = 0, expectedLanes = [p.witness.lanes[0], p.witness.lanes[1], p.witness.lanes[2]];
  var expectedBounds = [p.witness.boundsLanes[0], p.witness.boundsLanes[1], p.witness.boundsLanes[2]], copiesByLayer = {}, nodes = 0;
  if (!dsSame({ boards: boards.boards, active: boards.active, rulerOrigin: boards.rulerOrigin, rulerUnits: boards.rulerUnits, colorSpace: boards.colorSpace }, { boards: a.boards, active: a.active, rulerOrigin: a.rulerOrigin, rulerUnits: a.rulerUnits, colorSpace: a.colorSpace })) throw mutationError("verify_mismatch", "Artboards read back differ from the complete planned after.");
  if (p.document.artboards.length !== a.boards.length || p.document.artboards[a.newBoard.index] !== state.operationState.board) throw mutationError("verify_mismatch", "The added artboard is not the self-created board.");
  if (state.operationState.created.length !== p.rootItems.length) throw mutationError("verify_mismatch", "Not every planned item was copied.");
  for (i = 0; i < p.rootItems.length; i++) {
    entry = state.operationState.created[i]; source = p.rootItems[i];
    if (source.item.uuid !== source.record.uuid || daDigest(daSignature(source.item)) !== source.record.digest) throw mutationError("verify_mismatch", "A source item changed: " + source.record.name + ".");
    if (entry.copy.uuid !== entry.copyUuid || entry.copy.parent !== source.layer) throw mutationError("verify_mismatch", "A copy is not in the source's layer: " + source.record.name + ".");
    copySig = daSignature(entry.copy);
    if (copySig.refusal !== null || copySig.nodes !== source.record.nodes) throw mutationError("verify_mismatch", "A copy has a different structure: " + source.record.name + ".");
    cmp = daCompareCopy(source.sig, copySig, p.offset[0], p.offset[1]);
    if (!cmp.ok) throw mutationError("verify_mismatch", "A copy differs from its source (" + cmp.reason + "): " + source.record.name + ".");
    for (j = 0; j < copySig.uuids.length; j++) { if (copySig.uuids[j] === source.sig.uuids[j]) throw mutationError("verify_mismatch", "A copy shares an identity with its source."); dsAddLane(expectedLanes, copySig.uuids[j]); }
    dsAddLane(expectedBounds, dsBoundsText(entry.copyUuid, entry.copy.geometricBounds));
    nodes += copySig.nodes;
    if (!copiesByLayer.hasOwnProperty("l" + entry.layer)) copiesByLayer["l" + entry.layer] = [];
    copiesByLayer["l" + entry.layer].push(entry.copyUuid);
    if (cmp.maxResidual > maxResidual) maxResidual = cmp.maxResidual;
    copies.push({ sourceUuid: source.record.uuid, copyUuid: entry.copyUuid, type: source.record.type, name: source.record.name, nodes: copySig.nodes, maxResidual: cmp.maxResidual, nonzeroResiduals: cmp.nonzero });
  }
  var key, expectedOrder;
  for (key in p.layerOrders) if (p.layerOrders.hasOwnProperty(key)) {
    expectedOrder = p.layerOrders[key].concat(copiesByLayer.hasOwnProperty(key) ? copiesByLayer[key] : []);
    if (!dsSame(dsLayerOrder(p.document.layers[Number(key.substring(1))]), expectedOrder)) throw mutationError("verify_mismatch", "The layer stacking order differs from the baseline plus the copies.");
  }
  var now = dsWitness(p.document);
  if (now.count !== p.before.artwork.count + nodes || a.artworkCount !== now.count || now.topLevelCount !== p.before.artwork.topLevelCount + copies.length
    || dsLaneHex(now.lanes) !== dsLaneHex(expectedLanes) || dsLaneHex(now.boundsLanes) !== dsLaneHex(expectedBounds)) throw mutationError("verify_mismatch", "The document artwork differs from the baseline plus the copies.");
  return { boards: boards.boards, active: boards.active, rulerOrigin: boards.rulerOrigin, rulerUnits: boards.rulerUnits, colorSpace: boards.colorSpace, newBoard: a.newBoard, artworkCount: now.count,
    copies: copies, geometryTolerance: DA_TOLERANCE, maxResidual: maxResidual };
}
// The complete baseline again: boards, active, the whole-document witness, each source's signature and the layer orders.
function dsBaselineHolds(p) {
  var boards = dsRead(p), w = dsWitness(p.document), i, key;
  if (!dsSame(boards, { boards: p.before.boards, active: p.before.active, rulerOrigin: p.before.rulerOrigin, rulerUnits: p.before.rulerUnits, colorSpace: p.before.colorSpace })) return false;
  if (!dsSame(dsArtwork(w), p.before.artwork)) return false;
  for (i = 0; i < p.rootItems.length; i++) if (p.rootItems[i].item.uuid !== p.rootItems[i].record.uuid || daDigest(daSignature(p.rootItems[i].item)) !== p.rootItems[i].record.digest) return false;
  for (key in p.layerOrders) if (p.layerOrders.hasOwnProperty(key)) if (!dsSame(dsLayerOrder(p.document.layers[Number(key.substring(1))]), p.layerOrders[key])) return false;
  return true;
}
function dsRefState(ref, uuid) {
  try { return (typeof ref.uuid === "string" && ref.uuid === uuid) ? "present" : "mismatch"; }
  catch (error) { if (error && error.name === "ReferenceError" && error.number === 45) return "invalid"; throw error; }
}
function dsRollback(state) {
  var p = state.preflight, created = state.operationState.created, i, entry, board = state.operationState.board;
  try {
    if (app.documents.length === 0 || app.activeDocument !== p.document) return { status: "indeterminate", message: "Rollback document is indeterminate." };
    // Nothing to undo when the baseline already holds (an apply that failed before it changed anything).
    if (!dsBaselineHolds(p)) {
      if (board !== null && board !== undefined) {
        if (p.document.artboards.length !== p.before.boards.length + 1 || p.document.artboards[p.before.boards.length] !== board) return { status: "indeterminate", message: "Rollback refused because the self-created artboard is not proven." };
        board.remove();
      } else if (p.document.artboards.length !== p.before.boards.length) return { status: "indeterminate", message: "Rollback refused because an unowned artboard appeared." };
      for (i = created.length - 1; i >= 0; i--) {
        entry = created[i];
        if (typeof entry.copyUuid !== "string" || dsRefState(entry.copy, entry.copyUuid) !== "present") return { status: "indeterminate", message: "Rollback refused because a copy identity is not proven." };
        if (entry.copy.locked || entry.copy.hidden) return { status: "failed", message: "Rollback refused because a copy is not safely editable." };
        entry.copy.remove();
        if (dsRefState(entry.copy, entry.copyUuid) !== "invalid") return { status: "failed", message: "Rollback removal did not remove a copy." };
      }
      // Removing the board does not restore the active board or the document origin; restore the active board explicitly.
      p.document.artboards.setActiveArtboardIndex(p.before.active);
    }
    if (!dsBaselineHolds(p)) return { status: "indeterminate", message: "Rollback did not restore the complete baseline." };
    state.operationState.rollbackEvidence.restoredSnapshot = p.before;
    return { status: "verified" };
  } catch (error) { return { status: "indeterminate", message: "Rollback could not prove the complete baseline." }; }
}
var dsExecution = runMutationTransaction({
  apply: params.apply === true,
  initialOperationState: function () { return { mutationStarted: false, created: [], board: null, rollbackEvidence: { restoredSnapshot: null } }; },
  preflight: dsResolve, plan: dsPlan, revalidate: dsRevalidate, applyMutation: dsApply, verify: dsVerify, rollback: dsRollback,
  hasMutationEvidence: function (s) { return s.operationState.mutationStarted === true; },
  applyIndeterminate: function () { return { reasonCode: "artboard_state_unknown", message: "Artboard copy outcome is indeterminate.", evidence: { restoredSnapshot: null } }; },
  rollbackEvidence: function (s) { return s.operationState.rollbackEvidence; }
});
var dsDocument = dsExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === dsExecution.preflight.document) {
  dsDocument = getDocumentContext();
}
var result = { operation: "duplicate_artboard", applied: dsExecution.transaction.state === "verified", document: dsDocument, plan: dsExecution.plan, transaction: dsExecution.transaction };
if (result.applied) result.postcondition = dsExecution.value;
if (dsScanMs.length > 0) result.scanMs = dsScanMs;
`;
export const DUPLICATE_ARTBOARD_HOST_SCRIPT_DIGEST = canonicalSha256(DUPLICATE_ARTBOARD_SCRIPT);
export const DUPLICATE_ARTBOARD_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: DUPLICATE_ARTBOARD_OPERATION, validator: DUPLICATE_ARTBOARD_VALIDATOR,
    canonicalContractVersion: 1, resultSchemaVersion: 1, terminalClassifierVersion: 1, safetyConformanceVersion: 1, errorMappingVersion: 1,
    safetyIdentity: DUPLICATE_ARTBOARD_SAFETY_IDENTITY, hostScriptDigest: DUPLICATE_ARTBOARD_HOST_SCRIPT_DIGEST, mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalSchema.parse(input);
    const { commandId: _commandId, ...bound } = request;
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: request.apply ? request.commandId : null, documentKey: request.expectedDocumentKey,
        digest: canonicalSha256({ operation: DUPLICATE_ARTBOARD_OPERATION, validator: DUPLICATE_ARTBOARD_VALIDATOR, request: bound }) };
}
export const duplicateArtboardToolContract = {
    name: 'illustrator_duplicate_artboard', title: 'Plan or Duplicate an Artboard with Its Contents',
    description: 'Copy one artboard with the top-level items completely inside it as a new artboard moved by an integer offset [dx, dy] (e.g. dated coupons). Plan lists the items, refusals (locked, hidden, crossing, unmeasured types or paint), and what lies at the destination; apply copies, names the board and verifies every attribute incl. CMYK, spot and gradient paints (geometry within 2^-10 pt). Returns source->copy UUIDs and residuals. RGB or CMYK, Illustrator frontmost and unlocked.',
    inputSchema, publicInputSchema: duplicateArtboardPublicInputSchema, outputSchema: responseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(DUPLICATE_ARTBOARD_SAFETY.policy), normalizePublicInput,
};
export function createDuplicateArtboardAdapter() {
    return {
        version: 1, operation: DUPLICATE_ARTBOARD_OPERATION, validator: DUPLICATE_ARTBOARD_VALIDATOR,
        safety: DUPLICATE_ARTBOARD_SAFETY, safetyRegistrationIdentity: DUPLICATE_ARTBOARD_SAFETY_IDENTITY, adapterIdentity: DUPLICATE_ARTBOARD_ADAPTER_IDENTITY,
        tool: duplicateArtboardToolContract, canonical: { version: 1, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: duplicateArtboardResultSchema, resultSchemaVersion: 1, terminalClassifierVersion: 1, safetyConformanceVersion: 1, errorMappingVersion: 1,
        hostScriptDigest: DUPLICATE_ARTBOARD_HOST_SCRIPT_DIGEST, mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const n = normalizedRequest(input), { commandId: _commandId, ...params } = n.request;
            if (n.intent === 'plan')
                return { kind: 'read', script: DUPLICATE_ARTBOARD_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: DUPLICATE_ARTBOARD_VALIDATOR, idempotency: { commandId: n.commandId, operation: DUPLICATE_ARTBOARD_OPERATION, documentKey: n.documentKey, requestDigest: n.digest },
                adapterIdentity: DUPLICATE_ARTBOARD_ADAPTER_IDENTITY, mutationHostApplicationMode: 'foreground', script: DUPLICATE_ARTBOARD_SCRIPT, params };
        },
        classifyTerminal(value) { return classifyArtboardTerminal(duplicateArtboardResultSchema.parse(value).transaction.state, 'Artboard copy'); },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error) { return error instanceof Error ? error : new Error(String(error)); },
    };
}
