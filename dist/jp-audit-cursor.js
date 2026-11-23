import { createHash } from 'node:crypto';
import { InvalidCursorError } from './domain.js';
import { stableJson } from './jp-audit-grouping.js';
export const AUDIT_CURSOR_KIND = 'audit_typography';
const sha256 = (value) => createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
export function auditRequestDigest(request) {
    return sha256({ ...request, policies: [...request.policies].sort(), lineStartRelaxations: [...request.lineStartRelaxations].sort(),
        protectedTerms: [...request.protectedTerms].sort(), justifyBody: request.justifyBody ?? null, paragraphShape: request.paragraphShape ?? null,
        latinBody: request.latinBody ?? null, settingProfile: request.settingProfile ?? null });
}
export function nextPageCharacters(shown, maximum) {
    if (shown.characters < 1)
        return null;
    const grow = shown.cut ? 1 : Math.min(4, 1 / Math.max(shown.fill, 0.25));
    return Math.min(maximum, Math.max(1, Math.ceil(shown.characters * grow)));
}
export function auditPageDigest(findings) {
    return sha256(findings);
}
export const PAGE_CHARACTERS_MAX = 20_000;
const HEX_64 = /^[0-9a-f]{64}$/u;
export function validateAuditCursor(value) {
    const invalid = () => new InvalidCursorError('The typography-audit cursor is invalid.');
    if (typeof value !== 'object' || value === null)
        throw invalid();
    const candidate = value;
    const keys = Object.keys(candidate).sort().join(',');
    if (keys !== 'documentKey,kind,offset,pageCharacters,pageDigest,requestDigest,scopeCount,scopeDigest,skip,version')
        throw invalid();
    const integer = (field) => typeof field === 'number' && Number.isSafeInteger(field) && field >= 0;
    if (candidate.version !== 1 || candidate.kind !== AUDIT_CURSOR_KIND || typeof candidate.documentKey !== 'string' ||
        typeof candidate.requestDigest !== 'string' || !HEX_64.test(candidate.requestDigest) ||
        !integer(candidate.scopeCount) || typeof candidate.scopeDigest !== 'string' || !/^(?:[0-9a-f]{16})?$/u.test(candidate.scopeDigest) ||
        !integer(candidate.offset) || !integer(candidate.skip) || (candidate.offset < 1 && candidate.skip < 1) ||
        (candidate.pageCharacters !== null && !(integer(candidate.pageCharacters) && candidate.pageCharacters >= 1 && candidate.pageCharacters <= PAGE_CHARACTERS_MAX)) ||
        (candidate.skip > 0 && candidate.pageCharacters === null) ||
        typeof candidate.pageDigest !== 'string' || (candidate.skip > 0 ? !HEX_64.test(candidate.pageDigest) : candidate.pageDigest !== '')) {
        throw invalid();
    }
    return candidate;
}
