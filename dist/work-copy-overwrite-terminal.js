import { createHash } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { currentUid } from './platform-primitives.js';
import { sameFilePath } from './file-path.js';
import { assertReplacementScopes, classifyReplacement, replacementSummary, replacementStat, verifyReplacementArchive, verifyRestoredForeign, PREINTENT_ARCHIVE_REASON, RESTORED_FOREIGN_REASON } from './output-replacement.js';
import { WorkCopyOverwriteStore, WORK_COPY_RECORD_SCHEMAS, assertWorkCopyPaths, workCopyCommon, workCopyDigest as digest } from './work-copy-overwrite-records.js';
const equal = (a, b) => digest(a) === digest(b);
function invariant(condition, detail) { if (!condition)
    throw new Error(detail); }
export function workCopyPlanDigest(p) {
    return digest({ kind: 'work_copy_overwrite_plan_v6', operation: p.operation, format: p.format, source: p.source, options: p.options,
        requestedDocumentKey: p.requestedDocumentKey, outputPath: p.outputPath, expectedOutput: p.expectedOutput });
}
export function workCopyRequestDigest(p) {
    return digest({ kind: 'work_copy_overwrite_request_v6', operation: p.operation, format: p.format, source: p.source,
        options: p.options, requestedDocumentKey: p.requestedDocumentKey, outputPath: p.outputPath, expectedOutput: p.expectedOutput });
}
export function workCopyTerminalEvidence(set) {
    const evidence = {};
    for (const type of ['prepare', 'host_open', 'host_prepare', 'artifact_binding', 'host_terminal']) {
        const read = set.records[type];
        if (read.state === 'valid')
            evidence[type] = read.digest;
    }
    return evidence;
}
export function workCopyTerminalReceiptDigest(record) {
    const { recordedAt: _at, ...value } = record;
    void _at;
    if (value.recordType === 'failed') {
        const { stage: _stage, reason: _reason, message: _message, ...payload } = value;
        void _stage;
        void _reason;
        void _message;
        return digest(payload);
    }
    return digest(value);
}
export function workCopyPublicationPayload(b) { return { artifact: b.artifact, payload: b.payload }; }
export async function assessWorkCopyTerminal(store, set) {
    try {
        const r = set.records, ws = new WorkCopyOverwriteStore(store);
        for (const read of Object.values(r))
            invariant(read.state !== 'invalid', 'An export record is invalid.');
        invariant(r.prepare.state === 'valid', 'The original prepare is absent.');
        const p = r.prepare.record, common = workCopyCommon(p);
        assertWorkCopyPaths(p, store);
        invariant(p.openCommandId !== null, 'The prepare lost its original open command id.');
        invariant(p.planDigest === workCopyPlanDigest(p) && p.requestDigest === workCopyRequestDigest(p), 'The plan or request digest differs from the retained inputs.');
        invariant(p.operation === p.options.operation && (p.operation !== 'pdf' || p.format === 'pdf'), 'The operation, format and options disagree.');
        invariant(p.source.document.path !== null && sameFilePath(p.source.document.path, p.source.path) && p.source.document.saved && p.source.document.mutationProfile === 'saved_file', 'The saved source baseline is invalid.');
        for (const read of Object.values(r))
            if (read.state === 'valid')
                invariant(equal(workCopyCommon(read.record), common), 'Mixed record identity, plan, request or output expectation.');
        const s = r.session.state === 'valid' ? r.session.record : null;
        const o = r.host_open.state === 'valid' ? r.host_open.record : null;
        const h = r.host_prepare.state === 'valid' ? r.host_prepare.record : null;
        const b = r.artifact_binding.state === 'valid' ? r.artifact_binding.record : null;
        const t = r.host_terminal.state === 'valid' ? r.host_terminal.record : null;
        const published = r.published.state === 'valid' ? r.published.record : null, failed = r.failed.state === 'valid' ? r.failed.record : null;
        let retainedSession = null;
        if (failed?.sessionSnapshot !== null && failed?.sessionSnapshot !== undefined) {
            invariant(Buffer.byteLength(failed.sessionSnapshot) <= 16384 && createHash('sha256').update(failed.sessionSnapshot).digest('hex') === failed.sessionDigest, 'The original pre-terminal session bytes changed.');
            retainedSession = WORK_COPY_RECORD_SCHEMAS.session.parse(JSON.parse(failed.sessionSnapshot));
            invariant(!o && equal(workCopyCommon(retainedSession), common) && retainedSession.prepareDigest === r.prepare.digest && retainedSession.openCommandId === p.openCommandId &&
                retainedSession.sha256 === p.source.sha256 && retainedSession.bytes === p.source.bytes && retainedSession.workCopyIdentity.size === String(retainedSession.bytes) &&
                !(retainedSession.workCopyIdentity.dev === p.source.identity.dev && retainedSession.workCopyIdentity.ino === p.source.identity.ino), 'The retained pre-terminal lease lost its original copy binding.');
            if (s)
                invariant(r.session.state === 'valid' && failed.sessionDigest === r.session.digest && equal(retainedSession, s), 'The retained and held session differ.');
        }
        if (failed)
            invariant((failed.sessionSnapshot !== null) === (!o && failed.sessionDigest !== null), 'A failed pre-terminal outcome lost its original session snapshot.');
        const copySession = s ?? retainedSession;
        if (s)
            invariant(s.prepareDigest === r.prepare.digest && s.openCommandId === p.openCommandId && s.sha256 === p.source.sha256 && s.bytes === p.source.bytes &&
                s.workCopyIdentity.size === String(s.bytes) && !(s.workCopyIdentity.dev === p.source.identity.dev && s.workCopyIdentity.ino === p.source.identity.ino), 'The session copy is not independently bound.');
        if (o) {
            invariant(o.prepareDigest === r.prepare.digest && o.sourceKey === p.source.document.key && o.workCopy.path === p.workCopyPath &&
                o.workCopy.key !== o.sourceKey && o.documentCountAfter === o.documentCountBefore + 1 && equal(o.artboards, p.source.artboards) &&
                o.copyFile.path === p.workCopyPath && o.copyFile.bytes === p.source.bytes && o.copyFile.sha256 === p.source.sha256 &&
                !(o.copyFile.identity.dev === p.source.identity.dev && o.copyFile.identity.ino === p.source.identity.ino), 'The opened copy differs from the source/session.');
            if (s)
                invariant(r.session.state === 'valid' && o.sessionDigest === r.session.digest && o.open.commandId === s.openCommandId && equal(o.copyFile.identity, s.workCopyIdentity) && equal(o.stageIdentity, s.stageIdentity), 'The open command differs from the lease.');
        }
        if (h)
            invariant(p.operation === 'outlined' && o && r.host_open.state === 'valid' && h.hostOpenDigest === r.host_open.digest &&
                h.outline.workCopy.path === p.workCopyPath, 'The outline evidence differs from its open/source chain.');
        if (b) {
            invariant(o && r.host_open.state === 'valid' && b.hostOpenDigest === r.host_open.digest && b.save.pathBefore === p.workCopyPath &&
                [p.workCopyPath, p.stagedPath].some(path => sameFilePath(path, b.save.pathAfter)) && b.save.workCopy.path === b.save.pathAfter && b.artifact.path === p.stagedPath &&
                b.artifact.bytes === b.verification.bytes && b.artifact.sha256 === b.verification.sha256 && equal(b.artifact.identity, b.verification.identity) &&
                b.payload.operation === p.operation, 'The saved artifact differs from its original evidence.');
            if (s)
                invariant(r.session.state === 'valid' && b.sessionDigest === r.session.digest, 'The artifact differs from the lease.');
            if (p.operation === 'outlined')
                invariant(h && r.host_prepare.state === 'valid' && b.hostPrepareDigest === r.host_prepare.digest &&
                    h.outline.textFramesAfter === 0 && h.outline.errors.length === 0 && h.outline.restoreErrors.length === 0 && equal(h.outline.artboards, p.source.artboards) && equal(h.outline.layers, p.source.layers), 'The outline save gate was not proven.');
            else
                invariant(h === null && b.hostPrepareDigest === null, 'A PDF export contains outline evidence.');
        }
        if (t)
            invariant(o && t.sourceKey === p.source.document.key && t.sourceSaved && t.sourceFileRevision === p.source.document.fileRevision &&
                equal(t.sourceIdentity, p.source.identity) && t.sourceSha256 === p.source.sha256 && t.documentCount === o.documentCountBefore &&
                t.bindingDigest === (r.artifact_binding.state === 'valid' ? r.artifact_binding.digest : null) &&
                (t.saveObservation ? equal(t.closedBeforeClose, t.saveObservation.workCopy) && [p.workCopyPath, p.stagedPath].some(path => sameFilePath(path, t.saveObservation.pathAfter)) : h ? equal(t.closedBeforeClose, h.outline.workCopy) : equal(t.closedBeforeClose, o.workCopy)) &&
                (!b || equal(t.saveObservation, b.save)) && t.attempts[0]?.step === 'open' && t.attempts[0].commandId === o.open.commandId && t.attempts.at(-1)?.step === 'close' && t.attempts.at(-1)?.commandId === t.close.commandId, 'The close/source terminal differs from the bound copy.');
        const owner = o?.copyFile ?? (copySession ? { path: p.workCopyPath, identity: copySession.workCopyIdentity, bytes: copySession.bytes, sha256: copySession.sha256 } : null);
        if (owner) {
            const actual = await replacementStat(p.workCopyPath);
            if (actual)
                invariant(actual.isFile() && actual.nlink === 1n && actual.uid === BigInt(currentUid()) &&
                    equal({ dev: String(actual.dev), ino: String(actual.ino), size: String(actual.size), mtimeNs: String(actual.mtimeNs), ctimeNs: String(actual.ctimeNs) }, owner.identity), 'A foreign work-copy inode is retained.');
            else
                invariant(r.published.state === 'valid' || r.failed.state === 'valid', 'The owned work copy disappeared before a terminal outcome.');
            const stage = await replacementStat(p.stagingDirectory), expectedStage = o?.stageIdentity ?? copySession.stageIdentity;
            if (stage) {
                invariant(stage.isDirectory() && !stage.isSymbolicLink() && stage.uid === BigInt(currentUid()) && (stage.mode & 511n) === 448n &&
                    String(stage.dev) === expectedStage.dev && String(stage.ino) === expectedStage.ino, 'The private stage directory changed.');
                invariant((await readdir(p.stagingDirectory)).every(name => name === basename(p.stagedPath) || name === 'previous-output'), 'Unknown private stage names are retained.');
            }
            else
                invariant(r.published.state === 'valid', 'The private stage disappeared before publication cleanup.');
        }
        const intent = await ws.intent(p.exportId);
        invariant(!(published && failed), 'Both terminal outcomes exist.');
        invariant(!(r.quarantine.state === 'valid' && (published || failed)), 'Quarantined evidence cannot authorize a terminal outcome.');
        let filesystem = 'before_intent';
        let summary = { mode: p.expectedOutput.action, archive: null, previousSha256: p.expectedOutput.action === 'replace' ? p.expectedOutput.sha256 : null, retained: [] };
        if (intent) {
            invariant(b && t && r.artifact_binding.state === 'valid' && r.host_terminal.state === 'valid' && equal(workCopyCommon(intent), common) &&
                intent.prepareDigest === r.prepare.digest && intent.bindingDigest === r.artifact_binding.digest && intent.hostTerminalDigest === r.host_terminal.digest &&
                equal(intent.expected, p.expectedOutput) && equal(intent.staged, b.artifact) && intent.publicationDigest === digest(workCopyPublicationPayload(b)) &&
                dirname(intent.staged.path) === p.stagingDirectory && intent.slot === (p.expectedOutput.action === 'create' ? null : join(p.stagingDirectory, 'previous-output')) &&
                (intent.archive === null || intent.archive.path === join(store.stateRootPath, 'output-replacements', p.exportId, 'old.bin')) &&
                equal(intent.privateDirectories.map(d => d.path), [store.stateRootPath, ...(p.expectedOutput.action === 'create' ? [] : [join(store.stateRootPath, 'output-replacements'), join(store.stateRootPath, 'output-replacements', p.exportId)])]), 'The intent differs from its prepublication chain.');
            await verifyReplacementArchive(intent);
            filesystem = await classifyReplacement(intent);
            summary = replacementSummary(intent);
        }
        else {
            invariant(!published && await replacementStat(join(p.stagingDirectory, 'previous-output')) === null, 'A publication or detach lost its write-ahead intent.');
            const archive = join(store.stateRootPath, 'output-replacements', p.exportId, 'old.bin');
            if (await replacementStat(archive) !== null)
                summary.retained = [{ path: archive, reason: PREINTENT_ARCHIVE_REASON }];
        }
        if (published) {
            invariant(intent && filesystem === 'published' && published.bindingDigest === intent.bindingDigest && published.hostTerminalDigest === intent.hostTerminalDigest &&
                digest({ artifact: published.artifact, payload: published.payload }) === intent.publicationDigest && equal(published.artifact.identity, intent.staged.identity) && equal(published.replacement, summary), 'The receipt differs from its prepublication authority.');
        }
        if (failed) {
            invariant(t ? failed.abandonment === null : failed.abandonment !== null && intent === null, 'A failed export lost its Host terminal or explicit abandonment proof.');
            invariant(failed.sessionDigest === (r.session.state === 'valid' ? r.session.digest : o?.sessionDigest ?? failed.sessionDigest), 'The failed receipt changed its original lease digest.');
            invariant(equal(failed.evidenceDigests, workCopyTerminalEvidence(set)), 'The failed receipt differs from the retained evidence set.');
            const foreign = failed.replacement.restoredForeign;
            if (foreign) {
                invariant(intent && foreign.path === intent.slot && failed.reason === 'output_changed', 'A foreign restoration has no bound slot.');
                await assertReplacementScopes(intent);
                invariant(await verifyRestoredForeign(foreign, intent.expected.path), 'The two restored foreign names differ.');
                summary = { ...summary, retained: [{ path: intent.slot, reason: RESTORED_FOREIGN_REASON }], restoredForeign: foreign };
            }
            else
                invariant(!intent || ['previous', 'restored', 'create'].includes(filesystem), 'A failed receipt conflicts with publication.');
            invariant(equal(failed.replacement, summary), 'The failed replacement summary is not bound.');
        }
        if (r.cleanup.state === 'valid') {
            const cleanup = r.cleanup.record, terminal = published ? r.published : failed ? r.failed : null;
            invariant(terminal?.state === 'valid' && cleanup.terminalDigest === workCopyTerminalReceiptDigest(terminal.record) && cleanup.disposition === (published ? 'published' : 'failed'), 'Cleanup has no matching terminal authority.');
            invariant(cleanup.sessionDigest === (r.session.state === 'valid' ? r.session.digest : o?.sessionDigest ?? failed?.sessionDigest ?? null), 'Cleanup changed the original lease bytes.');
            const owned = [p.workCopyPath, p.stagedPath, p.stagingDirectory];
            invariant(cleanup.entries.length === owned.length && equal(cleanup.entries.map(e => e.path).sort(), owned.sort()), 'Cleanup changed the fixed owned-path inventory.');
            for (const entry of cleanup.entries) {
                const expected = entry.path === p.workCopyPath ? o?.copyFile.identity ?? copySession?.workCopyIdentity ?? null : entry.path === p.stagedPath ? b?.artifact.identity ?? null : null;
                invariant(equal(entry.expectedIdentity, expected), 'Cleanup changed an independently bound inode.');
                if (entry.removed)
                    invariant(await replacementStat(entry.path) === null, 'An entry reported removed is still present.');
            }
        }
        if (!s) {
            const closed = (published || failed) && r.cleanup.state === 'valid';
            const preOpen = !o && !h && !b && !t && !intent && !published && (!failed || failed.abandonment !== null && failed.sessionDigest === null);
            invariant(closed || preOpen, 'A nonterminal lease is absent.');
        }
        return { state: 'valid', disposition: published ? 'published' : failed ? 'failed' : null, intent, filesystem, summary };
    }
    catch (error) {
        return { state: 'invalid', reason: 'replacement_terminal_invalid', detail: error instanceof Error ? error.message : String(error) };
    }
}
