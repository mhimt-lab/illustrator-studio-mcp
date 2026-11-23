import { z } from 'zod';
import { canonicalSha256 } from '../mutation-canonical.js';
import { layerStateAfterSchema, SET_LAYER_STATE_OPERATION } from './set-layer-state-adapter.js';
import { defineBatchStep } from './batch-step-contract.js';
import { SET_LAYER_STATE_BATCH_NEXT_CALL } from './batch-step-next-call.js';
import { POINT_TEXT_APPLY_BLOCKERS } from './point-text-host-script.js';
const batchLayerBlockerSchema = z.enum([...POINT_TEXT_APPLY_BLOCKERS, 'ancestor_hidden', 'ancestor_locked']);
export const BATCH_LAYER_PATHS = [[0], [1], [1, 0]];
export function measuredLayerOrder(paths) {
    return [[[0], [1]], [[1, 0], [1]], [[1], [1, 0]]].some(order => same(paths, order));
}
function createLayerPathSchema() {
    return z.array(z.number()).superRefine((path, context) => {
        if (!BATCH_LAYER_PATHS.some(allowed => same(path, allowed)))
            context.addIssue({ code: 'custom', message: 'Unmeasured layer path.' });
    }).meta({ enum: BATCH_LAYER_PATHS.map(path => [...path]) });
}
export const batchLayerPathSchema = createLayerPathSchema();
const evidenceLayerPathSchema = createLayerPathSchema();
const { name, visible, locked } = layerStateAfterSchema.shape;
export const batchLayerAfterSchema = z.strictObject({ name, visible, locked })
    .superRefine((value, context) => { if (Object.keys(value).length === 0)
    context.addIssue({ code: 'custom', message: 'Layer after must set name, visible or locked.' }); });
const vector = (length) => z.array(z.number().finite()).length(length);
const evidenceSchema = z.strictObject({
    path: z.string().min(1).max(4096), version: z.string().min(1).max(64), colorSpace: z.string().min(1), coordinateSystem: z.string().min(1),
    rulerUnits: z.string(), rulerOrigin: vector(2), active: z.literal(0), activeLayerPath: evidenceLayerPathSchema,
    board: z.strictObject({ name: z.string(), rect: vector(4), origin: vector(2) }),
    layers: z.array(z.strictObject({ path: evidenceLayerPathSchema, name: z.string().max(1024), visible: z.boolean(), locked: z.boolean(), printable: z.literal(true),
        childLayerCount: z.number().int().min(0).max(1), pageItemCount: z.literal(1), ancestorVisible: z.boolean(), ancestorLocked: z.boolean() })).length(3),
    items: z.array(z.strictObject({ layerPath: evidenceLayerPathSchema, uuid: z.string().min(1).max(255), name: z.string(), note: z.string(),
        hidden: z.literal(false), locked: z.literal(false), editable: z.boolean(), opacity: z.literal(100), blend: z.string(),
        geometric: vector(4), visible: vector(4), control: vector(4), points: z.array(z.strictObject({ anchor: vector(2), left: vector(2), right: vector(2), type: z.string() })).length(4),
        closed: z.literal(true), filled: z.literal(true), stroked: z.literal(true), fill: vector(3), stroke: vector(3), strokeWidth: z.number().finite(), guides: z.literal(false), clipping: z.literal(false) })).length(3),
    selection: z.array(z.string()).length(0),
}).superRefine((state, context) => {
    if (new Set(state.items.map(p => p.uuid)).size !== 3)
        context.addIssue({ code: 'custom', message: 'Sentinel UUIDs must be distinct.' });
    state.layers.forEach((layer, i) => {
        const parent = i === 2 ? state.layers[1] : null;
        const item = state.items[i];
        if (!same(layer.path, BATCH_LAYER_PATHS[i]) || !same(item.layerPath, layer.path) || layer.childLayerCount !== (i === 1 ? 1 : 0) ||
            layer.ancestorVisible !== (parent?.visible ?? true) || layer.ancestorLocked !== (parent?.locked ?? false) ||
            item.editable !== (layer.visible && !layer.locked && layer.ancestorVisible && !layer.ancestorLocked)) {
            context.addIssue({ code: 'custom', message: 'Layer tree and effective sentinel state must be exact.' });
        }
    });
});
export function same(left, right) { return canonicalSha256(left) === canonicalSha256(right); }
export function decodeBatchLayerEvidence(value) { return evidenceSchema.parse(JSON.parse(value)); }
export const batchLayerSnapshotSchema = z.strictObject({ uuid: z.string().min(1).max(255), evidence: z.string().min(1).max(8192) })
    .superRefine((value, context) => {
    try {
        const state = decodeBatchLayerEvidence(value.evidence);
        if (!state.items.some(p => p.uuid === value.uuid))
            throw new Error('UUID absent');
    }
    catch {
        context.addIssue({ code: 'custom', message: 'Layer snapshot requires complete measured tree evidence and a native sentinel UUID.' });
    }
});
export function deriveBatchLayerSnapshot(before, changes) {
    const state = decodeBatchLayerEvidence(before.evidence);
    for (const change of changes) {
        const layer = state.layers.find(l => same(l.path, change.layerPath));
        if (!layer)
            throw new Error('Layer path absent');
        Object.assign(layer, change.after);
    }
    const child = state.layers[2];
    child.ancestorVisible = state.layers[1].visible;
    child.ancestorLocked = state.layers[1].locked;
    for (let i = 0; i < 3; i++) {
        const l = state.layers[i];
        state.items[i].editable = l.visible && !l.locked && l.ancestorVisible && !l.ancestorLocked;
    }
    return { uuid: before.uuid, evidence: JSON.stringify(state) };
}
export function batchLayerBlockers(mutationAllowed, before) {
    const blockers = [];
    if (!mutationAllowed)
        blockers.push('document_mutation_not_allowed');
    const state = decodeBatchLayerEvidence(before.evidence);
    if (state.layers.some(l => !l.visible))
        blockers.push('layer_hidden');
    if (state.layers.some(l => l.locked))
        blockers.push('layer_locked');
    return blockers;
}
export const batchLayerPlanSchema = z.strictObject({ layerPath: batchLayerPathSchema,
    requested: batchLayerAfterSchema, before: batchLayerSnapshotSchema, after: batchLayerSnapshotSchema,
    applyBlockedReasonCodes: z.array(batchLayerBlockerSchema) })
    .superRefine((plan, context) => {
    let state;
    try {
        state = decodeBatchLayerEvidence(plan.before.evidence);
        decodeBatchLayerEvidence(plan.after.evidence);
    }
    catch {
        context.addIssue({ code: 'custom', message: 'Layer plan evidence is invalid.' });
        return;
    }
    if (!state.items.some(p => p.uuid === plan.before.uuid && same(p.layerPath, plan.layerPath)) ||
        !same(plan.after, deriveBatchLayerSnapshot(plan.before, [{ layerPath: plan.layerPath, after: plan.requested }]))) {
        context.addIssue({ code: 'custom', message: 'Layer plan must bind the native sentinel at its path and derive the exact requested state.' });
    }
});
export const BATCH_LAYER_STATE_SCRIPT = `
function batchLayerNeed(value,message){if(!value)throw mutationError("preflight_failed",message);}
function batchLayerVector(value,length){batchLayerNeed(value&&value.length===length,"Layer evidence vector unavailable.");var out=[];for(var i=0;i<length;i++)out.push(mutationFiniteNumber(value[i],"Layer vector"));return out;}
function batchLayerRgb(color){batchLayerNeed(color&&color.typename==="RGBColor","Layer batch requires RGB sentinel paint.");return batchLayerVector([color.red,color.green,color.blue],3);}
function batchLayerEvidence(d){
 batchLayerNeed(app.activeDocument===d&&d.documentColorSpace===DocumentColorSpace.RGB,"Layer batch requires an RGB document.");
 batchLayerNeed(d.layers.length===2&&d.layers[0].layers.length===0&&d.layers[1].layers.length===1&&d.layers[1].layers[0].layers.length===0&&d.artboards.length===1&&d.pageItems.length===3,"Layer batch requires root 2 + child 1 and three direct sentinels.");
 batchLayerNeed(String(app.coordinateSystem)===String(CoordinateSystem.DOCUMENTCOORDINATESYSTEM)&&d.artboards.getActiveArtboardIndex()===0,"Layer batch coordinate profile is unmeasured.");
 var paths=[[0],[1],[1,0]],layers=[],items=[],active=null;
 for(var i=0;i<3;i++){
  var path=paths[i],chain=layerOpsResolvePath(d,path,false),l=chain[chain.length-1],row=layerOpsTargetSnapshot(chain,path);
  batchLayerNeed(typeof row.name==="string"&&l.pageItems.length===1&&l.printable===true,"Layer batch requires one direct printable sentinel layer.");
  if(l===d.activeLayer)active=path;layers.push(row);
  var p=l.pageItems[0],points=[];
  batchLayerNeed(p.typename==="PathItem"&&p.parent===l&&p.layer===l&&typeof p.uuid==="string"&&p.uuid.length>0&&p.closed===true&&p.guides===false&&p.clipping===false&&p.pathPoints.length===4&&p.filled===true&&p.stroked===true&&p.opacity===100&&p.hidden===false&&p.locked===false,"Layer batch requires plain RGB rectangle sentinels.");
  for(var q=0;q<4;q++){var t=p.pathPoints[q],next=p.pathPoints[(q+1)%4],prior=p.pathPoints[(q+3)%4];batchLayerNeed(mutationSameSequence(t.anchor,t.leftDirection)&&mutationSameSequence(t.anchor,t.rightDirection)&&((t.anchor[0]===next.anchor[0])!==(t.anchor[1]===next.anchor[1]))&&((t.anchor[0]===next.anchor[0])!==(prior.anchor[0]===t.anchor[0])),"Layer sentinel must be a straight axis-aligned rectangle.");points.push({anchor:batchLayerVector(t.anchor,2),left:batchLayerVector(t.leftDirection,2),right:batchLayerVector(t.rightDirection,2),type:String(t.pointType)});}
  items.push({layerPath:path,uuid:p.uuid,name:String(p.name),note:String(p.note),hidden:p.hidden,locked:p.locked,editable:p.editable,opacity:p.opacity,blend:String(p.blendingMode),geometric:batchLayerVector(p.geometricBounds,4),visible:batchLayerVector(p.visibleBounds,4),control:batchLayerVector(p.controlBounds,4),points:points,closed:p.closed,filled:p.filled,stroked:p.stroked,fill:batchLayerRgb(p.fillColor),stroke:batchLayerRgb(p.strokeColor),strokeWidth:p.strokeWidth,guides:p.guides,clipping:p.clipping});
 }
 batchLayerNeed(active!==null&&(!d.selection||(!isTextRangeSelection(d.selection)&&d.selection.length===0)),"Layer batch requires a bound active layer and empty selection (not a text range).");
 for(var a=0;a<3;a++)for(var b=a+1;b<3;b++)batchLayerNeed(items[a].uuid!==items[b].uuid,"Sentinel UUID collision.");
 var board=d.artboards[0];
 return {path:String(d.fullName.fsName),version:String(app.version),colorSpace:String(d.documentColorSpace),coordinateSystem:String(app.coordinateSystem),rulerUnits:String(d.rulerUnits),rulerOrigin:batchLayerVector(d.rulerOrigin,2),active:d.artboards.getActiveArtboardIndex(),activeLayerPath:active,board:{name:String(board.name),rect:batchLayerVector(board.artboardRect,4),origin:batchLayerVector(board.rulerOrigin,2)},layers:layers,items:items,selection:[]};
}
function batchLayerSnapshot(d,uuid){var state=batchLayerEvidence(d);batchLayerNeed(state.items[0].uuid===uuid||state.items[1].uuid===uuid||state.items[2].uuid===uuid,"Native sentinel UUID absent.");var evidence=stringifyJson(state);batchLayerNeed(evidence.length<=8192,"Layer evidence exceeds 8192 units.");return {uuid:uuid,evidence:evidence};}
function batchLayerSame(a,b){return !!a&&!!b&&a.uuid===b.uuid&&a.evidence===b.evidence;}
function batchLayerDerive(before,changes){var state=parseJsonValue(before.evidence);for(var i=0;i<changes.length;i++){var change=changes[i];for(var j=0;j<3;j++)if(mutationSameSequence(state.layers[j].path,change.layerPath)){var row=state.layers[j];for(var key in change.after)if(change.after.hasOwnProperty(key))row[key]=change.after[key];}}
 state.layers[2].ancestorVisible=state.layers[1].visible;state.layers[2].ancestorLocked=state.layers[1].locked;for(var k=0;k<3;k++){var layer=state.layers[k];state.items[k].editable=layer.visible&&!layer.locked&&layer.ancestorVisible&&!layer.ancestorLocked;}var evidence=stringifyJson(state);batchLayerNeed(evidence.length<=8192,"Combined layer evidence exceeds 8192 units.");return {uuid:before.uuid,evidence:evidence};}
function batchLayerResolve(){
 var context=requireDocumentForRead(params.expectedDocumentKey),d=app.activeDocument,chain=layerOpsResolvePath(d,params.layerPath,false),l=chain[chain.length-1],before=batchLayerSnapshot(d,params.targetUuid),state=parseJsonValue(before.evidence);
 batchLayerNeed(params.layerPath.length<=2&&mutationSameSequence(params.layerPath,params.layerPath.length===2?[1,0]:[params.layerPath[0]])&&l.pageItems[0].uuid===params.targetUuid,"Layer path must bind its direct native sentinel UUID.");
 batchLayerNeed(supportedPathFind(d,params.targetUuid)===l.pageItems[0],"Layer native sentinel identity changed.");
 var count=0;batchLayerNeed(params.after&&typeof params.after==="object","Layer after required.");
 for(var key in params.after)if(params.after.hasOwnProperty(key)){batchLayerNeed(key==="name"||key==="visible"||key==="locked","Unmeasured layer property.");batchLayerNeed(key==="name"?layerOpsValidName(params.after[key]):typeof params.after[key]==="boolean","Invalid layer after.");count++;}batchLayerNeed(count>0,"Layer after is empty.");
 var blockers=[];if(!context.mutationAllowed)blockers.push("document_mutation_not_allowed");for(var i=0;i<3;i++)if(!state.layers[i].visible){blockers.push("layer_hidden");break;}for(var j=0;j<3;j++)if(state.layers[j].locked){blockers.push("layer_locked");break;}
 return {context:context,document:d,target:l,sentinel:l.pageItems[0],before:before,after:batchLayerDerive(before,[{layerPath:params.layerPath,after:params.after}]),blockers:blockers};
}
function batchLayerPlan(resolved){return {layerPath:params.layerPath,requested:params.after,before:resolved.before,after:resolved.after,applyBlockedReasonCodes:resolved.blockers};}
function batchLayerWrite(target,key,value){if(key==="name")target.name=value;else if(key==="visible")target.visible=value;else if(key==="locked")target.locked=value;else throw mutationError("apply_failed","Unknown layer state key.");}
function batchLayerApply(resolved,plan,state){
 var prefix=state.preflight;batchLayerNeed(batchLayerSame(batchLayerSnapshot(resolved.document,params.targetUuid),prefix.before),"Layer prefix changed before step.");
 var row=parseJsonValue(prefix.before.evidence).layers,old=null;for(var i=0;i<row.length;i++)if(mutationSameSequence(row[i].path,plan.layerPath))old=row[i];
 var order=["name","visible","locked"];state.operationState.mutationStarted=true;
 for(var j=0;j<3;j++){var key=order[j];if(plan.requested[key]!==undefined&&plan.requested[key]!==old[key]){batchLayerWrite(resolved.target,key,plan.requested[key]);state.operationState.written.push(key);}}
 if(!batchLayerSame(batchLayerSnapshot(resolved.document,params.targetUuid),prefix.after))throw mutationError("verify_mismatch","Layer step effective state differs from its predicted prefix.");
}
function batchLayerVerify(resolved,plan){var observed=batchLayerSnapshot(resolved.document,params.targetUuid);if(!batchLayerSame(observed,plan.after))throw mutationError("verify_mismatch","Layer batch full state differs from the plan.");return observed;}
function batchLayerRollback(state){
 var p=state.preflight;if(app.documents.length===0||app.activeDocument!==p.document)return {status:"indeterminate",message:"Layer rollback document identity changed."};
 try{
  var chain=layerOpsResolvePath(p.document,params.layerPath,false);if(chain[chain.length-1]!==p.target||p.target.pageItems[0]!==p.sentinel||p.sentinel.uuid!==params.targetUuid)return {status:"indeterminate",message:"Layer rollback native identity changed."};
  var before=parseJsonValue(p.before.evidence),row=null;for(var j=0;j<3;j++)if(mutationSameSequence(before.layers[j].path,params.layerPath))row=before.layers[j];
  var written=state.operationState.written;for(var i=written.length-1;i>=0;i--)batchLayerWrite(p.target,written[i],row[written[i]]);
  var restored=batchLayerSnapshot(p.document,params.targetUuid);state.operationState.rollbackEvidence.restoredSnapshot=restored;
  return batchLayerSame(restored,p.before)?{status:"verified"}:{status:"indeterminate",message:"Layer rollback full prefix is not restored; stop before earlier inverse."};
 }catch(error){return {status:"indeterminate",message:mutationPublicMessage(error,"Layer inverse or verification is indeterminate.")};}
}
`;
const batchLayerUuidSchema = z.string().min(1).max(255);
const batchPublicLayerStatePlan = z.strictObject({
    operation: z.literal(SET_LAYER_STATE_OPERATION), target_uuid: batchLayerUuidSchema, layer_path: batchLayerPathSchema, after: batchLayerAfterSchema,
});
const batchInternalLayerStatePlan = z.strictObject({
    targetUuid: batchLayerUuidSchema, operation: z.literal(SET_LAYER_STATE_OPERATION), layerPath: batchLayerPathSchema, after: batchLayerAfterSchema,
});
export const setLayerStateBatchStep = defineBatchStep({
    operation: SET_LAYER_STATE_OPERATION,
    admittedProfile: 'mixed_batch_layer_state_two_measured_paths',
    recipeAllowed: false,
    publicPlan: batchPublicLayerStatePlan,
    publicApply: z.strictObject({ ...batchPublicLayerStatePlan.shape, expected_before: batchLayerSnapshotSchema, confirmed_after: batchLayerSnapshotSchema }),
    internalPlan: batchInternalLayerStatePlan,
    internalApply: z.strictObject({ ...batchInternalLayerStatePlan.shape, expectedBefore: batchLayerSnapshotSchema, confirmedAfter: batchLayerSnapshotSchema }),
    planSchema: batchLayerPlanSchema,
    snapshotSchema: batchLayerSnapshotSchema,
    normalize: (step) => ({ operation: SET_LAYER_STATE_OPERATION, targetUuid: step.target_uuid,
        layerPath: step.layer_path, after: step.after,
        ...('expected_before' in step ? { expectedBefore: step.expected_before, confirmedAfter: step.confirmed_after } : {}) }),
    request: (plan) => ({ layerPath: plan.layerPath, after: plan.requested }),
    same,
    binding: (plan) => ({ targetUuid: plan.before.uuid, documentKey: null, confirmationStatus: null }),
    planBlockers: (mutationAllowed, plan) => batchLayerBlockers(mutationAllowed, plan.before),
    nextCall: SET_LAYER_STATE_BATCH_NEXT_CALL,
    host: {
        fragments: [{ id: 'batch-layer-state', source: BATCH_LAYER_STATE_SCRIPT }],
        hooks: { resolve: 'batchLayerResolve', plan: 'batchLayerPlan', same: 'batchLayerSame', apply: 'batchLayerApply', verify: 'batchLayerVerify',
            rollback: 'batchLayerRollback' },
        paramFields: ['layerPath', 'after'],
        dispatchLayout: `  set_layer_state: { resolve: batchLayerResolve, plan: batchLayerPlan, same: batchLayerSame, apply: batchLayerApply, verify: batchLayerVerify, rollback: batchLayerRollback }`,
    },
});
