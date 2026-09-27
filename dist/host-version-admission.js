import { z } from 'zod';
import { evaluateHostVersion, HOST_VERSION_POLICY, hostVersionAdmitted } from './host-version-policy.js';
export const hostVersionNoteSchema = z.record(z.string(), z.unknown());
export class HostVersionChannelRefusedError extends Error {
    note;
    code = 'HOST_VERSION_PATCH_CHANNEL_UNMEASURED';
    constructor(note) {
        super(`HOST_VERSION_PATCH_CHANNEL_UNMEASURED: Illustrator ${note.app} is a patch of the measured ${note.measured}, but patch versions are admitted only on the `
            + `stable channel and this target's channel is ${note.channel ?? 'unknown'}. Nothing was changed.`);
        this.note = note;
        this.name = 'HostVersionChannelRefusedError';
    }
}
export function admitHostVersionPlan(operation, appVersion, channel, consent) {
    const evaluation = evaluateHostVersion(operation, appVersion);
    if (HOST_VERSION_POLICY.operations[operation].kind === 'read')
        return evaluation.status === 'measured' ? null : { ...evaluation, status: evaluation.status };
    if (consent?.acceptUnmeasuredHostVersion !== undefined && hostVersionAdmitted(operation, appVersion, consent) && evaluation.status === 'unmeasured')
        return { ...evaluation, status: 'unmeasured_consented', channel: 'stable' };
    if (evaluation.status === 'measured')
        return null;
    if (evaluation.status === 'patch_unmeasured' && channel !== 'stable') {
        throw new HostVersionChannelRefusedError({ ...evaluation, status: 'patch_channel_unmeasured', channel: channel ?? 'unknown' });
    }
    return { ...evaluation, status: evaluation.status };
}
export function describeHostVersionScope(operation) {
    const byMinor = new Map();
    for (const version of HOST_VERSION_POLICY.operations[operation].measured) {
        const minor = version.split('.').slice(0, 2).join('.');
        byMinor.set(minor, [...(byMinor.get(minor) ?? []), version]);
    }
    return [...byMinor].map(([minor, versions]) => `${minor}.x (measured ${versions.join(', ')})`).join(', ');
}
