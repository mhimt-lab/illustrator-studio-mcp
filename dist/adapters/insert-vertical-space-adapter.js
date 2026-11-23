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
import { SNAPSHOT_RESULT_ADMISSION_BYTES } from './snapshot-result-size.js';
import { classifyBoard, classifyGuide, classifyItem, guidePointsAfter, moveRect, stretchRect, } from '../vertical-space-plan.js';
export const INSERT_VERTICAL_SPACE_OPERATION = 'insert_vertical_space';
export const INSERT_VERTICAL_SPACE_VALIDATOR = { kind: INSERT_VERTICAL_SPACE_OPERATION, version: 1 };
export { ARTBOARD_COPY_GEOMETRY_TOLERANCE as INSERT_VERTICAL_SPACE_GEOMETRY_TOLERANCE };
export const INSERT_VERTICAL_SPACE_MAX_DELTA = 4_096;
export const INSERT_VERTICAL_SPACE_MAX_GUIDES = 32;
export const INSERT_VERTICAL_SPACE_MAX_BOARDS = 16;
const MAX_LISTED = 20;
const keySchema = z.string().min(1).max(16_384);
const coordinate = z.number().finite().min(-32_768).max(32_768);
const pair = z.tuple([coordinate, coordinate]);
const box = z.tuple([coordinate, coordinate, coordinate, coordinate]);
const integerRect = box.superRefine((r, ctx) => {
    if (r[0] >= r[2] || r[1] <= r[3])
        ctx.addIssue({ code: 'custom', message: 'Rect must have positive width and height.' });
    if (!r.every(Number.isInteger))
        ctx.addIssue({ code: 'custom', message: 'Only integer-point rects are supported.' });
});
const hex24 = z.string().regex(/^[0-9a-f]{24}$/u);
const xRangeSchema = z.tuple([coordinate, coordinate]).superRefine((r, ctx) => { if (!(r[0] < r[1]))
    ctx.addIssue({ code: 'custom', message: 'x_range must be [min_x, max_x] with min_x < max_x.' }); });
const deltaSchema = z.number().int().min(-INSERT_VERTICAL_SPACE_MAX_DELTA).max(INSERT_VERTICAL_SPACE_MAX_DELTA)
    .superRefine((v, ctx) => { if (v === 0)
    ctx.addIssue({ code: 'custom', message: 'delta must not be 0 (positive opens space downward, negative closes it).' }); });
const indexesSchema = z.array(z.number().int().min(0).max(ARTBOARD_MAX_COUNT - 1)).max(INSERT_VERTICAL_SPACE_MAX_BOARDS)
    .superRefine((v, ctx) => { if (new Set(v).size !== v.length)
    ctx.addIssue({ code: 'custom', message: 'artboard_indexes must be distinct.' }); });
const boardSchema = z.strictObject({
    index: z.number().int().nonnegative(), name: z.string().max(1024), rect: integerRect, rulerOrigin: pair,
    presentation: z.tuple([z.number().finite().min(0.1).max(10), z.boolean(), z.boolean(), z.boolean()]),
});
const movedSchema = z.strictObject({
    uuid: z.string().min(1).max(256), type: z.enum(ARTBOARD_COPY_TYPES), name: z.string().max(1024),
    layer: z.number().int().nonnegative().max(1023), order: z.number().int().nonnegative(), nodes: z.number().int().min(1).max(ARTBOARD_COPY_MAX_NODES), digest: hex24, box,
});
const guidePoint = z.tuple([coordinate, coordinate, coordinate, coordinate, coordinate, coordinate]);
const guideGeometry = z.strictObject({ points: z.tuple([guidePoint, guidePoint, guidePoint, guidePoint]), geometricBounds: box, visibleBounds: box, controlBounds: box, position: pair });
const guideSchema = z.strictObject({
    uuid: z.string().min(1).max(256), name: z.string().max(1024), layer: z.number().int().nonnegative().max(1023), order: z.number().int().nonnegative(),
    mode: z.enum(['move', 'stretch']), parts: hex24, geometry: guideGeometry,
});
const listedSchema = z.strictObject({ uuid: z.string().min(1).max(256), type: z.string().max(64), name: z.string().max(1024), reasons: z.array(z.string().min(1).max(160)).min(1).max(8) });
const obstacleSchema = z.strictObject({ uuid: z.string().min(1).max(256), type: z.string().max(64), name: z.string().max(1024) });
const artworkSchema = z.strictObject({
    count: z.number().int().nonnegative().max(ARTBOARD_ARTWORK_MAX_ITEMS), witness: hex24,
    untouchedTopLevelCount: z.number().int().nonnegative().max(ARTBOARD_ARTWORK_MAX_ITEMS), untouchedBoundsWitness: hex24, layerOrders: hex24,
});
const frame = { active: z.number().int().nonnegative().max(ARTBOARD_MAX_COUNT - 1), rulerOrigin: pair, rulerUnits: z.string().max(64), colorSpace: z.literal('RGB') };
export const insertVerticalSpaceBeforeSchema = z.strictObject({
    boards: z.array(boardSchema).min(1).max(ARTBOARD_MAX_COUNT), ...frame,
    moved: z.array(movedSchema).max(ARTBOARD_COPY_MAX_ROOTS), guides: z.array(guideSchema).max(INSERT_VERTICAL_SPACE_MAX_GUIDES), artwork: artworkSchema,
}).superRefine((s, ctx) => {
    if (s.boards.some((b, i) => b.index !== i) || s.active >= s.boards.length)
        ctx.addIssue({ code: 'custom', message: 'Boards must be in order and bind the active board.' });
    if (new Set([...s.moved.map((m) => m.uuid), ...s.guides.map((g) => g.uuid)]).size !== s.moved.length + s.guides.length)
        ctx.addIssue({ code: 'custom', message: 'Moved items and guides must be distinct.' });
});
export const insertVerticalSpaceAfterSchema = z.strictObject({
    boards: z.array(boardSchema).min(1).max(ARTBOARD_MAX_COUNT), ...frame, dy: z.number().int(),
    guides: z.array(z.strictObject({ uuid: z.string().min(1).max(256), geometry: guideGeometry })).max(INSERT_VERTICAL_SPACE_MAX_GUIDES),
});
function same(a, b) { return canonicalSha256(a) === canonicalSha256(b); }
const implicitOrigin = (rect) => [0 - rect[0], 0 - rect[3]];
const readInt = (rect) => rect.map(readIntegerWithinTolerance);
export function insertVerticalSpaceOriginIsImplicit(s) {
    return s.boards.every((b) => b.rulerOrigin[0] === 0 && b.rulerOrigin[1] === 0) && same(s.rulerOrigin, implicitOrigin(s.boards[s.active].rect));
}
export function verticalSpaceBoards(before, request) {
    const geometry = { xRange: request.xRange, cutY: request.cutY }, dy = -request.delta, listed = new Set(request.artboardIndexes);
    const rects = before.boards.map((b) => [...b.rect]);
    const blockers = [], messages = [];
    for (const index of request.artboardIndexes) {
        if (index >= before.boards.length) {
            blockers.push('artboard_not_affected');
            messages.push(`artboard ${index} does not exist`);
            continue;
        }
        const rect = before.boards[index].rect, kind = classifyBoard(rect, geometry);
        if (kind === 'move')
            rects[index] = moveRect(rect, dy);
        else if (kind === 'stretch') {
            rects[index] = stretchRect(rect, dy);
            if (rects[index][1] - rects[index][3] < 1) {
                blockers.push('artboard_collapse');
                messages.push(`artboard ${index} would be shorter than 1 pt`);
            }
        }
        else {
            blockers.push(kind === 'crosses_x_range' ? 'artboard_crosses_x_range' : 'artboard_not_affected');
            messages.push(`artboard ${index} is ${kind === 'crosses_x_range' ? 'partly outside x_range' : 'not below or across the cut inside x_range'}`);
        }
    }
    before.boards.forEach((b, index) => {
        if (listed.has(index))
            return;
        const kind = classifyBoard(b.rect, geometry);
        if (kind === 'move' || kind === 'stretch') {
            blockers.push('artboard_not_listed');
            messages.push(`artboard ${index} lies below or across the cut inside x_range but is not listed`);
        }
    });
    const touches = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[3] <= b[1] && a[1] >= b[3];
    for (const index of request.artboardIndexes) {
        if (index >= before.boards.length)
            continue;
        for (let other = 0; other < rects.length; other += 1) {
            if (other === index)
                continue;
            if (touches(rects[index], rects[other]) && !touches(before.boards[index].rect, before.boards[other].rect)) {
                blockers.push('artboard_overlap');
                messages.push(`artboard ${index} would overlap or touch artboard ${other}`);
            }
        }
    }
    return { rects, blockers: [...new Set(blockers)], messages };
}
export function deriveInsertVerticalSpaceAfter(before, request) {
    const dy = -request.delta, { rects } = verticalSpaceBoards(before, request);
    const boards = before.boards.map((b, i) => ({ ...b, rect: rects[i] }));
    return {
        boards, active: before.active, rulerOrigin: implicitOrigin(rects[before.active]), rulerUnits: before.rulerUnits, colorSpace: 'RGB', dy,
        guides: before.guides.map((g) => ({ uuid: g.uuid, geometry: guidePointsAfter(g.geometry, g.mode, request.cutY, dy) })),
    };
}
export function verticalSpaceBoardOrder(before, after) {
    const changed = before.boards.filter((b, i) => !same(b.rect, after.boards[i].rect));
    return changed.sort((a, b) => (after.dy < 0 ? a.rect[3] - b.rect[3] : b.rect[1] - a.rect[1])).map((b) => b.index);
}
const common = { expectedDocumentKey: keySchema, xRange: xRangeSchema, cutY: coordinate, delta: deltaSchema, artboardIndexes: indexesSchema };
const internalSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...common, apply: z.literal(false) }),
    z.strictObject({ ...common, apply: z.literal(true), expectedBefore: insertVerticalSpaceBeforeSchema, confirmedAfter: insertVerticalSpaceAfterSchema, commandId: canonicalCommandIdSchema }),
]);
const publicCommon = { expected_document_key: keySchema, x_range: xRangeSchema, cut_y: coordinate, delta: deltaSchema, artboard_indexes: indexesSchema };
export const insertVerticalSpacePublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...publicCommon, apply: z.literal(false).default(false) }),
    z.strictObject({ ...publicCommon, apply: z.literal(true), expected_before: insertVerticalSpaceBeforeSchema, confirmed_after: insertVerticalSpaceAfterSchema, command_id: applyCommandIdSchema }),
]);
const inputSchema = z.strictObject({ ...publicCommon, apply: z.boolean().default(false), expected_before: insertVerticalSpaceBeforeSchema.optional(), confirmed_after: insertVerticalSpaceAfterSchema.optional(), command_id: applyCommandIdSchema.optional() });
const echoPublished = z.record(z.string(), z.unknown()).describe("Copy of the plan's before / after, exactly as the plan returned it (use the plan's next_call).");
const describedPublic = {
    ...publicCommon,
    x_range: xRangeSchema.describe('[min_x, max_x] of the column, document points.'),
    cut_y: coordinate.describe('The cut, document y (up is positive): items whose box top is at or below it move.'),
    delta: deltaSchema.describe('Points: positive opens space (moves down), negative closes it (moves up).'),
    artboard_indexes: indexesSchema.describe('Artboards to move (below the cut) or extend (across it); [] for none.'),
};
const publishedPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...describedPublic, apply: z.literal(false).default(false) }),
    z.strictObject({ ...describedPublic, apply: z.literal(true), expected_before: echoPublished, confirmed_after: echoPublished, command_id: applyCommandIdSchema }),
]);
const { $schema: _schemaDialect, ...publishedSchema } = z.toJSONSchema(publishedPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedSchema });
function normalizePublicInput(input) {
    const v = insertVerticalSpacePublicInputSchema.parse(input);
    const base = { expectedDocumentKey: v.expected_document_key, xRange: v.x_range, cutY: v.cut_y, delta: v.delta, artboardIndexes: v.artboard_indexes };
    return v.apply ? { ...base, apply: true, expectedBefore: v.expected_before, confirmedAfter: v.confirmed_after, commandId: v.command_id } : { ...base, apply: false };
}
export const INSERT_VERTICAL_SPACE_BLOCKERS = ['document_mutation_not_allowed', 'layer_has_sublayers', 'nothing_to_move', 'items_blocked', 'space_not_empty', 'artboard_not_affected', 'artboard_crosses_x_range',
    'artboard_not_listed', 'artboard_collapse', 'artboard_overlap', 'unmeasured_ruler_origin'];
const blockerSchema = z.enum(INSERT_VERTICAL_SPACE_BLOCKERS);
const ADMITTED_PROFILES = ['saved_file', 'unsaved_document', 'dirty_file'];
export function insertVerticalSpaceExpectedBlockers(p, request) {
    const out = [];
    if (!p.documentBefore.mutationAllowed || !ADMITTED_PROFILES.includes(p.documentBefore.mutationProfile ?? ''))
        out.push('document_mutation_not_allowed');
    if (p.layerHasSublayers)
        out.push('layer_has_sublayers');
    if (p.before.moved.length === 0 && p.before.guides.length === 0 && p.blockedItems.length === 0)
        out.push('nothing_to_move');
    if (p.blockedItems.length > 0)
        out.push('items_blocked');
    if (p.bandObstacles.length > 0)
        out.push('space_not_empty');
    const boards = verticalSpaceBoards(p.before, request).blockers;
    for (const code of ['artboard_not_affected', 'artboard_crosses_x_range', 'artboard_not_listed', 'artboard_collapse', 'artboard_overlap'])
        if (boards.includes(code))
            out.push(code);
    if (!insertVerticalSpaceOriginIsImplicit(p.before))
        out.push('unmeasured_ruler_origin');
    return out;
}
const planSchema = z.strictObject({
    operation: z.literal(INSERT_VERTICAL_SPACE_OPERATION), profile: z.literal('vertical_space_v1'), documentKey: keySchema, documentBefore: documentContextSchema,
    xRange: xRangeSchema, cutY: coordinate, delta: deltaSchema, artboardIndexes: indexesSchema, before: insertVerticalSpaceBeforeSchema, after: insertVerticalSpaceAfterSchema,
    blockedItems: z.array(listedSchema).max(ARTBOARD_COPY_MAX_ROOTS), bandObstacles: z.array(obstacleSchema).max(MAX_LISTED), layerHasSublayers: z.boolean(),
    changesState: z.literal(true), applyBlockedReasonCodes: z.array(blockerSchema), applyBlockedMessage: z.string().min(1).max(500).optional(),
    confirmationStatus: z.enum(['required', 'confirmed']), applyAllowed: z.boolean(),
}).superRefine((p, ctx) => {
    const request = { xRange: p.xRange, cutY: p.cutY, delta: p.delta, artboardIndexes: p.artboardIndexes };
    if (p.documentKey !== p.documentBefore.key || p.documentBefore.artboardCount !== p.before.boards.length || p.documentBefore.activeArtboardIndex !== p.before.active
        || !same(readInt(p.documentBefore.activeArtboardBounds), p.before.boards[p.before.active]?.rect))
        ctx.addIssue({ code: 'custom', message: 'Plan must bind the native document context to its before collection.' });
    const geometry = { xRange: p.xRange, cutY: p.cutY };
    if (p.before.moved.some((m) => classifyItem(m.box, geometry) !== 'moved') || p.before.guides.some((g) => classifyGuide(g.geometry.visibleBounds, geometry) !== g.mode)) {
        ctx.addIssue({ code: 'custom', message: 'Every listed item and guide must classify as the plan says.' });
    }
    try {
        if (!same(deriveInsertVerticalSpaceAfter(p.before, request), p.after))
            throw new Error();
    }
    catch {
        ctx.addIssue({ code: 'custom', message: 'The after must be derived from the complete before and the request.' });
    }
    if (!same(insertVerticalSpaceExpectedBlockers(p, request), p.applyBlockedReasonCodes))
        ctx.addIssue({ code: 'custom', message: 'Plan must expose exactly the blockers of its evidence.' });
    if ((p.applyBlockedMessage === undefined) !== (p.applyBlockedReasonCodes.length === 0))
        ctx.addIssue({ code: 'custom', message: 'A blocked plan carries one message, an unblocked one none.' });
    if (p.applyAllowed !== (p.confirmationStatus === 'confirmed' && p.applyBlockedReasonCodes.length === 0))
        ctx.addIssue({ code: 'custom', message: 'Invalid admission flags.' });
});
const residualSchema = z.strictObject({ uuid: z.string().min(1).max(256), maxResidual: z.number().finite().nonnegative(), nonzeroResiduals: z.number().int().nonnegative() });
const postconditionSchema = z.strictObject({
    boards: z.array(boardSchema).min(1).max(ARTBOARD_MAX_COUNT), ...frame, artworkCount: z.number().int().nonnegative(),
    moved: z.array(residualSchema).max(ARTBOARD_COPY_MAX_ROOTS), guides: z.array(residualSchema).max(INSERT_VERTICAL_SPACE_MAX_GUIDES),
    geometryTolerance: z.literal(ARTBOARD_COPY_GEOMETRY_TOLERANCE), maxResidual: z.number().finite().nonnegative(),
});
const transactionSchema = artboardTransactionSchema(INSERT_VERTICAL_SPACE_OPERATION, { restoredSnapshot: insertVerticalSpaceBeforeSchema.nullable(), restoredMaxResidual: z.number().finite().nonnegative().nullable() }, { restoredSnapshot: null, restoredMaxResidual: null }, (v) => v.restoredSnapshot !== null && v.restoredMaxResidual !== null);
const scanMsSchema = z.array(z.number().int().nonnegative()).max(16).optional();
export const insertVerticalSpaceResultSchema = z.union([
    z.strictObject({ scanMs: scanMsSchema, operation: z.literal(INSERT_VERTICAL_SPACE_OPERATION), applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ scanMs: scanMsSchema, operation: z.literal(INSERT_VERTICAL_SPACE_OPERATION), applied: z.literal(true), document: documentContextSchema, plan: planSchema, postcondition: postconditionSchema, transaction: transactionSchema }),
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
        const p = r.postcondition, a = r.plan.after, before = r.plan.before;
        if (!same({ boards: p.boards, active: p.active, rulerOrigin: p.rulerOrigin, rulerUnits: p.rulerUnits, colorSpace: p.colorSpace }, { boards: a.boards, active: a.active, rulerOrigin: a.rulerOrigin, rulerUnits: a.rulerUnits, colorSpace: a.colorSpace }) || p.artworkCount !== before.artwork.count)
            ctx.addIssue({ code: 'custom', message: 'Verified result must match the complete planned after.' });
        if (p.moved.length !== before.moved.length || p.moved.some((m, i) => m.uuid !== before.moved[i].uuid) || p.guides.length !== before.guides.length || p.guides.some((g, i) => g.uuid !== before.guides[i].uuid)
            || p.maxResidual !== Math.max(0, ...p.moved.map((m) => m.maxResidual), ...p.guides.map((g) => g.maxResidual)) || p.maxResidual > ARTBOARD_COPY_GEOMETRY_TOLERANCE)
            ctx.addIssue({ code: 'custom', message: 'Every planned item and guide needs a residual within the geometry tolerance.' });
        if (r.document.artboardCount !== p.boards.length || r.document.activeArtboardIndex !== p.active)
            ctx.addIssue({ code: 'custom', message: 'Result document context must agree with the native postcondition.' });
    }
    if (r.transaction.state === 'rolled_back' && (!same(r.transaction.rollback.restoredSnapshot, r.plan.before) || (r.transaction.rollback.restoredMaxResidual ?? Infinity) > ARTBOARD_COPY_GEOMETRY_TOLERANCE))
        ctx.addIssue({ code: 'custom', message: 'Recovery must prove the complete baseline.' });
});
const responseSchema = z.strictObject({ outcome: insertVerticalSpaceResultSchema, delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }) });
export const INSERT_VERTICAL_SPACE_SAFETY = artboardSafetyRegistration(INSERT_VERTICAL_SPACE_OPERATION);
export const INSERT_VERTICAL_SPACE_SAFETY_IDENTITY = canonicalDigest(INSERT_VERTICAL_SPACE_SAFETY);
const assertSafety = artboardSafetyAsserter(INSERT_VERTICAL_SPACE_SAFETY, (value) => {
    const r = insertVerticalSpaceResultSchema.parse(value);
    return { operationId: INSERT_VERTICAL_SPACE_OPERATION, documentKey: r.plan.documentKey,
        identityToken: `artboard-update-v1:${canonicalDigest({ operation: INSERT_VERTICAL_SPACE_OPERATION, xRange: r.plan.xRange, cutY: r.plan.cutY, before: r.plan.before })}`,
        beforeState: { path: r.plan.documentBefore.path, fileRevision: r.plan.documentBefore.fileRevision, snapshot: r.plan.before }, afterState: r.plan.after,
        changeSet: { xRange: r.plan.xRange, cutY: r.plan.cutY, delta: r.plan.delta, artboardIndexes: r.plan.artboardIndexes, profile: r.plan.profile },
        blocked: r.plan.applyBlockedReasonCodes.length > 0, confirmationStatus: r.plan.confirmationStatus, applyAllowed: r.plan.applyAllowed,
        transactionState: r.transaction.state, applied: r.applied };
});
export const INSERT_VERTICAL_SPACE_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}${READ_PAGE_ITEM_AT_HELPER}${OBJECT_WITNESS_HELPERS}${OBJECT_WALK_HELPERS}${ARTBOARD_CONTENT_SIGNATURE_SCRIPT}
var scanStartedAt = 0, scanTotal = 0, scanVisited = 0, scanTicks = 0, ivScanMs = [];
var IV_MAX_BOARDS = ${ARTBOARD_MAX_COUNT}, IV_MAX_ROOTS = ${ARTBOARD_COPY_MAX_ROOTS}, IV_MAX_GUIDES = ${INSERT_VERTICAL_SPACE_MAX_GUIDES}, IV_MAX_LISTED = ${MAX_LISTED}, IV_MAX_TOP_ITEMS = 5000;
var IV_ADMITTED = ${JSON.stringify(ADMITTED_PROFILES)};
function ivFail(message) { throw mutationError("preflight_failed", message); }
// Numbers compare in the form the host prints them: ExtendScript's String(number) keeps 15 significant digits, so a
// plan read back from the output (expected_before, confirmed_after) equals a fresh read only at that precision.
function ivSame(a, b) {
  if (typeof a === "number" && typeof b === "number") return String(a) === String(b);
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if ((a instanceof Array) !== (b instanceof Array)) return false;
  var k, count = 0, other = 0;
  for (k in a) if (a.hasOwnProperty(k)) { count++; if (!b.hasOwnProperty(k) || !ivSame(a[k], b[k])) return false; }
  for (k in b) if (b.hasOwnProperty(k)) other++;
  return count === other;
}
function ivNumbers(value, length, integer, label) {
  if (!value || value.length !== length) ivFail("Geometry is unavailable at " + label + ".");
  var out = [], i, v, whole;
  for (i = 0; i < length; i++) {
    v = mutationFiniteNumber(value[i], label + "[" + i + "]");
    if (Math.abs(v) > 32768) ivFail("Geometry is beyond +/-32768 pt at " + label + ".");
    if (integer) {
      whole = Math.round(v);
      if (Math.abs(v - whole) > ${ARTBOARD_INTEGER_TOLERANCE}) ivFail("Geometry is outside the integer-point artboard profile: " + label + "[" + i + "] = " + v + ".");
      v = whole + 0;
    }
    out.push(v);
  }
  return out;
}
function ivImplicitOrigin(rect) { return [0 - rect[0], 0 - rect[3]]; }
function ivBoards(doc) {
  if (doc.documentColorSpace !== DocumentColorSpace.RGB) ivFail("Only RGB documents are supported.");
  if (doc.artboards.length < 1 || doc.artboards.length > IV_MAX_BOARDS) ivFail("Complete artboard collection exceeds the supported limit.");
  var boards = [], i, board, rect, par;
  for (i = 0; i < doc.artboards.length; i++) {
    board = doc.artboards[i]; rect = ivNumbers(board.artboardRect, 4, true, "artboard[" + i + "].rect");
    if (rect[0] >= rect[2] || rect[1] <= rect[3] || String(board.name).length > 1024) ivFail("Unsupported artboard state.");
    par = mutationFiniteNumber(board.rulerPAR, "artboard.rulerPAR");
    if (par < 0.1 || par > 10 || typeof board.showCenter !== "boolean" || typeof board.showCrossHairs !== "boolean" || typeof board.showSafeAreas !== "boolean") ivFail("Artboard presentation is unavailable.");
    boards.push({ index: i, name: String(board.name), rect: rect, rulerOrigin: ivNumbers(board.rulerOrigin, 2, true, "artboard[" + i + "].rulerOrigin"), presentation: [par, board.showCenter, board.showCrossHairs, board.showSafeAreas] });
  }
  var active = doc.artboards.getActiveArtboardIndex();
  if (typeof active !== "number" || active % 1 !== 0 || active < 0 || active >= boards.length) ivFail("Active artboard is unavailable.");
  return { boards: boards, active: active, rulerOrigin: ivNumbers(doc.rulerOrigin, 2, true, "document.rulerOrigin"), rulerUnits: String(doc.rulerUnits), colorSpace: "RGB" };
}
function ivAddLane(lanes, text) {
  var hashed = witnessText(text);
  lanes[0] = (lanes[0] + hashed[0]) >>> 0; lanes[1] = (lanes[1] + hashed[1]) >>> 0; lanes[2] = (lanes[2] + ((hashed[0] ^ hashed[1]) >>> 0)) >>> 0;
}
function ivLaneHex(lanes) { return witnessHex(lanes[0]) + witnessHex(lanes[1]) + witnessHex(lanes[2]); }
function ivTextHex(text) { var lanes = [0, 0, 0]; ivAddLane(lanes, text); return ivLaneHex(lanes); }
function ivBoundsText(uuid, bounds) {
  var text = uuid, i;
  for (i = 0; i < 4; i++) text += "|" + String(mutationFiniteNumber(bounds[i], "top-level geometricBounds"));
  return text;
}
// The whole-document witness: item count, the UUID set and the exact bounds of every top-level item the operation does not change.
function ivWitness(doc, changing) {
  params.deadlineMs = ${ARTBOARD_ARTWORK_SCAN_DEADLINE_MS};
  scanStartedAt = new Date().getTime(); scanTotal = doc.pageItems.length; scanVisited = 0; scanTicks = 0;
  if (scanTotal > ${ARTBOARD_ARTWORK_MAX_ITEMS}) ivFail("Artwork count " + scanTotal + " exceeds the ${ARTBOARD_ARTWORK_MAX_ITEMS}-item limit.");
  var lanes = [0, 0, 0], boundsLanes = [0, 0, 0], count = 0, untouched = 0, seen = {};
  try {
    walkDocumentTree(doc, function (item) {
      var uuid = item.uuid;
      if (typeof uuid !== "string" || uuid.length < 1 || uuid.length > 256 || seen["u:" + uuid]) ivFail("Complete native artwork identity is unavailable.");
      seen["u:" + uuid] = true; count++; ivAddLane(lanes, uuid);
      if (item.parent && item.parent.typename === "Layer" && !changing.hasOwnProperty("u:" + uuid)) { untouched++; ivAddLane(boundsLanes, ivBoundsText(uuid, item.geometricBounds)); }
    });
  } catch (walkError) {
    if (String(walkError && walkError.message).indexOf("READ_SCAN_DEADLINE") >= 0) ivFail("The artwork scan exceeded ${ARTBOARD_ARTWORK_SCAN_DEADLINE_MS} ms; no complete witness is available.");
    throw walkError;
  }
  if (scanVisited !== scanTotal || count !== scanTotal) ivFail("The artwork walk reached " + scanVisited + " of " + scanTotal + " page items, so the identity is incomplete.");
  ivScanMs.push(new Date().getTime() - scanStartedAt);
  return { count: count, witness: ivLaneHex(lanes), untouchedTopLevelCount: untouched, untouchedBoundsWitness: ivLaneHex(boundsLanes) };
}
function ivLayerOrders(doc) {
  var text = "", li, j, layer;
  for (li = 0; li < doc.layers.length; li++) {
    layer = doc.layers[li]; text += "#" + li;
    for (j = 0; j < layer.pageItems.length; j++) text += "|" + String(layer.pageItems[j].uuid);
  }
  return ivTextHex(text);
}
function ivUnion(boxes) {
  var out = [boxes[0][0], boxes[0][1], boxes[0][2], boxes[0][3]], i;
  for (i = 1; i < boxes.length; i++) { out[0] = Math.min(out[0], boxes[i][0]); out[1] = Math.max(out[1], boxes[i][1]); out[2] = Math.max(out[2], boxes[i][2]); out[3] = Math.min(out[3], boxes[i][3]); }
  return out;
}
// What a designer sees as the item's box: a clipping group is its mask, any other group the union of its children, anything else its visible bounds.
// A clipping group whose mask is a compound path (unmeasured) falls back to the union, which is larger, so it fails toward a refusal.
function ivBox(item, depth) {
  var type = String(item.typename), kids, boxes = [], i, child;
  if (depth > 8) ivFail("Items are nested deeper than 8 levels.");
  if (type !== "GroupItem") return ivNumbers(item.visibleBounds, 4, false, "visibleBounds");
  kids = item.pageItems;
  if (item.clipped === true) for (i = 0; i < kids.length; i++) { child = kids[i]; if (String(child.typename) === "PathItem" && child.clipping === true) return ivNumbers(child.visibleBounds, 4, false, "visibleBounds"); }
  for (i = 0; i < kids.length; i++) boxes.push(ivBox(kids[i], depth + 1));
  return boxes.length > 0 ? ivUnion(boxes) : ivNumbers(item.visibleBounds, 4, false, "visibleBounds");
}
function ivClassify(b, guide) {
  var minX = params.xRange[0], maxX = params.xRange[1], cut = params.cutY, inside;
  if (b[2] <= minX || b[0] >= maxX) return "untouched";
  inside = b[0] >= minX && b[2] <= maxX;
  if (b[1] <= cut) return inside ? (guide ? "move" : "moved") : "crosses_x_range";
  if (b[3] >= cut) return "untouched";
  if (!inside) return "crosses_x_range";
  return guide ? "stretch" : "crosses_cut";
}
// A guide rectangle: a closed PathItem of four corner points (directions on their anchors) on two x and two y values.
function ivGuideGeometry(item) {
  var points = [], xs = {}, ys = {}, nx = 0, ny = 0, i, p, a, l, r;
  if (item.closed !== true || item.pathPoints.length !== 4) return null;
  for (i = 0; i < 4; i++) {
    p = item.pathPoints[i];
    a = ivNumbers(p.anchor, 2, false, "anchor"); l = ivNumbers(p.leftDirection, 2, false, "leftDirection"); r = ivNumbers(p.rightDirection, 2, false, "rightDirection");
    if (l[0] !== a[0] || l[1] !== a[1] || r[0] !== a[0] || r[1] !== a[1]) return null;
    if (!xs.hasOwnProperty("x" + a[0])) { xs["x" + a[0]] = true; nx++; }
    if (!ys.hasOwnProperty("y" + a[1])) { ys["y" + a[1]] = true; ny++; }
    points.push([a[0], a[1], l[0], l[1], r[0], r[1]]);
  }
  if (nx !== 2 || ny !== 2) return null;
  return { points: points, geometricBounds: ivNumbers(item.geometricBounds, 4, false, "geometricBounds"), visibleBounds: ivNumbers(item.visibleBounds, 4, false, "visibleBounds"),
    controlBounds: ivNumbers(item.controlBounds, 4, false, "controlBounds"), position: ivNumbers(item.position, 2, false, "position") };
}
function ivGuideParts(item) { return ivTextHex(daSigText(daSignature(item))); }
function ivReasons(item, layer) {
  var reasons = [];
  if (item.locked === true) reasons.push("locked_item");
  if (item.hidden === true) reasons.push("hidden_item");
  if (layer.locked === true) reasons.push("locked_layer");
  if (layer.visible !== true) reasons.push("hidden_layer");
  return reasons;
}
function ivPush(list, entry, label) { if (list.length >= IV_MAX_LISTED) ivFail("More than " + IV_MAX_LISTED + " " + label + "."); list.push(entry); }
function ivScan(doc) {
  var moved = [], guides = [], blocked = [], band = [], movedItems = [], guideItems = [], changing = {}, nodes = 0, li, j, layer, item, type, b, cls, reasons, sig, geo, isGuide, top = 0, sublayers = false;
  var closing = params.delta < 0, bandTop = params.cutY - params.delta;
  for (li = 0; li < doc.layers.length; li++) {
    layer = doc.layers[li];
    // Sublayers are unmeasured: the plan is refused (layer_has_sublayers); their items are not scanned.
    if (layer.layers.length !== 0) sublayers = true;
    for (j = 0; j < layer.pageItems.length; j++) {
      if (++top > IV_MAX_TOP_ITEMS) ivFail("The document has more than " + IV_MAX_TOP_ITEMS + " top-level page items.");
      item = layer.pageItems[j]; type = String(item.typename);
      isGuide = type === "PathItem" && item.guides === true;
      b = ivBox(item, 0); cls = ivClassify(b, isGuide);
      if (cls === "untouched") {
        // Closing space: an unchanged item of the column whose bottom lies in the band the moved items will occupy.
        if (closing && b[2] > params.xRange[0] && b[0] < params.xRange[1] && b[3] >= params.cutY && b[3] < bandTop) ivPush(band, { uuid: String(item.uuid), type: type, name: String(item.name) }, "items in the band");
        continue;
      }
      reasons = ivReasons(item, layer);
      if (cls === "crosses_cut" || cls === "crosses_x_range") reasons.push(cls);
      if (reasons.length === 0 && isGuide) {
        geo = ivGuideGeometry(item);
        if (geo === null) reasons.push("guide_not_rectangle");
        else if (cls === "stretch" && geo.geometricBounds[1] - (geo.geometricBounds[3] - params.delta) < 0.001) reasons.push("guide_collapse");
      }
      sig = null;
      if (reasons.length === 0 && !isGuide) {
        sig = daSignature(item);
        if (sig.refusal !== null) reasons.push(sig.refusal);
        // The shared signature reads spot colours and gradients (#885); this operation measured RGB / Gray / no paint only (#674 P0), so it refuses the rest.
        // A text that merely contains these words is refused too: the safe side.
        else if (String(daSigText(sig)).indexOf("spot:") >= 0) reasons.push("unsupported_paint:SpotColor");
        else if (String(daSigText(sig)).indexOf("grad:") >= 0) reasons.push("unsupported_paint:GradientColor");
        else { nodes += sig.nodes; if (nodes > DA_MAX_NODES) ivFail("The items to move have more than " + DA_MAX_NODES + " page items."); }
      }
      if (reasons.length > 0) { if (blocked.length >= IV_MAX_ROOTS) ivFail("More than " + IV_MAX_ROOTS + " items block the change."); blocked.push({ uuid: String(item.uuid), type: type, name: String(item.name), reasons: reasons }); continue; }
      changing["u:" + String(item.uuid)] = true;
      if (isGuide) {
        if (guides.length >= IV_MAX_GUIDES) ivFail("More than " + IV_MAX_GUIDES + " guides change.");
        guides.push({ uuid: String(item.uuid), name: String(item.name), layer: li, order: j, mode: cls, parts: ivGuideParts(item), geometry: geo });
        guideItems.push(item);
      } else {
        if (moved.length >= IV_MAX_ROOTS) ivFail("More than " + IV_MAX_ROOTS + " top-level items move.");
        moved.push({ uuid: sig.uuids[0], type: type, name: String(item.name), layer: li, order: j, nodes: sig.nodes, digest: daDigest(sig), box: b });
        movedItems.push({ item: item, sig: sig });
      }
    }
  }
  return { moved: moved, guides: guides, blocked: blocked, band: band, movedItems: movedItems, guideItems: guideItems, changing: changing, sublayers: sublayers };
}
function ivOriginImplicit(s) {
  var i;
  for (i = 0; i < s.boards.length; i++) if (s.boards[i].rulerOrigin[0] !== 0 || s.boards[i].rulerOrigin[1] !== 0) return false;
  return ivSame(s.rulerOrigin, ivImplicitOrigin(s.boards[s.active].rect));
}
// The boards after the change and their blockers: the host mirror of verticalSpaceBoards (Node checks the plan with it).
function ivBoardChange(boards) {
  var dy = 0 - params.delta, rects = [], blockers = [], messages = [], listed = {}, i, index, r, t, kind, other;
  function kindOf(rect) {
    if (rect[0] < params.xRange[0] || rect[2] > params.xRange[1]) return (rect[2] <= params.xRange[0] || rect[0] >= params.xRange[1]) ? "not_affected" : "crosses_x_range";
    if (rect[1] <= params.cutY) return "move";
    if (rect[3] < params.cutY) return "stretch";
    return "not_affected";
  }
  function add(code, message) { var k; for (k = 0; k < blockers.length; k++) if (blockers[k] === code) { messages.push(message); return; } blockers.push(code); messages.push(message); }
  function touches(a, b) { return a[0] <= b[2] && a[2] >= b[0] && a[3] <= b[1] && a[1] >= b[3]; }
  for (i = 0; i < boards.length; i++) rects.push(boards[i].rect.slice(0));
  for (i = 0; i < params.artboardIndexes.length; i++) {
    index = params.artboardIndexes[i]; listed["i" + index] = true;
    if (index >= boards.length) { add("artboard_not_affected", "artboard " + index + " does not exist"); continue; }
    r = boards[index].rect; kind = kindOf(r);
    if (kind === "move") rects[index] = [r[0], r[1] + dy, r[2], r[3] + dy];
    else if (kind === "stretch") { rects[index] = [r[0], r[1], r[2], r[3] + dy]; if (rects[index][1] - rects[index][3] < 1) add("artboard_collapse", "artboard " + index + " would be shorter than 1 pt"); }
    else add(kind === "crosses_x_range" ? "artboard_crosses_x_range" : "artboard_not_affected", "artboard " + index + " is " + (kind === "crosses_x_range" ? "partly outside x_range" : "not below or across the cut inside x_range"));
  }
  for (i = 0; i < boards.length; i++) {
    if (listed.hasOwnProperty("i" + i)) continue;
    kind = kindOf(boards[i].rect);
    if (kind === "move" || kind === "stretch") add("artboard_not_listed", "artboard " + i + " lies below or across the cut inside x_range but is not listed");
  }
  for (i = 0; i < params.artboardIndexes.length; i++) {
    index = params.artboardIndexes[i]; if (index >= boards.length) continue;
    for (other = 0; other < rects.length; other++) if (other !== index && touches(rects[index], rects[other]) && !touches(boards[index].rect, boards[other].rect)) add("artboard_overlap", "artboard " + index + " would overlap or touch artboard " + other);
  }
  t = [];
  for (i = 0; i < boards.length; i++) t.push({ index: i, name: boards[i].name, rect: rects[i], rulerOrigin: boards[i].rulerOrigin, presentation: boards[i].presentation });
  return { boards: t, blockers: blockers, messages: messages };
}
function ivGuideAfter(geo, mode, dy) {
  var points = [], i, p, low;
  function shift(b, edge) { var out = b.slice(0); if (edge === "all") { out[1] += dy; out[3] += dy; } else out[3] += dy; return out; }
  for (i = 0; i < 4; i++) {
    p = geo.points[i]; low = mode === "move" || p[1] < params.cutY;
    points.push(low ? [p[0], p[1] + dy, p[2], p[3] + dy, p[4], p[5] + dy] : p.slice(0));
  }
  return { points: points, geometricBounds: shift(geo.geometricBounds, mode === "move" ? "all" : "bottom"), visibleBounds: shift(geo.visibleBounds, mode === "move" ? "all" : "bottom"),
    controlBounds: shift(geo.controlBounds, mode === "move" ? "all" : "bottom"), position: mode === "move" ? [geo.position[0], geo.position[1] + dy] : geo.position.slice(0) };
}
function ivBlockerOrder(found) {
  var order = ${JSON.stringify(INSERT_VERTICAL_SPACE_BLOCKERS)}, out = [], i, j;
  for (i = 0; i < order.length; i++) for (j = 0; j < found.length; j++) if (found[j] === order[i]) { out.push(order[i]); break; }
  return out;
}
function ivResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var doc = app.activeDocument, dy = 0 - params.delta, i, admitted = false;
  var snapshot = ivBoards(doc);
  if (!ivSame(snapshot.rulerOrigin, ivNumbers(doc.rulerOrigin, 2, true, "document.rulerOrigin"))) ivFail("document.rulerOrigin changed while reading.");
  var scan = ivScan(doc), witness = ivWitness(doc, scan.changing);
  witness.layerOrders = ivLayerOrders(doc);
  var before = { boards: snapshot.boards, active: snapshot.active, rulerOrigin: snapshot.rulerOrigin, rulerUnits: snapshot.rulerUnits, colorSpace: "RGB", moved: scan.moved, guides: scan.guides, artwork: witness };
  var change = ivBoardChange(snapshot.boards), guidesAfter = [];
  for (i = 0; i < scan.guides.length; i++) guidesAfter.push({ uuid: scan.guides[i].uuid, geometry: ivGuideAfter(scan.guides[i].geometry, scan.guides[i].mode, dy) });
  var after = { boards: change.boards, active: snapshot.active, rulerOrigin: ivImplicitOrigin(change.boards[snapshot.active].rect), rulerUnits: snapshot.rulerUnits, colorSpace: "RGB", dy: dy, guides: guidesAfter };
  var found = [], messages = [];
  for (i = 0; i < IV_ADMITTED.length; i++) if (context.mutationProfile === IV_ADMITTED[i]) admitted = true;
  if (!context.mutationAllowed || !admitted) found.push("document_mutation_not_allowed");
  if (scan.sublayers) { found.push("layer_has_sublayers"); messages.push("a layer has sublayers, which this operation has not measured"); }
  if (scan.moved.length === 0 && scan.guides.length === 0 && scan.blocked.length === 0) found.push("nothing_to_move");
  if (scan.blocked.length > 0) { found.push("items_blocked"); messages.push(scan.blocked.length + " item(s) cannot move: " + scan.blocked[0].name + " (" + scan.blocked[0].reasons.join(", ") + ")"); }
  if (scan.band.length > 0) { found.push("space_not_empty"); messages.push("closing " + params.delta + " pt would overlap " + scan.band[0].name); }
  for (i = 0; i < change.blockers.length; i++) found.push(change.blockers[i]);
  for (i = 0; i < change.messages.length; i++) messages.push(change.messages[i]);
  if (!ivOriginImplicit(before)) { found.push("unmeasured_ruler_origin"); messages.push("the ruler origins are not the measured implicit ones"); }
  var blockers = ivBlockerOrder(found), message = null;
  if (blockers.length > 0) { message = messages.join("; "); if (message.length > 500) message = message.substring(0, 497) + "..."; if (message.length === 0) message = "The change is blocked: " + blockers.join(", ") + "."; }
  if ((stringifyJson(before).length + stringifyJson(after).length) * 3 > ${SNAPSHOT_RESULT_ADMISSION_BYTES}) ivFail("The plan would exceed the result size limit (result_too_large); move fewer items at once.");
  if (forApply) {
    if (!ivSame(before, params.expectedBefore)) ivFail("expected_before does not match the complete artboard and item state.");
    if (!ivSame(after, params.confirmedAfter)) ivFail("confirmed_after does not match the derived plan.");
    if (blockers.length > 0) ivFail(message);
  }
  return { context: context, document: doc, before: before, after: after, blockers: blockers, message: message, blocked: scan.blocked, band: scan.band, sublayers: scan.sublayers,
    movedItems: scan.movedItems, guideItems: scan.guideItems, changing: scan.changing };
}
function ivPlan(p) {
  var plan = { operation: "insert_vertical_space", profile: "vertical_space_v1", documentKey: p.context.key, documentBefore: p.context, xRange: params.xRange, cutY: params.cutY, delta: params.delta,
    artboardIndexes: params.artboardIndexes, before: p.before, after: p.after, blockedItems: p.blocked, bandObstacles: p.band, layerHasSublayers: p.sublayers, changesState: true, applyBlockedReasonCodes: p.blockers };
  if (p.message !== null) plan.applyBlockedMessage = p.message;
  plan.confirmationStatus = params.apply === true ? "confirmed" : "required";
  plan.applyAllowed = params.apply === true && p.blockers.length === 0;
  return plan;
}
// The preflight of this same call has just read and proved the complete before (signatures and witness included); nothing runs between it and
// the apply, so the revalidation re-reads the cheap parts only (document, boards, origin, identities, item count) and keeps the apply at two
// signature passes (preflight and verify).
function ivRevalidate(p) {
  try {
    var frame, i;
    if (app.documents.length === 0 || app.activeDocument !== p.document) ivFail("Document reference changed before apply.");
    frame = ivBoards(p.document);
    if (!ivSame(frame, { boards: p.before.boards, active: p.before.active, rulerOrigin: p.before.rulerOrigin, rulerUnits: p.before.rulerUnits, colorSpace: "RGB" })) ivFail("The artboards changed before apply.");
    if (p.document.pageItems.length !== p.before.artwork.count) ivFail("The item count changed before apply.");
    for (i = 0; i < p.movedItems.length; i++) if (p.movedItems[i].item.uuid !== p.before.moved[i].uuid) ivFail("An item identity changed before apply.");
    for (i = 0; i < p.guideItems.length; i++) if (p.guideItems[i].uuid !== p.before.guides[i].uuid) ivFail("A guide identity changed before apply.");
  } catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "The items or the artboards changed before apply.")); }
}
function ivBoardOrder(p) {
  var order = [], i, dy = p.after.dy;
  for (i = 0; i < p.before.boards.length; i++) if (!ivSame(p.before.boards[i].rect, p.after.boards[i].rect)) order.push(i);
  order.sort(function (a, b) { return dy < 0 ? p.before.boards[a].rect[3] - p.before.boards[b].rect[3] : p.before.boards[b].rect[1] - p.before.boards[a].rect[1]; });
  return order;
}
function ivSetGuide(item, geometry) {
  var i, point;
  for (i = 0; i < 4; i++) {
    point = item.pathPoints[i];
    point.anchor = [geometry.points[i][0], geometry.points[i][1]];
    point.leftDirection = [geometry.points[i][2], geometry.points[i][3]];
    point.rightDirection = [geometry.points[i][4], geometry.points[i][5]];
  }
}
function ivApply(p, plan, state) {
  var dy = p.after.dy, i, order = ivBoardOrder(p), attempted = state.operationState.attempted;
  state.operationState.mutationStarted = true;
  for (i = 0; i < p.movedItems.length; i++) {
    attempted.push({ kind: "root", index: i });
    try { p.movedItems[i].item.translate(0, dy, true, false, false, false); } catch (error) { mutationNativeFailure("translate", error); }
  }
  for (i = 0; i < p.guideItems.length; i++) {
    attempted.push({ kind: "guide", index: i });
    try {
      if (p.before.guides[i].mode === "move") p.guideItems[i].translate(0, dy, true, false, false, false);
      else ivSetGuide(p.guideItems[i], p.after.guides[i].geometry);
    } catch (error) { mutationNativeFailure("guide", error); }
  }
  for (i = 0; i < order.length; i++) {
    attempted.push({ kind: "board", index: order[i] });
    try { p.document.artboards[order[i]].artboardRect = p.after.boards[order[i]].rect; } catch (error) { mutationNativeFailure("Artboard.artboardRect", error); }
  }
}
function ivRead(p) {
  if (app.documents.length === 0 || app.activeDocument !== p.document) ivFail("Document reference changed.");
  var current = getDocumentContext();
  if (current.path !== p.context.path || current.fileRevision !== p.context.fileRevision || current.name !== p.context.name || current.appVersion !== p.context.appVersion) ivFail("The document file identity changed after apply.");
  return ivBoards(p.document);
}
// One guide's geometry against an expected one: the largest residual, or -1 when a value is missing.
function ivGuideResidual(item, expected) {
  var now = ivGuideGeometry(item), worst = 0, k, i;
  if (now === null || item.guides !== true) return -1;
  function cmp(a, b) { var j, r; for (j = 0; j < a.length; j++) { r = Math.abs(a[j] - b[j]); if (r > worst) worst = r; } }
  for (i = 0; i < 4; i++) cmp(now.points[i], expected.points[i]);
  for (k in { geometricBounds: 1, visibleBounds: 1, controlBounds: 1, position: 1 }) cmp(now[k], expected[k]);
  return worst;
}
function ivVerify(p, plan, state) {
  var boards = ivRead(p), a = p.after, i, entry, now, cmp, moved = [], guides = [], maxResidual = 0, residual;
  if (!ivSame(boards, { boards: a.boards, active: a.active, rulerOrigin: a.rulerOrigin, rulerUnits: a.rulerUnits, colorSpace: a.colorSpace })) throw mutationError("verify_mismatch", "Artboards read back differ from the planned after.");
  for (i = 0; i < p.movedItems.length; i++) {
    entry = p.movedItems[i];
    if (entry.item.uuid !== p.before.moved[i].uuid) throw mutationError("verify_mismatch", "An item identity changed: " + p.before.moved[i].name + ".");
    now = daSignature(entry.item);
    if (now.refusal !== null || now.nodes !== entry.sig.nodes) throw mutationError("verify_mismatch", "An item changed its structure: " + p.before.moved[i].name + ".");
    cmp = daCompareCopy(entry.sig, now, 0, a.dy);
    if (!cmp.ok) throw mutationError("verify_mismatch", "An item did not move as planned (" + cmp.reason + "): " + p.before.moved[i].name + ".");
    moved.push({ uuid: p.before.moved[i].uuid, maxResidual: cmp.maxResidual, nonzeroResiduals: cmp.nonzero });
    if (cmp.maxResidual > maxResidual) maxResidual = cmp.maxResidual;
  }
  for (i = 0; i < p.guideItems.length; i++) {
    if (p.guideItems[i].uuid !== p.before.guides[i].uuid || ivGuideParts(p.guideItems[i]) !== p.before.guides[i].parts) throw mutationError("verify_mismatch", "A guide changed beyond its geometry: " + p.before.guides[i].name + ".");
    residual = ivGuideResidual(p.guideItems[i], a.guides[i].geometry);
    if (residual < 0 || residual > DA_TOLERANCE) throw mutationError("verify_mismatch", "A guide did not change as planned: " + p.before.guides[i].name + ".");
    guides.push({ uuid: p.before.guides[i].uuid, maxResidual: residual, nonzeroResiduals: residual > 0 ? 1 : 0 });
    if (residual > maxResidual) maxResidual = residual;
  }
  var w = ivWitness(p.document, p.changing);
  if (w.count !== p.before.artwork.count || w.witness !== p.before.artwork.witness || w.untouchedTopLevelCount !== p.before.artwork.untouchedTopLevelCount
    || w.untouchedBoundsWitness !== p.before.artwork.untouchedBoundsWitness || ivLayerOrders(p.document) !== p.before.artwork.layerOrders) throw mutationError("verify_mismatch", "An item outside the change, or the stacking order, changed.");
  return { boards: boards.boards, active: boards.active, rulerOrigin: boards.rulerOrigin, rulerUnits: boards.rulerUnits, colorSpace: "RGB", artworkCount: w.count,
    moved: moved, guides: guides, geometryTolerance: DA_TOLERANCE, maxResidual: maxResidual };
}
// The complete baseline: boards exact, every moved item and guide back within the tolerance, the witness and the layer orders exact. Returns the residual or -1.
function ivBaseline(p) {
  var boards = ivRead(p), i, cmp, residual, worst = 0;
  if (!ivSame(boards, { boards: p.before.boards, active: p.before.active, rulerOrigin: p.before.rulerOrigin, rulerUnits: p.before.rulerUnits, colorSpace: "RGB" })) return -1;
  for (i = 0; i < p.movedItems.length; i++) {
    if (p.movedItems[i].item.uuid !== p.before.moved[i].uuid) return -1;
    cmp = daCompareCopy(p.movedItems[i].sig, daSignature(p.movedItems[i].item), 0, 0);
    if (!cmp.ok) return -1;
    if (cmp.maxResidual > worst) worst = cmp.maxResidual;
  }
  for (i = 0; i < p.guideItems.length; i++) {
    if (ivGuideParts(p.guideItems[i]) !== p.before.guides[i].parts) return -1;
    residual = ivGuideResidual(p.guideItems[i], p.before.guides[i].geometry);
    if (residual < 0 || residual > DA_TOLERANCE) return -1;
    if (residual > worst) worst = residual;
  }
  var w = ivWitness(p.document, p.changing);
  if (w.count !== p.before.artwork.count || w.witness !== p.before.artwork.witness || w.untouchedBoundsWitness !== p.before.artwork.untouchedBoundsWitness || ivLayerOrders(p.document) !== p.before.artwork.layerOrders) return -1;
  return worst;
}
function ivRollback(state) {
  var p = state.preflight, attempted = state.operationState.attempted, i, step, dy, cmp, residual;
  try {
    if (app.documents.length === 0 || app.activeDocument !== p.document) return { status: "indeterminate", message: "Rollback document is indeterminate." };
    dy = p.after.dy;
    residual = ivBaseline(p);
    if (residual < 0) {
      for (i = attempted.length - 1; i >= 0; i--) {
        step = attempted[i];
        if (step.kind === "board") p.document.artboards[step.index].artboardRect = p.before.boards[step.index].rect;
        else if (step.kind === "guide") {
          if (p.before.guides[step.index].mode === "stretch") ivSetGuide(p.guideItems[step.index], p.before.guides[step.index].geometry);
          else if (ivGuideResidual(p.guideItems[step.index], p.after.guides[step.index].geometry) >= 0 && ivGuideResidual(p.guideItems[step.index], p.after.guides[step.index].geometry) <= DA_TOLERANCE) p.guideItems[step.index].translate(0, 0 - dy, true, false, false, false);
          else if (!(ivGuideResidual(p.guideItems[step.index], p.before.guides[step.index].geometry) >= 0 && ivGuideResidual(p.guideItems[step.index], p.before.guides[step.index].geometry) <= DA_TOLERANCE)) return { status: "indeterminate", message: "Rollback refused because a guide is neither before nor after." };
        } else {
          cmp = daCompareCopy(p.movedItems[step.index].sig, daSignature(p.movedItems[step.index].item), 0, dy);
          if (cmp.ok) p.movedItems[step.index].item.translate(0, 0 - dy, true, false, false, false);
          else if (!daCompareCopy(p.movedItems[step.index].sig, daSignature(p.movedItems[step.index].item), 0, 0).ok) return { status: "indeterminate", message: "Rollback refused because an item is neither before nor after: " + p.before.moved[step.index].name + "." };
        }
      }
      residual = ivBaseline(p);
    }
    if (residual < 0) return { status: "indeterminate", message: "Rollback did not restore the complete baseline." };
    state.operationState.rollbackEvidence.restoredSnapshot = p.before;
    state.operationState.rollbackEvidence.restoredMaxResidual = residual;
    return { status: "verified" };
  } catch (error) { return { status: "indeterminate", message: "Rollback could not prove the complete baseline." }; }
}
var ivExecution = runMutationTransaction({
  apply: params.apply === true,
  initialOperationState: function () { return { mutationStarted: false, attempted: [], rollbackEvidence: { restoredSnapshot: null, restoredMaxResidual: null } }; },
  preflight: ivResolve, plan: ivPlan, revalidate: ivRevalidate, applyMutation: ivApply, verify: ivVerify, rollback: ivRollback,
  hasMutationEvidence: function (s) { return s.operationState.mutationStarted === true; },
  applyIndeterminate: function () { return { reasonCode: "artboard_state_unknown", message: "Vertical space outcome is indeterminate.", evidence: { restoredSnapshot: null, restoredMaxResidual: null } }; },
  rollbackEvidence: function (s) { return s.operationState.rollbackEvidence; }
});
var ivDocument = ivExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === ivExecution.preflight.document) ivDocument = getDocumentContext();
var result = { operation: "insert_vertical_space", applied: ivExecution.transaction.state === "verified", document: ivDocument, plan: ivExecution.plan, transaction: ivExecution.transaction };
if (result.applied) result.postcondition = ivExecution.value;
if (ivScanMs.length > 0) result.scanMs = ivScanMs;
`;
export const INSERT_VERTICAL_SPACE_HOST_SCRIPT_DIGEST = canonicalSha256(INSERT_VERTICAL_SPACE_SCRIPT);
export const INSERT_VERTICAL_SPACE_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: INSERT_VERTICAL_SPACE_OPERATION, validator: INSERT_VERTICAL_SPACE_VALIDATOR,
    canonicalContractVersion: 1, resultSchemaVersion: 1, terminalClassifierVersion: 1, safetyConformanceVersion: 1, errorMappingVersion: 1,
    safetyIdentity: INSERT_VERTICAL_SPACE_SAFETY_IDENTITY, hostScriptDigest: INSERT_VERTICAL_SPACE_HOST_SCRIPT_DIGEST, mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalSchema.parse(input);
    const { commandId: _commandId, ...bound } = request;
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: request.apply ? request.commandId : null, documentKey: request.expectedDocumentKey,
        digest: canonicalSha256({ operation: INSERT_VERTICAL_SPACE_OPERATION, validator: INSERT_VERTICAL_SPACE_VALIDATOR, request: bound }) };
}
export const insertVerticalSpaceToolContract = {
    name: 'illustrator_insert_vertical_space', title: 'Plan or Insert / Remove Vertical Space in a Column',
    description: 'Open or close vertical space in one column of a tall layout: every top-level item below cut_y inside x_range moves by delta (positive moves down), guide rectangles across the cut stretch, and the listed artboards move or extend. Plan lists what moves and refusals (items across the cut or the column edge, locked, hidden, unlisted boards, a busy band when closing); apply verifies every attribute (geometry within 2^-10 pt) and that nothing else changed. RGB, Illustrator frontmost.',
    inputSchema, publicInputSchema: insertVerticalSpacePublicInputSchema, outputSchema: responseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(INSERT_VERTICAL_SPACE_SAFETY.policy), normalizePublicInput,
};
export function createInsertVerticalSpaceAdapter() {
    return {
        version: 1, operation: INSERT_VERTICAL_SPACE_OPERATION, validator: INSERT_VERTICAL_SPACE_VALIDATOR,
        safety: INSERT_VERTICAL_SPACE_SAFETY, safetyRegistrationIdentity: INSERT_VERTICAL_SPACE_SAFETY_IDENTITY, adapterIdentity: INSERT_VERTICAL_SPACE_ADAPTER_IDENTITY,
        tool: insertVerticalSpaceToolContract, canonical: { version: 1, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: insertVerticalSpaceResultSchema, resultSchemaVersion: 1, terminalClassifierVersion: 1, safetyConformanceVersion: 1, errorMappingVersion: 1,
        hostScriptDigest: INSERT_VERTICAL_SPACE_HOST_SCRIPT_DIGEST, mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const n = normalizedRequest(input), { commandId: _commandId, ...params } = n.request;
            if (n.intent === 'plan')
                return { kind: 'read', script: INSERT_VERTICAL_SPACE_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: INSERT_VERTICAL_SPACE_VALIDATOR, idempotency: { commandId: n.commandId, operation: INSERT_VERTICAL_SPACE_OPERATION, documentKey: n.documentKey, requestDigest: n.digest },
                adapterIdentity: INSERT_VERTICAL_SPACE_ADAPTER_IDENTITY, mutationHostApplicationMode: 'foreground', script: INSERT_VERTICAL_SPACE_SCRIPT, params };
        },
        classifyTerminal(value) { return classifyArtboardTerminal(insertVerticalSpaceResultSchema.parse(value).transaction.state, 'Vertical space'); },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error) { return error instanceof Error ? error : new Error(String(error)); },
    };
}
