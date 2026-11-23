import { z } from 'zod';
import { documentContextSchema } from './mutation-result-schema-core.js';
import { DATASET_HOST_HELPERS, DATASET_MAX_BOUND, DATASET_MAX_DATASETS, DATASET_MAX_VARIABLES, VARIABLE_KINDS, } from './variables-host-script.js';
import { OBJECT_WALK_HELPERS, OBJECT_WITNESS_HELPERS, READ_PAGE_ITEM_AT_HELPER } from './page-item-walk.js';
const bindingSchema = z.strictObject({
    uuid: z.string().min(1).max(256),
    type: z.string().min(1).max(64),
    name: z.string().max(1024),
    layer: z.string().max(1024),
    property: z.enum(['content_variable', 'visibility_variable']),
    rank: z.number().int().nonnegative().max(DATASET_MAX_BOUND),
    confirmed: z.boolean().describe('The item property really names this variable (read back from the item).'),
});
const variableSchema = z.strictObject({
    index: z.number().int().nonnegative().max(DATASET_MAX_VARIABLES - 1),
    name: z.string().max(1024),
    kind: z.enum(VARIABLE_KINDS),
    bindings: z.array(bindingSchema).max(DATASET_MAX_BOUND),
    bindingsComplete: z.boolean().describe('Every bound item was read and confirmed; false lists why in unavailableReason.'),
    unavailableReason: z.string().max(200).optional(),
});
const currentDatasetSchema = z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('readable'), name: z.string().max(1024) }).describe('Document.activeDataSet: the dataset the last display() showed. It does not follow a hand edit of the bound items.'),
    z.strictObject({ status: z.literal('none') }),
    z.strictObject({ status: z.literal('unavailable') }),
]);
export const variableListSchema = z.strictObject({
    document: documentContextSchema,
    variablesLocked: z.boolean(),
    variables: z.array(variableSchema).max(DATASET_MAX_VARIABLES),
    datasets: z.array(z.strictObject({ index: z.number().int().nonnegative().max(DATASET_MAX_DATASETS - 1), name: z.string().max(1024) })).max(DATASET_MAX_DATASETS),
    currentDataset: currentDatasetSchema,
    scan: z.strictObject({ complete: z.boolean(), boundItems: z.number().int().nonnegative().max(DATASET_MAX_BOUND) }),
}).superRefine((list, context) => {
    list.variables.forEach((variable, index) => {
        if (variable.index !== index)
            context.addIssue({ code: 'custom', message: 'Variable indices must be contiguous and zero-based.', path: ['variables', index, 'index'] });
        variable.bindings.forEach((binding, rank) => {
            if (binding.rank !== rank)
                context.addIssue({ code: 'custom', message: 'Binding ranks must follow the order of the variable\'s pageItems.', path: ['variables', index, 'bindings', rank, 'rank'] });
        });
    });
    list.datasets.forEach((dataset, index) => {
        if (dataset.index !== index)
            context.addIssue({ code: 'custom', message: 'Dataset indices must be contiguous and zero-based.', path: ['datasets', index, 'index'] });
    });
    if (list.scan.boundItems !== list.variables.reduce((sum, variable) => sum + variable.bindings.length, 0))
        context.addIssue({ code: 'custom', message: 'scan.boundItems must count every listed binding.', path: ['scan', 'boundItems'] });
});
export const LIST_VARIABLES_SCRIPT = `${READ_PAGE_ITEM_AT_HELPER}${OBJECT_WITNESS_HELPERS}${OBJECT_WALK_HELPERS}${DATASET_HOST_HELPERS}
var context = requireDocumentForRead(params.expectedDocumentKey);
var doc = app.activeDocument;
var snapshot = dvSnapshot(doc, false);
var listed = [], datasets = [], vi, ri, variable, row, bindings, reasons, reason, di;
for (vi = 0; vi < snapshot.variables.length; vi++) {
  variable = snapshot.variables[vi]; bindings = []; reasons = [];
  for (ri = 0; ri < variable.rows.length; ri++) {
    row = variable.rows[ri];
    bindings.push({ uuid: row.uuid, type: row.type, name: row.name, layer: row.layer, property: row.property === "visibility" ? "visibility_variable" : "content_variable", rank: row.rank, confirmed: row.confirmed });
    for (di = 0; di < row.reasons.length; di++) if (row.reasons[di] === "binding_unconfirmed" || row.reasons[di] === "unsupported_bound_type") dvAddReason(reasons, row.reasons[di]);
  }
  reason = null;
  if (variable.rows.length < variable.bound) reasons.push("scan_limit_exceeded");
  if (variable.kind === "unknown") reasons.push("unknown_variable_kind");
  if (reasons.length > 0) reason = reasons.join(",");
  variable = { index: variable.index, name: variable.name, kind: variable.kind, bindings: bindings, bindingsComplete: reasons.length === 0 };
  if (reason !== null) variable.unavailableReason = reason;
  listed.push(variable);
}
for (di = 0; di < snapshot.datasets.length; di++) datasets.push({ index: di, name: snapshot.datasets[di] });
var result = {
  document: context, variablesLocked: snapshot.locked, variables: listed, datasets: datasets,
  currentDataset: snapshot.displayed === undefined ? { status: "unavailable" } : (snapshot.displayed.status === "readable" ? { status: "readable", name: snapshot.displayed.name } : { status: snapshot.displayed.status }),
  scan: { complete: snapshot.scanComplete, boundItems: snapshot.boundCount }
};
`;
