import { z } from 'zod';
import { boundsSchema, layerPathSchema } from '../mutation-result-schema-core.js';
import { pointTextSnapshotSchema } from './point-text-host-script.js';
const finite = z.number().finite();
const style = pointTextSnapshotSchema.shape.style;
export const duplicateTextSnapshotSchema = z.strictObject({
    uuid: z.string().min(1).max(255),
    type: z.literal('TextFrame'),
    name: z.string().max(255),
    layerPath: layerPathSchema,
    geometricBounds: boundsSchema,
    controlBounds: boundsSchema,
    visibleBounds: boundsSchema,
    position: z.tuple([finite, finite]),
    width: finite.nonnegative(),
    height: finite.nonnegative(),
    kind: z.literal('TextType.POINTTEXT'),
    profile: z.literal('nested_ascii_point_text_12_v1'),
    contents: z.string().min(1).max(64).regex(/^[\x20-\x7e]+$/),
    style: z.strictObject({
        ...style.shape,
        font: z.strictObject({ ...style.shape.font.shape, postScriptName: z.literal('MyriadPro-Regular') }),
        size: z.literal(12),
        tracking: z.literal(0),
        horizontalScale: z.literal(100),
        verticalScale: z.literal(100),
        fillColor: style.shape.fillColor.options[0],
        justification: z.literal('Justification.LEFT'),
    }),
    frame: z.strictObject({
        ...pointTextSnapshotSchema.shape.frame.shape,
        anchor: z.tuple([finite.int(), finite.int()]),
        matrix: z.strictObject({
            a: z.literal(1), b: z.literal(0), c: z.literal(0), d: z.literal(1),
            tx: finite.int(), ty: finite.int(),
        }),
    }),
    noteEmpty: z.literal(true),
    urlEmpty: z.literal(true),
    locked: z.boolean(), hidden: z.boolean(), editable: z.boolean(),
    layerVisible: z.boolean(), layerLocked: z.boolean(),
    effectiveLayerVisible: z.boolean(), effectiveLayerLocked: z.boolean(),
});
const { uuid: _uuid, type: _type, layerPath: _layerPath, controlBounds: _control, locked: _locked, hidden: _hidden, editable: _editable, layerVisible: _visible, layerLocked: _layerLocked, effectiveLayerVisible: _effectiveVisible, effectiveLayerLocked: _effectiveLocked, ...textStateShape } = duplicateTextSnapshotSchema.shape;
const textStateSchema = z.strictObject(textStateShape);
const validatedTextStates = new Set();
const textStateJsonSchema = z.string().min(2).max(8_192).superRefine((json, context) => {
    if (validatedTextStates.has(json))
        return;
    try {
        textStateSchema.parse(JSON.parse(json));
        if (validatedTextStates.size >= 16)
            validatedTextStates.delete(validatedTextStates.values().next().value);
        validatedTextStates.add(json);
    }
    catch {
        context.addIssue({ code: 'custom', message: 'Text JSON must contain the complete bounded semantic state.' });
    }
});
export const duplicateTextWireSnapshotSchema = z.strictObject({
    uuid: _uuid, type: _type, layerPath: _layerPath,
    locked: _locked, hidden: _hidden, editable: _editable,
    layerVisible: _visible, layerLocked: _layerLocked,
    effectiveLayerVisible: _effectiveVisible, effectiveLayerLocked: _effectiveLocked,
    textState: textStateJsonSchema,
});
export const DUPLICATE_TEXT_HOST_SCRIPT = `
function duplicateTextSnapshot(document, target, expectedUuid) {
  if (!target || target.typename !== "TextFrame" || target.kind !== TextType.POINTTEXT ||
      !target.parent || target.parent.typename !== "GroupItem" ||
      !target.parent.parent || target.parent.parent.typename !== "GroupItem" ||
      !target.parent.parent.parent || target.parent.parent.parent.typename !== "Layer" ||
      document.documentColorSpace !== DocumentColorSpace.RGB) {
    throw mutationError("preflight_failed", "Duplicate text supports nested RGB point text only.");
  }
  if (typeof target.uuid !== "string" || target.uuid.length === 0 ||
      (expectedUuid !== null && target.uuid !== expectedUuid)) {
    throw mutationError("preflight_failed", "Target native UUID is unavailable or changed.");
  }
  var layerInfo = duplicateLayerChain(document, target.layer);
  if (layerInfo === null) throw mutationError("preflight_failed", "Target layer identity is unavailable.");
  var effectiveVisible = true, effectiveLocked = false;
  for (var layerIndex = 0; layerIndex < layerInfo.chain.length; layerIndex++) {
    var layer = layerInfo.chain[layerIndex];
    if (typeof layer.visible !== "boolean" || typeof layer.locked !== "boolean") {
      throw mutationError("preflight_failed", "Layer safety state is unavailable.");
    }
    if (!layer.visible) effectiveVisible = false;
    if (layer.locked) effectiveLocked = true;
  }
  if (typeof target.locked !== "boolean" || typeof target.hidden !== "boolean" ||
      typeof target.editable !== "boolean" || String(target.note) !== "" || String(target.uRL) !== "") {
    throw mutationError("preflight_failed", "Target text safety or metadata state is unsupported.");
  }
  var contents = target.contents;
  if (typeof contents !== "string" || contents.length < 1 || contents.length > 64 ||
      !/^[\\x20-\\x7e]+$/.test(contents)) {
    throw mutationError("preflight_failed", "Duplicate text supports one printable ASCII line only.");
  }
  if (!target.story || !target.story.textFrames || target.story.textFrames.length !== 1 ||
      target.story.textFrames[0].uuid !== target.uuid) {
    throw mutationError("preflight_failed", "Duplicate text supports unthreaded point text only.");
  }
  var range = target.textRange;
  if (!range || typeof range.getTextRunLength !== "function" || range.length !== contents.length ||
      range.getTextRunLength() !== range.length || !range.characters || range.characters.length !== contents.length) {
    throw mutationError("preflight_failed", "Duplicate text requires one complete native style run.");
  }
  pointTextFrameShape(target);
  pointTextManualKerning(range);
  pointTextParagraphState(range);
  var style = pointTextStyle(target);
  if (style.font.postScriptName !== "MyriadPro-Regular" || style.size !== 12 ||
      style.tracking !== 0 || style.horizontalScale !== 100 || style.verticalScale !== 100 ||
      style.fillColor.model !== "rgb" || style.justification !== "Justification.LEFT") {
    throw mutationError("preflight_failed", "Duplicate text is outside the bounded MyriadPro-Regular 12pt RGB profile.");
  }
  for (var characterIndex = 0; characterIndex < range.characters.length; characterIndex++) {
    var character = range.characters[characterIndex];
    if (character.contents !== contents.charAt(characterIndex) ||
        stringifyJson(pointTextStyle({ textRange: { characterAttributes: character.characterAttributes,
          paragraphAttributes: range.paragraphAttributes } })) !== stringifyJson(style)) {
      throw mutationError("preflight_failed", "Duplicate text character style is mixed or unreadable.");
    }
  }
  var frame = pointTextFrameState(target), matrix = frame.matrix;
  if (matrix.a !== 1 || matrix.b !== 0 || matrix.c !== 0 || matrix.d !== 1 ||
      Math.floor(matrix.tx) !== matrix.tx || Math.floor(matrix.ty) !== matrix.ty ||
      Math.floor(frame.anchor[0]) !== frame.anchor[0] || Math.floor(frame.anchor[1]) !== frame.anchor[1]) {
    throw mutationError("preflight_failed", "Duplicate text requires an identity linear matrix and integer anchor.");
  }
  return {
    uuid: target.uuid, type: "TextFrame", name: String(target.name || ""), layerPath: layerInfo.path,
    geometricBounds: duplicateBounds(target.geometricBounds, "geometricBounds"),
    controlBounds: duplicateBounds(target.controlBounds, "controlBounds"),
    visibleBounds: duplicateBounds(target.visibleBounds, "visibleBounds"),
    position: duplicatePoint(target.position, "position"),
    width: duplicateNumber(target.width, "width"), height: duplicateNumber(target.height, "height"),
    kind: "TextType.POINTTEXT", profile: "nested_ascii_point_text_12_v1", contents: contents,
    style: style, frame: frame, noteEmpty: true, urlEmpty: true,
    locked: target.locked, hidden: target.hidden, editable: target.editable,
    layerVisible: target.layer.visible, layerLocked: target.layer.locked,
    effectiveLayerVisible: effectiveVisible, effectiveLayerLocked: effectiveLocked
  };
}
`;
