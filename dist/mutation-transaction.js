import { EDIT_SESSION_JSX } from './edit-session-jsx.js';
import { EDIT_SESSION_MAX_ITEMS } from './edit-session.js';
export const MUTATION_TRANSACTION_SCRIPT = String.raw `
var MUTATION_SIDE_EFFECT_ATTEMPTED = false;
var MUTATION_FORCE_INDETERMINATE = false;
var MUTATION_RUNNER_DISPOSITION = "unknown";
var MUTATION_EDIT_SESSION_DECLARED = false;
var MUTATION_EDIT_SESSION = null;
var MUTATION_EDIT_SESSION_EVIDENCE = null;
var EDIT_SESSION_MAX_ITEMS = ${EDIT_SESSION_MAX_ITEMS};
` + EDIT_SESSION_JSX + String.raw `
function mutationEditSessionRefuse(code, session) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: code, sessionId: session.sessionId }));
}

function mutationEditSessionContext(context) {
  context.mutationProfile = "edit_session_file";
  context.mutationAllowed = true;
  context.mutationBlockedReason = null;
  return context;
}

/**
 * Same checks, in the same order, as decideEditSessionAdmission (src/edit-session.ts): file identity and
 * structure first (the Node side suspends on those), then the measured envelope, then the adapter's declaration.
 * Runs once per host call, before the side-effect boundary; later calls in the same call reuse the admission.
 */
function mutationEditSessionAdmit(context, session) {
  var doc = app.activeDocument;
  if (MUTATION_EDIT_SESSION !== null) {
    if (MUTATION_EDIT_SESSION.sessionId !== session.sessionId || MUTATION_EDIT_SESSION.doc !== doc) {
      throw new Error("Edit session admission changed within one host call.");
    }
    return mutationEditSessionContext(context);
  }
  if (MUTATION_SIDE_EFFECT_ATTEMPTED) throw new Error("Edit session admission after the side-effect boundary.");
  var startedAt = esNow();
  if (context.fileRevision !== session.sourceFileRevision) mutationEditSessionRefuse("EDIT_SESSION_FILE_CHANGED", session);
  var structure = esStructure(doc);
  if (structure.digest !== session.structureDigest) mutationEditSessionRefuse("EDIT_SESSION_STRUCTURE_CHANGED", session);
  if (EDIT_SESSION_ADMISSION_INPUT.hostProfile !== "foreground_unlocked") mutationEditSessionRefuse("EDIT_SESSION_UNMEASURED_HOST_STATE", session);
  if (structure.itemCount === null || structure.itemCount > EDIT_SESSION_MAX_ITEMS) mutationEditSessionRefuse("EDIT_SESSION_DOCUMENT_TOO_LARGE", session);
  if (structure.sublayerCount > 0) mutationEditSessionRefuse("EDIT_SESSION_UNMEASURED_CONTENT", session);
  // itemTotal counts the head's rows: every item, nested ones included, plus one stacking-order row per layer.
  if (typeof session.itemTotal !== "number" || session.itemTotal - structure.layerCount > EDIT_SESSION_MAX_ITEMS) mutationEditSessionRefuse("EDIT_SESSION_DOCUMENT_TOO_LARGE", session);
  if (!MUTATION_EDIT_SESSION_DECLARED) mutationEditSessionRefuse("EDIT_SESSION_OPERATION_UNSUPPORTED", session);
  MUTATION_EDIT_SESSION = { sessionId: session.sessionId, sequence: session.sequence, doc: doc, fileRevision: context.fileRevision,
    beforeStructure: structure, admissionMs: esNow() - startedAt };
  return mutationEditSessionContext(context);
}

function mutationEditSessionStructure(structure) {
  return { digest: structure.digest, itemCount: structure.itemCount, layerCount: structure.layerCount, sublayerCount: structure.sublayerCount };
}

function mutationEditSessionUuids(definition, phase, preflight, plan, state, value) {
  var uuids = definition.editSessionAffected(phase, preflight, plan, state, value);
  if (!(uuids instanceof Array)) throw new Error("Edit session affected set must be an array.");
  var seen = {};
  for (var uuidIndex = 0; uuidIndex < uuids.length; uuidIndex++) {
    if (typeof uuids[uuidIndex] !== "string" || uuids[uuidIndex].length === 0) throw new Error("Edit session affected uuid is invalid.");
    if (seen.hasOwnProperty(uuids[uuidIndex])) throw new Error("Edit session affected uuid is duplicated.");
    seen[uuids[uuidIndex]] = true;
  }
  return esExpandAffected(MUTATION_EDIT_SESSION.doc, uuids);
}

/**
 * Top-level layers whose stacking order the adapter may change (editSessionLayers, design gate 14.14). Optional:
 * an adapter that never adds, removes, replaces or reorders a layer's direct items declares none.
 */
function mutationEditSessionLayers(definition, phase, preflight, plan, state, value) {
  if (typeof definition.editSessionLayers !== "function") return [];
  var layers = definition.editSessionLayers(phase, preflight, plan, state, value);
  if (!(layers instanceof Array)) throw new Error("Edit session layers must be an array.");
  var out = [];
  for (var layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    var layer = layers[layerIndex];
    if (!layer || String(layer.typename) !== "Layer" || String(layer.parent.typename) !== "Document") {
      throw new Error("Edit session layer is not a top-level layer.");
    }
    if (mutationEditSessionIndexOf(out, layer) < 0) out.push(layer);
  }
  return out;
}

function mutationEditSessionIndexOf(list, value) {
  for (var index = 0; index < list.length; index++) if (list[index] === value) return index;
  return -1;
}

function mutationEditSessionLayerRows(layers) {
  var rows = [];
  for (var index = 0; index < layers.length; index++) rows.push(esHashText(esLayerOrderRow(layers[index])));
  return rows;
}

/** Before the side-effect boundary: rows of the declared items as they are now. A declared item that is absent refuses. */
function mutationEditSessionBegin(definition, preflight, plan, state) {
  if (MUTATION_EDIT_SESSION === null) return;
  var startedAt = esNow();
  var uuids = mutationEditSessionUuids(definition, "before", preflight, plan, state, null);
  var rows = esTargetRows(MUTATION_EDIT_SESSION.doc, uuids);
  if (rows.missing.length > 0) throw mutationError("plan_failed", "An item declared for the edit session does not resolve before the change.");
  var layersStartedAt = esNow();
  var layers = mutationEditSessionLayers(definition, "before", preflight, plan, state, null);
  MUTATION_EDIT_SESSION.layersAtBegin = esTopLayers(MUTATION_EDIT_SESSION.doc);
  MUTATION_EDIT_SESSION.layersBefore = layers;
  var layerRows = mutationEditSessionLayerRows(layers);
  var layerRowsMs = esNow() - layersStartedAt;
  MUTATION_EDIT_SESSION_EVIDENCE = {
    evidenceVersion: 2,
    sessionId: MUTATION_EDIT_SESSION.sessionId,
    sequence: MUTATION_EDIT_SESSION.sequence,
    fileRevision: MUTATION_EDIT_SESSION.fileRevision,
    hostProfile: EDIT_SESSION_ADMISSION_INPUT.hostProfile,
    beforeStructure: mutationEditSessionStructure(MUTATION_EDIT_SESSION.beforeStructure),
    beforeUuids: uuids,
    beforeRows: rows.rows,
    beforeLayerRows: layerRows,
    outcome: "pending",
    afterStructure: null,
    afterRows: null,
    afterLayerRows: null,
    afterMissing: null,
    timing: { admissionMs: MUTATION_EDIT_SESSION.admissionMs, beforeRowsMs: esNow() - startedAt, beforeLayerRowsMs: layerRowsMs, afterMs: null }
  };
}

/** After a verified change: rows of the declared items (created ones included) and the structure, same host call. */
function mutationEditSessionVerified(definition, preflight, plan, state, value) {
  if (MUTATION_EDIT_SESSION_EVIDENCE === null) return;
  var startedAt = esNow();
  try {
    var uuids = mutationEditSessionUuids(definition, "after", preflight, plan, state, value);
    var rows = esTargetRows(MUTATION_EDIT_SESSION.doc, uuids);
    // A row read before the change is read again even when the adapter does not name it after (an ancestor the
    // item left, a container whose children moved); one that no longer resolves and is proved absent was removed
    // and only subtracts.
    var declaredAfter = {};
    for (var afterIndex = 0; afterIndex < uuids.length; afterIndex++) declaredAfter[uuids[afterIndex]] = true;
    var carried = [];
    for (var beforeIndex = 0; beforeIndex < MUTATION_EDIT_SESSION_EVIDENCE.beforeUuids.length; beforeIndex++) {
      if (!declaredAfter.hasOwnProperty(MUTATION_EDIT_SESSION_EVIDENCE.beforeUuids[beforeIndex])) carried.push(MUTATION_EDIT_SESSION_EVIDENCE.beforeUuids[beforeIndex]);
    }
    var carriedRows = esTargetRows(MUTATION_EDIT_SESSION.doc, carried);
    // "No longer resolves" is removal only when absence is proved; otherwise the head must not advance.
    if (carriedRows.missing.length > 0 && esAbsenceUnproved(MUTATION_EDIT_SESSION.doc, carriedRows.missing) !== null) {
      throw new Error("Edit session could not prove that an unresolved item was removed.");
    }
    for (var carriedIndex = 0; carriedIndex < carriedRows.rows.length; carriedIndex++) rows.rows.push(carriedRows.rows[carriedIndex]);
    MUTATION_EDIT_SESSION_EVIDENCE.afterRows = rows.rows;
    MUTATION_EDIT_SESSION_EVIDENCE.afterMissing = rows.missing;
    // The before layers again, plus layers the adapter names after the change; a layer that existed at the start
    // but was not named before cannot be subtracted, so the evidence is refused (the session suspends).
    var afterLayers = MUTATION_EDIT_SESSION.layersBefore.slice(0);
    var named = mutationEditSessionLayers(definition, "after", preflight, plan, state, value);
    for (var layerIndex = 0; layerIndex < named.length; layerIndex++) {
      if (mutationEditSessionIndexOf(afterLayers, named[layerIndex]) >= 0) continue;
      if (mutationEditSessionIndexOf(MUTATION_EDIT_SESSION.layersAtBegin, named[layerIndex]) >= 0) throw new Error("Edit session layer was not declared before the change.");
      afterLayers.push(named[layerIndex]);
    }
    MUTATION_EDIT_SESSION_EVIDENCE.afterLayerRows = mutationEditSessionLayerRows(afterLayers);
    MUTATION_EDIT_SESSION_EVIDENCE.afterStructure = mutationEditSessionStructure(esStructure(MUTATION_EDIT_SESSION.doc));
    MUTATION_EDIT_SESSION_EVIDENCE.outcome = "verified";
  } catch (evidenceError) {
    // The change itself is verified; missing evidence only means the head cannot advance (Node suspends).
    MUTATION_EDIT_SESSION_EVIDENCE.outcome = "evidence_unavailable";
  }
  MUTATION_EDIT_SESSION_EVIDENCE.timing.afterMs = esNow() - startedAt;
}

/** After a verified rollback: the declared rows and the structure again, so Node can prove the head still holds. */
function mutationEditSessionRestored() {
  if (MUTATION_EDIT_SESSION_EVIDENCE === null) return;
  var startedAt = esNow();
  try {
    var rows = esTargetRows(MUTATION_EDIT_SESSION.doc, MUTATION_EDIT_SESSION_EVIDENCE.beforeUuids);
    MUTATION_EDIT_SESSION_EVIDENCE.afterRows = rows.rows;
    MUTATION_EDIT_SESSION_EVIDENCE.afterMissing = rows.missing;
    MUTATION_EDIT_SESSION_EVIDENCE.afterLayerRows = mutationEditSessionLayerRows(MUTATION_EDIT_SESSION.layersBefore);
    MUTATION_EDIT_SESSION_EVIDENCE.afterStructure = mutationEditSessionStructure(esStructure(MUTATION_EDIT_SESSION.doc));
    MUTATION_EDIT_SESSION_EVIDENCE.outcome = "rolled_back";
  } catch (evidenceError) {
    MUTATION_EDIT_SESSION_EVIDENCE.outcome = "evidence_unavailable";
  }
  MUTATION_EDIT_SESSION_EVIDENCE.timing.afterMs = esNow() - startedAt;
}

function mutationEditSessionOutcome(outcome) {
  if (MUTATION_EDIT_SESSION_EVIDENCE !== null) MUTATION_EDIT_SESSION_EVIDENCE.outcome = outcome;
}

function mergeOperationEvidence(base, evidence) {
  if (evidence === null || typeof evidence !== "object" || evidence instanceof Array) throw new Error("Mutation adapter evidence is invalid.");
  var reserved = { state: true, status: true, reasonCode: true, message: true, audit: true, failure: true, rollback: true, transaction: true, disposition: true };
  var merged = {};
  for (var key in evidence) {
    if (evidence.hasOwnProperty(key)) {
      if (reserved[key]) throw new Error("Mutation adapter evidence attempted to override common transaction control.");
      merged[key] = evidence[key];
    }
  }
  for (var baseKey in base) if (base.hasOwnProperty(baseKey)) merged[baseKey] = base[baseKey];
  return merged;
}

function mutationTruncateMessage(value) {
  var text = String(value);
  if (text.length <= 500) return text;
  var truncated = text.substring(0, 500);
  var lastCode = truncated.charCodeAt(truncated.length - 1);
  if (lastCode >= 0xD800 && lastCode <= 0xDBFF) truncated = truncated.substring(0, truncated.length - 1);
  return truncated;
}

function mutationPublicMessage(error, fallback) {
  if (error && typeof error.mutationPublicMessage === "string" && error.mutationPublicMessage.length > 0) {
    return mutationTruncateMessage(error.mutationPublicMessage);
  }
  return fallback;
}

function mutationError(reasonCode, publicMessage) {
  var error = new Error(publicMessage);
  error.mutationReasonCode = reasonCode;
  error.mutationPublicMessage = publicMessage;
  return error;
}

function mutationBeforeSideEffectError(publicMessage) {
  var error = mutationError("apply_failed", publicMessage);
  error.mutationBeforeSideEffect = true;
  return error;
}

function mutationFiniteNumber(value, propertyName) {
  if (typeof value !== "number" || isNaN(value) || !isFinite(value)) {
    throw mutationError("preflight_failed", propertyName + " must be a finite number.");
  }
  return value;
}

function mutationSameSequence(left, right) {
  if (!left || !right || typeof left.length !== "number" || typeof right.length !== "number" || left.length !== right.length) {
    return false;
  }
  for (var pathIndex = 0; pathIndex < left.length; pathIndex++) {
    if (left[pathIndex] !== right[pathIndex]) return false;
  }
  return true;
}

function mutationAuditRecorder() {
  var events = [];
  var sequence = 0;
  function append(event) {
    event.sequence = sequence;
    sequence++;
    events.push(event);
    if (event.phase === "apply" && event.event === "attempted") MUTATION_SIDE_EFFECT_ATTEMPTED = true;
    if (typeof recordMutationAuditEvent === "function") recordMutationAuditEvent(event);
  }
  return {
    events: events,
    started: function (phase) { append({ phase: phase, event: "started" }); },
    attempted: function () { append({ phase: "apply", event: "attempted" }); },
    succeeded: function (phase) { append({ phase: phase, event: "succeeded" }); },
    failed: function (phase, reasonCode, message) {
      append({ phase: phase, event: "failed", reasonCode: reasonCode, message: mutationTruncateMessage(message) });
    },
    skipped: function (phase, reasonCode) { append({ phase: phase, event: "skipped", reasonCode: reasonCode }); }
  };
}

function rollbackMutationTransaction(definition, state, failure, audit) {
  audit.started("rollback");
  var outcome;
  try {
    var evidence = typeof definition.rollbackEvidence === "function" ? definition.rollbackEvidence(state) : null;
    if (evidence === null || typeof evidence !== "object") {
      outcome = {
        status: "indeterminate",
        message: "Rollback outcome is indeterminate because operation rollback evidence is unavailable."
      };
    } else {
      outcome = definition.rollback(state);
    }
  } catch (rollbackError) {
    outcome = {
      status: "indeterminate",
      message: mutationPublicMessage(rollbackError, "Rollback outcome is indeterminate.")
    };
  }
  if (!outcome || (outcome.status !== "verified" && outcome.status !== "failed" && outcome.status !== "indeterminate")) {
    outcome = { status: "indeterminate", message: "Rollback adapter returned an invalid outcome." };
  }
  if (outcome.status === "verified") {
    mutationEditSessionRestored();
    audit.succeeded("rollback");
    return {
      state: "rolled_back",
      failure: failure,
      rollback: mergeOperationEvidence({ status: "verified" }, evidence),
      audit: audit.events
    };
  }
  if (outcome.status === "failed") {
    mutationEditSessionOutcome("rollback_failed");
    var rollbackMessage = mutationTruncateMessage(outcome.message || "Rollback failed.");
    audit.failed("rollback", "rollback_failed", rollbackMessage);
    return {
      state: "rollback_failed",
      failure: failure,
      rollback: mergeOperationEvidence({
        status: "failed",
        reasonCode: "rollback_failed",
        message: rollbackMessage
      }, evidence),
      audit: audit.events
    };
  }
  mutationEditSessionOutcome("rollback_indeterminate");
  var indeterminateMessage = mutationTruncateMessage(outcome.message || "Rollback outcome is indeterminate.");
  audit.failed("rollback", "rollback_indeterminate", indeterminateMessage);
  return {
    state: "rollback_indeterminate",
    failure: failure,
    rollback: mergeOperationEvidence({
      status: "indeterminate",
      reasonCode: "rollback_indeterminate",
      message: indeterminateMessage
    }, evidence),
    audit: audit.events
  };
}

function runMutationTransaction(definition) {
  MUTATION_EDIT_SESSION_DECLARED = typeof definition.editSessionAffected === "function";
  var audit = mutationAuditRecorder();
  var operationState = typeof definition.initialOperationState === "function" ? definition.initialOperationState() : null;
  if (operationState === null || typeof operationState !== "object") throw new Error("Mutation adapter did not provide opaque operation state.");
  var state = { operationState: operationState, applyValue: null, preflight: null, plan: null };
  function finish(value) {
    MUTATION_RUNNER_DISPOSITION = value.transaction.state === "apply_indeterminate" || value.transaction.state === "rollback_indeterminate"
      ? "indeterminate" : "completed";
    return value;
  }
  var preflight;
  var plan;

  audit.started("preflight");
  try {
    preflight = definition.preflight(definition.apply === true);
    audit.succeeded("preflight");
  } catch (preflightError) {
    audit.failed("preflight", "preflight_failed", mutationPublicMessage(preflightError, "Preflight failed."));
    throw preflightError;
  }

  audit.started("plan");
  try {
    plan = definition.plan(preflight);
    state.preflight = preflight;
    state.plan = plan;
    if (definition.apply === true) mutationEditSessionBegin(definition, preflight, plan, state);
    audit.succeeded("plan");
  } catch (planError) {
    audit.failed("plan", "plan_failed", mutationPublicMessage(planError, "Planning failed."));
    throw planError;
  }

  if (definition.apply !== true) {
    audit.skipped("apply", "not_requested");
    audit.skipped("verify", "not_requested");
    audit.skipped("rollback", "not_requested");
    return finish({ preflight: preflight, plan: plan, value: null, transaction: { state: "planned", audit: audit.events } });
  }

  audit.started("apply");
  try {
    definition.revalidate(preflight, plan);
  } catch (revalidateError) {
    if (!revalidateError || revalidateError.mutationBeforeSideEffect !== true) {
      MUTATION_FORCE_INDETERMINATE = true;
      audit.failed("apply", "apply_indeterminate", "Apply precondition outcome is indeterminate.");
      throw revalidateError;
    }
    mutationEditSessionOutcome("not_applied");
    var revalidateMessage = mutationPublicMessage(revalidateError, "Apply precondition revalidation failed.");
    var revalidateFailure = { phase: "apply", reasonCode: "apply_failed", message: revalidateMessage };
    audit.failed("apply", "apply_failed", revalidateMessage);
    audit.skipped("verify", "not_required");
    audit.skipped("rollback", "not_required");
    return finish({
      preflight: preflight,
      plan: plan,
      value: null,
      transaction: {
        state: "apply_failed",
        failure: revalidateFailure,
        rollback: { status: "not_required" },
        audit: audit.events
      }
    });
  }

  audit.attempted();
  try {
    state.applyValue = definition.applyMutation(preflight, plan, state);
  } catch (applyError) {
    var applyMessage = mutationPublicMessage(applyError, "Apply failed.");
    if (typeof definition.hasMutationEvidence !== "function" || definition.hasMutationEvidence(state) !== true) {
      var indeterminate = typeof definition.applyIndeterminate === "function"
        ? definition.applyIndeterminate(state)
        : null;
      if (!indeterminate || typeof indeterminate.message !== "string" || indeterminate.message.length === 0 ||
          typeof indeterminate.reasonCode !== "string" || indeterminate.reasonCode.length === 0 ||
          !indeterminate.evidence || typeof indeterminate.evidence !== "object" || indeterminate.evidence instanceof Array) {
        throw new Error("Mutation adapter returned invalid indeterminate evidence.");
      }
      mutationEditSessionOutcome("indeterminate");
      var indeterminateApplyMessage = mutationTruncateMessage(indeterminate.message);
      var indeterminateApplyFailure = {
        phase: "apply", reasonCode: "apply_indeterminate", message: indeterminateApplyMessage
      };
      audit.failed("apply", "apply_indeterminate", indeterminateApplyMessage);
      return finish({
        preflight: preflight,
        plan: plan,
        value: null,
        transaction: {
          state: "apply_indeterminate",
          failure: indeterminateApplyFailure,
          rollback: mergeOperationEvidence({
            status: "indeterminate",
            reasonCode: indeterminate.reasonCode,
            message: indeterminateApplyMessage
          }, indeterminate.evidence),
          audit: audit.events
        }
      });
    }
    var applyFailure = { phase: "apply", reasonCode: "apply_failed", message: applyMessage };
    audit.failed("apply", "apply_failed", applyMessage);
    audit.skipped("verify", "not_required");
    return finish({
      preflight: preflight,
      plan: plan,
      value: null,
      transaction: rollbackMutationTransaction(definition, state, applyFailure, audit)
    });
  }
  audit.succeeded("apply");

  audit.started("verify");
  var verifiedValue;
  try {
    verifiedValue = definition.verify(preflight, plan, state);
  } catch (verifyError) {
    var verifyMessage = mutationPublicMessage(verifyError, "Verification did not match the mutation plan.");
    var verifyFailure = { phase: "verify", reasonCode: "verify_mismatch", message: verifyMessage };
    audit.failed("verify", "verify_mismatch", verifyMessage);
    return finish({
      preflight: preflight,
      plan: plan,
      value: null,
      transaction: rollbackMutationTransaction(definition, state, verifyFailure, audit)
    });
  }
  audit.succeeded("verify");
  mutationEditSessionVerified(definition, preflight, plan, state, verifiedValue);
  audit.skipped("rollback", "not_required");
  return finish({
    preflight: preflight,
    plan: plan,
    value: verifiedValue,
    transaction: { state: "verified", audit: audit.events }
  });
}
`;
