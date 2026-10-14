export const BATCH_HOST_HOOKS = ['resolve', 'plan', 'same', 'apply', 'verify', 'rollback', 'checkExpected', 'revalidate'];
const REQUIRED_HOST_HOOKS = ['resolve', 'plan', 'same', 'apply', 'verify', 'rollback'];
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/u;
const COMMON_INTERNAL_FIELDS = ['operation', 'targetUuid'];
export function defineBatchStep(step) {
    const label = step.operation || '(unnamed)';
    if (!step.operation || !step.admittedProfile)
        throw new Error(`A batch step needs an operation and a measured profile: ${label}.`);
    for (const [name, object] of Object.entries({ publicPlan: step.publicPlan, publicApply: step.publicApply,
        internalPlan: step.internalPlan, internalApply: step.internalApply })) {
        const operation = object.shape.operation;
        if (operation?.value !== step.operation)
            throw new Error(`Batch step ${label}.${name} must discriminate on its own operation.`);
    }
    const sources = step.host.fragments.map((fragment) => fragment.source).join('\n');
    for (const hook of REQUIRED_HOST_HOOKS) {
        if (step.host.hooks[hook] === undefined)
            throw new Error(`Missing batch host hook: ${label}.${hook}.`);
    }
    for (const hook of BATCH_HOST_HOOKS) {
        const expression = step.host.hooks[hook];
        if (expression === undefined)
            continue;
        if (IDENTIFIER.test(expression)) {
            if (!sources.includes(`function ${expression}(`))
                throw new Error(`Batch host hook ${label}.${hook} names an undeclared function ${expression}.`);
        }
        else if (!/^function\b/u.test(expression) || (expression.includes('\n') && !/\n\}$/u.test(expression))) {
            throw new Error(`Batch host hook ${label}.${hook} must be a function name or a function expression closed on its own line.`);
        }
    }
    if (step.host.dispatchLayout !== undefined &&
        collapseWhitespace(step.host.dispatchLayout) !== collapseWhitespace(derivedDispatchRow(step))) {
        throw new Error(`Batch step ${label} dispatch layout does not name exactly its host hooks.`);
    }
    const fields = Object.keys(step.internalPlan.shape).filter((key) => !COMMON_INTERNAL_FIELDS.includes(key));
    const copied = new Set(step.host.paramFields);
    if (step.host.paramFields.some((field) => !IDENTIFIER.test(field)) || copied.size !== step.host.paramFields.length ||
        fields.length !== copied.size || fields.some((field) => !copied.has(field))) {
        throw new Error(`Batch step ${label} host params must copy exactly its internal request fields.`);
    }
    return Object.freeze(step);
}
const collapseWhitespace = (text) => text.replace(/\s+/gu, ' ').trim();
export function emitBatchHostDispatchRow(step) {
    return step.host.dispatchLayout ?? derivedDispatchRow(step);
}
function derivedDispatchRow(step) {
    const lines = [];
    let named = [];
    const flush = () => { if (named.length > 0)
        lines.push(named.join(', ')); named = []; };
    for (const hook of BATCH_HOST_HOOKS) {
        const expression = step.host.hooks[hook];
        if (expression === undefined)
            continue;
        if (IDENTIFIER.test(expression))
            named.push(`${hook}: ${expression}`);
        else {
            flush();
            lines.push(`${hook}: ${expression}`);
        }
    }
    flush();
    return `  ${step.operation}: {\n${lines.map((line) => `    ${line.replaceAll('\n', '\n    ')}`).join(',\n')}\n  }`;
}
export function emitBatchHostParamsBranch(step, first) {
    const copies = step.host.paramFields.map((field) => `step.${field} = request.${field};`);
    const body = copies.length === 1 ? copies[0] : `{ ${copies.join(' ')} }`;
    return `${first ? 'if' : 'else if'} (request.operation === ${JSON.stringify(step.operation)}) ${body}`;
}
export function assembleHostFragments(regions, steps) {
    const ordered = regions.flat();
    const positions = new Map();
    ordered.forEach((fragment, index) => {
        if (positions.has(fragment.id))
            throw new Error(`Duplicate host fragment: ${fragment.id}.`);
        positions.set(fragment.id, index);
    });
    if (new Set(ordered.map((fragment) => fragment.source)).size !== ordered.length) {
        throw new Error('Two host fragments carry the same source; each fragment must be emitted once.');
    }
    for (const step of steps) {
        let previous = -1;
        for (const fragment of step.host.fragments) {
            const position = positions.get(fragment.id);
            if (position === undefined)
                throw new Error(`Unplaced host fragment for ${step.operation}: ${fragment.id}.`);
            if (ordered[position].source !== fragment.source)
                throw new Error(`Conflicting host fragment: ${fragment.id}.`);
            if (position <= previous)
                throw new Error(`Host fragment ${fragment.id} is out of ${step.operation}'s dependency order.`);
            previous = position;
        }
    }
    return regions.map((region) => region.map((fragment) => fragment.source).join('\n'));
}
export function reportedStepBlockers(step, plan) {
    return step.reportedBlockers ? step.reportedBlockers(plan) : plan.applyBlockedReasonCodes ?? [];
}
export function stepPlanBinding(step, plan) {
    if (step.binding)
        return step.binding(plan);
    const record = plan;
    return { targetUuid: record.before?.uuid ?? '', documentKey: record.documentKey ?? '', confirmationStatus: record.confirmationStatus ?? '' };
}
export function stepSnapshotUuid(step, snapshot) {
    if (step.snapshotTargetUuid)
        return step.snapshotTargetUuid(snapshot);
    const record = snapshot;
    return record.target !== undefined ? record.target.uuid ?? '' : record.uuid ?? '';
}
export function inPinnedOrder(steps, pinned) {
    const named = pinned.map((operation) => {
        const step = steps.find((candidate) => candidate.operation === operation);
        if (step === undefined)
            throw new Error(`Pinned order names an unregistered batch step: ${operation}.`);
        return step;
    });
    return [...named, ...steps.filter((step) => !pinned.includes(step.operation))];
}
