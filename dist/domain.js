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
export class ObjectNotFoundError extends Error {
    constructor(uuid) {
        super(`No PageItem with UUID ${JSON.stringify(uuid)} exists in the bound document.`);
        this.name = 'ObjectNotFoundError';
    }
}
export { RECTANGLE_BOUNDS_PRECISION_DIGITS, RECTANGLE_BOUNDS_TOLERANCE_PT, RectangleTargetError, } from './adapters/create-rectangle/domain.js';
