import { z } from 'zod';
import { boundsSchema } from '../mutation-result-schema-core.js';
import { clipContentSnapshotSchema } from './clipping-mask-shared.js';
const finite = z.number().finite();
export const CLIP_IMAGE_MAX_TAGS = 8;
export const clipImageSnapshotSchema = z.strictObject({
    uuid: z.string().min(1).max(255),
    type: z.enum(['PlacedItem', 'RasterItem']),
    name: z.string().max(1024),
    parentType: z.enum(['Layer', 'GroupItem']),
    geometricBounds: boundsSchema,
    visibleBounds: boundsSchema,
    boundingBox: boundsSchema,
    matrix: z.tuple([finite, finite, finite, finite, finite, finite]),
    filePath: z.string().min(1).max(4096).nullable(),
    imageColorSpace: z.enum(['ImageColorSpace.RGB', 'ImageColorSpace.CMYK']).nullable(),
    opacity: z.literal(100),
    locked: z.boolean(),
    hidden: z.boolean(),
    artworkKnockout: z.enum(['KnockoutState.DISABLED', 'KnockoutState.INHERITED']),
    tags: z.array(z.strictObject({ name: z.string().max(1024), value: z.string().max(4096) })).max(CLIP_IMAGE_MAX_TAGS),
    selectionUuids: z.array(z.string().min(1).max(255)).max(128),
}).superRefine((value, context) => {
    if ((value.type === 'PlacedItem') !== (value.filePath !== null) ||
        (value.type === 'RasterItem') !== (value.imageColorSpace !== null)) {
        context.addIssue({ code: 'custom', message: 'Image evidence must match the linked or embedded type.' });
    }
    const [a, b, c, d] = value.matrix;
    if (a <= 0 || b !== 0 || c !== 0 || (value.type === 'PlacedItem' ? d >= 0 : d <= 0) || Math.abs(a - Math.abs(d)) > 1e-6) {
        context.addIssue({ code: 'custom', message: 'Clipping images require an upright, uniformly scaled image.' });
    }
    const box = value.boundingBox;
    const bounds = value.geometricBounds;
    if (box[2] <= box[0] || box[1] <= box[3] || bounds[2] <= bounds[0] || bounds[1] <= bounds[3] ||
        Math.abs(bounds[2] - bounds[0] - (box[2] - box[0]) * a) > 0.01 || Math.abs(bounds[1] - bounds[3] - (box[1] - box[3]) * Math.abs(d)) > 0.01 ||
        !bounds.every((v, i) => v === value.visibleBounds[i]) || new Set(value.selectionUuids).size !== value.selectionUuids.length) {
        context.addIssue({ code: 'custom', message: 'Image geometry and selection must stay within the measured profile.' });
    }
});
export function clipImageMaskSupported(mask) {
    const b = mask.geometricBounds;
    const points = mask.pathPoints;
    if (!mask.closed || mask.opacity !== 100 || points.length !== 4 || b[2] <= b[0] || b[1] <= b[3])
        return false;
    return new Set(points.map(p => p.anchor.join(','))).size === 4 && points.every((p, i) => {
        const a = p.anchor, next = points[(i + 1) % 4].anchor;
        return p.pointType === 'PointType.CORNER' && p.leftDirection.every((v, j) => v === a[j]) && p.rightDirection.every((v, j) => v === a[j]) &&
            (a[0] === b[0] || a[0] === b[2]) && (a[1] === b[1] || a[1] === b[3]) && (a[0] === next[0]) !== (a[1] === next[1]);
    });
}
export const clipCreateContentSchema = z.union([clipContentSnapshotSchema, clipImageSnapshotSchema]);
export function isClipImage(content) {
    return content.type === 'PlacedItem' || content.type === 'RasterItem';
}
export const CLIPPING_IMAGE_CONTENT_SCRIPT = `
function clipImageFind(document, uuid) {
  var resolved = resolvePageItemDirect(document, uuid);
  return resolved !== null && (resolved.typename === "PlacedItem" || resolved.typename === "RasterItem") ? resolved.item : null;
}
function clipIsImage(target) { return target.type === "PlacedItem" || target.type === "RasterItem"; }
function clipImageNumber(value) {
  if (typeof value!=="number" || !isFinite(value)) throw mutationError("preflight_failed","Image numeric evidence is unreadable.");
  var rounded=Number(value.toFixed(12)); return rounded===0 ? 0 : rounded;
}
function clipImageSelection(document) {
  var selection=document.selection, result=[];
  if (selection===null) return result;
  if (isTextRangeSelection(selection)) throw clipUnsupported("text_editing_selection",params.contentUuid);
  if (!selection || typeof selection.length!=="number" || selection.length>128) throw clipUnsupported("selection_unmeasured",params.contentUuid);
  for(var i=0;i<selection.length;i++) {
    var uuid=selection[i].uuid;
    if(typeof uuid!=="string" || uuid.length===0 || clipIndexOf(result,uuid)>=0) throw clipUnsupported("selection_unmeasured",params.contentUuid);
    result.push(uuid);
  }
  return result;
}
function clipImageRectangle(mask) {
  var points=mask.pathPoints, b=mask.geometricBounds;
  if(!mask.closed || points.length!==4 || mask.opacity!==100 || b[2]<=b[0] || b[1]<=b[3]) return false;
  var seen=[];
  for(var i=0;i<4;i++) {
    var p=points[i], a=p.anchor;
    if(p.pointType!=="PointType.CORNER" || !mutationSameSequence(a,p.leftDirection) || !mutationSameSequence(a,p.rightDirection)) return false;
    if((a[0]!==b[0] && a[0]!==b[2]) || (a[1]!==b[1] && a[1]!==b[3])) return false;
    var key=String(a[0])+","+String(a[1]); if(clipIndexOf(seen,key)>=0) return false;seen.push(key);
    var next=points[(i+1)%4].anchor;
    if((a[0]===next[0]) === (a[1]===next[1])) return false;
  }
  return true;
}
function clipImageTags(target,uuid) {
  var tags=target.tags,result=[];
  if(!tags || typeof tags.length!=="number" || tags.length>${CLIP_IMAGE_MAX_TAGS}) throw clipUnsupported("image_appearance_unmeasured",uuid);
  for(var i=0;i<tags.length;i++) {
    var name=String(tags[i].name),value=String(tags[i].value);
    if(name.length>1024 || value.length>4096) throw clipUnsupported("image_appearance_unmeasured",uuid);
    result.push({name:name,value:value});
  }
  return result;
}
function clipImageSnapshot(document,target,expectedParent) {
  var type=String(target.typename),uuid=String(target.uuid);
  if((type!=="PlacedItem" && type!=="RasterItem") || clipImageFind(document,uuid)!==target || target.parent!==expectedParent) throw clipUnsupported("image_identity_unmeasured",uuid);
  if(typeof target.locked!=="boolean" || typeof target.hidden!=="boolean") throw mutationError("preflight_failed","Image safety state is unreadable.");
  if(Number(target.opacity)!==100 || String(target.blendingMode)!=="BlendModes.NORMAL" ||
      String(target.note)!=="" || String(target.uRL)!=="" || target.visibilityVariable!==null || target.sliced || target.isIsolated || target.wrapped) {
    throw clipUnsupported("image_appearance_unmeasured",uuid);
  }
  var knockout=String(target.artworkKnockout);
  if(knockout!=="KnockoutState.DISABLED" && knockout!=="KnockoutState.INHERITED") throw clipUnsupported("image_appearance_unmeasured",uuid);
  var tags=clipImageTags(target,uuid);
  var m=target.matrix, box=target.boundingBox;
  if(!m || !box || box.length!==4) throw mutationError("preflight_failed","Image geometry is unreadable.");
  var matrix=[clipImageNumber(m.mValueA),clipImageNumber(m.mValueB),clipImageNumber(m.mValueC),clipImageNumber(m.mValueD),clipImageNumber(m.mValueTX),clipImageNumber(m.mValueTY)];
  if(matrix[0]<=0 || matrix[1]!==0 || matrix[2]!==0 || Math.abs(matrix[0]-Math.abs(matrix[3]))>0.000001 ||
    (type==="PlacedItem" && matrix[3]>=0) || (type==="RasterItem" && matrix[3]<=0)) throw clipUnsupported("image_transform_unmeasured",uuid);
  var bounds=supportedPathBounds(target.geometricBounds,"image.bounds"), visible=supportedPathBounds(target.visibleBounds,"image.visibleBounds");
  var intrinsic=[];for(var i=0;i<4;i++) intrinsic.push(clipImageNumber(box[i]));
  if(intrinsic[2]<=intrinsic[0] || intrinsic[1]<=intrinsic[3] || bounds[2]<=bounds[0] || bounds[1]<=bounds[3]) throw clipUnsupported("image_geometry_unmeasured",uuid);
  if(Math.abs(bounds[2]-bounds[0]-(intrinsic[2]-intrinsic[0])*matrix[0])>0.01 ||
    Math.abs(bounds[1]-bounds[3]-(intrinsic[1]-intrinsic[3])*Math.abs(matrix[3]))>0.01 || !supportedPathSame(bounds,visible)) throw clipUnsupported("image_geometry_unmeasured",uuid);
  var filePath=null,space=null;
  if(type==="PlacedItem") {
    filePath=String(target.file.fsName);
    if(filePath.length===0 || filePath.length>4096) throw clipUnsupported("image_link_unreadable",uuid);
    if(document.documentColorSpace===DocumentColorSpace.RGB && !/\\.png$/i.test(filePath)) throw clipUnsupported("image_source_unmeasured",uuid);
    if(document.documentColorSpace===DocumentColorSpace.CMYK && !/\\.tiff?$/i.test(filePath)) throw clipUnsupported("image_source_unmeasured",uuid);
  } else {
    space=String(target.imageColorSpace);
    if(target.embedded!==true || (space!=="ImageColorSpace.RGB" && space!=="ImageColorSpace.CMYK")) throw clipUnsupported("image_source_unmeasured",uuid);
    if((document.documentColorSpace===DocumentColorSpace.RGB && space!=="ImageColorSpace.RGB") ||
      (document.documentColorSpace===DocumentColorSpace.CMYK && space!=="ImageColorSpace.CMYK")) throw clipUnsupported("image_source_unmeasured",uuid);
  }
  return {uuid:uuid,type:type,name:String(target.name||""),parentType:String(expectedParent.typename),geometricBounds:bounds,visibleBounds:visible,
    boundingBox:intrinsic,matrix:matrix,filePath:filePath,imageColorSpace:space,opacity:100,locked:target.locked,hidden:target.hidden,artworkKnockout:knockout,tags:tags,selectionUuids:clipImageSelection(document)};
}
function createClipContentSnapshot(document,content,container,admitCmyk) {
  var type=String(content.typename);
  if(type==="PlacedItem" || type==="RasterItem") return clipImageSnapshot(document,content,container);
  if(type==="PathItem") return clipPathSnapshot(document,content,container,admitCmyk);
  return clipGroupSnapshot(document,content,container,false,false);
}
function createClipGroupSnapshot(document,group,layer,preflight) {
  if(!clipIsImage(preflight.contentBefore)) return clipGroupSnapshot(document,group,layer,true,preflight.admitCmyk);
  if(group.pageItems.length!==2 || group.pageItems[0]!==preflight.mask || group.pageItems[1]!==preflight.content ||
    group.parent!==layer || String(group.blendingMode)!=="BlendModes.NORMAL" || String(group.note)!=="") throw mutationError("verify_mismatch","Image clip structure changed.");
  var mask=clipPathSnapshot(document,preflight.mask,group,preflight.admitCmyk);
  var content=clipImageSnapshot(document,preflight.content,group);
  return {uuid:String(group.uuid),geometricBounds:supportedPathBounds(group.geometricBounds,"group.bounds"),
    visibleBounds:supportedPathBounds(group.visibleBounds,"group.visibleBounds"),clipped:group.clipped,locked:group.locked,hidden:group.hidden,
    childOrder:[mask.uuid,content.uuid],mask:mask,content:content};
}
`;
