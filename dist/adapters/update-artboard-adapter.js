import { hostVersionPublicFields, hostVersionInternalFields, normalizeHostVersionConsent } from '../host-version-consent.js';
import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema } from '../mutation-result-schema-core.js';
import { canonicalDigest, operationSafetyPolicyToMcpAnnotations } from '../operation-safety-policy-core.js';
import { SUPPORTED_PATH_ITEM_MAX_PATH_POINTS, SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS } from './supported-path-item-host-script.js';
import { artboardSafetyAsserter, artboardSafetyRegistration, artboardTransactionSchema, classifyArtboardTerminal } from './artboard-update-safety.js';
import { RASTER_MAX_SIDE_PX, RASTER_MAX_TOTAL_PX } from '../raster-export.js';
import { HOST_VERSION_POLICY_JSX, hostVersionAdmitted } from '../host-version-policy.js';
import { OBJECT_WALK_HELPERS, OBJECT_WITNESS_HELPERS, READ_PAGE_ITEM_AT_HELPER } from '../page-item-walk.js';
import { PAGE_ITEM_RESOLVE_DEADLINE_MS } from '../page-item-resolve.js';
import { LAYER_TOP_LEVEL_ITEMS_HELPER } from '../layer-top-level-items.js';
import { ARTBOARD_INTEGER_TOLERANCE, readIntegerWithinTolerance } from '../artboard-integer.js';
export const UPDATE_ARTBOARD_OPERATION = 'update_artboard';
export const UPDATE_ARTBOARD_VALIDATOR = { kind: UPDATE_ARTBOARD_OPERATION, version: 1 };
export const ARTBOARD_MAX_COUNT = 256;
export const ARTBOARD_MAX_ITEMS = SUPPORTED_PATH_ITEM_MAX_PARENT_ITEMS;
export const ARTBOARD_MAX_POINTS = SUPPORTED_PATH_ITEM_MAX_PATH_POINTS;
export const ARTBOARD_IDENTITY_MAX_ITEMS = 100_000;
export const ARTBOARD_ARTWORK_MAX_ITEMS = 20_778;
export const ARTBOARD_ARTWORK_SCAN_DEADLINE_MS = 3_000;
export { ARTBOARD_INTEGER_TOLERANCE };
const keySchema = z.string().min(1).max(16_384);
const coordinate = z.number().finite().min(-32_768).max(32_768);
const pair = z.tuple([coordinate, coordinate]);
const rect = z.tuple([coordinate, coordinate, coordinate, coordinate]).superRefine((r, ctx) => { if (r[0] >= r[2] || r[1] <= r[3])
    ctx.addIssue({ code: 'custom', message: 'Rect must have positive width and height.' }); });
const integerRect = rect.superRefine((r, ctx) => { if (!r.every(Number.isInteger))
    ctx.addIssue({ code: 'custom', message: 'Only integer-point rects are supported.' }); });
const nameSchema = z.string().min(1).max(255).superRefine((v, ctx) => { if (v !== v.trim() || /[\u0000-\u001f\u007f]/u.test(v))
    ctx.addIssue({ code: 'custom', message: 'Names must not be padded or contain control characters.' }); });
const presentationSchema = z.tuple([z.number().finite().min(0.1).max(10), z.boolean(), z.boolean(), z.boolean()]);
const boardSchema = z.strictObject({ presentation: presentationSchema.optional(), index: z.number().int().nonnegative(), name: z.string().max(1024), rect: integerRect, rulerOrigin: pair });
const pointSchema = z.strictObject({ anchor: pair, left: pair, right: pair });
const artworkSchema = z.strictObject({ uuid: z.string().min(1).max(256), bounds: z.tuple([coordinate, coordinate, coordinate, coordinate]), closed: z.boolean(), points: z.array(pointSchema).min(1).max(ARTBOARD_MAX_POINTS) });
const snapshotBase = {
    boards: z.array(boardSchema).min(1).max(ARTBOARD_MAX_COUNT), active: z.number().int().nonnegative(),
    rulerOrigin: pair, rulerUnits: z.string().min(1).max(128), colorSpace: z.literal('RGB'),
};
const checkSnapshotBase = (s, ctx) => {
    if (s.active >= s.boards.length || s.boards.some((b, i) => b.index !== i))
        ctx.addIssue({ code: 'custom', message: 'The full ordered collection must bind its ordinal and active index.' });
    if (![...s.rulerOrigin, ...s.boards.flatMap((b) => b.rulerOrigin)].every(Number.isInteger))
        ctx.addIssue({ code: 'custom', message: 'Fractional ruler origins are unsupported.' });
};
const artworkIdentitySchema = z.strictObject({ count: z.number().int().nonnegative().max(ARTBOARD_IDENTITY_MAX_ITEMS), witness: z.string().regex(/^[0-9a-f]{24}$/u),
    topLevelCount: z.number().int().nonnegative().optional(), topLevelBoundsWitness: z.string().regex(/^[0-9a-f]{24}$/u).optional() });
export const artboardSnapshotSchema = z.strictObject({ ...snapshotBase, artwork: z.union([z.array(artworkSchema).max(ARTBOARD_MAX_ITEMS), artworkIdentitySchema]) }).superRefine((s, ctx) => {
    checkSnapshotBase(s, ctx);
    const mixed = !Array.isArray(s.artwork) && s.artwork.topLevelBoundsWitness !== undefined;
    if (s.boards.some((b) => (b.presentation !== undefined) !== mixed) || (!Array.isArray(s.artwork) && ((s.artwork.topLevelCount !== undefined) !== mixed || (mixed && (s.artwork.count > ARTBOARD_ARTWORK_MAX_ITEMS || s.artwork.topLevelCount > s.artwork.count)))))
        ctx.addIssue({ code: 'custom', message: 'Mixed artwork binds every board presentation and a bounded top-level collection.' });
    if (Array.isArray(s.artwork) && (new Set(s.artwork.map((a) => a.uuid)).size !== s.artwork.length || s.artwork.reduce((n, a) => n + a.points.length, 0) > ARTBOARD_MAX_POINTS))
        ctx.addIssue({ code: 'custom', message: 'Artwork must have unique native UUIDs and a complete bounded point collection.' });
});
const renameEntrySchema = z.strictObject({ artboard_index: z.number().int().min(0).max(ARTBOARD_MAX_COUNT - 1), name: nameSchema });
const renamesSchema = z.array(renameEntrySchema).min(1).max(ARTBOARD_MAX_COUNT)
    .superRefine((entries, ctx) => { if (new Set(entries.map((e) => e.artboard_index)).size !== entries.length)
    ctx.addIssue({ code: 'custom', message: 'Each artboard_index may appear only once in renames.' }); });
const rectEntrySchema = z.strictObject({ artboard_index: renameEntrySchema.shape.artboard_index, rect: integerRect });
const rectsSchema = z.array(rectEntrySchema).min(1).max(ARTBOARD_MAX_COUNT)
    .superRefine((entries, ctx) => { if (new Set(entries.map((e) => e.artboard_index)).size !== entries.length)
    ctx.addIssue({ code: 'custom', message: 'Each artboard_index may appear only once in rects.' }); });
const addEntrySchema = z.strictObject({ name: nameSchema, rect: integerRect });
export const artboardChangeSchema = z.union([
    z.strictObject({ name: nameSchema }), z.strictObject({ rect: integerRect }),
    z.strictObject({ active: z.literal(true) }), z.strictObject({ add: addEntrySchema }),
    z.strictObject({ renames: renamesSchema }), z.strictObject({ rects: rectsSchema }), z.strictObject({ adds: z.array(addEntrySchema).min(1).max(ARTBOARD_MAX_COUNT) }),
]);
const changeProperties = Object.assign({}, ...artboardChangeSchema.options.map((option) => z.toJSONSchema(option, { io: 'input' }).properties));
artboardChangeSchema._zod.toJSONSchema = () => ({ type: 'object', properties: changeProperties, additionalProperties: false, minProperties: 1, maxProperties: 1 });
const same = (a, b) => canonicalSha256(a) === canonicalSha256(b);
const sameActiveBounds = (native, snapshotRect) => same(native.map(readIntegerWithinTolerance), snapshotRect);
const activeBoundsMessage = (where, active, native, snapshotRect) => `Invariant active_bounds_bind: ${where}.activeArtboardBounds [${native.join(', ')}] (read as [${native.map(readIntegerWithinTolerance).join(', ')}]) differs from artboard ${active} rect [${snapshotRect?.join(', ') ?? 'missing'}].`;
const implicitOrigin = (rect) => [0 - rect[0], 0 - rect[3]];
export function artboardOriginIsImplicit(s) {
    return s.boards.every((b) => b.rulerOrigin[0] === 0 && b.rulerOrigin[1] === 0) && same(s.rulerOrigin, implicitOrigin(s.boards[s.active].rect));
}
export function artboardOriginBlocked(before, index, change) {
    const movesOrigin = 'add' in change || 'adds' in change || ('rects' in change && change.rects.some((e) => e.artboard_index === before.active)) || ('active' in change && index !== before.active) || ('rect' in change && index === before.active);
    return movesOrigin && !artboardOriginIsImplicit(before);
}
function artboardAddOverlapIndex(before, change) {
    const entries = 'adds' in change ? change.adds : 'add' in change ? [change.add] : [];
    const boards = before.boards.map((b) => ({ index: b.index, rect: b.rect }));
    for (const entry of entries) {
        const proposed = entry.rect;
        for (const board of boards) {
            const r = board.rect;
            if (proposed[0] <= r[2] && proposed[2] >= r[0] && proposed[3] <= r[1] && proposed[1] >= r[3])
                return board.index;
        }
        boards.push({ index: boards.length, rect: proposed });
    }
    return null;
}
const artboardOverlapMessage = (index) => `Requested rect overlaps or touches artboard ${index}. Place it with a gap from every other artboard.`;
export function deriveArtboardAfter(before, index, change) {
    if ('rects' in change || 'adds' in change) {
        if (index !== undefined)
            throw new Error('Batch changes must carry no artboard index.');
        let after = before;
        if ('rects' in change) {
            if (new Set(change.rects.map((e) => e.artboard_index)).size !== change.rects.length)
                throw new Error('Each artboard_index may appear only once in rects.');
            for (const entry of change.rects)
                after = deriveArtboardAfter(after, entry.artboard_index, { rect: entry.rect });
        }
        else
            for (const entry of change.adds)
                after = deriveArtboardAfter(after, after.boards.length, { add: entry });
        return after;
    }
    if ('renames' in change) {
        if (index !== undefined || new Set(change.renames.map((e) => e.artboard_index)).size !== change.renames.length || change.renames.some((e) => e.artboard_index >= before.boards.length))
            throw new Error('Renames must name each existing artboard once and carry no artboard index.');
        const names = new Map(change.renames.map((e) => [e.artboard_index, e.name]));
        return { ...before, boards: before.boards.map((b, i) => names.has(i) ? { ...b, name: names.get(i) } : b) };
    }
    if (index === undefined)
        throw new Error('An artboard index is required for this change.');
    if ('add' in change) {
        if (index !== before.boards.length)
            throw new Error('An added artboard must use the next ordinal.');
        if (before.boards.length >= ARTBOARD_MAX_COUNT)
            throw new Error('Complete artboard collection exceeds the supported limit.');
        return { ...before, boards: [...before.boards, { index, name: change.add.name, rect: change.add.rect, rulerOrigin: [0, 0],
                    ...(before.boards[0].presentation === undefined ? {} : { presentation: [1, false, false, false] }) }], active: index, rulerOrigin: implicitOrigin(change.add.rect) };
    }
    if (!Number.isInteger(index) || index < 0 || index >= before.boards.length)
        throw new Error('Artboard index is outside the complete collection.');
    if ('active' in change)
        return index === before.active ? before : { ...before, active: index, rulerOrigin: implicitOrigin(before.boards[index].rect) };
    if ('rect' in change && index === before.active)
        return { ...before, boards: before.boards.map((b, i) => i === index ? { ...b, rect: change.rect } : b), rulerOrigin: implicitOrigin(change.rect) };
    return { ...before, boards: before.boards.map((b, i) => i === index ? { ...b, ...change } : b) };
}
const pixelSide = z.number().int().min(1).max(RASTER_MAX_SIDE_PX);
export const artboardPixelSchema = z.strictObject({ width: pixelSide, height: pixelSide, scale: z.number().int().min(1).max(2) })
    .superRefine((v, ctx) => { if (v.width * v.height > RASTER_MAX_TOTAL_PX)
    ctx.addIssue({ code: 'custom', message: `pixel must not exceed ${RASTER_MAX_TOTAL_PX} pixels in total.` }); });
const pixelChangeRule = (v, ctx) => {
    if (v.pixel !== undefined && !('rect' in v.change) && !('add' in v.change))
        ctx.addIssue({ code: 'custom', path: ['pixel'], message: 'pixel is allowed only with a rect or add change.' });
    const batch = 'renames' in v.change || 'rects' in v.change || 'adds' in v.change;
    if (batch !== ((v.artboardIndex ?? v.artboard_index) === undefined))
        ctx.addIssue({ code: 'custom', message: 'Single changes require artboard_index; renames, rects and adds must omit it.' });
};
const size = z.strictObject({ width: z.number().int(), height: z.number().int() });
const pixelPlanSchema = z.strictObject({ requested: size, scale: z.number().int().min(1).max(2), edgesPx: z.array(z.number().int()).length(4),
    expected: size, sizeDelta: size, fractionalEdges: z.array(z.number()).max(0) });
export function deriveArtboardPixel(after, index, pixel) {
    const r = after.boards[index].rect, s = pixel.scale;
    const expected = { width: (r[2] - r[0]) * s, height: (r[1] - r[3]) * s };
    return { requested: { width: pixel.width, height: pixel.height }, scale: s, edgesPx: [r[0] * s, r[1] * s, r[2] * s, r[3] * s], expected,
        sizeDelta: { width: expected.width - pixel.width, height: expected.height - pixel.height }, fractionalEdges: [] };
}
const common = { ...hostVersionInternalFields, expectedDocumentKey: keySchema, artboardIndex: z.number().int().min(0).max(ARTBOARD_MAX_COUNT - 1).optional(), change: artboardChangeSchema, pixel: artboardPixelSchema.optional() };
const internalSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...common, apply: z.literal(false) }).superRefine(pixelChangeRule),
    z.strictObject({ ...common, apply: z.literal(true), expectedBefore: artboardSnapshotSchema, confirmedAfter: artboardSnapshotSchema, commandId: canonicalCommandIdSchema }).superRefine(pixelChangeRule),
]);
const publicCommon = { ...hostVersionPublicFields, expected_document_key: keySchema, artboard_index: common.artboardIndex, change: artboardChangeSchema, pixel: common.pixel };
export const updateArtboardPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...publicCommon, apply: z.literal(false).default(false) }).superRefine(pixelChangeRule),
    z.strictObject({ ...publicCommon, apply: z.literal(true), expected_before: artboardSnapshotSchema, confirmed_after: artboardSnapshotSchema, command_id: applyCommandIdSchema }).superRefine(pixelChangeRule),
]);
const inputSchema = z.strictObject({ ...publicCommon, apply: z.boolean().default(false), expected_before: artboardSnapshotSchema.optional(), confirmed_after: artboardSnapshotSchema.optional(), command_id: applyCommandIdSchema.optional() });
const { $schema: _schemaDialect, ...publishedSchema } = z.toJSONSchema(updateArtboardPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedSchema });
function normalizePublicInput(input) {
    const v = updateArtboardPublicInputSchema.parse(input);
    const base = { ...normalizeHostVersionConsent(v), expectedDocumentKey: v.expected_document_key, ...(v.artboard_index === undefined ? {} : { artboardIndex: v.artboard_index }), change: v.change, ...(v.pixel === undefined ? {} : { pixel: v.pixel }) };
    return v.apply ? { ...base, apply: true, expectedBefore: v.expected_before, confirmedAfter: v.confirmed_after, commandId: v.command_id } : { ...base, apply: false };
}
export const UPDATE_ARTBOARD_UNSAVED_CHANGE_KEYS = ['add', 'adds', 'name', 'renames'];
export function updateArtboardProfileAdmitted(document, change) {
    if (document.colorSpace !== 'RGB')
        return false;
    if (document.mutationProfile === 'saved_file')
        return document.saved;
    if (document.mutationProfile === 'edit_session_file')
        return 'name' in change || 'renames' in change;
    return document.mutationProfile === 'unsaved_document' && UPDATE_ARTBOARD_UNSAVED_CHANGE_KEYS.some((key) => key in change);
}
const blockerSchema = z.enum(['saved_rgb_profile_required', 'host_version_unmeasured', 'unmeasured_ruler_origin', 'pixel_size_mismatch', 'artboard_overlap_unmeasured']);
const planSchema = z.strictObject({
    operation: z.literal(UPDATE_ARTBOARD_OPERATION), profile: z.enum(['integer_pt_v1', 'web_rgb_pixel_v1', 'artboard_identity_v1', 'artboard_artwork_v1']), documentKey: keySchema, documentBefore: documentContextSchema,
    artboardIndex: common.artboardIndex, change: artboardChangeSchema, unchangedRenameIndexes: z.array(z.number().int().min(0).max(ARTBOARD_MAX_COUNT - 1)).max(ARTBOARD_MAX_COUNT).optional(),
    before: artboardSnapshotSchema, after: artboardSnapshotSchema, pixel: pixelPlanSchema.optional(),
    changesState: z.boolean(), applyBlockedReasonCodes: z.array(blockerSchema), applyBlockedMessage: z.string().min(1).max(500).optional(), confirmationStatus: z.enum(['required', 'confirmed']), applyAllowed: z.boolean(),
}).superRefine((p, ctx) => {
    const identityChange = 'name' in p.change || 'active' in p.change || 'renames' in p.change;
    const mixed = !Array.isArray(p.before.artwork) && p.before.artwork.topLevelBoundsWitness !== undefined;
    const afterMixed = !Array.isArray(p.after.artwork) && p.after.artwork.topLevelBoundsWitness !== undefined;
    if ((p.profile === 'artboard_identity_v1') !== identityChange || (identityChange && (Array.isArray(p.before.artwork) || Array.isArray(p.after.artwork) || mixed || afterMixed))
        || (!identityChange && (mixed !== afterMixed || ((p.profile === 'artboard_artwork_v1') !== mixed) || (!mixed && (!Array.isArray(p.before.artwork) || !Array.isArray(p.after.artwork)))))) {
        ctx.addIssue({ code: 'custom', message: 'Only a rename or an active switch uses the artwork identity profile, and its snapshots carry the identity.' });
    }
    if ((!mixed && (p.profile === 'web_rgb_pixel_v1') !== (p.pixel !== undefined)) || (p.pixel !== undefined && (!('rect' in p.change || 'add' in p.change)
        || !same(deriveArtboardPixel(p.after, p.artboardIndex, { width: p.pixel.requested.width, height: p.pixel.requested.height, scale: p.pixel.scale }), p.pixel)))) {
        ctx.addIssue({ code: 'custom', message: 'A Web pixel plan must be derived from the target board of the planned after.' });
    }
    if ('renames' in p.change) {
        const unchanged = p.change.renames.filter((e) => p.before.boards[e.artboard_index]?.name === e.name).map((e) => e.artboard_index);
        if (p.artboardIndex !== undefined || p.unchangedRenameIndexes === undefined || !same(unchanged, p.unchangedRenameIndexes))
            ctx.addIssue({ code: 'custom', message: 'Renames carry no artboard index and list exactly the entries that already have their name.' });
    }
    else if (p.unchangedRenameIndexes !== undefined || (('rects' in p.change || 'adds' in p.change) !== (p.artboardIndex === undefined)))
        ctx.addIssue({ code: 'custom', message: 'Only batch changes omit the artboard index; only renames list unchanged names.' });
    if (p.documentKey !== p.documentBefore.key || p.documentBefore.artboardCount !== p.before.boards.length || p.documentBefore.activeArtboardIndex !== p.before.active)
        ctx.addIssue({ code: 'custom', message: 'Plan must bind the native document context to its before collection.' });
    else if (!sameActiveBounds(p.documentBefore.activeArtboardBounds, p.before.boards[p.before.active]?.rect))
        ctx.addIssue({ code: 'custom', message: activeBoundsMessage('plan.documentBefore', p.before.active, p.documentBefore.activeArtboardBounds, p.before.boards[p.before.active]?.rect) });
    try {
        if (!same(deriveArtboardAfter(p.before, p.artboardIndex, p.change), p.after))
            throw new Error();
    }
    catch {
        ctx.addIssue({ code: 'custom', message: 'Artboard after must be derived from the full before and the supported change.' });
    }
    if (p.changesState === same(p.before, p.after) || p.applyAllowed !== (p.confirmationStatus === 'confirmed' && p.applyBlockedReasonCodes.length === 0))
        ctx.addIssue({ code: 'custom', message: 'Invalid change or admission flags.' });
    const overlap = artboardAddOverlapIndex(p.before, p.change);
    if (p.applyBlockedReasonCodes.includes('artboard_overlap_unmeasured') !== (overlap !== null) || p.applyBlockedMessage !== (overlap === null ? undefined : artboardOverlapMessage(overlap)))
        ctx.addIssue({ code: 'custom', message: 'Plan must expose the intersecting artboard and separation guidance.' });
});
const scanMsSchema = z.array(z.number().int().nonnegative()).max(6).optional();
const transactionSchema = artboardTransactionSchema('update_artboard', { restoredSnapshot: artboardSnapshotSchema.nullable() }, { restoredSnapshot: null }, (v) => v.restoredSnapshot !== null);
export const updateArtboardResultSchema = z.union([
    z.strictObject({ scanMs: scanMsSchema, operation: z.literal(UPDATE_ARTBOARD_OPERATION), applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ scanMs: scanMsSchema, operation: z.literal(UPDATE_ARTBOARD_OPERATION), applied: z.literal(true), document: documentContextSchema, plan: planSchema, postcondition: artboardSnapshotSchema, transaction: transactionSchema }),
]).superRefine((r, ctx) => {
    const planned = r.transaction.state === 'planned';
    const baseline = r.plan.documentBefore;
    if (r.document.path !== baseline.path || r.document.fileRevision !== baseline.fileRevision || r.document.name !== baseline.name || r.document.appVersion !== baseline.appVersion || r.document.colorSpace !== baseline.colorSpace)
        ctx.addIssue({ code: 'custom', message: 'Result document must preserve the admitted file identity and profile.' });
    if (!planned && (!updateArtboardProfileAdmitted(baseline, r.plan.change) || !hostVersionAdmitted('update_artboard', baseline.appVersion)))
        ctx.addIssue({ code: 'custom', message: 'Applied artboard result requires RGB: clean saved, never-saved for add/adds/name/renames, or an edit session for name/renames only.' });
    if (r.applied && (r.document.artboardCount !== r.postcondition.boards.length || r.document.activeArtboardIndex !== r.postcondition.active))
        ctx.addIssue({ code: 'custom', message: 'Result document context must agree with the native postcondition.' });
    else if (r.applied && !sameActiveBounds(r.document.activeArtboardBounds, r.postcondition.boards[r.postcondition.active]?.rect))
        ctx.addIssue({ code: 'custom', message: activeBoundsMessage('result.document', r.postcondition.active, r.document.activeArtboardBounds, r.postcondition.boards[r.postcondition.active]?.rect) });
    if (r.plan.confirmationStatus !== (planned ? 'required' : 'confirmed') || (!planned && (!r.plan.applyAllowed || r.plan.applyBlockedReasonCodes.length !== 0)))
        ctx.addIssue({ code: 'custom', message: 'Transaction requires the exact confirmed, unblocked plan.' });
    if (planned) {
        const blockers = [];
        if (!updateArtboardProfileAdmitted(r.document, r.plan.change))
            blockers.push('saved_rgb_profile_required');
        if (!hostVersionAdmitted('update_artboard', r.document.appVersion))
            blockers.push('host_version_unmeasured');
        if (artboardOriginBlocked(r.plan.before, r.plan.artboardIndex, r.plan.change) || (r.plan.pixel !== undefined && !same(r.plan.after.boards[r.plan.artboardIndex]?.rulerOrigin, [0, 0])))
            blockers.push('unmeasured_ruler_origin');
        if (r.plan.pixel !== undefined && (r.plan.pixel.sizeDelta.width !== 0 || r.plan.pixel.sizeDelta.height !== 0))
            blockers.push('pixel_size_mismatch');
        if (artboardAddOverlapIndex(r.plan.before, r.plan.change) !== null)
            blockers.push('artboard_overlap_unmeasured');
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
        identityToken: `artboard-update-v1:${canonicalDigest({ index: r.plan.artboardIndex ?? null, before: r.plan.before })}`,
        beforeState: { path: r.plan.documentBefore.path, fileRevision: r.plan.documentBefore.fileRevision, snapshot: r.plan.before }, afterState: r.plan.after, changeSet: { index: r.plan.artboardIndex ?? null, change: r.plan.change, profile: r.plan.profile, ...(r.plan.pixel === undefined ? {} : { pixel: r.plan.pixel }) },
        blocked: r.plan.applyBlockedReasonCodes.length > 0, confirmationStatus: r.plan.confirmationStatus, applyAllowed: r.plan.applyAllowed,
        transactionState: r.transaction.state, applied: r.applied };
});
export const UPDATE_ARTBOARD_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}${HOST_VERSION_POLICY_JSX}${READ_PAGE_ITEM_AT_HELPER}${OBJECT_WITNESS_HELPERS}${OBJECT_WALK_HELPERS}${LAYER_TOP_LEVEL_ITEMS_HELPER}
var scanStartedAt = 0, scanTotal = 0, scanVisited = 0, scanTicks = 0, abScanMs = [];
function abFail(message) { throw mutationError("preflight_failed", message); }
// Numbers compare in the form the host prints them: ExtendScript's String(number) keeps 15 significant digits, so a
// plan read back from the output (expected_before, confirmed_after) equals a fresh read only at that precision.
function abSame(a, b) {
  if (typeof a === "number" && typeof b === "number") return String(a) === String(b);
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if ((a instanceof Array) !== (b instanceof Array)) return false;
  var k, count = 0, other = 0;
  for (k in a) if (a.hasOwnProperty(k)) { count++; if (!b.hasOwnProperty(k) || !abSame(a[k], b[k])) return false; }
  for (k in b) if (b.hasOwnProperty(k)) other++;
  return count === other;
}
function abNumbers(value, length, integer, label) {
  if (!value || value.length !== length) abFail("Artboard geometry is unavailable at " + label + ".");
  var out = [];
  for (var i = 0; i < length; i++) {
    var at = label + "[" + i + "]", v = mutationFiniteNumber(value[i], at);
    if (Math.abs(v) > 32768) abFail("Geometry is outside the integer-point artboard profile: " + at + " = " + v + " is beyond +/-32768.");
    if (integer) {
      var whole = Math.round(v);
      if (Math.abs(v - whole) > ${ARTBOARD_INTEGER_TOLERANCE}) abFail("Geometry is outside the integer-point artboard profile: " + at + " = " + v + " is fractional but must be an integer (tolerance ${ARTBOARD_INTEGER_TOLERANCE}).");
      v = whole + 0;
    }
    out.push(v);
  }
  return out;
}
// Names the first reason an item is outside the direct ordinary PathItem profile: its type, its parent type, or a flag.
function abWhyNotOrdinary(item) {
  if (item.typename !== "PathItem") return "a " + item.typename;
  if (!item.parent) return "a PathItem without a parent";
  if (item.parent.typename !== "Layer") return "a PathItem inside a " + item.parent.typename;
  return item.clipping ? "a clipping PathItem" : "a guide PathItem";
}
function abSnapshot(doc) {
  if (doc.documentColorSpace !== DocumentColorSpace.RGB) abFail("Only RGB documents are supported.");
  if (doc.artboards.length < 1 || doc.artboards.length > ${ARTBOARD_MAX_COUNT}) abFail("Complete artboard collection exceeds the supported limit.");
  var mixed = !abIdentityProfile() && !abLegacyArtworkEligible(doc), boards = [];
  for (var i = 0; i < doc.artboards.length; i++) {
    var board = doc.artboards[i], rect = abNumbers(board.artboardRect, 4, true, "artboard[" + i + "].rect"), name = String(board.name);
    if (rect[0] >= rect[2] || rect[1] <= rect[3] || name.length > 1024) abFail("Unsupported artboard state.");
    var snapshot = { index: i, name: name, rect: rect, rulerOrigin: abNumbers(board.rulerOrigin, 2, true, "artboard[" + i + "].rulerOrigin") };
    if (mixed) {
      var par = mutationFiniteNumber(board.rulerPAR, "artboard.rulerPAR");
      if (par < 0.1 || par > 10 || typeof board.showCenter !== "boolean" || typeof board.showCrossHairs !== "boolean" || typeof board.showSafeAreas !== "boolean") abFail("Artboard presentation is unavailable.");
      snapshot.presentation = [par, board.showCenter, board.showCrossHairs, board.showSafeAreas];
    }
    boards.push(snapshot);
  }
  var items;
  if (abIdentityProfile()) items = abIdentity(doc);
  else if (mixed) items = abArtworkWitness(doc);
  else items = abArtwork(doc);
  var active = doc.artboards.getActiveArtboardIndex();
  if (typeof active !== "number" || active % 1 !== 0 || active < 0 || active >= boards.length) abFail("Active artboard is unavailable.");
  return { boards: boards, active: active, rulerOrigin: abNumbers(doc.rulerOrigin, 2, true, "document.rulerOrigin"), rulerUnits: String(doc.rulerUnits), colorSpace: "RGB", artwork: items };
}
// A rename or an active switch writes no geometry: the artwork is bound by its count and native UUID set, not by path geometry.
function abIdentityProfile() { var change = params.change; return !!change && typeof change === "object" && (change.name !== undefined || change.active !== undefined || change.renames !== undefined); }
function abIdentity(doc) {
  params.deadlineMs = ${PAGE_ITEM_RESOLVE_DEADLINE_MS};
  scanStartedAt = new Date().getTime(); scanTotal = doc.pageItems.length; scanVisited = 0; scanTicks = 0;
  if (scanTotal > ${ARTBOARD_IDENTITY_MAX_ITEMS}) abFail("Complete artwork collection exceeds the supported limit.");
  var lanes = [0, 0, 0], count = 0, seen = {};
  try {
    walkDocumentTree(doc, function (item) {
      var uuid = item.uuid;
      if (typeof uuid !== "string" || uuid.length < 1 || uuid.length > 256 || seen["u:" + uuid]) abFail("Complete native artwork identity is unavailable.");
      seen["u:" + uuid] = true; count++;
      var hashed = witnessText(uuid);
      lanes[0] = (lanes[0] + hashed[0]) >>> 0; lanes[1] = (lanes[1] + hashed[1]) >>> 0; lanes[2] = (lanes[2] + ((hashed[0] ^ hashed[1]) >>> 0)) >>> 0;
    });
  } catch (walkError) {
    var walkText = walkError && walkError.message ? String(walkError.message) : "";
    if (String(walkText).indexOf("READ_SCAN_DEADLINE") >= 0 || String(walkText).indexOf("READ_WALK_INCOMPLETE") >= 0) abFail("The artwork identity could not be read completely within ${PAGE_ITEM_RESOLVE_DEADLINE_MS} ms.");
    throw walkError;
  }
  if (scanVisited !== scanTotal || count !== scanTotal) abFail("The artwork walk reached " + scanVisited + " of " + scanTotal + " page items, so the artwork identity is incomplete.");
  return { count: count, witness: witnessHex(lanes[0]) + witnessHex(lanes[1]) + witnessHex(lanes[2]) };
}
// Select the existing profile by its explicit predicates; read errors never select another profile.
// #971 W4: the layers' own collections (fresh) say what is in the document; doc.pageItems.length is only a lower bound (longer than the layers' total = nested items = not direct-only).
function abLegacyArtworkEligible(doc) {
  var count = layerTopLevelCount(doc.layers), points = 0;
  if (doc.pageItems.length > count || count > ${ARTBOARD_MAX_ITEMS}) return false;
  var top = layerTopLevelItems(doc.layers, []);
  for (var i = 0; i < top.length; i++) {
    var item = top[i];
    if (item.typename !== "PathItem" || !item.parent || item.parent.typename !== "Layer" || item.clipping || item.guides) return false;
    points += item.pathPoints.length;
    if (points > ${ARTBOARD_MAX_POINTS}) return false;
  }
  return true;
}
function abAddWitness(lanes, text) {
  var hashed = witnessText(text);
  lanes[0] = (lanes[0] + hashed[0]) >>> 0; lanes[1] = (lanes[1] + hashed[1]) >>> 0; lanes[2] = (lanes[2] + ((hashed[0] ^ hashed[1]) >>> 0)) >>> 0;
}
function abFinishWitness(lanes) { return witnessHex(lanes[0]) + witnessHex(lanes[1]) + witnessHex(lanes[2]); }
function abArtworkWitness(doc) {
  try { return abArtworkWitnessScan(doc); }
  catch (scanError) {
    if (String(scanError && scanError.message).indexOf("READ_SCAN_DEADLINE") >= 0) abFail("Mixed artwork scan exceeded ${ARTBOARD_ARTWORK_SCAN_DEADLINE_MS} ms; no complete witness is available." + abScanCost());
    throw scanError;
  }
  finally { abScanMs.push(new Date().getTime() - scanStartedAt); }
}
function abScanCost() { return "; scan " + (new Date().getTime() - scanStartedAt) + " ms, visited " + scanVisited + "/" + scanTotal; }
function abArtworkWitnessScan(doc) {
  params.deadlineMs = ${ARTBOARD_ARTWORK_SCAN_DEADLINE_MS};
  scanStartedAt = new Date().getTime(); scanTotal = doc.pageItems.length; scanVisited = 0; scanTicks = 0;
  if (scanTotal > ${ARTBOARD_ARTWORK_MAX_ITEMS}) abFail("Mixed artwork count " + scanTotal + " exceeds the ${ARTBOARD_ARTWORK_MAX_ITEMS}-item limit." + abScanCost());
  if (app.coordinateSystem !== CoordinateSystem.DOCUMENTCOORDINATESYSTEM) abFail("Mixed artwork requires document coordinates.");
  // F0 measured top-level layers and group/compound children, not sublayers or groups inside compound paths.
  for (var li = 0; li < doc.layers.length; li++) {
    scanTick();
    if (doc.layers[li].layers.length !== 0) abFail("Mixed artwork sublayers are unmeasured.");
  }
  var lanes = [0, 0, 0], boundsLanes = [0, 0, 0], count = 0, roots = 0, seen = {};
  try {
    walkDocumentTree(doc, function (item, typeName, layerInfo) {
      if (layerInfo.path.length !== 1) abFail("Mixed artwork sublayers are unmeasured.");
      if (typeName !== "PathItem" && typeName !== "GroupItem" && typeName !== "TextFrame" && typeName !== "PlacedItem" && typeName !== "RasterItem" && typeName !== "CompoundPathItem" && typeName !== "PluginItem") abFail("Mixed artwork type " + typeName + " is unmeasured.");
      if (typeName === "TextFrame" && item.kind !== TextType.POINTTEXT && item.kind !== TextType.AREATEXT) abFail("Mixed artwork text kind is unmeasured; only point and area text are admitted.");
      var parent = item.parent;
      if (!parent || (parent.typename !== "Layer" && parent.typename !== "GroupItem" && parent.typename !== "CompoundPathItem")) abFail("Mixed artwork parent is unmeasured.");
      if (typeName === "GroupItem" && parent.typename === "CompoundPathItem") abFail("Mixed artwork groups inside compound paths are unmeasured.");
      if (typeName === "PathItem" && item.guides) abFail("Mixed artwork guides are unmeasured.");
      var uuid = item.uuid;
      if (typeof uuid !== "string" || uuid.length < 1 || uuid.length > 256 || seen["u:" + uuid]) abFail("Complete native artwork identity is unavailable.");
      seen["u:" + uuid] = true; count++; abAddWitness(lanes, uuid);
      if (parent.typename === "Layer") {
        var bounds = item.geometricBounds;
        if (!bounds || bounds.length !== 4) abFail("Top-level artwork bounds are unavailable.");
        var text = uuid;
        // Exact host number text, with no rounding/tolerance. UUID associates each root with its own bounds.
        for (var bi = 0; bi < 4; bi++) text += "|" + String(mutationFiniteNumber(bounds[bi], "top-level geometricBounds"));
        roots++; abAddWitness(boundsLanes, text);
      }
    });
  } catch (walkError) {
    var walkText = walkError && walkError.message ? String(walkError.message) : "";
    if (String(walkText).indexOf("READ_SCAN_DEADLINE") >= 0) abFail("Mixed artwork scan exceeded ${ARTBOARD_ARTWORK_SCAN_DEADLINE_MS} ms; no complete witness is available." + abScanCost());
    throw walkError;
  }
  if (new Date().getTime() - scanStartedAt > ${ARTBOARD_ARTWORK_SCAN_DEADLINE_MS}) abFail("Mixed artwork scan exceeded ${ARTBOARD_ARTWORK_SCAN_DEADLINE_MS} ms; no complete witness is available." + abScanCost());
  if (scanVisited !== scanTotal || count !== scanTotal) abFail("Mixed artwork walk reached " + scanVisited + " of " + scanTotal + " page items; the UUID set is incomplete.");
  return { count: count, witness: abFinishWitness(lanes), topLevelCount: roots, topLevelBoundsWitness: abFinishWitness(boundsLanes) };
}
function abArtwork(doc) {
  var items = [], uuids = {}, totalPoints = 0, topCount = layerTopLevelCount(doc.layers);
  if (topCount > ${ARTBOARD_MAX_ITEMS} || doc.pageItems.length > ${ARTBOARD_MAX_ITEMS}) abFail("Complete artwork collection exceeds the supported limit.");
  if (doc.pageItems.length > topCount) abFail("The document holds " + doc.pageItems.length + " page items but its layers list " + topCount + ": nested artwork is not supported by this artboard slice.");
  var top = layerTopLevelItems(doc.layers, []);
  for (var j = 0; j < top.length; j++) {
    var item = top[j];
    if (item.typename !== "PathItem" || !item.parent || item.parent.typename !== "Layer" || item.clipping || item.guides) abFail("Only direct ordinary PathItems are supported by this artboard slice: pageItems[" + j + "] of " + top.length + " is " + abWhyNotOrdinary(item) + ".");
    var uuid = item.uuid;
    if (typeof uuid !== "string" || uuid.length < 1 || uuid.length > 256 || uuids["u:" + uuid]) abFail("Complete native artwork identity is unavailable.");
    uuids["u:" + uuid] = true;
    if (item.pathPoints.length < 1) abFail("Empty path is unsupported.");
    totalPoints += item.pathPoints.length;
    if (totalPoints > ${ARTBOARD_MAX_POINTS}) abFail("Complete artwork point collection exceeds the supported limit.");
    var points = [], from = "artwork[" + uuid + "]";
    for (var k = 0; k < item.pathPoints.length; k++) {
      var point = item.pathPoints[k], pointAt = from + ".point[" + k + "].";
      points.push({ anchor: abNumbers(point.anchor, 2, false, pointAt + "anchor"), left: abNumbers(point.leftDirection, 2, false, pointAt + "leftDirection"), right: abNumbers(point.rightDirection, 2, false, pointAt + "rightDirection") });
    }
    if (typeof item.closed !== "boolean") abFail("Path closed state is unavailable.");
    items.push({ uuid: uuid, bounds: abNumbers(item.geometricBounds, 4, false, from + ".geometricBounds"), closed: item.closed, points: points });
  }
  return items;
}
function abName(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 255 || /^\\s|\\s$|[\\x00-\\x1f\\x7f]/.test(value)) abFail("Unsupported artboard name.");
  return value;
}
function abPositiveRect(value, label) {
  var rect = abNumbers(value, 4, true, label);
  if (rect[0] >= rect[2] || rect[1] <= rect[3]) abFail("Rect must have positive width and height.");
  return rect;
}
function abKeys(value) { var n = 0, key; for (key in value) if (value.hasOwnProperty(key)) n++; return n; }
function abImplicitOrigin(rect) { return [0 - rect[0], 0 - rect[3]]; }
function abOriginImplicit(s) {
  for (var i = 0; i < s.boards.length; i++) if (s.boards[i].rulerOrigin[0] !== 0 || s.boards[i].rulerOrigin[1] !== 0) return false;
  return abSame(s.rulerOrigin, abImplicitOrigin(s.boards[s.active].rect));
}
function abIsAdds() { return params.change.adds !== undefined; }
function abIsRects() { return params.change.rects !== undefined; }
function abIsAdd() { return params.change.add !== undefined || abIsAdds(); }
function abIsActive() { return params.change.active !== undefined; }
function abIsRenames() { return params.change.renames !== undefined; }
// Several renames in one change: every entry names an existing board once; the result differs from before only in those names.
function abDeriveRenames(before, boards, after) {
  var entries = params.change.renames, seen = {};
  if (params.artboardIndex !== undefined) abFail("renames must not carry an artboard index.");
  if (!(entries instanceof Array) || entries.length < 1 || entries.length > ${ARTBOARD_MAX_COUNT}) abFail("renames requires 1 to ${ARTBOARD_MAX_COUNT} entries.");
  for (var k = 0; k < entries.length; k++) {
    var entry = entries[k];
    if (!entry || typeof entry !== "object" || entry instanceof Array || abKeys(entry) !== 2 || entry.name === undefined || entry.artboard_index === undefined) abFail("Each rename requires exactly artboard_index and name.");
    var at = entry.artboard_index;
    if (typeof at !== "number" || at % 1 !== 0 || at < 0 || at >= before.boards.length) abFail("Rename artboard_index is outside the complete collection.");
    if (seen["i:" + at]) abFail("Each artboard_index may appear only once in renames.");
    seen["i:" + at] = true;
    boards[at].name = abName(entry.name);
  }
  return after;
}
function abDeriveBatch(before, boards, after) {
  var isRects = abIsRects(), entries = isRects ? params.change.rects : params.change.adds, seen = {};
  if (params.artboardIndex !== undefined) abFail("Batch changes must not carry an artboard index.");
  if (!(entries instanceof Array) || entries.length < 1 || entries.length > ${ARTBOARD_MAX_COUNT}) abFail("Batch changes require 1 to ${ARTBOARD_MAX_COUNT} entries.");
  if (!isRects && before.boards.length + entries.length > ${ARTBOARD_MAX_COUNT}) abFail("Complete artboard collection exceeds the supported limit.");
  for (var k = 0; k < entries.length; k++) {
    var entry = entries[k];
    if (!entry || typeof entry !== "object" || entry instanceof Array || abKeys(entry) !== 2 || entry.rect === undefined) abFail("Each batch entry requires exactly rect and artboard_index or name.");
    var at = isRects ? entry.artboard_index : boards.length;
    var r = abPositiveRect(entry.rect, "change." + (isRects ? "rects" : "adds") + "[" + k + "].rect");
    if (isRects) {
      if (typeof at !== "number" || at % 1 !== 0 || at < 0 || at >= before.boards.length) abFail("Rect artboard_index is outside the complete collection.");
      if (seen["i:" + at]) abFail("Each artboard_index may appear only once in rects.");
      seen["i:" + at] = true; boards[at].rect = r;
      if (at === before.active) after.rulerOrigin = abImplicitOrigin(r);
    } else {
      if (entry.name === undefined) abFail("Each add requires exactly name and rect.");
      var appended = { index: at, name: abName(entry.name), rect: r, rulerOrigin: [0, 0] };
      if (before.boards[0].presentation !== undefined) appended.presentation = [1, false, false, false];
      boards.push(appended);after.active = at;after.rulerOrigin = abImplicitOrigin(r);
    }
  }
  return after;
}
function abDerive(before) {
  var index = params.artboardIndex, change = params.change;
  if (!change || typeof change !== "object" || change instanceof Array) abFail("Artboard change is required.");
  if (abKeys(change) !== 1) abFail("Change must contain exactly one name, rect, active, add, renames, rects or adds.");
  if (change.renames === undefined && change.rects === undefined && change.adds === undefined && (typeof index !== "number" || index % 1 !== 0 || index < 0)) abFail("Artboard index is outside the complete collection.");
  var boards = [], i;
  for (i = 0; i < before.boards.length; i++) {
    var copy = { index: i, name: before.boards[i].name, rect: before.boards[i].rect, rulerOrigin: before.boards[i].rulerOrigin };
    if (before.boards[i].presentation !== undefined) copy.presentation = before.boards[i].presentation;
    boards.push(copy);
  }
  var after = { boards: boards, active: before.active, rulerOrigin: before.rulerOrigin, rulerUnits: before.rulerUnits, colorSpace: before.colorSpace, artwork: before.artwork };
  if (change.renames !== undefined) return abDeriveRenames(before, boards, after);
  if (abIsRects() || abIsAdds()) return abDeriveBatch(before, boards, after);
  if (change.add !== undefined) {
    var add = change.add;
    if (!add || typeof add !== "object" || add instanceof Array || abKeys(add) !== 2 || add.name === undefined || add.rect === undefined) abFail("add requires exactly name and rect.");
    if (index !== before.boards.length) abFail("An added artboard must use the next ordinal.");
    if (before.boards.length >= ${ARTBOARD_MAX_COUNT}) abFail("Complete artboard collection exceeds the supported limit.");
    var addRect = abPositiveRect(add.rect, "change.add.rect");
    var appended = { index: index, name: abName(add.name), rect: addRect, rulerOrigin: [0, 0] };
    if (before.boards[0].presentation !== undefined) appended.presentation = [1, false, false, false];
    boards.push(appended);
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
    var rect = abPositiveRect(change.rect, "change.rect");
    boards[index].rect = rect;
    if (index === before.active) after.rulerOrigin = abImplicitOrigin(rect);
  } else abFail("Change must contain exactly one name, rect, active, add, renames, rects or adds.");
  return after;
}
function abPixel(after) {
  var px = params.pixel;
  if (px === undefined) return null;
  if (!px || typeof px !== "object" || px instanceof Array || abKeys(px) !== 3 || (px.scale !== 1 && px.scale !== 2)) abFail("pixel requires width, height and scale 1 or 2.");
  if (params.change.rect === undefined && params.change.add === undefined) abFail("pixel is allowed only with a rect or add change.");
  var sides = [px.width, px.height];
  for (var i = 0; i < 2; i++) if (typeof sides[i] !== "number" || sides[i] % 1 !== 0 || sides[i] < 1 || sides[i] > ${RASTER_MAX_SIDE_PX}) abFail("pixel width and height must be positive integers within the measured size.");
  if (px.width * px.height > ${RASTER_MAX_TOTAL_PX}) abFail("pixel exceeds the measured total size.");
  // Integer edges at scale 1 or 2 (the illustrator_export contract): width=(r-l)*s, height=(t-b)*s, tolerance 0.
  var r = after.boards[params.artboardIndex].rect, s = px.scale, w = (r[2] - r[0]) * s, h = (r[1] - r[3]) * s;
  return { requested: { width: px.width, height: px.height }, scale: s, edgesPx: [r[0] * s, r[1] * s, r[2] * s, r[3] * s],
    expected: { width: w, height: h }, sizeDelta: { width: w - px.width, height: h - px.height }, fractionalEdges: [] };
}
// Integral within the integer tolerance: a noisy edge is read as its integer (see abNumbers) and a write never depends on its exact bits.
function abExact(value) { for (var i = 0; i < value.length; i++) if (!(Math.abs(value[i] - Math.round(value[i])) <= ${ARTBOARD_INTEGER_TOLERANCE})) return false; return true; }
// The board references of the renames that change a name; an entry that already has its name is left alone, in the plan and in the write.
function abRenameTargets(doc, before, after) {
  var out = [];
  for (var i = 0; i < before.boards.length; i++) if (before.boards[i].name !== after.boards[i].name) out.push({ index: i, board: doc.artboards[i] });
  return out;
}
function abRectTargets(doc, before, after) {
  var out = [], entries = params.change.rects;
  for (var k = 0; k < entries.length; k++) {
    var at = entries[k].artboard_index;
    if (!abSame(before.boards[at].rect, after.boards[at].rect)) out.push({ index: at, board: doc.artboards[at] });
  }
  return out;
}
function abUnchangedRenames(before) {
  var out = [], entries = params.change.renames;
  for (var k = 0; k < entries.length; k++) if (before.boards[entries[k].artboard_index].name === entries[k].name) out.push(entries[k].artboard_index);
  return out;
}
function abAddOverlapIndex(before) {
  if (!abIsAdd()) return null;
  var entries = abIsAdds() ? params.change.adds : [params.change.add], rects = [], i;
  for (i = 0; i < before.boards.length; i++) rects.push(before.boards[i].rect);
  for (var k = 0; k < entries.length; k++) {
    var proposed = entries[k].rect;
    for (i = 0; i < rects.length; i++) {
      var r = rects[i];
      if (proposed[0] <= r[2] && proposed[2] >= r[0] && proposed[3] <= r[1] && proposed[1] >= r[3]) return i;
    }
    rects.push(proposed);
  }
  return null;
}
function abOverlapMessage(index) { return "Requested rect overlaps or touches artboard " + index + ". Place it with a gap from every other artboard."; }
// Clean saved RGB admits every change; never-saved RGB admits add/adds/name/renames; a session admits names only.
function abNameChange() { var c = params.change; return c.name !== undefined || c.renames !== undefined; }
function abUnsavedChange() { var c = params.change; return c.add !== undefined || c.adds !== undefined || c.name !== undefined || c.renames !== undefined; }
function abProfileAdmitted(context) {
  if (context.colorSpace !== "RGB") return false;
  if (context.mutationProfile === "saved_file") return !!context.saved;
  if (context.mutationProfile === "edit_session_file") return abNameChange();
  return context.mutationProfile === "unsaved_document" && abUnsavedChange();
}
function abResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var doc = app.activeDocument, before = abSnapshot(doc), after = abDerive(before), pixel = abPixel(after), blockers = [];
  if (!abProfileAdmitted(context)) blockers.push("saved_rgb_profile_required");
  if (!hostVersionAdmitted("update_artboard", String(context.appVersion))) blockers.push("host_version_unmeasured");
  // The predicted origin of add, a real active switch and an active-board rect is measured only from the implicit origin state.
  var abActiveRect = params.change.rect !== undefined && params.artboardIndex === before.active;
  if (abIsRects()) for (var k = 0; k < params.change.rects.length; k++) if (params.change.rects[k].artboard_index === before.active) abActiveRect = true;
  // A value within the integer tolerance is read as its integer and never written except by the requested change itself; the verified inverse restores that integer reading.
  if (params.change.rect !== undefined && !abExact(doc.artboards[params.artboardIndex].artboardRect)) abFail("artboard[" + params.artboardIndex + "].rect is not integral within the tolerance, so a rect write could not restore it.");
  if (abIsRects()) for (var k = 0; k < params.change.rects.length; k++) {
    var at = params.change.rects[k].artboard_index;
    if (!abExact(doc.artboards[at].artboardRect)) abFail("artboard[" + at + "].rect is not integral within the tolerance, so a rect write could not restore it.");
  }
  if ((abIsAdd() || (abIsActive() && params.artboardIndex !== before.active) || abActiveRect) && !abExact(doc.rulerOrigin)) abFail("document.rulerOrigin is not integral within the tolerance, so the origin the host recomputes could not be restored.");
  var abBoardOrigin = pixel !== null ? after.boards[params.artboardIndex].rulerOrigin : [0, 0];
  // The pixel size is measured only for a board whose own ruler origin is [0,0].
  if (((abIsAdd() || (abIsActive() && params.artboardIndex !== before.active) || abActiveRect) && !abOriginImplicit(before)) || abBoardOrigin[0] !== 0 || abBoardOrigin[1] !== 0) blockers.push("unmeasured_ruler_origin");
  if (pixel !== null && (pixel.sizeDelta.width !== 0 || pixel.sizeDelta.height !== 0)) blockers.push("pixel_size_mismatch");
  var overlap = abAddOverlapIndex(before), overlapMessage = null;
  if (overlap !== null) { blockers.push("artboard_overlap_unmeasured"); overlapMessage = abOverlapMessage(overlap); }
  if (forApply) {
    if (!abSame(before, params.expectedBefore)) abFail("expected_before does not match the complete artboard and artwork state.");
    if (!abSame(after, params.confirmedAfter)) abFail("confirmed_after does not match the derived plan.");
    if (blockers.length > 0) abFail(overlapMessage || "Artboard profile is unsupported.");
  }
  var target = null;
  if (abIsRenames()) target = abRenameTargets(doc, before, after);
  else if (abIsRects()) target = abRectTargets(doc, before, after);
  else if (params.artboardIndex < doc.artboards.length) target = doc.artboards[params.artboardIndex];
  var profile = "integer_pt_v1";
  if (abIdentityProfile()) profile = "artboard_identity_v1";
  else if (before.artwork.topLevelBoundsWitness !== undefined) profile = "artboard_artwork_v1";
  else if (pixel !== null) profile = "web_rgb_pixel_v1";
  return { context: context, document: doc, target: target, added: null, appended: [], before: before, after: after, pixel: pixel, blockers: blockers, unchangedRenames: abIsRenames() ? abUnchangedRenames(before) : undefined,
    profile: profile, overlapMessage: overlapMessage };
}
function abPlan(p) {
  var plan = { operation: "update_artboard", profile: p.profile, documentKey: p.context.key, documentBefore: p.context, artboardIndex: params.artboardIndex,
    change: params.change, before: p.before, after: p.after };
  // Renames name their own boards, so the plan carries no single artboard index but lists the entries that already have their name.
  if (params.artboardIndex === undefined) delete plan.artboardIndex;
  if (p.unchangedRenames !== undefined) plan.unchangedRenameIndexes = p.unchangedRenames;
  if (p.pixel !== null) plan.pixel = p.pixel;
  plan.changesState = !abSame(p.before, p.after); plan.applyBlockedReasonCodes = p.blockers;
  if (p.overlapMessage !== null) plan.applyBlockedMessage = p.overlapMessage;
  plan.confirmationStatus = params.apply === true ? "confirmed" : "required"; plan.applyAllowed = params.apply === true && p.blockers.length === 0;
  return plan;
}
function abSameTarget(a, b) {
  if (!(a instanceof Array) || !(b instanceof Array)) return a === b;
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i].index !== b[i].index || a[i].board !== b[i].board) return false;
  return true;
}
function abRevalidate(p) {
  try {
    var current = abResolve(true);
    if (current.document !== p.document || !abSameTarget(current.target, p.target) || !abSame(current.before, p.before)) abFail("Artboard identity changed before apply.");
  } catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Artboard state changed before apply.")); }
}
function abNativeFailure(call, error) { mutationNativeFailure(call, error); }
function abSetName(board, name, nativeErrors) {
  if (!nativeErrors) { board.name = name; return; }
  try { board.name = name; } catch (error) { abNativeFailure("Artboard.name", error); }
}
function abSetRect(board, rect, nativeErrors) {
  if (!nativeErrors) { board.artboardRect = rect; return; }
  try { board.artboardRect = rect; } catch (error) { abNativeFailure("Artboard.artboardRect", error); }
}
function abWrite(target, snapshot, nativeErrors) {
  if (abIsRenames()) { for (var k = 0; k < target.length; k++) abSetName(target[k].board, snapshot.boards[target[k].index].name, nativeErrors); }
  else if (abIsRects()) {
    for (var k = nativeErrors ? 0 : target.length - 1; nativeErrors ? k < target.length : k >= 0; nativeErrors ? k++ : k--) {
      if (!abSame(abNumbers(target[k].board.artboardRect, 4, true, "rect target"), snapshot.boards[target[k].index].rect)) abSetRect(target[k].board, snapshot.boards[target[k].index].rect, nativeErrors);
    }
  }
  else if (params.change.name !== undefined) abSetName(target, snapshot.boards[params.artboardIndex].name, nativeErrors);
  else if (nativeErrors) {
    try { target.artboardRect = snapshot.boards[params.artboardIndex].rect; } catch (error) { abNativeFailure("Artboard.artboardRect", error); }
  } else target.artboardRect = snapshot.boards[params.artboardIndex].rect;
}
function abApply(p, plan, state) {
  if (!plan.changesState) return;
  state.operationState.mutationStarted = true;
  var index = params.artboardIndex;
  if (abIsAdds()) {
    for (var k = p.before.boards.length; k < plan.after.boards.length; k++) {
      var board;
      try { board = p.document.artboards.add(plan.after.boards[k].rect); } catch (error) { abNativeFailure("artboards.add", error); }
      // Bind the returned native reference before reading or naming it; an unreturned append never gains ownership.
      var owned = { index: k, board: board, initialName: null, named: false };p.appended.push(owned);
      owned.initialName = String(board.name);abSetName(board, plan.after.boards[k].name, true);owned.named = true;
    }
  } else if (abIsAdd()) {
    // The reference returned by add in this call is the only identity of the self-created board.
    try { p.added = p.document.artboards.add(plan.after.boards[index].rect); } catch (error) { abNativeFailure("artboards.add", error); }
    abSetName(p.added, plan.after.boards[index].name, true);
  } else if (abIsActive()) {
    try { p.document.artboards.setActiveArtboardIndex(index); } catch (error) { abNativeFailure("artboards.setActiveArtboardIndex", error); }
  } else abWrite(p.target, plan.after, true);
}
function abReadCurrent(p) {
  if (app.documents.length === 0 || app.activeDocument !== p.document) abFail("Artboard document reference changed.");
  if (abIsRenames() || abIsRects()) { for (var k = 0; k < p.target.length; k++) if (p.document.artboards[p.target[k].index] !== p.target[k].board) abFail("Artboard target reference changed."); }
  else if (!abIsAdd() && p.document.artboards[params.artboardIndex] !== p.target) abFail("Artboard target reference changed.");
  var currentContext = getDocumentContext();
  if (currentContext.path !== p.context.path || currentContext.fileRevision !== p.context.fileRevision || currentContext.name !== p.context.name || currentContext.appVersion !== p.context.appVersion) abFail("Artboard file identity changed after apply.");
  return abSnapshot(p.document);
}
function abOwnsAppended(p) {
  if (p.appended.length < 1 || p.document.artboards.length !== p.before.boards.length + p.appended.length) return false;
  for (var k = 0; k < p.appended.length; k++) if (p.appended[k].index !== p.before.boards.length + k || p.document.artboards[p.appended[k].index] !== p.appended[k].board) return false;
  return true;
}
function abOwnsAdded(p) {
  if (abIsAdds()) return abOwnsAppended(p) && p.appended.length === params.change.adds.length;
  var n = p.before.boards.length;
  return p.added !== null && p.document.artboards.length > 1 && p.document.artboards.length === n + 1 && p.document.artboards[n] === p.added;
}
function abVerify(p, plan) {
  var after = abReadCurrent(p);
  if (abIsAdd() && !abOwnsAdded(p)) throw mutationError("verify_mismatch", "The added artboard is not the self-created board.");
  if (!abSame(after, plan.after)) throw mutationError("verify_mismatch", "Artboard or artwork read-back differs from the complete planned after.");
  return after;
}
function abRenamePartial(current, p) {
  var kept = { boards: [], active: current.active, rulerOrigin: current.rulerOrigin, rulerUnits: current.rulerUnits, colorSpace: current.colorSpace, artwork: current.artwork }, i;
  if (current.boards.length !== p.before.boards.length) return false;
  for (i = 0; i < current.boards.length; i++) kept.boards.push({ index: i, name: current.boards[i].name, rect: current.boards[i].rect, rulerOrigin: current.boards[i].rulerOrigin });
  for (i = 0; i < p.target.length; i++) {
    var at = p.target[i].index, name = current.boards[at].name;
    if (name !== p.before.boards[at].name && name !== p.after.boards[at].name) return false;
    kept.boards[at].name = p.before.boards[at].name;
  }
  return abSame(kept, p.before);
}
function abRectPartial(current, p) {
  var kept = { boards: [], active: current.active, rulerOrigin: current.rulerOrigin, rulerUnits: current.rulerUnits, colorSpace: current.colorSpace, artwork: current.artwork };
  if (current.boards.length !== p.before.boards.length) return false;
  for (var i = 0; i < current.boards.length; i++) {
    var b = current.boards[i], copy = { index: b.index, name: b.name, rect: b.rect, rulerOrigin: b.rulerOrigin };
    if (b.presentation !== undefined) copy.presentation = b.presentation;kept.boards.push(copy);
  }
  for (var k = 0; k < p.target.length; k++) {
    var at = p.target[k].index, r = current.boards[at].rect;
    if (!abSame(r, p.before.boards[at].rect) && !abSame(r, p.after.boards[at].rect)) return false;
    if (at === p.before.active) {
      if (!abSame(current.rulerOrigin, abImplicitOrigin(r))) return false;
      kept.rulerOrigin = p.before.rulerOrigin;
    }
    kept.boards[at].rect = p.before.boards[at].rect;
  }
  return abSame(kept, p.before);
}
function abAppendPartial(current, p) {
  if (!abOwnsAppended(p)) return false;
  var n = p.before.boards.length, boards = p.before.boards.slice(0);
  for (var k = 0; k < p.appended.length; k++) {
    var owned = p.appended[k], planned = p.after.boards[n + k], name = current.boards[n + k].name;
    if (name !== planned.name && (owned.named || owned.initialName === null || name !== owned.initialName)) return false;
    var copy = { index: planned.index, name: name, rect: planned.rect, rulerOrigin: planned.rulerOrigin };
    if (planned.presentation !== undefined) copy.presentation = planned.presentation;boards.push(copy);
  }
  var active = boards.length - 1;
  return abSame(current, { boards: boards, active: active, rulerOrigin: abImplicitOrigin(boards[active].rect), rulerUnits: p.before.rulerUnits, colorSpace: p.before.colorSpace, artwork: p.before.artwork });
}
function abRollback(state) {
  var p = state.preflight;
  try {
    var current = abReadCurrent(p);
    // A no-effect write needs no inverse. Otherwise require the EXACT captured after, never a name/ordinal alone.
    if (!abSame(current, p.before)) {
      if (abIsAdds()) {
        if (!abAppendPartial(current, p)) return { status: "indeterminate", message: "Artboard recovery refused because the complete self-created prefix is not proven." };
        for (var k = p.appended.length - 1; k >= 0; k--) p.document.artboards[p.appended[k].index].remove();
        p.document.artboards.setActiveArtboardIndex(p.before.active);
      } else if (abIsAdd()) {
        // Remove only the board this call created, and only when everything else is still the baseline.
        var n = p.before.boards.length, kept = current.boards.slice(0, n);
        if (!abOwnsAdded(p) || !abSame(kept, p.before.boards) || !abSame(current.artwork, p.before.artwork)
          || current.rulerUnits !== p.before.rulerUnits || current.colorSpace !== p.before.colorSpace
          || (p.profile === "artboard_artwork_v1" && !abSame(current, p.after))) return { status: "indeterminate", message: "Artboard recovery refused because the self-created board or baseline is not proven." };
        p.added.remove();
        // Removing the board does not restore active or the document origin; restore active explicitly.
        p.document.artboards.setActiveArtboardIndex(p.before.active);
      } else if (abIsRects()) {
        if (!abRectPartial(current, p)) return { status: "indeterminate", message: "Artboard recovery refused because the boards differ beyond the planned rects or implicit origin." };
        abWrite(p.target, p.before);
      } else if (abIsRenames()) {
        // A batch write can stop part way, so each renamed board may hold its before or its after name; nothing else may differ from the baseline.
        if (!abRenamePartial(current, p)) return { status: "indeterminate", message: "Artboard recovery refused because the boards differ from the baseline beyond the planned names." };
        abWrite(p.target, p.before);
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
  // Artboards have no PageItem row. Their names are in the shared structure digest; item and layer rows stay unchanged.
  editSessionAffected: abNameChange() ? function () { return []; } : undefined,
  initialOperationState: function () { return { mutationStarted: false, rollbackEvidence: { restoredSnapshot: null } }; },
  preflight: abResolve, plan: abPlan, revalidate: abRevalidate, applyMutation: abApply, verify: abVerify, rollback: abRollback,
  hasMutationEvidence: function (s) { return s.operationState.mutationStarted === true; },
  applyIndeterminate: function () { return { reasonCode: "artboard_state_unknown", message: "Artboard apply outcome is indeterminate.", evidence: { restoredSnapshot: null } }; },
  rollbackEvidence: function (s) { return s.operationState.rollbackEvidence; }
});
var result = { operation: "update_artboard", applied: abExecution.transaction.state === "verified", document: getDocumentContext(), plan: abExecution.plan, transaction: abExecution.transaction };
if (result.applied) result.postcondition = abExecution.value;
if (abScanMs.length > 0) result.scanMs = abScanMs;
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
    description: 'Plan or apply artboard changes: name, rect, active:true, add:{name,rect} (index = count), or renames/rects/adds arrays (1-256 entries, at most 256 boards in total). No public remove. Requires RGB (clean saved; never saved for add/adds/name/renames only, with integer pt sizes; or an open edit session for name/renames only), Illustrator frontmost and unlocked. Rect and add values are integer pt. Adds must not overlap or touch another board (artboard_overlap_unmeasured): keep gaps, including between adds. Add, active and active-rect changes need board origins [0,0] and the document origin at [-left,-bottom] of the active board, else unmeasured_ruler_origin. pixel applies only to a single rect or add with scale 1 or 2. A partial failure restores proven targets or stays indeterminate. Save after changing names, rects or adds (the document key changes); in a session, names can be mixed with supported changes before one save.',
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
        hostVersionOperation: () => 'update_artboard',
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
