export class HostProcessExitError extends Error {
    exitCode;
    signal;
    killed;
    constructor(message, exitCode, signal, killed) {
        super(message);
        this.exitCode = exitCode;
        this.signal = signal;
        this.killed = killed;
        this.name = 'HostProcessExitError';
    }
}
