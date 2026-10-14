import { mutationAuditSchema } from './mutation-result-schema-core.js';
const EXPECTED_PREFIX = [
    ['preflight', 'started', null],
    ['preflight', 'succeeded', null],
    ['plan', 'started', null],
    ['plan', 'succeeded', null],
];
function expectedAudit(transaction) {
    if (transaction.state === 'planned') {
        return [
            ...EXPECTED_PREFIX,
            ['apply', 'skipped', 'not_requested'],
            ['verify', 'skipped', 'not_requested'],
            ['rollback', 'skipped', 'not_requested'],
        ];
    }
    if (transaction.state === 'verified') {
        return [
            ...EXPECTED_PREFIX,
            ['apply', 'started', null],
            ['apply', 'attempted', null],
            ['apply', 'succeeded', null],
            ['verify', 'started', null],
            ['verify', 'succeeded', null],
            ['rollback', 'skipped', 'not_required'],
        ];
    }
    if (transaction.state === 'apply_failed') {
        return [
            ...EXPECTED_PREFIX,
            ['apply', 'started', null],
            ['apply', 'failed', 'apply_failed'],
            ['verify', 'skipped', 'not_required'],
            ['rollback', 'skipped', 'not_required'],
        ];
    }
    if (transaction.state === 'apply_indeterminate') {
        return [
            ...EXPECTED_PREFIX,
            ['apply', 'started', null],
            ['apply', 'attempted', null],
            ['apply', 'failed', 'apply_indeterminate'],
        ];
    }
    const failureEvents = transaction.failure?.phase === 'apply'
        ? [
            ['apply', 'started', null],
            ['apply', 'attempted', null],
            ['apply', 'failed', 'apply_failed'],
            ['verify', 'skipped', 'not_required'],
        ]
        : [
            ['apply', 'started', null],
            ['apply', 'attempted', null],
            ['apply', 'succeeded', null],
            ['verify', 'started', null],
            ['verify', 'failed', 'verify_mismatch'],
        ];
    const rollbackResult = transaction.state === 'rolled_back'
        ? ['rollback', 'succeeded', null]
        : ['rollback', 'failed', transaction.state === 'rollback_failed' ? 'rollback_failed' : 'rollback_indeterminate'];
    return [...EXPECTED_PREFIX, ...failureEvents, ['rollback', 'started', null], rollbackResult];
}
export function auditConsistentWithTerminal(transaction) {
    const issues = [];
    const compact = transaction.audit.map((event) => [event.phase, event.event, event.reasonCode ?? null]);
    const expected = expectedAudit(transaction);
    if (compact.length !== expected.length || compact.some((entry, index) => entry[0] !== expected[index]?.[0] || entry[1] !== expected[index]?.[1] || entry[2] !== expected[index]?.[2])) {
        issues.push({ message: 'Mutation audit sequence does not match transaction state.', path: ['audit'] });
    }
    for (let index = 0; index < transaction.audit.length; index++) {
        if (transaction.audit[index]?.sequence !== index) {
            issues.push({ message: 'Mutation audit sequence numbers must be contiguous.', path: ['audit', index, 'sequence'] });
        }
    }
    if (transaction.failure !== undefined) {
        const failure = transaction.failure;
        const matching = transaction.audit.filter((event) => event.event === 'failed' &&
            event.phase === failure.phase && event.reasonCode === failure.reasonCode);
        if (matching.length !== 1 || matching[0]?.message !== failure.message) {
            issues.push({ message: 'Transaction failure summary must exactly match its audit failure event.', path: ['failure', 'message'] });
        }
    }
    if ((transaction.state === 'rollback_failed' || transaction.state === 'rollback_indeterminate') && transaction.rollback !== undefined) {
        const rollback = transaction.rollback;
        const matching = transaction.audit.filter((event) => event.event === 'failed' &&
            event.phase === 'rollback' && event.reasonCode === rollback.reasonCode);
        if (matching.length !== 1 || matching[0]?.message !== rollback.message) {
            issues.push({ message: 'Rollback summary must exactly match its audit failure event.', path: ['rollback', 'message'] });
        }
    }
    if (transaction.state === 'apply_indeterminate' && transaction.rollback?.message !== transaction.failure?.message) {
        issues.push({
            message: 'Indeterminate apply summaries must describe the same identity-unavailable outcome.',
            path: ['rollback', 'message'],
        });
    }
    return issues;
}
const TERMINAL_STATES = new Set([
    'planned', 'verified', 'apply_failed', 'rolled_back', 'rollback_failed', 'apply_indeterminate', 'rollback_indeterminate',
]);
const FAILURE_STATES = new Set(['apply_failed', 'rolled_back', 'rollback_failed', 'apply_indeterminate', 'rollback_indeterminate']);
const ROLLBACK_STATES = new Set(['rolled_back', 'rollback_failed', 'apply_indeterminate', 'rollback_indeterminate']);
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function transactionAuditMismatch(transaction) {
    if (!isRecord(transaction) || typeof transaction.state !== 'string' || !TERMINAL_STATES.has(transaction.state)) {
        return 'The transaction state is missing or unknown.';
    }
    const audit = mutationAuditSchema.safeParse(transaction.audit);
    if (!audit.success)
        return 'The audit trail is not a valid mutation audit.';
    const failure = transaction.failure;
    const rollback = transaction.rollback;
    if (FAILURE_STATES.has(transaction.state) && (!isRecord(failure) || typeof failure.phase !== 'string' ||
        typeof failure.reasonCode !== 'string' || typeof failure.message !== 'string')) {
        return 'The failure summary is missing for a failed terminal state.';
    }
    if (ROLLBACK_STATES.has(transaction.state) && !isRecord(rollback))
        return 'The rollback summary is missing.';
    const summary = { state: transaction.state, audit: audit.data };
    if (isRecord(failure))
        summary.failure = failure;
    if (isRecord(rollback))
        summary.rollback = rollback;
    const issues = auditConsistentWithTerminal(summary);
    return issues[0]?.message ?? null;
}
export function auditMismatchInResult(resultText) {
    let data;
    try {
        data = JSON.parse(resultText).data;
    }
    catch {
        return true;
    }
    return !isRecord(data) || transactionAuditMismatch(data.transaction) !== null;
}
