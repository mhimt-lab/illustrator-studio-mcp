import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createPrivateFileExclusive, ensurePrivateDirectory, ensurePrivateStateRoot, withPrivateDirectoryScope } from './private-state.js';
export const IMAGE_OPTIMIZE_EVIDENCE_DIRECTORY = 'image-optimize-evidence';
export const IMAGE_OPTIMIZE_EVIDENCE_MAX_ENTRIES = 8;
export const IMAGE_OPTIMIZE_EVIDENCE_MAX_ENTRY_BYTES = 32 * 1024 * 1024;
export class ImageOptimizeEvidenceError extends Error {
    directory;
    constructor(message, directory = null) {
        super(message);
        this.directory = directory;
        this.name = 'ImageOptimizeEvidenceError';
    }
}
export async function retainImageOptimizeEvidence(stateRoot, input) {
    const entries = [
        ['before.png', input.before], ['after.png', input.after],
        ...(input.diff === undefined ? [] : [['diff.png', input.diff]]),
        ['summary.json', Buffer.from(JSON.stringify(input.summary, null, 2) + '\n')],
    ];
    if (entries.reduce((bytes, [, content]) => bytes + content.length, 0) > IMAGE_OPTIMIZE_EVIDENCE_MAX_ENTRY_BYTES) {
        throw new ImageOptimizeEvidenceError(`Render evidence exceeds ${IMAGE_OPTIMIZE_EVIDENCE_MAX_ENTRY_BYTES} bytes per entry.`);
    }
    await ensurePrivateStateRoot(stateRoot);
    const root = join(stateRoot, IMAGE_OPTIMIZE_EVIDENCE_DIRECTORY);
    await ensurePrivateDirectory(root, 'image optimization evidence root');
    return await withPrivateDirectoryScope([
        { path: stateRoot, description: 'state root' }, { path: root, description: 'image optimization evidence root' },
    ], async (rootScope) => {
        for (let index = 1; index <= IMAGE_OPTIMIZE_EVIDENCE_MAX_ENTRIES; index++) {
            const directory = join(root, `slot-${index}`);
            await rootScope.assertStable();
            try {
                await mkdir(directory, { mode: 0o700 });
            }
            catch (error) {
                if (error.code === 'EEXIST')
                    continue;
                throw error;
            }
            try {
                await withPrivateDirectoryScope([{ path: directory, description: 'render evidence entry' }], async (scope) => {
                    for (const [name, bytes] of entries) {
                        await rootScope.assertStable();
                        await scope.assertStable();
                        const handle = await createPrivateFileExclusive(join(directory, name));
                        try {
                            await handle.writeFile(bytes);
                        }
                        finally {
                            await handle.close();
                        }
                    }
                });
                await rootScope.assertStable();
                return directory;
            }
            catch (error) {
                throw new ImageOptimizeEvidenceError(`Render evidence is incomplete: ${error instanceof Error ? error.message : String(error)}`, directory);
            }
        }
        throw new ImageOptimizeEvidenceError(`Render evidence quota is full (${IMAGE_OPTIMIZE_EVIDENCE_MAX_ENTRIES} entries); remove an inspected entry to retain another comparison.`);
    });
}
