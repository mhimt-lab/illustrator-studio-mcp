import { assessWorkCopyTerminal } from './work-copy-overwrite-terminal.js';
import { dirname, join } from 'node:path';
import { canonicalSerialize, canonicalSha256 } from './mutation-canonical.js';
import { assessRasterRecordSet, isExactExportRecord, isSvgExportRecord } from './raster-export-records.js';
import { assertReplacementScopes, classifyReplacement, replacementSummary, replacementStat, verifyRestoredForeign, RESTORED_FOREIGN_REASON, PREINTENT_ARCHIVE_REASON, verifyReplacementArchive, } from './output-replacement.js';
const equal = (a, b) => canonicalSerialize(a) === canonicalSerialize(b);
const digest = (value) => canonicalSha256(value);
function invariant(condition, detail) { if (!condition)
    throw new Error(detail); }
export function replacementPublicationPayload(set) {
    invariant(set.prepare.state === 'v2' && set.session.state === 'v2' && set.artifact_binding.state === 'v2', 'Publication needs the original prepare, session and binding.');
    const p = set.prepare.record, s = set.session.record, b = set.artifact_binding.record;
    return {
        artifact: { path: p.outputPath, mediaType: b.mediaType, bytes: b.bytes, sha256: b.sha256, width: b.width, height: b.height,
            ...(isSvgExportRecord(b) ? { viewBox: b.viewBox } : {}) },
        outputIdentity: b.stagedIdentity, sourcePath: p.sourcePath, artboardIndex: s.artboardIndex, options: s.options,
        ...(isExactExportRecord(s) || isSvgExportRecord(s) ? { expected: s.expected } : {}),
        ...(isSvgExportRecord(s) ? { expectedBounds: s.expectedBounds } : {}),
    };
}
export function replacementTerminalEvidence(set) {
    const result = {};
    for (const type of ['prepare', 'host_open', 'artifact_binding', 'host_terminal']) {
        const read = set[type];
        if (read.state === 'v2')
            result[type] = read.digest;
    }
    return result;
}
export class ReplacementTerminalInvalidError extends Error {
    reason = 'replacement_terminal_invalid';
    constructor(detail) { super(`replacement_terminal_invalid: ${detail}; the lease is retained.`); this.name = 'ReplacementTerminalInvalidError'; }
}
export async function assessReplacementTerminal(store, set) {
    if ('family' in set)
        return assessWorkCopyTerminal(store, set);
    try {
        const structural = assessRasterRecordSet(set);
        invariant(structural.state !== 'invalid', structural.state === 'invalid' ? structural.reason : '');
        invariant(set.prepare.state === 'v2' && set.prepare.record.version === 5, 'Missing v5 prepare.');
        const p = set.prepare.record;
        const read = await store.readReplacementIntent(p.exportId);
        const intent = read?.intent ?? null;
        const published = set.published.state === 'v2' && set.published.record.version === 5 ? set.published.record : null;
        const failed = set.failed.state === 'v2' && set.failed.record.version === 5 ? set.failed.record : null;
        invariant(!(published && failed), 'Both terminal outcomes exist.');
        let filesystem = 'before_intent';
        let summary = { mode: p.expectedOutput.action, archive: null,
            previousSha256: p.expectedOutput.action === 'replace' ? p.expectedOutput.sha256 : null, retained: [] };
        if (intent !== null) {
            const b = set.artifact_binding.state === 'v2' ? set.artifact_binding : null;
            const t = set.host_terminal.state === 'v2' ? set.host_terminal : null;
            invariant(b && t, 'Intent lost its original binding or host terminal.');
            const paths = [store.stateRootPath, ...(intent.expected.action === 'create' ? [] : [join(store.stateRootPath, 'output-replacements'), join(store.stateRootPath, 'output-replacements', p.exportId)])];
            invariant(intent.prepareDigest === set.prepare.digest && intent.bindingDigest === b.digest && intent.hostTerminalDigest === t.digest &&
                intent.planDigest === p.planDigest && intent.renderVersion === p.renderVersion && equal(intent.expected, p.expectedOutput) &&
                intent.staged.path === b.record.stagedPath && equal(intent.staged.identity, b.record.stagedIdentity) && intent.staged.bytes === b.record.bytes && intent.staged.sha256 === b.record.sha256 &&
                dirname(intent.staged.path) === p.stagingDirectory && intent.slot === (intent.expected.action === 'create' ? null : join(p.stagingDirectory, 'previous-output')) &&
                (intent.archive === null || intent.archive.path === join(store.stateRootPath, 'output-replacements', p.exportId, 'old.bin')) &&
                equal(intent.privateDirectories.map(d => d.path), paths), 'Intent differs from the retained record chain.');
            if (set.session.state === 'v2') {
                invariant(b.record.sessionDigest === set.session.digest, 'Binding differs from the held session.');
                invariant(digest(replacementPublicationPayload(set)) === intent.publicationDigest, 'Prepublication payload differs from the intent.');
            }
            await verifyReplacementArchive(intent);
            filesystem = await classifyReplacement(intent);
            summary = replacementSummary(intent);
        }
        else {
            invariant(published === null, 'Published receipt lost its prepublication intent.');
            invariant(await replacementStat(join(p.stagingDirectory, 'previous-output')) === null, 'A private detach slot exists without its write-ahead intent.');
            const unboundArchive = join(store.stateRootPath, 'output-replacements', p.exportId, 'old.bin');
            if (await replacementStat(unboundArchive) !== null)
                summary.retained = [{ path: unboundArchive, reason: PREINTENT_ARCHIVE_REASON }];
        }
        if (published !== null) {
            invariant(intent !== null && filesystem === 'published', 'The filesystem is not the intended publication.');
            const { artifact, outputIdentity, sourcePath, artboardIndex, options } = published;
            const payload = { artifact, outputIdentity, sourcePath, artboardIndex, options,
                ...(isExactExportRecord(published) || isSvgExportRecord(published) ? { expected: published.expected } : {}),
                ...(isSvgExportRecord(published) ? { expectedBounds: published.expectedBounds } : {}) };
            invariant(digest(payload) === intent.publicationDigest && equal(outputIdentity, intent.staged.identity) &&
                published.bindingDigest === intent.bindingDigest && published.hostTerminalDigest === intent.hostTerminalDigest && equal(published.replacement, summary), 'Published receipt differs from its prepublication authority.');
            return { state: 'valid', disposition: 'published', intent, filesystem, summary };
        }
        if (failed !== null) {
            invariant(equal(failed.evidenceDigests, replacementTerminalEvidence(set)), 'Failed receipt differs from its retained evidence digests.');
            const foreign = failed.replacement.restoredForeign;
            if (foreign !== undefined) {
                invariant(intent !== null && foreign.path === intent.slot && failed.reason === 'output_changed', 'Foreign restoration has no bound slot.');
                await assertReplacementScopes(intent);
                invariant(await verifyRestoredForeign(foreign, intent.expected.path), 'The restored foreign file differs from its two retained names.');
                summary = { ...summary, retained: [{ path: intent.slot, reason: RESTORED_FOREIGN_REASON }], restoredForeign: foreign };
            }
            else
                invariant(intent === null || filesystem === 'previous' || filesystem === 'restored' || filesystem === 'create', 'A failed receipt conflicts with the filesystem publication.');
            invariant(equal(failed.replacement, summary), 'Failed receipt differs from its bound replacement summary.');
            return { state: 'valid', disposition: 'failed', intent, filesystem, summary };
        }
        return { state: 'valid', disposition: null, intent, filesystem, summary };
    }
    catch (error) {
        return { state: 'invalid', reason: 'replacement_terminal_invalid', detail: error instanceof Error ? error.message : String(error) };
    }
}
export async function requireReplacementTerminal(store, set, disposition) {
    const assessment = 'family' in set ? await assessReplacementTerminal(store, set) : await assessReplacementTerminal(store, set);
    if (assessment.state === 'invalid')
        throw new ReplacementTerminalInvalidError(assessment.detail);
    if (disposition !== undefined && assessment.disposition !== disposition)
        throw new ReplacementTerminalInvalidError(`Expected ${disposition} receipt.`);
    return assessment;
}
