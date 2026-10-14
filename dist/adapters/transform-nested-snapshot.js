import { z } from 'zod';
import { groupRowsMatch, transformGroupRowsSchema } from './transform-group-snapshot.js';
export const NESTED_TRANSLATE_MAX_UNITS = 4_096;
export const nestedTranslateEvidenceSchema = z.string().min(2).max(NESTED_TRANSLATE_MAX_UNITS).superRefine((value, ctx) => {
    try {
        nestedTranslateRows(value);
    }
    catch {
        ctx.addIssue({ code: 'custom', message: 'Invalid bounded nested translation evidence.' });
    }
});
export function nestedTranslateRows(value) {
    const rows = transformGroupRowsSchema.parse(JSON.parse(value));
    if (rows.length !== 4 || rows.slice(1).some(r => r.parentUuid !== rows[0].uuid || !['TextFrame', 'PathItem'].includes(r.type)) ||
        rows.filter(r => r.type === 'TextFrame').length !== 1)
        throw new Error('Nested translation requires three direct children.');
    return rows;
}
export function translateNestedEvidence(value, uuid, dx, dy) {
    const rows = nestedTranslateRows(value);
    const target = rows.slice(1).find(row => row.uuid === uuid);
    if (!target)
        throw new Error('Nested target is absent.');
    const n = (v) => Number(v.toFixed(12)) || 0;
    const p = ([x, y]) => [n(x + dx), n(y + dy)];
    target.bounds = target.bounds.map((v, i) => n(v + (i % 2 === 0 ? dx : dy)));
    target.position = p(target.position);
    target.coordinates = target.coordinates.map(p);
    const children = rows.slice(1), root = rows[0];
    root.bounds = [Math.min(...children.map(r => r.bounds[0])), Math.max(...children.map(r => r.bounds[1])),
        Math.max(...children.map(r => r.bounds[2])), Math.min(...children.map(r => r.bounds[3]))];
    root.position = [root.bounds[0], root.bounds[1]];
    return JSON.stringify(rows);
}
export function nestedEvidenceMatches(a, b) {
    if (a === undefined || b === undefined)
        return a === b;
    return groupRowsMatch(nestedTranslateRows(a), nestedTranslateRows(b));
}
export const TRANSFORM_NESTED_SCRIPT = `
function transformNestedRows(value) {
  function reject(){throw mutationError("preflight_failed","Invalid bounded nested translation evidence.");}
  function numbers(sequence,length){
    if(!(sequence instanceof Array) || sequence.length!==length)reject();
    for(var n=0;n<sequence.length;n++)if(typeof sequence[n]!=="number" || !isFinite(sequence[n]))reject();
  }
  if(typeof value!=="string" || value.length<2 || value.length>${NESTED_TRANSLATE_MAX_UNITS})reject();
  var rows=parseJsonValue(value),seen={},texts=0;
  if(!(rows instanceof Array) || rows.length!==4)reject();
  for(var i=0;i<rows.length;i++){
    var r=rows[i];
    if(!r || typeof r!=="object" || r instanceof Array || typeof r.uuid!=="string" || r.uuid.length<1 ||
      r.uuid.length>255 || seen.hasOwnProperty("uuid:"+r.uuid) || typeof r.parentUuid!=="string" || r.parentUuid.length>255 ||
      typeof r.attributes!=="string" || r.attributes.length<2 || r.attributes.length>65536)reject();
    seen["uuid:"+r.uuid]=true;
    if(i===0){if(r.type!=="GroupItem" || r.parentUuid!=="")reject();}
    else {if(r.parentUuid!==rows[0].uuid || (r.type!=="TextFrame" && r.type!=="PathItem"))reject();}
    if(r.type==="TextFrame")texts++;
    numbers(r.bounds,4);numbers(r.position,2);
    if(!(r.coordinates instanceof Array) || r.coordinates.length>768)reject();
    for(var p=0;p<r.coordinates.length;p++)numbers(r.coordinates[p],2);
  }
  if(texts!==1)reject();
  return rows;
}
function transformNestedMatches(a,b) {
  if(typeof a!=="string" || typeof b!=="string")return a===b;
  return transformGroupRowsMatch(transformNestedRows(a),transformNestedRows(b));
}
function transformNestedTranslate(value,uuid,dx,dy) {
  var rows=transformNestedRows(value),found=false;
  function p(v){return [transformNumber(v[0]+dx,"nested.x"),transformNumber(v[1]+dy,"nested.y")];}
  for(var i=1;i<rows.length;i++){var r=rows[i];if(r.uuid===uuid){found=true;
    r.bounds=[transformNumber(r.bounds[0]+dx,"nested.left"),transformNumber(r.bounds[1]+dy,"nested.top"),transformNumber(r.bounds[2]+dx,"nested.right"),transformNumber(r.bounds[3]+dy,"nested.bottom")];
    r.position=p(r.position);for(var j=0;j<r.coordinates.length;j++)r.coordinates[j]=p(r.coordinates[j]);}}
  if(!found)throw mutationError("preflight_failed","Nested target is absent.");
  var b=rows[1].bounds.slice();for(var k=2;k<rows.length;k++){var q=rows[k].bounds;b=[Math.min(b[0],q[0]),Math.max(b[1],q[1]),Math.max(b[2],q[2]),Math.min(b[3],q[3])];}
  rows[0].bounds=b;rows[0].position=[b[0],b[1]];return stringifyJson(rows);
}
function transformSameTarget(target,original,snapshot) {
  if(!snapshot.nestedGroup)return target===original;
  var rows=transformNestedRows(snapshot.nestedGroup);
  return target && String(target.uuid)===snapshot.uuid && String(target.typename)===snapshot.type &&
    target.parent && String(target.parent.typename)==="GroupItem" && String(target.parent.uuid)===rows[0].uuid;
}
function transformNestedEvidence(document,target) {
  function reject(message){throw mutationError("preflight_failed","Nested translate: "+message);}
  var parent=target.parent;
  if(params.transform.type!=="translate" || String(document.documentColorSpace)!=="DocumentColorSpace.CMYK" ||
    document.layers.length!==1 || document.layers[0].layers.length!==0 || parent.typename!=="GroupItem" ||
    parent.parent.typename!=="Layer" || parent.layer!==document.layers[0] || parent.clipped!==false ||
    parent.locked!==false || parent.hidden!==false || parent.editable!==true || parent.layer.locked || !parent.layer.visible)reject("outside measured CMYK depth-one unclipped profile.");
  var groupUuid=String(parent.uuid),group=document.getPageItemFromUuid(groupUuid);
  if(!group || String(group.uuid)!==groupUuid || group.typename!=="GroupItem" || group.parent.typename!=="Layer" ||
    group.layer!==parent.layer)reject("native parent lookup has wrong identity/type/parent.");
  var members=group.pageItems,rows=[],seen={},texts=0,lines=0,rectangles=0;
  if(members.length!==3)reject("requires exactly three direct children.");
  function row(item,parentUuid){
    var b=item.geometricBounds;return {uuid:String(item.uuid),parentUuid:parentUuid,type:String(item.typename),
      bounds:[transformNumber(b[0],"nested.left"),transformNumber(b[1],"nested.top"),transformNumber(b[2],"nested.right"),transformNumber(b[3],"nested.bottom")],
      position:transformPoint(item.position,"nested.position"),coordinates:[],attributes:""};
  }
  function number(value){if(typeof value!=="number" || !isFinite(value))reject("attribute is unreadable.");return value;}
  function label(value){if(value===null || typeof value==="undefined" || String(value)==="")reject("attribute is unreadable.");return String(value);}
  function paint(color){
    if(!color)reject("paint is unreadable.");var t=label(color.typename);
    if(t==="CMYKColor")return [t,number(color.cyan),number(color.magenta),number(color.yellow),number(color.black)];
    if(t==="RGBColor")return [t,number(color.red),number(color.green),number(color.blue)];
    if(t==="GrayColor")return [t,number(color.gray)];
    if(t==="NoColor")return [t];reject("unsupported paint: "+t);
  }
  function appearance(item){number(item.opacity);label(item.blendingMode);}
  appearance(group);var root=row(group,"");root.attributes=stringifyJson({name:String(group.name),clipped:group.clipped,locked:group.locked,hidden:group.hidden,editable:group.editable,opacity:group.opacity,blend:String(group.blendingMode)});rows.push(root);
  for(var i=0;i<members.length;i++){
    var member=members[i],uuid=String(member.uuid);if(!uuid || seen[uuid] || member.parent.typename!=="GroupItem" || String(member.parent.uuid)!==groupUuid)reject("child topology/UUID is unmeasured.");seen[uuid]=true;
    var item=document.getPageItemFromUuid(uuid);
    if(!item || String(item.uuid)!==uuid || item.typename!==member.typename || item.parent.typename!=="GroupItem" || String(item.parent.uuid)!==groupUuid)reject("native child lookup has wrong identity/type/parent.");
    if(item.locked!==false || item.hidden!==false || item.editable!==true)reject("children must be unlocked/visible/editable.");appearance(item);
    var r=row(item,groupUuid),attrs={name:String(item.name),opacity:item.opacity,blend:String(item.blendingMode),locked:item.locked,hidden:item.hidden,editable:item.editable};
    if(item.typename==="TextFrame"){
      if(item.kind!==TextType.POINTTEXT || item.orientation!==TextOrientation.HORIZONTAL || item.paragraphs.length!==1 ||
        String(item.contents).indexOf(String.fromCharCode(10))!==-1 || String(item.contents).indexOf(String.fromCharCode(13))!==-1)reject("requires horizontal, single-paragraph point text.");
      label(item.paragraphs[0].paragraphAttributes.justification);
      var m=item.matrix;number(m.mValueA);number(m.mValueB);number(m.mValueC);number(m.mValueD);
      var chars=item.characters;if(chars.length<1 || chars.length>TRANSFORM_TEXT_MAX_CHARACTERS)reject("text character limit exceeded.");
      for(var c=0;c<chars.length;c++){var a=chars[c].characterAttributes;
        label(a.textFont.name);number(a.size);number(a.tracking);number(a.horizontalScale);number(a.verticalScale);
        number(a.baselineShift);number(a.rotation);number(a.leading);if(typeof a.autoLeading!=="boolean")reject("autoLeading is unreadable.");paint(a.fillColor);paint(a.strokeColor);}
      var frame=transformTextFrameEvidence(item,true);attrs.text=frame.attributes;attrs.kind=frame.kind;attrs.orientation=frame.orientation;attrs.characterCount=frame.characterCount;
      r.coordinates=[frame.anchor,frame.matrixTranslation];texts++;
    }else if(item.typename==="PathItem"){
      if(item.clipping!==false || item.guides!==false || typeof item.filled!=="boolean" || typeof item.stroked!=="boolean")reject("path flags are unreadable or clipped/guides.");
      var points=item.pathPoints;if(item.closed===false && points.length===2)lines++;else if(item.closed===true && points.length===4)rectangles++;else reject("only a two-point open line and stationary rectangle were measured.");
      attrs.closed=item.closed;attrs.clipping=item.clipping;attrs.guides=item.guides;attrs.filled=item.filled;attrs.stroked=item.stroked;
      attrs.strokeWidth=number(item.strokeWidth);attrs.fill=paint(item.fillColor);attrs.stroke=paint(item.strokeColor);
      attrs.dashOffset=number(item.strokeDashOffset);attrs.cap=label(item.strokeCap);attrs.join=label(item.strokeJoin);attrs.miter=number(item.strokeMiterLimit);attrs.dashes=[];
      if(!item.strokeDashes)reject("stroke dashes are unreadable.");
      for(var dash in item.strokeDashes)if(item.strokeDashes.hasOwnProperty(dash) && /^[0-9]+$/.test(String(dash)))attrs.dashes.push([String(dash),number(item.strokeDashes[dash])]);
      attrs.pointTypes=[];
      for(var p=0;p<points.length;p++){var point=points[p],anchor=transformPoint(point.anchor,"nested.anchor");
        var left=transformPoint(point.leftDirection,"nested.left"),right=transformPoint(point.rightDirection,"nested.right");
        if(!transformPointMatches(anchor,left) || !transformPointMatches(anchor,right))reject("curve handles are unmeasured.");r.coordinates.push(anchor,left,right);attrs.pointTypes.push(label(point.pointType));}
      if(item.closed){
        var corners={},box=r.bounds;
        if(box[2]<=box[0] || box[1]<=box[3])reject("stationary rectangle is degenerate.");
        for(var corner=0;corner<4;corner++){
          var a=r.coordinates[corner*3],next=r.coordinates[((corner+1)%4)*3],key=String(a[0])+","+String(a[1]);
          if((a[0]!==box[0] && a[0]!==box[2]) || (a[1]!==box[1] && a[1]!==box[3]) || corners[key] ||
            (a[0]===next[0])===(a[1]===next[1]))reject("stationary path is not an axis-aligned rectangle.");corners[key]=true;
        }
      }
      if(item.uuid===target.uuid && item.closed!==false)reject("stationary rectangle is not a translation target.");
    }else reject("child type is unmeasured.");
    r.attributes=stringifyJson(attrs);rows.push(r);
  }
  if(texts!==1 || lines!==1 || rectangles!==1 || !seen[String(target.uuid)])reject("requires one point text, one line, one stationary rectangle.");
  var evidence=stringifyJson(rows);if(evidence.length>${NESTED_TRANSLATE_MAX_UNITS})reject("evidence limit exceeded.");
  // Reject a parent whose bounds already disagree with the measured union model.
  if(!transformNestedMatches(evidence,transformNestedTranslate(evidence,String(target.uuid),0,0)))reject("parent bounds do not equal the child union.");
  return evidence;
}
`;
