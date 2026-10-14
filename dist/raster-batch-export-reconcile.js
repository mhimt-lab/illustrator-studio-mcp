import { closeRasterWorkCopy } from './raster-export.js';
import { matchingDocumentPaths } from './file-path-identity.js';
import { lstat, readdir } from 'node:fs/promises';
import { canonicalCommandIdSchema } from './command-id.js';
import { EXPORT_INVENTORY_SCRIPT, parseExportHostError, } from './document-export.js';
import { serializeFileIdentity } from './document-backup.js';
import { classifyPublication, deserializeIdentity, RasterBatchRecordStore, rollbackPublished, } from './raster-batch-export.js';
import { assessRasterRecordSet, RASTER_BATCH_EXPORT_KIND, RASTER_EXPORT_RECORD_VERSION, } from './raster-export-records.js';
import { fileIdentityOf, moveRasterExportToQuarantine, presence, pathTaken, rasterQuarantinePaths, RasterQuarantineRefusal, rasterWindow, readRasterQuarantineManifest, recordSetFingerprint, removeEmptyDirectory, retainedEntry, unlinkStagedName, w0Residue, } from './raster-export.js';
export class RasterBatchExportReconciler {
    deps;
    records;
    constructor(deps) {
        this.deps = deps;
        this.records = new RasterBatchRecordStore(deps.exportStore);
    }
    get store() { return this.deps.exportStore; }
    now() { return (this.deps.now ?? (() => new Date()))().toISOString(); }
    async reconcile(input) {
        const exportId = canonicalCommandIdSchema.parse(input.exportId);
        const leasePresent = await pathTaken(this.store.rasterRecordPath(exportId, 'session'));
        const moved = await readRasterQuarantineManifest(this.store.stateRootPath, exportId);
        const set = await this.records.readRasterRecordSet(exportId);
        const state = assessRasterRecordSet(set);
        if (leasePresent && (state.state === 'invalid' || moved.state !== 'missing')) {
            return await this.moveToQuarantine(input, exportId, set, state.state === 'invalid' ? state.reason : 'quarantine move in progress');
        }
        if (moved.state === 'valid') {
            return { status: 'moved_to_quarantine', exportId, manifestPath: rasterQuarantinePaths(this.store.stateRootPath, exportId).manifest, entries: moved.manifest.entries.map((entry) => entry.name) };
        }
        if (moved.state === 'invalid')
            return { status: 'invalid', exportId, reason: `quarantine manifest: ${moved.reason}` };
        if (state.state === 'none')
            return { status: 'no_records', exportId };
        if (state.state === 'invalid')
            return { status: 'invalid', exportId, reason: state.reason };
        if (state.state === 'published' || state.state === 'failed' || (state.state === 'prepared' && state.abandoned) ||
            (state.state === 'quarantined' && state.released))
            return { status: 'closed', exportId };
        const prepare = set.prepare.state === 'v2' ? set.prepare.record : null;
        if (prepare === null)
            return { status: 'invalid', exportId, reason: 'records without prepare' };
        const stageFiles = await readdir(prepare.stagingDirectory).then((names) => names.length > 0, () => false);
        const window = rasterWindow(set, stageFiles);
        const common = { version: RASTER_EXPORT_RECORD_VERSION, kind: RASTER_BATCH_EXPORT_KIND, exportId, planDigest: prepare.planDigest };
        const sessionPaths = this.sessionPaths(prepare);
        const fingerprint = recordSetFingerprint(set);
        const unresolved = (reason, documents = null, residue = [], message = null) => ({
            status: 'unresolved', exportId, window, action: input.action, reason, documents,
            residue: residue.map(({ path, present, owned, reason: why }) => ({ path, present, owned, reason: why })), message,
        });
        const unchanged = async () => recordSetFingerprint(await this.records.readRasterRecordSet(exportId)) === fingerprint;
        if (window === 'Q') {
            const residue = await presence([prepare.workCopyPath, prepare.stagingDirectory, ...prepare.items.map((item) => item.stagedPath), ...prepare.items.map((item) => item.outputPath)]);
            const guidance = `Export ${exportId} is quarantined. Check the output folder (${prepare.items.length} planned file(s)) and the retained files, then run release_quarantined with confirm_export_id equal to the export id.`;
            if (input.action !== 'release_quarantined')
                return unresolved('quarantined', null, residue, guidance);
            if (input.confirmExportId !== exportId)
                return unresolved('confirm_export_id_mismatch', null, residue, guidance);
            let released = false;
            let refusal = null;
            const documents = await this.inventory(sessionPaths, async (count) => {
                if (count !== 0) {
                    refusal = 'session_document_open';
                    return;
                }
                if (!await unchanged()) {
                    refusal = 'state_changed';
                    return;
                }
                if (set.cleanup.state !== 'v2') {
                    const entries = await Promise.all([prepare.workCopyPath, prepare.stagingDirectory, ...prepare.items.map((item) => item.outputPath)]
                        .map(async (path) => await retainedEntry(path, 'retained: quarantined evidence')));
                    await this.records.write('cleanup', { ...common, recordType: 'cleanup', recordedAt: this.now(), disposition: 'quarantine_released', entries });
                }
                await this.records.release(exportId);
                released = true;
            });
            return released ? { status: 'released', exportId, window, action: input.action, disposition: 'quarantine_released' } : unresolved(refusal, documents, residue, guidance);
        }
        if (window === 'W0') {
            const residue = await w0Residue(prepare);
            if (input.action !== 'abandon')
                return unresolved('prepared_before_open', null, residue);
            let entries = null;
            let refusal = null;
            await this.inventory(sessionPaths, async (count) => {
                if (count !== 0) {
                    refusal = 'session_document_open';
                    return;
                }
                if (!await unchanged()) {
                    refusal = 'state_changed';
                    return;
                }
                const removed = [];
                for (const check of await w0Residue(prepare)) {
                    const done = check.remove ? await check.remove() : false;
                    removed.push({ path: check.path, removed: done, reason: done ? 'owned' : `retained: ${check.reason}` });
                }
                await this.records.write('cleanup', { ...common, recordType: 'cleanup', recordedAt: this.now(), disposition: 'abandoned_before_open', entries: removed });
                entries = removed;
            });
            return entries === null ? unresolved(refusal ?? 'not_cleaned', null, residue) : { status: 'residue_cleaned', exportId, entries };
        }
        if (input.action === 'close_work_copy') {
            const expected = window === 'W2' && set.host_open.state === 'v2'
                ? { identity: set.host_open.record.workCopy, artboards: set.host_open.record.artboards }
                : window === 'W4' && set.artifact_binding.state === 'v2'
                    ? { identity: set.artifact_binding.record.copyAfterExport.identity, artboards: set.artifact_binding.record.copyAfterExport.artboards }
                    : null;
            if (expected === null) {
                const reason = window === 'W3' ? 'dirty_copy_without_export_evidence' : window === 'W1' ? 'copy_open_without_evidence' : 'nothing_to_close';
                return unresolved(reason, null, [], window === 'W1' || window === 'W3'
                    ? 'This copy cannot be closed automatically; close it in Illustrator without saving, then run abandon.' : null);
            }
            try {
                const closed = await closeRasterWorkCopy(this.deps.bridge, sessionPaths, { path: expected.identity.path, key: expected.identity.key, saved: expected.identity.saved, fileRevision: expected.identity.fileRevision,
                    artboards: expected.artboards.map((board) => ({ rect: board.rect })) }, { records: this.records, exportId, fingerprint });
                return unresolved(closed.remaining === 0 ? 'work_copy_closed' : 'work_copy_still_open', closed.remaining);
            }
            catch (error) {
                const detail = parseExportHostError(error);
                if (detail?.code === 'RASTER_RECONCILE_CLOSE_REFUSED' || detail?.code === 'RASTER_RECONCILE_NOT_UNIQUE')
                    return unresolved(`close_refused:${detail.code}`);
                throw error;
            }
        }
        let released = null;
        let refusal = null;
        const documents = await this.inventory(sessionPaths, async (count) => {
            if (input.action === 'inspect')
                return;
            if (count !== 0) {
                refusal = 'session_document_open';
                return;
            }
            if (!await unchanged()) {
                refusal = 'state_changed';
                return;
            }
            const outcome = await this.resolveWindow(window, input.action, set, prepare, common);
            if (outcome === null)
                refusal = `action_not_allowed_in_${window}`;
            else if (outcome === 'quarantined')
                refusal = 'quarantined';
            else
                released = { status: 'released', exportId, window, action: input.action, disposition: outcome };
        });
        return released ?? unresolved(refusal, documents);
    }
    sessionPaths(prepare) {
        return [prepare.workCopyPath, ...prepare.items.map((item) => item.stagedPath), ...prepare.items.map((item) => item.outputPath)];
    }
    async inventory(sessionPaths, underLock) {
        const result = await this.deps.bridge.execute({
            kind: 'read', script: EXPORT_INVENTORY_SCRIPT, params: { sessionPaths },
            hostGate: { afterHost: async ({ data }) => {
                    const inventory = data;
                    await underLock((await matchingDocumentPaths(inventory, sessionPaths)).length, inventory.documentCount);
                } },
        });
        return (await matchingDocumentPaths(result.data, sessionPaths)).length;
    }
    async quarantineCandidateState(exportId) {
        const leasePresent = await pathTaken(this.store.rasterRecordPath(exportId, 'session'));
        const manifest = await readRasterQuarantineManifest(this.store.stateRootPath, exportId);
        const set = await this.records.readRasterRecordSet(exportId);
        if (!leasePresent)
            return null;
        const state = assessRasterRecordSet(set);
        if (state.state !== 'invalid' && manifest.state === 'missing')
            return null;
        return JSON.stringify([recordSetFingerprint(set), manifest.state, manifest.state === 'valid' ? manifest.manifest.entries.length : null]);
    }
    async moveToQuarantine(input, exportId, set, why) {
        const prepare = set.prepare.state === 'v2' ? set.prepare.record : null;
        const sessionPaths = prepare === null ? [] : this.sessionPaths(prepare);
        const guidance = `The records of export ${exportId} are not a legal state (${why}). Check the export folder and the files, then run release_quarantined with confirm_export_id equal to the export id; the records are moved unread into quarantine/exports/ and the lease last.`;
        const unresolved = (reason, documents = null) => ({ status: 'unresolved', exportId, window: 'I', action: input.action, reason, documents, residue: [], message: guidance });
        if (input.action !== 'release_quarantined')
            return unresolved(`invalid_records: ${why}`);
        if (input.confirmExportId !== exportId)
            return unresolved('confirm_export_id_mismatch');
        const observedState = await this.quarantineCandidateState(exportId);
        let refusal = null;
        let moved = false;
        const documents = await this.inventory(sessionPaths, async (count, documentCount) => {
            if (prepare !== null ? count !== 0 : documentCount !== 0) {
                refusal = prepare !== null ? 'session_document_open' : 'documents_open_without_prepare';
                return;
            }
            const now = await this.quarantineCandidateState(exportId);
            if (now === null || now !== observedState) {
                refusal = 'state_changed';
                return;
            }
            try {
                await moveRasterExportToQuarantine(this.store.stateRootPath, this.store.recordDirectory, exportId, this.now());
                moved = true;
            }
            catch (error) {
                if (!(error instanceof RasterQuarantineRefusal))
                    throw error;
                refusal = `quarantine_refused: ${error.message}`;
            }
        });
        return moved ? { status: 'released', exportId, window: 'I', action: input.action, disposition: 'moved_to_quarantine' } : unresolved(refusal ?? 'not_moved', documents);
    }
    async resolveWindow(window, action, set, prepare, common) {
        const exportId = common.exportId;
        const retainAll = async () => await Promise.all([prepare.workCopyPath, prepare.stagingDirectory].map(async (path) => await retainedEntry(path, 'retained: reconcile keeps evidence')));
        const fail = async (reason, message, itemIndex = null, rolledBack = []) => {
            const evidenceDigests = {};
            for (const [type, read] of Object.entries(set))
                if (read.state === 'v2')
                    evidenceDigests[type] = read.digest;
            await this.records.write('failed', { ...common, recordType: 'failed', recordedAt: this.now(), stage: `reconcile_${window}`, reason, message, itemIndex, rolledBack, evidenceDigests });
            await this.records.write('cleanup', { ...common, recordType: 'cleanup', recordedAt: this.now(), disposition: 'failed', entries: await retainAll() });
            await this.records.release(exportId);
            return 'failed';
        };
        const quarantine = async (reason) => {
            await this.records.write('quarantine', { ...common, recordType: 'quarantine', recordedAt: this.now(), reason });
            return 'quarantined';
        };
        switch (window) {
            case 'W8':
                if (action !== 'finalize')
                    return null;
                await this.records.release(exportId);
                return 'released_after_cleanup';
            case 'F':
                if (action !== 'finalize' && action !== 'abandon')
                    return null;
                await this.records.write('cleanup', { ...common, recordType: 'cleanup', recordedAt: this.now(), disposition: 'failed', entries: await retainAll() });
                await this.records.release(exportId);
                return 'failed';
            case 'W7': {
                if (action !== 'finalize' || set.published.state !== 'v2' || set.artifact_binding.state !== 'v2')
                    return null;
                const stagedOf = new Map(set.artifact_binding.record.items.map((item) => [item.artboardIndex, item.stagedPath]));
                const entries = [];
                for (const item of set.published.record.items) {
                    const staged = stagedOf.get(item.artboardIndex);
                    if (staged === undefined)
                        return null;
                    entries.push(await unlinkStagedName(staged, deserializeIdentity(item.outputIdentity), null)
                        ? { path: staged, removed: true, reason: 'owned' }
                        : await retainedEntry(staged, 'retained: not the second link of the output'));
                }
                entries.push(await removeEmptyDirectory(prepare.stagingDirectory, prepare.outputParent)
                    ? { path: prepare.stagingDirectory, removed: true, reason: 'owned' }
                    : await retainedEntry(prepare.stagingDirectory, 'retained: not empty'));
                entries.push(await retainedEntry(prepare.workCopyPath, 'retained: reconcile keeps the work copy'));
                await this.records.write('cleanup', { ...common, recordType: 'cleanup', recordedAt: this.now(), disposition: 'published', entries });
                await this.records.release(exportId);
                return 'published';
            }
            case 'W5':
            case 'W6': {
                if (set.host_terminal.state !== 'v2' || set.session.state !== 'v2')
                    return null;
                if (set.artifact_binding.state !== 'v2') {
                    return action === 'abandon' ? await fail('not_published', 'The export stopped after the copy was closed without a verified file; nothing was published.') : null;
                }
                const binding = set.artifact_binding.record;
                const bound = binding.items.map((item) => ({
                    artboardIndex: item.artboardIndex, stagedPath: item.stagedPath, stagedIdentity: item.stagedIdentity, sha256: item.sha256,
                    outputPath: prepare.items.find((planned) => planned.artboardIndex === item.artboardIndex)?.outputPath ?? '',
                }));
                if (bound.some((item) => item.outputPath === ''))
                    return await quarantine('a bound artifact has no planned output');
                const states = [];
                for (const item of bound)
                    states.push(await classifyPublication(item, true));
                if (states.includes('other'))
                    return await quarantine('the staged and output files match no publication case');
                const linked = states.filter((value) => value === 'L').length;
                const conflicts = bound.filter((_, position) => states[position] === 'X');
                const firstConflict = conflicts[0]?.artboardIndex ?? null;
                if (linked === bound.length) {
                    if (action !== 'finalize')
                        return null;
                    await this.records.write('published', {
                        ...common, recordType: 'published', recordedAt: this.now(), bindingDigest: set.artifact_binding.digest, hostTerminalDigest: set.host_terminal.digest,
                        items: await Promise.all(bound.map(async (item) => {
                            const planned = binding.items.find((candidate) => candidate.artboardIndex === item.artboardIndex);
                            return {
                                artboardIndex: item.artboardIndex,
                                artifact: { path: item.outputPath, mediaType: planned.mediaType, bytes: planned.bytes, sha256: planned.sha256, width: planned.width, height: planned.height },
                                outputIdentity: serializeFileIdentity(fileIdentityOf(await lstat(item.outputPath, { bigint: true }))),
                            };
                        })),
                        sourcePath: prepare.sourcePath, options: set.session.record.options,
                    });
                    return await this.resolveWindow('W7', 'finalize', await this.records.readRasterRecordSet(exportId), prepare, common);
                }
                if (linked === 0) {
                    if (conflicts.length === 0)
                        return action === 'abandon' ? await fail('not_published', 'The export stopped after the copy was closed and before publication; nothing was published.') : null;
                    return action === 'abandon' || action === 'finalize'
                        ? await fail('output_exists', `Another file appeared at the output of artboard ${firstConflict} before publication; it was not touched.`, firstConflict)
                        : null;
                }
                if (action !== 'abandon')
                    return null;
                const { removed, unproven } = await rollbackPublished(bound);
                if (unproven.length > 0)
                    return await quarantine(`the rollback of a partial publication could not prove artboard(s) ${unproven.join(', ')} to be this export's files`);
                return await fail(conflicts.length > 0 ? 'output_exists' : 'partial_publication_rolled_back', `The publication stopped after ${removed.length} of ${bound.length} file(s); they were removed and nothing remains published.`, firstConflict, removed.map((artboardIndex) => ({ artboardIndex, outputPath: bound.find((item) => item.artboardIndex === artboardIndex).outputPath })));
            }
            case 'W1':
            case 'W2':
            case 'W3':
            case 'W4':
                if (action !== 'abandon')
                    return null;
                return await fail(window === 'W1' ? 'open_not_completed' : window === 'W4' ? 'not_published' : 'unbound_artifact_or_not_exported', `The export stopped in ${window}; no file was published and the retained residue is kept as evidence.`);
            default:
                return null;
        }
    }
}
