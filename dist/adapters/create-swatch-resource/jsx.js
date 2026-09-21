import { MUTATION_TRANSACTION_SCRIPT } from '../../mutation-transaction.js';
import { SPOT_ROLLBACK_VERIFIED_APP_VERSIONS } from './version-gate.js';
export const CREATE_SWATCH_RESOURCE_SCRIPT = `
${MUTATION_TRANSACTION_SCRIPT}

var RESOURCE_COLLECTION_LIMIT = 512;
var SPOT_ROLLBACK_VERIFIED_APP_VERSIONS = ${JSON.stringify(SPOT_ROLLBACK_VERIFIED_APP_VERSIONS)};
var RESOURCE_SNAPSHOT_MAX_BYTES = 32768;
var RESOURCE_CONTEXT_MAX_BYTES = 24576;

function resourceUtf8ByteLength(value) {
  var bytes = 0;
  for (var index = 0; index < value.length; index++) {
    var code = value.charCodeAt(index);
    if (code <= 0x7F) bytes += 1;
    else if (code <= 0x7FF) bytes += 2;
    else if (code >= 0xD800 && code <= 0xDBFF && index + 1 < value.length) {
      var low = value.charCodeAt(index + 1);
      if (low >= 0xDC00 && low <= 0xDFFF) { bytes += 4; index++; }
      else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

function resourceNumber(value, propertyName, minimum, maximum) {
  var number = mutationFiniteNumber(value, propertyName);
  if (number < minimum || number > maximum) {
    throw mutationError("preflight_failed", propertyName + " is outside the supported range.");
  }
  return number;
}

function resourceString(value, propertyName) {
  if (typeof value !== "string") throw mutationError("preflight_failed", propertyName + " is unavailable.");
  return value;
}

function resourceCmykChannel(value, name) { return Math.round(resourceNumber(value, name, 0, 100) * 100000) / 100000; }

function resourceReadProcessColor(color, allowNone) {
  if (!color || typeof color.typename !== "string") throw mutationError("preflight_failed", "Color is unavailable.");
  if (color.typename === "NoColor" && allowNone) return { model: "none" };
  if (color.typename === "RGBColor") return {
    model: "rgb", red: resourceNumber(color.red, "red", 0, 255),
    green: resourceNumber(color.green, "green", 0, 255), blue: resourceNumber(color.blue, "blue", 0, 255)
  };
  if (color.typename === "CMYKColor") return {
    model: "cmyk", cyan: resourceCmykChannel(color.cyan, "cyan"),
    magenta: resourceCmykChannel(color.magenta, "magenta"),
    yellow: resourceCmykChannel(color.yellow, "yellow"), black: resourceCmykChannel(color.black, "black")
  };
  if (color.typename === "GrayColor") return { model: "gray", gray: resourceNumber(color.gray, "gray", 0, 100) };
  if (color.typename === "LabColor") return {
    model: "lab", lightness: resourceNumber(color.l, "lightness", -128, 128),
    a: resourceNumber(color.a, "a", -128, 128), b: resourceNumber(color.b, "b", -128, 128)
  };
  throw mutationError("preflight_failed", "Unsupported process color in resource snapshot.");
}

function resourceReadSpot(spot) {
  return {
    name: resourceString(spot.name, "spot.name"),
    colorType: String(spot.colorType),
    baseColor: resourceReadProcessColor(spot.color, true)
  };
}

function resourceReadStopColor(color) {
  if (color && color.typename === "SpotColor") return {
    model: "spot", name: resourceString(color.spot.name, "spot.name"),
    tint: resourceNumber(color.tint, "tint", 0, 100),
    colorType: String(color.spot.colorType), baseColor: resourceReadProcessColor(color.spot.color, true)
  };
  return resourceReadProcessColor(color, false);
}

function resourceReadGradient(gradient) {
  if (!gradient || gradient.typename !== "Gradient") {
    throw mutationError("preflight_failed", "Gradient resource is unavailable.");
  }
  var stopCount = gradient.gradientStops.length;
  if (stopCount < 2 || stopCount > 32) {
    throw mutationError("preflight_failed", "Gradient stop count is outside the complete snapshot limit.");
  }
  var stops = [];
  for (var stopIndex = 0; stopIndex < stopCount; stopIndex++) {
    var stop = gradient.gradientStops[stopIndex];
    stops.push({
      rampPoint: resourceNumber(stop.rampPoint, "gradientStop.rampPoint", 0, 100),
      midPoint: resourceNumber(stop.midPoint, "gradientStop.midPoint", 13, 87),
      opacity: resourceNumber(stop.opacity, "gradientStop.opacity", 0, 100),
      color: resourceReadStopColor(stop.color)
    });
  }
  return {
    name: resourceString(gradient.name, "gradient.name"),
    type: String(gradient.type),
    stops: stops
  };
}

function resourceReadSwatchColor(color) {
  if (!color || typeof color.typename !== "string") throw mutationError("preflight_failed", "Swatch color is unavailable.");
  if (color.typename === "SpotColor") return resourceReadStopColor(color);
  if (color.typename === "GradientColor") {
    var gradient = resourceReadGradient(color.gradient);
    return { model: "gradient", name: gradient.name, type: gradient.type, stops: gradient.stops };
  }
  if (color.typename === "PatternColor") {
    return { model: "pattern", name: resourceString(color.pattern.name, "pattern.name") };
  }
  return resourceReadProcessColor(color, true);
}

function resourceSnapshot(document) {
  if (document.swatches.length > RESOURCE_COLLECTION_LIMIT || document.gradients.length > RESOURCE_COLLECTION_LIMIT ||
      document.spots.length > RESOURCE_COLLECTION_LIMIT) {
    throw mutationError("preflight_failed", "Resource collection exceeds the complete snapshot limit of 512.");
  }
  var swatches = [];
  for (var swatchIndex = 0; swatchIndex < document.swatches.length; swatchIndex++) {
    var swatch = document.swatches[swatchIndex];
    swatches.push(stringifyJson({ name: resourceString(swatch.name, "swatch.name"), color: resourceReadSwatchColor(swatch.color) }));
  }
  var gradients = [];
  for (var gradientIndex = 0; gradientIndex < document.gradients.length; gradientIndex++) {
    gradients.push(stringifyJson(resourceReadGradient(document.gradients[gradientIndex])));
  }
  var spots = [];
  for (var spotIndex = 0; spotIndex < document.spots.length; spotIndex++) {
    spots.push(stringifyJson(resourceReadSpot(document.spots[spotIndex])));
  }
  return { complete: true, swatches: swatches, gradients: gradients, spots: spots };
}

function resourceSnapshotEqual(left, right) {
  return stringifyJson(left) === stringifyJson(right);
}

function resourceSnapshotArrayWithoutIndex(values, index) {
  if (index < 0 || index >= values.length) return null;
  var result = [];
  for (var valueIndex = 0; valueIndex < values.length; valueIndex++) {
    if (valueIndex !== index) result.push(values[valueIndex]);
  }
  return result;
}

function resourceCreatedDeltaMatches(identity, beforeSnapshot, afterSnapshot) {
  var swatches = resourceSnapshotArrayWithoutIndex(afterSnapshot.swatches, identity.swatchIndex);
  if (swatches === null) return false;
  if (identity.resourceType === "process_rgb" || identity.resourceType === "process_cmyk") {
    return identity.collectionKind === "swatches" && identity.collectionIndex === identity.swatchIndex &&
      stringifyJson(swatches) === stringifyJson(beforeSnapshot.swatches) &&
      stringifyJson(afterSnapshot.gradients) === stringifyJson(beforeSnapshot.gradients) &&
      stringifyJson(afterSnapshot.spots) === stringifyJson(beforeSnapshot.spots);
  }
  if (identity.resourceType === "spot_rgb") {
    var spots = resourceSnapshotArrayWithoutIndex(afterSnapshot.spots, identity.collectionIndex);
    return spots !== null && identity.collectionKind === "spots" &&
      stringifyJson(swatches) === stringifyJson(beforeSnapshot.swatches) &&
      stringifyJson(spots) === stringifyJson(beforeSnapshot.spots) &&
      stringifyJson(afterSnapshot.gradients) === stringifyJson(beforeSnapshot.gradients);
  }
  var gradients = resourceSnapshotArrayWithoutIndex(afterSnapshot.gradients, identity.collectionIndex);
  return gradients !== null && identity.collectionKind === "gradients" &&
    stringifyJson(swatches) === stringifyJson(beforeSnapshot.swatches) &&
    stringifyJson(gradients) === stringifyJson(beforeSnapshot.gradients) &&
    stringifyJson(afterSnapshot.spots) === stringifyJson(beforeSnapshot.spots);
}

function resourcePredictedAfterSnapshot(beforeSnapshot, resource) {
  var predicted = {
    complete: true,
    swatches: beforeSnapshot.swatches.slice(0),
    gradients: beforeSnapshot.gradients.slice(0),
    spots: beforeSnapshot.spots.slice(0)
  };
  if (resource.kind === "process") {
    predicted.swatches.push(stringifyJson({ name: resource.name, color: resource.color }));
    return predicted;
  }
  if (resource.kind === "spot") {
    predicted.spots.push(stringifyJson({ name: resource.name, colorType: "ColorModel.SPOT", baseColor: resource.color }));
    predicted.swatches.push(stringifyJson({
      name: resource.name,
      color: { model: "spot", name: resource.name, tint: 100, colorType: "ColorModel.SPOT", baseColor: resource.color }
    }));
    return predicted;
  }
  var nativeGradient = {
    name: resource.name,
    type: "GradientType.LINEAR",
    stops: resource.stops
  };
  predicted.gradients.push(stringifyJson(nativeGradient));
  predicted.swatches.push(stringifyJson({
    name: resource.name,
    color: { model: "gradient", name: nativeGradient.name, type: nativeGradient.type, stops: nativeGradient.stops }
  }));
  return predicted;
}

function resourcePredictedInsertedEntries(beforeSnapshot, resource) {
  var predicted = resourcePredictedAfterSnapshot(beforeSnapshot, resource);
  var entries = { swatchEntry: predicted.swatches[predicted.swatches.length - 1], collectionEntry: null };
  if (resource.kind === "gradient") entries.collectionEntry = predicted.gradients[predicted.gradients.length - 1];
  if (resource.kind === "spot") entries.collectionEntry = predicted.spots[predicted.spots.length - 1];
  return entries;
}

function resourcePredictedMutationContext(context) {
  return {
    keyVersion: context.keyVersion,
    key: context.saved ? context.key.replace("|saved=true|", "|saved=false|") : context.key,
    name: context.name,
    path: context.path,
    fileRevision: context.fileRevision,
    saved: false,
    colorSpace: context.colorSpace,
    activeArtboardIndex: context.activeArtboardIndex,
    activeArtboardBounds: context.activeArtboardBounds,
    artboardCount: context.artboardCount,
    appVersion: context.appVersion,
    mutationAllowed: false,
    mutationBlockedReason: "Save pending document changes before mutation."
  };
}

function resourceValidateRequest() {
  var resource = params.resource;
  if (!resource || (resource.kind !== "process" && resource.kind !== "gradient" && resource.kind !== "spot")) {
    throw mutationError("preflight_failed", "Resource kind must be process, gradient, or spot.");
  }
  if (typeof resource.name !== "string" || resource.name.length < 1 || resource.name.length > 31) {
    throw mutationError("preflight_failed", "Resource name must contain 1..31 UTF-16 code units.");
  }
  function validateRgb(color, path) {
    if (!color || color.model !== "rgb") throw mutationError("preflight_failed", path + " must be explicit RGB.");
    var values = [color.red, color.green, color.blue];
    for (var index = 0; index < values.length; index++) {
      resourceNumber(values[index], path, 0, 255);
      if (Math.floor(values[index]) !== values[index]) throw mutationError("preflight_failed", path + " channels must be integers.");
    }
  }
  if (resource.kind === "process" && resource.color && resource.color.model === "cmyk") {
    var channels = ["cyan", "magenta", "yellow", "black"];
    for (var i = 0; i < channels.length; i++) {
      var value = resource.color[channels[i]];
      if (resourceCmykChannel(value, channels[i]) !== value) throw mutationError("preflight_failed", "CMYK channels require five-decimal canonical values.");
    }
    return;
  }
  if (resource.kind === "process" || resource.kind === "spot") {
    validateRgb(resource.color, "resource.color");
    return;
  }
  if (resource.type !== "linear" || !resource.stops || resource.stops.length !== 2) {
    throw mutationError("preflight_failed", "Gradient must be a measured two-stop linear RGB definition.");
  }
  var expectedRampPoints = [0, 100];
  for (var stopIndex = 0; stopIndex < 2; stopIndex++) {
    var stop = resource.stops[stopIndex];
    if (!stop || stop.rampPoint !== expectedRampPoints[stopIndex] || stop.midPoint !== 50 || stop.opacity !== 100) {
      throw mutationError("preflight_failed", "Gradient geometry must use the measured default stop positions.");
    }
    validateRgb(stop.color, "resource.stops[" + stopIndex + "].color");
  }
}

function resourceNameAbsent(document, resource) {
  var index;
  for (index = 0; index < document.swatches.length; index++) {
    if (String(document.swatches[index].name) === resource.name) return false;
  }
  if (resource.kind === "gradient") {
    for (index = 0; index < document.gradients.length; index++) {
      if (String(document.gradients[index].name) === resource.name) return false;
    }
  }
  if (resource.kind === "spot") {
    for (index = 0; index < document.spots.length; index++) {
      if (String(document.spots[index].name) === resource.name) return false;
    }
  }
  return true;
}

function resourceHostVersionVerified(resource) {
  if (resource.kind !== "spot") return true;
  var version = String(app.version);
  for (var index = 0; index < SPOT_ROLLBACK_VERIFIED_APP_VERSIONS.length; index++) {
    if (SPOT_ROLLBACK_VERIFIED_APP_VERSIONS[index] === version) return true;
  }
  return false;
}

function resourceCollectionKind(resource) {
  if (resource.kind === "process") return "swatches";
  if (resource.kind === "gradient") return "gradients";
  return "spots";
}

// ExtendScript mis-associates nested conditional expressions (a ? b : c ? d : e evaluates as (a ? b : c) ? d : e),
// so collection selection uses explicit if/else instead of a chained ternary.
function resourceCollectionByKind(document, collectionKind) {
  if (collectionKind === "swatches") return document.swatches;
  if (collectionKind === "gradients") return document.gradients;
  return document.spots;
}

function resourceNativeType(resource) {
  if (resource.kind === "process") return resource.color.model === "cmyk" ? "process_cmyk" : "process_rgb";
  if (resource.kind === "gradient") return "linear_rgb_gradient";
  return "spot_rgb";
}

function resourcePreflight(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  resourceValidateRequest();
  var beforeSnapshot = resourceSnapshot(document);
  var predictedAfterSnapshot = resourcePredictedAfterSnapshot(beforeSnapshot, params.resource);
  var nameAbsent = resourceNameAbsent(document, params.resource);
  var hostVersionVerified = resourceHostVersionVerified(params.resource);
  var collectionCapacityWithinLimit =
    predictedAfterSnapshot.swatches.length <= RESOURCE_COLLECTION_LIMIT &&
    predictedAfterSnapshot.gradients.length <= RESOURCE_COLLECTION_LIMIT &&
    predictedAfterSnapshot.spots.length <= RESOURCE_COLLECTION_LIMIT;
  var resultSizeWithinLimit =
    resourceUtf8ByteLength(stringifyJson(beforeSnapshot)) <= RESOURCE_SNAPSHOT_MAX_BYTES &&
    resourceUtf8ByteLength(stringifyJson(predictedAfterSnapshot)) <= RESOURCE_SNAPSHOT_MAX_BYTES &&
    resourceUtf8ByteLength(stringifyJson(resourcePredictedMutationContext(context))) <= RESOURCE_CONTEXT_MAX_BYTES;
  var blockers = [];
  if (!context.mutationAllowed) blockers.push("document_mutation_not_allowed");
  if (params.resource.kind === "process" && params.resource.color.model === "cmyk") {
    if (context.colorSpace !== "CMYK") blockers.push("process_color_space_mismatch");
  } else if (context.colorSpace !== "RGB") blockers.push("document_color_space_not_rgb");
  if (!nameAbsent) blockers.push("resource_name_already_exists");
  if (!collectionCapacityWithinLimit) blockers.push("resource_collection_capacity_exceeded");
  if (!resultSizeWithinLimit) blockers.push("result_size_limit_exceeded");
  if (!hostVersionVerified) blockers.push("spot_host_version_unverified");
  return {
    context: context,
    document: document,
    beforeSnapshot: beforeSnapshot,
    nameAbsent: nameAbsent,
    collectionCapacityWithinLimit: collectionCapacityWithinLimit,
    resultSizeWithinLimit: resultSizeWithinLimit,
    hostVersionVerified: hostVersionVerified,
    blockers: blockers
  };
}

function resourcePlan(preflight) {
  return {
    operation: "create_swatch_resource",
    documentKey: preflight.context.key,
    resource: params.resource,
    collectionKind: resourceCollectionKind(params.resource),
    beforeSnapshot: preflight.beforeSnapshot,
    nameAbsent: preflight.nameAbsent,
    collectionCapacityWithinLimit: preflight.collectionCapacityWithinLimit,
    resultSizeWithinLimit: preflight.resultSizeWithinLimit,
    hostVersionVerified: preflight.hostVersionVerified,
    applyAllowed: preflight.blockers.length === 0,
    applyBlockedReasonCodes: preflight.blockers
  };
}

function resourceRevalidate(preflight, plan) {
  var current;
  try { current = resourcePreflight(true); }
  catch (error) {
    throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Resource preconditions changed before apply."));
  }
  if (current.document !== preflight.document || !current.nameAbsent ||
      !resourceSnapshotEqual(current.beforeSnapshot, plan.beforeSnapshot) || current.blockers.length !== 0) {
    throw mutationBeforeSideEffectError("Resource collection or name preconditions changed before add().");
  }
}

function resourceRgb(value) {
  if (value.model === "cmyk") {
    var cmyk = new CMYKColor();
    cmyk.cyan = value.cyan; cmyk.magenta = value.magenta; cmyk.yellow = value.yellow; cmyk.black = value.black;
    return cmyk;
  }
  var color = new RGBColor();
  color.red = value.red; color.green = value.green; color.blue = value.blue;
  return color;
}

function resourceFindObjectIndex(collection, object) {
  for (var index = 0; index < collection.length; index++) if (collection[index] === object) return index;
  return -1;
}

function resourceFindGradientSwatchIndex(document, gradient) {
  for (var index = 0; index < document.swatches.length; index++) {
    var color = document.swatches[index].color;
    if (color && color.typename === "GradientColor" && color.gradient === gradient) return index;
  }
  return -1;
}

function resourceFindSpotSwatchIndex(document, spot) {
  var found = -1;
  for (var index = 0; index < document.swatches.length; index++) {
    var color = document.swatches[index].color;
    if (color && color.typename === "SpotColor" && color.spot === spot) {
      if (found >= 0) return -1;
      found = index;
    }
  }
  return found;
}

function resourceReadCreatedDefinition(identity, object) {
  if (identity.resourceType === "process_rgb" || identity.resourceType === "process_cmyk") {
    if (object.typename !== "Swatch") return null;
    return { kind: "process", name: String(object.name), color: resourceReadProcessColor(object.color, false) };
  }
  if (identity.resourceType === "spot_rgb") {
    if (object.typename !== "Spot" || String(object.colorType) !== "ColorModel.SPOT") return null;
    return { kind: "spot", name: String(object.name), color: resourceReadProcessColor(object.color, false) };
  }
  if (object.typename !== "Gradient") return null;
  var gradient = resourceReadGradient(object);
  var stops = [];
  for (var index = 0; index < gradient.stops.length; index++) {
    var stop = gradient.stops[index];
    stops.push({ rampPoint: stop.rampPoint, midPoint: stop.midPoint, opacity: stop.opacity, color: stop.color });
  }
  return {
    kind: "gradient",
    name: gradient.name,
    type: gradient.type === "GradientType.LINEAR" ? "linear" : String(gradient.type),
    stops: stops
  };
}

function resourceIdentityMatches(document, state) {
  var identity = state.operationState.identity;
  var object = state.operationState.createdObject;
  if (!identity || !object) return false;
  var collection = resourceCollectionByKind(document, identity.collectionKind);
  if (identity.collectionIndex >= collection.length || collection[identity.collectionIndex] !== object ||
      String(object.name) !== identity.name) return false;
  if (identity.resourceType === "process_rgb" || identity.resourceType === "process_cmyk") {
    if (identity.swatchIndex !== identity.collectionIndex) return false;
  } else if (identity.resourceType === "spot_rgb") {
    if (identity.swatchIndex >= document.swatches.length) return false;
    var spotSwatchColor = document.swatches[identity.swatchIndex].color;
    if (!spotSwatchColor || spotSwatchColor.typename !== "SpotColor" || spotSwatchColor.spot !== object ||
        String(spotSwatchColor.spot.name) !== identity.name) return false;
  } else {
    if (identity.swatchIndex >= document.swatches.length) return false;
    var swatchColor = document.swatches[identity.swatchIndex].color;
    if (!swatchColor || swatchColor.typename !== "GradientColor" || swatchColor.gradient !== object) return false;
  }
  var actualDefinition = resourceReadCreatedDefinition(identity, object);
  return actualDefinition !== null && stringifyJson(actualDefinition) === stringifyJson(identity.definition);
}

function resourceApply(preflight, plan, state) {
  var document = preflight.document;
  var resource = params.resource;
  var object;
  if (resource.kind === "process") {
    object = document.swatches.add();
    state.operationState.createdObject = object;
    object.name = resource.name;
    object.color = resourceRgb(resource.color);
  } else if (resource.kind === "spot") {
    object = document.spots.add();
    state.operationState.createdObject = object;
    object.name = resource.name;
    object.colorType = ColorModel.SPOT;
    object.color = resourceRgb(resource.color);
  } else {
    object = document.gradients.add();
    state.operationState.createdObject = object;
    object.name = resource.name;
    object.type = GradientType.LINEAR;
    object.gradientStops[0].color = resourceRgb(resource.stops[0].color);
    object.gradientStops[1].color = resourceRgb(resource.stops[1].color);
  }
  var collectionKind = resourceCollectionKind(resource);
  var collection = resourceCollectionByKind(document, collectionKind);
  var collectionIndex = resourceFindObjectIndex(collection, object);
  var swatchIndex;
  if (resource.kind === "process") swatchIndex = collectionIndex;
  else if (resource.kind === "spot") swatchIndex = resourceFindSpotSwatchIndex(document, object);
  else swatchIndex = resourceFindGradientSwatchIndex(document, object);
  if (collectionIndex < 0 || swatchIndex < 0) {
    throw mutationError("apply_failed", "Created native resource indices are unavailable.");
  }
  var identity = {
    collectionKind: collectionKind,
    collectionIndex: collectionIndex,
    swatchIndex: swatchIndex,
    name: resource.name,
    resourceType: resourceNativeType(resource),
    definition: resource,
    beforeSnapshot: plan.beforeSnapshot
  };
  state.operationState.identity = identity;
  state.operationState.rollbackEvidence = { resourceIdentity: identity, restoredSnapshot: null };
  return object;
}

function resourceVerify(preflight, plan, state) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) {
    throw mutationError("verify_mismatch", "Active document identity changed during resource verification.");
  }
  if (!resourceIdentityMatches(preflight.document, state)) {
    throw mutationError("verify_mismatch", "Created native resource identity or definition does not match the plan.");
  }
  var afterSnapshot = resourceSnapshot(preflight.document);
  var identity = state.operationState.identity;
  var swatchDelta = afterSnapshot.swatches.length - plan.beforeSnapshot.swatches.length;
  var gradientDelta = afterSnapshot.gradients.length - plan.beforeSnapshot.gradients.length;
  var spotDelta = afterSnapshot.spots.length - plan.beforeSnapshot.spots.length;
  var expectedGradientDelta = identity.resourceType === "linear_rgb_gradient" ? 1 : 0;
  var expectedSpotDelta = identity.resourceType === "spot_rgb" ? 1 : 0;
  if (swatchDelta !== 1 || spotDelta !== expectedSpotDelta || gradientDelta !== expectedGradientDelta) {
    throw mutationError("verify_mismatch", "Complete resource collection delta does not match one created resource.");
  }
  if (!resourceCreatedDeltaMatches(identity, plan.beforeSnapshot, afterSnapshot)) {
    throw mutationError("verify_mismatch", "Complete resource collection content or order changed during creation.");
  }
  var predictedEntries = resourcePredictedInsertedEntries(plan.beforeSnapshot, params.resource);
  var insertedCollectionEntry = null;
  if (identity.collectionKind === "gradients") insertedCollectionEntry = afterSnapshot.gradients[identity.collectionIndex];
  if (identity.collectionKind === "spots") insertedCollectionEntry = afterSnapshot.spots[identity.collectionIndex];
  if (afterSnapshot.swatches[identity.swatchIndex] !== predictedEntries.swatchEntry ||
      insertedCollectionEntry !== predictedEntries.collectionEntry) {
    throw mutationError("verify_mismatch", "Inserted native resource entries do not match the predicted definition.");
  }
  return {
    collectionKind: identity.collectionKind,
    collectionIndex: identity.collectionIndex,
    swatchIndex: identity.swatchIndex,
    name: identity.name,
    resourceType: identity.resourceType,
    definition: identity.definition,
    beforeSnapshot: identity.beforeSnapshot,
    afterSnapshot: afterSnapshot
  };
}

function resourceRollback(state) {
  var document = state.preflight.document;
  var evidence = state.operationState.rollbackEvidence;
  if (!evidence || !state.operationState.identity || !state.operationState.createdObject) {
    return { status: "indeterminate", message: "Rollback native resource identity is unavailable." };
  }
  if (app.documents.length === 0 || app.activeDocument !== document) {
    return { status: "indeterminate", message: "Rollback document identity changed." };
  }
  var snapshotBeforeRemove;
  try { snapshotBeforeRemove = resourceSnapshot(document); }
  catch (snapshotError) { return { status: "indeterminate", message: "Rollback resource snapshot is unavailable." }; }
  if (!resourceIdentityMatches(document, state)) {
    if (resourceSnapshotEqual(snapshotBeforeRemove, state.preflight.beforeSnapshot)) {
      evidence.restoredSnapshot = snapshotBeforeRemove;
      return { status: "verified" };
    }
    return { status: "indeterminate", message: "Rollback refused because captured resource identity changed." };
  }
  var removeThrew = false;
  try { state.operationState.createdObject.remove(); }
  catch (removeError) { removeThrew = true; }
  var restored;
  try { restored = resourceSnapshot(document); }
  catch (postRemoveError) { return { status: "indeterminate", message: "Rollback post-remove snapshot is unavailable." }; }
  evidence.restoredSnapshot = restored;
  if (resourceSnapshotEqual(restored, state.preflight.beforeSnapshot)) return { status: "verified" };
  if (resourceIdentityMatches(document, state)) {
    return { status: "failed", message: removeThrew
      ? "Rollback removal threw and the captured native resource remains present."
      : "Rollback removal returned but the captured native resource remains present." };
  }
  return { status: "indeterminate", message: "Rollback did not restore the exact complete resource snapshot." };
}

var transactionExecution = runMutationTransaction({
  apply: params.apply === true,
  // the items this change reads and writes, so an edit session can advance its item aggregate.
  editSessionAffected: function () { return []; },
  initialOperationState: function() { return {}; },
  preflight: resourcePreflight,
  plan: resourcePlan,
  revalidate: resourceRevalidate,
  applyMutation: resourceApply,
  verify: resourceVerify,
  rollback: resourceRollback,
  hasMutationEvidence: function(state) { return !!state.operationState.identity; },
  applyIndeterminate: function() {
    return {
      reasonCode: "identity_unavailable",
      message: "Apply outcome is indeterminate because the complete native resource identity was not captured.",
      evidence: { resourceIdentity: null, restoredSnapshot: null }
    };
  },
  rollbackEvidence: function(state) { return state.operationState.rollbackEvidence; }
});

var outputDocument = transactionExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === transactionExecution.preflight.document) outputDocument = getDocumentContext();
if (transactionExecution.transaction.state === "verified") {
  var result = {
    applied: true,
    document: outputDocument,
    plan: transactionExecution.plan,
    resource: transactionExecution.value,
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
