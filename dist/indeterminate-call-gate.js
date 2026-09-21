import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
export class IndeterminateCallBlockedError extends Error {
    details;
    constructor(details) {
        super(`Illustrator calls are blocked after indeterminate operation ${JSON.stringify(details.operation)}.`);
        this.details = details;
        this.name = 'IndeterminateCallBlockedError';
    }
}
function errorField(error, field) {
    return typeof error === 'object' && error !== null && field in error
        ? error[field]
        : undefined;
}
function reasonCode(error) {
    if (errorField(error, 'code') === 'ETIMEDOUT')
        return 'ETIMEDOUT';
    if (errorField(error, 'killed') === true)
        return 'KILLED';
    if (typeof errorField(error, 'signal') === 'string' && errorField(error, 'signal') !== '')
        return 'SIGNAL';
    if (errorField(error, 'name') === 'IndeterminateExecutionError')
        return 'INDETERMINATE_EXECUTION';
    return null;
}
export function isIndeterminateIllustratorError(error) {
    return reasonCode(error) !== null;
}
export class IndeterminateCallGate {
    context;
    details = null;
    constructor(context) {
        this.context = context;
    }
    get blocked() {
        return this.details !== null;
    }
    async call(operation, callback) {
        if (this.details !== null)
            throw new IndeterminateCallBlockedError(this.details);
        try {
            return await callback();
        }
        catch (error) {
            const classified = reasonCode(error);
            if (classified !== null)
                this.details = this.describe(operation, classified, error);
            throw error;
        }
    }
    async finalize(options) {
        if (this.details !== null)
            return await this.retainIndeterminate(options.fixtureOpened);
        if (!options.fixtureOpened) {
            this.context.diagnostic?.(`Live fixture was not confirmed open; retained ${this.context.artifactRoot}.\n`);
            return { exitCode: 1, cleaned: false, fixtureRetained: true, reconciliationPath: null };
        }
        try {
            await this.call('fixture_cleanup', options.cleanup);
        }
        catch (error) {
            if (this.details !== null)
                return await this.retainIndeterminate(true);
            this.context.diagnostic?.(`Live fixture cleanup failed; retained ${this.context.artifactRoot}. ${error instanceof Error ? error.message : String(error)}\n`);
            return { exitCode: 1, cleaned: false, fixtureRetained: true, reconciliationPath: null };
        }
        await options.removeArtifacts();
        return { exitCode: 0, cleaned: true, fixtureRetained: false, reconciliationPath: null };
    }
    describe(operation, classified, error) {
        return {
            operation,
            reasonCode: classified,
            errorName: typeof errorField(error, 'name') === 'string' ? errorField(error, 'name') : 'Error',
            message: error instanceof Error ? error.message : String(error),
            commandId: typeof errorField(error, 'commandId') === 'string' ? errorField(error, 'commandId') : null,
            code: typeof errorField(error, 'code') === 'string' ? errorField(error, 'code') : null,
            exitCode: typeof errorField(error, 'exitCode') === 'number' ? errorField(error, 'exitCode') : null,
            signal: typeof errorField(error, 'signal') === 'string' ? errorField(error, 'signal') : null,
            killed: errorField(error, 'killed') === true,
        };
    }
    async retainIndeterminate(fixtureOpened) {
        const reconciliationPath = join(this.context.artifactRoot, 'reconciliation.json');
        const reconciliation = {
            version: 1,
            state: 'indeterminate',
            application: this.context.application,
            artifactRoot: this.context.artifactRoot,
            documentPath: this.context.documentPath,
            fixtureOpened,
            cleanupSkipped: true,
            indeterminateOperation: this.details,
            nextAction: this.details?.commandId
                ? 'Reconcile the recorded command ID before any further Illustrator call.'
                : 'Confirm the terminated osascript process and Illustrator document state before any further Illustrator call.',
        };
        await this.writeReconciliation(reconciliationPath, reconciliation);
        this.context.diagnostic?.(`Illustrator outcome is indeterminate; cleanup skipped. Retained ${this.context.artifactRoot} and ${reconciliationPath}.\n`);
        return { exitCode: 1, cleaned: false, fixtureRetained: true, reconciliationPath };
    }
    async writeReconciliation(path, reconciliation) {
        const temporaryPath = join(this.context.artifactRoot, `.reconciliation.${randomUUID()}.tmp`);
        const handle = await open(temporaryPath, 'wx', 0o600);
        try {
            await handle.chmod(0o600);
            await handle.writeFile(`${JSON.stringify(reconciliation, null, 2)}\n`, 'utf8');
            await handle.sync();
        }
        finally {
            await handle.close();
        }
        try {
            await rename(temporaryPath, path);
            const directory = await open(this.context.artifactRoot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
            try {
                await directory.sync();
            }
            finally {
                await directory.close();
            }
        }
        finally {
            await unlink(temporaryPath).catch((error) => {
                if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'))
                    throw error;
            });
        }
    }
}
