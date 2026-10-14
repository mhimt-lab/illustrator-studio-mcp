import { sameFilePath } from './file-path.js';
import { assertSameFilePathIdentity } from './file-path-identity.js';
import { lstat, readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { z } from 'zod';
import { isMissingPath } from './private-state.js';
import { SF_DATALESS, UF_HIDDEN } from './save-as-session.js';
export const saveAsReconcileStatusSchema = z.enum([
    'no_session', 'in_progress', 'command_locked', 'not_started', 'saved_not_published', 'published_document_on_staging',
    'document_modified', 'published_staging_left', 'released', 'retry', 'output_not_local', 'blocked', 'abandoned',
]);
export const saveAsReconcileActionSchema = z.enum(['inspect', 'switch_document', 'cleanup_staging', 'abandon']);
const inventoryDocumentSchema = z.strictObject({ key: z.string(), path: z.string(), saved: z.boolean(), index: z.number().int() });
export const saveAsReconcileResultSchema = z.strictObject({
    saveAsId: z.uuid(),
    status: saveAsReconcileStatusSchema,
    action: saveAsReconcileActionSchema,
    message: z.string().min(1),
    outputPath: z.string().nullable(),
    stagedPath: z.string().nullable(),
    stagingDirectory: z.string().nullable(),
    documents: z.array(inventoryDocumentSchema).nullable().describe('Open documents whose path is the staged file or the output.'),
    outputHidden: z.boolean().nullable().describe('The hidden flag a sync folder sets on the output while a staging name exists; null when unknown or no output.'),
    owner: z.strictObject({ pid: z.number().int(), processStartedAt: z.number().int() }).nullable().describe('For in_progress: the MCP server process still running this save-as.'),
    retained: z.array(z.string()).nullable().describe('For abandoned: every name left in place.'),
    nextCall: z.strictObject({
        tool: z.literal('illustrator_reconcile_save_as'),
        arguments: z.record(z.string(), z.unknown()),
    }).nullable(),
});
async function observe(path) {
    try {
        const metadata = await lstat(path, { bigint: true });
        return {
            state: 'present', dev: metadata.dev, ino: metadata.ino, nlink: metadata.nlink, size: metadata.size,
            mtimeNs: metadata.mtimeNs, isFile: metadata.isFile(), isDirectory: metadata.isDirectory(),
        };
    }
    catch (error) {
        if (isMissingPath(error))
            return { state: 'absent' };
        throw error;
    }
}
export async function collectSaveAsFacts(session, flags) {
    const parent = await observe(dirname(session.outputPath));
    const parentMatches = parent.state === 'present' && parent.isDirectory &&
        parent.dev.toString() === session.parent.dev && parent.ino.toString() === session.parent.ino;
    const stagingObserved = await observe(session.stagingDirectory);
    let staging;
    if (stagingObserved.state === 'absent')
        staging = { state: 'absent' };
    else if (!stagingObserved.isDirectory)
        staging = { state: 'other' };
    else
        staging = { state: 'directory', entries: (await readdir(session.stagingDirectory)).sort(), dev: stagingObserved.dev, ino: stagingObserved.ino };
    if (staging.state === 'directory') {
        const leaves = staging.entries.filter((leaf) => sameFilePath(leaf, basename(session.stagedPath)));
        if (leaves.length === 1)
            await assertSameFilePathIdentity(join(session.stagingDirectory, leaves[0]), session.stagedPath);
    }
    const stagedObserved = staging.state === 'directory' ? await observe(session.stagedPath) : { state: 'absent' };
    const staged = stagedObserved.state === 'absent' ? { state: 'absent' } : { ...stagedObserved, state: 'present' };
    const outputObserved = await observe(session.outputPath);
    const output = outputObserved.state === 'absent'
        ? { state: 'absent' }
        : { ...outputObserved, state: 'present', flags: await flags(session.outputPath) };
    return { parentMatches, staging, staged, output };
}
export function keyWithoutIndex(key) {
    return key.replace(/\|index=-?\d+\|/u, '|index=*|');
}
export function outputHiddenOf(facts) {
    if (facts.output.state !== 'present' || facts.output.flags === null)
        return null;
    return (facts.output.flags & UF_HIDDEN) !== 0;
}
export function outputIsDataless(facts) {
    return facts.output.state === 'present' && facts.output.flags !== null && (facts.output.flags & SF_DATALESS) !== 0;
}
export function classifySaveAs(input) {
    const { session, publish, facts, documents } = input;
    const blocked = (reason) => ({ status: 'blocked', reason });
    if (publish === 'invalid')
        return blocked('The publish record is unreadable.');
    if (!facts.parentMatches)
        return blocked('The output directory is not the one this save-as recorded.');
    if (facts.staging.state === 'other')
        return blocked('The staging path is not a directory.');
    const stagedName = basename(session.stagedPath);
    if (facts.staging.state === 'directory' && (facts.staging.entries.some((name) => !sameFilePath(name, stagedName)) || facts.staging.entries.filter((name) => sameFilePath(name, stagedName)).length > 1)) {
        return blocked('The staging directory holds other entries.');
    }
    const onStaged = documents.filter((document) => sameFilePath(document.path, session.stagedPath));
    const onOutput = documents.filter((document) => sameFilePath(document.path, session.outputPath));
    if (onStaged.length > 1 || onOutput.length > 1)
        return blocked('More than one open document uses the staged file or the output.');
    if (facts.staged.state === 'present' && !facts.staged.isFile)
        return blocked('The staged path is not a regular file.');
    if (publish === null) {
        if (facts.staged.state === 'absent') {
            return onStaged.length === 0 ? { status: 'not_started' } : blocked('A document points at a staged file that does not exist.');
        }
        if (facts.staged.nlink !== 1n)
            return blocked('The unpublished staged file has another link.');
        return { status: 'saved_not_published', reason: 'The staged file was saved but never published.' };
    }
    if (facts.staging.state === 'directory' &&
        (publish.stagingDirectory.dev !== facts.staging.dev.toString() || publish.stagingDirectory.ino !== facts.staging.ino.toString())) {
        return blocked('The staging directory is not the one this save-as recorded.');
    }
    const publishedInode = (observation) => observation.dev.toString() === publish.staged.dev && observation.ino.toString() === publish.staged.ino;
    const outputPublished = facts.output.state === 'present' && facts.output.isFile && publishedInode(facts.output);
    if (!outputPublished) {
        if (facts.staged.state === 'present' && publishedInode(facts.staged) && facts.staged.nlink === 1n) {
            return { status: 'saved_not_published', reason: facts.output.state === 'present' ? 'The output path holds another file; it was not published.' : 'The output was never published.' };
        }
        return blocked(facts.output.state === 'present' ? 'The output is not the file this save-as published.' : 'Neither the output nor the staged file matches the publish record.');
    }
    if (outputIsDataless(facts))
        return { status: 'output_not_local' };
    if (facts.output.state !== 'present' || facts.output.size !== BigInt(publish.staged.bytes) ||
        facts.output.mtimeNs.toString() !== publish.staged.mtimeNs || input.outputSha256 !== publish.staged.sha256) {
        return blocked('The published output no longer has the recorded content.');
    }
    if (facts.staged.state === 'present') {
        if (!publishedInode(facts.staged) || facts.staged.nlink !== 2n)
            return blocked('The staged name is not the second link of the published output.');
        if (onStaged.length === 1) {
            if (onOutput.length > 0)
                return blocked('Documents use both the staged file and the output.');
            const document = onStaged[0];
            if (keyWithoutIndex(document.key) === keyWithoutIndex(publish.savedDocumentKey))
                return { status: 'published_document_on_staging', document };
            if (!document.saved)
                return { status: 'document_modified', document };
            return blocked('The document on the staged file differs from the one that was saved (it was saved again or replaced).');
        }
        return { status: 'published_staging_left' };
    }
    if (onStaged.length > 0)
        return blocked('A document points at a staged file that no longer exists.');
    return facts.staging.state === 'directory' ? { status: 'published_staging_left' } : { status: 'released' };
}
