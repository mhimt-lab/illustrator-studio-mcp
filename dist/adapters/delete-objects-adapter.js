import { createHash } from 'node:crypto';
import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { DELETE_TARGET_LIST_MAX, DELETE_TARGET_LOOKUP_SCRIPT, DeleteBackupError, deleteBackupFactsSchema, verifyDeleteBackup, } from '../delete-shared.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, layerPathSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
import { SUPPORTED_PATH_ITEM_HOST_SCRIPT } from './supported-path-item-host-script.js';
export const DELETE_OBJECTS_OPERATION = 'delete_objects';
export const DELETE_OBJECTS_VALIDATOR = { kind: DELETE_OBJECTS_OPERATION, version: 1 };
export const DELETE_MEASURED_MAX_TARGETS = 1;
export const DELETE_MAX_REMOVED_ITEMS = 64;
export const DELETE_MAX_PARENT_ITEMS = 128;
export const DELETE_MAX_DEPTH = 32;
export const DELETE_NAME_MAX = 1024;
export const DELETE_MEASURED_APP_VERSION = '30.8.1';
export const DELETE_TARGET_TYPES = ['PathItem', 'TextFrame', 'GroupItem'];
export const DELETE_TARGET_SET_HASH_VERSION = 1;
const CANONICAL_VERSION = 1;
const RESULT_SCHEMA_VERSION = 1;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
const uuidSchema = z.string().min(1).max(255);
const documentKeySchema = z.string().min(1).max(16_384);
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const backupIdSchema = z.uuid();
export { DELETE_TARGET_LIST_MAX, DELETE_TARGET_LOOKUP_SCRIPT, DeleteBackupError, deleteBackupFactsSchema, verifyDeleteBackup };
const targetUuidsSchema = z.array(uuidSchema).min(1).max(DELETE_TARGET_LIST_MAX).superRefine((list, context) => {
    if (new Set(list).size !== list.length)
        context.addIssue({ code: 'custom', message: 'duplicate_target: target_uuids must not repeat a UUID.' });
});
const nameSchema = z.string().max(DELETE_NAME_MAX);
const itemTypeSchema = z.enum(DELETE_TARGET_TYPES);
export function jsxStringify(value) {
    if (value === null || value === undefined)
        return 'null';
    if (typeof value === 'number' || typeof value === 'boolean')
        return String(value);
    if (typeof value === 'string') {
        let escaped = '';
        for (let index = 0; index < value.length; index++) {
            const code = value.charCodeAt(index);
            if (code === 34)
                escaped += '\\"';
            else if (code === 92)
                escaped += '\\\\';
            else if (code <= 31)
                escaped += `\\u00${code.toString(16).padStart(2, '0')}`;
            else
                escaped += value.charAt(index);
        }
        return `"${escaped}"`;
    }
    if (Array.isArray(value))
        return `[${value.map((item) => jsxStringify(item)).join(',')}]`;
    return `{${Object.entries(value).map(([key, item]) => `${jsxStringify(key)}:${jsxStringify(item)}`).join(',')}}`;
}
export const deleteDescendantSchema = z.strictObject({
    uuid: uuidSchema,
    typename: itemTypeSchema,
    name: nameSchema,
    depth: z.number().int().positive().max(DELETE_MAX_DEPTH),
    locked: z.boolean(),
    hidden: z.boolean(),
});
export const deleteTargetEntrySchema = z.strictObject({
    uuid: uuidSchema,
    typename: itemTypeSchema,
    name: nameSchema,
    layerPath: layerPathSchema,
    parentKind: z.enum(['Layer', 'GroupItem']),
    parentUuid: uuidSchema.nullable(),
    index: z.number().int().nonnegative().max(DELETE_MAX_PARENT_ITEMS),
    siblingsBefore: z.array(uuidSchema).min(1).max(DELETE_MAX_PARENT_ITEMS),
    locked: z.boolean(),
    hidden: z.boolean(),
    descendants: z.array(deleteDescendantSchema).max(DELETE_MAX_REMOVED_ITEMS),
});
export function deleteTargetSetText(entries) {
    return jsxStringify({
        version: DELETE_TARGET_SET_HASH_VERSION,
        targets: entries.map((entry) => ({
            uuid: entry.uuid, typename: entry.typename, name: entry.name, layerPath: entry.layerPath,
            parentKind: entry.parentKind, parentUuid: entry.parentUuid, index: entry.index, siblingsBefore: entry.siblingsBefore,
            locked: entry.locked, hidden: entry.hidden,
            descendants: entry.descendants.map((child) => ({
                uuid: child.uuid, typename: child.typename, name: child.name, depth: child.depth, locked: child.locked, hidden: child.hidden,
            })),
        })),
    });
}
export function deleteTargetSetHash(entries) {
    return createHash('sha256').update(deleteTargetSetText(entries), 'utf8').digest('hex');
}
export function deleteRemovedUuids(entries) {
    return entries.flatMap((entry) => [entry.uuid, ...entry.descendants.map((child) => child.uuid)]);
}
const commonInternal = { expectedDocumentKey: documentKeySchema, targetUuids: targetUuidsSchema, backupId: backupIdSchema, backup: deleteBackupFactsSchema.optional() };
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({
        ...commonInternal, confirmTargetSetHash: sha256Schema, confirmRemovedCount: z.number().int().positive().max(DELETE_MAX_REMOVED_ITEMS),
        apply: z.literal(true), commandId: canonicalCommandIdSchema,
    }),
]).superRefine((request, context) => {
    if (request.backup !== undefined && request.backup.backupId !== request.backupId) {
        context.addIssue({ code: 'custom', message: 'Admitted backup facts must name the requested backup_id.' });
    }
});
const commonPublic = {
    expected_document_key: documentKeySchema,
    target_uuids: targetUuidsSchema.describe(`Native PageItem.uuid of each item to delete (currently exactly ${DELETE_MEASURED_MAX_TARGETS}; more is refused as too_many_targets until the multi-target path is measured).`),
    backup_id: backupIdSchema.describe('backup_id of a verified illustrator_create_backup record of this document\'s current file.'),
};
export const deleteObjectsPublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({
        ...commonPublic,
        confirm_target_set_hash: sha256Schema.describe('plan.targetSetHash, echoed.'),
        confirm_removed_count: z.number().int().positive().max(DELETE_MAX_REMOVED_ITEMS).describe('plan.removedCount (targets plus descendants), echoed.'),
        apply: z.literal(true),
        command_id: applyCommandIdSchema,
    }),
]);
const inputSchema = z.strictObject({
    ...commonPublic,
    confirm_target_set_hash: sha256Schema.optional(),
    confirm_removed_count: z.number().int().positive().max(DELETE_MAX_REMOVED_ITEMS).optional(),
    apply: z.boolean().default(false),
    command_id: applyCommandIdSchema.optional(),
});
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(deleteObjectsPublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = deleteObjectsPublicInputSchema.parse(input);
    const common = { expectedDocumentKey: value.expected_document_key, targetUuids: value.target_uuids, backupId: value.backup_id };
    return value.apply
        ? { ...common, confirmTargetSetHash: value.confirm_target_set_hash, confirmRemovedCount: value.confirm_removed_count, apply: true, commandId: value.command_id }
        : { ...common, apply: false };
}
export const DELETE_BLOCKERS = [
    'document_not_saved', 'backup_mismatch', 'backup_stale', 'host_version_unmeasured', 'too_many_targets',
    'target_not_found', 'unsupported_target_type', 'unsupported_target_position', 'clipping_group', 'group_would_become_empty',
    'overlapping_targets', 'target_locked_or_hidden', 'descendant_locked_or_hidden', 'target_set_too_large', 'parent_too_large',
];
const blockerSchema = z.strictObject({ code: z.enum(DELETE_BLOCKERS), uuid: uuidSchema.nullable(), message: z.string().min(1).max(500) });
const planSchema = z.strictObject({
    operation: z.literal(DELETE_OBJECTS_OPERATION),
    documentKey: documentKeySchema,
    backup: deleteBackupFactsSchema,
    targetUuids: z.array(uuidSchema).min(1).max(DELETE_TARGET_LIST_MAX),
    targets: z.array(deleteTargetEntrySchema).max(DELETE_TARGET_LIST_MAX),
    removedUuids: z.array(uuidSchema).max(DELETE_TARGET_LIST_MAX * (DELETE_MAX_REMOVED_ITEMS + 1)),
    removedCount: z.number().int().nonnegative(),
    pageItemCountBefore: z.number().int().nonnegative(),
    targetSetHash: sha256Schema,
    blockers: z.array(blockerSchema).max(256),
    confirmationStatus: z.enum(['required', 'confirmed']),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    if (!sameList(plan.removedUuids, deleteRemovedUuids(plan.targets)) || plan.removedCount !== plan.removedUuids.length) {
        context.addIssue({ code: 'custom', message: 'Delete plan removedUuids and removedCount must be the targets followed by their descendants.' });
    }
    if (plan.targetSetHash !== deleteTargetSetHash(plan.targets)) {
        context.addIssue({ code: 'custom', message: 'Delete plan targetSetHash must be the hash of the reported target entries.' });
    }
    if (plan.targets.some((entry, index) => plan.targets.findIndex((other) => other.uuid === entry.uuid) !== index) ||
        plan.targets.some((entry) => !plan.targetUuids.includes(entry.uuid))) {
        context.addIssue({ code: 'custom', message: 'Delete plan targets must be distinct requested UUIDs.' });
    }
    if (plan.blockers.length === 0 && plan.targets.length !== plan.targetUuids.length) {
        context.addIssue({ code: 'custom', message: 'A delete plan without blockers must resolve every requested target.' });
    }
    if (plan.applyAllowed !== (plan.confirmationStatus === 'confirmed' && plan.blockers.length === 0)) {
        context.addIssue({ code: 'custom', message: 'Delete applyAllowed must require confirmation and no blockers.' });
    }
});
function sameList(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}
const failureSchema = z.strictObject({ phase: z.enum(['apply', 'verify']), reasonCode: z.enum(['apply_failed', 'verify_mismatch']), message: z.string().min(1).max(500) })
    .superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed'))
        context.addIssue({ code: 'custom', message: 'Delete failure phase and reason code must match.' });
});
const removalEvidence = { removedUuids: z.array(uuidSchema).max(DELETE_TARGET_LIST_MAX) };
const transactionSchema = z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('planned'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('verified'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('apply_failed'), failure: failureSchema, rollback: z.strictObject({ status: z.literal('not_required') }), audit: mutationAuditSchema }),
    z.strictObject({
        state: z.literal('apply_indeterminate'),
        failure: z.strictObject({ phase: z.literal('apply'), reasonCode: z.literal('apply_indeterminate'), message: z.string().min(1).max(500) }),
        rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('delete_outcome_unknown'), message: z.string().min(1).max(500), ...removalEvidence }),
        audit: mutationAuditSchema,
    }),
    z.strictObject({
        state: z.literal('rollback_indeterminate'), failure: failureSchema,
        rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('rollback_indeterminate'), message: z.string().min(1).max(500), ...removalEvidence }),
        audit: mutationAuditSchema,
    }),
]).superRefine((transaction, context) => {
    const prefix = ['preflight:started:', 'preflight:succeeded:', 'plan:started:', 'plan:succeeded:'];
    let expected;
    if (transaction.state === 'planned')
        expected = [...prefix, 'apply:skipped:not_requested', 'verify:skipped:not_requested', 'rollback:skipped:not_requested'];
    else if (transaction.state === 'verified')
        expected = [...prefix, 'apply:started:', 'apply:attempted:', 'apply:succeeded:', 'verify:started:', 'verify:succeeded:', 'rollback:skipped:not_required'];
    else if (transaction.state === 'apply_failed')
        expected = [...prefix, 'apply:started:', 'apply:failed:apply_failed', 'verify:skipped:not_required', 'rollback:skipped:not_required'];
    else if (transaction.state === 'apply_indeterminate')
        expected = [...prefix, 'apply:started:', 'apply:attempted:', 'apply:failed:apply_indeterminate'];
    else {
        expected = [...prefix, 'apply:started:', 'apply:attempted:', 'apply:succeeded:', 'verify:started:', 'verify:failed:verify_mismatch',
            'rollback:started:', 'rollback:failed:rollback_indeterminate'];
        if (transaction.failure.phase !== 'verify')
            context.addIssue({ code: 'custom', message: 'Only a verify mismatch reaches the delete rollback phase.' });
    }
    const actual = transaction.audit.map((event) => `${event.phase}:${event.event}:${'reasonCode' in event ? event.reasonCode : ''}`);
    if (!sameList(actual, expected))
        context.addIssue({ code: 'custom', message: 'Delete audit sequence does not match transaction state.' });
    transaction.audit.forEach((event, index) => { if (event.sequence !== index)
        context.addIssue({ code: 'custom', message: 'Delete audit sequence must be contiguous.' }); });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' && event.phase === transaction.failure.phase &&
            event.reasonCode === transaction.failure.reasonCode && event.message === transaction.failure.message);
        if (matches.length !== 1)
            context.addIssue({ code: 'custom', message: 'Delete failure must match one audit event.' });
    }
});
const parentOrderSchema = z.strictObject({
    parentKind: z.enum(['Layer', 'GroupItem']),
    parentUuid: uuidSchema.nullable(),
    layerPath: layerPathSchema,
    order: z.array(uuidSchema).max(DELETE_MAX_PARENT_ITEMS),
});
const postconditionSchema = z.strictObject({
    absentUuids: z.array(uuidSchema),
    parentOrders: z.array(parentOrderSchema).max(DELETE_TARGET_LIST_MAX),
    pageItemCountBefore: z.number().int().nonnegative(),
    pageItemCountAfter: z.number().int().nonnegative(),
    saved: z.boolean(),
});
export function expectedParentOrders(targets) {
    const removed = new Set(targets.map((entry) => entry.uuid));
    const seen = new Set();
    const orders = [];
    for (const entry of targets) {
        const key = `${entry.parentKind}\u0000${entry.parentUuid ?? ''}\u0000${entry.layerPath.join('.')}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        orders.push({ parentKind: entry.parentKind, parentUuid: entry.parentUuid, layerPath: entry.layerPath, order: entry.siblingsBefore.filter((uuid) => !removed.has(uuid)) });
    }
    return orders;
}
export const deleteObjectsResultSchema = z.union([
    z.strictObject({ operation: z.literal(DELETE_OBJECTS_OPERATION), applied: z.literal(false), document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ operation: z.literal(DELETE_OBJECTS_OPERATION), applied: z.literal(true), document: documentContextSchema, plan: planSchema, postcondition: postconditionSchema, transaction: transactionSchema }),
]).superRefine((result, context) => {
    if (result.transaction.state === 'planned') {
        if (result.plan.confirmationStatus !== 'required')
            context.addIssue({ code: 'custom', message: 'A planned deletion must require confirmation.' });
    }
    else if (result.plan.confirmationStatus !== 'confirmed' || !result.plan.applyAllowed || result.plan.blockers.length !== 0 ||
        result.plan.targets.length === 0 || result.plan.targets.length > DELETE_MEASURED_MAX_TARGETS) {
        context.addIssue({ code: 'custom', message: 'An attempted deletion must derive from an allowed, confirmed plan inside the measured scope.' });
    }
    if (result.applied) {
        const post = result.postcondition;
        if (result.transaction.state !== 'verified' || !sameList(post.absentUuids, result.plan.removedUuids) ||
            post.pageItemCountBefore !== result.plan.pageItemCountBefore ||
            post.pageItemCountAfter !== result.plan.pageItemCountBefore - result.plan.removedCount ||
            canonicalSha256(post.parentOrders) !== canonicalSha256(expectedParentOrders(result.plan.targets))) {
            context.addIssue({ code: 'custom', message: 'A verified deletion must prove every planned UUID absent, the page-item count delta, and each parent order.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified delete transaction must be applied.' });
    }
});
export const deleteObjectsResponseSchema = z.strictObject({
    outcome: deleteObjectsResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
export const DELETE_OBJECTS_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: DELETE_OBJECTS_OPERATION,
    policy: {
        version: 1, class: 'delete', destructive: true,
        evidence: { identity: 'complete_target_set_hash', backup: 'restore_verified_backup_handle', postcondition: 'all_targets_absent' },
        preconditions: { documentBinding: 'explicit_document_key', backupValidation: 'required_before_apply' },
        confirmation: 'exact_target_set_and_backup',
        recovery: { mode: 'restore_verified_backup', verification: 'complete_target_set_restored', partialRecovery: 'indeterminate' },
        terminal: { success: 'verified_absence', failure: 'proven_pre_apply_or_verified_recovery', partialSuccess: 'nonterminal_until_reconciled' },
        replay: { requestBinding: 'canonical_request_digest', retry: 'return_attested_terminal_result', beforeTerminal: 'reconcile_required', reapplyOnRetry: false },
    },
    capabilities: {
        class: 'delete', explicitDocumentBinding: true, bindCompleteTargetSetHash: true, requireRestoreVerifiedBackup: true,
        requireExactConfirmation: true, verifyAllTargetsAbsent: true, recoverPartialDeletion: true, verifyRestoredTargetSet: true,
        reconcileIndeterminate: true, durableTerminalReplay: true, trustedTerminalAttestationResolver: true,
    },
});
export const DELETE_OBJECTS_SAFETY_IDENTITY = canonicalDigest(DELETE_OBJECTS_SAFETY);
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    const satisfied = result.plan.blockers.length === 0;
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'delete', operationId: DELETE_OBJECTS_OPERATION, canonicalRequestDigest: requestDigest,
        evidence: { documentKey: admissionDocumentKey, targetSetHash: result.plan.targetSetHash, backupHandle: result.plan.backup.backupId, backupRestoreVerified: true },
        preconditions: { status: satisfied ? 'satisfied' : 'blocked', completeTargetSetValidated: satisfied },
        confirmation: { kind: 'exact_target_set_and_backup', canonicalRequestDigest: requestDigest, targetSetHash: result.plan.targetSetHash,
            backupHandle: result.plan.backup.backupId, status: result.plan.confirmationStatus },
        applyAllowed: result.plan.applyAllowed,
    });
}
function safetyResult(result, requestDigest, attestation, plan) {
    const state = result.transaction.state;
    if (state !== 'verified' && state !== 'apply_failed')
        throw new Error('An indeterminate deletion cannot be terminal.');
    const common = { policyVersion: 1, operationClass: 'delete', operationId: DELETE_OBJECTS_OPERATION, canonicalRequestDigest: requestDigest, planDigest: plan.planDigest, attestation };
    const evidence = { backupHandle: result.plan.backup.backupId, targetSetHash: result.plan.targetSetHash, restoredTargetSetVerified: false };
    if (state === 'verified' && result.applied) {
        return operationSafetyResultSchema.parse({ ...common, evidence: { ...evidence, absenceVerified: true }, executionEvidence: { outcome: 'completed' },
            resolution: { status: 'succeeded', terminal: true, recovery: 'not_required', proof: { kind: 'verified_postcondition' }, replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    return operationSafetyResultSchema.parse({ ...common, evidence: { ...evidence, absenceVerified: false }, executionEvidence: { outcome: 'proven_pre_apply' },
        resolution: { status: 'failed', terminal: true, recovery: 'not_required', proof: { kind: 'proven_pre_apply', mutationAttempted: false }, replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
}
async function assertSafety(value, requestDigest, attestation, resolver) {
    const result = deleteObjectsResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null)
        throw new Error('Delete terminal result requires attestation.');
    await assertOperationSafetyAdapterConformance({ registration: DELETE_OBJECTS_SAFETY, plan, result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
export const DELETE_OBJECTS_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
${SUPPORTED_PATH_ITEM_HOST_SCRIPT}
${DELETE_TARGET_LOOKUP_SCRIPT}
var DELETE_MEASURED_MAX_TARGETS = ${DELETE_MEASURED_MAX_TARGETS};
var DELETE_TARGET_LIST_MAX = ${DELETE_TARGET_LIST_MAX};
var DELETE_MAX_REMOVED_ITEMS = ${DELETE_MAX_REMOVED_ITEMS};
var DELETE_MAX_PARENT_ITEMS = ${DELETE_MAX_PARENT_ITEMS};
var DELETE_MAX_DEPTH = ${DELETE_MAX_DEPTH};
var DELETE_NAME_MAX = ${DELETE_NAME_MAX};
var DELETE_MEASURED_APP_VERSION = ${JSON.stringify(DELETE_MEASURED_APP_VERSION)};
var DELETE_TARGET_SET_HASH_VERSION = ${DELETE_TARGET_SET_HASH_VERSION};

function deleteContains(list, value) { for (var i = 0; i < list.length; i++) if (list[i] === value) return true; return false; }
function deleteName(item) {
  var name = item.name;
  if (typeof name !== "string") throw mutationError("preflight_failed", "Item name is unavailable.");
  if (name.length > DELETE_NAME_MAX) throw mutationError("preflight_failed", "Item name exceeds " + DELETE_NAME_MAX + " characters and is unsupported.");
  return name;
}
function deleteFlag(item, key) {
  var value = item[key];
  if (typeof value !== "boolean") throw mutationError("preflight_failed", "Item " + key + " state is unavailable.");
  return value;
}
function deleteOrder(container) {
  var uuids = [];
  for (var index = 0; index < container.pageItems.length; index++) uuids.push(String(container.pageItems[index].uuid));
  return uuids;
}
/** The measured item shapes: point text only; a guide path is not a measured target. */
function deleteShapeSupported(item, typename) {
  if (typename === "TextFrame") return String(item.kind) === String(TextType.POINTTEXT);
  if (typename === "PathItem") return item.guides !== true;
  return true;
}

function deleteAnalyze(document, context, forApply) {
  var blockers = [];
  function block(code, uuid, message) { blockers.push({ code: code, uuid: uuid, message: message }); }
  if (!params.targetUuids || !(params.targetUuids instanceof Array) || params.targetUuids.length === 0 || params.targetUuids.length > DELETE_TARGET_LIST_MAX) {
    throw mutationError("preflight_failed", "target_uuids must list 1-" + DELETE_TARGET_LIST_MAX + " UUIDs.");
  }
  if (!params.backup || typeof params.backup.sourcePath !== "string" || typeof params.backup.sourceFileRevision !== "string") {
    throw mutationError("preflight_failed", "The backup was not admitted; call through the MCP server.");
  }
  if (!context.mutationAllowed) block("document_not_saved", null, "Only a clean saved_file document can be deleted from: " + String(context.mutationBlockedReason));
  if (context.path !== params.backup.sourcePath) block("backup_mismatch", null, "Backup " + params.backup.backupId + " was taken from " + params.backup.sourcePath + ", not from " + String(context.path) + ".");
  else if (context.fileRevision !== params.backup.sourceFileRevision) block("backup_stale", null, "The document reports file revision " + String(context.fileRevision) + "; backup " + params.backup.backupId + " recorded " + params.backup.sourceFileRevision + ".");
  if (String(app.version) !== DELETE_MEASURED_APP_VERSION) block("host_version_unmeasured", null, "Deletion is measured on Illustrator " + DELETE_MEASURED_APP_VERSION + " only; this host is " + String(app.version) + ".");
  if (params.targetUuids.length > DELETE_MEASURED_MAX_TARGETS) block("too_many_targets", null, "Deletion is measured for " + DELETE_MEASURED_MAX_TARGETS + " target per call; delete one item at a time.");

  var targets = [];
  var refs = [];
  var parents = [];
  for (var t = 0; t < params.targetUuids.length; t++) {
    var uuid = params.targetUuids[t];
    if (typeof uuid !== "string" || uuid.length === 0) throw mutationError("preflight_failed", "target_uuids must be non-empty strings.");
    for (var d = 0; d < t; d++) if (params.targetUuids[d] === uuid) throw mutationError("preflight_failed", "duplicate_target: " + uuid);
    var resolved = deleteResolveTyped(document, uuid);
    if (resolved === null) {
      var other = deleteOtherTypename(document, uuid);
      if (other === null) block("target_not_found", uuid, "No item with UUID " + uuid + " exists in the bound document.");
      else block("unsupported_target_type", uuid, "The item with UUID " + uuid + " is a " + other + "; only PathItem, point TextFrame, and GroupItem are measured.");
      continue;
    }
    var item = resolved.item;
    var typename = resolved.typename;
    if (!deleteShapeSupported(item, typename)) block("unsupported_target_type", uuid, "The " + typename + " " + uuid + " is not a measured shape (point text and non-guide paths only).");
    // Ancestors: groups only, none clipped, none locked or hidden.
    var parent = item.parent;
    var parentKind = String(parent.typename);
    var node = parent;
    var depth = 0;
    var ancestorUuids = [];
    while (node !== null && node !== undefined && String(node.typename) !== "Layer") {
      if (String(node.typename) !== "GroupItem") { block("unsupported_target_position", uuid, "The item " + uuid + " is inside a " + String(node.typename) + "; only layers and groups are measured parents."); break; }
      ancestorUuids.push(String(node.uuid));
      if (node.clipped === true) block("clipping_group", uuid, "The item " + uuid + " is inside a clipping group.");
      if (deleteFlag(node, "locked") || deleteFlag(node, "hidden")) block("target_locked_or_hidden", uuid, "A group containing " + uuid + " is locked or hidden.");
      depth++;
      if (depth > DELETE_MAX_DEPTH) throw mutationError("preflight_failed", "The item " + uuid + " is nested deeper than " + DELETE_MAX_DEPTH + " groups.");
      node = node.parent;
    }
    if (node === null || node === undefined) throw mutationError("preflight_failed", "The layer of " + uuid + " is unavailable.");
    if (parentKind !== "Layer" && parentKind !== "GroupItem") continue;
    if (parentKind === "GroupItem" && typename !== "PathItem") block("unsupported_target_position", uuid, "Only a PathItem is measured as a target inside a group; " + uuid + " is a " + typename + ".");
    var layerInfo = supportedPathLayerChain(document, item.layer);
    if (layerInfo === null) throw mutationError("preflight_failed", "The layer path of " + uuid + " is unavailable.");
    for (var l = 0; l < layerInfo.chain.length; l++) {
      if (layerInfo.chain[l].visible !== true || layerInfo.chain[l].locked !== false) { block("target_locked_or_hidden", uuid, "The layer of " + uuid + " or one of its parent layers is locked or hidden."); break; }
    }
    var locked = deleteFlag(item, "locked");
    var hidden = deleteFlag(item, "hidden");
    if (locked || hidden || item.editable !== true) block("target_locked_or_hidden", uuid, "The item " + uuid + " is locked, hidden, or not editable.");
    if (parent.pageItems.length > DELETE_MAX_PARENT_ITEMS) { block("parent_too_large", uuid, "The parent of " + uuid + " holds more than " + DELETE_MAX_PARENT_ITEMS + " items."); continue; }
    var siblings = deleteOrder(parent);
    var index = -1;
    for (var s = 0; s < siblings.length; s++) if (siblings[s] === uuid) { index = s; break; }
    if (index < 0) throw mutationError("preflight_failed", "The item " + uuid + " is not among its parent's children.");
    // Descendants of a group target: PathItem, point TextFrame, non-empty unclipped GroupItem only.
    var descendants = [];
    if (typename === "GroupItem") {
      if (item.clipped === true) block("clipping_group", uuid, "The group " + uuid + " is a clipping group.");
      var stack = [{ container: item, depth: 1 }];
      while (stack.length > 0) {
        var frame = stack.shift();
        if (frame.container.pageItems.length === 0) block("unsupported_target_type", uuid, "An empty group inside " + uuid + " is not measured.");
        for (var c = 0; c < frame.container.pageItems.length; c++) {
          var child = frame.container.pageItems[c];
          var childType = String(child.typename);
          var childUuid = String(child.uuid);
          if (childType !== "PathItem" && childType !== "TextFrame" && childType !== "GroupItem") { block("unsupported_target_type", childUuid, "The group " + uuid + " contains a " + childType + "; only PathItem, point TextFrame, and GroupItem descendants are measured."); continue; }
          if (!deleteShapeSupported(child, childType)) block("unsupported_target_type", childUuid, "The group " + uuid + " contains an unmeasured " + childType + " shape.");
          if (childType === "GroupItem" && child.clipped === true) block("clipping_group", childUuid, "The group " + uuid + " contains a clipping group.");
          var childLocked = deleteFlag(child, "locked");
          var childHidden = deleteFlag(child, "hidden");
          if (childLocked || childHidden) block("descendant_locked_or_hidden", childUuid, "The group " + uuid + " contains a locked or hidden item.");
          if (frame.depth > DELETE_MAX_DEPTH) throw mutationError("preflight_failed", "The group " + uuid + " is nested deeper than " + DELETE_MAX_DEPTH + " levels.");
          descendants.push({ uuid: childUuid, typename: childType, name: deleteName(child), depth: frame.depth, locked: childLocked, hidden: childHidden });
          if (descendants.length > DELETE_MAX_REMOVED_ITEMS) throw mutationError("preflight_failed", "The group " + uuid + " holds more than " + DELETE_MAX_REMOVED_ITEMS + " items.");
          if (childType === "GroupItem") stack.push({ container: child, depth: frame.depth + 1 });
        }
      }
    }
    targets.push({ uuid: uuid, typename: typename, name: deleteName(item), layerPath: layerInfo.path, parentKind: parentKind,
      parentUuid: parentKind === "Layer" ? null : String(parent.uuid), index: index, siblingsBefore: siblings,
      locked: locked, hidden: hidden, descendants: descendants });
    refs.push(item);
    parents.push({ ref: parent, ancestors: ancestorUuids });
  }
  // Overlap: a target inside another target's subtree.
  for (var a = 0; a < targets.length; a++) {
    for (var b = 0; b < targets.length; b++) {
      if (a === b) continue;
      if (deleteContains(parents[a].ancestors, targets[b].uuid)) block("overlapping_targets", targets[a].uuid, "The target " + targets[a].uuid + " is inside the target " + targets[b].uuid + ".");
    }
  }
  // A group must keep at least one child (the last child of a group is unmeasured).
  for (var g = 0; g < targets.length; g++) {
    if (targets[g].parentKind !== "GroupItem") continue;
    var removedHere = 0;
    for (var h = 0; h < targets.length; h++) if (parents[h].ref === parents[g].ref) removedHere++;
    if (removedHere >= targets[g].siblingsBefore.length) block("group_would_become_empty", targets[g].uuid, "Deleting " + targets[g].uuid + " would empty its group; removing a group's last child is not measured.");
  }
  var removedUuids = [];
  for (var r = 0; r < targets.length; r++) {
    removedUuids.push(targets[r].uuid);
    for (var q = 0; q < targets[r].descendants.length; q++) removedUuids.push(targets[r].descendants[q].uuid);
  }
  if (removedUuids.length > DELETE_MAX_REMOVED_ITEMS) block("target_set_too_large", null, "Deletion is measured for at most " + DELETE_MAX_REMOVED_ITEMS + " items (targets plus descendants) per call.");
  var hashText = stringifyJson({ version: DELETE_TARGET_SET_HASH_VERSION, targets: targets });
  return { targets: targets, refs: refs, parents: parents, removedUuids: removedUuids, blockers: blockers,
    targetSetHash: documentKeySha256Hex(hashText), hashText: hashText, pageItemCount: document.pageItems.length };
}

function deleteResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  var analysis = deleteAnalyze(document, context, forApply);
  if (forApply) {
    if (analysis.blockers.length > 0) {
      var codes = [];
      for (var i = 0; i < analysis.blockers.length; i++) if (!deleteContains(codes, analysis.blockers[i].code)) codes.push(analysis.blockers[i].code);
      throw new Error("MCP_ERROR:" + stringifyJson({ code: "DELETE_BLOCKED", reasonCodes: codes, message: analysis.blockers[0].message }));
    }
    if (params.confirmTargetSetHash !== analysis.targetSetHash || params.confirmRemovedCount !== analysis.removedUuids.length) {
      throw new Error("MCP_ERROR:" + stringifyJson({ code: "DELETE_CONFIRMATION_MISMATCH", expected: String(params.confirmTargetSetHash) + "/" + String(params.confirmRemovedCount), actual: analysis.targetSetHash + "/" + analysis.removedUuids.length }));
    }
  }
  return { context: context, document: document, analysis: analysis };
}

function deletePlan(preflight) {
  var analysis = preflight.analysis;
  return { operation: "delete_objects", documentKey: preflight.context.key, backup: params.backup, targetUuids: params.targetUuids,
    targets: analysis.targets, removedUuids: analysis.removedUuids, removedCount: analysis.removedUuids.length,
    pageItemCountBefore: analysis.pageItemCount, targetSetHash: analysis.targetSetHash, blockers: analysis.blockers,
    confirmationStatus: params.apply === true ? "confirmed" : "required",
    applyAllowed: params.apply === true && analysis.blockers.length === 0 };
}

function deleteRevalidate(preflight, plan) {
  var current;
  try { current = deleteResolve(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Delete preconditions changed before apply.")); }
  if (current.document !== preflight.document) throw mutationBeforeSideEffectError("The bound document changed before apply.");
  if (current.analysis.hashText !== preflight.analysis.hashText || current.analysis.targetSetHash !== plan.targetSetHash) throw mutationBeforeSideEffectError("The target set changed before apply.");
  if (current.analysis.pageItemCount !== plan.pageItemCountBefore) throw mutationBeforeSideEffectError("The document page-item count changed before apply.");
  for (var i = 0; i < current.analysis.refs.length; i++) {
    if (current.analysis.refs[i] !== preflight.analysis.refs[i]) throw mutationBeforeSideEffectError("A target's native identity changed before apply.");
  }
}

function deleteApply(preflight, plan, state) {
  state.operationState.pageItemCountBefore = plan.pageItemCountBefore;
  var refs = preflight.analysis.refs;
  for (var i = 0; i < refs.length; i++) {
    refs[i].remove();
    state.operationState.removedUuids.push(plan.targets[i].uuid);
  }
  return state.operationState.removedUuids.length;
}

function deleteVerify(preflight, plan, state) {
  var document = preflight.document;
  if (app.documents.length === 0 || app.activeDocument !== document) throw mutationError("verify_mismatch", "The active document changed during delete verification.");
  for (var i = 0; i < plan.removedUuids.length; i++) {
    if (!deleteIsAbsent(document, plan.removedUuids[i])) throw mutationError("verify_mismatch", "UUID " + plan.removedUuids[i] + " is still present after removal.");
  }
  var parentOrders = [];
  var removedTargets = [];
  for (var t = 0; t < plan.targets.length; t++) removedTargets.push(plan.targets[t].uuid);
  for (var p = 0; p < plan.targets.length; p++) {
    var entry = plan.targets[p];
    var seen = false;
    for (var k = 0; k < parentOrders.length; k++) {
      if (parentOrders[k].parentKind === entry.parentKind && parentOrders[k].parentUuid === entry.parentUuid && mutationSameSequence(parentOrders[k].layerPath, entry.layerPath)) seen = true;
    }
    if (seen) continue;
    var expected = [];
    for (var e = 0; e < entry.siblingsBefore.length; e++) if (!deleteContains(removedTargets, entry.siblingsBefore[e])) expected.push(entry.siblingsBefore[e]);
    var actual = deleteOrder(preflight.analysis.parents[p].ref);
    if (!mutationSameSequence(actual, expected)) throw mutationError("verify_mismatch", "The children of the parent of " + entry.uuid + " are not the previous order without the removed targets.");
    parentOrders.push({ parentKind: entry.parentKind, parentUuid: entry.parentUuid, layerPath: entry.layerPath, order: actual });
  }
  var countAfter = document.pageItems.length;
  if (countAfter !== state.operationState.pageItemCountBefore - plan.removedCount) {
    throw mutationError("verify_mismatch", "The document page-item count fell by " + (state.operationState.pageItemCountBefore - countAfter) + ", not " + plan.removedCount + ".");
  }
  return { absentUuids: plan.removedUuids, parentOrders: parentOrders, pageItemCountBefore: state.operationState.pageItemCountBefore,
    pageItemCountAfter: countAfter, saved: document.saved === true };
}

var DELETE_RECOVERY_MESSAGE = "Deleted items are not restored in the same call. The command keeps the Illustrator lock until illustrator_reconcile action=release_unverified releases it; after that, inspect and revert with illustrator_reconcile_delete.";
var deleteExecution = runMutationTransaction({
  apply: params.apply === true,
  initialOperationState: function () { return { removedUuids: [], pageItemCountBefore: null }; },
  preflight: deleteResolve,
  plan: deletePlan,
  revalidate: deleteRevalidate,
  applyMutation: deleteApply,
  verify: deleteVerify,
  // There is no measured in-call inverse: every failure after the attempt boundary stays indeterminate.
  rollback: function () { return { status: "indeterminate", message: DELETE_RECOVERY_MESSAGE }; },
  hasMutationEvidence: function () { return false; },
  applyIndeterminate: function (state) { return { reasonCode: "delete_outcome_unknown", message: "Delete apply outcome is indeterminate. " + DELETE_RECOVERY_MESSAGE, evidence: { removedUuids: state.operationState.removedUuids.slice(0) } }; },
  rollbackEvidence: function (state) { return { removedUuids: state.operationState.removedUuids.slice(0) }; }
});

var deleteDocument = deleteExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === deleteExecution.preflight.document) deleteDocument = getDocumentContext();
var result = { operation: "delete_objects", applied: deleteExecution.transaction.state === "verified", document: deleteDocument, plan: deleteExecution.plan, transaction: deleteExecution.transaction };
if (deleteExecution.transaction.state === "verified") result.postcondition = deleteExecution.value;
`;
export const DELETE_OBJECTS_HOST_SCRIPT_DIGEST = canonicalSha256(DELETE_OBJECTS_SCRIPT);
export const DELETE_OBJECTS_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: DELETE_OBJECTS_OPERATION, validator: DELETE_OBJECTS_VALIDATOR,
    canonicalContractVersion: CANONICAL_VERSION, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: DELETE_OBJECTS_SAFETY_IDENTITY, hostScriptDigest: DELETE_OBJECTS_HOST_SCRIPT_DIGEST,
    mutationHostApplicationMode: 'foreground',
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    const digestRequest = 'commandId' in request ? (({ commandId: _commandId, ...rest }) => rest)(request) : request;
    const digest = canonicalSha256({ operation: DELETE_OBJECTS_OPERATION, validator: DELETE_OBJECTS_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: 'commandId' in request ? request.commandId : null, documentKey: request.expectedDocumentKey, digest };
}
async function admit(input, services) {
    const request = internalInputSchema.parse(input);
    if (services.backupStore === undefined)
        throw new Error('Deletion requires the backup store; call through the MCP server.');
    const backup = await verifyDeleteBackup(services.backupStore, request.backupId);
    return { ...input, backup };
}
async function beforeHost(input, services) {
    const request = internalInputSchema.parse(input);
    if (services.backupStore === undefined || request.backup === undefined)
        throw new Error('Deletion requires an admitted backup.');
    const current = await verifyDeleteBackup(services.backupStore, request.backupId);
    if (canonicalSha256(current) !== canonicalSha256(request.backup)) {
        throw new DeleteBackupError('backup_stale', `Backup ${request.backupId} changed after the request was admitted; plan again.`);
    }
}
export const deleteObjectsToolContract = {
    name: 'illustrator_delete_objects',
    title: 'Plan or Delete Objects',
    description: `Plan or delete page items by native UUID, bound to a document key and a verified backup (illustrator_create_backup of the current file). Measured scope only (Illustrator ${DELETE_MEASURED_APP_VERSION}, foreground, unlocked): exactly ${DELETE_MEASURED_MAX_TARGETS} target per call; a clean saved document whose file still matches the backup; a layer-direct PathItem or point TextFrame, a GroupItem whose descendants are only PathItem, point TextFrame, and GroupItem, or a PathItem inside a group that keeps another child. Refused (nothing is deleted): unsaved or dirty documents, backup mismatch or staleness, PlacedItem, CompoundPathItem, clipping groups, other types, a TextFrame or group inside a group, a group's last child, locked or hidden items, groups, or layers, locked or hidden descendants, overlapping targets, more than ${DELETE_MAX_REMOVED_ITEMS} removed items, and other Illustrator versions. The plan lists every item that disappears (targets and descendants), removedCount, and targetSetHash; apply echoes confirm_target_set_hash and confirm_removed_count, recomputes both in the same host call, and deletes nothing unless they match. Success is verified absence: every removed UUID fails lookup, each parent keeps its other children in order, and the page-item count falls by removedCount. The document is then unsaved; save it with illustrator_save_document and the same backup_id. There is no in-call undo: a timeout or failure after the first removal is indeterminate and keeps the Illustrator lock (illustrator_reconcile cannot abandon it). The lock is released only by illustrator_reconcile with action=release_unverified (command_id and an identical confirm_command_id, once inspect reports canReleaseUnverified); after that release, illustrator_reconcile_delete inspects and, if needed, reopens the unchanged file.`,
    inputSchema,
    publicInputSchema: deleteObjectsPublicInputSchema,
    outputSchema: deleteObjectsResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(DELETE_OBJECTS_SAFETY.policy),
    normalizePublicInput,
};
export function createDeleteObjectsAdapter() {
    return {
        version: 1, operation: DELETE_OBJECTS_OPERATION, validator: DELETE_OBJECTS_VALIDATOR,
        safety: DELETE_OBJECTS_SAFETY, safetyRegistrationIdentity: DELETE_OBJECTS_SAFETY_IDENTITY,
        adapterIdentity: DELETE_OBJECTS_ADAPTER_IDENTITY, tool: deleteObjectsToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: deleteObjectsResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
        safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: DELETE_OBJECTS_HOST_SCRIPT_DIGEST,
        mutationHostApplicationMode: 'foreground',
        admit,
        beforeHost,
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: DELETE_OBJECTS_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: DELETE_OBJECTS_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: DELETE_OBJECTS_OPERATION, documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: DELETE_OBJECTS_ADAPTER_IDENTITY, mutationHostApplicationMode: 'foreground', script: DELETE_OBJECTS_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = deleteObjectsResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed')
                return { state };
            if (state === 'planned')
                throw new Error('A delete plan is not a terminal mutation result.');
            throw new Error('An unverified deletion must remain indeterminate and retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error, detail) {
            if (error instanceof DeleteBackupError)
                return new Error(`Deletion refused before any host call (${error.message}).`);
            if (detail?.code === 'DELETE_BLOCKED')
                return new Error(`Deletion is refused: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}. ${detail.message ?? ''}`.trim());
            if (detail?.code === 'DELETE_CONFIRMATION_MISMATCH')
                return new Error(`confirmation_mismatch: confirm_target_set_hash/confirm_removed_count ${detail.expected ?? ''} do not match the current target set ${detail.actual ?? ''}; plan again. Nothing was deleted.`);
            if (detail?.code === 'DOCUMENT_NOT_SAVED')
                return new Error(`document_not_saved: ${detail.message ?? 'only a clean saved document can be deleted from'}. Nothing was deleted.`);
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
