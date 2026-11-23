import { isDeepStrictEqual } from 'node:util';
export const EVIDENCE_LINE_FIELDS = ['line_start', 'line_end', 'character', 'character_class', 'prev_line_tail', 'next_line_head'];
export function stableJson(value) {
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(',')}]`;
    if (typeof value === 'object' && value !== null) {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}
function compactEvidence(evidence) {
    if (!EVIDENCE_LINE_FIELDS.every((field) => evidence[field] === null))
        return evidence;
    const kept = {};
    for (const [key, value] of Object.entries(evidence)) {
        if (!EVIDENCE_LINE_FIELDS.includes(key))
            kept[key] = value;
    }
    return kept;
}
export function groupFindings(findings, nextCallOf) {
    const rules = [];
    const ruleIndex = new Map();
    const frames = [];
    const frameIndex = new Map();
    const states = [];
    const stateIndex = new Map();
    const groups = new Map();
    findings.forEach((finding, seq) => {
        const derived = nextCallOf(finding);
        if (!isDeepStrictEqual(derived, finding.next_call)) {
            throw new Error('The grouped form cannot carry this finding\'s next_call; it is not derived from its rule, frame and range.');
        }
        const rule = { rule_id: finding.rule_id, severity: finding.severity, determinism: finding.determinism,
            source_class: finding.source_class, source_ref: finding.source_ref, recommendation: finding.recommendation,
            can_auto_fix: finding.can_auto_fix, required_capability: finding.required_capability };
        const ruleKey = stableJson(rule);
        let ruleAt = ruleIndex.get(ruleKey);
        if (ruleAt === undefined) {
            ruleAt = rules.length;
            rules.push(rule);
            ruleIndex.set(ruleKey, ruleAt);
        }
        const frameKey = stableJson(finding.target);
        let frameAt = frameIndex.get(frameKey);
        if (frameAt === undefined) {
            frameAt = frames.length;
            frames.push(finding.target);
            frameIndex.set(frameKey, frameAt);
        }
        let stateAt = null;
        if (finding.current_state !== null) {
            const stateKey = stableJson(finding.current_state);
            stateAt = stateIndex.get(stateKey) ?? null;
            if (stateAt === null) {
                stateAt = states.length;
                states.push(finding.current_state);
                stateIndex.set(stateKey, stateAt);
            }
        }
        const evidence = compactEvidence(finding.evidence);
        const groupKey = stableJson([ruleAt, frameAt, stateAt, evidence]);
        let group = groups.get(groupKey);
        if (group === undefined) {
            group = { rule: ruleAt, frame: frameAt, state: stateAt, evidence, ranges: [] };
            groups.set(groupKey, group);
        }
        group.ranges.push([finding.range.start, finding.range.end, finding.line_index, seq]);
    });
    return { rules, frames, states, groups: [...groups.values()] };
}
export function expandGroupedFindings(grouped, nextCallOf) {
    const out = [];
    for (const group of grouped.groups) {
        const rule = grouped.rules[group.rule];
        const target = grouped.frames[group.frame];
        if (rule === undefined || target === undefined)
            throw new Error('A group refers to a rule or frame that the grouped findings do not list.');
        const state = group.state === null ? null : grouped.states[group.state];
        if (state === undefined)
            throw new Error('A group refers to a state that the grouped findings do not list.');
        const lineFields = Object.fromEntries(EVIDENCE_LINE_FIELDS.map((field) => [field, null]));
        for (const [start, end, line_index, seq] of group.ranges) {
            if (out[seq] !== undefined)
                throw new Error('Two ranges of the grouped findings have the same position.');
            const finding = { ...rule, target, range: { start, end }, line_index,
                evidence: { ...lineFields, ...group.evidence }, current_state: state };
            const nextCall = nextCallOf(finding);
            if (nextCall !== undefined)
                finding.next_call = nextCall;
            out[seq] = finding;
        }
    }
    for (let seq = 0; seq < out.length; seq += 1) {
        if (out[seq] === undefined)
            throw new Error('The positions of the grouped findings are not contiguous.');
    }
    return out;
}
