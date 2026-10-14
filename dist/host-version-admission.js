import { z } from 'zod';
import { evaluateHostVersion, HOST_VERSION_POLICY } from './host-version-policy.js';
export const hostVersionNoteSchema = z.record(z.string(), z.unknown());
export class HostVersionChannelRefusedError extends Error {
    note;
    code;
    constructor(note) {
        const patch = note.status === 'patch_channel_unmeasured';
        super(`${patch ? 'HOST_VERSION_PATCH_CHANNEL_UNMEASURED' : 'HOST_VERSION_CHANNEL_UNMEASURED'}: Illustrator ${note.app} is ${patch ? `a patch of the measured ${note.measured}` : 'not a measured version'}, `
            + `and unmeasured versions are admitted only on the stable channel; this target's channel is ${note.channel ?? 'unknown'}. Nothing was changed.`);
        this.note = note;
        this.code = patch ? 'HOST_VERSION_PATCH_CHANNEL_UNMEASURED' : 'HOST_VERSION_CHANNEL_UNMEASURED';
        this.name = 'HostVersionChannelRefusedError';
    }
}
export function admitHostVersionPlan(operation, appVersion, channel, options = {}) {
    const evaluation = evaluateHostVersion(operation, appVersion);
    if (evaluation.status === 'measured')
        return null;
    const note = { ...evaluation, status: evaluation.status };
    if (HOST_VERSION_POLICY.operations[operation].kind === 'read')
        return note;
    if (evaluation.status !== 'patch_unmeasured' && evaluation.status !== 'unmeasured')
        return { ...note, channel: channel ?? 'unknown' };
    if (channel !== 'stable') {
        const refused = { ...note, status: evaluation.status === 'patch_unmeasured' ? 'patch_channel_unmeasured' : 'unmeasured_channel_refused', channel: channel ?? 'unknown' };
        if (options.refuse === true)
            throw new HostVersionChannelRefusedError(refused);
        return refused;
    }
    const backupRequired = evaluation.status === 'unmeasured' && operation !== 'optimize_images' && typeof options.documentPath === 'string';
    return { ...note, channel: 'stable', ...(backupRequired ? { backupRequired: true } : {}) };
}
export function describeHostVersionScope(operation) {
    const byMinor = new Map();
    for (const version of HOST_VERSION_POLICY.operations[operation].measured) {
        const minor = version.split('.').slice(0, 2).join('.');
        byMinor.set(minor, [...(byMinor.get(minor) ?? []), version]);
    }
    return [...byMinor].map(([minor, versions]) => `${minor}.x (measured ${versions.join(', ')})`).join(', ');
}
