import { z } from 'zod';
import { HOST_VERSION_POLICY_JSX } from '../host-version-policy.js';
export const DUPLICATE_IMAGE_MAX_DIMENSION = 512;
const finite = z.number().finite();
const matrix = z.tuple([finite, finite, finite, finite, finite, finite]);
const box = z.tuple([finite, finite, finite, finite]);
const imageStateFields = {
    name: z.string().max(255),
    geometricBounds: box,
    visibleBounds: box,
    position: z.tuple([finite, finite]),
    width: finite.int().min(1).max(DUPLICATE_IMAGE_MAX_DIMENSION),
    height: finite.int().min(1).max(DUPLICATE_IMAGE_MAX_DIMENSION),
    matrix,
    boundingBox: box,
    opacity: z.literal(100),
    blendingMode: z.literal('BlendModes.NORMAL'),
};
const placedStateSchema = z.strictObject({
    ...imageStateFields,
    type: z.literal('PlacedItem'),
    filePath: z.string().min(1).max(4096),
    fileName: z.string().min(5).max(255).regex(/\.png$/i),
    fileSize: finite.nonnegative(),
    fileModifiedAt: finite.nonnegative(),
});
const rasterStateSchema = z.strictObject({
    ...imageStateFields,
    type: z.literal('RasterItem'),
    embedded: z.literal(true),
    imageColorSpace: z.literal('ImageColorSpace.RGB'),
    channels: z.literal(4),
    bitsPerChannel: z.literal(8),
});
export const duplicateImageStateSchema = z.discriminatedUnion('type', [placedStateSchema, rasterStateSchema]);
const imageSafetyFields = {
    uuid: z.string().min(1).max(255),
    type: z.enum(['PlacedItem', 'RasterItem']),
};
const imageStateJsonSchema = z.string().min(2).max(16_384).superRefine((json, context) => {
    try {
        duplicateImageStateSchema.parse(JSON.parse(json));
    }
    catch {
        context.addIssue({ code: 'custom', message: 'Image JSON must contain the complete bounded metadata state.' });
    }
});
export const duplicateImageWireSnapshotSchema = z.strictObject({
    ...imageSafetyFields,
    imageState: imageStateJsonSchema,
}).superRefine((snapshot, context) => {
    if (JSON.parse(snapshot.imageState).type !== snapshot.type) {
        context.addIssue({ code: 'custom', message: 'Image type and imageState type must match.' });
    }
});
export const DUPLICATE_IMAGE_HOST_SCRIPT = `${HOST_VERSION_POLICY_JSX}
/** Version rule only (the \`duplicate_object\` row admits another major.minor): no params, so it is safe in verification and rollback. */
function duplicateVersionAdmitted() {
  var versionStatus = hostVersionEvaluate("duplicate_object", String(app.version)).status;
  return versionStatus !== "blocked" && versionStatus !== "unreadable";
}
function duplicateImageType(type) {
  return type === "PlacedItem" || type === "RasterItem";
}

function duplicateImageBinding(preflight, copyUuid) {
  if (!duplicateImageType(preflight.sourceBefore.type)) return null;
  return { type: preflight.sourceBefore.type, parent: preflight.parent,
    order: copyUuid ? duplicateExpectedOrder(preflight.parentOrderBefore, params.sourceUuid, copyUuid) : null };
}

function duplicateImageLookup(document, nativeTarget, uuid, binding) {
  var type = binding ? binding.type : String(nativeTarget.typename);
  // #576 native diagnostic 2026-10-07: linked-image lookup can return a different GroupItem with the same UUID.
  if (!duplicateImageType(type) && nativeTarget.typename !== "GroupItem") {
    throw mutationError("preflight_failed", "Native UUID lookup returned an unsupported item type.");
  }
  var parent = binding && binding.parent ? binding.parent : nativeTarget.parent;
  if (!parent || parent.typename !== "GroupItem" ||
      (binding && binding.parent && !duplicateSameParent(nativeTarget.parent, parent))) {
    throw mutationError("preflight_failed", "Native image UUID lookup returned an item in a different parent group.");
  }
  var outer = parent.parent;
  if (!duplicateVersionAdmitted() || document.documentColorSpace !== DocumentColorSpace.RGB ||
      document.layers.length !== 1 || document.layers[0].layers.length !== 0 ||
      !outer || outer.typename !== "GroupItem" || outer.parent !== document.layers[0] ||
      !outer.pageItems || outer.pageItems.length !== 1 || document.layers[0].pageItems.length !== 1 ||
      parent.layer !== document.layers[0] || outer.layer !== document.layers[0] ||
      typeof parent.uuid !== "string" || typeof outer.uuid !== "string" || !parent.uuid || !outer.uuid ||
      parent.uuid === outer.uuid || parent.uuid === uuid || outer.uuid === uuid) {
    throw mutationError("preflight_failed", "Native image UUID lookup parent is outside the two-group RGB profile.");
  }
  var children = parent.pageItems;
  if (!children || children.length < 2 || children.length > 3) {
    throw mutationError("preflight_failed", "Native image UUID lookup requires a parent of two or three direct children.");
  }
  var parentState = duplicateNestedGroup(parent), outerState = duplicateNestedGroup(outer);
  if (!mutationSameSequence(outerState.order, [parent.uuid]) ||
      !mutationSameSequence(duplicateParentOrder(document.layers[0]), [outer.uuid]) ||
      (binding && binding.order && !mutationSameSequence(parentState.order, binding.order))) {
    throw mutationError("preflight_failed", "Native image UUID lookup parent ancestry or complete order changed.");
  }
  var found = null, count = 0;
  for (var index = 0; index < children.length; index++) {
    var child = children[index];
    if (!child || typeof child.uuid !== "string" ||
        !duplicateSameParent(child.parent, parent) || child.layer !== document.layers[0]) {
      throw mutationError("preflight_failed", "Native image UUID lookup child parent identity is unavailable.");
    }
    if (child.uuid !== uuid) continue;
    count++;
    if (!duplicateImageType(String(child.typename)) || (duplicateImageType(type) && child.typename !== type)) {
      throw mutationError("preflight_failed", "Native image UUID lookup child has an unexpected type.");
    }
    found = child;
  }
  if (binding && count === 0) return null;
  if (count !== 1) {
    throw mutationError("preflight_failed", "Native image UUID lookup has no unique typed child in the bound parent group.");
  }
  return found;
}

function duplicateImageFields(document, target) {
  var type = String(target.typename);
  if ((type !== "PlacedItem" && type !== "RasterItem") ||
      document.documentColorSpace !== DocumentColorSpace.RGB || target.parent.typename !== "GroupItem") {
    throw mutationError("preflight_failed", "Duplicate image supports nested RGB PlacedItem or embedded RasterItem only.");
  }
  var tags = target.tags;
  // Native 30.8.2 image imports carry this default tag (#363 F0); allow only that unchanged value or no tags.
  var supportedTags = tags && typeof tags.length === "number" &&
    (tags.length === 0 || (tags.length === 1 && String(tags[0].name) === "BBAccumRotation" && String(tags[0].value) === "0.000000"));
  // Native PlacedItem reports guides as undefined; absent image flags are not treated as enabled.
  if (target.opacity !== 100 || String(target.blendingMode) !== "BlendModes.NORMAL" ||
      String(target.note) !== "" || !supportedTags || String(target.uRL) !== "" ||
      target.visibilityVariable !== null || target.wrapped !== false ||
      (target.clipping !== undefined && target.clipping !== false) ||
      (target.guides !== undefined && target.guides !== false) || target.sliced !== false || target.isIsolated !== false) {
    throw mutationError("preflight_failed", "Duplicate image appearance or structural profile is unmeasured.");
  }
  var m = target.matrix;
  var values = [duplicateNumber(m.mValueA, "image.matrixA"), duplicateNumber(m.mValueB, "image.matrixB"),
    duplicateNumber(m.mValueC, "image.matrixC"), duplicateNumber(m.mValueD, "image.matrixD"),
    duplicateNumber(m.mValueTX, "image.matrixTX"), duplicateNumber(m.mValueTY, "image.matrixTY")];
  if (values[0] !== 1 || values[1] !== 0 || values[2] !== 0 || values[3] !== (type === "PlacedItem" ? -1 : 1) ||
      target.width < 1 || target.width > ${DUPLICATE_IMAGE_MAX_DIMENSION} || target.width !== Math.floor(target.width) ||
      target.height < 1 || target.height > ${DUPLICATE_IMAGE_MAX_DIMENSION} || target.height !== Math.floor(target.height)) {
    throw mutationError("preflight_failed", "Duplicate image supports unscaled integer dimensions from 1 to 512 only.");
  }
  var bounds = duplicateBounds(target.boundingBox, "image.boundingBox");
  if (Math.abs(bounds[2] - bounds[0]) !== target.width || Math.abs(bounds[1] - bounds[3]) !== target.height) {
    throw mutationError("preflight_failed", "Duplicate image intrinsic size is unmeasured.");
  }
  var fields = {type: type, name: String(target.name || ""),
    geometricBounds: duplicateBounds(target.geometricBounds, "image.geometricBounds"),
    visibleBounds: duplicateBounds(target.visibleBounds, "image.visibleBounds"),
    position: duplicatePoint(target.position, "image.position"), width: duplicateNumber(target.width, "image.width"),
    height: duplicateNumber(target.height, "image.height"), matrix: values, boundingBox: bounds,
    opacity: duplicateNumber(target.opacity, "image.opacity"), blendingMode: String(target.blendingMode),
    // These safety predicates are checked above and again before apply; keeping them out of the
    // public snapshot avoids repeating constant-only fields in the bounded wire schema.
  };
  if (type === "RasterItem") {
    if (target.embedded !== true || String(target.imageColorSpace) !== "ImageColorSpace.RGB" ||
        target.channels !== 4 || target.bitsPerChannel !== 8) {
      throw mutationError("preflight_failed", "Duplicate raster supports embedded RGB RGBA8 only.");
    }
    fields.embedded = true; fields.imageColorSpace = String(target.imageColorSpace);
    fields.channels = target.channels; fields.bitsPerChannel = target.bitsPerChannel;
  } else {
    var file = target.file;
    if (!file || !file.exists || file.alias === true || String(file.name).toLowerCase().slice(-4) !== ".png") {
      throw mutationError("preflight_failed", "Duplicate linked image file must exist and have a .png extension.");
    }
    var length = duplicateNumber(file.length, "image.fileSize"), modified = file.modified;
    if (length < 0) throw mutationError("preflight_failed", "Linked image file size is invalid.");
    if (!modified) throw mutationError("preflight_failed", "Linked image modification identity is unavailable.");
    var modifiedAt = Number(modified.getTime());
    fields.filePath = String(file.fsName); fields.fileName = String(file.name);
    fields.fileSize = length; fields.fileModifiedAt = modifiedAt;
  }
  return fields;
}
`;
