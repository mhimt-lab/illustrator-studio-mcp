import { z } from 'zod';
const point = z.tuple([z.number().finite(), z.number().finite()]);
export const transformGroupRowsSchema = z.array(z.strictObject({
    uuid: z.string().min(1).max(255),
    parentUuid: z.string().max(255),
    type: z.enum(['GroupItem', 'PathItem', 'CompoundPathItem', 'TextFrame', 'PlacedItem', 'RasterItem']),
    bounds: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]),
    position: point,
    coordinates: z.array(point).max(768),
    attributes: z.string().min(2).max(65_536),
})).min(2).max(128).superRefine((rows, context) => {
    const seen = new Map();
    for (const [index, row] of rows.entries()) {
        if (seen.has(row.uuid) || (index === 0 ? row.type !== 'GroupItem' || row.parentUuid !== ''
            : !['GroupItem', 'CompoundPathItem'].includes(seen.get(row.parentUuid) ?? ''))) {
            context.addIssue({ code: 'custom', message: 'Group snapshot requires unique identities and parent-first container topology.' });
        }
        seen.set(row.uuid, row.type);
    }
});
export function translateGroupRows(rows, dx, dy) {
    const n = (value) => Number(value.toFixed(12)) || 0;
    const p = (value) => [n(value[0] + dx), n(value[1] + dy)];
    return rows.map(row => ({ ...row,
        bounds: row.bounds.map((v, i) => n(v + (i % 2 === 0 ? dx : dy))),
        position: p(row.position), coordinates: row.coordinates.map(p), }));
}
export function groupRowsMatch(a, b) {
    if (a === undefined || b === undefined)
        return a === b;
    return a.length === b.length && a.every((row, i) => {
        const other = b[i];
        const otherCoordinates = [...other.bounds, ...other.position, ...other.coordinates.flat()];
        return row.uuid === other.uuid && row.parentUuid === other.parentUuid && row.type === other.type &&
            row.attributes === other.attributes && row.coordinates.length === other.coordinates.length &&
            [...row.bounds, ...row.position, ...row.coordinates.flat()].every((v, j) => Math.abs(v - otherCoordinates[j]) <= 0.01);
    });
}
export const TRANSFORM_GROUP_SCRIPT = `
function transformGroupRows(target, enclosingBlocked) {
  var rows = [], seen = {}, characters = 0, pointCount = 0, clippedRoot = target.clipped === true, rasterCount = 0;
  function paint(color) {
    var t = String(color.typename);
    if (t === "RGBColor") return [t, color.red, color.green, color.blue];
    if (t === "CMYKColor") return [t, color.cyan, color.magenta, color.yellow, color.black];
    if (t === "GrayColor") return [t, color.gray];
    if (t === "NoColor") return [t];
    throw mutationError("preflight_failed", "Group translation contains unsupported paint: " + t);
  }
  function visit(item, parentUuid, depth) {
    if (depth > 8 || rows.length >= 128) throw mutationError("preflight_failed", "Group translation traversal limit exceeded.");
    var type = String(item.typename), uuid = item.uuid;
    if (clippedRoot && depth > 0 && type !== "PathItem" && type !== "TextFrame" && type !== "RasterItem") {
      throw mutationError("preflight_failed", "Clipped raster groups require direct path, point text and embedded raster children.");
    }
    if (typeof uuid !== "string" || !uuid || seen.hasOwnProperty(uuid)) throw mutationError("preflight_failed", "Group descendant UUID is missing or duplicated.");
    // The group's own flags, its layer and its ancestors are plan blockers. Under any of them every descendant reads
    // editable false, so editable only proves a descendant when the enclosing state is clear.
    if (depth > 0 && (item.locked !== false || item.hidden !== false || (!enclosingBlocked && item.editable !== true))) {
      throw mutationError("preflight_failed", "Group translation requires editable visible unlocked descendants.");
    }
    seen[uuid] = true;
    var bounds = item.geometricBounds, position = item.position;
    var row = {uuid:uuid,parentUuid:parentUuid,type:type,bounds:[],position:transformPoint(position,"group.position"),coordinates:[],attributes:""};
    for (var b = 0; b < 4; b++) row.bounds.push(transformNumber(bounds[b],"group.bounds"));
    var attrs = {name:String(item.name),opacity:transformNumber(item.opacity,"group.opacity")};
    rows.push(row);
    if (type === "GroupItem") {
      if (item.clipped !== false && !(depth === 0 && clippedRoot)) throw mutationError("preflight_failed", "Nested clipped groups are outside group translation support.");
      attrs.clipped = item.clipped;
      var members = item.pageItems;
      if (members.length < 1 || members.length > 128) throw mutationError("preflight_failed", "Group child count is unsupported.");
      var directCount = 0, masks = 0;
      for (var i = 0; i < members.length; i++) {var member = members[i];if (member.parent === item) {
        if (clippedRoot) {
          if (member.typename === "PathItem" && member.clipping === true) {
            if (directCount !== 0 || member.closed !== true) throw mutationError("preflight_failed", "Clipped raster group requires a frontmost closed PathItem mask.");
            masks++;
          }
        }
        visit(member,uuid,depth+1);directCount++;
      }}
      if (clippedRoot && (masks !== 1 || rasterCount === 0)) throw mutationError("preflight_failed", "Clipped raster group requires exactly one path mask and an embedded raster.");
    } else if (type === "CompoundPathItem") {
      var paths = item.pathItems;
      if (paths.length < 1 || paths.length > 128) throw mutationError("preflight_failed", "Compound child count is unsupported.");
      for (var c = 0; c < paths.length; c++) {var child = paths[c];visit(child,uuid,depth+1);}
    } else if (type === "PathItem") {
      attrs.fill = item.filled ? paint(item.fillColor) : null;
      attrs.stroke = item.stroked ? paint(item.strokeColor) : null;
      attrs.strokeWidth = transformNumber(item.strokeWidth,"group.strokeWidth");
      attrs.closed = item.closed;attrs.pointTypes = [];
      // Retain the mask flag in CAS, verification and inverse evidence (including ordinary groups).
      attrs.clipping = item.clipping === true;
      var points = item.pathPoints;
      pointCount += points.length;
      if (points.length < 1 || points.length > 256 || pointCount > 2048) throw mutationError("preflight_failed", "Group path point limit exceeded.");
      for (var p = 0; p < points.length; p++) {var point = points[p];
        row.coordinates.push(transformPoint(point.anchor,"group.anchor"),transformPoint(point.leftDirection,"group.left"),transformPoint(point.rightDirection,"group.right"));
        attrs.pointTypes.push(String(point.pointType));
      }
    } else if (type === "TextFrame") {
      if (item.kind !== TextType.POINTTEXT) throw mutationError("preflight_failed", "Group translation supports unthreaded PointText only.");
      attrs.contents = String(item.contents);attrs.characters = [];
      var chars = item.characters;characters += chars.length;
      if (chars.length < 1 || characters > 512) throw mutationError("preflight_failed", "Group text character limit exceeded.");
      for (var t = 0; t < chars.length; t++) {var character = chars[t];var ca = character.characterAttributes;var font = ca.textFont;
        attrs.characters.push({contents:String(character.contents),font:String(font.name),size:ca.size,tracking:ca.tracking,fill:paint(ca.fillColor),stroke:paint(ca.strokeColor)});
      }
    } else if (type === "PlacedItem") {
      var file = item.file; if (!file.exists) throw mutationError("preflight_failed", "Group linked file is missing.");
      attrs.file = String(file.fsName);var matrix = item.matrix;
      attrs.matrix = [matrix.mValueA,matrix.mValueB,matrix.mValueC,matrix.mValueD];
      row.coordinates.push([transformNumber(matrix.mValueTX,"group.matrixTX"),transformNumber(matrix.mValueTY,"group.matrixTY")]);
    } else if (type === "RasterItem") {
      if (item.embedded !== true) throw mutationError("preflight_failed", "Group translation requires an embedded RasterItem.");
      attrs.embedded = true;attrs.boundingBox = [];
      var box = item.boundingBox;
      for (var r = 0; r < 4; r++) attrs.boundingBox.push(transformNumber(box[r],"group.rasterBoundingBox"));
      if (box[2] <= box[0] || box[1] <= box[3]) throw mutationError("preflight_failed", "Group raster intrinsic bounds are invalid.");
      var rasterMatrix = item.matrix;
      attrs.matrix = [transformNumber(rasterMatrix.mValueA,"group.rasterA"),transformNumber(rasterMatrix.mValueB,"group.rasterB"),
        transformNumber(rasterMatrix.mValueC,"group.rasterC"),transformNumber(rasterMatrix.mValueD,"group.rasterD")];
      attrs.imageColorSpace = String(item.imageColorSpace);
      attrs.bitsPerChannel = transformNumber(item.bitsPerChannel,"group.rasterBits");
      attrs.channels = transformNumber(item.channels,"group.rasterChannels");
      if (attrs.bitsPerChannel !== 8 || !((attrs.imageColorSpace === "ImageColorSpace.RGB" && attrs.channels === 3) ||
          (attrs.imageColorSpace === "ImageColorSpace.CMYK" && attrs.channels === 4))) {
        throw mutationError("preflight_failed", "Group raster color profile is outside measured RGB/CMYK 8-bit support.");
      }
      attrs.blendingMode = String(item.blendingMode);
      if (attrs.blendingMode !== "BlendModes.NORMAL") throw mutationError("preflight_failed", "Group raster blend mode is outside measured support.");
      row.coordinates.push([transformNumber(rasterMatrix.mValueTX,"group.rasterTX"),transformNumber(rasterMatrix.mValueTY,"group.rasterTY")]);
      var visible = item.visibleBounds;
      row.coordinates.push(transformPoint([visible[0],visible[1]],"group.rasterVisibleTop"),transformPoint([visible[2],visible[3]],"group.rasterVisibleBottom"));
      rasterCount++;
    } else throw mutationError("preflight_failed", "Group translation contains unsupported item: " + type);
    row.attributes = stringifyJson(attrs);
    if (row.attributes.length > 65536) throw mutationError("preflight_failed", "Group attribute evidence limit exceeded.");
  }
  visit(target,"",0);
  if (rows.length < 2) throw mutationError("preflight_failed", "Empty groups are unsupported.");
  return rows;
}
function transformTranslateGroupRows(rows, dx, dy) {
  var out = [];
  function point(p) {return [transformNumber(p[0]+dx,"group.x"),transformNumber(p[1]+dy,"group.y")];}
  for (var i = 0; i < rows.length; i++) {var r=rows[i],coordinates=[];
    for (var j=0;j<r.coordinates.length;j++) coordinates.push(point(r.coordinates[j]));
    out.push({uuid:r.uuid,parentUuid:r.parentUuid,type:r.type,attributes:r.attributes,
      bounds:[transformNumber(r.bounds[0]+dx,"group.left"),transformNumber(r.bounds[1]+dy,"group.top"),transformNumber(r.bounds[2]+dx,"group.right"),transformNumber(r.bounds[3]+dy,"group.bottom")],position:point(r.position),coordinates:coordinates});
  }
  return out;
}
function transformGroupRowsMatch(a,b) {
  if (!a || !b) return !a && !b;
  if (a.length !== b.length) return false;
  for (var i=0;i<a.length;i++) {var x=a[i],y=b[i];
    if (x.uuid!==y.uuid || x.parentUuid!==y.parentUuid || x.type!==y.type || x.attributes!==y.attributes || x.coordinates.length!==y.coordinates.length) return false;
    for(var j=0;j<4;j++) if(Math.abs(x.bounds[j]-y.bounds[j])>TRANSFORM_TOLERANCE_PT)return false;
    if(!transformPointMatches(x.position,y.position))return false;
    for(var k=0;k<x.coordinates.length;k++)if(!transformPointMatches(x.coordinates[k],y.coordinates[k]))return false;
  }
  return true;
}
`;
