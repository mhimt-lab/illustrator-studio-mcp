import { BackupSessionUnresolvedError } from './document-backup.js';
import { ExportSessionUnresolvedError } from './document-export.js';
export class UnresolvedLeaseError extends Error {
    backupIds;
    exportIds;
    constructor(backupIds, exportIds) {
        super(`Unresolved backup session${backupIds.length === 1 ? '' : 's'} ${backupIds.join(', ')} and ` +
            `unresolved export session${exportIds.length === 1 ? '' : 's'} ${exportIds.join(', ')} block mutations. ` +
            'Run illustrator_reconcile_backup for each backup_id and illustrator_reconcile_export for each export_id before another mutation, backup, or export.');
        this.backupIds = backupIds;
        this.exportIds = exportIds;
        this.name = 'UnresolvedLeaseError';
    }
}
export class SaveAsSessionUnresolvedError extends ExportSessionUnresolvedError {
    backupIds;
    saveAsLeases;
    constructor(backupIds, exportIds, saveAsLeases) {
        super([...exportIds, ...saveAsLeases.map(([id]) => id)]);
        this.backupIds = backupIds;
        this.saveAsLeases = saveAsLeases;
        const running = saveAsLeases.filter(([, state]) => state === 'in_progress').map(([id]) => id);
        const unresolved = saveAsLeases.filter(([, state]) => state !== 'in_progress').map(([id]) => id);
        const parts = [];
        if (running.length > 0) {
            parts.push(`illustrator_save_document_as ${running.join(', ')} is still running in an MCP server process (possibly this one); wait for it to finish and retry.`);
        }
        if (unresolved.length > 0) {
            parts.push(`Unresolved save-as session${unresolved.length === 1 ? '' : 's'} ${unresolved.join(', ')}: run illustrator_reconcile_save_as with save_as_id for each.`);
        }
        if (exportIds.length > 0)
            parts.push(`Unresolved export session${exportIds.length === 1 ? '' : 's'} ${exportIds.join(', ')}: run illustrator_reconcile_export for each export_id.`);
        if (backupIds.length > 0)
            parts.push(`Unresolved backup session${backupIds.length === 1 ? '' : 's'} ${backupIds.join(', ')}: run illustrator_reconcile_backup for each backup_id.`);
        this.message = `${parts.join(' ')} Mutations, backups, exports and save-as stay blocked until then.`;
        this.name = 'SaveAsSessionUnresolvedError';
    }
}
export class LeaseGuard {
    backupStore;
    exportStore;
    saveAs;
    constructor(backupStore, exportStore, saveAs = null) {
        this.backupStore = backupStore;
        this.exportStore = exportStore;
        this.saveAs = saveAs;
    }
    async assertNoUnresolvedSession(options = {}) {
        const [backupIds, allExportIds] = await Promise.all([this.backupStore.listSessions(), this.exportStore.listSessions()]);
        const exportIds = allExportIds.filter((id) => id !== options.exceptSaveAsId);
        if (backupIds.length === 0 && exportIds.length === 0)
            return;
        const saveAs = this.saveAs !== null && exportIds.length > 0 ? await this.saveAs.describe(exportIds) : new Map();
        if (saveAs.size > 0) {
            throw new SaveAsSessionUnresolvedError(backupIds, exportIds.filter((id) => !saveAs.has(id)), [...saveAs]);
        }
        if (backupIds.length > 0 && exportIds.length > 0)
            throw new UnresolvedLeaseError(backupIds, exportIds);
        if (backupIds.length > 0)
            throw new BackupSessionUnresolvedError(backupIds);
        if (exportIds.length > 0)
            throw new ExportSessionUnresolvedError(exportIds);
    }
}
