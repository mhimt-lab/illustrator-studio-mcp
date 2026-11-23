import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, extname, join } from 'node:path';
import { lstat, open } from 'node:fs/promises';
import { IndeterminateExecutionError } from './domain.js';
import { BackupPreconditionError, serializeFileIdentity, withBackupRootScope } from './document-backup.js';
import { EXPORT_OPEN_WORK_COPY_SCRIPT, EXPORT_OUTLINE_SCRIPT, EXPORT_SAVE_OUTPUT_SCRIPT, EXPORT_CLOSE_WORK_COPY_SCRIPT, EXPORT_INVENTORY_SCRIPT, EXPORT_RECONCILE_CLOSE_SCRIPT, EXPORT_HOST_TIMEOUT_MS, OutputVerificationError, ExportPreconditionError, parseExportHostError, EXPORT_SAVE_FAILED_CODE, EXPORT_SAVE_PRE_ATTEMPT_CODES, validateOutputLocation, assertOutputAbsent, createOnceLinkAllowance, createStagingDirectory, workCopyFileName, verifyOutputFile, verifyOutputUnchanged, closeRefusalReason, } from './document-export.js';
import { PDF_EXPORT_SAVE_PRE_ATTEMPT_CODES, PDF_EXPORT_SAVE_SCRIPT, PDF_EXPORT_SAVE_PRESERVE_SCRIPT, planPdfExport, pdfSaveParams, verifyPdfStructure, presetReport, pdfFacts, pdfxReport, preserveEditabilityOptions, registrationScanWarnings, marksNeedRegistrationScan, PDFX_FONT_SCAN_FRAME_LIMIT, pdfxFontRefusal, } from './pdf-export.js';
import { readSecurePrivateRecord } from './private-record.js';
import { noFollowNonBlockingReadFlags } from './platform-primitives.js';
import { matchingDocumentPaths } from './file-path-identity.js';
import { STABLE_ILLUSTRATOR_BUNDLE_ID } from './illustrator-application.js';
import { hostVersionAdmitted } from './host-version-policy.js';
import { admitHostVersionPlan } from './host-version-admission.js';
import { sameFilePath } from './file-path.js';
import { removeOwnedFile, removeEmptyDirectory, unlinkStagedName, linkBoundArtifact } from './raster-export.js';
import { assessReplacementTerminal, requireReplacementTerminal } from './raster-overwrite-terminal.js';
import { captureExpectedOutput, assertExpectedOutput, prepareReplacementFilesystem, detachPreviousOutput, replacementSummary, cleanupPreviousSlot, restorePreviousOutput, replacementStat, syncReplacementDirectory, syncReplacementDirectory as syncDirectory, OutputReplacementError } from './output-replacement.js';
import { WorkCopyOverwriteStore, WORK_COPY_PREVIOUS_LIMIT, workCopyDigest as digest, workCopyCommon, workCopyIntentSchema, WORK_COPY_RECORD_SCHEMAS } from './work-copy-overwrite-records.js';
import { workCopyPlanDigest, workCopyRequestDigest, workCopyTerminalEvidence, workCopyPublicationPayload, workCopyTerminalReceiptDigest } from './work-copy-overwrite-terminal.js';
import { workCopyOverwriteResultSchema, validateWorkCopyOverwriteInput } from './work-copy-overwrite-public.js';
function variant(source, before, after) {
    if (source.split(before).length !== 2)
        throw new Error('The measured export guard is not unique.');
    return source.replace(before, after);
}
export const WORK_COPY_OVERWRITE_OPEN_SCRIPT = variant(EXPORT_OPEN_WORK_COPY_SCRIPT, 'new File(params.outputPath).exists || new File(params.stagedPath).exists', '(params.overwrite !== true && new File(params.outputPath).exists) || new File(params.stagedPath).exists');
export const WORK_COPY_OVERWRITE_OUTLINED_SCRIPT = variant(EXPORT_SAVE_OUTPUT_SCRIPT, 'exportOutputFile.exists || new File(params.outputPath).exists', 'exportOutputFile.exists || (params.overwrite !== true && new File(params.outputPath).exists)');
export const WORK_COPY_OVERWRITE_PDF_SCRIPT = variant(PDF_EXPORT_SAVE_SCRIPT, 'pdfOutputFile.exists || new File(params.outputPath).exists', 'pdfOutputFile.exists || (params.overwrite !== true && new File(params.outputPath).exists)');
export const WORK_COPY_OVERWRITE_PDF_PRESERVE_SCRIPT = variant(PDF_EXPORT_SAVE_PRESERVE_SCRIPT, 'pdfOutputFile.exists || new File(params.outputPath).exists', 'pdfOutputFile.exists || (params.overwrite !== true && new File(params.outputPath).exists)');
const equal = (a, b) => digest(a) === digest(b);
const identity = (i) => ({ dev: BigInt(i.dev), ino: BigInt(i.ino), size: BigInt(i.size), mtimeNs: BigInt(i.mtimeNs), ctimeNs: BigInt(i.ctimeNs) });
function assert(condition, detail) { if (!condition)
    throw new Error(detail); }
const errorMessage = (e) => e instanceof Error ? e.message : String(e);
export class WorkCopyOverwriteOperation {
    deps;
    ws;
    hostMs = 0;
    archiveMs = 0;
    constructor(deps) {
        this.deps = deps;
        this.ws = new WorkCopyOverwriteStore(deps.store);
    }
    rejected(reason, message, document = null, availablePresets = null) {
        return workCopyOverwriteResultSchema.parse({ outcome: 'rejected', reason, message, document, availablePresets });
    }
    async host(command) { return (await this.deps.execute(command)).data; }
    async profile() {
        const target = this.deps.bridge.applicationTarget?.();
        if (target?.channel !== 'stable' || target.bundleId !== STABLE_ILLUSTRATOR_BUNDLE_ID)
            throw new Refusal('host_version_unmeasured', 'Overwrite work-copy export requires the configured stable Illustrator bundle.');
        const p = await (this.deps.profile.observeForEditSession?.() ?? this.deps.profile.observe());
        if (p.lockState === 'locked')
            throw new Refusal('host_screen_locked', 'Unlock the screen and bring Illustrator to the front, then try again.');
        if (p.lockState !== 'unlocked' || p.profile === 'unknown')
            throw new Refusal('host_profile_unknown', 'The host state cannot be verified. Restore the host state and try again.');
        if (p.profile !== 'foreground')
            throw new Refusal('host_not_foreground', 'Bring Illustrator to the front, then try again.');
    }
    async capture(path) {
        try {
            return await captureExpectedOutput(path, WORK_COPY_PREVIOUS_LIMIT);
        }
        catch (e) {
            if (e instanceof OutputReplacementError && e.reason === 'output_previous_too_large')
                throw new Refusal('output_previous_size_unmeasured', `The previous output exceeds the measured 1073741824-byte limit. Use a client-side custom script with a verified independent archive and verified publication.`);
            throw e;
        }
    }
    async set(id) {
        try {
            return await this.ws.set(id);
        }
        catch (e) {
            if (e.code === 'ENOENT')
                return null;
            throw e;
        }
    }
    options(input, source, document, outputPath) {
        if (input.operation === 'outlined') {
            if (input.format === 'pdf' && (input.pdfPreset === undefined || !source.pdfPresets.includes(input.pdfPreset)))
                throw new Refusal('pdf_preset_unknown', 'Choose pdf_preset from Illustrator PDF presets.');
            if (input.format === 'ai' && input.pdfPreset !== undefined)
                throw new Refusal('pdf_preset_unknown', 'pdf_preset applies only to PDF output.');
            return { operation: 'outlined', pdfPreset: input.pdfPreset ?? null };
        }
        const plan = planPdfExport({ ...input, outputPath }, document, source.artboards, source.pdfPresets);
        if ('reason' in plan)
            throw new Refusal(plan.reason, plan.message);
        return { operation: 'pdf', plan };
    }
    async run(input) {
        validateWorkCopyOverwriteInput(input);
        assert(input.overwrite === true, 'This operation requires an explicit overwrite request.');
        if (process.platform === 'win32')
            return this.rejected('overwrite_not_supported_on_platform', 'Overwrite export is not supported on Windows.');
        const started = performance.now();
        try {
            if (input.apply) {
                const prior = await this.set(input.commandId);
                if (prior && Object.values(prior.records).some(r => r.state !== 'absent'))
                    return await this.replay(input, prior);
                await assertExpectedOutput(input.expectedOutput, WORK_COPY_PREVIOUS_LIMIT);
            }
            await this.profile();
            const readStarted = performance.now();
            const read = await this.deps.readSource(input.expectedDocumentKey, !!input.apply, input.operation === 'pdf' && !input.apply && marksNeedRegistrationScan(input.marks) ? 5000 : undefined, input.operation === 'pdf' && input.pdfx !== undefined ? PDFX_FONT_SCAN_FRAME_LIMIT : undefined);
            this.hostMs += performance.now() - readStarted;
            if (read.kind === 'rejected')
                return this.rejected(read.reason, read.message, read.document);
            if (read.kind === 'indeterminate')
                return { outcome: 'indeterminate', stage: 'read_source', message: read.message, commandId: read.commandId, sessionId: null, files: { workCopyPath: null, stagedPath: null, outputPath: null } };
            const { source, document } = read;
            if (!hostVersionAdmitted('work_copy_overwrite', document.appVersion))
                return this.rejected('host_version_unmeasured', 'The host version policy does not admit this Illustrator version for an overwrite work-copy export.', document);
            assert(document.path !== null && document.fileRevision !== null && source.artboards.length > 0, 'The source is not a saved file with artboards.');
            const sourceFile = await this.deps.policy.inspectSourceFile(document.path), sourceFacts = await this.deps.policy.readFileFacts(sourceFile.path);
            if (!this.deps.policy.sameFileIdentity(sourceFile.identity, sourceFacts.identity))
                throw new Refusal('source_file_unavailable', 'The source file changed during planning.');
            const format = input.operation === 'pdf' ? 'pdf' : input.format;
            if (extname(input.outputPath).toLowerCase() !== `.${format}` || basename(input.outputPath) === `.${format}`)
                throw new Refusal('output_path_invalid', `output_path must name a .${format} file.`);
            const output = await validateOutputLocation(input.outputPath, sourceFile.path, this.deps.store.stateRootPath, true);
            const expectedOutput = await this.capture(output.path), options = this.options(input, source, document, output.path);
            if (options.operation === 'pdf' && options.plan.pdfx !== null) {
                assert(source.fontScan, 'The requested PDF/X font scan is missing.');
                const names = source.fontScan.fontNames;
                const fonts = names.length === 0 ? {} : await this.deps.fonts.verify(names, this.deps.bridge.applicationTarget?.()?.bundleId ?? null);
                const refusal = pdfxFontRefusal(source.fontScan, fonts);
                if (refusal)
                    return this.rejected('pdfx_fonts_unverified', refusal, document);
            }
            const id = input.apply ? input.commandId : randomUUID(), stagingDirectory = join(output.parent, `.illustrator-studio-mcp-export-${id}`);
            const fields = { operation: input.operation, format, requestedDocumentKey: input.expectedDocumentKey, options, outputPath: output.path, expectedOutput,
                source: WORK_COPY_RECORD_SCHEMAS.prepare.shape.source.parse({ document, artboards: source.artboards, layers: source.layers, counts: source.counts, path: sourceFile.path, identity: serializeFileIdentity(sourceFile.identity), bytes: sourceFile.bytes, sha256: sourceFacts.sha256 }) };
            const p = WORK_COPY_RECORD_SCHEMAS.prepare.parse({ ...fields, version: 6, kind: 'work_copy_export', exportId: id, recordType: 'prepare', openCommandId: null,
                planDigest: workCopyPlanDigest(fields), requestDigest: workCopyRequestDigest(fields), workCopyPath: join(this.deps.store.recordDirectory, workCopyFileName(id, sourceFile.path)),
                stagingDirectory, stagedPath: join(stagingDirectory, basename(output.path)), outputParent: output.parent, outputParentIdentity: expectedOutput.parentIdentity });
            assert(Buffer.byteLength(JSON.stringify(p, null, 2) + '\n') <= 65536, 'The work-copy export plan exceeds its record size limit.');
            if (!input.apply)
                return this.planned(p, source, performance.now() - started);
            if (input.expectedPlanDigest !== p.planDigest || !equal(input.expectedOutput, p.expectedOutput))
                return this.rejected('plan_stale', 'The source, options or previous output changed; plan again.', document);
            return await this.apply(p, started);
        }
        catch (e) {
            if (e instanceof BackupPreconditionError)
                return this.rejected(e.reason === 'backup_root_unavailable' ? 'export_root_unavailable' : 'source_file_unavailable', e.message);
            if (e instanceof OutputReplacementError && e.reason === 'output_previous_too_large' && input.apply)
                return this.rejected('output_changed_since_plan', 'The previous output changed beyond the planned size; plan again.');
            if (e instanceof Refusal || e instanceof OutputReplacementError || e instanceof ExportPreconditionError)
                return this.rejected(e.reason, e.message);
            throw e;
        }
    }
    planned(p, source, durationMs) {
        const hostVersion = admitHostVersionPlan('work_copy_overwrite', p.source.document.appVersion, 'stable');
        const versionNote = hostVersion === null ? {} : { host_version: hostVersion };
        const confirmation = { overwrite: true, apply: true, command_id: p.exportId, expected_plan_digest: p.planDigest, expected_output: p.expectedOutput, expected_document_key: p.requestedDocumentKey, output_path: p.outputPath };
        if (p.options.operation === 'outlined')
            return workCopyOverwriteResultSchema.parse({ outcome: 'planned', document: p.source.document, ...versionNote,
                plan: { format: p.format, pdfPreset: p.options.pdfPreset, outputPath: p.outputPath, planDigest: p.planDigest, expectedOutput: p.expectedOutput },
                nextCall: { ...confirmation, format: p.format, ...(p.options.pdfPreset === null ? {} : { pdf_preset: p.options.pdfPreset }) }, hostCalls: 1, durationMs });
        const plan = p.options.plan;
        const { planDigest: _legacy, preserveEditability, ...fields } = plan;
        void _legacy;
        return workCopyOverwriteResultSchema.parse({ outcome: 'planned', document: p.source.document, ...versionNote, plan: { ...fields, preset: presetReport(plan.preset), planDigest: p.planDigest, expectedOutput: p.expectedOutput },
            nextCall: { ...confirmation, pdf_preset: plan.preset, artboards: plan.artboardRange,
                marks: { trim: plan.marks.trim, registration: plan.marks.registration, color_bars: plan.marks.colorBars, page_information: plan.marks.pageInformation, style: plan.marks.style },
                bleed: plan.bleedSource === 'document_via_preset' ? { mode: 'document', expected_mm: 3 } : plan.bleed,
                ...(preserveEditability === null ? {} : { preserve_editability: preserveEditability }),
                ...(plan.pdfx === null ? {} : { pdfx: { standard: plan.pdfx.standard, ...(plan.pdfx.outputCondition === null ? {} : { output_condition: { identifier: plan.pdfx.outputCondition.identifier,
                                ...(plan.pdfx.outputCondition.condition === null ? {} : { condition: plan.pdfx.outputCondition.condition }), ...(plan.pdfx.outputCondition.registry === null ? {} : { registry: plan.pdfx.outputCondition.registry }) } }) } }) },
            warnings: registrationScanWarnings(source.registrationScan), registrationScan: source.registrationScan ?? null, hostCalls: 1, durationMs });
    }
    async replay(input, set) {
        const r = set.records;
        if (r.prepare.state !== 'valid')
            return this.rejected('export_records_invalid', 'This command has no valid work-copy prepare record; it is not reapplied.');
        const p = r.prepare.record;
        let options;
        try {
            const bounds = p.source.document.activeArtboardBounds;
            const document = { ...p.source.document, activeArtboardBounds: [bounds[0], bounds[1], bounds[2], bounds[3]] };
            options = this.options(input, { ...p.source, document, pdfPresets: p.options.operation === 'pdf' ? [p.options.plan.preset] : p.options.pdfPreset === null ? [] : [p.options.pdfPreset] }, document, input.outputPath);
        }
        catch {
            return this.rejected('command_id_conflict', 'The command_id belongs to different export arguments.');
        }
        if (p.operation !== input.operation || p.format !== (input.operation === 'pdf' ? 'pdf' : input.format) || p.requestedDocumentKey !== input.expectedDocumentKey ||
            p.outputPath !== input.outputPath || p.planDigest !== input.expectedPlanDigest || !equal(p.expectedOutput, input.expectedOutput) || !equal(options, p.options))
            return this.rejected('command_id_conflict', 'The command_id belongs to different export arguments.');
        const terminal = await assessReplacementTerminal(this.deps.store, set);
        if (terminal.state === 'invalid')
            return this.rejected(terminal.reason, terminal.detail);
        if (terminal.disposition !== null && r.cleanup.state === 'valid' && r.session.state === 'valid') {
            try {
                const released = await this.reconcile({ exportId: p.exportId, action: 'inspect' });
                if (released.status === 'released')
                    return this.result(await this.ws.set(p.exportId), 'replay', 0, 0);
            }
            catch (error) {
                return { outcome: 'indeterminate', stage: 'write_record', message: `S12 release is unresolved: ${errorMessage(error)}`, commandId: null, sessionId: p.exportId,
                    files: { workCopyPath: p.workCopyPath, stagedPath: p.stagedPath, outputPath: p.outputPath } };
            }
        }
        if (terminal.disposition === null || r.cleanup.state !== 'valid' || r.session.state !== 'absent')
            return { outcome: 'indeterminate', stage: 'write_record', message: 'The export is unresolved; use illustrator_reconcile_export. It is not reapplied.', commandId: null, sessionId: p.exportId,
                files: { workCopyPath: p.workCopyPath, stagedPath: p.stagedPath, outputPath: p.outputPath } };
        return this.result(set, 'replay', 0, 0);
    }
    result(set, delivery, hostCalls, durationMs) {
        const r = set.records;
        assert(r.prepare.state === 'valid', 'The prepare is missing.');
        const p = r.prepare.record;
        if (r.failed.state === 'valid')
            return workCopyOverwriteResultSchema.parse({ outcome: 'failed', exportId: p.exportId, delivery, replacement: r.failed.record.replacement,
                stage: r.failed.record.stage, reason: r.failed.record.reason, message: r.failed.record.message, files: { workCopyPath: p.workCopyPath, stagedPath: p.stagedPath, outputPath: null } });
        assert(r.published.state === 'valid' && r.cleanup.state === 'valid', 'The success terminal is incomplete.');
        const published = r.published.record, payload = published.payload, entries = r.cleanup.record.entries;
        const removed = (path) => entries.find(e => e.path === path)?.removed === true;
        assert(r.artifact_binding.state === 'valid', 'The original artifact binding is missing.');
        const observed = r.artifact_binding.record.save;
        const measuredPath = p.operation === 'outlined' && p.format === 'ai' ? p.stagedPath : p.workCopyPath;
        const measuredSaved = !(p.operation === 'outlined' && p.format === 'pdf');
        const copyObservation = { path: observed.pathAfter, key: observed.workCopy.key, saved: observed.workCopy.saved,
            matchesMeasuredProfile: sameFilePath(observed.pathAfter, measuredPath) && observed.workCopy.saved === measuredSaved };
        const extra = { exportId: p.exportId, delivery, replacement: published.replacement, copyObservation, timing: { totalMs: durationMs, hostMs: this.hostMs, archiveMs: this.archiveMs, recordMs: this.ws.metrics.durationMs, recordCount: this.ws.metrics.records, recordFsyncCount: this.ws.metrics.fsyncs } };
        if (payload.operation === 'pdf') {
            const { operation: _op, ...facts } = payload;
            void _op;
            return workCopyOverwriteResultSchema.parse({ ...facts, ...extra, outcome: 'verified', workCopy: { path: p.workCopyPath, removed: removed(p.workCopyPath) }, staging: { directory: p.stagingDirectory, removed: removed(p.stagingDirectory) }, hostCalls, durationMs });
        }
        assert(r.artifact_binding.state === 'valid', 'The original artifact binding is missing.');
        const { operation: _op, ...facts } = payload;
        void _op;
        return workCopyOverwriteResultSchema.parse({ outcome: 'verified', ...extra, retention: 'manual', recordPath: this.deps.store.recordPath(p.exportId), record: { ...facts, version: 6, exportId: p.exportId, documentKey: p.requestedDocumentKey,
                bytes: published.artifact.bytes, sha256: published.artifact.sha256, outputIdentity: published.artifact.identity,
                workCopy: { path: p.workCopyPath, removed: removed(p.workCopyPath) }, staging: { directory: p.stagingDirectory, removed: removed(p.stagingDirectory) }, createdAt: published.recordedAt } });
    }
    async apply(p, started) {
        const { policy, store } = this.deps, id = p.exportId, common = workCopyCommon(p);
        let stage = 'open_session', lastCommand = null, hostCalls = 1;
        const attempts = [];
        const call = async (step, command) => {
            const gate = command.hostGate;
            hostCalls++;
            let dispatchStarted = 0;
            return this.host({ ...command, hostGate: { ...gate, beforeHost: async (context) => {
                        lastCommand = context.commandId;
                        attempts.push({ step, commandId: context.commandId, completedInactive: true });
                        const admission = await gate?.beforeHost?.(context);
                        dispatchStarted = performance.now();
                        return admission;
                    }, afterHost: async (context) => { this.hostMs += performance.now() - dispatchStarted; await gate?.afterHost?.(context); } } });
        };
        const files = { workCopyPath: p.workCopyPath, stagedPath: p.stagedPath, outputPath: p.outputPath };
        const indeterminate = (e) => ({ outcome: 'indeterminate', stage, message: errorMessage(e), commandId: e instanceof IndeterminateExecutionError ? e.commandId : lastCommand, sessionId: id, files });
        let fingerprint = null;
        const refresh = async () => { fingerprint = digest(await this.ws.set(id)); };
        const unchanged = async () => { assert(fingerprint === digest(await this.ws.set(id)), 'The export evidence changed outside this apply.'); };
        await store.ensure();
        const root = await policy.resolveBackupRoot(store.recordDirectory);
        return withBackupRootScope(root, async (rootScope) => policy.withOutputParentScope(p.outputParent, async (parent) => {
            let copy = null;
            let opened, outlined = null, saved = null;
            let verification = null;
            let failure = null;
            let closeTarget = null;
            const sessionPaths = [p.workCopyPath, p.stagedPath, p.outputPath];
            try {
                opened = await call('open', { kind: 'read', script: WORK_COPY_OVERWRITE_OPEN_SCRIPT, timeoutMs: EXPORT_HOST_TIMEOUT_MS,
                    params: { expectedDocumentKey: p.source.document.key, workCopyPath: p.workCopyPath, stagedPath: p.stagedPath, outputPath: p.outputPath, sessionPaths, overwrite: true },
                    hostGate: {
                        beforeHost: async ({ commandId }) => {
                            await this.deps.assertNoLease();
                            await this.profile();
                            await rootScope.assertStable();
                            await parent.assertStable();
                            assert(Object.values((await this.ws.set(id)).records).every(r => r.state === 'absent'), 'The command_id is already in use.');
                            assert(await replacementStat(p.workCopyPath) === null && await replacementStat(p.stagingDirectory) === null, 'The command_id has existing work or staging artifacts.');
                            await assertExpectedOutput(p.expectedOutput, WORK_COPY_PREVIOUS_LIMIT);
                            p.openCommandId = commandId;
                            const prepareDigest = await this.ws.write('prepare', p);
                            copy = await policy.copyFileExclusive(p.source.path, p.workCopyPath, identity(p.source.identity));
                            assert(copy.bytes === p.source.bytes && copy.sha256 === p.source.sha256, 'The source bytes changed before the independent copy.');
                            const location = await createStagingDirectory(p.outputParent, id, p.outputPath);
                            assert(location.stagedPath === p.stagedPath, 'The stage path differs from prepare.');
                            await syncDirectory(location.directory);
                            await parent.sync();
                            await rootScope.assertStable();
                            await parent.assertStable();
                            await policy.verifyTrackedFile(p.workCopyPath, copy.identity, copy.sha256);
                            await assertOutputAbsent(p.stagedPath);
                            const metadata = await lstat(p.stagingDirectory, { bigint: true });
                            await this.ws.openSession({ ...common, recordType: 'session', prepareDigest, openCommandId: commandId, workCopyIdentity: serializeFileIdentity(copy.identity), bytes: copy.bytes,
                                sha256: copy.sha256, stageIdentity: { dev: String(metadata.dev), ino: String(metadata.ino) }, createdAt: new Date().toISOString() });
                            await refresh();
                            stage = 'open_work_copy';
                        },
                        afterHost: async ({ commandId, data }) => {
                            const o = data;
                            assert(o.source.key === p.source.document.key && o.opened.path !== null && sameFilePath(o.opened.path, p.workCopyPath) && o.opened.key !== o.source.key && o.documentCountAfter === o.documentCountBefore + 1, 'The Host open inventory differs from the source/copy binding.');
                            await unchanged();
                            const records = (await this.ws.set(id)).records;
                            assert(records.prepare.state === 'valid' && records.session.state === 'valid', 'The lease/prepare is unreadable.');
                            await this.ws.write('host_open', { ...common, recordType: 'host_open', prepareDigest: records.prepare.digest, sessionDigest: records.session.digest,
                                open: { commandId, completedInactive: true }, workCopy: o.opened, copyFile: { path: p.workCopyPath, identity: records.session.record.workCopyIdentity, bytes: records.session.record.bytes, sha256: records.session.record.sha256 }, stageIdentity: records.session.record.stageIdentity, sourceKey: o.source.key, documentCountBefore: o.documentCountBefore, documentCountAfter: o.documentCountAfter, artboards: p.source.artboards });
                            await refresh();
                        },
                    } });
                closeTarget = { path: p.workCopyPath, key: opened.opened.key };
                if (p.operation === 'outlined') {
                    stage = 'outline';
                    outlined = await call('outline', { kind: 'read', script: EXPORT_OUTLINE_SCRIPT, timeoutMs: EXPORT_HOST_TIMEOUT_MS,
                        params: { workCopyPath: p.workCopyPath, workCopyKey: closeTarget.key }, hostGate: {
                            beforeHost: unchanged,
                            afterHost: async ({ commandId, data }) => {
                                const h = data;
                                assert(h.workCopy.path !== null && sameFilePath(h.workCopy.path, p.workCopyPath), 'The outlined copy path changed.');
                                await unchanged();
                                const read = (await this.ws.set(id)).records.host_open;
                                assert(read.state === 'valid', 'The open evidence is missing.');
                                await this.ws.write('host_prepare', { ...common, recordType: 'host_prepare', hostOpenDigest: read.digest, outlineCall: { commandId, completedInactive: true }, outline: h });
                                await refresh();
                            },
                        } });
                    closeTarget = { path: p.workCopyPath, key: outlined.workCopy.key };
                    if (outlined.textFramesAfter !== 0 || outlined.errors.length !== 0 || outlined.restoreErrors.length !== 0 || !equal(outlined.artboards, p.source.artboards) || !equal(outlined.layers, p.source.layers)) {
                        failure = { stage, reason: 'outline_incomplete', message: 'The outline, artboard or layer restoration checks failed. Nothing was published.' };
                    }
                }
                if (!failure) {
                    stage = 'save_output';
                    const plan = p.options.operation === 'pdf' ? p.options.plan : null;
                    try {
                        saved = await call('save', { kind: 'read',
                            script: plan === null ? WORK_COPY_OVERWRITE_OUTLINED_SCRIPT : plan.preserveEditability === null ? WORK_COPY_OVERWRITE_PDF_SCRIPT : WORK_COPY_OVERWRITE_PDF_PRESERVE_SCRIPT,
                            timeoutMs: EXPORT_HOST_TIMEOUT_MS,
                            params: { workCopyPath: p.workCopyPath, workCopyKey: closeTarget.key, stagedPath: p.stagedPath, outputPath: p.outputPath, overwrite: true,
                                ...(plan ? pdfSaveParams(plan, p.source.artboards) : { format: p.format, pdfPreset: p.options.operation === 'outlined' ? p.options.pdfPreset : null }) }, hostGate: {
                                beforeHost: async () => { await unchanged(); await rootScope.assertStable(); await parent.assertStable(); await assertExpectedOutput(p.expectedOutput, WORK_COPY_PREVIOUS_LIMIT); await assertOutputAbsent(p.stagedPath); },
                                afterHost: async ({ commandId, data }) => {
                                    const result = data;
                                    assert([p.workCopyPath, p.stagedPath].some(path => sameFilePath(result.pathAfter, path)) && result.workCopy.path !== null && sameFilePath(result.pathAfter, result.workCopy.path), 'The saved copy has an unexpected observed identity.');
                                    saved = result;
                                    closeTarget = { path: result.pathAfter, key: result.workCopy.key };
                                    await unchanged();
                                    stage = 'verify_output';
                                    let payload;
                                    try {
                                        verification = await verifyOutputFile(p.stagedPath, plan ? null : p.source.artboards.length, () => syncDirectory(p.stagingDirectory));
                                        if (plan) {
                                            const structure = await verifyPdfStructure(p.stagedPath, plan);
                                            payload = { operation: 'pdf', outputPath: p.outputPath, bytes: verification.bytes, sha256: verification.sha256, preset: presetReport(plan.preset), artboardRange: plan.artboardRange,
                                                marks: plan.marks, bleed: plan.bleed, bleedSource: plan.bleedSource, expectedBleedMm: plan.expectedBleedMm,
                                                pages: plan.pages.map((page, index) => ({ ...page, mediaBox: structure.pages[index].mediaBox, trimBox: structure.pages[index].trimBox, bleedBox: structure.pages[index].bleedBox })),
                                                pdf: pdfFacts(structure), pdfx: pdfxReport(structure, plan.pdfx), ...preserveEditabilityOptions(plan.preserveEditability, result), sourcePreserved: true };
                                        }
                                        else {
                                            assert(outlined !== null, 'The outline summary is missing.');
                                            payload = { operation: 'outlined', sourcePath: p.source.path, sourceName: p.source.document.name, sourceFileRevision: p.source.document.fileRevision, format: p.format, outputPath: p.outputPath,
                                                pdfPreset: p.options.operation === 'outlined' ? p.options.pdfPreset : null, sourcePreserved: true,
                                                outline: { textFramesBefore: outlined.textFramesBefore, textFramesAfter: 0, groupItemsAdded: outlined.counts.groupItems - p.source.counts.groupItems, pageItemsBefore: p.source.counts.pageItems, pageItemsAfter: outlined.counts.pageItems },
                                                verification: { method: 'pdf_header_scan', header: verification.header, pageObjects: verification.pageObjects, artboardCount: p.source.artboards.length, fontObjects: verification.fontObjects } };
                                        }
                                    }
                                    catch (e) {
                                        if (!(e instanceof OutputVerificationError))
                                            throw e;
                                        failure = { stage, reason: 'output_verification_failed', message: e.message };
                                        return;
                                    }
                                    const records = (await this.ws.set(id)).records;
                                    assert(records.session.state === 'valid' && records.host_open.state === 'valid', 'The session/open evidence is missing.');
                                    const artifact = { path: p.stagedPath, identity: serializeFileIdentity(verification.identity), bytes: verification.bytes, sha256: verification.sha256 };
                                    await this.ws.write('artifact_binding', { ...common, recordType: 'artifact_binding', sessionDigest: records.session.digest, hostOpenDigest: records.host_open.digest,
                                        hostPrepareDigest: records.host_prepare.state === 'valid' ? records.host_prepare.digest : null, saveCall: { commandId, completedInactive: true }, save: result, artifact,
                                        verification: { ...verification, identity: artifact.identity }, payload });
                                    await refresh();
                                },
                            } });
                    }
                    catch (error) {
                        if (error instanceof IndeterminateExecutionError)
                            throw error;
                        const detail = parseExportHostError(error);
                        if (detail?.code === 'EXPORT_WORK_COPY_NOT_UNIQUE' || detail?.code === 'EXPORT_WORK_COPY_IDENTITY_MISMATCH')
                            throw error;
                        const preAttempt = plan ? PDF_EXPORT_SAVE_PRE_ATTEMPT_CODES : EXPORT_SAVE_PRE_ATTEMPT_CODES;
                        if (detail?.code && preAttempt.includes(detail.code)) {
                            failure = { stage: 'save_output', reason: 'save_failed', message: `The save was refused before any write (${detail.code}).` };
                        }
                        else if (detail?.code === EXPORT_SAVE_FAILED_CODE && detail.outputExists === false) {
                            failure = { stage: 'save_output', reason: 'save_failed', message: `Illustrator refused the save: ${detail.message ?? 'unknown error'}` };
                        }
                        else
                            throw error;
                    }
                }
                stage = 'close_work_copy';
                let outcome = null;
                const target = closeTarget;
                assert(target, 'The observed close target is missing.');
                await call('close', { kind: 'read', script: EXPORT_CLOSE_WORK_COPY_SCRIPT, timeoutMs: EXPORT_HOST_TIMEOUT_MS,
                    params: { workCopyPath: target.path, workCopyKey: target.key, sessionPaths, sourcePath: p.source.path, expectedDocumentKey: p.source.document.key, sourceFileRevision: p.source.document.fileRevision }, hostGate: {
                        beforeHost: unchanged,
                        afterHost: async ({ commandId, data }) => {
                            const t = data;
                            assert(t.documentCount === opened.documentCountBefore && (await matchingDocumentPaths(t, sessionPaths)).length === 0 && t.closedBeforeClose.key === target.key && t.closedBeforeClose.path !== null && sameFilePath(t.closedBeforeClose.path, target.path), 'The close inventory differs from the observed copy.');
                            await unchanged();
                            await rootScope.assertStable();
                            await parent.assertStable();
                            assert(t.source.key === p.source.document.key && t.source.saved && t.source.fileRevision === p.source.document.fileRevision, 'The source Host identity changed.');
                            const sourceAfter = await policy.readFileFacts(p.source.path);
                            assert(sourceAfter.sha256 === p.source.sha256 && equal(serializeFileIdentity(sourceAfter.identity), p.source.identity), 'The source file bytes or identity changed.');
                            for (const attempt of attempts)
                                assert(attempt.commandId === commandId || await this.deps.bridge.commandExecutionState?.(attempt.commandId) === 'inactive', 'A Host command is not proven inactive.');
                            const records = (await this.ws.set(id)).records;
                            await this.ws.write('host_terminal', { ...common, recordType: 'host_terminal', bindingDigest: records.artifact_binding.state === 'valid' ? records.artifact_binding.digest : null,
                                close: { commandId, completedInactive: true }, closedBeforeClose: t.closedBeforeClose, sourceKey: t.source.key, sourceSaved: t.source.saved, sourceFileRevision: t.source.fileRevision,
                                sourceIdentity: serializeFileIdentity(sourceAfter.identity), sourceSha256: sourceAfter.sha256, saveObservation: saved, attempts, scopeDocuments: 0, documentCount: t.documentCount });
                            await refresh();
                            stage = 'publish_output';
                            const bound = (await this.ws.set(id)).records.artifact_binding;
                            if (failure || bound.state !== 'valid') {
                                const f = failure ?? { stage, reason: 'output_verification_failed', message: 'No verified staged output was bound.' };
                                await this.fail(p, f);
                                await refresh();
                                outcome = this.result(await this.ws.set(id), 'original', hostCalls, performance.now() - started);
                                return;
                            }
                            let intent = null;
                            try {
                                assert(verification, 'The verified artifact is missing.');
                                await verifyOutputUnchanged(p.stagedPath, verification);
                                await parent.assertStable();
                                await rootScope.assertStable();
                                const set = await this.ws.set(id), r = set.records;
                                assert(r.prepare.state === 'valid' && r.host_terminal.state === 'valid', 'The source terminal or prepare is missing.');
                                const archiveStarted = performance.now();
                                intent = workCopyIntentSchema.parse(await prepareReplacementFilesystem({ ...common, recordType: 'replacement_intent', prepareDigest: r.prepare.digest,
                                    bindingDigest: bound.digest, hostTerminalDigest: r.host_terminal.digest, publicationDigest: digest(workCopyPublicationPayload(bound.record)), expected: p.expectedOutput, staged: bound.record.artifact }, store.stateRootPath, this.deps.replacementHook));
                                this.archiveMs += performance.now() - archiveStarted;
                                await this.ws.writeIntent(intent);
                                await refresh();
                                await this.deps.replacementHook?.('intent_ready');
                                await requireReplacementTerminal(store, await this.ws.set(id));
                                await detachPreviousOutput(intent, this.deps.replacementHook);
                                await this.deps.replacementHook?.('before_publish');
                                await requireReplacementTerminal(store, await this.ws.set(id));
                                await linkBoundArtifact(p.stagedPath, p.outputPath, verification, parent, undefined, verification.bytes);
                                await syncReplacementDirectory(p.stagingDirectory);
                                assert((await requireReplacementTerminal(store, await this.ws.set(id))).filesystem === 'published', 'The visible output is not the bound stage.');
                                await this.deps.replacementHook?.('published');
                                await requireReplacementTerminal(store, await this.ws.set(id));
                                await this.ws.write('published', { ...common, recordType: 'published', bindingDigest: bound.digest, hostTerminalDigest: r.host_terminal.digest,
                                    ...workCopyPublicationPayload(bound.record), replacement: replacementSummary(intent), recordedAt: new Date().toISOString() });
                                await refresh();
                                stage = 'write_record';
                                await this.cleanup(p, 'published');
                                await refresh();
                                outcome = this.result(await this.ws.set(id), 'original', hostCalls, performance.now() - started);
                            }
                            catch (e) {
                                if (e instanceof OutputReplacementError && ['output_changed', 'output_changed_since_plan', 'output_previous_unsafe'].includes(e.reason) && await this.ws.intent(id) === null) {
                                    await this.fail(p, { stage, reason: e.reason, message: e.message });
                                    await refresh();
                                    outcome = this.result(await this.ws.set(id), 'original', hostCalls, performance.now() - started);
                                    return;
                                }
                                if (e instanceof OutputReplacementError && e.foreignRestored && intent !== null) {
                                    await this.fail(p, { stage, reason: e.reason, message: e.message }, { ...replacementSummary(intent, e.retained), restoredForeign: e.restoredForeign });
                                    await refresh();
                                    outcome = this.result(await this.ws.set(id), 'original', hostCalls, performance.now() - started);
                                    return;
                                }
                                throw e;
                            }
                        },
                    } });
                return outcome ?? indeterminate(new Error('The close completed without a terminal outcome.'));
            }
            catch (e) {
                return indeterminate(e);
            }
        }));
    }
    async fail(p, failure, replacement, abandonment = null) {
        const set = await this.ws.set(p.exportId), summary = replacement ?? (await requireReplacementTerminal(this.deps.store, set)).summary;
        let sessionSnapshot = null;
        if (set.records.session.state === 'valid' && set.records.host_open.state === 'absent') {
            const path = this.ws.path(p.exportId, 'session');
            const raw = await readSecurePrivateRecord(path, 16384, { maxLinkCount: await createOnceLinkAllowance(path) });
            assert(raw.state === 'valid' && createHash('sha256').update(raw.bytes).digest('hex') === set.records.session.digest, 'The original pre-terminal lease changed.');
            sessionSnapshot = raw.text;
        }
        await this.ws.write('failed', { ...workCopyCommon(p), recordType: 'failed', ...failure, sessionDigest: set.records.session.state === 'valid' ? set.records.session.digest : null, sessionSnapshot, abandonment, evidenceDigests: workCopyTerminalEvidence(set), replacement: summary, recordedAt: new Date().toISOString() });
        await requireReplacementTerminal(this.deps.store, await this.ws.set(p.exportId), 'failed');
        await this.cleanup(p, 'failed');
    }
    async cleanup(p, disposition) {
        const store = this.deps.store, id = p.exportId;
        const initial = await requireReplacementTerminal(store, await this.ws.set(id), disposition);
        if (initial.intent && (disposition === 'published' || initial.filesystem === 'restored')) {
            await cleanupPreviousSlot(initial.intent, this.deps.replacementHook);
            await requireReplacementTerminal(store, await this.ws.set(id), disposition);
        }
        const r = (await this.ws.set(id)).records;
        assert(r.session.state === 'valid' || disposition === 'failed' && r.host_open.state === 'absent', 'Cleanup needs the held lease or a pre-open failure.');
        assert(r.quarantine.state === 'absent', 'Quarantined evidence cannot authorize release.');
        if (r.cleanup.state === 'valid') {
            await requireReplacementTerminal(store, await this.ws.set(id), disposition);
            if (r.session.state === 'valid')
                await store.releaseSession(id);
            return;
        }
        const entries = [];
        for (const path of [p.stagedPath, p.stagingDirectory, p.workCopyPath]) {
            await requireReplacementTerminal(store, await this.ws.set(id), disposition);
            let removed = disposition === 'published' && await replacementStat(path) === null;
            const expectedIdentity = path === p.workCopyPath && r.session.state === 'valid' ? r.session.record.workCopyIdentity : path === p.stagedPath && r.artifact_binding.state === 'valid' ? r.artifact_binding.record.artifact.identity : null;
            if (disposition === 'published' && !removed) {
                if (path === p.stagedPath && r.artifact_binding.state === 'valid')
                    removed = await unlinkStagedName(path, identity(r.artifact_binding.record.artifact.identity), null);
                else if (path === p.stagingDirectory)
                    removed = await removeEmptyDirectory(path, p.outputParent);
                else if (path === p.workCopyPath && r.session.state === 'valid')
                    removed = await removeOwnedFile(path, identity(r.session.record.workCopyIdentity));
            }
            entries.push({ path, expectedIdentity, removed, reason: removed ? 'owned' : 'Retained export evidence.' });
        }
        const terminal = disposition === 'published' ? r.published : r.failed;
        assert(terminal.state === 'valid', 'The terminal record is missing.');
        await this.ws.write('cleanup', { ...workCopyCommon(p), recordType: 'cleanup', terminalDigest: workCopyTerminalReceiptDigest(terminal.record), sessionDigest: r.session.state === 'valid' ? r.session.digest : null, disposition, entries });
        await requireReplacementTerminal(store, await this.ws.set(id), disposition);
        if (r.session.state === 'valid')
            await store.releaseSession(id);
        await requireReplacementTerminal(store, await this.ws.set(id), disposition);
    }
    async owns(id) {
        if (await replacementStat(this.deps.store.recordDirectory) === null)
            return false;
        for (const type of ['prepare', 'session', 'published', 'artifact_binding']) {
            let read;
            try {
                const path = this.ws.path(id, type);
                read = await readSecurePrivateRecord(path, 65536, { maxLinkCount: await createOnceLinkAllowance(path) });
            }
            catch (e) {
                if (e.code === 'ENOENT')
                    continue;
                throw e;
            }
            if (read.state !== 'valid')
                continue;
            let raw;
            try {
                raw = JSON.parse(read.text);
            }
            catch {
                continue;
            }
            if (raw !== null && typeof raw === 'object' && (Reflect.get(raw, 'version') === 6 || Reflect.get(raw, 'kind') === 'work_copy_export'))
                return true;
        }
        return false;
    }
    async reconcile(input) {
        const id = input.exportId, set = await this.ws.set(id), r = set.records, store = this.deps.store;
        const initial = await assessReplacementTerminal(store, set);
        if (initial.state === 'invalid')
            return { status: 'invalid', exportId: id, reason: `${initial.reason}: ${initial.detail}` };
        assert(r.prepare.state === 'valid', 'The original prepare is missing.');
        const p = r.prepare.record;
        if (initial.disposition !== null && r.cleanup.state === 'valid' && r.quarantine.state === 'absent') {
            if (r.session.state === 'absent')
                return { status: 'closed', exportId: id, disposition: initial.disposition, replacement: initial.summary };
            const fingerprint = digest({ set, intent: initial.intent });
            const current = await this.ws.set(id), assessment = await assessReplacementTerminal(store, current);
            if (assessment.state === 'invalid' || digest({ set: current, intent: assessment.intent }) !== fingerprint)
                return { status: 'invalid', exportId: id, reason: 'replacement_terminal_invalid: terminal cleanup or lease changed before S12 release' };
            await this.syncRecoveryEvidence(set, initial.intent);
            await store.releaseSession(id);
            return { status: 'released', exportId: id, window: 'closed', action: input.action, disposition: initial.disposition };
        }
        const paths = [p.workCopyPath, p.stagingDirectory, p.stagedPath, p.outputPath, ...(initial.intent?.slot ? [initial.intent.slot] : []), ...(initial.intent?.archive ? [initial.intent.archive.path] : [])];
        const residue = await Promise.all(paths.map(async (path) => ({ path, present: await replacementStat(path) !== null, owned: false, reason: 'Retained evidence; identity must match its original binding before any cleanup.' })));
        const unresolved = (reason, documents = null, window = initial.filesystem) => ({ status: 'unresolved', exportId: id, window, action: input.action, reason, documents, residue,
            message: 'Use an explicit permitted action. Dirty or unknown copies and foreign files are retained; no export is repeated.' });
        if (r.quarantine.state !== 'absent')
            return unresolved('quarantined');
        if (input.action === 'release_quarantined')
            return unresolved('action_not_allowed');
        if (['restore_previous', 'finalize_publish'].includes(input.action) && input.confirmExportId !== id)
            return unresolved('confirm_export_id_mismatch');
        const fingerprint = digest({ set, intent: initial.intent });
        const unchanged = async () => assert(digest({ set: await this.ws.set(id), intent: await this.ws.intent(id) }) === fingerprint, 'The export evidence changed before reconciliation.');
        await this.profile();
        let result = null, inventory;
        inventory = await this.host({ kind: 'read', script: EXPORT_INVENTORY_SCRIPT, params: { sessionPaths: [p.workCopyPath, p.stagedPath, p.outputPath] }, hostGate: {
                beforeHost: unchanged,
                afterHost: async ({ commandId, data }) => {
                    const count = (await matchingDocumentPaths(data, [p.workCopyPath, p.stagedPath, p.outputPath])).length;
                    if (input.action === 'inspect' || input.action === 'close_work_copy') {
                        result = unresolved('explicit_action_required', count);
                        return;
                    }
                    if (count !== 0) {
                        result = unresolved('session_document_open', count);
                        return;
                    }
                    await unchanged();
                    if (r.host_terminal.state !== 'valid') {
                        if (input.action !== 'abandon' || initial.intent !== null || p.openCommandId === null) {
                            result = unresolved('host_terminal_unavailable', count);
                            return;
                        }
                        const ids = [p.openCommandId, ...(r.host_prepare.state === 'valid' ? [r.host_prepare.record.outlineCall.commandId] : []), ...(r.artifact_binding.state === 'valid' ? [r.artifact_binding.record.saveCall.commandId] : [])];
                        for (const known of ids)
                            if (await this.deps.bridge.commandExecutionState?.(known) !== 'inactive') {
                                result = unresolved('host_command_not_inactive', count);
                                return;
                            }
                        await this.syncRecoveryEvidence(set, null);
                        await unchanged();
                        if (r.failed.state === 'valid')
                            await this.cleanup(p, 'failed');
                        else
                            await this.fail(p, { stage: 'write_record', reason: 'not_published', message: 'Explicitly abandoned after independent zero-scope inventory; all known commands are inactive. Unverified artifacts are retained.' }, undefined, { inventory: { commandId, completedInactive: true }, scopeDocuments: 0 });
                        result = { status: 'released', exportId: id, window: 'before_intent', action: input.action, disposition: 'failed' };
                        return;
                    }
                    for (const attempt of r.host_terminal.record.attempts)
                        if (await this.deps.bridge.commandExecutionState?.(attempt.commandId) !== 'inactive') {
                            result = unresolved('host_command_not_inactive', count);
                            return;
                        }
                    const current = await requireReplacementTerminal(store, await this.ws.set(id)), intent = current.intent;
                    if (current.filesystem === 'foreign' && current.disposition !== 'failed') {
                        result = unresolved('output_or_slot_identity_mismatch', count);
                        return;
                    }
                    await this.syncRecoveryEvidence(set, intent);
                    await unchanged();
                    if (current.disposition !== null) {
                        if (!['finalize', 'abandon', 'restore_previous'].includes(input.action)) {
                            result = unresolved('terminal_requires_finalize', count);
                            return;
                        }
                        await this.cleanup(p, current.disposition);
                        result = { status: 'released', exportId: id, window: current.filesystem, action: input.action, disposition: current.disposition };
                        return;
                    }
                    if (input.action === 'restore_previous' && intent && ['detached', 'restored'].includes(current.filesystem)) {
                        await restorePreviousOutput(intent, this.deps.replacementHook);
                        await requireReplacementTerminal(store, await this.ws.set(id));
                        await this.fail(p, { stage: 'publish_output', reason: 'previous_restored', message: 'The detached previous output was restored explicitly. No export was repeated.' });
                        result = { status: 'released', exportId: id, window: 'restored', action: input.action, disposition: 'failed' };
                        return;
                    }
                    if (input.action === 'abandon' && ['before_intent', 'previous', 'create'].includes(current.filesystem)) {
                        await this.fail(p, { stage: 'publish_output', reason: 'not_published', message: 'The export was explicitly abandoned; evidence is retained.' });
                        result = { status: 'released', exportId: id, window: current.filesystem, action: input.action, disposition: 'failed' };
                        return;
                    }
                    if (input.action === 'finalize_publish' && intent && ['detached', 'create'].includes(current.filesystem)) {
                        const b = r.artifact_binding;
                        assert(b.state === 'valid', 'The original artifact binding is missing.');
                        await this.deps.policy.withOutputParentScope(p.outputParent, async (parent) => {
                            await requireReplacementTerminal(store, await this.ws.set(id));
                            await linkBoundArtifact(p.stagedPath, p.outputPath, { ...b.record.verification, identity: identity(b.record.artifact.identity) }, parent, undefined, b.record.artifact.bytes);
                            await syncReplacementDirectory(p.stagingDirectory);
                        });
                    }
                    else if (!(input.action === 'finalize' && current.filesystem === 'published')) {
                        result = unresolved('action_not_allowed_in_state', count);
                        return;
                    }
                    const visible = await requireReplacementTerminal(store, await this.ws.set(id));
                    assert(visible.filesystem === 'published' && visible.intent, 'The intended publication is not visible.');
                    assert(r.artifact_binding.state === 'valid' && r.host_terminal.state === 'valid', 'The prepublication chain is missing.');
                    await this.ws.write('published', { ...workCopyCommon(p), recordType: 'published', bindingDigest: r.artifact_binding.digest, hostTerminalDigest: r.host_terminal.digest,
                        ...workCopyPublicationPayload(r.artifact_binding.record), replacement: visible.summary, recordedAt: new Date().toISOString() });
                    await requireReplacementTerminal(store, await this.ws.set(id), 'published');
                    await this.cleanup(p, 'published');
                    result = { status: 'released', exportId: id, window: 'published', action: input.action, disposition: 'published' };
                },
            } });
        if (input.action !== 'close_work_copy')
            return result ?? unresolved('not_released');
        const matched = await matchingDocumentPaths(inventory, [p.workCopyPath, p.stagedPath, p.outputPath]);
        if (matched.length !== 1 || r.host_open.state !== 'valid')
            return unresolved('work_copy_not_unique_or_unbound', matched.length);
        const o = r.host_open.record, target = matched[0];
        const provenance = { workCopyPath: p.workCopyPath, stagedPath: p.stagedPath, colorSpace: o.workCopy.colorSpace,
            artboardRects: p.source.artboards.map(a => a.rect.join(',')).join(';'), fileRevisionAtOpen: o.workCopy.fileRevision };
        const refusal = closeRefusalReason(target, provenance);
        if (refusal) {
            await this.host({ kind: 'read', script: EXPORT_INVENTORY_SCRIPT, params: { sessionPaths: [p.workCopyPath, p.stagedPath, p.outputPath] }, hostGate: {
                    beforeHost: unchanged, afterHost: async () => { await unchanged(); await this.ws.write('quarantine', { ...workCopyCommon(p), recordType: 'quarantine', evidenceDigests: workCopyTerminalEvidence(set), residue: paths, reason: refusal }); },
                } });
            return unresolved(refusal, matched.length);
        }
        const lease = await this.ws.readSession(id);
        assert(lease.state === 'valid' && r.session.state === 'valid' && lease.digest === r.session.digest, 'The recovery close lease changed.');
        const closed = await this.host({ kind: 'read', script: EXPORT_RECONCILE_CLOSE_SCRIPT, timeoutMs: EXPORT_HOST_TIMEOUT_MS,
            params: { sessionPaths: [p.workCopyPath, p.stagedPath, p.outputPath], expected: target, provenance }, hostGate: { beforeHost: unchanged } });
        return unresolved('closed_copy_lease_retained', (await matchingDocumentPaths(closed, [p.workCopyPath, p.stagedPath, p.outputPath])).length);
    }
    async syncRecoveryEvidence(set, intent) {
        const p = set.records.prepare;
        assert(p.state === 'valid', 'The prepare is missing.');
        for (const [type, read] of Object.entries(set.records))
            if (read.state === 'valid') {
                const path = this.ws.path(p.record.exportId, type), handle = await open(path, noFollowNonBlockingReadFlags());
                try {
                    await handle.sync();
                }
                finally {
                    await handle.close();
                }
                await syncDirectory(dirname(path));
            }
        if (intent) {
            for (const path of [this.ws.path(p.record.exportId, 'replacement_intent'), intent.archive?.path, intent.staged.path]) {
                if (!path || await replacementStat(path) === null)
                    continue;
                const handle = await open(path, noFollowNonBlockingReadFlags());
                try {
                    await handle.sync();
                }
                finally {
                    await handle.close();
                }
                await syncDirectory(dirname(path));
            }
            for (const d of intent.privateDirectories)
                await syncDirectory(d.path);
            await syncDirectory(p.record.outputParent);
        }
    }
}
class Refusal extends Error {
    reason;
    constructor(reason, message) {
        super(message);
        this.reason = reason;
    }
}
