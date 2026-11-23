import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema } from '../mutation-result-schema-core.js';
import { canonicalDigest, operationSafetyPolicyToMcpAnnotations } from '../operation-safety-policy-core.js';
import { OBJECT_WITNESS_HELPERS } from '../page-item-walk.js';
import { artboardSafetyAsserter, artboardSafetyRegistration, artboardTransactionSchema, classifyArtboardTerminal } from './artboard-update-safety.js';
import { ARTBOARD_CONTENT_SIGNATURE_SCRIPT } from './artboard-content-signature.js';
import { SCALE_ARTWORK_BLOCKERS, SCALE_ARTWORK_CANVAS_LIMIT, SCALE_ARTWORK_MAX_LISTED, SCALE_ARTWORK_MAX_NODES, SCALE_ARTWORK_MAX_ROOTS, SCALE_ARTWORK_NOTES, SCALE_ARTWORK_OPERATION, SCALE_ARTWORK_SAMPLE_NODES, SCALE_ARTWORK_SAMPLE_ROOTS, SCALE_ARTWORK_SCAN_DEADLINE_MS, SCALE_ARTWORK_TOLERANCE_PT, deriveScaleArtworkAfter, scaleArtworkAfterMatches, scaleArtworkAfterSchema, scaleArtworkBeforeSchema, scaleArtworkExpectedBlockers, scaleLineWidthSchema, checkScaleRequest, scaleOriginSchema, scalePercentSchema, scaleReferenceCheckSchema, scaleScopeSchema, } from '../scale-artwork-plan.js';
export const SCALE_ARTWORK_VALIDATOR = { kind: SCALE_ARTWORK_OPERATION, version: 1 };
const ADMITTED_PROFILES = ['saved_file', 'unsaved_document', 'dirty_file'];
const keySchema = z.string().min(1).max(16_384);
const layerSpec = z.union([z.strictObject({ index: z.number().int().min(0).max(10_000) }), z.strictObject({ names: z.array(z.string().min(1).max(1024)).min(1).max(3) })]);
const internalScope = z.strictObject({
    layers: z.array(layerSpec).min(1).max(16).optional(),
    targetUuids: z.array(z.string().min(1).max(256)).min(1).max(SCALE_ARTWORK_MAX_ROOTS).optional(),
});
const internalReference = z.strictObject({ pathUuid: z.string().min(1).max(256), actualMm: z.number().finite().positive().max(1_000_000) });
const origin = scaleOriginSchema;
const beforeEcho = scaleArtworkBeforeSchema, afterEcho = scaleArtworkAfterSchema;
const common = {
    expectedDocumentKey: keySchema, scalePercent: scalePercentSchema, scope: internalScope, origin, lineWidth: scaleLineWidthSchema, verifyReference: internalReference.nullable(),
};
const internalSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...common, apply: z.literal(false) }),
    z.strictObject({ ...common, apply: z.literal(true), expectedBefore: beforeEcho, confirmedAfter: afterEcho, commandId: canonicalCommandIdSchema }),
]);
const publicCommon = {
    expected_document_key: keySchema, scale_percent: scalePercentSchema, scope: scaleScopeSchema, origin: origin.optional(), line_width: scaleLineWidthSchema.optional(), verify_reference: scaleReferenceCheckSchema.optional(),
};
export const scaleArtworkPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...publicCommon, apply: z.literal(false).default(false) }),
    z.strictObject({ ...publicCommon, apply: z.literal(true), expected_before: beforeEcho, confirmed_after: afterEcho, command_id: applyCommandIdSchema }),
]);
const inputSchema = z.strictObject({ ...publicCommon, apply: z.boolean().default(false), expected_before: beforeEcho.optional(), confirmed_after: afterEcho.optional(), command_id: applyCommandIdSchema.optional() });
const echoPublished = z.record(z.string(), z.unknown());
const publishedPublicInputSchema = z.strictObject({
    expected_document_key: z.string(), scale_percent: z.number(),
    scope: z.strictObject({ layers: z.array(z.union([z.string(), z.number()])).optional(), target_uuids: z.array(z.string()).optional() }),
    origin: z.union([z.literal('selection_center'), z.strictObject({ x: z.number(), y: z.number() })]).optional(),
    line_width: scaleLineWidthSchema.optional(), verify_reference: z.strictObject({ path_uuid: z.string(), actual_mm: z.number() }).optional(),
    apply: z.boolean().default(false), expected_before: echoPublished.optional(), confirmed_after: echoPublished.optional(), command_id: applyCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedSchema } = z.toJSONSchema(publishedPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedSchema });
function normalizePublicInput(input) {
    const v = scaleArtworkPublicInputSchema.parse(input);
    checkScaleRequest({ scalePercent: v.scale_percent, ...(v.scope.layers === undefined ? {} : { layers: v.scope.layers }), ...(v.scope.target_uuids === undefined ? {} : { targetUuids: v.scope.target_uuids }) });
    const base = {
        expectedDocumentKey: v.expected_document_key, scalePercent: v.scale_percent,
        scope: v.scope.layers !== undefined ? { layers: layerSpecs(v.scope.layers) } : { targetUuids: v.scope.target_uuids },
        origin: v.origin ?? 'selection_center', lineWidth: v.line_width ?? 'keep',
        verifyReference: v.verify_reference === undefined ? null : { pathUuid: v.verify_reference.path_uuid, actualMm: v.verify_reference.actual_mm },
    };
    return v.apply ? { ...base, apply: true, expectedBefore: v.expected_before, confirmedAfter: v.confirmed_after, commandId: v.command_id } : { ...base, apply: false };
}
const blockerSchema = z.enum(SCALE_ARTWORK_BLOCKERS);
const blockedItemSchema = z.strictObject({ uuid: z.string().max(256).nullable(), type: z.string().max(64), name: z.string().max(256), reasons: z.array(z.string().min(1).max(128)).min(1).max(8) });
const requestEcho = z.strictObject({
    scalePercent: scalePercentSchema, lineWidth: scaleLineWidthSchema, origin, verifyReference: internalReference.nullable(),
    scope: z.strictObject({ kind: z.enum(['layers', 'target_uuids']), count: z.number().int().min(1).max(SCALE_ARTWORK_MAX_ROOTS) }),
});
const planSchema = z.strictObject({
    operation: z.literal(SCALE_ARTWORK_OPERATION), profile: z.literal('scale_artwork_v1'), documentKey: keySchema, documentBefore: documentContextSchema, request: requestEcho,
    before: beforeEcho, after: afterEcho, blockedItems: z.array(blockedItemSchema).max(SCALE_ARTWORK_MAX_LISTED), blockedCount: z.number().int().min(0),
    layerHasSublayers: z.boolean(), tooLarge: z.boolean(), scanDeadline: z.boolean(), referenceInvalid: z.boolean(), changesState: z.literal(true),
    notes: z.array(z.string().min(1).max(400)).max(8), applyBlockedReasonCodes: z.array(blockerSchema), applyBlockedMessage: z.string().min(1).max(500).optional(),
    confirmationStatus: z.enum(['required', 'confirmed']), applyAllowed: z.boolean(),
}).superRefine((p, ctx) => {
    if (p.documentKey !== p.documentBefore.key)
        ctx.addIssue({ code: 'custom', message: 'Plan must bind the native document context.' });
    const derived = deriveScaleArtworkAfter(p.before, { scalePercent: p.request.scalePercent, lineWidth: p.request.lineWidth, verifyReference: p.request.verifyReference });
    if (!scaleArtworkAfterMatches(derived, p.after))
        ctx.addIssue({ code: 'custom', message: 'The after must be derived from the complete before and the request.' });
    const expected = scaleArtworkExpectedBlockers({
        documentAdmitted: p.documentBefore.mutationAllowed && ADMITTED_PROFILES.includes(p.documentBefore.mutationProfile ?? ''), layerHasSublayers: p.layerHasSublayers,
        tooLarge: p.tooLarge, scanDeadline: p.scanDeadline, blockedCount: p.blockedCount, referenceInvalid: p.referenceInvalid,
    }, p.before, p.after);
    if (expected.join(',') !== p.applyBlockedReasonCodes.join(','))
        ctx.addIssue({ code: 'custom', message: 'Plan must expose exactly the blockers of its evidence.' });
    if ((p.applyBlockedMessage === undefined) !== (p.applyBlockedReasonCodes.length === 0))
        ctx.addIssue({ code: 'custom', message: 'A blocked plan carries one message, an unblocked one none.' });
    if (p.applyAllowed !== (p.confirmationStatus === 'confirmed' && p.applyBlockedReasonCodes.length === 0))
        ctx.addIssue({ code: 'custom', message: 'Invalid admission flags.' });
    if (p.blockedItems.length > Math.min(p.blockedCount, SCALE_ARTWORK_MAX_LISTED))
        ctx.addIssue({ code: 'custom', message: 'Listed blocked items cannot exceed their count.' });
});
const referenceResultSchema = z.strictObject({
    pathUuid: z.string().min(1).max(256), actualMm: z.number().positive(), lengthBeforePt: z.number().positive(), lengthAfterPt: z.number().positive(), expectedLengthPt: z.number().positive(),
    measuredMm: z.number().positive(), diffMm: z.number(), diffPercent: z.number(),
});
const postconditionSchema = z.strictObject({
    rootsCompared: z.number().int().min(0), nodesCompared: z.number().int().min(0), maxResidualPt: z.number().finite().nonnegative(), mismatchCount: z.literal(0),
    sample: z.strictObject({ roots: z.number().int().min(0), nodes: z.number().int().min(0), unmeasuredAttributes: z.number().int().min(0) }),
    boundsUnion: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(), outsideArtboardRoots: z.number().int().min(0).nullable(),
    reference: referenceResultSchema.nullable(), geometryTolerance: z.literal(SCALE_ARTWORK_TOLERANCE_PT),
});
const transactionSchema = artboardTransactionSchema(SCALE_ARTWORK_OPERATION, { restoredRoots: z.number().int().min(0).nullable(), restoredMaxResidualPt: z.number().finite().nonnegative().nullable() }, { restoredRoots: null, restoredMaxResidualPt: null }, (v) => v.restoredRoots !== null && v.restoredMaxResidualPt !== null);
const scanMsSchema = z.array(z.number().int().nonnegative()).max(16).optional();
export const scaleArtworkResultSchema = z.union([
    z.strictObject({ scanMs: scanMsSchema, operation: z.literal(SCALE_ARTWORK_OPERATION), applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ scanMs: scanMsSchema, operation: z.literal(SCALE_ARTWORK_OPERATION), applied: z.literal(true), document: documentContextSchema, plan: planSchema, postcondition: postconditionSchema, transaction: transactionSchema }),
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
        const p = r.postcondition;
        if (p.rootsCompared !== r.plan.before.roots || p.nodesCompared !== r.plan.before.nodes)
            ctx.addIssue({ code: 'custom', message: 'Verified result must compare every planned root and node.' });
        if (p.maxResidualPt > SCALE_ARTWORK_TOLERANCE_PT)
            ctx.addIssue({ code: 'custom', message: 'Every node needs a residual within the geometry tolerance.' });
    }
    if (r.transaction.state === 'rolled_back' && (r.transaction.rollback.restoredRoots !== r.plan.before.roots || (r.transaction.rollback.restoredMaxResidualPt ?? Infinity) > SCALE_ARTWORK_TOLERANCE_PT))
        ctx.addIssue({ code: 'custom', message: 'Recovery must prove every root back at its baseline.' });
});
const scaleArtworkHostResultSchema = z.preprocess((raw) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || !('phaseMs' in raw))
        return raw;
    const { phaseMs: _phaseMs, ...rest } = raw;
    return rest;
}, scaleArtworkResultSchema);
const responseSchema = z.strictObject({ outcome: scaleArtworkResultSchema, delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }) });
export const SCALE_ARTWORK_SAFETY = artboardSafetyRegistration(SCALE_ARTWORK_OPERATION);
export const SCALE_ARTWORK_SAFETY_IDENTITY = canonicalDigest(SCALE_ARTWORK_SAFETY);
const assertSafety = artboardSafetyAsserter(SCALE_ARTWORK_SAFETY, (value) => {
    const r = scaleArtworkResultSchema.parse(value);
    return { operationId: SCALE_ARTWORK_OPERATION, documentKey: r.plan.documentKey,
        identityToken: `artboard-update-v1:${canonicalDigest({ operation: SCALE_ARTWORK_OPERATION, request: r.plan.request, before: r.plan.before })}`,
        beforeState: { path: r.plan.documentBefore.path, fileRevision: r.plan.documentBefore.fileRevision, snapshot: r.plan.before }, afterState: r.plan.after,
        changeSet: { request: r.plan.request, profile: r.plan.profile },
        blocked: r.plan.applyBlockedReasonCodes.length > 0, confirmationStatus: r.plan.confirmationStatus, applyAllowed: r.plan.applyAllowed,
        transactionState: r.transaction.state, applied: r.applied };
});
export const SCALE_ARTWORK_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}${OBJECT_WITNESS_HELPERS}${ARTBOARD_CONTENT_SIGNATURE_SCRIPT}
var SA_MAX_ROOTS = ${SCALE_ARTWORK_MAX_ROOTS}, SA_MAX_NODES = ${SCALE_ARTWORK_MAX_NODES}, SA_SAMPLE_ROOTS = ${SCALE_ARTWORK_SAMPLE_ROOTS}, SA_SAMPLE_NODES = ${SCALE_ARTWORK_SAMPLE_NODES};
var SA_SAMPLE_CHARS = 1500, SA_SAMPLE_ROOT_NODES = 100, SA_DEADLINE = ${SCALE_ARTWORK_SCAN_DEADLINE_MS}, SA_CANVAS = ${SCALE_ARTWORK_CANVAS_LIMIT}, SA_TOL = ${SCALE_ARTWORK_TOLERANCE_PT}, SA_MAX_LISTED = ${SCALE_ARTWORK_MAX_LISTED};
var SA_ADMITTED = ${JSON.stringify(ADMITTED_PROFILES)};
var SA_NOTES = ${JSON.stringify(SCALE_ARTWORK_NOTES)};
var SA_TYPE_BITS = { PathItem: 1, CompoundPathItem: 2, GroupItem: 4, TextFrame: 8, PlacedItem: 16, RasterItem: 32 };
var SA_FLEX_KEYS = { baselineShift: 1, diacXOffset: 1, diacYOffset: 1, wariChuLineGap: 1, strokeWeight: 1, firstLineIndent: 1, leftIndent: 1, rightIndent: 1, spaceAfter: 1, spaceBefore: 1, hyphenationZone: 1, columnGutter: 1 };
var saScanStartedAt = 0, saScanTicks = 0, saDeadlineMs = 0, saScanMs = [], saUnmeasured = 0;
// Where the host time goes (ms per phase, in the order they run): kept out of the public result and logged by the server when call timing is on.
var saPhases = {}, saPhaseAt = new Date().getTime();
function saPhaseMs() {
  // One read of the timer per call: reading $.hiresTimer resets it, so a type check that reads it first leaves the next read with an empty interval.
  var now = new Date().getTime(), delta = now - saPhaseAt, us = -1;
  saPhaseAt = now;
  try { us = $.hiresTimer / 1000; } catch (timerError) { us = -1; }
  return (typeof us === "number" && isFinite(us) && us >= 0) ? us : delta;
}
function saPhase(name) { saPhases[name] = Math.round(((saPhases.hasOwnProperty(name) ? saPhases[name] : 0) + saPhaseMs()) * 10) / 10; }
saPhaseMs();
function saFail(message) { throw mutationError("preflight_failed", message); }
function saRound(v) { var r = Math.round(v * 1000000) / 1000000; return r === 0 ? 0 : r; }
function saAbs(v) { return v < 0 ? 0 - v : v; }
function saSame(a, b) {
  if (typeof a === "number" && typeof b === "number") return String(a) === String(b);
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if ((a instanceof Array) !== (b instanceof Array)) return false;
  var k, count = 0, other = 0;
  for (k in a) if (a.hasOwnProperty(k)) { count++; if (!b.hasOwnProperty(k) || !saSame(a[k], b[k])) return false; }
  for (k in b) if (b.hasOwnProperty(k)) other++;
  return count === other;
}
function saNums(value, length, label) {
  if (!value || value.length !== length) saFail("Geometry is unavailable at " + label + ".");
  var out = [], i;
  for (i = 0; i < length; i++) out.push(mutationFiniteNumber(value[i], label));
  return out;
}
function saTick() {
  if (saDeadlineMs > 0 && (saScanTicks++ & 31) === 0 && new Date().getTime() - saScanStartedAt > saDeadlineMs) throw mutationError("preflight_failed", "SA_SCAN_DEADLINE");
}
// Numeric lanes only: the digests never build or hash a string per node.
function saMix(lanes, v) {
  var x = witnessNumber(v);
  lanes[0] = (lanes[0] * 65599 + x) >>> 0; lanes[1] = (lanes[1] * 65537 + x + 1) >>> 0; lanes[2] = (lanes[2] + x * ((lanes[3]++ % 4093) + 1)) >>> 0;
}
function saLanesHex(lanes) { return witnessHex(lanes[0]) + witnessHex(lanes[1]) + witnessHex(lanes[2]); }
function saNewScan() {
  return { count: 0, uuid: [], type: [], depth: [], parent: [], b: [], sw: [], stroked: [], locked: [], hidden: [], rootItems: [], rootStart: [], rootCount: [], rootMask: [], rootLayer: [], rootUuid: {}, seen: {}, blocked: [], blockedCount: 0, tooLarge: false };
}
function saBlock(S, item, type, uuid, reasons) {
  S.blockedCount++;
  if (S.blocked.length < SA_MAX_LISTED) S.blocked.push({ item: item, type: type, uuid: uuid, name: null, reasons: reasons });
}
function saReadNode(S, item, parentIdx, depth, rootIdx, full) {
  if (depth > 64) saFail("Items are nested deeper than 64 levels.");
  var type = String(item.typename), n = S.count, uuid = item.uuid, b, reasons = null, kids = null, kind, m, lockedNow, i, kidCount;
  if (n >= SA_MAX_NODES) { S.tooLarge = true; throw mutationError("preflight_failed", "SA_TOO_LARGE"); }
  if (typeof uuid !== "string" || uuid.length < 1 || uuid.length > 256 || S.seen.hasOwnProperty("u:" + uuid)) saFail("Complete native artwork identity is unavailable (a missing or repeated UUID).");
  S.seen["u:" + uuid] = true;
  b = saNums(item.geometricBounds, 4, "geometricBounds");
  saTick();
  S.count++; S.uuid.push(uuid); S.type.push(type); S.depth.push(depth); S.parent.push(parentIdx); S.b.push(b[0], b[1], b[2], b[3]);
  lockedNow = item.locked === true;
  S.locked.push(lockedNow); S.hidden.push(item.hidden === true);
  S.rootMask[rootIdx] = S.rootMask[rootIdx] | (SA_TYPE_BITS.hasOwnProperty(type) ? SA_TYPE_BITS[type] : 64);
  if (full) {
    reasons = [];
    if (!SA_TYPE_BITS.hasOwnProperty(type)) reasons.push("unsupported_type:" + type);
    if (lockedNow) reasons.push("locked_item");
    if (S.hidden[n]) reasons.push("hidden_item");
  }
  if (type === "PathItem") {
    S.stroked.push(item.stroked === true); S.sw.push(mutationFiniteNumber(item.strokeWidth, "strokeWidth"));
    if (full && item.guides === true) reasons.push("guide");
  } else { S.stroked.push(false); S.sw.push(null); }
  if (type === "GroupItem") kids = item.pageItems;
  else if (type === "CompoundPathItem") {
    kids = item.pathItems;
    if (full && item.groupItems && item.groupItems.length > 0) reasons.push("compound_group_children");
  } else if (type === "TextFrame" && full) {
    kind = String(item.kind);
    if (kind !== "TextType.POINTTEXT") reasons.push("unsupported_text_kind:" + kind);
    else if (String(item.orientation) !== "TextOrientation.HORIZONTAL") reasons.push("unsupported_text_kind:vertical");
    else {
      m = item.matrix;
      if (!m || saAbs(m.mValueA - 1) > 0.000001 || saAbs(m.mValueD - 1) > 0.000001 || saAbs(m.mValueB) > 0.000001 || saAbs(m.mValueC) > 0.000001) reasons.push("target_transform_unmeasured");
    }
  }
  if (reasons !== null && reasons.length > 0) saBlock(S, item, type, uuid, reasons);
  if (kids !== null) { kidCount = kids.length; for (i = 0; i < kidCount; i++) saReadNode(S, kids[i], n, depth + 1, rootIdx, full); }
}
function saScanRoots(S, entries, full) {
  var r, item, layerReasons;
  for (r = 0; r < entries.length; r++) {
    item = entries[r].item;
    S.rootItems.push(item); S.rootStart.push(S.count); S.rootMask.push(0); S.rootLayer.push(entries[r].layer);
    saReadNode(S, item, -1, 0, r, full);
    S.rootCount.push(S.count - S.rootStart[r]); S.rootUuid["u:" + S.uuid[S.rootStart[r]]] = r;
  }
}
// The roots of the scope: every top-level item of the listed layers, or the listed items (each a top-level item of a layer).
function saEntries(doc, E) {
  var specs = params.scope.layers, targets = params.scope.targetUuids, k, v, li, found, nm, layer, spec, j, total = 0, resolved, item, par, info, seenLayer = {};
  if (specs) {
    for (k = 0; k < specs.length; k++) {
      spec = specs[k]; found = -1;
      if (spec.index !== undefined) { if (spec.index >= doc.layers.length) saFail("Layer index " + spec.index + " does not exist."); found = spec.index; }
      else {
        for (li = 0; li < doc.layers.length; li++) {
          nm = String(doc.layers[li].name);
          for (v = 0; v < spec.names.length; v++) if (nm === spec.names[v]) { if (found >= 0 && found !== li) saFail("Layer name is ambiguous: " + spec.names[0]); found = li; }
        }
        if (found < 0) saFail("Layer not found: " + spec.names[0]);
      }
      if (seenLayer.hasOwnProperty("l" + found)) saFail("A layer is listed twice.");
      seenLayer["l" + found] = true;
      layer = doc.layers[found];
      info = { index: found, name: String(layer.name), roots: 0, nodes: 0, layer: layer };
      E.layers.push(info);
      if (layer.layers.length !== 0) E.sublayers = true;
      if (layer.locked === true) E.layerReasons.push({ name: info.name, reason: "locked_layer" });
      if (layer.visible !== true) E.layerReasons.push({ name: info.name, reason: "hidden_layer" });
    }
    // Only the layer's own top-level items are roots (an item whose parent is not the layer is a descendant listed by a group or a compound path).
    for (k = 0; k < E.layers.length; k++) {
      layer = E.layers[k].layer;
      for (j = 0; j < layer.pageItems.length; j++) {
        item = layer.pageItems[j];
        if (String(item.parent.typename) !== "Layer") continue;
        if (++total > SA_MAX_ROOTS) { E.tooLarge = true; E.rootTotal = total; return; }
        E.layers[k].roots++;
        E.entries.push({ item: item, layer: k });
      }
    }
    E.rootTotal = total;
    return;
  }
  for (k = 0; k < targets.length; k++) {
    resolved = resolvePageItem(doc, targets[k]);
    if (resolved === null) saFail("target_not_found: no PageItem with UUID " + targets[k] + " exists in the bound document.");
    item = resolved.item;
    if (item.uuid !== targets[k]) saFail("target_not_found: the native UUID of " + targets[k] + " could not be confirmed.");
    par = item.parent;
    if (!par || String(par.typename) !== "Layer") saFail("target_not_root: " + targets[k] + " is not a top-level item of a layer.");
    layer = par;
    if (layer.parent && String(layer.parent.typename) === "Layer") E.sublayers = true;
    if (layer.locked === true) E.layerReasons.push({ name: String(layer.name), reason: "locked_layer" });
    if (layer.visible !== true) E.layerReasons.push({ name: String(layer.name), reason: "hidden_layer" });
    E.entries.push({ item: item, layer: 0 });
  }
  E.rootTotal = E.entries.length;
}
// What a designer sees: the union of the roots' geometric bounds and its centre.
function saUnion(S) {
  var out = null, r, o, b;
  for (r = 0; r < S.rootStart.length; r++) {
    o = S.rootStart[r] * 4; b = [S.b[o], S.b[o + 1], S.b[o + 2], S.b[o + 3]];
    if (out === null) out = b;
    else { out[0] = Math.min(out[0], b[0]); out[1] = Math.max(out[1], b[1]); out[2] = Math.max(out[2], b[2]); out[3] = Math.min(out[3], b[3]); }
  }
  return out;
}
function saRoundAll(list) { var out = [], i; for (i = 0; i < list.length; i++) out.push(saRound(list[i])); return out; }
function saScaleRect(r, o, f) { return [o[0] + f * (r[0] - o[0]), o[1] + f * (r[1] - o[1]), o[0] + f * (r[2] - o[0]), o[1] + f * (r[3] - o[1])]; }
function saDigests(S) {
  var roots = [0, 0, 0, 0], nodes = [0, 0, 0, 0], r, i, o, h;
  for (r = 0; r < S.rootStart.length; r++) {
    h = witnessText(S.uuid[S.rootStart[r]]);
    roots[0] = (roots[0] * 65599 + h[0]) >>> 0; roots[1] = (roots[1] * 65537 + h[1]) >>> 0;
    saMix(roots, S.rootLayer[r]); saMix(roots, S.rootCount[r]); saMix(roots, S.rootMask[r]);
    o = S.rootStart[r] * 4;
    for (i = 0; i < 4; i++) saMix(roots, S.b[o + i]);
  }
  for (i = 0; i < S.count; i++) {
    saMix(nodes, S.parent[i]); saMix(nodes, S.depth[i]); saMix(nodes, S.type[i].length); saMix(nodes, S.sw[i] === null ? -1 : S.sw[i]);
    saMix(nodes, S.locked[i] ? 1 : 0); saMix(nodes, S.hidden[i] ? 1 : 0);
    o = i * 4; saMix(nodes, S.b[o]); saMix(nodes, S.b[o + 1]); saMix(nodes, S.b[o + 2]); saMix(nodes, S.b[o + 3]);
  }
  return { roots: saLanesHex(roots), nodes: saLanesHex(nodes) };
}
// The sample: one root of every distinct mix of types first, then evenly spaced roots; small roots only, so a sample costs about a second.
function saSampleRoots(S) {
  var picked = [], taken = {}, seen = {}, nodes = 0, r, step, cost, mask;
  function take(index) {
    if (taken.hasOwnProperty("r" + index)) return;
    cost = S.rootCount[index];
    if (cost > SA_SAMPLE_ROOT_NODES || nodes + cost > SA_SAMPLE_NODES || picked.length >= SA_SAMPLE_ROOTS) return;
    taken["r" + index] = true; nodes += cost; picked.push(index);
  }
  for (r = 0; r < S.rootStart.length; r++) { mask = S.rootMask[r]; if (!seen.hasOwnProperty("m" + mask) && S.rootCount[r] <= SA_SAMPLE_ROOT_NODES) { seen["m" + mask] = true; if (picked.length < 12) take(r); } }
  step = Math.max(1, Math.floor(S.rootStart.length / (SA_SAMPLE_ROOTS - 12)));
  for (r = 0; r < S.rootStart.length; r += step) take(r);
  picked.sort(function (a, b) { return a - b; });
  return picked;
}
function saSampleRead(S) {
  var picked = saSampleRoots(S), out = [], i, sig, nodes = 0, chars = 0, item, reason;
  for (i = 0; i < picked.length; i++) {
    item = S.rootItems[picked[i]];
    try { sig = daSignature(item); } catch (error) { continue; }
    if (sig.refusal === "empty_text") continue;
    if (chars + sig.chars > SA_SAMPLE_CHARS) continue;
    if (sig.refusal !== null) { saBlock(S, item, String(item.typename), S.uuid[S.rootStart[picked[i]]], [sig.refusal]); continue; }
    if (sig.nodes !== S.rootCount[picked[i]]) saFail("The sample signature and the scan disagree about the structure of an item.");
    chars += sig.chars; nodes += sig.nodes; out.push({ root: picked[i], sig: sig });
  }
  return { entries: out, nodes: nodes };
}
function saPathLength(item) {
  var count = item.pathPoints.length, last, i, p0, p1, a, b, c, d, len = 0, s, t, u, x, y, px, py, curve, closed = item.closed === true;
  if (count < 2 || count > 20000) return -1;
  last = closed ? count : count - 1;
  for (i = 0; i < last; i++) {
    p0 = item.pathPoints[i]; p1 = item.pathPoints[(i + 1) % count];
    a = saNums(p0.anchor, 2, "anchor"); b = saNums(p0.rightDirection, 2, "rightDirection"); c = saNums(p1.leftDirection, 2, "leftDirection"); d = saNums(p1.anchor, 2, "anchor");
    curve = b[0] !== a[0] || b[1] !== a[1] || c[0] !== d[0] || c[1] !== d[1];
    if (!curve) { len += Math.sqrt((d[0] - a[0]) * (d[0] - a[0]) + (d[1] - a[1]) * (d[1] - a[1])); continue; }
    px = a[0]; py = a[1];
    for (s = 1; s <= 32; s++) {
      t = s / 32; u = 1 - t;
      x = u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0]; y = u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1];
      len += Math.sqrt((x - px) * (x - px) + (y - py) * (y - py)); px = x; py = y;
    }
  }
  return len;
}
// The reference path must be a PathItem inside the scope (not a compound path member); returns its item and length, or a reason.
function saReference(doc, S) {
  var ref = params.verifyReference, resolved, item, par, top, length;
  if (ref === null) return { ok: true, item: null, length: 0 };
  resolved = resolvePageItem(doc, ref.pathUuid);
  if (resolved === null || resolved.typename !== "PathItem") return { ok: false, message: "the reference path " + ref.pathUuid + " is not a PathItem of the bound document" };
  item = resolved.item;
  if (item.uuid !== ref.pathUuid) return { ok: false, message: "the native UUID of the reference path could not be confirmed" };
  top = item; par = item.parent;
  while (par && String(par.typename) !== "Layer") {
    if (String(par.typename) === "CompoundPathItem") return { ok: false, message: "the reference path is a member of a compound path" };
    top = par; par = par.parent;
  }
  if (!par || !S.rootUuid.hasOwnProperty("u:" + top.uuid)) return { ok: false, message: "the reference path is not inside the scope" };
  length = saPathLength(item);
  if (!(length > 0)) return { ok: false, message: "the reference path has no length" };
  return { ok: true, item: item, length: length };
}
function saBlockerOrder(found) {
  var order = ${JSON.stringify(SCALE_ARTWORK_BLOCKERS)}, out = [], i, j;
  for (i = 0; i < order.length; i++) for (j = 0; j < found.length; j++) if (found[j] === order[i]) { out.push(order[i]); break; }
  return out;
}
function saResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var doc = app.activeDocument, S = saNewScan(), E = { entries: [], layers: [], layerReasons: [], sublayers: false, tooLarge: false, rootTotal: 0 }, deadline = false, admitted = false;
  var i, j, message, found = [], messages = [], union, origin, boundsUnion, digests, sample = { entries: [], nodes: 0 }, ref = { ok: true, item: null, length: 0 }, before, after, blockedItems = [], blockedCount, types = {}, layers = [];
  saPhase("context");
  saDeadlineMs = SA_DEADLINE; saScanStartedAt = new Date().getTime(); saScanTicks = 0;
  try {
    saEntries(doc, E); saPhase("entries");
    if (!E.tooLarge) { saScanRoots(S, E.entries, true); saPhase("scan"); sample = saSampleRead(S); saPhase("sample"); ref = saReference(doc, S); saPhase("reference"); }
  } catch (scanError) {
    message = String(scanError && scanError.message);
    if (String(message).indexOf("SA_SCAN_DEADLINE") >= 0) deadline = true;
    else if (String(message).indexOf("SA_TOO_LARGE") >= 0) E.tooLarge = true;
    else throw scanError;
  }
  saScanMs.push(new Date().getTime() - saScanStartedAt);
  saDeadlineMs = 0;
  for (i = 0; i < S.rootStart.length; i++) if (E.layers.length > 0 && S.rootLayer[i] < E.layers.length) E.layers[S.rootLayer[i]].nodes += S.rootCount[i];
  for (i = 0; i < S.count; i++) types[S.type[i]] = types.hasOwnProperty(S.type[i]) ? types[S.type[i]] + 1 : 1;
  union = (E.tooLarge || deadline) ? null : saUnion(S);
  boundsUnion = union === null ? null : saRoundAll(union);
  if (union === null) origin = null;
  else if (params.origin === "selection_center") origin = [saRound((boundsUnion[0] + boundsUnion[2]) / 2), saRound((boundsUnion[1] + boundsUnion[3]) / 2)];
  else origin = [saRound(params.origin.x), saRound(params.origin.y)];
  digests = saDigests(S); saPhase("summaryDigest");
  for (i = 0; i < E.layers.length; i++) layers.push({ index: E.layers[i].index, name: E.layers[i].name, roots: E.layers[i].roots, nodes: E.layers[i].nodes });
  before = { layers: layers, roots: E.tooLarge ? E.rootTotal : S.rootStart.length, nodes: S.count, types: types, boundsUnion: boundsUnion, origin: origin, rootsDigest: digests.roots, nodesDigest: digests.nodes,
    sample: { roots: sample.entries.length, nodes: sample.nodes }, reference: ref.ok && ref.item !== null ? { pathUuid: params.verifyReference.pathUuid, lengthPt: saRound(ref.length) } : null };
  after = { scalePercent: params.scalePercent, lineWidth: params.lineWidth, origin: origin,
    boundsUnion: boundsUnion === null ? null : saRoundAll(saScaleRect(boundsUnion, origin, params.scalePercent / 100)),
    reference: before.reference === null ? null : { pathUuid: params.verifyReference.pathUuid, actualMm: params.verifyReference.actualMm, expectedLengthPt: saRound(before.reference.lengthPt * params.scalePercent / 100) } };
  blockedCount = S.blockedCount + E.layerReasons.length;
  for (i = 0; i < S.blocked.length; i++) blockedItems.push({ uuid: S.blocked[i].uuid, type: S.blocked[i].type, name: String(S.blocked[i].item.name).substring(0, 256), reasons: S.blocked[i].reasons });
  for (i = 0; i < E.layerReasons.length && blockedItems.length < SA_MAX_LISTED; i++) blockedItems.push({ uuid: null, type: "Layer", name: E.layerReasons[i].name.substring(0, 256), reasons: [E.layerReasons[i].reason] });
  for (i = 0; i < SA_ADMITTED.length; i++) if (context.mutationProfile === SA_ADMITTED[i]) admitted = true;
  if (!context.mutationAllowed || !admitted) found.push("document_mutation_not_allowed");
  if (E.sublayers) { found.push("layer_has_sublayers"); messages.push("a layer of the scope has sublayers, which this operation has not measured"); }
  if (E.tooLarge) { found.push("scale_set_too_large"); messages.push("the scope has more than " + SA_MAX_ROOTS + " top-level items or " + SA_MAX_NODES + " items in all; split it with an explicit origin"); }
  if (deadline) { found.push("scan_deadline"); messages.push("the scan exceeded " + SA_DEADLINE + " ms; split the scope with an explicit origin"); }
  if (!E.tooLarge && !deadline && S.rootStart.length === 0) { found.push("nothing_to_scale"); messages.push("the scope holds no items"); }
  if (blockedCount > 0) { found.push("items_blocked"); messages.push(blockedCount + " item(s) cannot be scaled: " + (blockedItems.length > 0 ? blockedItems[0].name + " (" + blockedItems[0].reasons.join(", ") + ")" : "")); }
  if (after.boundsUnion !== null && (saAbs(after.boundsUnion[0]) > SA_CANVAS || saAbs(after.boundsUnion[1]) > SA_CANVAS || saAbs(after.boundsUnion[2]) > SA_CANVAS || saAbs(after.boundsUnion[3]) > SA_CANVAS)) { found.push("result_out_of_canvas"); messages.push("the scaled drawing would leave the +/-" + SA_CANVAS + " pt canvas"); }
  if (!ref.ok) { found.push("reference_invalid"); messages.push(ref.message); }
  var blockers = saBlockerOrder(found), text = null;
  if (blockers.length > 0) { text = messages.join("; "); if (text.length > 500) text = text.substring(0, 497) + "..."; if (text.length === 0) text = "The change is blocked: " + blockers.join(", ") + "."; }
  if (forApply) {
    if (!saSame(before, params.expectedBefore)) saFail("expected_before does not match the complete state of the scope.");
    if (!saSame(after, params.confirmedAfter)) saFail("confirmed_after does not match the derived plan.");
    if (blockers.length > 0) saFail(text);
  }
  saPhase("assemble");
  return { context: context, document: doc, S: S, sample: sample, reference: ref, before: before, after: after, origin: origin, blockers: blockers, message: text, blockedItems: blockedItems, blockedCount: blockedCount,
    sublayers: E.sublayers, tooLarge: E.tooLarge, deadline: deadline, referenceInvalid: !ref.ok };
}
function saPlan(p) {
  var scopeKind = params.scope.layers ? "layers" : "target_uuids", count = params.scope.layers ? params.scope.layers.length : params.scope.targetUuids.length;
  var plan = { operation: "scale_artwork", profile: "scale_artwork_v1", documentKey: p.context.key, documentBefore: p.context,
    request: { scalePercent: params.scalePercent, lineWidth: params.lineWidth, origin: params.origin, verifyReference: params.verifyReference, scope: { kind: scopeKind, count: count } },
    before: p.before, after: p.after, blockedItems: p.blockedItems, blockedCount: p.blockedCount, layerHasSublayers: p.sublayers, tooLarge: p.tooLarge, scanDeadline: p.deadline,
    referenceInvalid: p.referenceInvalid, changesState: true, notes: SA_NOTES, applyBlockedReasonCodes: p.blockers };
  if (p.message !== null) plan.applyBlockedMessage = p.message;
  plan.confirmationStatus = params.apply === true ? "confirmed" : "required";
  plan.applyAllowed = params.apply === true && p.blockers.length === 0;
  return plan;
}
// The preflight of this same call has just read the complete before; nothing runs between it and the apply, so the revalidation re-reads the roots' identities only.
function saRevalidate(p) {
  try {
    var S = p.S, i;
    if (app.documents.length === 0 || app.activeDocument !== p.document) saFail("Document reference changed before apply.");
    for (i = 0; i < S.rootItems.length; i++) if (S.rootItems[i].uuid !== S.uuid[S.rootStart[i]]) saFail("An item identity changed before apply.");
    saPhase("revalidate");
  } catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "The items changed before apply.")); }
}
function saApply(p, plan, state) {
  var S = p.S, f = params.scalePercent, O = p.origin, i, o, cx, cy, item, lw = params.lineWidth === "scale" ? f : 100, attempted = state.operationState.attempted;
  state.operationState.mutationStarted = true;
  for (i = 0; i < S.rootItems.length; i++) {
    o = S.rootStart[i] * 4; cx = (S.b[o] + S.b[o + 2]) / 2; cy = (S.b[o + 1] + S.b[o + 3]) / 2;
    attempted.push(i); item = S.rootItems[i];
    try { item.resize(f, f, true, false, false, false, lw, Transformation.CENTER); } catch (error) { mutationNativeFailure("resize", error); }
    try { item.translate((f / 100 - 1) * (cx - O[0]), (f / 100 - 1) * (cy - O[1]), true, false, false, false); } catch (error2) { mutationNativeFailure("translate", error2); }
  }
  saPhase("write");
}
function saClose(a, b, abs, rel) { return saAbs(a - b) <= abs + rel * saAbs(b); }
function saScaled(a, b, f) { var x = Number(a), y = Number(b); return isFinite(x) && isFinite(y) && a !== "" && b !== "" && saClose(y, x * f, 0.001, 0.0002); }
function saEither(a, b, f) { return a === b || saScaled(a, b, f); }
// Parts that scale: stroke width, dashes and dash offset (with line_width scale), character size and leading; the others of this list are recorded as unmeasured.
function saTablePart(a, b, f) {
  var x = a.split(";"), y = b.split(";"), i, kx, ky, k;
  if (x.length !== y.length) return false;
  for (i = 0; i < x.length; i++) {
    if (x[i] === y[i]) continue;
    k = String(x[i]).indexOf("="); kx = x[i].substring(0, k); ky = y[i].substring(0, String(y[i]).indexOf("="));
    if (kx !== ky || !SA_FLEX_KEYS.hasOwnProperty(kx) || !saEither(x[i].substring(k + 1), y[i].substring(String(y[i]).indexOf("=") + 1), f)) return false;
    saUnmeasured++;
  }
  return true;
}
function saRunPart(a, b, f) {
  var x = a.split(","), y = b.split(","), i, last;
  if (x.length !== y.length || x.length < 11) return false;
  last = x.length - 1;
  for (i = 0; i < x.length; i++) {
    // The size and the leading must follow the factor even when the text is the same before and after (an unscaled size is a failure); a value that is not a number cannot be judged and must be equal.
    if (i === 0 || i === 3) { if (x[i] === y[i] && !isFinite(Number(x[i]))) continue; if (!saScaled(x[i], y[i], f)) return false; continue; }
    if (x[i] === y[i]) continue;
    if (i === 7 || i === last) { if (!saScaled(x[i], y[i], f)) return false; saUnmeasured++; }
    else return false;
  }
  return true;
}
function saUnquote(v) { var t = String(v); return t.substring(0, 2) === "s:" ? t.substring(2) : t; }
// A part that is the same before and after is still a failure when it should have followed the factor: a text run (size, leading) and, with line_width scale on a stroked item, a dash list that is not empty.
function saMustScale(part, stroked, keepLines) {
  var k = String(part).indexOf("="), name = k < 0 ? String(part) : String(part).substring(0, k);
  if (name === "run") return true;
  return name === "strokeDashes" && stroked && !keepLines && saUnquote(String(part).substring(k + 1)) !== "";
}
function saPartEqual(a, b, f, keepLines) {
  var k = String(a).indexOf("="), name = k < 0 ? a : a.substring(0, k), va = a.substring(k + 1), vb = b.substring(String(b).indexOf("=") + 1), x, y, i;
  if (b.substring(0, String(b).indexOf("=")) !== name) return false;
  if (name === "strokeWidth" || name === "strokeDashOffset") return !keepLines && saScaled(va, vb, f);
  if (name === "strokeDashes") {
    if (keepLines) return false;
    // The signature writes a string as "s:" + the text (daCanon): the dash list is compared by its numbers.
    if (saUnquote(va) === "" && saUnquote(vb) === "") return true;
    x = saUnquote(va).split(","); y = saUnquote(vb).split(",");
    if (x.length !== y.length) return false;
    for (i = 0; i < x.length; i++) if (!saScaled(x[i], y[i], f)) return false;
    return true;
  }
  if (name === "run") return saRunPart(va, vb, f);
  if (name === "charFirst" || name === "charMid" || name === "charLast" || name === "paragraph" || name === "frame") return saTablePart(va, vb, f);
  return false;
}
// Where each node's numbers sit in sig.geo (14 common, then the type's own) so that the positions can be compared with the affine map and the others skipped.
// The translation of a text or image matrix is skipped (its position is verified by the geometric bounds of every node; only the linear part is compared).
function saLayout(sig) {
  var pos = 0, skip = {}, kinds = [], node = null, i, part, j;
  function finish() {
    if (node === null) return;
    for (j = 4; j < 14; j++) skip[pos + j] = true;
    pos += 14;
    if (node.type === "PathItem") pos += 6 * node.points;
    else if (node.type === "TextFrame") { if (!node.err) { skip[pos] = true; skip[pos + 1] = true; kinds.push("text"); pos += 2; } pos += 2; }
    else if (node.type === "PlacedItem" || node.type === "RasterItem") { if (!node.err) { skip[pos] = true; skip[pos + 1] = true; kinds.push("image"); pos += 2; } }
  }
  for (i = 0; i < sig.parts.length; i++) {
    part = sig.parts[i];
    if (String(part).indexOf("type=") === 0) { finish(); node = { type: part.substring(5), points: 0, err: false }; }
    else if (node !== null && part === "matrix=err") node.err = true;
    else if (node !== null && node.type === "PathItem" && String(part).indexOf("points=") === 0) node.points = Number(part.substring(7));
  }
  finish();
  return { skip: skip, kinds: kinds, length: pos };
}
function saCompareScaled(src, dst, O, f, keepLines) {
  var res = { ok: false, reason: null, maxResidual: 0 }, i, k, layout, residual, expected, lin, same, scaled, kind, stroked = false;
  if (src.parts.length !== dst.parts.length) { res.reason = "structure_differs"; return res; }
  for (i = 0; i < src.parts.length; i++) {
    if (String(src.parts[i]).substring(0, 5) === "type=") stroked = false;
    if (src.parts[i] === "stroked=true") stroked = true;
    if (src.parts[i] === dst.parts[i] && !saMustScale(src.parts[i], stroked, keepLines)) continue;
    if (!saPartEqual(src.parts[i], dst.parts[i], f, keepLines)) { res.reason = "attribute_differs:" + src.parts[i].substring(0, String(src.parts[i]).indexOf("=")); return res; }
  }
  if (src.geo.length !== dst.geo.length || src.lin.length !== dst.lin.length || src.gfix.length !== dst.gfix.length) { res.reason = "geometry_length_differs"; return res; }
  layout = saLayout(src);
  if (layout.length !== src.geo.length) { res.reason = "geometry_layout_unknown"; return res; }
  for (i = 0; i < src.geo.length; i++) {
    if (layout.skip.hasOwnProperty(i)) continue;
    expected = i % 2 === 0 ? O[0] + f * (src.geo[i] - O[0]) : O[1] + f * (src.geo[i] - O[1]);
    residual = saAbs(dst.geo[i] - expected);
    if (residual > SA_TOL) { res.reason = "geometry_beyond_tolerance"; res.maxResidual = residual; return res; }
    if (residual > res.maxResidual) res.maxResidual = residual;
  }
  if (layout.kinds.length * 4 !== src.lin.length) { res.reason = "matrix_layout_unknown"; return res; }
  for (k = 0; k < layout.kinds.length; k++) {
    same = true; scaled = true;
    for (i = 0; i < 4; i++) {
      if (saAbs(dst.lin[k * 4 + i] - src.lin[k * 4 + i]) > 0.000001) same = false;
      if (!saClose(dst.lin[k * 4 + i], src.lin[k * 4 + i] * f, 0.000001, 0.0001)) scaled = false;
    }
    if (!(layout.kinds[k] === "text" ? (same || scaled) : scaled)) { res.reason = "matrix_linear_part_differs"; return res; }
  }
  for (i = 1; i < src.gfix.length; i += 10) if (!saClose(dst.gfix[i], src.gfix[i] * f, 0.001, 0.0002)) { res.reason = "gradient_length_differs"; return res; }
  res.ok = true;
  return res;
}
function saRead(p) {
  if (app.documents.length === 0 || app.activeDocument !== p.document) saFail("Document reference changed.");
  var current = getDocumentContext();
  if (current.path !== p.context.path || current.fileRevision !== p.context.fileRevision || current.name !== p.context.name || current.appVersion !== p.context.appVersion) saFail("The document file identity changed after apply.");
}
function saVerify(p, plan, state) {
  saRead(p);
  var S = p.S, f = params.scalePercent / 100, O = p.origin, T, entries = [], i, o, expected, residual, worst = 0, mismatches = 0, first = [], keepLines = params.lineWidth !== "scale", sw, reason, startedAt = new Date().getTime();
  function note(text) { mismatches++; if (first.length < 3) first.push(text); }
  for (i = 0; i < S.rootItems.length; i++) entries.push({ item: S.rootItems[i], layer: S.rootLayer[i] });
  T = saNewScan();
  saDeadlineMs = 0;
  saScanRoots(T, entries, false);
  saScanMs.push(new Date().getTime() - startedAt); saPhase("verifyScan");
  if (T.count !== S.count || T.rootStart.length !== S.rootStart.length) throw mutationError("verify_mismatch", "The item count changed: " + S.count + " before, " + T.count + " after.");
  for (i = 0; i < S.count; i++) {
    if (T.uuid[i] !== S.uuid[i] || T.type[i] !== S.type[i] || T.parent[i] !== S.parent[i] || T.depth[i] !== S.depth[i]) { note("the structure changed at node " + i + " (" + S.type[i] + ")"); continue; }
    if (T.locked[i] !== S.locked[i] || T.hidden[i] !== S.hidden[i]) { note("lock or visibility changed at node " + i + " (" + S.type[i] + ")"); continue; }
    o = i * 4;
    expected = saScaleRect([S.b[o], S.b[o + 1], S.b[o + 2], S.b[o + 3]], O, f);
    residual = Math.max(saAbs(T.b[o] - expected[0]), saAbs(T.b[o + 1] - expected[1]), saAbs(T.b[o + 2] - expected[2]), saAbs(T.b[o + 3] - expected[3]));
    if (residual > worst) worst = residual;
    if (residual > SA_TOL) note("bounds of node " + i + " (" + S.type[i] + ") are " + saRound(residual) + " pt from the prediction");
    if (S.sw[i] !== null && S.stroked[i]) {
      sw = T.sw[i];
      if (keepLines ? saAbs(sw - S.sw[i]) > 0.001 : !saClose(sw, S.sw[i] * f, 0.001, 0.0001)) note("stroke width of node " + i + " is " + sw + ", was " + S.sw[i]);
    }
  }
  saPhase("verifyCompare");
  var sampleNodes = 0;
  saUnmeasured = 0;
  for (i = 0; i < p.sample.entries.length; i++) {
    var entry = p.sample.entries[i], after = daSignature(S.rootItems[entry.root]), cmp;
    if (after.refusal !== null || after.nodes !== entry.sig.nodes) { note("the sampled item " + entry.root + " changed its structure"); continue; }
    cmp = saCompareScaled(entry.sig, after, O, f, keepLines);
    if (!cmp.ok) note("the sampled item " + entry.root + " did not scale as planned (" + cmp.reason + ")");
    else { sampleNodes += entry.sig.nodes; if (cmp.maxResidual > worst) worst = cmp.maxResidual; }
  }
  saPhase("verifySample");
  if (mismatches > 0) throw mutationError("verify_mismatch", mismatches + " mismatch(es): " + first.join("; "));
  var after2 = p.after, union = saRoundAll(saUnion(T)), outside = null, boards, b, r, j, hit, outsideCount = 0, rootBounds;
  boards = app.activeDocument.artboards;
  if (boards.length <= 256) {
    var rects = [];
    for (j = 0; j < boards.length; j++) rects.push(boards[j].artboardRect);
    for (r = 0; r < T.rootStart.length; r++) {
      o = T.rootStart[r] * 4; hit = false;
      for (j = 0; j < rects.length; j++) if (T.b[o] <= rects[j][2] && T.b[o + 2] >= rects[j][0] && T.b[o + 3] <= rects[j][1] && T.b[o + 1] >= rects[j][3]) { hit = true; break; }
      if (!hit) outsideCount++;
    }
    outside = outsideCount;
  }
  var reference = null, lengthAfter;
  if (p.reference.item !== null) {
    lengthAfter = saPathLength(p.reference.item);
    if (!(lengthAfter > 0)) throw mutationError("verify_mismatch", "The reference path could not be measured after the change.");
    var mm = lengthAfter * 25.4 / 72;
    reference = { pathUuid: params.verifyReference.pathUuid, actualMm: params.verifyReference.actualMm, lengthBeforePt: saRound(p.reference.length), lengthAfterPt: saRound(lengthAfter), expectedLengthPt: after2.reference.expectedLengthPt,
      measuredMm: saRound(mm), diffMm: saRound(mm - params.verifyReference.actualMm), diffPercent: saRound((mm - params.verifyReference.actualMm) / params.verifyReference.actualMm * 100) };
  }
  saPhase("verifyTail");
  return { rootsCompared: T.rootStart.length, nodesCompared: T.count, maxResidualPt: worst, mismatchCount: 0, sample: { roots: p.sample.entries.length, nodes: sampleNodes, unmeasuredAttributes: saUnmeasured },
    boundsUnion: union, outsideArtboardRoots: outside, reference: reference, geometryTolerance: SA_TOL };
}
// Each attempted item back by the factor it shows (current extent / extent before), then to its centre before; an item that is neither at the scale nor at the baseline is indeterminate.
function saExtent(b) { var w = b[2] - b[0], h = b[1] - b[3]; return w > h ? w : h; }
function saRollback(state) {
  var p = state.preflight, S = p.S, attempted = state.operationState.attempted, i, root, o, before, now, extent0, extent1, obs, c0, c1, f = params.scalePercent / 100, worst = 0, item, residual;
  try {
    if (app.documents.length === 0 || app.activeDocument !== p.document) return { status: "indeterminate", message: "Rollback document is indeterminate." };
    for (i = attempted.length - 1; i >= 0; i--) {
      root = attempted[i]; o = S.rootStart[root] * 4; item = S.rootItems[root];
      before = [S.b[o], S.b[o + 1], S.b[o + 2], S.b[o + 3]]; now = saNums(item.geometricBounds, 4, "geometricBounds");
      extent0 = saExtent(before); extent1 = saExtent(now);
      if (extent0 <= 0.000001) { if (saExtent(now) > SA_TOL) return { status: "indeterminate", message: "Rollback refused because an item without extent changed." }; continue; }
      obs = extent1 / extent0;
      if (!(saAbs(obs - 1) < 0.000001 || saAbs(obs - f) <= 0.0001 * f)) return { status: "indeterminate", message: "Rollback refused because an item is neither at its baseline nor at the planned scale." };
      if (saAbs((now[2] - now[0]) - obs * (before[2] - before[0])) > SA_TOL * Math.max(1, obs) || saAbs((now[1] - now[3]) - obs * (before[1] - before[3])) > SA_TOL * Math.max(1, obs)) return { status: "indeterminate", message: "Rollback refused because an item is not a uniform scale of its baseline." };
      if (saAbs(obs - 1) >= 0.000001) { item.resize(100 / obs, 100 / obs, true, false, false, false, params.lineWidth === "scale" ? 100 / obs : 100, Transformation.CENTER); now = saNums(item.geometricBounds, 4, "geometricBounds"); }
      c0 = [(before[0] + before[2]) / 2, (before[1] + before[3]) / 2]; c1 = [(now[0] + now[2]) / 2, (now[1] + now[3]) / 2];
      if (saAbs(c0[0] - c1[0]) > 0.000001 || saAbs(c0[1] - c1[1]) > 0.000001) item.translate(c0[0] - c1[0], c0[1] - c1[1], true, false, false, false);
    }
    for (i = 0; i < S.rootItems.length; i++) {
      o = S.rootStart[i] * 4; now = saNums(S.rootItems[i].geometricBounds, 4, "geometricBounds");
      if (S.rootItems[i].uuid !== S.uuid[S.rootStart[i]]) return { status: "indeterminate", message: "Rollback could not prove the item identities." };
      residual = Math.max(saAbs(now[0] - S.b[o]), saAbs(now[1] - S.b[o + 1]), saAbs(now[2] - S.b[o + 2]), saAbs(now[3] - S.b[o + 3]));
      if (residual > SA_TOL) return { status: "indeterminate", message: "Rollback did not restore every item to its baseline." };
      if (residual > worst) worst = residual;
    }
    state.operationState.rollbackEvidence.restoredRoots = S.rootItems.length;
    state.operationState.rollbackEvidence.restoredMaxResidualPt = worst;
    return { status: "verified" };
  } catch (error) { return { status: "indeterminate", message: "Rollback could not prove the baseline." }; }
}
var saExecution = runMutationTransaction({
  apply: params.apply === true,
  initialOperationState: function () { return { mutationStarted: false, attempted: [], rollbackEvidence: { restoredRoots: null, restoredMaxResidualPt: null } }; },
  preflight: saResolve, plan: saPlan, revalidate: saRevalidate, applyMutation: saApply, verify: saVerify, rollback: saRollback,
  hasMutationEvidence: function (s) { return s.operationState.mutationStarted === true; },
  applyIndeterminate: function () { return { reasonCode: "artboard_state_unknown", message: "Scale outcome is indeterminate.", evidence: { restoredRoots: null, restoredMaxResidualPt: null } }; },
  rollbackEvidence: function (s) { return s.operationState.rollbackEvidence; }
});
saPhase("framework");
var saDocument = saExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === saExecution.preflight.document) saDocument = getDocumentContext();
var result = { operation: "scale_artwork", applied: saExecution.transaction.state === "verified", document: saDocument, plan: saExecution.plan, transaction: saExecution.transaction };
if (result.applied) result.postcondition = saExecution.value;
if (saScanMs.length > 0) result.scanMs = saScanMs;
result.phaseMs = saPhases;
`;
export const SCALE_ARTWORK_HOST_SCRIPT_DIGEST = canonicalSha256(SCALE_ARTWORK_SCRIPT);
export const SCALE_ARTWORK_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: SCALE_ARTWORK_OPERATION, validator: SCALE_ARTWORK_VALIDATOR,
    canonicalContractVersion: 1, resultSchemaVersion: 1, terminalClassifierVersion: 1, safetyConformanceVersion: 1, errorMappingVersion: 1,
    safetyIdentity: SCALE_ARTWORK_SAFETY_IDENTITY, hostScriptDigest: SCALE_ARTWORK_HOST_SCRIPT_DIGEST, mutationHostApplicationMode: 'foreground',
});
function layerSpecs(layers) {
    return layers.map((layer) => typeof layer === 'number' ? { index: layer } : { names: [...new Set([layer, layer.normalize('NFC'), layer.normalize('NFD')])] });
}
function hostParams(request) {
    const { commandId: _commandId, ...params } = request;
    return params;
}
function normalizedRequest(input) {
    const request = internalSchema.parse(input);
    checkScaleRequest({ scalePercent: request.scalePercent, ...(request.scope.layers === undefined ? {} : { layers: request.scope.layers }), ...(request.scope.targetUuids === undefined ? {} : { targetUuids: request.scope.targetUuids }) });
    const { commandId: _commandId, ...bound } = request;
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: request.apply ? request.commandId : null, documentKey: request.expectedDocumentKey,
        digest: canonicalSha256({ operation: SCALE_ARTWORK_OPERATION, validator: SCALE_ARTWORK_VALIDATOR, request: bound }) };
}
export const scaleArtworkToolContract = {
    name: 'illustrator_scale_artwork', title: 'Plan or Scale a Whole Drawing by a Decimal Percentage',
    description: 'Scale every top-level item of the listed layers (or items) about one point by scale_percent, e.g. to turn a CAD drawing read as points into true size. Plan lists the scope and refusals (locked, hidden, unsupported types); apply checks every node\'s bounds (0.01 pt) and stroke width and a sample\'s attributes, and restores the drawing on a mismatch. Artboards are not changed. RGB, Illustrator frontmost.',
    inputSchema, publicInputSchema: scaleArtworkPublicInputSchema, outputSchema: responseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(SCALE_ARTWORK_SAFETY.policy), normalizePublicInput,
};
export function createScaleArtworkAdapter() {
    return {
        version: 1, operation: SCALE_ARTWORK_OPERATION, validator: SCALE_ARTWORK_VALIDATOR,
        safety: SCALE_ARTWORK_SAFETY, safetyRegistrationIdentity: SCALE_ARTWORK_SAFETY_IDENTITY, adapterIdentity: SCALE_ARTWORK_ADAPTER_IDENTITY,
        tool: scaleArtworkToolContract, canonical: { version: 1, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: scaleArtworkHostResultSchema, resultSchemaVersion: 1, terminalClassifierVersion: 1, safetyConformanceVersion: 1, errorMappingVersion: 1,
        hostScriptDigest: SCALE_ARTWORK_HOST_SCRIPT_DIGEST, mutationHostApplicationMode: 'foreground',
        buildCommand(input) {
            const n = normalizedRequest(input), params = hostParams(n.request);
            if (n.intent === 'plan')
                return { kind: 'read', script: SCALE_ARTWORK_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: SCALE_ARTWORK_VALIDATOR, idempotency: { commandId: n.commandId, operation: SCALE_ARTWORK_OPERATION, documentKey: n.documentKey, requestDigest: n.digest },
                adapterIdentity: SCALE_ARTWORK_ADAPTER_IDENTITY, mutationHostApplicationMode: 'foreground', script: SCALE_ARTWORK_SCRIPT, params };
        },
        classifyTerminal(value) { return classifyArtboardTerminal(scaleArtworkResultSchema.parse(value).transaction.state, 'Scale'); },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error) { return error instanceof Error ? error : new Error(String(error)); },
    };
}
