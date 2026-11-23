export class IndeterminateExecutionError extends Error {
    commandId;
    code;
    exitCode;
    signal;
    killed;
    constructor(message, commandId, details = {}) {
        super(message);
        this.commandId = commandId;
        this.name = 'IndeterminateExecutionError';
        this.code = details.code ?? null;
        this.exitCode = details.exitCode ?? null;
        this.signal = details.signal ?? null;
        this.killed = details.killed ?? false;
    }
}
export class CommandReleasedUnverifiedError extends Error {
    commandId;
    code = 'COMMAND_RELEASED_UNVERIFIED';
    constructor(commandId, detail) {
        super(`Command ${commandId} was released without verification and will never be replayed or reapplied; ` +
            'the document state after it is unknown. Check the document in Illustrator, read it again, and plan any ' +
            `change again with a new command_id.${detail === undefined ? '' : ` ${detail}`}`);
        this.commandId = commandId;
        this.name = 'CommandReleasedUnverifiedError';
    }
}
export class CommandQuarantinedError extends Error {
    commandId;
    code = 'COMMAND_QUARANTINED';
    constructor(commandId) {
        super(`Command ${commandId} is quarantined and will never be replayed or reapplied. Its state was moved under ` +
            'quarantine/ in the state root. Check the document before sending the same change again with a new command_id.');
        this.commandId = commandId;
        this.name = 'CommandQuarantinedError';
    }
}
export class CommandReleasedAsOrphanError extends Error {
    commandId;
    code = 'COMMAND_RELEASED_AS_ORPHAN';
    constructor(commandId) {
        super(`Command ${commandId} never started: its lock was released after its server stopped before the command was created, ` +
            'and the id is closed for good. Nothing reached Illustrator. Resolve the unresolved backup, export, or save-as session ' +
            'with its reconcile tool, then send the request again with a new command_id.');
        this.commandId = commandId;
        this.name = 'CommandReleasedAsOrphanError';
    }
}
export class ProvenPreApplyFailureError extends Error {
    commandId;
    hostMessage;
    audit;
    refusal;
    code = 'PROVEN_PRE_APPLY_FAILURE';
    constructor(commandId, hostMessage = null, audit = null, refusal = null) {
        super(refusal === null
            ? `Command ${commandId} failed before the side-effect attempt boundary and will not be reapplied.`
            : `Command ${commandId} was refused by the ${refusal.phase} check (${refusal.reasonCode})` +
                `${refusal.reason === null ? '.' : `: ${refusal.reason}`} Nothing was written, and this ` +
                'command_id will not be reapplied. Read the target again with apply:false to get a new plan, then apply ' +
                'that plan with a new command_id.');
        this.commandId = commandId;
        this.hostMessage = hostMessage;
        this.audit = audit;
        this.refusal = refusal;
        this.name = 'ProvenPreApplyFailureError';
    }
}
export class DocumentMismatchError extends Error {
    constructor(expected, actual) {
        super(`Active document changed. Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
        this.name = 'DocumentMismatchError';
    }
}
export class InvalidCursorError extends Error {
    constructor(message = 'The object-list cursor is invalid for this request.') {
        super(message);
        this.name = 'InvalidCursorError';
    }
}
export class StaleCursorError extends Error {
    constructor(message = 'The object-list cursor is stale because the Illustrator document changed.') {
        super(message);
        this.name = 'StaleCursorError';
    }
}
export const HOST_REFERENCE_INVALID_CODE = 'ILLUSTRATOR_HOST_REFERENCE_INVALID';
export function hostReferenceInvalidReason(detail) {
    const where = [
        typeof detail.uuid === 'string' ? `UUID ${JSON.stringify(detail.uuid)}` : null,
        typeof detail.route === 'string' ? `route ${detail.route}` : null,
        typeof detail.index === 'number' ? `index ${detail.index}` : null,
    ].filter((part) => part !== null).join(', ');
    const host = detail.hostError ?? null;
    const hostError = host === null ? '' : ` (${[host.name, host.number].filter((part) => part !== null && part !== undefined).join(' ')})`;
    const absence = typeof detail.absenceUnproved === 'string'
        ? ` The lookup found no item, but absence is unproved (${detail.absenceUnproved}): an item that cannot be read is still in the document.`
        : '';
    return `${HOST_REFERENCE_INVALID_CODE}: Illustrator returned an invalid object reference${where === '' ? '' : ` at ${where}`}` +
        `${hostError}.${absence} It is not treated as absent, skipped, or retried; tell the user before continuing.`;
}
export function hostReferenceInvalidDetail(message) {
    if (typeof message !== 'string' || !message.startsWith('MCP_ERROR:'))
        return null;
    let parsed;
    try {
        parsed = JSON.parse(message.slice('MCP_ERROR:'.length));
    }
    catch {
        return null;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        return null;
    const { code, ...detail } = parsed;
    return code === HOST_REFERENCE_INVALID_CODE ? detail : null;
}
export class HostReferenceInvalidError extends Error {
    detail;
    code = HOST_REFERENCE_INVALID_CODE;
    constructor(detail) {
        super(hostReferenceInvalidReason(detail));
        this.detail = detail;
        this.name = 'HostReferenceInvalidError';
    }
}
export class ReadScanLimitError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'ReadScanLimitError';
    }
}
export class ObjectAttributeUnreadableError extends Error {
    attribute;
    hostErrorNumber;
    code = 'OBJECT_ATTRIBUTE_UNREADABLE';
    constructor(attribute, hostErrorNumber) {
        super(`Illustrator could not read "${attribute}"${hostErrorNumber === null ? '' : ` (error ${hostErrorNumber})`} of this object, so it cannot be described. ` +
            'Nothing was changed. Do not treat the object as absent or skip it silently: tell the user which object could not be read.');
        this.attribute = attribute;
        this.hostErrorNumber = hostErrorNumber;
        this.name = 'ObjectAttributeUnreadableError';
    }
}
export class ObjectNotFoundError extends Error {
    constructor(uuid) {
        super(`No PageItem with UUID ${JSON.stringify(uuid)} exists in the bound document.`);
        this.name = 'ObjectNotFoundError';
    }
}
export { RECTANGLE_BOUNDS_PRECISION_DIGITS, RECTANGLE_BOUNDS_TOLERANCE_PT, RectangleTargetError, } from './adapters/create-rectangle/domain.js';
