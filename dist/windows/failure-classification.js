import { WINDOWS_RUNNER_EXIT, WINDOWS_RUNNER_STDERR_TOKEN } from './runner-exit-codes.js';
const KNOWN_HRESULTS = {
    '0x80010001': 'RPC_E_CALL_REJECTED',
    '0x8001010A': 'RPC_E_SERVERCALL_RETRYLATER',
};
const PRE_COM_EXITS = new Map([
    [WINDOWS_RUNNER_EXIT.goNonceMismatch, 'goNonceMismatch'],
    [WINDOWS_RUNNER_EXIT.sessionLocked, 'sessionLocked'],
    [WINDOWS_RUNNER_EXIT.sessionUnknown, 'sessionUnknown'],
    [WINDOWS_RUNNER_EXIT.illustratorNotSingle, 'illustratorNotSingle'],
    [WINDOWS_RUNNER_EXIT.activeObjectUnavailable, 'activeObjectUnavailable'],
]);
const KNOWN_TOKENS = new Set(Object.values(WINDOWS_RUNNER_STDERR_TOKEN));
const STDERR_LINE = /^(MCP_WIN_[A-Z_]+)(?: (0x[0-9A-F]{8}))?$/u;
export function parseWindowsRunnerStderr(stderr) {
    const lines = stderr.split(/\r?\n/u).filter((line) => line.trim() !== '');
    if (lines.length !== 1)
        return { token: null, hresult: null };
    const match = STDERR_LINE.exec(lines[0].trim());
    if (match === null || !KNOWN_TOKENS.has(match[1]))
        return { token: null, hresult: null };
    const token = match[1];
    const hresult = match[2] ?? null;
    const comToken = WINDOWS_RUNNER_STDERR_TOKEN.doJavaScriptFileComException;
    if ((token === comToken) !== (hresult !== null))
        return { token: null, hresult: null };
    return { token, hresult };
}
export function classifyWindowsRunnerTermination(termination) {
    const { token, hresult } = parseWindowsRunnerStderr(termination.stderr);
    const result = (outcome, reason) => ({
        outcome,
        reason,
        stderrToken: token,
        hresult,
        hresultName: hresult === null ? null : KNOWN_HRESULTS[hresult] ?? null,
    });
    if (termination.parentTimedOut)
        return result('indeterminate', 'parent_timeout');
    if (termination.signal !== null)
        return result('indeterminate', 'signal');
    if (!termination.readyObserved)
        return result('not_contacted_failure', 'exited_before_ready');
    const exitCode = termination.exitCode;
    if (exitCode === null || !Number.isInteger(exitCode))
        return result('indeterminate', 'no_exit_code');
    if (exitCode === WINDOWS_RUNNER_EXIT.hostReturned) {
        return token === null ? result('host_returned', 'host_returned') : result('indeterminate', 'stderr_token_mismatch');
    }
    if (exitCode === WINDOWS_RUNNER_EXIT.doJavaScriptFileComException) {
        return token === WINDOWS_RUNNER_STDERR_TOKEN.doJavaScriptFileComException
            ? result('indeterminate', 'com_exception')
            : result('indeterminate', 'stderr_token_mismatch');
    }
    const preCom = PRE_COM_EXITS.get(exitCode);
    if (preCom === undefined)
        return result('indeterminate', 'unknown_exit_code');
    return token === WINDOWS_RUNNER_STDERR_TOKEN[preCom]
        ? result('not_contacted_failure', 'pre_com_check_failed')
        : result('indeterminate', 'stderr_token_mismatch');
}
