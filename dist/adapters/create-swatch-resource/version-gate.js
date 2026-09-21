export const SPOT_ROLLBACK_VERIFIED_APP_VERSIONS = ['30.8.1'];
export function spotHostVersionVerified(appVersion) {
    return SPOT_ROLLBACK_VERIFIED_APP_VERSIONS.includes(appVersion);
}
