import { mixedSnapshotResultPairs as sharedMixedSnapshotResultPairs, snapshotJsonBytes, snapshotResultBytes, SNAPSHOT_RESULT_ADMISSION_BYTES, } from './snapshot-result-size.js';
import { decodeRecordedRuns, snapshotUnitCount } from './text-recorded-runs.js';
export function mixedSnapshotResultPairs(documentKey, steps, fromApply = false) {
    const pairs = sharedMixedSnapshotResultPairs(documentKey, steps, fromApply);
    steps.forEach((entry, index) => {
        const step = entry;
        if (step.operation !== 'set_text_style')
            return;
        const before = fromApply ? step.expectedBefore : step.plan.before, after = fromApply ? step.confirmedAfter : step.plan.after;
        pairs[index].terminalBytes = Math.max(snapshotJsonBytes(decodeRecordedRuns(before)), snapshotJsonBytes(decodeRecordedRuns(after)));
    });
    return pairs;
}
export function batchResultFit(documentKey, steps) {
    const estimateOf = (count) => snapshotResultBytes(documentKey, mixedSnapshotResultPairs(documentKey, steps.slice(0, count)));
    let fitSteps = steps.length;
    while (fitSteps > 0 && estimateOf(fitSteps) > SNAPSHOT_RESULT_ADMISSION_BYTES)
        fitSteps -= 1;
    let fitCharacters = 0;
    for (const entry of steps.slice(0, fitSteps)) {
        const step = entry;
        if (step.operation === 'set_text_style')
            fitCharacters += snapshotUnitCount(step.plan.before);
    }
    return { estimate: estimateOf(steps.length), limit: SNAPSHOT_RESULT_ADMISSION_BYTES, steps: steps.length, fitSteps, fitCharacters };
}
export function batchResultFitMessage(fit) {
    const en = `Estimated stored result: ${fit.estimate} UTF-8 bytes; limit ${fit.limit}. `
        + (fit.fitSteps === 0 ? 'Not even the first step fits. '
            : `The first ${fit.fitSteps} of ${fit.steps} steps (${fit.fitCharacters} characters of set_text_style steps) fit: create a new plan with at most that many steps, or with fewer distinct character styles per frame. `);
    const ja = `保存結果の見積りは ${fit.estimate} バイトで、上限は ${fit.limit} です。`
        + (fit.fitSteps === 0 ? '先頭の 1 step も入りません。'
            : `先頭 ${fit.fitSteps} step（全 ${fit.steps} step 中、set_text_style の ${fit.fitCharacters} 文字）までなら入ります。その step 数以下、または枠ごとの異なる文字書式を減らして、改めて plan を作ってください。`);
    return `${en}${ja}`;
}
