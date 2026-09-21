import { MUTATION_TRANSACTION_SCRIPT } from '../../mutation-transaction.js';
import { RECTANGLE_BOUNDS_PRECISION_DIGITS, RECTANGLE_BOUNDS_TOLERANCE_PT } from './domain.js';
export const CREATE_RECTANGLE_MODULE_SCRIPT = `var RECTANGLE_BOUNDS_TOLERANCE_PT = ${RECTANGLE_BOUNDS_TOLERANCE_PT};
var RECTANGLE_BOUNDS_PRECISION_DIGITS = ${RECTANGLE_BOUNDS_PRECISION_DIGITS};

function mutationPositiveNumber(value, propertyName) {
  var number = mutationFiniteNumber(value, propertyName);
  if (!(number > 0)) throw mutationError("preflight_failed", propertyName + " must be greater than zero.");
  return number;
}

function mutationResolveLayerPath(document, path) {
  if (!path || typeof path.length !== "number" || path.length < 1 || path.length > 64) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "LAYER_PATH_INVALID", reasonCodes: ["layer_path_invalid"] }));
  }
  var collection = document.layers;
  var chain = [];
  for (var depth = 0; depth < path.length; depth++) {
    var index = path[depth];
    if (typeof index !== "number" || !(index >= 0) || Math.floor(index) !== index || index >= collection.length) {
      throw new Error("MCP_ERROR:" + stringifyJson({
        code: "LAYER_PATH_NOT_FOUND", reasonCodes: ["layer_path_not_found"], layerPath: path
      }));
    }
    var layer = collection[index];
    chain.push(layer);
    collection = layer.layers;
  }
  return chain;
}

function mutationInspectLayerChain(chain) {
  var targetLayer = chain[chain.length - 1];
  if (typeof targetLayer.visible !== "boolean" || typeof targetLayer.locked !== "boolean") {
    throw mutationError("preflight_failed", "The target layer visibility or lock state is unavailable.");
  }
  var targetVisible = targetLayer.visible === true;
  var targetLocked = targetLayer.locked === true;
  var ancestorVisible = true;
  var ancestorLocked = false;
  for (var ancestorIndex = 0; ancestorIndex < chain.length - 1; ancestorIndex++) {
    if (typeof chain[ancestorIndex].visible !== "boolean" || typeof chain[ancestorIndex].locked !== "boolean") {
      throw mutationError("preflight_failed", "An ancestor layer visibility or lock state is unavailable.");
    }
    if (chain[ancestorIndex].visible !== true) ancestorVisible = false;
    if (chain[ancestorIndex].locked === true) ancestorLocked = true;
  }
  var reasonCodes = [];
  if (!targetVisible) reasonCodes.push("layer_hidden");
  if (!ancestorVisible) reasonCodes.push("ancestor_hidden");
  if (targetLocked) reasonCodes.push("layer_locked");
  if (ancestorLocked) reasonCodes.push("ancestor_locked");
  return {
    targetLayer: targetLayer,
    targetVisible: targetVisible,
    targetLocked: targetLocked,
    ancestorVisible: ancestorVisible,
    ancestorLocked: ancestorLocked,
    reasonCodes: reasonCodes
  };
}

function mutationRequireSameDocument(document) {
  if (app.documents.length === 0 || app.activeDocument !== document) {
    throw mutationError("verify_mismatch", "The active document changed during the mutation transaction.");
  }
  return document;
}

function mutationRequireSameLayer(document, expectedPath, expectedLayer) {
  var chain = mutationResolveLayerPath(document, expectedPath);
  var inspection = mutationInspectLayerChain(chain);
  if (inspection.targetLayer !== expectedLayer) {
    throw mutationError("verify_mismatch", "The target layer identity changed during the mutation transaction.");
  }
  return inspection;
}

function mutationFindPageItemByUuid(document, uuid) {
  if (typeof document.getPageItemFromUuid !== "function") {
    throw new Error("Illustrator native UUID lookup is unavailable.");
  }
  try {
    var item = document.getPageItemFromUuid(uuid);
    if (item === null || item === undefined) {
      throw new Error("Illustrator native UUID lookup returned no result without an absence error.");
    }
    return item;
  } catch (lookupError) {
    var lookupMessage = lookupError && lookupError.message ? String(lookupError.message) : "";
    if (lookupError && lookupError.name === "Error" && lookupError.number === 1200 &&
        lookupMessage === "an Illustrator error occurred: 1346458189 ('MRAP')") {
      return null;
    }
    throw lookupError;
  }
}

function mutationCreatedObjectReferenceState(expectedObject, expectedUuid) {
  try {
    var referenceUuid = expectedObject.uuid;
    if (typeof referenceUuid !== "string" || referenceUuid !== expectedUuid) return "mismatch";
    return "present";
  } catch (referenceError) {
    if (referenceError && referenceError.name === "ReferenceError" && referenceError.number === 45) {
      return "invalid";
    }
    throw referenceError;
  }
}

function rectangleNormalizeDistance(value) {
  return Number(value.toFixed(RECTANGLE_BOUNDS_PRECISION_DIGITS));
}

function rectangleWithinArtboard(bounds, artboardBounds) {
  var outsideLeft = rectangleNormalizeDistance(Math.max(0, artboardBounds[0] - bounds[0]));
  var outsideTop = rectangleNormalizeDistance(Math.max(0, bounds[1] - artboardBounds[1]));
  var outsideRight = rectangleNormalizeDistance(Math.max(0, bounds[2] - artboardBounds[2]));
  var outsideBottom = rectangleNormalizeDistance(Math.max(0, artboardBounds[3] - bounds[3]));
  return outsideLeft <= RECTANGLE_BOUNDS_TOLERANCE_PT &&
    outsideTop <= RECTANGLE_BOUNDS_TOLERANCE_PT &&
    outsideRight <= RECTANGLE_BOUNDS_TOLERANCE_PT &&
    outsideBottom <= RECTANGLE_BOUNDS_TOLERANCE_PT;
}

function rectangleBoundMatches(actual, planned) {
  return rectangleNormalizeDistance(Math.abs(actual - planned)) <= RECTANGLE_BOUNDS_TOLERANCE_PT;
}

function rectanglePreflight(forApply) {
  var context;
  if (forApply) context = requireDocument(params.expectedDocumentKey);
  else context = requireDocumentForRead(params.expectedDocumentKey);
  var doc = app.activeDocument;
  mutationFiniteNumber(params.x, "x");
  mutationFiniteNumber(params.y, "y");
  mutationPositiveNumber(params.width, "width");
  mutationPositiveNumber(params.height, "height");
  if (typeof params.artboardIndex !== "number" || !(params.artboardIndex >= 0) ||
      Math.floor(params.artboardIndex) !== params.artboardIndex || params.artboardIndex >= doc.artboards.length) {
    throw mutationError("preflight_failed", "Invalid artboard index.");
  }
  if (params.name !== undefined && (typeof params.name !== "string" || params.name.length > 255)) {
    throw mutationError("preflight_failed", "Rectangle name must be a string of at most 255 characters.");
  }

  var layerChain = mutationResolveLayerPath(doc, params.expectedLayerPath);
  var layerInspection = mutationInspectLayerChain(layerChain);
  var confirmation = params.templateStateRiskConfirmation || null;
  var confirmationStatus = "assumed";
  if (confirmation !== null) {
    var confirmationMatches = confirmation.reasonCode === "template_state_unknown" &&
      confirmation.operation === "create_rectangle" &&
      confirmation.decision === "proceed_despite_unknown_template_state" &&
      mutationSameSequence(confirmation.expectedLayerPath, params.expectedLayerPath);
    if (confirmationMatches) confirmationStatus = "confirmed";
    else confirmationStatus = "mismatch";
  }

  var applyBlockedReasonCodes = layerInspection.reasonCodes.slice(0);
  if (!context.mutationAllowed) applyBlockedReasonCodes.push("document_mutation_not_allowed");
  if (confirmationStatus === "mismatch") applyBlockedReasonCodes.push("template_state_confirmation_mismatch");

  var nativeArtboardBounds = doc.artboards[params.artboardIndex].artboardRect;
  var artboardBounds = [];
  for (var boundIndex = 0; boundIndex < 4; boundIndex++) {
    artboardBounds.push(mutationFiniteNumber(nativeArtboardBounds[boundIndex], "artboardBounds[" + boundIndex + "]"));
  }
  if (!(artboardBounds[0] < artboardBounds[2]) || !(artboardBounds[1] > artboardBounds[3])) {
    throw mutationError("preflight_failed", "The selected artboard has degenerate bounds.");
  }
  var targetBounds = [
    artboardBounds[0] + params.x,
    artboardBounds[1] - params.y,
    artboardBounds[0] + params.x + params.width,
    artboardBounds[1] - params.y - params.height
  ];
  for (var targetBoundIndex = 0; targetBoundIndex < 4; targetBoundIndex++) {
    mutationFiniteNumber(targetBounds[targetBoundIndex], "targetBounds[" + targetBoundIndex + "]");
  }
  if (!(targetBounds[0] < targetBounds[2]) || !(targetBounds[1] > targetBounds[3])) {
    throw mutationError("preflight_failed", "Rectangle geometry is degenerate.");
  }

  if (forApply && applyBlockedReasonCodes.length > 0) {
    throw new Error("MCP_ERROR:" + stringifyJson({
      code: "RECTANGLE_APPLY_BLOCKED",
      reasonCodes: applyBlockedReasonCodes,
      layerPath: params.expectedLayerPath,
      templateRiskConfirmationStatus: confirmationStatus
    }));
  }
  return {
    context: context,
    doc: doc,
    layerChain: layerChain,
    targetLayer: layerInspection.targetLayer,
    layerInspection: layerInspection,
    confirmationStatus: confirmationStatus,
    applyBlockedReasonCodes: applyBlockedReasonCodes,
    artboardBounds: artboardBounds,
    targetBounds: targetBounds
  };
}

function rectanglePlan(preflight) {
  return {
    operation: "create_rectangle",
    documentKey: preflight.context.key,
    coordinateSpace: "artboard_top_left",
    unit: "pt",
    artboardIndex: params.artboardIndex,
    artboardBounds: preflight.artboardBounds,
    targetBounds: preflight.targetBounds,
    withinArtboard: rectangleWithinArtboard(preflight.targetBounds, preflight.artboardBounds),
    targetLayer: {
      path: params.expectedLayerPath,
      name: preflight.targetLayer.name || "",
      visible: preflight.layerInspection.targetVisible,
      locked: preflight.layerInspection.targetLocked,
      effectiveVisible: preflight.layerInspection.ancestorVisible && preflight.layerInspection.targetVisible,
      effectiveLocked: preflight.layerInspection.ancestorLocked || preflight.layerInspection.targetLocked,
      templateState: "unknown"
    },
    layerSafetyReasonCodes: preflight.layerInspection.reasonCodes,
    templateRisk: {
      reasonCode: "template_state_unknown",
      confirmationStatus: preflight.confirmationStatus,
      templateStateAssumed: "non_template"
    },
    applyAllowed: preflight.applyBlockedReasonCodes.length === 0,
    applyBlockedReasonCodes: preflight.applyBlockedReasonCodes
  };
}

function rectangleRevalidate(preflight, plan) {
  var current;
  try {
    current = rectanglePreflight(true);
  } catch (revalidateError) {
    throw mutationBeforeSideEffectError(
      mutationPublicMessage(revalidateError, "Rectangle preconditions changed before apply.")
    );
  }
  if (current.doc !== preflight.doc || current.targetLayer !== preflight.targetLayer) {
    throw mutationBeforeSideEffectError("The document or target layer identity changed before apply.");
  }
  if (!mutationSameSequence(current.targetBounds, plan.targetBounds) ||
      String(current.targetLayer.name || "") !== plan.targetLayer.name ||
      current.confirmationStatus !== preflight.confirmationStatus) {
    throw mutationBeforeSideEffectError("The rectangle plan changed before apply.");
  }
}

function rectangleApply(preflight, plan, state) {
  var rectangle = preflight.targetLayer.pathItems.rectangle(
    plan.targetBounds[1], plan.targetBounds[0], params.width, params.height
  );
  state.operationState.createdObject = rectangle;
  if (typeof rectangle.uuid !== "string" || rectangle.uuid.length === 0) {
    throw mutationError("apply_failed", "Illustrator did not return a valid native UUID.");
  }
  var nativeUuid = rectangle.uuid;
  state.operationState.createdUuid = nativeUuid;
  if (params.name !== undefined) rectangle.name = params.name;
  return rectangle;
}

function rectangleVerify(preflight, plan, state) {
  var doc = mutationRequireSameDocument(preflight.doc);
  var layerInspection = mutationRequireSameLayer(doc, params.expectedLayerPath, preflight.targetLayer);
  if (layerInspection.reasonCodes.length > 0) {
    throw mutationError("verify_mismatch", "The target layer or an ancestor became unsafe during verification.");
  }
  var rectangle = mutationFindPageItemByUuid(doc, state.operationState.createdUuid);
  if (rectangle === null || rectangle !== state.operationState.createdObject || rectangle.uuid !== state.operationState.createdUuid) {
    throw mutationError("verify_mismatch", "The created native UUID could not be resolved to the created rectangle.");
  }
  if (rectangle.layer !== preflight.targetLayer || rectangle.typename !== "PathItem") {
    throw mutationError("verify_mismatch", "The created rectangle has an unexpected type or layer.");
  }
  if (typeof rectangle.locked !== "boolean" || typeof rectangle.hidden !== "boolean" ||
      typeof rectangle.editable !== "boolean" || rectangle.locked || rectangle.hidden || !rectangle.editable) {
    throw mutationError("verify_mismatch", "The created rectangle is not verifiably editable.");
  }
  var actualBounds = rectangle.geometricBounds;
  for (var actualIndex = 0; actualIndex < 4; actualIndex++) {
    var actualValue = mutationFiniteNumber(actualBounds[actualIndex], "actualBounds[" + actualIndex + "]");
    if (!rectangleBoundMatches(actualValue, plan.targetBounds[actualIndex])) {
      throw mutationError("verify_mismatch", "The created rectangle bounds do not match the plan.");
    }
  }
  if (params.name !== undefined && rectangle.name !== params.name) {
    throw mutationError("verify_mismatch", "The created rectangle name does not match the plan.");
  }
  return {
    uuid: state.operationState.createdUuid,
    type: rectangle.typename,
    name: rectangle.name || "",
    bounds: [actualBounds[0], actualBounds[1], actualBounds[2], actualBounds[3]]
  };
}

function rectangleRollback(state) {
  var doc = state.preflight.doc;
  var layerInspection;
  var rectangle;
  try {
    if (app.documents.length === 0 || app.activeDocument !== doc) {
      return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
    }
    layerInspection = mutationRequireSameLayer(doc, params.expectedLayerPath, state.preflight.targetLayer);
    rectangle = mutationFindPageItemByUuid(doc, state.operationState.createdUuid);
  } catch (lookupError) {
    return { status: "indeterminate", message: "Rollback target lookup is indeterminate." };
  }
  if (rectangle === null) {
    var referenceState;
    try {
      referenceState = mutationCreatedObjectReferenceState(
        state.operationState.createdObject, state.operationState.createdUuid
      );
    } catch (identityLookupError) {
      return { status: "indeterminate", message: "Rollback object-identity lookup is indeterminate." };
    }
    if (referenceState === "invalid") return { status: "verified" };
    if (referenceState === "present") {
      return { status: "indeterminate", message: "Rollback UUID lookup reported absence while the created object still exists." };
    }
    return { status: "indeterminate", message: "Rollback UUID changed while the created object reference remains valid." };
  }
  if (rectangle !== state.operationState.createdObject || rectangle.uuid !== state.operationState.createdUuid ||
      rectangle.typename !== "PathItem" || rectangle.layer !== state.preflight.targetLayer ||
      typeof rectangle.locked !== "boolean" || typeof rectangle.hidden !== "boolean" ||
      typeof rectangle.editable !== "boolean") {
    return { status: "indeterminate", message: "Rollback object identity is indeterminate." };
  }
  if (layerInspection.reasonCodes.length > 0 || rectangle.locked || rectangle.hidden || !rectangle.editable) {
    return { status: "failed", message: "Rollback refused because the verified created object is not safely editable." };
  }

  var removeThrew = false;
  try {
    rectangle.remove();
  } catch (removeError) {
    removeThrew = true;
  }

  var remaining;
  try {
    if (app.documents.length === 0 || app.activeDocument !== doc) {
      return { status: "indeterminate", message: "Rollback document identity changed after removal was attempted." };
    }
    remaining = mutationFindPageItemByUuid(doc, state.operationState.createdUuid);
  } catch (postRemoveLookupError) {
    return { status: "indeterminate", message: "Rollback result lookup is indeterminate." };
  }
  if (remaining === null) {
    var remainingReferenceState;
    try {
      remainingReferenceState = mutationCreatedObjectReferenceState(
        state.operationState.createdObject, state.operationState.createdUuid
      );
    } catch (remainingIdentityLookupError) {
      return { status: "indeterminate", message: "Rollback post-remove identity lookup is indeterminate." };
    }
    if (remainingReferenceState === "invalid") return { status: "verified" };
    if (remainingReferenceState === "present") {
      return { status: "indeterminate", message: "Rollback UUID disappeared but the created object still exists." };
    }
    return { status: "indeterminate", message: "Rollback UUID changed while the created object reference remains valid." };
  }
  if (remaining === state.operationState.createdObject && remaining.uuid === state.operationState.createdUuid &&
      remaining.typename === "PathItem" && remaining.layer === state.preflight.targetLayer) {
    var removalFailureMessage = "Rollback removal did not remove the verified created object.";
    if (removeThrew) removalFailureMessage = "Rollback removal threw before removing the verified created object.";
    return { status: "failed", message: removalFailureMessage };
  }
  return { status: "indeterminate", message: "Rollback UUID resolved to an unexpected object identity." };
}

`;
export const CREATE_RECTANGLE_RUNNER_SCRIPT = `var transactionExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionLayers: function (phase, preflight) { return [preflight.targetLayer]; },
  // the items this change reads and writes, so an edit session can advance its item aggregate.
  editSessionAffected: function (phase, preflight, plan, state) { return phase === "after" ? [state.operationState.createdUuid] : []; },
  initialOperationState: function() { return {}; },
  preflight: rectanglePreflight,
  plan: rectanglePlan,
  revalidate: rectangleRevalidate,
  applyMutation: rectangleApply,
  verify: rectangleVerify,
  rollback: rectangleRollback,
  hasMutationEvidence: function(state) { return state.operationState.createdObject !== null && state.operationState.createdObject !== undefined; },
  applyIndeterminate: function() {
    return {
      reasonCode: "identity_unavailable",
      message: "Apply outcome is indeterminate because created-object identity is unavailable.",
      evidence: { itemUuid: null }
    };
  },
  rollbackEvidence: function(state) {
    return { itemUuid: typeof state.operationState.createdUuid === "string" && state.operationState.createdUuid.length > 0
      ? state.operationState.createdUuid : null };
  }
});

var outputDocument = transactionExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === transactionExecution.preflight.doc) {
  outputDocument = getDocumentContext();
}
if (transactionExecution.transaction.state === "verified") {
  var result = {
    applied: true,
    document: outputDocument,
    plan: transactionExecution.plan,
    item: transactionExecution.value,
    transaction: transactionExecution.transaction
  };
} else {
  var result = {
    applied: false,
    document: outputDocument,
    plan: transactionExecution.plan,
    transaction: transactionExecution.transaction
  };
}
`;
export const CREATE_RECTANGLE_SCRIPT = `
${MUTATION_TRANSACTION_SCRIPT}

${CREATE_RECTANGLE_MODULE_SCRIPT}${CREATE_RECTANGLE_RUNNER_SCRIPT}`;
