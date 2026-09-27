function row(kind, measured) {
    return Object.freeze({ kind, measured: Object.freeze([...measured]), unmeasured: kind === 'read' ? 'admit' : 'consent' });
}
export const HOST_VERSION_POLICY = Object.freeze({
    operations: Object.freeze({
        update_artboard: row('mutation', ['30.8.1']),
        delete_objects: row('mutation', ['30.8.1']),
        embed_image: row('mutation', ['30.8.1']),
        clipping_mask: row('mutation', ['30.8.1']),
        import_vector_artwork: row('mutation', ['30.8.1']),
        edit_path_points: row('mutation', ['30.8.1']),
        spot_rollback: row('mutation', ['30.8.1']),
        capture_preview: row('read', ['30.8.1']),
        optimize_images: row('mutation', ['30.8.1']),
        line_height_read: row('read', ['30.8.1']),
    }),
    blocked: Object.freeze([
        Object.freeze({ operation: 'spot_rollback', version: '30.8.0' }),
    ]),
});
export const HOST_VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
function parseVersion(version) {
    const match = HOST_VERSION_PATTERN.exec(version);
    return match === null ? null : { major: Number(match[1]), minor: Number(match[2]) };
}
export function evaluateHostVersion(operation, version) {
    const app = typeof version === 'string' ? version : String(version);
    const measuredVersions = HOST_VERSION_POLICY.operations[operation].measured;
    const latest = measuredVersions[measuredVersions.length - 1];
    const parsed = typeof version === 'string' ? parseVersion(app) : null;
    if (parsed === null)
        return { app, measured: latest, status: 'unreadable' };
    if (HOST_VERSION_POLICY.blocked.some((entry) => entry.operation === operation && entry.version === app)) {
        return { app, measured: latest, status: 'blocked' };
    }
    let sameMinor = null;
    for (const measured of measuredVersions) {
        if (measured === app)
            return { app, measured, status: 'measured' };
        const candidate = parseVersion(measured);
        if (candidate !== null && candidate.major === parsed.major && candidate.minor === parsed.minor)
            sameMinor = measured;
    }
    return sameMinor === null ? { app, measured: latest, status: 'unmeasured' } : { app, measured: sameMinor, status: 'patch_unmeasured' };
}
export function hostVersionAdmitted(operation, version, consent) {
    const { status } = evaluateHostVersion(operation, version);
    if (status === 'blocked' || status === 'unreadable')
        return false;
    if (HOST_VERSION_POLICY.operations[operation].kind === 'read')
        return true;
    if (consent?.acceptUnmeasuredHostVersion !== undefined &&
        (consent.hostVersionChannel !== 'stable' || consent.acceptUnmeasuredHostVersion !== version))
        return false;
    if (status === 'measured' || status === 'patch_unmeasured')
        return true;
    return consent?.hostVersionChannel === 'stable' && consent.acceptUnmeasuredHostVersion === version;
}
export const HOST_VERSION_POLICY_JSX = `
var HOST_VERSION_POLICY = ${JSON.stringify(HOST_VERSION_POLICY)};
function hostVersionParse(version) {
  var match = ${String(HOST_VERSION_PATTERN)}.exec(version);
  return match === null ? null : { major: Number(match[1]), minor: Number(match[2]) };
}
function hostVersionEvaluate(operation, version) {
  var app = String(version);
  var measuredVersions = HOST_VERSION_POLICY.operations[operation].measured;
  var latest = measuredVersions[measuredVersions.length - 1];
  var parsed = typeof version === "string" ? hostVersionParse(app) : null;
  if (parsed === null) return { app: app, measured: latest, status: "unreadable" };
  for (var blockedIndex = 0; blockedIndex < HOST_VERSION_POLICY.blocked.length; blockedIndex++) {
    var blockedEntry = HOST_VERSION_POLICY.blocked[blockedIndex];
    if (blockedEntry.operation === operation && blockedEntry.version === app) return { app: app, measured: latest, status: "blocked" };
  }
  var sameMinor = null;
  for (var measuredIndex = 0; measuredIndex < measuredVersions.length; measuredIndex++) {
    if (measuredVersions[measuredIndex] === app) return { app: app, measured: app, status: "measured" };
    var candidate = hostVersionParse(measuredVersions[measuredIndex]);
    if (candidate !== null && candidate.major === parsed.major && candidate.minor === parsed.minor) sameMinor = measuredVersions[measuredIndex];
  }
  return sameMinor === null ? { app: app, measured: latest, status: "unmeasured" } : { app: app, measured: sameMinor, status: "patch_unmeasured" };
}
function hostVersionConsent(input) {
  if (!input || input.acceptUnmeasuredHostVersion === undefined) return null;
  return { acceptUnmeasuredHostVersion: input.acceptUnmeasuredHostVersion, hostVersionChannel: input.hostVersionChannel };
}
function hostVersionAdmitted(operation, version, consent) {
  var status = hostVersionEvaluate(operation, version).status;
  if (status === "blocked" || status === "unreadable") return false;
  if (HOST_VERSION_POLICY.operations[operation].kind === "read") return true;
  if (consent === undefined && typeof params !== "undefined") consent = params;
  if (consent && consent.acceptUnmeasuredHostVersion !== undefined &&
      (consent.hostVersionChannel !== "stable" || consent.acceptUnmeasuredHostVersion !== version)) return false;
  if (status === "measured" || status === "patch_unmeasured") return true;
  if (!consent || consent.hostVersionChannel !== "stable" || consent.acceptUnmeasuredHostVersion !== version) return false;
  if (operation !== "optimize_images" && typeof params !== "undefined" && params.apply === true) {
    var context = getDocumentContext();
    if (context.path !== null) {
      var backup = params.hostVersionBackup;
      if (!backup || backup.sourcePath !== context.path || backup.sourceFileRevision !== context.fileRevision || backup.backupId !== params.backupId) {
        throw new Error("MCP_ERROR:" + stringifyJson({ code: "HOST_VERSION_BACKUP_REQUIRED", message: "A verified backup of this document file is required." }));
      }
    }
  }
  return true;
}
`;
