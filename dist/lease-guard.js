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
export class LeaseGuard {
    backupStore;
    exportStore;
    constructor(backupStore, exportStore) {
        this.backupStore = backupStore;
        this.exportStore = exportStore;
    }
    async assertNoUnresolvedSession() {
        const [backupIds, exportIds] = await Promise.all([this.backupStore.listSessions(), this.exportStore.listSessions()]);
        if (backupIds.length > 0 && exportIds.length > 0)
            throw new UnresolvedLeaseError(backupIds, exportIds);
        if (backupIds.length > 0)
            throw new BackupSessionUnresolvedError(backupIds);
        if (exportIds.length > 0)
            throw new ExportSessionUnresolvedError(exportIds);
    }
}
