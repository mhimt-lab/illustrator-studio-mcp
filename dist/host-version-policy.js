function row(kind, measured, unmeasured = 'admit', sourceUnchanged = false) {
    return Object.freeze({ kind, measured: Object.freeze([...measured]), unmeasured, ...(sourceUnchanged ? { sourceUnchanged: true } : {}) });
}
export const HOST_VERSION_POLICY = Object.freeze({
    operations: Object.freeze({
        update_artboard: row('mutation', ['30.8.1', '31.0.0']),
        delete_objects: row('mutation', ['30.8.1', '31.0.0']),
        embed_image: row('mutation', ['30.8.1', '31.0.0']),
        clipping_mask: row('mutation', ['30.8.1', '31.0.0']),
        import_vector_artwork: row('mutation', ['30.8.1', '31.0.0']),
        edit_path_points: row('mutation', ['30.8.1', '31.0.0']),
        spot_rollback: row('mutation', ['30.8.1']),
        capture_preview: row('read', ['30.8.1', '31.0.0']),
        optimize_images: row('mutation', ['30.8.1', '31.0.0'], 'admit', true),
        line_height_read: row('read', ['30.8.1', '31.0.0']),
        export_exact_px: row('mutation', ['30.8.2'], 'refuse'),
        mutate_batch: row('mutation', ['30.8.2']),
        duplicate_object: row('mutation', ['30.8.2']),
        replace_area_text_range: row('mutation', ['30.8.2', '31.0.0']),
        svg_export: row('mutation', ['30.8.2'], 'admit', true),
        work_copy_overwrite: row('mutation', ['30.8.2'], 'admit', true),
        windows_set_stroke_style: row('mutation', ['30.8.2'], 'refuse'),
        font_inventory: row('read', ['30.8.2']),
        artboard_render: row('read', ['30.8.2']),
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
export function hostVersionAdmitted(operation, version) {
    const { status } = evaluateHostVersion(operation, version);
    if (status === 'blocked' || status === 'unreadable')
        return false;
    if (HOST_VERSION_POLICY.operations[operation].kind === 'read')
        return true;
    if (status === 'measured' || status === 'patch_unmeasured')
        return true;
    return HOST_VERSION_POLICY.operations[operation].unmeasured === 'admit';
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
function hostVersionBackupPathMatches(actual, expected) {
  if (actual === expected) return true;
  var forms = params.hostFilePathForms;
  if (!forms || !Object.prototype.hasOwnProperty.call(forms, expected)) return false;
  var candidates = forms[expected];
  for (var index = 0; index < candidates.length; index++) if (actual === candidates[index]) return true;
  return false;
}
function hostVersionAdmitted(operation, version) {
  var evaluation = hostVersionEvaluate(operation, version);
  var status = evaluation.status;
  if (status === "blocked" || status === "unreadable") return false;
  if (HOST_VERSION_POLICY.operations[operation].kind === "read") return true;
  if (status === "measured") return true;
  if (status === "unmeasured" && HOST_VERSION_POLICY.operations[operation].unmeasured !== "admit") return false;
  if (typeof params !== "undefined" && params.apply === true) {
    // An unmeasured version or patch is admitted on the stable channel only. Node passes the configured target's
    // channel in every apply (public input cannot); a missing value is not stable.
    if (params.hostVersionChannel !== "stable") {
      var channelCode = status === "patch_unmeasured" ? "HOST_VERSION_PATCH_CHANNEL_UNMEASURED" : "HOST_VERSION_CHANNEL_UNMEASURED";
      throw new Error("MCP_ERROR:" + stringifyJson({ code: channelCode, message: "Illustrator " + String(version) + " is not a measured version, and unmeasured versions are admitted only on the stable channel. Nothing was changed." }));
    }
  }
  if (status === "patch_unmeasured") return true;
  if (HOST_VERSION_POLICY.operations[operation].sourceUnchanged !== true && typeof params !== "undefined" && params.apply === true) {
    var context = getDocumentContext();
    if (context.path !== null && context.mutationProfile !== "unsaved_document") {
      var backup = params.hostVersionBackup;
      if (!backup || !hostVersionBackupPathMatches(context.path, backup.sourcePath) || backup.sourceFileRevision !== context.fileRevision || backup.backupId !== params.backupId) {
        throw new Error("MCP_ERROR:" + stringifyJson({ code: "HOST_VERSION_BACKUP_REQUIRED", message: "A verified backup of this document file is required for an unmeasured Illustrator version." }));
      }
    }
  }
  return true;
}
`;
